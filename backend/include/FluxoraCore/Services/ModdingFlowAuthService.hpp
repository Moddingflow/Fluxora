#pragma once

#include "FluxoraCore/Services/IService.hpp"
#include "FluxoraCore/Services/ModdingFlowConfiguration.hpp"

#include <chrono>
#include <cstddef>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace fluxora
{
    class ISecureCredentialStore;
    class Logger;

    enum class ModdingFlowAuthState
    {
        NotLinked,
        Connecting,
        Restoring,
        Ready,
        TemporarilyUnavailable,
        ReauthRequired
    };

    struct ModdingFlowAuthStatus
    {
        ModdingFlowAuthState state{ModdingFlowAuthState::NotLinked};
        std::wstring accountName;
        bool hasStoredSession{false};
        bool retryable{false};
        bool requiresUserAction{false};
    };

    enum class ModdingFlowAuthErrorCode
    {
        NotInitialized,
        AlreadyInProgress,
        InvalidTransaction,
        TransactionExpired,
        InvalidCallback,
        SecurityFailure,
        MissingScope,
        NotLinked,
        TemporarilyUnavailable,
        ReauthRequired
    };

    class ModdingFlowAuthException final : public std::runtime_error
    {
    public:
        ModdingFlowAuthException(ModdingFlowAuthErrorCode code, std::string message);
        [[nodiscard]] ModdingFlowAuthErrorCode code() const noexcept;

    private:
        ModdingFlowAuthErrorCode code_;
    };

    enum class ModdingFlowOAuthFailureKind
    {
        RequestNotSent,
        Ambiguous,
        InvalidGrant,
        Temporary,
        Protocol,
        Security
    };

    struct ModdingFlowOAuthFailureMetadata
    {
        std::string machineCode;
        std::string requestId;
        std::string traceId;
    };

    class ModdingFlowOAuthException final : public std::runtime_error
    {
    public:
        ModdingFlowOAuthException(
            ModdingFlowOAuthFailureKind kind,
            std::string message,
            ModdingFlowOAuthFailureMetadata metadata = {});
        [[nodiscard]] ModdingFlowOAuthFailureKind kind() const noexcept;
        [[nodiscard]] const ModdingFlowOAuthFailureMetadata& metadata() const noexcept;

    private:
        ModdingFlowOAuthFailureKind kind_;
        ModdingFlowOAuthFailureMetadata metadata_;
    };

    struct ModdingFlowTokenSet
    {
        std::string accessToken;
        std::string refreshToken;
        std::string idToken;
        std::string tokenType{"Bearer"};
        std::chrono::seconds expiresIn{0};
        std::vector<std::string> grantedScopes;
    };

    enum class ModdingFlowRedirectPolicy
    {
        Reject
    };

    struct ModdingFlowHttpTimeouts
    {
        std::chrono::milliseconds resolve{std::chrono::seconds(5)};
        std::chrono::milliseconds connect{std::chrono::seconds(15)};
        std::chrono::milliseconds send{std::chrono::seconds(15)};
        std::chrono::milliseconds receive{std::chrono::seconds(15)};
        std::chrono::milliseconds overall{std::chrono::seconds(15)};
    };

    struct ModdingFlowHttpPolicy
    {
        ModdingFlowHttpTimeouts timeouts;
        ModdingFlowRedirectPolicy redirects{ModdingFlowRedirectPolicy::Reject};
    };

    struct ModdingFlowAuthorizationCodeRequest
    {
        std::string tokenEndpoint;
        std::string clientId;
        std::string redirectUri;
        std::string authorizationCode;
        std::string codeVerifier;
        std::wstring operationId;
        ModdingFlowHttpPolicy transport;
    };

    struct ModdingFlowRefreshRequest
    {
        std::string tokenEndpoint;
        std::string clientId;
        std::string refreshToken;
        std::wstring operationId;
        ModdingFlowHttpPolicy transport;
    };

    struct ModdingFlowProfileRequest
    {
        std::string apiBaseUrl;
        std::string accessToken;
        std::wstring operationId;
        ModdingFlowHttpPolicy transport;
    };

    struct ModdingFlowProfile
    {
        std::string userId;
        std::wstring displayName;
    };

    struct ModdingFlowRevokeRequest
    {
        std::string revocationEndpoint;
        std::string clientId;
        std::string token;
        std::string tokenTypeHint;
        std::wstring operationId;
        ModdingFlowHttpPolicy transport;
    };

    class IModdingFlowOAuthClient
    {
    public:
        virtual ~IModdingFlowOAuthClient() = default;
        [[nodiscard]] virtual ModdingFlowTokenSet exchangeAuthorizationCode(
            const ModdingFlowAuthorizationCodeRequest& request) = 0;
        [[nodiscard]] virtual ModdingFlowTokenSet refreshAccessToken(
            const ModdingFlowRefreshRequest& request) = 0;
        [[nodiscard]] virtual ModdingFlowProfile fetchCurrentProfile(
            const ModdingFlowProfileRequest& request) = 0;
        virtual void revokeToken(const ModdingFlowRevokeRequest& request) = 0;
    };

    struct ModdingFlowIdTokenVerificationRequest
    {
        std::string idToken;
        std::string jwksUri;
        bool forceJwksRefreshOnceForUnknownKey{true};
        ModdingFlowHttpPolicy transport;
        std::wstring operationId;
    };

    struct ModdingFlowIdTokenClaims
    {
        bool signatureValid{false};
        std::string algorithm;
        std::string issuer;
        std::vector<std::string> audience;
        std::string subject;
        std::string nonce;
        std::chrono::system_clock::time_point issuedAt;
        std::chrono::system_clock::time_point expiresAt;
    };

    class IModdingFlowIdTokenVerifier
    {
    public:
        virtual ~IModdingFlowIdTokenVerifier() = default;
        [[nodiscard]] virtual ModdingFlowIdTokenClaims verifySignatureAndDecode(
            const ModdingFlowIdTokenVerificationRequest& request) = 0;
    };

    struct ModdingFlowConnectStart
    {
        std::string transactionId;
        std::string authorizationUrl;
        std::chrono::system_clock::time_point expiresAt;
    };

    struct ModdingFlowAuthorizationSuccess
    {
        std::string authorizationCode;
        std::string state;
        std::string issuer;
    };

    struct ModdingFlowAuthorizationError
    {
        std::string oauthError;
        std::string errorDescription;
        std::string state;
        std::string issuer;
    };

    using ModdingFlowConnectCompletion = std::variant<
        ModdingFlowAuthorizationSuccess,
        ModdingFlowAuthorizationError>;

    struct ModdingFlowAuthServiceOptions
    {
        std::function<std::chrono::system_clock::time_point()> clock;
        std::function<std::vector<unsigned char>(std::size_t)> entropy;
    };

    class ModdingFlowAuthService final : public IService
    {
    public:
        ModdingFlowAuthService(
            Logger& logger,
            ModdingFlowConfiguration configuration,
            ISecureCredentialStore& credentials,
            IModdingFlowOAuthClient& oauthClient,
            IModdingFlowIdTokenVerifier& idTokenVerifier,
            ModdingFlowAuthServiceOptions options = {});
        ~ModdingFlowAuthService() override;

        ModdingFlowAuthService(const ModdingFlowAuthService&) = delete;
        ModdingFlowAuthService& operator=(const ModdingFlowAuthService&) = delete;

        void initialize() override;
        void shutdown() override;
        void discoverStoredSessionForRestore(std::wstring_view operationId) noexcept;

        [[nodiscard]] ModdingFlowConnectStart beginConnect(
            std::string_view redirectUri,
            std::wstring_view operationId);
        [[nodiscard]] ModdingFlowAuthStatus completeConnect(
            std::string_view transactionId,
            ModdingFlowConnectCompletion completion,
            std::wstring_view operationId);
        void cancelConnect(std::string_view transactionId, std::wstring_view operationId);

        [[nodiscard]] ModdingFlowAuthStatus restoreStoredSession(std::wstring_view operationId);
        [[nodiscard]] std::string getAccessToken(
            std::string_view requiredScope,
            std::wstring_view operationId,
            bool forceRefresh = false);
        [[nodiscard]] ModdingFlowAuthStatus disconnect(std::wstring_view operationId);
        [[nodiscard]] ModdingFlowAuthStatus status() const;
        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        struct State;
        std::unique_ptr<State> state_;
    };
}
