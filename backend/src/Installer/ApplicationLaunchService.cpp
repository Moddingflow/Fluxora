#include "FluxoraInstaller/ApplicationLaunchService.hpp"

#include "FluxoraInstaller/UpdateWorkflowRequest.hpp"

#include <algorithm>
#include <chrono>
#include <stdexcept>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

namespace
{
    constexpr DWORD CreateSuspended = CREATE_SUSPENDED;
    constexpr std::uint64_t IdentityToleranceTicks = 10ULL * 10'000ULL;

    std::uint64_t processStartFileTime(HANDLE process)
    {
        FILETIME created{}, exited{}, kernel{}, user{};
        if (!GetProcessTimes(process, &created, &exited, &kernel, &user))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Launched process start time is unavailable");
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
                "Launched process executable path is unavailable");
        }
        path.resize(length);
        return path;
    }

    bool pathEquals(
        const std::filesystem::path& left,
        const std::filesystem::path& right)
    {
        const std::wstring leftValue = std::filesystem::absolute(left).lexically_normal().wstring();
        const std::wstring rightValue = std::filesystem::absolute(right).lexically_normal().wstring();
        return CompareStringOrdinal(
            leftValue.c_str(),
            static_cast<int>(leftValue.size()),
            rightValue.c_str(),
            static_cast<int>(rightValue.size()),
            TRUE) == CSTR_EQUAL;
    }

    struct JobBasicLimitInformation final
    {
        LARGE_INTEGER perProcessUserTimeLimit{};
        LARGE_INTEGER perJobUserTimeLimit{};
        DWORD limitFlags{0};
        SIZE_T minimumWorkingSetSize{0};
        SIZE_T maximumWorkingSetSize{0};
        DWORD activeProcessLimit{0};
        ULONG_PTR affinity{0};
        DWORD priorityClass{0};
        DWORD schedulingClass{0};
    };

    struct IoCounters final
    {
        ULONGLONG readOperationCount{0};
        ULONGLONG writeOperationCount{0};
        ULONGLONG otherOperationCount{0};
        ULONGLONG readTransferCount{0};
        ULONGLONG writeTransferCount{0};
        ULONGLONG otherTransferCount{0};
    };

    struct JobExtendedLimitInformation final
    {
        JobBasicLimitInformation basicLimitInformation{};
        IoCounters ioInfo{};
        SIZE_T processMemoryLimit{0};
        SIZE_T jobMemoryLimit{0};
        SIZE_T peakProcessMemoryUsed{0};
        SIZE_T peakJobMemoryUsed{0};
    };

    struct JobBasicAccountingInformation final
    {
        LARGE_INTEGER totalUserTime{};
        LARGE_INTEGER totalKernelTime{};
        LARGE_INTEGER thisPeriodTotalUserTime{};
        LARGE_INTEGER thisPeriodTotalKernelTime{};
        DWORD totalPageFaultCount{0};
        DWORD totalProcesses{0};
        DWORD activeProcesses{0};
        DWORD totalTerminatedProcesses{0};
    };
}

namespace fluxora::installer
{
    WindowsProcessJob::WindowsProcessJob(HANDLE handle) noexcept : handle_(handle) {}

    WindowsProcessJob::WindowsProcessJob(WindowsProcessJob&& other) noexcept
        : handle_(std::exchange(other.handle_, nullptr)),
          released_(std::exchange(other.released_, false))
    {
    }

    WindowsProcessJob& WindowsProcessJob::operator=(WindowsProcessJob&& other) noexcept
    {
        if (this != &other)
        {
            close();
            handle_ = std::exchange(other.handle_, nullptr);
            released_ = std::exchange(other.released_, false);
        }
        return *this;
    }

    WindowsProcessJob::~WindowsProcessJob()
    {
        close();
    }

    WindowsProcessJob WindowsProcessJob::create()
    {
        HANDLE handle = CreateJobObjectW(nullptr, nullptr);
        if (handle == nullptr)
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Could not create the updater process job");
        }
        WindowsProcessJob job(handle);
        try
        {
            job.setKillOnClose(true);
        }
        catch (...)
        {
            job.close();
            throw;
        }
        return job;
    }

    void WindowsProcessJob::associate(HANDLE processHandle)
    {
        if (handle_ == nullptr || released_ || processHandle == nullptr)
        {
            throw std::logic_error("Updater process job is unavailable for association.");
        }
        if (!AssignProcessToJobObject(handle_, processHandle))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Could not assign Fluxora to the updater process job");
        }
    }

    void WindowsProcessJob::terminateEntireTree()
    {
        if (handle_ == nullptr || released_)
        {
            return;
        }
        if (!TerminateJobObject(handle_, 1))
        {
            const DWORD error = GetLastError();
            if (error != ERROR_ACCESS_DENIED)
            {
                throw std::system_error(
                    static_cast<int>(error),
                    std::system_category(),
                    "Could not terminate the updated Fluxora process tree");
            }
        }
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
        for (;;)
        {
            JobBasicAccountingInformation information{};
            if (!QueryInformationJobObject(
                    handle_,
                    JobObjectBasicAccountingInformation,
                    &information,
                    sizeof(information),
                    nullptr))
            {
                throw std::system_error(
                    static_cast<int>(GetLastError()),
                    std::system_category(),
                    "Could not verify process-tree termination");
            }
            if (information.activeProcesses == 0)
            {
                return;
            }
            if (std::chrono::steady_clock::now() >= deadline)
            {
                throw std::runtime_error(
                    "The updated Fluxora process tree did not terminate completely.");
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
    }

    void WindowsProcessJob::release()
    {
        if (handle_ == nullptr || released_)
        {
            return;
        }
        setKillOnClose(false);
        released_ = true;
        close();
    }

    bool WindowsProcessJob::active() const noexcept
    {
        return handle_ != nullptr && !released_;
    }

    void WindowsProcessJob::close() noexcept
    {
        if (handle_ != nullptr)
        {
            CloseHandle(handle_);
            handle_ = nullptr;
        }
    }

    void WindowsProcessJob::setKillOnClose(bool enabled)
    {
        JobExtendedLimitInformation information{};
        information.basicLimitInformation.limitFlags =
            enabled ? JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE : 0;
        if (!SetInformationJobObject(
                handle_,
                JobObjectExtendedLimitInformation,
                &information,
                sizeof(information)))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Could not configure the updater process job");
        }
    }

    LaunchedApplication::LaunchedApplication(
        HANDLE processHandle,
        std::uint32_t processId,
        std::uint64_t startFileTime,
        std::filesystem::path executablePath,
        WindowsProcessJob job)
        : processHandle_(processHandle),
          processId_(processId),
          startFileTime_(startFileTime),
          executablePath_(std::move(executablePath)),
          job_(std::move(job))
    {
    }

    LaunchedApplication::LaunchedApplication(LaunchedApplication&& other) noexcept
        : processHandle_(std::exchange(other.processHandle_, nullptr)),
          processId_(std::exchange(other.processId_, 0)),
          startFileTime_(std::exchange(other.startFileTime_, 0)),
          executablePath_(std::move(other.executablePath_)),
          job_(std::move(other.job_))
    {
    }

    LaunchedApplication& LaunchedApplication::operator=(LaunchedApplication&& other) noexcept
    {
        if (this != &other)
        {
            close();
            processHandle_ = std::exchange(other.processHandle_, nullptr);
            processId_ = std::exchange(other.processId_, 0);
            startFileTime_ = std::exchange(other.startFileTime_, 0);
            executablePath_ = std::move(other.executablePath_);
            job_ = std::move(other.job_);
        }
        return *this;
    }

    LaunchedApplication::~LaunchedApplication()
    {
        close();
    }

    std::uint32_t LaunchedApplication::processId() const noexcept
    {
        return processId_;
    }

    std::uint64_t LaunchedApplication::startFileTime() const noexcept
    {
        return startFileTime_;
    }

    const std::filesystem::path& LaunchedApplication::executablePath() const noexcept
    {
        return executablePath_;
    }

    bool LaunchedApplication::hasExited() const
    {
        if (processHandle_ == nullptr)
        {
            return true;
        }
        const DWORD result = WaitForSingleObject(processHandle_, 0);
        if (result == WAIT_OBJECT_0)
        {
            return true;
        }
        if (result == WAIT_TIMEOUT)
        {
            return false;
        }
        throw std::system_error(
            static_cast<int>(GetLastError()),
            std::system_category(),
            "Updated Fluxora process state is unavailable");
    }

    void LaunchedApplication::terminateIfRunning()
    {
        if (processHandle_ == nullptr)
        {
            return;
        }
        if (!hasExited())
        {
            const std::uint64_t observedStart = processStartFileTime(processHandle_);
            const std::uint64_t difference = observedStart > startFileTime_
                ? observedStart - startFileTime_
                : startFileTime_ - observedStart;
            if (difference > IdentityToleranceTicks ||
                !pathEquals(processExecutablePath(processHandle_), executablePath_))
            {
                throw std::runtime_error(
                    "Refused to terminate a process whose identity no longer matches the launched update.");
            }
        }
        job_.terminateEntireTree();
        if (WaitForSingleObject(processHandle_, 10'000) == WAIT_TIMEOUT)
        {
            throw std::runtime_error("Updated Fluxora did not terminate after its job was stopped.");
        }
    }

    void LaunchedApplication::releaseProcessTree()
    {
        job_.release();
    }

    void LaunchedApplication::close() noexcept
    {
        if (processHandle_ != nullptr)
        {
            CloseHandle(processHandle_);
            processHandle_ = nullptr;
        }
    }

    LaunchedApplication ApplicationLaunchService::launchUpdated(
        const UpdateWorkflowRequest& request) const
    {
        const std::filesystem::path applicationPath = request.applicationPath();
        const DWORD attributes = GetFileAttributesW(applicationPath.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES ||
            (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 ||
            (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::invalid_argument("Fluxora executable is unavailable or unsafe.");
        }
        std::wstring commandLine = createUpdatedCommandLine(
            applicationPath,
            request.handoffNonce,
            request.operationId);
        std::vector<wchar_t> mutableCommandLine(commandLine.begin(), commandLine.end());
        mutableCommandLine.push_back(L'\0');
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        WindowsProcessJob job = WindowsProcessJob::create();
        if (!CreateProcessW(
                applicationPath.c_str(),
                mutableCommandLine.data(),
                nullptr,
                nullptr,
                FALSE,
                CreateSuspended,
                nullptr,
                request.installDirectory.c_str(),
                &startup,
                &process))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Fluxora could not be created for health validation");
        }
        try
        {
            job.associate(process.hProcess);
            if (ResumeThread(process.hThread) == static_cast<DWORD>(-1))
            {
                throw std::system_error(
                    static_cast<int>(GetLastError()),
                    std::system_category(),
                    "Updated Fluxora could not be resumed after process-tree containment");
            }
            CloseHandle(process.hThread);
            process.hThread = nullptr;
            const std::uint64_t start = processStartFileTime(process.hProcess);
            const std::filesystem::path observed = processExecutablePath(process.hProcess);
            if (!pathEquals(observed, applicationPath))
            {
                throw std::runtime_error(
                    "Launched process does not match the updated Fluxora executable.");
            }
            return LaunchedApplication(
                process.hProcess,
                process.dwProcessId,
                start,
                observed,
                std::move(job));
        }
        catch (...)
        {
            if (process.hThread != nullptr)
            {
                CloseHandle(process.hThread);
            }
            if (process.hProcess != nullptr)
            {
                if (!job.active())
                {
                    TerminateProcess(process.hProcess, 1);
                }
                CloseHandle(process.hProcess);
            }
            throw;
        }
    }

    void ApplicationLaunchService::launchPrevious(
        const UpdateWorkflowRequest& request) const
    {
        const std::filesystem::path applicationPath = request.applicationPath();
        std::wstring commandLine = quoteWindowsArgument(applicationPath.wstring());
        std::vector<wchar_t> mutableCommandLine(commandLine.begin(), commandLine.end());
        mutableCommandLine.push_back(L'\0');
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        if (!CreateProcessW(
                applicationPath.c_str(),
                mutableCommandLine.data(),
                nullptr,
                nullptr,
                FALSE,
                0,
                nullptr,
                request.installDirectory.c_str(),
                &startup,
                &process))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "The previous Fluxora version could not be relaunched");
        }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }

    std::wstring ApplicationLaunchService::createUpdatedCommandLine(
        const std::filesystem::path& applicationPath,
        std::string_view handoffNonce,
        std::string_view operationId)
    {
        if (!isLowerHexSha256(handoffNonce) ||
            !isSafeOperationId(operationId))
        {
            throw std::invalid_argument(
                "Update handoff nonce or operation identifier is invalid.");
        }
        const std::wstring nonce(handoffNonce.begin(), handoffNonce.end());
        const std::wstring operation(operationId.begin(), operationId.end());
        return quoteWindowsArgument(std::filesystem::absolute(applicationPath).wstring()) +
            L" --fluxora-update-handoff " + quoteWindowsArgument(nonce) +
            L" --fluxora-update-operation-id " +
            quoteWindowsArgument(operation);
    }

    std::wstring ApplicationLaunchService::quoteWindowsArgument(
        std::wstring_view value)
    {
        if (value.empty())
        {
            throw std::invalid_argument("Windows command argument cannot be empty.");
        }
        if (value.find_first_of(L" \t\"") == std::wstring_view::npos)
        {
            return std::wstring(value);
        }
        std::wstring quoted;
        quoted.reserve(value.size() + 2);
        quoted.push_back(L'"');
        std::size_t backslashes = 0;
        for (const wchar_t character : value)
        {
            if (character == L'\\')
            {
                ++backslashes;
                continue;
            }
            if (character == L'"')
            {
                quoted.append(backslashes * 2 + 1, L'\\');
                quoted.push_back(L'"');
                backslashes = 0;
                continue;
            }
            quoted.append(backslashes, L'\\');
            backslashes = 0;
            quoted.push_back(character);
        }
        quoted.append(backslashes * 2, L'\\');
        quoted.push_back(L'"');
        return quoted;
    }
}
