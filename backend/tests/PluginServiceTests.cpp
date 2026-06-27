#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PluginService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>
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
            const std::vector<std::string_view>& masters)
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
            file.append(16, '\0');
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

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Weather", L"Weather", {}, true, {}},
                InstalledModImportRecord{mods / L"SkyUI", L"SkyUI", {}, true, {}},
                InstalledModImportRecord{mods / L"Light", L"Light", {}, true, {}}
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

        const PluginEntry* skyui = findPlugin(entries, L"SkyUI.esp");
        ASSERT_NE(skyui, nullptr);
        EXPECT_EQ(skyui->extension, L"ESP");
        EXPECT_EQ(skyui->sourceMod, L"SkyUI");

        const PluginEntry* light = findPlugin(entries, L"Light.esl");
        ASSERT_NE(light, nullptr);
        EXPECT_TRUE(light->isLight);

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

        const PluginEntry* stockMaster = findPlugin(entries, L"ccBGSSSE001-Fish.esm");
        ASSERT_NE(stockMaster, nullptr);
        EXPECT_TRUE(stockMaster->isEnabled);
        EXPECT_TRUE(stockMaster->isMaster);
        EXPECT_FALSE(stockMaster->isLocked);
        EXPECT_EQ(stockMaster->sourceMod, L"Data");

        const PluginEntry* overriddenLight = findPlugin(entries, L"ccQDRSSE001-SurvivalMode.esl");
        ASSERT_NE(overriddenLight, nullptr);
        EXPECT_TRUE(overriddenLight->isLight);
        EXPECT_EQ(overriddenLight->sourceMod, L"Survival Override");
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
        ASSERT_EQ(patch->missingMasters.size(), 2);
        EXPECT_EQ(patch->missingMasters[0], L"Missing.master");
        EXPECT_EQ(patch->missingMasters[1], L"Disabled.master");

        const PluginEntry* existing = findPlugin(entries, L"Existing.master");
        ASSERT_NE(existing, nullptr);
        EXPECT_TRUE(existing->missingMasters.empty());
#endif
    }

    TEST(PluginServiceTests, RepeatedListPluginsUsesRevisionCacheBeforeScanningNestedSearchDirectories)
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
        EXPECT_NE(findPlugin(second, sentinelPlugin), nullptr);

        InstanceMetadataStore::setInstalledModEnabled(
            project,
            mods / (L"Mod " + std::to_wstring(sentinelIndex)),
            false);

        const std::vector<PluginEntry> afterRevisionChange =
            plugins.listPlugins(project, context, L"Default");
        EXPECT_EQ(findPlugin(afterRevisionChange, sentinelPlugin), nullptr);
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
