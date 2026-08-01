#pragma once

#include "FluxoraCore/Services/IService.hpp"

#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace fluxora
{
    class Logger;
    class NexusModsAuthService;

    enum class ExternalConnectionState
    {
        NotConfigured,
        NotLinked,
        Connecting,
        Restoring,
        Ready,
        TemporarilyUnavailable,
        ReauthRequired
    };

    struct ExternalConnectionStatus
    {
        std::wstring providerId;
        std::wstring label;
        ExternalConnectionState state{ExternalConnectionState::NotConfigured};
        std::wstring accountName;
        bool hasStoredSession{false};
        bool retryable{false};
        bool requiresUserAction{false};
        std::wstring message;
        std::wstring checkedAtUtc;
        std::wstring operationId;
    };

    struct ExternalConnectionSnapshot
    {
        std::vector<ExternalConnectionStatus> providers;
        std::wstring requestedAtUtc;
        std::wstring completedAtUtc;
        long long durationMs{0};
        bool timedOut{false};
        std::wstring operationId;
    };

    struct ExternalConnectionRestoreContext
    {
        std::chrono::steady_clock::time_point deadline;
        std::wstring operationId;
        std::size_t attempt{1};
    };

    class IExternalConnectionProvider
    {
    public:
        virtual ~IExternalConnectionProvider() = default;

        [[nodiscard]] virtual std::wstring providerId() const = 0;
        [[nodiscard]] virtual ExternalConnectionStatus localStatus(
            std::wstring_view operationId) const = 0;
        [[nodiscard]] virtual ExternalConnectionStatus restore(
            const ExternalConnectionRestoreContext& context) = 0;
        [[nodiscard]] virtual ExternalConnectionStatus connect(
            std::wstring_view operationId) = 0;
        [[nodiscard]] virtual ExternalConnectionStatus disconnect(
            std::wstring_view operationId) = 0;
    };

    class ExternalConnectionService final : public IService
    {
    public:
        explicit ExternalConnectionService(Logger& logger) noexcept;
        ~ExternalConnectionService() override;

        void initialize() override;
        void shutdown() override;

        void registerProvider(std::shared_ptr<IExternalConnectionProvider> provider);
        [[nodiscard]] ExternalConnectionSnapshot listStatus(std::wstring_view operationId) const;
        [[nodiscard]] ExternalConnectionSnapshot restoreAll(
            std::wstring_view operationId,
            std::chrono::milliseconds deadline = std::chrono::milliseconds(2500),
            std::size_t attempt = 1);
        [[nodiscard]] ExternalConnectionStatus restoreProvider(
            std::wstring_view providerId,
            std::wstring_view operationId,
            std::chrono::milliseconds deadline = std::chrono::milliseconds(2500),
            std::size_t attempt = 1);
        [[nodiscard]] ExternalConnectionStatus connect(
            std::wstring_view providerId,
            std::wstring_view operationId);
        [[nodiscard]] ExternalConnectionStatus disconnect(
            std::wstring_view providerId,
            std::wstring_view operationId);

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        [[nodiscard]] std::shared_ptr<IExternalConnectionProvider> findProvider(
            std::wstring_view providerId) const;
        void logTransition(
            const ExternalConnectionStatus& status,
            std::size_t attempt,
            long long durationMs);

        Logger& logger_;
        mutable std::mutex mutex_;
        std::vector<std::shared_ptr<IExternalConnectionProvider>> providers_;
        std::vector<std::thread> restoreWorkers_;
        std::unordered_map<std::wstring, ExternalConnectionState> loggedStates_;
        bool initialized_{false};
    };

    [[nodiscard]] std::shared_ptr<IExternalConnectionProvider>
    createNexusExternalConnectionProvider(NexusModsAuthService& auth);

    [[nodiscard]] std::wstring_view externalConnectionStateName(
        ExternalConnectionState state) noexcept;
}
