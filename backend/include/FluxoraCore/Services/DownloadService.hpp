#pragma once

#include "FluxoraCore/Services/ArchiveCatalogService.hpp"
#include "FluxoraCore/Services/ContentLayoutService.hpp"
#include "FluxoraCore/Services/DownloadTransferLimiter.hpp"
#include "FluxoraCore/Services/FomodAutoSelectionService.hpp"
#include "FluxoraCore/Services/FomodInstallerService.hpp"
#include "FluxoraCore/Services/IService.hpp"
#include "FluxoraCore/Services/InstallConflictPreviewService.hpp"
#include "FluxoraCore/Services/ModIdentityResolver.hpp"

#include <condition_variable>
#include <deque>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace fluxora
{
    class AppSettingsService;
    class BuildPathSettingsService;
    class Logger;
    class NexusModsAuthService;

    struct DownloadEntry
    {
        std::wstring id;
        std::wstring name;
        std::wstring fileName;
        std::filesystem::path localPath;
        std::wstring source;
        std::wstring status;
        std::wstring archiveId;
        std::wstring buildStatus;
        std::wstring transferState{L"idle"};
        std::wstring transferMessage;
        std::wstring sizeText;
        std::wstring createdAtText;
        int progressPercent{0};
        std::wstring progressText;
        std::wstring etaText;
        std::wstring downloadSpeedText;
        bool isDownloading{false};
        bool hasKnownProgress{false};
        bool hasResolvedFileName{true};
        bool canResume{false};
        bool canInstall{false};
        bool canDelete{true};
    };

    struct InstalledMod
    {
        std::filesystem::path id;
        std::wstring name;
        std::wstring version;
        bool isEnabled{true};
        std::wstring latestVersion;
        bool sourceIsNexus{false};
        bool sourceIsModdingFlow{false};
        std::wstring sourceProvider;
        std::wstring sourceGameDomain;
        std::wstring sourceModId;
        std::wstring sourceFileId;
        std::wstring sourceUrl;
        bool isLocal{true};
        bool isTranslation{false};
        bool isPatch{false};
        std::wstring latestFileId;
        std::wstring updateCheckState;
        std::wstring modUuid;
        std::wstring orderId;
        int fileCount{0};
        int conflictingFileCount{0};
        int overwrittenFileCount{0};
        int overwritingFileCount{0};
        std::vector<std::wstring> overwritesModIds;
        std::vector<std::wstring> overwrittenByModIds;
    };

    enum class ExistingModInstallMode
    {
        FailIfExists = 0,
        Replace = 1,
        Merge = 2
    };

    using InstallConflictSnapshotCallback =
        std::function<void(const FluxoraInstallConflictSnapshot& snapshot)>;

    class DownloadService final : public IService
    {
    public:
        DownloadService(
            Logger& logger,
            AppSettingsService& settings,
            const BuildPathSettingsService& pathSettings,
            DownloadTransferLimiter& transferLimiter) noexcept;
        DownloadService(
            Logger& logger,
            AppSettingsService& settings,
            const BuildPathSettingsService& pathSettings,
            DownloadTransferLimiter& transferLimiter,
            NexusModsAuthService& nexusAuth) noexcept;
        ~DownloadService() override;

        void initialize() override;
        void shutdown() override;

        void registerNxmProtocol(const std::filesystem::path& executablePath) const;
        [[nodiscard]] bool isNxmProtocolRegistered(const std::filesystem::path& executablePath) const;
        [[nodiscard]] bool canAutomaticallyDownloadNexus() const;

        [[nodiscard]] std::vector<DownloadEntry> listDownloads(
            const std::filesystem::path& projectDirectory) const;

        std::vector<DownloadEntry> captureNxmLinks(
            const std::filesystem::path& projectDirectory,
            const std::vector<std::wstring>& nxmLinks) const;

        std::vector<DownloadEntry> queueInboundNxmLinks(
            const std::vector<std::wstring>& nxmLinks) const;

        std::vector<DownloadEntry> importInboundNxmLinks(
            const std::filesystem::path& projectDirectory) const;

        DownloadEntry downloadNxmForFluxPack(
            const std::filesystem::path& projectDirectory,
            std::wstring_view nxmLink) const;

        DownloadEntry importLocalFile(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& sourcePath) const;

        void deleteDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath) const;

        void cancelDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath) const;

        DownloadEntry resumeDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath) const;

        [[nodiscard]] FluxoraInstallPlan planDownloadInstall(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            std::wstring_view profileName = {},
            std::wstring_view requestedModName = {}) const;

        [[nodiscard]] FluxoraInstallPlan planArchiveInstall(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath,
            std::wstring_view profileName = {},
            std::wstring_view requestedModName = {}) const;

        // Strong, cache-backed source identity used by durable install resume.
        // It deliberately runs on an install worker rather than the submit path.
        [[nodiscard]] std::wstring archiveFingerprint(
            const std::filesystem::path& archivePath) const;

        [[nodiscard]] std::optional<InstalledMod> completedInstallResult(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId) const;

        InstalledMod installDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode = ExistingModInstallMode::FailIfExists,
            const std::vector<PlacementOverride>& placementOverrides = {},
            const ModIdentityInstallSelection* identitySelection = nullptr,
            std::wstring_view profileName = {},
            int modOrderTargetIndex = -1,
            const InstallConflictSnapshotCallback& conflictProgress = {}) const;

        InstalledMod installArchive(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode = ExistingModInstallMode::FailIfExists,
            const std::vector<PlacementOverride>& placementOverrides = {},
            const ModIdentityInstallSelection* identitySelection = nullptr,
            std::wstring_view profileName = {},
            int modOrderTargetIndex = -1,
            const InstallConflictSnapshotCallback& conflictProgress = {}) const;

        [[nodiscard]] PlacementPlan analyzeDownloadContentLayout(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            ExistingModInstallMode existingModMode = ExistingModInstallMode::FailIfExists) const;

        [[nodiscard]] FomodInstallerDescriptor analyzeFomodDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            std::wstring_view profileName = {},
            const std::vector<FomodManualDecision>& manualDecisions = {}) const;

        [[nodiscard]] PlacementPlan analyzeFomodDownloadContentLayout(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            ExistingModInstallMode existingModMode,
            const std::vector<std::wstring>& selectedOptionIds,
            std::wstring_view profileName = {},
            std::wstring_view fomodContextId = {},
            const std::vector<FomodManualDecision>& manualDecisions = {}) const;

        InstalledMod installFomodDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode,
            const std::vector<std::wstring>& selectedOptionIds,
            const std::vector<PlacementOverride>& placementOverrides = {},
            const ModIdentityInstallSelection* identitySelection = nullptr,
            std::wstring_view profileName = {},
            std::wstring_view fomodContextId = {},
            const std::vector<FomodManualDecision>& manualDecisions = {},
            int modOrderTargetIndex = -1,
            const InstallConflictSnapshotCallback& conflictProgress = {}) const;

        InstalledMod installFomodArchive(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode,
            const std::vector<std::wstring>& selectedOptionIds,
            const std::vector<PlacementOverride>& placementOverrides = {},
            const ModIdentityInstallSelection* identitySelection = nullptr,
            std::wstring_view profileName = {},
            std::wstring_view fomodContextId = {},
            const std::vector<FomodManualDecision>& manualDecisions = {},
            int modOrderTargetIndex = -1,
            const InstallConflictSnapshotCallback& conflictProgress = {}) const;

        [[nodiscard]] bool isInitialized() const noexcept;

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        void queueTransferProbeForTest(std::function<void()> transfer) const;
        void runSynchronousTransferProbeForTest(
            std::function<void()> beforeAcquire,
            std::function<void()> transfer) const;
#endif

    private:
        struct NxmDownloadJob
        {
            std::filesystem::path projectDirectory;
            std::filesystem::path directory;
            std::filesystem::path pendingPath;
            std::wstring link;
            std::wstring nexusModName;
            std::string operationId;
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
            std::function<void()> transferProbe;
#endif
        };

        [[nodiscard]] std::filesystem::path inboundDirectory() const;
        void processQueuedNxmDownload(const NxmDownloadJob& job) const;
        void enqueueNxmDownloadJob(NxmDownloadJob job) const;
        void runNxmDownloadWorker() const noexcept;
        [[nodiscard]] bool stopNxmDownloadWorker() noexcept;
        [[nodiscard]] DownloadEntry buildCatalogEntry(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& path) const;

        Logger& logger_;
        AppSettingsService& settings_;
        const BuildPathSettingsService& pathSettings_;
        ArchiveCatalogService archiveCatalog_;
        NexusModsAuthService* nexusAuth_{nullptr};
        mutable std::mutex nxmShutdownMutex_;
        mutable std::mutex nxmQueueMutex_;
        mutable std::condition_variable nxmQueueCv_;
        mutable std::deque<NxmDownloadJob> nxmQueue_;
        mutable std::vector<std::thread> nxmWorkers_;
        mutable std::vector<std::filesystem::path> currentNxmDownloadPaths_;
        DownloadTransferLimiter& transferLimiter_;
        mutable bool nxmWorkerStopping_{false};
        mutable bool nxmWorkerStarted_{false};
        mutable bool nxmAcceptingJobs_{false};
        bool initialized_{false};
    };
}
