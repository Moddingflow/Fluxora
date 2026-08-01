#include "FluxoraCore/Services/ModdingFlowProviderCatalog.hpp"

#include <algorithm>
#include <charconv>
#include <cctype>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumPageItems = 100U;
        constexpr std::size_t maximumArtifactItems = 128U;
        constexpr std::size_t maximumLocalizedEntries = 32U;
        constexpr std::size_t maximumHashEntries = 16U;

        [[noreturn]] void throwCatalogFailure(
            ModdingFlowApiErrorCode code,
            std::wstring_view operationId,
            std::string message)
        {
            throw ModdingFlowApiException(
                code,
                std::move(message),
                std::wstring(operationId));
        }

        [[noreturn]] void throwInvalidCatalogRequest(
            std::wstring_view operationId,
            std::string message)
        {
            throwCatalogFailure(
                ModdingFlowApiErrorCode::InvalidRequest,
                operationId,
                std::move(message));
        }

        [[noreturn]] void throwInvalidCatalogResponse(
            std::wstring_view operationId,
            std::string message)
        {
            throwCatalogFailure(
                ModdingFlowApiErrorCode::ProtocolFailure,
                operationId,
                std::move(message));
        }

        bool isCanonicalUuid(std::string_view value) noexcept
        {
            if (value.size() != 36U || value[8] != '-' || value[13] != '-' ||
                value[18] != '-' || value[23] != '-')
            {
                return false;
            }
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                if (index == 8U || index == 13U || index == 18U || index == 23U)
                {
                    continue;
                }
                const char character = value[index];
                if (!((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f')))
                {
                    return false;
                }
            }
            return true;
        }

        bool isSlug(std::string_view value) noexcept
        {
            if (value.size() < 2U || value.size() > 80U)
            {
                return false;
            }
            const auto alphanumeric = [](char character) {
                return (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9');
            };
            if (!alphanumeric(value.front()) || !alphanumeric(value.back()))
            {
                return false;
            }
            return std::all_of(value.begin(), value.end(), [&](char character) {
                return alphanumeric(character) || character == '-';
            });
        }

        bool isSafeText(std::string_view value, std::size_t maximum) noexcept
        {
            return !value.empty() && value.size() <= maximum &&
                std::none_of(value.begin(), value.end(), [](char character) {
                    const unsigned char byte = static_cast<unsigned char>(character);
                    return byte < 0x20U || byte == 0x7FU;
                });
        }

        bool isLowerHex(std::string_view value, std::size_t length) noexcept
        {
            return value.size() == length &&
                std::all_of(value.begin(), value.end(), [](char character) {
                    return (character >= '0' && character <= '9') ||
                        (character >= 'a' && character <= 'f');
                });
        }

        const JsonValue& requireMember(
            const JsonValue& object,
            std::wstring_view key,
            JsonValue::Type type)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Catalog JSON value is not an object.");
            }
            const JsonValue* value = object.find(key);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("Catalog JSON member has an invalid type.");
            }
            return *value;
        }

        std::string jsonString(
            const JsonValue& value,
            std::size_t maximum,
            bool allowEmpty = false)
        {
            if (!value.isString())
            {
                throw std::runtime_error("Catalog JSON string has an invalid type.");
            }
            std::string result = moddingFlowJsonStringToUtf8(value.asString());
            if (result.size() > maximum || (!allowEmpty && result.empty()))
            {
                throw std::runtime_error("Catalog JSON string exceeded its contract bounds.");
            }
            return result;
        }

        std::string requiredString(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximum,
            bool allowEmpty = false)
        {
            return jsonString(
                requireMember(object, key, JsonValue::Type::String),
                maximum,
                allowEmpty);
        }

        std::optional<std::string> nullableString(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximum,
            bool requiredMemberPresence)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Catalog JSON value is not an object.");
            }
            const JsonValue* value = object.find(key);
            if (value == nullptr)
            {
                if (requiredMemberPresence)
                {
                    throw std::runtime_error("Catalog JSON member is missing.");
                }
                return std::nullopt;
            }
            if (value->isNull())
            {
                return std::nullopt;
            }
            return jsonString(*value, maximum, true);
        }

        std::uint64_t unsignedInteger(const JsonValue& value)
        {
            if (!value.isNumber())
            {
                throw std::runtime_error("Catalog JSON integer has an invalid type.");
            }
            const std::wstring& wide = value.asNumber();
            if (wide.empty() || wide.size() > 20U)
            {
                throw std::runtime_error("Catalog JSON integer is invalid.");
            }
            std::string ascii;
            ascii.reserve(wide.size());
            for (const wchar_t character : wide)
            {
                if (character < L'0' || character > L'9')
                {
                    throw std::runtime_error("Catalog JSON integer is invalid.");
                }
                ascii.push_back(static_cast<char>(character));
            }
            std::uint64_t result = 0;
            const auto [end, error] = std::from_chars(
                ascii.data(),
                ascii.data() + ascii.size(),
                result);
            if (error != std::errc{} || end != ascii.data() + ascii.size())
            {
                throw std::runtime_error("Catalog JSON integer is invalid.");
            }
            return result;
        }

        const JsonValue& envelopeData(const JsonValue& root)
        {
            if (!root.isObject() ||
                !requireMember(root, L"ok", JsonValue::Type::Boolean).asBoolean())
            {
                throw std::runtime_error("Catalog response envelope is invalid.");
            }
            return requireMember(root, L"data", JsonValue::Type::Object);
        }

        std::map<std::string, std::string> localizedMap(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximumValueBytes)
        {
            const JsonValue& value = requireMember(object, key, JsonValue::Type::Object);
            if (value.asObject().empty() || value.asObject().size() > maximumLocalizedEntries)
            {
                throw std::runtime_error("Catalog localized map has an invalid size.");
            }
            std::map<std::string, std::string> result;
            std::size_t totalBytes = 0U;
            for (const auto& [wideLocale, localized] : value.asObject())
            {
                const std::string locale = moddingFlowJsonStringToUtf8(wideLocale);
                if (locale.empty() || locale.size() > 35U ||
                    !std::all_of(locale.begin(), locale.end(), [](char character) {
                        return std::isalnum(static_cast<unsigned char>(character)) != 0 ||
                            character == '-';
                    }))
                {
                    throw std::runtime_error("Catalog locale tag is invalid.");
                }
                std::string text = jsonString(localized, maximumValueBytes, true);
                totalBytes += locale.size() + text.size();
                if (totalBytes > 64U * 1024U)
                {
                    throw std::runtime_error("Catalog localized map is too large.");
                }
                result.emplace(locale, std::move(text));
            }
            return result;
        }

        std::vector<std::string> stringArray(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximumItems,
            std::size_t maximumStringBytes,
            bool required)
        {
            const JsonValue* value = object.find(key);
            if (value == nullptr)
            {
                if (required)
                {
                    throw std::runtime_error("Catalog string array is missing.");
                }
                return {};
            }
            if (!value->isArray() || value->asArray().size() > maximumItems)
            {
                throw std::runtime_error("Catalog string array has an invalid size.");
            }
            std::vector<std::string> result;
            std::set<std::string> seen;
            result.reserve(value->asArray().size());
            for (const JsonValue& item : value->asArray())
            {
                std::string text = jsonString(item, maximumStringBytes);
                if (!seen.insert(text).second)
                {
                    throw std::runtime_error("Catalog string array contains a duplicate.");
                }
                result.push_back(std::move(text));
            }
            return result;
        }

        ModProviderGame parseGame(const JsonValue& value)
        {
            ModProviderGame result;
            result.id = requiredString(value, L"id", 36U);
            result.slug = requiredString(value, L"slug", 80U);
            result.title = localizedMap(value, L"title", 4096U);
            result.enabled = requireMember(value, L"is_enabled", JsonValue::Type::Boolean).asBoolean();
            if (!isCanonicalUuid(result.id) || !isSlug(result.slug))
            {
                throw std::runtime_error("Catalog game identity is invalid.");
            }
            return result;
        }

        ModProviderMod parseMod(const JsonValue& value)
        {
            ModProviderMod result;
            result.id = requiredString(value, L"id", 36U);
            result.slug = requiredString(value, L"slug", 80U);
            result.gameSlug = requiredString(value, L"game_slug", 80U);
            result.title = localizedMap(value, L"title", 4096U);
            result.summary = localizedMap(value, L"summary", 16U * 1024U);
            result.updatedAt = requiredString(value, L"updated_at", 64U);
            if (!isCanonicalUuid(result.id) || !isSlug(result.slug) ||
                !isSlug(result.gameSlug) || !isSafeText(result.updatedAt, 64U))
            {
                throw std::runtime_error("Catalog mod identity is invalid.");
            }
            return result;
        }

        std::map<std::string, std::string> parseHashes(const JsonValue& value)
        {
            if (!value.isObject() || value.asObject().empty() ||
                value.asObject().size() > maximumHashEntries)
            {
                throw std::runtime_error("Catalog artifact hashes are invalid.");
            }
            std::map<std::string, std::string> result;
            for (const auto& [wideAlgorithm, digestValue] : value.asObject())
            {
                const std::string algorithm = moddingFlowJsonStringToUtf8(wideAlgorithm);
                if (!isSafeText(algorithm, 32U))
                {
                    throw std::runtime_error("Catalog artifact hash is invalid.");
                }
                if (digestValue.isNull())
                {
                    if (algorithm == "sha256")
                    {
                        throw std::runtime_error("Catalog canonical SHA-256 is null.");
                    }
                    continue;
                }
                if (!digestValue.isString())
                {
                    throw std::runtime_error("Catalog artifact hash is invalid.");
                }
                std::string digest = jsonString(digestValue, 256U);
                const std::size_t expectedLength = algorithm == "sha256"
                    ? 64U
                    : algorithm == "sha1" ? 40U : algorithm == "md5" ? 32U : 0U;
                if (expectedLength == 0U)
                {
                    continue;
                }
                if (!isLowerHex(digest, expectedLength))
                {
                    throw std::runtime_error("Catalog artifact hash is not canonical hexadecimal.");
                }
                result.emplace(algorithm, std::move(digest));
            }
            return result;
        }

        ModProviderArtifact parseArtifact(const JsonValue& value)
        {
            ModProviderArtifact result;
            result.id = requiredString(value, L"id", 36U);
            result.modId = requiredString(value, L"mod_id", 36U);
            result.versionId = requiredString(value, L"version_id", 36U);
            result.fileKind = requiredString(value, L"file_kind", 16U);
            result.fileVersion = requiredString(value, L"file_version", 80U);
            result.label = requiredString(value, L"label", 512U, true);
            result.originalFilename = nullableString(value, L"original_filename", 512U, true);
            result.contentType = nullableString(value, L"content_type", 256U, true);
            result.gameVersion = nullableString(value, L"game_version_key", 120U, true);
            result.loader = nullableString(value, L"loader_key", 120U, true);
            result.sizeBytes = unsignedInteger(requireMember(value, L"size_bytes", JsonValue::Type::Number));
            result.sha256 = requiredString(value, L"sha256", 64U);
            result.hashes = parseHashes(requireMember(value, L"hashes", JsonValue::Type::Object));

            if (!isCanonicalUuid(result.id) || !isCanonicalUuid(result.modId) ||
                !isCanonicalUuid(result.versionId) || result.sizeBytes == 0U ||
                !isLowerHex(result.sha256, 64U) ||
                result.hashes.find("sha256") == result.hashes.end() ||
                result.hashes.at("sha256") != result.sha256 ||
                (result.fileKind != "main" && result.fileKind != "optional" &&
                 result.fileKind != "old") ||
                requiredString(value, L"artifact_source", 16U) != "r2_blob" ||
                (requiredString(value, L"status", 16U) != "ready" &&
                 requiredString(value, L"status", 16U) != "published") ||
                requiredString(value, L"scan_status", 16U) != "clean")
            {
                throw std::runtime_error("Catalog artifact is not a canonical clean immutable file.");
            }

            const JsonValue& download = requireMember(
                value,
                L"download_metadata",
                JsonValue::Type::Object);
            const std::string expectedResolve = "/v1/downloads/" + result.id + "/resolve";
            if (requiredString(download, L"resolve_endpoint", 128U) != expectedResolve ||
                requireMember(download, L"range_supported", JsonValue::Type::Boolean).type() !=
                    JsonValue::Type::Boolean)
            {
                throw std::runtime_error("Catalog artifact resolve metadata is invalid.");
            }
            return result;
        }

        ModProviderVersion parseVersion(const JsonValue& value)
        {
            ModProviderVersion result;
            result.id = requiredString(value, L"id", 36U);
            result.modId = requiredString(value, L"mod_id", 36U);
            result.version = requiredString(value, L"version", 80U);
            result.releaseChannel = requiredString(value, L"release_channel", 16U);
            result.gameVersions = stringArray(value, L"game_versions", 128U, 120U, false);
            result.loaders = stringArray(value, L"loaders", 128U, 120U, false);
            result.artifactIds = stringArray(value, L"artifact_ids", maximumArtifactItems, 36U, true);
            result.publishedAt = requiredString(value, L"published_at", 64U);
            if (!isCanonicalUuid(result.id) || !isCanonicalUuid(result.modId) ||
                !std::all_of(result.artifactIds.begin(), result.artifactIds.end(), isCanonicalUuid) ||
                (result.releaseChannel != "stable" && result.releaseChannel != "beta" &&
                 result.releaseChannel != "alpha" && result.releaseChannel != "experimental"))
            {
                throw std::runtime_error("Catalog version identity is invalid.");
            }

            if (const JsonValue* artifacts = value.find(L"artifacts"); artifacts != nullptr)
            {
                if (!artifacts->isArray() || artifacts->asArray().size() > maximumArtifactItems ||
                    artifacts->asArray().size() != result.artifactIds.size())
                {
                    throw std::runtime_error("Catalog expanded artifacts have an invalid size.");
                }
                result.artifacts.reserve(artifacts->asArray().size());
                for (std::size_t index = 0; index < artifacts->asArray().size(); ++index)
                {
                    ModProviderArtifact artifact = parseArtifact(artifacts->asArray()[index]);
                    if (artifact.id != result.artifactIds[index] || artifact.modId != result.modId ||
                        artifact.versionId != result.id)
                    {
                        throw std::runtime_error("Catalog expanded artifact binding is inconsistent.");
                    }
                    result.artifacts.push_back(std::move(artifact));
                }
            }
            return result;
        }

        ModProviderDependency parseDependency(const JsonValue& value)
        {
            ModProviderDependency result;
            result.id = requiredString(value, L"id", 36U);
            result.modId = requiredString(value, L"mod_id", 36U);
            result.targetModId = nullableString(value, L"target_mod_id", 36U, false);
            result.kind = requiredString(value, L"dependency_kind", 32U);
            result.relation = requiredString(value, L"relation", 256U);
            result.label = nullableString(value, L"label", 512U, false);
            result.note = nullableString(value, L"note", 4096U, false);
            if (const JsonValue* semantic = value.find(L"dependency_semantic");
                semantic != nullptr)
            {
                result.semantic = jsonString(*semantic, 16U);
            }
            else if (result.kind == "incompatibility")
            {
                result.semantic = "conflict";
            }
            else
            {
                result.semantic = "required";
            }
            if (!isCanonicalUuid(result.id) || !isCanonicalUuid(result.modId) ||
                (result.targetModId && !isCanonicalUuid(*result.targetModId)) ||
                (result.kind != "required_mod" && result.kind != "external_requirement" &&
                 result.kind != "incompatibility") ||
                (result.semantic != "required" && result.semantic != "optional" &&
                 result.semantic != "conflict" && result.semantic != "embedded"))
            {
                throw std::runtime_error("Catalog dependency is invalid.");
            }
            return result;
        }

        std::string percentEncode(std::string_view value)
        {
            constexpr char digits[] = "0123456789ABCDEF";
            std::string result;
            result.reserve(value.size());
            for (const unsigned char byte : value)
            {
                if ((byte >= 'A' && byte <= 'Z') || (byte >= 'a' && byte <= 'z') ||
                    (byte >= '0' && byte <= '9') || byte == '-' || byte == '.' ||
                    byte == '_' || byte == '~')
                {
                    result.push_back(static_cast<char>(byte));
                }
                else
                {
                    result.push_back('%');
                    result.push_back(digits[byte >> 4U]);
                    result.push_back(digits[byte & 0x0FU]);
                }
            }
            return result;
        }

        std::string normalizeText(std::string_view value)
        {
            std::string result;
            bool pendingSpace = false;
            for (const char character : value)
            {
                if (std::isspace(static_cast<unsigned char>(character)) != 0)
                {
                    pendingSpace = !result.empty();
                    continue;
                }
                if (pendingSpace)
                {
                    result.push_back(' ');
                    pendingSpace = false;
                }
                const unsigned char byte = static_cast<unsigned char>(character);
                result.push_back(byte < 0x80U
                    ? static_cast<char>(std::tolower(byte))
                    : character);
            }
            return result;
        }

        void appendQuery(std::string& path, std::string_view name, std::string_view value)
        {
            path.push_back(path.find('?') == std::string::npos ? '?' : '&');
            path.append(name);
            path.push_back('=');
            path.append(percentEncode(value));
        }

        std::string modsQueryIdentity(
            const ModProviderModQuery& query,
            std::wstring_view operationId,
            std::string& path)
        {
            if (query.limit == 0U || query.limit > maximumPageItems)
            {
                throwInvalidCatalogRequest(operationId, "Catalog page limit must be between 1 and 100.");
            }
            const std::string normalizedQuery = query.query ? normalizeText(*query.query) : std::string{};
            if (normalizedQuery.size() > 160U || (query.query && normalizedQuery.empty()))
            {
                throwInvalidCatalogRequest(operationId, "Catalog search query is invalid.");
            }
            if ((query.gameSlug && !isSlug(*query.gameSlug)) ||
                (query.gameVersion && !isSafeText(*query.gameVersion, 80U)) ||
                (query.loader && !isSafeText(*query.loader, 80U)) ||
                (query.category && !isSlug(*query.category)) ||
                (query.sort != "relevance" && query.sort != "latest" &&
                 query.sort != "trending" && query.sort != "downloads"))
            {
                throwInvalidCatalogRequest(operationId, "Catalog filters are invalid.");
            }

            path = "/mods";
            appendQuery(path, "limit", std::to_string(query.limit));
            if (query.gameSlug) appendQuery(path, "game_slug", *query.gameSlug);
            if (!normalizedQuery.empty()) appendQuery(path, "q", normalizedQuery);
            appendQuery(path, "sort", query.sort);
            if (query.gameVersion) appendQuery(path, "game_version", *query.gameVersion);
            if (query.loader) appendQuery(path, "loader", *query.loader);
            if (query.category) appendQuery(path, "category", *query.category);
            return path;
        }

        void validateCursor(
            const ModProviderCatalogCursor& cursor,
            std::string_view identity,
            std::wstring_view operationId)
        {
            const bool tokenCharacters = std::all_of(
                cursor.opaque.begin(),
                cursor.opaque.end(),
                [](char character) {
                    return std::isalnum(static_cast<unsigned char>(character)) != 0 ||
                        character == '-' || character == '_' || character == '.';
                });
            if (cursor.queryIdentity != identity || cursor.opaque.size() > 512U ||
                !cursor.opaque.starts_with("v1.") || !tokenCharacters)
            {
                throwInvalidCatalogRequest(
                    operationId,
                    "Catalog cursor does not belong to the normalized query.");
            }
        }

        template <typename T, typename Parser>
        ModProviderCatalogPage<T> parsePage(
            const ModdingFlowPublicApiResponse& response,
            std::wstring_view operationId,
            std::string identity,
            std::size_t expectedLimit,
            Parser parser)
        {
            if (response.operationId != operationId)
            {
                throw std::runtime_error("Catalog operation correlation is inconsistent.");
            }
            const JsonValue& data = envelopeData(response.body);
            const JsonValue& items = requireMember(data, L"items", JsonValue::Type::Array);
            if (items.asArray().size() > maximumPageItems)
            {
                throw std::runtime_error("Catalog page exceeded 100 items.");
            }
            ModProviderCatalogPage<T> result;
            result.operationId = std::wstring(operationId);
            result.items.reserve(items.asArray().size());
            for (const JsonValue& item : items.asArray())
            {
                result.items.push_back(parser(item));
            }

            const JsonValue& pagination = requireMember(data, L"pagination", JsonValue::Type::Object);
            if (unsignedInteger(requireMember(pagination, L"limit", JsonValue::Type::Number)) !=
                expectedLimit)
            {
                throw std::runtime_error("Catalog pagination limit is inconsistent.");
            }
            static_cast<void>(requiredString(pagination, L"order", 128U, true));
            if (const JsonValue* next = pagination.find(L"next_cursor"); next != nullptr && !next->isNull())
            {
                std::string opaque = jsonString(*next, 512U);
                const bool tokenCharacters = std::all_of(
                    opaque.begin(),
                    opaque.end(),
                    [](char character) {
                        return std::isalnum(static_cast<unsigned char>(character)) != 0 ||
                            character == '-' || character == '_' || character == '.';
                    });
                if (!opaque.starts_with("v1.") || !tokenCharacters)
                {
                    throw std::runtime_error("Catalog next cursor is invalid.");
                }
                result.nextCursor = ModProviderCatalogCursor{
                    std::move(opaque),
                    std::move(identity)};
            }
            return result;
        }

        ModdingFlowPublicApiResponse executeAnonymous(
            IModdingFlowPublicApiClient& client,
            std::string path,
            std::wstring_view operationId)
        {
            return client.execute({
                .method = ModdingFlowHttpMethod::Get,
                .pathAndQuery = std::move(path),
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .retry = ModdingFlowApiRetryMode::ReadOnly,
                .operationId = std::wstring(operationId)});
        }

        template <typename Callback>
        auto translateCatalogErrors(std::wstring_view operationId, Callback callback)
        {
            try
            {
                return callback();
            }
            catch (const ModdingFlowApiException&)
            {
                throw;
            }
            catch (const std::exception& exception)
            {
                throwInvalidCatalogResponse(operationId, exception.what());
            }
        }
    }

    ModdingFlowProviderCatalog::ModdingFlowProviderCatalog(
        IModdingFlowPublicApiClient& client) noexcept
        : client_(client)
    {
    }

    std::vector<ModProviderGame> ModdingFlowProviderCatalog::listGames(
        std::wstring_view operationId)
    {
        return translateCatalogErrors(operationId, [&] {
            const ModdingFlowPublicApiResponse response =
                executeAnonymous(client_, "/games", operationId);
            if (response.operationId != operationId)
            {
                throw std::runtime_error("Catalog operation correlation is inconsistent.");
            }
            const JsonValue& data = envelopeData(response.body);
            const JsonValue& items = requireMember(data, L"items", JsonValue::Type::Array);
            if (items.asArray().size() > maximumPageItems)
            {
                throw std::runtime_error("Catalog games response exceeded 100 items.");
            }
            std::vector<ModProviderGame> result;
            result.reserve(items.asArray().size());
            for (const JsonValue& item : items.asArray())
            {
                result.push_back(parseGame(item));
            }
            return result;
        });
    }

    ModProviderCatalogPage<ModProviderMod> ModdingFlowProviderCatalog::listMods(
        const ModProviderModQuery& query,
        std::wstring_view operationId)
    {
        return translateCatalogErrors(operationId, [&] {
            std::string path;
            const std::string identity = modsQueryIdentity(query, operationId, path);
            if (query.cursor)
            {
                validateCursor(*query.cursor, identity, operationId);
                appendQuery(path, "cursor", query.cursor->opaque);
            }
            return parsePage<ModProviderMod>(
                executeAnonymous(client_, std::move(path), operationId),
                operationId,
                identity,
                query.limit,
                parseMod);
        });
    }

    ModProviderMod ModdingFlowProviderCatalog::getMod(
        std::string_view idOrSlug,
        std::wstring_view operationId)
    {
        if (!isCanonicalUuid(idOrSlug) && !isSlug(idOrSlug))
        {
            throwInvalidCatalogRequest(operationId, "Catalog mod id or slug is invalid.");
        }
        return translateCatalogErrors(operationId, [&] {
            const ModdingFlowPublicApiResponse response = executeAnonymous(
                client_,
                "/mods/" + percentEncode(idOrSlug),
                operationId);
            if (response.operationId != operationId)
            {
                throw std::runtime_error("Catalog operation correlation is inconsistent.");
            }
            return parseMod(envelopeData(response.body));
        });
    }

    ModProviderCatalogPage<ModProviderVersion> ModdingFlowProviderCatalog::listVersions(
        const ModProviderVersionQuery& query,
        std::wstring_view operationId)
    {
        if (!isCanonicalUuid(query.modId) || query.limit == 0U ||
            query.limit > maximumPageItems)
        {
            throwInvalidCatalogRequest(operationId, "Catalog version query is invalid.");
        }
        return translateCatalogErrors(operationId, [&] {
            std::string path = "/mods/" + query.modId + "/versions";
            appendQuery(path, "limit", std::to_string(query.limit));
            const std::string identity = path;
            if (query.cursor)
            {
                validateCursor(*query.cursor, identity, operationId);
                appendQuery(path, "cursor", query.cursor->opaque);
            }
            return parsePage<ModProviderVersion>(
                executeAnonymous(client_, std::move(path), operationId),
                operationId,
                identity,
                query.limit,
                parseVersion);
        });
    }

    ModProviderVersion ModdingFlowProviderCatalog::getVersion(
        std::string_view modId,
        std::string_view versionId,
        std::wstring_view operationId)
    {
        if (!isCanonicalUuid(modId) || !isCanonicalUuid(versionId))
        {
            throwInvalidCatalogRequest(operationId, "Catalog version identity is invalid.");
        }
        return translateCatalogErrors(operationId, [&] {
            const ModdingFlowPublicApiResponse response = executeAnonymous(
                client_,
                "/mods/" + std::string(modId) + "/versions/" + std::string(versionId),
                operationId);
            if (response.operationId != operationId)
            {
                throw std::runtime_error("Catalog operation correlation is inconsistent.");
            }
            ModProviderVersion result = parseVersion(envelopeData(response.body));
            if (result.modId != modId || result.id != versionId)
            {
                throw std::runtime_error("Catalog version response identity is inconsistent.");
            }
            return result;
        });
    }

    std::vector<ModProviderDependency> ModdingFlowProviderCatalog::listDependencies(
        std::string_view modId,
        std::wstring_view operationId)
    {
        if (!isCanonicalUuid(modId))
        {
            throwInvalidCatalogRequest(operationId, "Catalog dependency mod id is invalid.");
        }
        return translateCatalogErrors(operationId, [&] {
            const ModdingFlowPublicApiResponse response = executeAnonymous(
                client_,
                "/mods/" + std::string(modId) + "/dependencies",
                operationId);
            if (response.operationId != operationId)
            {
                throw std::runtime_error("Catalog operation correlation is inconsistent.");
            }
            const JsonValue& items = requireMember(
                envelopeData(response.body),
                L"items",
                JsonValue::Type::Array);
            if (items.asArray().size() > maximumPageItems)
            {
                throw std::runtime_error("Catalog dependencies response exceeded 100 items.");
            }
            std::vector<ModProviderDependency> result;
            result.reserve(items.asArray().size());
            for (const JsonValue& item : items.asArray())
            {
                ModProviderDependency dependency = parseDependency(item);
                if (dependency.modId != modId)
                {
                    throw std::runtime_error("Catalog dependency binding is inconsistent.");
                }
                result.push_back(std::move(dependency));
            }
            return result;
        });
    }

}
