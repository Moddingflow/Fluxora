#include "FluxoraInstaller/InstallerDirectoryTransaction.hpp"
#include "FluxoraInstaller/UpdateProcessLock.hpp"
#include "FluxoraInstaller/UpdateWorkflowService.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace
{
    class FakeLease final : public fluxora::installer::IUpdateWorkflowLockLease
    {
    public:
        explicit FakeLease(bool abandoned = false) : abandoned_(abandoned) {}
        [[nodiscard]] bool wasAbandoned() const noexcept override
        {
            return abandoned_;
        }

    private:
        bool abandoned_;
    };

    class FakeApplication final :
        public fluxora::installer::IUpdateWorkflowApplication
    {
    public:
        FakeApplication(
            std::vector<std::string>& calls,
            const fluxora::installer::UpdateWorkflowRequest& request)
            : calls_(calls),
              path_(request.installDirectory / request.applicationExecutable)
        {
        }
        ~FakeApplication() override { calls_.push_back("dispose"); }
        [[nodiscard]] std::uint32_t processId() const noexcept override { return 1234; }
        [[nodiscard]] std::uint64_t startFileTime() const noexcept override { return 1; }
        [[nodiscard]] const std::filesystem::path& executablePath() const noexcept override
        {
            return path_;
        }
        [[nodiscard]] bool hasExited() const override { return false; }
        void terminateIfRunning() override { calls_.push_back("terminate"); }
        void releaseProcessTree() override { calls_.push_back("release"); }

    private:
        std::vector<std::string>& calls_;
        std::filesystem::path path_;
    };

    struct WorkflowFailures final
    {
        bool busy{false};
        bool install{false};
        bool unsafeInstall{false};
        bool launch{false};
        bool health{false};
        bool rollback{false};
    };

    fluxora::installer::UpdateWorkflowRequest workflowRequest()
    {
        fluxora::installer::UpdateWorkflowRequest request;
        request.operationId = "op_update_abcdef12";
        request.targetVersion = "1.1.0";
        request.installDirectory = L"C:\\Fluxora";
        request.applicationExecutable = L"Fluxora.exe";
        return request;
    }

    fluxora::installer::UpdateWorkflowActions actions(
        std::vector<std::string>& calls,
        const fluxora::installer::UpdateWorkflowRequest& request,
        WorkflowFailures failures = {})
    {
        fluxora::installer::UpdateWorkflowActions result;
        result.acquireLock = [&, failures]() -> std::unique_ptr<
            fluxora::installer::IUpdateWorkflowLockLease> {
            if (failures.busy)
            {
                throw fluxora::installer::UpdateBusyError("busy");
            }
            return std::make_unique<FakeLease>();
        };
        result.recover = [&] { calls.push_back("recover"); };
        result.waitForParent = [&] { calls.push_back("wait"); };
        result.prepareHealth = [&] { calls.push_back("prepare"); };
        result.armRecovery = [&] { calls.push_back("arm"); };
        result.armWatchdog = [&] { calls.push_back("watchdog"); };
        result.install = [&, failures](const fluxora::installer::UpdateProgressCallback&) {
            calls.push_back("install");
            if (failures.unsafeInstall)
            {
                throw fluxora::installer::detail::InstallerRecoveryError("unsafe");
            }
            if (failures.install)
            {
                throw std::runtime_error("install");
            }
        };
        result.launchUpdated = [&, failures]()
            -> std::unique_ptr<fluxora::installer::IUpdateWorkflowApplication> {
            calls.push_back("launch-new");
            if (failures.launch)
            {
                throw std::runtime_error("launch");
            }
            return std::make_unique<FakeApplication>(calls, request);
        };
        result.waitForHealth = [&, failures](
            const fluxora::installer::ILaunchedApplicationIdentity&) {
            calls.push_back("health");
            if (failures.health)
            {
                throw std::runtime_error("health");
            }
        };
        result.finalize = [&] { calls.push_back("finalize"); };
        result.writeReceipt = [&] { calls.push_back("receipt"); };
        result.rollback = [&, failures] {
            calls.push_back("rollback");
            if (failures.rollback)
            {
                throw std::runtime_error("rollback");
            }
        };
        result.disarmRecovery = [&] { calls.push_back("disarm"); };
        result.launchPrevious = [&] { calls.push_back("launch-old"); };
        result.cleanupHealth = [&] { calls.push_back("cleanup"); };
        result.logInfo = [](std::string_view) {};
        result.logError = [](std::string_view, std::string_view) {};
        return result;
    }
}

TEST(UpdateWorkflowServiceTests, FinalizesOnlyAfterValidHealthAcknowledgement)
{
    const fluxora::installer::UpdateWorkflowRequest request = workflowRequest();
    std::vector<std::string> calls;

    const fluxora::installer::UpdateWorkflowResult result =
        fluxora::installer::UpdateWorkflowController().run(
            request,
            actions(calls, request));

    EXPECT_EQ("1.1.0", result.targetVersion);
    EXPECT_EQ(
        (std::vector<std::string>{
            "recover", "wait", "prepare", "arm", "watchdog", "install",
            "launch-new", "health", "finalize", "receipt", "disarm",
            "release", "cleanup", "dispose"}),
        calls);
}

TEST(UpdateWorkflowServiceTests, InstallFailureDisarmsAndRestartsPrevious)
{
    const fluxora::installer::UpdateWorkflowRequest request = workflowRequest();
    std::vector<std::string> calls;

    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowController().run(
            request,
            actions(calls, request, {.install = true})),
        std::runtime_error);

    EXPECT_EQ(
        (std::vector<std::string>{
            "recover", "wait", "prepare", "arm", "watchdog", "install",
            "disarm", "launch-old", "cleanup"}),
        calls);
}

TEST(UpdateWorkflowServiceTests, HealthFailureTerminatesRollsBackAndRestartsPrevious)
{
    const fluxora::installer::UpdateWorkflowRequest request = workflowRequest();
    std::vector<std::string> calls;

    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowController().run(
            request,
            actions(calls, request, {.health = true})),
        std::runtime_error);

    EXPECT_EQ(
        (std::vector<std::string>{
            "recover", "wait", "prepare", "arm", "watchdog", "install",
            "launch-new", "health", "terminate", "rollback", "disarm",
            "launch-old", "cleanup", "dispose"}),
        calls);
}

TEST(UpdateWorkflowServiceTests, LaunchFailureRollsBackWithoutTerminatingUnknownProcess)
{
    const fluxora::installer::UpdateWorkflowRequest request = workflowRequest();
    std::vector<std::string> calls;

    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowController().run(
            request,
            actions(calls, request, {.launch = true})),
        std::runtime_error);

    EXPECT_EQ(
        (std::vector<std::string>{
            "recover", "wait", "prepare", "arm", "watchdog", "install",
            "launch-new", "rollback", "disarm", "launch-old", "cleanup"}),
        calls);
}

TEST(UpdateWorkflowServiceTests, RollbackFailureNeverRelaunchesOrClaimsSuccess)
{
    const fluxora::installer::UpdateWorkflowRequest request = workflowRequest();
    std::vector<std::string> calls;

    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowController().run(
            request,
            actions(calls, request, {.health = true, .rollback = true})),
        fluxora::installer::UpdateWorkflowRecoveryError);

    EXPECT_EQ(
        (std::vector<std::string>{
            "recover", "wait", "prepare", "arm", "watchdog", "install",
            "launch-new", "health", "terminate", "rollback", "cleanup",
            "dispose"}),
        calls);
}

TEST(UpdateWorkflowServiceTests, UnsafeNativeFailureLeavesRecoveryArmed)
{
    const fluxora::installer::UpdateWorkflowRequest request = workflowRequest();
    std::vector<std::string> calls;

    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowController().run(
            request,
            actions(calls, request, {.unsafeInstall = true})),
        fluxora::installer::UpdateWorkflowRecoveryError);

    EXPECT_EQ(
        (std::vector<std::string>{
            "recover", "wait", "prepare", "arm", "watchdog", "install",
            "cleanup"}),
        calls);
}

TEST(UpdateWorkflowServiceTests, BusyLockRejectsBeforeRecovery)
{
    const fluxora::installer::UpdateWorkflowRequest request = workflowRequest();
    std::vector<std::string> calls;

    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowController().run(
            request,
            actions(calls, request, {.busy = true})),
        fluxora::installer::UpdateBusyError);

    EXPECT_TRUE(calls.empty());
}
