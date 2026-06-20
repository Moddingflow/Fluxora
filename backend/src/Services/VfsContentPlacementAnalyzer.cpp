#include "FluxoraCore/Services/VfsContentPlacementAnalyzer.hpp"

#include "FluxoraCore/Services/Logger.hpp"

#include <algorithm>
#include <cwctype>
#include <set>
#include <system_error>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
            return out;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::wstring toLower(std::wstring value)
        {
            std::transform(
                value.begin(),
                value.end(),
                value.begin(),
                [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
            return value;
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        bool isDirectory(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::exists(path, error) && std::filesystem::is_directory(path, error);
        }

        bool directoryHasEntries(const std::filesystem::path& path)
        {
            std::error_code error;
            if (!std::filesystem::exists(path, error) || !std::filesystem::is_directory(path, error))
            {
                return false;
            }

            std::filesystem::directory_iterator it(path, std::filesystem::directory_options::skip_permission_denied, error);
            if (error)
            {
                return false;
            }

            return it != std::filesystem::directory_iterator{};
        }

        bool extensionIn(
            const std::filesystem::path& path,
            const std::vector<NormalizedExtension>& extensions,
            const std::set<std::wstring>& extensionKeys)
        {
            const std::wstring extension =
                toAsciiLower(trimAscii(path.extension().wstring()));
            if (extension.empty())
            {
                return false;
            }
            if (!extensionKeys.empty())
            {
                return extensionKeys.contains(extension);
            }

            return std::any_of(
                extensions.begin(),
                extensions.end(),
                [&extension](const NormalizedExtension& candidate)
                {
                    return candidate.value() == extension;
                });
        }

        bool hasAnyExtension(
            const std::filesystem::path& path,
            const std::vector<std::wstring_view>& extensions)
        {
            const std::wstring extension =
                toAsciiLower(trimAscii(path.extension().wstring()));
            return std::any_of(
                extensions.begin(),
                extensions.end(),
                [&extension](std::wstring_view candidate)
                {
                    return extension == candidate;
                });
        }

        bool topLevelDirectoryIsKnownData(
            const std::wstring& name,
            const ContentLayoutSupportRules& rules)
        {
            const std::wstring key = toAsciiLower(trimAscii(name));
            if (key.empty())
            {
                return false;
            }
            if (!rules.gameDataDirectoryKeys.empty())
            {
                return rules.gameDataDirectoryKeys.contains(key);
            }

            return std::any_of(
                rules.gameDataDirectories.begin(),
                rules.gameDataDirectories.end(),
                [&key](std::wstring_view candidate)
                {
                    return toAsciiLower(trimAscii(candidate)) == key;
                });
        }

        bool topLevelDirectoryStartsScriptExtenderPath(
            const std::wstring& name,
            const ContentLayoutSupportRules& rules)
        {
            const std::wstring key = toAsciiLower(trimAscii(name));
            return std::any_of(
                rules.scriptExtenderDataPaths.begin(),
                rules.scriptExtenderDataPaths.end(),
                [&key](const std::filesystem::path& candidate)
                {
                    const auto it = candidate.begin();
                    return it != candidate.end() &&
                        toAsciiLower(trimAscii(it->wstring())) == key;
                });
        }

        bool rootFileLooksLikeDataContent(
            const std::filesystem::path& path,
            const ContentLayoutSupportRules& rules)
        {
            return extensionIn(path, rules.pluginExtensions, rules.pluginExtensionKeys) ||
                extensionIn(path, rules.archiveExtensions, rules.archiveExtensionKeys) ||
                hasAnyExtension(path, {
                    L".ini",
                    L".json",
                    L".xml",
                    L".toml",
                    L".yaml",
                    L".yml",
                    L".cfg",
                    L".conf",
                    L".ess",
                    L".skse",
                    L".fos"
                });
        }

        bool hasModRootDataSignals(
            const std::filesystem::path& mod,
            const ContentLayoutSupportRules& rules,
            const std::wstring& dataDirectory,
            const std::wstring& rootBuilderDirectoryName)
        {
            std::error_code error;
            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::directory_iterator(
                     mod,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    break;
                }

                const std::wstring name = entry.path().filename().wstring();
                if (equalsIgnoreCase(name, dataDirectory) ||
                    equalsIgnoreCase(name, rootBuilderDirectoryName) ||
                    equalsIgnoreCase(name, L".flow"))
                {
                    continue;
                }

                if (entry.is_directory(error))
                {
                    if ((topLevelDirectoryIsKnownData(name, rules) ||
                         topLevelDirectoryStartsScriptExtenderPath(name, rules) ||
                         equalsIgnoreCase(name, L"fomod")) &&
                        directoryHasEntries(entry.path()))
                    {
                        return true;
                    }
                    continue;
                }

                if (entry.is_regular_file(error) && rootFileLooksLikeDataContent(entry.path(), rules))
                {
                    return true;
                }
            }

            return false;
        }

        bool rootBuilderHasRootContent(
            const std::filesystem::path& rootBuilder,
            const std::wstring& dataDirectory)
        {
            std::error_code error;
            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::directory_iterator(
                     rootBuilder,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    break;
                }

                if (!equalsIgnoreCase(entry.path().filename().wstring(), dataDirectory))
                {
                    return true;
                }
            }

            return false;
        }
    }

    VfsContentPlacementRoots VfsContentPlacementAnalyzer::analyze(
        const std::filesystem::path& mod,
        const ContentLayoutSupportRules& rules,
        const std::wstring& dataDirectory,
        const std::wstring& rootBuilderDirectoryName,
        Logger* logger) const
    {
        VfsContentPlacementRoots roots;
        if (!directoryHasEntries(mod))
        {
            return roots;
        }

        try
        {
            roots.dataWrapper = directoryHasEntries(mod / dataDirectory);
            roots.dataAtModRoot = hasModRootDataSignals(
                mod,
                rules,
                dataDirectory,
                rootBuilderDirectoryName);

            if (!rootBuilderDirectoryName.empty())
            {
                const std::filesystem::path rootBuilder = mod / rootBuilderDirectoryName;
                if (isDirectory(rootBuilder))
                {
                    roots.rootBuilderRoot = rootBuilderHasRootContent(rootBuilder, dataDirectory);
                    roots.rootBuilderData = directoryHasEntries(rootBuilder / dataDirectory);
                }
            }
        }
        catch (const std::exception& exception)
        {
            if (logger != nullptr)
            {
                logger->write(
                    LogLevel::Warning,
                    "VFS content placement scan skipped mod \"" + toUtf8(mod.wstring()) +
                        "\": " + exception.what());
            }
        }

        return roots;
    }
}
