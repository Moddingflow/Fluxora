#pragma once

#include <string>
#include <string_view>

namespace fluxora
{
    class ModdingFlowConfiguration final
    {
    public:
        [[nodiscard]] static ModdingFlowConfiguration production();

        [[nodiscard]] std::string_view clientId() const noexcept;
        [[nodiscard]] std::string_view issuer() const noexcept;
        [[nodiscard]] std::string_view apiBaseUrl() const noexcept;
        [[nodiscard]] std::string_view authorizationEndpoint() const noexcept;
        [[nodiscard]] std::string_view tokenEndpoint() const noexcept;
        [[nodiscard]] std::string_view revocationEndpoint() const noexcept;
        [[nodiscard]] std::string_view jwksUri() const noexcept;
        [[nodiscard]] std::string_view scope() const noexcept;
        [[nodiscard]] const std::wstring& refreshCredentialTarget() const noexcept;
        [[nodiscard]] const std::wstring& userAgent() const noexcept;

        void validateRedirectUri(std::string_view redirectUri) const;

    private:
        ModdingFlowConfiguration();

        std::string clientId_;
        std::wstring refreshCredentialTarget_;
        std::wstring userAgent_;
    };
}
