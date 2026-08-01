#pragma once

#include "FluxoraCore/Services/InstallConflictPreviewService.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
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
        std::wstring latestFileId;
        std::wstring updateCheckState;
        std::wstring lastAttemptedAt;
    };

    enum class ArchiveModLinkMode
    {
        Replace,
        Merge
    };

    struct ArchiveInstallSourceMetadata
    {
        std::wstring archiveFileName;
        std::wstring version;
        ModSourceRecord source;
    };

    struct InstalledModArchiveSourceRecord
    {
        std::wstring modUuid;
        std::wstring archiveSha256;
        std::wstring archiveFileName;
        std::wstring version;
        ModSourceRecord source;
        ArchiveModLinkMode linkMode{ArchiveModLinkMode::Replace};
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
        std::wstring fomodModuleId;
        std::vector<std::wstring> identityAliases;
        std::vector<std::wstring> identityExcludedModUuids;
        int portableManifestSchemaVersion{0};
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

    struct ModIdentityCatalogQuery
    {
        std::wstring provider;
        std::wstring gameDomain;
        std::wstring remoteModId;
        std::wstring fomodModuleId;
        std::wstring normalizedName;
        std::vector<std::wstring> tokens;
        // Exact indexed signals are never discarded; this only bounds fuzzy token candidates.
        std::size_t fuzzyLimit{5};
    };

    struct ModIdentityCatalogCandidate
    {
        InstalledModRecord mod;
        std::wstring fomodModuleId;
        std::vector<std::wstring> aliases;
        bool excluded{false};
    };

    struct ModIdentityCatalogSnapshot
    {
        std::uint64_t catalogRevision{0};
        std::vector<ModIdentityCatalogCandidate> candidates;
    };

    struct ModIdentityPersistenceUpdate
    {
        std::wstring modUuid;
        std::wstring fomodModuleId;
        std::vector<std::wstring> confirmedAliases;
        std::wstring sourceProvider;
        std::wstring sourceGameDomain;
        std::wstring sourceRemoteModId;
        std::wstring sourceRemoteFileId;
        std::wstring exclusionProvider;
        std::wstring exclusionGameDomain;
        std::wstring exclusionRemoteModId;
        std::wstring exclusionIncomingName;
        std::vector<std::wstring> rejectedModUuids;
    };

    struct PendingInstallFinalizationMetadata
    {
        std::optional<ModIdentityPersistenceUpdate> identity;
        std::wstring archiveSha256;
        bool mergeArchiveLink{false};
        ArchiveInstallSourceMetadata archiveSource;
    };

    struct ModIdentityContentCacheRecord
    {
        std::vector<std::wstring> pluginFiles;
        std::vector<std::wstring> archiveFiles;
        std::vector<std::wstring> scriptExtenderDlls;
    };

    struct ModIdentityOnlineCacheRecord
    {
        std::wstring provider;
        std::wstring gameDomain;
        std::wstring remoteModId;
        std::wstring remoteFileId;
        std::wstring modName;
        std::wstring md5;
        std::wstring sha256;
        std::uintmax_t archiveSize{0};
        std::wstring checkedAt;
    };

    struct RemoteCheckRecord
    {
        std::wstring folderName;
        ModSourceRecord source;
        std::wstring latestVersion;
        std::wstring payloadJson;
        std::wstring checkedAt;
        std::wstring latestFileId;
        std::wstring lastCheckState;
        std::wstring lastAttemptedAt;
        std::wstring expectedInstalledVersion;
        std::wstring confirmedInstalledVersion;
    };

    struct ModUpdateSweepRecord
    {
        std::wstring gameDomain;
        std::wstring state;
        std::wstring lastAttemptedAt;
        std::wstring lastCompletedAt;
        std::wstring baselineCompletedAt;
        std::wstring nextEligibleAt;
        std::wstring lastPeriod;
        int backoffStep{0};
        std::wstring stopReason;
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

    struct PendingInstallSessionRecord
    {
        std::wstring operationId;
        std::wstring profileName;
        InstallConflictPreviewMode mode{InstallConflictPreviewMode::Install};
        std::wstring targetModUuid;
        int targetPosition{-1};
        std::wstring beforeOrderId;
        std::wstring afterOrderId;
        std::uint64_t enqueueSequence{0};
        std::uint64_t revision{0};
        std::wstring state;
        std::wstring finalOrderId;
        std::wstring pendingOrderId;
        std::vector<InstallConflictFile> files;
        std::vector<InstallConflictProfileMod> profileRows;
    };

    struct FinalizedPendingInstallRecord
    {
        InstalledModRecord mod;
        std::wstring orderId;
        ModFileSummary summary;
    };

    struct PersistedInstalledModsSnapshot
    {
        std::vector<InstalledModRecord> mods;
        // Index-aligned with mods so consumers can reuse records without a
        // second lookup or path-key map.
        std::vector<ModFileSummaryRecord> summaries;
    };

    enum class ArchiveBuildStatus
    {
        Ready,
        Installing,
        Installed,
        Deleted
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

        [[nodiscard]] static ArchiveBuildStatus archiveBuildStatus(
            const std::filesystem::path& projectDirectory,
            std::wstring_view archiveSha256);

        static void beginArchiveInstallAttempt(
            const std::filesystem::path& projectDirectory,
            std::wstring_view archiveSha256,
            std::wstring_view operationId,
            std::wstring_view targetFolderName);

        static void completeArchiveInstallAttempt(
            const std::filesystem::path& projectDirectory,
            std::wstring_view archiveSha256,
            std::wstring_view modUuid,
            std::wstring_view operationId,
            ArchiveModLinkMode linkMode,
            const ArchiveInstallSourceMetadata& source = {});

        static void failArchiveInstallAttempt(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId);

        [[nodiscard]] static std::vector<InstalledModArchiveSourceRecord>
            listInstalledModArchiveSources(
                const std::filesystem::path& projectDirectory);

        static void beginPendingInstallSession(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            std::wstring_view profileName,
            InstallConflictPreviewMode mode,
            std::wstring_view pendingOrderId,
            std::wstring_view targetModUuid,
            int targetPosition,
            std::wstring_view beforeOrderId = {},
            std::wstring_view afterOrderId = {});

        [[nodiscard]] static PendingInstallSessionRecord preparePendingInstallSession(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            const std::vector<InstallConflictFile>& files);

        [[nodiscard]] static PendingInstallSessionRecord rebasePendingInstallSession(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            std::wstring_view beforeOrderId,
            std::wstring_view afterOrderId,
            int fallbackTargetPosition,
            std::int64_t expectedRevision = -1,
            bool applyIfCompleted = false);

        [[nodiscard]] static PendingInstallSessionRecord completePendingInstallSession(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            std::wstring_view finalOrderId);

        [[nodiscard]] static PendingInstallSessionRecord failPendingInstallSession(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId);

        [[nodiscard]] static PendingInstallSessionRecord pendingInstallSession(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId);

        [[nodiscard]] static std::vector<PendingInstallSessionRecord> activePendingInstallSessions(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName);

        [[nodiscard]] static FinalizedPendingInstallRecord finalizePendingInstalledMod(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            const std::filesystem::path& modDirectory,
            std::wstring_view displayName,
            std::wstring_view version,
            const ModSourceRecord& source,
            const PendingInstallFinalizationMetadata& metadata = {});

#ifdef FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
        static void resetSqlPrepareCountForTesting();

        [[nodiscard]] static std::uint64_t sqlPrepareCountForTesting();

        static void resetSqlExecCountForTesting();

        [[nodiscard]] static std::uint64_t sqlExecCountForTesting();

        static void resetInventorySyncCountForTesting();

        [[nodiscard]] static std::uint64_t inventorySyncCountForTesting();

        static void setFileCacheScanFailureAfterEntriesForTesting(int entryCount);

        static void setPendingInstallFinalizeFailureForTesting(bool shouldFail);

        static void withMetadataLockForTesting(const std::function<void()>& action);

        static void resetStableMetadataHandleOpenCountForTesting();

        [[nodiscard]] static std::uint64_t stableMetadataHandleOpenCountForTesting();
#endif

        [[nodiscard]] static std::vector<InstalledModRecord> listInstalledMods(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static ModIdentityCatalogSnapshot queryModIdentityCandidates(
            const std::filesystem::path& projectDirectory,
            const ModIdentityCatalogQuery& query);

        [[nodiscard]] static std::uint64_t modCatalogRevision(
            const std::filesystem::path& projectDirectory);

        [[nodiscard]] static std::optional<InstalledModRecord> installedModByUuid(
            const std::filesystem::path& projectDirectory,
            std::wstring_view modUuid);

        static void recordModIdentity(
            const std::filesystem::path& projectDirectory,
            const ModIdentityPersistenceUpdate& update);

        [[nodiscard]] static std::optional<ModIdentityContentCacheRecord>
            modIdentityContentCache(
                const std::filesystem::path& projectDirectory,
                std::wstring_view archiveFingerprint);

        static void recordModIdentityContentCache(
            const std::filesystem::path& projectDirectory,
            std::wstring_view archiveFingerprint,
            const ModIdentityContentCacheRecord& content);

        [[nodiscard]] static std::optional<ModIdentityOnlineCacheRecord>
            modIdentityOnlineCache(
                const std::filesystem::path& projectDirectory,
                std::wstring_view archiveFingerprint,
                std::wstring_view provider,
                std::wstring_view gameDomain,
                std::wstring_view md5,
                std::wstring_view sha256,
                std::uintmax_t archiveSize);

        static void recordModIdentityOnlineCache(
            const std::filesystem::path& projectDirectory,
            std::wstring_view archiveFingerprint,
            const ModIdentityOnlineCacheRecord& online);

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

        [[nodiscard]] static std::vector<ProfilePluginOrderItemRecord> reorderProfilePluginOrderItems(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<std::wstring>& pluginNames,
            const std::vector<std::wstring>& orderedItemIds);

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

        // Renames a managed installed-mod directory while retaining its durable
        // UUID and profile-order relations. The target must not already exist.
        static InstalledModRecord renameInstalledMod(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& currentModDirectory,
            const std::filesystem::path& targetModDirectory,
            std::wstring_view displayName);

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

        static bool repairInstalledModVersion(
            const std::filesystem::path& projectDirectory,
            std::wstring_view folderName,
            std::wstring_view expectedVersion,
            std::wstring_view confirmedVersion,
            const std::filesystem::path& modsDirectory = {});

        [[nodiscard]] static std::optional<ModUpdateSweepRecord> modUpdateSweep(
            const std::filesystem::path& projectDirectory,
            std::wstring_view gameDomain);

        static void recordModUpdateSweep(
            const std::filesystem::path& projectDirectory,
            const ModUpdateSweepRecord& sweep);

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
