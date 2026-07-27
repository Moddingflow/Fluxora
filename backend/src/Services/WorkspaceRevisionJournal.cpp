#include "FluxoraCore/Services/WorkspaceRevisionJournal.hpp"

#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view journalSchema = L"fluxora.workspace-revision-journal.v1";

        struct FingerprintBuilder
        {
            std::uint64_t value{1469598103934665603ull};

            void append(std::wstring_view text)
            {
                for (const wchar_t character : text)
                {
                    value ^= static_cast<std::uint64_t>(character);
                    value *= 1099511628211ull;
                }
                value ^= 0xffu;
                value *= 1099511628211ull;
            }

            void append(const std::wstring& text)
            {
                append(std::wstring_view(text));
            }

            template<typename T>
            void appendNumber(T number)
            {
                append(std::to_wstring(number));
            }

            void append(bool flag)
            {
                append(std::wstring_view(flag ? L"1" : L"0"));
            }

            void append(const std::filesystem::path& path)
            {
                append(path.lexically_normal().generic_wstring());
            }

            void append(const std::vector<std::wstring>& values)
            {
                appendNumber(values.size());
                for (const auto& value : values)
                {
                    append(value);
                }
            }
        };

        [[nodiscard]] std::wstring hex(std::uint64_t value)
        {
            std::wostringstream stream;
            stream << std::hex << std::setw(16) << std::setfill(L'0') << value;
            return stream.str();
        }

        [[nodiscard]] std::wstring fingerprint(const ProfileModOrderItem& item)
        {
            FingerprintBuilder hash;
            hash.append(item.orderId);
            hash.append(item.kind);
            hash.appendNumber(item.order);
            hash.append(item.id);
            hash.append(item.name);
            hash.append(item.version);
            hash.append(item.latestVersion);
            hash.append(item.lastCheckedAt);
            hash.append(item.updateStatus);
            hash.append(item.conflictStatus);
            hash.appendNumber(item.fileCount);
            hash.appendNumber(item.conflictingFileCount);
            hash.appendNumber(item.overwrittenFileCount);
            hash.appendNumber(item.overwritingFileCount);
            hash.append(item.isEnabled);
            hash.append(item.canCheckUpdates);
            hash.append(item.hasUpdate);
            hash.append(item.sourceIsNexus);
            hash.append(item.sourceIsModdingFlow);
            hash.append(item.isLocal);
            hash.append(item.isTranslation);
            hash.append(item.isPatch);
            hash.append(item.sourceProvider);
            hash.append(item.sourceGameDomain);
            hash.append(item.sourceModId);
            hash.append(item.sourceFileId);
            hash.append(item.sourceUrl);
            hash.append(item.modUuid);
            hash.append(item.separatorTitle);
            hash.append(item.contentFingerprint);
            hash.append(item.overwritesModIds);
            hash.append(item.overwrittenByModIds);
            hash.append(item.latestFileId);
            hash.append(item.updateCheckState);
            return hex(hash.value);
        }

        [[nodiscard]] std::wstring fingerprint(const InstalledModEntry& item)
        {
            FingerprintBuilder hash;
            hash.append(item.id);
            hash.append(item.name);
            hash.append(item.version);
            hash.append(item.installedAt);
            hash.append(item.updatedAt);
            hash.append(item.latestVersion);
            hash.append(item.lastCheckedAt);
            hash.append(item.updateStatus);
            hash.append(item.conflictStatus);
            hash.appendNumber(item.fileCount);
            hash.appendNumber(item.conflictingFileCount);
            hash.appendNumber(item.overwrittenFileCount);
            hash.appendNumber(item.overwritingFileCount);
            hash.append(item.isEnabled);
            hash.append(item.canCheckUpdates);
            hash.append(item.hasUpdate);
            hash.append(item.sourceIsNexus);
            hash.append(item.sourceIsModdingFlow);
            hash.append(item.isLocal);
            hash.append(item.isTranslation);
            hash.append(item.isPatch);
            hash.append(item.sourceProvider);
            hash.append(item.sourceGameDomain);
            hash.append(item.sourceModId);
            hash.append(item.sourceFileId);
            hash.append(item.sourceUrl);
            hash.append(item.overwritesModIds);
            hash.append(item.overwrittenByModIds);
            hash.append(item.latestFileId);
            hash.append(item.updateCheckState);
            return hex(hash.value);
        }

        [[nodiscard]] std::wstring fingerprint(const PluginEntry& item)
        {
            FingerprintBuilder hash;
            hash.append(item.orderId);
            hash.append(item.kind);
            hash.appendNumber(item.order);
            hash.append(item.name);
            hash.append(item.extension);
            hash.append(item.sourceMod);
            hash.append(item.path);
            hash.append(item.isEnabled);
            hash.append(item.isMaster);
            hash.append(item.isLight);
            hash.append(item.hasLightFlag);
            hash.append(item.isLocked);
            hash.append(item.lockReason);
            hash.append(item.separatorTitle);
            hash.append(item.masterFiles);
            hash.append(item.missingMasters);
            return hex(hash.value);
        }

        void appendDuplicateFile(FingerprintBuilder& hash, const DownloadDuplicateFile& file)
        {
            hash.append(file.id);
            hash.append(file.fileId);
            hash.append(file.fileName);
            hash.append(file.version);
        }

        [[nodiscard]] std::wstring fingerprint(const DownloadEntry& item)
        {
            FingerprintBuilder hash;
            hash.append(item.id);
            hash.append(item.name);
            hash.append(item.fileName);
            hash.append(item.localPath);
            hash.append(item.source);
            hash.append(item.status);
            hash.append(item.archiveId);
            hash.append(item.buildStatus);
            hash.append(item.transferState);
            hash.append(item.transferMessage);
            hash.append(item.sizeText);
            hash.append(item.createdAtText);
            hash.appendNumber(item.progressPercent);
            hash.append(item.progressText);
            hash.append(item.etaText);
            hash.append(item.downloadSpeedText);
            hash.append(item.isDownloading);
            hash.append(item.hasKnownProgress);
            hash.append(item.hasResolvedFileName);
            hash.append(item.canResume);
            hash.append(item.canInstall);
            hash.append(item.canDelete);
            hash.append(item.duplicateDecision.has_value());
            if (item.duplicateDecision.has_value())
            {
                const auto& duplicate = *item.duplicateDecision;
                hash.append(duplicate.decisionId);
                hash.append(duplicate.direction);
                appendDuplicateFile(hash, duplicate.incomingFile);
                for (const auto& file : duplicate.existingFiles)
                {
                    appendDuplicateFile(hash, file);
                }
            }
            return hex(hash.value);
        }

        template<typename T, typename Key>
        [[nodiscard]] std::map<std::wstring, std::wstring> fingerprints(
            const std::vector<T>& items,
            Key key)
        {
            std::map<std::wstring, std::wstring> result;
            for (const auto& item : items)
            {
                result.insert_or_assign(key(item), fingerprint(item));
            }
            return result;
        }

        struct HistoryEntry
        {
            std::wstring baseRevision;
            std::wstring revision;
            std::vector<std::wstring> modsChanged;
            std::vector<std::wstring> modsRemoved;
            std::vector<std::wstring> installedChanged;
            std::vector<std::wstring> installedRemoved;
            std::vector<std::wstring> pluginsChanged;
            std::vector<std::wstring> pluginsRemoved;
            std::vector<std::wstring> downloadsChanged;
            std::vector<std::wstring> downloadsRemoved;
        };

        struct JournalState
        {
            bool found{false};
            std::uint64_t sequence{0};
            std::wstring revision;
            std::map<std::wstring, std::wstring> mods;
            std::map<std::wstring, std::wstring> installed;
            std::map<std::wstring, std::wstring> plugins;
            std::map<std::wstring, std::wstring> downloads;
            std::vector<HistoryEntry> history;
        };

        [[nodiscard]] std::vector<std::wstring> changedIds(
            const std::map<std::wstring, std::wstring>& before,
            const std::map<std::wstring, std::wstring>& after)
        {
            std::vector<std::wstring> result;
            for (const auto& [id, value] : after)
            {
                const auto existing = before.find(id);
                if (existing == before.end() || existing->second != value)
                {
                    result.push_back(id);
                }
            }
            return result;
        }

        [[nodiscard]] std::vector<std::wstring> removedIds(
            const std::map<std::wstring, std::wstring>& before,
            const std::map<std::wstring, std::wstring>& after)
        {
            std::vector<std::wstring> result;
            for (const auto& [id, unused] : before)
            {
                static_cast<void>(unused);
                if (!after.contains(id))
                {
                    result.push_back(id);
                }
            }
            return result;
        }

        [[nodiscard]] bool changed(const HistoryEntry& entry)
        {
            return
                !entry.modsChanged.empty() ||
                !entry.modsRemoved.empty() ||
                !entry.installedChanged.empty() ||
                !entry.installedRemoved.empty() ||
                !entry.pluginsChanged.empty() ||
                !entry.pluginsRemoved.empty() ||
                !entry.downloadsChanged.empty() ||
                !entry.downloadsRemoved.empty();
        }

        [[nodiscard]] std::wstring revisionFor(const JournalState& state)
        {
            FingerprintBuilder hash;
            hash.appendNumber(state.sequence);
            const auto appendMap = [&hash](const auto& values)
            {
                for (const auto& [id, value] : values)
                {
                    hash.append(id);
                    hash.append(value);
                }
            };
            appendMap(state.mods);
            appendMap(state.installed);
            appendMap(state.plugins);
            appendMap(state.downloads);
            return L"r" + std::to_wstring(state.sequence) + L"-" + hex(hash.value);
        }

        [[nodiscard]] std::string encodeUtf8(std::wstring_view text)
        {
            std::string result;
            for (const wchar_t character : text)
            {
                const auto codePoint = static_cast<unsigned int>(character);
                if (codePoint <= 0x7F)
                {
                    result.push_back(static_cast<char>(codePoint));
                }
                else if (codePoint <= 0x7FF)
                {
                    result.push_back(static_cast<char>(0xC0 | (codePoint >> 6)));
                    result.push_back(static_cast<char>(0x80 | (codePoint & 0x3F)));
                }
                else
                {
                    result.push_back(static_cast<char>(0xE0 | (codePoint >> 12)));
                    result.push_back(static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F)));
                    result.push_back(static_cast<char>(0x80 | (codePoint & 0x3F)));
                }
            }
            return result;
        }

        [[nodiscard]] std::wstring decodeUtf8(const std::vector<char>& bytes)
        {
            std::wstring result;
            for (std::size_t index = 0; index < bytes.size();)
            {
                const unsigned char first = static_cast<unsigned char>(bytes[index++]);
                if (first < 0x80)
                {
                    result.push_back(static_cast<wchar_t>(first));
                    continue;
                }
                unsigned int codePoint = 0;
                std::size_t continuation = 0;
                if ((first & 0xE0) == 0xC0)
                {
                    codePoint = first & 0x1F;
                    continuation = 1;
                }
                else if ((first & 0xF0) == 0xE0)
                {
                    codePoint = first & 0x0F;
                    continuation = 2;
                }
                else
                {
                    throw std::runtime_error("Revision journal is not valid UTF-8.");
                }
                if (index + continuation > bytes.size())
                {
                    throw std::runtime_error("Revision journal is truncated.");
                }
                for (std::size_t part = 0; part < continuation; ++part)
                {
                    const unsigned char next = static_cast<unsigned char>(bytes[index++]);
                    if ((next & 0xC0) != 0x80)
                    {
                        throw std::runtime_error("Revision journal is not valid UTF-8.");
                    }
                    codePoint = (codePoint << 6) | (next & 0x3F);
                }
                result.push_back(static_cast<wchar_t>(codePoint));
            }
            return result;
        }

        [[nodiscard]] std::filesystem::path journalDirectory(
            const std::filesystem::path& projectDirectory)
        {
            return projectDirectory / L".fluxora" / L"revision-journal";
        }

        [[nodiscard]] std::filesystem::path workspaceJournalPath(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName)
        {
            FingerprintBuilder hash;
            hash.append(profileName);
            return journalDirectory(projectDirectory) /
                (L"workspace-" + hex(hash.value) + L".json");
        }

        [[nodiscard]] std::filesystem::path downloadsJournalPath(
            const std::filesystem::path& projectDirectory)
        {
            return journalDirectory(projectDirectory) / L"downloads.json";
        }

        void writeStringArray(JsonWriter& writer, std::wstring_view key, const std::vector<std::wstring>& values)
        {
            writer.stringArray(key, values);
        }

        void writeMap(
            JsonWriter& writer,
            std::wstring_view key,
            const std::map<std::wstring, std::wstring>& values)
        {
            writer.key(key).beginArray();
            for (const auto& [id, value] : values)
            {
                writer.beginObject();
                writer.field(L"id", id);
                writer.field(L"fingerprint", value);
                writer.endObject();
            }
            writer.endArray();
        }

        [[nodiscard]] std::wstring serialize(const JournalState& state)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"schema", journalSchema);
            writer.field(L"sequence", state.sequence);
            writer.field(L"revision", state.revision);
            writeMap(writer, L"mods", state.mods);
            writeMap(writer, L"installed", state.installed);
            writeMap(writer, L"plugins", state.plugins);
            writeMap(writer, L"downloads", state.downloads);
            writer.key(L"history").beginArray();
            for (const auto& entry : state.history)
            {
                writer.beginObject();
                writer.field(L"baseRevision", entry.baseRevision);
                writer.field(L"revision", entry.revision);
                writeStringArray(writer, L"modsChanged", entry.modsChanged);
                writeStringArray(writer, L"modsRemoved", entry.modsRemoved);
                writeStringArray(writer, L"installedChanged", entry.installedChanged);
                writeStringArray(writer, L"installedRemoved", entry.installedRemoved);
                writeStringArray(writer, L"pluginsChanged", entry.pluginsChanged);
                writeStringArray(writer, L"pluginsRemoved", entry.pluginsRemoved);
                writeStringArray(writer, L"downloadsChanged", entry.downloadsChanged);
                writeStringArray(writer, L"downloadsRemoved", entry.downloadsRemoved);
                writer.endObject();
            }
            writer.endArray();
            writer.endObject();
            return writer.str();
        }

        [[nodiscard]] const JsonValue* field(const JsonValue& object, std::wstring_view name)
        {
            return object.type() == JsonValue::Type::Object ? object.find(name) : nullptr;
        }

        [[nodiscard]] std::wstring stringField(const JsonValue& object, std::wstring_view name)
        {
            const JsonValue* value = field(object, name);
            return value != nullptr && value->isString() ? value->asString() : std::wstring{};
        }

        [[nodiscard]] std::vector<std::wstring> stringArrayField(
            const JsonValue& object,
            std::wstring_view name)
        {
            std::vector<std::wstring> result;
            const JsonValue* value = field(object, name);
            if (value == nullptr || value->type() != JsonValue::Type::Array)
            {
                return result;
            }
            for (const auto& item : value->asArray())
            {
                if (item.isString())
                {
                    result.push_back(item.asString());
                }
            }
            return result;
        }

        [[nodiscard]] std::map<std::wstring, std::wstring> mapField(
            const JsonValue& object,
            std::wstring_view name)
        {
            std::map<std::wstring, std::wstring> result;
            const JsonValue* value = field(object, name);
            if (value == nullptr || value->type() != JsonValue::Type::Array)
            {
                return result;
            }
            for (const auto& item : value->asArray())
            {
                const std::wstring id = stringField(item, L"id");
                const std::wstring itemFingerprint = stringField(item, L"fingerprint");
                if (!id.empty() && !itemFingerprint.empty())
                {
                    result.insert_or_assign(id, itemFingerprint);
                }
            }
            return result;
        }

        [[nodiscard]] JournalState load(const std::filesystem::path& path)
        {
            JournalState state;
            if (!std::filesystem::exists(path))
            {
                return state;
            }
            try
            {
                const AtomicFileWriteOptions options{
                    L"Workspace revision journal",
                    ProjectStateValidation::JsonObject,
                    {},
                    true
                };
                static_cast<void>(AtomicFileStore().recoverFile(path, options));
                std::ifstream stream(path, std::ios::binary);
                const std::vector<char> bytes(
                    (std::istreambuf_iterator<char>(stream)),
                    std::istreambuf_iterator<char>());
                const JsonValue root = JsonReader::parse(decodeUtf8(bytes));
                if (stringField(root, L"schema") != journalSchema)
                {
                    return state;
                }
                const JsonValue* sequence = field(root, L"sequence");
                if (sequence == nullptr || sequence->type() != JsonValue::Type::Number)
                {
                    return state;
                }
                state.sequence = std::stoull(sequence->asNumber());
                state.revision = stringField(root, L"revision");
                state.mods = mapField(root, L"mods");
                state.installed = mapField(root, L"installed");
                state.plugins = mapField(root, L"plugins");
                state.downloads = mapField(root, L"downloads");
                if (const JsonValue* history = field(root, L"history");
                    history != nullptr && history->type() == JsonValue::Type::Array)
                {
                    for (const auto& item : history->asArray())
                    {
                        HistoryEntry entry;
                        entry.baseRevision = stringField(item, L"baseRevision");
                        entry.revision = stringField(item, L"revision");
                        entry.modsChanged = stringArrayField(item, L"modsChanged");
                        entry.modsRemoved = stringArrayField(item, L"modsRemoved");
                        entry.installedChanged = stringArrayField(item, L"installedChanged");
                        entry.installedRemoved = stringArrayField(item, L"installedRemoved");
                        entry.pluginsChanged = stringArrayField(item, L"pluginsChanged");
                        entry.pluginsRemoved = stringArrayField(item, L"pluginsRemoved");
                        entry.downloadsChanged = stringArrayField(item, L"downloadsChanged");
                        entry.downloadsRemoved = stringArrayField(item, L"downloadsRemoved");
                        if (!entry.baseRevision.empty() && !entry.revision.empty())
                        {
                            state.history.push_back(std::move(entry));
                        }
                    }
                }
                state.found = !state.revision.empty() && state.sequence > 0;
            }
            catch (...)
            {
                return JournalState{};
            }
            return state;
        }

        void save(const std::filesystem::path& path, const JournalState& state)
        {
            std::filesystem::create_directories(path.parent_path());
            AtomicFileStore().writeTextFile(
                path,
                encodeUtf8(serialize(state)),
                AtomicFileWriteOptions{
                    L"Workspace revision journal",
                    ProjectStateValidation::JsonObject,
                    {},
                    true
                });
        }

        void appendHistory(
            JournalState& state,
            HistoryEntry entry,
            std::size_t limit)
        {
            state.history.push_back(std::move(entry));
            if (state.history.size() > limit)
            {
                state.history.erase(
                    state.history.begin(),
                    state.history.begin() +
                        static_cast<std::ptrdiff_t>(state.history.size() - limit));
            }
        }

        [[nodiscard]] bool collectHistory(
            const JournalState& state,
            std::wstring_view sinceRevision,
            HistoryEntry& aggregate)
        {
            std::wstring cursor(sinceRevision);
            std::set<std::wstring> visited;
            const auto append = [](std::vector<std::wstring>& destination, const std::vector<std::wstring>& source)
            {
                destination.insert(destination.end(), source.begin(), source.end());
            };
            while (cursor != state.revision)
            {
                if (!visited.insert(cursor).second)
                {
                    return false;
                }
                const auto entry = std::find_if(
                    state.history.begin(),
                    state.history.end(),
                    [&cursor](const HistoryEntry& candidate)
                    {
                        return candidate.baseRevision == cursor;
                    });
                if (entry == state.history.end())
                {
                    return false;
                }
                append(aggregate.modsChanged, entry->modsChanged);
                append(aggregate.modsRemoved, entry->modsRemoved);
                append(aggregate.installedChanged, entry->installedChanged);
                append(aggregate.installedRemoved, entry->installedRemoved);
                append(aggregate.pluginsChanged, entry->pluginsChanged);
                append(aggregate.pluginsRemoved, entry->pluginsRemoved);
                append(aggregate.downloadsChanged, entry->downloadsChanged);
                append(aggregate.downloadsRemoved, entry->downloadsRemoved);
                cursor = entry->revision;
            }
            return true;
        }

        template<typename T, typename Key>
        [[nodiscard]] std::vector<T> selectedUpserts(
            const std::vector<T>& items,
            const std::vector<std::wstring>& changedValues,
            Key key)
        {
            const std::set<std::wstring> changedSet(
                changedValues.begin(),
                changedValues.end());
            std::vector<T> result;
            for (const auto& item : items)
            {
                if (changedSet.contains(key(item)))
                {
                    result.push_back(item);
                }
            }
            return result;
        }

        [[nodiscard]] std::vector<std::wstring> finalRemoved(
            const std::vector<std::wstring>& removedValues,
            const std::map<std::wstring, std::wstring>& current)
        {
            std::set<std::wstring> unique;
            for (const auto& id : removedValues)
            {
                if (!current.contains(id))
                {
                    unique.insert(id);
                }
            }
            return {unique.begin(), unique.end()};
        }

        template<typename T>
        [[nodiscard]] std::vector<OrderPlacement> placementsFor(
            const std::vector<T>& items,
            const std::vector<T>& upserts)
        {
            std::set<std::wstring> changed;
            for (const auto& item : upserts)
            {
                changed.insert(item.orderId);
            }
            std::vector<OrderPlacement> result;
            for (std::size_t index = 0; index < items.size(); ++index)
            {
                if (!changed.contains(items[index].orderId))
                {
                    continue;
                }
                OrderPlacement placement;
                placement.orderId = items[index].orderId;
                if (index > 0)
                {
                    placement.afterOrderId = items[index - 1].orderId;
                }
                else if (index + 1 < items.size())
                {
                    placement.beforeOrderId = items[index + 1].orderId;
                }
                result.push_back(std::move(placement));
            }
            return result;
        }

        template<typename T, typename Key>
        [[nodiscard]] std::vector<std::wstring> allIds(const std::vector<T>& items, Key key)
        {
            std::vector<std::wstring> result;
            result.reserve(items.size());
            for (const auto& item : items)
            {
                result.push_back(key(item));
            }
            return result;
        }
    }

    WorkspaceRevisionJournal::WorkspaceRevisionJournal(std::size_t historyLimit)
        : historyLimit_(std::max<std::size_t>(1, historyLimit))
    {
    }

    WorkspaceDelta WorkspaceRevisionJournal::captureWorkspace(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view sinceRevision,
        std::wstring_view operationId,
        const WorkspaceRevisionInput& input)
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }
        const std::lock_guard lock(mutex_);
        const auto path = workspaceJournalPath(projectDirectory, profileName);
        JournalState state = load(path);
        const bool historyWasAvailable = state.found;
        const auto currentMods = fingerprints(
            input.workspace.modOrder,
            [](const ProfileModOrderItem& item) { return item.orderId; });
        const auto currentInstalled = fingerprints(
            input.workspace.installedMods,
            [](const InstalledModEntry& item) { return item.id.lexically_normal().wstring(); });
        const auto currentPlugins = fingerprints(
            input.plugins,
            [](const PluginEntry& item) { return item.orderId; });

        if (!state.found)
        {
            state.found = true;
            state.sequence = 1;
            state.mods = currentMods;
            state.installed = currentInstalled;
            state.plugins = currentPlugins;
            state.revision = revisionFor(state);
            save(path, state);
        }
        else
        {
            HistoryEntry entry;
            entry.baseRevision = state.revision;
            entry.modsChanged = changedIds(state.mods, currentMods);
            entry.modsRemoved = removedIds(state.mods, currentMods);
            entry.installedChanged = changedIds(state.installed, currentInstalled);
            entry.installedRemoved = removedIds(state.installed, currentInstalled);
            entry.pluginsChanged = changedIds(state.plugins, currentPlugins);
            entry.pluginsRemoved = removedIds(state.plugins, currentPlugins);
            if (changed(entry))
            {
                state.sequence += 1;
                state.mods = currentMods;
                state.installed = currentInstalled;
                state.plugins = currentPlugins;
                state.revision = revisionFor(state);
                entry.revision = state.revision;
                appendHistory(state, std::move(entry), historyLimit_);
                save(path, state);
            }
        }

        WorkspaceDelta result;
        result.projectDirectory = projectDirectory;
        result.profileName = profileName;
        result.operationId = operationId;
        result.sequence = state.sequence;
        result.mods.baseRevision = sinceRevision;
        result.mods.revision = state.revision;
        result.plugins.baseRevision = sinceRevision;
        result.plugins.revision = state.revision;

        HistoryEntry aggregate;
        if (sinceRevision.empty())
        {
            aggregate.modsChanged = allIds(
                input.workspace.modOrder,
                [](const ProfileModOrderItem& item) { return item.orderId; });
            aggregate.installedChanged = allIds(
                input.workspace.installedMods,
                [](const InstalledModEntry& item) { return item.id.lexically_normal().wstring(); });
            aggregate.pluginsChanged = allIds(
                input.plugins,
                [](const PluginEntry& item) { return item.orderId; });
        }
        else if (
            (!historyWasAvailable && sinceRevision != state.revision) ||
            !collectHistory(state, sinceRevision, aggregate))
        {
            result.fullResyncRequired = true;
            return result;
        }

        result.mods.upserts = selectedUpserts(
            input.workspace.modOrder,
            aggregate.modsChanged,
            [](const ProfileModOrderItem& item) { return item.orderId; });
        result.mods.removedOrderIds = finalRemoved(aggregate.modsRemoved, state.mods);
        result.mods.placements = placementsFor(input.workspace.modOrder, result.mods.upserts);
        result.installedModUpserts = selectedUpserts(
            input.workspace.installedMods,
            aggregate.installedChanged,
            [](const InstalledModEntry& item) { return item.id.lexically_normal().wstring(); });
        result.removedInstalledModIds = finalRemoved(
            aggregate.installedRemoved,
            state.installed);
        result.plugins.upserts = selectedUpserts(
            input.plugins,
            aggregate.pluginsChanged,
            [](const PluginEntry& item) { return item.orderId; });
        result.plugins.removedOrderIds = finalRemoved(
            aggregate.pluginsRemoved,
            state.plugins);
        result.plugins.placements = placementsFor(input.plugins, result.plugins.upserts);
        return result;
    }

    DownloadsChangedDelta WorkspaceRevisionJournal::captureDownloads(
        const std::filesystem::path& projectDirectory,
        std::wstring_view sinceRevision,
        std::wstring_view operationId,
        std::wstring_view reason,
        const std::vector<DownloadEntry>& downloads)
    {
        if (projectDirectory.empty())
        {
            throw std::invalid_argument("Project directory is required.");
        }
        const std::lock_guard lock(mutex_);
        const auto path = downloadsJournalPath(projectDirectory);
        JournalState state = load(path);
        const bool historyWasAvailable = state.found;
        const auto current = fingerprints(
            downloads,
            [](const DownloadEntry& item) { return item.id; });
        if (!state.found)
        {
            state.found = true;
            state.sequence = 1;
            state.downloads = current;
            state.revision = revisionFor(state);
            save(path, state);
        }
        else
        {
            HistoryEntry entry;
            entry.baseRevision = state.revision;
            entry.downloadsChanged = changedIds(state.downloads, current);
            entry.downloadsRemoved = removedIds(state.downloads, current);
            if (changed(entry))
            {
                state.sequence += 1;
                state.downloads = current;
                state.revision = revisionFor(state);
                entry.revision = state.revision;
                appendHistory(state, std::move(entry), historyLimit_);
                save(path, state);
            }
        }

        DownloadsChangedDelta result;
        result.projectDirectory = projectDirectory;
        result.operationId = operationId;
        result.revision = state.revision;
        result.sequence = state.sequence;
        result.reason = reason;
        HistoryEntry aggregate;
        if (sinceRevision.empty())
        {
            aggregate.downloadsChanged = allIds(
                downloads,
                [](const DownloadEntry& item) { return item.id; });
        }
        else if (
            (!historyWasAvailable && sinceRevision != state.revision) ||
            !collectHistory(state, sinceRevision, aggregate))
        {
            result.fullResyncRequired = true;
            return result;
        }
        result.upserts = selectedUpserts(
            downloads,
            aggregate.downloadsChanged,
            [](const DownloadEntry& item) { return item.id; });
        result.removedIds = finalRemoved(aggregate.downloadsRemoved, state.downloads);
        return result;
    }
}
