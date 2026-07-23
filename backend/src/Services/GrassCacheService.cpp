#include "FluxoraCore/Services/GrassCacheService.hpp"

#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cwctype>
#include <filesystem>
#include <functional>
#include <fstream>
#include <limits>
#include <optional>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <tlhelp32.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view skyrimGameId = L"skyrimse";
        constexpr std::wstring_view precacheMarkerFileName = L"PrecacheGrass.txt";
        constexpr std::wstring_view grassFolderName = L"Grass";
        constexpr std::wstring_view grassCacheSuffix = L" \x00B7 Grass Cache";
        constexpr std::chrono::milliseconds cancellationPollInterval{250};

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

#ifdef _WIN32
        std::wstring readEnvironmentVariable(const wchar_t* name)
        {
            const DWORD requiredLength = GetEnvironmentVariableW(name, nullptr, 0);
            if (requiredLength == 0)
            {
                return {};
            }

            std::wstring value(requiredLength, L'\0');
            const DWORD actualLength = GetEnvironmentVariableW(name, value.data(), requiredLength);
            if (actualLength == 0 || actualLength >= requiredLength)
            {
                return {};
            }

            value.resize(actualLength);
            return value;
        }
#endif

        std::filesystem::path operationCancellationDirectory()
        {
#ifdef _WIN32
            if (const std::wstring configured = readEnvironmentVariable(L"FLUXORA_OPERATION_CANCEL_DIR");
                !configured.empty())
            {
                return std::filesystem::path(configured);
            }
            if (const std::wstring logs = readEnvironmentVariable(L"FLUXORA_LOG_DIR"); !logs.empty())
            {
                return std::filesystem::path(logs) / L"operation-cancel";
            }
#else
            if (const char* configured = std::getenv("FLUXORA_OPERATION_CANCEL_DIR");
                configured != nullptr && configured[0] != '\0')
            {
                return std::filesystem::path(configured);
            }
            if (const char* logs = std::getenv("FLUXORA_LOG_DIR"); logs != nullptr && logs[0] != '\0')
            {
                return std::filesystem::path(logs) / "operation-cancel";
            }
#endif

            return {};
        }

        std::string operationMarkerFileName(std::string_view operationId)
        {
            std::string safe;
            safe.reserve(operationId.size() + 7);
            for (const char character : operationId)
            {
                const unsigned char value = static_cast<unsigned char>(character);
                if (std::isalnum(value) != 0 || character == '_' || character == '-' || character == '.')
                {
                    safe.push_back(character);
                }
                else
                {
                    safe.push_back('_');
                }
            }

            if (safe.empty())
            {
                return {};
            }

            safe += ".cancel";
            return safe;
        }

        std::filesystem::path operationCancellationMarkerPath(std::string_view operationId)
        {
            const std::filesystem::path directory = operationCancellationDirectory();
            const std::string fileName = operationMarkerFileName(operationId);
            if (directory.empty() || fileName.empty())
            {
                return {};
            }

            return directory / std::filesystem::path(fileName);
        }

        bool markerExists(const std::filesystem::path& path)
        {
            if (path.empty())
            {
                return false;
            }

            std::error_code error;
            return std::filesystem::exists(path, error);
        }

        std::optional<std::uint32_t> parseProcessId(std::wstring_view value)
        {
            if (value.empty())
            {
                return std::nullopt;
            }

            try
            {
                std::size_t consumed = 0;
                const unsigned long parsed = std::stoul(std::wstring(value), &consumed, 10);
                if (consumed != value.size() ||
                    parsed == 0 ||
                    parsed > (std::numeric_limits<std::uint32_t>::max)())
                {
                    return std::nullopt;
                }

                return static_cast<std::uint32_t>(parsed);
            }
            catch (...)
            {
                return std::nullopt;
            }
        }

        std::optional<std::uint32_t> tauriProcessIdFromEnvironment()
        {
#ifdef _WIN32
            return parseProcessId(readEnvironmentVariable(L"FLUXORA_TAURI_PROCESS_ID"));
#else
            const char* value = std::getenv("FLUXORA_TAURI_PROCESS_ID");
            if (value == nullptr || value[0] == '\0')
            {
                return std::nullopt;
            }

            std::wstring wide;
            while (*value != '\0')
            {
                wide.push_back(static_cast<unsigned char>(*value));
                ++value;
            }
            return parseProcessId(wide);
#endif
        }

        bool processHasExited(std::uint32_t processId)
        {
            if (processId == 0)
            {
                return false;
            }

#ifdef _WIN32
            HANDLE handle = OpenProcess(SYNCHRONIZE, FALSE, processId);
            if (handle == nullptr)
            {
                HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
                if (snapshot == INVALID_HANDLE_VALUE)
                {
                    return true;
                }

                PROCESSENTRY32W entry{};
                entry.dwSize = sizeof(entry);
                BOOL hasEntry = Process32FirstW(snapshot, &entry);
                while (hasEntry)
                {
                    if (static_cast<std::uint32_t>(entry.th32ProcessID) == processId)
                    {
                        CloseHandle(snapshot);
                        return false;
                    }

                    hasEntry = Process32NextW(snapshot, &entry);
                }

                CloseHandle(snapshot);
                return true;
            }

            const DWORD waitResult = WaitForSingleObject(handle, 0);
            CloseHandle(handle);
            return waitResult != WAIT_TIMEOUT;
#else
            return !std::filesystem::exists(std::filesystem::path("/proc") / std::to_string(processId));
#endif
        }

        void throwIfCancellationRequested(const std::function<bool()>& cancellationRequested)
        {
            if (cancellationRequested && cancellationRequested())
            {
                throw std::runtime_error("NGIO grass cache generation was canceled.");
            }
        }

        void sleepWithCancellation(
            std::chrono::milliseconds duration,
            const std::function<bool()>& cancellationRequested)
        {
            const auto deadline = std::chrono::steady_clock::now() + duration;
            while (std::chrono::steady_clock::now() < deadline)
            {
                throwIfCancellationRequested(cancellationRequested);
                const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
                    deadline - std::chrono::steady_clock::now());
                std::this_thread::sleep_for((std::min)(remaining, cancellationPollInterval));
            }
            throwIfCancellationRequested(cancellationRequested);
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

        struct OutputFileCounts
        {
            int generated{0};
            int cgid{0};
            int failed{0};
        };

        struct NgioLogProgress
        {
            std::wstring currentItem;
            int overallPercent{0};
            int worldIndex{0};
            int worldCount{0};
        };

        struct GrassCacheProgressTracker
        {
            std::uintmax_t markerOffset{0};
            int completedCellCount{0};
            int lastReportedPercent{-1};
            int lastReportedCellCount{-1};
            std::wstring lastReportedItem;

            void refreshMarker(const std::filesystem::path& markerPath)
            {
                std::error_code sizeError;
                const std::uintmax_t size = std::filesystem::file_size(markerPath, sizeError);
                if (sizeError)
                {
                    return;
                }
                if (size < markerOffset)
                {
                    markerOffset = 0;
                    completedCellCount = 0;
                }
                if (size == markerOffset)
                {
                    return;
                }

                std::ifstream input(markerPath, std::ios::binary);
                if (!input)
                {
                    return;
                }
                input.seekg(static_cast<std::streamoff>(markerOffset), std::ios::beg);
                std::string line;
                while (std::getline(input, line))
                {
                    if (line.rfind("cell_", 0) == 0)
                    {
                        ++completedCellCount;
                    }
                }
                markerOffset = size;
            }
        };

        std::wstring safeVfsPathSegment(std::wstring value, std::wstring_view fallback)
        {
            static constexpr std::wstring_view invalid = L"<>:\"/\\|?*";
            for (wchar_t& character : value)
            {
                if (character < 32 || invalid.find(character) != std::wstring_view::npos)
                {
                    character = L'_';
                }
            }
            while (!value.empty() && (value.back() == L'.' || value.back() == L' '))
            {
                value.pop_back();
            }
            return value.empty() ? std::wstring(fallback) : value;
        }

        std::optional<NgioLogProgress> parseNgioLogProgressLine(const std::string& line)
        {
            static constexpr std::string_view messagePrefix = "Generating grass for ";
            static constexpr std::string_view percentMarker = " pct, world ";
            static constexpr std::string_view worldCountMarker = " out of ";

            const std::size_t messageStart = line.rfind(messagePrefix);
            if (messageStart == std::string::npos)
            {
                return std::nullopt;
            }
            const std::size_t itemStart = messageStart + messagePrefix.size();
            const std::size_t percentEnd = line.find(percentMarker, itemStart);
            if (percentEnd == std::string::npos || percentEnd == 0)
            {
                return std::nullopt;
            }
            const std::size_t percentStart = line.rfind(' ', percentEnd - 1);
            if (percentStart == std::string::npos || percentStart < itemStart)
            {
                return std::nullopt;
            }
            const std::size_t worldIndexStart = percentEnd + percentMarker.size();
            const std::size_t worldIndexEnd = line.find(worldCountMarker, worldIndexStart);
            if (worldIndexEnd == std::string::npos)
            {
                return std::nullopt;
            }
            const std::size_t worldCountStart = worldIndexEnd + worldCountMarker.size();

            try
            {
                const double worldPercent = std::stod(
                    line.substr(percentStart + 1, percentEnd - percentStart - 1));
                const int worldIndex = std::stoi(
                    line.substr(worldIndexStart, worldIndexEnd - worldIndexStart));
                const int worldCount = std::stoi(line.substr(worldCountStart));
                if (worldIndex <= 0 || worldCount <= 0 || worldIndex > worldCount)
                {
                    return std::nullopt;
                }

                const double overall =
                    ((static_cast<double>(worldIndex - 1) * 100.0) +
                     (std::max)(0.0, (std::min)(100.0, worldPercent))) /
                    static_cast<double>(worldCount);
                const std::string item =
                    line.substr(itemStart, percentStart - itemStart);
                return NgioLogProgress{
                    std::wstring(item.begin(), item.end()),
                    static_cast<int>(std::lround(overall)),
                    worldIndex,
                    worldCount
                };
            }
            catch (...)
            {
                return std::nullopt;
            }
        }

        std::optional<NgioLogProgress> readLatestNgioLogProgress(
            const std::filesystem::path& logPath)
        {
            constexpr std::streamoff maxTailBytes = 256 * 1024;
            std::ifstream input(logPath, std::ios::binary);
            if (!input)
            {
                return std::nullopt;
            }

            input.seekg(0, std::ios::end);
            const std::streamoff end = input.tellg();
            if (end <= 0)
            {
                return std::nullopt;
            }
            const std::streamoff start = (std::max)(std::streamoff{0}, end - maxTailBytes);
            input.seekg(start, std::ios::beg);
            std::string tail(static_cast<std::size_t>(end - start), '\0');
            input.read(tail.data(), static_cast<std::streamsize>(tail.size()));
            tail.resize(static_cast<std::size_t>(input.gcount()));

            std::size_t lineEnd = tail.size();
            while (lineEnd > 0)
            {
                const std::size_t newline =
                    tail.rfind('\n', lineEnd == 0 ? 0 : lineEnd - 1);
                const std::size_t lineStart =
                    newline == std::string::npos ? 0 : newline + 1;
                std::string line = tail.substr(lineStart, lineEnd - lineStart);
                if (!line.empty() && line.back() == '\r')
                {
                    line.pop_back();
                }
                if (const auto parsed = parseNgioLogProgressLine(line); parsed.has_value())
                {
                    return parsed;
                }
                if (newline == std::string::npos)
                {
                    break;
                }
                lineEnd = newline;
            }
            return std::nullopt;
        }

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
                const std::wstring extension = entry.path().extension().wstring();
                if (equalsIgnoreCase(extension, L".cgid"))
                {
                    ++counts.cgid;
                }
                else if (equalsIgnoreCase(extension, L".fail"))
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

        bool removeFileIfPresent(
            const std::filesystem::path& path,
            std::string_view errorMessage)
        {
            std::error_code error;
            if (!std::filesystem::exists(path, error))
            {
                return false;
            }
            if (error)
            {
                throw std::runtime_error(std::string(errorMessage));
            }

            std::filesystem::remove(path, error);
            if (error)
            {
                throw std::runtime_error(std::string(errorMessage));
            }

            return true;
        }

        std::wstring ngioRootBuilderDirectoryName(std::wstring_view gameId)
        {
            const GameSupportLookupResult lookup = GameSupportRegistry::embedded().lookupById(gameId);
            if (lookup.supported &&
                lookup.definition != nullptr &&
                lookup.definition->vfsRules.supportsRootBuilder &&
                !lookup.definition->vfsRules.rootBuilderDirectoryName.empty())
            {
                return lookup.definition->vfsRules.rootBuilderDirectoryName;
            }

            return L"root";
        }

        void appendRootLaunchPrecacheMarkers(
            std::vector<std::filesystem::path>& markers,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& rootLaunchDirectory)
        {
            const PathSafetyService pathSafety;
            if (!pathSafety.validateContainedPath(projectDirectory, rootLaunchDirectory).safe())
            {
                return;
            }

            std::error_code error;
            if (!std::filesystem::is_directory(rootLaunchDirectory, error) || error)
            {
                return;
            }

            // Root-launch overlays are stored as direct child directories and
            // each child is mounted at the game root. Only a marker directly
            // inside such a child can surface as game-root PrecacheGrass.txt;
            // recursively walking copied cache contents is unnecessary launch
            // I/O and can be very large.
            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::directory_iterator(
                     rootLaunchDirectory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    return;
                }

                if (entry.is_directory(error))
                {
                    const std::filesystem::path marker =
                        entry.path() /
                        std::filesystem::path(std::wstring(precacheMarkerFileName));
                    if (pathSafety.validateContainedPath(rootLaunchDirectory, marker).safe() &&
                        pathSafety.validateContainedPath(projectDirectory, marker).safe())
                    {
                        markers.push_back(marker);
                    }
                }
                error.clear();
            }
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

        shutdownRequested_.store(false, std::memory_order_relaxed);
        initialized_ = true;
        logger_.write(LogLevel::Info, "Grass cache service initialized.");
    }

    void GrassCacheService::shutdown()
    {
        shutdownRequested_.store(true, std::memory_order_relaxed);
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
        const std::wstring rootBuilderDirectoryName =
            ngioRootBuilderDirectoryName(opened.resolvedTemplate.id);
        const std::filesystem::path markerPath =
            paths.overwriteDirectory /
            std::filesystem::path(rootBuilderDirectoryName) /
            std::filesystem::path(std::wstring(precacheMarkerFileName));
        const std::wstring modName = outputModName(opened.project.name);
        const std::filesystem::path targetMod = paths.modsDirectory / std::filesystem::path(modName);
        const std::filesystem::path targetGrass = targetMod / std::filesystem::path(std::wstring(grassFolderName));
        const std::filesystem::path cancellationMarker =
            operationCancellationMarkerPath(Logger::operationId());
        const std::filesystem::path ngioLogPath =
            projectDirectory /
            std::filesystem::path(L".flow") /
            std::filesystem::path(L"vfs") /
            std::filesystem::path(L"profile-overwrite") /
            std::filesystem::path(safeVfsPathSegment(resolvedProfile, L"Default")) /
            std::filesystem::path(L"documents") /
            std::filesystem::path(L"SKSE") /
            std::filesystem::path(L"NGIO-NG.log");
        const std::optional<std::uint32_t> tauriProcessId = tauriProcessIdFromEnvironment();
        const std::function<bool()> cancellationRequested =
            [this, cancellationMarker, tauriProcessId]()
            {
                return shutdownRequested_.load(std::memory_order_relaxed) ||
                    markerExists(cancellationMarker) ||
                    (tauriProcessId.has_value() && processHasExited(*tauriProcessId));
            };

        const PathSafetyService safety;
        safety.validateDirectoryWriteRoot(paths.modsDirectory)
            .throwIfUnsafe("Mods directory is unsafe");
        safety.validateWritePath(paths.modsDirectory, targetMod)
            .throwIfUnsafe("Grass cache output mod path is unsafe");
        safety.validateWritePath(targetMod, targetGrass)
            .throwIfUnsafe("Grass cache output folder path is unsafe");
        safety.validateDirectoryWriteRoot(paths.overwriteDirectory)
            .throwIfUnsafe("Overwrite directory is unsafe");
        safety.validateWritePath(paths.overwriteDirectory, markerPath)
            .throwIfUnsafe("Grass cache trigger path is unsafe");

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

        throwIfCancellationRequested(cancellationRequested);
        (void)clearStaleNgioPrecacheMarkersForLaunch(configPath);
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
        const std::filesystem::path lowerMarkerWhiteout =
            projectDirectory /
            std::filesystem::path(L".flow") /
            std::filesystem::path(L"vfs") /
            std::filesystem::path(L"whiteouts") /
            std::filesystem::path(L"game-root") /
            std::filesystem::path(std::wstring(precacheMarkerFileName));
        logger_.writeOperation(
            LogLevel::Info,
            "GrassCache",
            "Published NGIO trigger in the VFS root overlay. markerPath=\"" +
                toUtf8(markerPath.wstring()) +
                "\", lowerGameRootWhiteoutExists=" +
                std::to_string(std::filesystem::exists(lowerMarkerWhiteout) ? 1 : 0) + ".");

        int launchCount = 0;
        GrassCacheProgressTracker progressTracker;
        std::error_code initialLogTimeError;
        const std::filesystem::file_time_type initialLogWriteTime =
            std::filesystem::last_write_time(ngioLogPath, initialLogTimeError);
        std::error_code initialLogSizeError;
        const std::uintmax_t initialLogSize =
            std::filesystem::file_size(ngioLogPath, initialLogSizeError);
        try
        {
            for (; launchCount < options.maxLaunchCount; ++launchCount)
            {
                throwIfCancellationRequested(cancellationRequested);
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

                const auto reportNgioActivity =
                    [&, currentLaunch = launchCount + 1]()
                    {
                        if (!progress)
                        {
                            return;
                        }

                        progressTracker.refreshMarker(markerPath);

                        std::error_code currentLogTimeError;
                        const std::filesystem::file_time_type currentLogWriteTime =
                            std::filesystem::last_write_time(ngioLogPath, currentLogTimeError);
                        std::error_code currentLogSizeError;
                        const std::uintmax_t currentLogSize =
                            std::filesystem::file_size(ngioLogPath, currentLogSizeError);
                        const bool logChanged =
                            initialLogTimeError ||
                            initialLogSizeError ||
                            (!currentLogTimeError &&
                             !currentLogSizeError &&
                             (currentLogWriteTime != initialLogWriteTime ||
                              currentLogSize != initialLogSize));
                        const std::optional<NgioLogProgress> ngioProgress =
                            logChanged
                                ? readLatestNgioLogProgress(ngioLogPath)
                                : std::nullopt;
                        if (!ngioProgress.has_value() &&
                            progressTracker.completedCellCount <= 0)
                        {
                            return;
                        }

                        const int parsedOperationPercent = ngioProgress.has_value()
                            ? (std::min)(94, (std::max)(8, ngioProgress->overallPercent))
                            : (std::max)(8, progressTracker.lastReportedPercent);
                        const int operationPercent =
                            (std::max)(
                                parsedOperationPercent,
                                progressTracker.lastReportedPercent);
                        const std::wstring currentItem = ngioProgress.has_value()
                            ? ngioProgress->currentItem
                            : L"Completed cells: " +
                                std::to_wstring(progressTracker.completedCellCount);
                        const std::wstring currentStep = ngioProgress.has_value()
                            ? L"NGIO grass generation: " +
                                std::to_wstring(ngioProgress->overallPercent) +
                                L"% · world " +
                                std::to_wstring(ngioProgress->worldIndex) +
                                L" of " +
                                std::to_wstring(ngioProgress->worldCount) +
                                L" · completed cells: " +
                                std::to_wstring(progressTracker.completedCellCount)
                            : L"NGIO grass generation · completed cells: " +
                                std::to_wstring(progressTracker.completedCellCount);
                        if (operationPercent == progressTracker.lastReportedPercent &&
                            progressTracker.completedCellCount ==
                                progressTracker.lastReportedCellCount &&
                            currentItem == progressTracker.lastReportedItem)
                        {
                            return;
                        }

                        progressTracker.lastReportedPercent = operationPercent;
                        progressTracker.lastReportedCellCount =
                            progressTracker.completedCellCount;
                        progressTracker.lastReportedItem = currentItem;
                        progress(GrassCacheGenerationProgress{
                            L"generating",
                            currentStep,
                            currentItem,
                            operationPercent,
                            currentLaunch
                        });
                    };

                const GrassCacheLaunchResult launchResult =
                    runner_.launchAndWait(
                        GrassCacheLaunchSpec{
                            configPath,
                            executable->id,
                            resolvedProfile,
                            extraArguments
                        },
                        cancellationRequested,
                        reportNgioActivity);
                throwIfCancellationRequested(cancellationRequested);

                const std::filesystem::path sourceGrass =
                    findGrassOutputDirectory(paths.overwriteDirectory);
                const OutputFileCounts launchCounts = countGrassFiles(sourceGrass);
                const bool outputReady =
                    !sourceGrass.empty() && directoryHasEntries(sourceGrass);
                const bool managedMarkerStillExists = std::filesystem::exists(markerPath);
                const std::string operationId = Logger::operationId();
                logger_.writeOperation(
                    LogLevel::Info,
                    "GrassCache",
                    "NGIO launch returned. operationId=\"" +
                        (operationId.empty() ? std::string("<none>") : operationId) +
                        "\", launch=" + std::to_string(launchCount + 1) +
                        ", runtimeMarkerPath=\"" +
                        toUtf8(launchResult.runtimeMarkerPath.wstring()) +
                        "\", runtimeMarkerStillExists=" +
                        std::to_string(launchResult.runtimeMarkerStillExists ? 1 : 0) +
                        ", managedMarkerPath=\"" + toUtf8(markerPath.wstring()) +
                        "\", managedMarkerStillExists=" +
                        std::to_string(managedMarkerStillExists ? 1 : 0) +
                        ", cgidFiles=" + std::to_string(launchCounts.cgid) +
                        ", failedFiles=" + std::to_string(launchCounts.failed) + ".");
                if (!managedMarkerStillExists)
                {
                    if (!outputReady)
                    {
                        throw std::runtime_error(
                            "NGIO removed the managed PrecacheGrass.txt marker but produced no grass output.");
                    }

                    ++launchCount;
                    break;
                }

                if (launchCount + 1 >= options.maxLaunchCount)
                {
                    throw std::runtime_error(
                        "NGIO managed PrecacheGrass.txt marker remained after the restart limit.");
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
                    sleepWithCancellation(
                        std::chrono::milliseconds(options.restartDelayMs),
                        cancellationRequested);
                }
            }
        }
        catch (...)
        {
            std::error_code removeError;
            std::filesystem::remove(markerPath, removeError);
            throw;
        }

        throwIfCancellationRequested(cancellationRequested);
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

    int GrassCacheService::clearStaleNgioPrecacheMarkersForLaunch(
        const std::filesystem::path& configPath) const
    {
        if (configPath.empty())
        {
            throw std::invalid_argument("Build config path is required.");
        }

        const ProjectOpenResult opened = projects_.readProjectConfigSummary(configPath);
        if (!equalsIgnoreCase(opened.resolvedTemplate.id, skyrimGameId))
        {
            return 0;
        }

        const BuildPathSettings paths = pathSettings_.loadForConfig(configPath);
        const std::wstring rootBuilderDirectoryName =
            ngioRootBuilderDirectoryName(opened.resolvedTemplate.id);

        std::vector<std::filesystem::path> markers;
        if (!paths.gameDirectory.empty())
        {
            markers.push_back(
                paths.gameDirectory / std::filesystem::path(std::wstring(precacheMarkerFileName)));
        }
        if (!paths.overwriteDirectory.empty())
        {
            markers.push_back(
                paths.overwriteDirectory /
                std::filesystem::path(rootBuilderDirectoryName) /
                std::filesystem::path(std::wstring(precacheMarkerFileName)));
        }
        appendRootLaunchPrecacheMarkers(
            markers,
            opened.project.projectDirectory,
            opened.project.projectDirectory / L".flow" / L"root-launch");

        int removedCount = 0;
        for (const std::filesystem::path& marker : markers)
        {
            if (removeFileIfPresent(
                    marker,
                    "Could not remove stale NGIO PrecacheGrass.txt marker before launching Skyrim."))
            {
                ++removedCount;
            }
        }

        if (removedCount > 0)
        {
            logger_.writeOperation(
                LogLevel::Info,
                "GrassCache",
                "Removed stale NGIO PrecacheGrass.txt markers before Skyrim launch. count=" +
                    std::to_string(removedCount) + ".");
        }

        return removedCount;
    }

    bool GrassCacheService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
