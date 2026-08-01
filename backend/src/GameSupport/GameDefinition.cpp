#include "FluxoraCore/GameSupport/GameDefinition.hpp"

#include <algorithm>
#include <set>
#include <stdexcept>

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumExternalProviders = 16U;
        constexpr std::size_t maximumProviderIdLength = 64U;
        constexpr std::size_t maximumSlugsPerProvider = 32U;
        constexpr std::size_t maximumGameSlugLength = 80U;

        [[nodiscard]] bool isAsciiLowerAlphaNumeric(wchar_t character) noexcept
        {
            return (character >= L'a' && character <= L'z') ||
                (character >= L'0' && character <= L'9');
        }
    }

    bool isCanonicalExternalProviderId(std::wstring_view value) noexcept
    {
        if (value.empty() || value.size() > maximumProviderIdLength ||
            !isAsciiLowerAlphaNumeric(value.front()) ||
            !isAsciiLowerAlphaNumeric(value.back()))
        {
            return false;
        }

        return std::all_of(value.begin(), value.end(), [](wchar_t character)
        {
            return isAsciiLowerAlphaNumeric(character) ||
                character == L'.' || character == L'_' || character == L'-';
        });
    }

    bool isCanonicalExternalGameSlug(std::wstring_view value) noexcept
    {
        if (value.size() < 2U || value.size() > maximumGameSlugLength ||
            !isAsciiLowerAlphaNumeric(value.front()) ||
            !isAsciiLowerAlphaNumeric(value.back()))
        {
            return false;
        }

        return std::all_of(value.begin(), value.end(), [](wchar_t character)
        {
            return isAsciiLowerAlphaNumeric(character) || character == L'-';
        });
    }

    void validateExternalProviderGameSlugs(
        const ExternalProviderGameSlugMap& mappings)
    {
        if (mappings.size() > maximumExternalProviders)
        {
            throw std::invalid_argument(
                "External provider game-slug mapping has too many providers.");
        }

        for (const auto& [providerId, gameSlugs] : mappings)
        {
            if (!isCanonicalExternalProviderId(providerId) || gameSlugs.empty() ||
                gameSlugs.size() > maximumSlugsPerProvider)
            {
                throw std::invalid_argument(
                    "External provider game-slug mapping is not canonical.");
            }

            std::set<std::wstring> unique;
            for (const std::wstring& gameSlug : gameSlugs)
            {
                if (!isCanonicalExternalGameSlug(gameSlug) ||
                    !unique.insert(gameSlug).second)
                {
                    throw std::invalid_argument(
                        "External provider game-slug allowlist is not canonical.");
                }
            }
        }
    }
}
