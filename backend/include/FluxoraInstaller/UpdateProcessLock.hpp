#pragma once

#include <chrono>
#include <filesystem>
#include <stdexcept>
#include <string>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace fluxora::installer
{
    class UpdateProcessLock final
    {
    public:
        static constexpr std::chrono::milliseconds DefaultTimeout{500};

        UpdateProcessLock() = default;
        UpdateProcessLock(const UpdateProcessLock&) = delete;
        UpdateProcessLock& operator=(const UpdateProcessLock&) = delete;
        UpdateProcessLock(UpdateProcessLock&& other) noexcept;
        UpdateProcessLock& operator=(UpdateProcessLock&& other) noexcept;
        ~UpdateProcessLock();

        [[nodiscard]] static UpdateProcessLock acquire(
            const std::filesystem::path& installDirectory,
            std::chrono::milliseconds timeout = DefaultTimeout);

        [[nodiscard]] static std::wstring nameForInstallDirectory(
            const std::filesystem::path& installDirectory);

        [[nodiscard]] bool wasAbandoned() const noexcept;
        [[nodiscard]] bool ownsLock() const noexcept;
        void release();

    private:
        explicit UpdateProcessLock(HANDLE handle, bool wasAbandoned) noexcept;

        HANDLE handle_{nullptr};
        bool wasAbandoned_{false};
    };

    class UpdateBusyError final : public std::runtime_error
    {
    public:
        using std::runtime_error::runtime_error;
    };
}
