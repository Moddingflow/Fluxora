#include "FluxoraCore/Services/AiRollbackCheckpointStore.hpp"

#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <zstd.h>

#include <algorithm>
#include <chrono>
#include <fstream>
#include <map>
#include <set>
#include <stdexcept>

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view manifestSchema = L"fluxora.ai.rollback-checkpoints.v1";
        constexpr int manifestVersion = 1;

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
                    throw std::runtime_error("Rollback checkpoint manifest is not valid UTF-8.");
                }
                if (index + continuation > bytes.size())
                {
                    throw std::runtime_error("Rollback checkpoint manifest is truncated.");
                }
                for (std::size_t part = 0; part < continuation; ++part)
                {
                    const unsigned char next = static_cast<unsigned char>(bytes[index++]);
                    if ((next & 0xC0) != 0x80)
                    {
                        throw std::runtime_error("Rollback checkpoint manifest is not valid UTF-8.");
                    }
                    codePoint = (codePoint << 6) | (next & 0x3F);
                }
                result.push_back(static_cast<wchar_t>(codePoint));
            }
            return result;
        }

        [[nodiscard]] std::vector<char> readFile(const std::filesystem::path& path)
        {
            std::ifstream stream(path, std::ios::binary);
            if (!stream)
            {
                throw std::runtime_error("Rollback checkpoint file is unavailable.");
            }
            return {
                std::istreambuf_iterator<char>(stream),
                std::istreambuf_iterator<char>()
            };
        }

        void writeAtomic(const std::filesystem::path& path, const std::vector<char>& bytes)
        {
            std::filesystem::create_directories(path.parent_path());
            const auto suffix = std::chrono::steady_clock::now().time_since_epoch().count();
            const std::filesystem::path temporary =
                path.parent_path() / (path.filename().wstring() + L".tmp." + std::to_wstring(suffix));
            {
                std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
                if (!stream)
                {
                    throw std::runtime_error("Rollback checkpoint temporary file could not be created.");
                }
                if (!bytes.empty())
                {
                    stream.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
                }
                if (!stream)
                {
                    throw std::runtime_error("Rollback checkpoint temporary file could not be completed.");
                }
            }
            std::error_code renameError;
            std::filesystem::rename(temporary, path, renameError);
            if (renameError)
            {
                std::error_code removeError;
                std::filesystem::remove(path, removeError);
                renameError.clear();
                std::filesystem::rename(temporary, path, renameError);
            }
            if (renameError)
            {
                std::error_code cleanupError;
                std::filesystem::remove(temporary, cleanupError);
                throw std::runtime_error("Rollback checkpoint file could not be published atomically.");
            }
        }

        [[nodiscard]] std::filesystem::path chatDirectory(
            const std::filesystem::path& root,
            std::wstring_view chatId)
        {
            const std::string bytes = encodeUtf8(chatId);
            return root / L"chats" /
                computeFluxPackBytesSha256(bytes.data(), bytes.size());
        }

        [[nodiscard]] std::filesystem::path manifestPath(
            const std::filesystem::path& root,
            std::wstring_view chatId)
        {
            return chatDirectory(root, chatId) / L"manifest.json";
        }

        [[nodiscard]] std::filesystem::path blobPath(
            const std::filesystem::path& root,
            std::wstring_view hash)
        {
            return root / L"blobs" / (std::wstring(hash) + L".blob");
        }

        void appendUint64(std::vector<char>& bytes, std::uint64_t value)
        {
            for (int shift = 0; shift < 64; shift += 8)
            {
                bytes.push_back(static_cast<char>((value >> shift) & 0xFF));
            }
        }

        [[nodiscard]] std::uint64_t readUint64(const std::vector<char>& bytes)
        {
            if (bytes.size() < 9)
            {
                throw std::runtime_error("Rollback checkpoint blob header is truncated.");
            }
            std::uint64_t value = 0;
            for (int shift = 0; shift < 64; shift += 8)
            {
                value |= static_cast<std::uint64_t>(
                    static_cast<unsigned char>(bytes[1 + shift / 8])) << shift;
            }
            return value;
        }

        void ensureBlob(
            const std::filesystem::path& root,
            std::wstring_view expectedHash,
            const std::vector<char>& bytes)
        {
            if (computeFluxPackBytesSha256(bytes.data(), bytes.size()) != expectedHash)
            {
                throw std::runtime_error("Rollback checkpoint snapshot hash does not match its manifest.");
            }
            const std::filesystem::path path = blobPath(root, expectedHash);
            if (std::filesystem::is_regular_file(path))
            {
                return;
            }
            std::vector<char> compressed(ZSTD_compressBound(bytes.size()));
            const std::size_t compressedSize = ZSTD_compress(
                compressed.data(),
                compressed.size(),
                bytes.data(),
                bytes.size(),
                3);
            if (ZSTD_isError(compressedSize))
            {
                throw std::runtime_error("Rollback checkpoint compression failed.");
            }
            compressed.resize(compressedSize);
            const bool useCompressed = compressed.size() < bytes.size();
            std::vector<char> stored;
            stored.reserve(9 + (useCompressed ? compressed.size() : bytes.size()));
            stored.push_back(useCompressed ? 'Z' : 'R');
            appendUint64(stored, static_cast<std::uint64_t>(bytes.size()));
            const auto& payload = useCompressed ? compressed : bytes;
            stored.insert(stored.end(), payload.begin(), payload.end());
            writeAtomic(path, stored);
        }

        [[nodiscard]] std::vector<char> readBlob(
            const std::filesystem::path& root,
            std::wstring_view expectedHash)
        {
            const std::vector<char> stored = readFile(blobPath(root, expectedHash));
            const std::uint64_t originalSize = readUint64(stored);
            if (originalSize > 5ull * 1024ull * 1024ull)
            {
                throw std::runtime_error("Rollback checkpoint blob exceeds the supported file limit.");
            }
            std::vector<char> bytes;
            if (stored[0] == 'R')
            {
                bytes.assign(stored.begin() + 9, stored.end());
            }
            else if (stored[0] == 'Z')
            {
                bytes.resize(static_cast<std::size_t>(originalSize));
                const std::size_t decoded = ZSTD_decompress(
                    bytes.data(),
                    bytes.size(),
                    stored.data() + 9,
                    stored.size() - 9);
                if (ZSTD_isError(decoded) || decoded != bytes.size())
                {
                    throw std::runtime_error("Rollback checkpoint blob is corrupt.");
                }
            }
            else
            {
                throw std::runtime_error("Rollback checkpoint blob compression is unsupported.");
            }
            if (bytes.size() != originalSize ||
                computeFluxPackBytesSha256(bytes.data(), bytes.size()) != expectedHash)
            {
                throw std::runtime_error("Rollback checkpoint blob hash verification failed.");
            }
            return bytes;
        }

        [[nodiscard]] const JsonValue& required(
            const JsonValue& object,
            std::wstring_view key,
            JsonValue::Type type)
        {
            const JsonValue* value = object.find(key);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("Rollback checkpoint manifest field is missing or invalid.");
            }
            return *value;
        }

        [[nodiscard]] std::wstring requiredString(const JsonValue& object, std::wstring_view key)
        {
            return required(object, key, JsonValue::Type::String).asString();
        }

        [[nodiscard]] std::uintmax_t requiredNumber(const JsonValue& object, std::wstring_view key)
        {
            return static_cast<std::uintmax_t>(std::stoull(
                required(object, key, JsonValue::Type::Number).asNumber()));
        }

        [[nodiscard]] bool safeRelativePath(std::wstring_view value)
        {
            const std::filesystem::path path(value);
            if (path.empty() || path.is_absolute() || path.has_root_path())
            {
                return false;
            }
            return std::none_of(path.begin(), path.end(), [](const auto& part)
            {
                return part == L".." || part == L"." || part.empty();
            });
        }

        [[nodiscard]] std::wstring stateName(AiRollbackCheckpointState state)
        {
            switch (state)
            {
            case AiRollbackCheckpointState::Available: return L"available";
            case AiRollbackCheckpointState::RolledBack: return L"rolled-back";
            case AiRollbackCheckpointState::Conflict: return L"conflict";
            case AiRollbackCheckpointState::Unavailable: return L"unavailable";
            }
            return L"unavailable";
        }

        [[nodiscard]] AiRollbackCheckpointState parseState(std::wstring_view value)
        {
            if (value == L"available") return AiRollbackCheckpointState::Available;
            if (value == L"rolled-back") return AiRollbackCheckpointState::RolledBack;
            if (value == L"conflict") return AiRollbackCheckpointState::Conflict;
            if (value == L"unavailable") return AiRollbackCheckpointState::Unavailable;
            throw std::runtime_error("Rollback checkpoint state is invalid.");
        }

        [[nodiscard]] std::wstring reasonName(AiRollbackCheckpointReason reason)
        {
            switch (reason)
            {
            case AiRollbackCheckpointReason::None: return L"none";
            case AiRollbackCheckpointReason::Expired: return L"checkpoint-expired";
            case AiRollbackCheckpointReason::Corrupt: return L"checkpoint-corrupt";
            case AiRollbackCheckpointReason::OverlappingEdit: return L"overlapping-edit";
            case AiRollbackCheckpointReason::EncodingChanged: return L"encoding-changed";
            case AiRollbackCheckpointReason::PathChanged: return L"path-changed";
            case AiRollbackCheckpointReason::CreatedFileModified: return L"created-file-modified";
            }
            return L"checkpoint-corrupt";
        }

        [[nodiscard]] AiRollbackCheckpointReason parseReason(std::wstring_view value)
        {
            if (value == L"none") return AiRollbackCheckpointReason::None;
            if (value == L"checkpoint-expired") return AiRollbackCheckpointReason::Expired;
            if (value == L"checkpoint-corrupt") return AiRollbackCheckpointReason::Corrupt;
            if (value == L"overlapping-edit") return AiRollbackCheckpointReason::OverlappingEdit;
            if (value == L"encoding-changed") return AiRollbackCheckpointReason::EncodingChanged;
            if (value == L"path-changed") return AiRollbackCheckpointReason::PathChanged;
            if (value == L"created-file-modified") return AiRollbackCheckpointReason::CreatedFileModified;
            throw std::runtime_error("Rollback checkpoint reason is invalid.");
        }

        [[nodiscard]] std::vector<AiRollbackCheckpointRun> readManifest(
            const std::filesystem::path& root,
            const std::filesystem::path& path,
            bool materialize)
        {
            if (!std::filesystem::is_regular_file(path))
            {
                return {};
            }
            const JsonValue document = JsonReader::parse(decodeUtf8(readFile(path)));
            if (!document.isObject() || requiredString(document, L"schema") != manifestSchema ||
                requiredNumber(document, L"version") != manifestVersion)
            {
                throw std::runtime_error("Rollback checkpoint manifest version is incompatible.");
            }
            const std::wstring chatId = requiredString(document, L"chatId");
            const std::wstring buildKey = requiredString(document, L"buildKey");
            const auto& runs = required(document, L"runs", JsonValue::Type::Array).asArray();
            std::vector<AiRollbackCheckpointRun> result;
            result.reserve(runs.size());
            for (const JsonValue& runValue : runs)
            {
                AiRollbackCheckpointRun run;
                run.chatId = chatId;
                run.buildKey = buildKey;
                run.runId = requiredString(runValue, L"runId");
                run.operationId = requiredString(runValue, L"operationId");
                run.createdAt = requiredNumber(runValue, L"createdAt");
                run.state = parseState(requiredString(runValue, L"state"));
                run.reason = parseReason(requiredString(runValue, L"reason"));
                const auto& files = required(runValue, L"files", JsonValue::Type::Array).asArray();
                for (const JsonValue& fileValue : files)
                {
                    AiRollbackCheckpointFile file;
                    file.relativePath = requiredString(fileValue, L"relativePath");
                    if (!safeRelativePath(file.relativePath))
                    {
                        throw std::runtime_error("Rollback checkpoint path is unsafe.");
                    }
                    file.displayRelativePath = requiredString(fileValue, L"displayRelativePath");
                    file.ownerMod = requiredString(fileValue, L"ownerMod");
                    file.beforeHash = requiredString(fileValue, L"beforeHash");
                    file.afterHash = requiredString(fileValue, L"afterHash");
                    file.encoding = static_cast<int>(requiredNumber(fileValue, L"encoding"));
                    file.created = required(fileValue, L"created", JsonValue::Type::Boolean).asBoolean();
                    file.managedOverride = required(
                        fileValue, L"managedOverride", JsonValue::Type::Boolean).asBoolean();
                    file.registeredManagedMod = required(
                        fileValue, L"registeredManagedMod", JsonValue::Type::Boolean).asBoolean();
                    file.addedLines = static_cast<std::size_t>(requiredNumber(fileValue, L"addedLines"));
                    file.removedLines = static_cast<std::size_t>(requiredNumber(fileValue, L"removedLines"));
                    file.beforeVersion = requiredString(fileValue, L"beforeVersion");
                    file.afterVersion = requiredString(fileValue, L"afterVersion");
                    if (materialize && run.state != AiRollbackCheckpointState::Unavailable)
                    {
                        if (!file.created)
                        {
                            file.beforeBytes = readBlob(root, file.beforeHash);
                        }
                        file.afterBytes = readBlob(root, file.afterHash);
                    }
                    run.files.push_back(std::move(file));
                }
                result.push_back(std::move(run));
            }
            return result;
        }

        void writeManifest(
            const std::filesystem::path& root,
            const std::vector<AiRollbackCheckpointRun>& runs)
        {
            if (runs.empty())
            {
                return;
            }
            JsonWriter writer;
            writer.beginObject()
                .field(L"schema", manifestSchema)
                .field(L"version", manifestVersion)
                .field(L"chatId", runs.front().chatId)
                .field(L"buildKey", runs.front().buildKey)
                .key(L"runs").beginArray();
            for (const auto& run : runs)
            {
                writer.beginObject()
                    .field(L"runId", run.runId)
                    .field(L"operationId", run.operationId)
                    .field(L"createdAt", run.createdAt)
                    .field(L"state", stateName(run.state))
                    .field(L"reason", reasonName(run.reason))
                    .key(L"files").beginArray();
                for (const auto& file : run.files)
                {
                    writer.beginObject()
                        .field(L"relativePath", file.relativePath)
                        .field(L"displayRelativePath", file.displayRelativePath)
                        .field(L"ownerMod", file.ownerMod)
                        .field(L"beforeHash", file.beforeHash)
                        .field(L"afterHash", file.afterHash)
                        .field(L"encoding", file.encoding)
                        .field(L"created", file.created)
                        .field(L"managedOverride", file.managedOverride)
                        .field(L"registeredManagedMod", file.registeredManagedMod)
                        .field(L"addedLines", static_cast<std::uintmax_t>(file.addedLines))
                        .field(L"removedLines", static_cast<std::uintmax_t>(file.removedLines))
                        .field(L"beforeVersion", file.beforeVersion)
                        .field(L"afterVersion", file.afterVersion)
                        .endObject();
                }
                writer.endArray().endObject();
            }
            writer.endArray().endObject();
            const std::string utf8 = encodeUtf8(writer.str());
            writeAtomic(
                manifestPath(root, runs.front().chatId),
                std::vector<char>(utf8.begin(), utf8.end()));
        }

        [[nodiscard]] std::set<std::wstring> referencedHashes(
            const std::vector<AiRollbackCheckpointRun>& runs)
        {
            std::set<std::wstring> hashes;
            for (const auto& run : runs)
            {
                if (run.state == AiRollbackCheckpointState::Unavailable)
                {
                    continue;
                }
                for (const auto& file : run.files)
                {
                    if (!file.created && !file.beforeHash.empty()) hashes.insert(file.beforeHash);
                    if (!file.afterHash.empty()) hashes.insert(file.afterHash);
                }
            }
            return hashes;
        }

        [[nodiscard]] std::uintmax_t referencedBytes(
            const std::filesystem::path& root,
            const std::vector<AiRollbackCheckpointRun>& runs)
        {
            std::uintmax_t total = 0;
            for (const auto& hash : referencedHashes(runs))
            {
                std::error_code error;
                total += std::filesystem::file_size(blobPath(root, hash), error);
                if (error)
                {
                    throw std::runtime_error("Rollback checkpoint blob size is unavailable.");
                }
            }
            return total;
        }

        void garbageCollect(const std::filesystem::path& root)
        {
            std::set<std::wstring> referenced;
            const std::filesystem::path chats = root / L"chats";
            std::error_code error;
            if (std::filesystem::is_directory(chats, error) && !error)
            {
                for (const auto& entry : std::filesystem::directory_iterator(chats))
                {
                    const auto manifest = entry.path() / L"manifest.json";
                    try
                    {
                        const auto runs = readManifest(root, manifest, false);
                        const auto hashes = referencedHashes(runs);
                        referenced.insert(hashes.begin(), hashes.end());
                    }
                    catch (const std::exception&)
                    {
                    }
                }
            }
            const std::filesystem::path blobs = root / L"blobs";
            error.clear();
            if (!std::filesystem::is_directory(blobs, error) || error)
            {
                return;
            }
            for (const auto& entry : std::filesystem::directory_iterator(blobs))
            {
                const std::wstring stem = entry.path().stem().wstring();
                if (!referenced.contains(stem))
                {
                    std::error_code removeError;
                    std::filesystem::remove(entry.path(), removeError);
                }
            }
        }

        void evictOldest(
            std::vector<AiRollbackCheckpointRun>& runs,
            std::wstring_view protectedRunId)
        {
            const auto candidate = std::min_element(runs.begin(), runs.end(), [protectedRunId](const auto& left, const auto& right)
            {
                const auto rank = [protectedRunId](const auto& run)
                {
                    const bool eligible = run.state == AiRollbackCheckpointState::Available &&
                        run.runId != protectedRunId;
                    return std::pair{eligible ? 0 : 1, run.createdAt};
                };
                return rank(left) < rank(right);
            });
            if (candidate == runs.end() || candidate->state != AiRollbackCheckpointState::Available ||
                candidate->runId == protectedRunId)
            {
                throw std::runtime_error("Rollback checkpoint limits cannot preserve the new run.");
            }
            candidate->state = AiRollbackCheckpointState::Unavailable;
            candidate->reason = AiRollbackCheckpointReason::Expired;
            candidate->files.clear();
        }
    }

    AiRollbackCheckpointStore::AiRollbackCheckpointStore(
        std::filesystem::path root,
        AiRollbackCheckpointLimits limits)
        : root_(std::move(root)), limits_(limits)
    {
        if (root_.empty() || limits_.perChatBytes == 0 || limits_.globalBytes == 0)
        {
            throw std::invalid_argument("Rollback checkpoint store requires a root and positive limits.");
        }
    }

    void AiRollbackCheckpointStore::saveRun(const AiRollbackCheckpointRun& run)
    {
        if (run.chatId.empty() || run.buildKey.empty() || run.runId.empty() || run.files.empty())
        {
            throw std::invalid_argument("Rollback checkpoint run is incomplete.");
        }
        for (const auto& file : run.files)
        {
            if (!safeRelativePath(file.relativePath) || file.afterHash.empty())
            {
                throw std::invalid_argument("Rollback checkpoint file metadata is invalid.");
            }
            if (!file.created)
            {
                ensureBlob(root_, file.beforeHash, file.beforeBytes);
            }
            ensureBlob(root_, file.afterHash, file.afterBytes);
        }

        auto runs = readManifest(root_, manifestPath(root_, run.chatId), false);
        if (!runs.empty() && (runs.front().chatId != run.chatId || runs.front().buildKey != run.buildKey))
        {
            throw std::runtime_error("Rollback checkpoint manifest belongs to another chat or build.");
        }
        if (std::any_of(runs.begin(), runs.end(), [&run](const auto& existing)
            { return existing.runId == run.runId; }))
        {
            throw std::runtime_error("Rollback checkpoint run id already exists.");
        }
        runs.push_back(run);
        while (referencedBytes(root_, runs) > limits_.perChatBytes)
        {
            evictOldest(runs, run.runId);
        }
        if (referencedBytes(root_, {run}) > limits_.perChatBytes ||
            referencedBytes(root_, {run}) > limits_.globalBytes)
        {
            garbageCollect(root_);
            throw std::runtime_error("Rollback checkpoint limits cannot preserve the new run.");
        }

        writeManifest(root_, runs);

        while (true)
        {
            std::vector<std::vector<AiRollbackCheckpointRun>> manifests;
            std::set<std::wstring> allHashes;
            std::uintmax_t global = 0;
            const std::filesystem::path chats = root_ / L"chats";
            for (const auto& entry : std::filesystem::directory_iterator(chats))
            {
                auto manifestRuns = readManifest(root_, entry.path() / L"manifest.json", false);
                const auto hashes = referencedHashes(manifestRuns);
                for (const auto& hash : hashes)
                {
                    if (allHashes.insert(hash).second)
                    {
                        std::error_code error;
                        global += std::filesystem::file_size(blobPath(root_, hash), error);
                        if (error) throw std::runtime_error("Rollback checkpoint blob size is unavailable.");
                    }
                }
                manifests.push_back(std::move(manifestRuns));
            }
            if (global <= limits_.globalBytes)
            {
                break;
            }
            auto selectedManifest = manifests.end();
            std::uintmax_t selectedTime = (std::numeric_limits<std::uintmax_t>::max)();
            std::size_t selectedRun = 0;
            for (auto manifest = manifests.begin(); manifest != manifests.end(); ++manifest)
            {
                for (std::size_t index = 0; index < manifest->size(); ++index)
                {
                    const auto& candidate = (*manifest)[index];
                    if (candidate.state == AiRollbackCheckpointState::Available &&
                        candidate.runId != run.runId && candidate.createdAt < selectedTime)
                    {
                        selectedManifest = manifest;
                        selectedRun = index;
                        selectedTime = candidate.createdAt;
                    }
                }
            }
            if (selectedManifest == manifests.end())
            {
                removeRun(run.chatId, run.buildKey, run.runId);
                throw std::runtime_error("Rollback checkpoint global limit cannot preserve the new run.");
            }
            (*selectedManifest)[selectedRun].state = AiRollbackCheckpointState::Unavailable;
            (*selectedManifest)[selectedRun].reason = AiRollbackCheckpointReason::Expired;
            (*selectedManifest)[selectedRun].files.clear();
            writeManifest(root_, *selectedManifest);
        }
        garbageCollect(root_);
    }

    std::vector<AiRollbackCheckpointRun> AiRollbackCheckpointStore::loadRuns(
        std::wstring_view chatId,
        std::wstring_view buildKey) const
    {
        auto runs = readManifest(root_, manifestPath(root_, chatId), true);
        if (!runs.empty() && (runs.front().chatId != chatId || runs.front().buildKey != buildKey))
        {
            throw std::runtime_error("Rollback checkpoint manifest belongs to another chat or build.");
        }
        return runs;
    }

    std::vector<AiRollbackCheckpointRunState> AiRollbackCheckpointStore::getRunStates(
        std::wstring_view chatId,
        std::wstring_view buildKey) const
    {
        const auto runs = loadRuns(chatId, buildKey);
        std::vector<AiRollbackCheckpointRunState> states;
        states.reserve(runs.size());
        for (const auto& run : runs)
        {
            states.push_back({run.runId, run.state, run.reason});
        }
        return states;
    }

    void AiRollbackCheckpointStore::setRunState(
        std::wstring_view chatId,
        std::wstring_view buildKey,
        std::wstring_view runId,
        AiRollbackCheckpointState state,
        AiRollbackCheckpointReason reason)
    {
        auto runs = readManifest(root_, manifestPath(root_, chatId), false);
        if (!runs.empty() && runs.front().buildKey != buildKey)
        {
            throw std::runtime_error("Rollback checkpoint manifest belongs to another build.");
        }
        const auto match = std::find_if(runs.begin(), runs.end(), [runId](const auto& run)
            { return run.runId == runId; });
        if (match == runs.end())
        {
            throw std::runtime_error("Rollback checkpoint run was not found.");
        }
        match->state = state;
        match->reason = reason;
        writeManifest(root_, runs);
        garbageCollect(root_);
    }

    void AiRollbackCheckpointStore::removeRun(
        std::wstring_view chatId,
        std::wstring_view buildKey,
        std::wstring_view runId)
    {
        auto runs = readManifest(root_, manifestPath(root_, chatId), false);
        if (!runs.empty() && runs.front().buildKey != buildKey)
        {
            throw std::runtime_error("Rollback checkpoint manifest belongs to another build.");
        }
        runs.erase(std::remove_if(runs.begin(), runs.end(), [runId](const auto& run)
            { return run.runId == runId; }), runs.end());
        if (runs.empty())
        {
            std::error_code error;
            std::filesystem::remove_all(chatDirectory(root_, chatId), error);
        }
        else
        {
            writeManifest(root_, runs);
        }
        garbageCollect(root_);
    }

    void AiRollbackCheckpointStore::eraseChat(std::wstring_view chatId)
    {
        std::error_code error;
        std::filesystem::remove_all(chatDirectory(root_, chatId), error);
        garbageCollect(root_);
    }

    void AiRollbackCheckpointStore::eraseBuild(std::wstring_view buildKey)
    {
        const std::filesystem::path chats = root_ / L"chats";
        std::error_code error;
        if (!std::filesystem::is_directory(chats, error) || error) return;
        for (const auto& entry : std::filesystem::directory_iterator(chats))
        {
            try
            {
                const auto runs = readManifest(root_, entry.path() / L"manifest.json", false);
                if (!runs.empty() && runs.front().buildKey == buildKey)
                {
                    std::filesystem::remove_all(entry.path(), error);
                    error.clear();
                }
            }
            catch (const std::exception&)
            {
            }
        }
        garbageCollect(root_);
    }

    void AiRollbackCheckpointStore::eraseAll()
    {
        std::error_code error;
        std::filesystem::remove_all(root_ / L"chats", error);
        if (error)
        {
            throw std::runtime_error("Rollback checkpoint chat storage could not be reset.");
        }
        std::filesystem::remove_all(root_ / L"blobs", error);
        if (error)
        {
            throw std::runtime_error("Rollback checkpoint blob storage could not be reset.");
        }
    }

    AiRollbackCheckpointStorageStats AiRollbackCheckpointStore::storageStats() const
    {
        AiRollbackCheckpointStorageStats result;
        const std::filesystem::path blobs = root_ / L"blobs";
        std::error_code error;
        if (!std::filesystem::is_directory(blobs, error) || error) return result;
        for (const auto& entry : std::filesystem::directory_iterator(blobs))
        {
            if (!entry.is_regular_file()) continue;
            ++result.blobCount;
            result.storedBytes += entry.file_size();
        }
        return result;
    }
}
