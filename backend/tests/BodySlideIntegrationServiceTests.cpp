#include "FluxoraCore/Services/BodySlideIntegrationService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <fstream>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora::tests
{
    namespace
    {
        void copyCurrentX64Executable(const std::filesystem::path& destination)
        {
#ifdef _WIN32
            std::wstring source(32768, L'\0');
            const DWORD length = GetModuleFileNameW(
                nullptr,
                source.data(),
                static_cast<DWORD>(source.size()));
            ASSERT_GT(length, 0U);
            source.resize(length);
            std::filesystem::create_directories(destination.parent_path());
            std::filesystem::copy_file(
                source,
                destination,
                std::filesystem::copy_options::overwrite_existing);
#else
            writeTextFile(destination, "MZ");
#endif
        }

#ifdef _WIN32
        void changePeMachineToX86(const std::filesystem::path& executable)
        {
            std::fstream stream(executable, std::ios::binary | std::ios::in | std::ios::out);
            ASSERT_TRUE(stream.good());
            stream.seekg(0x3c, std::ios::beg);
            std::uint32_t peOffset = 0;
            stream.read(reinterpret_cast<char*>(&peOffset), sizeof(peOffset));
            ASSERT_TRUE(stream.good());
            stream.seekp(static_cast<std::streamoff>(peOffset + 4), std::ios::beg);
            const std::uint16_t x86Machine = 0x014c;
            stream.write(reinterpret_cast<const char*>(&x86Machine), sizeof(x86Machine));
            ASSERT_TRUE(stream.good());
        }
#endif

        struct BodySlideFixture
        {
            explicit BodySlideFixture(
                const std::filesystem::path& root,
                std::wstring projectDisplayName = L"Сборка & Test")
                : project(root / projectDisplayName),
                  game(project / L"stock game"),
                  mods(project / L"mods"),
                  overwrite(project / L"overwrite"),
                  toolMod(mods / L"BodySlide Tool"),
                  toolDirectory(toolMod / L"CalienteTools" / L"BodySlide"),
                  executable(toolDirectory / L"BodySlide x64.exe"),
                  config(root / L"configs" / L"build.json"),
                  pathSettings(logger),
                  service(logger, pathSettings)
            {
                writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
                copyCurrentX64Executable(executable);
                writeTextFile(toolDirectory / L"res" / L"xrc" / L"BodySlide.xrc", "resource");
                writeTextFile(
                    config,
                    "{"
                    "\"id\":\"build\","
                    "\"name\":\"test\","
                    "\"gameId\":\"skyrimse\","
                    "\"templateId\":\"skyrimse\","
                    "\"projectDirectory\":\"../Сборка & Test\","
                    "\"gamePath\":\"stock game\","
                    "\"dataDirectory\":\"Data\","
                    "\"defaultProfile\":\"Default\","
                    "\"launchExecutables\":[{"
                    "\"id\":\"bodyslide\","
                    "\"displayName\":\"BodySlide\","
                    "\"executablePath\":\"mods/BodySlide Tool/CalienteTools/BodySlide/BodySlide x64.exe\","
                    "\"arguments\":\"\",\"workingDirectory\":\"\""
                    "}]"
                    "}");
                InstanceMetadataStore::ensureInstance(project, L"skyrimse");
                static_cast<void>(pathSettings.saveForConfig(
                    config,
                    BuildPathSettings{game, mods, project / L"profiles", {}, overwrite}));
                InstanceMetadataStore::registerInstalledMods(
                    project,
                    {InstalledModImportRecord{toolMod, L"BodySlide Tool", {}, true, {}}});
                InstanceMetadataStore::replaceProfileOrderItems(
                    project,
                    L"Default",
                    {ProfileOrderImportItemRecord{L"mod", toolMod.filename().wstring(), {}}});
                service.initialize();
            }

            ~BodySlideFixture()
            {
                service.shutdown();
            }

            ResolvedExecutableLaunch resolved(std::wstring projectName = L"Сборка & Test") const
            {
                ResolvedExecutableLaunch value;
                value.executable.id = L"bodyslide";
                value.executable.displayName = L"BodySlide";
                value.executable.executablePath = executable.wstring();
                value.executable.managedToolKind = std::wstring(bodySlideManagedToolKind);
                value.resolvedExecutablePath = executable;
                value.resolvedWorkingDirectory = toolDirectory;
                value.gamePath = game;
                value.projectDirectory = project;
                value.gameId = GameId::parseOrThrow(L"skyrimse");
                value.dataDirectory = L"Data";
                value.defaultProfile = L"Default";
                value.activeProfileMods = {
                    ExecutableLaunchMod{toolMod, L"BodySlide Tool", L"tool-fingerprint"}};
                value.projectName = std::move(projectName);
                return value;
            }

            std::filesystem::path project;
            std::filesystem::path game;
            std::filesystem::path mods;
            std::filesystem::path overwrite;
            std::filesystem::path toolMod;
            std::filesystem::path toolDirectory;
            std::filesystem::path executable;
            std::filesystem::path config;
            Logger logger;
            BuildPathSettingsService pathSettings;
            BodySlideIntegrationService service;
        };

        void expectIntegrationErrorCode(
            const std::function<void()>& action,
            std::wstring_view expectedCode)
        {
            try
            {
                action();
                FAIL() << "Expected BodySlideIntegrationError.";
            }
            catch (const BodySlideIntegrationError& exception)
            {
                EXPECT_EQ(exception.code(), expectedCode);
            }
        }
    }

    TEST(BodySlideIntegrationServiceTests, DetectsOnlyOfficialBodySlideExecutableNames)
    {
        GameExecutable executable;
        executable.id = L"tool";
        executable.displayName = L"BodySlide";

        EXPECT_EQ(
            BodySlideIntegrationService::detectManagedToolKind(
                executable,
                L"C:\\Build\\mods\\BodySlide\\CalienteTools\\BodySlide\\BodySlide x64.exe"),
            bodySlideManagedToolKind);
        EXPECT_EQ(
            BodySlideIntegrationService::detectManagedToolKind(
                executable,
                L"C:\\Build\\mods\\BodySlide\\CalienteTools\\BodySlide\\BODyslide.EXE"),
            bodySlideManagedToolKind);
        EXPECT_TRUE(
            BodySlideIntegrationService::detectManagedToolKind(
                executable,
                L"C:\\Build\\mods\\BodySlide\\CalienteTools\\BodySlide\\OutfitStudio x64.exe")
                .empty());
    }

    TEST(BodySlideIntegrationServiceTests, AutoDetectsLegacyManifestAndPersistsMarkerOnSave)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        ExecutableIconService icons(fixture.logger);
        ExecutableService executables(fixture.logger, icons, fixture.pathSettings);

        std::vector<GameExecutable> listed = executables.listProjectExecutables(fixture.config);
        const auto bodySlide = std::find_if(
            listed.begin(),
            listed.end(),
            [](const GameExecutable& executable)
            {
                return executable.id == L"bodyslide";
            });
        ASSERT_NE(bodySlide, listed.end());
        EXPECT_EQ(bodySlide->managedToolKind, bodySlideManagedToolKind);

        static_cast<void>(executables.saveProjectExecutables(fixture.config, listed));
        EXPECT_NE(
            readTextFile(fixture.config).find("\"managedToolKind\":\"bodySlide\""),
            std::string::npos);
    }

#ifdef _WIN32
    TEST(BodySlideIntegrationServiceTests, ConfiguresX64OverlayPreservesUnknownXmlAndCreatesOutputLast)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        writeTextFile(
            fixture.toolDirectory / L"Config.xml",
            "<Config>\n"
            "  <TargetGame>-1</TargetGame>\n"
            "  <GameDataPaths><SkyrimSpecialEdition>old</SkyrimSpecialEdition></GameDataPaths>\n"
            "  <GameDataPath>old</GameDataPath><OutputDataPath>old</OutputDataPath>\n"
            "  <ProjectPath>old</ProjectPath>\n"
            "  <KeepMe enabled=\"true\">unchanged</KeepMe>\n"
            "</Config>\n");
        writeTextFile(fixture.toolDirectory / L"BodySlide.xml", "<BodySlide><Theme>dark</Theme></BodySlide>");
        InstanceMetadataStore::replaceProfileOrderItems(
            fixture.project,
            L"Alternate",
            {ProfileOrderImportItemRecord{L"mod", fixture.toolMod.filename().wstring(), {}}});

        const BodySlideLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");

        EXPECT_EQ(prepared.configurationStatus, L"configured");
        EXPECT_EQ(prepared.outputMod.provider, bodySlideGeneratedProvider);
        EXPECT_TRUE(std::filesystem::is_directory(prepared.outputMod.path));
        EXPECT_EQ(prepared.projectRelativeDirectory, std::filesystem::path(L"CalienteTools") / L"BodySlide");
        const std::string xml = readTextFile(prepared.configOverlayDirectory / L"Config.xml");
        EXPECT_NE(xml.find("<TargetGame>4</TargetGame>"), std::string::npos);
        EXPECT_NE(xml.find("<KeepMe enabled=\"true\">unchanged</KeepMe>"), std::string::npos);
        EXPECT_NE(xml.find("Сборка &amp; Test"), std::string::npos);
        EXPECT_NE(xml.find("Data\\</GameDataPath>"), std::string::npos);
        EXPECT_NE(xml.find("Data\\</OutputDataPath>"), std::string::npos);
        EXPECT_NE(xml.find("Data\\</SkyrimSpecialEdition>"), std::string::npos);
        EXPECT_EQ(
            readTextFile(prepared.configOverlayDirectory / L"BodySlide.xml"),
            "<BodySlide><Theme>dark</Theme></BodySlide>");

        const std::vector<ProfileOrderItemRecord> order =
            InstanceMetadataStore::listCachedProfileOrderItems(
                fixture.project,
                L"Default",
                fixture.mods);
        ASSERT_FALSE(order.empty());
        ASSERT_TRUE(order.back().hasMod);
        EXPECT_EQ(order.back().mod.uuid, prepared.outputMod.id);
        const std::vector<ProfileOrderItemRecord> alternateOrder =
            InstanceMetadataStore::listCachedProfileOrderItems(
                fixture.project,
                L"Alternate",
                fixture.mods);
        ASSERT_FALSE(alternateOrder.empty());
        ASSERT_TRUE(alternateOrder.back().hasMod);
        EXPECT_EQ(alternateOrder.back().mod.uuid, prepared.outputMod.id);

        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(BodySlideIntegrationServiceTests, CreatesMinimalOverlayWhenSourceConfigIsMissing)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());

        const BodySlideLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");

        EXPECT_EQ(prepared.configurationStatus, L"configured");
        const std::string xml = readTextFile(prepared.configOverlayDirectory / L"Config.xml");
        EXPECT_NE(xml.find("<TargetGame>4</TargetGame>"), std::string::npos);
        EXPECT_NE(xml.find("<GameDataPaths>"), std::string::npos);
        EXPECT_NE(xml.find("<SkyrimSpecialEdition>"), std::string::npos);
        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(BodySlideIntegrationServiceTests, RecoversMalformedConfigWithoutChangingSource)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const std::string damaged = "<Config><KeepMe>broken";
        writeTextFile(fixture.toolDirectory / L"Config.xml", damaged);

        const BodySlideLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");

        EXPECT_EQ(prepared.configurationStatus, L"recovered");
        EXPECT_FALSE(prepared.warnings.empty());
        EXPECT_EQ(readTextFile(fixture.toolDirectory / L"Config.xml"), damaged);
        EXPECT_NE(
            readTextFile(prepared.configOverlayDirectory / L"Config.xml").find(
                "<TargetGame>4</TargetGame>"),
            std::string::npos);
        const std::filesystem::path recovery = prepared.configOverlayDirectory / L"recovery";
        ASSERT_TRUE(std::filesystem::is_directory(recovery));
        EXPECT_NE(std::filesystem::directory_iterator(recovery), std::filesystem::directory_iterator());
        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(BodySlideIntegrationServiceTests, RejectsX86BodySlideBeforeCreatingManagedSession)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        changePeMachineToX86(fixture.executable);

        expectIntegrationErrorCode(
            [&fixture]
            {
                static_cast<void>(fixture.service.prepareLaunch(
                    fixture.config,
                    fixture.resolved(),
                    L"Default"));
            },
            L"BODYSLIDE_X86_UNSUPPORTED");
        EXPECT_FALSE(std::filesystem::exists(
            fixture.project / L".flow" / L"tools" / L"body-slide" / L"active-session.json"));
    }

    TEST(BodySlideIntegrationServiceTests, RejectsUnsupportedGameBeforeCreatingManagedSession)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        ResolvedExecutableLaunch resolved = fixture.resolved();
        resolved.gameId = GameId::parseOrThrow(L"fallout4");

        expectIntegrationErrorCode(
            [&fixture, &resolved]
            {
                static_cast<void>(fixture.service.prepareLaunch(
                    fixture.config,
                    resolved,
                    L"Default"));
            },
            L"BODYSLIDE_GAME_UNSUPPORTED");
        EXPECT_FALSE(std::filesystem::exists(
            fixture.project / L".flow" / L"tools" / L"body-slide" / L"active-session.json"));
    }

    TEST(BodySlideIntegrationServiceTests, AppliesExactDataAndExecutableOverlayOrder)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const std::filesystem::path ordinaryMod = fixture.mods / L"Ordinary";
        writeTextFile(ordinaryMod / L"meshes" / L"base.nif", "mesh");
        ResolvedExecutableLaunch resolved = fixture.resolved();
        resolved.activeProfileMods.insert(
            resolved.activeProfileMods.begin(),
            ExecutableLaunchMod{ordinaryMod, L"Ordinary", L"ordinary-fingerprint"});
        const BodySlideLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            resolved,
            L"Default");
        std::vector<VfsMountDescriptor> mounts{
            VfsMountDescriptor{
                fixture.game / L"Data",
                fixture.overwrite,
                {ordinaryMod, fixture.toolMod, prepared.outputMod.path}}};

        fixture.service.applyVfsPolicy(mounts, resolved, prepared);

        ASSERT_EQ(mounts.size(), 2U);
        EXPECT_EQ(mounts[0].overwrite, prepared.outputMod.path);
        ASSERT_EQ(mounts[0].mods.size(), 4U);
        EXPECT_EQ(mounts[0].mods[0], ordinaryMod);
        EXPECT_EQ(mounts[0].mods[1], fixture.toolMod);
        EXPECT_EQ(mounts[0].mods[2], fixture.overwrite);
        EXPECT_EQ(mounts[0].mods[3], prepared.outputMod.path);
        EXPECT_EQ(mounts[1].target, std::filesystem::weakly_canonical(fixture.toolDirectory));
        EXPECT_EQ(mounts[1].overwrite, std::filesystem::weakly_canonical(prepared.configOverlayDirectory));
        fixture.service.abandonLaunch(prepared.sessionId);
    }

    TEST(BodySlideIntegrationServiceTests, ReusesOutputAndFinalizationIsIdempotent)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const BodySlideLaunchPreparation first = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");
        writeTextFile(first.outputMod.path / L"meshes" / L"generated.nif", "generated");

        const ManagedLaunchCompletion completed = fixture.service.completeManagedLaunch(
            first.sessionId,
            L"completed");
        const ManagedLaunchCompletion repeated = fixture.service.completeManagedLaunch(
            first.sessionId,
            L"completed");
        EXPECT_TRUE(completed.finalized);
        EXPECT_TRUE(repeated.finalized);
        EXPECT_EQ(completed.outputMod.id, first.outputMod.id);

        const BodySlideLaunchPreparation second = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");
        EXPECT_EQ(second.outputMod.id, first.outputMod.id);
        EXPECT_TRUE(std::filesystem::exists(second.outputMod.path / L"meshes" / L"generated.nif"));
        fixture.service.abandonLaunch(second.sessionId);
    }

    TEST(BodySlideIntegrationServiceTests, RecoversStalePersistedLeaseBeforeNextLaunch)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const BodySlideLaunchPreparation stale = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");
        const std::filesystem::path activeSession =
            fixture.project / L".flow" / L"tools" / L"body-slide" / L"active-session.json";
        std::string active = readTextFile(activeSession);
        const std::string managerKey = "\"managerProcessId\":";
        const std::size_t manager = active.find(managerKey);
        ASSERT_NE(manager, std::string::npos);
        const std::size_t valueBegin = manager + managerKey.size();
        const std::size_t valueEnd = active.find(',', valueBegin);
        ASSERT_NE(valueEnd, std::string::npos);
        active.replace(valueBegin, valueEnd - valueBegin, "0");
        writeTextFile(activeSession, active);

        const BodySlideLaunchPreparation recovered = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");

        EXPECT_NE(recovered.sessionId, stale.sessionId);
        ASSERT_FALSE(recovered.warnings.empty());
        EXPECT_NE(recovered.warnings.front().find(L"восстановлена"), std::wstring::npos);
        const std::filesystem::path staleState =
            fixture.project / L".flow" / L"tools" / L"body-slide" / L"sessions" /
            (stale.sessionId + L".json");
        EXPECT_NE(readTextFile(staleState).find("\"status\":\"completed\""), std::string::npos);
        fixture.service.abandonLaunch(recovered.sessionId);
    }

    TEST(BodySlideIntegrationServiceTests, RejectsExternalExecutableWithoutModifyingIt)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const std::filesystem::path externalDirectory = temp.path() / L"external";
        const std::filesystem::path externalExecutable = externalDirectory / L"BodySlide x64.exe";
        copyCurrentX64Executable(externalExecutable);
        writeTextFile(externalDirectory / L"res" / L"xrc" / L"BodySlide.xrc", "resource");
        const std::string original = readTextFile(externalExecutable);
        ResolvedExecutableLaunch resolved = fixture.resolved();
        resolved.executable.executablePath = externalExecutable.wstring();
        resolved.resolvedExecutablePath = externalExecutable;
        resolved.resolvedWorkingDirectory = externalDirectory;

        expectIntegrationErrorCode(
            [&fixture, &resolved]
            {
                static_cast<void>(fixture.service.prepareLaunch(
                    fixture.config,
                    resolved,
                    L"Default"));
            },
            L"BODYSLIDE_EXTERNAL_TOOL");
        EXPECT_EQ(readTextFile(externalExecutable), original);
        EXPECT_FALSE(std::filesystem::exists(externalDirectory / L"Config.xml"));
    }

    TEST(BodySlideIntegrationServiceTests, BlocksSecondLeaseAndRenamesOnlyOwnedOutput)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const BodySlideLaunchPreparation first = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(L"Initial Name"),
            L"Default");
        expectIntegrationErrorCode(
            [&fixture]
            {
                static_cast<void>(fixture.service.prepareLaunch(
                    fixture.config,
                    fixture.resolved(L"Initial Name"),
                    L"Default"));
            },
            L"BODYSLIDE_SESSION_ACTIVE");
        static_cast<void>(fixture.service.completeManagedLaunch(first.sessionId, L"completed"));

        const BodySlideLaunchPreparation renamed = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(L"Renamed Build"),
            L"Default");
        EXPECT_EQ(renamed.outputMod.id, first.outputMod.id);
        EXPECT_NE(renamed.outputMod.folderName, first.outputMod.folderName);
        EXPECT_FALSE(std::filesystem::exists(first.outputMod.path));
        fixture.service.abandonLaunch(renamed.sessionId);
    }

    TEST(BodySlideIntegrationServiceTests, RecreatesOwnedOutputAfterUserDeletesIt)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const BodySlideLaunchPreparation first = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");
        static_cast<void>(fixture.service.completeManagedLaunch(first.sessionId, L"completed"));

        InstanceMetadataStore::deleteInstalledMod(fixture.project, first.outputMod.path);
        std::filesystem::remove_all(first.outputMod.path);

        const BodySlideLaunchPreparation recreated = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");

        EXPECT_TRUE(std::filesystem::is_directory(recreated.outputMod.path));
        EXPECT_EQ(recreated.outputMod.id, first.outputMod.id);
        EXPECT_EQ(recreated.outputMod.provider, bodySlideGeneratedProvider);
        fixture.service.abandonLaunch(recreated.sessionId);
    }

    TEST(BodySlideIntegrationServiceTests, RefusesDeletedOutputRecoveryWhenFolderWasReused)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const BodySlideLaunchPreparation first = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(),
            L"Default");
        static_cast<void>(fixture.service.completeManagedLaunch(first.sessionId, L"completed"));

        InstanceMetadataStore::deleteInstalledMod(fixture.project, first.outputMod.path);
        std::filesystem::remove_all(first.outputMod.path);
        writeTextFile(first.outputMod.path / L"user.txt", "owned by user");

        expectIntegrationErrorCode(
            [&fixture]
            {
                static_cast<void>(fixture.service.prepareLaunch(
                    fixture.config,
                    fixture.resolved(),
                    L"Default"));
            },
            L"BODYSLIDE_OUTPUT_CONFLICT");
        EXPECT_EQ(readTextFile(first.outputMod.path / L"user.txt"), "owned by user");
    }

    TEST(BodySlideIntegrationServiceTests, ProjectRenameKeepsOutputUuidAndProfileReferences)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const BodySlideLaunchPreparation prepared = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(L"Initial Name"),
            L"Default");
        static_cast<void>(fixture.service.completeManagedLaunch(prepared.sessionId, L"completed"));

        fixture.service.preflightProjectRename(fixture.project, L"Renamed Build");
        fixture.service.completeProjectRename(fixture.project, L"Renamed Build");

        const std::optional<InstalledModRecord> renamed =
            InstanceMetadataStore::installedModByUuid(fixture.project, prepared.outputMod.id);
        ASSERT_TRUE(renamed.has_value());
        EXPECT_EQ(renamed->uuid, prepared.outputMod.id);
        EXPECT_EQ(renamed->source.provider, bodySlideGeneratedProvider);
        EXPECT_EQ(renamed->folderName, L"Renamed Build - BodySlide Output");
        const std::vector<ProfileOrderItemRecord> order =
            InstanceMetadataStore::listCachedProfileOrderItems(
                fixture.project,
                L"Default",
                fixture.mods);
        ASSERT_FALSE(order.empty());
        ASSERT_TRUE(order.back().hasMod);
        EXPECT_EQ(order.back().mod.uuid, prepared.outputMod.id);
    }

    TEST(BodySlideIntegrationServiceTests, RefusesRenameWhenUserModOwnsTargetName)
    {
        TempDirectory temp;
        BodySlideFixture fixture(temp.path());
        const BodySlideLaunchPreparation first = fixture.service.prepareLaunch(
            fixture.config,
            fixture.resolved(L"Initial Name"),
            L"Default");
        static_cast<void>(fixture.service.completeManagedLaunch(first.sessionId, L"completed"));
        const std::filesystem::path conflict = fixture.mods / L"Conflict Name - BodySlide Output";
        writeTextFile(conflict / L"user.txt", "owned by user");
        InstanceMetadataStore::registerInstalledMod(
            fixture.project,
            conflict,
            L"User Output",
            {},
            ModSourceRecord{});

        expectIntegrationErrorCode(
            [&fixture]
            {
                static_cast<void>(fixture.service.prepareLaunch(
                    fixture.config,
                    fixture.resolved(L"Conflict Name"),
                    L"Default"));
            },
            L"BODYSLIDE_OUTPUT_CONFLICT");
        EXPECT_TRUE(std::filesystem::exists(first.outputMod.path));
        EXPECT_TRUE(std::filesystem::exists(conflict / L"user.txt"));
    }
#endif
}
