#include "FluxoraCore/Services/ModdingFlowDownloadQueueService.hpp"

#include "FluxoraCore/Services/ArchiveCatalogService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadTransferLimiter.hpp"
#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModdingFlowApiResponse.hpp"
#include "FluxoraCore/Services/ModdingFlowPublicApiClient.hpp"
#include "FluxoraCore/Services/ModdingFlowRemoteDownloadResolver.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Services/RemoteDownloadProviderRegistry.hpp"
#include "FluxoraCore/Services/SignedRemoteDownloadTransport.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <atomic>
#include <charconv>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cwctype>
#include <deque>
#include <filesystem>
#include <fstream>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view manifestPrefix = L".fluxora-moddingflow-";
        constexpr std::wstring_view manifestSuffix = L".download.json";
        constexpr std::wstring_view partialSuffix = L".part";
        constexpr std::size_t maximumManifestBytes = 64U * 1024U;

        std::uint64_t currentUnixMilliseconds() noexcept
        {
            return static_cast<std::uint64_t>(
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count());
        }

        std::wstring asciiToWide(std::string_view value)
        {
            return std::wstring(value.begin(), value.end());
        }

        std::string wideToUtf8(std::wstring_view value)
        {
            return moddingFlowJsonStringToUtf8(value);
        }

        std::filesystem::path pathFromUtf8(std::string_view value)
        {
            std::u8string encoded;
            encoded.reserve(value.size());
            for (const unsigned char byte : value)
            {
                encoded.push_back(static_cast<char8_t>(byte));
            }
            return std::filesystem::path(encoded);
        }

        std::wstring utf8PathComponent(std::string_view value)
        {
            return pathFromUtf8(value).wstring();
        }

        std::wstring pathKey(const std::filesystem::path& value)
        {
            std::wstring key = std::filesystem::absolute(value).lexically_normal().wstring();
#ifdef _WIN32
            std::transform(key.begin(), key.end(), key.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
#endif
            return key;
        }

        std::filesystem::path manifestPathFor(
            const std::filesystem::path& root,
            std::string_view artifactId)
        {
            return root / std::filesystem::path(
                std::wstring(manifestPrefix) + asciiToWide(artifactId) +
                std::wstring(manifestSuffix));
        }

        std::filesystem::path partialPathFor(
            const std::filesystem::path& root,
            std::string_view artifactId)
        {
            return root / std::filesystem::path(
                std::wstring(manifestPrefix) + asciiToWide(artifactId) +
                std::wstring(partialSuffix));
        }

        bool isManifestPath(const std::filesystem::path& path) noexcept
        {
            const std::wstring name = path.filename().wstring();
            return name.size() > manifestPrefix.size() + manifestSuffix.size() &&
                name.starts_with(manifestPrefix) && name.ends_with(manifestSuffix);
        }

        std::string stateText(ModdingFlowManagedDownloadState state)
        {
            switch (state)
            {
            case ModdingFlowManagedDownloadState::Queued: return "queued";
            case ModdingFlowManagedDownloadState::Downloading: return "downloading";
            case ModdingFlowManagedDownloadState::Paused: return "paused";
            case ModdingFlowManagedDownloadState::RetryScheduled: return "retry-scheduled";
            case ModdingFlowManagedDownloadState::Failed: return "failed";
            case ModdingFlowManagedDownloadState::Cancelled: return "cancelled";
            case ModdingFlowManagedDownloadState::Completed: return "completed";
            }
            throw std::invalid_argument("Managed download state is invalid.");
        }

        ModdingFlowManagedDownloadState parseState(std::string_view state)
        {
            if (state == "queued") return ModdingFlowManagedDownloadState::Queued;
            if (state == "downloading") return ModdingFlowManagedDownloadState::Downloading;
            if (state == "paused") return ModdingFlowManagedDownloadState::Paused;
            if (state == "retry-scheduled") return ModdingFlowManagedDownloadState::RetryScheduled;
            if (state == "failed") return ModdingFlowManagedDownloadState::Failed;
            if (state == "cancelled") return ModdingFlowManagedDownloadState::Cancelled;
            if (state == "completed") return ModdingFlowManagedDownloadState::Completed;
            throw std::runtime_error("Managed download manifest state is invalid.");
        }

        const JsonValue& requiredMember(
            const JsonValue& object,
            std::wstring_view name,
            JsonValue::Type type)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Managed download manifest is not an object.");
            }
            const JsonValue* value = object.find(name);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("Managed download manifest field is invalid.");
            }
            return *value;
        }

        std::string requiredUtf8String(
            const JsonValue& object,
            std::wstring_view name,
            std::size_t maximumBytes,
            bool allowEmpty = false)
        {
            const std::string value = wideToUtf8(
                requiredMember(object, name, JsonValue::Type::String).asString());
            if ((!allowEmpty && value.empty()) || value.size() > maximumBytes)
            {
                throw std::runtime_error("Managed download manifest string is invalid.");
            }
            return value;
        }

        std::wstring requiredWideString(
            const JsonValue& object,
            std::wstring_view name,
            std::size_t maximumCodeUnits,
            bool allowEmpty = false)
        {
            const std::wstring value =
                requiredMember(object, name, JsonValue::Type::String).asString();
            if ((!allowEmpty && value.empty()) || value.size() > maximumCodeUnits)
            {
                throw std::runtime_error("Managed download manifest string is invalid.");
            }
            return value;
        }

        std::uint64_t requiredUnsigned(const JsonValue& object, std::wstring_view name)
        {
            const std::wstring& number =
                requiredMember(object, name, JsonValue::Type::Number).asNumber();
            if (number.empty() || number.size() > 20U ||
                !std::all_of(number.begin(), number.end(), [](wchar_t character)
                {
                    return character >= L'0' && character <= L'9';
                }))
            {
                throw std::runtime_error("Managed download manifest number is invalid.");
            }
            std::string ascii;
            ascii.reserve(number.size());
            for (const wchar_t digit : number)
            {
                ascii.push_back(static_cast<char>(digit));
            }
            std::uint64_t value = 0U;
            const auto [end, error] = std::from_chars(
                ascii.data(), ascii.data() + ascii.size(), value);
            if (error != std::errc{} || end != ascii.data() + ascii.size())
            {
                throw std::runtime_error("Managed download manifest number is invalid.");
            }
            return value;
        }

        void requireExactManifest(const JsonValue& root)
        {
            static const std::set<std::wstring> expected{
                L"schemaVersion", L"artifactId", L"modId", L"versionId", L"jobId",
                L"operationId", L"fileName", L"gameSlug", L"version", L"expectedSha256",
                L"expectedSize", L"bytesReceived", L"createdAtUnixMs", L"retryAtUnixMs",
                L"state", L"message"};
            if (!root.isObject() || root.asObject().size() != expected.size())
            {
                throw std::runtime_error("Managed download manifest shape is invalid.");
            }
            for (const auto& [name, value] : root.asObject())
            {
                static_cast<void>(value);
                if (!expected.contains(name))
                {
                    throw std::runtime_error("Managed download manifest shape is invalid.");
                }
            }
        }

        AtomicFileWriteOptions manifestWriteOptions()
        {
            return {
                .stateName = L"ModdingFlow managed download manifest",
                .validation = ProjectStateValidation::JsonObject,
                .keepBackup = true};
        }

        std::string serializeManifest(const ModdingFlowManagedDownloadSnapshot& snapshot)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"schemaVersion", static_cast<std::uintmax_t>(1U));
            writer.field(L"artifactId", asciiToWide(snapshot.request.artifactId));
            writer.field(L"modId", asciiToWide(snapshot.request.modId));
            writer.field(L"versionId", asciiToWide(snapshot.request.versionId));
            writer.field(L"jobId", asciiToWide(snapshot.request.jobId));
            writer.field(L"operationId", snapshot.request.operationId);
            writer.field(L"fileName", snapshot.fileName);
            writer.field(L"gameSlug", snapshot.gameSlug);
            writer.field(L"version", snapshot.version);
            writer.field(L"expectedSha256", asciiToWide(snapshot.expectedSha256));
            writer.field(L"expectedSize", static_cast<std::uintmax_t>(snapshot.expectedSize));
            writer.field(L"bytesReceived", static_cast<std::uintmax_t>(snapshot.bytesReceived));
            writer.field(L"createdAtUnixMs", static_cast<std::uintmax_t>(snapshot.createdAtUnixMs));
            writer.field(L"retryAtUnixMs", static_cast<std::uintmax_t>(snapshot.retryAtUnixMs));
            writer.field(L"state", asciiToWide(stateText(snapshot.state)));
            writer.field(L"message", asciiToWide(snapshot.message));
            writer.endObject();
            return wideToUtf8(writer.str());
        }

        std::string readBoundedFile(const std::filesystem::path& path)
        {
            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
            if (sizeError || size == 0U || size > maximumManifestBytes)
            {
                throw std::runtime_error("Managed download manifest size is invalid.");
            }
            std::ifstream input(path, std::ios::binary);
            if (!input)
            {
                throw std::runtime_error("Managed download manifest could not be opened.");
            }
            std::string content(static_cast<std::size_t>(size), '\0');
            input.read(content.data(), static_cast<std::streamsize>(content.size()));
            if (!input || input.gcount() != static_cast<std::streamsize>(content.size()))
            {
                throw std::runtime_error("Managed download manifest could not be read.");
            }
            return content;
        }

        bool sameRequestIdentity(
            const ModdingFlowManagedDownloadRequest& left,
            const ModdingFlowManagedDownloadRequest& right) noexcept
        {
            return left.artifactId == right.artifactId &&
                left.modId == right.modId &&
                left.versionId == right.versionId &&
                left.jobId == right.jobId;
        }

        bool hasVerifiedIdentity(
            const std::filesystem::path& path,
            std::uint64_t expectedSize,
            std::string_view expectedSha256)
        {
            std::error_code sizeError;
            if (!std::filesystem::is_regular_file(path, sizeError) || sizeError ||
                std::filesystem::file_size(path, sizeError) != expectedSize || sizeError)
            {
                return false;
            }
            const std::wstring digest = computeFluxPackFileSha256(path);
            std::string asciiDigest;
            asciiDigest.reserve(digest.size());
            for (const wchar_t character : digest)
            {
                if (character < L'0' || character > L'f')
                {
                    return false;
                }
                asciiDigest.push_back(static_cast<char>(character));
            }
            return asciiDigest == expectedSha256;
        }

        class AtomicCancellation final : public IRemoteDownloadCancellation
        {
        public:
            [[nodiscard]] bool isCancellationRequested() const noexcept override
            {
                return requested_.load(std::memory_order_acquire);
            }

            void request() noexcept
            {
                requested_.store(true, std::memory_order_release);
            }

        private:
            std::atomic<bool> requested_{false};
        };

        class ScopedWorkerOperation final
        {
        public:
            explicit ScopedWorkerOperation(std::wstring_view operationId)
                : previous_(Logger::operationId())
            {
                Logger::setOperationId(operationId);
            }

            ~ScopedWorkerOperation()
            {
                Logger::setOperationId(asciiToWide(previous_));
            }

        private:
            std::string previous_;
        };

        template <typename T>
        std::unique_ptr<T> requireProductionDependency(
            std::unique_ptr<T> dependency,
            std::string_view name)
        {
            if (!dependency)
            {
                throw std::runtime_error(std::string(name) + " is unavailable.");
            }
            return dependency;
        }
    }

    class ModdingFlowDownloadQueueService::Impl final
    {
    public:
        Impl(
            Logger& logger,
            const BuildPathSettingsService& pathSettings,
            DownloadTransferLimiter& transferLimiter,
            IModdingFlowArtifactLookupService& artifactLookup,
            ModdingFlowManagedTransferExecutor transfer)
            : logger_(logger),
              pathSettings_(pathSettings),
              transferLimiter_(transferLimiter),
              artifactLookup_(artifactLookup),
              transfer_(std::move(transfer))
        {
            if (!transfer_)
            {
                throw std::invalid_argument("Managed ModdingFlow transfer executor is required.");
            }
        }

        ~Impl()
        {
            shutdown();
        }

        void initialize()
        {
            std::lock_guard lock(mutex_);
            if (initialized_)
            {
                return;
            }
            stopping_ = false;
            accepting_ = true;
            initialized_ = true;
        }

        void shutdown() noexcept
        {
            try
            {
                std::deque<std::filesystem::path> abandoned;
                {
                    std::lock_guard lock(mutex_);
                    if (!initialized_ && !worker_.joinable())
                    {
                        return;
                    }
                    accepting_ = false;
                    stopping_ = true;
                    abandoned.swap(queue_);
                    for (const auto& [path, cancellation] : active_)
                    {
                        static_cast<void>(path);
                        cancellation->request();
                    }
                    for (const std::filesystem::path& path : abandoned)
                    {
                        try
                        {
                            ModdingFlowManagedDownloadSnapshot snapshot = loadManifestLocked(
                                path.parent_path(), path);
                            snapshot.state = ModdingFlowManagedDownloadState::Paused;
                            snapshot.message = "Download service stopped before transfer started.";
                            saveManifestLocked(snapshot);
                        }
                        catch (...)
                        {
                        }
                    }
                }
                condition_.notify_all();
                if (worker_.joinable() && worker_.get_id() != std::this_thread::get_id())
                {
                    worker_.join();
                }
                std::lock_guard lock(mutex_);
                active_.clear();
                initialized_ = false;
                stopping_ = false;
                workerStarted_ = false;
            }
            catch (...)
            {
            }
        }

        ModdingFlowManagedDownloadSnapshot queue(
            const ModdingFlowManagedDownloadRequest& request)
        {
            if (request.projectDirectory.empty())
            {
                throw std::invalid_argument("Project directory is required.");
            }
            validateRemoteArtifactDownloadRequest(RemoteArtifactDownloadRequest{
                .providerId = "moddingflow",
                .artifactId = request.artifactId,
                .modId = request.modId,
                .versionId = request.versionId,
                .jobId = request.jobId,
                .operationId = request.operationId});

            ModdingFlowArtifactPreview preview;
            try
            {
                preview = artifactLookup_.lookup(
                    request.artifactId,
                    ModdingFlowArtifactLookupAuthMode::Anonymous,
                    request.operationId);
            }
            catch (const ModdingFlowApiException& exception)
            {
                if (exception.code() != ModdingFlowApiErrorCode::Unauthorized &&
                    exception.code() != ModdingFlowApiErrorCode::Forbidden)
                {
                    throw;
                }
                preview = artifactLookup_.lookup(
                    request.artifactId,
                    ModdingFlowArtifactLookupAuthMode::BearerModsRead,
                    request.operationId);
            }
            if (preview.operationId != request.operationId ||
                preview.artifactId != request.artifactId ||
                preview.modId != request.modId ||
                preview.versionId != request.versionId ||
                preview.sizeBytes == 0U ||
                !isCanonicalRemoteDownloadSha256(preview.sha256))
            {
                throw std::invalid_argument(
                    "ModdingFlow artifact metadata does not match the trusted handoff.");
            }

            const std::filesystem::path root = downloadsRoot(request.projectDirectory);
            const std::wstring fileName = validatedFileName(root, preview.filename);
            ModdingFlowManagedDownloadSnapshot snapshot{
                .request = request,
                .pendingPath = manifestPathFor(root, request.artifactId),
                .partialPath = partialPathFor(root, request.artifactId),
                .destinationPath = root / std::filesystem::path(fileName),
                .fileName = fileName,
                .gameSlug = utf8PathComponent(preview.gameSlug),
                .version = utf8PathComponent(preview.version),
                .expectedSha256 = preview.sha256,
                .expectedSize = preview.sizeBytes,
                .bytesReceived = 0U,
                .createdAtUnixMs = currentUnixMilliseconds(),
                .retryAtUnixMs = 0U,
                .state = ModdingFlowManagedDownloadState::Queued,
                .message = "Queued"};

            std::lock_guard lock(mutex_);
            requireAcceptingLocked();
            if (std::filesystem::exists(snapshot.pendingPath))
            {
                ModdingFlowManagedDownloadSnapshot existing = loadManifestLocked(
                    root, snapshot.pendingPath);
                if (!sameRequestIdentity(existing.request, request) ||
                    existing.fileName != snapshot.fileName ||
                    existing.expectedSize != snapshot.expectedSize ||
                    existing.expectedSha256 != snapshot.expectedSha256)
                {
                    throw std::invalid_argument(
                        "A conflicting managed ModdingFlow download already exists.");
                }
                return existing;
            }

            if (std::filesystem::exists(snapshot.destinationPath))
            {
                if (!hasVerifiedIdentity(
                        snapshot.destinationPath,
                        snapshot.expectedSize,
                        snapshot.expectedSha256))
                {
                    throw std::invalid_argument(
                        "A different archive already occupies the managed destination.");
                }
                snapshot.state = ModdingFlowManagedDownloadState::Completed;
                snapshot.bytesReceived = snapshot.expectedSize;
                snapshot.message = "Already downloaded";
                return snapshot;
            }

            saveManifestLocked(snapshot);
            enqueueLocked(snapshot.pendingPath);
            return snapshot;
        }

        std::vector<ModdingFlowManagedDownloadSnapshot> list(
            const std::filesystem::path& projectDirectory) const
        {
            const std::filesystem::path root = downloadsRoot(projectDirectory);
            std::vector<ModdingFlowManagedDownloadSnapshot> snapshots;
            std::lock_guard lock(mutex_);
            std::error_code iteratorError;
            std::filesystem::directory_iterator iterator(root, iteratorError);
            if (iteratorError)
            {
                return snapshots;
            }
            for (const std::filesystem::directory_entry& entry : iterator)
            {
                std::error_code statusError;
                if (!entry.is_regular_file(statusError) || statusError ||
                    !isManifestPath(entry.path()))
                {
                    continue;
                }
                try
                {
                    ModdingFlowManagedDownloadSnapshot snapshot =
                        loadManifestLocked(root, entry.path());
                    snapshot.request.projectDirectory = projectDirectory;
                    snapshots.push_back(std::move(snapshot));
                }
                catch (const std::exception&)
                {
                    logger_.writeOperation(
                        LogLevel::Warning,
                        "ModdingFlowDownloadQueue",
                        "Ignored an invalid managed download manifest.");
                }
            }
            std::sort(snapshots.begin(), snapshots.end(), [](const auto& left, const auto& right)
            {
                return left.createdAtUnixMs > right.createdAtUnixMs;
            });
            return snapshots;
        }

        bool ownsPendingPath(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath) const
        {
            try
            {
                const std::filesystem::path root = downloadsRoot(projectDirectory);
                std::lock_guard lock(mutex_);
                static_cast<void>(loadManifestLocked(root, pendingPath));
                return true;
            }
            catch (...)
            {
                return false;
            }
        }

        void cancel(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath,
            std::wstring_view operationId)
        {
            if (operationId.empty())
            {
                throw std::invalid_argument("Operation id is required.");
            }
            const std::filesystem::path root = downloadsRoot(projectDirectory);
            std::lock_guard lock(mutex_);
            ModdingFlowManagedDownloadSnapshot snapshot = loadManifestLocked(root, pendingPath);
            if (snapshot.state == ModdingFlowManagedDownloadState::Completed)
            {
                throw std::invalid_argument("Completed download cannot be cancelled.");
            }
            snapshot.request.operationId = std::wstring(operationId);
            const auto active = active_.find(pathKey(pendingPath));
            if (active != active_.end())
            {
                active->second->request();
                snapshot.message = "Cancellation requested";
                saveManifestLocked(snapshot);
                return;
            }
            std::erase_if(queue_, [&](const std::filesystem::path& queuedPath)
            {
                return pathKey(queuedPath) == pathKey(pendingPath);
            });
            snapshot.state = ModdingFlowManagedDownloadState::Cancelled;
            snapshot.message = "Cancelled";
            saveManifestLocked(snapshot);
        }

        ModdingFlowManagedDownloadSnapshot resume(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath,
            std::wstring_view operationId)
        {
            if (operationId.empty())
            {
                throw std::invalid_argument("Operation id is required.");
            }
            const std::filesystem::path root = downloadsRoot(projectDirectory);
            std::lock_guard lock(mutex_);
            requireAcceptingLocked();
            ModdingFlowManagedDownloadSnapshot snapshot = loadManifestLocked(root, pendingPath);
            if (snapshot.state == ModdingFlowManagedDownloadState::Queued ||
                snapshot.state == ModdingFlowManagedDownloadState::Downloading)
            {
                throw std::invalid_argument("Managed download is already in progress.");
            }
            if (snapshot.state == ModdingFlowManagedDownloadState::Completed)
            {
                return snapshot;
            }
            snapshot.request.operationId = std::wstring(operationId);
            snapshot.state = ModdingFlowManagedDownloadState::Queued;
            snapshot.retryAtUnixMs = 0U;
            snapshot.message = "Queued";
            saveManifestLocked(snapshot);
            enqueueLocked(snapshot.pendingPath);
            return snapshot;
        }

        void remove(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& pendingPath)
        {
            const std::filesystem::path root = downloadsRoot(projectDirectory);
            std::lock_guard lock(mutex_);
            const ModdingFlowManagedDownloadSnapshot snapshot = loadManifestLocked(root, pendingPath);
            if (snapshot.state == ModdingFlowManagedDownloadState::Queued ||
                snapshot.state == ModdingFlowManagedDownloadState::Downloading ||
                active_.contains(pathKey(pendingPath)))
            {
                throw std::invalid_argument("Managed download is still in progress.");
            }
            removeManifestLocked(snapshot.pendingPath);
            std::error_code removeError;
            std::filesystem::remove(snapshot.partialPath, removeError);
            try
            {
                RemoteDownloadSidecarStore(&logger_).remove(snapshot.partialPath);
            }
            catch (...)
            {
            }
        }

        void acknowledgeCompleted(const ModdingFlowManagedDownloadSnapshot& snapshot)
        {
            std::lock_guard lock(mutex_);
            if (snapshot.state != ModdingFlowManagedDownloadState::Completed ||
                snapshot.pendingPath.empty() ||
                !std::filesystem::exists(snapshot.pendingPath) ||
                !hasVerifiedIdentity(
                    snapshot.destinationPath,
                    snapshot.expectedSize,
                    snapshot.expectedSha256))
            {
                return;
            }
            const ModdingFlowManagedDownloadSnapshot persisted = loadManifestLocked(
                snapshot.pendingPath.parent_path(), snapshot.pendingPath);
            if (persisted.state == ModdingFlowManagedDownloadState::Completed &&
                sameRequestIdentity(persisted.request, snapshot.request))
            {
                removeManifestLocked(snapshot.pendingPath);
            }
        }

    private:
        std::filesystem::path downloadsRoot(
            const std::filesystem::path& projectDirectory) const
        {
            if (projectDirectory.empty())
            {
                throw std::invalid_argument("Project directory is required.");
            }
            const std::filesystem::path root = pathSettings_.downloadsDirectory(projectDirectory);
            std::filesystem::create_directories(root);
            PathSafetyService().validateDirectoryWriteRoot(root)
                .throwIfUnsafe("Managed downloads directory is unsafe");
            return root;
        }

        std::wstring validatedFileName(
            const std::filesystem::path& root,
            std::string_view utf8FileName) const
        {
            if (utf8FileName.empty() || utf8FileName.size() > 1024U)
            {
                throw std::invalid_argument("ModdingFlow artifact filename is invalid.");
            }
            std::filesystem::path component;
            try
            {
                component = pathFromUtf8(utf8FileName);
            }
            catch (...)
            {
                throw std::invalid_argument("ModdingFlow artifact filename is invalid.");
            }
            if (component.empty() || component.is_absolute() || component.has_root_path() ||
                component.has_parent_path() || component.filename() != component ||
                component == L"." || component == L".." ||
                !ArchiveCatalogService::isSupportedArchiveFile(component))
            {
                throw std::invalid_argument("ModdingFlow artifact filename is unsafe.");
            }
            const PathSafetyService safety;
            safety.validateRelativePath(component)
                .throwIfUnsafe("ModdingFlow artifact filename is unsafe");
            safety.validateWritePath(root, root / component)
                .throwIfUnsafe("ModdingFlow artifact destination is unsafe");
            return component.wstring();
        }

        ModdingFlowManagedDownloadSnapshot loadManifestLocked(
            const std::filesystem::path& root,
            const std::filesystem::path& path) const
        {
            const PathSafetyService safety;
            if (!isManifestPath(path) || !safety.isSameOrInside(path, root) ||
                pathKey(path.parent_path()) != pathKey(root))
            {
                throw std::invalid_argument("Managed download path is outside the downloads root.");
            }
            static_cast<void>(
                atomicStore_.recoverFile(path, manifestWriteOptions(), &logger_));
            const JsonValue document = parseModdingFlowJson(
                readBoundedFile(path),
                {.maximumBytes = maximumManifestBytes,
                 .maximumDepth = 8U,
                 .maximumValues = 64U,
                 .maximumStringCodeUnits = 4096U});
            requireExactManifest(document);
            if (requiredUnsigned(document, L"schemaVersion") != 1U)
            {
                throw std::runtime_error("Managed download manifest version is unsupported.");
            }

            ModdingFlowManagedDownloadSnapshot snapshot;
            snapshot.request.projectDirectory = root;
            snapshot.request.artifactId = requiredUtf8String(document, L"artifactId", 256U);
            snapshot.request.modId = requiredUtf8String(document, L"modId", 256U);
            snapshot.request.versionId = requiredUtf8String(document, L"versionId", 256U);
            snapshot.request.jobId = requiredUtf8String(document, L"jobId", 256U);
            snapshot.request.operationId = requiredWideString(document, L"operationId", 256U);
            snapshot.fileName = requiredWideString(document, L"fileName", 512U);
            snapshot.gameSlug = requiredWideString(document, L"gameSlug", 128U, true);
            snapshot.version = requiredWideString(document, L"version", 512U, true);
            snapshot.expectedSha256 = requiredUtf8String(document, L"expectedSha256", 64U);
            snapshot.expectedSize = requiredUnsigned(document, L"expectedSize");
            snapshot.bytesReceived = requiredUnsigned(document, L"bytesReceived");
            snapshot.createdAtUnixMs = requiredUnsigned(document, L"createdAtUnixMs");
            snapshot.retryAtUnixMs = requiredUnsigned(document, L"retryAtUnixMs");
            snapshot.state = parseState(requiredUtf8String(document, L"state", 32U));
            snapshot.message = requiredUtf8String(document, L"message", 1024U, true);
            snapshot.pendingPath = path;
            snapshot.partialPath = partialPathFor(root, snapshot.request.artifactId);
            snapshot.destinationPath = root / std::filesystem::path(snapshot.fileName);

            validateRemoteArtifactDownloadRequest(RemoteArtifactDownloadRequest{
                .providerId = "moddingflow",
                .artifactId = snapshot.request.artifactId,
                .modId = snapshot.request.modId,
                .versionId = snapshot.request.versionId,
                .jobId = snapshot.request.jobId,
                .operationId = snapshot.request.operationId});
            if (snapshot.pendingPath != manifestPathFor(root, snapshot.request.artifactId) ||
                snapshot.fileName != validatedFileName(root, wideToUtf8(snapshot.fileName)) ||
                snapshot.expectedSize == 0U ||
                snapshot.bytesReceived > snapshot.expectedSize ||
                !isCanonicalRemoteDownloadSha256(snapshot.expectedSha256))
            {
                throw std::runtime_error("Managed download manifest identity is invalid.");
            }
            return snapshot;
        }

        void saveManifestLocked(const ModdingFlowManagedDownloadSnapshot& snapshot) const
        {
            const std::filesystem::path root = snapshot.pendingPath.parent_path();
            PathSafetyService().validateDirectoryWriteRoot(root)
                .throwIfUnsafe("Managed downloads directory is unsafe");
            if (snapshot.pendingPath != manifestPathFor(root, snapshot.request.artifactId) ||
                snapshot.partialPath != partialPathFor(root, snapshot.request.artifactId) ||
                snapshot.destinationPath != root / std::filesystem::path(snapshot.fileName))
            {
                throw std::invalid_argument("Managed download paths are inconsistent.");
            }
            atomicStore_.writeTextFile(
                snapshot.pendingPath,
                serializeManifest(snapshot),
                manifestWriteOptions());
        }

        void removeManifestLocked(const std::filesystem::path& path) const noexcept
        {
            std::error_code error;
            std::filesystem::remove(path, error);
            std::filesystem::remove(AtomicFileStore::backupPathFor(path), error);
            try
            {
                for (const auto& entry : std::filesystem::directory_iterator(path.parent_path()))
                {
                    if (AtomicFileStore::isManagedTempFileFor(path, entry.path()))
                    {
                        std::filesystem::remove(entry.path(), error);
                    }
                }
            }
            catch (...)
            {
            }
        }

        void requireAcceptingLocked() const
        {
            if (!initialized_ || !accepting_ || stopping_)
            {
                throw std::runtime_error("Managed ModdingFlow download queue is not accepting jobs.");
            }
        }

        void enqueueLocked(const std::filesystem::path& path)
        {
            if (!workerStarted_)
            {
                worker_ = std::thread([this]() noexcept { runWorker(); });
                workerStarted_ = true;
            }
            queue_.push_back(path);
            condition_.notify_one();
        }

        void updateProgress(
            const std::filesystem::path& path,
            std::uint64_t bytesReceived,
            std::uint64_t expectedSize) noexcept
        {
            try
            {
                std::lock_guard lock(mutex_);
                ModdingFlowManagedDownloadSnapshot snapshot = loadManifestLocked(
                    path.parent_path(), path);
                if (expectedSize != snapshot.expectedSize ||
                    bytesReceived < snapshot.bytesReceived ||
                    bytesReceived > snapshot.expectedSize)
                {
                    return;
                }
                if (bytesReceived == snapshot.bytesReceived)
                {
                    return;
                }
                snapshot.bytesReceived = bytesReceived;
                saveManifestLocked(snapshot);
            }
            catch (...)
            {
            }
        }

        std::optional<DownloadTransferLimiter::Permit> acquirePermit(
            const AtomicCancellation& cancellation)
        {
            while (!cancellation.isCancellationRequested())
            {
                std::optional<DownloadTransferLimiter::Permit> permit =
                    transferLimiter_.tryAcquireFor(std::chrono::milliseconds(50));
                if (permit.has_value())
                {
                    return permit;
                }
            }
            return std::nullopt;
        }

        void process(const std::filesystem::path& path, AtomicCancellation& cancellation)
        {
            ModdingFlowManagedDownloadSnapshot snapshot;
            {
                std::lock_guard lock(mutex_);
                snapshot = loadManifestLocked(path.parent_path(), path);
                snapshot.state = ModdingFlowManagedDownloadState::Downloading;
                snapshot.message = "Downloading";
                saveManifestLocked(snapshot);
            }
            const ScopedWorkerOperation operation(snapshot.request.operationId);
            std::optional<DownloadTransferLimiter::Permit> permit = acquirePermit(cancellation);
            RemoteDownloadTransferResult result;
            if (!permit.has_value())
            {
                result = {
                    .outcome = RemoteDownloadTransferOutcome::Cancelled,
                    .bytesReceived = snapshot.bytesReceived,
                    .resumableStateRetained = snapshot.bytesReceived > 0U,
                    .message = "Remote download was cancelled.",
                    .operationId = snapshot.request.operationId};
            }
            else
            {
                try
                {
                    RemoteDownloadTransferRequest request{
                        .artifact = {
                            .providerId = "moddingflow",
                            .artifactId = snapshot.request.artifactId,
                            .modId = snapshot.request.modId,
                            .versionId = snapshot.request.versionId,
                            .jobId = snapshot.request.jobId,
                            .operationId = snapshot.request.operationId},
                        .allowedRoot = snapshot.pendingPath.parent_path(),
                        .partialPath = snapshot.partialPath,
                        .destinationPath = snapshot.destinationPath,
                        .expectedSize = snapshot.expectedSize,
                        .expectedSha256 = snapshot.expectedSha256,
                        .progress = [this, path](std::uint64_t bytes, std::uint64_t expected)
                        {
                            updateProgress(path, bytes, expected);
                        }};
                    result = transfer_(request, cancellation);
                }
                catch (const std::exception& exception)
                {
                    result = {
                        .outcome = RemoteDownloadTransferOutcome::FileFailure,
                        .bytesReceived = snapshot.bytesReceived,
                        .message = exception.what(),
                        .operationId = snapshot.request.operationId};
                }
                catch (...)
                {
                    result = {
                        .outcome = RemoteDownloadTransferOutcome::FileFailure,
                        .bytesReceived = snapshot.bytesReceived,
                        .message = "Managed download failed.",
                        .operationId = snapshot.request.operationId};
                }
            }

            std::lock_guard lock(mutex_);
            try
            {
                snapshot = loadManifestLocked(path.parent_path(), path);
                snapshot.bytesReceived = (std::min)(result.bytesReceived, snapshot.expectedSize);
                snapshot.retryAtUnixMs = result.retryAtUnixMs.value_or(0U);
                snapshot.message = result.message;
                switch (result.outcome)
                {
                case RemoteDownloadTransferOutcome::Completed:
                    if (!result.finalPath.has_value() ||
                        pathKey(*result.finalPath) != pathKey(snapshot.destinationPath) ||
                        result.bytesReceived != snapshot.expectedSize ||
                        !hasVerifiedIdentity(
                            snapshot.destinationPath,
                            snapshot.expectedSize,
                            snapshot.expectedSha256))
                    {
                        snapshot.state = ModdingFlowManagedDownloadState::Failed;
                        snapshot.message = "Completed transfer failed artifact identity verification.";
                    }
                    else
                    {
                        snapshot.state = ModdingFlowManagedDownloadState::Completed;
                        snapshot.bytesReceived = snapshot.expectedSize;
                    }
                    break;
                case RemoteDownloadTransferOutcome::Cancelled:
                    snapshot.state = ModdingFlowManagedDownloadState::Cancelled;
                    break;
                case RemoteDownloadTransferOutcome::RetryScheduled:
                    snapshot.state = ModdingFlowManagedDownloadState::RetryScheduled;
                    break;
                default:
                    snapshot.state = result.resumableStateRetained
                        ? ModdingFlowManagedDownloadState::Paused
                        : ModdingFlowManagedDownloadState::Failed;
                    break;
                }
                saveManifestLocked(snapshot);
                logger_.writeOperation(
                    snapshot.state == ModdingFlowManagedDownloadState::Completed
                        ? LogLevel::Info
                        : LogLevel::Warning,
                    "ModdingFlowDownloadQueue",
                    "state=" + stateText(snapshot.state));
            }
            catch (...)
            {
                logger_.writeOperation(
                    LogLevel::Error,
                    "ModdingFlowDownloadQueue",
                    "Managed download result could not be persisted.");
            }
        }

        void runWorker() noexcept
        {
            while (true)
            {
                std::filesystem::path path;
                std::shared_ptr<AtomicCancellation> cancellation;
                {
                    std::unique_lock lock(mutex_);
                    condition_.wait(lock, [&]() { return stopping_ || !queue_.empty(); });
                    if (stopping_ && queue_.empty())
                    {
                        return;
                    }
                    path = std::move(queue_.front());
                    queue_.pop_front();
                    cancellation = std::make_shared<AtomicCancellation>();
                    active_[pathKey(path)] = cancellation;
                }
                try
                {
                    process(path, *cancellation);
                }
                catch (...)
                {
                }
                std::lock_guard lock(mutex_);
                active_.erase(pathKey(path));
            }
        }

        Logger& logger_;
        const BuildPathSettingsService& pathSettings_;
        DownloadTransferLimiter& transferLimiter_;
        IModdingFlowArtifactLookupService& artifactLookup_;
        ModdingFlowManagedTransferExecutor transfer_;
        mutable AtomicFileStore atomicStore_;
        mutable std::mutex mutex_;
        std::condition_variable condition_;
        std::deque<std::filesystem::path> queue_;
        std::unordered_map<std::wstring, std::shared_ptr<AtomicCancellation>> active_;
        std::thread worker_;
        bool initialized_{false};
        bool accepting_{false};
        bool stopping_{false};
        bool workerStarted_{false};
    };

    ModdingFlowDownloadQueueService::ModdingFlowDownloadQueueService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings,
        DownloadTransferLimiter& transferLimiter,
        IModdingFlowArtifactLookupService& artifactLookup,
        ModdingFlowManagedTransferExecutor transfer)
        : impl_(std::make_unique<Impl>(
              logger,
              pathSettings,
              transferLimiter,
              artifactLookup,
              std::move(transfer)))
    {
    }

    ModdingFlowDownloadQueueService::~ModdingFlowDownloadQueueService() = default;

    void ModdingFlowDownloadQueueService::initialize() { impl_->initialize(); }
    void ModdingFlowDownloadQueueService::shutdown() { impl_->shutdown(); }

    ModdingFlowManagedDownloadSnapshot ModdingFlowDownloadQueueService::queue(
        const ModdingFlowManagedDownloadRequest& request)
    {
        return impl_->queue(request);
    }

    std::vector<ModdingFlowManagedDownloadSnapshot> ModdingFlowDownloadQueueService::list(
        const std::filesystem::path& projectDirectory) const
    {
        return impl_->list(projectDirectory);
    }

    bool ModdingFlowDownloadQueueService::ownsPendingPath(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& pendingPath) const
    {
        return impl_->ownsPendingPath(projectDirectory, pendingPath);
    }

    void ModdingFlowDownloadQueueService::cancel(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& pendingPath,
        std::wstring_view operationId)
    {
        impl_->cancel(projectDirectory, pendingPath, operationId);
    }

    ModdingFlowManagedDownloadSnapshot ModdingFlowDownloadQueueService::resume(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& pendingPath,
        std::wstring_view operationId)
    {
        return impl_->resume(projectDirectory, pendingPath, operationId);
    }

    void ModdingFlowDownloadQueueService::remove(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& pendingPath)
    {
        impl_->remove(projectDirectory, pendingPath);
    }

    void ModdingFlowDownloadQueueService::acknowledgeCompleted(
        const ModdingFlowManagedDownloadSnapshot& snapshot)
    {
        impl_->acknowledgeCompleted(snapshot);
    }

    bool moddingFlowDownloadProviderCompiled() noexcept
    {
#ifdef FLUXORA_ENABLE_MODDINGFLOW_DOWNLOAD_PROVIDER
        return true;
#else
        return false;
#endif
    }

#ifdef FLUXORA_ENABLE_MODDINGFLOW_DOWNLOAD_PROVIDER
    namespace
    {
        class ProductionModdingFlowDownloadQueue final
            : public IModdingFlowDownloadQueueService
        {
        public:
            ProductionModdingFlowDownloadQueue(
                Logger& logger,
                const BuildPathSettingsService& pathSettings,
                DownloadTransferLimiter& transferLimiter,
                IModdingFlowPublicApiClient& publicApi)
                : lookup_(publicApi),
                  provider_(std::make_shared<ModdingFlowRemoteDownloadResolver>(publicApi)),
                  coordinator_(providers_),
                  sidecars_(&logger),
                  addressResolver_(requireProductionDependency(
                      createSystemSignedRemoteAddressResolver(),
                      "Signed remote address resolver")),
                  network_(requireProductionDependency(
                      createWinHttpSignedRemoteNetworkAdapter(),
                      "Signed remote network adapter")),
                  transport_(*addressResolver_, *network_),
                  transfer_(
                      coordinator_,
                      sidecars_,
                      files_,
                      [this](
                          const ResolvedDownloadGrant& grant,
                          const SignedRemoteDownloadRequest& request,
                          const IRemoteDownloadCancellation& cancellation,
                          SignedRemoteChunkSink sink)
                      {
                          return transport_.execute(
                              grant, request, cancellation, std::move(sink));
                      },
                      {},
                      &logger),
                  queue_(
                      logger,
                      pathSettings,
                      transferLimiter,
                      lookup_,
                      [this](
                          const RemoteDownloadTransferRequest& request,
                          const IRemoteDownloadCancellation& cancellation)
                      {
                          return transfer_.transfer(request, cancellation);
                      })
            {
                if (!providers_.registerProvider("moddingflow", provider_))
                {
                    throw std::runtime_error("ModdingFlow download resolver registration failed.");
                }
            }

            void initialize() override { queue_.initialize(); }
            void shutdown() override { queue_.shutdown(); }
            ModdingFlowManagedDownloadSnapshot queue(
                const ModdingFlowManagedDownloadRequest& request) override
            {
                return queue_.queue(request);
            }
            std::vector<ModdingFlowManagedDownloadSnapshot> list(
                const std::filesystem::path& projectDirectory) const override
            {
                return queue_.list(projectDirectory);
            }
            bool ownsPendingPath(
                const std::filesystem::path& projectDirectory,
                const std::filesystem::path& pendingPath) const override
            {
                return queue_.ownsPendingPath(projectDirectory, pendingPath);
            }
            void cancel(
                const std::filesystem::path& projectDirectory,
                const std::filesystem::path& pendingPath,
                std::wstring_view operationId) override
            {
                queue_.cancel(projectDirectory, pendingPath, operationId);
            }
            ModdingFlowManagedDownloadSnapshot resume(
                const std::filesystem::path& projectDirectory,
                const std::filesystem::path& pendingPath,
                std::wstring_view operationId) override
            {
                return queue_.resume(projectDirectory, pendingPath, operationId);
            }
            void remove(
                const std::filesystem::path& projectDirectory,
                const std::filesystem::path& pendingPath) override
            {
                queue_.remove(projectDirectory, pendingPath);
            }
            void acknowledgeCompleted(
                const ModdingFlowManagedDownloadSnapshot& snapshot) override
            {
                queue_.acknowledgeCompleted(snapshot);
            }

        private:
            ModdingFlowArtifactLookupService lookup_;
            std::shared_ptr<ModdingFlowRemoteDownloadResolver> provider_;
            RemoteDownloadProviderRegistry providers_;
            RemoteDownloadCoordinator coordinator_;
            RemoteDownloadSidecarStore sidecars_;
            RemoteDownloadFileStore files_;
            std::unique_ptr<ISignedRemoteAddressResolver> addressResolver_;
            std::unique_ptr<ISignedRemoteNetworkAdapter> network_;
            SignedRemoteDownloadTransport transport_;
            RemoteDownloadTransferService transfer_;
            ModdingFlowDownloadQueueService queue_;
        };
    }
#endif

    std::unique_ptr<IModdingFlowDownloadQueueService>
        createProductionModdingFlowDownloadQueueService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings,
            DownloadTransferLimiter& transferLimiter,
            IModdingFlowPublicApiClient& publicApi) noexcept
    {
#ifdef FLUXORA_ENABLE_MODDINGFLOW_DOWNLOAD_PROVIDER
        try
        {
            return std::make_unique<ProductionModdingFlowDownloadQueue>(
                logger, pathSettings, transferLimiter, publicApi);
        }
        catch (...)
        {
            logger.writeOperation(
                LogLevel::Warning,
                "ModdingFlowDownloadQueue",
                "Production managed download capability construction failed.");
            return nullptr;
        }
#else
        static_cast<void>(logger);
        static_cast<void>(pathSettings);
        static_cast<void>(transferLimiter);
        static_cast<void>(publicApi);
        return nullptr;
#endif
    }
}
