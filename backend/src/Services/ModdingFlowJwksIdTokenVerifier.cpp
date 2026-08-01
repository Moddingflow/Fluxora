#include "FluxoraCore/Services/ModdingFlowJwksIdTokenVerifier.hpp"

#include "FluxoraCore/Services/ModdingFlowApiResponse.hpp"
#include "FluxoraCore/Services/ModdingFlowHttpTransport.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cctype>
#include <cstdint>
#include <limits>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <Windows.h>
#include <bcrypt.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumJwtBytes = 32U * 1024U;
        constexpr std::size_t maximumJwtJsonBytes = 16U * 1024U;
        constexpr std::size_t maximumJwksBytes = 256U * 1024U;
        constexpr std::size_t maximumCachedKeys = 16U;
        constexpr std::chrono::seconds defaultCacheLifetime{300};
        constexpr std::chrono::seconds maximumCacheLifetime{3600};

        [[noreturn]] void throwSecurity(std::string message)
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Security,
                std::move(message));
        }

        [[noreturn]] void throwProtocol(std::string message)
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Protocol,
                std::move(message));
        }

        int base64UrlValue(unsigned char character) noexcept
        {
            if (character >= 'A' && character <= 'Z')
            {
                return character - 'A';
            }
            if (character >= 'a' && character <= 'z')
            {
                return character - 'a' + 26;
            }
            if (character >= '0' && character <= '9')
            {
                return character - '0' + 52;
            }
            if (character == '-')
            {
                return 62;
            }
            if (character == '_')
            {
                return 63;
            }
            return -1;
        }

        std::vector<unsigned char> decodeBase64Url(
            std::string_view value,
            std::size_t maximumDecodedBytes)
        {
            if (value.empty() || value.find('=') != std::string_view::npos || value.size() % 4U == 1U ||
                value.size() > ((maximumDecodedBytes * 4U + 2U) / 3U) + 2U)
            {
                throwSecurity("ModdingFlow base64url value is invalid.");
            }
            std::vector<unsigned char> decoded;
            decoded.reserve((value.size() * 3U) / 4U + 1U);
            std::uint32_t accumulator = 0;
            int bits = 0;
            for (const unsigned char character : value)
            {
                const int digit = base64UrlValue(character);
                if (digit < 0)
                {
                    throwSecurity("ModdingFlow base64url value is invalid.");
                }
                accumulator = (accumulator << 6) | static_cast<std::uint32_t>(digit);
                bits += 6;
                if (bits >= 8)
                {
                    bits -= 8;
                    decoded.push_back(static_cast<unsigned char>((accumulator >> bits) & 0xFFU));
                    if (decoded.size() > maximumDecodedBytes)
                    {
                        throwSecurity("ModdingFlow base64url value exceeded its size limit.");
                    }
                }
            }
            if (bits > 0 && (accumulator & ((1U << bits) - 1U)) != 0U)
            {
                throwSecurity("ModdingFlow base64url value is non-canonical.");
            }
            return decoded;
        }

        std::string bytesToString(const std::vector<unsigned char>& bytes)
        {
            return std::string(
                reinterpret_cast<const char*>(bytes.data()),
                bytes.size());
        }

        std::string requiredString(const JsonValue& object, std::wstring_view field)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || !value->isString())
            {
                throwSecurity("ModdingFlow JWT/JWK string field is invalid.");
            }
            return moddingFlowJsonStringToUtf8(value->asString());
        }

        std::uint64_t requiredUnixSeconds(const JsonValue& object, std::wstring_view field)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || !value->isNumber())
            {
                throwSecurity("ModdingFlow JWT time claim is invalid.");
            }
            std::string ascii;
            for (const wchar_t character : value->asNumber())
            {
                if (character < L'0' || character > L'9')
                {
                    throwSecurity("ModdingFlow JWT time claim is invalid.");
                }
                ascii.push_back(static_cast<char>(character));
            }
            std::uint64_t seconds = 0;
            const auto [end, error] = std::from_chars(
                ascii.data(),
                ascii.data() + ascii.size(),
                seconds);
            if (error != std::errc{} || end != ascii.data() + ascii.size() ||
                seconds > 4'102'444'800ULL)
            {
                throwSecurity("ModdingFlow JWT time claim is out of range.");
            }
            return seconds;
        }

        bool safeKeyId(std::string_view value) noexcept
        {
            return !value.empty() && value.size() <= 128U &&
                std::all_of(value.begin(), value.end(), [](unsigned char character)
                {
                    return std::isalnum(character) != 0 ||
                        character == '-' || character == '_' || character == '.';
                });
        }

        struct ParsedJwt
        {
            std::string signingInput;
            std::string keyId;
            std::vector<unsigned char> signature;
            ModdingFlowIdTokenClaims claims;
        };

        ParsedJwt parseJwt(std::string_view compact)
        {
            if (compact.empty() || compact.size() > maximumJwtBytes)
            {
                throwSecurity("ModdingFlow ID token exceeded its size limit.");
            }
            const std::size_t firstDot = compact.find('.');
            const std::size_t secondDot = firstDot == std::string_view::npos
                ? std::string_view::npos
                : compact.find('.', firstDot + 1U);
            if (firstDot == std::string_view::npos || secondDot == std::string_view::npos ||
                firstDot == 0 || secondDot == firstDot + 1U || secondDot + 1U >= compact.size() ||
                compact.find('.', secondDot + 1U) != std::string_view::npos)
            {
                throwSecurity("ModdingFlow ID token compact serialization is invalid.");
            }

            const std::string_view headerSegment = compact.substr(0, firstDot);
            const std::string_view payloadSegment = compact.substr(firstDot + 1U, secondDot - firstDot - 1U);
            const std::string_view signatureSegment = compact.substr(secondDot + 1U);
            const JsonValue header = parseModdingFlowJson(
                bytesToString(decodeBase64Url(headerSegment, maximumJwtJsonBytes)),
                {.maximumBytes = maximumJwtJsonBytes, .maximumDepth = 4, .maximumValues = 32});
            if (!header.isObject() || header.asObject().size() < 2U || header.asObject().size() > 3U)
            {
                throwSecurity("ModdingFlow ID token header shape is invalid.");
            }
            for (const auto& [field, ignored] : header.asObject())
            {
                (void)ignored;
                if (field != L"alg" && field != L"kid" && field != L"typ")
                {
                    throwSecurity("ModdingFlow ID token embedded or unsupported header was rejected.");
                }
            }
            const std::string algorithm = requiredString(header, L"alg");
            const std::string keyId = requiredString(header, L"kid");
            if (algorithm != "RS256" || !safeKeyId(keyId))
            {
                throwSecurity("ModdingFlow ID token algorithm or key id is invalid.");
            }
            if (const JsonValue* type = header.find(L"typ");
                type != nullptr && (!type->isString() || type->asString() != L"JWT"))
            {
                throwSecurity("ModdingFlow ID token type is invalid.");
            }

            const JsonValue payload = parseModdingFlowJson(
                bytesToString(decodeBase64Url(payloadSegment, maximumJwtJsonBytes)),
                {.maximumBytes = maximumJwtJsonBytes, .maximumDepth = 8, .maximumValues = 256});
            if (!payload.isObject())
            {
                throwSecurity("ModdingFlow ID token payload is invalid.");
            }

            ParsedJwt parsed;
            parsed.signingInput = std::string(compact.substr(0, secondDot));
            parsed.keyId = keyId;
            parsed.signature = decodeBase64Url(signatureSegment, 1024U);
            parsed.claims.algorithm = algorithm;
            parsed.claims.issuer = requiredString(payload, L"iss");
            parsed.claims.subject = requiredString(payload, L"sub");
            parsed.claims.nonce = requiredString(payload, L"nonce");
            if (parsed.claims.issuer.empty() || parsed.claims.issuer.size() > 512U ||
                parsed.claims.subject.empty() || parsed.claims.subject.size() > 256U ||
                parsed.claims.nonce.empty() || parsed.claims.nonce.size() > 512U)
            {
                throwSecurity("ModdingFlow ID token identity claim is invalid.");
            }
            const JsonValue* audience = payload.find(L"aud");
            if (audience == nullptr)
            {
                throwSecurity("ModdingFlow ID token audience is missing.");
            }
            if (audience->isString())
            {
                parsed.claims.audience.push_back(
                    moddingFlowJsonStringToUtf8(audience->asString()));
            }
            else if (audience->isArray() && !audience->asArray().empty() &&
                audience->asArray().size() <= 8U)
            {
                std::unordered_set<std::string> uniqueAudiences;
                for (const JsonValue& item : audience->asArray())
                {
                    if (!item.isString())
                    {
                        throwSecurity("ModdingFlow ID token audience is invalid.");
                    }
                    std::string value = moddingFlowJsonStringToUtf8(item.asString());
                    if (value.empty() || value.size() > 256U ||
                        !uniqueAudiences.emplace(value).second)
                    {
                        throwSecurity("ModdingFlow ID token audience is invalid.");
                    }
                    parsed.claims.audience.push_back(std::move(value));
                }
            }
            else
            {
                throwSecurity("ModdingFlow ID token audience is invalid.");
            }
            if (parsed.claims.audience.front().empty() ||
                parsed.claims.audience.front().size() > 256U)
            {
                throwSecurity("ModdingFlow ID token audience is invalid.");
            }

            const std::uint64_t issuedAt = requiredUnixSeconds(payload, L"iat");
            const std::uint64_t expiresAt = requiredUnixSeconds(payload, L"exp");
            parsed.claims.issuedAt = std::chrono::system_clock::time_point(
                std::chrono::seconds(issuedAt));
            parsed.claims.expiresAt = std::chrono::system_clock::time_point(
                std::chrono::seconds(expiresAt));
            return parsed;
        }

        bool mediaTypeEquals(std::string_view value, std::string_view expected) noexcept
        {
            const std::size_t separator = value.find(';');
            value = value.substr(0, separator);
            if (value.size() != expected.size())
            {
                return false;
            }
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                if (std::tolower(static_cast<unsigned char>(value[index])) !=
                    std::tolower(static_cast<unsigned char>(expected[index])))
                {
                    return false;
                }
            }
            return true;
        }

        void requireSingleJwksContentType(const ModdingFlowHttpResponse& response)
        {
            std::size_t count = 0;
            std::string_view value;
            for (const ModdingFlowHttpHeader& header : response.headers)
            {
                if (header.name.size() == 12U &&
                    std::equal(header.name.begin(), header.name.end(), "content-type", [](char left, char right)
                    {
                        return std::tolower(static_cast<unsigned char>(left)) == right;
                    }))
                {
                    ++count;
                    value = header.value;
                }
            }
            if (count != 1U || !mediaTypeEquals(value, "application/jwk-set+json"))
            {
                throwProtocol("ModdingFlow JWKS content type is invalid or ambiguous.");
            }
        }

        bool asciiCaseInsensitiveEquals(
            std::string_view left,
            std::string_view right) noexcept
        {
            return left.size() == right.size() &&
                std::equal(left.begin(), left.end(), right.begin(), [](char leftCharacter, char rightCharacter)
                {
                    return std::tolower(static_cast<unsigned char>(leftCharacter)) ==
                        std::tolower(static_cast<unsigned char>(rightCharacter));
                });
        }

        std::string_view trimOptionalWhitespace(std::string_view value) noexcept
        {
            while (!value.empty() && (value.front() == ' ' || value.front() == '\t'))
            {
                value.remove_prefix(1);
            }
            while (!value.empty() && (value.back() == ' ' || value.back() == '\t'))
            {
                value.remove_suffix(1);
            }
            return value;
        }

        std::optional<std::uint64_t> parseDeltaSeconds(std::string_view value) noexcept
        {
            value = trimOptionalWhitespace(value);
            if (value.empty())
            {
                return std::nullopt;
            }
            std::uint64_t seconds = 0;
            const auto [parsedEnd, error] = std::from_chars(
                value.data(),
                value.data() + value.size(),
                seconds);
            if (error != std::errc{} || parsedEnd != value.data() + value.size())
            {
                return std::nullopt;
            }
            return seconds;
        }

        std::chrono::seconds cacheLifetime(const ModdingFlowHttpResponse& response)
        {
            std::uint64_t lifetime = static_cast<std::uint64_t>(defaultCacheLifetime.count());
            bool sawMaxAge = false;
            for (const ModdingFlowHttpHeader& header : response.headers)
            {
                if (!asciiCaseInsensitiveEquals(header.name, "cache-control"))
                {
                    continue;
                }
                std::string_view remaining = header.value;
                while (!remaining.empty())
                {
                    const std::size_t separator = remaining.find(',');
                    const std::string_view directive = trimOptionalWhitespace(
                        remaining.substr(0, separator));
                    const std::size_t equals = directive.find('=');
                    const std::string_view name = trimOptionalWhitespace(directive.substr(0, equals));
                    if (asciiCaseInsensitiveEquals(name, "no-store") ||
                        asciiCaseInsensitiveEquals(name, "no-cache"))
                    {
                        return std::chrono::seconds::zero();
                    }
                    if (asciiCaseInsensitiveEquals(name, "max-age"))
                    {
                        if (equals == std::string_view::npos)
                        {
                            return std::chrono::seconds::zero();
                        }
                        const std::optional<std::uint64_t> parsed =
                            parseDeltaSeconds(directive.substr(equals + 1U));
                        if (!parsed)
                        {
                            return std::chrono::seconds::zero();
                        }
                        const std::uint64_t capped = (std::min)(
                            *parsed,
                            static_cast<std::uint64_t>(maximumCacheLifetime.count()));
                        lifetime = sawMaxAge ? (std::min)(lifetime, capped) : capped;
                        sawMaxAge = true;
                    }
                    if (separator == std::string_view::npos)
                    {
                        break;
                    }
                    remaining.remove_prefix(separator + 1U);
                }
            }

            std::optional<std::uint64_t> age;
            for (const ModdingFlowHttpHeader& header : response.headers)
            {
                if (!asciiCaseInsensitiveEquals(header.name, "age"))
                {
                    continue;
                }
                if (age)
                {
                    return std::chrono::seconds::zero();
                }
                age = parseDeltaSeconds(header.value);
                if (!age)
                {
                    return std::chrono::seconds::zero();
                }
            }
            if (age && *age >= lifetime)
            {
                return std::chrono::seconds::zero();
            }
            return std::chrono::seconds(lifetime - age.value_or(0U));
        }

#ifdef _WIN32
        std::vector<unsigned char> sha256(std::string_view value)
        {
            BCRYPT_ALG_HANDLE algorithm = nullptr;
            BCRYPT_HASH_HANDLE hash = nullptr;
            if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0)
            {
                throwSecurity("ModdingFlow SHA-256 provider initialization failed.");
            }
            DWORD objectLength = 0;
            DWORD hashLength = 0;
            DWORD copied = 0;
            if (BCryptGetProperty(
                    algorithm,
                    BCRYPT_OBJECT_LENGTH,
                    reinterpret_cast<PUCHAR>(&objectLength),
                    sizeof(objectLength),
                    &copied,
                    0) < 0 ||
                BCryptGetProperty(
                    algorithm,
                    BCRYPT_HASH_LENGTH,
                    reinterpret_cast<PUCHAR>(&hashLength),
                    sizeof(hashLength),
                    &copied,
                    0) < 0)
            {
                BCryptCloseAlgorithmProvider(algorithm, 0);
                throwSecurity("ModdingFlow SHA-256 provider query failed.");
            }
            std::vector<unsigned char> object(objectLength);
            std::vector<unsigned char> digest(hashLength);
            if (BCryptCreateHash(
                    algorithm,
                    &hash,
                    object.data(),
                    static_cast<ULONG>(object.size()),
                    nullptr,
                    0,
                    0) < 0 ||
                value.size() > static_cast<std::size_t>((std::numeric_limits<ULONG>::max)()) ||
                BCryptHashData(
                    hash,
                    reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
                    static_cast<ULONG>(value.size()),
                    0) < 0 ||
                BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) < 0)
            {
                if (hash != nullptr)
                {
                    BCryptDestroyHash(hash);
                }
                BCryptCloseAlgorithmProvider(algorithm, 0);
                throwSecurity("ModdingFlow SHA-256 hashing failed.");
            }
            BCryptDestroyHash(hash);
            BCryptCloseAlgorithmProvider(algorithm, 0);
            return digest;
        }

        bool verifyRs256(
            std::string_view signingInput,
            const std::vector<unsigned char>& signature,
            const std::vector<unsigned char>& modulus,
            const std::vector<unsigned char>& exponent)
        {
            if (signature.size() != modulus.size() ||
                modulus.size() > static_cast<std::size_t>((std::numeric_limits<ULONG>::max)()) ||
                exponent.size() > static_cast<std::size_t>((std::numeric_limits<ULONG>::max)()))
            {
                return false;
            }
            BCRYPT_RSAKEY_BLOB header{};
            header.Magic = BCRYPT_RSAPUBLIC_MAGIC;
            header.BitLength = static_cast<ULONG>(modulus.size() * 8U);
            header.cbPublicExp = static_cast<ULONG>(exponent.size());
            header.cbModulus = static_cast<ULONG>(modulus.size());
            std::vector<unsigned char> blob(
                sizeof(header) + exponent.size() + modulus.size());
            std::memcpy(blob.data(), &header, sizeof(header));
            std::copy(exponent.begin(), exponent.end(), blob.begin() + sizeof(header));
            std::copy(modulus.begin(), modulus.end(), blob.begin() + sizeof(header) + exponent.size());

            BCRYPT_ALG_HANDLE algorithm = nullptr;
            BCRYPT_KEY_HANDLE key = nullptr;
            if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_RSA_ALGORITHM, nullptr, 0) < 0 ||
                BCryptImportKeyPair(
                    algorithm,
                    nullptr,
                    BCRYPT_RSAPUBLIC_BLOB,
                    &key,
                    blob.data(),
                    static_cast<ULONG>(blob.size()),
                    0) < 0)
            {
                if (key != nullptr)
                {
                    BCryptDestroyKey(key);
                }
                if (algorithm != nullptr)
                {
                    BCryptCloseAlgorithmProvider(algorithm, 0);
                }
                throwSecurity("ModdingFlow RSA public key import failed.");
            }
            const std::vector<unsigned char> digest = sha256(signingInput);
            BCRYPT_PKCS1_PADDING_INFO padding{BCRYPT_SHA256_ALGORITHM};
            const NTSTATUS status = BCryptVerifySignature(
                key,
                &padding,
                const_cast<PUCHAR>(digest.data()),
                static_cast<ULONG>(digest.size()),
                const_cast<PUCHAR>(signature.data()),
                static_cast<ULONG>(signature.size()),
                BCRYPT_PAD_PKCS1);
            BCryptDestroyKey(key);
            BCryptCloseAlgorithmProvider(algorithm, 0);
            return status >= 0;
        }
#endif
    }

    struct ModdingFlowJwksIdTokenVerifier::State
    {
        struct PublicKey
        {
            std::string keyId;
            std::vector<unsigned char> modulus;
            std::vector<unsigned char> exponent;
        };

        State(
            ModdingFlowConfiguration configurationValue,
            IModdingFlowHttpTransport& transportValue,
            ModdingFlowJwksIdTokenVerifierOptions optionsValue)
            : configuration(std::move(configurationValue)),
              transport(transportValue),
              options(std::move(optionsValue))
        {
            if (!options.monotonicClock)
            {
                options.monotonicClock = [] { return std::chrono::steady_clock::now(); };
            }
        }

        std::vector<PublicKey> fetch(
            const ModdingFlowHttpPolicy& policy,
            std::wstring_view operationId)
        {
            ModdingFlowHttpRequest request;
            request.method = ModdingFlowHttpMethod::Get;
            request.url = std::string(configuration.jwksUri());
            request.headers = {{"accept", "application/jwk-set+json"}};
            request.operationId = operationId;
            request.policy = policy;
            request.maximumResponseBodyBytes = maximumJwksBytes;

            ModdingFlowHttpResponse response;
            try
            {
                response = transport.send(request);
            }
            catch (const ModdingFlowHttpException& exception)
            {
                if (exception.kind() == ModdingFlowHttpFailureKind::Security)
                {
                    throwSecurity("ModdingFlow JWKS transport security validation failed.");
                }
                if (exception.kind() == ModdingFlowHttpFailureKind::Protocol ||
                    exception.kind() == ModdingFlowHttpFailureKind::ResponseTooLarge)
                {
                    throwProtocol("ModdingFlow JWKS transport response was invalid.");
                }
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Temporary,
                    "ModdingFlow JWKS transport failed temporarily.");
            }
            if (response.statusCode >= 300 && response.statusCode <= 399)
            {
                throwSecurity("ModdingFlow JWKS redirect was rejected.");
            }
            if (response.statusCode == 429 || response.statusCode >= 500)
            {
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Temporary,
                    "ModdingFlow JWKS endpoint is temporarily unavailable.");
            }
            if (response.statusCode != 200)
            {
                throwProtocol("ModdingFlow JWKS endpoint returned an unexpected response.");
            }
            requireSingleJwksContentType(response);

            const JsonValue root = parseModdingFlowJson(
                response.body,
                {.maximumBytes = maximumJwksBytes, .maximumDepth = 8, .maximumValues = 512});
            if (!root.isObject() || root.asObject().size() != 1U)
            {
                throwSecurity("ModdingFlow JWKS root shape is invalid.");
            }
            const JsonValue* keysValue = root.find(L"keys");
            if (keysValue == nullptr || !keysValue->isArray() || keysValue->asArray().empty() ||
                keysValue->asArray().size() > maximumCachedKeys)
            {
                throwSecurity("ModdingFlow JWKS key set is empty or too large.");
            }

            std::vector<PublicKey> parsed;
            std::unordered_set<std::string> keyIds;
            for (const JsonValue& value : keysValue->asArray())
            {
                if (!value.isObject() || value.asObject().size() != 6U)
                {
                    throwSecurity("ModdingFlow JWK shape is invalid.");
                }
                static constexpr std::wstring_view fields[] = {
                    L"kty", L"kid", L"use", L"alg", L"n", L"e"};
                for (const std::wstring_view field : fields)
                {
                    if (value.find(field) == nullptr)
                    {
                        throwSecurity("ModdingFlow JWK field is missing.");
                    }
                }
                if (requiredString(value, L"kty") != "RSA" ||
                    requiredString(value, L"use") != "sig" ||
                    requiredString(value, L"alg") != "RS256")
                {
                    throwSecurity("ModdingFlow JWK algorithm metadata is invalid.");
                }
                PublicKey key;
                key.keyId = requiredString(value, L"kid");
                if (!safeKeyId(key.keyId) || !keyIds.emplace(key.keyId).second)
                {
                    throwSecurity("ModdingFlow JWK key id is invalid or ambiguous.");
                }
                key.modulus = decodeBase64Url(requiredString(value, L"n"), 512U);
                key.exponent = decodeBase64Url(requiredString(value, L"e"), 4U);
                if (key.modulus.size() < 256U || key.modulus.size() > 512U ||
                    key.modulus.front() == 0 || key.exponent.empty())
                {
                    throwSecurity("ModdingFlow JWK RSA parameters are invalid.");
                }
                std::uint64_t exponentValue = 0;
                for (const unsigned char byte : key.exponent)
                {
                    exponentValue = (exponentValue << 8) | byte;
                }
                if (exponentValue < 3U || exponentValue > 0xFFFFFFFFULL ||
                    exponentValue % 2U == 0U)
                {
                    throwSecurity("ModdingFlow JWK RSA exponent is invalid.");
                }
                parsed.push_back(std::move(key));
            }

            const std::chrono::seconds lifetime = cacheLifetime(response);
            {
                std::lock_guard lock(mutex);
                if (lifetime > std::chrono::seconds::zero())
                {
                    keys = parsed;
                    expiresAt = options.monotonicClock() + lifetime;
                }
                else
                {
                    keys.clear();
                    expiresAt = {};
                }
            }
            return parsed;
        }

        static std::optional<PublicKey> findKey(
            const std::vector<PublicKey>& candidates,
            std::string_view keyId)
        {
            const auto match = std::ranges::find(candidates, keyId, &PublicKey::keyId);
            return match == candidates.end()
                ? std::nullopt
                : std::optional<PublicKey>(*match);
        }

        std::optional<PublicKey> cached(std::string_view keyId, bool requireFresh)
        {
            std::lock_guard lock(mutex);
            if (requireFresh && options.monotonicClock() >= expiresAt)
            {
                return std::nullopt;
            }
            const auto match = std::ranges::find(keys, keyId, &PublicKey::keyId);
            return match == keys.end() ? std::nullopt : std::optional<PublicKey>(*match);
        }

        bool cacheFresh()
        {
            std::lock_guard lock(mutex);
            return !keys.empty() && options.monotonicClock() < expiresAt;
        }

        ModdingFlowConfiguration configuration;
        IModdingFlowHttpTransport& transport;
        ModdingFlowJwksIdTokenVerifierOptions options;
        std::mutex mutex;
        std::vector<PublicKey> keys;
        std::chrono::steady_clock::time_point expiresAt{};
    };

    ModdingFlowJwksIdTokenVerifier::ModdingFlowJwksIdTokenVerifier(
        ModdingFlowConfiguration configuration,
        IModdingFlowHttpTransport& transport,
        ModdingFlowJwksIdTokenVerifierOptions options)
        : state_(std::make_unique<State>(
            std::move(configuration),
            transport,
            std::move(options)))
    {
    }

    ModdingFlowJwksIdTokenVerifier::~ModdingFlowJwksIdTokenVerifier() = default;

    ModdingFlowIdTokenClaims ModdingFlowJwksIdTokenVerifier::verifySignatureAndDecode(
        const ModdingFlowIdTokenVerificationRequest& request)
    {
        if (request.jwksUri != state_->configuration.jwksUri() ||
            request.transport.redirects != ModdingFlowRedirectPolicy::Reject)
        {
            throwSecurity("ModdingFlow ID token verification configuration was rejected.");
        }
        ParsedJwt parsed;
        try
        {
            parsed = parseJwt(request.idToken);
        }
        catch (const ModdingFlowOAuthException&)
        {
            throw;
        }
        catch (...)
        {
            throwSecurity("ModdingFlow ID token JSON was malformed or ambiguous.");
        }

        std::optional<State::PublicKey> key = state_->cached(parsed.keyId, true);
        if (!key && !state_->cacheFresh())
        {
            key = State::findKey(
                state_->fetch(request.transport, request.operationId),
                parsed.keyId);
        }
        if (!key && request.forceJwksRefreshOnceForUnknownKey)
        {
            key = State::findKey(
                state_->fetch(request.transport, request.operationId),
                parsed.keyId);
        }
        if (!key)
        {
            throwSecurity("ModdingFlow ID token key id was not found after bounded JWKS refresh.");
        }

#ifdef _WIN32
        if (!verifyRs256(
                parsed.signingInput,
                parsed.signature,
                key->modulus,
                key->exponent))
        {
            throwSecurity("ModdingFlow ID token signature is invalid.");
        }
#else
        throwSecurity("ModdingFlow RS256 verification is unavailable on this platform.");
#endif
        parsed.claims.signatureValid = true;
        return parsed.claims;
    }
}
