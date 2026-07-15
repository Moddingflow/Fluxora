#include "FluxoraCore/FluxoraCoreApi.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace
{
    constexpr std::wstring_view protocolVersion = L"1.0";
    constexpr std::wstring_view hostVersion = L"0.1.0-mvp";
    // Common catalog responses include path and health metadata; keep the first
    // C ABI buffer large enough for normal startup while preserving resize fallback.
    constexpr int initialBufferLength = 8192;

    enum class ErrorCategory
    {
        Validation,
        Core,
        Capability,
        Transport,
        Internal
    };

    struct BridgeError final
    {
        std::wstring code;
        std::wstring message;
        ErrorCategory category{ErrorCategory::Internal};
        bool retryable{false};
    };

    struct BridgeRequest final
    {
        std::wstring id;
        std::wstring method;
        const fluxora::JsonValue* params{nullptr};
        const fluxora::JsonValue* meta{nullptr};
    };

    struct ProgressCallbackContext final
    {
        std::wstring operationId;
    };

    void FLUXORA_CORE_CALL emitOperationProgress(const wchar_t* progressJson, void* userData);

    std::wstring toWide(std::string_view value)
    {
        if (value.empty())
        {
            return {};
        }

#ifdef _WIN32
        const int requiredLength = MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0);
        if (requiredLength <= 0)
        {
            throw std::runtime_error("Invalid UTF-8 input.");
        }

        std::wstring output(static_cast<std::size_t>(requiredLength), L'\0');
        MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            output.data(),
            requiredLength);
        return output;
#else
        std::wstring output;
        output.reserve(value.size());
        for (const unsigned char byte : value)
        {
            output.push_back(static_cast<wchar_t>(byte));
        }
        return output;
#endif
    }

    std::string toUtf8(std::wstring_view value)
    {
        if (value.empty())
        {
            return {};
        }

#ifdef _WIN32
        const int requiredLength = WideCharToMultiByte(
            CP_UTF8,
            0,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (requiredLength <= 0)
        {
            throw std::runtime_error("Failed to encode UTF-8 output.");
        }

        std::string output(static_cast<std::size_t>(requiredLength), '\0');
        WideCharToMultiByte(
            CP_UTF8,
            0,
            value.data(),
            static_cast<int>(value.size()),
            output.data(),
            requiredLength,
            nullptr,
            nullptr);
        return output;
#else
        std::string output;
        output.reserve(value.size());
        for (wchar_t character : value)
        {
            output.push_back(character >= 0 && character < 0x80 ? static_cast<char>(character) : '?');
        }
        return output;
#endif
    }

    std::wstring elapsedMilliseconds(std::chrono::steady_clock::time_point startedAt)
    {
        return std::to_wstring(std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - startedAt).count());
    }

    std::wstring categoryLabel(ErrorCategory category)
    {
        switch (category)
        {
        case ErrorCategory::Validation:
            return L"validation";
        case ErrorCategory::Core:
            return L"core";
        case ErrorCategory::Capability:
            return L"capability";
        case ErrorCategory::Transport:
            return L"transport";
        case ErrorCategory::Internal:
            return L"internal";
        }

        return L"internal";
    }

    const fluxora::JsonValue* findObjectField(const fluxora::JsonValue& value, std::wstring_view key)
    {
        return value.isObject() ? value.find(key) : nullptr;
    }

    std::wstring optionalStringField(const fluxora::JsonValue* value, std::wstring_view key)
    {
        const fluxora::JsonValue* field = value == nullptr ? nullptr : findObjectField(*value, key);
        return field != nullptr && field->isString() ? field->asString() : std::wstring{};
    }

    std::wstring requiredStringField(const fluxora::JsonValue& value, std::wstring_view key)
    {
        const fluxora::JsonValue* field = findObjectField(value, key);
        if (field == nullptr || !field->isString() || field->asString().empty())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                std::wstring(key) + L" is required.",
                ErrorCategory::Validation,
                false
            };
        }

        return field->asString();
    }

    const fluxora::JsonValue& requiredParamsObject(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                request.method + L" params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        return *request.params;
    }

    bool requiredBooleanField(const fluxora::JsonValue& value, std::wstring_view key)
    {
        const fluxora::JsonValue* field = findObjectField(value, key);
        if (field == nullptr || field->type() != fluxora::JsonValue::Type::Boolean)
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                std::wstring(key) + L" is required.",
                ErrorCategory::Validation,
                false
            };
        }

        return field->asBoolean();
    }

    int requiredIntField(const fluxora::JsonValue& value, std::wstring_view key)
    {
        const fluxora::JsonValue* field = findObjectField(value, key);
        if (field == nullptr || !field->isNumber())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                std::wstring(key) + L" is required.",
                ErrorCategory::Validation,
                false
            };
        }

        try
        {
            return std::stoi(field->asNumber());
        }
        catch (const std::exception&)
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                std::wstring(key) + L" must be an integer.",
                ErrorCategory::Validation,
                false
            };
        }
    }

    int optionalIntField(const fluxora::JsonValue& value, std::wstring_view key, int fallback)
    {
        const fluxora::JsonValue* field = findObjectField(value, key);
        if (field == nullptr || field->isNull())
        {
            return fallback;
        }

        if (!field->isNumber())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                std::wstring(key) + L" must be an integer.",
                ErrorCategory::Validation,
                false
            };
        }

        try
        {
            return std::stoi(field->asNumber());
        }
        catch (const std::exception&)
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                std::wstring(key) + L" must be an integer.",
                ErrorCategory::Validation,
                false
            };
        }
    }

    std::vector<std::wstring> requiredStringArrayField(
        const fluxora::JsonValue& value,
        std::wstring_view key)
    {
        const fluxora::JsonValue* field = findObjectField(value, key);
        if (field == nullptr || !field->isArray())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                std::wstring(key) + L" is required.",
                ErrorCategory::Validation,
                false
            };
        }

        std::vector<std::wstring> values;
        for (const fluxora::JsonValue& item : field->asArray())
        {
            if (!item.isString() || item.asString().empty())
            {
                throw BridgeError{
                    L"bridge.invalidRequest",
                    std::wstring(key) + L" must contain only non-empty strings.",
                    ErrorCategory::Validation,
                    false
                };
            }

            values.push_back(item.asString());
        }

        return values;
    }

    std::vector<std::wstring> optionalStringArrayField(
        const fluxora::JsonValue& value,
        std::wstring_view key)
    {
        const fluxora::JsonValue* field = findObjectField(value, key);
        if (field == nullptr || field->isNull())
        {
            return {};
        }

        if (!field->isArray())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                std::wstring(key) + L" must be an array.",
                ErrorCategory::Validation,
                false
            };
        }

        std::vector<std::wstring> values;
        for (const fluxora::JsonValue& item : field->asArray())
        {
            if (!item.isString())
            {
                throw BridgeError{
                    L"bridge.invalidRequest",
                    std::wstring(key) + L" must contain only strings.",
                    ErrorCategory::Validation,
                    false
                };
            }

            values.push_back(item.asString());
        }

        return values;
    }

    std::wstring serializeStringArray(const std::vector<std::wstring>& values)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const std::wstring& value : values)
        {
            writer.value(value);
        }
        writer.endArray();
        return writer.str();
    }

    struct FluxPackManualSourceArchiveParams
    {
        std::vector<std::wstring> sourceIds;
        std::vector<std::wstring> paths;
    };

    FluxPackManualSourceArchiveParams optionalFluxPackManualSourceArchives(
        const fluxora::JsonValue& value)
    {
        const fluxora::JsonValue* field = findObjectField(value, L"manualSourceArchives");
        if (field == nullptr || field->isNull())
        {
            return {};
        }
        if (!field->isArray())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"manualSourceArchives must be an array.",
                ErrorCategory::Validation,
                false
            };
        }

        FluxPackManualSourceArchiveParams result;
        result.sourceIds.reserve(field->asArray().size());
        result.paths.reserve(field->asArray().size());
        for (const fluxora::JsonValue& item : field->asArray())
        {
            if (!item.isObject())
            {
                throw BridgeError{
                    L"bridge.invalidRequest",
                    L"manualSourceArchives entries must be objects.",
                    ErrorCategory::Validation,
                    false
                };
            }
            result.sourceIds.push_back(requiredStringField(item, L"sourceId"));
            result.paths.push_back(requiredStringField(item, L"path"));
        }
        return result;
    }

    std::wstring currentOperationId(const BridgeRequest& request)
    {
        return optionalStringField(request.meta, L"operationId");
    }

    BridgeRequest parseRequest(const fluxora::JsonValue& root)
    {
        if (!root.isObject())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"JSON-RPC request must be an object.",
                ErrorCategory::Validation,
                false
            };
        }

        BridgeRequest request;
        request.id = requiredStringField(root, L"id");
        request.method = requiredStringField(root, L"method");
        request.params = findObjectField(root, L"params");
        request.meta = findObjectField(root, L"meta");

        return request;
    }

    [[noreturn]] void throwProtocolVersionMismatch(std::wstring message)
    {
        throw BridgeError{
            L"bridge.protocolVersionMismatch",
            std::move(message),
            ErrorCategory::Transport,
            false
        };
    }

    void validateRequestEnvelope(const fluxora::JsonValue& root, const BridgeRequest& request)
    {
        const std::wstring jsonRpc = requiredStringField(root, L"jsonrpc");
        if (jsonRpc != L"2.0")
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"jsonrpc must be 2.0.",
                ErrorCategory::Validation,
                false
            };
        }

        if (request.meta == nullptr || !request.meta->isObject())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"meta object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring requestedProtocolVersion = requiredStringField(*request.meta, L"protocolVersion");
        if (requestedProtocolVersion != protocolVersion)
        {
            throwProtocolVersionMismatch(
                L"Unsupported bridge protocol version " + requestedProtocolVersion +
                L"; expected " + std::wstring(protocolVersion) + L".");
        }
    }

    int callWithBuffer(int (*fn)(wchar_t*, int), std::wstring& output)
    {
        std::vector<wchar_t> buffer(static_cast<std::size_t>(initialBufferLength), L'\0');
        int result = fn(buffer.data(), static_cast<int>(buffer.size()));
        if (result == FluxoraCoreResultBufferTooSmall)
        {
            const int requiredLength = fluxora_get_last_required_buffer_length();
            if (requiredLength <= 0)
            {
                return result;
            }

            buffer.assign(static_cast<std::size_t>(requiredLength), L'\0');
            result = fluxora_copy_last_output(buffer.data(), static_cast<int>(buffer.size()));
        }

        if (result == FluxoraCoreResultOk)
        {
            output.assign(buffer.data());
        }

        return result;
    }

    template <typename Invoker>
    int callWithJsonBuffer(Invoker&& fn, std::wstring& output)
    {
        std::vector<wchar_t> buffer(static_cast<std::size_t>(initialBufferLength), L'\0');
        int result = std::forward<Invoker>(fn)(buffer.data(), static_cast<int>(buffer.size()));
        if (result == FluxoraCoreResultBufferTooSmall)
        {
            const int requiredLength = fluxora_get_last_required_buffer_length();
            if (requiredLength <= 0)
            {
                return result;
            }

            buffer.assign(static_cast<std::size_t>(requiredLength), L'\0');
            result = fluxora_copy_last_output(buffer.data(), static_cast<int>(buffer.size()));
        }

        if (result == FluxoraCoreResultOk)
        {
            output.assign(buffer.data());
        }

        return result;
    }

    std::wstring getLastCoreError()
    {
        std::wstring output;
        const int result = callWithBuffer(fluxora_get_last_error, output);
        if (result == FluxoraCoreResultOk && !output.empty())
        {
            return output;
        }

        return L"Native core returned an error.";
    }

    BridgeError coreError(std::wstring code)
    {
        const std::wstring message = getLastCoreError();
        if (message == L"install.identityPlanStale")
        {
            return BridgeError{
                L"install.identityPlanStale",
                message,
                ErrorCategory::Core,
                true
            };
        }
        return BridgeError{
            std::move(code),
            message,
            ErrorCategory::Core,
            false
        };
    }

    template <typename Invoker>
    std::wstring payloadFromCoreJson(std::wstring code, Invoker&& fn)
    {
        std::wstring output;
        const int result = callWithJsonBuffer(std::forward<Invoker>(fn), output);
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(std::move(code));
        }

        return output;
    }

    void beginCoreOperation(const BridgeRequest& request)
    {
        const std::wstring operationId = currentOperationId(request);
        fluxora_set_operation_context(operationId.empty() ? nullptr : operationId.c_str());
    }

    void clearCoreOperation()
    {
        fluxora_set_operation_context(nullptr);
    }

    void writeCapabilityFeatures(fluxora::JsonWriter& writer)
    {
        writer.key(L"features").beginObject();
        writer.key(L"templates").beginObject();
        writer.field(L"state", L"available");
        writer.endObject();
        writer.key(L"projects").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(
            L"supports",
            std::vector<std::wstring>{
                L"listConfigs",
                L"openConfig",
                L"create",
                L"rename",
                L"delete",
                L"directoryPreview"
            });
        writer.endObject();
        writer.key(L"mods").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(
            L"supports",
            std::vector<std::wstring>{
                L"listInstalled",
                L"getOrder",
                L"setEnabled",
                L"setAllEnabled",
                L"moveOrderItem",
                L"createSeparator",
                L"deleteSeparator",
                L"createEmpty",
                L"deleteInstalled",
                L"checkUpdates",
                L"clearOverwrite",
                L"getFileTree",
                L"getModDetailsContent",
                L"getEffectiveFileTree",
                L"getEffectiveFileTreeRoot",
                L"getEffectiveFileTreeChildren",
                L"getModDetailsSummary",
                L"getModConflictTree",
                L"startNifPreview",
                L"prepareNifPreviewVariant",
                L"prepareNifPreviewTextures",
                L"readTextFile",
                L"saveTextFile"
            });
        writer.endObject();
        writer.key(L"textFiles").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(
            L"supports",
            std::vector<std::wstring>{
                L"read",
                L"save"
            });
        writer.endObject();
        writer.key(L"plugins").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(
            L"supports",
            std::vector<std::wstring>{
                L"list",
                L"move",
                L"createSeparator",
                L"deleteSeparator",
                L"setEnabled",
                L"setAllEnabled"
            });
        writer.endObject();
        writer.key(L"profiles").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(
            L"supports",
            std::vector<std::wstring>{
                L"list",
                L"create",
                L"clone",
                L"rename",
                L"delete"
            });
        writer.endObject();
        writer.key(L"executables").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(
            L"supports",
            std::vector<std::wstring>{
                L"list",
                L"save",
                L"getIcon",
                L"launch"
            });
        writer.endObject();
        writer.key(L"executableLaunch").beginObject();
#ifdef _WIN32
        writer.field(L"state", L"available");
        writer.stringArray(L"platforms", std::vector<std::wstring>{L"win32"});
#else
        writer.field(L"state", L"unsupported");
#endif
        writer.endObject();
        writer.key(L"downloads").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(
            L"supports",
            std::vector<std::wstring>{
                L"list",
                L"importFile",
                L"delete",
                L"cancel",
                L"resume",
                L"install",
                L"archiveInstall",
                L"importInbound"
            });
        writer.endObject();
        writer.key(L"nxmProtocolRegistration").beginObject();
#ifdef _WIN32
        writer.field(L"state", L"available");
        writer.stringArray(L"platforms", std::vector<std::wstring>{L"win32"});
#elif defined(__linux__)
        writer.field(L"state", L"limited");
        writer.stringArray(L"platforms", std::vector<std::wstring>{L"linux"});
        writer.stringArray(L"requires", std::vector<std::wstring>{L"xdg desktop entry registration"});
#elif defined(__APPLE__)
        writer.field(L"state", L"limited");
        writer.stringArray(L"platforms", std::vector<std::wstring>{L"darwin"});
        writer.stringArray(L"requires", std::vector<std::wstring>{L"app bundle URL scheme registration"});
#else
        writer.field(L"state", L"unsupported");
#endif
        writer.endObject();
        writer.key(L"nxmInboundQueue").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"captureLinks", L"importInboundDownloads"});
        writer.endObject();
        writer.key(L"buildCreation").beginObject();
        writer.field(L"state", L"available");
        writer.endObject();
        writer.key(L"projectDeletion").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"delete", L"progressEvents"});
        writer.endObject();
        writer.key(L"buildPathSettings").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"get", L"save"});
        writer.endObject();
        writer.key(L"fluxPack").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"export", L"inspect", L"install", L"progressEvents"});
        writer.endObject();
        writer.key(L"grassCacheGeneration").beginObject();
#ifdef _WIN32
        writer.field(L"state", L"available");
        writer.stringArray(L"platforms", std::vector<std::wstring>{L"win32"});
        writer.stringArray(L"requires", std::vector<std::wstring>{L"Skyrim", L"No Grass In Objects", L"SKSE"});
        writer.stringArray(L"supports", std::vector<std::wstring>{L"generate", L"progressEvents", L"outputMod"});
#else
        writer.field(L"state", L"unsupported");
        writer.field(L"reason", L"NGIO grass cache generation requires Windows process launch support.");
#endif
        writer.endObject();
        writer.key(L"settings").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"language", L"themeState"});
        writer.endObject();
        writer.key(L"language").beginObject();
        writer.field(L"state", L"available");
        writer.endObject();
        writer.key(L"theme").beginObject();
        writer.field(L"state", L"limited");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"currentTheme"});
        writer.field(L"reason", L"Only the dark theme is supported in the current product UI.");
        writer.endObject();
        writer.key(L"nexusAuth").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"status", L"connect", L"disconnect"});
        writer.endObject();
        writer.key(L"mo2Transfer").beginObject();
        writer.field(L"state", L"available");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"analyze", L"import", L"cancel"});
        writer.endObject();
        writer.key(L"operations").beginObject();
        writer.field(L"state", L"limited");
        writer.stringArray(L"supports", std::vector<std::wstring>{L"operationContext", L"progressEvents"});
        writer.endObject();
        writer.key(L"operationCancellation").beginObject();
        writer.field(L"state", L"unsupported");
        writer.endObject();
        writer.key(L"shellOpen").beginObject();
        writer.field(L"state", L"runtime-shell");
        writer.endObject();
        writer.key(L"vfsLaunch").beginObject();
#ifdef _WIN32
        writer.field(L"state", L"available");
        writer.stringArray(L"platforms", std::vector<std::wstring>{L"win32"});
#else
        writer.field(L"state", L"unsupported");
#endif
        writer.endObject();
        writer.endObject();
    }

    void writeCapabilities(fluxora::JsonWriter& writer)
    {
        writer.beginObject();
#ifdef _WIN32
        writer.field(L"platform", L"win32");
#elif defined(__APPLE__)
        writer.field(L"platform", L"darwin");
#elif defined(__linux__)
        writer.field(L"platform", L"linux");
#else
        writer.field(L"platform", L"unknown");
#endif
#if defined(_M_X64) || defined(__x86_64__)
        writer.field(L"arch", L"x64");
#elif defined(_M_ARM64) || defined(__aarch64__)
        writer.field(L"arch", L"arm64");
#else
        writer.field(L"arch", L"unknown");
#endif
        writer.key(L"core").beginObject();
        writer.field(L"available", fluxora_core_is_available() == 1);
#ifdef _WIN32
        writer.field(L"libraryName", L"FluxoraCore.dll");
#elif defined(__APPLE__)
        writer.field(L"libraryName", L"libFluxoraCore.dylib");
#else
        writer.field(L"libraryName", L"libFluxoraCore.so");
#endif
        writer.endObject();
        writeCapabilityFeatures(writer);
        writer.endObject();
    }

    std::wstring payloadHandshake(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::vector<std::wstring> supportedVersions =
            requiredStringArrayField(params, L"supportedProtocolVersions");
        if (std::find(supportedVersions.begin(), supportedVersions.end(), protocolVersion) ==
            supportedVersions.end())
        {
            throwProtocolVersionMismatch(
                L"No compatible bridge protocol version was offered; host requires " +
                std::wstring(protocolVersion) + L".");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"protocolVersion", protocolVersion);
        writer.field(L"hostVersion", hostVersion);
        writer.field(L"coreVersion", L"0.1.0");
        writer.field(L"coreApiVersion", L"FluxoraCoreApi/legacy-cabi");
        writer.key(L"capabilities");
        writeCapabilities(writer);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadCoreStatus()
    {
        std::wstring language;
        const int result = callWithBuffer(fluxora_get_app_language, language);
        std::wstring theme;
        const int themeResult = callWithBuffer(fluxora_get_app_theme, theme);

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"available", result == FluxoraCoreResultOk && themeResult == FluxoraCoreResultOk);
        writer.field(L"initialized", result == FluxoraCoreResultOk && themeResult == FluxoraCoreResultOk);
        writer.field(L"protocolVersion", protocolVersion);
        writer.field(L"hostVersion", hostVersion);
        writer.field(L"coreApiVersion", L"FluxoraCoreApi/legacy-cabi");
        if (result == FluxoraCoreResultOk)
        {
            writer.field(L"language", language);
        }
        if (themeResult == FluxoraCoreResultOk)
        {
            writer.field(L"theme", theme);
        }
        if (result != FluxoraCoreResultOk || themeResult != FluxoraCoreResultOk)
        {
            writer.field(L"lastError", getLastCoreError());
        }
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadLanguage()
    {
        std::wstring language;
        const int result = callWithBuffer(fluxora_get_app_language, language);
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.languageReadFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"language", language);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadTheme()
    {
        std::wstring theme;
        const int result = callWithBuffer(fluxora_get_app_theme, theme);
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.themeReadFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"theme", theme);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadSetLanguage(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                L"settings.setLanguage params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring language = requiredStringField(*request.params, L"language");
        const int result = fluxora_set_app_language(language.c_str());
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.languageWriteFailed");
        }

        return payloadLanguage();
    }

    std::wstring payloadSetTheme(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring theme = requiredStringField(params, L"theme");
        const int result = fluxora_set_app_theme(theme.c_str());
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.themeWriteFailed");
        }

        return payloadTheme();
    }

    std::wstring payloadTemplateList()
    {
        return payloadFromCoreJson(
            L"core.templatesListFailed",
            [](wchar_t* buffer, int length)
            {
                return fluxora_get_game_templates(buffer, length);
            });
    }

    std::wstring payloadResolveTemplate(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                L"templates.resolve params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring templateId = requiredStringField(*request.params, L"templateId");
        return payloadFromCoreJson(
            L"core.templateResolveFailed",
            [&templateId](wchar_t* buffer, int length)
            {
                return fluxora_resolve_template(templateId.c_str(), buffer, length);
            });
    }

    std::wstring payloadProjectDirectoryPreview(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                L"projects.previewDirectory params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring projectName = requiredStringField(*request.params, L"projectName");
        const std::wstring installRootDirectory = requiredStringField(*request.params, L"installRootDirectory");
        std::wstring projectDirectory;
        const int result = callWithJsonBuffer(
            [&projectName, &installRootDirectory](wchar_t* buffer, int length)
            {
                return fluxora_preview_project_directory(
                    projectName.c_str(),
                    installRootDirectory.c_str(),
                    buffer,
                    length);
            },
            projectDirectory);

        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.projectDirectoryPreviewFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"projectDirectory", projectDirectory);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadCreateProject(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                L"projects.create params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring projectName = requiredStringField(*request.params, L"projectName");
        const std::wstring templateId = requiredStringField(*request.params, L"templateId");
        const std::wstring gamePath = requiredStringField(*request.params, L"gamePath");
        const std::wstring installRootDirectory = requiredStringField(*request.params, L"installRootDirectory");

        return payloadFromCoreJson(
            L"core.projectCreateFailed",
            [&projectName, &templateId, &gamePath, &installRootDirectory](wchar_t* buffer, int length)
            {
                return fluxora_create_project(
                    projectName.c_str(),
                    templateId.c_str(),
                    gamePath.c_str(),
                    installRootDirectory.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadListProjectConfigs(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                L"projects.listConfigs params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring buildConfigsDirectory = requiredStringField(*request.params, L"buildConfigsDirectory");
        return payloadFromCoreJson(
            L"core.projectListFailed",
            [&buildConfigsDirectory](wchar_t* buffer, int length)
            {
                return fluxora_list_project_configs(buildConfigsDirectory.c_str(), buffer, length);
            });
    }

    std::wstring payloadOpenProjectConfig(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                L"projects.openConfig params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring configPath = requiredStringField(*request.params, L"configPath");
        return payloadFromCoreJson(
            L"core.projectOpenFailed",
            [&configPath](wchar_t* buffer, int length)
            {
                return fluxora_open_project_config(configPath.c_str(), buffer, length);
            });
    }

    std::wstring payloadRenameProject(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                L"projects.rename params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring configPath = requiredStringField(*request.params, L"configPath");
        const std::wstring newName = requiredStringField(*request.params, L"newName");
        return payloadFromCoreJson(
            L"core.projectRenameFailed",
            [&configPath, &newName](wchar_t* buffer, int length)
            {
                return fluxora_rename_project(configPath.c_str(), newName.c_str(), buffer, length);
            });
    }

    std::wstring payloadDeleteProject(const BridgeRequest& request)
    {
        if (request.params == nullptr || !request.params->isObject())
        {
            throw BridgeError{
                L"bridge.invalidParams",
                L"projects.delete params object is required.",
                ErrorCategory::Validation,
                false
            };
        }

        const std::wstring configPath = requiredStringField(*request.params, L"configPath");
        ProgressCallbackContext progressContext{currentOperationId(request)};
        const int result = fluxora_delete_project_with_progress(
            configPath.c_str(),
            emitOperationProgress,
            &progressContext);
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.projectDeleteFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"accepted", true);
        writer.field(L"configPath", configPath);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadGetBuildPathSettings(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring configPath = requiredStringField(params, L"configPath");
        return payloadFromCoreJson(
            L"core.buildPathSettingsGetFailed",
            [&configPath](wchar_t* buffer, int length)
            {
                return fluxora_get_build_path_settings(configPath.c_str(), buffer, length);
            });
    }

    std::wstring payloadSaveBuildPathSettings(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring configPath = requiredStringField(params, L"configPath");
        const std::wstring settingsJson = requiredStringField(params, L"settingsJson");
        return payloadFromCoreJson(
            L"core.buildPathSettingsSaveFailed",
            [&configPath, &settingsJson](wchar_t* buffer, int length)
            {
                return fluxora_save_build_path_settings(
                    configPath.c_str(),
                    settingsJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadPrepareWorkspaceIndexes(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        return payloadFromCoreJson(
            L"core.workspaceIndexPrepareFailed",
            [&projectDirectory, &profileName](wchar_t* buffer, int length)
            {
                return fluxora_prepare_workspace_indexes(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadExportFluxPack(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring configPath = requiredStringField(params, L"configPath");
        const std::wstring outputPath = requiredStringField(params, L"outputPath");
        const fluxora::JsonValue* includeGeneratedAssetsField =
            findObjectField(params, L"includeGeneratedAssets");
        if (includeGeneratedAssetsField != nullptr &&
            !includeGeneratedAssetsField->isNull() &&
            includeGeneratedAssetsField->type() != fluxora::JsonValue::Type::Boolean)
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"includeGeneratedAssets must be a boolean.",
                ErrorCategory::Validation,
                false
            };
        }
        const bool includeGeneratedAssets =
            includeGeneratedAssetsField != nullptr &&
            includeGeneratedAssetsField->type() == fluxora::JsonValue::Type::Boolean &&
            includeGeneratedAssetsField->asBoolean();
        const fluxora::JsonValue* packageTypeField =
            findObjectField(params, L"packageType");
        if (packageTypeField != nullptr &&
            !packageTypeField->isNull() &&
            !packageTypeField->isString())
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"packageType must be full or recipe.",
                ErrorCategory::Validation,
                false
            };
        }
        const std::wstring packageType =
            packageTypeField != nullptr && packageTypeField->isString()
                ? packageTypeField->asString()
                : L"recipe";
        int packageTypeValue = 0;
        if (packageType == L"full")
        {
            packageTypeValue = 1;
        }
        else if (packageType == L"recipe")
        {
            packageTypeValue = 2;
        }
        else
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"packageType must be full or recipe.",
                ErrorCategory::Validation,
                false
            };
        }
        ProgressCallbackContext progressContext{currentOperationId(request)};
        return payloadFromCoreJson(
            L"core.fluxPackExportFailed",
            [&configPath,
             &outputPath,
             includeGeneratedAssets,
             packageTypeValue,
             &progressContext](wchar_t* buffer, int length)
            {
                return fluxora_export_fluxpack_with_options_and_progress(
                    configPath.c_str(),
                    outputPath.c_str(),
                    includeGeneratedAssets ? 1 : 0,
                    packageTypeValue,
                    emitOperationProgress,
                    &progressContext,
                    buffer,
                    length);
            });
    }

    std::wstring payloadInspectFluxPack(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring fluxPackPath = requiredStringField(params, L"fluxPackPath");
        return payloadFromCoreJson(
            L"core.fluxPackInspectFailed",
            [&fluxPackPath](wchar_t* buffer, int length)
            {
                return fluxora_inspect_fluxpack(fluxPackPath.c_str(), buffer, length);
            });
    }

    std::wstring payloadPlanFluxPackInstall(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring fluxPackPath = requiredStringField(params, L"fluxPackPath");
        const std::wstring existingConfigPath = optionalStringField(&params, L"existingConfigPath");
        return payloadFromCoreJson(
            L"core.fluxPackPlanInstallFailed",
            [&fluxPackPath, &existingConfigPath](wchar_t* buffer, int length)
            {
                return fluxora_plan_fluxpack_install(
                    fluxPackPath.c_str(),
                    existingConfigPath.empty() ? nullptr : existingConfigPath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadInstallFluxPack(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring fluxPackPath = requiredStringField(params, L"fluxPackPath");
        const std::wstring installRootDirectory = requiredStringField(params, L"installRootDirectory");
        const std::wstring existingConfigPath = optionalStringField(&params, L"existingConfigPath");
        const FluxPackManualSourceArchiveParams manualSourceArchives =
            optionalFluxPackManualSourceArchives(params);
        const std::wstring manualSourceIdsJson = serializeStringArray(manualSourceArchives.sourceIds);
        const std::wstring manualSourcePathsJson = serializeStringArray(manualSourceArchives.paths);
        ProgressCallbackContext progressContext{currentOperationId(request)};
        return payloadFromCoreJson(
            L"core.fluxPackInstallFailed",
            [&fluxPackPath,
             &installRootDirectory,
             &existingConfigPath,
             &manualSourceIdsJson,
             &manualSourcePathsJson,
             &progressContext](wchar_t* buffer, int length)
            {
                return fluxora_install_fluxpack_with_options_and_progress(
                    fluxPackPath.c_str(),
                    installRootDirectory.c_str(),
                    existingConfigPath.empty() ? nullptr : existingConfigPath.c_str(),
                    manualSourceIdsJson.c_str(),
                    manualSourcePathsJson.c_str(),
                    emitOperationProgress,
                    &progressContext,
                    buffer,
                    length);
            });
    }

    std::wstring payloadListProfiles(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring defaultProfileName = optionalStringField(&params, L"defaultProfileName");
        return payloadFromCoreJson(
            L"core.profilesListFailed",
            [&projectDirectory, &defaultProfileName](wchar_t* buffer, int length)
            {
                return fluxora_get_profiles(
                    projectDirectory.c_str(),
                    defaultProfileName.empty() ? nullptr : defaultProfileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadPreviewProfileTextFile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = requiredStringField(params, L"profileName");
        const std::wstring fileName = requiredStringField(params, L"fileName");
        const int maxBytes = optionalIntField(params, L"maxBytes", 0);
        return payloadFromCoreJson(
            L"core.profileTextFilePreviewFailed",
            [&projectDirectory, &profileName, &fileName, maxBytes](wchar_t* buffer, int length)
            {
                return fluxora_preview_profile_text_file(
                    projectDirectory.c_str(),
                    profileName.c_str(),
                    fileName.c_str(),
                    maxBytes,
                    buffer,
                    length);
            });
    }

    std::wstring payloadCreateProfile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = requiredStringField(params, L"profileName");
        const std::wstring defaultProfileName = optionalStringField(&params, L"defaultProfileName");
        const std::wstring profileFilesJson = serializeStringArray(optionalStringArrayField(params, L"profileFiles"));
        return payloadFromCoreJson(
            L"core.profileCreateFailed",
            [&projectDirectory, &profileName, &defaultProfileName, &profileFilesJson](wchar_t* buffer, int length)
            {
                return fluxora_create_profile(
                    projectDirectory.c_str(),
                    profileName.c_str(),
                    defaultProfileName.empty() ? nullptr : defaultProfileName.c_str(),
                    profileFilesJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadCloneProfile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring sourceProfileName = requiredStringField(params, L"sourceProfileName");
        const std::wstring targetProfileName = requiredStringField(params, L"targetProfileName");
        const std::wstring defaultProfileName = optionalStringField(&params, L"defaultProfileName");
        return payloadFromCoreJson(
            L"core.profileCloneFailed",
            [&projectDirectory, &sourceProfileName, &targetProfileName, &defaultProfileName](wchar_t* buffer, int length)
            {
                return fluxora_clone_profile(
                    projectDirectory.c_str(),
                    sourceProfileName.c_str(),
                    targetProfileName.c_str(),
                    defaultProfileName.empty() ? nullptr : defaultProfileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadRenameProfile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring sourceProfileName = requiredStringField(params, L"sourceProfileName");
        const std::wstring targetProfileName = requiredStringField(params, L"targetProfileName");
        const std::wstring defaultProfileName = optionalStringField(&params, L"defaultProfileName");
        return payloadFromCoreJson(
            L"core.profileRenameFailed",
            [&projectDirectory, &sourceProfileName, &targetProfileName, &defaultProfileName](wchar_t* buffer, int length)
            {
                return fluxora_rename_profile(
                    projectDirectory.c_str(),
                    sourceProfileName.c_str(),
                    targetProfileName.c_str(),
                    defaultProfileName.empty() ? nullptr : defaultProfileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadDeleteProfile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = requiredStringField(params, L"profileName");
        const std::wstring defaultProfileName = optionalStringField(&params, L"defaultProfileName");
        return payloadFromCoreJson(
            L"core.profileDeleteFailed",
            [&projectDirectory, &profileName, &defaultProfileName](wchar_t* buffer, int length)
            {
                return fluxora_delete_profile(
                    projectDirectory.c_str(),
                    profileName.c_str(),
                    defaultProfileName.empty() ? nullptr : defaultProfileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadListExecutables(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring configPath = requiredStringField(params, L"configPath");
        return payloadFromCoreJson(
            L"core.executablesListFailed",
            [&configPath](wchar_t* buffer, int length)
            {
                return fluxora_get_game_executables(configPath.c_str(), buffer, length);
            });
    }

    std::wstring payloadSaveExecutables(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring configPath = requiredStringField(params, L"configPath");
        const std::wstring executablesJson = requiredStringField(params, L"executablesJson");
        return payloadFromCoreJson(
            L"core.executablesSaveFailed",
            [&configPath, &executablesJson](wchar_t* buffer, int length)
            {
                return fluxora_save_game_executables(
                    configPath.c_str(),
                    executablesJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadLaunchExecutable(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring configPath = requiredStringField(params, L"configPath");
        const std::wstring executableId = requiredStringField(params, L"executableId");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        return payloadFromCoreJson(
            L"core.executableLaunchFailed",
            [&configPath, &executableId, &profileName](wchar_t* buffer, int length)
            {
                return fluxora_launch_game_executable(
                    configPath.c_str(),
                    executableId.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetExecutableIcon(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring executablePath = requiredStringField(params, L"executablePath");
        std::wstring iconPath;
        const int result = callWithJsonBuffer(
            [&executablePath](wchar_t* buffer, int length)
            {
                return fluxora_get_executable_icon(executablePath.c_str(), buffer, length);
            },
            iconPath);
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.executableIconFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"iconPath", iconPath);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadListInstalledMods(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        return payloadFromCoreJson(
            L"core.modsListFailed",
            [&projectDirectory](wchar_t* buffer, int length)
            {
                return fluxora_get_installed_mods(projectDirectory.c_str(), buffer, length);
            });
    }

    std::wstring payloadGetModWorkspace(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        return payloadFromCoreJson(
            L"core.modsWorkspaceFailed",
            [&projectDirectory, &profileName](wchar_t* buffer, int length)
            {
                return fluxora_get_mod_workspace(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetPersistedModWorkspace(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        return payloadFromCoreJson(
            L"core.persistedModsWorkspaceFailed",
            [&projectDirectory, &profileName](wchar_t* buffer, int length)
            {
                return fluxora_get_persisted_mod_workspace(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadInvalidateModFileCaches(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring changedPathsJson =
            serializeStringArray(requiredStringArrayField(params, L"changedPaths"));
        return payloadFromCoreJson(
            L"core.modFileCacheInvalidationFailed",
            [&projectDirectory, &changedPathsJson](wchar_t* buffer, int length)
            {
                return fluxora_invalidate_mod_file_caches(
                    projectDirectory.c_str(),
                    changedPathsJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetModOrder(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        return payloadFromCoreJson(
            L"core.modOrderFailed",
            [&projectDirectory, &profileName](wchar_t* buffer, int length)
            {
                return fluxora_get_mod_order(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadCreateModSeparator(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring title = requiredStringField(params, L"title");
        const int targetIndex = requiredIntField(params, L"targetIndex");
        return payloadFromCoreJson(
            L"core.modSeparatorCreateFailed",
            [&projectDirectory, &profileName, &title, targetIndex](wchar_t* buffer, int length)
            {
                return fluxora_create_mod_separator(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    title.c_str(),
                    targetIndex,
                    buffer,
                    length);
            });
    }

    std::wstring payloadDeleteModSeparator(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring separatorId = requiredStringField(params, L"separatorId");
        return payloadFromCoreJson(
            L"core.modSeparatorDeleteFailed",
            [&projectDirectory, &profileName, &separatorId](wchar_t* buffer, int length)
            {
                return fluxora_delete_mod_separator(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    separatorId.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadMoveModOrderItem(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring orderItemId = requiredStringField(params, L"orderItemId");
        const int targetIndex = requiredIntField(params, L"targetIndex");
        return payloadFromCoreJson(
            L"core.modOrderMoveFailed",
            [&projectDirectory, &profileName, &orderItemId, targetIndex](wchar_t* buffer, int length)
            {
                return fluxora_move_mod_order_item(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    orderItemId.c_str(),
                    targetIndex,
                    buffer,
                    length);
            });
    }

    std::wstring payloadDeleteInstalledMod(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        const int result = fluxora_delete_installed_mod(projectDirectory.c_str(), modPath.c_str());
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.modDeleteFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"accepted", true);
        writer.field(L"modPath", modPath);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadCreateEmptyMod(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modName = requiredStringField(params, L"modName");
        return payloadFromCoreJson(
            L"core.modCreateEmptyFailed",
            [&projectDirectory, &modName](wchar_t* buffer, int length)
            {
                return fluxora_create_empty_mod(projectDirectory.c_str(), modName.c_str(), buffer, length);
            });
    }

    std::wstring payloadSetInstalledModEnabled(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        const bool isEnabled = requiredBooleanField(params, L"isEnabled");
        const int result = fluxora_set_installed_mod_enabled(
            projectDirectory.c_str(),
            modPath.c_str(),
            isEnabled ? 1 : 0);
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.modSetEnabledFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"accepted", true);
        writer.field(L"modPath", modPath);
        writer.field(L"isEnabled", isEnabled);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadSetAllInstalledModsEnabled(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const bool isEnabled = requiredBooleanField(params, L"isEnabled");
        const int result = fluxora_set_all_installed_mods_enabled(
            projectDirectory.c_str(),
            isEnabled ? 1 : 0);
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.modSetAllEnabledFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"accepted", true);
        writer.field(L"isEnabled", isEnabled);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadCheckModUpdates(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        return payloadFromCoreJson(
            L"core.modUpdatesFailed",
            [&projectDirectory](wchar_t* buffer, int length)
            {
                return fluxora_check_mod_updates(projectDirectory.c_str(), buffer, length);
            });
    }

    std::wstring payloadClearOverwriteFolder(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const int result = fluxora_clear_overwrite_folder(projectDirectory.c_str());
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.overwriteClearFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"accepted", true);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadGenerateNgioGrassCache(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring configPath = requiredStringField(params, L"configPath");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        ProgressCallbackContext progressContext{currentOperationId(request)};
        return payloadFromCoreJson(
            L"core.ngioGrassCacheFailed",
            [&configPath, &profileName, &progressContext](wchar_t* buffer, int length)
            {
                return fluxora_generate_ngio_grass_cache(
                    configPath.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    emitOperationProgress,
                    &progressContext,
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetModFileTree(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        const std::wstring relativeDirectory = optionalStringField(&params, L"relativeDirectory");
        return payloadFromCoreJson(
            L"core.modFileTreeFailed",
            [&projectDirectory, &modPath, &relativeDirectory](wchar_t* buffer, int length)
            {
                return fluxora_get_mod_file_tree(
                    projectDirectory.c_str(),
                    modPath.c_str(),
                    relativeDirectory.empty() ? nullptr : relativeDirectory.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetModDetailsContent(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        return payloadFromCoreJson(
            L"core.modDetailsContentFailed",
            [&projectDirectory, &modPath](wchar_t* buffer, int length)
            {
                return fluxora_get_mod_details_content(
                    projectDirectory.c_str(),
                    modPath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetModConflictTree(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        const std::wstring cursor = optionalStringField(&params, L"cursor");
        const int limit = optionalIntField(params, L"limit", 200);
        return payloadFromCoreJson(
            L"core.modConflictTreeFailed",
            [&projectDirectory, &modPath, &cursor, limit](wchar_t* buffer, int length)
            {
                return fluxora_get_mod_conflict_tree(
                    projectDirectory.c_str(),
                    modPath.c_str(),
                    cursor.empty() ? nullptr : cursor.c_str(),
                    limit,
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetModDetailsSummary(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        return payloadFromCoreJson(
            L"core.modDetailsSummaryFailed",
            [&projectDirectory, &profileName, &modPath](wchar_t* buffer, int length)
            {
                return fluxora_get_mod_details_summary(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    modPath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetEffectiveFileTree(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        return payloadFromCoreJson(
            L"core.effectiveFileTreeFailed",
            [&projectDirectory, &profileName](wchar_t* buffer, int length)
            {
                return fluxora_get_effective_file_tree(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetEffectiveFileTreeRoot(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const int limit = optionalIntField(params, L"limit", 250);
        return payloadFromCoreJson(
            L"core.effectiveFileTreeRootFailed",
            [&projectDirectory, &profileName, limit](wchar_t* buffer, int length)
            {
                return fluxora_get_effective_file_tree_root(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    limit,
                    buffer,
                    length);
            });
    }

    std::wstring payloadGetEffectiveFileTreeChildren(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring revision = requiredStringField(params, L"revision");
        const std::wstring relativeDirectory = optionalStringField(&params, L"relativeDirectory");
        const std::wstring cursor = optionalStringField(&params, L"cursor");
        const int limit = optionalIntField(params, L"limit", 250);
        return payloadFromCoreJson(
            L"core.effectiveFileTreeChildrenFailed",
            [&projectDirectory, &profileName, &revision, &relativeDirectory, &cursor, limit](
                wchar_t* buffer,
                int length)
            {
                return fluxora_get_effective_file_tree_children(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    revision.c_str(),
                    relativeDirectory.empty() ? nullptr : relativeDirectory.c_str(),
                    cursor.empty() ? nullptr : cursor.c_str(),
                    limit,
                    buffer,
                    length);
            });
    }

    std::wstring payloadStartNifPreview(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring initialModPath = requiredStringField(params, L"initialModPath");
        const std::wstring relativePath = requiredStringField(params, L"relativePath");
        return payloadFromCoreJson(
            L"core.nifPreviewStartFailed",
            [&projectDirectory, &profileName, &initialModPath, &relativePath](wchar_t* buffer, int length)
            {
                return fluxora_start_nif_preview(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    initialModPath.c_str(),
                    relativePath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadPrepareNifPreviewVariant(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        const std::wstring relativePath = requiredStringField(params, L"relativePath");
        return payloadFromCoreJson(
            L"core.nifPreviewVariantPrepareFailed",
            [&projectDirectory, &modPath, &relativePath](wchar_t* buffer, int length)
            {
                return fluxora_prepare_nif_preview_variant(
                    projectDirectory.c_str(),
                    modPath.c_str(),
                    relativePath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadPrepareNifPreviewTextures(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring modelModPath = requiredStringField(params, L"modelModPath");
        const std::wstring texturePathsJson = serializeStringArray(
            requiredStringArrayField(params, L"texturePaths"));
        return payloadFromCoreJson(
            L"core.nifPreviewTexturesPrepareFailed",
            [&projectDirectory, &profileName, &modelModPath, &texturePathsJson](
                wchar_t* buffer,
                int length)
            {
                return fluxora_prepare_nif_preview_textures(
                    projectDirectory.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    modelModPath.c_str(),
                    texturePathsJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadReadModTextFile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        const std::wstring relativePath = requiredStringField(params, L"relativePath");
        return payloadFromCoreJson(
            L"core.modTextFileReadFailed",
            [&projectDirectory, &modPath, &relativePath](wchar_t* buffer, int length)
            {
                return fluxora_read_mod_text_file(
                    projectDirectory.c_str(),
                    modPath.c_str(),
                    relativePath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadPreviewModTextFile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        const std::wstring relativePath = requiredStringField(params, L"relativePath");
        const int maxBytes = optionalIntField(params, L"maxBytes", 0);
        return payloadFromCoreJson(
            L"core.modTextFilePreviewFailed",
            [&projectDirectory, &modPath, &relativePath, maxBytes](wchar_t* buffer, int length)
            {
                return fluxora_preview_mod_text_file(
                    projectDirectory.c_str(),
                    modPath.c_str(),
                    relativePath.c_str(),
                    maxBytes,
                    buffer,
                    length);
            });
    }

    std::wstring payloadSaveModTextFile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring modPath = requiredStringField(params, L"modPath");
        const std::wstring relativePath = requiredStringField(params, L"relativePath");
        const std::wstring content = optionalStringField(&params, L"content");
        return payloadFromCoreJson(
            L"core.modTextFileSaveFailed",
            [&projectDirectory, &modPath, &relativePath, &content](wchar_t* buffer, int length)
            {
                return fluxora_save_mod_text_file(
                    projectDirectory.c_str(),
                    modPath.c_str(),
                    relativePath.c_str(),
                    content.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadReadTextFile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring filePath = requiredStringField(params, L"path");
        return payloadFromCoreJson(
            L"core.textFileReadFailed",
            [&filePath](wchar_t* buffer, int length)
            {
                return fluxora_read_text_file(filePath.c_str(), buffer, length);
            });
    }

    std::wstring payloadSaveTextFile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring filePath = requiredStringField(params, L"path");
        const std::wstring content = optionalStringField(&params, L"content");
        return payloadFromCoreJson(
            L"core.textFileSaveFailed",
            [&filePath, &content](wchar_t* buffer, int length)
            {
                return fluxora_save_text_file(
                    filePath.c_str(),
                    content.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadListPlugins(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring templateId = requiredStringField(params, L"templateId");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        return payloadFromCoreJson(
            L"core.pluginsListFailed",
            [&projectDirectory, &templateId, &profileName](wchar_t* buffer, int length)
            {
                return fluxora_get_plugins(
                    projectDirectory.c_str(),
                    templateId.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadListPersistedPlugins(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring templateId = requiredStringField(params, L"templateId");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        return payloadFromCoreJson(
            L"core.persistedPluginsListFailed",
            [&projectDirectory, &templateId, &profileName](wchar_t* buffer, int length)
            {
                return fluxora_get_persisted_plugins(
                    projectDirectory.c_str(),
                    templateId.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadMovePlugin(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring templateId = requiredStringField(params, L"templateId");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring orderItemId = requiredStringField(params, L"orderItemId");
        const int targetIndex = requiredIntField(params, L"targetIndex");
        return payloadFromCoreJson(
            L"core.pluginMoveFailed",
            [&projectDirectory, &templateId, &profileName, &orderItemId, targetIndex](wchar_t* buffer, int length)
            {
                return fluxora_move_plugin(
                    projectDirectory.c_str(),
                    templateId.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    orderItemId.c_str(),
                    targetIndex,
                    buffer,
                    length);
            });
    }

    std::wstring payloadCreatePluginSeparator(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring templateId = requiredStringField(params, L"templateId");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring title = requiredStringField(params, L"title");
        const int targetIndex = requiredIntField(params, L"targetIndex");
        return payloadFromCoreJson(
            L"core.pluginSeparatorCreateFailed",
            [&projectDirectory, &templateId, &profileName, &title, targetIndex](wchar_t* buffer, int length)
            {
                return fluxora_create_plugin_separator(
                    projectDirectory.c_str(),
                    templateId.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    title.c_str(),
                    targetIndex,
                    buffer,
                    length);
            });
    }

    std::wstring payloadDeletePluginSeparator(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring templateId = requiredStringField(params, L"templateId");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring separatorId = requiredStringField(params, L"separatorId");
        return payloadFromCoreJson(
            L"core.pluginSeparatorDeleteFailed",
            [&projectDirectory, &templateId, &profileName, &separatorId](wchar_t* buffer, int length)
            {
                return fluxora_delete_plugin_separator(
                    projectDirectory.c_str(),
                    templateId.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    separatorId.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadSetPluginEnabled(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring templateId = requiredStringField(params, L"templateId");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const std::wstring pluginName = requiredStringField(params, L"pluginName");
        const bool isEnabled = requiredBooleanField(params, L"isEnabled");
        return payloadFromCoreJson(
            L"core.pluginSetEnabledFailed",
            [&projectDirectory, &templateId, &profileName, &pluginName, isEnabled](wchar_t* buffer, int length)
            {
                return fluxora_set_plugin_enabled(
                    projectDirectory.c_str(),
                    templateId.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    pluginName.c_str(),
                    isEnabled ? 1 : 0,
                    buffer,
                    length);
            });
    }

    std::wstring payloadSetAllPluginsEnabled(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring templateId = requiredStringField(params, L"templateId");
        const std::wstring profileName = optionalStringField(&params, L"profileName");
        const bool isEnabled = requiredBooleanField(params, L"isEnabled");
        return payloadFromCoreJson(
            L"core.pluginsSetAllEnabledFailed",
            [&projectDirectory, &templateId, &profileName, isEnabled](wchar_t* buffer, int length)
            {
                return fluxora_set_all_plugins_enabled(
                    projectDirectory.c_str(),
                    templateId.c_str(),
                    profileName.empty() ? nullptr : profileName.c_str(),
                    isEnabled ? 1 : 0,
                    buffer,
                    length);
            });
    }

    std::wstring payloadNexusAuthStatus()
    {
        return payloadFromCoreJson(
            L"core.nexusAuthStatusFailed",
            [](wchar_t* buffer, int length)
            {
                return fluxora_get_nexusmods_auth_status(buffer, length);
            });
    }

    std::wstring payloadNexusApiAuthHeader()
    {
        return payloadFromCoreJson(
            L"core.nexusApiAuthHeaderFailed",
            [](wchar_t* buffer, int length)
            {
                return fluxora_get_nexusmods_api_auth_header(buffer, length);
            });
    }

    std::wstring payloadApiLimits()
    {
        return payloadFromCoreJson(
            L"core.apiLimitsFailed",
            [](wchar_t* buffer, int length)
            {
                return fluxora_get_api_limit_status(buffer, length);
            });
    }

    std::wstring payloadConnectNexus()
    {
        return payloadFromCoreJson(
            L"core.nexusConnectFailed",
            [](wchar_t* buffer, int length)
            {
                return fluxora_connect_nexusmods(buffer, length);
            });
    }

    std::wstring payloadConnectNexusWithApiKey(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring apiKey = requiredStringField(params, L"apiKey");
        return payloadFromCoreJson(
            L"core.nexusConnectApiKeyFailed",
            [&apiKey](wchar_t* buffer, int length)
            {
                return fluxora_connect_nexusmods_with_api_key(apiKey.c_str(), buffer, length);
            });
    }

    std::wstring payloadDisconnectNexus()
    {
        return payloadFromCoreJson(
            L"core.nexusDisconnectFailed",
            [](wchar_t* buffer, int length)
            {
                return fluxora_disconnect_nexusmods(buffer, length);
            });
    }

    void writeHostEvent(
        std::wstring_view method,
        const std::wstring& operationId,
        std::wstring_view paramsJson)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"jsonrpc", L"2.0");
        writer.field(L"method", method);
        writer.key(L"params");
        writer.numberValue(paramsJson);
        writer.key(L"meta").beginObject();
        writer.field(L"protocolVersion", protocolVersion);
        if (!operationId.empty())
        {
            writer.field(L"operationId", operationId);
        }
        writer.endObject();
        writer.endObject();

        std::cout << toUtf8(writer.str()) << '\n';
        std::cout.flush();
    }

    void FLUXORA_CORE_CALL emitOperationProgress(const wchar_t* progressJson, void* userData)
    {
        if (progressJson == nullptr)
        {
            return;
        }

        const auto* context = static_cast<ProgressCallbackContext*>(userData);
        writeHostEvent(
            L"operations.progress",
            context == nullptr ? std::wstring{} : context->operationId,
            progressJson);
    }

    std::wstring payloadAnalyzeMo2Transfer(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring sourceDirectory = requiredStringField(params, L"sourceDirectory");
        const std::wstring destinationRootDirectory = requiredStringField(params, L"destinationRootDirectory");
        const std::wstring existingConfigPath = optionalStringField(&params, L"existingConfigPath");
        return payloadFromCoreJson(
            L"core.transferAnalyzeMo2Failed",
            [&sourceDirectory, &destinationRootDirectory, &existingConfigPath](wchar_t* buffer, int length)
            {
                return fluxora_analyze_mod_organizer_instance(
                    sourceDirectory.c_str(),
                    destinationRootDirectory.c_str(),
                    existingConfigPath.empty() ? nullptr : existingConfigPath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadImportMo2Transfer(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring sourceDirectory = requiredStringField(params, L"sourceDirectory");
        const std::wstring destinationRootDirectory = requiredStringField(params, L"destinationRootDirectory");
        const std::wstring existingConfigPath = optionalStringField(&params, L"existingConfigPath");
        const bool replaceExisting = requiredBooleanField(params, L"replaceExisting");
        ProgressCallbackContext progressContext{currentOperationId(request)};

        return payloadFromCoreJson(
            L"core.transferImportMo2Failed",
            [&sourceDirectory, &destinationRootDirectory, &existingConfigPath, replaceExisting, &progressContext](
                wchar_t* buffer,
                int length)
            {
                return fluxora_import_mod_organizer_instance(
                    sourceDirectory.c_str(),
                    destinationRootDirectory.c_str(),
                    existingConfigPath.empty() ? nullptr : existingConfigPath.c_str(),
                    replaceExisting ? 1 : 0,
                    emitOperationProgress,
                    &progressContext,
                    buffer,
                    length);
            });
    }

    std::wstring payloadRegisterNxmProtocol(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring executablePath = requiredStringField(params, L"executablePath");
        return payloadFromCoreJson(
            L"core.nxmProtocolRegistrationFailed",
            [&executablePath](wchar_t* buffer, int length)
            {
                return fluxora_register_nxm_protocol(executablePath.c_str(), buffer, length);
            });
    }

    std::wstring payloadListDownloads(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        return payloadFromCoreJson(
            L"core.downloadsListFailed",
            [&projectDirectory](wchar_t* buffer, int length)
            {
                return fluxora_get_downloads(projectDirectory.c_str(), buffer, length);
            });
    }

    std::wstring payloadCaptureNxmLinks(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = optionalStringField(&params, L"projectDirectory");
        const std::wstring linksJson = serializeStringArray(requiredStringArrayField(params, L"links"));
        return payloadFromCoreJson(
            L"core.nxmCaptureFailed",
            [&projectDirectory, &linksJson](wchar_t* buffer, int length)
            {
                return fluxora_capture_nxm_links(
                    projectDirectory.c_str(),
                    linksJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadImportInboundDownloads(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        return payloadFromCoreJson(
            L"core.downloadsImportInboundFailed",
            [&projectDirectory](wchar_t* buffer, int length)
            {
                return fluxora_import_inbound_downloads(projectDirectory.c_str(), buffer, length);
            });
    }

    std::wstring payloadImportDownloadFile(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring sourcePath = requiredStringField(params, L"sourcePath");
        return payloadFromCoreJson(
            L"core.downloadImportFileFailed",
            [&projectDirectory, &sourcePath](wchar_t* buffer, int length)
            {
                return fluxora_import_download_file(
                    projectDirectory.c_str(),
                    sourcePath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadDeleteDownload(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        const int result = fluxora_delete_download(projectDirectory.c_str(), downloadPath.c_str());
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.downloadDeleteFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"accepted", true);
        writer.field(L"downloadPath", downloadPath);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadCancelDownload(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        const int result = fluxora_cancel_download(projectDirectory.c_str(), downloadPath.c_str());
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.downloadCancelFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"accepted", true);
        writer.field(L"downloadPath", downloadPath);
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadResumeDownload(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        return payloadFromCoreJson(
            L"core.downloadResumeFailed",
            [&projectDirectory, &downloadPath](wchar_t* buffer, int length)
            {
                return fluxora_resume_download(
                    projectDirectory.c_str(),
                    downloadPath.c_str(),
                    buffer,
                    length);
            });
    }

    struct BridgeInstallIdentitySelection
    {
        bool present{false};
        std::wstring resolutionId;
        int decision{1};
        std::wstring targetModUuid;
        int newNamePolicy{0};
    };

    BridgeInstallIdentitySelection optionalInstallIdentitySelection(
        const fluxora::JsonValue& params)
    {
        BridgeInstallIdentitySelection selection;
        selection.resolutionId = optionalStringField(&params, L"resolutionId");
        if (selection.resolutionId.empty())
        {
            return selection;
        }
        selection.present = true;
        const std::wstring decision = requiredStringField(params, L"identityDecision");
        if (decision == L"use-match")
        {
            selection.decision = 0;
            selection.targetModUuid = requiredStringField(params, L"targetModUuid");
        }
        else if (decision == L"install-new")
        {
            selection.decision = 1;
            selection.targetModUuid = optionalStringField(&params, L"targetModUuid");
        }
        else
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"identityDecision must be use-match or install-new.",
                ErrorCategory::Validation,
                false
            };
        }
        const std::wstring policy = requiredStringField(params, L"newNamePolicy");
        if (policy != L"first-free-copy-suffix")
        {
            throw BridgeError{
                L"bridge.invalidRequest",
                L"newNamePolicy must be first-free-copy-suffix.",
                ErrorCategory::Validation,
                false
            };
        }
        return selection;
    }

    std::wstring payloadPlanDownloadInstall(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        return payloadFromCoreJson(
            L"core.downloadInstallPlanFailed",
            [&projectDirectory, &downloadPath](wchar_t* buffer, int length)
            {
                return fluxora_plan_download_install(
                    projectDirectory.c_str(),
                    downloadPath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadPlanArchiveInstall(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring archivePath = requiredStringField(params, L"archivePath");
        return payloadFromCoreJson(
            L"core.archiveInstallPlanFailed",
            [&projectDirectory, &archivePath](wchar_t* buffer, int length)
            {
                return fluxora_plan_archive_install(
                    projectDirectory.c_str(),
                    archivePath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadInstallDownload(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        const std::wstring modName = requiredStringField(params, L"modName");
        const int existingModMode = optionalIntField(params, L"existingModMode", 0);
        const std::wstring placementOverridesJson = optionalStringField(&params, L"placementOverridesJson");
        const BridgeInstallIdentitySelection identity = optionalInstallIdentitySelection(params);
        return payloadFromCoreJson(
            L"core.downloadInstallFailed",
            [&projectDirectory, &downloadPath, &modName, existingModMode, &placementOverridesJson, &identity](
                wchar_t* buffer,
                int length)
            {
                if (identity.present)
                {
                    return fluxora_install_download_planned(
                        projectDirectory.c_str(),
                        downloadPath.c_str(),
                        modName.c_str(),
                        existingModMode,
                        placementOverridesJson.empty() ? nullptr : placementOverridesJson.c_str(),
                        identity.resolutionId.c_str(),
                        identity.decision,
                        identity.targetModUuid.empty() ? nullptr : identity.targetModUuid.c_str(),
                        identity.newNamePolicy,
                        buffer,
                        length);
                }
                return fluxora_install_download_with_layout(
                    projectDirectory.c_str(),
                    downloadPath.c_str(),
                    modName.c_str(),
                    existingModMode,
                    placementOverridesJson.empty() ? nullptr : placementOverridesJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadInstallArchive(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring archivePath = requiredStringField(params, L"archivePath");
        const std::wstring modName = requiredStringField(params, L"modName");
        const int existingModMode = optionalIntField(params, L"existingModMode", 0);
        const std::wstring placementOverridesJson = optionalStringField(&params, L"placementOverridesJson");
        const BridgeInstallIdentitySelection identity = optionalInstallIdentitySelection(params);
        return payloadFromCoreJson(
            L"core.archiveInstallFailed",
            [&projectDirectory, &archivePath, &modName, existingModMode, &placementOverridesJson, &identity](
                wchar_t* buffer,
                int length)
            {
                if (identity.present)
                {
                    return fluxora_install_archive_planned(
                        projectDirectory.c_str(),
                        archivePath.c_str(),
                        modName.c_str(),
                        existingModMode,
                        placementOverridesJson.empty() ? nullptr : placementOverridesJson.c_str(),
                        identity.resolutionId.c_str(),
                        identity.decision,
                        identity.targetModUuid.empty() ? nullptr : identity.targetModUuid.c_str(),
                        identity.newNamePolicy,
                        buffer,
                        length);
                }
                return fluxora_install_archive_with_layout(
                    projectDirectory.c_str(),
                    archivePath.c_str(),
                    modName.c_str(),
                    existingModMode,
                    placementOverridesJson.empty() ? nullptr : placementOverridesJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadAnalyzeDownloadContentLayout(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        const int existingModMode = optionalIntField(params, L"existingModMode", 0);
        return payloadFromCoreJson(
            L"core.downloadContentLayoutAnalyzeFailed",
            [&projectDirectory, &downloadPath, existingModMode](wchar_t* buffer, int length)
            {
                return fluxora_analyze_download_content_layout(
                    projectDirectory.c_str(),
                    downloadPath.c_str(),
                    existingModMode,
                    buffer,
                    length);
            });
    }

    std::wstring payloadAnalyzeFomodDownload(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        return payloadFromCoreJson(
            L"core.fomodAnalyzeFailed",
            [&projectDirectory, &downloadPath](wchar_t* buffer, int length)
            {
                return fluxora_analyze_fomod_download(
                    projectDirectory.c_str(),
                    downloadPath.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadAnalyzeFomodDownloadContentLayout(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        const int existingModMode = optionalIntField(params, L"existingModMode", 0);
        const std::wstring selectedOptionIdsJson = requiredStringField(params, L"selectedOptionIdsJson");
        return payloadFromCoreJson(
            L"core.fomodContentLayoutAnalyzeFailed",
            [&projectDirectory, &downloadPath, existingModMode, &selectedOptionIdsJson](
                wchar_t* buffer,
                int length)
            {
                return fluxora_analyze_fomod_download_content_layout(
                    projectDirectory.c_str(),
                    downloadPath.c_str(),
                    existingModMode,
                    selectedOptionIdsJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadInstallFomodDownload(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring downloadPath = requiredStringField(params, L"downloadPath");
        const std::wstring modName = requiredStringField(params, L"modName");
        const int existingModMode = optionalIntField(params, L"existingModMode", 0);
        const std::wstring selectedOptionIdsJson = requiredStringField(params, L"selectedOptionIdsJson");
        const std::wstring placementOverridesJson = optionalStringField(&params, L"placementOverridesJson");
        const BridgeInstallIdentitySelection identity = optionalInstallIdentitySelection(params);
        return payloadFromCoreJson(
            L"core.fomodDownloadInstallFailed",
            [&projectDirectory,
             &downloadPath,
             &modName,
             existingModMode,
             &selectedOptionIdsJson,
             &placementOverridesJson,
             &identity](wchar_t* buffer, int length)
            {
                if (identity.present)
                {
                    return fluxora_install_fomod_download_planned(
                        projectDirectory.c_str(),
                        downloadPath.c_str(),
                        modName.c_str(),
                        existingModMode,
                        selectedOptionIdsJson.c_str(),
                        placementOverridesJson.empty() ? nullptr : placementOverridesJson.c_str(),
                        identity.resolutionId.c_str(),
                        identity.decision,
                        identity.targetModUuid.empty() ? nullptr : identity.targetModUuid.c_str(),
                        identity.newNamePolicy,
                        buffer,
                        length);
                }
                return fluxora_install_fomod_download_with_layout(
                    projectDirectory.c_str(),
                    downloadPath.c_str(),
                    modName.c_str(),
                    existingModMode,
                    selectedOptionIdsJson.c_str(),
                    placementOverridesJson.empty() ? nullptr : placementOverridesJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadInstallFomodArchive(const BridgeRequest& request)
    {
        const fluxora::JsonValue& params = requiredParamsObject(request);
        const std::wstring projectDirectory = requiredStringField(params, L"projectDirectory");
        const std::wstring archivePath = requiredStringField(params, L"archivePath");
        const std::wstring modName = requiredStringField(params, L"modName");
        const int existingModMode = optionalIntField(params, L"existingModMode", 0);
        const std::wstring selectedOptionIdsJson = requiredStringField(params, L"selectedOptionIdsJson");
        const std::wstring placementOverridesJson = optionalStringField(&params, L"placementOverridesJson");
        const BridgeInstallIdentitySelection identity = optionalInstallIdentitySelection(params);
        return payloadFromCoreJson(
            L"core.fomodArchiveInstallFailed",
            [&projectDirectory,
             &archivePath,
             &modName,
             existingModMode,
             &selectedOptionIdsJson,
             &placementOverridesJson,
             &identity](wchar_t* buffer, int length)
            {
                if (identity.present)
                {
                    return fluxora_install_fomod_archive_planned(
                        projectDirectory.c_str(),
                        archivePath.c_str(),
                        modName.c_str(),
                        existingModMode,
                        selectedOptionIdsJson.c_str(),
                        placementOverridesJson.empty() ? nullptr : placementOverridesJson.c_str(),
                        identity.resolutionId.c_str(),
                        identity.decision,
                        identity.targetModUuid.empty() ? nullptr : identity.targetModUuid.c_str(),
                        identity.newNamePolicy,
                        buffer,
                        length);
                }
                return fluxora_install_fomod_archive_with_layout(
                    projectDirectory.c_str(),
                    archivePath.c_str(),
                    modName.c_str(),
                    existingModMode,
                    selectedOptionIdsJson.c_str(),
                    placementOverridesJson.empty() ? nullptr : placementOverridesJson.c_str(),
                    buffer,
                    length);
            });
    }

    std::wstring payloadOperationContext(const BridgeRequest& request, bool clear)
    {
        const std::wstring operationId = clear ? std::wstring{} : currentOperationId(request);
        const int result = fluxora_set_operation_context(operationId.empty() ? nullptr : operationId.c_str());
        if (result != FluxoraCoreResultOk)
        {
            throw coreError(L"core.operationContextFailed");
        }

        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"operationId", operationId);
        writer.field(L"active", !operationId.empty());
        writer.endObject();
        return writer.str();
    }

    std::wstring payloadCancelUnsupported()
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"status", L"unsupported");
        writer.field(L"accepted", false);
        writer.endObject();
        return writer.str();
    }

    std::wstring dispatch(const BridgeRequest& request, bool& shouldExit)
    {
        if (request.method == L"system.handshake")
        {
            return payloadHandshake(request);
        }
        if (request.method == L"system.initialize")
        {
            return payloadCoreStatus();
        }
        if (request.method == L"system.getCapabilities")
        {
            fluxora::JsonWriter writer;
            writeCapabilities(writer);
            return writer.str();
        }
        if (request.method == L"system.getCoreStatus")
        {
            return payloadCoreStatus();
        }
        if (request.method == L"settings.getLanguage")
        {
            return payloadLanguage();
        }
        if (request.method == L"settings.setLanguage")
        {
            return payloadSetLanguage(request);
        }
        if (request.method == L"settings.getTheme")
        {
            return payloadTheme();
        }
        if (request.method == L"settings.setTheme")
        {
            return payloadSetTheme(request);
        }
        if (request.method == L"templates.list")
        {
            return payloadTemplateList();
        }
        if (request.method == L"templates.resolve")
        {
            return payloadResolveTemplate(request);
        }
        if (request.method == L"projects.previewDirectory")
        {
            return payloadProjectDirectoryPreview(request);
        }
        if (request.method == L"projects.create")
        {
            return payloadCreateProject(request);
        }
        if (request.method == L"projects.listConfigs")
        {
            return payloadListProjectConfigs(request);
        }
        if (request.method == L"projects.openConfig")
        {
            return payloadOpenProjectConfig(request);
        }
        if (request.method == L"projects.rename")
        {
            return payloadRenameProject(request);
        }
        if (request.method == L"projects.delete")
        {
            return payloadDeleteProject(request);
        }
        if (request.method == L"buildPaths.get")
        {
            return payloadGetBuildPathSettings(request);
        }
        if (request.method == L"buildPaths.save")
        {
            return payloadSaveBuildPathSettings(request);
        }
        if (request.method == L"build.prepareWorkspaceIndexes")
        {
            return payloadPrepareWorkspaceIndexes(request);
        }
        if (request.method == L"fluxPack.export")
        {
            return payloadExportFluxPack(request);
        }
        if (request.method == L"fluxPack.inspect")
        {
            return payloadInspectFluxPack(request);
        }
        if (request.method == L"fluxPack.planInstall")
        {
            return payloadPlanFluxPackInstall(request);
        }
        if (request.method == L"fluxPack.install")
        {
            return payloadInstallFluxPack(request);
        }
        if (request.method == L"profiles.list")
        {
            return payloadListProfiles(request);
        }
        if (request.method == L"profiles.previewTextFile")
        {
            return payloadPreviewProfileTextFile(request);
        }
        if (request.method == L"profiles.create")
        {
            return payloadCreateProfile(request);
        }
        if (request.method == L"profiles.clone")
        {
            return payloadCloneProfile(request);
        }
        if (request.method == L"profiles.rename")
        {
            return payloadRenameProfile(request);
        }
        if (request.method == L"profiles.delete")
        {
            return payloadDeleteProfile(request);
        }
        if (request.method == L"executables.list")
        {
            return payloadListExecutables(request);
        }
        if (request.method == L"executables.save")
        {
            return payloadSaveExecutables(request);
        }
        if (request.method == L"executables.launch")
        {
            return payloadLaunchExecutable(request);
        }
        if (request.method == L"executables.getIcon")
        {
            return payloadGetExecutableIcon(request);
        }
        if (request.method == L"mods.listInstalled")
        {
            return payloadListInstalledMods(request);
        }
        if (request.method == L"mods.getWorkspace")
        {
            return payloadGetModWorkspace(request);
        }
        if (request.method == L"mods.getPersistedWorkspace")
        {
            return payloadGetPersistedModWorkspace(request);
        }
        if (request.method == L"mods.invalidateFileCaches")
        {
            return payloadInvalidateModFileCaches(request);
        }
        if (request.method == L"mods.getOrder")
        {
            return payloadGetModOrder(request);
        }
        if (request.method == L"mods.createSeparator")
        {
            return payloadCreateModSeparator(request);
        }
        if (request.method == L"mods.deleteSeparator")
        {
            return payloadDeleteModSeparator(request);
        }
        if (request.method == L"mods.moveOrderItem")
        {
            return payloadMoveModOrderItem(request);
        }
        if (request.method == L"mods.deleteInstalled")
        {
            return payloadDeleteInstalledMod(request);
        }
        if (request.method == L"mods.createEmpty")
        {
            return payloadCreateEmptyMod(request);
        }
        if (request.method == L"mods.setEnabled")
        {
            return payloadSetInstalledModEnabled(request);
        }
        if (request.method == L"mods.setAllEnabled")
        {
            return payloadSetAllInstalledModsEnabled(request);
        }
        if (request.method == L"mods.checkUpdates")
        {
            return payloadCheckModUpdates(request);
        }
        if (request.method == L"mods.clearOverwrite")
        {
            return payloadClearOverwriteFolder(request);
        }
        if (request.method == L"grassCache.generate")
        {
            return payloadGenerateNgioGrassCache(request);
        }
        if (request.method == L"mods.getFileTree")
        {
            return payloadGetModFileTree(request);
        }
        if (request.method == L"mods.getModDetailsContent")
        {
            return payloadGetModDetailsContent(request);
        }
        if (request.method == L"mods.getModConflictTree")
        {
            return payloadGetModConflictTree(request);
        }
        if (request.method == L"mods.getModDetailsSummary")
        {
            return payloadGetModDetailsSummary(request);
        }
        if (request.method == L"mods.getEffectiveFileTree")
        {
            return payloadGetEffectiveFileTree(request);
        }
        if (request.method == L"mods.getEffectiveFileTreeRoot")
        {
            return payloadGetEffectiveFileTreeRoot(request);
        }
        if (request.method == L"mods.getEffectiveFileTreeChildren")
        {
            return payloadGetEffectiveFileTreeChildren(request);
        }
        if (request.method == L"mods.startNifPreview")
        {
            return payloadStartNifPreview(request);
        }
        if (request.method == L"mods.prepareNifPreviewVariant")
        {
            return payloadPrepareNifPreviewVariant(request);
        }
        if (request.method == L"mods.prepareNifPreviewTextures")
        {
            return payloadPrepareNifPreviewTextures(request);
        }
        if (request.method == L"mods.readTextFile")
        {
            return payloadReadModTextFile(request);
        }
        if (request.method == L"mods.previewTextFile")
        {
            return payloadPreviewModTextFile(request);
        }
        if (request.method == L"mods.saveTextFile")
        {
            return payloadSaveModTextFile(request);
        }
        if (request.method == L"textFiles.read")
        {
            return payloadReadTextFile(request);
        }
        if (request.method == L"textFiles.save")
        {
            return payloadSaveTextFile(request);
        }
        if (request.method == L"plugins.list")
        {
            return payloadListPlugins(request);
        }
        if (request.method == L"plugins.listPersisted")
        {
            return payloadListPersistedPlugins(request);
        }
        if (request.method == L"plugins.move")
        {
            return payloadMovePlugin(request);
        }
        if (request.method == L"plugins.createSeparator")
        {
            return payloadCreatePluginSeparator(request);
        }
        if (request.method == L"plugins.deleteSeparator")
        {
            return payloadDeletePluginSeparator(request);
        }
        if (request.method == L"plugins.setEnabled")
        {
            return payloadSetPluginEnabled(request);
        }
        if (request.method == L"plugins.setAllEnabled")
        {
            return payloadSetAllPluginsEnabled(request);
        }
        if (request.method == L"nexus.getAuthStatus")
        {
            return payloadNexusAuthStatus();
        }
        if (request.method == L"nexus.getApiAuthHeader")
        {
            return payloadNexusApiAuthHeader();
        }
        if (request.method == L"apiLimits.list")
        {
            return payloadApiLimits();
        }
        if (request.method == L"nexus.connect")
        {
            return payloadConnectNexus();
        }
        if (request.method == L"nexus.connectWithApiKey")
        {
            return payloadConnectNexusWithApiKey(request);
        }
        if (request.method == L"nexus.disconnect")
        {
            return payloadDisconnectNexus();
        }
        if (request.method == L"transfer.analyzeMo2")
        {
            return payloadAnalyzeMo2Transfer(request);
        }
        if (request.method == L"transfer.importMo2")
        {
            return payloadImportMo2Transfer(request);
        }
        if (request.method == L"nxm.registerProtocol")
        {
            return payloadRegisterNxmProtocol(request);
        }
        if (request.method == L"nxm.captureLinks")
        {
            return payloadCaptureNxmLinks(request);
        }
        if (request.method == L"nxm.importInboundDownloads")
        {
            return payloadImportInboundDownloads(request);
        }
        if (request.method == L"downloads.list")
        {
            return payloadListDownloads(request);
        }
        if (request.method == L"downloads.importFile")
        {
            return payloadImportDownloadFile(request);
        }
        if (request.method == L"downloads.delete")
        {
            return payloadDeleteDownload(request);
        }
        if (request.method == L"downloads.cancel")
        {
            return payloadCancelDownload(request);
        }
        if (request.method == L"downloads.resume")
        {
            return payloadResumeDownload(request);
        }
        if (request.method == L"downloads.analyzeContentLayout")
        {
            return payloadAnalyzeDownloadContentLayout(request);
        }
        if (request.method == L"downloads.planInstall")
        {
            return payloadPlanDownloadInstall(request);
        }
        if (request.method == L"downloads.analyzeFomod")
        {
            return payloadAnalyzeFomodDownload(request);
        }
        if (request.method == L"downloads.analyzeFomodContentLayout")
        {
            return payloadAnalyzeFomodDownloadContentLayout(request);
        }
        if (request.method == L"downloads.install")
        {
            return payloadInstallDownload(request);
        }
        if (request.method == L"downloads.installFomod")
        {
            return payloadInstallFomodDownload(request);
        }
        if (request.method == L"archives.install")
        {
            return payloadInstallArchive(request);
        }
        if (request.method == L"archives.planInstall")
        {
            return payloadPlanArchiveInstall(request);
        }
        if (request.method == L"archives.installFomod")
        {
            return payloadInstallFomodArchive(request);
        }
        if (request.method == L"operations.setContext")
        {
            return payloadOperationContext(request, false);
        }
        if (request.method == L"operations.clearContext")
        {
            return payloadOperationContext(request, true);
        }
        if (request.method == L"operations.cancel")
        {
            return payloadCancelUnsupported();
        }
        if (request.method == L"system.shutdown")
        {
            shouldExit = true;
            fluxora_core_shutdown();
            fluxora::JsonWriter writer;
            writer.beginObject();
            writer.field(L"accepted", true);
            writer.endObject();
            return writer.str();
        }

        throw BridgeError{
            L"bridge.methodNotFound",
            L"Unsupported bridge method: " + request.method,
            ErrorCategory::Validation,
            false
        };
    }

    void writeMeta(fluxora::JsonWriter& writer, const std::wstring& operationId, const std::wstring& durationMs)
    {
        writer.key(L"meta").beginObject();
        writer.field(L"protocolVersion", protocolVersion);
        writer.key(L"durationMs").numberValue(durationMs);
        if (!operationId.empty())
        {
            writer.field(L"operationId", operationId);
        }
        writer.endObject();
    }

    std::wstring successResponse(
        const BridgeRequest& request,
        std::wstring_view payloadJson,
        std::chrono::steady_clock::time_point startedAt)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"jsonrpc", L"2.0");
        writer.field(L"id", request.id);
        writer.key(L"result").beginObject();
        writer.field(L"ok", true);
        writer.key(L"data");
        writer.numberValue(payloadJson);
        writer.endObject();
        writeMeta(writer, currentOperationId(request), elapsedMilliseconds(startedAt));
        writer.endObject();
        return writer.str();
    }

    std::wstring errorResponse(
        std::wstring requestId,
        std::wstring operationId,
        const BridgeError& error,
        std::chrono::steady_clock::time_point startedAt)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"jsonrpc", L"2.0");
        writer.field(L"id", requestId.empty() ? L"unknown" : requestId);
        writer.key(L"error").beginObject();
        writer.field(L"code", error.code);
        writer.field(L"message", error.message);
        writer.field(L"category", categoryLabel(error.category));
        writer.field(L"retryable", error.retryable);
        writer.key(L"capabilityId").nullValue();
        writer.key(L"details").beginObject().endObject();
        writer.endObject();
        writeMeta(writer, operationId, elapsedMilliseconds(startedAt));
        writer.endObject();
        return writer.str();
    }

    void writeResponse(const std::wstring& response)
    {
        std::cout << toUtf8(response) << '\n';
        std::cout.flush();
    }

    int runHost()
    {
        std::ios::sync_with_stdio(false);

        bool shouldExit = false;
        std::string line;
        while (!shouldExit && std::getline(std::cin, line))
        {
            if (line.empty())
            {
                continue;
            }

            const auto startedAt = std::chrono::steady_clock::now();
            std::wstring requestId;
            std::wstring operationId;

            try
            {
                const fluxora::JsonValue root = fluxora::JsonReader::parse(toWide(line));
                const BridgeRequest request = parseRequest(root);
                requestId = request.id;
                operationId = currentOperationId(request);
                validateRequestEnvelope(root, request);
                beginCoreOperation(request);

                const std::wstring payload = dispatch(request, shouldExit);
                writeResponse(successResponse(request, payload, startedAt));
            }
            catch (const BridgeError& error)
            {
                writeResponse(errorResponse(requestId, operationId, error, startedAt));
            }
            catch (const std::exception& exception)
            {
                writeResponse(errorResponse(
                    requestId,
                    operationId,
                    BridgeError{
                        L"bridge.internal",
                        toWide(exception.what()),
                        ErrorCategory::Internal,
                        false
                    },
                    startedAt));
            }

            clearCoreOperation();
        }

        fluxora_core_shutdown();
        return EXIT_SUCCESS;
    }
}

int main()
{
    return runHost();
}
