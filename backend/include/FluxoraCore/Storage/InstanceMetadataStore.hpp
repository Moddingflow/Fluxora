#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    struct ModSourceRecord
    {
        std::wstring provider;
        std::wstring gameDomain;
        std::wstring remoteModId;
        std::wstring remoteFileId;
        std::wstring url;
        std::wstring lastCheckedAt;
        std::wstring latestVersion;
    };

    struct InstalledModRecord
    {
        std::int64_t id{0};
        std::wstring uuid;
        std::wstring gameId;
        std::wstring folderName;
        std::wstring displayName;
        std::wstring version;
        std::wstring installedAt;
        std::wstring updatedAt;
        std::wstring state;
        std::wstring contentFingerprint;
        bool sourceIsNexus{false};
        bool sourceIsModdingFlow{false};
        bool isLocal{false};
        bool isTranslation{false};
        bool isPatch{false};
        std::filesystem::path path;
        ModSourceRecord source;
    };

    struct InstalledModImportRecord
    {
        std::filesystem::path modDirectory;
        std::wstring displayName;
        std::wstring version;
        bool isEnabled{true};
        ModSourceRecord source;
        bool computeContentFingerprint{true};
        bool sourceIsNexus{false};
        bool sourceIsModdingFlow{false};
        bool isLocal{false};
        bool isTranslation{false};
        bool isPatch{false};
    };

    using InstalledModImportProgress =
        std::function<void(std::size_t processed, std::size_t total, std::wstring_view folderName)>;

    struct RemoteCheckRecord
    {
        std::wstring folderName;
        ModSourceRecord source;
        std::wstring latestVersion;
        std::wstring payloadJson;
        std::wstring checkedAt;
    };

    struct ModFileSummary
    {
        int fileCount{0};
        int conflictingFileCount{0};
        int overwrittenFileCount{0};
        int overwritingFileCount{0};
        std::vector<std::wstring> overwritesModIds;
        std::vector<std::wstring> overwrittenByModIds;
    };

    struct ModFileSummaryRecord
    {
        std::wstring folderName;
        std::filesystem::path modPath;
        ModFileSummary summary;
    };

    struct PersistedInstalledModsSnapshot
    {
        std::vector<InstalledModRecord> mods;
        // Index-aligned with mods so consumers can reuse records without a
        // second lookup or path-key map.
        std::vector<ModFileSummaryRecord> summaries;
    };

    struct ModFileTreeEntry
    {
        std::wstring name;
        std::wstring relativePath;
        bool isDirectory{false};
        bool hasChildren{false};
        std::uintmax_t size{0};
        std::wstring conflictState;
        std::vector<std::wstring> conflictOwners;
    };

    struct ModConflictTreePage
    {
        std::filesystem::path modPath;
        int totalOverwrites{0};
        int totalOverwritten{0};
        int limit{0};
        std::wstring nextCursor;
        std::vector<ModFileTreeEntry> overwrites;
        std::vector<ModFileTreeEntry> overwritten;
    };

    struct ModFileTreeDirectory
    {
        std::wstring relativePath;
        std::vector<ModFileTreeEntry> entries;
    };

    struct ModDetailsContent
    {
        std::filesystem::path modPath;
        std::vector<ModFileTreeDirectory> directories;
        ModConflictTreePage conflictTree;
    };

    struct ProfileOrderItemRecord
    {
        std::wstring id;
        std::wstring profileName;
        std::wstring kind;
        int position{0};
        std::wstring separatorTitle;
        bool hasMod{false};
        InstalledModRecord mod;
    };

    struct ProfileOrderImportItemRecord
    {
        std::wstring kind;
        std::wstring folderName;
        std::wstring separatorTitle;
    };

    struct ProfilePluginOrderItemRecord
    {
        std::wstring id;
        std::wstring profileName;
        std::wstring kind;
        int position{0};
        std::wstring pluginName;
        std::wstring separatorTitle;
    };

    struct ProfilePluginOrderImportItemRecord
    {
        std::wstring kind;
        std::wstring pluginName;
        std::wstring separatorTitle;
    };

    class InstanceMetadataStore final
    {
    public:
        InstanceMetadataStore() = delete;

        static void ensureInstance(
            const std::filesystem::path& projectDirectory,
            std::wstring_view gameId = {});

        [[nodiscard]] static std::wstring gameId(
            const std::filesystem::path& projectDirectory);

        // Marks a user-visible project activation. The first exact workspace
        // read for a newly active project validates persisted file-index
        // generations; persisted snapshot reads remain database-only.
        static void beginProjectActivation(
            const std::filesystem::path& projectDirectory);

#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
        static void resetSqlPrepareCountForTesting();

        [[nodiscard]] static std::uint64_t sqlPrepareCountForTesting();

        static void resetSqlExecCountForTesting();

        [[nodiscard]] static std::uint64_t sqlExecCountForTesting();

        static void resetInventorySyncCountForTesting();

        [[nodiscard]] static std::uint64_t inventorySyncCountForTesting();

        static void setFileCacheScanFailureAfterEntriesForTesting(int entryCount);

        static void resetStableMetadataHandleOpenCountForTesting();

        [[nodiscard]] static std::uint64_t stableMetadataHandleOpenCountForTesting();
#endif

        [[nodiscard]] static std::vector<InstalledModRecord> listInstalledMods(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory = {});

        static void refreshInstalledModsFromDisk(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory = {});

        static void invalidateModFileCaches(
            const std::filesystem::path& projectDirectory,
            const std::vector<std::filesystem::path>& changedPaths,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static std::vector<ProfileOrderItemRecord> listProfileOrderItems(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsDirectory = {});

        // Persisted UI snapshots use the saved profile order without touching
        // the installed-mod directory.
        [[nodiscard]] static std::vector<ProfileOrderItemRecord> listCachedProfileOrderItems(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsDirectory = {});

        // The first launch read after a fresh project activation reconciles only
        // top-level installed folders, then repairs the saved profile order. The
        // database remains authoritative for enabled state, and the path never
        // prepares file or conflict caches.
        [[nodiscard]] static std::vector<ProfileOrderItemRecord> listLaunchProfileOrderItems(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static std::vector<std::wstring> listProfileNames(
            const std::filesystem::path& projectDirectory);

        static void ensureProfileState(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsDirectory = {});

        static void cloneProfileState(
            const std::filesystem::path& projectDirectory,
            std::wstring_view sourceProfileName,
            std::wstring_view targetProfileName,
            const std::filesystem::path& modsDirectory = {});

        static void renameProfileState(
            const std::filesystem::path& projectDirectory,
            std::wstring_view sourceProfileName,
            std::wstring_view targetProfileName);

        static void deleteProfileState(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName);

        [[nodiscard]] static std::vector<ProfileOrderItemRecord> createProfileOrderSeparator(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view title,
            int targetIndex,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static std::vector<ProfileOrderItemRecord> deleteProfileOrderSeparator(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view separatorId,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static std::vector<ProfileOrderItemRecord> moveProfileOrderItem(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view orderItemId,
            int targetIndex,
            const std::filesystem::path& modsDirectory = {});

        static void replaceProfileOrderItems(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<ProfileOrderImportItemRecord>& items);

        [[nodiscard]] static std::vector<ProfilePluginOrderItemRecord> listProfilePluginOrderItems(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<std::wstring>& pluginNames);

        static void replaceProfilePluginOrderItems(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<ProfilePluginOrderImportItemRecord>& items);

        [[nodiscard]] static std::vector<ProfilePluginOrderItemRecord> createProfilePluginOrderSeparator(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<std::wstring>& pluginNames,
            std::wstring_view title,
            int targetIndex);

        [[nodiscard]] static std::vector<ProfilePluginOrderItemRecord> deleteProfilePluginOrderSeparator(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<std::wstring>& pluginNames,
            std::wstring_view separatorId);

        [[nodiscard]] static std::vector<ProfilePluginOrderItemRecord> moveProfilePluginOrderItem(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<std::wstring>& pluginNames,
            std::wstring_view orderItemId,
            int targetIndex);

        static InstalledModRecord registerInstalledMod(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modDirectory,
            std::wstring_view displayName,
            std::wstring_view version,
            const ModSourceRecord& source);

        static void registerInstalledMods(
            const std::filesystem::path& projectDirectory,
            const std::vector<InstalledModImportRecord>& mods,
            const InstalledModImportProgress& progress = {});

        static void deleteInstalledMod(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath);

        static void setInstalledModEnabled(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            bool isEnabled);

        static void setAllInstalledModsEnabled(
            const std::filesystem::path& projectDirectory,
            bool isEnabled,
            const std::filesystem::path& modsDirectory = {});

        static void recordRemoteCheck(
            const std::filesystem::path& projectDirectory,
            const RemoteCheckRecord& check,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static ModFileSummary summarizeModFiles(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static std::vector<ModFileSummaryRecord> summarizeInstalledModFiles(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory = {});

        // Reads durable installed records and their freshness-masked summaries
        // from one database snapshot without inventory or filesystem work.
        [[nodiscard]] static PersistedInstalledModsSnapshot persistedInstalledModsSnapshot(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory = {});

        // Interactive startup may render the last durable snapshot while a
        // watcher-covered disk reconciliation runs after the first frame.
        [[nodiscard]] static std::vector<ModFileSummaryRecord> summarizePersistedInstalledModFiles(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static std::vector<ModFileSummaryRecord> summarizeProfileModFiles(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsDirectory = {});

        // Launch-time reads use the prepared file cache only. This keeps the
        // VFS hot path from walking the mods directory before process startup.
        [[nodiscard]] static std::vector<ModFileSummaryRecord> summarizeCachedProfileModFilesForLaunch(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static std::vector<ModFileTreeEntry> listModFileTree(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view relativeDirectory,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static ModDetailsContent getModDetailsContent(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static ModConflictTreePage listModConflictTree(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view cursor,
            int limit,
            const std::filesystem::path& modsDirectory = {});
    };
}
