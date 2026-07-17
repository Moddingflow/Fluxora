#include "FluxoraCore/Services/ArchiveCatalogService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <string>
#include <thread>

namespace fluxora::tests
{
    TEST(ArchiveCatalogServiceTests, AcceptsArchiveExtensionsDeclaredByGameDefinitions)
    {
        EXPECT_TRUE(ArchiveCatalogService::isSupportedArchiveFile(L"Skyrim Textures.bsa"));
        EXPECT_FALSE(ArchiveCatalogService::isSupportedArchiveFile(L"notes.txt"));
    }

    TEST(ArchiveCatalogServiceTests, ImportDeduplicatesByShaAndPreservesTheFirstPhysicalArchive)
    {
        TempDirectory temp;
        const std::filesystem::path appRoot = temp.path() / L"app";
        const std::filesystem::path project = temp.path() / L"build";
        const std::filesystem::path firstSource = temp.path() / L"sources" / L"Original.zip";
        const std::filesystem::path renamedSource = temp.path() / L"other" / L"Renamed.zip";
        std::filesystem::create_directories(appRoot);
        writeTextFile(firstSource, "same archive bytes");
        writeTextFile(renamedSource, "same archive bytes");
        ScopedEnvironmentVariable appRootEnvironment(L"FLUXORA_APP_ROOT", appRoot.wstring());
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService paths(logger);
        ArchiveCatalogService catalog(logger, paths);

        const ArchiveCatalogEntry first = catalog.importArchive(project, firstSource);
        const ArchiveCatalogEntry duplicate = catalog.importArchive(project, renamedSource);

        EXPECT_TRUE(first.createdNewFile);
        EXPECT_FALSE(duplicate.createdNewFile);
        EXPECT_EQ(normalized(duplicate.path), normalized(first.path));
        EXPECT_EQ(first.sha256.size(), 64U);
        EXPECT_EQ(first.archiveId, L"sha256:" + first.sha256);
        EXPECT_TRUE(std::filesystem::is_regular_file(first.path));
        EXPECT_FALSE(std::filesystem::exists(first.path.parent_path() / renamedSource.filename()));
        EXPECT_TRUE(std::filesystem::is_regular_file(ArchiveCatalogService::sidecarPathFor(first.path)));
    }

    TEST(ArchiveCatalogServiceTests, ImportUsesHashSuffixForSameNameWithDifferentContent)
    {
        TempDirectory temp;
        const std::filesystem::path appRoot = temp.path() / L"app";
        const std::filesystem::path project = temp.path() / L"build";
        const std::filesystem::path firstSource = temp.path() / L"one" / L"Mod.zip";
        const std::filesystem::path secondSource = temp.path() / L"two" / L"Mod.zip";
        std::filesystem::create_directories(appRoot);
        writeTextFile(firstSource, "first archive");
        writeTextFile(secondSource, "second archive");
        ScopedEnvironmentVariable appRootEnvironment(L"FLUXORA_APP_ROOT", appRoot.wstring());
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService paths(logger);
        ArchiveCatalogService catalog(logger, paths);

        const ArchiveCatalogEntry first = catalog.importArchive(project, firstSource);
        const ArchiveCatalogEntry second = catalog.importArchive(project, secondSource);

        ASSERT_NE(first.sha256, second.sha256);
        EXPECT_EQ(first.path.filename(), L"Mod.zip");
        EXPECT_EQ(
            second.path.filename(),
            L"Mod-" + second.sha256.substr(0, 8) + L".zip");
        EXPECT_TRUE(second.createdNewFile);
    }

    TEST(ArchiveCatalogServiceTests, IdentifyInvalidatesCachedShaWhenExplorerFileChanges)
    {
        TempDirectory temp;
        const std::filesystem::path appRoot = temp.path() / L"app";
        const std::filesystem::path project = temp.path() / L"build";
        std::filesystem::create_directories(appRoot);
        ScopedEnvironmentVariable appRootEnvironment(L"FLUXORA_APP_ROOT", appRoot.wstring());
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService paths(logger);
        ArchiveCatalogService catalog(logger, paths);
        const std::filesystem::path manualArchive =
            paths.downloadsDirectory(project) / L"Explorer Added.7z";
        writeTextFile(manualArchive, "before");

        const ArchiveCatalogEntry before = catalog.identifyArchive(project, manualArchive);
        writeTextFile(manualArchive, "after with a different size");
        const ArchiveCatalogEntry after = catalog.identifyArchive(project, manualArchive);

        EXPECT_NE(before.sha256, after.sha256);
        EXPECT_EQ(normalized(before.path), normalized(after.path));
        EXPECT_FALSE(after.createdNewFile);
    }

    TEST(ArchiveCatalogServiceTests, LookupIndexesExplorerArchiveInBackground)
    {
        TempDirectory temp;
        const std::filesystem::path appRoot = temp.path() / L"app";
        const std::filesystem::path project = temp.path() / L"build";
        std::filesystem::create_directories(appRoot);
        ScopedEnvironmentVariable appRootEnvironment(L"FLUXORA_APP_ROOT", appRoot.wstring());
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService paths(logger);
        ArchiveCatalogService catalog(logger, paths);
        const std::filesystem::path manualArchive =
            paths.downloadsDirectory(project) / L"Explorer Added.zip";
        writeTextFile(manualArchive, std::string(4 * 1024 * 1024, 'x'));

        ArchiveCatalogLookup lookup = catalog.lookupArchive(project, manualArchive);
        EXPECT_EQ(lookup.state, ArchiveCatalogLookupState::Indexing);
        EXPECT_TRUE(lookup.entry.archiveId.empty());

        for (int attempt = 0;
             attempt < 200 && lookup.state == ArchiveCatalogLookupState::Indexing;
             ++attempt)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            lookup = catalog.lookupArchive(project, manualArchive);
        }

        ASSERT_EQ(lookup.state, ArchiveCatalogLookupState::Ready);
        EXPECT_EQ(lookup.entry.archiveId, L"sha256:" + lookup.entry.sha256);
        EXPECT_TRUE(std::filesystem::is_regular_file(ArchiveCatalogService::sidecarPathFor(manualArchive)));
    }

    TEST(ArchiveCatalogServiceTests, ConsolidateRemovesACompletedTransferThatDuplicatesExistingContent)
    {
        TempDirectory temp;
        const std::filesystem::path appRoot = temp.path() / L"app";
        const std::filesystem::path project = temp.path() / L"build";
        std::filesystem::create_directories(appRoot);
        ScopedEnvironmentVariable appRootEnvironment(L"FLUXORA_APP_ROOT", appRoot.wstring());
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService paths(logger);
        ArchiveCatalogService catalog(logger, paths);
        const std::filesystem::path downloads = paths.downloadsDirectory(project);
        const std::filesystem::path existing = downloads / L"Existing.zip";
        const std::filesystem::path completedTransfer = downloads / L"Downloaded.zip";
        writeTextFile(existing, "same bytes");
        writeTextFile(completedTransfer, "same bytes");
        (void)catalog.identifyArchive(project, existing);

        const ArchiveCatalogEntry consolidated = catalog.consolidateArchive(
            project,
            completedTransfer);

        EXPECT_EQ(normalized(consolidated.path), normalized(existing));
        EXPECT_FALSE(consolidated.createdNewFile);
        EXPECT_TRUE(std::filesystem::is_regular_file(existing));
        EXPECT_FALSE(std::filesystem::exists(completedTransfer));
    }
}
