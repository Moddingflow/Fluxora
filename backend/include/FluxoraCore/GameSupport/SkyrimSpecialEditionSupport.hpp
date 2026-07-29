#pragma once

#include "FluxoraCore/GameSupport/DefinitionBackedGameSupport.hpp"
#include "FluxoraCore/GameSupport/ContentLayoutAssessment.hpp"

namespace fluxora
{
    class SkyrimSpecialEditionSupport final
        : public DefinitionBackedGameSupport,
          public IContentLayoutAssessmentPolicy
    {
    public:
        explicit SkyrimSpecialEditionSupport(const GameDefinition& definition);

        [[nodiscard]] static GameId gameId();
        [[nodiscard]] static bool supportsDefinition(const GameDefinition& definition) noexcept;

        [[nodiscard]] const PluginSupportRules& pluginRules() const noexcept override;
        [[nodiscard]] const ContentLayoutSupportRules& contentLayoutRules() const noexcept override;
        [[nodiscard]] const ManifestMigrationRules& manifestMigrationRules() const noexcept override;
        [[nodiscard]] const GameSupportComponents& components() const noexcept override;
        [[nodiscard]] ContentLayoutAssessment assess(const PlacementPlan& plan) const override;

    private:
        PluginSupportRules pluginRules_;
        ContentLayoutSupportRules contentLayoutRules_;
        ManifestMigrationRules manifestMigrationRules_;
        GameSupportComponents components_;
    };
}
