#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModOrganizerImportService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <string>

namespace fluxora::tests
{
    namespace
    {
        void expectSamePath(
            const std::filesystem::path& actual,
            const std::filesystem::path& expected)
        {
            EXPECT_EQ(normalized(actual), normalized(expected));
        }

        void writeHealthySkyrimGame(const std::filesystem::path& gameDirectory)
        {
            writeTextFile(gameDirectory / L"SkyrimSE.exe", "MZ executable stub");
            writeTextFile(gameDirectory / L"Data" / L"Skyrim.esm", "master");
        }

        void writeMinimalModOrganizerInstance(const std::filesystem::path& source)
        {
            writeHealthySkyrimGame(source / L"GameRoot");
            writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
            writeTextFile(
                source / L"mods" / L"SkyUI" / L"meta.ini",
                "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\n");
            writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
            writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");

            const std::string ini =
                "[General]\n"
                "gameName=Skyrim Special Edition\n"
                "gamePath=GameRoot\n"
                "selected_profile=Default\n";

            writeTextFile(source / L"ModOrganizer.ini", ini);
        }

        class ImportHarness final
        {
        public:
            ImportHarness()
                : templates(logger),
                  projects(logger, templates),
                  pathSettings(logger),
                  importer(logger, templates, projects, pathSettings)
            {
                templates.initialize();
            }

            Logger logger;
            TemplateService templates;
            ProjectService projects;
            BuildPathSettingsService pathSettings;
            ModOrganizerImportService importer;
        };
    }

    TEST(ModOrganizerTransferBuildTests, AnalyzeDoesNotNestTransferRootWhenFluxoraBuildsFolderIsSelected)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path transferRoot = temp.path() / L"Library" / L"Fluxora Builds";
        writeMinimalModOrganizerInstance(source);

        ImportHarness harness;
        const ModOrganizerImportAnalysis analysis = harness.importer.analyze(source, transferRoot);

        expectSamePath(analysis.destinationRootDirectory, transferRoot);
        expectSamePath(analysis.targetProjectDirectory.parent_path(), transferRoot);
        EXPECT_FALSE(analysis.targetProjectDirectory.wstring().find(L"Fluxora Builds\\Fluxora Builds") !=
            std::wstring::npos);
    }

    TEST(ModOrganizerTransferBuildTests, AnalyzeBlocksDestinationInsideSourceTree)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        writeMinimalModOrganizerInstance(source);

        ImportHarness harness;
        const ModOrganizerImportAnalysis analysis =
            harness.importer.analyze(source, source / L"Nested Destination");

        EXPECT_FALSE(analysis.canImport);
        EXPECT_NE(analysis.statusMessage.find(L"источник"), std::wstring::npos);
        EXPECT_NE(analysis.warningMessage.find(L"отдельную"), std::wstring::npos);
    }

    TEST(ModOrganizerTransferBuildTests, ImportCopiesConfiguredOrganizerFoldersIntoStandardBuildLayout)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path base = source / L"PortableData";
        const std::filesystem::path destinationRoot = temp.path() / L"Imported";

        writeHealthySkyrimGame(source / L"GameRoot");
        writeTextFile(base / L"ModsStore" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(
            base / L"ModsStore" / L"SkyUI" / L"meta.ini",
            "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\n");
        writeTextFile(base / L"ProfilesStore" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(base / L"ProfilesStore" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(base / L"DownloadsStore" / L"SkyUI.7z", "download cache");
        writeTextFile(base / L"OverwriteStore" / L"SKSE" / L"Plugins" / L"generated.log", "overwrite");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n"
            "\n"
            "[Settings]\n"
            "base_directory=PortableData\n"
            "mod_directory=ModsStore\n"
            "profiles_directory=ProfilesStore\n"
            "download_directory=DownloadsStore\n"
            "overwrite_directory=OverwriteStore\n");

        ImportHarness harness;
        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;

        const ModOrganizerImportResult result = harness.importer.importInstance(request);
        const std::filesystem::path target = result.analysis.targetProjectDirectory;

        expectSamePath(result.analysis.destinationRootDirectory, destinationRoot / L"Fluxora Builds");
        EXPECT_TRUE(std::filesystem::is_regular_file(target / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf"));
        EXPECT_TRUE(std::filesystem::is_regular_file(target / L"profiles" / L"Default" / L"modlist.txt"));
        EXPECT_TRUE(std::filesystem::is_regular_file(target / L"downloads" / L"SkyUI.7z"));
        EXPECT_TRUE(std::filesystem::is_regular_file(target / L"overwrite" / L"SKSE" / L"Plugins" / L"generated.log"));
        EXPECT_TRUE(std::filesystem::is_regular_file(target / L"GameRoot" / L"Data" / L"Skyrim.esm"));
        EXPECT_FALSE(std::filesystem::exists(target / L"PortableData"));

        const BuildPathSettings settings = harness.pathSettings.loadForConfig(result.analysis.targetConfigPath);
        expectSamePath(settings.gameDirectory, target / L"GameRoot");
        expectSamePath(settings.modsDirectory, target / L"mods");
        expectSamePath(settings.profilesDirectory, target / L"profiles");
        expectSamePath(settings.downloadsDirectory, target / L"downloads");
        expectSamePath(settings.overwriteDirectory, target / L"overwrite");

        const std::string localPaths = readTextFile(target / L".fluxora" / L"paths.json");
        EXPECT_NE(localPaths.find("\"modsDirectory\":\"mods\""), std::string::npos);
        EXPECT_NE(localPaths.find("\"profilesDirectory\":\"profiles\""), std::string::npos);
        EXPECT_NE(localPaths.find("\"downloadsDirectory\":\"downloads\""), std::string::npos);
        EXPECT_NE(localPaths.find("\"overwriteDirectory\":\"overwrite\""), std::string::npos);
    }

    TEST(ModOrganizerTransferBuildTests, BuildPathSettingsRepairsOrganizerRootGamePathAfterMove)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Transferred Build";

        writeHealthySkyrimGame(project / L"stock game");
        writeTextFile(project / L"old-mo2-root" / L"ModOrganizer.ini", "[General]\n");
        std::filesystem::create_directories(project / L"old-mo2-root" / L"mods");
        std::filesystem::create_directories(project / L"old-mo2-root" / L"profiles");
        writeTextFile(
            project / L".fluxora" / L"paths.json",
            "{\"gameDirectory\":\"old-mo2-root\"}");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);

        const BuildPathSettings settings = pathSettings.loadForProjectDirectory(project);

        expectSamePath(settings.gameDirectory, project / L"stock game");
        expectSamePath(settings.modsDirectory, project / L"mods");
        expectSamePath(settings.profilesDirectory, project / L"profiles");
        expectSamePath(settings.downloadsDirectory, project / L"downloads");
        expectSamePath(settings.overwriteDirectory, project / L"overwrite");
    }

    TEST(ModOrganizerTransferBuildTests, BuildPathSettingsKeepsHealthyExplicitGamePathAfterMove)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Transferred Build";

        writeHealthySkyrimGame(project / L"stock game");
        writeHealthySkyrimGame(project / L"SharedGame");
        writeTextFile(
            project / L".fluxora" / L"paths.json",
            "{\"gameDirectory\":\"SharedGame\"}");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);

        const BuildPathSettings settings = pathSettings.loadForProjectDirectory(project);

        expectSamePath(settings.gameDirectory, project / L"SharedGame");
    }
}
