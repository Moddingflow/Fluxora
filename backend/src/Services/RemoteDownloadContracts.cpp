#include "FluxoraCore/Services/RemoteDownloadContracts.hpp"

#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumProviderIdLength = 64U;
        constexpr std::size_t maximumStableIdLength = 256U;
        constexpr std::size_t maximumOperationIdLength = 256U;
        constexpr std::size_t maximumUrlLength = 16U * 1024U;
        constexpr std::size_t maximumFallbackUrls = 8U;
        constexpr std::size_t maximumTransportHeaders = 32U;

        bool isPrintableAscii(std::string_view value) noexcept
        {
            return std::all_of(value.begin(), value.end(), [](const unsigned char character)
            {
                return character >= 0x20U && character < 0x7fU;
            });
        }

        bool isDurablePhase(RemoteArtifactResumePhase phase) noexcept
        {
            return phase == RemoteArtifactResumePhase::AwaitingRepresentation ||
                phase == RemoteArtifactResumePhase::Checkpointed ||
                phase == RemoteArtifactResumePhase::RetryScheduled;
        }

        bool isKnownPhase(RemoteArtifactResumePhase phase) noexcept
        {
            return phase == RemoteArtifactResumePhase::AwaitingRepresentation ||
                phase == RemoteArtifactResumePhase::ReadyToStart ||
                phase == RemoteArtifactResumePhase::ReadyToAppend ||
                phase == RemoteArtifactResumePhase::Checkpointed ||
                phase == RemoteArtifactResumePhase::RetryScheduled;
        }

        void secureErase(std::string& value) noexcept
        {
            volatile char* cursor = value.empty() ? nullptr : value.data();
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                cursor[index] = '\0';
            }
            value.clear();
        }

        bool isValidOperationId(std::wstring_view operationId) noexcept
        {
            return !operationId.empty() &&
                operationId.size() <= maximumOperationIdLength &&
                std::none_of(
                    operationId.begin(),
                    operationId.end(),
                    [](wchar_t character) { return character < 0x20; });
        }
    }

    bool isCanonicalRemoteDownloadProviderId(std::string_view value) noexcept
    {
        if (value.empty() || value.size() > maximumProviderIdLength)
        {
            return false;
        }

        const auto isAlphaNumeric = [](const unsigned char character)
        {
            return (character >= 'a' && character <= 'z') ||
                (character >= '0' && character <= '9');
        };
        return isAlphaNumeric(static_cast<unsigned char>(value.front())) &&
            isAlphaNumeric(static_cast<unsigned char>(value.back())) &&
            std::all_of(value.begin(), value.end(), [](const unsigned char character)
        {
            return (character >= 'a' && character <= 'z') ||
                (character >= '0' && character <= '9') ||
                character == '.' || character == '_' || character == '-';
        });
    }

    bool isValidRemoteDownloadStableId(std::string_view value, bool required) noexcept
    {
        if (value.empty())
        {
            return !required;
        }
        if (value.size() > maximumStableIdLength || !isPrintableAscii(value) ||
            std::isspace(static_cast<unsigned char>(value.front())) != 0 ||
            std::isspace(static_cast<unsigned char>(value.back())) != 0)
        {
            return false;
        }
        return true;
    }

    bool isCanonicalRemoteDownloadSha256(std::string_view value) noexcept
    {
        return value.size() == 64U &&
            std::all_of(value.begin(), value.end(), [](const unsigned char character)
            {
                return (character >= '0' && character <= '9') ||
                    (character >= 'a' && character <= 'f');
            });
    }

    bool isValidRepresentationValidator(const RepresentationValidator& validator) noexcept
    {
        if (!isCanonicalRemoteDownloadProviderId(validator.providerId) ||
            validator.value.empty() || validator.value.size() > 512U ||
            !isPrintableAscii(validator.value))
        {
            return false;
        }

        if (validator.kind == RepresentationValidatorKind::StrongEtag)
        {
            return validator.value.size() >= 2U &&
                validator.value.front() == '"' && validator.value.back() == '"' &&
                !validator.value.starts_with("W/");
        }

        return validator.kind == RepresentationValidatorKind::LastModified &&
            validator.value.size() <= 128U;
    }

    void clearResolvedDownloadGrantSecrets(ResolvedDownloadGrant& grant) noexcept
    {
        secureErase(grant.primaryUrl);
        secureErase(grant.headUrl);
        for (std::string& fallbackUrl : grant.fallbackUrls)
        {
            secureErase(fallbackUrl);
        }
        grant.fallbackUrls.clear();
        for (auto& [name, value] : grant.transportHeaders)
        {
            static_cast<void>(name);
            secureErase(value);
        }
        grant.transportHeaders.clear();
    }

    void validateRemoteArtifactDownloadRequest(const RemoteArtifactDownloadRequest& request)
    {
        if (!isCanonicalRemoteDownloadProviderId(request.providerId) ||
            !isValidRemoteDownloadStableId(request.artifactId) ||
            !isValidRemoteDownloadStableId(request.modId) ||
            !isValidRemoteDownloadStableId(request.versionId) ||
            !isValidRemoteDownloadStableId(request.jobId) ||
            !isValidOperationId(request.operationId))
        {
            throw std::invalid_argument("Remote artifact download request is not canonical.");
        }
    }

    void validateRemoteDownloadFallbackRequest(
        const RemoteDownloadFallbackRequest& request)
    {
        if (!isCanonicalRemoteDownloadProviderId(request.providerId) ||
            !isValidRemoteDownloadStableId(request.artifactId) ||
            !isValidRemoteDownloadStableId(request.modId) ||
            !isValidRemoteDownloadStableId(request.versionId) ||
            !isValidRemoteDownloadStableId(request.jobId) ||
            !isValidRemoteDownloadStableId(request.grantId) ||
            !isCanonicalRemoteDownloadProviderId(
                request.currentRepresentationProviderId) ||
            request.expectedSize == 0U ||
            !isCanonicalRemoteDownloadSha256(request.expectedSha256) ||
            !isValidOperationId(request.operationId))
        {
            throw std::invalid_argument("Remote download fallback request is not canonical.");
        }
    }

    void validateResolvedDownloadGrant(
        const ResolvedDownloadGrant& grant,
        const RemoteArtifactDownloadRequest& request)
    {
        if (grant.providerId != request.providerId ||
            !isCanonicalRemoteDownloadProviderId(grant.representationProviderId) ||
            grant.artifactId != request.artifactId ||
            grant.operationId != request.operationId ||
            !isValidRemoteDownloadStableId(grant.grantId) ||
            grant.primaryUrl.empty() || grant.primaryUrl.size() > maximumUrlLength ||
            grant.headUrl.empty() || grant.headUrl.size() > maximumUrlLength ||
            grant.fallbackUrls.size() > maximumFallbackUrls ||
            std::any_of(grant.fallbackUrls.begin(), grant.fallbackUrls.end(), [](const std::string& url)
            {
                return url.empty() || url.size() > maximumUrlLength;
            }) ||
            grant.transportHeaders.size() > maximumTransportHeaders ||
            std::any_of(grant.transportHeaders.begin(), grant.transportHeaders.end(), [](const auto& header)
            {
                return header.first.empty() || header.first.size() > 128U ||
                    header.second.size() > 16U * 1024U;
            }) ||
            grant.expiresAtUnixMs == 0 || grant.expectedSize == 0 ||
            !isCanonicalRemoteDownloadSha256(grant.expectedSha256))
        {
            throw std::invalid_argument("Remote download resolver returned a non-canonical grant.");
        }
    }

    void validateResolvedDownloadFallbackGrant(
        const ResolvedDownloadGrant& grant,
        const RemoteDownloadFallbackRequest& request)
    {
        const RemoteArtifactDownloadRequest primaryRequest{
            .providerId = request.providerId,
            .artifactId = request.artifactId,
            .modId = request.modId,
            .versionId = request.versionId,
            .jobId = request.jobId,
            .operationId = request.operationId};
        validateResolvedDownloadGrant(grant, primaryRequest);
        if (grant.grantId != request.grantId ||
            grant.representationProviderId == request.currentRepresentationProviderId ||
            grant.expectedSize != request.expectedSize ||
            grant.expectedSha256 != request.expectedSha256 ||
            !grant.fallbackUrls.empty() ||
            !grant.transportHeaders.empty())
        {
            throw std::invalid_argument(
                "Remote download resolver returned an invalid fallback grant.");
        }
    }

    void validateRemoteArtifactResumeState(
        const RemoteArtifactResumeState& state,
        RemoteArtifactResumeValidation validation)
    {
        if (!isCanonicalRemoteDownloadProviderId(state.providerId) ||
            !isValidRemoteDownloadStableId(state.artifactId) ||
            !isValidRemoteDownloadStableId(state.modId) ||
            !isValidRemoteDownloadStableId(state.versionId) ||
            !isValidRemoteDownloadStableId(state.jobId) ||
            !isValidRemoteDownloadStableId(state.grantId) ||
            state.expectedSize == 0 ||
            !isCanonicalRemoteDownloadSha256(state.expectedSha256) ||
            state.bytesReceived > state.expectedSize ||
            state.grantExpiresAtUnixMs == 0 ||
            (state.retryAtUnixMs.has_value() && *state.retryAtUnixMs == 0) ||
            (state.validator.has_value() &&
                !isValidRepresentationValidator(*state.validator)) ||
            (state.phase == RemoteArtifactResumePhase::RetryScheduled) !=
                state.retryAtUnixMs.has_value() ||
            (state.bytesReceived > 0 && !state.validator.has_value()) ||
            (state.phase == RemoteArtifactResumePhase::ReadyToStart &&
                (state.bytesReceived != 0 || !state.validator.has_value())) ||
            (state.phase == RemoteArtifactResumePhase::ReadyToAppend &&
                (state.bytesReceived == 0 || !state.validator.has_value())) ||
            !isKnownPhase(state.phase) ||
            (validation == RemoteArtifactResumeValidation::Durable &&
                !isDurablePhase(state.phase)))
        {
            throw std::invalid_argument("Remote artifact resume state is not canonical.");
        }
    }
}
