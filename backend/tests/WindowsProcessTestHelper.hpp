#pragma once

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <string_view>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace fluxora::tests
{
    class ScopedProbeEnvironment final
    {
    public:
        ScopedProbeEnvironment(
            std::wstring_view mode,
            const std::filesystem::path& outputPath,
            const std::filesystem::path& installDirectory = {});
        ScopedProbeEnvironment(const ScopedProbeEnvironment&) = delete;
        ScopedProbeEnvironment& operator=(const ScopedProbeEnvironment&) = delete;
        ~ScopedProbeEnvironment();

    private:
        std::wstring previousMode_;
        std::wstring previousOutput_;
        std::wstring previousInstall_;
        bool hadMode_{false};
        bool hadOutput_{false};
        bool hadInstall_{false};
    };

    class ProbeProcess final
    {
    public:
        ProbeProcess() = default;
        ProbeProcess(const ProbeProcess&) = delete;
        ProbeProcess& operator=(const ProbeProcess&) = delete;
        ProbeProcess(ProbeProcess&& other) noexcept;
        ProbeProcess& operator=(ProbeProcess&& other) noexcept;
        ~ProbeProcess();

        [[nodiscard]] static ProbeProcess launch(
            const std::filesystem::path& executable,
            std::wstring_view mode,
            const std::filesystem::path& outputPath,
            const std::filesystem::path& installDirectory = {});

        [[nodiscard]] HANDLE handle() const noexcept;
        [[nodiscard]] std::uint32_t processId() const noexcept;
        [[nodiscard]] bool wait(std::chrono::milliseconds timeout) const;
        void terminate();

    private:
        ProbeProcess(HANDLE process, std::uint32_t processId) noexcept;
        void close() noexcept;

        HANDLE process_{nullptr};
        std::uint32_t processId_{0};
    };

    [[nodiscard]] std::filesystem::path currentTestExecutable();
    [[nodiscard]] bool waitForFile(
        const std::filesystem::path& path,
        std::chrono::milliseconds timeout);
    [[nodiscard]] std::uint32_t readProbeProcessId(
        const std::filesystem::path& path);
    [[nodiscard]] bool processHasExited(
        std::uint32_t processId,
        std::chrono::milliseconds timeout);
}
