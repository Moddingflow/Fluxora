#include "FluxoraCore/Services/ModIdentityResolver.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora
{
    TEST(ModIdentityResolverTests, ExpandsConfirmedSpidAbbreviation)
    {
        EXPECT_EQ(
            ModIdentityResolver::canonicalSuggestedName(
                L"Spell Perks Item Distributor (SPID)"),
            L"Spell Perks Item Distributor");
    }

    TEST(ModIdentityResolverTests, StableProviderGameAndModIdIgnoreChangingFileId)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"SPID 7.2.0";
        incoming.source = {L"nexus", L"skyrimspecialedition", L"36869", L"200"};

        ModIdentityCandidate installed;
        installed.target = {L"mod-spid", L"Spell Perks Item Distributor", L"SPID"};
        installed.source = {L"nexus", L"skyrimspecialedition", L"36869", L"100"};

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {installed});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Exact);
        EXPECT_EQ(resolution.matchedTarget->modUuid, L"mod-spid");
        EXPECT_EQ(resolution.suggestedModName, L"Spell Perks Item Distributor");
        EXPECT_EQ(resolution.score, 100);
    }

    TEST(ModIdentityResolverTests, SameNexusPageDoesNotCollapseNamedAddonIntoBaseMod)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Imperial Forts Remake PBR Lod Helper";
        incoming.source = {L"nexus", L"skyrimspecialedition", L"12345", L"200"};

        ModIdentityCandidate installed;
        installed.target = {
            L"imperial-forts-remake-pbr",
            L"Imperial Forts Remake PBR",
            L"Imperial Forts Remake PBR"
        };
        installed.source = {L"nexus", L"skyrimspecialedition", L"12345", L"100"};

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {installed});

        EXPECT_FALSE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::None);
        EXPECT_EQ(resolution.suggestedModName, L"Imperial Forts Remake PBR Lod Helper");
    }

    TEST(ModIdentityResolverTests, SelectsExactWidescreenVariantAmongSamePageFiles)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Dragonborn UI - SkyUI Reskin - Widescreen 21x9";
        incoming.source = {L"nexus", L"skyrimspecialedition", L"23504", L"210"};

        ModIdentityCandidate base;
        base.target = {
            L"dragonborn-ui",
            L"Dragonborn UI - SkyUI Reskin",
            L"Dragonborn UI - SkyUI Reskin"
        };
        base.source = {L"nexus", L"skyrimspecialedition", L"23504", L"100"};

        ModIdentityCandidate widescreen21x9;
        widescreen21x9.target = {
            L"dragonborn-ui-21x9",
            L"Dragonborn UI - SkyUI Reskin - Widescreen 21x9",
            L"Dragonborn UI - SkyUI Reskin - Widescreen 21x9"
        };
        widescreen21x9.source = {
            L"nexus",
            L"skyrimspecialedition",
            L"23504",
            L"200"
        };

        ModIdentityCandidate widescreen32x9;
        widescreen32x9.target = {
            L"dragonborn-ui-32x9",
            L"Dragonborn UI - SkyUI Reskin - Widescreen 32x9",
            L"Dragonborn UI - SkyUI Reskin - Widescreen 32x9"
        };
        widescreen32x9.source = {
            L"nexus",
            L"skyrimspecialedition",
            L"23504",
            L"300"
        };

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {base, widescreen21x9, widescreen32x9});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.matchedTarget->modUuid, L"dragonborn-ui-21x9");
        EXPECT_EQ(
            resolution.suggestedModName,
            L"Dragonborn UI - SkyUI Reskin - Widescreen 21x9");
    }

    TEST(ModIdentityResolverTests, ConfirmedAliasIsAnExactMatch)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"SPID";

        ModIdentityCandidate installed;
        installed.target = {L"mod-spid", L"Spell Perks Item Distributor", L"SPID"};
        installed.aliases = {L"spid"};

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {installed});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Exact);
        EXPECT_EQ(resolution.score, 98);
    }

    TEST(ModIdentityResolverTests, UniqueFomodModuleIdIsAnExactMatch)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"A renamed archive";
        incoming.fomodModuleId = L"spid-module";

        ModIdentityCandidate installed;
        installed.target = {L"mod-spid", L"Spell Perks Item Distributor", L"SPID"};
        installed.fomodModuleId = L"SPID-MODULE";

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {installed});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Exact);
        EXPECT_EQ(resolution.score, 96);
    }

    TEST(ModIdentityResolverTests, SafeNormalizedNameHandlesNfkcSeparatorsAndVersion)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"ＳｋｙＵＩ＿ＳＥ 5.2.0";

        ModIdentityCandidate installed;
        installed.target = {L"mod-skyui", L"SkyUI-SE", L"SkyUI"};

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {installed});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Probable);
        EXPECT_EQ(resolution.score, 90);
    }

    TEST(ModIdentityResolverTests, SignificantParentheticalTextRemainsPartOfIdentity)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Some Mod (Patch) 1.0";

        ModIdentityCandidate base;
        base.target = {L"base", L"Some Mod", L"Some Mod"};
        ModIdentityCandidate patch;
        patch.target = {L"patch", L"Some Mod (Patch)", L"Some Mod (Patch)"};

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {base, patch});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.matchedTarget->modUuid, L"patch");
    }

    TEST(ModIdentityResolverTests, ContentAnchorsCreateProbableMatchWithRequiredMargin)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Amazing Weather Overhaul";
        incoming.content.pluginFiles = {L"AmazingWeather.esp"};
        incoming.content.archiveFiles = {L"AmazingWeather.bsa"};

        ModIdentityCandidate match;
        match.target = {L"weather", L"Amazing Weather", L"Amazing Weather"};
        match.content.pluginFiles = {L"amazingweather.esp"};
        match.content.archiveFiles = {L"amazingweather.bsa"};

        ModIdentityCandidate runnerUp;
        runnerUp.target = {L"weather-patch", L"Amazing Weather Patch", L"Amazing Weather Patch"};

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {match, runnerUp});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Probable);
        EXPECT_EQ(resolution.matchedTarget->modUuid, L"weather");
        EXPECT_GE(resolution.score, 86);
    }

    TEST(ModIdentityResolverTests, ConflictingStableSourceStillSurfacesExactNameCollision)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Unofficial Skyrim Modders Patch";
        incoming.folderName = incoming.displayName;
        incoming.source = {L"nexus", L"skyrimspecialedition", L"49616", L"773384"};

        ModIdentityCandidate installed;
        installed.target = {
            L"installed-usmp",
            L"Unofficial Skyrim Modders Patch",
            L"Unofficial Skyrim Modders Patch"
        };
        installed.source = {L"nexus", L"skyrimspecialedition", L"154565", L"691455"};

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {installed});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.matchedTarget->modUuid, L"installed-usmp");
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Probable);
        EXPECT_NE(
            std::find(
                resolution.evidenceCodes.begin(),
                resolution.evidenceCodes.end(),
                L"source.stable-mod-id-conflict"),
            resolution.evidenceCodes.end());
    }

    TEST(ModIdentityResolverTests, CrossPageUpdateUsesExactNameAndContentAnchors)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Unofficial Skyrim Modder'S Patch   USMP SE";
        incoming.source = {L"nexus", L"skyrimspecialedition", L"49616", L"773384"};
        incoming.content.pluginFiles = {L"Unofficial Skyrim Modders Patch.esp"};
        incoming.content.archiveFiles = {
            L"Unofficial Skyrim Modders Patch.bsa",
            L"Unofficial Skyrim Modders Patch - Textures.bsa"
        };

        ModIdentityCandidate installed;
        installed.target = {
            L"installed-usmp",
            L"Unofficial Skyrim Modder's Patch - USMP SE",
            L"Unofficial Skyrim Modder's Patch - USMP SE"
        };
        installed.source = {L"nexus", L"skyrimspecialedition", L"154565", L"691455"};
        installed.content.pluginFiles = {L"Unofficial Skyrim Modders Patch.esp"};
        installed.content.archiveFiles = {
            L"Unofficial Skyrim Modders Patch.bsa",
            L"Unofficial Skyrim Modders Patch - Textures.bsa"
        };

        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {installed});

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Probable);
        EXPECT_EQ(resolution.matchedTarget->modUuid, L"installed-usmp");
        EXPECT_EQ(
            resolution.suggestedModName,
            L"Unofficial Skyrim Modder's Patch - USMP SE");
    }

    TEST(ModIdentityResolverTests, TieWeakAndExcludedCandidatesKeepTheIncomingName)
    {
        ModIdentityInput tiedInput;
        tiedInput.displayName = L"Same Name 2.0";
        ModIdentityCandidate first;
        first.target = {L"first", L"Same Name", L"Same Name"};
        ModIdentityCandidate second;
        second.target = {L"second", L"Same Name", L"Same Name"};

        const ModIdentityResolution tied = ModIdentityResolver::resolve(
            tiedInput,
            {first, second});
        EXPECT_FALSE(tied.matchedTarget.has_value());
        EXPECT_EQ(tied.suggestedModName, L"Same Name 2.0");

        ModIdentityInput weakInput;
        weakInput.displayName = L"Unrelated Incoming Archive";
        const ModIdentityResolution weak = ModIdentityResolver::resolve(weakInput, {first});
        EXPECT_FALSE(weak.matchedTarget.has_value());

        ModIdentityInput excludedInput;
        excludedInput.displayName = L"Same Name";
        excludedInput.source = {L"nexus", L"skyrimspecialedition", L"500", L"2"};
        first.source = {L"nexus", L"skyrimspecialedition", L"500", L"1"};
        first.excluded = true;
        const ModIdentityResolution excluded = ModIdentityResolver::resolve(excludedInput, {first});
        EXPECT_FALSE(excluded.matchedTarget.has_value());
    }

    TEST(ModIdentityResolverTests, DuplicateStableSourceNeedsAnAdditionalUniqueSignal)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Downloaded Archive";
        incoming.source = {L"nexus", L"skyrimspecialedition", L"36869", L"300"};

        ModIdentityCandidate first;
        first.target = {L"first", L"Spell Perks Item Distributor", L"SPID"};
        first.source = {L"nexus", L"skyrimspecialedition", L"36869", L"100"};
        ModIdentityCandidate second;
        second.target = {L"second", L"SPID Separate Configuration", L"SPID Separate Configuration"};
        second.source = {L"nexus", L"skyrimspecialedition", L"36869", L"200"};

        EXPECT_FALSE(ModIdentityResolver::resolve(incoming, {first, second}).matchedTarget.has_value());

        incoming.displayName = L"Spell Perks Item Distributor";
        const ModIdentityResolution named = ModIdentityResolver::resolve(incoming, {first, second});
        ASSERT_TRUE(named.matchedTarget.has_value());
        EXPECT_EQ(named.matchedTarget->modUuid, L"first");
    }

    TEST(ModIdentityResolverTests, ExclusionDoesNotMakeDuplicateStableSourceUniqueAgain)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Downloaded Archive";
        incoming.source = {L"nexus", L"skyrimspecialedition", L"36869", L"300"};

        ModIdentityCandidate rejected;
        rejected.target = {L"rejected", L"Spell Perks Item Distributor", L"SPID"};
        rejected.source = {L"nexus", L"skyrimspecialedition", L"36869", L"100"};
        rejected.excluded = true;

        ModIdentityCandidate separateCopy;
        separateCopy.target = {
            L"separate",
            L"SPID Separate Configuration",
            L"SPID Separate Configuration"
        };
        separateCopy.source = {L"nexus", L"skyrimspecialedition", L"36869", L"200"};

        const ModIdentityResolution sourceOnly = ModIdentityResolver::resolve(
            incoming,
            {rejected, separateCopy});
        EXPECT_FALSE(sourceOnly.matchedTarget.has_value());

        incoming.displayName = L"SPID Separate Configuration";
        const ModIdentityResolution named = ModIdentityResolver::resolve(
            incoming,
            {rejected, separateCopy});
        ASSERT_TRUE(named.matchedTarget.has_value());
        EXPECT_EQ(named.matchedTarget->modUuid, L"separate");
    }

    TEST(ModIdentityResolverTests, InstallPlanResolvesAndValidatesStableSourceMatch)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        tests::TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path modPath = project / L"mods" / L"SPID";
        tests::writeTextFile(modPath / L"SKSE" / L"Plugins" / L"SPID.dll", "plugin");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        const InstalledModRecord installed = InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"Spell Perks Item Distributor",
            L"7.1",
            ModSourceRecord{L"nexus", L"skyrimspecialedition", L"36869", L"100"});

        ModIdentityPlanRequest request;
        request.projectDirectory = project;
        request.archiveFingerprint = L"archive-fingerprint";
        request.input.displayName = L"SPID 7.2";
        request.input.source = {L"nexus", L"skyrimspecialedition", L"36869", L"200"};
        const FluxoraInstallPlan plan = ModIdentityResolver::createInstallPlan(std::move(request));

        ASSERT_TRUE(plan.matchedTarget.has_value());
        EXPECT_EQ(plan.resolutionKind, ModIdentityResolutionKind::Exact);
        EXPECT_EQ(plan.matchedTarget->modUuid, installed.uuid);
        EXPECT_THROW(
            (void)ModIdentityResolver::validateInstallPlan(
                project,
                L"archive-fingerprint",
                ModIdentityInstallSelection{
                    plan.resolutionId,
                    InstallIdentityDecision::UseMatch,
                    {},
                    NewNamePolicy::FirstFreeCopySuffix
                }),
            InstallIdentityPlanStaleError);
        const ValidatedModIdentityInstall validated = ModIdentityResolver::validateInstallPlan(
            project,
            L"archive-fingerprint",
            ModIdentityInstallSelection{
                plan.resolutionId,
                InstallIdentityDecision::UseMatch,
                installed.uuid,
                NewNamePolicy::FirstFreeCopySuffix
            });
        ASSERT_TRUE(validated.matchedTarget.has_value());
        EXPECT_EQ(validated.matchedTarget->displayName, L"Spell Perks Item Distributor");
#endif
    }

    TEST(ModIdentityResolverTests, InstallPlanMatchesCrossPageUpdateAfterContentInspection)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        tests::TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path modPath =
            project / L"mods" / L"Unofficial Skyrim Modder's Patch - USMP SE";
        tests::writeTextFile(
            modPath / L"Data" / L"Unofficial Skyrim Modders Patch.esp",
            "plugin");
        tests::writeTextFile(
            modPath / L"Data" / L"Unofficial Skyrim Modders Patch.bsa",
            "archive");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        const InstalledModRecord installed = InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"Unofficial Skyrim Modder's Patch - USMP SE",
            L"2.6.7.0",
            ModSourceRecord{
                L"nexus",
                L"skyrimspecialedition",
                L"154565",
                L"691455"});

        ModIdentityPlanRequest request;
        request.projectDirectory = project;
        request.archiveFingerprint = L"usmp-2.6.8b";
        request.input.displayName = L"Unofficial Skyrim Modder'S Patch   USMP SE";
        request.input.folderName = request.input.displayName;
        request.input.source = {
            L"nexus",
            L"skyrimspecialedition",
            L"49616",
            L"773384"
        };
        request.loadIncomingContent = []()
        {
            return ModIdentityContentAnchors{
                {L"Unofficial Skyrim Modders Patch.esp"},
                {L"Unofficial Skyrim Modders Patch.bsa"},
                {}
            };
        };

        const FluxoraInstallPlan plan = ModIdentityResolver::createInstallPlan(
            std::move(request));

        ASSERT_TRUE(plan.matchedTarget.has_value());
        EXPECT_EQ(plan.resolutionKind, ModIdentityResolutionKind::Probable);
        EXPECT_EQ(plan.matchedTarget->modUuid, installed.uuid);
        EXPECT_EQ(
            plan.suggestedModName,
            L"Unofficial Skyrim Modder's Patch - USMP SE");
#endif
    }

    TEST(ModIdentityResolverTests, InstallPlanBecomesStaleAfterCatalogMutation)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        tests::TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        ModIdentityPlanRequest request;
        request.projectDirectory = project;
        request.archiveFingerprint = L"archive-fingerprint";
        request.input.displayName = L"New Mod";
        const FluxoraInstallPlan plan = ModIdentityResolver::createInstallPlan(std::move(request));

        const std::filesystem::path otherPath = project / L"mods" / L"Other";
        tests::writeTextFile(otherPath / L"Data" / L"Other.esp", "plugin");
        (void)InstanceMetadataStore::registerInstalledMod(
            project,
            otherPath,
            L"Other",
            L"1.0",
            ModSourceRecord{L"manual"});

        EXPECT_THROW(
            (void)ModIdentityResolver::validateInstallPlan(
                project,
                L"archive-fingerprint",
                ModIdentityInstallSelection{
                    plan.resolutionId,
                    InstallIdentityDecision::InstallNew,
                    {},
                    NewNamePolicy::FirstFreeCopySuffix
                }),
            InstallIdentityPlanStaleError);
#endif
    }

    TEST(ModIdentityResolverTests, InstallPlanReusesFingerprintScopedIncomingContentCache)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        tests::TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path modPath = project / L"mods" / L"Amazing Weather Classic";
        tests::writeTextFile(modPath / L"Data" / L"Weather.esp", "plugin");
        tests::writeTextFile(modPath / L"Data" / L"Weather.bsa", "archive");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        (void)InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"Amazing Weather Classic",
            L"1.0",
            ModSourceRecord{L"manual"});

        int loadCount = 0;
        const auto createPlan = [&]()
        {
            ModIdentityPlanRequest request;
            request.projectDirectory = project;
            request.archiveFingerprint = L"archive-fingerprint";
            request.input.displayName = L"Amazing Weather Overhaul";
            request.loadIncomingContent = [&]()
            {
                ++loadCount;
                return ModIdentityContentAnchors{
                    {L"Weather.esp"},
                    {L"Weather.bsa"},
                    {}
                };
            };
            return ModIdentityResolver::createInstallPlan(std::move(request));
        };

        ASSERT_TRUE(createPlan().matchedTarget.has_value());
        ASSERT_TRUE(createPlan().matchedTarget.has_value());
        EXPECT_EQ(loadCount, 1);
#endif
    }
}
