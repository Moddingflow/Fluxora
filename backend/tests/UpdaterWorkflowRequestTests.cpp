#include "FluxoraInstaller/FluxoraInstallerApi.hpp"
#include "FluxoraInstaller/InstallerDirectoryTransaction.hpp"
#include "FluxoraInstaller/UpdateWorkflowRequest.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <array>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>

namespace
{
    struct RequestFixture final
    {
        fluxora::tests::TempDirectory temporary;
        std::filesystem::path install = temporary.path() / L"installed";
        std::filesystem::path runtime = temporary.path() / L"runtime";
        std::filesystem::path updater = runtime / L"FluxoraUpdater.exe";
        std::filesystem::path request = runtime / L"request.json";

        RequestFixture()
        {
            std::filesystem::create_directories(install);
            std::filesystem::create_directories(runtime);
            write(updater, "native-updater");
            write(runtime / L"update.flxupd", "package");
            write(runtime / L"manifest.json", "{}");
            write(runtime / L"manifest.sig", "signature");
        }

        void writeRequest(std::string extra = {})
        {
            std::string json =
                "{"
                "\"schemaVersion\":1,"
                "\"operationId\":\"op_123_update_abcdef12\","
                "\"handoffNonce\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\","
                "\"parentPid\":1234,"
                "\"parentStartTimeUtc\":\"2026-07-31T08:12:13.1234567+00:00\","
                "\"installDirectory\":\"" + escaped(install) + "\","
                "\"updaterWorkingDirectory\":\"" + escaped(runtime) + "\","
                "\"packagePath\":\"" + escaped(runtime / L"update.flxupd") + "\","
                "\"manifestPath\":\"" + escaped(runtime / L"manifest.json") + "\","
                "\"signaturePath\":\"" + escaped(runtime / L"manifest.sig") + "\","
                "\"currentVersion\":\"1.0.0\","
                "\"targetVersion\":\"1.1.0\","
                "\"target\":\"win-x64\","
                "\"assetKind\":\"full\","
                "\"fromVersion\":null,"
                "\"packageSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\","
                "\"packageSize\":7,"
                "\"applicationExecutable\":\"Fluxora.exe\","
                "\"workingDirectory\":\"" + escaped(install) + "\"" +
                extra +
                "}";
            write(request, json);
        }

        static void write(const std::filesystem::path& path, std::string_view contents)
        {
            std::ofstream output(path, std::ios::binary | std::ios::trunc);
            ASSERT_TRUE(output.good());
            output.write(contents.data(), static_cast<std::streamsize>(contents.size()));
            ASSERT_TRUE(output.good());
        }

        static std::string escaped(const std::filesystem::path& path)
        {
            const std::wstring wide = path.wstring();
            const int bytes = WideCharToMultiByte(
                CP_UTF8,
                0,
                wide.data(),
                static_cast<int>(wide.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            std::string value(static_cast<std::size_t>(bytes), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                wide.data(),
                static_cast<int>(wide.size()),
                value.data(),
                bytes,
                nullptr,
                nullptr);
            std::string result;
            for (const char character : value)
            {
                result += character == '\\' ? "\\\\" : std::string(1, character);
            }
            return result;
        }
    };
}

TEST(UpdateWorkflowRequestLoaderTests, AcceptsCompleteStrictlyScopedRequest)
{
    RequestFixture fixture;
    fixture.writeRequest();

    const fluxora::installer::UpdateWorkflowRequest request =
        fluxora::installer::UpdateWorkflowRequestLoader::loadAndValidate(
            fixture.request,
            fixture.updater);

    EXPECT_EQ("op_123_update_abcdef12", request.operationId);
    EXPECT_EQ("1.1.0", request.targetVersion);
    EXPECT_EQ(fixture.install / L"Fluxora.exe", request.applicationPath());
    const std::wstring summary =
        fluxora::installer::UpdateWorkflowRequestLoader::sanitizedSummaryJson(request);
    EXPECT_NE(std::wstring::npos, summary.find(L"\"targetVersion\":\"1.1.0\""));
    EXPECT_EQ(std::wstring::npos, summary.find(fixture.runtime.wstring()));
    EXPECT_EQ(std::wstring::npos, summary.find(L"bbbbbbbb"));
}

TEST(UpdateWorkflowRequestLoaderTests, RejectsUnknownAndDuplicateFields)
{
    RequestFixture fixture;
    fixture.writeRequest(",\"unexpected\":true");
    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowRequestLoader::loadAndValidate(
            fixture.request,
            fixture.updater),
        std::invalid_argument);

    fixture.writeRequest(",\"schemaVersion\":1");
    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowRequestLoader::loadAndValidate(
            fixture.request,
            fixture.updater),
        std::invalid_argument);

    fixture.writeRequest(",\"\\u0073chemaVersion\":1");
    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowRequestLoader::loadAndValidate(
            fixture.request,
            fixture.updater),
        std::invalid_argument);
}

TEST(UpdateWorkflowRequestLoaderTests, RejectsUpdaterInsideInstallAndExecutableTraversal)
{
    RequestFixture fixture;
    fixture.writeRequest();
    const std::filesystem::path updaterInsideInstall =
        fixture.install / L"FluxoraUpdater.exe";
    RequestFixture::write(updaterInsideInstall, "updater");
    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowRequestLoader::loadAndValidate(
            fixture.request,
            updaterInsideInstall),
        std::invalid_argument);

    std::string json = fluxora::tests::readTextFile(fixture.request);
    const std::string needle = "\"applicationExecutable\":\"Fluxora.exe\"";
    const std::size_t position = json.find(needle);
    ASSERT_NE(std::string::npos, position);
    json.replace(
        position,
        needle.size(),
        "\"applicationExecutable\":\"..\\\\outside.exe\"");
    RequestFixture::write(fixture.request, json);
    EXPECT_THROW(
        (void)fluxora::installer::UpdateWorkflowRequestLoader::loadAndValidate(
            fixture.request,
            fixture.updater),
        std::invalid_argument);
}

TEST(UpdateWorkflowRequestLoaderTests, AllowsMissingLiveDirectoryForCrashRecovery)
{
    RequestFixture fixture;
    fixture.writeRequest();
    std::filesystem::remove_all(fixture.install);

    const fluxora::installer::UpdateWorkflowRequest request =
        fluxora::installer::UpdateWorkflowRequestLoader::loadAndValidate(
            fixture.request,
            fixture.updater,
            true);

    EXPECT_TRUE(request.recoveryInvocation);
    EXPECT_EQ(fixture.install, request.installDirectory);
}

TEST(UpdateWorkflowRequestLoaderTests, RecoveryDoesNotDependOnUpdateAssets)
{
    RequestFixture fixture;
    fixture.writeRequest();
    std::filesystem::remove(fixture.runtime / L"update.flxupd");
    std::filesystem::remove(fixture.runtime / L"manifest.json");
    std::filesystem::remove(fixture.runtime / L"manifest.sig");

    const fluxora::installer::UpdateWorkflowRequest request =
        fluxora::installer::UpdateWorkflowRequestLoader::loadAndValidate(
            fixture.request,
            fixture.updater,
            true);

    EXPECT_TRUE(request.recoveryInvocation);
    EXPECT_EQ(fixture.install, request.installDirectory);
}

TEST(UpdateWorkflowRequestLoaderTests, HeadlessRecoveryRestoresOldTreeAfterAssetsAreDeleted)
{
    RequestFixture fixture;
    fixture.writeRequest();
    RequestFixture::write(
        fixture.install / L"Fluxora.exe",
        "old executable");
    fluxora::installer::detail::replaceApplicationDirectory(
        fixture.install,
        [](const std::filesystem::path& staging) {
            RequestFixture::write(
                staging / L"Fluxora.exe",
                "new executable");
        },
        [](const std::filesystem::path& staged) {
            if (!std::filesystem::is_regular_file(
                    staged / L"Fluxora.exe"))
            {
                throw std::runtime_error("staged executable is missing");
            }
        });
    ASSERT_EQ(
        "new executable",
        fluxora::tests::readTextFile(
            fixture.install / L"Fluxora.exe"));

    std::filesystem::remove(fixture.runtime / L"update.flxupd");
    std::filesystem::remove(fixture.runtime / L"manifest.json");
    std::filesystem::remove(fixture.runtime / L"manifest.sig");

    std::array<wchar_t, 256> result{};
    EXPECT_EQ(
        FluxoraInstallerResultOk,
        fluxora_installer_run_recovery(
            fixture.request.c_str(),
            fixture.updater.c_str(),
            result.data(),
            static_cast<int>(result.size())));

    EXPECT_EQ(
        "old executable",
        fluxora::tests::readTextFile(
            fixture.install / L"Fluxora.exe"));
}
