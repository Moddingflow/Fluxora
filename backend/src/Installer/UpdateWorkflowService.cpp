#include "FluxoraInstaller/UpdateWorkflowService.hpp"

#include "FluxoraInstaller/HealthAcknowledgementService.hpp"
#include "FluxoraInstaller/InstallerDirectoryTransaction.hpp"
#include "FluxoraInstaller/InstallerLogService.hpp"
#include "FluxoraInstaller/ParentProcessWaiter.hpp"
#include "FluxoraInstaller/RecoveryServices.hpp"
#include "FluxoraInstaller/SignedInstallReceipt.hpp"
#include "FluxoraInstaller/UpdateEngine.hpp"
#include "FluxoraInstaller/UpdateProcessLock.hpp"

#include <algorithm>
#include <exception>
#include <memory>
#include <stdexcept>
#include <utility>

namespace
{
    void requireActions(const fluxora::installer::UpdateWorkflowActions& actions)
    {
        if (!actions.acquireLock || !actions.recover || !actions.waitForParent ||
            !actions.prepareHealth || !actions.armRecovery || !actions.armWatchdog ||
            !actions.install || !actions.launchUpdated || !actions.waitForHealth ||
            !actions.finalize || !actions.writeReceipt || !actions.rollback ||
            !actions.disarmRecovery || !actions.launchPrevious ||
            !actions.cleanupHealth)
        {
            throw std::invalid_argument("Complete update workflow actions are required.");
        }
    }

    void emit(
        const fluxora::installer::UpdateWorkflowRequest& request,
        const fluxora::installer::UpdateWorkflowProgressCallback& callback,
        std::string phase,
        std::string statusKey,
        std::string currentItem = {},
        std::uint64_t completedBytes = 0,
        std::uint64_t totalBytes = 0)
    {
        if (!callback)
        {
            return;
        }
        fluxora::installer::UpdateWorkflowProgress progress;
        progress.operationId = request.operationId;
        progress.phase = std::move(phase);
        progress.statusKey = std::move(statusKey);
        progress.currentItem = std::move(currentItem);
        progress.completedBytes = completedBytes;
        progress.totalBytes = totalBytes;
        progress.percent = totalBytes == 0
            ? 0.0
            : std::clamp(
                static_cast<double>(completedBytes) * 100.0 /
                    static_cast<double>(totalBytes),
                0.0,
                100.0);
        progress.canCancel = false;
        callback(progress);
    }

    void logInfo(
        const fluxora::installer::UpdateWorkflowActions& actions,
        std::string_view event)
    {
        if (actions.logInfo)
        {
            actions.logInfo(event);
        }
    }

    void logError(
        const fluxora::installer::UpdateWorkflowActions& actions,
        std::string_view event,
        std::string_view code)
    {
        if (actions.logError)
        {
            actions.logError(event, code);
        }
    }

    void launchPreviousBestEffort(
        const fluxora::installer::UpdateWorkflowActions& actions)
    {
        logInfo(actions, "relaunching-previous-version");
        try
        {
            actions.launchPrevious();
        }
        catch (...)
        {
            logError(
                actions,
                "previous-version-relaunch-failed",
                "launch-failed");
        }
    }

    class NativeLockLease final :
        public fluxora::installer::IUpdateWorkflowLockLease
    {
    public:
        explicit NativeLockLease(fluxora::installer::UpdateProcessLock lock)
            : lock_(std::move(lock))
        {
        }
        [[nodiscard]] bool wasAbandoned() const noexcept override
        {
            return lock_.wasAbandoned();
        }

    private:
        fluxora::installer::UpdateProcessLock lock_;
    };

    class NativeWorkflowApplication final :
        public fluxora::installer::IUpdateWorkflowApplication
    {
    public:
        explicit NativeWorkflowApplication(
            fluxora::installer::LaunchedApplication application)
            : application_(std::move(application))
        {
        }
        [[nodiscard]] std::uint32_t processId() const noexcept override
        {
            return application_.processId();
        }
        [[nodiscard]] std::uint64_t startFileTime() const noexcept override
        {
            return application_.startFileTime();
        }
        [[nodiscard]] const std::filesystem::path& executablePath() const noexcept override
        {
            return application_.executablePath();
        }
        [[nodiscard]] bool hasExited() const override
        {
            return application_.hasExited();
        }
        void terminateIfRunning() override
        {
            application_.terminateIfRunning();
        }
        void releaseProcessTree() override
        {
            application_.releaseProcessTree();
        }

    private:
        fluxora::installer::LaunchedApplication application_;
    };
}

namespace fluxora::installer
{
    UpdateWorkflowResult UpdateWorkflowController::run(
        const UpdateWorkflowRequest& request,
        const UpdateWorkflowActions& actions,
        const UpdateWorkflowProgressCallback& progress) const
    {
        requireActions(actions);
        std::unique_ptr<IUpdateWorkflowLockLease> lock = actions.acquireLock();
        if (!lock)
        {
            throw std::runtime_error("Update lock acquisition returned no lease.");
        }
        if (lock->wasAbandoned())
        {
            logInfo(actions, "abandoned-update-lock-recovered");
        }

        emit(request, progress, "recovering", "updater.status.recovering");
        actions.recover();
        emit(
            request,
            progress,
            "waiting-for-parent",
            "updater.status.waitingForParent");
        logInfo(actions, "waiting-for-parent");
        actions.waitForParent();
        actions.prepareHealth();

        bool recoveryArmed = false;
        try
        {
            actions.armRecovery();
            recoveryArmed = true;
            actions.armWatchdog();
            emit(request, progress, "verifying", "updater.status.verifying");
            logInfo(actions, "native-update-started");
            actions.install(
                [&](std::string_view nativePhase,
                    std::string_view currentItem,
                    std::uint64_t completedBytes,
                    std::uint64_t totalBytes) {
                    const bool copying = nativePhase == "copying";
                    emit(
                        request,
                        progress,
                        copying ? "installing" : "verifying",
                        copying
                            ? "updater.status.installing"
                            : "updater.status.verifying",
                        std::string(currentItem),
                        completedBytes,
                        totalBytes);
                });
            logInfo(actions, "native-update-completed");
        }
        catch (const detail::InstallerRecoveryError&)
        {
            actions.cleanupHealth();
            throw UpdateWorkflowRecoveryError(
                "The native update failed and could not prove that rollback restored a healthy tree.");
        }
        catch (...)
        {
            if (recoveryArmed)
            {
                try
                {
                    actions.disarmRecovery();
                }
                catch (...)
                {
                }
            }
            launchPreviousBestEffort(actions);
            actions.cleanupHealth();
            throw;
        }

        std::unique_ptr<IUpdateWorkflowApplication> application;
        try
        {
            emit(request, progress, "launching", "updater.status.launching");
            application = actions.launchUpdated();
            if (!application)
            {
                throw std::runtime_error("Updated application launch returned no process.");
            }
            logInfo(actions, "updated-application-launched");
            emit(request, progress, "health-check", "updater.status.healthCheck");
            actions.waitForHealth(*application);
            logInfo(actions, "updated-application-health-confirmed");
            emit(request, progress, "finalizing", "updater.status.finalizing");
            actions.finalize();
            logInfo(actions, "native-update-finalized");
            try
            {
                actions.writeReceipt();
                logInfo(actions, "installed-receipt-written");
            }
            catch (...)
            {
                logError(
                    actions,
                    "installed-receipt-write-failed",
                    "receipt-write-failed");
            }
            actions.disarmRecovery();
            recoveryArmed = false;
            application->releaseProcessTree();
            logInfo(actions, "updated-process-tree-released");
        }
        catch (...)
        {
            const std::exception_ptr updateFailure = std::current_exception();
            emit(request, progress, "rolling-back", "updater.status.rollingBack");
            try
            {
                if (application)
                {
                    application->terminateIfRunning();
                }
                actions.rollback();
                logInfo(actions, "native-update-rolled-back");
                actions.disarmRecovery();
                recoveryArmed = false;
            }
            catch (...)
            {
                logError(
                    actions,
                    "native-update-recovery-failed",
                    "rollback-failed");
                actions.cleanupHealth();
                throw UpdateWorkflowRecoveryError(
                    "The unhealthy update could not be safely rolled back.");
            }
            launchPreviousBestEffort(actions);
            actions.cleanupHealth();
            emit(request, progress, "rolled-back", "updater.status.rolledBack");
            std::rethrow_exception(updateFailure);
        }

        actions.cleanupHealth();
        emit(
            request,
            progress,
            "completed",
            "updater.status.completed",
            {},
            1,
            1);
        return UpdateWorkflowResult{
            UpdateWorkflowOutcome::Succeeded,
            request.operationId,
            request.targetVersion};
    }

    NativeUpdateWorkflow::NativeUpdateWorkflow(
        std::vector<std::byte> publicKeyDer,
        std::filesystem::path updaterExecutable)
        : publicKeyDer_(std::move(publicKeyDer)),
          updaterExecutable_(std::move(updaterExecutable))
    {
        if (publicKeyDer_.empty() || publicKeyDer_.size() > 4096)
        {
            throw std::invalid_argument(
                "Embedded update trust anchor is missing or unexpectedly large.");
        }
        if (updaterExecutable_.empty() || !updaterExecutable_.is_absolute())
        {
            throw std::invalid_argument("Updater executable path must be absolute.");
        }
    }

    NativeUpdateWorkflow::NativeUpdateWorkflow(
        std::filesystem::path updaterExecutable)
        : updaterExecutable_(std::move(updaterExecutable))
    {
        if (updaterExecutable_.empty() || !updaterExecutable_.is_absolute())
        {
            throw std::invalid_argument("Updater executable path must be absolute.");
        }
    }

    UpdateWorkflowResult NativeUpdateWorkflow::run(
        const UpdateWorkflowRequest& request,
        const UpdateWorkflowProgressCallback& progress) const
    {
        if (publicKeyDer_.empty())
        {
            throw std::logic_error(
                "Update application requires an embedded trust anchor.");
        }
        SystemParentProcessResolver parentResolver;
        ParentProcessWaiter parentWaiter(parentResolver);
        ApplicationLaunchService launcher;
        HealthAcknowledgementService health;
        WindowsRunOnceStore runOnceStore;
        RecoveryActivation recoveryActivation(runOnceStore);
        RecoveryWatchdogService watchdog;
        SignedInstallReceipt receipt;
        InstallerLogService log;
        UpdateEngine engine(publicKeyDer_);

        UpdateWorkflowActions actions;
        actions.acquireLock = [&] {
            return std::make_unique<NativeLockLease>(
                UpdateProcessLock::acquire(request.installDirectory));
        };
        actions.recover = [&] {
            detail::recoverApplicationDirectory(request.installDirectory);
            recoveryActivation.complete(request);
        };
        actions.waitForParent = [&] { parentWaiter.wait(request); };
        actions.prepareHealth = [&] { health.prepare(request); };
        actions.armRecovery = [&] {
            recoveryActivation.arm(request, updaterExecutable_);
        };
        actions.armWatchdog = [&] {
            watchdog.arm(request, updaterExecutable_);
        };
        actions.install = [&](const UpdateProgressCallback& nativeProgress) {
            (void)engine.apply(request.nativeUpdateRequest(), nativeProgress);
        };
        actions.launchUpdated = [&]() -> std::unique_ptr<IUpdateWorkflowApplication> {
            return std::make_unique<NativeWorkflowApplication>(
                launcher.launchUpdated(request));
        };
        actions.waitForHealth = [&](const ILaunchedApplicationIdentity& application) {
            health.wait(request, application);
        };
        actions.finalize = [&] {
            detail::finalizePendingApplicationUpdate(request.installDirectory);
        };
        actions.writeReceipt = [&] { receipt.write(request); };
        actions.rollback = [&] {
            detail::rollbackPendingApplicationUpdate(request.installDirectory);
        };
        actions.disarmRecovery = [&] { recoveryActivation.complete(request); };
        actions.launchPrevious = [&] { launcher.launchPrevious(request); };
        actions.cleanupHealth = [&] { health.cleanup(request); };
        actions.logInfo = [&](std::string_view event) {
            log.info(
                InstallerLogChannel::Updater,
                request.operationId,
                event);
            log.info(
                InstallerLogChannel::Operation,
                request.operationId,
                event);
        };
        actions.logError = [&](std::string_view event, std::string_view code) {
            log.error(
                InstallerLogChannel::Updater,
                request.operationId,
                event,
                code);
            log.error(
                InstallerLogChannel::Operation,
                request.operationId,
                event,
                code);
        };
        return UpdateWorkflowController().run(request, actions, progress);
    }

    void NativeUpdateWorkflow::recover(
        const UpdateWorkflowRequest& request) const
    {
        if (!request.recoveryInvocation)
        {
            throw std::invalid_argument(
                "Headless recovery requires a recovery invocation.");
        }
        // Keyless recovery never applies or trusts external package state. It only
        // interprets the core-owned durable transaction marker and restores or
        // cleans one already-committed directory swap under the per-install mutex.
        UpdateProcessLock lock =
            UpdateProcessLock::acquire(request.installDirectory);
        InstallerLogService log;
        log.info(
            InstallerLogChannel::Updater,
            request.operationId,
            "headless-recovery-started");
        detail::recoverApplicationDirectory(request.installDirectory);
        log.info(
            InstallerLogChannel::Updater,
            request.operationId,
            "headless-recovery-completed");
    }

    void NativeUpdateWorkflow::runRecoveryWatchdog(
        const UpdateWorkflowRequest& request,
        std::uint32_t ownerPid,
        std::uint64_t ownerStartFileTime,
        std::wstring readyEventName) const
    {
        if (!request.recoveryInvocation)
        {
            throw std::invalid_argument(
                "Recovery watchdog requires a recovery invocation.");
        }
        RecoveryWatchdogInvocation invocation;
        invocation.requestPath = request.requestPath;
        invocation.ownerPid = ownerPid;
        invocation.ownerStartFileTime = ownerStartFileTime;
        invocation.readyEventName = std::move(readyEventName);
        RecoveryWatchdogService().run(
            request,
            updaterExecutable_,
            invocation,
            [&] { recover(request); });
    }
}
