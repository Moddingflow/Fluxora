#include "FluxoraInstaller/RecoveryServices.hpp"

#include "FluxoraInstaller/ApplicationLaunchService.hpp"

#include <chrono>
#include <stdexcept>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace
{
    constexpr wchar_t RunOncePath[] =
        L"Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";
    constexpr std::size_t MaximumRecoveryCommandCharacters = 2048;
    constexpr std::uint64_t WatchdogIdentityToleranceTicks = 10ULL * 10'000ULL;

    class RegistryKey final
    {
    public:
        explicit RegistryKey(HKEY key = nullptr) noexcept : key_(key) {}
        RegistryKey(const RegistryKey&) = delete;
        RegistryKey& operator=(const RegistryKey&) = delete;
        RegistryKey(RegistryKey&& other) noexcept
            : key_(std::exchange(other.key_, nullptr)) {}
        ~RegistryKey()
        {
            if (key_ != nullptr)
            {
                RegCloseKey(key_);
            }
        }
        [[nodiscard]] HKEY get() const noexcept { return key_; }

    private:
        HKEY key_;
    };

    class UniqueHandle final
    {
    public:
        explicit UniqueHandle(HANDLE handle = nullptr) noexcept : handle_(handle) {}
        UniqueHandle(const UniqueHandle&) = delete;
        UniqueHandle& operator=(const UniqueHandle&) = delete;
        UniqueHandle(UniqueHandle&& other) noexcept
            : handle_(std::exchange(other.handle_, nullptr)) {}
        ~UniqueHandle()
        {
            if (handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE)
            {
                CloseHandle(handle_);
            }
        }
        [[nodiscard]] HANDLE get() const noexcept { return handle_; }

    private:
        HANDLE handle_;
    };

    std::filesystem::path canonicalAbsolutePath(
        const std::filesystem::path& path,
        const char* label)
    {
        if (path.empty() || !path.is_absolute())
        {
            throw std::invalid_argument(std::string(label) + " must be absolute.");
        }
        const std::wstring raw = path.wstring();
        if (raw.find(L'\0') != std::wstring::npos ||
            raw.find(L'"') != std::wstring::npos ||
            raw.find(L'\r') != std::wstring::npos ||
            raw.find(L'\n') != std::wstring::npos)
        {
            throw std::invalid_argument(std::string(label) + " is not safe for recovery.");
        }
        return std::filesystem::absolute(path).lexically_normal();
    }

    bool pathEquals(
        const std::filesystem::path& left,
        const std::filesystem::path& right)
    {
        const std::wstring leftValue = canonicalAbsolutePath(left, "path").wstring();
        const std::wstring rightValue = canonicalAbsolutePath(right, "path").wstring();
        return CompareStringOrdinal(
            leftValue.c_str(),
            static_cast<int>(leftValue.size()),
            rightValue.c_str(),
            static_cast<int>(rightValue.size()),
            TRUE) == CSTR_EQUAL;
    }

    std::uint64_t processStartFileTime(HANDLE process)
    {
        FILETIME created{}, exited{}, kernel{}, user{};
        if (!GetProcessTimes(process, &created, &exited, &kernel, &user))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Watchdog owner start time is unavailable");
        }
        ULARGE_INTEGER ticks{};
        ticks.LowPart = created.dwLowDateTime;
        ticks.HighPart = created.dwHighDateTime;
        return ticks.QuadPart;
    }

    std::filesystem::path processExecutablePath(HANDLE process)
    {
        std::wstring path(32768, L'\0');
        DWORD length = static_cast<DWORD>(path.size());
        if (!QueryFullProcessImageNameW(process, 0, path.data(), &length) || length == 0)
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Watchdog owner executable is unavailable");
        }
        path.resize(length);
        return path;
    }

    void signalReady(std::wstring_view eventName)
    {
        UniqueHandle ready(OpenEventW(
            EVENT_MODIFY_STATE,
            FALSE,
            std::wstring(eventName).c_str()));
        if (ready.get() == nullptr)
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Update recovery watchdog ready event is unavailable");
        }
        if (!SetEvent(ready.get()))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Update recovery watchdog could not signal readiness");
        }
    }

    void waitForExactOwner(
        std::uint32_t ownerPid,
        std::uint64_t ownerStartFileTime,
        const std::filesystem::path& expectedExecutable)
    {
        UniqueHandle owner(OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            FALSE,
            ownerPid));
        if (owner.get() == nullptr)
        {
            if (GetLastError() == ERROR_INVALID_PARAMETER)
            {
                return;
            }
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Update recovery watchdog could not inspect its owner");
        }
        if (WaitForSingleObject(owner.get(), 0) == WAIT_OBJECT_0)
        {
            return;
        }
        const std::uint64_t observedStart = processStartFileTime(owner.get());
        const std::uint64_t difference = observedStart > ownerStartFileTime
            ? observedStart - ownerStartFileTime
            : ownerStartFileTime - observedStart;
        if (difference > WatchdogIdentityToleranceTicks ||
            !pathEquals(processExecutablePath(owner.get()), expectedExecutable))
        {
            return; // Exact owner already exited and the PID was reused.
        }
        if (WaitForSingleObject(owner.get(), INFINITE) != WAIT_OBJECT_0)
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Update recovery watchdog could not wait for its owner");
        }
    }
}

namespace fluxora::installer
{
    void WindowsRunOnceStore::set(
        std::wstring_view name,
        std::wstring_view command)
    {
        HKEY rawKey = nullptr;
        const LSTATUS create = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            RunOncePath,
            0,
            nullptr,
            0,
            KEY_QUERY_VALUE | KEY_SET_VALUE,
            nullptr,
            &rawKey,
            nullptr);
        if (create != ERROR_SUCCESS)
        {
            throw std::system_error(
                static_cast<int>(create),
                std::system_category(),
                "Current-user RunOnce is unavailable");
        }
        RegistryKey key(rawKey);
        const std::wstring nameValue(name);
        const std::wstring commandValue(command);
        const DWORD bytes = static_cast<DWORD>((commandValue.size() + 1) * sizeof(wchar_t));
        const LSTATUS written = RegSetValueExW(
            key.get(),
            nameValue.c_str(),
            0,
            REG_SZ,
            reinterpret_cast<const BYTE*>(commandValue.c_str()),
            bytes);
        if (written != ERROR_SUCCESS)
        {
            throw std::system_error(
                static_cast<int>(written),
                std::system_category(),
                "Durable update recovery could not be written");
        }
        DWORD type = 0;
        DWORD actualBytes = 0;
        LSTATUS queried = RegQueryValueExW(
            key.get(),
            nameValue.c_str(),
            nullptr,
            &type,
            nullptr,
            &actualBytes);
        if (queried != ERROR_SUCCESS || type != REG_SZ || actualBytes != bytes)
        {
            throw std::runtime_error("Durable update recovery could not be verified.");
        }
        std::wstring observed(actualBytes / sizeof(wchar_t), L'\0');
        queried = RegQueryValueExW(
            key.get(),
            nameValue.c_str(),
            nullptr,
            &type,
            reinterpret_cast<BYTE*>(observed.data()),
            &actualBytes);
        if (queried != ERROR_SUCCESS)
        {
            throw std::runtime_error("Durable update recovery could not be verified.");
        }
        if (!observed.empty() && observed.back() == L'\0')
        {
            observed.pop_back();
        }
        if (observed != commandValue)
        {
            throw std::runtime_error("Durable update recovery could not be verified.");
        }
    }

    void WindowsRunOnceStore::remove(std::wstring_view name)
    {
        HKEY rawKey = nullptr;
        const LSTATUS opened = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            RunOncePath,
            0,
            KEY_SET_VALUE,
            &rawKey);
        if (opened == ERROR_FILE_NOT_FOUND)
        {
            return;
        }
        if (opened != ERROR_SUCCESS)
        {
            throw std::system_error(
                static_cast<int>(opened),
                std::system_category(),
                "Current-user RunOnce is unavailable");
        }
        RegistryKey key(rawKey);
        const LSTATUS removed = RegDeleteValueW(
            key.get(),
            std::wstring(name).c_str());
        if (removed != ERROR_SUCCESS && removed != ERROR_FILE_NOT_FOUND)
        {
            throw std::system_error(
                static_cast<int>(removed),
                std::system_category(),
                "Durable update recovery could not be removed");
        }
    }

    RecoveryActivation::RecoveryActivation(IRunOnceStore& store) : store_(store) {}

    void RecoveryActivation::arm(
        const UpdateWorkflowRequest& request,
        const std::filesystem::path& updaterExecutable) const
    {
        if (request.recoveryInvocation)
        {
            throw std::logic_error(
                "A RunOnce recovery invocation cannot arm another RunOnce entry.");
        }
        store_.set(valueName(request), recoveryCommand(request, updaterExecutable));
    }

    void RecoveryActivation::complete(const UpdateWorkflowRequest& request) const
    {
        if (!request.recoveryInvocation)
        {
            store_.remove(valueName(request));
        }
    }

    std::wstring RecoveryActivation::valueName(
        const UpdateWorkflowRequest& request)
    {
        if (!isSafeOperationId(request.operationId))
        {
            throw std::invalid_argument("Recovery operation identifier is invalid.");
        }
        return L"!FluxoraUpdateRecovery-" +
            std::wstring(request.operationId.begin(), request.operationId.end());
    }

    std::wstring RecoveryActivation::recoveryCommand(
        const UpdateWorkflowRequest& request,
        const std::filesystem::path& updaterExecutable)
    {
        const std::filesystem::path executable =
            canonicalAbsolutePath(updaterExecutable, "Updater executable");
        const std::filesystem::path requestPath =
            canonicalAbsolutePath(request.requestPath, "Update request");
        const std::wstring command =
            L"\"" + executable.wstring() + L"\" --recover-request \"" +
            requestPath.wstring() + L"\"";
        if (command.size() > MaximumRecoveryCommandCharacters)
        {
            throw std::invalid_argument("Update recovery command is too long.");
        }
        return command;
    }

    void RecoveryWatchdogService::arm(
        const UpdateWorkflowRequest& request,
        const std::filesystem::path& updaterExecutable) const
    {
        if (request.recoveryInvocation)
        {
            throw std::logic_error("A recovery invocation cannot arm another watchdog.");
        }
        const std::filesystem::path executable =
            canonicalAbsolutePath(updaterExecutable, "Updater executable");
        const std::wstring eventName = expectedReadyEventName(request);
        UniqueHandle ready(CreateEventW(
            nullptr,
            TRUE,
            FALSE,
            eventName.c_str()));
        if (ready.get() == nullptr)
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Update recovery watchdog ready event could not be created");
        }
        if (GetLastError() == ERROR_ALREADY_EXISTS)
        {
            throw std::runtime_error(
                "Update recovery watchdog ready event nonce was already used.");
        }
        const std::uint64_t start = processStartFileTime(GetCurrentProcess());
        const std::uint32_t pid = GetCurrentProcessId();
        std::wstring command =
            ApplicationLaunchService::quoteWindowsArgument(executable.wstring()) +
            L" --recovery-watchdog " +
            ApplicationLaunchService::quoteWindowsArgument(request.requestPath.wstring()) +
            L" " + std::to_wstring(pid) +
            L" " + std::to_wstring(start) +
            L" " + ApplicationLaunchService::quoteWindowsArgument(eventName);
        std::vector<wchar_t> mutableCommand(command.begin(), command.end());
        mutableCommand.push_back(L'\0');
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION watchdog{};
        if (!CreateProcessW(
                executable.c_str(),
                mutableCommand.data(),
                nullptr,
                nullptr,
                FALSE,
                CREATE_NO_WINDOW,
                nullptr,
                request.updaterWorkingDirectory.c_str(),
                &startup,
                &watchdog))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Update recovery watchdog could not be launched");
        }
        UniqueHandle watchdogProcess(watchdog.hProcess);
        UniqueHandle watchdogThread(watchdog.hThread);
        if (WaitForSingleObject(ready.get(), 5000) != WAIT_OBJECT_0)
        {
            TerminateProcess(watchdogProcess.get(), 1);
            throw std::runtime_error(
                "Update recovery watchdog did not become ready.");
        }
    }

    void RecoveryWatchdogService::run(
        const UpdateWorkflowRequest& request,
        const std::filesystem::path& updaterExecutable,
        const RecoveryWatchdogInvocation& invocation,
        const std::function<void()>& recover) const
    {
        if (!recover)
        {
            throw std::invalid_argument("Recovery watchdog callback is required.");
        }
        validateInvocation(request, invocation);
        signalReady(invocation.readyEventName);
        waitForExactOwner(
            invocation.ownerPid,
            invocation.ownerStartFileTime,
            updaterExecutable);
        recover();
    }

    std::wstring RecoveryWatchdogService::expectedReadyEventName(
        const UpdateWorkflowRequest& request)
    {
        if (!isLowerHexSha256(request.handoffNonce))
        {
            throw std::invalid_argument("Recovery watchdog nonce is invalid.");
        }
        return L"Local\\FluxoraUpdateWatchdog-" +
            std::wstring(request.handoffNonce.begin(), request.handoffNonce.end());
    }

    void RecoveryWatchdogService::validateInvocation(
        const UpdateWorkflowRequest& request,
        const RecoveryWatchdogInvocation& invocation)
    {
        if (invocation.ownerPid == 0 ||
            invocation.ownerStartFileTime == 0 ||
            invocation.readyEventName != expectedReadyEventName(request) ||
            invocation.requestPath.empty() ||
            !pathEquals(invocation.requestPath, request.requestPath))
        {
            throw std::invalid_argument("Recovery watchdog arguments are invalid.");
        }
    }
}
