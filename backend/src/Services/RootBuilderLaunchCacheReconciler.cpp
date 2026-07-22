#include "FluxoraCore/Services/RootBuilderLaunchCacheReconciler.hpp"

#include "FluxoraCore/Services/Logger.hpp"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <fstream>
#include <map>
#include <optional>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        std::wstring lower(std::wstring value)
        {
            std::transform(
                value.begin(),
                value.end(),
                value.begin(),
                [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
            return value;
        }

        std::wstring relativeKey(const std::filesystem::path& path)
        {
            return lower(path.lexically_normal().generic_wstring());
        }

        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            const int size = WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            std::string output(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), output.data(), size, nullptr, nullptr);
            return output;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        bool usableRelativePath(const std::filesystem::path& path)
        {
            if (path.empty() || path.is_absolute() || path.has_root_name() || path.has_root_directory())
            {
                return false;
            }
            for (const std::filesystem::path& component : path.lexically_normal())
            {
                if (component == L"..")
                {
                    return false;
                }
            }
            return true;
        }

        std::int64_t modifiedTicks(const std::filesystem::path& path, std::error_code& error)
        {
            const auto value = std::filesystem::last_write_time(path, error);
            return error ? 0 : static_cast<std::int64_t>(value.time_since_epoch().count());
        }

        bool isReparsePoint(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const DWORD attributes = GetFileAttributesW(path.c_str());
            return attributes != INVALID_FILE_ATTRIBUTES &&
                (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
#else
            std::error_code error;
            return std::filesystem::is_symlink(std::filesystem::symlink_status(path, error));
#endif
        }

        bool startsWithPath(
            const std::filesystem::path& path,
            const std::filesystem::path& prefix,
            std::filesystem::path& remainder)
        {
            if (prefix.empty())
            {
                remainder = path;
                return true;
            }

            auto pathIt = path.begin();
            for (auto prefixIt = prefix.begin(); prefixIt != prefix.end(); ++prefixIt, ++pathIt)
            {
                if (pathIt == path.end() || lower(pathIt->wstring()) != lower(prefixIt->wstring()))
                {
                    return false;
                }
            }

            remainder.clear();
            for (; pathIt != path.end(); ++pathIt)
            {
                remainder /= *pathIt;
            }
            return true;
        }

        struct ResolvedDestination
        {
            std::filesystem::path overwritePath;
            std::filesystem::path whiteoutPath;
        };

        class ReconcileSummary final
        {
        public:
            ReconcileSummary(
                const RootBuilderLaunchCacheReconcileRequest& request,
                const RootBuilderLaunchCacheReconcileResult& result) noexcept
                : request_(request), result_(result), startedAt_(std::chrono::steady_clock::now())
            {
            }

            ~ReconcileSummary()
            {
                try
                {
                    if (request_.mounts.empty() || request_.mounts.front().whiteoutRoot.empty())
                    {
                        return;
                    }
                    const std::filesystem::path vfsDirectory =
                        request_.mounts.front().whiteoutRoot.parent_path().parent_path();
                    std::error_code error;
                    std::filesystem::create_directories(vfsDirectory, error);
                    if (error)
                    {
                        return;
                    }
                    std::ofstream stream(
                        vfsDirectory / L"vfs.log",
                        std::ios::binary | std::ios::app);
                    if (!stream)
                    {
                        return;
                    }
                    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - startedAt_).count();
                    const std::string operationId = Logger::operationId();
                    stream << "VFS prelaunch recovery operationId="
                        << (operationId.empty() ? "<none>" : operationId)
                        << " recoveryMs=" << elapsedMs
                        << " recoveredFiles=" << result_.recoveredFiles
                        << " whiteouts=" << result_.whiteouts
                        << " errors=" << result_.errors
                        << " success=" << (result_.success ? 1 : 0)
                        << '\n';
                }
                catch (...)
                {
                    // Diagnostics must never change fail-closed recovery behavior.
                }
            }

        private:
            const RootBuilderLaunchCacheReconcileRequest& request_;
            const RootBuilderLaunchCacheReconcileResult& result_;
            std::chrono::steady_clock::time_point startedAt_;
        };

        std::optional<ResolvedDestination> resolveDestination(
            const std::filesystem::path& relativePath,
            const std::vector<RootBuilderLaunchCacheReconcileMount>& mounts)
        {
            const RootBuilderLaunchCacheReconcileMount* best = nullptr;
            std::filesystem::path bestRemainder;
            std::size_t bestDepth = 0;
            for (const RootBuilderLaunchCacheReconcileMount& mount : mounts)
            {
                std::filesystem::path remainder;
                if (!startsWithPath(relativePath, mount.cachePrefix, remainder))
                {
                    continue;
                }
                const std::size_t depth = static_cast<std::size_t>(
                    std::distance(mount.cachePrefix.begin(), mount.cachePrefix.end()));
                if (best == nullptr || depth > bestDepth)
                {
                    best = &mount;
                    bestDepth = depth;
                    bestRemainder = std::move(remainder);
                }
            }
            if (best == nullptr || !usableRelativePath(bestRemainder))
            {
                return std::nullopt;
            }
            return ResolvedDestination{
                best->overwriteRoot / bestRemainder,
                best->whiteoutRoot / bestRemainder
            };
        }

        bool atomicCopyFile(
            const std::filesystem::path& source,
            const std::filesystem::path& destination,
            std::string& failure)
        {
            std::error_code error;
            std::filesystem::create_directories(destination.parent_path(), error);
            if (error)
            {
                failure = "could not create recovery directory for " + toUtf8(destination.wstring()) +
                    " (" + error.message() + ")";
                return false;
            }

            const std::filesystem::path temporary = destination.parent_path() /
                (destination.filename().wstring() + L".fluxora-recover-" +
                    std::to_wstring(std::chrono::steady_clock::now().time_since_epoch().count()) + L".tmp");
            std::filesystem::copy_file(source, temporary, std::filesystem::copy_options::overwrite_existing, error);
            if (error)
            {
                failure = "could not stage runtime file " + toUtf8(source.wstring()) +
                    " (" + error.message() + ")";
                return false;
            }

#ifdef _WIN32
            if (MoveFileExW(
                    temporary.c_str(),
                    destination.c_str(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) == 0)
            {
                const DWORD code = GetLastError();
                std::filesystem::remove(temporary, error);
                failure = "could not atomically publish runtime file " + toUtf8(destination.wstring()) +
                    " (win32=" + std::to_string(code) + ")";
                return false;
            }
#else
            std::filesystem::rename(temporary, destination, error);
            if (error)
            {
                std::filesystem::remove(temporary, error);
                failure = "could not atomically publish runtime file " + toUtf8(destination.wstring());
                return false;
            }
#endif
            return true;
        }

        bool writeWhiteout(const std::filesystem::path& path, std::string& failure)
        {
            std::error_code error;
            std::filesystem::create_directories(path.parent_path(), error);
            if (error)
            {
                failure = "could not create whiteout directory for " + toUtf8(path.wstring()) +
                    " (" + error.message() + ")";
                return false;
            }
            std::ofstream marker(path, std::ios::binary | std::ios::trunc);
            if (!marker)
            {
                failure = "could not create whiteout " + toUtf8(path.wstring());
                return false;
            }
            marker.flush();
            if (!marker)
            {
                failure = "could not flush whiteout " + toUtf8(path.wstring());
                return false;
            }
            return true;
        }
    }

    RootBuilderLaunchCacheReconciler::RootBuilderLaunchCacheReconciler(Logger& logger) noexcept
        : logger_(logger)
    {
    }

    RootBuilderLaunchCacheReconcileResult RootBuilderLaunchCacheReconciler::reconcile(
        const RootBuilderLaunchCacheReconcileRequest& request) const
    {
        RootBuilderLaunchCacheReconcileResult result;
        const ReconcileSummary summary(request, result);
        std::map<std::wstring, RootBuilderLaunchCacheBaselineFile> baseline;
        for (const RootBuilderLaunchCacheBaselineFile& file : request.baselineFiles)
        {
            if (!usableRelativePath(file.relativePath))
            {
                result.success = false;
                result.errors = 1;
                result.failure = "baseline contains an unsafe relative path";
                return result;
            }
            baseline[relativeKey(file.relativePath)] = file;
        }

        std::map<std::wstring, std::filesystem::path> currentFiles;
        std::error_code error;
        std::filesystem::recursive_directory_iterator iterator(
            request.cacheRoot,
            std::filesystem::directory_options::skip_permission_denied,
            error);
        const std::filesystem::recursive_directory_iterator end;
        while (!error && iterator != end)
        {
            const std::filesystem::path current = iterator->path();
            if (isReparsePoint(current))
            {
                if (iterator->is_directory(error))
                {
                    iterator.disable_recursion_pending();
                }
                error.clear();
                iterator.increment(error);
                continue;
            }
            if (iterator->is_regular_file(error) && !error && current != request.manifestPath)
            {
                const std::filesystem::path relative = current.lexically_relative(request.cacheRoot);
                if (!usableRelativePath(relative))
                {
                    result.success = false;
                    result.errors = 1;
                    result.failure = "cache contains an unsafe path";
                    return result;
                }
                currentFiles[relativeKey(relative)] = relative;
            }
            error.clear();
            iterator.increment(error);
        }
        if (error)
        {
            result.success = false;
            result.errors = 1;
            result.failure = "could not enumerate launch cache (" + error.message() + ")";
            return result;
        }

        for (const auto& [key, relative] : currentFiles)
        {
            const std::filesystem::path source = request.cacheRoot / relative;
            bool recover = false;
            const auto previous = baseline.find(key);
            if (previous == baseline.end())
            {
                recover = true;
            }
            else
            {
                error.clear();
                const std::uintmax_t size = std::filesystem::file_size(source, error);
                if (error)
                {
                    result.success = false;
                    result.errors = 1;
                    result.failure = "could not inspect cached runtime file " + toUtf8(source.wstring());
                    return result;
                }
                error.clear();
                const std::int64_t ticks = modifiedTicks(source, error);
                if (error)
                {
                    result.success = false;
                    result.errors = 1;
                    result.failure = "could not inspect cached runtime timestamp " + toUtf8(source.wstring());
                    return result;
                }
                recover = size != previous->second.size || ticks != previous->second.modifiedTicks;
            }

            if (!recover)
            {
                continue;
            }
            const std::optional<ResolvedDestination> destination = resolveDestination(relative, request.mounts);
            if (!destination.has_value())
            {
                result.success = false;
                result.errors = 1;
                result.failure = "runtime file did not match a declared content root: " + toUtf8(relative.wstring());
                return result;
            }
            if (!atomicCopyFile(source, destination->overwritePath, result.failure))
            {
                result.success = false;
                ++result.errors;
                return result;
            }
            std::filesystem::remove(destination->whiteoutPath, error);
            error.clear();
            ++result.recoveredFiles;
            result.cacheChanged = true;
        }

        for (const auto& [key, previous] : baseline)
        {
            if (currentFiles.contains(key))
            {
                continue;
            }
            const std::optional<ResolvedDestination> destination =
                resolveDestination(previous.relativePath, request.mounts);
            if (!destination.has_value())
            {
                result.success = false;
                result.errors = 1;
                result.failure = "deleted runtime file did not match a declared content root: " +
                    toUtf8(previous.relativePath.wstring());
                return result;
            }
            if (!writeWhiteout(destination->whiteoutPath, result.failure))
            {
                result.success = false;
                ++result.errors;
                return result;
            }
            ++result.whiteouts;
            result.cacheChanged = true;
        }

        if (result.cacheChanged)
        {
            logger_.write(
                LogLevel::Info,
                "Root Builder launch cache reconciled: recoveredFiles=" +
                    std::to_string(result.recoveredFiles) +
                    ", whiteouts=" + std::to_string(result.whiteouts) + ".");
        }
        return result;
    }
}
