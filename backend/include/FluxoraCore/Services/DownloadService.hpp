#pragma once

#include "FluxoraCore/Services/ContentLayoutService.hpp"
#include "FluxoraCore/Services/FomodInstallerService.hpp"
#include "FluxoraCore/Services/IService.hpp"

#include <condition_variable>
#include <deque>
#include <filesystem>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace fluxora
{
    class AppSettingsService;
    class BuildPathSettingsService;
    class Logger;

    struct DownloadEntry
    {
        std::wstring id;
        std::wstring name;
        std::wstring fileName;
        std::filesystem::path localPath;
        std::wstring source;
        std::wstring status;
        std::wstring sizeText;
        std::wstring createdAtText;
        int progressPercent{0};
        std::wstring progressText;
        std::wstring etaText;
        std::wstring downloadSpeedText;
        bool isDownloading{false};
        bool hasKnownProgress{false};
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
    };

    enum class ExistingModInstallMode
    {
        FailIfExists = 0,
        Replace = 1,
        Merge = 2
    };

    class DownloadService final : public IService
    {
    public:
        DownloadService(
            Logger& logger,
            AppSettingsService& settings,
            const BuildPathSettingsService& pathSettings) noexcept;
        ~DownloadService() override;

        void initialize() override;
        void shutdown() override;

        void registerNxmProtocol(const std::filesystem::path& executablePath) const;
        [[nodiscard]] bool isNxmProtocolRegistered(const std::filesystem::path& executablePath) const;

        [[nodiscard]] std::vector<DownloadEntry> listDownloads(
            const std::filesystem::path& projectDirectory) const;

        std::vector<DownloadEntry> captureNxmLinks(
            const std::filesystem::path& projectDirectory,
            const std::vector<std::wstring>& nxmLinks) const;

        std::vector<DownloadEntry> queueInboundNxmLinks(
            const std::vector<std::wstring>& nxmLinks) const;

        std::vector<DownloadEntry> importInboundNxmLinks(
            const std::filesystem::path& projectDirectory) const;

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

        InstalledMod installDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode = ExistingModInstallMode::FailIfExists,
            const std::vector<PlacementOverride>& placementOverrides = {}) const;

        InstalledMod installArchive(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode = ExistingModInstallMode::FailIfExists,
            const std::vector<PlacementOverride>& placementOverrides = {}) const;

        [[nodiscard]] PlacementPlan analyzeDownloadContentLayout(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            ExistingModInstallMode existingModMode = ExistingModInstallMode::FailIfExists) const;

        [[nodiscard]] FomodInstallerDescriptor analyzeFomodDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath) const;

        [[nodiscard]] PlacementPlan analyzeFomodDownloadContentLayout(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            ExistingModInstallMode existingModMode,
            const std::vector<std::wstring>& selectedOptionIds) const;

        InstalledMod installFomodDownload(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& downloadPath,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode,
            const std::vector<std::wstring>& selectedOptionIds,
            const std::vector<PlacementOverride>& placementOverrides = {}) const;

        InstalledMod installFomodArchive(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode,
            const std::vector<std::wstring>& selectedOptionIds,
            const std::vector<PlacementOverride>& placementOverrides = {}) const;

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        struct NxmDownloadJob
        {
            std::filesystem::path directory;
            std::filesystem::path pendingPath;
            std::wstring link;
            std::wstring nexusModName;
            std::string operationId;
        };

        [[nodiscard]] std::filesystem::path inboundDirectory() const;
        void processQueuedNxmDownload(const NxmDownloadJob& job) const;
        void runNxmDownloadWorker() const;
        void stopNxmDownloadWorker() noexcept;

        Logger& logger_;
        AppSettingsService& settings_;
        const BuildPathSettingsService& pathSettings_;
        mutable std::mutex nxmQueueMutex_;
        mutable std::condition_variable nxmQueueCv_;
        mutable std::deque<NxmDownloadJob> nxmQueue_;
        mutable std::thread nxmWorker_;
        mutable std::filesystem::path currentNxmDownloadPath_;
        mutable bool nxmWorkerStopping_{false};
        mutable bool nxmWorkerStarted_{false};
        bool initialized_{false};
    };
}
