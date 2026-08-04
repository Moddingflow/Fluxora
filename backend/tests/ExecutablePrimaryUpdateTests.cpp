#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/Logger.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    namespace
    {
        std::filesystem::path writeExecutableProject(TempDirectory& temp)
        {
            const std::filesystem::path project = temp.path() / L"Build";
            const std::filesystem::path config = project / L"build.json";
            writeTextFile(
                config,
                "{"
                "\"schemaVersion\":\"1\","
                "\"name\":\"Build\","
                "\"templateId\":\"skyrimse\","
                "\"gameName\":\"Skyrim Special Edition\","
                "\"gamePath\":\"Game\","
                "\"dataDirectory\":\"Data\","
                "\"defaultProfile\":\"Default\","
                "\"launchExecutables\":["
                "{\"id\":\"tool-b\",\"displayName\":\"User Tool B\","
                "\"executablePath\":\"tools\\\\b.exe\",\"arguments\":\"--b-secret\","
                "\"workingDirectory\":\"tools\",\"managedToolKind\":\"bodySlide\"},"
                "{\"id\":\"game\",\"displayName\":\"My Skyrim Name\","
                "\"executablePath\":\"SkyrimSE.exe\",\"arguments\":\"--keep-primary-args\","
                "\"workingDirectory\":\"\"},"
                "{\"id\":\"tool-a\",\"displayName\":\"User Tool A\","
                "\"executablePath\":\"tools\\\\a.exe\",\"arguments\":\"--a-secret\","
                "\"workingDirectory\":\"custom-work\"}"
                "]"
                "}");
            return config;
        }
    }

    TEST(ExecutablePrimaryUpdateTests, UpdatesOnlyFreshPrimaryAndPreservesManualEntriesAndOrder)
    {
        TempDirectory temp;
        const std::filesystem::path config = writeExecutableProject(temp);

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService icons(logger);
        ExecutableService service(logger, icons, pathSettings);

        std::vector<GameExecutable> managerSaved = service.listProjectExecutables(config);
        ASSERT_EQ(managerSaved.size(), 3u);
        managerSaved[0].displayName = L"Renamed Tool B";
        managerSaved[2].displayName = L"Renamed Tool A";
        managerSaved = service.saveProjectExecutables(config, managerSaved);

        const std::vector<GameExecutable> updated = service.updatePrimaryExecutable(
            config,
            temp.path() / L"New Game" / L"SkyrimSE.exe");

        ASSERT_EQ(updated.size(), 3u);
        EXPECT_EQ(updated[0].id, L"tool-b");
        EXPECT_EQ(updated[0].displayName, L"Renamed Tool B");
        EXPECT_EQ(updated[0].arguments, L"--b-secret");
        EXPECT_EQ(updated[0].managedToolKind, L"bodySlide");
        EXPECT_EQ(updated[1].id, L"game");
        EXPECT_EQ(updated[1].displayName, L"My Skyrim Name");
        EXPECT_EQ(updated[1].arguments, L"--keep-primary-args");
        EXPECT_EQ(updated[1].executablePath, (temp.path() / L"New Game" / L"SkyrimSE.exe").wstring());
        EXPECT_EQ(updated[2].id, L"tool-a");
        EXPECT_EQ(updated[2].displayName, L"Renamed Tool A");
        EXPECT_EQ(updated[2].arguments, L"--a-secret");
        EXPECT_EQ(updated[2].workingDirectory, L"custom-work");
    }

    TEST(ExecutablePrimaryUpdateTests, StoresPrimaryInsideBuildRelativeToFluxoraProject)
    {
        TempDirectory temp;
        const std::filesystem::path config = writeExecutableProject(temp);
        const std::filesystem::path executable =
            config.parent_path() / L"Game" / L"SkyrimSE.exe";
        writeTextFile(executable, "MZ executable stub");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService icons(logger);
        ExecutableService service(logger, icons, pathSettings);

        const std::vector<GameExecutable> updated =
            service.updatePrimaryExecutable(config, executable);

        ASSERT_EQ(updated.size(), 3u);
        EXPECT_EQ(
            std::filesystem::path(updated[1].executablePath),
            std::filesystem::path(L"Game") / L"SkyrimSE.exe");
    }
}
