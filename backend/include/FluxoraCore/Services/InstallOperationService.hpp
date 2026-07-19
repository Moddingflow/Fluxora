#pragma once

#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/IService.hpp"
#include "FluxoraCore/Services/InstallOperationStore.hpp"
#include "FluxoraCore/Services/InstallScheduler.hpp"

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace fluxora
{
    struct InstallOperationRequest
    {
        std::wstring operationId;
        std::filesystem::path projectDirectory;
        std::wstring sourceKind;
        std::filesystem::path sourcePath;
        bool fomod{false};
        std::wstring modName;
        ExistingModInstallMode existingModMode{ExistingModInstallMode::FailIfExists};
        std::vector<std::wstring> selectedOptionIds;
        std::vector<PlacementOverride> placementOverrides;
        std::optional<ModIdentityInstallSelection> identitySelection;
        std::wstring profileName;
        std::wstring fomodContextId;
        std::vector<FomodManualDecision> manualDecisions;
        int modOrderTargetIndex{-1};
        std::wstring beforeOrderId;
        std::wstring afterOrderId;
        std::wstring selectedOptionIdsJson{L"[]"};
        std::wstring manualDecisionsJson{L"[]"};
        std::wstring placementOverridesJson{L"[]"};
        std::wstring identityPlanJson{L"{}"};
        std::wstring requestJson{L"{}"};
    };

    using InstallOperationProgressCallback =
        std::function<void(const InstallOperationRecord& operation)>;

    class InstallOperationService final : public IService
    {
    public:
        InstallOperationService(Logger& logger, DownloadService& downloads);
        ~InstallOperationService() override;

        InstallOperationService(const InstallOperationService&) = delete;
        InstallOperationService& operator=(const InstallOperationService&) = delete;

        void initialize() override;
        void shutdown() override;

        [[nodiscard]] InstallOperationRecord submit(
            InstallOperationRequest request,
            InstallOperationProgressCallback progress = {});

        [[nodiscard]] std::vector<InstallOperationRecord> restore(
            const std::filesystem::path& projectDirectory,
            InstallOperationProgressCallback progress = {});

        [[nodiscard]] std::vector<InstallOperationRecord> list(
            const std::filesystem::path& projectDirectory,
            bool includeTerminal = true) const;

        [[nodiscard]] std::optional<InstallOperationRecord> get(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId) const;

        [[nodiscard]] InstallOperationRecord cancel(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId);

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        struct OperationContext;

        void schedule(const std::shared_ptr<OperationContext>& context);
        void publish(
            const std::shared_ptr<OperationContext>& context,
            std::wstring state,
            std::wstring stage,
            int progressPercent,
            bool indeterminate,
            std::wstring errorCode = {},
            std::wstring errorMessage = {},
            std::wstring resultJson = {}) const noexcept;
        void execute(const std::shared_ptr<OperationContext>& context) const noexcept;
        void finish(const std::shared_ptr<OperationContext>& context) noexcept;

        Logger& logger_;
        DownloadService& downloads_;
        std::unique_ptr<InstallScheduler> scheduler_;
        mutable std::mutex activeMutex_;
        std::map<std::wstring, std::shared_ptr<OperationContext>> activeOperations_;
        bool initialized_{false};
    };
}
