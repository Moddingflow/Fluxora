#include "FluxoraCore/Services/InstallTransactionJournal.hpp"

#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <cctype>
#include <cwctype>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        std::wstring safeOperationFileName(std::wstring_view operationId)
        {
            std::wstring output;
            output.reserve(operationId.size());
            for (const wchar_t value : operationId)
            {
                output.push_back(std::iswalnum(value) || value == L'-' || value == L'_'
                    ? value
                    : L'_');
            }
            return output.empty() ? L"unknown" : output;
        }

        std::filesystem::path journalPath(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId)
        {
            return projectDirectory / L".flow" / L"install-transactions" /
                (safeOperationFileName(operationId) + L".json");
        }

        std::string toUtf8(std::wstring_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            const int required = WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                nullptr, 0, nullptr, nullptr);
            if (required <= 0)
            {
                throw std::runtime_error("Could not encode install transaction journal.");
            }
            std::string output(static_cast<std::size_t>(required), '\0');
            WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                output.data(), required, nullptr, nullptr);
            return output;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::wstring fromUtf8(std::string_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            const int required = MultiByteToWideChar(
                CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                nullptr, 0);
            if (required <= 0)
            {
                throw std::runtime_error("Could not decode install transaction journal.");
            }
            std::wstring output(static_cast<std::size_t>(required), L'\0');
            MultiByteToWideChar(
                CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                output.data(), required);
            return output;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        std::wstring stringField(const JsonValue& root, std::wstring_view key)
        {
            const JsonValue* value = root.find(key);
            return value != nullptr && value->isString() ? value->asString() : std::wstring{};
        }

        bool boolField(const JsonValue& root, std::wstring_view key)
        {
            const JsonValue* value = root.find(key);
            return value != nullptr && value->type() == JsonValue::Type::Boolean &&
                value->asBoolean();
        }

        bool relatedCommitPaths(
            const std::filesystem::path& staging,
            const std::filesystem::path& target,
            const std::filesystem::path& backup)
        {
            if (target.empty() || !target.is_absolute())
            {
                return false;
            }
            const std::filesystem::path parent = target.parent_path().lexically_normal();
            const auto isSibling = [&parent](const std::filesystem::path& path)
            {
                return path.empty() ||
                    (path.is_absolute() && path.parent_path().lexically_normal() == parent);
            };
            return isSibling(staging) && isSibling(backup);
        }

        bool pendingMetadataCommitted(
            const std::filesystem::path& projectDirectory,
            std::wstring_view operationId) noexcept
        {
            try
            {
                return InstanceMetadataStore::pendingInstallSession(
                    projectDirectory,
                    operationId).state == L"completed";
            }
            catch (...)
            {
                return false;
            }
        }
    }

    void InstallTransactionJournal::write(
        const std::filesystem::path& projectDirectory,
        const InstallTransactionRecord& record)
    {
        if (projectDirectory.empty() || record.operationId.empty())
        {
            throw std::invalid_argument("Project directory and operation id are required for an install journal.");
        }
        JsonWriter writer;
        writer.beginObject();
        writer.field(L"schemaVersion", 1);
        writer.field(L"operationId", record.operationId);
        writer.field(L"stage", record.stage);
        writer.field(L"stagingDirectory", record.stagingDirectory.wstring());
        writer.field(L"targetDirectory", record.targetDirectory.wstring());
        writer.field(L"backupDirectory", record.backupDirectory.wstring());
        writer.field(L"targetExisted", record.targetExisted);
        writer.endObject();
        AtomicFileStore().writeTextFile(
            journalPath(projectDirectory, record.operationId),
            toUtf8(writer.str()),
            AtomicFileWriteOptions{
                L"install transaction journal",
                ProjectStateValidation::JsonObject,
                {},
                true
            });
    }

    void InstallTransactionJournal::remove(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId) noexcept
    {
        try
        {
            const std::filesystem::path path = journalPath(projectDirectory, operationId);
            std::error_code error;
            std::filesystem::remove(path, error);
            std::filesystem::remove(AtomicFileStore::backupPathFor(path), error);
        }
        catch (...)
        {
        }
    }

    InstallTransactionRecovery InstallTransactionJournal::recover(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId) noexcept
    {
        InstallTransactionRecovery recovery;
        try
        {
            const std::filesystem::path path = journalPath(projectDirectory, operationId);
            if (!std::filesystem::exists(path))
            {
                return recovery;
            }
            recovery.journalFound = true;
            static_cast<void>(AtomicFileStore().recoverFile(
                path,
                AtomicFileWriteOptions{
                    L"install transaction journal",
                    ProjectStateValidation::JsonObject
                }));
            std::ifstream input(path, std::ios::binary);
            const std::string bytes(
                (std::istreambuf_iterator<char>(input)),
                std::istreambuf_iterator<char>());
            input.close();
            const JsonValue root = JsonReader::parse(fromUtf8(bytes));
            recovery.stage = stringField(root, L"stage");
            const std::filesystem::path staging = stringField(root, L"stagingDirectory");
            const std::filesystem::path target = stringField(root, L"targetDirectory");
            const std::filesystem::path backup = stringField(root, L"backupDirectory");
            const bool targetExisted = boolField(root, L"targetExisted");

            if (!relatedCommitPaths(staging, target, backup))
            {
                recovery.needsReview = true;
                return recovery;
            }

            const bool metadataCommitted = pendingMetadataCommitted(projectDirectory, operationId);
            const bool committedStage = recovery.stage == L"committed" ||
                (recovery.stage == L"promoted" && metadataCommitted);
            if (committedStage)
            {
                std::error_code error;
                if (!backup.empty())
                {
                    std::filesystem::remove_all(backup, error);
                }
                if (!staging.empty())
                {
                    std::filesystem::remove_all(staging, error);
                }
                recovery.commitCompleted = true;
                remove(projectDirectory, operationId);
                return recovery;
            }

            if (recovery.stage == L"prepared")
            {
                std::error_code error;
                if (!staging.empty())
                {
                    std::filesystem::remove_all(staging, error);
                }
                remove(projectDirectory, operationId);
                return recovery;
            }

            if (recovery.stage == L"targetBackedUp" ||
                recovery.stage == L"promoted" ||
                recovery.stage == L"rollingBack")
            {
                if (targetExisted &&
                    (backup.empty() || !std::filesystem::exists(backup)))
                {
                    recovery.needsReview = true;
                    return recovery;
                }
                std::error_code error;
                if (recovery.stage == L"promoted" && std::filesystem::exists(target))
                {
                    std::filesystem::remove_all(target, error);
                    if (error)
                    {
                        recovery.needsReview = true;
                        return recovery;
                    }
                }
                if (!backup.empty() && std::filesystem::exists(backup) &&
                    !std::filesystem::exists(target))
                {
                    std::filesystem::rename(backup, target, error);
                    if (error)
                    {
                        recovery.needsReview = true;
                        return recovery;
                    }
                    recovery.restoredBackup = true;
                }
                if (!staging.empty())
                {
                    std::filesystem::remove_all(staging, error);
                }
                remove(projectDirectory, operationId);
                return recovery;
            }

            recovery.needsReview = true;
        }
        catch (...)
        {
            recovery.needsReview = true;
        }
        return recovery;
    }
}
