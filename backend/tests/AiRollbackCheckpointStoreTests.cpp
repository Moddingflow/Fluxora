#include "FluxoraCore/Services/AiRollbackCheckpointStore.hpp"

#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    namespace
    {
        AiRollbackCheckpointRun checkpointRun(
            std::wstring chatId,
            std::wstring buildKey,
            std::wstring runId,
            std::uintmax_t createdAt,
            const std::vector<char>& before,
            const std::vector<char>& after)
        {
            AiRollbackCheckpointRun run;
            run.chatId = std::move(chatId);
            run.buildKey = std::move(buildKey);
            run.runId = std::move(runId);
            run.operationId = L"operation-" + run.runId;
            run.createdAt = createdAt;
            run.files.push_back(AiRollbackCheckpointFile{
                L"mods/Fluxora AI Overrides/settings.ini",
                L"Fluxora AI Overrides/settings.ini",
                L"Fluxora AI Overrides",
                computeFluxPackBytesSha256(before.data(), before.size()),
                computeFluxPackBytesSha256(after.data(), after.size()),
                before,
                after,
                1,
                false
            });
            return run;
        }
    }

    TEST(AiRollbackCheckpointStoreTests, RunAndContentAddressedSnapshotsSurviveRestart)
    {
        TempDirectory temp;
        const std::vector<char> before{'b', 'e', 'f', 'o', 'r', 'e'};
        const std::vector<char> after{'a', 'f', 't', 'e', 'r'};
        AiRollbackCheckpointRun run;
        run.chatId = L"chat-restart";
        run.buildKey = L"build-a";
        run.runId = L"run-a";
        run.operationId = L"operation-a";
        run.createdAt = 42;
        run.files.push_back(AiRollbackCheckpointFile{
            L"mods/Fluxora AI Overrides/settings.ini",
            L"Fluxora AI Overrides/settings.ini",
            L"Fluxora AI Overrides",
            computeFluxPackBytesSha256(before.data(), before.size()),
            computeFluxPackBytesSha256(after.data(), after.size()),
            before,
            after,
            1,
            false
        });

        AiRollbackCheckpointStore(temp.path()).saveRun(run);
        const auto restored = AiRollbackCheckpointStore(temp.path()).loadRuns(
            L"chat-restart",
            L"build-a");

        ASSERT_EQ(restored.size(), 1u);
        ASSERT_EQ(restored.front().files.size(), 1u);
        EXPECT_EQ(restored.front().runId, L"run-a");
        EXPECT_EQ(restored.front().files.front().beforeBytes, before);
        EXPECT_EQ(restored.front().files.front().afterBytes, after);
        EXPECT_EQ(AiRollbackCheckpointStore(temp.path()).storageStats().blobCount, 2u);
    }

    TEST(AiRollbackCheckpointStoreTests, CorruptManifestIsBlockedBeforeAnySnapshotCanLoad)
    {
        TempDirectory temp;
        const std::vector<char> before{'b', 'e', 'f', 'o', 'r', 'e'};
        const std::vector<char> after{'a', 'f', 't', 'e', 'r'};
        AiRollbackCheckpointStore store(temp.path());
        store.saveRun(checkpointRun(L"chat-corrupt", L"build-a", L"run-a", 1, before, after));

        const std::filesystem::path chats = temp.path() / L"chats";
        const auto chatDirectory = std::filesystem::directory_iterator(chats)->path();
        writeTextFile(chatDirectory / L"manifest.json", "{\"schema\":\"unsupported\",\"version\":999}");

        EXPECT_THROW(
            static_cast<void>(store.loadRuns(L"chat-corrupt", L"build-a")),
            std::runtime_error);
    }

    TEST(AiRollbackCheckpointStoreTests, DeduplicationAndLimitsEvictOnlyWholeRuns)
    {
        TempDirectory probe;
        const std::vector<char> before{
            4, 91, 18, 73, 33, 6, 119, 52, 11, 98, 27, 64, 3, 87, 44, 101,
            13, 58, 122, 35, 77, 9, 110, 49, 21, 95, 39, 69, 1, 83, 47, 106};
        const std::vector<char> after{
            8, 88, 23, 70, 31, 14, 116, 55, 5, 99, 26, 62, 17, 85, 42, 103,
            12, 60, 124, 37, 75, 7, 112, 51, 19, 93, 41, 67, 2, 81, 45, 108};
        const std::vector<char> newerBefore(before.rbegin(), before.rend());
        const std::vector<char> newerAfter(after.rbegin(), after.rend());
        AiRollbackCheckpointStore probeStore(probe.path());
        probeStore.saveRun(checkpointRun(L"probe", L"build-a", L"probe", 1, before, after));
        const auto singleRunBytes = probeStore.storageStats().storedBytes;

        TempDirectory perChat;
        AiRollbackCheckpointStore store(
            perChat.path(),
            AiRollbackCheckpointLimits{singleRunBytes + 10, singleRunBytes * 4});
        store.saveRun(checkpointRun(L"chat-limit", L"build-a", L"run-oldest", 1, before, after));
        store.saveRun(checkpointRun(L"chat-limit", L"build-a", L"run-shared", 2, before, after));
        EXPECT_EQ(store.storageStats().blobCount, 2u);
        store.saveRun(checkpointRun(
            L"chat-limit", L"build-a", L"run-new", 3, newerBefore, newerAfter));

        const auto states = store.getRunStates(L"chat-limit", L"build-a");
        ASSERT_EQ(states.size(), 3u);
        EXPECT_EQ(states[0].state, AiRollbackCheckpointState::Unavailable);
        EXPECT_EQ(states[0].reason, AiRollbackCheckpointReason::Expired);
        EXPECT_EQ(states[1].state, AiRollbackCheckpointState::Unavailable);
        EXPECT_EQ(states[1].reason, AiRollbackCheckpointReason::Expired);
        EXPECT_EQ(states[2].state, AiRollbackCheckpointState::Available);
        const auto runs = store.loadRuns(L"chat-limit", L"build-a");
        EXPECT_TRUE(runs[0].files.empty());
        EXPECT_TRUE(runs[1].files.empty());
        ASSERT_EQ(runs[2].files.size(), 1u);

        TempDirectory global;
        AiRollbackCheckpointStore globalStore(
            global.path(),
            AiRollbackCheckpointLimits{singleRunBytes * 4, singleRunBytes + 10});
        globalStore.saveRun(checkpointRun(L"chat-old", L"build-a", L"run-old", 1, before, after));
        globalStore.saveRun(checkpointRun(
            L"chat-new", L"build-a", L"run-new", 2, newerBefore, newerAfter));
        EXPECT_EQ(
            globalStore.getRunStates(L"chat-old", L"build-a")[0].state,
            AiRollbackCheckpointState::Unavailable);
        EXPECT_EQ(
            globalStore.getRunStates(L"chat-new", L"build-a")[0].state,
            AiRollbackCheckpointState::Available);
    }

    TEST(AiRollbackCheckpointStoreTests, FullResetRemovesEveryManifestAndBlob)
    {
        TempDirectory temp;
        const std::vector<char> before{'b', 'e', 'f', 'o', 'r', 'e'};
        const std::vector<char> after{'a', 'f', 't', 'e', 'r'};
        AiRollbackCheckpointStore store(temp.path());
        store.saveRun(checkpointRun(L"chat-reset", L"build-a", L"run-a", 1, before, after));
        ASSERT_GT(store.storageStats().blobCount, 0u);

        store.eraseAll();

        EXPECT_EQ(store.storageStats().blobCount, 0u);
        EXPECT_TRUE(store.loadRuns(L"chat-reset", L"build-a").empty());
    }
}
