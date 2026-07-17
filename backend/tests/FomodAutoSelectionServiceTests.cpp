#include "FluxoraCore/Services/FomodAutoSelectionService.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>

namespace fluxora::tests
{
    namespace
    {
        const FomodOptionDecision& decisionFor(
            const FomodAutoSelection& selection,
            std::wstring_view optionId)
        {
            const auto match = std::find_if(
                selection.decisions.begin(),
                selection.decisions.end(),
                [optionId](const FomodOptionDecision& decision)
                {
                    return decision.optionId == optionId;
                });
            EXPECT_NE(match, selection.decisions.end());
            return *match;
        }

        FomodOption option(std::wstring id, std::wstring type)
        {
            FomodOption value;
            value.id = std::move(id);
            value.name = value.id;
            value.type = type;
            value.defaultType = std::move(type);
            return value;
        }

        FomodInstallerDescriptor descriptorWithGroup(
            std::wstring groupType,
            std::vector<FomodOption> options)
        {
            FomodInstallerDescriptor descriptor;
            descriptor.isFomod = true;
            descriptor.steps.push_back(FomodStep{
                L"step",
                L"Step",
                std::nullopt,
                {FomodGroup{L"group", L"Group", std::move(groupType), std::move(options)}}
            });
            return descriptor;
        }

        FomodProfileContext supportedContext()
        {
            FomodProfileContext context;
            context.contextId = L"context-1";
            context.profileName = L"Gameplay";
            context.fingerprint = L"fingerprint";
            context.autoSelectionAvailable = true;
            return context;
        }
    }

    TEST(FomodAutoSelectionServiceTests, ExclusiveTieStaysManualWhileSelectAnyChoosesAllRecommendations)
    {
        FomodProfileContext context = supportedContext();
        const FomodInstallerDescriptor exclusive = descriptorWithGroup(
            L"SelectExactlyOne",
            {option(L"a", L"Recommended"), option(L"b", L"Recommended")});

        const FomodAutoSelection tied = FomodAutoSelectionService::analyze(exclusive, context);

        EXPECT_TRUE(tied.initialSelectedOptionIds.empty());
        ASSERT_EQ(tied.unresolvedGroups.size(), 1u);
        EXPECT_EQ(tied.unresolvedGroups[0].reasonCode, L"group.ambiguous");
        EXPECT_EQ(decisionFor(tied, L"a").action, FomodOptionDecisionAction::Manual);
        EXPECT_EQ(decisionFor(tied, L"b").action, FomodOptionDecisionAction::Manual);

        const FomodInstallerDescriptor any = descriptorWithGroup(
            L"SelectAny",
            {
                option(L"a", L"Recommended"),
                option(L"b", L"Recommended"),
                option(L"c", L"CouldBeUsable"),
                option(L"d", L"NotUsable")
            });
        const FomodAutoSelection selected = FomodAutoSelectionService::analyze(any, context);

        EXPECT_EQ(selected.initialSelectedOptionIds, (std::vector<std::wstring>{L"a", L"b"}));
        EXPECT_EQ(decisionFor(selected, L"c").action, FomodOptionDecisionAction::Manual);
        EXPECT_EQ(decisionFor(selected, L"d").action, FomodOptionDecisionAction::Locked);
    }

    TEST(FomodAutoSelectionServiceTests, AppliesEveryGroupTypeAndManualPinsWithoutGuessing)
    {
        FomodProfileContext context = supportedContext();
        FomodInstallerDescriptor descriptor;
        descriptor.isFomod = true;
        descriptor.steps = {
            FomodStep{L"all", L"All", std::nullopt, {
                FomodGroup{L"all-group", L"All", L"SelectAll", {
                    option(L"all-a", L"Optional"), option(L"all-b", L"Optional")}}}},
            FomodStep{L"at-least", L"At least", std::nullopt, {
                FomodGroup{L"at-least-group", L"At least", L"SelectAtLeastOne", {
                    option(L"many-a", L"Recommended"), option(L"many-b", L"Recommended")}}}},
            FomodStep{L"at-most", L"At most", std::nullopt, {
                FomodGroup{L"at-most-group", L"At most", L"SelectAtMostOne", {
                    option(L"one-a", L"Recommended"), option(L"one-b", L"Optional")}}}}
        };

        const FomodAutoSelection automatic = FomodAutoSelectionService::analyze(descriptor, context);
        EXPECT_EQ(
            automatic.initialSelectedOptionIds,
            (std::vector<std::wstring>{L"all-a", L"all-b", L"many-a", L"many-b", L"one-a"}));
        EXPECT_EQ(decisionFor(automatic, L"all-a").action, FomodOptionDecisionAction::Locked);

        const FomodAutoSelection manual = FomodAutoSelectionService::analyze(
            descriptor,
            context,
            {
                FomodManualDecision{L"many-a", false},
                FomodManualDecision{L"many-b", true},
                FomodManualDecision{L"one-a", false},
                FomodManualDecision{L"one-b", true}
            });
        EXPECT_EQ(
            manual.initialSelectedOptionIds,
            (std::vector<std::wstring>{L"all-a", L"all-b", L"many-b", L"one-b"}));
        EXPECT_EQ(decisionFor(manual, L"many-a").reasonCodes[0], L"manual.session");
        EXPECT_EQ(decisionFor(manual, L"one-b").confidence, FomodDecisionConfidence::Exact);
    }

    TEST(FomodAutoSelectionServiceTests, EvaluatesGameFommAndAllScriptExtenderVersions)
    {
        FomodProfileContext context = supportedContext();
        context.gameVersion = FomodDetectedVersion{L"game", L"Game", L"1.6.1170.0", true};
        context.extenderVersions = {
            FomodDetectedVersion{L"skse", L"SKSE", L"2.2.6", true},
            FomodDetectedVersion{L"fose", L"FOSE", L"1.3", true},
            FomodDetectedVersion{L"nvse", L"NVSE", L"6.3.5", true},
            FomodDetectedVersion{L"f4se", L"F4SE", L"0.7.2", true}
        };
        const std::vector<std::pair<std::wstring, std::wstring>> supported{
            {L"game", L"1.6.640"},
            {L"fomm", L"0.13.21"},
            {L"skse", L"2.2.6"},
            {L"fose", L"1.2"},
            {L"nvse", L"6.3"},
            {L"f4se", L"0.7.1"}
        };
        for (const auto& [kind, version] : supported)
        {
            FomodDependencyNode dependency;
            dependency.kind = kind;
            dependency.version = version;
            EXPECT_EQ(
                FomodAutoSelectionService::evaluateDependency(dependency, context),
                FomodDependencyResult::Satisfied);
        }

        FomodDependencyNode tooNewFomm;
        tooNewFomm.kind = L"fomm";
        tooNewFomm.version = L"0.14";
        EXPECT_EQ(
            FomodAutoSelectionService::evaluateDependency(tooNewFomm, context),
            FomodDependencyResult::Unsatisfied);
    }

    TEST(FomodAutoSelectionServiceTests, ExactProfileStateDrivesAUniqueRecommendationWithEvidence)
    {
        FomodProfileContext context = supportedContext();
        context.fileStates.push_back(FomodProfileFileState{
            L"Data\\Lanterns.esp",
            FomodProfileFileStateKind::Active,
            L"mod",
            L"Lanterns",
            true
        });
        FomodOption patch = option(L"patch", L"Optional");
        FomodDependencyNode dependency;
        dependency.kind = L"file";
        dependency.file = L"Data/Lanterns.esp";
        dependency.state = L"Active";
        patch.typePatterns.push_back(FomodTypePattern{dependency, L"Recommended"});
        const FomodInstallerDescriptor descriptor = descriptorWithGroup(
            L"SelectExactlyOne",
            {std::move(patch), option(L"none", L"Optional")});

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(descriptor, context);

        ASSERT_EQ(selection.initialSelectedOptionIds, (std::vector<std::wstring>{L"patch"}));
        const FomodOptionDecision& decision = decisionFor(selection, L"patch");
        EXPECT_EQ(decision.action, FomodOptionDecisionAction::Select);
        EXPECT_EQ(decision.confidence, FomodDecisionConfidence::Exact);
        ASSERT_FALSE(decision.evidence.empty());
        EXPECT_EQ(decision.evidence[0].actual, L"Active");
        EXPECT_EQ(decision.evidence[0].sourceName, L"Lanterns");
    }

    TEST(FomodAutoSelectionServiceTests, ExclusiveGroupsPreferProfileThenMemoryThenAuthorRecommendation)
    {
        FomodProfileContext context = supportedContext();
        context.fileStates.push_back(FomodProfileFileState{
            L"Data\\Lanterns.esp",
            FomodProfileFileStateKind::Active,
            L"mod",
            L"Lanterns",
            true
        });

        FomodOption exact = option(L"exact", L"Optional");
        FomodDependencyNode dependency;
        dependency.kind = L"file";
        dependency.file = L"Data/Lanterns.esp";
        dependency.state = L"Active";
        exact.typePatterns.push_back(FomodTypePattern{dependency, L"Recommended"});

        FomodInstallerDescriptor descriptor = descriptorWithGroup(
            L"SelectExactlyOne",
            {std::move(exact), option(L"remembered", L"Optional"), option(L"author", L"Recommended")});
        descriptor.previousSelectedOptionIds = {L"remembered"};
        descriptor.previousSelectionContextual = true;

        const FomodAutoSelection exactSelection = FomodAutoSelectionService::analyze(descriptor, context);
        EXPECT_EQ(exactSelection.initialSelectedOptionIds, (std::vector<std::wstring>{L"exact"}));
        EXPECT_TRUE(exactSelection.unresolvedGroups.empty());

        context.fileStates[0].state = FomodProfileFileStateKind::Inactive;
        const FomodAutoSelection rememberedSelection = FomodAutoSelectionService::analyze(descriptor, context);
        EXPECT_EQ(rememberedSelection.initialSelectedOptionIds, (std::vector<std::wstring>{L"remembered"}));
        EXPECT_TRUE(rememberedSelection.unresolvedGroups.empty());
        EXPECT_EQ(decisionFor(rememberedSelection, L"remembered").reasonCodes[0], L"memory.contextual");
    }

    TEST(FomodAutoSelectionServiceTests, UnknownVersionNeverAutoSelectsAndKnownModuleViolationBlocksInstall)
    {
        FomodProfileContext context = supportedContext();
        context.extenderVersions.push_back(FomodDetectedVersion{L"skse", L"SKSE", {}, false});
        FomodOption sksePatch = option(L"skse-patch", L"Optional");
        FomodDependencyNode skse;
        skse.kind = L"skse";
        skse.version = L"2.2.6";
        sksePatch.typePatterns.push_back(FomodTypePattern{skse, L"Recommended"});
        FomodInstallerDescriptor descriptor = descriptorWithGroup(
            L"SelectExactlyOne",
            {std::move(sksePatch), option(L"none", L"Optional")});
        FomodDependencyNode game;
        game.kind = L"game";
        game.version = L"2.0";
        descriptor.moduleDependencies = game;
        context.gameVersion = FomodDetectedVersion{L"game", L"Game", L"1.0", true};

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(descriptor, context);

        EXPECT_TRUE(selection.installBlocked);
        EXPECT_EQ(selection.moduleDependencyResult, FomodDependencyResult::Unsatisfied);
        EXPECT_TRUE(selection.initialSelectedOptionIds.empty());
        EXPECT_EQ(decisionFor(selection, L"skse-patch").action, FomodOptionDecisionAction::Manual);
        ASSERT_FALSE(selection.unresolvedGroups.empty());
    }

    TEST(FomodAutoSelectionServiceTests, UnknownModuleVersionKeepsInstallManualWithoutBlockingIt)
    {
        FomodProfileContext context = supportedContext();
        context.gameVersion = FomodDetectedVersion{L"game", L"Game", {}, false};
        FomodInstallerDescriptor descriptor = descriptorWithGroup(
            L"SelectAny",
            {option(L"author", L"Recommended")});
        FomodDependencyNode game;
        game.kind = L"game";
        game.version = L"1.6.1170";
        descriptor.moduleDependencies = game;

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(descriptor, context);

        EXPECT_FALSE(selection.installBlocked);
        EXPECT_EQ(selection.moduleDependencyResult, FomodDependencyResult::Unknown);
        EXPECT_TRUE(selection.initialSelectedOptionIds.empty());
        EXPECT_EQ(decisionFor(selection, L"author").action, FomodOptionDecisionAction::Manual);
        ASSERT_FALSE(selection.unresolvedGroups.empty());
        EXPECT_EQ(selection.unresolvedGroups[0].reasonCode, L"dependency.unknown");
    }

    TEST(FomodAutoSelectionServiceTests, RepeatsFlagEvaluationUntilAStableSelection)
    {
        FomodProfileContext context = supportedContext();
        FomodOption base = option(L"base", L"Recommended");
        base.flags.push_back(FomodConditionFlag{L"variant", L"a"});
        FomodOption patch = option(L"patch", L"Optional");
        FomodDependencyNode flag;
        flag.kind = L"flag";
        flag.flag = L"variant";
        flag.value = L"a";
        patch.typePatterns.push_back(FomodTypePattern{flag, L"Recommended"});

        FomodInstallerDescriptor descriptor;
        descriptor.isFomod = true;
        descriptor.steps = {
            FomodStep{L"base-step", L"Base", std::nullopt, {
                FomodGroup{L"base-group", L"Base", L"SelectExactlyOne", {std::move(base)}}}},
            FomodStep{L"patch-step", L"Patch", std::nullopt, {
                FomodGroup{L"patch-group", L"Patch", L"SelectAny", {std::move(patch)}}}}
        };

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(descriptor, context);

        EXPECT_EQ(selection.initialSelectedOptionIds, (std::vector<std::wstring>{L"base", L"patch"}));
        EXPECT_FALSE(selection.cycleDetected);
    }

    TEST(FomodAutoSelectionServiceTests, CyclicFlagRulesFallBackToManualSelection)
    {
        FomodProfileContext context = supportedContext();
        FomodOption a = option(L"a", L"Recommended");
        a.flags.push_back(FomodConditionFlag{L"mode", L"a"});
        FomodDependencyNode bFlag;
        bFlag.kind = L"flag";
        bFlag.flag = L"mode";
        bFlag.value = L"b";
        a.typePatterns.push_back(FomodTypePattern{bFlag, L"Optional"});

        FomodOption b = option(L"b", L"Optional");
        b.flags.push_back(FomodConditionFlag{L"mode", L"b"});
        FomodDependencyNode aFlag;
        aFlag.kind = L"flag";
        aFlag.flag = L"mode";
        aFlag.value = L"a";
        b.typePatterns.push_back(FomodTypePattern{aFlag, L"Recommended"});
        const FomodInstallerDescriptor descriptor = descriptorWithGroup(
            L"SelectExactlyOne",
            {std::move(a), std::move(b)});

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(descriptor, context);

        EXPECT_TRUE(selection.cycleDetected);
        EXPECT_TRUE(selection.initialSelectedOptionIds.empty());
        ASSERT_FALSE(selection.unresolvedGroups.empty());
        EXPECT_EQ(selection.unresolvedGroups[0].reasonCode, L"dependency.cycle");
    }

    TEST(FomodAutoSelectionServiceTests, CyclicFlagsOnlyDisableAffectedGroups)
    {
        FomodProfileContext context = supportedContext();
        FomodOption a = option(L"a", L"Recommended");
        a.flags.push_back(FomodConditionFlag{L"mode", L"a"});
        FomodDependencyNode bFlag;
        bFlag.kind = L"flag";
        bFlag.flag = L"mode";
        bFlag.value = L"b";
        a.typePatterns.push_back(FomodTypePattern{bFlag, L"Optional"});

        FomodOption b = option(L"b", L"Optional");
        b.flags.push_back(FomodConditionFlag{L"mode", L"b"});
        FomodDependencyNode aFlag;
        aFlag.kind = L"flag";
        aFlag.flag = L"mode";
        aFlag.value = L"a";
        b.typePatterns.push_back(FomodTypePattern{aFlag, L"Recommended"});

        FomodInstallerDescriptor descriptor;
        descriptor.isFomod = true;
        descriptor.steps = {
            FomodStep{L"cycle-step", L"Cycle", std::nullopt, {
                FomodGroup{L"cycle-group", L"Cycle", L"SelectExactlyOne", {std::move(a), std::move(b)}}}},
            FomodStep{L"stable-step", L"Stable", std::nullopt, {
                FomodGroup{L"stable-group", L"Stable", L"SelectAny", {
                    option(L"stable", L"Recommended")}}}}
        };

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(descriptor, context);

        EXPECT_TRUE(selection.cycleDetected);
        EXPECT_EQ(selection.initialSelectedOptionIds, (std::vector<std::wstring>{L"stable"}));
        ASSERT_EQ(selection.unresolvedGroups.size(), 1u);
        EXPECT_EQ(selection.unresolvedGroups[0].groupId, L"cycle-group");
        EXPECT_EQ(decisionFor(selection, L"stable").action, FomodOptionDecisionAction::Select);
        EXPECT_EQ(decisionFor(selection, L"a").reasonCodes[0], L"dependency.cycle");
    }

    TEST(FomodAutoSelectionServiceTests, Tes4MastersGateAuthorRecommendationWithoutReplacingIt)
    {
        FomodProfileContext context = supportedContext();
        context.basePluginNames = {L"Skyrim.esm"};
        context.fileStates.push_back(FomodProfileFileState{
            L"Data\\Lanterns.esp",
            FomodProfileFileStateKind::Active,
            L"mod",
            L"Lanterns",
            true
        });
        FomodOption patch = option(L"patch", L"Recommended");
        patch.pluginHeaders.push_back(FomodPluginHeader{
            L"Data\\Patch.esp",
            {L"Skyrim.esm", L"Lanterns.esp"},
            FomodPluginHeaderStatus::Parsed,
            {}
        });
        const FomodInstallerDescriptor descriptor = descriptorWithGroup(
            L"SelectAny",
            {std::move(patch)});

        const FomodAutoSelection selected = FomodAutoSelectionService::analyze(descriptor, context);

        EXPECT_EQ(selected.initialSelectedOptionIds, (std::vector<std::wstring>{L"patch"}));
        EXPECT_EQ(decisionFor(selected, L"patch").reasonCodes[0], L"author.recommended");
        ASSERT_FALSE(decisionFor(selected, L"patch").evidence.empty());

        context.fileStates[0].state = FomodProfileFileStateKind::Inactive;
        const FomodAutoSelection inactive = FomodAutoSelectionService::analyze(descriptor, context);
        EXPECT_TRUE(inactive.initialSelectedOptionIds.empty());
        EXPECT_EQ(decisionFor(inactive, L"patch").action, FomodOptionDecisionAction::Manual);
        EXPECT_EQ(decisionFor(inactive, L"patch").reasonCodes[0], L"tes4.masterUnavailable");
        ASSERT_FALSE(inactive.unresolvedGroups.empty());
    }

    TEST(FomodAutoSelectionServiceTests, BaseOnlyPluginDoesNotCreateAFalsePatchRecommendation)
    {
        FomodProfileContext context = supportedContext();
        context.basePluginNames = {L"Skyrim.esm", L"Update.esm"};
        FomodOption plugin = option(L"base-only", L"Optional");
        plugin.pluginHeaders.push_back(FomodPluginHeader{
            L"Data\\BaseOnly.esp",
            {L"Skyrim.esm", L"Update.esm"},
            FomodPluginHeaderStatus::Parsed,
            {}
        });

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(
            descriptorWithGroup(L"SelectAny", {std::move(plugin)}),
            context);

        EXPECT_TRUE(selection.initialSelectedOptionIds.empty());
        EXPECT_EQ(decisionFor(selection, L"base-only").action, FomodOptionDecisionAction::Deselect);
    }

    TEST(FomodAutoSelectionServiceTests, OptionalSLaWfChoicesAreNotRecommendedByUssepMasterPresence)
    {
        FomodProfileContext context = supportedContext();
        context.gameVersion = FomodDetectedVersion{L"game", L"Skyrim SE", L"1.6.1170.0", true};
        context.basePluginNames = {L"Skyrim.esm"};
        context.fileStates.push_back(FomodProfileFileState{
            L"Data\\Unofficial Skyrim Special Edition Patch.esp",
            FomodProfileFileStateKind::Active,
            L"mod",
            L"Unofficial Skyrim Special Edition Patch",
            true
        });

        FomodOption freeCrops = option(L"free-crops", L"Optional");
        freeCrops.name = L"Free Crops";
        freeCrops.pluginHeaders.push_back(FomodPluginHeader{
            L"Data\\SLaWF - Free Crops.esp",
            {L"Skyrim.esm", L"Unofficial Skyrim Special Edition Patch.esp"},
            FomodPluginHeaderStatus::Parsed,
            {}});

        FomodOption legacyVersion = option(L"legacy-version", L"Optional");
        legacyVersion.name = L"v1.5.97 .esm-s and USSEP";
        legacyVersion.pluginHeaders.push_back(FomodPluginHeader{
            L"Data\\SLaWF - 1.5.97 and USSEP.esp",
            {L"Skyrim.esm", L"Unofficial Skyrim Special Edition Patch.esp"},
            FomodPluginHeaderStatus::Parsed,
            {}});

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(
            descriptorWithGroup(L"SelectAny", {std::move(freeCrops), std::move(legacyVersion)}),
            context);

        EXPECT_TRUE(selection.initialSelectedOptionIds.empty());
        EXPECT_EQ(decisionFor(selection, L"free-crops").action, FomodOptionDecisionAction::Deselect);
        EXPECT_EQ(decisionFor(selection, L"free-crops").reasonCodes[0], L"author.optional");
        EXPECT_EQ(decisionFor(selection, L"legacy-version").action, FomodOptionDecisionAction::Deselect);
        EXPECT_EQ(decisionFor(selection, L"legacy-version").reasonCodes[0], L"author.optional");
    }

    TEST(FomodAutoSelectionServiceTests, Tes4InternalMasterEvidenceDoesNotPromoteOptionalOption)
    {
        FomodProfileContext context = supportedContext();
        FomodOption provider = option(L"provider", L"Recommended");
        provider.pluginHeaders.push_back(FomodPluginHeader{
            L"Data\\InternalMaster.esp", {}, FomodPluginHeaderStatus::Parsed, {}});
        FomodOption patch = option(L"patch", L"Optional");
        patch.pluginHeaders.push_back(FomodPluginHeader{
            L"Data\\InternalPatch.esp",
            {L"InternalMaster.esp"},
            FomodPluginHeaderStatus::Parsed,
            {}
        });
        const FomodInstallerDescriptor descriptor = descriptorWithGroup(
            L"SelectAny",
            {std::move(provider), std::move(patch)});

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(descriptor, context);

        EXPECT_EQ(selection.initialSelectedOptionIds, (std::vector<std::wstring>{L"provider"}));
        const FomodOptionDecision& patchDecision = decisionFor(selection, L"patch");
        EXPECT_EQ(patchDecision.action, FomodOptionDecisionAction::Deselect);
        EXPECT_EQ(patchDecision.reasonCodes[0], L"author.optional");
        EXPECT_TRUE(std::any_of(
            patchDecision.evidence.begin(),
            patchDecision.evidence.end(),
            [](const FomodDecisionEvidence& evidence)
            {
                return evidence.code == L"tes4.master.provided";
            }));
    }

    TEST(FomodAutoSelectionServiceTests, Tes4MasterProvidedBySameOptionalOptionDoesNotPromoteIt)
    {
        FomodProfileContext context = supportedContext();
        FomodOption bundle = option(L"bundle", L"Optional");
        bundle.pluginHeaders = {
            FomodPluginHeader{
                L"Data\\InternalMaster.esp", {}, FomodPluginHeaderStatus::Parsed, {}},
            FomodPluginHeader{
                L"Data\\InternalPatch.esp",
                {L"InternalMaster.esp"},
                FomodPluginHeaderStatus::Parsed,
                {}}
        };

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(
            descriptorWithGroup(L"SelectAny", {std::move(bundle)}),
            context);

        EXPECT_TRUE(selection.initialSelectedOptionIds.empty());
        EXPECT_EQ(decisionFor(selection, L"bundle").action, FomodOptionDecisionAction::Deselect);
        EXPECT_EQ(decisionFor(selection, L"bundle").reasonCodes[0], L"author.optional");
    }

    TEST(FomodAutoSelectionServiceTests, CouldBeUsableTes4PatchAlwaysRequiresManualReview)
    {
        FomodProfileContext context = supportedContext();
        context.fileStates.push_back(FomodProfileFileState{
            L"Data\\Lanterns.esp",
            FomodProfileFileStateKind::Active,
            L"mod",
            L"Lanterns",
            true
        });
        FomodOption patch = option(L"patch", L"CouldBeUsable");
        patch.pluginHeaders.push_back(FomodPluginHeader{
            L"Data\\Patch.esp",
            {L"Lanterns.esp"},
            FomodPluginHeaderStatus::Parsed,
            {}});

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(
            descriptorWithGroup(L"SelectAny", {std::move(patch)}),
            context);

        EXPECT_TRUE(selection.initialSelectedOptionIds.empty());
        EXPECT_EQ(decisionFor(selection, L"patch").action, FomodOptionDecisionAction::Manual);
        EXPECT_EQ(decisionFor(selection, L"patch").reasonCodes[0], L"fomod.couldBeUsable");
    }

    TEST(FomodAutoSelectionServiceTests, UnreadableTes4HeaderFallsBackToReview)
    {
        FomodProfileContext context = supportedContext();
        FomodOption patch = option(L"patch", L"Recommended");
        patch.pluginHeaders.push_back(FomodPluginHeader{
            L"Data\\Patch.esp",
            {},
            FomodPluginHeaderStatus::Corrupt,
            L"tes4.corruptOrEncrypted"
        });
        const FomodInstallerDescriptor descriptor = descriptorWithGroup(
            L"SelectAny",
            {std::move(patch)});

        const FomodAutoSelection selection = FomodAutoSelectionService::analyze(descriptor, context);

        EXPECT_TRUE(selection.initialSelectedOptionIds.empty());
        EXPECT_EQ(decisionFor(selection, L"patch").action, FomodOptionDecisionAction::Manual);
        EXPECT_EQ(decisionFor(selection, L"patch").reasonCodes[0], L"tes4.reviewRequired");
    }

    TEST(FomodAutoSelectionServiceTests, ContextBindingRejectsChangedProfileRevision)
    {
        FomodProfileContext context = supportedContext();
        context.modRevision = L"mods-1";
        context.pluginRevision = L"plugins-1";
        const std::filesystem::path project = std::filesystem::temp_directory_path() / L"fluxora-context-test";
        const FomodProfileContext bound = FomodAutoSelectionService::bindContext(
            project,
            L"archive-1",
            context);

        EXPECT_NO_THROW(FomodAutoSelectionService::validateContext(
            project,
            L"archive-1",
            bound.contextId,
            context));
        context.pluginRevision = L"plugins-2";
        try
        {
            FomodAutoSelectionService::validateContext(
                project,
                L"archive-1",
                bound.contextId,
                context);
            FAIL() << "Expected stale FOMOD context.";
        }
        catch (const std::runtime_error& error)
        {
            EXPECT_STREQ(error.what(), "install.fomodContextChanged");
        }
    }
}
