#include "FluxoraCore/Services/RemoteDownloadTransferService.hpp"

#include "FluxoraCore/Services/Logger.hpp"

#include <algorithm>
#include <chrono>
#include <exception>
#include <limits>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace fluxora
{
    namespace
    {
        class ScopedGrantSecretClear final
        {
        public:
            explicit ScopedGrantSecretClear(ResolvedDownloadGrant& grant) noexcept
                : grant_(&grant)
            {
            }

            ~ScopedGrantSecretClear()
            {
                clearResolvedDownloadGrantSecrets(*grant_);
            }

            ScopedGrantSecretClear(const ScopedGrantSecretClear&) = delete;
            ScopedGrantSecretClear& operator=(const ScopedGrantSecretClear&) = delete;

        private:
            ResolvedDownloadGrant* grant_;
        };

        bool matchesStableRequest(
            const RemoteArtifactResumeState& state,
            const RemoteArtifactDownloadRequest& request) noexcept
        {
            return state.providerId == request.providerId &&
                state.artifactId == request.artifactId &&
                state.modId == request.modId &&
                state.versionId == request.versionId &&
                state.jobId == request.jobId;
        }

        bool isRetryableNetworkOutcome(SignedRemoteTransportOutcome outcome) noexcept
        {
            return outcome == SignedRemoteTransportOutcome::Timeout ||
                outcome == SignedRemoteTransportOutcome::DnsFailure ||
                outcome == SignedRemoteTransportOutcome::NetworkFailure;
        }

        std::string_view outcomeText(RemoteDownloadTransferOutcome outcome) noexcept
        {
            switch (outcome)
            {
            case RemoteDownloadTransferOutcome::Completed: return "completed";
            case RemoteDownloadTransferOutcome::Cancelled: return "cancelled";
            case RemoteDownloadTransferOutcome::RetryScheduled: return "retry-scheduled";
            case RemoteDownloadTransferOutcome::InvalidRequest: return "invalid-request";
            case RemoteDownloadTransferOutcome::UnsafePath: return "unsafe-path";
            case RemoteDownloadTransferOutcome::DestinationExists: return "destination-exists";
            case RemoteDownloadTransferOutcome::ProviderFailure: return "provider-failure";
            case RemoteDownloadTransferOutcome::TransportFailure: return "transport-failure";
            case RemoteDownloadTransferOutcome::ProtocolFailure: return "protocol-failure";
            case RemoteDownloadTransferOutcome::IntegrityFailure: return "integrity-failure";
            case RemoteDownloadTransferOutcome::FileFailure: return "file-failure";
            }
            return "unknown";
        }

        std::uint64_t retryTimestamp(
            std::uint64_t now,
            const SignedRemoteDownloadResponse& response,
            std::uint64_t maximumSeconds) noexcept
        {
            std::uint64_t seconds = response.retryAfterSeconds.value_or(1U);
            seconds = (std::max)(std::uint64_t{1U}, (std::min)(seconds, maximumSeconds));
            const std::uint64_t milliseconds = seconds >
                (std::numeric_limits<std::uint64_t>::max)() / 1000U
                ? (std::numeric_limits<std::uint64_t>::max)()
                : seconds * 1000U;
            return now > (std::numeric_limits<std::uint64_t>::max)() - milliseconds
                ? (std::numeric_limits<std::uint64_t>::max)()
                : now + milliseconds;
        }
    }

    RemoteDownloadTransferService::RemoteDownloadTransferService(
        RemoteDownloadCoordinator& coordinator,
        RemoteDownloadSidecarStore& sidecars,
        IRemoteDownloadFileStore& files,
        SignedRemoteTransportExecutor transport,
        RemoteDownloadClock clock,
        Logger* logger)
        : coordinator_(coordinator),
          sidecars_(sidecars),
          files_(files),
          transport_(std::move(transport)),
          clock_(std::move(clock)),
          logger_(logger)
    {
        if (!transport_)
        {
            throw std::invalid_argument("Remote download transport executor is required.");
        }
        if (!clock_)
        {
            clock_ = []
            {
                return static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch()).count());
            };
        }
    }

    RemoteDownloadTransferResult RemoteDownloadTransferService::transfer(
        const RemoteDownloadTransferRequest& request,
        const IRemoteDownloadCancellation& cancellation)
    {
        const auto finish = [&](
            RemoteDownloadTransferOutcome outcome,
            std::string message,
            std::uint64_t bytesReceived = 0U,
            bool retained = false,
            std::optional<std::uint64_t> retryAt = std::nullopt,
            std::optional<std::filesystem::path> finalPath = std::nullopt)
        {
            if (logger_ != nullptr)
            {
                const LogLevel level = outcome == RemoteDownloadTransferOutcome::Completed
                    ? LogLevel::Info
                    : (outcome == RemoteDownloadTransferOutcome::Cancelled ||
                        outcome == RemoteDownloadTransferOutcome::RetryScheduled ||
                        outcome == RemoteDownloadTransferOutcome::DestinationExists)
                        ? LogLevel::Warning
                        : LogLevel::Error;
                logger_->writeOperation(
                    level,
                    "remote-download-transfer",
                    std::string("outcome=") + std::string(outcomeText(outcome)));
            }
            return RemoteDownloadTransferResult{
                .outcome = outcome,
                .finalPath = std::move(finalPath),
                .bytesReceived = bytesReceived,
                .retryAtUnixMs = retryAt,
                .resumableStateRetained = retained,
                .message = std::move(message),
                .operationId = request.artifact.operationId};
        };

        const auto reportProgress = [&](std::uint64_t bytesReceived, std::uint64_t expectedSize) noexcept
        {
            if (!request.progress)
            {
                return;
            }
            try
            {
                request.progress(bytesReceived, expectedSize);
            }
            catch (...)
            {
                if (logger_ != nullptr)
                {
                    logger_->writeOperation(
                        LogLevel::Warning,
                        "remote-download-transfer",
                        "progress-observer-failed");
                }
            }
        };

        if (request.maximumResolveAttempts == 0U ||
            request.maximumResolveAttempts > 16U ||
            request.checkpointIntervalBytes == 0U ||
            request.maximumRetryAfterSeconds == 0U ||
            request.maximumRetryAfterSeconds > 24U * 60U * 60U)
        {
            return finish(
                RemoteDownloadTransferOutcome::InvalidRequest,
                "Remote download transfer bounds are invalid.");
        }
        if (request.expectedSize.has_value() != !request.expectedSha256.empty() ||
            (request.expectedSize.has_value() &&
                (*request.expectedSize == 0U ||
                    !isCanonicalRemoteDownloadSha256(request.expectedSha256))))
        {
            return finish(
                RemoteDownloadTransferOutcome::InvalidRequest,
                "Remote download expected artifact identity is invalid.");
        }
        try
        {
            validateRemoteArtifactDownloadRequest(request.artifact);
        }
        catch (...)
        {
            return finish(
                RemoteDownloadTransferOutcome::InvalidRequest,
                "Remote download request is invalid.");
        }

        const RemoteDownloadPathValidation initialPaths = files_.validatePaths(
            request.allowedRoot,
            request.partialPath,
            request.destinationPath,
            0U);
        if (!initialPaths.safe)
        {
            return finish(
                RemoteDownloadTransferOutcome::UnsafePath,
                initialPaths.message.empty()
                    ? "Remote download paths are unsafe."
                    : initialPaths.message);
        }
        const std::filesystem::path partialPath = initialPaths.partialPath;
        const std::filesystem::path destinationPath = initialPaths.destinationPath;

        const auto removeResumeArtifacts = [&]() noexcept
        {
            files_.remove(partialPath);
            try
            {
                sidecars_.remove(partialPath);
            }
            catch (...)
            {
                return false;
            }
            return true;
        };

        try
        {
            if (files_.exists(destinationPath))
            {
                const bool partialStillExists = files_.exists(partialPath);
                if (!partialStillExists)
                {
                    try
                    {
                        sidecars_.remove(partialPath);
                    }
                    catch (...)
                    {
                    }
                }
                return finish(
                    RemoteDownloadTransferOutcome::DestinationExists,
                    "Remote download destination already exists.",
                    0U,
                    partialStillExists);
            }
        }
        catch (...)
        {
            return finish(
                RemoteDownloadTransferOutcome::FileFailure,
                "Remote download destination could not be inspected.");
        }

        std::optional<RemoteArtifactResumeState> previous;
        try
        {
            previous = sidecars_.load(partialPath).state;
        }
        catch (...)
        {
            removeResumeArtifacts();
            return finish(
                RemoteDownloadTransferOutcome::IntegrityFailure,
                "Remote download resume state is invalid and was removed.");
        }

        try
        {
            const std::optional<std::uint64_t> partialSize = files_.size(partialPath);
            if (!previous.has_value())
            {
                if (partialSize.has_value())
                {
                    files_.remove(partialPath);
                }
            }
            else if (!matchesStableRequest(*previous, request.artifact))
            {
                removeResumeArtifacts();
                previous.reset();
            }
            else if (previous->phase == RemoteArtifactResumePhase::RetryScheduled &&
                previous->retryAtUnixMs.has_value() &&
                *previous->retryAtUnixMs > clock_())
            {
                if (!partialSize.has_value())
                {
                    files_.truncate(partialPath, 0U);
                }
                return finish(
                    RemoteDownloadTransferOutcome::RetryScheduled,
                    "Remote download retry is not due yet.",
                    previous->bytesReceived,
                    true,
                    previous->retryAtUnixMs);
            }
            else if (!partialSize.has_value())
            {
                sidecars_.remove(partialPath);
                previous.reset();
            }
            else if (*partialSize < previous->bytesReceived)
            {
                removeResumeArtifacts();
                return finish(
                    RemoteDownloadTransferOutcome::IntegrityFailure,
                    "Remote download partial file is shorter than its durable checkpoint.");
            }
            else if (*partialSize > previous->bytesReceived)
            {
                // A process can stop after durable file flush and before its next
                // bounded sidecar checkpoint. Roll back only that uncommitted tail.
                files_.truncate(partialPath, previous->bytesReceived);
            }
        }
        catch (...)
        {
            removeResumeArtifacts();
            return finish(
                RemoteDownloadTransferOutcome::FileFailure,
                "Remote download resume files could not be reconciled.");
        }

        if (cancellation.isCancellationRequested())
        {
            return finish(
                RemoteDownloadTransferOutcome::Cancelled,
                "Remote download was cancelled.",
                previous.has_value() ? previous->bytesReceived : 0U,
                previous.has_value());
        }

        bool exhaustedAfterRefresh = false;
        bool interruptedAfterSafeCheckpoint = false;
        std::string fallbackFailureMessage;
        std::optional<RemoteDownloadPreparation> pendingFallback;
        for (std::size_t resolveAttempt = 0;
             resolveAttempt < request.maximumResolveAttempts;
             ++resolveAttempt)
        {
            RemoteDownloadPreparation preparation;
            if (pendingFallback.has_value())
            {
                preparation = std::move(*pendingFallback);
                if (pendingFallback->grant.has_value())
                {
                    clearResolvedDownloadGrantSecrets(*pendingFallback->grant);
                }
                pendingFallback.reset();
            }
            else
            {
                preparation = previous.has_value()
                    ? coordinator_.resolveResume(*previous, request.artifact.operationId)
                    : coordinator_.resolveNew(request.artifact);
            }
            if (!preparation.grant.has_value() || !preparation.state.has_value())
            {
                return finish(
                    RemoteDownloadTransferOutcome::ProviderFailure,
                    "Remote download grant could not be resolved.",
                    previous.has_value() ? previous->bytesReceived : 0U,
                    previous.has_value());
            }

            ResolvedDownloadGrant& grant = *preparation.grant;
            ScopedGrantSecretClear clearGrant(grant);
            RemoteArtifactResumeState state = std::move(*preparation.state);
            if (request.expectedSize.has_value() &&
                (state.expectedSize != *request.expectedSize ||
                    state.expectedSha256 != request.expectedSha256))
            {
                removeResumeArtifacts();
                return finish(
                    RemoteDownloadTransferOutcome::IntegrityFailure,
                    "Remote download metadata and resolved artifact identity differ.");
            }
            reportProgress(state.bytesReceived, state.expectedSize);
            const auto queueOnDemandFallback = [&]()
            {
                if (resolveAttempt + 1U >= request.maximumResolveAttempts ||
                    cancellation.isCancellationRequested())
                {
                    return false;
                }
                RemoteDownloadPreparation fallback = coordinator_.resolveFallback(
                    state,
                    grant.representationProviderId,
                    request.artifact.operationId);
                if (!fallback.grant.has_value() || !fallback.state.has_value())
                {
                    fallbackFailureMessage = fallback.message;
                    return false;
                }
                removeResumeArtifacts();
                previous.reset();
                pendingFallback = std::move(fallback);
                if (fallback.grant.has_value())
                {
                    clearResolvedDownloadGrantSecrets(*fallback.grant);
                }
                return true;
            };

            const RemoteDownloadPathValidation currentPaths = files_.validatePaths(
                request.allowedRoot,
                partialPath,
                destinationPath,
                grant.expectedSize);
            if (!currentPaths.safe ||
                currentPaths.partialPath != partialPath ||
                currentPaths.destinationPath != destinationPath)
            {
                return finish(
                    RemoteDownloadTransferOutcome::UnsafePath,
                    "Remote download paths changed after grant resolution.");
            }
            if (grant.expiresAtUnixMs <= clock_())
            {
                exhaustedAfterRefresh = true;
                continue;
            }

            try
            {
                if (previous.has_value() && state.bytesReceived == 0U &&
                    previous->bytesReceived != 0U)
                {
                    files_.truncate(partialPath, 0U);
                    sidecars_.remove(partialPath);
                    previous.reset();
                }
            }
            catch (...)
            {
                removeResumeArtifacts();
                return finish(
                    RemoteDownloadTransferOutcome::FileFailure,
                    "Remote download partial file could not be reset.");
            }

            SignedRemoteDownloadResponse head;
            try
            {
                head = transport_(
                    grant,
                    SignedRemoteDownloadRequest{
                        .method = SignedRemoteHttpMethod::Head,
                        .target = {.kind = SignedRemoteTargetKind::Head},
                        .policy = request.transportPolicy,
                        .operationId = request.artifact.operationId},
                    cancellation,
                    {});
            }
            catch (...)
            {
                return finish(
                    RemoteDownloadTransferOutcome::TransportFailure,
                    "Remote download representation probe failed.",
                    previous.has_value() ? previous->bytesReceived : 0U,
                    previous.has_value());
            }

            if (cancellation.isCancellationRequested() ||
                head.outcome == SignedRemoteTransportOutcome::Cancelled)
            {
                return finish(
                    RemoteDownloadTransferOutcome::Cancelled,
                    "Remote download was cancelled.",
                    previous.has_value() ? previous->bytesReceived : 0U,
                    previous.has_value());
            }

            if (isRetryableNetworkOutcome(head.outcome))
            {
                if (queueOnDemandFallback())
                {
                    continue;
                }
                interruptedAfterSafeCheckpoint = previous.has_value();
                continue;
            }

            const RemoteRepresentationDecision headDecision =
                decideRemoteHeadRepresentation(state, head);
            if (headDecision.action == RemoteRepresentationAction::RetryLater)
            {
                try
                {
                    if (!files_.exists(partialPath))
                    {
                        files_.truncate(partialPath, 0U);
                    }
                    const std::uint64_t retryAt = retryTimestamp(
                        clock_(), head, request.maximumRetryAfterSeconds);
                    RemoteDownloadCoordinator::scheduleRetry(state, retryAt);
                    sidecars_.save(partialPath, state);
                    return finish(
                        RemoteDownloadTransferOutcome::RetryScheduled,
                        "Remote download provider requested a bounded retry.",
                        state.bytesReceived,
                        true,
                        retryAt);
                }
                catch (...)
                {
                    removeResumeArtifacts();
                    return finish(
                        RemoteDownloadTransferOutcome::FileFailure,
                        "Remote download retry checkpoint could not be persisted.");
                }
            }
            if (headDecision.action == RemoteRepresentationAction::RestartAndResolve)
            {
                RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
                    state, RemoteDownloadResumeDecision::ReResolve);
                removeResumeArtifacts();
                previous.reset();
                exhaustedAfterRefresh = true;
                continue;
            }
            if (headDecision.action == RemoteRepresentationAction::Reject ||
                !head.validator.has_value() ||
                head.validator->kind != RepresentationValidatorKind::StrongEtag)
            {
                removeResumeArtifacts();
                return finish(
                    RemoteDownloadTransferOutcome::ProtocolFailure,
                    "Remote download representation probe was not resumable.");
            }

            try
            {
                if (headDecision.action == RemoteRepresentationAction::Append)
                {
                    RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
                        state,
                        RemoteDownloadResumeDecision::Append,
                        head.validator);
                }
                else
                {
                    RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
                        state,
                        RemoteDownloadResumeDecision::Restart,
                        head.validator);
                    files_.truncate(partialPath, 0U);
                }
            }
            catch (...)
            {
                removeResumeArtifacts();
                return finish(
                    RemoteDownloadTransferOutcome::ProtocolFailure,
                    "Remote download representation decision was inconsistent.");
            }

            bool completedBody = state.bytesReceived == state.expectedSize;
            bool resolveAgain = false;
            bool transportFailed = false;

            for (std::size_t requestRound = 0;
                 !completedBody && !resolveAgain && requestRound < 2U;
                 ++requestRound)
            {
                const std::uint64_t requestStart = state.bytesReceived;
                const bool ranged = requestStart != 0U;
                const RemoteArtifactResumeState representationState = state;

                std::vector<SignedRemoteTarget> targets;
                targets.push_back({.kind = SignedRemoteTargetKind::Primary});
                for (std::size_t fallbackIndex = 0;
                     fallbackIndex < grant.fallbackUrls.size();
                     ++fallbackIndex)
                {
                    targets.push_back({
                        .kind = SignedRemoteTargetKind::Fallback,
                        .fallbackIndex = fallbackIndex});
                }

                bool restartFullRequest = false;
                bool eligibleFallbackExhaustion = true;
                for (const SignedRemoteTarget target : targets)
                {
                    std::unique_ptr<IRemoteDownloadFileWriter> writer;
                    try
                    {
                        writer = files_.openWriter(partialPath, requestStart);
                    }
                    catch (...)
                    {
                        removeResumeArtifacts();
                        return finish(
                            RemoteDownloadTransferOutcome::FileFailure,
                            "Remote download partial file could not be opened.");
                    }

                    std::uint64_t durableBytes = state.bytesReceived;
                    bool sinkCancelled = false;
                    bool sinkProtocolFailure = false;
                    std::exception_ptr sinkFileFailure;
                    const SignedRemoteChunkSink sink = [&](std::span<const std::byte> bytes)
                    {
                        std::size_t consumed = 0U;
                        while (consumed < bytes.size())
                        {
                            if (cancellation.isCancellationRequested())
                            {
                                sinkCancelled = true;
                                return false;
                            }
                            const std::uint64_t position = writer->position();
                            if (position > state.expectedSize)
                            {
                                sinkProtocolFailure = true;
                                return false;
                            }
                            const std::uint64_t untilCheckpoint =
                                request.checkpointIntervalBytes -
                                ((position - durableBytes) % request.checkpointIntervalBytes);
                            const std::uint64_t capacity = state.expectedSize - position;
                            const std::size_t pieceSize = static_cast<std::size_t>((std::min)({
                                static_cast<std::uint64_t>(bytes.size() - consumed),
                                untilCheckpoint,
                                capacity}));
                            if (pieceSize == 0U)
                            {
                                sinkProtocolFailure = true;
                                return false;
                            }
                            try
                            {
                                writer->append(bytes.subspan(consumed, pieceSize));
                                consumed += pieceSize;
                                reportProgress(writer->position(), state.expectedSize);
                                if (writer->position() - durableBytes >=
                                        request.checkpointIntervalBytes ||
                                    writer->position() == state.expectedSize)
                                {
                                    writer->flush();
                                    RemoteDownloadCoordinator::checkpoint(
                                        state, writer->position());
                                    sidecars_.save(partialPath, state);
                                    durableBytes = writer->position();
                                }
                            }
                            catch (...)
                            {
                                sinkFileFailure = std::current_exception();
                                return false;
                            }
                        }
                        return true;
                    };

                    SignedRemoteDownloadResponse response;
                    try
                    {
                        response = transport_(
                            grant,
                            SignedRemoteDownloadRequest{
                                .method = SignedRemoteHttpMethod::Get,
                                .target = target,
                                .rangeStart = ranged
                                    ? std::optional<std::uint64_t>(requestStart)
                                    : std::nullopt,
                                .ifMatch = ranged ? representationState.validator : std::nullopt,
                                .policy = request.transportPolicy,
                                .operationId = request.artifact.operationId},
                            cancellation,
                            sink);
                    }
                    catch (...)
                    {
                        writer.reset();
                        transportFailed = true;
                        eligibleFallbackExhaustion = false;
                        break;
                    }

                    const std::uint64_t acceptedBytes = writer->position() - requestStart;
                    if (sinkFileFailure)
                    {
                        writer.reset();
                        removeResumeArtifacts();
                        return finish(
                            RemoteDownloadTransferOutcome::FileFailure,
                            "Remote download partial file could not be checkpointed.");
                    }
                    if (sinkProtocolFailure)
                    {
                        writer.reset();
                        removeResumeArtifacts();
                        return finish(
                            RemoteDownloadTransferOutcome::ProtocolFailure,
                            "Remote download exceeded its verified representation size.");
                    }

                    if (sinkCancelled || cancellation.isCancellationRequested() ||
                        response.outcome == SignedRemoteTransportOutcome::Cancelled)
                    {
                        try
                        {
                            writer->flush();
                            RemoteDownloadCoordinator::checkpoint(state, writer->position());
                            sidecars_.save(partialPath, state);
                            const std::uint64_t retainedBytes = writer->position();
                            writer.reset();
                            return finish(
                                RemoteDownloadTransferOutcome::Cancelled,
                                "Remote download was cancelled.",
                                retainedBytes,
                                true);
                        }
                        catch (...)
                        {
                            writer.reset();
                            removeResumeArtifacts();
                            return finish(
                                RemoteDownloadTransferOutcome::FileFailure,
                                "Remote download cancellation checkpoint could not be persisted.");
                        }
                    }

                    if (isRetryableNetworkOutcome(response.outcome))
                    {
                        if (acceptedBytes == 0U)
                        {
                            writer.reset();
                            continue;
                        }
                        try
                        {
                            writer->flush();
                            RemoteDownloadCoordinator::checkpoint(state, writer->position());
                            sidecars_.save(partialPath, state);
                            writer.reset();
                            previous = state;
                            interruptedAfterSafeCheckpoint = true;
                            resolveAgain = true;
                            eligibleFallbackExhaustion = false;
                            break;
                        }
                        catch (...)
                        {
                            writer.reset();
                            removeResumeArtifacts();
                            return finish(
                                RemoteDownloadTransferOutcome::FileFailure,
                                "Interrupted remote download could not be checkpointed.");
                        }
                    }

                    eligibleFallbackExhaustion = false;

                    if (ranged)
                    {
                        const RemoteRepresentationDecision decision =
                            decideRemoteRepresentation(representationState, response);
                        if (decision.action == RemoteRepresentationAction::RetryLater &&
                            acceptedBytes == 0U)
                        {
                            try
                            {
                                writer.reset();
                                const std::uint64_t retryAt = retryTimestamp(
                                    clock_(), response, request.maximumRetryAfterSeconds);
                                RemoteDownloadCoordinator::scheduleRetry(state, retryAt);
                                sidecars_.save(partialPath, state);
                                return finish(
                                    RemoteDownloadTransferOutcome::RetryScheduled,
                                    "Remote download provider requested a bounded retry.",
                                    state.bytesReceived,
                                    true,
                                    retryAt);
                            }
                            catch (...)
                            {
                                writer.reset();
                                removeResumeArtifacts();
                                return finish(
                                    RemoteDownloadTransferOutcome::FileFailure,
                                    "Remote download retry checkpoint could not be persisted.");
                            }
                        }
                        if (decision.action == RemoteRepresentationAction::RestartFromBeginning &&
                            acceptedBytes == 0U && response.validator.has_value() &&
                            response.validator->kind == RepresentationValidatorKind::StrongEtag)
                        {
                            writer.reset();
                            try
                            {
                                RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
                                    state,
                                    RemoteDownloadResumeDecision::Restart,
                                    response.validator);
                                files_.truncate(partialPath, 0U);
                                restartFullRequest = true;
                                break;
                            }
                            catch (...)
                            {
                                removeResumeArtifacts();
                                return finish(
                                    RemoteDownloadTransferOutcome::ProtocolFailure,
                                    "Range-ignore restart was inconsistent.");
                            }
                        }
                        if (decision.action == RemoteRepresentationAction::Append)
                        {
                            const std::uint64_t representedBytes = response.contentRange->end -
                                response.contentRange->start + 1U;
                            if (acceptedBytes != representedBytes ||
                                response.bytesStreamed != representedBytes)
                            {
                                writer.reset();
                                removeResumeArtifacts();
                                return finish(
                                    RemoteDownloadTransferOutcome::ProtocolFailure,
                                    "Remote range response was truncated.");
                            }
                            try
                            {
                                writer->flush();
                                RemoteDownloadCoordinator::checkpoint(state, writer->position());
                                sidecars_.save(partialPath, state);
                                writer.reset();
                            }
                            catch (...)
                            {
                                writer.reset();
                                removeResumeArtifacts();
                                return finish(
                                    RemoteDownloadTransferOutcome::FileFailure,
                                    "Remote range checkpoint could not be persisted.");
                            }
                            if (state.bytesReceived == state.expectedSize)
                            {
                                completedBody = true;
                            }
                            else
                            {
                                previous = state;
                                resolveAgain = true;
                            }
                            break;
                        }

                        writer.reset();
                        RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
                            state, RemoteDownloadResumeDecision::ReResolve);
                        removeResumeArtifacts();
                        previous.reset();
                        exhaustedAfterRefresh = true;
                        resolveAgain = true;
                        break;
                    }

                    const bool fullIdentityMatches =
                        target.kind == SignedRemoteTargetKind::Primary &&
                        response.outcome == SignedRemoteTransportOutcome::Success &&
                        response.method == SignedRemoteHttpMethod::Get &&
                        response.target.kind == SignedRemoteTargetKind::Primary &&
                        response.providerId == state.providerId &&
                        state.validator.has_value() && response.validator == state.validator &&
                        response.representationProviderId == state.validator->providerId &&
                        response.statusCode == 200U &&
                        response.contentLength == state.expectedSize &&
                        response.bytesStreamed == state.expectedSize &&
                        acceptedBytes == state.expectedSize;
                    if (fullIdentityMatches)
                    {
                        try
                        {
                            writer->flush();
                            RemoteDownloadCoordinator::checkpoint(state, writer->position());
                            sidecars_.save(partialPath, state);
                            writer.reset();
                            completedBody = true;
                            break;
                        }
                        catch (...)
                        {
                            writer.reset();
                            removeResumeArtifacts();
                            return finish(
                                RemoteDownloadTransferOutcome::FileFailure,
                                "Remote download completion checkpoint could not be persisted.");
                        }
                    }

                    const RemoteRepresentationDecision decision =
                        decideRemoteRepresentation(representationState, response);
                    if (decision.action == RemoteRepresentationAction::RetryLater &&
                        acceptedBytes == 0U)
                    {
                        writer.reset();
                        const std::uint64_t retryAt = retryTimestamp(
                            clock_(), response, request.maximumRetryAfterSeconds);
                        try
                        {
                            RemoteDownloadCoordinator::scheduleRetry(state, retryAt);
                            sidecars_.save(partialPath, state);
                            return finish(
                                RemoteDownloadTransferOutcome::RetryScheduled,
                                "Remote download provider requested a bounded retry.",
                                state.bytesReceived,
                                true,
                                retryAt);
                        }
                        catch (...)
                        {
                            removeResumeArtifacts();
                            return finish(
                                RemoteDownloadTransferOutcome::FileFailure,
                                "Remote download retry checkpoint could not be persisted.");
                        }
                    }

                    writer.reset();
                    RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
                        state, RemoteDownloadResumeDecision::ReResolve);
                    removeResumeArtifacts();
                    previous.reset();
                    exhaustedAfterRefresh = true;
                    resolveAgain = true;
                    break;
                }

                if (transportFailed || resolveAgain || completedBody)
                {
                    break;
                }
                if (restartFullRequest)
                {
                    continue;
                }
                if (eligibleFallbackExhaustion && queueOnDemandFallback())
                {
                    resolveAgain = true;
                    break;
                }
                transportFailed = true;
                break;
            }

            if (resolveAgain)
            {
                continue;
            }
            if (transportFailed || !completedBody)
            {
                if (!previous.has_value())
                {
                    removeResumeArtifacts();
                }
                return finish(
                    RemoteDownloadTransferOutcome::TransportFailure,
                    fallbackFailureMessage.empty()
                        ? "Remote download transport attempts were exhausted."
                        : fallbackFailureMessage,
                    previous.has_value() ? previous->bytesReceived : 0U,
                    previous.has_value());
            }

            try
            {
                const std::optional<std::uint64_t> actualSize = files_.size(partialPath);
                if (!actualSize.has_value() || *actualSize != state.expectedSize)
                {
                    removeResumeArtifacts();
                    return finish(
                        RemoteDownloadTransferOutcome::IntegrityFailure,
                        "Remote download size verification failed.");
                }
                if (state.phase != RemoteArtifactResumePhase::Checkpointed ||
                    state.bytesReceived != state.expectedSize)
                {
                    RemoteDownloadCoordinator::checkpoint(state, state.expectedSize);
                    sidecars_.save(partialPath, state);
                }

                const std::optional<std::string> actualHash =
                    files_.sha256(partialPath, cancellation);
                if (!actualHash.has_value())
                {
                    return finish(
                        RemoteDownloadTransferOutcome::Cancelled,
                        "Remote download verification was cancelled.",
                        state.bytesReceived,
                        true);
                }
                if (*actualHash != state.expectedSha256)
                {
                    removeResumeArtifacts();
                    return finish(
                        RemoteDownloadTransferOutcome::IntegrityFailure,
                        "Remote download SHA-256 verification failed.");
                }

                const RemoteDownloadPromotionOutcome promotion =
                    files_.promoteNoReplace(partialPath, destinationPath);
                if (promotion == RemoteDownloadPromotionOutcome::DestinationExists)
                {
                    return finish(
                        RemoteDownloadTransferOutcome::DestinationExists,
                        "Remote download destination appeared before promotion.",
                        state.bytesReceived,
                        true);
                }
                if (promotion != RemoteDownloadPromotionOutcome::Promoted)
                {
                    return finish(
                        RemoteDownloadTransferOutcome::FileFailure,
                        "Verified remote download could not be promoted.",
                        state.bytesReceived,
                        true);
                }

                try
                {
                    sidecars_.remove(partialPath);
                }
                catch (...)
                {
                    // The artifact is already atomically visible and verified. A
                    // stale secret-free sidecar is harmless and recovered later.
                }
                return finish(
                    RemoteDownloadTransferOutcome::Completed,
                    "Remote download completed and was verified.",
                    state.expectedSize,
                    false,
                    std::nullopt,
                    destinationPath);
            }
            catch (...)
            {
                removeResumeArtifacts();
                return finish(
                    RemoteDownloadTransferOutcome::FileFailure,
                    "Remote download verification or promotion failed.");
            }
        }

        if (interruptedAfterSafeCheckpoint && previous.has_value())
        {
            return finish(
                RemoteDownloadTransferOutcome::TransportFailure,
                "Remote download transport attempts were exhausted after a safe checkpoint.",
                previous->bytesReceived,
                true);
        }
        if (previous.has_value())
        {
            return finish(
                RemoteDownloadTransferOutcome::ProviderFailure,
                "Remote download could not obtain a fresh usable grant.",
                previous->bytesReceived,
                true);
        }
        removeResumeArtifacts();
        return finish(
            exhaustedAfterRefresh
                ? RemoteDownloadTransferOutcome::ProtocolFailure
                : RemoteDownloadTransferOutcome::ProviderFailure,
            exhaustedAfterRefresh
                ? "Remote download representation refresh attempts were exhausted."
                : "Remote download provider attempts were exhausted.");
    }
}
