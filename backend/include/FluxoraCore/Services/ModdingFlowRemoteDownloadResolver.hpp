#pragma once

#include "FluxoraCore/Services/ModdingFlowPublicApiClient.hpp"
#include "FluxoraCore/Services/RemoteDownloadProviderRegistry.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>

namespace fluxora
{
    struct ModdingFlowRemoteDownloadResolverOptions
    {
        std::size_t maximumResponseBytes{512U * 1024U};
        std::chrono::seconds minimumRemainingLifetime{std::chrono::seconds(5)};
        std::chrono::seconds maximumLifetime{std::chrono::hours(24)};
        std::function<std::uint64_t()> nowUnixMilliseconds;
    };

    // Provider control-plane adapter only. Signed transport material exists only
    // in the returned in-memory grant and is never copied into durable state.
    class ModdingFlowRemoteDownloadResolver final : public IRemoteDownloadResolver
    {
    public:
        explicit ModdingFlowRemoteDownloadResolver(
            IModdingFlowPublicApiClient& client,
            ModdingFlowRemoteDownloadResolverOptions options = {});

        [[nodiscard]] ResolvedDownloadGrant resolve(
            const RemoteArtifactDownloadRequest& request) override;

        [[nodiscard]] std::optional<ResolvedDownloadGrant> resolveFallback(
            const RemoteDownloadFallbackRequest& request) override;

    private:
        IModdingFlowPublicApiClient& client_;
        ModdingFlowRemoteDownloadResolverOptions options_;
    };
}
