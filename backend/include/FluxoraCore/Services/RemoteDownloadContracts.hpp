#pragma once

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    struct RemoteArtifactDownloadRequest
    {
        std::string providerId;
        std::string artifactId;
        std::string modId;
        std::string versionId;
        std::string jobId;
        std::wstring operationId;

        bool operator==(const RemoteArtifactDownloadRequest&) const = default;
    };

    // URL-free control-plane request for minting a fresh cross-provider grant.
    // The current representation scope is identity only; no validator from that
    // scope is allowed to cross into the returned fallback representation.
    struct RemoteDownloadFallbackRequest
    {
        std::string providerId;
        std::string artifactId;
        std::string modId;
        std::string versionId;
        std::string jobId;
        std::string grantId;
        std::string currentRepresentationProviderId;
        std::uint64_t expectedSize{0};
        std::string expectedSha256;
        std::wstring operationId;

        bool operator==(const RemoteDownloadFallbackRequest&) const = default;
    };

    enum class RepresentationValidatorKind
    {
        StrongEtag,
        LastModified
    };

    struct RepresentationValidator
    {
        std::string providerId;
        RepresentationValidatorKind kind{RepresentationValidatorKind::StrongEtag};
        std::string value;

        bool operator==(const RepresentationValidator&) const = default;
    };

    // Control-plane grant. Signed URLs and transport credentials are deliberately
    // kept in this short-lived in-memory value and are not part of resume state.
    struct ResolvedDownloadGrant
    {
        std::string providerId;
        // Scope of the concrete transport representation and its validators.
        // This is deliberately distinct from the logical provider provenance.
        std::string representationProviderId;
        std::string artifactId;
        std::string grantId;
        std::string primaryUrl;
        std::string headUrl;
        std::vector<std::string> fallbackUrls;
        std::map<std::string, std::string> transportHeaders;
        std::uint64_t expiresAtUnixMs{0};
        std::uint64_t expectedSize{0};
        std::string expectedSha256;
        std::wstring operationId;

        bool operator==(const ResolvedDownloadGrant&) const = default;
    };

    enum class RemoteArtifactResumePhase
    {
        AwaitingRepresentation,
        ReadyToStart,
        ReadyToAppend,
        Checkpointed,
        RetryScheduled
    };

    struct RemoteArtifactResumeState
    {
        std::string providerId;
        std::string artifactId;
        std::string modId;
        std::string versionId;
        std::string jobId;
        std::string grantId;
        std::uint64_t expectedSize{0};
        std::string expectedSha256;
        std::uint64_t bytesReceived{0};
        std::uint64_t grantExpiresAtUnixMs{0};
        std::optional<std::uint64_t> retryAtUnixMs;
        std::optional<RepresentationValidator> validator;
        RemoteArtifactResumePhase phase{RemoteArtifactResumePhase::AwaitingRepresentation};

        bool operator==(const RemoteArtifactResumeState&) const = default;
    };

    enum class RemoteArtifactResumeValidation
    {
        Runtime,
        Durable
    };

    [[nodiscard]] bool isCanonicalRemoteDownloadProviderId(std::string_view value) noexcept;
    [[nodiscard]] bool isValidRemoteDownloadStableId(
        std::string_view value,
        bool required = true) noexcept;
    [[nodiscard]] bool isCanonicalRemoteDownloadSha256(std::string_view value) noexcept;
    [[nodiscard]] bool isValidRepresentationValidator(
        const RepresentationValidator& validator) noexcept;
    void clearResolvedDownloadGrantSecrets(ResolvedDownloadGrant& grant) noexcept;

    void validateRemoteArtifactDownloadRequest(const RemoteArtifactDownloadRequest& request);
    void validateRemoteDownloadFallbackRequest(const RemoteDownloadFallbackRequest& request);
    void validateResolvedDownloadGrant(
        const ResolvedDownloadGrant& grant,
        const RemoteArtifactDownloadRequest& request);
    void validateResolvedDownloadFallbackGrant(
        const ResolvedDownloadGrant& grant,
        const RemoteDownloadFallbackRequest& request);
    void validateRemoteArtifactResumeState(
        const RemoteArtifactResumeState& state,
        RemoteArtifactResumeValidation validation);
}
