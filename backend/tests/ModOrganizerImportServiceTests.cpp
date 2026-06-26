#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModOrganizerImportService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <atomic>
#include <stdexcept>
#include <vector>

namespace fluxora::tests
{
    TEST(ModOrganizerImportServiceTests, AnalyzePlacesDriveRootImportsInsideFluxoraBuilds)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path driveRoot = temp.path().root_path();

        writeTextFile(source / L"GameRoot" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(source / L"GameRoot" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(
            source / L"mods" / L"SkyUI" / L"meta.ini",
            "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        const ModOrganizerImportAnalysis analysis = importer.analyze(source, driveRoot);
        const std::filesystem::path expectedRoot = driveRoot / L"Fluxora Builds";

        EXPECT_EQ(normalized(analysis.destinationRootDirectory), normalized(expectedRoot));
        EXPECT_EQ(
            normalized(analysis.targetProjectDirectory.parent_path()),
            normalized(expectedRoot));
    }

    TEST(ModOrganizerImportServiceTests, AnalyzePlacesFolderImportsInsideFluxoraBuilds)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path destinationRoot = temp.path() / L"SelectedLibrary";

        writeTextFile(source / L"GameRoot" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(source / L"GameRoot" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(
            source / L"mods" / L"SkyUI" / L"meta.ini",
            "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        const ModOrganizerImportAnalysis analysis = importer.analyze(source, destinationRoot);
        const std::filesystem::path expectedRoot = destinationRoot / L"Fluxora Builds";

        EXPECT_EQ(normalized(analysis.destinationRootDirectory), normalized(expectedRoot));
        EXPECT_EQ(
            normalized(analysis.targetProjectDirectory.parent_path()),
            normalized(expectedRoot));
    }

    TEST(ModOrganizerImportServiceTests, ImportCreatesFluxoraBuildsFolderForCyrillicBuildName)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"Сборка";
        const std::filesystem::path destinationRoot = temp.path() / L"SelectedDrive";

        writeTextFile(source / L"GameRoot" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(source / L"GameRoot" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(
            source / L"mods" / L"SkyUI" / L"meta.ini",
            "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;

        const ModOrganizerImportResult result = importer.importInstance(request);

        const std::filesystem::path expectedRoot = destinationRoot / L"Fluxora Builds";
        const std::filesystem::path expectedBuild = expectedRoot / L"Сборка";
        EXPECT_EQ(normalized(result.analysis.destinationRootDirectory), normalized(expectedRoot));
        EXPECT_EQ(normalized(result.analysis.targetProjectDirectory), normalized(expectedBuild));
        EXPECT_TRUE(std::filesystem::is_directory(expectedRoot));
        EXPECT_TRUE(std::filesystem::is_directory(expectedBuild));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            expectedBuild / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf"));
        EXPECT_FALSE(std::filesystem::exists(destinationRoot / L"Сборка"));
    }

    TEST(ModOrganizerImportServiceTests, ImportPersistsBuildInAppDataCatalogForRestart)
    {
        TempDirectory temp;
        const std::filesystem::path appDataRoot = temp.path() / L"AppData" / L"Roaming";
        ScopedEnvironmentVariable appData(L"APPDATA", appDataRoot.wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path destinationRoot = temp.path() / L"SelectedDrive";

        writeTextFile(source / L"GameRoot" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(source / L"GameRoot" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(
            source / L"mods" / L"SkyUI" / L"meta.ini",
            "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;

        const ModOrganizerImportResult result = importer.importInstance(request);
        const std::filesystem::path catalogDirectory = appDataRoot / L"Fluxora" / L"Builds";

        EXPECT_EQ(normalized(result.project.project.configPath.parent_path()), normalized(catalogDirectory));
        EXPECT_TRUE(std::filesystem::is_regular_file(result.project.project.configPath));

        ProjectService reloadedProjects(logger, templates);
        reloadedProjects.initialize();
        const std::vector<ProjectOpenResult> reloaded =
            reloadedProjects.listProjectConfigSummaries(catalogDirectory);

        ASSERT_EQ(reloaded.size(), 1U);
        EXPECT_EQ(reloaded[0].project.name, result.project.project.name);
        EXPECT_EQ(normalized(reloaded[0].project.projectDirectory), normalized(result.project.project.projectDirectory));
        EXPECT_EQ(normalized(reloaded[0].project.configPath), normalized(result.project.project.configPath));
    }

    TEST(ModOrganizerImportServiceTests, ImportSkipsTransientInstanceDatabaseSidecars)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path destinationRoot = temp.path() / L"Imported";

        writeTextFile(source / L"GameRoot" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(source / L"GameRoot" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(source / L"mods" / L"SkyUI" / L"InstanceDB-wal", "stale sqlite wal");
        writeTextFile(source / L"mods" / L"SkyUI" / L"meta.ini", "[General]\nname=SkyUI\nversion=1\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(source / L"profiles" / L"Default" / L"InstanceDB-shm", "stale sqlite shm");
        writeTextFile(source / L"profiles" / L"Default" / L"notes.txt", "profile note");
        writeTextFile(source / L"downloads" / L"instance.db-wal", "stale sqlite wal");
        writeTextFile(source / L"overwrite" / L"instance.db-journal", "stale sqlite journal");
        writeTextFile(source / L"overwrite" / L"SKSE" / L"Plugins" / L"generated.log", "overwrite");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;

        const ModOrganizerImportResult result = importer.importInstance(request);
        const std::filesystem::path target = result.analysis.targetProjectDirectory;

        EXPECT_FALSE(std::filesystem::exists(target / L"mods" / L"SkyUI" / L"InstanceDB-wal"));
        EXPECT_FALSE(std::filesystem::exists(target / L"profiles" / L"Default" / L"InstanceDB-shm"));
        EXPECT_FALSE(std::filesystem::exists(target / L"downloads" / L"instance.db-wal"));
        EXPECT_FALSE(std::filesystem::exists(target / L"overwrite" / L"instance.db-journal"));
        EXPECT_TRUE(std::filesystem::is_regular_file(target / L"profiles" / L"Default" / L"notes.txt"));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            target / L"overwrite" / L"SKSE" / L"Plugins" / L"generated.log"));
    }

    TEST(ModOrganizerImportServiceTests, ImportCopiesQtByteArrayOverwriteDirectory)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path destinationRoot = temp.path() / L"Imported";

        writeTextFile(source / L"GameRoot" / L"SkyrimSE.exe", "MZ executable stub");
        std::filesystem::create_directories(source / L"GameRoot" / L"Data");
        writeTextFile(source / L"GameRoot" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(
            source / L"mods" / L"SkyUI" / L"meta.ini",
            "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\nnewestVersion=5.2\n");
        writeTextFile(source / L"mods" / L"Address Library" / L"skse" / L"plugins" / L"versionlib.bin", "lib");
        writeTextFile(
            source / L"mods" / L"Address Library" / L"meta.ini",
            "[General]\nname=Address Library\nversion=11\nmodid=32444\n"
            "\n"
            "[installedFiles]\n"
            "1\\modid=32444\n"
            "1\\fileid=392563\n"
            "size=1\n");
        writeTextFile(source / L"mods" / L"Local Translation Patch" / L"Data" / L"LocalPatch.esp", "patch");
        writeTextFile(
            source / L"mods" / L"Local Translation Patch" / L"meta.ini",
            "[General]\n"
            "name=Local Translation Patch\n"
            "version=2\n"
            "category=Translations; Patches\n");
        writeTextFile(
            source / L"profiles" / L"Default" / L"modlist.txt",
            "+SkyUI\n+Address Library\n-Local Translation Patch\n");
        writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(source / L"external overwrite" / L"SKSE" / L"Plugins" / L"generated.log", "overwrite");

        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n"
            "\n"
            "[Settings]\n"
            "overwrite_directory=@ByteArray(external overwrite)\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;

        const ModOrganizerImportResult result = importer.importInstance(request);

        const std::filesystem::path expectedTransferRoot = destinationRoot / L"Fluxora Builds";
        EXPECT_EQ(normalized(result.analysis.destinationRootDirectory), normalized(expectedTransferRoot));
        EXPECT_EQ(normalized(result.analysis.targetProjectDirectory.parent_path()), normalized(expectedTransferRoot));
        EXPECT_TRUE(std::filesystem::is_directory(expectedTransferRoot));

        const std::filesystem::path importedOverwrite =
            result.analysis.targetProjectDirectory / L"overwrite" / L"SKSE" / L"Plugins" / L"generated.log";
        ASSERT_TRUE(std::filesystem::is_regular_file(importedOverwrite));
        EXPECT_EQ(readTextFile(importedOverwrite), "overwrite");

        const BuildPathSettings settings = pathSettings.loadForConfig(result.analysis.targetConfigPath);
        EXPECT_EQ(normalized(settings.gameDirectory), normalized(result.analysis.targetProjectDirectory / L"GameRoot"));
        EXPECT_EQ(normalized(settings.overwriteDirectory), normalized(result.analysis.targetProjectDirectory / L"overwrite"));

        const std::string manifest = readTextFile(result.analysis.targetConfigPath);
        EXPECT_NE(manifest.find("GameRoot"), std::string::npos);
        EXPECT_NE(manifest.find("\"projectFingerprint\""), std::string::npos);
        EXPECT_NE(manifest.find("\"gameId\":\"skyrimse\""), std::string::npos);
        EXPECT_NE(manifest.find("\"healthStatusAtCreation\":\"warning\""), std::string::npos);

        const std::vector<InstalledModRecord> importedMods =
            InstanceMetadataStore::listInstalledMods(result.analysis.targetProjectDirectory);
        const auto skyUi = std::find_if(
            importedMods.begin(),
            importedMods.end(),
            [](const InstalledModRecord& mod)
            {
                return mod.folderName == L"SkyUI";
            });
        ASSERT_NE(skyUi, importedMods.end());
        EXPECT_EQ(skyUi->source.provider, L"nexus");
        EXPECT_EQ(skyUi->source.remoteModId, L"3863");
        EXPECT_EQ(skyUi->source.remoteFileId, L"123");
        EXPECT_EQ(skyUi->source.url, L"nxm://skyrimspecialedition/mods/3863/files/123");
        EXPECT_TRUE(skyUi->sourceIsNexus);
        EXPECT_FALSE(std::filesystem::exists(result.analysis.targetProjectDirectory / L"mods" / L"SkyUI" / L"meta.ini"));

        const auto addressLibrary = std::find_if(
            importedMods.begin(),
            importedMods.end(),
            [](const InstalledModRecord& mod)
            {
                return mod.folderName == L"Address Library";
            });
        ASSERT_NE(addressLibrary, importedMods.end());
        EXPECT_EQ(addressLibrary->source.provider, L"nexus");
        EXPECT_EQ(addressLibrary->source.remoteModId, L"32444");
        EXPECT_EQ(addressLibrary->source.remoteFileId, L"392563");
        EXPECT_EQ(addressLibrary->source.url, L"nxm://skyrimspecialedition/mods/32444/files/392563");

        const auto localPatch = std::find_if(
            importedMods.begin(),
            importedMods.end(),
            [](const InstalledModRecord& mod)
            {
                return mod.folderName == L"Local Translation Patch";
            });
        ASSERT_NE(localPatch, importedMods.end());
        EXPECT_EQ(localPatch->source.provider, L"local");
        EXPECT_TRUE(localPatch->isLocal);
        EXPECT_TRUE(localPatch->isTranslation);
        EXPECT_TRUE(localPatch->isPatch);
        EXPECT_EQ(localPatch->state, L"disabled");
        EXPECT_FALSE(std::filesystem::exists(
            result.analysis.targetProjectDirectory / L"mods" / L"Local Translation Patch" / L"meta.ini"));
    }

    TEST(ModOrganizerImportServiceTests, ImportRejectsUnsupportedGameInsteadOfUsingFirstTemplate)
    {
        TempDirectory temp;

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path destinationRoot = temp.path() / L"Imported";

        writeTextFile(source / L"mods" / L"Generic Mod" / L"meta.ini", "[General]\nname=Generic Mod\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+Generic Mod\n");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Definitely Unknown Game\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;

        EXPECT_THROW((void)importer.importInstance(request), std::invalid_argument);
    }

    TEST(ModOrganizerImportServiceTests, ImportCancellationCleansStagingDirectory)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path destinationRoot = temp.path() / L"Imported";

        writeTextFile(source / L"GameRoot" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(source / L"GameRoot" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(
            source / L"mods" / L"SkyUI" / L"meta.ini",
            "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        std::atomic_bool cancel{false};
        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;
        request.cancellationRequested = [&cancel]()
        {
            return cancel.load(std::memory_order_relaxed);
        };
        request.progress = [&cancel](const ModOrganizerImportProgress& progress)
        {
            if (progress.currentStep == L"Готовлю временную копию")
            {
                cancel.store(true, std::memory_order_relaxed);
            }
        };

        EXPECT_THROW((void)importer.importInstance(request), std::runtime_error);
        const std::filesystem::path transferRoot = destinationRoot / L"Fluxora Builds";
        EXPECT_FALSE(std::filesystem::exists(transferRoot / L"MO2"));
        if (std::filesystem::exists(transferRoot))
        {
            std::error_code error;
            EXPECT_EQ(
                std::distance(
                    std::filesystem::directory_iterator(transferRoot, error),
                    std::filesystem::directory_iterator()),
                0);
            EXPECT_FALSE(error);
        }
    }

    TEST(ModOrganizerImportServiceTests, ImportRejectsSupportedGameWithBadHealth)
    {
        TempDirectory temp;

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path destinationRoot = temp.path() / L"Imported";

        std::filesystem::create_directories(source / L"GameRoot");
        writeTextFile(source / L"mods" / L"SkyUI" / L"meta.ini", "[General]\nname=SkyUI\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        const ModOrganizerImportAnalysis analysis = importer.analyze(source, destinationRoot);
        EXPECT_FALSE(analysis.canImport);
        EXPECT_NE(analysis.statusMessage.find(L"Невозможно импортировать сборку"), std::wstring::npos);

        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;

        EXPECT_THROW((void)importer.importInstance(request), std::invalid_argument);
    }
}
