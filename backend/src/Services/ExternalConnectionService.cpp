#include "FluxoraCore/Services/ExternalConnectionService.hpp"

#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/NexusModsAuthService.hpp"

#include <algorithm>
#include <ctime>
#include <future>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <thread>

namespace fluxora
{
    namespace
    {
        std::wstring nowUtcIso()
        {
            const std::time_t now = std::time(nullptr);
            std::tm utc{};
#ifdef _WIN32
            gmtime_s(&utc, &now);
#else
            gmtime_r(&now, &utc);
#endif
            std::wostringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
        }

        std::string narrowAscii(std::wstring_view value)
        {
            std::string result;
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                result.push_back(character >= 0 && character <= 127
                    ? static_cast<char>(character)
                    : '?');
            }
            return result;
        }

        ExternalConnectionStatus timedOutStatus(
            ExternalConnectionStatus local,
            std::wstring_view operationId)
        {
            local.state = ExternalConnectionState::TemporarilyUnavailable;
            local.retryable = true;
            local.requiresUserAction = false;
            local.message = L"Connection restore timed out. Fluxora will retry in the background.";
            local.checkedAtUtc = nowUtcIso();
            local.operationId = operationId;
            return local;
        }

        ExternalConnectionStatus failedStatus(
            ExternalConnectionStatus local,
            std::wstring_view operationId)
        {
            local.state = ExternalConnectionState::TemporarilyUnavailable;
            local.retryable = true;
            local.requiresUserAction = false;
            local.message = L"Connection restore failed temporarily. Fluxora will retry in the background.";
            local.checkedAtUtc = nowUtcIso();
            local.operationId = operationId;
            return local;
        }

        class NexusExternalConnectionProvider final : public IExternalConnectionProvider
        {
        public:
            explicit NexusExternalConnectionProvider(NexusModsAuthService& auth) noexcept
                : auth_(auth)
            {
            }

            [[nodiscard]] std::wstring providerId() const override
            {
                return L"nexus";
            }

            [[nodiscard]] ExternalConnectionStatus localStatus(
                std::wstring_view operationId) const override
            {
                const NexusModsConnectionStatus status = auth_.connectionStatus();
                return map(status, operationId);
            }

            [[nodiscard]] ExternalConnectionStatus restore(
                const ExternalConnectionRestoreContext& context) override
            {
                return map(auth_.restoreStoredSession(context.deadline), context.operationId);
            }

            [[nodiscard]] ExternalConnectionStatus connect(
                std::wstring_view operationId) override
            {
                auth_.connect();
                return map(auth_.connectionStatus(), operationId);
            }

            [[nodiscard]] ExternalConnectionStatus disconnect(
                std::wstring_view operationId) override
            {
                auth_.disconnect();
                return map(auth_.connectionStatus(), operationId);
            }

        private:
            static ExternalConnectionState mapState(NexusModsConnectionState state)
            {
                switch (state)
                {
                case NexusModsConnectionState::NotConfigured:
                    return ExternalConnectionState::NotConfigured;
                case NexusModsConnectionState::NotLinked:
                    return ExternalConnectionState::NotLinked;
                case NexusModsConnectionState::Restoring:
                    return ExternalConnectionState::Restoring;
                case NexusModsConnectionState::Ready:
                    return ExternalConnectionState::Ready;
                case NexusModsConnectionState::TemporarilyUnavailable:
                    return ExternalConnectionState::TemporarilyUnavailable;
                case NexusModsConnectionState::ReauthRequired:
                    return ExternalConnectionState::ReauthRequired;
                }
                return ExternalConnectionState::TemporarilyUnavailable;
            }

            static ExternalConnectionStatus map(
                const NexusModsConnectionStatus& status,
                std::wstring_view operationId)
            {
                return ExternalConnectionStatus{
                    L"nexus",
                    L"Nexus Mods",
                    mapState(status.state),
                    status.accountName,
                    status.hasStoredSession,
                    status.retryable,
                    status.requiresUserAction,
                    status.message,
                    nowUtcIso(),
                    std::wstring(operationId)
                };
            }

            NexusModsAuthService& auth_;
        };
    }

    std::wstring_view externalConnectionStateName(ExternalConnectionState state) noexcept
    {
        switch (state)
        {
        case ExternalConnectionState::NotConfigured: return L"notConfigured";
        case ExternalConnectionState::NotLinked: return L"notLinked";
        case ExternalConnectionState::Restoring: return L"restoring";
        case ExternalConnectionState::Ready: return L"ready";
        case ExternalConnectionState::TemporarilyUnavailable: return L"temporarilyUnavailable";
        case ExternalConnectionState::ReauthRequired: return L"reauthRequired";
        }
        return L"temporarilyUnavailable";
    }

    ExternalConnectionService::ExternalConnectionService(Logger& logger) noexcept
        : logger_(logger)
    {
    }

    ExternalConnectionService::~ExternalConnectionService()
    {
        shutdown();
    }

    void ExternalConnectionService::initialize()
    {
        initialized_ = true;
        logger_.write(LogLevel::Info, "External connection service initialized.");
    }

    void ExternalConnectionService::shutdown()
    {
        const bool wasInitialized = initialized_;
        initialized_ = false;
        std::vector<std::thread> workers;
        {
            std::lock_guard lock(mutex_);
            workers = std::move(restoreWorkers_);
        }
        for (std::thread& worker : workers)
        {
            if (worker.joinable())
            {
                worker.join();
            }
        }
        if (wasInitialized)
        {
            logger_.write(LogLevel::Info, "External connection service shut down.");
        }
    }

    void ExternalConnectionService::registerProvider(
        std::shared_ptr<IExternalConnectionProvider> provider)
    {
        if (!provider || provider->providerId().empty())
        {
            throw std::invalid_argument("External connection provider id is required.");
        }
        std::lock_guard lock(mutex_);
        const std::wstring id = provider->providerId();
        if (std::any_of(providers_.begin(), providers_.end(), [&](const auto& current)
        {
            return current->providerId() == id;
        }))
        {
            throw std::invalid_argument("External connection provider is already registered.");
        }
        providers_.push_back(std::move(provider));
    }

    ExternalConnectionSnapshot ExternalConnectionService::listStatus(
        std::wstring_view operationId) const
    {
        const auto started = std::chrono::steady_clock::now();
        ExternalConnectionSnapshot snapshot;
        snapshot.requestedAtUtc = nowUtcIso();
        snapshot.operationId = operationId;
        std::vector<std::shared_ptr<IExternalConnectionProvider>> providers;
        {
            std::lock_guard lock(mutex_);
            providers = providers_;
        }
        snapshot.providers.reserve(providers.size());
        for (const auto& provider : providers)
        {
            snapshot.providers.push_back(provider->localStatus(operationId));
        }
        snapshot.completedAtUtc = nowUtcIso();
        snapshot.durationMs = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count();
        return snapshot;
    }

    ExternalConnectionSnapshot ExternalConnectionService::restoreAll(
        std::wstring_view operationId,
        std::chrono::milliseconds deadline,
        std::size_t attempt)
    {
        const auto started = std::chrono::steady_clock::now();
        const auto restoreDeadline = started + std::max(deadline, std::chrono::milliseconds(1));
        ExternalConnectionSnapshot snapshot;
        snapshot.requestedAtUtc = nowUtcIso();
        snapshot.operationId = operationId;

        std::vector<std::shared_ptr<IExternalConnectionProvider>> providers;
        {
            std::lock_guard lock(mutex_);
            providers = providers_;
        }

        struct PendingRestore
        {
            std::size_t providerIndex;
            ExternalConnectionStatus local;
            std::future<ExternalConnectionStatus> future;
            std::thread worker;
        };
        std::vector<PendingRestore> pending;
        snapshot.providers.resize(providers.size());
        for (std::size_t providerIndex = 0; providerIndex < providers.size(); ++providerIndex)
        {
            const auto& provider = providers[providerIndex];
            ExternalConnectionStatus local = provider->localStatus(operationId);
            if (!local.hasStoredSession ||
                local.state == ExternalConnectionState::NotConfigured ||
                local.state == ExternalConnectionState::NotLinked ||
                local.state == ExternalConnectionState::ReauthRequired)
            {
                logTransition(
                    local,
                    attempt,
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - started).count());
                snapshot.providers[providerIndex] = std::move(local);
                continue;
            }

            std::promise<ExternalConnectionStatus> promise;
            std::future<ExternalConnectionStatus> future = promise.get_future();
            const ExternalConnectionRestoreContext context{
                restoreDeadline,
                std::wstring(operationId),
                attempt
            };
            std::thread worker(
                [provider, context, promise = std::move(promise)]() mutable
                {
                    try
                    {
                        promise.set_value(provider->restore(context));
                    }
                    catch (...)
                    {
                        promise.set_exception(std::current_exception());
                    }
                });
            pending.push_back(PendingRestore{
                providerIndex,
                std::move(local),
                std::move(future),
                std::move(worker)
            });
        }

        for (auto& restore : pending)
        {
            ExternalConnectionStatus status;
            const bool workerCompleted =
                restore.future.wait_until(restoreDeadline) == std::future_status::ready;
            if (workerCompleted)
            {
                try
                {
                    status = restore.future.get();
                }
                catch (const std::exception&)
                {
                    status = failedStatus(std::move(restore.local), operationId);
                }
                catch (...)
                {
                    status = failedStatus(std::move(restore.local), operationId);
                }
            }
            else
            {
                snapshot.timedOut = true;
                status = timedOutStatus(std::move(restore.local), operationId);
            }
            if (restore.worker.joinable())
            {
                if (workerCompleted)
                {
                    restore.worker.join();
                }
                else
                {
                    std::lock_guard lock(mutex_);
                    restoreWorkers_.push_back(std::move(restore.worker));
                }
            }
            logTransition(
                status,
                attempt,
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - started).count());
            snapshot.providers[restore.providerIndex] = std::move(status);
        }

        snapshot.completedAtUtc = nowUtcIso();
        snapshot.durationMs = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count();
        return snapshot;
    }

    ExternalConnectionStatus ExternalConnectionService::connect(
        std::wstring_view providerId,
        std::wstring_view operationId)
    {
        const auto provider = findProvider(providerId);
        if (!provider)
        {
            throw std::invalid_argument("External connection provider is not registered.");
        }
        const auto started = std::chrono::steady_clock::now();
        ExternalConnectionStatus status = provider->connect(operationId);
        logTransition(status, 0, std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count());
        return status;
    }

    ExternalConnectionStatus ExternalConnectionService::disconnect(
        std::wstring_view providerId,
        std::wstring_view operationId)
    {
        const auto provider = findProvider(providerId);
        if (!provider)
        {
            throw std::invalid_argument("External connection provider is not registered.");
        }
        const auto started = std::chrono::steady_clock::now();
        ExternalConnectionStatus status = provider->disconnect(operationId);
        logTransition(status, 0, std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count());
        return status;
    }

    bool ExternalConnectionService::isInitialized() const noexcept
    {
        return initialized_;
    }

    std::shared_ptr<IExternalConnectionProvider> ExternalConnectionService::findProvider(
        std::wstring_view providerId) const
    {
        std::lock_guard lock(mutex_);
        const auto found = std::find_if(providers_.begin(), providers_.end(), [&](const auto& provider)
        {
            return provider->providerId() == providerId;
        });
        return found == providers_.end() ? nullptr : *found;
    }

    void ExternalConnectionService::logTransition(
        const ExternalConnectionStatus& status,
        std::size_t attempt,
        long long durationMs)
    {
        bool changed = false;
        {
            std::lock_guard lock(mutex_);
            const auto found = loggedStates_.find(status.providerId);
            changed = found == loggedStates_.end() || found->second != status.state;
            loggedStates_[status.providerId] = status.state;
        }
        if (!changed)
        {
            return;
        }
        logger_.writeOperation(
            LogLevel::Info,
            "Connections",
            "Connection state transition providerId=" + narrowAscii(status.providerId) +
                " state=" + narrowAscii(externalConnectionStateName(status.state)) +
                " durationMs=" + std::to_string(durationMs) +
                " attempt=" + std::to_string(attempt) +
                " operationId=" + narrowAscii(status.operationId) + ".");
    }

    std::shared_ptr<IExternalConnectionProvider> createNexusExternalConnectionProvider(
        NexusModsAuthService& auth)
    {
        return std::make_shared<NexusExternalConnectionProvider>(auth);
    }
}
