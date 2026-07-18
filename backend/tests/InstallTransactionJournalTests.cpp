#include "FluxoraCore/Services/InstallTransactionJournal.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <string_view>

namespace fluxora::tests
{
    namespace
    {
        void writeMarker(const std::filesystem::path& path, std::string_view value)
        {
            std::filesystem::create_directories(path.parent_path());
            std::ofstream output(path, std::ios::binary);
            output << value;
        }
    }

    TEST(InstallTransactionJournalTests, RemovesPartialStagingBeforeAnyTargetMutation)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path staging = project / "mods" / ".New.installing";
        const std::filesystem::path target = project / "mods" / "New";
        writeMarker(staging / "partial.txt", "partial");
        InstallTransactionJournal::write(
            project,
            InstallTransactionRecord{L"prepared-op", L"prepared", staging, target, {}, false});

        const InstallTransactionRecovery recovery =
            InstallTransactionJournal::recover(project, L"prepared-op");

        EXPECT_TRUE(recovery.journalFound);
        EXPECT_FALSE(recovery.needsReview);
        EXPECT_FALSE(std::filesystem::exists(staging));
        EXPECT_FALSE(std::filesystem::exists(target));
    }

    TEST(InstallTransactionJournalTests, RestoresBackupWhenCrashOccursAfterTargetWasMoved)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path staging = project / "mods" / ".Example.installing";
        const std::filesystem::path target = project / "mods" / "Example";
        const std::filesystem::path backup = project / "mods" / ".Example.replacing";
        std::filesystem::create_directories(staging);
        std::filesystem::create_directories(target);
        {
            std::ofstream original(target / "original.txt");
            original << "original";
        }
        std::filesystem::rename(target, backup);
        InstallTransactionJournal::write(
            project,
            InstallTransactionRecord{
                L"install-op",
                L"targetBackedUp",
                staging,
                target,
                backup,
                true
            });

        const InstallTransactionRecovery recovery =
            InstallTransactionJournal::recover(project, L"install-op");

        EXPECT_TRUE(recovery.journalFound);
        EXPECT_TRUE(recovery.restoredBackup);
        EXPECT_FALSE(recovery.needsReview);
        EXPECT_TRUE(std::filesystem::exists(target / "original.txt"));
        EXPECT_FALSE(std::filesystem::exists(backup));
        EXPECT_FALSE(std::filesystem::exists(staging));
        EXPECT_FALSE(std::filesystem::exists(
            project / ".flow" / "install-transactions" / "install-op.json"));
    }

    TEST(InstallTransactionJournalTests, RemovesPublishedNewTargetBeforeSafeResume)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path staging = project / "mods" / ".New.installing";
        const std::filesystem::path target = project / "mods" / "New";
        writeMarker(target / "published.txt", "published");
        InstallTransactionJournal::write(
            project,
            InstallTransactionRecord{L"new-op", L"promoted", staging, target, {}, false});

        const InstallTransactionRecovery recovery =
            InstallTransactionJournal::recover(project, L"new-op");

        EXPECT_FALSE(recovery.needsReview);
        EXPECT_FALSE(std::filesystem::exists(target));
    }

    TEST(InstallTransactionJournalTests, RollsBackPublishedReplaceOrMergeTarget)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path staging = project / "mods" / ".Replace.installing";
        const std::filesystem::path target = project / "mods" / "Replace";
        const std::filesystem::path backup = project / "mods" / ".Replace.replacing";
        writeMarker(target / "new.txt", "new");
        writeMarker(backup / "old.txt", "old");
        InstallTransactionJournal::write(
            project,
            InstallTransactionRecord{L"replace-op", L"promoted", staging, target, backup, true});

        const InstallTransactionRecovery recovery =
            InstallTransactionJournal::recover(project, L"replace-op");

        EXPECT_TRUE(recovery.restoredBackup);
        EXPECT_FALSE(recovery.needsReview);
        EXPECT_TRUE(std::filesystem::exists(target / "old.txt"));
        EXPECT_FALSE(std::filesystem::exists(target / "new.txt"));
        EXPECT_FALSE(std::filesystem::exists(backup));
    }

    TEST(InstallTransactionJournalTests, KeepsPublishedTargetAfterCommittedStage)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path target = project / "mods" / "Committed";
        const std::filesystem::path backup = project / "mods" / ".Committed.replacing";
        writeMarker(target / "new.txt", "new");
        writeMarker(backup / "old.txt", "old");
        InstallTransactionJournal::write(
            project,
            InstallTransactionRecord{L"committed-op", L"committed", {}, target, backup, true});

        const InstallTransactionRecovery recovery =
            InstallTransactionJournal::recover(project, L"committed-op");

        EXPECT_TRUE(recovery.commitCompleted);
        EXPECT_FALSE(recovery.needsReview);
        EXPECT_TRUE(std::filesystem::exists(target / "new.txt"));
        EXPECT_FALSE(std::filesystem::exists(backup));
    }

    TEST(InstallTransactionJournalTests, LeavesUnrelatedJournalPathsForManualReview)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path staging = project / "staging" / ".Unsafe.installing";
        const std::filesystem::path target = project / "mods" / "Unsafe";
        writeMarker(staging / "partial.txt", "partial");
        InstallTransactionJournal::write(
            project,
            InstallTransactionRecord{L"unsafe-op", L"prepared", staging, target, {}, false});

        const InstallTransactionRecovery recovery =
            InstallTransactionJournal::recover(project, L"unsafe-op");

        EXPECT_TRUE(recovery.needsReview);
        EXPECT_TRUE(std::filesystem::exists(staging / "partial.txt"));
        EXPECT_TRUE(std::filesystem::exists(
            project / ".flow" / "install-transactions" / "unsafe-op.json"));
    }
}
