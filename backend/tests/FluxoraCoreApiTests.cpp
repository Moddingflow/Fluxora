#include "FluxoraCore/FluxoraCoreApi.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <array>
#include <filesystem>
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
}
