#include "FluxoraCore/Services/VfsContentPlacementAnalyzer.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    namespace
    {
        ContentLayoutSupportRules skyrimLikeRules()
        {
            ContentLayoutSupportRules rules;
            rules.dataFolder = L"Data";
            rules.supportsRootFiles = true;
            rules.rootFileWrapperDirectory = L"root";
            rules.pluginExtensions = {
                NormalizedExtension::parseOrThrow(L".esm"),
                NormalizedExtension::parseOrThrow(L".esp"),
                NormalizedExtension::parseOrThrow(L".esl")
            };
            rules.archiveExtensions = {
                NormalizedExtension::parseOrThrow(L".bsa")
            };
            rules.gameDataDirectories = {
                L"meshes",
                L"textures",
                L"scripts",
                L"grass",
                L"skse"
            };
            rules.scriptExtenderDataPaths = {
                std::filesystem::path(L"SKSE") / L"Plugins"
            };
            return rules;
        }
    }

    TEST(VfsContentPlacementAnalyzerTests, DetectsDataWrapperRootSignalsAndRootBuilder)
    {
        TempDirectory temp;
        const std::filesystem::path mod = temp.path() / L"Mod";

        writeTextFile(mod / L"Data" / L"SkyUI.esp", "plugin");
        writeTextFile(mod / L"textures" / L"actors" / L"body.dds", "texture");
        writeTextFile(mod / L"root" / L"skse64_loader.exe", "loader");

        const VfsContentPlacementRoots roots =
            VfsContentPlacementAnalyzer().analyze(mod, skyrimLikeRules(), L"Data", L"root");

        EXPECT_TRUE(roots.dataWrapper);
        EXPECT_TRUE(roots.dataAtModRoot);
        EXPECT_FALSE(roots.rootBuilderData);
        EXPECT_TRUE(roots.rootBuilderRoot);
    }

    TEST(VfsContentPlacementAnalyzerTests, DetectsRootBuilderDataWithoutMountingDataOnlyRoot)
    {
        TempDirectory temp;
        const std::filesystem::path mod = temp.path() / L"Root Data Only";

        writeTextFile(mod / L"root" / L"Data" / L"Patch.esp", "plugin");

        const VfsContentPlacementRoots roots =
            VfsContentPlacementAnalyzer().analyze(mod, skyrimLikeRules(), L"Data", L"root");

        EXPECT_FALSE(roots.dataWrapper);
        EXPECT_FALSE(roots.dataAtModRoot);
        EXPECT_TRUE(roots.rootBuilderData);
        EXPECT_FALSE(roots.rootBuilderRoot);
    }

    TEST(VfsContentPlacementAnalyzerTests, DetectsGrassCacheOnlyModAsDataRootContent)
    {
        TempDirectory temp;
        const std::filesystem::path mod = temp.path() / L"Grass Cache";

        writeTextFile(mod / L"grass" / L"tamriel.cgid", "cached grass");

        const VfsContentPlacementRoots roots =
            VfsContentPlacementAnalyzer().analyze(mod, skyrimLikeRules(), L"Data", L"root");

        EXPECT_FALSE(roots.dataWrapper);
        EXPECT_TRUE(roots.dataAtModRoot);
        EXPECT_FALSE(roots.rootBuilderData);
        EXPECT_FALSE(roots.rootBuilderRoot);
    }

    TEST(VfsContentPlacementAnalyzerTests, IgnoresUnknownDeepContentDuringBoundedLaunchScan)
    {
        TempDirectory temp;
        const std::filesystem::path mod = temp.path() / L"Unknown";

        writeTextFile(mod / L"random" / L"deep" / L"payload.bin", "unknown");

        const VfsContentPlacementRoots roots =
            VfsContentPlacementAnalyzer().analyze(mod, skyrimLikeRules(), L"Data", L"root");

        EXPECT_FALSE(roots.dataWrapper);
        EXPECT_FALSE(roots.dataAtModRoot);
        EXPECT_FALSE(roots.rootBuilderData);
        EXPECT_FALSE(roots.rootBuilderRoot);
    }
}
