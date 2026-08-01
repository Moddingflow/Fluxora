#include "FluxoraInstaller/SignedInstallReceipt.hpp"

#include <cstdint>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace
{
    constexpr std::uintmax_t MaximumManifestBytes = 512ULL * 1024ULL;
    constexpr std::uintmax_t MaximumSignatureBytes = 4096;

    bool pathEquals(
        const std::filesystem::path& left,
        const std::filesystem::path& right)
    {
        const std::wstring leftValue =
            std::filesystem::absolute(left).lexically_normal().wstring();
        const std::wstring rightValue =
            std::filesystem::absolute(right).lexically_normal().wstring();
        return CompareStringOrdinal(
            leftValue.c_str(),
            static_cast<int>(leftValue.size()),
            rightValue.c_str(),
            static_cast<int>(rightValue.size()),
            TRUE) == CSTR_EQUAL;
    }

    void rejectReparseAncestors(const std::filesystem::path& input)
    {
        std::filesystem::path current =
            std::filesystem::absolute(input).lexically_normal();
        for (;;)
        {
            const DWORD attributes = GetFileAttributesW(current.c_str());
            if (attributes != INVALID_FILE_ATTRIBUTES)
            {
                if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                {
                    throw std::invalid_argument(
                        "Install receipt path cannot traverse a reparse point.");
                }
            }
            else
            {
                const DWORD error = GetLastError();
                if (error != ERROR_FILE_NOT_FOUND &&
                    error != ERROR_PATH_NOT_FOUND)
                {
                    throw std::invalid_argument(
                        "Install receipt path could not be inspected.");
                }
            }
            const std::filesystem::path parent = current.parent_path();
            if (parent.empty() || pathEquals(parent, current))
            {
                return;
            }
            current = parent;
        }
    }

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

    std::vector<std::byte> readBounded(
        const std::filesystem::path& path,
        std::uintmax_t maximum,
        const char* label)
    {
        const DWORD attributes = GetFileAttributesW(path.c_str());
        std::error_code sizeError;
        const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
        if (attributes == INVALID_FILE_ATTRIBUTES ||
            (attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0 ||
            sizeError || size == 0 || size > maximum)
        {
            throw std::invalid_argument(
                std::string("Signed install receipt ") + label + " is invalid.");
        }
        std::ifstream input(path, std::ios::binary);
        std::vector<std::byte> bytes(static_cast<std::size_t>(size));
        input.read(
            reinterpret_cast<char*>(bytes.data()),
            static_cast<std::streamsize>(bytes.size()));
        if (!input)
        {
            throw std::runtime_error(
                std::string("Signed install receipt ") + label + " could not be read.");
        }
        return bytes;
    }

    void writeAtomic(
        const std::filesystem::path& destination,
        const std::vector<std::byte>& bytes,
        std::string_view operationId)
    {
        const std::wstring operation(operationId.begin(), operationId.end());
        const std::filesystem::path temporary =
            destination.wstring() + L"." + operation + L".tmp";
        HANDLE output = CreateFileW(
            temporary.c_str(),
            GENERIC_WRITE,
            0,
            nullptr,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH,
            nullptr);
        if (output == INVALID_HANDLE_VALUE)
        {
            throw std::runtime_error("Install receipt temporary file could not be created.");
        }
        try
        {
            std::size_t offset = 0;
            while (offset < bytes.size())
            {
                const DWORD chunk = static_cast<DWORD>(
                    std::min<std::size_t>(bytes.size() - offset, 1024 * 1024));
                DWORD written = 0;
                if (!WriteFile(
                        output,
                        bytes.data() + offset,
                        chunk,
                        &written,
                        nullptr) ||
                    written != chunk)
                {
                    throw std::runtime_error("Install receipt temporary file could not be written.");
                }
                offset += written;
            }
            if (!FlushFileBuffers(output))
            {
                throw std::runtime_error("Install receipt temporary file could not be flushed.");
            }
            CloseHandle(output);
            output = INVALID_HANDLE_VALUE;
            if (!MoveFileExW(
                    temporary.c_str(),
                    destination.c_str(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
            {
                throw std::runtime_error("Install receipt could not be committed atomically.");
            }
        }
        catch (...)
        {
            if (output != INVALID_HANDLE_VALUE)
            {
                CloseHandle(output);
            }
            DeleteFileW(temporary.c_str());
            throw;
        }
    }
}

namespace fluxora::installer
{
    SignedInstallReceipt::SignedInstallReceipt(std::filesystem::path appDataRoot)
        : appDataRoot_(appDataRoot.empty() ? defaultAppDataRoot() : std::move(appDataRoot))
    {
        if (!appDataRoot_.is_absolute())
        {
            throw std::invalid_argument("Application data directory must be absolute.");
        }
    }

    void SignedInstallReceipt::write(const UpdateWorkflowRequest& request) const
    {
        if (!isSafeOperationId(request.operationId))
        {
            throw std::invalid_argument("Install receipt operation identifier is invalid.");
        }
        const std::vector<std::byte> manifest =
            readBounded(request.manifestPath, MaximumManifestBytes, "manifest");
        const std::vector<std::byte> signature =
            readBounded(request.signaturePath, MaximumSignatureBytes, "signature");
        const std::filesystem::path directory = receiptDirectory();
        rejectReparseAncestors(directory);
        std::error_code error;
        std::filesystem::create_directories(directory, error);
        if (error)
        {
            throw std::runtime_error("Install receipt directory could not be created.");
        }
        rejectReparseAncestors(directory);
        const DWORD attributes = GetFileAttributesW(directory.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES ||
            (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::invalid_argument(
                "Install receipt directory cannot be a reparse point.");
        }

        // The manifest moves last and is the commit record for the exact signed pair.
        writeAtomic(
            directory / L"installed-manifest.sig",
            signature,
            request.operationId);
        writeAtomic(
            directory / L"installed-manifest.json",
            manifest,
            request.operationId);
    }

    std::filesystem::path SignedInstallReceipt::receiptDirectory() const
    {
        return std::filesystem::absolute(appDataRoot_).lexically_normal() /
            L"Fluxora" / L"updates";
    }
}
