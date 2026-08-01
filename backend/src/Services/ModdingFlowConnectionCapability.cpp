#include "FluxoraCore/Services/ModdingFlowConnectionCapability.hpp"

#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModdingFlowExternalConnectionProvider.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <Windows.h>
#endif

#ifdef FLUXORA_ENABLE_MODDINGFLOW_AUTH_PROVIDER
#include "FluxoraCore/Services/ModdingFlowConfiguration.hpp"
#include "FluxoraCore/Services/ModdingFlowHttpTransport.hpp"
#include "FluxoraCore/Services/ModdingFlowInstallPlanService.hpp"
#include "FluxoraCore/Services/ModdingFlowJwksIdTokenVerifier.hpp"
#include "FluxoraCore/Services/ModdingFlowOAuthHttpClient.hpp"
#include "FluxoraCore/Services/ModdingFlowProviderCatalog.hpp"
#include "FluxoraCore/Services/SecureCredentialStore.hpp"

#endif

namespace fluxora
{
#ifdef FLUXORA_ENABLE_MODDINGFLOW_AUTH_PROVIDER
    namespace
    {
#ifdef FLUXORA_BRIDGE_PROTOCOL_HARNESS
        class BridgeProtocolInMemoryCredentialStore final : public ISecureCredentialStore
        {
        public:
            [[nodiscard]] std::optional<std::string> read(
                std::wstring_view target) const override
            {
                std::lock_guard lock(mutex_);
                recordOperation("read", target);
                return secret_;
            }

            void writeAtomic(
                std::wstring_view target,
                std::string_view secret) override
            {
                std::lock_guard lock(mutex_);
                recordOperation("write", target);
                secret_ = std::string(secret);
            }

            void remove(std::wstring_view target) override
            {
                std::lock_guard lock(mutex_);
                recordOperation("remove", target);
                secret_.reset();
            }

        private:
            static void recordOperation(
                std::string_view operation,
                std::wstring_view target) noexcept
            {
#ifdef _WIN32
                constexpr DWORD maximumAuditPathLength = 32768U;
                std::wstring auditPath(maximumAuditPathLength, L'\0');
                const DWORD length = GetEnvironmentVariableW(
                    L"FLUXORA_BRIDGE_PROTOCOL_CREDENTIAL_AUDIT",
                    auditPath.data(),
                    maximumAuditPathLength);
                if (length == 0U || length >= maximumAuditPathLength)
                {
                    return;
                }
                auditPath.resize(length);
                try
                {
                    std::ofstream audit(
                        std::filesystem::path(auditPath),
                        std::ios::app | std::ios::binary);
                    if (!audit)
                    {
                        return;
                    }
                    audit << "in-memory:" << operation << ':';
                    for (const wchar_t character : target)
                    {
                        audit.put(character >= 0 && character <= 0x7f
                            ? static_cast<char>(character)
                            : '?');
                    }
                    audit << '\n';
                }
                catch (...)
                {
                }
#else
                static_cast<void>(operation);
                static_cast<void>(target);
#endif
            }

            mutable std::mutex mutex_;
            std::optional<std::string> secret_;
        };
#endif

        [[nodiscard]] std::unique_ptr<ISecureCredentialStore>
            createModdingFlowCredentialStore()
        {
#ifdef FLUXORA_BRIDGE_PROTOCOL_HARNESS
            return std::make_unique<BridgeProtocolInMemoryCredentialStore>();
#else
            return createWindowsSecureCredentialStore();
#endif
        }

        class ProductionModdingFlowConnectionCapability final
            : public IModdingFlowConnectionCapability
        {
        public:
            ProductionModdingFlowConnectionCapability(
                Logger& logger,
                std::unique_ptr<ISecureCredentialStore> credentials)
                : logger_(logger),
                  configuration_(ModdingFlowConfiguration::production()),
                  credentials_(std::move(credentials)),
                  transport_(std::make_unique<WinHttpModdingFlowTransport>(configuration_.userAgent())),
                  oauth_(std::make_unique<ModdingFlowOAuthHttpClient>(configuration_, *transport_)),
                  verifier_(std::make_unique<ModdingFlowJwksIdTokenVerifier>(configuration_, *transport_)),
                  auth_(std::make_unique<ModdingFlowAuthService>(
                      logger_,
                      configuration_,
                      *credentials_,
                      *oauth_,
                      *verifier_)),
                  accessTokens_(std::make_unique<ModdingFlowAuthAccessTokenProvider>(*auth_)),
                  publicApi_(std::make_unique<ModdingFlowPublicApiClient>(
                      *transport_,
                      accessTokens_.get())),
                  artifactLookup_(std::make_unique<ModdingFlowArtifactLookupService>(*publicApi_)),
                  providerCatalog_(std::make_unique<ModdingFlowProviderCatalog>(*publicApi_)),
                  installPlan_(std::make_unique<ModdingFlowInstallPlanService>(*publicApi_)),
                  provider_(createModdingFlowExternalConnectionProvider(*auth_))
            {
            }

            ~ProductionModdingFlowConnectionCapability() override
            {
                shutdown();
            }

            void initialize() noexcept override
            {
                if (initialized_)
                {
                    return;
                }
                try
                {
                    auth_->initialize();
                    auth_->discoverStoredSessionForRestore(L"moddingflow-startup-discovery");
                    initialized_ = true;
                }
                catch (...)
                {
                    logger_.writeOperation(
                        LogLevel::Warning,
                        "ModdingFlowAuth",
                        "ModdingFlow capability initialization failed; other providers remain available.");
                }
            }

            void shutdown() noexcept override
            {
                if (initialized_)
                {
                    auth_->shutdown();
                    initialized_ = false;
                }
            }

            [[nodiscard]] std::shared_ptr<IExternalConnectionProvider> provider() const override
            {
                return provider_;
            }

            [[nodiscard]] ModdingFlowConnectStart beginConnect(
                std::string_view redirectUri,
                std::wstring_view operationId) override
            {
                return auth_->beginConnect(redirectUri, operationId);
            }

            [[nodiscard]] ModdingFlowAuthStatus completeConnect(
                std::string_view transactionId,
                ModdingFlowConnectCompletion completion,
                std::wstring_view operationId) override
            {
                return auth_->completeConnect(
                    transactionId,
                    std::move(completion),
                    operationId);
            }

            void cancelPendingConnect(
                std::string_view transactionId,
                std::wstring_view operationId) override
            {
                auth_->cancelConnect(transactionId, operationId);
            }

            [[nodiscard]] std::string managedAiAccessToken(
                std::wstring_view operationId,
                bool forceRefresh) override
            {
                return auth_->getAccessToken("agent:run", operationId, forceRefresh);
            }

            [[nodiscard]] ModdingFlowArtifactPreview lookupArtifactPreview(
                std::string_view artifactId,
                ModdingFlowArtifactLookupAuthMode authMode,
                std::wstring_view operationId) override
            {
                return artifactLookup_->lookup(artifactId, authMode, operationId);
            }

            [[nodiscard]] IModdingFlowPublicApiClient* publicApiClient() noexcept override
            {
                return publicApi_.get();
            }

            [[nodiscard]] IModProviderCatalog* providerCatalog() noexcept override
            {
                return providerCatalog_.get();
            }

            [[nodiscard]] IModdingFlowInstallPlanService* installPlanService() noexcept override
            {
                return installPlan_.get();
            }

            [[nodiscard]] IModProviderActivationPreviewResolver*
                activationPreviewResolver() noexcept override
            {
                return installPlan_.get();
            }

        private:
            Logger& logger_;
            ModdingFlowConfiguration configuration_;
            std::unique_ptr<ISecureCredentialStore> credentials_;
            std::unique_ptr<WinHttpModdingFlowTransport> transport_;
            std::unique_ptr<ModdingFlowOAuthHttpClient> oauth_;
            std::unique_ptr<ModdingFlowJwksIdTokenVerifier> verifier_;
            std::unique_ptr<ModdingFlowAuthService> auth_;
            std::unique_ptr<ModdingFlowAuthAccessTokenProvider> accessTokens_;
            std::unique_ptr<ModdingFlowPublicApiClient> publicApi_;
            std::unique_ptr<ModdingFlowArtifactLookupService> artifactLookup_;
            std::unique_ptr<ModdingFlowProviderCatalog> providerCatalog_;
            std::unique_ptr<ModdingFlowInstallPlanService> installPlan_;
            std::shared_ptr<IExternalConnectionProvider> provider_;
            bool initialized_{false};
        };
    }
#endif

    bool moddingFlowConnectionCapabilityCompiled() noexcept
    {
#ifdef FLUXORA_ENABLE_MODDINGFLOW_AUTH_PROVIDER
        return true;
#else
        return false;
#endif
    }

    bool shouldEnableModdingFlowCapabilityForCurrentBridgeLane() noexcept
    {
#ifdef _WIN32
        constexpr DWORD laneCapacity = 64U;
        wchar_t lane[laneCapacity]{};
        const DWORD length = GetEnvironmentVariableW(
            L"FLUXORA_BRIDGE_LANE",
            lane,
            laneCapacity);
        if (length == 0U)
        {
            return true;
        }
        if (length >= laneCapacity)
        {
            return false;
        }
        return std::wstring_view(lane, length) == L"download";
#else
        const char* lane = std::getenv("FLUXORA_BRIDGE_LANE");
        return lane == nullptr || *lane == '\0' || std::string_view(lane) == "download";
#endif
    }

    std::unique_ptr<IModdingFlowConnectionCapability>
        createProductionModdingFlowConnectionCapability(Logger& logger) noexcept
    {
#ifdef FLUXORA_ENABLE_MODDINGFLOW_AUTH_PROVIDER
        try
        {
            return std::make_unique<ProductionModdingFlowConnectionCapability>(
                logger,
                createModdingFlowCredentialStore());
        }
        catch (...)
        {
            logger.writeOperation(
                LogLevel::Warning,
                "ModdingFlowAuth",
                "ModdingFlow production capability construction failed; Nexus remains available.");
            return nullptr;
        }
#else
        static_cast<void>(logger);
        return nullptr;
#endif
    }
}
