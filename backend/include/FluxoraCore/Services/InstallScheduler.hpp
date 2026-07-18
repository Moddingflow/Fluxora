#pragma once

#include <cstddef>
#include <functional>
#include <memory>
#include <string>

namespace fluxora
{
    enum class InstallSchedulerTaskState
    {
        Queued,
        WaitingTarget,
        Running
    };

    struct InstallScheduledTask
    {
        std::wstring operationId;
        std::wstring targetKey;
        std::function<void()> execute;
        std::function<void(InstallSchedulerTaskState)> stateChanged;
    };

    class InstallScheduler final
    {
    public:
        struct State;

        static constexpr std::size_t DefaultWorkerCount = 2;

        explicit InstallScheduler(std::size_t workerCount = DefaultWorkerCount);
        ~InstallScheduler();

        InstallScheduler(const InstallScheduler&) = delete;
        InstallScheduler& operator=(const InstallScheduler&) = delete;

        void submit(InstallScheduledTask task);
        void shutdown() noexcept;

        [[nodiscard]] std::size_t activeCount() const noexcept;
        [[nodiscard]] std::size_t queuedCount() const noexcept;

    private:
        std::unique_ptr<State> state_;
    };
}
