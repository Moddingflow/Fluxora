#include "FluxoraInstaller/RecoveryServices.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <string>

namespace
{
    class FakeRunOnceStore final : public fluxora::installer::IRunOnceStore
    {
    public:
        void set(std::wstring_view name, std::wstring_view command) override
        {
            setName = name;
            setCommand = command;
        }
        void remove(std::wstring_view name) override
        {
            removedName = name;
        }

        std::wstring setName;
        std::wstring setCommand;
        std::wstring removedName;
    };

    fluxora::installer::UpdateWorkflowRequest recoveryRequest()
    {
        fluxora::installer::UpdateWorkflowRequest request;
        request.operationId = "op_update_abcdef12";
        request.handoffNonce = std::string(64, 'b');
        request.requestPath = L"C:\\runtime\\request.json";
        return request;
    }
}

TEST(RecoveryActivationTests, ArmsStrictQuotedRunOnceAndCompletesNormalInvocation)
{
    fluxora::installer::UpdateWorkflowRequest request = recoveryRequest();
    FakeRunOnceStore store;
    const fluxora::installer::RecoveryActivation activation(store);

    activation.arm(request, L"C:\\runtime\\FluxoraUpdater.exe");

    EXPECT_EQ(L"!FluxoraUpdateRecovery-op_update_abcdef12", store.setName);
    EXPECT_EQ(
        L"\"C:\\runtime\\FluxoraUpdater.exe\" --recover-request \"C:\\runtime\\request.json\"",
        store.setCommand);
    activation.complete(request);
    EXPECT_EQ(store.setName, store.removedName);
}

TEST(RecoveryActivationTests, RecoveryInvocationNeverRearmsOrDeletesRunOnce)
{
    fluxora::installer::UpdateWorkflowRequest request = recoveryRequest();
    request.recoveryInvocation = true;
    FakeRunOnceStore store;
    const fluxora::installer::RecoveryActivation activation(store);

    EXPECT_THROW(
        activation.arm(request, L"C:\\runtime\\FluxoraUpdater.exe"),
        std::logic_error);
    activation.complete(request);

    EXPECT_TRUE(store.setName.empty());
    EXPECT_TRUE(store.removedName.empty());
}

TEST(RecoveryWatchdogTests, AcceptsOnlyExactBoundedIdentityShape)
{
    const fluxora::installer::UpdateWorkflowRequest request = recoveryRequest();
    fluxora::installer::RecoveryWatchdogInvocation invocation;
    invocation.requestPath = request.requestPath;
    invocation.ownerPid = 42;
    invocation.ownerStartFileTime = 638000000000000000ULL;
    invocation.readyEventName =
        fluxora::installer::RecoveryWatchdogService::expectedReadyEventName(request);

    EXPECT_NO_THROW(
        fluxora::installer::RecoveryWatchdogService::validateInvocation(
            request,
            invocation));

    invocation.readyEventName += L"-forged";
    EXPECT_THROW(
        fluxora::installer::RecoveryWatchdogService::validateInvocation(
            request,
            invocation),
        std::invalid_argument);
}
