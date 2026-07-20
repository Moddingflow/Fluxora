#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    struct ConfigRecipeConflict
    {
        std::wstring semanticKey;
        std::wstring encodedValue;
    };

    struct ConfigRecipeInspection
    {
        bool matched{false};
        std::wstring recipeId;
        std::wstring format;
        std::wstring targetPointer;
        std::wstring currentValue;
        std::wstring encodedValue;
        std::vector<ConfigRecipeConflict> conflicts;
        bool needsInput{false};
        std::wstring question;
    };

    class ConfigRecipeRegistry final
    {
    public:
        [[nodiscard]] ConfigRecipeInspection inspect(
            std::wstring_view relativePath,
            std::wstring_view document,
            std::wstring_view targetPointer,
            std::wstring_view requestedValue) const;
    };
}
