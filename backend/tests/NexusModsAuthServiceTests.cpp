#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/NexusModsAuthService.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <functional>
#include <map>
#include <string_view>
#include <thread>
#include <vector>

#ifdef FLUXORA_NEXUS_AUTH_SERVICE_TEST_HOOKS
namespace fluxora::test_hooks
{
    std::string buildNexusTokenRequestBodyForTest(
        const std::wstring& clientId,
        const std::wstring& clientSecret,
        const std::wstring& redirectUri,
        const std::string& code,
        const std::wstring& codeVerifier);
    std::string buildNexusRefreshTokenRequestBodyForTest(
        const std::wstring& clientId,
        const std::wstring& clientSecret,
        const std::wstring& refreshToken);
    std::string buildNexusAuthorizeUrlForTest(
        const std::wstring& clientId,
        const std::wstring& clientSecret,
        const std::wstring& redirectUri,
        const std::wstring& state,
        const std::wstring& codeChallenge);
    std::wstring defaultNexusRedirectUriForTest();
    std::wstring nexusClientIdNameForTest();
    std::wstring nexusRedirectUriNameForTest();
    std::wstring nexusApiLimitProbePathForTest();
    std::wstring nexusClientSecretNameForTest();
    std::wstring resolvedNexusClientIdForTest();
    std::wstring resolvedNexusRedirectUriForTest();
    std::wstring extractSupabaseCredentialValueForTest(const std::wstring& json);
    std::wstring resolvedNexusClientSecretForTest();
    std::wstring protectNexusSecretForTest(const std::wstring& value);
    void setNexusTokenRequestHook(std::function<std::string(std::string_view)> hook);
    ApiLimitProvider nexusApiLimitProviderFromHeadersForTest(
        const std::map<std::wstring, std::wstring>& headers,
        unsigned long statusCode);
}
#endif

namespace fluxora::tests
{
#ifdef FLUXORA_NEXUS_AUTH_SERVICE_TEST_HOOKS
    namespace nexus_auth_test_hooks = ::fluxora::test_hooks;

    namespace
    {
        class ScopedNexusTokenRequestHook final
        {
        public:
            explicit ScopedNexusTokenRequestHook(
                std::function<std::string(std::string_view)> hook)
            {
                nexus_auth_test_hooks::setNexusTokenRequestHook(std::move(hook));
            }

            ScopedNexusTokenRequestHook(const ScopedNexusTokenRequestHook&) = delete;
            ScopedNexusTokenRequestHook& operator=(const ScopedNexusTokenRequestHook&) = delete;

            ~ScopedNexusTokenRequestHook()
            {
                nexus_auth_test_hooks::setNexusTokenRequestHook({});
            }
        };
    }
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
        auth.isPremium = true;
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
        EXPECT_TRUE(status.isPremium);
        EXPECT_FALSE(status.hasApiKey);
        EXPECT_EQ(status.clientId, L"fluxora-test-client");
        EXPECT_EQ(status.displayName, L"modder");
        EXPECT_EQ(status.message, L"NexusMods привязан: modder");

        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, MissingStoredSessionIsInstantlyNotLinkedWithoutNetwork)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();
        std::atomic_int requestCount{0};
        const ScopedNexusTokenRequestHook tokenRequestHook([&](std::string_view)
        {
            ++requestCount;
            return std::string{};
        });

        NexusModsAuthService service(logger, settings);
        const NexusModsConnectionStatus result = service.restoreStoredSession(
            std::chrono::steady_clock::now() + std::chrono::seconds(1));

        EXPECT_EQ(result.state, NexusModsConnectionState::NotLinked);
        EXPECT_FALSE(result.hasStoredSession);
        EXPECT_EQ(requestCount.load(), 0);
        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, ValidStoredApiKeyIsReadyWithoutNetworkProbe)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();
        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.username = L"Safe account";
        auth.protectedApiKey = nexus_auth_test_hooks::protectNexusSecretForTest(L"stored-key");
        settings.saveNexusModsAuth(auth);
        std::atomic_int requestCount{0};
        const ScopedNexusTokenRequestHook tokenRequestHook([&](std::string_view)
        {
            ++requestCount;
            return std::string{};
        });

        NexusModsAuthService service(logger, settings);
        const NexusModsConnectionStatus result = service.restoreStoredSession(
            std::chrono::steady_clock::now() + std::chrono::seconds(1));

        EXPECT_EQ(result.state, NexusModsConnectionState::Ready);
        EXPECT_EQ(result.accountName, L"Safe account");
        EXPECT_TRUE(result.hasStoredSession);
        EXPECT_EQ(requestCount.load(), 0);
        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, ExpiredStoredOAuthSessionRefreshesWithinDeadline)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"test-client-secret");
        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();
        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.username = L"Saved user";
        auth.tokenType = L"Bearer";
        auth.expiresAtUtc = L"2020-01-01T00:00:00Z";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"expired-token");
        auth.protectedRefreshToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"refresh-token");
        settings.saveNexusModsAuth(auth);
        std::atomic_int requestCount{0};
        const ScopedNexusTokenRequestHook tokenRequestHook([&](std::string_view)
        {
            ++requestCount;
            return std::string(
                R"({"access_token":"restored-token","refresh_token":"rotated-token","token_type":"Bearer","expires_in":3600})");
        });

        NexusModsAuthService service(logger, settings);
        const NexusModsConnectionStatus result = service.restoreStoredSession(
            std::chrono::steady_clock::now() + std::chrono::seconds(1));

        EXPECT_EQ(result.state, NexusModsConnectionState::Ready);
        EXPECT_EQ(requestCount.load(), 1);
        EXPECT_FALSE(settings.loadNexusModsAuth().reauthRequired);
        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, TemporaryRefreshFailureKeepsStoredSessionRetryable)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"test-client-secret");
        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();
        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.expiresAtUtc = L"2020-01-01T00:00:00Z";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"expired-token");
        auth.protectedRefreshToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"refresh-token");
        settings.saveNexusModsAuth(auth);
        const ScopedNexusTokenRequestHook tokenRequestHook([](std::string_view) -> std::string
        {
            throw std::runtime_error("offline");
        });

        NexusModsAuthService service(logger, settings);
        const NexusModsConnectionStatus result = service.restoreStoredSession(
            std::chrono::steady_clock::now() + std::chrono::milliseconds(50));
        const NexusModsStoredAuth persisted = settings.loadNexusModsAuth();

        EXPECT_EQ(result.state, NexusModsConnectionState::TemporarilyUnavailable);
        EXPECT_TRUE(result.retryable);
        EXPECT_TRUE(result.hasStoredSession);
        EXPECT_FALSE(persisted.reauthRequired);
        EXPECT_FALSE(persisted.protectedAccessToken.empty());
        EXPECT_FALSE(persisted.protectedRefreshToken.empty());
        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, RevokedRefreshGrantRequiresReauthAndKeepsCredentials)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"test-client-secret");
        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();
        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.expiresAtUtc = L"2020-01-01T00:00:00Z";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"expired-token");
        auth.protectedRefreshToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"revoked-token");
        settings.saveNexusModsAuth(auth);
        const ScopedNexusTokenRequestHook tokenRequestHook([](std::string_view)
        {
            return std::string(R"({"error":"invalid_grant","error_description":"revoked"})");
        });

        NexusModsAuthService service(logger, settings);
        const NexusModsConnectionStatus result = service.restoreStoredSession(
            std::chrono::steady_clock::now() + std::chrono::seconds(1));
        const NexusModsStoredAuth persisted = settings.loadNexusModsAuth();

        EXPECT_EQ(result.state, NexusModsConnectionState::ReauthRequired);
        EXPECT_TRUE(result.requiresUserAction);
        EXPECT_FALSE(result.retryable);
        EXPECT_TRUE(persisted.reauthRequired);
        EXPECT_FALSE(persisted.protectedRefreshToken.empty());
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

    TEST(NexusModsAuthServiceTests, StatusUsesPublicDefaultWithoutSecretResolution)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable fluxoraClientId(L"FLUXORA_NEXUS_CLIENT_ID", L"");
        ScopedEnvironmentVariable nexusClientId(L"NEXUS_CLIENT_ID", L"");
        ScopedEnvironmentVariable nexusOAuthClientId(L"NEXUS_OAUTH_CLIENT_ID", L"");
        ScopedEnvironmentVariable fluxoraRedirectUri(L"FLUXORA_NEXUS_REDIRECT_URI", L"");
        ScopedEnvironmentVariable nexusRedirectUri(L"NEXUS_REDIRECT_URI", L"");
        ScopedEnvironmentVariable nexusOAuthRedirectUri(L"NEXUS_OAUTH_REDIRECT_URI", L"");
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"confidential-status-test-secret");

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsAuthService service(logger, settings);
        const NexusModsAuthStatus status = service.status();

        EXPECT_TRUE(status.isConfigured);
        EXPECT_FALSE(status.isLinked);
        EXPECT_FALSE(status.hasApiKey);
        EXPECT_EQ(status.clientId, L"fluxora");
        EXPECT_EQ(status.redirectUri, L"http://127.0.0.1:8089/callback");
        EXPECT_EQ(status.message, L"NexusMods не привязан.");

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

    TEST(NexusModsAuthServiceTests, ApiAuthHeaderDoesNotExposeExpiredOAuthBearerWithoutRefreshToken)
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
        auth.tokenType = L"Bearer";
        auth.expiresAtUtc = L"2000-01-01T00:00:00Z";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"expired-access-token");
        settings.saveNexusModsAuth(auth);

        NexusModsAuthService service(logger, settings);
        const NexusModsApiAuthHeader header = service.apiAuthHeader();

        EXPECT_FALSE(header.isAvailable);
        EXPECT_TRUE(header.headerValue.empty());
        EXPECT_NE(header.message.find(L"expired"), std::wstring::npos);
        EXPECT_EQ(header.failureKind, NexusModsAuthFailureKind::ReauthRequired);
        EXPECT_TRUE(settings.loadNexusModsAuth().reauthRequired);

        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, ConcurrentApiAuthRequestsRefreshExpiredOAuthTokenOnce)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"test-client-secret");

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.tokenType = L"Bearer";
        auth.expiresAtUtc = L"2000-01-01T00:00:00Z";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"expired-access-token");
        auth.protectedRefreshToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"refresh-token");
        settings.saveNexusModsAuth(auth);

        std::atomic_int requestCount{0};
        const ScopedNexusTokenRequestHook tokenRequestHook(
            [&](std::string_view requestBody)
            {
                ++requestCount;
                EXPECT_NE(requestBody.find("grant_type=refresh_token"), std::string_view::npos);
                return std::string(
                    R"({"access_token":"refreshed-access-token","refresh_token":"rotated-refresh-token","token_type":"Bearer","expires_in":3600})");
            });

        NexusModsAuthService service(logger, settings);
        std::vector<NexusModsApiAuthHeader> headers(2);
        std::thread first([&]() { headers[0] = service.apiAuthHeader(); });
        std::thread second([&]() { headers[1] = service.apiAuthHeader(); });
        first.join();
        second.join();

        EXPECT_EQ(requestCount.load(), 1);
        for (const NexusModsApiAuthHeader& header : headers)
        {
            EXPECT_TRUE(header.isAvailable);
            EXPECT_EQ(header.headerName, L"Authorization");
            EXPECT_EQ(header.headerValue, L"Bearer refreshed-access-token");
        }

        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, ConcurrentRejectedOAuthCredentialsRefreshOnce)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"test-client-secret");

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.tokenType = L"Bearer";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"rejected-access-token");
        auth.protectedRefreshToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"refresh-token");
        settings.saveNexusModsAuth(auth);

        std::atomic_int requestCount{0};
        const ScopedNexusTokenRequestHook tokenRequestHook(
            [&](std::string_view)
            {
                ++requestCount;
                return std::string(
                    R"({"access_token":"replacement-access-token","refresh_token":"refresh-token","token_type":"Bearer","expires_in":3600})");
            });

        NexusModsAuthService service(logger, settings);
        const NexusModsApiAuthHeader rejected = service.apiAuthHeader();
        std::vector<NexusModsApiAuthHeader> headers(2);
        std::thread first([&]() { headers[0] = service.retryApiAuthHeaderAfterUnauthorized(rejected); });
        std::thread second([&]() { headers[1] = service.retryApiAuthHeaderAfterUnauthorized(rejected); });
        first.join();
        second.join();

        EXPECT_EQ(requestCount.load(), 1);
        for (const NexusModsApiAuthHeader& header : headers)
        {
            EXPECT_TRUE(header.isAvailable);
            EXPECT_EQ(header.headerValue, L"Bearer replacement-access-token");
        }

        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, RejectedApiKeyNeverUsesOAuthRefresh)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.protectedApiKey = nexus_auth_test_hooks::protectNexusSecretForTest(L"rejected-api-key");
        auth.protectedRefreshToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"refresh-token");
        settings.saveNexusModsAuth(auth);

        std::atomic_int requestCount{0};
        const ScopedNexusTokenRequestHook tokenRequestHook([&](std::string_view)
        {
            ++requestCount;
            return std::string{};
        });
        NexusModsAuthService service(logger, settings);
        const NexusModsApiAuthHeader retry = service.retryApiAuthHeaderAfterUnauthorized(
            service.apiAuthHeader());

        EXPECT_FALSE(retry.isAvailable);
        EXPECT_EQ(retry.failureKind, NexusModsAuthFailureKind::ReauthRequired);
        EXPECT_EQ(requestCount.load(), 0);
        EXPECT_TRUE(settings.loadNexusModsAuth().reauthRequired);
        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, RejectedOAuthTemporaryRefreshFailureRemainsRetryable)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"test-client-secret");
        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.tokenType = L"Bearer";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"rejected-access-token");
        auth.protectedRefreshToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"refresh-token");
        settings.saveNexusModsAuth(auth);

        std::atomic_int requestCount{0};
        const ScopedNexusTokenRequestHook tokenRequestHook([&](std::string_view) -> std::string
        {
            ++requestCount;
            throw std::runtime_error("refresh rejected");
        });
        NexusModsAuthService service(logger, settings);
        const NexusModsApiAuthHeader rejected = service.apiAuthHeader();

        const NexusModsApiAuthHeader first = service.retryApiAuthHeaderAfterUnauthorized(rejected);
        const NexusModsApiAuthHeader second = service.retryApiAuthHeaderAfterUnauthorized(rejected);
        EXPECT_FALSE(first.isAvailable);
        EXPECT_FALSE(second.isAvailable);
        EXPECT_EQ(first.failureKind, NexusModsAuthFailureKind::Temporary);
        EXPECT_EQ(second.failureKind, NexusModsAuthFailureKind::Temporary);
        EXPECT_EQ(requestCount.load(), 2);
        EXPECT_FALSE(settings.loadNexusModsAuth().reauthRequired);
        settings.shutdown();
    }

    TEST(NexusModsAuthServiceTests, RepeatedUnauthorizedAfterSuccessfulRefreshRequiresReauth)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", temp.path().wstring());
        ScopedEnvironmentVariable clientSecret(L"FLUXORA_NEXUS_CLIENT_SECRET", L"test-client-secret");
        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();
        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.tokenType = L"Bearer";
        auth.protectedAccessToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"rejected-token");
        auth.protectedRefreshToken = nexus_auth_test_hooks::protectNexusSecretForTest(L"refresh-token");
        settings.saveNexusModsAuth(auth);
        const ScopedNexusTokenRequestHook tokenRequestHook([](std::string_view)
        {
            return std::string(
                R"({"access_token":"refreshed-but-rejected","refresh_token":"refresh-token","token_type":"Bearer","expires_in":3600})");
        });

        NexusModsAuthService service(logger, settings);
        const NexusModsApiAuthHeader refreshed = service.retryApiAuthHeaderAfterUnauthorized(
            service.apiAuthHeader());
        ASSERT_TRUE(refreshed.isAvailable);
        const NexusModsApiAuthHeader repeated = service.retryApiAuthHeaderAfterUnauthorized(refreshed);

        EXPECT_FALSE(repeated.isAvailable);
        EXPECT_EQ(repeated.failureKind, NexusModsAuthFailureKind::ReauthRequired);
        EXPECT_TRUE(settings.loadNexusModsAuth().reauthRequired);
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

    TEST(NexusModsAuthServiceTests, ApiLimitsUseNexusRateLimitResponseHeaders)
    {
        const ApiLimitProvider provider = nexus_auth_test_hooks::nexusApiLimitProviderFromHeadersForTest(
            {
                {L"X-RL-Hourly-Limit", L"500"},
                {L"X-RL-Hourly-Remaining", L"421"},
                {L"X-RL-Hourly-Reset", L"1783468800"},
                {L"X-RL-Daily-Limit", L"20000"},
                {L"X-RL-Daily-Remaining", L"19876"},
                {L"X-RL-Daily-Reset", L"1783468800"},
            },
            200);

        ASSERT_EQ(provider.windows.size(), 2U);
        EXPECT_EQ(provider.id, L"nexusmods");
        EXPECT_EQ(provider.state, L"available");
        EXPECT_EQ(provider.windows[0].id, L"hourly");
        EXPECT_EQ(provider.windows[0].limit, 500);
        EXPECT_EQ(provider.windows[0].remaining, 421);
        EXPECT_EQ(provider.windows[0].resetAtUtc, L"2026-07-08T00:00:00Z");
        EXPECT_EQ(provider.windows[1].id, L"daily");
        EXPECT_EQ(provider.windows[1].limit, 20000);
        EXPECT_EQ(provider.windows[1].remaining, 19876);
    }

    TEST(NexusModsAuthServiceTests, ApiLimitsUseStandardRateLimitHeadersCaseInsensitively)
    {
        const ApiLimitProvider provider = nexus_auth_test_hooks::nexusApiLimitProviderFromHeadersForTest(
            {
                {L"x-ratelimit-limit", L"120;w=60"},
                {L"x-ratelimit-remaining", L"118"},
                {L"ratelimit-reset", L"60"},
            },
            200);

        ASSERT_EQ(provider.windows.size(), 1U);
        EXPECT_EQ(provider.state, L"available");
        EXPECT_EQ(provider.windows[0].id, L"current");
        EXPECT_EQ(provider.windows[0].label, L"Current");
        EXPECT_EQ(provider.windows[0].limit, 120);
        EXPECT_EQ(provider.windows[0].remaining, 118);
        EXPECT_EQ(provider.windows[0].resetRaw, L"60");
    }

    TEST(NexusModsAuthServiceTests, ApiLimitsDoNotInventMissingHeaders)
    {
        const ApiLimitProvider provider =
            nexus_auth_test_hooks::nexusApiLimitProviderFromHeadersForTest({}, 200);

        EXPECT_EQ(provider.state, L"not-provided");
        EXPECT_TRUE(provider.windows.empty());
        EXPECT_NE(provider.message.find(L"did not include rate-limit headers"), std::wstring::npos);
    }

    TEST(NexusModsAuthServiceTests, ApiLimitsProbeQuotaBearingEndpoint)
    {
        EXPECT_EQ(nexus_auth_test_hooks::nexusApiLimitProbePathForTest(), L"/v1/colourschemes.json");
        EXPECT_NE(nexus_auth_test_hooks::nexusApiLimitProbePathForTest(), L"/v1/users/validate.json");
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

    TEST(NexusModsAuthServiceTests, RefreshRequestUsesRefreshGrantAndConfidentialSecret)
    {
        const std::string body = nexus_auth_test_hooks::buildNexusRefreshTokenRequestBodyForTest(
            L"fluxora",
            L"secret value",
            L"refresh token");

        EXPECT_NE(body.find("grant_type=refresh_token"), std::string::npos);
        EXPECT_NE(body.find("client_id=fluxora"), std::string::npos);
        EXPECT_NE(body.find("client_secret=secret%20value"), std::string::npos);
        EXPECT_NE(body.find("refresh_token=refresh%20token"), std::string::npos);
        EXPECT_EQ(body.find("code_verifier"), std::string::npos);
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
