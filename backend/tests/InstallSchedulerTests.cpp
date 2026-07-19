#include "FluxoraCore/Services/InstallScheduler.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

namespace fluxora
{
    namespace
    {
        using namespace std::chrono_literals;

        bool waitUntil(
            std::condition_variable& changed,
            std::unique_lock<std::mutex>& lock,
            const std::function<bool()>& predicate)
        {
            return changed.wait_for(lock, 2s, predicate);
        }
    }

    TEST(InstallSchedulerTests, RunsTwoHeavyTasksWhileKeepingTheThirdQueued)
    {
        InstallScheduler scheduler(2);
        std::mutex mutex;
        std::condition_variable changed;
        int runningCount = 0;
        bool release = false;

        const auto submit = [&](std::wstring operationId, std::wstring targetKey)
        {
            scheduler.submit(InstallScheduledTask{
                std::move(operationId),
                std::move(targetKey),
                [&]
                {
                    std::unique_lock lock(mutex);
                    ++runningCount;
                    changed.notify_all();
                    changed.wait(lock, [&] { return release; });
                },
                {}});
        };

        submit(L"op-a", L"target-a");
        submit(L"op-b", L"target-b");
        submit(L"op-c", L"target-c");

        std::unique_lock lock(mutex);
        ASSERT_TRUE(waitUntil(changed, lock, [&] { return runningCount == 2; }));
        EXPECT_EQ(scheduler.activeCount(), 2U);
        EXPECT_EQ(scheduler.queuedCount(), 1U);
        release = true;
        lock.unlock();
        changed.notify_all();
        scheduler.shutdown();
    }

    TEST(InstallSchedulerTests, SameTargetWaitsWithoutBlockingAnotherTarget)
    {
        InstallScheduler scheduler(2);
        std::mutex mutex;
        std::condition_variable changed;
        std::set<std::wstring> running;
        std::vector<InstallSchedulerTaskState> secondStates;
        bool release = false;

        const auto task = [&](std::wstring operationId, std::wstring targetKey, bool observe)
        {
            const std::wstring capturedOperationId = operationId;
            scheduler.submit(InstallScheduledTask{
                std::move(operationId),
                std::move(targetKey),
                [&, capturedOperationId]
                {
                    std::unique_lock lock(mutex);
                    running.insert(capturedOperationId);
                    changed.notify_all();
                    changed.wait(lock, [&] { return release; });
                },
                observe
                    ? std::function<void(InstallSchedulerTaskState)>([&](InstallSchedulerTaskState state)
                    {
                        std::lock_guard lock(mutex);
                        secondStates.push_back(state);
                        changed.notify_all();
                    })
                    : std::function<void(InstallSchedulerTaskState)>{}});
        };

        task(L"op-first", L"same-target", false);
        {
            std::unique_lock lock(mutex);
            ASSERT_TRUE(waitUntil(changed, lock, [&] { return running.contains(L"op-first"); }));
        }
        task(L"op-second", L"same-target", true);
        task(L"op-other", L"other-target", false);

        std::unique_lock lock(mutex);
        ASSERT_TRUE(waitUntil(changed, lock, [&]
        {
            return running.contains(L"op-other") && !secondStates.empty();
        }));
        EXPECT_FALSE(running.contains(L"op-second"));
        EXPECT_EQ(secondStates.front(), InstallSchedulerTaskState::WaitingTarget);
        release = true;
        lock.unlock();
        changed.notify_all();
        scheduler.shutdown();
    }

    TEST(InstallSchedulerTests, CancelsQueuedTaskBeforeItCanRun)
    {
        InstallScheduler scheduler(1);
        std::mutex mutex;
        std::condition_variable changed;
        bool firstRunning = false;
        bool releaseFirst = false;
        bool cancelledTaskRan = false;

        scheduler.submit(InstallScheduledTask{
            L"op-running",
            L"target-running",
            [&]
            {
                std::unique_lock lock(mutex);
                firstRunning = true;
                changed.notify_all();
                changed.wait(lock, [&] { return releaseFirst; });
            },
            {}});
        scheduler.submit(InstallScheduledTask{
            L"op-cancelled",
            L"target-cancelled",
            [&] { cancelledTaskRan = true; },
            {}});

        {
            std::unique_lock lock(mutex);
            ASSERT_TRUE(waitUntil(changed, lock, [&] { return firstRunning; }));
        }
        ASSERT_EQ(scheduler.queuedCount(), 1U);

        EXPECT_TRUE(scheduler.cancel(L"op-cancelled"));
        EXPECT_FALSE(scheduler.cancel(L"op-cancelled"));
        EXPECT_EQ(scheduler.queuedCount(), 0U);

        {
            std::lock_guard lock(mutex);
            releaseFirst = true;
        }
        changed.notify_all();
        scheduler.shutdown();
        EXPECT_FALSE(cancelledTaskRan);
    }
}
