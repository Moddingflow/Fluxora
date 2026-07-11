#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora::tests
{
    namespace
    {
        const InstalledModRecord* findInstalledMod(
            const std::vector<InstalledModRecord>& mods,
            std::wstring_view folderName)
        {
            const auto match = std::find_if(
                mods.begin(),
                mods.end(),
                [folderName](const InstalledModRecord& mod)
                {
                    return mod.folderName == folderName;
                });
            return match == mods.end() ? nullptr : &(*match);
        }

        const ModFileSummaryRecord* findSummary(
            const std::vector<ModFileSummaryRecord>& summaries,
            std::wstring_view folderName)
        {
            const auto match = std::find_if(
                summaries.begin(),
                summaries.end(),
                [folderName](const ModFileSummaryRecord& summary)
                {
                    return summary.folderName == folderName;
                });
            return match == summaries.end() ? nullptr : &(*match);
        }

        const ProfileOrderItemRecord* findProfileOrderMod(
            const std::vector<ProfileOrderItemRecord>& items,
            std::wstring_view folderName)
        {
            const auto match = std::find_if(
                items.begin(),
                items.end(),
                [folderName](const ProfileOrderItemRecord& item)
                {
                    return item.kind == L"mod" &&
                        item.hasMod &&
                        item.mod.folderName == folderName;
                });
            return match == items.end() ? nullptr : &(*match);
        }

        void writeBulkConflictFiles(
            const std::filesystem::path& modPath,
            int fileCount,
            const std::string& content)
        {
            for (int index = 0; index < fileCount; ++index)
            {
                writeTextFile(
                    modPath / L"textures" / L"bulk" / (L"file-" + std::to_wstring(index) + L".dds"),
                    content);
            }
        }

        std::filesystem::path portableManifestPath(const std::filesystem::path& modPath)
        {
            return modPath / L".flow" / L"manifest.json";
        }

#ifdef _WIN32
        constexpr int sqliteRow = 100;
        constexpr int sqliteDone = 101;

        struct sqlite3;
        struct sqlite3_stmt;

        struct TestSqliteApi
        {
            using Open16Fn = int (__cdecl *)(const void*, sqlite3**);
            using CloseFn = int (__cdecl *)(sqlite3*);
            using PrepareFn = int (__cdecl *)(sqlite3*, const char*, int, sqlite3_stmt**, const char**);
            using StepFn = int (__cdecl *)(sqlite3_stmt*);
            using FinalizeFn = int (__cdecl *)(sqlite3_stmt*);
            using ColumnIntFn = int (__cdecl *)(sqlite3_stmt*, int);
            using ExecCallback = int (__cdecl *)(void*, int, char**, char**);
            using ExecFn = int (__cdecl *)(sqlite3*, const char*, ExecCallback, void*, char**);

            HMODULE module{nullptr};
            Open16Fn open16{};
            CloseFn close{};
            PrepareFn prepare{};
            StepFn step{};
            FinalizeFn finalize{};
            ColumnIntFn columnInt{};
            ExecFn exec{};

            TestSqliteApi()
            {
                module = LoadLibraryW(L"winsqlite3.dll");
                if (module == nullptr)
                {
                    throw std::runtime_error("winsqlite3.dll is not available.");
                }

                open16 = load<Open16Fn>("sqlite3_open16");
                close = load<CloseFn>("sqlite3_close");
                prepare = load<PrepareFn>("sqlite3_prepare_v2");
                step = load<StepFn>("sqlite3_step");
                finalize = load<FinalizeFn>("sqlite3_finalize");
                columnInt = load<ColumnIntFn>("sqlite3_column_int");
                exec = load<ExecFn>("sqlite3_exec");
            }

            ~TestSqliteApi()
            {
                if (module != nullptr)
                {
                    FreeLibrary(module);
                }
            }

            template <typename T>
            T load(const char* name)
            {
                FARPROC address = GetProcAddress(module, name);
                if (address == nullptr)
                {
                    throw std::runtime_error("winsqlite3.dll is missing a required entry point.");
                }

                return reinterpret_cast<T>(address);
            }
        };

        int sqliteIntScalar(const std::filesystem::path& databasePath, const char* sql)
        {
            TestSqliteApi api;
            sqlite3* database{};
            if (api.open16(databasePath.wstring().c_str(), &database) != 0 || database == nullptr)
            {
                throw std::runtime_error("Failed to open test instance database.");
            }

            sqlite3_stmt* statement{};
            if (api.prepare(database, sql, -1, &statement, nullptr) != 0 || statement == nullptr)
            {
                api.close(database);
                throw std::runtime_error("Failed to prepare test query.");
            }

            const int step = api.step(statement);
            const int value = step == sqliteRow ? api.columnInt(statement, 0) : 0;
            api.finalize(statement);
            api.close(database);
            return value;
        }

        bool sqliteTableExists(const std::filesystem::path& databasePath, const char* tableName)
        {
            std::string sql =
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '";
            sql += tableName;
            sql += "';";
            return sqliteIntScalar(databasePath, sql.c_str()) == 1;
        }

        void sqliteExec(const std::filesystem::path& databasePath, const char* sql)
        {
            TestSqliteApi api;
            sqlite3* database{};
            if (api.open16(databasePath.wstring().c_str(), &database) != 0 || database == nullptr)
            {
                throw std::runtime_error("Failed to open test instance database.");
            }
            const int result = api.exec(database, sql, nullptr, nullptr, nullptr);
            api.close(database);
            if (result != 0)
            {
                throw std::runtime_error("Failed to execute test database mutation.");
            }
        }
#endif
    }

    TEST(InstanceMetadataStoreTests, ReplaceProfileOrderMatchesImportedModNamesCaseInsensitively)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path skyUi = mods / L"SkyUI";

        writeTextFile(skyUi / L"interface" / L"skyui.swf", "ui");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{skyUi, L"SkyUI", {}, true, {}}
            });

        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"skyui", {}}
            });

        const std::vector<ProfileOrderItemRecord> order =
            InstanceMetadataStore::listProfileOrderItems(project, L"Default", mods);

        ASSERT_EQ(order.size(), 1U);
        EXPECT_TRUE(order[0].hasMod);
        EXPECT_EQ(order[0].mod.folderName, L"SkyUI");
        EXPECT_EQ(order[0].position, 0);
    }

    TEST(InstanceMetadataStoreTests, CloneRenameAndDeleteProfileStatePreservesScopedOrder)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path skyUi = mods / L"SkyUI";

        writeTextFile(skyUi / L"Data" / L"SkyUI.esp", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{skyUi, L"SkyUI", {}, true, {}}
            });
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"separator", {}, L"Interface"},
                ProfileOrderImportItemRecord{L"mod", L"SkyUI", {}}
            });
        InstanceMetadataStore::replaceProfilePluginOrderItems(
            project,
            L"Default",
            {
                ProfilePluginOrderImportItemRecord{L"separator", {}, L"Core"},
                ProfilePluginOrderImportItemRecord{L"plugin", L"SkyUI.esp", {}}
            });

        InstanceMetadataStore::cloneProfileState(project, L"Default", L"Testing", mods);

        std::vector<ProfileOrderItemRecord> modOrder =
            InstanceMetadataStore::listProfileOrderItems(project, L"Testing", mods);
        ASSERT_EQ(modOrder.size(), 2U);
        EXPECT_EQ(modOrder[0].kind, L"separator");
        EXPECT_EQ(modOrder[0].separatorTitle, L"Interface");
        ASSERT_TRUE(modOrder[1].hasMod);
        EXPECT_EQ(modOrder[1].mod.folderName, L"SkyUI");

        std::vector<ProfilePluginOrderItemRecord> pluginOrder =
            InstanceMetadataStore::listProfilePluginOrderItems(project, L"Testing", {L"SkyUI.esp"});
        ASSERT_EQ(pluginOrder.size(), 2U);
        EXPECT_EQ(pluginOrder[0].kind, L"separator");
        EXPECT_EQ(pluginOrder[0].separatorTitle, L"Core");
        EXPECT_EQ(pluginOrder[1].pluginName, L"SkyUI.esp");

        InstanceMetadataStore::renameProfileState(project, L"Testing", L"Gameplay");
        std::vector<std::wstring> profileNames = InstanceMetadataStore::listProfileNames(project);
        EXPECT_NE(std::find(profileNames.begin(), profileNames.end(), L"Gameplay"), profileNames.end());
        EXPECT_EQ(std::find(profileNames.begin(), profileNames.end(), L"Testing"), profileNames.end());

        modOrder = InstanceMetadataStore::listProfileOrderItems(project, L"Gameplay", mods);
        ASSERT_EQ(modOrder.size(), 2U);
        EXPECT_EQ(modOrder[0].separatorTitle, L"Interface");
        ASSERT_TRUE(modOrder[1].hasMod);
        EXPECT_EQ(modOrder[1].mod.folderName, L"SkyUI");

        InstanceMetadataStore::deleteProfileState(project, L"Gameplay");
        profileNames = InstanceMetadataStore::listProfileNames(project);
        EXPECT_EQ(std::find(profileNames.begin(), profileNames.end(), L"Gameplay"), profileNames.end());
#endif
    }

    TEST(InstanceMetadataStoreTests, SetAllInstalledModsEnabledKeepsPortableManifestsCurrent)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::wstring folderName =
            L"A Patch For Deadly Spell Impacts And Audio Overhaul Compatibility Patch Plus PSI";
        const std::filesystem::path modPath = mods / std::filesystem::path(folderName);
        const std::wstring existingFolderName = L"Existing Manifest Mod";
        const std::filesystem::path existingModPath = mods / std::filesystem::path(existingFolderName);
        writeTextFile(modPath / L"Data" / L"Patch.esp", "plugin");
        writeTextFile(existingModPath / L"Data" / L"Existing.esp", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{modPath, folderName, {}, true, {}},
                InstalledModImportRecord{existingModPath, existingFolderName, {}, true, {}}
            });

        const std::filesystem::path manifest = portableManifestPath(modPath);
        const std::filesystem::path existingManifest = portableManifestPath(existingModPath);
        ASSERT_TRUE(std::filesystem::is_regular_file(manifest));
        ASSERT_TRUE(std::filesystem::is_regular_file(existingManifest));
        ASSERT_TRUE(std::filesystem::remove(manifest));
        const std::string existingManifestBefore = readTextFile(existingManifest);

        InstanceMetadataStore::setAllInstalledModsEnabled(project, false, mods);

        std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* disabled = findInstalledMod(records, folderName);
        ASSERT_NE(disabled, nullptr);
        EXPECT_EQ(disabled->state, L"disabled");
        const InstalledModRecord* existingDisabled = findInstalledMod(records, existingFolderName);
        ASSERT_NE(existingDisabled, nullptr);
        EXPECT_EQ(existingDisabled->state, L"disabled");
        ASSERT_TRUE(std::filesystem::is_regular_file(manifest));
        const std::string disabledManifest = readTextFile(manifest);
        EXPECT_NE(disabledManifest.find(R"("state":"disabled")"), std::string::npos);
        EXPECT_FALSE(std::filesystem::exists(AtomicFileStore::backupPathFor(manifest)));
        EXPECT_NE(readTextFile(existingManifest), existingManifestBefore);
        EXPECT_NE(readTextFile(existingManifest).find(R"("state":"disabled")"), std::string::npos);

        InstanceMetadataStore::setAllInstalledModsEnabled(project, true, mods);

        records = InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* enabled = findInstalledMod(records, folderName);
        ASSERT_NE(enabled, nullptr);
        EXPECT_EQ(enabled->state, L"installed");
        EXPECT_NE(readTextFile(manifest), disabledManifest);
        EXPECT_NE(readTextFile(manifest).find(R"("state":"installed")"), std::string::npos);
        EXPECT_NE(readTextFile(existingManifest).find(R"("state":"installed")"), std::string::npos);
        EXPECT_FALSE(std::filesystem::exists(AtomicFileStore::backupPathFor(manifest)));

        InstanceMetadataStore::setAllInstalledModsEnabled(project, true, mods);

        EXPECT_NE(readTextFile(manifest).find(R"("state":"installed")"), std::string::npos);
#endif
    }

    TEST(InstanceMetadataStoreTests, CreatesNormalizedModMetadataTablesAndPersistsFlags)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"SkyUI Russian Patch";
        const std::filesystem::path conflictModPath = mods / L"Local Conflict";
        writeTextFile(modPath / L"interface" / L"skyui.swf", "ui");
        writeTextFile(conflictModPath / L"interface" / L"skyui.swf", "override");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{
                    modPath,
                    L"SkyUI Russian Translation Patch",
                    L"1.2",
                    true,
                    ModSourceRecord{
                        L"nexus",
                        L"skyrimspecialedition",
                        L"3863",
                        L"123",
                        L"nxm://skyrimspecialedition/mods/3863/files/123"
                    }
                },
                InstalledModImportRecord{
                    conflictModPath,
                    L"Local Conflict",
                    L"1.0",
                    true,
                    {}
                }
            });

        const std::filesystem::path database = project / L"instance.db";
        for (const char* table : {
                 "mods",
                 "mod_files",
                 "mod_file_cache_state",
                 "mod_sources",
                 "mod_tags",
                 "mod_dependencies",
                 "mod_conflicts",
                 "mod_install_history",
                 "mod_notes"
             })
        {
            EXPECT_TRUE(sqliteTableExists(database, table)) << table;
        }
        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 6);

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* mod = findInstalledMod(records, L"SkyUI Russian Patch");
        ASSERT_NE(mod, nullptr);
        EXPECT_TRUE(mod->sourceIsNexus);
        EXPECT_FALSE(mod->sourceIsModdingFlow);
        EXPECT_FALSE(mod->isLocal);
        EXPECT_TRUE(mod->isTranslation);
        EXPECT_TRUE(mod->isPatch);

        const std::string manifest = readTextFile(portableManifestPath(modPath));
        EXPECT_NE(manifest.find(R"("sourceIsNexus":true)"), std::string::npos);
        EXPECT_NE(manifest.find(R"("isTranslation":true)"), std::string::npos);
        EXPECT_NE(manifest.find(R"("isPatch":true)"), std::string::npos);
        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_tags WHERE tag = 'source:nexus';"), 1);
        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_tags WHERE tag = 'translation';"), 1);
        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_tags WHERE tag = 'patch';"), 1);
        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_install_history WHERE operation = 'install';"), 2);

        const std::vector<ModFileSummaryRecord> summaries =
            InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        ASSERT_EQ(summaries.size(), 2U);
        EXPECT_GT(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_conflicts WHERE source = 'scan';"), 0);
#endif
    }

    TEST(InstanceMetadataStoreTests, RefreshInstalledModsFromDiskRecreatesMissingPortableManifest)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Manifest Repair";
        writeTextFile(modPath / L"Data" / L"Repair.esp", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{modPath, L"Manifest Repair", L"1.0", true, {}}
            });

        const std::filesystem::path manifest = portableManifestPath(modPath);
        ASSERT_TRUE(std::filesystem::is_regular_file(manifest));
        ASSERT_TRUE(std::filesystem::remove(manifest));

        InstanceMetadataStore::refreshInstalledModsFromDisk(project, mods);
        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project, mods);

        ASSERT_NE(findInstalledMod(records, L"Manifest Repair"), nullptr);
        ASSERT_TRUE(std::filesystem::is_regular_file(manifest));
        EXPECT_NE(readTextFile(manifest).find(R"("folderName":"Manifest Repair")"), std::string::npos);
#endif
    }

    TEST(InstanceMetadataStoreTests, RegisterInstalledModsCanDeferContentFingerprintUntilFileSummary)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Deferred Fingerprint";
        writeTextFile(modPath / L"interface" / L"menu.swf", "ui");
        writeTextFile(modPath / L"scripts" / L"setup.pex", "script");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{modPath, L"Deferred Fingerprint", {}, true, {}, false}
            });

        std::vector<InstalledModRecord> records = InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* deferred = findInstalledMod(records, L"Deferred Fingerprint");
        ASSERT_NE(deferred, nullptr);
        EXPECT_TRUE(deferred->contentFingerprint.empty());
        EXPECT_NE(readTextFile(portableManifestPath(modPath)).find(R"("contentFingerprint":"")"), std::string::npos);

        const ModFileSummary summary = InstanceMetadataStore::summarizeModFiles(project, modPath, mods);
        EXPECT_EQ(summary.fileCount, 2);

        records = InstanceMetadataStore::listInstalledMods(project, mods);
        deferred = findInstalledMod(records, L"Deferred Fingerprint");
        ASSERT_NE(deferred, nullptr);
        EXPECT_FALSE(deferred->contentFingerprint.empty());
#endif
    }

    TEST(InstanceMetadataStoreTests, ListInstalledModsUsesDatabaseSnapshotUntilExplicitRefresh)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Manual Disk Mod";
        writeTextFile(modPath / L"Data" / L"Manual.esp", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project, mods);
        EXPECT_EQ(findInstalledMod(records, L"Manual Disk Mod"), nullptr);

        InstanceMetadataStore::refreshInstalledModsFromDisk(project, mods);
        records = InstanceMetadataStore::listInstalledMods(project, mods);

        const InstalledModRecord* manual = findInstalledMod(records, L"Manual Disk Mod");
        ASSERT_NE(manual, nullptr);
        EXPECT_TRUE(manual->contentFingerprint.empty());
        ASSERT_TRUE(std::filesystem::is_regular_file(portableManifestPath(modPath)));
        EXPECT_NE(readTextFile(portableManifestPath(modPath)).find(R"("contentFingerprint":"")"), std::string::npos);
#endif
    }

    TEST(InstanceMetadataStoreTests, CachedProfileOrderDoesNotRefreshDiskOnlyMods)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path registered = mods / L"Registered Mod";
        const std::filesystem::path diskOnly = mods / L"Disk Only Mod";
        writeTextFile(registered / L"Data" / L"Registered.esp", "registered");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{registered, L"Registered Mod", {}, true, {}}
            });
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {ProfileOrderImportItemRecord{L"mod", L"Registered Mod", {}}});

        writeTextFile(diskOnly / L"Data" / L"DiskOnly.esp", "disk-only");

        std::vector<ProfileOrderItemRecord> cached =
            InstanceMetadataStore::listCachedProfileOrderItems(project, L"Default", mods);
        EXPECT_NE(findProfileOrderMod(cached, L"Registered Mod"), nullptr);
        EXPECT_EQ(findProfileOrderMod(cached, L"Disk Only Mod"), nullptr);

        InstanceMetadataStore::refreshInstalledModsFromDisk(project, mods);
        std::vector<ProfileOrderItemRecord> refreshed =
            InstanceMetadataStore::listProfileOrderItems(project, L"Default", mods);
        EXPECT_NE(findProfileOrderMod(refreshed, L"Disk Only Mod"), nullptr);
#endif
    }

    TEST(InstanceMetadataStoreTests, CachedProfileOrderReadIsWriteFreeWhenAlreadyCompact)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path first = mods / L"First Mod";
        const std::filesystem::path second = mods / L"Second Mod";
        writeTextFile(first / L"Data" / L"First.esp", "first");
        writeTextFile(second / L"Data" / L"Second.esp", "second");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{first, L"First Mod", {}, true, {}},
                InstalledModImportRecord{second, L"Second Mod", {}, true, {}}
            });
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"separator", {}, L"Core"},
                ProfileOrderImportItemRecord{L"mod", L"First Mod", {}},
                ProfileOrderImportItemRecord{L"mod", L"Second Mod", {}}
            });
        ASSERT_EQ(
            InstanceMetadataStore::listCachedProfileOrderItems(project, L"Default", mods).size(),
            3U);

        const std::filesystem::path database = project / L"instance.db";
        sqliteExec(
            database,
            "CREATE TRIGGER reject_profile_order_insert "
            "BEFORE INSERT ON profile_order_items "
            "BEGIN SELECT RAISE(FAIL, 'unexpected profile order insert'); END;");
        sqliteExec(
            database,
            "CREATE TRIGGER reject_profile_order_update "
            "BEFORE UPDATE ON profile_order_items "
            "BEGIN SELECT RAISE(FAIL, 'unexpected profile order update'); END;");

        const std::vector<ProfileOrderItemRecord> cached =
            InstanceMetadataStore::listCachedProfileOrderItems(project, L"Default", mods);

        ASSERT_EQ(cached.size(), 3U);
        EXPECT_EQ(cached[0].kind, L"separator");
        EXPECT_EQ(cached[1].mod.folderName, L"First Mod");
        EXPECT_EQ(cached[2].mod.folderName, L"Second Mod");
#endif
    }

    TEST(InstanceMetadataStoreTests, ProfilePluginOrderReadIsWriteFreeWhenAlreadyCompact)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::replaceProfilePluginOrderItems(
            project,
            L"Default",
            {
                ProfilePluginOrderImportItemRecord{L"separator", {}, L"Core"},
                ProfilePluginOrderImportItemRecord{L"plugin", L"First.esp", {}},
                ProfilePluginOrderImportItemRecord{L"plugin", L"Second.esp", {}}
            });
        const std::vector<std::wstring> pluginNames{L"First.esp", L"Second.esp"};
        ASSERT_EQ(
            InstanceMetadataStore::listProfilePluginOrderItems(
                project,
                L"Default",
                pluginNames).size(),
            3U);

        const std::filesystem::path database = project / L"instance.db";
        sqliteExec(
            database,
            "CREATE TRIGGER reject_profile_plugin_order_insert "
            "BEFORE INSERT ON profile_plugin_order_items "
            "BEGIN SELECT RAISE(FAIL, 'unexpected profile plugin order insert'); END;");
        sqliteExec(
            database,
            "CREATE TRIGGER reject_profile_plugin_order_update "
            "BEFORE UPDATE ON profile_plugin_order_items "
            "BEGIN SELECT RAISE(FAIL, 'unexpected profile plugin order update'); END;");

        const std::vector<ProfilePluginOrderItemRecord> cached =
            InstanceMetadataStore::listProfilePluginOrderItems(
                project,
                L"Default",
                pluginNames);

        ASSERT_EQ(cached.size(), 3U);
        EXPECT_EQ(cached[0].kind, L"separator");
        EXPECT_EQ(cached[1].pluginName, L"First.esp");
        EXPECT_EQ(cached[2].pluginName, L"Second.esp");
#endif
    }

    TEST(InstanceMetadataStoreTests, ExactReconciliationRecoversTempOnlyPortableManifest)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Recovered Portable Metadata";
        const std::filesystem::path manifest = portableManifestPath(modPath);
        writeTextFile(modPath / L"Data" / L"Recovered.esp", "plugin");
        const std::string manifestJson = R"json({
            "schemaVersion": 1,
            "modUuid": "recovered-mod-uuid",
            "gameId": "skyrimse",
            "folderName": "Recovered Portable Metadata",
            "displayName": "Recovered Display Name",
            "version": "9.0",
            "installedAt": "2026-07-11T00:00:00Z",
            "updatedAt": "2026-07-11T00:00:00Z",
            "state": "installed",
            "contentFingerprint": "",
            "source": {"provider": "manual"}
        })json";
        EXPECT_THROW(
            AtomicFileStore().writeTextFile(
                manifest,
                manifestJson,
                AtomicFileWriteOptions{
                    L"generated mod metadata",
                    ProjectStateValidation::JsonObject,
                    {},
                    false,
                    AtomicWriteFailurePoint::AfterTempFileValidated
                }),
            std::runtime_error);
        ASSERT_FALSE(std::filesystem::exists(manifest));

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        EXPECT_TRUE(
            InstanceMetadataStore::summarizePersistedInstalledModFiles(project, mods).empty());
        EXPECT_FALSE(std::filesystem::exists(manifest));

        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        const auto installed = InstanceMetadataStore::listInstalledMods(project, mods);

        ASSERT_EQ(installed.size(), 1U);
        EXPECT_EQ(installed.front().displayName, L"Recovered Display Name");
        EXPECT_EQ(installed.front().version, L"9.0");
        EXPECT_TRUE(std::filesystem::is_regular_file(manifest));
#endif
    }

    TEST(InstanceMetadataStoreTests, InvalidatedModFileTreeRebuildsAfterExternalFileChanges)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Prepared Tree";
        writeTextFile(modPath / L"Data" / L"First.esp", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{modPath, L"Prepared Tree", L"1.0", true, {}}
            });

        std::vector<ModFileTreeEntry> entries =
            InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);
        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries[0].name, L"First.esp");

        writeTextFile(modPath / L"Data" / L"Second.esp", "plugin");
        InstanceMetadataStore::invalidateModFileCaches(
            project,
            {modPath / L"Data" / L"Second.esp"},
            mods);
        entries = InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);

        ASSERT_EQ(entries.size(), 2U);
        EXPECT_EQ(entries[0].name, L"First.esp");
        EXPECT_EQ(entries[1].name, L"Second.esp");

        writeTextFile(modPath / L"Data" / L"Second.esp", "replacement-plugin-bytes");
        InstanceMetadataStore::invalidateModFileCaches(
            project,
            {modPath / L"Data" / L"Second.esp"},
            mods);
        entries = InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);
        ASSERT_EQ(entries.size(), 2U);
        EXPECT_EQ(entries[1].name, L"Second.esp");
        EXPECT_EQ(entries[1].size, std::string("replacement-plugin-bytes").size());

        std::filesystem::remove(modPath / L"Data" / L"First.esp");
        InstanceMetadataStore::invalidateModFileCaches(
            project,
            {modPath / L"Data" / L"First.esp"},
            mods);
        entries = InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries[0].name, L"Second.esp");
#endif
    }

    TEST(InstanceMetadataStoreTests, ModsRootInvalidationClearsAndRebuildsEveryFileCache)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path firstMod = mods / L"First Mod";
        const std::filesystem::path secondMod = mods / L"Second Mod";
        writeTextFile(firstMod / L"Data" / L"First.bin", "first");
        writeTextFile(secondMod / L"Data" / L"Second.bin", "second");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{firstMod, L"First Mod", L"1.0", true, {}},
                InstalledModImportRecord{secondMod, L"Second Mod", L"1.0", true, {}}
            });
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        const std::filesystem::path database = project / L"instance.db";
        ASSERT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_files;"), 4);
        ASSERT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_file_cache_state;"), 2);
        ASSERT_EQ(
            sqliteIntScalar(database, "SELECT COUNT(*) FROM mods WHERE content_fingerprint <> '';"),
            2);

        InstanceMetadataStore::invalidateModFileCaches(project, {mods}, mods);

        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_files;"), 0);
        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_file_cache_state;"), 0);
        EXPECT_EQ(
            sqliteIntScalar(database, "SELECT COUNT(*) FROM mods WHERE content_fingerprint <> '';"),
            0);

        const std::vector<ModFileSummaryRecord> rebuilt =
            InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        const ModFileSummaryRecord* first = findSummary(rebuilt, L"First Mod");
        const ModFileSummaryRecord* second = findSummary(rebuilt, L"Second Mod");
        ASSERT_NE(first, nullptr);
        ASSERT_NE(second, nullptr);
        EXPECT_EQ(first->summary.fileCount, 1);
        EXPECT_EQ(second->summary.fileCount, 1);
        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_files;"), 4);
        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_file_cache_state;"), 2);
#endif
    }

    TEST(InstanceMetadataStoreTests, FreshActivationReconcilesOfflineChangesDeterministically)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Offline Changes";
        const std::filesystem::path firstPath = modPath / L"Data" / L"First.bin";
        const std::filesystem::path secondPath = modPath / L"Data" / L"Second.bin";
        writeTextFile(firstPath, "aaaa");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{modPath, L"Offline Changes", L"1.0", true, {}}});
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);

        const std::vector<InstalledModRecord> initialRecords =
            InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* initial = findInstalledMod(initialRecords, L"Offline Changes");
        ASSERT_NE(initial, nullptr);
        ASSERT_FALSE(initial->contentFingerprint.empty());
        const std::wstring initialFingerprint = initial->contentFingerprint;
        const std::filesystem::file_time_type manifestTime =
            std::filesystem::last_write_time(portableManifestPath(modPath));
        const std::string manifestBytes = readTextFile(portableManifestPath(modPath));

        // A repeated activation under continuous watcher coverage reuses the
        // validated generation and does not rewrite portable metadata.
        InstanceMetadataStore::resetStableMetadataHandleOpenCountForTesting();
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        EXPECT_EQ(InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(), 0U);
        EXPECT_EQ(readTextFile(portableManifestPath(modPath)), manifestBytes);
        EXPECT_EQ(std::filesystem::last_write_time(portableManifestPath(modPath)), manifestTime);

        writeTextFile(secondPath, "second");
        InstanceMetadataStore::beginProjectActivation(temp.path() / L"other-project");
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        std::vector<ModFileTreeEntry> entries =
            InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);
        ASSERT_EQ(entries.size(), 2U);
        const std::vector<InstalledModRecord> addedRecords =
            InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* added = findInstalledMod(addedRecords, L"Offline Changes");
        ASSERT_NE(added, nullptr);
        const std::wstring addedFingerprint = added->contentFingerprint;
        EXPECT_NE(addedFingerprint, initialFingerprint);

        const std::filesystem::file_time_type firstWriteTime =
            std::filesystem::last_write_time(firstPath);
        writeTextFile(firstPath, "bbbb");
        std::filesystem::last_write_time(firstPath, firstWriteTime);
        InstanceMetadataStore::beginProjectActivation(temp.path() / L"other-project");
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        const std::vector<InstalledModRecord> replacedRecords =
            InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* replaced = findInstalledMod(replacedRecords, L"Offline Changes");
        ASSERT_NE(replaced, nullptr);
        EXPECT_NE(replaced->contentFingerprint, addedFingerprint);

        std::filesystem::remove(secondPath);
        InstanceMetadataStore::beginProjectActivation(temp.path() / L"other-project");
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        entries = InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);
        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().name, L"First.bin");
#endif
    }

    TEST(InstanceMetadataStoreTests, FreshActivationRepairsTamperedFileCacheRows)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Tamper Recovery";
        writeTextFile(modPath / L"Data" / L"First.bin", "data");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{modPath, L"Tamper Recovery", L"1.0", true, {}}});
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        const std::filesystem::path database = project / L"instance.db";
        ASSERT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_files;"), 2);

        sqliteExec(
            database,
            "UPDATE mod_files SET "
            "relative_path = 'Data\\Tampered.bin', "
            "path_key = 'data\\tampered.bin', "
            "name = 'Tampered.bin', size = 999 "
            "WHERE kind = 'file';");
        ASSERT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_files;"), 2);

        InstanceMetadataStore::beginProjectActivation(temp.path() / L"other-project");
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        const std::vector<ModFileTreeEntry> entries =
            InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().name, L"First.bin");
        EXPECT_EQ(entries.front().relativePath, L"Data/First.bin");
        EXPECT_EQ(entries.front().size, 4U);
#endif
    }

    TEST(InstanceMetadataStoreTests, StableVolumeFileMetadataIsEnumeratedInDirectoryBatches)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Stable-volume metadata counters are enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Batched Metadata";
        for (int index = 0; index < 64; ++index)
        {
            writeTextFile(
                modPath / L"Data" / (L"File-" + std::to_wstring(index) + L".bin"),
                "same-size-payload");
        }

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{modPath, L"Batched Metadata", L"1.0", true, {}}});
        InstanceMetadataStore::resetStableMetadataHandleOpenCountForTesting();
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);

        EXPECT_LE(
            InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(),
            4U);
#endif
    }

    TEST(InstanceMetadataStoreTests, PersistedSummaryDoesNotBlockOnOfflineReconciliation)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Persistent metadata is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Deferred Reconciliation";
        writeTextFile(modPath / L"Data" / L"First.bin", "first");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{modPath, L"Deferred Reconciliation", L"1.0", true, {}}});
        InstanceMetadataStore::beginProjectActivation(project);
        const auto initial = InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        ASSERT_EQ(initial.size(), 1U);
        EXPECT_EQ(initial.front().summary.fileCount, 1);

        writeTextFile(modPath / L"Data" / L"Second.bin", "second");
        InstanceMetadataStore::beginProjectActivation(temp.path() / L"other-project");
        InstanceMetadataStore::beginProjectActivation(project);
        InstanceMetadataStore::resetStableMetadataHandleOpenCountForTesting();
        InstanceMetadataStore::resetInventorySyncCountForTesting();
        const auto persisted =
            InstanceMetadataStore::summarizePersistedInstalledModFiles(project, mods);
        ASSERT_EQ(persisted.size(), 1U);
        EXPECT_EQ(persisted.front().summary.fileCount, 1);
        EXPECT_EQ(InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(), 0U);
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 0U);

        const auto reconciled = InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        ASSERT_EQ(reconciled.size(), 1U);
        EXPECT_EQ(reconciled.front().summary.fileCount, 2);
        EXPECT_GT(InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(), 0U);
#endif
    }

    TEST(InstanceMetadataStoreTests, PersistedSnapshotFreshnessUsesConstantSqlForManyMods)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Persistent metadata counters are enabled for Windows metadata tests.";
#else
        constexpr int modCount = 64;
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        std::vector<InstalledModImportRecord> imports;
        imports.reserve(modCount);
        std::filesystem::path invalidatedFile;
        for (int index = 0; index < modCount; ++index)
        {
            const std::wstring folderName = L"Persisted Mod " + std::to_wstring(index);
            const std::filesystem::path modPath = mods / folderName;
            const std::filesystem::path filePath =
                index < 2
                    ? modPath / L"Data" / L"shared.bin"
                    : modPath / L"Data" / (L"unique-" + std::to_wstring(index) + L".bin");
            writeTextFile(filePath, "content");
            imports.push_back(InstalledModImportRecord{
                modPath,
                folderName,
                L"1.0",
                true,
                {},
                false});
            if (index == 17)
            {
                invalidatedFile = filePath;
            }
        }

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(project, imports);
        InstanceMetadataStore::beginProjectActivation(project);
        const std::vector<ModFileSummaryRecord> prepared =
            InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        ASSERT_EQ(prepared.size(), static_cast<std::size_t>(modCount));
        ASSERT_TRUE(std::all_of(
            prepared.begin(),
            prepared.end(),
            [](const ModFileSummaryRecord& summary)
            {
                return summary.summary.fileCount == 1;
            }));

        InstanceMetadataStore::invalidateModFileCaches(
            project,
            {invalidatedFile},
            mods);
        InstanceMetadataStore::resetSqlPrepareCountForTesting();
        InstanceMetadataStore::resetStableMetadataHandleOpenCountForTesting();
        InstanceMetadataStore::resetInventorySyncCountForTesting();

        const PersistedInstalledModsSnapshot snapshot =
            InstanceMetadataStore::persistedInstalledModsSnapshot(project, mods);
        const std::uint64_t prepareCount =
            InstanceMetadataStore::sqlPrepareCountForTesting();

        const std::vector<ModFileSummaryRecord>& persisted = snapshot.summaries;
        ASSERT_EQ(snapshot.mods.size(), static_cast<std::size_t>(modCount));
        ASSERT_EQ(persisted.size(), static_cast<std::size_t>(modCount));
        for (std::size_t index = 0; index < snapshot.mods.size(); ++index)
        {
            EXPECT_EQ(persisted[index].folderName, snapshot.mods[index].folderName);
            EXPECT_EQ(normalized(persisted[index].modPath), normalized(snapshot.mods[index].path));
        }
        EXPECT_EQ(
            std::count_if(
                persisted.begin(),
                persisted.end(),
                [](const ModFileSummaryRecord& summary)
                {
                    return summary.summary.fileCount == -1;
                }),
            1);
        EXPECT_EQ(
            std::count_if(
                persisted.begin(),
                persisted.end(),
                [](const ModFileSummaryRecord& summary)
                {
                    return summary.summary.fileCount == 1;
                }),
            modCount - 1);
        const ModFileSummaryRecord* firstConflict = findSummary(persisted, L"Persisted Mod 0");
        const ModFileSummaryRecord* secondConflict = findSummary(persisted, L"Persisted Mod 1");
        ASSERT_NE(firstConflict, nullptr);
        ASSERT_NE(secondConflict, nullptr);
        EXPECT_EQ(firstConflict->summary.conflictingFileCount, 1);
        EXPECT_EQ(secondConflict->summary.conflictingFileCount, 1);
        EXPECT_EQ(
            firstConflict->summary.overwritesModIds.size() +
                firstConflict->summary.overwrittenByModIds.size(),
            1U);
        EXPECT_EQ(
            secondConflict->summary.overwritesModIds.size() +
                secondConflict->summary.overwrittenByModIds.size(),
            1U);
        EXPECT_LE(prepareCount, 12U);
        EXPECT_EQ(InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(), 0U);
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 0U);
#endif
    }

    TEST(InstanceMetadataStoreTests, GeneratedManifestChangesDoNotInvalidateContentCache)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Persistent metadata counters are enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Manifest Sidecar";
        writeTextFile(modPath / L"Data" / L"Content.bin", "content");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{modPath, L"Manifest Sidecar", L"1.0", true, {}}});
        InstanceMetadataStore::beginProjectActivation(project);
        const auto initial = InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        ASSERT_EQ(initial.size(), 1U);
        ASSERT_EQ(initial.front().summary.fileCount, 1);

        InstanceMetadataStore::resetStableMetadataHandleOpenCountForTesting();
        InstanceMetadataStore::invalidateModFileCaches(
            project,
            {modPath / L".flow" / L"manifest.json"},
            mods);
        const auto unchanged = InstanceMetadataStore::summarizeInstalledModFiles(project, mods);

        ASSERT_EQ(unchanged.size(), 1U);
        EXPECT_EQ(unchanged.front().summary.fileCount, 1);
        EXPECT_EQ(InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(), 0U);
#endif
    }

    TEST(InstanceMetadataStoreTests, FailedGenerationScanNeverPublishesPartialFileCache)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "File-cache failure injection is enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Failure Safe";
        writeTextFile(modPath / L"Data" / L"First.bin", "first");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{modPath, L"Failure Safe", L"1.0", true, {}}});
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);

        writeTextFile(modPath / L"Data" / L"Second.bin", "second");
        InstanceMetadataStore::setFileCacheScanFailureAfterEntriesForTesting(1);
        InstanceMetadataStore::beginProjectActivation(temp.path() / L"other-project");
        InstanceMetadataStore::beginProjectActivation(project);
        EXPECT_THROW(
            (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods),
            std::runtime_error);
        InstanceMetadataStore::setFileCacheScanFailureAfterEntriesForTesting(-1);

        std::vector<ModFileTreeEntry> entries =
            InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);
        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().name, L"First.bin");

        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        entries = InstanceMetadataStore::listModFileTree(project, modPath, L"Data", mods);
        ASSERT_EQ(entries.size(), 2U);
#endif
    }

    TEST(InstanceMetadataStoreTests, UnknownOrMissingFileCacheSchemaRebuildsSafely)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Schema Recovery";
        writeTextFile(modPath / L"Data" / L"file.bin", "content");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {InstalledModImportRecord{modPath, L"Schema Recovery", L"1.0", true, {}}});
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        const std::filesystem::path database = project / L"instance.db";

        sqliteExec(database, "UPDATE mod_file_cache_state SET schema_version = 999;");
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        EXPECT_EQ(
            sqliteIntScalar(database, "SELECT schema_version FROM mod_file_cache_state LIMIT 1;"),
            2);

        sqliteExec(database, "DELETE FROM mod_file_cache_state;");
        InstanceMetadataStore::beginProjectActivation(project);
        (void)InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        EXPECT_EQ(sqliteIntScalar(database, "SELECT COUNT(*) FROM mod_file_cache_state;"), 1);
#endif
    }

    TEST(InstanceMetadataStoreTests, CorruptDatabaseFailsWithoutDeletingAuthoritativeFile)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        const std::filesystem::path database = project / L"instance.db";
        writeTextFile(database, "not-a-sqlite-database");

        EXPECT_THROW(
            (void)InstanceMetadataStore::gameId(project),
            std::runtime_error);
        EXPECT_TRUE(std::filesystem::is_regular_file(database));
        EXPECT_EQ(readTextFile(database), "not-a-sqlite-database");
#endif
    }

    TEST(InstanceMetadataStoreTests, NewerDatabaseSchemaIsRejectedWithoutDowngrade)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Persistent metadata counters are enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path database = project / L"instance.db";
        std::filesystem::create_directories(project);
        sqliteExec(database, "PRAGMA user_version = 7;");
        ASSERT_FALSE(sqliteTableExists(database, "instance_metadata"));
        InstanceMetadataStore::resetSqlPrepareCountForTesting();
        InstanceMetadataStore::resetSqlExecCountForTesting();

        EXPECT_THROW(
            (void)InstanceMetadataStore::gameId(project),
            std::runtime_error);
        EXPECT_EQ(InstanceMetadataStore::sqlPrepareCountForTesting(), 1U);
        EXPECT_EQ(InstanceMetadataStore::sqlExecCountForTesting(), 0U);
        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 7);
        EXPECT_FALSE(sqliteTableExists(database, "instance_metadata"));
#endif
    }

    TEST(InstanceMetadataStoreTests, CurrentSchemaReopenSkipsSchemaDdlAndColumnProbes)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Persistent metadata counters are enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::resetSqlPrepareCountForTesting();
        InstanceMetadataStore::resetSqlExecCountForTesting();

        EXPECT_EQ(InstanceMetadataStore::gameId(project), L"skyrimse");

        EXPECT_EQ(InstanceMetadataStore::sqlPrepareCountForTesting(), 2U);
        EXPECT_EQ(InstanceMetadataStore::sqlExecCountForTesting(), 3U);
#endif
    }

    TEST(InstanceMetadataStoreTests, OlderSchemaVersionRunsMigrationAndRestoresCurrentVersion)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Persistent metadata counters are enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path database = project / L"instance.db";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        sqliteExec(database, "PRAGMA user_version = 5;");
        InstanceMetadataStore::resetSqlPrepareCountForTesting();
        InstanceMetadataStore::resetSqlExecCountForTesting();

        EXPECT_EQ(InstanceMetadataStore::gameId(project), L"skyrimse");

        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 6);
        EXPECT_TRUE(sqliteTableExists(database, "mod_file_cache_state"));
        EXPECT_GT(InstanceMetadataStore::sqlPrepareCountForTesting(), 2U);
        EXPECT_GT(InstanceMetadataStore::sqlExecCountForTesting(), 3U);
#endif
    }

    TEST(InstanceMetadataStoreTests, ConflictSummaryAndTreeUseBoundedSqlForTenThousandVisibleConflicts)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#elif !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Instance metadata SQL test hooks are disabled.";
#else
        constexpr int fileCount = 10000;
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path firstPath = mods / L"Bulk Conflict A";
        const std::filesystem::path secondPath = mods / L"Bulk Conflict B";
        writeBulkConflictFiles(firstPath, fileCount, "a");
        writeBulkConflictFiles(secondPath, fileCount, "b");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{firstPath, L"Bulk Conflict A", L"1.0", true, {}},
                InstalledModImportRecord{secondPath, L"Bulk Conflict B", L"1.0", true, {}}
            });

        const std::vector<ModFileSummaryRecord> warmSummaries =
            InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        ASSERT_EQ(warmSummaries.size(), 2U);

        InstanceMetadataStore::resetSqlPrepareCountForTesting();
        const std::vector<ModFileSummaryRecord> summaries =
            InstanceMetadataStore::summarizeInstalledModFiles(project, mods);
        const std::uint64_t summaryPrepareCount =
            InstanceMetadataStore::sqlPrepareCountForTesting();

        EXPECT_LE(summaryPrepareCount, 32ULL);
        const ModFileSummaryRecord* firstSummary = findSummary(summaries, L"Bulk Conflict A");
        const ModFileSummaryRecord* secondSummary = findSummary(summaries, L"Bulk Conflict B");
        ASSERT_NE(firstSummary, nullptr);
        ASSERT_NE(secondSummary, nullptr);
        EXPECT_EQ(firstSummary->summary.fileCount, fileCount);
        EXPECT_EQ(firstSummary->summary.conflictingFileCount, fileCount);
        EXPECT_EQ(firstSummary->summary.overwrittenFileCount, fileCount);
        EXPECT_EQ(firstSummary->summary.overwritingFileCount, 0);
        EXPECT_EQ(secondSummary->summary.fileCount, fileCount);
        EXPECT_EQ(secondSummary->summary.conflictingFileCount, fileCount);
        EXPECT_EQ(secondSummary->summary.overwrittenFileCount, 0);
        EXPECT_EQ(secondSummary->summary.overwritingFileCount, fileCount);

        InstanceMetadataStore::resetSqlPrepareCountForTesting();
        const std::vector<ModFileTreeEntry> entries =
            InstanceMetadataStore::listModFileTree(project, firstPath, L"textures/bulk", mods);
        const std::uint64_t treePrepareCount =
            InstanceMetadataStore::sqlPrepareCountForTesting();

        EXPECT_LE(treePrepareCount, 16ULL);
        ASSERT_EQ(entries.size(), static_cast<std::size_t>(fileCount));
        EXPECT_TRUE(std::all_of(
            entries.begin(),
            entries.end(),
            [](const ModFileTreeEntry& entry)
            {
                return !entry.isDirectory &&
                    entry.conflictState == L"overwritten" &&
                    entry.conflictOwners.size() == 2U &&
                    entry.conflictOwners[0] == L"Bulk Conflict A" &&
                    entry.conflictOwners[1] == L"Bulk Conflict B";
            }));
#endif
    }
}
