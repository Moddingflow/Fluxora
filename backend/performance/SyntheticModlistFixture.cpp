#define NOMINMAX
#include <windows.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace
{
    constexpr std::string_view ownershipFileName = ".fluxora-perf-owner";
    constexpr std::string_view ownershipToken = "FLUXORA_SYNTHETIC_PERFORMANCE_FIXTURE_V1\n";
    constexpr std::size_t skyrimBasePluginCount = 5;
    constexpr std::string_view markerPrefix =
        "{\"schemaVersion\":1,\"generator\":\"FluxoraSyntheticModlistFixture\"," 
        "\"ownershipToken\":\"fluxora.synthetic-performance-fixture.v1\",";

    struct Options
    {
        std::filesystem::path output;
        std::filesystem::path probePath;
        std::uint32_t modCount{610};
        std::uint32_t filesPerMod{96};
        std::uint32_t pluginCount{350};
        std::uint32_t disabledPercent{8};
        std::uint32_t conflictFilesPerMod{16};
        std::uint32_t directoryDepth{4};
        std::uint32_t directoryBranches{5};
        std::uint64_t seed{0xF10C0AULL};
    };

    std::string toUtf8(std::wstring_view value)
    {
        if (value.empty())
        {
            return {};
        }

        const int size = WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (size <= 0)
        {
            throw std::runtime_error("Failed to encode a path as UTF-8.");
        }

        std::string encoded(static_cast<std::size_t>(size), '\0');
        if (WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                encoded.data(),
                size,
                nullptr,
                nullptr) != size)
        {
            throw std::runtime_error("Failed to encode a path as UTF-8.");
        }
        return encoded;
    }

    std::string jsonEscape(std::string_view value)
    {
        std::string escaped;
        escaped.reserve(value.size() + 16);
        for (const unsigned char character : value)
        {
            switch (character)
            {
            case '"': escaped.append("\\\""); break;
            case '\\': escaped.append("\\\\"); break;
            case '\b': escaped.append("\\b"); break;
            case '\f': escaped.append("\\f"); break;
            case '\n': escaped.append("\\n"); break;
            case '\r': escaped.append("\\r"); break;
            case '\t': escaped.append("\\t"); break;
            default:
                if (character < 0x20)
                {
                    std::ostringstream stream;
                    stream << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                           << static_cast<unsigned int>(character);
                    escaped.append(stream.str());
                }
                else
                {
                    escaped.push_back(static_cast<char>(character));
                }
                break;
            }
        }
        return escaped;
    }

    std::string jsonPath(const std::filesystem::path& path)
    {
        return jsonEscape(toUtf8(path.wstring()));
    }

    void writeBinary(const std::filesystem::path& path, std::string_view content)
    {
        std::filesystem::create_directories(path.parent_path());
        std::ofstream file(path, std::ios::binary | std::ios::trunc);
        if (!file)
        {
            throw std::runtime_error("Failed to create fixture file: " + toUtf8(path.wstring()));
        }
        file.write(content.data(), static_cast<std::streamsize>(content.size()));
        if (!file)
        {
            throw std::runtime_error("Failed to write fixture file: " + toUtf8(path.wstring()));
        }
    }

    std::string readSmallFile(const std::filesystem::path& path)
    {
        constexpr std::uintmax_t maximumMarkerBytes = 4096;
        std::error_code sizeError;
        const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
        if (sizeError || size > maximumMarkerBytes)
        {
            throw std::runtime_error("Fixture ownership marker is unreadable or too large.");
        }

        std::ifstream file(path, std::ios::binary);
        if (!file)
        {
            throw std::runtime_error("Fixture ownership marker could not be opened.");
        }
        std::ostringstream content;
        content << file.rdbuf();
        if (!file.eof() && file.fail())
        {
            throw std::runtime_error("Fixture ownership marker could not be read.");
        }
        return content.str();
    }

    void appendLittleEndian16(std::string& value, std::uint16_t number)
    {
        value.push_back(static_cast<char>(number & 0xFFU));
        value.push_back(static_cast<char>((number >> 8U) & 0xFFU));
    }

    void appendLittleEndian32(std::string& value, std::uint32_t number)
    {
        value.push_back(static_cast<char>(number & 0xFFU));
        value.push_back(static_cast<char>((number >> 8U) & 0xFFU));
        value.push_back(static_cast<char>((number >> 16U) & 0xFFU));
        value.push_back(static_cast<char>((number >> 24U) & 0xFFU));
    }

    void appendPluginSubrecord(std::string& value, std::string_view type, std::string data)
    {
        value.append(type);
        appendLittleEndian16(value, static_cast<std::uint16_t>(data.size()));
        value.append(data);
    }

    std::string bethesdaPlugin(std::string_view master)
    {
        std::string payload;
        appendPluginSubrecord(payload, "HEDR", std::string(12, '\0'));
        if (!master.empty())
        {
            std::string masterData(master);
            masterData.push_back('\0');
            appendPluginSubrecord(payload, "MAST", std::move(masterData));
            appendPluginSubrecord(payload, "DATA", std::string(8, '\0'));
        }

        std::string file;
        file.append("TES4", 4);
        appendLittleEndian32(file, static_cast<std::uint32_t>(payload.size()));
        appendLittleEndian32(file, 0);
        file.append(12, '\0');
        file.append(payload);
        return file;
    }

    std::uint64_t parseUnsigned(std::wstring_view value, std::wstring_view option)
    {
        if (value.empty())
        {
            throw std::invalid_argument(toUtf8(std::wstring(option)) + " requires a value.");
        }

        std::size_t consumed = 0;
        const std::uint64_t parsed = std::stoull(std::wstring(value), &consumed, 0);
        if (consumed != value.size())
        {
            throw std::invalid_argument(toUtf8(std::wstring(option)) + " has an invalid value.");
        }
        return parsed;
    }

    std::uint32_t parseU32(std::wstring_view value, std::wstring_view option)
    {
        const std::uint64_t parsed = parseUnsigned(value, option);
        if (parsed > std::numeric_limits<std::uint32_t>::max())
        {
            throw std::invalid_argument(toUtf8(std::wstring(option)) + " is too large.");
        }
        return static_cast<std::uint32_t>(parsed);
    }

    Options parseOptions(int argc, wchar_t** argv)
    {
        Options options;
        for (int index = 1; index < argc; ++index)
        {
            const std::wstring_view argument(argv[index]);
            auto next = [&]() -> std::wstring_view
            {
                if (++index >= argc)
                {
                    throw std::invalid_argument(toUtf8(std::wstring(argument)) + " requires a value.");
                }
                return argv[index];
            };

            if (argument == L"--output") options.output = std::filesystem::path(next());
            else if (argument == L"--probe") options.probePath = std::filesystem::path(next());
            else if (argument == L"--mods") options.modCount = parseU32(next(), argument);
            else if (argument == L"--files-per-mod") options.filesPerMod = parseU32(next(), argument);
            else if (argument == L"--plugins") options.pluginCount = parseU32(next(), argument);
            else if (argument == L"--disabled-percent") options.disabledPercent = parseU32(next(), argument);
            else if (argument == L"--conflict-files") options.conflictFilesPerMod = parseU32(next(), argument);
            else if (argument == L"--directory-depth") options.directoryDepth = parseU32(next(), argument);
            else if (argument == L"--directory-branches") options.directoryBranches = parseU32(next(), argument);
            else if (argument == L"--seed") options.seed = parseUnsigned(next(), argument);
            else throw std::invalid_argument("Unknown option: " + toUtf8(std::wstring(argument)));
        }

        if (options.output.empty()) throw std::invalid_argument("--output is required.");
        if (options.modCount == 0) throw std::invalid_argument("--mods must be greater than zero.");
        if (options.filesPerMod == 0) throw std::invalid_argument("--files-per-mod must be greater than zero.");
        if (options.disabledPercent > 100) throw std::invalid_argument("--disabled-percent must be between 0 and 100.");
        options.pluginCount = std::min(options.pluginCount, options.modCount);
        options.conflictFilesPerMod = std::min(options.conflictFilesPerMod, options.filesPerMod);
        options.directoryDepth = std::min(options.directoryDepth, 12U);
        options.directoryBranches = std::clamp(options.directoryBranches, 1U, 256U);
        return options;
    }

    std::wstring paddedName(std::wstring_view prefix, std::uint32_t index, std::uint32_t width = 6)
    {
        std::wostringstream stream;
        stream << prefix << L' ' << std::setw(static_cast<int>(width)) << std::setfill(L'0') << index;
        return stream.str();
    }

    std::string deterministicUuid(std::uint64_t seed, std::uint32_t index)
    {
        const std::uint64_t left = seed ^ (static_cast<std::uint64_t>(index) * 0x9E3779B97F4A7C15ULL);
        const std::uint64_t right = (left << 17U) ^ (left >> 11U) ^ 0xA5A55A5AF00DFACEULL;
        std::ostringstream stream;
        stream << std::hex << std::setfill('0')
               << std::setw(8) << static_cast<std::uint32_t>(left >> 32U) << '-'
               << std::setw(4) << static_cast<std::uint16_t>(left >> 16U) << '-'
               << std::setw(4) << static_cast<std::uint16_t>(left) << '-'
               << std::setw(4) << static_cast<std::uint16_t>(right >> 48U) << '-'
               << std::setw(12) << (right & 0x0000FFFFFFFFFFFFULL);
        return stream.str();
    }

    bool enabledMod(const Options& options, std::uint32_t index)
    {
        if (index == 1U)
        {
            return true;
        }
        if (options.disabledPercent > 0 && options.modCount > 1U && index == options.modCount)
        {
            return false;
        }
        const std::uint64_t mixed = options.seed ^ (static_cast<std::uint64_t>(index) * 0xD6E8FEB86659FD93ULL);
        return mixed % 100ULL >= options.disabledPercent;
    }

    std::filesystem::path uniqueFilePath(
        const std::filesystem::path& modDirectory,
        std::uint32_t modIndex,
        std::uint32_t fileIndex,
        std::uint32_t depth,
        std::uint32_t branches)
    {
        std::filesystem::path relative = L"Data";
        for (std::uint32_t level = 0; level < depth; ++level)
        {
            relative /= L"level-" + std::to_wstring(level) + L"-" +
                std::to_wstring((modIndex + fileIndex + level) % branches);
        }
        relative /= L"mod-" + std::to_wstring(modIndex) + L"-file-" + std::to_wstring(fileIndex) + L".bin";
        return modDirectory / relative;
    }

    void prepareOutputDirectory(const std::filesystem::path& output)
    {
        const std::filesystem::path absolute = std::filesystem::absolute(output).lexically_normal();
        if (absolute == absolute.root_path() || absolute.parent_path().empty())
        {
            throw std::invalid_argument("Fixture output must not be a filesystem root.");
        }

        if (std::filesystem::exists(absolute))
        {
            const std::filesystem::path marker = absolute / L".fluxora-perf-fixture.json";
            const std::filesystem::path owner = absolute / ownershipFileName;
            if (!std::filesystem::is_regular_file(marker) || !std::filesystem::is_regular_file(owner))
            {
                throw std::runtime_error("Refusing to replace an unmarked fixture directory.");
            }
            const std::string ownerContent = readSmallFile(owner);
            const std::string markerContent = readSmallFile(marker);
            if (
                ownerContent != ownershipToken ||
                !markerContent.starts_with(markerPrefix) ||
                markerContent.empty() ||
                markerContent.back() != '}')
            {
                throw std::runtime_error("Refusing to replace a fixture with invalid ownership metadata.");
            }
            std::filesystem::remove_all(absolute);
        }
        std::filesystem::create_directories(absolute);
        writeBinary(absolute / ownershipFileName, ownershipToken);
    }

    void generate(const Options& rawOptions)
    {
        Options options = rawOptions;
        options.output = std::filesystem::absolute(options.output).lexically_normal();
        prepareOutputDirectory(options.output);

        const std::filesystem::path gameDirectory = options.output / L"Game";
        const std::filesystem::path modsDirectory = options.output / L"mods";
        const std::filesystem::path profileDirectory = options.output / L"profiles" / L"Default";
        const std::filesystem::path probeDestination = gameDirectory / L"FluxoraLaunchProbe.exe";
        const std::filesystem::path probeResult = options.output / L"probe-result.json";
        const std::filesystem::path probeReadPath = gameDirectory / L"Data" / L"overlay-sentinel.txt";

        writeBinary(gameDirectory / L"SkyrimSE.exe", "MZ synthetic game executable placeholder");
        writeBinary(gameDirectory / L"Data" / L"Skyrim.esm", bethesdaPlugin({}));
        if (!options.probePath.empty())
        {
            if (!std::filesystem::is_regular_file(options.probePath))
            {
                throw std::runtime_error("Launch probe does not exist: " + toUtf8(options.probePath.wstring()));
            }
            std::filesystem::create_directories(probeDestination.parent_path());
            std::filesystem::copy_file(
                options.probePath,
                probeDestination,
                std::filesystem::copy_options::overwrite_existing);
        }

        std::string modlist;
        std::string plugins = "*Skyrim.esm\n";
        std::string loadorder = "Skyrim.esm\n";
        std::vector<std::string> modlistEntries;
        std::vector<std::string> enabledPluginNames;
        std::uint32_t firstEnabledMod = 0;
        std::uint32_t lastEnabledMod = 0;
        std::uint32_t lastDisabledMod = 0;
        for (std::uint32_t modIndex = 1; modIndex <= options.modCount; ++modIndex)
        {
            if (enabledMod(options, modIndex))
            {
                if (firstEnabledMod == 0) firstEnabledMod = modIndex;
                lastEnabledMod = modIndex;
            }
            else
            {
                lastDisabledMod = modIndex;
            }
        }
        if (firstEnabledMod == 0)
        {
            throw std::invalid_argument("Synthetic launch fixtures require at least one enabled mod.");
        }

        for (std::uint32_t modIndex = 1; modIndex <= options.modCount; ++modIndex)
        {
            const std::wstring modName = paddedName(L"Synthetic Mod", modIndex);
            const std::filesystem::path modDirectory = modsDirectory / modName;
            const bool enabled = enabledMod(options, modIndex);
            const std::string modlistEntry =
                std::string(1, enabled ? '+' : '-') + toUtf8(modName) + "\n";
            modlist.append(modlistEntry);
            modlistEntries.push_back(modlistEntry);

            const std::string manifest =
                "{\"schemaVersion\":1,\"modUuid\":\"" + deterministicUuid(options.seed, modIndex) +
                "\",\"gameId\":\"skyrimse\",\"folderName\":\"" + jsonEscape(toUtf8(modName)) +
                "\",\"displayName\":\"" + jsonEscape(toUtf8(modName)) +
                "\",\"version\":\"1.0." + std::to_string(modIndex) +
                "\",\"installedAt\":\"2026-01-01T00:00:00Z\",\"updatedAt\":\"2026-01-01T00:00:00Z\"," +
                "\"state\":\"" + std::string(enabled ? "installed" : "disabled") +
                "\",\"contentFingerprint\":\"synthetic-v1-" + std::to_string(modIndex) +
                "\",\"sourceIsNexus\":false,\"sourceIsModdingFlow\":false,\"isLocal\":true," +
                "\"isTranslation\":false,\"isPatch\":false,\"source\":{\"provider\":\"manual\"}}";
            writeBinary(modDirectory / L".flow" / L"manifest.json", manifest);

            for (std::uint32_t fileIndex = 0; fileIndex < options.filesPerMod; ++fileIndex)
            {
                std::filesystem::path filePath;
                if (fileIndex < options.conflictFilesPerMod)
                {
                    filePath = modDirectory / L"Data" / L"shared" /
                        (L"group-" + std::to_wstring((modIndex - 1U) / 4U)) /
                        (L"conflict-" + std::to_wstring(fileIndex) + L".bin");
                }
                else
                {
                    filePath = uniqueFilePath(
                        modDirectory,
                        modIndex,
                        fileIndex,
                        options.directoryDepth,
                        options.directoryBranches);
                }
                writeBinary(
                    filePath,
                    "fixture seed=" + std::to_string(options.seed) +
                        " mod=" + std::to_string(modIndex) +
                        " file=" + std::to_string(fileIndex));
            }

            if (modIndex <= options.pluginCount)
            {
                const std::wstring pluginName = paddedName(L"SyntheticPlugin", modIndex) + L".esp";
                writeBinary(modDirectory / L"Data" / pluginName, bethesdaPlugin("Skyrim.esm"));
                if (enabled)
                {
                    plugins.push_back('*');
                    plugins.append(toUtf8(pluginName));
                    plugins.push_back('\n');
                    loadorder.append(toUtf8(pluginName));
                    loadorder.push_back('\n');
                    enabledPluginNames.push_back(toUtf8(pluginName));
                }
            }

            if (modIndex == firstEnabledMod ||
                modIndex == lastEnabledMod ||
                modIndex == lastDisabledMod)
            {
                writeBinary(
                    modDirectory / L"Data" / L"overlay-sentinel.txt",
                    "winner-mod=" + std::to_string(modIndex));
            }
        }

        writeBinary(profileDirectory / L"modlist.txt", modlist);
        writeBinary(profileDirectory / L"plugins.txt", plugins);
        writeBinary(profileDirectory / L"loadorder.txt", loadorder);
        std::string alternateModlist;
        for (auto entry = modlistEntries.rbegin(); entry != modlistEntries.rend(); ++entry)
        {
            alternateModlist.append(*entry);
        }
        std::string alternatePlugins = "*Skyrim.esm\n";
        std::string alternateLoadorder = "Skyrim.esm\n";
        for (auto plugin = enabledPluginNames.rbegin(); plugin != enabledPluginNames.rend(); ++plugin)
        {
            alternatePlugins.push_back('*');
            alternatePlugins.append(*plugin);
            alternatePlugins.push_back('\n');
            alternateLoadorder.append(*plugin);
            alternateLoadorder.push_back('\n');
        }
        const std::filesystem::path alternateProfileDirectory =
            options.output / L"profiles" / L"Alternate";
        writeBinary(alternateProfileDirectory / L"modlist.txt", alternateModlist);
        writeBinary(alternateProfileDirectory / L"plugins.txt", alternatePlugins);
        writeBinary(alternateProfileDirectory / L"loadorder.txt", alternateLoadorder);
        std::filesystem::create_directories(options.output / L"downloads");
        std::filesystem::create_directories(options.output / L"overwrite");

        const std::string expectedSentinel = "winner-mod=" + std::to_string(lastEnabledMod);
        const std::string probeArguments =
            "--result \\\"" + jsonPath(probeResult) + "\\\" --vfs-read \\\"" +
            jsonPath(probeReadPath) + "\\\" --expect \\\"" + expectedSentinel +
            "\\\" --hold-ms 1500";
        const std::string alternateExpectedSentinel =
            "winner-mod=" + std::to_string(firstEnabledMod);
        const std::string alternateProbeArguments =
            "--result \\\"" + jsonPath(probeResult) + "\\\" --vfs-read \\\"" +
            jsonPath(probeReadPath) + "\\\" --expect \\\"" + alternateExpectedSentinel +
            "\\\" --hold-ms 1500";
        const std::string config =
            "{\"schemaVersion\":\"1\",\"name\":\"Synthetic Performance " + std::to_string(options.modCount) +
            "\",\"templateId\":\"skyrimse\",\"gameId\":\"skyrimse\"," +
            "\"gameName\":\"Skyrim Special Edition\",\"gamePath\":\"" + jsonPath(gameDirectory) +
            "\",\"installRoot\":\"" + jsonPath(options.output.parent_path()) +
            "\",\"projectDirectory\":\"" + jsonPath(options.output) +
            "\",\"dataDirectory\":\"Data\",\"defaultProfile\":\"Default\"," +
            "\"paths\":{\"downloadsDirectory\":\"downloads\",\"gameDirectory\":\"Game\"," +
            "\"modsDirectory\":\"mods\",\"overwriteDirectory\":\"overwrite\",\"profilesDirectory\":\"profiles\"}," +
            "\"basePlugins\":[\"Skyrim.esm\"],\"pluginExtensions\":[\".esm\",\".esp\",\".esl\"]," +
            "\"launchExecutables\":[{\"id\":\"probe\",\"displayName\":\"Fluxora Launch Probe\"," +
            "\"executablePath\":\"FluxoraLaunchProbe.exe\",\"arguments\":\"" + probeArguments +
            "\",\"workingDirectory\":\"" + jsonPath(gameDirectory) + "\"}," +
            "{\"id\":\"probe-alternate\",\"displayName\":\"Fluxora Alternate Profile Probe\"," +
            "\"executablePath\":\"FluxoraLaunchProbe.exe\",\"arguments\":\"" + alternateProbeArguments +
            "\",\"workingDirectory\":\"" + jsonPath(gameDirectory) + "\"}]}";
        writeBinary(options.output / L"build.json", config);

        const std::size_t expectedPluginCount = skyrimBasePluginCount + enabledPluginNames.size();
        const std::string marker =
            std::string("{\"schemaVersion\":1,\"generator\":\"FluxoraSyntheticModlistFixture\",") +
            "\"ownershipToken\":\"fluxora.synthetic-performance-fixture.v1\"," +
            "\"seed\":" + std::to_string(options.seed) +
            ",\"modCount\":" + std::to_string(options.modCount) +
            ",\"filesPerMod\":" + std::to_string(options.filesPerMod) +
            ",\"pluginCount\":" + std::to_string(options.pluginCount) +
            ",\"basePluginCount\":" + std::to_string(skyrimBasePluginCount) +
            ",\"expectedPluginCount\":" + std::to_string(expectedPluginCount) +
            ",\"disabledPercent\":" + std::to_string(options.disabledPercent) +
            ",\"conflictFilesPerMod\":" + std::to_string(options.conflictFilesPerMod) +
            ",\"directoryDepth\":" + std::to_string(options.directoryDepth) +
            ",\"directoryBranches\":" + std::to_string(options.directoryBranches) +
            ",\"expectedOverlaySentinel\":\"" + expectedSentinel +
            "\",\"alternateExpectedOverlaySentinel\":\"" + alternateExpectedSentinel + "\"}";
        writeBinary(options.output / L".fluxora-perf-fixture.json", marker);

        std::cout << "Created deterministic Fluxora fixture at " << toUtf8(options.output.wstring())
                  << " with " << options.modCount << " mods and "
                  << options.filesPerMod << " modeled files per mod.\n";
    }
}

int wmain(int argc, wchar_t** argv)
{
    try
    {
        generate(parseOptions(argc, argv));
        return 0;
    }
    catch (const std::exception& exception)
    {
        std::cerr << "Fluxora synthetic fixture failed: " << exception.what() << '\n';
        return 1;
    }
}
