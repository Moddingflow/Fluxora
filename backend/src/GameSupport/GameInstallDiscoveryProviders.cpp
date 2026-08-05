#include "FluxoraCore/GameSupport/GameInstallDiscoveryService.hpp"

#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"

#include <algorithm>
#include <charconv>
#include <cstdlib>
#include <fstream>
#include <limits>
#ifndef _WIN32
#include <codecvt>
#include <locale>
#endif
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::uintmax_t maximumMetadataFileBytes = 4ULL * 1024ULL * 1024ULL;
        constexpr std::wstring_view steamRegistryKey = L"Software\\Valve\\Steam";
        constexpr std::wstring_view uninstallRegistryKey =
            L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

        class FingerprintBuilder final
        {
        public:
            void append(std::wstring_view value) noexcept
            {
                for (const wchar_t character : value)
                {
                    hash_ ^= static_cast<std::uint64_t>(character);
                    hash_ *= 1099511628211ULL;
                }
                hash_ ^= 0xffU;
                hash_ *= 1099511628211ULL;
            }

            void append(std::int64_t value) noexcept
            {
                append(std::to_wstring(value));
            }

            [[nodiscard]] std::wstring finish() const
            {
                std::wostringstream stream;
                stream << std::hex << hash_;
                return stream.str();
            }

        private:
            std::uint64_t hash_{1469598103934665603ULL};
        };

        [[nodiscard]] std::wstring lowerAscii(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                if (character >= L'A' && character <= L'Z')
                {
                    return static_cast<wchar_t>(character - L'A' + L'a');
                }
                return character;
            });
            return value;
        }

        [[nodiscard]] std::wstring trim(std::wstring value)
        {
            const auto isSpace = [](wchar_t character)
            {
                return character == L' ' || character == L'\t' ||
                    character == L'\r' || character == L'\n';
            };
            while (!value.empty() && isSpace(value.front()))
            {
                value.erase(value.begin());
            }
            while (!value.empty() && isSpace(value.back()))
            {
                value.pop_back();
            }
            return value;
        }

        [[nodiscard]] std::wstring pathKey(const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::path absolute = std::filesystem::absolute(path, error).lexically_normal();
            std::wstring value = absolute.wstring();
#ifdef _WIN32
            value = lowerAscii(std::move(value));
#endif
            return value;
        }

        [[nodiscard]] bool isBoundedLocalMetadataPath(
            const std::filesystem::path& path) noexcept
        {
#ifdef _WIN32
            if (path.empty() || path.native().starts_with(L"\\\\"))
            {
                return false;
            }
            const std::filesystem::path root = path.root_path();
            if (root.empty())
            {
                return false;
            }
            const UINT type = GetDriveTypeW(root.c_str());
            return type == DRIVE_FIXED || type == DRIVE_REMOVABLE ||
                type == DRIVE_CDROM || type == DRIVE_RAMDISK;
#else
            return !path.empty();
#endif
        }

        [[nodiscard]] std::int64_t fileFreshness(const std::filesystem::path& path) noexcept
        {
            std::error_code error;
            const auto value = std::filesystem::last_write_time(path, error);
            if (error)
            {
                return 0;
            }
            const auto count = value.time_since_epoch().count();
            if (count > (std::numeric_limits<std::int64_t>::max)())
            {
                return (std::numeric_limits<std::int64_t>::max)();
            }
            if (count < (std::numeric_limits<std::int64_t>::min)())
            {
                return (std::numeric_limits<std::int64_t>::min)();
            }
            return static_cast<std::int64_t>(count);
        }

        void appendFileStamp(FingerprintBuilder& fingerprint, const std::filesystem::path& path)
        {
            fingerprint.append(pathKey(path));
            if (!isBoundedLocalMetadataPath(path))
            {
                fingerprint.append(L"unavailable");
                return;
            }
            std::error_code error;
            if (!std::filesystem::is_regular_file(path, error) || error)
            {
                fingerprint.append(L"missing");
                return;
            }
            fingerprint.append(fileFreshness(path));
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            fingerprint.append(error ? -1 : static_cast<std::int64_t>(
                (std::min)(size, static_cast<std::uintmax_t>((std::numeric_limits<std::int64_t>::max)()))));
        }

        struct MetadataFileEntry
        {
            std::filesystem::path path;
            std::wstring nameKey;
            std::int64_t freshness{0};
            std::uintmax_t size{0};
        };

        [[nodiscard]] std::wstring metadataFileNameKey(const std::filesystem::path& path)
        {
            std::wstring result = path.filename().wstring();
#ifdef _WIN32
            result = lowerAscii(std::move(result));
#endif
            return result;
        }

        [[nodiscard]] std::vector<MetadataFileEntry> metadataFiles(
            const std::filesystem::path& directory,
            std::wstring_view extension,
            bool& hadErrors)
        {
            std::vector<MetadataFileEntry> result;
            if (directory.empty())
            {
                return result;
            }
            if (!isBoundedLocalMetadataPath(directory))
            {
                hadErrors = true;
                return result;
            }
#ifdef _WIN32
            const std::filesystem::path pattern = directory / L"*";
            WIN32_FIND_DATAW data{};
            HANDLE search = FindFirstFileExW(
                pattern.c_str(),
                FindExInfoBasic,
                &data,
                FindExSearchNameMatch,
                nullptr,
                FIND_FIRST_EX_LARGE_FETCH);
            if (search == INVALID_HANDLE_VALUE)
            {
                const DWORD error = GetLastError();
                hadErrors = hadErrors ||
                    (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND);
                return result;
            }

            do
            {
                if ((data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0)
                {
                    continue;
                }
                const std::filesystem::path path = directory / data.cFileName;
                if (lowerAscii(path.extension().wstring()) != lowerAscii(std::wstring(extension)))
                {
                    continue;
                }
                ULARGE_INTEGER modified{};
                modified.LowPart = data.ftLastWriteTime.dwLowDateTime;
                modified.HighPart = data.ftLastWriteTime.dwHighDateTime;
                ULARGE_INTEGER size{};
                size.LowPart = data.nFileSizeLow;
                size.HighPart = data.nFileSizeHigh;
                result.push_back(MetadataFileEntry{
                    path,
                    metadataFileNameKey(path),
                    static_cast<std::int64_t>(modified.QuadPart),
                    static_cast<std::uintmax_t>(size.QuadPart)});
            } while (FindNextFileW(search, &data) != 0);

            if (GetLastError() != ERROR_NO_MORE_FILES)
            {
                hadErrors = true;
            }
            FindClose(search);
#else
            std::error_code error;
            if (!std::filesystem::is_directory(directory, error) || error)
            {
                hadErrors = hadErrors || static_cast<bool>(error);
                return result;
            }
            for (const auto& entry : std::filesystem::directory_iterator(
                     directory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    hadErrors = true;
                    break;
                }
                std::error_code statusError;
                if (!entry.is_regular_file(statusError))
                {
                    hadErrors = hadErrors || static_cast<bool>(statusError);
                    continue;
                }
                if (lowerAscii(entry.path().extension().wstring()) !=
                    lowerAscii(std::wstring(extension)))
                {
                    continue;
                }
                const std::uintmax_t size = entry.file_size(statusError);
                result.push_back(MetadataFileEntry{
                    entry.path(),
                    metadataFileNameKey(entry.path()),
                    fileFreshness(entry.path()),
                    statusError ? 0U : size});
                hadErrors = hadErrors || static_cast<bool>(statusError);
            }
#endif
            std::sort(result.begin(), result.end(), [](const auto& left, const auto& right)
            {
                return left.nameKey < right.nameKey;
            });
            return result;
        }

        [[nodiscard]] std::wstring decodeUtf8(const std::string& bytes)
        {
#ifdef _WIN32
            if (bytes.empty())
            {
                return {};
            }
            if (bytes.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)()))
            {
                throw std::runtime_error("Metadata file is too large to decode.");
            }
            const int required = MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                bytes.data(),
                static_cast<int>(bytes.size()),
                nullptr,
                0);
            if (required <= 0)
            {
                throw std::runtime_error("Metadata file is not valid UTF-8.");
            }
            std::wstring result(static_cast<std::size_t>(required), L'\0');
            if (MultiByteToWideChar(
                    CP_UTF8,
                    MB_ERR_INVALID_CHARS,
                    bytes.data(),
                    static_cast<int>(bytes.size()),
                    result.data(),
                    required) != required)
            {
                throw std::runtime_error("Metadata file is not valid UTF-8.");
            }
            return result;
#else
            try
            {
                std::wstring_convert<std::codecvt_utf8_utf16<wchar_t>> converter;
                return converter.from_bytes(bytes);
            }
            catch (const std::range_error&)
            {
                throw std::runtime_error("Metadata file is not valid UTF-8.");
            }
#endif
        }

        [[nodiscard]] std::wstring readMetadataText(const std::filesystem::path& path)
        {
            std::error_code error;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            if (error || size > maximumMetadataFileBytes)
            {
                throw std::runtime_error("Metadata file is unavailable or too large.");
            }

            std::ifstream file(path, std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Metadata file could not be opened.");
            }
            const std::string bytes{
                std::istreambuf_iterator<char>(file),
                std::istreambuf_iterator<char>()};
            return decodeUtf8(bytes);
        }

        [[nodiscard]] std::wstring unescapeVdf(std::wstring value)
        {
            std::wstring result;
            result.reserve(value.size());
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                if (value[index] == L'\\' && index + 1U < value.size() &&
                    (value[index + 1U] == L'\\' || value[index + 1U] == L'"'))
                {
                    result.push_back(value[++index]);
                    continue;
                }
                result.push_back(value[index]);
            }
            return result;
        }

        enum class VdfTokenKind
        {
            String,
            ObjectBegin,
            ObjectEnd
        };

        struct VdfToken
        {
            VdfTokenKind kind;
            std::wstring value;
        };

        struct VdfEntry
        {
            std::wstring key;
            std::optional<std::wstring> value;
            std::vector<VdfEntry> children;
        };

        [[nodiscard]] bool isDecimal(std::wstring_view value) noexcept;

        [[nodiscard]] std::vector<VdfToken> vdfTokens(std::wstring_view text)
        {
            std::vector<VdfToken> result;
            for (std::size_t index = 0; index < text.size();)
            {
                const wchar_t character = text[index];
                if (character == L' ' || character == L'\t' ||
                    character == L'\r' || character == L'\n')
                {
                    ++index;
                    continue;
                }
                if (character == L'/' && index + 1U < text.size() && text[index + 1U] == L'/')
                {
                    index += 2U;
                    while (index < text.size() && text[index] != L'\r' && text[index] != L'\n')
                    {
                        ++index;
                    }
                    continue;
                }
                if (character == L'{')
                {
                    result.push_back(VdfToken{VdfTokenKind::ObjectBegin, {}});
                    ++index;
                    continue;
                }
                if (character == L'}')
                {
                    result.push_back(VdfToken{VdfTokenKind::ObjectEnd, {}});
                    ++index;
                    continue;
                }
                if (character != L'"')
                {
                    throw std::runtime_error("VDF contains an unexpected token.");
                }

                ++index;
                std::wstring value;
                bool terminated = false;
                while (index < text.size())
                {
                    const wchar_t current = text[index++];
                    if (current == L'"')
                    {
                        terminated = true;
                        break;
                    }
                    if (current == L'\\' && index < text.size() &&
                        (text[index] == L'\\' || text[index] == L'"'))
                    {
                        value.push_back(text[index++]);
                        continue;
                    }
                    value.push_back(current);
                }
                if (!terminated)
                {
                    throw std::runtime_error("VDF contains an unterminated string.");
                }
                result.push_back(VdfToken{VdfTokenKind::String, std::move(value)});
            }
            return result;
        }

        [[nodiscard]] std::vector<VdfEntry> parseVdfEntries(
            const std::vector<VdfToken>& tokens,
            std::size_t& index,
            std::size_t depth,
            bool nested)
        {
            constexpr std::size_t maximumVdfDepth = 64U;
            if (depth > maximumVdfDepth)
            {
                throw std::runtime_error("VDF nesting is too deep.");
            }

            std::vector<VdfEntry> result;
            while (index < tokens.size())
            {
                if (tokens[index].kind == VdfTokenKind::ObjectEnd)
                {
                    if (!nested)
                    {
                        throw std::runtime_error("VDF contains an unexpected closing brace.");
                    }
                    ++index;
                    return result;
                }
                if (tokens[index].kind != VdfTokenKind::String)
                {
                    throw std::runtime_error("VDF entry key is missing.");
                }

                VdfEntry entry;
                entry.key = lowerAscii(tokens[index++].value);
                if (index >= tokens.size())
                {
                    throw std::runtime_error("VDF entry value is missing.");
                }
                if (tokens[index].kind == VdfTokenKind::String)
                {
                    entry.value = tokens[index++].value;
                }
                else if (tokens[index].kind == VdfTokenKind::ObjectBegin)
                {
                    ++index;
                    entry.children = parseVdfEntries(tokens, index, depth + 1U, true);
                }
                else
                {
                    throw std::runtime_error("VDF entry value is invalid.");
                }
                result.push_back(std::move(entry));
            }

            if (nested)
            {
                throw std::runtime_error("VDF object is not closed.");
            }
            return result;
        }

        [[nodiscard]] std::vector<std::filesystem::path> steamLibraryPaths(
            std::wstring_view text)
        {
            const std::vector<VdfToken> tokens = vdfTokens(text);
            std::size_t index = 0;
            const std::vector<VdfEntry> root = parseVdfEntries(tokens, index, 0U, false);
            const auto libraryFolders = std::find_if(root.begin(), root.end(), [](const VdfEntry& entry)
            {
                return entry.key == L"libraryfolders";
            });
            if (libraryFolders == root.end())
            {
                return {};
            }

            std::vector<std::filesystem::path> result;
            for (const VdfEntry& library : libraryFolders->children)
            {
                if (!isDecimal(library.key))
                {
                    continue;
                }
                if (library.value.has_value())
                {
                    result.emplace_back(*library.value);
                    continue;
                }
                const auto path = std::find_if(
                    library.children.begin(),
                    library.children.end(),
                    [](const VdfEntry& entry)
                    {
                        return entry.key == L"path" && entry.value.has_value();
                    });
                if (path != library.children.end())
                {
                    result.emplace_back(*path->value);
                }
            }
            return result;
        }

        [[nodiscard]] std::vector<std::pair<std::wstring, std::wstring>> vdfPairs(
            std::wstring_view text)
        {
            static const std::wregex pairPattern(
                LR"vdf("((?:\\.|[^"\\])*)"\s*"((?:\\.|[^"\\])*)")vdf",
                std::regex::ECMAScript);
            const std::wstring owned(text);
            std::vector<std::pair<std::wstring, std::wstring>> result;
            for (std::wsregex_iterator iterator(owned.begin(), owned.end(), pairPattern), end;
                 iterator != end;
                 ++iterator)
            {
                result.emplace_back(
                    lowerAscii(unescapeVdf((*iterator)[1].str())),
                    unescapeVdf((*iterator)[2].str()));
            }
            return result;
        }

        [[nodiscard]] bool isDecimal(std::wstring_view value) noexcept
        {
            return !value.empty() && std::all_of(value.begin(), value.end(), [](wchar_t character)
            {
                return character >= L'0' && character <= L'9';
            });
        }

        void addUniquePath(
            std::vector<std::filesystem::path>& paths,
            std::set<std::wstring>& seen,
            const std::filesystem::path& path)
        {
            if (!path.empty() && seen.insert(pathKey(path)).second)
            {
                paths.push_back(path);
            }
        }

        [[nodiscard]] std::vector<std::filesystem::path> steamRoots(
            const IGameInstallRegistry& registry)
        {
            std::vector<std::filesystem::path> roots;
            std::set<std::wstring> seen;
            const auto read = [&](GameInstallRegistryHive hive, GameInstallRegistryView view,
                                  std::wstring_view valueName)
            {
                const std::optional<std::wstring> value = registry.readString(
                    hive,
                    view,
                    steamRegistryKey,
                    valueName);
                if (value.has_value())
                {
                    addUniquePath(roots, seen, std::filesystem::path(trim(*value)));
                }
            };

            read(GameInstallRegistryHive::CurrentUser, GameInstallRegistryView::Default, L"SteamPath");
            read(GameInstallRegistryHive::CurrentUser, GameInstallRegistryView::Default, L"InstallPath");
            read(GameInstallRegistryHive::LocalMachine, GameInstallRegistryView::Registry32, L"InstallPath");
            read(GameInstallRegistryHive::LocalMachine, GameInstallRegistryView::Registry64, L"InstallPath");
            return roots;
        }

        [[nodiscard]] std::vector<std::filesystem::path> steamLibraries(
            const std::filesystem::path& steamRoot,
            bool& hadErrors)
        {
            std::vector<std::filesystem::path> libraries;
            std::set<std::wstring> seen;
            addUniquePath(libraries, seen, steamRoot);
            const std::filesystem::path libraryFolders =
                steamRoot / "steamapps" / "libraryfolders.vdf";
            std::error_code error;
            if (!std::filesystem::exists(libraryFolders, error) || error)
            {
                return libraries;
            }

            try
            {
                const auto declaredLibraries = steamLibraryPaths(readMetadataText(libraryFolders));
                for (const std::filesystem::path& library : declaredLibraries)
                {
                    addUniquePath(libraries, seen, library);
                }
                if (declaredLibraries.empty())
                {
                    hadErrors = true;
                }
            }
            catch (const std::exception&)
            {
                hadErrors = true;
            }
            return libraries;
        }

        [[nodiscard]] std::optional<std::wstring> vdfValue(
            std::wstring_view text,
            std::wstring_view requestedKey)
        {
            const std::wstring normalized = lowerAscii(std::wstring(requestedKey));
            const auto pairs = vdfPairs(text);
            const auto found = std::find_if(pairs.begin(), pairs.end(), [&](const auto& pair)
            {
                return pair.first == normalized;
            });
            return found == pairs.end()
                ? std::nullopt
                : std::optional<std::wstring>(found->second);
        }

        [[nodiscard]] std::optional<std::wstring> jsonString(
            const JsonValue& object,
            std::wstring_view field)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || !value->isString())
            {
                return std::nullopt;
            }
            const std::wstring text = trim(value->asString());
            return text.empty() ? std::nullopt : std::optional<std::wstring>(text);
        }

        [[nodiscard]] bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return lowerAscii(std::wstring(left)) == lowerAscii(std::wstring(right));
        }

        [[nodiscard]] const GameExecutableDefinition* primaryExecutableFor(
            const GameDefinition& definition)
        {
            const auto found = std::find_if(
                definition.executables.begin(),
                definition.executables.end(),
                [](const GameExecutableDefinition& executable)
                {
                    return executable.role == GameExecutableRole::Primary;
                });
            return found == definition.executables.end() ? nullptr : &*found;
        }

        class FluxoraInstallProvider final : public IGameInstallDiscoveryProvider
        {
        public:
            explicit FluxoraInstallProvider(const ProjectService& projects) noexcept
                : projects_(projects)
            {
            }

            [[nodiscard]] GameInstallDiscoveryProviderId id() const noexcept override
            {
                return GameInstallDiscoveryProviderId::Fluxora;
            }

            [[nodiscard]] std::wstring fingerprint(
                const GameDefinition&,
                const GameInstallDiscoveryRequest& request) const override
            {
                FingerprintBuilder fingerprint;
                std::error_code error;
                if (request.buildConfigsDirectory.empty() ||
                    !isBoundedLocalMetadataPath(request.buildConfigsDirectory) ||
                    !std::filesystem::is_directory(request.buildConfigsDirectory, error) || error)
                {
                    fingerprint.append(L"missing");
                    return fingerprint.finish();
                }
                for (const auto& entry : std::filesystem::directory_iterator(
                         request.buildConfigsDirectory,
                         std::filesystem::directory_options::skip_permission_denied,
                         error))
                {
                    if (error)
                    {
                        break;
                    }
                    std::error_code statusError;
                    if (entry.is_regular_file(statusError) &&
                        lowerAscii(entry.path().extension().wstring()) == L".json")
                    {
                        appendFileStamp(fingerprint, entry.path());
                    }
                }
                return fingerprint.finish();
            }

            [[nodiscard]] GameInstallProviderScan scan(
                const GameDefinition& definition,
                const GameInstallDiscoveryRequest& request) const override
            {
                GameInstallProviderScan result;
                if (!isBoundedLocalMetadataPath(request.buildConfigsDirectory))
                {
                    result.hadErrors = true;
                    return result;
                }
                for (const ProjectOpenResult& project :
                     projects_.listProjectConfigSummaries(request.buildConfigsDirectory))
                {
                    if (project.project.templateId == definition.uiTemplateId.value() ||
                        project.project.templateId == definition.id.value())
                    {
                        if (!isBoundedLocalMetadataPath(project.project.gamePath))
                        {
                            result.hadErrors = true;
                            continue;
                        }
                        result.candidates.push_back(GameInstallDiscoveryCandidate{
                            project.project.gamePath,
                            fileFreshness(project.project.configPath)});
                    }
                }
                return result;
            }

        private:
            const ProjectService& projects_;
        };

        class SteamInstallProvider final : public IGameInstallDiscoveryProvider
        {
        public:
            explicit SteamInstallProvider(std::shared_ptr<const IGameInstallRegistry> registry)
                : registry_(std::move(registry))
            {
                if (registry_ == nullptr)
                {
                    throw std::invalid_argument("Steam install discovery requires a registry adapter.");
                }
            }

            [[nodiscard]] GameInstallDiscoveryProviderId id() const noexcept override
            {
                return GameInstallDiscoveryProviderId::Steam;
            }

            [[nodiscard]] std::wstring fingerprint(
                const GameDefinition& definition,
                const GameInstallDiscoveryRequest&) const override
            {
                FingerprintBuilder result;
                for (const std::filesystem::path& root : steamRoots(*registry_))
                {
                    if (!isBoundedLocalMetadataPath(root))
                    {
                        result.append(L"unavailable");
                        continue;
                    }
                    result.append(pathKey(root));
                    const std::filesystem::path libraryFolders =
                        root / "steamapps" / "libraryfolders.vdf";
                    appendFileStamp(result, libraryFolders);
                    bool ignored = false;
                    for (const std::filesystem::path& library : steamLibraries(root, ignored))
                    {
                        if (!isBoundedLocalMetadataPath(library))
                        {
                            result.append(L"unavailable");
                            continue;
                        }
                        for (const auto& provider : definition.installDiscovery.providers)
                        {
                            if (provider.id != id())
                            {
                                continue;
                            }
                            for (const std::wstring& productId : provider.productIds)
                            {
                                appendFileStamp(
                                    result,
                                    library / "steamapps" /
                                        std::filesystem::path(L"appmanifest_" + productId + L".acf"));
                            }
                        }
                    }
                }
                return result.finish();
            }

            [[nodiscard]] GameInstallProviderScan scan(
                const GameDefinition& definition,
                const GameInstallDiscoveryRequest&) const override
            {
                GameInstallProviderScan result;
                std::set<std::wstring> seen;
                for (const std::filesystem::path& root : steamRoots(*registry_))
                {
                    if (!isBoundedLocalMetadataPath(root))
                    {
                        result.hadErrors = true;
                        continue;
                    }
                    const auto libraries = steamLibraries(root, result.hadErrors);
                    for (const std::filesystem::path& library : libraries)
                    {
                        if (!isBoundedLocalMetadataPath(library))
                        {
                            result.hadErrors = true;
                            continue;
                        }
                        for (const auto& declared : definition.installDiscovery.providers)
                        {
                            if (declared.id != id())
                            {
                                continue;
                            }
                            for (const std::wstring& productId : declared.productIds)
                            {
                                const std::filesystem::path manifest =
                                    library / "steamapps" /
                                    std::filesystem::path(L"appmanifest_" + productId + L".acf");
                                std::error_code error;
                                if (!std::filesystem::is_regular_file(manifest, error) || error)
                                {
                                    continue;
                                }
                                try
                                {
                                    const std::optional<std::wstring> installDir =
                                        vdfValue(readMetadataText(manifest), L"installdir");
                                    if (!installDir.has_value())
                                    {
                                        result.hadErrors = true;
                                        continue;
                                    }
                                    const std::filesystem::path installPath =
                                        library / "steamapps" / "common" / *installDir;
                                    if (seen.insert(pathKey(installPath)).second)
                                    {
                                        result.candidates.push_back(GameInstallDiscoveryCandidate{
                                            installPath,
                                            fileFreshness(manifest)});
                                    }
                                }
                                catch (const std::exception&)
                                {
                                    result.hadErrors = true;
                                }
                            }
                        }
                    }
                }
                return result;
            }

        private:
            std::shared_ptr<const IGameInstallRegistry> registry_;
        };

        class GogInstallProvider final : public IGameInstallDiscoveryProvider
        {
        public:
            explicit GogInstallProvider(std::shared_ptr<const IGameInstallRegistry> registry)
                : registry_(std::move(registry))
            {
                if (registry_ == nullptr)
                {
                    throw std::invalid_argument("GOG install discovery requires a registry adapter.");
                }
            }

            [[nodiscard]] GameInstallDiscoveryProviderId id() const noexcept override
            {
                return GameInstallDiscoveryProviderId::Gog;
            }

            [[nodiscard]] std::wstring fingerprint(
                const GameDefinition& definition,
                const GameInstallDiscoveryRequest&) const override
            {
                FingerprintBuilder result;
                visit(definition, [&](GameInstallRegistryView view, const std::wstring& key)
                {
                    result.append(static_cast<std::int64_t>(view));
                    result.append(registry_->lastWriteTime(
                        GameInstallRegistryHive::LocalMachine,
                        view,
                        key));
                    const auto path = registry_->readString(
                        GameInstallRegistryHive::LocalMachine,
                        view,
                        key,
                        L"path");
                    if (path.has_value())
                    {
                        result.append(*path);
                    }
                    else
                    {
                        result.append(registry_->readString(
                            GameInstallRegistryHive::LocalMachine,
                            view,
                            key,
                            L"PATH").value_or(L""));
                    }
                });
                return result.finish();
            }

            [[nodiscard]] GameInstallProviderScan scan(
                const GameDefinition& definition,
                const GameInstallDiscoveryRequest&) const override
            {
                GameInstallProviderScan result;
                std::set<std::wstring> seen;
                visit(definition, [&](GameInstallRegistryView view, const std::wstring& key)
                {
                    std::optional<std::wstring> path = registry_->readString(
                        GameInstallRegistryHive::LocalMachine,
                        view,
                        key,
                        L"path");
                    if (!path.has_value())
                    {
                        path = registry_->readString(
                            GameInstallRegistryHive::LocalMachine,
                            view,
                            key,
                            L"PATH");
                    }
                    if (path.has_value() && seen.insert(pathKey(*path)).second)
                    {
                        if (!isBoundedLocalMetadataPath(std::filesystem::path(trim(*path))))
                        {
                            result.hadErrors = true;
                            return;
                        }
                        result.candidates.push_back(GameInstallDiscoveryCandidate{
                            std::filesystem::path(trim(*path)),
                            registry_->lastWriteTime(
                                GameInstallRegistryHive::LocalMachine,
                                view,
                                key)});
                    }
                });
                return result;
            }

        private:
            template <typename Callback>
            void visit(const GameDefinition& definition, Callback callback) const
            {
                for (const auto& declared : definition.installDiscovery.providers)
                {
                    if (declared.id != id())
                    {
                        continue;
                    }
                    for (const std::wstring& productId : declared.productIds)
                    {
                        const std::wstring key = L"SOFTWARE\\GOG.com\\Games\\" + productId;
                        callback(GameInstallRegistryView::Registry32, key);
                        callback(GameInstallRegistryView::Registry64, key);
                    }
                }
            }

            std::shared_ptr<const IGameInstallRegistry> registry_;
        };

        class EpicInstallProvider final : public IGameInstallDiscoveryProvider
        {
        public:
            explicit EpicInstallProvider(GameInstallDiscoverySystemPaths paths)
                : paths_(std::move(paths))
            {
            }

            [[nodiscard]] GameInstallDiscoveryProviderId id() const noexcept override
            {
                return GameInstallDiscoveryProviderId::Epic;
            }

            [[nodiscard]] std::wstring fingerprint(
                const GameDefinition&,
                const GameInstallDiscoveryRequest&) const override
            {
                FingerprintBuilder result;
                bool hadErrors = false;
                for (const MetadataFileEntry& manifest : manifests(hadErrors))
                {
                    result.append(manifest.nameKey);
                    result.append(manifest.freshness);
                    result.append(static_cast<std::int64_t>((std::min)(
                        manifest.size,
                        static_cast<std::uintmax_t>((std::numeric_limits<std::int64_t>::max)()))));
                }
                result.append(hadErrors ? L"error" : L"ok");
                return result.finish();
            }

            [[nodiscard]] GameInstallProviderScan scan(
                const GameDefinition& definition,
                const GameInstallDiscoveryRequest&) const override
            {
                std::set<std::wstring> declaredIds;
                for (const auto& declared : definition.installDiscovery.providers)
                {
                    if (declared.id == id())
                    {
                        declaredIds.insert(declared.productIds.begin(), declared.productIds.end());
                    }
                }

                GameInstallProviderScan result;
                std::set<std::wstring> seen;
                const std::vector<MetadataFileEntry> manifestFiles = manifests(result.hadErrors);
                for (const MetadataFileEntry& manifest : manifestFiles)
                {
                    try
                    {
                        const JsonValue root = JsonReader::parse(readMetadataText(manifest.path));
                        if (!root.isObject())
                        {
                            throw std::runtime_error("Epic manifest root is not an object.");
                        }
                        bool matches = false;
                        for (std::wstring_view field :
                             {L"AppName", L"CatalogItemId", L"MainGameCatalogItemId"})
                        {
                            const auto value = jsonString(root, field);
                            matches = matches ||
                                (value.has_value() && declaredIds.contains(*value));
                        }
                        if (!matches)
                        {
                            continue;
                        }
                        const auto installLocation = jsonString(root, L"InstallLocation");
                        if (!installLocation.has_value())
                        {
                            result.hadErrors = true;
                            continue;
                        }
                        if (!isBoundedLocalMetadataPath(std::filesystem::path(*installLocation)))
                        {
                            result.hadErrors = true;
                            continue;
                        }
                        if (seen.insert(pathKey(*installLocation)).second)
                        {
                            result.candidates.push_back(GameInstallDiscoveryCandidate{
                                std::filesystem::path(*installLocation),
                                manifest.freshness});
                        }
                    }
                    catch (const std::exception&)
                    {
                        result.hadErrors = true;
                    }
                }
                return result;
            }

        private:
            [[nodiscard]] std::vector<MetadataFileEntry> manifests(bool& hadErrors) const
            {
                return metadataFiles(paths_.epicManifestDirectory, L".item", hadErrors);
            }

            GameInstallDiscoverySystemPaths paths_;
        };

        [[nodiscard]] std::filesystem::path displayIconPath(std::wstring value)
        {
            value = trim(std::move(value));
            if (value.empty())
            {
                return {};
            }
            if (value.front() == L'"')
            {
                const std::size_t closing = value.find(L'"', 1U);
                if (closing != std::wstring::npos)
                {
                    return std::filesystem::path(value.substr(1U, closing - 1U));
                }
            }
            const std::size_t comma = value.rfind(L',');
            if (comma != std::wstring::npos)
            {
                const std::wstring suffix = trim(value.substr(comma + 1U));
                const std::size_t firstDigit =
                    !suffix.empty() && suffix.front() == L'-' ? 1U : 0U;
                const bool numeric = firstDigit < suffix.size() && std::all_of(
                    suffix.begin() + static_cast<std::wstring::difference_type>(firstDigit),
                    suffix.end(),
                    [](wchar_t character) { return character >= L'0' && character <= L'9'; });
                if (numeric)
                {
                    value.resize(comma);
                }
            }
            return std::filesystem::path(trim(std::move(value)));
        }

        class WindowsInstallProvider final : public IGameInstallDiscoveryProvider
        {
        public:
            explicit WindowsInstallProvider(std::shared_ptr<const IGameInstallRegistry> registry)
                : registry_(std::move(registry))
            {
                if (registry_ == nullptr)
                {
                    throw std::invalid_argument("Windows install discovery requires a registry adapter.");
                }
            }

            [[nodiscard]] GameInstallDiscoveryProviderId id() const noexcept override
            {
                return GameInstallDiscoveryProviderId::Windows;
            }

            [[nodiscard]] std::wstring fingerprint(
                const GameDefinition&,
                const GameInstallDiscoveryRequest&) const override
            {
                FingerprintBuilder result;
                forEachRoot([&](GameInstallRegistryHive hive, GameInstallRegistryView view)
                {
                    result.append(static_cast<std::int64_t>(hive));
                    result.append(static_cast<std::int64_t>(view));
                    for (const GameInstallRegistrySubkey& subkey :
                         registry_->listSubkeys(hive, view, uninstallRegistryKey))
                    {
                        result.append(subkey.name);
                        result.append(subkey.lastWriteTime);
                    }
                });
                return result.finish();
            }

            [[nodiscard]] GameInstallProviderScan scan(
                const GameDefinition& definition,
                const GameInstallDiscoveryRequest&) const override
            {
                GameInstallProviderScan result;
                const GameExecutableDefinition* primary = primaryExecutableFor(definition);
                if (primary == nullptr)
                {
                    result.hadErrors = true;
                    return result;
                }
                std::vector<std::wstring> displayNames = definition.aliases;
                displayNames.push_back(definition.displayName);
                std::set<std::wstring> seen;

                forEachRoot([&](GameInstallRegistryHive hive, GameInstallRegistryView view)
                {
                    for (const GameInstallRegistrySubkey& subkey :
                         registry_->listSubkeys(hive, view, uninstallRegistryKey))
                    {
                        const std::wstring key =
                            std::wstring(uninstallRegistryKey) + L"\\" + subkey.name;
                        const auto displayIcon = registry_->readString(
                            hive, view, key, L"DisplayIcon");
                        const auto installLocation = registry_->readString(
                            hive, view, key, L"InstallLocation");
                        const auto displayName = registry_->readString(
                            hive, view, key, L"DisplayName");
                        const std::filesystem::path iconPath = displayIcon.has_value()
                            ? displayIconPath(*displayIcon)
                            : std::filesystem::path{};
                        const bool iconMatches = !iconPath.empty() &&
                            equalsIgnoreCase(
                                iconPath.filename().wstring(),
                                primary->name.displayName());
                        const bool nameMatches = displayName.has_value() && std::any_of(
                            displayNames.begin(),
                            displayNames.end(),
                            [&](const std::wstring& expected)
                            {
                                return equalsIgnoreCase(*displayName, expected);
                            });
                        std::filesystem::path candidate;
                        if (iconMatches)
                        {
                            candidate = iconPath;
                        }
                        else if (nameMatches && installLocation.has_value())
                        {
                            candidate = std::filesystem::path(trim(*installLocation));
                        }
                        if (!candidate.empty() && seen.insert(pathKey(candidate)).second)
                        {
                            if (!isBoundedLocalMetadataPath(candidate))
                            {
                                result.hadErrors = true;
                                continue;
                            }
                            result.candidates.push_back(GameInstallDiscoveryCandidate{
                                std::move(candidate),
                                subkey.lastWriteTime});
                        }
                    }
                });
                return result;
            }

        private:
            template <typename Callback>
            static void forEachRoot(Callback callback)
            {
                callback(GameInstallRegistryHive::LocalMachine, GameInstallRegistryView::Registry64);
                callback(GameInstallRegistryHive::LocalMachine, GameInstallRegistryView::Registry32);
                callback(GameInstallRegistryHive::CurrentUser, GameInstallRegistryView::Registry64);
                callback(GameInstallRegistryHive::CurrentUser, GameInstallRegistryView::Registry32);
            }

            std::shared_ptr<const IGameInstallRegistry> registry_;
        };

#ifdef _WIN32
        [[nodiscard]] REGSAM registryViewFlags(GameInstallRegistryView view) noexcept
        {
            switch (view)
            {
            case GameInstallRegistryView::Registry32:
                return KEY_WOW64_32KEY;
            case GameInstallRegistryView::Registry64:
                return KEY_WOW64_64KEY;
            case GameInstallRegistryView::Default:
                return 0;
            }
            return 0;
        }

        [[nodiscard]] HKEY registryHive(GameInstallRegistryHive hive) noexcept
        {
            return hive == GameInstallRegistryHive::CurrentUser
                ? HKEY_CURRENT_USER
                : HKEY_LOCAL_MACHINE;
        }

        [[nodiscard]] std::int64_t fileTimeValue(const FILETIME& value) noexcept
        {
            ULARGE_INTEGER combined{};
            combined.LowPart = value.dwLowDateTime;
            combined.HighPart = value.dwHighDateTime;
            return static_cast<std::int64_t>(combined.QuadPart);
        }

        [[nodiscard]] bool registryValueIsMissing(LSTATUS status) noexcept
        {
            return status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND;
        }

        [[noreturn]] void throwRegistryError(LSTATUS status, const char* operation)
        {
            throw std::system_error(
                static_cast<int>(status),
                std::system_category(),
                operation);
        }

        class RegistryKey final
        {
        public:
            explicit RegistryKey(HKEY value = nullptr) noexcept : value_(value) {}
            RegistryKey(const RegistryKey&) = delete;
            RegistryKey& operator=(const RegistryKey&) = delete;
            ~RegistryKey()
            {
                if (value_ != nullptr)
                {
                    RegCloseKey(value_);
                }
            }
            [[nodiscard]] HKEY get() const noexcept { return value_; }

        private:
            HKEY value_{nullptr};
        };

        class SystemGameInstallRegistry final : public IGameInstallRegistry
        {
        public:
            [[nodiscard]] std::optional<std::wstring> readString(
                GameInstallRegistryHive hive,
                GameInstallRegistryView view,
                std::wstring_view keyPath,
                std::wstring_view valueName) const override
            {
                HKEY raw = nullptr;
                const std::wstring ownedKey(keyPath);
                const LSTATUS openStatus = RegOpenKeyExW(
                    registryHive(hive),
                    ownedKey.c_str(),
                    0,
                    KEY_QUERY_VALUE | registryViewFlags(view),
                    &raw);
                if (registryValueIsMissing(openStatus))
                {
                    return std::nullopt;
                }
                if (openStatus != ERROR_SUCCESS)
                {
                    throwRegistryError(openStatus, "RegOpenKeyExW for registry value");
                }
                RegistryKey key(raw);
                const std::wstring ownedValue(valueName);
                DWORD type = 0;
                DWORD bytes = 0;
                const LSTATUS sizeStatus = RegQueryValueExW(
                    key.get(),
                    ownedValue.c_str(),
                    nullptr,
                    &type,
                    nullptr,
                    &bytes);
                if (registryValueIsMissing(sizeStatus))
                {
                    return std::nullopt;
                }
                if (sizeStatus != ERROR_SUCCESS)
                {
                    throwRegistryError(sizeStatus, "RegQueryValueExW for registry value size");
                }
                if ((type != REG_SZ && type != REG_EXPAND_SZ) || bytes == 0 ||
                    bytes > maximumMetadataFileBytes)
                {
                    return std::nullopt;
                }
                std::wstring value((bytes / sizeof(wchar_t)) + 1U, L'\0');
                const LSTATUS readStatus = RegQueryValueExW(
                    key.get(),
                    ownedValue.c_str(),
                    nullptr,
                    &type,
                    reinterpret_cast<BYTE*>(value.data()),
                    &bytes);
                if (registryValueIsMissing(readStatus))
                {
                    return std::nullopt;
                }
                if (readStatus != ERROR_SUCCESS)
                {
                    throwRegistryError(readStatus, "RegQueryValueExW for registry value data");
                }
                const std::size_t terminator = value.find(L'\0');
                if (terminator != std::wstring::npos)
                {
                    value.resize(terminator);
                }
                if (type == REG_EXPAND_SZ)
                {
                    const DWORD required = ExpandEnvironmentStringsW(value.c_str(), nullptr, 0);
                    if (required > 0 && required < 32768U)
                    {
                        std::wstring expanded(required, L'\0');
                        const DWORD written = ExpandEnvironmentStringsW(
                            value.c_str(), expanded.data(), required);
                        if (written > 0 && written <= required)
                        {
                            expanded.resize(written - 1U);
                            value = std::move(expanded);
                        }
                    }
                }
                return value;
            }

            [[nodiscard]] std::vector<GameInstallRegistrySubkey> listSubkeys(
                GameInstallRegistryHive hive,
                GameInstallRegistryView view,
                std::wstring_view keyPath) const override
            {
                HKEY raw = nullptr;
                const std::wstring ownedKey(keyPath);
                const LSTATUS openStatus = RegOpenKeyExW(
                    registryHive(hive),
                    ownedKey.c_str(),
                    0,
                    KEY_ENUMERATE_SUB_KEYS | registryViewFlags(view),
                    &raw);
                if (registryValueIsMissing(openStatus))
                {
                    return {};
                }
                if (openStatus != ERROR_SUCCESS)
                {
                    throwRegistryError(openStatus, "RegOpenKeyExW for registry enumeration");
                }
                RegistryKey key(raw);
                DWORD subkeyCount = 0;
                DWORD maximumNameLength = 0;
                const LSTATUS infoStatus = RegQueryInfoKeyW(
                    key.get(), nullptr, nullptr, nullptr, &subkeyCount,
                    &maximumNameLength, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr);
                if (infoStatus != ERROR_SUCCESS)
                {
                    throwRegistryError(infoStatus, "RegQueryInfoKeyW for registry enumeration");
                }
                std::vector<GameInstallRegistrySubkey> result;
                result.reserve(subkeyCount);
                std::wstring name(maximumNameLength + 2U, L'\0');
                for (DWORD index = 0; index < subkeyCount; ++index)
                {
                    DWORD length = static_cast<DWORD>(name.size());
                    FILETIME lastWrite{};
                    const LSTATUS status = RegEnumKeyExW(
                        key.get(), index, name.data(), &length, nullptr, nullptr, nullptr, &lastWrite);
                    if (status == ERROR_SUCCESS)
                    {
                        result.push_back(GameInstallRegistrySubkey{
                            std::wstring(name.data(), length),
                            fileTimeValue(lastWrite)});
                    }
                    else if (status == ERROR_NO_MORE_ITEMS)
                    {
                        break;
                    }
                    else
                    {
                        throwRegistryError(status, "RegEnumKeyExW for registry enumeration");
                    }
                }
                return result;
            }

            [[nodiscard]] std::int64_t lastWriteTime(
                GameInstallRegistryHive hive,
                GameInstallRegistryView view,
                std::wstring_view keyPath) const override
            {
                HKEY raw = nullptr;
                const std::wstring ownedKey(keyPath);
                const LSTATUS openStatus = RegOpenKeyExW(
                    registryHive(hive),
                    ownedKey.c_str(),
                    0,
                    KEY_QUERY_VALUE | registryViewFlags(view),
                    &raw);
                if (registryValueIsMissing(openStatus))
                {
                    return 0;
                }
                if (openStatus != ERROR_SUCCESS)
                {
                    throwRegistryError(openStatus, "RegOpenKeyExW for registry timestamp");
                }
                RegistryKey key(raw);
                FILETIME lastWrite{};
                const LSTATUS infoStatus = RegQueryInfoKeyW(
                    key.get(), nullptr, nullptr, nullptr, nullptr, nullptr, nullptr,
                    nullptr, nullptr, nullptr, nullptr, &lastWrite);
                if (infoStatus != ERROR_SUCCESS)
                {
                    throwRegistryError(infoStatus, "RegQueryInfoKeyW for registry timestamp");
                }
                return fileTimeValue(lastWrite);
            }
        };
#else
        class SystemGameInstallRegistry final : public IGameInstallRegistry
        {
        public:
            [[nodiscard]] std::optional<std::wstring> readString(
                GameInstallRegistryHive, GameInstallRegistryView,
                std::wstring_view, std::wstring_view) const override { return std::nullopt; }
            [[nodiscard]] std::vector<GameInstallRegistrySubkey> listSubkeys(
                GameInstallRegistryHive, GameInstallRegistryView,
                std::wstring_view) const override { return {}; }
            [[nodiscard]] std::int64_t lastWriteTime(
                GameInstallRegistryHive, GameInstallRegistryView,
                std::wstring_view) const override { return 0; }
        };
#endif
    }

    std::shared_ptr<const IGameInstallRegistry> createSystemGameInstallRegistry()
    {
        return std::make_shared<SystemGameInstallRegistry>();
    }

    GameInstallDiscoverySystemPaths defaultGameInstallDiscoverySystemPaths()
    {
        GameInstallDiscoverySystemPaths result;
#ifdef _WIN32
        const DWORD required = GetEnvironmentVariableW(L"PROGRAMDATA", nullptr, 0);
        if (required > 0 && required < 32768U)
        {
            std::wstring programData(required, L'\0');
            const DWORD written = GetEnvironmentVariableW(
                L"PROGRAMDATA", programData.data(), required);
            if (written > 0 && written < required)
            {
                programData.resize(written);
                result.epicManifestDirectory = std::filesystem::path(programData) /
                    "Epic" / "EpicGamesLauncher" / "Data" / "Manifests";
            }
        }
#endif
        return result;
    }

    std::unique_ptr<IGameInstallDiscoveryProvider> createFluxoraGameInstallDiscoveryProvider(
        const ProjectService& projects)
    {
        return std::make_unique<FluxoraInstallProvider>(projects);
    }

    std::unique_ptr<IGameInstallDiscoveryProvider> createSteamGameInstallDiscoveryProvider(
        std::shared_ptr<const IGameInstallRegistry> registry)
    {
        return std::make_unique<SteamInstallProvider>(std::move(registry));
    }

    std::unique_ptr<IGameInstallDiscoveryProvider> createGogGameInstallDiscoveryProvider(
        std::shared_ptr<const IGameInstallRegistry> registry)
    {
        return std::make_unique<GogInstallProvider>(std::move(registry));
    }

    std::unique_ptr<IGameInstallDiscoveryProvider> createEpicGameInstallDiscoveryProvider(
        GameInstallDiscoverySystemPaths paths)
    {
        return std::make_unique<EpicInstallProvider>(std::move(paths));
    }

    std::unique_ptr<IGameInstallDiscoveryProvider> createWindowsGameInstallDiscoveryProvider(
        std::shared_ptr<const IGameInstallRegistry> registry)
    {
        return std::make_unique<WindowsInstallProvider>(std::move(registry));
    }

    std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>>
        createDefaultGameInstallDiscoveryProviders(const ProjectService& projects)
    {
        const auto registry = createSystemGameInstallRegistry();
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(createFluxoraGameInstallDiscoveryProvider(projects));
        providers.push_back(createSteamGameInstallDiscoveryProvider(registry));
        providers.push_back(createGogGameInstallDiscoveryProvider(registry));
        providers.push_back(createEpicGameInstallDiscoveryProvider(
            defaultGameInstallDiscoverySystemPaths()));
        providers.push_back(createWindowsGameInstallDiscoveryProvider(registry));
        return providers;
    }
}
