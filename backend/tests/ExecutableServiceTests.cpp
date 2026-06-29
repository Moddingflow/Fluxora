#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <stdexcept>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora::tests
{
    namespace
    {
        void writeExecutableStub(const std::filesystem::path& path)
        {
            writeTextFile(path, "MZ executable stub");
        }

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
            if (size <= 0)
            {
                throw std::invalid_argument("Text could not be converted to UTF-8.");
            }

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

        std::wstring fromUtf8(const std::string& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0);
            if (size <= 0)
            {
                throw std::invalid_argument("Text is not valid UTF-8.");
            }

            std::wstring out(static_cast<std::size_t>(size), L'\0');
            MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size);
            return out;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        const InstalledModRecord* findInstalledMod(
            const std::vector<InstalledModRecord>& records,
            std::wstring_view folderName)
        {
            const auto match = std::find_if(
                records.begin(),
                records.end(),
                [folderName](const InstalledModRecord& record)
                {
                    return record.folderName == folderName;
                });
            return match == records.end() ? nullptr : &*match;
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

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheSkipsTransientRuntimeOutputs)
    {
        TempDirectory temp;
        const RootBuilderLaunchCacheTestProject paths = createRootBuilderLaunchCacheTestProject(temp);
        writeTextFile(paths.runtimeHigh / L"SKSE" / L"Plugins" / L"startup.log", "runtime log");
        writeTextFile(paths.runtimeHigh / L"SKSE" / L"Plugins" / L"startup.tmp", "runtime temp");
        writeTextFile(paths.skseMod / L"root" / L"skse64_loader.log", "loader log");

        const ResolvedExecutableLaunch resolved = resolveSkseExecutable(paths.config);

        ASSERT_FALSE(resolved.rootBuilderLaunchCacheDirectory.empty());
        const std::filesystem::path cachePlugins =
            resolved.rootBuilderLaunchCacheDirectory / L"Data" / L"SKSE" / L"Plugins";
        EXPECT_TRUE(std::filesystem::is_regular_file(cachePlugins / L"shared.dll"));
        EXPECT_FALSE(std::filesystem::exists(cachePlugins / L"startup.log"));
        EXPECT_FALSE(std::filesystem::exists(cachePlugins / L"startup.tmp"));
        EXPECT_FALSE(std::filesystem::exists(resolved.rootBuilderLaunchCacheDirectory / L"skse64_loader.log"));
    }

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheAppliesRootOverlaysWhenLaunchingGameRootExecutable)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Imported Build";
        const std::filesystem::path config = project / L"build.json";
        const std::filesystem::path game = project / L"Stock Game";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path engineFixes = mods / L"SSE Engine Fixes";

        writeExecutableStub(game / L"SkyrimSE.exe");
        std::filesystem::create_directories(game / L"Data");
        writeTextFile(game / L"d3dx9_42.dll", "stock-bad");
        writeTextFile(engineFixes / L"root" / L"d3dx9_42.dll", "mod-fixed");

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
            "\"launchExecutables\":[{"
            "\"id\":\"game\","
            "\"displayName\":\"Skyrim Special Edition\","
            "\"executablePath\":\"SkyrimSE.exe\","
            "\"arguments\":\"\","
            "\"workingDirectory\":\"\""
            "}]"
            "}");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{engineFixes, L"SSE Engine Fixes", {}, true, {}}});
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {ProfileOrderImportItemRecord{L"mod", L"SSE Engine Fixes", {}}});

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService iconService(logger);
        ExecutableService service(logger, iconService, pathSettings);

        const ResolvedExecutableLaunch resolved = service.resolveExecutable(config, L"game");

        ASSERT_FALSE(resolved.rootBuilderLaunchCacheDirectory.empty());
        EXPECT_EQ(
            normalized(resolved.resolvedExecutablePath),
            normalized(resolved.rootBuilderLaunchCacheDirectory / L"SkyrimSE.exe"));
        EXPECT_EQ(normalized(resolved.resolvedWorkingDirectory), normalized(resolved.rootBuilderLaunchCacheDirectory));
        EXPECT_EQ(readTextFile(resolved.rootBuilderLaunchCacheDirectory / L"d3dx9_42.dll"), "mod-fixed");
        EXPECT_EQ(readTextFile(game / L"d3dx9_42.dll"), "stock-bad");
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

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheUsesSealedManifestFastPathOnWarmResolve)
    {
        TempDirectory temp;
        const RootBuilderLaunchCacheTestProject paths = createRootBuilderLaunchCacheTestProject(temp);

        const ResolvedExecutableLaunch cold = resolveSkseExecutable(paths.config);

        ASSERT_FALSE(cold.rootBuilderLaunchCacheDirectory.empty());
        const std::filesystem::path manifest =
            cold.rootBuilderLaunchCacheDirectory / L".fluxora-root-launch-cache.json";
        ASSERT_TRUE(std::filesystem::is_regular_file(manifest));
        const std::string manifestText = readTextFile(manifest);
        ASSERT_NE(manifestText.find("\"sealed\":true"), std::string::npos);
        ASSERT_NE(manifestText.find("\"directories\":"), std::string::npos);

        std::error_code error;
        const auto oldTime =
            std::filesystem::file_time_type::clock::now() - std::chrono::hours(1);
        std::filesystem::last_write_time(manifest, oldTime, error);
        if (error)
        {
            GTEST_SKIP() << "Could not adjust launch cache manifest timestamp.";
        }

        const auto before = std::filesystem::last_write_time(manifest, error);
        ASSERT_FALSE(error);

        const ResolvedExecutableLaunch warm = resolveSkseExecutable(paths.config);

        EXPECT_EQ(
            normalized(warm.rootBuilderLaunchCacheDirectory),
            normalized(cold.rootBuilderLaunchCacheDirectory));
        EXPECT_EQ(
            normalized(warm.resolvedExecutablePath),
            normalized(cold.resolvedExecutablePath));
        EXPECT_EQ(std::filesystem::last_write_time(manifest), before);
    }

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheRefreshesAddedRuntimeFileAfterWarmManifestCheck)
    {
        TempDirectory temp;
        const RootBuilderLaunchCacheTestProject paths = createRootBuilderLaunchCacheTestProject(temp);

        const ResolvedExecutableLaunch cold = resolveSkseExecutable(paths.config);
        ASSERT_FALSE(cold.rootBuilderLaunchCacheDirectory.empty());

        const std::filesystem::path newPlugin =
            paths.runtimeHigh / L"SKSE" / L"Plugins" / L"late.dll";
        writeTextFile(newPlugin, "late");

        std::error_code error;
        std::filesystem::last_write_time(
            newPlugin.parent_path(),
            std::filesystem::file_time_type::clock::now() + std::chrono::hours(1),
            error);
        if (error)
        {
            GTEST_SKIP() << "Could not adjust runtime plugin directory timestamp.";
        }

        const ResolvedExecutableLaunch warm = resolveSkseExecutable(paths.config);

        EXPECT_EQ(
            normalized(warm.rootBuilderLaunchCacheDirectory),
            normalized(cold.rootBuilderLaunchCacheDirectory));
        EXPECT_EQ(
            readTextFile(warm.rootBuilderLaunchCacheDirectory / L"Data" / L"SKSE" / L"Plugins" / L"late.dll"),
            "late");
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

    TEST(ExecutableServiceTests, RootBuilderLaunchCacheParallelWarmValidationRefreshesChangedOverlayFile)
    {
        TempDirectory temp;
        const RootBuilderLaunchCacheTestProject paths = createRootBuilderLaunchCacheTestProject(temp);

        for (int index = 0; index < 96; ++index)
        {
            writeTextFile(
                paths.runtimeHigh / L"SKSE" / L"Plugins" /
                    (std::wstring(L"bulk-") + std::to_wstring(index) + L".dll"),
                "v1");
        }

        const ResolvedExecutableLaunch cold = resolveSkseExecutable(paths.config);
        ASSERT_FALSE(cold.rootBuilderLaunchCacheDirectory.empty());

        const std::filesystem::path changedSource =
            paths.runtimeHigh / L"SKSE" / L"Plugins" / L"bulk-73.dll";
        writeTextFile(changedSource, "v2");

        std::error_code error;
        std::filesystem::last_write_time(
            changedSource,
            std::filesystem::file_time_type::clock::now() + std::chrono::hours(1),
            error);
        if (error)
        {
            GTEST_SKIP() << "Could not adjust changed runtime DLL timestamp.";
        }

        const ResolvedExecutableLaunch warm = resolveSkseExecutable(paths.config);

        EXPECT_EQ(
            normalized(warm.rootBuilderLaunchCacheDirectory),
            normalized(cold.rootBuilderLaunchCacheDirectory));
        EXPECT_EQ(
            readTextFile(
                warm.rootBuilderLaunchCacheDirectory / L"Data" / L"SKSE" / L"Plugins" / L"bulk-73.dll"),
            "v2");
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

    TEST(ExecutableServiceTests, SkyrimParallaxGenResolvePreparesOutputModAndSettings)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Parallax Build";
        const std::filesystem::path config = project / L"build.json";
        const std::filesystem::path game = project / L"Stock Game";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path parallaxGenMod = mods / L"Parallax Gen";
        const std::filesystem::path parallaxGenRoot = parallaxGenMod / L"root";
        const std::filesystem::path parallaxGenExe = parallaxGenRoot / L"PGPatcher.exe";
        const std::filesystem::path parallaxGenSettings =
            parallaxGenRoot / L"cfg" / L"settings.json";
        const std::filesystem::path lowMeshes = mods / L"Low Meshes";
        const std::filesystem::path highMeshes = mods / L"High Meshes";

        writeExecutableStub(game / L"SkyrimSE.exe");
        std::filesystem::create_directories(game / L"Data");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        writeExecutableStub(parallaxGenExe);
        writeTextFile(lowMeshes / L"meshes" / L"shared.nif", "low");
        writeTextFile(highMeshes / L"meshes" / L"shared.nif", "high");
        writeTextFile(
            parallaxGenSettings,
            "{\"params\":{\"output\":{\"dir\":\"Old Output\",\"zip\":true},"
            "\"processing\":{\"multithread\":false}},\"custom\":true}");

        writeTextFile(
            config,
            "{"
            "\"schemaVersion\":\"1\","
            "\"name\":\"Parallax Build\","
            "\"templateId\":\"skyrimse\","
            "\"gameName\":\"Skyrim Special Edition\","
            "\"gamePath\":\"Stock Game\","
            "\"dataDirectory\":\"Data\","
            "\"defaultProfile\":\"Default\","
            "\"launchExecutables\":[{"
            "\"id\":\"pg\","
            "\"displayName\":\"PG Patcher\","
            "\"executablePath\":\"mods\\\\Parallax Gen\\\\root\\\\PGPatcher.exe\","
            "\"arguments\":\"\","
            "\"workingDirectory\":\"\""
            "}]"
            "}");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{parallaxGenMod, L"Parallax Gen", {}, true, {}},
                InstalledModImportRecord{lowMeshes, L"Low Meshes", {}, true, {}},
                InstalledModImportRecord{highMeshes, L"High Meshes", {}, true, {}}
            });
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Parallax Gen", {}},
                ProfileOrderImportItemRecord{L"mod", L"Low Meshes", {}},
                ProfileOrderImportItemRecord{L"mod", L"High Meshes", {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService iconService(logger);
        ExecutableService service(logger, iconService, pathSettings);

        const std::wstring expectedName = L"Parallax Build \x2014 ParallaxGen Output";
        const std::filesystem::path outputMod = mods / std::filesystem::path(expectedName);
        writeTextFile(outputMod / L".flow" / L"manifest.json", "{}");

        const ResolvedExecutableLaunch resolved = service.resolveExecutable(config, L"pg");

        EXPECT_TRUE(std::filesystem::is_directory(outputMod));
        EXPECT_FALSE(std::filesystem::exists(outputMod / L".flow"));
        EXPECT_TRUE(resolved.requiresParallaxGenMo2VfsCompatibilityFlag);
        EXPECT_EQ(resolved.commandLine.find(L"--ignore-mo2vfscheck"), std::wstring::npos);

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* record = findInstalledMod(records, expectedName);
        ASSERT_NE(record, nullptr);
        EXPECT_EQ(record->source.provider, L"generated-pgpatcher");
        InstanceMetadataStore::refreshInstalledModsFromDisk(project, mods);
        EXPECT_FALSE(std::filesystem::exists(outputMod / L".flow"));

        const std::vector<ProfileOrderItemRecord> order =
            InstanceMetadataStore::listCachedProfileOrderItems(project, L"Default", mods);
        ASSERT_GE(order.size(), 2U);
        EXPECT_EQ(order.back().mod.folderName, expectedName);
        EXPECT_EQ(order.back().mod.state, L"installed");

        const JsonValue settings = JsonReader::parse(fromUtf8(readTextFile(parallaxGenSettings)));
        const JsonValue* params = settings.find(L"params");
        ASSERT_NE(params, nullptr);
        const JsonValue* gameSettings = params->find(L"game");
        ASSERT_NE(gameSettings, nullptr);
        EXPECT_EQ(gameSettings->find(L"dir")->asString(), game.wstring());
        EXPECT_EQ(gameSettings->find(L"type")->asNumber(), L"0");
        const std::filesystem::path shadowMo2 =
            project / L".flow" / L"pgpatcher-mo2";
        const JsonValue* modManager = params->find(L"modmanager");
        ASSERT_NE(modManager, nullptr);
        EXPECT_EQ(modManager->find(L"type")->asNumber(), L"2");
        EXPECT_EQ(modManager->find(L"mo2instancedir")->asString(), shadowMo2.wstring());
        EXPECT_FALSE(modManager->find(L"mo2useloosefileorder")->asBoolean());
        const JsonValue* output = params->find(L"output");
        ASSERT_NE(output, nullptr);
        const JsonValue* dir = output->find(L"dir");
        ASSERT_NE(dir, nullptr);
        EXPECT_EQ(dir->asString(), outputMod.wstring());
        const JsonValue* zip = output->find(L"zip");
        ASSERT_NE(zip, nullptr);
        EXPECT_FALSE(zip->asBoolean());
        ASSERT_NE(settings.find(L"custom"), nullptr);

        ASSERT_FALSE(resolved.rootBuilderLaunchCacheDirectory.empty());
        const JsonValue cachedSettings = JsonReader::parse(fromUtf8(readTextFile(
            resolved.rootBuilderLaunchCacheDirectory / L"cfg" / L"settings.json")));
        EXPECT_EQ(
            cachedSettings.find(L"params")->find(L"output")->find(L"dir")->asString(),
            outputMod.wstring());
        EXPECT_EQ(
            cachedSettings.find(L"params")->find(L"modmanager")->find(L"mo2instancedir")->asString(),
            shadowMo2.wstring());

        const std::string mo2Ini = readTextFile(shadowMo2 / L"modorganizer.ini");
        EXPECT_NE(mo2Ini.find("base_directory="), std::string::npos);
        EXPECT_NE(mo2Ini.find("profiles_directory=%BASE_DIR%\\profiles"), std::string::npos);
        EXPECT_NE(mo2Ini.find("mod_directory=" + toUtf8(mods.wstring())), std::string::npos);
        EXPECT_NE(mo2Ini.find("selected_profile=Fluxora"), std::string::npos);
        EXPECT_NE(mo2Ini.find("gamePath=" + toUtf8(game.wstring())), std::string::npos);

        const std::string modList =
            readTextFile(shadowMo2 / L"profiles" / L"Fluxora" / L"modlist.txt");
        EXPECT_NE(
            modList.find("-" + toUtf8(expectedName) + "\n+High Meshes\n+Low Meshes\n+Parallax Gen\n"),
            std::string::npos);
    }

    TEST(ExecutableServiceTests, NonSkyrimParallaxGenResolveDoesNotPrepareOutputMod)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Unknown PG Build";
        const std::filesystem::path config = project / L"build.json";
        const std::filesystem::path game = project / L"Stock Game";
        const std::filesystem::path tools = project / L"tools";
        const std::filesystem::path parallaxGenExe = tools / L"PGPatcher.exe";
        const std::filesystem::path parallaxGenSettings = tools / L"cfg" / L"settings.json";

        writeExecutableStub(parallaxGenExe);
        writeTextFile(
            parallaxGenSettings,
            "{\"params\":{\"output\":{\"dir\":\"Old Output\",\"zip\":true}}}");

        writeTextFile(
            config,
            "{"
            "\"schemaVersion\":\"1\","
            "\"name\":\"Unknown PG Build\","
            "\"templateId\":\"unknown-game\","
            "\"gameName\":\"Unknown Game\","
            "\"gamePath\":\"Stock Game\","
            "\"defaultProfile\":\"Default\","
            "\"launchExecutables\":[{"
            "\"id\":\"pg\","
            "\"displayName\":\"PG Patcher\","
            "\"executablePath\":\"tools\\\\PGPatcher.exe\","
            "\"arguments\":\"\","
            "\"workingDirectory\":\"\""
            "}]"
            "}");
        std::filesystem::create_directories(game);

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        ExecutableIconService iconService(logger);
        ExecutableService service(logger, iconService, pathSettings);

        const ResolvedExecutableLaunch resolved = service.resolveExecutable(config, L"pg");

        EXPECT_TRUE(resolved.gameId.empty());
        EXPECT_FALSE(resolved.requiresParallaxGenMo2VfsCompatibilityFlag);
        EXPECT_FALSE(std::filesystem::exists(
            project / L"mods" / L"Unknown PG Build \x2014 ParallaxGen Output"));
        EXPECT_FALSE(std::filesystem::exists(project / L".flow" / L"pgpatcher-mo2"));

        const JsonValue settings = JsonReader::parse(fromUtf8(readTextFile(parallaxGenSettings)));
        const JsonValue* output = settings.find(L"params")->find(L"output");
        ASSERT_NE(output, nullptr);
        EXPECT_EQ(output->find(L"dir")->asString(), L"Old Output");
        EXPECT_TRUE(output->find(L"zip")->asBoolean());
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
