#include "FluxoraCore/Services/NexusDownloadDuplicateResolver.hpp"

#include "FluxoraCore/Services/NexusFileLineageResolver.hpp"

#include <algorithm>
#include <cwctype>
#include <optional>

namespace fluxora
{
    namespace
    {
        std::wstring trim(std::wstring value)
        {
            const auto first = value.find_first_not_of(L" \t\r\n");
            if (first == std::wstring::npos)
            {
                return {};
            }
            const auto last = value.find_last_not_of(L" \t\r\n");
            return value.substr(first, last - first + 1);
        }

        std::wstring normalizedGameDomain(std::wstring value)
        {
            value = trim(std::move(value));
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        bool sameModPair(
            const NexusDownloadFileVersion& left,
            const NexusDownloadFileVersion& right)
        {
            return !trim(left.modId).empty() &&
                normalizedGameDomain(left.gameDomain) == normalizedGameDomain(right.gameDomain) &&
                trim(left.modId) == trim(right.modId);
        }

        std::wstring normalizedArchiveFamilyName(std::wstring value)
        {
            value = trim(std::move(value));
            const std::size_t separator = value.find_last_of(L"/\\");
            const std::size_t extension = value.find_last_of(L'.');
            if (extension != std::wstring::npos &&
                (separator == std::wstring::npos || extension > separator))
            {
                value.erase(extension);
            }

            if (!value.empty() && value.back() == L')')
            {
                const std::size_t opening = value.find_last_of(L'(');
                if (opening != std::wstring::npos && opening > 0)
                {
                    const std::wstring suffix = value.substr(opening + 1, value.size() - opening - 2);
                    if (!suffix.empty() && std::all_of(suffix.begin(), suffix.end(), [](wchar_t character)
                        {
                            return std::iswdigit(character) != 0;
                        }))
                    {
                        value.erase(opening);
                    }
                }
            }

            value = trim(std::move(value));
            std::wstring normalized;
            normalized.reserve(value.size());
            bool previousWhitespace = false;
            for (wchar_t character : value)
            {
                if (std::iswspace(character) != 0)
                {
                    if (!normalized.empty() && !previousWhitespace)
                    {
                        normalized.push_back(L' ');
                    }
                    previousWhitespace = true;
                    continue;
                }
                previousWhitespace = false;
                normalized.push_back(static_cast<wchar_t>(std::towlower(character)));
            }
            return trim(std::move(normalized));
        }

        std::vector<std::wstring> numericVersionParts(std::wstring_view value)
        {
            std::vector<std::wstring> parts;
            std::size_t index = 0;
            while (index < value.size())
            {
                if (std::iswdigit(value[index]) == 0)
                {
                    ++index;
                    continue;
                }

                const std::size_t start = index;
                while (index < value.size() && std::iswdigit(value[index]) != 0)
                {
                    ++index;
                }
                std::wstring part(value.substr(start, index - start));
                const std::size_t significant = part.find_first_not_of(L'0');
                parts.push_back(significant == std::wstring::npos ? L"0" : part.substr(significant));
            }
            return parts;
        }

        std::optional<int> compareVersions(std::wstring_view left, std::wstring_view right)
        {
            const std::vector<std::wstring> leftParts = numericVersionParts(left);
            const std::vector<std::wstring> rightParts = numericVersionParts(right);
            if (leftParts.empty() || rightParts.empty())
            {
                return std::nullopt;
            }

            const std::size_t count = std::max(leftParts.size(), rightParts.size());
            for (std::size_t index = 0; index < count; ++index)
            {
                const std::wstring leftPart = index < leftParts.size() ? leftParts[index] : L"0";
                const std::wstring rightPart = index < rightParts.size() ? rightParts[index] : L"0";
                if (leftPart.size() != rightPart.size())
                {
                    return leftPart.size() < rightPart.size() ? -1 : 1;
                }
                if (leftPart != rightPart)
                {
                    return leftPart < rightPart ? -1 : 1;
                }
            }
            return 0;
        }

        NexusDownloadDuplicateResolution resolveExactNamedVersionFamily(
            const NexusDownloadFileVersion& incoming,
            const std::vector<NexusDownloadFileVersion>& existingFiles)
        {
            const std::wstring incomingFamily = normalizedArchiveFamilyName(incoming.fileName);
            if (incomingFamily.empty() || trim(incoming.version).empty())
            {
                return {};
            }

            NexusDownloadDuplicateResolution resolution;
            bool hasOlder = false;
            bool hasNewer = false;
            bool hasSameVersion = false;
            for (const NexusDownloadFileVersion& existing : existingFiles)
            {
                if (!sameModPair(incoming, existing) ||
                    trim(existing.version).empty() ||
                    normalizedArchiveFamilyName(existing.fileName) != incomingFamily)
                {
                    continue;
                }

                const std::optional<int> comparison = compareVersions(existing.version, incoming.version);
                if (!comparison.has_value())
                {
                    continue;
                }
                hasOlder = hasOlder || *comparison < 0;
                hasNewer = hasNewer || *comparison > 0;
                hasSameVersion = hasSameVersion || *comparison == 0;
                resolution.existingFiles.push_back(existing);
                resolution.lineageFileIds.push_back(trim(existing.fileId));
            }

            if (resolution.existingFiles.empty())
            {
                return {};
            }

            resolution.lineageFileIds.push_back(trim(incoming.fileId));
            std::sort(resolution.lineageFileIds.begin(), resolution.lineageFileIds.end());
            resolution.lineageFileIds.erase(
                std::unique(resolution.lineageFileIds.begin(), resolution.lineageFileIds.end()),
                resolution.lineageFileIds.end());
            resolution.kind = (hasOlder && hasNewer) || hasSameVersion
                ? NexusDownloadDuplicateKind::Mixed
                : hasNewer
                    ? NexusDownloadDuplicateKind::Downgrade
                    : NexusDownloadDuplicateKind::Upgrade;
            return resolution;
        }
    }

    NexusDownloadDuplicateResolution NexusDownloadDuplicateResolver::resolve(
        const NexusDownloadFileVersion& incoming,
        const std::vector<NexusDownloadFileVersion>& existingFiles,
        const std::vector<NexusFileUpdateLink>& updates) const
    {
        const std::wstring incomingFileId = trim(incoming.fileId);
        if (normalizedGameDomain(incoming.gameDomain).empty() ||
            trim(incoming.modId).empty() ||
            incomingFileId.empty())
        {
            return {};
        }

        for (const NexusDownloadFileVersion& existing : existingFiles)
        {
            if (sameModPair(incoming, existing) && trim(existing.fileId) == incomingFileId)
            {
                NexusDownloadDuplicateResolution sameFile;
                sameFile.kind = NexusDownloadDuplicateKind::SameFile;
                sameFile.sameFile = existing;
                sameFile.existingFiles.push_back(existing);
                sameFile.lineageFileIds.push_back(incomingFileId);
                return sameFile;
            }
        }

        if (updates.empty())
        {
            NexusDownloadDuplicateResolution inferred = resolveExactNamedVersionFamily(
                incoming,
                existingFiles);
            if (inferred.kind != NexusDownloadDuplicateKind::None)
            {
                return inferred;
            }
        }

        const NexusFileLineageResolver lineageResolver(updates);
        NexusDownloadDuplicateResolution resolution;
        bool hasOlder = false;
        bool hasNewer = false;
        for (const NexusDownloadFileVersion& existing : existingFiles)
        {
            if (!sameModPair(incoming, existing))
            {
                continue;
            }

            NexusFileLineageResolution lineage = lineageResolver.resolve(
                incomingFileId,
                trim(existing.fileId));
            if (lineage.kind != NexusFileLineageKind::SameLineage)
            {
                continue;
            }

            const auto incomingPosition = std::find(
                lineage.fileIds.begin(),
                lineage.fileIds.end(),
                incomingFileId);
            const auto existingPosition = std::find(
                lineage.fileIds.begin(),
                lineage.fileIds.end(),
                trim(existing.fileId));
            if (incomingPosition == lineage.fileIds.end() || existingPosition == lineage.fileIds.end())
            {
                continue;
            }

            hasOlder = hasOlder || existingPosition < incomingPosition;
            hasNewer = hasNewer || existingPosition > incomingPosition;
            resolution.existingFiles.push_back(existing);
            if (resolution.lineageFileIds.empty())
            {
                resolution.lineageFileIds = std::move(lineage.fileIds);
            }
        }

        if (resolution.existingFiles.empty())
        {
            return {};
        }

        const auto lineagePosition = [&resolution](std::wstring_view fileId)
        {
            return std::find(
                resolution.lineageFileIds.begin(),
                resolution.lineageFileIds.end(),
                fileId);
        };
        std::stable_sort(
            resolution.existingFiles.begin(),
            resolution.existingFiles.end(),
            [&](const auto& left, const auto& right)
            {
                return lineagePosition(left.fileId) < lineagePosition(right.fileId);
            });

        resolution.kind = hasOlder && hasNewer
            ? NexusDownloadDuplicateKind::Mixed
            : hasNewer
                ? NexusDownloadDuplicateKind::Downgrade
                : NexusDownloadDuplicateKind::Upgrade;
        return resolution;
    }
}
