#include "FluxoraCore/Services/LodGeneratorIntegrationService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>

namespace fluxora::tests
{
    namespace
    {
        struct LodGeneratorFixture
        {
            explicit LodGeneratorFixture(const std::filesystem::path& root)
                : project(root / L"Сборка LOD"),
                  game(project / L"stock game"),
                  mods(project / L"mods"),
                  overwrite(project / L"overwrite"),
                  toolMod(mods / L"DynDOLOD Tool"),
                  toolDirectory(toolMod / L"Tools" / L"Dynamic LOD"),
                  config(root / L"configs" / L"build.json"),
                  pathSettings(logger),
                  service(logger, pathSettings)
            {
                writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
                writeTextFile(toolDirectory / L"TexGenx64.exe", "MZ");
                writeTextFile(toolDirectory / L"DynDOLODx64.exe", "MZ");
                writeTextFile(
                    config,
                    "{"
                    "\"id\":\"build\","
                    "\"name\":\"Сборка LOD\","
                    "\"gameId\":\"skyrimse\","
                    "\"templateId\":\"skyrimse\","
                    "\"projectDirectory\":\"../Сборка LOD\","
                    "\"gamePath\":\"stock game\","
                    "\"dataDirectory\":\"Data\","
                    "\"defaultProfile\":\"Default\""
                    "}");
                InstanceMetadataStore::ensureInstance(project, L"skyrimse");
                static_cast<void>(pathSettings.saveForConfig(
                    config,
                    BuildPathSettings{game, mods, project / L"profiles", {}, overwrite}));
                InstanceMetadataStore::registerInstalledMods(
                    project,
                    {InstalledModImportRecord{toolMod, L"DynDOLOD Tool", {}, true, {}}});
                InstanceMetadataStore::replaceProfileOrderItems(
                    project,
                    L"Default",
                    {ProfileOrderImportItemRecord{L"mod", toolMod.filename().wstring(), {}}});
                service.initialize();
            }

            ~LodGeneratorFixture()
            {
                service.shutdown();
            }

            ResolvedExecutableLaunch resolved(std::wstring_view toolKind) const
            {
                const bool texGen = toolKind == texGenManagedToolKind;
                ResolvedExecutableLaunch value;
                value.executable.id = texGen ? L"texgen" : L"dyndolod";
                value.executable.displayName = texGen ? L"TexGen" : L"DynDOLOD";
                value.executable.managedToolKind = std::wstring(toolKind);
                value.resolvedExecutablePath =
                    toolDirectory / (texGen ? L"TexGenx64.exe" : L"DynDOLODx64.exe");
                value.resolvedWorkingDirectory = toolDirectory;
                value.commandLine =
                    L"\"" + value.resolvedExecutablePath.wstring() +
                    L"\" -tes5 -o:\"C:\\Old Output\" -qac";
                value.gamePath = game;
                value.projectDirectory = project;
                value.gameId = GameId::parseOrThrow(L"skyrimse");
                value.dataDirectory = L"Data";
                value.defaultProfile = L"Default";
                value.activeProfileMods = {
                    ExecutableLaunchMod{toolMod, L"DynDOLOD Tool", L"tool-fingerprint"}};
                value.projectName = L"Сборка LOD";
                return value;
            }

            std::filesystem::path project;
            std::filesystem::path game;
            std::filesystem::path mods;
            std::filesystem::path overwrite;
            std::filesystem::path toolMod;
            std::filesystem::path toolDirectory;
            std::filesystem::path config;
            Logger logger;
            BuildPathSettingsService pathSettings;
            LodGeneratorIntegrationService service;
        };
    }

    TEST(LodGeneratorIntegrationServiceTests, DetectsOnlyOfficialTexGenAndDynDoLodExecutables)
    {
        GameExecutable executable;
        executable.id = L"tool";
        executable.displayName = L"Renamed tool";

        EXPECT_EQ(
            LodGeneratorIntegrationService::detectManagedToolKind(
                executable,
                L"C:\\Tools\\DynDOLOD\\TexGenx64.exe"),
            texGenManagedToolKind);
        EXPECT_EQ(
            LodGeneratorIntegrationService::detectManagedToolKind(
                executable,
                L"C:\\Tools\\DynDOLOD\\TEXGEN.EXE"),
            texGenManagedToolKind);
        EXPECT_EQ(
            LodGeneratorIntegrationService::detectManagedToolKind(
                executable,
                L"C:\\Tools\\DynDOLOD\\DynDOLODx64.exe"),
            dynDoLodManagedToolKind);
        EXPECT_EQ(
            LodGeneratorIntegrationService::detectManagedToolKind(
                executable,
                L"C:\\Tools\\DynDOLOD\\DYNDolod.exe"),
            dynDoLodManagedToolKind);
        EXPECT_TRUE(
            LodGeneratorIntegrationService::detectManagedToolKind(
                executable,
                L"C:\\Tools\\xEdit\\SSEEdit.exe")
                .empty());
    }

    TEST(LodGeneratorIntegrationServiceTests, TexGenPreparationCreatesBothOutputsAndEnforcesManagedArguments)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(texGenManagedToolKind),
            L"Default");

        const std::filesystem::path texGenOutput = fixture.mods / L"TexGen Output";
        const std::filesystem::path dynDoLodOutput = fixture.mods / L"DynDOLOD Output";
        EXPECT_EQ(prepared.outputMod.path, texGenOutput);
        EXPECT_EQ(prepared.outputMod.provider, texGenGeneratedProvider);
        EXPECT_TRUE(std::filesystem::is_directory(texGenOutput));
        EXPECT_TRUE(std::filesystem::is_directory(dynDoLodOutput));
        EXPECT_TRUE(std::filesystem::is_directory(prepared.stagingDirectory));
        EXPECT_TRUE(std::filesystem::is_empty(prepared.stagingDirectory));
        EXPECT_EQ(prepared.activeProfileMods.size(), 1U);
        EXPECT_EQ(prepared.activeProfileMods.front().path, fixture.toolMod);

        EXPECT_NE(prepared.commandLine.find(L"-sse"), std::wstring::npos);
        EXPECT_NE(prepared.commandLine.find(L"-qac"), std::wstring::npos);
        EXPECT_NE(
            prepared.commandLine.find(L"-o:\"" + prepared.virtualOutputDirectory.wstring() + L"\""),
            std::wstring::npos);
        EXPECT_EQ(prepared.commandLine.find(L"-tes5"), std::wstring::npos);
        EXPECT_EQ(prepared.commandLine.find(L"C:\\Old Output"), std::wstring::npos);

        const std::vector<ProfileOrderItemRecord> order =
            InstanceMetadataStore::listCachedProfileOrderItems(
                fixture.project,
                L"Default",
                fixture.mods);
        ASSERT_GE(order.size(), 3U);
        EXPECT_EQ(order[order.size() - 2].mod.folderName, L"TexGen Output");
        EXPECT_EQ(order.back().mod.folderName, L"DynDOLOD Output");
        EXPECT_EQ(order[order.size() - 2].mod.state, L"installed");
        EXPECT_EQ(order.back().mod.state, L"installed");

        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(LodGeneratorIntegrationServiceTests, ExecutableCatalogAutoDetectsBothManagedToolKinds)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        ExecutableIconService icons(fixture.logger);
        ExecutableService executables(fixture.logger, icons, fixture.pathSettings);

        const std::vector<GameExecutable> saved = executables.saveProjectExecutables(
            fixture.config,
            {
                GameExecutable{
                    L"texgen",
                    L"TexGen",
                    (fixture.toolDirectory / L"TexGenx64.exe").wstring()},
                GameExecutable{
                    L"dyndolod",
                    L"DynDOLOD",
                    (fixture.toolDirectory / L"DynDOLODx64.exe").wstring()},
                GameExecutable{
                    L"ssedit",
                    L"SSEEdit",
                    (fixture.toolDirectory / L"SSEEdit.exe").wstring()}
            });

        ASSERT_EQ(saved.size(), 3U);
        const auto findKind = [&saved](std::wstring_view id)
        {
            const auto found = std::find_if(
                saved.begin(),
                saved.end(),
                [id](const GameExecutable& executable)
                {
                    return executable.id == id;
                });
            return found == saved.end() ? std::wstring{} : found->managedToolKind;
        };
        EXPECT_EQ(findKind(L"texgen"), texGenManagedToolKind);
        EXPECT_EQ(findKind(L"dyndolod"), dynDoLodManagedToolKind);
        EXPECT_TRUE(findKind(L"ssedit").empty());
    }

    TEST(LodGeneratorIntegrationServiceTests, CompletedTexGenSessionAtomicallyPublishesStagedOutput)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(texGenManagedToolKind),
            L"Default");

        writeTextFile(prepared.outputMod.path / L"old-output.txt", "previous");
        writeTextFile(
            prepared.stagingDirectory / L"textures" / L"terrain" / L"tamriel.dds",
            "generated");

        std::vector<VfsMountDescriptor> mounts;
        fixture.service.applyVfsPolicy(mounts, prepared);
        ASSERT_EQ(mounts.size(), 1U);
        EXPECT_EQ(
            normalized(mounts.front().target),
            normalized(prepared.virtualOutputDirectory));
        EXPECT_TRUE(std::filesystem::equivalent(
            mounts.front().overwrite,
            prepared.stagingDirectory));
        EXPECT_TRUE(mounts.front().mods.empty());

        const ManagedLaunchCompletion completed =
            fixture.service.completeManagedLaunch(prepared.sessionId, L"completed");
        EXPECT_TRUE(completed.finalized);
        EXPECT_FALSE(completed.deferred);
        EXPECT_TRUE(completed.warnings.empty());
        EXPECT_FALSE(std::filesystem::exists(prepared.outputMod.path / L"old-output.txt"));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            prepared.outputMod.path / L"textures" / L"terrain" / L"tamriel.dds"));
        EXPECT_FALSE(std::filesystem::exists(prepared.stagingDirectory));

        const ManagedLaunchCompletion repeated =
            fixture.service.completeManagedLaunch(prepared.sessionId, L"completed");
        EXPECT_TRUE(repeated.finalized);
        EXPECT_EQ(repeated.outputMod.id, completed.outputMod.id);
    }

    TEST(LodGeneratorIntegrationServiceTests, ActiveToolLeaseBlocksConcurrentLaunchAndAbandonCleansOnlyStage)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const LodGeneratorLaunchPreparation first = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(texGenManagedToolKind),
            L"Default");
        writeTextFile(first.stagingDirectory / L"partial.tmp", "partial");

        try
        {
            static_cast<void>(fixture.service.prepareLaunch(
                fixture.config,
                fixture.resolved(texGenManagedToolKind),
                L"Default"));
            FAIL() << "A concurrent TexGen launch should not acquire the managed lease.";
        }
        catch (const LodGeneratorIntegrationError& error)
        {
            EXPECT_EQ(error.code(), L"LOD_GENERATOR_SESSION_ACTIVE");
        }

        fixture.service.abandonLaunch(first.sessionId);
        EXPECT_FALSE(std::filesystem::exists(first.stagingDirectory.parent_path()));
        EXPECT_TRUE(std::filesystem::is_directory(first.outputMod.path));

        const LodGeneratorLaunchPreparation next = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(texGenManagedToolKind),
            L"Default");
        EXPECT_NE(next.sessionId, first.sessionId);
        fixture.service.abandonLaunch(next.sessionId);
    }

    TEST(LodGeneratorIntegrationServiceTests, DynDoLodUsesTexGenOutputAndPreservesPreviousOutputOnFailure)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(dynDoLodManagedToolKind),
            L"Default");

        ASSERT_EQ(prepared.activeProfileMods.size(), 2U);
        EXPECT_EQ(prepared.activeProfileMods.front().path, fixture.toolMod);
        EXPECT_EQ(
            normalized(prepared.activeProfileMods.back().path),
            normalized(fixture.mods / L"TexGen Output"));
        EXPECT_EQ(prepared.outputMod.path, fixture.mods / L"DynDOLOD Output");
        EXPECT_EQ(prepared.outputMod.provider, dynDoLodGeneratedProvider);

        writeTextFile(prepared.outputMod.path / L"previous" / L"DynDOLOD.esm", "stable");
        writeTextFile(prepared.stagingDirectory / L"partial" / L"DynDOLOD.esm", "partial");

        const ManagedLaunchCompletion failed =
            fixture.service.completeManagedLaunch(prepared.sessionId, L"failed");
        EXPECT_TRUE(failed.finalized);
        EXPECT_FALSE(failed.warnings.empty());
        EXPECT_TRUE(std::filesystem::is_regular_file(
            prepared.outputMod.path / L"previous" / L"DynDOLOD.esm"));
        EXPECT_FALSE(std::filesystem::exists(
            prepared.outputMod.path / L"partial" / L"DynDOLOD.esm"));
        EXPECT_FALSE(std::filesystem::exists(prepared.stagingDirectory));
    }
}
