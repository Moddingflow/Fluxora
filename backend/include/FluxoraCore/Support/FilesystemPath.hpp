#pragma once

#include <filesystem>
#include <string>
#include <system_error>

namespace fluxora
{
    // Windows filesystem APIs still reject legacy-length paths in processes where
    // long-path support is not enabled globally. Keep logical paths unchanged for
    // manifests, safety checks and logs, and use this form only at filesystem I/O
    // seams so callers do not need to know about the Win32 extended-path prefix.
    [[nodiscard]] inline std::filesystem::path pathForFilesystemIo(
        const std::filesystem::path& path)
    {
#ifdef _WIN32
        if (path.empty())
        {
            return path;
        }

        const std::wstring original = path.wstring();
        if (original.rfind(LR"(\\?\)", 0) == 0 ||
            original.rfind(LR"(\\.\)", 0) == 0 ||
            original.rfind(LR"(\??\)", 0) == 0)
        {
            return path;
        }

        std::filesystem::path fullPath = path;
        if (!fullPath.is_absolute())
        {
            std::error_code error;
            const std::filesystem::path absolutePath = std::filesystem::absolute(fullPath, error);
            if (error)
            {
                return path;
            }
            fullPath = absolutePath;
        }

        fullPath = fullPath.lexically_normal();
        fullPath.make_preferred();
        const std::wstring value = fullPath.wstring();
        if (value.rfind(LR"(\\)", 0) == 0)
        {
            return std::filesystem::path(LR"(\\?\UNC\)" + value.substr(2));
        }

        return std::filesystem::path(LR"(\\?\)" + value);
#else
        return path;
#endif
    }
}
