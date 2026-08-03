#include "FluxoraCore/Services/RemoteDownloadCoordinator.hpp"

#include <stdexcept>
#include <utility>

namespace fluxora
{
    RemoteDownloadCoordinator::RemoteDownloadCoordinator(
        const RemoteDownloadProviderRegistry& providers) noexcept
        : providers_(providers)
    {
    }

    RemoteDownloadQueueEntry RemoteDownloadCoordinator::queue(
        RemoteArtifactDownloadRequest request) const
    {
        validateRemoteArtifactDownloadRequest(request);
        return {.request = std::move(request)};
    }

    RemoteDownloadPreparation RemoteDownloadCoordinator::resolveQueued(
        const RemoteDownloadQueueEntry& queued) const
    {
        return resolve(queued.request, nullptr);
    }

    RemoteDownloadPreparation RemoteDownloadCoordinator::resolveNew(
        const RemoteArtifactDownloadRequest& request) const
    {
        return resolve(request, nullptr);
    }

    RemoteDownloadPreparation RemoteDownloadCoordinator::resolveResume(
        const RemoteArtifactResumeState& previous,
        std::wstring operationId) const
    {
        validateRemoteArtifactResumeState(previous, RemoteArtifactResumeValidation::Runtime);
        RemoteArtifactDownloadRequest request{
            .providerId = previous.providerId,
            .artifactId = previous.artifactId,
            .modId = previous.modId,
            .versionId = previous.versionId,
            .jobId = previous.jobId,
            .operationId = std::move(operationId)};
        return resolve(request, &previous);
    }

    RemoteDownloadPreparation RemoteDownloadCoordinator::resolveFallback(
        const RemoteArtifactResumeState& current,
        std::string currentRepresentationProviderId,
        std::wstring operationId) const
    {
        validateRemoteArtifactResumeState(current, RemoteArtifactResumeValidation::Runtime);
        RemoteDownloadFallbackRequest request{
            .providerId = current.providerId,
            .artifactId = current.artifactId,
            .modId = current.modId,
            .versionId = current.versionId,
            .jobId = current.jobId,
            .grantId = current.grantId,
            .currentRepresentationProviderId = std::move(currentRepresentationProviderId),
            .expectedSize = current.expectedSize,
            .expectedSha256 = current.expectedSha256,
            .operationId = std::move(operationId)};

        RemoteDownloadResolution resolution = providers_.resolveFallback(request);
        if (!resolution.grant.has_value())
        {
            return {
                .error = resolution.error,
                .message = resolution.message,
                .operationId = resolution.operationId};
        }

        const ResolvedDownloadGrant& grant = *resolution.grant;
        RemoteArtifactResumeState state{
            .providerId = request.providerId,
            .artifactId = request.artifactId,
            .modId = request.modId,
            .versionId = request.versionId,
            .jobId = request.jobId,
            .grantId = grant.grantId,
            .expectedSize = grant.expectedSize,
            .expectedSha256 = grant.expectedSha256,
            .bytesReceived = 0U,
            .grantExpiresAtUnixMs = grant.expiresAtUnixMs,
            .phase = RemoteArtifactResumePhase::AwaitingRepresentation};
        return {
            .state = std::move(state),
            .grant = std::move(resolution.grant),
            .error = RemoteDownloadResolutionError::None,
            .operationId = resolution.operationId};
    }

    RemoteDownloadPreparation RemoteDownloadCoordinator::resolve(
        const RemoteArtifactDownloadRequest& request,
        const RemoteArtifactResumeState* previous) const
    {
        RemoteDownloadResolution resolution = providers_.resolve(request);
        if (!resolution.grant.has_value())
        {
            return {
                .error = resolution.error,
                .message = resolution.message,
                .operationId = resolution.operationId};
        }

        const ResolvedDownloadGrant& grant = *resolution.grant;
        RemoteArtifactResumeState state{
            .providerId = request.providerId,
            .artifactId = request.artifactId,
            .modId = request.modId,
            .versionId = request.versionId,
            .jobId = request.jobId,
            .grantId = grant.grantId,
            .expectedSize = grant.expectedSize,
            .expectedSha256 = grant.expectedSha256,
            .grantExpiresAtUnixMs = grant.expiresAtUnixMs,
            .phase = RemoteArtifactResumePhase::AwaitingRepresentation};

        if (grant.rangeSupported && previous != nullptr &&
            previous->providerId == state.providerId &&
            previous->artifactId == state.artifactId &&
            previous->expectedSize == state.expectedSize &&
            previous->expectedSha256 == state.expectedSha256)
        {
            state.bytesReceived = previous->bytesReceived;
            state.validator = previous->validator;
        }

        return {
            .state = std::move(state),
            .grant = std::move(resolution.grant),
            .error = RemoteDownloadResolutionError::None,
            .operationId = resolution.operationId};
    }

    void RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
        RemoteArtifactResumeState& state,
        RemoteDownloadResumeDecision decision,
        std::optional<RepresentationValidator> observedValidator)
    {
        validateRemoteArtifactResumeState(state, RemoteArtifactResumeValidation::Runtime);
        const bool awaitingRepresentation =
            state.phase == RemoteArtifactResumePhase::AwaitingRepresentation;
        if (!awaitingRepresentation && decision == RemoteDownloadResumeDecision::Append)
        {
            throw std::logic_error("A fresh representation decision is only valid after resolution.");
        }

        if (decision == RemoteDownloadResumeDecision::ReResolve)
        {
            state.bytesReceived = 0;
            state.validator.reset();
            state.phase = RemoteArtifactResumePhase::AwaitingRepresentation;
            return;
        }

        if (decision == RemoteDownloadResumeDecision::Restart &&
            state.phase == RemoteArtifactResumePhase::RetryScheduled)
        {
            throw std::logic_error("A retry-scheduled download cannot restart without resolution.");
        }

        if (!observedValidator.has_value() ||
            !isValidRepresentationValidator(*observedValidator))
        {
            throw std::invalid_argument("Verified representation decision has no representation-scoped validator.");
        }

        if (decision == RemoteDownloadResumeDecision::Append)
        {
            if (state.bytesReceived == 0 || state.validator != observedValidator)
            {
                throw std::invalid_argument("Append decision does not match the durable representation.");
            }
            state.phase = RemoteArtifactResumePhase::ReadyToAppend;
            return;
        }

        state.bytesReceived = 0;
        state.validator = std::move(observedValidator);
        state.phase = RemoteArtifactResumePhase::ReadyToStart;
    }

    void RemoteDownloadCoordinator::checkpoint(
        RemoteArtifactResumeState& state,
        std::uint64_t bytesReceived)
    {
        validateRemoteArtifactResumeState(state, RemoteArtifactResumeValidation::Runtime);
        if ((state.phase != RemoteArtifactResumePhase::ReadyToStart &&
                state.phase != RemoteArtifactResumePhase::ReadyToAppend &&
                state.phase != RemoteArtifactResumePhase::Checkpointed) ||
            bytesReceived > state.expectedSize)
        {
            throw std::logic_error("Remote download checkpoint is not valid in the current state.");
        }

        state.bytesReceived = bytesReceived;
        state.phase = RemoteArtifactResumePhase::Checkpointed;
    }

    void RemoteDownloadCoordinator::scheduleRetry(
        RemoteArtifactResumeState& state,
        std::uint64_t retryAtUnixMs)
    {
        validateRemoteArtifactResumeState(state, RemoteArtifactResumeValidation::Runtime);
        if (retryAtUnixMs == 0)
        {
            throw std::invalid_argument("Remote download retry time must be an absolute non-zero timestamp.");
        }
        state.retryAtUnixMs = retryAtUnixMs;
        state.phase = RemoteArtifactResumePhase::RetryScheduled;
    }
}
