#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>

int wmain(int argc, wchar_t** argv)
{
    if (argc != 3 || argv[1] == nullptr || argv[2] == nullptr)
    {
        return 10;
    }

    const std::wstring dataDirectoryPrefix(argv[1]);
    const std::filesystem::path statusPath(argv[2]);
    const auto finish = [&statusPath](int code, const std::string& status)
    {
        std::ofstream stream(statusPath, std::ios::binary | std::ios::trunc);
        stream << status;
        stream.close();
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
        return code;
    };
    const std::filesystem::path source = dataDirectoryPrefix + L"meshes\\source.nif";
    std::ifstream input(source, std::ios::binary);
    const std::string original{
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>()};
    if (original != "from-active-mod")
    {
        return finish(11, "source=" + original);
    }

    std::ofstream rewritten(source, std::ios::binary | std::ios::trunc);
    rewritten << "rewritten-by-probe";
    rewritten.close();
    if (!rewritten)
    {
        return finish(12, "rewrite-failed");
    }

    const std::filesystem::path created = dataDirectoryPrefix + L"meshes\\created.nif";
    std::filesystem::create_directories(created.parent_path());
    std::ofstream output(created, std::ios::binary | std::ios::trunc);
    output << "created-by-probe";
    output.close();
    return output ? finish(0, "ok") : finish(13, "create-failed");
}
