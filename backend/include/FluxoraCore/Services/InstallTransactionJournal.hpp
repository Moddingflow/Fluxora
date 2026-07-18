#pragma once

#include <filesystem>
#include <string>
#include <string_view>

namespace fluxora
{
    struct InstallTransactionRecord
    {
        std::wstring operationId;
        std::wstring stage;
        std::filesystem::path stagingDirectory;
        std::filesystem::path targetDirectory;
        std::filesystem::path backupDirectory;
        bool targetExisted{false};
    };

    struct InstallTransactionRecovery
    {
        bool journalFound{false};
        bool restoredBackup{false};
        bool commitCompleted{false};
        bool needsReview{false};
        std::wstring stage;
    };

    class InstallTransactionJournal final
    {
    public:
        InstallTransactionJournal() = delete;

        static void write(
            const std::filesystem::path& projectDirectory,
            const InstallTransactionRecord& record);
        static void remove(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId) noexcept;
        [[nodiscard]] static InstallTransactionRecovery recover(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId) noexcept;
    };
}
