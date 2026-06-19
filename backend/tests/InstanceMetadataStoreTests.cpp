#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
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

            HMODULE module{nullptr};
            Open16Fn open16{};
            CloseFn close{};
            PrepareFn prepare{};
            StepFn step{};
            FinalizeFn finalize{};
            ColumnIntFn columnInt{};

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

    TEST(InstanceMetadataStoreTests, ListInstalledModsRecreatesMissingPortableManifest)
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
}
