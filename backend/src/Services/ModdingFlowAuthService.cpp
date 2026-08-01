#include "FluxoraCore/Services/ModdingFlowAuthService.hpp"

#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/SecureCredentialStore.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <condition_variable>
#include <cstdint>
#include <iomanip>
#include <limits>
#include <mutex>
#include <optional>
#include <sstream>
#include <utility>

#ifdef _WIN32
#include <Windows.h>
#include <bcrypt.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::chrono::minutes connectLifetime{5};
        constexpr std::chrono::seconds refreshLeadTime{120};
        constexpr std::chrono::seconds oauthRequestTimeout{15};
        constexpr std::chrono::seconds singleflightWaitTimeout{16};

        std::string sanitizeOAuthDiagnosticToken(
            std::string value,
            std::size_t maximumLength)
        {
            if (value.empty() || value.size() > maximumLength ||
                !std::all_of(value.begin(), value.end(), [](unsigned char character)
                {
                    return std::isalnum(character) != 0 || character == '-' ||
                        character == '_' || character == '.' || character == ':';
                }))
            {
                return {};
            }
            return value;
        }

        std::string_view oauthFailureCategory(ModdingFlowOAuthFailureKind kind) noexcept
        {
            switch (kind)
            {
            case ModdingFlowOAuthFailureKind::RequestNotSent:
                return "requestNotSent";
            case ModdingFlowOAuthFailureKind::Ambiguous:
                return "ambiguous";
            case ModdingFlowOAuthFailureKind::InvalidGrant:
                return "invalidGrant";
            case ModdingFlowOAuthFailureKind::Temporary:
                return "temporary";
            case ModdingFlowOAuthFailureKind::Protocol:
                return "protocol";
            case ModdingFlowOAuthFailureKind::Security:
                return "security";
            }
            return "unknown";
        }

        std::string oauthFailureLogSuffix(
            const std::optional<ModdingFlowOAuthFailureKind>& kind,
            const ModdingFlowOAuthFailureMetadata& metadata)
        {
            std::string suffix = " category=";
            suffix += kind ? oauthFailureCategory(*kind) : "unknown";
            if (!metadata.machineCode.empty())
            {
                suffix += " machineCode=" + metadata.machineCode;
            }
            if (!metadata.requestId.empty())
            {
                suffix += " requestId=" + metadata.requestId;
            }
            if (!metadata.traceId.empty())
            {
                suffix += " traceId=" + metadata.traceId;
            }
            return suffix;
        }

        class ScopedOperationContext final
        {
        public:
            explicit ScopedOperationContext(std::wstring_view operationId)
            {
                if (!operationId.empty() && Logger::operationId().empty())
                {
                    Logger::setOperationId(operationId);
                    ownsContext_ = true;
                }
            }

            ScopedOperationContext(const ScopedOperationContext&) = delete;
            ScopedOperationContext& operator=(const ScopedOperationContext&) = delete;

            ~ScopedOperationContext()
            {
                if (ownsContext_)
                {
                    Logger::clearOperationId();
                }
            }

        private:
            bool ownsContext_{false};
        };

        std::vector<unsigned char> secureRandomBytes(std::size_t count)
        {
#ifdef _WIN32
            std::vector<unsigned char> bytes(count);
            if (count > static_cast<std::size_t>((std::numeric_limits<ULONG>::max)()) ||
                BCryptGenRandom(
                    nullptr,
                    bytes.data(),
                    static_cast<ULONG>(bytes.size()),
                    BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0)
            {
                throw std::runtime_error("Failed to generate ModdingFlow OAuth entropy.");
            }
            return bytes;
#else
            (void)count;
            throw std::runtime_error("ModdingFlow OAuth entropy is unavailable on this platform.");
#endif
        }

        std::vector<unsigned char> sha256(std::string_view value)
        {
#ifdef _WIN32
            BCRYPT_ALG_HANDLE algorithm = nullptr;
            BCRYPT_HASH_HANDLE hash = nullptr;
            if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0)
            {
                throw std::runtime_error("Failed to open the SHA-256 provider.");
            }

            DWORD objectLength = 0;
            DWORD digestLength = 0;
            DWORD resultLength = 0;
            const auto closeAlgorithm = [&]
            {
                if (algorithm != nullptr)
                {
                    BCryptCloseAlgorithmProvider(algorithm, 0);
                }
            };
            if (BCryptGetProperty(
                    algorithm,
                    BCRYPT_OBJECT_LENGTH,
                    reinterpret_cast<PUCHAR>(&objectLength),
                    sizeof(objectLength),
                    &resultLength,
                    0) < 0 ||
                BCryptGetProperty(
                    algorithm,
                    BCRYPT_HASH_LENGTH,
                    reinterpret_cast<PUCHAR>(&digestLength),
                    sizeof(digestLength),
                    &resultLength,
                    0) < 0)
            {
                closeAlgorithm();
                throw std::runtime_error("Failed to query the SHA-256 provider.");
            }

            std::vector<unsigned char> objectBuffer(objectLength);
            std::vector<unsigned char> digest(digestLength);
            if (BCryptCreateHash(
                    algorithm,
                    &hash,
                    objectBuffer.data(),
                    static_cast<ULONG>(objectBuffer.size()),
                    nullptr,
                    0,
                    0) < 0)
            {
                closeAlgorithm();
                throw std::runtime_error("Failed to create a SHA-256 hash.");
            }

            const NTSTATUS hashStatus =
                value.size() > static_cast<std::size_t>((std::numeric_limits<ULONG>::max)())
                ? static_cast<NTSTATUS>(-1)
                : BCryptHashData(
                    hash,
                    reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
                    static_cast<ULONG>(value.size()),
                    0);
            const NTSTATUS finishStatus = hashStatus < 0
                ? hashStatus
                : BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0);
            BCryptDestroyHash(hash);
            closeAlgorithm();
            if (hashStatus < 0 || finishStatus < 0)
            {
                throw std::runtime_error("Failed to compute a SHA-256 hash.");
            }
            return digest;
#else
            (void)value;
            throw std::runtime_error("SHA-256 is unavailable on this platform.");
#endif
        }

        std::string base64UrlEncode(const std::vector<unsigned char>& bytes)
        {
            static constexpr char alphabet[] =
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            std::string result;
            result.reserve((bytes.size() * 4 + 2) / 3);
            std::uint32_t accumulator = 0;
            int bits = 0;
            for (const unsigned char byte : bytes)
            {
                accumulator = (accumulator << 8) | byte;
                bits += 8;
                while (bits >= 6)
                {
                    bits -= 6;
                    result.push_back(alphabet[(accumulator >> bits) & 0x3FU]);
                }
            }
            if (bits > 0)
            {
                result.push_back(alphabet[(accumulator << (6 - bits)) & 0x3FU]);
            }
            return result;
        }

        std::string percentEncode(std::string_view value)
        {
            std::ostringstream encoded;
            encoded << std::uppercase << std::hex;
            for (const unsigned char character : value)
            {
                if ((character >= 'A' && character <= 'Z') ||
                    (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9') ||
                    character == '-' || character == '.' || character == '_' || character == '~')
                {
                    encoded << static_cast<char>(character);
                }
                else
                {
                    encoded << '%' << std::setw(2) << std::setfill('0') << static_cast<unsigned int>(character);
                }
            }
            return encoded.str();
        }

        void wipe(std::string& value) noexcept
        {
#ifdef _WIN32
            if (!value.empty())
            {
                SecureZeroMemory(value.data(), value.size());
            }
#else
            std::fill(value.begin(), value.end(), '\0');
#endif
            value.clear();
        }

        bool constantTimeEqual(std::string_view left, std::string_view right) noexcept
        {
            const std::size_t length = (std::max)(left.size(), right.size());
            std::size_t difference = left.size() ^ right.size();
            for (std::size_t index = 0; index < length; ++index)
            {
                const unsigned char leftByte = index < left.size()
                    ? static_cast<unsigned char>(left[index])
                    : 0;
                const unsigned char rightByte = index < right.size()
                    ? static_cast<unsigned char>(right[index])
                    : 0;
                difference |= static_cast<std::size_t>(leftByte ^ rightByte);
            }
            return difference == 0;
        }

        std::vector<std::string> splitScopes(std::string_view value)
        {
            std::vector<std::string> scopes;
            std::size_t start = 0;
            while (start < value.size())
            {
                const std::size_t end = value.find(' ', start);
                scopes.emplace_back(value.substr(start, end - start));
                if (end == std::string_view::npos)
                {
                    break;
                }
                start = end + 1;
            }
            return scopes;
        }

        bool hasExactScopes(
            const std::vector<std::string>& granted,
            std::string_view requiredScopeText)
        {
            std::vector<std::string> expected = splitScopes(requiredScopeText);
            std::vector<std::string> actual = granted;
            std::ranges::sort(expected);
            std::ranges::sort(actual);
            return actual == expected;
        }

        bool isBearer(std::string_view value) noexcept
        {
            constexpr std::string_view expected = "bearer";
            return value.size() == expected.size() &&
                std::equal(value.begin(), value.end(), expected.begin(), [](char left, char right)
                {
                    return std::tolower(static_cast<unsigned char>(left)) == right;
                });
        }

        bool hasValidIdTokenClaims(
            const ModdingFlowIdTokenClaims& claims,
            const ModdingFlowConfiguration& configuration,
            std::string_view expectedNonce,
            std::chrono::system_clock::time_point now) noexcept
        {
            constexpr std::chrono::seconds clockSkew{60};
            return claims.signatureValid &&
                claims.algorithm == "RS256" &&
                claims.issuer == configuration.issuer() &&
                claims.audience.size() == 1 &&
                claims.audience.front() == configuration.clientId() &&
                !claims.subject.empty() &&
                constantTimeEqual(claims.nonce, expectedNonce) &&
                claims.issuedAt <= now + clockSkew &&
                claims.expiresAt > now - clockSkew &&
                claims.expiresAt > claims.issuedAt;
        }
    }

    struct ModdingFlowAuthService::State
    {
        struct Transaction
        {
            std::string id;
            std::string redirectUri;
            std::string state;
            std::string verifier;
            std::string nonce;
            std::chrono::system_clock::time_point expiresAt;

            void clear() noexcept
            {
                wipe(id);
                wipe(redirectUri);
                wipe(state);
                wipe(verifier);
                wipe(nonce);
            }

            ~Transaction() { clear(); }
        };

        State(
            Logger& loggerValue,
            ModdingFlowConfiguration configurationValue,
            ISecureCredentialStore& credentialsValue,
            IModdingFlowOAuthClient& oauthClientValue,
            IModdingFlowIdTokenVerifier& idTokenVerifierValue,
            ModdingFlowAuthServiceOptions optionsValue)
            : logger(loggerValue),
              configuration(std::move(configurationValue)),
              credentials(credentialsValue),
              oauthClient(oauthClientValue),
              idTokenVerifier(idTokenVerifierValue),
              options(std::move(optionsValue))
        {
            if (!options.clock)
            {
                options.clock = [] { return std::chrono::system_clock::now(); };
            }
            if (!options.entropy)
            {
                options.entropy = secureRandomBytes;
            }
        }

        std::string randomToken(std::size_t byteCount)
        {
            std::vector<unsigned char> bytes = options.entropy(byteCount);
            if (bytes.size() != byteCount)
            {
                throw std::runtime_error("ModdingFlow OAuth entropy source returned an invalid byte count.");
            }
            return base64UrlEncode(bytes);
        }

        void clearTransaction() noexcept
        {
            if (transaction)
            {
                transaction->clear();
                transaction.reset();
            }
        }

        void clearSession() noexcept
        {
            wipe(accessToken);
            wipe(accountId);
            accessTokenExpiresAt = {};
            grantedScopes.clear();
            profileValidationPending = false;
        }

        void setNotLinked() noexcept
        {
            clearSession();
            status = {};
            connectionInProgress = false;
        }

        void setTemporarilyUnavailable(bool hasCredential) noexcept
        {
            clearSession();
            status.state = ModdingFlowAuthState::TemporarilyUnavailable;
            status.accountName.clear();
            status.hasStoredSession = hasCredential;
            status.retryable = true;
            status.requiresUserAction = false;
            connectionInProgress = false;
        }

        void invalidateCredential() noexcept
        {
            clearSession();
            credentialSuppressed = true;
            try
            {
                credentials.remove(configuration.refreshCredentialTarget());
            }
            catch (...)
            {
                logger.writeOperation(
                    LogLevel::Error,
                    "ModdingFlowAuth",
                    "OAuth credential removal failed after an unsafe refresh outcome.");
            }
            status.state = ModdingFlowAuthState::ReauthRequired;
            status.accountName.clear();
            status.hasStoredSession = false;
            status.retryable = false;
            status.requiresUserAction = true;
            connectionInProgress = false;
        }

        ModdingFlowAuthStatus validatePendingProfile(
            std::unique_lock<std::mutex>& lock,
            std::wstring_view operationId,
            std::uint64_t profileEpoch)
        {
            enum class ProfileOutcome
            {
                Success,
                TemporaryFailure,
                UnsafeFailure
            };

            std::string profileAccessToken = accessToken;
            lock.unlock();
            ModdingFlowProfileRequest request{
                std::string(configuration.apiBaseUrl()),
                profileAccessToken,
                std::wstring(operationId)
            };
            ModdingFlowProfile profile;
            ProfileOutcome outcome = ProfileOutcome::Success;
            try
            {
                profile = oauthClient.fetchCurrentProfile(request);
            }
            catch (const ModdingFlowOAuthException& exception)
            {
                const ModdingFlowOAuthFailureKind kind = exception.kind();
                outcome = kind == ModdingFlowOAuthFailureKind::InvalidGrant ||
                    kind == ModdingFlowOAuthFailureKind::Protocol ||
                    kind == ModdingFlowOAuthFailureKind::Security
                    ? ProfileOutcome::UnsafeFailure
                    : ProfileOutcome::TemporaryFailure;
            }
            catch (...)
            {
                outcome = ProfileOutcome::TemporaryFailure;
            }
            wipe(request.accessToken);
            wipe(profileAccessToken);
            if (outcome == ProfileOutcome::Success && profile.userId.empty())
            {
                outcome = ProfileOutcome::UnsafeFailure;
            }

            lock.lock();
            if (profileEpoch != authEpoch)
            {
                refreshInProgress = false;
                refreshCompleted.notify_all();
                return status;
            }

            switch (outcome)
            {
            case ProfileOutcome::Success:
                accountId = std::move(profile.userId);
                profileValidationPending = false;
                status.state = ModdingFlowAuthState::Ready;
                status.accountName = profile.displayName.empty()
                    ? L"ModdingFlow account"
                    : std::move(profile.displayName);
                status.hasStoredSession = true;
                status.retryable = false;
                status.requiresUserAction = false;
                logger.writeOperation(
                    LogLevel::Info,
                    "ModdingFlowAuth",
                    operationId.empty()
                        ? "OAuth session profile validated."
                        : "OAuth session profile validated with an operation context.");
                break;
            case ProfileOutcome::TemporaryFailure:
                profileValidationPending = true;
                status.state = ModdingFlowAuthState::TemporarilyUnavailable;
                status.accountName.clear();
                status.hasStoredSession = true;
                status.retryable = true;
                status.requiresUserAction = false;
                logger.writeOperation(
                    LogLevel::Warning,
                    "ModdingFlowAuth",
                    "OAuth profile validation failed temporarily; rotated credential retained.");
                break;
            case ProfileOutcome::UnsafeFailure:
                invalidateCredential();
                logger.writeOperation(
                    LogLevel::Warning,
                    "ModdingFlowAuth",
                    "OAuth profile contract requires account reconnection.");
                break;
            }
            refreshInProgress = false;
            refreshCompleted.notify_all();
            return status;
        }

        ModdingFlowAuthStatus refreshStoredSession(
            std::unique_lock<std::mutex>& lock,
            std::wstring_view operationId,
            bool forceRefresh)
        {
            const auto now = options.clock();
            if (!forceRefresh &&
                status.state == ModdingFlowAuthState::Ready &&
                !accessToken.empty() &&
                accessTokenExpiresAt > now + refreshLeadTime)
            {
                return status;
            }

            if (refreshInProgress)
            {
                if (!refreshCompleted.wait_for(lock, singleflightWaitTimeout, [&]
                {
                    return !refreshInProgress;
                }))
                {
                    ModdingFlowAuthStatus timedOut = status;
                    timedOut.state = ModdingFlowAuthState::TemporarilyUnavailable;
                    timedOut.retryable = true;
                    timedOut.requiresUserAction = false;
                    logger.writeOperation(
                        LogLevel::Warning,
                        "ModdingFlowAuth",
                        "OAuth refresh singleflight wait reached its bounded timeout.");
                    return timedOut;
                }
                return status;
            }

            if (credentialSuppressed)
            {
                status.state = ModdingFlowAuthState::ReauthRequired;
                status.hasStoredSession = false;
                status.retryable = false;
                status.requiresUserAction = true;
                return status;
            }

            if (profileValidationPending && !accessToken.empty() && accessTokenExpiresAt > now)
            {
                refreshInProgress = true;
                status.state = ModdingFlowAuthState::Restoring;
                status.retryable = false;
                status.requiresUserAction = false;
                const std::uint64_t profileEpoch = authEpoch;
                return validatePendingProfile(lock, operationId, profileEpoch);
            }
            if (profileValidationPending)
            {
                clearSession();
            }

            enum class RefreshOutcome
            {
                Success,
                NoCredential,
                CredentialReadFailed,
                SafeTemporaryFailure,
                UnsafeFailure
            };

            const bool previouslyHadStoredSession = status.hasStoredSession;
            const std::uint64_t refreshEpoch = authEpoch;
            refreshInProgress = true;
            status.state = ModdingFlowAuthState::Restoring;
            status.retryable = false;
            status.requiresUserAction = false;
            lock.unlock();

            RefreshOutcome outcome = RefreshOutcome::Success;
            std::optional<ModdingFlowOAuthFailureKind> refreshFailureKind;
            ModdingFlowOAuthFailureMetadata refreshFailureMetadata;
            std::optional<std::string> storedRefresh;
            try
            {
                storedRefresh = credentials.read(configuration.refreshCredentialTarget());
            }
            catch (...)
            {
                outcome = RefreshOutcome::CredentialReadFailed;
            }
            if (outcome == RefreshOutcome::Success &&
                (!storedRefresh || storedRefresh->empty()))
            {
                outcome = RefreshOutcome::NoCredential;
            }

            ModdingFlowTokenSet tokens;
            if (outcome == RefreshOutcome::Success)
            {
                ModdingFlowRefreshRequest request{
                    std::string(configuration.tokenEndpoint()),
                    std::string(configuration.clientId()),
                    *storedRefresh,
                    std::wstring(operationId)
                };
                try
                {
                    tokens = oauthClient.refreshAccessToken(request);
                }
                catch (const ModdingFlowOAuthException& exception)
                {
                    const ModdingFlowOAuthFailureKind kind = exception.kind();
                    refreshFailureKind = kind;
                    refreshFailureMetadata = exception.metadata();
                    outcome = kind == ModdingFlowOAuthFailureKind::RequestNotSent ||
                        kind == ModdingFlowOAuthFailureKind::Temporary
                        ? RefreshOutcome::SafeTemporaryFailure
                        : RefreshOutcome::UnsafeFailure;
                }
                catch (...)
                {
                    refreshFailureKind = ModdingFlowOAuthFailureKind::Protocol;
                    outcome = RefreshOutcome::UnsafeFailure;
                }
                wipe(request.refreshToken);
            }
            if (storedRefresh)
            {
                wipe(*storedRefresh);
            }
            wipe(tokens.idToken);

            if (outcome == RefreshOutcome::Success &&
                (tokens.accessToken.empty() || tokens.refreshToken.empty() ||
                !isBearer(tokens.tokenType) || tokens.expiresIn <= std::chrono::seconds::zero() ||
                !hasExactScopes(tokens.grantedScopes, configuration.scope())))
            {
                refreshFailureKind = ModdingFlowOAuthFailureKind::Protocol;
                outcome = RefreshOutcome::UnsafeFailure;
            }

            lock.lock();
            if (refreshEpoch != authEpoch)
            {
                refreshInProgress = false;
                refreshCompleted.notify_all();
                lock.unlock();
                const auto revokeSupersededToken = [&](std::string& token, std::string_view hint)
                {
                    if (token.empty())
                    {
                        return;
                    }
                    ModdingFlowRevokeRequest request{
                        std::string(configuration.revocationEndpoint()),
                        std::string(configuration.clientId()),
                        token,
                        std::string(hint),
                        std::wstring(operationId)
                    };
                    try
                    {
                        oauthClient.revokeToken(request);
                    }
                    catch (...)
                    {
                        logger.writeOperation(
                            LogLevel::Warning,
                            "ModdingFlowAuth",
                            "Superseded OAuth refresh could not revoke an uncommitted token.");
                    }
                    wipe(request.token);
                    wipe(token);
                };
                revokeSupersededToken(tokens.refreshToken, "refresh_token");
                revokeSupersededToken(tokens.accessToken, "access_token");
                lock.lock();
                return status;
            }

            bool validateRotatedProfile = false;
            switch (outcome)
            {
            case RefreshOutcome::NoCredential:
                setNotLinked();
                break;
            case RefreshOutcome::CredentialReadFailed:
                setTemporarilyUnavailable(previouslyHadStoredSession);
                logger.writeOperation(
                    LogLevel::Warning,
                    "ModdingFlowAuth",
                    "OAuth credential lookup failed temporarily.");
                break;
            case RefreshOutcome::SafeTemporaryFailure:
                setTemporarilyUnavailable(true);
                logger.writeOperation(
                    LogLevel::Warning,
                    "ModdingFlowAuth",
                    "OAuth refresh failed before a safe response was available." +
                        oauthFailureLogSuffix(
                            refreshFailureKind,
                            refreshFailureMetadata));
                break;
            case RefreshOutcome::UnsafeFailure:
                wipe(tokens.accessToken);
                wipe(tokens.refreshToken);
                invalidateCredential();
                logger.writeOperation(
                    LogLevel::Warning,
                    "ModdingFlowAuth",
                    "OAuth refresh requires account reconnection." +
                        oauthFailureLogSuffix(
                            refreshFailureKind,
                            refreshFailureMetadata));
                break;
            case RefreshOutcome::Success:
                try
                {
                    credentials.writeAtomic(configuration.refreshCredentialTarget(), tokens.refreshToken);
                }
                catch (...)
                {
                    wipe(tokens.accessToken);
                    wipe(tokens.refreshToken);
                    invalidateCredential();
                    logger.writeOperation(
                        LogLevel::Error,
                        "ModdingFlowAuth",
                        "OAuth refresh rotation could not be committed securely.");
                    break;
                }
                wipe(tokens.refreshToken);
                clearSession();
                accessToken = std::move(tokens.accessToken);
                accessTokenExpiresAt = now + tokens.expiresIn;
                grantedScopes = std::move(tokens.grantedScopes);
                credentialSuppressed = false;
                profileValidationPending = true;
                status.state = ModdingFlowAuthState::Restoring;
                status.accountName.clear();
                status.hasStoredSession = true;
                status.retryable = false;
                status.requiresUserAction = false;
                connectionInProgress = false;
                logger.writeOperation(
                    LogLevel::Info,
                    "ModdingFlowAuth",
                    "OAuth refresh rotation committed; validating scoped profile.");
                validateRotatedProfile = true;
                break;
            }
            if (validateRotatedProfile)
            {
                return validatePendingProfile(lock, operationId, refreshEpoch);
            }
            refreshInProgress = false;
            refreshCompleted.notify_all();
            return status;
        }

        Logger& logger;
        ModdingFlowConfiguration configuration;
        ISecureCredentialStore& credentials;
        IModdingFlowOAuthClient& oauthClient;
        IModdingFlowIdTokenVerifier& idTokenVerifier;
        ModdingFlowAuthServiceOptions options;
        mutable std::mutex mutex;
        std::condition_variable refreshCompleted;
        std::optional<Transaction> transaction;
        ModdingFlowAuthStatus status;
        std::string accessToken;
        std::string accountId;
        std::chrono::system_clock::time_point accessTokenExpiresAt;
        std::vector<std::string> grantedScopes;
        bool connectionInProgress{false};
        bool refreshInProgress{false};
        bool credentialSuppressed{false};
        bool profileValidationPending{false};
        std::uint64_t authEpoch{0};
        bool initialized{false};
    };

    ModdingFlowAuthException::ModdingFlowAuthException(
        ModdingFlowAuthErrorCode code,
        std::string message)
        : std::runtime_error(std::move(message)), code_(code)
    {
    }

    ModdingFlowAuthErrorCode ModdingFlowAuthException::code() const noexcept { return code_; }

    ModdingFlowOAuthException::ModdingFlowOAuthException(
        ModdingFlowOAuthFailureKind kind,
        std::string message,
        ModdingFlowOAuthFailureMetadata metadata)
        : std::runtime_error(std::move(message)),
          kind_(kind),
          metadata_{
              sanitizeOAuthDiagnosticToken(std::move(metadata.machineCode), 96U),
              sanitizeOAuthDiagnosticToken(std::move(metadata.requestId), 128U),
              sanitizeOAuthDiagnosticToken(std::move(metadata.traceId), 128U)}
    {
    }

    ModdingFlowOAuthFailureKind ModdingFlowOAuthException::kind() const noexcept { return kind_; }

    const ModdingFlowOAuthFailureMetadata&
        ModdingFlowOAuthException::metadata() const noexcept
    {
        return metadata_;
    }

    ModdingFlowAuthService::ModdingFlowAuthService(
        Logger& logger,
        ModdingFlowConfiguration configuration,
        ISecureCredentialStore& credentials,
        IModdingFlowOAuthClient& oauthClient,
        IModdingFlowIdTokenVerifier& idTokenVerifier,
        ModdingFlowAuthServiceOptions options)
        : state_(std::make_unique<State>(
            logger,
            std::move(configuration),
            credentials,
            oauthClient,
            idTokenVerifier,
            std::move(options)))
    {
    }

    ModdingFlowAuthService::~ModdingFlowAuthService()
    {
        shutdown();
    }

    void ModdingFlowAuthService::initialize()
    {
        std::lock_guard lock(state_->mutex);
        state_->initialized = true;
        state_->logger.writeOperation(
            LogLevel::Info,
            "ModdingFlowAuth",
            "OAuth service initialized.");
    }

    void ModdingFlowAuthService::shutdown()
    {
        if (!state_)
        {
            return;
        }
        std::lock_guard lock(state_->mutex);
        ++state_->authEpoch;
        state_->clearTransaction();
        state_->clearSession();
        state_->status = {};
        state_->connectionInProgress = false;
        state_->initialized = false;
    }

    void ModdingFlowAuthService::discoverStoredSessionForRestore(
        std::wstring_view operationId) noexcept
    {
        const ScopedOperationContext operationContext(operationId);
        std::unique_lock lock(state_->mutex);
        if (!state_->initialized)
        {
            return;
        }
        const std::uint64_t discoveryEpoch = state_->authEpoch;
        lock.unlock();

        std::optional<std::string> stored;
        bool readFailed = false;
        try
        {
            stored = state_->credentials.read(state_->configuration.refreshCredentialTarget());
        }
        catch (...)
        {
            readFailed = true;
        }
        const bool available = stored && !stored->empty();
        if (stored)
        {
            wipe(*stored);
        }

        lock.lock();
        if (!state_->initialized || discoveryEpoch != state_->authEpoch)
        {
            return;
        }
        if (readFailed)
        {
            state_->setTemporarilyUnavailable(true);
        }
        else if (available)
        {
            state_->status.state = ModdingFlowAuthState::Restoring;
            state_->status.accountName.clear();
            state_->status.hasStoredSession = true;
            state_->status.retryable = false;
            state_->status.requiresUserAction = false;
        }
        else
        {
            state_->setNotLinked();
        }
    }

    ModdingFlowConnectStart ModdingFlowAuthService::beginConnect(
        std::string_view redirectUri,
        std::wstring_view operationId)
    {
        const ScopedOperationContext operationContext(operationId);
        state_->configuration.validateRedirectUri(redirectUri);
        std::lock_guard lock(state_->mutex);
        if (!state_->initialized)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::NotInitialized,
                "ModdingFlow OAuth service is not initialized.");
        }

        const auto now = state_->options.clock();
        if (state_->connectionInProgress || state_->refreshInProgress)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::AlreadyInProgress,
                "A ModdingFlow connection is already in progress.");
        }
        state_->clearTransaction();

        State::Transaction transaction;
        transaction.id = state_->randomToken(16);
        transaction.state = state_->randomToken(32);
        transaction.verifier = state_->randomToken(32);
        transaction.nonce = state_->randomToken(32);
        transaction.redirectUri = redirectUri;
        transaction.expiresAt = now + connectLifetime;
        const std::string challenge = base64UrlEncode(sha256(transaction.verifier));

        std::string authorizationUrl(state_->configuration.authorizationEndpoint());
        authorizationUrl += "?response_type=code";
        authorizationUrl += "&client_id=" + percentEncode(state_->configuration.clientId());
        authorizationUrl += "&redirect_uri=" + percentEncode(transaction.redirectUri);
        authorizationUrl += "&scope=" + percentEncode(state_->configuration.scope());
        authorizationUrl += "&state=" + percentEncode(transaction.state);
        authorizationUrl += "&nonce=" + percentEncode(transaction.nonce);
        authorizationUrl += "&code_challenge=" + percentEncode(challenge);
        authorizationUrl += "&code_challenge_method=S256";

        ModdingFlowConnectStart result{
            transaction.id,
            std::move(authorizationUrl),
            transaction.expiresAt
        };
        state_->transaction.emplace(std::move(transaction));
        state_->connectionInProgress = true;
        state_->status.state = ModdingFlowAuthState::Connecting;
        state_->status.retryable = false;
        state_->status.requiresUserAction = false;
        state_->logger.writeOperation(
            LogLevel::Info,
            "ModdingFlowAuth",
            operationId.empty()
                ? "OAuth connect transaction started."
                : "OAuth connect transaction started with an operation context.");
        return result;
    }

    ModdingFlowAuthStatus ModdingFlowAuthService::completeConnect(
        std::string_view transactionId,
        ModdingFlowConnectCompletion completion,
        std::wstring_view operationId)
    {
        const ScopedOperationContext operationContext(operationId);
        State::Transaction transaction;
        std::uint64_t completionEpoch = 0;
        {
            std::lock_guard lock(state_->mutex);
            if (!state_->initialized)
            {
                throw ModdingFlowAuthException(
                    ModdingFlowAuthErrorCode::NotInitialized,
                    "ModdingFlow OAuth service is not initialized.");
            }
            if (!state_->transaction ||
                !constantTimeEqual(transactionId, state_->transaction->id))
            {
                throw ModdingFlowAuthException(
                    ModdingFlowAuthErrorCode::InvalidTransaction,
                    "ModdingFlow OAuth transaction is invalid.");
            }
            transaction = *state_->transaction;
            state_->clearTransaction();
            completionEpoch = state_->authEpoch;
        }

        const auto fail = [&](ModdingFlowAuthState authState, bool retryable, bool userAction)
        {
            std::lock_guard lock(state_->mutex);
            if (completionEpoch != state_->authEpoch)
            {
                return;
            }
            state_->clearSession();
            state_->connectionInProgress = false;
            state_->status.state = authState;
            state_->status.accountName.clear();
            state_->status.hasStoredSession = false;
            state_->status.retryable = retryable;
            state_->status.requiresUserAction = userAction;
        };

        const auto now = state_->options.clock();
        if (transaction.expiresAt <= now)
        {
            fail(ModdingFlowAuthState::NotLinked, false, true);
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::TransactionExpired,
                "ModdingFlow OAuth transaction expired.");
        }

        std::string callbackState;
        std::string callbackIssuer;
        std::string authorizationCode;
        if (auto* success = std::get_if<ModdingFlowAuthorizationSuccess>(&completion))
        {
            callbackState = std::move(success->state);
            callbackIssuer = std::move(success->issuer);
            authorizationCode = std::move(success->authorizationCode);
        }
        else
        {
            auto& error = std::get<ModdingFlowAuthorizationError>(completion);
            callbackState = std::move(error.state);
            callbackIssuer = std::move(error.issuer);
            wipe(error.oauthError);
            wipe(error.errorDescription);
        }

        if (!constantTimeEqual(callbackState, transaction.state) ||
            callbackIssuer != state_->configuration.issuer())
        {
            wipe(callbackState);
            wipe(callbackIssuer);
            wipe(authorizationCode);
            fail(ModdingFlowAuthState::NotLinked, false, true);
            state_->logger.writeOperation(
                LogLevel::Warning,
                "ModdingFlowAuth",
                "OAuth completion rejected by response binding validation.");
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::SecurityFailure,
                "ModdingFlow OAuth response binding validation failed.");
        }
        wipe(callbackState);
        wipe(callbackIssuer);

        if (std::holds_alternative<ModdingFlowAuthorizationError>(completion) ||
            authorizationCode.empty() || authorizationCode.size() > 8192)
        {
            wipe(authorizationCode);
            fail(ModdingFlowAuthState::NotLinked, false, true);
            state_->logger.writeOperation(
                LogLevel::Info,
                "ModdingFlowAuth",
                "OAuth completion did not contain an accepted authorization code.");
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::InvalidCallback,
                "ModdingFlow authorization was not completed.");
        }

        ModdingFlowAuthorizationCodeRequest exchangeRequest{
            std::string(state_->configuration.tokenEndpoint()),
            std::string(state_->configuration.clientId()),
            transaction.redirectUri,
            std::move(authorizationCode),
            transaction.verifier,
            std::wstring(operationId)
        };

        ModdingFlowTokenSet tokens;
        try
        {
            tokens = state_->oauthClient.exchangeAuthorizationCode(exchangeRequest);
        }
        catch (...)
        {
            wipe(exchangeRequest.authorizationCode);
            wipe(exchangeRequest.codeVerifier);
            fail(ModdingFlowAuthState::NotLinked, false, true);
            state_->logger.writeOperation(
                LogLevel::Warning,
                "ModdingFlowAuth",
                "OAuth authorization-code exchange failed.");
            throw;
        }
        wipe(exchangeRequest.authorizationCode);
        wipe(exchangeRequest.codeVerifier);

        if (tokens.accessToken.empty() || tokens.refreshToken.empty() || tokens.idToken.empty() ||
            !isBearer(tokens.tokenType) || tokens.expiresIn <= std::chrono::seconds::zero() ||
            !hasExactScopes(tokens.grantedScopes, state_->configuration.scope()))
        {
            wipe(tokens.accessToken);
            wipe(tokens.refreshToken);
            wipe(tokens.idToken);
            fail(ModdingFlowAuthState::NotLinked, false, true);
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::MissingScope,
                "ModdingFlow OAuth token response failed validation.");
        }

        ModdingFlowIdTokenVerificationRequest verificationRequest{
            tokens.idToken,
            std::string(state_->configuration.jwksUri()),
            true,
            ModdingFlowHttpPolicy{},
            std::wstring(operationId)
        };
        ModdingFlowIdTokenClaims claims;
        try
        {
            claims = state_->idTokenVerifier.verifySignatureAndDecode(verificationRequest);
        }
        catch (...)
        {
            wipe(verificationRequest.idToken);
            wipe(tokens.accessToken);
            wipe(tokens.refreshToken);
            wipe(tokens.idToken);
            fail(ModdingFlowAuthState::NotLinked, false, true);
            state_->logger.writeOperation(
                LogLevel::Warning,
                "ModdingFlowAuth",
                "OIDC ID token verification failed.");
            throw;
        }
        wipe(verificationRequest.idToken);
        wipe(tokens.idToken);
        if (!hasValidIdTokenClaims(claims, state_->configuration, transaction.nonce, now))
        {
            wipe(claims.nonce);
            wipe(tokens.accessToken);
            wipe(tokens.refreshToken);
            fail(ModdingFlowAuthState::NotLinked, false, true);
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::SecurityFailure,
                "ModdingFlow OIDC identity validation failed.");
        }
        wipe(claims.nonce);

        ModdingFlowProfileRequest profileRequest{
            std::string(state_->configuration.apiBaseUrl()),
            tokens.accessToken,
            std::wstring(operationId)
        };
        ModdingFlowProfile profile;
        try
        {
            profile = state_->oauthClient.fetchCurrentProfile(profileRequest);
        }
        catch (...)
        {
            wipe(profileRequest.accessToken);
            wipe(tokens.accessToken);
            wipe(tokens.refreshToken);
            fail(ModdingFlowAuthState::NotLinked, false, true);
            state_->logger.writeOperation(
                LogLevel::Warning,
                "ModdingFlowAuth",
                "OAuth profile validation failed.");
            throw;
        }
        wipe(profileRequest.accessToken);
        if (profile.userId.empty() || !constantTimeEqual(profile.userId, claims.subject))
        {
            wipe(tokens.accessToken);
            wipe(tokens.refreshToken);
            fail(ModdingFlowAuthState::NotLinked, false, true);
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::SecurityFailure,
                "ModdingFlow profile identity does not match the OIDC subject.");
        }

        const auto revokeUncommittedTokens = [&]
        {
            const auto revoke = [&](std::string& token, std::string_view hint)
            {
                if (token.empty())
                {
                    return;
                }
                ModdingFlowRevokeRequest request{
                    std::string(state_->configuration.revocationEndpoint()),
                    std::string(state_->configuration.clientId()),
                    token,
                    std::string(hint),
                    std::wstring(operationId)
                };
                try
                {
                    state_->oauthClient.revokeToken(request);
                }
                catch (...)
                {
                    state_->logger.writeOperation(
                        LogLevel::Warning,
                        "ModdingFlowAuth",
                        "Superseded OAuth completion could not revoke an uncommitted token.");
                }
                wipe(request.token);
                wipe(token);
            };
            revoke(tokens.refreshToken, "refresh_token");
            revoke(tokens.accessToken, "access_token");
        };

        bool superseded = false;
        bool persistenceFailed = false;
        {
            std::lock_guard lock(state_->mutex);
            superseded = completionEpoch != state_->authEpoch;
            if (!superseded)
            {
                try
                {
                    state_->credentials.writeAtomic(
                        state_->configuration.refreshCredentialTarget(),
                        tokens.refreshToken);
                }
                catch (...)
                {
                    persistenceFailed = true;
                }
            }
            superseded = superseded || completionEpoch != state_->authEpoch;
            if (!superseded && !persistenceFailed)
            {
                wipe(tokens.refreshToken);
                state_->clearSession();
                state_->accessToken = std::move(tokens.accessToken);
                state_->accessTokenExpiresAt = now + tokens.expiresIn;
                state_->grantedScopes = std::move(tokens.grantedScopes);
                state_->accountId = std::move(profile.userId);
                state_->credentialSuppressed = false;
                state_->connectionInProgress = false;
                state_->status.state = ModdingFlowAuthState::Ready;
                state_->status.accountName = profile.displayName.empty()
                    ? L"ModdingFlow account"
                    : std::move(profile.displayName);
                state_->status.hasStoredSession = true;
                state_->status.retryable = false;
                state_->status.requiresUserAction = false;
            }
        }
        if (superseded)
        {
            revokeUncommittedTokens();
            state_->logger.writeOperation(
                LogLevel::Info,
                "ModdingFlowAuth",
                "OAuth completion was superseded before local credential commit.");
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::InvalidTransaction,
                "ModdingFlow OAuth completion was superseded.");
        }
        if (persistenceFailed)
        {
            wipe(tokens.accessToken);
            wipe(tokens.refreshToken);
            fail(ModdingFlowAuthState::TemporarilyUnavailable, true, false);
            state_->logger.writeOperation(
                LogLevel::Error,
                "ModdingFlowAuth",
                "OAuth credential persistence failed.");
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::TemporarilyUnavailable,
                "ModdingFlow credential persistence failed.");
        }
        state_->logger.writeOperation(
            LogLevel::Info,
            "ModdingFlowAuth",
            operationId.empty()
                ? "OAuth connection completed."
                : "OAuth connection completed with an operation context.");
        return status();
    }

    void ModdingFlowAuthService::cancelConnect(
        std::string_view transactionId,
        std::wstring_view operationId)
    {
        const ScopedOperationContext operationContext(operationId);
        std::unique_lock lock(state_->mutex);
        if (!state_->initialized)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::NotInitialized,
                "ModdingFlow OAuth service is not initialized.");
        }
        if (!state_->transaction ||
            !constantTimeEqual(transactionId, state_->transaction->id))
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::InvalidTransaction,
                "ModdingFlow OAuth transaction is invalid.");
        }

        state_->clearTransaction();
        state_->connectionInProgress = false;
        state_->status.state = ModdingFlowAuthState::NotLinked;
        state_->status.retryable = false;
        state_->status.requiresUserAction = false;
        state_->logger.writeOperation(
            LogLevel::Info,
            "ModdingFlowAuth",
            operationId.empty()
                ? "OAuth connect transaction cancelled."
                : "OAuth connect transaction cancelled with an operation context.");
    }

    ModdingFlowAuthStatus ModdingFlowAuthService::status() const
    {
        std::lock_guard lock(state_->mutex);
        if (state_->transaction && state_->transaction->expiresAt <= state_->options.clock())
        {
            state_->clearTransaction();
            state_->connectionInProgress = false;
            state_->status.state = ModdingFlowAuthState::NotLinked;
        }
        return state_->status;
    }

    std::string ModdingFlowAuthService::getAccessToken(
        std::string_view requiredScope,
        std::wstring_view operationId,
        bool forceRefresh)
    {
        const ScopedOperationContext operationContext(operationId);
        std::unique_lock lock(state_->mutex);
        if (!state_->initialized)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::NotInitialized,
                "ModdingFlow OAuth service is not initialized.");
        }

        const std::vector<std::string> allowedScopes = splitScopes(state_->configuration.scope());
        const bool scopeAllowed = !requiredScope.empty() &&
            std::ranges::find(allowedScopes, requiredScope) != allowedScopes.end();
        if (!scopeAllowed)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::MissingScope,
                "The ModdingFlow access token does not grant the required scope.");
        }

        const bool scopeGranted = std::ranges::find(state_->grantedScopes, requiredScope) !=
            state_->grantedScopes.end();
        if (!forceRefresh && scopeGranted &&
            state_->status.state == ModdingFlowAuthState::Ready &&
            !state_->accessToken.empty() &&
            state_->accessTokenExpiresAt > state_->options.clock() + refreshLeadTime)
        {
            return state_->accessToken;
        }

        const ModdingFlowAuthStatus refreshed = state_->refreshStoredSession(lock, operationId, true);
        const bool refreshedScopeGranted =
            std::ranges::find(state_->grantedScopes, requiredScope) != state_->grantedScopes.end();
        if (refreshed.state == ModdingFlowAuthState::Ready &&
            refreshedScopeGranted && !state_->accessToken.empty())
        {
            return state_->accessToken;
        }
        if (refreshed.state == ModdingFlowAuthState::TemporarilyUnavailable)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::TemporarilyUnavailable,
                "ModdingFlow authentication is temporarily unavailable.");
        }
        if (refreshed.state == ModdingFlowAuthState::ReauthRequired)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::ReauthRequired,
                "ModdingFlow account reconnection is required.");
        }
        throw ModdingFlowAuthException(
            ModdingFlowAuthErrorCode::NotLinked,
            "ModdingFlow account is not linked.");
    }

    ModdingFlowAuthStatus ModdingFlowAuthService::restoreStoredSession(
        std::wstring_view operationId)
    {
        const ScopedOperationContext operationContext(operationId);
        std::unique_lock lock(state_->mutex);
        if (!state_->initialized)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::NotInitialized,
                "ModdingFlow OAuth service is not initialized.");
        }
        return state_->refreshStoredSession(lock, operationId, false);
    }

    ModdingFlowAuthStatus ModdingFlowAuthService::disconnect(std::wstring_view operationId)
    {
        const ScopedOperationContext operationContext(operationId);
        std::unique_lock lock(state_->mutex);
        if (!state_->initialized)
        {
            throw ModdingFlowAuthException(
                ModdingFlowAuthErrorCode::NotInitialized,
                "ModdingFlow OAuth service is not initialized.");
        }

        ++state_->authEpoch;
        std::string refreshToken;
        try
        {
            if (std::optional<std::string> stored =
                    state_->credentials.read(state_->configuration.refreshCredentialTarget()))
            {
                refreshToken = std::move(*stored);
            }
        }
        catch (...)
        {
            state_->logger.writeOperation(
                LogLevel::Warning,
                "ModdingFlowAuth",
                "OAuth credential could not be read for best-effort revocation.");
        }
        std::string accessToken = state_->accessToken;

        bool credentialRemoved = true;
        try
        {
            state_->credentials.remove(state_->configuration.refreshCredentialTarget());
        }
        catch (...)
        {
            credentialRemoved = false;
            state_->logger.writeOperation(
                LogLevel::Error,
                "ModdingFlowAuth",
                "OAuth local credential removal failed during disconnect.");
        }

        state_->clearTransaction();
        state_->clearSession();
        state_->connectionInProgress = false;
        state_->credentialSuppressed = !credentialRemoved;
        state_->status = {};
        if (!credentialRemoved)
        {
            state_->status.state = ModdingFlowAuthState::TemporarilyUnavailable;
            state_->status.hasStoredSession = true;
            state_->status.retryable = true;
            state_->status.requiresUserAction = false;
        }
        state_->logger.writeOperation(
            credentialRemoved ? LogLevel::Info : LogLevel::Warning,
            "ModdingFlowAuth",
            credentialRemoved
                ? "OAuth local session disconnected."
                : "OAuth local session cleared but credential removal requires retry.");
        const ModdingFlowAuthStatus disconnectedStatus = state_->status;
        lock.unlock();

        const auto revoke = [&](std::string& token, std::string_view hint)
        {
            if (token.empty())
            {
                return;
            }
            ModdingFlowRevokeRequest request{
                std::string(state_->configuration.revocationEndpoint()),
                std::string(state_->configuration.clientId()),
                token,
                std::string(hint),
                std::wstring(operationId)
            };
            try
            {
                state_->oauthClient.revokeToken(request);
            }
            catch (...)
            {
                state_->logger.writeOperation(
                    LogLevel::Warning,
                    "ModdingFlowAuth",
                    "OAuth remote revocation failed; local disconnect will continue.");
            }
            wipe(request.token);
            wipe(token);
        };
        revoke(refreshToken, "refresh_token");
        revoke(accessToken, "access_token");
        return disconnectedStatus;
    }

    bool ModdingFlowAuthService::isInitialized() const noexcept
    {
        std::lock_guard lock(state_->mutex);
        return state_->initialized;
    }
}
