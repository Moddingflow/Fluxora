#pragma once

#include "FluxoraCore/Services/RemoteDownloadProviderRegistry.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace fluxora
{
    enum class RemoteDownloadResumeDecision
    {
        Restart,
        Append,
        ReResolve
    };

    struct RemoteDownloadPreparation
    {
        std::optional<RemoteArtifactResumeState> state;
        std::optional<ResolvedDownloadGrant> grant;
        RemoteDownloadResolutionError error{RemoteDownloadResolutionError::None};
        std::string message;
        std::wstring operationId;
    };

    struct RemoteDownloadQueueEntry
    {
        RemoteArtifactDownloadRequest request;

        bool operator==(const RemoteDownloadQueueEntry&) const = default;
    };

    // Pure control-plane coordinator. It never opens a URL or a local artifact.
    class RemoteDownloadCoordinator final
    {
    public:
        explicit RemoteDownloadCoordinator(const RemoteDownloadProviderRegistry& providers) noexcept;

        [[nodiscard]] RemoteDownloadQueueEntry queue(
            RemoteArtifactDownloadRequest request) const;

        [[nodiscard]] RemoteDownloadPreparation resolveQueued(
            const RemoteDownloadQueueEntry& queued) const;

        [[nodiscard]] RemoteDownloadPreparation resolveNew(
            const RemoteArtifactDownloadRequest& request) const;

        [[nodiscard]] RemoteDownloadPreparation resolveResume(
            const RemoteArtifactResumeState& previous,
            std::wstring operationId) const;

        [[nodiscard]] RemoteDownloadPreparation resolveFallback(
            const RemoteArtifactResumeState& current,
            std::string currentRepresentationProviderId,
            std::wstring operationId) const;

        static void applyVerifiedRepresentationDecision(
            RemoteArtifactResumeState& state,
            RemoteDownloadResumeDecision decision,
            std::optional<RepresentationValidator> observedValidator = std::nullopt);

        static void checkpoint(
            RemoteArtifactResumeState& state,
            std::uint64_t bytesReceived);

        static void scheduleRetry(
            RemoteArtifactResumeState& state,
            std::uint64_t retryAtUnixMs);

    private:
        [[nodiscard]] RemoteDownloadPreparation resolve(
            const RemoteArtifactDownloadRequest& request,
            const RemoteArtifactResumeState* previous) const;

        const RemoteDownloadProviderRegistry& providers_;
    };
}
