#include "FluxoraCore/Services/ConfigRecipeRegistry.hpp"

#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <filesystem>
#include <stdexcept>
#include <cwctype>

namespace fluxora
{
    namespace
    {
        std::wstring lower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::wstring trim(std::wstring value)
        {
            const auto first = std::find_if_not(value.begin(), value.end(), [](wchar_t character)
            {
                return std::iswspace(character) != 0;
            });
            const auto last = std::find_if_not(value.rbegin(), value.rend(), [](wchar_t character)
            {
                return std::iswspace(character) != 0;
            }).base();
            if (first >= last)
            {
                return {};
            }
            return std::wstring(first, last);
        }

        std::wstring decodePointerToken(std::wstring_view token)
        {
            std::wstring result;
            result.reserve(token.size());
            for (std::size_t index = 0; index < token.size(); ++index)
            {
                if (token[index] != L'~')
                {
                    result.push_back(token[index]);
                    continue;
                }
                if (index + 1 >= token.size() ||
                    (token[index + 1] != L'0' && token[index + 1] != L'1'))
                {
                    throw std::invalid_argument("JSON Pointer contains an invalid escape.");
                }
                result.push_back(token[++index] == L'0' ? L'~' : L'/');
            }
            return result;
        }

        const JsonValue& resolvePointer(const JsonValue& root, std::wstring_view pointer)
        {
            if (pointer.empty())
            {
                return root;
            }
            if (pointer.front() != L'/')
            {
                throw std::invalid_argument("JSON Pointer must start with '/'.");
            }
            const JsonValue* current = &root;
            std::size_t start = 1;
            while (start <= pointer.size())
            {
                const std::size_t end = pointer.find(L'/', start);
                const std::wstring token = decodePointerToken(pointer.substr(
                    start,
                    end == std::wstring_view::npos ? pointer.size() - start : end - start));
                if (current->isObject())
                {
                    current = current->find(token);
                    if (current == nullptr)
                    {
                        throw std::invalid_argument("JSON Pointer property was not found.");
                    }
                }
                else if (current->isArray())
                {
                    if (token.empty() || token == L"-")
                    {
                        throw std::invalid_argument("JSON Pointer array index is invalid.");
                    }
                    std::size_t consumed = 0;
                    const std::size_t index = std::stoull(token, &consumed);
                    if (consumed != token.size() || index >= current->asArray().size())
                    {
                        throw std::invalid_argument("JSON Pointer array index is out of range.");
                    }
                    current = &current->asArray()[index];
                }
                else
                {
                    throw std::invalid_argument("JSON Pointer cannot traverse a scalar value.");
                }
                if (end == std::wstring_view::npos)
                {
                    break;
                }
                start = end + 1;
            }
            return *current;
        }

        void writeJsonValue(JsonWriter& writer, const JsonValue& value)
        {
            if (value.isNull()) writer.nullValue();
            else if (value.isString()) writer.value(value.asString());
            else if (value.isNumber()) writer.numberValue(value.asNumber());
            else if (value.type() == JsonValue::Type::Boolean) writer.value(value.asBoolean());
            else if (value.isArray())
            {
                writer.beginArray();
                for (const auto& child : value.asArray()) writeJsonValue(writer, child);
                writer.endArray();
            }
            else
            {
                writer.beginObject();
                for (const auto& [key, child] : value.asObject())
                {
                    writer.key(key);
                    writeJsonValue(writer, child);
                }
                writer.endObject();
            }
        }

        std::wstring serializeJsonValue(const JsonValue& value)
        {
            JsonWriter writer;
            writeJsonValue(writer, value);
            return writer.str();
        }
    }

    ConfigRecipeInspection ConfigRecipeRegistry::inspect(
        std::wstring_view relativePath,
        std::wstring_view document,
        std::wstring_view targetPointer,
        std::wstring_view requestedValue) const
    {
        ConfigRecipeInspection result;
        const std::wstring extension = lower(
            std::filesystem::path(relativePath).extension().wstring());
        if ((extension != L".json" && extension != L".jsonc") ||
            targetPointer.empty() || requestedValue.empty())
        {
            return result;
        }

        try
        {
            const JsonValue root = JsonReader::parse(document);
            std::wstring normalizedPath = lower(std::filesystem::path(relativePath).generic_wstring());
            std::replace(normalizedPath.begin(), normalizedPath.end(), L'\\', L'/');
            std::wstring normalizedRequest = lower(trim(std::wstring(requestedValue)));
            if (normalizedRequest.size() >= 2 && normalizedRequest.front() == L'"' &&
                normalizedRequest.back() == L'"')
            {
                normalizedRequest = normalizedRequest.substr(1, normalizedRequest.size() - 2);
            }
            if (targetPointer == L"/Menu/ToggleKey" && normalizedRequest == L"pagedown" &&
                normalizedPath.ends_with(L"/skse/plugins/communityshaders/settingsuser.json"))
            {
                result.matched = true;
                result.recipeId = L"community-shaders.menu-toggle-key.v1";
                result.format = extension == L".jsonc" ? L"jsonc" : L"json";
                result.targetPointer = L"/Menu/ToggleKey";
                result.currentValue = serializeJsonValue(resolvePointer(root, targetPointer));
                result.encodedValue = L"34";
                return result;
            }
            const JsonValue replacement = JsonReader::parse(requestedValue);
            result.matched = true;
            result.recipeId = L"generic.json-pointer.v1";
            result.format = extension == L".jsonc" ? L"jsonc" : L"json";
            result.targetPointer = std::wstring(targetPointer);
            result.currentValue = serializeJsonValue(resolvePointer(root, targetPointer));
            result.encodedValue = serializeJsonValue(replacement);
        }
        catch (...)
        {
        }
        return result;
    }
}
