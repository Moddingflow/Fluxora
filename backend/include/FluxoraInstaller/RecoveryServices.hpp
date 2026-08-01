#pragma once

#include "FluxoraInstaller\UpdateWorkflowRequest.hpp"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>

namespace fluxora::installer
{
    class IRunOnceStore
    {
    public:
        virtual ~IRunOnceStore() = default;
        virtual void set(std::wstring_view name, std::wstring_view command) = 0;
        virtual void remove(std::wstring_view name) = 0;
    };

    class WindowsRunOnceStore final : public IRunOnceStore
    {
    public:
        void set(std::wstring_view name, std::wstring_view command) override;
        void remove(std::wstring_view name) override;
    };

    class RecoveryActivation final
    {
    public:
        explicit RecoveryActivation(IRunOnceStore& store);

        void arm(
            const UpdateWorkflowRequest& request,
            const std::filesystem::path& updaterExecutable) const;
        void complete(const UpdateWorkflowRequest& request) const;

        [[nodiscard]] static std::wstring valueName(
            const UpdateWorkflowRequest& request);
        [[nodiscard]] static std::wstring recoveryCommand(
            const UpdateWorkflowRequest& request,
            const std::filesystem::path& updaterExecutable);

    private:
        IRunOnceStore& store_;
    };

    struct RecoveryWatchdogInvocation final
    {
        std::filesystem::path requestPath;
        std::uint32_t ownerPid{0};
        std::uint64_t ownerStartFileTime{0};
        std::wstring readyEventName;
    };

    class RecoveryWatchdogService final
    {
    public:
        void arm(
            const UpdateWorkflowRequest& request,
            const std::filesystem::path& updaterExecutable) const;

        void run(
            const UpdateWorkflowRequest& request,
            const std::filesystem::path& updaterExecutable,
            const RecoveryWatchdogInvocation& invocation,
            const std::function<void()>& recover) const;

        [[nodiscard]] static std::wstring expectedReadyEventName(
            const UpdateWorkflowRequest& request);
        static void validateInvocation(
            const UpdateWorkflowRequest& request,
            const RecoveryWatchdogInvocation& invocation);
    };
}
