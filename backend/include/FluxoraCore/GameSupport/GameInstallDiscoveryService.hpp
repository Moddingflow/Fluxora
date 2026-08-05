#pragma once

#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"

#include <cstdint>
#include <filesystem>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace fluxora
{
    class Logger;
    class ProjectService;

    enum class GameInstallRegistryHive
    {
        CurrentUser,
        LocalMachine
    };

    enum class GameInstallRegistryView
    {
        Default,
        Registry32,
        Registry64
    };

    struct GameInstallRegistrySubkey
    {
        std::wstring name;
        std::int64_t lastWriteTime{0};
    };

    class IGameInstallRegistry
    {
    public:
        virtual ~IGameInstallRegistry() = default;

        // Missing keys and values use the empty return values below. Registry access and
        // enumeration failures throw std::system_error so discovery can report indeterminate.

        [[nodiscard]] virtual std::optional<std::wstring> readString(
            GameInstallRegistryHive hive,
            GameInstallRegistryView view,
            std::wstring_view keyPath,
            std::wstring_view valueName) const = 0;
        [[nodiscard]] virtual std::vector<GameInstallRegistrySubkey> listSubkeys(
            GameInstallRegistryHive hive,
            GameInstallRegistryView view,
            std::wstring_view keyPath) const = 0;
        [[nodiscard]] virtual std::int64_t lastWriteTime(
            GameInstallRegistryHive hive,
            GameInstallRegistryView view,
            std::wstring_view keyPath) const = 0;
    };

    struct GameInstallDiscoverySystemPaths
    {
        std::filesystem::path epicManifestDirectory;
    };

    struct GameInstallDiscoveryCandidate
    {
        std::filesystem::path installPath;
        std::int64_t freshness{0};
    };

    struct GameInstallProviderScan
    {
        std::vector<GameInstallDiscoveryCandidate> candidates;
        bool hadErrors{false};
    };

    struct GameInstallDiscoveryRequest
    {
        std::filesystem::path buildConfigsDirectory;
        std::wstring operationId;
    };

    enum class GameInstallResolutionKind
    {
        Found,
        NotFound,
        Indeterminate
    };

    struct GameInstallResolution
    {
        std::wstring templateId;
        GameInstallResolutionKind resolution{GameInstallResolutionKind::NotFound};
        std::optional<std::filesystem::path> primaryExecutablePath;
        std::optional<GameInstallDiscoveryProviderId> providerId;
    };

    struct GameInstallDiscoverySnapshot
    {
        std::vector<GameInstallResolution> installs;
        std::wstring operationId;
    };

    class IGameInstallDiscoveryProvider
    {
    public:
        virtual ~IGameInstallDiscoveryProvider() = default;

        [[nodiscard]] virtual GameInstallDiscoveryProviderId id() const noexcept = 0;
        [[nodiscard]] virtual std::wstring fingerprint(
            const GameDefinition& definition,
            const GameInstallDiscoveryRequest& request) const = 0;
        [[nodiscard]] virtual GameInstallProviderScan scan(
            const GameDefinition& definition,
            const GameInstallDiscoveryRequest& request) const = 0;
    };

    class GameInstallDiscoveryService final
    {
    public:
        GameInstallDiscoveryService(
            Logger* logger,
            const GameSupportRegistry& registry,
            std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers);

        [[nodiscard]] GameInstallDiscoverySnapshot discover(
            const GameInstallDiscoveryRequest& request) const;

        [[nodiscard]] static std::wstring_view resolutionName(
            GameInstallResolutionKind resolution) noexcept;

    private:
        struct CacheEntry
        {
            std::wstring fingerprint;
            GameInstallProviderScan scan;
        };

        [[nodiscard]] const IGameInstallDiscoveryProvider* providerFor(
            GameInstallDiscoveryProviderId id) const noexcept;
        void logProviderOutcome(
            const GameDefinition& definition,
            GameInstallDiscoveryProviderId providerId,
            std::wstring_view outcome,
            std::size_t candidateCount,
            std::int64_t durationMicroseconds) const noexcept;

        Logger* logger_{nullptr};
        const GameSupportRegistry& registry_;
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers_;
        mutable std::mutex cacheMutex_;
        mutable std::map<std::wstring, CacheEntry> cache_;
    };

    [[nodiscard]] std::shared_ptr<const IGameInstallRegistry>
        createSystemGameInstallRegistry();
    [[nodiscard]] GameInstallDiscoverySystemPaths defaultGameInstallDiscoverySystemPaths();
    [[nodiscard]] std::unique_ptr<IGameInstallDiscoveryProvider>
        createFluxoraGameInstallDiscoveryProvider(const ProjectService& projects);
    [[nodiscard]] std::unique_ptr<IGameInstallDiscoveryProvider>
        createSteamGameInstallDiscoveryProvider(
            std::shared_ptr<const IGameInstallRegistry> registry);
    [[nodiscard]] std::unique_ptr<IGameInstallDiscoveryProvider>
        createGogGameInstallDiscoveryProvider(
            std::shared_ptr<const IGameInstallRegistry> registry);
    [[nodiscard]] std::unique_ptr<IGameInstallDiscoveryProvider>
        createEpicGameInstallDiscoveryProvider(GameInstallDiscoverySystemPaths paths);
    [[nodiscard]] std::unique_ptr<IGameInstallDiscoveryProvider>
        createWindowsGameInstallDiscoveryProvider(
            std::shared_ptr<const IGameInstallRegistry> registry);
    [[nodiscard]] std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>>
        createDefaultGameInstallDiscoveryProviders(const ProjectService& projects);
}
