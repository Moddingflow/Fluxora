#include "FluxoraCore/FluxoraCoreApi.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <future>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <shlobj.h>
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

        std::wstring fromUtf8(const std::string& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0);
            if (size <= 0)
            {
                throw std::runtime_error("Invalid UTF-8 test input.");
            }
            std::wstring out(static_cast<std::size_t>(size), L'\0');
            MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size);
            return out;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

#ifdef _WIN32
        std::filesystem::path currentTestExecutablePath()
        {
            std::wstring path(32'768, L'\0');
            const DWORD length = GetModuleFileNameW(
                nullptr,
                path.data(),
                static_cast<DWORD>(path.size()));
            if (length == 0 || length >= path.size())
            {
                throw std::runtime_error("Current test executable path is unavailable.");
            }
            path.resize(length);
            return std::filesystem::path(path);
        }
#endif

        struct InstallProgressCapture
        {
            std::filesystem::path targetDirectory;
            std::vector<std::wstring> payloads;
            bool readyObservedBeforeTargetCommit{false};
        };

        void FLUXORA_CORE_CALL captureProgressJson(
            const wchar_t* progressJson,
            void* userData)
        {
            if (progressJson == nullptr || userData == nullptr)
            {
                return;
            }
            auto& capture = *static_cast<InstallProgressCapture*>(userData);
            capture.payloads.emplace_back(progressJson);
            if (capture.payloads.back().find(L"\"state\":\"ready\"") != std::wstring::npos &&
                !capture.targetDirectory.empty() &&
                !std::filesystem::exists(capture.targetDirectory))
            {
                capture.readyObservedBeforeTargetCommit = true;
            }
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

        void appendU16(std::string& value, std::uint16_t number)
        {
            value.push_back(static_cast<char>(number & 0xFFU));
            value.push_back(static_cast<char>((number >> 8) & 0xFFU));
        }

        void appendU32(std::string& value, std::uint32_t number)
        {
            value.push_back(static_cast<char>(number & 0xFFU));
            value.push_back(static_cast<char>((number >> 8) & 0xFFU));
            value.push_back(static_cast<char>((number >> 16) & 0xFFU));
            value.push_back(static_cast<char>((number >> 24) & 0xFFU));
        }

        std::string tes4PluginBytes(const std::vector<std::string>& masters)
        {
            std::string payload;
            for (const std::string& master : masters)
            {
                payload += "MAST";
                appendU16(payload, static_cast<std::uint16_t>(master.size() + 1));
                payload += master;
                payload.push_back('\0');
            }
            std::string bytes = "TES4";
            appendU32(bytes, static_cast<std::uint32_t>(payload.size()));
            bytes.resize(24, '\0');
            bytes += payload;
            return bytes;
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
                "\"externalProviderGameSlugs\":{\"moddingflow\":[\"skyrim-se-ae\",\"skyrim-se\"]},"
                "\"defaultProfile\":\"Catalog Profile\","
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

        std::wstring callBuildFiles(
            std::wstring_view method,
            const std::wstring& params)
        {
            std::array<wchar_t, 256> initial{};
            const int result = fluxora_build_files_request(
                std::wstring(method).c_str(),
                params.c_str(),
                initial.data(),
                static_cast<int>(initial.size()));
            if (result == FluxoraCoreResultBufferTooSmall)
            {
                return copyBufferedApiOutput();
            }
            if (result != FluxoraCoreResultOk)
            {
                throw std::runtime_error(toUtf8(lastCoreError()));
            }
            return std::wstring(initial.data());
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

    TEST(FluxoraCoreApiTests, TemplateSerializationCarriesExternalProviderGameSlugAllowlist)
    {
        fluxora_core_shutdown();
        std::array<wchar_t, 2> buffer{};

        ASSERT_EQ(
            fluxora_get_game_templates(buffer.data(), static_cast<int>(buffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring listed = copyBufferedApiOutput();
        EXPECT_NE(
            listed.find(
                L"\"externalProviderGameSlugs\":{\"moddingflow\":[\"skyrim-se-ae\",\"skyrim-se\"]}"),
            std::wstring::npos);
        EXPECT_NE(
            listed.find(
                L"\"executableName\":\"SkyrimSE.exe\",\"role\":\"primary\""),
            std::wstring::npos);
        EXPECT_NE(listed.find(L"\"isPrimary\":true"), std::wstring::npos);

        ASSERT_EQ(
            fluxora_resolve_template(
                L"skyrimse",
                buffer.data(),
                static_cast<int>(buffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring resolved = copyBufferedApiOutput();
        EXPECT_NE(
            resolved.find(
                L"\"externalProviderGameSlugs\":{\"moddingflow\":[\"skyrim-se-ae\",\"skyrim-se\"]}"),
            std::wstring::npos);

        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, BuildFilesAdapterKeepsOpaqueRefsAndTypedErrors)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        const std::filesystem::path game = temp.path() / L"Game";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        std::array<wchar_t, 4> createBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"AI Workspace",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                createBuffer.data(),
                static_cast<int>(createBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const JsonValue created = JsonReader::parse(copyBufferedApiOutput());
        const JsonValue* projectDirectory = created.find(L"projectDirectory");
        ASSERT_NE(projectDirectory, nullptr);
        const std::filesystem::path project(projectDirectory->asString());
        const std::filesystem::path file = project / L"mods" / L"Example" / L"settings.json";
        writeTextFile(file, "{\"enabled\":false}\n");

        JsonWriter begin;
        begin.beginObject()
            .field(L"chatId", L"chat-api")
            .field(L"projectDirectory", project.wstring())
            .endObject();
        EXPECT_NE(callBuildFiles(L"beginChat", begin.str()).find(L"\"active\":true"), std::wstring::npos);

        JsonWriter search;
        search.beginObject()
            .field(L"chatId", L"chat-api")
            .field(L"scope", L"build")
            .field(L"query", L"settings.json")
            .field(L"limit", 20)
            .endObject();
        const JsonValue searchResult = JsonReader::parse(callBuildFiles(L"search", search.str()));
        ASSERT_NE(searchResult.find(L"entries"), nullptr);
        ASSERT_EQ(searchResult.find(L"entries")->asArray().size(), 1u);
        const JsonValue& metadata = searchResult.find(L"entries")->asArray().front();
        const std::wstring fileRef = metadata.find(L"fileRef")->asString();
        const std::wstring indexRevision = metadata.find(L"indexRevision")->asString();
        EXPECT_FALSE(fileRef.empty());
        EXPECT_FALSE(indexRevision.empty());
        EXPECT_EQ(fileRef.find(project.wstring()), std::wstring::npos);

        JsonWriter read;
        read.beginObject()
            .field(L"chatId", L"chat-api")
            .field(L"fileRef", fileRef)
            .field(L"startLine", 1)
            .field(L"maxLines", 120)
            .field(L"maxBytes", 8192)
            .endObject();
        const JsonValue readResult = JsonReader::parse(callBuildFiles(L"readText", read.str()));
        const std::wstring hash = readResult.find(L"sha256")->asString();
        EXPECT_FALSE(hash.empty());

        JsonWriter apply;
        apply.beginObject()
            .field(L"chatId", L"chat-api")
            .field(L"runId", L"run-api")
            .field(L"operationId", L"operation-api")
            .key(L"mutations").beginArray()
                .beginObject()
                    .field(L"kind", L"patch")
                    .field(L"fileRef", fileRef)
                    .field(L"revision", indexRevision)
                    .field(L"baseSha256", hash)
                    .field(L"expectedText", L"\"enabled\":false")
                    .field(L"replacementText", L"\"enabled\":true")
                    .field(L"format", L"json")
                .endObject()
            .endArray()
            .endObject();
        const std::wstring changeSet = callBuildFiles(L"apply", apply.str());
        EXPECT_NE(changeSet.find(L"fluxora.ai.file-change-set.v1"), std::wstring::npos);
        EXPECT_EQ(readTextFile(file), "{\"enabled\":false}\n");
        EXPECT_EQ(
            readTextFile(project / L"mods" / L"Fluxora AI Overrides" / L"settings.json"),
            "{\"enabled\":true}\n");

        JsonWriter unknown;
        unknown.beginObject()
            .field(L"chatId", L"chat-api")
            .field(L"fileRef", L"fileRef_invented")
            .endObject();
        std::array<wchar_t, 256> errorBuffer{};
        EXPECT_EQ(
            fluxora_build_files_request(
                L"stat",
                unknown.str().c_str(),
                errorBuffer.data(),
                static_cast<int>(errorBuffer.size())),
            FluxoraCoreResultCoreError);
        EXPECT_TRUE(lastCoreError().starts_with(L"build-files:outside-scope:"));

        fluxora_core_shutdown();
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
        EXPECT_NE(
            json.find(
                L"\"externalProviderGameSlugs\":{\"moddingflow\":[\"skyrim-se-ae\",\"skyrim-se\"]}"),
            std::wstring::npos);
        EXPECT_NE(
            json.find(L"\"defaultProfile\":\"Catalog Profile\""),
            std::wstring::npos);
        EXPECT_NE(json.find(L"\"paths\""), std::wstring::npos);
        EXPECT_EQ(json.find(L"\"executables\""), std::wstring::npos);
        EXPECT_EQ(json.find(L"\"template\""), std::wstring::npos);
        EXPECT_EQ(json.find(L"tool-79"), std::wstring::npos);
        EXPECT_FALSE(std::filesystem::exists(projectDirectory / L"instance.db"));
        EXPECT_FALSE(std::filesystem::exists(projectDirectory / L"instance.db-wal"));
        EXPECT_FALSE(std::filesystem::exists(projectDirectory / L"instance.db-shm"));

        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, DiscoverGameInstallsCarriesOperationIdentityAndValidatedFluxoraPath)
    {
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path catalogDirectory = temp.path() / L"AppData" / L"Fluxora" / L"Builds";
        const std::filesystem::path installRoot = temp.path() / L"Fluxora Builds";
        const std::filesystem::path projectDirectory = installRoot / L"Discovery Build";
        const std::filesystem::path gameDirectory = projectDirectory / L"Game";
        const std::filesystem::path configPath = catalogDirectory / L"Discovery Build.json";

        writeTextFile(gameDirectory / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(gameDirectory / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(configPath, catalogProjectManifestWithLaunchExecutables(projectDirectory, installRoot));

        std::array<wchar_t, 64> smallBuffer{};
        ASSERT_EQ(
            fluxora_discover_game_installs(
                catalogDirectory.c_str(),
                L"op_discovery_api",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring json = copyBufferedApiOutput();

        EXPECT_NE(json.find(L"\"operationId\":\"op_discovery_api\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"templateId\":\"skyrimse\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"resolution\":\"found\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"providerId\":\"fluxora\""), std::wstring::npos);
        EXPECT_NE(json.find((gameDirectory / L"SkyrimSE.exe").filename().wstring()), std::wstring::npos);

        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, DiscoverGameInstallsRejectsMissingTrustedInputs)
    {
        std::array<wchar_t, 64> buffer{};
        EXPECT_EQ(
            fluxora_discover_game_installs(L"", L"op_discovery_api", buffer.data(), 64),
            FluxoraCoreResultInvalidArgument);
        EXPECT_EQ(
            fluxora_discover_game_installs(L"C:\\Fluxora\\Builds", L"", buffer.data(), 64),
            FluxoraCoreResultInvalidArgument);
    }

    TEST(FluxoraCoreApiTests, ManagedExecutableDtoIsAdditiveAndCompletionErrorsStayTyped)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"Managed Build";
        const std::filesystem::path config = temp.path() / L"configs" / L"managed.json";
        writeTextFile(project / L"stock game" / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(
            project / L"mods" / L"BodySlide" / L"CalienteTools" / L"BodySlide" /
                L"BodySlide x64.exe",
            "MZ");
        writeTextFile(
            project / L"mods" / L"DynDOLOD" / L"TexGenx64.exe",
            "MZ");
        writeTextFile(
            project / L"mods" / L"DynDOLOD" / L"DynDOLODx64.exe",
            "MZ");
        writeTextFile(
            config,
            "{"
            "\"id\":\"managed\",\"name\":\"Managed Build\","
            "\"gameId\":\"skyrimse\",\"templateId\":\"skyrimse\","
            "\"projectDirectory\":\"" + toUtf8(project.generic_wstring()) + "\","
            "\"gamePath\":\"stock game\",\"dataDirectory\":\"Data\","
            "\"defaultProfile\":\"Default\",\"launchExecutables\":[{"
            "\"id\":\"bodyslide\",\"displayName\":\"BodySlide\","
            "\"executablePath\":\"mods/BodySlide/CalienteTools/BodySlide/BodySlide x64.exe\","
            "\"arguments\":\"\",\"workingDirectory\":\"\"},{"
            "\"id\":\"texgen\",\"displayName\":\"TexGen\","
            "\"executablePath\":\"mods/DynDOLOD/TexGenx64.exe\","
            "\"arguments\":\"\",\"workingDirectory\":\"\"},{"
            "\"id\":\"dyndolod\",\"displayName\":\"DynDOLOD\","
            "\"executablePath\":\"mods/DynDOLOD/DynDOLODx64.exe\","
            "\"arguments\":\"\",\"workingDirectory\":\"\"}]}"
        );

        std::array<wchar_t, 16> smallBuffer{};
        ASSERT_EQ(
            fluxora_get_game_executables(
                config.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const std::wstring listed = copyBufferedApiOutput();
        EXPECT_NE(listed.find(L"\"managedToolKind\":\"bodySlide\""), std::wstring::npos);
        EXPECT_NE(listed.find(L"\"managedToolKind\":\"texGen\""), std::wstring::npos);
        EXPECT_NE(listed.find(L"\"managedToolKind\":\"dynDoLod\""), std::wstring::npos);

        std::array<wchar_t, 256> completion{};
        EXPECT_EQ(
            fluxora_complete_managed_executable_launch(
                L"missing-session",
                L"completed",
                completion.data(),
                static_cast<int>(completion.size())),
            FluxoraCoreResultCoreError);
        EXPECT_TRUE(lastCoreError().starts_with(
            L"bodyslide:BODYSLIDE_SESSION_NOT_FOUND:"));
        EXPECT_EQ(
            fluxora_complete_managed_executable_launch(
                L"lodgen-texGen-missing",
                L"completed",
                completion.data(),
                static_cast<int>(completion.size())),
            FluxoraCoreResultCoreError);
        EXPECT_TRUE(lastCoreError().starts_with(
            L"lod-generator:LOD_GENERATOR_SESSION_NOT_FOUND:"));
        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, ExecutableInspectionAndPrimaryUpdateReturnTypedCanonicalPayloads)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path executable = temp.path() / L"skse64_loader.exe";
        writeTextFile(executable, "MZ executable stub");
        const std::filesystem::path config = temp.path() / L"Build" / L"build.json";
        writeTextFile(temp.path() / L"Build" / L"Stock Game" / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(
            config,
            "{\"schemaVersion\":\"1\",\"name\":\"Build\","
            "\"templateId\":\"skyrimse\",\"gameName\":\"Skyrim Special Edition\","
            "\"gamePath\":\"Stock Game\",\"dataDirectory\":\"Data\","
            "\"defaultProfile\":\"Default\",\"launchExecutables\":["
            "{\"id\":\"custom\",\"displayName\":\"Manual\","
            "\"executablePath\":\"custom.exe\",\"arguments\":\"--private\","
            "\"workingDirectory\":\"\"},"
            "{\"id\":\"game\",\"displayName\":\"Game name\","
            "\"executablePath\":\"Stock Game\\\\SkyrimSE.exe\",\"arguments\":\"\","
            "\"workingDirectory\":\"\"}]}"
        );

        std::array<wchar_t, 8> smallBuffer{};
        ASSERT_EQ(
            fluxora_inspect_executable(
                config.c_str(),
                executable.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue inspection = JsonReader::parse(copyBufferedApiOutput());
        ASSERT_NE(inspection.find(L"executablePath"), nullptr);
        ASSERT_NE(inspection.find(L"suggestedDisplayName"), nullptr);
        ASSERT_NE(inspection.find(L"displayNameSource"), nullptr);
        ASSERT_NE(inspection.find(L"iconPath"), nullptr);
        EXPECT_EQ(inspection.find(L"suggestedDisplayName")->asString(), L"SKSE");
        EXPECT_EQ(inspection.find(L"displayNameSource")->asString(), L"file-name");

        constexpr const wchar_t* projectRelativeExecutable = L"Stock Game\\SkyrimSE.exe";
        ASSERT_EQ(
            fluxora_inspect_executable(
                config.c_str(),
                projectRelativeExecutable,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue projectRelativeInspection = JsonReader::parse(copyBufferedApiOutput());
        EXPECT_EQ(
            projectRelativeInspection.find(L"executablePath")->asString(),
            projectRelativeExecutable);

        const std::filesystem::path nextPrimary = temp.path() / L"New Game" / L"SkyrimSE.exe";
        ASSERT_EQ(
            fluxora_update_primary_game_executable(
                config.c_str(),
                nextPrimary.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue updated = JsonReader::parse(copyBufferedApiOutput());
        ASSERT_TRUE(updated.isArray());
        ASSERT_EQ(updated.asArray().size(), 2u);
        EXPECT_EQ(updated.asArray()[0].find(L"id")->asString(), L"custom");
        EXPECT_EQ(updated.asArray()[0].find(L"displayName")->asString(), L"Manual");
        EXPECT_EQ(updated.asArray()[0].find(L"arguments")->asString(), L"--private");
        EXPECT_EQ(updated.asArray()[1].find(L"id")->asString(), L"game");
        EXPECT_EQ(updated.asArray()[1].find(L"executablePath")->asString(), nextPrimary.wstring());
        fluxora_core_shutdown();
    }

#if defined(_WIN32) && defined(_WIN64)
    TEST(FluxoraCoreApiTests, BodySlideVfsProbeReadsActiveModAndWritesOnlyManagedOutput)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        const std::filesystem::path game = temp.path() / L"Source Game";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"BodySlide VFS Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue created = JsonReader::parse(copyBufferedApiOutput());
        const std::filesystem::path project(created.find(L"projectDirectory")->asString());
        const std::filesystem::path config(created.find(L"configPath")->asString());
        const std::filesystem::path gameData =
            std::filesystem::path(created.find(L"gamePath")->asString()) / L"Data";

        ASSERT_EQ(
            fluxora_create_empty_mod(
                project.c_str(),
                L"Active Shapes",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());
        const std::filesystem::path activeMod = project / L"mods" / L"Active Shapes";
        writeTextFile(activeMod / L"meshes" / L"source.nif", "from-active-mod");

        ASSERT_EQ(
            fluxora_create_empty_mod(
                project.c_str(),
                L"BodySlide",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());
        const std::filesystem::path toolDirectory =
            project / L"mods" / L"BodySlide" / L"CalienteTools" / L"BodySlide";
        const std::filesystem::path probeStatus = temp.path() / L"bodyslide-vfs-probe-status.txt";
        const std::filesystem::path probeSource =
            std::filesystem::path(currentTestExecutablePath()).parent_path() /
            L"FluxoraBodySlideVfsProbe.exe";
        ASSERT_TRUE(std::filesystem::is_regular_file(probeSource));
        const std::filesystem::path bodySlideExecutable = toolDirectory / L"BodySlide x64.exe";
        std::filesystem::create_directories(bodySlideExecutable.parent_path());
        std::filesystem::copy_file(
            probeSource,
            bodySlideExecutable,
            std::filesystem::copy_options::overwrite_existing);
        writeTextFile(toolDirectory / L"res" / L"xrc" / L"BodySlide.xrc", "resource");
        ASSERT_EQ(fluxora_set_all_installed_mods_enabled(project.c_str(), 1), FluxoraCoreResultOk);

        JsonWriter executables;
        executables.beginArray()
            .beginObject()
                .field(L"id", L"bodyslide")
                .field(L"displayName", L"BodySlide")
                .field(L"executablePath", bodySlideExecutable.wstring())
                .field(
                    L"arguments",
                    L"\"" + gameData.generic_wstring() + L"/\" \"" + probeStatus.wstring() + L"\"")
                .field(L"workingDirectory", toolDirectory.wstring())
                .field(L"iconPath", L"")
                .field(L"managedToolKind", L"bodySlide")
            .endObject()
            .endArray();
        ASSERT_EQ(
            fluxora_save_game_executables(
                config.c_str(),
                executables.str().c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());

        ASSERT_EQ(
            fluxora_launch_game_executable(
                config.c_str(),
                L"bodyslide",
                L"Default",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue launch = JsonReader::parse(copyBufferedApiOutput());
        ASSERT_NE(launch.find(L"managedSessionId"), nullptr);
        ASSERT_NE(launch.find(L"outputMod"), nullptr);
        const JsonValue& outputMod = *launch.find(L"outputMod");
        const std::filesystem::path output(outputMod.find(L"path")->asString());
        const std::uint32_t processId = static_cast<std::uint32_t>(
            std::stoul(launch.find(L"processId")->asNumber()));
        const HANDLE process = OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            FALSE,
            processId);
        if (process != nullptr)
        {
            ASSERT_EQ(WaitForSingleObject(process, 30'000), WAIT_OBJECT_0);
            DWORD exitCode = 0;
            ASSERT_TRUE(GetExitCodeProcess(process, &exitCode));
            CloseHandle(process);
            ASSERT_EQ(exitCode, 0U);
        }
        else
        {
            EXPECT_EQ(GetLastError(), static_cast<DWORD>(ERROR_INVALID_PARAMETER));
        }

        for (int attempt = 0;
             attempt < 100 && !std::filesystem::exists(output / L"meshes" / L"created.nif");
             ++attempt)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        ASSERT_TRUE(std::filesystem::is_regular_file(probeStatus));
        EXPECT_EQ(readTextFile(probeStatus), "ok");
        EXPECT_EQ(readTextFile(activeMod / L"meshes" / L"source.nif"), "from-active-mod");
        const std::filesystem::path rewrittenOutput = output / L"meshes" / L"source.nif";
        const std::filesystem::path createdOutput = output / L"meshes" / L"created.nif";
        if (!std::filesystem::is_regular_file(rewrittenOutput) ||
            !std::filesystem::is_regular_file(createdOutput))
        {
            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::recursive_directory_iterator(project))
            {
                std::cerr << "BodySlide VFS diagnostic: " << entry.path().string() << '\n';
            }
        }
        EXPECT_TRUE(std::filesystem::is_regular_file(rewrittenOutput));
        EXPECT_TRUE(std::filesystem::is_regular_file(createdOutput));
        if (std::filesystem::is_regular_file(rewrittenOutput))
        {
            EXPECT_EQ(readTextFile(rewrittenOutput), "rewritten-by-probe");
        }
        if (std::filesystem::is_regular_file(createdOutput))
        {
            EXPECT_EQ(readTextFile(createdOutput), "created-by-probe");
        }
        EXPECT_FALSE(std::filesystem::exists(project / L"overwrite" / L"meshes" / L"source.nif"));
        EXPECT_FALSE(std::filesystem::exists(project / L"overwrite" / L"root" / L"Datameshes"));
        EXPECT_FALSE(std::filesystem::exists(gameData / L"meshes" / L"source.nif"));

        std::array<wchar_t, 2048> completion{};
        EXPECT_EQ(
            fluxora_complete_managed_executable_launch(
                launch.find(L"managedSessionId")->asString().c_str(),
                L"completed",
                completion.data(),
                static_cast<int>(completion.size())),
            FluxoraCoreResultOk) << toUtf8(lastCoreError());
        EXPECT_NE(std::wstring(completion.data()).find(L"\"finalized\":true"), std::wstring::npos);
        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, TexGenVfsProbeUsesManagedArgumentsAndPublishesAtomically)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        const std::filesystem::path game = temp.path() / L"Source Game";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"TexGen VFS Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue created = JsonReader::parse(copyBufferedApiOutput());
        const std::filesystem::path project(created.find(L"projectDirectory")->asString());
        const std::filesystem::path config(created.find(L"configPath")->asString());
        const std::filesystem::path gameData =
            std::filesystem::path(created.find(L"gamePath")->asString()) / L"Data";

        ASSERT_EQ(
            fluxora_create_empty_mod(
                project.c_str(),
                L"Active Textures",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());
        writeTextFile(
            project / L"mods" / L"Active Textures" / L"textures" / L"active-source.dds",
            "active-profile-source");

        const std::filesystem::path toolDirectory = project / L"mods" / L"DynDOLOD";
        const std::filesystem::path probeSource =
            std::filesystem::path(currentTestExecutablePath()).parent_path() /
            L"FluxoraLodGeneratorVfsProbe.exe";
        ASSERT_TRUE(std::filesystem::is_regular_file(probeSource));
        const std::filesystem::path texGenExecutable = toolDirectory / L"TexGenx64.exe";
        std::filesystem::create_directories(toolDirectory);
        std::filesystem::copy_file(
            probeSource,
            texGenExecutable,
            std::filesystem::copy_options::overwrite_existing);
        ASSERT_EQ(fluxora_set_all_installed_mods_enabled(project.c_str(), 1), FluxoraCoreResultOk);

        const std::filesystem::path probeStatus = temp.path() / L"texgen-vfs-probe-status.txt";
        JsonWriter executables;
        executables.beginArray()
            .beginObject()
                .field(L"id", L"texgen")
                .field(L"displayName", L"TexGen")
                .field(L"executablePath", texGenExecutable.wstring())
                .field(
                    L"arguments",
                    LR"(-D:\"E:\\\\Foundation Edition\\\\Stock Game\\\\Data\\\" -tes5\n -o:\"C:\\old-output\\\")" +
                        std::wstring(L" --fluxora-probe-status \"") +
                        probeStatus.wstring() + L"\" --fluxora-expected-game-data \"" +
                        gameData.wstring() + L"\"")
                .field(L"workingDirectory", toolDirectory.wstring())
                .field(L"iconPath", L"")
            .endObject()
            .endArray();
        ASSERT_EQ(
            fluxora_save_game_executables(
                config.c_str(),
                executables.str().c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());

        ASSERT_EQ(
            fluxora_launch_game_executable(
                config.c_str(),
                L"texgen",
                L"Default",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue launch = JsonReader::parse(copyBufferedApiOutput());
        ASSERT_EQ(launch.find(L"managedToolKind")->asString(), L"texGen");
        ASSERT_NE(launch.find(L"managedSessionId"), nullptr);
        ASSERT_NE(launch.find(L"outputMod"), nullptr);
        const std::filesystem::path output(
            launch.find(L"outputMod")->find(L"path")->asString());
        EXPECT_EQ(output.filename(), L"TexGen VFS Build - TexGen Output");
        EXPECT_FALSE(std::filesystem::exists(
            project / L"mods" / L"TexGen VFS Build - DynDOLOD Output"));
        writeTextFile(output / L"prior-output.marker", "preserve-until-success");

        const std::uint32_t processId = static_cast<std::uint32_t>(
            std::stoul(launch.find(L"processId")->asNumber()));
        const HANDLE process = OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            FALSE,
            processId);
        ASSERT_NE(process, nullptr);
        ASSERT_EQ(WaitForSingleObject(process, 30'000), WAIT_OBJECT_0);
        DWORD exitCode = 0;
        ASSERT_TRUE(GetExitCodeProcess(process, &exitCode));
        CloseHandle(process);
        ASSERT_EQ(exitCode, 0U)
            << (std::filesystem::is_regular_file(probeStatus)
                    ? readTextFile(probeStatus)
                    : "probe status missing");

        ASSERT_TRUE(std::filesystem::is_regular_file(probeStatus));
        const std::string status = readTextFile(probeStatus);
        EXPECT_TRUE(status.starts_with("ok|C:\\Fluxora Tool Output\\")) << status;
        EXPECT_NE(status.find("TexGen VFS Build - TexGen Output"), std::string::npos) << status;
        EXPECT_EQ(status.find(project.string()), std::string::npos);
        EXPECT_EQ(readTextFile(output / L"prior-output.marker"), "preserve-until-success");
        EXPECT_FALSE(std::filesystem::exists(output / L"meshes" / L"texgen-output.nif"));

        std::array<wchar_t, 2048> completion{};
        ASSERT_EQ(
            fluxora_complete_managed_executable_launch(
                launch.find(L"managedSessionId")->asString().c_str(),
                L"completed",
                completion.data(),
                static_cast<int>(completion.size())),
            FluxoraCoreResultOk) << toUtf8(lastCoreError());
        EXPECT_NE(std::wstring(completion.data()).find(L"\"finalized\":true"), std::wstring::npos);
        EXPECT_FALSE(std::filesystem::exists(output / L"prior-output.marker"));
        EXPECT_EQ(
            readTextFile(output / L"meshes" / L"texgen-output.nif"),
            "generated-through-managed-o");
        EXPECT_FALSE(std::filesystem::exists(gameData / L"meshes" / L"texgen-output.nif"));
        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, UniversalVfsProbeExercisesRealInjectedWindowsSemantics)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        const std::filesystem::path game = temp.path() / L"Source Game";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path status = temp.path() / L"universal-vfs-status.txt";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        const std::filesystem::path probeSource =
            std::filesystem::path(currentTestExecutablePath()).parent_path() /
            L"FluxoraUniversalVfsProbe.exe";
        ASSERT_TRUE(std::filesystem::is_regular_file(probeSource));
        const std::filesystem::path probeExecutable = game / L"FluxoraUniversalVfsProbe.exe";
        std::filesystem::create_directories(game);
        std::filesystem::copy_file(
            probeSource,
            probeExecutable,
            std::filesystem::copy_options::overwrite_existing);

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Universal VFS Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue created = JsonReader::parse(copyBufferedApiOutput());
        const std::filesystem::path project(created.find(L"projectDirectory")->asString());
        const std::filesystem::path config(created.find(L"configPath")->asString());

        wchar_t documentsPath[MAX_PATH]{};
        ASSERT_TRUE(SUCCEEDED(SHGetFolderPathW(
            nullptr,
            CSIDL_PERSONAL,
            nullptr,
            SHGFP_TYPE_CURRENT,
            documentsPath)));
        const std::wstring profileIniName =
            L"FluxoraProfileMountProbe-" + std::to_wstring(GetCurrentProcessId()) + L".ini";
        const std::filesystem::path profileApiIni =
            std::filesystem::path(documentsPath) /
            L"My Games" /
            L"Skyrim Special Edition" /
            profileIniName;
        writeTextFile(
            project / L"profiles" / L"Default" / profileIniName,
            "[General]\nsLanguage=RUSSIAN\n");

        wchar_t localAppDataPath[MAX_PATH]{};
        ASSERT_TRUE(SUCCEEDED(SHGetFolderPathW(
            nullptr,
            CSIDL_LOCAL_APPDATA,
            nullptr,
            SHGFP_TYPE_CURRENT,
            localAppDataPath)));
        // plugins.txt is a profile-owned state file: the game reads and rewrites
        // it at the Local AppData path while Fluxora maintains the profile copy.
        const std::filesystem::path ownedProfileStateFile =
            std::filesystem::path(localAppDataPath) /
            L"Skyrim Special Edition" /
            L"plugins.txt";
        const std::filesystem::path profilePluginsFile =
            project / L"profiles" / L"Default" / L"plugins.txt";
        const std::filesystem::path profileStateFork =
            project / L".flow/vfs/profile-overwrite/Default/local-appdata/plugins.txt";
        // A fork left behind by an older Fluxora build must lose to the profile
        // copy and be quarantined instead of silently shadowing it.
        writeTextFile(profileStateFork, "*Stale.esp\n");

        ASSERT_EQ(
            fluxora_create_empty_mod(
                project.c_str(),
                L"Low Universal",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());
        ASSERT_EQ(
            fluxora_create_empty_mod(
                project.c_str(),
                L"High Universal",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());

        const std::filesystem::path low = project / L"mods" / L"Low Universal";
        const std::filesystem::path high = project / L"mods" / L"High Universal";
        const std::filesystem::path unknown =
            L"NovelSubsystem/deep/state.futureext";
        writeTextFile(low / unknown, "low-unwrapped");
        writeTextFile(high / unknown, "high-unwrapped");
        writeTextFile(high / L"Data" / unknown, "high-wrapper");
        writeTextFile(high / L"root" / L"root-only.dll", "root-wrapper");
        writeTextFile(high / L"Data/meshes/pbr/surface.nif", "PBR-NIF");
        writeTextFile(high / L"Data/materials/pbr/surface.mat", "PBR-MAT");
        writeTextFile(high / L"Data/textures/pbr/surface.dds", "PBR-DDS");
        writeTextFile(high / L"Data/NovelSubsystem/truncate.bin", "lower-truncate-value");
        writeTextFile(high / L"Data/NovelSubsystem/rename-source.bin", "source-value");
        writeTextFile(high / L"Data/NovelSubsystem/rename-target.bin", "target-value");
        writeTextFile(high / L"Data/NovelSubsystem/delete-me.bin", "delete-value");
        writeTextFile(high / L"Data/NovelSubsystem/delete-on-close.bin", "delete-on-close-value");
        ASSERT_EQ(fluxora_set_all_installed_mods_enabled(project.c_str(), 1), FluxoraCoreResultOk);

        JsonWriter executables;
        executables.beginArray()
            .beginObject()
                .field(L"id", L"universal-vfs-probe")
                .field(L"displayName", L"Universal VFS Probe")
                .field(L"executablePath", probeExecutable.wstring())
                .field(
                    L"arguments",
                    L"\"" + (game / L"Data").wstring() + L"\" \"" +
                        game.wstring() + L"\" \"" + status.wstring() + L"\" \"" +
                        profileApiIni.wstring() + L"\" \"" +
                        ownedProfileStateFile.wstring() + L"\"")
                .field(L"workingDirectory", game.wstring())
                .field(L"iconPath", L"")
            .endObject()
            .endArray();
        ASSERT_EQ(
            fluxora_save_game_executables(
                config.c_str(),
                executables.str().c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());

        // Seeded last so no plugin sync can drop the marker the probe requires
        // before it is willing to write through the mount.
        const std::string ownedProfileStateSeed = "# fluxora-owned-state-probe\n*Skyrim.esm\n";
        writeTextFile(profilePluginsFile, ownedProfileStateSeed);

        ASSERT_EQ(
            fluxora_launch_game_executable(
                config.c_str(),
                L"universal-vfs-probe",
                L"Default",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue launch = JsonReader::parse(copyBufferedApiOutput());
        const std::uint32_t processId = static_cast<std::uint32_t>(
            std::stoul(launch.find(L"processId")->asNumber()));
        const HANDLE process = OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            FALSE,
            processId);
        ASSERT_NE(process, nullptr);
        ASSERT_EQ(WaitForSingleObject(process, 30'000), WAIT_OBJECT_0);
        DWORD exitCode = 0;
        ASSERT_TRUE(GetExitCodeProcess(process, &exitCode));
        CloseHandle(process);

        ASSERT_TRUE(std::filesystem::is_regular_file(status));
        const std::string probeStatus = readTextFile(status);
        if (probeStatus != "ok" || exitCode != 0U)
        {
            std::error_code diagnosticError;
            for (std::filesystem::recursive_directory_iterator iterator(
                    project,
                    std::filesystem::directory_options::skip_permission_denied,
                    diagnosticError), end;
                iterator != end && !diagnosticError;
                iterator.increment(diagnosticError))
            {
                std::cerr << "Universal VFS diagnostic: " << iterator->path().string() << '\n';
            }
        }
        ASSERT_EQ(probeStatus, "ok");
        ASSERT_EQ(exitCode, 0U) << probeStatus;
        EXPECT_EQ(readTextFile(high / L"Data" / unknown), "high-wrapper");
        EXPECT_EQ(readTextFile(high / L"Data/NovelSubsystem/rename-source.bin"), "source-value");
        EXPECT_EQ(readTextFile(high / L"Data/NovelSubsystem/delete-me.bin"), "delete-value");
        EXPECT_EQ(
            readTextFile(project / L"overwrite" / unknown),
            "+appendapper+tail");
        EXPECT_EQ(
            readTextFile(project / L"overwrite/NovelSubsystem/truncate.bin"),
            "truncated");
        EXPECT_EQ(
            readTextFile(project / L"overwrite/NovelSubsystem/rename-target.bin"),
            "source-value");
        EXPECT_TRUE(std::filesystem::is_regular_file(
            project / L".flow/vfs/whiteouts/primary-content/novelsubsystem/rename-source.bin"));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            project / L".flow/vfs/whiteouts/primary-content/novelsubsystem/delete-me.bin"));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            project / L".flow/vfs/whiteouts/primary-content/novelsubsystem/delete-on-close.bin"));
        const std::string vfsLog = readTextFile(project / L".flow/vfs/vfs.log");
        EXPECT_NE(vfsLog.find("VFS session started operationId="), std::string::npos);
        EXPECT_NE(vfsLog.find("preparationMs="), std::string::npos);
        EXPECT_NE(vfsLog.find("redirectedWrites="), std::string::npos);
        EXPECT_NE(vfsLog.find("whiteouts="), std::string::npos);
        EXPECT_NE(vfsLog.find("errors=0"), std::string::npos);
        EXPECT_EQ(vfsLog.find("operationId=<none>"), std::string::npos);
        EXPECT_FALSE(std::filesystem::exists(game / L"Data/NovelSubsystem"));

        // The game's rewrite landed in the profile Fluxora reads, and the stale
        // fork was quarantined instead of shadowing it for every later launch.
        EXPECT_EQ(
            readTextFile(profilePluginsFile),
            ownedProfileStateSeed + "*ProbeWritten.esp\n");
        EXPECT_FALSE(std::filesystem::exists(profileStateFork));
        EXPECT_TRUE(std::filesystem::is_regular_file(
            project / L".flow/vfs/superseded-profile-state/Default/local-appdata/plugins.txt"));
        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, FoundationAcceptanceReadsRealPbrChainThroughInjectedVfsWhenConfigured)
    {
        fluxora_core_shutdown();
        wchar_t configBuffer[32'768]{};
        const DWORD configLength = GetEnvironmentVariableW(
            L"FLUXORA_FOUNDATION_ACCEPTANCE_CONFIG",
            configBuffer,
            static_cast<DWORD>(std::size(configBuffer)));
        if (configLength == 0 || configLength >= std::size(configBuffer))
        {
            GTEST_SKIP() << "Set FLUXORA_FOUNDATION_ACCEPTANCE_CONFIG for the local real-build acceptance run.";
        }

        const std::filesystem::path sourceConfig(configBuffer);
        ASSERT_TRUE(std::filesystem::is_regular_file(sourceConfig));
        const std::string originalConfig = readTextFile(sourceConfig);
        const JsonValue configJson = JsonReader::parse(fromUtf8(originalConfig));
        const JsonValue* projectDirectoryValue = configJson.find(L"projectDirectory");
        const JsonValue* gamePathValue = configJson.find(L"gamePath");
        const JsonValue* dataDirectoryValue = configJson.find(L"dataDirectory");
        const JsonValue* defaultProfileValue = configJson.find(L"defaultProfile");
        ASSERT_NE(projectDirectoryValue, nullptr);
        ASSERT_NE(gamePathValue, nullptr);
        ASSERT_NE(dataDirectoryValue, nullptr);
        ASSERT_NE(defaultProfileValue, nullptr);

        const std::filesystem::path project(projectDirectoryValue->asString());
        const std::filesystem::path game = project / gamePathValue->asString();
        const std::filesystem::path data = game / dataDirectoryValue->asString();
        const std::filesystem::path mesh =
            project / L"mods/DrJacopo's - 3D Deathbell (Low Poly Nexus Version)/meshes/plants/deathbell01.nif";
        const std::filesystem::path pbrDescriptor =
            project / L"mods/Cathedral PBR Plants/PBRNifPatcher/Cathedral3DDeathbellPBR.json";
        const std::filesystem::path pbrTexture =
            project / L"mods/Cathedral PBR Plants/textures/PBR/plants/deathbell01.dds";
        ASSERT_TRUE(std::filesystem::is_regular_file(mesh));
        ASSERT_TRUE(std::filesystem::is_regular_file(pbrDescriptor));
        ASSERT_TRUE(std::filesystem::is_regular_file(pbrTexture));

        TempDirectory temp;
        const std::filesystem::path copiedConfig = temp.path() / L"Foundation-readonly.json";
        const std::filesystem::path status = temp.path() / L"foundation-pbr-status.txt";
        std::filesystem::copy_file(sourceConfig, copiedConfig);
        const std::filesystem::path probeExecutable =
            std::filesystem::path(currentTestExecutablePath()).parent_path() /
            L"FluxoraUniversalVfsProbe.exe";
        ASSERT_TRUE(std::filesystem::is_regular_file(probeExecutable));

        JsonWriter executables;
        executables.beginArray()
            .beginObject()
                .field(L"id", L"foundation-pbr-readonly-probe")
                .field(L"displayName", L"Foundation PBR Read-only Probe")
                .field(L"executablePath", probeExecutable.wstring())
                .field(
                    L"arguments",
                    L"--readonly-three \"" + data.wstring() + L"\" \"" + status.wstring() +
                        L"\" \"meshes\\plants\\deathbell01.nif\" \"" + mesh.wstring() +
                        L"\" \"PBRNifPatcher\\Cathedral3DDeathbellPBR.json\" \"" +
                        pbrDescriptor.wstring() +
                        L"\" \"textures\\PBR\\plants\\deathbell01.dds\" \"" +
                        pbrTexture.wstring() + L"\"")
                .field(L"workingDirectory", game.wstring())
                .field(L"iconPath", L"")
            .endObject()
            .endArray();

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_save_game_executables(
                copiedConfig.c_str(),
                executables.str().c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        static_cast<void>(copyBufferedApiOutput());
        ASSERT_EQ(
            fluxora_launch_game_executable(
                copiedConfig.c_str(),
                L"foundation-pbr-readonly-probe",
                defaultProfileValue->asString().c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const JsonValue launch = JsonReader::parse(copyBufferedApiOutput());
        const std::uint32_t processId = static_cast<std::uint32_t>(
            std::stoul(launch.find(L"processId")->asNumber()));
        const HANDLE process = OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            FALSE,
            processId);
        ASSERT_NE(process, nullptr);
        ASSERT_EQ(WaitForSingleObject(process, 60'000), WAIT_OBJECT_0);
        DWORD exitCode = 0;
        ASSERT_TRUE(GetExitCodeProcess(process, &exitCode));
        CloseHandle(process);

        ASSERT_TRUE(std::filesystem::is_regular_file(status));
        EXPECT_EQ(readTextFile(status), "ok");
        EXPECT_EQ(exitCode, 0U) << readTextFile(status);
        EXPECT_EQ(readTextFile(sourceConfig), originalConfig);

        const JsonValue* managedSessionId = launch.find(L"managedSessionId");
        if (managedSessionId != nullptr && managedSessionId->isString())
        {
            std::array<wchar_t, 2048> completion{};
            EXPECT_EQ(
                fluxora_complete_managed_executable_launch(
                    managedSessionId->asString().c_str(),
                    L"completed",
                    completion.data(),
                    static_cast<int>(completion.size())),
                FluxoraCoreResultOk) << toUtf8(lastCoreError());
        }
        fluxora_core_shutdown();
    }
#endif

    TEST(FluxoraCoreApiTests, DownloadContentLayoutPreviewUsesArchiveIndexAndAcceptsV2Edits)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Core API content-layout preview test uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Index Preview Build";
        const std::filesystem::path download =
            appRoot / L"Downloads" / L"skyrimse" / L"Index Preview.zip";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        writeZipArchive(
            download,
            {
                ZipEntry{L"Data/IndexPreview.esp", "plugin"},
                ZipEntry{L"Data/Meshes/IndexPreview/model.nif", "mesh"}
            });

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Index Preview Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        constexpr wchar_t editsJson[] =
            LR"json({"schemaVersion":2,"files":[],"directories":[{"target":"data","targetRelativePath":"Generated"}],"excludedSourcePaths":["Data/Meshes/IndexPreview/model.nif"]})json";
        ASSERT_EQ(
            fluxora_analyze_download_content_layout_with_edits(
                project.c_str(),
                download.c_str(),
                0,
                editsJson,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());

        const std::wstring json = copyBufferedApiOutput();
        EXPECT_NE(json.find(L"\"targetRelativePath\":\"Generated\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"archiveContentFingerprint\":"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"editFingerprint\":"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"placementFingerprint\":"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"included\":false"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"assessment\":{\"status\":\"ready\""), std::wstring::npos);
        EXPECT_FALSE(std::filesystem::exists(appRoot / L"Downloads" / L".install-staging-cache"));
        EXPECT_FALSE(std::filesystem::exists(project / L"mods" / L".Index Preview.installing"));

        const auto warmedStartedAt = std::chrono::steady_clock::now();
        ASSERT_EQ(
            fluxora_analyze_download_content_layout_with_edits(
                project.c_str(),
                download.c_str(),
                0,
                editsJson,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const auto warmedDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - warmedStartedAt);
        (void)copyBufferedApiOutput();
        EXPECT_LT(warmedDuration, std::chrono::milliseconds(500));

        const int installResult = fluxora_install_download_with_layout(
            project.c_str(),
            download.c_str(),
            L"Index Preview",
            0,
            editsJson,
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (installResult == FluxoraCoreResultCoreError && isMissingExtractorError(lastCoreError()))
        {
            fluxora_core_shutdown();
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(installResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        (void)copyBufferedApiOutput();

        const std::filesystem::path installed = project / L"mods" / L"Index Preview";
        EXPECT_TRUE(std::filesystem::is_regular_file(installed / L"IndexPreview.esp"));
        EXPECT_FALSE(std::filesystem::exists(installed / L"Meshes" / L"IndexPreview" / L"model.nif"));
        EXPECT_TRUE(std::filesystem::is_directory(installed / L"Generated"));

        fluxora_core_shutdown();
#endif
    }

    TEST(FluxoraCoreApiTests, SkyrimModMutationsSynchronizePluginStateFiles)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Core API plugin sync test uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);

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

    TEST(FluxoraCoreApiTests, DeleteInstalledModRejectsAnActiveInstallTarget)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Core API install target guard uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Active Install Build";
        const std::filesystem::path modPath =
            project / L"mods" / L"Pandora Behaivour Engine Plus";
        const std::filesystem::path baselineArchive =
            temp.path() / L"Pandora Behaviour Engine 4.2.zip";
        const std::filesystem::path updateArchive =
            temp.path() / L"Pandora Behaviour Engine v4.3.1-beta.zip";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        writeZipArchive(baselineArchive, {{L"Nemesis.esp", "baseline plugin"}});
        writeZipArchive(updateArchive, {{L"Nemesis.esp", "updated plugin"}});

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Active Install Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const int baselineResult = fluxora_install_archive_with_layout(
            project.c_str(),
            baselineArchive.c_str(),
            L"Pandora Behaivour Engine Plus",
            0,
            nullptr,
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (baselineResult == FluxoraCoreResultCoreError &&
            isMissingExtractorError(lastCoreError()))
        {
            fluxora_core_shutdown();
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(baselineResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());

        struct BlockingProgress
        {
            std::mutex mutex;
            std::condition_variable changed;
            bool finalizingEntered{false};
            bool releaseFinalizing{false};
            std::wstring terminalJson;
        } progress;
        const auto blockAtFinalizing = +[](const wchar_t* operationJson, void* userData)
        {
            if (operationJson == nullptr)
            {
                return;
            }
            auto& state = *static_cast<BlockingProgress*>(userData);
            const std::wstring_view json(operationJson);
            if (json.find(L"\"state\":\"completed\"") != std::wstring_view::npos)
            {
                std::lock_guard lock(state.mutex);
                state.terminalJson = operationJson;
                state.changed.notify_all();
                return;
            }
            if (json.find(L"finalizing") == std::wstring_view::npos)
            {
                return;
            }
            std::unique_lock lock(state.mutex);
            state.finalizingEntered = true;
            state.changed.notify_all();
            state.changed.wait(lock, [&state] { return state.releaseFinalizing; });
        };

        std::array<wchar_t, 4096> operationBuffer{};
        const int submitResult = fluxora_submit_install_operation(
            project.c_str(),
            L"active-pandora-update",
            L"archive",
            updateArchive.c_str(),
            0,
            L"Pandora Behaivour Engine Plus",
            1,
            L"[]",
            L"[]",
            nullptr,
            1,
            nullptr,
            0,
            L"Default",
            L"skyrimse",
            nullptr,
            nullptr,
            L"[]",
            -1,
            nullptr,
            nullptr,
            blockAtFinalizing,
            &progress,
            operationBuffer.data(),
            static_cast<int>(operationBuffer.size()));
        ASSERT_EQ(submitResult, FluxoraCoreResultOk) << toUtf8(lastCoreError());

        {
            std::unique_lock lock(progress.mutex);
            if (!progress.changed.wait_for(
                    lock,
                    std::chrono::seconds(10),
                    [&progress] { return progress.finalizingEntered; }))
            {
                progress.releaseFinalizing = true;
                lock.unlock();
                progress.changed.notify_all();
                fluxora_core_shutdown();
                FAIL() << "Durable update did not reach finalizing.";
            }
        }

        const int deleteResult = fluxora_delete_installed_mod(project.c_str(), modPath.c_str());
        EXPECT_EQ(deleteResult, FluxoraCoreResultCoreError);
        EXPECT_NE(lastCoreError().find(L"install"), std::wstring::npos);
        EXPECT_TRUE(std::filesystem::is_regular_file(modPath / L"Nemesis.esp"));

        {
            std::lock_guard lock(progress.mutex);
            progress.releaseFinalizing = true;
        }
        progress.changed.notify_all();

        {
            std::unique_lock lock(progress.mutex);
            ASSERT_TRUE(progress.changed.wait_for(
                lock,
                std::chrono::seconds(10),
                [&progress] { return !progress.terminalJson.empty(); }));
            EXPECT_NE(
                progress.terminalJson.find(L"\"workspaceDelta\":{\"projectDirectory\":"),
                std::wstring::npos);
            EXPECT_NE(
                progress.terminalJson.find(L"\"operationId\":\"active-pandora-update\""),
                std::wstring::npos);
            EXPECT_NE(
                progress.terminalJson.find(L"\"plugins\":{\"baseRevision\":\"\""),
                std::wstring::npos);
            EXPECT_NE(progress.terminalJson.find(L"Nemesis.esp"), std::wstring::npos);
        }

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
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Nexus Install Response Build";
        const std::filesystem::path downloadPath =
            appRoot / L"Downloads" / L"skyrimse" / L"Cabbage CS Preset 1.4.0.zip";
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

    TEST(FluxoraCoreApiTests, FomodPlanKeepsSpecificArchiveVariantName)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FOMOD install planning uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"FOMOD Variant Build";
        const std::filesystem::path downloadPath =
            appRoot / L"Downloads" / L"skyrimse" /
            L"Dragonborn UI - SkyUI Reskin - Widescreen 21x9.zip";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"FOMOD Variant Build",
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
                ZipEntry{L"Data/Interface/skyui/config.txt", "variant"},
                ZipEntry{
                    L"fomod/ModuleConfig.xml",
                    "<config><moduleName>Dragonborn UI - SkyUI Reskin</moduleName></config>"},
                ZipEntry{
                    L"fomod/info.xml",
                    "<fomod><Name>Dragonborn UI - SkyUI Reskin</Name><Version>1.0</Version></fomod>"}
            });

        const int planResult = fluxora_plan_download_install(
            project.c_str(),
            downloadPath.c_str(),
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (planResult == FluxoraCoreResultCoreError && isMissingExtractorError(lastCoreError()))
        {
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(planResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());

        const JsonValue plan = JsonReader::parse(copyBufferedApiOutput());
        const JsonValue* suggestedModName = plan.find(L"suggestedModName");
        ASSERT_NE(suggestedModName, nullptr);
        ASSERT_TRUE(suggestedModName->isString());
        EXPECT_EQ(
            suggestedModName->asString(),
            L"Dragonborn UI - SkyUI Reskin - Widescreen 21x9");

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
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Planned C ABI Build";
        const std::filesystem::path archive =
            appRoot / L"Downloads" / L"skyrimse" / L"C ABI Identity 1.0.zip";
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
        ASSERT_EQ(
            fluxora_set_operation_context(L"op_cabi_install_conflict"),
            FluxoraCoreResultOk);
        InstallProgressCapture installProgress{
            project / L"mods" / L"C ABI Identity"
        };
        const int downloadInstallResult = fluxora_install_download_planned_with_progress(
            project.c_str(),
            archive.c_str(),
            L"C ABI Identity",
            0,
            nullptr,
            downloadResolution->asString().c_str(),
            1,
            nullptr,
            0,
            L"Default",
            1,
            captureProgressJson,
            &installProgress,
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (downloadInstallResult == FluxoraCoreResultCoreError && isMissingExtractorError(lastCoreError()))
        {
            static_cast<void>(fluxora_set_operation_context(nullptr));
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(downloadInstallResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        const std::wstring installedJson = copyBufferedApiOutput();
        EXPECT_NE(installedJson.find(L"\"name\":\"C ABI Identity\""), std::wstring::npos);
        EXPECT_NE(installedJson.find(L"\"modUuid\":"), std::wstring::npos);
        EXPECT_NE(installedJson.find(L"\"orderId\":"), std::wstring::npos);
        EXPECT_NE(installedJson.find(L"\"fileCount\":1"), std::wstring::npos);
        ASSERT_FALSE(installProgress.payloads.empty());
        EXPECT_TRUE(installProgress.readyObservedBeforeTargetCommit);
        EXPECT_TRUE(std::any_of(
            installProgress.payloads.begin(),
            installProgress.payloads.end(),
            [](const std::wstring& progress)
            {
                return progress.find(L"\"installConflictSnapshot\"") != std::wstring::npos &&
                    progress.find(L"\"state\":\"ready\"") != std::wstring::npos;
            }));
        EXPECT_TRUE(std::all_of(
            installProgress.payloads.begin(),
            installProgress.payloads.end(),
            [&archive](const std::wstring& progress)
            {
                return progress.find(archive.wstring()) == std::wstring::npos;
            }));
        ASSERT_EQ(
            fluxora_rebase_pending_install(
                project.c_str(),
                L"op_cabi_install_conflict",
                0,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall)
            << toUtf8(lastCoreError());
        const std::wstring rebasedJson = copyBufferedApiOutput();
        EXPECT_NE(rebasedJson.find(L"\"state\":\"completed\""), std::wstring::npos);
        EXPECT_NE(rebasedJson.find(L"\"orderId\":"), std::wstring::npos);
        ASSERT_EQ(fluxora_set_operation_context(nullptr), FluxoraCoreResultOk);

        ASSERT_EQ(
            fluxora_plan_download_install_for_profile_with_name(
                project.c_str(),
                archive.c_str(),
                L"Default",
                L"C ABI Identity",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall)
            << toUtf8(lastCoreError());
        const JsonValue namedPlan = JsonReader::parse(copyBufferedApiOutput());
        const JsonValue* namedTarget = namedPlan.find(L"matchedTarget");
        ASSERT_NE(namedTarget, nullptr);
        ASSERT_TRUE(namedTarget->isObject());
        EXPECT_EQ(namedTarget->find(L"displayName")->asString(), L"C ABI Identity");

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

    TEST(FluxoraCoreApiTests, ProfileAwareFomodApiSerializesSmartPlanSharesContextAndRejectsStaleWrites)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Profile-aware FOMOD C ABI test uses the Windows instance metadata store.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Smart FOMOD API Build";
        const std::filesystem::path download =
            appRoot / L"Downloads" / L"skyrimse" / L"Smart API.zip";
        const std::filesystem::path archive = temp.path() / L"Incoming" / L"Smart API Source.zip";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Smart FOMOD API Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        const std::filesystem::path lux = project / L"mods" / L"Lux";
        ASSERT_EQ(
            fluxora_create_empty_mod(
                project.c_str(),
                L"Lux",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();
        writeTextFile(lux / L"Lux.esp", "plugin");
        writeTextFile(project / L"profiles" / L"Default" / L"plugins.txt", "*Lux.esp\n");

        const std::string moduleConfig = R"xml(
<config>
  <moduleName>Smart API Mod</moduleName>
  <installSteps order="Explicit"><installStep name="Patches"><optionalFileGroups order="Explicit">
    <group name="Patches" type="SelectAny"><plugins order="Explicit"><plugin name="Lux Patch">
      <files><file source="payload/LuxPatch.esp" destination="Data/LuxPatch.esp" /></files>
      <typeDescriptor><type name="Recommended" /></typeDescriptor>
    </plugin></plugins></group>
  </optionalFileGroups></installStep></installSteps>
</config>)xml";
        const std::vector<ZipEntry> entries{
            ZipEntry{L"fomod/ModuleConfig.xml", moduleConfig},
            ZipEntry{L"fomod/info.xml", "<fomod><Name>Smart API Mod</Name><Version>1.0</Version></fomod>"},
            ZipEntry{L"payload/LuxPatch.esp", tes4PluginBytes({"Skyrim.esm", "Lux.esp"})}
        };
        writeZipArchive(download, entries);
        std::vector<ZipEntry> archiveEntries = entries;
        archiveEntries.push_back(ZipEntry{L"archive-only.txt", "unique local archive"});
        writeZipArchive(archive, archiveEntries);

        ASSERT_EQ(
            fluxora_analyze_fomod_download(
                project.c_str(),
                download.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        EXPECT_NE(copyBufferedApiOutput().find(L"\"isFomod\":true"), std::wstring::npos);

        ASSERT_EQ(
            fluxora_analyze_fomod_download_for_profile(
                project.c_str(),
                download.c_str(),
                L"Default",
                nullptr,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring analysisJson = copyBufferedApiOutput();
        EXPECT_NE(analysisJson.find(L"\"profileContext\""), std::wstring::npos);
        EXPECT_NE(analysisJson.find(L"\"state\":\"Active\""), std::wstring::npos);
        EXPECT_NE(analysisJson.find(L"\"sourceName\":\"Lux\""), std::wstring::npos);
        EXPECT_NE(analysisJson.find(L"\"pluginHeaders\""), std::wstring::npos);
        EXPECT_NE(analysisJson.find(L"\"tes4.master.active\""), std::wstring::npos);
        const JsonValue analysis = JsonReader::parse(analysisJson);
        const JsonValue* autoSelection = analysis.find(L"autoSelection");
        ASSERT_NE(autoSelection, nullptr);
        ASSERT_TRUE(autoSelection->isObject());
        const JsonValue* contextIdValue = autoSelection->find(L"contextId");
        const JsonValue* selectedValue = autoSelection->find(L"initialSelectedOptionIds");
        ASSERT_NE(contextIdValue, nullptr);
        ASSERT_TRUE(contextIdValue->isString());
        ASSERT_NE(selectedValue, nullptr);
        ASSERT_TRUE(selectedValue->isArray());
        ASSERT_EQ(selectedValue->asArray().size(), 1u);
        const std::wstring contextId = contextIdValue->asString();
        const std::wstring optionId = selectedValue->asArray()[0].asString();
        const std::wstring selectedJson = L"[\"" + optionId + L"\"]";

        auto analyzeTask = std::async(std::launch::async, [&]()
        {
            std::vector<wchar_t> output(262144);
            const int result = fluxora_analyze_fomod_download_for_profile(
                project.c_str(), download.c_str(), L"Default", nullptr,
                output.data(), static_cast<int>(output.size()));
            return std::make_pair(result, std::wstring(output.data()));
        });
        auto planTask = std::async(std::launch::async, [&]()
        {
            std::vector<wchar_t> output(262144);
            const int result = fluxora_plan_download_install_for_profile(
                project.c_str(), download.c_str(), L"Default",
                output.data(), static_cast<int>(output.size()));
            return std::make_pair(result, std::wstring(output.data()));
        });
        const auto analyzed = analyzeTask.get();
        const auto planned = planTask.get();
        ASSERT_EQ(analyzed.first, FluxoraCoreResultOk);
        ASSERT_EQ(planned.first, FluxoraCoreResultOk);
        const JsonValue parallelAnalysis = JsonReader::parse(analyzed.second);
        const JsonValue parallelPlan = JsonReader::parse(planned.second);
        const JsonValue* parallelAuto = parallelAnalysis.find(L"autoSelection");
        const JsonValue* planInstaller = parallelPlan.find(L"fomodInstaller");
        ASSERT_NE(parallelAuto, nullptr);
        ASSERT_NE(planInstaller, nullptr);
        const JsonValue* planAuto = planInstaller->find(L"autoSelection");
        ASSERT_NE(planAuto, nullptr);
        ASSERT_EQ(
            parallelAuto->find(L"contextId")->asString(),
            planAuto->find(L"contextId")->asString());

        writeTextFile(project / L"profiles" / L"Default" / L"plugins.txt", "Lux.esp\n");
        EXPECT_EQ(
            fluxora_install_fomod_download_with_layout_for_profile(
                project.c_str(),
                download.c_str(),
                L"Smart API Mod",
                0,
                selectedJson.c_str(),
                nullptr,
                L"Default",
                contextId.c_str(),
                nullptr,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultCoreError);
        EXPECT_EQ(lastCoreError(), L"install.fomodContextChanged");
        EXPECT_FALSE(std::filesystem::exists(project / L"mods" / L"Smart API Mod"));

        const auto regularFileCount = [](const std::filesystem::path& root)
        {
            std::size_t count = 0;
            if (!std::filesystem::exists(root))
            {
                return count;
            }
            for (const auto& entry : std::filesystem::recursive_directory_iterator(root))
            {
                if (entry.is_regular_file())
                {
                    ++count;
                }
            }
            return count;
        };
        const std::filesystem::path downloadsDirectory = appRoot / L"Downloads" / L"skyrimse";
        const std::size_t downloadFilesBeforeStaleArchive = regularFileCount(downloadsDirectory);
        EXPECT_EQ(
            fluxora_install_fomod_archive_with_layout_for_profile(
                project.c_str(),
                archive.c_str(),
                L"Smart API Mod",
                0,
                selectedJson.c_str(),
                nullptr,
                L"Default",
                contextId.c_str(),
                nullptr,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultCoreError);
        EXPECT_EQ(lastCoreError(), L"install.fomodContextChanged");
        EXPECT_EQ(regularFileCount(downloadsDirectory), downloadFilesBeforeStaleArchive);
        EXPECT_FALSE(std::filesystem::exists(project / L"mods" / L"Smart API Mod"));

        writeTextFile(project / L"profiles" / L"Default" / L"plugins.txt", "*Lux.esp\n");
        const std::filesystem::path analyzedArchiveDownload =
            downloadsDirectory / L"Smart API Source.zip";
        std::filesystem::copy_file(
            archive,
            analyzedArchiveDownload,
            std::filesystem::copy_options::overwrite_existing);
        ASSERT_EQ(
            fluxora_analyze_fomod_download_for_profile(
                project.c_str(),
                analyzedArchiveDownload.c_str(),
                L"Default",
                nullptr,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall)
            << toUtf8(lastCoreError());
        const JsonValue freshAnalysis = JsonReader::parse(copyBufferedApiOutput());
        const JsonValue* freshAuto = freshAnalysis.find(L"autoSelection");
        ASSERT_NE(freshAuto, nullptr);
        const std::wstring freshContextId = freshAuto->find(L"contextId")->asString();
        const std::wstring freshOptionId =
            freshAuto->find(L"initialSelectedOptionIds")->asArray()[0].asString();
        const std::wstring freshSelectedJson = L"[\"" + freshOptionId + L"\"]";
        ASSERT_EQ(
            fluxora_plan_archive_install_for_profile_with_name(
                project.c_str(),
                archive.c_str(),
                L"Default",
                L"Smart API Mod",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const JsonValue freshPlan = JsonReader::parse(copyBufferedApiOutput());
        const JsonValue* freshResolutionId = freshPlan.find(L"resolutionId");
        ASSERT_NE(freshResolutionId, nullptr);
        ASSERT_TRUE(freshResolutionId->isString());
        ASSERT_EQ(
            fluxora_set_operation_context(L"op_fomod_install_conflict"),
            FluxoraCoreResultOk);
        InstallProgressCapture fomodProgress{
            project / L"mods" / L"Smart API Mod"
        };
        const int installResult = fluxora_install_fomod_archive_planned_for_profile_with_progress(
            project.c_str(),
            archive.c_str(),
            L"Smart API Mod",
            0,
            freshSelectedJson.c_str(),
            nullptr,
            freshResolutionId->asString().c_str(),
            1,
            nullptr,
            0,
            L"Default",
            freshContextId.c_str(),
            nullptr,
            1,
            captureProgressJson,
            &fomodProgress,
            smallBuffer.data(),
            static_cast<int>(smallBuffer.size()));
        if (installResult == FluxoraCoreResultCoreError && isMissingExtractorError(lastCoreError()))
        {
            static_cast<void>(fluxora_set_operation_context(nullptr));
            GTEST_SKIP() << "No supported archive extractor was available.";
        }
        ASSERT_EQ(installResult, FluxoraCoreResultBufferTooSmall) << toUtf8(lastCoreError());
        ASSERT_EQ(fluxora_set_operation_context(nullptr), FluxoraCoreResultOk);
        EXPECT_NE(copyBufferedApiOutput().find(L"Smart API Mod"), std::wstring::npos);
        ASSERT_FALSE(fomodProgress.payloads.empty());
        EXPECT_TRUE(fomodProgress.readyObservedBeforeTargetCommit);
        EXPECT_TRUE(std::any_of(
            fomodProgress.payloads.begin(),
            fomodProgress.payloads.end(),
            [](const std::wstring& progress)
            {
                return progress.find(L"\"state\":\"ready\"") != std::wstring::npos &&
                    progress.find(L"\"fileCount\":1") != std::wstring::npos;
            }));
        EXPECT_TRUE(std::filesystem::exists(project / L"mods" / L"Smart API Mod" / L"LuxPatch.esp"));
        EXPECT_FALSE(std::filesystem::exists(project / L"mods" / L"Smart API Mod" / L"archive-only.txt"));

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
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);

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

        ASSERT_EQ(
            fluxora_get_workspace_delta(
                project.c_str(),
                L"skyrimse",
                L"Default",
                nullptr,
                L"op_workspace_delta_api",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring deltaJson = copyBufferedApiOutput();
        EXPECT_NE(
            deltaJson.find(L"\"operationId\":\"op_workspace_delta_api\""),
            std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"sequence\":1"), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"mods\":{\"baseRevision\":\"\""), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"installedModUpserts\":["), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"modUuid\":"), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"orderId\":"), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"plugins\":{\"baseRevision\":\"\""), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"fullResyncRequired\":false"), std::wstring::npos);

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
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);

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

    TEST(FluxoraCoreApiTests, DownloadsApiUsesGlobalCatalogAndLeavesLegacyPerBuildDirectoryUntouched)
    {
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path projectDirectory = installRoot / L"Global Downloads Build";
        const std::filesystem::path downloadsDirectory =
            appRoot / L"Downloads" / L"skyrimse";
        const std::filesystem::path legacyDownloadsDirectory =
            projectDirectory / L"downloads";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Global Downloads Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        writeTextFile(downloadsDirectory / L"Cabbage CS Preset.7z", "archive");
        writeTextFile(legacyDownloadsDirectory / L"Legacy Archive.7z", "legacy archive");
        writeTextFile(
            legacyDownloadsDirectory / L".fb16ecc071",
            "legacy download state backup");

        std::wstring json;
        for (int attempt = 0; attempt < 200; ++attempt)
        {
            ASSERT_EQ(
                fluxora_get_downloads(
                    projectDirectory.c_str(),
                    smallBuffer.data(),
                    static_cast<int>(smallBuffer.size())),
                FluxoraCoreResultBufferTooSmall);
            json = copyBufferedApiOutput();
            if (json.find(L"\"buildStatus\":\"Ready\"") != std::wstring::npos)
            {
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }

        EXPECT_NE(json.find(L"\"fileName\":\"Cabbage CS Preset.7z\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"name\":\"Cabbage CS Preset\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"archiveId\":\"sha256:"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"buildStatus\":\"Ready\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"transferState\":\"idle\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"duplicateDecision\":null"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"hasResolvedFileName\":true"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"canInstall\":true"), std::wstring::npos);
        EXPECT_EQ(json.find(L"Legacy Archive.7z"), std::wstring::npos);
        EXPECT_EQ(json.find(L"\"status\":"), std::wstring::npos);
        EXPECT_TRUE(std::filesystem::exists(legacyDownloadsDirectory / L"Legacy Archive.7z"));
        EXPECT_TRUE(std::filesystem::exists(legacyDownloadsDirectory / L".fb16ecc071"));

        ASSERT_EQ(
            fluxora_get_downloads_delta(
                projectDirectory.c_str(),
                nullptr,
                L"op_downloads_delta_api",
                L"created",
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        const std::wstring deltaJson = copyBufferedApiOutput();
        EXPECT_NE(
            deltaJson.find(L"\"operationId\":\"op_downloads_delta_api\""),
            std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"sequence\":1"), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"upserts\":["), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"removedIds\":[]"), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"placements\":["), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"reason\":\"created\""), std::wstring::npos);
        EXPECT_NE(deltaJson.find(L"\"fullResyncRequired\":false"), std::wstring::npos);

        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, ModUpdateV2ReturnsTheTypedResultEnvelope)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora project storage is implemented for Windows builds.";
#else
        fluxora_core_shutdown();

        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path appRoot = temp.path() / L"AppRoot";
        ScopedEnvironmentVariable fluxoraAppRoot(L"FLUXORA_APP_ROOT", appRoot.wstring());
        std::filesystem::create_directories(appRoot);
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path projectDirectory = installRoot / L"Update API Build";
        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        std::array<wchar_t, 4> smallBuffer{};
        ASSERT_EQ(
            fluxora_create_project(
                L"Update API Build",
                L"skyrimse",
                game.c_str(),
                installRoot.c_str(),
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);
        (void)copyBufferedApiOutput();

        JsonWriter request;
        request.beginObject();
        request.field(L"projectDirectory", projectDirectory.wstring());
        request.field(L"mode", L"automatic");
        request.endObject();
        ASSERT_EQ(
            fluxora_check_mod_updates_v2(
                request.str().c_str(),
                nullptr,
                nullptr,
                smallBuffer.data(),
                static_cast<int>(smallBuffer.size())),
            FluxoraCoreResultBufferTooSmall);

        const std::wstring json = copyBufferedApiOutput();
        EXPECT_NE(json.find(L"\"state\":\"skipped\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"reason\":\"noEligibleMods\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"nextEligibleAt\":\"\""), std::wstring::npos);
        EXPECT_NE(json.find(L"\"quota\":"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"counters\":"), std::wstring::npos);
        EXPECT_NE(json.find(L"\"mods\":[]"), std::wstring::npos);

        fluxora_core_shutdown();
#endif
    }

#if defined(_WIN32) && defined(FLUXORA_ENABLE_MODDINGFLOW_AUTH_PROVIDER)
    TEST(FluxoraCoreApiTests, PrivateModdingFlowBoundaryUsesTypedCallbacksAndSafeOutputs)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable localAppData(
            L"LOCALAPPDATA",
            (temp.path() / L"LocalAppData").wstring());
        ScopedEnvironmentVariable appRoot(
            L"FLUXORA_APP_ROOT",
            (temp.path() / L"AppRoot").wstring());
        ScopedEnvironmentVariable logRoot(
            L"FLUXORA_LOG_DIR",
            (temp.path() / L"Logs").wstring());

        std::array<wchar_t, 8192> beginBuffer{};
        ASSERT_EQ(
            fluxora_moddingflow_begin_connect(
                L"http://127.0.0.1:49172/oauth/fluxora/callback",
                L"operation-native-begin",
                beginBuffer.data(),
                static_cast<int>(beginBuffer.size())),
            FluxoraCoreResultOk) << toUtf8(lastCoreError());
        const std::wstring beginJson(beginBuffer.data());
        EXPECT_EQ(beginJson.find(L"access_token"), std::wstring::npos);
        EXPECT_EQ(beginJson.find(L"refresh_token"), std::wstring::npos);
        EXPECT_EQ(beginJson.find(L"jwks"), std::wstring::npos);
        EXPECT_EQ(beginJson.find(L"problem"), std::wstring::npos);
        const JsonValue begin = JsonReader::parse(beginJson);
        const JsonValue* transaction = begin.find(L"transactionId");
        ASSERT_NE(transaction, nullptr);
        ASSERT_TRUE(transaction->isString());
        ASSERT_FALSE(transaction->asString().empty());

        std::array<wchar_t, 1024> completionBuffer{};
        EXPECT_EQ(
            fluxora_moddingflow_complete_connect(
                transaction->asString().c_str(),
                FluxoraModdingFlowCallbackSuccess,
                L"authorization-code-must-not-leak",
                L"unexpected-error-shape",
                nullptr,
                L"state",
                L"https://moddingflow.com",
                L"operation-native-complete",
                completionBuffer.data(),
                static_cast<int>(completionBuffer.size())),
            FluxoraCoreResultInvalidArgument);
        EXPECT_EQ(lastCoreError().find(L"authorization-code-must-not-leak"), std::wstring::npos);
        EXPECT_EQ(lastCoreError().find(L"unexpected-error-shape"), std::wstring::npos);
        EXPECT_EQ(fluxora_get_last_required_buffer_length(), 0);

        EXPECT_EQ(
            fluxora_moddingflow_cancel_pending_connect(
                transaction->asString().c_str(),
                L"operation-native-cancel"),
            FluxoraCoreResultOk) << toUtf8(lastCoreError());

        std::array<wchar_t, 8192> listBuffer{};
        ASSERT_EQ(
            fluxora_list_external_connections(
                L"operation-native-list",
                listBuffer.data(),
                static_cast<int>(listBuffer.size())),
            FluxoraCoreResultOk) << toUtf8(lastCoreError());
        const std::wstring listJson(listBuffer.data());
        EXPECT_NE(listJson.find(L"\"providerId\":\"nexus\""), std::wstring::npos);
        EXPECT_NE(listJson.find(L"\"providerId\":\"moddingflow\""), std::wstring::npos);
        EXPECT_NE(listJson.find(L"\"operationId\":\"operation-native-list\""), std::wstring::npos);
        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, PrivateModdingFlowArtifactLookupRejectsInvalidInputsWithoutReflection)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable localAppData(
            L"LOCALAPPDATA",
            (temp.path() / L"LocalAppData").wstring());
        ScopedEnvironmentVariable appRoot(
            L"FLUXORA_APP_ROOT",
            (temp.path() / L"AppRoot").wstring());
        ScopedEnvironmentVariable logRoot(
            L"FLUXORA_LOG_DIR",
            (temp.path() / L"Logs").wstring());

        std::array<wchar_t, 1024> output{};
        EXPECT_EQ(
            fluxora_moddingflow_lookup_artifact_preview(
                nullptr,
                FluxoraModdingFlowArtifactLookupAnonymous,
                L"operation-artifact-null",
                output.data(),
                static_cast<int>(output.size())),
            FluxoraCoreResultInvalidArgument);
        EXPECT_EQ(fluxora_get_last_required_buffer_length(), 0);

        EXPECT_EQ(
            fluxora_moddingflow_lookup_artifact_preview(
                L"44444444-4444-4444-8444-444444444444",
                99,
                L"operation-artifact-invalid-auth-secret",
                output.data(),
                static_cast<int>(output.size())),
            FluxoraCoreResultInvalidArgument);
        EXPECT_EQ(lastCoreError().find(L"secret"), std::wstring::npos);

        EXPECT_EQ(
            fluxora_moddingflow_lookup_artifact_preview(
                L"44444444-4444-4444-8444-44444444444A",
                FluxoraModdingFlowArtifactLookupBearerModsRead,
                L"operation-artifact-invalid-uuid",
                output.data(),
                static_cast<int>(output.size())),
            FluxoraCoreResultInvalidArgument);
        const std::wstring invalidUuidError = lastCoreError();
        EXPECT_TRUE(invalidUuidError.starts_with(L"moddingflow-artifact:invalid-request:"));
        EXPECT_EQ(invalidUuidError.find(L"44444444"), std::wstring::npos);
        EXPECT_EQ(fluxora_get_last_required_buffer_length(), 0);
        fluxora_core_shutdown();
    }

    TEST(FluxoraCoreApiTests, PrivateModdingFlowActivationPlanIsStrictAndOptionalDependenciesStayOff)
    {
        fluxora_core_shutdown();
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        ScopedEnvironmentVariable localAppData(
            L"LOCALAPPDATA",
            (temp.path() / L"LocalAppData").wstring());
        ScopedEnvironmentVariable appRoot(
            L"FLUXORA_APP_ROOT",
            (temp.path() / L"AppRoot").wstring());
        ScopedEnvironmentVariable logRoot(
            L"FLUXORA_LOG_DIR",
            (temp.path() / L"Logs").wstring());

        std::array<wchar_t, 1024> output{};
        EXPECT_EQ(
            fluxora_moddingflow_preview_activation_plan(
                L"44444444-4444-4444-8444-444444444444",
                L"skyrim-se",
                L"1.6.1170",
                1,
                L"activation-plan-secret-must-not-leak",
                L"operation-plan-optional",
                output.data(),
                static_cast<int>(output.size())),
            FluxoraCoreResultInvalidArgument);
        EXPECT_EQ(lastCoreError().find(L"secret-must-not-leak"), std::wstring::npos);
        EXPECT_EQ(fluxora_get_last_required_buffer_length(), 0);

        EXPECT_EQ(
            fluxora_moddingflow_preview_activation_plan(
                L"44444444-4444-4444-8444-44444444444A",
                L"skyrim-se",
                L"1.6.1170",
                0,
                L"activation-plan-invalid-artifact",
                L"operation-plan-invalid-artifact",
                output.data(),
                static_cast<int>(output.size())),
            FluxoraCoreResultInvalidArgument);
        const std::wstring invalidArtifactError = lastCoreError();
        EXPECT_TRUE(invalidArtifactError.starts_with(L"moddingflow-plan:invalid-request:"));
        EXPECT_EQ(invalidArtifactError.find(L"44444444"), std::wstring::npos);
        EXPECT_EQ(fluxora_get_last_required_buffer_length(), 0);
        fluxora_core_shutdown();
    }
#endif
}
