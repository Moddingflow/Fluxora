#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/RootBuilderLaunchCacheReconciler.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    namespace
    {
        RootBuilderLaunchCacheBaselineFile baselineFile(
            const std::filesystem::path& cacheRoot,
            const std::filesystem::path& relativePath)
        {
            std::error_code error;
            const std::filesystem::path path = cacheRoot / relativePath;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            EXPECT_FALSE(error);
            error.clear();
            const auto modified = std::filesystem::last_write_time(path, error);
            EXPECT_FALSE(error);
            return RootBuilderLaunchCacheBaselineFile{
                relativePath,
                size,
                static_cast<std::int64_t>(modified.time_since_epoch().count())
            };
        }

        RootBuilderLaunchCacheReconcileRequest requestFor(
            const std::filesystem::path& root,
            std::vector<RootBuilderLaunchCacheBaselineFile> baseline)
        {
            return RootBuilderLaunchCacheReconcileRequest{
                root / L"cache",
                root / L"cache" / L".fluxora-root-launch-cache.json",
                std::move(baseline),
                {
                    RootBuilderLaunchCacheReconcileMount{
                        L"Data",
                        root / L"overwrite",
                        root / L"whiteouts" / L"content"
                    },
                    RootBuilderLaunchCacheReconcileMount{
                        {},
                        root / L"overwrite" / L"root",
                        root / L"whiteouts" / L"game-root"
                    }
                }
            };
        }
    }

    TEST(RootBuilderLaunchCacheReconcilerTests, RecoversAddedAndChangedFilesAndPersistsDeletions)
    {
        TempDirectory temp;
        const std::filesystem::path cache = temp.path() / L"cache";
        const std::filesystem::path changed = L"Data/SKSE/Plugins/SmoothCam.json";
        const std::filesystem::path removed = L"Data/NovelSubsystem/deleted.futureext";
        writeTextFile(cache / changed, "baseline");
        writeTextFile(cache / removed, "baseline-delete");
        const std::vector<RootBuilderLaunchCacheBaselineFile> baseline{
            baselineFile(cache, changed),
            baselineFile(cache, removed)
        };

        writeTextFile(cache / changed, "runtime-preset-selected");
        writeTextFile(cache / L"Data/CommunityShaders/runtime.futureext", "runtime-added");
        ASSERT_TRUE(std::filesystem::remove(cache / removed));

        Logger logger;
        const RootBuilderLaunchCacheReconcileResult result =
            RootBuilderLaunchCacheReconciler(logger).reconcile(requestFor(temp.path(), baseline));

        ASSERT_TRUE(result.success) << result.failure;
        EXPECT_TRUE(result.cacheChanged);
        EXPECT_EQ(result.recoveredFiles, 2U);
        EXPECT_EQ(result.whiteouts, 1U);
        EXPECT_EQ(
            readTextFile(temp.path() / L"overwrite/SKSE/Plugins/SmoothCam.json"),
            "runtime-preset-selected");
        EXPECT_EQ(
            readTextFile(temp.path() / L"overwrite/CommunityShaders/runtime.futureext"),
            "runtime-added");
        EXPECT_TRUE(std::filesystem::is_regular_file(
            temp.path() / L"whiteouts/content/NovelSubsystem/deleted.futureext"));
        EXPECT_EQ(readTextFile(cache / changed), "runtime-preset-selected");
        const std::string log = readTextFile(temp.path() / L"vfs.log");
        EXPECT_NE(log.find("recoveredFiles=2"), std::string::npos);
        EXPECT_NE(log.find("whiteouts=1"), std::string::npos);
        EXPECT_NE(log.find("errors=0"), std::string::npos);
    }

    TEST(RootBuilderLaunchCacheReconcilerTests, FailureLeavesCacheIntactAndBlocksReconciliation)
    {
        TempDirectory temp;
        const std::filesystem::path cacheFile =
            temp.path() / L"cache/Data/NovelSubsystem/deep/state.futureext";
        writeTextFile(cacheFile, "runtime");
        writeTextFile(temp.path() / L"blocked-overwrite", "not-a-directory");

        RootBuilderLaunchCacheReconcileRequest request = requestFor(temp.path(), {});
        request.mounts.front().overwriteRoot = temp.path() / L"blocked-overwrite";
        Logger logger;
        const RootBuilderLaunchCacheReconcileResult result =
            RootBuilderLaunchCacheReconciler(logger).reconcile(request);

        EXPECT_FALSE(result.success);
        EXPECT_EQ(result.errors, 1U);
        EXPECT_FALSE(result.failure.empty());
        EXPECT_EQ(readTextFile(cacheFile), "runtime");
    }

    TEST(RootBuilderLaunchCacheReconcilerTests, AcceptsExistingVfsWhiteoutForDeletedRuntimeFile)
    {
        TempDirectory temp;
        const std::filesystem::path relativeMarker = L"PrecacheGrass.txt";
        const std::filesystem::path cacheMarker = temp.path() / L"cache" / relativeMarker;
        writeTextFile(cacheMarker, "NGIO runtime activity");
        const std::vector<RootBuilderLaunchCacheBaselineFile> baseline{
            baselineFile(temp.path() / L"cache", relativeMarker)
        };
        ASSERT_TRUE(std::filesystem::remove(cacheMarker));

        const std::filesystem::path whiteout =
            temp.path() / L"whiteouts" / L"game-root" / relativeMarker;
        writeTextFile(whiteout, "");
#ifdef _WIN32
        ASSERT_NE(
            SetFileAttributesW(
                whiteout.c_str(),
                FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED),
            0);
#endif

        Logger logger;
        const RootBuilderLaunchCacheReconcileResult result =
            RootBuilderLaunchCacheReconciler(logger).reconcile(requestFor(temp.path(), baseline));

        ASSERT_TRUE(result.success) << result.failure;
        EXPECT_TRUE(result.cacheChanged);
        EXPECT_EQ(result.whiteouts, 1U);
        EXPECT_TRUE(std::filesystem::is_regular_file(whiteout));
    }

    TEST(RootBuilderLaunchCacheReconcilerTests, DoesNotFollowDirectoryReparsePoints)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Junction behavior is Windows-specific.";
#else
        TempDirectory temp;
        const std::filesystem::path outside = temp.path() / L"outside";
        writeTextFile(outside / L"escaped.futureext", "outside");
        std::filesystem::create_directories(temp.path() / L"cache/Data");
        std::error_code junctionError;
        if (!createDirectoryJunction(outside, temp.path() / L"cache/Data/Junction", junctionError))
        {
            GTEST_SKIP() << "Directory junction creation is unavailable: " << junctionError.message();
        }

        Logger logger;
        const RootBuilderLaunchCacheReconcileResult result =
            RootBuilderLaunchCacheReconciler(logger).reconcile(requestFor(temp.path(), {}));

        ASSERT_TRUE(result.success) << result.failure;
        EXPECT_EQ(result.recoveredFiles, 0U);
        EXPECT_FALSE(std::filesystem::exists(
            temp.path() / L"overwrite/Junction/escaped.futureext"));
#endif
    }
}
