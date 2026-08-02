#include "FluxoraInstaller/SetupBootstrapService.hpp"

#include "FluxoraInstaller/UpdateWorkflowRequest.hpp"

#include <algorithm>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <winver.h>

#ifndef FLUXORA_PRODUCT_VERSION
#define FLUXORA_PRODUCT_VERSION "0.0.0"
#endif

namespace
{
    constexpr std::uint64_t InstallSafetyBytes = 64ULL * 1024ULL * 1024ULL;

    std::filesystem::path defaultLocalAppDataRoot()
    {
        const DWORD required = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
        if (required == 0)
        {
            throw std::runtime_error("Local application data directory is unavailable.");
        }
        std::wstring value(static_cast<std::size_t>(required), L'\0');
        const DWORD actual = GetEnvironmentVariableW(
            L"LOCALAPPDATA",
            value.data(),
            required);
        if (actual == 0 || actual >= required)
        {
            throw std::runtime_error("Local application data directory is unavailable.");
        }
        value.resize(actual);
        return value;
    }

    std::wstring jsonEscape(std::wstring_view value)
    {
        std::wstring result;
        result.reserve(value.size() + 8);
        for (const wchar_t character : value)
        {
            if (character == L'"')
            {
                result += L"\\\"";
            }
            else if (character == L'\\')
            {
                result += L"\\\\";
            }
            else if (character < 0x20)
            {
                throw std::invalid_argument("Setup JSON contains a control character.");
            }
            else
            {
                result.push_back(character);
            }
        }
        return result;
    }

    const wchar_t* modeName(fluxora::installer::SetupInstallMode mode)
    {
        switch (mode)
        {
        case fluxora::installer::SetupInstallMode::Install:
            return L"install";
        case fluxora::installer::SetupInstallMode::Repair:
            return L"repair";
        case fluxora::installer::SetupInstallMode::Update:
            return L"update";
        case fluxora::installer::SetupInstallMode::Downgrade:
            return L"downgrade";
        }
        return L"install";
    }

    const wchar_t* statusName(fluxora::installer::SetupValidationStatus status)
    {
        switch (status)
        {
        case fluxora::installer::SetupValidationStatus::Valid:
            return L"valid";
        case fluxora::installer::SetupValidationStatus::InsufficientSpace:
            return L"insufficient-space";
        case fluxora::installer::SetupValidationStatus::ForeignInstall:
            return L"foreign-install";
        case fluxora::installer::SetupValidationStatus::InvalidPath:
            return L"invalid-path";
        }
        return L"invalid-path";
    }

    std::filesystem::path canonicalInstallPath(const std::filesystem::path& input)
    {
        if (input.empty() || !input.is_absolute())
        {
            throw std::invalid_argument("Install directory must be absolute.");
        }
        const std::wstring raw = input.wstring();
        if (raw.find(L'\0') != std::wstring::npos)
        {
            throw std::invalid_argument("Install directory contains an embedded NUL.");
        }
        const DWORD required = GetFullPathNameW(raw.c_str(), 0, nullptr, nullptr);
        if (required == 0)
        {
            throw std::invalid_argument("Install directory could not be normalized.");
        }
        std::wstring value(static_cast<std::size_t>(required), L'\0');
        const DWORD actual = GetFullPathNameW(
            raw.c_str(),
            required,
            value.data(),
            nullptr);
        if (actual == 0 || actual >= required)
        {
            throw std::invalid_argument("Install directory could not be normalized.");
        }
        value.resize(actual);
        std::filesystem::path normalized =
            std::filesystem::path(value).lexically_normal();
        if (normalized == normalized.root_path())
        {
            throw std::invalid_argument("Install directory cannot be a drive root.");
        }
        return normalized;
    }

    bool pathEquals(
        const std::filesystem::path& left,
        const std::filesystem::path& right)
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

    void rejectReparseAncestors(const std::filesystem::path& path)
    {
        std::filesystem::path current = path;
        for (;;)
        {
            const DWORD attributes = GetFileAttributesW(current.c_str());
            if (attributes != INVALID_FILE_ATTRIBUTES)
            {
                if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                {
                    throw std::invalid_argument(
                        "Install directory cannot traverse a reparse point.");
                }
            }
            else
            {
                const DWORD error = GetLastError();
                if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND)
                {
                    throw std::invalid_argument("Install directory could not be inspected.");
                }
            }
            const std::filesystem::path parent = current.parent_path();
            if (parent.empty() || pathEquals(parent, current))
            {
                return;
            }
            current = parent;
        }
    }

    std::filesystem::path existingDiskProbe(std::filesystem::path path)
    {
        while (!path.empty())
        {
            const DWORD attributes = GetFileAttributesW(path.c_str());
            if (attributes != INVALID_FILE_ATTRIBUTES &&
                (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0)
            {
                return path;
            }
            const std::filesystem::path parent = path.parent_path();
            if (parent.empty() || pathEquals(parent, path))
            {
                break;
            }
            path = parent;
        }
        throw std::invalid_argument("Install directory volume is unavailable.");
    }

    std::uint64_t freeBytesFor(const std::filesystem::path& path)
    {
        ULARGE_INTEGER available{};
        if (!GetDiskFreeSpaceExW(
                existingDiskProbe(path).c_str(),
                &available,
                nullptr,
                nullptr))
        {
            throw std::runtime_error("Install directory free space is unavailable.");
        }
        return available.QuadPart;
    }

    void requireWritableSetupLocation(
        const std::filesystem::path& installDirectory)
    {
        const std::filesystem::path probeDirectory =
            existingDiskProbe(installDirectory);
        const std::wstring stem =
            L".fluxora-write-probe-" +
            std::to_wstring(GetCurrentProcessId()) + L"-" +
            std::to_wstring(GetCurrentThreadId()) + L"-" +
            std::to_wstring(GetTickCount64()) + L"-";
        for (std::uint64_t attempt = 0; attempt < 64; ++attempt)
        {
            const std::filesystem::path candidate =
                probeDirectory /
                (stem + std::to_wstring(attempt) + L".tmp");
            const HANDLE file = CreateFileW(
                candidate.c_str(),
                GENERIC_WRITE | DELETE,
                FILE_SHARE_DELETE,
                nullptr,
                CREATE_NEW,
                FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE,
                nullptr);
            if (file == INVALID_HANDLE_VALUE)
            {
                const DWORD error = GetLastError();
                if (error == ERROR_FILE_EXISTS ||
                    error == ERROR_ALREADY_EXISTS)
                {
                    continue;
                }
                throw std::invalid_argument(
                    "Install directory is not writable by the current user.");
            }

            const std::byte value{0x46};
            DWORD written = 0;
            const BOOL writeSucceeded = WriteFile(
                file,
                &value,
                sizeof(value),
                &written,
                nullptr);
            const DWORD writeError =
                writeSucceeded ? ERROR_SUCCESS : GetLastError();
            CloseHandle(file);
            if (!writeSucceeded || written != sizeof(value))
            {
                (void)writeError;
                throw std::invalid_argument(
                    "Install directory is not writable by the current user.");
            }
            return;
        }
        throw std::invalid_argument(
            "Install directory writability could not be verified safely.");
    }

    bool directoryHasEntries(const std::filesystem::path& path)
    {
        std::error_code error;
        const bool directory = std::filesystem::is_directory(path, error);
        if (error || !directory)
        {
            return false;
        }
        const auto iterator = std::filesystem::directory_iterator(path, error);
        if (error)
        {
            throw std::runtime_error("Install directory contents could not be inspected.");
        }
        return iterator != std::filesystem::directory_iterator{};
    }

    std::uint64_t measuredDirectoryBytes(const std::filesystem::path& root)
    {
        const DWORD rootAttributes = GetFileAttributesW(root.c_str());
        if (rootAttributes == INVALID_FILE_ATTRIBUTES)
        {
            const DWORD error = GetLastError();
            if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND)
            {
                return 0;
            }
            throw std::runtime_error(
                "Protected setup data could not be inspected.");
        }
        if ((rootAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
            (rootAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0)
        {
            throw std::invalid_argument(
                "Protected setup data must be a regular directory without reparse points.");
        }

        std::error_code error;
        std::filesystem::recursive_directory_iterator iterator(
            root,
            std::filesystem::directory_options::none,
            error);
        if (error)
        {
            throw std::runtime_error(
                "Protected setup data could not be enumerated.");
        }
        const std::filesystem::recursive_directory_iterator end;
        std::uint64_t total = 0;
        for (; iterator != end; iterator.increment(error))
        {
            if (error)
            {
                throw std::runtime_error(
                    "Protected setup data could not be enumerated.");
            }
            const DWORD attributes = GetFileAttributesW(iterator->path().c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES)
            {
                throw std::runtime_error(
                    "Protected setup data changed while it was being measured.");
            }
            if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            {
                throw std::invalid_argument(
                    "Protected setup data cannot contain reparse points.");
            }
            if ((attributes & FILE_ATTRIBUTE_DIRECTORY) != 0)
            {
                continue;
            }
            if ((attributes & FILE_ATTRIBUTE_DEVICE) != 0)
            {
                throw std::invalid_argument(
                    "Protected setup data contains an unsupported filesystem entry.");
            }
            const std::uintmax_t size = iterator->file_size(error);
            if (error || size > std::numeric_limits<std::uint64_t>::max() - total)
            {
                throw std::runtime_error(
                    "Protected setup data size could not be measured safely.");
            }
            total += static_cast<std::uint64_t>(size);
        }
        return total;
    }

    std::uint64_t measuredProtectedDataBytes(
        const std::filesystem::path& installDirectory)
    {
        const std::uint64_t downloads =
            measuredDirectoryBytes(installDirectory / L"Downloads");
        const std::uint64_t logs =
            measuredDirectoryBytes(installDirectory / L"logs");
        if (logs > std::numeric_limits<std::uint64_t>::max() - downloads)
        {
            throw std::runtime_error(
                "Protected setup data size could not be measured safely.");
        }
        return downloads + logs;
    }

    std::string executableProductVersion(const std::filesystem::path& executable)
    {
        DWORD ignored = 0;
        const DWORD size = GetFileVersionInfoSizeW(executable.c_str(), &ignored);
        if (size == 0)
        {
            return {};
        }
        std::vector<std::byte> data(size);
        if (!GetFileVersionInfoW(
                executable.c_str(),
                0,
                size,
                data.data()))
        {
            return {};
        }
        VS_FIXEDFILEINFO* info = nullptr;
        UINT bytes = 0;
        if (!VerQueryValueW(
                data.data(),
                L"\\",
                reinterpret_cast<void**>(&info),
                &bytes) ||
            info == nullptr ||
            bytes < sizeof(VS_FIXEDFILEINFO) ||
            info->dwSignature != 0xFEEF04BD)
        {
            return {};
        }
        return std::to_string(HIWORD(info->dwProductVersionMS)) + "." +
            std::to_string(LOWORD(info->dwProductVersionMS)) + "." +
            std::to_string(HIWORD(info->dwProductVersionLS));
    }

    int compareThreePartSemanticVersions(
        std::string_view left,
        std::string_view right)
    {
        std::size_t leftPosition = 0;
        std::size_t rightPosition = 0;
        for (int component = 0; component < 3; ++component)
        {
            const std::size_t leftEnd = left.find('.', leftPosition);
            const std::size_t rightEnd = right.find('.', rightPosition);
            const std::string_view leftComponent = left.substr(
                leftPosition,
                leftEnd == std::string_view::npos
                    ? std::string_view::npos
                    : leftEnd - leftPosition);
            const std::string_view rightComponent = right.substr(
                rightPosition,
                rightEnd == std::string_view::npos
                    ? std::string_view::npos
                    : rightEnd - rightPosition);
            if (leftComponent.size() != rightComponent.size())
            {
                return leftComponent.size() < rightComponent.size() ? -1 : 1;
            }
            const int comparison = leftComponent.compare(rightComponent);
            if (comparison != 0)
            {
                return comparison < 0 ? -1 : 1;
            }
            leftPosition = leftEnd == std::string_view::npos
                ? left.size()
                : leftEnd + 1;
            rightPosition = rightEnd == std::string_view::npos
                ? right.size()
                : rightEnd + 1;
        }
        return 0;
    }
}

namespace fluxora::installer
{
    SetupBootstrapService::SetupBootstrapService(
        ICurrentUserRegistryStore& registry,
        std::filesystem::path localAppDataRoot,
        std::string productVersion,
        SetupWritabilityProbe writabilityProbe,
        SetupInstalledVersionProbe installedVersionProbe)
        : registry_(registry),
          localAppDataRoot_(
              localAppDataRoot.empty()
                  ? defaultLocalAppDataRoot()
                  : std::move(localAppDataRoot)),
          productVersion_(
              productVersion.empty()
                  ? std::string(FLUXORA_PRODUCT_VERSION)
                  : std::move(productVersion)),
          writabilityProbe_(
              writabilityProbe
                  ? std::move(writabilityProbe)
                  : SetupWritabilityProbe(requireWritableSetupLocation)),
          installedVersionProbe_(
              installedVersionProbe
                  ? std::move(installedVersionProbe)
                  : SetupInstalledVersionProbe(executableProductVersion))
    {
        if (!localAppDataRoot_.is_absolute() ||
            !isThreePartSemanticVersion(productVersion_))
        {
            throw std::invalid_argument(
                "Setup product version or local application data root is invalid.");
        }
    }

    SetupBootstrapState SetupBootstrapService::bootstrap(
        std::uint64_t expandedPayloadBytes) const
    {
        ProtocolRegistrationService protocol(registry_);
        InstallationOwnershipService ownership(registry_);
        std::optional<std::filesystem::path> discovered =
            ownership.ownedApplicationPath();
        if (!discovered.has_value())
        {
            discovered = protocol.ownedApplicationPath();
        }
        const std::filesystem::path destination =
            discovered.has_value()
                ? discovered->parent_path()
                : localAppDataRoot_ / L"Programs" / L"Fluxora";
        const SetupInstallValidation validation = inspect(
            destination,
            expandedPayloadBytes);
        SetupBootstrapState state;
        state.defaultInstallDirectory = validation.normalizedInstallDirectory;
        state.mode = validation.mode;
        state.requiredBytes = validation.requiredBytes;
        state.freeBytes = validation.freeBytes;
        state.isOwnedInstall = validation.isOwnedInstall;
        if (state.isOwnedInstall)
        {
            state.installedVersion = installedVersionProbe_(
                state.defaultInstallDirectory / L"Fluxora.exe");
        }
        return state;
    }

    SetupInstallValidation SetupBootstrapService::validate(
        const std::filesystem::path& installDirectory,
        std::uint64_t expandedPayloadBytes) const
    {
        try
        {
            return inspect(installDirectory, expandedPayloadBytes);
        }
        catch (const std::invalid_argument&)
        {
            SetupInstallValidation result;
            result.status = SetupValidationStatus::InvalidPath;
            result.code = "setup-invalid-path";
            result.messageKey = "setup.validation.invalidPath";
            result.requiredBytes = requiredBytes(expandedPayloadBytes);
            return result;
        }
    }

    std::wstring SetupBootstrapService::serialize(
        const SetupBootstrapState& state)
    {
        std::wostringstream json;
        json << L"{\"schemaVersion\":1"
             << L",\"defaultInstallDirectory\":\""
             << jsonEscape(state.defaultInstallDirectory.wstring()) << L"\""
             << L",\"mode\":\"" << modeName(state.mode) << L"\"";
        if (!state.installedVersion.empty())
        {
            const std::wstring installed(
                state.installedVersion.begin(),
                state.installedVersion.end());
            json << L",\"installedVersion\":\""
                 << jsonEscape(installed) << L"\"";
        }
        json << L",\"requiredBytes\":" << state.requiredBytes
             << L",\"freeBytes\":" << state.freeBytes
             << L",\"isOwnedInstall\":"
             << (state.isOwnedInstall ? L"true" : L"false")
             << L"}";
        return json.str();
    }

    std::wstring SetupBootstrapService::serialize(
        const SetupInstallValidation& validation)
    {
        const std::wstring code(validation.code.begin(), validation.code.end());
        const std::wstring messageKey(
            validation.messageKey.begin(),
            validation.messageKey.end());
        std::wostringstream json;
        json << L"{\"schemaVersion\":1"
             << L",\"status\":\"" << statusName(validation.status) << L"\""
             << L",\"code\":\"" << jsonEscape(code) << L"\""
             << L",\"messageKey\":\"" << jsonEscape(messageKey) << L"\""
             << L",\"normalizedInstallDirectory\":\""
             << jsonEscape(validation.normalizedInstallDirectory.wstring()) << L"\""
             << L",\"requiredBytes\":" << validation.requiredBytes
             << L",\"freeBytes\":" << validation.freeBytes
             << L",\"mode\":\"" << modeName(validation.mode) << L"\""
             << L",\"isOwnedInstall\":"
             << (validation.isOwnedInstall ? L"true" : L"false")
             << L"}";
        return json.str();
    }

    std::uint64_t SetupBootstrapService::requiredBytes(
        std::uint64_t expandedPayloadBytes,
        std::uint64_t protectedDataBytes) const
    {
        if (expandedPayloadBytes == 0 ||
            expandedPayloadBytes >
                std::numeric_limits<std::uint64_t>::max() - InstallSafetyBytes ||
            protectedDataBytes >
                std::numeric_limits<std::uint64_t>::max() -
                    expandedPayloadBytes - InstallSafetyBytes)
        {
            throw std::invalid_argument("Setup payload size is invalid.");
        }
        return expandedPayloadBytes + protectedDataBytes + InstallSafetyBytes;
    }

    SetupInstallValidation SetupBootstrapService::inspect(
        const std::filesystem::path& installDirectory,
        std::uint64_t expandedPayloadBytes) const
    {
        SetupInstallValidation result;
        result.normalizedInstallDirectory = canonicalInstallPath(installDirectory);
        rejectReparseAncestors(result.normalizedInstallDirectory);

        const std::filesystem::path application =
            result.normalizedInstallDirectory / L"Fluxora.exe";
        const bool applicationExists =
            std::filesystem::is_regular_file(application);
        ProtocolRegistrationService protocol(registry_);
        InstallationOwnershipService ownership(registry_);
        const std::optional<std::filesystem::path> durableOwned =
            ownership.ownedApplicationPath();
        const std::optional<std::filesystem::path> legacyOwned =
            protocol.ownedApplicationPath();
        result.isOwnedInstall =
            (durableOwned.has_value() &&
             pathEquals(*durableOwned, application)) ||
            (legacyOwned.has_value() &&
             pathEquals(*legacyOwned, application));
        const bool ownedInstallExistsElsewhere =
            durableOwned.has_value() &&
            !pathEquals(*durableOwned, application);
        if (result.isOwnedInstall)
        {
            const std::string installedVersion = installedVersionProbe_(application);
            if (installedVersion.empty() ||
                !isThreePartSemanticVersion(installedVersion) ||
                installedVersion == productVersion_)
            {
                result.mode = SetupInstallMode::Repair;
            }
            else if (compareThreePartSemanticVersions(
                         installedVersion,
                         productVersion_) > 0)
            {
                result.mode = SetupInstallMode::Downgrade;
            }
            else
            {
                result.mode = SetupInstallMode::Update;
            }
        }
        else
        {
            result.mode = SetupInstallMode::Install;
        }
        const std::uint64_t protectedDataBytes = result.isOwnedInstall
            ? measuredProtectedDataBytes(result.normalizedInstallDirectory)
            : 0;
        result.requiredBytes = requiredBytes(
            expandedPayloadBytes,
            protectedDataBytes);
        result.freeBytes = freeBytesFor(result.normalizedInstallDirectory);

        if (ownedInstallExistsElsewhere)
        {
            result.status = SetupValidationStatus::ForeignInstall;
            result.code = "setup-owned-install-elsewhere";
            result.messageKey = "setup.validation.ownedInstallElsewhere";
        }
        else if (!result.isOwnedInstall &&
            (applicationExists || directoryHasEntries(result.normalizedInstallDirectory)))
        {
            result.status = SetupValidationStatus::ForeignInstall;
            result.code = "setup-foreign-install";
            result.messageKey = "setup.validation.foreignInstall";
        }
        else
        {
            try
            {
                writabilityProbe_(result.normalizedInstallDirectory);
            }
            catch (const std::exception&)
            {
                result.status = SetupValidationStatus::InvalidPath;
                result.code = "setup-not-writable";
                result.messageKey = "setup.validation.notWritable";
                return result;
            }
            if (result.freeBytes < result.requiredBytes)
            {
                result.status = SetupValidationStatus::InsufficientSpace;
                result.code = "setup-insufficient-space";
                result.messageKey = "setup.validation.insufficientSpace";
            }
            else
            {
                result.status = SetupValidationStatus::Valid;
                result.code = "ok";
                result.messageKey = "setup.validation.valid";
            }
        }
        return result;
    }
}
