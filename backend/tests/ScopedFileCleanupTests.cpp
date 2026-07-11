#include "FluxoraCore/Support/ScopedFileCleanup.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <stdexcept>

namespace fluxora::tests
{
    TEST(ScopedFileCleanupTests, RemovesArmedDescriptorDuringExceptionUnwind)
    {
        TempDirectory temp;
        const std::filesystem::path descriptor = temp.path() / L"descriptor.json";
        writeTextFile(descriptor, "descriptor");

        EXPECT_THROW(
            {
                ScopedFileCleanup cleanup(descriptor);
                throw std::runtime_error("injected post-write launch failure");
            },
            std::runtime_error);
        EXPECT_FALSE(std::filesystem::exists(descriptor));
    }

    TEST(ScopedFileCleanupTests, ReleasedDescriptorRemainsForLaunchedDescendants)
    {
        TempDirectory temp;
        const std::filesystem::path descriptor = temp.path() / L"descriptor.json";
        writeTextFile(descriptor, "descriptor");

        {
            ScopedFileCleanup cleanup(descriptor);
            cleanup.release();
        }
        EXPECT_TRUE(std::filesystem::is_regular_file(descriptor));
    }
}
