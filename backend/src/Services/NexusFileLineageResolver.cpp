#include "FluxoraCore/Services/NexusFileLineageResolver.hpp"

#include <algorithm>
#include <deque>

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
    }

    NexusFileLineageResolver::NexusFileLineageResolver(
        const std::vector<NexusFileUpdateLink>& updates)
    {
        for (const NexusFileUpdateLink& update : updates)
        {
            const std::wstring oldFileId = trim(update.oldFileId);
            const std::wstring newFileId = trim(update.newFileId);
            if (oldFileId.empty() || newFileId.empty())
            {
                continue;
            }
            successors_[oldFileId].insert(newFileId);
            predecessors_[newFileId].insert(oldFileId);
        }
    }

    NexusFileLineageResolution NexusFileLineageResolver::componentFor(
        std::wstring_view fileId) const
    {
        const std::wstring start = trim(std::wstring(fileId));
        if (start.empty())
        {
            return {};
        }

        std::set<std::wstring> component;
        std::deque<std::wstring> pending{start};
        while (!pending.empty())
        {
            std::wstring current = std::move(pending.front());
            pending.pop_front();
            if (!component.insert(current).second)
            {
                continue;
            }

            if (const auto successors = successors_.find(current); successors != successors_.end())
            {
                pending.insert(pending.end(), successors->second.begin(), successors->second.end());
            }
            if (const auto predecessors = predecessors_.find(current); predecessors != predecessors_.end())
            {
                pending.insert(pending.end(), predecessors->second.begin(), predecessors->second.end());
            }
        }

        std::wstring head;
        for (const std::wstring& current : component)
        {
            const auto successors = successors_.find(current);
            const auto predecessors = predecessors_.find(current);
            const std::size_t successorCount = successors == successors_.end()
                ? 0
                : successors->second.size();
            const std::size_t predecessorCount = predecessors == predecessors_.end()
                ? 0
                : predecessors->second.size();
            if (successorCount > 1 || predecessorCount > 1)
            {
                return {};
            }
            if (predecessorCount == 0)
            {
                if (!head.empty())
                {
                    return {};
                }
                head = current;
            }
        }
        if (head.empty())
        {
            return {};
        }

        NexusFileLineageResolution resolution;
        std::set<std::wstring> visited;
        for (std::wstring current = head; !current.empty();)
        {
            if (!visited.insert(current).second)
            {
                return {};
            }
            resolution.fileIds.push_back(current);
            const auto successors = successors_.find(current);
            current = successors == successors_.end() || successors->second.empty()
                ? std::wstring{}
                : *successors->second.begin();
        }
        if (resolution.fileIds.size() != component.size())
        {
            return {};
        }
        resolution.kind = resolution.fileIds.size() == 1
            ? NexusFileLineageKind::SameFile
            : NexusFileLineageKind::SameLineage;
        return resolution;
    }

    NexusFileLineageResolution NexusFileLineageResolver::resolve(
        std::wstring_view leftFileId,
        std::wstring_view rightFileId) const
    {
        const std::wstring left = trim(std::wstring(leftFileId));
        const std::wstring right = trim(std::wstring(rightFileId));
        if (left.empty() || right.empty())
        {
            return {};
        }
        if (left == right)
        {
            return {NexusFileLineageKind::SameFile, {left}};
        }

        NexusFileLineageResolution resolution = componentFor(left);
        if (resolution.kind == NexusFileLineageKind::UnprovenOrDifferentBranch ||
            std::find(resolution.fileIds.begin(), resolution.fileIds.end(), right) ==
                resolution.fileIds.end())
        {
            return {};
        }
        resolution.kind = NexusFileLineageKind::SameLineage;
        return resolution;
    }

    NexusFileLineageResolution NexusFileLineageResolver::forwardFrom(
        std::wstring_view fileId) const
    {
        const std::wstring start = trim(std::wstring(fileId));
        NexusFileLineageResolution resolution = componentFor(start);
        if (resolution.kind == NexusFileLineageKind::UnprovenOrDifferentBranch)
        {
            return resolution;
        }
        const auto first = std::find(resolution.fileIds.begin(), resolution.fileIds.end(), start);
        if (first == resolution.fileIds.end())
        {
            return {};
        }
        resolution.fileIds.erase(resolution.fileIds.begin(), first);
        resolution.kind = resolution.fileIds.size() == 1
            ? NexusFileLineageKind::SameFile
            : NexusFileLineageKind::SameLineage;
        return resolution;
    }
}
