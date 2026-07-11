#include "FluxoraVfs/VfsEnvironment.hpp"

#include <gtest/gtest.h>

#include <string>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        std::vector<std::wstring> entries(const std::vector<wchar_t>& block)
        {
            std::vector<std::wstring> result;
            const wchar_t* cursor = block.data();
            while (*cursor != L'\0')
            {
                result.emplace_back(cursor);
                cursor += result.back().size() + 1U;
            }
            return result;
        }
    }

    TEST(VfsEnvironmentTests, ReplacesConfigAndSortsWithPseudoVariablesFirst)
    {
        const wchar_t source[] =
            L"USERNAME=User\0=D:=D:\\Games\0Path=C:\\Windows\0"
            L"fluxora_vfs_config=C:\\old.json\0=C:=C:\\Work\0\0";

        const std::vector<wchar_t> block = vfs::environment::withVariable(
            source,
            L"FLUXORA_VFS_CONFIG",
            L"C:\\sessions\\new.json");

        EXPECT_EQ(
            entries(block),
            (std::vector<std::wstring>{
                L"=C:=C:\\Work",
                L"=D:=D:\\Games",
                L"FLUXORA_VFS_CONFIG=C:\\sessions\\new.json",
                L"Path=C:\\Windows",
                L"USERNAME=User"
            }));
        ASSERT_GE(block.size(), 2U);
        EXPECT_EQ(block[block.size() - 1U], L'\0');
        EXPECT_EQ(block[block.size() - 2U], L'\0');
    }

    TEST(VfsEnvironmentTests, AddsMissingConfigInSortedOrderWithoutChangingTheSourceBlock)
    {
        const wchar_t source[] = L"Path=C:\\Windows\0USERNAME=User\0\0";

        const std::vector<wchar_t> block = vfs::environment::withVariable(
            source,
            L"FLUXORA_VFS_CONFIG",
            L"C:\\sessions\\new.json");

        EXPECT_EQ(
            entries(block),
            (std::vector<std::wstring>{
                L"FLUXORA_VFS_CONFIG=C:\\sessions\\new.json",
                L"Path=C:\\Windows",
                L"USERNAME=User"
            }));
        EXPECT_STREQ(source, L"Path=C:\\Windows");
    }

    TEST(VfsEnvironmentTests, RejectsInvalidInputs)
    {
        const wchar_t source[] = L"Path=C:\\Windows\0\0";
        EXPECT_THROW(
            (void)vfs::environment::withVariable(nullptr, L"FLUXORA_VFS_CONFIG", L"value"),
            std::invalid_argument);
        EXPECT_THROW(
            (void)vfs::environment::withVariable(source, L"INVALID=NAME", L"value"),
            std::invalid_argument);
    }
}
