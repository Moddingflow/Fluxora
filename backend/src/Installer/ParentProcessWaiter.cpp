#include "FluxoraInstaller/ParentProcessWaiter.hpp"

#include <algorithm>
#include <array>
#include <stdexcept>
#include <system_error>
#include <utility>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace
{
    constexpr std::uint64_t StartTimeToleranceTicks = 2ULL * 10'000'000ULL;

    class UniqueHandle final
    {
    public:
        explicit UniqueHandle(HANDLE handle = nullptr) noexcept : handle_(handle) {}
        UniqueHandle(const UniqueHandle&) = delete;
        UniqueHandle& operator=(const UniqueHandle&) = delete;
        UniqueHandle(UniqueHandle&& other) noexcept
            : handle_(std::exchange(other.handle_, nullptr)) {}
        UniqueHandle& operator=(UniqueHandle&& other) noexcept
        {
            if (this != &other)
            {
                reset();
                handle_ = std::exchange(other.handle_, nullptr);
            }
            return *this;
        }
        ~UniqueHandle() { reset(); }
        [[nodiscard]] HANDLE get() const noexcept { return handle_; }
        void reset() noexcept
        {
            if (handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE)
            {
                CloseHandle(handle_);
            }
            handle_ = nullptr;
        }

    private:
        HANDLE handle_;
    };

    std::uint64_t fileTimeValue(const FILETIME& value)
    {
        ULARGE_INTEGER ticks{};
        ticks.LowPart = value.dwLowDateTime;
        ticks.HighPart = value.dwHighDateTime;
        return ticks.QuadPart;
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

    class SystemParentProcess final : public fluxora::installer::IParentProcess
    {
    public:
        explicit SystemParentProcess(HANDLE handle) : handle_(handle) {}

        [[nodiscard]] std::uint64_t startFileTime() const override
        {
            FILETIME created{}, exited{}, kernel{}, user{};
            if (!GetProcessTimes(handle_.get(), &created, &exited, &kernel, &user))
            {
                throw std::system_error(
                    static_cast<int>(GetLastError()),
                    std::system_category(),
                    "Parent process start time is unavailable");
            }
            return fileTimeValue(created);
        }

        [[nodiscard]] std::filesystem::path executablePath() const override
        {
            std::wstring path(32768, L'\0');
            DWORD length = static_cast<DWORD>(path.size());
            if (!QueryFullProcessImageNameW(handle_.get(), 0, path.data(), &length) ||
                length == 0)
            {
                throw std::system_error(
                    static_cast<int>(GetLastError()),
                    std::system_category(),
                    "Parent process executable path is unavailable");
            }
            path.resize(length);
            return path;
        }

        [[nodiscard]] bool hasExited() const override
        {
            const DWORD result = WaitForSingleObject(handle_.get(), 0);
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
                "Parent process state is unavailable");
        }

        void waitForExit() override
        {
            const DWORD result = WaitForSingleObject(handle_.get(), INFINITE);
            if (result != WAIT_OBJECT_0)
            {
                throw std::system_error(
                    static_cast<int>(GetLastError()),
                    std::system_category(),
                    "Waiting for the parent process failed");
            }
        }

    private:
        UniqueHandle handle_;
    };
}

namespace fluxora::installer
{
    std::unique_ptr<IParentProcess> SystemParentProcessResolver::resolve(
        std::uint32_t processId) const
    {
        HANDLE handle = OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            FALSE,
            processId);
        if (handle == nullptr)
        {
            const DWORD error = GetLastError();
            if (error == ERROR_INVALID_PARAMETER)
            {
                return nullptr;
            }
            throw std::system_error(
                static_cast<int>(error),
                std::system_category(),
                "Parent process could not be opened");
        }
        return std::make_unique<SystemParentProcess>(handle);
    }

    ParentProcessWaiter::ParentProcessWaiter(const IParentProcessResolver& resolver)
        : resolver_(resolver)
    {
    }

    void ParentProcessWaiter::wait(const UpdateWorkflowRequest& request) const
    {
        std::unique_ptr<IParentProcess> process = resolver_.resolve(request.parentPid);
        if (!process)
        {
            return;
        }
        const std::uint64_t observed = process->startFileTime();
        const std::uint64_t expected = request.parentStartFileTime;
        const std::uint64_t difference =
            observed > expected ? observed - expected : expected - observed;
        if (difference > StartTimeToleranceTicks)
        {
            throw std::invalid_argument(
                "Parent process identifier was reused by a different process.");
        }
        std::filesystem::path executablePath;
        try
        {
            executablePath = process->executablePath();
        }
        catch (const std::system_error&)
        {
            if (process->hasExited())
            {
                return;
            }
            throw;
        }
        if (!pathEquals(executablePath, request.applicationPath()))
        {
            throw std::invalid_argument(
                "Parent process executable does not match the Fluxora installation.");
        }
        if (!process->hasExited())
        {
            process->waitForExit();
        }
    }
}
