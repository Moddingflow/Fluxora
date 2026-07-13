#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora::tests
{
    namespace
    {
        constexpr std::wstring_view outputFolderName = L"PGPatcher Output";

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

        void writeExecutableStub(const std::filesystem::path& path)
        {
            writeTextFile(path, "MZ executable stub");
        }

        struct PgPatcherProject
        {
            std::filesystem::path project;
            std::filesystem::path config;
            std::filesystem::path game;
            std::filesystem::path mods;
            std::filesystem::path patcherMod;
            std::filesystem::path patcherExecutable;
            std::filesystem::path settings;
            std::filesystem::path enabledInput;
            std::filesystem::path disabledInput;
        };

        PgPatcherProject createProject(
            const std::filesystem::path& project,
            std::wstring_view buildName = L"PGPatcher Test Build",
            std::wstring_view executableFileName = L"PGPatcher.exe",
            std::wstring_view executableId = L"pg",
            std::wstring_view displayName = L"PG Patcher",
            std::wstring_view templateId = L"skyrimse",
            std::wstring_view defaultProfile = L"Default")
        {
            PgPatcherProject paths{
                project,
                project / L"build.json",
                project / L"Stock Game",
                project / L"mods",
                project / L"mods" / L"Parallax Gen",
                project / L"mods" / L"Parallax Gen" / L"root" /
                    std::filesystem::path(executableFileName),
                project / L"mods" / L"Parallax Gen" / L"root" / L"cfg" / L"settings.json",
                project / L"mods" / L"Enabled Input",
                project / L"mods" / L"Disabled Input"
            };

            writeExecutableStub(paths.game / L"SkyrimSE.exe");
            writeTextFile(paths.game / L"Data" / L"Skyrim.esm", "master");
            writeExecutableStub(paths.patcherExecutable);
            writeTextFile(paths.enabledInput / L"meshes" / L"enabled.nif", "enabled");
            writeTextFile(paths.disabledInput / L"meshes" / L"disabled.nif", "disabled");

            JsonWriter manifest;
            manifest.beginObject()
                .field(L"schemaVersion", L"1")
                .field(L"name", buildName)
                .field(L"templateId", templateId)
                .field(L"gameName", L"Skyrim Special Edition")
                .field(L"gamePath", L"Stock Game")
                .field(L"dataDirectory", L"Data")
                .field(L"defaultProfile", defaultProfile)
                .key(L"launchExecutables")
                .beginArray()
                .beginObject()
                .field(L"id", executableId)
                .field(L"displayName", displayName)
                .field(
                    L"executablePath",
                    std::wstring(L"mods\\Parallax Gen\\root\\") +
                        std::wstring(executableFileName))
                .field(L"arguments", L"")
                .field(L"workingDirectory", L"")
                .endObject()
                .endArray()
                .endObject();
            writeTextFile(paths.config, toUtf8(manifest.str()));

            InstanceMetadataStore::ensureInstance(
                paths.project,
                templateId == L"skyrimse" ? L"skyrimse" : L"");
            InstanceMetadataStore::registerInstalledMods(
                paths.project,
                {
                    InstalledModImportRecord{paths.patcherMod, L"Parallax Gen", {}, true, {}},
                    InstalledModImportRecord{paths.enabledInput, L"Enabled Input", {}, true, {}},
                    InstalledModImportRecord{paths.disabledInput, L"Disabled Input", {}, false, {}}
                });
            InstanceMetadataStore::replaceProfileOrderItems(
                paths.project,
                defaultProfile.empty() ? L"Default" : defaultProfile,
                {
                    ProfileOrderImportItemRecord{L"mod", L"Parallax Gen", {}},
                    ProfileOrderImportItemRecord{L"mod", L"Enabled Input", {}},
                    ProfileOrderImportItemRecord{L"mod", L"Disabled Input", {}}
                });
            return paths;
        }

        ResolvedExecutableLaunch resolve(
            const PgPatcherProject& project,
            std::wstring_view executableId = L"pg",
            std::wstring_view profileName = {})
        {
            Logger logger;
            BuildPathSettingsService pathSettings(logger);
            ExecutableIconService iconService(logger);
            ExecutableService service(logger, iconService, pathSettings);
            return service.resolveExecutable(project.config, executableId, profileName);
        }

        std::filesystem::path outputPath(const PgPatcherProject& project)
        {
            return project.mods / std::filesystem::path(outputFolderName);
        }

        bool containsLaunchMod(
            const std::vector<ExecutableLaunchMod>& mods,
            const std::filesystem::path& path)
        {
            return std::any_of(
                mods.begin(),
                mods.end(),
                [&path](const ExecutableLaunchMod& mod)
                {
                    return normalized(mod.path) == normalized(path);
                });
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

        std::size_t outputOrderItemCount(const PgPatcherProject& project, std::wstring_view profile)
        {
            const std::vector<ProfileOrderItemRecord> order =
                InstanceMetadataStore::listCachedProfileOrderItems(
                    project.project,
                    profile,
                    project.mods);
            return static_cast<std::size_t>(std::count_if(
                order.begin(),
                order.end(),
                [](const ProfileOrderItemRecord& item)
                {
                    return item.kind == L"mod" &&
                        item.hasMod &&
                        item.mod.folderName == outputFolderName;
                }));
        }

        struct BuildNameCase
        {
            std::wstring name;
            std::string label;
        };

        std::vector<BuildNameCase> buildNameCases()
        {
            return {
                {L"Normal Build", "Normal"},
                {L"Foundation: Edition?", "ColonAndQuestion"},
                {L"CON", "ReservedCon"},
                {L"NUL", "ReservedNul"},
                {L"Build.", "TrailingDot"},
                {L"Build ", "TrailingSpace"},
                {L"<>:\"/\\|?*", "EveryInvalidPathCharacter"},
                {L"Сборка с модами", "Cyrillic"},
                {L"Übergrößenträger", "GermanUnicode"},
                {L"日本語ビルド", "JapaneseUnicode"},
                {L"Quoted \"Build\"", "QuotedJson"},
                {L"Back\\slash Build", "BackslashJson"},
                {L"", "Empty"},
                {std::wstring(240, L'X'), "VeryLong"}
            };
        }

        class PgPatcherBuildNameTest : public testing::TestWithParam<BuildNameCase>
        {
        protected:
            TempDirectory temp_;
        };

        struct PatcherIdentityCase
        {
            std::wstring executableFileName;
            std::wstring executableId;
            std::wstring displayName;
            std::string label;
        };

        std::vector<PatcherIdentityCase> patcherIdentityCases()
        {
            return {
                {L"PGPatcher.exe", L"tool", L"Tool", "PgPatcherFile"},
                {L"ParallaxGen.exe", L"tool", L"Tool", "ParallaxGenFile"},
                {L"PG.exe", L"tool", L"Tool", "PgFile"},
                {L"Tool.exe", L"tool", L"Parallax Gen", "ParallaxGenDisplay"},
                {L"Tool.exe", L"tool", L"ParallaxGen", "CompactParallaxGenDisplay"},
                {L"Tool.exe", L"tool", L"PG Patcher", "PgPatcherDisplay"},
                {L"Tool.exe", L"tool", L"PGPatcher", "CompactPgPatcherDisplay"},
                {L"Tool.exe", L"tool", L"PG", "PgDisplay"},
                {L"Tool.exe", L"parallaxgen", L"Tool", "ParallaxGenId"},
                {L"Tool.exe", L"pgpatcher", L"Tool", "PgPatcherId"}
            };
        }

        class PgPatcherIdentityTest : public testing::TestWithParam<PatcherIdentityCase>
        {
        protected:
            TempDirectory temp_;
        };
    }

    TEST_P(PgPatcherBuildNameTest, UsesStableOutputFolderIndependentOfBuildName)
    {
        const BuildNameCase& testCase = GetParam();
        const PgPatcherProject project = createProject(
            temp_.path() / L"Build Under Test",
            testCase.name);

        const ResolvedExecutableLaunch resolved = resolve(project);

        EXPECT_TRUE(std::filesystem::is_directory(outputPath(project)));
        EXPECT_TRUE(resolved.requiresParallaxGenMo2VfsCompatibilityFlag);
        EXPECT_FALSE(containsLaunchMod(resolved.activeProfileMods, outputPath(project)));
        const JsonValue settings = JsonReader::parse(fromUtf8(readTextFile(project.settings)));
        EXPECT_EQ(
            settings.find(L"params")->find(L"output")->find(L"dir")->asString(),
            outputPath(project).wstring());
    }

    INSTANTIATE_TEST_SUITE_P(
        EveryBuildName,
        PgPatcherBuildNameTest,
        testing::ValuesIn(buildNameCases()),
        [](const testing::TestParamInfo<BuildNameCase>& info)
        {
            return info.param.label;
        });

    TEST_P(PgPatcherIdentityTest, RecognizesSupportedPatcherIdentity)
    {
        const PatcherIdentityCase& testCase = GetParam();
        const PgPatcherProject project = createProject(
            temp_.path() / L"Identity Build",
            L"Identity Build",
            testCase.executableFileName,
            testCase.executableId,
            testCase.displayName);

        const ResolvedExecutableLaunch resolved = resolve(project, testCase.executableId);

        EXPECT_TRUE(std::filesystem::is_directory(outputPath(project)));
        EXPECT_TRUE(resolved.requiresParallaxGenMo2VfsCompatibilityFlag);
    }

    INSTANTIATE_TEST_SUITE_P(
        EverySupportedIdentity,
        PgPatcherIdentityTest,
        testing::ValuesIn(patcherIdentityCases()),
        [](const testing::TestParamInfo<PatcherIdentityCase>& info)
        {
            return info.param.label;
        });

    TEST(PgPatcherExecutableServiceTests, SimilarToolNameDoesNotCreateOutput)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(
            temp.path() / L"Similar Tool Build",
            L"Similar Tool Build",
            L"PGPatcherHelper.exe",
            L"pg-tools",
            L"PG Tools");

        const ResolvedExecutableLaunch resolved = resolve(project, L"pg-tools");

        EXPECT_FALSE(std::filesystem::exists(outputPath(project)));
        EXPECT_FALSE(resolved.requiresParallaxGenMo2VfsCompatibilityFlag);
    }

    TEST(PgPatcherExecutableServiceTests, ExistingGeneratedFilesArePreservedAndPortableMetadataIsRemoved)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Existing Output Build");
        const std::filesystem::path generatedMesh = outputPath(project) / L"meshes" / L"generated.nif";
        writeTextFile(generatedMesh, "generated");
        writeTextFile(outputPath(project) / L".flow" / L"manifest.json", "stale");

        resolve(project);

        EXPECT_EQ(readTextFile(generatedMesh), "generated");
        EXPECT_FALSE(std::filesystem::exists(outputPath(project) / L".flow"));
    }

    TEST(PgPatcherExecutableServiceTests, ExistingFileAtOutputPathFailsWithoutDeletingIt)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Occupied Output Build");
        writeTextFile(outputPath(project), "keep me");

        EXPECT_THROW(resolve(project), std::invalid_argument);
        EXPECT_EQ(readTextFile(outputPath(project)), "keep me");
    }

    TEST(PgPatcherExecutableServiceTests, MissingSettingsFileIsCreatedWithRequiredPatcherValues)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Missing Settings Build");
        ASSERT_FALSE(std::filesystem::exists(project.settings));

        const ResolvedExecutableLaunch resolved = resolve(project);

        const JsonValue settings = JsonReader::parse(fromUtf8(readTextFile(project.settings)));
        const JsonValue* params = settings.find(L"params");
        ASSERT_NE(params, nullptr);
        EXPECT_EQ(params->find(L"game")->find(L"dir")->asString(), project.game.wstring());
        EXPECT_EQ(params->find(L"game")->find(L"type")->asNumber(), L"0");
        EXPECT_EQ(params->find(L"modmanager")->find(L"type")->asNumber(), L"2");
        EXPECT_FALSE(params->find(L"modmanager")->find(L"mo2useloosefileorder")->asBoolean());
        EXPECT_EQ(params->find(L"output")->find(L"dir")->asString(), outputPath(project).wstring());
        EXPECT_FALSE(params->find(L"output")->find(L"zip")->asBoolean());
        EXPECT_TRUE(std::filesystem::exists(
            resolved.rootBuilderLaunchCacheDirectory / L"cfg" / L"settings.json"));
    }

    TEST(PgPatcherExecutableServiceTests, ExistingSettingsKeepUnrelatedAndNestedValues)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Preserved Settings Build");
        writeTextFile(
            project.settings,
            "{\"custom\":true,\"params\":{"
            "\"processing\":{\"multithread\":false},"
            "\"output\":{\"dir\":\"old\",\"zip\":true,\"mapFromMeshes\":true},"
            "\"modmanager\":{\"portable\":true}}}");

        resolve(project);

        const JsonValue settings = JsonReader::parse(fromUtf8(readTextFile(project.settings)));
        const JsonValue* params = settings.find(L"params");
        EXPECT_TRUE(settings.find(L"custom")->asBoolean());
        EXPECT_FALSE(params->find(L"processing")->find(L"multithread")->asBoolean());
        EXPECT_TRUE(params->find(L"output")->find(L"mapFromMeshes")->asBoolean());
        EXPECT_EQ(params->find(L"output")->find(L"dir")->asString(), outputPath(project).wstring());
        EXPECT_FALSE(params->find(L"output")->find(L"zip")->asBoolean());
        EXPECT_TRUE(params->find(L"modmanager")->find(L"portable")->asBoolean());
    }

    TEST(PgPatcherExecutableServiceTests, MalformedSettingsDoNotBlockLaunchResolutionOrGetOverwritten)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Malformed Settings Build");
        writeTextFile(project.settings, "{ definitely not json");

        const ResolvedExecutableLaunch resolved = resolve(project);

        EXPECT_TRUE(resolved.requiresParallaxGenMo2VfsCompatibilityFlag);
        EXPECT_EQ(readTextFile(project.settings), "{ definitely not json");
        EXPECT_TRUE(std::filesystem::is_directory(outputPath(project)));
    }

    TEST(PgPatcherExecutableServiceTests, OutputIsRegisteredOnceAndNeverBecomesAnInputMod)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Repeated Resolve Build");

        const ResolvedExecutableLaunch first = resolve(project);
        const ResolvedExecutableLaunch second = resolve(project);

        EXPECT_EQ(outputOrderItemCount(project, L"Default"), 1U);
        EXPECT_FALSE(containsLaunchMod(first.activeProfileMods, outputPath(project)));
        EXPECT_FALSE(containsLaunchMod(second.activeProfileMods, outputPath(project)));
        EXPECT_EQ(first.activeProfileMods.size(), second.activeProfileMods.size());
    }

    TEST(PgPatcherExecutableServiceTests, OutputRecordUsesGeneratedProviderWithoutPortableManifest)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Provider Build");

        resolve(project);

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project.project, project.mods);
        const InstalledModRecord* output = findInstalledMod(records, outputFolderName);
        ASSERT_NE(output, nullptr);
        EXPECT_EQ(output->source.provider, L"generated-pgpatcher");
        EXPECT_FALSE(std::filesystem::exists(outputPath(project) / L".flow" / L"manifest.json"));
    }

    TEST(PgPatcherExecutableServiceTests, ModListDisablesOutputAndDisabledInputsWhileSnapshotExcludesBoth)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Profile Inputs Build");

        const ResolvedExecutableLaunch resolved = resolve(project);

        EXPECT_TRUE(containsLaunchMod(resolved.activeProfileMods, project.patcherMod));
        EXPECT_TRUE(containsLaunchMod(resolved.activeProfileMods, project.enabledInput));
        EXPECT_FALSE(containsLaunchMod(resolved.activeProfileMods, project.disabledInput));
        EXPECT_FALSE(containsLaunchMod(resolved.activeProfileMods, outputPath(project)));
        const std::string modList = readTextFile(
            project.project / L".flow" / L"pgpatcher-mo2" / L"profiles" / L"Fluxora" / L"modlist.txt");
        EXPECT_NE(modList.find("-PGPatcher Output\n"), std::string::npos);
        EXPECT_NE(modList.find("-Disabled Input\n"), std::string::npos);
        EXPECT_NE(modList.find("+Enabled Input\n"), std::string::npos);
        EXPECT_NE(modList.find("+Parallax Gen\n"), std::string::npos);
    }

    TEST(PgPatcherExecutableServiceTests, ExplicitProfileControlsPatcherInputsAndMetadataComment)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Explicit Profile Build");
        const std::filesystem::path alternateInput = project.mods / L"Alternate Input";
        writeTextFile(alternateInput / L"meshes" / L"alternate.nif", "alternate");
        InstanceMetadataStore::registerInstalledMod(
            project.project,
            alternateInput,
            L"Alternate Input",
            {},
            {});
        InstanceMetadataStore::replaceProfileOrderItems(
            project.project,
            L"Alternate",
            {ProfileOrderImportItemRecord{L"mod", L"Alternate Input", {}}});

        const ResolvedExecutableLaunch resolved = resolve(project, L"pg", L"Alternate");

        EXPECT_TRUE(containsLaunchMod(resolved.activeProfileMods, alternateInput));
        EXPECT_FALSE(containsLaunchMod(resolved.activeProfileMods, project.disabledInput));
        EXPECT_FALSE(containsLaunchMod(resolved.activeProfileMods, outputPath(project)));
        EXPECT_EQ(resolved.defaultProfile, L"Alternate");
        const std::string modList = readTextFile(
            project.project / L".flow" / L"pgpatcher-mo2" / L"profiles" / L"Fluxora" / L"modlist.txt");
        EXPECT_NE(modList.find("# Active Fluxora profile: Alternate\n"), std::string::npos);
        EXPECT_NE(modList.find("+Alternate Input\n"), std::string::npos);
        EXPECT_NE(modList.find("-PGPatcher Output\n"), std::string::npos);
    }

    TEST(PgPatcherExecutableServiceTests, GeneratedRootFilesAreNotCopiedIntoPatcherLaunchCache)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Output Isolation Build");
        const std::filesystem::path generatedRootFile = outputPath(project) / L"root" / L"stale-output.dll";
        writeTextFile(generatedRootFile, "stale output");

        const ResolvedExecutableLaunch resolved = resolve(project);

        ASSERT_FALSE(resolved.rootBuilderLaunchCacheDirectory.empty());
        EXPECT_TRUE(std::filesystem::exists(generatedRootFile));
        EXPECT_FALSE(std::filesystem::exists(
            resolved.rootBuilderLaunchCacheDirectory / L"stale-output.dll"));
    }

    TEST(PgPatcherExecutableServiceTests, TwoProjectsUseIndependentStableOutputDirectories)
    {
        TempDirectory temp;
        const PgPatcherProject first = createProject(
            temp.path() / L"First Build",
            L"First: Build?");
        const PgPatcherProject second = createProject(
            temp.path() / L"Вторая сборка",
            L"Second / Build");

        resolve(first);
        resolve(second);

        EXPECT_NE(normalized(outputPath(first)), normalized(outputPath(second)));
        EXPECT_TRUE(std::filesystem::is_directory(outputPath(first)));
        EXPECT_TRUE(std::filesystem::is_directory(outputPath(second)));
        const JsonValue firstSettings = JsonReader::parse(fromUtf8(readTextFile(first.settings)));
        const JsonValue secondSettings = JsonReader::parse(fromUtf8(readTextFile(second.settings)));
        EXPECT_EQ(
            firstSettings.find(L"params")->find(L"output")->find(L"dir")->asString(),
            outputPath(first).wstring());
        EXPECT_EQ(
            secondSettings.find(L"params")->find(L"output")->find(L"dir")->asString(),
            outputPath(second).wstring());
    }

#ifdef _WIN32
    TEST(PgPatcherExecutableServiceTests, OutputJunctionIsRejectedWithoutTouchingExternalFiles)
    {
        TempDirectory temp;
        const PgPatcherProject project = createProject(temp.path() / L"Junction Output Build");
        const std::filesystem::path outside = temp.path() / L"outside";
        writeTextFile(outside / L".flow" / L"sentinel.txt", "keep");
        std::filesystem::create_directories(project.mods);

        std::error_code junctionError;
        if (!createDirectoryJunction(outside, outputPath(project), junctionError))
        {
            GTEST_SKIP() << "Directory junction creation is not available: " << junctionError.message();
        }

        EXPECT_THROW(resolve(project), std::exception);
        EXPECT_EQ(readTextFile(outside / L".flow" / L"sentinel.txt"), "keep");

        std::filesystem::remove(outputPath(project));
    }
#endif
}
