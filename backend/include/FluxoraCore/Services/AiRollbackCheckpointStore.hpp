#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    enum class AiRollbackCheckpointState
    {
        Available,
        RolledBack,
        Conflict,
        Unavailable
    };

    enum class AiRollbackCheckpointReason
    {
        None,
        Expired,
        Corrupt,
        OverlappingEdit,
        EncodingChanged,
        PathChanged,
        CreatedFileModified
    };

    struct AiRollbackCheckpointFile
    {
        std::wstring relativePath;
        std::wstring displayRelativePath;
        std::wstring ownerMod;
        std::wstring beforeHash;
        std::wstring afterHash;
        std::vector<char> beforeBytes;
        std::vector<char> afterBytes;
        int encoding{0};
        bool created{false};
        bool managedOverride{false};
        bool registeredManagedMod{false};
        std::size_t addedLines{0};
        std::size_t removedLines{0};
        std::wstring beforeVersion;
        std::wstring afterVersion;
    };

    struct AiRollbackCheckpointRun
    {
        std::wstring chatId;
        std::wstring buildKey;
        std::wstring runId;
        std::wstring operationId;
        std::uintmax_t createdAt{0};
        AiRollbackCheckpointState state{AiRollbackCheckpointState::Available};
        AiRollbackCheckpointReason reason{AiRollbackCheckpointReason::None};
        std::vector<AiRollbackCheckpointFile> files;
    };

    struct AiRollbackCheckpointRunState
    {
        std::wstring runId;
        AiRollbackCheckpointState state{AiRollbackCheckpointState::Unavailable};
        AiRollbackCheckpointReason reason{AiRollbackCheckpointReason::None};
    };

    struct AiRollbackCheckpointLimits
    {
        std::uintmax_t perChatBytes{256ull * 1024ull * 1024ull};
        std::uintmax_t globalBytes{1024ull * 1024ull * 1024ull};
    };

    struct AiRollbackCheckpointStorageStats
    {
        std::size_t blobCount{0};
        std::uintmax_t storedBytes{0};
    };

    class AiRollbackCheckpointStore final
    {
    public:
        explicit AiRollbackCheckpointStore(
            std::filesystem::path root,
            AiRollbackCheckpointLimits limits = {});

        void saveRun(const AiRollbackCheckpointRun& run);
        [[nodiscard]] std::vector<AiRollbackCheckpointRun> loadRuns(
            std::wstring_view chatId,
            std::wstring_view buildKey) const;
        [[nodiscard]] std::vector<AiRollbackCheckpointRunState> getRunStates(
            std::wstring_view chatId,
            std::wstring_view buildKey) const;
        void setRunState(
            std::wstring_view chatId,
            std::wstring_view buildKey,
            std::wstring_view runId,
            AiRollbackCheckpointState state,
            AiRollbackCheckpointReason reason = AiRollbackCheckpointReason::None);
        void removeRun(
            std::wstring_view chatId,
            std::wstring_view buildKey,
            std::wstring_view runId);
        void eraseChat(std::wstring_view chatId);
        void eraseBuild(std::wstring_view buildKey);
        void eraseAll();
        [[nodiscard]] AiRollbackCheckpointStorageStats storageStats() const;

    private:
        std::filesystem::path root_;
        AiRollbackCheckpointLimits limits_;
    };
}
