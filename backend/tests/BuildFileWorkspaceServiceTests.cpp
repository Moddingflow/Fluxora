#include "FluxoraCore/Services/BuildFileWorkspaceService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <fstream>

#ifdef _WIN32
#include <Windows.h>
#endif

namespace fluxora::tests
{
    namespace
    {
        void writeBytes(const std::filesystem::path& path, const std::vector<unsigned char>& bytes)
        {
            std::filesystem::create_directories(path.parent_path());
            std::ofstream stream(path, std::ios::binary | std::ios::trunc);
            stream.write(
                reinterpret_cast<const char*>(bytes.data()),
                static_cast<std::streamsize>(bytes.size()));
        }

        std::vector<char> readRawBytes(const std::filesystem::path& path)
        {
            std::ifstream stream(path, std::ios::binary);
            return std::vector<char>(
                std::istreambuf_iterator<char>(stream),
                std::istreambuf_iterator<char>());
        }

        BuildFileWorkspaceError capturedWorkspaceError(const std::function<void()>& action)
        {
            try
            {
                action();
            }
            catch (const BuildFileWorkspaceError& error)
            {
                return error;
            }
            throw std::runtime_error("Expected BuildFileWorkspaceError.");
        }
    }

    TEST(BuildFileWorkspaceServiceTests, OpaqueReadPatchAndRollbackStayInsideRegisteredWorkspace)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path modFile =
            project / L"mods" / L"Example Mod" / L"config" / L"settings.json";
        const std::filesystem::path overrideFile =
            project / L"mods" / L"Fluxora AI Overrides" / L"config" / L"settings.json";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(modFile, "{\r\n  \"enabled\": false\r\n}\r\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-1", project);

        const BuildFileSearchPage page = service.search(
            L"chat-1",
            BuildFileSearchRequest{BuildFileScope::Build, L"settings.json", 20, L""});
        ASSERT_EQ(page.entries.size(), 1u);
        EXPECT_EQ(page.entries.front().scope, BuildFileScope::Build);
        EXPECT_EQ(page.entries.front().ownerMod, L"Example Mod");
        EXPECT_EQ(page.entries.front().relativePath, L"Example Mod/config/settings.json");
        EXPECT_FALSE(page.entries.front().fileRef.empty());
        EXPECT_EQ(page.entries.front().fileRef.find(project.wstring()), std::wstring::npos);

        const BuildFileTextRead document = service.readText(
            L"chat-1",
            BuildFileTextReadRequest{page.entries.front().fileRef, 1, 120, 8192});
        EXPECT_EQ(document.encoding, BuildFileTextEncoding::Utf8);
        EXPECT_EQ(document.lineEnding, BuildFileLineEnding::CrLf);
        EXPECT_FALSE(document.sha256.empty());

        auto patch = BuildFileMutation::patch(
            page.entries.front().fileRef,
            document.sha256,
            L"\"enabled\": false",
            L"\"enabled\": true",
            BuildFileMutationFormat::Json);
        patch.revision = page.entries.front().indexRevision;
        const FluxoraAiFileChangeSet changeSet = service.apply(
            L"chat-1",
            L"run-1",
            L"operation-1",
            {patch});

        ASSERT_EQ(changeSet.files.size(), 1u);
        EXPECT_EQ(changeSet.files.front().status, BuildFileChangeStatus::Created);
        EXPECT_EQ(changeSet.files.front().beforeVersion, document.version);
        EXPECT_NE(changeSet.files.front().afterVersion, document.version);
        EXPECT_EQ(readTextFile(modFile), "{\r\n  \"enabled\": false\r\n}\r\n");
        EXPECT_EQ(readTextFile(overrideFile), "{\r\n  \"enabled\": true\r\n}\r\n");
        EXPECT_EQ(changeSet.files.front().ownerMod, L"Fluxora AI Overrides");
        EXPECT_EQ(changeSet.files.front().addedLines, 1u);
        EXPECT_EQ(changeSet.files.front().removedLines, 1u);

        const BuildFileRollbackResult rollback = service.rollbackRun(
            L"chat-1",
            L"run-1",
            L"operation-rollback-1");
        EXPECT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_EQ(readTextFile(modFile), "{\r\n  \"enabled\": false\r\n}\r\n");
        EXPECT_FALSE(std::filesystem::exists(overrideFile));

        service.endChat(L"chat-1");
        service.shutdown();
        pathSettings.shutdown();
    }

    TEST(BuildFileWorkspaceServiceTests, CreateUsesExistingParentRefAndNeverOverwrites)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path existing = project / L"mods" / L"Example Mod" / L"notes" / L"seed.txt";
        const std::filesystem::path overrideFile =
            project / L"mods" / L"Fluxora AI Overrides" / L"notes" / L"agent-notes.txt";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(existing, "seed\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-create", project);

        const auto page = service.search(
            L"chat-create",
            BuildFileSearchRequest{BuildFileScope::Build, L"seed.txt", 20, L""});
        ASSERT_EQ(page.entries.size(), 1u);
        ASSERT_FALSE(page.entries.front().parentRef.empty());

        const auto created = service.apply(
            L"chat-create",
            L"run-create",
            L"operation-create",
            {BuildFileMutation::create(
                page.entries.front().parentRef,
                L"agent-notes.txt",
                L"created by Fluxora\n",
                BuildFileMutationFormat::PlainText)});
        ASSERT_EQ(created.files.size(), 1u);
        EXPECT_EQ(created.files.front().status, BuildFileChangeStatus::Created);
        EXPECT_FALSE(created.files.front().fileRef.empty());
        EXPECT_FALSE(std::filesystem::exists(existing.parent_path() / L"agent-notes.txt"));
        EXPECT_EQ(readTextFile(overrideFile), "created by Fluxora\n");
        EXPECT_EQ(created.files.front().ownerMod, L"Fluxora AI Overrides");

        const auto duplicateError = capturedWorkspaceError([&]
        {
            static_cast<void>(service.apply(
                L"chat-create",
                L"run-duplicate",
                L"operation-duplicate",
                {BuildFileMutation::create(
                    page.entries.front().parentRef,
                    L"agent-notes.txt",
                    L"overwrite",
                    BuildFileMutationFormat::PlainText)}));
        });
        EXPECT_EQ(duplicateError.code(), "stale-version");

        writeTextFile(overrideFile, "edited after creation\n");
        const auto modifiedConflict = service.rollbackRun(
            L"chat-create",
            L"run-create",
            L"operation-rollback-modified-create");
        EXPECT_EQ(modifiedConflict.state, BuildFileRollbackState::Conflict);
        EXPECT_EQ(modifiedConflict.reason, BuildFileRollbackReason::CreatedFileModified);
        EXPECT_EQ(readTextFile(overrideFile), "edited after creation\n");
        const auto modifiedStates = service.getFileRollbackStates(
            L"chat-create",
            L"operation-created-states");
        ASSERT_EQ(modifiedStates.size(), 1u);
        EXPECT_EQ(modifiedStates[0].reason, BuildFileRollbackReason::CreatedFileModified);
        writeTextFile(overrideFile, "created by Fluxora\n");

        const auto rollback = service.rollbackRun(
            L"chat-create",
            L"run-create",
            L"operation-rollback-create");
        EXPECT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_FALSE(std::filesystem::exists(overrideFile));
    }

    TEST(BuildFileWorkspaceServiceTests, UndoOlderRunPreservesNewerNonOverlappingChanges)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path source = project / L"mods" / L"Example" / L"settings.ini";
        const std::filesystem::path managed =
            project / L"mods" / L"Fluxora AI Overrides" / L"settings.ini";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source, "alpha\r\nbeta\r\ngamma\r\n");
        writeTextFile(managed, "alpha\r\nbeta\r\ngamma\r\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            source.parent_path(),
            L"Example",
            L"1.0",
            ModSourceRecord{L"local"}));
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            managed.parent_path(),
            L"Fluxora AI Overrides",
            L"1.0",
            ModSourceRecord{L"local"}));
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Example", L""},
                ProfileOrderImportItemRecord{L"mod", L"Fluxora AI Overrides", L""}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-independent-undo", project);

        const auto currentManaged = [&]()
        {
            const auto page = service.discover(
                L"chat-independent-undo",
                BuildFileDiscoveryRequest{
                    {BuildFileScope::Build},
                    {L"settings"},
                    {L".ini"},
                    {L"settings.ini"},
                    {},
                    20,
                    L"",
                    L""});
            const auto match = std::find_if(page.candidates.begin(), page.candidates.end(), [](const auto& entry)
            {
                return entry.effectiveWinner && entry.file.ownerMod == L"Fluxora AI Overrides";
            });
            if (match != page.candidates.end())
            {
                return match->file;
            }
            const auto winner = std::find_if(page.candidates.begin(), page.candidates.end(), [](const auto& entry)
            {
                return entry.effectiveWinner;
            });
            return winner == page.candidates.end() ? page.candidates.front().file : winner->file;
        };
        const auto applyPatch = [&](std::wstring_view runId, std::wstring_view expected, std::wstring_view replacement)
        {
            const auto file = currentManaged();
            const auto read = service.readText(
                L"chat-independent-undo",
                BuildFileTextReadRequest{file.fileRef, 1, 120, 8192});
            auto patch = BuildFileMutation::patch(
                file.fileRef,
                read.sha256,
                std::wstring(expected),
                std::wstring(replacement),
                BuildFileMutationFormat::Ini);
            patch.revision = file.indexRevision;
            return service.apply(L"chat-independent-undo", runId, L"operation", {patch});
        };

        static_cast<void>(applyPatch(L"run-selected", L"beta", L"beta selected"));
        static_cast<void>(applyPatch(L"run-newer", L"gamma", L"gamma\r\nnewer line"));

        const BuildFileRollbackResult rollback = service.rollbackRun(
            L"chat-independent-undo",
            L"run-selected",
            L"operation-rollback-selected");

        ASSERT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_EQ(rollback.mode, BuildFileRollbackMode::InverseMerge);
        EXPECT_TRUE(rollback.preservedNewerChanges);
        EXPECT_EQ(readTextFile(managed), "alpha\r\nbeta\r\ngamma\r\nnewer line\r\n");
    }

    TEST(BuildFileWorkspaceServiceTests, OneOverlappingFilePreventsEveryWriteInTheRun)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path managedRoot =
            project / L"mods" / L"Fluxora AI Overrides";
        const std::filesystem::path first = managedRoot / L"first.ini";
        const std::filesystem::path second = managedRoot / L"second.ini";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(first, "alpha\r\nbeta\r\ngamma\r\n");
        writeTextFile(second, "one\r\ntwo\r\nthree\r\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            managedRoot,
            L"Fluxora AI Overrides",
            L"1.0",
            ModSourceRecord{L"local"}));

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-atomic-conflict", project);

        const auto firstPage = service.search(
            L"chat-atomic-conflict",
            BuildFileSearchRequest{BuildFileScope::Build, L"first.ini", 20, L""});
        const auto secondPage = service.search(
            L"chat-atomic-conflict",
            BuildFileSearchRequest{BuildFileScope::Build, L"second.ini", 20, L""});
        ASSERT_EQ(firstPage.entries.size(), 1u);
        ASSERT_EQ(secondPage.entries.size(), 1u);
        const auto firstRead = service.readText(
            L"chat-atomic-conflict",
            BuildFileTextReadRequest{firstPage.entries[0].fileRef, 1, 120, 8192});
        const auto secondRead = service.readText(
            L"chat-atomic-conflict",
            BuildFileTextReadRequest{secondPage.entries[0].fileRef, 1, 120, 8192});
        auto firstPatch = BuildFileMutation::patch(
            firstPage.entries[0].fileRef,
            firstRead.sha256,
            L"beta",
            L"beta selected",
            BuildFileMutationFormat::Ini);
        firstPatch.revision = firstPage.entries[0].indexRevision;
        auto secondPatch = BuildFileMutation::patch(
            secondPage.entries[0].fileRef,
            secondRead.sha256,
            L"two",
            L"two selected",
            BuildFileMutationFormat::Ini);
        secondPatch.revision = secondPage.entries[0].indexRevision;
        static_cast<void>(service.apply(
            L"chat-atomic-conflict",
            L"run-atomic-conflict",
            L"operation-atomic-conflict",
            {firstPatch, secondPatch}));

        writeTextFile(first, "newer heading\r\nalpha\r\nbeta selected\r\ngamma\r\n");
        writeTextFile(second, "one\r\nnewer overlapping value\r\nthree\r\n");
        const std::string firstBeforeUndo = readTextFile(first);
        const std::string secondBeforeUndo = readTextFile(second);

        const auto rollback = service.rollbackRun(
            L"chat-atomic-conflict",
            L"run-atomic-conflict",
            L"operation-atomic-conflict-rollback");
        EXPECT_EQ(rollback.state, BuildFileRollbackState::Conflict);
        EXPECT_EQ(rollback.reason, BuildFileRollbackReason::OverlappingEdit);
        EXPECT_EQ(readTextFile(first), firstBeforeUndo);
        EXPECT_EQ(readTextFile(second), secondBeforeUndo);
        const auto states = service.getFileRollbackStates(
            L"chat-atomic-conflict",
            L"operation-atomic-conflict-states");
        ASSERT_EQ(states.size(), 1u);
        EXPECT_EQ(states[0].reason, BuildFileRollbackReason::OverlappingEdit);

#ifdef _WIN32
        writeTextFile(first, "alpha\r\nbeta selected\r\ngamma\r\n");
        writeTextFile(second, "one\r\ntwo selected\r\nthree\r\n");
        const HANDLE lockedSecond = CreateFileW(
            second.c_str(),
            GENERIC_READ,
            FILE_SHARE_READ,
            nullptr,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        ASSERT_NE(lockedSecond, INVALID_HANDLE_VALUE);
        std::string writeFailure;
        try
        {
            static_cast<void>(service.rollbackRun(
                L"chat-atomic-conflict",
                L"run-atomic-conflict",
                L"operation-atomic-write-failure"));
        }
        catch (const std::exception& error)
        {
            writeFailure = error.what();
        }
        CloseHandle(lockedSecond);
        EXPECT_FALSE(writeFailure.empty());
        EXPECT_NE(writeFailure.find("Access is denied"), std::string::npos);
        EXPECT_EQ(readTextFile(first), "alpha\r\nbeta selected\r\ngamma\r\n");
        EXPECT_EQ(readTextFile(second), "one\r\ntwo selected\r\nthree\r\n");
#endif
    }

    TEST(BuildFileWorkspaceServiceTests, PreservesUtf16BomAndRefusesRollbackOverExternalChanges)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path file = project / L"mods" / L"Unicode Mod" / L"settings.ini";
        const std::filesystem::path overrideFile =
            project / L"mods" / L"Fluxora AI Overrides" / L"settings.ini";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeBytes(file, {
            0xFF, 0xFE,
            '[', 0, 'M', 0, 'a', 0, 'i', 0, 'n', 0, ']', 0, '\r', 0, '\n', 0,
            'V', 0, 'a', 0, 'l', 0, 'u', 0, 'e', 0, '=', 0, '1', 0, '\r', 0, '\n', 0
        });
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-utf16", project);

        const auto page = service.search(
            L"chat-utf16",
            BuildFileSearchRequest{BuildFileScope::Build, L"settings.ini", 20, L""});
        ASSERT_EQ(page.entries.size(), 1u);
        const auto document = service.readText(
            L"chat-utf16",
            BuildFileTextReadRequest{page.entries.front().fileRef, 1, 120, 8192});
        EXPECT_EQ(document.encoding, BuildFileTextEncoding::Utf16Le);
        EXPECT_EQ(document.lineEnding, BuildFileLineEnding::CrLf);

        auto patch = BuildFileMutation::patch(
            page.entries.front().fileRef,
            document.sha256,
            L"Value=1",
            L"Value=2",
            BuildFileMutationFormat::Ini);
        patch.revision = page.entries.front().indexRevision;
        static_cast<void>(service.apply(
            L"chat-utf16",
            L"run-utf16",
            L"operation-utf16",
            {patch}));
        const auto bytesAfter = readRawBytes(overrideFile);
        ASSERT_GE(bytesAfter.size(), 4u);
        EXPECT_EQ(static_cast<unsigned char>(bytesAfter[0]), 0xFF);
        EXPECT_EQ(static_cast<unsigned char>(bytesAfter[1]), 0xFE);

        writeBytes(overrideFile, {0xFF, 0xFE, 'X', 0, '\r', 0, '\n', 0});
        const auto conflict = service.rollbackRun(
            L"chat-utf16",
            L"run-utf16",
            L"operation-conflict");
        EXPECT_EQ(conflict.state, BuildFileRollbackState::Conflict);
    }

    TEST(BuildFileWorkspaceServiceTests, RollbackCheckpointSurvivesWorkspaceServiceRestart)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path source = project / L"mods" / L"Example" / L"restart.ini";
        const std::filesystem::path managed =
            project / L"mods" / L"Fluxora AI Overrides" / L"restart.ini";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source, "Value=before\r\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        {
            BuildFileWorkspaceService service(logger, pathSettings);
            service.initialize();
            service.beginChat(L"chat-restart-public", project);
            const auto page = service.search(
                L"chat-restart-public",
                BuildFileSearchRequest{BuildFileScope::Build, L"restart.ini", 20, L""});
            ASSERT_EQ(page.entries.size(), 1u);
            const auto read = service.readText(
                L"chat-restart-public",
                BuildFileTextReadRequest{page.entries.front().fileRef, 1, 120, 8192});
            auto patch = BuildFileMutation::patch(
                page.entries.front().fileRef,
                read.sha256,
                L"before",
                L"after",
                BuildFileMutationFormat::Ini);
            patch.revision = page.entries.front().indexRevision;
            static_cast<void>(service.apply(
                L"chat-restart-public",
                L"run-restart-public",
                L"operation-restart-public",
                {patch}));
            ASSERT_TRUE(std::filesystem::is_regular_file(managed));
            service.shutdown();
        }
        {
            BuildFileWorkspaceService restarted(logger, pathSettings);
            restarted.initialize();
            restarted.beginChat(L"chat-restart-public", project);
            const auto rollback = restarted.rollbackRun(
                L"chat-restart-public",
                L"run-restart-public",
                L"operation-restart-public-rollback");
            EXPECT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
            EXPECT_FALSE(std::filesystem::exists(managed));
        }
        pathSettings.shutdown();
    }

    TEST(BuildFileWorkspaceServiceTests, SearchExposesArchiveMetadataButNotScriptsOrProtectedFiles)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(project / L"mods" / L"Example" / L"readme.md", "readme");
        writeTextFile(project / L"mods" / L"Example" / L"install.ps1", "Write-Host unsafe");
        writeTextFile(project / L"mods" / L"Example" / L"state.fluxora.json", "{}");
        writeTextFile(project / L"mods" / L"Example" / L"payload.zip", "PK");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-types", project);

        const auto page = service.search(
            L"chat-types",
            BuildFileSearchRequest{BuildFileScope::Build, L"Example", 20, L""});
        ASSERT_EQ(page.entries.size(), 2u);
        EXPECT_EQ(page.entries[0].kind, BuildFileKind::Archive);
        EXPECT_EQ(page.entries[1].kind, BuildFileKind::Text);
        const auto archive = std::find_if(page.entries.begin(), page.entries.end(), [](const auto& entry)
        {
            return entry.kind == BuildFileKind::Archive;
        });
        ASSERT_NE(archive, page.entries.end());
        const auto error = capturedWorkspaceError([&]
        {
            static_cast<void>(service.readText(
                L"chat-types",
                BuildFileTextReadRequest{archive->fileRef, 1, 120, 8192}));
        });
        EXPECT_EQ(error.code(), "protected");
    }

    TEST(BuildFileWorkspaceServiceTests, LazySearchPagesAndWholeDocumentSaveHandleEmptyFiles)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path emptyFile = project / L"mods" / L"Example" / L"empty.txt";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(emptyFile, "");
        for (int index = 0; index < 530; ++index)
        {
            writeTextFile(
                project / L"mods" / (L"Scan-" + std::to_wstring(index))
                    / (L"ignored-" + std::to_wstring(index) + L".txt"),
                "ignored\n");
        }
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-lazy", project);

        const auto firstPage = service.search(
            L"chat-lazy",
            BuildFileSearchRequest{BuildFileScope::Build, L"", 20, L""});
        ASSERT_EQ(firstPage.entries.size(), 20u);
        EXPECT_TRUE(firstPage.indexed);
        EXPECT_EQ(firstPage.totalMatches, 531u);
        EXPECT_FALSE(firstPage.nextCursor.empty());
        BuildFileSearchRequest nextRequest{BuildFileScope::Build, L"", 20, firstPage.nextCursor};
        nextRequest.revision = firstPage.revision;
        const auto nextPage = service.search(L"chat-lazy", nextRequest);
        ASSERT_EQ(nextPage.entries.size(), 20u);
        EXPECT_EQ(nextPage.revision, firstPage.revision);
        EXPECT_TRUE(nextPage.indexed);
        EXPECT_NE(nextPage.nextCursor, firstPage.nextCursor);
        for (const auto& entry : nextPage.entries)
        {
            EXPECT_EQ(std::find_if(
                firstPage.entries.begin(),
                firstPage.entries.end(),
                [&](const auto& firstEntry) { return firstEntry.fileRef == entry.fileRef; }),
                firstPage.entries.end());
        }

        writeTextFile(project / L"mods" / L"Late" / L"after-first-page.txt", "late\n");
        const auto stalePage = capturedWorkspaceError([&]
        {
            static_cast<void>(service.search(L"chat-lazy", nextRequest));
        });
        EXPECT_EQ(stalePage.code(), "stale-revision");

        const auto exact = service.search(
            L"chat-lazy",
            BuildFileSearchRequest{BuildFileScope::Build, L"Example/empty.txt", 20, L""});
        ASSERT_EQ(exact.entries.size(), 1u);
        const auto document = service.readText(
            L"chat-lazy",
            BuildFileTextReadRequest{exact.entries.front().fileRef, 1, 120, 8192});
        EXPECT_TRUE(document.content.empty());

        auto replace = BuildFileMutation::patch(
            exact.entries.front().fileRef,
            document.sha256,
            L"",
            L"saved\n",
            BuildFileMutationFormat::PlainText);
        replace.wholeDocument = true;
        replace.revision = exact.entries.front().indexRevision;
        static_cast<void>(service.apply(
            L"chat-lazy",
            L"run-document",
            L"operation-document",
            {replace}));
        EXPECT_TRUE(readTextFile(emptyFile).empty());
        EXPECT_EQ(
            readTextFile(project / L"mods" / L"Fluxora AI Overrides" / L"empty.txt"),
            "saved\n");
    }

    TEST(BuildFileWorkspaceServiceTests, ContentSearchPagesRemainDistinctAndRejectStaleRevision)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        std::string content;
        for (int index = 0; index < 25; ++index)
        {
            content += "needle line " + std::to_string(index) + "\n";
        }
        writeTextFile(project / L"mods" / L"Example" / L"matches.txt", content);
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-content-pages", project);

        BuildFileSearchRequest request{BuildFileScope::Build, L"needle", 10, L""};
        const auto first = service.searchText(L"chat-content-pages", request);
        ASSERT_EQ(first.matches.size(), 10u);
        EXPECT_EQ(first.totalMatches, 25u);
        EXPECT_FALSE(first.complete);
        EXPECT_FALSE(first.nextCursor.empty());

        request.cursor = first.nextCursor;
        request.revision = first.revision;
        const auto second = service.searchText(L"chat-content-pages", request);
        ASSERT_EQ(second.matches.size(), 10u);
        EXPECT_EQ(second.revision, first.revision);
        EXPECT_EQ(second.totalMatches, first.totalMatches);
        EXPECT_NE(second.nextCursor, first.nextCursor);
        EXPECT_LT(first.matches.back().line, second.matches.front().line);

        writeTextFile(project / L"mods" / L"Example" / L"late-match.txt", "needle late\n");
        const auto stale = capturedWorkspaceError([&]
        {
            static_cast<void>(service.searchText(L"chat-content-pages", request));
        });
        EXPECT_EQ(stale.code(), "stale-revision");
    }

    TEST(BuildFileWorkspaceServiceTests, ContentSearchReportsCooperativeCancellation)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        for (int index = 0; index < 12; ++index)
        {
            writeTextFile(
                project / L"mods" / L"Example" / (L"match-" + std::to_wstring(index) + L".txt"),
                "needle\n");
        }
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-content-cancel", project);

        const auto indexed = service.search(
            L"chat-content-cancel",
            BuildFileSearchRequest{BuildFileScope::Build, L"", 1, L""});
        ASSERT_TRUE(indexed.indexed);

        BuildFileSearchRequest request{BuildFileScope::Build, L"needle", 10, L""};
        request.cancellationRequested = [] { return true; };
        const auto cancelled = service.searchText(L"chat-content-cancel", request);

        EXPECT_TRUE(cancelled.cancelled);
        EXPECT_FALSE(cancelled.complete);
        EXPECT_TRUE(cancelled.nextCursor.empty());
        EXPECT_TRUE(cancelled.matches.empty());
    }

    TEST(BuildFileWorkspaceServiceTests, MetadataSearchFindsNamedConfigBeyondTheInitialTraversalWindow)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        for (int index = 0; index < 600; ++index)
        {
            writeTextFile(
                project / L"mods" / L"00-decoys" /
                    (L"readme-" + std::to_wstring(index) + L".txt"),
                "allowed-decoy\n");
        }
        const std::filesystem::path communityShaders =
            project / L"mods" / L"CommunityShaders_AIO" / L"SKSE" / L"Plugins" /
            L"CommunityShaders";
        for (int index = 0; index < 30; ++index)
        {
            writeTextFile(
                communityShaders / L"ImageSpaces" /
                    (L"preset-" + std::to_wstring(index) + L".json"),
                "{}\n");
        }
        const std::filesystem::path settings = communityShaders / L"SettingsUser.json";
        writeTextFile(settings, "{\"Menu\":{\"ToggleKey\":35}}\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-large-config", project);

        const BuildFileSearchPage page = service.search(
            L"chat-large-config",
            BuildFileSearchRequest{BuildFileScope::Build, L"Community Shaders", 20, L""});

        const auto match = std::find_if(page.entries.begin(), page.entries.end(), [](const auto& entry)
        {
            return entry.fileName == L"SettingsUser.json";
        });
        ASSERT_NE(match, page.entries.end());
        EXPECT_EQ(
            match->relativePath,
            L"CommunityShaders_AIO/SKSE/Plugins/CommunityShaders/SettingsUser.json");
    }

    TEST(BuildFileWorkspaceServiceTests, DiscoveryResolvesCommunityShadersEffectiveWinnerWithEvidence)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path lowerMod = project / L"mods" / L"Community Shaders";
        const std::filesystem::path winningMod = project / L"mods" / L"Cabbage CS Preset";
        const std::filesystem::path virtualPath =
            std::filesystem::path(L"SKSE") / L"Plugins" / L"CommunityShaders" / L"SettingsUser.json";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            lowerMod / virtualPath,
            "{\"Menu\":{\"ToggleKey\":33},\"ShaderBlockNextKey\":34}\n");
        writeTextFile(
            winningMod / virtualPath,
            "{\"Menu\":{\"ToggleKey\":35},\"ShaderBlockNextKey\":34}\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            lowerMod,
            L"Community Shaders",
            L"1.0",
            ModSourceRecord{L"local"}));
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            winningMod,
            L"Cabbage CS Preset",
            L"1.0",
            ModSourceRecord{L"local"}));
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Community Shaders", L""},
                ProfileOrderImportItemRecord{L"mod", L"Cabbage CS Preset", L""}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-community-shaders", project, L"Default");

        const BuildFileDiscoveryPage page = service.discover(
            L"chat-community-shaders",
            BuildFileDiscoveryRequest{
                {BuildFileScope::Build},
                {L"Community Shader", L"Community Shaders", L"CommunityShaders", L"CS"},
                {L".json"},
                {L"SettingsUser.json"},
                {L"Menu.ToggleKey", L"ShaderBlockNextKey"},
                20,
                L"",
                L""
            });

        ASSERT_TRUE(page.complete);
        ASSERT_FALSE(page.candidates.empty());
        EXPECT_GE(page.totalMatches, 2u);
        EXPECT_EQ(page.resolution, BuildFileResolution::Ambiguous);
        const BuildFileDiscoveryCandidate& candidate = page.candidates.front();
        EXPECT_EQ(candidate.file.fileName, L"SettingsUser.json");
        EXPECT_EQ(candidate.file.ownerMod, L"Cabbage CS Preset");
        EXPECT_EQ(candidate.effectiveOwner, L"Cabbage CS Preset");
        EXPECT_TRUE(candidate.effectiveWinner);
        EXPECT_GE(candidate.confidence, 0.9);
        EXPECT_EQ(candidate.virtualPath, virtualPath.generic_wstring());
        EXPECT_NE(
            std::find(candidate.matchReasons.begin(), candidate.matchReasons.end(), L"semantic-key"),
            candidate.matchReasons.end());
        EXPECT_NE(
            std::find(candidate.file.conflictingOwners.begin(), candidate.file.conflictingOwners.end(), L"Community Shaders"),
            candidate.file.conflictingOwners.end());
        EXPECT_EQ(page.statistics.unavailableRoots, 0u);
        EXPECT_GE(page.statistics.scannedEntries, 2u);

        const auto toggle = service.queryJson(
            L"chat-community-shaders",
            candidate.file.fileRef,
            L"/Menu/ToggleKey");
        const auto conflict = service.queryJson(
            L"chat-community-shaders",
            candidate.file.fileRef,
            L"/ShaderBlockNextKey");
        EXPECT_EQ(toggle.value, L"35");
        EXPECT_EQ(conflict.value, L"34");
        const auto recipe = service.inspectConfigRecipe(
            L"chat-community-shaders",
            candidate.file.fileRef,
            L"/Menu/ToggleKey",
            L"34");
        EXPECT_TRUE(recipe.matched);
        EXPECT_EQ(recipe.recipeId, L"generic.json-pointer.v1");
        EXPECT_EQ(recipe.currentValue, L"35");
        EXPECT_EQ(recipe.encodedValue, L"34");
        EXPECT_TRUE(recipe.conflicts.empty());
        EXPECT_FALSE(recipe.needsInput);
        EXPECT_TRUE(recipe.question.empty());
    }

    TEST(BuildFileWorkspaceServiceTests, DiscoveryPagesAreStableAndResolutionIsOwnedByCore)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        for (int index = 0; index < 27; ++index)
        {
            writeTextFile(
                project / L"mods" / (L"Shader Candidate " + std::to_wstring(index)) /
                    L"SKSE" / L"Plugins" / (L"candidate-" + std::to_wstring(index) + L".ini"),
                "[Shader]\nEnabled=true\n");
        }
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-discovery-pages", project, L"Default");

        const BuildFileDiscoveryRequest request{
            {BuildFileScope::Build},
            {L"Shader Candidate"},
            {L".ini"},
            {},
            {},
            10,
            L"",
            L""};
        const auto first = service.discover(L"chat-discovery-pages", request);
        ASSERT_EQ(first.candidates.size(), 10u);
        EXPECT_EQ(first.totalMatches, 27u);
        EXPECT_GE(first.indexedCount, 27u);
        EXPECT_FALSE(first.complete);
        EXPECT_FALSE(first.nextCursor.empty());
        EXPECT_EQ(first.resolution, BuildFileResolution::Ambiguous);

        auto secondRequest = request;
        secondRequest.revision = first.revision;
        secondRequest.cursor = first.nextCursor;
        const auto second = service.discover(L"chat-discovery-pages", secondRequest);
        ASSERT_EQ(second.candidates.size(), 10u);
        EXPECT_EQ(second.totalMatches, first.totalMatches);
        EXPECT_EQ(second.revision, first.revision);
        EXPECT_NE(second.nextCursor, first.nextCursor);
        EXPECT_NE(
            second.candidates.front().file.fileRef,
            first.candidates.front().file.fileRef);

        auto finalRequest = request;
        finalRequest.revision = second.revision;
        finalRequest.cursor = second.nextCursor;
        const auto finalPage = service.discover(L"chat-discovery-pages", finalRequest);
        EXPECT_EQ(finalPage.candidates.size(), 7u);
        EXPECT_TRUE(finalPage.complete);
        EXPECT_TRUE(finalPage.nextCursor.empty());

        auto missingRequest = request;
        missingRequest.aliases = {L"definitely missing config"};
        missingRequest.extensions = {L".json"};
        const auto missing = service.discover(L"chat-discovery-pages", missingRequest);
        EXPECT_EQ(missing.resolution, BuildFileResolution::NotFound);
        EXPECT_EQ(missing.totalMatches, 0u);
        EXPECT_TRUE(missing.complete);
    }

    TEST(BuildFileWorkspaceServiceTests, DiscoveryAllowsReversibleStructuredMutationOfOverwriteWinner)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path virtualPath =
            std::filesystem::path(L"SKSE") / L"Plugins" / L"CommunityShaders" / L"SettingsUser.json";
        const std::filesystem::path modFile = project / L"mods" / L"Community Shaders" / virtualPath;
        const std::filesystem::path overwriteFile = project / L"overwrite" / virtualPath;
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(modFile, "{\"Menu\":{\"ToggleKey\":35},\"ShaderBlockNextKey\":33}\n");
        writeTextFile(overwriteFile, "{\"Menu\":{\"ToggleKey\":36},\"ShaderBlockNextKey\":33}\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            modFile.parent_path().parent_path().parent_path().parent_path(),
            L"Community Shaders",
            L"1.0",
            ModSourceRecord{L"local"}));
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {ProfileOrderImportItemRecord{L"mod", L"Community Shaders", L""}});

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-overwrite-winner", project, L"Default");

        const auto discovery = service.discover(
            L"chat-overwrite-winner",
            BuildFileDiscoveryRequest{
                {BuildFileScope::Build},
                {L"Community Shaders", L"CommunityShaders", L"CS"},
                {L".json"},
                {L"SettingsUser.json"},
                {L"Menu.ToggleKey", L"ShaderBlockNextKey"},
                20,
                L"",
                L""});

        ASSERT_FALSE(discovery.candidates.empty());
        const auto& winner = discovery.candidates.front();
        EXPECT_TRUE(winner.effectiveWinner);
        EXPECT_EQ(winner.effectiveOwner, L"Overwrite");
        EXPECT_EQ(winner.file.ownerMod, L"Overwrite");
        EXPECT_FALSE(winner.file.managedOverrideEligible);
        EXPECT_TRUE(winner.file.directMutationEligible);
        EXPECT_EQ(winner.virtualPath, virtualPath.generic_wstring());
        EXPECT_NE(
            std::find(winner.file.conflictingOwners.begin(), winner.file.conflictingOwners.end(), L"Community Shaders"),
            winner.file.conflictingOwners.end());

        const auto exact = service.search(
            L"chat-overwrite-winner",
            BuildFileSearchRequest{
                BuildFileScope::Build,
                L"Community Shaders/SKSE/Plugins/CommunityShaders/SettingsUser.json",
                20,
                L""});
        ASSERT_EQ(exact.entries.size(), 1u);
        EXPECT_EQ(exact.entries.front().ownerMod, L"Overwrite");
        EXPECT_TRUE(exact.entries.front().directMutationEligible);
        const auto toggle = service.queryJson(
            L"chat-overwrite-winner",
            exact.entries.front().fileRef,
            L"/Menu/ToggleKey");
        EXPECT_EQ(toggle.value, L"36");
        auto mutation = BuildFileMutation::jsonPointer(
            exact.entries.front().fileRef,
            toggle.sha256,
            L"/Menu/ToggleKey",
            L"36",
            L"34");
        mutation.revision = exact.entries.front().indexRevision;
        const auto changeSet = service.apply(
            L"chat-overwrite-winner",
            L"run-overwrite-winner",
            L"operation-overwrite-winner",
            {mutation});
        ASSERT_EQ(changeSet.files.size(), 1u);
        EXPECT_EQ(changeSet.files.front().ownerMod, L"Overwrite");
        EXPECT_NE(readTextFile(overwriteFile).find("\"ToggleKey\":34"), std::string::npos);
        EXPECT_EQ(readTextFile(modFile), "{\"Menu\":{\"ToggleKey\":35},\"ShaderBlockNextKey\":33}\n");
        EXPECT_FALSE(std::filesystem::exists(project / L"mods" / L"Fluxora AI Overrides" / virtualPath));

        const auto rollback = service.rollbackRun(
            L"chat-overwrite-winner",
            L"run-overwrite-winner",
            L"operation-overwrite-winner-rollback");
        EXPECT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_EQ(readTextFile(overwriteFile), "{\"Menu\":{\"ToggleKey\":36},\"ShaderBlockNextKey\":33}\n");
    }

    TEST(BuildFileWorkspaceServiceTests, JsonPointerMutationUsesManagedProfileOverrideAndRollsBack)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path sourceMod = project / L"mods" / L"Cabbage CS Preset";
        const std::filesystem::path virtualPath =
            std::filesystem::path(L"SKSE") / L"Plugins" / L"CommunityShaders" / L"SettingsUser.json";
        const std::filesystem::path sourceFile = sourceMod / virtualPath;
        const std::filesystem::path overrideFile =
            project / L"mods" / L"Fluxora AI Overrides" / virtualPath;
        const std::string original =
            "{\n  \"Menu\": { \"ToggleKey\": 35 },\n  \"ShaderBlockNextKey\": 34\n}\n";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(sourceFile, original);
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            sourceMod,
            L"Cabbage CS Preset",
            L"1.0",
            ModSourceRecord{L"local"}));
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {ProfileOrderImportItemRecord{L"mod", L"Cabbage CS Preset", L""}});

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-managed-override", project, L"Default");
        const auto discovery = service.discover(
            L"chat-managed-override",
            BuildFileDiscoveryRequest{
                {BuildFileScope::Build},
                {L"Community Shaders", L"CS"},
                {L".json"},
                {L"SettingsUser.json"},
                {L"Menu.ToggleKey", L"ShaderBlockNextKey"},
                20,
                L"",
                L""
            });
        const auto settingsCandidate = std::find_if(
            discovery.candidates.begin(),
            discovery.candidates.end(),
            [](const auto& candidate)
            {
                return candidate.file.fileName == L"SettingsUser.json" && candidate.effectiveWinner;
            });
        ASSERT_NE(settingsCandidate, discovery.candidates.end());
        const auto exactSettings = service.search(
            L"chat-managed-override",
            BuildFileSearchRequest{
                BuildFileScope::Build,
                L"Cabbage CS Preset/SKSE/Plugins/CommunityShaders/SettingsUser.json",
                20,
                L""});
        ASSERT_EQ(exactSettings.entries.size(), 1u);
        EXPECT_TRUE(exactSettings.entries.front().managedOverrideEligible);
        const auto toggle = service.queryJson(
            L"chat-managed-override",
            exactSettings.entries.front().fileRef,
            L"/Menu/ToggleKey");
        ASSERT_EQ(toggle.value, L"35");
        const auto recipe = service.inspectConfigRecipe(
            L"chat-managed-override",
            exactSettings.entries.front().fileRef,
            L"/Menu/ToggleKey",
            L"PageDown");
        ASSERT_TRUE(recipe.matched);
        EXPECT_EQ(recipe.recipeId, L"community-shaders.menu-toggle-key.v1");
        EXPECT_EQ(recipe.currentValue, L"35");
        EXPECT_EQ(recipe.encodedValue, L"34");
        EXPECT_FALSE(recipe.needsInput);

        auto mutation = BuildFileMutation::jsonPointer(
            exactSettings.entries.front().fileRef,
            toggle.sha256,
            L"/Menu/ToggleKey",
            L"35",
            recipe.encodedValue);
        mutation.revision = exactSettings.entries.front().indexRevision;
        const auto changeSet = service.apply(
            L"chat-managed-override",
            L"run-managed-override",
            L"operation-managed-override",
            {mutation});

        ASSERT_EQ(changeSet.files.size(), 1u);
        EXPECT_EQ(readTextFile(sourceFile), original);
        ASSERT_TRUE(std::filesystem::is_regular_file(overrideFile));
        EXPECT_NE(readTextFile(overrideFile).find("\"ToggleKey\":34"), std::string::npos);
        EXPECT_EQ(changeSet.files.front().ownerMod, L"Fluxora AI Overrides");
        EXPECT_EQ(changeSet.files.front().relativePath, L"Fluxora AI Overrides/" + virtualPath.generic_wstring());
        EXPECT_EQ(changeSet.files.front().verification, L"json-pointer-matched-after-reread");

        const auto order = InstanceMetadataStore::listCachedProfileOrderItems(
            project,
            L"Default",
            project / L"mods");
        ASSERT_FALSE(order.empty());
        EXPECT_EQ(order.back().mod.folderName, L"Fluxora AI Overrides");
        EXPECT_NE(order.back().mod.state, L"disabled");

        const auto secondDiscovery = service.discover(
            L"chat-managed-override",
            BuildFileDiscoveryRequest{
                {BuildFileScope::Build},
                {L"Community Shaders", L"CS"},
                {L".json"},
                {L"SettingsUser.json"},
                {L"Menu.ToggleKey", L"ShaderBlockNextKey"},
                20,
                L"",
                L""
            });
        const auto managedCandidate = std::find_if(
            secondDiscovery.candidates.begin(),
            secondDiscovery.candidates.end(),
            [](const auto& candidate)
            {
                return candidate.file.ownerMod == L"Fluxora AI Overrides" && candidate.effectiveWinner;
            });
        ASSERT_NE(managedCandidate, secondDiscovery.candidates.end());
        const auto exactManaged = service.search(
            L"chat-managed-override",
            BuildFileSearchRequest{
                BuildFileScope::Build,
                L"Fluxora AI Overrides/SKSE/Plugins/CommunityShaders/SettingsUser.json",
                20,
                L""});
        ASSERT_EQ(exactManaged.entries.size(), 1u);
        const auto managedToggle = service.queryJson(
            L"chat-managed-override",
            exactManaged.entries.front().fileRef,
            L"/Menu/ToggleKey");
        ASSERT_EQ(managedToggle.value, L"34");
        auto reusedMutation = BuildFileMutation::jsonPointer(
            exactManaged.entries.front().fileRef,
            managedToggle.sha256,
            L"/Menu/ToggleKey",
            L"34",
            L"35");
        reusedMutation.revision = exactManaged.entries.front().indexRevision;
        const auto reusedChangeSet = service.apply(
            L"chat-managed-override",
            L"run-managed-override-reuse",
            L"operation-managed-override-reuse",
            {reusedMutation});
        ASSERT_EQ(reusedChangeSet.files.size(), 1u);
        EXPECT_EQ(reusedChangeSet.files.front().status, BuildFileChangeStatus::Applied);
        EXPECT_NE(readTextFile(overrideFile).find("\"ToggleKey\":35"), std::string::npos);
        EXPECT_EQ(readTextFile(sourceFile), original);

        const auto reusedRollback = service.rollbackRun(
            L"chat-managed-override",
            L"run-managed-override-reuse",
            L"operation-managed-override-reuse-rollback");
        EXPECT_EQ(reusedRollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_NE(readTextFile(overrideFile).find("\"ToggleKey\":34"), std::string::npos);

        const auto rollback = service.rollbackRun(
            L"chat-managed-override",
            L"run-managed-override",
            L"operation-managed-override-rollback");
        EXPECT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_FALSE(std::filesystem::exists(overrideFile));
        EXPECT_EQ(readTextFile(sourceFile), original);
    }

    TEST(BuildFileWorkspaceServiceTests, GenericJsonPointerPreflightSupportsUnrelatedModConfigs)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path virtualPath =
            std::filesystem::path(L"Config") / L"OtherMod" / L"UserSettings.json";
        const std::filesystem::path sourceFile = project / L"mods" / L"Universal Config Mod" / virtualPath;
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            sourceFile,
            "{\"Input\":{\"Shortcut\":7},\"Unrelated\":7}\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-no-conflict", project, L"Default");
        const auto discovery = service.discover(
            L"chat-no-conflict",
            BuildFileDiscoveryRequest{
                {BuildFileScope::Build},
                {L"Universal Config Mod", L"OtherMod"},
                {L".json"},
                {L"UserSettings.json"},
                {L"Input.Shortcut"},
                20,
                L"",
                L""});
        ASSERT_FALSE(discovery.candidates.empty());
        const auto query = service.queryJson(
            L"chat-no-conflict",
            discovery.candidates.front().file.fileRef,
            L"/Input/Shortcut");
        const auto recipe = service.inspectConfigRecipe(
            L"chat-no-conflict",
            discovery.candidates.front().file.fileRef,
            L"/Input/Shortcut",
            L"9");
        EXPECT_TRUE(recipe.matched);
        EXPECT_EQ(recipe.recipeId, L"generic.json-pointer.v1");
        EXPECT_EQ(recipe.currentValue, L"7");
        EXPECT_EQ(recipe.encodedValue, L"9");
        EXPECT_FALSE(recipe.needsInput);
        EXPECT_TRUE(recipe.conflicts.empty());

        auto mutation = BuildFileMutation::jsonPointer(
            discovery.candidates.front().file.fileRef,
            query.sha256,
            L"/Input/Shortcut",
            L"7",
            recipe.encodedValue);
        mutation.revision = discovery.candidates.front().file.indexRevision;
        const auto changed = service.apply(
            L"chat-no-conflict",
            L"run-no-conflict",
            L"operation-no-conflict",
            {mutation});
        ASSERT_EQ(changed.files.size(), 1u);
        EXPECT_EQ(changed.files.front().verification, L"json-pointer-matched-after-reread");
        EXPECT_NE(readTextFile(
            project / L"mods" / L"Fluxora AI Overrides" / virtualPath).find(
                "\"Shortcut\":9"), std::string::npos);
    }

    TEST(BuildFileWorkspaceServiceTests, BinaryTextPayloadIsRejectedAfterMetadataDiscovery)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeBytes(project / L"mods" / L"Example" / L"binary.txt", {'A', 0, 'B'});
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-binary", project);

        const auto page = service.search(
            L"chat-binary",
            BuildFileSearchRequest{BuildFileScope::Build, L"Example/binary.txt", 20, L""});
        ASSERT_EQ(page.entries.size(), 1u);
        const auto error = capturedWorkspaceError([&]
        {
            static_cast<void>(service.readText(
                L"chat-binary",
                BuildFileTextReadRequest{page.entries.front().fileRef, 1, 120, 8192}));
        });
        EXPECT_EQ(error.code(), "binary");
    }

    TEST(BuildFileWorkspaceServiceTests, JsonPointerContentSearchAndIniLineModelStayBounded)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path jsonFile = project / L"mods" / L"Example" / L"settings.jsonc";
        const std::filesystem::path iniFile = project / L"mods" / L"Example" / L"settings.ini";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(jsonFile, "{\n  // retained\n  \"nested\": { \"enabled\": true }\n}\n");
        writeTextFile(iniFile, "; retained\r\n[Display]\r\nQuality=High\r\n\r\n[Other]\r\nValue=1\r\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-structured", project);

        const auto jsonPage = service.search(
            L"chat-structured",
            BuildFileSearchRequest{BuildFileScope::Build, L"settings.jsonc", 20, L""});
        const auto iniPage = service.search(
            L"chat-structured",
            BuildFileSearchRequest{BuildFileScope::Build, L"settings.ini", 20, L""});
        ASSERT_EQ(jsonPage.entries.size(), 1u);
        ASSERT_EQ(iniPage.entries.size(), 1u);
        const auto jsonQuery = service.queryJson(
            L"chat-structured",
            jsonPage.entries.front().fileRef,
            L"/nested/enabled");
        EXPECT_EQ(jsonQuery.value, L"true");
        const auto jsonOutline = service.queryJson(
            L"chat-structured",
            jsonPage.entries.front().fileRef,
            L"@outline");
        EXPECT_EQ(jsonOutline.kind, L"jsonc-outline");
        EXPECT_NE(jsonOutline.value.find(L"/nested/enabled : boolean"), std::wstring::npos);
        EXPECT_EQ(jsonOutline.value.find(L"true"), std::wstring::npos);

        auto jsoncMutation = BuildFileMutation::jsonPointer(
            jsonPage.entries.front().fileRef,
            jsonQuery.sha256,
            L"/nested/enabled",
            L"true",
            L"false");
        jsoncMutation.format = BuildFileMutationFormat::Jsonc;
        jsoncMutation.revision = jsonPage.entries.front().indexRevision;
        const auto jsoncChange = service.apply(
            L"chat-structured",
            L"run-jsonc-pointer",
            L"operation-jsonc-pointer",
            {jsoncMutation});
        ASSERT_EQ(jsoncChange.files.size(), 1u);
        EXPECT_EQ(jsoncChange.files.front().verification, L"json-pointer-matched-after-reread");
        EXPECT_NE(readTextFile(jsonFile).find("// retained"), std::string::npos);
        EXPECT_NE(readTextFile(
            project / L"mods" / L"Fluxora AI Overrides" / L"settings.jsonc").find(
                "\"enabled\":false"), std::string::npos);
        EXPECT_EQ(service.rollbackRun(
            L"chat-structured", L"run-jsonc-pointer", L"rollback-jsonc-pointer").state,
            BuildFileRollbackState::RolledBack);

        const auto search = service.searchText(
            L"chat-structured",
            BuildFileSearchRequest{BuildFileScope::Build, L"retained", 20, L""});
        ASSERT_EQ(search.matches.size(), 2u);
        EXPECT_TRUE(std::all_of(search.matches.begin(), search.matches.end(), [](const auto& match)
        {
            return !match.fileRef.empty() && match.fileRef.find(L":\\") == std::wstring::npos;
        }));

        const auto currentIniPage = service.search(
            L"chat-structured",
            BuildFileSearchRequest{BuildFileScope::Build, L"Example/settings.ini", 20, L""});
        ASSERT_EQ(currentIniPage.entries.size(), 1u);
        auto iniQuery = service.queryIni(
            L"chat-structured",
            currentIniPage.entries.front().fileRef,
            L"Display",
            L"Quality");
        EXPECT_NE(iniQuery.value.find(L"Quality=High"), std::wstring::npos);
        auto iniSetMutation = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniSetKey,
            currentIniPage.entries.front().fileRef,
            iniQuery.sha256,
            L"Display",
            L"Quality",
            L"Ultra");
        iniSetMutation.revision = currentIniPage.entries.front().indexRevision;
        static_cast<void>(service.apply(
            L"chat-structured",
            L"run-ini-set",
            L"operation-ini-set",
            {iniSetMutation}));
        const std::filesystem::path iniOverride =
            project / L"mods" / L"Fluxora AI Overrides" / L"settings.ini";
        EXPECT_NE(readTextFile(iniFile).find("Quality=High"), std::string::npos);
        EXPECT_NE(readTextFile(iniOverride).find("; retained\r\n[Display]\r\nQuality=Ultra\r\n"), std::string::npos);

        const std::filesystem::path iniAddFile =
            project / L"mods" / L"Example" / L"settings-add.ini";
        const std::filesystem::path iniRemoveFile =
            project / L"mods" / L"Example" / L"settings-remove.ini";
        writeTextFile(iniAddFile, "[Display]\r\nQuality=High\r\n");
        writeTextFile(iniRemoveFile, "[Display]\r\nVSync=1\r\n");
        const auto iniAddPage = service.search(
            L"chat-structured",
            BuildFileSearchRequest{BuildFileScope::Build, L"settings-add.ini", 20, L""});
        ASSERT_EQ(iniAddPage.entries.size(), 1u);
        iniQuery = service.queryIni(
            L"chat-structured",
            iniAddPage.entries.front().fileRef,
            L"Display",
            L"");
        auto iniAddMutation = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniAddKey,
            iniAddPage.entries.front().fileRef,
            iniQuery.sha256,
            L"Display",
            L"VSync",
            L"1");
        iniAddMutation.revision = iniAddPage.entries.front().indexRevision;
        static_cast<void>(service.apply(
            L"chat-structured",
            L"run-ini-add",
            L"operation-ini-add",
            {iniAddMutation}));
        EXPECT_NE(readTextFile(
            project / L"mods" / L"Fluxora AI Overrides" / L"settings-add.ini").find(
                "VSync=1\r\n"), std::string::npos);

        const auto iniRemovePage = service.search(
            L"chat-structured",
            BuildFileSearchRequest{BuildFileScope::Build, L"settings-remove.ini", 20, L""});
        ASSERT_EQ(iniRemovePage.entries.size(), 1u);
        iniQuery = service.queryIni(
            L"chat-structured",
            iniRemovePage.entries.front().fileRef,
            L"Display",
            L"VSync");
        auto iniRemoveMutation = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniRemoveKey,
            iniRemovePage.entries.front().fileRef,
            iniQuery.sha256,
            L"Display",
            L"VSync");
        iniRemoveMutation.revision = iniRemovePage.entries.front().indexRevision;
        static_cast<void>(service.apply(
            L"chat-structured",
            L"run-ini-remove",
            L"operation-ini-remove",
            {iniRemoveMutation}));
        EXPECT_EQ(readTextFile(
            project / L"mods" / L"Fluxora AI Overrides" / L"settings-remove.ini").find(
                "VSync=1"), std::string::npos);
        EXPECT_EQ(service.rollbackRun(
            L"chat-structured", L"run-ini-remove", L"rollback-ini-remove").state,
            BuildFileRollbackState::RolledBack);
        EXPECT_EQ(service.rollbackRun(
            L"chat-structured", L"run-ini-add", L"rollback-ini-add").state,
            BuildFileRollbackState::RolledBack);
        EXPECT_EQ(service.rollbackRun(
            L"chat-structured", L"run-ini-set", L"rollback-ini-set").state,
            BuildFileRollbackState::RolledBack);
        EXPECT_FALSE(std::filesystem::exists(iniOverride));
        EXPECT_FALSE(std::filesystem::exists(
            project / L"mods" / L"Fluxora AI Overrides" / L"settings-add.ini"));
        EXPECT_FALSE(std::filesystem::exists(
            project / L"mods" / L"Fluxora AI Overrides" / L"settings-remove.ini"));
    }

    TEST(BuildFileWorkspaceServiceTests, AppliesDistinctIniKeysInOneAtomicFileChange)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path source =
            project / L"mods" / L"No Grass In Objects" / L"SKSE" / L"Plugins" / L"GrassControl.ini";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            source,
            "[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=true\r\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-ini-batch", project);

        const auto page = service.search(
            L"chat-ini-batch",
            BuildFileSearchRequest{BuildFileScope::Build, L"GrassControl.ini", 20, L""});
        ASSERT_EQ(page.entries.size(), 1u);
        const auto useCache = service.queryIni(
            L"chat-ini-batch", page.entries.front().fileRef, L"Grass", L"Use-grass-cache");
        const auto onlyCache = service.queryIni(
            L"chat-ini-batch", page.entries.front().fileRef, L"Grass", L"Only-load-from-cache");

        auto enableGeneration = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniSetKey,
            page.entries.front().fileRef,
            useCache.sha256,
            L"Grass",
            L"Use-grass-cache",
            L"true");
        enableGeneration.expectedValue = L"false";
        enableGeneration.revision = page.entries.front().indexRevision;
        auto disableCacheOnly = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniSetKey,
            page.entries.front().fileRef,
            onlyCache.sha256,
            L"Grass",
            L"Only-load-from-cache",
            L"false");
        disableCacheOnly.expectedValue = L"true";
        disableCacheOnly.revision = page.entries.front().indexRevision;

        const auto duplicateError = capturedWorkspaceError([&]
        {
            static_cast<void>(service.apply(
                L"chat-ini-batch",
                L"run-duplicate-ini-key",
                L"operation-duplicate-ini-key",
                {enableGeneration, enableGeneration}));
        });
        EXPECT_EQ(duplicateError.code(), "validation-failed");

        const auto changeSet = service.apply(
            L"chat-ini-batch",
            L"run-distinct-ini-keys",
            L"operation-distinct-ini-keys",
            {enableGeneration, disableCacheOnly});
        ASSERT_EQ(changeSet.files.size(), 1u);
        EXPECT_EQ(changeSet.files.front().verification, L"ini-keys-matched-after-reread");
        EXPECT_EQ(changeSet.files.front().hunks.size(), 2u);
        EXPECT_EQ(
            readTextFile(source),
            "[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=true\r\n");
        const std::filesystem::path managed =
            project / L"mods" / L"Fluxora AI Overrides" / L"SKSE" / L"Plugins" / L"GrassControl.ini";
        const std::string managedText = readTextFile(managed);
        EXPECT_NE(managedText.find("Use-grass-cache=true"), std::string::npos);
        EXPECT_NE(managedText.find("Only-load-from-cache=false"), std::string::npos);

        const auto rollback = service.rollbackRun(
            L"chat-ini-batch",
            L"run-distinct-ini-keys",
            L"operation-distinct-ini-keys-rollback");
        EXPECT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_FALSE(std::filesystem::exists(managed));
    }

    TEST(BuildFileWorkspaceServiceTests, SearchReturnsExistingEffectiveManagedOverrideForSourceSpecificPath)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path sourceMod = project / L"mods" / L"No Grass In Objects";
        const std::filesystem::path virtualPath =
            std::filesystem::path(L"SKSE") / L"Plugins" / L"GrassControl.ini";
        const std::filesystem::path source = sourceMod / virtualPath;
        const std::filesystem::path managedMod = project / L"mods" / L"Fluxora AI Overrides";
        const std::filesystem::path managed = managedMod / virtualPath;
        const std::string originalSource =
            "[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=true\r\n";
        const std::string originalManaged =
            "[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=true\r\nManaged-only=keep\r\n";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source, originalSource);
        writeTextFile(managed, originalManaged);
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            sourceMod,
            L"No Grass In Objects",
            L"1.0",
            ModSourceRecord{L"local"}));
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            managedMod,
            L"Fluxora AI Overrides",
            L"",
            ModSourceRecord{L"local"}));
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"No Grass In Objects", L""},
                ProfileOrderImportItemRecord{L"mod", L"Fluxora AI Overrides", L""}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-existing-ini-override", project, L"Default");

        const auto page = service.search(
            L"chat-existing-ini-override",
            BuildFileSearchRequest{
                BuildFileScope::Build,
                L"No Grass In Objects/SKSE/Plugins/GrassControl.ini",
                20,
                L""});
        ASSERT_EQ(page.entries.size(), 1u);
        EXPECT_EQ(page.entries.front().ownerMod, L"Fluxora AI Overrides");
        EXPECT_EQ(
            page.entries.front().relativePath,
            L"Fluxora AI Overrides/" + virtualPath.generic_wstring());

        const auto useCache = service.queryIni(
            L"chat-existing-ini-override",
            page.entries.front().fileRef,
            L"Grass",
            L"Use-grass-cache");
        const auto onlyCache = service.queryIni(
            L"chat-existing-ini-override",
            page.entries.front().fileRef,
            L"Grass",
            L"Only-load-from-cache");
        auto enableGeneration = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniSetKey,
            page.entries.front().fileRef,
            useCache.sha256,
            L"Grass",
            L"Use-grass-cache",
            L"true");
        enableGeneration.expectedValue = L"false";
        enableGeneration.revision = page.entries.front().indexRevision;
        auto disableCacheOnly = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniSetKey,
            page.entries.front().fileRef,
            onlyCache.sha256,
            L"Grass",
            L"Only-load-from-cache",
            L"false");
        disableCacheOnly.expectedValue = L"true";
        disableCacheOnly.revision = page.entries.front().indexRevision;

        const auto changeSet = service.apply(
            L"chat-existing-ini-override",
            L"run-existing-ini-override",
            L"operation-existing-ini-override",
            {enableGeneration, disableCacheOnly});
        ASSERT_EQ(changeSet.files.size(), 1u);
        EXPECT_EQ(changeSet.files.front().ownerMod, L"Fluxora AI Overrides");
        EXPECT_EQ(readTextFile(source), originalSource);
        EXPECT_NE(readTextFile(managed).find("Use-grass-cache=true"), std::string::npos);
        EXPECT_NE(readTextFile(managed).find("Only-load-from-cache=false"), std::string::npos);
        EXPECT_NE(readTextFile(managed).find("Managed-only=keep"), std::string::npos);

        const auto rollback = service.rollbackRun(
            L"chat-existing-ini-override",
            L"run-existing-ini-override",
            L"operation-existing-ini-override-rollback");
        EXPECT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_EQ(readTextFile(managed), originalManaged);
        EXPECT_EQ(readTextFile(source), originalSource);
    }

    TEST(BuildFileWorkspaceServiceTests, SearchAndBatchMutateEffectiveOverwriteIniWithoutTouchingMods)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path sourceMod = project / L"mods" / L"No Grass In Objects - Grass Control";
        const std::filesystem::path managedMod = project / L"mods" / L"Fluxora AI Overrides";
        const std::filesystem::path virtualPath =
            std::filesystem::path(L"SKSE") / L"Plugins" / L"GrassControl.ini";
        const std::filesystem::path source = sourceMod / virtualPath;
        const std::filesystem::path managed = managedMod / virtualPath;
        const std::filesystem::path overwrite = project / L"overwrite" / virtualPath;
        const std::string sourceText =
            "[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=false\r\nSource-only=keep\r\n";
        const std::string managedText =
            "[Grass]\r\nUse-grass-cache=true\r\nOnly-load-from-cache=false\r\nManaged-only=keep\r\n";
        const std::string overwriteText =
            "[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=false\r\nOverwrite-only=keep\r\n";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source, sourceText);
        writeTextFile(managed, managedText);
        writeTextFile(overwrite, overwriteText);
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            sourceMod,
            L"No Grass In Objects - Grass Control",
            L"1.0",
            ModSourceRecord{L"local"}));
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            managedMod,
            L"Fluxora AI Overrides",
            L"",
            ModSourceRecord{L"local"}));
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"No Grass In Objects - Grass Control", L""},
                ProfileOrderImportItemRecord{L"mod", L"Fluxora AI Overrides", L""}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-overwrite-ini", project, L"Default");

        const auto broadPage = service.search(
            L"chat-overwrite-ini",
            BuildFileSearchRequest{
                BuildFileScope::Build,
                L"GrassControl.ini",
                20,
                L""});
        ASSERT_EQ(broadPage.entries.size(), 1u);
        EXPECT_EQ(broadPage.totalMatches, 1u);
        EXPECT_EQ(broadPage.entries.front().ownerMod, L"Overwrite");
        EXPECT_TRUE(broadPage.entries.front().directMutationEligible);
        EXPECT_NE(
            std::find(
                broadPage.entries.front().conflictingOwners.begin(),
                broadPage.entries.front().conflictingOwners.end(),
                L"No Grass In Objects - Grass Control"),
            broadPage.entries.front().conflictingOwners.end());
        EXPECT_NE(
            std::find(
                broadPage.entries.front().conflictingOwners.begin(),
                broadPage.entries.front().conflictingOwners.end(),
                L"Fluxora AI Overrides"),
            broadPage.entries.front().conflictingOwners.end());

        const auto page = service.search(
            L"chat-overwrite-ini",
            BuildFileSearchRequest{
                BuildFileScope::Build,
                L"No Grass In Objects - Grass Control/SKSE/Plugins/GrassControl.ini",
                20,
                L""});
        ASSERT_EQ(page.entries.size(), 1u);
        EXPECT_EQ(page.entries.front().fileRef, broadPage.entries.front().fileRef);
        EXPECT_EQ(page.entries.front().ownerMod, L"Overwrite");
        EXPECT_TRUE(page.entries.front().directMutationEligible);
        const auto useCache = service.queryIni(
            L"chat-overwrite-ini", page.entries.front().fileRef, L"Grass", L"Use-grass-cache");
        const auto onlyCache = service.queryIni(
            L"chat-overwrite-ini", page.entries.front().fileRef, L"Grass", L"Only-load-from-cache");
        auto useMutation = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniSetKey,
            page.entries.front().fileRef,
            useCache.sha256,
            L"Grass",
            L"Use-grass-cache",
            L"true");
        useMutation.expectedValue = L"false";
        useMutation.revision = page.entries.front().indexRevision;
        auto onlyMutation = BuildFileMutation::iniKey(
            BuildFileMutationOperation::IniSetKey,
            page.entries.front().fileRef,
            onlyCache.sha256,
            L"Grass",
            L"Only-load-from-cache",
            L"true");
        onlyMutation.expectedValue = L"false";
        onlyMutation.revision = page.entries.front().indexRevision;

        const auto changeSet = service.apply(
            L"chat-overwrite-ini",
            L"run-overwrite-ini",
            L"operation-overwrite-ini",
            {useMutation, onlyMutation});
        ASSERT_EQ(changeSet.files.size(), 1u);
        EXPECT_EQ(changeSet.files.front().ownerMod, L"Overwrite");
        EXPECT_EQ(readTextFile(source), sourceText);
        EXPECT_EQ(readTextFile(managed), managedText);
        EXPECT_NE(readTextFile(overwrite).find("Use-grass-cache=true"), std::string::npos);
        EXPECT_NE(readTextFile(overwrite).find("Only-load-from-cache=true"), std::string::npos);
        EXPECT_NE(readTextFile(overwrite).find("Overwrite-only=keep"), std::string::npos);

        service.shutdown();
        BuildFileWorkspaceService restoredService(logger, pathSettings);
        restoredService.initialize();
        restoredService.beginChat(L"chat-overwrite-ini", project, L"Default");
        const auto rollback = restoredService.rollbackRun(
            L"chat-overwrite-ini",
            L"run-overwrite-ini",
            L"operation-overwrite-ini-rollback");
        EXPECT_EQ(rollback.state, BuildFileRollbackState::RolledBack);
        EXPECT_EQ(readTextFile(overwrite), overwriteText);
        EXPECT_EQ(readTextFile(source), sourceText);
        EXPECT_EQ(readTextFile(managed), managedText);
    }

    TEST(BuildFileWorkspaceServiceTests, SearchGroupsPhysicalConflictsBeforePagingDistinctVirtualPaths)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path sourceMod = project / L"mods" / L"Source Mod";
        const std::filesystem::path managedMod = project / L"mods" / L"Fluxora AI Overrides";
        const std::filesystem::path firstVirtualPath =
            std::filesystem::path(L"SKSE") / L"Plugins" / L"GrassControl.ini";
        const std::filesystem::path secondVirtualPath =
            std::filesystem::path(L"SKSE") / L"Plugins" / L"Alternate" / L"GrassControl.ini";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(sourceMod / firstVirtualPath, "[Grass]\r\nEnabled=false\r\n");
        writeTextFile(managedMod / firstVirtualPath, "[Grass]\r\nEnabled=true\r\n");
        writeTextFile(project / L"overwrite" / firstVirtualPath, "[Grass]\r\nEnabled=true\r\n");
        writeTextFile(sourceMod / secondVirtualPath, "[Grass]\r\nEnabled=false\r\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            sourceMod,
            L"Source Mod",
            L"1.0",
            ModSourceRecord{L"local"}));
        static_cast<void>(InstanceMetadataStore::registerInstalledMod(
            project,
            managedMod,
            L"Fluxora AI Overrides",
            L"",
            ModSourceRecord{L"local"}));
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Source Mod", L""},
                ProfileOrderImportItemRecord{L"mod", L"Fluxora AI Overrides", L""}
            });

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-search-virtual-pages", project, L"Default");

        const auto firstPage = service.search(
            L"chat-search-virtual-pages",
            BuildFileSearchRequest{
                BuildFileScope::Build,
                L"GrassControl.ini",
                1,
                L""});
        ASSERT_EQ(firstPage.entries.size(), 1u);
        EXPECT_EQ(firstPage.totalMatches, 2u);
        EXPECT_FALSE(firstPage.complete);
        EXPECT_FALSE(firstPage.nextCursor.empty());

        const auto secondPage = service.search(
            L"chat-search-virtual-pages",
            BuildFileSearchRequest{
                BuildFileScope::Build,
                L"GrassControl.ini",
                1,
                firstPage.nextCursor,
                {},
                firstPage.revision});
        ASSERT_EQ(secondPage.entries.size(), 1u);
        EXPECT_EQ(secondPage.totalMatches, 2u);
        EXPECT_TRUE(secondPage.complete);
        EXPECT_TRUE(secondPage.nextCursor.empty());
        EXPECT_NE(
            firstPage.entries.front().relativePath,
            secondPage.entries.front().relativePath);
        EXPECT_NE(
            firstPage.entries.front().fileRef,
            secondPage.entries.front().fileRef);
    }

#ifdef _WIN32
    TEST(BuildFileWorkspaceServiceTests, SearchDoesNotFollowDirectoryReparsePoints)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path outside = temp.path() / L"Outside";
        const std::filesystem::path link = project / L"mods" / L"Example" / L"linked";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(outside / L"secret.txt", "outside\n");
        std::filesystem::create_directories(link.parent_path());
        std::error_code junctionError;
        if (!createDirectoryJunction(outside, link, junctionError))
        {
            GTEST_SKIP() << "Directory junction creation is unavailable: " << junctionError.message();
        }
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-reparse", project);

        const auto exact = service.search(
            L"chat-reparse",
            BuildFileSearchRequest{BuildFileScope::Build, L"Example/linked/secret.txt", 20, L""});
        EXPECT_TRUE(exact.entries.empty());
    }

    TEST(BuildFileWorkspaceServiceTests, PreservesWindows1251AndKeepsMixedBatchReferencesStable)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path legacy = project / L"mods" / L"Legacy Mod" / L"описание.txt";
        const std::filesystem::path seed = project / L"mods" / L"Legacy Mod" / L"seed.txt";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(seed, "seed\n");
        writeBytes(legacy, {
            0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2, ',', 0x20,
            0xEC, 0xE8, 0xF0, '!', '\r', '\n'
        });
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-legacy", project);

        const auto legacyPage = service.search(
            L"chat-legacy",
            BuildFileSearchRequest{BuildFileScope::Build, L"описание.txt", 20, L""});
        const auto seedPage = service.search(
            L"chat-legacy",
            BuildFileSearchRequest{BuildFileScope::Build, L"seed.txt", 20, L""});
        ASSERT_EQ(legacyPage.entries.size(), 1u);
        ASSERT_EQ(seedPage.entries.size(), 1u);
        const auto document = service.readText(
            L"chat-legacy",
            BuildFileTextReadRequest{legacyPage.entries.front().fileRef, 1, 120, 8192});
        EXPECT_EQ(document.encoding, BuildFileTextEncoding::Windows1251);
        EXPECT_EQ(document.content, L"Привет, мир!\n");

        auto legacyPatch = BuildFileMutation::patch(
            legacyPage.entries.front().fileRef,
            document.sha256,
            L"мир",
            L"Скайрим",
            BuildFileMutationFormat::PlainText);
        legacyPatch.revision = legacyPage.entries.front().indexRevision;
        const auto changeSet = service.apply(
            L"chat-legacy",
            L"run-legacy",
            L"operation-legacy",
            {
                BuildFileMutation::create(
                    seedPage.entries.front().parentRef,
                    L"new-note.txt",
                    L"new\n",
                    BuildFileMutationFormat::PlainText),
                legacyPatch
            });
        ASSERT_EQ(changeSet.files.size(), 2u);
        EXPECT_EQ(static_cast<unsigned char>(readRawBytes(legacy).front()), 0xCF);
        const auto bytes = readRawBytes(
            project / L"mods" / L"Fluxora AI Overrides" / L"описание.txt");
        EXPECT_NE(std::find(bytes.begin(), bytes.end(), static_cast<char>(0xD1)), bytes.end());
        EXPECT_EQ(service.rollbackRun(
            L"chat-legacy",
            L"run-legacy",
            L"operation-legacy-rollback").state,
            BuildFileRollbackState::RolledBack);
    }

    TEST(BuildFileWorkspaceServiceTests, AtomicBatchLimitsAndProtectedScopesFailBeforeAnySourceChanges)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Foundation Edition";
        const std::filesystem::path first = project / L"mods" / L"First Mod" / L"first.txt";
        const std::filesystem::path second = project / L"mods" / L"Second Mod" / L"second.txt";
        const std::filesystem::path gameConfig = project / L"stock game" / L"game.ini";
        const std::filesystem::path downloadText = project / L"downloads" / L"download.txt";
        writeTextFile(project / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(first, "first=old\n");
        writeTextFile(second, "second=old\n");
        writeTextFile(gameConfig, "game=old\n");
        writeTextFile(downloadText, "download=old\n");
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        BuildFileWorkspaceService service(logger, pathSettings);
        pathSettings.initialize();
        service.initialize();
        service.beginChat(L"chat-atomic", project);

        const auto firstPage = service.search(
            L"chat-atomic",
            BuildFileSearchRequest{BuildFileScope::Build, L"first.txt", 20, L""});
        const auto secondPage = service.search(
            L"chat-atomic",
            BuildFileSearchRequest{BuildFileScope::Build, L"second.txt", 20, L""});
        ASSERT_EQ(firstPage.entries.size(), 1u);
        ASSERT_EQ(secondPage.entries.size(), 1u);
        const auto firstRead = service.readText(
            L"chat-atomic",
            BuildFileTextReadRequest{firstPage.entries.front().fileRef, 1, 120, 8192});
        const auto secondRead = service.readText(
            L"chat-atomic",
            BuildFileTextReadRequest{secondPage.entries.front().fileRef, 1, 120, 8192});
        auto firstPatch = BuildFileMutation::patch(
            firstPage.entries.front().fileRef,
            firstRead.sha256,
            L"old",
            L"new",
            BuildFileMutationFormat::PlainText);
        firstPatch.revision = firstPage.entries.front().indexRevision;
        auto staleSecondPatch = BuildFileMutation::patch(
            secondPage.entries.front().fileRef,
            L"stale-hash",
            L"old",
            L"new",
            BuildFileMutationFormat::PlainText);
        staleSecondPatch.revision = secondPage.entries.front().indexRevision;
        const auto atomicError = capturedWorkspaceError([&]
        {
            static_cast<void>(service.apply(
                L"chat-atomic",
                L"run-atomic",
                L"operation-atomic",
                {firstPatch, staleSecondPatch}));
        });
        EXPECT_EQ(atomicError.code(), "stale-version");
        EXPECT_EQ(readTextFile(first), "first=old\n");
        EXPECT_EQ(readTextFile(second), "second=old\n");
        EXPECT_FALSE(std::filesystem::exists(
            project / L"mods" / L"Fluxora AI Overrides" / L"first.txt"));

        const auto middleCommitError = capturedWorkspaceError([&]
        {
            static_cast<void>(service.apply(
                L"chat-atomic",
                L"run-middle-commit",
                L"operation-middle-commit",
                {
                    BuildFileMutation::create(
                        firstPage.entries.front().parentRef,
                        L"same-target.txt",
                        L"first staged value\n",
                        BuildFileMutationFormat::PlainText),
                    BuildFileMutation::create(
                        secondPage.entries.front().parentRef,
                        L"same-target.txt",
                        L"second staged value\n",
                        BuildFileMutationFormat::PlainText)
                }));
        });
        EXPECT_EQ(middleCommitError.code(), "stale-version");
        EXPECT_FALSE(std::filesystem::exists(
            project / L"mods" / L"First Mod" / L"same-target.txt"));
        EXPECT_FALSE(std::filesystem::exists(
            project / L"mods" / L"Second Mod" / L"same-target.txt"));
        EXPECT_FALSE(std::filesystem::exists(
            project / L"mods" / L"Fluxora AI Overrides" / L"same-target.txt"));

        std::vector<BuildFileMutation> tooMany;
        for (int index = 0; index < 17; ++index)
        {
            tooMany.push_back(BuildFileMutation::create(
                firstPage.entries.front().parentRef,
                L"created-" + std::to_wstring(index) + L".txt",
                L"value\n",
                BuildFileMutationFormat::PlainText));
        }
        const auto limitError = capturedWorkspaceError([&]
        {
            static_cast<void>(service.apply(
                L"chat-atomic", L"run-limit", L"operation-limit", tooMany));
        });
        EXPECT_EQ(limitError.code(), "too-large");

        for (const auto scopeAndName : {
            std::pair{BuildFileScope::Game, std::wstring(L"game.ini")},
            std::pair{BuildFileScope::Downloads, std::wstring(L"download.txt")}})
        {
            const auto page = service.search(
                L"chat-atomic",
                BuildFileSearchRequest{scopeAndName.first, scopeAndName.second, 20, L""});
            if (page.entries.empty())
            {
                continue;
            }
            ASSERT_EQ(page.entries.size(), 1u);
            const auto read = service.readText(
                L"chat-atomic",
                BuildFileTextReadRequest{page.entries.front().fileRef, 1, 120, 8192});
            auto patch = BuildFileMutation::patch(
                page.entries.front().fileRef,
                read.sha256,
                L"old",
                L"new",
                BuildFileMutationFormat::PlainText);
            patch.revision = page.entries.front().indexRevision;
            const auto protectedError = capturedWorkspaceError([&]
            {
                static_cast<void>(service.apply(
                    L"chat-atomic",
                    L"run-protected-" + scopeAndName.second,
                    L"operation-protected",
                    {patch}));
            });
            EXPECT_EQ(protectedError.code(), "protected");
        }
        EXPECT_EQ(readTextFile(gameConfig), "game=old\n");
        EXPECT_EQ(readTextFile(downloadText), "download=old\n");
    }
#endif
}
