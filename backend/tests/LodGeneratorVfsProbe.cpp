#include <chrono>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>

namespace
{
    std::wstring lower(std::wstring value)
    {
        for (wchar_t& character : value)
        {
            character = static_cast<wchar_t>(std::towlower(character));
        }
        return value;
    }

    int finish(const std::filesystem::path& statusPath, int code, const std::string& status)
    {
        if (!statusPath.empty())
        {
            std::ofstream stream(statusPath, std::ios::binary | std::ios::trunc);
            stream << status;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
        return code;
    }
}

int wmain(int argc, wchar_t** argv)
{
    std::filesystem::path gameData;
    std::filesystem::path output;
    std::filesystem::path status;
    bool skyrimSpecialEdition = false;

    for (int index = 1; index < argc; ++index)
    {
        const std::wstring argument = argv[index] == nullptr ? L"" : argv[index];
        const std::wstring normalized = lower(argument);
        if (normalized == L"-sse")
        {
            skyrimSpecialEdition = true;
        }
        else if (normalized.starts_with(L"-o:"))
        {
            output = argument.substr(3);
        }
        else if (normalized == L"--fluxora-probe-status" && index + 1 < argc)
        {
            status = argv[++index];
        }
        else if (normalized == L"--fluxora-game-data" && index + 1 < argc)
        {
            gameData = argv[++index];
        }
        else if (normalized == L"-tes5")
        {
            return finish(status, 10, "legacy-game-mode-survived");
        }
        else if (normalized.find(L"old-output") != std::wstring::npos)
        {
            return finish(status, 11, "legacy-output-survived");
        }
    }

    if (!skyrimSpecialEdition || output.empty() || status.empty() || gameData.empty())
    {
        return finish(status, 12, "managed-arguments-missing");
    }

    std::ifstream source(gameData / L"textures" / L"active-source.dds", std::ios::binary);
    const std::string sourceValue{
        std::istreambuf_iterator<char>(source),
        std::istreambuf_iterator<char>()};
    if (sourceValue != "active-profile-source")
    {
        return finish(status, 13, "active-profile-missing");
    }

    const std::filesystem::path generated = output / L"meshes" / L"texgen-output.nif";
    std::filesystem::create_directories(generated.parent_path());
    std::ofstream stream(generated, std::ios::binary | std::ios::trunc);
    stream << "generated-through-managed-o";
    stream.close();
    if (!stream)
    {
        return finish(status, 14, "managed-output-write-failed");
    }

    return finish(status, 0, "ok|" + output.string());
}
