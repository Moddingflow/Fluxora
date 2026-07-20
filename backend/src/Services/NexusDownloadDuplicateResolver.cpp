#include "FluxoraCore/Services/NexusDownloadDuplicateResolver.hpp"

#include "FluxoraCore/Services/NexusFileLineageResolver.hpp"

#include <algorithm>
#include <cwctype>

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
                return sameFile;
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
