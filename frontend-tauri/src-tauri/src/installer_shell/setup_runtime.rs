use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;

use crate::contracts::{
    validate_operation_id, CancelResult, FolderPickerRequest, FolderPickerResult, InstallOptions,
    InstallOutcome, InstallPathRequest, InstallPathValidation, InstallResult, NativeFailure,
    OperationRequest, SetupBootstrapState, WindowActionResult, INSTALLER_SCHEMA_VERSION,
    SETUP_CLOSE_BLOCKED_EVENT, SETUP_PROGRESS_EVENT,
};
use crate::native::{InstallCancellation, NativeInstaller};
use crate::post_install_update::{self, InstalledSetupSession, PostInstallUpdateRuntime};
use crate::webview2_bootstrap::initial_language;

pub struct EmbeddedSetupRuntimeAssets {
    pub payload: &'static [u8],
    pub expanded_payload_bytes: u64,
}

struct ActiveInstall {
    operation_id: String,
    cancellation: Arc<InstallCancellation>,
}

#[derive(Default)]
struct SetupSession {
    active: Option<ActiveInstall>,
    operation_id: Option<String>,
    install_directory: Option<PathBuf>,
    application_path: Option<PathBuf>,
    installed_version: Option<String>,
    language: Option<String>,
    mode: Option<crate::contracts::SetupMode>,
}

pub struct SetupRuntimeState {
    payload: &'static [u8],
    expanded_payload_bytes: u64,
    webview2_version: Option<String>,
    session: Mutex<SetupSession>,
    post_install_update: PostInstallUpdateRuntime,
}

impl SetupRuntimeState {
    fn active_close_reason(&self) -> Option<&'static str> {
        let install_reason = {
            let session = self
                .session
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            session.active.as_ref().map(|active| {
                if active.cancellation.can_cancel() {
                    "setup.closeCancelsBeforeCommit"
                } else {
                    "setup.closeBlockedAfterCommit"
                }
            })
        };
        install_reason.or_else(|| self.post_install_update.close_reason())
    }

    fn installed_session(
        &self,
        operation_id: &str,
    ) -> Result<InstalledSetupSession, NativeFailure> {
        let session = self.session.lock().map_err(|_| setup_state_failure())?;
        if session.operation_id.as_deref() != Some(operation_id) {
            return Err(NativeFailure::new(
                "setup.installOperationMismatch",
                "setup.error.installResultUnavailable",
                false,
            ));
        }
        Ok(InstalledSetupSession {
            operation_id: operation_id.to_string(),
            install_directory: session.install_directory.clone().ok_or_else(|| {
                NativeFailure::new(
                    "setup.installResultUnavailable",
                    "setup.error.installResultUnavailable",
                    false,
                )
            })?,
            application_path: session.application_path.clone().ok_or_else(|| {
                NativeFailure::new(
                    "setup.installResultUnavailable",
                    "setup.error.installResultUnavailable",
                    false,
                )
            })?,
            installed_version: session.installed_version.clone().ok_or_else(|| {
                NativeFailure::new(
                    "setup.installResultUnavailable",
                    "setup.error.installResultUnavailable",
                    false,
                )
            })?,
            language: session.language.clone().unwrap_or_else(|| "en".to_string()),
            mode: session.mode.ok_or_else(|| {
                NativeFailure::new(
                    "setup.installResultUnavailable",
                    "setup.error.installResultUnavailable",
                    false,
                )
            })?,
        })
    }
}

fn setup_state_failure() -> NativeFailure {
    NativeFailure::new(
        "setup.stateUnavailable",
        "setup.error.stateUnavailable",
        false,
    )
}

fn trusted_expanded_payload_bytes(
    payload: &[u8],
    expanded_payload_bytes: u64,
) -> Result<u64, NativeFailure> {
    if payload.is_empty() {
        return Err(NativeFailure::new(
            "setup.payloadUnavailable",
            "setup.error.payloadUnavailable",
            false,
        )
        .with_action("setup.action.useOfficialInstaller"));
    }
    if expanded_payload_bytes == 0 {
        return Err(NativeFailure::new(
            "setup.payloadMetadataUnavailable",
            "setup.error.payloadUnavailable",
            false,
        )
        .with_action("setup.action.useOfficialInstaller"));
    }
    Ok(expanded_payload_bytes)
}

#[tauri::command]
async fn fluxora_setup_get_bootstrap_state(
    state: State<'_, SetupRuntimeState>,
) -> Result<SetupBootstrapState, NativeFailure> {
    let expanded_payload_bytes =
        trusted_expanded_payload_bytes(state.payload, state.expanded_payload_bytes)?;
    let native = NativeInstaller::setup_bootstrap(expanded_payload_bytes)?;
    Ok(SetupBootstrapState {
        schema_version: INSTALLER_SCHEMA_VERSION,
        language: initial_language().to_string(),
        default_install_directory: native.default_install_directory,
        mode: native.mode,
        installed_version: native.installed_version,
        required_bytes: native.required_bytes,
        free_bytes: native.free_bytes,
        is_owned_install: native.is_owned_install,
        payload_bytes: state.payload.len() as u64,
        webview2_version: state.webview2_version.clone(),
        native_available: NativeInstaller::is_available(),
    })
}

#[tauri::command]
async fn fluxora_setup_pick_install_folder(
    app: AppHandle,
    request: FolderPickerRequest,
) -> Result<FolderPickerResult, NativeFailure> {
    let title = match request.language.as_str() {
        "de" => "Fluxora-Installationsordner auswählen",
        "ru" => "Выберите папку установки Fluxora",
        _ => "Choose Fluxora installation folder",
    };
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(initial_directory) = request
        .initial_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        dialog = dialog.set_directory(initial_directory);
    }
    let selected = dialog.blocking_pick_folder();
    let path = match selected {
        Some(FilePath::Path(path)) => path.to_str().map(str::to_string),
        Some(FilePath::Url(_)) | None => None,
    };
    Ok(FolderPickerResult { path })
}

#[tauri::command]
async fn fluxora_setup_validate_install_path(
    request: InstallPathRequest,
    state: State<'_, SetupRuntimeState>,
) -> Result<InstallPathValidation, NativeFailure> {
    validate_operation_id(&request.operation_id)?;
    if request.install_directory.trim().is_empty() {
        return Err(NativeFailure::new(
            "setup.emptyInstallPath",
            "setup.error.emptyInstallPath",
            true,
        ));
    }
    let expanded_payload_bytes =
        trusted_expanded_payload_bytes(state.payload, state.expanded_payload_bytes)?;
    NativeInstaller::validate_install_path(request.install_directory.trim(), expanded_payload_bytes)
}

#[tauri::command]
async fn fluxora_setup_start_install(
    app: AppHandle,
    options: InstallOptions,
    state: State<'_, SetupRuntimeState>,
) -> Result<InstallResult, NativeFailure> {
    validate_operation_id(&options.operation_id)?;
    if !options.terms_accepted || !options.privacy_acknowledged {
        return Err(NativeFailure::new(
            "setup.legalAcknowledgementsRequired",
            "setup.error.legalAcknowledgementsRequired",
            true,
        ));
    }
    if options.install_directory.trim().is_empty() {
        return Err(NativeFailure::new(
            "setup.emptyInstallPath",
            "setup.error.emptyInstallPath",
            true,
        ));
    }
    let expanded_payload_bytes =
        trusted_expanded_payload_bytes(state.payload, state.expanded_payload_bytes)?;
    let _install_validation = NativeInstaller::validate_install_path(
        options.install_directory.trim(),
        expanded_payload_bytes,
    )?;

    let cancellation = Arc::new(InstallCancellation::new());
    {
        let mut session = state.session.lock().map_err(|_| setup_state_failure())?;
        if session.active.is_some() {
            return Err(NativeFailure::new(
                "setup.installAlreadyRunning",
                "setup.error.installAlreadyRunning",
                true,
            ));
        }
        session.active = Some(ActiveInstall {
            operation_id: options.operation_id.clone(),
            cancellation: cancellation.clone(),
        });
    }

    let payload = state.payload;
    let expanded_payload_bytes = expanded_payload_bytes;
    let app_for_progress = app.clone();
    let options_for_native = options.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        NativeInstaller::install_setup_payload_stream(
            payload,
            expanded_payload_bytes,
            &options_for_native,
            cancellation,
            move |progress| {
                let _ = app_for_progress.emit(SETUP_PROGRESS_EVENT, progress);
            },
        )
    })
    .await;

    let mut session = state.session.lock().map_err(|_| setup_state_failure())?;
    session.active = None;
    let result = joined.map_err(|error| {
        NativeFailure::new("setup.nativeTaskFailed", "setup.error.installFailed", false)
            .with_detail(error.to_string())
    })?;
    match result {
        Ok(native) => {
            let installed_version = app.package_info().version.to_string();
            let language = match options.language.as_str() {
                "de" => "de",
                "ru" => "ru",
                _ => "en",
            };
            session.operation_id = Some(options.operation_id.clone());
            session.install_directory = Some(PathBuf::from(&native.install_directory));
            session.application_path = Some(PathBuf::from(&native.application_path));
            session.installed_version = Some(installed_version.clone());
            session.language = Some(language.to_string());
            session.mode = Some(native.mode);
            Ok(InstallResult {
                schema_version: INSTALLER_SCHEMA_VERSION,
                operation_id: options.operation_id,
                outcome: InstallOutcome::Succeeded,
                install_directory: native.install_directory,
                application_path: native.application_path,
                installed_version,
                created_desktop_shortcut: native.created_desktop_shortcut,
            })
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
async fn fluxora_setup_start_post_install_update(
    app: AppHandle,
    request: OperationRequest,
    state: State<'_, SetupRuntimeState>,
) -> Result<crate::contracts::SetupPostInstallUpdateResult, NativeFailure> {
    validate_operation_id(&request.operation_id)?;
    let installed = state.installed_session(&request.operation_id)?;
    post_install_update::run(app, &state.post_install_update, installed).await
}

#[tauri::command]
async fn fluxora_setup_cancel_post_install_update(
    request: OperationRequest,
    state: State<'_, SetupRuntimeState>,
) -> Result<CancelResult, NativeFailure> {
    validate_operation_id(&request.operation_id)?;
    state.installed_session(&request.operation_id)?;
    state.post_install_update.cancel(&request.operation_id)
}

#[tauri::command]
async fn fluxora_setup_cancel_install(
    request: OperationRequest,
    state: State<'_, SetupRuntimeState>,
) -> Result<CancelResult, NativeFailure> {
    validate_operation_id(&request.operation_id)?;
    let session = state.session.lock().map_err(|_| setup_state_failure())?;
    let Some(active) = session.active.as_ref() else {
        return Ok(CancelResult {
            accepted: false,
            reason_key: Some("setup.cancel.noActiveInstall".to_string()),
        });
    };
    if active.operation_id != request.operation_id {
        return Ok(CancelResult {
            accepted: false,
            reason_key: Some("setup.cancel.operationMismatch".to_string()),
        });
    }
    let accepted = active.cancellation.request();
    Ok(CancelResult {
        accepted,
        reason_key: (!accepted).then(|| "setup.cancel.commitStarted".to_string()),
    })
}

fn stored_path(
    state: &SetupRuntimeState,
    operation_id: &str,
    selector: impl FnOnce(&SetupSession) -> Option<PathBuf>,
) -> Result<PathBuf, NativeFailure> {
    let session = state.session.lock().map_err(|_| setup_state_failure())?;
    if session.operation_id.as_deref() != Some(operation_id) {
        return Err(NativeFailure::new(
            "setup.installOperationMismatch",
            "setup.error.installResultUnavailable",
            false,
        ));
    }
    selector(&session).ok_or_else(|| {
        NativeFailure::new(
            "setup.installResultUnavailable",
            "setup.error.installResultUnavailable",
            false,
        )
    })
}

#[tauri::command]
async fn fluxora_setup_launch_app(
    app: AppHandle,
    request: OperationRequest,
    state: State<'_, SetupRuntimeState>,
) -> Result<WindowActionResult, NativeFailure> {
    validate_operation_id(&request.operation_id)?;
    let application_path = stored_path(&state, &request.operation_id, |session| {
        session.application_path.clone()
    })?;
    let working_directory = application_path.parent().ok_or_else(|| {
        NativeFailure::new(
            "setup.applicationPathInvalid",
            "setup.error.launchFailed",
            false,
        )
    })?;
    std::process::Command::new(&application_path)
        .current_dir(working_directory)
        .spawn()
        .map_err(|error| {
            NativeFailure::new("setup.launchFailed", "setup.error.launchFailed", true)
                .with_detail(error.to_string())
        })?;
    if let Some(window) = app.get_webview_window("setup") {
        window.close().map_err(|error| {
            NativeFailure::new(
                "setup.windowCloseFailed",
                "setup.error.windowActionFailed",
                true,
            )
            .with_detail(error.to_string())
        })?;
    }
    Ok(WindowActionResult {
        completed: true,
        reason_key: None,
    })
}

#[tauri::command]
async fn fluxora_setup_open_installed_folder(
    app: AppHandle,
    request: OperationRequest,
    state: State<'_, SetupRuntimeState>,
) -> Result<WindowActionResult, NativeFailure> {
    validate_operation_id(&request.operation_id)?;
    let install_directory = stored_path(&state, &request.operation_id, |session| {
        session.install_directory.clone()
    })?;
    let install_directory = install_directory.to_str().ok_or_else(|| {
        NativeFailure::new(
            "setup.nonUnicodePath",
            "setup.error.openFolderFailed",
            false,
        )
    })?;
    app.opener()
        .open_path(install_directory, None::<String>)
        .map_err(|error| {
            NativeFailure::new(
                "setup.openFolderFailed",
                "setup.error.openFolderFailed",
                true,
            )
            .with_detail(error.to_string())
        })?;
    Ok(WindowActionResult {
        completed: true,
        reason_key: None,
    })
}

#[tauri::command]
async fn fluxora_setup_reveal_logs(
    app: AppHandle,
    request: OperationRequest,
    state: State<'_, SetupRuntimeState>,
) -> Result<WindowActionResult, NativeFailure> {
    validate_operation_id(&request.operation_id)?;
    let install_directory = stored_path(&state, &request.operation_id, |session| {
        session.install_directory.clone()
    })?;
    let logs = install_directory.join("logs");
    let logs = logs.to_str().ok_or_else(|| {
        NativeFailure::new("setup.nonUnicodePath", "setup.error.openLogsFailed", false)
    })?;
    app.opener()
        .open_path(logs, None::<String>)
        .map_err(|error| {
            NativeFailure::new("setup.openLogsFailed", "setup.error.openLogsFailed", true)
                .with_detail(error.to_string())
        })?;
    Ok(WindowActionResult {
        completed: true,
        reason_key: None,
    })
}

#[tauri::command]
async fn fluxora_setup_minimize_window(
    app: AppHandle,
) -> Result<WindowActionResult, NativeFailure> {
    app.get_webview_window("setup")
        .ok_or_else(setup_state_failure)?
        .minimize()
        .map_err(|error| {
            NativeFailure::new(
                "setup.windowMinimizeFailed",
                "setup.error.windowActionFailed",
                true,
            )
            .with_detail(error.to_string())
        })?;
    Ok(WindowActionResult {
        completed: true,
        reason_key: None,
    })
}

#[tauri::command]
async fn fluxora_setup_request_close(
    app: AppHandle,
    state: State<'_, SetupRuntimeState>,
) -> Result<WindowActionResult, NativeFailure> {
    if let Some(reason_key) = state.active_close_reason() {
        return Ok(WindowActionResult {
            completed: false,
            reason_key: Some(reason_key.to_string()),
        });
    }
    app.get_webview_window("setup")
        .ok_or_else(setup_state_failure)?
        .close()
        .map_err(|error| {
            NativeFailure::new(
                "setup.windowCloseFailed",
                "setup.error.windowActionFailed",
                true,
            )
            .with_detail(error.to_string())
        })?;
    Ok(WindowActionResult {
        completed: true,
        reason_key: None,
    })
}

pub fn run_setup(
    assets: EmbeddedSetupRuntimeAssets,
    webview2_version: Option<String>,
) -> tauri::Result<()> {
    let state = SetupRuntimeState {
        payload: assets.payload,
        expanded_payload_bytes: assets.expanded_payload_bytes,
        webview2_version,
        session: Mutex::new(SetupSession::default()),
        post_install_update: PostInstallUpdateRuntime::default(),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            fluxora_setup_get_bootstrap_state,
            fluxora_setup_pick_install_folder,
            fluxora_setup_validate_install_path,
            fluxora_setup_start_install,
            fluxora_setup_cancel_install,
            fluxora_setup_start_post_install_update,
            fluxora_setup_cancel_post_install_update,
            fluxora_setup_launch_app,
            fluxora_setup_open_installed_folder,
            fluxora_setup_reveal_logs,
            fluxora_setup_minimize_window,
            fluxora_setup_request_close
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<SetupRuntimeState>();
                if let Some(reason_key) = state.active_close_reason() {
                    api.prevent_close();
                    let _ = window.emit(
                        SETUP_CLOSE_BLOCKED_EVENT,
                        serde_json::json!({ "reasonKey": reason_key }),
                    );
                }
            }
        })
        .run(tauri::generate_context!("setup/tauri.conf.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_context_is_isolated_from_the_maximized_desktop_dev_window() {
        let context: tauri::Context<tauri::Wry> =
            tauri::generate_context!("setup/tauri.conf.json", test = true);
        let config = context.config();

        assert_eq!(config.identifier, "app.fluxora.setup");
        assert!(
            config.build.dev_url.is_none(),
            "the distributable Setup must never depend on a localhost dev server"
        );
        assert_eq!(config.app.windows.len(), 1);

        let window = &config.app.windows[0];
        assert_eq!(window.label, "setup");
        assert_eq!(window.width, 900.0);
        assert_eq!(window.height, 640.0);
        assert!(!window.maximized);
        assert!(!window.maximizable);
    }

    #[test]
    fn trusted_expanded_size_never_falls_back_to_compressed_payload_length() {
        let compressed_payload = [0_u8; 17];
        let expanded_payload_bytes = 4_096;

        assert_eq!(
            trusted_expanded_payload_bytes(&compressed_payload, expanded_payload_bytes).unwrap(),
            expanded_payload_bytes
        );
        assert_ne!(
            expanded_payload_bytes,
            compressed_payload.len() as u64,
            "the native disk and install boundary must receive trusted expanded bytes"
        );
    }

    #[test]
    fn missing_payload_or_expanded_metadata_fails_closed() {
        assert_eq!(
            trusted_expanded_payload_bytes(&[], 4_096).unwrap_err().code,
            "setup.payloadUnavailable"
        );
        assert_eq!(
            trusted_expanded_payload_bytes(&[1], 0).unwrap_err().code,
            "setup.payloadMetadataUnavailable"
        );
    }

    #[test]
    fn installed_session_is_native_owned_and_pinned_to_the_root_operation() {
        let state = SetupRuntimeState {
            payload: &[1],
            expanded_payload_bytes: 1,
            webview2_version: None,
            session: Mutex::new(SetupSession {
                active: None,
                operation_id: Some("setup-root".to_string()),
                install_directory: Some(PathBuf::from(r"C:\Fluxora Installed")),
                application_path: Some(PathBuf::from(r"C:\Fluxora Installed\Fluxora.exe")),
                installed_version: Some("2.5.0".to_string()),
                language: Some("ru".to_string()),
                mode: Some(crate::contracts::SetupMode::Repair),
            }),
            post_install_update: PostInstallUpdateRuntime::default(),
        };

        let installed = state.installed_session("setup-root").unwrap();
        assert_eq!(installed.installed_version, "2.5.0");
        assert_eq!(installed.language, "ru");
        assert_eq!(installed.mode, crate::contracts::SetupMode::Repair);
        assert!(state.installed_session("foreign-root").is_err());
    }
}
