#include "FluxoraCore/Services/InstallProjectGate.hpp"

#include <algorithm>
#include <cstdint>
#include <cwctype>
#include <iomanip>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string_view>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        std::mutex lockRegistryMutex;
        std::map<std::wstring, std::weak_ptr<std::mutex>> lockRegistry;

        std::wstring normalizedKey(
            const std::filesystem::path& projectDirectory,
            std::wstring_view suffix)
        {
            std::wstring key = std::filesystem::absolute(projectDirectory)
                .lexically_normal()
                .wstring();
            std::transform(key.begin(), key.end(), key.begin(), [](wchar_t value)
            {
                return static_cast<wchar_t>(std::towlower(value));
            });
            key.push_back(L'\0');
            for (const wchar_t value : suffix)
            {
                key.push_back(static_cast<wchar_t>(std::towlower(value)));
            }
            return key;
        }

        std::wstring stableHash(std::wstring_view value)
        {
            std::uint64_t hash = 14695981039346656037ULL;
            for (const wchar_t character : value)
            {
                hash ^= static_cast<std::uint64_t>(character);
                hash *= 1099511628211ULL;
            }
            std::wostringstream stream;
            stream << std::hex << std::setfill(L'0') << std::setw(16) << hash;
            return stream.str();
        }

        std::shared_ptr<std::mutex> localMutexFor(std::wstring_view key)
        {
            std::lock_guard lock(lockRegistryMutex);
            const auto existing = lockRegistry.find(std::wstring(key));
            if (existing != lockRegistry.end())
            {
                if (std::shared_ptr<std::mutex> mutex = existing->second.lock())
                {
                    return mutex;
                }
            }
            auto mutex = std::make_shared<std::mutex>();
            lockRegistry[std::wstring(key)] = mutex;
            return mutex;
        }

        void* acquireNativeMutex(
            std::wstring_view prefix,
            std::wstring_view key)
        {
#ifdef _WIN32
            const std::wstring name = L"Local\\Fluxora." + std::wstring(prefix) +
                L"." + stableHash(key);
            HANDLE handle = CreateMutexW(nullptr, FALSE, name.c_str());
            if (handle == nullptr)
            {
                throw std::runtime_error("Failed to create a cross-process install lock.");
            }
            const DWORD waitResult = WaitForSingleObject(handle, INFINITE);
            if (waitResult != WAIT_OBJECT_0 && waitResult != WAIT_ABANDONED)
            {
                CloseHandle(handle);
                throw std::runtime_error("Failed to acquire a cross-process install lock.");
            }
            return handle;
#else
            static_cast<void>(prefix);
            static_cast<void>(key);
            return nullptr;
#endif
        }

        void releaseNativeMutex(void* handle) noexcept
        {
#ifdef _WIN32
            if (handle != nullptr)
            {
                ReleaseMutex(static_cast<HANDLE>(handle));
                CloseHandle(static_cast<HANDLE>(handle));
            }
#else
            static_cast<void>(handle);
#endif
        }
    }

    InstallProjectGate::InstallProjectGate(
        const std::filesystem::path& projectDirectory)
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required for the install commit gate.");
        }
        const std::wstring key = normalizedKey(projectDirectory, L"project");
        const auto startedAt = std::chrono::steady_clock::now();
        localMutex_ = localMutexFor(key);
        localLock_ = std::unique_lock<std::mutex>(*localMutex_);
        nativeHandle_ = acquireNativeMutex(L"ProjectCommit", key);
        waitDuration_ = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - startedAt);
    }

    InstallProjectGate::~InstallProjectGate()
    {
        releaseNativeMutex(nativeHandle_);
    }

    std::chrono::milliseconds InstallProjectGate::waitDuration() const noexcept
    {
        return waitDuration_;
    }

    InstallTargetLock::InstallTargetLock(
        const std::filesystem::path& projectDirectory,
        std::wstring targetKey)
    {
        if (projectDirectory.empty() || targetKey.empty())
        {
            throw std::invalid_argument("Project directory and target key are required for an install target lock.");
        }
        const std::wstring key = normalizedKey(projectDirectory, targetKey);
        const auto startedAt = std::chrono::steady_clock::now();
        localMutex_ = localMutexFor(std::wstring(L"target:") + key);
        localLock_ = std::unique_lock<std::mutex>(*localMutex_);
        nativeHandle_ = acquireNativeMutex(L"InstallTarget", key);
        waitDuration_ = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - startedAt);
    }

    InstallTargetLock::~InstallTargetLock()
    {
        releaseNativeMutex(nativeHandle_);
    }

    std::chrono::milliseconds InstallTargetLock::waitDuration() const noexcept
    {
        return waitDuration_;
    }
}
