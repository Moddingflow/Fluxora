#include "FluxoraCore/Services/FomodProfileContextService.hpp"

#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cwctype>
#include <deque>
#include <fstream>
#include <iomanip>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string_view>

#ifdef _WIN32
#include <Windows.h>
#include <winver.h>
#endif

namespace fluxora
{
    namespace
    {
        struct FileVersionCacheEntry
        {
            std::filesystem::file_time_type modifiedAt{};
            std::uintmax_t size{0};
            std::wstring version;
            bool known{false};
        };

        struct ProfileContextCacheEntry
        {
            std::wstring key;
            FomodProfileContext context;
            std::chrono::steady_clock::time_point createdAt;
        };

        constexpr std::size_t maxProfileFileStateCacheEntries = 128;
        constexpr auto profileFileStateCacheLifetime = std::chrono::minutes(30);

        std::mutex& versionCacheMutex()
        {
            static std::mutex mutex;
            return mutex;
        }

        std::map<std::wstring, FileVersionCacheEntry>& versionCache()
        {
            static std::map<std::wstring, FileVersionCacheEntry> cache;
            return cache;
        }

        std::mutex& profileFileStateCacheMutex()
        {
            static std::mutex mutex;
            return mutex;
        }

        std::deque<ProfileContextCacheEntry>& profileFileStateCache()
        {
            static std::deque<ProfileContextCacheEntry> cache;
            return cache;
        }

        [[nodiscard]] std::wstring trim(std::wstring_view value)
        {
            std::size_t first = 0;
            while (first < value.size() && std::iswspace(value[first]))
            {
                ++first;
            }
            std::size_t last = value.size();
            while (last > first && std::iswspace(value[last - 1]))
            {
                --last;
            }
            return std::wstring(value.substr(first, last - first));
        }

        [[nodiscard]] std::wstring lower(std::wstring_view value)
        {
            std::wstring result(value);
            std::transform(
                result.begin(),
                result.end(),
                result.begin(),
                [](wchar_t character)
                {
                    return static_cast<wchar_t>(std::towlower(character));
                });
            return result;
        }

        [[nodiscard]] std::wstring fromUtf8(const std::string& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            const int length = MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0);
            if (length <= 0)
            {
                throw std::invalid_argument("FOMOD profile file is not valid UTF-8.");
            }
            std::wstring output(static_cast<std::size_t>(length), L'\0');
            MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                output.data(),
                length);
            return output;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        [[nodiscard]] std::string readFileBytes(const std::filesystem::path& path)
        {
            std::ifstream input(path, std::ios::binary);
            if (!input)
            {
                return {};
            }
            return std::string(
                std::istreambuf_iterator<char>(input),
                std::istreambuf_iterator<char>());
        }

        [[nodiscard]] std::filesystem::path safeRelativePath(std::wstring_view value)
        {
            std::filesystem::path path(trim(value));
            if (path.empty() || path.is_absolute() || path.has_root_name() || path.has_root_directory())
            {
                throw std::invalid_argument("FOMOD dependency path must be relative.");
            }
            path = path.lexically_normal();
            for (const std::filesystem::path& part : path)
            {
                if (part == L"..")
                {
                    throw std::invalid_argument("FOMOD dependency path cannot traverse outside the game.");
                }
            }
            return path;
        }

        [[nodiscard]] bool startsWithPath(
            const std::filesystem::path& value,
            const std::filesystem::path& prefix)
        {
            auto valueIt = value.begin();
            auto prefixIt = prefix.begin();
            while (valueIt != value.end() && prefixIt != prefix.end())
            {
                if (lower(valueIt->wstring()) != lower(prefixIt->wstring()))
                {
                    return false;
                }
                ++valueIt;
                ++prefixIt;
            }
            return prefixIt == prefix.end();
        }

        [[nodiscard]] std::filesystem::path stripPrefix(
            const std::filesystem::path& value,
            const std::filesystem::path& prefix)
        {
            std::filesystem::path result;
            auto valueIt = value.begin();
            auto prefixIt = prefix.begin();
            while (valueIt != value.end() && prefixIt != prefix.end())
            {
                ++valueIt;
                ++prefixIt;
            }
            while (valueIt != value.end())
            {
                result /= *valueIt;
                ++valueIt;
            }
            return result.lexically_normal();
        }

        [[nodiscard]] std::vector<std::filesystem::path> dataFolders(
            const std::vector<std::wstring>& values)
        {
            std::vector<std::filesystem::path> output;
            for (const std::wstring& value : values)
            {
                if (!trim(value).empty())
                {
                    output.push_back(safeRelativePath(value));
                }
            }
            return output;
        }

        [[nodiscard]] std::vector<std::filesystem::path> gameCandidates(
            const std::filesystem::path& relative,
            const std::vector<std::filesystem::path>& folders)
        {
            std::vector<std::filesystem::path> output{relative};
            for (const std::filesystem::path& folder : folders)
            {
                if (!startsWithPath(relative, folder))
                {
                    output.push_back((folder / relative).lexically_normal());
                }
            }
            return output;
        }

        [[nodiscard]] std::vector<std::filesystem::path> modCandidates(
            const std::filesystem::path& relative,
            const std::vector<std::filesystem::path>& folders)
        {
            std::vector<std::filesystem::path> output{relative};
            for (const std::filesystem::path& folder : folders)
            {
                if (startsWithPath(relative, folder))
                {
                    const std::filesystem::path stripped = stripPrefix(relative, folder);
                    if (!stripped.empty() && stripped != L".")
                    {
                        output.push_back(stripped);
                    }
                }
            }
            return output;
        }

        [[nodiscard]] bool hasCandidate(
            const std::filesystem::path& root,
            const std::vector<std::filesystem::path>& candidates)
        {
            if (root.empty())
            {
                return false;
            }
            for (const std::filesystem::path& candidate : candidates)
            {
#ifdef _WIN32
                if (GetFileAttributesW((root / candidate).c_str()) != INVALID_FILE_ATTRIBUTES)
                {
                    return true;
                }
#else
                std::error_code error;
                if (std::filesystem::exists(root / candidate, error) && !error)
                {
                    return true;
                }
#endif
            }
            return false;
        }

        [[nodiscard]] std::wstring normalizedFileText(const std::filesystem::path& path)
        {
            std::wstring output = path.lexically_normal().wstring();
            std::replace(output.begin(), output.end(), L'/', L'\\');
            return output;
        }

        [[nodiscard]] std::set<std::wstring> activePlugins(
            const std::filesystem::path& profilesDirectory,
            std::wstring_view profileName,
            std::wstring_view activeFileName)
        {
            std::set<std::wstring> output;
            const std::filesystem::path file =
                profilesDirectory / std::filesystem::path(profileName) /
                std::filesystem::path(activeFileName.empty() ? L"plugins.txt" : activeFileName);
            const std::wstring text = fromUtf8(readFileBytes(file));
            std::wistringstream lines(text);
            std::wstring line;
            while (std::getline(lines, line))
            {
                line = trim(line);
                if (!line.empty() && line.front() == 0xfeff)
                {
                    line.erase(line.begin());
                }
                if (line.empty() || line.front() == L'#')
                {
                    continue;
                }
                if (line.front() == L'*')
                {
                    const std::wstring name = trim(std::wstring_view(line).substr(1));
                    if (!name.empty())
                    {
                        output.insert(lower(name));
                    }
                }
            }
            return output;
        }

        [[nodiscard]] bool isPluginPath(
            const std::filesystem::path& path,
            const std::set<std::wstring>& extensions)
        {
            return extensions.contains(lower(path.extension().wstring()));
        }

        [[nodiscard]] std::wstring peVersion(const std::filesystem::path& path)
        {
#ifdef _WIN32
            DWORD ignored = 0;
            const DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
            if (size == 0)
            {
                return {};
            }
            std::vector<unsigned char> buffer(size);
            if (!GetFileVersionInfoW(path.c_str(), 0, size, buffer.data()))
            {
                return {};
            }
            VS_FIXEDFILEINFO* info = nullptr;
            UINT infoSize = 0;
            if (!VerQueryValueW(buffer.data(), L"\\", reinterpret_cast<void**>(&info), &infoSize) ||
                info == nullptr || infoSize < sizeof(VS_FIXEDFILEINFO) || info->dwSignature != 0xFEEF04BD)
            {
                return {};
            }
            std::wostringstream value;
            value << HIWORD(info->dwFileVersionMS) << L'.'
                  << LOWORD(info->dwFileVersionMS) << L'.'
                  << HIWORD(info->dwFileVersionLS) << L'.'
                  << LOWORD(info->dwFileVersionLS);
            return value.str();
#else
            static_cast<void>(path);
            return {};
#endif
        }

        [[nodiscard]] FomodDetectedVersion cachedVersion(
            std::wstring kind,
            std::wstring displayName,
            const std::filesystem::path& path)
        {
            FomodDetectedVersion result{std::move(kind), std::move(displayName), {}, false};
            std::error_code error;
            if (!std::filesystem::exists(path, error) || error || !std::filesystem::is_regular_file(path, error))
            {
                return result;
            }
            const std::filesystem::file_time_type modifiedAt = std::filesystem::last_write_time(path, error);
            if (error)
            {
                return result;
            }
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            if (error)
            {
                return result;
            }
            const std::wstring key = lower(std::filesystem::absolute(path).lexically_normal().wstring());
            {
                const std::lock_guard lock(versionCacheMutex());
                const auto cached = versionCache().find(key);
                if (cached != versionCache().end() &&
                    cached->second.modifiedAt == modifiedAt && cached->second.size == size)
                {
                    result.version = cached->second.version;
                    result.known = cached->second.known;
                    return result;
                }
            }
            result.version = peVersion(path);
            result.known = !result.version.empty();
            {
                const std::lock_guard lock(versionCacheMutex());
                versionCache()[key] = FileVersionCacheEntry{modifiedAt, size, result.version, result.known};
            }
            return result;
        }

        void hashText(std::uint64_t& hash, std::wstring_view value)
        {
            constexpr std::uint64_t prime = 1099511628211ULL;
            for (wchar_t character : value)
            {
                hash ^= static_cast<std::uint64_t>(std::towlower(character));
                hash *= prime;
            }
            hash ^= 0xffULL;
            hash *= prime;
        }

        [[nodiscard]] std::wstring hashValue(std::uint64_t hash)
        {
            std::wostringstream output;
            output << std::hex << std::setw(16) << std::setfill(L'0') << hash;
            return output.str();
        }

        void hashPathStamp(std::uint64_t& hash, const std::filesystem::path& path)
        {
            hashText(hash, path.lexically_normal().wstring());
            std::error_code error;
            if (!std::filesystem::exists(path, error) || error)
            {
                hashText(hash, L"missing");
                return;
            }
            const auto modifiedAt = std::filesystem::last_write_time(path, error);
            if (!error)
            {
                hashText(hash, std::to_wstring(modifiedAt.time_since_epoch().count()));
            }
            error.clear();
            if (std::filesystem::is_regular_file(path, error) && !error)
            {
                const std::uintmax_t size = std::filesystem::file_size(path, error);
                if (!error)
                {
                    hashText(hash, std::to_wstring(size));
                }
            }
        }

        [[nodiscard]] bool modEnabled(const InstalledModRecord& mod)
        {
            return lower(trim(mod.state)) != L"disabled";
        }
    }

    FomodProfileContext FomodProfileContextService::build(
        const FomodProfileContextRequest& request)
    {
        if (request.projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required for FOMOD profile analysis.");
        }

        FomodProfileContext context;
        const std::wstring gameId = InstanceMetadataStore::gameId(request.projectDirectory);
        const GameSupportLookupResult lookup = GameSupportRegistry::embedded().lookupById(gameId);
        context.profileName = trim(request.profileName);
        if (context.profileName.empty())
        {
            context.profileName = lookup.supported && lookup.support != nullptr
                ? lookup.support->identity().defaultProfileName
                : L"Default";
        }
        context.autoSelectionAvailable = lookup.supported && lookup.support != nullptr;
        if (!context.autoSelectionAvailable)
        {
            context.unavailableReason = L"Автовыбор недоступен для этой игры";
        }

        std::set<std::wstring> pluginExtensions{L".esm", L".esp", L".esl"};
        std::set<std::wstring> basePlugins;
        std::wstring activePluginsFileName = L"plugins.txt";
        if (lookup.supported && lookup.support != nullptr)
        {
            const GameSupportComponents& components = lookup.support->components();
            if (components.pluginRulesProvider != nullptr)
            {
                const PluginSupportRules& rules = components.pluginRulesProvider->pluginRules();
                pluginExtensions.clear();
                for (const NormalizedExtension& extension : rules.pluginExtensions)
                {
                    pluginExtensions.insert(lower(extension.value()));
                }
                for (const std::wstring& plugin : rules.basePlugins)
                {
                    basePlugins.insert(lower(plugin));
                    context.basePluginNames.push_back(plugin);
                }
                if (!rules.activePluginsFileName.empty())
                {
                    activePluginsFileName = rules.activePluginsFileName;
                }
            }
        }
        std::uint64_t requestHash = 1469598103934665603ULL;
        hashText(requestHash, gameId);
        hashText(requestHash, context.profileName);
        hashText(requestHash, request.projectDirectory.lexically_normal().wstring());
        hashText(requestHash, request.gameDirectory.lexically_normal().wstring());
        hashText(requestHash, request.modsDirectory.lexically_normal().wstring());
        hashText(requestHash, request.profilesDirectory.lexically_normal().wstring());
        for (const std::wstring& folder : request.gameDataFolders)
        {
            hashText(requestHash, folder);
        }
        for (const std::wstring& file : request.referencedFiles)
        {
            hashText(requestHash, normalizedFileText(safeRelativePath(file)));
        }
        hashPathStamp(requestHash, request.projectDirectory / L"instance.db");
        hashPathStamp(requestHash, request.projectDirectory / L"instance.db-wal");
        hashPathStamp(
            requestHash,
            request.profilesDirectory / context.profileName / activePluginsFileName);
        if (lookup.supported && lookup.support != nullptr)
        {
            const GameSupportComponents& components = lookup.support->components();
            if (components.executableRulesProvider != nullptr)
            {
                const ExecutableSupportRules& rules = components.executableRulesProvider->executableRules();
                if (rules.roles.primary.has_value())
                {
                    hashPathStamp(requestHash, request.gameDirectory / rules.roles.primary->displayName());
                }
                if (rules.roles.scriptExtender.has_value())
                {
                    hashPathStamp(requestHash, request.gameDirectory / rules.roles.scriptExtender->displayName());
                }
            }
        }
        const std::wstring requestCacheKey = hashValue(requestHash);
        const auto cacheNow = std::chrono::steady_clock::now();
        const std::unique_lock profileCacheLock(profileFileStateCacheMutex());
        auto& contextCache = profileFileStateCache();
        contextCache.erase(
            std::remove_if(
                contextCache.begin(),
                contextCache.end(),
                [cacheNow](const ProfileContextCacheEntry& entry)
                {
                    return cacheNow - entry.createdAt > profileFileStateCacheLifetime;
                }),
            contextCache.end());
        const auto cachedContext = std::find_if(
            contextCache.begin(),
            contextCache.end(),
            [&requestCacheKey](const ProfileContextCacheEntry& entry)
            {
                return entry.key == requestCacheKey;
            });
        if (cachedContext != contextCache.end())
        {
            cachedContext->createdAt = cacheNow;
            return cachedContext->context;
        }
        const std::set<std::wstring> active = activePlugins(
            request.profilesDirectory,
            context.profileName,
            activePluginsFileName);

        std::vector<ProfileOrderItemRecord> order = InstanceMetadataStore::listCachedProfileOrderItems(
            request.projectDirectory,
            context.profileName,
            request.modsDirectory);
        std::stable_sort(
            order.begin(),
            order.end(),
            [](const ProfileOrderItemRecord& left, const ProfileOrderItemRecord& right)
            {
                return left.position < right.position;
            });
        context.modCatalogRevision = InstanceMetadataStore::modCatalogRevision(request.projectDirectory);

        std::uint64_t modHash = 1469598103934665603ULL;
        hashText(modHash, gameId);
        hashText(modHash, context.profileName);
        hashText(modHash, std::to_wstring(context.modCatalogRevision));
        for (const ProfileOrderItemRecord& item : order)
        {
            hashText(modHash, item.id);
            hashText(modHash, std::to_wstring(item.position));
            if (item.hasMod)
            {
                hashText(modHash, item.mod.uuid);
                hashText(modHash, item.mod.state);
                hashText(modHash, item.mod.contentFingerprint);
            }
        }
        context.modRevision = hashValue(modHash);

        std::uint64_t pluginHash = 1469598103934665603ULL;
        hashText(pluginHash, gameId);
        hashText(pluginHash, context.profileName);
        for (const std::wstring& plugin : active)
        {
            hashText(pluginHash, plugin);
        }
        context.pluginRevision = hashValue(pluginHash);

        const std::vector<std::filesystem::path> folders = dataFolders(request.gameDataFolders);
        std::set<std::wstring> seen;
        std::vector<std::pair<std::filesystem::path, std::wstring>> requestedFiles;
        requestedFiles.reserve(request.referencedFiles.size());
        for (const std::wstring& requestedFile : request.referencedFiles)
        {
            const std::filesystem::path relative = safeRelativePath(requestedFile);
            const std::wstring normalized = normalizedFileText(relative);
            if (!seen.insert(lower(normalized)).second)
            {
                continue;
            }
            requestedFiles.emplace_back(relative, normalized);
        }

        if (!requestedFiles.empty())
        {
            context.fileStates.reserve(requestedFiles.size());
            for (const auto& [relative, normalized] : requestedFiles)
            {
                const std::vector<std::filesystem::path> gamePaths = gameCandidates(relative, folders);
                const std::vector<std::filesystem::path> modPaths = modCandidates(relative, folders);

                FomodProfileFileState state;
                state.file = normalized;
                if (hasCandidate(request.gameDirectory, gamePaths))
                {
                    state.state = FomodProfileFileStateKind::Active;
                    state.sourceKind = L"game";
                    state.sourceName = L"Game";
                    state.exists = true;
                }

                std::optional<std::wstring> disabledOwner;
                for (auto item = order.rbegin(); item != order.rend(); ++item)
                {
                    if (!item->hasMod || item->mod.path.empty() || !hasCandidate(item->mod.path, modPaths))
                    {
                        continue;
                    }
                    const std::wstring owner = item->mod.displayName.empty()
                        ? item->mod.folderName
                        : item->mod.displayName;
                    if (modEnabled(item->mod))
                    {
                        state.state = FomodProfileFileStateKind::Active;
                        state.sourceKind = L"mod";
                        state.sourceName = owner;
                        state.exists = true;
                        break;
                    }
                    if (!disabledOwner.has_value())
                    {
                        disabledOwner = owner;
                    }
                }
                if (!state.exists && disabledOwner.has_value())
                {
                    state.state = FomodProfileFileStateKind::Inactive;
                    state.sourceKind = L"mod";
                    state.sourceName = *disabledOwner;
                    state.exists = true;
                }

                if (state.exists && isPluginPath(relative, pluginExtensions))
                {
                    const std::wstring pluginName = lower(relative.filename().wstring());
                    if (!active.contains(pluginName) && !basePlugins.contains(pluginName))
                    {
                        state.state = FomodProfileFileStateKind::Inactive;
                    }
                }
                context.fileStates.push_back(std::move(state));
            }
        }

        if (lookup.supported && lookup.support != nullptr)
        {
            const GameSupportComponents& components = lookup.support->components();
            if (components.executableRulesProvider != nullptr)
            {
                const ExecutableSupportRules& rules = components.executableRulesProvider->executableRules();
                if (rules.roles.primary.has_value())
                {
                    context.gameVersion = cachedVersion(
                        L"game",
                        lookup.support->identity().displayName,
                        request.gameDirectory / rules.roles.primary->displayName());
                }
                if (rules.roles.scriptExtender.has_value())
                {
                    std::wstring kind = lower(gameId) == L"skyrimse" ? L"skse" : L"scriptExtender";
                    context.extenderVersions.push_back(cachedVersion(
                        std::move(kind),
                        L"Script Extender",
                        request.gameDirectory / rules.roles.scriptExtender->displayName()));
                }
            }
        }

        std::uint64_t hash = modHash;
        hashText(hash, context.pluginRevision);
        for (const std::wstring& plugin : context.basePluginNames)
        {
            hashText(hash, plugin);
        }
        for (const FomodProfileFileState& state : context.fileStates)
        {
            hashText(hash, state.file);
            hashText(hash, stateName(state.state));
            hashText(hash, state.sourceKind);
            hashText(hash, state.sourceName);
        }
        hashText(hash, context.gameVersion.version);
        for (const FomodDetectedVersion& version : context.extenderVersions)
        {
            hashText(hash, version.kind);
            hashText(hash, version.version);
        }
        context.fingerprint = hashValue(hash);
        context.contextId = L"fomod-" + context.fingerprint;
        while (contextCache.size() >= maxProfileFileStateCacheEntries)
        {
            contextCache.pop_front();
        }
        contextCache.push_back(ProfileContextCacheEntry{requestCacheKey, context, cacheNow});
        return context;
    }

    std::wstring FomodProfileContextService::stateName(FomodProfileFileStateKind state)
    {
        switch (state)
        {
        case FomodProfileFileStateKind::Active:
            return L"Active";
        case FomodProfileFileStateKind::Inactive:
            return L"Inactive";
        case FomodProfileFileStateKind::Missing:
        default:
            return L"Missing";
        }
    }
}
