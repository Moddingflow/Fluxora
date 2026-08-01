#pragma once

#include "FluxoraCore/Services/RemoteDownloadCoordinator.hpp"
#include "FluxoraCore/Services/RemoteDownloadFileStore.hpp"
#include "FluxoraCore/Services/RemoteDownloadSidecarStore.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>

namespace fluxora
{
    class Logger;

    struct RemoteDownloadTransferRequest
    {
        RemoteArtifactDownloadRequest artifact;
        std::filesystem::path allowedRoot;
        std::filesystem::path partialPath;
        std::filesystem::path destinationPath;
        std::optional<std::uint64_t> expectedSize;
        std::string expectedSha256;
        SignedRemoteTransportPolicy transportPolicy;
        std::uint64_t checkpointIntervalBytes{4U * 1024U * 1024U};
        std::size_t maximumResolveAttempts{3U};
        std::uint64_t maximumRetryAfterSeconds{60U * 60U};
        std::function<void(std::uint64_t bytesReceived, std::uint64_t expectedSize)> progress;
    };

    enum class RemoteDownloadTransferOutcome
    {
        Completed,
        Cancelled,
        RetryScheduled,
        InvalidRequest,
        UnsafePath,
        DestinationExists,
        ProviderFailure,
        TransportFailure,
        ProtocolFailure,
        IntegrityFailure,
        FileFailure
    };

    struct RemoteDownloadTransferResult
    {
        RemoteDownloadTransferOutcome outcome{RemoteDownloadTransferOutcome::ProtocolFailure};
        std::optional<std::filesystem::path> finalPath;
        std::uint64_t bytesReceived{0};
        std::optional<std::uint64_t> retryAtUnixMs;
        bool resumableStateRetained{false};
        std::string message;
        std::wstring operationId;
    };

    using SignedRemoteTransportExecutor = std::function<SignedRemoteDownloadResponse(
        const ResolvedDownloadGrant&,
        const SignedRemoteDownloadRequest&,
        const IRemoteDownloadCancellation&,
        SignedRemoteChunkSink)>;
    using RemoteDownloadClock = std::function<std::uint64_t()>;

    class RemoteDownloadTransferService final
    {
    public:
        RemoteDownloadTransferService(
            RemoteDownloadCoordinator& coordinator,
            RemoteDownloadSidecarStore& sidecars,
            IRemoteDownloadFileStore& files,
            SignedRemoteTransportExecutor transport,
            RemoteDownloadClock clock = {},
            Logger* logger = nullptr);

        [[nodiscard]] RemoteDownloadTransferResult transfer(
            const RemoteDownloadTransferRequest& request,
            const IRemoteDownloadCancellation& cancellation);

    private:
        RemoteDownloadCoordinator& coordinator_;
        RemoteDownloadSidecarStore& sidecars_;
        IRemoteDownloadFileStore& files_;
        SignedRemoteTransportExecutor transport_;
        RemoteDownloadClock clock_;
        Logger* logger_;
    };
}
