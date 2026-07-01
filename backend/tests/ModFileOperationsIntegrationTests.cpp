#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <atomic>
#include <array>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
namespace fluxora::test_hooks
{
    void setInstallStagingCacheProducerHook(
        std::function<void(std::wstring_view, std::wstring_view, const std::filesystem::path&)> hook);
}
#endif

namespace fluxora::tests
{
    namespace
    {
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        class InstallStagingCacheProducerHookGuard
        {
        public:
            explicit InstallStagingCacheProducerHookGuard(
                std::function<void(std::wstring_view, std::wstring_view, const std::filesystem::path&)> hook)
            {
                test_hooks::setInstallStagingCacheProducerHook(std::move(hook));
            }

            InstallStagingCacheProducerHookGuard(const InstallStagingCacheProducerHookGuard&) = delete;
            InstallStagingCacheProducerHookGuard& operator=(const InstallStagingCacheProducerHookGuard&) = delete;

            ~InstallStagingCacheProducerHookGuard()
            {
                test_hooks::setInstallStagingCacheProducerHook({});
            }
        };
#endif

        struct ZipEntry
        {
            std::wstring path;
            std::string content;
        };

        struct CentralDirectoryEntry
        {
            std::string name;
            std::uint32_t crc{0};
            std::uint32_t size{0};
            std::uint32_t localHeaderOffset{0};
        };

        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size,
                nullptr,
                nullptr);
            return out;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::uint32_t crc32(const std::string& content)
        {
            std::uint32_t crc = 0xFFFFFFFFU;
            for (unsigned char byte : content)
            {
                crc ^= byte;
                for (int bit = 0; bit < 8; ++bit)
                {
                    crc = (crc >> 1) ^ (0xEDB88320U & (0U - (crc & 1U)));
                }
            }

            return ~crc;
        }

        void writeU16(std::ofstream& file, std::uint16_t value)
        {
            const std::array<unsigned char, 2> bytes{
                static_cast<unsigned char>(value & 0xFFU),
                static_cast<unsigned char>((value >> 8) & 0xFFU)
            };
            file.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        }

        void writeU32(std::ofstream& file, std::uint32_t value)
        {
            const std::array<unsigned char, 4> bytes{
                static_cast<unsigned char>(value & 0xFFU),
                static_cast<unsigned char>((value >> 8) & 0xFFU),
                static_cast<unsigned char>((value >> 16) & 0xFFU),
                static_cast<unsigned char>((value >> 24) & 0xFFU)
            };
            file.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        }

        std::uint32_t tellU32(std::ofstream& file)
        {
            return static_cast<std::uint32_t>(file.tellp());
        }

        void writeZipArchive(const std::filesystem::path& path, const std::vector<ZipEntry>& entries)
        {
            std::filesystem::create_directories(path.parent_path());

            std::ofstream file(path, std::ios::out | std::ios::binary | std::ios::trunc);
            if (!file)
            {
                throw std::runtime_error("Failed to create test archive.");
            }

            std::vector<CentralDirectoryEntry> centralDirectory;
            centralDirectory.reserve(entries.size());

            for (ZipEntry entry : entries)
            {
                std::replace(entry.path.begin(), entry.path.end(), L'\\', L'/');
                const std::string name = toUtf8(entry.path);
                const std::uint32_t crc = crc32(entry.content);
                const std::uint32_t size = static_cast<std::uint32_t>(entry.content.size());
                const std::uint32_t localHeaderOffset = tellU32(file);

                writeU32(file, 0x04034B50U);
                writeU16(file, 20);
                writeU16(file, 0x0800);
                writeU16(file, 0);
                writeU16(file, 0);
                writeU16(file, 0);
                writeU32(file, crc);
                writeU32(file, size);
                writeU32(file, size);
                writeU16(file, static_cast<std::uint16_t>(name.size()));
                writeU16(file, 0);
                file.write(name.data(), static_cast<std::streamsize>(name.size()));
                file.write(entry.content.data(), static_cast<std::streamsize>(entry.content.size()));

                centralDirectory.push_back(CentralDirectoryEntry{name, crc, size, localHeaderOffset});
            }

            const std::uint32_t centralDirectoryOffset = tellU32(file);
            for (const CentralDirectoryEntry& entry : centralDirectory)
            {
                writeU32(file, 0x02014B50U);
                writeU16(file, 20);
                writeU16(file, 20);
                writeU16(file, 0x0800);
                writeU16(file, 0);
                writeU16(file, 0);
                writeU16(file, 0);
                writeU32(file, entry.crc);
                writeU32(file, entry.size);
                writeU32(file, entry.size);
                writeU16(file, static_cast<std::uint16_t>(entry.name.size()));
                writeU16(file, 0);
                writeU16(file, 0);
                writeU16(file, 0);
                writeU16(file, 0);
                writeU32(file, 0);
                writeU32(file, entry.localHeaderOffset);
                file.write(entry.name.data(), static_cast<std::streamsize>(entry.name.size()));
            }

            const std::uint32_t centralDirectorySize = tellU32(file) - centralDirectoryOffset;
            writeU32(file, 0x06054B50U);
            writeU16(file, 0);
            writeU16(file, 0);
            writeU16(file, static_cast<std::uint16_t>(centralDirectory.size()));
            writeU16(file, static_cast<std::uint16_t>(centralDirectory.size()));
            writeU32(file, centralDirectorySize);
            writeU32(file, centralDirectoryOffset);
            writeU16(file, 0);
        }

        bool isMissingExtractorError(const std::string& message)
        {
            return message.find("Failed to extract archive") != std::string::npos;
        }

        const ModFileSummaryRecord* findSummary(
            const std::vector<ModFileSummaryRecord>& summaries,
            std::wstring_view folderName)
        {
            const auto found = std::find_if(
                summaries.begin(),
                summaries.end(),
                [folderName](const ModFileSummaryRecord& summary)
                {
                    return summary.folderName == folderName;
                });
            return found == summaries.end() ? nullptr : &*found;
        }

        const InstalledModRecord* findInstalledMod(
            const std::vector<InstalledModRecord>& mods,
            std::wstring_view folderName)
        {
            const auto found = std::find_if(
                mods.begin(),
                mods.end(),
                [folderName](const InstalledModRecord& mod)
                {
                    return mod.folderName == folderName;
                });
            return found == mods.end() ? nullptr : &*found;
        }

        const ProfileModOrderItem* findModOrderItem(
            const std::vector<ProfileModOrderItem>& mods,
            std::wstring_view name)
        {
            const auto found = std::find_if(
                mods.begin(),
                mods.end(),
                [name](const ProfileModOrderItem& mod)
                {
                    return mod.name == name;
            });
            return found == mods.end() ? nullptr : &*found;
        }

        std::vector<std::filesystem::path> installStagingCachePayloads(
            const std::filesystem::path& downloadsDirectory,
            std::wstring_view entryPrefix)
        {
            const std::filesystem::path cacheRoot = downloadsDirectory / L".install-staging-cache";
            std::vector<std::filesystem::path> payloads;
            std::error_code iterateError;
            for (const auto& entry : std::filesystem::directory_iterator(cacheRoot, iterateError))
            {
                if (iterateError)
                {
                    break;
                }

                std::error_code typeError;
                if (!entry.is_directory(typeError) ||
                    !entry.path().filename().wstring().starts_with(entryPrefix))
                {
                    continue;
                }

                const std::filesystem::path payload = entry.path() / L"payload";
                std::error_code payloadError;
                if (std::filesystem::is_directory(payload, payloadError))
                {
                    payloads.push_back(payload);
                }
            }

            std::sort(payloads.begin(), payloads.end());
            return payloads;
        }
    }

    class ModFileOperationsIntegrationTests : public testing::Test
    {
    protected:
        ModFileOperationsIntegrationTests()
            : appData_(L"APPDATA", (temp_.path() / L"AppData").wstring()),
              project_(temp_.path() / L"Тестовая сборка Ä Skyrim"),
              settings_(logger_),
              pathSettings_(logger_),
              downloads_(logger_, settings_, pathSettings_),
              mods_(logger_, settings_, pathSettings_),
              profileOrder_(logger_, mods_, pathSettings_)
        {
        }

        void SetUp() override
        {
#ifndef _WIN32
            GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
            std::filesystem::create_directories(project_ / L"stock game" / L"Data");
            InstanceMetadataStore::ensureInstance(project_, L"skyrimse");
#endif
        }

        std::filesystem::path modsDirectory() const
        {
            return pathSettings_.modsDirectory(project_);
        }

        std::filesystem::path downloadsDirectory() const
        {
            return pathSettings_.downloadsDirectory(project_);
        }

        std::filesystem::path overwriteDirectory() const
        {
            return pathSettings_.overwriteDirectory(project_);
        }

        DownloadEntry importArchive(
            std::wstring_view archiveName,
            const std::vector<ZipEntry>& entries)
        {
            const std::filesystem::path archivePath =
                temp_.path() / L"Локальные архивы Ä" / std::filesystem::path(std::wstring(archiveName));
            writeZipArchive(archivePath, entries);
            return downloads_.importLocalFile(project_, archivePath);
        }

        std::optional<InstalledMod> tryInstallArchive(
            std::wstring_view archiveName,
            const std::vector<ZipEntry>& entries,
            std::wstring_view modName,
            std::string& error,
            ExistingModInstallMode existingModMode = ExistingModInstallMode::FailIfExists)
        {
            const DownloadEntry download = importArchive(archiveName, entries);
            try
            {
                return downloads_.installDownload(project_, download.localPath, modName, existingModMode);
            }
            catch (const std::exception& exception)
            {
                error = exception.what();
                return std::nullopt;
            }
        }

        std::optional<InstalledMod> tryInstallFomodArchive(
            std::wstring_view archiveName,
            const std::vector<ZipEntry>& entries,
            std::wstring_view modName,
            std::string& error,
            const std::vector<std::wstring>& selectedOptionIds = {})
        {
            const DownloadEntry download = importArchive(archiveName, entries);
            try
            {
                return downloads_.installFomodDownload(
                    project_,
                    download.localPath,
                    modName,
                    ExistingModInstallMode::FailIfExists,
                    selectedOptionIds);
            }
            catch (const std::exception& exception)
            {
                error = exception.what();
                return std::nullopt;
            }
        }

        TempDirectory temp_;
        Logger logger_;
        ScopedEnvironmentVariable appData_;
        std::filesystem::path project_;
        AppSettingsService settings_;
        BuildPathSettingsService pathSettings_;
        DownloadService downloads_;
        ModService mods_;
        ProfileOrderService profileOrder_;
    };

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadFromArchiveCreatesSkyrimFilesAndManifest)
    {
        std::string error;
        const std::optional<InstalledMod> installed = tryInstallArchive(
            L"Unofficial Patch 1.2.3.zip",
            {
                {L"Unofficial Patch.esp", "plugin"},
                {L"meshes/actors/character/facegen.nif", "mesh"},
                {L"textures/armor/iron.dds", "texture"},
                {L"fomod/info.xml", "<fomod><Name>Unofficial Patch</Name><Version>1.2.3</Version></fomod>"}
            },
            L"Unofficial Patch",
            error);

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;
        EXPECT_EQ(installed->name, L"Unofficial Patch");
        EXPECT_EQ(installed->version, L"1.2.3");
        EXPECT_TRUE(installed->isEnabled);

        const std::filesystem::path modPath = modsDirectory() / L"Unofficial Patch";
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"Unofficial Patch.esp"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"meshes" / L"actors" / L"character" / L"facegen.nif"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"textures" / L"armor" / L"iron.dds"));

        const std::filesystem::path manifest = modPath / L".flow" / L"manifest.json";
        ASSERT_TRUE(std::filesystem::is_regular_file(manifest));
        const std::string manifestJson = readTextFile(manifest);
        EXPECT_NE(manifestJson.find("Unofficial Patch"), std::string::npos);
        EXPECT_NE(manifestJson.find("1.2.3"), std::string::npos);

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        const InstalledModRecord* record = findInstalledMod(records, L"Unofficial Patch");
        ASSERT_NE(record, nullptr);
        EXPECT_EQ(record->displayName, L"Unofficial Patch");
        EXPECT_EQ(record->version, L"1.2.3");
        EXPECT_EQ(record->state, L"installed");

        const ModFileSummary summary =
            InstanceMetadataStore::summarizeModFiles(project_, modPath, modsDirectory());
        EXPECT_EQ(summary.fileCount, 4);
        EXPECT_EQ(summary.conflictingFileCount, 0);
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallArchiveFromExternalFileDoesNotImportDownloadMetadata)
    {
        const std::filesystem::path archivePath =
            temp_.path() / L"Внешние архивы" / L"Manual Texture 1.0.zip";
        writeZipArchive(
            archivePath,
            {
                {L"textures/manual.dds", "texture"},
                {L"fomod/info.xml", "<fomod><Name>Manual Texture</Name><Version>1.0</Version></fomod>"}
            });

        InstalledMod installed;
        try
        {
            installed = downloads_.installArchive(project_, archivePath, L"Manual Texture");
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        EXPECT_EQ(installed.name, L"Manual Texture");
        EXPECT_EQ(installed.version, L"1.0");
        EXPECT_TRUE(std::filesystem::is_regular_file(modsDirectory() / L"Manual Texture" / L"textures" / L"manual.dds"));
        EXPECT_TRUE(downloads_.listDownloads(project_).empty());
        EXPECT_FALSE(std::filesystem::exists(std::filesystem::path(archivePath.wstring() + L".fluxora.json")));

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        const InstalledModRecord* record = findInstalledMod(records, L"Manual Texture");
        ASSERT_NE(record, nullptr);
        EXPECT_EQ(record->source.provider, L"manual");
        EXPECT_EQ(record->source.url, archivePath.wstring());
    }

    TEST_F(ModFileOperationsIntegrationTests, CreateEmptyModCreatesFolderManifestAndAppendsProfileOrder)
    {
        const std::vector<ProfileModOrderItem> withSeparator =
            profileOrder_.createModSeparator(project_, L"Default", L"Outputs", 0);
        ASSERT_EQ(withSeparator.size(), 1U);
        ASSERT_EQ(withSeparator.front().kind, L"separator");

        const InstalledModEntry created = mods_.createEmptyMod(project_, L"Nemesis Output");

        EXPECT_EQ(created.name, L"Nemesis Output");
        const std::filesystem::path modPath = modsDirectory() / L"Nemesis Output";
        EXPECT_TRUE(std::filesystem::is_directory(modPath));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L".flow" / L"manifest.json"));

        const std::vector<ProfileModOrderItem> order =
            profileOrder_.listModOrder(project_, L"Default");
        ASSERT_EQ(order.size(), 2U);
        EXPECT_EQ(order[0].kind, L"separator");
        EXPECT_EQ(order[0].separatorTitle, L"Outputs");
        EXPECT_EQ(order[1].kind, L"mod");
        EXPECT_EQ(order[1].name, L"Nemesis Output");
    }

    TEST_F(ModFileOperationsIntegrationTests, ModTextFileEditorReadsAndSavesContainedUtf8Files)
    {
        const InstalledModEntry created = mods_.createEmptyMod(project_, L"Config Patch");
        const std::filesystem::path modPath = created.id;
        writeTextFile(modPath / L"config" / L"settings.json", "{\"enabled\":true}\n");

        const ModTextFileDocument document =
            mods_.readModTextFile(project_, modPath, L"config/settings.json");

        EXPECT_EQ(document.fileName, L"settings.json");
        EXPECT_EQ(document.relativePath, L"config/settings.json");
        EXPECT_NE(document.content.find(L"enabled"), std::wstring::npos);

        const ModTextFileSaveResult saved =
            mods_.saveModTextFile(project_, modPath, L"config/settings.json", L"{\"enabled\":false}\n");

        EXPECT_EQ(saved.fileName, L"settings.json");
        EXPECT_EQ(saved.relativePath, L"config/settings.json");
        EXPECT_EQ(readTextFile(modPath / L"config" / L"settings.json"), "{\"enabled\":false}\n");
    }

    TEST_F(ModFileOperationsIntegrationTests, ModTextFileEditorRejectsTraversalOutsideMod)
    {
        const InstalledModEntry created = mods_.createEmptyMod(project_, L"Config Patch");
        const std::filesystem::path modPath = created.id;
        writeTextFile(modPath / L"config" / L"settings.json", "{}\n");

        EXPECT_THROW(
            (void)mods_.readModTextFile(project_, modPath, L"../Other Mod/settings.json"),
            std::invalid_argument);
        EXPECT_THROW(
            (void)mods_.saveModTextFile(project_, modPath, L"../Other Mod/settings.json", L"{}\n"),
            std::invalid_argument);
        EXPECT_EQ(readTextFile(modPath / L"config" / L"settings.json"), "{}\n");
    }

    TEST_F(ModFileOperationsIntegrationTests, ClearOverwriteFolderDeletesGeneratedFilesAndKeepsFolder)
    {
        const std::filesystem::path overwrite = overwriteDirectory();
        writeTextFile(overwrite / L"meshes" / L"generated.nif", "generated mesh");
        writeTextFile(overwrite / L"Nemesis_Engine" / L"cache.txt", "cache");
        writeTextFile(modsDirectory() / L"Keep Mod" / L"data.txt", "keep");

        mods_.clearOverwriteFolder(project_);

        EXPECT_TRUE(std::filesystem::is_directory(overwrite));
        EXPECT_FALSE(std::filesystem::exists(overwrite / L"meshes"));
        EXPECT_FALSE(std::filesystem::exists(overwrite / L"Nemesis_Engine"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modsDirectory() / L"Keep Mod" / L"data.txt"));
    }

    TEST_F(ModFileOperationsIntegrationTests, ClearOverwriteFolderRejectsProjectRootOverride)
    {
        writeTextFile(
            project_ / L".fluxora" / L"paths.json",
            "{\"overwriteDirectory\":\".\"}");

        EXPECT_THROW(
            mods_.clearOverwriteFolder(project_),
            std::invalid_argument);
    }

    TEST_F(ModFileOperationsIntegrationTests, MoveModSeparatorDoesNotMoveContainedMods)
    {
        (void)profileOrder_.createModSeparator(project_, L"Default", L"Visuals", 0);
        (void)mods_.createEmptyMod(project_, L"SkyUI");
        (void)mods_.createEmptyMod(project_, L"SmoothCam");
        (void)profileOrder_.createModSeparator(project_, L"Default", L"Audio", 3);
        (void)mods_.createEmptyMod(project_, L"Music HQ");

        const std::vector<ProfileModOrderItem> initial =
            profileOrder_.listModOrder(project_, L"Default");
        ASSERT_EQ(initial.size(), 5U);
        ASSERT_EQ(initial[0].kind, L"separator");
        const std::wstring visualsSeparatorId = initial[0].orderId;

        const std::vector<ProfileModOrderItem> moved =
            profileOrder_.moveModOrderItem(project_, L"Default", visualsSeparatorId, 4);

        ASSERT_EQ(moved.size(), 5U);
        EXPECT_EQ(moved[0].kind, L"mod");
        EXPECT_EQ(moved[0].name, L"SkyUI");
        EXPECT_EQ(moved[1].kind, L"mod");
        EXPECT_EQ(moved[1].name, L"SmoothCam");
        EXPECT_EQ(moved[2].kind, L"separator");
        EXPECT_EQ(moved[2].separatorTitle, L"Audio");
        EXPECT_EQ(moved[3].kind, L"mod");
        EXPECT_EQ(moved[3].name, L"Music HQ");
        EXPECT_EQ(moved[4].kind, L"separator");
        EXPECT_EQ(moved[4].separatorTitle, L"Visuals");
    }

    TEST_F(ModFileOperationsIntegrationTests, ImportLocalSkyrimBsaUsesGameDefinitionArchiveRules)
    {
        const std::filesystem::path archivePath =
            temp_.path() / L"Локальные архивы Ä" / L"Skyrim - Textures.bsa";
        writeTextFile(archivePath, "bsa");

        const DownloadEntry imported = downloads_.importLocalFile(project_, archivePath);

        EXPECT_EQ(imported.fileName, L"Skyrim - Textures.bsa");
        EXPECT_TRUE(std::filesystem::is_regular_file(imported.localPath));
    }

    TEST_F(ModFileOperationsIntegrationTests, AnalyzeDownloadContentLayoutReturnsExplainablePlanWithoutInstalling)
    {
        const std::filesystem::path archivePath =
            temp_.path() / L"Локальные архивы Ä" / L"Skyrim - Textures.bsa";
        writeTextFile(archivePath, "bsa");
        const DownloadEntry imported = downloads_.importLocalFile(project_, archivePath);

        const PlacementPlan plan = downloads_.analyzeDownloadContentLayout(
            project_,
            imported.localPath,
            ExistingModInstallMode::FailIfExists);

        ASSERT_TRUE(plan.canInstall());
        ASSERT_EQ(plan.entries.size(), 1U);
        EXPECT_EQ(plan.entries[0].sourcePath.path().generic_wstring(), L"Skyrim - Textures.bsa");
        EXPECT_EQ(plan.entries[0].classification, ContentLayoutClassification::Archive);
        EXPECT_EQ(plan.entries[0].target, PlacementTarget::Data);
        EXPECT_FALSE(plan.entries[0].explanation.empty());
        EXPECT_FALSE(std::filesystem::exists(modsDirectory() / L"Skyrim - Textures"));
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadNormalizesSkyrimArchiveWithDataFolder)
    {
        std::string error;
        const std::optional<InstalledMod> installed = tryInstallArchive(
            L"SkyUI Data Wrapper.zip",
            {
                {L"Data/SkyUI_SE.esp", "plugin"},
                {L"Data/SkyUI_SE.bsa", "archive"},
                {L"Data/SKSE/Plugins/skyui_plugin.dll", "dll"},
                {L"Data/meshes/interface/widget.nif", "mesh"},
                {L"skse64_loader.exe", "loader"}
            },
            L"SkyUI Data Wrapper",
            error);

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;

        const std::filesystem::path modPath = modsDirectory() / L"SkyUI Data Wrapper";
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"SkyUI_SE.esp"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"SkyUI_SE.bsa"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"SKSE" / L"Plugins" / L"skyui_plugin.dll"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"meshes" / L"interface" / L"widget.nif"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"root" / L"skse64_loader.exe"));
        EXPECT_FALSE(std::filesystem::exists(modPath / L"Data" / L"SkyUI_SE.esp"));
        EXPECT_FALSE(std::filesystem::exists(modPath / L"skse64_loader.exe"));
    }

    TEST_F(ModFileOperationsIntegrationTests, AnalyzeDownloadContentLayoutCachesExtractedPayloadForInstall)
    {
        const DownloadEntry download = importArchive(
            L"Cached Layout.zip",
            {
                {L"Data/SkyUI_SE.esp", "original-plugin"},
                {L"Data/SkyUI_SE.bsa", "archive"}
            });

        PlacementPlan plan;
        try
        {
            plan = downloads_.analyzeDownloadContentLayout(
                project_,
                download.localPath,
                ExistingModInstallMode::FailIfExists);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        ASSERT_TRUE(plan.canInstall());
        const std::vector<std::filesystem::path> payloads =
            installStagingCachePayloads(downloadsDirectory(), L"archive-staging-");
        ASSERT_EQ(payloads.size(), 1U);
        const std::filesystem::path cachedPlugin = payloads.front() / L"Data" / L"SkyUI_SE.esp";
        ASSERT_TRUE(std::filesystem::is_regular_file(cachedPlugin));
        writeTextFile(cachedPlugin, "cache-hit-plugin");

        std::optional<InstalledMod> installed;
        std::string installError;
        try
        {
            installed = downloads_.installDownload(
                project_,
                download.localPath,
                L"Cached Layout",
                ExistingModInstallMode::FailIfExists);
        }
        catch (const std::exception& exception)
        {
            installError = exception.what();
        }

        ASSERT_TRUE(installed.has_value()) << installError;
        EXPECT_EQ(readTextFile(modsDirectory() / L"Cached Layout" / L"SkyUI_SE.esp"), "cache-hit-plugin");
    }

    TEST_F(ModFileOperationsIntegrationTests, AnalyzeDownloadContentLayoutCleansStaleBuildingCacheEntry)
    {
        const std::filesystem::path staleBuilding =
            downloadsDirectory() / L".install-staging-cache" / L".building-archive-staging-crash";
        writeTextFile(staleBuilding / L"payload" / L"partial.txt", "partial");
        std::filesystem::last_write_time(
            staleBuilding,
            std::filesystem::file_time_type::clock::now() - std::chrono::hours(25));

        const DownloadEntry download = importArchive(
            L"Cleanup Stale Building.zip",
            {
                {L"Data/Cleanup.esp", "plugin"}
            });

        PlacementPlan plan;
        try
        {
            plan = downloads_.analyzeDownloadContentLayout(
                project_,
                download.localPath,
                ExistingModInstallMode::FailIfExists);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        ASSERT_TRUE(plan.canInstall());
        EXPECT_FALSE(std::filesystem::exists(staleBuilding));
        EXPECT_EQ(installStagingCachePayloads(downloadsDirectory(), L"archive-staging-").size(), 1U);
    }

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
    TEST_F(ModFileOperationsIntegrationTests, AnalyzeDownloadContentLayoutAllowsDifferentArchivesToBuildInParallel)
    {
        const DownloadEntry first = importArchive(
            L"Parallel First.zip",
            {
                {L"Data/First.esp", "first"}
            });
        const DownloadEntry second = importArchive(
            L"Parallel Second.zip",
            {
                {L"Data/Second.esp", "second"}
            });

        std::promise<void> firstProducerStartedPromise;
        std::future<void> firstProducerStarted = firstProducerStartedPromise.get_future();
        std::promise<void> releaseFirstProducerPromise;
        std::shared_future<void> releaseFirstProducer = releaseFirstProducerPromise.get_future().share();
        std::atomic_bool firstProducerPaused{false};
        std::atomic_bool firstProducerReleased{false};
        auto releaseFirst = [&]()
        {
            if (!firstProducerReleased.exchange(true))
            {
                releaseFirstProducerPromise.set_value();
            }
        };

        InstallStagingCacheProducerHookGuard hook{
            [&](std::wstring_view kind, std::wstring_view, const std::filesystem::path&)
            {
                if (kind == L"archive-staging" && !firstProducerPaused.exchange(true))
                {
                    firstProducerStartedPromise.set_value();
                    releaseFirstProducer.wait();
                }
            }};

        auto firstAnalyze = std::async(std::launch::async, [&]()
        {
            return downloads_.analyzeDownloadContentLayout(
                project_,
                first.localPath,
                ExistingModInstallMode::FailIfExists);
        });

        ASSERT_EQ(firstProducerStarted.wait_for(std::chrono::seconds(5)), std::future_status::ready);

        auto secondAnalyze = std::async(std::launch::async, [&]()
        {
            return downloads_.analyzeDownloadContentLayout(
                project_,
                second.localPath,
                ExistingModInstallMode::FailIfExists);
        });

        if (secondAnalyze.wait_for(std::chrono::seconds(5)) != std::future_status::ready)
        {
            releaseFirst();
            FAIL() << "Second archive analysis waited for another archive cache build.";
        }

        try
        {
            const PlacementPlan secondPlan = secondAnalyze.get();
            EXPECT_TRUE(secondPlan.canInstall());
        }
        catch (const std::exception& exception)
        {
            releaseFirst();
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        releaseFirst();
        try
        {
            const PlacementPlan firstPlan = firstAnalyze.get();
            EXPECT_TRUE(firstPlan.canInstall());
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        EXPECT_EQ(installStagingCachePayloads(downloadsDirectory(), L"archive-staging-").size(), 2U);
    }
#endif

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadAppliesManualPlacementOverrides)
    {
        const DownloadEntry download = importArchive(
            L"Manual Placement.zip",
            {
                {L"Data/SkyUI_SE.esp", "plugin"}
            });

        std::optional<InstalledMod> installed;
        std::string error;
        try
        {
            installed = downloads_.installDownload(
                project_,
                download.localPath,
                L"Manual Placement",
                ExistingModInstallMode::FailIfExists,
                {
                    PlacementOverride{
                        GameRelativePath::parseOrThrow(L"Data/SkyUI_SE.esp"),
                        PlacementTarget::GameRoot
                    }
                });
        }
        catch (const std::exception& exception)
        {
            error = exception.what();
        }

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;
        const std::filesystem::path modPath = modsDirectory() / L"Manual Placement";
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"root" / L"SkyUI_SE.esp"));
        EXPECT_FALSE(std::filesystem::exists(modPath / L"SkyUI_SE.esp"));
        EXPECT_FALSE(std::filesystem::exists(modPath / L"Data" / L"SkyUI_SE.esp"));
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadNormalizesSkyrimArchiveWithoutDataFolder)
    {
        std::string error;
        const std::optional<InstalledMod> installed = tryInstallArchive(
            L"SkyUI Loose Data.zip",
            {
                {L"SkyUI_SE.esp", "plugin"},
                {L"SkyUI_SE.bsa", "archive"},
                {L"SKSE/Plugins/skyui_plugin.dll", "dll"},
                {L"meshes/interface/widget.nif", "mesh"}
            },
            L"SkyUI Loose Data",
            error);

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;

        const std::filesystem::path modPath = modsDirectory() / L"SkyUI Loose Data";
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"SkyUI_SE.esp"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"SkyUI_SE.bsa"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"SKSE" / L"Plugins" / L"skyui_plugin.dll"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"meshes" / L"interface" / L"widget.nif"));
        EXPECT_FALSE(std::filesystem::exists(modPath / L"Data" / L"SkyUI_SE.esp"));
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadRejectsExistingModByDefaultWithoutChangingFiles)
    {
        std::string firstError;
        const std::optional<InstalledMod> first = tryInstallArchive(
            L"Same Mod 1.0.zip",
            {
                {L"textures/shared.dds", "old-shared"},
                {L"textures/old-only.dds", "old-only"},
                {L"fomod/info.xml", "<fomod><Name>Same Mod</Name><Version>1.0</Version></fomod>"}
            },
            L"Same Mod",
            firstError);
        if (!first.has_value() && isMissingExtractorError(firstError))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << firstError;
        }
        ASSERT_TRUE(first.has_value()) << firstError;

        const DownloadEntry update = importArchive(
            L"Same Mod 2.0.zip",
            {
                {L"textures/shared.dds", "new-shared"},
                {L"textures/new-only.dds", "new-only"},
                {L"fomod/info.xml", "<fomod><Name>Same Mod</Name><Version>2.0</Version></fomod>"}
            });

        EXPECT_THROW(
            (void)downloads_.installDownload(project_, update.localPath, L"Same Mod"),
            std::invalid_argument);

        const std::filesystem::path modPath = modsDirectory() / L"Same Mod";
        EXPECT_EQ(readTextFile(modPath / L"textures" / L"shared.dds"), "old-shared");
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"textures" / L"old-only.dds"));
        EXPECT_FALSE(std::filesystem::exists(modPath / L"textures" / L"new-only.dds"));
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadReplaceExistingModRemovesOldOnlyFiles)
    {
        std::string firstError;
        const std::optional<InstalledMod> first = tryInstallArchive(
            L"Replace Mod 1.0.zip",
            {
                {L"textures/shared.dds", "old-shared"},
                {L"textures/old-only.dds", "old-only"},
                {L"fomod/info.xml", "<fomod><Name>Replace Mod</Name><Version>1.0</Version></fomod>"}
            },
            L"Replace Mod",
            firstError);
        if (!first.has_value() && isMissingExtractorError(firstError))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << firstError;
        }
        ASSERT_TRUE(first.has_value()) << firstError;

        std::string replaceError;
        const std::optional<InstalledMod> replaced = tryInstallArchive(
            L"Replace Mod 2.0.zip",
            {
                {L"textures/shared.dds", "new-shared"},
                {L"textures/new-only.dds", "new-only"},
                {L"fomod/info.xml", "<fomod><Name>Replace Mod</Name><Version>2.0</Version></fomod>"}
            },
            L"Replace Mod",
            replaceError,
            ExistingModInstallMode::Replace);

        ASSERT_TRUE(replaced.has_value()) << replaceError;
        EXPECT_EQ(replaced->name, L"Replace Mod");
        EXPECT_EQ(replaced->version, L"2.0");

        const std::filesystem::path modPath = modsDirectory() / L"Replace Mod";
        EXPECT_EQ(readTextFile(modPath / L"textures" / L"shared.dds"), "new-shared");
        EXPECT_FALSE(std::filesystem::exists(modPath / L"textures" / L"old-only.dds"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"textures" / L"new-only.dds"));

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        const InstalledModRecord* record = findInstalledMod(records, L"Replace Mod");
        ASSERT_NE(record, nullptr);
        EXPECT_EQ(record->version, L"2.0");
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadMergeExistingModPreservesOldOnlyFiles)
    {
        std::string firstError;
        const std::optional<InstalledMod> first = tryInstallArchive(
            L"Merge Mod 1.0.zip",
            {
                {L"textures/shared.dds", "old-shared"},
                {L"textures/old-only.dds", "old-only"},
                {L"fomod/info.xml", "<fomod><Name>Merge Mod</Name><Version>1.0</Version></fomod>"}
            },
            L"Merge Mod",
            firstError);
        if (!first.has_value() && isMissingExtractorError(firstError))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << firstError;
        }
        ASSERT_TRUE(first.has_value()) << firstError;

        std::string mergeError;
        const std::optional<InstalledMod> merged = tryInstallArchive(
            L"Merge Mod 2.0.zip",
            {
                {L"textures/shared.dds", "new-shared"},
                {L"textures/new-only.dds", "new-only"},
                {L"fomod/info.xml", "<fomod><Name>Merge Mod</Name><Version>2.0</Version></fomod>"}
            },
            L"Merge Mod",
            mergeError,
            ExistingModInstallMode::Merge);

        ASSERT_TRUE(merged.has_value()) << mergeError;
        EXPECT_EQ(merged->name, L"Merge Mod");
        EXPECT_EQ(merged->version, L"2.0");

        const std::filesystem::path modPath = modsDirectory() / L"Merge Mod";
        EXPECT_EQ(readTextFile(modPath / L"textures" / L"shared.dds"), "new-shared");
        EXPECT_EQ(readTextFile(modPath / L"textures" / L"old-only.dds"), "old-only");
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"textures" / L"new-only.dds"));

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        const InstalledModRecord* record = findInstalledMod(records, L"Merge Mod");
        ASSERT_NE(record, nullptr);
        EXPECT_EQ(record->version, L"2.0");
    }

    TEST_F(ModFileOperationsIntegrationTests, ProfileModOrderReturnsLiveConflictSummary)
    {
        std::string error;
        const std::optional<InstalledMod> installed = tryInstallArchive(
            L"Deferred Scan.zip",
            {
                {L"Deferred Scan.esp", "plugin"},
                {L"textures/deferred.dds", "texture"}
            },
            L"Deferred Scan",
            error);

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;

        const std::vector<ProfileModOrderItem> order =
            profileOrder_.listModOrder(project_, L"Default");
        const ProfileModOrderItem* orderItem = findModOrderItem(order, L"Deferred Scan");
        ASSERT_NE(orderItem, nullptr);
        EXPECT_EQ(orderItem->fileCount, 2);
        EXPECT_EQ(orderItem->conflictStatus, L"Конфликтов нет");
    }

    TEST_F(ModFileOperationsIntegrationTests, ListModFileTreeBuildsSelectedModCacheWithoutGlobalSummary)
    {
        std::string firstError;
        const std::optional<InstalledMod> first = tryInstallArchive(
            L"Tree First.zip",
            {{L"textures/tree/first.dds", "first"}},
            L"Tree First",
            firstError);
        if (!first.has_value() && isMissingExtractorError(firstError))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << firstError;
        }
        ASSERT_TRUE(first.has_value()) << firstError;

        std::string secondError;
        const std::optional<InstalledMod> second = tryInstallArchive(
            L"Tree Second.zip",
            {{L"textures/tree/second.dds", "second"}},
            L"Tree Second",
            secondError);
        ASSERT_TRUE(second.has_value()) << secondError;

        const std::vector<ModFileTreeEntry> root =
            InstanceMetadataStore::listModFileTree(project_, first->id, L"", modsDirectory());
        EXPECT_TRUE(std::any_of(root.begin(), root.end(), [](const ModFileTreeEntry& entry)
        {
            return entry.name == L"textures" && entry.isDirectory;
        }));

        const std::vector<ModFileTreeEntry> files =
            InstanceMetadataStore::listModFileTree(project_, first->id, L"textures/tree", modsDirectory());
        ASSERT_EQ(files.size(), 1U);
        EXPECT_EQ(files[0].name, L"first.dds");
    }

    TEST_F(ModFileOperationsIntegrationTests, ImportLocalFileRejectsUnsupportedFileBeforeCopying)
    {
        const std::filesystem::path source =
            temp_.path() / L"Локальные архивы Ä" / L"notes.txt";
        writeTextFile(source, "not a mod archive");

        EXPECT_THROW(
            (void)downloads_.importLocalFile(project_, source),
            std::invalid_argument);

        EXPECT_TRUE(downloads_.listDownloads(project_).empty());
    }

    TEST_F(ModFileOperationsIntegrationTests, DeleteInstalledModRemovesOnlySelectedMod)
    {
        std::string firstError;
        const std::optional<InstalledMod> first = tryInstallArchive(
            L"First Mod.zip",
            {{L"textures/shared/first.dds", "first"}},
            L"First Mod",
            firstError);
        if (!first.has_value() && isMissingExtractorError(firstError))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << firstError;
        }
        ASSERT_TRUE(first.has_value()) << firstError;

        std::string secondError;
        const std::optional<InstalledMod> second = tryInstallArchive(
            L"Second Mod.zip",
            {{L"textures/shared/second.dds", "second"}},
            L"Second Mod",
            secondError);
        ASSERT_TRUE(second.has_value()) << secondError;

        const std::filesystem::path unrelatedFile = modsDirectory() / L"manual keep.txt";
        writeTextFile(unrelatedFile, "keep");
        const std::filesystem::path outsideProjectFile = project_ / L"outside mods keep.txt";
        writeTextFile(outsideProjectFile, "keep");

        mods_.deleteInstalledMod(project_, first->id);

        EXPECT_FALSE(std::filesystem::exists(first->id));
        EXPECT_TRUE(std::filesystem::is_regular_file(second->id / L"textures" / L"shared" / L"second.dds"));
        EXPECT_TRUE(std::filesystem::is_regular_file(unrelatedFile));
        EXPECT_TRUE(std::filesystem::is_regular_file(outsideProjectFile));

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        EXPECT_EQ(findInstalledMod(records, L"First Mod"), nullptr);
        ASSERT_NE(findInstalledMod(records, L"Second Mod"), nullptr);
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallFomodDownloadDoesNotExposePackageDirectoryAsMod)
    {
        std::string error;
        const std::optional<InstalledMod> installed = tryInstallFomodArchive(
            L"Northern Roads - Patches Compendium.fomod",
            {
                {L"fomod/ModuleConfig.xml", R"xml(<config>
  <moduleName>Northern Roads - Patches Compendium</moduleName>
  <requiredInstallFiles>
    <file source="main plugins/Northern Roads Patch.esp" destination="Northern Roads Patch.esp" />
  </requiredInstallFiles>
</config>)xml"},
                {L"fomod/info.xml", R"xml(<fomod><Name>Northern Roads - Patches Compendium</Name><Version>1.0.0</Version></fomod>)xml"},
                {L"images/preview.png", "image"},
                {L"main plugins/Northern Roads Patch.esp", "plugin"},
                {L"plugins/optional.txt", "optional"}
            },
            L"Northern Roads - Patches Compendium",
            error);

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;
        EXPECT_TRUE(std::filesystem::is_regular_file(
            modsDirectory() / L"Northern Roads - Patches Compendium" / L"Northern Roads Patch.esp"));
        EXPECT_FALSE(std::filesystem::exists(
            modsDirectory() / L"Northern Roads - Patches Compendium.fomod-package"));
        EXPECT_FALSE(std::filesystem::exists(
            modsDirectory() / L".Northern Roads - Patches Compendium.fomod-package"));

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        ASSERT_NE(findInstalledMod(records, L"Northern Roads - Patches Compendium"), nullptr);
        EXPECT_EQ(findInstalledMod(records, L"Northern Roads - Patches Compendium.fomod-package"), nullptr);
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallFomodDownloadNormalizesOutputThroughContentLayout)
    {
        std::string error;
        const std::optional<InstalledMod> installed = tryInstallFomodArchive(
            L"SkyUI FOMOD Layout.fomod",
            {
                {L"fomod/ModuleConfig.xml", R"xml(<config>
  <moduleName>SkyUI FOMOD Layout</moduleName>
  <requiredInstallFiles>
    <folder source="payload" />
  </requiredInstallFiles>
</config>)xml"},
                {L"fomod/info.xml", R"xml(<fomod><Name>SkyUI FOMOD Layout</Name><Version>1.0.0</Version></fomod>)xml"},
                {L"payload/Data/SkyUI_SE.esp", "plugin"},
                {L"payload/Data/SKSE/Plugins/skyui_plugin.dll", "dll"},
                {L"payload/skse64_loader.exe", "loader"}
            },
            L"SkyUI FOMOD Layout",
            error);

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;

        const std::filesystem::path modPath = modsDirectory() / L"SkyUI FOMOD Layout";
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"SkyUI_SE.esp"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"SKSE" / L"Plugins" / L"skyui_plugin.dll"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"root" / L"skse64_loader.exe"));
        EXPECT_FALSE(std::filesystem::exists(modPath / L"Data" / L"SkyUI_SE.esp"));
        EXPECT_FALSE(std::filesystem::exists(modPath / L"skse64_loader.exe"));
    }

    TEST_F(ModFileOperationsIntegrationTests, AnalyzeFomodContentLayoutReturnsSelectedOutputPlanWithoutInstalling)
    {
        const DownloadEntry download = importArchive(
            L"SkyUI FOMOD Preview.fomod",
            {
                {L"fomod/ModuleConfig.xml", R"xml(<config>
  <moduleName>SkyUI FOMOD Preview</moduleName>
  <requiredInstallFiles>
    <folder source="payload" />
  </requiredInstallFiles>
</config>)xml"},
                {L"fomod/info.xml", R"xml(<fomod><Name>SkyUI FOMOD Preview</Name><Version>1.0.0</Version></fomod>)xml"},
                {L"payload/Data/SkyUI_SE.esp", "plugin"},
                {L"payload/skse64_loader.exe", "loader"}
            });

        PlacementPlan plan;
        try
        {
            plan = downloads_.analyzeFomodDownloadContentLayout(
                project_,
                download.localPath,
                ExistingModInstallMode::FailIfExists,
                {});
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        ASSERT_TRUE(plan.canInstall());
        EXPECT_EQ(plan.summary.pluginEntries, 1U);
        EXPECT_EQ(plan.summary.scriptExtenderEntries, 1U);
        EXPECT_FALSE(plan.userExplanation.details.empty());
        EXPECT_FALSE(std::filesystem::exists(modsDirectory() / L"SkyUI FOMOD Preview"));
    }

    TEST_F(ModFileOperationsIntegrationTests, AnalyzeFomodDownloadCachesPackageForInstall)
    {
        const DownloadEntry download = importArchive(
            L"Cached FOMOD Package.fomod",
            {
                {L"fomod/ModuleConfig.xml", R"xml(<config>
  <moduleName>Cached FOMOD Package</moduleName>
  <requiredInstallFiles>
    <folder source="payload" />
  </requiredInstallFiles>
</config>)xml"},
                {L"fomod/info.xml", R"xml(<fomod><Name>Cached FOMOD Package</Name><Version>1.0.0</Version></fomod>)xml"},
                {L"payload/Data/SkyUI_SE.esp", "original-plugin"}
            });

        FomodInstallerDescriptor descriptor;
        try
        {
            descriptor = downloads_.analyzeFomodDownload(project_, download.localPath);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        ASSERT_TRUE(descriptor.isFomod);
        const std::vector<std::filesystem::path> payloads =
            installStagingCachePayloads(downloadsDirectory(), L"fomod-package-");
        ASSERT_EQ(payloads.size(), 1U);
        const std::filesystem::path cachedPlugin = payloads.front() / L"payload" / L"Data" / L"SkyUI_SE.esp";
        ASSERT_TRUE(std::filesystem::is_regular_file(cachedPlugin));
        writeTextFile(cachedPlugin, "cache-hit-plugin");

        std::optional<InstalledMod> installed;
        std::string installError;
        try
        {
            installed = downloads_.installFomodDownload(
                project_,
                download.localPath,
                L"Cached FOMOD Package",
                ExistingModInstallMode::FailIfExists,
                {});
        }
        catch (const std::exception& exception)
        {
            installError = exception.what();
        }

        ASSERT_TRUE(installed.has_value()) << installError;
        EXPECT_EQ(
            readTextFile(modsDirectory() / L"Cached FOMOD Package" / L"SkyUI_SE.esp"),
            "cache-hit-plugin");
    }

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
    TEST_F(ModFileOperationsIntegrationTests, OrdinaryArchiveInstallCompletesWhileFomodPackageBuildIsPaused)
    {
        std::vector<ZipEntry> fomodEntries{
            {L"fomod/ModuleConfig.xml", R"xml(<config>
  <moduleName>Slow FOMOD Package</moduleName>
  <requiredInstallFiles>
    <folder source="payload" />
  </requiredInstallFiles>
</config>)xml"},
            {L"fomod/info.xml", R"xml(<fomod><Name>Slow FOMOD Package</Name><Version>1.0.0</Version></fomod>)xml"},
            {L"payload/Data/SlowFomod.esp", "fomod-plugin"}
        };
        for (int index = 0; index < 128; ++index)
        {
            fomodEntries.push_back({
                L"payload/textures/generated/slow-" + std::to_wstring(index) + L".dds",
                "texture"
            });
        }

        const DownloadEntry fomod = importArchive(L"Slow FOMOD Package.fomod", fomodEntries);
        const DownloadEntry archive = importArchive(
            L"Plain Archive.zip",
            {
                {L"Data/PlainArchive.esp", "plain-plugin"}
            });

        std::promise<void> fomodProducerStartedPromise;
        std::future<void> fomodProducerStarted = fomodProducerStartedPromise.get_future();
        std::promise<void> releaseFomodProducerPromise;
        std::shared_future<void> releaseFomodProducer = releaseFomodProducerPromise.get_future().share();
        std::atomic_bool fomodProducerPaused{false};
        std::atomic_bool fomodProducerReleased{false};
        auto releaseFomod = [&]()
        {
            if (!fomodProducerReleased.exchange(true))
            {
                releaseFomodProducerPromise.set_value();
            }
        };

        InstallStagingCacheProducerHookGuard hook{
            [&](std::wstring_view kind, std::wstring_view, const std::filesystem::path&)
            {
                if (kind == L"fomod-package" && !fomodProducerPaused.exchange(true))
                {
                    fomodProducerStartedPromise.set_value();
                    releaseFomodProducer.wait();
                }
            }};

        auto fomodAnalyze = std::async(std::launch::async, [&]()
        {
            return downloads_.analyzeFomodDownload(project_, fomod.localPath);
        });

        ASSERT_EQ(fomodProducerStarted.wait_for(std::chrono::seconds(5)), std::future_status::ready);

        auto archiveInstall = std::async(std::launch::async, [&]()
        {
            return downloads_.installDownload(
                project_,
                archive.localPath,
                L"Plain Archive",
                ExistingModInstallMode::FailIfExists);
        });

        if (archiveInstall.wait_for(std::chrono::seconds(5)) != std::future_status::ready)
        {
            releaseFomod();
            FAIL() << "Ordinary archive install waited for a different FOMOD package cache build.";
        }

        try
        {
            const InstalledMod installed = archiveInstall.get();
            EXPECT_EQ(installed.name, L"Plain Archive");
            EXPECT_TRUE(std::filesystem::is_regular_file(
                modsDirectory() / L"Plain Archive" / L"PlainArchive.esp"));
        }
        catch (const std::exception& exception)
        {
            releaseFomod();
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        releaseFomod();
        try
        {
            const FomodInstallerDescriptor descriptor = fomodAnalyze.get();
            EXPECT_TRUE(descriptor.isFomod);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        EXPECT_EQ(installStagingCachePayloads(downloadsDirectory(), L"fomod-package-").size(), 1U);
        EXPECT_TRUE(std::filesystem::is_regular_file(
            modsDirectory() / L"Plain Archive" / L"PlainArchive.esp"));
    }
#endif

    TEST_F(ModFileOperationsIntegrationTests, ReplayedFomodChoicesCannotBypassContentSafety)
    {
        const DownloadEntry download = importArchive(
            L"Replay Safety.fomod",
            {
                {L"fomod/ModuleConfig.xml", R"xml(<config>
  <moduleName>Replay Safety</moduleName>
  <installSteps order="Explicit">
    <installStep name="Install">
      <optionalFileGroups order="Explicit">
        <group name="Choice" type="SelectExactlyOne">
          <plugins order="Explicit">
            <plugin name="Safe Plugin">
              <files>
                <file source="safe/SafePatch.esp" destination="SafePatch.esp" />
              </files>
              <typeDescriptor>
                <type name="Recommended" />
              </typeDescriptor>
            </plugin>
            <plugin name="Unsafe Helper">
              <files>
                <file source="unsafe/helper.exe" destination="helper.exe" />
              </files>
              <typeDescriptor>
                <type name="Optional" />
              </typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>)xml"},
                {L"fomod/info.xml", R"xml(<fomod><Name>Replay Safety</Name><Version>1.0.0</Version><Id>replay-safety</Id></fomod>)xml"},
                {L"safe/SafePatch.esp", "plugin"},
                {L"unsafe/helper.exe", "helper"}
            });

        FomodInstallerDescriptor descriptor;
        try
        {
            descriptor = downloads_.analyzeFomodDownload(project_, download.localPath);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        ASSERT_TRUE(descriptor.isFomod);

        std::wstring unsafeOptionId;
        for (const FomodStep& step : descriptor.steps)
        {
            for (const FomodGroup& group : step.groups)
            {
                for (const FomodOption& option : group.options)
                {
                    if (option.name == L"Unsafe Helper")
                    {
                        unsafeOptionId = option.id;
                    }
                }
            }
        }
        ASSERT_FALSE(unsafeOptionId.empty());

        FomodInstallerService::rememberSelection(project_, descriptor, {unsafeOptionId});
        FomodInstallerDescriptor replayed = downloads_.analyzeFomodDownload(project_, download.localPath);
        ASSERT_TRUE(replayed.hasPreviousSelection);
        ASSERT_EQ(1u, replayed.previousSelectedOptionIds.size());
        EXPECT_EQ(unsafeOptionId, replayed.previousSelectedOptionIds[0]);

        EXPECT_THROW(
            (void)downloads_.installFomodDownload(
                project_,
                download.localPath,
                L"Replay Safety",
                ExistingModInstallMode::FailIfExists,
                replayed.previousSelectedOptionIds),
            std::invalid_argument);

        EXPECT_FALSE(std::filesystem::exists(modsDirectory() / L"Replay Safety"));
        EXPECT_FALSE(std::filesystem::exists(modsDirectory() / L".Replay Safety.installing"));
    }

    TEST_F(ModFileOperationsIntegrationTests, AnalyzeFomodDownloadCopiesPreviewImagesToStableCache)
    {
        const DownloadEntry download = importArchive(
            L"Preview Mod.fomod",
            {
                {L"fomod/ModuleConfig.xml", R"xml(<config>
  <moduleName>Preview Mod</moduleName>
  <moduleImage path="images/module.png" />
  <installSteps order="Explicit">
    <installStep name="Images">
      <optionalFileGroups order="Explicit">
        <group name="Choice" type="SelectAny">
          <plugins order="Explicit">
            <plugin name="With image">
              <image path="fomod/images/option.png" />
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>)xml"},
                {L"fomod/info.xml", R"xml(<fomod><Name>Preview Mod</Name><Version>1.0.0</Version></fomod>)xml"},
                {L"fomod/images/module.png", "module-preview"},
                {L"fomod/images/option.png", "option-preview"}
            });

        FomodInstallerDescriptor descriptor;
        try
        {
            descriptor = downloads_.analyzeFomodDownload(project_, download.localPath);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        ASSERT_TRUE(descriptor.isFomod);
        ASSERT_EQ(1u, descriptor.steps.size());
        ASSERT_EQ(1u, descriptor.steps[0].groups.size());
        ASSERT_EQ(1u, descriptor.steps[0].groups[0].options.size());
        ASSERT_FALSE(descriptor.moduleImagePath.empty());
        ASSERT_FALSE(descriptor.steps[0].groups[0].options[0].imagePath.empty());
        EXPECT_TRUE(std::filesystem::is_regular_file(std::filesystem::path(descriptor.moduleImagePath)));
        EXPECT_TRUE(std::filesystem::is_regular_file(std::filesystem::path(descriptor.steps[0].groups[0].options[0].imagePath)));
        EXPECT_NE(descriptor.moduleImagePath.find(L".fomod-previews"), std::wstring::npos);
        EXPECT_NE(descriptor.steps[0].groups[0].options[0].imagePath.find(L".fomod-previews"), std::wstring::npos);
    }

    TEST_F(ModFileOperationsIntegrationTests, RefreshInstalledModsFromDiskIgnoresLegacyFomodPackageDirectories)
    {
        writeTextFile(modsDirectory() / L"Real Mod" / L"textures" / L"real.dds", "real");
        writeTextFile(
            modsDirectory() / L"Northern Roads - Patches Compendium.fomod-package" / L"fomod" / L"ModuleConfig.xml",
            "<config />");
        writeTextFile(
            modsDirectory() / L"Interrupted Install.installing" / L"textures" / L"partial.dds",
            "partial");

        InstanceMetadataStore::refreshInstalledModsFromDisk(project_, modsDirectory());
        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());

        ASSERT_NE(findInstalledMod(records, L"Real Mod"), nullptr);
        EXPECT_EQ(findInstalledMod(records, L"Northern Roads - Patches Compendium.fomod-package"), nullptr);
        EXPECT_EQ(findInstalledMod(records, L"Interrupted Install.installing"), nullptr);
    }

    TEST_F(ModFileOperationsIntegrationTests, DeleteInstalledModClearsReadonlyFiles)
    {
        const std::filesystem::path modPath = modsDirectory() / L"Readonly Fomod Package";
        const std::filesystem::path readOnlyFile = modPath / L"plugins" / L"readonly.esp";
        writeTextFile(modPath / L"fomod" / L"ModuleConfig.xml", "<config />");
        writeTextFile(readOnlyFile, "plugin");
#ifdef _WIN32
        ASSERT_NE(SetFileAttributesW(readOnlyFile.c_str(), FILE_ATTRIBUTE_READONLY), 0);
#endif

        InstanceMetadataStore::registerInstalledMod(
            project_,
            modPath,
            L"Readonly Fomod Package",
            L"1.0",
            ModSourceRecord{L"manual"});

        mods_.deleteInstalledMod(project_, modPath);

        EXPECT_FALSE(std::filesystem::exists(modPath));
        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        EXPECT_EQ(findInstalledMod(records, L"Readonly Fomod Package"), nullptr);
    }

    TEST_F(ModFileOperationsIntegrationTests, DeleteInstalledModRemovesNestedDirectoryTree)
    {
        const std::filesystem::path modPath = modsDirectory() / L"Nested Tree Package";
        std::filesystem::path current = modPath;
        for (int index = 0; index < 12; ++index)
        {
            current /= L"level-" + std::to_wstring(index);
            writeTextFile(current / L"file.txt", "payload");
        }

        const std::filesystem::path emptyDirectory = current / L"empty";
        std::filesystem::create_directories(emptyDirectory);
#ifdef _WIN32
        ASSERT_NE(SetFileAttributesW(emptyDirectory.c_str(), FILE_ATTRIBUTE_READONLY), 0);
#endif

        InstanceMetadataStore::registerInstalledMod(
            project_,
            modPath,
            L"Nested Tree Package",
            L"1.0",
            ModSourceRecord{L"manual"});

        mods_.deleteInstalledMod(project_, modPath);

        EXPECT_FALSE(std::filesystem::exists(modPath));
        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        EXPECT_EQ(findInstalledMod(records, L"Nested Tree Package"), nullptr);
    }

    TEST_F(ModFileOperationsIntegrationTests, ProfileConflictsUseLoadOrderAndCaseInsensitivePaths)
    {
        std::string firstError;
        const std::optional<InstalledMod> first = tryInstallArchive(
            L"Armor A.zip",
            {
                {L"Textures/Armor/Iron.dds", "from-a"},
                {L"meshes/armor/a.nif", "mesh-a"}
            },
            L"Armor A",
            firstError);
        if (!first.has_value() && isMissingExtractorError(firstError))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << firstError;
        }
        ASSERT_TRUE(first.has_value()) << firstError;

        std::string secondError;
        const std::optional<InstalledMod> second = tryInstallArchive(
            L"Armor B.zip",
            {
                {L"textures/armor/iron.dds", "from-b"},
                {L"meshes/armor/b.nif", "mesh-b"}
            },
            L"Armor B",
            secondError);
        ASSERT_TRUE(second.has_value()) << secondError;

        const std::vector<ModFileSummaryRecord> summaries =
            InstanceMetadataStore::summarizeProfileModFiles(project_, L"Default", modsDirectory());

        const ModFileSummaryRecord* firstSummary = findSummary(summaries, L"Armor A");
        const ModFileSummaryRecord* secondSummary = findSummary(summaries, L"Armor B");
        ASSERT_NE(firstSummary, nullptr);
        ASSERT_NE(secondSummary, nullptr);

        EXPECT_EQ(firstSummary->summary.fileCount, 2);
        EXPECT_EQ(firstSummary->summary.conflictingFileCount, 1);
        EXPECT_EQ(firstSummary->summary.overwrittenFileCount, 1);
        EXPECT_EQ(firstSummary->summary.overwritingFileCount, 0);

        EXPECT_EQ(secondSummary->summary.fileCount, 2);
        EXPECT_EQ(secondSummary->summary.conflictingFileCount, 1);
        EXPECT_EQ(secondSummary->summary.overwrittenFileCount, 0);
        EXPECT_EQ(secondSummary->summary.overwritingFileCount, 1);

        const std::vector<ProfileModOrderItem> order =
            profileOrder_.listCachedModOrder(project_, L"Default");
        const ProfileModOrderItem* firstOrderItem = findModOrderItem(order, L"Armor A");
        const ProfileModOrderItem* secondOrderItem = findModOrderItem(order, L"Armor B");
        ASSERT_NE(firstOrderItem, nullptr);
        ASSERT_NE(secondOrderItem, nullptr);
        EXPECT_EQ(firstOrderItem->fileCount, 2);
        EXPECT_EQ(firstOrderItem->overwrittenFileCount, 1);
        EXPECT_EQ(firstOrderItem->overwritingFileCount, 0);
        EXPECT_EQ(secondOrderItem->fileCount, 2);
        EXPECT_EQ(secondOrderItem->overwrittenFileCount, 0);
        EXPECT_EQ(secondOrderItem->overwritingFileCount, 1);
        ASSERT_EQ(firstOrderItem->overwrittenByModIds.size(), 1U);
        EXPECT_EQ(firstOrderItem->overwrittenByModIds[0], secondOrderItem->id.wstring());
        ASSERT_EQ(secondOrderItem->overwritesModIds.size(), 1U);
        EXPECT_EQ(secondOrderItem->overwritesModIds[0], firstOrderItem->id.wstring());

        const std::vector<ModFileTreeEntry> firstTree =
            InstanceMetadataStore::listModFileTree(project_, first->id, L"Textures/Armor", modsDirectory());
        ASSERT_EQ(firstTree.size(), 1U);
        EXPECT_EQ(firstTree[0].name, L"Iron.dds");
        EXPECT_EQ(firstTree[0].conflictState, L"overwritten");
        ASSERT_EQ(firstTree[0].conflictOwners.size(), 2U);
        EXPECT_EQ(firstTree[0].conflictOwners[0], L"Armor A");
        EXPECT_EQ(firstTree[0].conflictOwners[1], L"Armor B");

        const std::vector<ModFileTreeEntry> secondTree =
            InstanceMetadataStore::listModFileTree(project_, second->id, L"textures/armor", modsDirectory());
        ASSERT_EQ(secondTree.size(), 1U);
        EXPECT_EQ(secondTree[0].name, L"iron.dds");
        EXPECT_EQ(secondTree[0].conflictState, L"overwrites");

        const std::vector<ProfileModOrderItem> movedOrder =
            profileOrder_.moveModOrderItem(project_, L"Default", secondOrderItem->orderId, 0);
        const ProfileModOrderItem* movedFirst = findModOrderItem(movedOrder, L"Armor A");
        const ProfileModOrderItem* movedSecond = findModOrderItem(movedOrder, L"Armor B");
        ASSERT_NE(movedFirst, nullptr);
        ASSERT_NE(movedSecond, nullptr);
        EXPECT_EQ(movedFirst->overwrittenFileCount, 0);
        EXPECT_EQ(movedFirst->overwritingFileCount, 1);
        EXPECT_EQ(movedSecond->overwrittenFileCount, 1);
        EXPECT_EQ(movedSecond->overwritingFileCount, 0);
        ASSERT_EQ(movedFirst->overwritesModIds.size(), 1U);
        EXPECT_EQ(movedFirst->overwritesModIds[0], movedSecond->id.wstring());
        ASSERT_EQ(movedSecond->overwrittenByModIds.size(), 1U);
        EXPECT_EQ(movedSecond->overwrittenByModIds[0], movedFirst->id.wstring());
    }

    TEST_F(ModFileOperationsIntegrationTests, CachedModOrderMarksFullyOverwrittenModsForLaunch)
    {
        std::string firstError;
        const std::optional<InstalledMod> first = tryInstallArchive(
            L"Fully Lost A.zip",
            {{L"textures/shared/full.dds", "from-a"}},
            L"Fully Lost A",
            firstError);
        if (!first.has_value() && isMissingExtractorError(firstError))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << firstError;
        }
        ASSERT_TRUE(first.has_value()) << firstError;

        std::string secondError;
        const std::optional<InstalledMod> second = tryInstallArchive(
            L"Fully Wins B.zip",
            {{L"textures/shared/full.dds", "from-b"}},
            L"Fully Wins B",
            secondError);
        ASSERT_TRUE(second.has_value()) << secondError;

        const std::vector<ModFileSummaryRecord> summaries =
            InstanceMetadataStore::summarizeProfileModFiles(project_, L"Default", modsDirectory());
        const ModFileSummaryRecord* firstSummary = findSummary(summaries, L"Fully Lost A");
        ASSERT_NE(firstSummary, nullptr);
        EXPECT_EQ(firstSummary->summary.fileCount, 1);
        EXPECT_EQ(firstSummary->summary.overwrittenFileCount, 1);

        const std::vector<ProfileModOrderItem> cachedOrder =
            profileOrder_.listCachedModOrder(project_, L"Default");
        const ProfileModOrderItem* fullyOverwritten =
            findModOrderItem(cachedOrder, L"Fully Lost A");
        const ProfileModOrderItem* winner =
            findModOrderItem(cachedOrder, L"Fully Wins B");
        ASSERT_NE(fullyOverwritten, nullptr);
        ASSERT_NE(winner, nullptr);
        EXPECT_EQ(fullyOverwritten->fileCount, 1);
        EXPECT_EQ(fullyOverwritten->overwrittenFileCount, 1);
        EXPECT_EQ(fullyOverwritten->overwritingFileCount, 0);
        EXPECT_EQ(winner->fileCount, 1);
        EXPECT_EQ(winner->overwrittenFileCount, 0);
        EXPECT_EQ(winner->overwritingFileCount, 1);
    }

    TEST_F(ModFileOperationsIntegrationTests, UnicodeSpacesAndNonAsciiPathsRoundTrip)
    {
        std::string error;
        const std::optional<InstalledMod> installed = tryInstallArchive(
            L"Броня Äther 2.0.zip",
            {
                {L"textures/броня/Äther shield.dds", "texture"},
                {L"meshes/rüstung/Über Helm.nif", "mesh"}
            },
            L"Броня Äther Mod",
            error);

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;
        const std::filesystem::path modPath = modsDirectory() / L"Броня Äther Mod";
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"textures" / L"броня" / L"Äther shield.dds"));
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"meshes" / L"rüstung" / L"Über Helm.nif"));

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        const InstalledModRecord* record = findInstalledMod(records, L"Броня Äther Mod");
        ASSERT_NE(record, nullptr);
        EXPECT_EQ(record->displayName, L"Броня Äther Mod");
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallRejectsArchivePathTraversalBeforeFilesEscape)
    {
        const DownloadEntry download = importArchive(
            L"Traversal.zip",
            {
                {L"../escaped.txt", "bad"},
                {L"textures/safe.dds", "safe"}
            });

        EXPECT_THROW(
            (void)downloads_.installDownload(project_, download.localPath, L"Traversal Mod"),
            std::runtime_error);

        EXPECT_FALSE(std::filesystem::exists(temp_.path() / L"escaped.txt"));
        EXPECT_FALSE(std::filesystem::exists(project_ / L"escaped.txt"));
        EXPECT_FALSE(std::filesystem::exists(modsDirectory() / L"Traversal Mod"));
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallRejectsAbsoluteArchivePathsBeforeExtraction)
    {
        const DownloadEntry download = importArchive(
            L"Absolute Path.zip",
            {
                {L"C:/Windows/win.ini", "bad"},
                {L"textures/safe.dds", "safe"}
            });

        EXPECT_THROW(
            (void)downloads_.installDownload(project_, download.localPath, L"Absolute Path"),
            std::runtime_error);

        EXPECT_FALSE(std::filesystem::exists(modsDirectory() / L"Absolute Path"));
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallRejectsReservedWindowsArchivePaths)
    {
        const DownloadEntry download = importArchive(
            L"Reserved Name.zip",
            {
                {L"Data/CON.txt", "bad"},
                {L"textures/safe.dds", "safe"}
            });

        EXPECT_THROW(
            (void)downloads_.installDownload(project_, download.localPath, L"Reserved Name"),
            std::runtime_error);

        EXPECT_FALSE(std::filesystem::exists(modsDirectory() / L"Reserved Name"));
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallRejectsCaseOnlyDuplicateArchivePaths)
    {
        const DownloadEntry download = importArchive(
            L"Duplicate Case.zip",
            {
                {L"textures/Armor/Iron.dds", "upper"},
                {L"textures/armor/iron.dds", "lower"}
            });

        EXPECT_THROW(
            (void)downloads_.installDownload(project_, download.localPath, L"Duplicate Case"),
            std::runtime_error);

        EXPECT_FALSE(std::filesystem::exists(modsDirectory() / L"Duplicate Case"));
    }
}
