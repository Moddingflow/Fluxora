#pragma once

#include "FluxoraCore/Services/ModdingFlowApiResponse.hpp"
#include "FluxoraCore/Services/ModdingFlowConfiguration.hpp"
#include "FluxoraCore/Services/ModdingFlowHttpTransport.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace fluxora
{
    inline constexpr std::string_view moddingFlowPublicApiOrigin =
        "https://moddingflow.com/v1";

    enum class ModdingFlowApiAuthMode
    {
        Anonymous,
        BearerRequired
    };

    enum class ModdingFlowApiRetryMode
    {
        Never,
        ReadOnly,
        Idempotent
    };

    enum class ModdingFlowApiErrorCode
    {
        InvalidRequest,
        Unauthorized,
        Forbidden,
        NotFound,
        IdempotencyMismatch,
        IdempotencyInProgress,
        IdempotencyReplayUnavailable,
        RateLimited,
        ServerFailure,
        Timeout,
        TransportFailure,
        SecurityFailure,
        ProtocolFailure
    };

    class ModdingFlowApiException final : public std::runtime_error
    {
    public:
        ModdingFlowApiException(
            ModdingFlowApiErrorCode code,
            std::string message,
            std::wstring operationId,
            std::uint16_t statusCode = 0,
            std::optional<ModdingFlowProblemDetails> problem = std::nullopt,
            std::optional<std::chrono::seconds> retryAfter = std::nullopt);

        [[nodiscard]] ModdingFlowApiErrorCode code() const noexcept;
        [[nodiscard]] std::uint16_t statusCode() const noexcept;
        [[nodiscard]] const std::wstring& operationId() const noexcept;
        [[nodiscard]] const std::optional<ModdingFlowProblemDetails>& problem() const noexcept;
        [[nodiscard]] std::optional<std::chrono::seconds> retryAfter() const noexcept;

    private:
        ModdingFlowApiErrorCode code_;
        std::uint16_t statusCode_;
        std::wstring operationId_;
        std::optional<ModdingFlowProblemDetails> problem_;
        std::optional<std::chrono::seconds> retryAfter_;
    };

    class IModdingFlowAccessTokenProvider
    {
    public:
        virtual ~IModdingFlowAccessTokenProvider() = default;
        [[nodiscard]] virtual std::string getAccessToken(
            std::string_view requiredScope,
            std::wstring_view operationId,
            bool forceRefresh) = 0;
    };

    class ModdingFlowAuthAccessTokenProvider final : public IModdingFlowAccessTokenProvider
    {
    public:
        explicit ModdingFlowAuthAccessTokenProvider(ModdingFlowAuthService& authService) noexcept;

        [[nodiscard]] std::string getAccessToken(
            std::string_view requiredScope,
            std::wstring_view operationId,
            bool forceRefresh) override;

    private:
        ModdingFlowAuthService& authService_;
    };

    struct ModdingFlowPublicApiRequest
    {
        ModdingFlowHttpMethod method{ModdingFlowHttpMethod::Get};
        std::string pathAndQuery;
        std::string body;
        ModdingFlowApiAuthMode auth{ModdingFlowApiAuthMode::Anonymous};
        std::string requiredScope;
        ModdingFlowApiRetryMode retry{ModdingFlowApiRetryMode::Never};
        std::string idempotencyKey;
        std::wstring operationId;
        std::size_t maximumResponseBytes{512U * 1024U};
    };

    struct ModdingFlowPublicApiResponse
    {
        JsonValue body{JsonValue::null()};
        std::wstring operationId;
        std::string requestId;
    };

    struct ModdingFlowPublicApiClientOptions
    {
        std::size_t maximumAttempts{3U};
        std::chrono::seconds maximumRetryAfter{std::chrono::seconds(30)};
        std::function<void(std::chrono::milliseconds)> sleep;
        ModdingFlowHttpPolicy transport;
        ModdingFlowJsonLimits jsonLimits{
            .maximumBytes = 512U * 1024U,
            .maximumDepth = 24U,
            .maximumValues = 20'000U,
            .maximumStringCodeUnits = 64U * 1024U};
    };

    class IModdingFlowPublicApiClient
    {
    public:
        virtual ~IModdingFlowPublicApiClient() = default;
        [[nodiscard]] virtual ModdingFlowPublicApiResponse execute(
            const ModdingFlowPublicApiRequest& request) = 0;
    };

    class ModdingFlowPublicApiClient final : public IModdingFlowPublicApiClient
    {
    public:
        ModdingFlowPublicApiClient(
            IModdingFlowHttpTransport& transport,
            IModdingFlowAccessTokenProvider* accessTokens = nullptr,
            ModdingFlowPublicApiClientOptions options = {});

        [[nodiscard]] ModdingFlowPublicApiResponse execute(
            const ModdingFlowPublicApiRequest& request) override;

    private:
        IModdingFlowHttpTransport& transport_;
        IModdingFlowAccessTokenProvider* accessTokens_;
        ModdingFlowPublicApiClientOptions options_;
    };
}
