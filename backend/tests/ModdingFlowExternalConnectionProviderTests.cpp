#include "FluxoraCore/Services/ModdingFlowExternalConnectionProvider.hpp"
#include "FluxoraCore/Services/ModdingFlowConnectionCapability.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModdingFlowConfiguration.hpp"
#include "FluxoraCore/Services/SecureCredentialStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <array>

namespace fluxora::tests
{
    namespace
    {
        class EmptyCredentialStore final : public ISecureCredentialStore
        {
        public:
            std::optional<std::string> read(std::wstring_view) const override { return std::nullopt; }
            void writeAtomic(std::wstring_view, std::string_view) override {}
            void remove(std::wstring_view) override {}
        };

        class UnusedOAuthClient final : public IModdingFlowOAuthClient
        {
        public:
            ModdingFlowTokenSet exchangeAuthorizationCode(
                const ModdingFlowAuthorizationCodeRequest&) override { return {}; }
            ModdingFlowTokenSet refreshAccessToken(
                const ModdingFlowRefreshRequest&) override { return {}; }
            ModdingFlowProfile fetchCurrentProfile(
                const ModdingFlowProfileRequest&) override { return {}; }
            void revokeToken(const ModdingFlowRevokeRequest&) override {}
        };

        class UnusedIdTokenVerifier final : public IModdingFlowIdTokenVerifier
        {
        public:
            ModdingFlowIdTokenClaims verifySignatureAndDecode(
                const ModdingFlowIdTokenVerificationRequest&) override { return {}; }
        };
    }

    TEST(ModdingFlowExternalConnectionProviderTests, MapsEveryAuthStateWithoutChangingNexusNames)
    {
        struct Scenario
        {
            ModdingFlowAuthState auth;
            ExternalConnectionState external;
            std::wstring_view name;
        };
        constexpr std::array scenarios{
            Scenario{ModdingFlowAuthState::NotLinked, ExternalConnectionState::NotLinked, L"notLinked"},
            Scenario{ModdingFlowAuthState::Connecting, ExternalConnectionState::Connecting, L"connecting"},
            Scenario{ModdingFlowAuthState::Restoring, ExternalConnectionState::Restoring, L"restoring"},
            Scenario{ModdingFlowAuthState::Ready, ExternalConnectionState::Ready, L"ready"},
            Scenario{ModdingFlowAuthState::TemporarilyUnavailable, ExternalConnectionState::TemporarilyUnavailable, L"temporarilyUnavailable"},
            Scenario{ModdingFlowAuthState::ReauthRequired, ExternalConnectionState::ReauthRequired, L"reauthRequired"}};

        for (const Scenario& scenario : scenarios)
        {
            ModdingFlowAuthStatus auth;
            auth.state = scenario.auth;
            auth.accountName = L"Account";
            auth.hasStoredSession = true;
            auth.retryable = true;
            auth.requiresUserAction = true;
            const ExternalConnectionStatus mapped =
                mapModdingFlowExternalConnectionStatus(auth, L"operation-map");
            EXPECT_EQ(mapped.providerId, L"moddingflow");
            EXPECT_EQ(mapped.state, scenario.external);
            EXPECT_EQ(externalConnectionStateName(mapped.state), scenario.name);
            EXPECT_EQ(mapped.accountName, L"Account");
            EXPECT_EQ(mapped.operationId, L"operation-map");
        }

        EXPECT_EQ(externalConnectionStateName(ExternalConnectionState::NotConfigured), L"notConfigured");
        EXPECT_EQ(externalConnectionStateName(ExternalConnectionState::NotLinked), L"notLinked");
        EXPECT_EQ(externalConnectionStateName(ExternalConnectionState::Restoring), L"restoring");
        EXPECT_EQ(externalConnectionStateName(ExternalConnectionState::Ready), L"ready");
        EXPECT_EQ(externalConnectionStateName(ExternalConnectionState::TemporarilyUnavailable), L"temporarilyUnavailable");
        EXPECT_EQ(externalConnectionStateName(ExternalConnectionState::ReauthRequired), L"reauthRequired");
    }

    TEST(ModdingFlowExternalConnectionProviderTests, ProductionCapabilityIsAbsentByDefault)
    {
        Logger logger;
#ifdef FLUXORA_ENABLE_MODDINGFLOW_AUTH_PROVIDER
        EXPECT_TRUE(moddingFlowConnectionCapabilityCompiled());
        const auto capability = createProductionModdingFlowConnectionCapability(logger);
        ASSERT_NE(capability, nullptr);
        EXPECT_NE(capability->providerCatalog(), nullptr);
        EXPECT_NE(capability->installPlanService(), nullptr);
        EXPECT_NE(capability->activationPreviewResolver(), nullptr);
#else
        EXPECT_FALSE(moddingFlowConnectionCapabilityCompiled());
        EXPECT_EQ(createProductionModdingFlowConnectionCapability(logger), nullptr);
#endif
    }

    TEST(ModdingFlowExternalConnectionProviderTests,
         ProductionCapabilityIsRestrictedToDownloadBridgeLane)
    {
        {
            ScopedEnvironmentVariable lane(L"FLUXORA_BRIDGE_LANE", L"download");
            EXPECT_TRUE(shouldEnableModdingFlowCapabilityForCurrentBridgeLane());
        }
        for (const std::wstring_view laneName : {
                 L"main", L"connection", L"background", L"install", L"interactive"})
        {
            ScopedEnvironmentVariable lane(
                L"FLUXORA_BRIDGE_LANE", std::wstring(laneName));
            EXPECT_FALSE(shouldEnableModdingFlowCapabilityForCurrentBridgeLane());
        }
    }

    TEST(ModdingFlowExternalConnectionProviderTests, GenericConnectCannotStartPrivateOAuthTransaction)
    {
        Logger logger;
        EmptyCredentialStore credentials;
        UnusedOAuthClient oauth;
        UnusedIdTokenVerifier verifier;
        ModdingFlowAuthService auth(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            verifier);
        auth.initialize();
        const std::shared_ptr<IExternalConnectionProvider> provider =
            createModdingFlowExternalConnectionProvider(auth);

        const ExternalConnectionStatus generic = provider->connect(L"operation-generic");

        EXPECT_EQ(generic.state, ExternalConnectionState::NotLinked);
        EXPECT_NE(generic.message.find(L"private OAuth bridge"), std::wstring::npos);
        EXPECT_EQ(auth.status().state, ModdingFlowAuthState::NotLinked);
    }
}
