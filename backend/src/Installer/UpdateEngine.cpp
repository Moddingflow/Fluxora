#include "FluxoraInstaller/UpdateEngine.hpp"
#include "FluxoraInstaller/InstallerDirectoryTransaction.hpp"

#include "FluxoraCore/Support/JsonReader.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <charconv>
#include <cstdint>
#include <cwctype>
#include <fstream>
#include <iomanip>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <unordered_set>
#include <utility>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <bcrypt.h>
#include <wincrypt.h>

namespace
{
    constexpr std::size_t Sha256Bytes = 32;
    constexpr std::size_t P256SignatureBytes = 64;
    constexpr std::uintmax_t MaximumManifestBytes = 512ULL * 1024ULL;
    constexpr std::uint64_t MaximumAssetBytes = 16ULL * 1024ULL * 1024ULL * 1024ULL;
    constexpr std::size_t MaximumManifestPathBytes = 1024;
    constexpr std::size_t MaximumManifestFiles = 200000;
    constexpr std::size_t MaximumManifestAssets = 1024;

    struct ManifestFile final
    {
        std::string path;
        std::uint64_t size{0};
        std::string sha256;
    };

    struct ManifestAsset final
    {
        fluxora::installer::UpdateAssetKind kind{fluxora::installer::UpdateAssetKind::Full};
        std::optional<std::string> fromVersion;
        std::string url;
        std::uint64_t size{0};
        std::string sha256;
        std::optional<std::string> baseFileManifestSha256;
        std::string targetFileManifestSha256;
    };

    struct ParsedManifest final
    {
        std::string version;
        std::string target;
        std::wstring applicationExecutable;
        std::string fileManifestSha256;
        std::vector<ManifestFile> files;
        std::vector<ManifestAsset> assets;
    };

    bool utf8ByteLess(std::string_view left, std::string_view right)
    {
        return std::lexicographical_compare(
            left.begin(),
            left.end(),
            right.begin(),
            right.end(),
            [](char leftByte, char rightByte) {
                return static_cast<unsigned char>(leftByte) < static_cast<unsigned char>(rightByte);
            });
    }

    bool isInternalCommitSentinel(std::string_view path)
    {
        constexpr std::string_view prefix = ".fluxora-commit-";
        constexpr std::string_view suffix = ".pending";
        constexpr std::size_t transactionHexBytes = 32;
        if (path.size() != prefix.size() + transactionHexBytes + suffix.size() ||
            !path.starts_with(prefix) || !path.ends_with(suffix))
        {
            return false;
        }
        const std::string_view transactionId = path.substr(prefix.size(), transactionHexBytes);
        return std::all_of(transactionId.begin(), transactionId.end(), [](char value) {
            return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
        });
    }

    void requireNtSuccess(NTSTATUS status, const char* operation)
    {
        if (status < 0)
        {
            throw std::runtime_error(std::string("Windows cryptography failed during ") + operation + ".");
        }
    }

    class AlgorithmHandle final
    {
    public:
        explicit AlgorithmHandle(LPCWSTR algorithm)
        {
            requireNtSuccess(
                BCryptOpenAlgorithmProvider(&value_, algorithm, nullptr, 0),
                "algorithm initialization");
        }

        AlgorithmHandle(const AlgorithmHandle&) = delete;
        AlgorithmHandle& operator=(const AlgorithmHandle&) = delete;

        ~AlgorithmHandle()
        {
            if (value_ != nullptr)
            {
                BCryptCloseAlgorithmProvider(value_, 0);
            }
        }

        [[nodiscard]] BCRYPT_ALG_HANDLE get() const noexcept
        {
            return value_;
        }

    private:
        BCRYPT_ALG_HANDLE value_{nullptr};
    };

    class HashHandle final
    {
    public:
        explicit HashHandle(BCRYPT_ALG_HANDLE algorithm)
        {
            DWORD objectBytes = 0;
            DWORD resultBytes = 0;
            requireNtSuccess(
                BCryptGetProperty(
                    algorithm,
                    BCRYPT_OBJECT_LENGTH,
                    reinterpret_cast<PUCHAR>(&objectBytes),
                    sizeof(objectBytes),
                    &resultBytes,
                    0),
                "hash object sizing");
            object_.resize(objectBytes);
            requireNtSuccess(
                BCryptCreateHash(
                    algorithm,
                    &value_,
                    object_.data(),
                    static_cast<ULONG>(object_.size()),
                    nullptr,
                    0,
                    0),
                "hash initialization");
        }

        HashHandle(const HashHandle&) = delete;
        HashHandle& operator=(const HashHandle&) = delete;

        ~HashHandle()
        {
            if (value_ != nullptr)
            {
                BCryptDestroyHash(value_);
            }
        }

        [[nodiscard]] BCRYPT_HASH_HANDLE get() const noexcept
        {
            return value_;
        }

    private:
        BCRYPT_HASH_HANDLE value_{nullptr};
        std::vector<unsigned char> object_;
    };

    class KeyHandle final
    {
    public:
        explicit KeyHandle(BCRYPT_KEY_HANDLE value) noexcept
            : value_(value)
        {
        }

        KeyHandle(const KeyHandle&) = delete;
        KeyHandle& operator=(const KeyHandle&) = delete;

        KeyHandle(KeyHandle&& other) noexcept
            : value_(std::exchange(other.value_, nullptr))
        {
        }

        ~KeyHandle()
        {
            if (value_ != nullptr)
            {
                BCryptDestroyKey(value_);
            }
        }

        [[nodiscard]] BCRYPT_KEY_HANDLE get() const noexcept
        {
            return value_;
        }

    private:
        BCRYPT_KEY_HANDLE value_{nullptr};
    };

    std::array<unsigned char, Sha256Bytes> sha256(std::span<const std::byte> bytes)
    {
        if (bytes.size() > static_cast<std::size_t>(std::numeric_limits<ULONG>::max()))
        {
            throw std::runtime_error("Update manifest is too large to verify.");
        }

        AlgorithmHandle algorithm(BCRYPT_SHA256_ALGORITHM);
        HashHandle hash(algorithm.get());
        if (!bytes.empty())
        {
            requireNtSuccess(
                BCryptHashData(
                    hash.get(),
                    reinterpret_cast<PUCHAR>(const_cast<std::byte*>(bytes.data())),
                    static_cast<ULONG>(bytes.size()),
                    0),
                "manifest hashing");
        }

        std::array<unsigned char, Sha256Bytes> digest{};
        requireNtSuccess(
            BCryptFinishHash(hash.get(), digest.data(), static_cast<ULONG>(digest.size()), 0),
            "manifest hash finalization");
        return digest;
    }

    std::array<unsigned char, Sha256Bytes> sha256File(const std::filesystem::path& path)
    {
        std::ifstream input(path, std::ios::binary);
        if (!input)
        {
            throw std::runtime_error("Update package could not be opened.");
        }

        AlgorithmHandle algorithm(BCRYPT_SHA256_ALGORITHM);
        HashHandle hash(algorithm.get());
        std::array<char, 256 * 1024> buffer{};
        while (input)
        {
            input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
            const std::streamsize readBytes = input.gcount();
            if (readBytes > 0)
            {
                requireNtSuccess(
                    BCryptHashData(
                        hash.get(),
                        reinterpret_cast<PUCHAR>(buffer.data()),
                        static_cast<ULONG>(readBytes),
                        0),
                    "update package hashing");
            }
        }
        if (!input.eof())
        {
            throw std::runtime_error("Update package could not be read completely.");
        }

        std::array<unsigned char, Sha256Bytes> digest{};
        requireNtSuccess(
            BCryptFinishHash(hash.get(), digest.data(), static_cast<ULONG>(digest.size()), 0),
            "update package hash finalization");
        return digest;
    }

    std::string lowerHex(std::span<const unsigned char> bytes)
    {
        std::ostringstream output;
        output << std::hex << std::setfill('0');
        for (const unsigned char byte : bytes)
        {
            output << std::setw(2) << static_cast<unsigned int>(byte);
        }
        return output.str();
    }

    std::wstring utf8ToWide(std::span<const char> bytes, std::string_view label)
    {
        if (bytes.empty())
        {
            return {};
        }
        if (bytes.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
        {
            throw std::runtime_error(std::string(label) + " is too large.");
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
            throw std::runtime_error(std::string(label) + " is not valid UTF-8.");
        }

        std::wstring output(static_cast<std::size_t>(required), L'\0');
        if (MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                bytes.data(),
                static_cast<int>(bytes.size()),
                output.data(),
                required) != required)
        {
            throw std::runtime_error(std::string(label) + " could not be decoded.");
        }
        return output;
    }

    std::string wideToUtf8(std::wstring_view value, std::string_view label)
    {
        if (value.empty())
        {
            return {};
        }
        if (value.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
        {
            throw std::runtime_error(std::string(label) + " is too large.");
        }

        const int required = WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (required <= 0)
        {
            throw std::runtime_error(std::string(label) + " contains invalid Unicode.");
        }

        std::string output(static_cast<std::size_t>(required), '\0');
        if (WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                output.data(),
                required,
                nullptr,
                nullptr) != required)
        {
            throw std::runtime_error(std::string(label) + " could not be encoded.");
        }
        return output;
    }

    bool isLowerHexSha256(std::string_view value)
    {
        if (value.size() != Sha256Bytes * 2)
        {
            return false;
        }
        return std::all_of(value.begin(), value.end(), [](unsigned char character) {
            return (character >= '0' && character <= '9') ||
                (character >= 'a' && character <= 'f');
        });
    }

    bool isSemVersion(std::string_view value)
    {
        int components = 0;
        std::size_t start = 0;
        while (start < value.size())
        {
            const std::size_t end = value.find('.', start);
            const std::string_view component = value.substr(
                start,
                end == std::string_view::npos ? value.size() - start : end - start);
            if (component.empty() ||
                (component.size() > 1 && component.front() == '0') ||
                !std::all_of(component.begin(), component.end(), [](unsigned char character) {
                    return character >= '0' && character <= '9';
                }))
            {
                return false;
            }
            std::uint64_t parsed = 0;
            const auto result = std::from_chars(component.data(), component.data() + component.size(), parsed);
            if (result.ec != std::errc{} || result.ptr != component.data() + component.size())
            {
                return false;
            }
            ++components;
            if (end == std::string_view::npos)
            {
                break;
            }
            start = end + 1;
        }
        return components == 3;
    }

    std::array<std::uint64_t, 3> parseSemVersion(std::string_view value)
    {
        if (!isSemVersion(value))
        {
            throw std::runtime_error("Update version is not a supported semantic version.");
        }
        std::array<std::uint64_t, 3> parsed{};
        std::size_t start = 0;
        for (std::size_t index = 0; index < parsed.size(); ++index)
        {
            const std::size_t end = value.find('.', start);
            const std::string_view component = value.substr(
                start,
                end == std::string_view::npos ? value.size() - start : end - start);
            (void)std::from_chars(
                component.data(),
                component.data() + component.size(),
                parsed[index]);
            start = end == std::string_view::npos ? value.size() : end + 1;
        }
        return parsed;
    }

    const fluxora::JsonValue& requireMember(
        const fluxora::JsonValue::Object& object,
        std::wstring_view key)
    {
        const auto match = object.find(std::wstring(key));
        if (match == object.end())
        {
            throw std::runtime_error("Update manifest is missing a required field.");
        }
        return match->second;
    }

    void requireExactKeys(
        const fluxora::JsonValue::Object& object,
        std::initializer_list<std::wstring_view> allowed)
    {
        if (object.size() != allowed.size())
        {
            throw std::runtime_error("Update manifest contains missing or unsupported fields.");
        }
        for (const auto& [key, value] : object)
        {
            (void)value;
            if (std::find(allowed.begin(), allowed.end(), key) == allowed.end())
            {
                throw std::runtime_error("Update manifest contains an unsupported field.");
            }
        }
    }

    std::string requireUtf8String(
        const fluxora::JsonValue::Object& object,
        std::wstring_view key)
    {
        const fluxora::JsonValue& value = requireMember(object, key);
        if (!value.isString())
        {
            throw std::runtime_error("Update manifest field has the wrong JSON type.");
        }
        return wideToUtf8(value.asString(), "Update manifest string");
    }

    std::uint64_t requireUnsignedInteger(
        const fluxora::JsonValue::Object& object,
        std::wstring_view key)
    {
        const fluxora::JsonValue& value = requireMember(object, key);
        if (!value.isNumber())
        {
            throw std::runtime_error("Update manifest integer has the wrong JSON type.");
        }
        const std::wstring& number = value.asNumber();
        if (number.empty() ||
            !std::all_of(number.begin(), number.end(), [](wchar_t character) {
                return character >= L'0' && character <= L'9';
            }))
        {
            throw std::runtime_error("Update manifest integer must be an unsigned decimal value.");
        }
        std::string ascii;
        ascii.reserve(number.size());
        for (const wchar_t digit : number)
        {
            ascii.push_back(static_cast<char>(digit));
        }
        std::uint64_t parsed = 0;
        const auto result = std::from_chars(ascii.data(), ascii.data() + ascii.size(), parsed);
        if (result.ec != std::errc{} || result.ptr != ascii.data() + ascii.size())
        {
            throw std::runtime_error("Update manifest integer is out of range.");
        }
        return parsed;
    }

    bool isWindowsReservedName(std::wstring_view component)
    {
        const std::size_t dot = component.find(L'.');
        std::wstring stem(component.substr(0, dot));
        std::transform(stem.begin(), stem.end(), stem.begin(), [](wchar_t value) {
            return static_cast<wchar_t>(std::towupper(value));
        });
        if (stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL" ||
            stem == L"CLOCK$" || stem == L"CONIN$" || stem == L"CONOUT$")
        {
            return true;
        }
        return stem.size() == 4 &&
            (stem.starts_with(L"COM") || stem.starts_with(L"LPT")) &&
            stem.back() >= L'1' && stem.back() <= L'9';
    }

    std::wstring validateManifestPath(std::string_view utf8Path)
    {
        if (utf8Path.empty() || utf8Path.size() > MaximumManifestPathBytes ||
            utf8Path.front() == '/' || utf8Path.back() == '/' ||
            utf8Path.find('\\') != std::string_view::npos ||
            utf8Path.find("//") != std::string_view::npos ||
            std::any_of(utf8Path.begin(), utf8Path.end(), [](char byte) {
                const unsigned char value = static_cast<unsigned char>(byte);
                return value < 0x20 || value == 0x7f;
            }))
        {
            throw std::runtime_error("Update manifest contains a non-canonical file path.");
        }
        if (isInternalCommitSentinel(utf8Path))
        {
            throw std::runtime_error("Update manifest cannot own an internal transaction sentinel.");
        }

        const std::wstring wide = utf8ToWide(
            std::span(utf8Path.data(), utf8Path.size()),
            "Update manifest path");
        const std::filesystem::path relative(wide);
        if (relative.is_absolute() || relative.has_root_path())
        {
            throw std::runtime_error("Update manifest contains an absolute file path.");
        }

        bool first = true;
        std::wstring normalized;
        for (const std::filesystem::path& componentPath : relative)
        {
            const std::wstring component = componentPath.wstring();
            if (component.empty() || component == L"." || component == L".." ||
                component.find(L':') != std::wstring::npos ||
                component.back() == L'.' || component.back() == L' ' ||
                isWindowsReservedName(component))
            {
                throw std::runtime_error("Update manifest contains an unsafe file path.");
            }
            std::wstring folded = component;
            std::transform(folded.begin(), folded.end(), folded.begin(), [](wchar_t value) {
                return static_cast<wchar_t>(std::towlower(value));
            });
            if (first && (folded == L"downloads" || folded == L"logs"))
            {
                throw std::runtime_error("Update manifest cannot own a protected data directory.");
            }
            if (!first)
            {
                normalized.push_back(L'/');
            }
            normalized += folded;
            first = false;
        }
        if (first)
        {
            throw std::runtime_error("Update manifest contains an empty file path.");
        }
        return normalized;
    }

    void validateGitHubReleaseAssetUrl(std::string_view url)
    {
        constexpr std::string_view prefix = "https://github.com/";
        if (!url.starts_with(prefix) ||
            url.find("/releases/download/") == std::string_view::npos ||
            url.find('?') != std::string_view::npos ||
            url.find('#') != std::string_view::npos ||
            url.find('@', prefix.size()) != std::string_view::npos)
        {
            throw std::runtime_error("Update asset URL must be a credential-free GitHub Releases HTTPS URL.");
        }
    }

    ParsedManifest parseManifest(std::span<const char> manifestBytes)
    {
        if (manifestBytes.empty() || manifestBytes.size() > MaximumManifestBytes)
        {
            throw std::runtime_error("Update manifest is empty or exceeds the size limit.");
        }
        const std::wstring manifestText = utf8ToWide(manifestBytes, "Update manifest");
        const fluxora::JsonValue root = fluxora::JsonReader::parse(manifestText);
        if (!root.isObject())
        {
            throw std::runtime_error("Update manifest root must be an object.");
        }
        const auto& object = root.asObject();
        requireExactKeys(object, {
            L"schemaVersion",
            L"channel",
            L"version",
            L"target",
            L"applicationExecutable",
            L"fileManifestSha256",
            L"files",
            L"assets"});
        if (requireUnsignedInteger(object, L"schemaVersion") != 1)
        {
            throw std::runtime_error("Unsupported update manifest schema version.");
        }
        if (requireUtf8String(object, L"channel") != "stable")
        {
            throw std::runtime_error("Update manifest channel must be stable.");
        }

        ParsedManifest manifest;
        manifest.version = requireUtf8String(object, L"version");
        manifest.target = requireUtf8String(object, L"target");
        manifest.applicationExecutable = requireMember(object, L"applicationExecutable").asString();
        manifest.fileManifestSha256 = requireUtf8String(object, L"fileManifestSha256");
        if (!isSemVersion(manifest.version) || manifest.target != "win-x64" ||
            !isLowerHexSha256(manifest.fileManifestSha256))
        {
            throw std::runtime_error("Update manifest version, target or file digest is invalid.");
        }
        const std::string applicationPathUtf8 = wideToUtf8(
            manifest.applicationExecutable,
            "Update application executable");
        (void)validateManifestPath(applicationPathUtf8);

        const fluxora::JsonValue& filesValue = requireMember(object, L"files");
        if (!filesValue.isArray() || filesValue.asArray().size() > MaximumManifestFiles)
        {
            throw std::runtime_error("Update manifest files must be a bounded array.");
        }
        std::set<std::wstring> windowsPaths;
        std::string previousPath;
        std::string canonicalFiles;
        for (const fluxora::JsonValue& fileValue : filesValue.asArray())
        {
            if (!fileValue.isObject())
            {
                throw std::runtime_error("Update manifest file entry must be an object.");
            }
            const auto& fileObject = fileValue.asObject();
            requireExactKeys(fileObject, {L"path", L"size", L"sha256"});
            ManifestFile file;
            file.path = requireUtf8String(fileObject, L"path");
            file.size = requireUnsignedInteger(fileObject, L"size");
            file.sha256 = requireUtf8String(fileObject, L"sha256");
            const std::wstring windowsPath = validateManifestPath(file.path);
            if (!previousPath.empty() && !utf8ByteLess(previousPath, file.path))
            {
                throw std::runtime_error("Update manifest files must be strictly sorted by path.");
            }
            if (!windowsPaths.insert(windowsPath).second)
            {
                throw std::runtime_error("Update manifest contains Windows-aliased duplicate paths.");
            }
            if (!isLowerHexSha256(file.sha256))
            {
                throw std::runtime_error("Update manifest file SHA-256 is invalid.");
            }
            canonicalFiles += file.path;
            canonicalFiles.push_back('\0');
            canonicalFiles += std::to_string(file.size);
            canonicalFiles.push_back('\0');
            canonicalFiles += file.sha256;
            canonicalFiles.push_back('\n');
            previousPath = file.path;
            manifest.files.push_back(std::move(file));
        }
        if (lowerHex(sha256(std::as_bytes(std::span(canonicalFiles.data(), canonicalFiles.size())))) !=
            manifest.fileManifestSha256)
        {
            throw std::runtime_error("Update manifest file list digest is invalid.");
        }

        const fluxora::JsonValue& assetsValue = requireMember(object, L"assets");
        if (!assetsValue.isArray() || assetsValue.asArray().empty() ||
            assetsValue.asArray().size() > MaximumManifestAssets)
        {
            throw std::runtime_error("Update manifest assets must be a non-empty bounded array.");
        }
        std::size_t fullCount = 0;
        std::set<std::string> deltaBases;
        for (const fluxora::JsonValue& assetValue : assetsValue.asArray())
        {
            if (!assetValue.isObject())
            {
                throw std::runtime_error("Update manifest asset entry must be an object.");
            }
            const auto& assetObject = assetValue.asObject();
            requireExactKeys(assetObject, {
                L"kind",
                L"fromVersion",
                L"url",
                L"size",
                L"sha256",
                L"baseFileManifestSha256",
                L"targetFileManifestSha256"});
            ManifestAsset asset;
            const std::string kind = requireUtf8String(assetObject, L"kind");
            if (kind == "full")
            {
                asset.kind = fluxora::installer::UpdateAssetKind::Full;
                ++fullCount;
            }
            else if (kind == "delta")
            {
                asset.kind = fluxora::installer::UpdateAssetKind::Delta;
            }
            else
            {
                throw std::runtime_error("Update manifest asset kind is invalid.");
            }

            const fluxora::JsonValue& fromVersion = requireMember(assetObject, L"fromVersion");
            if (!fromVersion.isNull())
            {
                if (!fromVersion.isString())
                {
                    throw std::runtime_error("Update manifest fromVersion has the wrong JSON type.");
                }
                asset.fromVersion = wideToUtf8(fromVersion.asString(), "Update base version");
            }
            const fluxora::JsonValue& baseDigest = requireMember(assetObject, L"baseFileManifestSha256");
            if (!baseDigest.isNull())
            {
                if (!baseDigest.isString())
                {
                    throw std::runtime_error("Update manifest base digest has the wrong JSON type.");
                }
                asset.baseFileManifestSha256 = wideToUtf8(baseDigest.asString(), "Update base digest");
            }
            asset.url = requireUtf8String(assetObject, L"url");
            asset.size = requireUnsignedInteger(assetObject, L"size");
            asset.sha256 = requireUtf8String(assetObject, L"sha256");
            asset.targetFileManifestSha256 = requireUtf8String(
                assetObject,
                L"targetFileManifestSha256");
            validateGitHubReleaseAssetUrl(asset.url);
            if (asset.size == 0 || asset.size > MaximumAssetBytes ||
                !isLowerHexSha256(asset.sha256) ||
                !isLowerHexSha256(asset.targetFileManifestSha256) ||
                asset.targetFileManifestSha256 != manifest.fileManifestSha256)
            {
                throw std::runtime_error("Update manifest asset digest is invalid.");
            }
            if (asset.kind == fluxora::installer::UpdateAssetKind::Full)
            {
                if (asset.fromVersion.has_value() || asset.baseFileManifestSha256.has_value())
                {
                    throw std::runtime_error("Full update asset cannot declare a base version or digest.");
                }
            }
            else
            {
                if (!asset.fromVersion.has_value() || !isSemVersion(*asset.fromVersion) ||
                    !asset.baseFileManifestSha256.has_value() ||
                    !isLowerHexSha256(*asset.baseFileManifestSha256) ||
                    !deltaBases.insert(*asset.fromVersion).second)
                {
                    throw std::runtime_error("Delta update asset base metadata is invalid or duplicated.");
                }
            }
            manifest.assets.push_back(std::move(asset));
        }
        if (fullCount != 1)
        {
            throw std::runtime_error("Update manifest must contain exactly one full asset.");
        }
        return manifest;
    }

    const ManifestAsset& selectAsset(
        const ParsedManifest& manifest,
        const fluxora::installer::UpdateRequest& request)
    {
        if (!isSemVersion(request.currentVersion) ||
            !isSemVersion(request.targetVersion) ||
            parseSemVersion(request.targetVersion) <= parseSemVersion(request.currentVersion) ||
            request.target != "win-x64" ||
            request.target != manifest.target ||
            request.targetVersion != manifest.version ||
            request.applicationExecutable != manifest.applicationExecutable)
        {
            throw std::runtime_error("Update request does not match the signed manifest target.");
        }
        if (!isLowerHexSha256(request.expectedPackageSha256))
        {
            throw std::runtime_error("Update request package SHA-256 is invalid.");
        }
        if ((request.assetKind == fluxora::installer::UpdateAssetKind::Full && request.fromVersion.has_value()) ||
            (request.assetKind == fluxora::installer::UpdateAssetKind::Delta &&
             (!request.fromVersion.has_value() || *request.fromVersion != request.currentVersion)))
        {
            throw std::runtime_error("Update request base version is invalid.");
        }

        const ManifestAsset* selected = nullptr;
        for (const ManifestAsset& asset : manifest.assets)
        {
            if (asset.kind == request.assetKind && asset.fromVersion == request.fromVersion)
            {
                selected = &asset;
                break;
            }
        }
        if (selected == nullptr ||
            selected->size != request.expectedPackageSize ||
            selected->sha256 != request.expectedPackageSha256)
        {
            throw std::runtime_error("Update request does not match a signed manifest asset.");
        }
        return *selected;
    }

    struct DirectorySnapshot final
    {
        std::vector<ManifestFile> files;
        std::string digest;
    };

    std::string canonicalFileManifestDigest(const std::vector<ManifestFile>& files)
    {
        std::string canonical;
        for (const ManifestFile& file : files)
        {
            canonical += file.path;
            canonical.push_back('\0');
            canonical += std::to_string(file.size);
            canonical.push_back('\0');
            canonical += file.sha256;
            canonical.push_back('\n');
        }
        return lowerHex(sha256(std::as_bytes(std::span(canonical.data(), canonical.size()))));
    }

    void rejectReparsePoint(const std::filesystem::path& path, std::string_view label)
    {
        const DWORD attributes = GetFileAttributesW(path.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES)
        {
            throw std::runtime_error(std::string("Failed to inspect ") + std::string(label) + ".");
        }
        if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::runtime_error(std::string(label) + " cannot be a reparse point.");
        }
    }

    std::filesystem::path pathFromManifest(
        const std::filesystem::path& root,
        std::string_view relativePath)
    {
        (void)validateManifestPath(relativePath);
        const std::wstring wide = utf8ToWide(
            std::span(relativePath.data(), relativePath.size()),
            "Update file path");
        const std::filesystem::path result = (root / std::filesystem::path(wide)).lexically_normal();
        const std::filesystem::path normalRoot = root.lexically_normal();
        auto rootIt = normalRoot.begin();
        auto resultIt = result.begin();
        for (; rootIt != normalRoot.end(); ++rootIt, ++resultIt)
        {
            if (resultIt == result.end())
            {
                throw std::runtime_error("Update file path escapes the staging directory.");
            }
            std::wstring left = rootIt->wstring();
            std::wstring right = resultIt->wstring();
            std::transform(left.begin(), left.end(), left.begin(), [](wchar_t value) {
                return static_cast<wchar_t>(std::towlower(value));
            });
            std::transform(right.begin(), right.end(), right.begin(), [](wchar_t value) {
                return static_cast<wchar_t>(std::towlower(value));
            });
            if (left != right)
            {
                throw std::runtime_error("Update file path escapes the staging directory.");
            }
        }
        return result;
    }

    void collectDirectoryFiles(
        const std::filesystem::path& root,
        const std::filesystem::path& current,
        std::string_view relativePrefix,
        bool skipProtectedData,
        std::vector<ManifestFile>& files)
    {
        rejectReparsePoint(current, "Update directory");
        std::error_code iteratorError;
        std::filesystem::directory_iterator iterator(
            current,
            std::filesystem::directory_options::none,
            iteratorError);
        if (iteratorError)
        {
            throw std::runtime_error("Failed to enumerate the update directory.");
        }

        const std::filesystem::directory_iterator end;
        while (iterator != end)
        {
            const std::filesystem::path entryPath = iterator->path();
            rejectReparsePoint(entryPath, "Update tree entry");
            const std::string name = wideToUtf8(entryPath.filename().wstring(), "Update file name");
            const std::string relative = relativePrefix.empty()
                ? name
                : std::string(relativePrefix) + "/" + name;

            std::error_code statusError;
            const std::filesystem::file_status status = std::filesystem::symlink_status(entryPath, statusError);
            if (statusError)
            {
                throw std::runtime_error("Failed to inspect an update tree entry.");
            }
            if (std::filesystem::is_directory(status))
            {
                std::wstring foldedName = entryPath.filename().wstring();
                std::transform(foldedName.begin(), foldedName.end(), foldedName.begin(), [](wchar_t value) {
                    return static_cast<wchar_t>(std::towlower(value));
                });
                if (!(skipProtectedData && relativePrefix.empty() &&
                      (foldedName == L"downloads" || foldedName == L"logs")))
                {
                    (void)validateManifestPath(relative);
                    collectDirectoryFiles(root, entryPath, relative, false, files);
                }
            }
            else if (std::filesystem::is_regular_file(status))
            {
                if (skipProtectedData && relativePrefix.empty() &&
                    isInternalCommitSentinel(relative))
                {
                    iterator.increment(iteratorError);
                    if (iteratorError)
                    {
                        throw std::runtime_error("Failed while enumerating the update directory.");
                    }
                    continue;
                }
                (void)validateManifestPath(relative);
                std::error_code beforeError;
                const std::uintmax_t sizeBefore = std::filesystem::file_size(entryPath, beforeError);
                if (beforeError || sizeBefore > std::numeric_limits<std::uint64_t>::max())
                {
                    throw std::runtime_error("Failed to measure an update tree file.");
                }
                const std::string digest = lowerHex(sha256File(entryPath));
                std::error_code afterError;
                const std::uintmax_t sizeAfter = std::filesystem::file_size(entryPath, afterError);
                if (afterError || sizeAfter != sizeBefore)
                {
                    throw std::runtime_error("Update tree changed while it was being verified.");
                }
                files.push_back(ManifestFile{
                    relative,
                    static_cast<std::uint64_t>(sizeBefore),
                    digest});
            }
            else
            {
                throw std::runtime_error("Update tree contains an unsupported filesystem entry.");
            }

            iterator.increment(iteratorError);
            if (iteratorError)
            {
                throw std::runtime_error("Failed while enumerating the update directory.");
            }
        }
    }

    DirectorySnapshot snapshotDirectory(
        const std::filesystem::path& root,
        bool skipProtectedData)
    {
        if (!std::filesystem::is_directory(root))
        {
            throw std::runtime_error("Update installation directory is missing.");
        }
        DirectorySnapshot snapshot;
        collectDirectoryFiles(root, root, {}, skipProtectedData, snapshot.files);
        std::sort(snapshot.files.begin(), snapshot.files.end(), [](const ManifestFile& left, const ManifestFile& right) {
            return utf8ByteLess(left.path, right.path);
        });
        std::set<std::wstring> windowsPaths;
        for (const ManifestFile& file : snapshot.files)
        {
            if (!windowsPaths.insert(validateManifestPath(file.path)).second)
            {
                throw std::runtime_error("Update tree contains Windows-aliased duplicate paths.");
            }
        }
        snapshot.digest = canonicalFileManifestDigest(snapshot.files);
        return snapshot;
    }

    void copySnapshot(
        const std::filesystem::path& sourceRoot,
        const std::filesystem::path& destinationRoot,
        const DirectorySnapshot& snapshot)
    {
        for (const ManifestFile& file : snapshot.files)
        {
            const std::filesystem::path source = pathFromManifest(sourceRoot, file.path);
            const std::filesystem::path destination = pathFromManifest(destinationRoot, file.path);
            rejectReparsePoint(source, "Update base file");
            std::error_code directoryError;
            std::filesystem::create_directories(destination.parent_path(), directoryError);
            if (directoryError)
            {
                throw std::runtime_error("Failed to create an update staging directory.");
            }
            std::error_code copyError;
            std::filesystem::copy_file(
                source,
                destination,
                std::filesystem::copy_options::none,
                copyError);
            if (copyError)
            {
                throw std::runtime_error("Failed to copy the installed application into update staging.");
            }
        }
    }

    class UpdatePackageReader final
    {
    public:
        explicit UpdatePackageReader(const std::filesystem::path& path)
            : input_(path, std::ios::binary)
        {
            if (!input_)
            {
                throw std::runtime_error("Update package could not be opened.");
            }
        }

        void readExact(void* destination, std::size_t bytes, std::string_view label)
        {
            if (bytes > static_cast<std::size_t>(std::numeric_limits<std::streamsize>::max()))
            {
                throw std::runtime_error("Update package field is too large.");
            }
            input_.read(static_cast<char*>(destination), static_cast<std::streamsize>(bytes));
            if (input_.gcount() != static_cast<std::streamsize>(bytes))
            {
                throw std::runtime_error("Unexpected end of update package while reading " + std::string(label) + ".");
            }
        }

        std::uint8_t readU8(std::string_view label)
        {
            std::uint8_t value = 0;
            readExact(&value, sizeof(value), label);
            return value;
        }

        std::uint32_t readU32(std::string_view label)
        {
            std::array<unsigned char, 4> bytes{};
            readExact(bytes.data(), bytes.size(), label);
            return static_cast<std::uint32_t>(bytes[0]) |
                (static_cast<std::uint32_t>(bytes[1]) << 8) |
                (static_cast<std::uint32_t>(bytes[2]) << 16) |
                (static_cast<std::uint32_t>(bytes[3]) << 24);
        }

        std::uint64_t readU64(std::string_view label)
        {
            std::array<unsigned char, 8> bytes{};
            readExact(bytes.data(), bytes.size(), label);
            std::uint64_t value = 0;
            for (std::size_t index = 0; index < bytes.size(); ++index)
            {
                value |= static_cast<std::uint64_t>(bytes[index]) << (index * 8);
            }
            return value;
        }

        std::string readString(std::string_view label, bool allowEmpty = false)
        {
            const std::uint32_t length = readU32(std::string(label) + " length");
            if ((!allowEmpty && length == 0) || length > MaximumManifestPathBytes)
            {
                throw std::runtime_error("Update package contains an invalid " + std::string(label) + ".");
            }
            std::string value(length, '\0');
            if (length > 0)
            {
                readExact(value.data(), value.size(), label);
                (void)utf8ToWide(std::span(value.data(), value.size()), label);
            }
            return value;
        }

        std::string readDigest(std::string_view label)
        {
            std::array<unsigned char, Sha256Bytes> digest{};
            readExact(digest.data(), digest.size(), label);
            return lowerHex(digest);
        }

        void copyPayload(
            const std::filesystem::path& destination,
            std::uint64_t byteCount,
            std::string_view expectedDigest,
            std::uint64_t& completedBytes,
            std::uint64_t totalBytes,
            std::string_view item,
            const fluxora::installer::UpdateProgressCallback& progress)
        {
            std::error_code directoryError;
            std::filesystem::create_directories(destination.parent_path(), directoryError);
            if (directoryError)
            {
                throw std::runtime_error("Failed to create an update payload directory.");
            }
            std::error_code statusError;
            const std::filesystem::file_status currentStatus =
                std::filesystem::symlink_status(destination, statusError);
            if (!statusError && std::filesystem::exists(currentStatus))
            {
                rejectReparsePoint(destination, "Update payload destination");
                if (std::filesystem::is_directory(currentStatus))
                {
                    std::error_code removeError;
                    if (!std::filesystem::remove(destination, removeError) || removeError)
                    {
                        throw std::runtime_error("Update payload cannot replace a non-empty directory.");
                    }
                }
            }

            std::ofstream output(destination, std::ios::binary | std::ios::trunc);
            if (!output)
            {
                throw std::runtime_error("Failed to create an update payload file.");
            }
            AlgorithmHandle algorithm(BCRYPT_SHA256_ALGORITHM);
            HashHandle hash(algorithm.get());
            std::array<char, 256 * 1024> buffer{};
            std::uint64_t remaining = byteCount;
            while (remaining > 0)
            {
                const std::size_t chunk = static_cast<std::size_t>(
                    std::min<std::uint64_t>(remaining, buffer.size()));
                readExact(buffer.data(), chunk, "payload bytes");
                output.write(buffer.data(), static_cast<std::streamsize>(chunk));
                if (!output)
                {
                    throw std::runtime_error("Failed to write an update payload file.");
                }
                requireNtSuccess(
                    BCryptHashData(
                        hash.get(),
                        reinterpret_cast<PUCHAR>(buffer.data()),
                        static_cast<ULONG>(chunk),
                        0),
                    "update payload hashing");
                remaining -= chunk;
                completedBytes += chunk;
                if (progress)
                {
                    progress("copying", item, completedBytes, totalBytes);
                }
            }
            output.flush();
            if (!output)
            {
                throw std::runtime_error("Failed to flush an update payload file.");
            }
            std::array<unsigned char, Sha256Bytes> digest{};
            requireNtSuccess(
                BCryptFinishHash(hash.get(), digest.data(), static_cast<ULONG>(digest.size()), 0),
                "update payload hash finalization");
            if (lowerHex(digest) != expectedDigest)
            {
                throw std::runtime_error("Update package file payload failed SHA-256 verification.");
            }
        }

        void requireEnd()
        {
            char trailing = 0;
            input_.read(&trailing, 1);
            if (input_.gcount() != 0)
            {
                throw std::runtime_error("Update package contains trailing data.");
            }
            if (!input_.eof())
            {
                throw std::runtime_error("Update package could not be read completely.");
            }
        }

    private:
        std::ifstream input_;
    };

    void requireMatchingTargetTree(
        const std::filesystem::path& stagingDirectory,
        const ParsedManifest& manifest)
    {
        const DirectorySnapshot actual = snapshotDirectory(stagingDirectory, true);
        if (actual.digest != manifest.fileManifestSha256 || actual.files.size() != manifest.files.size())
        {
            throw std::runtime_error("Staged update does not match the signed target file manifest.");
        }
        for (std::size_t index = 0; index < actual.files.size(); ++index)
        {
            const ManifestFile& left = actual.files[index];
            const ManifestFile& right = manifest.files[index];
            if (left.path != right.path || left.size != right.size || left.sha256 != right.sha256)
            {
                throw std::runtime_error("Staged update file differs from the signed target manifest.");
            }
        }
    }

    void buildStagingTreeFromPackage(
        const fluxora::installer::UpdateRequest& request,
        const ParsedManifest& manifest,
        const ManifestAsset& asset,
        const std::filesystem::path& stagingDirectory,
        const fluxora::installer::UpdateProgressCallback& progress)
    {
        UpdatePackageReader package(request.packagePath);
        std::array<char, 8> magic{};
        package.readExact(magic.data(), magic.size(), "package magic");
        constexpr std::array<char, 8> expectedMagic{'F', 'L', 'X', 'U', 'P', 'D', '1', '\0'};
        if (magic != expectedMagic || package.readU32("package format version") != 1)
        {
            throw std::runtime_error("Unsupported Fluxora update package format.");
        }
        const std::uint8_t kindValue = package.readU8("package kind");
        const auto packageKind = kindValue == 0
            ? fluxora::installer::UpdateAssetKind::Full
            : fluxora::installer::UpdateAssetKind::Delta;
        if (kindValue > 1 || packageKind != request.assetKind)
        {
            throw std::runtime_error("Update package kind does not match the signed asset.");
        }

        const std::string packageFromVersion = package.readString("base version", true);
        const std::string packageTargetVersion = package.readString("target version");
        const std::string packageTarget = package.readString("target");
        const std::string packageBaseDigest = package.readDigest("base file manifest digest");
        const std::string packageTargetDigest = package.readDigest("target file manifest digest");
        constexpr std::string_view zeroDigest =
            "0000000000000000000000000000000000000000000000000000000000000000";
        if (packageTargetVersion != manifest.version ||
            packageTarget != manifest.target ||
            packageTargetDigest != manifest.fileManifestSha256)
        {
            throw std::runtime_error("Update package target metadata does not match the signed manifest.");
        }
        if (packageKind == fluxora::installer::UpdateAssetKind::Full)
        {
            if (!packageFromVersion.empty() || packageBaseDigest != zeroDigest)
            {
                throw std::runtime_error("Full update package contains invalid base metadata.");
            }
        }
        else if (!asset.fromVersion.has_value() || !asset.baseFileManifestSha256.has_value() ||
                 packageFromVersion != *asset.fromVersion ||
                 packageBaseDigest != *asset.baseFileManifestSha256)
        {
            throw std::runtime_error("Delta update package base metadata does not match the signed manifest.");
        }

        const std::uint64_t deleteCount = package.readU64("delete count");
        if (deleteCount > MaximumManifestFiles ||
            (packageKind == fluxora::installer::UpdateAssetKind::Full && deleteCount != 0))
        {
            throw std::runtime_error("Update package delete list is invalid.");
        }
        std::vector<std::string> deletedPaths;
        deletedPaths.reserve(static_cast<std::size_t>(deleteCount));
        std::string previousDelete;
        for (std::uint64_t index = 0; index < deleteCount; ++index)
        {
            std::string path = package.readString("delete path");
            (void)validateManifestPath(path);
            if ((!previousDelete.empty() && !utf8ByteLess(previousDelete, path)) ||
                std::any_of(manifest.files.begin(), manifest.files.end(), [&](const ManifestFile& file) {
                    return file.path == path;
                }))
            {
                throw std::runtime_error("Update package delete list is unsorted, duplicated or still targeted.");
            }
            previousDelete = path;
            deletedPaths.push_back(std::move(path));
        }

        const std::uint64_t entryCount = package.readU64("entry count");
        const std::uint64_t totalPayloadBytes = package.readU64("total payload bytes");
        if (entryCount > MaximumManifestFiles || totalPayloadBytes > asset.size ||
            totalPayloadBytes > MaximumAssetBytes)
        {
            throw std::runtime_error("Update package payload counts are invalid.");
        }

        DirectorySnapshot baseSnapshot;
        if (packageKind == fluxora::installer::UpdateAssetKind::Delta)
        {
            baseSnapshot = snapshotDirectory(request.installDirectory, true);
            if (baseSnapshot.digest != packageBaseDigest)
            {
                throw std::runtime_error("Installed application does not match the delta base file manifest.");
            }
            copySnapshot(request.installDirectory, stagingDirectory, baseSnapshot);
            for (const std::string& deletedPath : deletedPaths)
            {
                const std::filesystem::path destination = pathFromManifest(stagingDirectory, deletedPath);
                std::error_code statusError;
                const std::filesystem::file_status status =
                    std::filesystem::symlink_status(destination, statusError);
                if (statusError || !std::filesystem::is_regular_file(status))
                {
                    throw std::runtime_error("Delta delete path does not name a base file.");
                }
                rejectReparsePoint(destination, "Delta delete path");
                std::error_code removeError;
                if (!std::filesystem::remove(destination, removeError) || removeError)
                {
                    throw std::runtime_error("Failed to delete an obsolete file from update staging.");
                }
            }
        }

        std::map<std::string, const ManifestFile*> targetFiles;
        for (const ManifestFile& file : manifest.files)
        {
            targetFiles.emplace(file.path, &file);
        }
        std::map<std::string, const ManifestFile*> baseFiles;
        for (const ManifestFile& file : baseSnapshot.files)
        {
            baseFiles.emplace(file.path, &file);
        }

        std::uint64_t completedBytes = 0;
        std::string previousEntry;
        std::unordered_set<std::string> outputPaths;
        for (std::uint64_t index = 0; index < entryCount; ++index)
        {
            const std::string path = package.readString("entry path");
            (void)validateManifestPath(path);
            if ((!previousEntry.empty() && !utf8ByteLess(previousEntry, path)) ||
                !outputPaths.insert(path).second ||
                std::binary_search(
                    deletedPaths.begin(),
                    deletedPaths.end(),
                    path,
                    [](const std::string& left, const std::string& right) {
                        return utf8ByteLess(left, right);
                    }))
            {
                throw std::runtime_error("Update package entries are unsorted, duplicated or conflict with deletes.");
            }
            previousEntry = path;
            const std::uint64_t fileBytes = package.readU64("entry size");
            const std::string fileDigest = package.readDigest("entry SHA-256");
            const auto targetMatch = targetFiles.find(path);
            if (targetMatch == targetFiles.end() ||
                targetMatch->second->size != fileBytes ||
                targetMatch->second->sha256 != fileDigest)
            {
                throw std::runtime_error("Update package entry does not match the signed target file manifest.");
            }
            if (packageKind == fluxora::installer::UpdateAssetKind::Delta)
            {
                const auto baseMatch = baseFiles.find(path);
                if (baseMatch != baseFiles.end() &&
                    baseMatch->second->size == fileBytes &&
                    baseMatch->second->sha256 == fileDigest)
                {
                    throw std::runtime_error("Delta package redundantly includes an unchanged file.");
                }
            }

            package.copyPayload(
                pathFromManifest(stagingDirectory, path),
                fileBytes,
                fileDigest,
                completedBytes,
                totalPayloadBytes,
                path,
                progress);
        }
        if (completedBytes != totalPayloadBytes)
        {
            throw std::runtime_error("Update package payload byte count does not match its header.");
        }
        if (packageKind == fluxora::installer::UpdateAssetKind::Full &&
            outputPaths.size() != manifest.files.size())
        {
            throw std::runtime_error("Full update package does not contain the complete target file tree.");
        }
        package.requireEnd();
    }

    std::vector<unsigned char> decodeBase64(std::string_view encoded)
    {
        while (!encoded.empty() &&
               (encoded.front() == ' ' || encoded.front() == '\t' || encoded.front() == '\r' || encoded.front() == '\n'))
        {
            encoded.remove_prefix(1);
        }
        while (!encoded.empty() &&
               (encoded.back() == ' ' || encoded.back() == '\t' || encoded.back() == '\r' || encoded.back() == '\n'))
        {
            encoded.remove_suffix(1);
        }

        if (encoded.empty() || encoded.size() > static_cast<std::size_t>(std::numeric_limits<DWORD>::max()))
        {
            return {};
        }
        for (const unsigned char character : encoded)
        {
            if (std::isspace(character) != 0)
            {
                return {};
            }
        }

        DWORD outputBytes = 0;
        if (CryptStringToBinaryA(
                encoded.data(),
                static_cast<DWORD>(encoded.size()),
                CRYPT_STRING_BASE64,
                nullptr,
                &outputBytes,
                nullptr,
                nullptr) == FALSE)
        {
            return {};
        }

        std::vector<unsigned char> decoded(outputBytes);
        if (CryptStringToBinaryA(
                encoded.data(),
                static_cast<DWORD>(encoded.size()),
                CRYPT_STRING_BASE64,
                decoded.data(),
                &outputBytes,
                nullptr,
                nullptr) == FALSE)
        {
            return {};
        }
        decoded.resize(outputBytes);
        return decoded;
    }

    std::vector<std::byte> decodePublicKeyPem(std::string_view publicKeyPem)
    {
        if (publicKeyPem.empty() ||
            publicKeyPem.size() > static_cast<std::size_t>(std::numeric_limits<DWORD>::max()))
        {
            throw std::invalid_argument("Update signing public key is missing or too large.");
        }

        DWORD derBytes = 0;
        if (CryptStringToBinaryA(
                publicKeyPem.data(),
                static_cast<DWORD>(publicKeyPem.size()),
                CRYPT_STRING_BASE64HEADER,
                nullptr,
                &derBytes,
                nullptr,
                nullptr) == FALSE)
        {
            throw std::invalid_argument("Update signing public key is not valid PEM.");
        }

        std::vector<std::byte> der(derBytes);
        if (CryptStringToBinaryA(
                publicKeyPem.data(),
                static_cast<DWORD>(publicKeyPem.size()),
                CRYPT_STRING_BASE64HEADER,
                reinterpret_cast<unsigned char*>(der.data()),
                &derBytes,
                nullptr,
                nullptr) == FALSE)
        {
            throw std::invalid_argument("Update signing public key could not be decoded.");
        }
        der.resize(derBytes);

        return der;
    }

    KeyHandle importP256PublicKey(std::span<const std::byte> der)
    {
        if (der.empty() || der.size() > static_cast<std::size_t>(std::numeric_limits<DWORD>::max()))
        {
            throw std::invalid_argument("Update signing public key DER is missing or too large.");
        }

        CERT_PUBLIC_KEY_INFO* publicKeyInfo = nullptr;
        DWORD publicKeyInfoBytes = 0;
        if (CryptDecodeObjectEx(
                X509_ASN_ENCODING,
                X509_PUBLIC_KEY_INFO,
                reinterpret_cast<const BYTE*>(der.data()),
                static_cast<DWORD>(der.size()),
                CRYPT_DECODE_ALLOC_FLAG,
                nullptr,
                &publicKeyInfo,
                &publicKeyInfoBytes) == FALSE)
        {
            throw std::invalid_argument("Update signing public key is not SubjectPublicKeyInfo PEM.");
        }

        BCRYPT_KEY_HANDLE imported = nullptr;
        const BOOL importedOk = CryptImportPublicKeyInfoEx2(
            X509_ASN_ENCODING,
            publicKeyInfo,
            0,
            nullptr,
            &imported);
        LocalFree(publicKeyInfo);
        if (importedOk == FALSE || imported == nullptr)
        {
            throw std::invalid_argument("Update signing public key could not be imported.");
        }

        KeyHandle key(imported);
        DWORD keyBits = 0;
        DWORD resultBytes = 0;
        requireNtSuccess(
            BCryptGetProperty(
                key.get(),
                BCRYPT_KEY_LENGTH,
                reinterpret_cast<PUCHAR>(&keyBits),
                sizeof(keyBits),
                &resultBytes,
                0),
            "public key validation");
        if (keyBits != 256)
        {
            throw std::invalid_argument("Update signing public key must use ECDSA P-256.");
        }
        return key;
    }
}

namespace fluxora::installer
{
    UpdateManifestVerifier::UpdateManifestVerifier(std::string publicKeyPem)
        : publicKeyDer_(decodePublicKeyPem(publicKeyPem))
    {
    }

    UpdateManifestVerifier::UpdateManifestVerifier(std::vector<std::byte> publicKeyDer)
        : publicKeyDer_(std::move(publicKeyDer))
    {
    }

    bool UpdateManifestVerifier::verify(
        std::span<const std::byte> manifestBytes,
        std::string_view signatureBase64) const
    {
        const std::vector<unsigned char> signature = decodeBase64(signatureBase64);
        if (signature.size() != P256SignatureBytes)
        {
            return false;
        }

        KeyHandle key = importP256PublicKey(publicKeyDer_);
        const std::array<unsigned char, Sha256Bytes> digest = sha256(manifestBytes);
        const NTSTATUS result = BCryptVerifySignature(
            key.get(),
            nullptr,
            const_cast<PUCHAR>(digest.data()),
            static_cast<ULONG>(digest.size()),
            const_cast<PUCHAR>(signature.data()),
            static_cast<ULONG>(signature.size()),
            0);
        return result >= 0;
    }

    UpdateEngine::UpdateEngine(std::string publicKeyPem)
        : signatureVerifier_(
              [verifier = UpdateManifestVerifier(std::move(publicKeyPem))](
                  std::span<const std::byte> manifestBytes,
                  std::string_view signatureBase64) {
                  return verifier.verify(manifestBytes, signatureBase64);
              })
    {
    }

    UpdateEngine::UpdateEngine(std::vector<std::byte> publicKeyDer)
        : signatureVerifier_(
              [verifier = UpdateManifestVerifier(std::move(publicKeyDer))](
                  std::span<const std::byte> manifestBytes,
                  std::string_view signatureBase64) {
                  return verifier.verify(manifestBytes, signatureBase64);
              })
    {
    }

    UpdateEngine::UpdateEngine(
        UpdateSignatureVerifier signatureVerifier,
        UpdateCommitObserver commitObserver)
        : signatureVerifier_(std::move(signatureVerifier)),
          commitObserver_(std::move(commitObserver))
    {
        if (!signatureVerifier_)
        {
            throw std::invalid_argument("Update signature verifier is required.");
        }
    }

    void UpdateEngine::verify(const UpdateRequest& request) const
    {
        std::error_code manifestSizeError;
        const std::uintmax_t manifestSize =
            std::filesystem::file_size(request.manifestPath, manifestSizeError);
        if (manifestSizeError || manifestSize == 0 || manifestSize > MaximumManifestBytes)
        {
            throw std::runtime_error("Update manifest is missing, empty or exceeds the size limit.");
        }
        rejectReparsePoint(request.manifestPath, "Update manifest");
        std::ifstream manifestInput(request.manifestPath, std::ios::binary);
        if (!manifestInput)
        {
            throw std::runtime_error("Update manifest could not be opened.");
        }
        const std::vector<char> manifestCharacters{
            std::istreambuf_iterator<char>(manifestInput),
            std::istreambuf_iterator<char>()};
        const std::span<const char> manifestCharacterSpan(manifestCharacters);
        const std::span<const std::byte> manifestBytes = std::as_bytes(manifestCharacterSpan);

        std::error_code signatureSizeError;
        const std::uintmax_t signatureSize =
            std::filesystem::file_size(request.signaturePath, signatureSizeError);
        if (signatureSizeError || signatureSize == 0 || signatureSize > 4096)
        {
            throw std::runtime_error("Update manifest signature is missing, empty or exceeds the size limit.");
        }
        rejectReparsePoint(request.signaturePath, "Update manifest signature");
        std::ifstream signatureInput(request.signaturePath, std::ios::binary);
        if (!signatureInput)
        {
            throw std::runtime_error("Update manifest signature could not be opened.");
        }
        const std::string signature{
            std::istreambuf_iterator<char>(signatureInput),
            std::istreambuf_iterator<char>()};

        if (!signatureVerifier_(manifestBytes, signature))
        {
            throw std::runtime_error("Update manifest signature verification failed.");
        }

        const ParsedManifest parsedManifest = parseManifest(manifestCharacterSpan);
        const ManifestAsset& selectedAsset = selectAsset(parsedManifest, request);

        std::error_code sizeError;
        const std::uintmax_t packageSize = std::filesystem::file_size(request.packagePath, sizeError);
        if (sizeError || packageSize > MaximumAssetBytes || packageSize != selectedAsset.size)
        {
            throw std::runtime_error("Update package size does not match the signed asset metadata.");
        }
        rejectReparsePoint(request.packagePath, "Update package");

        const std::array<unsigned char, Sha256Bytes> packageDigest = sha256File(request.packagePath);
        if (lowerHex(packageDigest) != selectedAsset.sha256)
        {
            throw std::runtime_error("Update package SHA-256 does not match the signed asset metadata.");
        }
    }

    UpdateApplyResult UpdateEngine::apply(
        const UpdateRequest& request,
        const UpdateProgressCallback& progress) const
    {
        verify(request);

        std::ifstream manifestInput(request.manifestPath, std::ios::binary);
        if (!manifestInput)
        {
            throw std::runtime_error("Update manifest could not be reopened for installation.");
        }
        const std::vector<char> manifestCharacters{
            std::istreambuf_iterator<char>(manifestInput),
            std::istreambuf_iterator<char>()};
        const std::span<const char> manifestCharacterSpan(manifestCharacters);
        const std::span<const std::byte> manifestBytes = std::as_bytes(manifestCharacterSpan);
        std::ifstream signatureInput(request.signaturePath, std::ios::binary);
        if (!signatureInput)
        {
            throw std::runtime_error("Update manifest signature could not be reopened for installation.");
        }
        const std::string signature{
            std::istreambuf_iterator<char>(signatureInput),
            std::istreambuf_iterator<char>()};
        if (!signatureVerifier_(manifestBytes, signature))
        {
            throw std::runtime_error("Update manifest changed after verification.");
        }
        const ParsedManifest manifest = parseManifest(manifestCharacterSpan);
        const ManifestAsset& asset = selectAsset(manifest, request);

        if (progress)
        {
            progress("preparing", {}, 0, asset.size);
        }
        detail::replaceApplicationDirectory(
            request.installDirectory,
            [&](const std::filesystem::path& stagingDirectory) {
                buildStagingTreeFromPackage(
                    request,
                    manifest,
                    asset,
                    stagingDirectory,
                    progress);
            },
            [&](const std::filesystem::path& stagingDirectory) {
                requireMatchingTargetTree(stagingDirectory, manifest);
                const std::filesystem::path applicationPath =
                    pathFromManifest(stagingDirectory, wideToUtf8(
                        request.applicationExecutable,
                        "Update application executable"));
                std::error_code statusError;
                const std::filesystem::file_status status =
                    std::filesystem::symlink_status(applicationPath, statusError);
                if (statusError || !std::filesystem::is_regular_file(status))
                {
                    throw std::runtime_error("Signed target application executable is missing from staging.");
                }
                rejectReparsePoint(applicationPath, "Staged application executable");
            },
            [&](detail::DirectoryTransactionStage stage) {
                if (!commitObserver_)
                {
                    return;
                }
                switch (stage)
                {
                case detail::DirectoryTransactionStage::StagingBuilt:
                    commitObserver_(UpdateCommitStage::StagingBuilt);
                    break;
                case detail::DirectoryTransactionStage::ProtectedDataStaged:
                    commitObserver_(UpdateCommitStage::ProtectedDataStaged);
                    break;
                case detail::DirectoryTransactionStage::BackupCreated:
                    commitObserver_(UpdateCommitStage::BackupCreated);
                    break;
                case detail::DirectoryTransactionStage::StagingCommitted:
                    commitObserver_(UpdateCommitStage::StagingCommitted);
                    break;
                }
            });

        if (progress)
        {
            progress("completed", {}, asset.size, asset.size);
        }

        UpdateApplyResult result;
        result.installDirectory = request.installDirectory;
        result.applicationPath = request.installDirectory / request.applicationExecutable;
        result.targetVersion = request.targetVersion;
        return result;
    }
}
