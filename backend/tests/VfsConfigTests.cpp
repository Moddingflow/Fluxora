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
            R"({"schemaVersion":3,)"
            R"("logPath":"C:\\Fluxora\\vfs.log",)"
            R"("hookDll":"C:\\Fluxora\\FluxoraVfs.dll",)"
            R"("managerProcessId":4242,)"
            R"("mounts":[{"target":"C:\\Games\\Skyrim\\Data","overwrite":"C:\\Build\\overwrite","mods":["C:\\Build\\mods\\A"]}]})");

        ScopedEnvironmentVariable configPath(
            vfs::protocol::configEnvironmentVariable,
            descriptor.wstring());

        vfs::VfsConfig config;
        ASSERT_TRUE(vfs::loadVfsConfigFromEnvironment(config));

        EXPECT_EQ(config.schemaVersion, 3);
        EXPECT_EQ(config.managerProcessId, 4242U);
        ASSERT_EQ(config.mounts.size(), 1U);
        EXPECT_EQ(config.mounts.front().target, L"C:\\Games\\Skyrim\\Data");
    }
}
