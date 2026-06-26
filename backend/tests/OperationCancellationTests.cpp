#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/BulkFileCopyService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModOrganizerImportService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <stdexcept>

namespace fluxora::tests
{
    namespace
    {
        void writeBinaryFile(const std::filesystem::path& path, std::size_t bytes)
        {
            std::filesystem::create_directories(path.parent_path());
            std::ofstream file(path, std::ios::out | std::ios::trunc | std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to write test binary file.");
            }

            const std::string chunk(1024 * 1024, 'x');
            std::size_t remaining = bytes;
            while (remaining > 0)
            {
                const std::size_t next = (std::min)(remaining, chunk.size());
                file.write(chunk.data(), static_cast<std::streamsize>(next));
                remaining -= next;
            }
        }
    }

    TEST(OperationCancellationTests, BulkCopyStopsDuringActiveCancellableFileCopy)
    {
        TempDirectory temp;
        const std::filesystem::path source = temp.path() / L"source";
        const std::filesystem::path destination = temp.path() / L"destination";
        constexpr std::size_t fileBytes = 8ull * 1024ull * 1024ull;

        writeBinaryFile(source / L"large.bin", fileBytes);
        writeBinaryFile(source / L"later.bin", 1024);

        Logger logger;
        BulkFileCopyService copy(logger);

        EXPECT_THROW(
            (void)copy.copy(
                std::vector<BulkFileCopyRoot>{
                    BulkFileCopyRoot{
                        source,
                        destination,
                        L"Copy test files",
                        [](const std::filesystem::path&) { return false; }
                    }
                },
                BulkFileCopyOptions{
                    fileBytes + 1024,
                    1,
                    {},
                    {},
                    [destination]()
                    {
                        const std::filesystem::path activeCopy = destination / L"large.bin";
                        std::error_code error;
                        return std::filesystem::exists(activeCopy, error) &&
                            !error &&
                            std::filesystem::file_size(activeCopy, error) > 0 &&
                            !error;
                    }
                }),
            std::runtime_error);

        EXPECT_FALSE(std::filesystem::exists(destination / L"later.bin"));
    }

    TEST(OperationCancellationTests, ModOrganizerImportStopsWhenOperationMarkerExists)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable userProfile(L"USERPROFILE", (temp.path() / L"User").wstring());
        ScopedEnvironmentVariable cancelDir(
            L"FLUXORA_OPERATION_CANCEL_DIR",
            (temp.path() / L"operation-cancel").wstring());

        const std::filesystem::path source = temp.path() / L"MO2";
        const std::filesystem::path destinationRoot = temp.path() / L"Imported";
        const std::filesystem::path markerDirectory = temp.path() / L"operation-cancel";
        const std::filesystem::path marker = markerDirectory / L"op_marker_cancel.cancel";

        writeTextFile(source / L"GameRoot" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(source / L"GameRoot" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(source / L"mods" / L"SkyUI" / L"interface" / L"skyui.swf", "ui");
        writeTextFile(
            source / L"mods" / L"SkyUI" / L"meta.ini",
            "[General]\nname=SkyUI\nversion=1\nmodid=3863\nfileid=123\n");
        writeTextFile(source / L"profiles" / L"Default" / L"modlist.txt", "+SkyUI\n");
        writeTextFile(source / L"profiles" / L"Default" / L"plugins.txt", "*Skyrim.esm\n");
        writeTextFile(
            source / L"ModOrganizer.ini",
            "[General]\n"
            "gameName=Skyrim Special Edition\n"
            "gamePath=GameRoot\n"
            "selected_profile=Default\n");
        writeTextFile(marker, "1\n");

        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        BuildPathSettingsService pathSettings(logger);
        ModOrganizerImportService importer(logger, templates, projects, pathSettings);

        Logger::setOperationId(L"op_marker_cancel");
        ModOrganizerImportRequest request;
        request.sourceDirectory = source;
        request.destinationRootDirectory = destinationRoot;
        request.mode = ModOrganizerImportMode::CreateNew;

        EXPECT_THROW((void)importer.importInstance(request), std::runtime_error);
        Logger::clearOperationId();

        EXPECT_FALSE(std::filesystem::exists(destinationRoot));
    }
}
