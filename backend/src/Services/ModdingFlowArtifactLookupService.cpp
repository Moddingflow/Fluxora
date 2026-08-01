#include "FluxoraCore/Services/ModdingFlowArtifactLookupService.hpp"

#include <algorithm>
#include <charconv>
#include <cctype>
#include <initializer_list>
#include <map>
#include <stdexcept>
#include <utility>

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumArtifactResponseBytes = 128U * 1024U;
        constexpr std::size_t maximumLocalizedEntries = 32U;
        constexpr std::size_t maximumHashEntries = 16U;

        [[noreturn]] void throwInvalidRequest(
            std::wstring_view operationId,
            std::string message)
        {
            throw ModdingFlowApiException(
                ModdingFlowApiErrorCode::InvalidRequest,
                std::move(message),
                std::wstring(operationId));
        }

        [[noreturn]] void throwInvalidResponse(std::wstring_view operationId)
        {
            throw ModdingFlowApiException(
                ModdingFlowApiErrorCode::ProtocolFailure,
                "Artifact metadata response violated its strict contract.",
                std::wstring(operationId));
        }

        [[nodiscard]] bool isValidOperationId(std::wstring_view value) noexcept
        {
            return !value.empty() && value.size() <= 256U &&
                std::none_of(value.begin(), value.end(), [](wchar_t character)
                {
                    return character < 0x20 || character == 0x7f;
                });
        }

        [[nodiscard]] bool isCanonicalUuid(std::string_view value) noexcept
        {
            if (value.size() != 36U || value[8] != '-' || value[13] != '-' ||
                value[18] != '-' || value[23] != '-')
            {
                return false;
            }
            for (std::size_t index = 0U; index < value.size(); ++index)
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

        [[nodiscard]] bool isCanonicalSlug(std::string_view value) noexcept
        {
            if (value.size() < 2U || value.size() > 81U)
            {
                return false;
            }
            const auto alphaNumeric = [](char character)
            {
                return (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9');
            };
            return alphaNumeric(value.front()) &&
                std::all_of(value.begin(), value.end(), [&](char character)
                {
                    return alphaNumeric(character) || character == '-';
                });
        }

        [[nodiscard]] bool hasUnsafeAscii(std::string_view value) noexcept
        {
            return std::any_of(value.begin(), value.end(), [](const unsigned char character)
            {
                return character < 0x20U || character == 0x7fU;
            });
        }

        [[nodiscard]] bool isLowerHex(std::string_view value, std::size_t length) noexcept
        {
            return value.size() == length &&
                std::all_of(value.begin(), value.end(), [](char character)
                {
                    return (character >= '0' && character <= '9') ||
                        (character >= 'a' && character <= 'f');
                });
        }

        [[nodiscard]] bool isUri(std::string_view value) noexcept
        {
            if (value.empty() || value.size() > 4096U || hasUnsafeAscii(value) ||
                value.find(' ') != std::string_view::npos)
            {
                return false;
            }
            const std::size_t colon = value.find(':');
            if (colon == std::string_view::npos || colon == 0U ||
                !std::isalpha(static_cast<unsigned char>(value.front())))
            {
                return false;
            }
            return std::all_of(value.begin() + 1, value.begin() + colon, [](char character)
            {
                return std::isalnum(static_cast<unsigned char>(character)) != 0 ||
                    character == '+' || character == '-' || character == '.';
            });
        }

        [[nodiscard]] bool isDateTime(std::string_view value) noexcept
        {
            return value.size() >= 20U && value.size() <= 64U && !hasUnsafeAscii(value) &&
                value[4] == '-' && value[7] == '-' && value[10] == 'T' &&
                value.find(':', 11U) != std::string_view::npos &&
                (value.back() == 'Z' || value.find('+', 11U) != std::string_view::npos ||
                    value.find('-', 11U) != std::string_view::npos);
        }

        void requireExactObject(
            const JsonValue& value,
            std::initializer_list<std::wstring_view> required,
            std::initializer_list<std::wstring_view> optional = {})
        {
            if (!value.isObject())
            {
                throw std::runtime_error("Artifact metadata member is not an object.");
            }
            for (const auto& [key, member] : value.asObject())
            {
                (void)member;
                const auto matches = [&](std::wstring_view allowed)
                {
                    return key == allowed;
                };
                if (std::none_of(required.begin(), required.end(), matches) &&
                    std::none_of(optional.begin(), optional.end(), matches))
                {
                    throw std::runtime_error("Artifact metadata object contains an unknown member.");
                }
            }
            for (const std::wstring_view key : required)
            {
                if (value.find(key) == nullptr)
                {
                    throw std::runtime_error("Artifact metadata object is missing a member.");
                }
            }
        }

        [[nodiscard]] const JsonValue& requireMember(
            const JsonValue& object,
            std::wstring_view key,
            JsonValue::Type type)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Artifact metadata parent is not an object.");
            }
            const JsonValue* value = object.find(key);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("Artifact metadata member has an invalid type.");
            }
            return *value;
        }

        [[nodiscard]] std::string jsonString(
            const JsonValue& value,
            std::size_t maximumBytes,
            bool allowEmpty = false)
        {
            if (!value.isString())
            {
                throw std::runtime_error("Artifact metadata string has an invalid type.");
            }
            std::string result = moddingFlowJsonStringToUtf8(value.asString());
            if (result.size() > maximumBytes || (!allowEmpty && result.empty()) ||
                hasUnsafeAscii(result))
            {
                throw std::runtime_error("Artifact metadata string exceeded its bounds.");
            }
            return result;
        }

        [[nodiscard]] std::string requiredString(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximumBytes,
            bool allowEmpty = false)
        {
            return jsonString(
                requireMember(object, key, JsonValue::Type::String),
                maximumBytes,
                allowEmpty);
        }

        [[nodiscard]] std::optional<std::string> nullableString(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximumBytes,
            bool requiredPresence)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Artifact metadata parent is not an object.");
            }
            const JsonValue* value = object.find(key);
            if (value == nullptr)
            {
                if (requiredPresence)
                {
                    throw std::runtime_error("Artifact metadata nullable member is missing.");
                }
                return std::nullopt;
            }
            if (value->isNull())
            {
                return std::nullopt;
            }
            return jsonString(*value, maximumBytes, true);
        }

        [[nodiscard]] std::uint64_t unsignedInteger(const JsonValue& value)
        {
            if (!value.isNumber() || value.asNumber().empty() || value.asNumber().size() > 20U)
            {
                throw std::runtime_error("Artifact metadata integer is invalid.");
            }
            std::string ascii;
            ascii.reserve(value.asNumber().size());
            for (const wchar_t character : value.asNumber())
            {
                if (character < L'0' || character > L'9')
                {
                    throw std::runtime_error("Artifact metadata integer is invalid.");
                }
                ascii.push_back(static_cast<char>(character));
            }
            std::uint64_t result = 0U;
            const auto [end, error] = std::from_chars(
                ascii.data(), ascii.data() + ascii.size(), result);
            if (error != std::errc{} || end != ascii.data() + ascii.size())
            {
                throw std::runtime_error("Artifact metadata integer is invalid.");
            }
            return result;
        }

        [[nodiscard]] std::map<std::string, std::string> localizedMap(
            const JsonValue& value,
            std::size_t maximumValueBytes)
        {
            if (!value.isObject() || value.asObject().empty() ||
                value.asObject().size() > maximumLocalizedEntries)
            {
                throw std::runtime_error("Artifact metadata localized map is invalid.");
            }
            std::map<std::string, std::string> result;
            std::size_t totalBytes = 0U;
            for (const auto& [wideLocale, localized] : value.asObject())
            {
                const std::string locale = moddingFlowJsonStringToUtf8(wideLocale);
                if (locale.empty() || locale.size() > 35U ||
                    !std::all_of(locale.begin(), locale.end(), [](char character)
                    {
                        return std::isalnum(static_cast<unsigned char>(character)) != 0 ||
                            character == '-';
                    }))
                {
                    throw std::runtime_error("Artifact metadata locale is invalid.");
                }
                std::string text = jsonString(localized, maximumValueBytes, true);
                totalBytes += locale.size() + text.size();
                if (totalBytes > 64U * 1024U)
                {
                    throw std::runtime_error("Artifact metadata localized map is too large.");
                }
                result.emplace(locale, std::move(text));
            }
            return result;
        }

        [[nodiscard]] std::vector<std::string> stringArray(
            const JsonValue& object,
            std::wstring_view key)
        {
            const JsonValue& value = requireMember(object, key, JsonValue::Type::Array);
            if (value.asArray().size() > 64U)
            {
                throw std::runtime_error("Artifact metadata string array is too large.");
            }
            std::vector<std::string> result;
            result.reserve(value.asArray().size());
            for (const JsonValue& item : value.asArray())
            {
                result.push_back(jsonString(item, 80U, true));
            }
            return result;
        }

        using IntegrityHashes = std::map<std::string, std::optional<std::string>>;

        [[nodiscard]] IntegrityHashes parseHashes(const JsonValue& value)
        {
            if (!value.isObject() || value.asObject().empty() ||
                value.asObject().size() > maximumHashEntries)
            {
                throw std::runtime_error("Artifact metadata hashes are invalid.");
            }
            IntegrityHashes result;
            std::size_t totalBytes = 0U;
            for (const auto& [wideAlgorithm, digestValue] : value.asObject())
            {
                const std::string algorithm = moddingFlowJsonStringToUtf8(wideAlgorithm);
                if (algorithm.empty() || algorithm.size() > 32U ||
                    !std::all_of(algorithm.begin(), algorithm.end(), [](char character)
                    {
                        return (character >= 'a' && character <= 'z') ||
                            (character >= '0' && character <= '9') || character == '-';
                    }))
                {
                    throw std::runtime_error("Artifact metadata hash algorithm is invalid.");
                }
                std::optional<std::string> digest;
                if (!digestValue.isNull())
                {
                    digest = jsonString(digestValue, 256U);
                }
                totalBytes += algorithm.size() + (digest ? digest->size() : 0U);
                if (totalBytes > 8U * 1024U || !result.emplace(algorithm, digest).second)
                {
                    throw std::runtime_error("Artifact metadata hashes exceeded bounds.");
                }
            }
            const auto sha = result.find("sha256");
            if (sha == result.end() || !sha->second.has_value() ||
                !isLowerHex(*sha->second, 64U))
            {
                throw std::runtime_error("Artifact metadata SHA-256 is invalid.");
            }
            const auto sha1 = result.find("sha1");
            if (sha1 != result.end() && sha1->second.has_value() &&
                !isLowerHex(*sha1->second, 40U))
            {
                throw std::runtime_error("Artifact metadata SHA-1 is invalid.");
            }
            const auto md5 = result.find("md5");
            if (md5 != result.end() && md5->second.has_value() &&
                !isLowerHex(*md5->second, 32U))
            {
                throw std::runtime_error("Artifact metadata MD5 is invalid.");
            }
            return result;
        }

        [[nodiscard]] bool isOneOf(
            std::string_view value,
            std::initializer_list<std::string_view> allowed) noexcept
        {
            return std::find(allowed.begin(), allowed.end(), value) != allowed.end();
        }

        [[nodiscard]] ModdingFlowArtifactPreview parsePreview(
            const JsonValue& root,
            std::string_view requestedArtifactId,
            std::wstring_view operationId)
        {
            requireExactObject(root, {L"ok", L"data"});
            if (!requireMember(root, L"ok", JsonValue::Type::Boolean).asBoolean())
            {
                throw std::runtime_error("Artifact metadata envelope is not successful.");
            }
            const JsonValue& data = requireMember(root, L"data", JsonValue::Type::Object);
            requireExactObject(data, {
                L"artifact_id", L"mod_id", L"version_id", L"game", L"mod",
                L"version", L"artifact", L"distribution", L"verification", L"download"});

            ModdingFlowArtifactPreview result;
            result.operationId = operationId;
            result.artifactId = requiredString(data, L"artifact_id", 36U);
            result.modId = requiredString(data, L"mod_id", 36U);
            result.versionId = requiredString(data, L"version_id", 36U);
            if (!isCanonicalUuid(result.artifactId) || result.artifactId != requestedArtifactId ||
                !isCanonicalUuid(result.modId) || !isCanonicalUuid(result.versionId))
            {
                throw std::runtime_error("Artifact metadata top-level provenance is invalid.");
            }

            const JsonValue& game = requireMember(data, L"game", JsonValue::Type::Object);
            requireExactObject(game, {L"id", L"slug"});
            result.gameId = requiredString(game, L"id", 36U);
            result.gameSlug = requiredString(game, L"slug", 81U);
            if (!isCanonicalUuid(result.gameId) || !isCanonicalSlug(result.gameSlug))
            {
                throw std::runtime_error("Artifact metadata game provenance is invalid.");
            }

            const JsonValue& mod = requireMember(data, L"mod", JsonValue::Type::Object);
            requireExactObject(mod,
                {L"id", L"slug", L"game_slug", L"title", L"visibility",
                    L"access_tier", L"links"},
                {L"summary", L"author"});
            const std::string boundModId = requiredString(mod, L"id", 36U);
            result.modSlug = requiredString(mod, L"slug", 81U);
            const std::string modGameSlug = requiredString(mod, L"game_slug", 81U);
            result.title = localizedMap(
                requireMember(mod, L"title", JsonValue::Type::Object), 4096U);
            if (const JsonValue* summary = mod.find(L"summary"); summary != nullptr)
            {
                result.summary = localizedMap(*summary, 16U * 1024U);
            }
            if (const JsonValue* author = mod.find(L"author"); author != nullptr && !author->isNull())
            {
                requireExactObject(*author, {L"display_name", L"profile_url"});
                result.authorDisplayName = requiredString(*author, L"display_name", 512U);
                const std::optional<std::string> profileUrl = nullableString(
                    *author, L"profile_url", 4096U, true);
                if (profileUrl.has_value() && !isUri(*profileUrl))
                {
                    throw std::runtime_error("Artifact metadata author URI is invalid.");
                }
            }
            const std::string visibility = requiredString(mod, L"visibility", 16U);
            result.accessTier = requiredString(mod, L"access_tier", 32U);
            if (boundModId != result.modId || !isCanonicalSlug(result.modSlug) ||
                modGameSlug != result.gameSlug || visibility != "public" ||
                !isOneOf(result.accessTier, {"public", "authenticated", "paid", "restricted"}))
            {
                throw std::runtime_error("Artifact metadata mod provenance is invalid.");
            }
            const JsonValue& links = requireMember(mod, L"links", JsonValue::Type::Object);
            requireExactObject(links, {L"web", L"api", L"versions"});
            for (const std::wstring_view key : {L"web", L"api", L"versions"})
            {
                if (!isUri(requiredString(links, key, 4096U)))
                {
                    throw std::runtime_error("Artifact metadata mod URI is invalid.");
                }
            }

            const JsonValue& version = requireMember(data, L"version", JsonValue::Type::Object);
            requireExactObject(version, {
                L"id", L"mod_id", L"primary_artifact_id", L"version", L"semantic_version",
                L"release_channel", L"game_versions", L"loaders", L"published_at", L"updated_at"});
            const std::string boundVersionId = requiredString(version, L"id", 36U);
            const std::string versionModId = requiredString(version, L"mod_id", 36U);
            result.primaryArtifactId = requiredString(version, L"primary_artifact_id", 36U);
            result.version = requiredString(version, L"version", 512U);
            result.semanticVersion = nullableString(version, L"semantic_version", 120U, true);
            result.releaseChannel = requiredString(version, L"release_channel", 32U);
            result.gameVersions = stringArray(version, L"game_versions");
            result.loaders = stringArray(version, L"loaders");
            const std::string publishedAt = requiredString(version, L"published_at", 64U);
            const std::string updatedAt = requiredString(version, L"updated_at", 64U);
            if (boundVersionId != result.versionId || versionModId != result.modId ||
                !isCanonicalUuid(result.primaryArtifactId) ||
                !isOneOf(result.releaseChannel, {"stable", "beta", "alpha", "experimental"}) ||
                !isDateTime(publishedAt) || !isDateTime(updatedAt))
            {
                throw std::runtime_error("Artifact metadata version provenance is invalid.");
            }

            const JsonValue& artifact = requireMember(data, L"artifact", JsonValue::Type::Object);
            requireExactObject(artifact, {
                L"id", L"mod_id", L"version_id", L"file_kind", L"file_version", L"label",
                L"filename", L"original_filename", L"content_type", L"game_version_key",
                L"loader_key", L"size_bytes", L"hashes", L"artifact_source", L"status",
                L"scan_status"});
            const std::string boundArtifactId = requiredString(artifact, L"id", 36U);
            const std::string artifactModId = requiredString(artifact, L"mod_id", 36U);
            const std::string artifactVersionId = requiredString(artifact, L"version_id", 36U);
            result.fileKind = requiredString(artifact, L"file_kind", 16U);
            result.fileVersion = requiredString(artifact, L"file_version", 512U);
            result.label = nullableString(artifact, L"label", 512U, true);
            result.filename = requiredString(artifact, L"filename", 512U);
            result.originalFilename = requiredString(artifact, L"original_filename", 512U);
            result.contentType = requiredString(artifact, L"content_type", 255U);
            result.gameVersionKey = nullableString(artifact, L"game_version_key", 80U, true);
            result.loaderKey = nullableString(artifact, L"loader_key", 80U, true);
            result.sizeBytes = unsignedInteger(
                requireMember(artifact, L"size_bytes", JsonValue::Type::Number));
            const IntegrityHashes artifactHashes = parseHashes(
                requireMember(artifact, L"hashes", JsonValue::Type::Object));
            result.sha256 = *artifactHashes.at("sha256");
            const std::string artifactSource = requiredString(artifact, L"artifact_source", 32U);
            const std::string status = requiredString(artifact, L"status", 32U);
            const std::string scanStatus = requiredString(artifact, L"scan_status", 32U);
            if (boundArtifactId != result.artifactId || artifactModId != result.modId ||
                artifactVersionId != result.versionId ||
                !isOneOf(result.fileKind, {"main", "optional", "old"}) ||
                result.sizeBytes == 0U || artifactSource != "r2_blob" ||
                status != "published" || scanStatus != "clean")
            {
                throw std::runtime_error("Artifact metadata artifact provenance is invalid.");
            }

            const JsonValue& distribution = requireMember(
                data, L"distribution", JsonValue::Type::Object);
            requireExactObject(
                distribution, {L"service", L"website_url", L"mod_url", L"api_url"});
            if (requiredString(distribution, L"service", 32U) != "moddingflow")
            {
                throw std::runtime_error("Artifact metadata distribution is invalid.");
            }
            for (const std::wstring_view key : {L"website_url", L"mod_url", L"api_url"})
            {
                if (!isUri(requiredString(distribution, key, 4096U)))
                {
                    throw std::runtime_error("Artifact metadata distribution URI is invalid.");
                }
            }

            const JsonValue& verification = requireMember(
                data, L"verification", JsonValue::Type::Object);
            requireExactObject(verification, {L"hashes", L"size_bytes"});
            const IntegrityHashes verificationHashes = parseHashes(
                requireMember(verification, L"hashes", JsonValue::Type::Object));
            const std::uint64_t verificationSize = unsignedInteger(
                requireMember(verification, L"size_bytes", JsonValue::Type::Number));
            if (verificationHashes != artifactHashes || verificationSize != result.sizeBytes)
            {
                throw std::runtime_error("Artifact metadata verification is inconsistent.");
            }

            const JsonValue& download = requireMember(data, L"download", JsonValue::Type::Object);
            requireExactObject(download, {L"resolve_endpoint"});
            const std::string expectedResolveEndpoint =
                "/v1/downloads/" + result.artifactId + "/resolve";
            if (requiredString(download, L"resolve_endpoint", 160U) != expectedResolveEndpoint)
            {
                throw std::runtime_error("Artifact metadata resolve endpoint is inconsistent.");
            }
            return result;
        }
    }

    ModdingFlowArtifactLookupService::ModdingFlowArtifactLookupService(
        IModdingFlowPublicApiClient& client) noexcept
        : client_(client)
    {
    }

    ModdingFlowArtifactPreview ModdingFlowArtifactLookupService::lookup(
        std::string_view artifactId,
        ModdingFlowArtifactLookupAuthMode authMode,
        std::wstring_view operationId)
    {
        if (!isCanonicalUuid(artifactId) || !isValidOperationId(operationId))
        {
            throwInvalidRequest(operationId, "Artifact metadata lookup request is invalid.");
        }

        ModdingFlowPublicApiRequest request;
        request.method = ModdingFlowHttpMethod::Get;
        request.pathAndQuery = "/artifacts/" + std::string(artifactId);
        request.retry = ModdingFlowApiRetryMode::ReadOnly;
        request.operationId = std::wstring(operationId);
        request.maximumResponseBytes = maximumArtifactResponseBytes;
        switch (authMode)
        {
        case ModdingFlowArtifactLookupAuthMode::Anonymous:
            request.auth = ModdingFlowApiAuthMode::Anonymous;
            break;
        case ModdingFlowArtifactLookupAuthMode::BearerModsRead:
            request.auth = ModdingFlowApiAuthMode::BearerRequired;
            request.requiredScope = "mods:read";
            break;
        default:
            throwInvalidRequest(operationId, "Artifact metadata lookup auth mode is invalid.");
        }

        try
        {
            const ModdingFlowPublicApiResponse response = client_.execute(request);
            if (response.operationId != operationId)
            {
                throw std::runtime_error("Artifact metadata operation correlation is inconsistent.");
            }
            return parsePreview(response.body, artifactId, operationId);
        }
        catch (const ModdingFlowApiException&)
        {
            throw;
        }
        catch (const std::exception&)
        {
            throwInvalidResponse(operationId);
        }
    }
}
