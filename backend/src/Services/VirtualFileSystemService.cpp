#include "FluxoraCore/Services/VirtualFileSystemService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/BodySlideIntegrationService.hpp"
#include "FluxoraCore/Services/LodGeneratorIntegrationService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Services/VfsMountPlan.hpp"
#include "FluxoraCore/Support/ScopedFileCleanup.hpp"
#include "FluxoraCore/Support/LaunchDescriptorStore.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"
#include "FluxoraVfs/VfsEnvironment.hpp"

#include <array>
#include <chrono>
#include <fstream>
#include <algorithm>
#include <cstdint>
#include <cwctype>
#include <iomanip>
#include <limits>
#include <map>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#include <shlobj.h>
#endif

#ifdef FLUXORA_ENABLE_VFS
#include "FluxoraVfs/VfsProtocol.hpp"
#include <detours.h>
#endif

namespace fluxora
{
    namespace
    {
        template <typename TService>
        class ManagedLaunchLeaseGuard final
        {
        public:
            explicit ManagedLaunchLeaseGuard(TService& service) noexcept
                : service_(service)
            {
            }

            ~ManagedLaunchLeaseGuard()
            {
                if (!sessionId_.empty())
                {
                    service_.abandonLaunch(sessionId_);
                }
            }

            void arm(std::wstring sessionId)
            {
                sessionId_ = std::move(sessionId);
            }

            void release() noexcept
            {
                sessionId_.clear();
            }

        private:
            TService& service_;
            std::wstring sessionId_;
        };

#ifdef _WIN32
        std::string toUtf8(const std::wstring& value)
        {
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
        }

        std::string toAnsi(const std::wstring& value)
        {
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_ACP, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_ACP, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
            return out;
        }

        std::string pathSafetyErrorForLog(const PathSafetyResult& result)
        {
            const std::wstring message = result.message();
            return message.empty() ? std::string("unsafe path") : toUtf8(message);
        }

        std::string win32Message(DWORD value)
        {
            if (value == ERROR_SUCCESS)
            {
                return {};
            }

            LPWSTR raw = nullptr;
            const DWORD length = FormatMessageW(
                FORMAT_MESSAGE_ALLOCATE_BUFFER |
                    FORMAT_MESSAGE_FROM_SYSTEM |
                    FORMAT_MESSAGE_IGNORE_INSERTS,
                nullptr,
                value,
                0,
                reinterpret_cast<LPWSTR>(&raw),
                0,
                nullptr);
            if (length == 0 || raw == nullptr)
            {
                return {};
            }

            std::wstring message(raw, raw + length);
            LocalFree(raw);
            while (!message.empty() &&
                (message.back() == L'\r' || message.back() == L'\n' || message.back() == L' '))
            {
                message.pop_back();
            }

            return toUtf8(message);
        }

        std::string describeWin32Error(DWORD value)
        {
            std::string description = std::to_string(value);
            if (const std::string message = win32Message(value); !message.empty())
            {
                description += " (" + message + ")";
            }

            return description;
        }

        constexpr std::wstring_view parallaxGenIgnoreMo2VfsCheckArgument =
            L"--ignore-mo2vfscheck";
#else
        std::string toUtf8(const std::wstring& value)
        {
            return std::string(value.begin(), value.end());
        }
#endif

        [[nodiscard]] std::string joinVfsList(const std::vector<std::wstring>& values)
        {
            std::string joined;
            for (const std::wstring& value : values)
            {
                if (!joined.empty())
                {
                    joined += "|";
                }
                joined += toUtf8(value);
            }

            return joined.empty() ? std::string("<none>") : joined;
        }

        [[nodiscard]] std::string vfsRulesSummary(const GameVfsRules* rules)
        {
            if (rules == nullptr)
            {
                return "<none>";
            }

            return "supportsRootBuilder=" + std::to_string(rules->supportsRootBuilder ? 1 : 0) +
                ";rootBuilderDirectory=" + toUtf8(rules->rootBuilderDirectoryName) +
                ";userSettingsDirectory=" + toUtf8(rules->userSettingsDirectoryName) +
                ";profileIniFiles=" + joinVfsList(rules->profileIniFileNames) +
                ";saveDirectories=" + joinVfsList(rules->saveDirectoryNames) +
                ";materializedLaunchCacheDirectories=" +
                    joinVfsList(rules->materializedLaunchCacheDirectories);
        }

        std::wstring toLower(std::wstring value)
        {
            std::transform(
                value.begin(),
                value.end(),
                value.begin(),
                [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
            return value;
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        bool containsIgnoreCase(std::wstring_view value, std::wstring_view needle)
        {
            return toLower(std::wstring(value)).find(toLower(std::wstring(needle))) != std::wstring::npos;
        }

        bool isDirectory(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::exists(path, error) && std::filesystem::is_directory(path, error);
        }

        bool directoryHasEntries(const std::filesystem::path& path)
        {
            std::error_code error;
            if (!std::filesystem::exists(path, error) || !std::filesystem::is_directory(path, error))
            {
                return false;
            }

            std::filesystem::directory_iterator iterator(
                path,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            return !error && iterator != std::filesystem::directory_iterator{};
        }

        std::filesystem::path childDirectoryByName(
            const std::filesystem::path& parent,
            std::wstring_view name)
        {
            if (parent.empty() || name.empty())
            {
                return {};
            }

            const std::filesystem::path direct = parent / std::filesystem::path(std::wstring(name));
            if (isDirectory(direct))
            {
                return direct;
            }

#ifdef _WIN32
            // Windows directory lookup is case-insensitive, so the direct probe
            // avoids scanning large profile/mod roots for casing variants.
            return {};
#else
            std::error_code error;
            if (!std::filesystem::exists(parent, error) || !std::filesystem::is_directory(parent, error))
            {
                return {};
            }

            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::directory_iterator(
                     parent,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    break;
                }

                if (entry.is_directory(error) &&
                    equalsIgnoreCase(entry.path().filename().wstring(), name))
                {
                    return entry.path();
                }
            }

            return {};
#endif
        }

        std::wstring normalizedPathForComparison(const std::filesystem::path& path)
        {
            std::wstring value = std::filesystem::absolute(path).lexically_normal().wstring();
            while (value.size() > 1 && (value.back() == L'\\' || value.back() == L'/'))
            {
                value.pop_back();
            }

            return toLower(value);
        }

        void appendUniqueDirectory(
            std::vector<std::filesystem::path>& directories,
            const std::filesystem::path& directory)
        {
            if (!directoryHasEntries(directory))
            {
                return;
            }

            const std::wstring normalized = normalizedPathForComparison(directory);
            const auto existing = std::find_if(
                directories.begin(),
                directories.end(),
                [&normalized](const std::filesystem::path& candidate)
                {
                    return normalizedPathForComparison(candidate) == normalized;
                });

            if (existing == directories.end())
            {
                directories.push_back(directory);
            }
        }

        std::vector<std::filesystem::path> collectProfileSaveDirectories(
            const std::filesystem::path& profilesDirectory,
            const std::filesystem::path& profileDirectory,
            const std::vector<std::wstring>& saveDirectoryNames)
        {
            std::vector<std::filesystem::path> directories;
            for (const std::wstring& saveDirectoryName : saveDirectoryNames)
            {
                appendUniqueDirectory(directories, childDirectoryByName(profilesDirectory, saveDirectoryName));
                appendUniqueDirectory(directories, childDirectoryByName(profileDirectory, saveDirectoryName));
            }
            return directories;
        }

        std::filesystem::path profileSaveOverwriteDirectory(
            const std::filesystem::path& profilesDirectory,
            const std::filesystem::path& profileDirectory,
            const std::vector<std::wstring>& saveDirectoryNames)
        {
            for (const std::wstring& saveDirectoryName : saveDirectoryNames)
            {
                if (const std::filesystem::path profileSaves =
                        childDirectoryByName(profileDirectory, saveDirectoryName);
                    !profileSaves.empty())
                {
                    return profileSaves;
                }
            }

            if (isDirectory(profileDirectory) && !saveDirectoryNames.empty())
            {
                return profileDirectory / std::filesystem::path(saveDirectoryNames.front());
            }

            for (const std::wstring& saveDirectoryName : saveDirectoryNames)
            {
                if (const std::filesystem::path rootSaves =
                        childDirectoryByName(profilesDirectory, saveDirectoryName);
                    !rootSaves.empty())
                {
                    return rootSaves;
                }
            }

            if (isDirectory(profilesDirectory) && !saveDirectoryNames.empty())
            {
                return profilesDirectory / std::filesystem::path(saveDirectoryNames.front());
            }

            return {};
        }

        std::wstring safePathSegment(std::wstring value, std::wstring_view fallback)
        {
            static constexpr std::wstring_view invalid = L"<>:\"/\\|?*";
            for (wchar_t& character : value)
            {
                if (character < 32 || invalid.find(character) != std::wstring_view::npos)
                {
                    character = L'_';
                }
            }

            while (!value.empty() && (value.back() == L'.' || value.back() == L' '))
            {
                value.pop_back();
            }

            return value.empty() ? std::wstring(fallback) : value;
        }

#ifdef _WIN32
        std::wstring readEnvironmentVariable(const wchar_t* name)
        {
            const DWORD requiredLength = GetEnvironmentVariableW(name, nullptr, 0);
            if (requiredLength == 0)
            {
                return {};
            }

            std::wstring value(requiredLength, L'\0');
            const DWORD actualLength = GetEnvironmentVariableW(name, value.data(), requiredLength);
            if (actualLength == 0 || actualLength >= requiredLength)
            {
                return {};
            }

            value.resize(actualLength);
            return value;
        }

        std::filesystem::path shellFolderPath(int folder)
        {
            wchar_t buffer[MAX_PATH]{};
            if (SUCCEEDED(SHGetFolderPathW(nullptr, folder, nullptr, SHGFP_TYPE_CURRENT, buffer)) &&
                buffer[0] != L'\0')
            {
                return std::filesystem::path(buffer);
            }

            return {};
        }
#endif

        std::filesystem::path documentsDirectory()
        {
#ifdef _WIN32
            if (const std::filesystem::path folder = shellFolderPath(CSIDL_PERSONAL); !folder.empty())
            {
                return folder;
            }

            if (const std::wstring userProfile = readEnvironmentVariable(L"USERPROFILE"); !userProfile.empty())
            {
                return std::filesystem::path(userProfile) / L"Documents";
            }
#endif

            return {};
        }

        std::filesystem::path localAppDataDirectory()
        {
#ifdef _WIN32
            if (const std::wstring localAppData = readEnvironmentVariable(L"LOCALAPPDATA"); !localAppData.empty())
            {
                return std::filesystem::path(localAppData);
            }

            if (const std::filesystem::path folder = shellFolderPath(CSIDL_LOCAL_APPDATA); !folder.empty())
            {
                return folder;
            }

            if (const std::wstring userProfile = readEnvironmentVariable(L"USERPROFILE"); !userProfile.empty())
            {
                return std::filesystem::path(userProfile) / L"AppData" / L"Local";
            }
#endif

            return {};
        }

        std::filesystem::path roamingAppDataDirectory()
        {
#ifdef _WIN32
            if (const std::wstring appData = readEnvironmentVariable(L"APPDATA"); !appData.empty())
            {
                return std::filesystem::path(appData);
            }

            if (const std::filesystem::path folder = shellFolderPath(CSIDL_APPDATA); !folder.empty())
            {
                return folder;
            }
#endif

            return {};
        }

        std::filesystem::path resolveVfsMountTarget(
            const GameVfsMountRule& rule,
            const std::filesystem::path& gameDirectory)
        {
            std::filesystem::path base;
            switch (rule.targetBase)
            {
            case GameVfsMountTargetBase::GameDirectory:
                base = gameDirectory;
                break;
            case GameVfsMountTargetBase::Documents:
                base = documentsDirectory();
                break;
            case GameVfsMountTargetBase::LocalAppData:
                base = localAppDataDirectory();
                break;
            case GameVfsMountTargetBase::RoamingAppData:
                base = roamingAppDataDirectory();
                break;
            }
            if (base.empty())
            {
                return {};
            }
            return rule.targetPath.empty() ? base : base / rule.targetPath;
        }

        void writeTextFile(const std::filesystem::path& path, const std::string& content)
        {
            if (!path.parent_path().empty())
            {
                std::filesystem::create_directories(path.parent_path());
            }

            std::ofstream file(path, std::ios::out | std::ios::trunc | std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to write the virtual file system descriptor.");
            }

            file.write(content.data(), static_cast<std::streamsize>(content.size()));
        }

        std::wstring launchSessionId()
        {
#ifdef _WIN32
            std::array<unsigned char, 16> randomBytes{};
            if (BCryptGenRandom(
                    nullptr,
                    randomBytes.data(),
                    static_cast<ULONG>(randomBytes.size()),
                    BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
            {
                throw std::runtime_error("Failed to generate a VFS launch session id.");
            }

            std::wostringstream stream;
            stream << std::hex << std::setfill(L'0');
            for (const unsigned char byte : randomBytes)
            {
                stream << std::setw(2) << static_cast<unsigned int>(byte);
            }
            return stream.str();
#else
            throw std::runtime_error("VFS launch sessions require Windows.");
#endif
        }

        void writeNewTextFile(const std::filesystem::path& path, const std::string& content)
        {
#ifdef _WIN32
            HANDLE file = CreateFileW(
                path.c_str(),
                GENERIC_WRITE,
                0,
                nullptr,
                CREATE_NEW,
                FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH,
                nullptr);
            if (file == INVALID_HANDLE_VALUE)
            {
                throw std::runtime_error(
                    "Failed to create the immutable virtual file system descriptor. Win32 error: " +
                    std::to_string(GetLastError()) + ".");
            }

            bool complete = false;
            try
            {
                std::size_t offset = 0;
                while (offset < content.size())
                {
                    const std::size_t remaining = content.size() - offset;
                    const DWORD requested = remaining > static_cast<std::size_t>(MAXDWORD)
                        ? MAXDWORD
                        : static_cast<DWORD>(remaining);
                    DWORD written = 0;
                    if (!WriteFile(file, content.data() + offset, requested, &written, nullptr) || written == 0)
                    {
                        throw std::runtime_error(
                            "Failed to write the immutable virtual file system descriptor. Win32 error: " +
                            std::to_string(GetLastError()) + ".");
                    }
                    offset += written;
                }
                if (!FlushFileBuffers(file))
                {
                    throw std::runtime_error(
                        "Failed to flush the immutable virtual file system descriptor. Win32 error: " +
                        std::to_string(GetLastError()) + ".");
                }
                complete = true;
            }
            catch (...)
            {
                CloseHandle(file);
                std::error_code ignored;
                std::filesystem::remove(path, ignored);
                throw;
            }
            CloseHandle(file);
            if (!complete)
            {
                std::error_code ignored;
                std::filesystem::remove(path, ignored);
                throw std::runtime_error("Failed to publish the virtual file system descriptor.");
            }
#else
            (void)path;
            (void)content;
            throw std::runtime_error("VFS launch sessions require Windows.");
#endif
        }

        // The FluxoraVfs.dll hook ships next to FluxoraCore.dll, so it is located
        // relative to this very module rather than the (unknown) game folder.
        std::filesystem::path hookDllPath()
        {
#ifdef _WIN32
            HMODULE module = nullptr;
            if (!GetModuleHandleExW(
                    GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                    reinterpret_cast<LPCWSTR>(&writeTextFile),
                    &module))
            {
                return {};
            }

            wchar_t buffer[MAX_PATH * 2];
            const DWORD length = GetModuleFileNameW(module, buffer, static_cast<DWORD>(std::size(buffer)));
            if (length == 0 || length >= std::size(buffer))
            {
                return {};
            }

            return std::filesystem::path(std::wstring(buffer, length)).parent_path() / L"FluxoraVfs.dll";
#else
            return {};
#endif
        }

        // Profile state files the manager owns end to end. Keeping them out of
        // the copy-on-write overlay is what stops a launch from forking, say,
        // plugins.txt: once a fork exists it outranks the profile copy on every
        // later launch, so the game keeps loading a stale plugin list while the
        // Fluxora list shows the user's current choices.
        std::vector<std::wstring> profileOwnedFileNames(const GameVfsRules& rules)
        {
            std::vector<std::wstring> ownedFiles;
            for (const std::wstring& stateFile : rules.profileStateFileNames)
            {
                const std::filesystem::path relative(stateFile);
                if (stateFile.empty() || relative.is_absolute())
                {
                    continue;
                }

                const std::wstring normalized = relative.lexically_normal().wstring();
                if (normalized.empty() ||
                    normalized.starts_with(L"..") ||
                    std::find(ownedFiles.begin(), ownedFiles.end(), normalized) != ownedFiles.end())
                {
                    continue;
                }

                ownedFiles.push_back(normalized);
            }

            return ownedFiles;
        }

        // Repairs profiles that already carry a fork from a launch made before
        // owned files existed. The profile copy is authoritative, so the fork is
        // moved aside (never deleted outright) and the game stops seeing it. The
        // quarantine sits outside the overwrite tree so it is never projected
        // into the mount target.
        void quarantineSupersededOwnedFiles(
            Logger& logger,
            const std::filesystem::path& overwrite,
            const std::filesystem::path& quarantine,
            const std::vector<std::wstring>& ownedFiles)
        {
            if (overwrite.empty() || quarantine.empty() || ownedFiles.empty())
            {
                return;
            }

            for (const std::wstring& ownedFile : ownedFiles)
            {
                const std::filesystem::path fork = overwrite / std::filesystem::path(ownedFile);
                std::error_code status;
                if (!std::filesystem::is_regular_file(fork, status))
                {
                    continue;
                }

                const std::filesystem::path archived = quarantine / std::filesystem::path(ownedFile);
                std::error_code ignored;
                std::filesystem::create_directories(archived.parent_path(), ignored);
                std::filesystem::remove(archived, ignored);

                std::error_code archiveError;
                std::filesystem::rename(fork, archived, archiveError);
                if (archiveError)
                {
                    // The fork must not survive even when it cannot be kept:
                    // leaving it in place would keep shadowing the profile copy.
                    std::filesystem::remove(fork, ignored);
                }

                logger.writeOperation(
                    LogLevel::Warning,
                    "VfsDiagnostics",
                    "vfsOperation supersededProfileStateFile file=\"" + toUtf8(ownedFile) +
                        "\", archived=" + std::to_string(archiveError ? 0 : 1) +
                        ". The profile copy is authoritative again.");
            }
        }

        void appendProfileSettingsMount(
            std::vector<VfsMountDescriptor>& mounts,
            const std::filesystem::path& target,
            const std::filesystem::path& overwrite,
            const std::filesystem::path& profileDirectory,
            std::vector<std::wstring> ownedFiles)
        {
            if (target.empty())
            {
                return;
            }

            VfsMountDescriptor mount{
                target,
                overwrite,
                {profileDirectory},
                {}
            };
            mount.ownedFiles = std::move(ownedFiles);
            mounts.push_back(std::move(mount));
        }

        void appendProfileSavesMount(
            std::vector<VfsMountDescriptor>& mounts,
            const std::filesystem::path& target,
            const std::filesystem::path& overwrite,
            const std::vector<std::filesystem::path>& saveDirectories,
            const std::filesystem::path& whiteoutRoot)
        {
            if (target.empty() || overwrite.empty())
            {
                return;
            }

            std::vector<std::filesystem::path> readDirectories;
            const std::wstring overwriteNormalized = normalizedPathForComparison(overwrite);
            for (const std::filesystem::path& saveDirectory : saveDirectories)
            {
                if (normalizedPathForComparison(saveDirectory) != overwriteNormalized)
                {
                    readDirectories.push_back(saveDirectory);
                }
            }

            mounts.push_back(VfsMountDescriptor{
                target,
                overwrite,
                readDirectories,
                {},
                {},
                whiteoutRoot
            });
        }

        void appendGameProfileSettingsMounts(
            Logger& logger,
            std::vector<VfsMountDescriptor>& mounts,
            const GameVfsRules& rules,
            const ContentLayoutSupportRules& contentRules,
            const std::filesystem::path& gameDirectory,
            const std::filesystem::path& profilesDirectory,
            const std::filesystem::path& profileDirectory,
            const std::filesystem::path& profileOverwriteRoot,
            const std::filesystem::path& whiteoutRoot,
            const std::filesystem::path& supersededProfileStateRoot,
            std::wstring_view profileName)
        {
            const bool hasProfileEntries = directoryHasEntries(profileDirectory);
            const std::vector<std::filesystem::path> saveDirectories =
                collectProfileSaveDirectories(
                    profilesDirectory,
                    profileDirectory,
                    rules.saveDirectoryNames);
            if (!hasProfileEntries && saveDirectories.empty())
            {
                return;
            }

            const std::filesystem::path profileOverwrite =
                profileOverwriteRoot / safePathSegment(std::wstring(profileName), L"Default");
            const std::vector<std::wstring> ownedFiles = profileOwnedFileNames(rules);
            for (const GameVfsMountRule& rule : contentRules.mountRules)
            {
                const std::filesystem::path target = resolveVfsMountTarget(rule, gameDirectory);
                if (rule.sourceKind == GameVfsMountSourceKind::ProfileSettings && hasProfileEntries)
                {
                    const std::filesystem::path mountOverwrite = rule.overwritePath.empty()
                        ? profileOverwrite
                        : profileOverwrite / rule.overwritePath;
                    quarantineSupersededOwnedFiles(
                        logger,
                        mountOverwrite,
                        supersededProfileStateRoot /
                            safePathSegment(std::wstring(profileName), L"Default") /
                            rule.id,
                        ownedFiles);
                    const std::size_t originalSize = mounts.size();
                    appendProfileSettingsMount(
                        mounts,
                        target,
                        mountOverwrite,
                        profileDirectory,
                        ownedFiles);
                    if (mounts.size() != originalSize)
                    {
                        mounts.back().whiteoutRoot = whiteoutRoot / rule.id;
                    }
                }
                else if (rule.sourceKind == GameVfsMountSourceKind::ProfileSaves)
                {
                    const std::filesystem::path saveOverwrite = rule.overwritePath.empty()
                        ? profileSaveOverwriteDirectory(
                            profilesDirectory,
                            profileDirectory,
                            rules.saveDirectoryNames)
                        : profileDirectory / rule.overwritePath;
                    appendProfileSavesMount(
                        mounts,
                        target,
                        saveOverwrite,
                        saveDirectories,
                        whiteoutRoot / rule.id);
                }
            }
        }

#ifdef FLUXORA_ENABLE_VFS
        void writePathArray(JsonWriter& writer, const std::vector<std::filesystem::path>& paths)
        {
            writer.beginArray();
            for (const std::filesystem::path& path : paths)
            {
                writer.value(path.wstring());
            }
            writer.endArray();
        }

        void writeMount(JsonWriter& writer, const VfsMountDescriptor& mount)
        {
            writer.beginObject();
            writer.field(vfs::protocol::fields::target, mount.target.wstring());
            writer.field(vfs::protocol::fields::overwrite, mount.overwrite.wstring());
            writer.key(vfs::protocol::fields::mods);
            writePathArray(writer, mount.mods);
            writer.stringArray(vfs::protocol::fields::excludedRootNames, mount.excludedRootNames);
            writer.field(vfs::protocol::fields::whiteoutRoot, mount.whiteoutRoot.wstring());
            writer.stringArray(vfs::protocol::fields::ownedFiles, mount.ownedFiles);
            writer.endObject();
        }

        std::wstring buildDescriptor(
            const std::filesystem::path& logPath,
            const std::filesystem::path& hookDll,
            std::uint32_t managerProcessId,
            std::wstring_view operationId,
            std::uint32_t preparationMs,
            const std::vector<VfsMountDescriptor>& mounts)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(vfs::protocol::fields::schemaVersion, vfs::protocol::schemaVersion);
            writer.field(vfs::protocol::fields::logPath, logPath.wstring());
            writer.field(vfs::protocol::fields::hookDll, hookDll.wstring());
            writer.field(
                vfs::protocol::fields::managerProcessId,
                static_cast<std::uintmax_t>(managerProcessId));
            writer.field(vfs::protocol::fields::operationId, operationId);
            writer.field(
                vfs::protocol::fields::preparationMs,
                static_cast<std::uintmax_t>(preparationMs));

            if (!mounts.empty())
            {
                writer.field(vfs::protocol::fields::target, mounts.front().target.wstring());
                writer.field(vfs::protocol::fields::overwrite, mounts.front().overwrite.wstring());
                writer.key(vfs::protocol::fields::mods);
                writePathArray(writer, mounts.front().mods);
            }

            writer.key(vfs::protocol::fields::mounts).beginArray();
            for (const VfsMountDescriptor& mount : mounts)
            {
                writeMount(writer, mount);
            }
            writer.endArray();
            writer.endObject();
            return writer.str();
        }
#endif
    }

    VirtualFileSystemService::VirtualFileSystemService(
        Logger& logger,
        ExecutableService& executables,
        BodySlideIntegrationService& bodySlideIntegration,
        LodGeneratorIntegrationService& lodGeneratorIntegration,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          executables_(executables),
          bodySlideIntegration_(bodySlideIntegration),
          lodGeneratorIntegration_(lodGeneratorIntegration),
          pathSettings_(pathSettings)
    {
    }

    void VirtualFileSystemService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        initialized_ = true;
        logger_.write(LogLevel::Info, "Virtual file system service initialized.");
    }

    void VirtualFileSystemService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        initialized_ = false;
        logger_.write(LogLevel::Info, "Virtual file system service shut down.");
    }

    GameExecutableLaunchResult VirtualFileSystemService::launchExecutable(
        const std::filesystem::path& configPath,
        std::wstring_view executableId,
        std::wstring_view profileName,
        std::wstring_view additionalArguments) const
    {
        const auto launchStartedAt = std::chrono::steady_clock::now();
        const std::wstring managerVfsEnvironmentBefore =
            readEnvironmentVariable(L"FLUXORA_VFS_CONFIG");
        ResolvedExecutableLaunch resolved =
            executables_.resolveExecutable(configPath, executableId, profileName, additionalArguments);
        const bool isManagedBodySlide =
            resolved.executable.managedToolKind == bodySlideManagedToolKind;
        const bool isManagedLodGenerator =
            resolved.executable.managedToolKind == texGenManagedToolKind ||
            resolved.executable.managedToolKind == dynDoLodManagedToolKind;
        const auto executableResolvedAt = std::chrono::steady_clock::now();
        logger_.writeOperation(
            LogLevel::Info,
            "VfsDiagnostics",
            "vfsOperation requested selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                "\", executableId=\"" + toUtf8(std::wstring(executableId.begin(), executableId.end())) +
                "\", executablePath=\"" + toUtf8(resolved.resolvedExecutablePath.wstring()) + "\".");

#if !defined(FLUXORA_ENABLE_VFS) || !defined(_WIN32)
        // A Windows MO2-style build must not degrade to a plain launch: that hides
        // missing VFS packaging and lets transferred builds crash inside the game.
        const std::string reason =
            "virtual file system support is not compiled into this Fluxora build.";
        logger_.writeOperation(
            LogLevel::Error,
            "VfsDiagnostics",
            "vfsOperation failed selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                "\", unsupportedCapabilityError=\"" + reason + "\".");
        if (isManagedBodySlide)
        {
            throw BodySlideIntegrationError(
                L"BODYSLIDE_VFS_UNAVAILABLE",
                "BodySlide requires Fluxora VFS, but VFS support is unavailable on this platform.");
        }
        if (isManagedLodGenerator)
        {
            throw LodGeneratorIntegrationError(
                L"LOD_GENERATOR_VFS_UNAVAILABLE",
                "TexGen and DynDOLOD require Fluxora VFS, but VFS support is unavailable on this platform.");
        }
        throw std::runtime_error(
            "Virtual file system launch failed: " + reason +
            " Rebuild the Windows package with FLUXORA_ENABLE_VFS=ON and FluxoraVfs.dll bundled next to FluxoraCore.dll.");
#else
        std::optional<BodySlideLaunchPreparation> bodySlidePreparation;
        std::optional<LodGeneratorLaunchPreparation> lodGeneratorPreparation;
        ManagedLaunchLeaseGuard<BodySlideIntegrationService> bodySlideLease(
            bodySlideIntegration_);
        ManagedLaunchLeaseGuard<LodGeneratorIntegrationService> lodGeneratorLease(
            lodGeneratorIntegration_);
        const auto fallbackPlainLaunch = [&](const std::string& reason) -> GameExecutableLaunchResult
        {
            if (isManagedBodySlide)
            {
                throw BodySlideIntegrationError(
                    L"BODYSLIDE_VFS_UNAVAILABLE",
                    "BodySlide requires a successful VFS launch: " + reason);
            }
            if (isManagedLodGenerator)
            {
                throw LodGeneratorIntegrationError(
                    L"LOD_GENERATOR_VFS_UNAVAILABLE",
                    "TexGen and DynDOLOD require a successful VFS launch: " + reason);
            }
            logger_.write(LogLevel::Warning, "Launching without the virtual file system: " + reason);
            logger_.writeOperation(
                LogLevel::Warning,
                "VfsDiagnostics",
                "vfsOperation fallback selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                    "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                    "\", appliedVfsRules=\"" +
                    vfsRulesSummary(resolved.vfsRules.has_value() ? &resolved.vfsRules->rules : nullptr) +
                    "\", reason=\"" + reason + "\".");
            return executables_.launchProjectExecutable(
                configPath,
                executableId,
                profileName,
                additionalArguments);
        };
        const auto failVfsLaunch = [&](const std::string& reason) -> GameExecutableLaunchResult
        {
            logger_.write(LogLevel::Error, "Virtual file system launch failed: " + reason);
            logger_.writeOperation(
                LogLevel::Error,
                "VfsDiagnostics",
                "vfsOperation failed selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                    "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                    "\", appliedVfsRules=\"" +
                    vfsRulesSummary(resolved.vfsRules.has_value() ? &resolved.vfsRules->rules : nullptr) +
                    "\", unsupportedCapabilityError=\"" + reason + "\".");
            if (isManagedBodySlide)
            {
                throw BodySlideIntegrationError(
                    L"BODYSLIDE_VFS_UNAVAILABLE",
                    "BodySlide VFS launch failed: " + reason);
            }
            if (isManagedLodGenerator)
            {
                throw LodGeneratorIntegrationError(
                    L"LOD_GENERATOR_VFS_UNAVAILABLE",
                    "TexGen or DynDOLOD VFS launch failed: " + reason);
            }
            throw std::runtime_error("Virtual file system launch failed: " + reason);
        };

        if (resolved.gamePath.empty() || !std::filesystem::exists(resolved.gamePath))
        {
            return failVfsLaunch("the build has no valid game path.");
        }

        const GameVfsRules* rules = resolved.vfsRules.has_value()
            ? &resolved.vfsRules->rules
            : nullptr;
        const ContentLayoutSupportRules* contentRules = resolved.contentLayoutRules.has_value()
            ? &resolved.contentLayoutRules.value()
            : nullptr;
        if (!resolved.gameCapabilities.has(GameCapability::GameSpecificVfs) || rules == nullptr)
        {
            return failVfsLaunch("the selected game does not support virtual file system launches.");
        }
        if (!resolved.gameCapabilities.has(GameCapability::ContentLayoutRules) || contentRules == nullptr)
        {
            return failVfsLaunch("the selected game does not provide content layout rules for VFS placement.");
        }
        if (contentRules->dataFolder.empty())
        {
            return failVfsLaunch("the selected game content layout does not define a data directory.");
        }

        if ((!rules->userSettingsDirectoryName.empty() || !rules->profileIniFileNames.empty()) &&
            !resolved.gameCapabilities.has(GameCapability::IniProfiles))
        {
            return failVfsLaunch("the selected game defines profile INI mounts but the INI profile capability is disabled.");
        }
        if (!rules->saveDirectoryNames.empty() &&
            !resolved.gameCapabilities.has(GameCapability::SaveProfiles))
        {
            return failVfsLaunch("the selected game defines save mounts but the save profile capability is disabled.");
        }

        const std::wstring dataDirectory = contentRules->dataFolder;
        const std::wstring rootBuilderDirectoryName = rules->rootBuilderDirectoryName;
        const bool rootBuilderEnabled =
            rules->supportsRootBuilder &&
            !rootBuilderDirectoryName.empty() &&
            contentRules->supportsRootFiles &&
            resolved.gameCapabilities.has(GameCapability::RootFiles);
        logger_.writeOperation(
            LogLevel::Info,
            "VfsDiagnostics",
            "vfsOperation applyingRules selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                "\", appliedVfsRules=\"" + vfsRulesSummary(rules) +
                "\", rootBuilderEnabled=" + std::to_string(rootBuilderEnabled ? 1 : 0) +
                ", dataDirectory=\"" + toUtf8(dataDirectory) + "\".");
        if (rules->supportsRootBuilder && rootBuilderDirectoryName.empty())
        {
            return failVfsLaunch("the selected game enables Root Builder but does not define its root directory name.");
        }

        std::wstring profile(profileName);
        if (profile.empty())
        {
            profile = resolved.defaultProfile.empty() ? L"Default" : resolved.defaultProfile;
        }
        if (isManagedBodySlide)
        {
            bodySlidePreparation = bodySlideIntegration_.prepareLaunch(
                configPath,
                resolved,
                profile);
            bodySlideLease.arm(bodySlidePreparation->sessionId);
        }
        else if (isManagedLodGenerator)
        {
            lodGeneratorPreparation = lodGeneratorIntegration_.prepareLaunch(
                configPath,
                resolved,
                profile);
            resolved.commandLine = lodGeneratorPreparation->commandLine;
            lodGeneratorLease.arm(lodGeneratorPreparation->sessionId);
        }
        std::vector<VfsActiveMod> activeMods;
        std::vector<ExecutableLaunchMod>& launchMods =
            bodySlidePreparation.has_value()
            ? bodySlidePreparation->activeProfileMods
            : lodGeneratorPreparation.has_value()
                ? lodGeneratorPreparation->activeProfileMods
                : resolved.activeProfileMods;
        activeMods.reserve(launchMods.size());
        for (ExecutableLaunchMod& mod : launchMods)
        {
            activeMods.push_back(VfsActiveMod{
                std::move(mod.path),
                std::move(mod.name),
                std::move(mod.contentFingerprint)
            });
        }
        VfsGameRootMountPlan gameRootPlan = buildVfsGameRootMountPlan(
            logger_,
            std::move(activeMods),
            pathSettings_,
            resolved.projectDirectory,
            resolved.gamePath,
            profile,
            resolved.gameCapabilities,
            *resolved.vfsRules,
            *contentRules);
        const auto mountPlanReadyAt = std::chrono::steady_clock::now();
        const std::vector<VfsActiveMod>& mods = gameRootPlan.activeMods;
        const std::vector<std::filesystem::path>& dataMods = gameRootPlan.dataMods;
        const std::vector<std::filesystem::path>& rootMods = gameRootPlan.rootMods;
        std::vector<VfsMountDescriptor> mounts = std::move(gameRootPlan.mounts);
        const std::filesystem::path overwrite = pathSettings_.overwriteDirectory(resolved.projectDirectory);
        const std::filesystem::path vfsDirectory = resolved.projectDirectory / L".flow" / L"vfs";
        const std::filesystem::path rootOverwrite = overwrite / rootBuilderDirectoryName;

        const std::filesystem::path launchCacheRoot = resolved.rootBuilderLaunchCacheDirectory;
        if (rootBuilderEnabled && !launchCacheRoot.empty())
        {
            const std::filesystem::path launchCacheDataTarget = launchCacheRoot / dataDirectory;
            std::vector<std::wstring> launchCacheDataExcluded{
                L".flow",
                dataDirectory,
                rootBuilderDirectoryName
            };

            std::vector<std::filesystem::path> launchCacheDataMods;
            if (isDirectory(resolved.gamePath / dataDirectory))
            {
                launchCacheDataMods.push_back(resolved.gamePath / dataDirectory);
            }
            launchCacheDataMods.insert(
                launchCacheDataMods.end(),
                dataMods.begin(),
                dataMods.end());

            if (!launchCacheDataMods.empty() || isDirectory(overwrite))
            {
                mounts.push_back(VfsMountDescriptor{
                    launchCacheDataTarget,
                    overwrite,
                    launchCacheDataMods,
                    launchCacheDataExcluded,
                    {},
                    vfsDirectory / L"whiteouts" / L"primary-content"
                });
            }

            mounts.push_back(VfsMountDescriptor{
                launchCacheRoot,
                rootOverwrite,
                {},
                std::vector<std::wstring>{dataDirectory},
                {},
                vfsDirectory / L"whiteouts" / L"game-root"
            });
        }

        const std::filesystem::path profilesDirectory =
            pathSettings_.profilesDirectory(resolved.projectDirectory);
        const std::filesystem::path profileDirectory =
            profilesDirectory / std::filesystem::path(profile);
        if (rules != nullptr)
        {
            appendGameProfileSettingsMounts(
                logger_,
                mounts,
                *rules,
                *contentRules,
                resolved.gamePath,
                profilesDirectory,
                profileDirectory,
                vfsDirectory / L"profile-overwrite",
                vfsDirectory / L"whiteouts",
                vfsDirectory / L"superseded-profile-state",
                profile);
        }
        if (bodySlidePreparation.has_value())
        {
            bodySlideIntegration_.applyVfsPolicy(
                mounts,
                resolved,
                *bodySlidePreparation);
        }
        if (lodGeneratorPreparation.has_value())
        {
            lodGeneratorIntegration_.applyVfsPolicy(
                mounts,
                *lodGeneratorPreparation);
        }
        const auto finalMountsReadyAt = std::chrono::steady_clock::now();

        if (mounts.empty())
        {
            return fallbackPlainLaunch("no enabled mods or profile files to virtualize.");
        }

        logger_.writeOperation(
            LogLevel::Info,
            "VfsDiagnostics",
            "vfsOperation mountPlan selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                "\", mounts=" + std::to_string(mounts.size()) +
                ", dataMods=" + std::to_string(dataMods.size()) +
                ", rootMods=" + std::to_string(rootMods.size()) + ".");

        const std::filesystem::path hookDll = hookDllPath();
        if (hookDll.empty() || !std::filesystem::exists(hookDll))
        {
            return failVfsLaunch("FluxoraVfs.dll was not found next to FluxoraCore.dll.");
        }

        const std::filesystem::path logPath = vfsDirectory / L"vfs.log";
        const std::uint32_t managerProcessId = GetCurrentProcessId();
        const std::filesystem::path sessionsDirectory = vfsDirectory / L"sessions";
        const std::wstring sessionId = launchSessionId();
        const std::filesystem::path descriptorPath =
            sessionsDirectory /
            (L"vfs-config-" + std::to_wstring(managerProcessId) + L"-" + sessionId + L".json");
        const std::string operationIdUtf8 = Logger::operationId();
        const std::wstring operationId = operationIdUtf8.empty()
            ? L"vfs-" + sessionId
            : std::wstring(operationIdUtf8.begin(), operationIdUtf8.end());
        const auto preparationDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - launchStartedAt).count();
        const std::uint32_t preparationMs = static_cast<std::uint32_t>(
            (std::min)(
                preparationDuration,
                static_cast<decltype(preparationDuration)>(
                    (std::numeric_limits<std::uint32_t>::max)())));
        const std::string descriptorContent =
            toUtf8(buildDescriptor(
                logPath,
                hookDll,
                managerProcessId,
                operationId,
                preparationMs,
                mounts));

        const PathSafetyService pathSafety;
        const PathSafetyResult vfsDirectorySafety =
            pathSafety.validateWritePath(resolved.projectDirectory, vfsDirectory);
        if (!vfsDirectorySafety.safe())
        {
            return failVfsLaunch(
                "unsafe VFS directory " + toUtf8(vfsDirectory.wstring()) +
                " (" + pathSafetyErrorForLog(vfsDirectorySafety) + ").");
        }

        const PathSafetyResult sessionsDirectorySafety =
            pathSafety.validateWritePath(vfsDirectory, sessionsDirectory);
        if (!sessionsDirectorySafety.safe())
        {
            return failVfsLaunch(
                "unsafe VFS sessions directory " + toUtf8(sessionsDirectory.wstring()) +
                " (" + pathSafetyErrorForLog(sessionsDirectorySafety) + ").");
        }

        PathSafetyWriteOptions descriptorWriteOptions;
        descriptorWriteOptions.requiredBytes = descriptorContent.size();
        const PathSafetyResult descriptorSafety =
            pathSafety.validateWritePath(vfsDirectory, descriptorPath, descriptorWriteOptions);
        if (!descriptorSafety.safe())
        {
            return failVfsLaunch(
                "unsafe VFS descriptor path " + toUtf8(descriptorPath.wstring()) +
                " (" + pathSafetyErrorForLog(descriptorSafety) + ").");
        }

        const PathSafetyResult logPathSafety =
            pathSafety.validateWritePath(vfsDirectory, logPath);
        if (!logPathSafety.safe())
        {
            return failVfsLaunch(
                "unsafe VFS log path " + toUtf8(logPath.wstring()) +
                " (" + pathSafetyErrorForLog(logPathSafety) + ").");
        }

        std::error_code error;
        for (const VfsMountDescriptor& mount : mounts)
        {
            if (!mount.overwrite.empty())
            {
                const PathSafetyResult overwriteSafety =
                    pathSafety.validateDirectoryWriteRoot(mount.overwrite);
                if (!overwriteSafety.safe())
                {
                    return failVfsLaunch(
                        "unsafe VFS overwrite path " + toUtf8(mount.overwrite.wstring()) +
                        " (" + pathSafetyErrorForLog(overwriteSafety) + ").");
                }

                error.clear();
                std::filesystem::create_directories(mount.overwrite, error);
                if (error)
                {
                    return failVfsLaunch(
                        "could not create VFS overwrite path " + toUtf8(mount.overwrite.wstring()) +
                        " (" + describeWin32Error(static_cast<DWORD>(error.value())) + ").");
                }
            }
        }
        error.clear();
        std::filesystem::create_directories(sessionsDirectory, error);
        if (error)
        {
            return failVfsLaunch(
                "could not create VFS directory " + toUtf8(vfsDirectory.wstring()) +
                " (" + describeWin32Error(static_cast<DWORD>(error.value())) + ").");
        }
        pruneDeadManagerLaunchDescriptors(sessionsDirectory, managerProcessId);

        for (const VfsMountDescriptor& mount : mounts)
        {
            logger_.write(
                LogLevel::Info,
                "VFS mount prepared: target=\"" + toUtf8(mount.target.wstring()) +
                    "\", overwrite=\"" + toUtf8(mount.overwrite.wstring()) +
                    "\", mods=" + std::to_string(mount.mods.size()) +
                    ", excluded=" + std::to_string(mount.excludedRootNames.size()) + ".");
        }

        writeNewTextFile(
            descriptorPath,
            descriptorContent);
        ScopedFileCleanup descriptorCleanup(descriptorPath);

        std::vector<wchar_t> childEnvironment;
        try
        {
            childEnvironment = vfs::environment::currentWithVariable(
                vfs::protocol::configEnvironmentVariable,
                descriptorPath.wstring());
        }
        catch (const std::exception& exception)
        {
            return failVfsLaunch(
                std::string("could not prepare the child process environment: ") + exception.what());
        }

        std::wstring commandLine = resolved.commandLine;
        if (resolved.requiresParallaxGenMo2VfsCompatibilityFlag &&
            !containsIgnoreCase(commandLine, parallaxGenIgnoreMo2VfsCheckArgument))
        {
            commandLine.push_back(L' ');
            commandLine.append(parallaxGenIgnoreMo2VfsCheckArgument);
            logger_.writeOperation(
                LogLevel::Info,
                "ParallaxGen",
                "Applied PGPatcher MO2 compatibility launch flag for Fluxora VFS.");
        }

        std::vector<wchar_t> commandLineBuffer(commandLine.begin(), commandLine.end());
        commandLineBuffer.push_back(L'\0');
        const std::string hookDllAnsi = toAnsi(hookDll.wstring());

        STARTUPINFOW startupInfo{};
        startupInfo.cb = sizeof(startupInfo);
        PROCESS_INFORMATION processInformation{};
        const auto processCreateStartedAt = std::chrono::steady_clock::now();

        const BOOL started = DetourCreateProcessWithDllExW(
            resolved.resolvedExecutablePath.c_str(),
            commandLineBuffer.data(),
            nullptr,
            nullptr,
            FALSE,
            CREATE_DEFAULT_ERROR_MODE | CREATE_UNICODE_ENVIRONMENT,
            childEnvironment.data(),
            resolved.resolvedWorkingDirectory.c_str(),
            &startupInfo,
            &processInformation,
            hookDllAnsi.c_str(),
            nullptr);
        const auto processCreatedAt = std::chrono::steady_clock::now();

        if (!started)
        {
            const DWORD launchError = GetLastError();
            return failVfsLaunch(
                ("the game could not be started with the hook injected. Win32 error: " +
                 describeWin32Error(launchError) + "."));
        }
        descriptorCleanup.release();
        const bool managerEnvironmentUnchanged =
            readEnvironmentVariable(L"FLUXORA_VFS_CONFIG") == managerVfsEnvironmentBefore;

        const DWORD processId = processInformation.dwProcessId;
        if (bodySlidePreparation.has_value())
        {
            try
            {
                bodySlideIntegration_.bindProcess(
                    bodySlidePreparation->sessionId,
                    static_cast<std::uint32_t>(processId));
                bodySlideLease.release();
            }
            catch (...)
            {
                TerminateProcess(processInformation.hProcess, ERROR_PROCESS_ABORTED);
                CloseHandle(processInformation.hThread);
                CloseHandle(processInformation.hProcess);
                throw;
            }
        }
        else if (lodGeneratorPreparation.has_value())
        {
            try
            {
                lodGeneratorIntegration_.bindProcess(
                    lodGeneratorPreparation->sessionId,
                    static_cast<std::uint32_t>(processId));
                lodGeneratorLease.release();
            }
            catch (...)
            {
                TerminateProcess(processInformation.hProcess, ERROR_PROCESS_ABORTED);
                CloseHandle(processInformation.hThread);
                CloseHandle(processInformation.hProcess);
                throw;
            }
        }
        CloseHandle(processInformation.hThread);
        CloseHandle(processInformation.hProcess);

        logger_.write(
            LogLevel::Info,
            "Game launched through the virtual file system (" + std::to_string(mods.size()) +
                " active mods, " + std::to_string(mounts.size()) + " mounts).");
        logger_.writeOperation(
            LogLevel::Info,
            "VfsDiagnostics",
            "vfsOperation completed selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                "\", appliedVfsRules=\"" + vfsRulesSummary(rules) +
                "\", processId=" + std::to_string(static_cast<std::uint32_t>(processId)) +
                ", descriptorPath=\"" + toUtf8(descriptorPath.wstring()) + "\"" +
                ", managerEnvironmentUnchanged=" +
                std::to_string(managerEnvironmentUnchanged ? 1 : 0) +
                ", mounts=" + std::to_string(mounts.size()) +
                ", activeMods=" + std::to_string(mods.size()) + ".");
        const auto elapsedMicroseconds = [](const auto start, const auto end)
        {
            return std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();
        };
        logger_.writeOperation(
            LogLevel::Info,
            "Performance",
            "launchTiming resolveExecutableUs=" +
                std::to_string(elapsedMicroseconds(launchStartedAt, executableResolvedAt)) +
                ", mountPlanUs=" +
                std::to_string(elapsedMicroseconds(executableResolvedAt, mountPlanReadyAt)) +
                ", postMountPreparationUs=" +
                std::to_string(elapsedMicroseconds(mountPlanReadyAt, finalMountsReadyAt)) +
                ", descriptorPreparationUs=" +
                std::to_string(elapsedMicroseconds(finalMountsReadyAt, processCreateStartedAt)) +
                ", detourCreateProcessUs=" +
                std::to_string(elapsedMicroseconds(processCreateStartedAt, processCreatedAt)) +
                ", totalUs=" +
                std::to_string(elapsedMicroseconds(launchStartedAt, processCreatedAt)) + ".");

        GameExecutableLaunchResult result{
            resolved.executable,
            resolved.resolvedExecutablePath,
            resolved.resolvedWorkingDirectory,
            resolved.launchTrackingKind,
            resolved.expectedChildProcessNames,
            resolved.handoffDisplayName,
            resolved.handoffTimeoutMs,
            static_cast<std::uint32_t>(processId),
            managerEnvironmentUnchanged
        };
        if (bodySlidePreparation.has_value())
        {
            result.managedSessionId = bodySlidePreparation->sessionId;
            result.managedToolKind = std::wstring(bodySlideManagedToolKind);
            result.outputMod = bodySlidePreparation->outputMod;
            result.configurationStatus = bodySlidePreparation->configurationStatus;
            result.warnings = bodySlidePreparation->warnings;
        }
        else if (lodGeneratorPreparation.has_value())
        {
            result.managedSessionId = lodGeneratorPreparation->sessionId;
            result.managedToolKind = lodGeneratorPreparation->managedToolKind;
            result.outputMod = lodGeneratorPreparation->outputMod;
            result.configurationStatus = lodGeneratorPreparation->configurationStatus;
            result.warnings = lodGeneratorPreparation->warnings;
        }
        return result;
#endif
    }

    bool VirtualFileSystemService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
