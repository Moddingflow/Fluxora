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
            R"({"schemaVersion":4,)"
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

        EXPECT_EQ(config.schemaVersion, 4);
        EXPECT_EQ(config.managerProcessId, 4242U);
        EXPECT_EQ(config.operationId, L"op-test-vfs");
        EXPECT_EQ(config.preparationMs, 37U);
        ASSERT_EQ(config.mounts.size(), 1U);
        EXPECT_EQ(config.mounts.front().target, L"C:\\Games\\Skyrim\\Data");
        EXPECT_EQ(config.mounts.front().whiteoutRoot, L"C:\\Build\\.flow\\whiteouts\\content");
    }

    TEST(VfsConfigTests, RejectsActiveDescriptorsFromOlderSchemas)
    {
        TempDirectory temp;
        const std::filesystem::path descriptor = temp.path() / L"vfs-config-v3.json";
        writeTextFile(
            descriptor,
            R"({"schemaVersion":3,"mounts":[{"target":"C:\\Game\\Data"}]})");
        ScopedEnvironmentVariable configPath(
            vfs::protocol::configEnvironmentVariable,
            descriptor.wstring());

        vfs::VfsConfig config;
        EXPECT_FALSE(vfs::loadVfsConfigFromEnvironment(config));
    }
}
