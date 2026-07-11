#pragma once

#include <string_view>
#include <vector>

namespace fluxora::vfs::environment
{
    [[nodiscard]] std::vector<wchar_t> withVariable(
        const wchar_t* environmentBlock,
        std::wstring_view name,
        std::wstring_view value);

#ifdef _WIN32
    [[nodiscard]] std::vector<wchar_t> currentWithVariable(
        std::wstring_view name,
        std::wstring_view value);
#endif
}
