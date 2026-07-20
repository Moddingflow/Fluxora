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

    TEST(ModIdentityResolverTests, DifferentNexusFileIdsRequireAProvenLineage)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"SPID 7.2.0";
        incoming.source = {L"nexus", L"skyrimspecialedition", L"36869", L"200"};

        ModIdentityCandidate installed;
        installed.target = {L"mod-spid", L"Spell Perks Item Distributor", L"SPID"};
        installed.source = {L"nexus", L"skyrimspecialedition", L"36869", L"100"};

        const ModIdentityResolution unproven = ModIdentityResolver::resolve(
            incoming,
            {installed});

        EXPECT_FALSE(unproven.matchedTarget.has_value());

        NexusModFilesResponse metadata;
        metadata.fileUpdates = {
            NexusFileUpdateLink{L"100", L"200", 0}
        };
        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {installed},
            &metadata);

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Exact);
        EXPECT_EQ(resolution.matchedTarget->modUuid, L"mod-spid");
        EXPECT_EQ(resolution.suggestedModName, L"Spell Perks Item Distributor");
        EXPECT_EQ(resolution.score, 100);
        EXPECT_NE(
            std::find(
                resolution.evidenceCodes.begin(),
                resolution.evidenceCodes.end(),
                L"nexus.lineage.same-lineage"),
            resolution.evidenceCodes.end());
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

    TEST(ModIdentityResolverTests, ProvenBranchSelectsTheBaseUpdateWithoutCollapsingAParallelFile)
    {
        ModIdentityInput incoming;
        incoming.displayName = L"Dynamic Footprints Skse BASE v3.0";
        incoming.source = {L"nexus", L"skyrimspecialedition", L"175254", L"766239"};
        incoming.content.scriptExtenderDlls = {L"NMN_DynamicFootprints.dll"};

        ModIdentityCandidate base;
        base.target = {
            L"dynamic-footprints-base",
            L"Dynamic Footprints Skse",
            L"Dynamic Footprints Skse"
        };
        base.source = {L"nexus", L"skyrimspecialedition", L"175254", L"745065"};
        base.content.scriptExtenderDlls = {L"NMN_DynamicFootprints.dll"};

        ModIdentityCandidate previousSeparateInstall;
        previousSeparateInstall.target = {
            L"dynamic-footprints-tomatoes",
            L"DynamicFootprintsSkse Tomato's",
            L"DynamicFootprintsSkse Tomato's"
        };
        previousSeparateInstall.source = {
            L"nexus",
            L"skyrimspecialedition",
            L"175254",
            L"745077"
        };
        previousSeparateInstall.content.pluginFiles = {L"NMN_DynamicFootprints.esp"};

        NexusModFilesResponse metadata;
        metadata.fileUpdates = {
            NexusFileUpdateLink{L"745065", L"766239", 0}
        };
        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {base, previousSeparateInstall},
            &metadata);

        ASSERT_TRUE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::Exact);
        EXPECT_EQ(resolution.matchedTarget->modUuid, L"dynamic-footprints-base");
        EXPECT_EQ(resolution.suggestedModName, L"Dynamic Footprints Skse");
        EXPECT_NE(
            std::find(
                resolution.evidenceCodes.begin(),
                resolution.evidenceCodes.end(),
                L"nexus.lineage.same-lineage"),
            resolution.evidenceCodes.end());
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

        NexusModFilesResponse metadata;
        metadata.fileUpdates = {
            NexusFileUpdateLink{L"200", L"210", 0}
        };
        const ModIdentityResolution resolution = ModIdentityResolver::resolve(
            incoming,
            {base, widescreen21x9, widescreen32x9},
            &metadata);

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

    TEST(ModIdentityResolverTests, DifferentNexusPagesDoNotMatchByNameAlone)
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

        EXPECT_FALSE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::None);
    }

    TEST(ModIdentityResolverTests, DifferentNexusPagesDoNotMatchByContentAnchors)
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

        EXPECT_FALSE(resolution.matchedTarget.has_value());
        EXPECT_EQ(resolution.kind, ModIdentityResolutionKind::None);
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

    TEST(ModIdentityResolverTests, DuplicateNexusSourceRejectsNamesWithoutLineageEvidence)
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
        EXPECT_FALSE(named.matchedTarget.has_value());
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
        EXPECT_FALSE(named.matchedTarget.has_value());
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
        request.requestedInstallName = L"My custom install label";
        request.input.displayName = L"SPID 7.2";
        request.input.source = {L"nexus", L"skyrimspecialedition", L"36869", L"200"};
        int networkRequests = 0;
        request.loadNexusFiles = [&networkRequests](
            std::wstring_view,
            std::wstring_view,
            bool allowNetwork)
        {
            if (allowNetwork)
            {
                ++networkRequests;
            }
            NexusModFilesResponse response;
            response.fileUpdates = {NexusFileUpdateLink{L"100", L"200", 0}};
            return NexusFileMetadataLookup{
                NexusFileMetadataSource::Cache,
                std::move(response),
                2
            };
        };
        const FluxoraInstallPlan plan = ModIdentityResolver::createInstallPlan(std::move(request));

        ASSERT_TRUE(plan.matchedTarget.has_value());
        EXPECT_EQ(networkRequests, 0);
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
        EXPECT_EQ(validated.incomingName, L"SPID 7.2");
#endif
    }

    TEST(ModIdentityResolverTests, InstallPlanUsesOneNetworkLookupForAProvenSamePageBranch)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        tests::TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        const std::filesystem::path basePath = mods / L"Dynamic Footprints Skse";
        tests::writeTextFile(
            basePath / L"SKSE" / L"Plugins" / L"NMN_DynamicFootprints.dll",
            "plugin");
        const InstalledModRecord base = InstanceMetadataStore::registerInstalledMod(
            project,
            basePath,
            L"Dynamic Footprints Skse",
            L"2.3",
            ModSourceRecord{L"nexus", L"skyrimspecialedition", L"175254", L"745065"});

        const std::filesystem::path addonPath = mods / L"DynamicFootprintsSkse Tomato's";
        tests::writeTextFile(
            addonPath / L"NMN_DynamicFootprints.esp",
            "plugin");
        (void)InstanceMetadataStore::registerInstalledMod(
            project,
            addonPath,
            L"DynamicFootprintsSkse Tomato's",
            L"2.3",
            ModSourceRecord{L"nexus", L"skyrimspecialedition", L"175254", L"745077"});

        bool contentWasInspected = false;
        ModIdentityPlanRequest request;
        request.projectDirectory = project;
        request.archiveFingerprint = L"dynamic-footprints-base-3.0";
        request.input.displayName = L"Dynamic Footprints Skse BASE v3.0";
        request.input.folderName = request.input.displayName;
        request.input.source = {
            L"nexus",
            L"skyrimspecialedition",
            L"175254",
            L"766239"
        };
        int networkRequests = 0;
        request.loadNexusFiles = [&networkRequests](
            std::wstring_view,
            std::wstring_view,
            bool allowNetwork)
        {
            if (!allowNetwork)
            {
                return NexusFileMetadataLookup{};
            }
            ++networkRequests;
            NexusModFilesResponse response;
            response.fileUpdates = {
                NexusFileUpdateLink{L"745065", L"766239", 0}
            };
            return NexusFileMetadataLookup{
                NexusFileMetadataSource::Network,
                std::move(response),
                4
            };
        };
        request.loadIncomingContent = [&contentWasInspected]()
        {
            contentWasInspected = true;
            ModIdentityContentAnchors content;
            content.scriptExtenderDlls = {L"NMN_DynamicFootprints.dll"};
            return content;
        };

        const FluxoraInstallPlan plan = ModIdentityResolver::createInstallPlan(
            std::move(request));

        EXPECT_FALSE(contentWasInspected);
        EXPECT_EQ(networkRequests, 1);
        ASSERT_TRUE(plan.matchedTarget.has_value());
        EXPECT_EQ(plan.resolutionKind, ModIdentityResolutionKind::Exact);
        EXPECT_EQ(plan.matchedTarget->modUuid, base.uuid);
        EXPECT_EQ(plan.suggestedModName, L"Dynamic Footprints Skse");
#endif
    }

    TEST(ModIdentityResolverTests, InstallPlanKeepsBranchesSeparateWhenMetadataLookupIsUnavailable)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        tests::TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path modPath = project / L"mods" / L"SPID";
        tests::writeTextFile(modPath / L"SKSE" / L"Plugins" / L"SPID.dll", "plugin");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"Spell Perks Item Distributor",
            L"7.1",
            ModSourceRecord{L"nexus", L"skyrimspecialedition", L"36869", L"100"});

        ModIdentityPlanRequest request;
        request.projectDirectory = project;
        request.archiveFingerprint = L"spid-unknown-lineage";
        request.input.displayName = L"Spell Perks Item Distributor";
        request.input.source = {L"nexus", L"skyrimspecialedition", L"36869", L"200"};
        int networkRequests = 0;
        request.loadNexusFiles = [&networkRequests](
            std::wstring_view,
            std::wstring_view,
            bool allowNetwork)
        {
            if (allowNetwork)
            {
                ++networkRequests;
            }
            return NexusFileMetadataLookup{};
        };
        request.loadIncomingContent = []
        {
            ModIdentityContentAnchors content;
            content.scriptExtenderDlls = {L"SPID.dll"};
            return content;
        };

        const FluxoraInstallPlan plan = ModIdentityResolver::createInstallPlan(std::move(request));

        EXPECT_EQ(networkRequests, 1);
        EXPECT_FALSE(plan.matchedTarget.has_value());
        EXPECT_NE(
            std::find(
                plan.evidenceCodes.begin(),
                plan.evidenceCodes.end(),
                L"nexus.metadata.unavailable"),
            plan.evidenceCodes.end());
        EXPECT_NE(
            std::find(
                plan.evidenceCodes.begin(),
                plan.evidenceCodes.end(),
                L"nexus.lineage.unproven-or-different-branch"),
            plan.evidenceCodes.end());
#endif
    }

    TEST(ModIdentityResolverTests, InstallPlanUsesExactArchiveStemAsSafeSamePageFallback)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        tests::TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path modPath = project / L"mods" / L"Based Lighting Configs";
        tests::writeTextFile(modPath / L"LightPlacer" / L"based_lighting.json", "config");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        const InstalledModRecord installed = InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"Based Lighting Configs",
            L"3.1",
            ModSourceRecord{L"nexus", L"skyrimspecialedition", L"136870", L"700001"});

        ModIdentityPlanRequest request;
        request.projectDirectory = project;
        request.archivePath = temp.path() / L"Based Lighting Configs.7z";
        request.archiveFingerprint = L"based-lighting-configs-4.0";
        request.input.displayName = L"Based Lighting Configs";
        request.input.folderName = request.input.displayName;
        request.input.source = {L"nexus", L"skyrimspecialedition", L"136870", L"769909"};
        request.loadNexusFiles = [](
            std::wstring_view,
            std::wstring_view,
            bool)
        {
            return NexusFileMetadataLookup{};
        };
        bool contentWasInspected = false;
        request.loadIncomingContent = [&contentWasInspected]
        {
            contentWasInspected = true;
            return ModIdentityContentAnchors{};
        };

        const FluxoraInstallPlan plan = ModIdentityResolver::createInstallPlan(std::move(request));

        EXPECT_FALSE(contentWasInspected);
        ASSERT_TRUE(plan.matchedTarget.has_value());
        EXPECT_EQ(plan.resolutionKind, ModIdentityResolutionKind::Probable);
        EXPECT_EQ(plan.matchedTarget->modUuid, installed.uuid);
        EXPECT_EQ(plan.suggestedModName, L"Based Lighting Configs");
        EXPECT_NE(
            std::find(
                plan.evidenceCodes.begin(),
                plan.evidenceCodes.end(),
                L"archive.exact-name"),
            plan.evidenceCodes.end());
#endif
    }

    TEST(ModIdentityResolverTests, InstallPlanRejectsCrossPageNexusContentMatch)
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

        EXPECT_FALSE(plan.matchedTarget.has_value());
        EXPECT_EQ(plan.resolutionKind, ModIdentityResolutionKind::None);
        EXPECT_EQ(
            plan.suggestedModName,
            L"Unofficial Skyrim Modder'S Patch   USMP SE");
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
