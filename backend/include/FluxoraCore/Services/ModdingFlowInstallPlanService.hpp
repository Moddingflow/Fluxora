#pragma once

#include "FluxoraCore/Services/ModdingFlowPublicApiClient.hpp"

#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace fluxora
{
    struct ModdingFlowInstallPlanRequest
    {
        std::vector<std::string> artifactIds;
        std::vector<std::string> versionIds;
        std::vector<std::string> modIds;
        std::string gameSlug;
        std::string gameVersion;
        std::optional<std::string> loader;
        std::optional<std::string> platform;
        std::string releaseChannel{"stable"};
        bool includeOptional{false};
        std::optional<std::string> idempotencyKey;
        std::wstring operationId;
    };

    struct ModdingFlowInstallPlanStep
    {
        // Hash-bound preview metadata only; this type cannot enqueue, install,
        // or carry a signed/provider URL.
        std::size_t index{0U};
        std::optional<std::string> itemId;
        std::string modId;
        std::string versionId;
        std::string artifactId;
        bool required{false};
        std::string selectionKind;
        std::vector<std::string> decisionReasons;
        std::string fileKind;
        std::optional<std::string> fileVersion;
        std::optional<std::string> label;
        std::optional<std::string> filename;
        std::optional<std::string> contentType;
        std::uint64_t sizeBytes{0U};
        std::string sha256;
        std::map<std::string, std::string> hashes;

        bool operator==(const ModdingFlowInstallPlanStep&) const = default;
    };

    struct ModdingFlowInstallPlanDependency
    {
        std::string dependencyId;
        std::optional<std::string> modId;
        std::optional<std::string> targetModId;
        std::string semantic;
        std::string relation;
        std::optional<std::string> reason;

        bool operator==(const ModdingFlowInstallPlanDependency&) const = default;
    };

    struct ModdingFlowInstallPlanConflict
    {
        std::string dependencyId;
        std::optional<std::string> modId;
        std::optional<std::string> targetModId;
        std::string relation;
        std::optional<std::string> reason;

        bool operator==(const ModdingFlowInstallPlanConflict&) const = default;
    };

    struct ModdingFlowInstallPlan
    {
        std::string planId;
        std::string gameSlug;
        std::string gameVersion;
        std::optional<std::string> loader;
        std::optional<std::string> platform;
        std::string releaseChannel;
        std::vector<ModdingFlowInstallPlanDependency> dependencies;
        std::vector<ModdingFlowInstallPlanConflict> conflicts;
        std::vector<ModdingFlowInstallPlanStep> steps;
        std::map<std::string, std::map<std::string, std::string>> fileHashes;
        std::uint64_t requiredDiskSizeBytes{0U};
        std::vector<std::string> warnings;
        std::string idempotencyKey;
        std::wstring operationId;

        bool operator==(const ModdingFlowInstallPlan&) const = default;
    };

    struct ModdingFlowInstallPlanServiceOptions
    {
        std::size_t maximumCachedReplays{256U};
        std::function<std::string()> generateIdempotencyKey;
    };

    class IModdingFlowInstallPlanService
    {
    public:
        virtual ~IModdingFlowInstallPlanService() = default;
        [[nodiscard]] virtual ModdingFlowInstallPlan resolve(
            const ModdingFlowInstallPlanRequest& request) = 0;
    };

    // Authoritative activation preview seam. Inputs are stable provider ids and
    // compatibility targets only; all display/file metadata comes from the
    // provider's resolved, hash-bound plan.
    class IModProviderActivationPreviewResolver
    {
    public:
        virtual ~IModProviderActivationPreviewResolver() = default;
        [[nodiscard]] virtual ModdingFlowInstallPlan previewActivation(
            const ModdingFlowInstallPlanRequest& request) = 0;
    };

    class ModdingFlowInstallPlanService final
        : public IModdingFlowInstallPlanService,
          public IModProviderActivationPreviewResolver
    {
    public:
        explicit ModdingFlowInstallPlanService(
            IModdingFlowPublicApiClient& client,
            ModdingFlowInstallPlanServiceOptions options = {});

        [[nodiscard]] ModdingFlowInstallPlan resolve(
            const ModdingFlowInstallPlanRequest& request) override;
        [[nodiscard]] ModdingFlowInstallPlan previewActivation(
            const ModdingFlowInstallPlanRequest& request) override;

    private:
        struct ReplayEntry
        {
            std::string normalizedRequest;
            ModdingFlowInstallPlan plan;
        };

        IModdingFlowPublicApiClient& client_;
        ModdingFlowInstallPlanServiceOptions options_;
        std::mutex replayMutex_;
        std::map<std::string, ReplayEntry> replayEntries_;
        std::deque<std::string> replayOrder_;
    };
}
