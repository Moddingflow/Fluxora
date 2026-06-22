#pragma once

#include <cstdint>

#if defined(_WIN32) && defined(FLUXORA_INSTALLER_EXPORTS)
#define FLUXORA_INSTALLER_API __declspec(dllexport)
#elif defined(_WIN32)
#define FLUXORA_INSTALLER_API __declspec(dllimport)
#else
#define FLUXORA_INSTALLER_API
#endif

#if defined(_MSC_VER)
#define FLUXORA_INSTALLER_CALL __cdecl
#else
#define FLUXORA_INSTALLER_CALL
#endif

extern "C"
{
    typedef void (FLUXORA_INSTALLER_CALL *FluxoraInstallerProgressCallback)(
        const wchar_t* progressJson,
        void* userData);

    typedef std::int64_t (FLUXORA_INSTALLER_CALL *FluxoraInstallerReadCallback)(
        void* buffer,
        std::uint64_t byteCount,
        void* userData);

    enum FluxoraInstallerResult
    {
        FluxoraInstallerResultOk = 0,
        FluxoraInstallerResultInvalidArgument = 1,
        FluxoraInstallerResultBufferTooSmall = 2,
        FluxoraInstallerResultPackageError = 3,
        FluxoraInstallerResultInstallError = 4
    };

    FLUXORA_INSTALLER_API int fluxora_installer_is_available();

    FLUXORA_INSTALLER_API int fluxora_installer_set_operation_context(
        const wchar_t* operationId);

    FLUXORA_INSTALLER_API int fluxora_installer_validate_install_directory(
        const wchar_t* installDirectory,
        wchar_t* messageBuffer,
        int messageBufferLength);

    FLUXORA_INSTALLER_API int fluxora_installer_install_package(
        const wchar_t* packagePath,
        const wchar_t* installDirectory,
        int createDesktopShortcut,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_INSTALLER_API int fluxora_installer_install_package_stream(
        FluxoraInstallerReadCallback readCallback,
        void* readUserData,
        const wchar_t* installDirectory,
        int createDesktopShortcut,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_INSTALLER_API int fluxora_installer_get_last_error(
        wchar_t* messageBuffer,
        int messageBufferLength);
}
