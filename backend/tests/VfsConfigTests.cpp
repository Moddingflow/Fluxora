#include "FluxoraVfs/VfsConfig.hpp"
#include "FluxoraVfs/VfsProtocol.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    TEST(VfsConfigTests, LoadDescriptorCapturesManagerProcessIdForSessionLifetime)
    {
        TempDirectory temp;
        const std::filesystem::path descriptor = temp.path() / L"vfs-config.json";

        writeTextFile(
            descriptor,
            R"({"schemaVersion":5,)"
            R"("logPath":"C:\\Fluxora\\vfs.log",)"
            R"("hookDll":"C:\\Fluxora\\FluxoraVfs.dll",)"
            R"("managerProcessId":4242,)"
            R"("operationId":"op-test-vfs",)"
            R"("preparationMs":37,)"
            R"("mounts":[{"target":"C:\\Games\\Skyrim\\Data","overwrite":"C:\\Build\\overwrite","whiteoutRoot":"C:\\Build\\.flow\\whiteouts\\content","mods":["C:\\Build\\mods\\A"]}]})");

        ScopedEnvironmentVariable configPath(
            vfs::protocol::configEnvironmentVariable,
            descriptor.wstring());

        vfs::VfsConfig config;
        ASSERT_TRUE(vfs::loadVfsConfigFromEnvironment(config));

        EXPECT_EQ(config.schemaVersion, 5);
        EXPECT_EQ(config.managerProcessId, 4242U);
        EXPECT_EQ(config.operationId, L"op-test-vfs");
        EXPECT_EQ(config.preparationMs, 37U);
        ASSERT_EQ(config.mounts.size(), 1U);
        EXPECT_EQ(config.mounts.front().target, L"C:\\Games\\Skyrim\\Data");
        EXPECT_EQ(config.mounts.front().whiteoutRoot, L"C:\\Build\\.flow\\whiteouts\\content");
        EXPECT_TRUE(config.mounts.front().ownedFiles.empty());
    }

    TEST(VfsConfigTests, LoadDescriptorCapturesProfileOwnedStateFiles)
    {
        TempDirectory temp;
        const std::filesystem::path descriptor = temp.path() / L"vfs-config-owned.json";

        writeTextFile(
            descriptor,
            R"({"schemaVersion":5,)"
            R"("mounts":[{"target":"C:\\Users\\Me\\AppData\\Local\\Skyrim Special Edition",)"
            R"("overwrite":"C:\\Build\\.flow\\vfs\\profile-overwrite\\Default\\local-appdata",)"
            R"("mods":["C:\\Build\\profiles\\Default"],)"
            R"("ownedFiles":["plugins.txt","loadorder.txt"]}]})");

        ScopedEnvironmentVariable configPath(
            vfs::protocol::configEnvironmentVariable,
            descriptor.wstring());

        vfs::VfsConfig config;
        ASSERT_TRUE(vfs::loadVfsConfigFromEnvironment(config));
        ASSERT_EQ(config.mounts.size(), 1U);
        EXPECT_EQ(
            config.mounts.front().ownedFiles,
            (std::vector<std::wstring>{L"plugins.txt", L"loadorder.txt"}));
    }

    TEST(VfsConfigTests, RejectsActiveDescriptorsFromOlderSchemas)
    {
        TempDirectory temp;
        const std::filesystem::path descriptor = temp.path() / L"vfs-config-v4.json";
        writeTextFile(
            descriptor,
            R"({"schemaVersion":4,"mounts":[{"target":"C:\\Game\\Data"}]})");
        ScopedEnvironmentVariable configPath(
            vfs::protocol::configEnvironmentVariable,
            descriptor.wstring());

        vfs::VfsConfig config;
        EXPECT_FALSE(vfs::loadVfsConfigFromEnvironment(config));
    }
}
