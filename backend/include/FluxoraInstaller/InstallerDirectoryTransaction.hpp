#pragma once

#include "FluxoraInstaller/FluxoraInstallerApi.hpp"

#include <filesystem>
#include <functional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace fluxora::installer::detail
{
    class InstallerRecoveryError final : public std::runtime_error
    {
    public:
        using std::runtime_error::runtime_error;
    };

    enum class DirectoryTransactionStage
    {
        StagingBuilt,
        ProtectedDataStaged,
        BackupCreated,
        StagingCommitted
    };

    using DirectoryBuilder = std::function<void(const std::filesystem::path& stagingDirectory)>;
    using DirectoryValidator = std::function<void(const std::filesystem::path& stagingDirectory)>;
    using DirectoryStageObserver = std::function<void(DirectoryTransactionStage stage)>;

    FLUXORA_INSTALLER_API void replaceApplicationDirectory(
        const std::filesystem::path& installDirectory,
        const DirectoryBuilder& builder,
        const DirectoryValidator& validator,
        const DirectoryStageObserver& observer = {},
        bool requiresHealthConfirmation = true);

    FLUXORA_INSTALLER_API void finalizePendingApplicationUpdate(
        const std::filesystem::path& installDirectory);

    FLUXORA_INSTALLER_API void rollbackPendingApplicationUpdate(
        const std::filesystem::path& installDirectory);

    FLUXORA_INSTALLER_API void recoverApplicationDirectory(
        const std::filesystem::path& installDirectory);

    [[nodiscard]] FLUXORA_INSTALLER_API std::string redactUpdaterLogMessage(
        std::string_view message);
}
