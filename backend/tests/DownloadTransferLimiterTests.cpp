#include "FluxoraCore/Services/DownloadTransferLimiter.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <thread>
#include <vector>

namespace fluxora
{
    TEST(DownloadTransferLimiterTests, SixthTransferCannotStartUntilOneOfFiveSlotsIsReleased)
    {
        DownloadTransferLimiter limiter;
        std::vector<DownloadTransferLimiter::Permit> activeTransfers;
        activeTransfers.reserve(
            static_cast<std::size_t>(DownloadTransferLimiter::MaximumActiveTransfers));

        for (std::ptrdiff_t index = 0;
             index < DownloadTransferLimiter::MaximumActiveTransfers;
             ++index)
        {
            activeTransfers.push_back(limiter.acquire());
        }

        EXPECT_EQ(DownloadTransferLimiter::MaximumActiveTransfers, 5);
        EXPECT_FALSE(limiter.tryAcquire().has_value());

        activeTransfers.pop_back();
        EXPECT_TRUE(limiter.tryAcquire().has_value());
    }

    TEST(DownloadTransferLimiterTests, FiftyTransfersNeverExceedFiveActiveSlots)
    {
        DownloadTransferLimiter limiter;
        constexpr std::size_t jobCount = 50;

        std::mutex mutex;
        std::condition_variable changed;
        std::size_t attemptedCount = 0;
        std::size_t activeCount = 0;
        std::size_t completedCount = 0;
        std::size_t maximumObserved = 0;
        bool releaseTransfers = false;

        std::vector<std::thread> jobs;
        jobs.reserve(jobCount);
        try
        {
            for (std::size_t index = 0; index < jobCount; ++index)
            {
                jobs.emplace_back([&]()
                {
                    {
                        std::lock_guard lock(mutex);
                        ++attemptedCount;
                        changed.notify_all();
                    }

                    auto permit = limiter.acquire();
                    std::unique_lock lock(mutex);
                    ++activeCount;
                    maximumObserved = std::max(maximumObserved, activeCount);
                    changed.notify_all();
                    changed.wait(lock, [&]()
                    {
                        return releaseTransfers;
                    });
                    --activeCount;
                    ++completedCount;
                });
            }
        }
        catch (...)
        {
            {
                std::lock_guard lock(mutex);
                releaseTransfers = true;
            }
            changed.notify_all();
            for (std::thread& job : jobs)
            {
                job.join();
            }
            throw;
        }

        std::size_t activeBeforeRelease = 0;
        bool reachedFiveActiveTransfers = false;
        {
            std::unique_lock lock(mutex);
            reachedFiveActiveTransfers = changed.wait_for(
                lock,
                std::chrono::seconds(5),
                [&]()
                {
                    return attemptedCount == jobCount &&
                        activeCount == static_cast<std::size_t>(
                            DownloadTransferLimiter::MaximumActiveTransfers);
                });
            activeBeforeRelease = activeCount;
            releaseTransfers = true;
        }
        changed.notify_all();

        for (std::thread& job : jobs)
        {
            job.join();
        }

        EXPECT_TRUE(reachedFiveActiveTransfers);
        EXPECT_EQ(DownloadTransferLimiter::MaximumActiveTransfers, 5);
        EXPECT_EQ(activeBeforeRelease, 5U);
        EXPECT_EQ(maximumObserved, 5U);
        EXPECT_EQ(completedCount, jobCount);
    }

    TEST(DownloadTransferLimiterTests, FailedTransferReturnsItsSlot)
    {
        DownloadTransferLimiter limiter;
        try
        {
            auto permit = limiter.acquire();
            throw std::runtime_error("simulated transfer failure");
        }
        catch (const std::runtime_error&)
        {
        }

        std::vector<DownloadTransferLimiter::Permit> activeTransfers;
        activeTransfers.reserve(
            static_cast<std::size_t>(DownloadTransferLimiter::MaximumActiveTransfers));
        for (std::ptrdiff_t index = 0;
             index < DownloadTransferLimiter::MaximumActiveTransfers;
             ++index)
        {
            std::optional<DownloadTransferLimiter::Permit> permit = limiter.tryAcquire();
            ASSERT_TRUE(permit.has_value());
            activeTransfers.push_back(std::move(*permit));
        }

        EXPECT_FALSE(limiter.tryAcquire().has_value());
    }
}
