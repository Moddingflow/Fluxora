#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace fluxora
{
    class Logger;

    struct RootBuilderLaunchCacheBaselineFile
    {
        std::filesystem::path relativePath;
        std::uintmax_t size{0};
        std::int64_t modifiedTicks{0};
    };

    struct RootBuilderLaunchCacheReconcileMount
    {
        std::filesystem::path cachePrefix;
        std::filesystem::path overwriteRoot;
        std::filesystem::path whiteoutRoot;
    };

    struct RootBuilderLaunchCacheReconcileRequest
    {
        std::filesystem::path cacheRoot;
        std::filesystem::path manifestPath;
        std::vector<RootBuilderLaunchCacheBaselineFile> baselineFiles;
        std::vector<RootBuilderLaunchCacheReconcileMount> mounts;
    };

    struct RootBuilderLaunchCacheReconcileResult
    {
        bool success{true};
        bool cacheChanged{false};
        std::size_t recoveredFiles{0};
        std::size_t whiteouts{0};
        std::size_t errors{0};
        std::string failure;
    };

    // Recovers mutations made to the physical early-loader cache before the
    // cache synchronizer is allowed to prune or replace anything.
    class RootBuilderLaunchCacheReconciler final
    {
    public:
        explicit RootBuilderLaunchCacheReconciler(Logger& logger) noexcept;

        [[nodiscard]] RootBuilderLaunchCacheReconcileResult reconcile(
            const RootBuilderLaunchCacheReconcileRequest& request) const;

    private:
        Logger& logger_;
    };
}
