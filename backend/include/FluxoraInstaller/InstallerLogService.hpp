#pragma once

#include <filesystem>
#include <string_view>

namespace fluxora::installer
{
    enum class InstallerLogChannel
    {
        Installer,
        Updater,
        Operation,
        Crash
    };

    class InstallerLogService final
    {
    public:
        explicit InstallerLogService(std::filesystem::path appDataRoot = {});

        void info(
            InstallerLogChannel channel,
            std::string_view operationId,
            std::string_view eventName) const noexcept;
        void error(
            InstallerLogChannel channel,
            std::string_view operationId,
            std::string_view eventName,
            std::string_view errorCode) const noexcept;

        [[nodiscard]] std::filesystem::path path(
            InstallerLogChannel channel) const;

    private:
        void write(
            InstallerLogChannel channel,
            std::string_view level,
            std::string_view operationId,
            std::string_view eventName,
            std::string_view errorCode) const noexcept;

        std::filesystem::path appDataRoot_;
    };
}
