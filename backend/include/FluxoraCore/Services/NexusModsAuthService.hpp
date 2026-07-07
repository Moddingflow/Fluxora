#pragma once

#include "FluxoraCore/Services/IService.hpp"

#include <string>
#include <vector>

namespace fluxora
{
    class AppSettingsService;
    class Logger;

    struct ApiRateLimitWindow
    {
        std::wstring id;
        std::wstring label;
        std::wstring period;
        long long limit{-1};
        long long remaining{-1};
        std::wstring resetAtUtc;
        std::wstring resetRaw;
    };

    struct ApiLimitProvider
    {
        std::wstring id;
        std::wstring label;
        std::wstring state;
        std::wstring message;
        std::wstring updatedAtUtc;
        std::vector<ApiRateLimitWindow> windows;
    };

    struct ApiLimitStatus
    {
        std::wstring generatedAtUtc;
        std::vector<ApiLimitProvider> providers;
    };

    struct NexusModsAuthStatus
    {
        bool isConfigured{false};
        bool isLinked{false};
        bool hasApiKey{false};
        std::wstring displayName;
        std::wstring userId;
        std::wstring message;
        std::wstring clientId;
        std::wstring redirectUri;
    };

    struct NexusModsApiAuthHeader
    {
        bool isAvailable{false};
        std::wstring headerName;
        std::wstring headerValue;
        std::wstring credentialKind;
        std::wstring message;
    };

    class NexusModsAuthService final : public IService
    {
    public:
        NexusModsAuthService(Logger& logger, AppSettingsService& settings) noexcept;

        void initialize() override;
        void shutdown() override;

        [[nodiscard]] NexusModsAuthStatus status() const;
        [[nodiscard]] NexusModsApiAuthHeader apiAuthHeader();
        [[nodiscard]] ApiLimitStatus apiLimits();
        NexusModsAuthStatus connect();
        NexusModsAuthStatus connectWithApiKey(std::wstring_view apiKey);
        NexusModsAuthStatus disconnect();

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        Logger& logger_;
        AppSettingsService& settings_;
        bool initialized_{false};
    };
}
