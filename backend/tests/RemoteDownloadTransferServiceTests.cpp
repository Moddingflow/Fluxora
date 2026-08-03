#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "FluxoraCore/Services/RemoteDownloadTransferService.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <deque>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        class NeverCancelled final : public IRemoteDownloadCancellation
        {
        public:
            [[nodiscard]] bool isCancellationRequested() const noexcept override
            {
                return false;
            }
        };

        class ToggleCancellation final : public IRemoteDownloadCancellation
        {
        public:
            bool requested{false};

            [[nodiscard]] bool isCancellationRequested() const noexcept override
            {
                return requested;
            }
        };

        std::vector<std::byte> bytesOf(std::string_view value)
        {
            std::vector<std::byte> result(value.size());
            std::memcpy(result.data(), value.data(), value.size());
            return result;
        }

        std::string shaOf(const std::vector<std::byte>& bytes)
        {
            const std::wstring hash = computeFluxPackBytesSha256(bytes.data(), bytes.size());
            std::string result;
            result.reserve(hash.size());
            std::transform(hash.begin(), hash.end(), std::back_inserter(result),
                [](wchar_t value) { return static_cast<char>(value); });
            return result;
        }

        RemoteArtifactDownloadRequest artifactRequest()
        {
            return {
                .providerId = "moddingflow",
                .artifactId = "artifact-42",
                .modId = "mod-7",
                .versionId = "version-3",
                .jobId = "job-9",
                .operationId = L"operation-remote-transfer"};
        }

        RepresentationValidator validator(std::string value = "\"artifact-v1\"")
        {
            return {
                .providerId = "cloudflare_r2",
                .kind = RepresentationValidatorKind::StrongEtag,
                .value = std::move(value)};
        }

        ResolvedDownloadGrant grantFor(
            const std::vector<std::byte>& payload,
            std::string grantId = "grant-1",
            std::string representationProviderId = "cloudflare_r2")
        {
            return {
                .providerId = "moddingflow",
                .representationProviderId = std::move(representationProviderId),
                .artifactId = "artifact-42",
                .grantId = std::move(grantId),
                .primaryUrl = "https://downloads.example.invalid/artifact",
                .headUrl = "https://downloads.example.invalid/artifact/head",
                .fallbackUrls = {"https://fallback.example.invalid/artifact"},
                .transportHeaders = {{"Authorization", "Bearer secret-never-persist"}},
                .expiresAtUnixMs = 1'900'000'000'000ULL,
                .expectedSize = payload.size(),
                .expectedSha256 = shaOf(payload),
                .operationId = L"operation-remote-transfer"};
        }

        RemoteArtifactResumeState checkpointFor(
            const std::vector<std::byte>& payload,
            std::uint64_t bytesReceived,
            std::string representationProviderId = "cloudflare_r2")
        {
            return {
                .providerId = "moddingflow",
                .artifactId = "artifact-42",
                .modId = "mod-7",
                .versionId = "version-3",
                .jobId = "job-9",
                .grantId = "durable-grant",
                .expectedSize = payload.size(),
                .expectedSha256 = shaOf(payload),
                .bytesReceived = bytesReceived,
                .grantExpiresAtUnixMs = 1'850'000'000'000ULL,
                .validator = bytesReceived == 0U
                    ? std::nullopt
                    : std::optional<RepresentationValidator>(RepresentationValidator{
                        .providerId = std::move(representationProviderId),
                        .kind = RepresentationValidatorKind::StrongEtag,
                        .value = "\"artifact-v1\""}),
                .phase = RemoteArtifactResumePhase::Checkpointed};
        }

        ResolvedDownloadGrant fallbackGrantFor(
            const std::vector<std::byte>& payload,
            std::string grantId,
            std::string representationProviderId = "bunny_pull_cdn")
        {
            ResolvedDownloadGrant result = grantFor(
                payload,
                std::move(grantId),
                std::move(representationProviderId));
            result.primaryUrl = "https://fallback-on-demand.example.invalid/artifact";
            result.headUrl = "https://fallback-on-demand.example.invalid/artifact/head";
            result.fallbackUrls.clear();
            result.fallbackAvailable = false;
            result.transportHeaders.clear();
            return result;
        }

        ResolvedDownloadGrant externalGrantFor(
            const std::vector<std::byte>& payload,
            bool rangeSupported = true)
        {
            ResolvedDownloadGrant result = grantFor(
                payload,
                "external-grant",
                "github");
            result.headUrl = result.primaryUrl;
            result.fallbackUrls.clear();
            result.fallbackAvailable = false;
            result.headSupported = false;
            result.rangeSupported = rangeSupported;
            result.conditionalRequestsSupported = false;
            result.transportHeaders.clear();
            return result;
        }

        RemoteArtifactResumeState externalCheckpointFor(
            const std::vector<std::byte>& payload,
            std::uint64_t bytesReceived)
        {
            RemoteArtifactResumeState result = checkpointFor(
                payload,
                bytesReceived,
                "github");
            result.grantId = "external-grant";
            if (result.validator.has_value())
            {
                result.validator->kind = RepresentationValidatorKind::ContentSha256;
                result.validator->value = shaOf(payload);
            }
            return result;
        }

        class QueueResolver final : public IRemoteDownloadResolver
        {
        public:
            std::deque<ResolvedDownloadGrant> grants;
            std::deque<ResolvedDownloadGrant> fallbackGrants;
            std::size_t calls{0};
            std::size_t fallbackCalls{0};
            std::optional<RemoteDownloadFallbackRequest> lastFallbackRequest;

            [[nodiscard]] ResolvedDownloadGrant resolve(
                const RemoteArtifactDownloadRequest&) override
            {
                ++calls;
                if (grants.empty())
                {
                    throw std::runtime_error("No scripted grant.");
                }
                ResolvedDownloadGrant result = std::move(grants.front());
                grants.pop_front();
                return result;
            }

            [[nodiscard]] std::optional<ResolvedDownloadGrant> resolveFallback(
                const RemoteDownloadFallbackRequest& request) override
            {
                ++fallbackCalls;
                lastFallbackRequest = request;
                if (fallbackGrants.empty())
                {
                    return std::nullopt;
                }
                ResolvedDownloadGrant result = std::move(fallbackGrants.front());
                fallbackGrants.pop_front();
                return result;
            }
        };

        class FakeRemoteDownloadFileStore final : public IRemoteDownloadFileStore
        {
        public:
            class Writer final : public IRemoteDownloadFileWriter
            {
            public:
                Writer(FakeRemoteDownloadFileStore& owner, std::filesystem::path path)
                    : owner_(owner), path_(std::move(path)),
                      position_(owner_.files[path_].size())
                {
                }

                void append(std::span<const std::byte> bytes) override
                {
                    if (owner_.beforeAppend)
                    {
                        owner_.beforeAppend();
                    }
                    auto& target = owner_.files[path_];
                    target.insert(target.end(), bytes.begin(), bytes.end());
                    position_ = target.size();
                }

                void flush() override
                {
                    ++owner_.flushes;
                }

                [[nodiscard]] std::uint64_t position() const noexcept override
                {
                    return position_;
                }

            private:
                FakeRemoteDownloadFileStore& owner_;
                std::filesystem::path path_;
                std::uint64_t position_{0};
            };

            bool pathsSafe{true};
            std::map<std::filesystem::path, std::vector<std::byte>> files;
            std::function<void()> beforeAppend;
            std::size_t flushes{0};
            std::size_t promotions{0};
            bool collideOnPromotion{false};
            std::vector<std::byte> collisionBytes{std::byte{0x7f}};

            [[nodiscard]] RemoteDownloadPathValidation validatePaths(
                const std::filesystem::path&,
                const std::filesystem::path& partialPath,
                const std::filesystem::path& destinationPath,
                std::uint64_t) const override
            {
                return {
                    .safe = pathsSafe,
                    .partialPath = partialPath,
                    .destinationPath = destinationPath,
                    .message = pathsSafe ? "" : "unsafe"};
            }

            [[nodiscard]] bool exists(const std::filesystem::path& path) const override
            {
                return files.contains(path);
            }

            [[nodiscard]] std::optional<std::uint64_t> size(
                const std::filesystem::path& path) const override
            {
                const auto match = files.find(path);
                return match == files.end()
                    ? std::nullopt
                    : std::optional<std::uint64_t>(match->second.size());
            }

            void truncate(const std::filesystem::path& path, std::uint64_t size) override
            {
                files[path].resize(static_cast<std::size_t>(size));
            }

            [[nodiscard]] std::unique_ptr<IRemoteDownloadFileWriter> openWriter(
                const std::filesystem::path& path,
                std::uint64_t expectedOffset) override
            {
                if (files[path].size() != expectedOffset)
                {
                    throw std::runtime_error("Unexpected fake file offset.");
                }
                auto writer = std::make_unique<Writer>(*this, path);
                return writer;
            }

            [[nodiscard]] std::optional<std::string> sha256(
                const std::filesystem::path& path,
                const IRemoteDownloadCancellation& cancellation) const override
            {
                if (cancellation.isCancellationRequested())
                {
                    return std::nullopt;
                }
                const auto match = files.find(path);
                return match == files.end()
                    ? std::nullopt
                    : std::optional<std::string>(shaOf(match->second));
            }

            void remove(const std::filesystem::path& path) noexcept override
            {
                files.erase(path);
            }

            [[nodiscard]] RemoteDownloadPromotionOutcome promoteNoReplace(
                const std::filesystem::path& partialPath,
                const std::filesystem::path& destinationPath) override
            {
                ++promotions;
                if (collideOnPromotion && !files.contains(destinationPath))
                {
                    files.emplace(destinationPath, collisionBytes);
                }
                if (files.contains(destinationPath))
                {
                    return RemoteDownloadPromotionOutcome::DestinationExists;
                }
                const auto partial = files.find(partialPath);
                if (partial == files.end())
                {
                    return RemoteDownloadPromotionOutcome::Failure;
                }
                files.emplace(destinationPath, partial->second);
                files.erase(partial);
                return RemoteDownloadPromotionOutcome::Promoted;
            }
        };

        struct ScriptedExchange
        {
            SignedRemoteHttpMethod method{SignedRemoteHttpMethod::Get};
            SignedRemoteTargetKind target{SignedRemoteTargetKind::Primary};
            SignedRemoteDownloadResponse response;
            std::vector<std::byte> body;
        };

        class ScriptedTransport final
        {
        public:
            std::deque<ScriptedExchange> exchanges;
            std::vector<SignedRemoteDownloadRequest> requests;

            SignedRemoteDownloadResponse execute(
                const ResolvedDownloadGrant& grant,
                const SignedRemoteDownloadRequest& request,
                const IRemoteDownloadCancellation&,
                SignedRemoteChunkSink sink)
            {
                if (exchanges.empty())
                {
                    throw std::runtime_error("No scripted transport exchange.");
                }
                ScriptedExchange exchange = std::move(exchanges.front());
                exchanges.pop_front();
                if (exchange.method != request.method || exchange.target != request.target.kind)
                {
                    throw std::runtime_error("Unexpected scripted transport request.");
                }
                requests.push_back(request);
                exchange.response.providerId = grant.providerId;
                exchange.response.representationProviderId = grant.representationProviderId;
                exchange.response.method = request.method;
                exchange.response.target = request.target;
                if (!exchange.body.empty() && sink && !sink(exchange.body))
                {
                    exchange.response.outcome = SignedRemoteTransportOutcome::Cancelled;
                }
                exchange.response.bytesStreamed = exchange.body.size();
                exchange.response.operationId = request.operationId;
                return exchange.response;
            }
        };

        SignedRemoteDownloadResponse okHead(std::uint64_t size)
        {
            return {
                .outcome = SignedRemoteTransportOutcome::Success,
                .providerId = "moddingflow",
                .statusCode = 200,
                .contentLength = size,
                .validator = validator()};
        }

        SignedRemoteDownloadResponse okFull(std::uint64_t size)
        {
            return {
                .outcome = SignedRemoteTransportOutcome::Success,
                .providerId = "moddingflow",
                .statusCode = 200,
                .contentLength = size,
                .validator = validator()};
        }

        SignedRemoteDownloadResponse okRange(
            std::uint64_t start,
            std::uint64_t total)
        {
            return {
                .outcome = SignedRemoteTransportOutcome::Success,
                .providerId = "moddingflow",
                .statusCode = 206,
                .contentLength = total - start,
                .contentRange = SignedRemoteContentRange{
                    .start = start,
                    .end = total - 1U,
                    .total = total},
                .validator = validator()};
        }

        class FakeTransferHarness final
        {
        public:
            explicit FakeTransferHarness(const std::vector<std::byte>& payload)
                : resolver(std::make_shared<QueueResolver>()),
                  coordinator(registry),
                  service(
                      coordinator,
                      sidecars,
                      files,
                      [this](const auto& grant, const auto& request,
                          const auto& cancellation, auto sink)
                      {
                          return transport.execute(
                              grant, request, cancellation, std::move(sink));
                      },
                      [] { return 1'800'000'000'000ULL; })
            {
                if (!registry.registerProvider("moddingflow", resolver))
                {
                    throw std::runtime_error("Fake provider registration failed.");
                }
                request = {
                    .artifact = artifactRequest(),
                    .allowedRoot = temp.path(),
                    .partialPath = temp.path() / L"artifact.part",
                    .destinationPath = temp.path() / L"artifact.zip",
                    .checkpointIntervalBytes = 4U,
                    .maximumResolveAttempts = 3U};
                expectedPayload = payload;
            }

            TempDirectory temp;
            RemoteDownloadProviderRegistry registry;
            std::shared_ptr<QueueResolver> resolver;
            RemoteDownloadCoordinator coordinator;
            RemoteDownloadSidecarStore sidecars;
            FakeRemoteDownloadFileStore files;
            ScriptedTransport transport;
            RemoteDownloadTransferService service;
            RemoteDownloadTransferRequest request;
            std::vector<std::byte> expectedPayload;
        };
    }

    TEST(RemoteDownloadTransferServiceTests, FinalArtifactAppearsOnlyAfterExactSizeAndSha256Verification)
    {
        TempDirectory temp;
        const std::vector<std::byte> payload = bytesOf("verified payload");
        const std::filesystem::path partial = temp.path() / L"artifact.part";
        const std::filesystem::path destination = temp.path() / L"artifact.zip";

        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<QueueResolver>();
        resolver->grants.push_back(grantFor(payload));
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));
        RemoteDownloadCoordinator coordinator(registry);
        RemoteDownloadSidecarStore sidecars;
        FakeRemoteDownloadFileStore files;
        files.beforeAppend = [&]
        {
            EXPECT_FALSE(files.exists(destination));
        };
        ScriptedTransport transport;
        transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        RemoteDownloadTransferService service(
            coordinator,
            sidecars,
            files,
            [&](const auto& grant, const auto& request, const auto& cancellation, auto sink)
            {
                return transport.execute(grant, request, cancellation, std::move(sink));
            },
            [] { return 1'800'000'000'000ULL; });

        RemoteDownloadTransferRequest request{
            .artifact = artifactRequest(),
            .allowedRoot = temp.path(),
            .partialPath = partial,
            .destinationPath = destination,
            .checkpointIntervalBytes = 4};
        NeverCancelled cancellation;
        const RemoteDownloadTransferResult result = service.transfer(request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed)
            << result.message;
        ASSERT_TRUE(result.finalPath.has_value());
        EXPECT_EQ(*result.finalPath, destination);
        EXPECT_FALSE(files.exists(partial));
        ASSERT_TRUE(files.exists(destination));
        EXPECT_EQ(files.files.at(destination), payload);
        EXPECT_FALSE(std::filesystem::exists(RemoteDownloadSidecarStore::sidecarPathFor(partial)));
        EXPECT_FALSE(std::filesystem::exists(AtomicFileStore::backupPathFor(
            RemoteDownloadSidecarStore::sidecarPathFor(partial))));
        EXPECT_EQ(files.promotions, 1U);
        EXPECT_GE(files.flushes, 4U);
        ASSERT_EQ(transport.requests.size(), 2U);
        EXPECT_EQ(transport.requests[0].method, SignedRemoteHttpMethod::Head);
        EXPECT_EQ(transport.requests[1].method, SignedRemoteHttpMethod::Get);
        EXPECT_FALSE(transport.requests[1].rangeStart.has_value());
    }

    TEST(RemoteDownloadTransferServiceTests, ExternalReferenceSkipsHeadAndFallbackBeforeFinalHashPromotion)
    {
        const std::vector<std::byte> payload = bytesOf("external-provider-payload");
        FakeTransferHarness harness(payload);
        harness.resolver->grants.push_back(externalGrantFor(payload));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed)
            << result.message;
        ASSERT_EQ(harness.transport.requests.size(), 1U);
        EXPECT_EQ(harness.transport.requests.front().method, SignedRemoteHttpMethod::Get);
        EXPECT_FALSE(harness.transport.requests.front().rangeStart.has_value());
        EXPECT_FALSE(harness.transport.requests.front().ifMatch.has_value());
        EXPECT_EQ(harness.resolver->fallbackCalls, 0U);
        EXPECT_EQ(harness.files.files.at(harness.request.destinationPath), payload);
    }

    TEST(RemoteDownloadTransferServiceTests, ExternalReferenceResumesByHashWithoutIfMatch)
    {
        const std::vector<std::byte> payload = bytesOf("external-provider-resume");
        FakeTransferHarness harness(payload);
        const std::uint64_t checkpoint = 7U;
        harness.resolver->grants.push_back(externalGrantFor(payload));
        harness.files.files[harness.request.partialPath] = std::vector<std::byte>(
            payload.begin(), payload.begin() + static_cast<std::ptrdiff_t>(checkpoint));
        harness.sidecars.save(
            harness.request.partialPath,
            externalCheckpointFor(payload, checkpoint));
        SignedRemoteDownloadResponse response = okRange(checkpoint, payload.size());
        response.validator.reset();
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = response,
            .body = std::vector<std::byte>(
                payload.begin() + static_cast<std::ptrdiff_t>(checkpoint), payload.end())});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed)
            << result.message;
        ASSERT_EQ(harness.transport.requests.size(), 1U);
        ASSERT_TRUE(harness.transport.requests.front().rangeStart.has_value());
        EXPECT_EQ(*harness.transport.requests.front().rangeStart, checkpoint);
        EXPECT_FALSE(harness.transport.requests.front().ifMatch.has_value());
        EXPECT_EQ(harness.resolver->fallbackCalls, 0U);
        EXPECT_EQ(harness.files.files.at(harness.request.destinationPath), payload);
    }

    TEST(RemoteDownloadCoordinatorFallbackTests, CreatesFreshZeroByteStateForDistinctRepresentationScope)
    {
        const std::vector<std::byte> payload = bytesOf("coordinator-fallback");
        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<QueueResolver>();
        resolver->fallbackGrants.push_back(
            fallbackGrantFor(payload, "durable-grant", "bunny_pull_cdn"));
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));
        RemoteDownloadCoordinator coordinator(registry);
        RemoteArtifactResumeState current = checkpointFor(payload, 4U, "cloudflare_r2");

        const RemoteDownloadPreparation preparation = coordinator.resolveFallback(
            current,
            "cloudflare_r2",
            L"operation-remote-transfer");

        EXPECT_EQ(preparation.error, RemoteDownloadResolutionError::None)
            << preparation.message;
        EXPECT_EQ(resolver->fallbackCalls, 1U);
        ASSERT_TRUE(preparation.grant.has_value());
        ASSERT_TRUE(preparation.state.has_value());
        EXPECT_EQ(preparation.grant->representationProviderId, "bunny_pull_cdn");
        EXPECT_EQ(preparation.state->bytesReceived, 0U);
        EXPECT_FALSE(preparation.state->validator.has_value());
        EXPECT_EQ(preparation.state->phase, RemoteArtifactResumePhase::AwaitingRepresentation);
    }

    TEST(RemoteDownloadTransferServiceTests, CrashTailIsRolledBackAndFreshHeadPrecedesRangedResume)
    {
        const std::vector<std::byte> payload = bytesOf("resume-after-crash");
        FakeTransferHarness harness(payload);
        const std::uint64_t checkpoint = 6U;
        harness.resolver->grants.push_back(grantFor(payload));
        harness.files.files[harness.request.partialPath] = std::vector<std::byte>(
            payload.begin(), payload.begin() + static_cast<std::ptrdiff_t>(checkpoint + 3U));
        harness.sidecars.save(
            harness.request.partialPath,
            checkpointFor(payload, checkpoint));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okRange(checkpoint, payload.size()),
            .body = std::vector<std::byte>(
                payload.begin() + static_cast<std::ptrdiff_t>(checkpoint), payload.end())});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed);
        ASSERT_EQ(harness.transport.requests.size(), 2U);
        EXPECT_EQ(harness.transport.requests[0].method, SignedRemoteHttpMethod::Head);
        ASSERT_TRUE(harness.transport.requests[1].rangeStart.has_value());
        EXPECT_EQ(*harness.transport.requests[1].rangeStart, checkpoint);
        ASSERT_TRUE(harness.transport.requests[1].ifMatch.has_value());
        EXPECT_EQ(harness.transport.requests[1].ifMatch->providerId, "cloudflare_r2");
        EXPECT_EQ(harness.files.files.at(harness.request.destinationPath), payload);
    }

    TEST(RemoteDownloadTransferServiceTests, RangeIgnoredResponseRestartsWithoutAppendingItsBody)
    {
        const std::vector<std::byte> payload = bytesOf("range-ignored-restart");
        FakeTransferHarness harness(payload);
        const std::uint64_t checkpoint = 5U;
        harness.resolver->grants.push_back(grantFor(payload));
        harness.files.files[harness.request.partialPath] = std::vector<std::byte>(
            payload.begin(), payload.begin() + static_cast<std::ptrdiff_t>(checkpoint));
        harness.sidecars.save(
            harness.request.partialPath,
            checkpointFor(payload, checkpoint));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed);
        ASSERT_EQ(harness.transport.requests.size(), 3U);
        EXPECT_TRUE(harness.transport.requests[1].rangeStart.has_value());
        EXPECT_FALSE(harness.transport.requests[2].rangeStart.has_value());
        EXPECT_EQ(harness.files.files.at(harness.request.destinationPath), payload);
    }

    TEST(RemoteDownloadTransferServiceTests, AuthorizationExpiryReResolvesWithinBound)
    {
        const std::vector<std::byte> payload = bytesOf("fresh-grant-after-401");
        FakeTransferHarness harness(payload);
        harness.resolver->grants.push_back(grantFor(payload, "expired-grant"));
        harness.resolver->grants.push_back(grantFor(payload, "fresh-grant"));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = SignedRemoteDownloadResponse{
                .outcome = SignedRemoteTransportOutcome::Unauthorized,
                .statusCode = 401}});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed);
        EXPECT_EQ(harness.resolver->calls, 2U);
        EXPECT_EQ(harness.resolver->fallbackCalls, 0U);
        EXPECT_EQ(harness.transport.requests[0].method, SignedRemoteHttpMethod::Head);
        EXPECT_EQ(harness.transport.requests[1].method, SignedRemoteHttpMethod::Head);
    }

    TEST(RemoteDownloadTransferServiceTests, Range416ReResolvesAndNeverAppendsTheOldRepresentation)
    {
        const std::vector<std::byte> payload = bytesOf("range-416-refresh");
        FakeTransferHarness harness(payload);
        const std::uint64_t checkpoint = 4U;
        harness.files.files[harness.request.partialPath] = std::vector<std::byte>(
            payload.begin(), payload.begin() + static_cast<std::ptrdiff_t>(checkpoint));
        harness.sidecars.save(
            harness.request.partialPath,
            checkpointFor(payload, checkpoint));
        harness.resolver->grants.push_back(grantFor(payload, "range-expired"));
        harness.resolver->grants.push_back(grantFor(payload, "range-fresh"));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = SignedRemoteDownloadResponse{
                .outcome = SignedRemoteTransportOutcome::RangeNotSatisfiable,
                .statusCode = 416}});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed);
        EXPECT_EQ(harness.resolver->calls, 2U);
        ASSERT_EQ(harness.transport.requests.size(), 4U);
        EXPECT_TRUE(harness.transport.requests[1].rangeStart.has_value());
        EXPECT_FALSE(harness.transport.requests[3].rangeStart.has_value());
    }

    TEST(RemoteDownloadTransferServiceTests, MissingEtagForcesBoundedFreshResolution)
    {
        const std::vector<std::byte> payload = bytesOf("missing-etag-refresh");
        FakeTransferHarness harness(payload);
        harness.request.maximumResolveAttempts = 2U;
        harness.resolver->grants.push_back(grantFor(payload, "missing-etag"));
        harness.resolver->grants.push_back(grantFor(payload, "fresh-etag"));
        SignedRemoteDownloadResponse missing = okHead(payload.size());
        missing.validator.reset();
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = missing});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed);
        EXPECT_EQ(harness.resolver->calls, 2U);
    }

    TEST(RemoteDownloadTransferServiceTests, RateLimitPersistsOnlyBoundedSecretFreeRetryState)
    {
        const std::vector<std::byte> payload = bytesOf("rate-limited");
        FakeTransferHarness harness(payload);
        harness.request.maximumRetryAfterSeconds = 10U;
        harness.resolver->grants.push_back(grantFor(payload));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = SignedRemoteDownloadResponse{
                .outcome = SignedRemoteTransportOutcome::RateLimited,
                .statusCode = 429,
                .retryAfterSeconds = 9'999U}});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::RetryScheduled);
        EXPECT_TRUE(result.resumableStateRetained);
        EXPECT_EQ(harness.resolver->fallbackCalls, 0U);
        ASSERT_TRUE(result.retryAtUnixMs.has_value());
        EXPECT_EQ(*result.retryAtUnixMs, 1'800'000'010'000ULL);
        const RemoteDownloadSidecarLoadResult loaded =
            harness.sidecars.load(harness.request.partialPath);
        ASSERT_TRUE(loaded.state.has_value());
        EXPECT_EQ(loaded.state->phase, RemoteArtifactResumePhase::RetryScheduled);
        const std::string document = readTextFile(
            RemoteDownloadSidecarStore::sidecarPathFor(harness.request.partialPath));
        EXPECT_EQ(document.find("https://"), std::string::npos);
        EXPECT_EQ(document.find("Bearer"), std::string::npos);
    }

    TEST(RemoteDownloadTransferServiceTests, FallbackSuccessIsAReResolveBoundaryBeforeVisibility)
    {
        const std::vector<std::byte> payload = bytesOf("provider-failover");
        FakeTransferHarness harness(payload);
        harness.resolver->grants.push_back(grantFor(payload, "grant-before-failover"));
        harness.resolver->grants.push_back(grantFor(payload, "grant-after-failover"));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = SignedRemoteDownloadResponse{
                .outcome = SignedRemoteTransportOutcome::NetworkFailure}});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Fallback,
            .response = okFull(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed);
        EXPECT_EQ(harness.resolver->calls, 2U);
        ASSERT_EQ(harness.transport.requests.size(), 5U);
        EXPECT_EQ(harness.transport.requests[2].target.kind, SignedRemoteTargetKind::Fallback);
        EXPECT_FALSE(harness.files.exists(harness.request.partialPath));
    }

    TEST(RemoteDownloadTransferServiceTests, OnDemandFallbackDropsOldScopeAndRestartsWithStableSessionIdentity)
    {
        const std::vector<std::byte> payload = bytesOf("on-demand-provider-failover");
        FakeTransferHarness harness(payload);
        const std::uint64_t checkpoint = 7U;
        harness.files.files[harness.request.partialPath] = std::vector<std::byte>(
            payload.begin(), payload.begin() + static_cast<std::ptrdiff_t>(checkpoint));
        harness.sidecars.save(
            harness.request.partialPath,
            checkpointFor(payload, checkpoint, "cloudflare_r2"));
        harness.resolver->grants.push_back(
            grantFor(payload, "download-session-1", "cloudflare_r2"));
        harness.resolver->fallbackGrants.push_back(
            fallbackGrantFor(payload, "download-session-1", "bunny_pull_cdn"));

        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = SignedRemoteDownloadResponse{
                .outcome = SignedRemoteTransportOutcome::NetworkFailure}});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Fallback,
            .response = SignedRemoteDownloadResponse{
                .outcome = SignedRemoteTransportOutcome::Timeout}});
        SignedRemoteDownloadResponse fallbackHead = okHead(payload.size());
        fallbackHead.validator->providerId = "bunny_pull_cdn";
        SignedRemoteDownloadResponse fallbackFull = okFull(payload.size());
        fallbackFull.validator->providerId = "bunny_pull_cdn";
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = fallbackHead});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = fallbackFull,
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed)
            << result.message;
        EXPECT_EQ(harness.resolver->calls, 1U);
        EXPECT_EQ(harness.resolver->fallbackCalls, 1U);
        EXPECT_EQ(harness.transport.requests.size(), 5U);
        ASSERT_TRUE(harness.resolver->lastFallbackRequest.has_value());
        EXPECT_EQ(
            harness.resolver->lastFallbackRequest->grantId,
            "download-session-1");
        EXPECT_EQ(
            harness.resolver->lastFallbackRequest->currentRepresentationProviderId,
            "cloudflare_r2");
        EXPECT_EQ(
            harness.resolver->lastFallbackRequest->expectedSha256,
            shaOf(payload));
        ASSERT_EQ(harness.transport.requests.size(), 5U);
        ASSERT_TRUE(harness.transport.requests[1].rangeStart.has_value());
        EXPECT_EQ(*harness.transport.requests[1].rangeStart, checkpoint);
        EXPECT_EQ(harness.transport.requests[2].target.kind, SignedRemoteTargetKind::Fallback);
        EXPECT_FALSE(harness.transport.requests[4].rangeStart.has_value());
        EXPECT_EQ(harness.files.files.at(harness.request.destinationPath), payload);
    }

    TEST(RemoteDownloadTransferServiceTests, RepresentationScopeChangeTruncatesBeforeFreshFullDownload)
    {
        const std::vector<std::byte> payload = bytesOf("scope-change-restart");
        FakeTransferHarness harness(payload);
        const std::uint64_t checkpoint = 5U;
        harness.files.files[harness.request.partialPath] = std::vector<std::byte>(
            payload.begin(), payload.begin() + static_cast<std::ptrdiff_t>(checkpoint));
        harness.sidecars.save(
            harness.request.partialPath,
            checkpointFor(payload, checkpoint, "cloudflare_r2"));
        harness.resolver->grants.push_back(
            grantFor(payload, "scope-changed", "bunny_pull_cdn"));
        harness.resolver->grants.push_back(
            grantFor(payload, "scope-fresh", "bunny_pull_cdn"));
        SignedRemoteDownloadResponse changedHead = okHead(payload.size());
        changedHead.validator->providerId = "bunny_pull_cdn";
        SignedRemoteDownloadResponse freshHead = changedHead;
        SignedRemoteDownloadResponse freshFull = okFull(payload.size());
        freshFull.validator->providerId = "bunny_pull_cdn";
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = changedHead});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = freshHead});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = freshFull,
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Completed);
        EXPECT_EQ(harness.resolver->calls, 2U);
        ASSERT_EQ(harness.transport.requests.size(), 3U);
        EXPECT_TRUE(harness.transport.requests[0].method == SignedRemoteHttpMethod::Head);
        EXPECT_FALSE(harness.transport.requests[2].rangeStart.has_value());
        EXPECT_EQ(harness.files.files.at(harness.request.destinationPath), payload);
    }

    TEST(RemoteDownloadTransferServiceTests, HashMismatchRemovesPartialAndSidecarWithoutDestination)
    {
        const std::vector<std::byte> payload = bytesOf("tampered-payload");
        FakeTransferHarness harness(payload);
        ResolvedDownloadGrant grant = grantFor(payload);
        grant.expectedSha256.assign(64U, '0');
        harness.resolver->grants.push_back(std::move(grant));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::IntegrityFailure);
        EXPECT_FALSE(harness.files.exists(harness.request.partialPath));
        EXPECT_FALSE(harness.files.exists(harness.request.destinationPath));
        EXPECT_FALSE(std::filesystem::exists(
            RemoteDownloadSidecarStore::sidecarPathFor(harness.request.partialPath)));
    }

    TEST(RemoteDownloadTransferServiceTests, TruncatedSuccessIsProtocolFailureAndIsNotResumable)
    {
        const std::vector<std::byte> payload = bytesOf("truncated-response");
        FakeTransferHarness harness(payload);
        harness.request.maximumResolveAttempts = 1U;
        harness.resolver->grants.push_back(grantFor(payload));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = std::vector<std::byte>(payload.begin(), payload.end() - 2)});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::ProtocolFailure);
        EXPECT_FALSE(result.resumableStateRetained);
        EXPECT_EQ(harness.resolver->fallbackCalls, 0U);
        EXPECT_FALSE(harness.files.exists(harness.request.partialPath));
        EXPECT_FALSE(harness.files.exists(harness.request.destinationPath));
    }

    TEST(RemoteDownloadTransferServiceTests, CancellationRetainsOnlyCheckpointedStateWithoutSecrets)
    {
        const std::vector<std::byte> payload = bytesOf("cancel-after-checkpoint");
        FakeTransferHarness harness(payload);
        harness.resolver->grants.push_back(grantFor(payload));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        ToggleCancellation cancellation;
        std::size_t writes = 0U;
        harness.files.beforeAppend = [&]
        {
            if (++writes == 1U)
            {
                cancellation.requested = true;
            }
        };

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::Cancelled);
        EXPECT_TRUE(result.resumableStateRetained);
        EXPECT_EQ(result.bytesReceived, 4U);
        ASSERT_TRUE(harness.files.size(harness.request.partialPath).has_value());
        EXPECT_EQ(*harness.files.size(harness.request.partialPath), 4U);
        EXPECT_FALSE(harness.files.exists(harness.request.destinationPath));
        const std::string document = readTextFile(
            RemoteDownloadSidecarStore::sidecarPathFor(harness.request.partialPath));
        EXPECT_EQ(document.find("https://"), std::string::npos);
        EXPECT_EQ(document.find("Authorization"), std::string::npos);
        EXPECT_EQ(document.find("secret-never-persist"), std::string::npos);
    }

    TEST(RemoteDownloadTransferServiceTests, FinalCollisionNeverOverwritesAndRetainsVerifiedPartial)
    {
        const std::vector<std::byte> payload = bytesOf("collision-safe-payload");
        FakeTransferHarness harness(payload);
        harness.files.collideOnPromotion = true;
        const std::vector<std::byte> collision = bytesOf("existing-final");
        harness.files.collisionBytes = collision;
        harness.resolver->grants.push_back(grantFor(payload));
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Head,
            .target = SignedRemoteTargetKind::Head,
            .response = okHead(payload.size())});
        harness.transport.exchanges.push_back({
            .method = SignedRemoteHttpMethod::Get,
            .target = SignedRemoteTargetKind::Primary,
            .response = okFull(payload.size()),
            .body = payload});
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::DestinationExists);
        EXPECT_TRUE(result.resumableStateRetained);
        EXPECT_EQ(harness.files.files.at(harness.request.destinationPath), collision);
        EXPECT_EQ(harness.files.files.at(harness.request.partialPath), payload);
        EXPECT_TRUE(std::filesystem::is_regular_file(
            RemoteDownloadSidecarStore::sidecarPathFor(harness.request.partialPath)));
    }

    TEST(RemoteDownloadTransferServiceTests, ExistingFinalCleansStaleSidecarOnlyWhenNoPartialRemains)
    {
        const std::vector<std::byte> payload = bytesOf("already-promoted");
        FakeTransferHarness harness(payload);
        harness.files.files[harness.request.destinationPath] = payload;
        harness.sidecars.save(
            harness.request.partialPath,
            checkpointFor(payload, 4U));
        ASSERT_TRUE(std::filesystem::exists(
            RemoteDownloadSidecarStore::sidecarPathFor(harness.request.partialPath)));
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::DestinationExists);
        EXPECT_FALSE(result.resumableStateRetained);
        EXPECT_EQ(harness.resolver->calls, 0U);
        EXPECT_FALSE(std::filesystem::exists(
            RemoteDownloadSidecarStore::sidecarPathFor(harness.request.partialPath)));
        EXPECT_EQ(harness.files.files.at(harness.request.destinationPath), payload);
    }

    TEST(RemoteDownloadTransferServiceTests, UnsafeFakePathStopsBeforeResolverAndTransport)
    {
        const std::vector<std::byte> payload = bytesOf("never-downloaded");
        FakeTransferHarness harness(payload);
        harness.files.pathsSafe = false;
        NeverCancelled cancellation;

        const RemoteDownloadTransferResult result =
            harness.service.transfer(harness.request, cancellation);

        EXPECT_EQ(result.outcome, RemoteDownloadTransferOutcome::UnsafePath);
        EXPECT_EQ(harness.resolver->calls, 0U);
        EXPECT_TRUE(harness.transport.requests.empty());
    }

    TEST(RemoteDownloadFileStoreTests, RejectsPathEscapeAndAtomicallyRefusesReplacement)
    {
        TempDirectory temp;
        RemoteDownloadFileStore files;
        const std::filesystem::path root = temp.path() / L"allowed";
        std::filesystem::create_directories(root);
        const std::filesystem::path partial = root / L"artifact.part";
        const std::filesystem::path destination = root / L"artifact.zip";
        const std::filesystem::path escaped = temp.path() / L"escaped.zip";

        EXPECT_FALSE(files.validatePaths(root, partial, escaped, 1U).safe);
        ASSERT_TRUE(files.validatePaths(root, partial, destination, 1U).safe);
        writeTextFile(partial, "verified-partial");
        writeTextFile(destination, "existing-final");
        NeverCancelled cancellation;
        const std::vector<std::byte> expectedBytes = bytesOf("verified-partial");
        ASSERT_TRUE(files.sha256(partial, cancellation).has_value());
        EXPECT_EQ(*files.sha256(partial, cancellation), shaOf(expectedBytes));

        EXPECT_EQ(
            files.promoteNoReplace(partial, destination),
            RemoteDownloadPromotionOutcome::DestinationExists);
        EXPECT_EQ(readTextFile(destination), "existing-final");
        EXPECT_EQ(readTextFile(partial), "verified-partial");

        std::filesystem::remove(destination);
        EXPECT_EQ(
            files.promoteNoReplace(partial, destination),
            RemoteDownloadPromotionOutcome::Promoted);
        EXPECT_EQ(readTextFile(destination), "verified-partial");
        EXPECT_FALSE(std::filesystem::exists(partial));
    }
}
