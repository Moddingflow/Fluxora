#include "FluxoraCore/Services/RemoteDownloadFileStore.hpp"

#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Services/RemoteDownloadSidecarStore.hpp"

#include <algorithm>
#include <cerrno>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace fluxora
{
    namespace
    {
        class HashCancelled final
        {
        };

        bool existingPathIsReparsePoint(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const DWORD attributes = GetFileAttributesW(path.c_str());
            return attributes != INVALID_FILE_ATTRIBUTES &&
                (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0U;
#else
            std::error_code error;
            return std::filesystem::is_symlink(std::filesystem::symlink_status(path, error));
#endif
        }

        class NativeRemoteDownloadFileWriter final : public IRemoteDownloadFileWriter
        {
        public:
            NativeRemoteDownloadFileWriter(
                const std::filesystem::path& path,
                std::uint64_t expectedOffset)
                : position_(expectedOffset)
            {
#ifdef _WIN32
                handle_ = CreateFileW(
                    path.c_str(),
                    GENERIC_READ | GENERIC_WRITE,
                    FILE_SHARE_READ,
                    nullptr,
                    OPEN_ALWAYS,
                    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN |
                        FILE_FLAG_OPEN_REPARSE_POINT,
                    nullptr);
                if (handle_ == INVALID_HANDLE_VALUE)
                {
                    throw std::system_error(
                        static_cast<int>(GetLastError()),
                        std::system_category(),
                        "Remote download partial file could not be opened");
                }
                LARGE_INTEGER actual{};
                if (!GetFileSizeEx(handle_, &actual) || actual.QuadPart < 0 ||
                    static_cast<std::uint64_t>(actual.QuadPart) != expectedOffset)
                {
                    CloseHandle(handle_);
                    handle_ = INVALID_HANDLE_VALUE;
                    throw std::runtime_error("Remote download partial file offset changed before opening.");
                }
                LARGE_INTEGER offset{};
                offset.QuadPart = static_cast<LONGLONG>(expectedOffset);
                if (!SetFilePointerEx(handle_, offset, nullptr, FILE_BEGIN))
                {
                    const DWORD error = GetLastError();
                    CloseHandle(handle_);
                    handle_ = INVALID_HANDLE_VALUE;
                    throw std::system_error(
                        static_cast<int>(error),
                        std::system_category(),
                        "Remote download partial file could not be positioned");
                }
#else
                descriptor_ = ::open(path.c_str(), O_WRONLY | O_CREAT | O_NOFOLLOW, 0600);
                if (descriptor_ < 0)
                {
                    throw std::system_error(errno, std::generic_category(),
                        "Remote download partial file could not be opened");
                }
                const off_t end = ::lseek(descriptor_, 0, SEEK_END);
                if (end < 0 || static_cast<std::uint64_t>(end) != expectedOffset ||
                    ::lseek(descriptor_, static_cast<off_t>(expectedOffset), SEEK_SET) < 0)
                {
                    const int error = errno;
                    ::close(descriptor_);
                    descriptor_ = -1;
                    throw std::system_error(error, std::generic_category(),
                        "Remote download partial file offset changed before opening");
                }
#endif
            }

            ~NativeRemoteDownloadFileWriter() override
            {
#ifdef _WIN32
                if (handle_ != INVALID_HANDLE_VALUE)
                {
                    CloseHandle(handle_);
                }
#else
                if (descriptor_ >= 0)
                {
                    ::close(descriptor_);
                }
#endif
            }

            void append(std::span<const std::byte> bytes) override
            {
                std::size_t consumed = 0;
                while (consumed < bytes.size())
                {
#ifdef _WIN32
                    const std::size_t remaining = bytes.size() - consumed;
                    const DWORD requested = static_cast<DWORD>((std::min)(
                        remaining,
                        static_cast<std::size_t>((std::numeric_limits<DWORD>::max)())));
                    DWORD written = 0;
                    if (!WriteFile(
                            handle_, bytes.data() + consumed, requested, &written, nullptr) ||
                        written == 0U)
                    {
                        throw std::system_error(
                            static_cast<int>(GetLastError()),
                            std::system_category(),
                            "Remote download partial file write failed");
                    }
                    consumed += written;
#else
                    const ssize_t written = ::write(
                        descriptor_, bytes.data() + consumed, bytes.size() - consumed);
                    if (written <= 0)
                    {
                        throw std::system_error(errno, std::generic_category(),
                            "Remote download partial file write failed");
                    }
                    consumed += static_cast<std::size_t>(written);
#endif
                }
                position_ += static_cast<std::uint64_t>(bytes.size());
            }

            void flush() override
            {
#ifdef _WIN32
                if (!FlushFileBuffers(handle_))
                {
                    throw std::system_error(
                        static_cast<int>(GetLastError()),
                        std::system_category(),
                        "Remote download partial file flush failed");
                }
#else
                if (::fsync(descriptor_) != 0)
                {
                    throw std::system_error(errno, std::generic_category(),
                        "Remote download partial file flush failed");
                }
#endif
            }

            [[nodiscard]] std::uint64_t position() const noexcept override
            {
                return position_;
            }

        private:
            std::uint64_t position_{0};
#ifdef _WIN32
            HANDLE handle_{INVALID_HANDLE_VALUE};
#else
            int descriptor_{-1};
#endif
        };

        bool sameCanonicalDirectory(
            const std::filesystem::path& left,
            const std::filesystem::path& right,
            const PathSafetyService& safety)
        {
            return safety.canonicalize(left.parent_path()) ==
                safety.canonicalize(right.parent_path());
        }
    }

    RemoteDownloadPathValidation RemoteDownloadFileStore::validatePaths(
        const std::filesystem::path& allowedRoot,
        const std::filesystem::path& partialPath,
        const std::filesystem::path& destinationPath,
        std::uint64_t requiredBytes) const
    {
        RemoteDownloadPathValidation result;
        try
        {
            PathSafetyService safety;
            const PathSafetyResult root = safety.validateDirectoryWriteRoot(allowedRoot);
            const PathSafetyResult partial = safety.validateWritePath(
                allowedRoot,
                partialPath,
                {.requiredBytes = requiredBytes});
            const PathSafetyResult destination = safety.validateWritePath(
                allowedRoot,
                destinationPath);
            const PathSafetyResult sidecar = safety.validateWritePath(
                allowedRoot,
                RemoteDownloadSidecarStore::sidecarPathFor(partialPath));
            if (!root.safe() || !partial.safe() || !destination.safe() || !sidecar.safe())
            {
                result.message = "Remote download paths are outside the safe write boundary.";
                return result;
            }

            result.partialPath = partial.canonicalPath;
            result.destinationPath = destination.canonicalPath;
            if (result.partialPath.empty() || result.destinationPath.empty() ||
                result.partialPath == result.destinationPath ||
                result.partialPath.filename().empty() ||
                result.destinationPath.filename().empty() ||
                !sameCanonicalDirectory(result.partialPath, result.destinationPath, safety) ||
                existingPathIsReparsePoint(result.partialPath) ||
                existingPathIsReparsePoint(result.destinationPath))
            {
                result.message = "Remote download partial and destination paths are not a safe same-directory pair.";
                return result;
            }
            result.safe = true;
            return result;
        }
        catch (...)
        {
            result.message = "Remote download paths could not be validated.";
            return result;
        }
    }

    bool RemoteDownloadFileStore::exists(const std::filesystem::path& path) const
    {
        std::error_code error;
        const bool present = std::filesystem::exists(path, error);
        if (error)
        {
            throw std::filesystem::filesystem_error("Remote download path could not be inspected.", path, error);
        }
        return present;
    }

    std::optional<std::uint64_t> RemoteDownloadFileStore::size(
        const std::filesystem::path& path) const
    {
        std::error_code error;
        if (!std::filesystem::exists(path, error))
        {
            if (error)
            {
                throw std::filesystem::filesystem_error("Remote download file could not be inspected.", path, error);
            }
            return std::nullopt;
        }
        if (!std::filesystem::is_regular_file(path, error) || error || existingPathIsReparsePoint(path))
        {
            throw std::runtime_error("Remote download partial path is not a regular non-reparse file.");
        }
        const std::uintmax_t value = std::filesystem::file_size(path, error);
        if (error || value > (std::numeric_limits<std::uint64_t>::max)())
        {
            throw std::runtime_error("Remote download partial file size could not be read.");
        }
        return static_cast<std::uint64_t>(value);
    }

    void RemoteDownloadFileStore::truncate(
        const std::filesystem::path& path,
        std::uint64_t size)
    {
        const std::optional<std::uint64_t> current = this->size(path);
        if (!current.has_value())
        {
            if (size != 0U)
            {
                throw std::runtime_error("Remote download partial file is missing.");
            }
            std::ofstream created(path, std::ios::out | std::ios::binary | std::ios::trunc);
            if (!created)
            {
                throw std::runtime_error("Remote download partial file could not be created.");
            }
            return;
        }
        std::error_code error;
        std::filesystem::resize_file(path, static_cast<std::uintmax_t>(size), error);
        if (error)
        {
            throw std::filesystem::filesystem_error("Remote download partial file could not be truncated.", path, error);
        }
    }

    std::unique_ptr<IRemoteDownloadFileWriter> RemoteDownloadFileStore::openWriter(
        const std::filesystem::path& path,
        std::uint64_t expectedOffset)
    {
        return std::make_unique<NativeRemoteDownloadFileWriter>(path, expectedOffset);
    }

    std::optional<std::string> RemoteDownloadFileStore::sha256(
        const std::filesystem::path& path,
        const IRemoteDownloadCancellation& cancellation) const
    {
        if (cancellation.isCancellationRequested())
        {
            return std::nullopt;
        }
        if (existingPathIsReparsePoint(path))
        {
            throw std::runtime_error("Remote download hash source became a reparse point.");
        }
        try
        {
            const std::wstring hash = computeFluxPackFileSha256(
                path,
                [&](std::uintmax_t)
                {
                    if (cancellation.isCancellationRequested())
                    {
                        throw HashCancelled{};
                    }
                });
            std::string result;
            result.reserve(hash.size());
            std::transform(hash.begin(), hash.end(), std::back_inserter(result),
                [](wchar_t value) { return static_cast<char>(value); });
            return result;
        }
        catch (const HashCancelled&)
        {
            return std::nullopt;
        }
    }

    void RemoteDownloadFileStore::remove(const std::filesystem::path& path) noexcept
    {
        std::error_code error;
        std::filesystem::remove(path, error);
    }

    RemoteDownloadPromotionOutcome RemoteDownloadFileStore::promoteNoReplace(
        const std::filesystem::path& partialPath,
        const std::filesystem::path& destinationPath)
    {
        PathSafetyService safety;
        if (!sameCanonicalDirectory(partialPath, destinationPath, safety) ||
            partialPath == destinationPath ||
            existingPathIsReparsePoint(partialPath) ||
            existingPathIsReparsePoint(destinationPath))
        {
            return RemoteDownloadPromotionOutcome::Failure;
        }
#ifdef _WIN32
        if (MoveFileExW(
                partialPath.c_str(),
                destinationPath.c_str(),
                MOVEFILE_WRITE_THROUGH) != 0)
        {
            return RemoteDownloadPromotionOutcome::Promoted;
        }
        const DWORD error = GetLastError();
        return error == ERROR_ALREADY_EXISTS || error == ERROR_FILE_EXISTS
            ? RemoteDownloadPromotionOutcome::DestinationExists
            : RemoteDownloadPromotionOutcome::Failure;
#else
        if (::link(partialPath.c_str(), destinationPath.c_str()) == 0)
        {
            if (::unlink(partialPath.c_str()) == 0)
            {
                return RemoteDownloadPromotionOutcome::Promoted;
            }
            std::error_code cleanup;
            std::filesystem::remove(destinationPath, cleanup);
            return RemoteDownloadPromotionOutcome::Failure;
        }
        return errno == EEXIST
            ? RemoteDownloadPromotionOutcome::DestinationExists
            : RemoteDownloadPromotionOutcome::Failure;
#endif
    }
}
