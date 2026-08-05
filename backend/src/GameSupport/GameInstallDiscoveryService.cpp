#include "FluxoraCore/GameSupport/GameInstallDiscoveryService.hpp"

#include "FluxoraCore/GameSupport/GameDetectionService.hpp"
#include "FluxoraCore/GameSupport/GameHealthCheckService.hpp"
#include "FluxoraCore/Services/Logger.hpp"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <set>
#include <stdexcept>
#include <utility>

namespace fluxora
{
    namespace
    {
        [[nodiscard]] std::wstring normalizedPathKey(const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::path normalized = std::filesystem::weakly_canonical(path, error);
            if (error)
            {
                error.clear();
                normalized = std::filesystem::absolute(path, error).lexically_normal();
            }
            std::wstring key = normalized.wstring();
#ifdef _WIN32
            std::transform(key.begin(), key.end(), key.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
#endif
            return key;
        }

        [[nodiscard]] std::filesystem::path canonicalPath(
            const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::path canonical = std::filesystem::canonical(path, error);
            if (!error)
            {
                return canonical;
            }

            error.clear();
            return std::filesystem::absolute(path, error).lexically_normal();
        }

        [[nodiscard]] const GameExecutableDefinition* primaryExecutableFor(
            const GameDefinition& definition)
        {
            const auto found = std::find_if(
                definition.executables.begin(),
                definition.executables.end(),
                [](const GameExecutableDefinition& executable)
                {
                    return executable.role == GameExecutableRole::Primary;
                });
            return found == definition.executables.end() ? nullptr : &*found;
        }

        [[nodiscard]] std::optional<std::filesystem::path> validateCandidate(
            const GameSupportRegistry& registry,
            const GameDefinition& definition,
            const GameInstallDiscoveryCandidate& candidate)
        {
            const GameExecutableDefinition* primary = primaryExecutableFor(definition);
            if (primary == nullptr || candidate.installPath.empty())
            {
                return std::nullopt;
            }

            const auto parsedCandidateName =
                ExecutableName::parse(candidate.installPath.filename().wstring());
            const std::wstring candidateName = parsedCandidateName
                ? parsedCandidateName.value().normalizedName()
                : std::wstring{};
            const bool candidateIsPrimaryExecutable =
                !candidateName.empty() && candidateName == primary->name.normalizedName();
            const std::filesystem::path installDirectory = candidateIsPrimaryExecutable
                ? candidate.installPath.parent_path()
                : candidate.installPath;
            const std::filesystem::path primaryPath = candidateIsPrimaryExecutable
                ? candidate.installPath
                : installDirectory / primary->name.displayName();

            std::error_code error;
            if (!std::filesystem::is_regular_file(primaryPath, error) || error)
            {
                return std::nullopt;
            }

            GameDetectionRequest detectionRequest;
            detectionRequest.manualGameId = definition.id;
            detectionRequest.installPath = installDirectory;
            const GameDetectionResult detection = GameDetectionService(registry).detect(detectionRequest);
            if (!detection.detected || detection.definition == nullptr ||
                detection.definition->id != definition.id)
            {
                return std::nullopt;
            }

            const GameHealthCheckResult health = GameHealthCheckService().check(detection);
            if (!health.allowsAutomation())
            {
                return std::nullopt;
            }

            const std::filesystem::path canonical = canonicalPath(primaryPath);
            const auto parsedName = ExecutableName::parse(canonical.filename().wstring());
            if (!parsedName || parsedName.value().normalizedName() != primary->name.normalizedName())
            {
                return std::nullopt;
            }
            return canonical;
        }

        [[nodiscard]] std::wstring cacheKey(
            const GameDefinition& definition,
            GameInstallDiscoveryProviderId providerId,
            const GameInstallDiscoveryRequest& request)
        {
            return definition.id.value() + L"|" + definition.definitionVersion + L"|" +
                std::wstring(gameInstallDiscoveryProviderIdName(providerId)) + L"|" +
                normalizedPathKey(request.buildConfigsDirectory);
        }

        [[nodiscard]] std::string narrowAscii(std::wstring_view value)
        {
            std::string result;
            result.reserve(value.size());
            for (wchar_t character : value)
            {
                result.push_back(character <= 0x7f ? static_cast<char>(character) : '?');
            }
            return result;
        }
    }

    GameInstallDiscoveryService::GameInstallDiscoveryService(
        Logger* logger,
        const GameSupportRegistry& registry,
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers)
        : logger_(logger),
          registry_(registry),
          providers_(std::move(providers))
    {
        std::set<GameInstallDiscoveryProviderId> unique;
        for (const auto& provider : providers_)
        {
            if (provider == nullptr || !unique.insert(provider->id()).second)
            {
                throw std::invalid_argument(
                    "Game install discovery providers must be non-null and unique.");
            }
        }
    }

    GameInstallDiscoverySnapshot GameInstallDiscoveryService::discover(
        const GameInstallDiscoveryRequest& request) const
    {
        GameInstallDiscoverySnapshot snapshot;
        snapshot.operationId = request.operationId;
        snapshot.installs.reserve(registry_.definitions().size());

        for (const GameDefinition& definition : registry_.definitions())
        {
            GameInstallResolution resolution;
            resolution.templateId = definition.uiTemplateId.value();
            bool indeterminate = false;

            for (const GameInstallDiscoveryProviderDefinition& declared :
                 definition.installDiscovery.providers)
            {
                const auto startedAt = std::chrono::steady_clock::now();
                const IGameInstallDiscoveryProvider* provider = providerFor(declared.id);
                if (provider == nullptr)
                {
                    indeterminate = true;
                    logProviderOutcome(definition, declared.id, L"unavailable", 0, 0);
                    continue;
                }

                try
                {
                    const std::wstring fingerprint = provider->fingerprint(definition, request);
                    const std::wstring key = cacheKey(definition, declared.id, request);
                    GameInstallProviderScan scan;
                    bool cacheHit = false;
                    {
                        std::lock_guard lock(cacheMutex_);
                        const auto cached = cache_.find(key);
                        if (cached != cache_.end() && cached->second.fingerprint == fingerprint)
                        {
                            scan = cached->second.scan;
                            cacheHit = true;
                        }
                    }
                    if (!cacheHit)
                    {
                        scan = provider->scan(definition, request);
                        if (!scan.hadErrors)
                        {
                            std::lock_guard lock(cacheMutex_);
                            cache_.insert_or_assign(key, CacheEntry{fingerprint, scan});
                        }
                    }

                    indeterminate = indeterminate || scan.hadErrors;
                    std::sort(
                        scan.candidates.begin(),
                        scan.candidates.end(),
                        [](const auto& left, const auto& right)
                        {
                            if (left.freshness != right.freshness)
                            {
                                return left.freshness > right.freshness;
                            }
                            return normalizedPathKey(left.installPath) <
                                normalizedPathKey(right.installPath);
                        });

                    std::set<std::wstring> seen;
                    for (const GameInstallDiscoveryCandidate& candidate : scan.candidates)
                    {
                        if (!seen.insert(normalizedPathKey(candidate.installPath)).second)
                        {
                            continue;
                        }
                        const std::optional<std::filesystem::path> executable =
                            validateCandidate(registry_, definition, candidate);
                        if (!executable.has_value())
                        {
                            continue;
                        }

                        resolution.resolution = GameInstallResolutionKind::Found;
                        resolution.primaryExecutablePath = executable;
                        resolution.providerId = declared.id;
                        break;
                    }

                    const auto duration = std::chrono::duration_cast<std::chrono::microseconds>(
                        std::chrono::steady_clock::now() - startedAt).count();
                    logProviderOutcome(
                        definition,
                        declared.id,
                        resolution.resolution == GameInstallResolutionKind::Found
                            ? L"found"
                            : (scan.hadErrors ? L"indeterminate" : (cacheHit ? L"cacheHit" : L"notFound")),
                        scan.candidates.size(),
                        duration);
                    if (resolution.resolution == GameInstallResolutionKind::Found)
                    {
                        break;
                    }
                }
                catch (const std::exception&)
                {
                    indeterminate = true;
                    const auto duration = std::chrono::duration_cast<std::chrono::microseconds>(
                        std::chrono::steady_clock::now() - startedAt).count();
                    logProviderOutcome(definition, declared.id, L"error", 0, duration);
                }
            }

            if (resolution.resolution != GameInstallResolutionKind::Found)
            {
                resolution.resolution = indeterminate
                    ? GameInstallResolutionKind::Indeterminate
                    : GameInstallResolutionKind::NotFound;
            }
            snapshot.installs.push_back(std::move(resolution));
        }

        return snapshot;
    }

    std::wstring_view GameInstallDiscoveryService::resolutionName(
        GameInstallResolutionKind resolution) noexcept
    {
        switch (resolution)
        {
        case GameInstallResolutionKind::Found:
            return L"found";
        case GameInstallResolutionKind::NotFound:
            return L"notFound";
        case GameInstallResolutionKind::Indeterminate:
            return L"indeterminate";
        }
        return L"indeterminate";
    }

    const IGameInstallDiscoveryProvider* GameInstallDiscoveryService::providerFor(
        GameInstallDiscoveryProviderId id) const noexcept
    {
        const auto found = std::find_if(
            providers_.begin(),
            providers_.end(),
            [id](const auto& provider) { return provider->id() == id; });
        return found == providers_.end() ? nullptr : found->get();
    }

    void GameInstallDiscoveryService::logProviderOutcome(
        const GameDefinition& definition,
        GameInstallDiscoveryProviderId providerId,
        std::wstring_view outcome,
        std::size_t candidateCount,
        std::int64_t durationMicroseconds) const noexcept
    {
        if (logger_ == nullptr)
        {
            return;
        }

        try
        {
            logger_->writeOperation(
                LogLevel::Info,
                "GameInstallDiscovery",
                "provider=" + narrowAscii(gameInstallDiscoveryProviderIdName(providerId)) +
                    ", gameId=" + narrowAscii(definition.id.value()) +
                    ", outcome=" + narrowAscii(outcome) +
                    ", candidateCount=" + std::to_string(candidateCount) +
                    ", durationUs=" + std::to_string(durationMicroseconds));
        }
        catch (...)
        {
        }
    }
}
