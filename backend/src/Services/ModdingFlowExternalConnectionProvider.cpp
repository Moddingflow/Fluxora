#include "FluxoraCore/Services/ModdingFlowExternalConnectionProvider.hpp"

#include <ctime>
#include <iomanip>
#include <sstream>

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

        ExternalConnectionState mapState(ModdingFlowAuthState state) noexcept
        {
            switch (state)
            {
            case ModdingFlowAuthState::NotLinked:
                return ExternalConnectionState::NotLinked;
            case ModdingFlowAuthState::Connecting:
                return ExternalConnectionState::Connecting;
            case ModdingFlowAuthState::Restoring:
                return ExternalConnectionState::Restoring;
            case ModdingFlowAuthState::Ready:
                return ExternalConnectionState::Ready;
            case ModdingFlowAuthState::TemporarilyUnavailable:
                return ExternalConnectionState::TemporarilyUnavailable;
            case ModdingFlowAuthState::ReauthRequired:
                return ExternalConnectionState::ReauthRequired;
            }
            return ExternalConnectionState::TemporarilyUnavailable;
        }

        class ModdingFlowExternalConnectionProvider final : public IExternalConnectionProvider
        {
        public:
            explicit ModdingFlowExternalConnectionProvider(ModdingFlowAuthService& auth) noexcept
                : auth_(auth)
            {
            }

            [[nodiscard]] std::wstring providerId() const override
            {
                return L"moddingflow";
            }

            [[nodiscard]] ExternalConnectionStatus localStatus(
                std::wstring_view operationId) const override
            {
                return mapModdingFlowExternalConnectionStatus(auth_.status(), operationId);
            }

            [[nodiscard]] ExternalConnectionStatus restore(
                const ExternalConnectionRestoreContext& context) override
            {
                return mapModdingFlowExternalConnectionStatus(
                    auth_.restoreStoredSession(context.operationId),
                    context.operationId);
            }

            [[nodiscard]] ExternalConnectionStatus connect(
                std::wstring_view operationId) override
            {
                return mapModdingFlowExternalConnectionStatus(
                    auth_.status(),
                    operationId,
                    L"ModdingFlow connection must start through the private OAuth bridge flow.");
            }

            [[nodiscard]] ExternalConnectionStatus disconnect(
                std::wstring_view operationId) override
            {
                return mapModdingFlowExternalConnectionStatus(
                    auth_.disconnect(operationId),
                    operationId);
            }

        private:
            ModdingFlowAuthService& auth_;
        };
    }

    ExternalConnectionStatus mapModdingFlowExternalConnectionStatus(
        const ModdingFlowAuthStatus& status,
        std::wstring_view operationId,
        std::wstring message)
    {
        return ExternalConnectionStatus{
            L"moddingflow",
            L"ModdingFlow",
            mapState(status.state),
            status.accountName,
            status.hasStoredSession,
            status.retryable,
            status.requiresUserAction,
            std::move(message),
            nowUtcIso(),
            std::wstring(operationId)};
    }

    std::shared_ptr<IExternalConnectionProvider> createModdingFlowExternalConnectionProvider(
        ModdingFlowAuthService& auth)
    {
        return std::make_shared<ModdingFlowExternalConnectionProvider>(auth);
    }
}
