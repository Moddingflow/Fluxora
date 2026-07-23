#include <windows.h>
#include <winternl.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

namespace
{
    std::string readFile(const std::filesystem::path& path)
    {
        std::ifstream stream(path, std::ios::binary);
        return {
            std::istreambuf_iterator<char>(stream),
            std::istreambuf_iterator<char>()
        };
    }

    bool writeFile(const std::filesystem::path& path, std::string_view value, DWORD creation)
    {
        const HANDLE file = CreateFileW(
            path.c_str(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr,
            creation,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        if (file == INVALID_HANDLE_VALUE)
        {
            return false;
        }

        DWORD written = 0;
        const BOOL ok = WriteFile(
            file,
            value.data(),
            static_cast<DWORD>(value.size()),
            &written,
            nullptr);
        CloseHandle(file);
        return ok && written == value.size();
    }

    std::string readFileWin32(const std::filesystem::path& path)
    {
        const HANDLE file = CreateFileW(
            path.c_str(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        if (file == INVALID_HANDLE_VALUE)
        {
            return {};
        }
        std::string value(64, '\0');
        DWORD read = 0;
        const BOOL ok = ReadFile(file, value.data(), static_cast<DWORD>(value.size()), &read, nullptr);
        CloseHandle(file);
        value.resize(ok ? read : 0);
        return value;
    }

    std::filesystem::path extendedPath(const std::filesystem::path& path)
    {
        const std::filesystem::path absolute = std::filesystem::absolute(path);
        return absolute.wstring().starts_with(L"\\\\?\\")
            ? absolute
            : std::filesystem::path(L"\\\\?\\" + absolute.wstring());
    }

    int finish(const std::filesystem::path& statusPath, int code, const std::string& status)
    {
        std::ofstream stream(statusPath, std::ios::binary | std::ios::trunc);
        stream << status;
        stream.close();
        std::this_thread::sleep_for(std::chrono::milliseconds(150));
        return code;
    }

    bool readRelativeToDirectory(
        const std::filesystem::path& directory,
        std::wstring_view relativePath,
        std::string& value)
    {
        const HANDLE root = CreateFileW(
            directory.c_str(),
            FILE_LIST_DIRECTORY | FILE_TRAVERSE | SYNCHRONIZE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            nullptr);
        if (root == INVALID_HANDLE_VALUE)
        {
            return false;
        }

        using NtCreateFileFn = NTSTATUS(NTAPI*)(
            PHANDLE,
            ACCESS_MASK,
            POBJECT_ATTRIBUTES,
            PIO_STATUS_BLOCK,
            PLARGE_INTEGER,
            ULONG,
            ULONG,
            ULONG,
            ULONG,
            PVOID,
            ULONG);
        const auto ntCreateFile = reinterpret_cast<NtCreateFileFn>(
            GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtCreateFile"));
        if (ntCreateFile == nullptr)
        {
            CloseHandle(root);
            return false;
        }

        UNICODE_STRING name{};
        name.Buffer = const_cast<PWSTR>(relativePath.data());
        name.Length = static_cast<USHORT>(relativePath.size() * sizeof(wchar_t));
        name.MaximumLength = name.Length;
        OBJECT_ATTRIBUTES attributes{};
        InitializeObjectAttributes(
            &attributes,
            &name,
            OBJ_CASE_INSENSITIVE,
            root,
            nullptr);
        IO_STATUS_BLOCK io{};
        HANDLE file = INVALID_HANDLE_VALUE;
        const NTSTATUS status = ntCreateFile(
            &file,
            GENERIC_READ | SYNCHRONIZE,
            &attributes,
            &io,
            nullptr,
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            1, // FILE_OPEN
            0x20, // FILE_SYNCHRONOUS_IO_NONALERT
            nullptr,
            0);
        CloseHandle(root);
        if (status < 0 || file == INVALID_HANDLE_VALUE)
        {
            return false;
        }

        char buffer[128]{};
        DWORD read = 0;
        const BOOL readOk = ReadFile(file, buffer, sizeof(buffer), &read, nullptr);
        CloseHandle(file);
        value.assign(buffer, buffer + read);
        return readOk != FALSE;
    }

    int childMode(const std::filesystem::path& data, const std::filesystem::path& status)
    {
        const std::string value = readFile(data / L"NovelSubsystem" / L"deep" / L"state.futureext");
        return finish(status, value == "+appendapper+tail" ? 0 : 41, "child=" + value);
    }

    int readOnlyComparisonMode(int argc, wchar_t** argv)
    {
        if (argc != 10)
        {
            return 42;
        }

        const std::filesystem::path data(argv[2]);
        const std::filesystem::path status(argv[3]);
        for (int pair = 0; pair < 3; ++pair)
        {
            const std::filesystem::path virtualPath = data / argv[4 + pair * 2];
            const std::filesystem::path physicalPath = argv[5 + pair * 2];
            const std::string virtualContent = readFile(virtualPath);
            const std::string physicalContent = readFile(physicalPath);
            if (virtualContent.empty() || virtualContent != physicalContent)
            {
                return finish(
                    status,
                    43 + pair,
                    "readonly-pair=" + std::to_string(pair) +
                        ";virtualBytes=" + std::to_string(virtualContent.size()) +
                        ";physicalBytes=" + std::to_string(physicalContent.size()));
            }
        }

        return finish(status, 0, "ok");
    }
}

int wmain(int argc, wchar_t** argv)
{
    if (argc == 4 && std::wstring_view(argv[1]) == L"--child")
    {
        return childMode(argv[2], argv[3]);
    }
    if (argc >= 2 && std::wstring_view(argv[1]) == L"--readonly-three")
    {
        return readOnlyComparisonMode(argc, argv);
    }
    if (argc != 5 || argv[1] == nullptr || argv[2] == nullptr || argv[3] == nullptr ||
        argv[4] == nullptr)
    {
        return 10;
    }

    const std::filesystem::path data(argv[1]);
    const std::filesystem::path gameRoot(argv[2]);
    const std::filesystem::path status(argv[3]);
    const std::filesystem::path profileApiIni(argv[4]);
    const auto fail = [&status](int code, const std::string& detail)
    {
        return finish(status, code, detail + ";win32=" + std::to_string(GetLastError()));
    };

    const std::filesystem::path unknown =
        data / L"NovelSubsystem" / L"deep" / L"state.futureext";
    if (readFile(unknown) != "high-wrapper" ||
        readFile(data / L"NOVELSUBSYSTEM" / L"DEEP" / L"STATE.FUTUREEXT") != "high-wrapper")
    {
        return fail(11, "priority-or-case-read");
    }
    if (readFile(gameRoot / L"root-only.dll") != "root-wrapper")
    {
        return fail(12, "root-wrapper");
    }
    if (readFile(data / L"meshes" / L"pbr" / L"surface.nif") != "PBR-NIF" ||
        readFile(data / L"materials" / L"pbr" / L"surface.mat") != "PBR-MAT" ||
        readFile(data / L"textures" / L"pbr" / L"surface.dds") != "PBR-DDS")
    {
        return fail(13, "pbr-assets");
    }

    wchar_t wideLanguage[32]{};
    const DWORD wideLanguageLength = GetPrivateProfileStringW(
        L"General",
        L"sLanguage",
        L"MISSING",
        wideLanguage,
        static_cast<DWORD>(std::size(wideLanguage)),
        profileApiIni.c_str());
    const std::string profileApiIniAnsi = profileApiIni.string();
    char ansiLanguage[32]{};
    const DWORD ansiLanguageLength = GetPrivateProfileStringA(
        "General",
        "sLanguage",
        "MISSING",
        ansiLanguage,
        static_cast<DWORD>(std::size(ansiLanguage)),
        profileApiIniAnsi.c_str());
    if (wideLanguageLength != 7 || std::wstring_view(wideLanguage) != L"RUSSIAN" ||
        ansiLanguageLength != 7 || std::string_view(ansiLanguage) != "RUSSIAN")
    {
        return fail(
            28,
            "profile-api-wide=" + std::to_string(wideLanguageLength) +
                "-ansi=" + std::to_string(ansiLanguageLength));
    }

    std::string relativeValue;
    if (!readRelativeToDirectory(
            data,
            L"NovelSubsystem\\deep\\state.futureext",
            relativeValue) ||
        relativeValue != "high-wrapper")
    {
        return fail(14, "relative-handle");
    }

    WIN32_FIND_DATAW found{};
    HANDLE enumeration = FindFirstFileW((data / L"NovelSubsystem" / L"*").c_str(), &found);
    bool sawDeep = false;
    if (enumeration != INVALID_HANDLE_VALUE)
    {
        do
        {
            sawDeep = sawDeep || _wcsicmp(found.cFileName, L"deep") == 0;
        } while (FindNextFileW(enumeration, &found));
        FindClose(enumeration);
    }
    if (!sawDeep)
    {
        return fail(15, "enumeration");
    }

    if (!writeFile(unknown, "+append", OPEN_EXISTING))
    {
        return fail(16, "append-open");
    }
    const HANDLE append = CreateFileW(
        unknown.c_str(),
        FILE_APPEND_DATA,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (append == INVALID_HANDLE_VALUE)
    {
        return fail(17, "append-handle");
    }
    DWORD appended = 0;
    const char appendValue[] = "+tail";
    const BOOL appendOk = WriteFile(append, appendValue, 5, &appended, nullptr);
    CloseHandle(append);
    if (!appendOk || appended != 5)
    {
        return fail(18, "append-write");
    }

    const std::filesystem::path truncateTarget = data / L"NovelSubsystem" / L"truncate.bin";
    if (!writeFile(truncateTarget, "truncated", CREATE_ALWAYS) || readFile(truncateTarget) != "truncated")
    {
        return fail(19, "truncate");
    }

    const std::wstring longLeaf = L"unicode-проверка-" + std::wstring(160, L'x') + L".newext";
    const std::filesystem::path created = data / L"Generated" / longLeaf;
    const std::filesystem::path extendedCreated = extendedPath(created);
    std::error_code createError;
    std::filesystem::create_directories(extendedCreated.parent_path(), createError);
    if (createError ||
        !writeFile(extendedCreated, "unicode-long", CREATE_NEW) ||
        readFileWin32(extendedCreated) != "unicode-long")
    {
        return fail(20, "unicode-long-create");
    }

    const std::filesystem::path renameSource = data / L"NovelSubsystem" / L"rename-source.bin";
    const std::filesystem::path renameTarget = data / L"NovelSubsystem" / L"rename-target.bin";
    if (!MoveFileExW(renameSource.c_str(), renameTarget.c_str(), MOVEFILE_REPLACE_EXISTING) ||
        std::filesystem::exists(renameSource) ||
        readFile(renameTarget) != "source-value")
    {
        return fail(21, "rename-replace");
    }

    const std::filesystem::path deleteTarget = data / L"NovelSubsystem" / L"delete-me.bin";
    if (!DeleteFileW(deleteTarget.c_str()) || std::filesystem::exists(deleteTarget))
    {
        return fail(22, "delete");
    }
    const std::filesystem::path deleteOnCloseTarget =
        data / L"NovelSubsystem" / L"delete-on-close.bin";
    const HANDLE deleting = CreateFileW(
        deleteOnCloseTarget.c_str(),
        DELETE | GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_DELETE_ON_CLOSE,
        nullptr);
    if (deleting == INVALID_HANDLE_VALUE)
    {
        return fail(23, "delete-on-close-open");
    }
    CloseHandle(deleting);
    if (std::filesystem::exists(deleteOnCloseTarget))
    {
        return fail(24, "delete-on-close-visible");
    }

    wchar_t modulePath[32768]{};
    if (GetModuleFileNameW(nullptr, modulePath, static_cast<DWORD>(std::size(modulePath))) == 0)
    {
        return fail(25, "child-module-path");
    }
    const std::filesystem::path childStatus = status.parent_path() / L"universal-vfs-child.txt";
    std::wstring command = L"\"" + std::wstring(modulePath) + L"\" --child \"" +
        data.wstring() + L"\" \"" + childStatus.wstring() + L"\"";
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(
            nullptr,
            command.data(),
            nullptr,
            nullptr,
            FALSE,
            0,
            nullptr,
            gameRoot.c_str(),
            &startup,
            &process))
    {
        return fail(26, "child-create");
    }
    CloseHandle(process.hThread);
    const DWORD wait = WaitForSingleObject(process.hProcess, 15'000);
    DWORD childExit = 0;
    GetExitCodeProcess(process.hProcess, &childExit);
    CloseHandle(process.hProcess);
    const std::string childStatusValue = readFile(childStatus);
    if (wait != WAIT_OBJECT_0 || childExit != 0 || childStatusValue != "child=+appendapper+tail")
    {
        return fail(
            27,
            "child-vfs-wait=" + std::to_string(wait) +
                "-exit=" + std::to_string(childExit) +
                "-status=" + childStatusValue);
    }

    return finish(status, 0, "ok");
}
