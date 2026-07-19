#include "FluxoraCore/Services/InstallScheduler.hpp"

#include <algorithm>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <set>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

namespace fluxora
{
    struct InstallScheduler::State final
    {
        struct PendingTask
        {
            InstallScheduledTask task;
            InstallSchedulerTaskState state{InstallSchedulerTaskState::Queued};
        };

        std::mutex mutex;
        std::condition_variable changed;
        std::deque<PendingTask> pending;
        std::set<std::wstring> activeTargets;
        std::set<std::wstring> knownOperations;
        std::vector<std::thread> workers;
        std::size_t activeTasks{0};
        bool accepting{true};
        bool stopping{false};
    };

    namespace
    {
        bool targetIsActive(
            const InstallScheduler::State& state,
            const std::wstring& targetKey)
        {
            return !targetKey.empty() && state.activeTargets.contains(targetKey);
        }

        bool targetIsAlreadyPending(
            const InstallScheduler::State& state,
            const std::wstring& targetKey)
        {
            return !targetKey.empty() && std::any_of(
                state.pending.begin(),
                state.pending.end(),
                [&targetKey](const InstallScheduler::State::PendingTask& pending)
                {
                    return pending.task.targetKey == targetKey;
                });
        }

        auto firstRunnableTask(InstallScheduler::State& state)
        {
            return std::find_if(
                state.pending.begin(),
                state.pending.end(),
                [&state](const InstallScheduler::State::PendingTask& pending)
                {
                    return !targetIsActive(state, pending.task.targetKey);
                });
        }

        void notifyState(
            const InstallScheduledTask& task,
            InstallSchedulerTaskState state) noexcept
        {
            if (!task.stateChanged)
            {
                return;
            }
            try
            {
                task.stateChanged(state);
            }
            catch (...)
            {
                // State publication must never stop the scheduler.
            }
        }

        void runWorker(InstallScheduler::State& state) noexcept
        {
            while (true)
            {
                InstallScheduledTask task;
                {
                    std::unique_lock lock(state.mutex);
                    state.changed.wait(lock, [&state]
                    {
                        return (state.stopping && state.pending.empty()) ||
                            firstRunnableTask(state) != state.pending.end();
                    });
                    if (state.stopping && state.pending.empty())
                    {
                        return;
                    }

                    const auto selected = firstRunnableTask(state);
                    if (selected == state.pending.end())
                    {
                        continue;
                    }
                    task = std::move(selected->task);
                    state.pending.erase(selected);
                    if (!task.targetKey.empty())
                    {
                        state.activeTargets.insert(task.targetKey);
                    }
                    ++state.activeTasks;
                }

                notifyState(task, InstallSchedulerTaskState::Running);
                try
                {
                    task.execute();
                }
                catch (...)
                {
                    // The operation module owns its terminal error state. A
                    // failed task must still release the target reservation.
                }

                {
                    std::lock_guard lock(state.mutex);
                    if (!task.targetKey.empty())
                    {
                        state.activeTargets.erase(task.targetKey);
                    }
                    state.knownOperations.erase(task.operationId);
                    if (state.activeTasks > 0)
                    {
                        --state.activeTasks;
                    }
                }
                state.changed.notify_all();
            }
        }
    }

    InstallScheduler::InstallScheduler(std::size_t workerCount)
        : state_(std::make_unique<State>())
    {
        if (workerCount == 0)
        {
            throw std::invalid_argument("Install scheduler requires at least one worker.");
        }
        state_->workers.reserve(workerCount);
        for (std::size_t index = 0; index < workerCount; ++index)
        {
            state_->workers.emplace_back([state = state_.get()]
            {
                runWorker(*state);
            });
        }
    }

    InstallScheduler::~InstallScheduler()
    {
        shutdown();
    }

    void InstallScheduler::submit(InstallScheduledTask task)
    {
        if (task.operationId.empty() || !task.execute)
        {
            throw std::invalid_argument(
                "An install task requires an operation id and executable work.");
        }

        InstallSchedulerTaskState initialState = InstallSchedulerTaskState::Queued;
        {
            std::lock_guard lock(state_->mutex);
            if (!state_->accepting)
            {
                throw std::runtime_error("The install scheduler is shutting down.");
            }
            if (state_->knownOperations.contains(task.operationId))
            {
                throw std::invalid_argument("The install operation is already scheduled.");
            }

            if (targetIsActive(*state_, task.targetKey) ||
                targetIsAlreadyPending(*state_, task.targetKey))
            {
                initialState = InstallSchedulerTaskState::WaitingTarget;
            }
            state_->knownOperations.insert(task.operationId);
            state_->pending.push_back(State::PendingTask{task, initialState});
        }
        notifyState(task, initialState);
        state_->changed.notify_all();
    }

    bool InstallScheduler::cancel(std::wstring_view operationId)
    {
        if (operationId.empty())
        {
            return false;
        }

        std::lock_guard lock(state_->mutex);
        const auto pending = std::find_if(
            state_->pending.begin(),
            state_->pending.end(),
            [operationId](const State::PendingTask& candidate)
            {
                return candidate.task.operationId == operationId;
            });
        if (pending == state_->pending.end())
        {
            return false;
        }

        state_->knownOperations.erase(pending->task.operationId);
        state_->pending.erase(pending);
        state_->changed.notify_all();
        return true;
    }

    void InstallScheduler::shutdown() noexcept
    {
        if (!state_)
        {
            return;
        }
        {
            std::lock_guard lock(state_->mutex);
            if (!state_->accepting && state_->stopping)
            {
                return;
            }
            state_->accepting = false;
            state_->stopping = true;
        }
        state_->changed.notify_all();
        for (std::thread& worker : state_->workers)
        {
            if (worker.joinable())
            {
                worker.join();
            }
        }
        state_->workers.clear();
    }

    std::size_t InstallScheduler::activeCount() const noexcept
    {
        std::lock_guard lock(state_->mutex);
        return state_->activeTasks;
    }

    std::size_t InstallScheduler::queuedCount() const noexcept
    {
        std::lock_guard lock(state_->mutex);
        return state_->pending.size();
    }
}
