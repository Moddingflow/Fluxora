#pragma once

#include "FluxoraInstaller/UpdateWorkflowRequest.hpp"

#include <cstdint>
#include <filesystem>
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
    class ILaunchedApplicationIdentity
    {
    public:
        virtual ~ILaunchedApplicationIdentity() = default;
        [[nodiscard]] virtual std::uint32_t processId() const noexcept = 0;
        [[nodiscard]] virtual std::uint64_t startFileTime() const noexcept = 0;
        [[nodiscard]] virtual const std::filesystem::path& executablePath() const noexcept = 0;
        [[nodiscard]] virtual bool hasExited() const = 0;
    };

    class WindowsProcessJob final
    {
    public:
        WindowsProcessJob() = default;
        WindowsProcessJob(const WindowsProcessJob&) = delete;
        WindowsProcessJob& operator=(const WindowsProcessJob&) = delete;
        WindowsProcessJob(WindowsProcessJob&& other) noexcept;
        WindowsProcessJob& operator=(WindowsProcessJob&& other) noexcept;
        ~WindowsProcessJob();

        [[nodiscard]] static WindowsProcessJob create();
        void associate(HANDLE processHandle);
        void terminateEntireTree();
        void release();
        [[nodiscard]] bool active() const noexcept;

    private:
        explicit WindowsProcessJob(HANDLE handle) noexcept;
        void close() noexcept;
        void setKillOnClose(bool enabled);

        HANDLE handle_{nullptr};
        bool released_{false};
    };

    class LaunchedApplication final : public ILaunchedApplicationIdentity
    {
    public:
        LaunchedApplication() = default;
        LaunchedApplication(const LaunchedApplication&) = delete;
        LaunchedApplication& operator=(const LaunchedApplication&) = delete;
        LaunchedApplication(LaunchedApplication&& other) noexcept;
        LaunchedApplication& operator=(LaunchedApplication&& other) noexcept;
        ~LaunchedApplication();

        [[nodiscard]] std::uint32_t processId() const noexcept override;
        [[nodiscard]] std::uint64_t startFileTime() const noexcept override;
        [[nodiscard]] const std::filesystem::path& executablePath() const noexcept override;
        [[nodiscard]] bool hasExited() const override;
        void terminateIfRunning();
        void releaseProcessTree();

    private:
        friend class ApplicationLaunchService;
        LaunchedApplication(
            HANDLE processHandle,
            std::uint32_t processId,
            std::uint64_t startFileTime,
            std::filesystem::path executablePath,
            WindowsProcessJob job);
        void close() noexcept;

        HANDLE processHandle_{nullptr};
        std::uint32_t processId_{0};
        std::uint64_t startFileTime_{0};
        std::filesystem::path executablePath_;
        WindowsProcessJob job_;
    };

    class ApplicationLaunchService final
    {
    public:
        [[nodiscard]] LaunchedApplication launchUpdated(
            const UpdateWorkflowRequest& request) const;
        void launchPrevious(const UpdateWorkflowRequest& request) const;

        [[nodiscard]] static std::wstring createUpdatedCommandLine(
            const std::filesystem::path& applicationPath,
            std::string_view handoffNonce,
            std::string_view operationId);
        [[nodiscard]] static std::wstring quoteWindowsArgument(
            std::wstring_view value);
    };
}
