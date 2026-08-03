#include "FluxoraCore/Services/SignedRemoteDownloadTransport.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cctype>
#include <limits>
#include <stdexcept>
#include <utility>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winhttp.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::size_t hardMaximumUrlBytes = 16U * 1024U;
        constexpr std::size_t hardMaximumRedirects = 8U;
        constexpr std::size_t hardMaximumHeaders = 128U;
        constexpr std::size_t hardMaximumHeaderNameBytes = 256U;
        constexpr std::size_t hardMaximumHeaderValueBytes = 16U * 1024U;
        constexpr std::size_t hardMaximumHeaderLineBytes = 16U * 1024U + 256U;
        constexpr std::size_t hardMaximumResponseHeaderBytes = 64U * 1024U;
        constexpr std::size_t hardMaximumChunkBytes = 4U * 1024U * 1024U;
        constexpr auto hardMaximumTimeout = std::chrono::minutes(5);

        void secureErase(std::string& value) noexcept;

        struct ParsedSignedUrl
        {
            std::string host;
            std::uint16_t port{443};
            std::string pathAndQuery;

            ParsedSignedUrl() = default;
            ~ParsedSignedUrl() { secureErase(pathAndQuery); }
            ParsedSignedUrl(const ParsedSignedUrl&) = delete;
            ParsedSignedUrl& operator=(const ParsedSignedUrl&) = delete;
            ParsedSignedUrl(ParsedSignedUrl&& other) noexcept
                : host(std::move(other.host)),
                  port(other.port),
                  pathAndQuery(std::move(other.pathAndQuery))
            {
                secureErase(other.pathAndQuery);
            }
            ParsedSignedUrl& operator=(ParsedSignedUrl&& other) noexcept
            {
                if (this != &other)
                {
                    host = std::move(other.host);
                    port = other.port;
                    secureErase(pathAndQuery);
                    pathAndQuery = std::move(other.pathAndQuery);
                    secureErase(other.pathAndQuery);
                }
                return *this;
            }
        };

        void secureErase(std::string& value) noexcept
        {
            volatile char* cursor = value.empty() ? nullptr : value.data();
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                cursor[index] = '\0';
            }
            value.clear();
        }

#ifdef _WIN32
        void secureErase(std::wstring& value) noexcept
        {
            volatile wchar_t* cursor = value.empty() ? nullptr : value.data();
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                cursor[index] = L'\0';
            }
            value.clear();
        }

        class EphemeralWideString final
        {
        public:
            explicit EphemeralWideString(std::wstring value) : value_(std::move(value)) {}
            ~EphemeralWideString() { secureErase(value_); }

            EphemeralWideString(const EphemeralWideString&) = delete;
            EphemeralWideString& operator=(const EphemeralWideString&) = delete;

            [[nodiscard]] std::wstring& get() noexcept { return value_; }
            [[nodiscard]] const std::wstring& get() const noexcept { return value_; }

        private:
            std::wstring value_;
        };
#endif

        class EphemeralString final
        {
        public:
            explicit EphemeralString(std::string value) : value_(std::move(value)) {}
            ~EphemeralString() { secureErase(value_); }

            EphemeralString(const EphemeralString&) = delete;
            EphemeralString& operator=(const EphemeralString&) = delete;
            EphemeralString(EphemeralString&& other) noexcept
                : value_(std::move(other.value_))
            {
                secureErase(other.value_);
            }
            EphemeralString& operator=(EphemeralString&& other) noexcept
            {
                if (this != &other)
                {
                    secureErase(value_);
                    value_ = std::move(other.value_);
                    secureErase(other.value_);
                }
                return *this;
            }

            [[nodiscard]] std::string& get() noexcept { return value_; }
            [[nodiscard]] const std::string& get() const noexcept { return value_; }

        private:
            std::string value_;
        };

        [[nodiscard]] bool isAsciiControlOrSpace(unsigned char value) noexcept
        {
            return value <= 0x20U || value == 0x7fU;
        }

        [[nodiscard]] bool isAsciiAlphaNumeric(unsigned char value) noexcept
        {
            return (value >= 'a' && value <= 'z') ||
                (value >= 'A' && value <= 'Z') ||
                (value >= '0' && value <= '9');
        }

        [[nodiscard]] bool isAsciiUnreserved(unsigned char value) noexcept
        {
            return isAsciiAlphaNumeric(value) || value == '-' || value == '.' ||
                value == '_' || value == '~';
        }

        [[nodiscard]] int hexadecimalValue(unsigned char value) noexcept
        {
            if (value >= '0' && value <= '9')
            {
                return value - '0';
            }
            if (value >= 'A' && value <= 'F')
            {
                return value - 'A' + 10;
            }
            return -1;
        }

        [[nodiscard]] bool validatePercentEncoding(
            std::string_view value,
            std::size_t pathBytes) noexcept
        {
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                const unsigned char character = static_cast<unsigned char>(value[index]);
                if (character != '%')
                {
                    continue;
                }
                if (index + 2U >= value.size())
                {
                    return false;
                }
                const int high = hexadecimalValue(static_cast<unsigned char>(value[index + 1U]));
                const int low = hexadecimalValue(static_cast<unsigned char>(value[index + 2U]));
                if (high < 0 || low < 0)
                {
                    return false;
                }
                const unsigned char decoded = static_cast<unsigned char>((high << 4) | low);
                if (isAsciiControlOrSpace(decoded) || isAsciiUnreserved(decoded) ||
                    (index < pathBytes && (decoded == '/' || decoded == '\\')))
                {
                    return false;
                }
                index += 2U;
            }
            return true;
        }

        [[nodiscard]] bool isCanonicalDnsName(std::string_view host) noexcept
        {
            if (host.empty() || host.size() > 253U || host.back() == '.')
            {
                return false;
            }

            std::size_t labelStart = 0;
            while (labelStart < host.size())
            {
                const std::size_t labelEnd = host.find('.', labelStart);
                const std::size_t effectiveEnd =
                    labelEnd == std::string_view::npos ? host.size() : labelEnd;
                const std::string_view label = host.substr(labelStart, effectiveEnd - labelStart);
                if (label.empty() || label.size() > 63U || label.front() == '-' ||
                    label.back() == '-')
                {
                    return false;
                }
                for (const unsigned char character : label)
                {
                    if (!((character >= 'a' && character <= 'z') ||
                        (character >= '0' && character <= '9') || character == '-'))
                    {
                        return false;
                    }
                }
                if (labelEnd == std::string_view::npos)
                {
                    break;
                }
                labelStart = labelEnd + 1U;
            }
            return true;
        }

        [[nodiscard]] std::optional<ParsedSignedUrl> parseSignedUrl(
            std::string_view url,
            std::size_t maximumUrlBytes)
        {
            constexpr std::string_view scheme = "https://";
            if (url.empty() || url.size() > maximumUrlBytes || url.size() > hardMaximumUrlBytes ||
                !url.starts_with(scheme))
            {
                return std::nullopt;
            }
            if (std::any_of(url.begin(), url.end(), [](const unsigned char character)
                {
                    return isAsciiControlOrSpace(character) || character > 0x7eU;
                }) || url.find('#') != std::string_view::npos ||
                url.find('\\') != std::string_view::npos)
            {
                return std::nullopt;
            }

            const std::size_t authorityStart = scheme.size();
            const std::size_t pathStart = url.find_first_of("/?", authorityStart);
            if (pathStart == std::string_view::npos || url[pathStart] != '/')
            {
                return std::nullopt;
            }
            const std::string_view authority = url.substr(authorityStart, pathStart - authorityStart);
            if (authority.empty() || authority.find('@') != std::string_view::npos ||
                authority.find('%') != std::string_view::npos || authority.front() == '[')
            {
                return std::nullopt;
            }

            ParsedSignedUrl parsed;
            const std::size_t portDelimiter = authority.rfind(':');
            std::string_view host = authority;
            if (portDelimiter != std::string_view::npos)
            {
                host = authority.substr(0, portDelimiter);
                const std::string_view portText = authority.substr(portDelimiter + 1U);
                unsigned int port = 0;
                const auto [end, error] = std::from_chars(
                    portText.data(), portText.data() + portText.size(), port);
                if (portText.empty() || (portText.size() > 1U && portText.front() == '0') ||
                    error != std::errc{} || end != portText.data() + portText.size() ||
                    port == 0U || port > 65535U || port == 443U)
                {
                    return std::nullopt;
                }
                parsed.port = static_cast<std::uint16_t>(port);
            }
            if (!isCanonicalDnsName(host))
            {
                return std::nullopt;
            }

            const std::string_view pathAndQuery = url.substr(pathStart);
            const std::size_t queryDelimiter = pathAndQuery.find('?');
            const std::size_t pathBytes = queryDelimiter == std::string_view::npos
                ? pathAndQuery.size()
                : queryDelimiter;
            if (pathBytes == 0U ||
                (queryDelimiter != std::string_view::npos &&
                    queryDelimiter + 1U == pathAndQuery.size()) ||
                !validatePercentEncoding(pathAndQuery, pathBytes))
            {
                return std::nullopt;
            }

            std::size_t segmentStart = 1U;
            while (segmentStart <= pathBytes)
            {
                const std::size_t slash = pathAndQuery.find('/', segmentStart);
                const std::size_t segmentEnd = slash == std::string_view::npos || slash > pathBytes
                    ? pathBytes
                    : slash;
                const std::string_view segment = pathAndQuery.substr(
                    segmentStart, segmentEnd - segmentStart);
                if (segment == "." || segment == "..")
                {
                    return std::nullopt;
                }
                if (segmentEnd == pathBytes)
                {
                    break;
                }
                segmentStart = segmentEnd + 1U;
            }

            parsed.host.assign(host);
            parsed.pathAndQuery.assign(pathAndQuery);
            return parsed;
        }

        [[nodiscard]] bool isValidOperationId(std::wstring_view operationId) noexcept
        {
            return !operationId.empty() && operationId.size() <= 256U &&
                std::none_of(operationId.begin(), operationId.end(), [](wchar_t character)
                {
                    return character < 0x20 || character == 0x7f;
                });
        }

        [[nodiscard]] bool isPositiveBoundedTimeout(std::chrono::milliseconds value) noexcept
        {
            return value.count() > 0 && value <= hardMaximumTimeout;
        }

        [[nodiscard]] bool isValidPolicy(const SignedRemoteTransportPolicy& policy) noexcept
        {
            return policy.maximumUrlBytes > 0U &&
                policy.maximumUrlBytes <= hardMaximumUrlBytes &&
                policy.maximumRedirects <= hardMaximumRedirects &&
                policy.maximumResponseHeaders > 0U &&
                policy.maximumResponseHeaders <= hardMaximumHeaders &&
                policy.maximumHeaderNameBytes > 0U &&
                policy.maximumHeaderNameBytes <= hardMaximumHeaderNameBytes &&
                policy.maximumHeaderValueBytes > 0U &&
                policy.maximumHeaderValueBytes <= hardMaximumHeaderValueBytes &&
                policy.maximumHeaderLineBytes > 0U &&
                policy.maximumHeaderLineBytes <= hardMaximumHeaderLineBytes &&
                policy.maximumResponseHeaderBytes > 0U &&
                policy.maximumResponseHeaderBytes <= hardMaximumResponseHeaderBytes &&
                policy.maximumChunkBytes > 0U &&
                policy.maximumChunkBytes <= hardMaximumChunkBytes &&
                isPositiveBoundedTimeout(policy.timeouts.resolve) &&
                isPositiveBoundedTimeout(policy.timeouts.connect) &&
                isPositiveBoundedTimeout(policy.timeouts.send) &&
                isPositiveBoundedTimeout(policy.timeouts.receive) &&
                isPositiveBoundedTimeout(policy.timeouts.overall);
        }

        [[nodiscard]] bool isHeaderNameCharacter(unsigned char character) noexcept
        {
            return isAsciiAlphaNumeric(character) || character == '!' || character == '#' ||
                character == '$' || character == '%' || character == '&' || character == '\'' ||
                character == '*' || character == '+' || character == '-' || character == '.' ||
                character == '^' || character == '_' || character == '`' || character == '|' ||
                character == '~';
        }

        [[nodiscard]] std::string lowerAscii(std::string_view value)
        {
            std::string result(value);
            std::transform(result.begin(), result.end(), result.begin(), [](const unsigned char character)
            {
                return static_cast<char>(std::tolower(character));
            });
            return result;
        }

        [[nodiscard]] bool parseUnsigned(std::string_view value, std::uint64_t& parsed) noexcept
        {
            if (value.empty() || (value.size() > 1U && value.front() == '0'))
            {
                return false;
            }
            const auto [end, error] = std::from_chars(
                value.data(), value.data() + value.size(), parsed);
            return error == std::errc{} && end == value.data() + value.size();
        }

        [[nodiscard]] std::optional<SignedRemoteContentRange> parseContentRange(
            std::string_view value) noexcept
        {
            constexpr std::string_view prefix = "bytes ";
            if (!value.starts_with(prefix))
            {
                return std::nullopt;
            }
            value.remove_prefix(prefix.size());
            const std::size_t hyphen = value.find('-');
            const std::size_t slash = value.find('/');
            if (hyphen == std::string_view::npos || slash == std::string_view::npos ||
                hyphen == 0U || slash <= hyphen + 1U || slash + 1U >= value.size())
            {
                return std::nullopt;
            }
            SignedRemoteContentRange result;
            if (!parseUnsigned(value.substr(0, hyphen), result.start) ||
                !parseUnsigned(value.substr(hyphen + 1U, slash - hyphen - 1U), result.end) ||
                !parseUnsigned(value.substr(slash + 1U), result.total) ||
                result.end < result.start || result.total == 0U || result.end >= result.total)
            {
                return std::nullopt;
            }
            return result;
        }

        [[nodiscard]] bool addressWasResolved(
            const RemoteNetworkAddress& connected,
            const std::vector<RemoteNetworkAddress>& resolved) noexcept
        {
            return std::find(resolved.begin(), resolved.end(), connected) != resolved.end();
        }

        struct ParsedResponseMetadata
        {
            std::optional<std::uint64_t> contentLength;
            std::optional<SignedRemoteContentRange> contentRange;
            std::optional<RepresentationValidator> validator;
            std::optional<std::uint64_t> retryAfterSeconds;
            std::string redirectLocation;
        };

        class ResponseHeaderValueWiper final
        {
        public:
            explicit ResponseHeaderValueWiper(std::vector<SignedRemoteHeader>& headers) noexcept
                : headers_(headers)
            {
            }
            ~ResponseHeaderValueWiper()
            {
                for (SignedRemoteHeader& header : headers_)
                {
                    secureErase(header.value);
                }
            }

            ResponseHeaderValueWiper(const ResponseHeaderValueWiper&) = delete;
            ResponseHeaderValueWiper& operator=(const ResponseHeaderValueWiper&) = delete;

        private:
            std::vector<SignedRemoteHeader>& headers_;
        };

        [[nodiscard]] bool parseResponseMetadata(
            const std::vector<SignedRemoteHeader>& headers,
            const std::string& providerId,
            const SignedRemoteTransportPolicy& policy,
            ParsedResponseMetadata& metadata)
        {
            std::size_t totalBytes = 0U;
            bool sawContentLength = false;
            bool sawContentRange = false;
            bool sawEtag = false;
            bool sawLastModified = false;
            bool sawRetryAfter = false;
            bool sawLocation = false;

            if (headers.size() > policy.maximumResponseHeaders)
            {
                return false;
            }
            for (const SignedRemoteHeader& header : headers)
            {
                if (header.name.empty() || header.name.size() > policy.maximumHeaderNameBytes ||
                    header.value.size() > policy.maximumHeaderValueBytes ||
                    header.name.size() + header.value.size() + 2U >
                        policy.maximumHeaderLineBytes ||
                    !std::all_of(header.name.begin(), header.name.end(), [](const unsigned char value)
                    {
                        return isHeaderNameCharacter(value);
                    }) ||
                    std::any_of(header.value.begin(), header.value.end(), [](const unsigned char value)
                    {
                        return value < 0x20U || value == 0x7fU || value > 0x7eU;
                    }))
                {
                    return false;
                }
                if (totalBytes > policy.maximumResponseHeaderBytes -
                    std::min(policy.maximumResponseHeaderBytes, header.name.size() +
                        header.value.size() + 4U))
                {
                    return false;
                }
                totalBytes += header.name.size() + header.value.size() + 4U;
                if (totalBytes > policy.maximumResponseHeaderBytes)
                {
                    return false;
                }

                const std::string name = lowerAscii(header.name);
                if (name == "content-length")
                {
                    if (sawContentLength || !parseUnsigned(header.value, metadata.contentLength.emplace()))
                    {
                        return false;
                    }
                    sawContentLength = true;
                }
                else if (name == "content-range")
                {
                    if (sawContentRange)
                    {
                        return false;
                    }
                    metadata.contentRange = parseContentRange(header.value);
                    if (!metadata.contentRange.has_value())
                    {
                        return false;
                    }
                    sawContentRange = true;
                }
                else if (name == "etag")
                {
                    if (sawEtag)
                    {
                        return false;
                    }
                    sawEtag = true;
                    RepresentationValidator validator{
                        providerId,
                        RepresentationValidatorKind::StrongEtag,
                        header.value};
                    if (isValidRepresentationValidator(validator))
                    {
                        metadata.validator = std::move(validator);
                    }
                }
                else if (name == "last-modified")
                {
                    if (sawLastModified)
                    {
                        return false;
                    }
                    sawLastModified = true;
                    if (!metadata.validator.has_value())
                    {
                        RepresentationValidator validator{
                            providerId,
                            RepresentationValidatorKind::LastModified,
                            header.value};
                        if (isValidRepresentationValidator(validator))
                        {
                            metadata.validator = std::move(validator);
                        }
                    }
                }
                else if (name == "retry-after")
                {
                    if (sawRetryAfter)
                    {
                        return false;
                    }
                    sawRetryAfter = true;
                    std::uint64_t seconds = 0;
                    if (parseUnsigned(header.value, seconds) && seconds <= 86400U)
                    {
                        metadata.retryAfterSeconds = seconds;
                    }
                }
                else if (name == "location")
                {
                    if (sawLocation)
                    {
                        return false;
                    }
                    sawLocation = true;
                    metadata.redirectLocation = header.value;
                }
            }
            return true;
        }

        [[nodiscard]] bool isRedirectStatus(std::uint16_t statusCode) noexcept
        {
            return statusCode == 301U || statusCode == 302U || statusCode == 303U ||
                statusCode == 307U || statusCode == 308U;
        }

        [[nodiscard]] SignedRemoteTransportOutcome outcomeForStatus(
            std::uint16_t statusCode) noexcept
        {
            switch (statusCode)
            {
            case 200U:
            case 206U:
                return SignedRemoteTransportOutcome::Success;
            case 401U:
                return SignedRemoteTransportOutcome::Unauthorized;
            case 403U:
                return SignedRemoteTransportOutcome::Forbidden;
            case 410U:
                return SignedRemoteTransportOutcome::Gone;
            case 416U:
                return SignedRemoteTransportOutcome::RangeNotSatisfiable;
            case 429U:
                return SignedRemoteTransportOutcome::RateLimited;
            default:
                return SignedRemoteTransportOutcome::ProtocolFailure;
            }
        }

        class ResponseReceiver final : public ISignedRemoteNetworkReceiver
        {
        public:
            ResponseReceiver(
                const ResolvedDownloadGrant& grant,
                const SignedRemoteDownloadRequest& request,
                const std::vector<RemoteNetworkAddress>& resolvedAddresses,
                SignedRemoteDownloadResponse& response,
                SignedRemoteChunkSink& chunkSink)
                : grant_(grant), request_(request), resolvedAddresses_(resolvedAddresses),
                  response_(response), chunkSink_(chunkSink)
            {
            }

            ~ResponseReceiver() override
            {
                secureErase(metadata_.redirectLocation);
            }

            bool onResponseHead(SignedRemoteNetworkResponseHead head) override
            {
                ResponseHeaderValueWiper headerWiper(head.headers);
                if (headReceived_)
                {
                    response_.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                    rejected_ = true;
                    return false;
                }
                headReceived_ = true;
                response_.statusCode = head.statusCode;

                if (!isPublicSignedRemoteAddress(head.connectedRemoteAddress) ||
                    !addressWasResolved(head.connectedRemoteAddress, resolvedAddresses_))
                {
                    response_.outcome = SignedRemoteTransportOutcome::RebindingRejected;
                    rejected_ = true;
                    return false;
                }
                if (!parseResponseMetadata(
                    head.headers,
                    grant_.representationProviderId,
                    request_.policy,
                    metadata_))
                {
                    response_.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                    rejected_ = true;
                    return false;
                }

                response_.contentLength = metadata_.contentLength;
                response_.contentRange = metadata_.contentRange;
                response_.validator = metadata_.validator;
                response_.retryAfterSeconds = metadata_.retryAfterSeconds;

                if (isRedirectStatus(head.statusCode))
                {
                    redirect_ = true;
                    if (metadata_.redirectLocation.empty())
                    {
                        response_.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                        rejected_ = true;
                        return false;
                    }
                    return false;
                }

                response_.outcome = outcomeForStatus(head.statusCode);
                if (response_.outcome == SignedRemoteTransportOutcome::ProtocolFailure)
                {
                    rejected_ = true;
                    return false;
                }

                if (head.statusCode == 206U)
                {
                    if (!request_.rangeStart.has_value() || !metadata_.contentRange.has_value() ||
                        metadata_.contentRange->start != *request_.rangeStart ||
                        metadata_.contentRange->total != grant_.expectedSize)
                    {
                        response_.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                        rejected_ = true;
                        return false;
                    }
                    const std::uint64_t span = metadata_.contentRange->end -
                        metadata_.contentRange->start + 1U;
                    if (metadata_.contentLength.has_value() && *metadata_.contentLength != span)
                    {
                        response_.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                        rejected_ = true;
                        return false;
                    }
                    maximumBodyBytes_ = span;
                    const bool validatorMatches = request_.ifMatch.has_value() &&
                        metadata_.validator.has_value() &&
                        metadata_.validator->providerId == request_.ifMatch->providerId &&
                        metadata_.validator->kind == RepresentationValidatorKind::StrongEtag &&
                        request_.ifMatch->kind == metadata_.validator->kind &&
                        request_.ifMatch->value == metadata_.validator->value;
                    const bool hashBoundExternalRange =
                        !grant_.conditionalRequestsSupported &&
                        grant_.rangeSupported &&
                        !request_.ifMatch.has_value();
                    bodyAllowed_ = request_.method == SignedRemoteHttpMethod::Get &&
                        request_.target.kind == SignedRemoteTargetKind::Primary &&
                        (validatorMatches || hashBoundExternalRange);
                }
                else if (head.statusCode == 200U && !request_.rangeStart.has_value())
                {
                    maximumBodyBytes_ = grant_.expectedSize;
                    if (request_.method == SignedRemoteHttpMethod::Get &&
                        metadata_.contentLength.has_value() &&
                        *metadata_.contentLength != maximumBodyBytes_)
                    {
                        response_.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                        rejected_ = true;
                        return false;
                    }
                    bodyAllowed_ = request_.method == SignedRemoteHttpMethod::Get;
                }
                // A ranged request answered with 200 is intentionally drained/discarded.
                // The representation helper instructs the caller to restart; appending
                // these bytes would corrupt the partial file.
                return bodyAllowed_;
            }

            bool onBodyChunk(std::span<const std::byte> chunk) override
            {
                if (!headReceived_ || rejected_ || redirect_ ||
                    chunk.size() > request_.policy.maximumChunkBytes)
                {
                    response_.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                    rejected_ = true;
                    return false;
                }
                if (!bodyAllowed_)
                {
                    return true;
                }
                if (response_.bytesStreamed > maximumBodyBytes_ ||
                    chunk.size() > maximumBodyBytes_ - response_.bytesStreamed)
                {
                    response_.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                    rejected_ = true;
                    return false;
                }
                if (chunkSink_ && !chunkSink_(chunk))
                {
                    response_.outcome = SignedRemoteTransportOutcome::Cancelled;
                    rejected_ = true;
                    return false;
                }
                response_.bytesStreamed += chunk.size();
                return true;
            }

            [[nodiscard]] bool headReceived() const noexcept { return headReceived_; }
            [[nodiscard]] bool rejected() const noexcept { return rejected_; }
            [[nodiscard]] bool redirect() const noexcept { return redirect_; }
            [[nodiscard]] const std::string& redirectLocation() const noexcept
            {
                return metadata_.redirectLocation;
            }

            [[nodiscard]] bool bodyLengthMatches() const noexcept
            {
                return !bodyAllowed_ || response_.bytesStreamed == maximumBodyBytes_;
            }

        private:
            const ResolvedDownloadGrant& grant_;
            const SignedRemoteDownloadRequest& request_;
            const std::vector<RemoteNetworkAddress>& resolvedAddresses_;
            SignedRemoteDownloadResponse& response_;
            SignedRemoteChunkSink& chunkSink_;
            ParsedResponseMetadata metadata_;
            std::uint64_t maximumBodyBytes_{0};
            bool headReceived_{false};
            bool bodyAllowed_{false};
            bool redirect_{false};
            bool rejected_{false};
        };

        [[nodiscard]] const std::string* selectTargetUrl(
            const ResolvedDownloadGrant& grant,
            const SignedRemoteTarget& target) noexcept
        {
            switch (target.kind)
            {
            case SignedRemoteTargetKind::Head:
                return target.fallbackIndex == 0U ? &grant.headUrl : nullptr;
            case SignedRemoteTargetKind::Primary:
                return target.fallbackIndex == 0U ? &grant.primaryUrl : nullptr;
            case SignedRemoteTargetKind::Fallback:
                return target.fallbackIndex < grant.fallbackUrls.size()
                    ? &grant.fallbackUrls[target.fallbackIndex]
                    : nullptr;
            }
            return nullptr;
        }

        [[nodiscard]] bool isValidTransportRequest(
            const ResolvedDownloadGrant& grant,
            const SignedRemoteDownloadRequest& request) noexcept
        {
            if (!isCanonicalRemoteDownloadProviderId(grant.providerId) ||
                !isCanonicalRemoteDownloadProviderId(grant.representationProviderId) ||
                !isValidRemoteDownloadStableId(grant.artifactId) ||
                !isValidRemoteDownloadStableId(grant.grantId) ||
                grant.expectedSize == 0U || !isCanonicalRemoteDownloadSha256(grant.expectedSha256) ||
                !grant.transportHeaders.empty() || !isValidPolicy(request.policy) ||
                !isValidOperationId(request.operationId) || request.operationId != grant.operationId ||
                selectTargetUrl(grant, request.target) == nullptr)
            {
                return false;
            }
            if (request.method == SignedRemoteHttpMethod::Head)
            {
                return grant.headSupported &&
                    request.target.kind == SignedRemoteTargetKind::Head &&
                    !request.rangeStart.has_value() && !request.ifMatch.has_value();
            }
            if (request.target.kind == SignedRemoteTargetKind::Head)
            {
                return false;
            }
            if (request.rangeStart.has_value())
            {
                if (*request.rangeStart >= grant.expectedSize || !grant.rangeSupported)
                {
                    return false;
                }
                if (!grant.conditionalRequestsSupported)
                {
                    return !request.ifMatch.has_value();
                }
                return request.ifMatch.has_value() &&
                    request.ifMatch->providerId == grant.representationProviderId &&
                    request.ifMatch->kind == RepresentationValidatorKind::StrongEtag &&
                    isValidRepresentationValidator(*request.ifMatch);
            }
            return !request.ifMatch.has_value();
        }

        [[nodiscard]] SignedRemoteTransportOutcome mapNetworkOutcome(
            SignedRemoteNetworkOutcome outcome) noexcept
        {
            switch (outcome)
            {
            case SignedRemoteNetworkOutcome::Completed:
                return SignedRemoteTransportOutcome::Success;
            case SignedRemoteNetworkOutcome::ResolveFailure:
                return SignedRemoteTransportOutcome::DnsFailure;
            case SignedRemoteNetworkOutcome::Timeout:
                return SignedRemoteTransportOutcome::Timeout;
            case SignedRemoteNetworkOutcome::Cancelled:
                return SignedRemoteTransportOutcome::Cancelled;
            case SignedRemoteNetworkOutcome::ConnectFailure:
            case SignedRemoteNetworkOutcome::SendFailure:
            case SignedRemoteNetworkOutcome::ReceiveFailure:
                return SignedRemoteTransportOutcome::NetworkFailure;
            }
            return SignedRemoteTransportOutcome::NetworkFailure;
        }

        class UnavailableResolver final : public ISignedRemoteAddressResolver
        {
        public:
            SignedRemoteResolution resolve(
                std::string_view,
                std::uint16_t,
                std::chrono::steady_clock::time_point,
                std::wstring_view,
                const IRemoteDownloadCancellation&) override
            {
                return {};
            }
        };

        class UnavailableNetworkAdapter final : public ISignedRemoteNetworkAdapter
        {
        public:
            SignedRemoteNetworkOutcome execute(
                const SignedRemoteNetworkRequest&,
                ISignedRemoteNetworkReceiver&,
                const IRemoteDownloadCancellation&) override
            {
                return SignedRemoteNetworkOutcome::ConnectFailure;
            }
        };

#ifdef _WIN32
        class WindowsHandle final
        {
        public:
            explicit WindowsHandle(HANDLE handle = nullptr) noexcept : handle_(handle) {}
            ~WindowsHandle()
            {
                if (handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE)
                {
                    CloseHandle(handle_);
                }
            }

            WindowsHandle(const WindowsHandle&) = delete;
            WindowsHandle& operator=(const WindowsHandle&) = delete;

            [[nodiscard]] HANDLE get() const noexcept { return handle_; }
            [[nodiscard]] bool valid() const noexcept
            {
                return handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE;
            }

        private:
            HANDLE handle_;
        };

        class WinHttpHandle final
        {
        public:
            explicit WinHttpHandle(HINTERNET handle = nullptr) noexcept : handle_(handle) {}
            ~WinHttpHandle()
            {
                if (handle_ != nullptr)
                {
                    WinHttpCloseHandle(handle_);
                }
            }

            WinHttpHandle(const WinHttpHandle&) = delete;
            WinHttpHandle& operator=(const WinHttpHandle&) = delete;

            [[nodiscard]] HINTERNET get() const noexcept { return handle_; }
            [[nodiscard]] bool valid() const noexcept { return handle_ != nullptr; }

        private:
            HINTERNET handle_;
        };

        class WinsockRuntime final
        {
        public:
            WinsockRuntime()
            {
                WSADATA data{};
                ready_ = WSAStartup(MAKEWORD(2, 2), &data) == 0;
            }

            ~WinsockRuntime()
            {
                if (ready_)
                {
                    WSACleanup();
                }
            }

            [[nodiscard]] bool ready() const noexcept { return ready_; }

        private:
            bool ready_{false};
        };

        [[nodiscard]] WinsockRuntime& winsockRuntime()
        {
            static WinsockRuntime runtime;
            return runtime;
        }

        [[nodiscard]] std::wstring widenAscii(std::string_view value)
        {
            std::wstring result;
            result.reserve(value.size());
            for (const unsigned char character : value)
            {
                if (character > 0x7eU || isAsciiControlOrSpace(character))
                {
                    return {};
                }
                result.push_back(static_cast<wchar_t>(character));
            }
            return result;
        }

        [[nodiscard]] bool narrowAscii(std::wstring_view value, std::string& result)
        {
            result.clear();
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                if (character < 0x20 || character > 0x7e)
                {
                    result.clear();
                    return false;
                }
                result.push_back(static_cast<char>(character));
            }
            return true;
        }

        [[nodiscard]] DWORD timeoutMilliseconds(std::chrono::milliseconds timeout) noexcept
        {
            return static_cast<DWORD>(std::clamp<std::int64_t>(
                timeout.count(), 1, static_cast<std::int64_t>(MAXDWORD)));
        }

        [[nodiscard]] int boundedTimeoutMilliseconds(
            std::chrono::milliseconds phaseTimeout,
            std::chrono::steady_clock::time_point deadline) noexcept
        {
            const auto now = std::chrono::steady_clock::now();
            if (now >= deadline)
            {
                return 0;
            }
            const auto remaining = std::max(
                std::chrono::milliseconds(1),
                std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now));
            return static_cast<int>(timeoutMilliseconds(std::min(phaseTimeout, remaining)));
        }

        [[nodiscard]] bool setBoundedWinHttpTimeouts(
            HINTERNET handle,
            const SignedRemoteTransportTimeouts& timeouts,
            std::chrono::steady_clock::time_point deadline) noexcept
        {
            const int resolve = boundedTimeoutMilliseconds(timeouts.resolve, deadline);
            const int connect = boundedTimeoutMilliseconds(timeouts.connect, deadline);
            const int send = boundedTimeoutMilliseconds(timeouts.send, deadline);
            const int receive = boundedTimeoutMilliseconds(timeouts.receive, deadline);
            return resolve > 0 && connect > 0 && send > 0 && receive > 0 &&
                WinHttpSetTimeouts(handle, resolve, connect, send, receive) != FALSE;
        }

        [[nodiscard]] std::optional<RemoteNetworkAddress> fromSockaddr(
            const SOCKADDR* socketAddress,
            int socketAddressLength,
            std::uint16_t fallbackPort) noexcept
        {
            if (socketAddress == nullptr)
            {
                return std::nullopt;
            }
            RemoteNetworkAddress result;
            if (socketAddress->sa_family == AF_INET &&
                socketAddressLength >= static_cast<int>(sizeof(SOCKADDR_IN)))
            {
                const auto* ipv4 = reinterpret_cast<const SOCKADDR_IN*>(socketAddress);
                result.family = RemoteNetworkAddressFamily::Ipv4;
                std::copy_n(
                    reinterpret_cast<const std::uint8_t*>(&ipv4->sin_addr),
                    4U,
                    result.bytes.begin());
                result.port = ipv4->sin_port == 0U ? fallbackPort : ntohs(ipv4->sin_port);
                return result;
            }
            if (socketAddress->sa_family == AF_INET6 &&
                socketAddressLength >= static_cast<int>(sizeof(SOCKADDR_IN6)))
            {
                const auto* ipv6 = reinterpret_cast<const SOCKADDR_IN6*>(socketAddress);
                result.family = RemoteNetworkAddressFamily::Ipv6;
                std::copy_n(
                    reinterpret_cast<const std::uint8_t*>(&ipv6->sin6_addr),
                    result.bytes.size(),
                    result.bytes.begin());
                result.port = ipv6->sin6_port == 0U ? fallbackPort : ntohs(ipv6->sin6_port);
                return result;
            }
            return std::nullopt;
        }

        class SystemSignedRemoteAddressResolver final : public ISignedRemoteAddressResolver
        {
        public:
            SignedRemoteResolution resolve(
                std::string_view host,
                std::uint16_t port,
                std::chrono::steady_clock::time_point deadline,
                std::wstring_view operationId,
                const IRemoteDownloadCancellation& cancellation) override
            {
                (void)operationId;
                SignedRemoteResolution result;
                if (!winsockRuntime().ready())
                {
                    return result;
                }
                if (cancellation.isCancellationRequested())
                {
                    result.outcome = SignedRemoteResolveOutcome::Cancelled;
                    return result;
                }
                if (std::chrono::steady_clock::now() >= deadline)
                {
                    result.outcome = SignedRemoteResolveOutcome::Timeout;
                    return result;
                }

                const std::wstring wideHost = widenAscii(host);
                if (wideHost.empty())
                {
                    return result;
                }

                ADDRINFOEXW hints{};
                hints.ai_family = AF_UNSPEC;
                hints.ai_socktype = SOCK_STREAM;
                hints.ai_protocol = IPPROTO_TCP;
                OVERLAPPED overlapped{};
                WindowsHandle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
                if (!event.valid())
                {
                    return result;
                }
                overlapped.hEvent = event.get();
                PADDRINFOEXW addressInfo = nullptr;
                HANDLE cancellationHandle = nullptr;
                int error = GetAddrInfoExW(
                    wideHost.c_str(),
                    nullptr,
                    NS_DNS,
                    nullptr,
                    &hints,
                    &addressInfo,
                    nullptr,
                    &overlapped,
                    nullptr,
                    &cancellationHandle);
                if (error == WSA_IO_PENDING)
                {
                    for (;;)
                    {
                        const DWORD waitResult = WaitForSingleObject(event.get(), 25U);
                        if (waitResult == WAIT_OBJECT_0)
                        {
                            error = GetAddrInfoExOverlappedResult(&overlapped);
                            break;
                        }
                        if (waitResult != WAIT_TIMEOUT)
                        {
                            (void)GetAddrInfoExCancel(&cancellationHandle);
                            (void)WaitForSingleObject(event.get(), INFINITE);
                            error = WSAEINVAL;
                            break;
                        }
                        const bool cancelled = cancellation.isCancellationRequested();
                        const bool timedOut = std::chrono::steady_clock::now() >= deadline;
                        if (cancelled || timedOut)
                        {
                            (void)GetAddrInfoExCancel(&cancellationHandle);
                            (void)WaitForSingleObject(event.get(), INFINITE);
                            error = GetAddrInfoExOverlappedResult(&overlapped);
                            if (addressInfo != nullptr)
                            {
                                FreeAddrInfoExW(addressInfo);
                                addressInfo = nullptr;
                            }
                            result.outcome = cancelled
                                ? SignedRemoteResolveOutcome::Cancelled
                                : SignedRemoteResolveOutcome::Timeout;
                            return result;
                        }
                    }
                }

                if (error != 0)
                {
                    if (addressInfo != nullptr)
                    {
                        FreeAddrInfoExW(addressInfo);
                    }
                    return result;
                }
                for (PADDRINFOEXW cursor = addressInfo; cursor != nullptr; cursor = cursor->ai_next)
                {
                    const std::optional<RemoteNetworkAddress> address = fromSockaddr(
                        cursor->ai_addr,
                        static_cast<int>(cursor->ai_addrlen),
                        port);
                    if (address.has_value() && std::find(
                        result.addresses.begin(), result.addresses.end(), *address) ==
                        result.addresses.end())
                    {
                        result.addresses.push_back(*address);
                    }
                }
                if (addressInfo != nullptr)
                {
                    FreeAddrInfoExW(addressInfo);
                }
                result.outcome = result.addresses.empty()
                    ? SignedRemoteResolveOutcome::Failure
                    : SignedRemoteResolveOutcome::Success;
                return result;
            }
        };

        [[nodiscard]] SignedRemoteNetworkOutcome winHttpFailureOutcome(
            SignedRemoteNetworkOutcome stage,
            const IRemoteDownloadCancellation& cancellation,
            std::chrono::steady_clock::time_point deadline) noexcept
        {
            const DWORD error = GetLastError();
            if (cancellation.isCancellationRequested() ||
                error == ERROR_WINHTTP_OPERATION_CANCELLED)
            {
                return SignedRemoteNetworkOutcome::Cancelled;
            }
            if (std::chrono::steady_clock::now() >= deadline ||
                error == ERROR_WINHTTP_TIMEOUT)
            {
                return SignedRemoteNetworkOutcome::Timeout;
            }
            return stage;
        }

        [[nodiscard]] bool parseRawWinHttpHeaders(
            HINTERNET request,
            const SignedRemoteTransportPolicy& policy,
            std::vector<SignedRemoteHeader>& headers)
        {
            DWORD bytes = 0U;
            SetLastError(ERROR_SUCCESS);
            if (WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_RAW_HEADERS_CRLF,
                WINHTTP_HEADER_NAME_BY_INDEX,
                WINHTTP_NO_OUTPUT_BUFFER,
                &bytes,
                WINHTTP_NO_HEADER_INDEX) ||
                GetLastError() != ERROR_INSUFFICIENT_BUFFER || bytes == 0U ||
                bytes > (policy.maximumResponseHeaderBytes + 1U) * sizeof(wchar_t))
            {
                return false;
            }
            EphemeralWideString ephemeralRaw(
                std::wstring(bytes / sizeof(wchar_t), L'\0'));
            std::wstring& raw = ephemeralRaw.get();
            if (!WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_RAW_HEADERS_CRLF,
                WINHTTP_HEADER_NAME_BY_INDEX,
                raw.data(),
                &bytes,
                WINHTTP_NO_HEADER_INDEX))
            {
                return false;
            }
            raw.resize(std::char_traits<wchar_t>::length(raw.c_str()));
            if (raw.size() > policy.maximumResponseHeaderBytes)
            {
                return false;
            }

            std::size_t lineStart = 0U;
            std::size_t lineNumber = 0U;
            std::size_t headerCount = 0U;
            while (lineStart < raw.size())
            {
                const std::size_t lineEnd = raw.find(L"\r\n", lineStart);
                if (lineEnd == std::wstring::npos)
                {
                    return false;
                }
                const std::wstring_view line(raw.data() + lineStart, lineEnd - lineStart);
                lineStart = lineEnd + 2U;
                if (line.empty())
                {
                    break;
                }
                if (line.size() > policy.maximumHeaderLineBytes)
                {
                    return false;
                }
                if (lineNumber++ == 0U)
                {
                    continue;
                }
                if (++headerCount > policy.maximumResponseHeaders ||
                    line.front() == L' ' || line.front() == L'\t')
                {
                    return false;
                }
                const std::size_t colon = line.find(L':');
                if (colon == std::wstring_view::npos || colon == 0U)
                {
                    return false;
                }
                std::wstring_view value = line.substr(colon + 1U);
                while (!value.empty() && (value.front() == L' ' || value.front() == L'\t'))
                {
                    value.remove_prefix(1U);
                }
                while (!value.empty() && (value.back() == L' ' || value.back() == L'\t'))
                {
                    value.remove_suffix(1U);
                }
                std::string name;
                std::string narrowValue;
                if (!narrowAscii(line.substr(0U, colon), name) ||
                    !narrowAscii(value, narrowValue))
                {
                    return false;
                }
                const std::string canonicalName = lowerAscii(name);
                if (canonicalName == "content-length" || canonicalName == "content-range" ||
                    canonicalName == "etag" || canonicalName == "last-modified" ||
                    canonicalName == "retry-after" || canonicalName == "location")
                {
                    headers.push_back({std::move(name), std::move(narrowValue)});
                }
            }
            return lineNumber > 0U;
        }

        [[nodiscard]] std::optional<RemoteNetworkAddress> connectedWinHttpAddress(
            HINTERNET request) noexcept
        {
            WINHTTP_CONNECTION_INFO connectionInfo{};
            DWORD bytes = sizeof(connectionInfo);
            if (!WinHttpQueryOption(
                request, WINHTTP_OPTION_CONNECTION_INFO, &connectionInfo, &bytes))
            {
                return std::nullopt;
            }
            const auto* remote = reinterpret_cast<const SOCKADDR*>(&connectionInfo.RemoteAddress);
            return fromSockaddr(remote, sizeof(connectionInfo.RemoteAddress), 0U);
        }

        [[nodiscard]] bool isAllowedAdapterHeader(const SignedRemoteHeader& header) noexcept
        {
            if (header.name == "Range")
            {
                constexpr std::string_view prefix = "bytes=";
                if (!header.value.starts_with(prefix) || !header.value.ends_with('-'))
                {
                    return false;
                }
                std::uint64_t offset = 0U;
                return parseUnsigned(std::string_view(header.value).substr(
                    prefix.size(), header.value.size() - prefix.size() - 1U), offset);
            }
            if (header.name == "If-Match")
            {
                RepresentationValidator validator{
                    "adapter-validation",
                    RepresentationValidatorKind::StrongEtag,
                    header.value};
                return isValidRepresentationValidator(validator);
            }
            return false;
        }

        class WinHttpSignedRemoteNetworkAdapter final : public ISignedRemoteNetworkAdapter
        {
        public:
            SignedRemoteNetworkOutcome execute(
                const SignedRemoteNetworkRequest& request,
                ISignedRemoteNetworkReceiver& receiver,
                const IRemoteDownloadCancellation& cancellation) override
            {
                if (cancellation.isCancellationRequested())
                {
                    return SignedRemoteNetworkOutcome::Cancelled;
                }
                if (std::chrono::steady_clock::now() >= request.deadline)
                {
                    return SignedRemoteNetworkOutcome::Timeout;
                }
                if (request.headers.size() > 2U ||
                    std::any_of(request.headers.begin(), request.headers.end(),
                        [](const SignedRemoteHeader& header)
                        {
                            return !isAllowedAdapterHeader(header);
                        }) ||
                    std::count_if(request.headers.begin(), request.headers.end(),
                        [](const SignedRemoteHeader& header) { return header.name == "Range"; }) > 1 ||
                    std::count_if(request.headers.begin(), request.headers.end(),
                        [](const SignedRemoteHeader& header) { return header.name == "If-Match"; }) > 1)
                {
                    return SignedRemoteNetworkOutcome::SendFailure;
                }
                const bool hasRange = std::any_of(
                    request.headers.begin(), request.headers.end(),
                    [](const SignedRemoteHeader& header) { return header.name == "Range"; });
                const bool hasIfMatch = std::any_of(
                    request.headers.begin(), request.headers.end(),
                    [](const SignedRemoteHeader& header) { return header.name == "If-Match"; });
                if ((request.method == SignedRemoteHttpMethod::Head &&
                        !request.headers.empty()) ||
                    (request.method == SignedRemoteHttpMethod::Get &&
                        hasRange != hasIfMatch))
                {
                    return SignedRemoteNetworkOutcome::SendFailure;
                }

                const std::wstring host = widenAscii(request.host);
                EphemeralWideString pathAndQuery(widenAscii(request.pathAndQuery));
                if (host.empty() || pathAndQuery.get().empty())
                {
                    return SignedRemoteNetworkOutcome::SendFailure;
                }

                WinHttpHandle session(WinHttpOpen(
                    L"Fluxora signed-storage transport/1",
                    WINHTTP_ACCESS_TYPE_NO_PROXY,
                    WINHTTP_NO_PROXY_NAME,
                    WINHTTP_NO_PROXY_BYPASS,
                    0U));
                if (!session.valid())
                {
                    return SignedRemoteNetworkOutcome::ConnectFailure;
                }
                DWORD secureProtocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 |
                    WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
                if (!WinHttpSetOption(session.get(), WINHTTP_OPTION_SECURE_PROTOCOLS,
                        &secureProtocols, sizeof(secureProtocols)))
                {
                    secureProtocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2;
                    if (!WinHttpSetOption(session.get(), WINHTTP_OPTION_SECURE_PROTOCOLS,
                            &secureProtocols, sizeof(secureProtocols)))
                    {
                        return SignedRemoteNetworkOutcome::ConnectFailure;
                    }
                }
                BOOL allowInsecureTlsFallback = FALSE;
                (void)WinHttpSetOption(
                    session.get(),
                    WINHTTP_OPTION_TLS_PROTOCOL_INSECURE_FALLBACK,
                    &allowInsecureTlsFallback,
                    sizeof(allowInsecureTlsFallback));
                if (!setBoundedWinHttpTimeouts(
                    session.get(), request.timeouts, request.deadline))
                {
                    return SignedRemoteNetworkOutcome::ConnectFailure;
                }

                WinHttpHandle connection(WinHttpConnect(
                    session.get(), host.c_str(), request.port, 0U));
                if (!connection.valid())
                {
                    return winHttpFailureOutcome(
                        SignedRemoteNetworkOutcome::ConnectFailure, cancellation, request.deadline);
                }
                const wchar_t* method = request.method == SignedRemoteHttpMethod::Head
                    ? L"HEAD"
                    : L"GET";
                WinHttpHandle httpRequest(WinHttpOpenRequest(
                    connection.get(),
                    method,
                    pathAndQuery.get().c_str(),
                    nullptr,
                    WINHTTP_NO_REFERER,
                    WINHTTP_DEFAULT_ACCEPT_TYPES,
                    WINHTTP_FLAG_SECURE | WINHTTP_FLAG_REFRESH | WINHTTP_FLAG_ESCAPE_DISABLE));
                if (!httpRequest.valid())
                {
                    return SignedRemoteNetworkOutcome::SendFailure;
                }

                DWORD disabledFeatures = WINHTTP_DISABLE_COOKIES |
                    WINHTTP_DISABLE_REDIRECTS | WINHTTP_DISABLE_AUTHENTICATION;
                DWORD redirectPolicy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
                DWORD autoLogonPolicy = WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH;
                DWORD rejectUserPassword = TRUE;
                if (!WinHttpSetOption(httpRequest.get(), WINHTTP_OPTION_DISABLE_FEATURE,
                        &disabledFeatures, sizeof(disabledFeatures)) ||
                    !WinHttpSetOption(httpRequest.get(), WINHTTP_OPTION_REDIRECT_POLICY,
                        &redirectPolicy, sizeof(redirectPolicy)) ||
                    !WinHttpSetOption(httpRequest.get(), WINHTTP_OPTION_AUTOLOGON_POLICY,
                        &autoLogonPolicy, sizeof(autoLogonPolicy)) ||
                    !WinHttpSetOption(httpRequest.get(), WINHTTP_OPTION_REJECT_USERPWD_IN_URL,
                        &rejectUserPassword, sizeof(rejectUserPassword)))
                {
                    return SignedRemoteNetworkOutcome::SendFailure;
                }

                for (const SignedRemoteHeader& header : request.headers)
                {
                    const std::wstring wideName = widenAscii(header.name);
                    const std::wstring wideValue = widenAscii(header.value);
                    if (wideName.empty() || wideValue.empty())
                    {
                        return SignedRemoteNetworkOutcome::SendFailure;
                    }
                    const std::wstring line = wideName + L": " + wideValue;
                    if (!WinHttpAddRequestHeaders(
                        httpRequest.get(),
                        line.c_str(),
                        static_cast<DWORD>(line.size()),
                        WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE))
                    {
                        return SignedRemoteNetworkOutcome::SendFailure;
                    }
                }
                if (!setBoundedWinHttpTimeouts(
                    httpRequest.get(), request.timeouts, request.deadline))
                {
                    return winHttpFailureOutcome(
                        SignedRemoteNetworkOutcome::SendFailure, cancellation, request.deadline);
                }
                if (!WinHttpSendRequest(
                    httpRequest.get(),
                    WINHTTP_NO_ADDITIONAL_HEADERS,
                    0U,
                    WINHTTP_NO_REQUEST_DATA,
                    0U,
                    0U,
                    0U))
                {
                    return winHttpFailureOutcome(
                        SignedRemoteNetworkOutcome::SendFailure, cancellation, request.deadline);
                }
                if (!setBoundedWinHttpTimeouts(
                    httpRequest.get(), request.timeouts, request.deadline))
                {
                    return winHttpFailureOutcome(
                        SignedRemoteNetworkOutcome::ReceiveFailure, cancellation, request.deadline);
                }
                if (!WinHttpReceiveResponse(httpRequest.get(), nullptr))
                {
                    return winHttpFailureOutcome(
                        SignedRemoteNetworkOutcome::ReceiveFailure, cancellation, request.deadline);
                }
                if (cancellation.isCancellationRequested())
                {
                    return SignedRemoteNetworkOutcome::Cancelled;
                }
                if (std::chrono::steady_clock::now() >= request.deadline)
                {
                    return SignedRemoteNetworkOutcome::Timeout;
                }

                DWORD statusCode = 0U;
                DWORD statusBytes = sizeof(statusCode);
                if (!WinHttpQueryHeaders(
                    httpRequest.get(),
                    WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                    WINHTTP_HEADER_NAME_BY_INDEX,
                    &statusCode,
                    &statusBytes,
                    WINHTTP_NO_HEADER_INDEX) || statusCode > 999U)
                {
                    return SignedRemoteNetworkOutcome::ReceiveFailure;
                }
                const std::optional<RemoteNetworkAddress> connected =
                    connectedWinHttpAddress(httpRequest.get());
                if (!connected.has_value())
                {
                    return SignedRemoteNetworkOutcome::ReceiveFailure;
                }
                SignedRemoteNetworkResponseHead head;
                head.statusCode = static_cast<std::uint16_t>(statusCode);
                head.connectedRemoteAddress = *connected;
                if (!parseRawWinHttpHeaders(httpRequest.get(), request.policy, head.headers))
                {
                    return SignedRemoteNetworkOutcome::ReceiveFailure;
                }
                if (!receiver.onResponseHead(std::move(head)))
                {
                    return cancellation.isCancellationRequested()
                        ? SignedRemoteNetworkOutcome::Cancelled
                        : SignedRemoteNetworkOutcome::Completed;
                }

                if (request.method == SignedRemoteHttpMethod::Head)
                {
                    return SignedRemoteNetworkOutcome::Completed;
                }
                std::vector<std::byte> buffer(64U * 1024U);
                for (;;)
                {
                    if (cancellation.isCancellationRequested())
                    {
                        return SignedRemoteNetworkOutcome::Cancelled;
                    }
                    if (std::chrono::steady_clock::now() >= request.deadline)
                    {
                        return SignedRemoteNetworkOutcome::Timeout;
                    }
                    if (!setBoundedWinHttpTimeouts(
                        httpRequest.get(), request.timeouts, request.deadline))
                    {
                        return winHttpFailureOutcome(
                            SignedRemoteNetworkOutcome::ReceiveFailure,
                            cancellation,
                            request.deadline);
                    }
                    DWORD bytesRead = 0U;
                    if (!WinHttpReadData(
                        httpRequest.get(),
                        buffer.data(),
                        static_cast<DWORD>(buffer.size()),
                        &bytesRead))
                    {
                        return winHttpFailureOutcome(
                            SignedRemoteNetworkOutcome::ReceiveFailure,
                            cancellation,
                            request.deadline);
                    }
                    if (bytesRead == 0U)
                    {
                        return SignedRemoteNetworkOutcome::Completed;
                    }
                    if (!receiver.onBodyChunk(std::span<const std::byte>(
                        buffer.data(), bytesRead)))
                    {
                        return cancellation.isCancellationRequested()
                            ? SignedRemoteNetworkOutcome::Cancelled
                            : SignedRemoteNetworkOutcome::ReceiveFailure;
                    }
                }
            }
        };
#endif
    }

    SignedRemoteDownloadTransport::SignedRemoteDownloadTransport(
        ISignedRemoteAddressResolver& resolver,
        ISignedRemoteNetworkAdapter& network)
        : resolver_(resolver), network_(network)
    {
    }

    SignedRemoteDownloadResponse SignedRemoteDownloadTransport::execute(
        const ResolvedDownloadGrant& grant,
        const SignedRemoteDownloadRequest& request,
        const IRemoteDownloadCancellation& cancellation,
        SignedRemoteChunkSink chunkSink)
    {
        SignedRemoteDownloadResponse response;
        response.providerId = grant.providerId;
        response.representationProviderId = grant.representationProviderId;
        response.method = request.method;
        response.target = request.target;
        response.operationId = request.operationId;

        if (!isValidTransportRequest(grant, request))
        {
            response.outcome = SignedRemoteTransportOutcome::UnsafeRequest;
            return response;
        }
        if (cancellation.isCancellationRequested())
        {
            response.outcome = SignedRemoteTransportOutcome::Cancelled;
            return response;
        }

        const std::string* selectedUrl = selectTargetUrl(grant, request.target);
        EphemeralString currentUrl(*selectedUrl);
        std::vector<EphemeralString> visited;
        const auto deadline = std::chrono::steady_clock::now() + request.policy.timeouts.overall;

        for (;;)
        {
            if (cancellation.isCancellationRequested())
            {
                response.outcome = SignedRemoteTransportOutcome::Cancelled;
                return response;
            }
            const auto now = std::chrono::steady_clock::now();
            if (now >= deadline)
            {
                response.outcome = SignedRemoteTransportOutcome::Timeout;
                return response;
            }

            std::optional<ParsedSignedUrl> parsed = parseSignedUrl(
                currentUrl.get(), request.policy.maximumUrlBytes);
            if (!parsed.has_value())
            {
                response.outcome = SignedRemoteTransportOutcome::UnsafeRequest;
                return response;
            }
            if (std::any_of(visited.begin(), visited.end(), [&](const EphemeralString& prior)
                {
                    return prior.get() == currentUrl.get();
                }))
            {
                response.outcome = SignedRemoteTransportOutcome::RedirectLoop;
                return response;
            }
            visited.emplace_back(currentUrl.get());

            const auto resolveDeadline = std::min(deadline, now + request.policy.timeouts.resolve);
            SignedRemoteResolution resolution = resolver_.resolve(
                parsed->host,
                parsed->port,
                resolveDeadline,
                request.operationId,
                cancellation);
            if (resolution.outcome != SignedRemoteResolveOutcome::Success)
            {
                response.outcome = resolution.outcome == SignedRemoteResolveOutcome::Cancelled
                    ? SignedRemoteTransportOutcome::Cancelled
                    : resolution.outcome == SignedRemoteResolveOutcome::Timeout
                        ? SignedRemoteTransportOutcome::Timeout
                        : SignedRemoteTransportOutcome::DnsFailure;
                return response;
            }
            if (resolution.addresses.empty() ||
                std::any_of(resolution.addresses.begin(), resolution.addresses.end(),
                    [](const RemoteNetworkAddress& address)
                    {
                        return !isPublicSignedRemoteAddress(address);
                    }))
            {
                response.outcome = SignedRemoteTransportOutcome::UnsafeAddress;
                return response;
            }
            if (std::any_of(resolution.addresses.begin(), resolution.addresses.end(),
                [&](const RemoteNetworkAddress& address)
                {
                    return address.port != parsed->port;
                }))
            {
                response.outcome = SignedRemoteTransportOutcome::DnsFailure;
                return response;
            }

            SignedRemoteNetworkRequest networkRequest;
            networkRequest.method = request.method;
            networkRequest.host = parsed->host;
            networkRequest.port = parsed->port;
            networkRequest.pathAndQuery = parsed->pathAndQuery;
            networkRequest.resolvedAddresses = resolution.addresses;
            networkRequest.timeouts = request.policy.timeouts;
            networkRequest.policy = request.policy;
            networkRequest.deadline = deadline;
            networkRequest.operationId = request.operationId;
            if (request.rangeStart.has_value())
            {
                networkRequest.headers.push_back({
                    "Range", "bytes=" + std::to_string(*request.rangeStart) + "-"});
                if (request.ifMatch.has_value())
                {
                    networkRequest.headers.push_back({"If-Match", request.ifMatch->value});
                }
            }

            response.statusCode = 0U;
            response.contentLength.reset();
            response.contentRange.reset();
            response.validator.reset();
            response.retryAfterSeconds.reset();
            response.bytesStreamed = 0U;
            ResponseReceiver receiver(grant, request, resolution.addresses, response, chunkSink);
            const SignedRemoteNetworkOutcome networkOutcome = network_.execute(
                networkRequest, receiver, cancellation);
            secureErase(networkRequest.pathAndQuery);
            for (SignedRemoteHeader& header : networkRequest.headers)
            {
                secureErase(header.value);
            }

            if (receiver.rejected())
            {
                return response;
            }
            if (networkOutcome != SignedRemoteNetworkOutcome::Completed)
            {
                response.outcome = mapNetworkOutcome(networkOutcome);
                return response;
            }
            if (!receiver.headReceived() || !receiver.bodyLengthMatches())
            {
                response.outcome = SignedRemoteTransportOutcome::ProtocolFailure;
                return response;
            }
            if (!receiver.redirect())
            {
                return response;
            }

            if (response.redirectsFollowed >= request.policy.maximumRedirects)
            {
                response.outcome = SignedRemoteTransportOutcome::RedirectLimit;
                return response;
            }
            EphemeralString redirected(receiver.redirectLocation());
            if (!parseSignedUrl(redirected.get(), request.policy.maximumUrlBytes).has_value())
            {
                response.outcome = SignedRemoteTransportOutcome::UnsafeRequest;
                return response;
            }
            secureErase(currentUrl.get());
            currentUrl.get() = redirected.get();
            ++response.redirectsFollowed;
        }
    }

    bool isPublicSignedRemoteAddress(const RemoteNetworkAddress& address) noexcept
    {
        if (address.port == 0U)
        {
            return false;
        }
        if (address.family == RemoteNetworkAddressFamily::Ipv4)
        {
            if (std::any_of(address.bytes.begin() + 4U, address.bytes.end(),
                [](std::uint8_t byte) { return byte != 0U; }))
            {
                return false;
            }
            const std::uint8_t a = address.bytes[0];
            const std::uint8_t b = address.bytes[1];
            if (a == 0U || a == 10U || a == 127U || a >= 224U ||
                (a == 100U && b >= 64U && b <= 127U) ||
                (a == 169U && b == 254U) ||
                (a == 172U && b >= 16U && b <= 31U) ||
                (a == 192U && b == 0U && address.bytes[2] == 0U) ||
                (a == 192U && b == 88U && address.bytes[2] == 99U) ||
                (a == 192U && b == 168U) ||
                (a == 198U && (b == 18U || b == 19U)) ||
                (a == 192U && b == 0U && address.bytes[2] == 2U) ||
                (a == 198U && b == 51U && address.bytes[2] == 100U) ||
                (a == 203U && b == 0U && address.bytes[2] == 113U))
            {
                return false;
            }
            return true;
        }
        if (address.family != RemoteNetworkAddressFamily::Ipv6)
        {
            return false;
        }

        const bool ipv4Mapped = std::all_of(
            address.bytes.begin(), address.bytes.begin() + 10, [](std::uint8_t byte)
            {
                return byte == 0U;
            }) && address.bytes[10] == 0xffU && address.bytes[11] == 0xffU;
        if (ipv4Mapped)
        {
            RemoteNetworkAddress mapped;
            mapped.port = address.port;
            std::copy(address.bytes.begin() + 12, address.bytes.end(), mapped.bytes.begin());
            return isPublicSignedRemoteAddress(mapped);
        }

        // Only globally routable unicast space is eligible. Explicit exclusions
        // remove IETF special-purpose, documentation, benchmark and transition ranges.
        if ((address.bytes[0] & 0xe0U) != 0x20U ||
            (address.bytes[0] == 0x20U && address.bytes[1] == 0x01U &&
                address.bytes[2] <= 0x01U) ||
            (address.bytes[0] == 0x20U && address.bytes[1] == 0x01U &&
                address.bytes[2] == 0x02U && address.bytes[3] == 0x00U) ||
            (address.bytes[0] == 0x20U && address.bytes[1] == 0x01U &&
                address.bytes[2] == 0x0dU && address.bytes[3] == 0xb8U) ||
            (address.bytes[0] == 0x20U && address.bytes[1] == 0x02U) ||
            (address.bytes[0] == 0x3fU && address.bytes[1] == 0xffU &&
                (address.bytes[2] & 0xf0U) == 0U))
        {
            return false;
        }
        return true;
    }

    RemoteRepresentationDecision decideRemoteRepresentation(
        const RemoteArtifactResumeState& state,
        const SignedRemoteDownloadResponse& response) noexcept
    {
        if (response.providerId != state.providerId)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::ProviderChanged};
        }
        if (response.method != SignedRemoteHttpMethod::Get)
        {
            return {RemoteRepresentationAction::Reject,
                RemoteRepresentationReason::UnexpectedStatus};
        }
        if (response.target.kind == SignedRemoteTargetKind::Fallback)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::FailoverChanged};
        }
        if (!isCanonicalRemoteDownloadProviderId(response.representationProviderId) ||
            (state.validator.has_value() &&
                state.validator->providerId != response.representationProviderId))
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::RepresentationProviderChanged};
        }
        if (response.outcome == SignedRemoteTransportOutcome::Unauthorized ||
            response.outcome == SignedRemoteTransportOutcome::Forbidden ||
            response.statusCode == 401U || response.statusCode == 403U)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::AuthorizationExpired};
        }
        if (response.outcome == SignedRemoteTransportOutcome::Gone || response.statusCode == 410U)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::GrantGone};
        }
        if (response.outcome == SignedRemoteTransportOutcome::RateLimited ||
            response.statusCode == 429U)
        {
            return {RemoteRepresentationAction::RetryLater,
                RemoteRepresentationReason::RateLimited};
        }
        if (response.outcome == SignedRemoteTransportOutcome::RangeNotSatisfiable ||
            response.statusCode == 416U)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::RangeNotSatisfiable};
        }
        if (response.statusCode == 200U)
        {
            if (response.outcome != SignedRemoteTransportOutcome::Success)
            {
                return {RemoteRepresentationAction::Reject,
                    RemoteRepresentationReason::UnexpectedStatus};
            }
            if (!response.validator.has_value() ||
                response.validator->providerId != response.representationProviderId)
            {
                return {RemoteRepresentationAction::RestartAndResolve,
                    response.validator.has_value()
                        ? RemoteRepresentationReason::RepresentationProviderChanged
                        : RemoteRepresentationReason::MissingValidator};
            }
            return {RemoteRepresentationAction::RestartFromBeginning,
                RemoteRepresentationReason::RangeIgnored};
        }
        if (response.outcome != SignedRemoteTransportOutcome::Success ||
            response.statusCode != 206U || !response.contentRange.has_value() ||
            response.contentRange->start != state.bytesReceived ||
            response.contentRange->end < response.contentRange->start ||
            response.contentRange->total != state.expectedSize)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::InvalidContentRange};
        }
        if (!state.validator.has_value() || !response.validator.has_value())
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::MissingValidator};
        }
        if (state.validator->providerId != response.representationProviderId ||
            response.validator->providerId != response.representationProviderId ||
            state.validator->kind != RepresentationValidatorKind::StrongEtag ||
            response.validator->kind != RepresentationValidatorKind::StrongEtag ||
            state.validator->kind != response.validator->kind ||
            state.validator->value != response.validator->value)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::ValidatorChanged};
        }
        return {RemoteRepresentationAction::Append,
            RemoteRepresentationReason::ExactPartialRepresentation};
    }

    RemoteRepresentationDecision decideRemoteHeadRepresentation(
        const RemoteArtifactResumeState& state,
        const SignedRemoteDownloadResponse& response) noexcept
    {
        if (response.providerId != state.providerId)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::ProviderChanged};
        }
        if (response.method != SignedRemoteHttpMethod::Head ||
            response.target.kind != SignedRemoteTargetKind::Head)
        {
            return {RemoteRepresentationAction::Reject,
                RemoteRepresentationReason::UnexpectedStatus};
        }
        if (!isCanonicalRemoteDownloadProviderId(response.representationProviderId) ||
            (state.validator.has_value() &&
                state.validator->providerId != response.representationProviderId))
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::RepresentationProviderChanged};
        }
        if (response.outcome == SignedRemoteTransportOutcome::RateLimited ||
            response.statusCode == 429U)
        {
            return {RemoteRepresentationAction::RetryLater,
                RemoteRepresentationReason::RateLimited};
        }
        if (response.outcome == SignedRemoteTransportOutcome::Unauthorized ||
            response.outcome == SignedRemoteTransportOutcome::Forbidden ||
            response.statusCode == 401U || response.statusCode == 403U)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::AuthorizationExpired};
        }
        if (response.outcome == SignedRemoteTransportOutcome::Gone || response.statusCode == 410U)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::GrantGone};
        }
        if (response.outcome != SignedRemoteTransportOutcome::Success ||
            response.statusCode != 200U)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::UnexpectedStatus};
        }
        if (!response.contentLength.has_value() ||
            *response.contentLength != state.expectedSize)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::RepresentationSizeChanged};
        }
        if (!response.validator.has_value() ||
            response.validator->providerId != response.representationProviderId)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                response.validator.has_value()
                    ? RemoteRepresentationReason::RepresentationProviderChanged
                    : RemoteRepresentationReason::MissingValidator};
        }
        if (state.bytesReceived == 0U)
        {
            return {RemoteRepresentationAction::RestartFromBeginning,
                RemoteRepresentationReason::ExactHeadRepresentation};
        }
        if (!state.validator.has_value())
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::MissingValidator};
        }
        if (state.validator->providerId != response.representationProviderId ||
            state.validator->kind != RepresentationValidatorKind::StrongEtag ||
            response.validator->kind != RepresentationValidatorKind::StrongEtag ||
            state.validator->kind != response.validator->kind ||
            state.validator->value != response.validator->value)
        {
            return {RemoteRepresentationAction::RestartAndResolve,
                RemoteRepresentationReason::ValidatorChanged};
        }
        return {RemoteRepresentationAction::Append,
            RemoteRepresentationReason::ExactHeadRepresentation};
    }

    std::unique_ptr<ISignedRemoteAddressResolver> createSystemSignedRemoteAddressResolver()
    {
#ifdef _WIN32
        return std::make_unique<SystemSignedRemoteAddressResolver>();
#else
        return std::make_unique<UnavailableResolver>();
#endif
    }

    std::unique_ptr<ISignedRemoteNetworkAdapter> createWinHttpSignedRemoteNetworkAdapter()
    {
#ifdef _WIN32
        return std::make_unique<WinHttpSignedRemoteNetworkAdapter>();
#else
        return std::make_unique<UnavailableNetworkAdapter>();
#endif
    }
}
