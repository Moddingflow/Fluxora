#include <windows.h>
#include <detours.h>

#include "FluxoraVfs/VfsConfig.hpp"
#include "FluxoraVfs/VfsHooks.hpp"
#include "FluxoraVfs/VfsLog.hpp"

#include <cstdint>
#include <iterator>
#include <new>

using namespace fluxora::vfs;

namespace
{
    struct ManagerLifetimeWatcher
    {
        HMODULE module{};
        HANDLE managerProcess{};
    };

    std::wstring currentProcessImage()
    {
        wchar_t buffer[MAX_PATH * 2];
        const DWORD length = GetModuleFileNameW(nullptr, buffer, static_cast<DWORD>(std::size(buffer)));
        return std::wstring(buffer, length);
    }

    DWORD WINAPI unloadWhenManagerExits(LPVOID parameter)
    {
        auto* watcher = static_cast<ManagerLifetimeWatcher*>(parameter);
        if (watcher == nullptr)
        {
            return 0;
        }

        const DWORD waitResult = WaitForSingleObject(watcher->managerProcess, INFINITE);
        if (waitResult == WAIT_OBJECT_0)
        {
            VfsLog::write(L"FluxoraVfs manager process exited; unloading VFS hooks.");
            uninstallHooks();
        }
        else
        {
            VfsLog::writef(L"FluxoraVfs manager lifetime watcher stopped unexpectedly (%lu).", waitResult);
        }

        CloseHandle(watcher->managerProcess);
        const HMODULE module = watcher->module;
        delete watcher;

        if (waitResult == WAIT_OBJECT_0 && module != nullptr)
        {
            FreeLibraryAndExitThread(module, 0);
        }

        return 0;
    }

    bool startManagerLifetimeWatcher(HMODULE module, std::uint32_t managerProcessId)
    {
        if (managerProcessId == 0 || managerProcessId == GetCurrentProcessId())
        {
            return true;
        }

        HANDLE managerProcess = OpenProcess(SYNCHRONIZE, FALSE, managerProcessId);
        if (managerProcess == nullptr)
        {
            VfsLog::writef(
                L"FluxoraVfs could not watch manager process %lu; refusing unmanaged VFS session.",
                static_cast<unsigned long>(managerProcessId));
            return false;
        }

        const DWORD currentState = WaitForSingleObject(managerProcess, 0);
        if (currentState == WAIT_OBJECT_0)
        {
            VfsLog::writef(
                L"FluxoraVfs manager process %lu already exited; refusing stale VFS session.",
                static_cast<unsigned long>(managerProcessId));
            CloseHandle(managerProcess);
            return false;
        }

        if (currentState != WAIT_TIMEOUT)
        {
            VfsLog::writef(
                L"FluxoraVfs could not verify manager process %lu (wait result %lu).",
                static_cast<unsigned long>(managerProcessId),
                currentState);
            CloseHandle(managerProcess);
            return false;
        }

        auto* watcher = new (std::nothrow) ManagerLifetimeWatcher{module, managerProcess};
        if (watcher == nullptr)
        {
            CloseHandle(managerProcess);
            VfsLog::write(L"FluxoraVfs could not allocate manager lifetime watcher.");
            return false;
        }

        HANDLE thread = CreateThread(
            nullptr,
            0,
            &unloadWhenManagerExits,
            watcher,
            0,
            nullptr);
        if (thread == nullptr)
        {
            CloseHandle(managerProcess);
            delete watcher;
            VfsLog::write(L"FluxoraVfs could not start manager lifetime watcher.");
            return false;
        }

        CloseHandle(thread);
        VfsLog::writef(
            L"FluxoraVfs watching manager process %lu for session shutdown.",
            static_cast<unsigned long>(managerProcessId));
        return true;
    }
}

// FluxoraVfs is injected into the game (and every child process) by the manager
// through DetourCreateProcessWithDllEx. On attach it reads the descriptor named
// by FLUXORA_VFS_CONFIG, builds the merged virtual data directory and installs
// the file-system hooks. Nothing is copied: the mods stay in place and are made
// to appear inside the game folder for the lifetime of the process.
BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID /*reserved*/)
{
    // Detours spins up a tiny helper process while injecting; it must return
    // immediately without doing any work of its own.
    if (DetourIsHelperProcess())
    {
        return TRUE;
    }

    switch (reason)
    {
    case DLL_PROCESS_ATTACH:
    {
        DetourRestoreAfterWith();
        DisableThreadLibraryCalls(module);

        try
        {
            VfsConfig config;
            if (loadVfsConfigFromEnvironment(config))
            {
                VfsLog::open(config.logPath);
                VfsLog::writef(L"FluxoraVfs attached to \"%s\".", currentProcessImage().c_str());
                if (!installHooks(config))
                {
                    VfsLog::write(L"FluxoraVfs did not install hooks (nothing to virtualize or hook error).");
                }
                else if (!startManagerLifetimeWatcher(module, config.managerProcessId))
                {
                    uninstallHooks();
                    VfsLog::write(L"FluxoraVfs unloaded hooks because the VFS session has no live manager.");
                    VfsLog::close();
                    return FALSE;
                }
            }
        }
        catch (...)
        {
            // DllMain must never propagate an exception.
        }
        break;
    }

    case DLL_PROCESS_DETACH:
        try
        {
            uninstallHooks();
            VfsLog::write(L"FluxoraVfs detached.");
            VfsLog::close();
        }
        catch (...)
        {
        }
        break;

    default:
        break;
    }

    return TRUE;
}
