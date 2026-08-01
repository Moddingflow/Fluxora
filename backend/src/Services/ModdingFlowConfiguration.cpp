#include "FluxoraCore/Services/ModdingFlowConfiguration.hpp"

#include <algorithm>
#include <charconv>
#include <cctype>
#include <stdexcept>

#ifndef FLUXORA_PRODUCT_VERSION
#define FLUXORA_PRODUCT_VERSION "0.0.0"
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::string_view productionIssuer = "https://moddingflow.com";
        constexpr std::string_view productionApiBaseUrl = "https://moddingflow.com/v1";
        constexpr std::string_view productionAuthorizationEndpoint =
            "https://moddingflow.com/oauth/authorize";
        constexpr std::string_view productionTokenEndpoint = "https://moddingflow.com/oauth/token";
        constexpr std::string_view productionRevocationEndpoint = "https://moddingflow.com/oauth/revoke";
        constexpr std::string_view productionJwksUri = "https://moddingflow.com/.well-known/jwks.json";
        constexpr std::string_view productionRequiredScope =
            "openid profile:read mods:read files:download install_plans:resolve agent:run";
        constexpr std::string_view productionClientId = "desktop_mod_manager";
        constexpr std::string_view redirectPrefix = "http://127.0.0.1:";
        constexpr std::string_view redirectSuffix = "/oauth/fluxora/callback";
        constexpr std::string_view productVersion = FLUXORA_PRODUCT_VERSION;

        bool isSafeClientIdCharacter(unsigned char character) noexcept
        {
            return std::isalnum(character) != 0 ||
                character == '_' || character == '-' || character == '.' || character == '~';
        }

        std::wstring widenAscii(std::string_view value)
        {
            return std::wstring(value.begin(), value.end());
        }
    }

    ModdingFlowConfiguration ModdingFlowConfiguration::production()
    {
        return ModdingFlowConfiguration();
    }

    ModdingFlowConfiguration::ModdingFlowConfiguration()
        : clientId_(productionClientId)
    {
        if (clientId_.empty() || clientId_.size() > 128 ||
            !std::all_of(clientId_.begin(), clientId_.end(), [](unsigned char character)
            {
                return isSafeClientIdCharacter(character);
            }))
        {
            throw std::invalid_argument("ModdingFlow public client id is invalid.");
        }

        refreshCredentialTarget_ =
            L"Fluxora/OAuth/production/moddingflow/" + widenAscii(clientId_) + L"/refresh-token";
        if (productVersion.empty() || productVersion.size() > 64U ||
            !std::all_of(productVersion.begin(), productVersion.end(), [](unsigned char character)
            {
                return std::isdigit(character) != 0 || character == '.';
            }))
        {
            throw std::invalid_argument("Fluxora product version is invalid.");
        }
        userAgent_ = L"Fluxora/" + widenAscii(productVersion) + L" ModdingFlow";
    }

    std::string_view ModdingFlowConfiguration::clientId() const noexcept { return clientId_; }
    std::string_view ModdingFlowConfiguration::issuer() const noexcept { return productionIssuer; }
    std::string_view ModdingFlowConfiguration::apiBaseUrl() const noexcept
    {
        return productionApiBaseUrl;
    }
    std::string_view ModdingFlowConfiguration::authorizationEndpoint() const noexcept
    {
        return productionAuthorizationEndpoint;
    }
    std::string_view ModdingFlowConfiguration::tokenEndpoint() const noexcept
    {
        return productionTokenEndpoint;
    }
    std::string_view ModdingFlowConfiguration::revocationEndpoint() const noexcept
    {
        return productionRevocationEndpoint;
    }
    std::string_view ModdingFlowConfiguration::jwksUri() const noexcept { return productionJwksUri; }
    std::string_view ModdingFlowConfiguration::scope() const noexcept
    {
        return productionRequiredScope;
    }
    const std::wstring& ModdingFlowConfiguration::refreshCredentialTarget() const noexcept
    {
        return refreshCredentialTarget_;
    }
    const std::wstring& ModdingFlowConfiguration::userAgent() const noexcept
    {
        return userAgent_;
    }

    void ModdingFlowConfiguration::validateRedirectUri(std::string_view redirectUri) const
    {
        if (!redirectUri.starts_with(redirectPrefix) || !redirectUri.ends_with(redirectSuffix))
        {
            throw std::invalid_argument("ModdingFlow redirect URI must use the exact loopback callback.");
        }

        const std::size_t portStart = redirectPrefix.size();
        const std::size_t portLength = redirectUri.size() - redirectPrefix.size() - redirectSuffix.size();
        const std::string_view portText = redirectUri.substr(portStart, portLength);
        if (portText.empty() || (portText.size() > 1 && portText.front() == '0'))
        {
            throw std::invalid_argument("ModdingFlow redirect URI requires a dynamic nonzero port.");
        }

        unsigned int port = 0;
        const auto [end, error] = std::from_chars(portText.data(), portText.data() + portText.size(), port);
        if (error != std::errc{} || end != portText.data() + portText.size() || port == 0 || port > 65535)
        {
            throw std::invalid_argument("ModdingFlow redirect URI port is invalid.");
        }
    }
}
