#include "FluxoraCore/Services/ExecutableMetadataService.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <stdexcept>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora::tests
{
    namespace
    {
#ifdef _WIN32
        std::filesystem::path testBinaryDirectory()
        {
            std::wstring buffer(32768, L'\0');
            const DWORD length = GetModuleFileNameW(
                nullptr,
                buffer.data(),
                static_cast<DWORD>(buffer.size()));
            if (length == 0 || length >= buffer.size())
            {
                throw std::runtime_error("Could not resolve the test binary directory.");
            }
            buffer.resize(length);
            return std::filesystem::path(buffer).parent_path();
        }

        class ExclusiveFileLock final
        {
        public:
            explicit ExclusiveFileLock(const std::filesystem::path& path)
                : handle_(CreateFileW(
                      path.c_str(),
                      GENERIC_READ,
                      0,
                      nullptr,
                      OPEN_EXISTING,
                      FILE_ATTRIBUTE_NORMAL,
                      nullptr))
            {
            }

            ~ExclusiveFileLock()
            {
                if (handle_ != INVALID_HANDLE_VALUE)
                {
                    CloseHandle(handle_);
                }
            }

            [[nodiscard]] bool valid() const noexcept
            {
                return handle_ != INVALID_HANDLE_VALUE;
            }

        private:
            HANDLE handle_{INVALID_HANDLE_VALUE};
        };
#endif
    }

    TEST(ExecutableMetadataServiceTests, SuggestsAcronymFromGenericFilenameMarkers)
    {
        TempDirectory temp;
        const std::filesystem::path executablePath = temp.path() / L"skse64_loader.exe";
        writeTextFile(executablePath, "MZ executable stub");

        ExecutableMetadataService service;
        const ExecutableMetadataInspection inspection = service.inspect(executablePath);

        EXPECT_EQ(inspection.executablePath, executablePath);
        EXPECT_EQ(inspection.suggestedDisplayName, L"SKSE");
        EXPECT_EQ(inspection.displayNameSource, ExecutableDisplayNameSource::FileName);
    }

    TEST(ExecutableMetadataServiceTests, PreservesMeaningfulMixedAndUppercaseFilenameTokens)
    {
        TempDirectory temp;
        const std::filesystem::path executablePath = temp.path() / L"MyXMLTool-win64.exe";
        writeTextFile(executablePath, "MZ executable stub");

        ExecutableMetadataService service;
        const ExecutableMetadataInspection inspection = service.inspect(executablePath);

        EXPECT_EQ(inspection.suggestedDisplayName, L"My XML Tool");
        EXPECT_EQ(inspection.displayNameSource, ExecutableDisplayNameSource::FileName);
    }

#ifdef _WIN32
    TEST(ExecutableMetadataServiceTests, PrefersUnicodeFileDescriptionOverProductName)
    {
        const std::filesystem::path fixture =
            testBinaryDirectory() / L"ExecutableMetadataDescriptionFixture.exe";

        ExecutableMetadataService service;
        const ExecutableMetadataInspection inspection = service.inspect(fixture);

        EXPECT_EQ(inspection.suggestedDisplayName, L"Редактор Fluxora");
        EXPECT_EQ(inspection.displayNameSource, ExecutableDisplayNameSource::FileDescription);
    }

    TEST(ExecutableMetadataServiceTests, UsesProductNameWhenFileDescriptionIsAbsent)
    {
        const std::filesystem::path fixture =
            testBinaryDirectory() / L"ExecutableMetadataProductFixture.exe";

        ExecutableMetadataService service;
        const ExecutableMetadataInspection inspection = service.inspect(fixture);

        EXPECT_EQ(inspection.suggestedDisplayName, L"Fluxora Product Tool");
        EXPECT_EQ(inspection.displayNameSource, ExecutableDisplayNameSource::ProductName);
    }

    TEST(ExecutableMetadataServiceTests, ReadsVersionMetadataFromUnicodePath)
    {
        TempDirectory temp;
        const std::filesystem::path unicodeDirectory = temp.path() / L"Инструменты";
        std::filesystem::create_directories(unicodeDirectory);
        const std::filesystem::path copy = unicodeDirectory / L"редактор.exe";
        std::filesystem::copy_file(
            testBinaryDirectory() / L"ExecutableMetadataDescriptionFixture.exe",
            copy);

        ExecutableMetadataService service;
        const ExecutableMetadataInspection inspection = service.inspect(copy);

        EXPECT_EQ(inspection.executablePath, copy);
        EXPECT_EQ(inspection.suggestedDisplayName, L"Редактор Fluxora");
        EXPECT_EQ(inspection.displayNameSource, ExecutableDisplayNameSource::FileDescription);
    }

    TEST(ExecutableMetadataServiceTests, RejectsUnreadableExecutable)
    {
        TempDirectory temp;
        const std::filesystem::path executablePath = temp.path() / L"locked.exe";
        writeTextFile(executablePath, "MZ executable stub");
        const ExclusiveFileLock lock(executablePath);
        ASSERT_TRUE(lock.valid());

        ExecutableMetadataService service;
        EXPECT_THROW(static_cast<void>(service.inspect(executablePath)), std::invalid_argument);
    }
#endif

    TEST(ExecutableMetadataServiceTests, UsesFilenameForExecutableWithoutVersionInformation)
    {
        TempDirectory temp;
        const std::filesystem::path executablePath = temp.path() / L"portableTool.exe";
        writeTextFile(executablePath, "MZ executable stub");

        ExecutableMetadataService service;
        const ExecutableMetadataInspection inspection = service.inspect(executablePath);

        EXPECT_EQ(inspection.suggestedDisplayName, L"Portable Tool");
        EXPECT_EQ(inspection.displayNameSource, ExecutableDisplayNameSource::FileName);
    }

    TEST(ExecutableMetadataServiceTests, RejectsMissingAndNonExecutablePaths)
    {
        TempDirectory temp;
        const std::filesystem::path missing = temp.path() / L"missing.exe";
        const std::filesystem::path nonExecutable = temp.path() / L"tool.com";
        writeTextFile(nonExecutable, "not an exe");

        ExecutableMetadataService service;
        EXPECT_THROW(static_cast<void>(service.inspect(missing)), std::invalid_argument);
        EXPECT_THROW(static_cast<void>(service.inspect(nonExecutable)), std::invalid_argument);
    }

    TEST(ExecutableMetadataServiceTests, DoesNotApplyProcessSpecificAliases)
    {
        TempDirectory temp;
        const std::filesystem::path executablePath = temp.path() / L"modorganizer2_launcher.exe";
        writeTextFile(executablePath, "MZ executable stub");

        ExecutableMetadataService service;
        const ExecutableMetadataInspection inspection = service.inspect(executablePath);

        EXPECT_EQ(inspection.suggestedDisplayName, L"Modorganizer 2");
        EXPECT_EQ(inspection.displayNameSource, ExecutableDisplayNameSource::FileName);
    }
}
