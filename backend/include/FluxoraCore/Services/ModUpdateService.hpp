#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;
    class NexusModsAuthService;

    enum class NexusFileAvailability
    {
        Active,
        Old,
        Deleted,
        Archived
    };

    struct NexusQuotaSnapshot
    {
        long long hourlyLimit{-1};
        long long hourlyRemaining{-1};
        std::wstring hourlyResetAt;
        long long dailyLimit{-1};
        long long dailyRemaining{-1};
        std::wstring dailyResetAt;
        std::wstring capturedAt;
    };

    struct NexusFileMetadata
    {
        std::wstring fileId;
        std::wstring version;
        std::wstring categoryId;
        std::optional<bool> isPrimary;
        NexusFileAvailability availability{NexusFileAvailability::Active};
        std::int64_t uploadedTimestamp{0};
    };

    struct NexusFileUpdateLink
    {
        std::wstring oldFileId;
        std::wstring newFileId;
        std::int64_t uploadedTimestamp{0};
    };

    struct NexusModFilesResponse
    {
        std::vector<NexusFileMetadata> files;
        std::vector<NexusFileUpdateLink> fileUpdates;
        NexusQuotaSnapshot quota;
    };

    struct NexusRecentUpdate
    {
        std::wstring modId;
        std::int64_t latestFileUpdate{0};
        std::int64_t latestModActivity{0};
    };

    struct NexusRecentUpdatesResponse
    {
        std::vector<NexusRecentUpdate> updates;
        NexusQuotaSnapshot quota;
    };

    class NexusUpdateApi
    {
    public:
        virtual ~NexusUpdateApi() = default;

        [[nodiscard]] virtual NexusModFilesResponse fetchModFiles(
            std::wstring_view gameDomain,
            std::wstring_view modId) = 0;

        [[nodiscard]] virtual NexusRecentUpdatesResponse fetchRecentUpdates(
            std::wstring_view gameDomain,
            std::wstring_view period) = 0;
    };

    enum class NexusUpdateApiErrorKind
    {
        AuthenticationUnavailable,
        RateLimited,
        Offline,
        Network,
        InvalidResponse
    };

    class NexusUpdateApiError final : public std::runtime_error
    {
    public:
        NexusUpdateApiError(
            NexusUpdateApiErrorKind kind,
            std::string message,
            NexusQuotaSnapshot quota = {},
            std::wstring retryAt = {});

        [[nodiscard]] NexusUpdateApiErrorKind kind() const noexcept;
        [[nodiscard]] const NexusQuotaSnapshot& quota() const noexcept;
        [[nodiscard]] const std::wstring& retryAt() const noexcept;

    private:
        NexusUpdateApiErrorKind kind_;
        NexusQuotaSnapshot quota_;
        std::wstring retryAt_;
    };

    [[nodiscard]] std::unique_ptr<NexusUpdateApi> createNexusUpdateApi(
        Logger& logger,
        NexusModsAuthService& auth);

    enum class ModUpdateCheckMode
    {
        Automatic,
        Manual
    };

    enum class ModUpdateCheckState
    {
        Completed,
        Skipped,
        Partial,
        Cancelled
    };

    enum class ModUpdateCheckReason
    {
        None,
        NoEligibleMods,
        DailyTtl,
        AuthenticationUnavailable,
        QuotaReserve,
        RateLimited,
        OfflineBackoff,
        NetworkError,
        Cancelled,
        AmbiguousMetadata,
        MetadataUnavailable
    };

    struct ModUpdateCheckRequest
    {
        std::filesystem::path projectDirectory;
        ModUpdateCheckMode mode{ModUpdateCheckMode::Automatic};
    };

    struct ModUpdateCheckCounters
    {
        std::size_t apiRequests{0};
        std::size_t cacheHits{0};
        std::size_t checked{0};
        std::size_t updates{0};
        std::size_t ambiguous{0};
        std::size_t failed{0};
    };

    struct ModUpdateInstalledMod
    {
        std::wstring folderName;
        std::wstring latestVersion;
        std::wstring latestFileId;
        std::wstring updateCheckState;
        bool hasUpdate{false};
    };

    struct ModUpdateCheckResult
    {
        ModUpdateCheckState state{ModUpdateCheckState::Completed};
        ModUpdateCheckReason reason{ModUpdateCheckReason::None};
        std::wstring nextEligibleAt;
        NexusQuotaSnapshot quota;
        ModUpdateCheckCounters counters;
        std::vector<ModUpdateInstalledMod> mods;
    };

    struct ModUpdateServiceOptions
    {
        std::filesystem::path cachePath;
        std::function<std::wstring()> nowUtc;
        std::function<bool()> cancellationRequested;
        std::function<void(std::size_t, std::size_t, std::wstring_view)> progress;
        std::size_t maxConcurrentMetadataRequests{4};
    };

    class ModUpdateService final
    {
    public:
        ModUpdateService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings,
            NexusUpdateApi& api,
            ModUpdateServiceOptions options = {});

        [[nodiscard]] ModUpdateCheckResult check(const ModUpdateCheckRequest& request) const;

    private:
        Logger& logger_;
        const BuildPathSettingsService& pathSettings_;
        NexusUpdateApi& api_;
        ModUpdateServiceOptions options_;
    };
}
