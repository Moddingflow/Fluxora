#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "FluxoraCore/Services/InstallOperationStore.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Services/ModIdentityResolver.hpp"
#include "FluxoraCore/Support/FilesystemPath.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <ctime>
#include <cwctype>
#include <exception>
#include <fstream>
#include <iomanip>
#include <iterator>
#include <limits>
#include <map>
#include <mutex>
#include <optional>
#include <random>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <thread>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#endif

#ifndef _WIN32

namespace fluxora
{
    void InstanceMetadataStore::ensureInstance(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::wstring InstanceMetadataStore::gameId(
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::beginProjectActivation(
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    ArchiveBuildStatus InstanceMetadataStore::archiveBuildStatus(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::beginArchiveInstallAttempt(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::completeArchiveInstallAttempt(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        std::wstring_view,
        ArchiveModLinkMode)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::failArchiveInstallAttempt(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::beginPendingInstallSession(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        InstallConflictPreviewMode,
        std::wstring_view,
        std::wstring_view,
        int)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    PendingInstallSessionRecord InstanceMetadataStore::preparePendingInstallSession(
        const std::filesystem::path&,
        std::wstring_view,
        const std::vector<InstallConflictFile>&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    PendingInstallSessionRecord InstanceMetadataStore::rebasePendingInstallSession(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        std::wstring_view,
        int)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    PendingInstallSessionRecord InstanceMetadataStore::completePendingInstallSession(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    PendingInstallSessionRecord InstanceMetadataStore::failPendingInstallSession(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    PendingInstallSessionRecord InstanceMetadataStore::pendingInstallSession(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<PendingInstallSessionRecord> InstanceMetadataStore::activePendingInstallSessions(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    FinalizedPendingInstallRecord InstanceMetadataStore::finalizePendingInstalledMod(
        const std::filesystem::path&,
        std::wstring_view,
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        const ModSourceRecord&,
        const PendingInstallFinalizationMetadata&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
    void InstanceMetadataStore::resetSqlPrepareCountForTesting()
    {
    }

    std::uint64_t InstanceMetadataStore::sqlPrepareCountForTesting()
    {
        return 0;
    }

    void InstanceMetadataStore::resetSqlExecCountForTesting()
    {
    }

    std::uint64_t InstanceMetadataStore::sqlExecCountForTesting()
    {
        return 0;
    }

    void InstanceMetadataStore::resetInventorySyncCountForTesting()
    {
    }

    std::uint64_t InstanceMetadataStore::inventorySyncCountForTesting()
    {
        return 0;
    }

    void InstanceMetadataStore::setFileCacheScanFailureAfterEntriesForTesting(int)
    {
    }

    void InstanceMetadataStore::setPendingInstallFinalizeFailureForTesting(bool)
    {
    }

    void InstanceMetadataStore::withMetadataLockForTesting(const std::function<void()>& action)
    {
        if (action)
        {
            action();
        }
    }

    void InstanceMetadataStore::resetStableMetadataHandleOpenCountForTesting()
    {
    }

    std::uint64_t InstanceMetadataStore::stableMetadataHandleOpenCountForTesting()
    {
        return 0;
    }
#endif

    std::vector<InstalledModRecord> InstanceMetadataStore::listInstalledMods(
        const std::filesystem::path&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    ModIdentityCatalogSnapshot InstanceMetadataStore::queryModIdentityCandidates(
        const std::filesystem::path&,
        const ModIdentityCatalogQuery&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::recordModIdentity(
        const std::filesystem::path&,
        const ModIdentityPersistenceUpdate&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::optional<ModIdentityContentCacheRecord> InstanceMetadataStore::modIdentityContentCache(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::recordModIdentityContentCache(
        const std::filesystem::path&,
        std::wstring_view,
        const ModIdentityContentCacheRecord&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::optional<ModIdentityOnlineCacheRecord> InstanceMetadataStore::modIdentityOnlineCache(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        std::wstring_view,
        std::wstring_view,
        std::wstring_view,
        std::uintmax_t)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::recordModIdentityOnlineCache(
        const std::filesystem::path&,
        std::wstring_view,
        const ModIdentityOnlineCacheRecord&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::uint64_t InstanceMetadataStore::modCatalogRevision(const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::optional<InstalledModRecord> InstanceMetadataStore::installedModByUuid(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::refreshInstalledModsFromDisk(
        const std::filesystem::path&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::invalidateModFileCaches(
        const std::filesystem::path&,
        const std::vector<std::filesystem::path>&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::listProfileOrderItems(
        const std::filesystem::path&,
        std::wstring_view,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<std::wstring> InstanceMetadataStore::listProfileNames(
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::ensureProfileState(
        const std::filesystem::path&,
        std::wstring_view,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::cloneProfileState(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::renameProfileState(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::deleteProfileState(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::createProfileOrderSeparator(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        int,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::deleteProfileOrderSeparator(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::moveProfileOrderItem(
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        int,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::replaceProfileOrderItems(
        const std::filesystem::path&,
        std::wstring_view,
        const std::vector<ProfileOrderImportItemRecord>&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ProfilePluginOrderItemRecord> InstanceMetadataStore::listProfilePluginOrderItems(
        const std::filesystem::path&,
        std::wstring_view,
        const std::vector<std::wstring>&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::replaceProfilePluginOrderItems(
        const std::filesystem::path&,
        std::wstring_view,
        const std::vector<ProfilePluginOrderImportItemRecord>&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ProfilePluginOrderItemRecord> InstanceMetadataStore::createProfilePluginOrderSeparator(
        const std::filesystem::path&,
        std::wstring_view,
        const std::vector<std::wstring>&,
        std::wstring_view,
        int)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ProfilePluginOrderItemRecord> InstanceMetadataStore::deleteProfilePluginOrderSeparator(
        const std::filesystem::path&,
        std::wstring_view,
        const std::vector<std::wstring>&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ProfilePluginOrderItemRecord> InstanceMetadataStore::moveProfilePluginOrderItem(
        const std::filesystem::path&,
        std::wstring_view,
        const std::vector<std::wstring>&,
        std::wstring_view,
        int)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    InstalledModRecord InstanceMetadataStore::registerInstalledMod(
        const std::filesystem::path&,
        const std::filesystem::path&,
        std::wstring_view,
        std::wstring_view,
        const ModSourceRecord&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    InstalledModRecord InstanceMetadataStore::renameInstalledMod(
        const std::filesystem::path&,
        const std::filesystem::path&,
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::deleteInstalledMod(
        const std::filesystem::path&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::recordRemoteCheck(
        const std::filesystem::path&,
        const RemoteCheckRecord&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::optional<ModUpdateSweepRecord> InstanceMetadataStore::modUpdateSweep(
        const std::filesystem::path&,
        std::wstring_view)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    void InstanceMetadataStore::recordModUpdateSweep(
        const std::filesystem::path&,
        const ModUpdateSweepRecord&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    ModFileSummary InstanceMetadataStore::summarizeModFiles(
        const std::filesystem::path&,
        const std::filesystem::path&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ModFileSummaryRecord> InstanceMetadataStore::summarizeInstalledModFiles(
        const std::filesystem::path&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ModFileSummaryRecord> InstanceMetadataStore::summarizePersistedInstalledModFiles(
        const std::filesystem::path&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    PersistedInstalledModsSnapshot InstanceMetadataStore::persistedInstalledModsSnapshot(
        const std::filesystem::path&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ModFileSummaryRecord> InstanceMetadataStore::summarizeProfileModFiles(
        const std::filesystem::path&,
        std::wstring_view,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ModFileSummaryRecord> InstanceMetadataStore::summarizeCachedProfileModFilesForLaunch(
        const std::filesystem::path&,
        std::wstring_view,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    std::vector<ModFileTreeEntry> InstanceMetadataStore::listModFileTree(
        const std::filesystem::path&,
        const std::filesystem::path&,
        std::wstring_view,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    ModDetailsContent InstanceMetadataStore::getModDetailsContent(
        const std::filesystem::path&,
        const std::filesystem::path&,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }

    ModConflictTreePage InstanceMetadataStore::listModConflictTree(
        const std::filesystem::path&,
        const std::filesystem::path&,
        std::wstring_view,
        int,
        const std::filesystem::path&)
    {
        throw std::runtime_error("Fluxora instance metadata storage requires SQLite on Windows.");
    }
}

#else

struct sqlite3;
struct sqlite3_stmt;

namespace fluxora
{
    namespace
    {
        constexpr int sqliteOk = 0;
        constexpr int sqliteRow = 100;
        constexpr int sqliteDone = 101;
        constexpr std::wstring_view manifestDirectoryName = L".flow";
        constexpr std::wstring_view manifestFileName = L"manifest.json";
        constexpr std::wstring_view fallbackProfileName = L"Default";
        constexpr std::wstring_view profileOrderModKind = L"mod";
        constexpr std::wstring_view profileOrderSeparatorKind = L"separator";
        constexpr std::size_t maxProfileOrderSeparatorTitleLength = 255;
        constexpr std::wstring_view profilePluginOrderPluginKind = L"plugin";
        constexpr std::wstring_view profilePluginOrderSeparatorKind = L"separator";
        constexpr std::wstring_view modInventoryRevisionKey = L"mod_inventory_revision";
        constexpr std::wstring_view generatedPgPatcherProvider = L"generated-pgpatcher";
        constexpr int instanceDatabaseSchemaVersion = 12;
        constexpr int fileCacheSchemaVersion = 2;

        using SqliteDestructor = void (*)(void*);

#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
        std::atomic<std::uint64_t> sqlitePrepareCountForTesting{0};
        std::atomic<std::uint64_t> sqliteExecCountForTesting{0};
        std::atomic<std::uint64_t> inventorySyncInvocationCount{0};
        std::atomic<int> fileCacheScanFailureAfterEntriesForTesting{-1};
        std::atomic<bool> pendingInstallFinalizeFailureForTesting{false};
        std::atomic<std::uint64_t> stableMetadataHandleOpenCounterForTesting{0};
#endif

        std::mutex& metadataStoreMutex()
        {
            static std::mutex mutex;
            return mutex;
        }

        struct FileCacheValidationState
        {
            std::wstring activeProjectKey;
            std::uint64_t activationGeneration{0};
            std::uint64_t validatedGeneration{0};
            std::uint64_t launchInventoryValidatedGeneration{0};
        };

        struct ProjectGameIdCacheState
        {
            struct FileStamp
            {
                bool readable{false};
                bool exists{false};
                std::uintmax_t size{0};
                std::filesystem::file_time_type writeTime{};

                bool operator==(const FileStamp&) const = default;
            };

            struct DatabaseStamp
            {
                FileStamp database;
                FileStamp wal;

                bool operator==(const DatabaseStamp&) const = default;
            };

            std::wstring projectKey;
            std::wstring gameId;
            DatabaseStamp databaseStamp;
            bool valid{false};
        };

        FileCacheValidationState& fileCacheValidationState()
        {
            static FileCacheValidationState state;
            return state;
        }

        std::mutex& projectGameIdCacheMutex()
        {
            static std::mutex mutex;
            return mutex;
        }

        ProjectGameIdCacheState& projectGameIdCacheState()
        {
            static ProjectGameIdCacheState state;
            return state;
        }

        std::wstring normalizedProjectKey(const std::filesystem::path& projectDirectory)
        {
            std::wstring value = std::filesystem::absolute(projectDirectory).lexically_normal().wstring();
            std::transform(
                value.begin(),
                value.end(),
                value.begin(),
                [](wchar_t character)
                {
                    return static_cast<wchar_t>(std::towlower(character));
                });
            return value;
        }

        ProjectGameIdCacheState::FileStamp projectGameIdFileStamp(
            const std::filesystem::path& path)
        {
            ProjectGameIdCacheState::FileStamp stamp;
            std::error_code error;
            const bool exists = std::filesystem::exists(path, error);
            if (!exists && error == std::errc::no_such_file_or_directory)
            {
                error.clear();
            }
            if (error)
            {
                return stamp;
            }
            if (!exists)
            {
                stamp.readable = true;
                return stamp;
            }
            stamp.exists = std::filesystem::is_regular_file(path, error);
            if (error || !stamp.exists)
            {
                return stamp;
            }
            if (stamp.exists)
            {
                stamp.size = std::filesystem::file_size(path, error);
                if (error)
                {
                    return stamp;
                }
                stamp.writeTime = std::filesystem::last_write_time(path, error);
                if (error)
                {
                    return stamp;
                }
            }
            stamp.readable = true;
            return stamp;
        }

        ProjectGameIdCacheState::DatabaseStamp projectGameIdDatabaseStamp(
            const std::filesystem::path& projectDirectory)
        {
            const std::filesystem::path database = projectDirectory / L"instance.db";
            return {
                projectGameIdFileStamp(database),
                projectGameIdFileStamp(database.wstring() + L"-wal")
            };
        }

        std::optional<std::wstring> cachedProjectGameId(
            const std::filesystem::path& projectDirectory)
        {
            const std::lock_guard cacheLock(projectGameIdCacheMutex());
            const ProjectGameIdCacheState& state = projectGameIdCacheState();
            if (!state.valid || state.projectKey != normalizedProjectKey(projectDirectory))
            {
                return std::nullopt;
            }
            const ProjectGameIdCacheState::DatabaseStamp currentStamp =
                projectGameIdDatabaseStamp(projectDirectory);
            if (
                !currentStamp.database.readable ||
                !currentStamp.wal.readable ||
                currentStamp != state.databaseStamp)
            {
                return std::nullopt;
            }
            return state.gameId;
        }

        void cacheProjectGameId(
            const std::filesystem::path& projectDirectory,
            std::wstring gameId)
        {
            const std::lock_guard cacheLock(projectGameIdCacheMutex());
            ProjectGameIdCacheState& state = projectGameIdCacheState();
            state.projectKey = normalizedProjectKey(projectDirectory);
            state.gameId = std::move(gameId);
            state.databaseStamp = projectGameIdDatabaseStamp(projectDirectory);
            state.valid = true;
        }

        void beginFileCacheActivationLocked(const std::filesystem::path& projectDirectory)
        {
            FileCacheValidationState& state = fileCacheValidationState();
            const std::wstring key = normalizedProjectKey(projectDirectory);
            if (state.activeProjectKey == key)
            {
                return;
            }
            state.activeProjectKey = key;
            ++state.activationGeneration;
            state.validatedGeneration = 0;
            state.launchInventoryValidatedGeneration = 0;
        }

        bool fileCacheValidationRequiredLocked(const std::filesystem::path& projectDirectory)
        {
            beginFileCacheActivationLocked(projectDirectory);
            const FileCacheValidationState& state = fileCacheValidationState();
            return state.validatedGeneration != state.activationGeneration;
        }

        void markFileCacheValidatedLocked(const std::filesystem::path& projectDirectory)
        {
            beginFileCacheActivationLocked(projectDirectory);
            FileCacheValidationState& state = fileCacheValidationState();
            state.validatedGeneration = state.activationGeneration;
        }

        bool launchInventoryReconciliationRequiredLocked(
            const std::filesystem::path& projectDirectory)
        {
            beginFileCacheActivationLocked(projectDirectory);
            const FileCacheValidationState& state = fileCacheValidationState();
            return state.launchInventoryValidatedGeneration != state.activationGeneration;
        }

        void markLaunchInventoryReconciledLocked(
            const std::filesystem::path& projectDirectory)
        {
            beginFileCacheActivationLocked(projectDirectory);
            FileCacheValidationState& state = fileCacheValidationState();
            state.launchInventoryValidatedGeneration = state.activationGeneration;
        }

        void invalidateLaunchInventoryReconciliationLocked(
            const std::filesystem::path& projectDirectory)
        {
            FileCacheValidationState& state = fileCacheValidationState();
            if (state.activeProjectKey == normalizedProjectKey(projectDirectory))
            {
                state.launchInventoryValidatedGeneration = 0;
            }
        }

        std::string toUtf8(const std::wstring& value)
        {
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            if (size <= 0)
            {
                throw std::runtime_error("Failed to encode text as UTF-8.");
            }

            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size,
                nullptr,
                nullptr);
            return out;
        }

        std::wstring fromUtf8(const std::string& value)
        {
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
                throw std::invalid_argument("Metadata manifest is not valid UTF-8.");
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
        }

        std::string readTextFile(const std::filesystem::path& path)
        {
            std::ifstream file(path, std::ios::in | std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to open metadata manifest.");
            }

            file.seekg(0, std::ios::end);
            const std::streamoff size = file.tellg();
            if (size <= 0)
            {
                return {};
            }

            file.seekg(0, std::ios::beg);
            std::string content(static_cast<std::size_t>(size), '\0');
            file.read(content.data(), static_cast<std::streamsize>(size));
            content.resize(static_cast<std::size_t>(file.gcount()));
            return content;
        }

        void recoverMetadataManifest(const std::filesystem::path& path)
        {
            static_cast<void>(AtomicFileStore().recoverFile(
                path,
                AtomicFileWriteOptions{
                    L"generated mod metadata",
                    ProjectStateValidation::JsonObject
                }));
        }

        void writeTextFile(const std::filesystem::path& path, const std::string& content)
        {
            AtomicFileStore().writeTextFile(
                path,
                content,
                AtomicFileWriteOptions{
                    L"generated mod metadata",
                    ProjectStateValidation::JsonObject,
                    {},
                    false
                });
        }

        std::wstring nowUtcText()
        {
            const auto now = std::chrono::system_clock::now();
            const std::time_t time = std::chrono::system_clock::to_time_t(now);

            std::tm utc{};
            gmtime_s(&utc, &time);

            std::wostringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
        }

        std::wstring generateUuid()
        {
            std::array<unsigned char, 16> bytes{};
            std::random_device random;
            for (auto& byte : bytes)
            {
                byte = static_cast<unsigned char>(random());
            }

            bytes[6] = static_cast<unsigned char>((bytes[6] & 0x0F) | 0x40);
            bytes[8] = static_cast<unsigned char>((bytes[8] & 0x3F) | 0x80);

            std::wostringstream stream;
            stream << std::hex << std::setfill(L'0');
            for (std::size_t index = 0; index < bytes.size(); ++index)
            {
                if (index == 4 || index == 6 || index == 8 || index == 10)
                {
                    stream << L'-';
                }

                stream << std::setw(2) << static_cast<int>(bytes[index]);
            }

            return stream.str();
        }

        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
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

        std::wstring profileNameOrDefault(std::wstring_view profileName)
        {
            std::wstring normalized = trim(std::wstring(profileName));
            return normalized.empty() ? std::wstring(fallbackProfileName) : normalized;
        }

        std::wstring normalizeRelativePath(const std::filesystem::path& path)
        {
            return path.generic_wstring();
        }

        std::wstring pathKey(std::wstring_view relativePath)
        {
            return toLower(std::wstring(relativePath));
        }

        std::filesystem::path instanceDatabasePath(const std::filesystem::path& projectDirectory)
        {
            return projectDirectory / L"instance.db";
        }

        std::filesystem::path modsDirectory(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& configuredDirectory = {})
        {
            return configuredDirectory.empty()
                ? projectDirectory / L"mods"
                : configuredDirectory;
        }

        std::filesystem::path manifestPathForMod(const std::filesystem::path& modDirectory)
        {
            return modDirectory / std::filesystem::path(manifestDirectoryName) /
                std::filesystem::path(manifestFileName);
        }

        std::wstring readStringOrDefault(
            const JsonValue& object,
            std::wstring_view field,
            std::wstring_view fallback = L"")
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || value->isNull())
            {
                return std::wstring(fallback);
            }

            if (!value->isString())
            {
                return std::wstring(fallback);
            }

            return value->asString();
        }

        bool readBoolOrDefault(
            const JsonValue& object,
            std::wstring_view field,
            bool fallback = false)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || value->isNull())
            {
                return fallback;
            }

            if (value->type() == JsonValue::Type::Boolean)
            {
                return value->asBoolean();
            }

            if (value->isNumber())
            {
                return value->asNumber() != L"0";
            }

            if (value->isString())
            {
                const std::wstring text = toLower(trim(value->asString()));
                return text == L"true" || text == L"1" || text == L"yes";
            }

            return fallback;
        }

        ModSourceRecord readSourceFromManifest(const JsonValue& object)
        {
            const JsonValue* source = object.find(L"source");
            if (source == nullptr || !source->isObject())
            {
                return {};
            }

            return ModSourceRecord{
                readStringOrDefault(*source, L"provider"),
                readStringOrDefault(*source, L"gameDomain"),
                readStringOrDefault(*source, L"remoteModId"),
                readStringOrDefault(*source, L"remoteFileId"),
                readStringOrDefault(*source, L"url"),
                readStringOrDefault(*source, L"lastCheckedAt"),
                readStringOrDefault(*source, L"latestVersion"),
                readStringOrDefault(*source, L"latestFileId"),
                readStringOrDefault(*source, L"updateCheckState"),
                readStringOrDefault(*source, L"lastAttemptedAt")
            };
        }

        std::optional<InstalledModRecord> readManifestRecord(
            const std::filesystem::path& modDirectory)
        {
            const std::filesystem::path path = manifestPathForMod(modDirectory);
            recoverMetadataManifest(path);
            if (!std::filesystem::exists(path))
            {
                return std::nullopt;
            }

            const JsonValue root = JsonReader::parse(fromUtf8(readTextFile(path)));
            if (!root.isObject())
            {
                return std::nullopt;
            }

            InstalledModRecord record;
            if (const JsonValue* schemaVersion = root.find(L"schemaVersion"); schemaVersion != nullptr)
            {
                try
                {
                    if (schemaVersion->isNumber())
                    {
                        record.portableManifestSchemaVersion = std::stoi(schemaVersion->asNumber());
                    }
                    else if (schemaVersion->isString())
                    {
                        record.portableManifestSchemaVersion = std::stoi(schemaVersion->asString());
                    }
                }
                catch (const std::exception&)
                {
                    record.portableManifestSchemaVersion = 0;
                }
            }
            record.uuid = readStringOrDefault(root, L"modUuid");
            record.gameId = readStringOrDefault(root, L"gameId");
            record.folderName = readStringOrDefault(root, L"folderName", modDirectory.filename().wstring());
            record.displayName = readStringOrDefault(root, L"displayName", record.folderName);
            record.version = readStringOrDefault(root, L"version");
            record.installedAt = readStringOrDefault(root, L"installedAt");
            record.updatedAt = readStringOrDefault(root, L"updatedAt");
            record.state = readStringOrDefault(root, L"state", L"installed");
            record.contentFingerprint = readStringOrDefault(root, L"contentFingerprint");
            record.sourceIsNexus = readBoolOrDefault(root, L"sourceIsNexus");
            record.sourceIsModdingFlow = readBoolOrDefault(root, L"sourceIsModdingFlow");
            record.isLocal = readBoolOrDefault(root, L"isLocal");
            record.isTranslation = readBoolOrDefault(root, L"isTranslation");
            record.isPatch = readBoolOrDefault(root, L"isPatch");
            record.path = modDirectory;
            record.source = readSourceFromManifest(root);
            if (const JsonValue* identity = root.find(L"identity"); identity != nullptr && identity->isObject())
            {
                record.fomodModuleId = readStringOrDefault(*identity, L"fomodModuleId");
                if (const JsonValue* aliases = identity->find(L"aliases"); aliases != nullptr && aliases->isArray())
                {
                    for (const JsonValue& alias : aliases->asArray())
                    {
                        if (alias.isString())
                        {
                            record.identityAliases.push_back(alias.asString());
                        }
                    }
                }
                if (const JsonValue* exclusions = identity->find(L"excludedModUuids");
                    exclusions != nullptr && exclusions->isArray())
                {
                    for (const JsonValue& exclusion : exclusions->asArray())
                    {
                        if (exclusion.isString())
                        {
                            record.identityExcludedModUuids.push_back(exclusion.asString());
                        }
                    }
                }
            }
            return record;
        }

        bool portableManifestNeedsWrite(const InstalledModRecord& record, bool stateChanged)
        {
            if (toLower(trim(record.source.provider)) == std::wstring(generatedPgPatcherProvider))
            {
                return false;
            }

            if (stateChanged)
            {
                return true;
            }

            try
            {
                const std::optional<InstalledModRecord> manifestRecord = readManifestRecord(record.path);
                return !manifestRecord.has_value() ||
                    manifestRecord->portableManifestSchemaVersion < 2 ||
                    manifestRecord->state != record.state;
            }
            catch (const std::exception&)
            {
                return true;
            }
        }

        bool portableManifestNeedsBulkWrite(const InstalledModRecord& record, bool stateChanged)
        {
            return portableManifestNeedsWrite(record, stateChanged);
        }

        std::wstring computeContentFingerprint(const std::filesystem::path& modDirectory);

        bool containsToken(std::wstring_view value, std::wstring_view token)
        {
            return toLower(std::wstring(value)).find(toLower(std::wstring(token))) != std::wstring::npos;
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        bool providerIsModdingFlow(std::wstring_view provider)
        {
            const std::wstring normalized = toLower(std::wstring(provider));
            return normalized == L"moddingflow" ||
                normalized == L"modding-flow" ||
                normalized == L"modernflow" ||
                normalized == L"modern-flow";
        }

        std::wstring normalizeProvider(ModSourceRecord source)
        {
            if (!source.provider.empty())
            {
                const std::wstring provider = toLower(trim(source.provider));
                if (provider == L"nexus")
                {
                    return L"nexus";
                }
                if (providerIsModdingFlow(provider))
                {
                    return L"moddingflow";
                }
                if (provider == L"local")
                {
                    return L"local";
                }
                if (provider == L"manual")
                {
                    return L"manual";
                }

                return trim(source.provider);
            }

            if (!source.gameDomain.empty() || !source.remoteModId.empty() || !source.remoteFileId.empty())
            {
                return L"nexus";
            }

            return source.url.empty() ? L"local" : L"manual";
        }

        bool sourceLooksNexus(const ModSourceRecord& source)
        {
            const std::wstring provider = toLower(normalizeProvider(source));
            return provider == L"nexus" ||
                containsToken(source.url, L"nexusmods.com") ||
                toLower(source.url).starts_with(L"nxm://") ||
                !source.gameDomain.empty() ||
                !source.remoteModId.empty() ||
                !source.remoteFileId.empty();
        }

        bool sourceLooksModdingFlow(const ModSourceRecord& source)
        {
            const std::wstring provider = normalizeProvider(source);
            return providerIsModdingFlow(provider) ||
                containsToken(source.url, L"moddingflow") ||
                containsToken(source.url, L"modernflow");
        }

        bool textLooksTranslation(std::wstring_view text)
        {
            return containsToken(text, L"translation") ||
                containsToken(text, L"translated") ||
                containsToken(text, L"localization") ||
                containsToken(text, L"localisation") ||
                containsToken(text, L"language pack") ||
                containsToken(text, L"russian") ||
                containsToken(text, L"english") ||
                containsToken(text, L"german") ||
                containsToken(text, L"deutsch") ||
                containsToken(text, L"перевод") ||
                containsToken(text, L"локализац");
        }

        bool textLooksPatch(std::wstring_view text)
        {
            return containsToken(text, L"patch") ||
                containsToken(text, L"compatibility") ||
                containsToken(text, L"compat") ||
                containsToken(text, L"fix") ||
                containsToken(text, L"hotfix") ||
                containsToken(text, L"патч") ||
                containsToken(text, L"исправлен");
        }

        void deriveModFlags(InstalledModRecord& record)
        {
            record.source.provider = normalizeProvider(record.source);
            record.sourceIsNexus = record.sourceIsNexus || sourceLooksNexus(record.source);
            record.sourceIsModdingFlow = record.sourceIsModdingFlow || sourceLooksModdingFlow(record.source);

            const bool hasRemoteIdentity = record.sourceIsNexus ||
                record.sourceIsModdingFlow ||
                !record.source.remoteModId.empty() ||
                !record.source.remoteFileId.empty() ||
                (!record.source.url.empty() && !equalsIgnoreCase(record.source.provider, L"local"));
            record.isLocal = record.isLocal ||
                equalsIgnoreCase(record.source.provider, L"local") ||
                (!hasRemoteIdentity && record.source.url.empty());

            const std::wstring searchable =
                record.folderName + L" " +
                record.displayName + L" " +
                record.source.url + L" " +
                record.source.provider;
            record.isTranslation = record.isTranslation || textLooksTranslation(searchable);
            record.isPatch = record.isPatch || textLooksPatch(searchable);
        }

        class SqliteApi final
        {
        public:
            using Open16Fn = int (__cdecl *)(const void*, sqlite3**);
            using CloseFn = int (__cdecl *)(sqlite3*);
            using ExecFn = int (__cdecl *)(sqlite3*, const char*, int (*)(void*, int, char**, char**), void*, char**);
            using PrepareFn = int (__cdecl *)(sqlite3*, const char*, int, sqlite3_stmt**, const char**);
            using StepFn = int (__cdecl *)(sqlite3_stmt*);
            using ResetFn = int (__cdecl *)(sqlite3_stmt*);
            using FinalizeFn = int (__cdecl *)(sqlite3_stmt*);
            using ClearBindingsFn = int (__cdecl *)(sqlite3_stmt*);
            using BindText16Fn = int (__cdecl *)(sqlite3_stmt*, int, const void*, int, SqliteDestructor);
            using BindIntFn = int (__cdecl *)(sqlite3_stmt*, int, int);
            using BindInt64Fn = int (__cdecl *)(sqlite3_stmt*, int, long long);
            using BindNullFn = int (__cdecl *)(sqlite3_stmt*, int);
            using ColumnText16Fn = const void* (__cdecl *)(sqlite3_stmt*, int);
            using ColumnBytes16Fn = int (__cdecl *)(sqlite3_stmt*, int);
            using ColumnIntFn = int (__cdecl *)(sqlite3_stmt*, int);
            using ColumnInt64Fn = long long (__cdecl *)(sqlite3_stmt*, int);
            using LastInsertRowIdFn = long long (__cdecl *)(sqlite3*);
            using ErrmsgFn = const char* (__cdecl *)(sqlite3*);
            using BusyTimeoutFn = int (__cdecl *)(sqlite3*, int);
            using FreeFn = void (__cdecl *)(void*);

            SqliteApi()
            {
                module_ = LoadLibraryW(L"winsqlite3.dll");
                if (module_ == nullptr)
                {
                    throw std::runtime_error("winsqlite3.dll is not available.");
                }

                open16 = load<Open16Fn>("sqlite3_open16");
                close = load<CloseFn>("sqlite3_close");
                exec = load<ExecFn>("sqlite3_exec");
                prepare = load<PrepareFn>("sqlite3_prepare_v2");
                step = load<StepFn>("sqlite3_step");
                reset = load<ResetFn>("sqlite3_reset");
                finalize = load<FinalizeFn>("sqlite3_finalize");
                clearBindings = load<ClearBindingsFn>("sqlite3_clear_bindings");
                bindText16 = load<BindText16Fn>("sqlite3_bind_text16");
                bindInt = load<BindIntFn>("sqlite3_bind_int");
                bindInt64 = load<BindInt64Fn>("sqlite3_bind_int64");
                bindNull = load<BindNullFn>("sqlite3_bind_null");
                columnText16 = load<ColumnText16Fn>("sqlite3_column_text16");
                columnBytes16 = load<ColumnBytes16Fn>("sqlite3_column_bytes16");
                columnInt = load<ColumnIntFn>("sqlite3_column_int");
                columnInt64 = load<ColumnInt64Fn>("sqlite3_column_int64");
                lastInsertRowId = load<LastInsertRowIdFn>("sqlite3_last_insert_rowid");
                errmsg = load<ErrmsgFn>("sqlite3_errmsg");
                busyTimeout = load<BusyTimeoutFn>("sqlite3_busy_timeout");
                free = load<FreeFn>("sqlite3_free");
            }

            ~SqliteApi()
            {
                if (module_ != nullptr)
                {
                    FreeLibrary(module_);
                }
            }

            SqliteApi(const SqliteApi&) = delete;
            SqliteApi& operator=(const SqliteApi&) = delete;

            Open16Fn open16{};
            CloseFn close{};
            ExecFn exec{};
            PrepareFn prepare{};
            StepFn step{};
            ResetFn reset{};
            FinalizeFn finalize{};
            ClearBindingsFn clearBindings{};
            BindText16Fn bindText16{};
            BindIntFn bindInt{};
            BindInt64Fn bindInt64{};
            BindNullFn bindNull{};
            ColumnText16Fn columnText16{};
            ColumnBytes16Fn columnBytes16{};
            ColumnIntFn columnInt{};
            ColumnInt64Fn columnInt64{};
            LastInsertRowIdFn lastInsertRowId{};
            ErrmsgFn errmsg{};
            BusyTimeoutFn busyTimeout{};
            FreeFn free{};

        private:
            template <typename T>
            T load(const char* name)
            {
                FARPROC address = GetProcAddress(module_, name);
                if (address == nullptr)
                {
                    throw std::runtime_error("winsqlite3.dll is missing a required SQLite entry point.");
                }

                return reinterpret_cast<T>(address);
            }

            HMODULE module_{nullptr};
        };

        SqliteApi& sqlite()
        {
            static SqliteApi api;
            return api;
        }

        constexpr int sqliteBusyTimeoutMs = 15000;

        std::string sqliteError(sqlite3* handle)
        {
            const char* message = sqlite().errmsg(handle);
            return message == nullptr ? "SQLite error." : std::string(message);
        }

        class Statement final
        {
        public:
            Statement(sqlite3* handle, const char* sql)
                : handle_(handle)
            {
#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
                sqlitePrepareCountForTesting.fetch_add(1, std::memory_order_relaxed);
#endif
                const int result = sqlite().prepare(handle_, sql, -1, &statement_, nullptr);
                if (result != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            ~Statement()
            {
                finalize();
            }

            Statement(const Statement&) = delete;
            Statement& operator=(const Statement&) = delete;

            void bindText(int index, std::wstring_view value)
            {
                const int result = sqlite().bindText16(
                    statement_,
                    index,
                    value.data(),
                    static_cast<int>(value.size() * sizeof(wchar_t)),
                    reinterpret_cast<SqliteDestructor>(-1));
                if (result != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            void bindInt(int index, int value)
            {
                const int result = sqlite().bindInt(statement_, index, value);
                if (result != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            void bindInt64(int index, std::int64_t value)
            {
                const int result = sqlite().bindInt64(statement_, index, static_cast<long long>(value));
                if (result != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            void bindNull(int index)
            {
                const int result = sqlite().bindNull(statement_, index);
                if (result != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            bool stepRow()
            {
                const int result = sqlite().step(statement_);
                if (result == sqliteRow)
                {
                    return true;
                }
                if (result == sqliteDone)
                {
                    finalize();
                    return false;
                }

                throw std::runtime_error(sqliteError(handle_));
            }

            void stepDone()
            {
                const int result = sqlite().step(statement_);
                if (result != sqliteDone)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }

                finalize();
            }

            void stepDoneAndReset()
            {
                const int result = sqlite().step(statement_);
                if (result != sqliteDone)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }

                const int resetResult = sqlite().reset(statement_);
                if (resetResult != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
                const int clearResult = sqlite().clearBindings(statement_);
                if (clearResult != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            std::wstring columnText(int index) const
            {
                const void* text = sqlite().columnText16(statement_, index);
                if (text == nullptr)
                {
                    return {};
                }

                const int bytes = sqlite().columnBytes16(statement_, index);
                return std::wstring(
                    static_cast<const wchar_t*>(text),
                    static_cast<std::size_t>(bytes / sizeof(wchar_t)));
            }

            int columnInt(int index) const
            {
                return sqlite().columnInt(statement_, index);
            }

            std::int64_t columnInt64(int index) const
            {
                return static_cast<std::int64_t>(sqlite().columnInt64(statement_, index));
            }

            std::int64_t lastInsertRowId() const
            {
                return static_cast<std::int64_t>(sqlite().lastInsertRowId(handle_));
            }

        private:
            void finalize() noexcept
            {
                if (statement_ != nullptr)
                {
                    sqlite().finalize(statement_);
                    statement_ = nullptr;
                }
            }

            sqlite3* handle_{nullptr};
            sqlite3_stmt* statement_{nullptr};
        };

        class Database final
        {
        public:
            explicit Database(const std::filesystem::path& path)
            {
                const std::wstring text = path.wstring();
                const int result = sqlite().open16(text.c_str(), &handle_);
                if (result != sqliteOk)
                {
                    std::string message = handle_ == nullptr
                        ? "Failed to open instance database."
                        : sqliteError(handle_);
                    if (handle_ != nullptr)
                    {
                        sqlite().close(handle_);
                        handle_ = nullptr;
                    }

                    throw std::runtime_error(message);
                }

                const int timeoutResult = sqlite().busyTimeout(handle_, sqliteBusyTimeoutMs);
                if (timeoutResult != sqliteOk)
                {
                    std::string message = sqliteError(handle_);
                    sqlite().close(handle_);
                    handle_ = nullptr;
                    throw std::runtime_error(message);
                }
            }

            ~Database()
            {
                if (handle_ != nullptr)
                {
                    sqlite().close(handle_);
                }
            }

            Database(const Database&) = delete;
            Database& operator=(const Database&) = delete;
            Database(Database&& other) noexcept
                : handle_(std::exchange(other.handle_, nullptr))
            {
            }

            Database& operator=(Database&& other) noexcept
            {
                if (this != &other)
                {
                    if (handle_ != nullptr)
                    {
                        sqlite().close(handle_);
                    }

                    handle_ = std::exchange(other.handle_, nullptr);
                }

                return *this;
            }

            void exec(const char* sql)
            {
#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
                sqliteExecCountForTesting.fetch_add(1, std::memory_order_relaxed);
#endif
                char* error = nullptr;
                const int result = sqlite().exec(handle_, sql, nullptr, nullptr, &error);
                if (result != sqliteOk)
                {
                    std::string message = error == nullptr ? sqliteError(handle_) : std::string(error);
                    if (error != nullptr)
                    {
                        sqlite().free(error);
                    }

                    throw std::runtime_error(message);
                }
            }

            [[nodiscard]] Statement prepare(const char* sql)
            {
                return Statement(handle_, sql);
            }

        private:
            sqlite3* handle_{nullptr};
        };

        class Transaction final
        {
        public:
            explicit Transaction(Database& database)
                : database_(database)
            {
                database_.exec("BEGIN IMMEDIATE;");
            }

            ~Transaction()
            {
                if (!committed_)
                {
                    try
                    {
                        database_.exec("ROLLBACK;");
                    }
                    catch (...)
                    {
                    }
                }
            }

            Transaction(const Transaction&) = delete;
            Transaction& operator=(const Transaction&) = delete;

            void commit()
            {
                database_.exec("COMMIT;");
                committed_ = true;
            }

        private:
            Database& database_;
            bool committed_{false};
        };

        bool columnExists(Database& database, const char* tableName, std::wstring_view columnName)
        {
            std::string sql = "PRAGMA table_info(";
            sql += tableName;
            sql += ");";
            Statement statement = database.prepare(sql.c_str());
            while (statement.stepRow())
            {
                if (statement.columnText(1) == columnName)
                {
                    return true;
                }
            }

            return false;
        }

        void ensureColumn(
            Database& database,
            const char* tableName,
            std::wstring_view columnName,
            const char* columnDefinition)
        {
            if (columnExists(database, tableName, columnName))
            {
                return;
            }

            std::string sql = "ALTER TABLE ";
            sql += tableName;
            sql += " ADD COLUMN ";
            sql += columnDefinition;
            sql += ";";
            database.exec(sql.c_str());
        }

        void ensureSchema(Database& database)
        {
            int persistedVersion = 0;
            {
                Statement version = database.prepare("PRAGMA user_version;");
                persistedVersion = version.stepRow() ? version.columnInt(0) : 0;
            }
            if (persistedVersion > instanceDatabaseSchemaVersion)
            {
                throw std::runtime_error(
                    "The instance database was created by a newer Fluxora version.");
            }

            database.exec("PRAGMA foreign_keys = ON;");
            database.exec("PRAGMA journal_mode = WAL;");
            database.exec("PRAGMA synchronous = NORMAL;");
            if (persistedVersion == instanceDatabaseSchemaVersion)
            {
                return;
            }

            database.exec(
                "CREATE TABLE IF NOT EXISTS instance_metadata ("
                "key TEXT PRIMARY KEY NOT NULL,"
                "value TEXT NOT NULL"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mods ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "uuid TEXT NOT NULL UNIQUE,"
                "game_id TEXT NOT NULL DEFAULT '',"
                "folder_name TEXT NOT NULL UNIQUE,"
                "display_name TEXT NOT NULL,"
                "version TEXT NOT NULL DEFAULT '',"
                "installed_at TEXT NOT NULL,"
                "updated_at TEXT NOT NULL,"
                "state TEXT NOT NULL DEFAULT 'installed',"
                "content_fingerprint TEXT NOT NULL DEFAULT '',"
                "source_is_nexus INTEGER NOT NULL DEFAULT 0,"
                "source_is_moddingflow INTEGER NOT NULL DEFAULT 0,"
                "is_local INTEGER NOT NULL DEFAULT 0,"
                "is_translation INTEGER NOT NULL DEFAULT 0,"
                "is_patch INTEGER NOT NULL DEFAULT 0"
                ");");
            ensureColumn(database, "mods", L"source_is_nexus", "source_is_nexus INTEGER NOT NULL DEFAULT 0");
            ensureColumn(database, "mods", L"source_is_moddingflow", "source_is_moddingflow INTEGER NOT NULL DEFAULT 0");
            ensureColumn(database, "mods", L"is_local", "is_local INTEGER NOT NULL DEFAULT 0");
            ensureColumn(database, "mods", L"is_translation", "is_translation INTEGER NOT NULL DEFAULT 0");
            ensureColumn(database, "mods", L"is_patch", "is_patch INTEGER NOT NULL DEFAULT 0");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_sources ("
                "mod_id INTEGER PRIMARY KEY NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "provider TEXT NOT NULL DEFAULT 'manual',"
                "game_domain TEXT NOT NULL DEFAULT '',"
                "remote_mod_id TEXT NOT NULL DEFAULT '',"
                "remote_file_id TEXT NOT NULL DEFAULT '',"
                "url TEXT NOT NULL DEFAULT '',"
                "last_checked_at TEXT NOT NULL DEFAULT '',"
                "latest_version TEXT NOT NULL DEFAULT '',"
                "latest_file_id TEXT NOT NULL DEFAULT '',"
                "last_check_state TEXT NOT NULL DEFAULT '',"
                "last_attempted_at TEXT NOT NULL DEFAULT ''"
                ");");
            ensureColumn(database, "mod_sources", L"latest_file_id", "latest_file_id TEXT NOT NULL DEFAULT ''");
            ensureColumn(database, "mod_sources", L"last_check_state", "last_check_state TEXT NOT NULL DEFAULT ''");
            ensureColumn(database, "mod_sources", L"last_attempted_at", "last_attempted_at TEXT NOT NULL DEFAULT ''");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_identity_metadata ("
                "mod_id INTEGER PRIMARY KEY NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "fomod_module_id TEXT NOT NULL DEFAULT ''"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_identity_keys ("
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "key_kind TEXT NOT NULL,"
                "key_value TEXT NOT NULL,"
                "created_at TEXT NOT NULL DEFAULT '',"
                "PRIMARY KEY(mod_id, key_kind, key_value)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_identity_tokens ("
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "token TEXT NOT NULL,"
                "weight INTEGER NOT NULL DEFAULT 1,"
                "PRIMARY KEY(mod_id, token)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_identity_aliases ("
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "alias TEXT NOT NULL,"
                "normalized_alias TEXT NOT NULL,"
                "confirmed_at TEXT NOT NULL,"
                "PRIMARY KEY(mod_id, normalized_alias)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_identity_exclusions ("
                "owner_mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "source_key TEXT NOT NULL DEFAULT '',"
                "incoming_name_key TEXT NOT NULL DEFAULT '',"
                "rejected_mod_uuid TEXT NOT NULL,"
                "created_at TEXT NOT NULL,"
                "PRIMARY KEY(owner_mod_id, source_key, incoming_name_key, rejected_mod_uuid)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_identity_cache ("
                "archive_fingerprint TEXT PRIMARY KEY NOT NULL,"
                "provider TEXT NOT NULL DEFAULT '',"
                "game_domain TEXT NOT NULL DEFAULT '',"
                "remote_mod_id TEXT NOT NULL DEFAULT '',"
                "md5 TEXT NOT NULL DEFAULT '',"
                "sha256 TEXT NOT NULL DEFAULT '',"
                "archive_size INTEGER NOT NULL DEFAULT 0,"
                "content_json TEXT NOT NULL DEFAULT '{}',"
                "online_json TEXT NOT NULL DEFAULT '{}',"
                "checked_at TEXT NOT NULL DEFAULT ''"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_files ("
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "relative_path TEXT NOT NULL,"
                "parent_path TEXT NOT NULL DEFAULT '',"
                "path_key TEXT NOT NULL,"
                "parent_key TEXT NOT NULL DEFAULT '',"
                "name TEXT NOT NULL,"
                "kind TEXT NOT NULL,"
                "size INTEGER NOT NULL DEFAULT 0,"
                "modified_at TEXT NOT NULL DEFAULT '',"
                "PRIMARY KEY(mod_id, path_key)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_file_cache_state ("
                "mod_id INTEGER PRIMARY KEY NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "schema_version INTEGER NOT NULL,"
                "cache_key TEXT NOT NULL,"
                "entry_count INTEGER NOT NULL,"
                "validated_at TEXT NOT NULL"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_tags ("
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "tag TEXT NOT NULL,"
                "source TEXT NOT NULL DEFAULT 'system',"
                "created_at TEXT NOT NULL DEFAULT '',"
                "PRIMARY KEY(mod_id, tag)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_dependencies ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "dependency_kind TEXT NOT NULL DEFAULT 'required',"
                "target_provider TEXT NOT NULL DEFAULT '',"
                "target_mod_id TEXT NOT NULL DEFAULT '',"
                "target_file_id TEXT NOT NULL DEFAULT '',"
                "target_name TEXT NOT NULL DEFAULT '',"
                "constraint_text TEXT NOT NULL DEFAULT '',"
                "source TEXT NOT NULL DEFAULT 'system',"
                "created_at TEXT NOT NULL DEFAULT ''"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_conflicts ("
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "other_mod_id INTEGER REFERENCES mods(id) ON DELETE CASCADE,"
                "relative_path TEXT NOT NULL DEFAULT '',"
                "conflict_kind TEXT NOT NULL DEFAULT '',"
                "source TEXT NOT NULL DEFAULT 'scan',"
                "detected_at TEXT NOT NULL DEFAULT '',"
                "PRIMARY KEY(mod_id, other_mod_id, relative_path, conflict_kind)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_install_history ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,"
                "folder_name TEXT NOT NULL DEFAULT '',"
                "operation TEXT NOT NULL DEFAULT 'install',"
                "version TEXT NOT NULL DEFAULT '',"
                "source_provider TEXT NOT NULL DEFAULT '',"
                "source_url TEXT NOT NULL DEFAULT '',"
                "archive_path TEXT NOT NULL DEFAULT '',"
                "created_at TEXT NOT NULL,"
                "details_json TEXT NOT NULL DEFAULT '{}'"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS archive_mod_links ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "archive_sha256 TEXT NOT NULL,"
                "mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,"
                "mod_uuid TEXT NOT NULL,"
                "is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0, 1)),"
                "linked_at TEXT NOT NULL,"
                "unlinked_at TEXT NOT NULL DEFAULT '',"
                "operation_id TEXT NOT NULL DEFAULT ''"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS archive_install_attempts ("
                "operation_id TEXT PRIMARY KEY NOT NULL,"
                "archive_sha256 TEXT NOT NULL,"
                "target_folder_name TEXT NOT NULL DEFAULT '',"
                "started_at TEXT NOT NULL"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS pending_install_sessions ("
                "operation_id TEXT PRIMARY KEY NOT NULL,"
                "profile_name TEXT NOT NULL DEFAULT 'Default',"
                "mode INTEGER NOT NULL CHECK(mode IN (0, 1, 2)),"
                "target_mod_uuid TEXT NOT NULL DEFAULT '',"
                "target_position INTEGER NOT NULL DEFAULT -1,"
                "before_order_id TEXT NOT NULL DEFAULT '',"
                "after_order_id TEXT NOT NULL DEFAULT '',"
                "enqueue_sequence INTEGER NOT NULL DEFAULT 0,"
                "revision INTEGER NOT NULL DEFAULT 0,"
                "state TEXT NOT NULL CHECK(state IN ('preparing', 'ready', 'committing', 'completed', 'failed')),"
                "final_order_id TEXT NOT NULL DEFAULT '',"
                "pending_order_id TEXT NOT NULL,"
                "created_at TEXT NOT NULL,"
                "updated_at TEXT NOT NULL"
                ");");
            ensureColumn(database, "pending_install_sessions", L"before_order_id", "before_order_id TEXT NOT NULL DEFAULT ''");
            ensureColumn(database, "pending_install_sessions", L"after_order_id", "after_order_id TEXT NOT NULL DEFAULT ''");
            ensureColumn(database, "pending_install_sessions", L"enqueue_sequence", "enqueue_sequence INTEGER NOT NULL DEFAULT 0");
            database.exec(
                "CREATE TABLE IF NOT EXISTS pending_install_files ("
                "operation_id TEXT NOT NULL REFERENCES pending_install_sessions(operation_id) ON DELETE CASCADE,"
                "relative_path TEXT NOT NULL,"
                "parent_path TEXT NOT NULL DEFAULT '',"
                "path_key TEXT NOT NULL,"
                "parent_key TEXT NOT NULL DEFAULT '',"
                "name TEXT NOT NULL,"
                "kind TEXT NOT NULL DEFAULT 'file',"
                "size INTEGER NOT NULL DEFAULT 0,"
                "modified_at TEXT NOT NULL DEFAULT '',"
                "PRIMARY KEY(operation_id, path_key)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS install_operations ("
                "operation_id TEXT PRIMARY KEY NOT NULL,"
                "source_kind TEXT NOT NULL,"
                "source_path TEXT NOT NULL,"
                "archive_fingerprint TEXT NOT NULL DEFAULT '',"
                "profile_name TEXT NOT NULL DEFAULT 'Default',"
                "existing_mod_mode INTEGER NOT NULL DEFAULT 0,"
                "target_mod_uuid TEXT NOT NULL DEFAULT '',"
                "target_folder TEXT NOT NULL DEFAULT '',"
                "selected_option_ids_json TEXT NOT NULL DEFAULT '[]',"
                "manual_decisions_json TEXT NOT NULL DEFAULT '[]',"
                "placement_overrides_json TEXT NOT NULL DEFAULT '[]',"
                "identity_plan_json TEXT NOT NULL DEFAULT '{}',"
                "request_json TEXT NOT NULL DEFAULT '{}',"
                "before_order_id TEXT NOT NULL DEFAULT '',"
                "after_order_id TEXT NOT NULL DEFAULT '',"
                "enqueue_sequence INTEGER NOT NULL DEFAULT 0,"
                "state TEXT NOT NULL DEFAULT 'queued',"
                "stage TEXT NOT NULL DEFAULT 'queued',"
                "progress_percent INTEGER NOT NULL DEFAULT -1,"
                "indeterminate INTEGER NOT NULL DEFAULT 1,"
                "error_code TEXT NOT NULL DEFAULT '',"
                "error_message TEXT NOT NULL DEFAULT '',"
                "result_json TEXT NOT NULL DEFAULT '',"
                "created_at TEXT NOT NULL,"
                "updated_at TEXT NOT NULL"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_notes ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "note_text TEXT NOT NULL DEFAULT '',"
                "source TEXT NOT NULL DEFAULT 'user',"
                "created_at TEXT NOT NULL,"
                "updated_at TEXT NOT NULL"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS remote_cache ("
                "provider TEXT NOT NULL,"
                "game_domain TEXT NOT NULL DEFAULT '',"
                "remote_mod_id TEXT NOT NULL DEFAULT '',"
                "remote_file_id TEXT NOT NULL DEFAULT '',"
                "latest_version TEXT NOT NULL DEFAULT '',"
                "payload_json TEXT NOT NULL DEFAULT '',"
                "checked_at TEXT NOT NULL,"
                "PRIMARY KEY(provider, game_domain, remote_mod_id, remote_file_id)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_update_sweeps ("
                "game_domain TEXT PRIMARY KEY NOT NULL,"
                "state TEXT NOT NULL DEFAULT '',"
                "last_attempted_at TEXT NOT NULL DEFAULT '',"
                "last_completed_at TEXT NOT NULL DEFAULT '',"
                "baseline_completed_at TEXT NOT NULL DEFAULT '',"
                "next_eligible_at TEXT NOT NULL DEFAULT '',"
                "last_period TEXT NOT NULL DEFAULT '',"
                "backoff_step INTEGER NOT NULL DEFAULT 0,"
                "stop_reason TEXT NOT NULL DEFAULT ''"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_file_cache ("
                "mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,"
                "relative_path TEXT NOT NULL,"
                "parent_path TEXT NOT NULL DEFAULT '',"
                "path_key TEXT NOT NULL,"
                "parent_key TEXT NOT NULL DEFAULT '',"
                "name TEXT NOT NULL,"
                "kind TEXT NOT NULL,"
                "size INTEGER NOT NULL DEFAULT 0,"
                "modified_at TEXT NOT NULL DEFAULT '',"
                "PRIMARY KEY(mod_id, path_key)"
                ");");
            database.exec(
                "INSERT OR IGNORE INTO mod_files("
                "mod_id, relative_path, parent_path, path_key, parent_key, name, kind, size, modified_at"
                ") SELECT mod_id, relative_path, parent_path, path_key, parent_key, name, kind, size, modified_at "
                "FROM mod_file_cache;");
            database.exec(
                "CREATE TABLE IF NOT EXISTS profile_order_items ("
                "id TEXT PRIMARY KEY NOT NULL,"
                "profile_name TEXT NOT NULL DEFAULT 'Default',"
                "kind TEXT NOT NULL CHECK(kind IN ('mod', 'separator')),"
                "mod_id INTEGER REFERENCES mods(id) ON DELETE CASCADE,"
                "separator_title TEXT NOT NULL DEFAULT '',"
                "position INTEGER NOT NULL DEFAULT 0,"
                "created_at TEXT NOT NULL,"
                "updated_at TEXT NOT NULL,"
                "CHECK((kind = 'mod' AND mod_id IS NOT NULL) OR (kind = 'separator' AND mod_id IS NULL)),"
                "UNIQUE(profile_name, mod_id)"
                ");");
            database.exec(
                "CREATE TABLE IF NOT EXISTS profile_plugin_order_items ("
                "id TEXT PRIMARY KEY NOT NULL,"
                "profile_name TEXT NOT NULL DEFAULT 'Default',"
                "kind TEXT NOT NULL CHECK(kind IN ('plugin', 'separator')),"
                "plugin_name TEXT NOT NULL DEFAULT '',"
                "separator_title TEXT NOT NULL DEFAULT '',"
                "position INTEGER NOT NULL DEFAULT 0,"
                "created_at TEXT NOT NULL,"
                "updated_at TEXT NOT NULL,"
                "CHECK((kind = 'plugin' AND plugin_name <> '') OR (kind = 'separator' AND plugin_name = ''))"
                ");");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mods_state ON mods(state);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mods_display_name ON mods(display_name COLLATE NOCASE);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_sources_remote ON mod_sources(provider, game_domain, remote_mod_id, remote_file_id);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_identity_keys_lookup ON mod_identity_keys(key_kind, key_value, mod_id);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_identity_tokens_lookup ON mod_identity_tokens(token, mod_id);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_identity_aliases_lookup ON mod_identity_aliases(normalized_alias, mod_id);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_identity_exclusions_lookup ON mod_identity_exclusions(source_key, incoming_name_key, rejected_mod_uuid);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_identity_cache_source ON mod_identity_cache(provider, game_domain, remote_mod_id, checked_at);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_files_path ON mod_files(path_key);");
            database.exec(
                "CREATE INDEX IF NOT EXISTS idx_mod_files_relative_path "
                "ON mod_files(mod_id, relative_path COLLATE NOCASE);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_files_parent ON mod_files(mod_id, parent_key, kind, name COLLATE NOCASE);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_tags_tag ON mod_tags(tag COLLATE NOCASE);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_dependencies_target ON mod_dependencies(target_provider, target_mod_id, target_file_id);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_conflicts_path ON mod_conflicts(relative_path COLLATE NOCASE);");
            database.exec(
                "CREATE INDEX IF NOT EXISTS idx_mod_conflicts_mod_path_source "
                "ON mod_conflicts(mod_id, relative_path COLLATE NOCASE, source);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_install_history_mod ON mod_install_history(mod_id, created_at);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_archive_mod_links_sha ON archive_mod_links(archive_sha256, is_current);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_archive_mod_links_mod ON archive_mod_links(mod_id, is_current);");
            database.exec("DROP INDEX IF EXISTS idx_archive_mod_links_current_mod;");
            database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_mod_links_current_archive_mod ON archive_mod_links(archive_sha256, mod_id) WHERE is_current = 1 AND mod_id IS NOT NULL;");
            database.exec("CREATE INDEX IF NOT EXISTS idx_archive_install_attempts_sha ON archive_install_attempts(archive_sha256);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_pending_install_sessions_operation ON pending_install_sessions(operation_id);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_pending_install_sessions_state_updated ON pending_install_sessions(state, updated_at);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_pending_install_files_operation ON pending_install_files(operation_id);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_pending_install_files_path ON pending_install_files(path_key);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_install_operations_queue ON install_operations(state, enqueue_sequence);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_install_operations_target ON install_operations(target_mod_uuid, target_folder, state);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_notes_mod ON mod_notes(mod_id, updated_at);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_remote_cache_checked ON remote_cache(checked_at);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_update_sweeps_next ON mod_update_sweeps(next_eligible_at);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_file_cache_path ON mod_file_cache(path_key);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_file_cache_parent ON mod_file_cache(mod_id, parent_key, kind, name COLLATE NOCASE);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_profile_order_profile_position ON profile_order_items(profile_name, position);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_profile_plugin_order_profile_position ON profile_plugin_order_items(profile_name, position);");
            database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_plugin_order_unique_plugin ON profile_plugin_order_items(profile_name, plugin_name) WHERE kind = 'plugin';");
            if (persistedVersion < 9)
            {
                database.exec(
                    "UPDATE mod_sources SET "
                    "latest_version = CASE WHEN last_checked_at = '' THEN "
                    "COALESCE((SELECT version FROM mods WHERE mods.id = mod_sources.mod_id), latest_version) "
                    "ELSE latest_version END, "
                    "latest_file_id = CASE WHEN last_checked_at = '' THEN remote_file_id ELSE latest_file_id END, "
                    "last_check_state = CASE "
                    "WHEN lower(provider) = 'nexus' AND game_domain <> '' AND remote_mod_id <> '' AND remote_file_id <> '' "
                    "THEN CASE WHEN last_checked_at = '' THEN 'baseline_pending' ELSE 'recheck_required' END "
                    "ELSE last_check_state END, "
                    "last_attempted_at = CASE WHEN last_attempted_at = '' THEN last_checked_at ELSE last_attempted_at END;");
            }
            database.exec("PRAGMA user_version = 12;");
        }

        Database openInstanceDatabase(const std::filesystem::path& projectDirectory)
        {
            if (projectDirectory.empty())
            {
                throw std::invalid_argument("Project directory is required.");
            }

            std::filesystem::create_directories(projectDirectory);
            Database database(instanceDatabasePath(projectDirectory));
            ensureSchema(database);
            return database;
        }

        void setMetadataValue(Database& database, std::wstring_view key, std::wstring_view value)
        {
            Statement statement = database.prepare(
                "INSERT INTO instance_metadata(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value;");
            statement.bindText(1, key);
            statement.bindText(2, value);
            statement.stepDone();
        }

        std::wstring readMetadataValue(Database& database, std::wstring_view key)
        {
            Statement statement = database.prepare("SELECT value FROM instance_metadata WHERE key = ?;");
            statement.bindText(1, key);
            return statement.stepRow() ? statement.columnText(0) : std::wstring{};
        }

        void bumpMetadataRevision(Database& database, std::wstring_view key)
        {
            Statement statement = database.prepare(
                "INSERT INTO instance_metadata(key, value) VALUES(?, '1') "
                "ON CONFLICT(key) DO UPDATE SET "
                "value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1;");
            statement.bindText(1, key);
            statement.stepDone();
        }

        void bumpModInventoryRevision(Database& database)
        {
            bumpMetadataRevision(database, modInventoryRevisionKey);
        }

        std::wstring identitySourceKey(
            std::wstring_view provider,
            std::wstring_view gameDomain,
            std::wstring_view remoteModId)
        {
            const std::wstring normalizedProvider = toLower(trim(std::wstring(provider)));
            const std::wstring normalizedGame = toLower(trim(std::wstring(gameDomain)));
            const std::wstring normalizedModId = toLower(trim(std::wstring(remoteModId)));
            if (normalizedProvider.empty() || normalizedGame.empty() || normalizedModId.empty())
            {
                return {};
            }
            return normalizedProvider + L"\x1f" + normalizedGame + L"\x1f" + normalizedModId;
        }

        void insertIdentityKey(
            Database& database,
            std::int64_t modId,
            std::wstring_view kind,
            std::wstring_view value,
            std::wstring_view createdAt)
        {
            if (value.empty())
            {
                return;
            }
            Statement insert = database.prepare(
                "INSERT OR IGNORE INTO mod_identity_keys(mod_id, key_kind, key_value, created_at) "
                "VALUES(?, ?, ?, ?);");
            insert.bindInt64(1, modId);
            insert.bindText(2, kind);
            insert.bindText(3, value);
            insert.bindText(4, createdAt);
            insert.stepDone();
        }

        void insertIdentityToken(
            Database& database,
            std::int64_t modId,
            std::wstring_view token,
            int weight)
        {
            if (token.empty())
            {
                return;
            }
            Statement insert = database.prepare(
                "INSERT INTO mod_identity_tokens(mod_id, token, weight) VALUES(?, ?, ?) "
                "ON CONFLICT(mod_id, token) DO UPDATE SET weight = MAX(weight, excluded.weight);");
            insert.bindInt64(1, modId);
            insert.bindText(2, token);
            insert.bindInt(3, weight);
            insert.stepDone();
        }

        std::vector<std::wstring> identityAliases(Database& database, std::int64_t modId)
        {
            Statement statement = database.prepare(
                "SELECT alias FROM mod_identity_aliases WHERE mod_id = ? ORDER BY confirmed_at, alias;");
            statement.bindInt64(1, modId);
            std::vector<std::wstring> aliases;
            while (statement.stepRow())
            {
                aliases.push_back(statement.columnText(0));
            }
            return aliases;
        }

        std::wstring identityFomodModuleId(Database& database, std::int64_t modId)
        {
            Statement statement = database.prepare(
                "SELECT fomod_module_id FROM mod_identity_metadata WHERE mod_id = ? LIMIT 1;");
            statement.bindInt64(1, modId);
            return statement.stepRow() ? statement.columnText(0) : std::wstring{};
        }

        void syncIdentitySearchIndex(Database& database, InstalledModRecord& record)
        {
            if (record.id <= 0)
            {
                return;
            }

            if (!record.fomodModuleId.empty())
            {
                Statement metadata = database.prepare(
                    "INSERT INTO mod_identity_metadata(mod_id, fomod_module_id) VALUES(?, ?) "
                    "ON CONFLICT(mod_id) DO UPDATE SET fomod_module_id = "
                    "CASE WHEN excluded.fomod_module_id = '' THEN mod_identity_metadata.fomod_module_id "
                    "ELSE excluded.fomod_module_id END;");
                metadata.bindInt64(1, record.id);
                metadata.bindText(2, record.fomodModuleId);
                metadata.stepDone();
            }

            for (const std::wstring& alias : record.identityAliases)
            {
                const std::wstring normalizedAlias = ModIdentityResolver::normalizedName(alias);
                if (normalizedAlias.empty())
                {
                    continue;
                }
                Statement insert = database.prepare(
                    "INSERT OR IGNORE INTO mod_identity_aliases(mod_id, alias, normalized_alias, confirmed_at) "
                    "VALUES(?, ?, ?, ?);");
                insert.bindInt64(1, record.id);
                insert.bindText(2, alias);
                insert.bindText(3, normalizedAlias);
                insert.bindText(4, record.updatedAt.empty() ? nowUtcText() : record.updatedAt);
                insert.stepDone();
            }

            const std::wstring exclusionSourceKey = identitySourceKey(
                record.source.provider,
                record.source.gameDomain,
                record.source.remoteModId);
            const std::wstring exclusionNameKey =
                ModIdentityResolver::normalizedName(record.displayName);
            for (const std::wstring& rejectedUuid : record.identityExcludedModUuids)
            {
                if (trim(rejectedUuid).empty() ||
                    (exclusionSourceKey.empty() && exclusionNameKey.empty()))
                {
                    continue;
                }
                Statement insert = database.prepare(
                    "INSERT OR IGNORE INTO mod_identity_exclusions("
                    "owner_mod_id, source_key, incoming_name_key, rejected_mod_uuid, created_at"
                    ") VALUES(?, ?, ?, ?, ?);");
                insert.bindInt64(1, record.id);
                insert.bindText(2, exclusionSourceKey);
                insert.bindText(3, exclusionNameKey);
                insert.bindText(4, trim(rejectedUuid));
                insert.bindText(5, record.updatedAt.empty() ? nowUtcText() : record.updatedAt);
                insert.stepDone();
            }

            Statement clearKeys = database.prepare("DELETE FROM mod_identity_keys WHERE mod_id = ?;");
            clearKeys.bindInt64(1, record.id);
            clearKeys.stepDone();
            Statement clearTokens = database.prepare("DELETE FROM mod_identity_tokens WHERE mod_id = ?;");
            clearTokens.bindInt64(1, record.id);
            clearTokens.stepDone();

            const std::wstring createdAt = record.updatedAt.empty() ? nowUtcText() : record.updatedAt;
            const std::wstring displayKey = ModIdentityResolver::normalizedName(record.displayName);
            const std::wstring folderKey = ModIdentityResolver::normalizedName(record.folderName);
            insertIdentityKey(database, record.id, L"name", displayKey, createdAt);
            insertIdentityKey(database, record.id, L"folder", folderKey, createdAt);
            insertIdentityKey(
                database,
                record.id,
                L"source",
                identitySourceKey(
                    record.source.provider,
                    record.source.gameDomain,
                    record.source.remoteModId),
                createdAt);

            record.fomodModuleId = identityFomodModuleId(database, record.id);
            insertIdentityKey(
                database,
                record.id,
                L"fomod",
                toLower(trim(record.fomodModuleId)),
                createdAt);

            record.identityAliases = identityAliases(database, record.id);
            for (const std::wstring& alias : record.identityAliases)
            {
                insertIdentityKey(
                    database,
                    record.id,
                    L"alias",
                    ModIdentityResolver::normalizedName(alias),
                    createdAt);
            }

            for (const std::wstring& token : ModIdentityResolver::meaningfulTokens(record.displayName))
            {
                insertIdentityToken(database, record.id, token, 3);
            }
            for (const std::wstring& token : ModIdentityResolver::meaningfulTokens(record.folderName))
            {
                insertIdentityToken(database, record.id, token, 2);
            }
            for (const std::wstring& alias : record.identityAliases)
            {
                for (const std::wstring& token : ModIdentityResolver::meaningfulTokens(alias))
                {
                    insertIdentityToken(database, record.id, token, 2);
                }
            }
        }

        std::wstring existingUuidForFolder(Database& database, std::wstring_view folderName)
        {
            Statement statement = database.prepare("SELECT uuid FROM mods WHERE folder_name = ? LIMIT 1;");
            statement.bindText(1, folderName);
            return statement.stepRow() ? statement.columnText(0) : std::wstring{};
        }

        void writePortableManifest(const InstalledModRecord& record)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"schemaVersion", 2);
            writer.field(L"modUuid", record.uuid);
            writer.field(L"gameId", record.gameId);
            writer.field(L"folderName", record.folderName);
            writer.field(L"displayName", record.displayName);
            writer.field(L"version", record.version);
            writer.field(L"installedAt", record.installedAt);
            writer.field(L"updatedAt", record.updatedAt);
            writer.field(L"state", record.state);
            writer.field(L"contentFingerprint", record.contentFingerprint);
            writer.field(L"sourceIsNexus", record.sourceIsNexus);
            writer.field(L"sourceIsModdingFlow", record.sourceIsModdingFlow);
            writer.field(L"isLocal", record.isLocal);
            writer.field(L"isTranslation", record.isTranslation);
            writer.field(L"isPatch", record.isPatch);
            writer.key(L"source").beginObject();
            writer.field(L"provider", record.source.provider);
            writer.field(L"gameDomain", record.source.gameDomain);
            writer.field(L"remoteModId", record.source.remoteModId);
            writer.field(L"remoteFileId", record.source.remoteFileId);
            writer.field(L"url", record.source.url);
            writer.field(L"lastCheckedAt", record.source.lastCheckedAt);
            writer.field(L"latestVersion", record.source.latestVersion);
            writer.field(L"latestFileId", record.source.latestFileId);
            writer.field(L"updateCheckState", record.source.updateCheckState);
            writer.field(L"lastAttemptedAt", record.source.lastAttemptedAt);
            writer.endObject();
            writer.key(L"identity").beginObject();
            writer.field(L"fomodModuleId", record.fomodModuleId);
            writer.stringArray(L"aliases", record.identityAliases);
            writer.stringArray(L"excludedModUuids", record.identityExcludedModUuids);
            writer.endObject();
            writer.endObject();

            writeTextFile(manifestPathForMod(record.path), toUtf8(writer.str()));
        }

        void insertSystemTag(
            Database& database,
            std::int64_t modId,
            std::wstring_view tag,
            std::wstring_view createdAt)
        {
            Statement insert = database.prepare(
                "INSERT OR IGNORE INTO mod_tags(mod_id, tag, source, created_at) "
                "VALUES(?, ?, 'system', ?);");
            insert.bindInt64(1, modId);
            insert.bindText(2, tag);
            insert.bindText(3, createdAt);
            insert.stepDone();
        }

        void syncSystemTags(Database& database, const InstalledModRecord& record)
        {
            Statement remove = database.prepare(
                "DELETE FROM mod_tags WHERE mod_id = ? AND source = 'system';");
            remove.bindInt64(1, record.id);
            remove.stepDone();

            const std::wstring createdAt = record.updatedAt.empty() ? nowUtcText() : record.updatedAt;
            if (record.sourceIsNexus)
            {
                insertSystemTag(database, record.id, L"source:nexus", createdAt);
            }
            if (record.sourceIsModdingFlow)
            {
                insertSystemTag(database, record.id, L"source:moddingflow", createdAt);
            }
            if (record.isLocal)
            {
                insertSystemTag(database, record.id, L"local", createdAt);
            }
            if (record.isTranslation)
            {
                insertSystemTag(database, record.id, L"translation", createdAt);
            }
            if (record.isPatch)
            {
                insertSystemTag(database, record.id, L"patch", createdAt);
            }
        }

        void recordInstallHistory(Database& database, const InstalledModRecord& record)
        {
            Statement existing = database.prepare(
                "SELECT 1 FROM mod_install_history "
                "WHERE mod_id = ? AND operation = 'install' LIMIT 1;");
            existing.bindInt64(1, record.id);
            if (existing.stepRow())
            {
                return;
            }

            const std::wstring createdAt = record.installedAt.empty() ? nowUtcText() : record.installedAt;
            Statement insert = database.prepare(
                "INSERT INTO mod_install_history("
                "mod_id, folder_name, operation, version, source_provider, source_url, archive_path, created_at, details_json"
                ") VALUES(?, ?, 'install', ?, ?, ?, '', ?, '{}');");
            insert.bindInt64(1, record.id);
            insert.bindText(2, record.folderName);
            insert.bindText(3, record.version);
            insert.bindText(4, record.source.provider);
            insert.bindText(5, record.source.url);
            insert.bindText(6, createdAt);
            insert.stepDone();
        }

        void normalizeNexusUpdateState(InstalledModRecord& record)
        {
            if (toLower(record.source.provider) == L"nexus" &&
                !record.source.gameDomain.empty() &&
                !record.source.remoteModId.empty() &&
                !record.source.remoteFileId.empty())
            {
                if (record.source.lastCheckedAt.empty())
                {
                    record.source.latestVersion = record.version;
                    record.source.latestFileId = record.source.remoteFileId;
                    record.source.updateCheckState = L"baseline_pending";
                }
                else if (record.source.updateCheckState.empty())
                {
                    record.source.updateCheckState = L"recheck_required";
                }
            }
        }

        void updateModFlags(Database& database, InstalledModRecord& record)
        {
            deriveModFlags(record);
            normalizeNexusUpdateState(record);

            Statement update = database.prepare(
                "UPDATE mods SET "
                "source_is_nexus = ?,"
                "source_is_moddingflow = ?,"
                "is_local = ?,"
                "is_translation = ?,"
                "is_patch = ?,"
                "updated_at = ? "
                "WHERE id = ?;");
            update.bindInt(1, record.sourceIsNexus ? 1 : 0);
            update.bindInt(2, record.sourceIsModdingFlow ? 1 : 0);
            update.bindInt(3, record.isLocal ? 1 : 0);
            update.bindInt(4, record.isTranslation ? 1 : 0);
            update.bindInt(5, record.isPatch ? 1 : 0);
            update.bindText(6, record.updatedAt);
            update.bindInt64(7, record.id);
            update.stepDone();

            syncSystemTags(database, record);
        }

        void upsertModRecord(Database& database, InstalledModRecord& record)
        {
            if (record.folderName.empty())
            {
                throw std::invalid_argument("Mod folder name is required.");
            }
            if (record.displayName.empty())
            {
                record.displayName = record.folderName;
            }
            if (record.uuid.empty())
            {
                record.uuid = existingUuidForFolder(database, record.folderName);
            }
            if (record.uuid.empty())
            {
                record.uuid = generateUuid();
            }
            if (record.installedAt.empty())
            {
                record.installedAt = nowUtcText();
            }
            if (record.updatedAt.empty())
            {
                record.updatedAt = record.installedAt;
            }
            if (record.state.empty())
            {
                record.state = L"installed";
            }
            if (record.gameId.empty())
            {
                record.gameId = readMetadataValue(database, L"game_id");
            }

            normalizeNexusUpdateState(record);
            deriveModFlags(record);

            Statement mod = database.prepare(
                "INSERT INTO mods("
                "uuid, game_id, folder_name, display_name, version, installed_at, updated_at, state, content_fingerprint, "
                "source_is_nexus, source_is_moddingflow, is_local, is_translation, is_patch"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(folder_name) DO UPDATE SET "
                "game_id = CASE WHEN excluded.game_id = '' THEN mods.game_id ELSE excluded.game_id END,"
                "display_name = excluded.display_name,"
                "version = excluded.version,"
                "updated_at = excluded.updated_at,"
                "state = excluded.state,"
                "content_fingerprint = excluded.content_fingerprint,"
                "source_is_nexus = excluded.source_is_nexus,"
                "source_is_moddingflow = excluded.source_is_moddingflow,"
                "is_local = excluded.is_local,"
                "is_translation = excluded.is_translation,"
                "is_patch = excluded.is_patch;");
            mod.bindText(1, record.uuid);
            mod.bindText(2, record.gameId);
            mod.bindText(3, record.folderName);
            mod.bindText(4, record.displayName);
            mod.bindText(5, record.version);
            mod.bindText(6, record.installedAt);
            mod.bindText(7, record.updatedAt);
            mod.bindText(8, record.state);
            mod.bindText(9, record.contentFingerprint);
            mod.bindInt(10, record.sourceIsNexus ? 1 : 0);
            mod.bindInt(11, record.sourceIsModdingFlow ? 1 : 0);
            mod.bindInt(12, record.isLocal ? 1 : 0);
            mod.bindInt(13, record.isTranslation ? 1 : 0);
            mod.bindInt(14, record.isPatch ? 1 : 0);
            mod.stepDone();

            Statement id = database.prepare(
                "SELECT id, uuid, installed_at, source_is_nexus, source_is_moddingflow, "
                "is_local, is_translation, is_patch "
                "FROM mods WHERE folder_name = ? LIMIT 1;");
            id.bindText(1, record.folderName);
            if (!id.stepRow())
            {
                throw std::runtime_error("Failed to read installed mod metadata.");
            }

            record.id = std::stoll(id.columnText(0));
            record.uuid = id.columnText(1);
            record.installedAt = id.columnText(2);
            record.sourceIsNexus = id.columnInt(3) != 0;
            record.sourceIsModdingFlow = id.columnInt(4) != 0;
            record.isLocal = id.columnInt(5) != 0;
            record.isTranslation = id.columnInt(6) != 0;
            record.isPatch = id.columnInt(7) != 0;

            Statement source = database.prepare(
                "INSERT INTO mod_sources("
                "mod_id, provider, game_domain, remote_mod_id, remote_file_id, url, last_checked_at, latest_version, "
                "latest_file_id, last_check_state, last_attempted_at"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(mod_id) DO UPDATE SET "
                "provider = excluded.provider,"
                "game_domain = excluded.game_domain,"
                "remote_mod_id = excluded.remote_mod_id,"
                "remote_file_id = excluded.remote_file_id,"
                "url = excluded.url,"
                "last_checked_at = excluded.last_checked_at,"
                "latest_version = excluded.latest_version,"
                "latest_file_id = excluded.latest_file_id,"
                "last_check_state = excluded.last_check_state,"
                "last_attempted_at = excluded.last_attempted_at;");
            source.bindInt64(1, record.id);
            source.bindText(2, record.source.provider);
            source.bindText(3, record.source.gameDomain);
            source.bindText(4, record.source.remoteModId);
            source.bindText(5, record.source.remoteFileId);
            source.bindText(6, record.source.url);
            source.bindText(7, record.source.lastCheckedAt);
            source.bindText(8, record.source.latestVersion);
            source.bindText(9, record.source.latestFileId);
            source.bindText(10, record.source.updateCheckState);
            source.bindText(11, record.source.lastAttemptedAt);
            source.stepDone();

            syncIdentitySearchIndex(database, record);
            syncSystemTags(database, record);
            recordInstallHistory(database, record);
            bumpModInventoryRevision(database);
        }

        InstalledModRecord readRecordByFolder(
            Database& database,
            const std::filesystem::path& projectDirectory,
            std::wstring_view folderName,
            const std::filesystem::path& modsRoot = {})
        {
            Statement statement = database.prepare(
                "SELECT "
                "m.id, m.uuid, m.game_id, m.folder_name, m.display_name, m.version, "
                "m.installed_at, m.updated_at, m.state, m.content_fingerprint, "
                "m.source_is_nexus, m.source_is_moddingflow, m.is_local, m.is_translation, m.is_patch, "
                "COALESCE(s.provider, ''), COALESCE(s.game_domain, ''), "
                "COALESCE(s.remote_mod_id, ''), COALESCE(s.remote_file_id, ''), "
                "COALESCE(s.url, ''), COALESCE(s.last_checked_at, ''), COALESCE(s.latest_version, ''), "
                "COALESCE(s.latest_file_id, ''), COALESCE(s.last_check_state, ''), COALESCE(s.last_attempted_at, '') "
                "FROM mods m "
                "LEFT JOIN mod_sources s ON s.mod_id = m.id "
                "WHERE m.folder_name = ? "
                "LIMIT 1;");
            statement.bindText(1, folderName);
            if (!statement.stepRow())
            {
                throw std::runtime_error("Installed mod metadata was not found.");
            }

            InstalledModRecord record;
            record.id = std::stoll(statement.columnText(0));
            record.uuid = statement.columnText(1);
            record.gameId = statement.columnText(2);
            record.folderName = statement.columnText(3);
            record.displayName = statement.columnText(4);
            record.version = statement.columnText(5);
            record.installedAt = statement.columnText(6);
            record.updatedAt = statement.columnText(7);
            record.state = statement.columnText(8);
            record.contentFingerprint = statement.columnText(9);
            record.sourceIsNexus = statement.columnInt(10) != 0;
            record.sourceIsModdingFlow = statement.columnInt(11) != 0;
            record.isLocal = statement.columnInt(12) != 0;
            record.isTranslation = statement.columnInt(13) != 0;
            record.isPatch = statement.columnInt(14) != 0;
            record.path = modsDirectory(projectDirectory, modsRoot) / std::filesystem::path(record.folderName);
            record.source = ModSourceRecord{
                statement.columnText(15),
                statement.columnText(16),
                statement.columnText(17),
                statement.columnText(18),
                statement.columnText(19),
                statement.columnText(20),
                statement.columnText(21),
                statement.columnText(22),
                statement.columnText(23),
                statement.columnText(24)
            };
            return record;
        }

        std::vector<InstalledModRecord> readInstalledRecords(
            Database& database,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsRoot = {})
        {
            Statement statement = database.prepare(
                "SELECT "
                "m.id, m.uuid, m.game_id, m.folder_name, m.display_name, m.version, "
                "m.installed_at, m.updated_at, m.state, m.content_fingerprint, "
                "m.source_is_nexus, m.source_is_moddingflow, m.is_local, m.is_translation, m.is_patch, "
                "COALESCE(s.provider, ''), COALESCE(s.game_domain, ''), "
                "COALESCE(s.remote_mod_id, ''), COALESCE(s.remote_file_id, ''), "
                "COALESCE(s.url, ''), COALESCE(s.last_checked_at, ''), COALESCE(s.latest_version, ''), "
                "COALESCE(s.latest_file_id, ''), COALESCE(s.last_check_state, ''), COALESCE(s.last_attempted_at, '') "
                "FROM mods m "
                "LEFT JOIN mod_sources s ON s.mod_id = m.id "
                "WHERE m.state IN ('installed', 'disabled') "
                "ORDER BY m.display_name COLLATE NOCASE, m.folder_name COLLATE NOCASE;");

            std::vector<InstalledModRecord> records;
            while (statement.stepRow())
            {
                InstalledModRecord record;
                record.id = std::stoll(statement.columnText(0));
                record.uuid = statement.columnText(1);
                record.gameId = statement.columnText(2);
                record.folderName = statement.columnText(3);
                record.displayName = statement.columnText(4);
                record.version = statement.columnText(5);
                record.installedAt = statement.columnText(6);
                record.updatedAt = statement.columnText(7);
                record.state = statement.columnText(8);
                record.contentFingerprint = statement.columnText(9);
                record.sourceIsNexus = statement.columnInt(10) != 0;
                record.sourceIsModdingFlow = statement.columnInt(11) != 0;
                record.isLocal = statement.columnInt(12) != 0;
                record.isTranslation = statement.columnInt(13) != 0;
                record.isPatch = statement.columnInt(14) != 0;
                record.path = modsDirectory(projectDirectory, modsRoot) / std::filesystem::path(record.folderName);
                record.source = ModSourceRecord{
                    statement.columnText(15),
                    statement.columnText(16),
                    statement.columnText(17),
                    statement.columnText(18),
                    statement.columnText(19),
                    statement.columnText(20),
                    statement.columnText(21),
                    statement.columnText(22),
                    statement.columnText(23),
                    statement.columnText(24)
                };
                records.push_back(std::move(record));
            }

            return records;
        }

        int nextProfileOrderPosition(Database& database, std::wstring_view profileName)
        {
            Statement statement = database.prepare(
                "SELECT COALESCE(MAX(position), -1) + 1 "
                "FROM profile_order_items WHERE profile_name = ?;");
            statement.bindText(1, profileName);
            return statement.stepRow() ? statement.columnInt(0) : 0;
        }

        int profileOrderItemCount(Database& database, std::wstring_view profileName)
        {
            Statement statement = database.prepare(
                "SELECT COUNT(*) FROM profile_order_items WHERE profile_name = ?;");
            statement.bindText(1, profileName);
            return statement.stepRow() ? statement.columnInt(0) : 0;
        }

        void removeInactiveProfileModItems(Database& database, std::wstring_view profileName)
        {
            Statement remove = database.prepare(
                "DELETE FROM profile_order_items "
                "WHERE profile_name = ? "
                "AND kind = 'mod' "
                "AND (mod_id IS NULL OR mod_id NOT IN ("
                "SELECT id FROM mods WHERE state IN ('installed', 'disabled')"
                "));");
            remove.bindText(1, profileName);
            remove.stepDone();
        }

        void appendMissingProfileModItems(Database& database, std::wstring_view profileName)
        {
            Statement mods = database.prepare(
                "SELECT m.id FROM mods m "
                "WHERE m.state IN ('installed', 'disabled') "
                "AND NOT EXISTS ("
                "SELECT 1 FROM profile_order_items oi "
                "WHERE oi.profile_name = ? AND oi.kind = 'mod' AND oi.mod_id = m.id"
                ") "
                "ORDER BY m.display_name COLLATE NOCASE, m.folder_name COLLATE NOCASE;");
            mods.bindText(1, profileName);

            std::vector<std::int64_t> missingModIds;
            while (mods.stepRow())
            {
                missingModIds.push_back(mods.columnInt64(0));
            }
            if (missingModIds.empty())
            {
                return;
            }

            int nextPosition = nextProfileOrderPosition(database, profileName);
            const std::wstring now = nowUtcText();
            Statement insert = database.prepare(
                "INSERT OR IGNORE INTO profile_order_items("
                "id, profile_name, kind, mod_id, separator_title, position, created_at, updated_at"
                ") VALUES(?, ?, 'mod', ?, '', ?, ?, ?);");
            for (const std::int64_t modId : missingModIds)
            {
                insert.bindText(1, generateUuid());
                insert.bindText(2, profileName);
                insert.bindInt64(3, modId);
                insert.bindInt(4, nextPosition);
                insert.bindText(5, now);
                insert.bindText(6, now);
                insert.stepDoneAndReset();
                ++nextPosition;
            }
        }

        void compactProfileOrderPositions(Database& database, std::wstring_view profileName)
        {
            Statement select = database.prepare(
                "SELECT id, position FROM profile_order_items "
                "WHERE profile_name = ? "
                "ORDER BY position, rowid;");
            select.bindText(1, profileName);

            std::vector<std::pair<std::wstring, int>> rows;
            while (select.stepRow())
            {
                rows.emplace_back(select.columnText(0), select.columnInt(1));
            }

            bool needsCompaction = false;
            for (std::size_t index = 0; index < rows.size(); ++index)
            {
                if (rows[index].second != static_cast<int>(index))
                {
                    needsCompaction = true;
                    break;
                }
            }
            if (!needsCompaction)
            {
                return;
            }

            const std::wstring now = nowUtcText();
            Statement update = database.prepare(
                "UPDATE profile_order_items "
                "SET position = ?, updated_at = ? "
                "WHERE id = ?;");
            for (int index = 0; index < static_cast<int>(rows.size()); ++index)
            {
                if (rows[static_cast<std::size_t>(index)].second == index)
                {
                    continue;
                }
                update.bindInt(1, index);
                update.bindText(2, now);
                update.bindText(3, rows[static_cast<std::size_t>(index)].first);
                update.stepDoneAndReset();
            }
        }

        void syncProfileOrderItems(Database& database, std::wstring_view profileName)
        {
            appendMissingProfileModItems(database, profileName);
            compactProfileOrderPositions(database, profileName);
        }

        std::vector<ProfileOrderItemRecord> readProfileOrderItems(
            Database& database,
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsRoot = {})
        {
            Statement statement = database.prepare(
                "SELECT "
                "oi.id, oi.profile_name, oi.kind, oi.position, oi.separator_title, "
                "m.id, COALESCE(m.uuid, ''), COALESCE(m.game_id, ''), "
                "COALESCE(m.folder_name, ''), COALESCE(m.display_name, ''), "
                "COALESCE(m.version, ''), COALESCE(m.installed_at, ''), "
                "COALESCE(m.updated_at, ''), COALESCE(m.state, ''), "
                "COALESCE(m.content_fingerprint, ''), "
                "COALESCE(m.source_is_nexus, 0), COALESCE(m.source_is_moddingflow, 0), "
                "COALESCE(m.is_local, 0), COALESCE(m.is_translation, 0), COALESCE(m.is_patch, 0), "
                "COALESCE(s.provider, ''), COALESCE(s.game_domain, ''), "
                "COALESCE(s.remote_mod_id, ''), COALESCE(s.remote_file_id, ''), "
                "COALESCE(s.url, ''), COALESCE(s.last_checked_at, ''), COALESCE(s.latest_version, '') "
                "FROM profile_order_items oi "
                "LEFT JOIN mods m ON m.id = oi.mod_id AND m.state IN ('installed', 'disabled') "
                "LEFT JOIN mod_sources s ON s.mod_id = m.id "
                "WHERE oi.profile_name = ? "
                "AND (oi.kind = 'separator' OR m.id IS NOT NULL) "
                "ORDER BY oi.position, oi.rowid;");
            statement.bindText(1, profileName);

            std::vector<ProfileOrderItemRecord> records;
            while (statement.stepRow())
            {
                ProfileOrderItemRecord record;
                record.id = statement.columnText(0);
                record.profileName = statement.columnText(1);
                record.kind = statement.columnText(2);
                record.position = statement.columnInt(3);
                record.separatorTitle = statement.columnText(4);
                record.hasMod = record.kind == profileOrderModKind;

                if (record.hasMod)
                {
                    record.mod.id = statement.columnInt64(5);
                    record.mod.uuid = statement.columnText(6);
                    record.mod.gameId = statement.columnText(7);
                    record.mod.folderName = statement.columnText(8);
                    record.mod.displayName = statement.columnText(9);
                    record.mod.version = statement.columnText(10);
                    record.mod.installedAt = statement.columnText(11);
                    record.mod.updatedAt = statement.columnText(12);
                    record.mod.state = statement.columnText(13);
                    record.mod.contentFingerprint = statement.columnText(14);
                    record.mod.sourceIsNexus = statement.columnInt(15) != 0;
                    record.mod.sourceIsModdingFlow = statement.columnInt(16) != 0;
                    record.mod.isLocal = statement.columnInt(17) != 0;
                    record.mod.isTranslation = statement.columnInt(18) != 0;
                    record.mod.isPatch = statement.columnInt(19) != 0;
                    record.mod.path =
                        modsDirectory(projectDirectory, modsRoot) / std::filesystem::path(record.mod.folderName);
                    record.mod.source = ModSourceRecord{
                        statement.columnText(20),
                        statement.columnText(21),
                        statement.columnText(22),
                        statement.columnText(23),
                        statement.columnText(24),
                        statement.columnText(25),
                        statement.columnText(26)
                    };
                }

                records.push_back(std::move(record));
            }

            return records;
        }

        int nextProfilePluginOrderPosition(Database& database, std::wstring_view profileName)
        {
            Statement statement = database.prepare(
                "SELECT COALESCE(MAX(position), -1) + 1 "
                "FROM profile_plugin_order_items WHERE profile_name = ?;");
            statement.bindText(1, profileName);
            return statement.stepRow() ? statement.columnInt(0) : 0;
        }

        int profilePluginOrderItemCount(Database& database, std::wstring_view profileName)
        {
            Statement statement = database.prepare(
                "SELECT COUNT(*) FROM profile_plugin_order_items WHERE profile_name = ?;");
            statement.bindText(1, profileName);
            return statement.stepRow() ? statement.columnInt(0) : 0;
        }

        std::set<std::wstring> pluginNameKeys(const std::vector<std::wstring>& pluginNames)
        {
            std::set<std::wstring> keys;
            for (const std::wstring& pluginName : pluginNames)
            {
                const std::wstring normalized = trim(pluginName);
                if (!normalized.empty())
                {
                    keys.insert(toLower(normalized));
                }
            }

            return keys;
        }

        void removeMissingProfilePluginItems(
            Database& database,
            std::wstring_view profileName,
            const std::vector<std::wstring>& pluginNames)
        {
            const std::set<std::wstring> validPlugins = pluginNameKeys(pluginNames);
            Statement select = database.prepare(
                "SELECT id, plugin_name FROM profile_plugin_order_items "
                "WHERE profile_name = ? AND kind = 'plugin';");
            select.bindText(1, profileName);

            std::vector<std::wstring> idsToRemove;
            while (select.stepRow())
            {
                const std::wstring pluginName = select.columnText(1);
                if (!validPlugins.contains(toLower(pluginName)))
                {
                    idsToRemove.push_back(select.columnText(0));
                }
            }

            for (const std::wstring& id : idsToRemove)
            {
                Statement remove = database.prepare(
                    "DELETE FROM profile_plugin_order_items "
                    "WHERE profile_name = ? AND id = ? AND kind = 'plugin';");
                remove.bindText(1, profileName);
                remove.bindText(2, id);
                remove.stepDone();
            }
        }

        void appendMissingProfilePluginItems(
            Database& database,
            std::wstring_view profileName,
            const std::vector<std::wstring>& pluginNames)
        {
            std::set<std::wstring> existingKeys;
            Statement existing = database.prepare(
                "SELECT plugin_name FROM profile_plugin_order_items "
                "WHERE profile_name = ? AND kind = 'plugin';");
            existing.bindText(1, profileName);
            while (existing.stepRow())
            {
                existingKeys.insert(toLower(existing.columnText(0)));
            }

            std::vector<std::wstring> missingPluginNames;
            missingPluginNames.reserve(pluginNames.size());
            for (const std::wstring& pluginName : pluginNames)
            {
                const std::wstring normalized = trim(pluginName);
                if (!normalized.empty() && existingKeys.insert(toLower(normalized)).second)
                {
                    missingPluginNames.push_back(normalized);
                }
            }
            if (missingPluginNames.empty())
            {
                return;
            }

            int nextPosition = nextProfilePluginOrderPosition(database, profileName);
            const std::wstring now = nowUtcText();
            Statement insert = database.prepare(
                "INSERT OR IGNORE INTO profile_plugin_order_items("
                "id, profile_name, kind, plugin_name, separator_title, position, created_at, updated_at"
                ") VALUES(?, ?, 'plugin', ?, '', ?, ?, ?);");
            for (const std::wstring& pluginName : missingPluginNames)
            {
                insert.bindText(1, generateUuid());
                insert.bindText(2, profileName);
                insert.bindText(3, pluginName);
                insert.bindInt(4, nextPosition);
                insert.bindText(5, now);
                insert.bindText(6, now);
                insert.stepDoneAndReset();
                ++nextPosition;
            }
        }

        void compactProfilePluginOrderPositions(Database& database, std::wstring_view profileName)
        {
            Statement select = database.prepare(
                "SELECT id, position FROM profile_plugin_order_items "
                "WHERE profile_name = ? "
                "ORDER BY position, rowid;");
            select.bindText(1, profileName);

            std::vector<std::pair<std::wstring, int>> rows;
            while (select.stepRow())
            {
                rows.emplace_back(select.columnText(0), select.columnInt(1));
            }

            bool needsCompaction = false;
            for (std::size_t index = 0; index < rows.size(); ++index)
            {
                if (rows[index].second != static_cast<int>(index))
                {
                    needsCompaction = true;
                    break;
                }
            }
            if (!needsCompaction)
            {
                return;
            }

            const std::wstring now = nowUtcText();
            Statement update = database.prepare(
                "UPDATE profile_plugin_order_items "
                "SET position = ?, updated_at = ? "
                "WHERE id = ?;");
            for (int index = 0; index < static_cast<int>(rows.size()); ++index)
            {
                if (rows[static_cast<std::size_t>(index)].second == index)
                {
                    continue;
                }
                update.bindInt(1, index);
                update.bindText(2, now);
                update.bindText(3, rows[static_cast<std::size_t>(index)].first);
                update.stepDoneAndReset();
            }
        }

        void syncProfilePluginOrderItems(
            Database& database,
            std::wstring_view profileName,
            const std::vector<std::wstring>& pluginNames)
        {
            appendMissingProfilePluginItems(database, profileName, pluginNames);
            compactProfilePluginOrderPositions(database, profileName);
        }

        std::vector<ProfilePluginOrderItemRecord> readProfilePluginOrderItems(
            Database& database,
            std::wstring_view profileName)
        {
            Statement statement = database.prepare(
                "SELECT id, profile_name, kind, position, plugin_name, separator_title "
                "FROM profile_plugin_order_items "
                "WHERE profile_name = ? "
                "ORDER BY position, rowid;");
            statement.bindText(1, profileName);

            std::vector<ProfilePluginOrderItemRecord> records;
            while (statement.stepRow())
            {
                ProfilePluginOrderItemRecord record;
                record.id = statement.columnText(0);
                record.profileName = statement.columnText(1);
                record.kind = statement.columnText(2);
                record.position = statement.columnInt(3);
                record.pluginName = statement.columnText(4);
                record.separatorTitle = statement.columnText(5);
                records.push_back(std::move(record));
            }

            return records;
        }

        bool profileRowsExist(Database& database, const char* tableName, std::wstring_view profileName)
        {
            const std::string sql = std::string("SELECT 1 FROM ") + tableName +
                " WHERE profile_name = ? LIMIT 1;";
            Statement select = database.prepare(sql.c_str());
            select.bindText(1, profileName);
            return select.stepRow();
        }

        void addProfileName(
            std::vector<std::wstring>& profiles,
            std::set<std::wstring>& seen,
            std::wstring profileName)
        {
            profileName = profileNameOrDefault(profileName);
            const std::wstring key = toLower(profileName);
            if (seen.insert(key).second)
            {
                profiles.push_back(std::move(profileName));
            }
        }

        void appendProfileNamesFromTable(
            Database& database,
            const char* tableName,
            std::vector<std::wstring>& profiles,
            std::set<std::wstring>& seen)
        {
            const std::string sql = std::string("SELECT DISTINCT profile_name FROM ") + tableName +
                " WHERE profile_name <> '' ORDER BY profile_name COLLATE NOCASE;";
            Statement select = database.prepare(sql.c_str());
            while (select.stepRow())
            {
                addProfileName(profiles, seen, select.columnText(0));
            }
        }

        void removeProfileRows(Database& database, const char* tableName, std::wstring_view profileName)
        {
            const std::string sql = std::string("DELETE FROM ") + tableName +
                " WHERE profile_name = ?;";
            Statement remove = database.prepare(sql.c_str());
            remove.bindText(1, profileName);
            remove.stepDone();
        }

        void renameProfileRows(
            Database& database,
            const char* tableName,
            std::wstring_view sourceProfileName,
            std::wstring_view targetProfileName)
        {
            const std::string sql = std::string("UPDATE ") + tableName +
                " SET profile_name = ?, updated_at = ? WHERE profile_name = ?;";
            Statement update = database.prepare(sql.c_str());
            update.bindText(1, targetProfileName);
            update.bindText(2, nowUtcText());
            update.bindText(3, sourceProfileName);
            update.stepDone();
        }

        void copyProfileOrderRows(
            Database& database,
            std::wstring_view sourceProfileName,
            std::wstring_view targetProfileName)
        {
            Statement select = database.prepare(
                "SELECT kind, mod_id, separator_title, position "
                "FROM profile_order_items "
                "WHERE profile_name = ? "
                "ORDER BY position, rowid;");
            select.bindText(1, sourceProfileName);

            const std::wstring now = nowUtcText();
            while (select.stepRow())
            {
                const std::wstring kind = select.columnText(0);
                Statement insert = database.prepare(
                    "INSERT INTO profile_order_items("
                    "id, profile_name, kind, mod_id, separator_title, position, created_at, updated_at"
                    ") VALUES(?, ?, ?, ?, ?, ?, ?, ?);");
                insert.bindText(1, generateUuid());
                insert.bindText(2, targetProfileName);
                insert.bindText(3, kind);
                if (kind == profileOrderModKind)
                {
                    insert.bindInt64(4, select.columnInt64(1));
                }
                else
                {
                    insert.bindNull(4);
                }
                insert.bindText(5, select.columnText(2));
                insert.bindInt(6, select.columnInt(3));
                insert.bindText(7, now);
                insert.bindText(8, now);
                insert.stepDone();
            }
        }

        void copyProfilePluginOrderRows(
            Database& database,
            std::wstring_view sourceProfileName,
            std::wstring_view targetProfileName)
        {
            Statement select = database.prepare(
                "SELECT kind, plugin_name, separator_title, position "
                "FROM profile_plugin_order_items "
                "WHERE profile_name = ? "
                "ORDER BY position, rowid;");
            select.bindText(1, sourceProfileName);

            const std::wstring now = nowUtcText();
            while (select.stepRow())
            {
                Statement insert = database.prepare(
                    "INSERT INTO profile_plugin_order_items("
                    "id, profile_name, kind, plugin_name, separator_title, position, created_at, updated_at"
                    ") VALUES(?, ?, ?, ?, ?, ?, ?, ?);");
                insert.bindText(1, generateUuid());
                insert.bindText(2, targetProfileName);
                insert.bindText(3, select.columnText(0));
                insert.bindText(4, select.columnText(1));
                insert.bindText(5, select.columnText(2));
                insert.bindInt(6, select.columnInt(3));
                insert.bindText(7, now);
                insert.bindText(8, now);
                insert.stepDone();
            }
        }

        struct ProfileOrderStorageItem
        {
            std::wstring id;
            std::wstring kind;
        };

        enum class ProfileOrderSeparatorMoveMode
        {
            Single,
            Block
        };

        std::vector<ProfileOrderStorageItem> readProfileOrderStorageItems(
            Database& database,
            std::wstring_view profileName,
            const char* tableName)
        {
            const std::string sql = std::string(
                "SELECT id, kind FROM ") + tableName +
                " WHERE profile_name = ? "
                "ORDER BY position, rowid;";
            Statement select = database.prepare(sql.c_str());
            select.bindText(1, profileName);

            std::vector<ProfileOrderStorageItem> items;
            while (select.stepRow())
            {
                items.push_back(ProfileOrderStorageItem{
                    select.columnText(0),
                    select.columnText(1)
                });
            }

            return items;
        }

        int profileOrderMoveBlockEnd(
            const std::vector<ProfileOrderStorageItem>& items,
            int sourceIndex,
            std::wstring_view separatorKind)
        {
            if (items[static_cast<std::size_t>(sourceIndex)].kind != separatorKind)
            {
                return sourceIndex + 1;
            }

            for (int index = sourceIndex + 1; index < static_cast<int>(items.size()); ++index)
            {
                if (items[static_cast<std::size_t>(index)].kind == separatorKind)
                {
                    return index;
                }
            }

            return static_cast<int>(items.size());
        }

        int profileOrderMoveEnd(
            const std::vector<ProfileOrderStorageItem>& items,
            int sourceIndex,
            std::wstring_view separatorKind,
            ProfileOrderSeparatorMoveMode separatorMoveMode)
        {
            if (separatorMoveMode == ProfileOrderSeparatorMoveMode::Single &&
                items[static_cast<std::size_t>(sourceIndex)].kind == separatorKind)
            {
                return sourceIndex + 1;
            }

            return profileOrderMoveBlockEnd(items, sourceIndex, separatorKind);
        }

        bool reorderProfileOrderStorageItems(
            std::vector<ProfileOrderStorageItem>& items,
            std::wstring_view orderItemId,
            int targetIndex,
            std::wstring_view separatorKind,
            ProfileOrderSeparatorMoveMode separatorMoveMode)
        {
            const auto source = std::find_if(
                items.begin(),
                items.end(),
                [orderItemId](const ProfileOrderStorageItem& item)
                {
                    return item.id == orderItemId;
                });
            if (source == items.end())
            {
                throw std::invalid_argument("Profile order item was not found.");
            }

            if (items.size() <= 1)
            {
                return false;
            }

            const int sourceIndex = static_cast<int>(std::distance(items.begin(), source));
            const int blockEnd = profileOrderMoveEnd(
                items,
                sourceIndex,
                separatorKind,
                separatorMoveMode);
            const int blockLength = blockEnd - sourceIndex;

            if (blockLength <= 1)
            {
                const int clampedTarget = std::clamp(
                    targetIndex,
                    0,
                    static_cast<int>(items.size() - 1));
                if (sourceIndex == clampedTarget)
                {
                    return false;
                }

                ProfileOrderStorageItem moving = std::move(items[static_cast<std::size_t>(sourceIndex)]);
                items.erase(items.begin() + sourceIndex);
                items.insert(items.begin() + clampedTarget, std::move(moving));
                return true;
            }

            if (targetIndex >= sourceIndex && targetIndex < blockEnd)
            {
                return false;
            }

            const int maxDestination = static_cast<int>(items.size()) - blockLength;
            const int desiredDestination = targetIndex > sourceIndex
                ? targetIndex + 1 - blockLength
                : targetIndex;
            const int destination = std::clamp(desiredDestination, 0, maxDestination);
            if (destination == sourceIndex)
            {
                return false;
            }

            std::vector<ProfileOrderStorageItem> moving(
                std::make_move_iterator(items.begin() + sourceIndex),
                std::make_move_iterator(items.begin() + blockEnd));
            items.erase(items.begin() + sourceIndex, items.begin() + blockEnd);
            items.insert(
                items.begin() + destination,
                std::make_move_iterator(moving.begin()),
                std::make_move_iterator(moving.end()));
            return true;
        }

        void writeProfileOrderStorageItemPositions(
            Database& database,
            std::wstring_view profileName,
            const char* tableName,
            const std::vector<ProfileOrderStorageItem>& items)
        {
            const std::wstring now = nowUtcText();
            const std::string sql = std::string(
                "UPDATE ") + tableName +
                " SET position = ?, updated_at = ? "
                "WHERE profile_name = ? AND id = ?;";

            for (int index = 0; index < static_cast<int>(items.size()); ++index)
            {
                Statement update = database.prepare(sql.c_str());
                update.bindInt(1, index);
                update.bindText(2, now);
                update.bindText(3, profileName);
                update.bindText(4, items[static_cast<std::size_t>(index)].id);
                update.stepDone();
            }
        }

        void moveProfileOrderStorageItems(
            Database& database,
            std::wstring_view profileName,
            const char* tableName,
            std::wstring_view orderItemId,
            int targetIndex,
            std::wstring_view separatorKind,
            ProfileOrderSeparatorMoveMode separatorMoveMode)
        {
            std::vector<ProfileOrderStorageItem> items =
                readProfileOrderStorageItems(database, profileName, tableName);
            if (reorderProfileOrderStorageItems(
                items,
                orderItemId,
                targetIndex,
                separatorKind,
                separatorMoveMode))
            {
                writeProfileOrderStorageItemPositions(database, profileName, tableName, items);
            }
        }

        void syncInstalledModsFromDisk(
            Database& database,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsRoot = {});

        int cachedEntryCount(Database& database, std::int64_t modId)
        {
            Statement statement = database.prepare(
                "SELECT COUNT(*) FROM mod_files WHERE mod_id = ?;");
            statement.bindInt64(1, modId);
            return statement.stepRow() ? statement.columnInt(0) : 0;
        }

        struct PersistedFileCacheState
        {
            int schemaVersion{0};
            std::wstring cacheKey;
            int entryCount{0};
        };

        std::optional<PersistedFileCacheState> readFileCacheState(
            Database& database,
            std::int64_t modId)
        {
            Statement statement = database.prepare(
                "SELECT schema_version, cache_key, entry_count "
                "FROM mod_file_cache_state WHERE mod_id = ?;");
            statement.bindInt64(1, modId);
            if (!statement.stepRow())
            {
                return std::nullopt;
            }
            return PersistedFileCacheState{
                statement.columnInt(0),
                statement.columnText(1),
                statement.columnInt(2)
            };
        }

        void upsertFileCacheState(
            Database& database,
            std::int64_t modId,
            std::wstring_view cacheKey,
            int entryCount)
        {
            Statement statement = database.prepare(
                "INSERT INTO mod_file_cache_state("
                "mod_id, schema_version, cache_key, entry_count, validated_at"
                ") VALUES(?, ?, ?, ?, ?) "
                "ON CONFLICT(mod_id) DO UPDATE SET "
                "schema_version = excluded.schema_version, "
                "cache_key = excluded.cache_key, "
                "entry_count = excluded.entry_count, "
                "validated_at = excluded.validated_at;");
            statement.bindInt64(1, modId);
            statement.bindInt(2, fileCacheSchemaVersion);
            statement.bindText(3, cacheKey);
            statement.bindInt(4, entryCount);
            statement.bindText(5, nowUtcText());
            statement.stepDone();
        }

        struct FileCacheEntry
        {
            std::wstring relativePath;
            std::wstring parentPath;
            std::wstring name;
            std::wstring kind;
            std::uintmax_t size{0};
            std::wstring modifiedAt;
        };

        class Win32Handle final
        {
        public:
            explicit Win32Handle(HANDLE handle = INVALID_HANDLE_VALUE) noexcept
                : handle_(handle)
            {
            }

            Win32Handle(const Win32Handle&) = delete;
            Win32Handle& operator=(const Win32Handle&) = delete;

            ~Win32Handle()
            {
                if (handle_ != INVALID_HANDLE_VALUE && handle_ != nullptr)
                {
                    CloseHandle(handle_);
                }
            }

            [[nodiscard]] HANDLE get() const noexcept
            {
                return handle_;
            }

        private:
            HANDLE handle_{INVALID_HANDLE_VALUE};
        };

        class Sha256Builder final
        {
        public:
            Sha256Builder()
            {
                if (BCryptOpenAlgorithmProvider(
                        &algorithm_,
                        BCRYPT_SHA256_ALGORITHM,
                        nullptr,
                        0) != 0)
                {
                    throw std::runtime_error("Failed to initialize SHA-256.");
                }

                ULONG objectLength = 0;
                ULONG resultLength = 0;
                if (BCryptGetProperty(
                        algorithm_,
                        BCRYPT_OBJECT_LENGTH,
                        reinterpret_cast<PUCHAR>(&objectLength),
                        sizeof(objectLength),
                        &resultLength,
                        0) != 0)
                {
                    BCryptCloseAlgorithmProvider(algorithm_, 0);
                    algorithm_ = nullptr;
                    throw std::runtime_error("Failed to query the SHA-256 object size.");
                }
                object_.resize(objectLength);
                if (BCryptCreateHash(
                        algorithm_,
                        &hash_,
                        object_.data(),
                        static_cast<ULONG>(object_.size()),
                        nullptr,
                        0,
                        0) != 0)
                {
                    BCryptCloseAlgorithmProvider(algorithm_, 0);
                    algorithm_ = nullptr;
                    throw std::runtime_error("Failed to create a SHA-256 hash.");
                }
            }

            Sha256Builder(const Sha256Builder&) = delete;
            Sha256Builder& operator=(const Sha256Builder&) = delete;

            ~Sha256Builder()
            {
                if (hash_ != nullptr)
                {
                    BCryptDestroyHash(hash_);
                }
                if (algorithm_ != nullptr)
                {
                    BCryptCloseAlgorithmProvider(algorithm_, 0);
                }
            }

            void append(const void* data, std::size_t size)
            {
                const auto* bytes = static_cast<const unsigned char*>(data);
                while (size > 0)
                {
                    const ULONG chunk = static_cast<ULONG>((std::min<std::size_t>)(
                        size,
                        (std::numeric_limits<ULONG>::max)()));
                    if (BCryptHashData(
                            hash_,
                            const_cast<PUCHAR>(bytes),
                            chunk,
                            0) != 0)
                    {
                        throw std::runtime_error("Failed to update SHA-256.");
                    }
                    bytes += chunk;
                    size -= chunk;
                }
            }

            template <typename Value>
            void appendValue(const Value& value)
            {
                append(&value, sizeof(value));
            }

            void appendText(std::wstring_view value)
            {
                const std::string utf8 = toUtf8(std::wstring(value));
                const std::uint64_t length = utf8.size();
                appendValue(length);
                append(utf8.data(), utf8.size());
            }

            [[nodiscard]] std::wstring finish(
                std::wstring_view prefix = L"file-index-v2:")
            {
                std::array<unsigned char, 32> digest{};
                if (BCryptFinishHash(
                        hash_,
                        digest.data(),
                        static_cast<ULONG>(digest.size()),
                        0) != 0)
                {
                    throw std::runtime_error("Failed to finish SHA-256.");
                }
                BCryptDestroyHash(hash_);
                hash_ = nullptr;

                std::wostringstream text;
                text << prefix << std::hex << std::setfill(L'0');
                for (const unsigned char byte : digest)
                {
                    text << std::setw(2) << static_cast<unsigned int>(byte);
                }
                return text.str();
            }

        private:
            BCRYPT_ALG_HANDLE algorithm_{nullptr};
            BCRYPT_HASH_HANDLE hash_{nullptr};
            std::vector<unsigned char> object_;
        };

        struct StableFileMetadata
        {
            std::uint64_t volumeSerial{0};
            std::array<unsigned char, 16> fileId{};
            std::int64_t changeTime{0};
            std::int64_t lastWriteTime{0};
            std::uint32_t attributes{0};
            bool stableIdentity{false};
        };

        bool volumeSupportsStableChangeIdentity(const std::filesystem::path& path)
        {
            const std::filesystem::path ioPath = pathForFilesystemIo(path);
            std::array<wchar_t, MAX_PATH> volumePath{};
            if (!GetVolumePathNameW(
                    ioPath.c_str(),
                    volumePath.data(),
                    static_cast<DWORD>(volumePath.size())))
            {
                return false;
            }
            std::array<wchar_t, 32> fileSystemName{};
            if (!GetVolumeInformationW(
                    volumePath.data(),
                    nullptr,
                    0,
                    nullptr,
                    nullptr,
                    nullptr,
                    fileSystemName.data(),
                    static_cast<DWORD>(fileSystemName.size())))
            {
                return false;
            }
            const std::wstring normalized = toLower(fileSystemName.data());
            return normalized == L"ntfs" || normalized == L"refs";
        }

        StableFileMetadata stableFileMetadata(
            const std::filesystem::path& path,
            bool isDirectory,
            bool stableVolume)
        {
#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
            stableMetadataHandleOpenCounterForTesting.fetch_add(1, std::memory_order_relaxed);
#endif
            const DWORD flags = isDirectory ? FILE_FLAG_BACKUP_SEMANTICS : FILE_ATTRIBUTE_NORMAL;
            const std::filesystem::path ioPath = pathForFilesystemIo(path);
            Win32Handle handle(CreateFileW(
                ioPath.c_str(),
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                nullptr,
                OPEN_EXISTING,
                flags,
                nullptr));
            if (handle.get() == INVALID_HANDLE_VALUE)
            {
                throw std::filesystem::filesystem_error(
                    "Failed to inspect a mod file",
                    path,
                    std::error_code(static_cast<int>(GetLastError()), std::system_category()));
            }

            FILE_BASIC_INFO basic{};
            if (!GetFileInformationByHandleEx(
                    handle.get(),
                    FileBasicInfo,
                    &basic,
                    sizeof(basic)))
            {
                throw std::filesystem::filesystem_error(
                    "Failed to read mod file change metadata",
                    path,
                    std::error_code(static_cast<int>(GetLastError()), std::system_category()));
            }

            StableFileMetadata metadata;
            metadata.changeTime = basic.ChangeTime.QuadPart;
            metadata.lastWriteTime = basic.LastWriteTime.QuadPart;
            metadata.attributes = basic.FileAttributes;

            FILE_ID_INFO identity{};
            if (stableVolume && GetFileInformationByHandleEx(
                    handle.get(),
                    FileIdInfo,
                    &identity,
                    sizeof(identity)))
            {
                metadata.volumeSerial = identity.VolumeSerialNumber;
                std::copy(
                    std::begin(identity.FileId.Identifier),
                    std::end(identity.FileId.Identifier),
                    metadata.fileId.begin());
                metadata.stableIdentity = true;
            }
            return metadata;
        }

        void appendFileContentHashInput(
            Sha256Builder& hash,
            const std::filesystem::path& path)
        {
            std::ifstream file(pathForFilesystemIo(path), std::ios::binary);
            if (!file)
            {
                throw std::filesystem::filesystem_error(
                    "Failed to hash a mod file",
                    path,
                    std::make_error_code(std::errc::permission_denied));
            }
            std::array<char, 64 * 1024> buffer{};
            while (file)
            {
                file.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
                const std::streamsize count = file.gcount();
                if (count > 0)
                {
                    hash.append(buffer.data(), static_cast<std::size_t>(count));
                }
            }
            if (!file.eof())
            {
                throw std::filesystem::filesystem_error(
                    "Failed while hashing a mod file",
                    path,
                    std::make_error_code(std::errc::io_error));
            }
        }

        struct FileCacheSnapshotEntry
        {
            FileCacheEntry cache;
            std::filesystem::path absolutePath;
            StableFileMetadata metadata;
        };

        struct FileCacheSnapshot
        {
            std::vector<FileCacheEntry> entries;
            std::wstring cacheKey;
        };

        bool appendStableDirectorySnapshotEntries(
            const std::filesystem::path& root,
            const StableFileMetadata& rootMetadata,
            std::vector<FileCacheSnapshotEntry>& scanned)
        {
            std::vector<std::filesystem::path> pendingDirectories{root};
            while (!pendingDirectories.empty())
            {
                const std::filesystem::path directory = std::move(pendingDirectories.back());
                pendingDirectories.pop_back();

                const std::filesystem::path ioDirectory = pathForFilesystemIo(directory);
                Win32Handle handle(CreateFileW(
                    ioDirectory.c_str(),
                    FILE_LIST_DIRECTORY,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    nullptr,
                    OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS,
                    nullptr));
                if (handle.get() == INVALID_HANDLE_VALUE)
                {
                    throw std::filesystem::filesystem_error(
                        "Failed to enumerate a mod directory",
                        directory,
                        std::error_code(static_cast<int>(GetLastError()), std::system_category()));
                }

                alignas(FILE_ID_EXTD_DIR_INFO) std::array<unsigned char, 64 * 1024> buffer{};
                bool restart = true;
                for (;;)
                {
                    const FILE_INFO_BY_HANDLE_CLASS informationClass = restart
                        ? FileIdExtdDirectoryRestartInfo
                        : FileIdExtdDirectoryInfo;
                    if (!GetFileInformationByHandleEx(
                            handle.get(),
                            informationClass,
                            buffer.data(),
                            static_cast<DWORD>(buffer.size())))
                    {
                        const DWORD error = GetLastError();
                        if (error == ERROR_NO_MORE_FILES)
                        {
                            break;
                        }
                        if (error == ERROR_INVALID_PARAMETER || error == ERROR_NOT_SUPPORTED)
                        {
                            return false;
                        }
                        throw std::filesystem::filesystem_error(
                            "Failed to read batched mod file metadata",
                            directory,
                            std::error_code(static_cast<int>(error), std::system_category()));
                    }
                    restart = false;

                    std::size_t offset = 0;
                    for (;;)
                    {
                        if (offset + offsetof(FILE_ID_EXTD_DIR_INFO, FileName) > buffer.size())
                        {
                            throw std::runtime_error("A batched mod directory entry is truncated.");
                        }
                        const auto* information = reinterpret_cast<const FILE_ID_EXTD_DIR_INFO*>(
                            buffer.data() + offset);
                        const std::size_t fileNameBytes = information->FileNameLength;
                        const std::size_t entryBytes =
                            offsetof(FILE_ID_EXTD_DIR_INFO, FileName) + fileNameBytes;
                        if (fileNameBytes % sizeof(wchar_t) != 0 ||
                            entryBytes > buffer.size() - offset)
                        {
                            throw std::runtime_error("A batched mod directory entry is invalid.");
                        }

                        const std::wstring name(
                            information->FileName,
                            fileNameBytes / sizeof(wchar_t));
                        if (name != L"." && name != L"..")
                        {
                            const bool isDirectory =
                                (information->FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
                            if (!(isDirectory && equalsIgnoreCase(name, manifestDirectoryName)))
                            {
                                if (information->EndOfFile.QuadPart < 0)
                                {
                                    throw std::runtime_error("A mod file reported a negative size.");
                                }
                                const std::filesystem::path current = directory / name;
                                const std::filesystem::path relative = current.lexically_relative(root);
                                if (relative.empty() || relative == L".")
                                {
                                    throw std::runtime_error(
                                        "A mod cache entry could not be made relative to its root.");
                                }

                                const bool isReparsePoint =
                                    (information->FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
                                StableFileMetadata metadata;
                                metadata.volumeSerial = rootMetadata.volumeSerial;
                                std::copy(
                                    std::begin(information->FileId.Identifier),
                                    std::end(information->FileId.Identifier),
                                    metadata.fileId.begin());
                                metadata.changeTime = information->ChangeTime.QuadPart;
                                metadata.lastWriteTime = information->LastWriteTime.QuadPart;
                                metadata.attributes = information->FileAttributes;
                                metadata.stableIdentity = true;
                                if (isReparsePoint)
                                {
                                    // Preserve the legacy scanner's target-following fingerprint
                                    // while still avoiding per-entry handles for normal files.
                                    metadata = stableFileMetadata(current, isDirectory, true);
                                }

                                const std::wstring relativeText = normalizeRelativePath(relative);
                                const std::uintmax_t fileSize =
                                    !isDirectory && isReparsePoint
                                        ? std::filesystem::file_size(pathForFilesystemIo(current))
                                        : static_cast<std::uintmax_t>(information->EndOfFile.QuadPart);
                                scanned.push_back(FileCacheSnapshotEntry{
                                    FileCacheEntry{
                                        relativeText,
                                        normalizeRelativePath(relative.parent_path()),
                                        name,
                                        isDirectory ? L"directory" : L"file",
                                        isDirectory ? 0 : fileSize,
                                        std::to_wstring(metadata.lastWriteTime)
                                    },
                                    current,
                                    metadata
                                });
#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
                                const int failureAfter =
                                    fileCacheScanFailureAfterEntriesForTesting.load(
                                        std::memory_order_relaxed);
                                if (failureAfter >= 0 &&
                                    scanned.size() >= static_cast<std::size_t>(failureAfter))
                                {
                                    throw std::runtime_error("Injected mod file cache scan failure.");
                                }
#endif
                                if (isDirectory && !isReparsePoint)
                                {
                                    pendingDirectories.push_back(std::move(current));
                                }
                            }
                        }

                        if (information->NextEntryOffset == 0)
                        {
                            break;
                        }
                        if (information->NextEntryOffset < entryBytes ||
                            information->NextEntryOffset > buffer.size() - offset)
                        {
                            throw std::runtime_error("A batched mod directory entry offset is invalid.");
                        }
                        offset += information->NextEntryOffset;
                    }
                }
            }
            return true;
        }

        FileCacheSnapshot collectFileCacheSnapshot(const InstalledModRecord& record)
        {
            if (!std::filesystem::is_directory(record.path))
            {
                throw std::filesystem::filesystem_error(
                    "Installed mod directory is unavailable",
                    record.path,
                    std::make_error_code(std::errc::no_such_file_or_directory));
            }

            const bool stableVolume = volumeSupportsStableChangeIdentity(record.path);
            const StableFileMetadata rootMetadata = stableFileMetadata(
                record.path,
                true,
                stableVolume);
            std::vector<FileCacheSnapshotEntry> scanned;
            const bool usedBatchedEnumeration =
                stableVolume &&
                rootMetadata.stableIdentity &&
                appendStableDirectorySnapshotEntries(record.path, rootMetadata, scanned);
            if (!usedBatchedEnumeration)
            {
                scanned.clear();
                std::filesystem::recursive_directory_iterator iterator(record.path);
                const std::filesystem::recursive_directory_iterator end;
                while (iterator != end)
                {
                    const std::filesystem::directory_entry entry = *iterator;
                    const std::filesystem::path current = entry.path();
                    const bool isDirectory = entry.is_directory();
                    if (isDirectory && equalsIgnoreCase(current.filename().wstring(), manifestDirectoryName))
                    {
                        iterator.disable_recursion_pending();
                        ++iterator;
                        continue;
                    }

                    const bool isFile = !isDirectory && entry.is_regular_file();
                    if (isDirectory || isFile)
                    {
                        const std::filesystem::path relative = current.lexically_relative(record.path);
                        if (relative.empty() || relative == L".")
                        {
                            throw std::runtime_error(
                                "A mod cache entry could not be made relative to its root.");
                        }
                        const std::wstring relativeText = normalizeRelativePath(relative);
                        const StableFileMetadata metadata = stableFileMetadata(
                            current,
                            isDirectory,
                            stableVolume);
                        scanned.push_back(FileCacheSnapshotEntry{
                            FileCacheEntry{
                                relativeText,
                                normalizeRelativePath(relative.parent_path()),
                                current.filename().wstring(),
                                isDirectory ? L"directory" : L"file",
                                isFile ? entry.file_size() : 0,
                                std::to_wstring(metadata.lastWriteTime)
                            },
                            current,
                            metadata
                        });
#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
                        const int failureAfter =
                            fileCacheScanFailureAfterEntriesForTesting.load(std::memory_order_relaxed);
                        if (failureAfter >= 0 &&
                            scanned.size() >= static_cast<std::size_t>(failureAfter))
                        {
                            throw std::runtime_error("Injected mod file cache scan failure.");
                        }
#endif
                    }
                    ++iterator;
                }
            }

            std::sort(
                scanned.begin(),
                scanned.end(),
                [](const FileCacheSnapshotEntry& left, const FileCacheSnapshotEntry& right)
                {
                    const std::wstring leftKey = pathKey(left.cache.relativePath);
                    const std::wstring rightKey = pathKey(right.cache.relativePath);
                    if (leftKey != rightKey)
                    {
                        return leftKey < rightKey;
                    }
                    return left.cache.kind < right.cache.kind;
                });

            Sha256Builder hash;
            hash.appendText(L"fluxora-mod-file-index-v2");
            hash.appendText(pathKey(std::filesystem::absolute(record.path).lexically_normal().wstring()));
            hash.appendValue(rootMetadata.volumeSerial);
            hash.append(rootMetadata.fileId.data(), rootMetadata.fileId.size());

            FileCacheSnapshot snapshot;
            snapshot.entries.reserve(scanned.size());
            for (const FileCacheSnapshotEntry& entry : scanned)
            {
                hash.appendText(pathKey(entry.cache.relativePath));
                hash.appendText(entry.cache.kind);
                const std::uint64_t size = entry.cache.size;
                hash.appendValue(size);
                hash.appendValue(entry.metadata.lastWriteTime);
                hash.appendValue(entry.metadata.changeTime);
                hash.appendValue(entry.metadata.attributes);
                const unsigned char stable = entry.metadata.stableIdentity ? 1U : 0U;
                hash.appendValue(stable);
                if (entry.metadata.stableIdentity)
                {
                    hash.appendValue(entry.metadata.volumeSerial);
                    hash.append(entry.metadata.fileId.data(), entry.metadata.fileId.size());
                }
                else if (entry.cache.kind == L"file")
                {
                    appendFileContentHashInput(hash, entry.absolutePath);
                }
                snapshot.entries.push_back(entry.cache);
            }
            snapshot.cacheKey = hash.finish();
            return snapshot;
        }

        std::wstring computeContentFingerprint(const std::filesystem::path& modDirectory)
        {
            InstalledModRecord record;
            record.path = modDirectory;
            return collectFileCacheSnapshot(record).cacheKey;
        }

        void insertFileCacheEntry(
            Database& database,
            std::int64_t modId,
            std::wstring_view relativePath,
            std::wstring_view parentPath,
            std::wstring_view name,
            std::wstring_view kind,
            std::uintmax_t size,
            std::wstring_view modifiedAt)
        {
            Statement insert = database.prepare(
                "INSERT INTO mod_files("
                "mod_id, relative_path, parent_path, path_key, parent_key, name, kind, size, modified_at"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(mod_id, path_key) DO UPDATE SET "
                "relative_path = excluded.relative_path,"
                "parent_path = excluded.parent_path,"
                "parent_key = excluded.parent_key,"
                "name = excluded.name,"
                "kind = excluded.kind,"
                "size = excluded.size,"
                "modified_at = excluded.modified_at;");
            insert.bindInt64(1, modId);
            insert.bindText(2, relativePath);
            insert.bindText(3, parentPath);
            insert.bindText(4, pathKey(relativePath));
            insert.bindText(5, pathKey(parentPath));
            insert.bindText(6, name);
            insert.bindText(7, kind);
            insert.bindInt64(8, static_cast<std::int64_t>(size));
            insert.bindText(9, modifiedAt);
            insert.stepDone();
        }

        void replaceFileCache(
            Database& database,
            std::int64_t modId,
            const std::vector<FileCacheEntry>& entries)
        {
            Statement remove = database.prepare("DELETE FROM mod_files WHERE mod_id = ?;");
            remove.bindInt64(1, modId);
            remove.stepDone();

            for (const FileCacheEntry& entry : entries)
            {
                insertFileCacheEntry(
                    database,
                    modId,
                    entry.relativePath,
                    entry.parentPath,
                    entry.name,
                    entry.kind,
                    entry.size,
                    entry.modifiedAt);
            }
        }

        bool cachedFileRowsMatch(
            Database& database,
            std::int64_t modId,
            const std::vector<FileCacheEntry>& expectedEntries)
        {
            Statement statement = database.prepare(
                "SELECT relative_path, parent_path, path_key, parent_key, "
                "name, kind, size, modified_at "
                "FROM mod_files WHERE mod_id = ? "
                "ORDER BY path_key COLLATE BINARY;");
            statement.bindInt64(1, modId);

            std::size_t index = 0;
            while (statement.stepRow())
            {
                if (index >= expectedEntries.size())
                {
                    return false;
                }

                const FileCacheEntry& expected = expectedEntries[index++];
                if (statement.columnText(0) != expected.relativePath ||
                    statement.columnText(1) != expected.parentPath ||
                    statement.columnText(2) != pathKey(expected.relativePath) ||
                    statement.columnText(3) != pathKey(expected.parentPath) ||
                    statement.columnText(4) != expected.name ||
                    statement.columnText(5) != expected.kind ||
                    statement.columnInt64(6) != static_cast<std::int64_t>(expected.size) ||
                    statement.columnText(7) != expected.modifiedAt)
                {
                    return false;
                }
            }
            return index == expectedEntries.size();
        }

        void updateRecordContentFingerprint(
            Database& database,
            InstalledModRecord& record,
            std::wstring fingerprint)
        {
            if (fingerprint == record.contentFingerprint)
            {
                return;
            }

            record.contentFingerprint = std::move(fingerprint);
            record.updatedAt = nowUtcText();

            Statement update = database.prepare(
                "UPDATE mods SET content_fingerprint = ?, updated_at = ? WHERE id = ?;");
            update.bindText(1, record.contentFingerprint);
            update.bindText(2, record.updatedAt);
            update.bindInt64(3, record.id);
            update.stepDone();
            if (portableManifestNeedsWrite(record, false))
            {
                writePortableManifest(record);
            }
        }

        void ensureFileCachePrepared(
            Database& database,
            InstalledModRecord& record,
            bool validateAgainstDisk = false)
        {
            const int persistedEntryCount = cachedEntryCount(database, record.id);
            const std::optional<PersistedFileCacheState> persistedState =
                readFileCacheState(database, record.id);
            const bool hasCurrentState =
                persistedState.has_value() &&
                persistedState->schemaVersion == fileCacheSchemaVersion &&
                persistedState->entryCount == persistedEntryCount &&
                !persistedState->cacheKey.empty();
            if (!validateAgainstDisk && hasCurrentState)
            {
                return;
            }

            const FileCacheSnapshot snapshot = collectFileCacheSnapshot(record);
            if (snapshot.entries.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)()))
            {
                throw std::runtime_error("A mod contains too many cache entries.");
            }
            const int snapshotEntryCount = static_cast<int>(snapshot.entries.size());
            const bool reusable =
                hasCurrentState &&
                persistedState->cacheKey == snapshot.cacheKey &&
                persistedEntryCount == snapshotEntryCount &&
                cachedFileRowsMatch(database, record.id, snapshot.entries);
            if (reusable && record.contentFingerprint == snapshot.cacheKey)
            {
                return;
            }

            Transaction transaction(database);
            if (!reusable)
            {
                replaceFileCache(database, record.id, snapshot.entries);
            }
            upsertFileCacheState(database, record.id, snapshot.cacheKey, snapshotEntryCount);
            updateRecordContentFingerprint(database, record, snapshot.cacheKey);
            transaction.commit();
        }

        struct ConflictOwner
        {
            std::int64_t modId{0};
            std::wstring displayName;
        };

        using ConflictOwnerGroups = std::map<std::wstring, std::vector<ConflictOwner>>;

        int cachedFileCount(Database& database, std::int64_t modId)
        {
            Statement statement = database.prepare(
                "SELECT COUNT(*) FROM mod_files WHERE mod_id = ? AND kind = 'file';");
            statement.bindInt64(1, modId);
            return statement.stepRow() ? statement.columnInt(0) : 0;
        }

        ConflictOwnerGroups conflictOwnersForCachedModFiles(Database& database, std::int64_t modId)
        {
            Statement statement = database.prepare(
                "SELECT selected.path_key, owner_file.mod_id, owner_mod.display_name "
                "FROM mod_files selected "
                "JOIN mod_files owner_file "
                "ON owner_file.path_key = selected.path_key AND owner_file.kind = 'file' "
                "JOIN mods owner_mod ON owner_mod.id = owner_file.mod_id "
                "WHERE selected.mod_id = ? "
                "AND selected.kind = 'file' "
                "AND owner_mod.state = 'installed' "
                "ORDER BY selected.path_key, owner_file.mod_id ASC;");
            statement.bindInt64(1, modId);

            ConflictOwnerGroups groups;
            while (statement.stepRow())
            {
                groups[statement.columnText(0)].push_back(ConflictOwner{
                    statement.columnInt64(1),
                    statement.columnText(2)
                });
            }

            return groups;
        }

        ConflictOwnerGroups conflictOwnersForCachedTreeFiles(
            Database& database,
            std::int64_t modId,
            std::wstring_view parentKey)
        {
            Statement statement = database.prepare(
                "SELECT selected.path_key, owner_file.mod_id, owner_mod.display_name "
                "FROM mod_files selected "
                "JOIN mod_files owner_file "
                "ON owner_file.path_key = selected.path_key AND owner_file.kind = 'file' "
                "JOIN mods owner_mod ON owner_mod.id = owner_file.mod_id "
                "WHERE selected.mod_id = ? "
                "AND selected.parent_key = ? "
                "AND selected.kind = 'file' "
                "AND owner_mod.state = 'installed' "
                "ORDER BY selected.path_key, owner_file.mod_id ASC;");
            statement.bindInt64(1, modId);
            statement.bindText(2, parentKey);

            ConflictOwnerGroups groups;
            while (statement.stepRow())
            {
                groups[statement.columnText(0)].push_back(ConflictOwner{
                    statement.columnInt64(1),
                    statement.columnText(2)
                });
            }

            return groups;
        }

        std::wstring conflictStateForOwners(
            const std::vector<ConflictOwner>& owners,
            std::int64_t modId)
        {
            if (owners.size() <= 1)
            {
                return {};
            }

            for (std::size_t index = 0; index < owners.size(); ++index)
            {
                if (owners[index].modId != modId)
                {
                    continue;
                }

                if (index == owners.size() - 1)
                {
                    return L"overwrites";
                }
                if (index == 0)
                {
                    return L"overwritten";
                }

                return L"conflict";
            }

            return {};
        }

        std::vector<std::wstring> ownerNames(const std::vector<ConflictOwner>& owners)
        {
            std::vector<std::wstring> names;
            names.reserve(owners.size());
            for (const ConflictOwner& owner : owners)
            {
                names.push_back(owner.displayName);
            }
            return names;
        }

        void appendUniqueConflictTarget(
            std::vector<std::wstring>& targets,
            const std::wstring& modId)
        {
            if (modId.empty())
            {
                return;
            }

            if (std::find(targets.begin(), targets.end(), modId) == targets.end())
            {
                targets.push_back(modId);
            }
        }

        void applyConflictOwnerRelations(
            ModFileSummary& summary,
            std::int64_t modId,
            const std::vector<std::int64_t>& activeOwnerIds,
            const std::map<std::int64_t, std::wstring>& modPathsById)
        {
            const auto selected = std::find(activeOwnerIds.begin(), activeOwnerIds.end(), modId);
            if (selected == activeOwnerIds.end())
            {
                return;
            }

            for (auto owner = activeOwnerIds.begin(); owner != selected; ++owner)
            {
                const auto target = modPathsById.find(*owner);
                if (target != modPathsById.end())
                {
                    appendUniqueConflictTarget(summary.overwritesModIds, target->second);
                }
            }

            for (auto owner = std::next(selected); owner != activeOwnerIds.end(); ++owner)
            {
                const auto target = modPathsById.find(*owner);
                if (target != modPathsById.end())
                {
                    appendUniqueConflictTarget(summary.overwrittenByModIds, target->second);
                }
            }
        }

        void applyConflictOwnerSummary(
            ModFileSummary& summary,
            const std::vector<ConflictOwner>& owners,
            std::int64_t modId)
        {
            if (owners.size() <= 1)
            {
                return;
            }

            const std::wstring state = conflictStateForOwners(owners, modId);
            if (state.empty())
            {
                return;
            }

            ++summary.conflictingFileCount;
            if (state == L"overwrites")
            {
                ++summary.overwritingFileCount;
            }
            else if (state == L"overwritten")
            {
                ++summary.overwrittenFileCount;
            }
            else if (state == L"conflict")
            {
                ++summary.overwritingFileCount;
                ++summary.overwrittenFileCount;
            }
        }

        void refreshDetectedConflicts(Database& database)
        {
            Statement remove = database.prepare("DELETE FROM mod_conflicts WHERE source = 'scan';");
            remove.stepDone();

            Statement insert = database.prepare(
                "INSERT OR REPLACE INTO mod_conflicts("
                "mod_id, other_mod_id, relative_path, conflict_kind, source, detected_at"
                ") "
                "SELECT owner_file.mod_id, other_file.mod_id, owner_file.relative_path, "
                "CASE WHEN owner_file.mod_id < other_file.mod_id THEN 'overwritten-by' ELSE 'overwrites' END, "
                "'scan', ? "
                "FROM mod_files owner_file "
                "JOIN mods owner_mod ON owner_mod.id = owner_file.mod_id "
                "JOIN mod_files other_file "
                "ON other_file.path_key = owner_file.path_key AND other_file.kind = 'file' "
                "JOIN mods other_mod ON other_mod.id = other_file.mod_id "
                "WHERE owner_file.kind = 'file' "
                "AND owner_mod.state = 'installed' "
                "AND other_mod.state = 'installed' "
                "AND owner_file.mod_id <> other_file.mod_id;");
            insert.bindText(1, nowUtcText());
            insert.stepDone();
        }

        std::set<std::wstring> cachedDirectoryPathKeysWithChildren(
            Database& database,
            std::int64_t modId,
            std::wstring_view parentKey)
        {
            Statement statement = database.prepare(
                "SELECT selected.path_key "
                "FROM mod_files selected "
                "JOIN mod_files child "
                "ON child.mod_id = selected.mod_id AND child.parent_key = selected.path_key "
                "WHERE selected.mod_id = ? "
                "AND selected.parent_key = ? "
                "AND selected.kind = 'directory' "
                "GROUP BY selected.path_key;");
            statement.bindInt64(1, modId);
            statement.bindText(2, parentKey);

            std::set<std::wstring> pathKeys;
            while (statement.stepRow())
            {
                pathKeys.insert(statement.columnText(0));
            }

            return pathKeys;
        }

        ModFileSummary summarizeCachedModFiles(Database& database, const InstalledModRecord& record)
        {
            ModFileSummary summary;
            summary.fileCount = cachedFileCount(database, record.id);
            if (record.state == L"disabled")
            {
                return summary;
            }

            const ConflictOwnerGroups ownersByPath = conflictOwnersForCachedModFiles(database, record.id);
            for (const auto& group : ownersByPath)
            {
                applyConflictOwnerSummary(summary, group.second, record.id);
            }

            return summary;
        }

        std::vector<ModFileSummaryRecord> summarizeCachedInstalledModFiles(
            Database& database,
            const std::vector<InstalledModRecord>& records)
        {
            std::vector<ModFileSummaryRecord> summaries;
            summaries.reserve(records.size());
            std::map<std::int64_t, std::size_t> summaryIndexes;
            std::map<std::int64_t, std::wstring> modPathsById;
            for (const InstalledModRecord& record : records)
            {
                const std::size_t index = summaries.size();
                summaryIndexes.emplace(record.id, index);
                modPathsById.emplace(record.id, record.path.wstring());
                summaries.push_back(ModFileSummaryRecord{
                    record.folderName,
                    record.path,
                    ModFileSummary{}
                });
            }

            std::vector<bool> currentCacheStates(summaries.size(), false);
            Statement fileCounts = database.prepare(
                "SELECT m.id, "
                "COUNT(f.mod_id), "
                "COALESCE(SUM(CASE WHEN f.kind = 'file' THEN 1 ELSE 0 END), 0), "
                "COALESCE(s.schema_version, 0), "
                "COALESCE(s.cache_key, ''), "
                "COALESCE(s.entry_count, -1) "
                "FROM mods m "
                "LEFT JOIN mod_files f ON f.mod_id = m.id "
                "LEFT JOIN mod_file_cache_state s ON s.mod_id = m.id "
                "WHERE m.state IN ('installed', 'disabled') "
                "GROUP BY m.id, s.schema_version, s.cache_key, s.entry_count;");
            while (fileCounts.stepRow())
            {
                const auto summaryIndex = summaryIndexes.find(fileCounts.columnInt64(0));
                if (summaryIndex != summaryIndexes.end())
                {
                    const std::size_t index = summaryIndex->second;
                    const int persistedEntryCount = fileCounts.columnInt(1);
                    const std::wstring cacheKey = fileCounts.columnText(4);
                    summaries[index].summary.fileCount = fileCounts.columnInt(2);
                    currentCacheStates[index] =
                        fileCounts.columnInt(3) == fileCacheSchemaVersion &&
                        fileCounts.columnInt(5) == persistedEntryCount &&
                        !cacheKey.empty() &&
                        records[index].contentFingerprint == cacheKey;
                }
            }

            // Reconciliation materializes only the conflicting paths. Startup
            // summaries should aggregate that compact delta instead of sorting
            // every cached file row again.
            Statement conflictCounts = database.prepare(
                "SELECT mod_id, "
                "COUNT(DISTINCT relative_path), "
                "COUNT(DISTINCT CASE WHEN conflict_kind = 'overwritten-by' THEN relative_path END), "
                "COUNT(DISTINCT CASE WHEN conflict_kind = 'overwrites' THEN relative_path END) "
                "FROM mod_conflicts WHERE source = 'scan' GROUP BY mod_id;");
            while (conflictCounts.stepRow())
            {
                const auto summaryIndex = summaryIndexes.find(conflictCounts.columnInt64(0));
                if (summaryIndex == summaryIndexes.end())
                {
                    continue;
                }
                ModFileSummary& summary = summaries[summaryIndex->second].summary;
                summary.conflictingFileCount = conflictCounts.columnInt(1);
                summary.overwrittenFileCount = conflictCounts.columnInt(2);
                summary.overwritingFileCount = conflictCounts.columnInt(3);
            }

            Statement relations = database.prepare(
                "SELECT mod_id, other_mod_id, conflict_kind "
                "FROM mod_conflicts WHERE source = 'scan' "
                "GROUP BY mod_id, other_mod_id, conflict_kind "
                "ORDER BY mod_id, conflict_kind, other_mod_id;");
            while (relations.stepRow())
            {
                const auto summaryIndex = summaryIndexes.find(relations.columnInt64(0));
                const auto targetPath = modPathsById.find(relations.columnInt64(1));
                if (summaryIndex == summaryIndexes.end() || targetPath == modPathsById.end())
                {
                    continue;
                }
                ModFileSummary& summary = summaries[summaryIndex->second].summary;
                const std::wstring kind = relations.columnText(2);
                if (kind == L"overwrites")
                {
                    appendUniqueConflictTarget(summary.overwritesModIds, targetPath->second);
                }
                else if (kind == L"overwritten-by")
                {
                    appendUniqueConflictTarget(summary.overwrittenByModIds, targetPath->second);
                }
            }

            for (std::size_t index = 0; index < summaries.size(); ++index)
            {
                if (!currentCacheStates[index])
                {
                    summaries[index].summary = ModFileSummary{};
                    summaries[index].summary.fileCount = -1;
                }
            }

            return summaries;
        }

        std::wstring conflictInputsKey(const std::vector<InstalledModRecord>& records)
        {
            std::vector<const InstalledModRecord*> ordered;
            ordered.reserve(records.size());
            for (const InstalledModRecord& record : records)
            {
                ordered.push_back(&record);
            }
            std::sort(
                ordered.begin(),
                ordered.end(),
                [](const InstalledModRecord* left, const InstalledModRecord* right)
                {
                    return left->id < right->id;
                });

            Sha256Builder hash;
            hash.appendText(L"fluxora-conflict-inputs-v1");
            const std::uint64_t count = ordered.size();
            hash.appendValue(count);
            for (const InstalledModRecord* record : ordered)
            {
                hash.appendValue(record->id);
                hash.appendText(record->state);
                hash.appendText(record->contentFingerprint);
            }
            return hash.finish(L"conflict-inputs-v1:");
        }

        void ensureAllFileCachesPrepared(
            Database& database,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsRoot = {})
        {
            syncInstalledModsFromDisk(database, projectDirectory, modsRoot);
            std::vector<InstalledModRecord> records = readInstalledRecords(database, projectDirectory, modsRoot);
            const bool validateAgainstDisk = fileCacheValidationRequiredLocked(projectDirectory);

            for (InstalledModRecord& record : records)
            {
                ensureFileCachePrepared(database, record, validateAgainstDisk);
            }

            const std::wstring inputsKey = conflictInputsKey(records);
            if (readMetadataValue(database, L"mod_conflict_inputs_key") != inputsKey)
            {
                Transaction transaction(database);
                refreshDetectedConflicts(database);
                setMetadataValue(database, L"mod_conflict_inputs_key", inputsKey);
                transaction.commit();
            }
            markFileCacheValidatedLocked(projectDirectory);
            markLaunchInventoryReconciledLocked(projectDirectory);
        }

        PendingInstallSessionRecord readPendingInstallSession(
            Database& database,
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            bool includeProfileRows)
        {
            Statement session = database.prepare(
                "SELECT operation_id, profile_name, mode, target_mod_uuid, target_position, "
                "revision, state, final_order_id, pending_order_id, before_order_id, "
                "after_order_id, enqueue_sequence "
                "FROM pending_install_sessions WHERE operation_id = ? LIMIT 1;");
            session.bindText(1, operationId);
            if (!session.stepRow())
            {
                throw std::runtime_error("The pending install session was not found.");
            }

            PendingInstallSessionRecord record;
            record.operationId = session.columnText(0);
            record.profileName = session.columnText(1);
            record.mode = static_cast<InstallConflictPreviewMode>(session.columnInt(2));
            record.targetModUuid = session.columnText(3);
            record.targetPosition = session.columnInt(4);
            try
            {
                record.revision = static_cast<std::uint64_t>(
                    std::stoull(session.columnText(5)));
            }
            catch (const std::exception&)
            {
                record.revision = 0;
            }
            record.state = session.columnText(6);
            record.finalOrderId = session.columnText(7);
            record.pendingOrderId = session.columnText(8);
            record.beforeOrderId = session.columnText(9);
            record.afterOrderId = session.columnText(10);
            const std::int64_t enqueueSequence = session.columnInt64(11);
            record.enqueueSequence = enqueueSequence < 0
                ? 0
                : static_cast<std::uint64_t>(enqueueSequence);

            Statement files = database.prepare(
                "SELECT relative_path, size, modified_at "
                "FROM pending_install_files WHERE operation_id = ? ORDER BY path_key;");
            files.bindText(1, operationId);
            while (files.stepRow())
            {
                InstallConflictFile file;
                file.relativePath = files.columnText(0);
                const std::int64_t size = files.columnInt64(1);
                file.size = size < 0 ? 0 : static_cast<std::uintmax_t>(size);
                file.modifiedAt = files.columnText(2);
                record.files.push_back(std::move(file));
            }

            if (!includeProfileRows)
            {
                return record;
            }

            const std::vector<ProfileOrderItemRecord> profileRows = readProfileOrderItems(
                database,
                projectDirectory,
                record.profileName);
            record.profileRows.reserve(profileRows.size());
            std::map<std::int64_t, std::vector<InstallConflictFile>> cachedFiles;
            Statement modFiles = database.prepare(
                "SELECT f.mod_id, f.relative_path, f.size, f.modified_at "
                "FROM mod_files f JOIN profile_order_items oi ON oi.mod_id = f.mod_id "
                "WHERE oi.profile_name = ? AND oi.kind = 'mod' AND f.kind = 'file' "
                "ORDER BY oi.position, f.path_key;");
            modFiles.bindText(1, record.profileName);
            while (modFiles.stepRow())
            {
                InstallConflictFile file;
                file.relativePath = modFiles.columnText(1);
                const std::int64_t size = modFiles.columnInt64(2);
                file.size = size < 0 ? 0 : static_cast<std::uintmax_t>(size);
                file.modifiedAt = modFiles.columnText(3);
                cachedFiles[modFiles.columnInt64(0)].push_back(std::move(file));
            }
            for (const ProfileOrderItemRecord& profileRow : profileRows)
            {
                InstallConflictProfileMod row;
                row.orderId = profileRow.id;
                row.separator = profileRow.kind == profileOrderSeparatorKind;
                if (!row.separator && profileRow.hasMod)
                {
                    row.modUuid = profileRow.mod.uuid;
                    row.relationId = profileRow.mod.uuid;
                    row.enabled = profileRow.mod.state == L"installed";
                    const auto selectedFiles = cachedFiles.find(profileRow.mod.id);
                    if (selectedFiles != cachedFiles.end())
                    {
                        row.files = selectedFiles->second;
                    }
                }
                record.profileRows.push_back(std::move(row));
            }
            return record;
        }

        void cleanupPendingInstallSessions(Database& database)
        {
            database.exec(
                "DELETE FROM pending_install_sessions "
                "WHERE (state IN ('completed', 'failed') AND datetime(updated_at) < datetime('now', '-1 day')) "
                "OR (state IN ('preparing', 'ready', 'committing') "
                "AND datetime(updated_at) < datetime('now', '-7 days'));"
            );
        }

        int resolvedInstallTargetPosition(
            Database& database,
            const PendingInstallSessionRecord& session)
        {
            const std::vector<ProfileOrderItemRecord> rows = readProfileOrderItems(
                database,
                {},
                session.profileName);
            if (!session.afterOrderId.empty())
            {
                const auto after = std::find_if(rows.begin(), rows.end(), [&](const auto& row)
                {
                    return row.id == session.afterOrderId;
                });
                if (after != rows.end())
                {
                    return static_cast<int>(std::distance(rows.begin(), after));
                }
            }
            if (!session.beforeOrderId.empty())
            {
                const auto before = std::find_if(rows.begin(), rows.end(), [&](const auto& row)
                {
                    return row.id == session.beforeOrderId;
                });
                if (before != rows.end())
                {
                    return static_cast<int>(std::distance(rows.begin(), before) + 1);
                }
            }
            return session.targetPosition;
        }

        void moveCompletedPendingInstall(
            Database& database,
            const PendingInstallSessionRecord& session,
            int targetPosition)
        {
            if (session.finalOrderId.empty())
            {
                return;
            }
            syncProfileOrderItems(database, session.profileName);
            const int resolvedTarget =
                session.beforeOrderId.empty() && session.afterOrderId.empty()
                    ? targetPosition
                    : resolvedInstallTargetPosition(database, session);
            if (resolvedTarget < 0)
            {
                return;
            }
            moveProfileOrderStorageItems(
                database,
                session.profileName,
                "profile_order_items",
                session.finalOrderId,
                resolvedTarget,
                profileOrderSeparatorKind,
                ProfileOrderSeparatorMoveMode::Single);
        }

        struct ProfileFileOwner
        {
            std::int64_t modId{0};
            bool active{false};
        };

        void applyProfileConflictGroup(
            const std::vector<ProfileFileOwner>& owners,
            const std::map<std::int64_t, std::size_t>& summaryIndexes,
            const std::map<std::int64_t, std::wstring>& modPathsById,
            std::vector<ModFileSummaryRecord>& summaries)
        {
            std::vector<std::int64_t> activeOwnerIds;
            activeOwnerIds.reserve(owners.size());
            for (const ProfileFileOwner& owner : owners)
            {
                if (owner.active)
                {
                    activeOwnerIds.push_back(owner.modId);
                }
            }

            if (activeOwnerIds.size() <= 1)
            {
                return;
            }

            for (std::size_t index = 0; index < activeOwnerIds.size(); ++index)
            {
                const auto summaryIndex = summaryIndexes.find(activeOwnerIds[index]);
                if (summaryIndex == summaryIndexes.end())
                {
                    continue;
                }

                ModFileSummary& summary = summaries[summaryIndex->second].summary;
                ++summary.conflictingFileCount;
                if (index == 0)
                {
                    ++summary.overwrittenFileCount;
                }
                else if (index == activeOwnerIds.size() - 1)
                {
                    ++summary.overwritingFileCount;
                }
                else
                {
                    ++summary.overwrittenFileCount;
                    ++summary.overwritingFileCount;
                }

                applyConflictOwnerRelations(
                    summary,
                    activeOwnerIds[index],
                    activeOwnerIds,
                    modPathsById);
            }
        }

        std::vector<ModFileSummaryRecord> summarizeCachedProfileModFiles(
            Database& database,
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsRoot = {})
        {
            const std::wstring normalizedProfileName = profileNameOrDefault(profileName);

            Transaction transaction(database);
            syncProfileOrderItems(database, normalizedProfileName);
            transaction.commit();

            const std::vector<ProfileOrderItemRecord> orderItems =
                readProfileOrderItems(database, projectDirectory, normalizedProfileName, modsRoot);

            std::vector<ModFileSummaryRecord> summaries;
            summaries.reserve(orderItems.size());
            std::map<std::int64_t, std::size_t> summaryIndexes;
            std::map<std::int64_t, std::wstring> modPathsById;
            for (const ProfileOrderItemRecord& item : orderItems)
            {
                if (item.kind != profileOrderModKind || !item.hasMod)
                {
                    continue;
                }

                const std::size_t index = summaries.size();
                summaryIndexes.emplace(item.mod.id, index);
                modPathsById.emplace(item.mod.id, item.mod.path.wstring());
                summaries.push_back(ModFileSummaryRecord{
                    item.mod.folderName,
                    item.mod.path,
                    ModFileSummary{}
                });
            }

            Statement fileCounts = database.prepare(
                "SELECT f.mod_id, COUNT(*) "
                "FROM mod_files f "
                "JOIN profile_order_items oi ON oi.mod_id = f.mod_id "
                "JOIN mods m ON m.id = f.mod_id "
                "WHERE oi.profile_name = ? "
                "AND oi.kind = 'mod' "
                "AND f.kind = 'file' "
                "AND m.state IN ('installed', 'disabled') "
                "GROUP BY f.mod_id;");
            fileCounts.bindText(1, normalizedProfileName);
            while (fileCounts.stepRow())
            {
                const auto summaryIndex = summaryIndexes.find(fileCounts.columnInt64(0));
                if (summaryIndex != summaryIndexes.end())
                {
                    summaries[summaryIndex->second].summary.fileCount = fileCounts.columnInt(1);
                }
            }

            Statement statement = database.prepare(
                "SELECT f.path_key, f.mod_id "
                "FROM mod_conflicts c "
                "JOIN mod_files f ON f.mod_id = c.mod_id "
                "AND f.relative_path = c.relative_path COLLATE NOCASE "
                "AND f.kind = 'file' "
                "JOIN profile_order_items oi ON oi.mod_id = f.mod_id "
                "JOIN mods m ON m.id = f.mod_id "
                "WHERE c.source = 'scan' "
                "AND oi.profile_name = ? "
                "AND oi.kind = 'mod' "
                "AND m.state = 'installed' "
                "GROUP BY f.path_key, f.mod_id, oi.position, oi.rowid "
                "ORDER BY f.path_key, oi.position, oi.rowid;");
            statement.bindText(1, normalizedProfileName);

            std::wstring currentPathKey;
            std::vector<ProfileFileOwner> owners;
            while (statement.stepRow())
            {
                const std::wstring itemPathKey = statement.columnText(0);
                if (!currentPathKey.empty() && itemPathKey != currentPathKey)
                {
                    applyProfileConflictGroup(owners, summaryIndexes, modPathsById, summaries);
                    owners.clear();
                }

                currentPathKey = itemPathKey;

                const std::int64_t modId = statement.columnInt64(1);
                owners.push_back(ProfileFileOwner{
                    modId,
                    true
                });
            }

            if (!owners.empty())
            {
                applyProfileConflictGroup(owners, summaryIndexes, modPathsById, summaries);
            }

            return summaries;
        }

        std::set<std::wstring> activeInstalledModFolders(Database& database)
        {
            Statement statement = database.prepare(
                "SELECT folder_name FROM mods WHERE state IN ('installed', 'disabled');");

            std::set<std::wstring> folders;
            while (statement.stepRow())
            {
                folders.insert(statement.columnText(0));
            }

            return folders;
        }

        void markInstalledModsMissingFromDiskDeleted(
            Database& database,
            const std::set<std::wstring>& diskFolders)
        {
            Statement statement = database.prepare(
                "SELECT folder_name FROM mods WHERE state IN ('installed', 'disabled');");

            std::vector<std::wstring> missingFolders;
            while (statement.stepRow())
            {
                const std::wstring folderName = statement.columnText(0);
                if (!diskFolders.contains(folderName))
                {
                    missingFolders.push_back(folderName);
                }
            }

            if (missingFolders.empty())
            {
                return;
            }

            const std::wstring now = nowUtcText();
            for (const std::wstring& folderName : missingFolders)
            {
                Statement update = database.prepare(
                    "UPDATE mods SET state = 'deleted', updated_at = ? WHERE folder_name = ?;");
                update.bindText(1, now);
                update.bindText(2, folderName);
                update.stepDone();
            }
            bumpModInventoryRevision(database);
        }

        bool isTransientModDirectoryName(std::wstring_view folderName)
        {
            if (folderName.empty() || folderName.front() == L'.')
            {
                return true;
            }

            constexpr std::array<std::wstring_view, 4> suffixes{
                L".fomod-package",
                L".installing",
                L".merging",
                L".replacing"
            };
            for (std::wstring_view suffix : suffixes)
            {
                if (folderName.size() >= suffix.size() &&
                    std::equal(
                        suffix.rbegin(),
                        suffix.rend(),
                        folderName.rbegin(),
                        [](wchar_t left, wchar_t right)
                        {
                            return std::towlower(left) == std::towlower(right);
                        }))
                {
                    return true;
                }
            }

            return false;
        }

        void syncInstalledModsFromDisk(
            Database& database,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsRoot)
        {
#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
            inventorySyncInvocationCount.fetch_add(1, std::memory_order_relaxed);
#endif
            const std::filesystem::path directory = modsDirectory(projectDirectory, modsRoot);
            if (!std::filesystem::exists(directory) || !std::filesystem::is_directory(directory))
            {
                return;
            }

            const std::set<std::wstring> activeFolders = activeInstalledModFolders(database);
            std::set<std::wstring> diskFolders;

            Transaction transaction(database);
            for (const auto& entry : std::filesystem::directory_iterator(directory))
            {
                if (!entry.is_directory())
                {
                    continue;
                }

                const std::wstring folderName = entry.path().filename().wstring();
                if (isTransientModDirectoryName(folderName))
                {
                    continue;
                }

                diskFolders.insert(folderName);
                if (activeFolders.contains(folderName))
                {
                    try
                    {
                        InstalledModRecord record =
                            readRecordByFolder(database, projectDirectory, folderName, directory);
                        if (portableManifestNeedsWrite(record, false))
                        {
                            writePortableManifest(record);
                        }
                    }
                    catch (const std::exception&)
                    {
                    }

                    continue;
                }

                std::optional<InstalledModRecord> manifestRecord;
                try
                {
                    manifestRecord = readManifestRecord(entry.path());
                }
                catch (const std::exception&)
                {
                    manifestRecord = std::nullopt;
                }

                InstalledModRecord record = manifestRecord.value_or(InstalledModRecord{
                    0,
                    {},
                    readMetadataValue(database, L"game_id"),
                    folderName,
                    folderName,
                    {},
                    nowUtcText(),
                    nowUtcText(),
                    L"installed",
                    {},
                    false,
                    false,
                    true,
                    false,
                    false,
                    entry.path(),
                    ModSourceRecord{L"manual"}
                });

                record.folderName = folderName;
                record.path = entry.path();

                upsertModRecord(database, record);
                if (portableManifestNeedsWrite(record, false))
                {
                    writePortableManifest(record);
                }
            }

            markInstalledModsMissingFromDiskDeleted(database, diskFolders);
            transaction.commit();
        }
    }

    void InstanceMetadataStore::ensureInstance(
        const std::filesystem::path& projectDirectory,
        std::wstring_view gameId)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        std::wstring resolvedGameId;
        {
            Database database = openInstanceDatabase(projectDirectory);

            Transaction transaction(database);
            if (readMetadataValue(database, L"created_at").empty())
            {
                setMetadataValue(database, L"created_at", nowUtcText());
            }
            setMetadataValue(database, L"schema_version", L"2");
            if (!gameId.empty())
            {
                setMetadataValue(database, L"game_id", gameId);
            }
            resolvedGameId = gameId.empty()
                ? readMetadataValue(database, L"game_id")
                : std::wstring(gameId);
            transaction.commit();
        }
        // The cache carries a database/WAL stamp. It keeps path resolution out
        // of the metadata commit lock while still invalidating when another
        // process replaces, corrupts, or changes the schema database.
        cacheProjectGameId(projectDirectory, std::move(resolvedGameId));
    }

    std::wstring InstanceMetadataStore::gameId(
        const std::filesystem::path& projectDirectory)
    {
        if (const std::optional<std::wstring> cached = cachedProjectGameId(projectDirectory))
        {
            return *cached;
        }

        const std::lock_guard metadataLock(metadataStoreMutex());

        Database database = openInstanceDatabase(projectDirectory);
        std::wstring resolvedGameId = readMetadataValue(database, L"game_id");
        cacheProjectGameId(projectDirectory, resolvedGameId);
        return resolvedGameId;
    }

    void InstanceMetadataStore::beginProjectActivation(
        const std::filesystem::path& projectDirectory)
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }
        const std::lock_guard metadataLock(metadataStoreMutex());
        const std::filesystem::path databasePath = instanceDatabasePath(projectDirectory);
        std::wstring activeGameId;
        if (std::filesystem::is_regular_file(databasePath))
        {
            Database database = openInstanceDatabase(projectDirectory);
            database.exec("DELETE FROM archive_install_attempts;");
            activeGameId = readMetadataValue(database, L"game_id");
        }
        // Reopening the same continuously watched project is not an uncovered
        // interval. A project switch (or a new process) advances the generation;
        // live watcher events invalidate affected durable rows directly.
        beginFileCacheActivationLocked(projectDirectory);
        cacheProjectGameId(projectDirectory, std::move(activeGameId));
    }

    ArchiveBuildStatus InstanceMetadataStore::archiveBuildStatus(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveSha256)
    {
        const std::wstring sha256 = trim(std::wstring(archiveSha256));
        if (projectDirectory.empty() || sha256.empty())
        {
            throw std::invalid_argument("Project directory and archive SHA-256 are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);

        Statement attempt = database.prepare(
            "SELECT 1 FROM archive_install_attempts WHERE archive_sha256 = ? LIMIT 1;");
        attempt.bindText(1, sha256);
        if (attempt.stepRow())
        {
            return ArchiveBuildStatus::Installing;
        }

        Statement current = database.prepare(
            "SELECT 1 FROM archive_mod_links AS links "
            "JOIN mods ON mods.id = links.mod_id "
            "WHERE links.archive_sha256 = ? AND links.is_current = 1 "
            "AND mods.state IN ('installed', 'disabled') LIMIT 1;");
        current.bindText(1, sha256);
        if (current.stepRow())
        {
            return ArchiveBuildStatus::Installed;
        }

        Statement history = database.prepare(
            "SELECT 1 FROM archive_mod_links WHERE archive_sha256 = ? LIMIT 1;");
        history.bindText(1, sha256);
        return history.stepRow() ? ArchiveBuildStatus::Deleted : ArchiveBuildStatus::Ready;
    }

    void InstanceMetadataStore::beginArchiveInstallAttempt(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveSha256,
        std::wstring_view operationId,
        std::wstring_view targetFolderName)
    {
        const std::wstring sha256 = trim(std::wstring(archiveSha256));
        const std::wstring operation = trim(std::wstring(operationId));
        const std::wstring targetFolder = trim(std::wstring(targetFolderName));
        if (projectDirectory.empty() || sha256.empty() || operation.empty() || targetFolder.empty())
        {
            throw std::invalid_argument(
                "Project directory, archive SHA-256, operation id, and target folder are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Statement insert = database.prepare(
            "INSERT INTO archive_install_attempts("
            "operation_id, archive_sha256, target_folder_name, started_at"
            ") VALUES(?, ?, ?, ?) "
            "ON CONFLICT(operation_id) DO UPDATE SET "
            "archive_sha256 = excluded.archive_sha256, "
            "target_folder_name = excluded.target_folder_name, "
            "started_at = excluded.started_at;");
        insert.bindText(1, operation);
        insert.bindText(2, sha256);
        insert.bindText(3, targetFolder);
        insert.bindText(4, nowUtcText());
        insert.stepDone();
    }

    namespace
    {
        void completeArchiveInstallAttemptRows(
            Database& database,
            std::wstring_view archiveSha256,
            std::int64_t modId,
            std::wstring_view modUuid,
            std::wstring_view operationId,
            bool mergeLink)
        {
            Statement attempt = database.prepare(
                "SELECT archive_sha256 FROM archive_install_attempts WHERE operation_id = ? LIMIT 1;");
            attempt.bindText(1, operationId);
            if (!attempt.stepRow() || attempt.columnText(0) != archiveSha256)
            {
                throw std::runtime_error("The archive install attempt is no longer active.");
            }

            const std::wstring now = nowUtcText();
            Statement deactivate = database.prepare(
                mergeLink
                    ? "UPDATE archive_mod_links SET is_current = 0, unlinked_at = ? "
                      "WHERE mod_id = ? AND archive_sha256 = ? AND is_current = 1;"
                    : "UPDATE archive_mod_links SET is_current = 0, unlinked_at = ? "
                      "WHERE mod_id = ? AND is_current = 1;");
            deactivate.bindText(1, now);
            deactivate.bindInt64(2, modId);
            if (mergeLink)
            {
                deactivate.bindText(3, archiveSha256);
            }
            deactivate.stepDone();

            Statement link = database.prepare(
                "INSERT INTO archive_mod_links("
                "archive_sha256, mod_id, mod_uuid, is_current, linked_at, operation_id"
                ") VALUES(?, ?, ?, 1, ?, ?);");
            link.bindText(1, archiveSha256);
            link.bindInt64(2, modId);
            link.bindText(3, modUuid);
            link.bindText(4, now);
            link.bindText(5, operationId);
            link.stepDone();

            Statement clear = database.prepare(
                "DELETE FROM archive_install_attempts WHERE operation_id = ?;");
            clear.bindText(1, operationId);
            clear.stepDone();
        }

        void applyModIdentityPersistenceRows(
            Database& database,
            const std::filesystem::path& projectDirectory,
            InstalledModRecord& record,
            const ModIdentityPersistenceUpdate& update)
        {
            const std::int64_t modId = record.id;
            if (!trim(update.fomodModuleId).empty())
            {
                Statement metadata = database.prepare(
                    "INSERT INTO mod_identity_metadata(mod_id, fomod_module_id) VALUES(?, ?) "
                    "ON CONFLICT(mod_id) DO UPDATE SET fomod_module_id = excluded.fomod_module_id;");
                metadata.bindInt64(1, modId);
                metadata.bindText(2, trim(update.fomodModuleId));
                metadata.stepDone();
            }

            if (!identitySourceKey(
                    update.sourceProvider,
                    update.sourceGameDomain,
                    update.sourceRemoteModId).empty())
            {
                const std::wstring normalizedProvider = toLower(trim(update.sourceProvider));
                Statement source = database.prepare(
                    "INSERT INTO mod_sources("
                    "mod_id, provider, game_domain, remote_mod_id, remote_file_id, url, last_checked_at, latest_version"
                    ") VALUES(?, ?, ?, ?, ?, '', ?, '') "
                    "ON CONFLICT(mod_id) DO UPDATE SET "
                    "provider = excluded.provider, game_domain = excluded.game_domain, "
                    "remote_mod_id = excluded.remote_mod_id, remote_file_id = excluded.remote_file_id, "
                    "last_checked_at = excluded.last_checked_at;");
                source.bindInt64(1, modId);
                source.bindText(2, normalizedProvider);
                source.bindText(3, toLower(trim(update.sourceGameDomain)));
                source.bindText(4, trim(update.sourceRemoteModId));
                source.bindText(5, trim(update.sourceRemoteFileId));
                source.bindText(6, nowUtcText());
                source.stepDone();

                Statement flags = database.prepare(
                    "UPDATE mods SET source_is_nexus = ?, source_is_moddingflow = ?, "
                    "is_local = 0, updated_at = ? WHERE id = ?;");
                flags.bindInt64(1, normalizedProvider == L"nexus" ? 1 : 0);
                flags.bindInt64(2, normalizedProvider == L"moddingflow" ? 1 : 0);
                flags.bindText(3, nowUtcText());
                flags.bindInt64(4, modId);
                flags.stepDone();
            }

            const std::wstring confirmedAt = nowUtcText();
            for (const std::wstring& alias : update.confirmedAliases)
            {
                const std::wstring cleanAlias = trim(alias);
                const std::wstring normalizedAlias = ModIdentityResolver::normalizedName(cleanAlias);
                if (normalizedAlias.empty())
                {
                    continue;
                }
                Statement insert = database.prepare(
                    "INSERT INTO mod_identity_aliases(mod_id, alias, normalized_alias, confirmed_at) "
                    "VALUES(?, ?, ?, ?) ON CONFLICT(mod_id, normalized_alias) DO UPDATE SET "
                    "alias = excluded.alias, confirmed_at = excluded.confirmed_at;");
                insert.bindInt64(1, modId);
                insert.bindText(2, cleanAlias);
                insert.bindText(3, normalizedAlias);
                insert.bindText(4, confirmedAt);
                insert.stepDone();
            }

            const std::wstring sourceKey = identitySourceKey(
                update.exclusionProvider,
                update.exclusionGameDomain,
                update.exclusionRemoteModId);
            const std::wstring incomingNameKey =
                ModIdentityResolver::normalizedName(update.exclusionIncomingName);
            for (const std::wstring& rejectedUuid : update.rejectedModUuids)
            {
                if (trim(rejectedUuid).empty() || (sourceKey.empty() && incomingNameKey.empty()))
                {
                    continue;
                }
                Statement insert = database.prepare(
                    "INSERT OR IGNORE INTO mod_identity_exclusions("
                    "owner_mod_id, source_key, incoming_name_key, rejected_mod_uuid, created_at"
                    ") VALUES(?, ?, ?, ?, ?);");
                insert.bindInt64(1, modId);
                insert.bindText(2, sourceKey);
                insert.bindText(3, incomingNameKey);
                insert.bindText(4, trim(rejectedUuid));
                insert.bindText(5, confirmedAt);
                insert.stepDone();
            }

            record = readRecordByFolder(
                database,
                projectDirectory,
                record.folderName,
                record.path.parent_path());
            record.fomodModuleId = identityFomodModuleId(database, modId);
            record.identityAliases = identityAliases(database, modId);
            record.identityExcludedModUuids.clear();
            Statement exclusions = database.prepare(
                "SELECT DISTINCT rejected_mod_uuid FROM mod_identity_exclusions "
                "WHERE owner_mod_id = ? ORDER BY rejected_mod_uuid;");
            exclusions.bindInt64(1, modId);
            while (exclusions.stepRow())
            {
                record.identityExcludedModUuids.push_back(exclusions.columnText(0));
            }
            record.portableManifestSchemaVersion = 2;
            syncIdentitySearchIndex(database, record);
            bumpModInventoryRevision(database);
        }
    }

    void InstanceMetadataStore::completeArchiveInstallAttempt(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveSha256,
        std::wstring_view modUuid,
        std::wstring_view operationId,
        ArchiveModLinkMode linkMode)
    {
        const std::wstring sha256 = trim(std::wstring(archiveSha256));
        const std::wstring uuid = trim(std::wstring(modUuid));
        const std::wstring operation = trim(std::wstring(operationId));
        if (projectDirectory.empty() || sha256.empty() || uuid.empty() || operation.empty())
        {
            throw std::invalid_argument(
                "Project directory, archive SHA-256, mod UUID, and operation id are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);

        Statement mod = database.prepare("SELECT id FROM mods WHERE uuid = ? LIMIT 1;");
        mod.bindText(1, uuid);
        if (!mod.stepRow())
        {
            throw std::runtime_error("The installed mod record was not found.");
        }
        const std::int64_t modId = mod.columnInt64(0);
        completeArchiveInstallAttemptRows(
            database,
            sha256,
            modId,
            uuid,
            operation,
            linkMode == ArchiveModLinkMode::Merge);
        transaction.commit();
    }

    void InstanceMetadataStore::failArchiveInstallAttempt(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId)
    {
        const std::wstring operation = trim(std::wstring(operationId));
        if (projectDirectory.empty() || operation.empty())
        {
            throw std::invalid_argument("Project directory and operation id are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Statement clear = database.prepare(
            "DELETE FROM archive_install_attempts WHERE operation_id = ?;");
        clear.bindText(1, operation);
        clear.stepDone();
    }

    void InstanceMetadataStore::beginPendingInstallSession(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId,
        std::wstring_view profileName,
        InstallConflictPreviewMode mode,
        std::wstring_view pendingOrderId,
        std::wstring_view targetModUuid,
        int targetPosition,
        std::wstring_view beforeOrderId,
        std::wstring_view afterOrderId)
    {
        const std::wstring operation = trim(std::wstring(operationId));
        const std::wstring pendingId = trim(std::wstring(pendingOrderId));
        const std::wstring targetUuid = trim(std::wstring(targetModUuid));
        if (projectDirectory.empty() || operation.empty() || pendingId.empty())
        {
            throw std::invalid_argument(
                "Project directory, operation id, and pending order id are required.");
        }
        if (mode != InstallConflictPreviewMode::Install && targetUuid.empty())
        {
            throw std::invalid_argument("Replace and merge sessions require a target mod UUID.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        cleanupPendingInstallSessions(database);

        Statement removeTerminal = database.prepare(
            "DELETE FROM pending_install_sessions "
            "WHERE operation_id = ? AND state IN ('completed', 'failed');");
        removeTerminal.bindText(1, operation);
        removeTerminal.stepDone();

        syncProfileOrderItems(database, profileNameOrDefault(profileName));
        const std::vector<ProfileOrderItemRecord> profileRows = readProfileOrderItems(
            database,
            projectDirectory,
            profileNameOrDefault(profileName));
        std::wstring beforeId = trim(std::wstring(beforeOrderId));
        std::wstring afterId = trim(std::wstring(afterOrderId));
        if (beforeId.empty() && afterId.empty())
        {
            Statement persistedAnchors = database.prepare(
                "SELECT before_order_id, after_order_id FROM install_operations "
                "WHERE operation_id = ? LIMIT 1;");
            persistedAnchors.bindText(1, operation);
            if (persistedAnchors.stepRow())
            {
                beforeId = persistedAnchors.columnText(0);
                afterId = persistedAnchors.columnText(1);
            }
        }
        if (beforeId.empty() && afterId.empty() && targetPosition >= 0)
        {
            const std::size_t insertionIndex = (std::min)(
                static_cast<std::size_t>(targetPosition),
                profileRows.size());
            if (insertionIndex > 0)
            {
                beforeId = profileRows[insertionIndex - 1].id;
            }
            if (insertionIndex < profileRows.size())
            {
                afterId = profileRows[insertionIndex].id;
            }
        }

        std::uint64_t enqueueSequence = 0;
        Statement operationSequence = database.prepare(
            "SELECT enqueue_sequence FROM install_operations WHERE operation_id = ? LIMIT 1;");
        operationSequence.bindText(1, operation);
        if (operationSequence.stepRow())
        {
            const std::int64_t value = operationSequence.columnInt64(0);
            enqueueSequence = value < 0 ? 0 : static_cast<std::uint64_t>(value);
        }
        if (enqueueSequence == 0)
        {
            Statement nextSequence = database.prepare(
                "SELECT COALESCE(MAX(enqueue_sequence), 0) + 1 FROM pending_install_sessions;");
            enqueueSequence = nextSequence.stepRow()
                ? static_cast<std::uint64_t>((std::max<std::int64_t>)(1, nextSequence.columnInt64(0)))
                : 1;
        }

        const std::wstring now = nowUtcText();
        Statement insert = database.prepare(
            "INSERT OR IGNORE INTO pending_install_sessions("
            "operation_id, profile_name, mode, target_mod_uuid, target_position, before_order_id, "
            "after_order_id, enqueue_sequence, revision, state, final_order_id, pending_order_id, "
            "created_at, updated_at"
            ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, 'preparing', '', ?, ?, ?);");
        insert.bindText(1, operation);
        insert.bindText(2, profileNameOrDefault(profileName));
        insert.bindInt(3, static_cast<int>(mode));
        insert.bindText(4, targetUuid);
        insert.bindInt(5, targetPosition);
        insert.bindText(6, beforeId);
        insert.bindText(7, afterId);
        insert.bindInt64(8, static_cast<std::int64_t>(enqueueSequence));
        insert.bindText(9, pendingId);
        insert.bindText(10, now);
        insert.bindText(11, now);
        insert.stepDone();
        transaction.commit();
    }

    PendingInstallSessionRecord InstanceMetadataStore::preparePendingInstallSession(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId,
        const std::vector<InstallConflictFile>& files)
    {
        const std::wstring operation = trim(std::wstring(operationId));
        if (projectDirectory.empty() || operation.empty())
        {
            throw std::invalid_argument("Project directory and operation id are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        ensureAllFileCachesPrepared(database, projectDirectory);

        Transaction transaction(database);
        PendingInstallSessionRecord current = readPendingInstallSession(
            database,
            projectDirectory,
            operation,
            false);
        if (current.state != L"preparing" && current.state != L"ready")
        {
            throw std::runtime_error("The pending install session cannot accept an inventory.");
        }

        Statement clear = database.prepare(
            "DELETE FROM pending_install_files WHERE operation_id = ?;");
        clear.bindText(1, operation);
        clear.stepDone();

        Statement insert = database.prepare(
            "INSERT OR REPLACE INTO pending_install_files("
            "operation_id, relative_path, parent_path, path_key, parent_key, name, kind, size, modified_at"
            ") VALUES(?, ?, ?, ?, ?, ?, 'file', ?, ?);");
        for (const InstallConflictFile& file : files)
        {
            std::filesystem::path relative(file.relativePath);
            relative = relative.lexically_normal();
            if (relative.empty() || relative == L"." || relative.is_absolute())
            {
                continue;
            }
            bool escapesRoot = false;
            for (const std::filesystem::path& component : relative)
            {
                if (component == L"..")
                {
                    escapesRoot = true;
                    break;
                }
            }
            if (escapesRoot)
            {
                throw std::invalid_argument("A pending install file escapes the staging root.");
            }

            const std::wstring relativeText = normalizeRelativePath(relative);
            const std::wstring parentText = normalizeRelativePath(relative.parent_path());
            insert.bindText(1, operation);
            insert.bindText(2, relativeText);
            insert.bindText(3, parentText);
            insert.bindText(4, pathKey(relativeText));
            insert.bindText(5, pathKey(parentText));
            insert.bindText(6, relative.filename().wstring());
            insert.bindInt64(7, static_cast<std::int64_t>(
                (std::min<std::uintmax_t>)(
                    file.size,
                    static_cast<std::uintmax_t>((std::numeric_limits<std::int64_t>::max)()))));
            insert.bindText(8, file.modifiedAt);
            insert.stepDoneAndReset();
        }

        Statement update = database.prepare(
            "UPDATE pending_install_sessions SET state = 'ready', "
            "revision = revision + 1, updated_at = ? WHERE operation_id = ?;");
        update.bindText(1, nowUtcText());
        update.bindText(2, operation);
        update.stepDone();
        syncProfileOrderItems(database, current.profileName);
        transaction.commit();
        return readPendingInstallSession(database, projectDirectory, operation, true);
    }

    PendingInstallSessionRecord InstanceMetadataStore::rebasePendingInstallSession(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId,
        std::wstring_view beforeOrderId,
        std::wstring_view afterOrderId,
        int fallbackTargetPosition)
    {
        const std::wstring operation = trim(std::wstring(operationId));
        if (projectDirectory.empty() || operation.empty())
        {
            throw std::invalid_argument("Project directory and operation id are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        PendingInstallSessionRecord current = readPendingInstallSession(
            database,
            projectDirectory,
            operation,
            false);
        if (current.state == L"failed")
        {
            throw std::runtime_error("The pending install session has failed.");
        }
        if (current.state == L"completed")
        {
            return readPendingInstallSession(database, projectDirectory, operation, true);
        }

        current.beforeOrderId = trim(std::wstring(beforeOrderId));
        current.afterOrderId = trim(std::wstring(afterOrderId));
        current.targetPosition = fallbackTargetPosition;
        const int targetPosition = resolvedInstallTargetPosition(database, current);

        Statement update = database.prepare(
            "UPDATE pending_install_sessions SET target_position = ?, before_order_id = ?, "
            "after_order_id = ?, revision = revision + 1, updated_at = ? WHERE operation_id = ?;");
        update.bindInt(1, targetPosition);
        update.bindText(2, current.beforeOrderId);
        update.bindText(3, current.afterOrderId);
        update.bindText(4, nowUtcText());
        update.bindText(5, operation);
        update.stepDone();
        syncProfileOrderItems(database, current.profileName);
        transaction.commit();
        return readPendingInstallSession(database, projectDirectory, operation, true);
    }

    PendingInstallSessionRecord InstanceMetadataStore::completePendingInstallSession(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId,
        std::wstring_view finalOrderId)
    {
        const std::wstring operation = trim(std::wstring(operationId));
        const std::wstring orderId = trim(std::wstring(finalOrderId));
        if (projectDirectory.empty() || operation.empty() || orderId.empty())
        {
            throw std::invalid_argument(
                "Project directory, operation id, and final order id are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        PendingInstallSessionRecord current = readPendingInstallSession(
            database,
            projectDirectory,
            operation,
            false);
        if (current.state == L"failed")
        {
            throw std::runtime_error("A failed pending install session cannot complete.");
        }

        Statement update = database.prepare(
            "UPDATE pending_install_sessions SET state = 'completed', final_order_id = ?, "
            "revision = revision + 1, updated_at = ? WHERE operation_id = ?;");
        update.bindText(1, orderId);
        update.bindText(2, nowUtcText());
        update.bindText(3, operation);
        update.stepDone();
        current.finalOrderId = orderId;
        moveCompletedPendingInstall(database, current, current.targetPosition);
        transaction.commit();
        return readPendingInstallSession(database, projectDirectory, operation, true);
    }

    PendingInstallSessionRecord InstanceMetadataStore::failPendingInstallSession(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId)
    {
        const std::wstring operation = trim(std::wstring(operationId));
        if (projectDirectory.empty() || operation.empty())
        {
            throw std::invalid_argument("Project directory and operation id are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        static_cast<void>(readPendingInstallSession(database, projectDirectory, operation, false));
        Statement update = database.prepare(
            "UPDATE pending_install_sessions SET state = 'failed', "
            "revision = revision + 1, updated_at = ? WHERE operation_id = ?;");
        update.bindText(1, nowUtcText());
        update.bindText(2, operation);
        update.stepDone();
        Statement clear = database.prepare(
            "DELETE FROM pending_install_files WHERE operation_id = ?;");
        clear.bindText(1, operation);
        clear.stepDone();
        transaction.commit();
        return readPendingInstallSession(database, projectDirectory, operation, true);
    }

    PendingInstallSessionRecord InstanceMetadataStore::pendingInstallSession(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId)
    {
        const std::wstring operation = trim(std::wstring(operationId));
        if (projectDirectory.empty() || operation.empty())
        {
            throw std::invalid_argument("Project directory and operation id are required.");
        }
        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        return readPendingInstallSession(database, projectDirectory, operation, true);
    }

    std::vector<PendingInstallSessionRecord> InstanceMetadataStore::activePendingInstallSessions(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName)
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }
        const std::wstring selectedProfile = profileNameOrDefault(profileName);
        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Statement operations = database.prepare(
            "SELECT operation_id FROM pending_install_sessions "
            "WHERE profile_name = ? AND state IN ('ready', 'committing') "
            "ORDER BY enqueue_sequence, operation_id;");
        operations.bindText(1, selectedProfile);

        std::vector<std::wstring> operationIds;
        while (operations.stepRow())
        {
            operationIds.push_back(operations.columnText(0));
        }

        std::vector<PendingInstallSessionRecord> sessions;
        sessions.reserve(operationIds.size());
        for (const std::wstring& operationId : operationIds)
        {
            sessions.push_back(readPendingInstallSession(
                database,
                projectDirectory,
                operationId,
                true));
        }
        return sessions;
    }

    FinalizedPendingInstallRecord InstanceMetadataStore::finalizePendingInstalledMod(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId,
        const std::filesystem::path& modDirectory,
        std::wstring_view displayName,
        std::wstring_view version,
        const ModSourceRecord& source,
        const PendingInstallFinalizationMetadata& metadata)
    {
        const std::wstring operation = trim(std::wstring(operationId));
        if (projectDirectory.empty() || operation.empty() || modDirectory.empty() ||
            !std::filesystem::is_directory(modDirectory))
        {
            throw std::invalid_argument(
                "Project directory, operation id, and installed mod directory are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        PendingInstallSessionRecord session = readPendingInstallSession(
            database,
            projectDirectory,
            operation,
            false);
        if (session.state != L"ready" && session.state != L"committing")
        {
            throw std::runtime_error("The pending install session is not ready to finalize.");
        }

        std::wstring expectedTargetOrderId;
        if (session.mode != InstallConflictPreviewMode::Install &&
            !session.targetModUuid.empty())
        {
            Statement expectedOrder = database.prepare(
                "SELECT oi.id FROM profile_order_items oi "
                "JOIN mods m ON m.id = oi.mod_id "
                "WHERE oi.profile_name = ? AND oi.kind = 'mod' AND m.uuid = ? LIMIT 1;");
            expectedOrder.bindText(1, session.profileName);
            expectedOrder.bindText(2, session.targetModUuid);
            if (!expectedOrder.stepRow())
            {
                throw std::runtime_error(
                    "The replace or merge target order row disappeared before commit.");
            }
            expectedTargetOrderId = expectedOrder.columnText(0);
        }

        InstalledModRecord record;
        record.gameId = readMetadataValue(database, L"game_id");
        record.folderName = modDirectory.filename().wstring();
        record.displayName = displayName.empty() ? record.folderName : std::wstring(displayName);
        record.version = std::wstring(version);
        record.installedAt = nowUtcText();
        record.updatedAt = record.installedAt;
        record.state = L"installed";
        record.path = modDirectory;
        record.source = source;

        Statement existing = database.prepare(
            "SELECT uuid, installed_at, state FROM mods "
            "WHERE folder_name = ? COLLATE NOCASE LIMIT 1;");
        existing.bindText(1, record.folderName);
        if (existing.stepRow())
        {
            record.uuid = existing.columnText(0);
            record.installedAt = existing.columnText(1);
            if (existing.columnText(2) == L"disabled")
            {
                record.state = L"disabled";
            }
        }

        const FileCacheSnapshot preparedCache = collectFileCacheSnapshot(record);
        record.contentFingerprint = preparedCache.cacheKey;

        Transaction transaction(database);
        upsertModRecord(database, record);
        replaceFileCache(database, record.id, preparedCache.entries);
        upsertFileCacheState(
            database,
            record.id,
            preparedCache.cacheKey,
            static_cast<int>(preparedCache.entries.size()));

        syncProfileOrderItems(database, session.profileName);
        Statement order = database.prepare(
            "SELECT id FROM profile_order_items "
            "WHERE profile_name = ? AND kind = 'mod' AND mod_id = ? LIMIT 1;");
        order.bindText(1, session.profileName);
        order.bindInt64(2, record.id);
        if (!order.stepRow())
        {
            throw std::runtime_error("The finalized mod order row was not created.");
        }
        const std::wstring orderId = order.columnText(0);
        if (!expectedTargetOrderId.empty() &&
            (record.uuid != session.targetModUuid || orderId != expectedTargetOrderId))
        {
            throw std::runtime_error(
                "Replace or merge changed the stable mod or order identity; commit was rolled back.");
        }
        const int resolvedTargetPosition = resolvedInstallTargetPosition(database, session);
        if (resolvedTargetPosition >= 0)
        {
            moveProfileOrderStorageItems(
                database,
                session.profileName,
                "profile_order_items",
                orderId,
                resolvedTargetPosition,
                profileOrderSeparatorKind,
                ProfileOrderSeparatorMoveMode::Single);
        }

        refreshDetectedConflicts(database);
        const std::vector<InstalledModRecord> records = readInstalledRecords(
            database,
            projectDirectory,
            modDirectory.parent_path());
        setMetadataValue(database, L"mod_conflict_inputs_key", conflictInputsKey(records));

        if (metadata.identity.has_value())
        {
            ModIdentityPersistenceUpdate identity = *metadata.identity;
            identity.modUuid = record.uuid;
            applyModIdentityPersistenceRows(
                database,
                projectDirectory,
                record,
                identity);
        }
        else
        {
            record = readRecordByFolder(
                database,
                projectDirectory,
                record.folderName,
                modDirectory.parent_path());
        }
        if (!trim(metadata.archiveSha256).empty())
        {
            completeArchiveInstallAttemptRows(
                database,
                trim(metadata.archiveSha256),
                record.id,
                record.uuid,
                operation,
                metadata.mergeArchiveLink);
        }
#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
        if (pendingInstallFinalizeFailureForTesting.exchange(false, std::memory_order_relaxed))
        {
            throw std::runtime_error("Injected pending install finalization failure.");
        }
#endif
        writePortableManifest(record);

        Statement complete = database.prepare(
            "UPDATE pending_install_sessions SET state = 'completed', final_order_id = ?, "
            "revision = revision + 1, updated_at = ? WHERE operation_id = ?;");
        complete.bindText(1, orderId);
        complete.bindText(2, nowUtcText());
        complete.bindText(3, operation);
        complete.stepDone();
        transaction.commit();

        record = readRecordByFolder(
            database,
            projectDirectory,
            record.folderName,
            modDirectory.parent_path());
        if (metadata.identity.has_value())
        {
            record.fomodModuleId = identityFomodModuleId(database, record.id);
            record.identityAliases = identityAliases(database, record.id);
            Statement exclusions = database.prepare(
                "SELECT DISTINCT rejected_mod_uuid FROM mod_identity_exclusions "
                "WHERE owner_mod_id = ? ORDER BY rejected_mod_uuid;");
            exclusions.bindInt64(1, record.id);
            while (exclusions.stepRow())
            {
                record.identityExcludedModUuids.push_back(exclusions.columnText(0));
            }
            record.portableManifestSchemaVersion = 2;
        }
        markFileCacheValidatedLocked(projectDirectory);
        markLaunchInventoryReconciledLocked(projectDirectory);

        FinalizedPendingInstallRecord result;
        result.mod = record;
        result.orderId = orderId;
        const std::vector<ModFileSummaryRecord> summaries = summarizeCachedProfileModFiles(
            database,
            projectDirectory,
            session.profileName,
            modDirectory.parent_path());
        const auto selected = std::find_if(
            summaries.begin(),
            summaries.end(),
            [&record](const ModFileSummaryRecord& summary)
            {
                return pathKey(summary.modPath.wstring()) == pathKey(record.path.wstring());
            });
        if (selected != summaries.end())
        {
            result.summary = selected->summary;
        }
        return result;
    }

#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
    void InstanceMetadataStore::resetSqlPrepareCountForTesting()
    {
        sqlitePrepareCountForTesting.store(0, std::memory_order_relaxed);
    }

    std::uint64_t InstanceMetadataStore::sqlPrepareCountForTesting()
    {
        return sqlitePrepareCountForTesting.load(std::memory_order_relaxed);
    }

    void InstanceMetadataStore::resetSqlExecCountForTesting()
    {
        sqliteExecCountForTesting.store(0, std::memory_order_relaxed);
    }

    std::uint64_t InstanceMetadataStore::sqlExecCountForTesting()
    {
        return sqliteExecCountForTesting.load(std::memory_order_relaxed);
    }

    void InstanceMetadataStore::resetInventorySyncCountForTesting()
    {
        inventorySyncInvocationCount.store(0, std::memory_order_relaxed);
    }

    std::uint64_t InstanceMetadataStore::inventorySyncCountForTesting()
    {
        return inventorySyncInvocationCount.load(std::memory_order_relaxed);
    }

    void InstanceMetadataStore::setFileCacheScanFailureAfterEntriesForTesting(int entryCount)
    {
        fileCacheScanFailureAfterEntriesForTesting.store(entryCount, std::memory_order_relaxed);
    }

    void InstanceMetadataStore::setPendingInstallFinalizeFailureForTesting(bool shouldFail)
    {
        pendingInstallFinalizeFailureForTesting.store(shouldFail, std::memory_order_relaxed);
    }

    void InstanceMetadataStore::withMetadataLockForTesting(const std::function<void()>& action)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (action)
        {
            action();
        }
    }

    void InstanceMetadataStore::resetStableMetadataHandleOpenCountForTesting()
    {
        stableMetadataHandleOpenCounterForTesting.store(0, std::memory_order_relaxed);
    }

    std::uint64_t InstanceMetadataStore::stableMetadataHandleOpenCountForTesting()
    {
        return stableMetadataHandleOpenCounterForTesting.load(std::memory_order_relaxed);
    }
#endif

    std::vector<InstalledModRecord> InstanceMetadataStore::listInstalledMods(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modsRoot)
    {
        Database database = openInstanceDatabase(projectDirectory);
        return readInstalledRecords(database, projectDirectory, modsRoot);
    }

    ModIdentityCatalogSnapshot InstanceMetadataStore::queryModIdentityCandidates(
        const std::filesystem::path& projectDirectory,
        const ModIdentityCatalogQuery& query)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        {
            Transaction transaction(database);
            Statement missing = database.prepare(
                "SELECT m.id, m.uuid, m.game_id, m.folder_name, m.display_name, m.version, "
                "m.installed_at, m.updated_at, m.state, m.content_fingerprint, "
                "m.source_is_nexus, m.source_is_moddingflow, m.is_local, m.is_translation, m.is_patch, "
                "COALESCE(s.provider, ''), COALESCE(s.game_domain, ''), "
                "COALESCE(s.remote_mod_id, ''), COALESCE(s.remote_file_id, ''), "
                "COALESCE(s.url, ''), COALESCE(s.last_checked_at, ''), COALESCE(s.latest_version, '') "
                "FROM mods m LEFT JOIN mod_sources s ON s.mod_id = m.id "
                "WHERE m.state IN ('installed', 'disabled') AND NOT EXISTS("
                "SELECT 1 FROM mod_identity_keys k WHERE k.mod_id = m.id) "
                "ORDER BY m.id;");
            while (missing.stepRow())
            {
                InstalledModRecord record;
                record.id = std::stoll(missing.columnText(0));
                record.uuid = missing.columnText(1);
                record.gameId = missing.columnText(2);
                record.folderName = missing.columnText(3);
                record.displayName = missing.columnText(4);
                record.version = missing.columnText(5);
                record.installedAt = missing.columnText(6);
                record.updatedAt = missing.columnText(7);
                record.state = missing.columnText(8);
                record.contentFingerprint = missing.columnText(9);
                record.sourceIsNexus = missing.columnInt(10) != 0;
                record.sourceIsModdingFlow = missing.columnInt(11) != 0;
                record.isLocal = missing.columnInt(12) != 0;
                record.isTranslation = missing.columnInt(13) != 0;
                record.isPatch = missing.columnInt(14) != 0;
                record.path = modsDirectory(projectDirectory) / record.folderName;
                record.source = ModSourceRecord{
                    missing.columnText(15),
                    missing.columnText(16),
                    missing.columnText(17),
                    missing.columnText(18),
                    missing.columnText(19),
                    missing.columnText(20),
                    missing.columnText(21)
                };
                syncIdentitySearchIndex(database, record);
            }
            transaction.commit();
        }

        const std::size_t requestedLimit = query.limit == 0 ? 5 : query.limit;
        const std::size_t limit = (std::min<std::size_t>)(requestedLimit, 5);
        std::vector<std::int64_t> candidateIds;
        candidateIds.reserve(limit);
        std::set<std::int64_t> seenIds;
        const auto appendKeyMatches = [&](std::wstring_view kind, std::wstring_view value)
        {
            if (value.empty() || candidateIds.size() >= limit)
            {
                return;
            }
            Statement statement = database.prepare(
                "SELECT k.mod_id FROM mod_identity_keys k "
                "JOIN mods m ON m.id = k.mod_id "
                "WHERE k.key_kind = ? AND k.key_value = ? "
                "AND m.state IN ('installed', 'disabled') "
                "ORDER BY k.mod_id LIMIT 5;");
            statement.bindText(1, kind);
            statement.bindText(2, value);
            while (candidateIds.size() < limit && statement.stepRow())
            {
                const std::int64_t id = std::stoll(statement.columnText(0));
                if (seenIds.insert(id).second)
                {
                    candidateIds.push_back(id);
                }
            }
        };

        appendKeyMatches(
            L"source",
            identitySourceKey(query.provider, query.gameDomain, query.remoteModId));
        appendKeyMatches(L"alias", query.normalizedName);
        appendKeyMatches(L"fomod", toLower(trim(query.fomodModuleId)));
        appendKeyMatches(L"name", query.normalizedName);
        appendKeyMatches(L"folder", query.normalizedName);

        if (candidateIds.size() < limit && !query.tokens.empty())
        {
            std::string sql =
                "SELECT t.mod_id, SUM(t.weight) AS score, COUNT(*) AS matches "
                "FROM mod_identity_tokens t JOIN mods m ON m.id = t.mod_id "
                "WHERE m.state IN ('installed', 'disabled') AND t.token IN (";
            for (std::size_t index = 0; index < query.tokens.size(); ++index)
            {
                if (index != 0)
                {
                    sql += ',';
                }
                sql += '?';
            }
            sql += ") GROUP BY t.mod_id ORDER BY matches DESC, score DESC, t.mod_id LIMIT 5;";
            Statement statement = database.prepare(sql.c_str());
            for (std::size_t index = 0; index < query.tokens.size(); ++index)
            {
                statement.bindText(static_cast<int>(index + 1), query.tokens[index]);
            }
            while (candidateIds.size() < limit && statement.stepRow())
            {
                const std::int64_t id = std::stoll(statement.columnText(0));
                if (seenIds.insert(id).second)
                {
                    candidateIds.push_back(id);
                }
            }
        }

        ModIdentityCatalogSnapshot snapshot;
        try
        {
            const std::wstring revision = readMetadataValue(database, modInventoryRevisionKey);
            snapshot.catalogRevision = revision.empty() ? 0 : std::stoull(revision);
        }
        catch (const std::exception&)
        {
            snapshot.catalogRevision = 0;
        }

        const std::wstring sourceKey = identitySourceKey(
            query.provider,
            query.gameDomain,
            query.remoteModId);
        for (const std::int64_t id : candidateIds)
        {
            Statement folder = database.prepare(
                "SELECT folder_name FROM mods WHERE id = ? AND state IN ('installed', 'disabled') LIMIT 1;");
            folder.bindInt64(1, id);
            if (!folder.stepRow())
            {
                continue;
            }

            ModIdentityCatalogCandidate candidate;
            candidate.mod = readRecordByFolder(
                database,
                projectDirectory,
                folder.columnText(0));
            candidate.aliases = identityAliases(database, id);
            candidate.fomodModuleId = identityFomodModuleId(database, id);
            candidate.mod.identityAliases = candidate.aliases;
            candidate.mod.fomodModuleId = candidate.fomodModuleId;

            Statement excluded = database.prepare(
                "SELECT 1 FROM mod_identity_exclusions "
                "WHERE rejected_mod_uuid = ? AND "
                "((source_key <> '' AND source_key = ?) OR "
                "(incoming_name_key <> '' AND incoming_name_key = ?)) LIMIT 1;");
            excluded.bindText(1, candidate.mod.uuid);
            excluded.bindText(2, sourceKey);
            excluded.bindText(3, query.normalizedName);
            candidate.excluded = excluded.stepRow();
            snapshot.candidates.push_back(std::move(candidate));
        }
        return snapshot;
    }

    std::optional<ModIdentityContentCacheRecord> InstanceMetadataStore::modIdentityContentCache(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveFingerprint)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty() || trim(std::wstring(archiveFingerprint)).empty())
        {
            return std::nullopt;
        }

        Database database = openInstanceDatabase(projectDirectory);
        Statement statement = database.prepare(
            "SELECT content_json FROM mod_identity_cache "
            "WHERE archive_fingerprint = ? AND content_json <> '{}' LIMIT 1;");
        statement.bindText(1, archiveFingerprint);
        if (!statement.stepRow())
        {
            return std::nullopt;
        }

        try
        {
            const JsonValue root = JsonReader::parse(statement.columnText(0));
            if (!root.isObject())
            {
                return std::nullopt;
            }
            const auto readArray = [&](std::wstring_view key)
            {
                std::vector<std::wstring> values;
                const JsonValue* array = root.find(key);
                if (array == nullptr || !array->isArray())
                {
                    return values;
                }
                for (const JsonValue& value : array->asArray())
                {
                    if (value.isString())
                    {
                        values.push_back(value.asString());
                    }
                }
                return values;
            };
            return ModIdentityContentCacheRecord{
                readArray(L"pluginFiles"),
                readArray(L"archiveFiles"),
                readArray(L"scriptExtenderDlls")
            };
        }
        catch (const std::exception&)
        {
            return std::nullopt;
        }
    }

    void InstanceMetadataStore::recordModIdentityContentCache(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveFingerprint,
        const ModIdentityContentCacheRecord& content)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty() || trim(std::wstring(archiveFingerprint)).empty())
        {
            throw std::invalid_argument("Project directory and archive fingerprint are required.");
        }

        JsonWriter writer;
        writer.beginObject();
        writer.stringArray(L"pluginFiles", content.pluginFiles);
        writer.stringArray(L"archiveFiles", content.archiveFiles);
        writer.stringArray(L"scriptExtenderDlls", content.scriptExtenderDlls);
        writer.endObject();

        Database database = openInstanceDatabase(projectDirectory);
        Statement statement = database.prepare(
            "INSERT INTO mod_identity_cache(archive_fingerprint, content_json, checked_at) "
            "VALUES(?, ?, ?) ON CONFLICT(archive_fingerprint) DO UPDATE SET "
            "content_json = excluded.content_json, checked_at = excluded.checked_at;");
        statement.bindText(1, archiveFingerprint);
        statement.bindText(2, writer.str());
        statement.bindText(3, nowUtcText());
        statement.stepDone();
    }

    std::optional<ModIdentityOnlineCacheRecord> InstanceMetadataStore::modIdentityOnlineCache(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveFingerprint,
        std::wstring_view provider,
        std::wstring_view gameDomain,
        std::wstring_view md5,
        std::wstring_view sha256,
        std::uintmax_t archiveSize)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty() || trim(std::wstring(archiveFingerprint)).empty())
        {
            return std::nullopt;
        }
        if (archiveSize > static_cast<std::uintmax_t>((std::numeric_limits<std::int64_t>::max)()))
        {
            return std::nullopt;
        }

        Database database = openInstanceDatabase(projectDirectory);
        Statement statement = database.prepare(
            "SELECT remote_mod_id, online_json, checked_at FROM mod_identity_cache "
            "WHERE archive_fingerprint = ? AND provider = ? AND game_domain = ? "
            "AND md5 = ? AND sha256 = ? AND archive_size = ? AND online_json <> '{}' LIMIT 1;");
        statement.bindText(1, archiveFingerprint);
        statement.bindText(2, toLower(trim(std::wstring(provider))));
        statement.bindText(3, toLower(trim(std::wstring(gameDomain))));
        statement.bindText(4, toLower(trim(std::wstring(md5))));
        statement.bindText(5, toLower(trim(std::wstring(sha256))));
        statement.bindInt64(6, static_cast<std::int64_t>(archiveSize));
        if (!statement.stepRow())
        {
            return std::nullopt;
        }

        try
        {
            const JsonValue root = JsonReader::parse(statement.columnText(1));
            if (!root.isObject())
            {
                return std::nullopt;
            }
            ModIdentityOnlineCacheRecord cached;
            cached.provider = toLower(trim(std::wstring(provider)));
            cached.gameDomain = toLower(trim(std::wstring(gameDomain)));
            cached.remoteModId = statement.columnText(0);
            cached.remoteFileId = readStringOrDefault(root, L"remoteFileId");
            cached.modName = readStringOrDefault(root, L"modName");
            cached.md5 = toLower(trim(std::wstring(md5)));
            cached.sha256 = toLower(trim(std::wstring(sha256)));
            cached.archiveSize = archiveSize;
            cached.checkedAt = statement.columnText(2);
            if (cached.remoteModId.empty() || cached.remoteFileId.empty())
            {
                return std::nullopt;
            }
            return cached;
        }
        catch (const std::exception&)
        {
            return std::nullopt;
        }
    }

    void InstanceMetadataStore::recordModIdentityOnlineCache(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveFingerprint,
        const ModIdentityOnlineCacheRecord& online)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty() || trim(std::wstring(archiveFingerprint)).empty() ||
            trim(online.provider).empty() || trim(online.gameDomain).empty() ||
            trim(online.remoteModId).empty() || trim(online.remoteFileId).empty())
        {
            throw std::invalid_argument("Complete online identity cache metadata is required.");
        }
        if (online.archiveSize > static_cast<std::uintmax_t>((std::numeric_limits<std::int64_t>::max)()))
        {
            throw std::invalid_argument("Archive is too large for identity cache metadata.");
        }

        JsonWriter writer;
        writer.beginObject();
        writer.field(L"remoteFileId", online.remoteFileId);
        writer.field(L"modName", online.modName);
        writer.endObject();

        Database database = openInstanceDatabase(projectDirectory);
        Statement statement = database.prepare(
            "INSERT INTO mod_identity_cache("
            "archive_fingerprint, provider, game_domain, remote_mod_id, md5, sha256, "
            "archive_size, online_json, checked_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(archive_fingerprint) DO UPDATE SET "
            "provider = excluded.provider, game_domain = excluded.game_domain, "
            "remote_mod_id = excluded.remote_mod_id, md5 = excluded.md5, sha256 = excluded.sha256, "
            "archive_size = excluded.archive_size, online_json = excluded.online_json, "
            "checked_at = excluded.checked_at;");
        statement.bindText(1, archiveFingerprint);
        statement.bindText(2, toLower(trim(online.provider)));
        statement.bindText(3, toLower(trim(online.gameDomain)));
        statement.bindText(4, trim(online.remoteModId));
        statement.bindText(5, toLower(trim(online.md5)));
        statement.bindText(6, toLower(trim(online.sha256)));
        statement.bindInt64(7, static_cast<std::int64_t>(online.archiveSize));
        statement.bindText(8, writer.str());
        statement.bindText(9, online.checkedAt.empty() ? nowUtcText() : online.checkedAt);
        statement.stepDone();
    }

    void InstanceMetadataStore::recordModIdentity(
        const std::filesystem::path& projectDirectory,
        const ModIdentityPersistenceUpdate& update)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty() || trim(update.modUuid).empty())
        {
            throw std::invalid_argument("Project directory and mod UUID are required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        Statement folder = database.prepare(
            "SELECT id, folder_name FROM mods WHERE uuid = ? AND state IN ('installed', 'disabled') LIMIT 1;");
        folder.bindText(1, update.modUuid);
        if (!folder.stepRow())
        {
            throw std::invalid_argument("Identity target mod was not found.");
        }
        const std::int64_t modId = std::stoll(folder.columnText(0));
        const std::wstring folderName = folder.columnText(1);

        Transaction transaction(database);
        if (!trim(update.fomodModuleId).empty())
        {
            Statement metadata = database.prepare(
                "INSERT INTO mod_identity_metadata(mod_id, fomod_module_id) VALUES(?, ?) "
                "ON CONFLICT(mod_id) DO UPDATE SET fomod_module_id = excluded.fomod_module_id;");
            metadata.bindInt64(1, modId);
            metadata.bindText(2, trim(update.fomodModuleId));
            metadata.stepDone();
        }

        if (!identitySourceKey(
                update.sourceProvider,
                update.sourceGameDomain,
                update.sourceRemoteModId).empty())
        {
            const std::wstring normalizedProvider = toLower(trim(update.sourceProvider));
            Statement source = database.prepare(
                "INSERT INTO mod_sources("
                "mod_id, provider, game_domain, remote_mod_id, remote_file_id, url, last_checked_at, latest_version"
                ") VALUES(?, ?, ?, ?, ?, '', ?, '') "
                "ON CONFLICT(mod_id) DO UPDATE SET "
                "provider = excluded.provider, game_domain = excluded.game_domain, "
                "remote_mod_id = excluded.remote_mod_id, remote_file_id = excluded.remote_file_id, "
                "last_checked_at = excluded.last_checked_at;");
            source.bindInt64(1, modId);
            source.bindText(2, normalizedProvider);
            source.bindText(3, toLower(trim(update.sourceGameDomain)));
            source.bindText(4, trim(update.sourceRemoteModId));
            source.bindText(5, trim(update.sourceRemoteFileId));
            source.bindText(6, nowUtcText());
            source.stepDone();

            Statement flags = database.prepare(
                "UPDATE mods SET source_is_nexus = ?, source_is_moddingflow = ?, "
                "is_local = 0, updated_at = ? WHERE id = ?;");
            flags.bindInt64(1, normalizedProvider == L"nexus" ? 1 : 0);
            flags.bindInt64(2, normalizedProvider == L"moddingflow" ? 1 : 0);
            flags.bindText(3, nowUtcText());
            flags.bindInt64(4, modId);
            flags.stepDone();
        }

        const std::wstring confirmedAt = nowUtcText();
        for (const std::wstring& alias : update.confirmedAliases)
        {
            const std::wstring cleanAlias = trim(alias);
            const std::wstring normalizedAlias = ModIdentityResolver::normalizedName(cleanAlias);
            if (normalizedAlias.empty())
            {
                continue;
            }
            Statement insert = database.prepare(
                "INSERT INTO mod_identity_aliases(mod_id, alias, normalized_alias, confirmed_at) "
                "VALUES(?, ?, ?, ?) ON CONFLICT(mod_id, normalized_alias) DO UPDATE SET "
                "alias = excluded.alias, confirmed_at = excluded.confirmed_at;");
            insert.bindInt64(1, modId);
            insert.bindText(2, cleanAlias);
            insert.bindText(3, normalizedAlias);
            insert.bindText(4, confirmedAt);
            insert.stepDone();
        }

        const std::wstring sourceKey = identitySourceKey(
            update.exclusionProvider,
            update.exclusionGameDomain,
            update.exclusionRemoteModId);
        const std::wstring incomingNameKey =
            ModIdentityResolver::normalizedName(update.exclusionIncomingName);
        for (const std::wstring& rejectedUuid : update.rejectedModUuids)
        {
            if (trim(rejectedUuid).empty() || (sourceKey.empty() && incomingNameKey.empty()))
            {
                continue;
            }
            Statement insert = database.prepare(
                "INSERT OR IGNORE INTO mod_identity_exclusions("
                "owner_mod_id, source_key, incoming_name_key, rejected_mod_uuid, created_at"
                ") VALUES(?, ?, ?, ?, ?);");
            insert.bindInt64(1, modId);
            insert.bindText(2, sourceKey);
            insert.bindText(3, incomingNameKey);
            insert.bindText(4, trim(rejectedUuid));
            insert.bindText(5, confirmedAt);
            insert.stepDone();
        }

        InstalledModRecord record = readRecordByFolder(database, projectDirectory, folderName);
        record.fomodModuleId = identityFomodModuleId(database, modId);
        record.identityAliases = identityAliases(database, modId);
        syncIdentitySearchIndex(database, record);
        bumpModInventoryRevision(database);
        transaction.commit();

        record = readRecordByFolder(database, projectDirectory, folderName);
        record.fomodModuleId = identityFomodModuleId(database, modId);
        record.identityAliases = identityAliases(database, modId);
        Statement exclusions = database.prepare(
            "SELECT DISTINCT rejected_mod_uuid FROM mod_identity_exclusions "
            "WHERE owner_mod_id = ? ORDER BY rejected_mod_uuid;");
        exclusions.bindInt64(1, modId);
        while (exclusions.stepRow())
        {
            record.identityExcludedModUuids.push_back(exclusions.columnText(0));
        }
        record.portableManifestSchemaVersion = 2;
        writePortableManifest(record);
    }

    std::uint64_t InstanceMetadataStore::modCatalogRevision(
        const std::filesystem::path& projectDirectory)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        try
        {
            const std::wstring revision = readMetadataValue(database, modInventoryRevisionKey);
            return revision.empty() ? 0 : std::stoull(revision);
        }
        catch (const std::exception&)
        {
            return 0;
        }
    }

    std::optional<InstalledModRecord> InstanceMetadataStore::installedModByUuid(
        const std::filesystem::path& projectDirectory,
        std::wstring_view modUuid)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty() || trim(std::wstring(modUuid)).empty())
        {
            return std::nullopt;
        }
        Database database = openInstanceDatabase(projectDirectory);
        Statement folder = database.prepare(
            "SELECT id, folder_name FROM mods WHERE uuid = ? AND state IN ('installed', 'disabled') LIMIT 1;");
        folder.bindText(1, modUuid);
        if (!folder.stepRow())
        {
            return std::nullopt;
        }
        const std::int64_t id = std::stoll(folder.columnText(0));
        InstalledModRecord record = readRecordByFolder(
            database,
            projectDirectory,
            folder.columnText(1));
        record.fomodModuleId = identityFomodModuleId(database, id);
        record.identityAliases = identityAliases(database, id);
        Statement exclusions = database.prepare(
            "SELECT DISTINCT rejected_mod_uuid FROM mod_identity_exclusions "
            "WHERE owner_mod_id = ? ORDER BY rejected_mod_uuid;");
        exclusions.bindInt64(1, id);
        while (exclusions.stepRow())
        {
            record.identityExcludedModUuids.push_back(exclusions.columnText(0));
        }
        return record;
    }

    void InstanceMetadataStore::refreshInstalledModsFromDisk(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        Database database = openInstanceDatabase(projectDirectory);
        syncInstalledModsFromDisk(database, projectDirectory, modsRoot);
    }

    void InstanceMetadataStore::invalidateModFileCaches(
        const std::filesystem::path& projectDirectory,
        const std::vector<std::filesystem::path>& changedPaths,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }
        if (changedPaths.empty())
        {
            return;
        }
        invalidateLaunchInventoryReconciliationLocked(projectDirectory);

        const std::filesystem::path root =
            modsDirectory(projectDirectory, modsRoot).lexically_normal();
        std::set<std::wstring> folderNames;
        bool invalidateAll = false;
        for (const std::filesystem::path& changedPath : changedPaths)
        {
            const std::filesystem::path normalized =
                (changedPath.is_absolute() ? changedPath : root / changedPath).lexically_normal();
            const std::filesystem::path relative = normalized.lexically_relative(root);
            if (relative.empty() || relative == L".")
            {
                invalidateAll = true;
                break;
            }

            auto component = relative.begin();
            if (component == relative.end() || *component == L"..")
            {
                continue;
            }
            const std::wstring folderName = component->wstring();
            ++component;
            if (component != relative.end() && component->wstring() == manifestDirectoryName)
            {
                continue;
            }
            folderNames.insert(folderName);
        }
        if (!invalidateAll && folderNames.empty())
        {
            return;
        }

        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        if (invalidateAll)
        {
            database.exec("DELETE FROM mod_files;");
            database.exec("DELETE FROM mod_file_cache;");
            database.exec("DELETE FROM mod_file_cache_state;");
            Statement clearFingerprints = database.prepare(
                "UPDATE mods SET content_fingerprint = '', updated_at = ? "
                "WHERE state IN ('installed', 'disabled');");
            clearFingerprints.bindText(1, nowUtcText());
            clearFingerprints.stepDone();
        }
        else
        {
            for (const std::wstring& folderName : folderNames)
            {
                Statement removeFiles = database.prepare(
                    "DELETE FROM mod_files WHERE mod_id = "
                    "(SELECT id FROM mods WHERE folder_name = ? COLLATE NOCASE LIMIT 1);");
                removeFiles.bindText(1, folderName);
                removeFiles.stepDone();
                Statement removeLegacyFiles = database.prepare(
                    "DELETE FROM mod_file_cache WHERE mod_id = "
                    "(SELECT id FROM mods WHERE folder_name = ? COLLATE NOCASE LIMIT 1);");
                removeLegacyFiles.bindText(1, folderName);
                removeLegacyFiles.stepDone();
                Statement removeState = database.prepare(
                    "DELETE FROM mod_file_cache_state WHERE mod_id = "
                    "(SELECT id FROM mods WHERE folder_name = ? COLLATE NOCASE LIMIT 1);");
                removeState.bindText(1, folderName);
                removeState.stepDone();
                Statement clearFingerprint = database.prepare(
                    "UPDATE mods SET content_fingerprint = '', updated_at = ? "
                    "WHERE folder_name = ? COLLATE NOCASE;");
                clearFingerprint.bindText(1, nowUtcText());
                clearFingerprint.bindText(2, folderName);
                clearFingerprint.stepDone();
            }
        }
        transaction.commit();
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::listProfileOrderItems(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        Database database = openInstanceDatabase(projectDirectory);
        syncInstalledModsFromDisk(database, projectDirectory, modsRoot);

        Transaction transaction(database);
        syncProfileOrderItems(database, normalizedProfileName);
        transaction.commit();

        return readProfileOrderItems(database, projectDirectory, normalizedProfileName, modsRoot);
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::listCachedProfileOrderItems(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        Database database = openInstanceDatabase(projectDirectory);

        Transaction transaction(database);
        syncProfileOrderItems(database, normalizedProfileName);
        transaction.commit();

        return readProfileOrderItems(database, projectDirectory, normalizedProfileName, modsRoot);
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::listLaunchProfileOrderItems(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        Database database = openInstanceDatabase(projectDirectory);
        const bool reconcileInventory =
            launchInventoryReconciliationRequiredLocked(projectDirectory);
        if (reconcileInventory)
        {
            syncInstalledModsFromDisk(database, projectDirectory, modsRoot);
        }

        Transaction transaction(database);
        syncProfileOrderItems(database, normalizedProfileName);
        transaction.commit();

        std::vector<ProfileOrderItemRecord> records =
            readProfileOrderItems(database, projectDirectory, normalizedProfileName, modsRoot);
        if (reconcileInventory)
        {
            markLaunchInventoryReconciledLocked(projectDirectory);
        }
        return records;
    }

    std::vector<std::wstring> InstanceMetadataStore::listProfileNames(
        const std::filesystem::path& projectDirectory)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);

        std::vector<std::wstring> profiles;
        std::set<std::wstring> seen;
        appendProfileNamesFromTable(database, "profile_order_items", profiles, seen);
        appendProfileNamesFromTable(database, "profile_plugin_order_items", profiles, seen);
        return profiles;
    }

    void InstanceMetadataStore::ensureProfileState(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        Database database = openInstanceDatabase(projectDirectory);
        syncInstalledModsFromDisk(database, projectDirectory, modsRoot);

        Transaction transaction(database);
        syncProfileOrderItems(database, normalizedProfileName);
        transaction.commit();
    }

    void InstanceMetadataStore::cloneProfileState(
        const std::filesystem::path& projectDirectory,
        std::wstring_view sourceProfileName,
        std::wstring_view targetProfileName,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedSourceProfileName = profileNameOrDefault(sourceProfileName);
        const std::wstring normalizedTargetProfileName = profileNameOrDefault(targetProfileName);
        if (toLower(normalizedSourceProfileName) == toLower(normalizedTargetProfileName))
        {
            throw std::invalid_argument("Source and target profiles must be different.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        syncInstalledModsFromDisk(database, projectDirectory, modsRoot);

        Transaction transaction(database);
        syncProfileOrderItems(database, normalizedSourceProfileName);

        if (profileRowsExist(database, "profile_order_items", normalizedTargetProfileName) ||
            profileRowsExist(database, "profile_plugin_order_items", normalizedTargetProfileName))
        {
            throw std::invalid_argument("Target profile already has stored state.");
        }

        copyProfileOrderRows(database, normalizedSourceProfileName, normalizedTargetProfileName);
        copyProfilePluginOrderRows(database, normalizedSourceProfileName, normalizedTargetProfileName);
        appendMissingProfileModItems(database, normalizedTargetProfileName);
        compactProfileOrderPositions(database, normalizedTargetProfileName);
        compactProfilePluginOrderPositions(database, normalizedTargetProfileName);
        transaction.commit();
    }

    void InstanceMetadataStore::renameProfileState(
        const std::filesystem::path& projectDirectory,
        std::wstring_view sourceProfileName,
        std::wstring_view targetProfileName)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedSourceProfileName = profileNameOrDefault(sourceProfileName);
        const std::wstring normalizedTargetProfileName = profileNameOrDefault(targetProfileName);
        if (toLower(normalizedSourceProfileName) == toLower(normalizedTargetProfileName))
        {
            return;
        }

        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        if (profileRowsExist(database, "profile_order_items", normalizedTargetProfileName) ||
            profileRowsExist(database, "profile_plugin_order_items", normalizedTargetProfileName))
        {
            throw std::invalid_argument("Target profile already has stored state.");
        }

        renameProfileRows(
            database,
            "profile_order_items",
            normalizedSourceProfileName,
            normalizedTargetProfileName);
        renameProfileRows(
            database,
            "profile_plugin_order_items",
            normalizedSourceProfileName,
            normalizedTargetProfileName);
        transaction.commit();
    }

    void InstanceMetadataStore::deleteProfileState(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        removeProfileRows(database, "profile_order_items", normalizedProfileName);
        removeProfileRows(database, "profile_plugin_order_items", normalizedProfileName);
        transaction.commit();
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::createProfileOrderSeparator(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view title,
        int targetIndex,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        const std::wstring normalizedTitle = trim(std::wstring(title));
        if (normalizedTitle.empty())
        {
            throw std::invalid_argument("Separator title is required.");
        }
        if (normalizedTitle.size() > maxProfileOrderSeparatorTitleLength)
        {
            throw std::invalid_argument("Separator title is too long.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        syncInstalledModsFromDisk(database, projectDirectory, modsRoot);

        Transaction transaction(database);
        syncProfileOrderItems(database, normalizedProfileName);

        const int count = profileOrderItemCount(database, normalizedProfileName);
        const int position = std::clamp(targetIndex, 0, count);
        const std::wstring now = nowUtcText();

        Statement shift = database.prepare(
            "UPDATE profile_order_items "
            "SET position = position + 1, updated_at = ? "
            "WHERE profile_name = ? AND position >= ?;");
        shift.bindText(1, now);
        shift.bindText(2, normalizedProfileName);
        shift.bindInt(3, position);
        shift.stepDone();

        Statement insert = database.prepare(
            "INSERT INTO profile_order_items("
            "id, profile_name, kind, mod_id, separator_title, position, created_at, updated_at"
            ") VALUES(?, ?, 'separator', NULL, ?, ?, ?, ?);");
        insert.bindText(1, generateUuid());
        insert.bindText(2, normalizedProfileName);
        insert.bindText(3, normalizedTitle);
        insert.bindInt(4, position);
        insert.bindText(5, now);
        insert.bindText(6, now);
        insert.stepDone();

        compactProfileOrderPositions(database, normalizedProfileName);
        transaction.commit();

        return readProfileOrderItems(database, projectDirectory, normalizedProfileName, modsRoot);
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::deleteProfileOrderSeparator(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view separatorId,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        const std::wstring id = trim(std::wstring(separatorId));
        if (id.empty())
        {
            throw std::invalid_argument("Separator id is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        syncProfileOrderItems(database, normalizedProfileName);

        Statement remove = database.prepare(
            "DELETE FROM profile_order_items "
            "WHERE profile_name = ? AND id = ? AND kind = 'separator';");
        remove.bindText(1, normalizedProfileName);
        remove.bindText(2, id);
        remove.stepDone();

        compactProfileOrderPositions(database, normalizedProfileName);
        transaction.commit();

        return readProfileOrderItems(database, projectDirectory, normalizedProfileName, modsRoot);
    }

    std::vector<ProfileOrderItemRecord> InstanceMetadataStore::moveProfileOrderItem(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view orderItemId,
        int targetIndex,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        const std::wstring id = trim(std::wstring(orderItemId));
        if (id.empty())
        {
            throw std::invalid_argument("Profile order item id is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);

        Transaction transaction(database);
        syncProfileOrderItems(database, normalizedProfileName);

        moveProfileOrderStorageItems(
            database,
            normalizedProfileName,
            "profile_order_items",
            id,
            targetIndex,
            profileOrderSeparatorKind,
            ProfileOrderSeparatorMoveMode::Single);

        transaction.commit();
        return readProfileOrderItems(database, projectDirectory, normalizedProfileName, modsRoot);
    }

    void InstanceMetadataStore::replaceProfileOrderItems(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::vector<ProfileOrderImportItemRecord>& items)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        Database database = openInstanceDatabase(projectDirectory);
        syncInstalledModsFromDisk(database, projectDirectory);

        Transaction transaction(database);

        Statement remove = database.prepare("DELETE FROM profile_order_items WHERE profile_name = ?;");
        remove.bindText(1, normalizedProfileName);
        remove.stepDone();

        const std::wstring now = nowUtcText();
        int position = 0;
        for (const ProfileOrderImportItemRecord& item : items)
        {
            const std::wstring kind = trim(item.kind);
            if (kind == profileOrderSeparatorKind)
            {
                const std::wstring title = trim(item.separatorTitle);
                if (title.empty())
                {
                    continue;
                }

                Statement insert = database.prepare(
                    "INSERT INTO profile_order_items("
                    "id, profile_name, kind, mod_id, separator_title, position, created_at, updated_at"
                    ") VALUES(?, ?, 'separator', NULL, ?, ?, ?, ?);");
                insert.bindText(1, generateUuid());
                insert.bindText(2, normalizedProfileName);
                insert.bindText(3, title);
                insert.bindInt(4, position);
                insert.bindText(5, now);
                insert.bindText(6, now);
                insert.stepDone();
                ++position;
                continue;
            }

            if (kind != profileOrderModKind)
            {
                continue;
            }

            const std::wstring folderName = trim(item.folderName);
            if (folderName.empty())
            {
                continue;
            }

            Statement select = database.prepare(
                "SELECT id FROM mods "
                "WHERE folder_name = ? COLLATE NOCASE "
                "AND state IN ('installed', 'disabled') "
                "ORDER BY folder_name = ? DESC "
                "LIMIT 1;");
            select.bindText(1, folderName);
            select.bindText(2, folderName);
            if (!select.stepRow())
            {
                continue;
            }

            Statement insert = database.prepare(
                "INSERT OR IGNORE INTO profile_order_items("
                "id, profile_name, kind, mod_id, separator_title, position, created_at, updated_at"
                ") VALUES(?, ?, 'mod', ?, '', ?, ?, ?);");
            insert.bindText(1, generateUuid());
            insert.bindText(2, normalizedProfileName);
            insert.bindInt64(3, select.columnInt64(0));
            insert.bindInt(4, position);
            insert.bindText(5, now);
            insert.bindText(6, now);
            insert.stepDone();
            ++position;
        }

        appendMissingProfileModItems(database, normalizedProfileName);
        compactProfileOrderPositions(database, normalizedProfileName);
        transaction.commit();
    }

    std::vector<ProfilePluginOrderItemRecord> InstanceMetadataStore::listProfilePluginOrderItems(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::vector<std::wstring>& pluginNames)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        Database database = openInstanceDatabase(projectDirectory);

        Transaction transaction(database);
        syncProfilePluginOrderItems(database, normalizedProfileName, pluginNames);
        transaction.commit();

        return readProfilePluginOrderItems(database, normalizedProfileName);
    }

    void InstanceMetadataStore::replaceProfilePluginOrderItems(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::vector<ProfilePluginOrderImportItemRecord>& items)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        Database database = openInstanceDatabase(projectDirectory);

        Transaction transaction(database);

        Statement remove = database.prepare("DELETE FROM profile_plugin_order_items WHERE profile_name = ?;");
        remove.bindText(1, normalizedProfileName);
        remove.stepDone();

        const std::wstring now = nowUtcText();
        std::set<std::wstring> seenPlugins;
        int position = 0;
        for (const ProfilePluginOrderImportItemRecord& item : items)
        {
            const std::wstring kind = trim(item.kind);
            if (kind == profilePluginOrderSeparatorKind)
            {
                const std::wstring title = trim(item.separatorTitle);
                if (title.empty())
                {
                    continue;
                }

                Statement insert = database.prepare(
                    "INSERT INTO profile_plugin_order_items("
                    "id, profile_name, kind, plugin_name, separator_title, position, created_at, updated_at"
                    ") VALUES(?, ?, 'separator', '', ?, ?, ?, ?);");
                insert.bindText(1, generateUuid());
                insert.bindText(2, normalizedProfileName);
                insert.bindText(3, title);
                insert.bindInt(4, position);
                insert.bindText(5, now);
                insert.bindText(6, now);
                insert.stepDone();
                ++position;
                continue;
            }

            if (kind != profilePluginOrderPluginKind)
            {
                continue;
            }

            const std::wstring pluginName = trim(item.pluginName);
            const std::wstring key = toLower(pluginName);
            if (pluginName.empty() || !seenPlugins.insert(key).second)
            {
                continue;
            }

            Statement insert = database.prepare(
                "INSERT OR IGNORE INTO profile_plugin_order_items("
                "id, profile_name, kind, plugin_name, separator_title, position, created_at, updated_at"
                ") VALUES(?, ?, 'plugin', ?, '', ?, ?, ?);");
            insert.bindText(1, generateUuid());
            insert.bindText(2, normalizedProfileName);
            insert.bindText(3, pluginName);
            insert.bindInt(4, position);
            insert.bindText(5, now);
            insert.bindText(6, now);
            insert.stepDone();
            ++position;
        }

        compactProfilePluginOrderPositions(database, normalizedProfileName);
        transaction.commit();
    }

    std::vector<ProfilePluginOrderItemRecord> InstanceMetadataStore::createProfilePluginOrderSeparator(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::vector<std::wstring>& pluginNames,
        std::wstring_view title,
        int targetIndex)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        const std::wstring normalizedTitle = trim(std::wstring(title));
        if (normalizedTitle.empty())
        {
            throw std::invalid_argument("Separator title is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);

        Transaction transaction(database);
        syncProfilePluginOrderItems(database, normalizedProfileName, pluginNames);

        const int count = profilePluginOrderItemCount(database, normalizedProfileName);
        const int position = std::clamp(targetIndex, 0, count);
        const std::wstring now = nowUtcText();

        Statement shift = database.prepare(
            "UPDATE profile_plugin_order_items "
            "SET position = position + 1, updated_at = ? "
            "WHERE profile_name = ? AND position >= ?;");
        shift.bindText(1, now);
        shift.bindText(2, normalizedProfileName);
        shift.bindInt(3, position);
        shift.stepDone();

        Statement insert = database.prepare(
            "INSERT INTO profile_plugin_order_items("
            "id, profile_name, kind, plugin_name, separator_title, position, created_at, updated_at"
            ") VALUES(?, ?, 'separator', '', ?, ?, ?, ?);");
        insert.bindText(1, generateUuid());
        insert.bindText(2, normalizedProfileName);
        insert.bindText(3, normalizedTitle);
        insert.bindInt(4, position);
        insert.bindText(5, now);
        insert.bindText(6, now);
        insert.stepDone();

        compactProfilePluginOrderPositions(database, normalizedProfileName);
        transaction.commit();

        return readProfilePluginOrderItems(database, normalizedProfileName);
    }

    std::vector<ProfilePluginOrderItemRecord> InstanceMetadataStore::deleteProfilePluginOrderSeparator(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::vector<std::wstring>& pluginNames,
        std::wstring_view separatorId)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        const std::wstring id = trim(std::wstring(separatorId));
        if (id.empty())
        {
            throw std::invalid_argument("Separator id is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        syncProfilePluginOrderItems(database, normalizedProfileName, pluginNames);

        Statement remove = database.prepare(
            "DELETE FROM profile_plugin_order_items "
            "WHERE profile_name = ? AND id = ? AND kind = 'separator';");
        remove.bindText(1, normalizedProfileName);
        remove.bindText(2, id);
        remove.stepDone();

        compactProfilePluginOrderPositions(database, normalizedProfileName);
        transaction.commit();

        return readProfilePluginOrderItems(database, normalizedProfileName);
    }

    std::vector<ProfilePluginOrderItemRecord> InstanceMetadataStore::moveProfilePluginOrderItem(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::vector<std::wstring>& pluginNames,
        std::wstring_view orderItemId,
        int targetIndex)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::wstring normalizedProfileName = profileNameOrDefault(profileName);
        const std::wstring id = trim(std::wstring(orderItemId));
        if (id.empty())
        {
            throw std::invalid_argument("Plugin order item id is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        syncProfilePluginOrderItems(database, normalizedProfileName, pluginNames);

        moveProfileOrderStorageItems(
            database,
            normalizedProfileName,
            "profile_plugin_order_items",
            id,
            targetIndex,
            profilePluginOrderSeparatorKind,
            ProfileOrderSeparatorMoveMode::Block);

        transaction.commit();
        return readProfilePluginOrderItems(database, normalizedProfileName);
    }

    InstalledModRecord InstanceMetadataStore::registerInstalledMod(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modDirectory,
        std::wstring_view displayName,
        std::wstring_view version,
        const ModSourceRecord& source)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (modDirectory.empty() || !std::filesystem::exists(modDirectory) || !std::filesystem::is_directory(modDirectory))
        {
            throw std::invalid_argument("Installed mod directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);

        InstalledModRecord record;
        record.gameId = readMetadataValue(database, L"game_id");
        record.folderName = modDirectory.filename().wstring();
        record.displayName = displayName.empty() ? record.folderName : std::wstring(displayName);
        record.version = std::wstring(version);
        record.installedAt = nowUtcText();
        record.updatedAt = record.installedAt;
        record.state = L"installed";
        record.contentFingerprint = computeContentFingerprint(modDirectory);
        record.path = modDirectory;
        record.source = source;

        Transaction transaction(database);
        upsertModRecord(database, record);
        transaction.commit();

        record = readRecordByFolder(database, projectDirectory, record.folderName, modDirectory.parent_path());
        if (portableManifestNeedsWrite(record, false))
        {
            writePortableManifest(record);
        }
        return record;
    }

    InstalledModRecord InstanceMetadataStore::renameInstalledMod(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& currentModDirectory,
        const std::filesystem::path& targetModDirectory,
        std::wstring_view displayName)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty() || currentModDirectory.empty() || targetModDirectory.empty())
        {
            throw std::invalid_argument("Project and installed mod directories are required.");
        }
        if (currentModDirectory.parent_path() != targetModDirectory.parent_path())
        {
            throw std::invalid_argument("Installed mod rename must stay inside the same mods directory.");
        }
        if (!std::filesystem::is_directory(currentModDirectory))
        {
            throw std::invalid_argument("Installed mod directory does not exist.");
        }
        if (std::filesystem::exists(targetModDirectory))
        {
            throw std::invalid_argument("Installed mod rename target already exists.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        InstalledModRecord record = readRecordByFolder(
            database,
            projectDirectory,
            currentModDirectory.filename().wstring(),
            currentModDirectory.parent_path());
        if (record.state != L"installed" && record.state != L"disabled")
        {
            throw std::invalid_argument("Only installed mods can be renamed.");
        }

        std::error_code renameError;
        std::filesystem::rename(currentModDirectory, targetModDirectory, renameError);
        if (renameError)
        {
            throw std::runtime_error("Installed mod directory could not be renamed: " + renameError.message());
        }

        const InstalledModRecord previousRecord = record;
        try
        {
            record.folderName = targetModDirectory.filename().wstring();
            record.displayName = displayName.empty() ? record.folderName : std::wstring(displayName);
            record.updatedAt = nowUtcText();
            record.path = targetModDirectory;

            Transaction transaction(database);
            Statement update = database.prepare(
                "UPDATE mods SET folder_name = ?, display_name = ?, updated_at = ? WHERE id = ?;");
            update.bindText(1, record.folderName);
            update.bindText(2, record.displayName);
            update.bindText(3, record.updatedAt);
            update.bindInt64(4, record.id);
            update.stepDone();
            bumpModInventoryRevision(database);
            record = readRecordByFolder(
                database,
                projectDirectory,
                record.folderName,
                targetModDirectory.parent_path());
            writePortableManifest(record);
            transaction.commit();
            return record;
        }
        catch (...)
        {
            std::error_code rollbackError;
            std::filesystem::rename(targetModDirectory, currentModDirectory, rollbackError);
            if (!rollbackError)
            {
                try
                {
                    writePortableManifest(previousRecord);
                }
                catch (...)
                {
                    // Preserve the original failure. Database rollback and the
                    // directory name are the authoritative recovery state.
                }
            }
            throw;
        }
    }

    void InstanceMetadataStore::registerInstalledMods(
        const std::filesystem::path& projectDirectory,
        const std::vector<InstalledModImportRecord>& mods,
        const InstalledModImportProgress& progress)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        if (mods.empty())
        {
            return;
        }

        std::wstring gameId;
        {
            Database database = openInstanceDatabase(projectDirectory);
            gameId = readMetadataValue(database, L"game_id");
        }

        const std::wstring now = nowUtcText();
        std::vector<InstalledModRecord> records;
        records.reserve(mods.size());
        std::vector<unsigned char> shouldComputeContentFingerprint;
        shouldComputeContentFingerprint.reserve(mods.size());

        for (const InstalledModImportRecord& import : mods)
        {
            if (import.modDirectory.empty() ||
                !std::filesystem::exists(import.modDirectory) ||
                !std::filesystem::is_directory(import.modDirectory))
            {
                throw std::invalid_argument("Installed mod directory is required.");
            }

            InstalledModRecord record;
            record.gameId = gameId;
            record.folderName = import.modDirectory.filename().wstring();
            record.displayName = import.displayName.empty() ? record.folderName : import.displayName;
            record.version = import.version;
            record.installedAt = now;
            record.updatedAt = now;
            record.state = import.isEnabled ? L"installed" : L"disabled";
            record.path = import.modDirectory;
            record.source = import.source;
            record.sourceIsNexus = import.sourceIsNexus;
            record.sourceIsModdingFlow = import.sourceIsModdingFlow;
            record.isLocal = import.isLocal;
            record.isTranslation = import.isTranslation;
            record.isPatch = import.isPatch;

            records.push_back(std::move(record));
            shouldComputeContentFingerprint.push_back(import.computeContentFingerprint ? 1 : 0);
        }

        std::atomic<std::size_t> nextIndex{0};
        std::exception_ptr firstError;
        std::mutex errorMutex;
        std::mutex progressMutex;
        std::size_t processed = 0;
        const unsigned int hardwareThreads = std::thread::hardware_concurrency();
        const std::size_t detectedWorkers = hardwareThreads == 0 ? 4 : hardwareThreads;
        const std::size_t workerCount = (std::max<std::size_t>)(
            1,
            (std::min<std::size_t>)(
                (std::min<std::size_t>)(detectedWorkers, 8),
                records.size()));

        std::vector<std::thread> workers;
        workers.reserve(workerCount);
        for (std::size_t worker = 0; worker < workerCount; ++worker)
        {
            workers.emplace_back([&]()
            {
                for (;;)
                {
                    const std::size_t index = nextIndex.fetch_add(1, std::memory_order_relaxed);
                    if (index >= records.size())
                    {
                        break;
                    }

                    try
                    {
                        if (shouldComputeContentFingerprint[index])
                        {
                            records[index].contentFingerprint = computeContentFingerprint(records[index].path);
                        }
                    }
                    catch (...)
                    {
                        std::lock_guard lock(errorMutex);
                        if (!firstError)
                        {
                            firstError = std::current_exception();
                        }
                        break;
                    }

                    if (progress)
                    {
                        std::lock_guard lock(progressMutex);
                        ++processed;
                        progress(processed, records.size(), records[index].folderName);
                    }
                }
            });
        }

        for (std::thread& worker : workers)
        {
            worker.join();
        }

        if (firstError)
        {
            std::rethrow_exception(firstError);
        }

        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        for (InstalledModRecord& record : records)
        {
            upsertModRecord(database, record);
        }
        transaction.commit();

        for (const InstalledModRecord& record : records)
        {
            if (portableManifestNeedsWrite(record, false))
            {
                writePortableManifest(record);
            }
        }
    }

    void InstanceMetadataStore::deleteInstalledMod(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        const std::wstring folderName = modPath.filename().wstring();

        Transaction transaction(database);
        Statement id = database.prepare("SELECT id FROM mods WHERE folder_name = ? LIMIT 1;");
        id.bindText(1, folderName);
        if (id.stepRow())
        {
            Statement removeCache = database.prepare("DELETE FROM mod_files WHERE mod_id = ?;");
            removeCache.bindInt64(1, std::stoll(id.columnText(0)));
            removeCache.stepDone();
        }

        Statement statement = database.prepare(
            "UPDATE mods SET state = 'deleted', updated_at = ? WHERE folder_name = ?;");
        statement.bindText(1, nowUtcText());
        statement.bindText(2, folderName);
        statement.stepDone();
        bumpModInventoryRevision(database);
        transaction.commit();
    }

    void InstanceMetadataStore::setInstalledModEnabled(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        bool isEnabled)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        const std::wstring folderName = modPath.filename().wstring();
        InstalledModRecord record =
            readRecordByFolder(database, projectDirectory, folderName, modPath.parent_path());
        if (record.state != L"installed" && record.state != L"disabled")
        {
            throw std::invalid_argument("Only installed mods can be enabled or disabled.");
        }

        const std::wstring nextState = isEnabled ? L"installed" : L"disabled";
        const bool stateChanged = record.state != nextState;
        if (stateChanged)
        {
            record.state = nextState;
            record.updatedAt = nowUtcText();

            Transaction transaction(database);
            Statement statement = database.prepare(
                "UPDATE mods SET state = ?, updated_at = ? "
                "WHERE folder_name = ? AND state IN ('installed', 'disabled') AND state <> ?;");
            statement.bindText(1, record.state);
            statement.bindText(2, record.updatedAt);
            statement.bindText(3, folderName);
            statement.bindText(4, record.state);
            statement.stepDone();
            bumpModInventoryRevision(database);
            transaction.commit();

            record = readRecordByFolder(database, projectDirectory, folderName, modPath.parent_path());
        }

        if (portableManifestNeedsWrite(record, stateChanged))
        {
            writePortableManifest(record);
        }
    }

    void InstanceMetadataStore::setAllInstalledModsEnabled(
        const std::filesystem::path& projectDirectory,
        bool isEnabled,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        syncInstalledModsFromDisk(database, projectDirectory, modsRoot);

        const std::wstring nextState = isEnabled ? L"installed" : L"disabled";
        const std::wstring updatedAt = nowUtcText();
        std::vector<InstalledModRecord> records = readInstalledRecords(database, projectDirectory, modsRoot);
        std::vector<InstalledModRecord> manifestsToWrite;
        bool anyStateChanged = false;
        for (InstalledModRecord& record : records)
        {
            const bool stateChanged = record.state != nextState;
            anyStateChanged = anyStateChanged || stateChanged;
            if (stateChanged)
            {
                record.state = nextState;
                record.updatedAt = updatedAt;
            }

            if (portableManifestNeedsBulkWrite(record, stateChanged))
            {
                manifestsToWrite.push_back(record);
            }
        }

        Transaction transaction(database);
        Statement statement = database.prepare(
            "UPDATE mods SET state = ?, updated_at = ? "
            "WHERE state IN ('installed', 'disabled') AND state <> ?;");
        statement.bindText(1, nextState);
        statement.bindText(2, updatedAt);
        statement.bindText(3, nextState);
        statement.stepDone();
        if (anyStateChanged)
        {
            bumpModInventoryRevision(database);
        }
        transaction.commit();

        for (const InstalledModRecord& record : manifestsToWrite)
        {
            writePortableManifest(record);
        }
    }

    void InstanceMetadataStore::recordRemoteCheck(
        const std::filesystem::path& projectDirectory,
        const RemoteCheckRecord& check,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        const std::wstring checkedAt = check.checkedAt.empty() ? nowUtcText() : check.checkedAt;

        ModSourceRecord source = check.source;
        source.provider = normalizeProvider(source);
        source.lastCheckedAt = checkedAt;
        source.latestVersion = check.latestVersion;
        source.latestFileId = check.latestFileId;
        source.updateCheckState = check.lastCheckState;
        source.lastAttemptedAt = check.lastAttemptedAt.empty() ? checkedAt : check.lastAttemptedAt;

        std::optional<InstalledModRecord> manifestToWrite;
        Transaction transaction(database);

        Statement cache = database.prepare(
            "INSERT INTO remote_cache("
            "provider, game_domain, remote_mod_id, remote_file_id, latest_version, payload_json, checked_at"
            ") VALUES(?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(provider, game_domain, remote_mod_id, remote_file_id) DO UPDATE SET "
            "latest_version = excluded.latest_version,"
            "payload_json = excluded.payload_json,"
            "checked_at = excluded.checked_at;");
        cache.bindText(1, source.provider);
        cache.bindText(2, source.gameDomain);
        cache.bindText(3, source.remoteModId);
        cache.bindText(4, source.remoteFileId);
        cache.bindText(5, source.latestVersion);
        cache.bindText(6, check.payloadJson);
        cache.bindText(7, checkedAt);
        cache.stepDone();

        if (!check.folderName.empty())
        {
            Statement updateSource = database.prepare(
                "UPDATE mod_sources SET "
                "provider = ?,"
                "game_domain = ?,"
                "remote_mod_id = ?,"
                "remote_file_id = ?,"
                "url = CASE WHEN ? = '' THEN url ELSE ? END,"
                "last_checked_at = ?,"
                "latest_version = ?,"
                "latest_file_id = ?,"
                "last_check_state = ?,"
                "last_attempted_at = ? "
                "WHERE mod_id = (SELECT id FROM mods WHERE folder_name = ? LIMIT 1);");
            updateSource.bindText(1, source.provider);
            updateSource.bindText(2, source.gameDomain);
            updateSource.bindText(3, source.remoteModId);
            updateSource.bindText(4, source.remoteFileId);
            updateSource.bindText(5, source.url);
            updateSource.bindText(6, source.url);
            updateSource.bindText(7, checkedAt);
            updateSource.bindText(8, source.latestVersion);
            updateSource.bindText(9, source.latestFileId);
            updateSource.bindText(10, source.updateCheckState);
            updateSource.bindText(11, source.lastAttemptedAt);
            updateSource.bindText(12, check.folderName);
            updateSource.stepDone();

            try
            {
                InstalledModRecord record =
                    readRecordByFolder(database, projectDirectory, check.folderName, modsRoot);
                record.updatedAt = checkedAt;
                updateModFlags(database, record);
                manifestToWrite = std::move(record);
            }
            catch (const std::exception&)
            {
            }
        }

        transaction.commit();

        if (manifestToWrite.has_value())
        {
            try
            {
                writePortableManifest(manifestToWrite.value());
            }
            catch (const std::exception&)
            {
            }
        }
    }

    std::optional<ModUpdateSweepRecord> InstanceMetadataStore::modUpdateSweep(
        const std::filesystem::path& projectDirectory,
        std::wstring_view gameDomain)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        if (projectDirectory.empty() || trim(std::wstring(gameDomain)).empty())
        {
            throw std::invalid_argument("Project directory and game domain are required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        Statement statement = database.prepare(
            "SELECT game_domain, state, last_attempted_at, last_completed_at, baseline_completed_at, "
            "next_eligible_at, last_period, backoff_step, stop_reason "
            "FROM mod_update_sweeps WHERE game_domain = ? LIMIT 1;");
        statement.bindText(1, toLower(trim(std::wstring(gameDomain))));
        if (!statement.stepRow())
        {
            return std::nullopt;
        }

        return ModUpdateSweepRecord{
            statement.columnText(0),
            statement.columnText(1),
            statement.columnText(2),
            statement.columnText(3),
            statement.columnText(4),
            statement.columnText(5),
            statement.columnText(6),
            statement.columnInt(7),
            statement.columnText(8)
        };
    }

    void InstanceMetadataStore::recordModUpdateSweep(
        const std::filesystem::path& projectDirectory,
        const ModUpdateSweepRecord& sweep)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());
        const std::wstring gameDomain = toLower(trim(sweep.gameDomain));
        if (projectDirectory.empty() || gameDomain.empty())
        {
            throw std::invalid_argument("Project directory and game domain are required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        Statement statement = database.prepare(
            "INSERT INTO mod_update_sweeps("
            "game_domain, state, last_attempted_at, last_completed_at, baseline_completed_at, "
            "next_eligible_at, last_period, backoff_step, stop_reason"
            ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(game_domain) DO UPDATE SET "
            "state = excluded.state, "
            "last_attempted_at = excluded.last_attempted_at, "
            "last_completed_at = excluded.last_completed_at, "
            "baseline_completed_at = excluded.baseline_completed_at, "
            "next_eligible_at = excluded.next_eligible_at, "
            "last_period = excluded.last_period, "
            "backoff_step = excluded.backoff_step, "
            "stop_reason = excluded.stop_reason;");
        statement.bindText(1, gameDomain);
        statement.bindText(2, sweep.state);
        statement.bindText(3, sweep.lastAttemptedAt);
        statement.bindText(4, sweep.lastCompletedAt);
        statement.bindText(5, sweep.baselineCompletedAt);
        statement.bindText(6, sweep.nextEligibleAt);
        statement.bindText(7, sweep.lastPeriod);
        statement.bindInt(8, sweep.backoffStep);
        statement.bindText(9, sweep.stopReason);
        statement.stepDone();
    }

    ModFileSummary InstanceMetadataStore::summarizeModFiles(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        const std::filesystem::path resolvedModsRoot = modsRoot.empty() ? modPath.parent_path() : modsRoot;
        syncInstalledModsFromDisk(database, projectDirectory, resolvedModsRoot);

        InstalledModRecord record =
            readRecordByFolder(database, projectDirectory, modPath.filename().wstring(), resolvedModsRoot);
        ensureFileCachePrepared(database, record);
        Transaction transaction(database);
        refreshDetectedConflicts(database);
        transaction.commit();
        return summarizeCachedModFiles(database, record);
    }

    std::vector<ModFileSummaryRecord> InstanceMetadataStore::summarizeInstalledModFiles(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        ensureAllFileCachesPrepared(database, projectDirectory, modsRoot);

        const std::vector<InstalledModRecord> records =
            readInstalledRecords(database, projectDirectory, modsRoot);
        return summarizeCachedInstalledModFiles(database, records);
    }

    PersistedInstalledModsSnapshot InstanceMetadataStore::persistedInstalledModsSnapshot(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        PersistedInstalledModsSnapshot snapshot;
        snapshot.mods = readInstalledRecords(database, projectDirectory, modsRoot);
        snapshot.summaries = summarizeCachedInstalledModFiles(database, snapshot.mods);
        return snapshot;
    }

    std::vector<ModFileSummaryRecord> InstanceMetadataStore::summarizePersistedInstalledModFiles(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modsRoot)
    {
        return persistedInstalledModsSnapshot(projectDirectory, modsRoot).summaries;
    }

    std::vector<ModFileSummaryRecord> InstanceMetadataStore::summarizeProfileModFiles(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        ensureAllFileCachesPrepared(database, projectDirectory, modsRoot);
        return summarizeCachedProfileModFiles(database, projectDirectory, profileName, modsRoot);
    }

    std::vector<ModFileSummaryRecord> InstanceMetadataStore::summarizeCachedProfileModFilesForLaunch(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modsRoot)
    {
        const std::lock_guard metadataLock(metadataStoreMutex());

        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        return summarizeCachedProfileModFiles(database, projectDirectory, profileName, modsRoot);
    }

    std::vector<ModFileTreeEntry> InstanceMetadataStore::listModFileTree(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view relativeDirectory,
        const std::filesystem::path& modsRoot)
    {
        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        std::filesystem::path requested(relativeDirectory);
        if (requested.is_absolute())
        {
            throw std::invalid_argument("Relative directory is required.");
        }

        requested = requested.lexically_normal();
        std::wstring parent = normalizeRelativePath(requested);
        if (parent == L".")
        {
            parent.clear();
        }

        Database database = openInstanceDatabase(projectDirectory);
        const std::filesystem::path resolvedModsRoot = modsRoot.empty() ? modPath.parent_path() : modsRoot;

        InstalledModRecord record =
            readRecordByFolder(database, projectDirectory, modPath.filename().wstring(), resolvedModsRoot);

        ensureFileCachePrepared(database, record);

        const std::wstring parentPathKey = pathKey(parent);
        Statement statement = database.prepare(
            "SELECT name, relative_path, kind, size, path_key "
            "FROM mod_files "
            "WHERE mod_id = ? AND parent_key = ? "
            "ORDER BY CASE kind WHEN 'directory' THEN 0 ELSE 1 END, name COLLATE NOCASE;");
        statement.bindInt64(1, record.id);
        statement.bindText(2, parentPathKey);

        struct CachedTreeRow
        {
            ModFileTreeEntry entry;
            std::wstring pathKey;
        };

        std::vector<CachedTreeRow> rows;
        bool hasDirectory = false;
        bool hasFile = false;
        while (statement.stepRow())
        {
            const std::wstring kind = statement.columnText(2);
            const bool isDirectory = kind == L"directory";
            const std::wstring itemPathKey = statement.columnText(4);

            hasDirectory = hasDirectory || isDirectory;
            hasFile = hasFile || !isDirectory;
            rows.push_back(CachedTreeRow{
                ModFileTreeEntry{
                    statement.columnText(0),
                    statement.columnText(1),
                    isDirectory,
                    false,
                    static_cast<std::uintmax_t>(statement.columnInt64(3) < 0 ? 0 : statement.columnInt64(3)),
                    {},
                    {}
                },
                itemPathKey
            });
        }

        const std::set<std::wstring> pathKeysWithChildren = hasDirectory
            ? cachedDirectoryPathKeysWithChildren(database, record.id, parentPathKey)
            : std::set<std::wstring>{};
        const ConflictOwnerGroups ownersByPath = hasFile
            ? conflictOwnersForCachedTreeFiles(database, record.id, parentPathKey)
            : ConflictOwnerGroups{};

        std::vector<ModFileTreeEntry> entries;
        entries.reserve(rows.size());
        for (CachedTreeRow& row : rows)
        {
            if (row.entry.isDirectory)
            {
                row.entry.hasChildren = pathKeysWithChildren.contains(row.pathKey);
            }
            else
            {
                const auto owners = ownersByPath.find(row.pathKey);
                if (owners != ownersByPath.end())
                {
                    row.entry.conflictState = conflictStateForOwners(owners->second, record.id);
                    row.entry.conflictOwners = ownerNames(owners->second);
                }
            }

            entries.push_back(std::move(row.entry));
        }

        return entries;
    }

    ModDetailsContent InstanceMetadataStore::getModDetailsContent(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        const std::filesystem::path& modsRoot)
    {
        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        Database database = openInstanceDatabase(projectDirectory);
        const std::filesystem::path resolvedModsRoot = modsRoot.empty() ? modPath.parent_path() : modsRoot;
        InstalledModRecord record =
            readRecordByFolder(database, projectDirectory, modPath.filename().wstring(), resolvedModsRoot);
        ensureFileCachePrepared(database, record);

        struct CachedDetailsRow
        {
            std::wstring parentPath;
            std::wstring parentKey;
            std::wstring pathKey;
            ModFileTreeEntry entry;
        };

        Statement statement = database.prepare(
            "SELECT name, relative_path, kind, size, path_key, parent_key "
            "FROM mod_files "
            "WHERE mod_id = ? "
            "ORDER BY parent_key COLLATE NOCASE, "
            "CASE kind WHEN 'directory' THEN 0 ELSE 1 END, name COLLATE NOCASE;");
        statement.bindInt64(1, record.id);

        std::vector<CachedDetailsRow> rows;
        std::set<std::wstring> pathKeysWithChildren;
        while (statement.stepRow())
        {
            const std::wstring relativePath = statement.columnText(1);
            std::wstring parentPath = normalizeRelativePath(
                std::filesystem::path(relativePath).parent_path());
            if (parentPath == L".")
            {
                parentPath.clear();
            }

            const std::wstring kind = statement.columnText(2);
            const std::wstring parentKey = statement.columnText(5);
            pathKeysWithChildren.insert(parentKey);
            rows.push_back(CachedDetailsRow{
                std::move(parentPath),
                parentKey,
                statement.columnText(4),
                ModFileTreeEntry{
                    statement.columnText(0),
                    relativePath,
                    kind == L"directory",
                    false,
                    static_cast<std::uintmax_t>(statement.columnInt64(3) < 0 ? 0 : statement.columnInt64(3)),
                    {},
                    {}
                }
            });
        }

        const ConflictOwnerGroups ownersByPath = conflictOwnersForCachedModFiles(database, record.id);
        std::map<std::wstring, std::vector<ModFileTreeEntry>> entriesByDirectory;
        entriesByDirectory[L""];

        ModDetailsContent content;
        content.modPath = record.path;
        content.conflictTree.modPath = record.path;
        for (CachedDetailsRow& row : rows)
        {
            if (row.entry.isDirectory)
            {
                row.entry.hasChildren = pathKeysWithChildren.contains(row.pathKey);
            }
            else
            {
                const auto owners = ownersByPath.find(row.pathKey);
                if (owners != ownersByPath.end())
                {
                    row.entry.conflictState = conflictStateForOwners(owners->second, record.id);
                    row.entry.conflictOwners = ownerNames(owners->second);
                }

                if (row.entry.conflictState == L"overwrites" || row.entry.conflictState == L"conflict")
                {
                    ++content.conflictTree.totalOverwrites;
                    content.conflictTree.overwrites.push_back(row.entry);
                }
                if (row.entry.conflictState == L"overwritten" || row.entry.conflictState == L"conflict")
                {
                    ++content.conflictTree.totalOverwritten;
                    content.conflictTree.overwritten.push_back(row.entry);
                }
            }

            entriesByDirectory[row.parentPath].push_back(std::move(row.entry));
        }

        const auto sortByRelativePath = [](std::vector<ModFileTreeEntry>& entries)
        {
            std::stable_sort(
                entries.begin(),
                entries.end(),
                [](const ModFileTreeEntry& left, const ModFileTreeEntry& right)
                {
                    return toLower(left.relativePath) < toLower(right.relativePath);
                });
        };
        sortByRelativePath(content.conflictTree.overwrites);
        sortByRelativePath(content.conflictTree.overwritten);
        content.conflictTree.limit = (std::max)(
            content.conflictTree.totalOverwrites,
            content.conflictTree.totalOverwritten);

        content.directories.reserve(entriesByDirectory.size());
        for (auto& [relativePath, entries] : entriesByDirectory)
        {
            content.directories.push_back(ModFileTreeDirectory{
                relativePath,
                std::move(entries)
            });
        }
        return content;
    }

    ModConflictTreePage InstanceMetadataStore::listModConflictTree(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view cursor,
        int limit,
        const std::filesystem::path& modsRoot)
    {
        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        const auto normalizeLimit = [](int requested)
        {
            if (requested <= 0)
            {
                return 200;
            }

            return (std::min)(requested, 1000);
        };
        const auto parseCursor = [](std::wstring_view value)
        {
            if (value.empty())
            {
                return 0;
            }

            try
            {
                const unsigned long parsed = std::stoul(std::wstring(value));
                if (parsed > static_cast<unsigned long>((std::numeric_limits<int>::max)()))
                {
                    throw std::out_of_range("cursor");
                }
                return static_cast<int>(parsed);
            }
            catch (const std::exception&)
            {
                throw std::invalid_argument("Mod conflict tree cursor is invalid.");
            }
        };

        Database database = openInstanceDatabase(projectDirectory);
        const std::filesystem::path resolvedModsRoot = modsRoot.empty() ? modPath.parent_path() : modsRoot;
        InstalledModRecord record =
            readRecordByFolder(database, projectDirectory, modPath.filename().wstring(), resolvedModsRoot);
        ensureFileCachePrepared(database, record);

        const ConflictOwnerGroups ownersByPath = conflictOwnersForCachedModFiles(database, record.id);
        Statement statement = database.prepare(
            "SELECT name, relative_path, size, path_key "
            "FROM mod_files "
            "WHERE mod_id = ? AND kind = 'file' "
            "ORDER BY relative_path COLLATE NOCASE;");
        statement.bindInt64(1, record.id);

        const int start = parseCursor(cursor);
        const int pageLimit = normalizeLimit(limit);
        ModConflictTreePage page;
        page.modPath = record.path;
        page.limit = pageLimit;

        const auto pushIfVisible = [start, pageLimit](
            std::vector<ModFileTreeEntry>& target,
            int total,
            const ModFileTreeEntry& entry)
        {
            if (total <= start)
            {
                return;
            }

            if (static_cast<int>(target.size()) < pageLimit)
            {
                target.push_back(entry);
            }
        };

        while (statement.stepRow())
        {
            const std::wstring pathKeyValue = statement.columnText(3);
            const auto owners = ownersByPath.find(pathKeyValue);
            if (owners == ownersByPath.end())
            {
                continue;
            }

            const std::wstring state = conflictStateForOwners(owners->second, record.id);
            if (state.empty() || state == L"none")
            {
                continue;
            }

            ModFileTreeEntry entry{
                statement.columnText(0),
                statement.columnText(1),
                false,
                false,
                static_cast<std::uintmax_t>(statement.columnInt64(2) < 0 ? 0 : statement.columnInt64(2)),
                state,
                ownerNames(owners->second)
            };

            if (state == L"overwrites" || state == L"conflict")
            {
                ++page.totalOverwrites;
                pushIfVisible(page.overwrites, page.totalOverwrites, entry);
            }
            if (state == L"overwritten" || state == L"conflict")
            {
                ++page.totalOverwritten;
                pushIfVisible(page.overwritten, page.totalOverwritten, entry);
            }
        }

        const int largestTotal = (std::max)(page.totalOverwrites, page.totalOverwritten);
        if (start + pageLimit < largestTotal)
        {
            page.nextCursor = std::to_wstring(start + pageLimit);
        }

        return page;
    }

    namespace
    {
        InstallOperationRecord readInstallOperationRecord(Statement& statement)
        {
            InstallOperationRecord record;
            record.operationId = statement.columnText(0);
            record.sourceKind = statement.columnText(1);
            record.sourcePath = std::filesystem::path(statement.columnText(2));
            record.archiveFingerprint = statement.columnText(3);
            record.profileName = statement.columnText(4);
            record.existingModMode = statement.columnInt(5);
            record.targetModUuid = statement.columnText(6);
            record.targetFolder = statement.columnText(7);
            record.selectedOptionIdsJson = statement.columnText(8);
            record.manualDecisionsJson = statement.columnText(9);
            record.placementOverridesJson = statement.columnText(10);
            record.identityPlanJson = statement.columnText(11);
            record.requestJson = statement.columnText(12);
            record.beforeOrderId = statement.columnText(13);
            record.afterOrderId = statement.columnText(14);
            const std::int64_t enqueueSequence = statement.columnInt64(15);
            record.enqueueSequence = enqueueSequence < 0
                ? 0
                : static_cast<std::uint64_t>(enqueueSequence);
            record.state = statement.columnText(16);
            record.stage = statement.columnText(17);
            record.progressPercent = statement.columnInt(18);
            record.indeterminate = statement.columnInt(19) != 0;
            record.errorCode = statement.columnText(20);
            record.errorMessage = statement.columnText(21);
            record.resultJson = statement.columnText(22);
            return record;
        }

        constexpr const char* installOperationSelectColumns =
            "operation_id, source_kind, source_path, archive_fingerprint, profile_name, "
            "existing_mod_mode, target_mod_uuid, target_folder, selected_option_ids_json, "
            "manual_decisions_json, placement_overrides_json, identity_plan_json, request_json, "
            "before_order_id, after_order_id, enqueue_sequence, state, stage, progress_percent, "
            "indeterminate, error_code, error_message, result_json ";
    }

    std::uint64_t InstallOperationStore::save(
        const std::filesystem::path& projectDirectory,
        const InstallOperationRecord& operation)
    {
        if (projectDirectory.empty() || trim(operation.operationId).empty() ||
            trim(operation.sourceKind).empty() || operation.sourcePath.empty())
        {
            throw std::invalid_argument(
                "Project directory, operation id, source kind, and source path are required.");
        }

        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        Transaction transaction(database);
        std::uint64_t enqueueSequence = operation.enqueueSequence;
        if (enqueueSequence == 0)
        {
            Statement existing = database.prepare(
                "SELECT enqueue_sequence FROM install_operations WHERE operation_id = ? LIMIT 1;");
            existing.bindText(1, trim(operation.operationId));
            if (existing.stepRow() && existing.columnInt64(0) > 0)
            {
                enqueueSequence = static_cast<std::uint64_t>(existing.columnInt64(0));
            }
            else
            {
                Statement next = database.prepare(
                    "SELECT COALESCE(MAX(enqueue_sequence), 0) + 1 FROM install_operations;");
                enqueueSequence = next.stepRow()
                    ? static_cast<std::uint64_t>((std::max<std::int64_t>)(1, next.columnInt64(0)))
                    : 1;
            }
        }

        const std::wstring now = nowUtcText();
        Statement statement = database.prepare(
            "INSERT INTO install_operations("
            "operation_id, source_kind, source_path, archive_fingerprint, profile_name, "
            "existing_mod_mode, target_mod_uuid, target_folder, selected_option_ids_json, "
            "manual_decisions_json, placement_overrides_json, identity_plan_json, request_json, "
            "before_order_id, after_order_id, enqueue_sequence, state, stage, progress_percent, "
            "indeterminate, error_code, error_message, result_json, created_at, updated_at"
            ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(operation_id) DO UPDATE SET "
            "source_kind = excluded.source_kind, source_path = excluded.source_path, "
            "archive_fingerprint = excluded.archive_fingerprint, profile_name = excluded.profile_name, "
            "existing_mod_mode = excluded.existing_mod_mode, target_mod_uuid = excluded.target_mod_uuid, "
            "target_folder = excluded.target_folder, selected_option_ids_json = excluded.selected_option_ids_json, "
            "manual_decisions_json = excluded.manual_decisions_json, "
            "placement_overrides_json = excluded.placement_overrides_json, "
            "identity_plan_json = excluded.identity_plan_json, request_json = excluded.request_json, "
            "before_order_id = excluded.before_order_id, after_order_id = excluded.after_order_id, "
            "enqueue_sequence = excluded.enqueue_sequence, state = excluded.state, stage = excluded.stage, "
            "progress_percent = excluded.progress_percent, indeterminate = excluded.indeterminate, "
            "error_code = excluded.error_code, error_message = excluded.error_message, "
            "result_json = excluded.result_json, updated_at = excluded.updated_at;");
        statement.bindText(1, trim(operation.operationId));
        statement.bindText(2, trim(operation.sourceKind));
        statement.bindText(3, operation.sourcePath.wstring());
        statement.bindText(4, operation.archiveFingerprint);
        statement.bindText(5, operation.profileName.empty() ? L"Default" : operation.profileName);
        statement.bindInt(6, operation.existingModMode);
        statement.bindText(7, operation.targetModUuid);
        statement.bindText(8, operation.targetFolder);
        statement.bindText(9, operation.selectedOptionIdsJson.empty() ? L"[]" : operation.selectedOptionIdsJson);
        statement.bindText(10, operation.manualDecisionsJson.empty() ? L"[]" : operation.manualDecisionsJson);
        statement.bindText(11, operation.placementOverridesJson.empty() ? L"[]" : operation.placementOverridesJson);
        statement.bindText(12, operation.identityPlanJson.empty() ? L"{}" : operation.identityPlanJson);
        statement.bindText(13, operation.requestJson.empty() ? L"{}" : operation.requestJson);
        statement.bindText(14, operation.beforeOrderId);
        statement.bindText(15, operation.afterOrderId);
        statement.bindInt64(16, static_cast<std::int64_t>(enqueueSequence));
        statement.bindText(17, operation.state.empty() ? L"queued" : operation.state);
        statement.bindText(18, operation.stage.empty() ? L"queued" : operation.stage);
        statement.bindInt(19, operation.progressPercent);
        statement.bindInt(20, operation.indeterminate ? 1 : 0);
        statement.bindText(21, operation.errorCode);
        statement.bindText(22, operation.errorMessage);
        statement.bindText(23, operation.resultJson);
        statement.bindText(24, now);
        statement.bindText(25, now);
        statement.stepDone();
        transaction.commit();
        return enqueueSequence;
    }

    std::optional<InstallOperationRecord> InstallOperationStore::get(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId)
    {
        if (projectDirectory.empty() || trim(std::wstring(operationId)).empty())
        {
            throw std::invalid_argument("Project directory and operation id are required.");
        }
        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        const std::string sql = std::string("SELECT ") + installOperationSelectColumns +
            "FROM install_operations WHERE operation_id = ? LIMIT 1;";
        Statement statement = database.prepare(sql.c_str());
        statement.bindText(1, operationId);
        if (!statement.stepRow())
        {
            return std::nullopt;
        }
        return readInstallOperationRecord(statement);
    }

    std::vector<InstallOperationRecord> InstallOperationStore::list(
        const std::filesystem::path& projectDirectory,
        bool includeTerminal)
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }
        const std::lock_guard metadataLock(metadataStoreMutex());
        Database database = openInstanceDatabase(projectDirectory);
        std::string sql = std::string("SELECT ") + installOperationSelectColumns +
            "FROM install_operations ";
        if (!includeTerminal)
        {
            sql += "WHERE state NOT IN ('completed', 'failed', 'cancelled', 'needsReview') ";
        }
        sql += "ORDER BY enqueue_sequence, created_at, operation_id;";
        Statement statement = database.prepare(sql.c_str());
        std::vector<InstallOperationRecord> operations;
        while (statement.stepRow())
        {
            operations.push_back(readInstallOperationRecord(statement));
        }
        return operations;
    }
}

#endif
