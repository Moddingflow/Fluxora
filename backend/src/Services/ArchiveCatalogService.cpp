#include "FluxoraCore/Services/ArchiveCatalogService.hpp"

#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Support/FilesystemPath.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <condition_variable>
#include <cstdint>
#include <cwctype>
#include <deque>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iterator>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view archiveSidecarExtension = L".fluxora.archive.json";
        constexpr std::array<std::wstring_view, 9> compoundArchiveExtensions{
            L".tar.gz", L".tar.bz2", L".tar.xz", L".tar.zst", L".tgz",
            L".tbz", L".tbz2", L".txz", L".7z.001"
        };
        constexpr std::array<std::wstring_view, 26> supportedArchiveExtensions{
            L".zip", L".7z", L".7z.001", L".rar", L".fomod", L".omod",
            L".tar", L".tar.gz", L".tgz", L".tar.bz2", L".tbz", L".tbz2",
            L".tar.xz", L".txz", L".tar.zst", L".gz", L".bz2", L".xz",
            L".zst", L".cab", L".iso", L".wim", L".arj", L".lzh", L".lha",
            L".ba2"
        };
        std::mutex catalogMutationMutex;

        class ArchiveIndexScheduler final
        {
        public:
            ArchiveIndexScheduler()
                : worker_([this]()
                {
                    run();
                })
            {
            }

            ArchiveIndexScheduler(const ArchiveIndexScheduler&) = delete;
            ArchiveIndexScheduler& operator=(const ArchiveIndexScheduler&) = delete;

            ~ArchiveIndexScheduler()
            {
                {
                    const std::lock_guard lock(mutex_);
                    stopping_ = true;
                }
                changed_.notify_all();
                worker_.join();
            }

            void enqueue(std::function<void()> task)
            {
                {
                    const std::lock_guard lock(mutex_);
                    tasks_.push_back(std::move(task));
                }
                changed_.notify_one();
            }

        private:
            void run()
            {
                for (;;)
                {
                    std::function<void()> task;
                    {
                        std::unique_lock lock(mutex_);
                        changed_.wait(lock, [this]()
                        {
                            return stopping_ || !tasks_.empty();
                        });
                        if (stopping_ && tasks_.empty())
                        {
                            return;
                        }
                        task = std::move(tasks_.front());
                        tasks_.pop_front();
                    }
                    task();
                }
            }

            std::mutex mutex_;
            std::condition_variable changed_;
            std::deque<std::function<void()>> tasks_;
            std::thread worker_;
            bool stopping_{false};
        };

        struct AsyncArchiveIndex
        {
            std::string requestedIdentity;
            ArchiveCatalogLookupState state{ArchiveCatalogLookupState::Indexing};
            ArchiveCatalogEntry entry;
            std::wstring message;
        };

        std::mutex asyncIndexMutex;
        std::map<std::wstring, std::shared_ptr<AsyncArchiveIndex>> asyncIndexes;

        [[nodiscard]] ArchiveIndexScheduler& archiveIndexScheduler()
        {
            static ArchiveIndexScheduler scheduler;
            return scheduler;
        }

        [[nodiscard]] std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        [[nodiscard]] std::wstring archiveExtension(const std::filesystem::path& path)
        {
            const std::wstring fileName = toLower(path.filename().wstring());
            for (const std::wstring_view extension : compoundArchiveExtensions)
            {
                if (fileName.ends_with(extension))
                {
                    return std::wstring(extension);
                }
            }
            return toLower(path.extension().wstring());
        }

        [[nodiscard]] bool isLowerHexSha256(std::wstring_view value)
        {
            return value.size() == 64 && std::all_of(value.begin(), value.end(), [](wchar_t character)
            {
                return (character >= L'0' && character <= L'9') ||
                    (character >= L'a' && character <= L'f');
            });
        }

        [[nodiscard]] std::string readTextFile(const std::filesystem::path& path)
        {
            std::ifstream file(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
            if (!file)
            {
                return {};
            }
            return std::string(
                std::istreambuf_iterator<char>(file),
                std::istreambuf_iterator<char>());
        }

        [[nodiscard]] std::wstring asciiWide(std::string_view value)
        {
            return std::wstring(value.begin(), value.end());
        }

        [[nodiscard]] std::string asciiNarrow(std::wstring_view value)
        {
            std::string result;
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                if (character < 0 || character > 0x7f)
                {
                    throw std::invalid_argument("Archive sidecar contains non-ASCII identity data.");
                }
                result.push_back(static_cast<char>(character));
            }
            return result;
        }

        struct CachedArchiveIdentity
        {
            std::wstring sha256;
            std::string fileIdentity;
        };

        [[nodiscard]] std::optional<CachedArchiveIdentity> readArchiveSidecar(
            const std::filesystem::path& archivePath)
        {
            const std::string content = readTextFile(ArchiveCatalogService::sidecarPathFor(archivePath));
            if (content.empty())
            {
                return std::nullopt;
            }

            try
            {
                const JsonValue root = JsonReader::parse(asciiWide(content));
                if (!root.isObject())
                {
                    return std::nullopt;
                }
                const JsonValue* sha = root.find(L"sha256");
                const JsonValue* identity = root.find(L"fileIdentity");
                if (sha == nullptr || !sha->isString() ||
                    identity == nullptr || !identity->isString() ||
                    !isLowerHexSha256(sha->asString()))
                {
                    return std::nullopt;
                }
                return CachedArchiveIdentity{sha->asString(), asciiNarrow(identity->asString())};
            }
            catch (const std::exception&)
            {
                return std::nullopt;
            }
        }

        void writeArchiveSidecar(
            const std::filesystem::path& archivePath,
            std::wstring_view sha256,
            std::string_view fileIdentity)
        {
            const std::string content =
                "{\"schemaVersion\":1,\"sha256\":\"" + asciiNarrow(sha256) +
                "\",\"fileIdentity\":\"" + std::string(fileIdentity) + "\"}";
            AtomicFileWriteOptions options;
            options.stateName = L"archive catalog sidecar";
            options.validation = ProjectStateValidation::JsonObject;
            options.keepBackup = false;
            AtomicFileStore().writeTextFile(
                ArchiveCatalogService::sidecarPathFor(archivePath),
                content,
                options);
        }

        [[nodiscard]] std::string regularFileIdentityToken(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const std::filesystem::path ioPath = pathForFilesystemIo(path);
            const HANDLE handle = CreateFileW(
                ioPath.c_str(),
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                nullptr,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                nullptr);
            if (handle == INVALID_HANDLE_VALUE)
            {
                throw std::runtime_error("Failed to inspect archive identity.");
            }

            BY_HANDLE_FILE_INFORMATION information{};
            FILE_BASIC_INFO basicInformation{};
            const BOOL informationRead = GetFileInformationByHandle(handle, &information);
            const BOOL basicInformationRead = GetFileInformationByHandleEx(
                handle,
                FileBasicInfo,
                &basicInformation,
                sizeof(basicInformation));
            CloseHandle(handle);
            if (informationRead == FALSE || basicInformationRead == FALSE)
            {
                throw std::runtime_error("Failed to read archive identity.");
            }

            std::ostringstream token;
            token << information.dwVolumeSerialNumber << ':'
                  << information.nFileIndexHigh << ':'
                  << information.nFileIndexLow << ':'
                  << information.nFileSizeHigh << ':'
                  << information.nFileSizeLow << ':'
                  << information.ftLastWriteTime.dwHighDateTime << ':'
                  << information.ftLastWriteTime.dwLowDateTime << ':'
                  << basicInformation.ChangeTime.QuadPart;
            return token.str();
#else
            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
            std::error_code timeError;
            const auto modified = std::filesystem::last_write_time(path, timeError);
            if (sizeError || timeError)
            {
                throw std::runtime_error("Failed to inspect archive identity.");
            }
            return std::to_string(size) + ":" +
                std::to_string(modified.time_since_epoch().count());
#endif
        }

        [[nodiscard]] std::wstring sha256ForFile(const std::filesystem::path& path)
        {
#ifndef _WIN32
            (void)path;
            throw std::runtime_error("Archive SHA-256 hashing requires the Windows crypto provider.");
#else
            BCRYPT_ALG_HANDLE algorithm = nullptr;
            BCRYPT_HASH_HANDLE hash = nullptr;
            std::vector<unsigned char> hashObject;
            try
            {
                if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0)
                {
                    throw std::runtime_error("Failed to initialize archive SHA-256 hashing.");
                }

                DWORD bytesWritten = 0;
                DWORD objectLength = 0;
                DWORD hashLength = 0;
                if (BCryptGetProperty(
                        algorithm,
                        BCRYPT_OBJECT_LENGTH,
                        reinterpret_cast<PUCHAR>(&objectLength),
                        sizeof(objectLength),
                        &bytesWritten,
                        0) < 0 ||
                    BCryptGetProperty(
                        algorithm,
                        BCRYPT_HASH_LENGTH,
                        reinterpret_cast<PUCHAR>(&hashLength),
                        sizeof(hashLength),
                        &bytesWritten,
                        0) < 0 ||
                    objectLength == 0 || hashLength != 32)
                {
                    throw std::runtime_error("Failed to configure archive SHA-256 hashing.");
                }

                hashObject.resize(objectLength);
                if (BCryptCreateHash(
                        algorithm,
                        &hash,
                        hashObject.data(),
                        static_cast<ULONG>(hashObject.size()),
                        nullptr,
                        0,
                        0) < 0)
                {
                    throw std::runtime_error("Failed to create archive SHA-256 state.");
                }

                std::ifstream file(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
                if (!file)
                {
                    throw std::runtime_error("Failed to open archive for SHA-256 hashing.");
                }
                std::vector<unsigned char> buffer(1024 * 1024);
                while (file)
                {
                    file.read(
                        reinterpret_cast<char*>(buffer.data()),
                        static_cast<std::streamsize>(buffer.size()));
                    const std::streamsize read = file.gcount();
                    if (read > 0 && BCryptHashData(
                            hash,
                            buffer.data(),
                            static_cast<ULONG>(read),
                            0) < 0)
                    {
                        throw std::runtime_error("Failed while hashing archive contents.");
                    }
                }
                if (!file.eof())
                {
                    throw std::runtime_error("Failed while reading archive contents.");
                }

                std::array<unsigned char, 32> digest{};
                if (BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) < 0)
                {
                    throw std::runtime_error("Failed to finalize archive SHA-256 hashing.");
                }
                BCryptDestroyHash(hash);
                hash = nullptr;
                BCryptCloseAlgorithmProvider(algorithm, 0);
                algorithm = nullptr;

                std::wostringstream stream;
                stream << std::hex << std::setfill(L'0');
                for (const unsigned char byte : digest)
                {
                    stream << std::setw(2) << static_cast<unsigned int>(byte);
                }
                return stream.str();
            }
            catch (...)
            {
                if (hash != nullptr)
                {
                    BCryptDestroyHash(hash);
                }
                if (algorithm != nullptr)
                {
                    BCryptCloseAlgorithmProvider(algorithm, 0);
                }
                throw;
            }
#endif
        }

        [[nodiscard]] ArchiveCatalogEntry identifyStableArchive(
            const std::filesystem::path& archivePath,
            bool persistSidecar = true)
        {
            for (int attempt = 0; attempt < 2; ++attempt)
            {
                const std::string identityBefore = regularFileIdentityToken(archivePath);
                if (const std::optional<CachedArchiveIdentity> cached = persistSidecar
                        ? readArchiveSidecar(archivePath)
                        : std::nullopt;
                    cached.has_value() && cached->fileIdentity == identityBefore)
                {
                    return ArchiveCatalogEntry{
                        archivePath,
                        cached->sha256,
                        L"sha256:" + cached->sha256,
                        false
                    };
                }

                const std::wstring sha256 = sha256ForFile(archivePath);
                const std::string identityAfter = regularFileIdentityToken(archivePath);
                if (identityBefore != identityAfter)
                {
                    continue;
                }
                if (persistSidecar)
                {
                    writeArchiveSidecar(archivePath, sha256, identityAfter);
                }
                return ArchiveCatalogEntry{
                    archivePath,
                    sha256,
                    L"sha256:" + sha256,
                    false
                };
            }
            throw std::runtime_error("Archive changed while its SHA-256 identity was being calculated.");
        }

        [[nodiscard]] std::wstring archiveIndexKey(const std::filesystem::path& path)
        {
            return toLower(std::filesystem::absolute(path).lexically_normal().wstring());
        }

        [[nodiscard]] std::filesystem::path collisionPath(
            const std::filesystem::path& directory,
            const std::filesystem::path& sourcePath,
            std::wstring_view sha256,
            int suffix = 0)
        {
            const std::wstring extension = archiveExtension(sourcePath);
            std::wstring stem = sourcePath.filename().wstring();
            if (!extension.empty() && stem.size() > extension.size())
            {
                stem.resize(stem.size() - extension.size());
            }
            std::wstring fileName = stem + L"-" + std::wstring(sha256.substr(0, 8));
            if (suffix > 0)
            {
                fileName += L"-" + std::to_wstring(suffix);
            }
            fileName += extension;
            return directory / fileName;
        }
    }

    ArchiveCatalogService::ArchiveCatalogService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings,
        DestinationUnavailable destinationUnavailable) noexcept
        : logger_(logger),
          pathSettings_(pathSettings),
          destinationUnavailable_(std::move(destinationUnavailable))
    {
    }

    ArchiveCatalogEntry ArchiveCatalogService::importArchive(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& sourcePath) const
    {
        if (projectDirectory.empty() || sourcePath.empty() ||
            !std::filesystem::is_regular_file(sourcePath))
        {
            throw std::invalid_argument("Project directory and an existing archive are required.");
        }
        if (!isSupportedArchiveFile(sourcePath))
        {
            throw std::invalid_argument("Archive file type is not supported.");
        }

        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        PathSafetyService().validateDirectoryWriteRoot(directory)
            .throwIfUnsafe("Global downloads directory is unsafe");
        std::filesystem::create_directories(directory);

        const PathSafetyService safety;
        if (safety.isSameOrInside(sourcePath, directory))
        {
            return identifyArchive(projectDirectory, sourcePath);
        }

        const std::lock_guard mutationLock(catalogMutationMutex);
        const ArchiveCatalogEntry source = identifyStableArchive(sourcePath, false);
        for (const auto& candidate : std::filesystem::directory_iterator(directory))
        {
            std::error_code statusError;
            if (!candidate.is_regular_file(statusError) ||
                !isSupportedArchiveFile(candidate.path()))
            {
                continue;
            }
            const ArchiveCatalogEntry existing = identifyStableArchive(candidate.path());
            if (existing.sha256 == source.sha256)
            {
                logger_.writeOperation(
                    LogLevel::Info,
                    "ArchiveCatalog",
                    "Reused an existing global archive with the same SHA-256.");
                return existing;
            }
        }

        const auto destinationUnavailable = [this](const std::filesystem::path& path)
        {
            return std::filesystem::exists(path) ||
                (destinationUnavailable_ && destinationUnavailable_(path));
        };

        std::filesystem::path destination = directory / sourcePath.filename();
        if (destinationUnavailable(destination))
        {
            destination = collisionPath(directory, sourcePath, source.sha256);
            for (int suffix = 2; destinationUnavailable(destination); ++suffix)
            {
                if (std::filesystem::exists(destination))
                {
                    const ArchiveCatalogEntry existing = identifyStableArchive(destination);
                    if (existing.sha256 == source.sha256)
                    {
                        return existing;
                    }
                }
                destination = collisionPath(directory, sourcePath, source.sha256, suffix);
            }
        }

        std::error_code sizeError;
        const std::uintmax_t size = std::filesystem::file_size(sourcePath, sizeError);
        safety.validateWritePath(
            directory,
            destination,
            PathSafetyWriteOptions{sizeError ? 0 : size, false})
            .throwIfUnsafe("Global archive destination is unsafe");

        AtomicFileWriteOptions writeOptions;
        writeOptions.stateName = L"global archive";
        writeOptions.validation = ProjectStateValidation::None;
        writeOptions.keepBackup = false;
        try
        {
            AtomicFileStore().writeFileAtomically(
                destination,
                [&sourcePath](const std::filesystem::path& temporaryPath)
                {
                    std::filesystem::copy_file(
                        pathForFilesystemIo(sourcePath),
                        pathForFilesystemIo(temporaryPath),
                        std::filesystem::copy_options::none);
                },
                writeOptions);
            ArchiveCatalogEntry imported = identifyStableArchive(destination);
            if (imported.sha256 != source.sha256)
            {
                throw std::runtime_error("Imported archive SHA-256 did not match its source.");
            }
            imported.createdNewFile = true;
            logger_.writeOperation(
                LogLevel::Info,
                "ArchiveCatalog",
                "Imported a new archive into the global game catalog.");
            return imported;
        }
        catch (...)
        {
            std::error_code cleanupError;
            std::filesystem::remove(destination, cleanupError);
            std::filesystem::remove(sidecarPathFor(destination), cleanupError);
            throw;
        }
    }

    ArchiveCatalogEntry ArchiveCatalogService::identifyArchive(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& archivePath) const
    {
        if (projectDirectory.empty() || archivePath.empty() ||
            !std::filesystem::is_regular_file(archivePath))
        {
            throw std::invalid_argument("Project directory and an existing archive are required.");
        }
        if (!isSupportedArchiveFile(archivePath))
        {
            throw std::invalid_argument("Archive file type is not supported.");
        }

        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        const PathSafetyService safety;
        safety.validateContainedPath(directory, archivePath)
            .throwIfUnsafe("Archive is outside the global downloads directory");
        std::error_code symlinkError;
        if (std::filesystem::is_symlink(archivePath, symlinkError))
        {
            throw std::invalid_argument("Archive links are not allowed in the global downloads directory.");
        }
        return identifyStableArchive(archivePath);
    }

    ArchiveCatalogEntry ArchiveCatalogService::consolidateArchive(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& archivePath) const
    {
        const std::lock_guard mutationLock(catalogMutationMutex);
        // Hashing the completed file and publishing its catalog sidecar happen under the same
        // mutation lock as deduplication. A concurrently completed raw transfer has no catalog
        // sidecar yet and must not be selected as the retained object: its own consolidation
        // may otherwise remove the path another thread just returned.
        const ArchiveCatalogEntry completed = identifyArchive(projectDirectory, archivePath);
        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        const PathSafetyService safety;
        for (const auto& candidate : std::filesystem::directory_iterator(directory))
        {
            std::error_code statusError;
            if (!candidate.is_regular_file(statusError) ||
                !isSupportedArchiveFile(candidate.path()) ||
                safety.canonicalize(candidate.path()) == safety.canonicalize(archivePath) ||
                !std::filesystem::is_regular_file(sidecarPathFor(candidate.path()), statusError))
            {
                continue;
            }

            const ArchiveCatalogEntry existing = identifyStableArchive(candidate.path());
            if (existing.sha256 != completed.sha256)
            {
                continue;
            }

            std::error_code removeError;
            std::filesystem::remove(archivePath, removeError);
            if (removeError)
            {
                throw std::runtime_error(
                    "Duplicate completed archive could not be removed from the global catalog.");
            }
            removeArchiveSidecar(archivePath);
            logger_.writeOperation(
                LogLevel::Info,
                "ArchiveCatalog",
                "Consolidated a completed transfer with an existing SHA-256 archive.");
            return existing;
        }

        ArchiveCatalogEntry retained = completed;
        retained.createdNewFile = true;
        return retained;
    }

    ArchiveCatalogLookup ArchiveCatalogService::lookupArchive(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& archivePath) const
    {
        if (projectDirectory.empty() || archivePath.empty() ||
            !std::filesystem::is_regular_file(archivePath))
        {
            throw std::invalid_argument("Project directory and an existing archive are required.");
        }
        if (!isSupportedArchiveFile(archivePath))
        {
            throw std::invalid_argument("Archive file type is not supported.");
        }

        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        const PathSafetyService safety;
        safety.validateContainedPath(directory, archivePath)
            .throwIfUnsafe("Archive is outside the global downloads directory");
        std::error_code symlinkError;
        if (std::filesystem::is_symlink(archivePath, symlinkError))
        {
            throw std::invalid_argument("Archive links are not allowed in the global downloads directory.");
        }

        const std::string currentIdentity = regularFileIdentityToken(archivePath);
        if (const std::optional<CachedArchiveIdentity> cached = readArchiveSidecar(archivePath);
            cached.has_value() && cached->fileIdentity == currentIdentity)
        {
            return ArchiveCatalogLookup{
                ArchiveCatalogLookupState::Ready,
                ArchiveCatalogEntry{
                    archivePath,
                    cached->sha256,
                    L"sha256:" + cached->sha256,
                    false},
                {}}
            ;
        }

        const std::wstring key = archiveIndexKey(archivePath);
        std::shared_ptr<AsyncArchiveIndex> work;
        {
            const std::lock_guard lock(asyncIndexMutex);
            const auto found = asyncIndexes.find(key);
            if (found != asyncIndexes.end() &&
                found->second->requestedIdentity == currentIdentity)
            {
                return ArchiveCatalogLookup{
                    found->second->state,
                    found->second->entry,
                    found->second->message};
            }

            work = std::make_shared<AsyncArchiveIndex>();
            work->requestedIdentity = currentIdentity;
            asyncIndexes.insert_or_assign(key, work);
        }

        archiveIndexScheduler().enqueue([archivePath, key, work]()
        {
            ArchiveCatalogEntry indexed;
            std::wstring failure;
            try
            {
                indexed = identifyStableArchive(archivePath);
            }
            catch (const std::exception& exception)
            {
                const std::string message(exception.what());
                failure.assign(message.begin(), message.end());
            }

            const std::lock_guard lock(asyncIndexMutex);
            const auto found = asyncIndexes.find(key);
            if (found == asyncIndexes.end() || found->second != work)
            {
                return;
            }
            if (failure.empty())
            {
                work->state = ArchiveCatalogLookupState::Ready;
                work->entry = std::move(indexed);
            }
            else
            {
                work->state = ArchiveCatalogLookupState::Failed;
                work->message = std::move(failure);
            }
        });

        return ArchiveCatalogLookup{ArchiveCatalogLookupState::Indexing, {}, {}};
    }

    void ArchiveCatalogService::removeArchiveSidecar(
        const std::filesystem::path& archivePath) const
    {
        std::error_code error;
        std::filesystem::remove(sidecarPathFor(archivePath), error);
        std::filesystem::remove(
            AtomicFileStore::backupPathFor(sidecarPathFor(archivePath)),
            error);
        const std::lock_guard lock(asyncIndexMutex);
        asyncIndexes.erase(archiveIndexKey(archivePath));
    }

    std::filesystem::path ArchiveCatalogService::sidecarPathFor(
        const std::filesystem::path& archivePath)
    {
        return std::filesystem::path(archivePath.wstring() + std::wstring(archiveSidecarExtension));
    }

    bool ArchiveCatalogService::isSupportedArchiveFile(
        const std::filesystem::path& archivePath)
    {
        const std::wstring extension = archiveExtension(archivePath);
        if (std::find(
            supportedArchiveExtensions.begin(),
            supportedArchiveExtensions.end(),
            extension) != supportedArchiveExtensions.end())
        {
            return true;
        }

        const GameSupportRegistry& registry = GameSupportRegistry::embedded();
        return std::any_of(
            registry.definitions().begin(),
            registry.definitions().end(),
            [&extension](const GameDefinition& definition)
            {
                return std::any_of(
                    definition.archiveExtensions.begin(),
                    definition.archiveExtensions.end(),
                    [&extension](const NormalizedExtension& candidate)
                    {
                        return candidate.value() == extension;
                    });
            });
    }
}
