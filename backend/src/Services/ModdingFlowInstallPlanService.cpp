#include "FluxoraCore/Services/ModdingFlowInstallPlanService.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cctype>
#include <limits>
#include <random>
#include <set>
#include <stdexcept>
#include <tuple>
#include <utility>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <bcrypt.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumSelections = 128U;
        constexpr std::size_t maximumPlanItems = 256U;
        constexpr std::size_t maximumHashEntries = 16U;

        [[noreturn]] void throwPlanFailure(
            ModdingFlowApiErrorCode code,
            std::wstring_view operationId,
            std::string message,
            std::uint16_t status = 0U)
        {
            throw ModdingFlowApiException(
                code,
                std::move(message),
                std::wstring(operationId),
                status);
        }

        [[noreturn]] void throwInvalidPlanRequest(
            std::wstring_view operationId,
            std::string message)
        {
            throwPlanFailure(
                ModdingFlowApiErrorCode::InvalidRequest,
                operationId,
                std::move(message));
        }

        [[noreturn]] void throwInvalidPlanResponse(
            std::wstring_view operationId,
            std::string message)
        {
            throwPlanFailure(
                ModdingFlowApiErrorCode::ProtocolFailure,
                operationId,
                std::move(message));
        }

        bool isValidOperationId(std::wstring_view value) noexcept
        {
            return !value.empty() && value.size() <= 256U &&
                std::none_of(value.begin(), value.end(), [](wchar_t character) {
                    return character < 0x20 || character == 0x7F;
                });
        }

        bool isCanonicalUuid(std::string_view value) noexcept
        {
            if (value.size() != 36U || value[8] != '-' || value[13] != '-' ||
                value[18] != '-' || value[23] != '-')
            {
                return false;
            }
            for (std::size_t index = 0U; index < value.size(); ++index)
            {
                if (index == 8U || index == 13U || index == 18U || index == 23U)
                {
                    continue;
                }
                const char character = value[index];
                if (!((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f')))
                {
                    return false;
                }
            }
            return true;
        }

        bool isSlug(std::string_view value) noexcept
        {
            if (value.size() < 2U || value.size() > 80U)
            {
                return false;
            }
            const auto alphanumeric = [](char character) {
                return (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9');
            };
            return alphanumeric(value.front()) && alphanumeric(value.back()) &&
                std::all_of(value.begin(), value.end(), [&](char character) {
                    return alphanumeric(character) || character == '-';
                });
        }

        bool isSafeText(std::string_view value, std::size_t maximum) noexcept
        {
            return !value.empty() && value.size() <= maximum &&
                std::none_of(value.begin(), value.end(), [](char character) {
                    const unsigned char byte = static_cast<unsigned char>(character);
                    return byte < 0x20U || byte == 0x7FU;
                });
        }

        bool isIdempotencyKey(std::string_view value) noexcept
        {
            return value.size() >= 8U && value.size() <= 160U &&
                std::all_of(value.begin(), value.end(), [](char character) {
                    const unsigned char byte = static_cast<unsigned char>(character);
                    return byte > 0x20U && byte < 0x7FU;
                });
        }

        bool isLowerHex(std::string_view value, std::size_t length) noexcept
        {
            return value.size() == length &&
                std::all_of(value.begin(), value.end(), [](char character) {
                    return (character >= '0' && character <= '9') ||
                        (character >= 'a' && character <= 'f');
                });
        }

        std::string generateSecureIdempotencyKey()
        {
            std::array<unsigned char, 16U> bytes{};
#ifdef _WIN32
            if (BCryptGenRandom(
                    nullptr,
                    bytes.data(),
                    static_cast<ULONG>(bytes.size()),
                    BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
            {
                throw std::runtime_error("Secure idempotency generation failed.");
            }
#else
            std::random_device source;
            for (unsigned char& byte : bytes)
            {
                byte = static_cast<unsigned char>(source());
            }
#endif
            constexpr char digits[] = "0123456789abcdef";
            std::string result = "fluxora-plan-";
            result.reserve(result.size() + bytes.size() * 2U);
            for (const unsigned char byte : bytes)
            {
                result.push_back(digits[byte >> 4U]);
                result.push_back(digits[byte & 0x0FU]);
            }
            return result;
        }

        void normalizeIds(
            std::vector<std::string>& values,
            std::wstring_view operationId,
            std::string_view label)
        {
            if (values.size() > maximumSelections ||
                !std::all_of(values.begin(), values.end(), isCanonicalUuid))
            {
                throwInvalidPlanRequest(
                    operationId,
                    std::string("Install-plan ") + std::string(label) + " are invalid.");
            }
            std::sort(values.begin(), values.end());
            values.erase(std::unique(values.begin(), values.end()), values.end());
        }

        void appendJsonString(std::string& output, std::string_view value)
        {
            constexpr char digits[] = "0123456789abcdef";
            output.push_back('"');
            for (const unsigned char byte : value)
            {
                switch (byte)
                {
                case '"': output.append("\\\""); break;
                case '\\': output.append("\\\\"); break;
                case '\b': output.append("\\b"); break;
                case '\f': output.append("\\f"); break;
                case '\n': output.append("\\n"); break;
                case '\r': output.append("\\r"); break;
                case '\t': output.append("\\t"); break;
                default:
                    if (byte < 0x20U)
                    {
                        output.append("\\u00");
                        output.push_back(digits[byte >> 4U]);
                        output.push_back(digits[byte & 0x0FU]);
                    }
                    else
                    {
                        output.push_back(static_cast<char>(byte));
                    }
                    break;
                }
            }
            output.push_back('"');
        }

        void appendStringArray(
            std::string& output,
            std::string_view name,
            const std::vector<std::string>& values,
            bool& first)
        {
            if (values.empty())
            {
                return;
            }
            if (!first) output.push_back(',');
            first = false;
            appendJsonString(output, name);
            output.append(":");
            output.push_back('[');
            bool firstValue = true;
            for (const std::string& value : values)
            {
                if (!firstValue) output.push_back(',');
                firstValue = false;
                appendJsonString(output, value);
            }
            output.push_back(']');
        }

        struct NormalizedPlanRequest
        {
            ModdingFlowInstallPlanRequest value;
            std::string body;
            std::string idempotencyKey;
        };

        NormalizedPlanRequest normalizeRequest(
            const ModdingFlowInstallPlanRequest& request,
            const ModdingFlowInstallPlanServiceOptions& options)
        {
            if (!isValidOperationId(request.operationId) || !isSlug(request.gameSlug) ||
                !isSafeText(request.gameVersion, 80U) ||
                (request.loader && !isSafeText(*request.loader, 120U)) ||
                (request.platform && !isSafeText(*request.platform, 120U)) ||
                (request.releaseChannel != "stable" && request.releaseChannel != "beta" &&
                 request.releaseChannel != "alpha" && request.releaseChannel != "experimental"))
            {
                throwInvalidPlanRequest(request.operationId, "Install-plan request fields are invalid.");
            }

            NormalizedPlanRequest normalized;
            normalized.value = request;
            normalizeIds(normalized.value.artifactIds, request.operationId, "artifact ids");
            normalizeIds(normalized.value.versionIds, request.operationId, "version ids");
            normalizeIds(normalized.value.modIds, request.operationId, "mod ids");
            const std::size_t selections = normalized.value.artifactIds.size() +
                normalized.value.versionIds.size() + normalized.value.modIds.size();
            if (selections == 0U || selections > maximumSelections)
            {
                throwInvalidPlanRequest(
                    request.operationId,
                    "Install-plan selection count is invalid.");
            }

            if (request.idempotencyKey)
            {
                normalized.idempotencyKey = *request.idempotencyKey;
            }
            else
            {
                try
                {
                    normalized.idempotencyKey = options.generateIdempotencyKey
                        ? options.generateIdempotencyKey()
                        : generateSecureIdempotencyKey();
                }
                catch (const std::exception&)
                {
                    throwPlanFailure(
                        ModdingFlowApiErrorCode::SecurityFailure,
                        request.operationId,
                        "Install-plan idempotency key generation failed.");
                }
            }
            if (!isIdempotencyKey(normalized.idempotencyKey))
            {
                throwInvalidPlanRequest(
                    request.operationId,
                    "Install-plan idempotency key is invalid.");
            }

            std::string& body = normalized.body;
            body.push_back('{');
            bool first = true;
            appendStringArray(body, "artifact_ids", normalized.value.artifactIds, first);
            appendStringArray(body, "version_ids", normalized.value.versionIds, first);
            appendStringArray(body, "mod_ids", normalized.value.modIds, first);
            auto field = [&](std::string_view name, std::string_view value) {
                if (!first) body.push_back(',');
                first = false;
                appendJsonString(body, name);
                body.push_back(':');
                appendJsonString(body, value);
            };
            field("game_slug", normalized.value.gameSlug);
            field("game_version", normalized.value.gameVersion);
            if (normalized.value.loader) field("loader", *normalized.value.loader);
            if (normalized.value.platform) field("platform", *normalized.value.platform);
            field("release_channel", normalized.value.releaseChannel);
            if (!first) body.push_back(',');
            appendJsonString(body, "include_optional");
            body.append(normalized.value.includeOptional ? ":true" : ":false");
            body.push_back('}');
            return normalized;
        }

        const JsonValue& requireMember(
            const JsonValue& object,
            std::wstring_view key,
            JsonValue::Type type)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Install-plan JSON value is not an object.");
            }
            const JsonValue* value = object.find(key);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("Install-plan JSON member has an invalid type.");
            }
            return *value;
        }

        std::string jsonString(
            const JsonValue& value,
            std::size_t maximum,
            bool allowEmpty = false)
        {
            if (!value.isString())
            {
                throw std::runtime_error("Install-plan JSON string has an invalid type.");
            }
            std::string result = moddingFlowJsonStringToUtf8(value.asString());
            if (result.size() > maximum || (!allowEmpty && result.empty()))
            {
                throw std::runtime_error("Install-plan JSON string exceeded its contract bounds.");
            }
            return result;
        }

        std::string requiredString(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximum,
            bool allowEmpty = false)
        {
            return jsonString(
                requireMember(object, key, JsonValue::Type::String),
                maximum,
                allowEmpty);
        }

        std::optional<std::string> nullableString(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximum,
            bool requirePresence = false)
        {
            if (!object.isObject())
            {
                throw std::runtime_error("Install-plan JSON value is not an object.");
            }
            const JsonValue* value = object.find(key);
            if (value == nullptr)
            {
                if (requirePresence)
                {
                    throw std::runtime_error("Install-plan JSON member is missing.");
                }
                return std::nullopt;
            }
            if (value->isNull())
            {
                return std::nullopt;
            }
            return jsonString(*value, maximum, true);
        }

        std::uint64_t unsignedInteger(const JsonValue& value)
        {
            if (!value.isNumber())
            {
                throw std::runtime_error("Install-plan integer has an invalid type.");
            }
            const std::wstring& wide = value.asNumber();
            if (wide.empty() || wide.size() > 20U)
            {
                throw std::runtime_error("Install-plan integer is invalid.");
            }
            std::string ascii;
            ascii.reserve(wide.size());
            for (const wchar_t character : wide)
            {
                if (character < L'0' || character > L'9')
                {
                    throw std::runtime_error("Install-plan integer is invalid.");
                }
                ascii.push_back(static_cast<char>(character));
            }
            std::uint64_t result = 0U;
            const auto [end, error] = std::from_chars(
                ascii.data(),
                ascii.data() + ascii.size(),
                result);
            if (error != std::errc{} || end != ascii.data() + ascii.size())
            {
                throw std::runtime_error("Install-plan integer is invalid.");
            }
            return result;
        }

        const JsonValue& envelopeData(const JsonValue& root)
        {
            if (!root.isObject() ||
                !requireMember(root, L"ok", JsonValue::Type::Boolean).asBoolean())
            {
                throw std::runtime_error("Install-plan response envelope is invalid.");
            }
            return requireMember(root, L"data", JsonValue::Type::Object);
        }

        std::map<std::string, std::string> parseHashes(const JsonValue& value)
        {
            if (!value.isObject() || value.asObject().empty() ||
                value.asObject().size() > maximumHashEntries)
            {
                throw std::runtime_error("Install-plan hashes are invalid.");
            }
            std::map<std::string, std::string> result;
            for (const auto& [wideAlgorithm, digestValue] : value.asObject())
            {
                const std::string algorithm = moddingFlowJsonStringToUtf8(wideAlgorithm);
                if (!isSafeText(algorithm, 32U))
                {
                    throw std::runtime_error("Install-plan hash entry is invalid.");
                }
                if (digestValue.isNull())
                {
                    if (algorithm == "sha256")
                    {
                        throw std::runtime_error("Install-plan canonical SHA-256 is null.");
                    }
                    continue;
                }
                if (!digestValue.isString())
                {
                    throw std::runtime_error("Install-plan hash entry is invalid.");
                }
                std::string digest = jsonString(digestValue, 256U);
                const std::size_t expectedLength = algorithm == "sha256"
                    ? 64U
                    : algorithm == "sha1" ? 40U : algorithm == "md5" ? 32U : 0U;
                if (expectedLength == 0U)
                {
                    continue;
                }
                if (!isLowerHex(digest, expectedLength))
                {
                    throw std::runtime_error("Install-plan hash is not canonical hexadecimal.");
                }
                result.emplace(algorithm, std::move(digest));
            }
            const auto sha = result.find("sha256");
            if (sha == result.end() || !isLowerHex(sha->second, 64U))
            {
                throw std::runtime_error("Install-plan canonical SHA-256 is missing.");
            }
            return result;
        }

        std::vector<std::string> parseStringArray(
            const JsonValue& object,
            std::wstring_view key,
            std::size_t maximumItems,
            std::size_t maximumStringBytes,
            bool required)
        {
            const JsonValue* value = object.find(key);
            if (value == nullptr)
            {
                if (required)
                {
                    throw std::runtime_error("Install-plan string array is missing.");
                }
                return {};
            }
            if (!value->isArray() || value->asArray().size() > maximumItems)
            {
                throw std::runtime_error("Install-plan string array has an invalid size.");
            }
            std::vector<std::string> result;
            result.reserve(value->asArray().size());
            for (const JsonValue& item : value->asArray())
            {
                result.push_back(jsonString(item, maximumStringBytes, true));
            }
            return result;
        }

        ModdingFlowInstallPlanStep parseStep(
            const JsonValue& value,
            std::size_t expectedIndex)
        {
            ModdingFlowInstallPlanStep result;
            result.index = expectedIndex;
            if (const JsonValue* stepIndex = value.find(L"step_index"); stepIndex != nullptr &&
                unsignedInteger(*stepIndex) != expectedIndex)
            {
                throw std::runtime_error("Install-plan step index is not contiguous.");
            }
            result.itemId = nullableString(value, L"item_id", 36U);
            result.modId = requiredString(value, L"mod_id", 36U);
            result.versionId = requiredString(value, L"version_id", 36U);
            result.artifactId = requiredString(value, L"artifact_id", 36U);
            result.required = requireMember(value, L"required", JsonValue::Type::Boolean).asBoolean();
            if (const JsonValue* kind = value.find(L"selection_kind"); kind != nullptr)
            {
                result.selectionKind = jsonString(*kind, 32U);
            }
            result.decisionReasons = parseStringArray(
                value,
                L"decision_reasons",
                32U,
                512U,
                false);
            const JsonValue& file = requireMember(value, L"file", JsonValue::Type::Object);
            result.fileKind = requiredString(file, L"kind", 16U);
            result.fileVersion = nullableString(file, L"file_version", 80U);
            result.label = nullableString(file, L"label", 512U);
            result.filename = nullableString(file, L"filename", 512U);
            result.contentType = nullableString(file, L"content_type", 256U);
            result.sizeBytes = unsignedInteger(requireMember(file, L"size_bytes", JsonValue::Type::Number));
            result.sha256 = requiredString(value, L"sha256", 64U);
            result.hashes = parseHashes(requireMember(value, L"hashes", JsonValue::Type::Object));

            if ((result.itemId && !isCanonicalUuid(*result.itemId)) ||
                !isCanonicalUuid(result.modId) || !isCanonicalUuid(result.versionId) ||
                !isCanonicalUuid(result.artifactId) || result.sizeBytes == 0U ||
                !isLowerHex(result.sha256, 64U) || result.hashes.at("sha256") != result.sha256 ||
                (result.fileKind != "main" && result.fileKind != "optional" &&
                 result.fileKind != "old") ||
                (!result.selectionKind.empty() && result.selectionKind != "selected_artifact" &&
                 result.selectionKind != "selected_version" &&
                 result.selectionKind != "selected_mod" &&
                 result.selectionKind != "required_dependency" &&
                 result.selectionKind != "optional_dependency"))
            {
                throw std::runtime_error("Install-plan step is invalid.");
            }
            return result;
        }

        ModdingFlowInstallPlanDependency parseDependency(const JsonValue& value)
        {
            ModdingFlowInstallPlanDependency result;
            result.dependencyId = requiredString(value, L"dependency_id", 36U);
            result.modId = nullableString(value, L"mod_id", 36U);
            result.targetModId = nullableString(value, L"target_mod_id", 36U);
            result.semantic = requiredString(value, L"semantic", 16U);
            result.relation = requiredString(value, L"relation", 256U);
            result.reason = nullableString(value, L"reason", 4096U);
            if (!isCanonicalUuid(result.dependencyId) ||
                (result.modId && !isCanonicalUuid(*result.modId)) ||
                (result.targetModId && !isCanonicalUuid(*result.targetModId)) ||
                (result.semantic != "required" && result.semantic != "optional" &&
                 result.semantic != "embedded"))
            {
                throw std::runtime_error("Install-plan dependency is invalid.");
            }
            return result;
        }

        ModdingFlowInstallPlanConflict parseConflict(const JsonValue& value)
        {
            ModdingFlowInstallPlanConflict result;
            result.dependencyId = requiredString(value, L"dependency_id", 36U);
            result.modId = nullableString(value, L"mod_id", 36U);
            result.targetModId = nullableString(value, L"target_mod_id", 36U);
            if (requiredString(value, L"semantic", 16U) != "conflict")
            {
                throw std::runtime_error("Install-plan conflict semantic is invalid.");
            }
            result.relation = requiredString(value, L"relation", 256U);
            result.reason = nullableString(value, L"reason", 4096U);
            if (!isCanonicalUuid(result.dependencyId) ||
                (result.modId && !isCanonicalUuid(*result.modId)) ||
                (result.targetModId && !isCanonicalUuid(*result.targetModId)))
            {
                throw std::runtime_error("Install-plan conflict is invalid.");
            }
            return result;
        }

        ModdingFlowInstallPlan parsePlan(
            const ModdingFlowPublicApiResponse& response,
            const NormalizedPlanRequest& request)
        {
            if (response.operationId != request.value.operationId)
            {
                throw std::runtime_error("Install-plan operation correlation is inconsistent.");
            }
            const JsonValue& data = envelopeData(response.body);
            ModdingFlowInstallPlan result;
            result.planId = requiredString(data, L"plan_id", 36U);
            result.gameSlug = requiredString(data, L"game_slug", 80U);
            result.gameVersion = requiredString(data, L"game_version", 80U);
            result.loader = nullableString(data, L"loader", 120U);
            result.platform = nullableString(data, L"platform", 120U);
            if (const JsonValue* channel = data.find(L"release_channel"); channel != nullptr)
            {
                result.releaseChannel = jsonString(*channel, 16U);
            }
            else
            {
                result.releaseChannel = request.value.releaseChannel;
            }
            if (!isCanonicalUuid(result.planId) || result.gameSlug != request.value.gameSlug ||
                result.gameVersion != request.value.gameVersion ||
                result.loader != request.value.loader || result.platform != request.value.platform ||
                result.releaseChannel != request.value.releaseChannel)
            {
                throw std::runtime_error("Install-plan target identity is inconsistent.");
            }

            const JsonValue* dependencyValues = data.find(L"dependency_constraints");
            if (dependencyValues != nullptr)
            {
                if (!dependencyValues->isArray() || dependencyValues->asArray().size() > maximumPlanItems)
                {
                    throw std::runtime_error("Install-plan dependency set is too large.");
                }
                for (const JsonValue& value : dependencyValues->asArray())
                {
                    result.dependencies.push_back(parseDependency(value));
                }
                std::sort(result.dependencies.begin(), result.dependencies.end(), [](const auto& left, const auto& right) {
                    return std::tie(left.dependencyId, left.semantic, left.relation) <
                        std::tie(right.dependencyId, right.semantic, right.relation);
                });
                if (std::adjacent_find(
                        result.dependencies.begin(),
                        result.dependencies.end(),
                        [](const auto& left, const auto& right) {
                            return left.dependencyId == right.dependencyId;
                        }) != result.dependencies.end())
                {
                    throw std::runtime_error("Install-plan dependency set contains duplicates.");
                }
            }

            const JsonValue* conflictValues = data.find(L"conflicts");
            if (conflictValues != nullptr)
            {
                if (!conflictValues->isArray() || conflictValues->asArray().size() > maximumPlanItems)
                {
                    throw std::runtime_error("Install-plan conflict set is too large.");
                }
                for (const JsonValue& value : conflictValues->asArray())
                {
                    result.conflicts.push_back(parseConflict(value));
                }
                std::sort(result.conflicts.begin(), result.conflicts.end(), [](const auto& left, const auto& right) {
                    return std::tie(left.dependencyId, left.relation) <
                        std::tie(right.dependencyId, right.relation);
                });
                if (std::adjacent_find(
                        result.conflicts.begin(),
                        result.conflicts.end(),
                        [](const auto& left, const auto& right) {
                            return left.dependencyId == right.dependencyId;
                        }) != result.conflicts.end())
                {
                    throw std::runtime_error("Install-plan conflict set contains duplicates.");
                }
            }

            const JsonValue& steps = requireMember(data, L"install_order", JsonValue::Type::Array);
            if (steps.asArray().empty() || steps.asArray().size() > maximumSelections)
            {
                throw std::runtime_error("Install-plan install order has an invalid size.");
            }
            std::set<std::string> stepArtifactIds;
            std::uint64_t stepSizeTotal = 0U;
            result.steps.reserve(steps.asArray().size());
            for (std::size_t index = 0U; index < steps.asArray().size(); ++index)
            {
                ModdingFlowInstallPlanStep step = parseStep(steps.asArray()[index], index + 1U);
                if (!stepArtifactIds.insert(step.artifactId).second ||
                    stepSizeTotal > (std::numeric_limits<std::uint64_t>::max)() - step.sizeBytes)
                {
                    throw std::runtime_error("Install-plan steps are not uniquely bounded.");
                }
                stepSizeTotal += step.sizeBytes;
                result.steps.push_back(std::move(step));
            }
            const auto containsSelected = [&](const std::vector<std::string>& selected, auto member) {
                return std::all_of(selected.begin(), selected.end(), [&](const std::string& id) {
                    return std::any_of(result.steps.begin(), result.steps.end(), [&](const auto& step) {
                        return step.*member == id;
                    });
                });
            };
            if (!containsSelected(request.value.artifactIds, &ModdingFlowInstallPlanStep::artifactId) ||
                !containsSelected(request.value.versionIds, &ModdingFlowInstallPlanStep::versionId) ||
                !containsSelected(request.value.modIds, &ModdingFlowInstallPlanStep::modId))
            {
                throw std::runtime_error("Install-plan response omitted an explicit selection.");
            }

            const JsonValue& fileHashes = requireMember(data, L"file_hashes", JsonValue::Type::Array);
            if (fileHashes.asArray().size() != result.steps.size())
            {
                throw std::runtime_error("Install-plan file hash set is incomplete.");
            }
            for (const JsonValue& hashValue : fileHashes.asArray())
            {
                const std::string artifactId = requiredString(hashValue, L"artifact_id", 36U);
                const std::string sha256 = requiredString(hashValue, L"sha256", 64U);
                std::map<std::string, std::string> hashes = parseHashes(
                    requireMember(hashValue, L"hashes", JsonValue::Type::Object));
                if (!isCanonicalUuid(artifactId) || !isLowerHex(sha256, 64U) ||
                    hashes.at("sha256") != sha256 ||
                    !result.fileHashes.emplace(artifactId, hashes).second)
                {
                    throw std::runtime_error("Install-plan file hash entry is invalid.");
                }
            }
            for (const ModdingFlowInstallPlanStep& step : result.steps)
            {
                const auto hashes = result.fileHashes.find(step.artifactId);
                if (hashes == result.fileHashes.end() || hashes->second != step.hashes)
                {
                    throw std::runtime_error("Install-plan step and file hashes are inconsistent.");
                }
            }

            if (const JsonValue* diskSize = data.find(L"required_disk_size_bytes"); diskSize != nullptr)
            {
                result.requiredDiskSizeBytes = unsignedInteger(*diskSize);
                if (result.requiredDiskSizeBytes < stepSizeTotal)
                {
                    throw std::runtime_error("Install-plan required disk size is inconsistent.");
                }
            }
            else
            {
                result.requiredDiskSizeBytes = stepSizeTotal;
            }
            result.warnings = parseStringArray(data, L"warnings", 64U, 4096U, true);
            result.idempotencyKey = request.idempotencyKey;
            result.operationId = request.value.operationId;
            return result;
        }

        bool sameProviderPlan(
            ModdingFlowInstallPlan left,
            ModdingFlowInstallPlan right)
        {
            left.operationId.clear();
            right.operationId.clear();
            return left == right;
        }
    }

    ModdingFlowInstallPlanService::ModdingFlowInstallPlanService(
        IModdingFlowPublicApiClient& client,
        ModdingFlowInstallPlanServiceOptions options)
        : client_(client),
          options_(std::move(options))
    {
        if (options_.maximumCachedReplays == 0U ||
            options_.maximumCachedReplays > 4096U)
        {
            throw std::invalid_argument("Install-plan replay cache size is invalid.");
        }
    }

    ModdingFlowInstallPlan ModdingFlowInstallPlanService::resolve(
        const ModdingFlowInstallPlanRequest& request)
    {
        const NormalizedPlanRequest normalized = normalizeRequest(request, options_);
        {
            std::lock_guard lock(replayMutex_);
            const auto cached = replayEntries_.find(normalized.idempotencyKey);
            if (cached != replayEntries_.end())
            {
                if (cached->second.normalizedRequest != normalized.body)
                {
                    throwPlanFailure(
                        ModdingFlowApiErrorCode::IdempotencyMismatch,
                        request.operationId,
                        "Install-plan idempotency key was reused with a different normalized request.",
                        409U);
                }
                ModdingFlowInstallPlan replay = cached->second.plan;
                replay.operationId = request.operationId;
                return replay;
            }
        }

        ModdingFlowInstallPlan plan;
        try
        {
            const auto executePlan = [&](ModdingFlowApiAuthMode auth)
            {
                return client_.execute({
                    .method = ModdingFlowHttpMethod::Post,
                    .pathAndQuery = "/install-plans:resolve",
                    .body = normalized.body,
                    .auth = auth,
                    .requiredScope = auth == ModdingFlowApiAuthMode::BearerRequired
                        ? "install_plans:resolve"
                        : std::string{},
                    .retry = ModdingFlowApiRetryMode::Idempotent,
                    .idempotencyKey = normalized.idempotencyKey,
                    .operationId = request.operationId});
            };

            ModdingFlowPublicApiResponse response;
            try
            {
                response = executePlan(ModdingFlowApiAuthMode::Anonymous);
            }
            catch (const ModdingFlowApiException& exception)
            {
                if (exception.code() != ModdingFlowApiErrorCode::Unauthorized &&
                    exception.code() != ModdingFlowApiErrorCode::Forbidden)
                {
                    throw;
                }
                response = executePlan(ModdingFlowApiAuthMode::BearerRequired);
            }
            plan = parsePlan(response, normalized);
        }
        catch (const ModdingFlowApiException&)
        {
            throw;
        }
        catch (const std::exception& exception)
        {
            throwInvalidPlanResponse(request.operationId, exception.what());
        }

        {
            std::lock_guard lock(replayMutex_);
            const auto existing = replayEntries_.find(normalized.idempotencyKey);
            if (existing != replayEntries_.end())
            {
                if (existing->second.normalizedRequest != normalized.body)
                {
                    throwPlanFailure(
                        ModdingFlowApiErrorCode::IdempotencyMismatch,
                        request.operationId,
                        "Install-plan idempotency key was reused with a different normalized request.",
                        409U);
                }
                if (!sameProviderPlan(existing->second.plan, plan))
                {
                    throwInvalidPlanResponse(
                        request.operationId,
                        "Install-plan idempotent replay returned a different plan.");
                }
                ModdingFlowInstallPlan replay = existing->second.plan;
                replay.operationId = request.operationId;
                return replay;
            }

            while (replayEntries_.size() >= options_.maximumCachedReplays &&
                   !replayOrder_.empty())
            {
                replayEntries_.erase(replayOrder_.front());
                replayOrder_.pop_front();
            }
            replayOrder_.push_back(normalized.idempotencyKey);
            replayEntries_.emplace(
                normalized.idempotencyKey,
                ReplayEntry{normalized.body, plan});
        }
        return plan;
    }

    ModdingFlowInstallPlan ModdingFlowInstallPlanService::previewActivation(
        const ModdingFlowInstallPlanRequest& request)
    {
        return resolve(request);
    }
}
