#include "FluxoraCore/Services/ModService.hpp"

#include "FluxoraCore/Services/VfsMountPlan.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/InstallProjectGate.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "PreviewArchiveReader.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cstring>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <map>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maxModFolderNameLength = 255;

        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::wstring trim(std::wstring value)
        {
            const auto first = value.find_first_not_of(L" \t\r\n.");
            if (first == std::wstring::npos)
            {
                return {};
            }

            const auto last = value.find_last_not_of(L" \t\r\n.");
            return value.substr(first, last - first + 1);
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        bool containsInvalidFileNameCharacter(std::wstring_view value)
        {
            for (wchar_t character : value)
            {
                if (character < 32)
                {
                    return true;
                }

                switch (character)
                {
                case L'<':
                case L'>':
                case L':':
                case L'"':
                case L'/':
                case L'\\':
                case L'|':
                case L'?':
                case L'*':
                    return true;
                default:
                    break;
                }
            }

            return false;
        }

        bool isReservedDeviceName(std::wstring_view value)
        {
            std::wstring name(value);
            const std::size_t dot = name.find(L'.');
            if (dot != std::wstring::npos)
            {
                name.resize(dot);
            }

            name = toLower(std::move(name));
            return name == L"con" ||
                name == L"prn" ||
                name == L"aux" ||
                name == L"nul" ||
                name == L"com1" ||
                name == L"com2" ||
                name == L"com3" ||
                name == L"com4" ||
                name == L"com5" ||
                name == L"com6" ||
                name == L"com7" ||
                name == L"com8" ||
                name == L"com9" ||
                name == L"lpt1" ||
                name == L"lpt2" ||
                name == L"lpt3" ||
                name == L"lpt4" ||
                name == L"lpt5" ||
                name == L"lpt6" ||
                name == L"lpt7" ||
                name == L"lpt8" ||
                name == L"lpt9";
        }

        std::wstring validateModFolderName(std::wstring_view value)
        {
            std::wstring name = trim(std::wstring(value));
            if (name.empty())
            {
                throw std::invalid_argument("Mod name is required.");
            }

            if (name.size() > maxModFolderNameLength)
            {
                throw std::invalid_argument("Mod name is too long.");
            }

            if (containsInvalidFileNameCharacter(name))
            {
                throw std::invalid_argument("Mod name contains invalid path characters.");
            }

            if (isReservedDeviceName(name))
            {
                throw std::invalid_argument("Mod name is reserved by Windows.");
            }

            return name;
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
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
            return out;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::wstring fromUtf8(const std::string& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0);
            if (size <= 0)
            {
                throw std::invalid_argument("Text is not valid UTF-8.");
            }

            std::wstring out(static_cast<std::size_t>(size), L'\0');
            MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size);
            return out;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        constexpr std::uintmax_t maxTextEditorFileBytes = 5ULL * 1024ULL * 1024ULL;
        constexpr std::uintmax_t maxAiTextPreviewBytes = 64ULL * 1024ULL;

        void rejectBinaryTextContent(const std::string& content)
        {
            if (content.find('\0') != std::string::npos)
            {
                throw std::invalid_argument("File is not a text document.");
            }
        }

        std::wstring readUtf8TextDocument(const std::filesystem::path& path)
        {
            std::error_code statusError;
            if (!std::filesystem::is_regular_file(path, statusError) || statusError)
            {
                throw std::invalid_argument("Text editor can only open regular files.");
            }

            const std::uintmax_t size = std::filesystem::file_size(path, statusError);
            if (statusError)
            {
                throw std::runtime_error("Failed to inspect text file size.");
            }
            if (size > maxTextEditorFileBytes)
            {
                throw std::invalid_argument("Text file is too large for the editor.");
            }

            std::ifstream file(path, std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to open text file.");
            }

            std::string content(
                (std::istreambuf_iterator<char>(file)),
                std::istreambuf_iterator<char>());
            rejectBinaryTextContent(content);
            return fromUtf8(content);
        }

        std::uintmax_t boundedTextPreviewBytes(std::uintmax_t maxBytes)
        {
            if (maxBytes == 0)
            {
                return maxAiTextPreviewBytes;
            }

            return (std::min)(maxBytes, maxAiTextPreviewBytes);
        }

        std::wstring decodeUtf8Preview(std::string& content)
        {
            rejectBinaryTextContent(content);
            while (!content.empty())
            {
                try
                {
                    return fromUtf8(content);
                }
                catch (const std::invalid_argument&)
                {
                    content.pop_back();
                }
            }

            return {};
        }

        ModTextFilePreview readUtf8TextPreview(
            const std::filesystem::path& path,
            std::wstring relativePath,
            std::uintmax_t maxBytes)
        {
            std::error_code statusError;
            if (!std::filesystem::is_regular_file(path, statusError) || statusError)
            {
                throw std::invalid_argument("Text preview can only open regular files.");
            }

            const std::uintmax_t size = std::filesystem::file_size(path, statusError);
            if (statusError)
            {
                throw std::runtime_error("Failed to inspect text preview file size.");
            }

            const std::uintmax_t requestedBytes = boundedTextPreviewBytes(maxBytes);
            const std::uintmax_t bytesToRead = (std::min)(size, requestedBytes);
            std::ifstream file(path, std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to open text preview file.");
            }

            std::string content(static_cast<std::size_t>(bytesToRead), '\0');
            if (!content.empty())
            {
                file.read(content.data(), static_cast<std::streamsize>(content.size()));
                content.resize(static_cast<std::size_t>(file.gcount()));
            }

            std::uintmax_t bytesRead = static_cast<std::uintmax_t>(content.size());
            const std::wstring preview = decodeUtf8Preview(content);
            bytesRead = static_cast<std::uintmax_t>(content.size());

            return ModTextFilePreview{
                path,
                std::move(relativePath),
                path.filename().wstring(),
                preview,
                bytesRead,
                size,
                size > bytesRead
            };
        }

        std::filesystem::path validateRelativeModTextPath(std::wstring_view relativePath)
        {
            std::filesystem::path requested(relativePath);
            if (requested.empty())
            {
                throw std::invalid_argument("Text file path is required.");
            }
            if (requested.is_absolute())
            {
                throw std::invalid_argument("Text file path must be relative.");
            }

            PathSafetyService safety;
            safety.validateRelativePath(requested).throwIfUnsafe("Mod text file path");

            requested = requested.lexically_normal();
            if (requested == L".")
            {
                throw std::invalid_argument("Text file path is required.");
            }

            return requested;
        }

        void validateRelativeModTextPreviewPath(const std::filesystem::path& relativePath)
        {
            const std::wstring extension = toLower(relativePath.extension().wstring());
            const bool allowedExtension =
                extension == L".txt" ||
                extension == L".log" ||
                extension == L".xml" ||
                extension == L".ini" ||
                extension == L".json" ||
                extension == L".cfg" ||
                extension == L".toml" ||
                extension == L".yaml" ||
                extension == L".yml";
            if (!allowedExtension)
            {
                throw std::invalid_argument("Text preview file extension is not allowlisted.");
            }

            for (const std::filesystem::path& component : relativePath)
            {
                const std::wstring lowered = toLower(component.wstring());
                if (lowered.find(L"password") != std::wstring::npos ||
                    lowered.find(L"passwd") != std::wstring::npos ||
                    lowered.find(L"credential") != std::wstring::npos ||
                    lowered.find(L"secret") != std::wstring::npos ||
                    lowered.find(L"token") != std::wstring::npos ||
                    lowered.find(L"cookie") != std::wstring::npos ||
                    lowered.find(L"browser") != std::wstring::npos ||
                    lowered.find(L"keyring") != std::wstring::npos ||
                    lowered.find(L"wallet") != std::wstring::npos)
                {
                    throw std::invalid_argument("Text preview path looks like credential or browser data.");
                }
            }
        }

        std::filesystem::path resolveModTextFilePath(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view relativePath,
            const std::filesystem::path& modsRoot)
        {
            if (projectDirectory.empty() || modPath.empty())
            {
                throw std::invalid_argument("Project directory and mod path are required.");
            }

            const std::filesystem::path requested = validateRelativeModTextPath(relativePath);
            PathSafetyService safety;
            safety.validateContainedPath(modsRoot, modPath).throwIfUnsafe("Installed mod folder");

            const std::filesystem::path targetPath = modPath / requested;
            safety.validateContainedPath(modPath, targetPath).throwIfUnsafe("Mod text file");
            return targetPath;
        }

        std::wstring normalizedRelativeTextPath(std::wstring_view relativePath)
        {
            return validateRelativeModTextPath(relativePath).generic_wstring();
        }

        constexpr std::uintmax_t maxPreviewAssetBytes = 64ULL * 1024ULL * 1024ULL;

        std::wstring normalizedPreviewKind(std::wstring_view kind)
        {
            std::wstring value = toLower(trim(std::wstring(kind)));
            if (value == L"file-preview:nif")
            {
                value = L"nif";
            }

            if (value != L"nif" && value != L"texture")
            {
                throw std::invalid_argument("Preview asset kind is not supported.");
            }

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
            if (requested.empty())
            {
                throw std::invalid_argument("Preview asset path is required.");
            }
            if (requested.is_absolute())
            {
                throw std::invalid_argument("Preview asset path must be relative.");
            }

            PathSafetyService safety;
            safety.validateRelativePath(requested).throwIfUnsafe("Preview asset path");

            requested = requested.lexically_normal();
            if (requested == L".")
            {
                throw std::invalid_argument("Preview asset path is required.");
            }
            if (!isAllowedPreviewExtension(requested, kind))
            {
                throw std::invalid_argument("Preview asset extension is not allowlisted.");
            }

            return requested;
        }

        std::vector<std::uint8_t> readPreviewAssetBytes(const std::filesystem::path& path)
        {
            std::error_code statusError;
            if (!std::filesystem::is_regular_file(path, statusError) || statusError)
            {
                throw std::invalid_argument("Preview asset can only open regular files.");
            }

            const std::uintmax_t size = std::filesystem::file_size(path, statusError);
            if (statusError)
            {
                throw std::runtime_error("Failed to inspect preview asset size.");
            }
            if (size > maxPreviewAssetBytes)
            {
                throw std::invalid_argument("Preview asset is too large.");
            }

            std::ifstream file(path, std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to open preview asset.");
            }

            std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
            if (!bytes.empty())
            {
                file.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
                bytes.resize(static_cast<std::size_t>(file.gcount()));
            }

            return bytes;
        }

        bool regularFileExists(const std::filesystem::path& path)
        {
            std::error_code statusError;
            return std::filesystem::is_regular_file(path, statusError) && !statusError;
        }

        std::uintmax_t fileSizeOrZero(const std::filesystem::path& path)
        {
            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
            return sizeError ? 0 : size;
        }

        std::wstring displayNameForModRecord(const InstalledModRecord& record)
        {
            return record.displayName.empty() ? record.folderName : record.displayName;
        }

        std::wstring displayNameForModPath(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsRoot,
            const std::filesystem::path& modPath)
        {
            const std::vector<InstalledModRecord> records =
                InstanceMetadataStore::listInstalledMods(projectDirectory, modsRoot);
            const auto found = std::find_if(
                records.begin(),
                records.end(),
                [&modPath](const InstalledModRecord& record)
                {
                    return record.path == modPath;
                });
            return found == records.end()
                ? modPath.filename().wstring()
                : displayNameForModRecord(*found);
        }

        std::filesystem::path containedPreviewPath(
            const std::filesystem::path& modPath,
            const std::filesystem::path& relativePath)
        {
            PathSafetyService safety;
            const std::filesystem::path targetPath = modPath / relativePath;
            safety.validateContainedPath(modPath, targetPath).throwIfUnsafe("Preview asset");
            return targetPath;
        }

        struct PreviewAssetSource
        {
            std::filesystem::path rootPath;
            std::wstring sourceName;
            std::filesystem::path targetPath;
            std::optional<std::vector<std::uint8_t>> bytes;
        };

        std::optional<PreviewAssetSource> previewAssetSourceFromRoot(
            const std::filesystem::path& rootPath,
            const std::filesystem::path& relativePath,
            std::wstring sourceName)
        {
            if (rootPath.empty())
            {
                return std::nullopt;
            }

            const std::filesystem::path targetPath = containedPreviewPath(rootPath, relativePath);
            if (!regularFileExists(targetPath))
            {
                return std::nullopt;
            }

            return PreviewAssetSource{
                rootPath,
                std::move(sourceName),
                targetPath,
                std::nullopt
            };
        }

        std::optional<PreviewAssetSource> previewAssetSourceFromArchives(
            const std::filesystem::path& rootPath,
            const std::filesystem::path& relativePath,
            std::wstring sourceName)
        {
            std::optional<PreviewArchiveAsset> asset =
                readPreviewAssetFromBethesdaArchives(rootPath, relativePath.generic_wstring());
            if (!asset.has_value())
            {
                return std::nullopt;
            }

            sourceName += L" Archive: " + asset->archiveDisplayName;
            return PreviewAssetSource{
                asset->archivePath,
                std::move(sourceName),
                asset->archivePath,
                std::move(asset->bytes)
            };
        }

        bool canCheckNexusUpdates(const InstalledModRecord& mod)
        {
            return equalsIgnoreCase(mod.source.provider, L"nexus") &&
                !mod.source.gameDomain.empty() &&
                !mod.source.remoteModId.empty() &&
                !mod.source.remoteFileId.empty();
        }

        bool isUnknownVersion(std::wstring_view value)
        {
            const std::wstring normalized = toLower(trim(std::wstring(value)));
            return normalized.empty() || normalized == L"unknown";
        }

        bool hasUpdate(const InstalledModRecord& mod)
        {
            return canCheckNexusUpdates(mod) &&
                !mod.source.latestFileId.empty() &&
                mod.source.latestFileId != mod.source.remoteFileId;
        }

        std::wstring updateStatusText(const InstalledModRecord& mod)
        {
            if (!canCheckNexusUpdates(mod))
            {
                return mod.source.provider.empty() || equalsIgnoreCase(mod.source.provider, L"local")
                    ? L"Локальный мод"
                    : L"Ручной источник";
            }

            if (mod.source.lastCheckedAt.empty())
            {
                return L"Не проверялся";
            }

            if (isUnknownVersion(mod.source.latestVersion))
            {
                return L"Проверено";
            }

            if (isUnknownVersion(mod.version))
            {
                return L"Последняя: " + mod.source.latestVersion;
            }

            return hasUpdate(mod)
                ? L"Доступно: " + mod.source.latestVersion
                : L"Актуально";
        }

        std::wstring conflictStatusText(const ModFileSummary& summary)
        {
            if (summary.fileCount < 0)
            {
                return L"Файлы не просканированы";
            }
            if (summary.fileCount == 0)
            {
                return L"Файлов нет";
            }
            if (summary.conflictingFileCount == 0)
            {
                return L"Конфликтов нет";
            }

            return std::to_wstring(summary.conflictingFileCount) +
                L" конфликтных; перекрывает " +
                std::to_wstring(summary.overwritingFileCount) +
                L", перекрыт " +
                std::to_wstring(summary.overwrittenFileCount);
        }

        InstalledModEntry entryFromRecord(
            const InstalledModRecord& mod,
            const ModFileSummary& summary)
        {
            return InstalledModEntry{
                mod.path,
                mod.displayName.empty() ? mod.folderName : mod.displayName,
                isUnknownVersion(mod.version) ? L"Unknown" : mod.version,
                mod.installedAt,
                mod.updatedAt,
                mod.source.latestVersion,
                mod.source.lastCheckedAt,
                updateStatusText(mod),
                conflictStatusText(summary),
                summary.fileCount,
                summary.conflictingFileCount,
                summary.overwrittenFileCount,
                summary.overwritingFileCount,
                mod.state != L"disabled",
                canCheckNexusUpdates(mod),
                hasUpdate(mod),
                mod.sourceIsNexus,
                mod.sourceIsModdingFlow,
                mod.isLocal,
                mod.isTranslation,
                mod.isPatch,
                mod.source.provider,
                mod.source.gameDomain,
                mod.source.remoteModId,
                mod.source.remoteFileId,
                mod.source.url,
                summary.overwritesModIds,
                summary.overwrittenByModIds,
                mod.source.latestFileId,
                mod.source.updateCheckState
            };
        }

        std::wstring pathKey(const std::filesystem::path& path)
        {
            return toLower(path.wstring());
        }

        std::wstring normalizedPathText(const std::filesystem::path& path)
        {
            return toLower(std::filesystem::weakly_canonical(path).wstring());
        }

        bool isPathInsideDirectory(
            const std::filesystem::path& candidate,
            const std::filesystem::path& directory)
        {
            std::wstring candidateText = normalizedPathText(candidate);
            std::wstring directoryText = normalizedPathText(directory);
            if (candidateText == directoryText)
            {
                return false;
            }

            if (!directoryText.empty() &&
                directoryText.back() != L'\\' &&
                directoryText.back() != L'/')
            {
                directoryText.push_back(std::filesystem::path::preferred_separator);
            }

            return candidateText.starts_with(directoryText);
        }

        bool isSameFilesystemPath(
            const std::filesystem::path& left,
            const std::filesystem::path& right)
        {
            if (left.empty() || right.empty())
            {
                return false;
            }

            return normalizedPathText(left) == normalizedPathText(right);
        }

        std::filesystem::path nativeDeletePath(const std::filesystem::path& path)
        {
#ifdef _WIN32
            std::wstring text = std::filesystem::absolute(path).lexically_normal().wstring();
            if (text.rfind(LR"(\\?\)", 0) == 0)
            {
                return std::filesystem::path(text);
            }

            if (text.rfind(LR"(\\)", 0) == 0)
            {
                return std::filesystem::path(LR"(\\?\UNC\)" + text.substr(2));
            }

            return std::filesystem::path(LR"(\\?\)" + text);
#else
            return path;
#endif
        }

        void clearReadonlyAttribute(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const std::filesystem::path nativePath = nativeDeletePath(path);
            const DWORD attributes = GetFileAttributesW(nativePath.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_READONLY) == 0)
            {
                return;
            }

            SetFileAttributesW(nativePath.c_str(), attributes & ~FILE_ATTRIBUTE_READONLY);
#else
            (void)path;
#endif
        }

        void removePathWithRetry(const std::filesystem::path& path)
        {
            constexpr int maxAttempts = 3;

            for (int attempt = 0; attempt < maxAttempts; ++attempt)
            {
                clearReadonlyAttribute(path);
                const std::filesystem::path nativePath = nativeDeletePath(path);
                std::error_code removeError;
                const bool removed = std::filesystem::remove(nativePath, removeError);
                std::error_code existsError;
                if (!removeError &&
                    (removed || !std::filesystem::exists(nativePath, existsError)))
                {
                    return;
                }

                if (attempt + 1 < maxAttempts)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(80));
                    continue;
                }

                const std::string reason = removeError
                    ? removeError.message()
                    : "path still exists";
                throw std::runtime_error(
                    "Failed to delete \"" + toUtf8(path.wstring()) + "\": " + reason);
            }
        }

        using DirectoryIterator = std::filesystem::directory_iterator;

        struct DirectoryDeletionFrame
        {
            std::filesystem::path directory;
            DirectoryIterator iterator;
        };

        DirectoryIterator openDirectoryForDeletion(const std::filesystem::path& directory)
        {
            std::error_code iterateError;
            DirectoryIterator iterator(
                directory,
                std::filesystem::directory_options::skip_permission_denied,
                iterateError);
            if (iterateError)
            {
                throw std::runtime_error(
                    "Failed to scan mod directory for deletion \"" +
                    toUtf8(directory.wstring()) + "\": " + iterateError.message());
            }

            return iterator;
        }

        void removeDirectoryTreePostOrder(const std::filesystem::path& root)
        {
            clearReadonlyAttribute(root);

            const DirectoryIterator end;
            std::vector<DirectoryDeletionFrame> stack;
            stack.push_back({root, openDirectoryForDeletion(root)});

            while (!stack.empty())
            {
                DirectoryDeletionFrame& frame = stack.back();
                if (frame.iterator == end)
                {
                    const std::filesystem::path directory = std::move(frame.directory);
                    stack.pop_back();
                    removePathWithRetry(directory);
                    continue;
                }

                const std::filesystem::directory_entry entry = *frame.iterator;
                std::error_code incrementError;
                frame.iterator.increment(incrementError);
                if (incrementError)
                {
                    throw std::runtime_error(
                        "Failed to scan mod directory for deletion \"" +
                        toUtf8(frame.directory.wstring()) + "\": " + incrementError.message());
                }

                const std::filesystem::path current = entry.path();
                std::error_code entryError;
                const std::filesystem::file_status status = entry.symlink_status(entryError);
                if (entryError)
                {
                    throw std::runtime_error(
                        "Failed to inspect mod item for deletion \"" +
                        toUtf8(current.wstring()) + "\": " + entryError.message());
                }

                if (std::filesystem::is_directory(status) && !std::filesystem::is_symlink(status))
                {
                    clearReadonlyAttribute(current);
                    stack.push_back({current, openDirectoryForDeletion(current)});
                    continue;
                }

                removePathWithRetry(current);
            }
        }

        void removeModFilesystemPath(const std::filesystem::path& modPath)
        {
            const std::filesystem::path nativeRoot = nativeDeletePath(modPath);
            std::error_code statusError;
            const std::filesystem::file_status rootStatus = std::filesystem::symlink_status(nativeRoot, statusError);
            if (statusError || !std::filesystem::exists(rootStatus))
            {
                return;
            }

            const bool isRootDirectory = std::filesystem::is_directory(rootStatus) &&
                !std::filesystem::is_symlink(rootStatus);
            if (!isRootDirectory)
            {
                removePathWithRetry(nativeRoot);
                return;
            }

            removeDirectoryTreePostOrder(nativeRoot);
        }

        void removeDirectoryContents(const std::filesystem::path& directory)
        {
            std::error_code iterateError;
            DirectoryIterator iterator(
                directory,
                std::filesystem::directory_options::skip_permission_denied,
                iterateError);
            if (iterateError)
            {
                throw std::runtime_error(
                    "Failed to scan overwrite folder \"" +
                    toUtf8(directory.wstring()) + "\": " + iterateError.message());
            }

            std::vector<std::filesystem::path> children;
            for (const DirectoryIterator end; iterator != end; iterator.increment(iterateError))
            {
                if (iterateError)
                {
                    throw std::runtime_error(
                        "Failed to scan overwrite folder \"" +
                        toUtf8(directory.wstring()) + "\": " + iterateError.message());
                }

                children.push_back(iterator->path());
            }

            for (const std::filesystem::path& child : children)
            {
                removeModFilesystemPath(child);
            }
        }

        ModFileSummary deferredFileSummary()
        {
            ModFileSummary summary;
            summary.fileCount = -1;
            return summary;
        }

    }

    ModService::ModService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          pathSettings_(pathSettings),
          nifPreviewResolver_(logger, pathSettings)
    {
    }

    void ModService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        initialized_ = true;
        logger_.write(LogLevel::Info, "Mod service initialized.");
    }

    void ModService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        mods_.clear();
        logger_.write(LogLevel::Info, "Mod service shut down.");
        initialized_ = false;
    }

    void ModService::registerMod(ModDescriptor descriptor)
    {
        mods_.push_back(std::move(descriptor));
    }

    const std::vector<ModDescriptor>& ModService::mods() const noexcept
    {
        return mods_;
    }

    std::vector<InstalledModEntry> ModService::listInstalledMods(
        const std::filesystem::path& projectDirectory) const
    {
        const std::filesystem::path modsDirectory = pathSettings_.modsDirectory(projectDirectory);
        const std::vector<ModFileSummaryRecord> summaries =
            InstanceMetadataStore::summarizeInstalledModFiles(projectDirectory, modsDirectory);
        const std::vector<InstalledModRecord> mods =
            InstanceMetadataStore::listInstalledMods(projectDirectory, modsDirectory);

        std::map<std::wstring, ModFileSummary> summariesByPath;
        for (const ModFileSummaryRecord& summary : summaries)
        {
            summariesByPath.emplace(pathKey(summary.modPath), summary.summary);
        }

        std::vector<InstalledModEntry> entries;
        entries.reserve(mods.size());
        for (const InstalledModRecord& mod : mods)
        {
            const auto summary = summariesByPath.find(pathKey(mod.path));
            entries.push_back(entryFromRecord(
                mod,
                summary == summariesByPath.end() ? deferredFileSummary() : summary->second));
        }

        return entries;
    }

    std::vector<InstalledModEntry> ModService::listPersistedInstalledMods(
        const std::filesystem::path& projectDirectory) const
    {
        const std::filesystem::path modsDirectory = pathSettings_.modsDirectory(projectDirectory);
        const PersistedInstalledModsSnapshot snapshot =
            InstanceMetadataStore::persistedInstalledModsSnapshot(
                projectDirectory,
                modsDirectory);

        std::vector<InstalledModEntry> entries;
        entries.reserve(snapshot.mods.size());
        for (std::size_t index = 0; index < snapshot.mods.size(); ++index)
        {
            const InstalledModRecord& mod = snapshot.mods[index];
            const ModFileSummary& summary = index < snapshot.summaries.size()
                ? snapshot.summaries[index].summary
                : deferredFileSummary();
            entries.push_back(entryFromRecord(
                mod,
                summary));
        }
        return entries;
    }

    void ModService::invalidateFileCaches(
        const std::filesystem::path& projectDirectory,
        const std::vector<std::filesystem::path>& changedPaths) const
    {
        InstallProjectGate projectGate(projectDirectory);
        InstanceMetadataStore::invalidateModFileCaches(
            projectDirectory,
            changedPaths,
            pathSettings_.modsDirectory(projectDirectory));
        invalidateVfsContentPlacementCache(
            pathSettings_.modsDirectory(projectDirectory),
            changedPaths);
    }

    std::vector<ModFileTreeEntry> ModService::listModFileTree(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view relativeDirectory) const
    {
        return InstanceMetadataStore::listModFileTree(
            projectDirectory,
            modPath,
            relativeDirectory,
            pathSettings_.modsDirectory(projectDirectory));
    }

    ModDetailsContent ModService::getModDetailsContent(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath) const
    {
        return InstanceMetadataStore::getModDetailsContent(
            projectDirectory,
            modPath,
            pathSettings_.modsDirectory(projectDirectory));
    }

    ModConflictTreePage ModService::listModConflictTree(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view cursor,
        int limit) const
    {
        return InstanceMetadataStore::listModConflictTree(
            projectDirectory,
            modPath,
            cursor,
            limit,
            pathSettings_.modsDirectory(projectDirectory));
    }

    ModTextFileDocument ModService::readModTextFile(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view relativePath) const
    {
        const std::filesystem::path targetPath = resolveModTextFilePath(
            projectDirectory,
            modPath,
            relativePath,
            pathSettings_.modsDirectory(projectDirectory));

        const std::wstring content = readUtf8TextDocument(targetPath);
        std::error_code sizeError;
        const std::uintmax_t size = std::filesystem::file_size(targetPath, sizeError);
        return ModTextFileDocument{
            targetPath,
            normalizedRelativeTextPath(relativePath),
            targetPath.filename().wstring(),
            content,
            sizeError ? 0 : size
        };
    }

    ModTextFilePreview ModService::previewModTextFile(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view relativePath,
        std::uintmax_t maxBytes) const
    {
        const std::wstring normalizedRelative = normalizedRelativeTextPath(relativePath);
        validateRelativeModTextPreviewPath(std::filesystem::path(normalizedRelative));
        const std::filesystem::path targetPath = resolveModTextFilePath(
            projectDirectory,
            modPath,
            normalizedRelative,
            pathSettings_.modsDirectory(projectDirectory));

        return readUtf8TextPreview(targetPath, normalizedRelative, maxBytes);
    }

    ModTextFileSaveResult ModService::saveModTextFile(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view relativePath,
        std::wstring_view content) const
    {
        const std::filesystem::path targetPath = resolveModTextFilePath(
            projectDirectory,
            modPath,
            relativePath,
            pathSettings_.modsDirectory(projectDirectory));

        std::error_code statusError;
        if (std::filesystem::exists(targetPath, statusError) &&
            !std::filesystem::is_regular_file(targetPath, statusError))
        {
            throw std::invalid_argument("Text editor can only save regular files.");
        }

        const std::string bytes = toUtf8(std::wstring(content));
        PathSafetyWriteOptions writeOptions;
        writeOptions.requiredBytes = static_cast<std::uintmax_t>(bytes.size());
        PathSafetyService()
            .validateWritePath(modPath, targetPath, writeOptions)
            .throwIfUnsafe("Mod text file save");

        InstallProjectGate projectGate(projectDirectory);

        AtomicFileStore().writeTextFile(
            targetPath,
            bytes,
            AtomicFileWriteOptions{
                L"Mod text file",
                ProjectStateValidation::Utf8Text,
                {},
                true
            });

        logger_.writeOperation(
            LogLevel::Info,
            "ModTextFile",
            "Saved mod text file path=\"" + toUtf8(targetPath.wstring()) + "\"");

        std::error_code sizeError;
        const std::uintmax_t size = std::filesystem::file_size(targetPath, sizeError);
        return ModTextFileSaveResult{
            targetPath,
            normalizedRelativeTextPath(relativePath),
            targetPath.filename().wstring(),
            sizeError ? 0 : size
        };
    }

    std::vector<ModPreviewVariant> ModService::listPreviewVariants(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view relativePath) const
    {
        return nifPreviewResolver_.listVariants(projectDirectory, profileName, relativePath);
    }

    NifPreviewStartResult ModService::startNifPreview(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& activeModPath,
        std::wstring_view relativePath) const
    {
        return nifPreviewResolver_.start(
            projectDirectory,
            profileName,
            activeModPath,
            relativePath);
    }

    NifPreviewPreparedAsset ModService::prepareNifPreviewVariant(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        std::wstring_view relativePath) const
    {
        return nifPreviewResolver_.prepareVariant(projectDirectory, modPath, relativePath);
    }

    NifPreviewTextureBatchResult ModService::prepareNifPreviewTextures(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modelModPath,
        const std::vector<std::wstring>& texturePaths) const
    {
        return nifPreviewResolver_.prepareTextures(
            projectDirectory,
            profileName,
            modelModPath,
            texturePaths);
    }

    ModPreviewAsset ModService::readPreviewAsset(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const std::filesystem::path& modPath,
        std::wstring_view relativePath,
        std::wstring_view kind) const
    {
        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        const std::wstring assetKind = normalizedPreviewKind(kind);
        const std::filesystem::path requested = validateRelativePreviewPath(relativePath, assetKind);
        const std::wstring normalizedRelative = requested.generic_wstring();
        const BuildPathSettings settings = pathSettings_.loadForProjectDirectory(projectDirectory);
        const std::filesystem::path modsRoot = settings.modsDirectory;
        PathSafetyService safety;
        safety.validateContainedPath(modsRoot, modPath).throwIfUnsafe("Installed mod folder");

        std::filesystem::path sourceModPath = modPath;
        std::wstring sourceModName = displayNameForModPath(projectDirectory, modsRoot, modPath);
        std::filesystem::path targetPath = containedPreviewPath(modPath, requested);
        std::optional<std::vector<std::uint8_t>> archiveBytes;

        if (assetKind == L"texture")
        {
            const auto useSource = [&](const PreviewAssetSource& source)
            {
                sourceModPath = source.rootPath;
                sourceModName = source.sourceName;
                targetPath = source.targetPath;
                archiveBytes = source.bytes;
            };

            std::optional<PreviewAssetSource> winner =
                previewAssetSourceFromRoot(settings.overwriteDirectory, requested, L"Overwrite");
            if (!winner.has_value())
            {
                winner = previewAssetSourceFromArchives(settings.overwriteDirectory, requested, L"Overwrite");
            }

            const std::vector<ProfileOrderItemRecord> order =
                InstanceMetadataStore::listProfileOrderItems(projectDirectory, profileName, modsRoot);
            for (auto item = order.rbegin(); !winner.has_value() && item != order.rend(); ++item)
            {
                if (item->kind != L"mod" || !item->hasMod || item->mod.state == L"disabled")
                {
                    continue;
                }

                safety.validateContainedPath(modsRoot, item->mod.path).throwIfUnsafe("Installed mod folder");
                winner = previewAssetSourceFromRoot(
                    item->mod.path,
                    requested,
                    displayNameForModRecord(item->mod));
                if (!winner.has_value())
                {
                    winner = previewAssetSourceFromArchives(
                        item->mod.path,
                        requested,
                        displayNameForModRecord(item->mod));
                }
            }

            if (!winner.has_value() && !settings.gameDirectory.empty())
            {
                const std::filesystem::path gameDataRoot = settings.gameDirectory / L"Data";
                winner = previewAssetSourceFromRoot(gameDataRoot, requested, L"Game Data");
                if (!winner.has_value())
                {
                    winner = previewAssetSourceFromArchives(gameDataRoot, requested, L"Game Data");
                }
                if (!winner.has_value() && gameDataRoot != settings.gameDirectory)
                {
                    winner = previewAssetSourceFromRoot(settings.gameDirectory, requested, L"Game Data");
                    if (!winner.has_value())
                    {
                        winner = previewAssetSourceFromArchives(settings.gameDirectory, requested, L"Game Data");
                    }
                }
            }

            if (winner.has_value())
            {
                useSource(*winner);
            }
        }

        if (!archiveBytes.has_value() && !regularFileExists(targetPath))
        {
            throw std::invalid_argument(
                assetKind == L"texture"
                    ? "Preview texture asset was not found."
                    : "Preview model asset was not found.");
        }

        std::vector<std::uint8_t> bytes = archiveBytes.has_value()
            ? std::move(*archiveBytes)
            : readPreviewAssetBytes(targetPath);
        return ModPreviewAsset{
            assetKind,
            sourceModPath,
            sourceModName,
            normalizedRelative,
            requested.filename().wstring(),
            static_cast<std::uintmax_t>(bytes.size()),
            std::move(bytes)
        };
    }

    InstalledModEntry ModService::createEmptyMod(
        const std::filesystem::path& projectDirectory,
        std::wstring_view modName) const
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        InstallProjectGate projectGate(projectDirectory);

        const std::wstring safeName = validateModFolderName(modName);
        const std::filesystem::path modsDirectory = pathSettings_.modsDirectory(projectDirectory);
        const std::filesystem::path targetDirectory = modsDirectory / std::filesystem::path(safeName);
        if (std::filesystem::exists(targetDirectory))
        {
            throw std::invalid_argument("Mod is already installed.");
        }

        const PathSafetyService safety;
        safety.validateDirectoryWriteRoot(modsDirectory)
            .throwIfUnsafe("Mods directory is unsafe");
        safety.validateWritePath(modsDirectory, targetDirectory)
            .throwIfUnsafe("Empty mod target path is unsafe");

        try
        {
            std::filesystem::create_directories(targetDirectory);
            const InstalledModRecord record = InstanceMetadataStore::registerInstalledMod(
                projectDirectory,
                targetDirectory,
                safeName,
                {},
                ModSourceRecord{L"local"});
            logger_.writeOperation(
                LogLevel::Info,
                "ModCreate",
                "Created empty mod path=\"" + toUtf8(targetDirectory.wstring()) + "\"");
            return entryFromRecord(record, deferredFileSummary());
        }
        catch (const std::exception& exception)
        {
            logger_.writeOperation(
                LogLevel::Error,
                "ModCreate",
                "Failed to create empty mod path=\"" + toUtf8(targetDirectory.wstring()) +
                    "\", reason=\"" + exception.what() + "\"");
            std::error_code cleanupError;
            std::filesystem::remove_all(targetDirectory, cleanupError);
            throw;
        }
    }

    void ModService::deleteInstalledMod(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath) const
    {
        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        const std::filesystem::path directory = pathSettings_.modsDirectory(projectDirectory);
        if (!std::filesystem::exists(modPath))
        {
            throw std::invalid_argument("Mod does not exist.");
        }

        if (!std::filesystem::exists(directory) || !isPathInsideDirectory(modPath, directory))
        {
            throw std::invalid_argument("Mod path is outside the project mods directory.");
        }

        InstallProjectGate projectGate(projectDirectory);

        try
        {
            removeModFilesystemPath(modPath);
        }
        catch (const std::exception& exception)
        {
            logger_.write(
                LogLevel::Warning,
                "ModDelete",
                "Failed to delete installed mod path=\"" + toUtf8(modPath.wstring()) +
                    "\", error=\"" + exception.what() + "\"");
            throw;
        }

        InstanceMetadataStore::deleteInstalledMod(projectDirectory, modPath);
        logger_.write(
            LogLevel::Info,
            "ModDelete",
            "Deleted installed mod path=\"" + toUtf8(modPath.wstring()) + "\"");
    }

    void ModService::setInstalledModEnabled(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& modPath,
        bool isEnabled) const
    {
        if (projectDirectory.empty() || modPath.empty())
        {
            throw std::invalid_argument("Project directory and mod path are required.");
        }

        const std::filesystem::path directory = pathSettings_.modsDirectory(projectDirectory);
        if (!std::filesystem::exists(modPath))
        {
            throw std::invalid_argument("Mod does not exist.");
        }

        if (!std::filesystem::exists(directory) || !isPathInsideDirectory(modPath, directory))
        {
            throw std::invalid_argument("Mod path is outside the project mods directory.");
        }

        InstallProjectGate projectGate(projectDirectory);

        InstanceMetadataStore::setInstalledModEnabled(projectDirectory, modPath, isEnabled);
    }

    void ModService::setAllInstalledModsEnabled(
        const std::filesystem::path& projectDirectory,
        bool isEnabled) const
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        InstallProjectGate projectGate(projectDirectory);

        InstanceMetadataStore::setAllInstalledModsEnabled(
            projectDirectory,
            isEnabled,
            pathSettings_.modsDirectory(projectDirectory));
    }

    void ModService::clearOverwriteFolder(
        const std::filesystem::path& projectDirectory) const
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        const BuildPathSettings settings = pathSettings_.loadForProjectDirectory(projectDirectory);
        const std::filesystem::path overwriteDirectory = settings.overwriteDirectory;
        if (overwriteDirectory.empty())
        {
            throw std::invalid_argument("Overwrite directory is required.");
        }

        if (isSameFilesystemPath(overwriteDirectory, projectDirectory) ||
            isSameFilesystemPath(overwriteDirectory, settings.modsDirectory) ||
            isSameFilesystemPath(overwriteDirectory, settings.profilesDirectory) ||
            isSameFilesystemPath(overwriteDirectory, settings.downloadsDirectory) ||
            isSameFilesystemPath(overwriteDirectory, settings.gameDirectory))
        {
            throw std::invalid_argument("Overwrite directory must be a dedicated folder.");
        }

        const PathSafetyService safety;
        safety.validateDirectoryWriteRoot(overwriteDirectory)
            .throwIfUnsafe("Overwrite directory is unsafe");

        InstallProjectGate projectGate(projectDirectory);
        std::filesystem::create_directories(overwriteDirectory);
        removeDirectoryContents(overwriteDirectory);
        std::filesystem::create_directories(overwriteDirectory);

        logger_.writeOperation(
            LogLevel::Info,
            "Overwrite",
            "Cleared overwrite folder path=\"" + toUtf8(overwriteDirectory.wstring()) + "\"");
    }

    bool ModService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
