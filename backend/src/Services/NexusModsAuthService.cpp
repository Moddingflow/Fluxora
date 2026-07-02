#include "FluxoraCore/Services/NexusModsAuthService.hpp"

#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cwctype>
#include <iomanip>
#include <initializer_list>
#include <map>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <bcrypt.h>
#include <shellapi.h>
#include <wincrypt.h>
#include <winhttp.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view defaultClientId = L"fluxora";
        constexpr std::wstring_view defaultRedirectUri = L"http://127.0.0.1:8089/callback";
        constexpr std::wstring_view defaultSupabaseUrl = L"https://tpciohumwahlctpeuduv.supabase.co";
        constexpr std::wstring_view defaultSupabaseAnonKey =
            L"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwY2lvaHVtd2FobGN0cGV1ZHV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjkzMDMsImV4cCI6MjA5MTg0NTMwM30.ToKVEyWJAns-kxL_5p5K4C9lO-qJTo3PwXop03pE5gU";
        constexpr std::wstring_view supabaseCredentialRpc = L"fluxora_ai_provider_credential";
        constexpr std::wstring_view nexusClientIdName = L"NEXUS_CLIENT_ID";
        constexpr std::wstring_view nexusOAuthClientIdName = L"NEXUS_OAUTH_CLIENT_ID";
        constexpr std::wstring_view nexusClientSecretName = L"NEXUS_CLIENT_SECRET";
        constexpr std::wstring_view nexusOAuthClientSecretName = L"NEXUS_OAUTH_CLIENT_SECRET";
        constexpr std::wstring_view nexusRedirectUriName = L"NEXUS_REDIRECT_URI";
        constexpr std::wstring_view nexusOAuthRedirectUriName = L"NEXUS_OAUTH_REDIRECT_URI";
        constexpr std::wstring_view nexusCredentialProviderId = L"nexus";
        constexpr std::wstring_view authorizeEndpoint = L"https://users.nexusmods.com/oauth/authorize";
        constexpr std::wstring_view tokenHost = L"users.nexusmods.com";
        constexpr std::wstring_view tokenPath = L"/oauth/token";
        constexpr std::wstring_view publicApiHost = L"api.nexusmods.com";
        constexpr std::wstring_view validateApiKeyPath = L"/v1/users/validate.json";
        constexpr int callbackTimeoutSeconds = 120;
        constexpr int callbackClientReadTimeoutMilliseconds = 3000;
        constexpr int supabaseCredentialTimeoutMilliseconds = 4000;

        struct OAuthConfig
        {
            std::wstring clientId;
            std::wstring clientSecret;
            std::wstring redirectUri;
        };

        struct HttpsUrlParts
        {
            std::wstring host;
            std::wstring pathAndQuery;
        };

        struct RedirectUriParts
        {
            std::wstring host;
            unsigned short port{0};
            std::wstring path;
        };

        struct CallbackResult
        {
            std::string code;
            std::string state;
            std::string error;
            std::string errorDescription;
        };

        std::wstring callbackPath(const RedirectUriParts& redirect)
        {
            return redirect.path.empty() ? L"/" : redirect.path;
        }

        std::wstring buildRedirectUri(const RedirectUriParts& redirect, unsigned short port)
        {
            std::wstring uri = L"http://" + redirect.host + L":" + std::to_wstring(port);
            uri += redirect.path;
            return uri;
        }

        std::string normalizeRequestTarget(std::string target)
        {
            const bool absoluteHttpUrl = target.starts_with("http://") || target.starts_with("https://");
            if (!absoluteHttpUrl)
            {
                return target;
            }

            const std::size_t schemeEnd = target.find("://");
            const std::size_t pathStart = target.find('/', schemeEnd == std::string::npos ? 0 : schemeEnd + 3);
            return pathStart == std::string::npos ? std::string("/") : target.substr(pathStart);
        }

        struct TokenResponse
        {
            std::wstring accessToken;
            std::wstring refreshToken;
            std::wstring tokenType;
            long long expiresInSeconds{0};
        };

        struct JwtUser
        {
            std::wstring username;
            std::wstring userId;
        };

        struct ApiKeyUser
        {
            std::wstring username;
            std::wstring userId;
        };

        std::wstring readEnvironment(std::wstring_view name)
        {
#ifdef _WIN32
            const DWORD requiredLength = GetEnvironmentVariableW(std::wstring(name).c_str(), nullptr, 0);
            if (requiredLength == 0)
            {
                return {};
            }

            std::wstring value(requiredLength, L'\0');
            const DWORD written = GetEnvironmentVariableW(
                std::wstring(name).c_str(),
                value.data(),
                requiredLength);
            value.resize(written);
            return value;
#else
            return {};
#endif
        }

        std::wstring trimWhitespace(std::wstring value)
        {
            const auto first = std::find_if(value.begin(), value.end(), [](wchar_t character) {
                return !std::iswspace(character);
            });
            const auto last = std::find_if(value.rbegin(), value.rend(), [](wchar_t character) {
                return !std::iswspace(character);
            }).base();
            if (first >= last)
            {
                return {};
            }

            return std::wstring(first, last);
        }

        std::wstring readTrimmedEnvironment(std::wstring_view name)
        {
            return trimWhitespace(readEnvironment(name));
        }

        std::wstring firstTrimmedEnvironmentValue(std::initializer_list<std::wstring_view> names)
        {
            for (std::wstring_view name : names)
            {
                std::wstring value = readTrimmedEnvironment(name);
                if (!value.empty())
                {
                    return value;
                }
            }

            return {};
        }

        std::wstring resolveNexusClientId(bool includeExternalConfig);
        std::wstring resolveNexusRedirectUri(bool includeExternalConfig);
        std::wstring resolveNexusClientSecret();
        std::wstring readJsonString(const JsonValue& object, std::wstring_view field);

        OAuthConfig loadConfig(bool includeExternalConfig = false)
        {
            OAuthConfig config;
            config.clientId = resolveNexusClientId(includeExternalConfig);
            config.redirectUri = resolveNexusRedirectUri(includeExternalConfig);

            if (includeExternalConfig)
            {
                config.clientSecret = resolveNexusClientSecret();
            }

            return config;
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
                throw std::runtime_error("UTF-8 conversion failed.");
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

        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character) {
                return static_cast<wchar_t>(::towlower(character));
            });
            return value;
        }

        bool isUnreserved(unsigned char character)
        {
            return (character >= 'A' && character <= 'Z') ||
                (character >= 'a' && character <= 'z') ||
                (character >= '0' && character <= '9') ||
                character == '-' ||
                character == '.' ||
                character == '_' ||
                character == '~';
        }

        std::wstring urlEncode(const std::wstring& value)
        {
            static constexpr wchar_t digits[] = L"0123456789ABCDEF";
            const std::string utf8 = toUtf8(value);
            std::wstring encoded;
            encoded.reserve(utf8.size());

            for (unsigned char character : utf8)
            {
                if (isUnreserved(character))
                {
                    encoded.push_back(static_cast<wchar_t>(character));
                    continue;
                }

                encoded.push_back(L'%');
                encoded.push_back(digits[(character >> 4) & 0xF]);
                encoded.push_back(digits[character & 0xF]);
            }

            return encoded;
        }

        std::optional<HttpsUrlParts> parseHttpsUrl(std::wstring_view value)
        {
            constexpr std::wstring_view scheme = L"https://";
            if (!value.starts_with(scheme))
            {
                return std::nullopt;
            }

            const std::size_t hostStart = scheme.size();
            const std::size_t pathStart = value.find(L'/', hostStart);
            std::wstring host(pathStart == std::wstring_view::npos
                ? value.substr(hostStart)
                : value.substr(hostStart, pathStart - hostStart));
            std::wstring path(pathStart == std::wstring_view::npos
                ? L"/"
                : std::wstring(value.substr(pathStart)));
            if (host.empty() || host.find(L'@') != std::wstring::npos || host.find(L'\\') != std::wstring::npos)
            {
                return std::nullopt;
            }

            if (host.ends_with(L":443"))
            {
                host.resize(host.size() - 4);
            }
            else if (host.find(L':') != std::wstring::npos)
            {
                return std::nullopt;
            }

            if (path.empty())
            {
                path = L"/";
            }

            return HttpsUrlParts{host, path};
        }

        bool hostIsAllowedSupabase(std::wstring host)
        {
            if (host.empty())
            {
                return false;
            }

            if (host.ends_with(L"."))
            {
                host.pop_back();
            }
            host = toLower(std::move(host));
            if (host == L"tpciohumwahlctpeuduv.supabase.co")
            {
                return true;
            }

            constexpr std::wstring_view suffix = L".supabase.co";
            return host.size() > suffix.size() &&
                host.compare(host.size() - suffix.size(), suffix.size(), suffix) == 0;
        }

        std::wstring supabaseBaseUrl()
        {
            std::wstring raw = readTrimmedEnvironment(L"FLUXORA_NEXUS_SUPABASE_URL");
            if (raw.empty())
            {
                raw = readTrimmedEnvironment(L"FLUXORA_AI_SUPABASE_URL");
            }
            if (raw.empty())
            {
                raw = std::wstring(defaultSupabaseUrl);
            }

            while (!raw.empty() && raw.back() == L'/')
            {
                raw.pop_back();
            }

            const std::optional<HttpsUrlParts> parsed = parseHttpsUrl(raw);
            if (!parsed.has_value() || parsed->pathAndQuery != L"/" || !hostIsAllowedSupabase(parsed->host))
            {
                return {};
            }

            return raw;
        }

        std::wstring supabaseAnonKey()
        {
            std::wstring key = readTrimmedEnvironment(L"FLUXORA_NEXUS_SUPABASE_ANON_KEY");
            if (key.empty())
            {
                key = readTrimmedEnvironment(L"FLUXORA_AI_SUPABASE_ANON_KEY");
            }
            if (key.empty())
            {
                key = std::wstring(defaultSupabaseAnonKey);
            }

            return trimWhitespace(std::move(key));
        }

        std::optional<std::wstring> safeSupabaseIdentifier(const std::wstring& value)
        {
            const std::wstring trimmed = trimWhitespace(value);
            if (trimmed.empty() || trimmed.size() > 80)
            {
                return std::nullopt;
            }

            const bool safe = std::all_of(trimmed.begin(), trimmed.end(), [](wchar_t character) {
                return (character >= L'A' && character <= L'Z') ||
                    (character >= L'a' && character <= L'z') ||
                    (character >= L'0' && character <= L'9') ||
                    character == L'_';
            });
            return safe ? std::optional<std::wstring>(trimmed) : std::nullopt;
        }

        std::optional<std::string> sendSupabaseRequest(
            const std::wstring& method,
            const std::wstring& endpoint,
            const std::wstring& extraHeaders,
            const std::string& body)
        {
#ifdef _WIN32
            const std::optional<HttpsUrlParts> parsed = parseHttpsUrl(endpoint);
            if (!parsed.has_value() || !hostIsAllowedSupabase(parsed->host))
            {
                return std::nullopt;
            }

            HINTERNET session = WinHttpOpen(
                L"Fluxora/0.1",
                WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                WINHTTP_NO_PROXY_NAME,
                WINHTTP_NO_PROXY_BYPASS,
                0);
            if (session == nullptr)
            {
                return std::nullopt;
            }

            WinHttpSetTimeouts(
                session,
                supabaseCredentialTimeoutMilliseconds,
                supabaseCredentialTimeoutMilliseconds,
                supabaseCredentialTimeoutMilliseconds,
                supabaseCredentialTimeoutMilliseconds);

            HINTERNET connection = WinHttpConnect(
                session,
                parsed->host.c_str(),
                INTERNET_DEFAULT_HTTPS_PORT,
                0);
            if (connection == nullptr)
            {
                WinHttpCloseHandle(session);
                return std::nullopt;
            }

            HINTERNET request = WinHttpOpenRequest(
                connection,
                method.c_str(),
                parsed->pathAndQuery.c_str(),
                nullptr,
                WINHTTP_NO_REFERER,
                WINHTTP_DEFAULT_ACCEPT_TYPES,
                WINHTTP_FLAG_SECURE);
            if (request == nullptr)
            {
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                return std::nullopt;
            }

            LPVOID requestBody = body.empty()
                ? WINHTTP_NO_REQUEST_DATA
                : static_cast<LPVOID>(const_cast<char*>(body.data()));
            const BOOL sent = WinHttpSendRequest(
                request,
                extraHeaders.c_str(),
                static_cast<DWORD>(extraHeaders.size()),
                requestBody,
                static_cast<DWORD>(body.size()),
                static_cast<DWORD>(body.size()),
                0);
            if (!sent || !WinHttpReceiveResponse(request, nullptr))
            {
                WinHttpCloseHandle(request);
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                return std::nullopt;
            }

            DWORD statusCode = 0;
            DWORD statusCodeSize = sizeof(statusCode);
            WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                WINHTTP_HEADER_NAME_BY_INDEX,
                &statusCode,
                &statusCodeSize,
                WINHTTP_NO_HEADER_INDEX);
            if (statusCode < 200 || statusCode >= 300)
            {
                WinHttpCloseHandle(request);
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                return std::nullopt;
            }

            std::string responseBody;
            DWORD available = 0;
            while (WinHttpQueryDataAvailable(request, &available) && available > 0)
            {
                std::vector<char> chunk(available);
                DWORD read = 0;
                if (!WinHttpReadData(request, chunk.data(), available, &read))
                {
                    break;
                }

                responseBody.append(chunk.data(), chunk.data() + read);
            }

            WinHttpCloseHandle(request);
            WinHttpCloseHandle(connection);
            WinHttpCloseHandle(session);
            return responseBody;
#else
            (void)method;
            (void)endpoint;
            (void)extraHeaders;
            (void)body;
            return std::nullopt;
#endif
        }

        std::string urlDecodeToUtf8(std::string_view value)
        {
            std::string decoded;
            decoded.reserve(value.size());

            for (std::size_t index = 0; index < value.size(); ++index)
            {
                const char character = value[index];
                if (character == '+' )
                {
                    decoded.push_back(' ');
                    continue;
                }

                if (character == '%' && index + 2 < value.size())
                {
                    const auto hex = value.substr(index + 1, 2);
                    const int high = std::isdigit(static_cast<unsigned char>(hex[0]))
                        ? hex[0] - '0'
                        : std::tolower(static_cast<unsigned char>(hex[0])) - 'a' + 10;
                    const int low = std::isdigit(static_cast<unsigned char>(hex[1]))
                        ? hex[1] - '0'
                        : std::tolower(static_cast<unsigned char>(hex[1])) - 'a' + 10;
                    if (high >= 0 && high <= 15 && low >= 0 && low <= 15)
                    {
                        decoded.push_back(static_cast<char>((high << 4) | low));
                        index += 2;
                        continue;
                    }
                }

                decoded.push_back(character);
            }

            return decoded;
        }

        std::map<std::string, std::string> parseQuery(std::string_view query)
        {
            std::map<std::string, std::string> values;
            std::size_t start = 0;
            while (start <= query.size())
            {
                const std::size_t end = query.find('&', start);
                const std::string_view pair = query.substr(
                    start,
                    end == std::string_view::npos ? std::string_view::npos : end - start);
                const std::size_t separator = pair.find('=');
                if (separator != std::string_view::npos)
                {
                    values[urlDecodeToUtf8(pair.substr(0, separator))] =
                        urlDecodeToUtf8(pair.substr(separator + 1));
                }

                if (end == std::string_view::npos)
                {
                    break;
                }

                start = end + 1;
            }

            return values;
        }

        RedirectUriParts parseRedirectUri(const std::wstring& redirectUri)
        {
            constexpr std::wstring_view scheme = L"http://";
            if (!redirectUri.starts_with(scheme))
            {
                throw std::invalid_argument("NexusMods redirect URI must use http://127.0.0.1 for desktop OAuth.");
            }

            const std::wstring_view rest(redirectUri.data() + scheme.size(), redirectUri.size() - scheme.size());
            const std::size_t pathStart = rest.find(L'/');
            const std::wstring hostPort(pathStart == std::wstring_view::npos ? rest : rest.substr(0, pathStart));
            const std::wstring path(pathStart == std::wstring_view::npos ? L"" : std::wstring(rest.substr(pathStart)));

            const std::size_t colon = hostPort.find(L':');
            const std::wstring host = colon == std::wstring::npos ? hostPort : hostPort.substr(0, colon);
            unsigned short port = 80;
            if (colon != std::wstring::npos)
            {
                const std::wstring portText = hostPort.substr(colon + 1);
                if (portText == L"PORT")
                {
                    port = 0;
                }
                else
                {
                    const int parsedPort = std::stoi(portText);
                    if (parsedPort < 0 || parsedPort > 65535)
                    {
                        throw std::invalid_argument("NexusMods redirect URI port is out of range.");
                    }

                    port = static_cast<unsigned short>(parsedPort);
                }
            }

            const std::wstring normalizedHost = toLower(host);
            if (normalizedHost != L"127.0.0.1" && normalizedHost != L"localhost")
            {
                throw std::invalid_argument("NexusMods redirect URI must point to localhost.");
            }

            return RedirectUriParts{
                normalizedHost,
                port,
                path
            };
        }

        std::wstring base64UrlEncode(const std::vector<unsigned char>& bytes)
        {
            static constexpr wchar_t table[] =
                L"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

            std::wstring encoded;
            int value = 0;
            int bits = -6;
            for (unsigned char byte : bytes)
            {
                value = (value << 8) + byte;
                bits += 8;
                while (bits >= 0)
                {
                    encoded.push_back(table[(value >> bits) & 0x3F]);
                    bits -= 6;
                }
            }

            if (bits > -6)
            {
                encoded.push_back(table[((value << 8) >> (bits + 8)) & 0x3F]);
            }

            return encoded;
        }

        std::vector<unsigned char> base64UrlDecode(std::string_view value)
        {
            std::vector<int> table(256, -1);
            const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            for (int index = 0; index < static_cast<int>(alphabet.size()); ++index)
            {
                table[static_cast<unsigned char>(alphabet[static_cast<std::size_t>(index)])] = index;
            }

            std::vector<unsigned char> decoded;
            int accumulator = 0;
            int bits = -8;
            for (unsigned char character : value)
            {
                if (character == '=')
                {
                    break;
                }

                const int digit = table[character];
                if (digit < 0)
                {
                    break;
                }

                accumulator = (accumulator << 6) + digit;
                bits += 6;
                if (bits >= 0)
                {
                    decoded.push_back(static_cast<unsigned char>((accumulator >> bits) & 0xFF));
                    bits -= 8;
                }
            }

            return decoded;
        }

        std::wstring bytesToHex(const unsigned char* bytes, std::size_t count)
        {
            static constexpr wchar_t digits[] = L"0123456789abcdef";
            std::wstring hex;
            hex.reserve(count * 2);
            for (std::size_t index = 0; index < count; ++index)
            {
                const unsigned char byte = bytes[index];
                hex.push_back(digits[(byte >> 4) & 0xF]);
                hex.push_back(digits[byte & 0xF]);
            }

            return hex;
        }

        std::vector<unsigned char> generateRandomBytes(std::size_t count)
        {
#ifdef _WIN32
            std::vector<unsigned char> bytes(count);
            if (BCryptGenRandom(
                    nullptr,
                    bytes.data(),
                    static_cast<ULONG>(bytes.size()),
                    BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0)
            {
                throw std::runtime_error("Failed to generate secure random bytes.");
            }

            return bytes;
#else
            throw std::runtime_error("NexusMods OAuth is currently implemented for Windows builds.");
#endif
        }

        std::wstring generateHexRandom(std::size_t byteCount)
        {
            const std::vector<unsigned char> bytes = generateRandomBytes(byteCount);
            return bytesToHex(bytes.data(), bytes.size());
        }

        std::vector<unsigned char> sha256(std::string_view value)
        {
#ifdef _WIN32
            BCRYPT_ALG_HANDLE algorithm = nullptr;
            BCRYPT_HASH_HANDLE hash = nullptr;

            if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0)
            {
                throw std::runtime_error("Failed to open SHA-256 provider.");
            }

            DWORD objectLength = 0;
            DWORD resultLength = 0;
            if (BCryptGetProperty(
                    algorithm,
                    BCRYPT_OBJECT_LENGTH,
                    reinterpret_cast<PUCHAR>(&objectLength),
                    sizeof(objectLength),
                    &resultLength,
                    0) < 0)
            {
                BCryptCloseAlgorithmProvider(algorithm, 0);
                throw std::runtime_error("Failed to query SHA-256 object size.");
            }

            DWORD hashLength = 0;
            if (BCryptGetProperty(
                    algorithm,
                    BCRYPT_HASH_LENGTH,
                    reinterpret_cast<PUCHAR>(&hashLength),
                    sizeof(hashLength),
                    &resultLength,
                    0) < 0)
            {
                BCryptCloseAlgorithmProvider(algorithm, 0);
                throw std::runtime_error("Failed to query SHA-256 hash size.");
            }

            std::vector<unsigned char> objectBuffer(objectLength);
            std::vector<unsigned char> digest(hashLength);

            if (BCryptCreateHash(
                    algorithm,
                    &hash,
                    objectBuffer.data(),
                    static_cast<ULONG>(objectBuffer.size()),
                    nullptr,
                    0,
                    0) < 0)
            {
                BCryptCloseAlgorithmProvider(algorithm, 0);
                throw std::runtime_error("Failed to create SHA-256 hash.");
            }

            if (BCryptHashData(
                    hash,
                    reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
                    static_cast<ULONG>(value.size()),
                    0) < 0 ||
                BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) < 0)
            {
                BCryptDestroyHash(hash);
                BCryptCloseAlgorithmProvider(algorithm, 0);
                throw std::runtime_error("Failed to compute SHA-256 hash.");
            }

            BCryptDestroyHash(hash);
            BCryptCloseAlgorithmProvider(algorithm, 0);
            return digest;
#else
            throw std::runtime_error("NexusMods OAuth is currently implemented for Windows builds.");
#endif
        }

        std::wstring protectSecret(const std::wstring& value)
        {
#ifdef _WIN32
            DATA_BLOB input{};
            input.pbData = reinterpret_cast<BYTE*>(const_cast<wchar_t*>(value.data()));
            input.cbData = static_cast<DWORD>(value.size() * sizeof(wchar_t));

            DATA_BLOB output{};
            if (!CryptProtectData(
                    &input,
                    L"Fluxora NexusMods OAuth token",
                    nullptr,
                    nullptr,
                    nullptr,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &output))
            {
                throw std::runtime_error("Failed to protect NexusMods OAuth token.");
            }

            const std::wstring protectedValue = bytesToHex(output.pbData, output.cbData);
            LocalFree(output.pbData);
            return protectedValue;
#else
            return value;
#endif
        }

        std::wstring buildAuthorizeUrl(
            const OAuthConfig& config,
            const std::wstring& redirectUri,
            const std::wstring& state,
            const std::wstring& codeChallenge)
        {
            std::wstring url(authorizeEndpoint);
            url += L"?client_id=" + urlEncode(config.clientId);
            url += L"&response_type=code";
            url += L"&scope=";
            url += L"&redirect_uri=" + urlEncode(redirectUri);
            url += L"&state=" + urlEncode(state);
            if (config.clientSecret.empty())
            {
                url += L"&code_challenge_method=S256";
                url += L"&code_challenge=" + urlEncode(codeChallenge);
            }
            return url;
        }

        void openSystemBrowser(const std::wstring& url)
        {
#ifdef _WIN32
            const HINSTANCE result = ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            if (reinterpret_cast<intptr_t>(result) <= 32)
            {
                throw std::runtime_error("Failed to open the system browser.");
            }
#else
            (void)url;
            throw std::runtime_error("Opening a browser is currently implemented for Windows builds.");
#endif
        }

        std::string readHttpRequest(SOCKET client)
        {
            std::string request;
            char buffer[2048]{};
            while (request.find("\r\n\r\n") == std::string::npos && request.size() < 16384)
            {
                const int received = recv(client, buffer, static_cast<int>(sizeof(buffer)), 0);
                if (received <= 0)
                {
                    break;
                }

                request.append(buffer, buffer + received);
            }

            return request;
        }

        void sendHttpResponse(SOCKET client, std::string_view title, std::string_view body)
        {
            const std::string html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>" +
                std::string(title) +
                "</title></head><body style=\"font-family:Segoe UI,Arial,sans-serif;margin:40px\"><h2>" +
                std::string(title) +
                "</h2><p>" +
                std::string(body) +
                "</p></body></html>";

            const std::string response =
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: text/html; charset=utf-8\r\n"
                "Content-Length: " + std::to_string(html.size()) + "\r\n"
                "Connection: close\r\n\r\n" +
                html;

            send(client, response.data(), static_cast<int>(response.size()), 0);
        }

        CallbackResult parseCallbackRequest(const std::string& request, const RedirectUriParts& redirect)
        {
            const std::size_t firstSpace = request.find(' ');
            const std::size_t secondSpace = request.find(' ', firstSpace == std::string::npos ? 0 : firstSpace + 1);
            if (firstSpace == std::string::npos || secondSpace == std::string::npos)
            {
                throw std::runtime_error("Invalid OAuth callback request.");
            }

            const std::string target = normalizeRequestTarget(
                request.substr(firstSpace + 1, secondSpace - firstSpace - 1));
            const std::size_t queryStart = target.find('?');
            const std::string targetPath = target.substr(0, queryStart);
            const std::string expectedPath = toUtf8(callbackPath(redirect));
            if (targetPath != expectedPath)
            {
                throw std::runtime_error("OAuth callback path does not match the configured redirect URI.");
            }

            const std::map<std::string, std::string> values = queryStart == std::string::npos
                ? std::map<std::string, std::string>{}
                : parseQuery(std::string_view(target).substr(queryStart + 1));

            CallbackResult result;
            if (const auto match = values.find("code"); match != values.end())
            {
                result.code = match->second;
            }
            if (const auto match = values.find("state"); match != values.end())
            {
                result.state = match->second;
            }
            if (const auto match = values.find("error"); match != values.end())
            {
                result.error = match->second;
            }
            if (const auto match = values.find("error_description"); match != values.end())
            {
                result.errorDescription = match->second;
            }

            return result;
        }

        class OAuthCallbackListener final
        {
        public:
            explicit OAuthCallbackListener(RedirectUriParts redirect)
                : redirect_(std::move(redirect))
            {
#ifdef _WIN32
                WSADATA wsaData{};
                if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
                {
                    throw std::runtime_error("Failed to initialize the OAuth callback listener.");
                }
                winsockStarted_ = true;

                listener_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
                if (listener_ == INVALID_SOCKET)
                {
                    cleanup();
                    throw std::runtime_error("Failed to create the OAuth callback listener.");
                }

                sockaddr_in address{};
                address.sin_family = AF_INET;
                address.sin_port = htons(redirect_.port);
                inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);

                if (bind(listener_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR ||
                    listen(listener_, 1) == SOCKET_ERROR)
                {
                    cleanup();
                    throw std::runtime_error("Failed to bind the OAuth callback listener. Check that the redirect port is free.");
                }

                sockaddr_in boundAddress{};
                int boundAddressLength = sizeof(boundAddress);
                if (getsockname(listener_, reinterpret_cast<sockaddr*>(&boundAddress), &boundAddressLength) == SOCKET_ERROR)
                {
                    cleanup();
                    throw std::runtime_error("Failed to resolve the OAuth callback listener port.");
                }

                actualPort_ = ntohs(boundAddress.sin_port);
                redirectUri_ = buildRedirectUri(redirect_, actualPort_);
#else
                (void)redirect_;
                throw std::runtime_error("NexusMods OAuth callback listener is currently implemented for Windows builds.");
#endif
            }

            OAuthCallbackListener(const OAuthCallbackListener&) = delete;
            OAuthCallbackListener& operator=(const OAuthCallbackListener&) = delete;

            ~OAuthCallbackListener()
            {
                cleanup();
            }

            [[nodiscard]] const std::wstring& redirectUri() const noexcept
            {
                return redirectUri_;
            }

            CallbackResult waitForRequest()
            {
#ifdef _WIN32
                const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(callbackTimeoutSeconds);
                while (true)
                {
                    const auto now = std::chrono::steady_clock::now();
                    const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now);
                    if (remaining.count() <= 0)
                    {
                        throw std::runtime_error("Timed out waiting for NexusMods OAuth callback.");
                    }

                    fd_set readSet;
                    FD_ZERO(&readSet);
                    FD_SET(listener_, &readSet);
                    timeval timeout{};
                    timeout.tv_sec = static_cast<long>(remaining.count() / 1000);
                    timeout.tv_usec = static_cast<long>((remaining.count() % 1000) * 1000);

                    const int selected = select(0, &readSet, nullptr, nullptr, &timeout);
                    if (selected <= 0)
                    {
                        throw std::runtime_error("Timed out waiting for NexusMods OAuth callback.");
                    }

                    client_ = accept(listener_, nullptr, nullptr);
                    if (client_ == INVALID_SOCKET)
                    {
                        throw std::runtime_error("Failed to accept the NexusMods OAuth callback.");
                    }

                    DWORD receiveTimeout = callbackClientReadTimeoutMilliseconds;
                    setsockopt(
                        client_,
                        SOL_SOCKET,
                        SO_RCVTIMEO,
                        reinterpret_cast<const char*>(&receiveTimeout),
                        sizeof(receiveTimeout));

                    try
                    {
                        const std::string request = readHttpRequest(client_);
                        if (request.empty())
                        {
                            closeClient();
                            continue;
                        }

                        CallbackResult result = parseCallbackRequest(request, redirect_);
                        if (result.code.empty() && result.error.empty())
                        {
                            sendHttpResponse(
                                client_,
                                "Fluxora OAuth callback",
                                "Fluxora is waiting for the NexusMods authorization callback.");
                            closeClient();
                            continue;
                        }

                        return result;
                    }
                    catch (...)
                    {
                        respondFailure("Fluxora could not read this local OAuth request. Waiting for the NexusMods callback.");
                        closeClient();
                    }
                }
#else
                throw std::runtime_error("NexusMods OAuth callback listener is currently implemented for Windows builds.");
#endif
            }

            void respondSuccess()
            {
#ifdef _WIN32
                respond("Fluxora authorization received", "You can close this browser tab and return to Fluxora.");
#endif
            }

            void respondFailure(std::string_view body)
            {
#ifdef _WIN32
                respond("Fluxora authorization failed", body);
#else
                (void)body;
#endif
            }

        private:
#ifdef _WIN32
            void respond(std::string_view title, std::string_view body)
            {
                if (client_ == INVALID_SOCKET || responded_)
                {
                    return;
                }

                sendHttpResponse(client_, title, body);
                responded_ = true;
            }

            void closeClient() noexcept
            {
                if (client_ != INVALID_SOCKET)
                {
                    closesocket(client_);
                    client_ = INVALID_SOCKET;
                }

                responded_ = false;
            }
#endif

            void cleanup() noexcept
            {
#ifdef _WIN32
                closeClient();

                if (listener_ != INVALID_SOCKET)
                {
                    closesocket(listener_);
                    listener_ = INVALID_SOCKET;
                }

                if (winsockStarted_)
                {
                    WSACleanup();
                    winsockStarted_ = false;
                }
#endif
            }

            RedirectUriParts redirect_;
            std::wstring redirectUri_;
            unsigned short actualPort_{0};
            bool responded_{false};
#ifdef _WIN32
            SOCKET listener_{INVALID_SOCKET};
            SOCKET client_{INVALID_SOCKET};
            bool winsockStarted_{false};
#endif
        };

        std::string buildTokenRequestBody(
            const OAuthConfig& config,
            const std::wstring& redirectUri,
            const std::string& code,
            const std::wstring& codeVerifier)
        {
            std::wstring body;
            body += L"grant_type=authorization_code";
            body += L"&redirect_uri=" + urlEncode(redirectUri);
            body += L"&client_id=" + urlEncode(config.clientId);
            if (!config.clientSecret.empty())
            {
                body += L"&client_secret=" + urlEncode(config.clientSecret);
            }
            body += L"&code=" + urlEncode(fromUtf8(code));
            if (config.clientSecret.empty())
            {
                body += L"&code_verifier=" + urlEncode(codeVerifier);
            }
            return toUtf8(body);
        }

        std::wstring readJsonString(const JsonValue& object, std::wstring_view field);

        std::string limitForError(std::string value)
        {
            constexpr std::size_t maxLength = 240;
            value.erase(std::remove(value.begin(), value.end(), '\r'), value.end());
            std::replace(value.begin(), value.end(), '\n', ' ');
            if (value.size() > maxLength)
            {
                value.resize(maxLength);
                value += "...";
            }

            return value;
        }

        std::string buildTokenErrorMessage(unsigned long statusCode, const std::string& body)
        {
            std::string message = "NexusMods token endpoint rejected the authorization code";
            message += " (HTTP " + std::to_string(statusCode) + ")";

            try
            {
                const JsonValue root = JsonReader::parse(fromUtf8(body));
                if (root.isObject())
                {
                    const std::wstring error = readJsonString(root, L"error");
                    const std::wstring description = readJsonString(root, L"error_description");
                    if (!error.empty())
                    {
                        message += ": " + toUtf8(error);
                    }
                    if (!description.empty())
                    {
                        message += ". " + toUtf8(description);
                    }

                    return message;
                }
            }
            catch (const std::exception&)
            {
            }

            if (body.find("<!DOCTYPE html>") != std::string::npos || body.find("<html") != std::string::npos)
            {
                message += ": received an HTML response instead of JSON. Check the network connection or NexusMods anti-bot/proxy restrictions.";
                return message;
            }

            if (!body.empty())
            {
                message += ": " + limitForError(body);
            }

            return message;
        }

        std::string postTokenRequest(const std::string& body)
        {
#ifdef _WIN32
            HINTERNET session = WinHttpOpen(
                L"Fluxora/0.1",
                WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                WINHTTP_NO_PROXY_NAME,
                WINHTTP_NO_PROXY_BYPASS,
                0);
            if (session == nullptr)
            {
                throw std::runtime_error("Failed to initialize NexusMods token request.");
            }

            WinHttpSetTimeouts(session, 15000, 15000, 15000, 30000);

            HINTERNET connection = WinHttpConnect(
                session,
                std::wstring(tokenHost).c_str(),
                INTERNET_DEFAULT_HTTPS_PORT,
                0);
            if (connection == nullptr)
            {
                WinHttpCloseHandle(session);
                throw std::runtime_error("Failed to connect to NexusMods token endpoint.");
            }

            HINTERNET request = WinHttpOpenRequest(
                connection,
                L"POST",
                std::wstring(tokenPath).c_str(),
                nullptr,
                WINHTTP_NO_REFERER,
                WINHTTP_DEFAULT_ACCEPT_TYPES,
                WINHTTP_FLAG_SECURE);
            if (request == nullptr)
            {
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                throw std::runtime_error("Failed to open NexusMods token request.");
            }

            const std::wstring headers =
                L"Content-Type: application/x-www-form-urlencoded; charset=UTF-8\r\n"
                L"Application-Name: Fluxora\r\n"
                L"Application-Version: 0.1.0\r\n";

            const BOOL sent = WinHttpSendRequest(
                request,
                headers.c_str(),
                static_cast<DWORD>(headers.size()),
                const_cast<char*>(body.data()),
                static_cast<DWORD>(body.size()),
                static_cast<DWORD>(body.size()),
                0);
            if (!sent || !WinHttpReceiveResponse(request, nullptr))
            {
                WinHttpCloseHandle(request);
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                throw std::runtime_error("NexusMods token request failed.");
            }

            DWORD statusCode = 0;
            DWORD statusCodeSize = sizeof(statusCode);
            WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                WINHTTP_HEADER_NAME_BY_INDEX,
                &statusCode,
                &statusCodeSize,
                WINHTTP_NO_HEADER_INDEX);

            std::string responseBody;
            DWORD available = 0;
            while (WinHttpQueryDataAvailable(request, &available) && available > 0)
            {
                std::vector<char> chunk(available);
                DWORD read = 0;
                if (!WinHttpReadData(request, chunk.data(), available, &read))
                {
                    break;
                }

                responseBody.append(chunk.data(), chunk.data() + read);
            }

            WinHttpCloseHandle(request);
            WinHttpCloseHandle(connection);
            WinHttpCloseHandle(session);

            if (statusCode < 200 || statusCode >= 300)
            {
                throw std::runtime_error(buildTokenErrorMessage(statusCode, responseBody));
            }

            return responseBody;
#else
            (void)body;
            throw std::runtime_error("NexusMods token exchange is currently implemented for Windows builds.");
#endif
        }

        std::wstring readJsonString(const JsonValue& object, std::wstring_view field)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || !value->isString())
            {
                return {};
            }

            return value->asString();
        }

        long long readJsonInteger(const JsonValue& object, std::wstring_view field)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr)
            {
                return 0;
            }

            if (value->isNumber())
            {
                return std::stoll(value->asNumber());
            }

            if (value->isString())
            {
                return std::stoll(value->asString());
            }

            return 0;
        }

        std::wstring readFirstJsonString(
            const JsonValue& object,
            std::initializer_list<std::wstring_view> fields)
        {
            for (std::wstring_view field : fields)
            {
                std::wstring value = trimWhitespace(readJsonString(object, field));
                if (!value.empty())
                {
                    return value;
                }
            }

            return {};
        }

        std::string buildNexusApiValidationError(unsigned long statusCode, const std::string& body)
        {
            std::string message = "NexusMods API key validation failed";
            if (statusCode != 0)
            {
                message += " (HTTP " + std::to_string(statusCode) + ")";
            }

            try
            {
                const JsonValue root = JsonReader::parse(fromUtf8(body));
                if (root.isObject())
                {
                    const std::wstring error = readFirstJsonString(root, {L"error", L"name", L"code"});
                    const std::wstring description = readFirstJsonString(root, {L"message", L"description"});
                    if (!error.empty())
                    {
                        message += ": " + toUtf8(error);
                    }
                    if (!description.empty())
                    {
                        message += ". " + toUtf8(description);
                    }

                    return message;
                }
            }
            catch (const std::exception&)
            {
            }

            if (!body.empty())
            {
                message += ": " + limitForError(body);
            }

            return message;
        }

        std::string getNexusPublicApi(std::wstring_view pathAndQuery, std::wstring_view apiKey)
        {
#ifdef _WIN32
            HINTERNET session = WinHttpOpen(
                L"Fluxora/0.1",
                WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                WINHTTP_NO_PROXY_NAME,
                WINHTTP_NO_PROXY_BYPASS,
                0);
            if (session == nullptr)
            {
                throw std::runtime_error("Failed to initialize NexusMods API request.");
            }

            WinHttpSetTimeouts(session, 15000, 15000, 15000, 30000);

            HINTERNET connection = WinHttpConnect(
                session,
                std::wstring(publicApiHost).c_str(),
                INTERNET_DEFAULT_HTTPS_PORT,
                0);
            if (connection == nullptr)
            {
                WinHttpCloseHandle(session);
                throw std::runtime_error("Failed to connect to NexusMods API.");
            }

            HINTERNET request = WinHttpOpenRequest(
                connection,
                L"GET",
                std::wstring(pathAndQuery).c_str(),
                nullptr,
                WINHTTP_NO_REFERER,
                WINHTTP_DEFAULT_ACCEPT_TYPES,
                WINHTTP_FLAG_SECURE);
            if (request == nullptr)
            {
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                throw std::runtime_error("Failed to open NexusMods API request.");
            }

            std::wstring headers =
                L"Accept: application/json\r\n"
                L"Application-Name: Fluxora\r\n"
                L"Application-Version: 0.1.0\r\n"
                L"apikey: " + std::wstring(apiKey) + L"\r\n";

            const BOOL sent = WinHttpSendRequest(
                request,
                headers.c_str(),
                static_cast<DWORD>(headers.size()),
                WINHTTP_NO_REQUEST_DATA,
                0,
                0,
                0);
            if (!sent || !WinHttpReceiveResponse(request, nullptr))
            {
                WinHttpCloseHandle(request);
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                throw std::runtime_error("NexusMods API request failed.");
            }

            DWORD statusCode = 0;
            DWORD statusCodeSize = sizeof(statusCode);
            WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                WINHTTP_HEADER_NAME_BY_INDEX,
                &statusCode,
                &statusCodeSize,
                WINHTTP_NO_HEADER_INDEX);

            std::string responseBody;
            DWORD available = 0;
            while (WinHttpQueryDataAvailable(request, &available) && available > 0)
            {
                std::vector<char> chunk(available);
                DWORD read = 0;
                if (!WinHttpReadData(request, chunk.data(), available, &read))
                {
                    break;
                }

                responseBody.append(chunk.data(), chunk.data() + read);
            }

            WinHttpCloseHandle(request);
            WinHttpCloseHandle(connection);
            WinHttpCloseHandle(session);

            if (statusCode < 200 || statusCode >= 300)
            {
                throw std::runtime_error(buildNexusApiValidationError(statusCode, responseBody));
            }

            return responseBody;
#else
            (void)pathAndQuery;
            (void)apiKey;
            throw std::runtime_error("NexusMods API key validation is currently implemented for Windows builds.");
#endif
        }

        ApiKeyUser validateNexusApiKey(std::wstring apiKey)
        {
            apiKey = trimWhitespace(std::move(apiKey));
            if (apiKey.empty())
            {
                throw std::invalid_argument("NexusMods API key is required.");
            }

            const std::string body = getNexusPublicApi(validateApiKeyPath, apiKey);
            const JsonValue root = JsonReader::parse(fromUtf8(body));
            if (!root.isObject())
            {
                throw std::runtime_error("NexusMods API key validation response was not a JSON object.");
            }

            ApiKeyUser user;
            user.username = readFirstJsonString(root, {L"name", L"username", L"display_name"});
            user.userId = readFirstJsonString(root, {L"user_id", L"userId", L"id"});
            if (user.userId.empty())
            {
                const long long numericUserId = readJsonInteger(root, L"user_id");
                if (numericUserId > 0)
                {
                    user.userId = std::to_wstring(numericUserId);
                }
            }

            return user;
        }

        TokenResponse parseTokenResponse(const std::string& body)
        {
            const JsonValue root = JsonReader::parse(fromUtf8(body));
            if (!root.isObject())
            {
                throw std::runtime_error("NexusMods token response was not a JSON object.");
            }

            TokenResponse tokens;
            tokens.accessToken = readJsonString(root, L"access_token");
            tokens.refreshToken = readJsonString(root, L"refresh_token");
            tokens.tokenType = readJsonString(root, L"token_type");
            tokens.expiresInSeconds = readJsonInteger(root, L"expires_in");

            if (tokens.accessToken.empty())
            {
                throw std::runtime_error("NexusMods token response did not include an access token.");
            }

            return tokens;
        }

        std::wstring extractSupabaseCredentialValue(const JsonValue& value)
        {
            if (value.isString())
            {
                return trimWhitespace(value.asString());
            }

            if (value.isArray())
            {
                for (const JsonValue& item : value.asArray())
                {
                    std::wstring credential = extractSupabaseCredentialValue(item);
                    if (!credential.empty())
                    {
                        return credential;
                    }
                }

                return {};
            }

            if (!value.isObject())
            {
                return {};
            }

            for (std::wstring_view field : {
                     L"clientSecret",
                     L"client_secret",
                     L"decrypted_secret",
                     L"credential",
                     L"secret",
                     L"value",
                     L"apiKey",
                     L"key",
                 })
            {
                const JsonValue* nested = value.find(field);
                if (nested == nullptr)
                {
                    continue;
                }

                std::wstring credential = extractSupabaseCredentialValue(*nested);
                if (!credential.empty())
                {
                    return credential;
                }
            }

            return {};
        }

        std::wstring supabaseCredentialRequestHeaders()
        {
            const std::wstring anonKey = supabaseAnonKey();
            if (anonKey.empty())
            {
                return {};
            }

            return L"apikey: " + anonKey + L"\r\n"
                L"Authorization: Bearer " + anonKey + L"\r\n"
                L"User-Agent: Fluxora/0.1\r\n"
                L"Accept: application/json\r\n";
        }

        std::wstring supabaseCredentialFromRpc(std::wstring_view secretName)
        {
            const std::wstring baseUrl = supabaseBaseUrl();
            std::wstring headers = supabaseCredentialRequestHeaders();
            if (baseUrl.empty() || headers.empty())
            {
                return {};
            }

            std::wstring rpcName = readTrimmedEnvironment(L"FLUXORA_NEXUS_SUPABASE_CREDENTIAL_RPC");
            if (rpcName.empty())
            {
                rpcName = readTrimmedEnvironment(L"FLUXORA_AI_SUPABASE_CREDENTIAL_RPC");
            }
            std::optional<std::wstring> safeRpcName = safeSupabaseIdentifier(
                rpcName.empty() ? std::wstring(supabaseCredentialRpc) : rpcName);
            if (!safeRpcName.has_value())
            {
                return {};
            }

            headers += L"Content-Type: application/json; charset=UTF-8\r\n";
            const std::wstring endpoint = baseUrl + L"/rest/v1/rpc/" + safeRpcName.value();
            const std::string body =
                "{\"provider_id\":\"" + toUtf8(std::wstring(nexusCredentialProviderId)) +
                "\",\"secret_name\":\"" + toUtf8(std::wstring(secretName)) + "\"}";
            const std::optional<std::string> response = sendSupabaseRequest(L"POST", endpoint, headers, body);
            if (!response.has_value())
            {
                return {};
            }

            try
            {
                return extractSupabaseCredentialValue(JsonReader::parse(fromUtf8(response.value())));
            }
            catch (const std::exception&)
            {
                return {};
            }
        }

        std::wstring supabaseCredentialFromTable(std::wstring_view secretName)
        {
            const std::wstring baseUrl = supabaseBaseUrl();
            const std::wstring headers = supabaseCredentialRequestHeaders();
            if (baseUrl.empty() || headers.empty())
            {
                return {};
            }

            std::optional<std::wstring> tableName =
                safeSupabaseIdentifier(readTrimmedEnvironment(L"FLUXORA_NEXUS_SUPABASE_CREDENTIAL_TABLE"));
            if (!tableName.has_value())
            {
                tableName = safeSupabaseIdentifier(readTrimmedEnvironment(L"FLUXORA_AI_SUPABASE_CREDENTIAL_TABLE"));
            }
            if (!tableName.has_value())
            {
                return {};
            }

            std::optional<std::wstring> nameColumn =
                safeSupabaseIdentifier(readTrimmedEnvironment(L"FLUXORA_NEXUS_SUPABASE_CREDENTIAL_NAME_COLUMN"));
            if (!nameColumn.has_value())
            {
                nameColumn =
                    safeSupabaseIdentifier(readTrimmedEnvironment(L"FLUXORA_AI_SUPABASE_CREDENTIAL_NAME_COLUMN"));
            }
            if (!nameColumn.has_value())
            {
                nameColumn = std::wstring(L"name");
            }

            std::optional<std::wstring> valueColumn =
                safeSupabaseIdentifier(readTrimmedEnvironment(L"FLUXORA_NEXUS_SUPABASE_CREDENTIAL_VALUE_COLUMN"));
            if (!valueColumn.has_value())
            {
                valueColumn =
                    safeSupabaseIdentifier(readTrimmedEnvironment(L"FLUXORA_AI_SUPABASE_CREDENTIAL_VALUE_COLUMN"));
            }
            if (!valueColumn.has_value())
            {
                valueColumn = std::wstring(L"value");
            }

            const std::wstring endpoint = baseUrl +
                L"/rest/v1/" + tableName.value() +
                L"?select=" + nameColumn.value() + L"," + valueColumn.value() +
                L"&" + nameColumn.value() + L"=eq." + urlEncode(std::wstring(secretName)) +
                L"&limit=1";
            const std::optional<std::string> response = sendSupabaseRequest(L"GET", endpoint, headers, {});
            if (!response.has_value())
            {
                return {};
            }

            try
            {
                return extractSupabaseCredentialValue(JsonReader::parse(fromUtf8(response.value())));
            }
            catch (const std::exception&)
            {
                return {};
            }
        }

        std::wstring supabaseCredential(std::initializer_list<std::wstring_view> secretNames)
        {
            for (std::wstring_view secretName : secretNames)
            {
                std::wstring credential = supabaseCredentialFromRpc(secretName);
                if (!credential.empty())
                {
                    return credential;
                }

                credential = supabaseCredentialFromTable(secretName);
                if (!credential.empty())
                {
                    return credential;
                }
            }

            return {};
        }

        std::wstring resolveNexusClientId(bool includeExternalConfig)
        {
            std::wstring clientId = firstTrimmedEnvironmentValue({
                L"FLUXORA_NEXUS_CLIENT_ID",
                L"NEXUS_CLIENT_ID",
                L"NEXUS_OAUTH_CLIENT_ID",
            });
            if (!clientId.empty())
            {
                return clientId;
            }

            if (includeExternalConfig)
            {
                clientId = supabaseCredential({nexusClientIdName, nexusOAuthClientIdName});
                if (!clientId.empty())
                {
                    return clientId;
                }
            }

            return std::wstring(defaultClientId);
        }

        std::wstring resolveNexusRedirectUri(bool includeExternalConfig)
        {
            std::wstring redirectUri = firstTrimmedEnvironmentValue({
                L"FLUXORA_NEXUS_REDIRECT_URI",
                L"NEXUS_REDIRECT_URI",
                L"NEXUS_OAUTH_REDIRECT_URI",
            });
            if (!redirectUri.empty())
            {
                return redirectUri;
            }

            if (includeExternalConfig)
            {
                redirectUri = supabaseCredential({nexusRedirectUriName, nexusOAuthRedirectUriName});
                if (!redirectUri.empty())
                {
                    return redirectUri;
                }
            }

            return std::wstring(defaultRedirectUri);
        }

        std::wstring resolveNexusClientSecret()
        {
            std::wstring secret = firstTrimmedEnvironmentValue({
                L"FLUXORA_NEXUS_CLIENT_SECRET",
                L"NEXUS_CLIENT_SECRET",
                L"NEXUS_OAUTH_CLIENT_SECRET",
            });
            if (!secret.empty())
            {
                return secret;
            }

            return supabaseCredential({nexusClientSecretName, nexusOAuthClientSecretName});
        }

        JwtUser parseJwtUser(const std::wstring& accessToken)
        {
            JwtUser user;
            const std::string token = toUtf8(accessToken);
            const std::size_t firstDot = token.find('.');
            const std::size_t secondDot = firstDot == std::string::npos ? std::string::npos : token.find('.', firstDot + 1);
            if (firstDot == std::string::npos || secondDot == std::string::npos)
            {
                return user;
            }

            const std::string payloadText = [&]() {
                const std::vector<unsigned char> bytes = base64UrlDecode(
                    std::string_view(token).substr(firstDot + 1, secondDot - firstDot - 1));
                return std::string(bytes.begin(), bytes.end());
            }();

            try
            {
                const JsonValue payload = JsonReader::parse(fromUtf8(payloadText));
                if (!payload.isObject())
                {
                    return user;
                }

                user.userId = readJsonString(payload, L"sub");
                const JsonValue* userObject = payload.find(L"user");
                if (userObject != nullptr && userObject->isObject())
                {
                    user.username = readJsonString(*userObject, L"username");
                    if (user.userId.empty())
                    {
                        const JsonValue* id = userObject->find(L"id");
                        if (id != nullptr)
                        {
                            user.userId = id->isNumber() ? id->asNumber() : readJsonString(*userObject, L"id");
                        }
                    }
                }
            }
            catch (const std::exception&)
            {
                return {};
            }

            return user;
        }

        std::wstring formatUtcExpiry(long long expiresInSeconds)
        {
            using clock = std::chrono::system_clock;
            const clock::time_point expiresAt = clock::now() + std::chrono::seconds(expiresInSeconds);
            const std::time_t time = clock::to_time_t(expiresAt);

            std::tm utc{};
#ifdef _WIN32
            gmtime_s(&utc, &time);
#else
            gmtime_r(&time, &utc);
#endif

            std::wstringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
        }

        NexusModsAuthStatus buildStatus(const OAuthConfig& config, const NexusModsStoredAuth& auth)
        {
            NexusModsAuthStatus status;
            status.isConfigured = !config.clientId.empty();
            status.hasApiKey = auth.linked && !auth.protectedApiKey.empty();
            const bool hasOAuthToken = auth.linked && !auth.protectedAccessToken.empty();
            status.isLinked = status.hasApiKey || hasOAuthToken;
            status.displayName = status.isLinked ? auth.username : L"";
            status.userId = status.isLinked ? auth.userId : L"";
            status.clientId = config.clientId;
            status.redirectUri = config.redirectUri;

            if (status.isLinked)
            {
                status.message = status.displayName.empty()
                    ? L"NexusMods привязан."
                    : L"NexusMods привязан: " + status.displayName;
            }
            else if (!status.isConfigured)
            {
                status.message = L"Нужен зарегистрированный NexusMods OAuth client_id: задайте FLUXORA_NEXUS_CLIENT_ID.";
            }
            else
            {
                status.message = L"NexusMods не привязан.";
            }

            return status;
        }
    }

#ifdef FLUXORA_NEXUS_AUTH_SERVICE_TEST_HOOKS
    namespace test_hooks
    {
        std::string buildNexusTokenRequestBodyForTest(
            const std::wstring& clientId,
            const std::wstring& clientSecret,
            const std::wstring& redirectUri,
            const std::string& code,
            const std::wstring& codeVerifier)
        {
            OAuthConfig config;
            config.clientId = clientId;
            config.clientSecret = clientSecret;
            return buildTokenRequestBody(config, redirectUri, code, codeVerifier);
        }

        std::string buildNexusAuthorizeUrlForTest(
            const std::wstring& clientId,
            const std::wstring& clientSecret,
            const std::wstring& redirectUri,
            const std::wstring& state,
            const std::wstring& codeChallenge)
        {
            OAuthConfig config;
            config.clientId = clientId;
            config.clientSecret = clientSecret;
            return toUtf8(buildAuthorizeUrl(config, redirectUri, state, codeChallenge));
        }

        std::wstring defaultNexusRedirectUriForTest()
        {
            return std::wstring(defaultRedirectUri);
        }

        std::wstring nexusClientIdNameForTest()
        {
            return std::wstring(nexusClientIdName);
        }

        std::wstring nexusRedirectUriNameForTest()
        {
            return std::wstring(nexusRedirectUriName);
        }

        std::wstring nexusClientSecretNameForTest()
        {
            return std::wstring(nexusClientSecretName);
        }

        std::wstring resolvedNexusClientIdForTest()
        {
            return resolveNexusClientId(false);
        }

        std::wstring resolvedNexusRedirectUriForTest()
        {
            return resolveNexusRedirectUri(false);
        }

        std::wstring extractSupabaseCredentialValueForTest(const std::wstring& json)
        {
            return extractSupabaseCredentialValue(JsonReader::parse(json));
        }

        std::wstring resolvedNexusClientSecretForTest()
        {
            return resolveNexusClientSecret();
        }
    }
#endif

    NexusModsAuthService::NexusModsAuthService(Logger& logger, AppSettingsService& settings) noexcept
        : logger_(logger),
          settings_(settings)
    {
    }

    void NexusModsAuthService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        initialized_ = true;
        logger_.write(LogLevel::Info, "NexusMods auth service initialized.");
    }

    void NexusModsAuthService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        initialized_ = false;
        logger_.write(LogLevel::Info, "NexusMods auth service shut down.");
    }

    NexusModsAuthStatus NexusModsAuthService::status() const
    {
        return buildStatus(loadConfig(), settings_.loadNexusModsAuth());
    }

    NexusModsAuthStatus NexusModsAuthService::connect()
    {
        const OAuthConfig config = loadConfig(true);
        if (config.clientId.empty())
        {
            throw std::invalid_argument("NexusMods OAuth client_id is missing. Set FLUXORA_NEXUS_CLIENT_ID.");
        }

        OAuthCallbackListener callbackListener(parseRedirectUri(config.redirectUri));
        const std::wstring redirectUri = callbackListener.redirectUri();
        const std::wstring state = generateHexRandom(16);
        const std::wstring codeVerifier = generateHexRandom(48);
        const std::wstring codeChallenge = base64UrlEncode(sha256(toUtf8(codeVerifier)));
        const std::wstring authorizeUrl = buildAuthorizeUrl(config, redirectUri, state, codeChallenge);

        logger_.write(
            LogLevel::Info,
            "NexusMods OAuth configuration: client_id=" + toUtf8(config.clientId) +
                ", redirect_uri=" + toUtf8(redirectUri) +
                ", mode=" + (config.clientSecret.empty() ? "public-pkce" : "confidential") + ".");
        logger_.write(LogLevel::Info, "Opening NexusMods OAuth authorization URL.");
        openSystemBrowser(authorizeUrl);

        try
        {
            const CallbackResult callback = callbackListener.waitForRequest();
            if (!callback.error.empty())
            {
                throw std::runtime_error(callback.errorDescription.empty()
                    ? "NexusMods authorization was denied."
                    : callback.errorDescription);
            }

            if (callback.code.empty())
            {
                throw std::runtime_error("NexusMods OAuth callback did not include an authorization code.");
            }

            if (callback.state != toUtf8(state))
            {
                throw std::runtime_error("NexusMods OAuth state validation failed.");
            }

            const std::string tokenResponseBody = postTokenRequest(
                buildTokenRequestBody(config, redirectUri, callback.code, codeVerifier));
            const TokenResponse tokens = parseTokenResponse(tokenResponseBody);
            const JwtUser user = parseJwtUser(tokens.accessToken);

            NexusModsStoredAuth stored;
            stored.linked = true;
            stored.username = user.username;
            stored.userId = user.userId;
            stored.tokenType = tokens.tokenType.empty() ? L"Bearer" : tokens.tokenType;
            stored.expiresAtUtc = formatUtcExpiry(tokens.expiresInSeconds);
            stored.protectedAccessToken = protectSecret(tokens.accessToken);
            stored.protectedRefreshToken = tokens.refreshToken.empty()
                ? L""
                : protectSecret(tokens.refreshToken);
            settings_.saveNexusModsAuth(stored);
            callbackListener.respondSuccess();

            OAuthConfig statusConfig = config;
            statusConfig.redirectUri = redirectUri;
            logger_.write(LogLevel::Info, "NexusMods account linked.");
            return buildStatus(statusConfig, stored);
        }
        catch (...)
        {
            callbackListener.respondFailure("Fluxora could not finish the NexusMods OAuth login. Return to Fluxora for details.");
            throw;
        }
    }

    NexusModsAuthStatus NexusModsAuthService::connectWithApiKey(std::wstring_view apiKey)
    {
        const std::wstring trimmedApiKey = trimWhitespace(std::wstring(apiKey));
        const ApiKeyUser user = validateNexusApiKey(trimmedApiKey);

        NexusModsStoredAuth stored = settings_.loadNexusModsAuth();
        stored.linked = true;
        if (!user.username.empty())
        {
            stored.username = user.username;
        }
        if (!user.userId.empty())
        {
            stored.userId = user.userId;
        }
        stored.protectedApiKey = protectSecret(trimmedApiKey);
        settings_.saveNexusModsAuth(stored);

        logger_.write(LogLevel::Info, "NexusMods API key linked.");
        return buildStatus(loadConfig(), stored);
    }

    NexusModsAuthStatus NexusModsAuthService::disconnect()
    {
        settings_.clearNexusModsAuth();
        logger_.write(LogLevel::Info, "NexusMods account unlinked.");
        return status();
    }

    bool NexusModsAuthService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
