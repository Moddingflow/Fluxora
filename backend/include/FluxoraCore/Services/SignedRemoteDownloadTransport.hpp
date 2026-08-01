#pragma once

#include "FluxoraCore/Services/RemoteDownloadContracts.hpp"

#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    enum class SignedRemoteHttpMethod
    {
        Head,
        Get
    };

    enum class SignedRemoteTargetKind
    {
        Head,
        Primary,
        Fallback
    };

    struct SignedRemoteTarget
    {
        SignedRemoteTargetKind kind{SignedRemoteTargetKind::Primary};
        std::size_t fallbackIndex{0};

        bool operator==(const SignedRemoteTarget&) const = default;
    };

    struct SignedRemoteTransportTimeouts
    {
        std::chrono::milliseconds resolve{std::chrono::seconds(5)};
        std::chrono::milliseconds connect{std::chrono::seconds(10)};
        std::chrono::milliseconds send{std::chrono::seconds(10)};
        std::chrono::milliseconds receive{std::chrono::seconds(30)};
        std::chrono::milliseconds overall{std::chrono::seconds(60)};
    };

    struct SignedRemoteTransportPolicy
    {
        SignedRemoteTransportTimeouts timeouts;
        std::size_t maximumUrlBytes{4096};
        std::size_t maximumRedirects{3};
        std::size_t maximumResponseHeaders{64};
        std::size_t maximumHeaderNameBytes{128};
        std::size_t maximumHeaderValueBytes{8192};
        std::size_t maximumHeaderLineBytes{8448};
        std::size_t maximumResponseHeaderBytes{32U * 1024U};
        std::size_t maximumChunkBytes{1024U * 1024U};
    };

    class IRemoteDownloadCancellation
    {
    public:
        virtual ~IRemoteDownloadCancellation() = default;
        [[nodiscard]] virtual bool isCancellationRequested() const noexcept = 0;
    };

    enum class RemoteNetworkAddressFamily
    {
        Ipv4,
        Ipv6
    };

    struct RemoteNetworkAddress
    {
        RemoteNetworkAddressFamily family{RemoteNetworkAddressFamily::Ipv4};
        std::array<std::uint8_t, 16> bytes{};
        std::uint16_t port{443};

        bool operator==(const RemoteNetworkAddress&) const = default;
    };

    enum class SignedRemoteResolveOutcome
    {
        Success,
        Failure,
        Timeout,
        Cancelled
    };

    struct SignedRemoteResolution
    {
        SignedRemoteResolveOutcome outcome{SignedRemoteResolveOutcome::Failure};
        std::vector<RemoteNetworkAddress> addresses;
    };

    class ISignedRemoteAddressResolver
    {
    public:
        virtual ~ISignedRemoteAddressResolver() = default;
        [[nodiscard]] virtual SignedRemoteResolution resolve(
            std::string_view host,
            std::uint16_t port,
            std::chrono::steady_clock::time_point deadline,
            std::wstring_view operationId,
            const IRemoteDownloadCancellation& cancellation) = 0;
    };

    struct SignedRemoteHeader
    {
        std::string name;
        std::string value;
    };

    struct SignedRemoteNetworkRequest
    {
        SignedRemoteHttpMethod method{SignedRemoteHttpMethod::Get};
        std::string host;
        std::uint16_t port{443};
        std::string pathAndQuery;
        std::vector<RemoteNetworkAddress> resolvedAddresses;
        std::vector<SignedRemoteHeader> headers;
        SignedRemoteTransportTimeouts timeouts;
        SignedRemoteTransportPolicy policy;
        std::chrono::steady_clock::time_point deadline;
        std::wstring operationId;
    };

    struct SignedRemoteNetworkResponseHead
    {
        std::uint16_t statusCode{0};
        std::vector<SignedRemoteHeader> headers;
        RemoteNetworkAddress connectedRemoteAddress;
    };

    class ISignedRemoteNetworkReceiver
    {
    public:
        virtual ~ISignedRemoteNetworkReceiver() = default;
        // True asks the adapter to stream the body. False ends the response after
        // headers; the receiver separately records whether that stop was rejection.
        [[nodiscard]] virtual bool onResponseHead(SignedRemoteNetworkResponseHead response) = 0;
        [[nodiscard]] virtual bool onBodyChunk(std::span<const std::byte> chunk) = 0;
    };

    enum class SignedRemoteNetworkOutcome
    {
        Completed,
        ResolveFailure,
        ConnectFailure,
        SendFailure,
        ReceiveFailure,
        Timeout,
        Cancelled
    };

    class ISignedRemoteNetworkAdapter
    {
    public:
        virtual ~ISignedRemoteNetworkAdapter() = default;
        [[nodiscard]] virtual SignedRemoteNetworkOutcome execute(
            const SignedRemoteNetworkRequest& request,
            ISignedRemoteNetworkReceiver& receiver,
            const IRemoteDownloadCancellation& cancellation) = 0;
    };

    enum class SignedRemoteTransportOutcome
    {
        Success,
        Unauthorized,
        Forbidden,
        Gone,
        RangeNotSatisfiable,
        RateLimited,
        Cancelled,
        Timeout,
        UnsafeRequest,
        UnsafeAddress,
        DnsFailure,
        RebindingRejected,
        RedirectLimit,
        RedirectLoop,
        ProtocolFailure,
        NetworkFailure
    };

    struct SignedRemoteContentRange
    {
        std::uint64_t start{0};
        std::uint64_t end{0};
        std::uint64_t total{0};

        bool operator==(const SignedRemoteContentRange&) const = default;
    };

    struct SignedRemoteDownloadRequest
    {
        SignedRemoteHttpMethod method{SignedRemoteHttpMethod::Get};
        SignedRemoteTarget target;
        std::optional<std::uint64_t> rangeStart;
        std::optional<RepresentationValidator> ifMatch;
        SignedRemoteTransportPolicy policy;
        std::wstring operationId;
    };

    struct SignedRemoteDownloadResponse
    {
        SignedRemoteTransportOutcome outcome{SignedRemoteTransportOutcome::NetworkFailure};
        std::string providerId;
        std::string representationProviderId;
        SignedRemoteHttpMethod method{SignedRemoteHttpMethod::Get};
        SignedRemoteTarget target;
        std::uint16_t statusCode{0};
        std::optional<std::uint64_t> contentLength;
        std::optional<SignedRemoteContentRange> contentRange;
        std::optional<RepresentationValidator> validator;
        std::optional<std::uint64_t> retryAfterSeconds;
        std::uint64_t bytesStreamed{0};
        std::size_t redirectsFollowed{0};
        std::wstring operationId;
    };

    using SignedRemoteChunkSink = std::function<bool(std::span<const std::byte>)>;

    class SignedRemoteDownloadTransport final
    {
    public:
        SignedRemoteDownloadTransport(
            ISignedRemoteAddressResolver& resolver,
            ISignedRemoteNetworkAdapter& network);

        [[nodiscard]] SignedRemoteDownloadResponse execute(
            const ResolvedDownloadGrant& grant,
            const SignedRemoteDownloadRequest& request,
            const IRemoteDownloadCancellation& cancellation,
            SignedRemoteChunkSink chunkSink = {});

    private:
        ISignedRemoteAddressResolver& resolver_;
        ISignedRemoteNetworkAdapter& network_;
    };

    enum class RemoteRepresentationAction
    {
        Append,
        RestartFromBeginning,
        RestartAndResolve,
        RetryLater,
        Reject
    };

    enum class RemoteRepresentationReason
    {
        ExactPartialRepresentation,
        RangeIgnored,
        RangeNotSatisfiable,
        MissingValidator,
        ValidatorChanged,
        ProviderChanged,
        RepresentationProviderChanged,
        FailoverChanged,
        RepresentationSizeChanged,
        ExactHeadRepresentation,
        InvalidContentRange,
        AuthorizationExpired,
        GrantGone,
        RateLimited,
        UnexpectedStatus
    };

    struct RemoteRepresentationDecision
    {
        RemoteRepresentationAction action{RemoteRepresentationAction::Reject};
        RemoteRepresentationReason reason{RemoteRepresentationReason::UnexpectedStatus};
    };

    [[nodiscard]] RemoteRepresentationDecision decideRemoteRepresentation(
        const RemoteArtifactResumeState& state,
        const SignedRemoteDownloadResponse& response) noexcept;

    [[nodiscard]] RemoteRepresentationDecision decideRemoteHeadRepresentation(
        const RemoteArtifactResumeState& state,
        const SignedRemoteDownloadResponse& response) noexcept;

    [[nodiscard]] bool isPublicSignedRemoteAddress(
        const RemoteNetworkAddress& address) noexcept;

    // The grant owner must call this at every terminal attempt boundary (success,
    // failure, cancellation and exception) because signed URLs are caller-owned.
    [[nodiscard]] std::unique_ptr<ISignedRemoteAddressResolver>
        createSystemSignedRemoteAddressResolver();
    [[nodiscard]] std::unique_ptr<ISignedRemoteNetworkAdapter>
        createWinHttpSignedRemoteNetworkAdapter();
}
