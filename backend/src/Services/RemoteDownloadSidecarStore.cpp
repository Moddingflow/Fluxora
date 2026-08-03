#include "FluxoraCore/Services/RemoteDownloadSidecarStore.hpp"

#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <charconv>
#include <fstream>
#include <iterator>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string_view>
#include <unordered_set>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::uint64_t schemaVersion = 1;
        constexpr std::size_t maximumJsonDepth = 4U;
        constexpr std::size_t maximumJsonValues = 32U;
        constexpr std::size_t maximumJsonStringLength = 1024U;

        struct SidecarPathLess
        {
            bool operator()(const std::wstring& left, const std::wstring& right) const noexcept
            {
#ifdef _WIN32
                const int comparison = CompareStringOrdinal(
                    left.c_str(), static_cast<int>(left.size()),
                    right.c_str(), static_cast<int>(right.size()),
                    TRUE);
                if (comparison != 0)
                {
                    return comparison == CSTR_LESS_THAN;
                }
#endif
                return left < right;
            }
        };

        std::mutex sidecarMutexMapMutex;
        std::map<std::wstring, std::weak_ptr<std::mutex>, SidecarPathLess> sidecarMutexes;

        std::shared_ptr<std::mutex> sidecarMutexFor(const std::filesystem::path& path)
        {
            std::error_code canonicalError;
            std::filesystem::path normalizedPath = std::filesystem::weakly_canonical(
                path,
                canonicalError);
            if (canonicalError)
            {
                normalizedPath = std::filesystem::absolute(path).lexically_normal();
            }
            const std::wstring key = normalizedPath.wstring();
            const std::lock_guard mapLock(sidecarMutexMapMutex);
            if (const auto match = sidecarMutexes.find(key); match != sidecarMutexes.end())
            {
                if (std::shared_ptr<std::mutex> existing = match->second.lock())
                {
                    return existing;
                }
            }
            auto created = std::make_shared<std::mutex>();
            sidecarMutexes[key] = created;
            if (sidecarMutexes.size() > 256U)
            {
                for (auto iterator = sidecarMutexes.begin(); iterator != sidecarMutexes.end();)
                {
                    iterator = iterator->second.expired()
                        ? sidecarMutexes.erase(iterator)
                        : std::next(iterator);
                }
            }
            return created;
        }

        class ExactSidecarJsonValidator final
        {
        public:
            explicit ExactSidecarJsonValidator(std::wstring_view text)
                : text_(text)
            {
            }

            void validate()
            {
                parseValue(1U);
                skipWhitespace();
                if (!atEnd())
                {
                    fail();
                }
            }

        private:
            [[noreturn]] static void fail()
            {
                throw std::runtime_error("Remote download sidecar JSON is invalid or exceeds its limits.");
            }

            void parseValue(std::size_t depth)
            {
                if (depth > maximumJsonDepth || ++valueCount_ > maximumJsonValues)
                {
                    fail();
                }
                skipWhitespace();
                if (atEnd())
                {
                    fail();
                }
                switch (peek())
                {
                case L'{':
                    parseObject(depth);
                    return;
                case L'[':
                    parseArray(depth);
                    return;
                case L'"':
                    static_cast<void>(parseString());
                    return;
                case L't':
                    expectLiteral(L"true");
                    return;
                case L'f':
                    expectLiteral(L"false");
                    return;
                case L'n':
                    expectLiteral(L"null");
                    return;
                default:
                    parseNumber();
                }
            }

            void parseObject(std::size_t depth)
            {
                expect(L'{');
                skipWhitespace();
                if (consume(L'}'))
                {
                    return;
                }

                std::unordered_set<std::wstring> keys;
                while (true)
                {
                    skipWhitespace();
                    std::wstring key = parseString();
                    if (!keys.emplace(std::move(key)).second)
                    {
                        throw std::runtime_error("Remote download sidecar contains a duplicate object member.");
                    }
                    skipWhitespace();
                    expect(L':');
                    parseValue(depth + 1U);
                    skipWhitespace();
                    if (consume(L'}'))
                    {
                        return;
                    }
                    expect(L',');
                }
            }

            void parseArray(std::size_t depth)
            {
                expect(L'[');
                skipWhitespace();
                if (consume(L']'))
                {
                    return;
                }
                while (true)
                {
                    parseValue(depth + 1U);
                    skipWhitespace();
                    if (consume(L']'))
                    {
                        return;
                    }
                    expect(L',');
                }
            }

            std::wstring parseString()
            {
                expect(L'"');
                std::wstring result;
                while (!atEnd())
                {
                    wchar_t character = advance();
                    if (character == L'"')
                    {
                        return result;
                    }
                    if (character < 0x20)
                    {
                        fail();
                    }
                    if (character == L'\\')
                    {
                        if (atEnd())
                        {
                            fail();
                        }
                        const wchar_t escape = advance();
                        switch (escape)
                        {
                        case L'"':
                        case L'\\':
                        case L'/':
                            character = escape;
                            break;
                        case L'b':
                            character = L'\b';
                            break;
                        case L'f':
                            character = L'\f';
                            break;
                        case L'n':
                            character = L'\n';
                            break;
                        case L'r':
                            character = L'\r';
                            break;
                        case L't':
                            character = L'\t';
                            break;
                        case L'u':
                            character = parseHexCodeUnit();
                            break;
                        default:
                            fail();
                        }
                    }
                    if (result.size() >= maximumJsonStringLength)
                    {
                        fail();
                    }
                    result.push_back(character);
                }
                fail();
            }

            wchar_t parseHexCodeUnit()
            {
                unsigned int result = 0;
                for (int index = 0; index < 4; ++index)
                {
                    if (atEnd())
                    {
                        fail();
                    }
                    const wchar_t digit = advance();
                    result <<= 4U;
                    if (digit >= L'0' && digit <= L'9')
                    {
                        result += static_cast<unsigned int>(digit - L'0');
                    }
                    else if (digit >= L'a' && digit <= L'f')
                    {
                        result += static_cast<unsigned int>(digit - L'a' + 10);
                    }
                    else if (digit >= L'A' && digit <= L'F')
                    {
                        result += static_cast<unsigned int>(digit - L'A' + 10);
                    }
                    else
                    {
                        fail();
                    }
                }
                return static_cast<wchar_t>(result);
            }

            void parseNumber()
            {
                consume(L'-');
                if (atEnd())
                {
                    fail();
                }
                if (!consume(L'0'))
                {
                    if (peek() < L'1' || peek() > L'9')
                    {
                        fail();
                    }
                    while (!atEnd() && peek() >= L'0' && peek() <= L'9')
                    {
                        ++position_;
                    }
                }
                if (!atEnd() && consume(L'.'))
                {
                    requireDigit();
                    while (!atEnd() && peek() >= L'0' && peek() <= L'9')
                    {
                        ++position_;
                    }
                }
                if (!atEnd() && (peek() == L'e' || peek() == L'E'))
                {
                    ++position_;
                    if (!atEnd() && (peek() == L'+' || peek() == L'-'))
                    {
                        ++position_;
                    }
                    requireDigit();
                    while (!atEnd() && peek() >= L'0' && peek() <= L'9')
                    {
                        ++position_;
                    }
                }
            }

            void requireDigit() const
            {
                if (atEnd() || peek() < L'0' || peek() > L'9')
                {
                    fail();
                }
            }

            void expectLiteral(std::wstring_view literal)
            {
                if (text_.substr(position_, literal.size()) != literal)
                {
                    fail();
                }
                position_ += literal.size();
            }

            void skipWhitespace() noexcept
            {
                while (!atEnd() &&
                    (peek() == L' ' || peek() == L'\t' || peek() == L'\r' || peek() == L'\n'))
                {
                    ++position_;
                }
            }

            void expect(wchar_t character)
            {
                if (!consume(character))
                {
                    fail();
                }
            }

            bool consume(wchar_t character) noexcept
            {
                if (atEnd() || peek() != character)
                {
                    return false;
                }
                ++position_;
                return true;
            }

            [[nodiscard]] bool atEnd() const noexcept { return position_ >= text_.size(); }
            [[nodiscard]] wchar_t peek() const noexcept { return text_[position_]; }
            wchar_t advance() noexcept { return text_[position_++]; }

            std::wstring_view text_;
            std::size_t position_{0};
            std::size_t valueCount_{0};
        };

        std::wstring fromUtf8(std::string_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            if (value.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)()))
            {
                throw std::runtime_error("Remote download sidecar is too large.");
            }
            const int length = static_cast<int>(value.size());
            const int required = MultiByteToWideChar(
                CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), length, nullptr, 0);
            if (required <= 0)
            {
                throw std::runtime_error("Remote download sidecar is not valid UTF-8.");
            }
            std::wstring result(static_cast<std::size_t>(required), L'\0');
            if (MultiByteToWideChar(
                    CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), length,
                    result.data(), required) != required)
            {
                throw std::runtime_error("Remote download sidecar UTF-8 conversion failed.");
            }
            return result;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        std::string toUtf8(std::wstring_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            if (value.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)()))
            {
                throw std::runtime_error("Remote download sidecar string is too large.");
            }
            const int length = static_cast<int>(value.size());
            const int required = WideCharToMultiByte(
                CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), length,
                nullptr, 0, nullptr, nullptr);
            if (required <= 0)
            {
                throw std::runtime_error("Remote download sidecar string cannot be encoded.");
            }
            std::string result(static_cast<std::size_t>(required), '\0');
            if (WideCharToMultiByte(
                    CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), length,
                    result.data(), required, nullptr, nullptr) != required)
            {
                throw std::runtime_error("Remote download sidecar UTF-8 conversion failed.");
            }
            return result;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::string readBounded(const std::filesystem::path& path)
        {
            const std::uintmax_t size = std::filesystem::file_size(path);
            if (size > RemoteDownloadSidecarStore::maximumDocumentBytes)
            {
                throw std::runtime_error("Remote download sidecar exceeded its byte limit.");
            }
            std::ifstream stream(path, std::ios::in | std::ios::binary);
            if (!stream)
            {
                throw std::runtime_error("Remote download sidecar could not be read.");
            }
            std::string result;
            result.reserve(static_cast<std::size_t>(size));
            char buffer[4096];
            while (stream)
            {
                stream.read(buffer, static_cast<std::streamsize>(sizeof(buffer)));
                const std::streamsize count = stream.gcount();
                if (count <= 0)
                {
                    break;
                }
                if (result.size() + static_cast<std::size_t>(count) >
                    RemoteDownloadSidecarStore::maximumDocumentBytes)
                {
                    throw std::runtime_error("Remote download sidecar exceeded its byte limit.");
                }
                result.append(buffer, static_cast<std::size_t>(count));
            }
            return result;
        }

        const JsonValue& requiredMember(
            const JsonValue& object,
            std::wstring_view name,
            JsonValue::Type type)
        {
            const JsonValue* value = object.find(name);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("Remote download sidecar field is missing or has the wrong type.");
            }
            return *value;
        }

        std::string stringMember(const JsonValue& object, std::wstring_view name)
        {
            return toUtf8(requiredMember(object, name, JsonValue::Type::String).asString());
        }

        std::uint64_t unsignedMember(const JsonValue& object, std::wstring_view name)
        {
            const std::wstring& number = requiredMember(
                object, name, JsonValue::Type::Number).asNumber();
            std::string ascii;
            ascii.reserve(number.size());
            for (const wchar_t character : number)
            {
                if (character < L'0' || character > L'9')
                {
                    throw std::runtime_error("Remote download sidecar integer field is invalid.");
                }
                ascii.push_back(static_cast<char>(character));
            }
            std::uint64_t result = 0;
            const auto [end, error] = std::from_chars(
                ascii.data(), ascii.data() + ascii.size(), result);
            if (error != std::errc{} || end != ascii.data() + ascii.size())
            {
                throw std::runtime_error("Remote download sidecar integer field is invalid.");
            }
            return result;
        }

        void requireExactKeys(
            const JsonValue& object,
            const std::set<std::wstring>& allowed,
            std::size_t requiredCount)
        {
            if (!object.isObject() || object.asObject().size() != requiredCount)
            {
                throw std::runtime_error("Remote download sidecar object shape is invalid.");
            }
            for (const auto& [name, value] : object.asObject())
            {
                static_cast<void>(value);
                if (!allowed.contains(name))
                {
                    throw std::runtime_error("Remote download sidecar contains an unknown field.");
                }
            }
        }

        std::string phaseText(RemoteArtifactResumePhase phase)
        {
            switch (phase)
            {
            case RemoteArtifactResumePhase::AwaitingRepresentation:
                return "awaiting-representation";
            case RemoteArtifactResumePhase::Checkpointed:
                return "checkpointed";
            case RemoteArtifactResumePhase::RetryScheduled:
                return "retry-scheduled";
            case RemoteArtifactResumePhase::ReadyToStart:
            case RemoteArtifactResumePhase::ReadyToAppend:
                break;
            }
            throw std::invalid_argument("Transient remote download phase cannot be persisted.");
        }

        RemoteArtifactResumePhase parsePhase(std::string_view value)
        {
            if (value == "awaiting-representation")
            {
                return RemoteArtifactResumePhase::AwaitingRepresentation;
            }
            if (value == "checkpointed")
            {
                return RemoteArtifactResumePhase::Checkpointed;
            }
            if (value == "retry-scheduled")
            {
                return RemoteArtifactResumePhase::RetryScheduled;
            }
            throw std::runtime_error("Remote download sidecar phase is invalid.");
        }

        std::string validatorKindText(RepresentationValidatorKind kind)
        {
            switch (kind)
            {
            case RepresentationValidatorKind::StrongEtag:
                return "strong-etag";
            case RepresentationValidatorKind::LastModified:
                return "last-modified";
            case RepresentationValidatorKind::ContentSha256:
                return "content-sha256";
            }
            throw std::invalid_argument("Remote download validator kind is invalid.");
        }

        RepresentationValidatorKind parseValidatorKind(std::string_view value)
        {
            if (value == "strong-etag")
            {
                return RepresentationValidatorKind::StrongEtag;
            }
            if (value == "last-modified")
            {
                return RepresentationValidatorKind::LastModified;
            }
            if (value == "content-sha256")
            {
                return RepresentationValidatorKind::ContentSha256;
            }
            throw std::runtime_error("Remote download sidecar validator kind is invalid.");
        }

        std::string serialize(const RemoteArtifactResumeState& state)
        {
            validateRemoteArtifactResumeState(state, RemoteArtifactResumeValidation::Durable);
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"schemaVersion", static_cast<std::uintmax_t>(schemaVersion));
            writer.field(L"providerId", fromUtf8(state.providerId));
            writer.field(L"artifactId", fromUtf8(state.artifactId));
            writer.field(L"modId", fromUtf8(state.modId));
            writer.field(L"versionId", fromUtf8(state.versionId));
            writer.field(L"jobId", fromUtf8(state.jobId));
            writer.field(L"grantId", fromUtf8(state.grantId));
            writer.field(L"expectedSize", static_cast<std::uintmax_t>(state.expectedSize));
            writer.field(L"expectedSha256", fromUtf8(state.expectedSha256));
            writer.field(L"bytesReceived", static_cast<std::uintmax_t>(state.bytesReceived));
            writer.field(
                L"grantExpiresAtUnixMs",
                static_cast<std::uintmax_t>(state.grantExpiresAtUnixMs));
            writer.key(L"retryAtUnixMs");
            if (state.retryAtUnixMs.has_value())
            {
                writer.value(static_cast<std::uintmax_t>(*state.retryAtUnixMs));
            }
            else
            {
                writer.nullValue();
            }
            writer.field(L"phase", fromUtf8(phaseText(state.phase)));
            writer.key(L"validator");
            if (!state.validator.has_value())
            {
                writer.nullValue();
            }
            else
            {
                writer.beginObject();
                writer.field(L"providerId", fromUtf8(state.validator->providerId));
                writer.field(L"kind", fromUtf8(validatorKindText(state.validator->kind)));
                writer.field(L"value", fromUtf8(state.validator->value));
                writer.endObject();
            }
            writer.endObject();
            const std::string document = toUtf8(writer.str());
            if (document.size() > RemoteDownloadSidecarStore::maximumDocumentBytes)
            {
                throw std::invalid_argument("Remote download sidecar exceeded its byte limit.");
            }
            return document;
        }

        RemoteArtifactResumeState parse(std::string_view document)
        {
            if (document.empty() ||
                document.size() > RemoteDownloadSidecarStore::maximumDocumentBytes)
            {
                throw std::runtime_error("Remote download sidecar exceeded its byte limit.");
            }
            const std::wstring text = fromUtf8(document);
            ExactSidecarJsonValidator(text).validate();
            const JsonValue root = JsonReader::parse(text);
            static const std::set<std::wstring> rootKeys{
                L"schemaVersion", L"providerId", L"artifactId", L"modId", L"versionId",
                L"jobId", L"grantId", L"expectedSize", L"expectedSha256", L"bytesReceived",
                L"grantExpiresAtUnixMs", L"retryAtUnixMs", L"phase", L"validator"};
            requireExactKeys(root, rootKeys, rootKeys.size());
            if (unsignedMember(root, L"schemaVersion") != schemaVersion)
            {
                throw std::runtime_error("Remote download sidecar schema version is unsupported.");
            }

            RemoteArtifactResumeState state{
                .providerId = stringMember(root, L"providerId"),
                .artifactId = stringMember(root, L"artifactId"),
                .modId = stringMember(root, L"modId"),
                .versionId = stringMember(root, L"versionId"),
                .jobId = stringMember(root, L"jobId"),
                .grantId = stringMember(root, L"grantId"),
                .expectedSize = unsignedMember(root, L"expectedSize"),
                .expectedSha256 = stringMember(root, L"expectedSha256"),
                .bytesReceived = unsignedMember(root, L"bytesReceived"),
                .grantExpiresAtUnixMs = unsignedMember(root, L"grantExpiresAtUnixMs"),
                .phase = parsePhase(stringMember(root, L"phase"))};

            const JsonValue* retry = root.find(L"retryAtUnixMs");
            if (retry == nullptr)
            {
                throw std::runtime_error("Remote download sidecar retry field is missing.");
            }
            if (!retry->isNull())
            {
                state.retryAtUnixMs = unsignedMember(root, L"retryAtUnixMs");
            }

            const JsonValue* validator = root.find(L"validator");
            if (validator == nullptr)
            {
                throw std::runtime_error("Remote download sidecar validator field is missing.");
            }
            if (!validator->isNull())
            {
                static const std::set<std::wstring> validatorKeys{
                    L"providerId", L"kind", L"value"};
                requireExactKeys(*validator, validatorKeys, validatorKeys.size());
                state.validator = RepresentationValidator{
                    .providerId = stringMember(*validator, L"providerId"),
                    .kind = parseValidatorKind(stringMember(*validator, L"kind")),
                    .value = stringMember(*validator, L"value")};
            }

            validateRemoteArtifactResumeState(state, RemoteArtifactResumeValidation::Durable);
            return state;
        }

        AtomicFileWriteOptions atomicOptions(const RemoteDownloadSidecarWriteOptions& requested)
        {
            AtomicFileWriteOptions options;
            options.stateName = L"remote download resume sidecar";
            options.validation = ProjectStateValidation::Utf8Text;
            options.validator = [](const std::filesystem::path& path)
            {
                static_cast<void>(parse(readBounded(path)));
            };
            options.keepBackup = true;
            options.simulateFailurePoint = requested.simulateFailurePoint;
            options.simulateDiskFullAfterBytes = requested.simulateDiskFullAfterBytes;
            return options;
        }
    }

    RemoteDownloadSidecarStore::RemoteDownloadSidecarStore(Logger* logger) noexcept
        : logger_(logger)
    {
    }

    std::filesystem::path RemoteDownloadSidecarStore::sidecarPathFor(
        const std::filesystem::path& artifactPath)
    {
        if (artifactPath.empty() || artifactPath.filename().empty())
        {
            throw std::invalid_argument("Remote download artifact path is required.");
        }
        return artifactPath.parent_path() /
            L".fluxora-remote-downloads" /
            std::filesystem::path(artifactPath.filename().wstring() + L".json");
    }

    void RemoteDownloadSidecarStore::save(
        const std::filesystem::path& artifactPath,
        const RemoteArtifactResumeState& state,
        const RemoteDownloadSidecarWriteOptions& options)
    {
        const std::string document = serialize(state);
        const std::filesystem::path sidecar = sidecarPathFor(artifactPath);
        const std::shared_ptr<std::mutex> pathMutex = sidecarMutexFor(sidecar);
        const std::lock_guard lock(*pathMutex);
        atomicStore_.writeTextFile(sidecar, document, atomicOptions(options));
    }

    RemoteDownloadSidecarLoadResult RemoteDownloadSidecarStore::load(
        const std::filesystem::path& artifactPath)
    {
        const std::filesystem::path sidecar = sidecarPathFor(artifactPath);
        const std::shared_ptr<std::mutex> pathMutex = sidecarMutexFor(sidecar);
        const std::lock_guard lock(*pathMutex);
        const AtomicFileRecoveryResult recovery = atomicStore_.recoverFile(
            sidecar,
            atomicOptions({}),
            logger_);
        if (!std::filesystem::exists(sidecar))
        {
            return {.recoveryAction = recovery.action};
        }
        return {
            .state = parse(readBounded(sidecar)),
            .recoveryAction = recovery.action};
    }

    void RemoteDownloadSidecarStore::remove(
        const std::filesystem::path& artifactPath)
    {
        const std::filesystem::path sidecar = sidecarPathFor(artifactPath);
        const std::shared_ptr<std::mutex> pathMutex = sidecarMutexFor(sidecar);
        const std::lock_guard lock(*pathMutex);

        std::vector<std::filesystem::path> paths{
            sidecar,
            AtomicFileStore::backupPathFor(sidecar)};
        std::error_code scanError;
        if (std::filesystem::is_directory(sidecar.parent_path(), scanError))
        {
            for (const auto& entry : std::filesystem::directory_iterator(
                     sidecar.parent_path(),
                     std::filesystem::directory_options::skip_permission_denied,
                     scanError))
            {
                if (scanError)
                {
                    break;
                }
                if (AtomicFileStore::isManagedTempFileFor(sidecar, entry.path()))
                {
                    paths.push_back(entry.path());
                }
            }
        }
        if (scanError)
        {
            throw std::filesystem::filesystem_error(
                "Remote download sidecar directory could not be inspected.",
                sidecar.parent_path(),
                scanError);
        }

        for (const std::filesystem::path& path : paths)
        {
            std::error_code removeError;
            std::filesystem::remove(path, removeError);
            if (removeError)
            {
                throw std::filesystem::filesystem_error(
                    "Remote download sidecar could not be removed.",
                    path,
                    removeError);
            }
        }

        std::error_code directoryError;
        std::filesystem::remove(sidecar.parent_path(), directoryError);
        if (directoryError && directoryError != std::errc::directory_not_empty)
        {
            throw std::filesystem::filesystem_error(
                "Remote download sidecar directory could not be cleaned.",
                sidecar.parent_path(),
                directoryError);
        }
    }
}
