#pragma once

#include "FluxoraCore/Services/ModdingFlowAuthService.hpp"
#include "FluxoraCore/Services/ModdingFlowConfiguration.hpp"

#include <chrono>
#include <functional>
#include <memory>

namespace fluxora
{
    class IModdingFlowHttpTransport;

    struct ModdingFlowJwksIdTokenVerifierOptions
    {
        std::function<std::chrono::steady_clock::time_point()> monotonicClock;
    };

    class ModdingFlowJwksIdTokenVerifier final : public IModdingFlowIdTokenVerifier
    {
    public:
        ModdingFlowJwksIdTokenVerifier(
            ModdingFlowConfiguration configuration,
            IModdingFlowHttpTransport& transport,
            ModdingFlowJwksIdTokenVerifierOptions options = {});
        ~ModdingFlowJwksIdTokenVerifier() override;

        ModdingFlowJwksIdTokenVerifier(const ModdingFlowJwksIdTokenVerifier&) = delete;
        ModdingFlowJwksIdTokenVerifier& operator=(const ModdingFlowJwksIdTokenVerifier&) = delete;

        [[nodiscard]] ModdingFlowIdTokenClaims verifySignatureAndDecode(
            const ModdingFlowIdTokenVerificationRequest& request) override;

    private:
        struct State;
        std::unique_ptr<State> state_;
    };
}
