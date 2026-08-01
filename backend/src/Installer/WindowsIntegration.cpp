#include "FluxoraInstaller/WindowsIntegration.hpp"

#include <array>
#include <memory>
#include <stdexcept>
#include <string>
#include <system_error>
#include <utility>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>

namespace
{
    class RegistryKey final
    {
    public:
        explicit RegistryKey(HKEY key = nullptr) noexcept : key_(key) {}
        RegistryKey(const RegistryKey&) = delete;
        RegistryKey& operator=(const RegistryKey&) = delete;
        ~RegistryKey()
        {
            if (key_ != nullptr)
            {
                RegCloseKey(key_);
            }
        }
        [[nodiscard]] HKEY get() const noexcept { return key_; }

    private:
        HKEY key_;
    };

    bool pathEquals(
        const std::filesystem::path& left,
        const std::filesystem::path& right)
    {
        try
        {
            const std::wstring leftValue =
                std::filesystem::absolute(left).lexically_normal().wstring();
            const std::wstring rightValue =
                std::filesystem::absolute(right).lexically_normal().wstring();
            return CompareStringOrdinal(
                leftValue.c_str(),
                static_cast<int>(leftValue.size()),
                rightValue.c_str(),
                static_cast<int>(rightValue.size()),
                TRUE) == CSTR_EQUAL;
        }
        catch (...)
        {
            return false;
        }
    }

    class ComApartment final
    {
    public:
        ComApartment()
        {
            const HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
            if (result == RPC_E_CHANGED_MODE)
            {
                return;
            }
            if (FAILED(result))
            {
                throw std::runtime_error("Windows shortcut services are unavailable.");
            }
            uninitialize_ = true;
        }
        ~ComApartment()
        {
            if (uninitialize_)
            {
                CoUninitialize();
            }
        }

    private:
        bool uninitialize_{false};
    };

    template <typename Interface>
    struct ComReleaser
    {
        void operator()(Interface* value) const noexcept
        {
            if (value != nullptr)
            {
                value->Release();
            }
        }
    };

    template <typename Interface>
    using ComPtr = std::unique_ptr<Interface, ComReleaser<Interface>>;

    void requireHresult(HRESULT result, const char* action)
    {
        if (FAILED(result))
        {
            throw std::runtime_error(
                std::string("Windows shortcut failed while ") + action + '.');
        }
    }

    ComPtr<IShellLinkW> createShellLink()
    {
        IShellLinkW* raw = nullptr;
        requireHresult(
            CoCreateInstance(
                CLSID_ShellLink,
                nullptr,
                CLSCTX_INPROC_SERVER,
                IID_IShellLinkW,
                reinterpret_cast<void**>(&raw)),
            "creating the shell link");
        if (raw == nullptr)
        {
            throw std::runtime_error("Windows shortcut shell link is unavailable.");
        }
        return ComPtr<IShellLinkW>(raw);
    }

    ComPtr<IPersistFile> persistFile(IShellLinkW& shellLink)
    {
        IPersistFile* raw = nullptr;
        requireHresult(
            shellLink.QueryInterface(
                IID_IPersistFile,
                reinterpret_cast<void**>(&raw)),
            "opening shortcut persistence");
        if (raw == nullptr)
        {
            throw std::runtime_error("Windows shortcut persistence is unavailable.");
        }
        return ComPtr<IPersistFile>(raw);
    }

    std::filesystem::path allocateShortcutTemporaryPath(
        const std::filesystem::path& shortcut)
    {
        for (std::size_t attempt = 0; attempt < 32; ++attempt)
        {
            GUID id{};
            requireHresult(
                CoCreateGuid(&id),
                "allocating a temporary shortcut name");
            std::array<wchar_t, 40> text{};
            if (StringFromGUID2(
                    id,
                    text.data(),
                    static_cast<int>(text.size())) <= 0)
            {
                throw std::runtime_error(
                    "Temporary shortcut name could not be encoded.");
            }
            const std::filesystem::path candidate =
                shortcut.wstring() + L".fluxora-" + text.data() + L".tmp";
            const DWORD attributes = GetFileAttributesW(candidate.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES &&
                (GetLastError() == ERROR_FILE_NOT_FOUND ||
                 GetLastError() == ERROR_PATH_NOT_FOUND))
            {
                return candidate;
            }
        }
        throw std::runtime_error(
            "A collision-free temporary shortcut path could not be allocated.");
    }
}

namespace fluxora::installer
{
    bool WindowsCurrentUserRegistryStore::keyExists(
        std::wstring_view keyPath) const
    {
        HKEY raw = nullptr;
        const LSTATUS status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            std::wstring(keyPath).c_str(),
            0,
            KEY_READ,
            &raw);
        if (status == ERROR_FILE_NOT_FOUND)
        {
            return false;
        }
        if (status != ERROR_SUCCESS)
        {
            throw std::system_error(
                static_cast<int>(status),
                std::system_category(),
                "Current-user registry key could not be inspected");
        }
        RegistryKey key(raw);
        return true;
    }

    std::optional<std::wstring> WindowsCurrentUserRegistryStore::readString(
        std::wstring_view keyPath,
        std::wstring_view valueName) const
    {
        HKEY raw = nullptr;
        const LSTATUS opened = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            std::wstring(keyPath).c_str(),
            0,
            KEY_QUERY_VALUE,
            &raw);
        if (opened == ERROR_FILE_NOT_FOUND)
        {
            return std::nullopt;
        }
        if (opened != ERROR_SUCCESS)
        {
            throw std::system_error(
                static_cast<int>(opened),
                std::system_category(),
                "Current-user registry value could not be opened");
        }
        RegistryKey key(raw);
        DWORD type = 0;
        DWORD bytes = 0;
        const std::wstring name(valueName);
        LSTATUS queried = RegQueryValueExW(
            key.get(),
            name.c_str(),
            nullptr,
            &type,
            nullptr,
            &bytes);
        if (queried == ERROR_FILE_NOT_FOUND)
        {
            return std::nullopt;
        }
        if (queried != ERROR_SUCCESS || type != REG_SZ || bytes < sizeof(wchar_t))
        {
            throw std::runtime_error("Current-user registry string is invalid.");
        }
        std::wstring value(bytes / sizeof(wchar_t), L'\0');
        queried = RegQueryValueExW(
            key.get(),
            name.c_str(),
            nullptr,
            &type,
            reinterpret_cast<BYTE*>(value.data()),
            &bytes);
        if (queried != ERROR_SUCCESS)
        {
            throw std::runtime_error("Current-user registry string could not be read.");
        }
        if (!value.empty() && value.back() == L'\0')
        {
            value.pop_back();
        }
        return value;
    }

    void WindowsCurrentUserRegistryStore::writeString(
        std::wstring_view keyPath,
        std::wstring_view valueName,
        std::wstring_view value)
    {
        HKEY raw = nullptr;
        const LSTATUS created = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            std::wstring(keyPath).c_str(),
            0,
            nullptr,
            0,
            KEY_SET_VALUE,
            nullptr,
            &raw,
            nullptr);
        if (created != ERROR_SUCCESS)
        {
            throw std::system_error(
                static_cast<int>(created),
                std::system_category(),
                "Current-user registry key could not be written");
        }
        RegistryKey key(raw);
        const std::wstring name(valueName);
        const std::wstring data(value);
        const LSTATUS written = RegSetValueExW(
            key.get(),
            name.c_str(),
            0,
            REG_SZ,
            reinterpret_cast<const BYTE*>(data.c_str()),
            static_cast<DWORD>((data.size() + 1) * sizeof(wchar_t)));
        if (written != ERROR_SUCCESS)
        {
            throw std::system_error(
                static_cast<int>(written),
                std::system_category(),
                "Current-user registry value could not be written");
        }
    }

    void WindowsCurrentUserRegistryStore::deleteValue(
        std::wstring_view keyPath,
        std::wstring_view valueName)
    {
        HKEY raw = nullptr;
        const LSTATUS opened = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            std::wstring(keyPath).c_str(),
            0,
            KEY_SET_VALUE,
            &raw);
        if (opened == ERROR_FILE_NOT_FOUND)
        {
            return;
        }
        if (opened != ERROR_SUCCESS)
        {
            throw std::system_error(
                static_cast<int>(opened),
                std::system_category(),
                "Current-user registry value could not be opened");
        }
        RegistryKey key(raw);
        const LSTATUS removed = RegDeleteValueW(
            key.get(),
            std::wstring(valueName).c_str());
        if (removed != ERROR_SUCCESS && removed != ERROR_FILE_NOT_FOUND)
        {
            throw std::system_error(
                static_cast<int>(removed),
                std::system_category(),
                "Current-user registry value could not be removed");
        }
    }

    void WindowsCurrentUserRegistryStore::deleteTree(std::wstring_view keyPath)
    {
        const LSTATUS removed = RegDeleteTreeW(
            HKEY_CURRENT_USER,
            std::wstring(keyPath).c_str());
        if (removed != ERROR_SUCCESS && removed != ERROR_FILE_NOT_FOUND)
        {
            throw std::system_error(
                static_cast<int>(removed),
                std::system_category(),
                "Current-user registry tree could not be removed");
        }
    }

    void WindowsCurrentUserRegistryStore::notifyAssociationsChanged()
    {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED,
            SHCNF_IDLIST | SHCNF_FLUSH,
            nullptr,
            nullptr);
    }

    ProtocolRegistrationService::ProtocolRegistrationService(
        ICurrentUserRegistryStore& registry)
        : registry_(registry)
    {
    }

    void ProtocolRegistrationService::validateInstallOrRepair(
        const std::filesystem::path& applicationPath) const
    {
        (void)normalizeApplicationPath(applicationPath);
        refuseForeignCollisions();
    }

    void ProtocolRegistrationService::installOrRepair(
        const std::filesystem::path& applicationPath) const
    {
        const std::filesystem::path normalized =
            normalizeApplicationPath(applicationPath);
        validateInstallOrRepair(normalized);

        registry_.writeString(ProgIdPath, L"", L"URL:ModdingFlow Protocol");
        registry_.writeString(ProgIdPath, L"URL Protocol", L"");
        registry_.writeString(ProgIdPath, OwnerValueName, OwnerId);
        registry_.writeString(
            ProgIdPath,
            InstallPathValueName,
            normalized.wstring());
        registry_.writeString(
            std::wstring(ProgIdPath) + L"\\DefaultIcon",
            L"",
            L"\"" + normalized.wstring() + L"\",0");
        registry_.writeString(
            ProgIdCommandPath,
            L"",
            openCommand(normalized));

        registry_.writeString(ApplicationRegistrationPath, OwnerValueName, OwnerId);
        registry_.writeString(
            ApplicationRegistrationPath,
            InstallPathValueName,
            normalized.wstring());
        registry_.writeString(CapabilitiesPath, L"ApplicationName", L"Fluxora");
        registry_.writeString(
            CapabilitiesPath,
            L"ApplicationDescription",
            L"Fluxora mod manager");
        registry_.writeString(UrlAssociationsPath, Scheme, ProgId);
        registry_.writeString(
            RegisteredApplicationsPath,
            L"Fluxora",
            CapabilitiesPath);
        registry_.writeString(SchemeOpenWithPath, ProgId, L"");
        registry_.notifyAssociationsChanged();
    }

    bool ProtocolRegistrationService::uninstall(
        const std::filesystem::path& applicationPath) const
    {
        const std::filesystem::path normalized =
            normalizeApplicationPath(applicationPath);
        if (!isOwnedRegistration(normalized) ||
            !isOwnedApplicationRegistration(normalized))
        {
            return false;
        }
        registry_.deleteValue(SchemeOpenWithPath, ProgId);
        if (registry_.readString(RegisteredApplicationsPath, L"Fluxora") ==
            std::optional<std::wstring>(std::wstring(CapabilitiesPath)))
        {
            registry_.deleteValue(RegisteredApplicationsPath, L"Fluxora");
        }
        registry_.deleteTree(ApplicationRegistrationPath);
        registry_.deleteTree(ProgIdPath);
        registry_.notifyAssociationsChanged();
        return true;
    }

    bool ProtocolRegistrationService::isOwnedRegistration(
        const std::filesystem::path& applicationPath) const
    {
        const std::filesystem::path normalized =
            normalizeApplicationPath(applicationPath);
        const std::optional<std::wstring> installed =
            registry_.readString(ProgIdPath, InstallPathValueName);
        const std::optional<std::wstring> command =
            registry_.readString(ProgIdCommandPath, L"");
        return registry_.readString(ProgIdPath, OwnerValueName) ==
                std::optional<std::wstring>(std::wstring(OwnerId)) &&
            installed.has_value() &&
            pathEquals(*installed, normalized) &&
            command.has_value() &&
            CompareStringOrdinal(
                command->c_str(),
                -1,
                openCommand(normalized).c_str(),
                -1,
                TRUE) == CSTR_EQUAL;
    }

    std::optional<std::filesystem::path>
    ProtocolRegistrationService::ownedApplicationPath() const
    {
        if (registry_.readString(ApplicationRegistrationPath, OwnerValueName) !=
            std::optional<std::wstring>(std::wstring(OwnerId)))
        {
            return std::nullopt;
        }
        const std::optional<std::wstring> path =
            registry_.readString(ApplicationRegistrationPath, InstallPathValueName);
        if (!path.has_value())
        {
            return std::nullopt;
        }
        try
        {
            return normalizeApplicationPath(*path);
        }
        catch (...)
        {
            return std::nullopt;
        }
    }

    std::filesystem::path ProtocolRegistrationService::normalizeApplicationPath(
        const std::filesystem::path& applicationPath)
    {
        if (applicationPath.empty() || !applicationPath.is_absolute())
        {
            throw std::invalid_argument(
                "Manager protocol registration requires an absolute Fluxora.exe path.");
        }
        const std::wstring raw = applicationPath.wstring();
        if (raw.find(L'\0') != std::wstring::npos ||
            raw.find(L'"') != std::wstring::npos ||
            raw.find(L'\r') != std::wstring::npos ||
            raw.find(L'\n') != std::wstring::npos)
        {
            throw std::invalid_argument(
                "Manager protocol registration path contains unsafe characters.");
        }
        std::filesystem::path normalized =
            std::filesystem::absolute(applicationPath).lexically_normal();
        if (CompareStringOrdinal(
                normalized.filename().c_str(),
                -1,
                L"Fluxora.exe",
                -1,
                TRUE) != CSTR_EQUAL)
        {
            throw std::invalid_argument(
                "Manager protocol registration requires an absolute Fluxora.exe path.");
        }
        return normalized;
    }

    std::wstring ProtocolRegistrationService::openCommand(
        const std::filesystem::path& applicationPath)
    {
        return L"\"" + normalizeApplicationPath(applicationPath).wstring() +
            L"\" \"%1\"";
    }

    bool ProtocolRegistrationService::isOwnedApplicationRegistration(
        const std::filesystem::path& applicationPath) const
    {
        const std::optional<std::wstring> installed =
            registry_.readString(
                ApplicationRegistrationPath,
                InstallPathValueName);
        return registry_.readString(ApplicationRegistrationPath, OwnerValueName) ==
                std::optional<std::wstring>(std::wstring(OwnerId)) &&
            installed.has_value() &&
            pathEquals(*installed, applicationPath);
    }

    void ProtocolRegistrationService::refuseForeignCollisions() const
    {
        if (registry_.keyExists(ProgIdPath) &&
            registry_.readString(ProgIdPath, OwnerValueName) !=
                std::optional<std::wstring>(std::wstring(OwnerId)))
        {
            throw std::runtime_error(
                "The Fluxora ModdingFlow ProgID is owned by another registration.");
        }
        const std::optional<std::wstring> registered =
            registry_.readString(RegisteredApplicationsPath, L"Fluxora");
        if (registered.has_value() && !registered->empty() &&
            *registered != CapabilitiesPath)
        {
            throw std::runtime_error(
                "The Fluxora RegisteredApplications name is owned by another capability.");
        }
        if (registry_.keyExists(ApplicationRegistrationPath) &&
            registry_.readString(ApplicationRegistrationPath, OwnerValueName) !=
                std::optional<std::wstring>(std::wstring(OwnerId)))
        {
            throw std::runtime_error(
                "The Fluxora manager capability is owned by another registration.");
        }
    }

    InstallationOwnershipService::InstallationOwnershipService(
        ICurrentUserRegistryStore& registry)
        : registry_(registry)
    {
    }

    void InstallationOwnershipService::validateClaim(
        const std::filesystem::path& applicationPath) const
    {
        const std::filesystem::path normalized =
            ProtocolRegistrationService::normalizeApplicationPath(
                applicationPath);
        if (!registry_.keyExists(OwnershipPath))
        {
            return;
        }
        if (registry_.readString(OwnershipPath, OwnerValueName) !=
            std::optional<std::wstring>(std::wstring(OwnerId)))
        {
            throw std::runtime_error(
                "The Fluxora installation ownership record belongs to another application.");
        }
        const std::optional<std::wstring> installed =
            registry_.readString(OwnershipPath, InstallPathValueName);
        if (!installed.has_value() || !pathEquals(*installed, normalized))
        {
            throw std::runtime_error(
                "Another Fluxora installation owns the per-user installation record.");
        }
    }

    void InstallationOwnershipService::claimPending(
        const std::filesystem::path& applicationPath) const
    {
        const std::filesystem::path normalized =
            ProtocolRegistrationService::normalizeApplicationPath(
                applicationPath);
        validateClaim(normalized);
        registry_.writeString(OwnershipPath, OwnerValueName, OwnerId);
        registry_.writeString(
            OwnershipPath,
            InstallPathValueName,
            normalized.wstring());
        registry_.writeString(
            OwnershipPath,
            StateValueName,
            PendingState);
    }

    void InstallationOwnershipService::claim(
        const std::filesystem::path& applicationPath) const
    {
        const std::filesystem::path normalized =
            ProtocolRegistrationService::normalizeApplicationPath(
                applicationPath);
        validateClaim(normalized);
        registry_.writeString(OwnershipPath, OwnerValueName, OwnerId);
        registry_.writeString(
            OwnershipPath,
            InstallPathValueName,
            normalized.wstring());
        registry_.writeString(
            OwnershipPath,
            StateValueName,
            CommittedState);
    }

    bool InstallationOwnershipService::release(
        const std::filesystem::path& applicationPath) const
    {
        if (!isOwned(applicationPath))
        {
            return false;
        }
        registry_.deleteTree(OwnershipPath);
        return true;
    }

    bool InstallationOwnershipService::isOwned(
        const std::filesystem::path& applicationPath) const
    {
        const std::filesystem::path normalized =
            ProtocolRegistrationService::normalizeApplicationPath(
                applicationPath);
        const std::optional<std::wstring> installed =
            registry_.readString(OwnershipPath, InstallPathValueName);
        const std::optional<std::wstring> state =
            registry_.readString(OwnershipPath, StateValueName);
        return registry_.readString(OwnershipPath, OwnerValueName) ==
                std::optional<std::wstring>(std::wstring(OwnerId)) &&
            installed.has_value() &&
            pathEquals(*installed, normalized) &&
            (!state.has_value() ||
             *state == PendingState ||
             *state == CommittedState);
    }

    std::optional<std::filesystem::path>
    InstallationOwnershipService::ownedApplicationPath() const
    {
        if (registry_.readString(OwnershipPath, OwnerValueName) !=
            std::optional<std::wstring>(std::wstring(OwnerId)))
        {
            return std::nullopt;
        }
        const std::optional<std::wstring> path =
            registry_.readString(OwnershipPath, InstallPathValueName);
        const std::optional<std::wstring> state =
            registry_.readString(OwnershipPath, StateValueName);
        if (!path.has_value() ||
            (state.has_value() &&
             *state != PendingState &&
             *state != CommittedState))
        {
            return std::nullopt;
        }
        try
        {
            return ProtocolRegistrationService::normalizeApplicationPath(*path);
        }
        catch (...)
        {
            return std::nullopt;
        }
    }

    std::filesystem::path WindowsDesktopShortcutStore::shortcutPath()
    {
        PWSTR desktop = nullptr;
        const HRESULT result = SHGetKnownFolderPath(
            FOLDERID_Desktop,
            KF_FLAG_DEFAULT,
            nullptr,
            &desktop);
        if (FAILED(result) || desktop == nullptr)
        {
            throw std::runtime_error("Desktop folder is unavailable.");
        }
        const std::filesystem::path path =
            std::filesystem::path(desktop) / L"Fluxora.lnk";
        CoTaskMemFree(desktop);
        return path;
    }

    std::optional<std::filesystem::path> WindowsDesktopShortcutStore::target() const
    {
        const std::filesystem::path shortcut = shortcutPath();
        const DWORD attributes = GetFileAttributesW(shortcut.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES)
        {
            if (GetLastError() == ERROR_FILE_NOT_FOUND ||
                GetLastError() == ERROR_PATH_NOT_FOUND)
            {
                return std::nullopt;
            }
            throw std::runtime_error("Desktop shortcut could not be inspected.");
        }
        if ((attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0)
        {
            throw std::runtime_error("Desktop shortcut path is unsafe.");
        }
        const ComApartment apartment;
        ComPtr<IShellLinkW> shellLink = createShellLink();
        ComPtr<IPersistFile> persistence = persistFile(*shellLink);
        requireHresult(
            persistence->Load(shortcut.c_str(), STGM_READ),
            "loading the existing shortcut");
        std::array<wchar_t, 32768> path{};
        WIN32_FIND_DATAW data{};
        requireHresult(
            shellLink->GetPath(
                path.data(),
                static_cast<int>(path.size()),
                &data,
                SLGP_RAWPATH),
            "reading the existing shortcut target");
        if (path[0] == L'\0')
        {
            throw std::runtime_error("Desktop shortcut has no target.");
        }
        return std::filesystem::path(path.data());
    }

    void WindowsDesktopShortcutStore::write(
        const std::filesystem::path& applicationPath)
    {
        const std::filesystem::path application =
            ProtocolRegistrationService::normalizeApplicationPath(applicationPath);
        const ComApartment apartment;
        ComPtr<IShellLinkW> shellLink = createShellLink();
        requireHresult(
            shellLink->SetPath(application.c_str()),
            "setting the shortcut target");
        requireHresult(
            shellLink->SetWorkingDirectory(application.parent_path().c_str()),
            "setting the shortcut working directory");
        requireHresult(
            shellLink->SetDescription(L"Fluxora Mod Manager"),
            "setting the shortcut description");
        requireHresult(
            shellLink->SetIconLocation(application.c_str(), 0),
            "setting the shortcut icon");
        ComPtr<IPersistFile> persistence = persistFile(*shellLink);
        const std::filesystem::path shortcut = shortcutPath();
        std::filesystem::create_directories(shortcut.parent_path());
        const std::filesystem::path temporary =
            allocateShortcutTemporaryPath(shortcut);
        try
        {
            requireHresult(
                persistence->Save(temporary.c_str(), TRUE),
                "saving the temporary shortcut");
            const bool exists = std::filesystem::exists(shortcut);
            const BOOL committed = exists
                ? ReplaceFileW(
                    shortcut.c_str(),
                    temporary.c_str(),
                    nullptr,
                    REPLACEFILE_WRITE_THROUGH,
                    nullptr,
                    nullptr)
                : MoveFileExW(
                    temporary.c_str(),
                    shortcut.c_str(),
                    MOVEFILE_WRITE_THROUGH);
            if (!committed)
            {
                throw std::runtime_error(
                    "Desktop shortcut could not be committed atomically.");
            }
        }
        catch (...)
        {
            DeleteFileW(temporary.c_str());
            throw;
        }
    }

    void WindowsDesktopShortcutStore::remove()
    {
        const std::filesystem::path shortcut = shortcutPath();
        if (!DeleteFileW(shortcut.c_str()))
        {
            const DWORD error = GetLastError();
            if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND)
            {
                throw std::system_error(
                    static_cast<int>(error),
                    std::system_category(),
                    "Desktop shortcut could not be removed");
            }
        }
    }

    WindowsUserIntegrationService::WindowsUserIntegrationService(
        ProtocolRegistrationService& protocol,
        IDesktopShortcutStore& shortcut,
        InstallationOwnershipService& ownership)
        : protocol_(protocol),
          shortcut_(shortcut),
          ownership_(ownership)
    {
    }

    void WindowsUserIntegrationService::validateConfigure(
        const std::filesystem::path& applicationPath,
        bool createDesktopShortcut) const
    {
        const std::filesystem::path application =
            ProtocolRegistrationService::normalizeApplicationPath(applicationPath);
        protocol_.validateInstallOrRepair(application);
        ownership_.validateClaim(application);
        const std::optional<std::filesystem::path> existing = shortcut_.target();
        const std::optional<std::filesystem::path> previouslyOwned =
            ownership_.ownedApplicationPath().has_value()
                ? ownership_.ownedApplicationPath()
                : protocol_.ownedApplicationPath();
        const bool shortcutIsOwned =
            !existing.has_value() ||
            pathEquals(*existing, application) ||
            (previouslyOwned.has_value() && pathEquals(*existing, *previouslyOwned));
        if (createDesktopShortcut && !shortcutIsOwned)
        {
            throw std::runtime_error(
                "The Fluxora desktop shortcut path is owned by another application.");
        }
    }

    WindowsIntegrationResult WindowsUserIntegrationService::configure(
        const std::filesystem::path& applicationPath,
        bool createDesktopShortcut) const
    {
        const std::filesystem::path application =
            ProtocolRegistrationService::normalizeApplicationPath(applicationPath);
        validateConfigure(application, createDesktopShortcut);
        const std::optional<std::filesystem::path> existing = shortcut_.target();
        const std::optional<std::filesystem::path> previouslyOwned =
            ownership_.ownedApplicationPath().has_value()
                ? ownership_.ownedApplicationPath()
                : protocol_.ownedApplicationPath();
        const bool shortcutIsOwned =
            existing.has_value() &&
            (pathEquals(*existing, application) ||
             (previouslyOwned.has_value() &&
              pathEquals(*existing, *previouslyOwned)));

        WindowsIntegrationResult result;
        if (!createDesktopShortcut && shortcutIsOwned)
        {
            shortcut_.remove();
            result.shortcutRemoved = true;
        }
        protocol_.installOrRepair(application);
        result.protocolConfigured = true;
        if (createDesktopShortcut)
        {
            shortcut_.write(application);
            result.shortcutConfigured = true;
        }
        ownership_.claim(application);
        return result;
    }

    WindowsIntegrationResult WindowsUserIntegrationService::unregisterOwned(
        const std::filesystem::path& applicationPath,
        bool removeDesktopShortcut) const
    {
        const std::filesystem::path application =
            ProtocolRegistrationService::normalizeApplicationPath(applicationPath);
        WindowsIntegrationResult result;
        const std::optional<std::filesystem::path> owned =
            ownership_.ownedApplicationPath().has_value()
                ? ownership_.ownedApplicationPath()
                : protocol_.ownedApplicationPath();
        if (!protocol_.isOwnedRegistration(application) ||
            !owned.has_value() ||
            !pathEquals(*owned, application))
        {
            return result;
        }
        if (removeDesktopShortcut)
        {
            const std::optional<std::filesystem::path> existing = shortcut_.target();
            if (existing.has_value() && pathEquals(*existing, application))
            {
                shortcut_.remove();
                result.shortcutRemoved = true;
            }
        }
        result.protocolRemoved = protocol_.uninstall(application);
        (void)ownership_.release(application);
        return result;
    }
}
