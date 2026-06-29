#include "FluxoraVfs/VfsLifecycle.hpp"

namespace fluxora::vfs
{
    namespace
    {
        [[nodiscard]] bool isWhitespace(wchar_t value) noexcept
        {
            return value == L' ' || value == L'\t' || value == L'\r' || value == L'\n';
        }

        [[nodiscard]] std::wstring_view trim(std::wstring_view value) noexcept
        {
            while (!value.empty() && isWhitespace(value.front()))
            {
                value.remove_prefix(1);
            }
            while (!value.empty() && isWhitespace(value.back()))
            {
                value.remove_suffix(1);
            }
            return value;
        }

        [[nodiscard]] std::wstring_view firstCommandLineToken(std::wstring_view commandLine) noexcept
        {
            std::wstring_view value = trim(commandLine);
            if (value.empty())
            {
                return {};
            }

            if (value.front() == L'"')
            {
                value.remove_prefix(1);
                const std::size_t endQuote = value.find(L'"');
                return endQuote == std::wstring_view::npos ? value : value.substr(0, endQuote);
            }

            const std::size_t separator = value.find_first_of(L" \t\r\n");
            return separator == std::wstring_view::npos ? value : value.substr(0, separator);
        }

        [[nodiscard]] std::wstring_view fileName(std::wstring_view path) noexcept
        {
            std::wstring_view value = trim(path);
            while (!value.empty() && (value.front() == L'"' || value.front() == L'\''))
            {
                value.remove_prefix(1);
            }
            while (!value.empty() && (value.back() == L'"' || value.back() == L'\''))
            {
                value.remove_suffix(1);
            }

            const std::size_t separator = value.find_last_of(L"\\/");
            return separator == std::wstring_view::npos ? value : value.substr(separator + 1);
        }

        [[nodiscard]] wchar_t asciiLower(wchar_t value) noexcept
        {
            return value >= L'A' && value <= L'Z'
                ? static_cast<wchar_t>(value - L'A' + L'a')
                : value;
        }

        [[nodiscard]] bool equalsAsciiIgnoreCase(
            std::wstring_view left,
            std::wstring_view right) noexcept
        {
            if (left.size() != right.size())
            {
                return false;
            }

            for (std::size_t index = 0; index < left.size(); ++index)
            {
                if (asciiLower(left[index]) != asciiLower(right[index]))
                {
                    return false;
                }
            }

            return true;
        }

        [[nodiscard]] bool isSteamBootstrapProcess(std::wstring_view processImage) noexcept
        {
            const std::wstring_view name = fileName(processImage);
            return equalsAsciiIgnoreCase(name, L"steam.exe") ||
                equalsAsciiIgnoreCase(name, L"steamservice.exe") ||
                equalsAsciiIgnoreCase(name, L"steamwebhelper.exe") ||
                equalsAsciiIgnoreCase(name, L"gameoverlayui.exe") ||
                equalsAsciiIgnoreCase(name, L"steamerrorreporter.exe");
        }
    }

    ManagerLifetimeWatchPlan managerLifetimeWatchPlan(
        std::uint32_t managerProcessId,
        std::uint32_t currentProcessId) noexcept
    {
        if (managerProcessId == 0)
        {
            return ManagerLifetimeWatchPlan::RefuseMissingManager;
        }

        if (managerProcessId == currentProcessId)
        {
            return ManagerLifetimeWatchPlan::CurrentProcessOwnsSession;
        }

        return ManagerLifetimeWatchPlan::WatchExternalManager;
    }

    ChildProcessVirtualizationPlan childProcessVirtualizationPlan(
        std::wstring_view applicationName,
        std::wstring_view commandLine) noexcept
    {
        if (isSteamBootstrapProcess(applicationName) ||
            isSteamBootstrapProcess(firstCommandLineToken(commandLine)))
        {
            return ChildProcessVirtualizationPlan::LaunchExternalBootstrap;
        }

        return ChildProcessVirtualizationPlan::InjectVirtualizedChild;
    }
}
