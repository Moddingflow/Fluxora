#include "FluxoraCore/Support/LaunchDescriptorStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora::tests
{
    TEST(LaunchDescriptorStoreTests, PrunesOnlyDescriptorsOwnedByDeadManagers)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Launch descriptor ownership is a Windows process contract.";
#else
        TempDirectory temp;
        const std::filesystem::path sessions = temp.path() / L"sessions";
        const std::uint32_t currentPid = GetCurrentProcessId();
        const std::filesystem::path current = sessions /
            (L"vfs-config-" + std::to_wstring(currentPid) + L"-current.json");
        const std::filesystem::path dead = sessions / L"vfs-config-4294967294-dead.json";
        const std::filesystem::path malformed = sessions / L"vfs-config-not-a-pid.json";
        const std::filesystem::path unrelated = sessions / L"notes.json";
        writeTextFile(current, "current");
        writeTextFile(dead, "dead");
        writeTextFile(malformed, "malformed");
        writeTextFile(unrelated, "unrelated");

        pruneDeadManagerLaunchDescriptors(sessions, currentPid);

        EXPECT_TRUE(std::filesystem::is_regular_file(current));
        EXPECT_FALSE(std::filesystem::exists(dead));
        EXPECT_TRUE(std::filesystem::is_regular_file(malformed));
        EXPECT_TRUE(std::filesystem::is_regular_file(unrelated));
#endif
    }
}
