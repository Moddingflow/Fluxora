#include "FluxoraInstaller/InstallerLogService.hpp"

#include "FluxoraInstaller/UpdateWorkflowRequest.hpp"

#include <chrono>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace
{
    std::mutex LogMutex;

    std::filesystem::path defaultAppDataRoot()
    {
        const DWORD required = GetEnvironmentVariableW(L"APPDATA", nullptr, 0);
        if (required == 0)
        {
            throw std::runtime_error("Application data directory is unavailable.");
        }
        std::wstring value(static_cast<std::size_t>(required), L'\0');
        const DWORD actual = GetEnvironmentVariableW(
            L"APPDATA",
            value.data(),
            required);
        if (actual == 0 || actual >= required)
        {
            throw std::runtime_error("Application data directory is unavailable.");
        }
        value.resize(actual);
        return value;
    }

    std::tm utcNow()
    {
        const std::time_t now = std::time(nullptr);
        std::tm result{};
        gmtime_s(&result, &now);
        return result;
    }

    std::string safeToken(std::string_view value, std::string_view fallback)
    {
        if (value.empty() || value.size() > 128)
        {
            return std::string(fallback);
        }
        for (const char character : value)
        {
            if (!((character >= 'A' && character <= 'Z') ||
                  (character >= 'a' && character <= 'z') ||
                  (character >= '0' && character <= '9') ||
                  character == '.' || character == '_' || character == '-'))
            {
                return std::string(fallback);
            }
        }
        return std::string(value);
    }

    std::wstring channelName(fluxora::installer::InstallerLogChannel channel)
    {
        switch (channel)
        {
        case fluxora::installer::InstallerLogChannel::Installer:
            return L"installer";
        case fluxora::installer::InstallerLogChannel::Updater:
            return L"updater";
        case fluxora::installer::InstallerLogChannel::Operation:
            return L"operation";
        case fluxora::installer::InstallerLogChannel::Crash:
            return L"crash";
        }
        return L"unknown";
    }
}

namespace fluxora::installer
{
    InstallerLogService::InstallerLogService(std::filesystem::path appDataRoot)
        : appDataRoot_(appDataRoot.empty() ? defaultAppDataRoot() : std::move(appDataRoot))
    {
        if (!appDataRoot_.is_absolute())
        {
            throw std::invalid_argument("Application data directory must be absolute.");
        }
    }

    void InstallerLogService::info(
        InstallerLogChannel channel,
        std::string_view operationId,
        std::string_view eventName) const noexcept
    {
        write(channel, "INFO", operationId, eventName, {});
    }

    void InstallerLogService::error(
        InstallerLogChannel channel,
        std::string_view operationId,
        std::string_view eventName,
        std::string_view errorCode) const noexcept
    {
        write(channel, "ERROR", operationId, eventName, errorCode);
    }

    std::filesystem::path InstallerLogService::path(
        InstallerLogChannel channel) const
    {
        const std::tm now = utcNow();
        std::wostringstream filename;
        filename << L"fluxora-" << channelName(channel) << L"-"
                 << std::put_time(&now, L"%Y%m%d") << L".log";
        return std::filesystem::absolute(appDataRoot_).lexically_normal() /
            L"Fluxora" / L"logs" / filename.str();
    }

    void InstallerLogService::write(
        InstallerLogChannel channel,
        std::string_view level,
        std::string_view operationId,
        std::string_view eventName,
        std::string_view errorCode) const noexcept
    {
        try
        {
            const std::tm now = utcNow();
            std::ostringstream line;
            line << std::put_time(&now, "%Y-%m-%dT%H:%M:%SZ")
                 << " [" << level << "]"
                 << " operationId="
                 << (isSafeOperationId(operationId)
                        ? std::string(operationId)
                        : std::string("none"))
                 << " event=" << safeToken(eventName, "invalid-event");
            if (!errorCode.empty())
            {
                line << " errorCode=" << safeToken(errorCode, "unknown");
            }
            line << '\n';

            std::lock_guard lock(LogMutex);
            const std::filesystem::path destination = path(channel);
            std::filesystem::create_directories(destination.parent_path());
            std::ofstream output(destination, std::ios::binary | std::ios::app);
            output << line.str();
            output.flush();
        }
        catch (...)
        {
        }
    }
}
