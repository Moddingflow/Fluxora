#include "FluxoraCore/Services/InstallConflictPreviewService.hpp"

#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <algorithm>
#include <cwctype>
#include <map>
#include <set>
#include <stdexcept>
#include <utility>

namespace fluxora
{
    namespace
    {
        struct RowSummary
        {
            int fileCount{0};
            int conflictingFileCount{0};
            int overwrittenFileCount{0};
            int overwritingFileCount{0};
            std::vector<std::wstring> overwritesModIds;
            std::vector<std::wstring> overwrittenByModIds;

            [[nodiscard]] bool operator==(const RowSummary&) const = default;
        };

        struct WorkingRow
        {
            InstallConflictProfileMod row;
            std::set<std::wstring> fileKeys;
        };

        void appendUnique(std::vector<std::wstring>& values, const std::wstring& value)
        {
            if (!value.empty() && std::find(values.begin(), values.end(), value) == values.end())
            {
                values.push_back(value);
            }
        }

        std::set<std::wstring> fileKeys(const std::vector<InstallConflictFile>& files)
        {
            std::set<std::wstring> keys;
            for (const InstallConflictFile& file : files)
            {
                const std::wstring key = InstallConflictPreviewService::normalizedPathKey(
                    file.relativePath);
                if (!key.empty())
                {
                    keys.insert(key);
                }
            }
            return keys;
        }

        std::vector<WorkingRow> workingRows(
            const std::vector<InstallConflictProfileMod>& profileRows)
        {
            std::vector<WorkingRow> result;
            result.reserve(profileRows.size());
            for (const InstallConflictProfileMod& row : profileRows)
            {
                result.push_back(WorkingRow{row, row.separator ? std::set<std::wstring>{} : fileKeys(row.files)});
            }
            return result;
        }

        std::map<std::wstring, RowSummary> summarize(const std::vector<WorkingRow>& rows)
        {
            std::map<std::wstring, RowSummary> summaries;
            std::map<std::wstring, std::vector<const WorkingRow*>> ownersByPath;

            for (const WorkingRow& row : rows)
            {
                if (row.row.separator)
                {
                    continue;
                }
                RowSummary& summary = summaries[row.row.orderId];
                summary.fileCount = static_cast<int>(row.fileKeys.size());
                if (!row.row.enabled)
                {
                    continue;
                }
                for (const std::wstring& key : row.fileKeys)
                {
                    ownersByPath[key].push_back(&row);
                }
            }

            for (const auto& [path, owners] : ownersByPath)
            {
                static_cast<void>(path);
                if (owners.size() <= 1)
                {
                    continue;
                }

                for (std::size_t index = 0; index < owners.size(); ++index)
                {
                    RowSummary& summary = summaries[owners[index]->row.orderId];
                    ++summary.conflictingFileCount;
                    if (index == 0)
                    {
                        ++summary.overwrittenFileCount;
                    }
                    else if (index == owners.size() - 1)
                    {
                        ++summary.overwritingFileCount;
                    }
                    else
                    {
                        ++summary.overwrittenFileCount;
                        ++summary.overwritingFileCount;
                    }

                    for (std::size_t other = 0; other < index; ++other)
                    {
                        appendUnique(
                            summary.overwritesModIds,
                            owners[other]->row.relationId);
                    }
                    for (std::size_t other = index + 1; other < owners.size(); ++other)
                    {
                        appendUnique(
                            summary.overwrittenByModIds,
                            owners[other]->row.relationId);
                    }
                }
            }

            return summaries;
        }

        std::size_t clampedTargetIndex(int targetIndex, std::size_t rowCount)
        {
            if (targetIndex < 0)
            {
                return rowCount;
            }
            return std::min(static_cast<std::size_t>(targetIndex), rowCount);
        }

        InstallConflictRowPatch makePatch(
            const WorkingRow& row,
            const RowSummary& summary)
        {
            return InstallConflictRowPatch{
                row.row.orderId,
                row.row.modUuid,
                summary.fileCount,
                summary.conflictingFileCount,
                summary.overwrittenFileCount,
                summary.overwritingFileCount,
                summary.overwritesModIds,
                summary.overwrittenByModIds
            };
        }

        WorkingRow applyProjection(
            std::vector<WorkingRow>& projected,
            const InstallConflictPreviewRequest& request)
        {
            const auto target = std::find_if(
                projected.begin(),
                projected.end(),
                [&request](const WorkingRow& row)
                {
                    return !row.row.separator &&
                        !request.targetModUuid.empty() &&
                        row.row.modUuid == request.targetModUuid;
                });

            WorkingRow installed;
            if (request.mode != InstallConflictPreviewMode::Install)
            {
                if (target == projected.end())
                {
                    throw std::invalid_argument(
                        "Replace or merge conflict preview requires a profile target mod.");
                }
                installed = *target;
                const std::size_t originalTargetIndex = static_cast<std::size_t>(
                    std::distance(projected.begin(), target));
                projected.erase(target);
                installed.fileKeys = fileKeys(request.incomingFiles);
                if (request.mode == InstallConflictPreviewMode::Merge)
                {
                    const auto oldFiles = fileKeys(installed.row.files);
                    installed.fileKeys.insert(oldFiles.begin(), oldFiles.end());
                }
                installed.row.files.clear();
                const std::size_t insertionIndex = request.targetIndex < 0
                    ? std::min(originalTargetIndex, projected.size())
                    : clampedTargetIndex(request.targetIndex, projected.size());
                projected.insert(
                    projected.begin() + static_cast<std::ptrdiff_t>(insertionIndex),
                    installed);
                return installed;
            }

            installed.row.orderId = request.pendingOrderId;
            installed.row.relationId = request.pendingOrderId;
            installed.row.enabled = true;
            installed.fileKeys = fileKeys(request.incomingFiles);
            const std::size_t insertionIndex = clampedTargetIndex(
                request.targetIndex,
                projected.size());
            projected.insert(
                projected.begin() + static_cast<std::ptrdiff_t>(insertionIndex),
                installed);
            return installed;
        }

        InstallConflictSnapshotState snapshotState(std::wstring_view state)
        {
            if (state == L"ready")
            {
                return InstallConflictSnapshotState::Ready;
            }
            if (state == L"committing")
            {
                return InstallConflictSnapshotState::Committing;
            }
            if (state == L"completed")
            {
                return InstallConflictSnapshotState::Completed;
            }
            if (state == L"failed")
            {
                return InstallConflictSnapshotState::Failed;
            }
            return InstallConflictSnapshotState::Preparing;
        }

        FluxoraInstallConflictSnapshot snapshotFromSession(
            const std::filesystem::path& projectDirectory,
            const PendingInstallSessionRecord& session)
        {
            const InstallConflictSnapshotState state = snapshotState(session.state);
            if (state == InstallConflictSnapshotState::Ready ||
                state == InstallConflictSnapshotState::Committing)
            {
                std::vector<PendingInstallSessionRecord> sessions =
                    InstanceMetadataStore::activePendingInstallSessions(
                        projectDirectory,
                        session.profileName);
                if (sessions.empty())
                {
                    sessions.push_back(session);
                }

                std::vector<InstallConflictPreviewRequest> requests;
                requests.reserve(sessions.size());
                std::size_t focusIndex = 0;
                for (std::size_t index = 0; index < sessions.size(); ++index)
                {
                    const PendingInstallSessionRecord& pending = sessions[index];
                    InstallConflictPreviewRequest request;
                    request.operationId = pending.operationId;
                    request.revision = pending.revision;
                    request.mode = pending.mode;
                    request.pendingOrderId = pending.pendingOrderId;
                    request.targetModUuid = pending.targetModUuid;
                    request.targetIndex = pending.targetPosition;
                    request.profileMods = pending.profileRows;
                    request.incomingFiles = pending.files;
                    requests.push_back(std::move(request));
                    if (pending.operationId == session.operationId)
                    {
                        focusIndex = index;
                    }
                }
                FluxoraInstallConflictSnapshot snapshot =
                    InstallConflictPreviewService::calculateAggregate(requests, focusIndex);
                snapshot.state = state;
                snapshot.orderId = session.finalOrderId;
                return snapshot;
            }

            FluxoraInstallConflictSnapshot snapshot;
            snapshot.operationId = session.operationId;
            snapshot.revision = session.revision;
            snapshot.state = state;
            snapshot.pendingOrderId = session.pendingOrderId;
            snapshot.orderId = session.finalOrderId;
            snapshot.targetIndex = session.targetPosition;
            return snapshot;
        }
    }

    std::wstring InstallConflictPreviewService::normalizedPathKey(
        std::wstring_view relativePath)
    {
        std::wstring key(relativePath);
        std::replace(key.begin(), key.end(), L'/', L'\\');
        while (key.starts_with(L".\\"))
        {
            key.erase(0, 2);
        }
        while (!key.empty() && key.front() == L'\\')
        {
            key.erase(key.begin());
        }
        std::transform(
            key.begin(),
            key.end(),
            key.begin(),
            [](wchar_t value)
            {
                return static_cast<wchar_t>(std::towlower(value));
            });
        return key;
    }

    FluxoraInstallConflictSnapshot InstallConflictPreviewService::calculate(
        const InstallConflictPreviewRequest& request)
    {
        return calculateAggregate({request}, 0);
    }

    FluxoraInstallConflictSnapshot InstallConflictPreviewService::calculateAggregate(
        const std::vector<InstallConflictPreviewRequest>& requests,
        std::size_t focusIndex)
    {
        if (requests.empty() || focusIndex >= requests.size())
        {
            throw std::invalid_argument("Aggregate install conflict preview requires a focused request.");
        }
        for (const InstallConflictPreviewRequest& request : requests)
        {
            if (request.operationId.empty())
            {
                throw std::invalid_argument("Install conflict preview requires an operation id.");
            }
            if (request.pendingOrderId.empty())
            {
                throw std::invalid_argument("Install conflict preview requires a pending order id.");
            }
        }

        const InstallConflictPreviewRequest& focus = requests[focusIndex];
        std::vector<WorkingRow> original = workingRows(focus.profileMods);
        const std::map<std::wstring, RowSummary> before = summarize(original);
        std::vector<WorkingRow> projected = original;
        std::set<std::wstring> projectedOrderIds;
        for (const InstallConflictPreviewRequest& request : requests)
        {
            const WorkingRow installed = applyProjection(projected, request);
            projectedOrderIds.insert(installed.row.orderId);
        }

        const std::map<std::wstring, RowSummary> after = summarize(projected);
        FluxoraInstallConflictSnapshot snapshot;
        snapshot.operationId = focus.operationId;
        snapshot.revision = focus.revision;
        snapshot.state = InstallConflictSnapshotState::Ready;
        snapshot.pendingOrderId = focus.pendingOrderId;
        snapshot.targetIndex = focus.targetIndex;

        for (const WorkingRow& row : projected)
        {
            if (row.row.separator)
            {
                continue;
            }
            const RowSummary current = after.contains(row.row.orderId)
                ? after.at(row.row.orderId)
                : RowSummary{};
            const RowSummary previous = before.contains(row.row.orderId)
                ? before.at(row.row.orderId)
                : RowSummary{};
            const bool isInstalledRow = projectedOrderIds.contains(row.row.orderId);
            if (isInstalledRow || current != previous)
            {
                snapshot.rows.push_back(makePatch(row, current));
            }
        }

        return snapshot;
    }

    void InstallConflictPreviewService::beginSession(
        const InstallConflictSessionStartRequest& request)
    {
        InstanceMetadataStore::beginPendingInstallSession(
            request.projectDirectory,
            request.operationId,
            request.profileName,
            request.mode,
            request.pendingOrderId,
            request.targetModUuid,
            request.targetIndex,
            request.beforeOrderId,
            request.afterOrderId);
    }

    FluxoraInstallConflictSnapshot InstallConflictPreviewService::publishExactInventory(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId,
        const std::vector<InstallConflictFile>& files)
    {
        return snapshotFromSession(
            projectDirectory,
            InstanceMetadataStore::preparePendingInstallSession(
                projectDirectory,
                operationId,
                files));
    }

    FluxoraInstallConflictSnapshot InstallConflictPreviewService::rebase(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId,
        std::wstring_view beforeOrderId,
        std::wstring_view afterOrderId,
        int fallbackTargetIndex,
        std::int64_t expectedRevision,
        bool applyIfCompleted)
    {
        return snapshotFromSession(
            projectDirectory,
            InstanceMetadataStore::rebasePendingInstallSession(
                projectDirectory,
                operationId,
                beforeOrderId,
                afterOrderId,
                fallbackTargetIndex,
                expectedRevision,
                applyIfCompleted));
    }

    FluxoraInstallConflictSnapshot InstallConflictPreviewService::completeSession(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId,
        std::wstring_view finalOrderId)
    {
        return snapshotFromSession(
            projectDirectory,
            InstanceMetadataStore::completePendingInstallSession(
                projectDirectory,
                operationId,
                finalOrderId));
    }

    FluxoraInstallConflictSnapshot InstallConflictPreviewService::failSession(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId)
    {
        return snapshotFromSession(
            projectDirectory,
            InstanceMetadataStore::failPendingInstallSession(
                projectDirectory,
                operationId));
    }
}
