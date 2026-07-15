#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/ProfileService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "../src/Services/PreviewArchiveReader.hpp"
#include "TestFilesystem.hpp"

#include <zlib.h>

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

    void alignInstallStagingCacheMetadataDigestForTest(
        const std::filesystem::path& entryDirectory);
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

        void pushU16(std::vector<std::uint8_t>& bytes, std::uint16_t value)
        {
            bytes.push_back(static_cast<std::uint8_t>(value & 0xFFU));
            bytes.push_back(static_cast<std::uint8_t>((value >> 8) & 0xFFU));
        }

        void pushU32(std::vector<std::uint8_t>& bytes, std::uint32_t value)
        {
            bytes.push_back(static_cast<std::uint8_t>(value & 0xFFU));
            bytes.push_back(static_cast<std::uint8_t>((value >> 8) & 0xFFU));
            bytes.push_back(static_cast<std::uint8_t>((value >> 16) & 0xFFU));
            bytes.push_back(static_cast<std::uint8_t>((value >> 24) & 0xFFU));
        }

        void pushU64(std::vector<std::uint8_t>& bytes, std::uint64_t value)
        {
            for (int index = 0; index < 8; ++index)
            {
                bytes.push_back(static_cast<std::uint8_t>((value >> (index * 8)) & 0xFFU));
            }
        }

        void patchU32(std::vector<std::uint8_t>& bytes, std::size_t offset, std::uint32_t value)
        {
            bytes[offset] = static_cast<std::uint8_t>(value & 0xFFU);
            bytes[offset + 1] = static_cast<std::uint8_t>((value >> 8) & 0xFFU);
            bytes[offset + 2] = static_cast<std::uint8_t>((value >> 16) & 0xFFU);
            bytes[offset + 3] = static_cast<std::uint8_t>((value >> 24) & 0xFFU);
        }

        void pushText(std::vector<std::uint8_t>& bytes, std::string_view text)
        {
            bytes.insert(bytes.end(), text.begin(), text.end());
        }

        void writeBinaryFile(const std::filesystem::path& path, const std::vector<std::uint8_t>& bytes)
        {
            std::filesystem::create_directories(path.parent_path());
            std::ofstream file(path, std::ios::out | std::ios::binary | std::ios::trunc);
            if (!file)
            {
                throw std::runtime_error("Failed to create binary test file.");
            }
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

        std::string bytesToString(const std::vector<std::uint8_t>& bytes)
        {
            return std::string(bytes.begin(), bytes.end());
        }

        std::vector<std::uint8_t> bytesFromString(std::string_view text)
        {
            return std::vector<std::uint8_t>(text.begin(), text.end());
        }

        std::vector<std::uint8_t> zlibCompress(const std::vector<std::uint8_t>& bytes)
        {
            uLongf compressedSize = compressBound(static_cast<uLong>(bytes.size()));
            std::vector<std::uint8_t> compressed(static_cast<std::size_t>(compressedSize));
            const int result = compress2(
                compressed.data(),
                &compressedSize,
                bytes.data(),
                static_cast<uLong>(bytes.size()),
                Z_BEST_SPEED);
            if (result != Z_OK)
            {
                throw std::runtime_error("Failed to create compressed BA2 test payload.");
            }
            compressed.resize(static_cast<std::size_t>(compressedSize));
            return compressed;
        }

        std::vector<std::uint8_t> lz4FrameWithUncompressedBlock(const std::vector<std::uint8_t>& bytes)
        {
            std::vector<std::uint8_t> frame;
            frame.insert(frame.end(), {0x04, 0x22, 0x4d, 0x18});
            frame.push_back(0x60);
            frame.push_back(0x40);
            frame.push_back(0x00);
            pushU32(frame, static_cast<std::uint32_t>(bytes.size()) | 0x80000000U);
            frame.insert(frame.end(), bytes.begin(), bytes.end());
            pushU32(frame, 0);
            return frame;
        }

        void writePreviewBsaArchive(
            const std::filesystem::path& path,
            std::wstring_view relativePath,
            const std::vector<std::uint8_t>& payload,
            bool prefixFullFileName = false)
        {
            std::filesystem::path relative(relativePath);
            const auto directoryUtf8 = relative.parent_path().generic_u8string();
            const auto fileUtf8 = relative.filename().generic_u8string();
            const auto relativeUtf8 = relative.generic_u8string();
            const std::string directoryName(
                reinterpret_cast<const char*>(directoryUtf8.data()),
                directoryUtf8.size());
            const std::string fileName(
                reinterpret_cast<const char*>(fileUtf8.data()),
                fileUtf8.size());
            const std::string relativeName(
                reinterpret_cast<const char*>(relativeUtf8.data()),
                relativeUtf8.size());
            const std::vector<std::uint8_t> frame = lz4FrameWithUncompressedBlock(payload);

            std::vector<std::uint8_t> bytes;
            pushText(bytes, std::string("BSA", 3));
            bytes.push_back(0);
            pushU32(bytes, 105);
            pushU32(bytes, 36);
            pushU32(bytes, 0x001U | 0x002U | 0x004U | (prefixFullFileName ? 0x100U : 0U));
            pushU32(bytes, 1);
            pushU32(bytes, 1);
            pushU32(bytes, static_cast<std::uint32_t>(directoryName.size() + 1));
            pushU32(bytes, static_cast<std::uint32_t>(fileName.size() + 1));
            pushU32(bytes, 0x002U);

            pushU64(bytes, 0);
            pushU32(bytes, 1);
            pushU32(bytes, 0);
            pushU64(bytes, 0);

            bytes.push_back(static_cast<std::uint8_t>(directoryName.size() + 1));
            pushText(bytes, directoryName);
            bytes.push_back(0);

            pushU64(bytes, 0);
            const std::size_t sizeOffset = bytes.size();
            pushU32(bytes, 0);
            const std::size_t dataOffset = bytes.size();
            pushU32(bytes, 0);

            pushText(bytes, fileName);
            bytes.push_back(0);

            const std::uint32_t payloadOffset = static_cast<std::uint32_t>(bytes.size());
            patchU32(bytes, dataOffset, payloadOffset);
            const std::uint32_t embeddedNameSize =
                prefixFullFileName ? static_cast<std::uint32_t>(relativeName.size() + 1) : 0U;
            const std::uint32_t storedSize = static_cast<std::uint32_t>(frame.size() + 4) + embeddedNameSize;
            patchU32(bytes, sizeOffset, storedSize);
            if (prefixFullFileName)
            {
                bytes.push_back(static_cast<std::uint8_t>(relativeName.size()));
                pushText(bytes, relativeName);
            }
            pushU32(bytes, static_cast<std::uint32_t>(payload.size()));
            bytes.insert(bytes.end(), frame.begin(), frame.end());

            writeBinaryFile(path, bytes);
        }

        void writePreviewBa2Dx10Archive(
            const std::filesystem::path& path,
            std::wstring_view relativePath,
            const std::vector<std::uint8_t>& payload)
        {
            const auto relativeUtf8 = std::filesystem::path(relativePath).generic_u8string();
            const std::string relativeName(
                reinterpret_cast<const char*>(relativeUtf8.data()),
                relativeUtf8.size());
            const std::vector<std::uint8_t> compressed = zlibCompress(payload);
            const std::uint64_t dataOffset = 24 + 24 + 24;
            const std::uint64_t namesOffset = dataOffset + compressed.size();

            std::vector<std::uint8_t> bytes;
            pushText(bytes, "BTDX");
            pushU32(bytes, 1);
            pushText(bytes, "DX10");
            pushU32(bytes, 1);
            pushU64(bytes, namesOffset);

            pushU32(bytes, 0);
            pushText(bytes, std::string_view("dds\0", 4));
            pushU32(bytes, 0);
            bytes.push_back(0);
            bytes.push_back(1);
            pushU16(bytes, 24);
            pushU16(bytes, 4);
            pushU16(bytes, 4);
            bytes.push_back(1);
            bytes.push_back(71);
            pushU16(bytes, 0);

            pushU64(bytes, dataOffset);
            pushU32(bytes, static_cast<std::uint32_t>(compressed.size()));
            pushU32(bytes, static_cast<std::uint32_t>(payload.size()));
            pushU16(bytes, 0);
            pushU16(bytes, 0);
            pushU32(bytes, 0xBAADF00DU);

            bytes.insert(bytes.end(), compressed.begin(), compressed.end());
            pushU16(bytes, static_cast<std::uint16_t>(relativeName.size()));
            pushText(bytes, relativeName);

            writeBinaryFile(path, bytes);
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
              downloads_(logger_, settings_, pathSettings_, transferLimiter_),
              mods_(logger_, settings_, pathSettings_),
              profiles_(logger_, pathSettings_),
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
        DownloadTransferLimiter transferLimiter_;
        DownloadService downloads_;
        ModService mods_;
        ProfileService profiles_;
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

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadReturnsPersistedNexusIdentity)
    {
        const DownloadEntry download = importArchive(
            L"Cabbage CS Preset 1.4.0.zip",
            {
                {L"SKSE/Plugins/CabbagePreset.dll", "plugin"},
                {L"fomod/info.xml", "<fomod><Name>Cabbage CS Preset</Name><Version>1.4.0</Version></fomod>"}
            });
        writeTextFile(
            download.localPath.wstring() + L".fluxora.json",
            R"json({
                "source":"nxm://skyrimspecialedition/mods/182366/files/770345",
                "gameDomain":"skyrimspecialedition",
                "modId":"182366",
                "fileId":"770345",
                "nexusModName":"Cabbage CS Preset",
                "version":"1.4.0",
                "latestVersion":"1.4.0",
                "isDownloading":false
            })json");

        InstalledMod installed;
        try
        {
            installed = downloads_.installDownload(
                project_,
                download.localPath,
                L"Cabbage CS Preset");
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }

            throw;
        }

        EXPECT_EQ(installed.latestVersion, L"1.4.0");
        EXPECT_TRUE(installed.sourceIsNexus);
        EXPECT_FALSE(installed.isLocal);
        EXPECT_EQ(installed.sourceProvider, L"nexus");
        EXPECT_EQ(installed.sourceGameDomain, L"skyrimspecialedition");
        EXPECT_EQ(installed.sourceModId, L"182366");
        EXPECT_EQ(installed.sourceFileId, L"770345");
        EXPECT_EQ(
            installed.sourceUrl,
            L"nxm://skyrimspecialedition/mods/182366/files/770345");
    }

    TEST_F(ModFileOperationsIntegrationTests, PlannedInstallNewUsesFirstFreeCaseInsensitiveCopySuffix)
    {
        const std::filesystem::path existingPath = modsDirectory() / L"Example Mod";
        writeTextFile(existingPath / L"Data" / L"Existing.esp", "existing");
        const InstalledModRecord existing = InstanceMetadataStore::registerInstalledMod(
            project_,
            existingPath,
            L"Example Mod",
            L"1.0",
            ModSourceRecord{L"manual"});
        writeTextFile(modsDirectory() / L"eXaMpLe MoD (2)" / L"Data" / L"Collision.esp", "collision");

        const DownloadEntry download = importArchive(
            L"Example Mod 2.0.zip",
            {{L"Data/Example.esp", "new"}});
        FluxoraInstallPlan plan;
        try
        {
            plan = downloads_.planDownloadInstall(project_, download.localPath);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }
            throw;
        }

        const ModIdentityInstallSelection selection{
            plan.resolutionId,
            InstallIdentityDecision::InstallNew,
            {},
            NewNamePolicy::FirstFreeCopySuffix
        };
        const InstalledMod installed = downloads_.installDownload(
            project_,
            download.localPath,
            L"Example Mod",
            ExistingModInstallMode::FailIfExists,
            {},
            &selection);

        EXPECT_EQ(installed.name, L"Example Mod (3)");
        EXPECT_TRUE(std::filesystem::is_regular_file(
            modsDirectory() / L"Example Mod (3)" / L"Example.esp"));
        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        const InstalledModRecord* separateCopy = findInstalledMod(records, L"Example Mod (3)");
        ASSERT_NE(separateCopy, nullptr);
        EXPECT_NE(separateCopy->uuid, existing.uuid);
        const std::optional<InstalledModRecord> detailedCopy =
            InstanceMetadataStore::installedModByUuid(project_, separateCopy->uuid);
        ASSERT_TRUE(detailedCopy.has_value());
        EXPECT_TRUE(detailedCopy->identityAliases.empty());
        EXPECT_NE(
            std::find(
                detailedCopy->identityExcludedModUuids.begin(),
                detailedCopy->identityExcludedModUuids.end(),
                existing.uuid),
            detailedCopy->identityExcludedModUuids.end());
    }

    TEST_F(ModFileOperationsIntegrationTests, PlannedReplaceKeepsMatchedUuidDisplayNameAndFolder)
    {
        const std::filesystem::path existingPath = modsDirectory() / L"SPID";
        writeTextFile(existingPath / L"SKSE" / L"Plugins" / L"SPID.dll", "old");
        const InstalledModRecord existing = InstanceMetadataStore::registerInstalledMod(
            project_,
            existingPath,
            L"Spell Perks Item Distributor",
            L"7.1",
            ModSourceRecord{L"nexus", L"skyrimspecialedition", L"36869", L"100"});

        const DownloadEntry download = importArchive(
            L"SPID 7.2.zip",
            {{L"SKSE/Plugins/SPID.dll", "new"}});
        writeTextFile(
            download.localPath.wstring() + L".fluxora.json",
            R"json({
                "source":"nxm://skyrimspecialedition/mods/36869/files/200",
                "gameDomain":"skyrimspecialedition",
                "modId":"36869",
                "fileId":"200",
                "nexusModName":"SPID 7.2",
                "isDownloading":false
            })json");

        FluxoraInstallPlan plan;
        try
        {
            plan = downloads_.planDownloadInstall(project_, download.localPath);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }
            throw;
        }
        ASSERT_TRUE(plan.matchedTarget.has_value());
        EXPECT_EQ(plan.matchedTarget->modUuid, existing.uuid);

        const ModIdentityInstallSelection selection{
            plan.resolutionId,
            InstallIdentityDecision::UseMatch,
            existing.uuid,
            NewNamePolicy::FirstFreeCopySuffix
        };
        const InstalledMod installed = downloads_.installDownload(
            project_,
            download.localPath,
            L"User typed a different name",
            ExistingModInstallMode::Replace,
            {},
            &selection);

        EXPECT_EQ(installed.name, L"Spell Perks Item Distributor");
        EXPECT_EQ(installed.id.filename().wstring(), L"SPID");
        const std::optional<InstalledModRecord> current =
            InstanceMetadataStore::installedModByUuid(project_, existing.uuid);
        ASSERT_TRUE(current.has_value());
        EXPECT_EQ(current->displayName, L"Spell Perks Item Distributor");
        EXPECT_EQ(current->folderName, L"SPID");
        EXPECT_EQ(current->source.remoteModId, L"36869");
        EXPECT_EQ(current->source.remoteFileId, L"200");
        EXPECT_NE(
            std::find(current->identityAliases.begin(), current->identityAliases.end(), L"SPID 7.2"),
            current->identityAliases.end());
        EXPECT_EQ(readTextFile(existingPath / L"SKSE" / L"Plugins" / L"SPID.dll"), "new");
    }

    TEST_F(ModFileOperationsIntegrationTests, PlannedMergeKeepsMatchedIdentityAndPreservesExistingFiles)
    {
        const std::filesystem::path existingPath = modsDirectory() / L"Merge Target";
        writeTextFile(existingPath / L"textures" / L"shared.dds", "old-shared");
        writeTextFile(existingPath / L"textures" / L"old-only.dds", "old-only");
        const InstalledModRecord existing = InstanceMetadataStore::registerInstalledMod(
            project_,
            existingPath,
            L"Merge Target",
            L"1.0",
            ModSourceRecord{L"nexus", L"skyrimspecialedition", L"900", L"100"});

        const DownloadEntry download = importArchive(
            L"Incoming Merge 2.0.zip",
            {
                {L"textures/shared.dds", "new-shared"},
                {L"textures/new-only.dds", "new-only"}
            });
        writeTextFile(
            download.localPath.wstring() + L".fluxora.json",
            R"json({
                "source":"nxm://skyrimspecialedition/mods/900/files/200",
                "gameDomain":"skyrimspecialedition",
                "modId":"900",
                "fileId":"200",
                "nexusModName":"Incoming Merge 2.0",
                "isDownloading":false
            })json");

        FluxoraInstallPlan plan;
        try
        {
            plan = downloads_.planDownloadInstall(project_, download.localPath);
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }
            throw;
        }
        ASSERT_TRUE(plan.matchedTarget.has_value());
        EXPECT_EQ(plan.matchedTarget->modUuid, existing.uuid);

        const ModIdentityInstallSelection selection{
            plan.resolutionId,
            InstallIdentityDecision::UseMatch,
            existing.uuid,
            NewNamePolicy::FirstFreeCopySuffix
        };
        const InstalledMod installed = downloads_.installDownload(
            project_,
            download.localPath,
            L"Incoming Merge 2.0",
            ExistingModInstallMode::Merge,
            {},
            &selection);

        EXPECT_EQ(installed.name, L"Merge Target");
        EXPECT_EQ(installed.id.filename().wstring(), L"Merge Target");
        EXPECT_EQ(readTextFile(existingPath / L"textures" / L"shared.dds"), "new-shared");
        EXPECT_EQ(readTextFile(existingPath / L"textures" / L"old-only.dds"), "old-only");
        EXPECT_EQ(readTextFile(existingPath / L"textures" / L"new-only.dds"), "new-only");

        const std::optional<InstalledModRecord> current =
            InstanceMetadataStore::installedModByUuid(project_, existing.uuid);
        ASSERT_TRUE(current.has_value());
        EXPECT_EQ(current->displayName, L"Merge Target");
        EXPECT_EQ(current->folderName, L"Merge Target");
        EXPECT_EQ(current->source.remoteModId, L"900");
        EXPECT_EQ(current->source.remoteFileId, L"200");
        EXPECT_NE(
            std::find(
                current->identityAliases.begin(),
                current->identityAliases.end(),
                L"Incoming Merge 2.0"),
            current->identityAliases.end());
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

    TEST_F(ModFileOperationsIntegrationTests, InstalledModListPerformsOneLiveInventorySync)
    {
        (void)mods_.createEmptyMod(project_, L"Inventory Probe");
        InstanceMetadataStore::resetInventorySyncCountForTesting();

        const std::vector<InstalledModEntry> installed = mods_.listInstalledMods(project_);

        ASSERT_EQ(installed.size(), 1U);
        EXPECT_EQ(installed.front().name, L"Inventory Probe");
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 1U);
    }

    TEST_F(ModFileOperationsIntegrationTests, InstalledModListTreatsTrailingZeroVersionSegmentsAsEquivalent)
    {
        const std::filesystem::path modPath = modsDirectory() / L"Animation Motion Revolution";
        writeTextFile(modPath / L"SKSE" / L"Plugins" / L"AnimationMotionRevolution.dll", "plugin");
        InstanceMetadataStore::registerInstalledMod(
            project_,
            modPath,
            L"Animation Motion Revolution",
            L"1.5.3.0",
            ModSourceRecord{
                L"nexus",
                L"skyrimspecialedition",
                L"50258",
                L"123456",
                L"nxm://skyrimspecialedition/mods/50258/files/123456",
                L"2026-07-15T10:00:00Z",
                L"1.5.3"});

        const std::vector<InstalledModEntry> installed = mods_.listInstalledMods(project_);

        ASSERT_EQ(installed.size(), 1U);
        EXPECT_EQ(installed.front().version, L"1.5.3.0");
        EXPECT_EQ(installed.front().latestVersion, L"1.5.3");
        EXPECT_FALSE(installed.front().hasUpdate);
        EXPECT_EQ(installed.front().updateStatus, L"Актуально");
    }

    TEST_F(ModFileOperationsIntegrationTests, LiveProfileOrderPerformsOneLiveInventorySync)
    {
        (void)mods_.createEmptyMod(project_, L"Order Probe");
        InstanceMetadataStore::resetInventorySyncCountForTesting();

        const std::vector<ProfileModOrderItem> order =
            profileOrder_.listModOrder(project_, L"Default");

        ASSERT_EQ(order.size(), 1U);
        EXPECT_EQ(order.front().name, L"Order Probe");
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 1U);
    }

    TEST_F(ModFileOperationsIntegrationTests, ModWorkspaceSnapshotPreparesLiveInventoryExactlyOnce)
    {
        (void)mods_.createEmptyMod(project_, L"Workspace Probe");
        InstanceMetadataStore::beginProjectActivation(temp_.path() / L"Other Workspace");
        InstanceMetadataStore::beginProjectActivation(project_);
        InstanceMetadataStore::resetInventorySyncCountForTesting();

        const ModWorkspaceSnapshot snapshot =
            profileOrder_.workspaceSnapshot(project_, L"Default");

        ASSERT_EQ(snapshot.installedMods.size(), 1U);
        ASSERT_EQ(snapshot.modOrder.size(), 1U);
        EXPECT_EQ(snapshot.installedMods.front().name, L"Workspace Probe");
        EXPECT_EQ(snapshot.modOrder.front().name, L"Workspace Probe");

        const std::vector<ProfileModOrderItem> launchOrder =
            profileOrder_.listCachedLaunchModOrder(project_, L"Default");
        ASSERT_EQ(launchOrder.size(), 1U);
        EXPECT_EQ(launchOrder.front().name, L"Workspace Probe");
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 1U);
    }

    TEST_F(ModFileOperationsIntegrationTests, PersistedWorkspaceSnapshotSkipsLiveInventorySync)
    {
        (void)mods_.createEmptyMod(project_, L"Persisted Workspace Probe");
        InstanceMetadataStore::resetInventorySyncCountForTesting();

        const ModWorkspaceSnapshot snapshot =
            profileOrder_.persistedWorkspaceSnapshot(project_, L"Default");

        ASSERT_EQ(snapshot.installedMods.size(), 1U);
        ASSERT_EQ(snapshot.modOrder.size(), 1U);
        EXPECT_EQ(snapshot.installedMods.front().name, L"Persisted Workspace Probe");
        EXPECT_EQ(snapshot.modOrder.front().name, L"Persisted Workspace Probe");
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 0U);
    }

    TEST_F(ModFileOperationsIntegrationTests, LaunchOrderSkipsConflictSummaryButPreservesPriorityAndState)
    {
        const InstalledModEntry first = mods_.createEmptyMod(project_, L"Launch First");
        const InstalledModEntry second = mods_.createEmptyMod(project_, L"Launch Second");
        writeTextFile(first.id / L"Data" / L"shared.bin", "first");
        writeTextFile(second.id / L"Data" / L"shared.bin", "second");
        mods_.setInstalledModEnabled(project_, second.id, false);
        (void)mods_.listInstalledMods(project_);

        InstanceMetadataStore::resetInventorySyncCountForTesting();
        const std::vector<ProfileModOrderItem> launchOrder =
            profileOrder_.listCachedLaunchModOrder(project_, L"Default");

        ASSERT_EQ(launchOrder.size(), 2U);
        EXPECT_EQ(launchOrder[0].name, L"Launch First");
        EXPECT_TRUE(launchOrder[0].isEnabled);
        EXPECT_EQ(launchOrder[0].fileCount, -1);
        EXPECT_FALSE(launchOrder[0].contentFingerprint.empty());
        EXPECT_EQ(launchOrder[1].name, L"Launch Second");
        EXPECT_FALSE(launchOrder[1].isEnabled);
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 0U);
    }

    TEST_F(ModFileOperationsIntegrationTests, CreateEmptyModRejectsOverlongWindowsFolderName)
    {
        const std::wstring overlongName(256, L'A');

        EXPECT_THROW(
            (void)mods_.createEmptyMod(project_, overlongName),
            std::invalid_argument);
    }

    TEST_F(ModFileOperationsIntegrationTests, CreateModSeparatorRejectsOverlongTitle)
    {
        const std::wstring overlongTitle(256, L'S');

        EXPECT_THROW(
            (void)profileOrder_.createModSeparator(project_, L"Default", overlongTitle, 0),
            std::invalid_argument);
    }

    TEST_F(ModFileOperationsIntegrationTests, ListInstalledModsReflectsManualFolderAddsAndDeletes)
    {
        const std::filesystem::path manualMod = modsDirectory() / L"Manual Drop";
        writeTextFile(manualMod / L"Data" / L"ManualDrop.esp", "plugin");

        std::vector<InstalledModEntry> entries = mods_.listInstalledMods(project_);
        auto found = std::find_if(
            entries.begin(),
            entries.end(),
            [](const InstalledModEntry& entry)
            {
                return entry.name == L"Manual Drop";
            });
        ASSERT_NE(found, entries.end());
        EXPECT_EQ(found->id, manualMod);
        EXPECT_TRUE(found->isLocal);

        std::filesystem::remove_all(manualMod);
        entries = mods_.listInstalledMods(project_);
        found = std::find_if(
            entries.begin(),
            entries.end(),
            [](const InstalledModEntry& entry)
            {
                return entry.name == L"Manual Drop";
            });
        EXPECT_EQ(found, entries.end());

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, modsDirectory());
        EXPECT_EQ(findInstalledMod(records, L"Manual Drop"), nullptr);
    }

    TEST_F(ModFileOperationsIntegrationTests, ProfileModOrderRestoresManualFolderToCachedPosition)
    {
        const InstalledModEntry first = mods_.createEmptyMod(project_, L"First Manual Mod");
        const InstalledModEntry second = mods_.createEmptyMod(project_, L"Second Manual Mod");
        const InstalledModEntry third = mods_.createEmptyMod(project_, L"Third Manual Mod");

        const std::vector<ProfileModOrderItem> initialOrder =
            profileOrder_.listModOrder(project_, L"Default");
        const ProfileModOrderItem* thirdOrderItem = findModOrderItem(initialOrder, L"Third Manual Mod");
        ASSERT_NE(thirdOrderItem, nullptr);

        const std::vector<ProfileModOrderItem> movedOrder =
            profileOrder_.moveModOrderItem(project_, L"Default", thirdOrderItem->orderId, 0);
        ASSERT_GE(movedOrder.size(), 3U);
        EXPECT_EQ(movedOrder[0].name, L"Third Manual Mod");

        std::filesystem::remove_all(third.id);
        const std::vector<ProfileModOrderItem> afterDelete =
            profileOrder_.listModOrder(project_, L"Default");
        EXPECT_EQ(findModOrderItem(afterDelete, L"Third Manual Mod"), nullptr);
        ASSERT_NE(findModOrderItem(afterDelete, L"First Manual Mod"), nullptr);
        ASSERT_NE(findModOrderItem(afterDelete, L"Second Manual Mod"), nullptr);

        writeTextFile(third.id / L"Data" / L"ThirdManualMod.esp", "plugin");
        const std::vector<ProfileModOrderItem> afterRestore =
            profileOrder_.listModOrder(project_, L"Default");
        ASSERT_GE(afterRestore.size(), 3U);
        EXPECT_EQ(afterRestore[0].name, L"Third Manual Mod");
        EXPECT_EQ(afterRestore[1].name, L"First Manual Mod");
        EXPECT_EQ(afterRestore[2].name, L"Second Manual Mod");

        EXPECT_TRUE(std::filesystem::exists(first.id));
        EXPECT_TRUE(std::filesystem::exists(second.id));
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

    TEST_F(ModFileOperationsIntegrationTests, ModTextFilePreviewReadsBoundedContainedUtf8Files)
    {
        const InstalledModEntry created = mods_.createEmptyMod(project_, L"RaceMenu");
        const std::filesystem::path modPath = created.id;
        writeTextFile(
            modPath / L"README.txt",
            "RaceMenu requires SKSE and Address Library.\nSecond line.\n");
        writeTextFile(modPath / L"fomod" / L"ModuleConfig.xml", "<config><moduleName>RaceMenu</moduleName></config>\n");
        writeTextFile(modPath / L"SKSE" / L"Plugins" / L"RaceMenu.dll", "not text");
        writeTextFile(modPath / L"password.txt", "password=hidden\n");

        const ModTextFilePreview preview =
            mods_.previewModTextFile(project_, modPath, L"README.txt", 24);

        EXPECT_EQ(preview.fileName, L"README.txt");
        EXPECT_EQ(preview.relativePath, L"README.txt");
        EXPECT_LE(preview.bytesRead, 24U);
        EXPECT_TRUE(preview.truncated);
        EXPECT_NE(preview.contentPreview.find(L"RaceMenu requires SKSE"), std::wstring::npos);

        const ModTextFilePreview fomodPreview =
            mods_.previewModTextFile(project_, modPath, L"fomod/ModuleConfig.xml", 64 * 1024);
        EXPECT_EQ(fomodPreview.fileName, L"ModuleConfig.xml");
        EXPECT_NE(fomodPreview.contentPreview.find(L"RaceMenu"), std::wstring::npos);

        EXPECT_THROW(
            (void)mods_.previewModTextFile(project_, modPath, L"SKSE/Plugins/RaceMenu.dll", 64 * 1024),
            std::invalid_argument);
        EXPECT_THROW(
            (void)mods_.previewModTextFile(project_, modPath, L"password.txt", 64 * 1024),
            std::invalid_argument);
        EXPECT_THROW(
            (void)mods_.previewModTextFile(project_, modPath, L"../Other Mod/README.txt", 64 * 1024),
            std::invalid_argument);
    }

    TEST_F(ModFileOperationsIntegrationTests, ProfileTextFilePreviewReadsOnlyAllowedProfileFiles)
    {
        const std::filesystem::path profile = pathSettings_.profilesDirectory(project_) / L"Default";
        writeTextFile(profile / L"plugins.txt", "*Skyrim.esm\n*RaceMenu.esp\n");
        writeTextFile(profile / L"secret.txt", "password=hidden\n");

        const ProfileTextFilePreview preview =
            profiles_.previewProfileTextFile(project_, L"Default", L"plugins.txt", 64 * 1024);

        EXPECT_EQ(preview.fileName, L"plugins.txt");
        EXPECT_EQ(preview.relativePath, L"Default/plugins.txt");
        EXPECT_FALSE(preview.truncated);
        EXPECT_NE(preview.contentPreview.find(L"RaceMenu.esp"), std::wstring::npos);

        EXPECT_THROW(
            (void)profiles_.previewProfileTextFile(project_, L"Default", L"secret.txt", 64 * 1024),
            std::invalid_argument);
        EXPECT_THROW(
            (void)profiles_.previewProfileTextFile(project_, L"..", L"plugins.txt", 64 * 1024),
            std::invalid_argument);
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

    TEST_F(ModFileOperationsIntegrationTests, ModPreviewVariantsReturnSameNifPathInProfileOrder)
    {
        const InstalledModEntry first = mods_.createEmptyMod(project_, L"Armor A");
        const InstalledModEntry second = mods_.createEmptyMod(project_, L"Armor B");
        const InstalledModEntry third = mods_.createEmptyMod(project_, L"Armor C");

        writeTextFile(first.id / L"meshes" / L"armor" / L"cuirass.nif", "first-nif");
        writeTextFile(second.id / L"meshes" / L"armor" / L"cuirass.nif", "second-nif");
        writeTextFile(third.id / L"meshes" / L"armor" / L"cuirass.nif", "third-nif");
        mods_.setInstalledModEnabled(project_, second.id, false);

        const std::vector<ModPreviewVariant> variants =
            mods_.listPreviewVariants(project_, L"Default", L"meshes/armor/cuirass.nif");

        ASSERT_EQ(variants.size(), 3U);
        EXPECT_EQ(variants[0].modName, L"Armor A");
        EXPECT_EQ(variants[0].order, 0);
        EXPECT_TRUE(variants[0].enabled);
        EXPECT_EQ(variants[1].modName, L"Armor B");
        EXPECT_EQ(variants[1].order, 1);
        EXPECT_FALSE(variants[1].enabled);
        EXPECT_EQ(variants[2].modName, L"Armor C");
        EXPECT_EQ(variants[2].order, 2);
        EXPECT_TRUE(variants[2].enabled);
        EXPECT_EQ(variants[0].relativePath, L"meshes/armor/cuirass.nif");
        EXPECT_EQ(variants[0].size, 9U);
    }

    TEST_F(ModFileOperationsIntegrationTests, ModPreviewVariantsOmitMissingNeighbors)
    {
        const InstalledModEntry only = mods_.createEmptyMod(project_, L"Only Mesh");
        const InstalledModEntry missing = mods_.createEmptyMod(project_, L"Missing Mesh");
        (void)missing;

        writeTextFile(only.id / L"meshes" / L"armor" / L"cuirass.nif", "only-nif");

        const std::vector<ModPreviewVariant> variants =
            mods_.listPreviewVariants(project_, L"Default", L"meshes/armor/cuirass.nif");

        ASSERT_EQ(variants.size(), 1U);
        EXPECT_EQ(variants.front().modPath, only.id);
        EXPECT_EQ(variants.front().modName, L"Only Mesh");
    }

    TEST_F(ModFileOperationsIntegrationTests, NifPreviewStartsWithActiveVariantAndFileBackedModelHandle)
    {
        const InstalledModEntry first = mods_.createEmptyMod(project_, L"Armor A");
        const InstalledModEntry active = mods_.createEmptyMod(project_, L"Armor B");
        const std::wstring relativePath = L"meshes/armor/cuirass.nif";
        writeTextFile(first.id / relativePath, "first-nif");
        writeTextFile(active.id / relativePath, "active-nif");

        const NifPreviewStartResult preview =
            mods_.startNifPreview(project_, L"Default", active.id, relativePath);

        ASSERT_EQ(preview.variants.size(), 2U);
        EXPECT_EQ(preview.activeIndex, 1);
        EXPECT_EQ(preview.model.kind, L"nif");
        EXPECT_EQ(preview.model.relativePath, relativePath);
        EXPECT_EQ(preview.model.source, L"Armor B");
        EXPECT_EQ(preview.model.size, 10U);
        EXPECT_EQ(preview.model.resolvedPath, active.id / relativePath);
        EXPECT_FALSE(preview.model.contentKey.empty());
    }

    TEST_F(ModFileOperationsIntegrationTests, NifPreviewTextureBatchDeduplicatesAndKeepsMissingAssets)
    {
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"Selected Model");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"Final Texture");
        const InstalledModEntry disabled = mods_.createEmptyMod(project_, L"Disabled Texture");
        const std::wstring texturePath = L"textures/armor/cuirass.dds";
        const std::vector<ProfileModOrderItem> initialOrder =
            profileOrder_.listModOrder(project_, L"Default");
        const ProfileModOrderItem* selectedOrder = findModOrderItem(initialOrder, L"Selected Model");
        const ProfileModOrderItem* highOrder = findModOrderItem(initialOrder, L"Final Texture");
        const ProfileModOrderItem* disabledOrder = findModOrderItem(initialOrder, L"Disabled Texture");
        ASSERT_NE(selectedOrder, nullptr);
        ASSERT_NE(highOrder, nullptr);
        ASSERT_NE(disabledOrder, nullptr);
        (void)profileOrder_.moveModOrderItem(project_, L"Default", selectedOrder->orderId, 0);
        (void)profileOrder_.moveModOrderItem(project_, L"Default", highOrder->orderId, 1);
        (void)profileOrder_.moveModOrderItem(project_, L"Default", disabledOrder->orderId, 2);
        writeTextFile(selected.id / L"meshes/armor/cuirass.nif", "selected-nif");
        writeTextFile(selected.id / texturePath, "selected-texture");
        writeTextFile(high.id / texturePath, "high-texture");
        writeTextFile(disabled.id / texturePath, "disabled-texture");
        mods_.setInstalledModEnabled(project_, disabled.id, false);

        const NifPreviewTextureBatchResult batch = mods_.prepareNifPreviewTextures(
            project_,
            L"Default",
            selected.id,
            {
                texturePath,
                L"TEXTURES\\ARMOR\\CUIRASS.DDS",
                L"textures/armor/missing.dds"
            });

        ASSERT_EQ(batch.assets.size(), 1U);
        EXPECT_EQ(batch.assets.front().relativePath, texturePath);
        EXPECT_EQ(batch.assets.front().source, L"Final Texture");
        EXPECT_EQ(batch.assets.front().resolvedPath, high.id / texturePath);
        EXPECT_EQ(batch.assets.front().size, 12U);
        ASSERT_EQ(batch.missing.size(), 1U);
        EXPECT_EQ(batch.missing.front(), L"textures/armor/missing.dds");
        EXPECT_EQ(batch.totalBytes, 12U);
    }

    TEST_F(ModFileOperationsIntegrationTests, NifPreviewTextureBatchUsesOverwriteThenEnabledModsThenGameData)
    {
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"Selected Model");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"Final Texture");
        const std::wstring texturePath = L"textures/armor/cuirass.dds";
        const std::filesystem::path gameData = project_ / L"stock game" / L"Data";
        writeTextFile(project_ / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(gameData / L"Skyrim.esm", "master");
        writeTextFile(
            project_ / L".fluxora" / L"paths.json",
            "{"
            "\"gameDirectory\":\"stock game\","
            "\"modsDirectory\":\"mods\","
            "\"profilesDirectory\":\"profiles\","
            "\"downloadsDirectory\":\"downloads\","
            "\"overwriteDirectory\":\"overwrite\""
            "}");
        writeTextFile(selected.id / L"meshes/armor/cuirass.nif", "selected-model");
        writeTextFile(high.id / texturePath, "mod-texture");
        writeTextFile(gameData / texturePath, "game-texture");

        NifPreviewTextureBatchResult batch = mods_.prepareNifPreviewTextures(
            project_, L"Default", selected.id, {texturePath});
        ASSERT_EQ(batch.assets.size(), 1U);
        EXPECT_EQ(batch.assets.front().source, L"Final Texture");
        EXPECT_EQ(readTextFile(batch.assets.front().resolvedPath), "mod-texture");

        writeTextFile(overwriteDirectory() / texturePath, "overwrite-texture");
        batch = mods_.prepareNifPreviewTextures(project_, L"Default", selected.id, {texturePath});
        ASSERT_EQ(batch.assets.size(), 1U);
        EXPECT_EQ(batch.assets.front().source, L"Overwrite");
        EXPECT_EQ(readTextFile(batch.assets.front().resolvedPath), "overwrite-texture");

        std::error_code removeError;
        std::filesystem::remove(overwriteDirectory() / texturePath, removeError);
        ASSERT_FALSE(removeError);
        mods_.setInstalledModEnabled(project_, high.id, false);
        batch = mods_.prepareNifPreviewTextures(project_, L"Default", selected.id, {texturePath});
        ASSERT_EQ(batch.assets.size(), 1U);
        EXPECT_EQ(batch.assets.front().source, L"Game Data");
        EXPECT_EQ(readTextFile(batch.assets.front().resolvedPath), "game-texture");
    }

    TEST_F(ModFileOperationsIntegrationTests, NifPreviewPreparesTenTexturesInOneOrderedBatch)
    {
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"Ten Texture Model");
        std::vector<std::wstring> texturePaths;
        for (int index = 0; index < 10; ++index)
        {
            const std::wstring path = L"textures/armor/part" + std::to_wstring(index) + L".dds";
            texturePaths.push_back(path);
            writeTextFile(selected.id / path, "texture-" + std::to_string(index));
        }

        const NifPreviewTextureBatchResult batch = mods_.prepareNifPreviewTextures(
            project_, L"Default", selected.id, texturePaths);

        ASSERT_EQ(batch.assets.size(), 10U);
        EXPECT_TRUE(batch.missing.empty());
        for (std::size_t index = 0; index < texturePaths.size(); ++index)
        {
            EXPECT_EQ(batch.assets[index].relativePath, texturePaths[index]);
            EXPECT_EQ(batch.assets[index].source, L"Ten Texture Model");
        }

        texturePaths.resize(65, L"textures/armor/overflow.dds");
        EXPECT_THROW(
            (void)mods_.prepareNifPreviewTextures(project_, L"Default", selected.id, texturePaths),
            std::invalid_argument);
        EXPECT_THROW(
            (void)mods_.prepareNifPreviewTextures(
                project_, L"Default", selected.id, {L"../textures/armor/part0.dds"}),
            std::invalid_argument);
        EXPECT_THROW(
            (void)mods_.prepareNifPreviewTextures(
                project_, L"Default", selected.id, {L"textures/armor/part0.bmp"}),
            std::invalid_argument);
    }

    TEST_F(ModFileOperationsIntegrationTests, NifPreviewArchiveIndexAndAssetCacheReuseAndInvalidateByFingerprint)
    {
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"Archive Model");
        const std::wstring modelPath = L"meshes/armor/cuirass.nif";
        const std::wstring texturePath = L"textures/armor/cuirass.dds";
        const std::filesystem::path gameData = project_ / L"stock game" / L"Data";
        const std::filesystem::path archive = gameData / L"Textures.bsa";
        writeTextFile(project_ / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project_ / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            project_ / L".fluxora" / L"paths.json",
            "{"
            "\"gameDirectory\":\"stock game\","
            "\"modsDirectory\":\"mods\","
            "\"profilesDirectory\":\"profiles\","
            "\"downloadsDirectory\":\"downloads\","
            "\"overwriteDirectory\":\"overwrite\""
            "}");
        writeTextFile(selected.id / modelPath, "selected-model");
        writePreviewBsaArchive(archive, texturePath, bytesFromString("archive-v1"));

        const NifPreviewTextureBatchResult cold = mods_.prepareNifPreviewTextures(
            project_, L"Default", selected.id, {texturePath});
        ASSERT_EQ(cold.assets.size(), 1U);
        EXPECT_EQ(cold.archiveIndexMisses, 1U);
        EXPECT_EQ(cold.archiveAssetCacheMisses, 1U);
        EXPECT_EQ(readTextFile(cold.assets.front().resolvedPath), "archive-v1");

        const NifPreviewTextureBatchResult warm = mods_.prepareNifPreviewTextures(
            project_, L"Default", selected.id, {texturePath});
        ASSERT_EQ(warm.assets.size(), 1U);
        EXPECT_EQ(warm.archiveIndexHits, 1U);
        EXPECT_EQ(warm.archiveAssetCacheHits, 1U);
        EXPECT_EQ(warm.assets.front().resolvedPath, cold.assets.front().resolvedPath);

        writePreviewBsaArchive(archive, texturePath, bytesFromString("archive-version-two"));
        const NifPreviewTextureBatchResult changed = mods_.prepareNifPreviewTextures(
            project_, L"Default", selected.id, {texturePath});
        ASSERT_EQ(changed.assets.size(), 1U);
        EXPECT_EQ(changed.archiveIndexMisses, 1U);
        EXPECT_EQ(changed.archiveAssetCacheMisses, 1U);
        EXPECT_NE(changed.assets.front().resolvedPath, cold.assets.front().resolvedPath);
        EXPECT_EQ(readTextFile(changed.assets.front().resolvedPath), "archive-version-two");

        const std::filesystem::path cacheDirectory =
            project_ / L".fluxora" / L"cache" / L"nif-preview" / L"v1";
        ASSERT_TRUE(std::filesystem::is_directory(cacheDirectory));
        for (const auto& entry : std::filesystem::directory_iterator(cacheDirectory))
        {
            EXPECT_NE(entry.path().extension(), L".tmp");
        }
    }

    TEST_F(ModFileOperationsIntegrationTests, NifPreviewArchiveCacheEvictsLeastRecentlyUsedFiles)
    {
        const std::filesystem::path cacheDirectory =
            project_ / L".fluxora" / L"cache" / L"nif-preview" / L"v1";
        const std::filesystem::path oldAsset = cacheDirectory / L"old.dds";
        const std::filesystem::path recentAsset = cacheDirectory / L"recent.dds";
        writeTextFile(oldAsset, "123456");
        writeTextFile(recentAsset, "abcdef");
        std::filesystem::last_write_time(
            oldAsset,
            std::filesystem::file_time_type::clock::now() - std::chrono::hours(2));
        std::filesystem::last_write_time(
            recentAsset,
            std::filesystem::file_time_type::clock::now() - std::chrono::hours(1));

        enforcePreviewArchiveCacheLimit(cacheDirectory, 6);

        EXPECT_FALSE(std::filesystem::exists(oldAsset));
        EXPECT_TRUE(std::filesystem::exists(recentAsset));
    }

    TEST_F(ModFileOperationsIntegrationTests, ModPreviewAssetRejectsTraversalAndUnsupportedExtensions)
    {
        const InstalledModEntry created = mods_.createEmptyMod(project_, L"Preview Safety");

        writeTextFile(created.id / L"meshes" / L"armor" / L"cuirass.nif", "nif-bytes");
        writeTextFile(created.id / L"textures" / L"armor" / L"cuirass.dds", "dds-bytes");

        const ModPreviewAsset model =
            mods_.readPreviewAsset(project_, L"Default", created.id, L"meshes/armor/cuirass.nif", L"nif");
        EXPECT_EQ(model.kind, L"nif");
        EXPECT_EQ(model.sourceModName, L"Preview Safety");
        EXPECT_EQ(bytesToString(model.bytes), "nif-bytes");

        const ModPreviewAsset texture =
            mods_.readPreviewAsset(project_, L"Default", created.id, L"textures/armor/cuirass.dds", L"texture");
        EXPECT_EQ(texture.kind, L"texture");
        EXPECT_EQ(bytesToString(texture.bytes), "dds-bytes");

        EXPECT_THROW(
            (void)mods_.readPreviewAsset(project_, L"Default", created.id, L"../other/cuirass.nif", L"nif"),
            std::invalid_argument);
        EXPECT_THROW(
            (void)mods_.readPreviewAsset(project_, L"Default", created.id, L"meshes/armor/cuirass.exe", L"nif"),
            std::invalid_argument);
        EXPECT_THROW(
            (void)mods_.readPreviewAsset(project_, L"Default", created.id, L"textures/armor/cuirass.bmp", L"texture"),
            std::invalid_argument);
        EXPECT_THROW(
            (void)mods_.listPreviewVariants(project_, L"Default", L"../meshes/armor/cuirass.nif"),
            std::invalid_argument);
    }

    TEST_F(ModFileOperationsIntegrationTests, ModPreviewTextureResolutionUsesActiveProfileOrderWinner)
    {
        const InstalledModEntry low = mods_.createEmptyMod(project_, L"Base Texture");
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"Selected Model");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"Final Texture");

        const std::vector<ProfileModOrderItem> initialOrder =
            profileOrder_.listModOrder(project_, L"Default");
        const ProfileModOrderItem* lowOrderItem = findModOrderItem(initialOrder, L"Base Texture");
        const ProfileModOrderItem* selectedOrderItem = findModOrderItem(initialOrder, L"Selected Model");
        const ProfileModOrderItem* highOrderItem = findModOrderItem(initialOrder, L"Final Texture");
        ASSERT_NE(lowOrderItem, nullptr);
        ASSERT_NE(selectedOrderItem, nullptr);
        ASSERT_NE(highOrderItem, nullptr);
        const std::wstring lowOrderId = lowOrderItem->orderId;
        const std::wstring selectedOrderId = selectedOrderItem->orderId;
        const std::wstring highOrderId = highOrderItem->orderId;

        (void)profileOrder_.moveModOrderItem(project_, L"Default", lowOrderId, 0);
        (void)profileOrder_.moveModOrderItem(project_, L"Default", selectedOrderId, 1);
        const std::vector<ProfileModOrderItem> movedOrder =
            profileOrder_.moveModOrderItem(project_, L"Default", highOrderId, 2);
        ASSERT_EQ(movedOrder.size(), 3U);
        EXPECT_EQ(movedOrder[0].name, L"Base Texture");
        EXPECT_EQ(movedOrder[1].name, L"Selected Model");
        EXPECT_EQ(movedOrder[2].name, L"Final Texture");

        writeTextFile(selected.id / L"meshes" / L"armor" / L"cuirass.nif", "selected-model");
        writeTextFile(low.id / L"textures" / L"armor" / L"cuirass.dds", "low-texture");
        writeTextFile(selected.id / L"textures" / L"armor" / L"cuirass.dds", "selected-texture");
        writeTextFile(high.id / L"textures" / L"armor" / L"cuirass.dds", "high-texture");

        ModPreviewAsset winner =
            mods_.readPreviewAsset(project_, L"Default", selected.id, L"textures/armor/cuirass.dds", L"texture");
        EXPECT_EQ(winner.sourceModName, L"Final Texture");
        EXPECT_EQ(bytesToString(winner.bytes), "high-texture");

        mods_.setInstalledModEnabled(project_, high.id, false);
        winner =
            mods_.readPreviewAsset(project_, L"Default", selected.id, L"textures/armor/cuirass.dds", L"texture");
        EXPECT_EQ(winner.sourceModName, L"Selected Model");
        EXPECT_EQ(bytesToString(winner.bytes), "selected-texture");

        mods_.setInstalledModEnabled(project_, selected.id, false);
        winner =
            mods_.readPreviewAsset(project_, L"Default", selected.id, L"textures/armor/cuirass.dds", L"texture");
        EXPECT_EQ(winner.sourceModName, L"Base Texture");
        EXPECT_EQ(bytesToString(winner.bytes), "low-texture");
    }

    TEST_F(ModFileOperationsIntegrationTests, ModPreviewTextureResolutionUsesGameDataAndOverwrite)
    {
        const std::wstring texturePath =
            L"textures/creationclub/bgssse025/critters/FXButterflyGreen.dds";
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"Selected Model");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"Final Texture");

        writeTextFile(project_ / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project_ / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            project_ / L".fluxora" / L"paths.json",
            "{"
            "\"gameDirectory\":\"stock game\","
            "\"modsDirectory\":\"mods\","
            "\"profilesDirectory\":\"profiles\","
            "\"downloadsDirectory\":\"downloads\","
            "\"overwriteDirectory\":\"overwrite\""
            "}");
        writeTextFile(project_ / L"stock game" / L"Data" / texturePath, "game-texture");
        writeTextFile(selected.id / L"meshes" / L"creationclub" / L"bgssse025" / L"critters" /
                L"greenbutterflyhinjar.nif",
            "selected-model");
        writeTextFile(high.id / texturePath, "high-texture");

        ModPreviewAsset winner =
            mods_.readPreviewAsset(project_, L"Default", selected.id, texturePath, L"texture");
        EXPECT_EQ(winner.sourceModName, L"Final Texture");
        EXPECT_EQ(bytesToString(winner.bytes), "high-texture");

        writeTextFile(overwriteDirectory() / texturePath, "overwrite-texture");
        winner = mods_.readPreviewAsset(project_, L"Default", selected.id, texturePath, L"texture");
        EXPECT_EQ(winner.sourceModName, L"Overwrite");
        EXPECT_EQ(bytesToString(winner.bytes), "overwrite-texture");

        std::error_code removeError;
        std::filesystem::remove(overwriteDirectory() / texturePath, removeError);
        mods_.setInstalledModEnabled(project_, high.id, false);

        winner = mods_.readPreviewAsset(project_, L"Default", selected.id, texturePath, L"texture");
        EXPECT_EQ(winner.sourceModName, L"Game Data");
        EXPECT_EQ(bytesToString(winner.bytes), "game-texture");
    }

    TEST_F(ModFileOperationsIntegrationTests, ModPreviewTextureResolutionReadsGameDataBsaArchives)
    {
        const std::wstring texturePath =
            L"textures/creationclub/bgssse025/critters/FXButterflyGreen.dds";
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"Selected Model");

        writeTextFile(project_ / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project_ / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            project_ / L".fluxora" / L"paths.json",
            "{"
            "\"gameDirectory\":\"stock game\","
            "\"modsDirectory\":\"mods\","
            "\"profilesDirectory\":\"profiles\","
            "\"downloadsDirectory\":\"downloads\","
            "\"overwriteDirectory\":\"overwrite\""
            "}");
        writeTextFile(selected.id / L"meshes" / L"creationclub" / L"bgssse025" / L"critters" /
                L"greenbutterflyhinjar.nif",
            "selected-model");
        writePreviewBsaArchive(
            project_ / L"stock game" / L"Data" / L"ccBGSSSE025-AdvDSGS.bsa",
            texturePath,
            bytesFromString("bsa-texture"));

        const ModPreviewAsset winner =
            mods_.readPreviewAsset(project_, L"Default", selected.id, texturePath, L"texture");

        EXPECT_EQ(winner.sourceModName, L"Game Data Archive: ccBGSSSE025-AdvDSGS.bsa");
        EXPECT_EQ(winner.fileName, L"FXButterflyGreen.dds");
        EXPECT_EQ(bytesToString(winner.bytes), "bsa-texture");
    }

    TEST_F(ModFileOperationsIntegrationTests, ModPreviewTextureResolutionReadsPrefixedCompressedBsaArchives)
    {
        const std::wstring texturePath =
            L"textures/smim/furniture/smelter/smim_smelter_spout.dds";
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"SMIM Model");

        writeTextFile(project_ / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project_ / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            project_ / L".fluxora" / L"paths.json",
            "{"
            "\"gameDirectory\":\"stock game\","
            "\"modsDirectory\":\"mods\","
            "\"profilesDirectory\":\"profiles\","
            "\"downloadsDirectory\":\"downloads\","
            "\"overwriteDirectory\":\"overwrite\""
            "}");
        writeTextFile(
            selected.id / L"meshes" / L"_byoh" / L"clutter" / L"house crafting" / L"inventory" /
                L"invsmelter01.nif",
            "selected-model");
        writePreviewBsaArchive(
            project_ / L"stock game" / L"Data" / L"SMIM - Textures.bsa",
            texturePath,
            bytesFromString("DDS prefixed-bsa-texture"),
            true);

        const ModPreviewAsset winner =
            mods_.readPreviewAsset(project_, L"Default", selected.id, texturePath, L"texture");

        EXPECT_EQ(winner.sourceModName, L"Game Data Archive: SMIM - Textures.bsa");
        EXPECT_EQ(winner.fileName, L"smim_smelter_spout.dds");
        EXPECT_EQ(bytesToString(winner.bytes), "DDS prefixed-bsa-texture");
    }

    TEST_F(ModFileOperationsIntegrationTests, NifPreviewTextureBatchReadsGameDataBa2Archives)
    {
        const std::wstring texturePath =
            L"textures/creationclub/bgssse025/critters/FXButterflyGreen.dds";
        const InstalledModEntry selected = mods_.createEmptyMod(project_, L"Selected Model");
        const std::vector<std::uint8_t> texturePayload = bytesFromString("ba2-texture-payload");

        writeTextFile(project_ / L"stock game" / L"SkyrimSE.exe", "MZ");
        writeTextFile(project_ / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            project_ / L".fluxora" / L"paths.json",
            "{"
            "\"gameDirectory\":\"stock game\","
            "\"modsDirectory\":\"mods\","
            "\"profilesDirectory\":\"profiles\","
            "\"downloadsDirectory\":\"downloads\","
            "\"overwriteDirectory\":\"overwrite\""
            "}");
        writeTextFile(selected.id / L"meshes" / L"creationclub" / L"bgssse025" / L"critters" /
                L"greenbutterflyhinjar.nif",
            "selected-model");
        writePreviewBa2Dx10Archive(
            project_ / L"stock game" / L"Data" / L"CreationClubTextures.ba2",
            texturePath,
            texturePayload);

        const NifPreviewTextureBatchResult batch = mods_.prepareNifPreviewTextures(
            project_, L"Default", selected.id, {texturePath});

        ASSERT_EQ(batch.assets.size(), 1U);
        EXPECT_EQ(batch.assets.front().source, L"Game Data Archive: CreationClubTextures.ba2");
        const std::string bytes = readTextFile(batch.assets.front().resolvedPath);
        ASSERT_GE(bytes.size(), 128U + texturePayload.size());
        EXPECT_EQ(bytes.substr(0, 4), "DDS ");
        EXPECT_TRUE(std::equal(texturePayload.begin(), texturePayload.end(), bytes.end() - texturePayload.size()));
        EXPECT_EQ(batch.archiveIndexMisses, 1U);
        EXPECT_EQ(batch.archiveAssetCacheMisses, 1U);
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

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadRejectsTamperedContentLayoutCachePayload)
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
        const std::uintmax_t cachedPluginSize = std::filesystem::file_size(cachedPlugin);
        const std::filesystem::file_time_type cachedPluginTimestamp =
            std::filesystem::last_write_time(cachedPlugin);
        writeTextFile(cachedPlugin, "tampered-plugin");
        ASSERT_EQ(std::filesystem::file_size(cachedPlugin), cachedPluginSize);
        std::filesystem::last_write_time(cachedPlugin, cachedPluginTimestamp);
        test_hooks::alignInstallStagingCacheMetadataDigestForTest(payloads.front().parent_path());

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
        EXPECT_EQ(readTextFile(modsDirectory() / L"Cached Layout" / L"SkyUI_SE.esp"), "original-plugin");
    }

    TEST_F(ModFileOperationsIntegrationTests, InstallDownloadDoesNotReuseCacheAfterSameSizeSameTimestampArchiveReplacement)
    {
        const DownloadEntry download = importArchive(
            L"Replaced Archive.zip",
            {
                {L"Data/Replaced.esp", "original-plugin"}
            });

        try
        {
            const PlacementPlan plan = downloads_.analyzeDownloadContentLayout(
                project_,
                download.localPath,
                ExistingModInstallMode::FailIfExists);
            ASSERT_TRUE(plan.canInstall());
        }
        catch (const std::exception& exception)
        {
            if (isMissingExtractorError(exception.what()))
            {
                GTEST_SKIP() << "No supported archive extractor was available: " << exception.what();
            }
            throw;
        }

        const std::uintmax_t originalSize = std::filesystem::file_size(download.localPath);
        const std::filesystem::file_time_type originalTimestamp =
            std::filesystem::last_write_time(download.localPath);
        writeZipArchive(
            download.localPath,
            {
                {L"Data/Replaced.esp", "replaced-plugin"}
            });
        ASSERT_EQ(std::filesystem::file_size(download.localPath), originalSize);
        std::filesystem::last_write_time(download.localPath, originalTimestamp);
        ASSERT_EQ(std::filesystem::last_write_time(download.localPath), originalTimestamp);

        std::optional<InstalledMod> installed;
        std::string installError;
        try
        {
            installed = downloads_.installDownload(
                project_,
                download.localPath,
                L"Replaced Archive",
                ExistingModInstallMode::FailIfExists);
        }
        catch (const std::exception& exception)
        {
            installError = exception.what();
        }

        ASSERT_TRUE(installed.has_value()) << installError;
        EXPECT_EQ(
            readTextFile(modsDirectory() / L"Replaced Archive" / L"Replaced.esp"),
            "replaced-plugin");
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

    TEST_F(ModFileOperationsIntegrationTests, InstallFomodDownloadRemembersAppliedChoiceForNextAnalysis)
    {
        const DownloadEntry download = importArchive(
            L"Remembered FOMOD Choice.fomod",
            {
                {L"fomod/ModuleConfig.xml", R"xml(<config>
  <moduleName>Remembered FOMOD Choice</moduleName>
  <installSteps order="Explicit">
    <installStep name="Variant">
      <optionalFileGroups order="Explicit">
        <group name="Edition" type="SelectExactlyOne">
          <plugins order="Explicit">
            <plugin name="Standard">
              <files>
                <file source="standard/Remembered.esp" destination="Remembered.esp" />
              </files>
              <typeDescriptor><type name="Recommended" /></typeDescriptor>
            </plugin>
            <plugin name="Alternate">
              <files>
                <file source="alternate/Remembered.esp" destination="Remembered.esp" />
              </files>
              <typeDescriptor><type name="Optional" /></typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>)xml"},
                {L"fomod/info.xml", R"xml(<fomod><Name>Remembered FOMOD Choice</Name><Version>1.0.0</Version><Id>remembered-choice</Id></fomod>)xml"},
                {L"standard/Remembered.esp", "standard"},
                {L"alternate/Remembered.esp", "alternate"}
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
        ASSERT_EQ(descriptor.steps.size(), 1U);
        ASSERT_EQ(descriptor.steps[0].groups.size(), 1U);
        ASSERT_EQ(descriptor.steps[0].groups[0].options.size(), 2U);
        const std::wstring rememberedOptionId = descriptor.steps[0].groups[0].options[1].id;

        const InstalledMod installed = downloads_.installFomodDownload(
            project_,
            download.localPath,
            L"Remembered FOMOD Choice",
            ExistingModInstallMode::FailIfExists,
            {rememberedOptionId});
        EXPECT_FALSE(installed.id.empty());

        const FomodInstallerDescriptor replayed = downloads_.analyzeFomodDownload(
            project_,
            download.localPath);
        ASSERT_TRUE(replayed.hasPreviousSelection);
        EXPECT_NE(
            std::find(
                replayed.previousSelectedOptionIds.begin(),
                replayed.previousSelectedOptionIds.end(),
                rememberedOptionId),
            replayed.previousSelectedOptionIds.end());
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

    TEST_F(ModFileOperationsIntegrationTests, InstallFomodDownloadRejectsTamperedPackageCachePayload)
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
        const PlacementPlan layoutPlan = downloads_.analyzeFomodDownloadContentLayout(
            project_,
            download.localPath,
            ExistingModInstallMode::FailIfExists,
            {});
        ASSERT_TRUE(layoutPlan.canInstall());
        const std::vector<std::filesystem::path> payloads =
            installStagingCachePayloads(downloadsDirectory(), L"fomod-package-");
        ASSERT_EQ(payloads.size(), 1U);
        const std::filesystem::path cachedPlugin = payloads.front() / L"payload" / L"Data" / L"SkyUI_SE.esp";
        ASSERT_TRUE(std::filesystem::is_regular_file(cachedPlugin));
        const std::uintmax_t cachedPluginSize = std::filesystem::file_size(cachedPlugin);
        const std::filesystem::file_time_type cachedPluginTimestamp =
            std::filesystem::last_write_time(cachedPlugin);
        writeTextFile(cachedPlugin, "tampered-plugin");
        ASSERT_EQ(std::filesystem::file_size(cachedPlugin), cachedPluginSize);
        std::filesystem::last_write_time(cachedPlugin, cachedPluginTimestamp);

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
            "original-plugin");
    }

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
    TEST_F(ModFileOperationsIntegrationTests, AnalyzeFomodDownloadIndexesLargeZipWithoutBuildingFullPackage)
    {
        std::string moduleConfig = R"xml(<config>
  <moduleName>Large Indexed FOMOD</moduleName>
  <installSteps order="Explicit">
    <installStep name="Variants">
      <optionalFileGroups order="Explicit">
        <group name="Choices" type="SelectAny">
          <plugins order="Explicit">
)xml";
        for (int index = 0; index < 120; ++index)
        {
            moduleConfig +=
                "<plugin name=\"Variant " + std::to_string(index) +
                "\"><image path=\"fomod/images/shared.png\" /></plugin>";
        }
        moduleConfig += R"xml(
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>)xml";

        std::vector<ZipEntry> entries{
            {L"Wrapper/FoMoD/MODULECONFIG.XML", moduleConfig},
            {L"Wrapper/FoMoD/INFO.XML", R"xml(<fomod><Name>Large Indexed FOMOD</Name><Version>1.0.0</Version></fomod>)xml"},
            {L"Wrapper/FoMoD/images/shared.png", "shared-preview"}
        };
        for (int index = 0; index < 2048; ++index)
        {
            entries.push_back({
                L"Wrapper/payload/textures/generated/texture-" + std::to_wstring(index) + L".dds",
                "payload"
            });
        }
        const DownloadEntry download = importArchive(L"Large Indexed FOMOD.zip", entries);

        std::atomic_int metadataBuilds{0};
        std::atomic_int fullPackageBuilds{0};
        InstallStagingCacheProducerHookGuard hook{
            [&](std::wstring_view kind, std::wstring_view, const std::filesystem::path&)
            {
                if (kind == L"fomod-metadata")
                {
                    metadataBuilds.fetch_add(1);
                }
                else if (kind == L"fomod-package")
                {
                    fullPackageBuilds.fetch_add(1);
                }
            }};

        const FomodInstallerDescriptor descriptor =
            downloads_.analyzeFomodDownload(project_, download.localPath);

        ASSERT_TRUE(descriptor.isFomod);
        ASSERT_EQ(descriptor.steps.size(), 1U);
        ASSERT_EQ(descriptor.steps[0].groups.size(), 1U);
        EXPECT_EQ(descriptor.steps[0].groups[0].options.size(), 120U);
        EXPECT_EQ(metadataBuilds.load(), 1);
        EXPECT_EQ(fullPackageBuilds.load(), 0);
        EXPECT_TRUE(installStagingCachePayloads(downloadsDirectory(), L"fomod-package-").empty());

        const FomodInstallerDescriptor cachedDescriptor =
            downloads_.analyzeFomodDownload(project_, download.localPath);
        ASSERT_TRUE(cachedDescriptor.isFomod);
        EXPECT_EQ(cachedDescriptor.steps[0].groups[0].options.size(), 120U);
        EXPECT_EQ(metadataBuilds.load(), 1);
        EXPECT_EQ(fullPackageBuilds.load(), 0);
    }

    TEST_F(ModFileOperationsIntegrationTests, AnalyzeOrdinaryZipDoesNotBuildInstallPayload)
    {
        std::vector<ZipEntry> entries;
        for (int index = 0; index < 1024; ++index)
        {
            entries.push_back({
                L"Data/textures/generated/plain-" + std::to_wstring(index) + L".dds",
                "payload"
            });
        }
        const DownloadEntry download = importArchive(L"Large Plain Archive.zip", entries);

        std::atomic_int producerCalls{0};
        InstallStagingCacheProducerHookGuard hook{
            [&](std::wstring_view, std::wstring_view, const std::filesystem::path&)
            {
                producerCalls.fetch_add(1);
            }};

        const FomodInstallerDescriptor descriptor =
            downloads_.analyzeFomodDownload(project_, download.localPath);

        EXPECT_FALSE(descriptor.isFomod);
        EXPECT_EQ(producerCalls.load(), 0);
    }

    TEST_F(ModFileOperationsIntegrationTests, AnalyzeFomodZipRejectsTraversalBeforeMetadataExtraction)
    {
        const DownloadEntry download = importArchive(
            L"Unsafe Indexed FOMOD.zip",
            {
                {L"fomod/ModuleConfig.xml", R"xml(<config><moduleName>Unsafe</moduleName></config>)xml"},
                {L"../escaped-preview.png", "unsafe"}
            });

        EXPECT_THROW(
            (void)downloads_.analyzeFomodDownload(project_, download.localPath),
            std::runtime_error);
        EXPECT_FALSE(std::filesystem::exists(downloadsDirectory().parent_path() / L"escaped-preview.png"));
    }

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
            {L"payload/Data/SlowFomod.esp", "fomod-plugin"},
            {L"payload/Data/SlowFomod.bsa", "fomod-archive"},
            {L"payload/Data/SKSE/Plugins/SlowFomod.dll", "fomod-dll"}
        };
        for (int index = 0; index < 128; ++index)
        {
            fomodEntries.push_back({
                L"payload/textures/generated/slow-" + std::to_wstring(index) + L".dds",
                "texture"
            });
        }

        const DownloadEntry fomod = importArchive(L"Slow FOMOD Package.fomod", fomodEntries);
        const std::filesystem::path existingFomod =
            modsDirectory() / L"Slow FOMOD Previous Package";
        writeTextFile(existingFomod / L"SlowFomod.esp", "old-plugin");
        writeTextFile(existingFomod / L"SlowFomod.bsa", "old-archive");
        writeTextFile(existingFomod / L"SKSE" / L"Plugins" / L"SlowFomod.dll", "old-dll");
        InstanceMetadataStore::registerInstalledMod(
            project_,
            existingFomod,
            L"Slow FOMOD Previous Package",
            L"0.9.0",
            ModSourceRecord{L"manual"});
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

        auto fomodPlan = std::async(std::launch::async, [&]()
        {
            return downloads_.planDownloadInstall(project_, fomod.localPath);
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
            const FluxoraInstallPlan plan = fomodPlan.get();
            EXPECT_TRUE(plan.fomodInstaller.isFomod);
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
            <plugin name="With the same image again">
              <image path="FOMOD/IMAGES/OPTION.PNG" />
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
        ASSERT_EQ(2u, descriptor.steps[0].groups[0].options.size());
        ASSERT_FALSE(descriptor.moduleImagePath.empty());
        ASSERT_FALSE(descriptor.steps[0].groups[0].options[0].imagePath.empty());
        ASSERT_FALSE(descriptor.steps[0].groups[0].options[1].imagePath.empty());
        EXPECT_TRUE(std::filesystem::is_regular_file(std::filesystem::path(descriptor.moduleImagePath)));
        EXPECT_TRUE(std::filesystem::is_regular_file(std::filesystem::path(descriptor.steps[0].groups[0].options[0].imagePath)));
        EXPECT_EQ(
            descriptor.steps[0].groups[0].options[0].imagePath,
            descriptor.steps[0].groups[0].options[1].imagePath);
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

        const ModWorkspaceSnapshot persistedSnapshot =
            profileOrder_.persistedWorkspaceSnapshot(project_, L"Default");
        const ProfileModOrderItem* persistedFirst =
            findModOrderItem(persistedSnapshot.modOrder, L"Armor A");
        const ProfileModOrderItem* persistedSecond =
            findModOrderItem(persistedSnapshot.modOrder, L"Armor B");
        ASSERT_NE(persistedFirst, nullptr);
        ASSERT_NE(persistedSecond, nullptr);
        EXPECT_EQ(persistedFirst->overwrittenFileCount, 0);
        EXPECT_EQ(persistedFirst->overwritingFileCount, 1);
        EXPECT_EQ(persistedSecond->overwrittenFileCount, 1);
        EXPECT_EQ(persistedSecond->overwritingFileCount, 0);
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

    TEST_F(ModFileOperationsIntegrationTests, InstallAcceptsZipDirectoryEntriesBeforeFiles)
    {
        std::string error;
        const std::optional<InstalledMod> installed = tryInstallArchive(
            L"Directory Entries.zip",
            {
                {L"Data/", ""},
                {L"Data/textures/", ""},
                {L"Data/textures/safe.dds", "safe"}
            },
            L"Directory Entries Mod",
            error);

        if (!installed.has_value() && isMissingExtractorError(error))
        {
            GTEST_SKIP() << "No supported archive extractor was available: " << error;
        }

        ASSERT_TRUE(installed.has_value()) << error;
        const std::filesystem::path modPath = modsDirectory() / L"Directory Entries Mod";
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"textures" / L"safe.dds"));
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
