#define NOMINMAX
#include <windows.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>

namespace
{
    static_assert(sizeof(void*) == 8, "FluxoraLaunchProbe must be built for x64.");

    struct Options
    {
        std::filesystem::path resultPath;
        std::filesystem::path vfsReadPath;
        std::string expectedContent;
        std::uint32_t holdMilliseconds{1500};
    };

    std::string toUtf8(std::wstring_view value)
    {
        if (value.empty()) return {};
        const int size = WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (size <= 0) throw std::runtime_error("UTF-8 conversion failed.");
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
            throw std::runtime_error("UTF-8 conversion failed.");
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
                else escaped.push_back(static_cast<char>(character));
                break;
            }
        }
        return escaped;
    }

    std::uint32_t parseU32(std::wstring_view value, std::wstring_view option)
    {
        std::size_t consumed = 0;
        const unsigned long parsed = std::stoul(std::wstring(value), &consumed, 10);
        if (consumed != value.size() || parsed > 60'000UL)
        {
            throw std::invalid_argument(toUtf8(std::wstring(option)) + " has an invalid value.");
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

            if (argument == L"--result") options.resultPath = std::filesystem::path(next());
            else if (argument == L"--vfs-read") options.vfsReadPath = std::filesystem::path(next());
            else if (argument == L"--expect") options.expectedContent = toUtf8(next());
            else if (argument == L"--hold-ms") options.holdMilliseconds = parseU32(next(), argument);
            else throw std::invalid_argument("Unknown option: " + toUtf8(std::wstring(argument)));
        }

        if (options.resultPath.empty()) throw std::invalid_argument("--result is required.");
        if (options.vfsReadPath.empty()) throw std::invalid_argument("--vfs-read is required.");
        return options;
    }

    std::wstring environmentVariable(std::wstring_view name)
    {
        const DWORD required = GetEnvironmentVariableW(std::wstring(name).c_str(), nullptr, 0);
        if (required == 0) return {};
        std::wstring value(static_cast<std::size_t>(required), L'\0');
        const DWORD written = GetEnvironmentVariableW(
            std::wstring(name).c_str(),
            value.data(),
            required);
        if (written == 0 || written >= required) return {};
        value.resize(written);
        return value;
    }

    std::string readBinary(const std::filesystem::path& path)
    {
        std::ifstream file(path, std::ios::binary);
        if (!file) return {};
        return std::string(
            std::istreambuf_iterator<char>(file),
            std::istreambuf_iterator<char>());
    }

    std::uint64_t fileTimeTicks(const FILETIME& time)
    {
        return (static_cast<std::uint64_t>(time.dwHighDateTime) << 32U) |
            static_cast<std::uint64_t>(time.dwLowDateTime);
    }

    double creationToNowMilliseconds()
    {
        FILETIME creation{};
        FILETIME exit{};
        FILETIME kernel{};
        FILETIME user{};
        if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) return -1.0;
        FILETIME now{};
        GetSystemTimePreciseAsFileTime(&now);
        const std::uint64_t start = fileTimeTicks(creation);
        const std::uint64_t current = fileTimeTicks(now);
        return current >= start ? static_cast<double>(current - start) / 10'000.0 : -1.0;
    }

    void writeResultAtomically(const std::filesystem::path& path, std::string_view content)
    {
        std::filesystem::create_directories(path.parent_path());
        const std::filesystem::path temporary =
            std::filesystem::path(path.wstring() + L".tmp." + std::to_wstring(GetCurrentProcessId()));
        {
            std::ofstream file(temporary, std::ios::binary | std::ios::trunc);
            if (!file) throw std::runtime_error("Failed to create the launch-probe result.");
            file.write(content.data(), static_cast<std::streamsize>(content.size()));
            file.flush();
            if (!file) throw std::runtime_error("Failed to write the launch-probe result.");
        }
        if (!MoveFileExW(
                temporary.c_str(),
                path.c_str(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
        {
            const DWORD error = GetLastError();
            std::filesystem::remove(temporary);
            throw std::runtime_error("Failed to publish the launch-probe result. Win32=" + std::to_string(error));
        }
    }

    int run(const Options& options, double creationToEntryMilliseconds)
    {
        const std::wstring descriptorPath = environmentVariable(L"FLUXORA_VFS_CONFIG");
        const bool descriptorExists =
            !descriptorPath.empty() && std::filesystem::is_regular_file(descriptorPath);
        const std::string observed = readBinary(options.vfsReadPath);
        const bool contentMatches = observed == options.expectedContent;
        const bool ok = descriptorExists && contentMatches;
        const double validatedReadyDelayMs = creationToNowMilliseconds();

        std::ostringstream json;
        json << std::fixed << std::setprecision(3)
             << "{\"schemaVersion\":1,\"pid\":" << GetCurrentProcessId()
             << ",\"isX64\":true,\"creationToEntryMs\":" << creationToEntryMilliseconds
             << ",\"creationToValidatedReadyMs\":" << validatedReadyDelayMs
             << ",\"vfsDescriptorPath\":\"" << jsonEscape(toUtf8(descriptorPath))
             << "\",\"vfsDescriptorExists\":" << (descriptorExists ? "true" : "false")
             << ",\"readPath\":\"" << jsonEscape(toUtf8(options.vfsReadPath.wstring()))
             << "\",\"expectedContent\":\"" << jsonEscape(options.expectedContent)
             << "\",\"observedContent\":\"" << jsonEscape(observed)
             << "\",\"ok\":" << (ok ? "true" : "false") << '}';
        writeResultAtomically(options.resultPath, json.str());

        if (options.holdMilliseconds > 0)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(options.holdMilliseconds));
        }
        return ok ? 0 : 2;
    }
}

int wmain(int argc, wchar_t** argv)
{
    const double creationToEntryMilliseconds = creationToNowMilliseconds();
    try
    {
        return run(parseOptions(argc, argv), creationToEntryMilliseconds);
    }
    catch (const std::exception& exception)
    {
        std::cerr << "Fluxora launch probe failed: " << exception.what() << '\n';
        return 1;
    }
}
