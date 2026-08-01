#pragma once

#include "FluxoraCore/Services/ModdingFlowPublicApiClient.hpp"

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    enum class ModdingFlowArtifactLookupAuthMode
    {
        Anonymous,
        BearerModsRead
    };

    // Strict metadata-only projection for handoff confirmation. Download jobs,
    // grants, signed URLs, storage keys and representation validators have no
    // representation in this DTO.
    struct ModdingFlowArtifactPreview
    {
        std::string artifactId;
        std::string modId;
        std::string versionId;
        std::string gameId;
        std::string gameSlug;
        std::string modSlug;
        std::map<std::string, std::string> title;
        std::map<std::string, std::string> summary;
        std::optional<std::string> authorDisplayName;
        std::string accessTier;
        std::string primaryArtifactId;
        std::string version;
        std::optional<std::string> semanticVersion;
        std::string releaseChannel;
        std::vector<std::string> gameVersions;
        std::vector<std::string> loaders;
        std::string fileKind;
        std::string fileVersion;
        std::optional<std::string> label;
        std::string filename;
        std::string originalFilename;
        std::string contentType;
        std::optional<std::string> gameVersionKey;
        std::optional<std::string> loaderKey;
        std::uint64_t sizeBytes{0};
        std::string sha256;
        std::wstring operationId;

        bool operator==(const ModdingFlowArtifactPreview&) const = default;
    };

    class IModdingFlowArtifactLookupService
    {
    public:
        virtual ~IModdingFlowArtifactLookupService() = default;

        [[nodiscard]] virtual ModdingFlowArtifactPreview lookup(
            std::string_view artifactId,
            ModdingFlowArtifactLookupAuthMode authMode,
            std::wstring_view operationId) = 0;
    };

    class ModdingFlowArtifactLookupService final : public IModdingFlowArtifactLookupService
    {
    public:
        explicit ModdingFlowArtifactLookupService(
            IModdingFlowPublicApiClient& client) noexcept;

        [[nodiscard]] ModdingFlowArtifactPreview lookup(
            std::string_view artifactId,
            ModdingFlowArtifactLookupAuthMode authMode,
            std::wstring_view operationId) override;

    private:
        IModdingFlowPublicApiClient& client_;
    };
}
