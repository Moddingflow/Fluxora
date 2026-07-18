#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    struct InstallOperationRecord
    {
        std::wstring operationId;
        std::wstring sourceKind;
        std::filesystem::path sourcePath;
        std::wstring archiveFingerprint;
        std::wstring profileName;
        int existingModMode{0};
        std::wstring targetModUuid;
        std::wstring targetFolder;
        std::wstring selectedOptionIdsJson{L"[]"};
        std::wstring manualDecisionsJson{L"[]"};
        std::wstring placementOverridesJson{L"[]"};
        std::wstring identityPlanJson{L"{}"};
        std::wstring requestJson{L"{}"};
        std::wstring beforeOrderId;
        std::wstring afterOrderId;
        std::uint64_t enqueueSequence{0};
        std::wstring state{L"queued"};
        std::wstring stage{L"queued"};
        int progressPercent{-1};
        bool indeterminate{true};
        std::wstring errorCode;
        std::wstring errorMessage;
        std::wstring resultJson;
    };

    class InstallOperationStore final
    {
    public:
        InstallOperationStore() = delete;

        static std::uint64_t save(
            const std::filesystem::path& projectDirectory,
            const InstallOperationRecord& operation);

        [[nodiscard]] static std::optional<InstallOperationRecord> get(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId);

        [[nodiscard]] static std::vector<InstallOperationRecord> list(
            const std::filesystem::path& projectDirectory,
            bool includeTerminal = true);
    };
}
