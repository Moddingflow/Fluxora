#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    enum class InstallConflictPreviewMode
    {
        Install = 0,
        Replace = 1,
        Merge = 2
    };

    enum class InstallConflictSnapshotState
    {
        Preparing = 0,
        Ready = 1,
        Committing = 2,
        Completed = 3,
        Failed = 4
    };

    struct InstallConflictFile
    {
        std::wstring relativePath;
        std::uintmax_t size{0};
        std::wstring modifiedAt;
    };

    // A pinned profile row. Separator rows preserve the renderer's target-index
    // coordinate system but never participate in file ownership.
    struct InstallConflictProfileMod
    {
        std::wstring orderId;
        std::wstring modUuid;
        std::wstring relationId;
        bool enabled{true};
        bool separator{false};
        std::vector<InstallConflictFile> files;
    };

    struct InstallConflictPreviewRequest
    {
        std::wstring operationId;
        std::uint64_t revision{0};
        InstallConflictPreviewMode mode{InstallConflictPreviewMode::Install};
        std::wstring pendingOrderId;
        std::wstring targetModUuid;
        int targetIndex{-1};
        std::vector<InstallConflictProfileMod> profileMods;
        std::vector<InstallConflictFile> incomingFiles;
    };

    struct InstallConflictRowPatch
    {
        std::wstring orderId;
        std::wstring modUuid;
        int fileCount{0};
        int conflictingFileCount{0};
        int overwrittenFileCount{0};
        int overwritingFileCount{0};
        std::vector<std::wstring> overwritesModIds;
        std::vector<std::wstring> overwrittenByModIds;
    };

    struct FluxoraInstallConflictSnapshot
    {
        std::wstring operationId;
        std::uint64_t revision{0};
        InstallConflictSnapshotState state{InstallConflictSnapshotState::Preparing};
        std::wstring pendingOrderId;
        std::wstring orderId;
        int targetIndex{-1};
        std::vector<InstallConflictRowPatch> rows;
    };

    struct InstallConflictSessionStartRequest
    {
        std::filesystem::path projectDirectory;
        std::wstring operationId;
        std::wstring profileName;
        InstallConflictPreviewMode mode{InstallConflictPreviewMode::Install};
        std::wstring pendingOrderId;
        std::wstring targetModUuid;
        int targetIndex{-1};
    };

    class InstallConflictPreviewService final
    {
    public:
        InstallConflictPreviewService() = delete;

        [[nodiscard]] static FluxoraInstallConflictSnapshot calculate(
            const InstallConflictPreviewRequest& request);

        static void beginSession(const InstallConflictSessionStartRequest& request);

        [[nodiscard]] static FluxoraInstallConflictSnapshot publishExactInventory(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            const std::vector<InstallConflictFile>& files);

        [[nodiscard]] static FluxoraInstallConflictSnapshot rebase(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            int targetIndex);

        [[nodiscard]] static FluxoraInstallConflictSnapshot completeSession(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId,
            std::wstring_view finalOrderId);

        [[nodiscard]] static FluxoraInstallConflictSnapshot failSession(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId);

        [[nodiscard]] static std::wstring normalizedPathKey(
            std::wstring_view relativePath);
    };
}
