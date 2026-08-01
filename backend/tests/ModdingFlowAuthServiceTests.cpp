#include "FluxoraCore/Services/ModdingFlowConfiguration.hpp"
#include "FluxoraCore/Services/ModdingFlowAuthService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/SecureCredentialStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <condition_variable>
#include <functional>
#include <future>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        class InMemoryCredentialStore final : public ISecureCredentialStore
        {
        public:
            std::optional<std::string> read(std::wstring_view target) const override
            {
                reads.emplace_back(target);
                return secret;
            }
            void writeAtomic(std::wstring_view target, std::string_view value) override
            {
                secret = std::string(value);
                writes.emplace_back(std::wstring(target), std::string(value));
            }
            void remove(std::wstring_view target) override
            {
                removes.emplace_back(target);
                secret.reset();
            }

            mutable std::optional<std::string> secret;
            mutable std::vector<std::wstring> reads;
            std::vector<std::pair<std::wstring, std::string>> writes;
            std::vector<std::wstring> removes;
        };

        class FakeModdingFlowOAuthClient final : public IModdingFlowOAuthClient
        {
        public:
            ModdingFlowTokenSet exchangeAuthorizationCode(
                const ModdingFlowAuthorizationCodeRequest& request) override
            {
                authorizationRequests.push_back(request);
                return authorizationResponse;
            }

            ModdingFlowTokenSet refreshAccessToken(const ModdingFlowRefreshRequest& request) override
            {
                refreshRequests.push_back(request);
                if (beforeRefresh)
                {
                    beforeRefresh();
                }
                if (refreshFailure)
                {
                    throw ModdingFlowOAuthException(
                        *refreshFailure,
                        refreshFailureMessage,
                        refreshFailureMetadata);
                }
                return refreshResponse;
            }

            ModdingFlowProfile fetchCurrentProfile(const ModdingFlowProfileRequest& request) override
            {
                profileRequests.push_back(request);
                if (beforeProfile)
                {
                    beforeProfile();
                }
                if (profileFailure)
                {
                    throw ModdingFlowOAuthException(*profileFailure, profileFailureMessage);
                }
                return profileResponse;
            }
            void revokeToken(const ModdingFlowRevokeRequest& request) override
            {
                revokeRequests.push_back(request);
                if (beforeRevoke)
                {
                    beforeRevoke();
                }
                if (revokeFailure)
                {
                    throw ModdingFlowOAuthException(
                        ModdingFlowOAuthFailureKind::Temporary,
                        "sensitive revoke transport detail");
                }
            }

            ModdingFlowTokenSet authorizationResponse;
            ModdingFlowTokenSet refreshResponse;
            ModdingFlowProfile profileResponse;
            std::function<void()> beforeRefresh;
            std::function<void()> beforeProfile;
            std::function<void()> beforeRevoke;
            std::optional<ModdingFlowOAuthFailureKind> refreshFailure;
            std::string refreshFailureMessage{"sensitive transport detail"};
            ModdingFlowOAuthFailureMetadata refreshFailureMetadata;
            std::optional<ModdingFlowOAuthFailureKind> profileFailure;
            std::string profileFailureMessage{"sensitive profile transport detail"};
            bool revokeFailure{false};
            std::vector<ModdingFlowAuthorizationCodeRequest> authorizationRequests;
            std::vector<ModdingFlowRefreshRequest> refreshRequests;
            std::vector<ModdingFlowProfileRequest> profileRequests;
            std::vector<ModdingFlowRevokeRequest> revokeRequests;
        };

        class FakeModdingFlowIdTokenVerifier final : public IModdingFlowIdTokenVerifier
        {
        public:
            ModdingFlowIdTokenClaims verifySignatureAndDecode(
                const ModdingFlowIdTokenVerificationRequest& request) override
            {
                requests.push_back(request);
                return claims;
            }

            ModdingFlowIdTokenClaims claims;
            std::vector<ModdingFlowIdTokenVerificationRequest> requests;
        };

        std::string queryValue(std::string_view url, std::string_view name)
        {
            const std::string marker = std::string(name) + '=';
            const std::size_t start = url.find(marker);
            if (start == std::string_view::npos)
            {
                return {};
            }
            const std::size_t valueStart = start + marker.size();
            const std::size_t end = url.find('&', valueStart);
            return std::string(url.substr(valueStart, end - valueStart));
        }

        void expectBoundedAuthTransport(const ModdingFlowHttpPolicy& transport)
        {
            EXPECT_EQ(transport.timeouts.resolve, std::chrono::seconds(5));
            EXPECT_EQ(transport.timeouts.connect, std::chrono::seconds(15));
            EXPECT_EQ(transport.timeouts.send, std::chrono::seconds(15));
            EXPECT_EQ(transport.timeouts.receive, std::chrono::seconds(15));
            EXPECT_EQ(transport.timeouts.overall, std::chrono::seconds(15));
            EXPECT_EQ(transport.redirects, ModdingFlowRedirectPolicy::Reject);
        }
    }

    TEST(ModdingFlowConfigurationTests, ProductionConfigurationPinsPublicClientSecurityContract)
    {
        const ModdingFlowConfiguration configuration = ModdingFlowConfiguration::production();

        EXPECT_EQ(configuration.clientId(), "desktop_mod_manager");
        EXPECT_EQ(configuration.issuer(), "https://moddingflow.com");
        EXPECT_EQ(configuration.apiBaseUrl(), "https://moddingflow.com/v1");
        EXPECT_EQ(configuration.authorizationEndpoint(), "https://moddingflow.com/oauth/authorize");
        EXPECT_EQ(configuration.tokenEndpoint(), "https://moddingflow.com/oauth/token");
        EXPECT_EQ(configuration.revocationEndpoint(), "https://moddingflow.com/oauth/revoke");
        EXPECT_EQ(configuration.jwksUri(), "https://moddingflow.com/.well-known/jwks.json");
        EXPECT_EQ(
            configuration.scope(),
            "openid profile:read mods:read files:download install_plans:resolve agent:run");
        EXPECT_EQ(
            configuration.refreshCredentialTarget(),
            L"Fluxora/OAuth/production/moddingflow/desktop_mod_manager/refresh-token");
        const std::string productVersion = FLUXORA_PRODUCT_VERSION;
        const std::wstring wideProductVersion(productVersion.begin(), productVersion.end());
        EXPECT_EQ(
            configuration.userAgent(),
            std::wstring(L"Fluxora/") + wideProductVersion + L" ModdingFlow");

        EXPECT_NO_THROW(configuration.validateRedirectUri(
            "http://127.0.0.1:49152/oauth/fluxora/callback"));
        EXPECT_THROW(configuration.validateRedirectUri(
            "http://localhost:49152/oauth/fluxora/callback"), std::invalid_argument);
        EXPECT_THROW(configuration.validateRedirectUri(
            "http://127.0.0.1/oauth/fluxora/callback"), std::invalid_argument);
        EXPECT_THROW(configuration.validateRedirectUri(
            "http://127.0.0.1:49152/oauth/fluxora/callback?code=secret"), std::invalid_argument);
    }

    TEST(ModdingFlowAuthServiceTests, BeginConnectCreatesFiveMinutePublicClientPkceTransaction)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.clock = [now] { return now; };
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall));
        };

        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();

        const ModdingFlowConnectStart start = service.beginConnect(
            "http://127.0.0.1:49152/oauth/fluxora/callback",
            L"operation-connect");

        EXPECT_FALSE(start.transactionId.empty());
        EXPECT_EQ(start.expiresAt, now + std::chrono::minutes(5));
        EXPECT_EQ(service.status().state, ModdingFlowAuthState::Connecting);
        EXPECT_NE(start.authorizationUrl.find("https://moddingflow.com/oauth/authorize?"), std::string::npos);
        EXPECT_NE(start.authorizationUrl.find("response_type=code"), std::string::npos);
        EXPECT_NE(start.authorizationUrl.find("client_id=desktop_mod_manager"), std::string::npos);
        EXPECT_NE(
            start.authorizationUrl.find(
                "redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Foauth%2Ffluxora%2Fcallback"),
            std::string::npos);
        EXPECT_NE(
            start.authorizationUrl.find(
                "scope=openid%20profile%3Aread%20mods%3Aread%20files%3Adownload%20install_plans%3Aresolve"),
            std::string::npos);
        EXPECT_NE(start.authorizationUrl.find("code_challenge_method=S256"), std::string::npos);
        EXPECT_NE(start.authorizationUrl.find("code_challenge="), std::string::npos);
        EXPECT_NE(start.authorizationUrl.find("state="), std::string::npos);
        EXPECT_NE(start.authorizationUrl.find("nonce="), std::string::npos);
        EXPECT_EQ(start.authorizationUrl.find("client_secret"), std::string::npos);
        EXPECT_EQ(start.authorizationUrl.find("transaction_id="), std::string::npos);
        EXPECT_EQ(entropyCall, 4U);
    }

    TEST(ModdingFlowAuthServiceTests, CompleteConnectPersistsOnlyRefreshAfterIdentityAndProfileValidation)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.clock = [now] { return now; };
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 10));
        };

        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        FakeModdingFlowIdTokenVerifier idTokens;
        oauth.authorizationResponse = ModdingFlowTokenSet{
            "access-token-secret",
            "refresh-token-secret",
            "id-token-secret",
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.profileResponse = ModdingFlowProfile{"account-uuid", L"Safe display name"};
        idTokens.claims = ModdingFlowIdTokenClaims{
            true,
            "RS256",
            "https://moddingflow.com",
            {"desktop_mod_manager"},
            "account-uuid",
            {},
            now - std::chrono::seconds(5),
            now + std::chrono::minutes(15)
        };

        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();
        const std::string redirectUri = "http://127.0.0.1:49153/oauth/fluxora/callback";
        const ModdingFlowConnectStart start = service.beginConnect(redirectUri, L"operation-connect");
        const std::string state = queryValue(start.authorizationUrl, "state");
        idTokens.claims.nonce = queryValue(start.authorizationUrl, "nonce");

        const ModdingFlowAuthStatus result = service.completeConnect(
            start.transactionId,
            ModdingFlowAuthorizationSuccess{
                "authorization-code-secret", state, "https://moddingflow.com"},
            L"operation-connect");

        EXPECT_EQ(result.state, ModdingFlowAuthState::Ready);
        EXPECT_EQ(result.accountName, L"Safe display name");
        EXPECT_TRUE(result.hasStoredSession);
        ASSERT_EQ(oauth.authorizationRequests.size(), 1U);
        const ModdingFlowAuthorizationCodeRequest& exchange = oauth.authorizationRequests.front();
        EXPECT_EQ(exchange.tokenEndpoint, "https://moddingflow.com/oauth/token");
        EXPECT_EQ(exchange.clientId, "desktop_mod_manager");
        EXPECT_EQ(exchange.redirectUri, redirectUri);
        EXPECT_EQ(exchange.authorizationCode, "authorization-code-secret");
        EXPECT_EQ(exchange.codeVerifier.size(), 43U);
        expectBoundedAuthTransport(exchange.transport);
        ASSERT_EQ(idTokens.requests.size(), 1U);
        EXPECT_EQ(idTokens.requests.front().idToken, "id-token-secret");
        EXPECT_EQ(idTokens.requests.front().jwksUri, "https://moddingflow.com/.well-known/jwks.json");
        EXPECT_TRUE(idTokens.requests.front().forceJwksRefreshOnceForUnknownKey);
        expectBoundedAuthTransport(idTokens.requests.front().transport);
        EXPECT_EQ(idTokens.requests.front().operationId, L"operation-connect");
        ASSERT_EQ(oauth.profileRequests.size(), 1U);
        EXPECT_EQ(oauth.profileRequests.front().apiBaseUrl, "https://moddingflow.com/v1");
        EXPECT_EQ(oauth.profileRequests.front().accessToken, "access-token-secret");
        expectBoundedAuthTransport(oauth.profileRequests.front().transport);
        ASSERT_EQ(credentials.writes.size(), 1U);
        EXPECT_EQ(
            credentials.writes.front().first,
            L"Fluxora/OAuth/production/moddingflow/desktop_mod_manager/refresh-token");
        EXPECT_EQ(credentials.writes.front().second, "refresh-token-secret");
        EXPECT_EQ(credentials.writes.front().second.find("access-token-secret"), std::string::npos);
        EXPECT_EQ(credentials.writes.front().second.find("id-token-secret"), std::string::npos);
    }

    TEST(ModdingFlowAuthServiceTests, ValidAccessTokenIsServedFromMemoryWithoutCredentialOrHttpRead)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.clock = [now] { return now; };
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 20));
        };

        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        FakeModdingFlowIdTokenVerifier idTokens;
        oauth.authorizationResponse = ModdingFlowTokenSet{
            "memory-only-access-token",
            "credential-only-refresh-token",
            "transient-id-token",
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.profileResponse = ModdingFlowProfile{"account-uuid", L"Safe display name"};
        idTokens.claims = ModdingFlowIdTokenClaims{
            true,
            "RS256",
            "https://moddingflow.com",
            {"desktop_mod_manager"},
            "account-uuid",
            {},
            now - std::chrono::seconds(5),
            now + std::chrono::minutes(15)
        };

        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();
        const ModdingFlowConnectStart start = service.beginConnect(
            "http://127.0.0.1:49154/oauth/fluxora/callback",
            L"operation-connect");
        idTokens.claims.nonce = queryValue(start.authorizationUrl, "nonce");
        (void)service.completeConnect(
            start.transactionId,
            ModdingFlowAuthorizationSuccess{
                "authorization-code",
                queryValue(start.authorizationUrl, "state"),
                "https://moddingflow.com"},
            L"operation-connect");
        credentials.reads.clear();
        oauth.refreshRequests.clear();

        const std::string token = service.getAccessToken(
            "agent:run",
            L"operation-managed-ai");

        EXPECT_EQ(token, "memory-only-access-token");
        EXPECT_TRUE(credentials.reads.empty());
        EXPECT_TRUE(oauth.refreshRequests.empty());
        ASSERT_EQ(credentials.writes.size(), 1U);
        EXPECT_EQ(credentials.writes.front().second, "credential-only-refresh-token");
    }

    TEST(ModdingFlowAuthServiceTests, ConcurrentRestoreSingleflightsRefreshAndCommitsRotationBeforeReady)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        ModdingFlowAuthServiceOptions options;
        options.clock = [now] { return now; };

        Logger logger;
        InMemoryCredentialStore credentials;
        credentials.secret = "stored-refresh-token";
        FakeModdingFlowOAuthClient oauth;
        oauth.refreshResponse = ModdingFlowTokenSet{
            "restored-access-token",
            "rotated-refresh-token",
            "transient-refresh-id-token",
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.profileResponse = ModdingFlowProfile{"restored-account-uuid", L"Restored account"};
        oauth.beforeRefresh = [] { std::this_thread::sleep_for(std::chrono::milliseconds(30)); };
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();

        std::vector<ModdingFlowAuthStatus> results(10);
        std::vector<std::thread> callers;
        callers.reserve(results.size());
        for (std::size_t index = 0; index < results.size(); ++index)
        {
            callers.emplace_back([&, index]
            {
                results[index] = service.restoreStoredSession(L"operation-restore");
            });
        }
        for (std::thread& caller : callers)
        {
            caller.join();
        }

        for (const ModdingFlowAuthStatus& result : results)
        {
            EXPECT_EQ(result.state, ModdingFlowAuthState::Ready);
            EXPECT_TRUE(result.hasStoredSession);
        }
        ASSERT_EQ(oauth.refreshRequests.size(), 1U);
        EXPECT_EQ(oauth.refreshRequests.front().clientId, "desktop_mod_manager");
        EXPECT_EQ(oauth.refreshRequests.front().refreshToken, "stored-refresh-token");
        expectBoundedAuthTransport(oauth.refreshRequests.front().transport);
        ASSERT_EQ(credentials.reads.size(), 1U);
        ASSERT_EQ(credentials.writes.size(), 1U);
        EXPECT_EQ(credentials.writes.front().second, "rotated-refresh-token");
        EXPECT_EQ(
            service.getAccessToken("files:download", L"operation-download"),
            "restored-access-token");
        ASSERT_EQ(oauth.profileRequests.size(), 1U);
        expectBoundedAuthTransport(oauth.profileRequests.front().transport);
    }

    TEST(ModdingFlowAuthServiceTests, ActiveTransactionIsTypedAlreadyInProgressUntilCancelled)
    {
        auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.clock = [&now] { return now; };
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 30));
        };

        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();
        const ModdingFlowConnectStart first = service.beginConnect(
            "http://127.0.0.1:49155/oauth/fluxora/callback",
            L"operation-connect");

        try
        {
            (void)service.beginConnect(
                "http://127.0.0.1:49156/oauth/fluxora/callback",
                L"operation-second-connect");
            FAIL() << "A second ModdingFlow connect should be rejected.";
        }
        catch (const ModdingFlowAuthException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowAuthErrorCode::AlreadyInProgress);
        }

        service.cancelConnect(first.transactionId, L"operation-cancel");
        EXPECT_EQ(service.status().state, ModdingFlowAuthState::NotLinked);
        const ModdingFlowConnectStart replacement = service.beginConnect(
            "http://127.0.0.1:49156/oauth/fluxora/callback",
            L"operation-second-connect");
        EXPECT_NE(replacement.transactionId, first.transactionId);
    }

    TEST(ModdingFlowAuthServiceTests, WrongStateConsumesTransactionBeforeAnyTokenRequest)
    {
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 40));
        };
        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();
        const ModdingFlowConnectStart start = service.beginConnect(
            "http://127.0.0.1:49157/oauth/fluxora/callback",
            L"operation-connect");

        try
        {
            (void)service.completeConnect(
                start.transactionId,
                ModdingFlowAuthorizationSuccess{
                    "authorization-code-secret",
                    "attacker-state-secret",
                    "https://moddingflow.com"},
                L"operation-connect");
            FAIL() << "A mismatched OAuth state should be rejected.";
        }
        catch (const ModdingFlowAuthException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowAuthErrorCode::SecurityFailure);
            EXPECT_EQ(std::string(exception.what()).find("authorization-code-secret"), std::string::npos);
            EXPECT_EQ(std::string(exception.what()).find("attacker-state-secret"), std::string::npos);
        }

        EXPECT_TRUE(oauth.authorizationRequests.empty());
        EXPECT_TRUE(credentials.writes.empty());
        EXPECT_EQ(service.status().state, ModdingFlowAuthState::NotLinked);
        EXPECT_THROW(
            (void)service.completeConnect(
                start.transactionId,
                ModdingFlowAuthorizationSuccess{
                    "another-code", "another-state", "https://moddingflow.com"},
                L"operation-connect"),
            ModdingFlowAuthException);
    }

    TEST(ModdingFlowAuthServiceTests, RejectsWrongSuccessIssuerAndMissingErrorIssuerBeforeHandling)
    {
        for (const bool errorCompletion : {false, true})
        {
            SCOPED_TRACE(errorCompletion ? "missing error issuer" : "wrong success issuer");
            std::size_t entropyCall = 0;
            ModdingFlowAuthServiceOptions options;
            options.entropy = [&entropyCall](std::size_t count)
            {
                ++entropyCall;
                return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 45));
            };
            Logger logger;
            InMemoryCredentialStore credentials;
            FakeModdingFlowOAuthClient oauth;
            FakeModdingFlowIdTokenVerifier idTokens;
            ModdingFlowAuthService service(
                logger,
                ModdingFlowConfiguration::production(),
                credentials,
                oauth,
                idTokens,
                std::move(options));
            service.initialize();
            const ModdingFlowConnectStart start = service.beginConnect(
                "http://127.0.0.1:49162/oauth/fluxora/callback",
                L"operation-issuer");
            const std::string state = queryValue(start.authorizationUrl, "state");
            ModdingFlowConnectCompletion completion = errorCompletion
                ? ModdingFlowConnectCompletion(ModdingFlowAuthorizationError{
                    "access_denied", "private error detail", state, {}})
                : ModdingFlowConnectCompletion(ModdingFlowAuthorizationSuccess{
                    "authorization-code", state, "https://evil.example"});

            try
            {
                (void)service.completeConnect(
                    start.transactionId,
                    std::move(completion),
                    L"operation-issuer");
                FAIL() << "OAuth response issuer binding was not enforced.";
            }
            catch (const ModdingFlowAuthException& exception)
            {
                EXPECT_EQ(exception.code(), ModdingFlowAuthErrorCode::SecurityFailure);
            }
            EXPECT_TRUE(oauth.authorizationRequests.empty());
            EXPECT_TRUE(credentials.writes.empty());
            EXPECT_EQ(service.status().state, ModdingFlowAuthState::NotLinked);
        }
    }

    TEST(ModdingFlowAuthServiceTests, UnsignedIdTokenIsRejectedBeforeProfileOrCredentialWrite)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.clock = [now] { return now; };
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 50));
        };
        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        oauth.authorizationResponse = ModdingFlowTokenSet{
            "access-token-secret",
            "refresh-token-secret",
            "unsigned-id-token-secret",
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        FakeModdingFlowIdTokenVerifier idTokens;
        idTokens.claims = ModdingFlowIdTokenClaims{
            true,
            "none",
            "https://moddingflow.com",
            {"desktop_mod_manager"},
            "account-uuid",
            {},
            now,
            now + std::chrono::minutes(15)
        };
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();
        const ModdingFlowConnectStart start = service.beginConnect(
            "http://127.0.0.1:49158/oauth/fluxora/callback",
            L"operation-connect");
        idTokens.claims.nonce = queryValue(start.authorizationUrl, "nonce");

        try
        {
            (void)service.completeConnect(
                start.transactionId,
                ModdingFlowAuthorizationSuccess{
                    "authorization-code-secret",
                    queryValue(start.authorizationUrl, "state"),
                    "https://moddingflow.com"},
                L"operation-connect");
            FAIL() << "An unsigned ID token should be rejected.";
        }
        catch (const ModdingFlowAuthException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowAuthErrorCode::SecurityFailure);
        }

        EXPECT_TRUE(oauth.profileRequests.empty());
        EXPECT_TRUE(credentials.writes.empty());
        EXPECT_EQ(service.status().state, ModdingFlowAuthState::NotLinked);
    }

    TEST(ModdingFlowAuthServiceTests, DefinitelyUnsentRefreshPreservesCredentialForLaterRetry)
    {
        Logger logger;
        InMemoryCredentialStore credentials;
        credentials.secret = "preserved-refresh-token";
        FakeModdingFlowOAuthClient oauth;
        oauth.refreshFailure = ModdingFlowOAuthFailureKind::RequestNotSent;
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens);
        service.initialize();

        const ModdingFlowAuthStatus failed = service.restoreStoredSession(L"operation-restore");

        EXPECT_EQ(failed.state, ModdingFlowAuthState::TemporarilyUnavailable);
        EXPECT_TRUE(failed.hasStoredSession);
        EXPECT_TRUE(failed.retryable);
        ASSERT_TRUE(credentials.secret.has_value());
        EXPECT_EQ(*credentials.secret, "preserved-refresh-token");
        EXPECT_TRUE(credentials.removes.empty());
        EXPECT_TRUE(credentials.writes.empty());

        oauth.refreshFailure.reset();
        oauth.refreshResponse = ModdingFlowTokenSet{
            "retried-access-token",
            "rotated-after-safe-retry",
            {},
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.profileResponse = ModdingFlowProfile{"retried-account-uuid", L"Retried account"};
        const ModdingFlowAuthStatus retried = service.restoreStoredSession(L"operation-retry");
        EXPECT_EQ(retried.state, ModdingFlowAuthState::Ready);
        ASSERT_EQ(oauth.refreshRequests.size(), 2U);
        ASSERT_EQ(credentials.writes.size(), 1U);
        EXPECT_EQ(credentials.writes.front().second, "rotated-after-safe-retry");
    }

    TEST(ModdingFlowAuthServiceTests, TemporaryRefreshPreservesCredentialAcrossRestartAndThenRotates)
    {
        Logger logger;
        InMemoryCredentialStore credentials;
        credentials.secret = "preserved-across-restart";

        {
            FakeModdingFlowOAuthClient unavailableOauth;
            unavailableOauth.refreshFailure = ModdingFlowOAuthFailureKind::Temporary;
            FakeModdingFlowIdTokenVerifier idTokens;
            ModdingFlowAuthService service(
                logger,
                ModdingFlowConfiguration::production(),
                credentials,
                unavailableOauth,
                idTokens);
            service.initialize();

            const ModdingFlowAuthStatus failed =
                service.restoreStoredSession(L"operation-before-restart");

            EXPECT_EQ(failed.state, ModdingFlowAuthState::TemporarilyUnavailable);
            EXPECT_TRUE(failed.hasStoredSession);
            EXPECT_TRUE(failed.retryable);
            ASSERT_TRUE(credentials.secret.has_value());
            EXPECT_EQ(*credentials.secret, "preserved-across-restart");
            EXPECT_TRUE(credentials.removes.empty());
            EXPECT_TRUE(credentials.writes.empty());
            service.shutdown();
        }

        FakeModdingFlowOAuthClient recoveredOauth;
        recoveredOauth.refreshResponse = ModdingFlowTokenSet{
            "access-after-restart",
            "rotated-after-restart",
            {},
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        recoveredOauth.profileResponse =
            ModdingFlowProfile{"restart-account-uuid", L"Restarted account"};
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService restartedService(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            recoveredOauth,
            idTokens);
        restartedService.initialize();

        const ModdingFlowAuthStatus restored =
            restartedService.restoreStoredSession(L"operation-after-restart");

        EXPECT_EQ(restored.state, ModdingFlowAuthState::Ready);
        EXPECT_EQ(restored.accountName, L"Restarted account");
        ASSERT_TRUE(credentials.secret.has_value());
        EXPECT_EQ(*credentials.secret, "rotated-after-restart");
        ASSERT_EQ(credentials.writes.size(), 1U);
        EXPECT_EQ(credentials.writes.front().second, "rotated-after-restart");
        EXPECT_TRUE(credentials.removes.empty());
    }

    TEST(ModdingFlowAuthServiceTests, TemporaryProfileFailureRetainsRotationAndRetriesProfileOnly)
    {
        Logger logger;
        InMemoryCredentialStore credentials;
        credentials.secret = "refresh-before-profile-failure";
        FakeModdingFlowOAuthClient oauth;
        oauth.refreshResponse = ModdingFlowTokenSet{
            "access-after-rotation",
            "refresh-after-rotation",
            {},
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.profileFailure = ModdingFlowOAuthFailureKind::RequestNotSent;
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens);
        service.initialize();

        const ModdingFlowAuthStatus failed = service.restoreStoredSession(L"operation-restore");

        EXPECT_EQ(failed.state, ModdingFlowAuthState::TemporarilyUnavailable);
        EXPECT_TRUE(failed.hasStoredSession);
        EXPECT_TRUE(failed.retryable);
        ASSERT_TRUE(credentials.secret.has_value());
        EXPECT_EQ(*credentials.secret, "refresh-after-rotation");
        ASSERT_EQ(credentials.writes.size(), 1U);
        ASSERT_EQ(oauth.refreshRequests.size(), 1U);
        ASSERT_EQ(oauth.profileRequests.size(), 1U);

        oauth.profileFailure.reset();
        oauth.profileResponse = ModdingFlowProfile{"profile-account-uuid", L"Profile account"};
        const ModdingFlowAuthStatus restored = service.restoreStoredSession(L"operation-profile-retry");

        EXPECT_EQ(restored.state, ModdingFlowAuthState::Ready);
        EXPECT_EQ(restored.accountName, L"Profile account");
        EXPECT_EQ(oauth.refreshRequests.size(), 1U);
        EXPECT_EQ(oauth.profileRequests.size(), 2U);
        EXPECT_EQ(credentials.writes.size(), 1U);
        EXPECT_EQ(
            service.getAccessToken("mods:read", L"operation-catalog"),
            "access-after-rotation");
    }

    TEST(ModdingFlowAuthServiceTests, AmbiguousRefreshDeletesAndSuppressesRotatingCredential)
    {
        Logger logger;
        InMemoryCredentialStore credentials;
        credentials.secret = "unsafe-old-refresh-token";
        FakeModdingFlowOAuthClient oauth;
        oauth.refreshFailure = ModdingFlowOAuthFailureKind::Ambiguous;
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens);
        service.initialize();

        const ModdingFlowAuthStatus failed = service.restoreStoredSession(L"operation-restore");

        EXPECT_EQ(failed.state, ModdingFlowAuthState::ReauthRequired);
        EXPECT_FALSE(failed.hasStoredSession);
        EXPECT_TRUE(failed.requiresUserAction);
        EXPECT_FALSE(credentials.secret.has_value());
        ASSERT_EQ(credentials.removes.size(), 1U);
        ASSERT_EQ(oauth.refreshRequests.size(), 1U);
        ASSERT_EQ(credentials.reads.size(), 1U);

        oauth.refreshFailure.reset();
        const ModdingFlowAuthStatus suppressed = service.restoreStoredSession(L"operation-retry");
        EXPECT_EQ(suppressed.state, ModdingFlowAuthState::ReauthRequired);
        EXPECT_EQ(oauth.refreshRequests.size(), 1U);
        EXPECT_EQ(credentials.reads.size(), 1U);
    }

    TEST(ModdingFlowAuthServiceTests, RefreshLeavesStatusResponsiveAndCannotCommitAfterDisconnect)
    {
        std::mutex gateMutex;
        std::condition_variable gateChanged;
        bool refreshEntered = false;
        bool releaseRefresh = false;
        Logger logger;
        InMemoryCredentialStore credentials;
        credentials.secret = "stored-refresh-before-disconnect";
        FakeModdingFlowOAuthClient oauth;
        oauth.refreshResponse = ModdingFlowTokenSet{
            "late-access-token",
            "late-rotated-refresh-token",
            {},
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.beforeRefresh = [&]
        {
            std::unique_lock gate(gateMutex);
            refreshEntered = true;
            gateChanged.notify_all();
            gateChanged.wait(gate, [&] { return releaseRefresh; });
        };
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens);
        service.initialize();
        ModdingFlowAuthStatus restoreResult;
        std::thread restore([&]
        {
            restoreResult = service.restoreStoredSession(L"operation-slow-restore");
        });
        bool enteredBeforeTimeout = false;
        {
            std::unique_lock gate(gateMutex);
            enteredBeforeTimeout = gateChanged.wait_for(gate, std::chrono::seconds(1), [&]
            {
                return refreshEntered;
            });
        }
        if (!enteredBeforeTimeout)
        {
            {
                std::lock_guard gate(gateMutex);
                releaseRefresh = true;
            }
            gateChanged.notify_all();
            restore.join();
            FAIL() << "Refresh did not enter the fake token endpoint.";
        }

        const auto statusStarted = std::chrono::steady_clock::now();
        const ModdingFlowAuthStatus whileRefreshing = service.status();
        const auto statusElapsed = std::chrono::steady_clock::now() - statusStarted;
        EXPECT_EQ(whileRefreshing.state, ModdingFlowAuthState::Restoring);
        EXPECT_LT(statusElapsed, std::chrono::milliseconds(50));

        const auto disconnectStarted = std::chrono::steady_clock::now();
        const ModdingFlowAuthStatus disconnected = service.disconnect(L"operation-disconnect");
        const auto disconnectElapsed = std::chrono::steady_clock::now() - disconnectStarted;
        EXPECT_EQ(disconnected.state, ModdingFlowAuthState::NotLinked);
        EXPECT_LT(disconnectElapsed, std::chrono::milliseconds(50));
        {
            std::lock_guard gate(gateMutex);
            releaseRefresh = true;
        }
        gateChanged.notify_all();
        restore.join();

        EXPECT_EQ(restoreResult.state, ModdingFlowAuthState::NotLinked);
        EXPECT_TRUE(credentials.writes.empty());
        EXPECT_FALSE(credentials.secret.has_value());
        ASSERT_EQ(oauth.refreshRequests.size(), 1U);
        expectBoundedAuthTransport(oauth.refreshRequests.front().transport);
        ASSERT_EQ(oauth.revokeRequests.size(), 3U);
        EXPECT_EQ(oauth.revokeRequests[1].token, "late-rotated-refresh-token");
        EXPECT_EQ(oauth.revokeRequests[1].tokenTypeHint, "refresh_token");
        EXPECT_EQ(oauth.revokeRequests[1].operationId, L"operation-slow-restore");
        EXPECT_EQ(oauth.revokeRequests[2].token, "late-access-token");
        EXPECT_EQ(oauth.revokeRequests[2].tokenTypeHint, "access_token");
        EXPECT_EQ(oauth.revokeRequests[2].operationId, L"operation-slow-restore");
    }

    TEST(ModdingFlowAuthServiceTests, DisconnectWinsAgainstLateAuthorizationCompletion)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        std::mutex gateMutex;
        std::condition_variable gateChanged;
        bool profileEntered = false;
        bool releaseProfile = false;
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.clock = [now] { return now; };
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 90));
        };
        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        oauth.authorizationResponse = ModdingFlowTokenSet{
            "late-completion-access-token",
            "late-completion-refresh-token",
            "late-completion-id-token",
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.profileResponse = ModdingFlowProfile{"account-uuid", L"Safe display name"};
        oauth.beforeProfile = [&]
        {
            std::unique_lock gate(gateMutex);
            profileEntered = true;
            gateChanged.notify_all();
            gateChanged.wait(gate, [&] { return releaseProfile; });
        };
        FakeModdingFlowIdTokenVerifier idTokens;
        idTokens.claims = ModdingFlowIdTokenClaims{
            true,
            "RS256",
            "https://moddingflow.com",
            {"desktop_mod_manager"},
            "account-uuid",
            {},
            now,
            now + std::chrono::minutes(15)
        };
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();
        const ModdingFlowConnectStart start = service.beginConnect(
            "http://127.0.0.1:49161/oauth/fluxora/callback",
            L"operation-connect");
        idTokens.claims.nonce = queryValue(start.authorizationUrl, "nonce");
        std::optional<ModdingFlowAuthErrorCode> completionError;
        std::thread completion([&]
        {
            try
            {
                (void)service.completeConnect(
                    start.transactionId,
                    ModdingFlowAuthorizationSuccess{
                        "authorization-code",
                        queryValue(start.authorizationUrl, "state"),
                        "https://moddingflow.com"},
                    L"operation-connect");
            }
            catch (const ModdingFlowAuthException& exception)
            {
                completionError = exception.code();
            }
        });
        bool enteredBeforeTimeout = false;
        {
            std::unique_lock gate(gateMutex);
            enteredBeforeTimeout = gateChanged.wait_for(gate, std::chrono::seconds(1), [&]
            {
                return profileEntered;
            });
        }
        if (!enteredBeforeTimeout)
        {
            {
                std::lock_guard gate(gateMutex);
                releaseProfile = true;
            }
            gateChanged.notify_all();
            completion.join();
            FAIL() << "Completion did not reach the blocked profile request.";
        }

        const ModdingFlowAuthStatus disconnected = service.disconnect(L"operation-disconnect");
        EXPECT_EQ(disconnected.state, ModdingFlowAuthState::NotLinked);
        {
            std::lock_guard gate(gateMutex);
            releaseProfile = true;
        }
        gateChanged.notify_all();
        completion.join();

        ASSERT_TRUE(completionError.has_value());
        EXPECT_EQ(*completionError, ModdingFlowAuthErrorCode::InvalidTransaction);
        EXPECT_EQ(service.status().state, ModdingFlowAuthState::NotLinked);
        EXPECT_TRUE(credentials.writes.empty());
        EXPECT_FALSE(credentials.secret.has_value());
        ASSERT_EQ(oauth.revokeRequests.size(), 2U);
        EXPECT_EQ(oauth.revokeRequests[0].tokenTypeHint, "refresh_token");
        EXPECT_EQ(oauth.revokeRequests[1].tokenTypeHint, "access_token");
    }

    TEST(ModdingFlowAuthServiceTests, DisconnectClearsMemoryAndCredentialWhenRevocationFails)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.clock = [now] { return now; };
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 60));
        };
        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        oauth.authorizationResponse = ModdingFlowTokenSet{
            "access-token-to-revoke",
            "refresh-token-to-revoke",
            "id-token-to-discard",
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.profileResponse = ModdingFlowProfile{"account-uuid", L"Safe display name"};
        FakeModdingFlowIdTokenVerifier idTokens;
        idTokens.claims = ModdingFlowIdTokenClaims{
            true,
            "RS256",
            "https://moddingflow.com",
            {"desktop_mod_manager"},
            "account-uuid",
            {},
            now,
            now + std::chrono::minutes(15)
        };
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();
        const ModdingFlowConnectStart start = service.beginConnect(
            "http://127.0.0.1:49159/oauth/fluxora/callback",
            L"operation-connect");
        idTokens.claims.nonce = queryValue(start.authorizationUrl, "nonce");
        (void)service.completeConnect(
            start.transactionId,
            ModdingFlowAuthorizationSuccess{
                "authorization-code",
                queryValue(start.authorizationUrl, "state"),
                "https://moddingflow.com"},
            L"operation-connect");
        oauth.revokeFailure = true;

        const ModdingFlowAuthStatus disconnected = service.disconnect(L"operation-disconnect");

        EXPECT_EQ(disconnected.state, ModdingFlowAuthState::NotLinked);
        EXPECT_FALSE(disconnected.hasStoredSession);
        EXPECT_FALSE(credentials.secret.has_value());
        ASSERT_EQ(credentials.removes.size(), 1U);
        ASSERT_EQ(oauth.revokeRequests.size(), 2U);
        EXPECT_EQ(oauth.revokeRequests[0].token, "refresh-token-to-revoke");
        EXPECT_EQ(oauth.revokeRequests[0].tokenTypeHint, "refresh_token");
        EXPECT_EQ(oauth.revokeRequests[1].token, "access-token-to-revoke");
        EXPECT_EQ(oauth.revokeRequests[1].tokenTypeHint, "access_token");
        expectBoundedAuthTransport(oauth.revokeRequests[0].transport);
        expectBoundedAuthTransport(oauth.revokeRequests[1].transport);
        EXPECT_THROW(
            (void)service.getAccessToken("mods:read", L"operation-after-disconnect"),
            ModdingFlowAuthException);
    }

    TEST(ModdingFlowAuthServiceTests, DisconnectClearsLocalStateBeforeSlowBestEffortRevocation)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        std::size_t entropyCall = 0;
        ModdingFlowAuthServiceOptions options;
        options.clock = [now] { return now; };
        options.entropy = [&entropyCall](std::size_t count)
        {
            ++entropyCall;
            return std::vector<unsigned char>(count, static_cast<unsigned char>(entropyCall + 70));
        };
        Logger logger;
        InMemoryCredentialStore credentials;
        FakeModdingFlowOAuthClient oauth;
        oauth.authorizationResponse = ModdingFlowTokenSet{
            "access-token-to-revoke",
            "refresh-token-to-revoke",
            "id-token-to-discard",
            "Bearer",
            std::chrono::minutes(15),
            {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
        };
        oauth.profileResponse = ModdingFlowProfile{"account-uuid", L"Safe display name"};
        FakeModdingFlowIdTokenVerifier idTokens;
        idTokens.claims = ModdingFlowIdTokenClaims{
            true,
            "RS256",
            "https://moddingflow.com",
            {"desktop_mod_manager"},
            "account-uuid",
            {},
            now,
            now + std::chrono::minutes(15)
        };
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens,
            std::move(options));
        service.initialize();
        const ModdingFlowConnectStart start = service.beginConnect(
            "http://127.0.0.1:49159/oauth/fluxora/callback",
            L"operation-connect");
        idTokens.claims.nonce = queryValue(start.authorizationUrl, "nonce");
        (void)service.completeConnect(
            start.transactionId,
            ModdingFlowAuthorizationSuccess{
                "authorization-code",
                queryValue(start.authorizationUrl, "state"),
                "https://moddingflow.com"},
            L"operation-connect");

        std::mutex gateMutex;
        std::condition_variable gateChanged;
        bool revokeEntered = false;
        bool releaseRevoke = false;
        oauth.beforeRevoke = [&]
        {
            std::unique_lock gate(gateMutex);
            revokeEntered = true;
            gateChanged.notify_all();
            gateChanged.wait(gate, [&] { return releaseRevoke; });
        };

        ModdingFlowAuthStatus disconnectResult;
        std::thread disconnect([&]
        {
            disconnectResult = service.disconnect(L"operation-disconnect");
        });
        {
            std::unique_lock gate(gateMutex);
            ASSERT_TRUE(gateChanged.wait_for(gate, std::chrono::seconds(1), [&]
            {
                return revokeEntered;
            }));
        }

        EXPECT_FALSE(credentials.secret.has_value());
        auto statusFuture = std::async(std::launch::async, [&] { return service.status(); });
        const bool statusResponsive =
            statusFuture.wait_for(std::chrono::milliseconds(50)) == std::future_status::ready;
        {
            std::lock_guard gate(gateMutex);
            releaseRevoke = true;
        }
        gateChanged.notify_all();
        disconnect.join();
        EXPECT_TRUE(statusResponsive);
        if (statusResponsive)
        {
            EXPECT_EQ(statusFuture.get().state, ModdingFlowAuthState::NotLinked);
        }
        else
        {
            (void)statusFuture.get();
        }
        EXPECT_EQ(disconnectResult.state, ModdingFlowAuthState::NotLinked);
        EXPECT_FALSE(credentials.secret.has_value());
        ASSERT_EQ(oauth.revokeRequests.size(), 2U);
    }

    TEST(ModdingFlowAuthServiceTests, OperationsLogKeepsOperationIdAndRedactsSensitiveOAuthMaterial)
    {
        TempDirectory temp;
        const std::filesystem::path logDirectory = temp.path() / L"oauth-logs";
        ScopedEnvironmentVariable configuredLogDirectory(L"FLUXORA_LOG_DIR", logDirectory.wstring());
        Logger logger;
        logger.initialize();
        InMemoryCredentialStore credentials;
        credentials.secret = "refresh-token-log-secret";
        FakeModdingFlowOAuthClient oauth;
        oauth.refreshFailure = ModdingFlowOAuthFailureKind::Ambiguous;
        oauth.refreshFailureMessage =
            "access-token-log-secret id-token-log-secret state-log-secret nonce-log-secret "
            "https://storage.example/file?signature=signed-url-log-secret";
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens);
        service.initialize();

        const ModdingFlowAuthStatus result = service.restoreStoredSession(L"operation-redaction-gate");
        EXPECT_EQ(result.state, ModdingFlowAuthState::ReauthRequired);
        service.shutdown();
        const std::filesystem::path operationsLogPath = logger.operationsLogPath();
        logger.shutdown();

        const std::string log = readTextFile(operationsLogPath);
        EXPECT_NE(log.find("OAuth refresh requires account reconnection."), std::string::npos);
        EXPECT_NE(log.find("op=operation-redaction-gate"), std::string::npos);
        for (const std::string_view forbidden : {
                 "refresh-token-log-secret",
                 "access-token-log-secret",
                 "id-token-log-secret",
                 "state-log-secret",
                 "nonce-log-secret",
                 "signed-url-log-secret"})
        {
            EXPECT_EQ(log.find(forbidden), std::string::npos) << forbidden;
        }
    }

    TEST(ModdingFlowAuthServiceTests, TemporaryRefreshLogsOnlySafeCorrelationMetadata)
    {
        TempDirectory temp;
        const std::filesystem::path logDirectory = temp.path() / L"oauth-correlation-logs";
        ScopedEnvironmentVariable configuredLogDirectory(L"FLUXORA_LOG_DIR", logDirectory.wstring());
        Logger logger;
        logger.initialize();
        InMemoryCredentialStore credentials;
        credentials.secret = "refresh-token-correlation-secret";
        FakeModdingFlowOAuthClient oauth;
        oauth.refreshFailure = ModdingFlowOAuthFailureKind::Temporary;
        oauth.refreshFailureMessage = "raw-response-body-secret";
        oauth.refreshFailureMetadata = {
            "oauth_refresh_rotation_unavailable",
            "request-oauth-readiness",
            "trace-oauth-readiness"};
        FakeModdingFlowIdTokenVerifier idTokens;
        ModdingFlowAuthService service(
            logger,
            ModdingFlowConfiguration::production(),
            credentials,
            oauth,
            idTokens);
        service.initialize();

        const ModdingFlowAuthStatus result =
            service.restoreStoredSession(L"operation-oauth-readiness");
        EXPECT_EQ(result.state, ModdingFlowAuthState::TemporarilyUnavailable);
        ASSERT_TRUE(credentials.secret.has_value());
        EXPECT_EQ(*credentials.secret, "refresh-token-correlation-secret");
        service.shutdown();
        const std::filesystem::path operationsLogPath = logger.operationsLogPath();
        logger.shutdown();

        const std::string log = readTextFile(operationsLogPath);
        EXPECT_NE(log.find("op=operation-oauth-readiness"), std::string::npos);
        EXPECT_NE(log.find("category=temporary"), std::string::npos);
        EXPECT_NE(
            log.find("machineCode=oauth_refresh_rotation_unavailable"),
            std::string::npos);
        EXPECT_NE(log.find("requestId=request-oauth-readiness"), std::string::npos);
        EXPECT_NE(log.find("traceId=trace-oauth-readiness"), std::string::npos);
        EXPECT_EQ(log.find("refresh-token-correlation-secret"), std::string::npos);
        EXPECT_EQ(log.find("raw-response-body-secret"), std::string::npos);
    }

    TEST(ModdingFlowAuthServiceTests, RejectsEveryRequiredOidcClaimAndProfileSubjectMismatch)
    {
        const auto now = std::chrono::system_clock::time_point(std::chrono::seconds(1'800'000'000));
        struct InvalidCase
        {
            const char* name;
            std::function<void(
                ModdingFlowIdTokenClaims&,
                ModdingFlowProfile&,
                std::string_view)> mutate;
            bool reachesProfile;
        };
        const std::vector<InvalidCase> cases{
            {"signature", [](auto& claims, auto&, std::string_view) { claims.signatureValid = false; }, false},
            {"algorithm", [](auto& claims, auto&, std::string_view) { claims.algorithm = "none"; }, false},
            {"issuer", [](auto& claims, auto&, std::string_view) { claims.issuer = "https://evil.example"; }, false},
            {"audience", [](auto& claims, auto&, std::string_view) { claims.audience = {"other-client"}; }, false},
            {"nonce", [](auto& claims, auto&, std::string_view) { claims.nonce = "wrong-nonce"; }, false},
            {"issued-at", [now](auto& claims, auto&, std::string_view)
                { claims.issuedAt = now + std::chrono::seconds(61); }, false},
            {"expiry", [now](auto& claims, auto&, std::string_view)
                { claims.expiresAt = now - std::chrono::seconds(61); }, false},
            {"subject", [](auto&, auto& profile, std::string_view)
                { profile.userId = "different-account-uuid"; }, true}
        };

        for (std::size_t index = 0; index < cases.size(); ++index)
        {
            SCOPED_TRACE(cases[index].name);
            std::size_t entropyCall = 0;
            ModdingFlowAuthServiceOptions options;
            options.clock = [now] { return now; };
            options.entropy = [&entropyCall, index](std::size_t count)
            {
                ++entropyCall;
                return std::vector<unsigned char>(
                    count,
                    static_cast<unsigned char>(entropyCall + 70 + index));
            };
            Logger logger;
            InMemoryCredentialStore credentials;
            FakeModdingFlowOAuthClient oauth;
            oauth.authorizationResponse = ModdingFlowTokenSet{
                "access-token-secret",
                "refresh-token-secret",
                "id-token-secret",
                "Bearer",
                std::chrono::minutes(15),
                {"openid", "profile:read", "mods:read", "files:download", "install_plans:resolve", "agent:run"}
            };
            oauth.profileResponse = ModdingFlowProfile{"account-uuid", L"Safe display name"};
            FakeModdingFlowIdTokenVerifier idTokens;
            idTokens.claims = ModdingFlowIdTokenClaims{
                true,
                "RS256",
                "https://moddingflow.com",
                {"desktop_mod_manager"},
                "account-uuid",
                {},
                now,
                now + std::chrono::minutes(15)
            };
            ModdingFlowAuthService service(
                logger,
                ModdingFlowConfiguration::production(),
                credentials,
                oauth,
                idTokens,
                std::move(options));
            service.initialize();
            const ModdingFlowConnectStart start = service.beginConnect(
                "http://127.0.0.1:49160/oauth/fluxora/callback",
                L"operation-claims");
            const std::string nonce = queryValue(start.authorizationUrl, "nonce");
            idTokens.claims.nonce = nonce;
            cases[index].mutate(idTokens.claims, oauth.profileResponse, nonce);

            try
            {
                (void)service.completeConnect(
                    start.transactionId,
                    ModdingFlowAuthorizationSuccess{
                        "authorization-code",
                        queryValue(start.authorizationUrl, "state"),
                        "https://moddingflow.com"},
                    L"operation-claims");
                FAIL() << "Invalid OIDC/profile identity was accepted.";
            }
            catch (const ModdingFlowAuthException& exception)
            {
                EXPECT_EQ(exception.code(), ModdingFlowAuthErrorCode::SecurityFailure);
            }
            EXPECT_EQ(oauth.profileRequests.size(), cases[index].reachesProfile ? 1U : 0U);
            EXPECT_TRUE(credentials.writes.empty());
            EXPECT_EQ(service.status().state, ModdingFlowAuthState::NotLinked);
        }
    }
}
