#include "FluxoraCore/Services/InstallOperationService.hpp"

#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/InstallTransactionJournal.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cwctype>
#include <mutex>
#include <stdexcept>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    struct InstallOperationService::OperationContext final
    {
        std::mutex mutex;
        InstallOperationRequest request;
        InstallOperationRecord record;
        InstallOperationProgressCallback progress;
        bool resumed{false};
        std::atomic_bool waitedForTarget{false};
        std::atomic_bool cancellationRequested{false};
        std::condition_variable finishedChanged;
        bool finished{false};
    };

    namespace
    {
        bool isTerminalState(std::wstring_view state)
        {
            return state == L"completed" || state == L"failed" || state == L"cancelled" ||
                state == L"needsReview";
        }

        class InstallCancellation final : public std::exception
        {
        public:
            [[nodiscard]] const char* what() const noexcept override
            {
                return "Install operation was cancelled.";
            }
        };

        std::wstring normalizedTargetKey(const InstallOperationRequest& request)
        {
            std::wstring key = request.identitySelection.has_value()
                ? request.identitySelection->targetModUuid
                : request.modName;
            if (key.empty())
            {
                key = request.sourcePath.filename().wstring();
            }
            std::transform(key.begin(), key.end(), key.begin(), [](wchar_t value)
            {
                return static_cast<wchar_t>(std::towlower(value));
            });
            return key;
        }

        std::filesystem::path normalizedSourcePath(const std::filesystem::path& path)
        {
            std::error_code error;
            const std::filesystem::path absolute = std::filesystem::absolute(path, error);
            return (error ? path : absolute).lexically_normal();
        }

        std::wstring serializeInstalledMod(const InstalledMod& mod)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"id", mod.id.wstring());
            writer.field(L"name", mod.name);
            writer.field(L"version", mod.version);
            writer.field(L"isEnabled", mod.isEnabled);
            writer.field(L"latestVersion", mod.latestVersion);
            writer.field(L"latestFileId", mod.latestFileId);
            writer.field(L"updateCheckState", mod.updateCheckState);
            writer.field(L"sourceIsNexus", mod.sourceIsNexus);
            writer.field(L"sourceIsModdingFlow", mod.sourceIsModdingFlow);
            writer.field(L"sourceProvider", mod.sourceProvider);
            writer.field(L"sourceGameDomain", mod.sourceGameDomain);
            writer.field(L"sourceModId", mod.sourceModId);
            writer.field(L"sourceFileId", mod.sourceFileId);
            writer.field(L"sourceUrl", mod.sourceUrl);
            writer.field(L"isLocal", mod.isLocal);
            writer.field(L"isTranslation", mod.isTranslation);
            writer.field(L"isPatch", mod.isPatch);
            writer.field(L"modUuid", mod.modUuid);
            writer.field(L"orderId", mod.orderId);
            writer.field(L"fileCount", mod.fileCount);
            writer.field(L"conflictingFileCount", mod.conflictingFileCount);
            writer.field(L"overwrittenFileCount", mod.overwrittenFileCount);
            writer.field(L"overwritingFileCount", mod.overwritingFileCount);
            writer.stringArray(L"overwritesModIds", mod.overwritesModIds);
            writer.stringArray(L"overwrittenByModIds", mod.overwrittenByModIds);
            writer.endObject();
            return writer.str();
        }

        std::wstring generatedOperationId()
        {
            return L"install-" + std::to_wstring(
                std::chrono::steady_clock::now().time_since_epoch().count());
        }

        std::string utf8LogText(std::wstring_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            const int size = WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            std::string result(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                result.data(),
                size,
                nullptr,
                nullptr);
            return result;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        int intField(const JsonValue& root, std::wstring_view key, int fallback = 0)
        {
            const JsonValue* value = root.find(key);
            if (value == nullptr || !value->isNumber())
            {
                return fallback;
            }
            try
            {
                return std::stoi(value->asNumber());
            }
            catch (...)
            {
                return fallback;
            }
        }

        bool boolField(const JsonValue& root, std::wstring_view key, bool fallback = false)
        {
            const JsonValue* value = root.find(key);
            return value != nullptr && value->type() == JsonValue::Type::Boolean
                ? value->asBoolean()
                : fallback;
        }

        std::wstring stringField(const JsonValue& root, std::wstring_view key)
        {
            const JsonValue* value = root.find(key);
            return value != nullptr && value->isString() ? value->asString() : std::wstring{};
        }

        std::vector<std::wstring> parseStringArray(std::wstring_view json)
        {
            const JsonValue root = JsonReader::parse(json.empty() ? L"[]" : json);
            if (!root.isArray())
            {
                throw std::invalid_argument("Expected a persisted string array.");
            }
            std::vector<std::wstring> values;
            for (const JsonValue& item : root.asArray())
            {
                if (!item.isString())
                {
                    throw std::invalid_argument("Persisted install option id must be a string.");
                }
                values.push_back(item.asString());
            }
            return values;
        }

        std::vector<FomodManualDecision> parseManualDecisions(std::wstring_view json)
        {
            const JsonValue root = JsonReader::parse(json.empty() ? L"[]" : json);
            if (!root.isArray())
            {
                throw std::invalid_argument("Expected persisted FOMOD manual decisions.");
            }
            std::vector<FomodManualDecision> decisions;
            for (const JsonValue& item : root.asArray())
            {
                if (!item.isObject())
                {
                    throw std::invalid_argument("Persisted FOMOD decision must be an object.");
                }
                const std::wstring optionId = stringField(item, L"optionId");
                const JsonValue* selected = item.find(L"selected");
                if (optionId.empty() || selected == nullptr ||
                    selected->type() != JsonValue::Type::Boolean)
                {
                    throw std::invalid_argument("Persisted FOMOD decision is invalid.");
                }
                decisions.push_back(FomodManualDecision{optionId, selected->asBoolean()});
            }
            return decisions;
        }

        std::vector<PlacementOverride> parsePlacementOverrides(std::wstring_view json)
        {
            const JsonValue root = JsonReader::parse(json.empty() ? L"[]" : json);
            if (!root.isArray())
            {
                throw std::invalid_argument("Expected persisted placement overrides.");
            }
            std::vector<PlacementOverride> overrides;
            for (const JsonValue& item : root.asArray())
            {
                if (!item.isObject())
                {
                    throw std::invalid_argument("Persisted placement override must be an object.");
                }
                const std::wstring sourcePath = stringField(item, L"sourcePath");
                const std::wstring target = stringField(item, L"target");
                if (sourcePath.empty() || target.empty())
                {
                    throw std::invalid_argument("Persisted placement override is incomplete.");
                }
                std::optional<GameRelativePath> targetRelativePath;
                const std::wstring relative = stringField(item, L"targetRelativePath");
                if (!relative.empty())
                {
                    targetRelativePath = GameRelativePath::parse(relative).valueOrThrow();
                }
                overrides.push_back(PlacementOverride{
                    GameRelativePath::parse(sourcePath).valueOrThrow(),
                    parsePlacementTarget(target).valueOrThrow(),
                    std::move(targetRelativePath)
                });
            }
            return overrides;
        }

        std::optional<ModIdentityInstallSelection> parseIdentitySelection(std::wstring_view json)
        {
            const JsonValue root = JsonReader::parse(json.empty() ? L"{}" : json);
            if (!root.isObject())
            {
                throw std::invalid_argument("Persisted identity plan must be an object.");
            }
            const std::wstring resolutionId = stringField(root, L"resolutionId");
            if (resolutionId.empty())
            {
                return std::nullopt;
            }
            const int decision = intField(root, L"decision", -1);
            const int newNamePolicy = intField(root, L"newNamePolicy", -1);
            if ((decision != 0 && decision != 1) || newNamePolicy != 0)
            {
                throw std::invalid_argument("Persisted identity plan is invalid.");
            }
            ModIdentityInstallSelection selection;
            selection.resolutionId = resolutionId;
            selection.decision = decision == 0
                ? InstallIdentityDecision::UseMatch
                : InstallIdentityDecision::InstallNew;
            selection.targetModUuid = stringField(root, L"targetModUuid");
            selection.newNamePolicy = NewNamePolicy::FirstFreeCopySuffix;
            if (selection.decision == InstallIdentityDecision::UseMatch &&
                selection.targetModUuid.empty())
            {
                throw std::invalid_argument("Persisted matched identity has no target UUID.");
            }
            return selection;
        }

        std::wstring serializeResumeFields(const InstallOperationRequest& request)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"isFomod", request.fomod);
            writer.field(L"fomodContextId", request.fomodContextId);
            writer.field(L"modOrderTargetIndex", request.modOrderTargetIndex);
            writer.endObject();
            return writer.str();
        }

        InstallOperationRequest requestFromRecord(
            const std::filesystem::path& projectDirectory,
            const InstallOperationRecord& record)
        {
            if (record.existingModMode < 0 || record.existingModMode > 2)
            {
                throw std::invalid_argument("Persisted install mode is invalid.");
            }
            const JsonValue resume = JsonReader::parse(
                record.requestJson.empty() ? L"{}" : record.requestJson);
            if (!resume.isObject())
            {
                throw std::invalid_argument("Persisted install resume payload is invalid.");
            }

            InstallOperationRequest request;
            request.operationId = record.operationId;
            request.projectDirectory = projectDirectory;
            request.sourceKind = record.sourceKind;
            request.sourcePath = record.sourcePath;
            request.fomod = boolField(resume, L"isFomod");
            request.modName = record.targetFolder;
            request.existingModMode = static_cast<ExistingModInstallMode>(record.existingModMode);
            request.selectedOptionIds = parseStringArray(record.selectedOptionIdsJson);
            request.placementOverrides = parsePlacementOverrides(record.placementOverridesJson);
            request.identitySelection = parseIdentitySelection(record.identityPlanJson);
            request.profileName = record.profileName;
            request.fomodContextId = stringField(resume, L"fomodContextId");
            request.manualDecisions = parseManualDecisions(record.manualDecisionsJson);
            request.modOrderTargetIndex = intField(resume, L"modOrderTargetIndex", -1);
            request.beforeOrderId = record.beforeOrderId;
            request.afterOrderId = record.afterOrderId;
            request.selectedOptionIdsJson = record.selectedOptionIdsJson;
            request.manualDecisionsJson = record.manualDecisionsJson;
            request.placementOverridesJson = record.placementOverridesJson;
            request.identityPlanJson = record.identityPlanJson;
            request.requestJson = record.requestJson;
            return request;
        }

        class OperationLogContext final
        {
        public:
            explicit OperationLogContext(std::wstring_view operationId)
            {
                Logger::setOperationId(operationId);
            }

            ~OperationLogContext()
            {
                Logger::clearOperationId();
            }
        };
    }

    InstallOperationService::InstallOperationService(
        Logger& logger,
        DownloadService& downloads)
        : logger_(logger), downloads_(downloads)
    {
    }

    InstallOperationService::~InstallOperationService()
    {
        shutdown();
    }

    void InstallOperationService::initialize()
    {
        if (initialized_)
        {
            return;
        }
        scheduler_ = std::make_unique<InstallScheduler>(InstallScheduler::DefaultWorkerCount);
        initialized_ = true;
        logger_.write(
            LogLevel::Info,
            "Installs",
            "Install operation service initialized with two heavy workers.");
    }

    void InstallOperationService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }
        if (scheduler_ != nullptr)
        {
            scheduler_->shutdown();
            scheduler_.reset();
        }
        initialized_ = false;
        logger_.write(LogLevel::Info, "Installs", "Install operation service shut down.");
    }

    InstallOperationRecord InstallOperationService::submit(
        InstallOperationRequest request,
        InstallOperationProgressCallback progress)
    {
        if (!initialized_ || scheduler_ == nullptr)
        {
            throw std::runtime_error("The install operation service is not initialized.");
        }
        if (request.projectDirectory.empty() || request.sourcePath.empty() ||
            request.modName.empty())
        {
            throw std::invalid_argument(
                "Project directory, install source, and mod name are required.");
        }
        if (request.sourceKind != L"download" && request.sourceKind != L"archive")
        {
            throw std::invalid_argument("Install source kind must be download or archive.");
        }
        if (request.operationId.empty())
        {
            request.operationId = generatedOperationId();
        }
        request.sourcePath = normalizedSourcePath(request.sourcePath);

        for (const InstallOperationRecord& existing :
             InstallOperationStore::list(request.projectDirectory, false))
        {
            if (existing.operationId == request.operationId)
            {
                throw std::invalid_argument("The install operation is already active.");
            }
            if (normalizedSourcePath(existing.sourcePath) == request.sourcePath &&
                !isTerminalState(existing.state))
            {
                throw std::invalid_argument("This archive or download is already being installed.");
            }
        }

        auto context = std::make_shared<OperationContext>();
        context->request = std::move(request);
        context->progress = std::move(progress);
        context->record.operationId = context->request.operationId;
        context->record.sourceKind = context->request.sourceKind;
        context->record.sourcePath = context->request.sourcePath;
        context->record.profileName = context->request.profileName;
        context->record.existingModMode = static_cast<int>(context->request.existingModMode);
        context->record.targetModUuid = context->request.identitySelection.has_value()
            ? context->request.identitySelection->targetModUuid
            : std::wstring{};
        context->record.targetFolder = context->request.modName;
        context->record.selectedOptionIdsJson = context->request.selectedOptionIdsJson;
        context->record.manualDecisionsJson = context->request.manualDecisionsJson;
        context->record.placementOverridesJson = context->request.placementOverridesJson;
        context->record.identityPlanJson = context->request.identityPlanJson;
        context->record.requestJson = serializeResumeFields(context->request);
        context->request.requestJson = context->record.requestJson;
        context->record.beforeOrderId = context->request.beforeOrderId;
        context->record.afterOrderId = context->request.afterOrderId;
        context->record.state = L"queued";
        context->record.stage = L"queued";
        context->record.progressPercent = 0;
        context->record.indeterminate = true;
        context->record.enqueueSequence = InstallOperationStore::save(
            context->request.projectDirectory,
            context->record);
        schedule(context);

        std::lock_guard lock(context->mutex);
        return context->record;
    }

    void InstallOperationService::schedule(
        const std::shared_ptr<OperationContext>& context)
    {
        const std::wstring targetKey = normalizedTargetKey(context->request);
        {
            std::lock_guard activeLock(activeMutex_);
            if (!activeOperations_.emplace(context->record.operationId, context).second)
            {
                throw std::invalid_argument("The install operation is already scheduled.");
            }
        }
        try
        {
            scheduler_->submit(InstallScheduledTask{
            context->record.operationId,
            targetKey,
            [this, context]
            {
                execute(context);
                finish(context);
            },
            [this, context](InstallSchedulerTaskState state)
            {
                if (state == InstallSchedulerTaskState::WaitingTarget)
                {
                    context->waitedForTarget.store(true, std::memory_order_relaxed);
                    publish(context, L"waitingTarget", L"waitingTarget", 0, true);
                }
                else if (state == InstallSchedulerTaskState::Queued)
                {
                    publish(context, L"queued", L"queued", 0, true);
                }
            }
            });
        }
        catch (...)
        {
            std::lock_guard activeLock(activeMutex_);
            activeOperations_.erase(context->record.operationId);
            throw;
        }
    }

    void InstallOperationService::finish(
        const std::shared_ptr<OperationContext>& context) noexcept
    {
        {
            std::lock_guard activeLock(activeMutex_);
            activeOperations_.erase(context->record.operationId);
        }
        {
            std::lock_guard lock(context->mutex);
            context->finished = true;
        }
        context->finishedChanged.notify_all();
    }

    void InstallOperationService::publish(
        const std::shared_ptr<OperationContext>& context,
        std::wstring state,
        std::wstring stage,
        int progressPercent,
        bool indeterminate,
        std::wstring errorCode,
        std::wstring errorMessage,
        std::wstring resultJson) const noexcept
    {
        InstallOperationRecord snapshot;
        InstallOperationProgressCallback callback;
        try
        {
            {
                std::lock_guard lock(context->mutex);
                context->record.state = std::move(state);
                context->record.stage = std::move(stage);
                context->record.progressPercent = progressPercent;
                context->record.indeterminate = indeterminate;
                context->record.errorCode = std::move(errorCode);
                context->record.errorMessage = std::move(errorMessage);
                if (!resultJson.empty())
                {
                    context->record.resultJson = std::move(resultJson);
                }
                context->record.enqueueSequence = InstallOperationStore::save(
                    context->request.projectDirectory,
                    context->record);
                snapshot = context->record;
                callback = context->progress;
            }
            if (callback)
            {
                callback(snapshot);
            }
            logger_.write(
                LogLevel::Info,
                "Installs",
                "operationId=" + utf8LogText(snapshot.operationId) +
                    " state=" + utf8LogText(snapshot.state) +
                    " stage=" + utf8LogText(snapshot.stage) +
                    " progress=" + std::to_string(snapshot.progressPercent) +
                    " beforeOrderId=" + utf8LogText(snapshot.beforeOrderId) +
                    " afterOrderId=" + utf8LogText(snapshot.afterOrderId) + ".");
        }
        catch (const std::exception& exception)
        {
            logger_.write(
                LogLevel::Error,
                "Installs",
                std::string("Could not publish install operation state: ") + exception.what());
        }
        catch (...)
        {
            logger_.write(
                LogLevel::Error,
                "Installs",
                "Could not publish install operation state due to an unknown error.");
        }
    }

    void InstallOperationService::execute(
        const std::shared_ptr<OperationContext>& context) const noexcept
    {
        OperationLogContext operationLog(context->request.operationId);
        const auto throwIfCancellationRequested = [&context]
        {
            if (context->cancellationRequested.load(std::memory_order_acquire))
            {
                throw InstallCancellation{};
            }
        };
        try
        {
            throwIfCancellationRequested();
            publish(context, L"validating", L"validating", 2, false);
            throwIfCancellationRequested();
            const std::wstring currentFingerprint = downloads_.archiveFingerprint(
                context->request.sourcePath);
            throwIfCancellationRequested();
            bool fingerprintChanged = false;
            {
                std::lock_guard lock(context->mutex);
                fingerprintChanged = !context->record.archiveFingerprint.empty() &&
                    context->record.archiveFingerprint != currentFingerprint;
                if (!fingerprintChanged)
                {
                    context->record.archiveFingerprint = currentFingerprint;
                    context->record.enqueueSequence = InstallOperationStore::save(
                        context->request.projectDirectory,
                        context->record);
                }
            }
            if (fingerprintChanged)
            {
                publish(
                    context,
                    L"needsReview",
                    L"needsReview",
                    100,
                    false,
                    L"install.sourceChanged",
                    L"The install source changed after it was queued. Review the installer before retrying.");
                return;
            }
            publish(
                context,
                context->request.fomod ? L"configuringFomod" : L"extracting",
                context->request.fomod ? L"configuringFomod" : L"extracting",
                10,
                true);
            publish(
                context,
                L"buildingStaging",
                L"buildingStaging",
                20,
                true);
            throwIfCancellationRequested();

            const InstallConflictSnapshotCallback conflictProgress =
                [this, context, throwIfCancellationRequested](const FluxoraInstallConflictSnapshot& snapshot)
                {
                    throwIfCancellationRequested();
                    if (snapshot.state == InstallConflictSnapshotState::Ready)
                    {
                        publish(
                            context,
                            L"projectingConflicts",
                            L"projectingConflicts",
                            75,
                            true);
                        publish(
                            context,
                            L"committing",
                            L"committing",
                            85,
                            false);
                    }
                };
            const ModIdentityInstallSelection* identity =
                context->request.identitySelection.has_value()
                    ? &*context->request.identitySelection
                    : nullptr;

            InstalledMod result;
            if (context->request.sourceKind == L"download")
            {
                result = context->request.fomod
                    ? downloads_.installFomodDownload(
                        context->request.projectDirectory,
                        context->request.sourcePath,
                        context->request.modName,
                        context->request.existingModMode,
                        context->request.selectedOptionIds,
                        context->request.placementOverrides,
                        identity,
                        context->request.profileName,
                        context->request.fomodContextId,
                        context->request.manualDecisions,
                        context->request.modOrderTargetIndex,
                        conflictProgress)
                    : downloads_.installDownload(
                        context->request.projectDirectory,
                        context->request.sourcePath,
                        context->request.modName,
                        context->request.existingModMode,
                        context->request.placementOverrides,
                        identity,
                        context->request.profileName,
                        context->request.modOrderTargetIndex,
                        conflictProgress);
            }
            else
            {
                result = context->request.fomod
                    ? downloads_.installFomodArchive(
                        context->request.projectDirectory,
                        context->request.sourcePath,
                        context->request.modName,
                        context->request.existingModMode,
                        context->request.selectedOptionIds,
                        context->request.placementOverrides,
                        identity,
                        context->request.profileName,
                        context->request.fomodContextId,
                        context->request.manualDecisions,
                        context->request.modOrderTargetIndex,
                        conflictProgress)
                    : downloads_.installArchive(
                        context->request.projectDirectory,
                        context->request.sourcePath,
                        context->request.modName,
                        context->request.existingModMode,
                        context->request.placementOverrides,
                        identity,
                        context->request.profileName,
                        context->request.modOrderTargetIndex,
                        conflictProgress);
            }

            if (context->cancellationRequested.load(std::memory_order_acquire))
            {
                publish(
                    context,
                    L"cancelled",
                    L"cancelled",
                    100,
                    false,
                    L"install.cancelled",
                    L"Install operation was cancelled.",
                    serializeInstalledMod(result));
                return;
            }
            publish(context, L"finalizing", L"finalizing", 95, false);
            if (context->cancellationRequested.load(std::memory_order_acquire))
            {
                publish(
                    context,
                    L"cancelled",
                    L"cancelled",
                    100,
                    false,
                    L"install.cancelled",
                    L"Install operation was cancelled.",
                    serializeInstalledMod(result));
                return;
            }
            publish(
                context,
                L"completed",
                L"completed",
                100,
                false,
                {},
                {},
                serializeInstalledMod(result));
        }
        catch (const InstallCancellation&)
        {
            publish(
                context,
                L"cancelled",
                L"cancelled",
                100,
                false,
                L"install.cancelled",
                L"Install operation was cancelled.");
        }
        catch (const std::invalid_argument& exception)
        {
            const bool review = context->resumed ||
                context->waitedForTarget.load(std::memory_order_relaxed);
            publish(
                context,
                review ? L"needsReview" : L"failed",
                review ? L"needsReview" : L"failed",
                100,
                false,
                review ? L"install.contextChanged" : L"install.failed",
                std::wstring(exception.what(), exception.what() + std::char_traits<char>::length(exception.what())));
        }
        catch (const std::exception& exception)
        {
            const bool review = context->waitedForTarget.load(std::memory_order_relaxed);
            publish(
                context,
                review ? L"needsReview" : L"failed",
                review ? L"needsReview" : L"failed",
                100,
                false,
                review ? L"install.contextChanged" : L"install.failed",
                std::wstring(exception.what(), exception.what() + std::char_traits<char>::length(exception.what())));
        }
        catch (...)
        {
            publish(
                context,
                L"failed",
                L"failed",
                100,
                false,
                L"install.failed",
                L"Unknown install error.");
        }
    }

    std::vector<InstallOperationRecord> InstallOperationService::restore(
        const std::filesystem::path& projectDirectory,
        InstallOperationProgressCallback progress)
    {
        std::vector<InstallOperationRecord> operations =
            InstallOperationStore::list(projectDirectory, false);
        std::vector<InstallOperationRecord> restored;
        restored.reserve(operations.size());
        for (InstallOperationRecord& operation : operations)
        {
            {
                std::lock_guard activeLock(activeMutex_);
                if (activeOperations_.contains(operation.operationId))
                {
                    restored.push_back(operation);
                    continue;
                }
            }
            auto context = std::make_shared<OperationContext>();
            context->request.projectDirectory = projectDirectory;
            context->request.operationId = operation.operationId;
            context->record = operation;
            context->progress = progress;
            context->resumed = true;
            publish(context, L"recovering", L"recovering", operation.progressPercent, true);

            const InstallTransactionRecovery transactionRecovery =
                InstallTransactionJournal::recover(
                    projectDirectory,
                    operation.operationId);
            logger_.write(
                LogLevel::Info,
                "Installs",
                "operationId=" + utf8LogText(operation.operationId) +
                    " resumeJournalStage=" + utf8LogText(transactionRecovery.stage) +
                    " journalFound=" + (transactionRecovery.journalFound ? "1" : "0") +
                    " restoredBackup=" + (transactionRecovery.restoredBackup ? "1" : "0") +
                    " commitCompleted=" + (transactionRecovery.commitCompleted ? "1" : "0") +
                    " needsReview=" + (transactionRecovery.needsReview ? "1" : "0") + ".");
            if (transactionRecovery.commitCompleted)
            {
                try
                {
                    const std::optional<InstalledMod> completed =
                        downloads_.completedInstallResult(
                            projectDirectory,
                            operation.operationId);
                    if (!completed.has_value())
                    {
                        throw std::runtime_error(
                            "The committed install result could not be reconstructed.");
                    }
                    publish(
                        context,
                        L"completed",
                        L"completed",
                        100,
                        false,
                        {},
                        {},
                        serializeInstalledMod(*completed));
                }
                catch (const std::exception& exception)
                {
                    publish(
                        context,
                        L"needsReview",
                        L"needsReview",
                        100,
                        false,
                        L"install.recoveryResultMissing",
                        std::wstring(
                            exception.what(),
                            exception.what() + std::char_traits<char>::length(exception.what())));
                }
                std::lock_guard lock(context->mutex);
                restored.push_back(context->record);
                continue;
            }
            if (transactionRecovery.needsReview)
            {
                publish(
                    context,
                    L"needsReview",
                    L"needsReview",
                    100,
                    false,
                    L"install.recoveryReview",
                    L"Fluxora could not prove that the interrupted commit is safe to resume. Review it before retrying.");
                std::lock_guard lock(context->mutex);
                restored.push_back(context->record);
                continue;
            }
            try
            {
                context->request = requestFromRecord(projectDirectory, operation);
                schedule(context);
            }
            catch (const std::exception& exception)
            {
                publish(
                    context,
                    L"needsReview",
                    L"needsReview",
                    100,
                    false,
                    L"install.resumePayloadInvalid",
                    std::wstring(exception.what(), exception.what() + std::char_traits<char>::length(exception.what())));
            }
            std::lock_guard lock(context->mutex);
            restored.push_back(context->record);
        }
        return restored;
    }

    std::vector<InstallOperationRecord> InstallOperationService::list(
        const std::filesystem::path& projectDirectory,
        bool includeTerminal) const
    {
        return InstallOperationStore::list(projectDirectory, includeTerminal);
    }

    std::optional<InstallOperationRecord> InstallOperationService::get(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId) const
    {
        return InstallOperationStore::get(projectDirectory, operationId);
    }

    InstallOperationRecord InstallOperationService::cancel(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId)
    {
        if (projectDirectory.empty() || operationId.empty())
        {
            throw std::invalid_argument("Project directory and operation id are required.");
        }

        std::shared_ptr<OperationContext> context;
        {
            std::lock_guard activeLock(activeMutex_);
            const auto active = activeOperations_.find(std::wstring(operationId));
            if (active != activeOperations_.end())
            {
                context = active->second;
            }
        }
        if (!context)
        {
            const std::optional<InstallOperationRecord> persisted =
                InstallOperationStore::get(projectDirectory, operationId);
            if (!persisted.has_value())
            {
                throw std::invalid_argument("Install operation was not found.");
            }
            if (!isTerminalState(persisted->state))
            {
                throw std::runtime_error("Install operation is not active in this process.");
            }
            return *persisted;
        }

        context->cancellationRequested.store(true, std::memory_order_release);
        logger_.write(
            LogLevel::Info,
            "Installs",
            "operationId=" + utf8LogText(operationId) + " cancellationRequested=1.");

        if (scheduler_ != nullptr && scheduler_->cancel(operationId))
        {
            publish(
                context,
                L"cancelled",
                L"cancelled",
                100,
                false,
                L"install.cancelled",
                L"Install operation was cancelled.");
            finish(context);
        }

        std::unique_lock lock(context->mutex);
        context->finishedChanged.wait(lock, [&context] { return context->finished; });
        return context->record;
    }

    bool InstallOperationService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
