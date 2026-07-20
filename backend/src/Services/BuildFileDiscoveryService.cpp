#include "FluxoraCore/Services/BuildFileDiscoveryService.hpp"

#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <algorithm>
#include <cctype>
#include <cwctype>
#include <fstream>
#include <limits>
#include <map>
#include <set>
#include <sstream>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumDiscoveryEntries = 100'000;
        constexpr std::size_t maximumSemanticPreviewBytes = 64 * 1024;

        std::wstring lower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::wstring compact(std::wstring_view value)
        {
            std::wstring result;
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                if (std::iswalnum(character))
                {
                    result.push_back(static_cast<wchar_t>(std::towlower(character)));
                }
            }
            return result;
        }

        std::vector<std::wstring> words(std::wstring_view value)
        {
            std::vector<std::wstring> result;
            std::wstring current;
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                const wchar_t character = value[index];
                const bool boundary = !std::iswalnum(character) ||
                    (!current.empty() && std::iswupper(character) &&
                        index > 0 && std::iswlower(value[index - 1]));
                if (boundary)
                {
                    if (!current.empty())
                    {
                        result.push_back(lower(std::move(current)));
                        current.clear();
                    }
                    if (!std::iswalnum(character))
                    {
                        continue;
                    }
                }
                current.push_back(character);
            }
            if (!current.empty())
            {
                result.push_back(lower(std::move(current)));
            }
            return result;
        }

        std::wstring abbreviation(const std::vector<std::wstring>& tokens)
        {
            std::wstring result;
            for (const auto& token : tokens)
            {
                if (!token.empty())
                {
                    result.push_back(token.front());
                }
            }
            return result;
        }

        bool isAllowedTextExtension(std::wstring extension)
        {
            static const std::set<std::wstring> extensions{
                L".txt", L".md", L".json", L".jsonc", L".ini", L".cfg",
                L".conf", L".xml", L".yaml", L".yml", L".toml", L".csv", L".log"
            };
            return extensions.contains(lower(std::move(extension)));
        }

        bool isArchiveExtension(std::wstring extension)
        {
            static const std::set<std::wstring> extensions{L".zip", L".7z", L".rar"};
            return extensions.contains(lower(std::move(extension)));
        }

        bool isAllowedFile(const std::filesystem::path& path)
        {
            const std::wstring extension = path.extension().wstring();
            return isAllowedTextExtension(extension) || isArchiveExtension(extension);
        }

        bool isProtectedRelativePath(const std::filesystem::path& relativePath)
        {
            const std::wstring normalized = lower(relativePath.generic_wstring());
            const std::wstring fileName = lower(relativePath.filename().wstring());
            if (normalized == L".fluxora" || normalized.starts_with(L".fluxora/"))
            {
                return true;
            }
            return fileName.ends_with(L".fluxora.json") ||
                fileName.ends_with(L".sqlite") ||
                fileName.ends_with(L".sqlite3") ||
                fileName.ends_with(L".db") ||
                fileName.ends_with(L".tmp") ||
                fileName.ends_with(L".checkpoint") ||
                fileName.ends_with(L".progress.json") ||
                fileName == L"modlist.txt" ||
                fileName == L"plugins.txt" ||
                fileName == L"loadorder.txt" ||
                fileName == L"lockedorder.txt" ||
                fileName == L"archives.txt";
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

        std::wstring ownerFor(
            BuildFileScope scope,
            const std::filesystem::path& relativePath,
            std::wstring_view fixedOwnerMod)
        {
            if (!fixedOwnerMod.empty())
            {
                return std::wstring(fixedOwnerMod);
            }
            if (scope != BuildFileScope::Build || relativePath.empty())
            {
                return {};
            }
            return relativePath.begin()->wstring();
        }

        std::filesystem::path virtualPathFor(
            BuildFileScope scope,
            const std::filesystem::path& relativePath,
            bool contentsAreVirtualRoot)
        {
            if (scope != BuildFileScope::Build || contentsAreVirtualRoot)
            {
                return relativePath;
            }
            std::filesystem::path result;
            auto part = relativePath.begin();
            if (part != relativePath.end())
            {
                ++part;
            }
            for (; part != relativePath.end(); ++part)
            {
                result /= *part;
            }
            return result;
        }

        std::wstring pathKey(const std::filesystem::path& path)
        {
            return lower(path.lexically_normal().generic_wstring());
        }

        void combineRevision(std::size_t& seed, std::size_t value)
        {
            seed ^= value + 0x9e3779b9 + (seed << 6) + (seed >> 2);
        }

        void addReason(std::vector<std::wstring>& reasons, std::wstring reason)
        {
            if (std::find(reasons.begin(), reasons.end(), reason) == reasons.end())
            {
                reasons.push_back(std::move(reason));
            }
        }

        std::wstring boundedTextPreview(const std::filesystem::path& path)
        {
            std::ifstream stream(path, std::ios::binary);
            if (!stream)
            {
                return {};
            }
            std::string bytes(maximumSemanticPreviewBytes, '\0');
            stream.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
            bytes.resize(static_cast<std::size_t>(stream.gcount()));
            if (bytes.find('\0') != std::string::npos)
            {
                return {};
            }
            std::wstring result;
            result.reserve(bytes.size());
            for (const unsigned char byte : bytes)
            {
                result.push_back(static_cast<wchar_t>(std::tolower(byte)));
            }
            return result;
        }

        bool matchesSemanticKey(std::wstring_view preview, std::wstring_view semanticKey)
        {
            std::wstring part;
            for (std::size_t index = 0; index <= semanticKey.size(); ++index)
            {
                if (index != semanticKey.size() && semanticKey[index] != L'.' && semanticKey[index] != L'/')
                {
                    part.push_back(semanticKey[index]);
                    continue;
                }
                const std::wstring normalized = lower(part);
                if (!normalized.empty() && preview.find(normalized) == std::wstring_view::npos)
                {
                    return false;
                }
                part.clear();
            }
            return true;
        }

        std::map<std::wstring, int> profilePriorities(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modsRoot)
        {
            std::map<std::wstring, int> result;
            try
            {
                const auto items = InstanceMetadataStore::listCachedProfileOrderItems(
                    projectDirectory,
                    profileName.empty() ? L"Default" : profileName,
                    modsRoot);
                for (const auto& item : items)
                {
                    if (item.kind == L"mod" && item.hasMod && item.mod.state != L"disabled")
                    {
                        result[lower(item.mod.folderName)] = item.position;
                        result[lower(item.mod.displayName)] = item.position;
                    }
                }
            }
            catch (...)
            {
            }
            return result;
        }

        int priorityFor(const std::map<std::wstring, int>& priorities, std::wstring_view owner)
        {
            const auto match = priorities.find(lower(std::wstring(owner)));
            return match == priorities.end() ? -1 : match->second;
        }
    }

    BuildFileDiscoveryScan BuildFileDiscoveryService::discover(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::vector<BuildFileDiscoveryRoot>& roots,
        const BuildFileDiscoveryRequest& request) const
    {
        BuildFileDiscoveryScan scan;
        std::set<BuildFileScope> requestedScopes(request.scopes.begin(), request.scopes.end());
        if (requestedScopes.empty())
        {
            requestedScopes.insert(BuildFileScope::Build);
        }
        std::set<std::wstring> extensions;
        for (std::wstring extension : request.extensions)
        {
            extension = lower(std::move(extension));
            if (!extension.empty() && extension.front() != L'.')
            {
                extension.insert(extension.begin(), L'.');
            }
            extensions.insert(std::move(extension));
        }
        std::vector<std::wstring> aliases;
        for (const auto& alias : request.aliases)
        {
            if (!compact(alias).empty())
            {
                aliases.push_back(alias);
            }
        }

        struct IndexedFile
        {
            BuildFileScope scope{BuildFileScope::Build};
            std::filesystem::path root;
            std::filesystem::path path;
            std::filesystem::path relativePath;
            std::filesystem::path virtualPath;
            std::wstring owner;
            int priority{-1};
            double score{0.0};
            std::vector<std::wstring> reasons;
        };
        std::vector<IndexedFile> indexed;
        std::map<std::wstring, std::vector<std::size_t>> buildFilesByVirtualPath;
        std::size_t revisionSeed = 0;

        for (const auto& root : roots)
        {
            if (!requestedScopes.contains(root.scope))
            {
                continue;
            }
            std::error_code rootError;
            if (!std::filesystem::is_directory(root.path, rootError) || rootError || isReparsePoint(root.path))
            {
                ++scan.statistics.unavailableRoots;
                continue;
            }
            const auto priorities = root.scope == BuildFileScope::Build && root.fixedOwnerMod.empty()
                ? profilePriorities(projectDirectory, profileName, root.path)
                : std::map<std::wstring, int>{};
            std::filesystem::recursive_directory_iterator iterator(
                root.path,
                std::filesystem::directory_options::skip_permission_denied,
                rootError);
            const std::filesystem::recursive_directory_iterator end;
            for (; iterator != end && scan.statistics.scannedEntries < maximumDiscoveryEntries;
                 iterator.increment(rootError))
            {
                if (request.cancellationRequested && request.cancellationRequested())
                {
                    scan.cancelled = true;
                    break;
                }
                if (rootError)
                {
                    ++scan.statistics.skippedEntries;
                    rootError.clear();
                    continue;
                }
                ++scan.statistics.scannedEntries;
                const auto path = iterator->path();
                if (isReparsePoint(path))
                {
                    if (iterator->is_directory(rootError))
                    {
                        iterator.disable_recursion_pending();
                    }
                    ++scan.statistics.skippedEntries;
                    continue;
                }
                if (!iterator->is_regular_file(rootError) || rootError || !isAllowedFile(path))
                {
                    ++scan.statistics.skippedEntries;
                    rootError.clear();
                    continue;
                }
                const auto relative = path.lexically_relative(root.path);
                if (isProtectedRelativePath(relative))
                {
                    ++scan.statistics.skippedEntries;
                    continue;
                }
                IndexedFile file;
                file.scope = root.scope;
                file.root = root.path;
                file.path = path;
                file.relativePath = relative;
                file.virtualPath = virtualPathFor(root.scope, relative, root.contentsAreVirtualRoot);
                file.owner = ownerFor(root.scope, relative, root.fixedOwnerMod);
                file.priority = root.alwaysWins
                    ? (std::numeric_limits<int>::max)()
                    : priorityFor(priorities, file.owner);

                const std::wstring relativeCompact = compact(relative.generic_wstring());
                const auto relativeWords = words(relative.generic_wstring());
                const std::wstring relativeAbbreviation = abbreviation(relativeWords);
                for (const auto& alias : aliases)
                {
                    const std::wstring aliasCompact = compact(alias);
                    const auto aliasWords = words(alias);
                    const std::wstring aliasAbbreviation = abbreviation(aliasWords);
                    const bool exactText = relativeCompact.find(aliasCompact) != std::wstring::npos;
                    const bool abbreviationMatch = aliasCompact.size() >= 2 &&
                        (relativeAbbreviation.find(aliasCompact) != std::wstring::npos ||
                            (!aliasAbbreviation.empty() && relativeAbbreviation.find(aliasAbbreviation) != std::wstring::npos));
                    if (exactText || abbreviationMatch)
                    {
                        file.score = (std::max)(file.score, exactText ? 0.65 : 0.45);
                        addReason(file.reasons, exactText ? L"alias" : L"abbreviation");
                    }
                }
                for (const auto& hint : request.configHints)
                {
                    if (lower(path.filename().wstring()) == lower(hint))
                    {
                        file.score += 0.2;
                        addReason(file.reasons, L"config-hint");
                    }
                }
                if (!extensions.empty() && extensions.contains(lower(path.extension().wstring())))
                {
                    file.score += 0.05;
                    addReason(file.reasons, L"extension");
                }
                else if (!extensions.empty())
                {
                    file.score = 0.0;
                    file.reasons.clear();
                }
                if (file.score > 0.0 && !request.semanticKeys.empty() && isAllowedTextExtension(path.extension().wstring()))
                {
                    const std::wstring preview = boundedTextPreview(path);
                    if (std::all_of(request.semanticKeys.begin(), request.semanticKeys.end(), [&](const auto& key)
                    {
                        return matchesSemanticKey(preview, key);
                    }))
                    {
                        file.score += 0.1;
                        addReason(file.reasons, L"semantic-key");
                    }
                }

                combineRevision(revisionSeed, std::hash<std::wstring>{}(pathKey(path)));
                std::error_code metadataError;
                combineRevision(
                    revisionSeed,
                    static_cast<std::size_t>(std::filesystem::file_size(path, metadataError)));
                metadataError.clear();
                const auto modified = std::filesystem::last_write_time(path, metadataError);
                if (!metadataError)
                {
                    combineRevision(
                        revisionSeed,
                        std::hash<decltype(modified.time_since_epoch().count())>{}(
                            modified.time_since_epoch().count()));
                }
                const std::size_t index = indexed.size();
                indexed.push_back(std::move(file));
                if (root.scope == BuildFileScope::Build)
                {
                    buildFilesByVirtualPath[pathKey(indexed.back().virtualPath)].push_back(index);
                }
            }
            if (scan.cancelled)
            {
                break;
            }
        }

        std::map<std::wstring, std::size_t> effectiveByVirtualPath;
        for (const auto& [virtualKey, indexes] : buildFilesByVirtualPath)
        {
            if (indexes.empty())
            {
                continue;
            }
            const auto winner = std::max_element(indexes.begin(), indexes.end(), [&](std::size_t left, std::size_t right)
            {
                if (indexed[left].priority != indexed[right].priority)
                {
                    return indexed[left].priority < indexed[right].priority;
                }
                return pathKey(indexed[left].path) < pathKey(indexed[right].path);
            });
            effectiveByVirtualPath[virtualKey] = *winner;
        }

        for (std::size_t index = 0; index < indexed.size(); ++index)
        {
            IndexedFile& file = indexed[index];
            if (file.score <= 0.0)
            {
                continue;
            }
            BuildFileDiscoveryHit hit;
            hit.scope = file.scope;
            hit.root = file.root;
            hit.path = file.path;
            hit.ownerMod = file.owner;
            hit.virtualPath = file.virtualPath.generic_wstring();
            if (file.scope == BuildFileScope::Build)
            {
                const auto& conflicts = buildFilesByVirtualPath.at(pathKey(file.virtualPath));
                const std::size_t winner = effectiveByVirtualPath.at(pathKey(file.virtualPath));
                hit.effectiveWinner = winner == index;
                hit.effectiveOwner = indexed[winner].owner;
                for (const std::size_t conflictIndex : conflicts)
                {
                    if (conflictIndex != index)
                    {
                        hit.conflictingOwners.push_back(indexed[conflictIndex].owner);
                    }
                }
                if (hit.effectiveWinner)
                {
                    file.score += 0.1;
                    addReason(file.reasons, L"effective-winner");
                }
            }
            else
            {
                hit.effectiveWinner = true;
            }
            hit.confidence = (std::min)(1.0, file.score);
            hit.matchReasons = std::move(file.reasons);
            scan.hits.push_back(std::move(hit));
        }
        std::sort(scan.hits.begin(), scan.hits.end(), [](const auto& left, const auto& right)
        {
            if (left.effectiveWinner != right.effectiveWinner)
            {
                return left.effectiveWinner > right.effectiveWinner;
            }
            if (left.confidence != right.confidence)
            {
                return left.confidence > right.confidence;
            }
            return pathKey(left.path) < pathKey(right.path);
        });
        scan.statistics.candidateCount = scan.hits.size();
        std::wostringstream revision;
        revision << L"discovery-v2:" << std::hex << revisionSeed;
        scan.revision = revision.str();
        scan.complete = !scan.cancelled && scan.statistics.scannedEntries < maximumDiscoveryEntries;
        return scan;
    }
}
