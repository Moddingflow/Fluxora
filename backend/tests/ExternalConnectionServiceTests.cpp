#include "FluxoraCore/Services/ExternalConnectionService.hpp"
#include "FluxoraCore/Services/Logger.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <atomic>
#include <functional>
#include <memory>
#include <thread>

namespace fluxora::tests
{
    namespace
    {
        class FakeConnectionProvider : public IExternalConnectionProvider
        {
        public:
            FakeConnectionProvider(std::wstring id, std::chrono::milliseconds delay)
                : id_(std::move(id)), delay_(delay)
            {
            }

            std::wstring providerId() const override { return id_; }

            ExternalConnectionStatus localStatus(std::wstring_view operationId) const override
            {
                return ExternalConnectionStatus{
                    id_, id_, ExternalConnectionState::Restoring, L"Test user", true, true, false,
                    L"Restoring", {}, std::wstring(operationId)
                };
            }

            ExternalConnectionStatus restore(const ExternalConnectionRestoreContext& context) override
            {
                std::this_thread::sleep_for(delay_);
                ExternalConnectionStatus status = localStatus(context.operationId);
                status.state = ExternalConnectionState::Ready;
                status.retryable = false;
                status.message = L"Ready";
                return status;
            }

            ExternalConnectionStatus connect(std::wstring_view operationId) override
            {
                ExternalConnectionStatus status = localStatus(operationId);
                status.state = ExternalConnectionState::Ready;
                return status;
            }

            ExternalConnectionStatus disconnect(std::wstring_view operationId) override
            {
                ExternalConnectionStatus status = localStatus(operationId);
                status.state = ExternalConnectionState::NotLinked;
                status.hasStoredSession = false;
                return status;
            }

        private:
            std::wstring id_;
            std::chrono::milliseconds delay_;
        };

        class ObservedConnectionProvider final : public FakeConnectionProvider
        {
        public:
            ObservedConnectionProvider(
                std::wstring id,
                std::chrono::milliseconds delay,
                std::function<void()> onRestore,
                std::function<void()> onComplete = {})
                : FakeConnectionProvider(std::move(id), delay),
                  onRestore_(std::move(onRestore)),
                  onComplete_(std::move(onComplete))
            {
            }

            ExternalConnectionStatus restore(const ExternalConnectionRestoreContext& context) override
            {
                onRestore_();
                ExternalConnectionStatus status = FakeConnectionProvider::restore(context);
                if (onComplete_)
                {
                    onComplete_();
                }
                return status;
            }

        private:
            std::function<void()> onRestore_;
            std::function<void()> onComplete_;
        };
    }

    TEST(ExternalConnectionServiceTests, RestoresProvidersInParallelWithinOneDeadline)
    {
        Logger logger;
        ExternalConnectionService service(logger);
        service.registerProvider(std::make_shared<FakeConnectionProvider>(L"first", std::chrono::milliseconds(70)));
        service.registerProvider(std::make_shared<FakeConnectionProvider>(L"second", std::chrono::milliseconds(70)));

        const auto started = std::chrono::steady_clock::now();
        const ExternalConnectionSnapshot snapshot = service.restoreAll(
            L"op_parallel",
            std::chrono::milliseconds(250));
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started);

        ASSERT_EQ(snapshot.providers.size(), 2U);
        EXPECT_EQ(snapshot.providers[0].state, ExternalConnectionState::Ready);
        EXPECT_EQ(snapshot.providers[1].state, ExternalConnectionState::Ready);
        EXPECT_LT(elapsed, std::chrono::milliseconds(130));
        EXPECT_FALSE(snapshot.timedOut);
    }

    TEST(ExternalConnectionServiceTests, SharedDeadlineReturnsRetryableUnavailableWithoutWaitingForHungProvider)
    {
        Logger logger;
        ExternalConnectionService service(logger);
        service.registerProvider(std::make_shared<FakeConnectionProvider>(L"hung", std::chrono::milliseconds(250)));

        const auto started = std::chrono::steady_clock::now();
        const ExternalConnectionSnapshot snapshot = service.restoreAll(
            L"op_timeout",
            std::chrono::milliseconds(35));
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started);

        ASSERT_EQ(snapshot.providers.size(), 1U);
        EXPECT_EQ(snapshot.providers[0].state, ExternalConnectionState::TemporarilyUnavailable);
        EXPECT_TRUE(snapshot.providers[0].retryable);
        EXPECT_TRUE(snapshot.providers[0].hasStoredSession);
        EXPECT_TRUE(snapshot.timedOut);
        EXPECT_LT(elapsed, std::chrono::milliseconds(100));
    }

    TEST(ExternalConnectionServiceTests, UnlinkedProviderDoesNotConsumeRestoreDeadline)
    {
        class UnlinkedProvider final : public FakeConnectionProvider
        {
        public:
            UnlinkedProvider() : FakeConnectionProvider(L"unlinked", std::chrono::seconds(1)) {}
            ExternalConnectionStatus localStatus(std::wstring_view operationId) const override
            {
                ExternalConnectionStatus status = FakeConnectionProvider::localStatus(operationId);
                status.state = ExternalConnectionState::NotLinked;
                status.hasStoredSession = false;
                status.retryable = false;
                return status;
            }
        };

        Logger logger;
        ExternalConnectionService service(logger);
        service.registerProvider(std::make_shared<UnlinkedProvider>());
        const ExternalConnectionSnapshot snapshot = service.restoreAll(
            L"op_unlinked",
            std::chrono::milliseconds(35));

        ASSERT_EQ(snapshot.providers.size(), 1U);
        EXPECT_EQ(snapshot.providers[0].state, ExternalConnectionState::NotLinked);
        EXPECT_FALSE(snapshot.timedOut);
        EXPECT_LT(snapshot.durationMs, 20);
    }

    TEST(ExternalConnectionServiceTests, OneRestorePerProviderLetsNexusCompleteBeforeModdingFlowDeadline)
    {
        Logger logger;
        ExternalConnectionService service(logger);
        std::atomic<int> moddingFlowRestores{0};
        std::atomic<int> nexusRestores{0};
        std::atomic<long long> nexusCompletedAfterMs{-1};
        const auto started = std::chrono::steady_clock::now();
        service.registerProvider(std::make_shared<ObservedConnectionProvider>(
            L"moddingflow",
            std::chrono::milliseconds(200),
            [&] { ++moddingFlowRestores; }));
        service.registerProvider(std::make_shared<ObservedConnectionProvider>(
            L"nexus",
            std::chrono::milliseconds(0),
            [&] { ++nexusRestores; },
            [&]
            {
                nexusCompletedAfterMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - started).count();
            }));

        const ExternalConnectionSnapshot snapshot = service.restoreAll(
            L"startup-connection-restore",
            std::chrono::milliseconds(35));

        ASSERT_EQ(snapshot.providers.size(), 2U);
        EXPECT_EQ(moddingFlowRestores.load(), 1);
        EXPECT_EQ(nexusRestores.load(), 1);
        EXPECT_GE(nexusCompletedAfterMs.load(), 0);
        EXPECT_LT(nexusCompletedAfterMs.load(), 30);
        EXPECT_EQ(snapshot.providers[0].state, ExternalConnectionState::TemporarilyUnavailable);
        EXPECT_EQ(snapshot.providers[1].state, ExternalConnectionState::Ready);
        EXPECT_TRUE(snapshot.timedOut);
        EXPECT_LT(snapshot.durationMs, 100);
    }

    TEST(ExternalConnectionServiceTests, DedicatedRestoreTouchesOnlyRequestedProviderAndKeepsDeadline)
    {
        Logger logger;
        ExternalConnectionService service(logger);
        std::atomic<int> moddingFlowRestores{0};
        std::atomic<int> nexusRestores{0};
        service.registerProvider(std::make_shared<ObservedConnectionProvider>(
            L"moddingflow",
            std::chrono::milliseconds(250),
            [&] { ++moddingFlowRestores; }));
        service.registerProvider(std::make_shared<ObservedConnectionProvider>(
            L"nexus",
            std::chrono::milliseconds(0),
            [&] { ++nexusRestores; }));

        const auto started = std::chrono::steady_clock::now();
        const ExternalConnectionStatus status = service.restoreProvider(
            L"moddingflow",
            L"operation-moddingflow-only",
            std::chrono::milliseconds(35),
            3U);
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started);

        EXPECT_EQ(moddingFlowRestores.load(), 1);
        EXPECT_EQ(nexusRestores.load(), 0);
        EXPECT_EQ(status.providerId, L"moddingflow");
        EXPECT_EQ(status.operationId, L"operation-moddingflow-only");
        EXPECT_EQ(status.state, ExternalConnectionState::TemporarilyUnavailable);
        EXPECT_TRUE(status.retryable);
        EXPECT_LT(elapsed, std::chrono::milliseconds(100));
    }
}
