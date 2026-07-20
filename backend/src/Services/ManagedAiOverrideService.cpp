#include "FluxoraCore/Services/ManagedAiOverrideService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <algorithm>
#include <cwctype>
#include <stdexcept>
#include <vector>

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

        bool sameName(std::wstring_view left, std::wstring_view right)
        {
            return lower(std::wstring(left)) == lower(std::wstring(right));
        }

        bool samePath(
            const std::filesystem::path& left,
            const std::filesystem::path& right)
        {
            std::error_code leftError;
            std::error_code rightError;
            const auto canonicalLeft = std::filesystem::weakly_canonical(left, leftError);
            const auto canonicalRight = std::filesystem::weakly_canonical(right, rightError);
            return !leftError && !rightError &&
                lower(canonicalLeft.generic_wstring()) == lower(canonicalRight.generic_wstring());
        }

        std::string narrowAscii(std::wstring_view value)
        {
            std::string result;
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                result.push_back(character >= 0 && character <= 0x7f
                    ? static_cast<char>(character)
                    : '?');
            }
            return result;
        }

        std::filesystem::path virtualPathFromModFile(
            const std::filesystem::path& sourceRoot,
            const std::filesystem::path& sourcePath)
        {
            const std::filesystem::path relative = sourcePath.lexically_relative(sourceRoot);
            if (relative.empty() || relative == L"." || relative.is_absolute())
            {
                throw std::invalid_argument("Managed override source is outside the mods root.");
            }
            auto part = relative.begin();
            if (part == relative.end())
            {
                throw std::invalid_argument("Managed override source has no mod owner.");
            }
            ++part;
            std::filesystem::path result;
            for (; part != relative.end(); ++part)
            {
                if (*part == L".." || *part == L"." || part->empty())
                {
                    throw std::invalid_argument("Managed override virtual path is invalid.");
                }
                result /= *part;
            }
            if (result.empty())
            {
                throw std::invalid_argument("Managed override virtual path is empty.");
            }
            return result.lexically_normal();
        }

        bool directoryEmpty(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::is_directory(path, error) &&
                std::filesystem::directory_iterator(path, error) == std::filesystem::directory_iterator{} &&
                !error;
        }

        void removeEmptyParents(
            std::filesystem::path current,
            const std::filesystem::path& stop)
        {
            while (!current.empty() && current != stop)
            {
                if (!directoryEmpty(current))
                {
                    return;
                }
                std::error_code error;
                std::filesystem::remove(current, error);
                if (error)
                {
                    return;
                }
                current = current.parent_path();
            }
        }
    }

    ManagedAiOverrideService::ManagedAiOverrideService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger), pathSettings_(pathSettings)
    {
    }

    ManagedAiOverridePlan ManagedAiOverrideService::plan(
        const std::filesystem::path& projectDirectory,
        std::wstring_view,
        const std::filesystem::path& sourceRoot,
        const std::filesystem::path& sourcePath) const
    {
        ManagedAiOverridePlan result;
        result.modsRoot = pathSettings_.modsDirectory(projectDirectory);
        result.virtualPath = virtualPathFromModFile(sourceRoot, sourcePath).generic_wstring();
        result.modRoot = result.modsRoot / std::filesystem::path(modName());
        result.targetPath = result.modRoot / std::filesystem::path(result.virtualPath);
        result.relativePath = std::filesystem::path(modName()).generic_wstring() + L"/" + result.virtualPath;
        PathSafetyService().validateWritePath(result.modsRoot, result.targetPath)
            .throwIfUnsafe("Fluxora AI managed override target");
        const auto installed = InstanceMetadataStore::listInstalledMods(projectDirectory, result.modsRoot);
        result.modExisted = std::any_of(installed.begin(), installed.end(), [](const auto& mod)
        {
            return sameName(mod.folderName, modName()) || sameName(mod.displayName, modName());
        });
        std::error_code existsError;
        result.targetExisted = std::filesystem::exists(result.targetPath, existsError);
        if (existsError)
        {
            throw std::runtime_error("Managed override target availability could not be checked.");
        }
        if (result.targetExisted && !samePath(result.targetPath, sourcePath))
        {
            throw std::runtime_error("Managed override target already exists; discovery must resolve it as the effective winner.");
        }
        return result;
    }

    bool ManagedAiOverrideService::activate(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        const ManagedAiOverridePlan& plan,
        std::wstring_view operationId) const
    {
        bool registeredNow = false;
        auto installed = InstanceMetadataStore::listInstalledMods(projectDirectory, plan.modsRoot);
        auto managed = std::find_if(installed.begin(), installed.end(), [](const auto& mod)
        {
            return sameName(mod.folderName, modName()) || sameName(mod.displayName, modName());
        });
        if (managed == installed.end())
        {
            static_cast<void>(InstanceMetadataStore::registerInstalledMod(
                projectDirectory,
                plan.modRoot,
                modName(),
                L"",
                ModSourceRecord{L"local"}));
            registeredNow = true;
        }
        InstanceMetadataStore::setInstalledModEnabled(projectDirectory, plan.modRoot, true);

        const std::wstring profile = profileName.empty() ? L"Default" : std::wstring(profileName);
        const auto order = InstanceMetadataStore::listCachedProfileOrderItems(
            projectDirectory,
            profile,
            plan.modsRoot);
        std::vector<ProfileOrderImportItemRecord> reordered;
        reordered.reserve(order.size() + 1);
        for (const auto& item : order)
        {
            if (item.kind == L"mod" && item.hasMod &&
                (sameName(item.mod.folderName, modName()) || sameName(item.mod.displayName, modName())))
            {
                continue;
            }
            reordered.push_back(ProfileOrderImportItemRecord{
                item.kind,
                item.kind == L"mod" && item.hasMod ? item.mod.folderName : L"",
                item.kind == L"separator" ? item.separatorTitle : L""
            });
        }
        reordered.push_back(ProfileOrderImportItemRecord{L"mod", std::wstring(modName()), L""});
        InstanceMetadataStore::replaceProfileOrderItems(projectDirectory, profile, reordered);
        logger_.writeOperation(
            LogLevel::Info,
            "AiManagedOverride",
            "Activated managed override profile layer operationId=" +
                narrowAscii(operationId));
        return registeredNow;
    }

    void ManagedAiOverrideService::cleanupAfterRollback(
        const std::filesystem::path& projectDirectory,
        const ManagedAiOverridePlan& plan,
        bool removeManagedMod,
        std::wstring_view operationId) const noexcept
    {
        try
        {
            removeEmptyParents(plan.targetPath.parent_path(), plan.modRoot);
            if (removeManagedMod && directoryEmpty(plan.modRoot))
            {
                std::error_code error;
                std::filesystem::remove(plan.modRoot, error);
                InstanceMetadataStore::deleteInstalledMod(projectDirectory, plan.modRoot);
            }
            logger_.writeOperation(
                LogLevel::Info,
                "AiManagedOverride",
                "Cleaned managed override after rollback operationId=" +
                    narrowAscii(operationId));
        }
        catch (...)
        {
        }
    }
}
