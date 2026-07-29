#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Services/ContentLayoutService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        [[nodiscard]] const PlacementPlanEntry* findEntry(
            const PlacementPlan& plan,
            std::wstring_view sourcePath)
        {
            const auto found = std::find_if(
                plan.entries.begin(),
                plan.entries.end(),
                [sourcePath](const PlacementPlanEntry& entry)
                {
                    return entry.sourcePath.path().generic_wstring() == sourcePath;
                });
            return found == plan.entries.end() ? nullptr : &*found;
        }

        [[nodiscard]] std::string readFile(const std::filesystem::path& path)
        {
            std::ifstream file(path, std::ios::in | std::ios::binary);
            std::ostringstream content;
            content << file.rdbuf();
            return content.str();
        }

        [[nodiscard]] bool hasFindingFor(
            const PlacementPlan& plan,
            ContentLayoutClassification classification)
        {
            return std::any_of(
                plan.validationFindings.begin(),
                plan.validationFindings.end(),
                [classification](const ValidationFinding& finding)
                {
                    return finding.classification == classification;
                });
        }

        class ContentLayoutServiceTests : public testing::Test
        {
        protected:
            ContentLayoutServiceTests()
            {
                registry_.loadEmbeddedDefinitions();
                lookup_ = registry_.lookupById(L"skyrimse");
            }

            [[nodiscard]] ContentLayoutAnalysisRequest skyrimRequest(
                std::vector<ContentLayoutArchiveEntry> entries = {}) const
            {
                EXPECT_TRUE(lookup_.supported);
                EXPECT_NE(lookup_.support, nullptr);
                const GameSupportComponents& components = lookup_.support->components();
                EXPECT_NE(components.contentLayoutRulesProvider, nullptr);

                ContentLayoutAnalysisRequest request;
                request.selectedGameId = lookup_.support->identity().id;
                request.selectedGameDisplayName = lookup_.support->identity().displayName;
                request.selectedGameCapabilities = lookup_.support->capabilities();
                request.rulesProvider = components.contentLayoutRulesProvider;
                request.assessmentPolicy = components.contentLayoutAssessmentPolicy;
                request.archiveFileTree = std::move(entries);
                return request;
            }

            GameSupportRegistry registry_;
            GameSupportLookupResult lookup_;
            ContentLayoutService service_;
        };

        class TestContentLayoutRulesProvider final : public IContentLayoutRulesProvider
        {
        public:
            explicit TestContentLayoutRulesProvider(ContentLayoutSupportRules rules)
                : rules_(std::move(rules))
            {
            }

            [[nodiscard]] const ContentLayoutSupportRules& contentLayoutRules() const noexcept override
            {
                return rules_;
            }

        private:
            ContentLayoutSupportRules rules_;
        };

        [[nodiscard]] ContentLayoutAnalysisRequest requestForRules(
            const TestContentLayoutRulesProvider& provider,
            CapabilitySet capabilities,
            std::vector<ContentLayoutArchiveEntry> entries)
        {
            ContentLayoutAnalysisRequest request;
            request.selectedGameId = GameId::parseOrThrow(L"testgame");
            request.selectedGameDisplayName = L"Test Game";
            request.selectedGameCapabilities = capabilities;
            request.rulesProvider = &provider;
            request.archiveFileTree = std::move(entries);
            return request;
        }
    }

    TEST_F(ContentLayoutServiceTests, SkyrimDataFolderClassifiesPluginsArchivesAndSksePlugins)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"Data/SkyUI_SE.esp"},
            {L"Data/SkyUI_SE.bsa"},
            {L"Data/SKSE/Plugins/skse_plugin.dll"}
        }));

        ASSERT_TRUE(plan.canInstall());
        EXPECT_EQ(plan.summary.pluginEntries, 1U);
        EXPECT_EQ(plan.summary.archiveEntries, 1U);
        EXPECT_EQ(plan.summary.scriptExtenderEntries, 1U);

        const PlacementPlanEntry* plugin = findEntry(plan, L"Data/SkyUI_SE.esp");
        ASSERT_NE(plugin, nullptr);
        EXPECT_EQ(plugin->classification, ContentLayoutClassification::Plugin);
        EXPECT_EQ(plugin->target, PlacementTarget::Data);
        EXPECT_EQ(plugin->targetRelativePath.path().generic_wstring(), L"SkyUI_SE.esp");

        const PlacementPlanEntry* archive = findEntry(plan, L"Data/SkyUI_SE.bsa");
        ASSERT_NE(archive, nullptr);
        EXPECT_EQ(archive->classification, ContentLayoutClassification::Archive);
        EXPECT_EQ(archive->targetRelativePath.path().generic_wstring(), L"SkyUI_SE.bsa");

        const PlacementPlanEntry* skse = findEntry(plan, L"Data/SKSE/Plugins/skse_plugin.dll");
        ASSERT_NE(skse, nullptr);
        EXPECT_EQ(skse->classification, ContentLayoutClassification::ScriptExtender);
        EXPECT_EQ(skse->target, PlacementTarget::Data);
        EXPECT_EQ(skse->targetRelativePath.path().generic_wstring(), L"SKSE/Plugins/skse_plugin.dll");
    }

    TEST_F(ContentLayoutServiceTests, LogsPlacementDecisionsAndBlockers)
    {
        Logger logger;
        Logger::setOperationId(L"content-layout-diagnostics-test");
        logger.initialize();
        ASSERT_TRUE(logger.isInitialized());

        ContentLayoutAnalysisRequest request = skyrimRequest({
            {L"Data/SkyUI_SE.esp"},
            {L"Data/unexpected_tool.dll"}
        });
        request.gameDefinitionVersion = L"test-definition-version";
        request.logger = &logger;

        const PlacementPlan plan = service_.analyze(request);
        EXPECT_FALSE(plan.canInstall());

        logger.shutdown();
        Logger::clearOperationId();

        const std::string content = readFile(logger.operationsLogPath());
        EXPECT_NE(content.find("operationId=content-layout-diagnostics-test"), std::string::npos);
        EXPECT_NE(content.find("contentLayoutDecision=blocked"), std::string::npos);
        EXPECT_NE(content.find("definitionVersion=\"test-definition-version\""), std::string::npos);
        EXPECT_NE(content.find("source=\"Data/SkyUI_SE.esp\""), std::string::npos);
        EXPECT_NE(content.find("Plugin extension matches the selected game's plugin rules."), std::string::npos);
        EXPECT_NE(content.find("source=\"Data/unexpected_tool.dll\""), std::string::npos);
        EXPECT_NE(content.find("unexpected executable or DLL"), std::string::npos);
    }

    TEST_F(ContentLayoutServiceTests, SkyrimArchiveWithoutDataFolderStillClassifiesDataContent)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"SkyUI_SE.esp"},
            {L"meshes/actors/character/facegen.nif"},
            {L"SKSE/Plugins/skse_plugin.dll"}
        }));

        ASSERT_TRUE(plan.canInstall());
        const PlacementPlanEntry* plugin = findEntry(plan, L"SkyUI_SE.esp");
        ASSERT_NE(plugin, nullptr);
        EXPECT_EQ(plugin->classification, ContentLayoutClassification::Plugin);
        EXPECT_EQ(plugin->target, PlacementTarget::Data);
        EXPECT_EQ(plugin->targetRelativePath.path().generic_wstring(), L"SkyUI_SE.esp");

        const PlacementPlanEntry* mesh = findEntry(plan, L"meshes/actors/character/facegen.nif");
        ASSERT_NE(mesh, nullptr);
        EXPECT_EQ(mesh->classification, ContentLayoutClassification::GameData);
        EXPECT_EQ(mesh->target, PlacementTarget::Data);

        const PlacementPlanEntry* skse = findEntry(plan, L"SKSE/Plugins/skse_plugin.dll");
        ASSERT_NE(skse, nullptr);
        EXPECT_EQ(skse->classification, ContentLayoutClassification::ScriptExtender);
    }

    TEST_F(ContentLayoutServiceTests, SkyrimArchiveWithSingleContentWrapperNormalizesSksePluginPaths)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"DisabledReferenceIntegrityFix/SKSE/Plugins/DisabledReferenceIntegrityFix.dll"},
            {L"DisabledReferenceIntegrityFix/SKSE/Plugins/DisabledReferenceIntegrityFix.ini"}
        }));

        ASSERT_TRUE(plan.canInstall());
        EXPECT_EQ(plan.summary.scriptExtenderEntries, 1U);

        const PlacementPlanEntry* plugin = findEntry(
            plan,
            L"DisabledReferenceIntegrityFix/SKSE/Plugins/DisabledReferenceIntegrityFix.dll");
        ASSERT_NE(plugin, nullptr);
        EXPECT_EQ(plugin->classification, ContentLayoutClassification::ScriptExtender);
        EXPECT_EQ(plugin->target, PlacementTarget::Data);
        EXPECT_EQ(
            plugin->targetRelativePath.path().generic_wstring(),
            L"SKSE/Plugins/DisabledReferenceIntegrityFix.dll");

        const PlacementPlanEntry* configuration = findEntry(
            plan,
            L"DisabledReferenceIntegrityFix/SKSE/Plugins/DisabledReferenceIntegrityFix.ini");
        ASSERT_NE(configuration, nullptr);
        EXPECT_EQ(configuration->target, PlacementTarget::Data);
        EXPECT_EQ(
            configuration->targetRelativePath.path().generic_wstring(),
            L"SKSE/Plugins/DisabledReferenceIntegrityFix.ini");
    }

    TEST_F(ContentLayoutServiceTests, SingleWrapperDoesNotAuthorizeDllWithoutRecognizedGameLayout)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"tools/helper.dll"}
        }));

        EXPECT_FALSE(plan.canInstall());
        EXPECT_TRUE(plan.summary.hasBlockers);

        const PlacementPlanEntry* helper = findEntry(plan, L"tools/helper.dll");
        ASSERT_NE(helper, nullptr);
        EXPECT_EQ(helper->classification, ContentLayoutClassification::ToolExecutable);
        EXPECT_EQ(helper->target, PlacementTarget::Blocked);
        EXPECT_EQ(helper->targetRelativePath.path().generic_wstring(), L"tools/helper.dll");
    }

    TEST_F(ContentLayoutServiceTests, TopLevelModToolExecutableStaysInsideRecognizedModPayload)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"Pandora Behaviour Engine+.exe"},
            {L"Nemesis.esp"},
            {L"meshes/actors/character/animations/Pandora/output.hkx"}
        }));

        ASSERT_TRUE(plan.canInstall());
        EXPECT_TRUE(plan.summary.hasWarnings);

        const PlacementPlanEntry* tool = findEntry(plan, L"Pandora Behaviour Engine+.exe");
        ASSERT_NE(tool, nullptr);
        EXPECT_EQ(tool->classification, ContentLayoutClassification::ToolExecutable);
        EXPECT_EQ(tool->target, PlacementTarget::Data);
        EXPECT_EQ(
            tool->targetRelativePath.path().generic_wstring(),
            L"Pandora Behaviour Engine+.exe");
        EXPECT_FALSE(tool->manualOverrideAllowed);
    }

    TEST_F(ContentLayoutServiceTests, NestedModToolExecutableStaysInsideRecognizedModPayload)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"CalienteTools/BodySlide/BodySlide.exe"},
            {L"meshes/actors/character/character assets/femalebody_0.nif"}
        }));

        ASSERT_TRUE(plan.canInstall());
        EXPECT_TRUE(plan.summary.hasWarnings);

        const PlacementPlanEntry* tool = findEntry(plan, L"CalienteTools/BodySlide/BodySlide.exe");
        ASSERT_NE(tool, nullptr);
        EXPECT_EQ(tool->classification, ContentLayoutClassification::ToolExecutable);
        EXPECT_EQ(tool->target, PlacementTarget::Data);
        EXPECT_EQ(
            tool->targetRelativePath.path().generic_wstring(),
            L"CalienteTools/BodySlide/BodySlide.exe");
        EXPECT_FALSE(tool->manualOverrideAllowed);
    }

    TEST_F(ContentLayoutServiceTests, ToolExecutableTargetingGameRootRemainsBlocked)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"root/CalienteTools/BodySlide.exe"},
            {L"meshes/actors/character/character assets/femalebody_0.nif"}
        }));

        EXPECT_FALSE(plan.canInstall());
        EXPECT_TRUE(plan.summary.hasBlockers);

        const PlacementPlanEntry* tool = findEntry(plan, L"root/CalienteTools/BodySlide.exe");
        ASSERT_NE(tool, nullptr);
        EXPECT_EQ(tool->classification, ContentLayoutClassification::ToolExecutable);
        EXPECT_EQ(tool->target, PlacementTarget::Blocked);
        EXPECT_EQ(
            tool->targetRelativePath.path().generic_wstring(),
            L"CalienteTools/BodySlide.exe");
    }

    TEST_F(ContentLayoutServiceTests, UnknownRootFilesAreReportedWithoutBlockingRecognizedContent)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"SkyUI_SE.esp"},
            {L"mystery.payload"}
        }));

        ASSERT_TRUE(plan.canInstall());
        EXPECT_EQ(plan.summary.unknownEntries, 1U);
        EXPECT_TRUE(plan.summary.hasWarnings);
        EXPECT_TRUE(hasFindingFor(plan, ContentLayoutClassification::Unknown));

        const PlacementPlanEntry* unknown = findEntry(plan, L"mystery.payload");
        ASSERT_NE(unknown, nullptr);
        EXPECT_EQ(unknown->classification, ContentLayoutClassification::Unknown);
        EXPECT_EQ(unknown->target, PlacementTarget::Data);
    }

    TEST_F(ContentLayoutServiceTests, EntirelyUnknownSafeUnicodeLayoutWarnsWithoutBlockingInstall)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"тестовая папка/вложение.payload"}
        }));

        ASSERT_TRUE(plan.canInstall());
        EXPECT_FALSE(plan.summary.hasBlockers);
        EXPECT_TRUE(plan.summary.hasWarnings);
        EXPECT_EQ(plan.summary.unknownEntries, 1U);
        ASSERT_TRUE(plan.assessment.has_value());
        EXPECT_EQ(plan.assessment->status, ContentLayoutAssessmentStatus::Warning);

        const PlacementPlanEntry* unknown = findEntry(
            plan,
            L"тестовая папка/вложение.payload");
        ASSERT_NE(unknown, nullptr);
        EXPECT_EQ(unknown->target, PlacementTarget::Data);
        EXPECT_EQ(
            unknown->targetRelativePath.path().generic_wstring(),
            L"тестовая папка/вложение.payload");
        ASSERT_FALSE(plan.validationFindings.empty());
        EXPECT_FALSE(plan.validationFindings.back().blocksInstall);
    }

    TEST_F(ContentLayoutServiceTests, UnsafePathsAreBlocked)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"../escaped.txt"},
            {L"Data/SkyUI_SE.esp"}
        }));

        EXPECT_FALSE(plan.canInstall());
        EXPECT_TRUE(plan.summary.hasBlockers);
        EXPECT_EQ(plan.summary.unsafeEntries, 1U);
        EXPECT_TRUE(hasFindingFor(plan, ContentLayoutClassification::Unsafe));
    }

    TEST_F(ContentLayoutServiceTests, RootScriptExtenderLoaderUsesGameRootAndUnexpectedExecutablesBlock)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"skse64_loader.exe"},
            {L"helper.exe"}
        }));

        EXPECT_FALSE(plan.canInstall());
        const PlacementPlanEntry* loader = findEntry(plan, L"skse64_loader.exe");
        ASSERT_NE(loader, nullptr);
        EXPECT_EQ(loader->classification, ContentLayoutClassification::ScriptExtender);
        EXPECT_EQ(loader->target, PlacementTarget::GameRoot);
        EXPECT_EQ(loader->contentArea, ContentArea::GameRoot);
        EXPECT_EQ(loader->targetRelativePath.path().generic_wstring(), L"skse64_loader.exe");

        const PlacementPlanEntry* helper = findEntry(plan, L"helper.exe");
        ASSERT_NE(helper, nullptr);
        EXPECT_EQ(helper->classification, ContentLayoutClassification::ToolExecutable);
        EXPECT_EQ(helper->target, PlacementTarget::Blocked);
        EXPECT_TRUE(hasFindingFor(plan, ContentLayoutClassification::ToolExecutable));
    }

    TEST_F(ContentLayoutServiceTests, ApplyPlanNormalizesDataAndRootTargetsInStagingDirectory)
    {
        TempDirectory temp;
        const std::filesystem::path staging = temp.path() / L"staging";
        writeTextFile(staging / L"Data" / L"SkyUI_SE.esp", "plugin");
        writeTextFile(staging / L"Data" / L"SKSE" / L"Plugins" / L"skse_plugin.dll", "dll");
        writeTextFile(staging / L"skse64_loader.exe", "loader");

        const PlacementPlan plan = service_.analyzeDirectory(staging, skyrimRequest());
        ASSERT_TRUE(plan.canInstall());

        service_.applyPlanToDirectory(staging, plan);

        EXPECT_TRUE(std::filesystem::is_regular_file(staging / L"SkyUI_SE.esp"));
        EXPECT_TRUE(std::filesystem::is_regular_file(staging / L"SKSE" / L"Plugins" / L"skse_plugin.dll"));
        EXPECT_TRUE(std::filesystem::is_regular_file(staging / L"root" / L"skse64_loader.exe"));
        EXPECT_FALSE(std::filesystem::exists(staging / L"Data" / L"SkyUI_SE.esp"));
        EXPECT_FALSE(std::filesystem::exists(staging / L"skse64_loader.exe"));
    }

    TEST_F(ContentLayoutServiceTests, ApplyPlanMaterializesSingleArchiveWrapperWithoutPreFlattening)
    {
        TempDirectory temp;
        const std::filesystem::path staging = temp.path() / L"staging";
        writeTextFile(
            staging / L"Archive Wrapper" / L"Werewolf Footstep FX.esp",
            "plugin");
        writeTextFile(
            staging / L"Archive Wrapper" / L"sound" / L"fx" / L"step.wav",
            "audio");

        const PlacementPlan plan = service_.analyzeDirectory(staging, skyrimRequest());
        ASSERT_TRUE(plan.canInstall());
        ASSERT_NE(findEntry(plan, L"Archive Wrapper/Werewolf Footstep FX.esp"), nullptr);
        ASSERT_NE(findEntry(plan, L"Archive Wrapper/sound/fx/step.wav"), nullptr);

        service_.applyPlanToDirectory(staging, plan);

        EXPECT_TRUE(std::filesystem::is_regular_file(staging / L"Werewolf Footstep FX.esp"));
        EXPECT_TRUE(std::filesystem::is_regular_file(staging / L"sound" / L"fx" / L"step.wav"));
        EXPECT_FALSE(std::filesystem::exists(staging / L"Archive Wrapper"));
    }

    TEST_F(ContentLayoutServiceTests, ApplyPlanMovesRegularFilesInsideSameVolumeStagingDirectory)
    {
        TempDirectory temp;
        const std::filesystem::path staging = temp.path() / L"staging";
        const std::filesystem::path source = staging / L"Data" / L"SkyUI_SE.esp";
        writeTextFile(source, "plugin");

        const std::filesystem::path identityLink = temp.path() / L"skyui-identity-link.esp";
        std::error_code linkError;
        std::filesystem::create_hard_link(source, identityLink, linkError);
        if (linkError)
        {
            GTEST_SKIP() << "Hard links are not available on this filesystem: " << linkError.message();
        }

        const PlacementPlan plan = service_.analyzeDirectory(staging, skyrimRequest());
        ASSERT_TRUE(plan.canInstall());

        service_.applyPlanToDirectory(staging, plan);

        const std::filesystem::path normalized = staging / L"SkyUI_SE.esp";
        ASSERT_TRUE(std::filesystem::is_regular_file(normalized));
        EXPECT_TRUE(std::filesystem::equivalent(identityLink, normalized));
        EXPECT_FALSE(std::filesystem::exists(source));
    }

    TEST_F(ContentLayoutServiceTests, SelectedGameRulesDriveDataFolderAndPluginRecognition)
    {
        ContentLayoutSupportRules rules;
        rules.dataFolder = L"Payload";
        rules.pluginExtensions = {NormalizedExtension::parseOrThrow(L".plug")};
        rules.archiveExtensions = {NormalizedExtension::parseOrThrow(L".pack")};
        rules.gameDataDirectories = {L"assets"};
        const TestContentLayoutRulesProvider provider(std::move(rules));

        CapabilitySet capabilities;
        capabilities.enable(GameCapability::ContentLayoutRules);

        const PlacementPlan plan = service_.analyze(requestForRules(
            provider,
            capabilities,
            {
                {L"Payload/TestPlugin.plug"},
                {L"Payload/Textures.pack"},
                {L"Payload/assets/model.bin"},
                {L"Data/SkyrimStyle.esp"}
            }));

        ASSERT_TRUE(plan.canInstall());
        EXPECT_EQ(plan.summary.pluginEntries, 1U);
        EXPECT_EQ(plan.summary.archiveEntries, 1U);
        EXPECT_EQ(plan.summary.gameDataEntries, 1U);
        EXPECT_EQ(plan.summary.unknownEntries, 1U);

        const PlacementPlanEntry* plugin = findEntry(plan, L"Payload/TestPlugin.plug");
        ASSERT_NE(plugin, nullptr);
        EXPECT_EQ(plugin->classification, ContentLayoutClassification::Plugin);
        EXPECT_EQ(plugin->targetRelativePath.path().generic_wstring(), L"TestPlugin.plug");

        const PlacementPlanEntry* skyrimStylePlugin = findEntry(plan, L"Data/SkyrimStyle.esp");
        ASSERT_NE(skyrimStylePlugin, nullptr);
        EXPECT_EQ(skyrimStylePlugin->classification, ContentLayoutClassification::Unknown);
        EXPECT_TRUE(plan.summary.hasWarnings);
    }

    TEST_F(ContentLayoutServiceTests, SelectedSubfolderRestrictsAnalysisToChosenPayloadRoot)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({
            {L"Some Mod/Data/SkyUI_SE.esp"},
            {L"Some Mod/Data/textures/interface/widget.dds"},
            {L"Other Mod/Data/Other.esp"}
        });
        request.userSelectedSubfolder = std::filesystem::path(L"Some Mod");

        const PlacementPlan plan = service_.analyze(request);

        ASSERT_TRUE(plan.canInstall());
        EXPECT_EQ(plan.summary.totalEntries, 2U);
        EXPECT_EQ(plan.summary.pluginEntries, 1U);
        EXPECT_EQ(plan.summary.gameDataEntries, 1U);
        EXPECT_EQ(findEntry(plan, L"Other Mod/Data/Other.esp"), nullptr);

        const PlacementPlanEntry* plugin = findEntry(plan, L"Some Mod/Data/SkyUI_SE.esp");
        ASSERT_NE(plugin, nullptr);
        EXPECT_EQ(plugin->targetRelativePath.path().generic_wstring(), L"SkyUI_SE.esp");
    }

    TEST_F(ContentLayoutServiceTests, ExplicitRootWrapperPlacesRootContentThroughRootTarget)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"root/skse64_loader.exe"},
            {L"Data/SkyUI_SE.esp"}
        }));

        ASSERT_TRUE(plan.canInstall());
        const PlacementPlanEntry* loader = findEntry(plan, L"root/skse64_loader.exe");
        ASSERT_NE(loader, nullptr);
        EXPECT_EQ(loader->classification, ContentLayoutClassification::ScriptExtender);
        EXPECT_EQ(loader->target, PlacementTarget::GameRoot);
        EXPECT_EQ(loader->targetRelativePath.path().generic_wstring(), L"skse64_loader.exe");
    }

    TEST_F(ContentLayoutServiceTests, SkyrimRulesCoverMasterLightArchivesAndCommonDataDirectories)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"Update.esm"},
            {L"CreationClub.esl"},
            {L"Skyrim - Textures.bsa"},
            {L"textures/armor/iron.dds"},
            {L"scripts/Foo.pex"},
            {L"interface/bar.swf"}
        }));

        ASSERT_TRUE(plan.canInstall());
        EXPECT_EQ(plan.summary.pluginEntries, 2U);
        EXPECT_EQ(plan.summary.archiveEntries, 1U);
        EXPECT_EQ(plan.summary.gameDataEntries, 3U);

        const PlacementPlanEntry* archive = findEntry(plan, L"Skyrim - Textures.bsa");
        ASSERT_NE(archive, nullptr);
        EXPECT_EQ(archive->classification, ContentLayoutClassification::Archive);
        EXPECT_EQ(archive->target, PlacementTarget::Data);
    }

    TEST_F(ContentLayoutServiceTests, DuplicateTargetsAfterDataWrapperAreBlocked)
    {
        const PlacementPlan plan = service_.analyze(skyrimRequest({
            {L"Data/Same.esp"},
            {L"same.ESP"}
        }));

        EXPECT_FALSE(plan.canInstall());
        EXPECT_TRUE(plan.summary.hasBlockers);
        EXPECT_TRUE(hasFindingFor(plan, ContentLayoutClassification::Plugin));
    }

    TEST_F(ContentLayoutServiceTests, ManualOverrideCanMoveEntryToGameRoot)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({
            {L"Data/SkyUI_SE.esp"}
        });
        request.manualOverrides.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"Data/SkyUI_SE.esp"),
            PlacementTarget::GameRoot
        });

        const PlacementPlan plan = service_.analyze(request);

        ASSERT_TRUE(plan.canInstall());
        const PlacementPlanEntry* plugin = findEntry(plan, L"Data/SkyUI_SE.esp");
        ASSERT_NE(plugin, nullptr);
        EXPECT_EQ(plugin->target, PlacementTarget::GameRoot);
        EXPECT_EQ(plugin->contentArea, ContentArea::GameRoot);
        EXPECT_EQ(plugin->targetRelativePath.path().generic_wstring(), L"SkyUI_SE.esp");
    }

    TEST_F(ContentLayoutServiceTests, ManualOverrideCanMoveEntryToSpecificTargetPath)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({
            {L"Data/SkyUI_SE.esp"}
        });
        request.manualOverrides.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"Data/SkyUI_SE.esp"),
            PlacementTarget::Data,
            GameRelativePath::parseOrThrow(L"textures/interface/SkyUI_SE.esp")
        });

        const PlacementPlan plan = service_.analyze(request);

        ASSERT_TRUE(plan.canInstall());
        const PlacementPlanEntry* plugin = findEntry(plan, L"Data/SkyUI_SE.esp");
        ASSERT_NE(plugin, nullptr);
        EXPECT_EQ(plugin->target, PlacementTarget::Data);
        EXPECT_EQ(plugin->contentArea, ContentArea::Data);
        EXPECT_EQ(plugin->targetRelativePath.path().generic_wstring(), L"textures/interface/SkyUI_SE.esp");
    }

    TEST_F(ContentLayoutServiceTests, ManualOverrideBlocksUnsafeTargetPath)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({
            {L"Data/SkyUI_SE.esp"}
        });
        request.manualOverrides.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"Data/SkyUI_SE.esp"),
            PlacementTarget::Data,
            GameRelativePath::parseOrThrow(L"CON/SkyUI_SE.esp")
        });

        const PlacementPlan plan = service_.analyze(request);

        EXPECT_FALSE(plan.canInstall());
        EXPECT_TRUE(plan.summary.hasBlockers);
        EXPECT_TRUE(hasFindingFor(plan, ContentLayoutClassification::Plugin));
    }

    TEST_F(ContentLayoutServiceTests, ManualOverrideResolvesDuplicateTargetsAcrossRoots)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({
            {L"Data/Same.esp"},
            {L"same.ESP"}
        });
        request.manualOverrides.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"same.ESP"),
            PlacementTarget::GameRoot
        });

        const PlacementPlan plan = service_.analyze(request);

        EXPECT_TRUE(plan.canInstall());
        const PlacementPlanEntry* rootEntry = findEntry(plan, L"same.ESP");
        ASSERT_NE(rootEntry, nullptr);
        EXPECT_EQ(rootEntry->target, PlacementTarget::GameRoot);
        EXPECT_FALSE(plan.summary.hasBlockers);
    }

    TEST_F(ContentLayoutServiceTests, ManualOverrideMaterializesGameRootThroughWrapper)
    {
        TempDirectory temp;
        const std::filesystem::path staging = temp.path() / L"staging";
        writeTextFile(staging / L"Data" / L"SkyUI_SE.esp", "plugin");

        ContentLayoutAnalysisRequest request = skyrimRequest();
        request.manualOverrides.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"Data/SkyUI_SE.esp"),
            PlacementTarget::GameRoot
        });
        const PlacementPlan plan = service_.analyzeDirectory(staging, request);
        ASSERT_TRUE(plan.canInstall());

        service_.applyPlanToDirectory(staging, plan);

        EXPECT_TRUE(std::filesystem::is_regular_file(staging / L"root" / L"SkyUI_SE.esp"));
        EXPECT_FALSE(std::filesystem::exists(staging / L"SkyUI_SE.esp"));
        EXPECT_FALSE(std::filesystem::exists(staging / L"Data" / L"SkyUI_SE.esp"));
    }

    TEST_F(ContentLayoutServiceTests, ManualOverrideForMissingEntryBlocksInstall)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({
            {L"Data/SkyUI_SE.esp"}
        });
        request.manualOverrides.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"Data/Missing.esp"),
            PlacementTarget::GameRoot
        });

        const PlacementPlan plan = service_.analyze(request);

        EXPECT_FALSE(plan.canInstall());
        EXPECT_TRUE(plan.summary.hasBlockers);
        EXPECT_TRUE(hasFindingFor(plan, ContentLayoutClassification::Unsafe));
    }

    TEST_F(ContentLayoutServiceTests, SelectedGameRulesBlockRootFilesWhenCapabilityIsDisabled)
    {
        ContentLayoutSupportRules rules;
        rules.dataFolder = L"Payload";
        rules.supportsRootFiles = false;
        rules.rootFileWrapperDirectory = L"root";
        rules.pluginExtensions = {NormalizedExtension::parseOrThrow(L".plug")};
        const TestContentLayoutRulesProvider provider(std::move(rules));

        CapabilitySet capabilities;
        capabilities.enable(GameCapability::ContentLayoutRules);

        const PlacementPlan plan = service_.analyze(requestForRules(
            provider,
            capabilities,
            {
                {L"Payload/TestPlugin.plug"},
                {L"root/Launcher.exe"}
            }));

        EXPECT_FALSE(plan.canInstall());
        EXPECT_EQ(plan.summary.pluginEntries, 1U);
        EXPECT_TRUE(hasFindingFor(plan, ContentLayoutClassification::GameRoot));
    }

    TEST_F(ContentLayoutServiceTests, LayoutCacheInvalidatesWhenDefinitionVersionChanges)
    {
        ContentLayoutSupportRules firstRules;
        firstRules.dataFolder = L"Payload";
        firstRules.pluginExtensions = {NormalizedExtension::parseOrThrow(L".one")};
        const TestContentLayoutRulesProvider firstProvider(std::move(firstRules));

        CapabilitySet capabilities;
        capabilities.enable(GameCapability::ContentLayoutRules);

        ContentLayoutAnalysisRequest firstRequest = requestForRules(
            firstProvider,
            capabilities,
            {{L"Payload/Test.one"}});
        firstRequest.archiveContentHash = L"same-archive";
        firstRequest.gameDefinitionVersion = L"1.0.0";

        const PlacementPlan first = service_.analyze(firstRequest);
        ASSERT_TRUE(first.canInstall());
        ASSERT_EQ(first.summary.pluginEntries, 1U);

        ContentLayoutSupportRules secondRules;
        secondRules.dataFolder = L"Payload";
        secondRules.pluginExtensions = {NormalizedExtension::parseOrThrow(L".two")};
        const TestContentLayoutRulesProvider secondProvider(std::move(secondRules));

        ContentLayoutAnalysisRequest secondRequest = requestForRules(
            secondProvider,
            capabilities,
            {{L"Payload/Test.one"}});
        secondRequest.archiveContentHash = L"same-archive";
        secondRequest.gameDefinitionVersion = L"2.0.0";

        const PlacementPlan second = service_.analyze(secondRequest);
        EXPECT_TRUE(second.canInstall());
        EXPECT_EQ(second.summary.pluginEntries, 0U);
        EXPECT_TRUE(hasFindingFor(second, ContentLayoutClassification::Unknown));
    }

    TEST_F(ContentLayoutServiceTests, LayoutCacheKeepsArchiveIndexAndMaterializedTreePlansDistinct)
    {
        ContentLayoutAnalysisRequest indexedRequest = skyrimRequest({
            {L"Archive Wrapper/Data/SkyUI_SE.esp"}
        });
        indexedRequest.archiveContentHash = L"same-archive-different-materialized-tree";
        indexedRequest.gameDefinitionVersion = L"1";

        const PlacementPlan indexed = service_.analyze(indexedRequest);
        ASSERT_NE(findEntry(indexed, L"Archive Wrapper/Data/SkyUI_SE.esp"), nullptr);

        ContentLayoutAnalysisRequest materializedRequest = skyrimRequest({
            {L"Data/SkyUI_SE.esp"}
        });
        materializedRequest.archiveContentHash = indexedRequest.archiveContentHash;
        materializedRequest.gameDefinitionVersion = indexedRequest.gameDefinitionVersion;

        const PlacementPlan materialized = service_.analyze(materializedRequest);

        EXPECT_EQ(findEntry(materialized, L"Archive Wrapper/Data/SkyUI_SE.esp"), nullptr);
        ASSERT_NE(findEntry(materialized, L"Data/SkyUI_SE.esp"), nullptr);
        EXPECT_EQ(findEntry(materialized, L"Data/SkyUI_SE.esp")->target, PlacementTarget::Data);
    }

    TEST_F(ContentLayoutServiceTests, PlacementEditsParserAcceptsLegacyAndV2Payloads)
    {
        const PlacementEdits legacy = parsePlacementEditsJson(
            LR"([{"sourcePath":"Data/A.esp","target":"data","targetRelativePath":"A.esp"}])");
        ASSERT_EQ(legacy.files.size(), 1U);
        EXPECT_TRUE(legacy.directories.empty());

        const PlacementEdits v2 = parsePlacementEditsJson(
            LR"({"schemaVersion":2,"files":[{"sourcePath":"Data/A.esp","target":"data","targetRelativePath":"Plugins/A.esp"}],"directories":[{"target":"gameRoot","targetRelativePath":"Tools/Empty"}],"excludedSourcePaths":["Data/Source/Author.psc"]})");
        ASSERT_EQ(v2.files.size(), 1U);
        ASSERT_EQ(v2.directories.size(), 1U);
        ASSERT_EQ(v2.excludedSourcePaths.size(), 1U);
        EXPECT_EQ(v2.directories.front().target, PlacementTarget::GameRoot);
        EXPECT_EQ(v2.directories.front().targetRelativePath.path().generic_wstring(), L"Tools/Empty");
        EXPECT_EQ(v2.excludedSourcePaths.front().path().generic_wstring(), L"Data/Source/Author.psc");
        EXPECT_NE(placementEditsFingerprint(legacy), placementEditsFingerprint(v2));
    }

    TEST_F(ContentLayoutServiceTests, PlacementEditsParticipateInLayoutCacheKey)
    {
        ContentLayoutAnalysisRequest firstRequest = skyrimRequest({{L"Data/SkyUI_SE.esp"}});
        firstRequest.archiveContentHash = L"cache-aware-archive";
        firstRequest.gameDefinitionVersion = L"1";
        const PlacementPlan first = service_.analyze(firstRequest);
        ASSERT_EQ(findEntry(first, L"Data/SkyUI_SE.esp")->target, PlacementTarget::Data);

        ContentLayoutAnalysisRequest secondRequest = firstRequest;
        secondRequest.placementEdits.files.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"Data/SkyUI_SE.esp"),
            PlacementTarget::GameRoot,
            GameRelativePath::parseOrThrow(L"SkyUI_SE.esp")
        });
        const PlacementPlan second = service_.analyze(secondRequest);

        ASSERT_NE(findEntry(second, L"Data/SkyUI_SE.esp"), nullptr);
        EXPECT_EQ(findEntry(second, L"Data/SkyUI_SE.esp")->target, PlacementTarget::GameRoot);
        EXPECT_NE(first.editFingerprint, second.editFingerprint);
    }

    TEST_F(ContentLayoutServiceTests, PlacementEditsMaterializeEmptyDataAndGameRootDirectories)
    {
        TempDirectory temp;
        const std::filesystem::path staging = temp.path() / L"staging";
        writeTextFile(staging / L"Data" / L"SkyUI_SE.esp", "plugin");

        ContentLayoutAnalysisRequest request = skyrimRequest();
        request.placementEdits.directories = {
            {PlacementTarget::Data, GameRelativePath::parseOrThrow(L"Meshes/Empty")},
            {PlacementTarget::GameRoot, GameRelativePath::parseOrThrow(L"Tools/Empty")}
        };
        const PlacementPlan plan = service_.analyzeDirectory(staging, request);
        ASSERT_TRUE(plan.canInstall());
        ASSERT_EQ(plan.directories.size(), 2U);
        ASSERT_TRUE(plan.assessment.has_value());
        EXPECT_EQ(plan.assessment->status, ContentLayoutAssessmentStatus::Ready);

        service_.applyPlanToDirectory(staging, plan);

        EXPECT_TRUE(std::filesystem::is_directory(staging / L"Meshes" / L"Empty"));
        EXPECT_TRUE(std::filesystem::is_directory(staging / L"root" / L"Tools" / L"Empty"));
    }

    TEST_F(ContentLayoutServiceTests, PlacementEditsExcludeFilesFromPreviewCountsAndMaterialization)
    {
        TempDirectory temp;
        const std::filesystem::path staging = temp.path() / L"staging";
        writeTextFile(staging / L"Data" / L"Keep.esp", "plugin");
        writeTextFile(staging / L"Data" / L"Source" / L"Author.psc", "source");

        ContentLayoutAnalysisRequest request = skyrimRequest();
        request.placementEdits.excludedSourcePaths = {
            GameRelativePath::parseOrThrow(L"Data/Source/Author.psc")
        };
        const PlacementPlan plan = service_.analyzeDirectory(staging, request);

        ASSERT_TRUE(plan.canInstall());
        ASSERT_EQ(plan.entries.size(), 2U);
        ASSERT_NE(findEntry(plan, L"Data/Source/Author.psc"), nullptr);
        EXPECT_FALSE(findEntry(plan, L"Data/Source/Author.psc")->included);
        EXPECT_TRUE(findEntry(plan, L"Data/Keep.esp")->included);
        EXPECT_EQ(plan.summary.totalEntries, 2U);
        EXPECT_EQ(plan.summary.plannedEntries, 1U);

        service_.applyPlanToDirectory(staging, plan);

        EXPECT_TRUE(std::filesystem::is_regular_file(staging / L"Keep.esp"));
        EXPECT_FALSE(std::filesystem::exists(staging / L"Source" / L"Author.psc"));
    }

    TEST_F(ContentLayoutServiceTests, ExcludingBlockedExecutableMakesTheRemainingLayoutInstallable)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({{L"root/Unexpected.exe"}});
        request.placementEdits.excludedSourcePaths = {
            GameRelativePath::parseOrThrow(L"root/Unexpected.exe")
        };

        const PlacementPlan plan = service_.analyze(request);

        ASSERT_TRUE(plan.canInstall());
        ASSERT_NE(findEntry(plan, L"root/Unexpected.exe"), nullptr);
        EXPECT_FALSE(findEntry(plan, L"root/Unexpected.exe")->included);
        EXPECT_EQ(findEntry(plan, L"root/Unexpected.exe")->target, PlacementTarget::Blocked);
        EXPECT_FALSE(plan.summary.hasBlockers);
        EXPECT_TRUE(plan.validationFindings.empty());
    }

    TEST_F(ContentLayoutServiceTests, PlacementEditsBlockCaseInsensitiveFileDirectoryCollision)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({{L"Data/Meshes"}});
        request.placementEdits.directories.push_back(PlacementDirectory{
            PlacementTarget::Data,
            GameRelativePath::parseOrThrow(L"meshes")
        });

        const PlacementPlan plan = service_.analyze(request);

        EXPECT_FALSE(plan.canInstall());
        ASSERT_TRUE(plan.assessment.has_value());
        EXPECT_EQ(plan.assessment->status, ContentLayoutAssessmentStatus::Blocked);
    }

    TEST_F(ContentLayoutServiceTests, RedundantDataWrapperBlocksUntilPlacementEditRemovesIt)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({{L"Data/Data/Redundant.esp"}});
        const PlacementPlan blocked = service_.analyze(request);
        EXPECT_FALSE(blocked.canInstall());
        ASSERT_TRUE(blocked.assessment.has_value());
        EXPECT_EQ(blocked.assessment->status, ContentLayoutAssessmentStatus::Blocked);

        request.placementEdits.files.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"Data/Data/Redundant.esp"),
            PlacementTarget::Data,
            GameRelativePath::parseOrThrow(L"Redundant.esp")
        });
        const PlacementPlan corrected = service_.analyze(request);
        ASSERT_TRUE(corrected.canInstall());
        ASSERT_TRUE(corrected.assessment.has_value());
        EXPECT_EQ(corrected.assessment->status, ContentLayoutAssessmentStatus::Ready);
    }

    TEST_F(ContentLayoutServiceTests, RedundantRootWrapperBlocksUntilPlacementEditRemovesIt)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({{L"root/root/skse64_loader.exe"}});
        const PlacementPlan blocked = service_.analyze(request);
        EXPECT_FALSE(blocked.canInstall());
        ASSERT_TRUE(blocked.assessment.has_value());
        EXPECT_EQ(blocked.assessment->status, ContentLayoutAssessmentStatus::Blocked);

        request.placementEdits.files.push_back(PlacementOverride{
            GameRelativePath::parseOrThrow(L"root/root/skse64_loader.exe"),
            PlacementTarget::GameRoot,
            GameRelativePath::parseOrThrow(L"skse64_loader.exe")
        });
        const PlacementPlan corrected = service_.analyze(request);
        ASSERT_TRUE(corrected.canInstall());
        ASSERT_TRUE(corrected.assessment.has_value());
        EXPECT_EQ(corrected.assessment->status, ContentLayoutAssessmentStatus::Ready);
    }

    TEST_F(ContentLayoutServiceTests, PlacementEditsRejectReservedWindowsDirectoryNames)
    {
        ContentLayoutAnalysisRequest request = skyrimRequest({{L"Data/Valid.esp"}});
        request.placementEdits.directories.push_back(PlacementDirectory{
            PlacementTarget::Data,
            GameRelativePath::parseOrThrow(L"CON")
        });

        const PlacementPlan plan = service_.analyze(request);
        EXPECT_FALSE(plan.canInstall());
        EXPECT_TRUE(hasFindingFor(plan, ContentLayoutClassification::Unsafe));
    }

    TEST_F(ContentLayoutServiceTests, CachedTenThousandEntryRevalidationCompletesWithinOneHundredMilliseconds)
    {
        std::vector<ContentLayoutArchiveEntry> entries;
        entries.reserve(10'000);
        for (std::size_t index = 0; index < 10'000; ++index)
        {
            entries.push_back(ContentLayoutArchiveEntry{
                std::filesystem::path(L"Data/Meshes/Generated") /
                    (std::to_wstring(index) + L".nif")
            });
        }
        ContentLayoutAnalysisRequest request = skyrimRequest(std::move(entries));
        request.archiveContentHash = L"ten-thousand-entry-performance-gate";
        request.gameDefinitionVersion = L"performance-gate-v1";
        const PlacementPlan initial = service_.analyze(request);
        ASSERT_TRUE(initial.canInstall());
        ASSERT_EQ(initial.entries.size(), 10'000U);

        const auto startedAt = std::chrono::steady_clock::now();
        const PlacementPlan cached = service_.analyze(request);
        const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - startedAt);

        ASSERT_EQ(cached.entries.size(), 10'000U);
        EXPECT_LT(duration, std::chrono::milliseconds(100));
    }

    TEST_F(ContentLayoutServiceTests, LongLayoutAnalysisCanBeCanceled)
    {
        std::atomic_bool canceled{true};
        ContentLayoutAnalysisRequest request = skyrimRequest({{L"Data/SkyUI_SE.esp"}});
        request.cancellationRequested = &canceled;

        EXPECT_THROW((void)service_.analyze(request), std::runtime_error);
    }
}
