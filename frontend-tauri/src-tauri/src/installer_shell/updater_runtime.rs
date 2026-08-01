use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::contracts::{
    validate_operation_id, NativeFailure, UpdateOutcome, UpdateRequestSummary, UpdateResult,
    WindowActionResult, UPDATER_CLOSE_BLOCKED_EVENT, UPDATER_PROGRESS_EVENT,
};
use crate::native::NativeInstaller;

pub struct UpdaterRuntimeState {
    request_path: PathBuf,
    updater_exe_path: PathBuf,
    public_key_der: &'static [u8],
    summary: UpdateRequestSummary,
    active: Mutex<bool>,
    renderer_ready: Mutex<bool>,
}

fn sanitize_log_detail(detail: &str) -> String {
    let mut safe = detail
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();

    for scheme in ["https://", "http://"] {
        let mut offset = 0;
        while let Some(relative) = safe[offset..].find(scheme) {
            let begin = offset + relative;
            let end = safe[begin..]
                .find(|character: char| character.is_whitespace() || character == '"')
                .map(|relative| begin + relative)
                .unwrap_or(safe.len());
            safe.replace_range(begin..end, "<redacted-url>");
            offset = begin + "<redacted-url>".len();
        }
    }

    for key in ["token=", "authorization=", "signature=", "nonce="] {
        let mut offset = 0;
        while let Some(relative) = safe[offset..].find(key) {
            let value_begin = offset + relative + key.len();
            let value_end = safe[value_begin..]
                .find(|character: char| {
                    character.is_whitespace() || character == ',' || character == '"'
                })
                .map(|relative| value_begin + relative)
                .unwrap_or(safe.len());
            safe.replace_range(value_begin..value_end, "<redacted>");
            offset = value_begin + "<redacted>".len();
        }
    }

    let mut offset = 0;
    while offset < safe.len() {
        let remainder = &safe[offset..];
        let bytes = remainder.as_bytes();
        let drive_path = bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/');
        let unc_path = bytes.len() >= 2 && bytes[0] == b'\\' && bytes[1] == b'\\';
        if !drive_path && !unc_path {
            offset += remainder.chars().next().map(char::len_utf8).unwrap_or(1);
            continue;
        }
        let end = remainder
            .find(|character: char| {
                character.is_whitespace() || character == ',' || character == '"'
            })
            .map(|relative| offset + relative)
            .unwrap_or(safe.len());
        safe.replace_range(offset..end, "<redacted-path>");
        offset += "<redacted-path>".len();
    }

    const MAX_DETAIL_BYTES: usize = 2_048;
    if safe.len() > MAX_DETAIL_BYTES {
        let mut end = MAX_DETAIL_BYTES;
        while !safe.is_char_boundary(end) {
            end -= 1;
        }
        safe.truncate(end);
        safe.push_str("...");
    }
    safe
}

fn append_updater_failure_log(operation_id: &str, failure: &NativeFailure) {
    let Some(app_data) = std::env::var_os("APPDATA") else {
        return;
    };
    let log_directory = PathBuf::from(app_data).join("Fluxora").join("logs");
    if fs::create_dir_all(&log_directory).is_err() {
        return;
    }
    let path = log_directory.join(format!(
        "fluxora-updater-shell-{}.log",
        Utc::now().format("%Y%m%d")
    ));
    let Ok(mut output) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let detail = failure
        .technical_detail
        .as_deref()
        .map(sanitize_log_detail)
        .unwrap_or_else(|| "unavailable".to_string());
    let _ = writeln!(
        output,
        "{} [ERROR] operationId={} errorCode={} detail={}",
        Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        operation_id,
        failure.code,
        detail
    );
}

fn updater_window(app: &AppHandle) -> Result<tauri::WebviewWindow, NativeFailure> {
    app.get_webview_window("updater")
        .ok_or_else(updater_state_failure)
}

fn updater_state_failure() -> NativeFailure {
    NativeFailure::new(
        "updater.stateUnavailable",
        "updater.error.stateUnavailable",
        false,
    )
}

#[tauri::command]
async fn fluxora_updater_get_request_summary(
    state: State<'_, UpdaterRuntimeState>,
) -> Result<UpdateRequestSummary, NativeFailure> {
    Ok(state.summary.clone())
}

#[tauri::command]
async fn fluxora_updater_renderer_ready(
    app: AppHandle,
    state: State<'_, UpdaterRuntimeState>,
) -> Result<WindowActionResult, NativeFailure> {
    let mut renderer_ready = state
        .renderer_ready
        .lock()
        .map_err(|_| updater_state_failure())?;
    if !*renderer_ready {
        updater_window(&app)?.show().map_err(|error| {
            NativeFailure::new(
                "updater.windowShowFailed",
                "updater.error.windowActionFailed",
                true,
            )
            .with_detail(error.to_string())
        })?;
        *renderer_ready = true;
    }
    Ok(WindowActionResult {
        completed: true,
        reason_key: None,
    })
}

#[tauri::command]
async fn fluxora_updater_start_update(
    app: AppHandle,
    state: State<'_, UpdaterRuntimeState>,
) -> Result<UpdateResult, NativeFailure> {
    validate_operation_id(&state.summary.operation_id)?;
    if !*state
        .renderer_ready
        .lock()
        .map_err(|_| updater_state_failure())?
    {
        return Err(NativeFailure::new(
            "updater.rendererNotReady",
            "updater.error.stateUnavailable",
            true,
        ));
    }
    {
        let mut active = state.active.lock().map_err(|_| updater_state_failure())?;
        if *active {
            return Err(NativeFailure::new(
                "updater.alreadyRunning",
                "updater.error.alreadyRunning",
                false,
            ));
        }
        *active = true;
    }

    let request_path = state
        .request_path
        .to_str()
        .ok_or_else(|| {
            NativeFailure::new(
                "updater.nonUnicodePath",
                "updater.error.invalidRequest",
                false,
            )
        })?
        .to_string();
    let updater_exe_path = state
        .updater_exe_path
        .to_str()
        .ok_or_else(|| {
            NativeFailure::new(
                "updater.nonUnicodePath",
                "updater.error.invalidRequest",
                false,
            )
        })?
        .to_string();
    let public_key_der = state.public_key_der;
    let operation_id = state.summary.operation_id.clone();
    let progress_app = app.clone();
    let operation_for_native = operation_id.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        NativeInstaller::run_update_workflow(
            &request_path,
            &updater_exe_path,
            public_key_der,
            &operation_for_native,
            move |progress| {
                let _ = progress_app.emit(UPDATER_PROGRESS_EVENT, progress);
            },
        )
    })
    .await;
    *state.active.lock().map_err(|_| updater_state_failure())? = false;
    let native_result = joined.map_err(|error| {
        let failure = NativeFailure::new(
            "updater.nativeTaskFailed",
            "updater.error.workflowFailed",
            false,
        )
        .with_detail(error.to_string());
        append_updater_failure_log(&operation_id, &failure);
        failure
    })?;
    let result = native_result.map_err(|failure| {
        append_updater_failure_log(&operation_id, &failure);
        failure
    })?;
    if result.operation_id != state.summary.operation_id
        || result.target_version != state.summary.target_version
    {
        return Err(NativeFailure::new(
            "updater.resultMismatch",
            "updater.error.invalidNativeResponse",
            false,
        ));
    }
    if result.outcome == UpdateOutcome::Succeeded {
        updater_window(&app)?.close().map_err(|error| {
            NativeFailure::new(
                "updater.windowCloseFailed",
                "updater.error.windowActionFailed",
                true,
            )
            .with_detail(error.to_string())
        })?;
    }
    Ok(result)
}

#[tauri::command]
async fn fluxora_updater_minimize_window(
    app: AppHandle,
) -> Result<WindowActionResult, NativeFailure> {
    app.get_webview_window("updater")
        .ok_or_else(updater_state_failure)?
        .minimize()
        .map_err(|error| {
            NativeFailure::new(
                "updater.windowMinimizeFailed",
                "updater.error.windowActionFailed",
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
async fn fluxora_updater_request_close(
    app: AppHandle,
    state: State<'_, UpdaterRuntimeState>,
) -> Result<WindowActionResult, NativeFailure> {
    if *state.active.lock().map_err(|_| updater_state_failure())? {
        return Ok(WindowActionResult {
            completed: false,
            reason_key: Some("updater.closeBlocked".to_string()),
        });
    }
    app.get_webview_window("updater")
        .ok_or_else(updater_state_failure)?
        .close()
        .map_err(|error| {
            NativeFailure::new(
                "updater.windowCloseFailed",
                "updater.error.windowActionFailed",
                true,
            )
            .with_detail(error.to_string())
        })?;
    Ok(WindowActionResult {
        completed: true,
        reason_key: None,
    })
}

pub fn run_updater(
    request_path: PathBuf,
    updater_exe_path: PathBuf,
    public_key_der: &'static [u8],
    summary: UpdateRequestSummary,
) -> tauri::Result<()> {
    let state = UpdaterRuntimeState {
        request_path,
        updater_exe_path,
        public_key_der,
        summary,
        active: Mutex::new(false),
        renderer_ready: Mutex::new(false),
    };
    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            let state = app.state::<UpdaterRuntimeState>();
            let window = app.get_webview_window("updater").ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "updater window is unavailable",
                )
            })?;
            if state.summary.presentation == "setup-handoff" {
                window.set_resizable(true)?;
                window.set_size(tauri::LogicalSize::new(900.0, 640.0))?;
                window.set_min_size(Some(tauri::LogicalSize::new(760.0, 560.0)))?;
            } else {
                window.set_resizable(false)?;
                window.set_size(tauri::LogicalSize::new(560.0, 260.0))?;
                window.set_min_size(Some(tauri::LogicalSize::new(520.0, 240.0)))?;
            }
            window.center()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fluxora_updater_get_request_summary,
            fluxora_updater_renderer_ready,
            fluxora_updater_start_update,
            fluxora_updater_minimize_window,
            fluxora_updater_request_close
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<UpdaterRuntimeState>();
                if *state
                    .active
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                {
                    api.prevent_close();
                    let _ = window.emit(
                        UPDATER_CLOSE_BLOCKED_EVENT,
                        serde_json::json!({ "reasonKey": "updater.closeBlocked" }),
                    );
                }
            }
        })
        .run(tauri::generate_context!("updater/tauri.conf.json"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn updater_diagnostic_log_redacts_paths_urls_and_secret_like_values() {
        let sanitized = super::sanitize_log_detail(
            "failed at C:\\Users\\name\\package.flxupd from https://example.invalid/a token=secret nonce=abcdef",
        );

        assert!(!sanitized.contains("C:\\Users"));
        assert!(!sanitized.contains("https://example.invalid"));
        assert!(!sanitized.contains("secret"));
        assert!(!sanitized.contains("abcdef"));
        assert!(sanitized.contains("<redacted-path>"));
        assert!(sanitized.contains("<redacted-url>"));
        assert!(sanitized.contains("token=<redacted>"));
        assert!(sanitized.contains("nonce=<redacted>"));
    }

    #[test]
    fn updater_context_is_isolated_from_the_maximized_desktop_dev_window() {
        let context: tauri::Context<tauri::Wry> =
            tauri::generate_context!("updater/tauri.conf.json", test = true);
        let config = context.config();

        assert_eq!(config.identifier, "app.fluxora.updater");
        assert!(
            config.build.dev_url.is_none(),
            "the packaged Updater must never depend on a localhost dev server"
        );
        assert_eq!(config.app.windows.len(), 1);

        let window = &config.app.windows[0];
        assert_eq!(window.label, "updater");
        assert_eq!(window.width, 560.0);
        assert_eq!(window.height, 260.0);
        assert!(!window.maximized);
        assert!(!window.maximizable);
        assert!(!window.visible);
    }
}
