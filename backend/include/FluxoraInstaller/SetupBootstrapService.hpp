#pragma once

#include "FluxoraInstaller/WindowsIntegration.hpp"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>

namespace fluxora::installer
{
    using SetupWritabilityProbe =
        std::function<void(const std::filesystem::path& installDirectory)>;

    enum class SetupInstallMode
    {
        Install,
        Repair,
        Update
    };

    struct SetupBootstrapState final
    {
        std::filesystem::path defaultInstallDirectory;
        SetupInstallMode mode{SetupInstallMode::Install};
        std::string installedVersion;
        std::uint64_t requiredBytes{0};
        std::uint64_t freeBytes{0};
        bool isOwnedInstall{false};
    };

    enum class SetupValidationStatus
    {
        Valid,
        InsufficientSpace,
        ForeignInstall,
        InvalidPath
    };

    struct SetupInstallValidation final
    {
        SetupValidationStatus status{SetupValidationStatus::InvalidPath};
        std::string code;
        std::string messageKey;
        std::filesystem::path normalizedInstallDirectory;
        std::uint64_t requiredBytes{0};
        std::uint64_t freeBytes{0};
        SetupInstallMode mode{SetupInstallMode::Install};
        bool isOwnedInstall{false};
    };

    class SetupBootstrapService final
    {
    public:
        explicit SetupBootstrapService(
            ICurrentUserRegistryStore& registry,
            std::filesystem::path localAppDataRoot = {},
            std::string productVersion = {},
            SetupWritabilityProbe writabilityProbe = {});

        [[nodiscard]] SetupBootstrapState bootstrap(
            std::uint64_t expandedPayloadBytes) const;
        [[nodiscard]] SetupInstallValidation validate(
            const std::filesystem::path& installDirectory,
            std::uint64_t expandedPayloadBytes) const;

        [[nodiscard]] static std::wstring serialize(
            const SetupBootstrapState& state);
        [[nodiscard]] static std::wstring serialize(
            const SetupInstallValidation& validation);

    private:
        [[nodiscard]] std::uint64_t requiredBytes(
            std::uint64_t expandedPayloadBytes,
            std::uint64_t protectedDataBytes = 0) const;
        [[nodiscard]] SetupInstallValidation inspect(
            const std::filesystem::path& installDirectory,
            std::uint64_t expandedPayloadBytes) const;

        ICurrentUserRegistryStore& registry_;
        std::filesystem::path localAppDataRoot_;
        std::string productVersion_;
        SetupWritabilityProbe writabilityProbe_;
    };
}
