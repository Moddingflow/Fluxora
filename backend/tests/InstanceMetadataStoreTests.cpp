#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "FluxoraCore/Services/InstallOperationStore.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
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

    TEST(InstanceMetadataStoreTests, ArchiveBuildStatusFollowsAttemptInstallDeleteAndReinstallTransitions)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path modPath = project / L"mods" / L"SkyUI";
        writeTextFile(modPath / L"interface" / L"skyui.swf", "ui");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"archive-a"),
            ArchiveBuildStatus::Ready);

        InstanceMetadataStore::beginArchiveInstallAttempt(
            project,
            L"archive-a",
            L"operation-a",
            L"SkyUI");
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"archive-a"),
            ArchiveBuildStatus::Installing);

        const InstalledModRecord installed = InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"SkyUI",
            L"1.0",
            {});
        InstanceMetadataStore::completeArchiveInstallAttempt(
            project,
            L"archive-a",
            installed.uuid,
            L"operation-a",
            ArchiveModLinkMode::Replace);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"archive-a"),
            ArchiveBuildStatus::Installed);

        InstanceMetadataStore::deleteInstalledMod(project, modPath);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"archive-a"),
            ArchiveBuildStatus::Deleted);

        InstanceMetadataStore::beginArchiveInstallAttempt(
            project,
            L"archive-a",
            L"operation-b",
            L"SkyUI");
        InstanceMetadataStore::failArchiveInstallAttempt(project, L"operation-b");
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"archive-a"),
            ArchiveBuildStatus::Deleted);

        const InstalledModRecord reinstalled = InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"SkyUI",
            L"1.1",
            {});
        InstanceMetadataStore::beginArchiveInstallAttempt(
            project,
            L"archive-a",
            L"operation-c",
            L"SkyUI");
        InstanceMetadataStore::completeArchiveInstallAttempt(
            project,
            L"archive-a",
            reinstalled.uuid,
            L"operation-c",
            ArchiveModLinkMode::Replace);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"archive-a"),
            ArchiveBuildStatus::Installed);
#endif
    }

    TEST(InstanceMetadataStoreTests, ArchiveBuildStatusHandlesReplacementSharedArchivesAndStaleAttempts)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path firstPath = project / L"mods" / L"First";
        const std::filesystem::path secondPath = project / L"mods" / L"Second";
        writeTextFile(firstPath / L"first.esp", "first");
        writeTextFile(secondPath / L"second.esp", "second");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        const InstalledModRecord first = InstanceMetadataStore::registerInstalledMod(
            project,
            firstPath,
            L"First",
            L"1.0",
            {});
        const InstalledModRecord second = InstanceMetadataStore::registerInstalledMod(
            project,
            secondPath,
            L"Second",
            L"1.0",
            {});

        InstanceMetadataStore::beginArchiveInstallAttempt(project, L"shared", L"shared-a", L"First");
        InstanceMetadataStore::completeArchiveInstallAttempt(
            project,
            L"shared",
            first.uuid,
            L"shared-a",
            ArchiveModLinkMode::Replace);
        InstanceMetadataStore::beginArchiveInstallAttempt(project, L"shared", L"shared-b", L"Second");
        InstanceMetadataStore::completeArchiveInstallAttempt(
            project,
            L"shared",
            second.uuid,
            L"shared-b",
            ArchiveModLinkMode::Replace);
        InstanceMetadataStore::deleteInstalledMod(project, firstPath);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"shared"),
            ArchiveBuildStatus::Installed);

        InstanceMetadataStore::beginArchiveInstallAttempt(
            project,
            L"merged-translation",
            L"merge",
            L"Second");
        InstanceMetadataStore::completeArchiveInstallAttempt(
            project,
            L"merged-translation",
            second.uuid,
            L"merge",
            ArchiveModLinkMode::Merge);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"shared"),
            ArchiveBuildStatus::Installed);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"merged-translation"),
            ArchiveBuildStatus::Installed);

        InstanceMetadataStore::beginArchiveInstallAttempt(project, L"replacement", L"replace", L"Second");
        InstanceMetadataStore::completeArchiveInstallAttempt(
            project,
            L"replacement",
            second.uuid,
            L"replace",
            ArchiveModLinkMode::Replace);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"shared"),
            ArchiveBuildStatus::Deleted);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"merged-translation"),
            ArchiveBuildStatus::Deleted);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"replacement"),
            ArchiveBuildStatus::Installed);

        InstanceMetadataStore::beginArchiveInstallAttempt(project, L"orphan", L"orphan-op", L"Orphan");
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"orphan"),
            ArchiveBuildStatus::Installing);
        InstanceMetadataStore::beginProjectActivation(project);
        EXPECT_EQ(
            InstanceMetadataStore::archiveBuildStatus(project, L"orphan"),
            ArchiveBuildStatus::Ready);
#endif
    }

    TEST(InstanceMetadataStoreTests, IdentityCandidateQueryUsesDatabaseIndexAndLimitsFuzzyResults)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";

        std::vector<InstalledModImportRecord> imports;
        for (int index = 1; index <= 7; ++index)
        {
            const std::wstring name = L"Amazing Weather Variant " + std::to_wstring(index);
            const std::filesystem::path modPath = mods / name;
            writeTextFile(modPath / L"Data" / (L"Weather" + std::to_wstring(index) + L".esp"), "plugin");
            imports.push_back(InstalledModImportRecord{modPath, name, L"1.0", true, {}});
        }

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(project, imports);
        InstanceMetadataStore::resetInventorySyncCountForTesting();

        ModIdentityCatalogQuery query;
        query.normalizedName = L"amazing weather overhaul";
        query.tokens = {L"amazing", L"weather", L"overhaul"};
        const ModIdentityCatalogSnapshot snapshot =
            InstanceMetadataStore::queryModIdentityCandidates(project, query);

        EXPECT_EQ(snapshot.candidates.size(), 5U);
        EXPECT_GT(snapshot.catalogRevision, 0U);
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 0U);

        const std::filesystem::path database = project / L"instance.db";
        EXPECT_TRUE(sqliteTableExists(database, "mod_identity_keys"));
        EXPECT_TRUE(sqliteTableExists(database, "mod_identity_tokens"));
        EXPECT_TRUE(sqliteTableExists(database, "mod_identity_aliases"));
        EXPECT_TRUE(sqliteTableExists(database, "mod_identity_exclusions"));
        EXPECT_TRUE(sqliteTableExists(database, "mod_identity_cache"));
        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 12);
#endif
    }

    TEST(InstanceMetadataStoreTests, IdentityCandidateIndexStaysUnderFiftyMillisecondsForFiveThousandMods)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        std::string seed = "BEGIN;";
        seed.reserve(2'500'000);
        for (int index = 1; index <= 5'000; ++index)
        {
            const std::string number = std::to_string(index);
            seed += "INSERT INTO mods(id,uuid,game_id,folder_name,display_name,installed_at,updated_at) VALUES(";
            seed += number + ",'uuid-" + number + "','skyrimse','Weather " + number +
                "','Amazing Weather Variant " + number + "','2026-07-15T00:00:00Z','2026-07-15T00:00:00Z');";
            seed += "INSERT INTO mod_identity_keys(mod_id,key_kind,key_value,created_at) VALUES(" +
                number + ",'name','amazing weather variant " + number + "','');";
            seed += "INSERT INTO mod_identity_tokens(mod_id,token,weight) VALUES(" +
                number + ",'amazing',3);";
            seed += "INSERT INTO mod_identity_tokens(mod_id,token,weight) VALUES(" +
                number + ",'weather',3);";
        }
        seed += "COMMIT;";
        sqliteExec(project / L"instance.db", seed.c_str());

        ModIdentityCatalogQuery query;
        query.normalizedName = L"amazing weather overhaul";
        query.tokens = {L"amazing", L"weather", L"overhaul"};
        query.limit = 5;
        ASSERT_EQ(
            InstanceMetadataStore::queryModIdentityCandidates(project, query).candidates.size(),
            5U);

        std::chrono::milliseconds best{10'000};
        for (int iteration = 0; iteration < 5; ++iteration)
        {
            const auto startedAt = std::chrono::steady_clock::now();
            const ModIdentityCatalogSnapshot snapshot =
                InstanceMetadataStore::queryModIdentityCandidates(project, query);
            const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - startedAt);
            best = (std::min)(best, elapsed);
            ASSERT_EQ(snapshot.candidates.size(), 5U);
        }
        EXPECT_LT(best.count(), 50);
#endif
    }

    TEST(InstanceMetadataStoreTests, IdentityMetadataPersistsAliasesAndFomodIdInPortableManifestV2)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path modPath = project / L"mods" / L"Spell Perks Item Distributor";
        writeTextFile(modPath / L"Data" / L"SPID.esp", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        const InstalledModRecord installed = InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"Spell Perks Item Distributor",
            L"7.2.0",
            ModSourceRecord{L"manual", {}, {}, {}});

        ModIdentityPersistenceUpdate update;
        update.modUuid = installed.uuid;
        update.fomodModuleId = L"spid-module";
        update.confirmedAliases = {L"SPID", L"Renamed Incoming Archive"};
        update.sourceProvider = L"nexus";
        update.sourceGameDomain = L"skyrimspecialedition";
        update.sourceRemoteModId = L"36869";
        update.sourceRemoteFileId = L"100";
        InstanceMetadataStore::recordModIdentity(project, update);

        ModIdentityCatalogQuery query;
        query.normalizedName = L"renamed incoming archive";
        query.tokens = {L"renamed", L"incoming", L"archive"};
        const ModIdentityCatalogSnapshot snapshot =
            InstanceMetadataStore::queryModIdentityCandidates(project, query);

        ASSERT_EQ(snapshot.candidates.size(), 1U);
        EXPECT_EQ(snapshot.candidates[0].mod.uuid, installed.uuid);
        EXPECT_EQ(snapshot.candidates[0].fomodModuleId, L"spid-module");
        EXPECT_EQ(snapshot.candidates[0].aliases.size(), 2U);

        ModIdentityCatalogQuery sourceQuery;
        sourceQuery.provider = L"nexus";
        sourceQuery.gameDomain = L"skyrimspecialedition";
        sourceQuery.remoteModId = L"36869";
        const ModIdentityCatalogSnapshot sourceSnapshot =
            InstanceMetadataStore::queryModIdentityCandidates(project, sourceQuery);
        ASSERT_EQ(sourceSnapshot.candidates.size(), 1U);
        EXPECT_EQ(sourceSnapshot.candidates[0].mod.uuid, installed.uuid);
        EXPECT_EQ(sourceSnapshot.candidates[0].mod.source.remoteFileId, L"100");
        EXPECT_TRUE(sourceSnapshot.candidates[0].mod.sourceIsNexus);
        EXPECT_FALSE(sourceSnapshot.candidates[0].mod.isLocal);

        const std::string manifest = readTextFile(portableManifestPath(modPath));
        EXPECT_NE(manifest.find(R"("schemaVersion":2)"), std::string::npos);
        EXPECT_NE(manifest.find(R"("fomodModuleId":"spid-module")"), std::string::npos);
        EXPECT_NE(manifest.find(R"("Renamed Incoming Archive")"), std::string::npos);
#endif
    }

    TEST(InstanceMetadataStoreTests, IdentityContentAndOnlineCachesInvalidateByArchiveFingerprint)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        const std::wstring fingerprint = L"v=2|path=one|content=abc";
        InstanceMetadataStore::recordModIdentityContentCache(
            project,
            fingerprint,
            ModIdentityContentCacheRecord{
                {L"weather.esp"},
                {L"weather.bsa"},
                {L"weather.dll"}
            });
        const std::optional<ModIdentityContentCacheRecord> content =
            InstanceMetadataStore::modIdentityContentCache(project, fingerprint);
        ASSERT_TRUE(content.has_value());
        EXPECT_EQ(content->pluginFiles, (std::vector<std::wstring>{L"weather.esp"}));
        EXPECT_FALSE(InstanceMetadataStore::modIdentityContentCache(
            project,
            L"v=2|path=one|content=changed").has_value());

        InstanceMetadataStore::recordModIdentityOnlineCache(
            project,
            fingerprint,
            ModIdentityOnlineCacheRecord{
                L"nexus",
                L"skyrimspecialedition",
                L"3863",
                L"123",
                L"SkyUI",
                L"md5",
                L"sha256",
                1'048'576,
                L"2026-07-15T00:00:00Z"
            });
        const std::optional<ModIdentityOnlineCacheRecord> online =
            InstanceMetadataStore::modIdentityOnlineCache(
                project,
                fingerprint,
                L"NEXUS",
                L"SkyrimSpecialEdition",
                L"MD5",
                L"SHA256",
                1'048'576);
        ASSERT_TRUE(online.has_value());
        EXPECT_EQ(online->remoteModId, L"3863");
        EXPECT_EQ(online->remoteFileId, L"123");
        EXPECT_EQ(online->modName, L"SkyUI");
        EXPECT_FALSE(InstanceMetadataStore::modIdentityOnlineCache(
            project,
            fingerprint,
            L"nexus",
            L"skyrimspecialedition",
            L"md5",
            L"sha256",
            1'048'577).has_value());
        EXPECT_TRUE(InstanceMetadataStore::modIdentityContentCache(project, fingerprint).has_value());
#endif
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
                 "archive_mod_links",
                 "archive_install_attempts",
                 "pending_install_sessions",
                 "pending_install_files",
                 "mod_notes",
                 "mod_update_sweeps"
             })
        {
            EXPECT_TRUE(sqliteTableExists(database, table)) << table;
        }
        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 12);

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* mod = findInstalledMod(records, L"SkyUI Russian Patch");
        ASSERT_NE(mod, nullptr);
        EXPECT_TRUE(mod->sourceIsNexus);
        EXPECT_EQ(mod->source.latestVersion, L"1.2");
        EXPECT_EQ(mod->source.latestFileId, L"123");
        EXPECT_EQ(mod->source.updateCheckState, L"baseline_pending");
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

    TEST(InstanceMetadataStoreTests, GeneratedPgPatcherFileSummaryDoesNotCreatePortableManifest)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path output = mods / L"PGPatcher Output";
        const std::filesystem::path generatedMesh = output / L"meshes" / L"generated.nif";
        writeTextFile(generatedMesh, "generated");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMod(
            project,
            output,
            L"PGPatcher Output",
            {},
            ModSourceRecord{L"generated-pgpatcher"});
        ASSERT_FALSE(std::filesystem::exists(portableManifestPath(output)));

        InstanceMetadataStore::invalidateModFileCaches(project, {generatedMesh}, mods);
        const ModFileSummary summary =
            InstanceMetadataStore::summarizeModFiles(project, output, mods);

        EXPECT_EQ(summary.fileCount, 1);
        EXPECT_FALSE(std::filesystem::exists(portableManifestPath(output)));
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
        sqliteExec(database, "PRAGMA user_version = 13;");
        ASSERT_FALSE(sqliteTableExists(database, "instance_metadata"));
        InstanceMetadataStore::resetSqlPrepareCountForTesting();
        InstanceMetadataStore::resetSqlExecCountForTesting();

        EXPECT_THROW(
            (void)InstanceMetadataStore::gameId(project),
            std::runtime_error);
        EXPECT_EQ(InstanceMetadataStore::sqlPrepareCountForTesting(), 1U);
        EXPECT_EQ(InstanceMetadataStore::sqlExecCountForTesting(), 0U);
        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 13);
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

        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 12);
        EXPECT_TRUE(sqliteTableExists(database, "mod_file_cache_state"));
        EXPECT_TRUE(sqliteTableExists(database, "archive_mod_links"));
        EXPECT_TRUE(sqliteTableExists(database, "archive_install_attempts"));
        EXPECT_TRUE(sqliteTableExists(database, "pending_install_sessions"));
        EXPECT_TRUE(sqliteTableExists(database, "pending_install_files"));
        EXPECT_TRUE(sqliteTableExists(database, "install_operations"));
        EXPECT_GT(InstanceMetadataStore::sqlPrepareCountForTesting(), 2U);
        EXPECT_GT(InstanceMetadataStore::sqlExecCountForTesting(), 3U);
#endif
    }

    TEST(InstanceMetadataStoreTests, InstallOperationsPersistQueueStateAndResumePayload)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        InstallOperationRecord first;
        first.operationId = L"install-op-1";
        first.sourceKind = L"download";
        first.sourcePath = project / L"downloads" / L"SkyUI.7z";
        first.archiveFingerprint = L"sha256:first";
        first.profileName = L"Default";
        first.targetFolder = L"SkyUI";
        first.selectedOptionIdsJson = LR"(["core","wide"])";
        first.manualDecisionsJson = LR"([{"optionId":"wide","selected":true}])";
        first.beforeOrderId = L"order-before";
        first.afterOrderId = L"order-after";
        first.enqueueSequence = 41;
        first.requestJson = LR"({"sourceKind":"download","isFomod":true})";
        InstallOperationStore::save(project, first);

        InstallOperationRecord second = first;
        second.operationId = L"install-op-2";
        second.sourcePath = project / L"downloads" / L"RaceMenu.7z";
        second.targetFolder = L"RaceMenu";
        second.enqueueSequence = 42;
        second.state = L"waitingTarget";
        second.stage = L"waitingTarget";
        InstallOperationStore::save(project, second);

        InstallOperationRecord automatic = first;
        automatic.operationId = L"install-op-auto";
        automatic.sourcePath = project / L"downloads" / L"Auto.7z";
        automatic.targetFolder = L"Auto";
        automatic.enqueueSequence = 0;
        const std::uint64_t automaticSequence = InstallOperationStore::save(project, automatic);
        automatic.state = L"extracting";
        automatic.stage = L"extracting";
        EXPECT_EQ(InstallOperationStore::save(project, automatic), automaticSequence);

        std::vector<InstallOperationRecord> active = InstallOperationStore::list(project, false);
        ASSERT_EQ(active.size(), 3U);
        EXPECT_EQ(active[0].operationId, L"install-op-1");
        EXPECT_EQ(active[1].operationId, L"install-op-2");
        EXPECT_EQ(active[2].operationId, L"install-op-auto");

        first.state = L"completed";
        first.stage = L"finalizing";
        first.progressPercent = 100;
        first.indeterminate = false;
        first.resultJson = LR"({"name":"SkyUI"})";
        InstallOperationStore::save(project, first);

        const std::optional<InstallOperationRecord> restored =
            InstallOperationStore::get(project, L"install-op-1");
        ASSERT_TRUE(restored.has_value());
        EXPECT_EQ(restored->state, L"completed");
        EXPECT_EQ(restored->resultJson, LR"({"name":"SkyUI"})");
        EXPECT_EQ(restored->selectedOptionIdsJson, LR"(["core","wide"])" );
        EXPECT_EQ(restored->beforeOrderId, L"order-before");
        EXPECT_EQ(restored->afterOrderId, L"order-after");
        automatic.state = L"needsReview";
        automatic.stage = L"needsReview";
        automatic.enqueueSequence = automaticSequence;
        InstallOperationStore::save(project, automatic);
        EXPECT_EQ(InstallOperationStore::list(project, false).size(), 1U);
    }

    TEST(InstanceMetadataStoreTests, VersionEightMigrationAddsFileUpdateStateAndBaselineSweep)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Persistent metadata counters are enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path modPath = mods / L"Baseline Nexus Mod";
        writeTextFile(modPath / L"Data" / L"content.bin", "content");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"Baseline Nexus Mod",
            L"opaque-v1",
            ModSourceRecord{
                L"nexus",
                L"skyrimspecialedition",
                L"100",
                L"200",
                L"nxm://skyrimspecialedition/mods/100/files/200"});

        const std::filesystem::path database = project / L"instance.db";
        sqliteExec(database, "DROP TABLE mod_update_sweeps;");
        sqliteExec(database, "ALTER TABLE mod_sources DROP COLUMN latest_file_id;");
        sqliteExec(database, "ALTER TABLE mod_sources DROP COLUMN last_check_state;");
        sqliteExec(database, "ALTER TABLE mod_sources DROP COLUMN last_attempted_at;");
        sqliteExec(database, "PRAGMA user_version = 8;");

        EXPECT_EQ(InstanceMetadataStore::gameId(project), L"skyrimse");

        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 12);
        EXPECT_TRUE(sqliteTableExists(database, "mod_update_sweeps"));
        EXPECT_EQ(
            sqliteIntScalar(
                database,
                "SELECT COUNT(*) FROM pragma_table_info('mod_sources') "
                "WHERE name IN ('latest_file_id', 'last_check_state', 'last_attempted_at');"),
            3);
        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project, mods);
        const InstalledModRecord* mod = findInstalledMod(records, L"Baseline Nexus Mod");
        ASSERT_NE(mod, nullptr);
        EXPECT_EQ(mod->source.latestVersion, L"opaque-v1");
        EXPECT_EQ(mod->source.latestFileId, L"200");
        EXPECT_EQ(mod->source.updateCheckState, L"baseline_pending");
#endif
    }

    TEST(InstanceMetadataStoreTests, VersionNineMigrationAllowsMultipleCurrentArchivesPerMod)
    {
#if !defined(_WIN32) || !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Persistent metadata counters are enabled for Windows metadata tests.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path database = project / L"instance.db";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        sqliteExec(database, "DROP INDEX idx_archive_mod_links_current_archive_mod;");
        sqliteExec(
            database,
            "CREATE UNIQUE INDEX idx_archive_mod_links_current_mod "
            "ON archive_mod_links(mod_id) WHERE is_current = 1 AND mod_id IS NOT NULL;");
        sqliteExec(database, "PRAGMA user_version = 9;");

        EXPECT_EQ(InstanceMetadataStore::gameId(project), L"skyrimse");

        EXPECT_EQ(sqliteIntScalar(database, "PRAGMA user_version;"), 12);
        EXPECT_EQ(
            sqliteIntScalar(
                database,
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' "
                "AND name = 'idx_archive_mod_links_current_mod';"),
            0);
        EXPECT_EQ(
            sqliteIntScalar(
                database,
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' "
                "AND name = 'idx_archive_mod_links_current_archive_mod';"),
            1);
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

    TEST(InstanceMetadataStoreTests, PendingInstallFinalizationFailureRollsBackAtomicMetadata)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Pending install finalization uses the Windows SQLite metadata store.";
#elif !defined(FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS)
        GTEST_SKIP() << "Instance metadata failure injection hooks are disabled.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path project = temp.path() / L"Atomic Pending Install";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path installed = mods / L"Incoming";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::beginPendingInstallSession(
            project,
            L"op_finalize_failure",
            L"Default",
            InstallConflictPreviewMode::Install,
            L"pending-install:op_finalize_failure",
            {},
            0);
        static_cast<void>(InstanceMetadataStore::preparePendingInstallSession(
            project,
            L"op_finalize_failure",
            {InstallConflictFile{L"Data/Incoming.esp", 8, L"1"}}));
        writeTextFile(installed / L"Data" / L"Incoming.esp", "incoming");

        InstanceMetadataStore::setPendingInstallFinalizeFailureForTesting(true);
        EXPECT_THROW(
            static_cast<void>(InstanceMetadataStore::finalizePendingInstalledMod(
                project,
                L"op_finalize_failure",
                installed,
                L"Incoming",
                L"1.0.0",
                ModSourceRecord{L"local"})),
            std::runtime_error);

        const PendingInstallSessionRecord session =
            InstanceMetadataStore::pendingInstallSession(project, L"op_finalize_failure");
        EXPECT_EQ(session.state, L"ready");
        EXPECT_TRUE(session.finalOrderId.empty());
        EXPECT_TRUE(
            InstanceMetadataStore::persistedInstalledModsSnapshot(project, mods).mods.empty());
        EXPECT_FALSE(std::filesystem::exists(installed / L".flow" / L"manifest.json"));
#endif
    }
}
