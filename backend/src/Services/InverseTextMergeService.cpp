#include "FluxoraCore/Services/InverseTextMergeService.hpp"

#include <algorithm>
#include <cstddef>
#include <optional>
#include <vector>

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumLcsCells = 4'000'000;

        struct MergeHunk
        {
            std::size_t start{0};
            std::size_t end{0};
            std::vector<std::wstring> replacement;
        };

        [[nodiscard]] std::vector<std::wstring> splitLineTokens(std::wstring_view text)
        {
            std::vector<std::wstring> lines;
            std::size_t offset = 0;
            while (offset < text.size())
            {
                const std::size_t newline = text.find(L'\n', offset);
                const std::size_t end = newline == std::wstring_view::npos
                    ? text.size()
                    : newline + 1;
                lines.emplace_back(text.substr(offset, end - offset));
                offset = end;
            }
            return lines;
        }

        [[nodiscard]] std::optional<std::vector<MergeHunk>> diffHunks(
            const std::vector<std::wstring>& base,
            const std::vector<std::wstring>& changed)
        {
            std::size_t prefix = 0;
            while (prefix < base.size() && prefix < changed.size() &&
                base[prefix] == changed[prefix])
            {
                ++prefix;
            }

            std::size_t baseSuffix = base.size();
            std::size_t changedSuffix = changed.size();
            while (baseSuffix > prefix && changedSuffix > prefix &&
                base[baseSuffix - 1] == changed[changedSuffix - 1])
            {
                --baseSuffix;
                --changedSuffix;
            }

            const std::size_t baseCount = baseSuffix - prefix;
            const std::size_t changedCount = changedSuffix - prefix;
            if (baseCount == 0 && changedCount == 0)
            {
                return std::vector<MergeHunk>{};
            }
            if (baseCount != 0 && changedCount > maximumLcsCells / baseCount)
            {
                return std::nullopt;
            }

            const std::size_t columns = changedCount + 1;
            std::vector<std::size_t> lcs((baseCount + 1) * columns, 0);
            const auto cell = [columns, &lcs](std::size_t row, std::size_t column) -> std::size_t&
            {
                return lcs[row * columns + column];
            };
            for (std::size_t row = baseCount; row-- > 0;)
            {
                for (std::size_t column = changedCount; column-- > 0;)
                {
                    cell(row, column) = base[prefix + row] == changed[prefix + column]
                        ? cell(row + 1, column + 1) + 1
                        : (std::max)(cell(row + 1, column), cell(row, column + 1));
                }
            }

            std::vector<MergeHunk> hunks;
            std::size_t row = 0;
            std::size_t column = 0;
            std::optional<MergeHunk> active;
            const auto beginHunk = [&]
            {
                if (!active.has_value())
                {
                    active = MergeHunk{prefix + row, prefix + row, {}};
                }
            };
            const auto flush = [&]
            {
                if (active.has_value())
                {
                    hunks.push_back(std::move(*active));
                    active.reset();
                }
            };

            while (row < baseCount || column < changedCount)
            {
                if (row < baseCount && column < changedCount &&
                    base[prefix + row] == changed[prefix + column])
                {
                    flush();
                    ++row;
                    ++column;
                }
                else if (column < changedCount &&
                    (row == baseCount || cell(row, column + 1) >= cell(row + 1, column)))
                {
                    beginHunk();
                    active->replacement.push_back(changed[prefix + column]);
                    ++column;
                }
                else
                {
                    beginHunk();
                    ++row;
                    active->end = prefix + row;
                }
            }
            flush();
            return hunks;
        }

        [[nodiscard]] bool sameHunk(const MergeHunk& left, const MergeHunk& right)
        {
            return left.start == right.start && left.end == right.end &&
                left.replacement == right.replacement;
        }

        [[nodiscard]] bool overlaps(const MergeHunk& left, const MergeHunk& right)
        {
            const bool leftInsertion = left.start == left.end;
            const bool rightInsertion = right.start == right.end;
            if (leftInsertion && rightInsertion)
            {
                return left.start == right.start;
            }
            if (leftInsertion)
            {
                return left.start > right.start && left.start < right.end;
            }
            if (rightInsertion)
            {
                return right.start > left.start && right.start < left.end;
            }
            return (std::max)(left.start, right.start) < (std::min)(left.end, right.end);
        }

        [[nodiscard]] std::wstring applyHunks(
            const std::vector<std::wstring>& base,
            std::vector<MergeHunk> hunks)
        {
            std::stable_sort(hunks.begin(), hunks.end(), [](const MergeHunk& left, const MergeHunk& right)
            {
                if (left.start != right.start)
                {
                    return left.start < right.start;
                }
                return left.end < right.end;
            });

            std::wstring merged;
            std::size_t cursor = 0;
            for (const MergeHunk& hunk : hunks)
            {
                for (; cursor < hunk.start; ++cursor)
                {
                    merged += base[cursor];
                }
                for (const std::wstring& line : hunk.replacement)
                {
                    merged += line;
                }
                cursor = (std::max)(cursor, hunk.end);
            }
            for (; cursor < base.size(); ++cursor)
            {
                merged += base[cursor];
            }
            return merged;
        }
    }

    InverseTextMergeResult InverseTextMergeService::merge(
        std::wstring_view base,
        std::wstring_view ours,
        std::wstring_view theirs) const
    {
        if (ours == base)
        {
            return {std::wstring(theirs), InverseTextMergeConflict::None, false};
        }
        if (theirs == base)
        {
            return {std::wstring(ours), InverseTextMergeConflict::None, true};
        }

        const std::vector<std::wstring> baseLines = splitLineTokens(base);
        const auto oursHunks = diffHunks(baseLines, splitLineTokens(ours));
        const auto theirsHunks = diffHunks(baseLines, splitLineTokens(theirs));
        if (!oursHunks.has_value() || !theirsHunks.has_value())
        {
            return {{}, InverseTextMergeConflict::Ambiguous, false};
        }

        std::vector<MergeHunk> combined = *oursHunks;
        for (const MergeHunk& theirsHunk : *theirsHunks)
        {
            bool duplicate = false;
            for (const MergeHunk& oursHunk : *oursHunks)
            {
                if (sameHunk(oursHunk, theirsHunk))
                {
                    duplicate = true;
                    break;
                }
                if (overlaps(oursHunk, theirsHunk))
                {
                    return {{}, InverseTextMergeConflict::OverlappingEdit, false};
                }
            }
            if (!duplicate)
            {
                combined.push_back(theirsHunk);
            }
        }

        return {
            applyHunks(baseLines, std::move(combined)),
            InverseTextMergeConflict::None,
            true
        };
    }
}
