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
    struct ModProviderCatalogCursor
    {
        std::string opaque;
        std::string queryIdentity;

        bool operator==(const ModProviderCatalogCursor&) const = default;
    };

    template <typename T>
    struct ModProviderCatalogPage
    {
        std::vector<T> items;
        std::optional<ModProviderCatalogCursor> nextCursor;
        std::wstring operationId;
    };

    struct ModProviderGame
    {
        std::string id;
        std::string slug;
        std::map<std::string, std::string> title;
        bool enabled{false};

        bool operator==(const ModProviderGame&) const = default;
    };

    struct ModProviderMod
    {
        std::string id;
        std::string slug;
        std::string gameSlug;
        std::map<std::string, std::string> title;
        std::map<std::string, std::string> summary;
        std::string updatedAt;

        bool operator==(const ModProviderMod&) const = default;
    };

    struct ModProviderArtifact
    {
        // Control-plane metadata only. Storage keys, resolve endpoints, signed
        // URLs, and transport credentials intentionally have no representation.
        std::string id;
        std::string modId;
        std::string versionId;
        std::string fileKind;
        std::string fileVersion;
        std::string label;
        std::optional<std::string> originalFilename;
        std::optional<std::string> contentType;
        std::optional<std::string> gameVersion;
        std::optional<std::string> loader;
        std::uint64_t sizeBytes{0};
        std::string sha256;
        std::map<std::string, std::string> hashes;

        bool operator==(const ModProviderArtifact&) const = default;
    };

    struct ModProviderVersion
    {
        std::string id;
        std::string modId;
        std::string version;
        std::string releaseChannel;
        std::vector<std::string> gameVersions;
        std::vector<std::string> loaders;
        std::vector<std::string> artifactIds;
        std::vector<ModProviderArtifact> artifacts;
        std::string publishedAt;

        bool operator==(const ModProviderVersion&) const = default;
    };

    struct ModProviderDependency
    {
        std::string id;
        std::string modId;
        std::optional<std::string> targetModId;
        std::string kind;
        std::string semantic;
        std::string relation;
        std::optional<std::string> label;
        std::optional<std::string> note;

        bool operator==(const ModProviderDependency&) const = default;
    };

    struct ModProviderModQuery
    {
        std::optional<std::string> gameSlug;
        std::optional<std::string> query;
        std::string sort{"relevance"};
        std::optional<std::string> gameVersion;
        std::optional<std::string> loader;
        std::optional<std::string> category;
        std::size_t limit{25U};
        std::optional<ModProviderCatalogCursor> cursor;
    };

    struct ModProviderVersionQuery
    {
        std::string modId;
        std::size_t limit{25U};
        std::optional<ModProviderCatalogCursor> cursor;
    };

    class IModProviderCatalog
    {
    public:
        virtual ~IModProviderCatalog() = default;

        [[nodiscard]] virtual std::vector<ModProviderGame> listGames(
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual ModProviderCatalogPage<ModProviderMod> listMods(
            const ModProviderModQuery& query,
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual ModProviderMod getMod(
            std::string_view idOrSlug,
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual ModProviderCatalogPage<ModProviderVersion> listVersions(
            const ModProviderVersionQuery& query,
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual ModProviderVersion getVersion(
            std::string_view modId,
            std::string_view versionId,
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual std::vector<ModProviderDependency> listDependencies(
            std::string_view modId,
            std::wstring_view operationId) = 0;
    };

    class ModdingFlowProviderCatalog final : public IModProviderCatalog
    {
    public:
        explicit ModdingFlowProviderCatalog(IModdingFlowPublicApiClient& client) noexcept;

        [[nodiscard]] std::vector<ModProviderGame> listGames(
            std::wstring_view operationId) override;
        [[nodiscard]] ModProviderCatalogPage<ModProviderMod> listMods(
            const ModProviderModQuery& query,
            std::wstring_view operationId) override;
        [[nodiscard]] ModProviderMod getMod(
            std::string_view idOrSlug,
            std::wstring_view operationId) override;
        [[nodiscard]] ModProviderCatalogPage<ModProviderVersion> listVersions(
            const ModProviderVersionQuery& query,
            std::wstring_view operationId) override;
        [[nodiscard]] ModProviderVersion getVersion(
            std::string_view modId,
            std::string_view versionId,
            std::wstring_view operationId) override;
        [[nodiscard]] std::vector<ModProviderDependency> listDependencies(
            std::string_view modId,
            std::wstring_view operationId) override;
    private:
        IModdingFlowPublicApiClient& client_;
    };
}
