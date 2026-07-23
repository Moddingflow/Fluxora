#include "FluxoraCore/Services/ModOrganizerPluginGroupService.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    TEST(ModOrganizerPluginGroupServiceTests, ReadsGroupsInResolvedPluginOrder)
    {
        TempDirectory temp;
        const std::filesystem::path profile = temp.path() / L"profiles" / L"Default";
        writeTextFile(
            profile / L"loadorder.txt",
            "Skyrim.esm\n"
            "Update.esm\n"
            "SkyUI.esp\n"
            "Synthesis.esp\n");
        writeTextFile(
            profile / L"plugins.txt",
            "*Skyrim.esm\n"
            "*SkyUI.esp\n"
            "*Legacy.esp\n"
            "*Synthesis.esp\n");
        writeTextFile(
            profile / L"plugingroups.txt",
            "SkyUI.esp|Interface\n"
            "Synthesis.esp|Patchers\n"
            "Legacy.esp|Legacy\n");

        BuildTemplate resolvedTemplate;
        resolvedTemplate.gameName = L"Skyrim Special Edition";
        resolvedTemplate.basePlugins = {L"Skyrim.esm", L"Update.esm"};

        const std::vector<ProfilePluginOrderImportItemRecord> items =
            ModOrganizerPluginGroupService::read(profile, resolvedTemplate);

        ASSERT_EQ(items.size(), 9U);
        EXPECT_EQ(items[0].kind, L"separator");
        EXPECT_EQ(items[0].separatorTitle, L"Skyrim Special Edition");
        EXPECT_EQ(items[1].kind, L"plugin");
        EXPECT_EQ(items[1].pluginName, L"Skyrim.esm");
        EXPECT_EQ(items[2].kind, L"plugin");
        EXPECT_EQ(items[2].pluginName, L"Update.esm");
        EXPECT_EQ(items[3].kind, L"separator");
        EXPECT_EQ(items[3].separatorTitle, L"Interface");
        EXPECT_EQ(items[4].kind, L"plugin");
        EXPECT_EQ(items[4].pluginName, L"SkyUI.esp");
        EXPECT_EQ(items[5].kind, L"separator");
        EXPECT_EQ(items[5].separatorTitle, L"Patchers");
        EXPECT_EQ(items[6].kind, L"plugin");
        EXPECT_EQ(items[6].pluginName, L"Synthesis.esp");
        EXPECT_EQ(items[7].kind, L"separator");
        EXPECT_EQ(items[7].separatorTitle, L"Legacy");
        EXPECT_EQ(items[8].kind, L"plugin");
        EXPECT_EQ(items[8].pluginName, L"Legacy.esp");
    }

    TEST(ModOrganizerPluginGroupServiceTests, MissingGroupsReturnsEmptyItems)
    {
        TempDirectory temp;
        const std::filesystem::path profile = temp.path() / L"profiles" / L"Default";
        writeTextFile(profile / L"plugins.txt", "*SkyUI.esp\n");

        BuildTemplate resolvedTemplate;
        const std::vector<ProfilePluginOrderImportItemRecord> items =
            ModOrganizerPluginGroupService::read(profile, resolvedTemplate);

        EXPECT_TRUE(items.empty());
    }

    TEST(ModOrganizerPluginGroupServiceTests, GroupsLeadingOfficialContentWithoutHardcodedPluginNames)
    {
        TempDirectory temp;
        const std::filesystem::path profile = temp.path() / L"profiles" / L"Default";
        writeTextFile(
            profile / L"loadorder.txt",
            "Game.master\n"
            "OfficialAddon.light\n"
            "CommunityPatch.plugin\n");
        writeTextFile(
            profile / L"plugins.txt",
            "*Game.master\n"
            "*OfficialAddon.light\n"
            "*CommunityPatch.plugin\n");
        writeTextFile(
            profile / L"plugingroups.txt",
            "CommunityPatch.plugin|Community fixes\n");

        BuildTemplate resolvedTemplate;
        resolvedTemplate.gameName = L"Example Game";
        resolvedTemplate.basePlugins = {L"Game.master"};

        const std::vector<ProfilePluginOrderImportItemRecord> items =
            ModOrganizerPluginGroupService::read(profile, resolvedTemplate);

        ASSERT_EQ(items.size(), 5U);
        EXPECT_EQ(items[0].kind, L"separator");
        EXPECT_EQ(items[0].separatorTitle, L"Example Game");
        EXPECT_EQ(items[1].pluginName, L"Game.master");
        EXPECT_EQ(items[2].pluginName, L"OfficialAddon.light");
        EXPECT_EQ(items[3].kind, L"separator");
        EXPECT_EQ(items[3].separatorTitle, L"Community fixes");
        EXPECT_EQ(items[4].pluginName, L"CommunityPatch.plugin");
    }
}
