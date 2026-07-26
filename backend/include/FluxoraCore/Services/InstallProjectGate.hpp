#pragma once

#include <chrono>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>

namespace fluxora
{
    // Lock order for install mutations is target lock -> project gate ->
    // metadata/SQLite lock. Code that only reconciles project composition takes
    // the project gate directly and never attempts to acquire a target lock.
    class InstallProjectGate final
    {
    public:
        explicit InstallProjectGate(const std::filesystem::path& projectDirectory);
        InstallProjectGate(
            const std::filesystem::path& projectDirectory,
            std::try_to_lock_t);
        ~InstallProjectGate();

        InstallProjectGate(const InstallProjectGate&) = delete;
        InstallProjectGate& operator=(const InstallProjectGate&) = delete;

        [[nodiscard]] std::chrono::milliseconds waitDuration() const noexcept;
        [[nodiscard]] bool ownsLock() const noexcept;

    private:
        std::shared_ptr<std::mutex> localMutex_;
        std::unique_lock<std::mutex> localLock_;
        void* nativeHandle_{nullptr};
        bool nativeLockAcquired_{false};
        std::chrono::milliseconds waitDuration_{0};
    };

    class InstallTargetLock final
    {
    public:
        InstallTargetLock(
            const std::filesystem::path& projectDirectory,
            std::wstring targetKey);
        ~InstallTargetLock();

        InstallTargetLock(const InstallTargetLock&) = delete;
        InstallTargetLock& operator=(const InstallTargetLock&) = delete;

        [[nodiscard]] std::chrono::milliseconds waitDuration() const noexcept;

    private:
        std::shared_ptr<std::mutex> localMutex_;
        std::unique_lock<std::mutex> localLock_;
        void* nativeHandle_{nullptr};
        std::chrono::milliseconds waitDuration_{0};
    };
}
