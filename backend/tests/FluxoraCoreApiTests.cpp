#include "FluxoraCore/FluxoraCoreApi.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora::tests
{
    namespace
    {
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

        std::string catalogProjectManifestWithLaunchExecutables(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& installRoot)
        {
            std::string launchExecutables;
            for (int index = 0; index < 80; ++index)
            {
                if (!launchExecutables.empty())
                {
                    launchExecutables += ",";
                }

                launchExecutables +=
                    "{\"id\":\"tool-" + std::to_string(index) + "\","
                    "\"displayName\":\"External Tool " + std::to_string(index) + "\","
                    "\"executablePath\":\"tools/ExternalTool" + std::to_string(index) + ".exe\","
                    "\"arguments\":\"--profile Default --tool-index " + std::to_string(index) + "\"}";
            }

            return "{"
                "\"schemaVersion\":\"1\","
                "\"name\":\"Large Launcher Build\","
                "\"templateId\":\"skyrimse\","
                "\"gameName\":\"Skyrim Special Edition\","
                "\"gamePath\":\"" + toUtf8((projectDirectory / L"Game").generic_wstring()) + "\","
                "\"installRoot\":\"" + toUtf8(installRoot.generic_wstring()) + "\","
                "\"projectDirectory\":\"" + toUtf8(projectDirectory.generic_wstring()) + "\","
                "\"dataDirectory\":\"Data\","
                "\"defaultProfile\":\"Default\","
                "\"launchExecutables\":[" + launchExecutables + "]"
                "}";
        }

        std::wstring copyBufferedApiOutput()
        {
            const int requiredLength = fluxora_get_last_required_buffer_length();
            EXPECT_GT(requiredLength, 0);
            std::vector<wchar_t> jsonBuffer(static_cast<std::size_t>(requiredLength));
            EXPECT_EQ(
                fluxora_copy_last_output(jsonBuffer.data(), requiredLength),
                FluxoraCoreResultOk);
            return std::wstring(jsonBuffer.data());
        }

        std::wstring lastCoreError()
        {
            std::array<wchar_t, 2048> buffer{};
            const int result = fluxora_get_last_error(buffer.data(), static_cast<int>(buffer.size()));
            EXPECT_EQ(result, FluxoraCoreResultOk);
            return std::wstring(buffer.data());
        }

        bool isMissingExtractorError(const std::wstring& error)
        {
            return error.find(L"Failed to extract archive") != std::wstring::npos;
        }
    }

    TEST(FluxoraCoreApiTests, RejectsUnknownFluxPackPackageTypeBeforeExport)
    {
        fluxora_core_shutdown();
        std::array<wchar_t, 256> output{};
        EXPECT_EQ(
            fluxora_export_fluxpack_with_options_and_progress(
                L"C:\\missing\\build.json",
                L"C:\\missing\\build.fluxpack",
                0,
                99,
                nullptr,
                nullptr,
                output.data(),
                static_cast<int>(output.size())),
            FluxoraCoreResultInvalidArgument);
        EXPECT_NE(lastCoreError().find(L"package type"), std::wstring::npos);
    }

    TEST(FluxoraCoreApiTests, ListProjectConfigsReturnsLightCatalogPayload)
    {
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path catalogDirectory = temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path installRoot = temp.path() / L"Fluxora Builds";
        const std::filesystem::path projectDirectory = installRoot / L"Large Launcher Build";
        const std::filesystem::path configPath = catalogDirectory / L"Large Launcher Build.json";

        writeTextFile(projectDirectory / L"Game" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(projectDirectory / L"Game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(configPath, catalogProjectManifestWithLaunchExecutables(projectDirectory, installRoot));

        std::array<wchar_t, 64> smallBuffer{};
        const int result = fluxora_list_project_configs(
            catalogDirectory.c_str(),
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));

        ASSERT_EQ(result, FluxoraCoreResultBufferTooSmall);
        const int requiredLength = fluxora_get_last_required_buffer_length();
        ASSERT_GT(requiredLength, static_cast<int>(smallBuffer.size()));

        std::vector<wchar_t> jsonBuffer(static_cast<std::size_t>(requiredLength));
        ASSERT_EQ(
            fluxora_copy_last_output(jsonBuffer.data(), requiredLength),
            FluxoraCoreResultOk);

        const std::wstring json(jsonBuffer.data());
        EXPECT_NE(json.find(L"Large Launcher Build"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"gameCapabilities\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"paths\""), std::wstring::npos);
        EXPECT_EQ(json.find(L"\"executables\""), std::wstring::npos);
        EXPECT_EQ(json.find(L"\"template\""), std::wstring::npos);
        EXPECT_EQ(json.find(L"tool-79"), std::wstring::npos);
        EXPECT_FALSE(std::filesystem::exists(projectDirectory / L"instance.db"));
        EXPECT_FALSE(std::filesystem::exists(projectDirectory / L"instance.db-wal"));
        EXPECT_FALSE(std::filesystem::exists(projectDirectory / L"instance.db-shm"));

        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, SkyrimModMutationsSynchronizePluginStateFiles)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Core API plugin sync test uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Skyrim Plugin Sync Build";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path skyUi = mods / L"SkyUI";
        const std::filesystem::path profilePlugins = project / L"profiles" / L"Default" / L"plugins.txt";
        const std::filesystem::path archivePath = temp.path() / L"Archives" / L"SkyUI.zip";

        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        writeZipArchive(
            archivePath,
            {
                ZipEntry{L"SkyUI_SE.esp", "plugin"}
            });

        std::array<wchar_t, 4> smallBuffer{};
        const int createResult = fluxora_create_project(
            L"Skyrim Plugin Sync Build",
            L"skyrimse",
            game.c_str(),
            installRoot.c_str(),
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        ASSERT_EQ(createResult, FluxoraCoreResultBufferTooSmall);
        EXPECT_NE(copyBufferedApiOutput().find(L"Skyrim Plugin Sync Build"), std::wstring::npos);

        const int installResult = fluxora_install_archive_with_layout(
            project.c_str(),
            archivePath.c_str(),
            L"SkyUI",
            0,
            nullptr,
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (installResult == FluxoraCoreResultCoreError && isMissingExtractorError(lastCoreError()))
        {
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(installResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        EXPECT_NE(copyBufferedApiOutput().find(L"SkyUI"), std::wstring::npos);
        const std::string afterInstallPlugins = readTextFile(profilePlugins);
        EXPECT_TRUE(std::filesystem::is_regular_file(skyUi / L"SkyUI_SE.esp"));
        EXPECT_NE(afterInstallPlugins.find("*SkyUI_SE.esp\n"), std::string::npos)
            << afterInstallPlugins;

        ASSERT_EQ(
            fluxora_set_installed_mod_enabled(project.c_str(), skyUi.c_str(), 0),
            FluxoraCoreResultOk);
        const std::string afterDisablePlugins = readTextFile(profilePlugins);
        EXPECT_EQ(afterDisablePlugins.find("SkyUI_SE.esp"), std::string::npos)
            << afterDisablePlugins;

        ASSERT_EQ(
            fluxora_set_installed_mod_enabled(project.c_str(), skyUi.c_str(), 1),
            FluxoraCoreResultOk);
        EXPECT_NE(readTextFile(profilePlugins).find("*SkyUI_SE.esp\n"), std::string::npos);

        ASSERT_EQ(
            fluxora_delete_installed_mod(project.c_str(), skyUi.c_str()),
            FluxoraCoreResultOk);
        EXPECT_EQ(readTextFile(profilePlugins).find("SkyUI_SE.esp"), std::string::npos);
        EXPECT_NE(readTextFile(profilePlugins).find("*Skyrim.esm\n"), std::string::npos);

        fluxora_core_shutdown();
#endif
    }

    TEST(FluxoraCoreApiTests, NexusDownloadInstallResponseIncludesPersistedIdentity)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Core API Nexus install response test uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Nexus Install Response Build";
        const std::filesystem::path downloadPath =
            project / L"downloads" / L"Cabbage CS Preset 1.4.0.zip";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Nexus Install Response Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        writeZipArchive(
            downloadPath,
            {
                ZipEntry{L"SKSE/Plugins/CabbagePreset.dll", "plugin"},
                ZipEntry{
                    L"fomod/info.xml",
                    "<fomod><Name>Cabbage CS Preset</Name><Version>1.4.0</Version></fomod>"}
            });
        writeTextFile(
            downloadPath.wstring() + L".fluxora.json",
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

        const int installResult = fluxora_install_download_with_layout(
            project.c_str(),
            downloadPath.c_str(),
            L"Cabbage CS Preset",
            0,
            nullptr,
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (installResult == FluxoraCoreResultCoreError && isMissingExtractorError(lastCoreError()))
        {
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(installResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());

        const std::wstring json = copyBufferedApiOutput();
        EXPECT_NE(json.find(L"\"latestVersion\":\"1.4.0\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"sourceIsNexus\":true"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"sourceProvider\":\"nexus\""), std::wstring::npos);
        EXPECT_NE(
            json.find(L"\"sourceGameDomain\":\"skyrimspecialedition\""),
            std::wstring::npos);
        EXPECT_NE(json.find(L"\"sourceModId\":\"182366\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"sourceFileId\":\"770345\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"isLocal\":false"), std::wstring::npos);

        fluxora_core_shutdown();
#endif
    }

    TEST(FluxoraCoreApiTests, PlannedInstallExportsReturnPlanRejectStaleArchiveAndInstallBothSources)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Planned install C ABI test uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Planned C ABI Build";
        const std::filesystem::path archive = project / L"downloads" / L"C ABI Identity 1.0.zip";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Planned C ABI Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        writeZipArchive(archive, {{L"Data/CAbiIdentity.esp", "first"}});
        int planResult = fluxora_plan_download_install(
            project.c_str(),
            archive.c_str(),
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (planResult == FluxoraCoreResultCoreError && isMissingExtractorError(lastCoreError()))
        {
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(planResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const std::wstring stalePlanJson = copyBufferedApiOutput();
        const JsonValue stalePlan = JsonReader::parse(stalePlanJson);
        const JsonValue* staleResolution = stalePlan.find(L"resolutionId");
        ASSERT_NE(staleResolution, nullptr);
        ASSERT_TRUE(staleResolution->isString());
        EXPECT_NE(stalePlanJson.find(L"\"resolutionKind\""), std::wstring::npos);
        EXPECT_NE(stalePlanJson.find(L"\"fomodInstaller\""), std::wstring::npos);
        EXPECT_NE(stalePlanJson.find(L"\"evidenceCodes\""), std::wstring::npos);

        writeZipArchive(archive, {{L"Data/CAbiIdentity.esp", "changed"}});
        EXPECT_EQ(
            fluxora_install_download_planned(
                project.c_str(),
                archive.c_str(),
                L"C ABI Identity",
                0,
                nullptr,
                staleResolution->asString().c_str(),
                1,
                nullptr,
                0,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultCoreError);
        EXPECT_EQ(lastCoreError(), L"install.identityPlanStale");
        EXPECT_FALSE(std::filesystem::exists(project / L"mods" / L"C ABI Identity"));

        ASSERT_EQ(
            fluxora_plan_download_install(
                project.c_str(),
                archive.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const JsonValue downloadPlan = JsonReader::parse(copyBufferedApiOutput());
        const JsonValue* downloadResolution = downloadPlan.find(L"resolutionId");
        ASSERT_NE(downloadResolution, nullptr);
        ASSERT_TRUE(downloadResolution->isString());
        const int downloadInstallResult = fluxora_install_download_planned(
            project.c_str(),
            archive.c_str(),
            L"C ABI Identity",
            0,
            nullptr,
            downloadResolution->asString().c_str(),
            1,
            nullptr,
            0,
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (downloadInstallResult == FluxoraCoreResultCoreError && isMissingExtractorError(lastCoreError()))
        {
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(downloadInstallResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        EXPECT_NE(copyBufferedApiOutput().find(L"\"name\":\"C ABI Identity\""), std::wstring::npos);

        ASSERT_EQ(
            fluxora_plan_archive_install(
                project.c_str(),
                archive.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const JsonValue archivePlan = JsonReader::parse(copyBufferedApiOutput());
        const JsonValue* archiveResolution = archivePlan.find(L"resolutionId");
        ASSERT_NE(archiveResolution, nullptr);
        ASSERT_TRUE(archiveResolution->isString());
        ASSERT_EQ(
            fluxora_install_archive_planned(
                project.c_str(),
                archive.c_str(),
                L"C ABI Identity",
                0,
                nullptr,
                archiveResolution->asString().c_str(),
                1,
                nullptr,
                0,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall)
            << toUtf8(lastCoreError());
        EXPECT_NE(copyBufferedApiOutput().find(L"C ABI Identity (2)"), std::wstring::npos);

        fluxora_core_shutdown();
#endif
    }

    TEST(FluxoraCoreApiTests, ModWorkspaceReturnsInstalledModsAndProfileOrderInOnePayload)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Core API mod workspace test uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Workspace API Build";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Workspace API Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        ASSERT_EQ(
            fluxora_create_empty_mod(
                project.c_str(),
                L"Workspace API Probe",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        ASSERT_EQ(
            fluxora_get_mod_workspace(
                project.c_str(),
                L"Default",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring json = copyBufferedApiOutput();
        EXPECT_NE(json.find(L"\"installedMods\":["), std::wstring::npos);
        EXPECT_NE(json.find(L"\"modOrder\":["), std::wstring::npos);
        EXPECT_NE(json.find(L"Workspace API Probe"), std::wstring::npos);

        ASSERT_EQ(
            fluxora_get_persisted_mod_workspace(
                project.c_str(),
                L"Default",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring persistedJson = copyBufferedApiOutput();
        EXPECT_NE(persistedJson.find(L"\"installedMods\":["), std::wstring::npos);
        EXPECT_NE(persistedJson.find(L"\"modOrder\":["), std::wstring::npos);
        EXPECT_NE(persistedJson.find(L"Workspace API Probe"), std::wstring::npos);

        fluxora_core_shutdown();
#endif
    }

    TEST(FluxoraCoreApiTests, PersistedPluginsReturnsSerializedProfileStateWithoutDiskDiscovery)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Core API persisted plugin test uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Persisted Plugins API Build";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Persisted Plugins API Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        writeTextFile(
            project / L"mods" / L"Offline Disk Mod" / L"Data" / L"OfflineOnly.esp",
            "disk-only plugin");

        ASSERT_EQ(
            fluxora_get_persisted_plugins(
                project.c_str(),
                L"skyrimse",
                L"Default",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring json = copyBufferedApiOutput();
        EXPECT_NE(json.find(L"\"kind\":\"plugin\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"name\":\"Skyrim.esm\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"isEnabled\":true"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"isMaster\":true"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"isLocked\":true"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"missingMasters\":[]"), std::wstring::npos);
        EXPECT_EQ(json.find(L"OfflineOnly.esp"), std::wstring::npos);

        fluxora_core_shutdown();
#endif
    }

    TEST(FluxoraCoreApiTests, DownloadsApiReturnsVisibleArchiveAndCleansLegacyStateBackup)
    {
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path projectDirectory = temp.path() / L"Build";
        const std::filesystem::path downloadsDirectory = projectDirectory / L"downloads";
        writeTextFile(downloadsDirectory / L"Cabbage CS Preset.7z", "archive");
        writeTextFile(downloadsDirectory / L".fb16ecc071", "legacy download state backup");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_get_downloads(
                projectDirectory.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);

        const std::wstring json = copyBufferedApiOutput();
        EXPECT_NE(json.find(L"\"fileName\":\"Cabbage CS Preset.7z\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"name\":\"Cabbage CS Preset\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"canInstall\":true"), std::wstring::npos);
        EXPECT_FALSE(std::filesystem::exists(downloadsDirectory / L".fb16ecc071"));

        fluxora_core_shutdown();
    }
}
