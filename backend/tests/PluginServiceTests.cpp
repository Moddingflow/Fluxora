#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PluginService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        class FakePluginRulesProvider final : public IPluginRulesProvider
        {
        public:
            explicit FakePluginRulesProvider(PluginSupportRules rules)
                : rules_(std::move(rules))
            {
            }

            [[nodiscard]] const PluginSupportRules& pluginRules() const noexcept override
            {
                return rules_;
            }

        private:
            PluginSupportRules rules_;
        };

        const PluginEntry* findPlugin(
            const std::vector<PluginEntry>& plugins,
            std::wstring_view name)
        {
            const auto match = std::find_if(
                plugins.begin(),
                plugins.end(),
                [name](const PluginEntry& plugin)
                {
                    return plugin.kind == L"plugin" && plugin.name == name;
                });
            return match == plugins.end() ? nullptr : &(*match);
        }

        void expectEquivalentPath(
            const std::filesystem::path& actual,
            const std::filesystem::path& expected)
        {
            std::error_code error;
            const bool isEquivalent = std::filesystem::equivalent(actual, expected, error);
            EXPECT_FALSE(error) << "actual=" << actual.string() << ", expected=" << expected.string();
            EXPECT_TRUE(isEquivalent) << "actual=" << actual.string() << ", expected=" << expected.string();
        }

        [[nodiscard]] CapabilitySet capabilities(bool plugins, bool loadOrder)
        {
            CapabilitySet set;
            if (plugins)
            {
                set.enable(GameCapability::Plugins);
            }
            if (loadOrder)
            {
                set.enable(GameCapability::LoadOrder);
            }
            return set;
        }

        [[nodiscard]] PluginSupportRules customRules()
        {
            PluginSupportRules rules;
            rules.pluginExtensions = {
                NormalizedExtension::parseOrThrow(L"ABC"),
                NormalizedExtension::parseOrThrow(L".MASTER")
            };
            rules.profileFiles = {L"enabled.dat", L"order.dat"};
            rules.basePlugins = {L"Base.master"};
            rules.pluginSearchDirectories = {std::filesystem::path(L"AddOns")};
            rules.masterPluginExtensions = {NormalizedExtension::parseOrThrow(L"MASTER")};
            rules.activePluginsFileName = L"enabled.dat";
            rules.loadOrderFileName = L"order.dat";
            rules.basePluginSourceLabel = L"Custom Game";
            rules.basePluginLockReason = L"Custom base plugin lock";
            return rules;
        }

        void appendLittleEndian16(std::string& value, std::uint16_t number)
        {
            value.push_back(static_cast<char>(number & 0xFF));
            value.push_back(static_cast<char>((number >> 8) & 0xFF));
        }

        void appendLittleEndian32(std::string& value, std::uint32_t number)
        {
            value.push_back(static_cast<char>(number & 0xFF));
            value.push_back(static_cast<char>((number >> 8) & 0xFF));
            value.push_back(static_cast<char>((number >> 16) & 0xFF));
            value.push_back(static_cast<char>((number >> 24) & 0xFF));
        }

        void appendPluginSubrecord(std::string& value, std::string_view type, std::string data)
        {
            value.append(type.data(), type.size());
            appendLittleEndian16(value, static_cast<std::uint16_t>(data.size()));
            value.append(data);
        }

        void writeBethesdaPluginFile(
            const std::filesystem::path& path,
            const std::vector<std::string_view>& masters,
            std::uint32_t recordFlags = 0)
        {
            std::string payload;
            appendPluginSubrecord(payload, "HEDR", std::string(12, '\0'));
            for (std::string_view master : masters)
            {
                std::string masterData(master);
                masterData.push_back('\0');
                appendPluginSubrecord(payload, "MAST", std::move(masterData));
                appendPluginSubrecord(payload, "DATA", std::string(8, '\0'));
            }

            std::string file;
            file.append("TES4", 4);
            appendLittleEndian32(file, static_cast<std::uint32_t>(payload.size()));
            appendLittleEndian32(file, recordFlags);
            file.append(12, '\0');
            file.append(payload);
            writeTextFile(path, file);
        }
    }

    TEST(PluginServiceTests, SkyrimRulesRecognizeRootAndDataWrappedPlugins)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service parity test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Skyrim Build";
        const std::filesystem::path mods = project / L"mods";
        writeTextFile(mods / L"Weather" / L"Weather.esm", "master");
        writeTextFile(mods / L"SkyUI" / L"Data" / L"SkyUI.esp", "plugin");
        writeTextFile(mods / L"Light" / L"Data" / L"Light.esl", "light");
        writeBethesdaPluginFile(
            mods / L"ESL Flagged Patch" / L"Data" / L"ESLFlaggedPatch.esp",
            {},
            0x00000200);

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Weather", L"Weather", {}, true, {}},
                InstalledModImportRecord{mods / L"SkyUI", L"SkyUI", {}, true, {}},
                InstalledModImportRecord{mods / L"Light", L"Light", {}, true, {}},
                InstalledModImportRecord{mods / L"ESL Flagged Patch", L"ESL Flagged Patch", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        GameSupportRegistry registry;
        registry.loadEmbeddedDefinitions();
        const GameSupportLookupResult lookup = registry.lookupById(L"skyrimse");
        ASSERT_TRUE(lookup.supported);
        ASSERT_NE(lookup.support, nullptr);
        ASSERT_NE(lookup.support->components().pluginRulesProvider, nullptr);

        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        const std::vector<PluginEntry> entries =
            plugins.listPlugins(
                project,
                PluginRuleContext{
                    lookup.support->components().pluginRulesProvider,
                    &lookup.support->capabilities(),
                    nullptr,
                    lookup.support->identity().defaultProfileName
                },
                L"Default");

        const PluginEntry* skyrim = findPlugin(entries, L"Skyrim.esm");
        ASSERT_NE(skyrim, nullptr);
        EXPECT_TRUE(skyrim->isEnabled);
        EXPECT_TRUE(skyrim->isLocked);
        EXPECT_TRUE(skyrim->isMaster);
        EXPECT_EQ(skyrim->sourceMod, L"Skyrim Special Edition");

        const PluginEntry* weather = findPlugin(entries, L"Weather.esm");
        ASSERT_NE(weather, nullptr);
        EXPECT_TRUE(weather->isMaster);
        EXPECT_FALSE(weather->isLocked);
        EXPECT_EQ(weather->sourceMod, L"Weather");
        expectEquivalentPath(weather->path, mods / L"Weather" / L"Weather.esm");

        const PluginEntry* skyui = findPlugin(entries, L"SkyUI.esp");
        ASSERT_NE(skyui, nullptr);
        EXPECT_EQ(skyui->extension, L"ESP");
        EXPECT_EQ(skyui->sourceMod, L"SkyUI");
        expectEquivalentPath(skyui->path, mods / L"SkyUI" / L"Data" / L"SkyUI.esp");
        EXPECT_FALSE(skyui->isLight);
        EXPECT_FALSE(skyui->hasLightFlag);

        const PluginEntry* light = findPlugin(entries, L"Light.esl");
        ASSERT_NE(light, nullptr);
        EXPECT_TRUE(light->isLight);
        EXPECT_FALSE(light->hasLightFlag);

        const PluginEntry* eslFlaggedPatch = findPlugin(entries, L"ESLFlaggedPatch.esp");
        ASSERT_NE(eslFlaggedPatch, nullptr);
        EXPECT_EQ(eslFlaggedPatch->extension, L"ESP");
        EXPECT_TRUE(eslFlaggedPatch->isLight);
        EXPECT_TRUE(eslFlaggedPatch->hasLightFlag);
        EXPECT_FALSE(eslFlaggedPatch->isMaster);

        EXPECT_THROW(
            (void)plugins.setPluginEnabled(
                project,
                PluginRuleContext{
                    lookup.support->components().pluginRulesProvider,
                    &lookup.support->capabilities(),
                    nullptr,
                    lookup.support->identity().defaultProfileName
                },
                L"Default",
                L"Skyrim.esm",
                false),
            std::invalid_argument);
#endif
    }

    TEST(PluginServiceTests, SkyrimRulesIncludeStockGameDataPlugins)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service parity test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Skyrim Stock Build";
        const std::filesystem::path stockGame = project / L"Stock Game";
        const std::filesystem::path mods = project / L"mods";

        writeTextFile(stockGame / L"SkyrimSE.exe", "exe");
        writeTextFile(stockGame / L"Data" / L"Skyrim.esm", "base");
        writeTextFile(stockGame / L"Data" / L"ccBGSSSE001-Fish.esm", "creation club master");
        writeTextFile(stockGame / L"Data" / L"ccQDRSSE001-SurvivalMode.esl", "creation club light");
        writeTextFile(
            mods / L"Survival Override" / L"Data" / L"ccQDRSSE001-SurvivalMode.esl",
            "mod override");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Survival Override", L"Survival Override", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        GameSupportRegistry registry;
        registry.loadEmbeddedDefinitions();
        const GameSupportLookupResult lookup = registry.lookupById(L"skyrimse");
        ASSERT_TRUE(lookup.supported);
        ASSERT_NE(lookup.support, nullptr);
        ASSERT_NE(lookup.support->components().pluginRulesProvider, nullptr);

        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        const std::vector<PluginEntry> entries =
            plugins.listPlugins(
                project,
                PluginRuleContext{
                    lookup.support->components().pluginRulesProvider,
                    &lookup.support->capabilities(),
                    nullptr,
                    lookup.support->identity().defaultProfileName
                },
                L"Default");

        const PluginEntry* base = findPlugin(entries, L"Skyrim.esm");
        ASSERT_NE(base, nullptr);
        EXPECT_TRUE(base->isLocked);
        EXPECT_EQ(base->sourceMod, L"Skyrim Special Edition");
        expectEquivalentPath(base->path, stockGame / L"Data" / L"Skyrim.esm");

        const PluginEntry* stockMaster = findPlugin(entries, L"ccBGSSSE001-Fish.esm");
        ASSERT_NE(stockMaster, nullptr);
        EXPECT_TRUE(stockMaster->isEnabled);
        EXPECT_TRUE(stockMaster->isMaster);
        EXPECT_FALSE(stockMaster->isLocked);
        EXPECT_EQ(stockMaster->sourceMod, L"Data");
        expectEquivalentPath(stockMaster->path, stockGame / L"Data" / L"ccBGSSSE001-Fish.esm");

        const PluginEntry* overriddenLight = findPlugin(entries, L"ccQDRSSE001-SurvivalMode.esl");
        ASSERT_NE(overriddenLight, nullptr);
        EXPECT_TRUE(overriddenLight->isLight);
        EXPECT_EQ(overriddenLight->sourceMod, L"Survival Override");
        expectEquivalentPath(
            overriddenLight->path,
            mods / L"Survival Override" / L"Data" / L"ccQDRSSE001-SurvivalMode.esl");
#endif
    }

    TEST(PluginServiceTests, ProviderRulesDriveExtensionsSearchPathsAndStateFilesWithoutSkyrimFallback)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Custom Build";
        const std::filesystem::path mods = project / L"mods";
        writeTextFile(mods / L"Custom Mod" / L"AddOns" / L"Custom.ABC", "plugin");
        writeTextFile(mods / L"Custom Mod" / L"Data" / L"Leaked.esp", "skyrim plugin");
        writeTextFile(mods / L"Custom Mod" / L"Root.ABC", "root plugin");

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Custom Mod", L"Custom Mod", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const std::vector<PluginEntry> entries = plugins.listPlugins(
            project,
            PluginRuleContext{&provider, &caps, nullptr, L"Default"},
            L"Default");

        const PluginEntry* base = findPlugin(entries, L"Base.master");
        ASSERT_NE(base, nullptr);
        EXPECT_TRUE(base->isLocked);
        EXPECT_TRUE(base->isMaster);
        EXPECT_EQ(base->sourceMod, L"Custom Game");
        EXPECT_EQ(base->lockReason, L"Custom base plugin lock");

        const PluginEntry* custom = findPlugin(entries, L"Custom.ABC");
        ASSERT_NE(custom, nullptr);
        EXPECT_EQ(custom->extension, L"ABC");
        EXPECT_EQ(custom->sourceMod, L"Custom Mod");
        EXPECT_FALSE(custom->isMaster);
        EXPECT_FALSE(custom->isLight);

        EXPECT_EQ(findPlugin(entries, L"Leaked.esp"), nullptr);
        EXPECT_EQ(findPlugin(entries, L"Root.ABC"), nullptr);
        EXPECT_TRUE(std::filesystem::exists(project / L"profiles" / L"Default" / L"enabled.dat"));
        EXPECT_FALSE(std::filesystem::exists(project / L"profiles" / L"Default" / L"plugins.txt"));
#endif
    }

    TEST(PluginServiceTests, PersistedListUsesProfileStateWithoutLiveInventoryDiscovery)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Plugin persistence counters are enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Persisted Plugin Build";
        const std::filesystem::path profile = project / L"profiles" / L"Default";
        writeTextFile(
            profile / L"enabled.dat",
            "*Base.master\n*Persisted.ABC\nDisabled.ABC\nIgnored.txt\n");
        writeTextFile(
            profile / L"order.dat",
            "Base.master\nPersisted.ABC\nDisabled.ABC\nLoadOrderOnly.ABC\n");
        writeTextFile(project / L"mods" / L"Offline" / L"AddOns" / L"Offline.ABC", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::replaceProfilePluginOrderItems(
            project,
            L"Default",
            {
                ProfilePluginOrderImportItemRecord{L"separator", {}, L"Persisted Group"},
                ProfilePluginOrderImportItemRecord{L"plugin", L"Persisted.ABC", {}},
                ProfilePluginOrderImportItemRecord{L"plugin", L"Disabled.ABC", {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();
        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        InstanceMetadataStore::resetInventorySyncCountForTesting();

        const std::vector<PluginEntry> entries = plugins.listPersistedPlugins(
            project,
            PluginRuleContext{&provider, &caps, nullptr, L"Default"},
            L"Default");

        const PluginEntry* base = findPlugin(entries, L"Base.master");
        ASSERT_NE(base, nullptr);
        EXPECT_TRUE(base->isEnabled);
        EXPECT_TRUE(base->isLocked);
        EXPECT_TRUE(base->isMaster);
        EXPECT_EQ(base->sourceMod, L"Custom Game");

        const PluginEntry* persisted = findPlugin(entries, L"Persisted.ABC");
        ASSERT_NE(persisted, nullptr);
        EXPECT_TRUE(persisted->isEnabled);
        EXPECT_EQ(persisted->extension, L"ABC");
        EXPECT_TRUE(persisted->sourceMod.empty());
        EXPECT_TRUE(persisted->path.empty());
        EXPECT_TRUE(persisted->masterFiles.empty());
        EXPECT_TRUE(persisted->missingMasters.empty());

        const PluginEntry* disabled = findPlugin(entries, L"Disabled.ABC");
        ASSERT_NE(disabled, nullptr);
        EXPECT_FALSE(disabled->isEnabled);
        const PluginEntry* loadOrderOnly = findPlugin(entries, L"LoadOrderOnly.ABC");
        ASSERT_NE(loadOrderOnly, nullptr);
        EXPECT_FALSE(loadOrderOnly->isEnabled);
        EXPECT_EQ(findPlugin(entries, L"Offline.ABC"), nullptr);
        EXPECT_EQ(findPlugin(entries, L"Ignored.txt"), nullptr);
        EXPECT_TRUE(std::any_of(
            entries.begin(),
            entries.end(),
            [](const PluginEntry& entry)
            {
                return entry.kind == L"separator" && entry.separatorTitle == L"Persisted Group";
            }));
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 0U);
#endif
    }

    TEST(PluginServiceTests, BulkPluginEnablePersistsUnlockedPluginsTogether)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Bulk Plugin Build";
        const std::filesystem::path mods = project / L"mods";
        writeTextFile(mods / L"Custom Mod" / L"AddOns" / L"Custom.ABC", "plugin");
        writeTextFile(mods / L"Patch Mod" / L"AddOns" / L"Patch.ABC", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Custom Mod", L"Custom Mod", {}, true, {}},
                InstalledModImportRecord{mods / L"Patch Mod", L"Patch Mod", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};

        const std::vector<PluginEntry> disabled =
            plugins.setAllPluginsEnabled(project, context, L"Default", false);
        const PluginEntry* disabledBase = findPlugin(disabled, L"Base.master");
        const PluginEntry* disabledCustom = findPlugin(disabled, L"Custom.ABC");
        const PluginEntry* disabledPatch = findPlugin(disabled, L"Patch.ABC");
        ASSERT_NE(disabledBase, nullptr);
        ASSERT_NE(disabledCustom, nullptr);
        ASSERT_NE(disabledPatch, nullptr);
        EXPECT_TRUE(disabledBase->isEnabled);
        EXPECT_FALSE(disabledCustom->isEnabled);
        EXPECT_FALSE(disabledPatch->isEnabled);
        EXPECT_EQ(
            readTextFile(project / L"profiles" / L"Default" / L"enabled.dat"),
            "*Base.master\nCustom.ABC\nPatch.ABC\n");

        const std::vector<PluginEntry> enabled =
            plugins.setAllPluginsEnabled(project, context, L"Default", true);
        const PluginEntry* enabledBase = findPlugin(enabled, L"Base.master");
        const PluginEntry* enabledCustom = findPlugin(enabled, L"Custom.ABC");
        const PluginEntry* enabledPatch = findPlugin(enabled, L"Patch.ABC");
        ASSERT_NE(enabledBase, nullptr);
        ASSERT_NE(enabledCustom, nullptr);
        ASSERT_NE(enabledPatch, nullptr);
        EXPECT_TRUE(enabledBase->isEnabled);
        EXPECT_TRUE(enabledCustom->isEnabled);
        EXPECT_TRUE(enabledPatch->isEnabled);
        EXPECT_EQ(
            readTextFile(project / L"profiles" / L"Default" / L"enabled.dat"),
            "*Base.master\n*Custom.ABC\n*Patch.ABC\n");
#endif
    }

    TEST(PluginServiceTests, DisabledSourceModPluginsAreRemovedFromStateFiles)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Disabled Source Plugin Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path visibleMod = mods / L"Visible Mod";
        const std::filesystem::path hiddenMod = mods / L"Hidden Mod";
        const std::filesystem::path pluginState = project / L"profiles" / L"Default" / L"enabled.dat";
        writeTextFile(visibleMod / L"AddOns" / L"Visible.ABC", "plugin");
        writeTextFile(hiddenMod / L"AddOns" / L"Hidden.ABC", "plugin");
        writeTextFile(pluginState, "*Base.master\n*Visible.ABC\n*Hidden.ABC\n");

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{visibleMod, L"Visible Mod", {}, true, {}},
                InstalledModImportRecord{hiddenMod, L"Hidden Mod", {}, false, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};

        const std::vector<PluginEntry> disabledEntries =
            plugins.listPlugins(project, context, L"Default");
        EXPECT_NE(findPlugin(disabledEntries, L"Visible.ABC"), nullptr);
        EXPECT_EQ(findPlugin(disabledEntries, L"Hidden.ABC"), nullptr);
        const std::string afterDisable = readTextFile(pluginState);
        EXPECT_NE(afterDisable.find("*Visible.ABC\n"), std::string::npos) << afterDisable;
        EXPECT_EQ(afterDisable.find("Hidden.ABC"), std::string::npos) << afterDisable;

        InstanceMetadataStore::setInstalledModEnabled(project, hiddenMod, true);
        plugins.syncPluginsForInstalledMods(project, context, L"Default", true);

        const std::vector<PluginEntry> enabledEntries =
            plugins.listPlugins(project, context, L"Default");
        const PluginEntry* hidden = findPlugin(enabledEntries, L"Hidden.ABC");
        ASSERT_NE(hidden, nullptr);
        EXPECT_TRUE(hidden->isEnabled);
        EXPECT_EQ(hidden->sourceMod, L"Hidden Mod");
        EXPECT_NE(readTextFile(pluginState).find("*Hidden.ABC\n"), std::string::npos);
#endif
    }

    TEST(PluginServiceTests, PluginEntriesReportMissingMasterFiles)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Master Warning Build";
        const std::filesystem::path mods = project / L"mods";
        writeBethesdaPluginFile(mods / L"Required Master" / L"AddOns" / L"Existing.master", {});
        writeBethesdaPluginFile(mods / L"Disabled Master" / L"AddOns" / L"Disabled.master", {});
        writeBethesdaPluginFile(
            mods / L"Patch" / L"AddOns" / L"Patch.ABC",
            {
                "Base.master",
                "Existing.master",
                "Missing.master",
                "Disabled.master"
            });

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Required Master", L"Required Master", {}, true, {}},
                InstalledModImportRecord{mods / L"Disabled Master", L"Disabled Master", {}, false, {}},
                InstalledModImportRecord{mods / L"Patch", L"Patch", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const std::vector<PluginEntry> entries = plugins.listPlugins(
            project,
            PluginRuleContext{&provider, &caps, nullptr, L"Default"},
            L"Default");

        const PluginEntry* patch = findPlugin(entries, L"Patch.ABC");
        ASSERT_NE(patch, nullptr);
        ASSERT_EQ(patch->masterFiles.size(), 4);
        EXPECT_EQ(patch->masterFiles[0], L"Base.master");
        EXPECT_EQ(patch->masterFiles[1], L"Existing.master");
        EXPECT_EQ(patch->masterFiles[2], L"Missing.master");
        EXPECT_EQ(patch->masterFiles[3], L"Disabled.master");
        ASSERT_EQ(patch->missingMasters.size(), 2);
        EXPECT_EQ(patch->missingMasters[0], L"Missing.master");
        EXPECT_EQ(patch->missingMasters[1], L"Disabled.master");

        const PluginEntry* existing = findPlugin(entries, L"Existing.master");
        ASSERT_NE(existing, nullptr);
        EXPECT_TRUE(existing->missingMasters.empty());
#endif
    }

    TEST(PluginServiceTests, RepeatedListPluginsInvalidatesCacheWhenSearchDirectoryChanges)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Cached Plugin Build";
        const std::filesystem::path mods = project / L"mods";
        constexpr int modCount = 500;
        constexpr int sentinelIndex = 237;

        std::vector<InstalledModImportRecord> imports;
        imports.reserve(modCount);
        for (int index = 0; index < modCount; ++index)
        {
            const std::wstring folderName = L"Mod " + std::to_wstring(index);
            const std::wstring pluginName = L"Plugin" + std::to_wstring(index) + L".ABC";
            const std::filesystem::path modDirectory = mods / std::filesystem::path(folderName);
            writeTextFile(modDirectory / L"Nested" / L"Plugins" / pluginName, "plugin");
            imports.push_back(InstalledModImportRecord{
                modDirectory,
                folderName,
                {},
                true,
                {},
                false
            });
        }

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(project, imports);

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        PluginSupportRules rules = customRules();
        rules.pluginSearchDirectories = {
            std::filesystem::path(L"AddOns"),
            std::filesystem::path(L"Nested") / L"Plugins"
        };
        FakePluginRulesProvider provider(std::move(rules));
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};
        const std::wstring sentinelPlugin =
            L"Plugin" + std::to_wstring(sentinelIndex) + L".ABC";
        const std::filesystem::path sentinelSearchDirectory =
            mods / (L"Mod " + std::to_wstring(sentinelIndex)) / L"Nested" / L"Plugins";

        const std::vector<PluginEntry> first = plugins.listPlugins(project, context, L"Default");
        ASSERT_NE(findPlugin(first, sentinelPlugin), nullptr);

        std::filesystem::remove_all(sentinelSearchDirectory);

        const std::vector<PluginEntry> second = plugins.listPlugins(project, context, L"Default");
        EXPECT_EQ(findPlugin(second, sentinelPlugin), nullptr);

        writeTextFile(sentinelSearchDirectory / sentinelPlugin, "plugin");

        const std::vector<PluginEntry> afterRestore =
            plugins.listPlugins(project, context, L"Default");
        EXPECT_NE(findPlugin(afterRestore, sentinelPlugin), nullptr);
#endif
    }

    TEST(PluginServiceTests, RepeatedListPluginsDoesNotRewriteUnchangedProfileState)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Stable Plugin State Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path pluginPath = mods / L"Example Mod" / L"AddOns" / L"Example.ABC";
        writeTextFile(pluginPath, "plugin");

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Example Mod", L"Example Mod", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};

        const std::vector<PluginEntry> first = plugins.listPlugins(project, context, L"Default");
        ASSERT_NE(findPlugin(first, L"Example.ABC"), nullptr);

        const std::filesystem::path statePath = project / L"profiles" / L"Default" / L"enabled.dat";
        ASSERT_TRUE(std::filesystem::exists(statePath));
        const std::string firstContent = readTextFile(statePath);
        const std::filesystem::file_time_type firstWriteTime =
            std::filesystem::last_write_time(statePath);

        std::this_thread::sleep_for(std::chrono::milliseconds(25));
        const std::vector<PluginEntry> second = plugins.listPlugins(project, context, L"Default");

        EXPECT_NE(findPlugin(second, L"Example.ABC"), nullptr);
        EXPECT_EQ(readTextFile(statePath), firstContent);
        EXPECT_EQ(std::filesystem::last_write_time(statePath), firstWriteTime);
#endif
    }

    TEST(PluginServiceTests, RestoredPluginReturnsToCachedProfileOrderPosition)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Plugin Order Restore Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path alphaPlugin = mods / L"Alpha Mod" / L"AddOns" / L"Alpha.ABC";
        const std::filesystem::path betaPlugin = mods / L"Beta Mod" / L"AddOns" / L"Beta.ABC";
        writeTextFile(alphaPlugin, "plugin");
        writeTextFile(betaPlugin, "plugin");

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Alpha Mod", L"Alpha Mod", {}, true, {}},
                InstalledModImportRecord{mods / L"Beta Mod", L"Beta Mod", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};

        const std::vector<PluginEntry> initial = plugins.listPlugins(project, context, L"Default");
        const PluginEntry* beta = findPlugin(initial, L"Beta.ABC");
        ASSERT_NE(beta, nullptr);

        const std::vector<PluginEntry> moved =
            plugins.movePlugin(project, context, L"Default", beta->orderId, 1);
        ASSERT_GE(moved.size(), 3U);
        EXPECT_EQ(moved[0].name, L"Base.master");
        EXPECT_EQ(moved[1].name, L"Beta.ABC");
        EXPECT_EQ(moved[2].name, L"Alpha.ABC");

        std::filesystem::remove(betaPlugin);
        const std::vector<PluginEntry> afterDelete =
            plugins.listPlugins(project, context, L"Default");
        EXPECT_EQ(findPlugin(afterDelete, L"Beta.ABC"), nullptr);
        ASSERT_NE(findPlugin(afterDelete, L"Alpha.ABC"), nullptr);

        writeTextFile(betaPlugin, "plugin");
        const std::vector<PluginEntry> afterRestore =
            plugins.listPlugins(project, context, L"Default");
        ASSERT_GE(afterRestore.size(), 3U);
        EXPECT_EQ(afterRestore[0].name, L"Base.master");
        EXPECT_EQ(afterRestore[1].name, L"Beta.ABC");
        EXPECT_EQ(afterRestore[2].name, L"Alpha.ABC");
#endif
    }

    TEST(PluginServiceTests, MovePluginUsesVisibleOrderWhenAnotherPluginIsTemporarilyMissing)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Visible Plugin Order Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path alphaPlugin = mods / L"Alpha Mod" / L"AddOns" / L"Alpha.ABC";
        const std::filesystem::path betaPlugin = mods / L"Beta Mod" / L"AddOns" / L"Beta.ABC";
        const std::filesystem::path gammaPlugin = mods / L"Gamma Mod" / L"AddOns" / L"Gamma.ABC";
        writeTextFile(alphaPlugin, "plugin");
        writeTextFile(betaPlugin, "plugin");
        writeTextFile(gammaPlugin, "plugin");

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Alpha Mod", L"Alpha Mod", {}, true, {}},
                InstalledModImportRecord{mods / L"Beta Mod", L"Beta Mod", {}, true, {}},
                InstalledModImportRecord{mods / L"Gamma Mod", L"Gamma Mod", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};
        const std::vector<PluginEntry> initial = plugins.listPlugins(project, context, L"Default");
        ASSERT_NE(findPlugin(initial, L"Alpha.ABC"), nullptr);
        ASSERT_NE(findPlugin(initial, L"Beta.ABC"), nullptr);
        ASSERT_NE(findPlugin(initial, L"Gamma.ABC"), nullptr);

        std::filesystem::remove(betaPlugin);
        const std::vector<PluginEntry> withMissingPlugin =
            plugins.listPlugins(project, context, L"Default");
        const PluginEntry* alpha = findPlugin(withMissingPlugin, L"Alpha.ABC");
        ASSERT_NE(alpha, nullptr);
        ASSERT_EQ(findPlugin(withMissingPlugin, L"Beta.ABC"), nullptr);

        const std::vector<PluginEntry> moved =
            plugins.movePlugin(project, context, L"Default", alpha->orderId, 2);

        ASSERT_GE(moved.size(), 3U);
        EXPECT_EQ(moved[0].name, L"Base.master");
        EXPECT_EQ(moved[1].name, L"Gamma.ABC");
        EXPECT_EQ(moved[2].name, L"Alpha.ABC");
#endif
    }

    TEST(PluginServiceTests, MovePluginRejectsOrdersThatPlaceDependenciesBeforeTheirMasters)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Plugin Master Order Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path masterPlugin =
            mods / L"Master Mod" / L"AddOns" / L"A_Master.ABC";
        const std::filesystem::path dependentPlugin =
            mods / L"Dependent Mod" / L"AddOns" / L"B_Dependent.ABC";
        writeBethesdaPluginFile(masterPlugin, {});
        writeBethesdaPluginFile(dependentPlugin, {"A_Master.ABC"});

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Master Mod", L"Master Mod", {}, true, {}},
                InstalledModImportRecord{mods / L"Dependent Mod", L"Dependent Mod", {}, true, {}}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};
        const std::vector<PluginEntry> initial =
            plugins.listPlugins(project, context, L"Default");
        const PluginEntry* master = findPlugin(initial, L"A_Master.ABC");
        const PluginEntry* dependent = findPlugin(initial, L"B_Dependent.ABC");
        ASSERT_NE(master, nullptr);
        ASSERT_NE(dependent, nullptr);
        ASSERT_LT(master->order, dependent->order);

        EXPECT_THROW(
            (void)plugins.movePlugin(
                project,
                context,
                L"Default",
                dependent->orderId,
                master->order),
            std::invalid_argument);
        EXPECT_THROW(
            (void)plugins.movePlugin(
                project,
                context,
                L"Default",
                master->orderId,
                dependent->order),
            std::invalid_argument);

        const std::vector<PluginEntry> afterRejectedMoves =
            plugins.listPlugins(project, context, L"Default");
        const PluginEntry* persistedMaster = findPlugin(afterRejectedMoves, L"A_Master.ABC");
        const PluginEntry* persistedDependent = findPlugin(afterRejectedMoves, L"B_Dependent.ABC");
        ASSERT_NE(persistedMaster, nullptr);
        ASSERT_NE(persistedDependent, nullptr);
        EXPECT_LT(persistedMaster->order, persistedDependent->order);
#endif
    }

    TEST(PluginServiceTests, ListPluginsRepairsExternallyCorruptedMasterOrderStably)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Plugin Master Repair Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path masterPlugin =
            mods / L"Master Mod" / L"AddOns" / L"A_Master.ABC";
        const std::filesystem::path firstDependentPlugin =
            mods / L"First Dependent Mod" / L"AddOns" / L"B_Dependent.ABC";
        const std::filesystem::path secondDependentPlugin =
            mods / L"Second Dependent Mod" / L"AddOns" / L"C_Dependent.ABC";
        const std::filesystem::path independentPlugin =
            mods / L"Independent Mod" / L"AddOns" / L"X_Independent.ABC";
        writeBethesdaPluginFile(masterPlugin, {});
        writeBethesdaPluginFile(firstDependentPlugin, {"A_Master.ABC"});
        writeBethesdaPluginFile(secondDependentPlugin, {"A_Master.ABC"});
        writeBethesdaPluginFile(independentPlugin, {});

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Master Mod", L"Master Mod", {}, true, {}},
                InstalledModImportRecord{
                    mods / L"First Dependent Mod",
                    L"First Dependent Mod",
                    {},
                    true,
                    {}
                },
                InstalledModImportRecord{
                    mods / L"Second Dependent Mod",
                    L"Second Dependent Mod",
                    {},
                    true,
                    {}
                },
                InstalledModImportRecord{
                    mods / L"Independent Mod",
                    L"Independent Mod",
                    {},
                    true,
                    {}
                }
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};
        (void)plugins.listPlugins(project, context, L"Default");

        InstanceMetadataStore::replaceProfilePluginOrderItems(
            project,
            L"Default",
            {
                ProfilePluginOrderImportItemRecord{L"plugin", L"Base.master", {}},
                ProfilePluginOrderImportItemRecord{L"plugin", L"B_Dependent.ABC", {}},
                ProfilePluginOrderImportItemRecord{L"plugin", L"C_Dependent.ABC", {}},
                ProfilePluginOrderImportItemRecord{L"separator", {}, L"Late patches"},
                ProfilePluginOrderImportItemRecord{L"plugin", L"X_Independent.ABC", {}},
                ProfilePluginOrderImportItemRecord{L"plugin", L"A_Master.ABC", {}}
            });
        writeTextFile(
            project / L"profiles" / L"Default" / L"enabled.dat",
            "*Base.master\n"
            "*B_Dependent.ABC\n"
            "*C_Dependent.ABC\n"
            "*X_Independent.ABC\n"
            "*A_Master.ABC\n");

        const std::vector<ProfilePluginOrderItemRecord> corruptedRecords =
            InstanceMetadataStore::listProfilePluginOrderItems(
                project,
                L"Default",
                {
                    L"Base.master",
                    L"B_Dependent.ABC",
                    L"C_Dependent.ABC",
                    L"X_Independent.ABC",
                    L"A_Master.ABC"
                });
        ASSERT_EQ(corruptedRecords.size(), 6U);

        const std::vector<PluginEntry> repaired =
            plugins.listPlugins(project, context, L"Default");
        ASSERT_EQ(repaired.size(), 6U);
        EXPECT_EQ(repaired[0].name, L"Base.master");
        EXPECT_EQ(repaired[1].name, L"X_Independent.ABC");
        EXPECT_EQ(repaired[2].name, L"A_Master.ABC");
        EXPECT_EQ(repaired[3].kind, L"separator");
        EXPECT_EQ(repaired[3].name, L"Late patches");
        EXPECT_EQ(repaired[4].name, L"B_Dependent.ABC");
        EXPECT_EQ(repaired[5].name, L"C_Dependent.ABC");

        const std::vector<ProfilePluginOrderItemRecord> persistedRecords =
            InstanceMetadataStore::listProfilePluginOrderItems(
                project,
                L"Default",
                {
                    L"Base.master",
                    L"X_Independent.ABC",
                    L"A_Master.ABC",
                    L"B_Dependent.ABC",
                    L"C_Dependent.ABC"
                });
        ASSERT_EQ(persistedRecords.size(), corruptedRecords.size());
        for (std::size_t index = 0; index < persistedRecords.size(); ++index)
        {
            EXPECT_EQ(persistedRecords[index].id, repaired[index].orderId);
        }
        for (const ProfilePluginOrderItemRecord& corruptedRecord : corruptedRecords)
        {
            EXPECT_TRUE(std::any_of(
                persistedRecords.begin(),
                persistedRecords.end(),
                [&corruptedRecord](const ProfilePluginOrderItemRecord& persistedRecord)
                {
                    return persistedRecord.id == corruptedRecord.id;
                }));
        }

        EXPECT_EQ(
            readTextFile(project / L"profiles" / L"Default" / L"enabled.dat"),
            "*Base.master\n"
            "*X_Independent.ABC\n"
            "*A_Master.ABC\n"
            "*B_Dependent.ABC\n"
            "*C_Dependent.ABC\n");
#endif
    }

    TEST(PluginServiceTests, NewlyDiscoveredPluginsAppendAfterExistingOrderAndSeparators)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Generated Plugin Order Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path existingPlugin =
            mods / L"Existing Mod" / L"AddOns" / L"Existing.ABC";
        const std::filesystem::path generatedDirectory =
            mods / L"PGPatcher Output" / L"AddOns";
        writeTextFile(existingPlugin, "plugin");
        std::filesystem::create_directories(generatedDirectory);

        InstanceMetadataStore::ensureInstance(project, L"customgame");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Existing Mod", L"Existing Mod", {}, true, {}},
                InstalledModImportRecord{
                    mods / L"PGPatcher Output",
                    L"PGPatcher Output",
                    {},
                    true,
                    {}
                }
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet caps = capabilities(true, true);
        const PluginRuleContext context{&provider, &caps, nullptr, L"Default"};
        const std::vector<PluginEntry> initial =
            plugins.listPlugins(project, context, L"Default");
        ASSERT_EQ(initial.size(), 2U);
        const std::vector<PluginEntry> withSeparator =
            plugins.createPluginSeparator(
                project,
                context,
                L"Default",
                L"Late patches",
                static_cast<int>(initial.size()));
        ASSERT_EQ(withSeparator.size(), 3U);
        EXPECT_EQ(withSeparator.back().kind, L"separator");

        writeTextFile(generatedDirectory / L"PGPatcher.ABC", "plugin");
        writeTextFile(generatedDirectory / L"PG_1.ABC", "plugin");
        plugins.invalidateDiscoveryCaches();

        const std::vector<PluginEntry> refreshed =
            plugins.listPlugins(project, context, L"Default");
        ASSERT_EQ(refreshed.size(), 5U);
        EXPECT_EQ(refreshed[2].kind, L"separator");
        EXPECT_EQ(refreshed[3].name, L"PG_1.ABC");
        EXPECT_EQ(refreshed[4].name, L"PGPatcher.ABC");
#endif
    }

    TEST(PluginServiceTests, ExplicitInvalidationRefreshesInPlacePluginHeaderChanges)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Plugin Invalidation Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path pluginDirectory = mods / L"Example Mod" / L"Data";
        const std::filesystem::path pluginPath = pluginDirectory / L"Example.esp";
        const std::filesystem::path gamePluginDirectory = project / L"Game" / L"Data";
        const std::filesystem::path gamePluginPath = gamePluginDirectory / L"GameExample.esp";
        writeBethesdaPluginFile(pluginPath, {});
        writeBethesdaPluginFile(gamePluginPath, {});
        writeTextFile(
            project / L".fluxora" / L"paths.json",
            "{\"gameDirectory\":\"Game\",\"modsDirectory\":\"mods\","
            "\"profilesDirectory\":\"profiles\",\"downloadsDirectory\":\"downloads\","
            "\"overwriteDirectory\":\"overwrite\"}");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{mods / L"Example Mod", L"Example Mod", {}, true, {}}});

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();
        GameSupportRegistry registry;
        registry.loadEmbeddedDefinitions();
        const GameSupportLookupResult lookup = registry.lookupById(L"skyrimse");
        ASSERT_TRUE(lookup.supported);
        ASSERT_NE(lookup.support, nullptr);
        const PluginRuleContext context{
            lookup.support->components().pluginRulesProvider,
            &lookup.support->capabilities(),
            nullptr,
            lookup.support->identity().defaultProfileName
        };

        const std::vector<PluginEntry> first = plugins.listPlugins(project, context, L"Default");
        const PluginEntry* firstPlugin = findPlugin(first, L"Example.esp");
        const PluginEntry* firstGamePlugin = findPlugin(first, L"GameExample.esp");
        ASSERT_NE(firstPlugin, nullptr);
        ASSERT_NE(firstGamePlugin, nullptr);
        EXPECT_TRUE(firstPlugin->masterFiles.empty());
        EXPECT_TRUE(firstGamePlugin->masterFiles.empty());

        const std::filesystem::file_time_type directoryWriteTime =
            std::filesystem::last_write_time(pluginDirectory);
        const std::filesystem::file_time_type gameDirectoryWriteTime =
            std::filesystem::last_write_time(gamePluginDirectory);
        writeBethesdaPluginFile(pluginPath, {"Missing.esm"});
        writeBethesdaPluginFile(gamePluginPath, {"GameMissing.esm"});
        std::filesystem::last_write_time(pluginDirectory, directoryWriteTime);
        std::filesystem::last_write_time(gamePluginDirectory, gameDirectoryWriteTime);
        plugins.invalidateDiscoveryCaches();

        const std::vector<PluginEntry> refreshed =
            plugins.listPlugins(project, context, L"Default");
        const PluginEntry* refreshedPlugin = findPlugin(refreshed, L"Example.esp");
        ASSERT_NE(refreshedPlugin, nullptr);
        ASSERT_EQ(refreshedPlugin->masterFiles.size(), 1U);
        EXPECT_EQ(refreshedPlugin->masterFiles.front(), L"Missing.esm");
        const PluginEntry* refreshedGamePlugin = findPlugin(refreshed, L"GameExample.esp");
        ASSERT_NE(refreshedGamePlugin, nullptr);
        ASSERT_EQ(refreshedGamePlugin->masterFiles.size(), 1U);
        EXPECT_EQ(refreshedGamePlugin->masterFiles.front(), L"GameMissing.esm");
#endif
    }

    TEST(PluginServiceTests, LegacyTemplateOverloadUsesRegistryRulesWithoutGlobalSkyrimExtensionSemantics)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        const std::filesystem::path skyrimProject = temp.path() / L"Skyrim Build";
        const std::filesystem::path skyrimMods = skyrimProject / L"mods";
        writeTextFile(skyrimMods / L"Master Mod" / L"Master.esm", "master");
        writeTextFile(skyrimMods / L"Light Mod" / L"Data" / L"Light.esl", "light");

        InstanceMetadataStore::ensureInstance(skyrimProject, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            skyrimProject,
            {
                InstalledModImportRecord{skyrimMods / L"Master Mod", L"Master Mod", {}, true, {}},
                InstalledModImportRecord{skyrimMods / L"Light Mod", L"Light Mod", {}, true, {}}
            });

        BuildTemplate skyrimTemplate;
        skyrimTemplate.id = L"skyrimse";
        skyrimTemplate.defaultProfileName = L"Default";

        const std::vector<PluginEntry> skyrimEntries =
            plugins.listPlugins(skyrimProject, skyrimTemplate, L"Default");

        const PluginEntry* skyrimMaster = findPlugin(skyrimEntries, L"Master.esm");
        ASSERT_NE(skyrimMaster, nullptr);
        EXPECT_TRUE(skyrimMaster->isMaster);

        const PluginEntry* skyrimLight = findPlugin(skyrimEntries, L"Light.esl");
        ASSERT_NE(skyrimLight, nullptr);
        EXPECT_TRUE(skyrimLight->isLight);

        const std::filesystem::path unknownProject = temp.path() / L"Unknown Build";
        const std::filesystem::path unknownMods = unknownProject / L"mods";
        writeTextFile(unknownMods / L"Unknown Plugin" / L"Unknown.esm", "not globally master");
        writeTextFile(unknownMods / L"Unknown Plugin" / L"Unknown.esl", "not globally light");

        InstanceMetadataStore::ensureInstance(unknownProject, L"unknown-game");
        InstanceMetadataStore::registerInstalledMods(
            unknownProject,
            {
                InstalledModImportRecord{unknownMods / L"Unknown Plugin", L"Unknown Plugin", {}, true, {}}
            });

        BuildTemplate unknownTemplate;
        unknownTemplate.id = L"unknown-game";
        unknownTemplate.defaultProfileName = L"Default";
        unknownTemplate.profileFiles = {L"plugins.txt", L"loadorder.txt"};
        unknownTemplate.pluginExtensions = {L".esm", L".esl"};
        unknownTemplate.capabilities = {
            {L"plugins", L"Plugins", L""},
            {L"load-order", L"Load order", L""}
        };

        const std::vector<PluginEntry> unknownEntries =
            plugins.listPlugins(unknownProject, unknownTemplate, L"Default");

        const PluginEntry* unknownMaster = findPlugin(unknownEntries, L"Unknown.esm");
        ASSERT_NE(unknownMaster, nullptr);
        EXPECT_FALSE(unknownMaster->isMaster);
        EXPECT_FALSE(unknownMaster->isLight);

        const PluginEntry* unknownLight = findPlugin(unknownEntries, L"Unknown.esl");
        ASSERT_NE(unknownLight, nullptr);
        EXPECT_FALSE(unknownLight->isMaster);
        EXPECT_FALSE(unknownLight->isLight);
#endif
    }

    TEST(PluginServiceTests, UnsupportedPluginOperationsReturnExplicitErrors)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Plugin service test uses the Windows instance metadata store.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Unsupported Build";
        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        PluginService plugins(logger, pathSettings);
        plugins.initialize();

        FakePluginRulesProvider provider(customRules());
        const CapabilitySet noPluginCaps = capabilities(false, false);
        EXPECT_THROW(
            (void)plugins.listPlugins(
                project,
                PluginRuleContext{&provider, &noPluginCaps, nullptr, L"Default"},
                L"Default"),
            std::invalid_argument);

        const CapabilitySet pluginOnlyCaps = capabilities(true, false);
        EXPECT_THROW(
            (void)plugins.movePlugin(
                project,
                PluginRuleContext{&provider, &pluginOnlyCaps, nullptr, L"Default"},
                L"Default",
                L"some-plugin",
                0),
            std::invalid_argument);

        PluginSupportRules missingExtensions = customRules();
        missingExtensions.pluginExtensions.clear();
        FakePluginRulesProvider missingExtensionProvider(std::move(missingExtensions));
        const CapabilitySet fullCaps = capabilities(true, true);
        EXPECT_THROW(
            (void)plugins.listPlugins(
                project,
                PluginRuleContext{&missingExtensionProvider, &fullCaps, nullptr, L"Default"},
                L"Default"),
            std::invalid_argument);
#endif
    }
}
