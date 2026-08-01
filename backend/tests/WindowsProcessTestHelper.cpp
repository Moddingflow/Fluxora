#include "WindowsProcessTestHelper.hpp"

#include "FluxoraInstaller/UpdateProcessLock.hpp"

#include <chrono>
#include <fstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

namespace
{
    constexpr wchar_t ProbeModeVariable[] =
        L"FLUXORA_NATIVE_TEST_PROBE_MODE";
    constexpr wchar_t ProbeOutputVariable[] =
        L"FLUXORA_NATIVE_TEST_PROBE_OUTPUT";
    constexpr wchar_t ProbeInstallVariable[] =
        L"FLUXORA_NATIVE_TEST_PROBE_INSTALL";

    std::wstring environmentValue(const wchar_t* name)
    {
        const DWORD required = GetEnvironmentVariableW(name, nullptr, 0);
        if (required == 0)
        {
            return {};
        }
        std::wstring value(static_cast<std::size_t>(required), L'\0');
        const DWORD actual = GetEnvironmentVariableW(
            name,
            value.data(),
            required);
        if (actual == 0 || actual >= required)
        {
            return {};
        }
        value.resize(actual);
        return value;
    }

    void writeProbeOutput(
        const std::filesystem::path& outputPath,
        std::string_view value)
    {
        std::ofstream output(outputPath, std::ios::binary | std::ios::trunc);
        if (!output)
        {
            throw std::runtime_error("Native test probe output could not be opened.");
        }
        output.write(value.data(), static_cast<std::streamsize>(value.size()));
        output.flush();
        if (!output)
        {
            throw std::runtime_error("Native test probe output could not be written.");
        }
    }

    std::string utf8(std::wstring_view value)
    {
        if (value.empty())
        {
            return {};
        }
        const int required = WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (required <= 0)
        {
            throw std::runtime_error("Native test command line is invalid.");
        }
        std::string result(static_cast<std::size_t>(required), '\0');
        WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            result.data(),
            required,
            nullptr,
            nullptr);
        return result;
    }

    void runDescendantProbe(const std::filesystem::path& outputPath)
    {
        std::wstring command =
            L"powershell.exe -NoProfile -NonInteractive -Command "
            L"\"Start-Sleep -Seconds 120\"";
        std::vector<wchar_t> mutableCommand(command.begin(), command.end());
        mutableCommand.push_back(L'\0');
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        if (!CreateProcessW(
                nullptr,
                mutableCommand.data(),
                nullptr,
                nullptr,
                FALSE,
                CREATE_NO_WINDOW,
                nullptr,
                nullptr,
                &startup,
                &process))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Native test descendant could not be created");
        }
        CloseHandle(process.hThread);
        writeProbeOutput(outputPath, std::to_string(process.dwProcessId));
        WaitForSingleObject(process.hProcess, INFINITE);
        CloseHandle(process.hProcess);
    }

    void runLockProbe(
        const std::filesystem::path& outputPath,
        const std::filesystem::path& installDirectory,
        bool abandon)
    {
        auto lock = fluxora::installer::UpdateProcessLock::acquire(
            installDirectory,
            std::chrono::seconds(5));
        writeProbeOutput(outputPath, "ready");
        if (abandon)
        {
            ExitProcess(0);
        }
        Sleep(120'000);
    }

    class ProbeBootstrap final
    {
    public:
        ProbeBootstrap()
        {
            const std::wstring mode = environmentValue(ProbeModeVariable);
            if (mode.empty())
            {
                return;
            }
            try
            {
                const std::filesystem::path output =
                    environmentValue(ProbeOutputVariable);
                if (mode == L"spawn-descendant")
                {
                    runDescendantProbe(output);
                }
                else if (mode == L"record-command-line")
                {
                    writeProbeOutput(output, utf8(GetCommandLineW()));
                }
                else if (mode == L"hold-lock" || mode == L"abandon-lock")
                {
                    runLockProbe(
                        output,
                        environmentValue(ProbeInstallVariable),
                        mode == L"abandon-lock");
                }
                else
                {
                    ExitProcess(201);
                }
                ExitProcess(0);
            }
            catch (...)
            {
                ExitProcess(202);
            }
        }
    };

    ProbeBootstrap Bootstrap;

    bool environmentExists(const wchar_t* name)
    {
        SetLastError(ERROR_SUCCESS);
        const DWORD required = GetEnvironmentVariableW(name, nullptr, 0);
        return required != 0 || GetLastError() != ERROR_ENVVAR_NOT_FOUND;
    }

    void setProbeEnvironment(
        std::wstring_view mode,
        const std::filesystem::path& outputPath,
        const std::filesystem::path& installDirectory)
    {
        if (!SetEnvironmentVariableW(
                ProbeModeVariable,
                std::wstring(mode).c_str()) ||
            !SetEnvironmentVariableW(
                ProbeOutputVariable,
                outputPath.c_str()) ||
            !SetEnvironmentVariableW(
                ProbeInstallVariable,
                installDirectory.empty()
                    ? nullptr
                    : installDirectory.c_str()))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Native test probe environment could not be prepared");
        }
    }
}

namespace fluxora::tests
{
    ScopedProbeEnvironment::ScopedProbeEnvironment(
        std::wstring_view mode,
        const std::filesystem::path& outputPath,
        const std::filesystem::path& installDirectory)
        : previousMode_(environmentValue(ProbeModeVariable)),
          previousOutput_(environmentValue(ProbeOutputVariable)),
          previousInstall_(environmentValue(ProbeInstallVariable)),
          hadMode_(environmentExists(ProbeModeVariable)),
          hadOutput_(environmentExists(ProbeOutputVariable)),
          hadInstall_(environmentExists(ProbeInstallVariable))
    {
        setProbeEnvironment(mode, outputPath, installDirectory);
    }

    ScopedProbeEnvironment::~ScopedProbeEnvironment()
    {
        SetEnvironmentVariableW(
            ProbeModeVariable,
            hadMode_ ? previousMode_.c_str() : nullptr);
        SetEnvironmentVariableW(
            ProbeOutputVariable,
            hadOutput_ ? previousOutput_.c_str() : nullptr);
        SetEnvironmentVariableW(
            ProbeInstallVariable,
            hadInstall_ ? previousInstall_.c_str() : nullptr);
    }

    ProbeProcess::ProbeProcess(
        HANDLE process,
        std::uint32_t processId) noexcept
        : process_(process),
          processId_(processId)
    {
    }

    ProbeProcess::ProbeProcess(ProbeProcess&& other) noexcept
        : process_(std::exchange(other.process_, nullptr)),
          processId_(std::exchange(other.processId_, 0))
    {
    }

    ProbeProcess& ProbeProcess::operator=(ProbeProcess&& other) noexcept
    {
        if (this != &other)
        {
            terminate();
            close();
            process_ = std::exchange(other.process_, nullptr);
            processId_ = std::exchange(other.processId_, 0);
        }
        return *this;
    }

    ProbeProcess::~ProbeProcess()
    {
        terminate();
        close();
    }

    ProbeProcess ProbeProcess::launch(
        const std::filesystem::path& executable,
        std::wstring_view mode,
        const std::filesystem::path& outputPath,
        const std::filesystem::path& installDirectory)
    {
        ScopedProbeEnvironment environment(
            mode,
            outputPath,
            installDirectory);
        std::wstring command = L"\"" + executable.wstring() +
            L"\" --gtest_filter=NativeProbe.NoTests";
        std::vector<wchar_t> mutableCommand(command.begin(), command.end());
        mutableCommand.push_back(L'\0');
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        if (!CreateProcessW(
                executable.c_str(),
                mutableCommand.data(),
                nullptr,
                nullptr,
                FALSE,
                CREATE_NO_WINDOW,
                nullptr,
                executable.parent_path().c_str(),
                &startup,
                &process))
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "Native test probe could not be launched");
        }
        CloseHandle(process.hThread);
        return ProbeProcess(process.hProcess, process.dwProcessId);
    }

    HANDLE ProbeProcess::handle() const noexcept
    {
        return process_;
    }

    std::uint32_t ProbeProcess::processId() const noexcept
    {
        return processId_;
    }

    bool ProbeProcess::wait(std::chrono::milliseconds timeout) const
    {
        if (process_ == nullptr)
        {
            return true;
        }
        const DWORD result = WaitForSingleObject(
            process_,
            static_cast<DWORD>(timeout.count()));
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
            "Native test probe wait failed");
    }

    void ProbeProcess::terminate()
    {
        if (process_ != nullptr && WaitForSingleObject(process_, 0) == WAIT_TIMEOUT)
        {
            TerminateProcess(process_, 203);
            WaitForSingleObject(process_, 5'000);
        }
    }

    void ProbeProcess::close() noexcept
    {
        if (process_ != nullptr)
        {
            CloseHandle(process_);
            process_ = nullptr;
        }
        processId_ = 0;
    }

    std::filesystem::path currentTestExecutable()
    {
        std::wstring path(32768, L'\0');
        const DWORD length = GetModuleFileNameW(
            nullptr,
            path.data(),
            static_cast<DWORD>(path.size()));
        if (length == 0 || length >= path.size())
        {
            throw std::runtime_error("Native test executable path is unavailable.");
        }
        path.resize(length);
        return path;
    }

    bool waitForFile(
        const std::filesystem::path& path,
        std::chrono::milliseconds timeout)
    {
        const auto deadline = std::chrono::steady_clock::now() + timeout;
        while (std::chrono::steady_clock::now() < deadline)
        {
            std::error_code error;
            if (std::filesystem::is_regular_file(path, error) && !error)
            {
                return true;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        return false;
    }

    std::uint32_t readProbeProcessId(const std::filesystem::path& path)
    {
        std::ifstream input(path, std::ios::binary);
        std::uint32_t processId = 0;
        input >> processId;
        if (!input || processId == 0)
        {
            throw std::runtime_error("Native test probe process id is invalid.");
        }
        return processId;
    }

    bool processHasExited(
        std::uint32_t processId,
        std::chrono::milliseconds timeout)
    {
        HANDLE process = OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            FALSE,
            processId);
        if (process == nullptr)
        {
            return GetLastError() == ERROR_INVALID_PARAMETER;
        }
        const DWORD result = WaitForSingleObject(
            process,
            static_cast<DWORD>(timeout.count()));
        CloseHandle(process);
        return result == WAIT_OBJECT_0;
    }
}
