#include "FluxoraCore/Services/SignedRemoteDownloadTransport.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cstring>
#include <limits>

namespace fluxora::tests
{
    namespace
    {
        class NeverCancelled final : public IRemoteDownloadCancellation
        {
        public:
            bool isCancellationRequested() const noexcept override { return false; }
        };

        RemoteNetworkAddress publicAddress(
            std::uint8_t a = 93,
            std::uint8_t b = 184,
            std::uint8_t c = 216,
            std::uint8_t d = 34)
        {
            RemoteNetworkAddress address;
            address.bytes[0] = a;
            address.bytes[1] = b;
            address.bytes[2] = c;
            address.bytes[3] = d;
            return address;
        }

        class FakeResolver final : public ISignedRemoteAddressResolver
        {
        public:
            SignedRemoteResolution resolve(
                std::string_view host,
                std::uint16_t port,
                std::chrono::steady_clock::time_point,
                std::wstring_view operationId,
                const IRemoteDownloadCancellation&) override
            {
                ++calls;
                lastHost = host;
                hosts.emplace_back(host);
                lastPort = port;
                lastOperationId = operationId;
                if (!resolutions.empty())
                {
                    const std::size_t index = std::min<std::size_t>(
                        static_cast<std::size_t>(calls - 1), resolutions.size() - 1U);
                    return resolutions[index];
                }
                return resolution;
            }

            SignedRemoteResolution resolution{
                SignedRemoteResolveOutcome::Success,
                {publicAddress()}};
            int calls{0};
            std::vector<SignedRemoteResolution> resolutions;
            std::vector<std::string> hosts;
            std::string lastHost;
            std::uint16_t lastPort{0};
            std::wstring lastOperationId;
        };

        class FakeNetwork final : public ISignedRemoteNetworkAdapter
        {
        public:
            struct Step
            {
                SignedRemoteNetworkResponseHead response;
                std::vector<unsigned char> body;
                SignedRemoteNetworkOutcome outcome{SignedRemoteNetworkOutcome::Completed};
            };

            SignedRemoteNetworkOutcome execute(
                const SignedRemoteNetworkRequest& request,
                ISignedRemoteNetworkReceiver& receiver,
                const IRemoteDownloadCancellation&) override
            {
                ++calls;
                lastMethod = request.method;
                lastHeaders = request.headers;
                lastOperationId = request.operationId;
                sawSignedQuery = request.pathAndQuery.find("signature=ephemeral-secret") !=
                    std::string::npos;
                hosts.push_back(request.host);
                methods.push_back(request.method);
                headerHistory.push_back(request.headers);
                const Step* step = nullptr;
                if (!steps.empty())
                {
                    const std::size_t index = std::min<std::size_t>(
                        static_cast<std::size_t>(calls - 1), steps.size() - 1U);
                    step = &steps[index];
                }
                const SignedRemoteNetworkResponseHead& selectedResponse =
                    step == nullptr ? response : step->response;
                const std::vector<unsigned char>& selectedBody = step == nullptr ? body : step->body;
                if (receiver.onResponseHead(selectedResponse) && !selectedBody.empty())
                {
                    (void)receiver.onBodyChunk(std::as_bytes(std::span(selectedBody)));
                }
                return step == nullptr ? outcome : step->outcome;
            }

            SignedRemoteNetworkResponseHead response{
                200,
                {{"content-length", "3"}, {"etag", "\"etag-v1\""}},
                publicAddress()};
            std::vector<unsigned char> body{'a', 'b', 'c'};
            SignedRemoteNetworkOutcome outcome{SignedRemoteNetworkOutcome::Completed};
            std::vector<Step> steps;
            int calls{0};
            SignedRemoteHttpMethod lastMethod{SignedRemoteHttpMethod::Head};
            std::vector<SignedRemoteHeader> lastHeaders;
            std::wstring lastOperationId;
            bool sawSignedQuery{false};
            std::vector<std::string> hosts;
            std::vector<SignedRemoteHttpMethod> methods;
            std::vector<std::vector<SignedRemoteHeader>> headerHistory;
        };

        ResolvedDownloadGrant validGrant()
        {
            return ResolvedDownloadGrant{
                .providerId = "moddingflow",
                .representationProviderId = "cloudflare_r2",
                .artifactId = "artifact-1",
                .grantId = "grant-1",
                .primaryUrl = "https://storage.example.com/file.bin?signature=ephemeral-secret",
                .headUrl = "https://storage.example.com/file.bin?signature=ephemeral-secret",
                .expiresAtUnixMs = 1'900'000'000'000ULL,
                .expectedSize = 3,
                .expectedSha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                .operationId = L"operation-signed-download"};
        }

        SignedRemoteDownloadRequest validRequest()
        {
            SignedRemoteDownloadRequest request;
            request.operationId = L"operation-signed-download";
            return request;
        }

        RemoteArtifactResumeState validResumeState()
        {
            RemoteArtifactResumeState state;
            state.providerId = "moddingflow";
            state.artifactId = "artifact-1";
            state.modId = "mod-1";
            state.versionId = "version-1";
            state.jobId = "job-1";
            state.grantId = "grant-1";
            state.expectedSize = 3U;
            state.expectedSha256 =
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
            state.bytesReceived = 1U;
            state.grantExpiresAtUnixMs = 1'900'000'000'000ULL;
            state.validator = RepresentationValidator{
                "cloudflare_r2", RepresentationValidatorKind::StrongEtag, "\"etag-v1\""};
            state.phase = RemoteArtifactResumePhase::Checkpointed;
            return state;
        }

        class AlwaysCancelled final : public IRemoteDownloadCancellation
        {
        public:
            bool isCancellationRequested() const noexcept override { return true; }
        };
    }

    TEST(SignedRemoteDownloadTransportTests, StreamsValidatedPublicHttpsResponseWithoutCredentialHeaders)
    {
        FakeResolver resolver;
        FakeNetwork network;
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);
        std::string streamed;
        SignedRemoteDownloadRequest request;
        request.operationId = L"operation-signed-download";

        const SignedRemoteDownloadResponse response = transport.execute(
            validGrant(),
            request,
            cancellation,
            [&](std::span<const std::byte> chunk)
            {
                streamed.append(
                    reinterpret_cast<const char*>(chunk.data()),
                    chunk.size());
                return true;
            });

        EXPECT_EQ(response.outcome, SignedRemoteTransportOutcome::Success);
        EXPECT_EQ(response.statusCode, 200);
        EXPECT_EQ(response.providerId, "moddingflow");
        EXPECT_EQ(response.representationProviderId, "cloudflare_r2");
        ASSERT_TRUE(response.validator.has_value());
        EXPECT_EQ(response.validator->providerId, "cloudflare_r2");
        EXPECT_EQ(response.bytesStreamed, 3U);
        EXPECT_EQ(response.operationId, L"operation-signed-download");
        EXPECT_EQ(streamed, "abc");
        EXPECT_EQ(resolver.calls, 1);
        EXPECT_EQ(resolver.lastHost, "storage.example.com");
        EXPECT_EQ(resolver.lastOperationId, L"operation-signed-download");
        EXPECT_EQ(network.calls, 1);
        EXPECT_EQ(network.lastOperationId, L"operation-signed-download");
        EXPECT_TRUE(network.sawSignedQuery);
        EXPECT_TRUE(network.lastHeaders.empty());
    }

    TEST(SignedRemoteDownloadTransportTests, ExternalRangeUsesNoConditionalHeaderAndRemainsSizeBound)
    {
        FakeResolver resolver;
        FakeNetwork network;
        network.response = {
            206,
            {{"content-length", "2"}, {"content-range", "bytes 1-2/3"}},
            publicAddress()};
        network.body = {'b', 'c'};
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);
        ResolvedDownloadGrant grant = validGrant();
        grant.representationProviderId = "github";
        grant.fallbackAvailable = false;
        grant.headSupported = false;
        grant.rangeSupported = true;
        grant.conditionalRequestsSupported = false;
        SignedRemoteDownloadRequest request = validRequest();
        request.rangeStart = 1U;
        std::string streamed;

        const SignedRemoteDownloadResponse response = transport.execute(
            grant,
            request,
            cancellation,
            [&](std::span<const std::byte> chunk)
            {
                streamed.append(
                    reinterpret_cast<const char*>(chunk.data()),
                    chunk.size());
                return true;
            });

        EXPECT_EQ(response.outcome, SignedRemoteTransportOutcome::Success);
        EXPECT_EQ(response.statusCode, 206U);
        EXPECT_EQ(response.representationProviderId, "github");
        EXPECT_EQ(streamed, "bc");
        ASSERT_EQ(network.lastHeaders.size(), 1U);
        EXPECT_EQ(network.lastHeaders.front().name, "Range");
        EXPECT_EQ(network.lastHeaders.front().value, "bytes=1-");
    }

    TEST(SignedRemoteDownloadTransportTests, RejectsNonCanonicalOrOverlongSignedUrlsBeforeDns)
    {
        const std::vector<std::string> rejectedUrls{
            "http://storage.example.com/file.bin?signature=x",
            "HTTPS://storage.example.com/file.bin?signature=x",
            "https://user@storage.example.com/file.bin?signature=x",
            "https://storage.example.com/file.bin?signature=x#fragment",
            "https://storage.example.com/file bin?signature=x",
            "https://storage.example.com\\file.bin?signature=x",
            "https://Storage.example.com/file.bin?signature=x",
            "https://storage.example.com./file.bin?signature=x",
            "https://storage.example.com",
            "https://storage.example.com/file.bin?",
            "https://storage.example.com:0/file.bin?signature=x",
            "https://storage.example.com:443/file.bin?signature=x",
            "https://storage.example.com:0443/file.bin?signature=x",
            "https://storage.example.com/../file.bin?signature=x",
            "https://storage.example.com/file%2fpart?signature=x",
            "https://storage.example.com/file%41?signature=x",
            "https://storage.example.com/file.bin?signature=x%0A",
            std::string("https://storage.example.com/") + std::string(5000U, 'a')};

        for (std::size_t index = 0; index < rejectedUrls.size(); ++index)
        {
            SCOPED_TRACE(index);
            FakeResolver resolver;
            FakeNetwork network;
            NeverCancelled cancellation;
            SignedRemoteDownloadTransport transport(resolver, network);
            ResolvedDownloadGrant grant = validGrant();
            grant.primaryUrl = rejectedUrls[index];

            const SignedRemoteDownloadResponse response = transport.execute(
                grant, validRequest(), cancellation);

            EXPECT_EQ(response.outcome, SignedRemoteTransportOutcome::UnsafeRequest);
            EXPECT_EQ(resolver.calls, 0);
            EXPECT_EQ(network.calls, 0);
        }
    }

    TEST(SignedRemoteDownloadTransportTests, RejectsMixedDnsSetWhenAnyAnswerIsNotPublic)
    {
        FakeResolver resolver;
        RemoteNetworkAddress privateAddress = publicAddress(10, 2, 3, 4);
        resolver.resolution.addresses = {publicAddress(), privateAddress};
        FakeNetwork network;
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);

        const SignedRemoteDownloadResponse response = transport.execute(
            validGrant(), validRequest(), cancellation);

        EXPECT_EQ(response.outcome, SignedRemoteTransportOutcome::UnsafeAddress);
        EXPECT_EQ(resolver.calls, 1);
        EXPECT_EQ(network.calls, 0);
    }

    TEST(SignedRemoteDownloadTransportTests, BlocksPrivateReservedAndNonGlobalAddressFamilies)
    {
        const std::vector<RemoteNetworkAddress> rejectedIpv4{
            publicAddress(0, 1, 2, 3),
            publicAddress(10, 1, 2, 3),
            publicAddress(100, 64, 0, 1),
            publicAddress(127, 0, 0, 1),
            publicAddress(169, 254, 1, 1),
            publicAddress(172, 16, 0, 1),
            publicAddress(192, 0, 0, 8),
            publicAddress(192, 0, 2, 1),
            publicAddress(192, 168, 1, 1),
            publicAddress(198, 18, 0, 1),
            publicAddress(198, 51, 100, 1),
            publicAddress(203, 0, 113, 1),
            publicAddress(224, 0, 0, 1),
            publicAddress(255, 255, 255, 255)};
        for (const RemoteNetworkAddress& address : rejectedIpv4)
        {
            EXPECT_FALSE(isPublicSignedRemoteAddress(address));
        }
        EXPECT_TRUE(isPublicSignedRemoteAddress(publicAddress()));
        EXPECT_TRUE(isPublicSignedRemoteAddress(publicAddress(192, 0, 1, 1)));

        RemoteNetworkAddress loopbackV6;
        loopbackV6.family = RemoteNetworkAddressFamily::Ipv6;
        loopbackV6.bytes[15] = 1U;
        EXPECT_FALSE(isPublicSignedRemoteAddress(loopbackV6));
        RemoteNetworkAddress uniqueLocalV6 = loopbackV6;
        uniqueLocalV6.bytes = {};
        uniqueLocalV6.bytes[0] = 0xfdU;
        EXPECT_FALSE(isPublicSignedRemoteAddress(uniqueLocalV6));
        RemoteNetworkAddress linkLocalV6 = loopbackV6;
        linkLocalV6.bytes = {};
        linkLocalV6.bytes[0] = 0xfeU;
        linkLocalV6.bytes[1] = 0x80U;
        EXPECT_FALSE(isPublicSignedRemoteAddress(linkLocalV6));
        RemoteNetworkAddress multicastV6 = loopbackV6;
        multicastV6.bytes = {};
        multicastV6.bytes[0] = 0xffU;
        EXPECT_FALSE(isPublicSignedRemoteAddress(multicastV6));
        RemoteNetworkAddress documentationV6 = loopbackV6;
        documentationV6.bytes = {0x20U, 0x01U, 0x0dU, 0xb8U};
        EXPECT_FALSE(isPublicSignedRemoteAddress(documentationV6));
        RemoteNetworkAddress publicV6 = loopbackV6;
        publicV6.bytes = {0x26U, 0x06U, 0x47U, 0x00U};
        EXPECT_TRUE(isPublicSignedRemoteAddress(publicV6));
    }

    TEST(SignedRemoteDownloadTransportTests, RejectsConnectedAddressThatWasNotPrevalidated)
    {
        FakeResolver resolver;
        FakeNetwork network;
        network.response.connectedRemoteAddress = publicAddress(93, 184, 216, 35);
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);
        std::string streamed;

        const SignedRemoteDownloadResponse response = transport.execute(
            validGrant(),
            validRequest(),
            cancellation,
            [&](std::span<const std::byte> chunk)
            {
                streamed.append(reinterpret_cast<const char*>(chunk.data()), chunk.size());
                return true;
            });

        EXPECT_EQ(response.outcome, SignedRemoteTransportOutcome::RebindingRejected);
        EXPECT_TRUE(streamed.empty());
    }

    TEST(SignedRemoteDownloadTransportTests, ManuallyFollowsHttpsRedirectAndRevalidatesDns)
    {
        FakeResolver resolver;
        resolver.resolutions = {
            {SignedRemoteResolveOutcome::Success, {publicAddress()}},
            {SignedRemoteResolveOutcome::Success, {publicAddress(93, 184, 216, 35)}}};
        FakeNetwork network;
        network.steps = {
            {{302U,
                {{"Location", "https://cdn.example.com/file.bin?signature=redirected"}},
                publicAddress()}, {}, SignedRemoteNetworkOutcome::Completed},
            {{200U, {{"Content-Length", "3"}, {"ETag", "\"etag-v1\""}},
                publicAddress(93, 184, 216, 35)}, {'a', 'b', 'c'},
                SignedRemoteNetworkOutcome::Completed}};
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);

        const SignedRemoteDownloadResponse response = transport.execute(
            validGrant(), validRequest(), cancellation);

        EXPECT_EQ(response.outcome, SignedRemoteTransportOutcome::Success);
        EXPECT_EQ(response.redirectsFollowed, 1U);
        EXPECT_EQ(resolver.hosts,
            (std::vector<std::string>{"storage.example.com", "cdn.example.com"}));
        EXPECT_EQ(network.hosts, resolver.hosts);
        ASSERT_EQ(network.headerHistory.size(), 2U);
        EXPECT_TRUE(network.headerHistory[0].empty());
        EXPECT_TRUE(network.headerHistory[1].empty());
    }

    TEST(SignedRemoteDownloadTransportTests, RejectsRedirectDowngradeLoopAndBudgetExhaustion)
    {
        NeverCancelled cancellation;
        for (int scenario = 0; scenario < 3; ++scenario)
        {
            SCOPED_TRACE(scenario);
            FakeResolver resolver;
            FakeNetwork network;
            ResolvedDownloadGrant grant = validGrant();
            SignedRemoteDownloadRequest request = validRequest();
            std::string location;
            SignedRemoteTransportOutcome expected{};
            if (scenario == 0)
            {
                location = "http://cdn.example.com/file.bin?signature=x";
                expected = SignedRemoteTransportOutcome::UnsafeRequest;
            }
            else if (scenario == 1)
            {
                location = grant.primaryUrl;
                expected = SignedRemoteTransportOutcome::RedirectLoop;
            }
            else
            {
                location = "https://cdn.example.com/file.bin?signature=x";
                request.policy.maximumRedirects = 0U;
                expected = SignedRemoteTransportOutcome::RedirectLimit;
            }
            network.response = {302U, {{"Location", location}}, publicAddress()};
            network.body.clear();
            SignedRemoteDownloadTransport transport(resolver, network);

            const SignedRemoteDownloadResponse response = transport.execute(
                grant, request, cancellation);

            EXPECT_EQ(response.outcome, expected);
            EXPECT_EQ(network.calls, 1);
        }
    }

    TEST(SignedRemoteDownloadTransportTests, AllowsOnlyFixedRangeAndProviderScopedStrongIfMatch)
    {
        FakeResolver resolver;
        FakeNetwork network;
        network.response = {
            206U,
            {{"Content-Length", "2"}, {"Content-Range", "bytes 1-2/3"},
                {"ETag", "\"etag-v1\""}},
            publicAddress()};
        network.body = {'b', 'c'};
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);
        SignedRemoteDownloadRequest request = validRequest();
        request.rangeStart = 1U;
        request.ifMatch = RepresentationValidator{
            "cloudflare_r2", RepresentationValidatorKind::StrongEtag, "\"etag-v1\""};

        const SignedRemoteDownloadResponse response = transport.execute(
            validGrant(), request, cancellation);

        EXPECT_EQ(response.outcome, SignedRemoteTransportOutcome::Success);
        EXPECT_EQ(response.bytesStreamed, 2U);
        ASSERT_EQ(network.lastHeaders.size(), 2U);
        EXPECT_EQ(network.lastHeaders[0].name, "Range");
        EXPECT_EQ(network.lastHeaders[0].value, "bytes=1-");
        EXPECT_EQ(network.lastHeaders[1].name, "If-Match");
        EXPECT_EQ(network.lastHeaders[1].value, "\"etag-v1\"");

        request.ifMatch->providerId = "another-provider";
        EXPECT_EQ(transport.execute(validGrant(), request, cancellation).outcome,
            SignedRemoteTransportOutcome::UnsafeRequest);
        request.ifMatch->providerId = "cloudflare_r2";
        request.ifMatch->kind = RepresentationValidatorKind::LastModified;
        EXPECT_EQ(transport.execute(validGrant(), request, cancellation).outcome,
            SignedRemoteTransportOutcome::UnsafeRequest);
    }

    TEST(SignedRemoteDownloadTransportTests, RejectsArbitraryGrantHeadersAndOperationMismatch)
    {
        FakeResolver resolver;
        FakeNetwork network;
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);
        for (const std::string& header : {"Authorization", "Cookie", "Referer", "X-Custom"})
        {
            ResolvedDownloadGrant grant = validGrant();
            grant.transportHeaders.emplace(header, "must-not-leave-control-plane");
            EXPECT_EQ(transport.execute(grant, validRequest(), cancellation).outcome,
                SignedRemoteTransportOutcome::UnsafeRequest);
        }
        SignedRemoteDownloadRequest mismatched = validRequest();
        mismatched.operationId = L"different-operation";
        EXPECT_EQ(transport.execute(validGrant(), mismatched, cancellation).outcome,
            SignedRemoteTransportOutcome::UnsafeRequest);
        EXPECT_EQ(resolver.calls, 0);
        EXPECT_EQ(network.calls, 0);
    }

    TEST(SignedRemoteDownloadTransportTests, ExecutesOnlyDedicatedHeadTargetWithoutBody)
    {
        FakeResolver resolver;
        FakeNetwork network;
        network.body = {'x', 'x', 'x'};
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);
        SignedRemoteDownloadRequest request = validRequest();
        request.method = SignedRemoteHttpMethod::Head;
        request.target.kind = SignedRemoteTargetKind::Head;

        const SignedRemoteDownloadResponse response = transport.execute(
            validGrant(), request, cancellation);

        EXPECT_EQ(response.outcome, SignedRemoteTransportOutcome::Success);
        EXPECT_EQ(response.bytesStreamed, 0U);
        EXPECT_EQ(network.lastMethod, SignedRemoteHttpMethod::Head);
        EXPECT_TRUE(network.lastHeaders.empty());
        request.rangeStart = 1U;
        request.ifMatch = RepresentationValidator{
            "cloudflare_r2", RepresentationValidatorKind::StrongEtag, "\"etag-v1\""};
        EXPECT_EQ(transport.execute(validGrant(), request, cancellation).outcome,
            SignedRemoteTransportOutcome::UnsafeRequest);
    }

    TEST(SignedRemoteDownloadTransportTests, MapsTypedStorageStatusesWithoutOAuthRefresh)
    {
        const std::vector<std::pair<std::uint16_t, SignedRemoteTransportOutcome>> cases{
            {401U, SignedRemoteTransportOutcome::Unauthorized},
            {403U, SignedRemoteTransportOutcome::Forbidden},
            {410U, SignedRemoteTransportOutcome::Gone},
            {416U, SignedRemoteTransportOutcome::RangeNotSatisfiable},
            {429U, SignedRemoteTransportOutcome::RateLimited}};
        for (const auto& [status, expected] : cases)
        {
            SCOPED_TRACE(status);
            FakeResolver resolver;
            FakeNetwork network;
            network.response = {status, status == 429U
                ? std::vector<SignedRemoteHeader>{{"Retry-After", "12"}}
                : std::vector<SignedRemoteHeader>{}, publicAddress()};
            network.body.clear();
            NeverCancelled cancellation;
            SignedRemoteDownloadTransport transport(resolver, network);
            const SignedRemoteDownloadResponse response = transport.execute(
                validGrant(), validRequest(), cancellation);
            EXPECT_EQ(response.outcome, expected);
            EXPECT_EQ(network.calls, 1);
            if (status == 429U)
            {
                EXPECT_EQ(response.retryAfterSeconds, 12U);
            }
        }
    }

    TEST(SignedRemoteDownloadTransportTests, DiscardsIgnoredRangeAndRejectsInvalidPartialBody)
    {
        FakeResolver resolver;
        FakeNetwork network;
        NeverCancelled cancellation;
        SignedRemoteDownloadTransport transport(resolver, network);
        SignedRemoteDownloadRequest request = validRequest();
        request.rangeStart = 1U;
        request.ifMatch = RepresentationValidator{
            "cloudflare_r2", RepresentationValidatorKind::StrongEtag, "\"etag-v1\""};
        std::size_t sinkCalls = 0U;

        const SignedRemoteDownloadResponse ignoredRange = transport.execute(
            validGrant(), request, cancellation, [&](std::span<const std::byte>)
            {
                ++sinkCalls;
                return true;
            });
        EXPECT_EQ(ignoredRange.outcome, SignedRemoteTransportOutcome::Success);
        EXPECT_EQ(ignoredRange.statusCode, 200U);
        EXPECT_EQ(ignoredRange.bytesStreamed, 0U);
        EXPECT_EQ(sinkCalls, 0U);

        network.response = {206U,
            {{"Content-Length", "2"}, {"Content-Range", "bytes 0-1/3"},
                {"ETag", "\"etag-v1\""}}, publicAddress()};
        network.body = {'a', 'b'};
        const SignedRemoteDownloadResponse wrongRange = transport.execute(
            validGrant(), request, cancellation);
        EXPECT_EQ(wrongRange.outcome, SignedRemoteTransportOutcome::ProtocolFailure);

        network.response = {206U,
            {{"Content-Length", "2"}, {"Content-Range", "bytes 1-2/3"},
                {"ETag", "\"changed\""}}, publicAddress()};
        const SignedRemoteDownloadResponse changedValidator = transport.execute(
            validGrant(), request, cancellation, [&](std::span<const std::byte>)
            {
                ++sinkCalls;
                return true;
            });
        EXPECT_EQ(changedValidator.outcome, SignedRemoteTransportOutcome::Success);
        EXPECT_EQ(changedValidator.bytesStreamed, 0U);
        EXPECT_EQ(sinkCalls, 0U);

        ResolvedDownloadGrant fallbackGrant = validGrant();
        fallbackGrant.fallbackUrls.push_back(
            "https://fallback.example.com/file.bin?signature=fallback");
        network.response.headers[2].value = "\"etag-v1\"";
        request.target.kind = SignedRemoteTargetKind::Fallback;
        const SignedRemoteDownloadResponse fallbackPartial = transport.execute(
            fallbackGrant, request, cancellation, [&](std::span<const std::byte>)
            {
                ++sinkCalls;
                return true;
            });
        EXPECT_EQ(fallbackPartial.outcome, SignedRemoteTransportOutcome::Success);
        EXPECT_EQ(fallbackPartial.bytesStreamed, 0U);
        EXPECT_EQ(sinkCalls, 0U);
    }

    TEST(SignedRemoteDownloadTransportTests, EnforcesCancellationTimeoutAndResponseBounds)
    {
        FakeResolver resolver;
        FakeNetwork network;
        SignedRemoteDownloadTransport transport(resolver, network);
        AlwaysCancelled cancelled;
        EXPECT_EQ(transport.execute(validGrant(), validRequest(), cancelled).outcome,
            SignedRemoteTransportOutcome::Cancelled);
        EXPECT_EQ(resolver.calls, 0);

        NeverCancelled neverCancelled;
        resolver.resolution = {SignedRemoteResolveOutcome::Timeout, {}};
        EXPECT_EQ(transport.execute(validGrant(), validRequest(), neverCancelled).outcome,
            SignedRemoteTransportOutcome::Timeout);
        EXPECT_EQ(network.calls, 0);

        resolver.resolution = {SignedRemoteResolveOutcome::Success, {publicAddress()}};
        network.response.headers.assign(65U, SignedRemoteHeader{"X-Metadata", "x"});
        EXPECT_EQ(transport.execute(validGrant(), validRequest(), neverCancelled).outcome,
            SignedRemoteTransportOutcome::ProtocolFailure);

        network.response.headers = {{"ETag", std::string(8193U, 'x')}};
        EXPECT_EQ(transport.execute(validGrant(), validRequest(), neverCancelled).outcome,
            SignedRemoteTransportOutcome::ProtocolFailure);

        network.response = {200U,
            {{"Content-Length", "3"}, {"ETag", "\"etag-v1\""}}, publicAddress()};
        network.body = {'a', 'b', 'c'};
        SignedRemoteDownloadRequest tinyChunk = validRequest();
        tinyChunk.policy.maximumChunkBytes = 2U;
        EXPECT_EQ(transport.execute(validGrant(), tinyChunk, neverCancelled).outcome,
            SignedRemoteTransportOutcome::ProtocolFailure);

        SignedRemoteDownloadRequest invalidPolicy = validRequest();
        invalidPolicy.policy.maximumResponseHeaderBytes = 0U;
        EXPECT_EQ(transport.execute(validGrant(), invalidPolicy, neverCancelled).outcome,
            SignedRemoteTransportOutcome::UnsafeRequest);

        network.body.clear();
        network.outcome = SignedRemoteNetworkOutcome::Cancelled;
        EXPECT_EQ(transport.execute(validGrant(), validRequest(), neverCancelled).outcome,
            SignedRemoteTransportOutcome::Cancelled);
        network.outcome = SignedRemoteNetworkOutcome::Timeout;
        EXPECT_EQ(transport.execute(validGrant(), validRequest(), neverCancelled).outcome,
            SignedRemoteTransportOutcome::Timeout);
    }

    TEST(SignedRemoteDownloadTransportTests, RepresentationDecisionAppendsOnlyExactPartialNamespace)
    {
        RemoteArtifactResumeState state = validResumeState();
        SignedRemoteDownloadResponse response;
        response.outcome = SignedRemoteTransportOutcome::Success;
        response.providerId = "moddingflow";
        response.representationProviderId = "cloudflare_r2";
        response.statusCode = 206U;
        response.contentRange = SignedRemoteContentRange{1U, 2U, 3U};
        response.validator = state.validator;

        EXPECT_EQ(decideRemoteRepresentation(state, response).action,
            RemoteRepresentationAction::Append);
        response.target.kind = SignedRemoteTargetKind::Fallback;
        EXPECT_EQ(decideRemoteRepresentation(state, response).reason,
            RemoteRepresentationReason::FailoverChanged);
        response.target.kind = SignedRemoteTargetKind::Primary;
        response.validator.reset();
        EXPECT_EQ(decideRemoteRepresentation(state, response).action,
            RemoteRepresentationAction::RestartAndResolve);
        response.validator = RepresentationValidator{
            "cloudflare_r2", RepresentationValidatorKind::StrongEtag, "\"changed\""};
        EXPECT_EQ(decideRemoteRepresentation(state, response).reason,
            RemoteRepresentationReason::ValidatorChanged);
        response.representationProviderId = "bunny_pull_cdn";
        response.validator = RepresentationValidator{
            "bunny_pull_cdn", RepresentationValidatorKind::StrongEtag, "\"etag-v1\""};
        EXPECT_EQ(decideRemoteRepresentation(state, response).reason,
            RemoteRepresentationReason::RepresentationProviderChanged);
        response.representationProviderId = "cloudflare_r2";
        response.validator = state.validator;
        response.providerId = "other-provider";
        EXPECT_EQ(decideRemoteRepresentation(state, response).reason,
            RemoteRepresentationReason::ProviderChanged);
    }

    TEST(SignedRemoteDownloadTransportTests, RepresentationDecisionNeverAppendsIgnoredOrUnsatisfiedRange)
    {
        RemoteArtifactResumeState state = validResumeState();
        SignedRemoteDownloadResponse response;
        response.outcome = SignedRemoteTransportOutcome::Success;
        response.providerId = "moddingflow";
        response.representationProviderId = "cloudflare_r2";
        response.statusCode = 200U;
        response.validator = RepresentationValidator{
            "cloudflare_r2", RepresentationValidatorKind::StrongEtag, "\"fresh\""};
        EXPECT_EQ(decideRemoteRepresentation(state, response).action,
            RemoteRepresentationAction::RestartFromBeginning);
        response.validator.reset();
        EXPECT_EQ(decideRemoteRepresentation(state, response).action,
            RemoteRepresentationAction::RestartAndResolve);
        response.statusCode = 416U;
        response.outcome = SignedRemoteTransportOutcome::RangeNotSatisfiable;
        EXPECT_EQ(decideRemoteRepresentation(state, response).action,
            RemoteRepresentationAction::RestartAndResolve);
    }

    TEST(SignedRemoteDownloadTransportTests, HeadDecisionRequiresExactSizeAndValidatorBeforeResume)
    {
        RemoteArtifactResumeState state = validResumeState();
        SignedRemoteDownloadResponse response;
        response.outcome = SignedRemoteTransportOutcome::Success;
        response.providerId = "moddingflow";
        response.representationProviderId = "cloudflare_r2";
        response.method = SignedRemoteHttpMethod::Head;
        response.target.kind = SignedRemoteTargetKind::Head;
        response.statusCode = 200U;
        response.contentLength = 3U;
        response.validator = state.validator;
        EXPECT_EQ(decideRemoteHeadRepresentation(state, response).action,
            RemoteRepresentationAction::Append);

        response.contentLength = 4U;
        EXPECT_EQ(decideRemoteHeadRepresentation(state, response).reason,
            RemoteRepresentationReason::RepresentationSizeChanged);
        response.contentLength = 3U;
        response.validator.reset();
        EXPECT_EQ(decideRemoteHeadRepresentation(state, response).action,
            RemoteRepresentationAction::RestartAndResolve);

        response.validator = state.validator;
        state.bytesReceived = 0U;
        state.validator.reset();
        EXPECT_EQ(decideRemoteHeadRepresentation(state, response).action,
            RemoteRepresentationAction::RestartFromBeginning);
    }

    TEST(SignedRemoteDownloadTransportTests, WindowsAdaptersConstructWithoutNetworkAccess)
    {
        const std::unique_ptr<ISignedRemoteAddressResolver> resolver =
            createSystemSignedRemoteAddressResolver();
        const std::unique_ptr<ISignedRemoteNetworkAdapter> adapter =
            createWinHttpSignedRemoteNetworkAdapter();
        EXPECT_NE(resolver, nullptr);
        EXPECT_NE(adapter, nullptr);
    }

    TEST(SignedRemoteDownloadTransportTests, ExplicitlyClearsCallerOwnedGrantSecrets)
    {
        ResolvedDownloadGrant grant = validGrant();
        grant.fallbackUrls = {
            "https://fallback.example.com/file.bin?signature=fallback-secret"};
        grant.transportHeaders.emplace("X-Legacy-Secret", "legacy-secret");

        clearResolvedDownloadGrantSecrets(grant);

        EXPECT_TRUE(grant.primaryUrl.empty());
        EXPECT_TRUE(grant.headUrl.empty());
        EXPECT_TRUE(grant.fallbackUrls.empty());
        EXPECT_TRUE(grant.transportHeaders.empty());
        EXPECT_EQ(grant.providerId, "moddingflow");
        EXPECT_EQ(grant.representationProviderId, "cloudflare_r2");
        EXPECT_EQ(grant.artifactId, "artifact-1");
        EXPECT_EQ(grant.grantId, "grant-1");
    }
}
