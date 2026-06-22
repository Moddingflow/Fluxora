#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    namespace
    {
        void writeExecutableStub(const std::filesystem::path& path)
        {
            writeTextFile(path, "MZ executable stub");
        }

        struct RootBuilderLaunchCacheTestProject
        {
            std::filesystem::path project;
            std::filesystem::path config;
            std::filesystem::path game;
            std::filesystem::path mods;
            std::filesystem::path overwrite;
            std::filesystem::path skseMod;
            std::filesystem::path runtimeLow;
            std::filesystem::path runtimeHigh;
        };

        RootBuilderLaunchCacheTestProject createRootBuilderLaunchCacheTestProject(TempDirectory& temp)
        {
            RootBuilderLaunchCacheTestProject paths{
                temp.path() / L"Imported Build",
                temp.path() / L"Imported Build" / L"build.json",
                temp.path() / L"Imported Build" / L"Stock Game",
                temp.path() / L"Imported Build" / L"mods",
                temp.path() / L"Imported Build" / L"overwrite",
                temp.path() / L"Imported Build" / L"mods" / L"Skyrim Script Extender",
                temp.path() / L"Imported Build" / L"mods" / L"Runtime Low",
                temp.path() / L"Imported Build" / L"mods" / L"Runtime High"
            };

            writeExecutableStub(paths.game / L"SkyrimSE.exe");
            std::filesystem::create_directories(paths.game / L"Data");
            writeExecutableStub(paths.skseMod / L"root" / L"skse64_loader.exe");
            writeTextFile(paths.runtimeLow / L"SKSE" / L"Plugins" / L"shared.dll", "low");
            writeTextFile(paths.runtimeHigh / L"SKSE" / L"Plugins" / L"shared.dll", "high");
            writeTextFile(paths.runtimeHigh / L"SKSE" / L"Plugins" / L"high-only.dll", "high-only");

            writeTextFile(
                paths.config,
                "{"
                "\"schemaVersion\":\"1\","
                "\"name\":\"Imported Build\","
                "\"templateId\":\"skyrimse\","
                "\"gameName\":\"Skyrim Special Edition\","
                "\"gamePath\":\"Stock Game\","
                "\"dataDirectory\":\"Data\","
                "\"defaultProfile\":\"Default\","
                "\"scriptExtender\":{\"name\":\"SKSE\",\"loaderExecutable\":\"skse64_loader.exe\",\"website\":\"\"},"
                "\"launchExecutables\":[{"
                "\"id\":\"skse\","
                "\"displayName\":\"SKSE\","
                "\"executablePath\":\"mods\\\\Skyrim Script Extender\\\\root\\\\skse64_loader.exe\","
                "\"arguments\":\"\","
                "\"workingDirectory\":\"\""
                "}]"
                "}");

            InstanceMetadataStore::ensureInstance(paths.project, L"skyrimse");
            InstanceMetadataStore::registerInstalledMods(
                paths.project,
                {
                    InstalledModImportRecord{paths.skseMod, L"Skyrim Script Extender", {}, true, {}},
                    InstalledModImportRecord{paths.runtimeLow, L"Runtime Low", {}, true, {}},
                    InstalledModImportRecord{paths.runtimeHigh, L"Runtime High", {}, true, {}}
                });
            InstanceMetadataStore::replaceProfileOrderItems(
                paths.project,
                L"Default",
                {
                    ProfileOrderImportItemRecord{L"mod", L"Skyrim Script Extender", {}},
                    ProfileOrderImportItemRecord{L"mod", L"Runtime Low", {}},
                    ProfileOrderImportItemRecord{L"mod", L"Runtime High", {}}
                });

            return paths;
        }

        ResolvedExecutableLaunch resolveSkseExecutable(const std::filesystem::path& config)
        {
            Logger logger;
            BuildPathSettingsService pathSettings(logger);
            ExecutableIconService iconService(logger);
            ExecutableService service(logger, iconService, pathSettings);
            return service.resolveExecutable(config, L"skse");
        }

#ifdef _WIN32
        class ScopedReadLockedFile final
        {
        public:
            explicit ScopedReadLockedFile(const std::filesystem::path& path)
                : handle_(CreateFileW(
                      path.c_str(),
                      GENERIC_READ,
                      FILE_SHARE_READ,
                      nullptr,
                      OPEN_EXISTING,
                      FILE_ATTRIBUTE_NORMAL,
                      nullptr))
            {
            }

            ScopedReadLockedFile(const ScopedReadLockedFile&) = delete;
            ScopedReadLockedFile& operator=(const ScopedReadLockedFile&) = delete;

            ~ScopedReadLockedFile()
            {
                if (valid())
                {
                    CloseHandle(handle_);
                }
            }

            [[nodiscard]] bool valid() const noexcept
            {
                return handle_ != INVALID_HANDLE_VALUE;
            }

        private:
            HANDLE handle_{INVALID_HANDLE_VALUE};
        };
#endif
    }

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheMaterializesEarlyDataRuntimeDirectories)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Imported Build";
        const std::filesystem::path config = project / L"build.json";
        const std::filesystem::path game = project / L"Stock Game";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path overwrite = project / L"overwrite";

        writeExecutableStub(game / L"SkyrimSE.exe");
        std::filesystem::create_directories(game / L"Data");

        const std::filesystem::path skseMod = mods / L"Skyrim Script Extender";
        const std::filesystem::path runtimeLow = mods / L"Runtime Low";
        const std::filesystem::path runtimeHigh = mods / L"Runtime High";
        writeExecutableStub(skseMod / L"root" / L"skse64_loader.exe");
        writeTextFile(runtimeLow / L"SKSE" / L"Plugins" / L"shared.dll", "low");
        writeTextFile(runtimeLow / L"Interface" / L"not-early.swf", "not copied");
        writeTextFile(runtimeHigh / L"SKSE" / L"Plugins" / L"shared.dll", "high");
        writeTextFile(runtimeHigh / L"DLLPlugins" / L"meh-loader.dll", "meh");
        writeTextFile(runtimeHigh / L"Data" / L"NetScriptFramework" / L"Plugins" / L"net.dll", "net");
        writeTextFile(overwrite / L"SKSE" / L"Plugins" / L"overwrite-only.dll", "overwrite");

        writeTextFile(
            config,
            "{"
            "\"schemaVersion\":\"1\","
            "\"name\":\"Imported Build\","
            "\"templateId\":\"skyrimse\","
            "\"gameName\":\"Skyrim Special Edition\","
            "\"gamePath\":\"Stock Game\","
            "\"dataDirectory\":\"Data\","
            "\"defaultProfile\":\"Default\","
            "\"scriptExtender\":{\"name\":\"SKSE\",\"loaderExecutable\":\"skse64_loader.exe\",\"website\":\"\"},"
            "\"launchExecutables\":[{"
            "\"id\":\"skse\","
            "\"displayName\":\"SKSE\","
            "\"executablePath\":\"mods\\\\Skyrim Script Extender\\\\root\\\\skse64_loader.exe\","
            "\"arguments\":\"\","
            "\"workingDirectory\":\"\""
            "}]"
            "}");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{skseMod, L"Skyrim Script Extender", {}, true, {}},
                InstalledModImportRecord{runtimeLow, L"Runtime Low", {}, true, {}},
                InstalledModImportRecord{runtimeHigh, L"Runtime High", {}, true, {}}
            });
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Skyrim Script Extender", {}},
                ProfileOrderImportItemRecord{L"mod", L"Runtime Low", {}},
                ProfileOrderImportItemRecord{L"mod", L"Runtime High", {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService iconService(logger);
        ExecutableService service(logger, iconService, pathSettings);

        const ResolvedExecutableLaunch resolved = service.resolveExecutable(config, L"skse");

        ASSERT_FALSE(resolved.rootBuilderLaunchCacheDirectory.empty());
        const std::filesystem::path cacheData = resolved.rootBuilderLaunchCacheDirectory / L"Data";
        EXPECT_TRUE(std::filesystem::is_regular_file(cacheData / L"SKSE" / L"Plugins" / L"shared.dll"));
        EXPECT_EQ(readTextFile(cacheData / L"SKSE" / L"Plugins" / L"shared.dll"), "high");
        EXPECT_TRUE(std::filesystem::is_regular_file(cacheData / L"SKSE" / L"Plugins" / L"overwrite-only.dll"));
        EXPECT_TRUE(std::filesystem::is_regular_file(cacheData / L"DLLPlugins" / L"meh-loader.dll"));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            cacheData / L"NetScriptFramework" / L"Plugins" / L"net.dll"));
        EXPECT_FALSE(std::filesystem::exists(cacheData / L"Interface" / L"not-early.swf"));
    }

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheSkipsUnchangedFilesOnWarmResolve)
    {
        TempDirectory temp;
        const RootBuilderLaunchCacheTestProject paths = createRootBuilderLaunchCacheTestProject(temp);

        const ResolvedExecutableLaunch cold = resolveSkseExecutable(paths.config);

        ASSERT_FALSE(cold.rootBuilderLaunchCacheDirectory.empty());
        const std::filesystem::path cachedLoader =
            cold.rootBuilderLaunchCacheDirectory / L"skse64_loader.exe";
        ASSERT_TRUE(std::filesystem::is_regular_file(cachedLoader));

#ifdef _WIN32
        ScopedReadLockedFile lockedLoader(cachedLoader);
        if (!lockedLoader.valid())
        {
            GTEST_SKIP() << "Could not lock cached loader for warm-cache assertion.";
        }
#endif

        const ResolvedExecutableLaunch warm = resolveSkseExecutable(paths.config);

        EXPECT_EQ(
            normalized(warm.rootBuilderLaunchCacheDirectory),
            normalized(cold.rootBuilderLaunchCacheDirectory));
        EXPECT_EQ(normalized(warm.resolvedExecutablePath), normalized(cachedLoader));
        EXPECT_EQ(readTextFile(cachedLoader), "MZ executable stub");
        EXPECT_EQ(
            readTextFile(
                warm.rootBuilderLaunchCacheDirectory / L"Data" / L"SKSE" / L"Plugins" / L"shared.dll"),
            "high");
    }

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheRefreshesChangedOverlayFileInPlace)
    {
        TempDirectory temp;
        const RootBuilderLaunchCacheTestProject paths = createRootBuilderLaunchCacheTestProject(temp);

        const ResolvedExecutableLaunch cold = resolveSkseExecutable(paths.config);
        ASSERT_FALSE(cold.rootBuilderLaunchCacheDirectory.empty());
        const std::filesystem::path cachedShared =
            cold.rootBuilderLaunchCacheDirectory / L"Data" / L"SKSE" / L"Plugins" / L"shared.dll";
        ASSERT_EQ(readTextFile(cachedShared), "high");

        writeTextFile(paths.runtimeHigh / L"SKSE" / L"Plugins" / L"shared.dll", "high-v2");

        const ResolvedExecutableLaunch warm = resolveSkseExecutable(paths.config);

        EXPECT_EQ(
            normalized(warm.rootBuilderLaunchCacheDirectory),
            normalized(cold.rootBuilderLaunchCacheDirectory));
        EXPECT_EQ(readTextFile(cachedShared), "high-v2");
        EXPECT_EQ(
            readTextFile(warm.rootBuilderLaunchCacheDirectory / L"skse64_loader.exe"),
            "MZ executable stub");
    }

    TEST(ExecutableServiceTests, RootBuilderLaunchCachePrunesDisabledModFilesAndRestoresLowerPriorityOverlay)
    {
        TempDirectory temp;
        const RootBuilderLaunchCacheTestProject paths = createRootBuilderLaunchCacheTestProject(temp);

        const ResolvedExecutableLaunch cold = resolveSkseExecutable(paths.config);
        ASSERT_FALSE(cold.rootBuilderLaunchCacheDirectory.empty());
        const std::filesystem::path cachePlugins =
            cold.rootBuilderLaunchCacheDirectory / L"Data" / L"SKSE" / L"Plugins";
        ASSERT_EQ(readTextFile(cachePlugins / L"shared.dll"), "high");
        ASSERT_TRUE(std::filesystem::is_regular_file(cachePlugins / L"high-only.dll"));

        InstanceMetadataStore::setInstalledModEnabled(paths.project, paths.runtimeHigh, false);

        const ResolvedExecutableLaunch warm = resolveSkseExecutable(paths.config);

        EXPECT_EQ(
            normalized(warm.rootBuilderLaunchCacheDirectory),
            normalized(cold.rootBuilderLaunchCacheDirectory));
        EXPECT_EQ(readTextFile(cachePlugins / L"shared.dll"), "low");
        EXPECT_FALSE(std::filesystem::exists(cachePlugins / L"high-only.dll"));
    }

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheRefreshesChangedLoadOrderWinner)
    {
        TempDirectory temp;
        const RootBuilderLaunchCacheTestProject paths = createRootBuilderLaunchCacheTestProject(temp);

        const ResolvedExecutableLaunch cold = resolveSkseExecutable(paths.config);
        ASSERT_FALSE(cold.rootBuilderLaunchCacheDirectory.empty());
        const std::filesystem::path cachedShared =
            cold.rootBuilderLaunchCacheDirectory / L"Data" / L"SKSE" / L"Plugins" / L"shared.dll";
        ASSERT_EQ(readTextFile(cachedShared), "high");

        InstanceMetadataStore::replaceProfileOrderItems(
            paths.project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Skyrim Script Extender", {}},
                ProfileOrderImportItemRecord{L"mod", L"Runtime High", {}},
                ProfileOrderImportItemRecord{L"mod", L"Runtime Low", {}}
            });

        const ResolvedExecutableLaunch warm = resolveSkseExecutable(paths.config);

        EXPECT_EQ(
            normalized(warm.rootBuilderLaunchCacheDirectory),
            normalized(cold.rootBuilderLaunchCacheDirectory));
        EXPECT_EQ(readTextFile(cachedShared), "low");
    }

    TEST(ExecutableServiceTests, SkyrimScriptExtenderLaunchMetadataComesFromDefinitionRules)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Launch Metadata Build";
        const std::filesystem::path config = project / L"build.json";
        const std::filesystem::path game = project / L"Stock Game";

        writeExecutableStub(game / L"SkyrimSE.exe");
        writeExecutableStub(game / L"skse64_loader.exe");
        std::filesystem::create_directories(game / L"Data");

        writeTextFile(
            config,
            "{"
            "\"schemaVersion\":\"1\","
            "\"name\":\"Launch Metadata Build\","
            "\"templateId\":\"skyrimse\","
            "\"gameName\":\"Skyrim Special Edition\","
            "\"gamePath\":\"Stock Game\","
            "\"dataDirectory\":\"Data\","
            "\"defaultProfile\":\"Default\","
            "\"launchExecutables\":[{"
            "\"id\":\"skse\","
            "\"displayName\":\"SKSE\","
            "\"executablePath\":\"skse64_loader.exe\","
            "\"arguments\":\"\","
            "\"workingDirectory\":\"\""
            "}]"
            "}");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService iconService(logger);
        ExecutableService service(logger, iconService, pathSettings);

        const ResolvedExecutableLaunch resolved = service.resolveExecutable(config, L"skse");

        EXPECT_EQ(normalized(resolved.resolvedExecutablePath), normalized(game / L"skse64_loader.exe"));
        EXPECT_EQ(normalized(resolved.resolvedWorkingDirectory), normalized(game));
        EXPECT_EQ(resolved.launchTrackingKind, LaunchTrackingKind::ExpectedChildProcess);
        ASSERT_EQ(resolved.expectedChildProcessNames.size(), 1U);
        EXPECT_EQ(resolved.expectedChildProcessNames.front(), L"SkyrimSE.exe");
        EXPECT_EQ(resolved.handoffDisplayName, L"Skyrim Special Edition");
        EXPECT_EQ(resolved.handoffTimeoutMs, 30000U);
    }

    TEST(ExecutableServiceTests, UnknownTemplateUsesDirectLaunchWithoutSkyrimRules)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Unknown Game Build";
        const std::filesystem::path config = project / L"build.json";
        const std::filesystem::path game = project / L"Stock Game";

        writeExecutableStub(game / L"tool_loader.exe");

        writeTextFile(
            config,
            "{"
            "\"schemaVersion\":\"1\","
            "\"name\":\"Unknown Game Build\","
            "\"templateId\":\"unknown-game\","
            "\"gameName\":\"Unknown Game\","
            "\"gamePath\":\"Stock Game\","
            "\"defaultProfile\":\"Default\","
            "\"launchExecutables\":[{"
            "\"id\":\"tool\","
            "\"displayName\":\"Tool Loader\","
            "\"executablePath\":\"tool_loader.exe\","
            "\"arguments\":\"\","
            "\"workingDirectory\":\"\""
            "}]"
            "}");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService iconService(logger);
        ExecutableService service(logger, iconService, pathSettings);

        const ResolvedExecutableLaunch resolved = service.resolveExecutable(config, L"tool");

        EXPECT_TRUE(resolved.gameId.empty());
        EXPECT_EQ(resolved.templateId, L"unknown-game");
        EXPECT_EQ(resolved.launchTrackingKind, LaunchTrackingKind::DirectProcess);
        EXPECT_TRUE(resolved.expectedChildProcessNames.empty());
        EXPECT_TRUE(resolved.handoffDisplayName.empty());
        EXPECT_EQ(resolved.handoffTimeoutMs, 0U);
        EXPECT_FALSE(resolved.vfsRules.has_value());
        EXPECT_FALSE(resolved.contentLayoutRules.has_value());
    }

    TEST(ExecutableServiceTests, LegacyScriptExtenderManifestFieldDoesNotDriveUnknownTemplate)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Legacy Unknown Build";
        const std::filesystem::path config = project / L"build.json";
        const std::filesystem::path game = project / L"Stock Game";
        const std::filesystem::path modLoader = project / L"mods" / L"Tool" / L"root" / L"skse64_loader.exe";

        writeExecutableStub(game / L"skse64_loader.exe");
        writeExecutableStub(modLoader);

        writeTextFile(
            config,
            "{"
            "\"schemaVersion\":\"1\","
            "\"name\":\"Legacy Unknown Build\","
            "\"templateId\":\"unknown-game\","
            "\"gameName\":\"Unknown Game\","
            "\"gamePath\":\"Stock Game\","
            "\"defaultProfile\":\"Default\","
            "\"scriptExtender\":{\"name\":\"Legacy SE\",\"loaderExecutable\":\"skse64_loader.exe\",\"website\":\"\"},"
            "\"launchExecutables\":[{"
            "\"id\":\"tool\","
            "\"displayName\":\"Tool Loader\","
            "\"executablePath\":\"mods\\\\Tool\\\\root\\\\skse64_loader.exe\","
            "\"arguments\":\"\","
            "\"workingDirectory\":\"\""
            "}]"
            "}");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService iconService(logger);
        ExecutableService service(logger, iconService, pathSettings);

        const ResolvedExecutableLaunch resolved = service.resolveExecutable(config, L"tool");

        EXPECT_EQ(normalized(resolved.resolvedExecutablePath), normalized(modLoader));
        EXPECT_EQ(resolved.launchTrackingKind, LaunchTrackingKind::DirectProcess);
        EXPECT_TRUE(resolved.expectedChildProcessNames.empty());
        EXPECT_TRUE(resolved.handoffDisplayName.empty());
        EXPECT_EQ(resolved.handoffTimeoutMs, 0U);
    }

#ifdef _WIN32
    TEST(ExecutableServiceTests, RootBuilderLaunchCacheRefusesPreexistingJunction)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Imported Build";
        const std::filesystem::path config = project / L"build.json";
        const std::filesystem::path game = project / L"Stock Game";
        const std::filesystem::path mods = project / L"mods";

        writeExecutableStub(game / L"SkyrimSE.exe");
        std::filesystem::create_directories(game / L"Data");

        const std::filesystem::path skseMod = mods / L"Skyrim Script Extender";
        const std::filesystem::path skseLoader = skseMod / L"root" / L"skse64_loader.exe";
        writeExecutableStub(skseLoader);

        writeTextFile(
            config,
            "{"
            "\"schemaVersion\":\"1\","
            "\"name\":\"Imported Build\","
            "\"templateId\":\"skyrimse\","
            "\"gameName\":\"Skyrim Special Edition\","
            "\"gamePath\":\"Stock Game\","
            "\"dataDirectory\":\"Data\","
            "\"defaultProfile\":\"Default\","
            "\"scriptExtender\":{\"name\":\"SKSE\",\"loaderExecutable\":\"skse64_loader.exe\",\"website\":\"\"},"
            "\"launchExecutables\":[{"
            "\"id\":\"skse\","
            "\"displayName\":\"SKSE\","
            "\"executablePath\":\"mods\\\\Skyrim Script Extender\\\\root\\\\skse64_loader.exe\","
            "\"arguments\":\"\","
            "\"workingDirectory\":\"\""
            "}]"
            "}");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{skseMod, L"Skyrim Script Extender", {}, true, {}}});
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {ProfileOrderImportItemRecord{L"mod", L"Skyrim Script Extender", {}}});

        const std::filesystem::path outside = temp.path() / L"outside-cache-target";
        writeTextFile(outside / L"sentinel.txt", "keep");

        const std::filesystem::path cacheParent = project / L".flow" / L"root-launch";
        std::filesystem::create_directories(cacheParent);
        const std::filesystem::path cacheRoot = cacheParent / L"Skyrim_Script_Extender";

        std::error_code junctionError;
        if (!createDirectoryJunction(outside, cacheRoot, junctionError))
        {
            GTEST_SKIP() << "Directory junction creation is not available: " << junctionError.message();
        }

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService iconService(logger);
        ExecutableService service(logger, iconService, pathSettings);

        const ResolvedExecutableLaunch resolved = service.resolveExecutable(config, L"skse");

        EXPECT_TRUE(resolved.rootBuilderLaunchCacheDirectory.empty());
        EXPECT_EQ(normalized(resolved.resolvedExecutablePath), normalized(skseLoader));
        EXPECT_EQ(readTextFile(outside / L"sentinel.txt"), "keep");
        EXPECT_FALSE(std::filesystem::exists(outside / L"skse64_loader.exe"));

        std::filesystem::remove(cacheRoot);
    }
#endif
}
