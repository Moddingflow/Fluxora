#include "FluxoraCore/Services/ModdingFlowRemoteDownloadResolver.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cctype>
#include <limits>
#include <set>
#include <stdexcept>
#include <utility>

namespace fluxora
{
    namespace
    {
        constexpr std::string_view providerId = "moddingflow";
        constexpr std::string_view fallbackRepresentationProviderId = "bunny_pull_cdn";
        constexpr std::size_t maximumUrlBytes = 16U * 1024U;
        constexpr std::size_t maximumHashEntries = 16U;
        constexpr std::chrono::seconds expiryClockTolerance{60};
        constexpr std::array<std::string_view, 4U> conditionalHeaderContract{
            "If-Match",
            "If-None-Match",
            "If-Modified-Since",
            "If-Unmodified-Since"};
        constexpr std::array<std::string_view, 5U> externalRepresentationProviders{
            "github", "modrinth", "hangar", "codeberg", "modio"};

        [[noreturn]] void throwInvalidRequest(std::wstring_view operationId)
        {
            throw ModdingFlowApiException(
                ModdingFlowApiErrorCode::InvalidRequest,
                "ModdingFlow download resolve request is invalid.",
                std::wstring(operationId));
        }

        [[noreturn]] void throwInvalidResponse(std::wstring_view operationId)
        {
            throw ModdingFlowApiException(
                ModdingFlowApiErrorCode::ProtocolFailure,
                "ModdingFlow download resolve response is invalid.",
                std::wstring(operationId));
        }

        std::uint64_t currentUnixMilliseconds()
        {
            const auto now = std::chrono::time_point_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now());
            const auto count = now.time_since_epoch().count();
            if (count <= 0)
            {
                throw std::runtime_error("System clock is outside the supported range.");
            }
            return static_cast<std::uint64_t>(count);
        }

        bool isCanonicalUuid(std::string_view value) noexcept
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

        bool isLowerHex(std::string_view value, std::size_t length) noexcept
        {
            return value.size() == length &&
                std::all_of(value.begin(), value.end(), [](const char character) {
                    return (character >= '0' && character <= '9') ||
                        (character >= 'a' && character <= 'f');
                });
        }

        bool isSafeSignedHttpsUrl(std::string_view value) noexcept
        {
            constexpr std::string_view scheme = "https://";
            if (value.size() <= scheme.size() || value.size() > maximumUrlBytes ||
                !value.starts_with(scheme) || value.find('#') != std::string_view::npos ||
                value.find('\\') != std::string_view::npos)
            {
                return false;
            }
            if (std::any_of(value.begin(), value.end(), [](const unsigned char character) {
                    return character < 0x20U || character == 0x7fU;
                }))
            {
                return false;
            }

            const std::size_t authorityEnd = value.find_first_of("/?", scheme.size());
            const std::string_view authority = value.substr(
                scheme.size(),
                authorityEnd == std::string_view::npos
                    ? std::string_view::npos
                    : authorityEnd - scheme.size());
            if (authority.empty() || authority.find('@') != std::string_view::npos ||
                authority.find(':') != std::string_view::npos ||
                authority.front() == '.' || authority.back() == '.')
            {
                return false;
            }

            bool labelStart = true;
            for (const char character : authority)
            {
                if (character == '.')
                {
                    if (labelStart)
                    {
                        return false;
                    }
                    labelStart = true;
                    continue;
                }
                const bool alphanumeric =
                    (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9');
                if (!alphanumeric && character != '-')
                {
                    return false;
                }
                if (labelStart && character == '-')
                {
                    return false;
                }
                labelStart = false;
            }
            return !labelStart && authority.back() != '-';
        }

        const JsonValue& requireMember(
            const JsonValue& object,
            std::wstring_view key,
            JsonValue::Type type)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Download JSON value is not an object.");
            }
            const JsonValue* value = object.find(key);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("Download JSON member has an invalid type.");
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
                throw std::runtime_error("Download JSON string has an invalid type.");
            }
            std::string result = moddingFlowJsonStringToUtf8(value.asString());
            if (result.size() > maximum || (!allowEmpty && result.empty()))
            {
                throw std::runtime_error("Download JSON string exceeded its bounds.");
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
            bool required)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Download JSON value is not an object.");
            }
            const JsonValue* value = object.find(key);
            if (value == nullptr)
            {
                if (required)
                {
                    throw std::runtime_error("Download JSON member is missing.");
                }
                return std::nullopt;
            }
            if (value->isNull())
            {
                return std::nullopt;
            }
            return jsonString(*value, maximum);
        }

        std::uint64_t unsignedInteger(const JsonValue& value)
        {
            if (!value.isNumber())
            {
                throw std::runtime_error("Download JSON integer has an invalid type.");
            }
            const std::wstring& wide = value.asNumber();
            if (wide.empty() || wide.size() > 20U)
            {
                throw std::runtime_error("Download JSON integer is invalid.");
            }
            std::string ascii;
            ascii.reserve(wide.size());
            for (const wchar_t character : wide)
            {
                if (character < L'0' || character > L'9')
                {
                    throw std::runtime_error("Download JSON integer is invalid.");
                }
                ascii.push_back(static_cast<char>(character));
            }
            std::uint64_t result = 0U;
            const auto [end, error] = std::from_chars(
                ascii.data(), ascii.data() + ascii.size(), result);
            if (error != std::errc{} || end != ascii.data() + ascii.size())
            {
                throw std::runtime_error("Download JSON integer is invalid.");
            }
            return result;
        }

        std::uint64_t requiredUnsigned(
            const JsonValue& object,
            std::wstring_view key)
        {
            return unsignedInteger(requireMember(object, key, JsonValue::Type::Number));
        }

        bool requiredBoolean(const JsonValue& object, std::wstring_view key)
        {
            return requireMember(object, key, JsonValue::Type::Boolean).asBoolean();
        }

        const JsonValue& envelopeData(const JsonValue& root)
        {
            if (!root.isObject() || !requiredBoolean(root, L"ok"))
            {
                throw std::runtime_error("Download response envelope is invalid.");
            }
            return requireMember(root, L"data", JsonValue::Type::Object);
        }

        std::map<std::string, std::string> parseHashes(const JsonValue& value)
        {
            if (!value.isObject() || value.asObject().empty() ||
                value.asObject().size() > maximumHashEntries)
            {
                throw std::runtime_error("Download hashes are invalid.");
            }
            std::map<std::string, std::string> result;
            for (const auto& [wideAlgorithm, digestValue] : value.asObject())
            {
                const std::string algorithm = moddingFlowJsonStringToUtf8(wideAlgorithm);
                if (algorithm.empty() || algorithm.size() > 32U)
                {
                    throw std::runtime_error("Download hash algorithm is invalid.");
                }
                if (digestValue.isNull())
                {
                    if (algorithm == "sha256")
                    {
                        throw std::runtime_error("Download SHA-256 is null.");
                    }
                    continue;
                }
                if (!digestValue.isString())
                {
                    throw std::runtime_error("Download hash value is invalid.");
                }
                std::string digest = jsonString(digestValue, 256U);
                const std::size_t expectedLength = algorithm == "sha256"
                    ? 64U
                    : algorithm == "sha512"
                        ? 128U
                        : algorithm == "sha1" ? 40U : algorithm == "md5" ? 32U : 0U;
                if (expectedLength == 0U)
                {
                    throw std::runtime_error("Download hash algorithm is unsupported.");
                }
                if (!isLowerHex(digest, expectedLength))
                {
                    throw std::runtime_error("Download hash is not canonical.");
                }
                result.emplace(algorithm, std::move(digest));
            }
            if (!result.contains("sha256"))
            {
                throw std::runtime_error("Download SHA-256 is missing.");
            }
            return result;
        }

        void validateConditionalHeaders(const JsonValue& value)
        {
            if (!value.isArray() || value.asArray().size() != conditionalHeaderContract.size())
            {
                throw std::runtime_error("Download conditional-header contract is invalid.");
            }
            std::set<std::string> actual;
            for (const JsonValue& item : value.asArray())
            {
                actual.insert(jsonString(item, 64U));
            }
            const std::set<std::string> expected(
                conditionalHeaderContract.begin(), conditionalHeaderContract.end());
            if (actual != expected)
            {
                throw std::runtime_error("Download conditional-header contract is invalid.");
            }
        }

        void validateNoConditionalHeaders(const JsonValue& value)
        {
            if (!value.isArray() || !value.asArray().empty())
            {
                throw std::runtime_error(
                    "External download must not advertise conditional headers.");
            }
        }

        bool isExternalRepresentationProvider(std::string_view value) noexcept
        {
            return std::find(
                externalRepresentationProviders.begin(),
                externalRepresentationProviders.end(),
                value) != externalRepresentationProviders.end();
        }

        int fixedDigits(std::string_view value, std::size_t offset, std::size_t count)
        {
            int result = 0;
            for (std::size_t index = 0U; index < count; ++index)
            {
                const char character = value[offset + index];
                if (character < '0' || character > '9')
                {
                    throw std::runtime_error("Download expiry is invalid.");
                }
                result = result * 10 + (character - '0');
            }
            return result;
        }

        std::uint64_t parseUtcMilliseconds(std::string_view value)
        {
            if (value.size() != 24U || value[4] != '-' || value[7] != '-' ||
                value[10] != 'T' || value[13] != ':' || value[16] != ':' ||
                value[19] != '.' || value[23] != 'Z')
            {
                throw std::runtime_error("Download expiry is invalid.");
            }

            const int year = fixedDigits(value, 0U, 4U);
            const unsigned month = static_cast<unsigned>(fixedDigits(value, 5U, 2U));
            const unsigned day = static_cast<unsigned>(fixedDigits(value, 8U, 2U));
            const int hour = fixedDigits(value, 11U, 2U);
            const int minute = fixedDigits(value, 14U, 2U);
            const int second = fixedDigits(value, 17U, 2U);
            const int millisecond = fixedDigits(value, 20U, 3U);
            const std::chrono::year_month_day date{
                std::chrono::year(year),
                std::chrono::month(month),
                std::chrono::day(day)};
            if (!date.ok() || hour > 23 || minute > 59 || second > 59)
            {
                throw std::runtime_error("Download expiry is invalid.");
            }
            const auto point = std::chrono::sys_days(date) +
                std::chrono::hours(hour) + std::chrono::minutes(minute) +
                std::chrono::seconds(second) + std::chrono::milliseconds(millisecond);
            const auto count = std::chrono::duration_cast<std::chrono::milliseconds>(
                point.time_since_epoch()).count();
            if (count <= 0)
            {
                throw std::runtime_error("Download expiry is invalid.");
            }
            return static_cast<std::uint64_t>(count);
        }

        void validateExpiration(
            std::uint64_t expiresAt,
            std::uint64_t now,
            std::uint64_t ttlSeconds,
            std::uint64_t refreshAfterSeconds,
            const ModdingFlowRemoteDownloadResolverOptions& options)
        {
            const std::uint64_t minimumRemaining = static_cast<std::uint64_t>(
                options.minimumRemainingLifetime.count()) * 1000U;
            const std::uint64_t maximumRemaining = static_cast<std::uint64_t>(
                options.maximumLifetime.count()) * 1000U;
            if (now > (std::numeric_limits<std::uint64_t>::max)() - minimumRemaining ||
                expiresAt <= now + minimumRemaining || expiresAt - now > maximumRemaining ||
                ttlSeconds == 0U || refreshAfterSeconds == 0U ||
                refreshAfterSeconds >= ttlSeconds ||
                ttlSeconds > static_cast<std::uint64_t>(options.maximumLifetime.count()))
            {
                throw std::runtime_error("Download expiry is outside the safe lifetime.");
            }

            const std::uint64_t advertisedLifetime = ttlSeconds * 1000U;
            const std::uint64_t actualLifetime = expiresAt - now;
            const std::uint64_t tolerance = static_cast<std::uint64_t>(
                expiryClockTolerance.count()) * 1000U;
            const std::uint64_t difference = actualLifetime > advertisedLifetime
                ? actualLifetime - advertisedLifetime
                : advertisedLifetime - actualLifetime;
            if (difference > tolerance)
            {
                throw std::runtime_error("Download expiry and TTL are inconsistent.");
            }
        }

        void validateFallbackExpiration(
            std::uint64_t expiresAt,
            std::uint64_t now,
            std::uint64_t ttlSeconds,
            const ModdingFlowRemoteDownloadResolverOptions& options)
        {
            const std::uint64_t minimumRemaining = static_cast<std::uint64_t>(
                options.minimumRemainingLifetime.count()) * 1000U;
            const std::uint64_t maximumRemaining = static_cast<std::uint64_t>(
                options.maximumLifetime.count()) * 1000U;
            if (now > (std::numeric_limits<std::uint64_t>::max)() - minimumRemaining ||
                expiresAt <= now + minimumRemaining || expiresAt - now > maximumRemaining ||
                ttlSeconds == 0U ||
                ttlSeconds > static_cast<std::uint64_t>(options.maximumLifetime.count()))
            {
                throw std::runtime_error("Download fallback expiry is outside the safe lifetime.");
            }

            const std::uint64_t advertisedLifetime = ttlSeconds * 1000U;
            const std::uint64_t actualLifetime = expiresAt - now;
            const std::uint64_t tolerance = static_cast<std::uint64_t>(
                expiryClockTolerance.count()) * 1000U;
            const std::uint64_t difference = actualLifetime > advertisedLifetime
                ? actualLifetime - advertisedLifetime
                : advertisedLifetime - actualLifetime;
            if (difference > tolerance)
            {
                throw std::runtime_error("Download fallback expiry and TTL are inconsistent.");
            }
        }

        std::vector<std::string> artifactIds(const JsonValue& version)
        {
            const JsonValue& values = requireMember(
                version, L"artifact_ids", JsonValue::Type::Array);
            if (values.asArray().empty() || values.asArray().size() > 128U)
            {
                throw std::runtime_error("Download version artifact set is invalid.");
            }
            std::vector<std::string> result;
            std::set<std::string> unique;
            for (const JsonValue& value : values.asArray())
            {
                std::string id = jsonString(value, 36U);
                if (!isCanonicalUuid(id) || !unique.insert(id).second)
                {
                    throw std::runtime_error("Download version artifact set is invalid.");
                }
                result.push_back(std::move(id));
            }
            return result;
        }

        struct RepresentationContract
        {
            std::string provider;
            std::optional<std::string> etag;
            std::optional<std::string> ifMatch;
            bool requiresHeadBeforeRange{false};
        };

        RepresentationContract parseRepresentation(
            const JsonValue& value,
            std::string_view expectedHeadUrl,
            bool external)
        {
            const std::string provider = requiredString(value, L"provider", 32U);
            const std::string scope = requiredString(value, L"etag_scope", 32U);
            const std::optional<std::string> etag = nullableString(value, L"etag", 512U, true);
            const std::optional<std::string> ifMatch = nullableString(value, L"if_match", 512U, true);
            const std::string headUrl = requiredString(value, L"head_url", maximumUrlBytes);
            const bool requiresHeadBeforeRange = requiredBoolean(
                value, L"requires_head_before_range");
            const bool providerAllowed = external
                ? isExternalRepresentationProvider(provider)
                : provider == "cloudflare_r2" || provider == "bunny_pull_cdn";
            if (!providerAllowed ||
                scope != provider || etag != ifMatch || headUrl != expectedHeadUrl ||
                !isSafeSignedHttpsUrl(headUrl))
            {
                throw std::runtime_error("Download representation scope is invalid.");
            }
            return {provider, etag, ifMatch, requiresHeadBeforeRange};
        }

        ResolvedDownloadGrant parseGrant(
            const ModdingFlowPublicApiResponse& response,
            const RemoteArtifactDownloadRequest& request,
            const ModdingFlowRemoteDownloadResolverOptions& options)
        {
            if (response.operationId != request.operationId)
            {
                throw std::runtime_error("Download operation correlation is invalid.");
            }
            const JsonValue& data = envelopeData(response.body);
            const JsonValue& mod = requireMember(data, L"mod", JsonValue::Type::Object);
            const JsonValue& version = requireMember(data, L"version", JsonValue::Type::Object);
            const JsonValue& artifact = requireMember(data, L"artifact", JsonValue::Type::Object);
            const JsonValue& distribution = requireMember(
                data, L"distribution", JsonValue::Type::Object);
            const std::vector<std::string> versionArtifactIds = artifactIds(version);
            if (requiredString(mod, L"id", 36U) != request.modId ||
                requiredString(version, L"id", 36U) != request.versionId ||
                requiredString(version, L"mod_id", 36U) != request.modId ||
                std::find(versionArtifactIds.begin(), versionArtifactIds.end(), request.artifactId) ==
                    versionArtifactIds.end() ||
                requiredString(artifact, L"id", 36U) != request.artifactId ||
                requiredString(artifact, L"mod_id", 36U) != request.modId ||
                requiredString(artifact, L"version_id", 36U) != request.versionId ||
                requiredString(distribution, L"service", 32U) != providerId ||
                requiredString(data, L"artifact_id", 36U) != request.artifactId)
            {
                throw std::runtime_error("Download provenance is inconsistent.");
            }

            const std::uint64_t artifactSize = requiredUnsigned(artifact, L"size_bytes");
            const std::string artifactSha = requiredString(artifact, L"sha256", 64U);
            const std::map<std::string, std::string> artifactHashes = parseHashes(
                requireMember(artifact, L"hashes", JsonValue::Type::Object));
            const JsonValue& downloadMetadata = requireMember(
                artifact, L"download_metadata", JsonValue::Type::Object);
            const std::string artifactSource = requiredString(
                artifact, L"artifact_source", 32U);
            const bool externalReference =
                artifactSource == "external_provider_reference";
            const std::string resolveEndpoint =
                "/v1/downloads/" + request.artifactId + "/resolve";
            const std::string fallbackEndpoint =
                "/v1/downloads/" + request.artifactId + "/fallback";
            const bool artifactRangeSupported = requiredBoolean(
                downloadMetadata, L"range_supported");
            if (artifactSize == 0U || !isLowerHex(artifactSha, 64U) ||
                artifactHashes.at("sha256") != artifactSha ||
                (artifactSource != "r2_blob" && !externalReference) ||
                requiredString(artifact, L"status", 32U) != "published" ||
                requiredString(artifact, L"scan_status", 32U) != "clean" ||
                requiredString(downloadMetadata, L"resolve_endpoint", 160U) != resolveEndpoint ||
                (!externalReference && !artifactRangeSupported))
            {
                throw std::runtime_error("Download artifact is not eligible.");
            }

            const std::string grantId = requiredString(data, L"download_session_id", 36U);
            const JsonValue& job = requireMember(data, L"download_job", JsonValue::Type::Object);
            const JsonValue& grant = requireMember(data, L"download_grant", JsonValue::Type::Object);
            const std::uint64_t jobBytes = requiredUnsigned(job, L"bytes_received");
            if (!isCanonicalUuid(grantId) || requiredString(job, L"id", 36U) != request.jobId ||
                requiredString(job, L"grant_id", 36U) != grantId ||
                requiredString(job, L"artifact_id", 36U) != request.artifactId ||
                requiredString(job, L"status", 32U) != "grant_active" ||
                jobBytes > artifactSize ||
                requiredUnsigned(job, L"provider_effect_count") != 1U ||
                requiredString(grant, L"id", 36U) != grantId ||
                requiredString(grant, L"artifact_id", 36U) != request.artifactId ||
                requiredString(grant, L"status", 32U) != "active" ||
                requiredString(grant, L"resolve_endpoint", 160U) != resolveEndpoint)
            {
                throw std::runtime_error("Download job or grant provenance is inconsistent.");
            }
            const std::optional<std::string> grantFallbackEndpoint = nullableString(
                grant, L"fallback_endpoint", 160U, true);
            if ((!externalReference && grantFallbackEndpoint != fallbackEndpoint) ||
                (externalReference && grantFallbackEndpoint.has_value()))
            {
                throw std::runtime_error("Download fallback capability is inconsistent.");
            }
            static_cast<void>(requiredUnsigned(job, L"attempt_count"));
            static_cast<void>(requiredUnsigned(job, L"rate_limit_count"));

            const std::string expiresAtText = requiredString(data, L"expires_at", 64U);
            if (requiredString(grant, L"expires_at", 64U) != expiresAtText)
            {
                throw std::runtime_error("Download grant expiry is inconsistent.");
            }
            const std::uint64_t expiresAt = parseUtcMilliseconds(expiresAtText);
            const std::uint64_t ttlSeconds = requiredUnsigned(grant, L"ttl_seconds");
            const std::uint64_t refreshAfter = requiredUnsigned(
                grant, L"refresh_after_seconds");
            if (requiredUnsigned(data, L"expires_in") != ttlSeconds ||
                requiredUnsigned(data, L"refresh_after_seconds") != refreshAfter)
            {
                throw std::runtime_error("Download grant lifetime fields are inconsistent.");
            }
            const std::uint64_t now = options.nowUnixMilliseconds
                ? options.nowUnixMilliseconds()
                : currentUnixMilliseconds();
            validateExpiration(expiresAt, now, ttlSeconds, refreshAfter, options);

            const std::uint64_t size = requiredUnsigned(data, L"size_bytes");
            const std::string sha = requiredString(data, L"sha256", 64U);
            const std::map<std::string, std::string> hashes = parseHashes(
                requireMember(data, L"hashes", JsonValue::Type::Object));
            const bool rangeSupported = requiredBoolean(data, L"range_supported");
            const std::string acceptRanges = requiredString(data, L"accept_ranges", 16U);
            if (size != artifactSize || sha != artifactSha || hashes != artifactHashes ||
                rangeSupported != artifactRangeSupported ||
                acceptRanges != (rangeSupported ? "bytes" : "none") ||
                (!externalReference && !rangeSupported))
            {
                throw std::runtime_error("Download verification metadata is inconsistent.");
            }
            const JsonValue& conditionalHeaders = requireMember(
                data, L"conditional_headers", JsonValue::Type::Array);
            if (externalReference)
            {
                validateNoConditionalHeaders(conditionalHeaders);
            }
            else
            {
                validateConditionalHeaders(conditionalHeaders);
            }

            const std::string primaryUrl = requiredString(data, L"primary_url", maximumUrlBytes);
            const std::string headUrl = requiredString(data, L"head_url", maximumUrlBytes);
            const std::optional<std::string> fallbackUrl = nullableString(
                data, L"fallback_url", maximumUrlBytes, true);
            if (!isSafeSignedHttpsUrl(primaryUrl) || !isSafeSignedHttpsUrl(headUrl) ||
                (fallbackUrl && !isSafeSignedHttpsUrl(*fallbackUrl)))
            {
                throw std::runtime_error("Download transport URL is invalid.");
            }

            const RepresentationContract representation = parseRepresentation(
                requireMember(data, L"representation", JsonValue::Type::Object),
                headUrl,
                externalReference);
            bool fallbackAvailable = true;
            bool headSupported = true;
            bool conditionalRequestsSupported = true;
            if (externalReference && fallbackUrl.has_value())
            {
                throw std::runtime_error("External download advertised a forbidden fallback URL.");
            }
            if (!externalReference && fallbackUrl)
            {
                const JsonValue& fallback = requireMember(
                    data, L"fallback", JsonValue::Type::Object);
                if (requiredString(fallback, L"provider", 32U) != representation.provider)
                {
                    throw std::runtime_error("Download fallback representation scope is invalid.");
                }
            }
            if (externalReference)
            {
                const JsonValue& transport = requireMember(
                    data, L"transport", JsonValue::Type::Object);
                const JsonValue& primary = requireMember(
                    data, L"primary", JsonValue::Type::Object);
                const JsonValue& fallback = requireMember(
                    data, L"fallback", JsonValue::Type::Object);
                const JsonValue& capabilities = requireMember(
                    data, L"capabilities", JsonValue::Type::Object);
                const std::string transportProvider = requiredString(
                    transport, L"provider", 32U);
                const std::string transportUrl = requiredString(
                    transport, L"url", maximumUrlBytes);
                const std::string referenceId = requiredString(
                    transport, L"reference_id", 36U);
                const std::uint64_t referenceRevision = requiredUnsigned(
                    transport, L"reference_revision");
                headSupported = requiredBoolean(capabilities, L"head_supported");
                const bool capabilityRange = requiredBoolean(
                    capabilities, L"range_supported");
                const bool resumeSupported = requiredBoolean(
                    capabilities, L"resume_supported");
                const bool conditionalSupported = requiredBoolean(
                    capabilities, L"conditional_requests");
                const bool capabilityFallback = requiredBoolean(
                    capabilities, L"fallback_available");
                if (requiredString(data, L"artifact_source", 32U) != artifactSource ||
                    requiredString(transport, L"kind", 64U) != artifactSource ||
                    !isExternalRepresentationProvider(transportProvider) ||
                    transportProvider != representation.provider ||
                    !isCanonicalUuid(referenceId) || referenceRevision == 0U ||
                    transportUrl != primaryUrl || !isSafeSignedHttpsUrl(transportUrl) ||
                    requiredString(transport, L"expires_at", 64U) != expiresAtText ||
                    requiredUnsigned(transport, L"ttl_seconds") != ttlSeconds ||
                    requiredString(primary, L"provider", 32U) != transportProvider ||
                    requiredString(primary, L"url", maximumUrlBytes) != primaryUrl ||
                    requiredString(primary, L"headUrl", maximumUrlBytes) != headUrl ||
                    nullableString(primary, L"etag", 512U, true).has_value() ||
                    requiredString(primary, L"etag_scope", 32U) != transportProvider ||
                    nullableString(primary, L"if_match", 512U, true).has_value() ||
                    representation.etag.has_value() || representation.ifMatch.has_value() ||
                    representation.requiresHeadBeforeRange ||
                    requiredBoolean(fallback, L"available") ||
                    nullableString(fallback, L"endpoint", 160U, true).has_value() ||
                    nullableString(fallback, L"legacy_endpoint", 160U, true).has_value() ||
                    requiredString(fallback, L"reason", 64U) != artifactSource ||
                    nullableString(data, L"fallback_endpoint", 160U, true).has_value() ||
                    requiredString(data, L"url", maximumUrlBytes) != primaryUrl ||
                    capabilityRange != rangeSupported ||
                    resumeSupported != rangeSupported || conditionalSupported ||
                    capabilityFallback)
                {
                    throw std::runtime_error(
                        "External download transport capabilities are inconsistent.");
                }
                fallbackAvailable = false;
                conditionalRequestsSupported = false;
            }
            const JsonValue& verification = requireMember(
                data, L"verification", JsonValue::Type::Object);
            if (requiredUnsigned(verification, L"size_bytes") != size ||
                requiredString(verification, L"sha256", 64U) != sha ||
                parseHashes(requireMember(verification, L"hashes", JsonValue::Type::Object)) != hashes)
            {
                throw std::runtime_error("Download verification block is inconsistent.");
            }
            if (externalReference)
            {
                const std::string scannerPolicy = requiredString(
                    verification, L"scanner_policy_version", 128U);
                const std::string verifiedAt = requiredString(
                    verification, L"verified_at", 64U);
                if (scannerPolicy.empty())
                {
                    throw std::runtime_error("External scanner policy is missing.");
                }
                static_cast<void>(parseUtcMilliseconds(verifiedAt));
            }

            const JsonValue& resume = requireMember(data, L"resume", JsonValue::Type::Object);
            if (requiredBoolean(resume, L"range_supported") != rangeSupported ||
                requiredString(resume, L"provider", 32U) != representation.provider ||
                requiredString(resume, L"etag_scope", 32U) != representation.provider ||
                nullableString(resume, L"etag", 512U, true) != representation.etag ||
                nullableString(resume, L"if_match", 512U, true) != representation.ifMatch ||
                requiredString(resume, L"head_url", maximumUrlBytes) != headUrl ||
                requiredString(resume, L"sha256", 64U) != sha ||
                parseHashes(requireMember(resume, L"hashes", JsonValue::Type::Object)) != hashes ||
                requiredUnsigned(resume, L"chunk_size_hint_bytes") == 0U ||
                requiredString(resume, L"signed_url_expiry_refresh", 160U) != resolveEndpoint)
            {
                throw std::runtime_error("Download resume metadata is inconsistent.");
            }
            const bool resumeRequiresHead = requiredBoolean(
                resume, L"requires_head_before_range");
            const JsonValue& resumeConditionalHeaders = requireMember(
                resume, L"conditional_headers", JsonValue::Type::Array);
            if (externalReference)
            {
                if (resumeRequiresHead || representation.requiresHeadBeforeRange)
                {
                    throw std::runtime_error(
                        "External download advertised a fabricated representation precondition.");
                }
                validateNoConditionalHeaders(resumeConditionalHeaders);
            }
            else
            {
                validateConditionalHeaders(resumeConditionalHeaders);
            }

            ResolvedDownloadGrant result{
                .providerId = std::string(providerId),
                .representationProviderId = representation.provider,
                .artifactId = request.artifactId,
                .grantId = grantId,
                .primaryUrl = primaryUrl,
                .headUrl = headUrl,
                .fallbackAvailable = fallbackAvailable,
                .headSupported = headSupported,
                .rangeSupported = rangeSupported,
                .conditionalRequestsSupported = conditionalRequestsSupported,
                .expiresAtUnixMs = expiresAt,
                .expectedSize = size,
                .expectedSha256 = sha,
                .operationId = request.operationId};
            if (fallbackUrl)
            {
                result.fallbackUrls.push_back(*fallbackUrl);
            }
            validateResolvedDownloadGrant(result, request);
            return result;
        }

        ResolvedDownloadGrant parseFallbackGrant(
            const ModdingFlowPublicApiResponse& response,
            const RemoteDownloadFallbackRequest& request,
            const ModdingFlowRemoteDownloadResolverOptions& options)
        {
            if (response.operationId != request.operationId)
            {
                throw std::runtime_error("Download fallback operation correlation is invalid.");
            }

            const JsonValue& data = envelopeData(response.body);
            const JsonValue& mod = requireMember(data, L"mod", JsonValue::Type::Object);
            const JsonValue& version = requireMember(data, L"version", JsonValue::Type::Object);
            const JsonValue& artifact = requireMember(data, L"artifact", JsonValue::Type::Object);
            const JsonValue& distribution = requireMember(
                data, L"distribution", JsonValue::Type::Object);
            const std::vector<std::string> versionArtifactIds = artifactIds(version);
            if (requiredString(mod, L"id", 36U) != request.modId ||
                requiredString(version, L"id", 36U) != request.versionId ||
                requiredString(version, L"mod_id", 36U) != request.modId ||
                std::find(versionArtifactIds.begin(), versionArtifactIds.end(), request.artifactId) ==
                    versionArtifactIds.end() ||
                requiredString(artifact, L"id", 36U) != request.artifactId ||
                requiredString(artifact, L"mod_id", 36U) != request.modId ||
                requiredString(artifact, L"version_id", 36U) != request.versionId ||
                requiredString(distribution, L"service", 32U) != providerId ||
                requiredString(data, L"artifact_id", 36U) != request.artifactId)
            {
                throw std::runtime_error("Download fallback provenance is inconsistent.");
            }

            const std::uint64_t artifactSize = requiredUnsigned(artifact, L"size_bytes");
            const std::string artifactSha = requiredString(artifact, L"sha256", 64U);
            const std::map<std::string, std::string> artifactHashes = parseHashes(
                requireMember(artifact, L"hashes", JsonValue::Type::Object));
            const JsonValue& downloadMetadata = requireMember(
                artifact, L"download_metadata", JsonValue::Type::Object);
            const std::string resolveEndpoint =
                "/v1/downloads/" + request.artifactId + "/resolve";
            const std::string fallbackEndpoint =
                "/v1/downloads/" + request.artifactId + "/fallback";
            if (artifactSize != request.expectedSize ||
                artifactSha != request.expectedSha256 ||
                !isLowerHex(artifactSha, 64U) ||
                artifactHashes.at("sha256") != artifactSha ||
                nullableString(artifact, L"etag", 512U, true).has_value() ||
                requiredString(artifact, L"artifact_source", 32U) != "r2_blob" ||
                requiredString(artifact, L"status", 32U) != "published" ||
                requiredString(artifact, L"scan_status", 32U) != "clean" ||
                requiredString(downloadMetadata, L"resolve_endpoint", 160U) != resolveEndpoint ||
                !requiredBoolean(downloadMetadata, L"range_supported"))
            {
                throw std::runtime_error("Download fallback artifact is not eligible.");
            }

            const std::string sessionId = requiredString(
                data, L"download_session_id", 36U);
            const JsonValue& job = requireMember(
                data, L"download_job", JsonValue::Type::Object);
            const JsonValue& grant = requireMember(
                data, L"download_grant", JsonValue::Type::Object);
            const std::uint64_t jobBytes = requiredUnsigned(job, L"bytes_received");
            if (!isCanonicalUuid(sessionId) || sessionId != request.grantId ||
                requiredString(job, L"id", 36U) != request.jobId ||
                requiredString(job, L"grant_id", 36U) != request.grantId ||
                requiredString(job, L"artifact_id", 36U) != request.artifactId ||
                requiredString(job, L"status", 32U) != "grant_active" ||
                jobBytes > artifactSize ||
                requiredUnsigned(job, L"provider_effect_count") == 0U ||
                requiredString(grant, L"id", 36U) != request.grantId ||
                requiredString(grant, L"artifact_id", 36U) != request.artifactId ||
                requiredString(grant, L"status", 32U) != "active" ||
                requiredString(grant, L"resolve_endpoint", 160U) != resolveEndpoint ||
                requiredString(grant, L"fallback_endpoint", 160U) != fallbackEndpoint)
            {
                throw std::runtime_error("Download fallback grant is not active or consistent.");
            }
            static_cast<void>(requiredUnsigned(job, L"attempt_count"));
            static_cast<void>(requiredUnsigned(job, L"rate_limit_count"));

            const std::uint64_t now = options.nowUnixMilliseconds
                ? options.nowUnixMilliseconds()
                : currentUnixMilliseconds();
            const std::uint64_t activeGrantExpiry = parseUtcMilliseconds(
                requiredString(grant, L"expires_at", 64U));
            const std::uint64_t grantTtl = requiredUnsigned(grant, L"ttl_seconds");
            const std::uint64_t grantRefresh = requiredUnsigned(
                grant, L"refresh_after_seconds");
            if (activeGrantExpiry <= now || grantTtl == 0U || grantRefresh == 0U ||
                grantRefresh >= grantTtl ||
                grantTtl > static_cast<std::uint64_t>(options.maximumLifetime.count()))
            {
                throw std::runtime_error("Download fallback source grant is expired.");
            }

            const std::uint64_t expiresAt = parseUtcMilliseconds(
                requiredString(data, L"expires_at", 64U));
            const std::uint64_t expiresIn = requiredUnsigned(data, L"expires_in");
            validateFallbackExpiration(expiresAt, now, expiresIn, options);

            const std::uint64_t size = requiredUnsigned(data, L"size_bytes");
            const std::string sha = requiredString(data, L"sha256", 64U);
            const std::map<std::string, std::string> hashes = parseHashes(
                requireMember(data, L"hashes", JsonValue::Type::Object));
            if (size != request.expectedSize || size != artifactSize ||
                sha != request.expectedSha256 || sha != artifactSha ||
                hashes != artifactHashes ||
                nullableString(data, L"etag", 512U, true).has_value() ||
                requiredString(data, L"accept_ranges", 16U) != "bytes" ||
                !requiredBoolean(data, L"range_supported"))
            {
                throw std::runtime_error("Download fallback verification metadata is inconsistent.");
            }
            validateConditionalHeaders(requireMember(
                data, L"conditional_headers", JsonValue::Type::Array));

            const std::string fallbackUrl = requiredString(
                data, L"fallback_url", maximumUrlBytes);
            const std::string downloadUrl = requiredString(data, L"url", maximumUrlBytes);
            const std::string headUrl = requiredString(data, L"head_url", maximumUrlBytes);
            if (fallbackUrl != downloadUrl || !isSafeSignedHttpsUrl(downloadUrl) ||
                !isSafeSignedHttpsUrl(headUrl))
            {
                throw std::runtime_error("Download fallback transport URL is invalid.");
            }

            const std::string responseProvider = requiredString(data, L"provider", 32U);
            const std::string reason = requiredString(data, L"reason", 64U);
            if (responseProvider != fallbackRepresentationProviderId ||
                responseProvider == request.currentRepresentationProviderId ||
                (reason != "bunny_ru_geo" && reason != "bunny_probe_failure"))
            {
                throw std::runtime_error("Download fallback provider is invalid.");
            }

            const RepresentationContract representation = parseRepresentation(
                requireMember(data, L"representation", JsonValue::Type::Object),
                headUrl,
                false);
            if (representation.provider != responseProvider ||
                representation.etag.has_value() || representation.ifMatch.has_value() ||
                !representation.requiresHeadBeforeRange)
            {
                throw std::runtime_error("Download fallback representation is not fresh.");
            }

            const JsonValue& verification = requireMember(
                data, L"verification", JsonValue::Type::Object);
            if (nullableString(verification, L"etag", 512U, true).has_value() ||
                requiredUnsigned(verification, L"size_bytes") != size ||
                requiredString(verification, L"sha256", 64U) != sha ||
                parseHashes(requireMember(
                    verification, L"hashes", JsonValue::Type::Object)) != hashes)
            {
                throw std::runtime_error("Download fallback verification block is inconsistent.");
            }

            const JsonValue& resume = requireMember(data, L"resume", JsonValue::Type::Object);
            if (!requiredBoolean(resume, L"range_supported") ||
                requiredString(resume, L"provider", 32U) != responseProvider ||
                requiredString(resume, L"etag_scope", 32U) != responseProvider ||
                nullableString(resume, L"etag", 512U, true).has_value() ||
                nullableString(resume, L"if_match", 512U, true).has_value() ||
                !requiredBoolean(resume, L"requires_head_before_range") ||
                requiredString(resume, L"head_url", maximumUrlBytes) != headUrl ||
                requiredString(resume, L"sha256", 64U) != sha ||
                parseHashes(requireMember(resume, L"hashes", JsonValue::Type::Object)) != hashes ||
                requiredUnsigned(resume, L"chunk_size_hint_bytes") == 0U ||
                requiredString(resume, L"signed_url_expiry_refresh", 160U) != resolveEndpoint)
            {
                throw std::runtime_error("Download fallback resume metadata is inconsistent.");
            }
            validateConditionalHeaders(requireMember(
                resume, L"conditional_headers", JsonValue::Type::Array));

            ResolvedDownloadGrant result{
                .providerId = std::string(providerId),
                .representationProviderId = responseProvider,
                .artifactId = request.artifactId,
                .grantId = request.grantId,
                .primaryUrl = downloadUrl,
                .headUrl = headUrl,
                .fallbackAvailable = false,
                .headSupported = true,
                .rangeSupported = true,
                .conditionalRequestsSupported = true,
                .expiresAtUnixMs = expiresAt,
                .expectedSize = size,
                .expectedSha256 = sha,
                .operationId = request.operationId};
            validateResolvedDownloadFallbackGrant(result, request);
            return result;
        }
    }

    ModdingFlowRemoteDownloadResolver::ModdingFlowRemoteDownloadResolver(
        IModdingFlowPublicApiClient& client,
        ModdingFlowRemoteDownloadResolverOptions options)
        : client_(client),
          options_(std::move(options))
    {
        if (options_.maximumResponseBytes == 0U ||
            options_.maximumResponseBytes > 512U * 1024U ||
            options_.minimumRemainingLifetime.count() < 0 ||
            options_.maximumLifetime <= options_.minimumRemainingLifetime ||
            options_.maximumLifetime > std::chrono::hours(24))
        {
            throw std::invalid_argument("ModdingFlow download resolver options are invalid.");
        }
    }

    ResolvedDownloadGrant ModdingFlowRemoteDownloadResolver::resolve(
        const RemoteArtifactDownloadRequest& request)
    {
        try
        {
            validateRemoteArtifactDownloadRequest(request);
        }
        catch (const std::exception&)
        {
            throwInvalidRequest(request.operationId);
        }
        if (request.providerId != providerId || !isCanonicalUuid(request.artifactId) ||
            !isCanonicalUuid(request.modId) || !isCanonicalUuid(request.versionId) ||
            !isCanonicalUuid(request.jobId))
        {
            throwInvalidRequest(request.operationId);
        }

        const std::string body =
            "{\"client\":\"mod_manager\",\"job_id\":\"" + request.jobId + "\"}";
        const std::string idempotencyKey = "fluxora-mf-download-" + request.jobId;
        try
        {
            const auto executeResolve = [&](ModdingFlowApiAuthMode auth)
            {
                return client_.execute({
                    .method = ModdingFlowHttpMethod::Post,
                    .pathAndQuery = "/downloads/" + request.artifactId + "/resolve",
                    .body = body,
                    .auth = auth,
                    .requiredScope = auth == ModdingFlowApiAuthMode::BearerRequired
                        ? "files:download"
                        : std::string{},
                    .retry = ModdingFlowApiRetryMode::Idempotent,
                    .idempotencyKey = idempotencyKey,
                    .operationId = request.operationId,
                    .maximumResponseBytes = options_.maximumResponseBytes});
            };

            ModdingFlowPublicApiResponse response;
            try
            {
                response = executeResolve(ModdingFlowApiAuthMode::Anonymous);
            }
            catch (const ModdingFlowApiException& exception)
            {
                if (exception.code() != ModdingFlowApiErrorCode::Unauthorized &&
                    exception.code() != ModdingFlowApiErrorCode::Forbidden)
                {
                    throw;
                }
                response = executeResolve(ModdingFlowApiAuthMode::BearerRequired);
            }
            return parseGrant(
                response,
                request,
                options_);
        }
        catch (const ModdingFlowApiException&)
        {
            throw;
        }
        catch (const std::exception&)
        {
            throwInvalidResponse(request.operationId);
        }
    }

    std::optional<ResolvedDownloadGrant> ModdingFlowRemoteDownloadResolver::resolveFallback(
        const RemoteDownloadFallbackRequest& request)
    {
        try
        {
            validateRemoteDownloadFallbackRequest(request);
        }
        catch (const std::exception&)
        {
            throwInvalidRequest(request.operationId);
        }
        if (request.providerId != providerId || !isCanonicalUuid(request.artifactId) ||
            !isCanonicalUuid(request.modId) || !isCanonicalUuid(request.versionId) ||
            !isCanonicalUuid(request.jobId) || !isCanonicalUuid(request.grantId))
        {
            throwInvalidRequest(request.operationId);
        }
        if (isExternalRepresentationProvider(request.currentRepresentationProviderId))
        {
            return std::nullopt;
        }
        if (request.currentRepresentationProviderId != "cloudflare_r2" &&
            request.currentRepresentationProviderId != fallbackRepresentationProviderId)
        {
            throwInvalidRequest(request.operationId);
        }

        const std::string body =
            "{\"downloadSessionId\":\"" + request.grantId + "\"}";
        try
        {
            const auto executeFallback = [&](ModdingFlowApiAuthMode auth)
            {
                return client_.execute({
                    .method = ModdingFlowHttpMethod::Post,
                    .pathAndQuery = "/downloads/" + request.artifactId + "/fallback",
                    .body = body,
                    .auth = auth,
                    .requiredScope = auth == ModdingFlowApiAuthMode::BearerRequired
                        ? "files:download"
                        : std::string{},
                    .retry = ModdingFlowApiRetryMode::Never,
                    .idempotencyKey = "",
                    .operationId = request.operationId,
                    .maximumResponseBytes = options_.maximumResponseBytes});
            };

            ModdingFlowPublicApiResponse response;
            try
            {
                response = executeFallback(ModdingFlowApiAuthMode::Anonymous);
            }
            catch (const ModdingFlowApiException& exception)
            {
                if (exception.code() != ModdingFlowApiErrorCode::Unauthorized &&
                    exception.code() != ModdingFlowApiErrorCode::Forbidden)
                {
                    throw;
                }
                response = executeFallback(ModdingFlowApiAuthMode::BearerRequired);
            }
            return parseFallbackGrant(
                response,
                request,
                options_);
        }
        catch (const ModdingFlowApiException&)
        {
            throw;
        }
        catch (const std::exception&)
        {
            throwInvalidResponse(request.operationId);
        }
    }
}
