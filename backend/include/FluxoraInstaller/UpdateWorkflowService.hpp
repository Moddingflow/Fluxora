#pragma once

#include "FluxoraInstaller\ApplicationLaunchService.hpp"
#include "FluxoraInstaller\UpdateWorkflowRequest.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora::installer
{
    struct UpdateWorkflowProgress final
    {
        std::string operationId;
        std::string phase;
        std::string statusKey;
        std::string currentItem;
        std::uint64_t completedBytes{0};
        std::uint64_t totalBytes{0};
        double percent{0.0};
        bool canCancel{false};
    };

    using UpdateWorkflowProgressCallback =
        std::function<void(const UpdateWorkflowProgress&)>;

    class IUpdateWorkflowLockLease
    {
    public:
        virtual ~IUpdateWorkflowLockLease() = default;
        [[nodiscard]] virtual bool wasAbandoned() const noexcept = 0;
    };

    class IUpdateWorkflowApplication : public ILaunchedApplicationIdentity
    {
    public:
        ~IUpdateWorkflowApplication() override = default;
        virtual void terminateIfRunning() = 0;
        virtual void releaseProcessTree() = 0;
    };

    struct UpdateWorkflowActions final
    {
        std::function<std::unique_ptr<IUpdateWorkflowLockLease>()> acquireLock;
        std::function<void()> recover;
        std::function<void()> waitForParent;
        std::function<void()> prepareHealth;
        std::function<void()> armRecovery;
        std::function<void()> armWatchdog;
        std::function<void(const UpdateProgressCallback&)> install;
        std::function<std::unique_ptr<IUpdateWorkflowApplication>()> launchUpdated;
        std::function<void(const ILaunchedApplicationIdentity&)> waitForHealth;
        std::function<void()> finalize;
        std::function<void()> writeReceipt;
        std::function<void()> rollback;
        std::function<void()> disarmRecovery;
        std::function<void()> launchPrevious;
        std::function<void()> cleanupHealth;
        std::function<void(std::string_view)> logInfo;
        std::function<void(std::string_view, std::string_view)> logError;
    };

    enum class UpdateWorkflowOutcome
    {
        Succeeded
    };

    struct UpdateWorkflowResult final
    {
        UpdateWorkflowOutcome outcome{UpdateWorkflowOutcome::Succeeded};
        std::string operationId;
        std::string targetVersion;
    };

    class UpdateWorkflowRecoveryError final : public std::runtime_error
    {
    public:
        using std::runtime_error::runtime_error;
    };

    class UpdateWorkflowController final
    {
    public:
        [[nodiscard]] UpdateWorkflowResult run(
            const UpdateWorkflowRequest& request,
            const UpdateWorkflowActions& actions,
            const UpdateWorkflowProgressCallback& progress = {}) const;
    };

    class NativeUpdateWorkflow final
    {
    public:
        NativeUpdateWorkflow(
            std::vector<std::byte> publicKeyDer,
            std::filesystem::path updaterExecutable);
        explicit NativeUpdateWorkflow(std::filesystem::path updaterExecutable);

        [[nodiscard]] UpdateWorkflowResult run(
            const UpdateWorkflowRequest& request,
            const UpdateWorkflowProgressCallback& progress = {}) const;

        void recover(const UpdateWorkflowRequest& request) const;
        void runRecoveryWatchdog(
            const UpdateWorkflowRequest& request,
            std::uint32_t ownerPid,
            std::uint64_t ownerStartFileTime,
            std::wstring readyEventName) const;

    private:
        std::vector<std::byte> publicKeyDer_;
        std::filesystem::path updaterExecutable_;
    };
}
