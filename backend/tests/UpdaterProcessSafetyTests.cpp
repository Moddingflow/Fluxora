#include "FluxoraInstaller/ParentProcessWaiter.hpp"
#include "FluxoraInstaller/UpdateProcessLock.hpp"
#include "TestFilesystem.hpp"
#include "WindowsProcessTestHelper.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <future>
#include <memory>
#include <system_error>
#include <thread>

namespace
{
    class FakeParentProcess final : public fluxora::installer::IParentProcess
    {
    public:
        FakeParentProcess(
            std::uint64_t start,
            std::filesystem::path executable,
            bool& waited,
            bool pathUnavailable = false,
            bool exited = false)
            : start_(start),
              executable_(std::move(executable)),
              waited_(waited),
              pathUnavailable_(pathUnavailable),
              exited_(exited)
        {
        }

        [[nodiscard]] std::uint64_t startFileTime() const override { return start_; }
        [[nodiscard]] std::filesystem::path executablePath() const override
        {
            if (pathUnavailable_)
            {
                throw std::system_error(
                    std::make_error_code(std::errc::io_error),
                    "Parent process executable path is unavailable");
            }
            return executable_;
        }
        [[nodiscard]] bool hasExited() const override { return exited_; }
        void waitForExit() override { waited_ = true; }

    private:
        std::uint64_t start_;
        std::filesystem::path executable_;
        bool& waited_;
        bool pathUnavailable_;
        bool exited_;
    };

    class FakeParentResolver final : public fluxora::installer::IParentProcessResolver
    {
    public:
        FakeParentResolver(
            std::uint64_t start,
            std::filesystem::path executable,
            bool& waited,
            bool pathUnavailable = false,
            bool exited = false)
            : start_(start),
              executable_(std::move(executable)),
              waited_(waited),
              pathUnavailable_(pathUnavailable),
              exited_(exited)
        {
        }

        [[nodiscard]] std::unique_ptr<fluxora::installer::IParentProcess> resolve(
            std::uint32_t) const override
        {
            return std::make_unique<FakeParentProcess>(
                start_,
                executable_,
                waited_,
                pathUnavailable_,
                exited_);
        }

    private:
        std::uint64_t start_;
        std::filesystem::path executable_;
        bool& waited_;
        bool pathUnavailable_;
        bool exited_;
    };
}

TEST(UpdateProcessLockTests, NameIsStableAcrossCaseAndTrailingSeparators)
{
    const std::filesystem::path path = L"C:\\Users\\Example\\Fluxora";
    EXPECT_EQ(
        fluxora::installer::UpdateProcessLock::nameForInstallDirectory(path),
        fluxora::installer::UpdateProcessLock::nameForInstallDirectory(
            L"c:\\users\\example\\fluxora\\"));
}

TEST(UpdateProcessLockTests, SecondThreadCannotAcquireUntilOwnerReleases)
{
    const std::filesystem::path install =
        std::filesystem::temp_directory_path() / L"fluxora-lock-test";
    auto owner = fluxora::installer::UpdateProcessLock::acquire(
        install,
        std::chrono::seconds(1));

    std::future<bool> busy = std::async(std::launch::async, [&] {
        try
        {
            auto second = fluxora::installer::UpdateProcessLock::acquire(
                install,
                std::chrono::milliseconds(50));
            return false;
        }
        catch (const fluxora::installer::UpdateBusyError&)
        {
            return true;
        }
    });
    EXPECT_TRUE(busy.get());
    owner.release();

    auto next = fluxora::installer::UpdateProcessLock::acquire(
        install,
        std::chrono::seconds(1));
    EXPECT_TRUE(next.ownsLock());
}

TEST(UpdateProcessLockTests, AbandonedThreadOwnerIsAcquiredForRecovery)
{
    const std::filesystem::path install =
        std::filesystem::temp_directory_path() / L"fluxora-abandoned-lock-test";
    const std::wstring name =
        fluxora::installer::UpdateProcessLock::nameForInstallDirectory(install);
    HANDLE keeper = CreateMutexW(nullptr, FALSE, name.c_str());
    ASSERT_NE(nullptr, keeper);
    std::promise<void> acquired;
    std::thread owner([&] {
        HANDLE mutex = CreateMutexW(nullptr, FALSE, name.c_str());
        ASSERT_NE(nullptr, mutex);
        ASSERT_EQ(WAIT_OBJECT_0, WaitForSingleObject(mutex, INFINITE));
        acquired.set_value();
        // Deliberately abandon ownership. Closing is unnecessary when the thread
        // exits, but closing the handle proves abandonment is tied to ownership.
        CloseHandle(mutex);
    });
    acquired.get_future().wait();
    owner.join();

    auto recovered = fluxora::installer::UpdateProcessLock::acquire(
        install,
        std::chrono::seconds(1));
    EXPECT_TRUE(recovered.wasAbandoned());
    CloseHandle(keeper);
}

TEST(UpdateProcessLockTests, SecondProcessCannotAcquireUntilOwnerExits)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install = temporary.path() / L"install";
    const std::filesystem::path ready = temporary.path() / L"lock.ready";
    auto owner = fluxora::tests::ProbeProcess::launch(
        fluxora::tests::currentTestExecutable(),
        L"hold-lock",
        ready,
        install);
    ASSERT_TRUE(fluxora::tests::waitForFile(
        ready,
        std::chrono::seconds(10)));

    EXPECT_THROW(
        (void)fluxora::installer::UpdateProcessLock::acquire(
            install,
            std::chrono::milliseconds(50)),
        fluxora::installer::UpdateBusyError);

    owner.terminate();
    auto next = fluxora::installer::UpdateProcessLock::acquire(
        install,
        std::chrono::seconds(1));
    EXPECT_TRUE(next.ownsLock());
}

TEST(UpdateProcessLockTests, AbandonedProcessOwnerIsAcquiredForRecovery)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install = temporary.path() / L"install";
    const std::filesystem::path ready = temporary.path() / L"lock.ready";
    const std::wstring name =
        fluxora::installer::UpdateProcessLock::nameForInstallDirectory(install);
    HANDLE keeper = CreateMutexW(nullptr, FALSE, name.c_str());
    ASSERT_NE(nullptr, keeper);
    auto owner = fluxora::tests::ProbeProcess::launch(
        fluxora::tests::currentTestExecutable(),
        L"abandon-lock",
        ready,
        install);
    ASSERT_TRUE(fluxora::tests::waitForFile(
        ready,
        std::chrono::seconds(10)));
    ASSERT_TRUE(owner.wait(std::chrono::seconds(5)));

    auto recovered = fluxora::installer::UpdateProcessLock::acquire(
        install,
        std::chrono::seconds(1));

    EXPECT_TRUE(recovered.wasAbandoned());
    recovered.release();
    CloseHandle(keeper);
}

TEST(ParentProcessWaiterTests, ValidatesIdentityBeforeWaiting)
{
    fluxora::installer::UpdateWorkflowRequest request;
    request.parentPid = 1234;
    request.parentStartFileTime = 50'000'000;
    request.installDirectory = L"C:\\Fluxora";
    request.applicationExecutable = L"Fluxora.exe";
    bool waited = false;
    FakeParentResolver resolver(
        request.parentStartFileTime + 2'000,
        request.applicationPath(),
        waited);

    fluxora::installer::ParentProcessWaiter(resolver).wait(request);

    EXPECT_TRUE(waited);
}

TEST(ParentProcessWaiterTests, RejectsPidReuseWithoutWaiting)
{
    fluxora::installer::UpdateWorkflowRequest request;
    request.parentPid = 1234;
    request.parentStartFileTime = 50'000'000;
    request.installDirectory = L"C:\\Fluxora";
    request.applicationExecutable = L"Fluxora.exe";
    bool waited = false;
    FakeParentResolver resolver(
        request.parentStartFileTime + 60ULL * 10'000'000ULL,
        request.applicationPath(),
        waited);

    EXPECT_THROW(
        fluxora::installer::ParentProcessWaiter(resolver).wait(request),
        std::invalid_argument);
    EXPECT_FALSE(waited);
}

TEST(ParentProcessWaiterTests, ContinuesWhenParentExitsDuringExecutablePathRead)
{
    fluxora::installer::UpdateWorkflowRequest request;
    request.parentPid = 1234;
    request.parentStartFileTime = 50'000'000;
    request.installDirectory = L"C:\\Fluxora";
    request.applicationExecutable = L"Fluxora.exe";
    bool waited = false;
    FakeParentResolver resolver(
        request.parentStartFileTime,
        request.applicationPath(),
        waited,
        true,
        true);

    EXPECT_NO_THROW(fluxora::installer::ParentProcessWaiter(resolver).wait(request));
    EXPECT_FALSE(waited);
}

TEST(ParentProcessWaiterTests, PreservesPathFailureWhileParentIsRunning)
{
    fluxora::installer::UpdateWorkflowRequest request;
    request.parentPid = 1234;
    request.parentStartFileTime = 50'000'000;
    request.installDirectory = L"C:\\Fluxora";
    request.applicationExecutable = L"Fluxora.exe";
    bool waited = false;
    FakeParentResolver resolver(
        request.parentStartFileTime,
        request.applicationPath(),
        waited,
        true,
        false);

    EXPECT_THROW(
        fluxora::installer::ParentProcessWaiter(resolver).wait(request),
        std::system_error);
    EXPECT_FALSE(waited);
}
