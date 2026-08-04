#include "FluxoraCore/Services/ExecutableMetadataService.hpp"

#include <algorithm>
#include <cstddef>
#include <cwchar>
#include <cwctype>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        std::wstring lower(std::wstring value)
        {
            std::transform(
                value.begin(),
                value.end(),
                value.begin(),
                [](wchar_t character)
                {
                    return static_cast<wchar_t>(std::towlower(character));
                });
            return value;
        }

        std::wstring trim(std::wstring value)
        {
            const auto isSpace = [](wchar_t character)
            {
                return character == L'\0' || std::iswspace(character) != 0;
            };
            while (!value.empty() && isSpace(value.front()))
            {
                value.erase(value.begin());
            }
            while (!value.empty() && isSpace(value.back()))
            {
                value.pop_back();
            }
            return value;
        }

        bool hasExecutableExtension(const std::filesystem::path& path)
        {
            return lower(path.extension().wstring()) == L".exe";
        }

        bool isSeparator(wchar_t character)
        {
            return character == L'_' || character == L'-' || character == L'.' ||
                std::iswspace(character) != 0;
        }

        bool isAlphabetic(const std::wstring& value)
        {
            return !value.empty() && std::all_of(
                value.begin(),
                value.end(),
                [](wchar_t character) { return std::iswalpha(character) != 0; });
        }

        bool isLowercaseAlphabetic(const std::wstring& value)
        {
            return isAlphabetic(value) && std::all_of(
                value.begin(),
                value.end(),
                [](wchar_t character) { return std::iswlower(character) != 0; });
        }

        std::vector<std::wstring> filenameTokens(std::wstring_view stem)
        {
            std::vector<std::wstring> tokens;
            std::wstring token;
            const auto flush = [&tokens, &token]()
            {
                if (!token.empty())
                {
                    tokens.push_back(std::move(token));
                    token.clear();
                }
            };

            for (wchar_t character : stem)
            {
                if (isSeparator(character))
                {
                    flush();
                    continue;
                }

                if (!token.empty())
                {
                    const wchar_t previous = token.back();
                    if ((std::iswlower(previous) != 0 && std::iswupper(character) != 0) ||
                        (std::iswalpha(previous) != 0 && std::iswdigit(character) != 0) ||
                        (std::iswdigit(previous) != 0 && std::iswalpha(character) != 0))
                    {
                        flush();
                    }
                    else if (std::iswupper(previous) != 0 &&
                             std::iswlower(character) != 0 &&
                             token.size() > 1)
                    {
                        const wchar_t nextWordStart = token.back();
                        token.pop_back();
                        flush();
                        token.push_back(nextWordStart);
                    }
                }

                token.push_back(character);
            }
            flush();
            return tokens;
        }

        bool isGenericTailMarker(const std::wstring& token)
        {
            const std::wstring normalized = lower(token);
            return normalized == L"loader" || normalized == L"launcher" ||
                normalized == L"x86" || normalized == L"x64" ||
                normalized == L"win32" || normalized == L"win64" ||
                normalized == L"32" || normalized == L"64";
        }

        std::wstring readableToken(std::wstring token)
        {
            if (!isLowercaseAlphabetic(token))
            {
                return token;
            }

            token.front() = static_cast<wchar_t>(std::towupper(token.front()));
            return token;
        }

        std::wstring readableFilename(const std::filesystem::path& executablePath)
        {
            std::vector<std::wstring> tokens = filenameTokens(executablePath.stem().wstring());
            bool removedMarker = false;
            while (tokens.size() > 1 && isGenericTailMarker(tokens.back()))
            {
                const std::wstring removed = lower(tokens.back());
                tokens.pop_back();
                removedMarker = true;
                if ((removed == L"32" || removed == L"64") &&
                    tokens.size() > 1 &&
                    (lower(tokens.back()) == L"x" || lower(tokens.back()) == L"win"))
                {
                    tokens.pop_back();
                }
            }

            if (tokens.empty())
            {
                throw std::invalid_argument("Executable filename must contain a displayable name.");
            }

            if (tokens.size() == 1 && removedMarker &&
                tokens.front().size() <= 5 && isLowercaseAlphabetic(tokens.front()))
            {
                std::wstring acronym = tokens.front();
                std::transform(
                    acronym.begin(),
                    acronym.end(),
                    acronym.begin(),
                    [](wchar_t character)
                    {
                        return static_cast<wchar_t>(std::towupper(character));
                    });
                return acronym;
            }

            std::wstring result;
            for (std::wstring& token : tokens)
            {
                if (!result.empty())
                {
                    result.push_back(L' ');
                }
                result += readableToken(std::move(token));
            }
            return result;
        }

#ifdef _WIN32
        struct VersionTranslation
        {
            WORD language;
            WORD codePage;
        };

        std::optional<std::wstring> versionString(
            const std::vector<std::byte>& versionInfo,
            const std::vector<VersionTranslation>& translations,
            std::wstring_view field)
        {
            for (const VersionTranslation& translation : translations)
            {
                wchar_t query[96]{};
                const int written = swprintf_s(
                    query,
                    L"\\StringFileInfo\\%04x%04x\\%.*s",
                    translation.language,
                    translation.codePage,
                    static_cast<int>(field.size()),
                    field.data());
                if (written <= 0)
                {
                    continue;
                }

                void* rawValue = nullptr;
                UINT valueLength = 0;
                if (VerQueryValueW(
                        const_cast<std::byte*>(versionInfo.data()),
                        query,
                        &rawValue,
                        &valueLength) == 0 ||
                    rawValue == nullptr || valueLength == 0)
                {
                    continue;
                }

                const auto* text = static_cast<const wchar_t*>(rawValue);
                std::wstring value(text, text + valueLength);
                value = trim(std::move(value));
                if (!value.empty())
                {
                    return value;
                }
            }
            return std::nullopt;
        }

        std::optional<std::pair<std::wstring, ExecutableDisplayNameSource>>
        readWindowsDisplayName(const std::filesystem::path& executablePath)
        {
            DWORD ignored = 0;
            const DWORD infoSize = GetFileVersionInfoSizeW(executablePath.c_str(), &ignored);
            if (infoSize == 0)
            {
                return std::nullopt;
            }

            std::vector<std::byte> versionInfo(infoSize);
            if (GetFileVersionInfoW(
                    executablePath.c_str(),
                    0,
                    infoSize,
                    versionInfo.data()) == 0)
            {
                return std::nullopt;
            }

            void* rawTranslations = nullptr;
            UINT translationBytes = 0;
            if (VerQueryValueW(
                    versionInfo.data(),
                    L"\\VarFileInfo\\Translation",
                    &rawTranslations,
                    &translationBytes) == 0 ||
                rawTranslations == nullptr ||
                translationBytes < sizeof(VersionTranslation))
            {
                return std::nullopt;
            }

            const auto* declared = static_cast<const VersionTranslation*>(rawTranslations);
            const std::size_t count = translationBytes / sizeof(VersionTranslation);
            std::vector<VersionTranslation> translations;
            translations.reserve(count);
            for (std::size_t index = 0; index < count; ++index)
            {
                const VersionTranslation candidate = declared[index];
                const bool duplicate = std::any_of(
                    translations.begin(),
                    translations.end(),
                    [candidate](const VersionTranslation& existing)
                    {
                        return existing.language == candidate.language &&
                            existing.codePage == candidate.codePage;
                    });
                if (!duplicate)
                {
                    translations.push_back(candidate);
                }
            }

            if (const auto description = versionString(
                    versionInfo,
                    translations,
                    L"FileDescription");
                description.has_value())
            {
                return std::pair{
                    description.value(),
                    ExecutableDisplayNameSource::FileDescription
                };
            }
            if (const auto product = versionString(
                    versionInfo,
                    translations,
                    L"ProductName");
                product.has_value())
            {
                return std::pair{
                    product.value(),
                    ExecutableDisplayNameSource::ProductName
                };
            }
            return std::nullopt;
        }
#endif
    }

    ExecutableMetadataInspection ExecutableMetadataService::inspect(
        const std::filesystem::path& executablePath) const
    {
        if (executablePath.empty())
        {
            throw std::invalid_argument("Executable path is required.");
        }
        if (!hasExecutableExtension(executablePath))
        {
            throw std::invalid_argument("Executable path must point to an .exe file.");
        }

        std::error_code error;
        if (!std::filesystem::exists(executablePath, error) || error ||
            !std::filesystem::is_regular_file(executablePath, error) || error)
        {
            throw std::invalid_argument("Executable path must point to an existing regular file.");
        }

        std::ifstream readable(executablePath, std::ios::binary);
        if (!readable)
        {
            throw std::invalid_argument("Executable file is not readable.");
        }

#ifdef _WIN32
        if (const auto metadata = readWindowsDisplayName(executablePath); metadata.has_value())
        {
            return ExecutableMetadataInspection{
                executablePath,
                metadata->first,
                metadata->second
            };
        }
#endif

        return ExecutableMetadataInspection{
            executablePath,
            readableFilename(executablePath),
            ExecutableDisplayNameSource::FileName
        };
    }
}
