#include "FluxoraCore/Support/LaunchDescriptorStore.hpp"

#include <string>
#include <string_view>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    void pruneDeadManagerLaunchDescriptors(
        const std::filesystem::path& sessionsDirectory,
        std::uint32_t currentManagerProcessId)
    {
#ifdef _WIN32
        constexpr std::wstring_view prefix = L"vfs-config-";
        std::error_code error;
        if (!std::filesystem::is_directory(sessionsDirectory, error))
        {
            return;
        }

        for (const std::filesystem::directory_entry& entry :
             std::filesystem::directory_iterator(sessionsDirectory, error))
        {
            if (error || !entry.is_regular_file(error))
            {
                error.clear();
                continue;
            }

            const std::wstring fileName = entry.path().filename().wstring();
            if (fileName.rfind(prefix, 0) != 0 || entry.path().extension() != L".json")
            {
                continue;
            }
            const std::size_t processEnd = fileName.find(L'-', prefix.size());
            if (processEnd == std::wstring::npos)
            {
                continue;
            }

            std::uint32_t processId = 0;
            try
            {
                const unsigned long long parsed = std::stoull(
                    fileName.substr(prefix.size(), processEnd - prefix.size()));
                if (parsed > MAXDWORD)
                {
                    continue;
                }
                processId = static_cast<std::uint32_t>(parsed);
            }
            catch (...)
            {
                continue;
            }
            if (processId == 0 || processId == currentManagerProcessId)
            {
                continue;
            }

            HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, processId);
            bool managerExited = false;
            if (process == nullptr)
            {
                managerExited = GetLastError() == ERROR_INVALID_PARAMETER;
            }
            else
            {
                managerExited = WaitForSingleObject(process, 0) == WAIT_OBJECT_0;
                CloseHandle(process);
            }
            if (managerExited)
            {
                error.clear();
                std::filesystem::remove(entry.path(), error);
            }
        }
#else
        (void)sessionsDirectory;
        (void)currentManagerProcessId;
#endif
    }
}
