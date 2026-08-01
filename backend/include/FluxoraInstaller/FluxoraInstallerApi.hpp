#pragma once

#include <cstdint>

#if defined(FLUXORA_INSTALLER_STATIC)
#define FLUXORA_INSTALLER_API
#elif defined(_WIN32) && defined(FLUXORA_INSTALLER_EXPORTS)
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

    // enterCommitBoundary=0 queries cancellation while work is still reversible.
    // enterCommitBoundary=1 must atomically reject later cancellation and return
    // non-zero only when cancellation had already been accepted.
    typedef int (FLUXORA_INSTALLER_CALL *FluxoraInstallerCancelCallback)(
        int enterCommitBoundary,
        void* userData);

    enum FluxoraInstallerResult
    {
        FluxoraInstallerResultOk = 0,
        FluxoraInstallerResultInvalidArgument = 1,
        FluxoraInstallerResultBufferTooSmall = 2,
        FluxoraInstallerResultPackageError = 3,
        FluxoraInstallerResultInstallError = 4,
        FluxoraInstallerResultRecoveryError = 5,
        FluxoraInstallerResultBusy = 6,
        FluxoraInstallerResultProcessIdentityError = 7,
        FluxoraInstallerResultHealthError = 8,
        FluxoraInstallerResultWindowsIntegrationError = 9,
        FluxoraInstallerResultWorkflowError = 10,
        FluxoraInstallerResultCancelled = 11
    };

    FLUXORA_INSTALLER_API int fluxora_installer_is_available() noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_set_operation_context(
        const wchar_t* operationId) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_validate_install_directory(
        const wchar_t* installDirectory,
        wchar_t* messageBuffer,
        int messageBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_install_package(
        const wchar_t* packagePath,
        const wchar_t* installDirectory,
        int createDesktopShortcut,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_install_package_stream(
        FluxoraInstallerReadCallback readCallback,
        void* readUserData,
        const wchar_t* installDirectory,
        int createDesktopShortcut,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    // Setup-only high-level boundary. Revalidates ownership and free space under
    // the per-install lock, commits the streamed payload, then configures the
    // owned HKCU protocol registration and optional owned desktop shortcut.
    FLUXORA_INSTALLER_API int fluxora_installer_install_setup_payload_stream(
        FluxoraInstallerReadCallback readCallback,
        void* readUserData,
        const wchar_t* installDirectory,
        std::uint64_t expandedPayloadBytes,
        int createDesktopShortcut,
        const wchar_t* operationId,
        FluxoraInstallerCancelCallback cancelCallback,
        void* cancelUserData,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_apply_update(
        const wchar_t* manifestPath,
        const wchar_t* signaturePath,
        const wchar_t* packagePath,
        const wchar_t* installDirectory,
        const wchar_t* currentVersion,
        const wchar_t* targetVersion,
        const wchar_t* target,
        int assetKind,
        const wchar_t* fromVersion,
        const wchar_t* expectedPackageSha256,
        std::uint64_t expectedPackageSize,
        const wchar_t* applicationExecutable,
        const unsigned char* publicKeyDer,
        std::uint32_t publicKeyDerLength,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    // Direct native callers must serialize recover/apply/finalize/rollback for the
    // same normalized installation directory across processes. FluxoraUpdater owns
    // the canonical per-install Local named mutex across the complete health window.

    FLUXORA_INSTALLER_API int fluxora_installer_recover_update(
        const wchar_t* installDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_finalize_update(
        const wchar_t* installDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_rollback_update(
        const wchar_t* installDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_get_setup_bootstrap_state(
        std::uint64_t expandedPayloadBytes,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_validate_install_options(
        const wchar_t* installDirectory,
        std::uint64_t expandedPayloadBytes,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_load_update_request(
        const wchar_t* requestPath,
        const wchar_t* updaterExecutablePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_run_update_workflow(
        const wchar_t* requestPath,
        const wchar_t* updaterExecutablePath,
        const unsigned char* publicKeyDer,
        std::uint32_t publicKeyDerLength,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_run_recovery(
        const wchar_t* requestPath,
        const wchar_t* updaterExecutablePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_run_recovery_watchdog(
        const wchar_t* requestPath,
        const wchar_t* updaterExecutablePath,
        std::uint32_t ownerPid,
        std::uint64_t ownerStartFileTime,
        const wchar_t* readyEventName,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_configure_user_integration(
        const wchar_t* applicationExecutablePath,
        int createDesktopShortcut,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_repair_user_integration(
        const wchar_t* applicationExecutablePath,
        int createDesktopShortcut,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_unregister_user_integration(
        const wchar_t* applicationExecutablePath,
        int removeDesktopShortcut,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_repair_manager_protocol(
        const wchar_t* applicationExecutablePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_unregister_manager_protocol(
        const wchar_t* applicationExecutablePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength) noexcept;

    FLUXORA_INSTALLER_API int fluxora_installer_get_last_error(
        wchar_t* messageBuffer,
        int messageBufferLength) noexcept;
}
