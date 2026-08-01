#include "FluxoraInstaller/ApplicationLaunchService.hpp"
#include "TestFilesystem.hpp"
#include "WindowsProcessTestHelper.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>

namespace
{
    std::filesystem::path extendedPath(const std::filesystem::path& path)
    {
        const std::wstring absolute = std::filesystem::absolute(path).wstring();
        return absolute.starts_with(LR"(\\?\)")
            ? std::filesystem::path(absolute)
            : std::filesystem::path(LR"(\\?\)" + absolute);
    }
}

TEST(ApplicationLaunchServiceTests, UpdatedLaunchUsesOnlyOpaqueHealthHandoff)
{
    const std::wstring commandLine =
        fluxora::installer::ApplicationLaunchService::createUpdatedCommandLine(
            L"C:\\Program Files\\Fluxora\\Fluxora.exe",
            std::string(64, 'a'),
            "op_update_abcdef12");

    EXPECT_EQ(
        L"\"C:\\Program Files\\Fluxora\\Fluxora.exe\" --fluxora-update-handoff " +
            std::wstring(64, L'a') +
            L" --fluxora-update-operation-id op_update_abcdef12",
        commandLine);
}

TEST(ApplicationLaunchServiceTests, QuotesEmbeddedQuotesAndTrailingBackslashes)
{
    EXPECT_EQ(
        L"\"a\\\\\\\"b\\\\\"",
        fluxora::installer::ApplicationLaunchService::quoteWindowsArgument(
            L"a\\\"b\\"));
}

TEST(ApplicationLaunchServiceTests, JobContainsAndTerminatesImmediatelySpawnedDescendant)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"install with spaces";
    std::filesystem::create_directories(install);
    const std::filesystem::path application = install / L"Fluxora.exe";
    std::filesystem::copy_file(
        fluxora::tests::currentTestExecutable(),
        application,
        std::filesystem::copy_options::overwrite_existing);
    const std::filesystem::path childPidPath =
        temporary.path() / L"immediate-child.pid";
    fluxora::tests::ScopedProbeEnvironment probe(
        L"spawn-descendant",
        childPidPath);
    fluxora::installer::UpdateWorkflowRequest request;
    request.operationId = "op_job_tree_abcdef12";
    request.handoffNonce = std::string(64, 'a');
    request.installDirectory = install;
    request.applicationExecutable = L"Fluxora.exe";

    auto launched =
        fluxora::installer::ApplicationLaunchService().launchUpdated(request);
    ASSERT_TRUE(fluxora::tests::waitForFile(
        childPidPath,
        std::chrono::seconds(10)));
    const std::uint32_t childPid =
        fluxora::tests::readProbeProcessId(childPidPath);

    launched.terminateIfRunning();

    EXPECT_TRUE(fluxora::tests::processHasExited(
        childPid,
        std::chrono::seconds(5)));
    EXPECT_TRUE(launched.hasExited());
}

TEST(ApplicationLaunchServiceTests, UpdatedLaunchAcceptsExtendedInstallNamespace)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install = temporary.path() / L"extended-install";
    std::filesystem::create_directories(install);
    std::filesystem::copy_file(
        fluxora::tests::currentTestExecutable(),
        install / L"Fluxora.exe",
        std::filesystem::copy_options::overwrite_existing);
    const std::filesystem::path childPidPath = temporary.path() / L"extended-child.pid";
    fluxora::tests::ScopedProbeEnvironment probe(L"spawn-descendant", childPidPath);
    fluxora::installer::UpdateWorkflowRequest request;
    request.operationId = "op_extended_launch_abcdef12";
    request.handoffNonce = std::string(64, 'b');
    request.installDirectory = extendedPath(install);
    request.applicationExecutable = L"Fluxora.exe";

    auto launched =
        fluxora::installer::ApplicationLaunchService().launchUpdated(request);
    ASSERT_TRUE(fluxora::tests::waitForFile(childPidPath, std::chrono::seconds(10)));
    const std::uint32_t childPid = fluxora::tests::readProbeProcessId(childPidPath);

    launched.terminateIfRunning();

    EXPECT_TRUE(fluxora::tests::processHasExited(childPid, std::chrono::seconds(5)));
    EXPECT_TRUE(launched.hasExited());
}

TEST(ApplicationLaunchServiceTests, PreviousVersionRelaunchReceivesNoArguments)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"install with spaces";
    std::filesystem::create_directories(install);
    const std::filesystem::path application = install / L"Fluxora.exe";
    std::filesystem::copy_file(
        fluxora::tests::currentTestExecutable(),
        application,
        std::filesystem::copy_options::overwrite_existing);
    const std::filesystem::path commandLinePath =
        temporary.path() / L"command-line.txt";
    fluxora::tests::ScopedProbeEnvironment probe(
        L"record-command-line",
        commandLinePath);
    fluxora::installer::UpdateWorkflowRequest request;
    request.installDirectory = install;
    request.applicationExecutable = L"Fluxora.exe";

    fluxora::installer::ApplicationLaunchService().launchPrevious(request);

    ASSERT_TRUE(fluxora::tests::waitForFile(
        commandLinePath,
        std::chrono::seconds(10)));
    const std::string commandLine =
        fluxora::tests::readTextFile(commandLinePath);
    EXPECT_EQ(
        "\"" + application.string() + "\"",
        commandLine);
    EXPECT_EQ(std::string::npos, commandLine.find("--fluxora-"));
}
