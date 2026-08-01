#include "FluxoraCore/Services/ModdingFlowApiResponse.hpp"

#include <charconv>
#include <cctype>
#include <limits>
#include <stdexcept>
#include <unordered_set>

#ifdef _WIN32
#include <Windows.h>
#endif

namespace fluxora
{
    namespace
    {
        class ExactJsonValidator final
        {
        public:
            ExactJsonValidator(std::wstring_view text, ModdingFlowJsonLimits limits)
                : text_(text),
                  limits_(limits)
            {
            }

            void validate()
            {
                if (limits_.maximumDepth == 0 || limits_.maximumValues == 0 ||
                    limits_.maximumStringCodeUnits == 0)
                {
                    throw std::runtime_error("ModdingFlow JSON limits are invalid.");
                }
                parseValue(1);
                skipWhitespace();
                if (!atEnd())
                {
                    throw std::runtime_error("ModdingFlow JSON has trailing content.");
                }
            }

        private:
            void parseValue(std::size_t depth)
            {
                if (depth > limits_.maximumDepth || ++valueCount_ > limits_.maximumValues)
                {
                    throw std::runtime_error("ModdingFlow JSON exceeded structural limits.");
                }
                skipWhitespace();
                if (atEnd())
                {
                    throw std::runtime_error("ModdingFlow JSON ended unexpectedly.");
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
                    return;
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
                        throw std::runtime_error("ModdingFlow JSON contains a duplicate object member.");
                    }
                    skipWhitespace();
                    expect(L':');
                    parseValue(depth + 1);
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
                    parseValue(depth + 1);
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
                std::wstring value;
                while (!atEnd())
                {
                    wchar_t character = advance();
                    if (character == L'"')
                    {
                        return value;
                    }
                    if (character < 0x20)
                    {
                        throw std::runtime_error("ModdingFlow JSON contains a string control character.");
                    }
                    if (character == L'\\')
                    {
                        if (atEnd())
                        {
                            throw std::runtime_error("ModdingFlow JSON escape is incomplete.");
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
                            if (character >= 0xD800 && character <= 0xDBFF)
                            {
                                if (position_ + 2 > text_.size() ||
                                    text_[position_] != L'\\' || text_[position_ + 1] != L'u')
                                {
                                    throw std::runtime_error("ModdingFlow JSON has an unpaired unicode surrogate.");
                                }
                                position_ += 2;
                                const wchar_t low = parseHexCodeUnit();
                                if (low < 0xDC00 || low > 0xDFFF)
                                {
                                    throw std::runtime_error("ModdingFlow JSON has an invalid unicode surrogate pair.");
                                }
                                appendStringCodeUnit(value, character);
                                appendStringCodeUnit(value, low);
                                continue;
                            }
                            if (character >= 0xDC00 && character <= 0xDFFF)
                            {
                                throw std::runtime_error("ModdingFlow JSON has an unpaired unicode surrogate.");
                            }
                            break;
                        default:
                            throw std::runtime_error("ModdingFlow JSON escape is invalid.");
                        }
                    }
                    else if (character >= 0xD800 && character <= 0xDBFF)
                    {
                        if (atEnd())
                        {
                            throw std::runtime_error("ModdingFlow JSON has an unpaired unicode surrogate.");
                        }
                        const wchar_t low = advance();
                        if (low < 0xDC00 || low > 0xDFFF)
                        {
                            throw std::runtime_error("ModdingFlow JSON has an invalid unicode surrogate pair.");
                        }
                        appendStringCodeUnit(value, character);
                        appendStringCodeUnit(value, low);
                        continue;
                    }
                    else if (character >= 0xDC00 && character <= 0xDFFF)
                    {
                        throw std::runtime_error("ModdingFlow JSON has an unpaired unicode surrogate.");
                    }
                    appendStringCodeUnit(value, character);
                }
                throw std::runtime_error("ModdingFlow JSON string is unterminated.");
            }

            void appendStringCodeUnit(std::wstring& value, wchar_t character) const
            {
                if (value.size() >= limits_.maximumStringCodeUnits)
                {
                    throw std::runtime_error("ModdingFlow JSON string exceeded its size limit.");
                }
                value.push_back(character);
            }

            wchar_t parseHexCodeUnit()
            {
                unsigned int codeUnit = 0;
                for (int index = 0; index < 4; ++index)
                {
                    if (atEnd())
                    {
                        throw std::runtime_error("ModdingFlow JSON unicode escape is incomplete.");
                    }
                    const wchar_t digit = advance();
                    codeUnit <<= 4;
                    if (digit >= L'0' && digit <= L'9')
                    {
                        codeUnit += static_cast<unsigned int>(digit - L'0');
                    }
                    else if (digit >= L'a' && digit <= L'f')
                    {
                        codeUnit += static_cast<unsigned int>(digit - L'a' + 10);
                    }
                    else if (digit >= L'A' && digit <= L'F')
                    {
                        codeUnit += static_cast<unsigned int>(digit - L'A' + 10);
                    }
                    else
                    {
                        throw std::runtime_error("ModdingFlow JSON unicode escape is invalid.");
                    }
                }
                return static_cast<wchar_t>(codeUnit);
            }

            void parseNumber()
            {
                consume(L'-');
                if (atEnd())
                {
                    throw std::runtime_error("ModdingFlow JSON number is invalid.");
                }
                if (!consume(L'0'))
                {
                    if (peek() < L'1' || peek() > L'9')
                    {
                        throw std::runtime_error("ModdingFlow JSON value is unsupported.");
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
                    throw std::runtime_error("ModdingFlow JSON number is invalid.");
                }
            }

            void expectLiteral(std::wstring_view literal)
            {
                if (text_.substr(position_, literal.size()) != literal)
                {
                    throw std::runtime_error("ModdingFlow JSON literal is invalid.");
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
                    throw std::runtime_error("ModdingFlow JSON token is invalid.");
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
            ModdingFlowJsonLimits limits_;
            std::size_t position_{0};
            std::size_t valueCount_{0};
        };

        std::wstring decodeUtf8(std::string_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            if (value.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)()))
            {
                throw std::runtime_error("ModdingFlow JSON input is too large.");
            }
            const int inputLength = static_cast<int>(value.size());
            const int required = MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                inputLength,
                nullptr,
                0);
            if (required <= 0)
            {
                throw std::runtime_error("ModdingFlow JSON is not valid UTF-8.");
            }
            std::wstring result(static_cast<std::size_t>(required), L'\0');
            if (MultiByteToWideChar(
                    CP_UTF8,
                    MB_ERR_INVALID_CHARS,
                    value.data(),
                    inputLength,
                    result.data(),
                    required) != required)
            {
                throw std::runtime_error("ModdingFlow JSON conversion failed.");
            }
            return result;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        bool equalAsciiCaseInsensitive(std::string_view left, std::string_view right) noexcept
        {
            if (left.size() != right.size())
            {
                return false;
            }
            for (std::size_t index = 0; index < left.size(); ++index)
            {
                if (std::tolower(static_cast<unsigned char>(left[index])) !=
                    std::tolower(static_cast<unsigned char>(right[index])))
                {
                    return false;
                }
            }
            return true;
        }

        bool isProblemJson(std::string_view contentType) noexcept
        {
            const std::size_t separator = contentType.find(';');
            const std::string_view mediaType = contentType.substr(0, separator);
            return equalAsciiCaseInsensitive(mediaType, "application/problem+json");
        }

        const JsonValue& requireMember(
            const JsonValue& object,
            std::wstring_view name,
            JsonValue::Type type)
        {
            const JsonValue* value = object.find(name);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("ModdingFlow Problem Details field is invalid.");
            }
            return *value;
        }

        std::string requireString(const JsonValue& object, std::wstring_view name)
        {
            return moddingFlowJsonStringToUtf8(
                requireMember(object, name, JsonValue::Type::String).asString());
        }

        std::string optionalString(const JsonValue& object, std::wstring_view name)
        {
            const JsonValue* value = object.find(name);
            if (value == nullptr)
            {
                return {};
            }
            if (!value->isString())
            {
                throw std::runtime_error("ModdingFlow Problem Details field is invalid.");
            }
            return moddingFlowJsonStringToUtf8(value->asString());
        }

        std::uint64_t parseUnsignedInteger(const JsonValue& value)
        {
            if (!value.isNumber())
            {
                throw std::runtime_error("ModdingFlow JSON integer field is invalid.");
            }
            std::string ascii;
            for (const wchar_t character : value.asNumber())
            {
                if (character < L'0' || character > L'9')
                {
                    throw std::runtime_error("ModdingFlow JSON integer field is invalid.");
                }
                ascii.push_back(static_cast<char>(character));
            }
            std::uint64_t result = 0;
            const auto [end, error] = std::from_chars(
                ascii.data(),
                ascii.data() + ascii.size(),
                result);
            if (error != std::errc{} || end != ascii.data() + ascii.size())
            {
                throw std::runtime_error("ModdingFlow JSON integer field is invalid.");
            }
            return result;
        }
    }

    JsonValue parseModdingFlowJson(std::string_view utf8, ModdingFlowJsonLimits limits)
    {
        if (limits.maximumBytes == 0 || utf8.size() > limits.maximumBytes)
        {
            throw std::runtime_error("ModdingFlow JSON exceeded its byte limit.");
        }
        const std::wstring text = decodeUtf8(utf8);
        ExactJsonValidator(text, limits).validate();
        return JsonReader::parse(text);
    }

    std::string moddingFlowJsonStringToUtf8(std::wstring_view value)
    {
#ifdef _WIN32
        if (value.empty())
        {
            return {};
        }
        if (value.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)()))
        {
            throw std::runtime_error("ModdingFlow JSON string is too large.");
        }
        const int inputLength = static_cast<int>(value.size());
        const int required = WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            inputLength,
            nullptr,
            0,
            nullptr,
            nullptr);
        if (required <= 0)
        {
            throw std::runtime_error("ModdingFlow JSON string is invalid.");
        }
        std::string result(static_cast<std::size_t>(required), '\0');
        if (WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                inputLength,
                result.data(),
                required,
                nullptr,
                nullptr) != required)
        {
            throw std::runtime_error("ModdingFlow JSON string conversion failed.");
        }
        return result;
#else
        return std::string(value.begin(), value.end());
#endif
    }

    std::optional<ModdingFlowProblemDetails> parseModdingFlowProblemDetails(
        const ModdingFlowHttpResponse& response,
        ModdingFlowJsonLimits limits)
    {
        if (!isProblemJson(response.firstHeader("content-type")))
        {
            return std::nullopt;
        }
        const JsonValue root = parseModdingFlowJson(response.body, limits);
        if (!root.isObject())
        {
            throw std::runtime_error("ModdingFlow Problem Details body is not an object.");
        }

        ModdingFlowProblemDetails result;
        result.type = requireString(root, L"type");
        result.title = requireString(root, L"title");
        static_cast<void>(requireString(root, L"detail"));
        result.instance = requireString(root, L"instance");
        result.code = requireString(root, L"code");
        const std::uint64_t status = parseUnsignedInteger(requireMember(
            root,
            L"status",
            JsonValue::Type::Number));
        if (status == 0 || status > 599 || status != response.statusCode)
        {
            throw std::runtime_error("ModdingFlow Problem Details status is inconsistent.");
        }
        result.status = static_cast<std::uint16_t>(status);
        if (requireMember(root, L"ok", JsonValue::Type::Boolean).asBoolean())
        {
            throw std::runtime_error("ModdingFlow Problem Details ok field is invalid.");
        }

        const JsonValue& nestedError = requireMember(root, L"error", JsonValue::Type::Object);
        const std::string nestedMachineCode = requireString(nestedError, L"machine_code");
        const std::uint64_t nestedStatus = parseUnsignedInteger(requireMember(
            nestedError,
            L"http_status",
            JsonValue::Type::Number));
        static_cast<void>(requireString(nestedError, L"message"));
        const std::string nestedTraceId = requireString(nestedError, L"trace_id");
        const std::string nestedRequestId = requireString(nestedError, L"request_id");
        if (nestedStatus != status)
        {
            throw std::runtime_error("ModdingFlow Problem Details nested status is inconsistent.");
        }

        result.machineCode = optionalString(root, L"machine_code");
        if (result.machineCode.empty())
        {
            result.machineCode = nestedMachineCode;
        }
        if (result.machineCode != nestedMachineCode)
        {
            throw std::runtime_error("ModdingFlow Problem Details machine code is inconsistent.");
        }
        if (result.code != result.machineCode)
        {
            throw std::runtime_error("ModdingFlow Problem Details compatibility code is inconsistent.");
        }
        if (const JsonValue* topHttpStatus = root.find(L"http_status"); topHttpStatus != nullptr &&
            parseUnsignedInteger(*topHttpStatus) != status)
        {
            throw std::runtime_error("ModdingFlow Problem Details top-level status is inconsistent.");
        }
        result.requestId = optionalString(root, L"request_id");
        result.traceId = optionalString(root, L"trace_id");
        if (result.requestId.empty())
        {
            result.requestId = nestedRequestId;
        }
        if (result.traceId.empty())
        {
            result.traceId = nestedTraceId;
        }
        if (result.requestId != nestedRequestId || result.traceId != nestedTraceId)
        {
            throw std::runtime_error("ModdingFlow Problem Details correlation ids are inconsistent.");
        }

        if (const JsonValue* retryable = root.find(L"retryable"); retryable != nullptr)
        {
            if (retryable->type() != JsonValue::Type::Boolean)
            {
                throw std::runtime_error("ModdingFlow Problem Details retryable field is invalid.");
            }
            result.retryable = retryable->asBoolean();
        }
        if (const JsonValue* retryAfter = root.find(L"retry_after_seconds"); retryAfter != nullptr)
        {
            const std::uint64_t seconds = parseUnsignedInteger(*retryAfter);
            if (seconds > 24U * 60U * 60U)
            {
                throw std::runtime_error("ModdingFlow Problem Details retry delay is invalid.");
            }
            result.retryAfterSeconds = static_cast<std::uint32_t>(seconds);
        }
        if (const JsonValue* scopes = root.find(L"required_scopes"); scopes != nullptr)
        {
            if (!scopes->isArray() || scopes->asArray().size() > 32U)
            {
                throw std::runtime_error("ModdingFlow Problem Details scopes field is invalid.");
            }
            for (const JsonValue& scope : scopes->asArray())
            {
                if (!scope.isString())
                {
                    throw std::runtime_error("ModdingFlow Problem Details scope is invalid.");
                }
                result.requiredScopes.push_back(moddingFlowJsonStringToUtf8(scope.asString()));
            }
        }
        return result;
    }
}
