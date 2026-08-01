#pragma once

#include "FluxoraCore/Services/ModdingFlowArtifactLookupService.hpp"
#include "FluxoraCore/Services/ModdingFlowAuthService.hpp"

#include <memory>

namespace fluxora
{
    class IExternalConnectionProvider;
    class IModProviderActivationPreviewResolver;
    class IModProviderCatalog;
    class IModdingFlowInstallPlanService;
    class Logger;

    class IModdingFlowConnectionCapability
    {
    public:
        virtual ~IModdingFlowConnectionCapability() = default;

        virtual void initialize() noexcept = 0;
        virtual void shutdown() noexcept = 0;
        [[nodiscard]] virtual std::shared_ptr<IExternalConnectionProvider> provider() const = 0;
        [[nodiscard]] virtual ModdingFlowConnectStart beginConnect(
            std::string_view redirectUri,
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual ModdingFlowAuthStatus completeConnect(
            std::string_view transactionId,
            ModdingFlowConnectCompletion completion,
            std::wstring_view operationId) = 0;
        virtual void cancelPendingConnect(
            std::string_view transactionId,
            std::wstring_view operationId) = 0;
        // Private managed-AI credential boundary. The caller cannot choose a
        // scope; this capability always requests exactly agent:run.
        [[nodiscard]] virtual std::string managedAiAccessToken(
            std::wstring_view operationId,
            bool forceRefresh) = 0;
        [[nodiscard]] virtual ModdingFlowArtifactPreview lookupArtifactPreview(
            std::string_view artifactId,
            ModdingFlowArtifactLookupAuthMode authMode,
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual IModdingFlowPublicApiClient* publicApiClient() noexcept = 0;
        [[nodiscard]] virtual IModProviderCatalog* providerCatalog() noexcept = 0;
        [[nodiscard]] virtual IModdingFlowInstallPlanService* installPlanService() noexcept = 0;
        [[nodiscard]] virtual IModProviderActivationPreviewResolver*
            activationPreviewResolver() noexcept = 0;
    };

    [[nodiscard]] bool moddingFlowConnectionCapabilityCompiled() noexcept;
    [[nodiscard]] bool shouldEnableModdingFlowCapabilityForCurrentBridgeLane() noexcept;
    [[nodiscard]] std::unique_ptr<IModdingFlowConnectionCapability>
        createProductionModdingFlowConnectionCapability(Logger& logger) noexcept;
}
