#include "FluxoraInstaller/InstallerLogService.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

TEST(InstallerLogServiceTests, KeepsUpdaterOperationAndCrashLogsSeparate)
{
    fluxora::tests::TempDirectory temporary;
    const fluxora::installer::InstallerLogService log(temporary.path());

    log.info(
        fluxora::installer::InstallerLogChannel::Updater,
        "op_update_abcdef12",
        "native-update-started");
    log.info(
        fluxora::installer::InstallerLogChannel::Operation,
        "op_update_abcdef12",
        "commit-started");
    log.error(
        fluxora::installer::InstallerLogChannel::Crash,
        "op_update_abcdef12",
        "watchdog-recovery-failed",
        "recovery-failed");

    EXPECT_NE(log.path(fluxora::installer::InstallerLogChannel::Updater),
              log.path(fluxora::installer::InstallerLogChannel::Operation));
    EXPECT_NE(log.path(fluxora::installer::InstallerLogChannel::Operation),
              log.path(fluxora::installer::InstallerLogChannel::Crash));
    EXPECT_NE(
        std::string::npos,
        fluxora::tests::readTextFile(
            log.path(fluxora::installer::InstallerLogChannel::Updater))
            .find("operationId=op_update_abcdef12"));
    EXPECT_NE(
        std::string::npos,
        fluxora::tests::readTextFile(
            log.path(fluxora::installer::InstallerLogChannel::Crash))
            .find("errorCode=recovery-failed"));
}
