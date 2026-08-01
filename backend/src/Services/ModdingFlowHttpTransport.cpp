#include "FluxoraCore/Services/ModdingFlowHttpTransport.hpp"

#include <algorithm>
#include <atomic>
#include <charconv>
#include <chrono>
#include <cctype>
#include <condition_variable>
#include <limits>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <Windows.h>
#include <winhttp.h>
#endif

namespace fluxora
{
    namespace
    {
        bool headerNameEquals(std::string_view left, std::string_view right) noexcept
        {
            return left.size() == right.size() &&
                std::equal(left.begin(), left.end(), right.begin(), [](char leftCharacter, char rightCharacter)
                {
                    return std::tolower(static_cast<unsigned char>(leftCharacter)) ==
                        std::tolower(static_cast<unsigned char>(rightCharacter));
                });
        }

        bool containsAsciiCaseInsensitive(
            std::string_view value,
            std::string_view needle) noexcept
        {
            if (needle.empty() || value.size() < needle.size())
            {
                return needle.empty();
            }
            for (std::size_t offset = 0; offset <= value.size() - needle.size(); ++offset)
            {
                if (std::equal(
                    needle.begin(),
                    needle.end(),
                    value.begin() + static_cast<std::ptrdiff_t>(offset),
                    [](char leftCharacter, char rightCharacter)
                    {
                        return std::tolower(static_cast<unsigned char>(leftCharacter)) ==
                            std::tolower(static_cast<unsigned char>(rightCharacter));
                    }))
                {
                    return true;
                }
            }
            return false;
        }

        [[noreturn]] void throwRequestFailure(
            ModdingFlowHttpFailureKind kind,
            bool requestMayHaveBeenSent,
            std::string message)
        {
            throw ModdingFlowHttpException(kind, requestMayHaveBeenSent, std::move(message));
        }

        bool isHeaderNameCharacter(unsigned char character) noexcept
        {
            return std::isalnum(character) != 0 || character == '-' || character == '_';
        }

        void validateRequest(const ModdingFlowHttpRequest& request)
        {
            constexpr std::string_view origin = "https://moddingflow.com";
            if (request.url.size() <= origin.size() || request.url.size() > 2048U ||
                !request.url.starts_with(origin) || request.url[origin.size()] != '/' ||
                request.url.find('#') != std::string::npos ||
                request.url.find_first_of("\r\n\t ") != std::string::npos)
            {
                throwRequestFailure(
                    ModdingFlowHttpFailureKind::Security,
                    false,
                    "ModdingFlow HTTP origin validation failed.");
            }
            if (request.policy.redirects != ModdingFlowRedirectPolicy::Reject)
            {
                throwRequestFailure(
                    ModdingFlowHttpFailureKind::Security,
                    false,
                    "ModdingFlow HTTP redirect policy is invalid.");
            }

            const auto validTimeout = [](std::chrono::milliseconds timeout)
            {
                return timeout > std::chrono::milliseconds::zero() &&
                    timeout <= std::chrono::minutes(1) &&
                    timeout.count() <= (std::numeric_limits<int>::max)();
            };
            if (!validTimeout(request.policy.timeouts.resolve) ||
                !validTimeout(request.policy.timeouts.connect) ||
                !validTimeout(request.policy.timeouts.send) ||
                !validTimeout(request.policy.timeouts.receive) ||
                !validTimeout(request.policy.timeouts.overall))
            {
                throwRequestFailure(
                    ModdingFlowHttpFailureKind::Protocol,
                    false,
                    "ModdingFlow HTTP timeout policy is invalid.");
            }
            if (request.maximumResponseHeaderBytes == 0 ||
                request.maximumResponseHeaderBytes > 64U * 1024U ||
                request.maximumResponseBodyBytes == 0 ||
                request.maximumResponseBodyBytes > 1024U * 1024U ||
                request.body.size() > 64U * 1024U ||
                (request.method == ModdingFlowHttpMethod::Get && !request.body.empty()))
            {
                throwRequestFailure(
                    ModdingFlowHttpFailureKind::Protocol,
                    false,
                    "ModdingFlow HTTP size policy is invalid.");
            }

            std::size_t headerBytes = 0;
            std::size_t authorizationCount = 0;
            std::size_t contentTypeCount = 0;
            for (const ModdingFlowHttpHeader& header : request.headers)
            {
                if (header.name.empty() || header.name.size() > 128U || header.value.size() > 16U * 1024U ||
                    !std::all_of(header.name.begin(), header.name.end(), [](unsigned char character)
                    {
                        return isHeaderNameCharacter(character);
                    }) ||
                    std::any_of(header.value.begin(), header.value.end(), [](unsigned char character)
                    {
                        return character < 0x20U || character > 0x7EU;
                    }))
                {
                    throwRequestFailure(
                        ModdingFlowHttpFailureKind::Security,
                        false,
                        "ModdingFlow HTTP request header validation failed.");
                }
                headerBytes += header.name.size() + header.value.size() + 4U;
                if (headerBytes > 24U * 1024U)
                {
                    throwRequestFailure(
                        ModdingFlowHttpFailureKind::Protocol,
                        false,
                        "ModdingFlow HTTP request headers exceeded their size limit.");
                }
                std::string loweredName = header.name;
                std::ranges::transform(loweredName, loweredName.begin(), [](unsigned char character)
                {
                    return static_cast<char>(std::tolower(character));
                });
                const bool callerOwnedFramingHeader =
                    loweredName == "host" || loweredName == "content-length" ||
                    loweredName == "transfer-encoding" || loweredName == "connection" ||
                    loweredName == "cookie" || loweredName == "upgrade" ||
                    loweredName == "te" || loweredName == "trailer" ||
                    loweredName == "keep-alive" || loweredName.starts_with("proxy-");
                if (callerOwnedFramingHeader)
                {
                    throwRequestFailure(
                        ModdingFlowHttpFailureKind::Security,
                        false,
                        "ModdingFlow HTTP caller-owned framing or hop-by-hop header was rejected.");
                }
                authorizationCount += headerNameEquals(header.name, "authorization") ? 1U : 0U;
                contentTypeCount += headerNameEquals(header.name, "content-type") ? 1U : 0U;
            }
            if (authorizationCount > 1U || contentTypeCount > 1U)
            {
                throwRequestFailure(
                    ModdingFlowHttpFailureKind::Security,
                    false,
                    "ModdingFlow HTTP duplicate security header was rejected.");
            }

            const std::string_view path = std::string_view(request.url).substr(origin.size());
            const bool credentialFreeEndpoint =
                path == "/oauth/token" || path == "/oauth/revoke" ||
                path == "/.well-known/jwks.json";
            if (credentialFreeEndpoint && authorizationCount != 0U)
            {
                throwRequestFailure(
                    ModdingFlowHttpFailureKind::Security,
                    false,
                    "ModdingFlow endpoint does not permit an authorization header.");
            }
            if (containsAsciiCaseInsensitive(request.body, "client_secret"))
            {
                throwRequestFailure(
                    ModdingFlowHttpFailureKind::Security,
                    false,
                    "ModdingFlow public-client request contained a forbidden secret field.");
            }
        }

        void validateResponseFraming(const std::vector<ModdingFlowHttpHeader>& headers)
        {
            std::size_t contentLengthCount = 0;
            std::size_t transferEncodingCount = 0;
            for (const ModdingFlowHttpHeader& header : headers)
            {
                if (headerNameEquals(header.name, "transfer-encoding"))
                {
                    ++transferEncodingCount;
                    if (!headerNameEquals(header.value, "chunked"))
                    {
                        throw std::runtime_error("Response transfer encoding is unsupported or ambiguous.");
                    }
                }
                else if (headerNameEquals(header.name, "content-length"))
                {
                    ++contentLengthCount;
                    std::uint64_t contentLength = 0;
                    const auto [end, error] = std::from_chars(
                        header.value.data(),
                        header.value.data() + header.value.size(),
                        contentLength);
                    if (header.value.empty() || error != std::errc{} ||
                        end != header.value.data() + header.value.size())
                    {
                        throw std::runtime_error("Response content length is invalid.");
                    }
                }
            }
            if (contentLengthCount > 1U || transferEncodingCount > 1U ||
                (contentLengthCount != 0U && transferEncodingCount != 0U))
            {
                throw std::runtime_error("Ambiguous response framing is forbidden.");
            }
        }

#ifdef _WIN32
        std::pair<ModdingFlowHttpFailureKind, bool> classifyAsyncFailure(
            DWORD_PTR asyncApiResult,
            DWORD error,
            bool requestSubmissionStarted) noexcept
        {
            const bool provenPreSubmissionFailure =
                !requestSubmissionStarted &&
                asyncApiResult == API_SEND_REQUEST &&
                (error == ERROR_WINHTTP_NAME_NOT_RESOLVED ||
                 error == ERROR_WINHTTP_CANNOT_CONNECT);
            return provenPreSubmissionFailure
                ? std::pair{
                    ModdingFlowHttpFailureKind::DefinitelyNotSent,
                    false}
                : std::pair{
                    ModdingFlowHttpFailureKind::Ambiguous,
                    true};
        }

        class InternetHandle final
        {
        public:
            InternetHandle() = default;
            explicit InternetHandle(HINTERNET value) noexcept : value_(value) {}
            ~InternetHandle()
            {
                if (value_ != nullptr)
                {
                    WinHttpCloseHandle(value_);
                }
            }
            InternetHandle(const InternetHandle&) = delete;
            InternetHandle& operator=(const InternetHandle&) = delete;
            [[nodiscard]] HINTERNET get() const noexcept { return value_; }

        private:
            HINTERNET value_{nullptr};
        };

        std::wstring widenAscii(std::string_view value)
        {
            std::wstring result;
            result.reserve(value.size());
            for (const unsigned char character : value)
            {
                if (character > 0x7FU)
                {
                    throwRequestFailure(
                        ModdingFlowHttpFailureKind::Security,
                        false,
                        "ModdingFlow HTTP request was not ASCII-safe.");
                }
                result.push_back(static_cast<wchar_t>(character));
            }
            return result;
        }

        std::string narrowHeader(std::wstring_view value)
        {
            std::string result;
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                if (character < 0x20 || character > 0x7E)
                {
                    throw std::runtime_error("Response header is not ASCII-safe.");
                }
                result.push_back(static_cast<char>(character));
            }
            return result;
        }

        template <typename Character>
        void secureWipe(std::vector<Character>& value) noexcept
        {
            if (!value.empty())
            {
                SecureZeroMemory(value.data(), value.size() * sizeof(Character));
            }
            value.clear();
        }

        void secureWipe(std::string& value) noexcept
        {
            if (!value.empty())
            {
                SecureZeroMemory(value.data(), value.size());
            }
            value.clear();
        }

        class SensitiveWideStringGuard final
        {
        public:
            explicit SensitiveWideStringGuard(std::wstring& value) noexcept : value_(value) {}
            ~SensitiveWideStringGuard()
            {
                if (!value_.empty())
                {
                    SecureZeroMemory(value_.data(), value_.size() * sizeof(wchar_t));
                }
                value_.clear();
            }

        private:
            std::wstring& value_;
        };

        struct AsyncRequestState final
        {
            std::mutex mutex;
            std::condition_variable completedCondition;
            std::atomic<bool> stopping{false};
            std::atomic<bool> requestSubmissionStarted{false};
            bool completed{false};
            bool successful{false};
            ModdingFlowHttpResponse response;
            ModdingFlowHttpFailureKind failureKind{ModdingFlowHttpFailureKind::Ambiguous};
            bool requestMayHaveBeenSent{true};
            std::string failureMessage;
            std::size_t maximumHeaderBytes{0};
            std::size_t maximumBodyBytes{0};
            std::vector<unsigned char> requestBody;
            std::vector<unsigned char> readBuffer;

            ~AsyncRequestState()
            {
                secureWipe(requestBody);
                secureWipe(readBuffer);
                secureWipe(response.body);
                for (ModdingFlowHttpHeader& header : response.headers)
                {
                    secureWipe(header.value);
                }
            }

            void fail(
                ModdingFlowHttpFailureKind kind,
                bool mayHaveBeenSent,
                std::string message) noexcept
            {
                {
                    std::lock_guard lock(mutex);
                    bool expected = false;
                    if (!stopping.compare_exchange_strong(expected, true))
                    {
                        return;
                    }
                    failureKind = kind;
                    requestMayHaveBeenSent = mayHaveBeenSent;
                    failureMessage = std::move(message);
                    completed = true;
                }
                completedCondition.notify_all();
            }

            void succeed() noexcept
            {
                {
                    std::lock_guard lock(mutex);
                    bool expected = false;
                    if (!stopping.compare_exchange_strong(expected, true))
                    {
                        return;
                    }
                    successful = true;
                    completed = true;
                }
                completedCondition.notify_all();
            }
        };

        bool acceptedAsync(BOOL result) noexcept
        {
            return result != FALSE || GetLastError() == ERROR_IO_PENDING;
        }

        void queryAvailable(HINTERNET request, AsyncRequestState& state)
        {
            if (!state.stopping.load(std::memory_order_acquire) &&
                !acceptedAsync(WinHttpQueryDataAvailable(request, nullptr)))
            {
                state.fail(
                    ModdingFlowHttpFailureKind::Ambiguous,
                    true,
                    "ModdingFlow response body availability failed after send.");
            }
        }

        void parseResponseHeaders(HINTERNET request, AsyncRequestState& state)
        {
            DWORD status = 0;
            DWORD statusBytes = sizeof(status);
            if (!WinHttpQueryHeaders(
                    request,
                    WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                    WINHTTP_HEADER_NAME_BY_INDEX,
                    &status,
                    &statusBytes,
                    WINHTTP_NO_HEADER_INDEX) ||
                status == 0 || status > 65535U)
            {
                throw std::runtime_error("Response status is invalid.");
            }
            state.response.statusCode = static_cast<std::uint16_t>(status);

            DWORD rawBytes = 0;
            SetLastError(ERROR_SUCCESS);
            const BOOL sizeResult = WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_RAW_HEADERS_CRLF,
                WINHTTP_HEADER_NAME_BY_INDEX,
                WINHTTP_NO_OUTPUT_BUFFER,
                &rawBytes,
                WINHTTP_NO_HEADER_INDEX);
            if (sizeResult != FALSE || GetLastError() != ERROR_INSUFFICIENT_BUFFER ||
                rawBytes == 0 || rawBytes > state.maximumHeaderBytes)
            {
                throw ModdingFlowHttpException(
                    rawBytes > state.maximumHeaderBytes
                        ? ModdingFlowHttpFailureKind::ResponseTooLarge
                        : ModdingFlowHttpFailureKind::Protocol,
                    true,
                    "ModdingFlow response headers were invalid or too large.");
            }
            std::vector<wchar_t> raw((rawBytes / sizeof(wchar_t)) + 1U, L'\0');
            if (!WinHttpQueryHeaders(
                    request,
                    WINHTTP_QUERY_RAW_HEADERS_CRLF,
                    WINHTTP_HEADER_NAME_BY_INDEX,
                    raw.data(),
                    &rawBytes,
                    WINHTTP_NO_HEADER_INDEX))
            {
                throw std::runtime_error("Response headers could not be read.");
            }
            std::wstring_view text(raw.data());
            std::size_t position = text.find(L"\r\n");
            if (position == std::wstring_view::npos)
            {
                throw std::runtime_error("Response status line is invalid.");
            }
            position += 2;
            while (position < text.size())
            {
                const std::size_t lineEnd = text.find(L"\r\n", position);
                if (lineEnd == std::wstring_view::npos)
                {
                    throw std::runtime_error("Response header line is invalid.");
                }
                if (lineEnd == position)
                {
                    break;
                }
                const std::wstring_view line = text.substr(position, lineEnd - position);
                if (line.front() == L' ' || line.front() == L'\t')
                {
                    throw std::runtime_error("Folded response headers are forbidden.");
                }
                const std::size_t separator = line.find(L':');
                if (separator == std::wstring_view::npos || separator == 0)
                {
                    throw std::runtime_error("Response header is invalid.");
                }
                std::wstring_view value = line.substr(separator + 1);
                while (!value.empty() && (value.front() == L' ' || value.front() == L'\t'))
                {
                    value.remove_prefix(1);
                }
                while (!value.empty() && (value.back() == L' ' || value.back() == L'\t'))
                {
                    value.remove_suffix(1);
                }
                std::string name = narrowHeader(line.substr(0, separator));
                std::ranges::transform(name, name.begin(), [](unsigned char character)
                {
                    return static_cast<char>(std::tolower(character));
                });
                state.response.headers.push_back({std::move(name), narrowHeader(value)});
                position = lineEnd + 2;
            }

            validateResponseFraming(state.response.headers);
            for (const ModdingFlowHttpHeader& header : state.response.headers)
            {
                if (!headerNameEquals(header.name, "content-length"))
                {
                    continue;
                }
                std::uint64_t contentLength = 0;
                const auto [end, error] = std::from_chars(
                    header.value.data(),
                    header.value.data() + header.value.size(),
                    contentLength);
                if (error != std::errc{} || end != header.value.data() + header.value.size())
                {
                    throw std::runtime_error("Response content length is invalid.");
                }
                if (contentLength > state.maximumBodyBytes)
                {
                    throw ModdingFlowHttpException(
                        ModdingFlowHttpFailureKind::ResponseTooLarge,
                        true,
                        "ModdingFlow response body exceeded its size limit.");
                }
            }
        }

        void CALLBACK winHttpCallback(
            HINTERNET request,
            DWORD_PTR context,
            DWORD status,
            LPVOID statusInformation,
            DWORD statusInformationLength)
        {
            auto* state = reinterpret_cast<AsyncRequestState*>(context);
            if (state == nullptr)
            {
                return;
            }
            if (status == WINHTTP_CALLBACK_STATUS_HANDLE_CLOSING)
            {
                delete state;
                return;
            }
            if (state->stopping.load(std::memory_order_acquire))
            {
                return;
            }

            try
            {
                switch (status)
                {
                case WINHTTP_CALLBACK_STATUS_SENDING_REQUEST:
                case WINHTTP_CALLBACK_STATUS_REQUEST_SENT:
                    state->requestSubmissionStarted.store(true, std::memory_order_release);
                    break;
                case WINHTTP_CALLBACK_STATUS_SENDREQUEST_COMPLETE:
                    state->requestSubmissionStarted.store(true, std::memory_order_release);
                    if (!acceptedAsync(WinHttpReceiveResponse(request, nullptr)))
                    {
                        state->fail(
                            ModdingFlowHttpFailureKind::Ambiguous,
                            true,
                            "ModdingFlow response receive failed after send.");
                    }
                    break;
                case WINHTTP_CALLBACK_STATUS_HEADERS_AVAILABLE:
                    parseResponseHeaders(request, *state);
                    queryAvailable(request, *state);
                    break;
                case WINHTTP_CALLBACK_STATUS_DATA_AVAILABLE:
                {
                    if (statusInformation == nullptr || statusInformationLength != sizeof(DWORD))
                    {
                        throw std::runtime_error("Response body availability callback is invalid.");
                    }
                    const DWORD available = *static_cast<const DWORD*>(statusInformation);
                    if (available == 0)
                    {
                        state->succeed();
                        break;
                    }
                    if (state->response.body.size() + static_cast<std::size_t>(available) >
                        state->maximumBodyBytes)
                    {
                        state->fail(
                            ModdingFlowHttpFailureKind::ResponseTooLarge,
                            true,
                            "ModdingFlow response body exceeded its size limit.");
                        break;
                    }
                    state->readBuffer.resize(available);
                    if (!acceptedAsync(WinHttpReadData(
                            request,
                            state->readBuffer.data(),
                            available,
                            nullptr)))
                    {
                        state->fail(
                            ModdingFlowHttpFailureKind::Ambiguous,
                            true,
                            "ModdingFlow response body read failed after send.");
                    }
                    break;
                }
                case WINHTTP_CALLBACK_STATUS_READ_COMPLETE:
                    if (statusInformationLength == 0)
                    {
                        state->succeed();
                        break;
                    }
                    if (statusInformation == nullptr ||
                        state->response.body.size() + statusInformationLength > state->maximumBodyBytes)
                    {
                        state->fail(
                            ModdingFlowHttpFailureKind::ResponseTooLarge,
                            true,
                            "ModdingFlow response body exceeded its size limit.");
                        break;
                    }
                    state->response.body.append(
                        static_cast<const char*>(statusInformation),
                        static_cast<std::size_t>(statusInformationLength));
                    queryAvailable(request, *state);
                    break;
                case WINHTTP_CALLBACK_STATUS_REQUEST_ERROR:
                    if (statusInformation == nullptr ||
                        statusInformationLength != sizeof(WINHTTP_ASYNC_RESULT))
                    {
                        state->fail(
                            ModdingFlowHttpFailureKind::Ambiguous,
                            true,
                            "ModdingFlow asynchronous request failure was invalid or ambiguous.");
                        break;
                    }
                    {
                        const auto& result = *static_cast<const WINHTTP_ASYNC_RESULT*>(
                            statusInformation);
                        const auto [kind, mayHaveBeenSent] = classifyAsyncFailure(
                            result.dwResult,
                            result.dwError,
                            state->requestSubmissionStarted.load(std::memory_order_acquire));
                        state->fail(
                            kind,
                            mayHaveBeenSent,
                            mayHaveBeenSent
                                ? "ModdingFlow asynchronous request outcome was ambiguous."
                                : "ModdingFlow request failed before submission.");
                    }
                    break;
                default:
                    break;
                }
            }
            catch (const ModdingFlowHttpException& exception)
            {
                state->fail(
                    exception.kind(),
                    exception.requestMayHaveBeenSent(),
                    exception.what());
            }
            catch (...)
            {
                state->fail(
                    ModdingFlowHttpFailureKind::Protocol,
                    true,
                    "ModdingFlow HTTP response processing failed.");
            }
        }
#endif
    }

    std::string_view ModdingFlowHttpResponse::firstHeader(std::string_view name) const noexcept
    {
        for (const ModdingFlowHttpHeader& header : headers)
        {
            if (headerNameEquals(header.name, name))
            {
                return header.value;
            }
        }
        return {};
    }

    ModdingFlowHttpException::ModdingFlowHttpException(
        ModdingFlowHttpFailureKind kind,
        bool requestMayHaveBeenSent,
        std::string message)
        : std::runtime_error(std::move(message)),
          kind_(kind),
          requestMayHaveBeenSent_(requestMayHaveBeenSent)
    {
    }

    ModdingFlowHttpFailureKind ModdingFlowHttpException::kind() const noexcept
    {
        return kind_;
    }

    bool ModdingFlowHttpException::requestMayHaveBeenSent() const noexcept
    {
        return requestMayHaveBeenSent_;
    }

#ifdef FLUXORA_MODDINGFLOW_HTTP_TEST_HOOKS
    void validateModdingFlowHttpResponseFramingForTests(
        const std::vector<ModdingFlowHttpHeader>& headers)
    {
        validateResponseFraming(headers);
    }

#ifdef _WIN32
    ModdingFlowHttpFailureClassification classifyModdingFlowWinHttpAsyncFailureForTests(
        std::uintptr_t asyncApiResult,
        std::uint32_t error,
        bool requestSubmissionStarted) noexcept
    {
        const auto [kind, mayHaveBeenSent] = classifyAsyncFailure(
            static_cast<DWORD_PTR>(asyncApiResult),
            static_cast<DWORD>(error),
            requestSubmissionStarted);
        return {kind, mayHaveBeenSent};
    }
#endif
#endif

    struct WinHttpModdingFlowTransport::State
    {
        explicit State(std::wstring userAgentValue)
            : userAgent(std::move(userAgentValue))
        {
        }

        std::wstring userAgent;
    };

    WinHttpModdingFlowTransport::WinHttpModdingFlowTransport(std::wstring userAgent)
        : state_(nullptr)
    {
        if (userAgent.empty() || userAgent.size() > 256U ||
            !std::all_of(userAgent.begin(), userAgent.end(), [](wchar_t character)
            {
                return character >= 0x20 && character <= 0x7e;
            }))
        {
            throw std::invalid_argument("ModdingFlow User-Agent is invalid.");
        }
        state_ = std::make_unique<State>(std::move(userAgent));
    }

    WinHttpModdingFlowTransport::~WinHttpModdingFlowTransport() = default;

    ModdingFlowHttpResponse WinHttpModdingFlowTransport::send(const ModdingFlowHttpRequest& request)
    {
        validateRequest(request);
#ifdef _WIN32
        InternetHandle session(WinHttpOpen(
            state_->userAgent.c_str(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            WINHTTP_NO_PROXY_NAME,
            WINHTTP_NO_PROXY_BYPASS,
            WINHTTP_FLAG_ASYNC));
        if (session.get() == nullptr)
        {
            throwRequestFailure(
                ModdingFlowHttpFailureKind::DefinitelyNotSent,
                false,
                "ModdingFlow WinHTTP session creation failed.");
        }
        DWORD autologonPolicy = WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH;
        if (!WinHttpSetOption(
                session.get(),
                WINHTTP_OPTION_AUTOLOGON_POLICY,
                &autologonPolicy,
                sizeof(autologonPolicy)))
        {
            throwRequestFailure(
                ModdingFlowHttpFailureKind::DefinitelyNotSent,
                false,
                "ModdingFlow WinHTTP authentication policy setup failed.");
        }

        InternetHandle connection(WinHttpConnect(
            session.get(),
            L"moddingflow.com",
            INTERNET_DEFAULT_HTTPS_PORT,
            0));
        if (connection.get() == nullptr)
        {
            throwRequestFailure(
                ModdingFlowHttpFailureKind::DefinitelyNotSent,
                false,
                "ModdingFlow WinHTTP connection setup failed.");
        }

        constexpr std::string_view origin = "https://moddingflow.com";
        const std::wstring path = widenAscii(std::string_view(request.url).substr(origin.size()));
        const wchar_t* method = request.method == ModdingFlowHttpMethod::Get ? L"GET" : L"POST";
        HINTERNET requestHandle = WinHttpOpenRequest(
            connection.get(),
            method,
            path.c_str(),
            nullptr,
            WINHTTP_NO_REFERER,
            WINHTTP_DEFAULT_ACCEPT_TYPES,
            WINHTTP_FLAG_SECURE);
        if (requestHandle == nullptr)
        {
            throwRequestFailure(
                ModdingFlowHttpFailureKind::DefinitelyNotSent,
                false,
                "ModdingFlow WinHTTP request setup failed.");
        }

        const auto closeUnownedRequest = [&]
        {
            if (requestHandle != nullptr)
            {
                WinHttpCloseHandle(requestHandle);
                requestHandle = nullptr;
            }
        };
        DWORD redirectPolicy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        DWORD disabledFeatures = WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_AUTHENTICATION;
        DWORD maximumHeaderBytes = static_cast<DWORD>(request.maximumResponseHeaderBytes);
        const bool optionsApplied =
            WinHttpSetTimeouts(
                requestHandle,
                static_cast<int>(request.policy.timeouts.resolve.count()),
                static_cast<int>(request.policy.timeouts.connect.count()),
                static_cast<int>(request.policy.timeouts.send.count()),
                static_cast<int>(request.policy.timeouts.receive.count())) != FALSE &&
            WinHttpSetOption(
                requestHandle,
                WINHTTP_OPTION_REDIRECT_POLICY,
                &redirectPolicy,
                sizeof(redirectPolicy)) != FALSE &&
            WinHttpSetOption(
                requestHandle,
                WINHTTP_OPTION_DISABLE_FEATURE,
                &disabledFeatures,
                sizeof(disabledFeatures)) != FALSE &&
            WinHttpSetOption(
                requestHandle,
                WINHTTP_OPTION_MAX_RESPONSE_HEADER_SIZE,
                &maximumHeaderBytes,
                sizeof(maximumHeaderBytes)) != FALSE;
        if (!optionsApplied)
        {
            closeUnownedRequest();
            throwRequestFailure(
                ModdingFlowHttpFailureKind::DefinitelyNotSent,
                false,
                "ModdingFlow WinHTTP security options could not be applied.");
        }

        auto* asyncState = new AsyncRequestState();
        asyncState->maximumHeaderBytes = request.maximumResponseHeaderBytes;
        asyncState->maximumBodyBytes = request.maximumResponseBodyBytes;
        asyncState->requestBody.assign(request.body.begin(), request.body.end());
        DWORD_PTR context = reinterpret_cast<DWORD_PTR>(asyncState);
        if (!WinHttpSetOption(
                requestHandle,
                WINHTTP_OPTION_CONTEXT_VALUE,
                &context,
                sizeof(context)))
        {
            delete asyncState;
            closeUnownedRequest();
            throwRequestFailure(
                ModdingFlowHttpFailureKind::DefinitelyNotSent,
                false,
                "ModdingFlow WinHTTP request context setup failed.");
        }
        const DWORD callbackFlags =
            WINHTTP_CALLBACK_FLAG_SEND_REQUEST |
            WINHTTP_CALLBACK_FLAG_SENDREQUEST_COMPLETE |
            WINHTTP_CALLBACK_FLAG_HEADERS_AVAILABLE |
            WINHTTP_CALLBACK_FLAG_DATA_AVAILABLE |
            WINHTTP_CALLBACK_FLAG_READ_COMPLETE |
            WINHTTP_CALLBACK_FLAG_REQUEST_ERROR |
            WINHTTP_CALLBACK_FLAG_HANDLES;
        if (WinHttpSetStatusCallback(
                requestHandle,
                winHttpCallback,
                callbackFlags,
                0) == WINHTTP_INVALID_STATUS_CALLBACK)
        {
            delete asyncState;
            closeUnownedRequest();
            throwRequestFailure(
                ModdingFlowHttpFailureKind::DefinitelyNotSent,
                false,
                "ModdingFlow WinHTTP callback setup failed.");
        }

        std::wstring headerBlock;
        SensitiveWideStringGuard headerBlockGuard(headerBlock);
        for (const ModdingFlowHttpHeader& header : request.headers)
        {
            headerBlock += widenAscii(header.name);
            headerBlock += L": ";
            headerBlock += widenAscii(header.value);
            headerBlock += L"\r\n";
        }
        const DWORD bodyBytes = static_cast<DWORD>(asyncState->requestBody.size());
        const BOOL sendResult = WinHttpSendRequest(
            requestHandle,
            headerBlock.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headerBlock.c_str(),
            headerBlock.empty() ? 0 : static_cast<DWORD>(headerBlock.size()),
            asyncState->requestBody.empty()
                ? WINHTTP_NO_REQUEST_DATA
                : asyncState->requestBody.data(),
            bodyBytes,
            bodyBytes,
            context);
        if (sendResult == FALSE)
        {
            const DWORD error = GetLastError();
            if (error != ERROR_IO_PENDING)
            {
                const auto [kind, mayHaveBeenSent] = classifyAsyncFailure(
                    API_SEND_REQUEST,
                    error,
                    asyncState->requestSubmissionStarted.load(std::memory_order_acquire));
                asyncState->fail(
                    kind,
                    mayHaveBeenSent,
                    mayHaveBeenSent
                        ? "ModdingFlow request send outcome was ambiguous."
                        : "ModdingFlow request failed before submission.");
            }
        }

        ModdingFlowHttpResponse response;
        ModdingFlowHttpFailureKind failureKind = ModdingFlowHttpFailureKind::Ambiguous;
        bool requestMayHaveBeenSent = true;
        std::string failureMessage;
        bool succeeded = false;
        {
            std::unique_lock lock(asyncState->mutex);
            const auto deadline = std::chrono::steady_clock::now() + request.policy.timeouts.overall;
            if (!asyncState->completedCondition.wait_until(lock, deadline, [&]
                {
                    return asyncState->completed;
                }))
            {
                bool expected = false;
                if (asyncState->stopping.compare_exchange_strong(expected, true))
                {
                    asyncState->failureKind = ModdingFlowHttpFailureKind::Timeout;
                    asyncState->requestMayHaveBeenSent = true;
                    asyncState->failureMessage = "ModdingFlow request reached its overall deadline.";
                    asyncState->completed = true;
                }
            }
            succeeded = asyncState->successful;
            if (succeeded)
            {
                response = std::move(asyncState->response);
            }
            else
            {
                failureKind = asyncState->failureKind;
                requestMayHaveBeenSent = asyncState->requestMayHaveBeenSent;
                failureMessage = asyncState->failureMessage;
            }
        }

        // HANDLE_CLOSING is the final callback and owns deletion of asyncState.
        WinHttpCloseHandle(requestHandle);
        requestHandle = nullptr;
        if (!succeeded)
        {
            throwRequestFailure(failureKind, requestMayHaveBeenSent, std::move(failureMessage));
        }
        return response;
#else
        (void)request;
        throwRequestFailure(
            ModdingFlowHttpFailureKind::DefinitelyNotSent,
            false,
            "ModdingFlow WinHTTP transport is unavailable on this platform.");
#endif
    }
}
