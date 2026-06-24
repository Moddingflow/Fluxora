#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        constexpr const char* LegacySkyrimManifest = R"json({
            "schemaVersion": "1",
            "name": "Legacy Skyrim Build",
            "templateId": "skyrimse",
            "gameName": "Skyrim Special Edition",
            "gamePath": "Game",
            "installRoot": "..",
            "projectDirectory": ".",
            "dataDirectory": "Data",
            "defaultProfile": "Default"
        })json";

        constexpr const char* LegacySkyrimManifestWithoutTemplateId = R"json({
            "schemaVersion": "1",
            "name": "Legacy Skyrim Build",
            "gameName": "Skyrim Special Edition",
            "gamePath": "Game",
            "installRoot": "..",
            "projectDirectory": ".",
            "dataDirectory": "Data",
            "defaultProfile": "Default"
        })json";

        constexpr const char* LegacySkyrimExecutableManifestWithoutTemplateId = R"json({
            "schemaVersion": "1",
            "name": "Legacy Skyrim Build",
            "gameName": "Skyrim Special Edition",
            "gamePath": "Game/SkyrimSE.exe",
            "installRoot": "..",
            "projectDirectory": ".",
            "dataDirectory": "Data",
            "defaultProfile": "Default"
        })json";
    }

    TEST(ProjectServiceTests, CreateSkyrimProjectSeedsProfileAndManifestFromSupportRules)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        std::filesystem::create_directories(installRoot);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectDescriptor project = projects.createProject(ProjectCreateRequest{
            L"Skyrim Build",
            L"skyrimse",
            game,
            installRoot
        });

        const std::filesystem::path profile =
            project.projectDirectory / L"profiles" / L"Default";
        const std::string plugins = readTextFile(profile / L"plugins.txt");
        const std::string loadOrder = readTextFile(profile / L"loadorder.txt");
        EXPECT_NE(plugins.find("*Skyrim.esm\n"), std::string::npos);
        EXPECT_NE(plugins.find("*Update.esm\n"), std::string::npos);
        EXPECT_NE(plugins.find("*Dawnguard.esm\n"), std::string::npos);
        EXPECT_NE(plugins.find("*HearthFires.esm\n"), std::string::npos);
        EXPECT_NE(plugins.find("*Dragonborn.esm\n"), std::string::npos);
        EXPECT_NE(loadOrder.find("Skyrim.esm\n"), std::string::npos);
        EXPECT_NE(loadOrder.find("Dragonborn.esm\n"), std::string::npos);

        const std::string manifest = readTextFile(project.configPath);
        EXPECT_NE(manifest.find("\"templateId\":\"skyrimse\""), std::string::npos);
        EXPECT_NE(manifest.find("\"dataDirectory\":\"Data\""), std::string::npos);
        EXPECT_NE(manifest.find("\"pluginExtensions\":[\".esm\",\".esp\",\".esl\"]"), std::string::npos);
        EXPECT_NE(manifest.find("\"loaderExecutable\":\"skse64_loader.exe\""), std::string::npos);
        EXPECT_NE(manifest.find("\"executablePath\":\"SkyrimSE.exe\""), std::string::npos);
        EXPECT_NE(manifest.find("\"gameId\":\"skyrimse\""), std::string::npos);
        EXPECT_NE(manifest.find("\"gameDisplayName\":\"Skyrim Special Edition\""), std::string::npos);
        EXPECT_NE(manifest.find("\"projectFingerprint\""), std::string::npos);
        EXPECT_NE(manifest.find("\"detectionSource\":\"manual-path\""), std::string::npos);
        EXPECT_NE(manifest.find("\"detectionConfidence\":\"explicit\""), std::string::npos);
        EXPECT_NE(manifest.find("\"healthStatusAtCreation\":\"warning\""), std::string::npos);
        EXPECT_NE(manifest.find("\"selectedExecutable\":\"SkyrimSE.exe\""), std::string::npos);

        const ProjectOpenResult opened = projects.openProjectConfig(project.configPath);
        ASSERT_TRUE(opened.project.fingerprint.has_value());
        EXPECT_EQ(opened.project.fingerprint->gameId, L"skyrimse");
        EXPECT_EQ(opened.project.fingerprint->gameDisplayName, L"Skyrim Special Edition");
        EXPECT_EQ(opened.project.fingerprint->selectedExecutable, std::filesystem::path(L"SkyrimSE.exe"));
#endif
    }

    TEST(ProjectServiceTests, CreateSkyrimProjectRejectsMissingRequiredFiles)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        std::filesystem::create_directories(game / L"Data");
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        std::filesystem::create_directories(installRoot);

        Logger logger;
        Logger::setOperationId(L"project-create-bad-path-test");
        logger.initialize();
        const std::filesystem::path operationsLogPath = logger.operationsLogPath();
        ASSERT_FALSE(operationsLogPath.empty());
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        try
        {
            (void)projects.createProject(ProjectCreateRequest{
                L"Broken Skyrim Build",
                L"skyrimse",
                game,
                installRoot
            });
            FAIL() << "Expected project creation to reject the broken Skyrim path.";
        }
        catch (const std::invalid_argument& exception)
        {
            const std::string message = exception.what();
            EXPECT_NE(message.find("Game install is broken and cannot be used."), std::string::npos);
            EXPECT_NE(message.find("Required game file is missing: SkyrimSE.exe"), std::string::npos);
        }

        logger.shutdown();
        Logger::clearOperationId();

        const std::string operationsLog = readTextFile(operationsLogPath);
        EXPECT_NE(operationsLog.find("operationId=project-create-bad-path-test"), std::string::npos);
        EXPECT_NE(operationsLog.find("createProject blocked"), std::string::npos);
        EXPECT_NE(operationsLog.find("healthResult=\"broken\""), std::string::npos);
        EXPECT_NE(operationsLog.find("missingFiles=\""), std::string::npos);
        EXPECT_NE(operationsLog.find("SkyrimSE.exe"), std::string::npos);
        EXPECT_NE(operationsLog.find("Data/Skyrim.esm"), std::string::npos);
#endif
    }

    TEST(ProjectServiceTests, CreateProjectRejectsUnsafeInstallRoot)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::wstring windows(MAX_PATH, L'\0');
        const UINT length = GetWindowsDirectoryW(windows.data(), static_cast<UINT>(windows.size()));
        if (length == 0 || length >= windows.size())
        {
            GTEST_SKIP() << "Windows directory could not be resolved.";
        }
        windows.resize(length);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        try
        {
            (void)projects.createProject(ProjectCreateRequest{
                L"Unsafe Root Build",
                L"skyrimse",
                game,
                std::filesystem::path(windows)
            });
            FAIL() << "Expected project creation to reject an unsafe install root.";
        }
        catch (const std::invalid_argument& exception)
        {
            const std::string message = exception.what();
            EXPECT_NE(message.find("Install root directory is unsafe"), std::string::npos);
            EXPECT_NE(message.find("Writes to system folders are blocked"), std::string::npos);
        }

        EXPECT_FALSE(std::filesystem::exists(temp.path() / L"AppData" / L"Fluxora" / L"Builds"));
#endif
    }

    TEST(ProjectServiceTests, OpenLegacySkyrimManifestPreservesPluginAndLoadOrderState)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Opening a project initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path projectDirectory = temp.path() / L"Legacy Skyrim Build";
        const std::filesystem::path profile = projectDirectory / L"profiles" / L"Default";
        const std::filesystem::path pluginsPath = profile / L"plugins.txt";
        const std::filesystem::path loadOrderPath = profile / L"loadorder.txt";
        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(projectDirectory / L"Game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(pluginsPath, "*Skyrim.esm\n*SkyUI_SE.esp\n");
        writeTextFile(loadOrderPath, "SkyUI_SE.esp\nSkyrim.esm\n");
        const std::filesystem::path configPath = projectDirectory / L"legacy.build.json";
        writeTextFile(configPath, std::string(LegacySkyrimManifest));

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectOpenResult opened = projects.openProjectConfig(configPath);

        EXPECT_EQ(opened.project.templateId, L"skyrimse");
        EXPECT_EQ(opened.resolvedTemplate.id, L"skyrimse");
        ASSERT_TRUE(opened.project.fingerprint.has_value());
        EXPECT_EQ(opened.project.fingerprint->gameId, L"skyrimse");
        EXPECT_EQ(InstanceMetadataStore::gameId(projectDirectory), L"skyrimse");
        EXPECT_EQ(readTextFile(pluginsPath), "*Skyrim.esm\n*SkyUI_SE.esp\n");
        EXPECT_EQ(readTextFile(loadOrderPath), "SkyUI_SE.esp\nSkyrim.esm\n");

        const std::string migratedManifest = readTextFile(configPath);
        EXPECT_NE(migratedManifest.find("\"gameId\":\"skyrimse\""), std::string::npos);
        EXPECT_NE(migratedManifest.find("\"projectFingerprint\""), std::string::npos);
#endif
    }

    TEST(ProjectServiceTests, OpenLegacySkyrimManifestWithoutTemplateIdMigratesTypedGameFields)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Opening a project initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path projectDirectory = temp.path() / L"Legacy Skyrim Build";
        const std::filesystem::path profile = projectDirectory / L"profiles" / L"Default";
        const std::filesystem::path pluginsPath = profile / L"plugins.txt";
        const std::filesystem::path loadOrderPath = profile / L"loadorder.txt";
        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(projectDirectory / L"Game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(pluginsPath, "*Skyrim.esm\n*SkyUI_SE.esp\n");
        writeTextFile(loadOrderPath, "SkyUI_SE.esp\nSkyrim.esm\n");
        const std::filesystem::path configPath = projectDirectory / L"legacy.build.json";
        writeTextFile(configPath, std::string(LegacySkyrimManifestWithoutTemplateId));

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectOpenResult opened = projects.openProjectConfig(configPath);

        EXPECT_EQ(opened.project.templateId, L"skyrimse");
        EXPECT_EQ(opened.resolvedTemplate.id, L"skyrimse");
        ASSERT_TRUE(opened.project.fingerprint.has_value());
        EXPECT_EQ(opened.project.fingerprint->gameId, L"skyrimse");
        EXPECT_EQ(InstanceMetadataStore::gameId(projectDirectory), L"skyrimse");
        EXPECT_EQ(readTextFile(pluginsPath), "*Skyrim.esm\n*SkyUI_SE.esp\n");
        EXPECT_EQ(readTextFile(loadOrderPath), "SkyUI_SE.esp\nSkyrim.esm\n");

        const std::string migratedManifest = readTextFile(configPath);
        EXPECT_NE(migratedManifest.find("\"templateId\":\"skyrimse\""), std::string::npos);
        EXPECT_NE(migratedManifest.find("\"gameId\":\"skyrimse\""), std::string::npos);
        EXPECT_NE(migratedManifest.find("\"projectFingerprint\""), std::string::npos);

        const std::filesystem::path backupPath = AtomicFileStore::backupPathFor(configPath);
        ASSERT_TRUE(std::filesystem::exists(backupPath));
        const std::string backupManifest = readTextFile(backupPath);
        EXPECT_EQ(backupManifest.find("\"gameId\":\"skyrimse\""), std::string::npos);
        EXPECT_EQ(backupManifest.find("\"projectFingerprint\""), std::string::npos);
#endif
    }

    TEST(ProjectServiceTests, OpenLegacySkyrimManifestWithBrokenHealthRecordsBlockingFingerprint)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Opening a project initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path projectDirectory = temp.path() / L"Legacy Skyrim Build";
        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ");
        const std::filesystem::path configPath = projectDirectory / L"legacy.build.json";
        writeTextFile(configPath, std::string(LegacySkyrimExecutableManifestWithoutTemplateId));

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectOpenResult opened = projects.openProjectConfig(configPath);

        EXPECT_EQ(opened.project.templateId, L"skyrimse");
        ASSERT_TRUE(opened.project.fingerprint.has_value());
        EXPECT_EQ(opened.project.fingerprint->gameId, L"skyrimse");
        EXPECT_EQ(opened.project.fingerprint->healthStatusAtCreation, L"broken");

        const std::string migratedManifest = readTextFile(configPath);
        EXPECT_NE(migratedManifest.find("\"gameId\":\"skyrimse\""), std::string::npos);
        EXPECT_NE(migratedManifest.find("\"healthStatusAtCreation\":\"broken\""), std::string::npos);
        EXPECT_EQ(migratedManifest.find("\"healthStatusAtCreation\":\"healthy\""), std::string::npos);

        const std::filesystem::path backupPath = AtomicFileStore::backupPathFor(configPath);
        ASSERT_TRUE(std::filesystem::exists(backupPath));
        const std::string backupManifest = readTextFile(backupPath);
        EXPECT_EQ(backupManifest.find("\"projectFingerprint\""), std::string::npos);
#endif
    }

    TEST(ProjectServiceTests, OpenProjectConfigRecoversInterruptedManifestWrite)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Opening a project initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path projectDirectory = temp.path() / L"Recovered Skyrim Build";
        const std::filesystem::path configPath = projectDirectory / L"fluxora.build.json";
        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(projectDirectory / L"Game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(projectDirectory / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(projectDirectory / L"profiles" / L"Default" / L"loadorder.txt", "Skyrim.esm\n");

        AtomicFileStore store;
        store.writeTextFile(
            configPath,
            std::string(LegacySkyrimManifest),
            AtomicFileWriteOptions{
                L"project manifest",
                ProjectStateValidation::JsonObject
            });
        EXPECT_THROW(
            store.writeTextFile(
                configPath,
                R"json({
                    "schemaVersion": "1",
                    "name": "Interrupted New Name",
                    "templateId": "skyrimse",
                    "gameName": "Skyrim Special Edition",
                    "gamePath": "Game",
                    "installRoot": "..",
                    "projectDirectory": "."
                })json",
                AtomicFileWriteOptions{
                    L"project manifest",
                    ProjectStateValidation::JsonObject,
                    {},
                    true,
                    AtomicWriteFailurePoint::AfterTempFileValidated
                }),
            std::runtime_error);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectOpenResult opened = projects.openProjectConfig(configPath);

        EXPECT_EQ(opened.project.name, L"Legacy Skyrim Build");
        EXPECT_EQ(readTextFile(configPath).find("Interrupted New Name"), std::string::npos);
        for (const auto& entry : std::filesystem::directory_iterator(configPath.parent_path()))
        {
            EXPECT_FALSE(AtomicFileStore::isManagedTempFileFor(configPath, entry.path()))
                << entry.path().string();
        }
#endif
    }

    TEST(ProjectServiceTests, DeleteProjectStreamsLargeBuildTreeAndReportsProgress)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Deleting a project initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path projectDirectory = temp.path() / L"Large Skyrim Build";
        const std::filesystem::path configPath = projectDirectory / L"fluxora.build.json";
        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(projectDirectory / L"Game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(projectDirectory / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(projectDirectory / L"profiles" / L"Default" / L"loadorder.txt", "Skyrim.esm\n");
        writeTextFile(configPath, std::string(LegacySkyrimManifest));

        constexpr int modCount = 120;
        constexpr int filesPerMod = 20;
        constexpr std::size_t fileBytes = 1024;
        const std::string content(fileBytes, 'x');
        for (int modIndex = 0; modIndex < modCount; ++modIndex)
        {
            const std::filesystem::path modRoot =
                projectDirectory /
                L"mods" /
                (L"Mod " + std::to_wstring(modIndex)) /
                L"textures" /
                L"actors" /
                L"nested";
            for (int fileIndex = 0; fileIndex < filesPerMod; ++fileIndex)
            {
                writeTextFile(
                    modRoot / (L"file-" + std::to_wstring(fileIndex) + L".bin"),
                    content);
            }
        }

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        std::vector<ProjectDeleteProgress> progressEvents;
        std::vector<std::thread::id> progressThreadIds;
        ProjectDeleteProgress lastProgress;
        const std::thread::id callerThreadId = std::this_thread::get_id();
        projects.deleteProject(ProjectDeleteRequest{
            configPath,
            [&progressEvents, &progressThreadIds, &lastProgress](const ProjectDeleteProgress& progress)
            {
                progressThreadIds.push_back(std::this_thread::get_id());
                progressEvents.push_back(progress);
                lastProgress = progress;
            }
        });

        EXPECT_FALSE(std::filesystem::exists(projectDirectory));
        EXPECT_TRUE(std::any_of(progressEvents.begin(), progressEvents.end(), [](const ProjectDeleteProgress& progress)
        {
            return progress.phase == L"scan";
        }));
        EXPECT_TRUE(std::any_of(progressEvents.begin(), progressEvents.end(), [](const ProjectDeleteProgress& progress)
        {
            return progress.phase == L"delete";
        }));

        int previousPercent = 0;
        std::uintmax_t previousDeletedEntries = 0;
        std::uintmax_t previousDeletedBytes = 0;
        for (const ProjectDeleteProgress& progress : progressEvents)
        {
            if (progress.phase == L"scan")
            {
                continue;
            }

            EXPECT_GE(progress.overallPercent, previousPercent);
            EXPECT_GE(progress.deletedEntries, previousDeletedEntries);
            EXPECT_GE(progress.deletedBytes, previousDeletedBytes);
            previousPercent = progress.overallPercent;
            previousDeletedEntries = progress.deletedEntries;
            previousDeletedBytes = progress.deletedBytes;
        }

        EXPECT_EQ(lastProgress.phase, L"complete");
        EXPECT_EQ(lastProgress.overallPercent, 100);
        EXPECT_GE(lastProgress.totalBytes, static_cast<std::uintmax_t>(modCount * filesPerMod * fileBytes));
        EXPECT_GE(lastProgress.totalEntries, static_cast<std::uintmax_t>(modCount * filesPerMod));
        EXPECT_TRUE(std::all_of(progressThreadIds.begin(), progressThreadIds.end(), [callerThreadId](std::thread::id threadId)
        {
            return threadId == callerThreadId;
        }));
#endif
    }

    TEST(ProjectServiceTests, DeleteProjectContinuesWhenProgressCallbackFailsDuringScan)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Deleting a project initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path projectDirectory = temp.path() / L"Large Skyrim Build";
        const std::filesystem::path configPath = projectDirectory / L"fluxora.build.json";
        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(projectDirectory / L"Game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(projectDirectory / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(projectDirectory / L"profiles" / L"Default" / L"loadorder.txt", "Skyrim.esm\n");
        writeTextFile(projectDirectory / L"mods" / L"Heavy Mod" / L"textures" / L"payload.bin", "payload");
        writeTextFile(configPath, std::string(LegacySkyrimManifest));

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        int progressCalls = 0;
        projects.deleteProject(ProjectDeleteRequest{
            configPath,
            [&progressCalls](const ProjectDeleteProgress& progress)
            {
                ++progressCalls;
                if (progress.phase == L"scan")
                {
                    throw std::runtime_error("disposed deletion progress view");
                }
            }
        });

        EXPECT_EQ(progressCalls, 1);
        EXPECT_FALSE(std::filesystem::exists(projectDirectory));
#endif
    }

    TEST(ProjectServiceTests, DeleteProjectRemovesCatalogManifestWhenProjectDirectoryIsAlreadyMissing)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project catalog manifests live under APPDATA on Windows.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path catalogDirectory = temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path configPath = catalogDirectory / L"Legacy Skyrim Build.json";
        const std::filesystem::path missingProjectDirectory = temp.path() / L"Missing Skyrim Build";
        writeTextFile(
            configPath,
            R"json({
                "schemaVersion": "1",
                "name": "Legacy Skyrim Build",
                "templateId": "skyrimse",
                "gameName": "Skyrim Special Edition",
                "gamePath": "Game",
                "installRoot": "../../..",
                "projectDirectory": "../../../Missing Skyrim Build",
                "dataDirectory": "Data",
                "defaultProfile": "Default"
            })json");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        std::vector<ProjectDeleteProgress> progressEvents;
        projects.deleteProject(ProjectDeleteRequest{
            configPath,
            [&progressEvents](const ProjectDeleteProgress& progress)
            {
                progressEvents.push_back(progress);
            }
        });

        EXPECT_FALSE(std::filesystem::exists(configPath));
        EXPECT_FALSE(std::filesystem::exists(missingProjectDirectory));
        EXPECT_TRUE(projects.listProjectConfigSummaries(catalogDirectory).empty());
        ASSERT_FALSE(progressEvents.empty());
        EXPECT_EQ(progressEvents.back().phase, L"complete");
        EXPECT_EQ(progressEvents.back().overallPercent, 100);
        EXPECT_EQ(progressEvents.back().deletedEntries, progressEvents.back().totalEntries);
#endif
    }

    TEST(ProjectServiceTests, ListProjectConfigSummariesUsesLightCacheWithoutMigratingLegacyManifest)
    {
        TempDirectory temp;
        const std::filesystem::path projectDirectory = temp.path() / L"Legacy Skyrim Build";
        const std::filesystem::path configPath = projectDirectory / L"legacy.build.json";
        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(projectDirectory / L"Game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            configPath,
            R"json({
                "schemaVersion": "1",
                "name": "Legacy Skyrim Build",
                "gameId": "skyrimse",
                "gameName": "Skyrim Special Edition",
                "gamePath": "Game",
                "installRoot": "..",
                "projectDirectory": ".",
                "dataDirectory": "Data",
                "defaultProfile": "Default"
            })json");
        const std::string before = readTextFile(configPath);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        std::vector<ProjectOpenResult> summaries =
            projects.listProjectConfigSummaries(projectDirectory);

        ASSERT_EQ(summaries.size(), 1U);
        EXPECT_EQ(summaries[0].project.name, L"Legacy Skyrim Build");
        EXPECT_EQ(summaries[0].project.templateId, L"skyrimse");
        EXPECT_EQ(summaries[0].resolvedTemplate.id, L"skyrimse");
        ASSERT_TRUE(summaries[0].project.fingerprint.has_value());
        EXPECT_EQ(summaries[0].project.fingerprint->gameId, L"skyrimse");
        EXPECT_EQ(readTextFile(configPath), before);
        EXPECT_FALSE(std::filesystem::exists(AtomicFileStore::backupPathFor(configPath)));

        writeTextFile(
            configPath,
            R"json({
                "schemaVersion": "1",
                "name": "Updated Legacy Skyrim Build",
                "gameId": "skyrimse",
                "gameName": "Skyrim Special Edition",
                "gamePath": "Game",
                "installRoot": "..",
                "projectDirectory": ".",
                "dataDirectory": "Data",
                "defaultProfile": "Default",
                "catalogRevision": "changed"
            })json");

        summaries = projects.listProjectConfigSummaries(projectDirectory);

        ASSERT_EQ(summaries.size(), 1U);
        EXPECT_EQ(summaries[0].project.name, L"Updated Legacy Skyrim Build");
        EXPECT_EQ(readTextFile(configPath).find("\"projectFingerprint\""), std::string::npos);
    }

    TEST(ProjectServiceTests, ListProjectConfigSummariesSortsByCachedLastWriteTime)
    {
        TempDirectory temp;
        const std::filesystem::path catalogDirectory = temp.path() / L"Build Catalog";
        const std::filesystem::path olderConfigPath = catalogDirectory / L"older.build.json";
        const std::filesystem::path newerConfigPath = catalogDirectory / L"newer.build.json";

        writeTextFile(
            olderConfigPath,
            R"json({
                "schemaVersion": "1",
                "name": "Older Build",
                "gameId": "skyrimse",
                "gameName": "Skyrim Special Edition",
                "gamePath": "OlderGame",
                "installRoot": "..",
                "projectDirectory": ".",
                "dataDirectory": "Data",
                "defaultProfile": "Default"
            })json");
        writeTextFile(
            newerConfigPath,
            R"json({
                "schemaVersion": "1",
                "name": "Newer Build",
                "gameId": "skyrimse",
                "gameName": "Skyrim Special Edition",
                "gamePath": "NewerGame",
                "installRoot": "..",
                "projectDirectory": ".",
                "dataDirectory": "Data",
                "defaultProfile": "Default"
            })json");

        const std::filesystem::file_time_type now = std::filesystem::file_time_type::clock::now();
        std::filesystem::last_write_time(olderConfigPath, now - std::chrono::hours(2));
        std::filesystem::last_write_time(newerConfigPath, now - std::chrono::hours(1));

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const std::vector<ProjectOpenResult> summaries =
            projects.listProjectConfigSummaries(catalogDirectory);

        ASSERT_EQ(summaries.size(), 2U);
        EXPECT_EQ(summaries[0].project.name, L"Newer Build");
        EXPECT_EQ(summaries[1].project.name, L"Older Build");
    }
}
