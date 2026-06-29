#include "FluxoraCore/Services/GrassCacheService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <thread>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view skyrimGameId = L"skyrimse";
        constexpr std::wstring_view precacheMarkerFileName = L"PrecacheGrass.txt";
        constexpr std::wstring_view grassFolderName = L"Grass";
        constexpr std::wstring_view grassCacheSuffix = L" \x00B7 Grass Cache";

        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        bool containsIgnoreCase(std::wstring_view value, std::wstring_view needle)
        {
            return toLower(std::wstring(value)).find(toLower(std::wstring(needle))) != std::wstring::npos;
        }

        std::wstring trim(std::wstring value)
        {
            const auto first = value.find_first_not_of(L" \t\r\n");
            if (first == std::wstring::npos)
            {
                return {};
            }

            const auto last = value.find_last_not_of(L" \t\r\n");
            return value.substr(first, last - first + 1);
        }

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

        bool hasDllMatching(
            const std::filesystem::path& directory,
            std::wstring_view requiredNamePart)
        {
            std::error_code error;
            if (!std::filesystem::is_directory(directory, error) || error)
            {
                return false;
            }

            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::directory_iterator(
                     directory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    return false;
                }
                if (!entry.is_regular_file(error) || error)
                {
                    error.clear();
                    continue;
                }

                const std::filesystem::path path = entry.path();
                if (equalsIgnoreCase(path.extension().wstring(), L".dll") &&
                    containsIgnoreCase(path.filename().wstring(), requiredNamePart))
                {
                    return true;
                }
            }

            return false;
        }

        bool hasNgioFiles(const std::filesystem::path& modDirectory)
        {
            const std::filesystem::path dataRoot = modDirectory / L"Data";
            for (const std::filesystem::path& root : {modDirectory, dataRoot})
            {
                if (hasDllMatching(root / L"NetScriptFramework" / L"Plugins", L"GrassControl"))
                {
                    return true;
                }
                if (hasDllMatching(root / L"SKSE" / L"Plugins", L"NGIO-NG"))
                {
                    return true;
                }
            }

            return false;
        }

        bool profileHasEnabledNgioMod(
            ProfileOrderService& profileOrder,
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName)
        {
            const std::vector<ProfileModOrderItem> items =
                profileOrder.listCachedModOrder(projectDirectory, profileName);
            for (const ProfileModOrderItem& item : items)
            {
                if (item.kind == L"mod" && item.isEnabled && hasNgioFiles(item.id))
                {
                    return true;
                }
            }

            return false;
        }

        std::wstring outputModName(const std::wstring& buildName)
        {
            const std::wstring trimmed = trim(buildName);
            return (trimmed.empty() ? L"Build" : trimmed) + std::wstring(grassCacheSuffix);
        }

        std::filesystem::path findGrassOutputDirectory(const std::filesystem::path& overwriteDirectory)
        {
            std::error_code error;
            if (!std::filesystem::is_directory(overwriteDirectory, error) || error)
            {
                return {};
            }

            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::directory_iterator(
                     overwriteDirectory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    return {};
                }
                if (entry.is_directory(error) &&
                    equalsIgnoreCase(entry.path().filename().wstring(), grassFolderName))
                {
                    return entry.path();
                }
                error.clear();
            }

            return {};
        }

        bool directoryHasEntries(const std::filesystem::path& directory)
        {
            std::error_code error;
            if (!std::filesystem::is_directory(directory, error) || error)
            {
                return false;
            }

            auto iterator = std::filesystem::directory_iterator(
                directory,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            if (error)
            {
                return false;
            }

            return iterator != std::filesystem::directory_iterator{};
        }

        bool grassOutputReady(const std::filesystem::path& overwriteDirectory)
        {
            const std::filesystem::path outputDirectory = findGrassOutputDirectory(overwriteDirectory);
            return !outputDirectory.empty() && directoryHasEntries(outputDirectory);
        }

        struct OutputFileCounts
        {
            int generated{0};
            int failed{0};
        };

        OutputFileCounts countGrassFiles(const std::filesystem::path& grassDirectory)
        {
            OutputFileCounts counts;
            std::error_code error;
            if (!std::filesystem::is_directory(grassDirectory, error) || error)
            {
                return counts;
            }

            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::recursive_directory_iterator(
                     grassDirectory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    break;
                }
                if (!entry.is_regular_file(error) || error)
                {
                    error.clear();
                    continue;
                }

                ++counts.generated;
                if (equalsIgnoreCase(entry.path().extension().wstring(), L".fail"))
                {
                    ++counts.failed;
                }
            }

            return counts;
        }

        bool removeDirectoryIfPresent(
            const std::filesystem::path& directory,
            std::string_view errorMessage)
        {
            std::error_code error;
            if (!std::filesystem::exists(directory, error))
            {
                return false;
            }
            if (error)
            {
                throw std::runtime_error(std::string(errorMessage));
            }

            std::filesystem::remove_all(directory, error);
            if (error)
            {
                throw std::runtime_error(std::string(errorMessage));
            }

            return true;
        }

        void writeMarkerFile(const std::filesystem::path& markerPath)
        {
            std::filesystem::create_directories(markerPath.parent_path());
            std::ofstream stream(markerPath, std::ios::binary | std::ios::trunc);
            if (!stream)
            {
                throw std::runtime_error("Could not create PrecacheGrass.txt in the game directory.");
            }
        }

        void copyDirectoryContents(
            const std::filesystem::path& source,
            const std::filesystem::path& target)
        {
            std::error_code error;
            std::filesystem::create_directories(target, error);
            if (error)
            {
                throw std::runtime_error("Could not create grass cache mod folder.");
            }

            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::recursive_directory_iterator(
                     source,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    throw std::runtime_error("Could not enumerate generated grass cache output.");
                }

                const std::filesystem::path relative = std::filesystem::relative(entry.path(), source, error);
                if (error)
                {
                    throw std::runtime_error("Could not map generated grass cache output.");
                }

                const std::filesystem::path destination = target / relative;
                if (entry.is_directory(error))
                {
                    std::filesystem::create_directories(destination, error);
                }
                else if (entry.is_regular_file(error))
                {
                    std::filesystem::create_directories(destination.parent_path(), error);
                    if (!error)
                    {
                        std::filesystem::copy_file(
                            entry.path(),
                            destination,
                            std::filesystem::copy_options::overwrite_existing,
                            error);
                    }
                }
                if (error)
                {
                    throw std::runtime_error("Could not move generated grass cache into its output mod.");
                }
            }
        }

    }

    GrassCacheService::GrassCacheService(
        Logger& logger,
        ProjectService& projects,
        ExecutableService& executables,
        ModService& mods,
        ProfileOrderService& profileOrder,
        const BuildPathSettingsService& pathSettings,
        IGrassCacheProcessRunner& runner) noexcept
        : logger_(logger),
          projects_(projects),
          executables_(executables),
          mods_(mods),
          profileOrder_(profileOrder),
          pathSettings_(pathSettings),
          runner_(runner)
    {
    }

    void GrassCacheService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        initialized_ = true;
        logger_.write(LogLevel::Info, "Grass cache service initialized.");
    }

    void GrassCacheService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        initialized_ = false;
        logger_.write(LogLevel::Info, "Grass cache service shut down.");
    }

    GrassCacheGenerationResult GrassCacheService::generateNgioGrassCache(
        const std::filesystem::path& configPath,
        std::wstring_view profileName,
        const GrassCacheGenerationOptions& options,
        const ProgressCallback& progress) const
    {
        if (configPath.empty())
        {
            throw std::invalid_argument("Build config path is required.");
        }
        if (options.maxLaunchCount <= 0)
        {
            throw std::invalid_argument("Grass cache max launch count must be positive.");
        }

        const ProjectOpenResult opened = projects_.readProjectConfigSummary(configPath);
        if (!equalsIgnoreCase(opened.resolvedTemplate.id, skyrimGameId))
        {
            throw std::invalid_argument("No Grass In Objects grass cache generation is only available for Skyrim.");
        }

        const std::filesystem::path projectDirectory = opened.project.projectDirectory;
        const std::wstring resolvedProfile = trim(std::wstring(profileName)).empty()
            ? (opened.resolvedTemplate.defaultProfileName.empty()
                   ? std::wstring(L"Default")
                   : opened.resolvedTemplate.defaultProfileName)
            : trim(std::wstring(profileName));
        if (!profileHasEnabledNgioMod(profileOrder_, projectDirectory, resolvedProfile))
        {
            throw std::invalid_argument("No Grass In Objects is not enabled in the selected profile.");
        }

        const BuildPathSettings paths = pathSettings_.loadForConfig(configPath);
        if (paths.gameDirectory.empty() || !std::filesystem::is_directory(paths.gameDirectory))
        {
            throw std::invalid_argument("Skyrim game directory is not configured.");
        }

        const std::vector<GameExecutable> executables = executables_.listProjectExecutables(configPath);
        const auto executable = std::find_if(
            executables.begin(),
            executables.end(),
            [](const GameExecutable& candidate)
            {
                return equalsIgnoreCase(candidate.id, L"script-extender") ||
                    equalsIgnoreCase(std::filesystem::path(candidate.executablePath).filename().wstring(), L"skse64_loader.exe");
            });
        if (executable == executables.end())
        {
            throw std::invalid_argument("SKSE64 executable is required for NGIO grass cache generation.");
        }

        const std::wstring extraArguments =
            containsIgnoreCase(executable->arguments, L"-forcesteamloader")
                ? std::wstring{}
                : std::wstring(L"-forcesteamloader");
        const std::filesystem::path markerPath =
            paths.gameDirectory / std::filesystem::path(std::wstring(precacheMarkerFileName));
        const std::wstring modName = outputModName(opened.project.name);
        const std::filesystem::path targetMod = paths.modsDirectory / std::filesystem::path(modName);
        const std::filesystem::path targetGrass = targetMod / std::filesystem::path(std::wstring(grassFolderName));

        const PathSafetyService safety;
        safety.validateDirectoryWriteRoot(paths.modsDirectory)
            .throwIfUnsafe("Mods directory is unsafe");
        safety.validateWritePath(paths.modsDirectory, targetMod)
            .throwIfUnsafe("Grass cache output mod path is unsafe");
        safety.validateWritePath(targetMod, targetGrass)
            .throwIfUnsafe("Grass cache output folder path is unsafe");
        safety.validateDirectoryWriteRoot(paths.overwriteDirectory)
            .throwIfUnsafe("Overwrite directory is unsafe");

        if (progress)
        {
            progress(GrassCacheGenerationProgress{
                L"preparing",
                L"Preparing NGIO grass cache generation",
                opened.project.name,
                4,
                0
            });
        }

        std::error_code cleanupError;
        std::filesystem::remove(markerPath, cleanupError);
        if (const std::filesystem::path staleSourceGrass = findGrassOutputDirectory(paths.overwriteDirectory);
            !staleSourceGrass.empty())
        {
            safety.validateWritePath(paths.overwriteDirectory, staleSourceGrass)
                .throwIfUnsafe("Stale overwrite grass cache path is unsafe");
            (void)removeDirectoryIfPresent(
                staleSourceGrass,
                "Could not remove stale overwrite grass cache output.");
            logger_.writeOperation(
                LogLevel::Info,
                "GrassCache",
                "Removed stale overwrite grass cache output before starting NGIO generation.");
        }
        if (removeDirectoryIfPresent(
                targetGrass,
                "Could not remove previous generated grass cache output."))
        {
            logger_.writeOperation(
                LogLevel::Info,
                "GrassCache",
                "Removed previous generated grass cache output before starting NGIO generation.");
        }
        writeMarkerFile(markerPath);

        int launchCount = 0;
        try
        {
            for (; launchCount < options.maxLaunchCount; ++launchCount)
            {
                if (progress)
                {
                    progress(GrassCacheGenerationProgress{
                        L"launching",
                        L"Running Skyrim through SKSE for grass cache generation",
                        executable->displayName.empty() ? executable->id : executable->displayName,
                        (std::min)(92, 8 + launchCount),
                        launchCount + 1
                    });
                }

                runner_.launchAndWait(GrassCacheLaunchSpec{
                    configPath,
                    executable->id,
                    resolvedProfile,
                    extraArguments
                });

                const bool markerStillExists = std::filesystem::exists(markerPath);
                const bool outputReady = grassOutputReady(paths.overwriteDirectory);
                if (!markerStillExists || outputReady)
                {
                    if (markerStillExists && outputReady)
                    {
                        logger_.writeOperation(
                            LogLevel::Info,
                            "GrassCache",
                            "NGIO produced grass output but left PrecacheGrass.txt in place; removing marker and finishing.");
                        std::error_code removeError;
                        std::filesystem::remove(markerPath, removeError);
                    }

                    ++launchCount;
                    break;
                }

                if (launchCount + 1 >= options.maxLaunchCount)
                {
                    throw std::runtime_error("NGIO grass cache generation did not finish before the restart limit.");
                }

                if (progress)
                {
                    progress(GrassCacheGenerationProgress{
                        L"restarting",
                        L"NGIO is still generating; restarting Skyrim",
                        markerPath.wstring(),
                        (std::min)(94, 12 + launchCount),
                        launchCount + 1
                    });
                }

                if (options.restartDelayMs > 0)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(options.restartDelayMs));
                }
            }
        }
        catch (...)
        {
            std::error_code removeError;
            std::filesystem::remove(markerPath, removeError);
            throw;
        }

        const std::filesystem::path sourceGrass = findGrassOutputDirectory(paths.overwriteDirectory);
        if (sourceGrass.empty() || !directoryHasEntries(sourceGrass))
        {
            throw std::runtime_error("NGIO finished but no overwrite Grass output was found.");
        }

        if (progress)
        {
            progress(GrassCacheGenerationProgress{
                L"collecting",
                L"Moving generated grass cache into a mod",
                modName,
                96,
                launchCount
            });
        }

        std::filesystem::create_directories(targetMod);
        std::filesystem::remove_all(targetGrass);
        copyDirectoryContents(sourceGrass, targetGrass);
        std::filesystem::remove_all(sourceGrass);

        const OutputFileCounts counts = countGrassFiles(targetGrass);
        const InstalledModRecord record = InstanceMetadataStore::registerInstalledMod(
            projectDirectory,
            targetMod,
            modName,
            {},
            ModSourceRecord{L"generated-ngio"});
        (void)record;
        (void)mods_;

        logger_.writeOperation(
            LogLevel::Info,
            "GrassCache",
            "NGIO grass cache generation completed. outputMod=\"" +
                toUtf8(modName) + "\", launches=" + std::to_string(launchCount) +
                ", generatedFiles=" + std::to_string(counts.generated) +
                ", failedFiles=" + std::to_string(counts.failed) + ".");

        if (progress)
        {
            progress(GrassCacheGenerationProgress{
                L"completed",
                L"Grass cache mod is ready",
                modName,
                100,
                launchCount
            });
        }

        return GrassCacheGenerationResult{
            true,
            modName,
            targetMod,
            launchCount,
            counts.generated,
            counts.failed
        };
    }

    bool GrassCacheService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
