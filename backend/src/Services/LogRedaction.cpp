#include "FluxoraCore/Services/LogRedaction.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <regex>

namespace fluxora
{
    namespace
    {
        constexpr std::string_view redactedSecret = "[redacted-secret]";
        constexpr std::string_view redactedQuery = "[redacted-query]";
        constexpr std::size_t maximumLogFieldBytes = 64U * 1024U;

        char asciiLower(char character) noexcept
        {
            return character >= 'A' && character <= 'Z'
                ? static_cast<char>(character - 'A' + 'a')
                : character;
        }

        bool asciiEqualsIgnoreCase(std::string_view left, std::string_view right) noexcept
        {
            if (left.size() != right.size())
            {
                return false;
            }

            for (std::size_t index = 0; index < left.size(); ++index)
            {
                if (asciiLower(left[index]) != asciiLower(right[index]))
                {
                    return false;
                }
            }
            return true;
        }

        std::size_t findAsciiIgnoreCase(
            std::string_view value,
            std::string_view needle,
            std::size_t offset = 0) noexcept
        {
            if (needle.empty() || offset > value.size() || needle.size() > value.size() - offset)
            {
                return std::string_view::npos;
            }

            for (std::size_t index = offset; index + needle.size() <= value.size(); ++index)
            {
                if (asciiEqualsIgnoreCase(value.substr(index, needle.size()), needle))
                {
                    return index;
                }
            }
            return std::string_view::npos;
        }

        bool isIdentifierCharacter(char character) noexcept
        {
            const unsigned char value = static_cast<unsigned char>(character);
            return std::isalnum(value) != 0 || character == '_' || character == '-';
        }

        bool isSecretValueTerminator(char character) noexcept
        {
            const unsigned char value = static_cast<unsigned char>(character);
            return std::isspace(value) != 0 ||
                character == '&' || character == ',' || character == ';' ||
                character == '"' || character == '\'' || character == ')' ||
                character == ']' || character == '}' || character == '#';
        }

        bool isUrlTerminator(char character) noexcept
        {
            const unsigned char value = static_cast<unsigned char>(character);
            return std::isspace(value) != 0 ||
                character == ',' || character == ';' || character == '"' ||
                character == '\'' || character == ')' || character == ']' ||
                character == '}';
        }

        std::string redactUrlQueries(std::string value)
        {
            std::size_t offset = 0;
            while (offset < value.size())
            {
                const std::size_t http = findAsciiIgnoreCase(value, "http://", offset);
                const std::size_t https = findAsciiIgnoreCase(value, "https://", offset);
                const std::size_t start = http == std::string::npos
                    ? https
                    : https == std::string::npos ? http : std::min(http, https);
                if (start == std::string::npos)
                {
                    break;
                }

                std::size_t end = start;
                while (end < value.size() && !isUrlTerminator(value[end]))
                {
                    ++end;
                }
                const std::size_t query = value.find('?', start);
                if (query != std::string::npos && query < end)
                {
                    value.replace(query + 1, end - query - 1, redactedQuery);
                    offset = query + 1 + redactedQuery.size();
                }
                else
                {
                    offset = end;
                }
            }
            return value;
        }

        std::string redactBearerTokens(std::string value)
        {
            std::size_t offset = 0;
            while (offset < value.size())
            {
                const std::size_t bearer = findAsciiIgnoreCase(value, "bearer", offset);
                if (bearer == std::string::npos)
                {
                    break;
                }
                const bool leftBoundary = bearer == 0 || !isIdentifierCharacter(value[bearer - 1]);
                const std::size_t afterBearer = bearer + std::string_view("bearer").size();
                const bool rightBoundary = afterBearer == value.size() ||
                    !isIdentifierCharacter(value[afterBearer]);
                if (!leftBoundary || !rightBoundary)
                {
                    offset = afterBearer;
                    continue;
                }

                std::size_t valueStart = afterBearer;
                while (valueStart < value.size() &&
                       std::isspace(static_cast<unsigned char>(value[valueStart])) != 0)
                {
                    ++valueStart;
                }
                std::size_t valueEnd = valueStart;
                while (valueEnd < value.size() && !isSecretValueTerminator(value[valueEnd]))
                {
                    ++valueEnd;
                }
                if (valueStart != valueEnd)
                {
                    value.replace(valueStart, valueEnd - valueStart, redactedSecret);
                    offset = valueStart + redactedSecret.size();
                }
                else
                {
                    offset = afterBearer;
                }
            }
            return value;
        }

        std::string redactNamedSecret(std::string value, std::string_view key)
        {
            std::size_t offset = 0;
            while (offset < value.size())
            {
                const std::size_t found = findAsciiIgnoreCase(value, key, offset);
                if (found == std::string::npos)
                {
                    break;
                }
                if (found > 0 && isIdentifierCharacter(value[found - 1]))
                {
                    offset = found + key.size();
                    continue;
                }

                std::size_t separator = found + key.size();
                while (separator < value.size() && value[separator] == ' ')
                {
                    ++separator;
                }
                if (separator == value.size() ||
                    (value[separator] != '=' && value[separator] != ':'))
                {
                    offset = found + key.size();
                    continue;
                }

                std::size_t valueStart = separator + 1;
                while (valueStart < value.size() && value[valueStart] == ' ')
                {
                    ++valueStart;
                }
                std::size_t valueEnd = valueStart;
                while (valueEnd < value.size() && !isSecretValueTerminator(value[valueEnd]))
                {
                    ++valueEnd;
                }
                if (valueStart == valueEnd)
                {
                    offset = valueStart;
                    continue;
                }

                value.replace(valueStart, valueEnd - valueStart, redactedSecret);
                offset = valueStart + redactedSecret.size();
            }
            return value;
        }
    }

    std::string redactSensitiveLogText(std::string_view input)
    {
        try
        {
            std::string value(input.substr(0, maximumLogFieldBytes));
            for (char& character : value)
            {
                const unsigned char byte = static_cast<unsigned char>(character);
                if (byte < 0x20U || byte == 0x7FU)
                {
                    character = ' ';
                }
            }

            value = redactUrlQueries(std::move(value));
            value = redactBearerTokens(std::move(value));
            constexpr std::array<std::string_view, 20> secretKeys{
                "authorization",
                "cookie",
                "set-cookie",
                "api_key",
                "apikey",
                "access_token",
                "refresh_token",
                "id_token",
                "authorization_code",
                "code_verifier",
                "code_challenge",
                "signed_url",
                "x-amz-credential",
                "x-amz-security-token",
                "x-amz-signature",
                "signature",
                "nonce",
                "state",
                "client_secret",
                "password"};
            for (const std::string_view key : secretKeys)
            {
                value = redactNamedSecret(std::move(value), key);
            }

            static const std::regex emailPattern(
                R"([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)",
                std::regex::ECMAScript);
            static const std::regex uuidPattern(
                R"([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12})",
                std::regex::ECMAScript);
            value = std::regex_replace(value, emailPattern, "[redacted-email]");
            value = std::regex_replace(value, uuidPattern, "[redacted-uuid]");
            if (input.size() > maximumLogFieldBytes)
            {
                value += " [truncated]";
            }
            return value;
        }
        catch (...)
        {
            return "[redaction-failed]";
        }
    }
}
