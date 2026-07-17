#include "NexusUpdateCache.hpp"

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cwctype>
#include <mutex>
#include <stdexcept>
#include <string>
#include <utility>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#endif

struct sqlite3;
struct sqlite3_stmt;

namespace fluxora
{
    namespace
    {
        std::mutex& cacheMutex()
        {
            static std::mutex mutex;
            return mutex;
        }

        std::wstring lower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::filesystem::path defaultCachePath()
        {
#ifdef _WIN32
            wchar_t* appDataValue{};
            std::size_t length{};
            if (_wdupenv_s(&appDataValue, &length, L"APPDATA") == 0 && appDataValue != nullptr)
            {
                const std::filesystem::path appData(appDataValue);
                std::free(appDataValue);
                return appData / L"Fluxora" / L"nexus-update-cache.sqlite3";
            }
#else
            if (const char* home = std::getenv("HOME"); home != nullptr && *home != '\0')
            {
                return std::filesystem::path(home) / ".config" / "Fluxora" / "nexus-update-cache.sqlite3";
            }
#endif
            return std::filesystem::temp_directory_path() / L"Fluxora" / L"nexus-update-cache.sqlite3";
        }

#ifdef _WIN32
        constexpr int sqliteOk = 0;
        constexpr int sqliteRow = 100;
        constexpr int sqliteDone = 101;
        using SqliteDestructor = void (*)(void*);

        class SqliteApi final
        {
        public:
            using Open16Fn = int (__cdecl *)(const void*, sqlite3**);
            using CloseFn = int (__cdecl *)(sqlite3*);
            using ExecFn = int (__cdecl *)(sqlite3*, const char*, int (*)(void*, int, char**, char**), void*, char**);
            using PrepareFn = int (__cdecl *)(sqlite3*, const char*, int, sqlite3_stmt**, const char**);
            using StepFn = int (__cdecl *)(sqlite3_stmt*);
            using FinalizeFn = int (__cdecl *)(sqlite3_stmt*);
            using BindText16Fn = int (__cdecl *)(sqlite3_stmt*, int, const void*, int, SqliteDestructor);
            using BindIntFn = int (__cdecl *)(sqlite3_stmt*, int, int);
            using BindInt64Fn = int (__cdecl *)(sqlite3_stmt*, int, long long);
            using ColumnText16Fn = const void* (__cdecl *)(sqlite3_stmt*, int);
            using ColumnBytes16Fn = int (__cdecl *)(sqlite3_stmt*, int);
            using ColumnIntFn = int (__cdecl *)(sqlite3_stmt*, int);
            using ColumnInt64Fn = long long (__cdecl *)(sqlite3_stmt*, int);
            using ErrmsgFn = const char* (__cdecl *)(sqlite3*);
            using BusyTimeoutFn = int (__cdecl *)(sqlite3*, int);
            using FreeFn = void (__cdecl *)(void*);

            SqliteApi()
            {
                module_ = LoadLibraryW(L"winsqlite3.dll");
                if (module_ == nullptr)
                {
                    throw std::runtime_error("winsqlite3.dll is not available.");
                }
                open16 = load<Open16Fn>("sqlite3_open16");
                close = load<CloseFn>("sqlite3_close");
                exec = load<ExecFn>("sqlite3_exec");
                prepare = load<PrepareFn>("sqlite3_prepare_v2");
                step = load<StepFn>("sqlite3_step");
                finalize = load<FinalizeFn>("sqlite3_finalize");
                bindText16 = load<BindText16Fn>("sqlite3_bind_text16");
                bindInt = load<BindIntFn>("sqlite3_bind_int");
                bindInt64 = load<BindInt64Fn>("sqlite3_bind_int64");
                columnText16 = load<ColumnText16Fn>("sqlite3_column_text16");
                columnBytes16 = load<ColumnBytes16Fn>("sqlite3_column_bytes16");
                columnInt = load<ColumnIntFn>("sqlite3_column_int");
                columnInt64 = load<ColumnInt64Fn>("sqlite3_column_int64");
                errmsg = load<ErrmsgFn>("sqlite3_errmsg");
                busyTimeout = load<BusyTimeoutFn>("sqlite3_busy_timeout");
                free = load<FreeFn>("sqlite3_free");
            }

            ~SqliteApi()
            {
                if (module_ != nullptr)
                {
                    FreeLibrary(module_);
                }
            }

            Open16Fn open16{};
            CloseFn close{};
            ExecFn exec{};
            PrepareFn prepare{};
            StepFn step{};
            FinalizeFn finalize{};
            BindText16Fn bindText16{};
            BindIntFn bindInt{};
            BindInt64Fn bindInt64{};
            ColumnText16Fn columnText16{};
            ColumnBytes16Fn columnBytes16{};
            ColumnIntFn columnInt{};
            ColumnInt64Fn columnInt64{};
            ErrmsgFn errmsg{};
            BusyTimeoutFn busyTimeout{};
            FreeFn free{};

        private:
            template <typename T>
            T load(const char* name)
            {
                const FARPROC address = GetProcAddress(module_, name);
                if (address == nullptr)
                {
                    throw std::runtime_error("winsqlite3.dll is missing a required SQLite entry point.");
                }
                return reinterpret_cast<T>(address);
            }

            HMODULE module_{nullptr};
        };

        SqliteApi& sqlite()
        {
            static SqliteApi api;
            return api;
        }

        std::string sqliteError(sqlite3* handle)
        {
            const char* message = sqlite().errmsg(handle);
            return message == nullptr ? "SQLite error." : std::string(message);
        }

        class Statement final
        {
        public:
            Statement(sqlite3* handle, const char* sql)
                : handle_(handle)
            {
                if (sqlite().prepare(handle_, sql, -1, &statement_, nullptr) != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            ~Statement()
            {
                if (statement_ != nullptr)
                {
                    sqlite().finalize(statement_);
                }
            }

            Statement(const Statement&) = delete;
            Statement& operator=(const Statement&) = delete;

            void bindText(int index, std::wstring_view value)
            {
                if (sqlite().bindText16(
                        statement_,
                        index,
                        value.data(),
                        static_cast<int>(value.size() * sizeof(wchar_t)),
                        reinterpret_cast<SqliteDestructor>(-1)) != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            void bindInt(int index, int value)
            {
                if (sqlite().bindInt(statement_, index, value) != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            void bindInt64(int index, std::int64_t value)
            {
                if (sqlite().bindInt64(statement_, index, value) != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            bool stepRow()
            {
                const int result = sqlite().step(statement_);
                if (result == sqliteRow)
                {
                    return true;
                }
                if (result == sqliteDone)
                {
                    return false;
                }
                throw std::runtime_error(sqliteError(handle_));
            }

            void stepDone()
            {
                if (sqlite().step(statement_) != sqliteDone)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            std::wstring columnText(int index) const
            {
                const void* text = sqlite().columnText16(statement_, index);
                if (text == nullptr)
                {
                    return {};
                }
                const int bytes = sqlite().columnBytes16(statement_, index);
                return std::wstring(
                    static_cast<const wchar_t*>(text),
                    static_cast<std::size_t>(bytes / sizeof(wchar_t)));
            }

            int columnInt(int index) const
            {
                return sqlite().columnInt(statement_, index);
            }

            std::int64_t columnInt64(int index) const
            {
                return static_cast<std::int64_t>(sqlite().columnInt64(statement_, index));
            }

        private:
            sqlite3* handle_{};
            sqlite3_stmt* statement_{};
        };

        class Database final
        {
        public:
            explicit Database(const std::filesystem::path& path)
            {
                const std::wstring text = path.wstring();
                if (sqlite().open16(text.c_str(), &handle_) != sqliteOk || handle_ == nullptr)
                {
                    const std::string message = handle_ == nullptr
                        ? "Failed to open Nexus update cache."
                        : sqliteError(handle_);
                    if (handle_ != nullptr)
                    {
                        sqlite().close(handle_);
                    }
                    throw std::runtime_error(message);
                }
                if (sqlite().busyTimeout(handle_, 15000) != sqliteOk)
                {
                    throw std::runtime_error(sqliteError(handle_));
                }
            }

            ~Database()
            {
                if (handle_ != nullptr)
                {
                    sqlite().close(handle_);
                }
            }

            void exec(const char* sql)
            {
                char* error{};
                if (sqlite().exec(handle_, sql, nullptr, nullptr, &error) != sqliteOk)
                {
                    const std::string message = error == nullptr ? sqliteError(handle_) : std::string(error);
                    if (error != nullptr)
                    {
                        sqlite().free(error);
                    }
                    throw std::runtime_error(message);
                }
            }

            [[nodiscard]] Statement prepare(const char* sql)
            {
                return Statement(handle_, sql);
            }

        private:
            sqlite3* handle_{};
        };

        class Transaction final
        {
        public:
            explicit Transaction(Database& database)
                : database_(database)
            {
                database_.exec("BEGIN IMMEDIATE;");
            }

            ~Transaction()
            {
                if (!committed_)
                {
                    try
                    {
                        database_.exec("ROLLBACK;");
                    }
                    catch (...)
                    {
                    }
                }
            }

            void commit()
            {
                database_.exec("COMMIT;");
                committed_ = true;
            }

        private:
            Database& database_;
            bool committed_{false};
        };

        void ensureSchema(Database& database)
        {
            database.exec("PRAGMA foreign_keys = ON;");
            database.exec("PRAGMA journal_mode = WAL;");
            database.exec("PRAGMA synchronous = NORMAL;");
            database.exec(
                "CREATE TABLE IF NOT EXISTS mod_pages ("
                "game_domain TEXT NOT NULL, mod_id TEXT NOT NULL, fetched_at TEXT NOT NULL, last_used_at TEXT NOT NULL, "
                "PRIMARY KEY(game_domain, mod_id));");
            database.exec(
                "CREATE TABLE IF NOT EXISTS files ("
                "game_domain TEXT NOT NULL, mod_id TEXT NOT NULL, file_id TEXT NOT NULL, version TEXT NOT NULL DEFAULT '', "
                "category_id TEXT NOT NULL DEFAULT '', is_primary INTEGER NOT NULL DEFAULT -1, availability INTEGER NOT NULL, "
                "uploaded_timestamp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(game_domain, mod_id, file_id), "
                "FOREIGN KEY(game_domain, mod_id) REFERENCES mod_pages(game_domain, mod_id) ON DELETE CASCADE);");
            database.exec(
                "CREATE TABLE IF NOT EXISTS file_updates ("
                "game_domain TEXT NOT NULL, mod_id TEXT NOT NULL, old_file_id TEXT NOT NULL, new_file_id TEXT NOT NULL, "
                "uploaded_timestamp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(game_domain, mod_id, old_file_id, new_file_id), "
                "FOREIGN KEY(game_domain, mod_id) REFERENCES mod_pages(game_domain, mod_id) ON DELETE CASCADE);");
            database.exec(
                "CREATE TABLE IF NOT EXISTS recent_sweeps ("
                "game_domain TEXT NOT NULL, period TEXT NOT NULL, fetched_at TEXT NOT NULL, last_used_at TEXT NOT NULL, "
                "PRIMARY KEY(game_domain, period));");
            database.exec(
                "CREATE TABLE IF NOT EXISTS recent_mods ("
                "game_domain TEXT NOT NULL, period TEXT NOT NULL, mod_id TEXT NOT NULL, "
                "latest_file_update INTEGER NOT NULL DEFAULT 0, latest_mod_activity INTEGER NOT NULL DEFAULT 0, "
                "PRIMARY KEY(game_domain, period, mod_id), "
                "FOREIGN KEY(game_domain, period) REFERENCES recent_sweeps(game_domain, period) ON DELETE CASCADE);");
            database.exec(
                "CREATE TABLE IF NOT EXISTS quota_snapshot ("
                "id INTEGER PRIMARY KEY CHECK(id = 1), hourly_limit INTEGER NOT NULL DEFAULT -1, "
                "hourly_remaining INTEGER NOT NULL DEFAULT -1, hourly_reset_at TEXT NOT NULL DEFAULT '', "
                "daily_limit INTEGER NOT NULL DEFAULT -1, daily_remaining INTEGER NOT NULL DEFAULT -1, "
                "daily_reset_at TEXT NOT NULL DEFAULT '', captured_at TEXT NOT NULL DEFAULT '');");
            database.exec("CREATE INDEX IF NOT EXISTS idx_mod_pages_last_used ON mod_pages(last_used_at);");
            database.exec("CREATE INDEX IF NOT EXISTS idx_recent_sweeps_last_used ON recent_sweeps(last_used_at);");
            database.exec("PRAGMA user_version = 1;");
        }

        Database openCache(const std::filesystem::path& path)
        {
            std::filesystem::create_directories(path.parent_path());
            Database database(path);
            ensureSchema(database);
            return database;
        }

        NexusQuotaSnapshot readQuota(Database& database)
        {
            Statement statement = database.prepare(
                "SELECT hourly_limit, hourly_remaining, hourly_reset_at, daily_limit, daily_remaining, "
                "daily_reset_at, captured_at FROM quota_snapshot WHERE id = 1;");
            if (!statement.stepRow())
            {
                return {};
            }
            return NexusQuotaSnapshot{
                statement.columnInt64(0),
                statement.columnInt64(1),
                statement.columnText(2),
                statement.columnInt64(3),
                statement.columnInt64(4),
                statement.columnText(5),
                statement.columnText(6)
            };
        }

        void writeQuota(Database& database, const NexusQuotaSnapshot& quota)
        {
            Statement statement = database.prepare(
                "INSERT INTO quota_snapshot(id, hourly_limit, hourly_remaining, hourly_reset_at, daily_limit, "
                "daily_remaining, daily_reset_at, captured_at) VALUES(1, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET hourly_limit = excluded.hourly_limit, "
                "hourly_remaining = excluded.hourly_remaining, hourly_reset_at = excluded.hourly_reset_at, "
                "daily_limit = excluded.daily_limit, daily_remaining = excluded.daily_remaining, "
                "daily_reset_at = excluded.daily_reset_at, captured_at = excluded.captured_at;");
            statement.bindInt64(1, quota.hourlyLimit);
            statement.bindInt64(2, quota.hourlyRemaining);
            statement.bindText(3, quota.hourlyResetAt);
            statement.bindInt64(4, quota.dailyLimit);
            statement.bindInt64(5, quota.dailyRemaining);
            statement.bindText(6, quota.dailyResetAt);
            statement.bindText(7, quota.capturedAt);
            statement.stepDone();
        }
#endif
    }

    NexusUpdateCache::NexusUpdateCache(std::filesystem::path path)
        : path_(path.empty() ? defaultCachePath() : std::move(path))
    {
    }

    const std::filesystem::path& NexusUpdateCache::path() const noexcept
    {
        return path_;
    }

    std::optional<NexusModFilesResponse> NexusUpdateCache::loadModFiles(
        std::wstring_view gameDomain,
        std::wstring_view modId,
        std::wstring_view notOlderThan,
        std::wstring_view usedAt) const
    {
#ifndef _WIN32
        (void)gameDomain; (void)modId; (void)notOlderThan; (void)usedAt;
        return std::nullopt;
#else
        const std::lock_guard lock(cacheMutex());
        Database database = openCache(path_);
        const std::wstring game = lower(std::wstring(gameDomain));
        Statement page = database.prepare(
            "SELECT fetched_at FROM mod_pages WHERE game_domain = ? AND mod_id = ? AND fetched_at >= ? LIMIT 1;");
        page.bindText(1, game);
        page.bindText(2, modId);
        page.bindText(3, notOlderThan);
        if (!page.stepRow())
        {
            return std::nullopt;
        }

        NexusModFilesResponse response;
        Statement files = database.prepare(
            "SELECT file_id, version, category_id, is_primary, availability, uploaded_timestamp "
            "FROM files WHERE game_domain = ? AND mod_id = ? ORDER BY file_id;");
        files.bindText(1, game);
        files.bindText(2, modId);
        while (files.stepRow())
        {
            const int primary = files.columnInt(3);
            response.files.push_back(NexusFileMetadata{
                files.columnText(0),
                files.columnText(1),
                files.columnText(2),
                primary < 0 ? std::optional<bool>{} : std::optional<bool>{primary != 0},
                static_cast<NexusFileAvailability>(files.columnInt(4)),
                files.columnInt64(5)
            });
        }

        Statement updates = database.prepare(
            "SELECT old_file_id, new_file_id, uploaded_timestamp FROM file_updates "
            "WHERE game_domain = ? AND mod_id = ? ORDER BY old_file_id, new_file_id;");
        updates.bindText(1, game);
        updates.bindText(2, modId);
        while (updates.stepRow())
        {
            response.fileUpdates.push_back(NexusFileUpdateLink{
                updates.columnText(0),
                updates.columnText(1),
                updates.columnInt64(2)
            });
        }
        response.quota = readQuota(database);

        Statement touch = database.prepare(
            "UPDATE mod_pages SET last_used_at = ? WHERE game_domain = ? AND mod_id = ?;");
        touch.bindText(1, usedAt);
        touch.bindText(2, game);
        touch.bindText(3, modId);
        touch.stepDone();
        return response;
#endif
    }

    void NexusUpdateCache::storeModFiles(
        std::wstring_view gameDomain,
        std::wstring_view modId,
        const NexusModFilesResponse& response,
        std::wstring_view fetchedAt) const
    {
#ifndef _WIN32
        (void)gameDomain; (void)modId; (void)response; (void)fetchedAt;
#else
        const std::lock_guard lock(cacheMutex());
        Database database = openCache(path_);
        Transaction transaction(database);
        const std::wstring game = lower(std::wstring(gameDomain));
        Statement page = database.prepare(
            "INSERT INTO mod_pages(game_domain, mod_id, fetched_at, last_used_at) VALUES(?, ?, ?, ?) "
            "ON CONFLICT(game_domain, mod_id) DO UPDATE SET fetched_at = excluded.fetched_at, "
            "last_used_at = excluded.last_used_at;");
        page.bindText(1, game);
        page.bindText(2, modId);
        page.bindText(3, fetchedAt);
        page.bindText(4, fetchedAt);
        page.stepDone();

        Statement deleteFiles = database.prepare("DELETE FROM files WHERE game_domain = ? AND mod_id = ?;");
        deleteFiles.bindText(1, game);
        deleteFiles.bindText(2, modId);
        deleteFiles.stepDone();
        Statement deleteUpdates = database.prepare("DELETE FROM file_updates WHERE game_domain = ? AND mod_id = ?;");
        deleteUpdates.bindText(1, game);
        deleteUpdates.bindText(2, modId);
        deleteUpdates.stepDone();

        for (const NexusFileMetadata& file : response.files)
        {
            Statement insert = database.prepare(
                "INSERT INTO files(game_domain, mod_id, file_id, version, category_id, is_primary, availability, "
                "uploaded_timestamp) VALUES(?, ?, ?, ?, ?, ?, ?, ?);");
            insert.bindText(1, game);
            insert.bindText(2, modId);
            insert.bindText(3, file.fileId);
            insert.bindText(4, file.version);
            insert.bindText(5, file.categoryId);
            insert.bindInt(6, file.isPrimary.has_value() ? (*file.isPrimary ? 1 : 0) : -1);
            insert.bindInt(7, static_cast<int>(file.availability));
            insert.bindInt64(8, file.uploadedTimestamp);
            insert.stepDone();
        }
        for (const NexusFileUpdateLink& update : response.fileUpdates)
        {
            Statement insert = database.prepare(
                "INSERT INTO file_updates(game_domain, mod_id, old_file_id, new_file_id, uploaded_timestamp) "
                "VALUES(?, ?, ?, ?, ?);");
            insert.bindText(1, game);
            insert.bindText(2, modId);
            insert.bindText(3, update.oldFileId);
            insert.bindText(4, update.newFileId);
            insert.bindInt64(5, update.uploadedTimestamp);
            insert.stepDone();
        }
        if (!response.quota.capturedAt.empty() || response.quota.hourlyRemaining >= 0 || response.quota.dailyRemaining >= 0)
        {
            writeQuota(database, response.quota);
        }
        transaction.commit();
#endif
    }

    std::optional<NexusRecentUpdatesResponse> NexusUpdateCache::loadRecentUpdates(
        std::wstring_view gameDomain,
        std::wstring_view period,
        std::wstring_view notOlderThan,
        std::wstring_view usedAt) const
    {
#ifndef _WIN32
        (void)gameDomain; (void)period; (void)notOlderThan; (void)usedAt;
        return std::nullopt;
#else
        const std::lock_guard lock(cacheMutex());
        Database database = openCache(path_);
        const std::wstring game = lower(std::wstring(gameDomain));
        Statement sweep = database.prepare(
            "SELECT fetched_at FROM recent_sweeps WHERE game_domain = ? AND period = ? AND fetched_at >= ? LIMIT 1;");
        sweep.bindText(1, game);
        sweep.bindText(2, period);
        sweep.bindText(3, notOlderThan);
        if (!sweep.stepRow())
        {
            return std::nullopt;
        }
        NexusRecentUpdatesResponse response;
        Statement mods = database.prepare(
            "SELECT mod_id, latest_file_update, latest_mod_activity FROM recent_mods "
            "WHERE game_domain = ? AND period = ? ORDER BY mod_id;");
        mods.bindText(1, game);
        mods.bindText(2, period);
        while (mods.stepRow())
        {
            response.updates.push_back(NexusRecentUpdate{
                mods.columnText(0),
                mods.columnInt64(1),
                mods.columnInt64(2)
            });
        }
        response.quota = readQuota(database);
        Statement touch = database.prepare(
            "UPDATE recent_sweeps SET last_used_at = ? WHERE game_domain = ? AND period = ?;");
        touch.bindText(1, usedAt);
        touch.bindText(2, game);
        touch.bindText(3, period);
        touch.stepDone();
        return response;
#endif
    }

    void NexusUpdateCache::storeRecentUpdates(
        std::wstring_view gameDomain,
        std::wstring_view period,
        const NexusRecentUpdatesResponse& response,
        std::wstring_view fetchedAt) const
    {
#ifndef _WIN32
        (void)gameDomain; (void)period; (void)response; (void)fetchedAt;
#else
        const std::lock_guard lock(cacheMutex());
        Database database = openCache(path_);
        Transaction transaction(database);
        const std::wstring game = lower(std::wstring(gameDomain));
        Statement sweep = database.prepare(
            "INSERT INTO recent_sweeps(game_domain, period, fetched_at, last_used_at) VALUES(?, ?, ?, ?) "
            "ON CONFLICT(game_domain, period) DO UPDATE SET fetched_at = excluded.fetched_at, "
            "last_used_at = excluded.last_used_at;");
        sweep.bindText(1, game);
        sweep.bindText(2, period);
        sweep.bindText(3, fetchedAt);
        sweep.bindText(4, fetchedAt);
        sweep.stepDone();
        Statement clear = database.prepare("DELETE FROM recent_mods WHERE game_domain = ? AND period = ?;");
        clear.bindText(1, game);
        clear.bindText(2, period);
        clear.stepDone();
        for (const NexusRecentUpdate& update : response.updates)
        {
            Statement insert = database.prepare(
                "INSERT INTO recent_mods(game_domain, period, mod_id, latest_file_update, latest_mod_activity) "
                "VALUES(?, ?, ?, ?, ?);");
            insert.bindText(1, game);
            insert.bindText(2, period);
            insert.bindText(3, update.modId);
            insert.bindInt64(4, update.latestFileUpdate);
            insert.bindInt64(5, update.latestModActivity);
            insert.stepDone();
        }
        if (!response.quota.capturedAt.empty() || response.quota.hourlyRemaining >= 0 || response.quota.dailyRemaining >= 0)
        {
            writeQuota(database, response.quota);
        }
        transaction.commit();
#endif
    }

    std::optional<NexusQuotaSnapshot> NexusUpdateCache::loadQuota() const
    {
#ifndef _WIN32
        return std::nullopt;
#else
        const std::lock_guard lock(cacheMutex());
        Database database = openCache(path_);
        const NexusQuotaSnapshot quota = readQuota(database);
        return quota.capturedAt.empty() && quota.hourlyRemaining < 0 && quota.dailyRemaining < 0
            ? std::nullopt
            : std::optional<NexusQuotaSnapshot>{quota};
#endif
    }

    void NexusUpdateCache::storeQuota(const NexusQuotaSnapshot& quota) const
    {
#ifdef _WIN32
        const std::lock_guard lock(cacheMutex());
        Database database = openCache(path_);
        writeQuota(database, quota);
#else
        (void)quota;
#endif
    }

    void NexusUpdateCache::pruneUnusedBefore(std::wstring_view cutoff) const
    {
#ifdef _WIN32
        const std::lock_guard lock(cacheMutex());
        Database database = openCache(path_);
        Transaction transaction(database);
        Statement pages = database.prepare("DELETE FROM mod_pages WHERE last_used_at < ?;");
        pages.bindText(1, cutoff);
        pages.stepDone();
        Statement recent = database.prepare("DELETE FROM recent_sweeps WHERE last_used_at < ?;");
        recent.bindText(1, cutoff);
        recent.stepDone();
        transaction.commit();
#else
        (void)cutoff;
#endif
    }
}
