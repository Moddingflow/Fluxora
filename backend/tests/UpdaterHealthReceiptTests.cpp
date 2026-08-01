#include "FluxoraInstaller/HealthAcknowledgementService.hpp"
#include "FluxoraInstaller/SignedInstallReceipt.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <utility>

namespace
{
    class FakeApplication final :
        public fluxora::installer::ILaunchedApplicationIdentity
    {
    public:
        FakeApplication(
            std::uint32_t pid,
            std::uint64_t start,
            std::filesystem::path executable,
            bool exited = false)
            : pid_(pid),
              start_(start),
              executable_(std::move(executable)),
              exited_(exited)
        {
        }

        [[nodiscard]] std::uint32_t processId() const noexcept override { return pid_; }
        [[nodiscard]] std::uint64_t startFileTime() const noexcept override { return start_; }
        [[nodiscard]] const std::filesystem::path& executablePath() const noexcept override
        {
            return executable_;
        }
        [[nodiscard]] bool hasExited() const override { return exited_; }

    private:
        std::uint32_t pid_;
        std::uint64_t start_;
        std::filesystem::path executable_;
        bool exited_;
    };

    void writeFile(const std::filesystem::path& path, std::string_view contents)
    {
        std::filesystem::create_directories(path.parent_path());
        std::ofstream output(path, std::ios::binary | std::ios::trunc);
        ASSERT_TRUE(output.good());
        output.write(contents.data(), static_cast<std::streamsize>(contents.size()));
        ASSERT_TRUE(output.good());
    }

    fluxora::installer::UpdateWorkflowRequest receiptRequest(
        const std::filesystem::path& root)
    {
        fluxora::installer::UpdateWorkflowRequest request;
        request.operationId = "op_receipt_abcdef12";
        request.manifestPath = root / L"manifest.json";
        request.signaturePath = root / L"manifest.sig";
        return request;
    }

    std::uint64_t knownStartFileTime()
    {
        SYSTEMTIME system{};
        system.wYear = 2026;
        system.wMonth = 7;
        system.wDay = 31;
        system.wHour = 8;
        system.wMinute = 12;
        system.wSecond = 13;
        FILETIME fileTime{};
        EXPECT_TRUE(SystemTimeToFileTime(&system, &fileTime));
        ULARGE_INTEGER ticks{};
        ticks.LowPart = fileTime.dwLowDateTime;
        ticks.HighPart = fileTime.dwHighDateTime;
        return ticks.QuadPart + 1'234'567;
    }

    fluxora::installer::UpdateWorkflowRequest healthRequest(
        const std::filesystem::path& install)
    {
        fluxora::installer::UpdateWorkflowRequest request;
        request.operationId = "op_health_abcdef12";
        request.handoffNonce = std::string(64, 'b');
        request.targetVersion = "1.1.0";
        request.installDirectory = install;
        request.applicationExecutable = L"Fluxora.exe";
        return request;
    }
}

TEST(SignedInstallReceiptTests, PersistsExactSignedPairOutsideInstall)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path source = temporary.path() / L"runtime";
    const std::filesystem::path appData = temporary.path() / L"appdata";
    const fluxora::installer::UpdateWorkflowRequest request = receiptRequest(source);
    writeFile(request.manifestPath, "{\"signed\":true}");
    writeFile(request.signaturePath, "base64-signature");

    fluxora::installer::SignedInstallReceipt(appData).write(request);

    const std::filesystem::path receipt = appData / L"Fluxora" / L"updates";
    EXPECT_EQ(
        "{\"signed\":true}",
        fluxora::tests::readTextFile(receipt / L"installed-manifest.json"));
    EXPECT_EQ(
        "base64-signature",
        fluxora::tests::readTextFile(receipt / L"installed-manifest.sig"));
    for (const std::filesystem::directory_entry& entry :
         std::filesystem::directory_iterator(receipt))
    {
        EXPECT_FALSE(entry.path().extension() == L".tmp");
    }
}

TEST(HealthAcknowledgementServiceTests, AcceptsOnlyExactLiveProcessAcknowledgement)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install = temporary.path() / L"install";
    const std::filesystem::path appData = temporary.path() / L"appdata";
    const fluxora::installer::UpdateWorkflowRequest request = healthRequest(install);
    const FakeApplication application(
        4242,
        knownStartFileTime(),
        request.applicationPath());
    fluxora::installer::HealthAcknowledgementService service(
        appData,
        std::chrono::milliseconds(1));
    service.prepare(request);
    writeFile(
        service.acknowledgementPath(request),
        "{\"schemaVersion\":1,"
        "\"operationId\":\"op_health_abcdef12\","
        "\"nonce\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\","
        "\"appVersion\":\"1.1.0\","
        "\"pid\":4242,"
        "\"processStartTimeUtc\":\"2026-07-31T08:12:13.1234567Z\"}");

    EXPECT_NO_THROW(service.wait(request, application, std::chrono::seconds(1)));
    service.cleanup(request);
    EXPECT_FALSE(std::filesystem::exists(service.acknowledgementPath(request)));
}

TEST(HealthAcknowledgementServiceTests, AcceptsExtendedInstallNamespaceForExactLiveProcess)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install = temporary.path() / L"install";
    const std::filesystem::path appData = temporary.path() / L"appdata";
    const std::filesystem::path extendedInstall =
        std::filesystem::path(L"\\\\?\\" + install.wstring());
    const fluxora::installer::UpdateWorkflowRequest request = healthRequest(extendedInstall);
    const FakeApplication application(
        4242,
        knownStartFileTime(),
        install / L"Fluxora.exe");
    fluxora::installer::HealthAcknowledgementService service(
        appData,
        std::chrono::milliseconds(1));
    service.prepare(request);
    writeFile(
        service.acknowledgementPath(request),
        "{\"schemaVersion\":1,"
        "\"operationId\":\"op_health_abcdef12\","
        "\"nonce\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\","
        "\"appVersion\":\"1.1.0\","
        "\"pid\":4242,"
        "\"processStartTimeUtc\":\"2026-07-31T08:12:13.1234567Z\"}");

    EXPECT_NO_THROW(service.wait(request, application, std::chrono::seconds(1)));
}

TEST(HealthAcknowledgementServiceTests, RejectsWrongPidUnknownAndDuplicateFields)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install = temporary.path() / L"install";
    const std::filesystem::path appData = temporary.path() / L"appdata";
    const fluxora::installer::UpdateWorkflowRequest request = healthRequest(install);
    const FakeApplication application(
        4242,
        knownStartFileTime(),
        request.applicationPath());
    fluxora::installer::HealthAcknowledgementService service(
        appData,
        std::chrono::milliseconds(1));
    service.prepare(request);
    const std::filesystem::path acknowledgement =
        service.acknowledgementPath(request);
    const std::string prefix =
        "{\"schemaVersion\":1,"
        "\"operationId\":\"op_health_abcdef12\","
        "\"nonce\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\","
        "\"appVersion\":\"1.1.0\",";
    const std::string suffix =
        "\"processStartTimeUtc\":\"2026-07-31T08:12:13.1234567Z\"}";

    writeFile(
        acknowledgement,
        "{\"schemaVersion\":1,"
        "\"operationId\":\"op_other_abcdef12\","
        "\"nonce\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\","
        "\"appVersion\":\"1.1.0\","
        "\"pid\":4242,"
        "\"processStartTimeUtc\":\"2026-07-31T08:12:13.1234567Z\"}");
    EXPECT_THROW(
        service.wait(request, application, std::chrono::seconds(1)),
        std::invalid_argument);

    writeFile(acknowledgement, prefix + "\"pid\":4243," + suffix);
    EXPECT_THROW(
        service.wait(request, application, std::chrono::seconds(1)),
        std::invalid_argument);

    writeFile(
        acknowledgement,
        prefix + "\"pid\":4242,\"unexpected\":true," + suffix);
    EXPECT_THROW(
        service.wait(request, application, std::chrono::seconds(1)),
        std::invalid_argument);

    writeFile(
        acknowledgement,
        prefix + "\"pid\":4242,\"pid\":4242," + suffix);
    EXPECT_THROW(
        service.wait(request, application, std::chrono::seconds(1)),
        std::invalid_argument);
}

TEST(HealthAcknowledgementServiceTests, PrepareRejectsReusedNonce)
{
    fluxora::tests::TempDirectory temporary;
    const auto request = healthRequest(temporary.path() / L"install");
    fluxora::installer::HealthAcknowledgementService service(
        temporary.path() / L"appdata",
        std::chrono::milliseconds(1));
    service.prepare(request);
    writeFile(service.acknowledgementPath(request), "{}");

    EXPECT_THROW(service.prepare(request), std::invalid_argument);
}

TEST(HealthAcknowledgementServiceTests, RejectsWrongProcessStartTime)
{
    fluxora::tests::TempDirectory temporary;
    const auto request = healthRequest(temporary.path() / L"install");
    const FakeApplication application(
        4242,
        knownStartFileTime(),
        request.applicationPath());
    fluxora::installer::HealthAcknowledgementService service(
        temporary.path() / L"appdata",
        std::chrono::milliseconds(1));
    service.prepare(request);
    writeFile(
        service.acknowledgementPath(request),
        "{\"schemaVersion\":1,"
        "\"operationId\":\"op_health_abcdef12\","
        "\"nonce\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\","
        "\"appVersion\":\"1.1.0\","
        "\"pid\":4242,"
        "\"processStartTimeUtc\":\"2026-07-31T08:12:14.1234567Z\"}");

    EXPECT_THROW(
        service.wait(request, application, std::chrono::seconds(1)),
        std::invalid_argument);
}

TEST(HealthAcknowledgementServiceTests, RejectsAcknowledgementAfterEarlyExit)
{
    fluxora::tests::TempDirectory temporary;
    const auto request = healthRequest(temporary.path() / L"install");
    const FakeApplication application(
        4242,
        knownStartFileTime(),
        request.applicationPath(),
        true);
    fluxora::installer::HealthAcknowledgementService service(
        temporary.path() / L"appdata",
        std::chrono::milliseconds(1));
    service.prepare(request);

    EXPECT_THROW(
        service.wait(request, application, std::chrono::milliseconds(20)),
        std::runtime_error);
}

TEST(HealthAcknowledgementServiceTests, TimesOutWithoutAcknowledgement)
{
    fluxora::tests::TempDirectory temporary;
    const auto request = healthRequest(temporary.path() / L"install");
    const FakeApplication application(
        4242,
        knownStartFileTime(),
        request.applicationPath());
    fluxora::installer::HealthAcknowledgementService service(
        temporary.path() / L"appdata",
        std::chrono::milliseconds(1));
    service.prepare(request);

    EXPECT_THROW(
        service.wait(request, application, std::chrono::milliseconds(5)),
        std::runtime_error);
}
