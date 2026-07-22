#pragma once

#include <string>
#include <string_view>

namespace fluxora
{
    enum class InverseTextMergeConflict
    {
        None,
        OverlappingEdit,
        Ambiguous
    };

    struct InverseTextMergeResult
    {
        std::wstring content;
        InverseTextMergeConflict conflict{InverseTextMergeConflict::None};
        bool preservedNewerChanges{false};

        [[nodiscard]] bool succeeded() const noexcept
        {
            return conflict == InverseTextMergeConflict::None;
        }
    };

    class InverseTextMergeService final
    {
    public:
        [[nodiscard]] InverseTextMergeResult merge(
            std::wstring_view base,
            std::wstring_view ours,
            std::wstring_view theirs) const;
    };
}
