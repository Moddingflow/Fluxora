#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"
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

        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size,
                nullptr,
                nullptr);
            return out;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::string catalogProjectManifest(
            std::string name,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& installRoot)
        {
            return "{"
                "\"schemaVersion\":\"1\","
                "\"name\":\"" + std::move(name) + "\","
                "\"templateId\":\"skyrimse\","
                "\"gameName\":\"Skyrim Special Edition\","
                "\"gamePath\":\"" + toUtf8((projectDirectory / L"Game").generic_wstring()) + "\","
                "\"installRoot\":\"" + toUtf8(installRoot.generic_wstring()) + "\","
                "\"projectDirectory\":\"" + toUtf8(projectDirectory.generic_wstring()) + "\","
                "\"dataDirectory\":\"Data\","
                "\"defaultProfile\":\"Default\""
                "}";
        }

        void writeProjectRenameRecoveryMarker(
            const std::filesystem::path& markerPath,
            const std::filesystem::path& previousManifestPath,
            const std::filesystem::path& renamedManifestPath,
            const std::filesystem::path& previousProjectDirectory,
            const std::filesystem::path& renamedProjectDirectory)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"schemaVersion", 1);
            writer.field(L"operation", L"project-rename");
            writer.field(L"previousManifestPath", std::filesystem::absolute(previousManifestPath).wstring());
            writer.field(L"renamedManifestPath", std::filesystem::absolute(renamedManifestPath).wstring());
            writer.field(
                L"previousProjectDirectory",
                std::filesystem::absolute(previousProjectDirectory).wstring());
            writer.field(
                L"renamedProjectDirectory",
                std::filesystem::absolute(renamedProjectDirectory).wstring());
            writer.endObject();
            writeTextFile(markerPath, toUtf8(writer.str()));
        }
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
        EXPECT_NE(
            manifest.find(
                "\"externalProviderGameSlugs\":{\"moddingflow\":[\"skyrim-se-ae\",\"skyrim-se\"]}"),
            std::string::npos);
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
        ASSERT_EQ(opened.resolvedTemplate.externalProviderGameSlugs.size(), 1U);
        EXPECT_EQ(
            opened.resolvedTemplate.externalProviderGameSlugs.at(L"moddingflow"),
            (std::vector<std::wstring>{L"skyrim-se-ae", L"skyrim-se"}));

        std::string invalidManifest = manifest;
        constexpr std::string_view providerMarker =
            "\"externalProviderGameSlugs\":{\"moddingflow\"";
        const std::size_t providerOffset = invalidManifest.find(providerMarker);
        ASSERT_NE(providerOffset, std::string::npos);
        invalidManifest.replace(
            providerOffset,
            providerMarker.size(),
            "\"externalProviderGameSlugs\":{\"ModdingFlow\"");
        writeTextFile(project.configPath, invalidManifest);
        EXPECT_THROW(
            static_cast<void>(projects.openProjectConfig(project.configPath)),
            std::invalid_argument);
#endif
    }

    TEST(ProjectServiceTests, CreateProjectRejectsNonPrimaryGameExecutableSelection)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"SkyrimSELauncher.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        try
        {
            (void)projects.createProject(ProjectCreateRequest{
                L"Wrong Executable Build",
                L"skyrimse",
                game / L"SkyrimSELauncher.exe",
                temp.path() / L"Builds"
            });
            FAIL() << "Expected project creation to reject the launcher executable.";
        }
        catch (const std::invalid_argument& exception)
        {
            EXPECT_NE(
                std::string(exception.what()).find("SkyrimSE.exe"),
                std::string::npos);
        }
#endif
    }

    TEST(ProjectServiceTests, CreateProjectCreatesMissingInstallRoot)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        ASSERT_FALSE(std::filesystem::exists(installRoot));

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectDescriptor project = projects.createProject(ProjectCreateRequest{
            L"Auto Root Build",
            L"skyrimse",
            temp.path() / L"Skyrim Special Edition" / L"SkyrimSE.exe",
            installRoot,
            false
        });

        EXPECT_TRUE(std::filesystem::is_directory(installRoot));
        EXPECT_TRUE(std::filesystem::is_directory(project.projectDirectory));
        EXPECT_EQ(project.installRootDirectory, std::filesystem::absolute(installRoot));
#endif
    }

    TEST(ProjectServiceTests, BuildProjectDirectoryUsesSanitizedFolderNames)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path installRoot = temp.path() / L"Builds";

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"  Unsafe: Build?Name.  "),
            std::filesystem::absolute(installRoot) / L"Unsafe- Build-Name");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L" . "),
            std::filesystem::absolute(installRoot) / L"New Build");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"NUL.txt"),
            std::filesystem::absolute(installRoot) / L"_NUL.txt");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"com1"),
            std::filesystem::absolute(installRoot) / L"_com1");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"COM\u00B9"),
            std::filesystem::absolute(installRoot) / L"_COM\u00B9");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"com\u00B2.txt"),
            std::filesystem::absolute(installRoot) / L"_com\u00B2.txt");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"CoM\u00B3"),
            std::filesystem::absolute(installRoot) / L"_CoM\u00B3");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"LPT\u00B9"),
            std::filesystem::absolute(installRoot) / L"_LPT\u00B9");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"lpt\u00B2.log"),
            std::filesystem::absolute(installRoot) / L"_lpt\u00B2.log");
        EXPECT_EQ(
            projects.buildProjectDirectory(installRoot, L"LpT\u00B3"),
            std::filesystem::absolute(installRoot) / L"_LpT\u00B3");
    }

    TEST(ProjectServiceTests, CreateProjectKeepsSanitizedNameCollisionsInSeparateDirectories)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path catalogDirectory =
            temp.path() / L"AppData" / L"Fluxora" / L"Builds";

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const std::filesystem::path firstPreview =
            projects.buildProjectDirectory(installRoot, L"Catalog:Build");
        const ProjectDescriptor first = projects.createProject(ProjectCreateRequest{
            L"Catalog:Build",
            L"skyrimse",
            temp.path() / L"Skyrim Special Edition" / L"SkyrimSE.exe",
            installRoot,
            false
        });
        const std::filesystem::path firstSentinel = first.projectDirectory / L"first-build.txt";
        writeTextFile(firstSentinel, "first build must survive");
        const std::filesystem::path secondPreview =
            projects.buildProjectDirectory(installRoot, L"Catalog?Build");
        const ProjectDescriptor second = projects.createProject(ProjectCreateRequest{
            L"Catalog?Build",
            L"skyrimse",
            temp.path() / L"Skyrim Special Edition" / L"SkyrimSE.exe",
            installRoot,
            false
        });

        EXPECT_EQ(
            first.projectDirectory,
            firstPreview);
        EXPECT_EQ(
            second.projectDirectory,
            secondPreview);
        EXPECT_EQ(secondPreview, std::filesystem::absolute(installRoot / L"Catalog-Build-2"));
        EXPECT_NE(first.projectDirectory, second.projectDirectory);
        EXPECT_TRUE(std::filesystem::is_regular_file(firstSentinel));
        EXPECT_EQ(readTextFile(firstSentinel), "first build must survive");
        EXPECT_EQ(
            first.configPath,
            std::filesystem::absolute(catalogDirectory / L"Catalog-Build.json"));
        EXPECT_EQ(
            second.configPath,
            std::filesystem::absolute(catalogDirectory / L"Catalog-Build-2.json"));
        EXPECT_NE(first.configPath, second.configPath);
        EXPECT_TRUE(std::filesystem::is_regular_file(first.configPath));
        EXPECT_TRUE(std::filesystem::is_regular_file(second.configPath));
        EXPECT_NE(readTextFile(first.configPath).find("\"name\":\"Catalog:Build\""), std::string::npos);
        EXPECT_NE(readTextFile(second.configPath).find("\"name\":\"Catalog?Build\""), std::string::npos);
#endif
    }

    TEST(ProjectServiceTests, CreateProjectPreservesUnrelatedDirectoriesAndAdvancesSuffix)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path firstSentinel =
            installRoot / L"Clean Root Build" / L"keep-first.txt";
        const std::filesystem::path secondSentinel =
            installRoot / L"Clean Root Build-2" / L"keep-second.txt";
        writeTextFile(firstSentinel, "unrelated first directory");
        writeTextFile(secondSentinel, "unrelated second directory");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectDescriptor project = projects.createProject(ProjectCreateRequest{
            L"Clean Root Build",
            L"skyrimse",
            temp.path() / L"Skyrim Special Edition" / L"SkyrimSE.exe",
            installRoot,
            false
        });

        EXPECT_EQ(
            project.projectDirectory,
            std::filesystem::absolute(installRoot / L"Clean Root Build-3"));
        EXPECT_EQ(
            project.configPath,
            std::filesystem::absolute(
                temp.path() / L"AppData" / L"Fluxora" / L"Builds" / L"Clean Root Build-3.json"));
        EXPECT_EQ(readTextFile(firstSentinel), "unrelated first directory");
        EXPECT_EQ(readTextFile(secondSentinel), "unrelated second directory");
        EXPECT_TRUE(std::filesystem::is_directory(project.projectDirectory));
#endif
    }

    TEST(ProjectServiceTests, CreateProjectRemovesAutoCreatedInstallRootAfterFailure)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path appDataFile = temp.path() / L"AppData";
        writeTextFile(appDataFile, "not a directory");
        ScopedEnvironmentVariable appData(L"APPDATA", appDataFile.wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        ASSERT_FALSE(std::filesystem::exists(installRoot));

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        try
        {
            (void)projects.createProject(ProjectCreateRequest{
                L"Rollback Root Build",
                L"skyrimse",
                temp.path() / L"Skyrim Special Edition" / L"SkyrimSE.exe",
                installRoot,
                false
            });
            FAIL() << "Expected project creation to fail after creating the install root.";
        }
        catch (const std::exception& exception)
        {
            EXPECT_EQ(std::string(exception.what()).find("Install root directory does not exist."), std::string::npos);
        }

        EXPECT_FALSE(std::filesystem::exists(installRoot));
#endif
    }

    TEST(ProjectServiceTests, CreateProjectRollsBackMaterializedProjectDirectoryWhenManifestWriteFails)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path appDataFile = temp.path() / L"AppData";
        writeTextFile(appDataFile, "not a directory");
        ScopedEnvironmentVariable appData(L"APPDATA", appDataFile.wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        std::filesystem::create_directories(installRoot);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const std::filesystem::path projectDirectory =
            projects.buildProjectDirectory(installRoot, L"Rollback Materialized Build");
        ASSERT_FALSE(std::filesystem::exists(projectDirectory));

        try
        {
            (void)projects.createProject(ProjectCreateRequest{
                L"Rollback Materialized Build",
                L"skyrimse",
                temp.path() / L"Skyrim Special Edition" / L"SkyrimSE.exe",
                installRoot,
                false
            });
            FAIL() << "Expected project creation to fail while writing the catalog manifest.";
        }
        catch (const std::exception& exception)
        {
            EXPECT_EQ(std::string(exception.what()).find("Install root directory does not exist."), std::string::npos);
        }

        EXPECT_TRUE(std::filesystem::is_directory(installRoot));
        EXPECT_FALSE(std::filesystem::exists(projectDirectory));
        EXPECT_FALSE(std::filesystem::exists(
            appDataFile / L"Fluxora" / L"Builds" / L"Rollback Materialized Build.json"));
        EXPECT_TRUE(projects.projects().empty());
#endif
    }

    TEST(ProjectServiceTests, CreateProjectAddsReturnedDescriptorToProjectList)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectDescriptor project = projects.createProject(ProjectCreateRequest{
            L"Listed Build",
            L"skyrimse",
            temp.path() / L"Skyrim Special Edition" / L"SkyrimSE.exe",
            installRoot,
            false
        });

        const std::vector<ProjectDescriptor>& createdProjects = projects.projects();
        ASSERT_EQ(createdProjects.size(), 1U);
        EXPECT_EQ(createdProjects[0].name, project.name);
        EXPECT_EQ(createdProjects[0].templateId, project.templateId);
        EXPECT_EQ(createdProjects[0].gameName, project.gameName);
        EXPECT_EQ(createdProjects[0].gamePath, project.gamePath);
        EXPECT_EQ(createdProjects[0].installRootDirectory, project.installRootDirectory);
        EXPECT_EQ(createdProjects[0].projectDirectory, project.projectDirectory);
        EXPECT_EQ(createdProjects[0].configPath, project.configPath);
        EXPECT_EQ(createdProjects[0].fingerprint.has_value(), project.fingerprint.has_value());
#endif
    }

    TEST(ProjectServiceTests, RenameProjectRollsBackWhenOldManifestCannotBeRemoved)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project rename rollback uses a Windows delete-sharing failure.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path catalogDirectory =
            temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectDescriptor original = projects.createProject(ProjectCreateRequest{
            L"Original Build",
            L"skyrimse",
            game,
            installRoot
        });
        const std::filesystem::path sentinel = original.projectDirectory / L"keep.txt";
        writeTextFile(sentinel, "keep original build");
        const std::string originalManifest = readTextFile(original.configPath);

        const HANDLE manifestLock = CreateFileW(
            original.configPath.c_str(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            nullptr,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        ASSERT_NE(manifestLock, INVALID_HANDLE_VALUE);

        EXPECT_THROW(
            (void)projects.renameProject(original.configPath, L"Renamed Build"),
            std::filesystem::filesystem_error);
        CloseHandle(manifestLock);

        const std::filesystem::path renamedDirectory = installRoot / L"Renamed Build";
        const std::filesystem::path renamedManifest = catalogDirectory / L"Renamed Build.json";
        EXPECT_TRUE(std::filesystem::is_directory(original.projectDirectory));
        EXPECT_TRUE(std::filesystem::is_regular_file(sentinel));
        EXPECT_EQ(readTextFile(sentinel), "keep original build");
        EXPECT_FALSE(std::filesystem::exists(renamedDirectory));
        EXPECT_TRUE(std::filesystem::is_regular_file(original.configPath));
        EXPECT_EQ(readTextFile(original.configPath), originalManifest);
        EXPECT_FALSE(std::filesystem::exists(renamedManifest));
#endif
    }

    TEST(ProjectServiceTests, StartupRollsBackRenameInterruptedAfterPublishingNewManifest)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project catalog recovery uses the Windows app-data location.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path catalogDirectory =
            temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path previousDirectory = installRoot / L"Original Build";
        const std::filesystem::path renamedDirectory = installRoot / L"Renamed Build";
        const std::filesystem::path previousManifest = catalogDirectory / L"Original Build.json";
        const std::filesystem::path renamedManifest = catalogDirectory / L"Renamed Build.json";
        const std::filesystem::path marker =
            catalogDirectory / L".fluxora-project-rename-test.json";

        writeTextFile(previousDirectory / L"keep.txt", "previous build");
        writeTextFile(
            previousManifest,
            catalogProjectManifest("Original Build", previousDirectory, installRoot));
        writeTextFile(
            renamedManifest,
            catalogProjectManifest("Renamed Build", renamedDirectory, installRoot));
        writeProjectRenameRecoveryMarker(
            marker,
            previousManifest,
            renamedManifest,
            previousDirectory,
            renamedDirectory);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        EXPECT_TRUE(std::filesystem::is_directory(previousDirectory));
        EXPECT_FALSE(std::filesystem::exists(renamedDirectory));
        EXPECT_TRUE(std::filesystem::is_regular_file(previousManifest));
        EXPECT_FALSE(std::filesystem::exists(renamedManifest));
        EXPECT_FALSE(std::filesystem::exists(marker));
        EXPECT_EQ(readTextFile(previousDirectory / L"keep.txt"), "previous build");

        const std::vector<ProjectOpenResult> catalog =
            projects.listProjectConfigSummaries(catalogDirectory);
        ASSERT_EQ(catalog.size(), 1U);
        EXPECT_EQ(catalog.front().project.name, L"Original Build");
        EXPECT_EQ(catalog.front().project.projectDirectory, previousDirectory);
#endif
    }

    TEST(ProjectServiceTests, StartupCompletesRenameInterruptedAfterMovingProjectDirectory)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project catalog recovery uses the Windows app-data location.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path catalogDirectory =
            temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path previousDirectory = installRoot / L"Original Build";
        const std::filesystem::path renamedDirectory = installRoot / L"Renamed Build";
        const std::filesystem::path previousManifest = catalogDirectory / L"Original Build.json";
        const std::filesystem::path renamedManifest = catalogDirectory / L"Renamed Build.json";
        const std::filesystem::path marker =
            catalogDirectory / L".fluxora-project-rename-test.json";

        writeTextFile(renamedDirectory / L"keep.txt", "renamed build");
        writeTextFile(
            previousManifest,
            catalogProjectManifest("Original Build", previousDirectory, installRoot));
        writeTextFile(
            renamedManifest,
            catalogProjectManifest("Renamed Build", renamedDirectory, installRoot));
        writeProjectRenameRecoveryMarker(
            marker,
            previousManifest,
            renamedManifest,
            previousDirectory,
            renamedDirectory);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        EXPECT_FALSE(std::filesystem::exists(previousDirectory));
        EXPECT_TRUE(std::filesystem::is_directory(renamedDirectory));
        EXPECT_FALSE(std::filesystem::exists(previousManifest));
        EXPECT_TRUE(std::filesystem::is_regular_file(renamedManifest));
        EXPECT_FALSE(std::filesystem::exists(marker));
        EXPECT_EQ(readTextFile(renamedDirectory / L"keep.txt"), "renamed build");

        const std::vector<ProjectOpenResult> catalog =
            projects.listProjectConfigSummaries(catalogDirectory);
        ASSERT_EQ(catalog.size(), 1U);
        EXPECT_EQ(catalog.front().project.name, L"Renamed Build");
        EXPECT_EQ(catalog.front().project.projectDirectory, renamedDirectory);
#endif
    }

    TEST(ProjectServiceTests, StartupDefersRenameRecoveryForMismatchedCatalogManifest)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project catalog recovery uses the Windows app-data location.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path catalogDirectory =
            temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path previousDirectory = installRoot / L"Original Build";
        const std::filesystem::path renamedDirectory = installRoot / L"Renamed Build";
        const std::filesystem::path unrelatedDirectory = installRoot / L"Unrelated Build";
        const std::filesystem::path previousManifest = catalogDirectory / L"Original Build.json";
        const std::filesystem::path renamedManifest = catalogDirectory / L"Renamed Build.json";
        const std::filesystem::path marker =
            catalogDirectory / L".fluxora-project-rename-test.json";

        writeTextFile(previousDirectory / L"keep.txt", "previous build");
        writeTextFile(unrelatedDirectory / L"keep.txt", "unrelated build");
        writeTextFile(
            previousManifest,
            catalogProjectManifest("Original Build", previousDirectory, installRoot));
        const std::string unrelatedManifestContent =
            catalogProjectManifest("Unrelated Build", unrelatedDirectory, installRoot);
        writeTextFile(renamedManifest, unrelatedManifestContent);
        writeProjectRenameRecoveryMarker(
            marker,
            previousManifest,
            renamedManifest,
            previousDirectory,
            renamedDirectory);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        EXPECT_TRUE(std::filesystem::is_regular_file(previousManifest));
        EXPECT_TRUE(std::filesystem::is_regular_file(renamedManifest));
        EXPECT_EQ(readTextFile(renamedManifest), unrelatedManifestContent);
        EXPECT_TRUE(std::filesystem::is_regular_file(marker));

        const std::vector<ProjectOpenResult> catalog =
            projects.listProjectConfigSummaries(catalogDirectory);
        ASSERT_EQ(catalog.size(), 2U);
#endif
    }

    TEST(ProjectServiceTests, RenameProjectKeepsManifestAndDirectorySuffixesAligned)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project creation initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path catalogDirectory =
            temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectDescriptor original = projects.createProject(ProjectCreateRequest{
            L"Original Build",
            L"skyrimse",
            game,
            installRoot
        });

        const std::filesystem::path occupiedDirectory = installRoot / L"Target";
        const std::filesystem::path occupiedManifest = catalogDirectory / L"Target-2.json";
        writeTextFile(occupiedDirectory / L"keep.txt", "unrelated directory");
        writeTextFile(occupiedManifest, "{\"sentinel\":true}");

        const ProjectOpenResult renamed = projects.renameProject(original.configPath, L"Target");

        EXPECT_EQ(renamed.project.projectDirectory, installRoot / L"Target-3");
        EXPECT_EQ(renamed.project.configPath, catalogDirectory / L"Target-3.json");
        EXPECT_EQ(readTextFile(occupiedDirectory / L"keep.txt"), "unrelated directory");
        EXPECT_EQ(readTextFile(occupiedManifest), "{\"sentinel\":true}");
        EXPECT_FALSE(std::filesystem::exists(original.projectDirectory));
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

    TEST(ProjectServiceTests, OpenProjectConfigDefersModManifestRecoveryToExactReconciliation)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Opening a project initializes the Windows instance metadata store.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path projectDirectory = temp.path() / L"Deferred Mod Recovery Build";
        const std::filesystem::path configPath = projectDirectory / L"fluxora.build.json";
        const std::filesystem::path modManifest =
            projectDirectory / L"mods" / L"Interrupted Mod" / L".flow" / L"manifest.json";
        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(projectDirectory / L"Game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(projectDirectory / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(projectDirectory / L"profiles" / L"Default" / L"loadorder.txt", "Skyrim.esm\n");
        writeTextFile(configPath, std::string(LegacySkyrimManifest));
        EXPECT_THROW(
            AtomicFileStore().writeTextFile(
                modManifest,
                R"json({
                    "schemaVersion": 1,
                    "modUuid": "interrupted-mod",
                    "gameId": "skyrimse",
                    "folderName": "Interrupted Mod",
                    "displayName": "Recovered Later",
                    "state": "installed"
                })json",
                AtomicFileWriteOptions{
                    L"generated mod metadata",
                    ProjectStateValidation::JsonObject,
                    {},
                    false,
                    AtomicWriteFailurePoint::AfterTempFileValidated
                }),
            std::runtime_error);
        ASSERT_FALSE(std::filesystem::exists(modManifest));

        std::filesystem::path managedTemp;
        for (const auto& entry : std::filesystem::directory_iterator(modManifest.parent_path()))
        {
            if (AtomicFileStore::isManagedTempFileFor(modManifest, entry.path()))
            {
                managedTemp = entry.path();
                break;
            }
        }
        ASSERT_FALSE(managedTemp.empty());

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const ProjectOpenResult opened = projects.openProjectConfig(configPath);

        EXPECT_EQ(opened.project.name, L"Legacy Skyrim Build");
        EXPECT_FALSE(std::filesystem::exists(modManifest));
        EXPECT_TRUE(std::filesystem::is_regular_file(managedTemp));
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

    TEST(ProjectServiceTests, ListProjectConfigSummariesPrunesCatalogManifestWhenProjectFolderDisappears)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project catalog manifests live under APPDATA on Windows.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path catalogDirectory = temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path installRoot = temp.path() / L"Fluxora Builds";
        const std::filesystem::path projectDirectory = installRoot / L"Foundation Edition";
        const std::filesystem::path configPath = catalogDirectory / L"Foundation Edition.json";
        writeTextFile(
            configPath,
            catalogProjectManifest("Foundation Edition", projectDirectory, installRoot));
        std::filesystem::create_directories(projectDirectory);

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        std::vector<ProjectOpenResult> summaries = projects.listProjectConfigSummaries(catalogDirectory);
        ASSERT_EQ(summaries.size(), 1U);
        EXPECT_EQ(summaries[0].project.projectDirectory, std::filesystem::absolute(projectDirectory));

        std::filesystem::remove_all(projectDirectory);

        summaries = projects.listProjectConfigSummaries(catalogDirectory);

        EXPECT_TRUE(summaries.empty());
        EXPECT_FALSE(std::filesystem::exists(configPath));
        EXPECT_FALSE(std::filesystem::exists(projectDirectory));
#endif
    }

    TEST(ProjectServiceTests, ListProjectConfigSummariesPrunesDuplicateCatalogManifestsForSameProjectFolder)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Project catalog manifests live under APPDATA on Windows.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path catalogDirectory = temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path installRoot = temp.path() / L"Fluxora Builds";
        const std::filesystem::path projectDirectory = installRoot / L"Foundation Edition";
        const std::filesystem::path olderConfigPath = catalogDirectory / L"Foundation Edition.json";
        const std::filesystem::path newerConfigPath = catalogDirectory / L"Foundation Edition-2.json";
        std::filesystem::create_directories(projectDirectory);
        writeTextFile(
            olderConfigPath,
            catalogProjectManifest("Foundation Edition", projectDirectory, installRoot));
        writeTextFile(
            newerConfigPath,
            catalogProjectManifest("Foundation Edition", projectDirectory, installRoot));

        const std::filesystem::file_time_type now = std::filesystem::file_time_type::clock::now();
        std::filesystem::last_write_time(olderConfigPath, now - std::chrono::hours(2));
        std::filesystem::last_write_time(newerConfigPath, now - std::chrono::hours(1));

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();

        const std::vector<ProjectOpenResult> summaries = projects.listProjectConfigSummaries(catalogDirectory);

        ASSERT_EQ(summaries.size(), 1U);
        EXPECT_EQ(summaries[0].project.configPath, std::filesystem::absolute(newerConfigPath));
        EXPECT_EQ(summaries[0].project.projectDirectory, std::filesystem::absolute(projectDirectory));
        EXPECT_TRUE(std::filesystem::exists(newerConfigPath));
        EXPECT_FALSE(std::filesystem::exists(olderConfigPath));
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
