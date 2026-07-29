#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace fluxora
{
    class ModOrganizerVersionCodec final
    {
    public:
        [[nodiscard]] static std::optional<std::wstring> decodeDecimalCanonicalVersion(
            std::wstring_view storedVersion)
        {
            if (storedVersion.size() < 4 || storedVersion.front() != L'f')
            {
                return std::nullopt;
            }

            std::size_t index = 1;
            while (index < storedVersion.size() &&
                   storedVersion[index] >= L'0' &&
                   storedVersion[index] <= L'9')
            {
                ++index;
            }
            if (index == 1 || index >= storedVersion.size() || storedVersion[index] != L'.')
            {
                return std::nullopt;
            }

            const std::size_t fractionalStart = ++index;
            while (index < storedVersion.size() &&
                   storedVersion[index] >= L'0' &&
                   storedVersion[index] <= L'9')
            {
                ++index;
            }
            if (index == fractionalStart)
            {
                return std::nullopt;
            }

            return std::wstring(storedVersion.substr(1));
        }
    };
}
