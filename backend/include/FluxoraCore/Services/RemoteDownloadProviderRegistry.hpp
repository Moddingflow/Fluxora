#pragma once

#include "FluxoraCore/Services/RemoteDownloadContracts.hpp"

#include <memory>
#include <shared_mutex>
#include <string>
#include <string_view>
#include <unordered_map>

namespace fluxora
{
    class IRemoteDownloadResolver
    {
    public:
        virtual ~IRemoteDownloadResolver() = default;
        [[nodiscard]] virtual ResolvedDownloadGrant resolve(
            const RemoteArtifactDownloadRequest& request) = 0;

        [[nodiscard]] virtual std::optional<ResolvedDownloadGrant> resolveFallback(
            const RemoteDownloadFallbackRequest& request)
        {
            static_cast<void>(request);
            return std::nullopt;
        }
    };

    enum class RemoteDownloadResolutionError
    {
        None,
        InvalidRequest,
        UnknownProvider,
        ProviderFailure,
        InvalidGrant,
        FallbackUnsupported
    };

    struct RemoteDownloadResolution
    {
        std::optional<ResolvedDownloadGrant> grant;
        RemoteDownloadResolutionError error{RemoteDownloadResolutionError::None};
        std::string message;
        std::wstring operationId;
    };

    class RemoteDownloadProviderRegistry final
    {
    public:
        [[nodiscard]] bool registerProvider(
            std::string providerId,
            std::shared_ptr<IRemoteDownloadResolver> resolver);

        [[nodiscard]] bool contains(std::string_view providerId) const;

        [[nodiscard]] RemoteDownloadResolution resolve(
            const RemoteArtifactDownloadRequest& request) const;

        [[nodiscard]] RemoteDownloadResolution resolveFallback(
            const RemoteDownloadFallbackRequest& request) const;

    private:
        mutable std::shared_mutex mutex_;
        std::unordered_map<std::string, std::shared_ptr<IRemoteDownloadResolver>> resolvers_;
    };
}
