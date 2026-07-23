#include "FluxoraCore/Services/GrassCacheService.hpp"

#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/VirtualFileSystemService.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cwctype>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <tlhelp32.h>
#endif

namespace fluxora
{
    namespace
    {
        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
            return out;
#else
            return std::string(value.begin(), value.end());
#endif
        }

#ifdef _WIN32
        bool isProcessRunning(std::uint32_t processId)
        {
            if (processId == 0)
            {
                return false;
            }

            HANDLE handle = OpenProcess(SYNCHRONIZE, FALSE, processId);
            if (handle == nullptr)
            {
                HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
                if (snapshot == INVALID_HANDLE_VALUE)
                {
                    return false;
                }

                PROCESSENTRY32W entry{};
                entry.dwSize = sizeof(entry);
                BOOL hasEntry = Process32FirstW(snapshot, &entry);
                while (hasEntry)
                {
                    if (static_cast<std::uint32_t>(entry.th32ProcessID) == processId)
                    {
                        CloseHandle(snapshot);
                        return true;
                    }

                    hasEntry = Process32NextW(snapshot, &entry);
                }

                CloseHandle(snapshot);
                return false;
            }

            const DWORD waitResult = WaitForSingleObject(handle, 0);
            CloseHandle(handle);
            return waitResult == WAIT_TIMEOUT;
        }

        void throwIfCancellationRequested(const std::function<bool()>& cancellationRequested)
        {
            if (cancellationRequested && cancellationRequested())
            {
                throw std::runtime_error("NGIO grass cache generation was canceled.");
            }
        }

        std::wstring processName(const PROCESSENTRY32W& entry)
        {
            const auto end = std::find(std::begin(entry.szExeFile), std::end(entry.szExeFile), L'\0');
            return std::wstring(std::begin(entry.szExeFile), end);
        }

        std::optional<std::pair<std::uint32_t, std::wstring>> findProcessByNames(
            const std::vector<std::wstring>& expectedNames)
        {
            if (expectedNames.empty())
            {
                return std::nullopt;
            }

            std::vector<std::wstring> normalized;
            normalized.reserve(expectedNames.size());
            for (const std::wstring& name : expectedNames)
            {
                if (!name.empty())
                {
                    normalized.push_back(toLower(name));
                }
            }
            if (normalized.empty())
            {
                return std::nullopt;
            }

            HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == INVALID_HANDLE_VALUE)
            {
                return std::nullopt;
            }

            PROCESSENTRY32W entry{};
            entry.dwSize = sizeof(entry);
            BOOL hasEntry = Process32FirstW(snapshot, &entry);
            while (hasEntry)
            {
                const std::wstring name = processName(entry);
                const std::wstring normalizedName = toLower(name);
                if (std::find(normalized.begin(), normalized.end(), normalizedName) != normalized.end())
                {
                    CloseHandle(snapshot);
                    return std::make_pair(static_cast<std::uint32_t>(entry.th32ProcessID), name);
                }

                hasEntry = Process32NextW(snapshot, &entry);
            }

            CloseHandle(snapshot);
            return std::nullopt;
        }

        std::string joinExpectedProcessNames(const std::vector<std::wstring>& names)
        {
            std::string joined;
            for (const std::wstring& name : names)
            {
                if (!joined.empty())
                {
                    joined += "|";
                }
                joined += toUtf8(name);
            }

            return joined.empty() ? std::string("<none>") : joined;
        }
#endif

        class VirtualFileSystemGrassCacheProcessRunner final : public IGrassCacheProcessRunner
        {
        public:
            VirtualFileSystemGrassCacheProcessRunner(
                Logger& logger,
                VirtualFileSystemService& virtualFileSystem) noexcept
                : logger_(logger),
                  virtualFileSystem_(virtualFileSystem)
            {
            }

            GrassCacheLaunchResult launchAndWait(
                const GrassCacheLaunchSpec& spec,
                const std::function<bool()>& cancellationRequested,
                const std::function<void()>& activityCallback) override
            {
#ifndef _WIN32
                (void)spec;
                (void)cancellationRequested;
                (void)activityCallback;
                throw std::runtime_error("NGIO grass cache generation is only implemented on Windows.");
#else
                throwIfCancellationRequested(cancellationRequested);
                const GameExecutableLaunchResult launch =
                    virtualFileSystem_.launchExecutable(
                        spec.configPath,
                        spec.executableId,
                        spec.profileName,
                        spec.additionalArguments);
                const std::filesystem::path runtimeMarkerPath =
                    launch.resolvedExecutablePath.parent_path() / L"PrecacheGrass.txt";

                if (launch.launchTrackingKind == LaunchTrackingKind::ExpectedChildProcess &&
                    !launch.expectedChildProcessNames.empty())
                {
                    const std::uint32_t timeoutMs =
                        launch.handoffTimeoutMs == 0 ? 30000U : launch.handoffTimeoutMs;
                    const auto deadline = std::chrono::steady_clock::now() +
                        std::chrono::milliseconds(timeoutMs);
                    while (std::chrono::steady_clock::now() < deadline)
                    {
                        throwIfCancellationRequested(cancellationRequested);
                        if (const auto child = findProcessByNames(launch.expectedChildProcessNames))
                        {
                            logger_.writeOperation(
                                LogLevel::Info,
                                "GrassCache",
                                "NGIO grass cache handoff process detected pid=" +
                                    std::to_string(child->first) +
                                    ", name=\"" + toUtf8(child->second) + "\".");
                            while (isProcessRunning(child->first))
                            {
                                throwIfCancellationRequested(cancellationRequested);
                                if (activityCallback)
                                {
                                    activityCallback();
                                }
                                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                            }
                            if (activityCallback)
                            {
                                activityCallback();
                            }
                            return GrassCacheLaunchResult{
                                runtimeMarkerPath,
                                std::filesystem::exists(runtimeMarkerPath)
                            };
                        }

                        if (activityCallback)
                        {
                            activityCallback();
                        }
                        std::this_thread::sleep_for(std::chrono::milliseconds(500));
                    }
                    logger_.writeOperation(
                        LogLevel::Warning,
                        "GrassCache",
                        "NGIO grass cache handoff timed out waiting for expected child process. launchedPid=" +
                            std::to_string(launch.processId) +
                            ", expectedChildren=\"" +
                            joinExpectedProcessNames(launch.expectedChildProcessNames) +
                            "\"; waiting for launched process instead.");
                }

                while (isProcessRunning(launch.processId))
                {
                    throwIfCancellationRequested(cancellationRequested);
                    if (activityCallback)
                    {
                        activityCallback();
                    }
                    std::this_thread::sleep_for(std::chrono::milliseconds(250));
                }
                if (activityCallback)
                {
                    activityCallback();
                }
                return GrassCacheLaunchResult{
                    runtimeMarkerPath,
                    std::filesystem::exists(runtimeMarkerPath)
                };
#endif
            }

        private:
            Logger& logger_;
            VirtualFileSystemService& virtualFileSystem_;
        };
    }

    GrassCacheService::GrassCacheService(
        Logger& logger,
        ProjectService& projects,
        ExecutableService& executables,
        VirtualFileSystemService& virtualFileSystem,
        ModService& mods,
        ProfileOrderService& profileOrder,
        const BuildPathSettingsService& pathSettings)
        : logger_(logger),
          projects_(projects),
          executables_(executables),
          mods_(mods),
          profileOrder_(profileOrder),
          pathSettings_(pathSettings),
          ownedRunner_(std::make_unique<VirtualFileSystemGrassCacheProcessRunner>(logger, virtualFileSystem)),
          runner_(*ownedRunner_)
    {
    }
}
