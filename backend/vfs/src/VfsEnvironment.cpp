#include "FluxoraVfs/VfsEnvironment.hpp"

#include <algorithm>
#include <cwctype>
#include <stdexcept>
#include <string>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora::vfs::environment
{
    namespace
    {
        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            if (left.size() != right.size())
            {
                return false;
            }

#ifdef _WIN32
            return CompareStringOrdinal(
                left.data(),
                static_cast<int>(left.size()),
                right.data(),
                static_cast<int>(right.size()),
                TRUE) == CSTR_EQUAL;
#else
            for (std::size_t index = 0; index < left.size(); ++index)
            {
                if (std::towlower(left[index]) != std::towlower(right[index]))
                {
                    return false;
                }
            }
            return true;
#endif
        }

        bool isEntryForName(std::wstring_view entry, std::wstring_view name)
        {
            const std::size_t searchFrom = !entry.empty() && entry.front() == L'=' ? 1U : 0U;
            const std::size_t separator = entry.find(L'=', searchFrom);
            return separator != std::wstring_view::npos &&
                equalsIgnoreCase(entry.substr(0, separator), name);
        }

        std::wstring_view entryName(std::wstring_view entry)
        {
            const std::size_t searchFrom = !entry.empty() && entry.front() == L'=' ? 1U : 0U;
            const std::size_t separator = entry.find(L'=', searchFrom);
            return separator == std::wstring_view::npos ? entry : entry.substr(0, separator);
        }

        int compareIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
#ifdef _WIN32
            const int comparison = CompareStringOrdinal(
                left.data(),
                static_cast<int>(left.size()),
                right.data(),
                static_cast<int>(right.size()),
                TRUE);
            if (comparison != 0)
            {
                return comparison - CSTR_EQUAL;
            }
#endif
            const std::size_t commonSize = (std::min)(left.size(), right.size());
            for (std::size_t index = 0; index < commonSize; ++index)
            {
                const wchar_t leftCharacter = std::towlower(left[index]);
                const wchar_t rightCharacter = std::towlower(right[index]);
                if (leftCharacter != rightCharacter)
                {
                    return leftCharacter < rightCharacter ? -1 : 1;
                }
            }
            if (left.size() == right.size())
            {
                return 0;
            }
            return left.size() < right.size() ? -1 : 1;
        }

        bool environmentEntryLess(const std::wstring& left, const std::wstring& right)
        {
            const bool leftIsPseudoVariable = !left.empty() && left.front() == L'=';
            const bool rightIsPseudoVariable = !right.empty() && right.front() == L'=';
            if (leftIsPseudoVariable != rightIsPseudoVariable)
            {
                return leftIsPseudoVariable;
            }
            return compareIgnoreCase(entryName(left), entryName(right)) < 0;
        }
    }

    std::vector<wchar_t> withVariable(
        const wchar_t* environmentBlock,
        std::wstring_view name,
        std::wstring_view value)
    {
        if (environmentBlock == nullptr)
        {
            throw std::invalid_argument("Environment block is required.");
        }
        if (name.empty() || name.find(L'=') != std::wstring_view::npos)
        {
            throw std::invalid_argument("Environment variable name is invalid.");
        }

        const std::wstring assignment = std::wstring(name) + L"=" + std::wstring(value);
        std::vector<std::wstring> entries;
        bool replaced = false;
        const wchar_t* cursor = environmentBlock;
        while (*cursor != L'\0')
        {
            const std::wstring_view entry(cursor);
            const bool matches = isEntryForName(entry, name);
            const std::wstring_view output = matches ? std::wstring_view(assignment) : entry;
            if (matches)
            {
                replaced = true;
            }
            entries.emplace_back(output);
            cursor += entry.size() + 1U;
        }

        if (!replaced)
        {
            entries.push_back(assignment);
        }

        // CreateProcess requires a caller-supplied environment block to be
        // alphabetically sorted. Keep the undocumented drive-current-directory
        // pseudo variables first, then sort ordinary names case-insensitively.
        std::stable_sort(entries.begin(), entries.end(), environmentEntryLess);

        std::vector<wchar_t> result;
        for (const std::wstring& entry : entries)
        {
            result.insert(result.end(), entry.begin(), entry.end());
            result.push_back(L'\0');
        }
        result.push_back(L'\0');
        if (result.size() == 1U)
        {
            result.push_back(L'\0');
        }
        return result;
    }

#ifdef _WIN32
    std::vector<wchar_t> currentWithVariable(
        std::wstring_view name,
        std::wstring_view value)
    {
        wchar_t* current = GetEnvironmentStringsW();
        if (current == nullptr)
        {
            throw std::runtime_error("Failed to read the process environment block.");
        }

        try
        {
            std::vector<wchar_t> result = withVariable(current, name, value);
            FreeEnvironmentStringsW(current);
            return result;
        }
        catch (...)
        {
            FreeEnvironmentStringsW(current);
            throw;
        }
    }
#endif
}
