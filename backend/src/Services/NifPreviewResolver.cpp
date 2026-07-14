#include "FluxoraCore/Services/NifPreviewResolver.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "PreviewArchiveReader.hpp"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maxPreviewTextureBatch = 64;
        constexpr std::uintmax_t maxPreviewAssetBytes = 64ULL * 1024ULL * 1024ULL;
        constexpr std::uintmax_t maxPreviewSessionBytes = 256ULL * 1024ULL * 1024ULL;

        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        bool isAllowedPreviewExtension(const std::filesystem::path& relativePath, std::wstring_view kind)
        {
            const std::wstring extension = toLower(relativePath.extension().wstring());
            if (kind == L"nif")
            {
                return extension == L".nif";
            }
            return extension == L".dds" ||
                extension == L".png" ||
                extension == L".jpg" ||
                extension == L".jpeg";
        }

        std::filesystem::path validateRelativePreviewPath(
            std::wstring_view relativePath,
            std::wstring_view kind)
        {
            std::filesystem::path requested(relativePath);
            if (requested.empty() || requested.is_absolute())
            {
                throw std::invalid_argument("Preview asset path must be a non-empty relative path.");
            }

            PathSafetyService safety;
            safety.validateRelativePath(requested).throwIfUnsafe("Preview asset path");
            requested = requested.lexically_normal();
            if (requested == L"." || !isAllowedPreviewExtension(requested, kind))
            {
                throw std::invalid_argument("Preview asset extension is not allowlisted.");
            }
            return requested;
        }

        std::filesystem::path containedPreviewPath(
            const std::filesystem::path& root,
            const std::filesystem::path& relativePath)
        {
            PathSafetyService safety;
            const std::filesystem::path target = root / relativePath;
            safety.validateContainedPath(root, target).throwIfUnsafe("Preview asset");
            return target;
        }

        bool regularFileExists(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::is_regular_file(path, error) && !error;
        }

        std::uintmax_t checkedAssetSize(const std::filesystem::path& path)
        {
            std::error_code error;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            if (error)
            {
                throw std::runtime_error("Failed to inspect preview asset size.");
            }
            if (size > maxPreviewAssetBytes)
            {
                throw std::invalid_argument("Preview asset is too large.");
            }
            return size;
        }

        std::wstring contentKey(const std::filesystem::path& path, std::uintmax_t size)
        {
            std::error_code canonicalError;
            std::filesystem::path canonical = std::filesystem::weakly_canonical(path, canonicalError);
            if (canonicalError)
            {
                canonical = path.lexically_normal();
            }

            std::error_code timeError;
            const auto modified = std::filesystem::last_write_time(path, timeError);
            const auto modifiedCount = timeError ? 0 : modified.time_since_epoch().count();
            const auto utf8 = canonical.generic_u8string();
            std::string fingerprint(
                reinterpret_cast<const char*>(utf8.data()),
                utf8.size());
            fingerprint += ':' + std::to_string(size) + ':' + std::to_string(modifiedCount);

            std::uint64_t hash = 1469598103934665603ULL;
            for (unsigned char character : fingerprint)
            {
                hash ^= character;
                hash *= 1099511628211ULL;
            }

            std::wstringstream stream;
            stream << L"preview-v1-" << std::hex << std::setw(16) << std::setfill(L'0') << hash;
            return stream.str();
        }

        std::wstring displayName(const InstalledModRecord& record)
        {
            return record.displayName.empty() ? record.folderName : record.displayName;
        }

        std::wstring displayNameForPath(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsRoot,
            const std::filesystem::path& modPath)
        {
            const std::vector<InstalledModRecord> records =
                InstanceMetadataStore::listInstalledMods(projectDirectory, modsRoot);
            const auto found = std::find_if(records.begin(), records.end(), [&modPath](const auto& record)
            {
                return record.path == modPath;
            });
            return found == records.end() ? modPath.filename().wstring() : displayName(*found);
        }

        std::wstring mimeTypeFor(const std::filesystem::path& path)
        {
            const std::wstring extension = toLower(path.extension().wstring());
            if (extension == L".dds")
            {
                return L"image/vnd-ms.dds";
            }
            if (extension == L".png")
            {
                return L"image/png";
            }
            if (extension == L".jpg" || extension == L".jpeg")
            {
                return L"image/jpeg";
            }
            return extension == L".nif" ? L"application/x-nif" : L"application/octet-stream";
        }

        NifPreviewPreparedAsset preparedLooseAsset(
            const std::filesystem::path& path,
            const std::filesystem::path& relativePath,
            std::wstring kind,
            std::wstring source)
        {
            const std::uintmax_t size = checkedAssetSize(path);
            return NifPreviewPreparedAsset{
                path,
                std::move(kind),
                relativePath.generic_wstring(),
                relativePath.filename().wstring(),
                mimeTypeFor(relativePath),
                std::move(source),
                contentKey(path, size),
                size
            };
        }

        struct PreviewRoot
        {
            std::filesystem::path path;
            std::wstring source;
        };
    }

    NifPreviewResolver::NifPreviewResolver(
        Logger& logger,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          pathSettings_(pathSettings)
    {
    }

    std::vector<ModPreviewVariant> NifPreviewResolver::listVariants(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view relativePath) const
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const std::filesystem::path requested = validateRelativePreviewPath(relativePath, L"nif");
        const std::filesystem::path modsRoot = pathSettings_.modsDirectory(projectDirectory);
        const std::vector<ProfileOrderItemRecord> order =
            InstanceMetadataStore::listProfileOrderItems(projectDirectory, profileName, modsRoot);

        std::vector<ModPreviewVariant> variants;
        for (const ProfileOrderItemRecord& item : order)
        {
            if (item.kind != L"mod" || !item.hasMod)
            {
                continue;
            }
            PathSafetyService safety;
            safety.validateContainedPath(modsRoot, item.mod.path).throwIfUnsafe("Installed mod folder");
            const std::filesystem::path candidate = containedPreviewPath(item.mod.path, requested);
            if (!regularFileExists(candidate))
            {
                continue;
            }
            variants.push_back(ModPreviewVariant{
                item.mod.path,
                displayName(item.mod),
                item.position,
                item.mod.state != L"disabled",
                requested.generic_wstring(),
                checkedAssetSize(candidate)
            });
        }
        return variants;
    }

    NifPreviewPreparedAsset NifPreviewResolver::prepareVariant(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view relativePath) const
    {
        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and preview mod path are required.");
        }
        const std::filesystem::path requested = validateRelativePreviewPath(relativePath, L"nif");
        const std::filesystem::path modsRoot = pathSettings_.modsDirectory(projectDirectory);
        PathSafetyService safety;
        safety.validateContainedPath(modsRoot, modPath).throwIfUnsafe("Installed mod folder");
        const std::filesystem::path resolved = containedPreviewPath(modPath, requested);
        if (!regularFileExists(resolved))
        {
            throw std::invalid_argument("Preview model asset was not found.");
        }
        return preparedLooseAsset(
            resolved,
            requested,
            L"nif",
            displayNameForPath(projectDirectory, modsRoot, modPath));
    }

    NifPreviewStartResult NifPreviewResolver::start(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& activeModPath,
        std::wstring_view relativePath) const
    {
        const auto started = std::chrono::steady_clock::now();
        std::vector<ModPreviewVariant> variants = listVariants(projectDirectory, profileName, relativePath);
        const auto active = std::find_if(variants.begin(), variants.end(), [&activeModPath](const auto& item)
        {
            return item.modPath == activeModPath;
        });
        if (active == variants.end())
        {
            throw std::invalid_argument("Active preview model was not found in the selected profile.");
        }
        const int activeIndex = static_cast<int>(std::distance(variants.begin(), active));
        NifPreviewPreparedAsset model = prepareVariant(projectDirectory, activeModPath, relativePath);
        const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count();
        logger_.writeOperation(
            LogLevel::Info,
            "NifPreview",
            "Prepared preview variants=" + std::to_string(variants.size()) +
                " modelBytes=" + std::to_string(model.size) +
                " durationMs=" + std::to_string(duration));
        return NifPreviewStartResult{std::move(variants), activeIndex, std::move(model)};
    }

    NifPreviewTextureBatchResult NifPreviewResolver::prepareTextures(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modelModPath,
        const std::vector<std::wstring>& texturePaths) const
    {
        if (projectDirectory.empty() || modelModPath.empty())
        {
            throw std::invalid_argument("Project directory and preview mod path are required.");
        }
        if (texturePaths.size() > maxPreviewTextureBatch)
        {
            throw std::invalid_argument("Preview texture batch exceeds the 64 asset limit.");
        }

        const auto started = std::chrono::steady_clock::now();
        std::vector<std::filesystem::path> requested;
        std::unordered_set<std::wstring> seen;
        requested.reserve(texturePaths.size());
        for (const std::wstring& path : texturePaths)
        {
            std::filesystem::path normalized = validateRelativePreviewPath(path, L"texture");
            const std::wstring key = toLower(normalized.generic_wstring());
            if (seen.insert(key).second)
            {
                requested.push_back(std::move(normalized));
            }
        }

        const BuildPathSettings settings = pathSettings_.loadForProjectDirectory(projectDirectory);
        PathSafetyService safety;
        safety.validateContainedPath(settings.modsDirectory, modelModPath).throwIfUnsafe("Installed mod folder");
        const std::vector<ProfileOrderItemRecord> order = InstanceMetadataStore::listProfileOrderItems(
            projectDirectory,
            profileName,
            settings.modsDirectory);

        std::vector<PreviewRoot> roots;
        if (!settings.overwriteDirectory.empty())
        {
            roots.push_back(PreviewRoot{settings.overwriteDirectory, L"Overwrite"});
        }
        for (auto item = order.rbegin(); item != order.rend(); ++item)
        {
            if (item->kind != L"mod" || !item->hasMod || item->mod.state == L"disabled")
            {
                continue;
            }
            safety.validateContainedPath(settings.modsDirectory, item->mod.path)
                .throwIfUnsafe("Installed mod folder");
            roots.push_back(PreviewRoot{item->mod.path, displayName(item->mod)});
        }
        if (!settings.gameDirectory.empty())
        {
            roots.push_back(PreviewRoot{settings.gameDirectory / L"Data", L"Game Data"});
            roots.push_back(PreviewRoot{settings.gameDirectory, L"Game Data"});
        }

        NifPreviewTextureBatchResult result;
        std::unordered_map<std::wstring, NifPreviewPreparedAsset> resolved;
        const std::filesystem::path archiveCacheDirectory =
            projectDirectory / L".fluxora" / L"cache" / L"nif-preview" / L"v1";
        for (const PreviewRoot& root : roots)
        {
            for (const std::filesystem::path& path : requested)
            {
                const std::wstring key = toLower(path.generic_wstring());
                if (resolved.contains(key) || root.path.empty())
                {
                    continue;
                }
                const std::filesystem::path candidate = containedPreviewPath(root.path, path);
                if (regularFileExists(candidate))
                {
                    resolved.emplace(key, preparedLooseAsset(candidate, path, L"texture", root.source));
                }
            }

            std::vector<std::wstring> unresolvedPaths;
            for (const std::filesystem::path& path : requested)
            {
                const std::wstring key = toLower(path.generic_wstring());
                if (!resolved.contains(key))
                {
                    unresolvedPaths.push_back(path.generic_wstring());
                }
            }
            const PreviewArchiveBatchResult archived = preparePreviewAssetsFromBethesdaArchives(
                root.path,
                unresolvedPaths,
                archiveCacheDirectory);
            result.archiveIndexHits += archived.indexHits;
            result.archiveIndexMisses += archived.indexMisses;
            result.archiveAssetCacheHits += archived.assetCacheHits;
            result.archiveAssetCacheMisses += archived.assetCacheMisses;
            for (const PreparedPreviewArchiveAsset& asset : archived.assets)
            {
                const std::filesystem::path relative(asset.relativePath);
                const std::wstring key = toLower(relative.generic_wstring());
                resolved.try_emplace(
                    key,
                    NifPreviewPreparedAsset{
                        asset.resolvedPath,
                        L"texture",
                        relative.generic_wstring(),
                        relative.filename().wstring(),
                        mimeTypeFor(relative),
                        root.source + L" Archive: " + asset.archiveDisplayName,
                        asset.contentKey,
                        asset.size
                    });
            }
        }

        for (const std::filesystem::path& path : requested)
        {
            const std::wstring key = toLower(path.generic_wstring());
            const auto found = resolved.find(key);
            if (found == resolved.end())
            {
                result.missing.push_back(path.generic_wstring());
                continue;
            }
            if (result.totalBytes > maxPreviewSessionBytes - found->second.size)
            {
                throw std::invalid_argument("Preview texture batch exceeds the 256 MiB session limit.");
            }
            result.totalBytes += found->second.size;
            result.assets.push_back(found->second);
        }

        const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count();
        logger_.writeOperation(
            LogLevel::Info,
            "NifPreview",
            "Prepared texture batch requested=" + std::to_string(texturePaths.size()) +
                " unique=" + std::to_string(requested.size()) +
                " assets=" + std::to_string(result.assets.size()) +
                " missing=" + std::to_string(result.missing.size()) +
                " bytes=" + std::to_string(result.totalBytes) +
                " archiveIndexHits=" + std::to_string(result.archiveIndexHits) +
                " archiveIndexMisses=" + std::to_string(result.archiveIndexMisses) +
                " archiveCacheHits=" + std::to_string(result.archiveAssetCacheHits) +
                " archiveCacheMisses=" + std::to_string(result.archiveAssetCacheMisses) +
                " durationMs=" + std::to_string(duration));
        return result;
    }
}
