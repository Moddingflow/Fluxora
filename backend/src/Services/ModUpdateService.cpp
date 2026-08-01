#include "FluxoraCore/Services/ModUpdateService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/NexusFileLineageResolver.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "NexusUpdateCache.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <cwctype>
#include <future>
#include <iomanip>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <unordered_map>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        std::wstring lower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::optional<std::wstring> confirmedInstalledVersionRepair(
            const InstalledModRecord& mod,
            const NexusModFilesResponse& response)
        {
            const auto installedFile = std::find_if(
                response.files.begin(),
                response.files.end(),
                [&mod](const NexusFileMetadata& file)
                {
                    return file.fileId == mod.source.remoteFileId;
                });
            if (installedFile == response.files.end() ||
                installedFile->version.empty() ||
                installedFile->version == mod.version)
            {
                return std::nullopt;
            }

            return installedFile->version;
        }

        std::optional<std::wstring> storedInstalledVersionRepair(
            const InstalledModRecord& mod)
        {
            if (lower(mod.source.provider) != L"nexus" ||
                mod.source.remoteFileId.empty() ||
                mod.source.latestFileId != mod.source.remoteFileId ||
                mod.source.latestVersion.empty() ||
                mod.source.latestVersion == mod.version ||
                lower(mod.source.updateCheckState) != L"completed" ||
                mod.source.lastCheckedAt.empty())
            {
                return std::nullopt;
            }

            return mod.source.latestVersion;
        }

        std::wstring nowUtcText()
        {
            const std::time_t current = std::chrono::system_clock::to_time_t(
                std::chrono::system_clock::now());
            std::tm utc{};
#ifdef _WIN32
            gmtime_s(&utc, &current);
#else
            gmtime_r(&current, &utc);
#endif
            std::wostringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
        }

        std::optional<std::chrono::system_clock::time_point> parseUtc(std::wstring_view value)
        {
            if (value.size() != 20 ||
                value[4] != L'-' || value[7] != L'-' || value[10] != L'T' ||
                value[13] != L':' || value[16] != L':' || value[19] != L'Z')
            {
                return std::nullopt;
            }
            const auto digits = [value](std::size_t offset, std::size_t count) -> std::optional<int>
            {
                int parsed = 0;
                for (std::size_t index = 0; index < count; ++index)
                {
                    const wchar_t character = value[offset + index];
                    if (character < L'0' || character > L'9')
                    {
                        return std::nullopt;
                    }
                    parsed = parsed * 10 + static_cast<int>(character - L'0');
                }
                return parsed;
            };
            const auto year = digits(0, 4);
            const auto month = digits(5, 2);
            const auto day = digits(8, 2);
            const auto hour = digits(11, 2);
            const auto minute = digits(14, 2);
            const auto second = digits(17, 2);
            if (!year.has_value() || !month.has_value() || !day.has_value() ||
                !hour.has_value() || !minute.has_value() || !second.has_value() ||
                *month < 1 || *month > 12 || *day < 1 || *day > 31 ||
                *hour > 23 || *minute > 59 || *second > 59)
            {
                return std::nullopt;
            }
            std::tm utc{};
            utc.tm_year = *year - 1900;
            utc.tm_mon = *month - 1;
            utc.tm_mday = *day;
            utc.tm_hour = *hour;
            utc.tm_min = *minute;
            utc.tm_sec = *second;
            const std::tm requested = utc;
#ifdef _WIN32
            const std::time_t time = _mkgmtime(&utc);
#else
            const std::time_t time = timegm(&utc);
#endif
            if (time == static_cast<std::time_t>(-1))
            {
                return std::nullopt;
            }
            std::tm normalized{};
#ifdef _WIN32
            gmtime_s(&normalized, &time);
#else
            gmtime_r(&time, &normalized);
#endif
            if (normalized.tm_year != requested.tm_year || normalized.tm_mon != requested.tm_mon ||
                normalized.tm_mday != requested.tm_mday || normalized.tm_hour != requested.tm_hour ||
                normalized.tm_min != requested.tm_min || normalized.tm_sec != requested.tm_sec)
            {
                return std::nullopt;
            }
            return std::chrono::system_clock::from_time_t(time);
        }

        std::wstring formatUtc(std::chrono::system_clock::time_point value)
        {
            const std::time_t time = std::chrono::system_clock::to_time_t(value);
            std::tm utc{};
#ifdef _WIN32
            gmtime_s(&utc, &time);
#else
            gmtime_r(&time, &utc);
#endif
            std::wostringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
        }

        std::wstring addHours(std::wstring_view value, int hours)
        {
            const auto parsed = parseUtc(value);
            return parsed.has_value()
                ? formatUtc(*parsed + std::chrono::hours(hours))
                : std::wstring{};
        }

        std::wstring addMinutes(std::wstring_view value, int minutes)
        {
            const auto parsed = parseUtc(value);
            return parsed.has_value()
                ? formatUtc(*parsed + std::chrono::minutes(minutes))
                : std::wstring{};
        }

#ifdef _WIN32
        std::wstring readEnvironmentVariable(const wchar_t* name)
        {
            const DWORD requiredLength = GetEnvironmentVariableW(name, nullptr, 0);
            if (requiredLength == 0)
            {
                return {};
            }
            std::wstring value(requiredLength, L'\0');
            const DWORD actualLength = GetEnvironmentVariableW(name, value.data(), requiredLength);
            if (actualLength == 0 || actualLength >= requiredLength)
            {
                return {};
            }
            value.resize(actualLength);
            return value;
        }
#endif

        std::filesystem::path operationCancellationDirectory()
        {
#ifdef _WIN32
            if (const std::wstring configured = readEnvironmentVariable(L"FLUXORA_OPERATION_CANCEL_DIR");
                !configured.empty())
            {
                return std::filesystem::path(configured);
            }
            if (const std::wstring logs = readEnvironmentVariable(L"FLUXORA_LOG_DIR"); !logs.empty())
            {
                return std::filesystem::path(logs) / L"operation-cancel";
            }
#else
            if (const char* configured = std::getenv("FLUXORA_OPERATION_CANCEL_DIR");
                configured != nullptr && configured[0] != '\0')
            {
                return std::filesystem::path(configured);
            }
            if (const char* logs = std::getenv("FLUXORA_LOG_DIR"); logs != nullptr && logs[0] != '\0')
            {
                return std::filesystem::path(logs) / "operation-cancel";
            }
#endif
            return {};
        }

        std::filesystem::path operationCancellationMarker()
        {
            const std::filesystem::path directory = operationCancellationDirectory();
            const std::string operationId = Logger::operationId();
            if (directory.empty() || operationId.empty())
            {
                return {};
            }

            std::string safe;
            safe.reserve(operationId.size() + 7);
            for (const char character : operationId)
            {
                const unsigned char value = static_cast<unsigned char>(character);
                safe.push_back(std::isalnum(value) != 0 || character == '_' || character == '-' || character == '.'
                    ? character
                    : '_');
            }
            safe += ".cancel";
            return directory / std::filesystem::path(safe);
        }

        bool markerExists(const std::filesystem::path& marker)
        {
            if (marker.empty())
            {
                return false;
            }
            std::error_code error;
            return std::filesystem::is_regular_file(marker, error) && !error;
        }

        std::int64_t unixSeconds(std::chrono::system_clock::time_point value)
        {
            return std::chrono::duration_cast<std::chrono::seconds>(
                value.time_since_epoch()).count();
        }

        std::int64_t quotaReserve(std::int64_t limit)
        {
            if (limit <= 0)
            {
                return 100;
            }
            return (std::max<std::int64_t>)(100, (limit + 9) / 10);
        }

        bool quotaWindowBlocks(
            std::int64_t limit,
            std::int64_t remaining,
            std::wstring_view resetAt,
            std::wstring_view now)
        {
            if (remaining < 0 || remaining > quotaReserve(limit))
            {
                return false;
            }

            const auto reset = parseUtc(resetAt);
            const auto current = parseUtc(now);
            return !reset.has_value() || !current.has_value() || *current < *reset;
        }

        std::optional<std::wstring> quotaReserveReset(
            const NexusQuotaSnapshot& quota,
            std::wstring_view now)
        {
            std::optional<std::wstring> reset;
            const auto includeBlockingWindow = [&reset, now](
                std::int64_t limit,
                std::int64_t remaining,
                const std::wstring& resetAt)
            {
                if (!quotaWindowBlocks(limit, remaining, resetAt, now))
                {
                    return;
                }
                if (!reset.has_value() || resetAt.empty() || *reset < resetAt)
                {
                    reset = resetAt;
                }
            };
            includeBlockingWindow(quota.hourlyLimit, quota.hourlyRemaining, quota.hourlyResetAt);
            includeBlockingWindow(quota.dailyLimit, quota.dailyRemaining, quota.dailyResetAt);
            return reset;
        }

        bool hasCompleteNexusIdentity(const InstalledModRecord& mod)
        {
            return lower(mod.source.provider) == L"nexus" &&
                !mod.source.gameDomain.empty() &&
                !mod.source.remoteModId.empty() &&
                !mod.source.remoteFileId.empty();
        }

        bool isActive(const NexusFileMetadata& file)
        {
            return file.availability == NexusFileAvailability::Active;
        }

        enum class ResolutionState
        {
            Resolved,
            Ambiguous,
            Failed
        };

        struct Resolution
        {
            ResolutionState state{ResolutionState::Failed};
            const NexusFileMetadata* file{nullptr};
            NexusFileLineageKind lineage{NexusFileLineageKind::UnprovenOrDifferentBranch};
        };

        Resolution resolveLatestFile(
            const InstalledModRecord& mod,
            const NexusModFilesResponse& response)
        {
            std::unordered_map<std::wstring, const NexusFileMetadata*> files;
            files.reserve(response.files.size());
            for (const NexusFileMetadata& file : response.files)
            {
                if (!file.fileId.empty())
                {
                    files[file.fileId] = &file;
                }
            }

            const auto installed = files.find(mod.source.remoteFileId);
            if (installed == files.end())
            {
                return {ResolutionState::Failed, nullptr};
            }

            const NexusFileLineageResolver lineageResolver(response.fileUpdates);
            const NexusFileLineageResolution lineage =
                lineageResolver.forwardFrom(mod.source.remoteFileId);
            if (lineage.kind == NexusFileLineageKind::UnprovenOrDifferentBranch)
            {
                return {
                    ResolutionState::Ambiguous,
                    nullptr,
                    NexusFileLineageKind::UnprovenOrDifferentBranch
                };
            }
            const NexusFileMetadata* selected = isActive(*installed->second)
                ? installed->second
                : nullptr;
            for (std::size_t index = 1; index < lineage.fileIds.size(); ++index)
            {
                const auto nextFile = files.find(lineage.fileIds[index]);
                if (nextFile == files.end())
                {
                    return {ResolutionState::Failed, nullptr, lineage.kind};
                }
                if (isActive(*nextFile->second))
                {
                    selected = nextFile->second;
                }
            }

            if (lineage.kind == NexusFileLineageKind::SameLineage)
            {
                return selected == nullptr
                    ? Resolution{ResolutionState::Failed, nullptr, lineage.kind}
                    : Resolution{ResolutionState::Resolved, selected, lineage.kind};
            }

            return isActive(*installed->second)
                ? Resolution{ResolutionState::Resolved, installed->second, NexusFileLineageKind::SameFile}
                : Resolution{ResolutionState::Failed, nullptr, NexusFileLineageKind::SameFile};
        }

        std::string lineageText(NexusFileLineageKind kind)
        {
            switch (kind)
            {
            case NexusFileLineageKind::SameFile: return "same_file";
            case NexusFileLineageKind::SameLineage: return "same_lineage";
            case NexusFileLineageKind::UnprovenOrDifferentBranch:
                return "unproven_or_different_branch";
            }
            return "unknown";
        }

        std::string modeText(ModUpdateCheckMode mode)
        {
            return mode == ModUpdateCheckMode::Manual ? "manual" : "automatic";
        }

        std::string stateText(ModUpdateCheckState state)
        {
            switch (state)
            {
            case ModUpdateCheckState::Completed:
                return "completed";
            case ModUpdateCheckState::Skipped:
                return "skipped";
            case ModUpdateCheckState::Partial:
                return "partial";
            case ModUpdateCheckState::Cancelled:
                return "cancelled";
            }
            return "unknown";
        }

        std::string reasonText(ModUpdateCheckReason reason)
        {
            switch (reason)
            {
            case ModUpdateCheckReason::None: return "none";
            case ModUpdateCheckReason::NoEligibleMods: return "no_eligible_mods";
            case ModUpdateCheckReason::DailyTtl: return "daily_ttl";
            case ModUpdateCheckReason::AuthenticationUnavailable: return "authentication_unavailable";
            case ModUpdateCheckReason::QuotaReserve: return "quota_reserve";
            case ModUpdateCheckReason::RateLimited: return "rate_limited";
            case ModUpdateCheckReason::OfflineBackoff: return "offline_backoff";
            case ModUpdateCheckReason::NetworkError: return "network_error";
            case ModUpdateCheckReason::Cancelled: return "cancelled";
            case ModUpdateCheckReason::AmbiguousMetadata: return "ambiguous_metadata";
            case ModUpdateCheckReason::MetadataUnavailable: return "metadata_unavailable";
            }
            return "unknown";
        }

        std::string asciiText(std::wstring_view value)
        {
            std::string result;
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                result.push_back(character >= 0 && character <= 0x7f
                    ? static_cast<char>(character)
                    : '?');
            }
            return result;
        }
    }

    NexusUpdateApiError::NexusUpdateApiError(
        NexusUpdateApiErrorKind kind,
        std::string message,
        NexusQuotaSnapshot quota,
        std::wstring retryAt)
        : std::runtime_error(std::move(message)),
          kind_(kind),
          quota_(std::move(quota)),
          retryAt_(std::move(retryAt))
    {
    }

    NexusUpdateApiErrorKind NexusUpdateApiError::kind() const noexcept
    {
        return kind_;
    }

    const NexusQuotaSnapshot& NexusUpdateApiError::quota() const noexcept
    {
        return quota_;
    }

    const std::wstring& NexusUpdateApiError::retryAt() const noexcept
    {
        return retryAt_;
    }

    ModUpdateService::ModUpdateService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings,
        NexusUpdateApi& api,
        ModUpdateServiceOptions options)
        : logger_(logger),
          pathSettings_(pathSettings),
          api_(api),
          options_(std::move(options))
    {
        if (!options_.nowUtc)
        {
            options_.nowUtc = nowUtcText;
        }
        if (!options_.cancellationRequested)
        {
            const std::filesystem::path marker = operationCancellationMarker();
            options_.cancellationRequested = [marker]() { return markerExists(marker); };
        }
        options_.maxConcurrentMetadataRequests = (std::clamp)(
            options_.maxConcurrentMetadataRequests,
            std::size_t{1},
            std::size_t{4});
        options_.maxTransientMetadataRetries = (std::min)(
            options_.maxTransientMetadataRetries,
            std::size_t{3});
        options_.transientMetadataRetryDelay = (std::clamp)(
            options_.transientMetadataRetryDelay,
            std::chrono::milliseconds{0},
            std::chrono::milliseconds{2'000});
    }

    ModUpdateCheckResult ModUpdateService::check(const ModUpdateCheckRequest& request) const
    {
        const auto sweepStarted = std::chrono::steady_clock::now();
        const auto sweepDeadline = sweepStarted + options_.overallTimeout;
        if (request.projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }

        ModUpdateCheckResult result;
        const std::wstring checkedAt = options_.nowUtc();
        const std::filesystem::path modsDirectory =
            pathSettings_.modsDirectory(request.projectDirectory);
        std::vector<InstalledModRecord> installed =
            InstanceMetadataStore::listInstalledMods(request.projectDirectory, modsDirectory);
        for (InstalledModRecord& mod : installed)
        {
            const std::optional<std::wstring> repair = storedInstalledVersionRepair(mod);
            if (!repair.has_value() ||
                !InstanceMetadataStore::repairInstalledModVersion(
                    request.projectDirectory,
                    mod.folderName,
                    mod.version,
                    *repair,
                    modsDirectory))
            {
                continue;
            }

            mod.version = *repair;
            logger_.writeOperation(
                LogLevel::Info,
                "ModUpdates",
                "Repaired installed version from stored exact Nexus file metadata folderName=" +
                    asciiText(mod.folderName) +
                    " fileId=" + asciiText(mod.source.remoteFileId) + ".");
        }

        using GroupKey = std::pair<std::wstring, std::wstring>;
        std::map<GroupKey, std::vector<const InstalledModRecord*>> groups;
        for (const InstalledModRecord& mod : installed)
        {
            if (hasCompleteNexusIdentity(mod))
            {
                groups[{lower(mod.source.gameDomain), mod.source.remoteModId}].push_back(&mod);
            }
        }

        if (groups.empty())
        {
            result.state = ModUpdateCheckState::Skipped;
            result.reason = ModUpdateCheckReason::NoEligibleMods;
        }
        else
        {
            NexusUpdateCache cache(options_.cachePath);
            try
            {
                cache.pruneUnusedBefore(addHours(checkedAt, -(24 * 90)));
            }
            catch (const std::exception& exception)
            {
                logger_.writeOperation(
                    LogLevel::Warning,
                    "ModUpdates",
                    std::string("Shared cache cleanup failed: ") + exception.what());
            }
            std::map<std::wstring, ModUpdateSweepRecord> priorSweeps;
            std::set<std::wstring> ttlBlockedGames;
            std::set<std::wstring> backoffBlockedGames;
            std::set<std::wstring> allGames;
            for (const auto& [key, mods] : groups)
            {
                (void)mods;
                allGames.insert(key.first);
            }
            const auto now = parseUtc(checkedAt);
            for (const std::wstring& gameDomain : allGames)
            {
                const std::optional<ModUpdateSweepRecord> sweep =
                    InstanceMetadataStore::modUpdateSweep(request.projectDirectory, gameDomain);
                if (!sweep.has_value())
                {
                    continue;
                }
                priorSweeps.emplace(gameDomain, *sweep);

                const auto nextEligible = parseUtc(sweep->nextEligibleAt);
                if (sweep->state == L"partial" && now.has_value() && nextEligible.has_value() &&
                    *now < *nextEligible)
                {
                    backoffBlockedGames.insert(gameDomain);
                    if (result.nextEligibleAt.empty() || sweep->nextEligibleAt < result.nextEligibleAt)
                    {
                        result.nextEligibleAt = sweep->nextEligibleAt;
                    }
                    if (sweep->stopReason == L"rate_limited")
                    {
                        result.reason = ModUpdateCheckReason::RateLimited;
                    }
                    else if (sweep->stopReason == L"quota_reserve")
                    {
                        result.reason = ModUpdateCheckReason::QuotaReserve;
                    }
                    else
                    {
                        result.reason = ModUpdateCheckReason::OfflineBackoff;
                    }
                    continue;
                }

                if (request.mode == ModUpdateCheckMode::Automatic && sweep->state == L"completed")
                {
                    const auto completed = parseUtc(sweep->lastCompletedAt);
                    if (now.has_value() && completed.has_value() &&
                        *now < *completed + std::chrono::hours(24))
                    {
                        ttlBlockedGames.insert(gameDomain);
                        const std::wstring eligible = formatUtc(*completed + std::chrono::hours(24));
                        if (result.nextEligibleAt.empty() || eligible < result.nextEligibleAt)
                        {
                            result.nextEligibleAt = eligible;
                        }
                    }
                }
            }

            std::set<std::wstring> blockedGames = ttlBlockedGames;
            blockedGames.insert(backoffBlockedGames.begin(), backoffBlockedGames.end());
            if (!allGames.empty() && blockedGames.size() == allGames.size())
            {
                result.state = ModUpdateCheckState::Skipped;
                if (backoffBlockedGames.empty())
                {
                    result.reason = ModUpdateCheckReason::DailyTtl;
                }
            }
            else if (!backoffBlockedGames.empty())
            {
                result.state = ModUpdateCheckState::Partial;
            }

            std::map<std::wstring, bool> gameFailed;
            std::set<std::wstring> attemptedGames;
            std::map<std::wstring, std::set<std::wstring>> recentChangedMods;
            std::set<std::wstring> recentFailedGames;
            std::map<std::wstring, std::wstring> gamePeriods;
            std::map<std::wstring, std::wstring> gameStopReasons;
            std::map<std::wstring, std::wstring> gameNextEligibleAt;
            std::map<std::wstring, int> gameBackoffSteps;
            bool quotaStopped = false;
            bool issuanceStopped = false;
            bool cancelled = false;
            bool quotaKnown = false;
            bool deadlineStopped = false;
            std::size_t completedMetadataMods = 0;
            std::size_t totalMetadataMods = 0;
            for (const auto& [key, mods] : groups)
            {
                (void)key;
                totalMetadataMods += mods.size();
            }
            const auto cancelIfRequested = [&]()
            {
                if (cancelled || !options_.cancellationRequested())
                {
                    return cancelled;
                }
                cancelled = true;
                issuanceStopped = true;
                result.state = ModUpdateCheckState::Cancelled;
                result.reason = ModUpdateCheckReason::Cancelled;
                return true;
            };
            const auto stopForDeadline = [&]()
            {
                if (deadlineStopped || options_.overallTimeout.count() <= 0)
                {
                    return deadlineStopped;
                }
                const auto reserve = (std::min)(
                    options_.requestTimeoutBudget,
                    options_.overallTimeout);
                if (std::chrono::steady_clock::now() + reserve < sweepDeadline)
                {
                    return false;
                }
                deadlineStopped = true;
                issuanceStopped = true;
                result.state = ModUpdateCheckState::Partial;
                result.reason = ModUpdateCheckReason::NetworkError;
                result.nextEligibleAt = addMinutes(checkedAt, 15);
                logger_.writeOperation(
                    LogLevel::Warning,
                    "ModUpdates",
                    "Update sweep reached its native deadline; returning a typed partial/networkError result.");
                return true;
            };
            const auto applyQuota = [&](const NexusQuotaSnapshot& quota)
            {
                result.quota = quota;
                quotaKnown = quota.hourlyRemaining >= 0 || quota.dailyRemaining >= 0;
                const std::optional<std::wstring> reset = quotaReserveReset(quota, checkedAt);
                if (!reset.has_value())
                {
                    return;
                }
                quotaStopped = true;
                issuanceStopped = true;
                result.state = ModUpdateCheckState::Partial;
                result.reason = ModUpdateCheckReason::QuotaReserve;
                result.nextEligibleAt = *reset;
            };
            const auto handleApiError = [&](
                const NexusUpdateApiError& error,
                const std::wstring& gameDomain,
                std::size_t affectedMods)
            {
                result.counters.failed += affectedMods;
                gameFailed[gameDomain] = true;
                if (!error.quota().capturedAt.empty() || error.quota().hourlyRemaining >= 0 ||
                    error.quota().dailyRemaining >= 0)
                {
                    result.quota = error.quota();
                    try
                    {
                        cache.storeQuota(error.quota());
                    }
                    catch (const std::exception&)
                    {
                    }
                }

                result.state = ModUpdateCheckState::Partial;
                switch (error.kind())
                {
                case NexusUpdateApiErrorKind::AuthenticationUnavailable:
                    result.reason = ModUpdateCheckReason::AuthenticationUnavailable;
                    gameStopReasons[gameDomain] = L"authentication_unavailable";
                    issuanceStopped = true;
                    break;
                case NexusUpdateApiErrorKind::RateLimited:
                {
                    result.reason = ModUpdateCheckReason::RateLimited;
                    gameStopReasons[gameDomain] = L"rate_limited";
                    std::wstring retryAt = error.retryAt();
                    if (retryAt.empty())
                    {
                        if (const auto quotaReset = quotaReserveReset(error.quota(), checkedAt);
                            quotaReset.has_value())
                        {
                            retryAt = *quotaReset;
                        }
                    }
                    if (retryAt.empty())
                    {
                        retryAt = addHours(checkedAt, 1);
                    }
                    result.nextEligibleAt = retryAt;
                    gameNextEligibleAt[gameDomain] = retryAt;
                    issuanceStopped = true;
                    break;
                }
                case NexusUpdateApiErrorKind::Offline:
                case NexusUpdateApiErrorKind::Network:
                {
                    result.reason = error.kind() == NexusUpdateApiErrorKind::Offline
                        ? ModUpdateCheckReason::OfflineBackoff
                        : ModUpdateCheckReason::NetworkError;
                    gameStopReasons[gameDomain] = L"network_backoff";
                    constexpr std::array<int, 4> backoffMinutes{15, 60, 360, 1440};
                    int previousStep = 0;
                    if (const auto prior = priorSweeps.find(gameDomain); prior != priorSweeps.end())
                    {
                        previousStep = (std::max)(0, prior->second.backoffStep);
                    }
                    const std::size_t index = (std::min)(
                        static_cast<std::size_t>(previousStep),
                        backoffMinutes.size() - 1);
                    const std::wstring retryAt = addMinutes(checkedAt, backoffMinutes[index]);
                    result.nextEligibleAt = retryAt;
                    gameNextEligibleAt[gameDomain] = retryAt;
                    gameBackoffSteps[gameDomain] = static_cast<int>((std::min)(index + 1, backoffMinutes.size() - 1));
                    break;
                }
                case NexusUpdateApiErrorKind::ResourceUnavailable:
                case NexusUpdateApiErrorKind::InvalidResponse:
                    result.reason = ModUpdateCheckReason::MetadataUnavailable;
                    gameStopReasons[gameDomain] = L"metadata_unavailable";
                    break;
                }
            };

            try
            {
                if (result.state != ModUpdateCheckState::Skipped)
                {
                    if (const std::optional<NexusQuotaSnapshot> cachedQuota = cache.loadQuota();
                        cachedQuota.has_value())
                    {
                        applyQuota(*cachedQuota);
                    }
                }
            }
            catch (const std::exception& exception)
            {
                logger_.writeOperation(
                    LogLevel::Warning,
                    "ModUpdates",
                    std::string("Shared quota cache read failed: ") + exception.what());
            }

            if (request.mode == ModUpdateCheckMode::Automatic)
            {
                const auto currentTime = parseUtc(checkedAt);
                for (const std::wstring& gameDomain : allGames)
                {
                    if (issuanceStopped || cancelIfRequested() || stopForDeadline())
                    {
                        break;
                    }
                    if (blockedGames.contains(gameDomain))
                    {
                        continue;
                    }
                    const auto sweep = priorSweeps.find(gameDomain);
                    if (sweep == priorSweeps.end() || sweep->second.baselineCompletedAt.empty())
                    {
                        gamePeriods[gameDomain] = L"baseline";
                        continue;
                    }

                    const auto completed = parseUtc(sweep->second.lastCompletedAt);
                    if (!currentTime.has_value() || !completed.has_value() ||
                        *currentTime - *completed > std::chrono::hours(24 * 30))
                    {
                        gamePeriods[gameDomain] = L"baseline";
                        continue;
                    }

                    const std::wstring period = *currentTime - *completed <= std::chrono::hours(24 * 7)
                        ? L"1w"
                        : L"1m";
                    gamePeriods[gameDomain] = period;
                    attemptedGames.insert(gameDomain);
                    try
                    {
                        NexusRecentUpdatesResponse recent;
                        bool cacheHit = false;
                        try
                        {
                            const std::optional<NexusRecentUpdatesResponse> cached = cache.loadRecentUpdates(
                                gameDomain,
                                period,
                                addMinutes(checkedAt, -5),
                                checkedAt);
                            if (cached.has_value())
                            {
                                recent = *cached;
                                cacheHit = true;
                                ++result.counters.cacheHits;
                            }
                        }
                        catch (const std::exception& exception)
                        {
                            logger_.writeOperation(
                                LogLevel::Warning,
                                "ModUpdates",
                                std::string("Shared recent cache read failed: ") + exception.what());
                        }

                        if (!cacheHit)
                        {
                            if (stopForDeadline())
                            {
                                break;
                            }
                            ++result.counters.apiRequests;
                            recent = api_.fetchRecentUpdates(gameDomain, period);
                            try
                            {
                                cache.storeRecentUpdates(gameDomain, period, recent, checkedAt);
                            }
                            catch (const std::exception& exception)
                            {
                                logger_.writeOperation(
                                    LogLevel::Warning,
                                    "ModUpdates",
                                    std::string("Shared recent cache write failed: ") + exception.what());
                            }
                        }
                        applyQuota(recent.quota);

                        const std::int64_t overlapStart = unixSeconds(
                            *completed - std::chrono::minutes(5));
                        std::set<std::wstring>& changed = recentChangedMods[gameDomain];
                        for (const NexusRecentUpdate& update : recent.updates)
                        {
                            if (!update.modId.empty() &&
                                (update.latestFileUpdate <= 0 || update.latestFileUpdate >= overlapStart))
                            {
                                changed.insert(update.modId);
                            }
                        }
                    }
                    catch (const NexusUpdateApiError& exception)
                    {
                        recentFailedGames.insert(gameDomain);
                        handleApiError(exception, gameDomain, 0);
                        logger_.writeOperation(
                            LogLevel::Warning,
                            "ModUpdates",
                            std::string("Nexus recent-updates request failed: ") + exception.what());
                    }
                    catch (const std::exception& exception)
                    {
                        recentFailedGames.insert(gameDomain);
                        handleApiError(
                            NexusUpdateApiError(
                                NexusUpdateApiErrorKind::Network,
                                exception.what()),
                            gameDomain,
                            0);
                        logger_.writeOperation(
                            LogLevel::Warning,
                            "ModUpdates",
                            std::string("Nexus recent-updates request failed: ") + exception.what());
                    }
                }
            }

            struct MetadataWork
            {
                GroupKey key;
                const std::vector<const InstalledModRecord*>* mods{nullptr};
            };
            std::vector<MetadataWork> networkWork;
            networkWork.reserve(groups.size());

            const auto reportMetadataProgress = [&](
                const std::vector<const InstalledModRecord*>& mods)
            {
                if (!options_.progress)
                {
                    return;
                }
                for (const InstalledModRecord* mod : mods)
                {
                    ++completedMetadataMods;
                    options_.progress(
                        completedMetadataMods,
                        totalMetadataMods,
                        mod->folderName);
                }
            };

            const auto processMetadataResponse = [&](
                const GroupKey& key,
                const std::vector<const InstalledModRecord*>& mods,
                const NexusModFilesResponse& response,
                std::string_view metadataSource,
                long long durationMs)
            {
                applyQuota(response.quota);
                if (cancelIfRequested())
                {
                    return;
                }

                for (const InstalledModRecord* mod : mods)
                {
                    const Resolution resolution = resolveLatestFile(*mod, response);
                    logger_.writeOperation(
                        LogLevel::Info,
                        "ModUpdates",
                        "Nexus file lineage classified metadataSource=" +
                            std::string(metadataSource) +
                            " lineage=" + lineageText(resolution.lineage) +
                            " durationMs=" + std::to_string(durationMs) +
                            " gameDomain=" + asciiText(key.first) +
                            " modId=" + asciiText(key.second) + ".");
                    if (resolution.state == ResolutionState::Ambiguous)
                    {
                        ++result.counters.ambiguous;
                        gameFailed[key.first] = true;
                        gameStopReasons[key.first] = L"ambiguous_metadata";
                        continue;
                    }
                    if (resolution.state != ResolutionState::Resolved || resolution.file == nullptr)
                    {
                        ++result.counters.failed;
                        gameFailed[key.first] = true;
                        gameStopReasons[key.first] = L"metadata_unavailable";
                        continue;
                    }

                    RemoteCheckRecord persisted;
                    persisted.folderName = mod->folderName;
                    persisted.source = mod->source;
                    persisted.latestVersion = resolution.file->version;
                    persisted.checkedAt = checkedAt;
                    persisted.latestFileId = resolution.file->fileId;
                    persisted.lastCheckState = L"completed";
                    persisted.lastAttemptedAt = checkedAt;
                    if (const std::optional<std::wstring> repair =
                            confirmedInstalledVersionRepair(*mod, response);
                        repair.has_value())
                    {
                        persisted.expectedInstalledVersion = mod->version;
                        persisted.confirmedInstalledVersion = *repair;
                    }
                    InstanceMetadataStore::recordRemoteCheck(
                        request.projectDirectory,
                        persisted,
                        modsDirectory);
                    if (!persisted.confirmedInstalledVersion.empty())
                    {
                        logger_.writeOperation(
                            LogLevel::Info,
                            "ModUpdates",
                            "Repaired installed version from exact Nexus file metadata folderName=" +
                                asciiText(mod->folderName) +
                                " fileId=" + asciiText(mod->source.remoteFileId) + ".");
                    }

                    ++result.counters.checked;
                    if (resolution.file->fileId != mod->source.remoteFileId)
                    {
                        ++result.counters.updates;
                    }
                }
                reportMetadataProgress(mods);
            };

            for (const auto& [key, mods] : groups)
            {
                if (cancelIfRequested())
                {
                    break;
                }
                if (blockedGames.contains(key.first))
                {
                    continue;
                }
                if (recentFailedGames.contains(key.first))
                {
                    result.counters.failed += mods.size();
                    continue;
                }
                if (const auto changed = recentChangedMods.find(key.first);
                    changed != recentChangedMods.end() && !changed->second.contains(key.second))
                {
                    continue;
                }
                attemptedGames.insert(key.first);

                bool cacheHit = false;
                try
                {
                    const std::wstring cacheCutoff = request.mode == ModUpdateCheckMode::Automatic
                        ? addHours(checkedAt, -24)
                        : addMinutes(checkedAt, -5);
                    const std::optional<NexusModFilesResponse> cached = cache.loadModFiles(
                        key.first,
                        key.second,
                        cacheCutoff,
                        checkedAt);
                    if (cached.has_value())
                    {
                        ++result.counters.cacheHits;
                        cacheHit = true;
                        processMetadataResponse(key, mods, *cached, "cache", 0);
                    }
                }
                catch (const std::exception& exception)
                {
                    logger_.writeOperation(
                        LogLevel::Warning,
                        "ModUpdates",
                        std::string("Shared cache read failed: ") + exception.what());
                }

                if (!cacheHit && !issuanceStopped)
                {
                    networkWork.push_back(MetadataWork{key, &mods});
                }
            }

            struct InFlightMetadata
            {
                const MetadataWork* work{nullptr};
                std::future<NexusModFilesResponse> response;
                std::chrono::steady_clock::time_point startedAt;
            };

            std::size_t nextWork = 0;
            std::size_t consecutiveTransientFailureBatches = 0;
            constexpr std::size_t transientFailureBatchesBeforeStop = 2;
            while (nextWork < networkWork.size() &&
                !issuanceStopped &&
                !cancelIfRequested() &&
                !stopForDeadline())
            {
                std::vector<InFlightMetadata> inFlight;
                std::size_t attemptedRequestsThisBatch = 0;
                std::size_t transientFailuresThisBatch = 0;
                const std::size_t batchLimit = !quotaKnown && nextWork == 0
                    ? std::size_t{1}
                    : options_.maxConcurrentMetadataRequests;
                inFlight.reserve(batchLimit);
                while (nextWork < networkWork.size() &&
                    inFlight.size() < batchLimit &&
                    !issuanceStopped &&
                    !stopForDeadline())
                {
                    const MetadataWork* work = &networkWork[nextWork++];
                    ++attemptedRequestsThisBatch;
                    ++result.counters.apiRequests;
                    try
                    {
                        const GroupKey key = work->key;
                        inFlight.push_back(InFlightMetadata{
                            work,
                            std::async(std::launch::async, [this, key, sweepDeadline]()
                            {
                                for (std::size_t retry = 0;; ++retry)
                                {
                                    try
                                    {
                                        return api_.fetchModFiles(key.first, key.second);
                                    }
                                    catch (const NexusUpdateApiError& exception)
                                    {
                                        const bool transient =
                                            exception.kind() == NexusUpdateApiErrorKind::Offline ||
                                            exception.kind() == NexusUpdateApiErrorKind::Network;
                                        if (!transient || retry >= options_.maxTransientMetadataRetries ||
                                            options_.cancellationRequested())
                                        {
                                            throw;
                                        }
                                        const auto retryDelay = options_.transientMetadataRetryDelay *
                                            static_cast<int>(retry + 1);
                                        if (options_.overallTimeout.count() > 0 &&
                                            std::chrono::steady_clock::now() + retryDelay >= sweepDeadline)
                                        {
                                            throw;
                                        }
                                        logger_.writeOperation(
                                            LogLevel::Warning,
                                            "ModUpdates",
                                            "Transient Nexus metadata request failure; retrying gameDomain=" +
                                                asciiText(key.first) +
                                                " modId=" + asciiText(key.second) +
                                                " retryAttempt=" + std::to_string(retry + 1) +
                                                " retryDelayMs=" + std::to_string(retryDelay.count()) + ".");
                                        if (retryDelay.count() > 0)
                                        {
                                            std::this_thread::sleep_for(retryDelay);
                                        }
                                    }
                                }
                            }),
                            std::chrono::steady_clock::now()});
                    }
                    catch (const std::exception& exception)
                    {
                        ++transientFailuresThisBatch;
                        handleApiError(
                            NexusUpdateApiError(NexusUpdateApiErrorKind::Network, exception.what()),
                            work->key.first,
                            work->mods->size());
                        reportMetadataProgress(*work->mods);
                        logger_.writeOperation(
                            LogLevel::Warning,
                            "ModUpdates",
                            "Nexus metadata request could not be started gameDomain=" +
                                asciiText(work->key.first) +
                                " modId=" + asciiText(work->key.second) +
                                " affectedMods=" + std::to_string(work->mods->size()) +
                                ": " + exception.what());
                    }
                }

                for (InFlightMetadata& pending : inFlight)
                {
                    const MetadataWork& work = *pending.work;
                    try
                    {
                        NexusModFilesResponse response = pending.response.get();
                        try
                        {
                            cache.storeModFiles(
                                work.key.first,
                                work.key.second,
                                response,
                                checkedAt);
                        }
                        catch (const std::exception& exception)
                        {
                            logger_.writeOperation(
                                LogLevel::Warning,
                                "ModUpdates",
                                std::string("Shared cache write failed: ") + exception.what());
                        }

                        const long long durationMs =
                            std::chrono::duration_cast<std::chrono::milliseconds>(
                                std::chrono::steady_clock::now() - pending.startedAt).count();
                        processMetadataResponse(
                            work.key,
                            *work.mods,
                            response,
                            "network",
                            durationMs);
                    }
                    catch (const NexusUpdateApiError& exception)
                    {
                        if (exception.kind() == NexusUpdateApiErrorKind::Offline ||
                            exception.kind() == NexusUpdateApiErrorKind::Network)
                        {
                            ++transientFailuresThisBatch;
                        }
                        handleApiError(exception, work.key.first, work.mods->size());
                        reportMetadataProgress(*work.mods);
                        logger_.writeOperation(
                            LogLevel::Warning,
                            "ModUpdates",
                            "Nexus metadata request failed gameDomain=" +
                                asciiText(work.key.first) +
                                " modId=" + asciiText(work.key.second) +
                                " affectedMods=" + std::to_string(work.mods->size()) +
                                ": " + exception.what());
                    }
                    catch (const std::exception& exception)
                    {
                        ++transientFailuresThisBatch;
                        handleApiError(
                            NexusUpdateApiError(NexusUpdateApiErrorKind::Network, exception.what()),
                            work.key.first,
                            work.mods->size());
                        reportMetadataProgress(*work.mods);
                        logger_.writeOperation(
                            LogLevel::Warning,
                            "ModUpdates",
                            "Nexus metadata request failed gameDomain=" +
                                asciiText(work.key.first) +
                                " modId=" + asciiText(work.key.second) +
                                " affectedMods=" + std::to_string(work.mods->size()) +
                                ": " + exception.what());
                    }
                }

                if (!issuanceStopped && attemptedRequestsThisBatch > 0 &&
                    transientFailuresThisBatch == attemptedRequestsThisBatch)
                {
                    ++consecutiveTransientFailureBatches;
                    if (consecutiveTransientFailureBatches >= transientFailureBatchesBeforeStop)
                    {
                        issuanceStopped = true;
                        logger_.writeOperation(
                            LogLevel::Warning,
                            "ModUpdates",
                            "Nexus metadata sweep stopped after consecutive fully failed network batches; "
                            "remainingRequests=" + std::to_string(networkWork.size() - nextWork) + ".");
                    }
                }
                else
                {
                    consecutiveTransientFailureBatches = 0;
                }
            }

            if (issuanceStopped)
            {
                std::wstring stopReason;
                switch (result.reason)
                {
                case ModUpdateCheckReason::QuotaReserve:
                    stopReason = L"quota_reserve";
                    break;
                case ModUpdateCheckReason::RateLimited:
                    stopReason = L"rate_limited";
                    break;
                case ModUpdateCheckReason::AuthenticationUnavailable:
                    stopReason = L"authentication_unavailable";
                    break;
                case ModUpdateCheckReason::OfflineBackoff:
                case ModUpdateCheckReason::NetworkError:
                    stopReason = L"network_backoff";
                    break;
                case ModUpdateCheckReason::Cancelled:
                    stopReason = L"cancelled";
                    break;
                default:
                    break;
                }

                for (const std::wstring& gameDomain : allGames)
                {
                    if (blockedGames.contains(gameDomain))
                    {
                        continue;
                    }
                    attemptedGames.insert(gameDomain);
                    gameFailed[gameDomain] = true;
                    if (!stopReason.empty() && !gameStopReasons.contains(gameDomain))
                    {
                        gameStopReasons[gameDomain] = stopReason;
                    }
                    if (!result.nextEligibleAt.empty() && !gameNextEligibleAt.contains(gameDomain))
                    {
                        gameNextEligibleAt[gameDomain] = result.nextEligibleAt;
                    }
                    if (stopReason == L"network_backoff" && !gameBackoffSteps.contains(gameDomain))
                    {
                        int previousStep = 0;
                        if (const auto prior = priorSweeps.find(gameDomain); prior != priorSweeps.end())
                        {
                            previousStep = (std::max)(0, prior->second.backoffStep);
                        }
                        gameBackoffSteps[gameDomain] = (std::min)(previousStep + 1, 3);
                    }
                }
            }

            for (const std::wstring& gameDomain : attemptedGames)
            {
                ModUpdateSweepRecord sweep;
                if (const auto prior = priorSweeps.find(gameDomain); prior != priorSweeps.end())
                {
                    sweep = prior->second;
                }
                sweep.gameDomain = gameDomain;
                sweep.lastAttemptedAt = checkedAt;
                if (!gameFailed[gameDomain])
                {
                    sweep.state = L"completed";
                    sweep.lastCompletedAt = checkedAt;
                    if (sweep.baselineCompletedAt.empty())
                    {
                        sweep.baselineCompletedAt = checkedAt;
                    }
                    sweep.nextEligibleAt = addHours(checkedAt, 24);
                    if (result.nextEligibleAt.empty() || sweep.nextEligibleAt < result.nextEligibleAt)
                    {
                        result.nextEligibleAt = sweep.nextEligibleAt;
                    }
                    const auto period = gamePeriods.find(gameDomain);
                    sweep.lastPeriod = period == gamePeriods.end() ? L"baseline" : period->second;
                    sweep.backoffStep = 0;
                    sweep.stopReason.clear();
                }
                else
                {
                    sweep.state = cancelled ? L"cancelled" : L"partial";
                    sweep.stopReason = gameStopReasons.contains(gameDomain)
                        ? gameStopReasons[gameDomain]
                        : L"metadata_failed";
                    if (gameNextEligibleAt.contains(gameDomain))
                    {
                        sweep.nextEligibleAt = gameNextEligibleAt[gameDomain];
                    }
                    if (gameBackoffSteps.contains(gameDomain))
                    {
                        sweep.backoffStep = gameBackoffSteps[gameDomain];
                    }
                }
                InstanceMetadataStore::recordModUpdateSweep(request.projectDirectory, sweep);
            }

            if (result.state != ModUpdateCheckState::Skipped &&
                result.state != ModUpdateCheckState::Cancelled &&
                result.reason == ModUpdateCheckReason::None &&
                (result.counters.failed > 0 || result.counters.ambiguous > 0))
            {
                result.state = ModUpdateCheckState::Partial;
                result.reason = result.counters.ambiguous > 0
                    ? ModUpdateCheckReason::AmbiguousMetadata
                    : ModUpdateCheckReason::MetadataUnavailable;
            }
        }

        const std::vector<InstalledModRecord> refreshed =
            InstanceMetadataStore::listInstalledMods(request.projectDirectory, modsDirectory);
        result.mods.reserve(refreshed.size());
        for (const InstalledModRecord& mod : refreshed)
        {
            result.mods.push_back(ModUpdateInstalledMod{
                mod.folderName,
                mod.source.latestVersion,
                mod.source.latestFileId,
                mod.source.updateCheckState,
                hasCompleteNexusIdentity(mod) &&
                    !mod.source.latestFileId.empty() &&
                    mod.source.latestFileId != mod.source.remoteFileId
            });
        }

        logger_.writeOperation(
            LogLevel::Info,
            "ModUpdates",
            "check completed mode=" + modeText(request.mode) +
                " state=" + stateText(result.state) +
                " reason=" + reasonText(result.reason) +
                " cacheHits=" + std::to_string(result.counters.cacheHits) +
                " apiRequests=" + std::to_string(result.counters.apiRequests) +
                " checked=" + std::to_string(result.counters.checked) +
                " updates=" + std::to_string(result.counters.updates) +
                " ambiguous=" + std::to_string(result.counters.ambiguous) +
                " failed=" + std::to_string(result.counters.failed) +
                " nextEligible=" + asciiText(result.nextEligibleAt));
        return result;
    }
}
