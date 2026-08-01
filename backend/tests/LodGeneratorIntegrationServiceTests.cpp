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

    TEST(LodGeneratorIntegrationServiceTests, TexGenPreparationCreatesOnlyTexGenOutputAndEnforcesManagedArguments)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(texGenManagedToolKind),
            L"Default");

        const std::filesystem::path texGenOutput =
            fixture.mods / L"Сборка LOD - TexGen Output";
        const std::filesystem::path dynDoLodOutput =
            fixture.mods / L"Сборка LOD - DynDOLOD Output";
        EXPECT_EQ(prepared.outputMod.path, texGenOutput);
        EXPECT_EQ(prepared.outputMod.provider, texGenGeneratedProvider);
        EXPECT_TRUE(std::filesystem::is_directory(texGenOutput));
        EXPECT_FALSE(std::filesystem::exists(dynDoLodOutput));
        EXPECT_TRUE(std::filesystem::is_directory(prepared.stagingDirectory));
        EXPECT_TRUE(std::filesystem::is_empty(prepared.stagingDirectory));
        EXPECT_EQ(
            prepared.virtualOutputDirectory.filename(),
            L"Сборка LOD - TexGen Output");
        EXPECT_EQ(prepared.activeProfileMods.size(), 1U);
        EXPECT_EQ(prepared.activeProfileMods.front().path, fixture.toolMod);

        EXPECT_NE(prepared.commandLine.find(L"-sse"), std::wstring::npos);
        EXPECT_NE(prepared.commandLine.find(L"-qac"), std::wstring::npos);
        EXPECT_NE(prepared.commandLine.find(L"-d:"), std::wstring::npos);
        EXPECT_NE(prepared.commandLine.find((fixture.game / L"Data").wstring()), std::wstring::npos);
        EXPECT_NE(prepared.commandLine.find(L"-o:"), std::wstring::npos);
        EXPECT_NE(
            prepared.commandLine.find(prepared.virtualOutputDirectory.wstring()),
            std::wstring::npos);
        EXPECT_EQ(prepared.commandLine.find(L"-tes5"), std::wstring::npos);
        EXPECT_EQ(prepared.commandLine.find(L"C:\\Old Output"), std::wstring::npos);

        const std::vector<ProfileOrderItemRecord> order =
            InstanceMetadataStore::listCachedProfileOrderItems(
                fixture.project,
                L"Default",
                fixture.mods);
        ASSERT_GE(order.size(), 2U);
        EXPECT_EQ(order.back().mod.folderName, L"Сборка LOD - TexGen Output");
        EXPECT_EQ(order.back().mod.state, L"installed");

        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(LodGeneratorIntegrationServiceTests, DynDoLodPreparationRequiresExistingTexGenOutput)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());

        try
        {
            static_cast<void>(fixture.service.prepareLaunch(
                fixture.config,
                fixture.resolved(dynDoLodManagedToolKind),
                L"Default"));
            FAIL() << "DynDOLOD must not create a placeholder TexGen output.";
        }
        catch (const LodGeneratorIntegrationError& error)
        {
            EXPECT_EQ(error.code(), L"LOD_GENERATOR_TEXGEN_OUTPUT_REQUIRED");
        }

        EXPECT_FALSE(std::filesystem::exists(
            fixture.mods / L"Сборка LOD - TexGen Output"));
        EXPECT_FALSE(std::filesystem::exists(
            fixture.mods / L"Сборка LOD - DynDOLOD Output"));
    }

    TEST(LodGeneratorIntegrationServiceTests, TexGenPreparationMigratesOnlyItsLegacyOutput)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const std::filesystem::path legacyTexGen = fixture.mods / L"TexGen Output";
        const std::filesystem::path legacyDynDoLod = fixture.mods / L"DynDOLOD Output";
        writeTextFile(legacyTexGen / L"textures" / L"legacy-texgen.dds", "texgen");
        writeTextFile(legacyDynDoLod / L"legacy-dyndolod.esm", "dyndolod");
        const InstalledModRecord texGenRecord = InstanceMetadataStore::registerInstalledMod(
            fixture.project,
            legacyTexGen,
            L"TexGen Output",
            {},
            ModSourceRecord{std::wstring(texGenGeneratedProvider)});
        const InstalledModRecord dynDoLodRecord = InstanceMetadataStore::registerInstalledMod(
            fixture.project,
            legacyDynDoLod,
            L"DynDOLOD Output",
            {},
            ModSourceRecord{std::wstring(dynDoLodGeneratedProvider)});

        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(texGenManagedToolKind),
            L"Default");

        const std::filesystem::path texGenOutput =
            fixture.mods / L"Сборка LOD - TexGen Output";
        EXPECT_EQ(prepared.outputMod.id, texGenRecord.uuid);
        EXPECT_FALSE(std::filesystem::exists(legacyTexGen));
        EXPECT_TRUE(std::filesystem::exists(legacyDynDoLod));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            texGenOutput / L"textures" / L"legacy-texgen.dds"));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            legacyDynDoLod / L"legacy-dyndolod.esm"));
        const std::optional<InstalledModRecord> unchangedDynDoLod =
            InstanceMetadataStore::installedModByUuid(fixture.project, dynDoLodRecord.uuid);
        ASSERT_TRUE(unchangedDynDoLod.has_value());
        EXPECT_EQ(unchangedDynDoLod->path, legacyDynDoLod);
        EXPECT_EQ(unchangedDynDoLod->displayName, L"DynDOLOD Output");

        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(LodGeneratorIntegrationServiceTests, PreparationRefusesUnownedPrefixedOutput)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const std::filesystem::path occupied =
            fixture.mods / L"Сборка LOD - TexGen Output";
        writeTextFile(occupied / L"user.txt", "user-owned");

        try
        {
            static_cast<void>(fixture.service.prepareLaunch(
                fixture.config,
                fixture.resolved(texGenManagedToolKind),
                L"Default"));
            FAIL() << "An unowned output directory must not be adopted as generated content.";
        }
        catch (const LodGeneratorIntegrationError& error)
        {
            EXPECT_EQ(error.code(), L"LOD_GENERATOR_OUTPUT_CONFLICT");
        }

        EXPECT_EQ(readTextFile(occupied / L"user.txt"), "user-owned");
    }

    TEST(LodGeneratorIntegrationServiceTests, TexGenPreparationReplacesLegacyQtEscapedDataPath)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        ResolvedExecutableLaunch resolved = fixture.resolved(texGenManagedToolKind);
        resolved.executable.arguments =
            LR"(-D:\"E:\\\\Foundation Edition\\\\Stock Game\\\\Data\\\" -sse\n -qac)";
        resolved.commandLine =
            L"\"" + resolved.resolvedExecutablePath.wstring() + L"\" " +
            resolved.executable.arguments;

        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            resolved,
            L"Default");

        EXPECT_NE(prepared.commandLine.find(L"-d:"), std::wstring::npos);
        EXPECT_NE(
            prepared.commandLine.find(
                (fixture.game.filename() / L"Data").wstring()),
            std::wstring::npos);
        EXPECT_EQ(prepared.commandLine.find(L"Foundation Edition"), std::wstring::npos);
        EXPECT_EQ(prepared.commandLine.find(L"\\n"), std::wstring::npos);
        EXPECT_NE(prepared.commandLine.find(L"-qac"), std::wstring::npos);

        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(LodGeneratorIntegrationServiceTests, TexGenPreparationRewritesPresetOutputPathToManagedOutput)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const std::filesystem::path preset =
            fixture.toolDirectory /
            L"Edit Scripts" /
            L"DynDOLOD" /
            L"Presets" /
            L"DynDOLOD_SSE_TexGen.ini";
        writeTextFile(
            preset,
            "[TexGen]\r\n"
            "OutputPath=E:\\Foundation Edition\\tools\\DynDOLOD\\TexGen_Output\\\r\n"
            "DiffuseFormat=225\r\n"
            "\r\n"
            "[DynDOLOD]\r\n"
            "OutputPath=E:\\Keep DynDOLOD Output\\\r\n");
        ResolvedExecutableLaunch resolved = fixture.resolved(texGenManagedToolKind);
        resolved.projectName = L"Foundation Edition";

        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            resolved,
            L"Default");

        const std::string updated = readTextFile(preset);
        EXPECT_NE(
            updated.find(
                "OutputPath=" +
                prepared.virtualOutputDirectory.string() +
                "\\"),
            std::string::npos);
        EXPECT_EQ(updated.find("E:\\Foundation Edition"), std::string::npos);
        EXPECT_NE(updated.find("DiffuseFormat=225"), std::string::npos);
        EXPECT_NE(
            updated.find("OutputPath=E:\\Keep DynDOLOD Output\\"),
            std::string::npos);

        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(LodGeneratorIntegrationServiceTests, DynDoLodPreparationRewritesOnlyItsPresetOutputPath)
    {
        TempDirectory temp;
        LodGeneratorFixture fixture(temp.path());
        const LodGeneratorLaunchPreparation texGen = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(texGenManagedToolKind),
            L"Default");
        fixture.service.abandonLaunch(texGen.sessionId);
        const std::filesystem::path preset =
            fixture.toolDirectory /
            L"Edit Scripts" /
            L"DynDOLOD" /
            L"Presets" /
            L"DynDOLOD_SSE_Preset.ini";
        writeTextFile(
            preset,
            "[TexGen]\n"
            "OutputPath=E:\\Keep TexGen Output\\\n"
            "\n"
            "[DynDOLOD]\n"
            "OutputPath=E:\\Foundation Edition\\tools\\DynDOLOD\\DynDOLOD_Output\\\n"
            "Preset=High\n");
        ResolvedExecutableLaunch resolved = fixture.resolved(dynDoLodManagedToolKind);
        resolved.projectName = L"Foundation Edition";

        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            resolved,
            L"Default");

        const std::string updated = readTextFile(preset);
        EXPECT_NE(
            updated.find(
                "OutputPath=" +
                prepared.virtualOutputDirectory.string() +
                "\\"),
            std::string::npos);
        EXPECT_EQ(updated.find("E:\\Foundation Edition"), std::string::npos);
        EXPECT_NE(
            updated.find("OutputPath=E:\\Keep TexGen Output\\"),
            std::string::npos);
        EXPECT_NE(updated.find("Preset=High"), std::string::npos);

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
        EXPECT_EQ(completed.outputMod.displayName, L"Сборка LOD - TexGen Output");
        EXPECT_EQ(completed.outputMod.folderName, L"Сборка LOD - TexGen Output");
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
        const LodGeneratorLaunchPreparation texGen = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(texGenManagedToolKind),
            L"Default");
        fixture.service.abandonLaunch(texGen.sessionId);
        const LodGeneratorLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(dynDoLodManagedToolKind),
            L"Default");

        ASSERT_EQ(prepared.activeProfileMods.size(), 2U);
        EXPECT_EQ(prepared.activeProfileMods.front().path, fixture.toolMod);
        EXPECT_EQ(
            normalized(prepared.activeProfileMods.back().path),
            normalized(fixture.mods / L"Сборка LOD - TexGen Output"));
        EXPECT_EQ(
            prepared.outputMod.path,
            fixture.mods / L"Сборка LOD - DynDOLOD Output");
        EXPECT_EQ(prepared.outputMod.provider, dynDoLodGeneratedProvider);
        EXPECT_NE(prepared.commandLine.find(L"-sse"), std::wstring::npos);
        EXPECT_NE(prepared.commandLine.find(L"-d:"), std::wstring::npos);
        EXPECT_NE(prepared.commandLine.find((fixture.game / L"Data").wstring()), std::wstring::npos);
        EXPECT_EQ(prepared.commandLine.find(L"-tes5"), std::wstring::npos);

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
