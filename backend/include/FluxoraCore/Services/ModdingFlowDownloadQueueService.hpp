#pragma once

#include "FluxoraCore/Services/IService.hpp"
#include "FluxoraCore/Services/ModdingFlowArtifactLookupService.hpp"
#include "FluxoraCore/Services/RemoteDownloadTransferService.hpp"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class DownloadTransferLimiter;
    class IModdingFlowPublicApiClient;
    class Logger;

    struct ModdingFlowManagedDownloadRequest
    {
        std::filesystem::path projectDirectory;
        std::string artifactId;
        std::string modId;
        std::string versionId;
        std::string jobId;
        std::wstring operationId;

        bool operator==(const ModdingFlowManagedDownloadRequest&) const = default;
    };

    enum class ModdingFlowManagedDownloadState
    {
        Queued,
        Downloading,
        Paused,
        RetryScheduled,
        Failed,
        Cancelled,
        Completed
    };

    struct ModdingFlowManagedDownloadSnapshot
    {
        ModdingFlowManagedDownloadRequest request;
        std::filesystem::path pendingPath;
        std::filesystem::path partialPath;
        std::filesystem::path destinationPath;
        std::wstring fileName;
        std::wstring gameSlug;
        std::wstring version;
        std::string expectedSha256;
        std::uint64_t expectedSize{0};
        std::uint64_t bytesReceived{0};
        std::uint64_t createdAtUnixMs{0};
        std::uint64_t retryAtUnixMs{0};
        ModdingFlowManagedDownloadState state{ModdingFlowManagedDownloadState::Queued};
        std::string message;

        bool operator==(const ModdingFlowManagedDownloadSnapshot&) const = default;
    };

    using ModdingFlowManagedTransferExecutor = std::function<RemoteDownloadTransferResult(
        const RemoteDownloadTransferRequest&,
        const IRemoteDownloadCancellation&)>;

    class IModdingFlowDownloadQueueService : public IService
    {
    public:
        ~IModdingFlowDownloadQueueService() override = default;

        [[nodiscard]] virtual ModdingFlowManagedDownloadSnapshot queue(
            const ModdingFlowManagedDownloadRequest& request) = 0;
        [[nodiscard]] virtual std::vector<ModdingFlowManagedDownloadSnapshot> list(
            const std::filesystem::path& projectDirectory) const = 0;
        [[nodiscard]] virtual bool ownsPendingPath(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath) const = 0;
        virtual void cancel(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath,
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual ModdingFlowManagedDownloadSnapshot resume(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath,
            std::wstring_view operationId) = 0;
        virtual void remove(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath) = 0;
        virtual void acknowledgeCompleted(
            const ModdingFlowManagedDownloadSnapshot& snapshot) = 0;
    };

    class ModdingFlowDownloadQueueService final : public IModdingFlowDownloadQueueService
    {
    public:
        ModdingFlowDownloadQueueService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings,
            DownloadTransferLimiter& transferLimiter,
            IModdingFlowArtifactLookupService& artifactLookup,
            ModdingFlowManagedTransferExecutor transfer);
        ~ModdingFlowDownloadQueueService() override;

        void initialize() override;
        void shutdown() override;

        [[nodiscard]] ModdingFlowManagedDownloadSnapshot queue(
            const ModdingFlowManagedDownloadRequest& request) override;
        [[nodiscard]] std::vector<ModdingFlowManagedDownloadSnapshot> list(
            const std::filesystem::path& projectDirectory) const override;
        [[nodiscard]] bool ownsPendingPath(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath) const override;
        void cancel(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath,
            std::wstring_view operationId) override;
        [[nodiscard]] ModdingFlowManagedDownloadSnapshot resume(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath,
            std::wstring_view operationId) override;
        void remove(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath) override;
        void acknowledgeCompleted(
            const ModdingFlowManagedDownloadSnapshot& snapshot) override;

    private:
        class Impl;
        std::unique_ptr<Impl> impl_;
    };

    [[nodiscard]] bool moddingFlowDownloadProviderCompiled() noexcept;
    [[nodiscard]] std::unique_ptr<IModdingFlowDownloadQueueService>
        createProductionModdingFlowDownloadQueueService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings,
            DownloadTransferLimiter& transferLimiter,
            IModdingFlowPublicApiClient& publicApi) noexcept;
}
