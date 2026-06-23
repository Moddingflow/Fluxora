#include "FluxoraCore/Services/ProfileService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
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
