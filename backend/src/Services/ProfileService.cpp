#include "FluxoraCore/Services/ProfileService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <algorithm>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <set>
#include <stdexcept>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view fallbackProfileName = L"Default";
        constexpr std::uintmax_t maxAiTextPreviewBytes = 64ULL * 1024ULL;

        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
            return out;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::string pathForLog(const std::filesystem::path& path)
        {
            return toUtf8(path.wstring());
        }

        std::wstring fromUtf8(const std::string& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0);
            if (size <= 0)
            {
                throw std::invalid_argument("Text is not valid UTF-8.");
            }

            std::wstring out(static_cast<std::size_t>(size), L'\0');
            MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size);
            return out;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        std::wstring trim(std::wstring value)
        {
            const auto first = value.find_first_not_of(L" \t\r\n");
            if (first == std::wstring::npos)
            {
                return {};
            }

            const auto last = value.find_last_not_of(L" \t\r\n");
            return value.substr(first, last - first + 1);
        }

        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::wstring normalizeDefaultProfileName(std::wstring_view profileName)
        {
            std::wstring normalized = trim(std::wstring(profileName));
            return normalized.empty() ? std::wstring(fallbackProfileName) : normalized;
        }

        std::wstring normalizeProfileName(std::wstring_view profileName)
        {
            std::wstring normalized = trim(std::wstring(profileName));
            if (normalized.empty())
            {
                throw std::invalid_argument("Profile name is required.");
            }

            if (normalized == L"." || normalized == L"..")
            {
                throw std::invalid_argument("Profile name cannot be a relative path segment.");
            }

            constexpr std::wstring_view invalidCharacters = L"<>:\"/\\|?*";
            for (wchar_t character : normalized)
            {
                if (character < 32 || invalidCharacters.find(character) != std::wstring_view::npos)
                {
                    throw std::invalid_argument("Profile name contains a character that is not allowed in a folder name.");
                }
            }

            return normalized;
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        bool isDefaultProfile(std::wstring_view profileName, std::wstring_view defaultProfileName)
        {
            return equalsIgnoreCase(profileName, normalizeDefaultProfileName(defaultProfileName));
        }

        bool isRelativeProfileFilePath(const std::filesystem::path& path)
        {
            if (path.empty() || path.is_absolute())
            {
                return false;
            }

            for (const std::filesystem::path& part : path)
            {
                if (part == L"." || part == L"..")
                {
                    return false;
                }
            }

            return true;
        }

        std::wstring normalizePreviewProfileFileName(std::wstring_view fileName)
        {
            std::wstring normalized = trim(std::wstring(fileName));
            if (normalized.empty())
            {
                throw std::invalid_argument("Profile text file name is required.");
            }
            if (normalized.find(L'/') != std::wstring::npos || normalized.find(L'\\') != std::wstring::npos)
            {
                throw std::invalid_argument("Profile text file name must not contain path separators.");
            }

            const std::wstring lowered = toLower(normalized);
            if (lowered != L"plugins.txt" && lowered != L"loadorder.txt" && lowered != L"modlist.txt")
            {
                throw std::invalid_argument("Profile text preview is limited to plugins.txt, loadorder.txt, or modlist.txt.");
            }

            return lowered;
        }

        std::uintmax_t boundedTextPreviewBytes(std::uintmax_t maxBytes)
        {
            if (maxBytes == 0)
            {
                return maxAiTextPreviewBytes;
            }

            return (std::min)(maxBytes, maxAiTextPreviewBytes);
        }

        void rejectBinaryTextContent(const std::string& content)
        {
            if (content.find('\0') != std::string::npos)
            {
                throw std::invalid_argument("File is not a text document.");
            }
        }

        std::wstring decodeUtf8Preview(std::string& content)
        {
            rejectBinaryTextContent(content);
            while (!content.empty())
            {
                try
                {
                    return fromUtf8(content);
                }
                catch (const std::invalid_argument&)
                {
                    content.pop_back();
                }
            }

            return {};
        }

        ProfileTextFilePreview readUtf8ProfileTextPreview(
            const std::filesystem::path& path,
            std::wstring relativePath,
            std::uintmax_t maxBytes)
        {
            std::error_code statusError;
            if (!std::filesystem::is_regular_file(path, statusError) || statusError)
            {
                throw std::invalid_argument("Profile text preview can only open regular files.");
            }

            const std::uintmax_t size = std::filesystem::file_size(path, statusError);
            if (statusError)
            {
                throw std::runtime_error("Failed to inspect profile text preview file size.");
            }

            const std::uintmax_t requestedBytes = boundedTextPreviewBytes(maxBytes);
            const std::uintmax_t bytesToRead = (std::min)(size, requestedBytes);
            std::ifstream file(path, std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to open profile text preview file.");
            }

            std::string content(static_cast<std::size_t>(bytesToRead), '\0');
            if (!content.empty())
            {
                file.read(content.data(), static_cast<std::streamsize>(content.size()));
                content.resize(static_cast<std::size_t>(file.gcount()));
            }

            std::uintmax_t bytesRead = static_cast<std::uintmax_t>(content.size());
            const std::wstring preview = decodeUtf8Preview(content);
            bytesRead = static_cast<std::uintmax_t>(content.size());

            return ProfileTextFilePreview{
                path,
                std::move(relativePath),
                path.filename().wstring(),
                preview,
                bytesRead,
                size,
                size > bytesRead
            };
        }

        void seedProfileFiles(
            const std::filesystem::path& profileDirectory,
            const std::vector<std::wstring>& profileFiles)
        {
            for (const std::wstring& rawFile : profileFiles)
            {
                const std::filesystem::path relative = std::filesystem::path(trim(rawFile));
                if (!isRelativeProfileFilePath(relative))
                {
                    continue;
                }

                const std::filesystem::path destination = profileDirectory / relative;
                if (!destination.parent_path().empty())
                {
                    std::filesystem::create_directories(destination.parent_path());
                }
                if (std::filesystem::exists(destination))
                {
                    continue;
                }

                std::ofstream file(destination, std::ios::binary);
                if (!file)
                {
                    throw std::runtime_error("Failed to create profile state file.");
                }
            }
        }

        void addProfileName(
            std::vector<std::wstring>& profiles,
            std::set<std::wstring>& seen,
            std::wstring profileName)
        {
            profileName = normalizeDefaultProfileName(profileName);
            const std::wstring key = toLower(profileName);
            if (seen.insert(key).second)
            {
                profiles.push_back(std::move(profileName));
            }
        }

        bool containsProfileName(
            const std::vector<std::wstring>& profiles,
            std::wstring_view profileName)
        {
            return std::any_of(
                profiles.begin(),
                profiles.end(),
                [profileName](const std::wstring& candidate)
                {
                    return equalsIgnoreCase(candidate, profileName);
                });
        }

        void ensureProfileDoesNotExist(
            const std::vector<std::wstring>& profiles,
            std::wstring_view profileName)
        {
            if (containsProfileName(profiles, profileName))
            {
                throw std::invalid_argument("Profile already exists.");
            }
        }

        void sortProfileNames(std::vector<std::wstring>& profiles, std::wstring_view defaultProfileName)
        {
            const std::wstring normalizedDefault = normalizeDefaultProfileName(defaultProfileName);
            std::stable_sort(
                profiles.begin(),
                profiles.end(),
                [&normalizedDefault](const std::wstring& left, const std::wstring& right)
                {
                    const bool leftDefault = equalsIgnoreCase(left, normalizedDefault);
                    const bool rightDefault = equalsIgnoreCase(right, normalizedDefault);
                    if (leftDefault != rightDefault)
                    {
                        return leftDefault;
                    }

                    return toLower(left) < toLower(right);
                });
        }
    }

    ProfileService::ProfileService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          pathSettings_(pathSettings)
    {
    }

    void ProfileService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        initialized_ = true;
        logger_.write(LogLevel::Info, "Profile service initialized.");
    }

    void ProfileService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        logger_.write(LogLevel::Info, "Profile service shut down.");
        initialized_ = false;
    }

    std::vector<std::wstring> ProfileService::listProfiles(
        const std::filesystem::path& projectDirectory,
        std::wstring_view defaultProfileName) const
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        std::vector<std::wstring> profiles;
        std::set<std::wstring> seen;
        addProfileName(profiles, seen, normalizeDefaultProfileName(defaultProfileName));

        const std::filesystem::path profilesDirectory = pathSettings_.profilesDirectory(projectDirectory);
        std::error_code error;
        if (std::filesystem::is_directory(profilesDirectory, error) && !error)
        {
            for (const std::filesystem::directory_entry& entry : std::filesystem::directory_iterator(
                     profilesDirectory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    break;
                }

                std::error_code entryError;
                if (entry.is_directory(entryError) && !entryError)
                {
                    const std::wstring name = trim(entry.path().filename().wstring());
                    if (!name.empty() && name != L"." && name != L"..")
                    {
                        addProfileName(profiles, seen, name);
                    }
                }
            }
        }

        for (const std::wstring& profile : InstanceMetadataStore::listProfileNames(projectDirectory))
        {
            addProfileName(profiles, seen, profile);
        }

        sortProfileNames(profiles, defaultProfileName);
        return profiles;
    }

    ProfileTextFilePreview ProfileService::previewProfileTextFile(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view fileName,
        std::uintmax_t maxBytes) const
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = normalizeProfileName(profileName);
        const std::wstring normalizedFileName = normalizePreviewProfileFileName(fileName);
        const std::filesystem::path profilesDirectory = pathSettings_.profilesDirectory(projectDirectory);
        const std::filesystem::path profileDirectory =
            profilesDirectory / std::filesystem::path(normalizedProfileName);
        const std::filesystem::path targetPath =
            profileDirectory / std::filesystem::path(normalizedFileName);
        const PathSafetyService safety;
        safety.validateContainedPath(profilesDirectory, profileDirectory)
            .throwIfUnsafe("Profile folder");
        safety.validateContainedPath(profileDirectory, targetPath)
            .throwIfUnsafe("Profile text file");

        return readUtf8ProfileTextPreview(
            targetPath,
            normalizedProfileName + L"/" + normalizedFileName,
            maxBytes);
    }

    std::vector<std::wstring> ProfileService::createProfile(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view defaultProfileName,
        const std::vector<std::wstring>& profileFiles) const
    {
        const std::wstring normalizedProfileName = normalizeProfileName(profileName);
        std::vector<std::wstring> profiles = listProfiles(projectDirectory, defaultProfileName);
        ensureProfileDoesNotExist(profiles, normalizedProfileName);

        const std::filesystem::path profileDirectory =
            pathSettings_.profilesDirectory(projectDirectory) / std::filesystem::path(normalizedProfileName);
        std::filesystem::create_directories(profileDirectory);
        seedProfileFiles(profileDirectory, profileFiles);
        InstanceMetadataStore::ensureProfileState(
            projectDirectory,
            normalizedProfileName,
            pathSettings_.modsDirectory(projectDirectory));

        logger_.writeOperation(
            LogLevel::Info,
            "Profiles",
            "Create profile completed. projectDirectory=\"" + pathForLog(projectDirectory) +
                "\", profile=\"" + toUtf8(normalizedProfileName) + "\".");
        return listProfiles(projectDirectory, defaultProfileName);
    }

    std::vector<std::wstring> ProfileService::cloneProfile(
        const std::filesystem::path& projectDirectory,
        std::wstring_view sourceProfileName,
        std::wstring_view targetProfileName,
        std::wstring_view defaultProfileName) const
    {
        const std::wstring normalizedSourceProfileName = normalizeProfileName(sourceProfileName);
        const std::wstring normalizedTargetProfileName = normalizeProfileName(targetProfileName);
        std::vector<std::wstring> profiles = listProfiles(projectDirectory, defaultProfileName);
        if (!containsProfileName(profiles, normalizedSourceProfileName))
        {
            throw std::invalid_argument("Source profile was not found.");
        }
        ensureProfileDoesNotExist(profiles, normalizedTargetProfileName);

        const std::filesystem::path profilesDirectory = pathSettings_.profilesDirectory(projectDirectory);
        const std::filesystem::path sourceDirectory = profilesDirectory / std::filesystem::path(normalizedSourceProfileName);
        const std::filesystem::path targetDirectory = profilesDirectory / std::filesystem::path(normalizedTargetProfileName);
        if (std::filesystem::exists(targetDirectory))
        {
            throw std::invalid_argument("Target profile folder already exists.");
        }

        if (std::filesystem::is_directory(sourceDirectory))
        {
            std::filesystem::copy(
                sourceDirectory,
                targetDirectory,
                std::filesystem::copy_options::recursive |
                    std::filesystem::copy_options::skip_symlinks);
        }
        else
        {
            std::filesystem::create_directories(targetDirectory);
        }

        InstanceMetadataStore::cloneProfileState(
            projectDirectory,
            normalizedSourceProfileName,
            normalizedTargetProfileName,
            pathSettings_.modsDirectory(projectDirectory));

        logger_.writeOperation(
            LogLevel::Info,
            "Profiles",
            "Clone profile completed. projectDirectory=\"" + pathForLog(projectDirectory) +
                "\", sourceProfile=\"" + toUtf8(normalizedSourceProfileName) +
                "\", targetProfile=\"" + toUtf8(normalizedTargetProfileName) + "\".");
        return listProfiles(projectDirectory, defaultProfileName);
    }

    std::vector<std::wstring> ProfileService::renameProfile(
        const std::filesystem::path& projectDirectory,
        std::wstring_view sourceProfileName,
        std::wstring_view targetProfileName,
        std::wstring_view defaultProfileName) const
    {
        const std::wstring normalizedSourceProfileName = normalizeProfileName(sourceProfileName);
        const std::wstring normalizedTargetProfileName = normalizeProfileName(targetProfileName);
        if (isDefaultProfile(normalizedSourceProfileName, defaultProfileName))
        {
            throw std::invalid_argument("The default profile cannot be renamed.");
        }

        std::vector<std::wstring> profiles = listProfiles(projectDirectory, defaultProfileName);
        if (!containsProfileName(profiles, normalizedSourceProfileName))
        {
            throw std::invalid_argument("Profile was not found.");
        }
        ensureProfileDoesNotExist(profiles, normalizedTargetProfileName);

        const std::filesystem::path profilesDirectory = pathSettings_.profilesDirectory(projectDirectory);
        const std::filesystem::path sourceDirectory = profilesDirectory / std::filesystem::path(normalizedSourceProfileName);
        const std::filesystem::path targetDirectory = profilesDirectory / std::filesystem::path(normalizedTargetProfileName);
        if (std::filesystem::exists(targetDirectory))
        {
            throw std::invalid_argument("Target profile folder already exists.");
        }

        if (std::filesystem::is_directory(sourceDirectory))
        {
            std::filesystem::rename(sourceDirectory, targetDirectory);
        }
        else
        {
            std::filesystem::create_directories(targetDirectory);
        }

        InstanceMetadataStore::renameProfileState(
            projectDirectory,
            normalizedSourceProfileName,
            normalizedTargetProfileName);

        logger_.writeOperation(
            LogLevel::Info,
            "Profiles",
            "Rename profile completed. projectDirectory=\"" + pathForLog(projectDirectory) +
                "\", sourceProfile=\"" + toUtf8(normalizedSourceProfileName) +
                "\", targetProfile=\"" + toUtf8(normalizedTargetProfileName) + "\".");
        return listProfiles(projectDirectory, defaultProfileName);
    }

    std::vector<std::wstring> ProfileService::deleteProfile(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view defaultProfileName) const
    {
        const std::wstring normalizedProfileName = normalizeProfileName(profileName);
        if (isDefaultProfile(normalizedProfileName, defaultProfileName))
        {
            throw std::invalid_argument("The default profile cannot be deleted.");
        }

        std::vector<std::wstring> profiles = listProfiles(projectDirectory, defaultProfileName);
        if (!containsProfileName(profiles, normalizedProfileName))
        {
            throw std::invalid_argument("Profile was not found.");
        }

        const std::filesystem::path profileDirectory =
            pathSettings_.profilesDirectory(projectDirectory) / std::filesystem::path(normalizedProfileName);
        if (std::filesystem::exists(profileDirectory))
        {
            std::filesystem::remove_all(profileDirectory);
        }

        InstanceMetadataStore::deleteProfileState(projectDirectory, normalizedProfileName);

        logger_.writeOperation(
            LogLevel::Info,
            "Profiles",
            "Delete profile completed. projectDirectory=\"" + pathForLog(projectDirectory) +
                "\", profile=\"" + toUtf8(normalizedProfileName) + "\".");
        return listProfiles(projectDirectory, defaultProfileName);
    }

    bool ProfileService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
