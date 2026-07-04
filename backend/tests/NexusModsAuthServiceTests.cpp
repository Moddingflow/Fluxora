#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/NexusModsAuthService.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#ifdef FLUXORA_NEXUS_AUTH_SERVICE_TEST_HOOKS
namespace fluxora::test_hooks
{
    std::string buildNexusTokenRequestBodyForTest(
        const std::wstring& clientId,
        const std::wstring& clientSecret,
        const std::wstring& redirectUri,
        const std::string& code,
        const std::wstring& codeVerifier);
    std::string buildNexusAuthorizeUrlForTest(
        const std::wstring& clientId,
        const std::wstring& clientSecret,
        const std::wstring& redirectUri,
        const std::wstring& state,
        const std::wstring& codeChallenge);
    std::wstring defaultNexusRedirectUriForTest();
    std::wstring nexusClientIdNameForTest();
    std::wstring nexusRedirectUriNameForTest();
    std::wstring nexusClientSecretNameForTest();
    std::wstring resolvedNexusClientIdForTest();
    std::wstring resolvedNexusRedirectUriForTest();
    std::wstring extractSupabaseCredentialValueForTest(const std::wstring& json);
    std::wstring resolvedNexusClientSecretForTest();
    std::wstring protectNexusSecretForTest(const std::wstring& value);
}
#endif

namespace fluxora::tests
{
#ifdef FLUXORA_NEXUS_AUTH_SERVICE_TEST_HOOKS
    namespace nexus_auth_test_hooks = ::fluxora::test_hooks;
#endif

    TEST(NexusModsAuthServiceTests, OAuthTokenWithoutLegacyApiKeyIsLinked)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable clientId(L"FLUXORA_NEXUS_CLIENT_ID", L"fluxora-test-client");

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.username = L"modder";
        auth.userId = L"42";
        auth.tokenType = L"Bearer";
        auth.expiresAtUtc = L"2026-06-16T10:00:00Z";
        auth.protectedAccessToken = L"protected-access-token";
        settings.saveNexusModsAuth(auth);

        NexusModsAuthService service(logger, settings);
        const NexusModsAuthStatus status = service.status();

        EXPECT_TRUE(status.isConfigured);
        EXPECT_TRUE(status.isLinked);
        EXPECT_FALSE(status.hasApiKey);
        EXPECT_EQ(status.clientId, L"fluxora-test-client");
        EXPECT_EQ(status.displayName, L"modder");
        EXPECT_EQ(status.message, L"NexusMods привязан: modder");

        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, ApiKeyOnlyAuthIsLinkedForDownloads)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.username = L"modder";
        auth.userId = L"42";
        auth.protectedApiKey = L"protected-api-key";
        settings.saveNexusModsAuth(auth);

        NexusModsAuthService service(logger, settings);
        const NexusModsAuthStatus status = service.status();

        EXPECT_TRUE(status.isLinked);
        EXPECT_TRUE(status.hasApiKey);
        EXPECT_EQ(status.displayName, L"modder");
        EXPECT_EQ(status.message, L"NexusMods привязан: modder");

        settings.shutdown();
    }

#ifdef FLUXORA_NEXUS_AUTH_SERVICE_TEST_HOOKS
    TEST(NexusModsAuthServiceTests, ApiAuthHeaderUsesProtectedApiKeyForTrustedNativeServices)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.username = L"modder";
        auth.userId = L"42";
        auth.protectedApiKey = nexus_auth_test_hooks::protectNexusSecretForTest(L"linked-api-key");
        settings.saveNexusModsAuth(auth);

        NexusModsAuthService service(logger, settings);
        const NexusModsApiAuthHeader header = service.apiAuthHeader();

        EXPECT_TRUE(header.isAvailable);
        EXPECT_EQ(header.headerName, L"apikey");
        EXPECT_EQ(header.headerValue, L"linked-api-key");
        EXPECT_EQ(header.credentialKind, L"api-key");

        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, ApiAuthHeaderUsesOAuthBearerWhenApiKeyIsAbsent)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.username = L"modder";
        auth.userId = L"42";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"linked-access-token");
        settings.saveNexusModsAuth(auth);

        NexusModsAuthService service(logger, settings);
        const NexusModsApiAuthHeader header = service.apiAuthHeader();

        EXPECT_TRUE(header.isAvailable);
        EXPECT_EQ(header.headerName, L"Authorization");
        EXPECT_EQ(header.headerValue, L"Bearer linked-access-token");
        EXPECT_EQ(header.credentialKind, L"oauth");

        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, ApiAuthHeaderIsUnavailableWithoutLinkedAccount)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsAuthService service(logger, settings);
        const NexusModsApiAuthHeader header = service.apiAuthHeader();

        EXPECT_FALSE(header.isAvailable);
        EXPECT_TRUE(header.headerName.empty());
        EXPECT_TRUE(header.headerValue.empty());

        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, DefaultRedirectUriUsesRegisteredLoopbackCallback)
    {
        EXPECT_EQ(
            nexus_auth_test_hooks::defaultNexusRedirectUriForTest(),
            L"http://127.0.0.1:8089/callback");
    }

    TEST(NexusModsAuthServiceTests, AuthorizeAndTokenRequestsUseRegisteredRedirectUri)
    {
        const std::wstring redirectUri = nexus_auth_test_hooks::defaultNexusRedirectUriForTest();
        const std::string encodedRedirectUri = "redirect_uri=http%3A%2F%2F127.0.0.1%3A8089%2Fcallback";
        const std::string authorizeUrl = nexus_auth_test_hooks::buildNexusAuthorizeUrlForTest(
            L"fluxora",
            L"",
            redirectUri,
            L"state",
            L"challenge");
        const std::string tokenBody = nexus_auth_test_hooks::buildNexusTokenRequestBodyForTest(
            L"fluxora",
            L"",
            redirectUri,
            "auth-code",
            L"verifier");

        EXPECT_NE(authorizeUrl.find(encodedRedirectUri), std::string::npos);
        EXPECT_NE(tokenBody.find(encodedRedirectUri), std::string::npos);
        EXPECT_NE(authorizeUrl.find("scope=&"), std::string::npos);
        EXPECT_NE(authorizeUrl.find("code_challenge_method=S256"), std::string::npos);
        EXPECT_NE(tokenBody.find("code_verifier=verifier"), std::string::npos);
        EXPECT_EQ(authorizeUrl.find("PORT"), std::string::npos);
        EXPECT_EQ(tokenBody.find("PORT"), std::string::npos);
    }

    TEST(NexusModsAuthServiceTests, PrivateClientRequestIncludesClientSecretWithoutPkce)
    {
        const std::string authorizeUrl = nexus_auth_test_hooks::buildNexusAuthorizeUrlForTest(
            L"fluxora",
            L"s e+c/ret",
            L"http://127.0.0.1:49152",
            L"state",
            L"challenge");
        const std::string body = nexus_auth_test_hooks::buildNexusTokenRequestBodyForTest(
            L"fluxora",
            L"s e+c/ret",
            L"http://127.0.0.1:49152",
            "auth-code",
            L"verifier");

        EXPECT_NE(authorizeUrl.find("scope=&"), std::string::npos);
        EXPECT_EQ(authorizeUrl.find("code_challenge"), std::string::npos);
        EXPECT_NE(body.find("client_id=fluxora"), std::string::npos);
        EXPECT_NE(body.find("client_secret=s%20e%2Bc%2Fret"), std::string::npos);
        EXPECT_NE(body.find("code=auth-code"), std::string::npos);
        EXPECT_EQ(body.find("code_verifier=verifier"), std::string::npos);
    }

    TEST(NexusModsAuthServiceTests, ClientSecretResolverUsesExpectedNameAndEnvironmentOverride)
    {
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"  env-secret  ");

        EXPECT_EQ(nexus_auth_test_hooks::nexusClientSecretNameForTest(), L"NEXUS_CLIENT_SECRET");
        EXPECT_EQ(nexus_auth_test_hooks::resolvedNexusClientSecretForTest(), L"env-secret");
    }

    TEST(NexusModsAuthServiceTests, OAuthConfigCanUseSharedVaultNamesFromEnvironment)
    {
        ScopedEnvironmentVariable fluxoraClientId(L"FLUXORA_NEXUS_CLIENT_ID", L"");
        ScopedEnvironmentVariable fluxoraRedirectUri(L"FLUXORA_NEXUS_REDIRECT_URI", L"");
        ScopedEnvironmentVariable clientId(L"NEXUS_CLIENT_ID", L"  vault-client  ");
        ScopedEnvironmentVariable redirectUri(L"NEXUS_REDIRECT_URI", L"  http://127.0.0.1:39011/callback  ");

        EXPECT_EQ(nexus_auth_test_hooks::nexusClientIdNameForTest(), L"NEXUS_CLIENT_ID");
        EXPECT_EQ(nexus_auth_test_hooks::nexusRedirectUriNameForTest(), L"NEXUS_REDIRECT_URI");
        EXPECT_EQ(nexus_auth_test_hooks::resolvedNexusClientIdForTest(), L"vault-client");
        EXPECT_EQ(
            nexus_auth_test_hooks::resolvedNexusRedirectUriForTest(),
            L"http://127.0.0.1:39011/callback");
    }

    TEST(NexusModsAuthServiceTests, SupabaseCredentialExtractorAcceptsRpcApiKeyShape)
    {
        EXPECT_EQ(
            nexus_auth_test_hooks::extractSupabaseCredentialValueForTest(
                LR"({"available":true,"providerId":"nexus","secretName":"NEXUS_CLIENT_SECRET","apiKey":"vault-secret"})"),
            L"vault-secret");
    }
#endif
}
