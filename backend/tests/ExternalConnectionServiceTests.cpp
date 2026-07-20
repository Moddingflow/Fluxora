#include "FluxoraCore/Services/ExternalConnectionService.hpp"
#include "FluxoraCore/Services/Logger.hpp"

#include <gtest/gtest.h>

#include <chrono>
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
}
