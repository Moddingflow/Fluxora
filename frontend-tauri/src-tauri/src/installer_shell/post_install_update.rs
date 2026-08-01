use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use semver::Version;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use crate::contracts::{
    CancelResult, NativeFailure, SetupMode, SetupPostInstallUpdateOutcome,
    SetupPostInstallUpdateProgress, SetupPostInstallUpdateResult, SetupPostInstallUpdateState,
    INSTALLER_SCHEMA_VERSION, SETUP_POST_INSTALL_UPDATE_PROGRESS_EVENT,
};
use crate::update_shared::{
    self, HandoffInput, UpdateDecision, UpdateServiceError, VerifiedRelease,
};

#[derive(Clone)]
pub struct InstalledSetupSession {
    pub operation_id: String,
    pub install_directory: PathBuf,
    pub application_path: PathBuf,
    pub installed_version: String,
    pub language: String,
    pub mode: SetupMode,
}

struct ActivePostInstallUpdate {
    operation_id: String,
    decision: Arc<UpdateDecision>,
    can_cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct PostInstallUpdateRuntime {
    active: Mutex<Option<ActivePostInstallUpdate>>,
}

impl PostInstallUpdateRuntime {
    fn begin(
        &self,
        operation_id: &str,
    ) -> Result<(Arc<UpdateDecision>, Arc<AtomicBool>), NativeFailure> {
        let mut active = self.active.lock().map_err(|_| state_failure())?;
        if active.is_some() {
            return Err(NativeFailure::new(
                "setup-update-already-running",
                "setup.update.error.alreadyRunning",
                true,
            ));
        }
        let decision = Arc::new(UpdateDecision::default());
        decision.reset();
        let can_cancel = Arc::new(AtomicBool::new(true));
        *active = Some(ActivePostInstallUpdate {
            operation_id: operation_id.to_string(),
            decision: Arc::clone(&decision),
            can_cancel: Arc::clone(&can_cancel),
        });
        Ok((decision, can_cancel))
    }

    fn finish(&self, operation_id: &str) {
        let Ok(mut active) = self.active.lock() else {
            return;
        };
        if active
            .as_ref()
            .is_some_and(|active| active.operation_id == operation_id)
        {
            *active = None;
        }
    }

    pub fn cancel(&self, operation_id: &str) -> Result<CancelResult, NativeFailure> {
        let active = self.active.lock().map_err(|_| state_failure())?;
        let Some(active) = active.as_ref() else {
            return Ok(CancelResult {
                accepted: false,
                reason_key: Some("setup.update.cancel.noActiveUpdate".to_string()),
            });
        };
        if active.operation_id != operation_id {
            return Ok(CancelResult {
                accepted: false,
                reason_key: Some("setup.update.cancel.operationMismatch".to_string()),
            });
        }
        let accepted = active
            .decision
            .request_cancel(active.can_cancel.load(Ordering::Acquire));
        Ok(CancelResult {
            accepted,
            reason_key: (!accepted).then(|| "setup.update.cancel.handoffCommitted".to_string()),
        })
    }

    pub fn close_reason(&self) -> Option<&'static str> {
        let active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        active.as_ref().map(|active| {
            if active.decision.committed() {
                "setup.closeBlockedAfterCommit"
            } else {
                "setup.closeCancelsBeforeCommit"
            }
        })
    }
}

fn state_failure() -> NativeFailure {
    NativeFailure::new(
        "setup-update-state-unavailable",
        "setup.update.error.stateUnavailable",
        false,
    )
}

fn public_failure(error: UpdateServiceError) -> NativeFailure {
    NativeFailure::new(error.code, "setup.update.error", error.retryable)
}

fn progress(
    session: &InstalledSetupSession,
    state: SetupPostInstallUpdateState,
    target_version: Option<&Version>,
    downloaded_bytes: u64,
    total_bytes: u64,
    can_cancel: bool,
) -> SetupPostInstallUpdateProgress {
    SetupPostInstallUpdateProgress {
        schema_version: INSTALLER_SCHEMA_VERSION,
        operation_id: session.operation_id.clone(),
        state,
        phase: state,
        current_version: session.installed_version.clone(),
        target_version: target_version.map(ToString::to_string),
        downloaded_bytes,
        total_bytes,
        percent: (total_bytes > 0).then(|| {
            ((downloaded_bytes.min(total_bytes) as f64 / total_bytes as f64) * 100.0)
                .clamp(0.0, 100.0)
        }),
        can_cancel,
    }
}

fn emit_progress(
    app: &AppHandle,
    session: &InstalledSetupSession,
    state: SetupPostInstallUpdateState,
    target_version: Option<&Version>,
    downloaded_bytes: u64,
    total_bytes: u64,
    can_cancel: bool,
) {
    let _ = app.emit(
        SETUP_POST_INSTALL_UPDATE_PROGRESS_EVENT,
        progress(
            session,
            state,
            target_version,
            downloaded_bytes,
            total_bytes,
            can_cancel,
        ),
    );
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupUpdateLogEvent<'a> {
    operation_id: &'a str,
    mode: SetupMode,
    stage: &'a str,
    current_version: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_version: Option<&'a str>,
    result: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<&'a str>,
    bytes: u64,
}

async fn log_event(
    session: &InstalledSetupSession,
    stage: &'static str,
    target_version: Option<&Version>,
    result: &'static str,
    error_code: Option<&'static str>,
    bytes: u64,
) {
    let directory = session.install_directory.join("logs");
    if tokio::fs::create_dir_all(&directory).await.is_err() {
        return;
    }
    let target = target_version.map(ToString::to_string);
    let event = SetupUpdateLogEvent {
        operation_id: &session.operation_id,
        mode: session.mode,
        stage,
        current_version: &session.installed_version,
        target_version: target.as_deref(),
        result,
        error_code,
        bytes,
    };
    let Ok(mut line) = serde_json::to_vec(&event) else {
        return;
    };
    line.push(b'\n');
    for file_name in ["setup-update.log", "operations.log"] {
        if let Ok(mut file) = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(directory.join(file_name))
            .await
        {
            let _ = file.write_all(&line).await;
            let _ = file.flush().await;
        }
    }
}

fn launch_installed(session: &InstalledSetupSession) -> Result<(), NativeFailure> {
    let working_directory = session.application_path.parent().ok_or_else(|| {
        NativeFailure::new(
            "setup-application-path-invalid",
            "setup.update.launchError",
            false,
        )
    })?;
    std::process::Command::new(&session.application_path)
        .current_dir(working_directory)
        .spawn()
        .map(|_| ())
        .map_err(|_| {
            NativeFailure::new(
                "setup-bundled-launch-failed",
                "setup.update.launchError",
                true,
            )
        })
}

fn close_setup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("setup") {
        let _ = window.close();
    }
}

async fn launch_bundled_and_finish(
    app: &AppHandle,
    runtime: &PostInstallUpdateRuntime,
    session: &InstalledSetupSession,
    result_outcome: SetupPostInstallUpdateOutcome,
    error: Option<NativeFailure>,
    target_version: Option<&Version>,
) -> SetupPostInstallUpdateResult {
    emit_progress(
        app,
        session,
        SetupPostInstallUpdateState::LaunchingBundled,
        target_version,
        0,
        0,
        false,
    );
    let launch = launch_installed(session);
    runtime.finish(&session.operation_id);
    match launch {
        Ok(()) => {
            log_event(
                session,
                "fallback-launch",
                target_version,
                "succeeded",
                error
                    .as_ref()
                    .map(|failure| failure.code.as_str())
                    .and_then(stable_code),
                0,
            )
            .await;
            close_setup(app);
            SetupPostInstallUpdateResult {
                schema_version: INSTALLER_SCHEMA_VERSION,
                operation_id: session.operation_id.clone(),
                outcome: result_outcome,
                error,
            }
        }
        Err(launch_error) => {
            emit_progress(
                app,
                session,
                SetupPostInstallUpdateState::LaunchError,
                target_version,
                0,
                0,
                false,
            );
            log_event(
                session,
                "fallback-launch",
                target_version,
                "failed",
                Some("setup-bundled-launch-failed"),
                0,
            )
            .await;
            SetupPostInstallUpdateResult {
                schema_version: INSTALLER_SCHEMA_VERSION,
                operation_id: session.operation_id.clone(),
                outcome: SetupPostInstallUpdateOutcome::LaunchFailed,
                error: Some(launch_error),
            }
        }
    }
}

fn stable_code(value: &str) -> Option<&'static str> {
    match value {
        "update-cancelled" => Some("update-cancelled"),
        "update-check-timeout" => Some("update-check-timeout"),
        "package-download-failed" => Some("package-download-failed"),
        "package-verification-failed" => Some("package-verification-failed"),
        "setup-bundled-launch-failed" => Some("setup-bundled-launch-failed"),
        _ => Some("setup-post-install-update-failed"),
    }
}

async fn fallback_after_error(
    app: &AppHandle,
    runtime: &PostInstallUpdateRuntime,
    session: &InstalledSetupSession,
    error: UpdateServiceError,
    target_version: Option<&Version>,
) -> SetupPostInstallUpdateResult {
    emit_progress(
        app,
        session,
        SetupPostInstallUpdateState::Error,
        target_version,
        0,
        0,
        false,
    );
    log_event(
        session,
        "post-install-update",
        target_version,
        "failed",
        Some(error.code),
        0,
    )
    .await;
    launch_bundled_and_finish(
        app,
        runtime,
        session,
        SetupPostInstallUpdateOutcome::BundledLaunched,
        Some(public_failure(error)),
        target_version,
    )
    .await
}

fn updater_source(session: &InstalledSetupSession) -> PathBuf {
    session
        .install_directory
        .join("resources")
        .join("native")
        .join("FluxoraUpdater.exe")
}

fn updater_command(
    updater_path: &Path,
    request_path: &Path,
    language: &str,
) -> Result<(), UpdateServiceError> {
    let working_directory = updater_path.parent().ok_or_else(|| {
        UpdateServiceError::new(
            "updater-runtime-invalid",
            "The application updater runtime is invalid.",
            false,
        )
    })?;
    std::process::Command::new(updater_path)
        .arg("--request")
        .arg(request_path)
        .arg("--presentation")
        .arg("setup-handoff")
        .arg("--language")
        .arg(language)
        .current_dir(working_directory)
        .spawn()
        .map(|_| ())
        .map_err(|_| {
            UpdateServiceError::new(
                "updater-spawn-failed",
                "The application updater could not be started.",
                true,
            )
        })
}

pub async fn run(
    app: AppHandle,
    runtime: &PostInstallUpdateRuntime,
    session: InstalledSetupSession,
) -> Result<SetupPostInstallUpdateResult, NativeFailure> {
    let current_version = Version::parse(&session.installed_version).map_err(|_| {
        NativeFailure::new(
            "setup-installed-version-invalid",
            "setup.update.error.invalidInstalledSession",
            false,
        )
    })?;
    let (decision, can_cancel) = runtime.begin(&session.operation_id)?;
    emit_progress(
        &app,
        &session,
        SetupPostInstallUpdateState::Checking,
        None,
        0,
        0,
        true,
    );
    log_event(&session, "check", None, "started", None, 0).await;

    let root = match update_shared::stable_update_root() {
        Ok(root) => root,
        Err(error) => return Ok(fallback_after_error(&app, runtime, &session, error, None).await),
    };
    let check_client = match update_shared::build_http_client(
        Some(update_shared::CHECK_TIMEOUT),
        update_shared::CONNECT_TIMEOUT,
    ) {
        Ok(client) => client,
        Err(_) => {
            return Ok(fallback_after_error(
                &app,
                runtime,
                &session,
                UpdateServiceError::new(
                    "update-client-unavailable",
                    "The update transport could not be initialized.",
                    true,
                ),
                None,
            )
            .await)
        }
    };
    let release = match update_shared::discover_full_release(&root, &check_client, &current_version)
        .await
    {
        Ok(release) => release,
        Err(error) => return Ok(fallback_after_error(&app, runtime, &session, error, None).await),
    };
    if decision.cancelled() {
        emit_progress(
            &app,
            &session,
            SetupPostInstallUpdateState::Cancelled,
            None,
            0,
            0,
            false,
        );
        log_event(
            &session,
            "check",
            None,
            "cancelled",
            Some("update-cancelled"),
            0,
        )
        .await;
        return Ok(launch_bundled_and_finish(
            &app,
            runtime,
            &session,
            SetupPostInstallUpdateOutcome::Cancelled,
            None,
            None,
        )
        .await);
    }
    let Some(release) = release else {
        emit_progress(
            &app,
            &session,
            SetupPostInstallUpdateState::UpToDate,
            None,
            0,
            0,
            false,
        );
        log_event(&session, "check", None, "up-to-date", None, 0).await;
        return Ok(launch_bundled_and_finish(
            &app,
            runtime,
            &session,
            SetupPostInstallUpdateOutcome::BundledLaunched,
            None,
            None,
        )
        .await);
    };

    run_available_update(
        &app,
        runtime,
        &session,
        &root,
        &current_version,
        release,
        decision,
        can_cancel,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn run_available_update(
    app: &AppHandle,
    runtime: &PostInstallUpdateRuntime,
    session: &InstalledSetupSession,
    root: &Path,
    current_version: &Version,
    release: VerifiedRelease,
    decision: Arc<UpdateDecision>,
    can_cancel: Arc<AtomicBool>,
) -> Result<SetupPostInstallUpdateResult, NativeFailure> {
    let target_version = release.manifest.version.clone();
    let total_bytes = release
        .selected_asset
        .as_ref()
        .map(|asset| asset.size)
        .unwrap_or_default();
    emit_progress(
        app,
        session,
        SetupPostInstallUpdateState::UpdateAvailable,
        Some(&target_version),
        0,
        total_bytes,
        true,
    );
    log_event(
        session,
        "download",
        Some(&target_version),
        "started",
        None,
        0,
    )
    .await;
    let download_client =
        match update_shared::build_http_client(None, update_shared::DOWNLOAD_CONNECT_TIMEOUT) {
            Ok(client) => client,
            Err(_) => {
                return Ok(fallback_after_error(
                    app,
                    runtime,
                    session,
                    UpdateServiceError::new(
                        "update-client-unavailable",
                        "The update transport could not be initialized.",
                        true,
                    ),
                    Some(&target_version),
                )
                .await)
            }
        };
    let app_for_progress = app.clone();
    let session_for_progress = session.clone();
    let target_for_progress = target_version.clone();
    let cancelled = Arc::clone(&decision);
    let package_path = update_shared::download_selected_package(
        root,
        &download_client,
        &release,
        move || cancelled.cancelled(),
        move |downloaded_bytes, progress_total| {
            let app = app_for_progress.clone();
            let session = session_for_progress.clone();
            let target = target_for_progress.clone();
            async move {
                emit_progress(
                    &app,
                    &session,
                    SetupPostInstallUpdateState::Downloading,
                    Some(&target),
                    downloaded_bytes,
                    progress_total,
                    true,
                );
            }
        },
    )
    .await;
    let package_path = match package_path {
        Ok(path) => path,
        Err(error) if error.code == "update-cancelled" => {
            emit_progress(
                app,
                session,
                SetupPostInstallUpdateState::Cancelled,
                Some(&target_version),
                0,
                total_bytes,
                false,
            );
            log_event(
                session,
                "download",
                Some(&target_version),
                "cancelled",
                Some("update-cancelled"),
                0,
            )
            .await;
            return Ok(launch_bundled_and_finish(
                app,
                runtime,
                session,
                SetupPostInstallUpdateOutcome::Cancelled,
                None,
                Some(&target_version),
            )
            .await);
        }
        Err(error) => {
            return Ok(
                fallback_after_error(app, runtime, session, error, Some(&target_version)).await,
            )
        }
    };

    emit_progress(
        app,
        session,
        SetupPostInstallUpdateState::Verifying,
        Some(&target_version),
        total_bytes,
        total_bytes,
        true,
    );
    if decision.cancelled() {
        emit_progress(
            app,
            session,
            SetupPostInstallUpdateState::Cancelled,
            Some(&target_version),
            total_bytes,
            total_bytes,
            false,
        );
        return Ok(launch_bundled_and_finish(
            app,
            runtime,
            session,
            SetupPostInstallUpdateOutcome::Cancelled,
            None,
            Some(&target_version),
        )
        .await);
    }
    let (manifest_path, signature_path) =
        match update_shared::store_manifest_artifacts(root, &release).await {
            Ok(paths) => paths,
            Err(error) => {
                return Ok(fallback_after_error(
                    app,
                    runtime,
                    session,
                    error,
                    Some(&target_version),
                )
                .await)
            }
        };
    emit_progress(
        app,
        session,
        SetupPostInstallUpdateState::PreparingHandoff,
        Some(&target_version),
        total_bytes,
        total_bytes,
        true,
    );
    let parent_start_time_utc = match update_shared::current_process_start_time_utc() {
        Ok(value) => value,
        Err(error) => {
            return Ok(
                fallback_after_error(app, runtime, session, error, Some(&target_version)).await,
            )
        }
    };
    let installed_updater = updater_source(session);
    let prepared = update_shared::prepare_updater_handoff(
        root,
        HandoffInput {
            operation_id: &session.operation_id,
            parent_start_time_utc,
            install_directory: &session.install_directory,
            application_path: &session.application_path,
            updater_source: &installed_updater,
            current_version,
            release: &release,
            package_path,
            manifest_path,
            signature_path,
        },
    )
    .await;
    let prepared = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            return Ok(
                fallback_after_error(app, runtime, session, error, Some(&target_version)).await,
            )
        }
    };

    if !decision.commit() {
        emit_progress(
            app,
            session,
            SetupPostInstallUpdateState::Cancelled,
            Some(&target_version),
            total_bytes,
            total_bytes,
            false,
        );
        return Ok(launch_bundled_and_finish(
            app,
            runtime,
            session,
            SetupPostInstallUpdateOutcome::Cancelled,
            None,
            Some(&target_version),
        )
        .await);
    }
    can_cancel.store(false, Ordering::Release);
    emit_progress(
        app,
        session,
        SetupPostInstallUpdateState::HandoffCommitted,
        Some(&target_version),
        total_bytes,
        total_bytes,
        false,
    );
    log_event(
        session,
        "handoff",
        Some(&target_version),
        "committed",
        None,
        total_bytes,
    )
    .await;
    if let Err(error) = updater_command(
        &prepared.updater_path,
        &prepared.request_path,
        &session.language,
    ) {
        // No native apply process exists yet, so the bundled install is still a
        // safe terminal tree even though the decision boundary is committed.
        return Ok(fallback_after_error(app, runtime, session, error, Some(&target_version)).await);
    }
    runtime.finish(&session.operation_id);
    log_event(
        session,
        "handoff",
        Some(&target_version),
        "spawned",
        None,
        total_bytes,
    )
    .await;
    close_setup(app);
    Ok(SetupPostInstallUpdateResult {
        schema_version: INSTALLER_SCHEMA_VERSION,
        operation_id: session.operation_id.clone(),
        outcome: SetupPostInstallUpdateOutcome::UpdaterLaunched,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foreign_operation_cannot_cancel_active_post_install_update() {
        let runtime = PostInstallUpdateRuntime::default();
        let (_decision, _can_cancel) = runtime.begin("setup-root").unwrap();
        let result = runtime.cancel("foreign-root").unwrap();
        assert!(!result.accepted);
        assert_eq!(
            result.reason_key.as_deref(),
            Some("setup.update.cancel.operationMismatch")
        );
    }

    #[test]
    fn commit_blocks_close_and_cancel() {
        let runtime = PostInstallUpdateRuntime::default();
        let (decision, _can_cancel) = runtime.begin("setup-root").unwrap();
        assert!(decision.commit());
        assert_eq!(
            runtime.close_reason(),
            Some("setup.closeBlockedAfterCommit")
        );
        assert!(!runtime.cancel("setup-root").unwrap().accepted);
    }

    #[test]
    fn updater_source_is_derived_only_from_the_installed_payload() {
        let session = InstalledSetupSession {
            operation_id: "setup-root".to_string(),
            install_directory: PathBuf::from(r"C:\Fluxora Installed"),
            application_path: PathBuf::from(r"C:\Fluxora Installed\Fluxora.exe"),
            installed_version: "2.5.0".to_string(),
            language: "en".to_string(),
            mode: SetupMode::Install,
        };
        assert_eq!(
            updater_source(&session),
            PathBuf::from(r"C:\Fluxora Installed\resources\native\FluxoraUpdater.exe")
        );
    }
}
