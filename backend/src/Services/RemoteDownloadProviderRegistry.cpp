#include "FluxoraCore/Services/RemoteDownloadProviderRegistry.hpp"

#include <mutex>
#include <stdexcept>
#include <utility>

namespace fluxora
{
    bool RemoteDownloadProviderRegistry::registerProvider(
        std::string providerId,
        std::shared_ptr<IRemoteDownloadResolver> resolver)
    {
        if (!isCanonicalRemoteDownloadProviderId(providerId))
        {
            throw std::invalid_argument("Remote download provider ID must be a canonical lowercase slug.");
        }
        if (resolver == nullptr)
        {
            throw std::invalid_argument("Remote download resolver is required.");
        }

        std::unique_lock lock(mutex_);
        return resolvers_.emplace(std::move(providerId), std::move(resolver)).second;
    }

    bool RemoteDownloadProviderRegistry::contains(std::string_view providerId) const
    {
        std::shared_lock lock(mutex_);
        return resolvers_.contains(std::string(providerId));
    }

    RemoteDownloadResolution RemoteDownloadProviderRegistry::resolve(
        const RemoteArtifactDownloadRequest& request) const
    {
        try
        {
            validateRemoteArtifactDownloadRequest(request);
        }
        catch (...)
        {
            return {
                .error = RemoteDownloadResolutionError::InvalidRequest,
                .message = "Remote download request is invalid.",
                .operationId = request.operationId};
        }

        std::shared_ptr<IRemoteDownloadResolver> resolver;
        {
            std::shared_lock lock(mutex_);
            const auto match = resolvers_.find(request.providerId);
            if (match == resolvers_.end())
            {
                return {
                    .error = RemoteDownloadResolutionError::UnknownProvider,
                    .message = "Remote download provider is not registered.",
                    .operationId = request.operationId};
            }
            resolver = match->second;
        }

        try
        {
            ResolvedDownloadGrant grant = resolver->resolve(request);
            try
            {
                validateResolvedDownloadGrant(grant, request);
            }
            catch (...)
            {
                clearResolvedDownloadGrantSecrets(grant);
                return {
                    .error = RemoteDownloadResolutionError::InvalidGrant,
                    .message = "Remote download provider returned an invalid grant.",
                    .operationId = request.operationId};
            }

            return {
                .grant = std::move(grant),
                .error = RemoteDownloadResolutionError::None,
                .operationId = request.operationId};
        }
        catch (...)
        {
            return {
                .error = RemoteDownloadResolutionError::ProviderFailure,
                .message = "Remote download provider failed while resolving the artifact.",
                .operationId = request.operationId};
        }
    }

    RemoteDownloadResolution RemoteDownloadProviderRegistry::resolveFallback(
        const RemoteDownloadFallbackRequest& request) const
    {
        try
        {
            validateRemoteDownloadFallbackRequest(request);
        }
        catch (...)
        {
            return {
                .error = RemoteDownloadResolutionError::InvalidRequest,
                .message = "Remote download fallback request is invalid.",
                .operationId = request.operationId};
        }

        std::shared_ptr<IRemoteDownloadResolver> resolver;
        {
            std::shared_lock lock(mutex_);
            const auto match = resolvers_.find(request.providerId);
            if (match == resolvers_.end())
            {
                return {
                    .error = RemoteDownloadResolutionError::UnknownProvider,
                    .message = "Remote download provider is not registered.",
                    .operationId = request.operationId};
            }
            resolver = match->second;
        }

        try
        {
            std::optional<ResolvedDownloadGrant> grant =
                resolver->resolveFallback(request);
            if (!grant.has_value())
            {
                return {
                    .error = RemoteDownloadResolutionError::FallbackUnsupported,
                    .message = "Remote download provider does not support fallback resolution.",
                    .operationId = request.operationId};
            }
            try
            {
                validateResolvedDownloadFallbackGrant(*grant, request);
            }
            catch (...)
            {
                clearResolvedDownloadGrantSecrets(*grant);
                return {
                    .error = RemoteDownloadResolutionError::InvalidGrant,
                    .message = "Remote download provider returned an invalid fallback grant.",
                    .operationId = request.operationId};
            }

            return {
                .grant = std::move(grant),
                .error = RemoteDownloadResolutionError::None,
                .operationId = request.operationId};
        }
        catch (...)
        {
            return {
                .error = RemoteDownloadResolutionError::ProviderFailure,
                .message = "Remote download provider failed while resolving fallback transport.",
                .operationId = request.operationId};
        }
    }
}
