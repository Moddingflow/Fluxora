#pragma once

#include "FluxoraCore/Services/ModdingFlowAuthService.hpp"
#include "FluxoraCore/Services/ModdingFlowConfiguration.hpp"

namespace fluxora
{
    class IModdingFlowHttpTransport;

    class ModdingFlowOAuthHttpClient final : public IModdingFlowOAuthClient
    {
    public:
        ModdingFlowOAuthHttpClient(
            ModdingFlowConfiguration configuration,
            IModdingFlowHttpTransport& transport);

        [[nodiscard]] ModdingFlowTokenSet exchangeAuthorizationCode(
            const ModdingFlowAuthorizationCodeRequest& request) override;
        [[nodiscard]] ModdingFlowTokenSet refreshAccessToken(
            const ModdingFlowRefreshRequest& request) override;
        [[nodiscard]] ModdingFlowProfile fetchCurrentProfile(
            const ModdingFlowProfileRequest& request) override;
        void revokeToken(const ModdingFlowRevokeRequest& request) override;

    private:
        ModdingFlowConfiguration configuration_;
        IModdingFlowHttpTransport& transport_;
    };
}
