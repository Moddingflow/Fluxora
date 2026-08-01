use super::*;

pub(super) const UPDATER_RUNTIME_NATIVE_FILES: [&str; 1] = ["FluxoraUpdater.exe"];

#[cfg(windows)]
pub(super) fn parent_start_time_utc() -> Result<String, UpdateServiceError> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    }
    .map_err(|_| {
        UpdateServiceError::new(
            "process-identity-unavailable",
            "The application process identity could not be secured.",
            false,
        )
    })?;
    let ticks = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    const WINDOWS_TO_UNIX_EPOCH_TICKS: u64 = 116_444_736_000_000_000;
    let unix_ticks = ticks
        .checked_sub(WINDOWS_TO_UNIX_EPOCH_TICKS)
        .ok_or_else(|| {
            UpdateServiceError::new(
                "process-identity-unavailable",
                "The application process identity could not be secured.",
                false,
            )
        })?;
    let seconds = (unix_ticks / 10_000_000) as i64;
    let nanoseconds = ((unix_ticks % 10_000_000) * 100) as u32;
    chrono::DateTime::<Utc>::from_timestamp(seconds, nanoseconds)
        .map(|value| value.to_rfc3339_opts(SecondsFormat::Millis, true))
        .ok_or_else(|| {
            UpdateServiceError::new(
                "process-identity-unavailable",
                "The application process identity could not be secured.",
                false,
            )
        })
}

#[cfg(not(windows))]
pub(super) fn parent_start_time_utc() -> Result<String, UpdateServiceError> {
    Ok(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn packaged_native_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, UpdateServiceError> {
    let resource_directory = app.path().resource_dir().map_err(|_| {
        UpdateServiceError::new(
            "updater-resource-unavailable",
            "The packaged updater resources are unavailable.",
            false,
        )
    })?;
    [
        resource_directory.join("native").join(file_name),
        resource_directory
            .join("resources")
            .join("native")
            .join(file_name),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| {
        UpdateServiceError::new(
            "updater-resource-missing",
            "The application updater is missing from this installation.",
            false,
        )
    })
}

async fn copy_runtime_file(source: &Path, destination: &Path) -> Result<(), UpdateServiceError> {
    let copied = fs::copy(source, destination).await.map_err(|_| {
        UpdateServiceError::new(
            "updater-stage-failed",
            "The application updater could not be staged.",
            true,
        )
    })?;
    if copied == 0 {
        return Err(UpdateServiceError::new(
            "updater-stage-failed",
            "The application updater could not be staged.",
            true,
        ));
    }
    fs::OpenOptions::new()
        .write(true)
        .open(destination)
        .await
        .map_err(|_| {
            UpdateServiceError::new(
                "updater-stage-failed",
                "The application updater could not be staged.",
                true,
            )
        })?
        .sync_all()
        .await
        .map_err(|_| {
            UpdateServiceError::new(
                "updater-stage-failed",
                "The application updater could not be staged.",
                true,
            )
        })
}

pub(super) async fn stage_runtime_artifact(
    source: &Path,
    runtime_directory: &Path,
    file_name: &str,
) -> Result<PathBuf, UpdateServiceError> {
    let destination = runtime_directory.join(file_name);
    if fs::hard_link(source, &destination).await.is_err() {
        copy_runtime_file(source, &destination).await?;
    }
    Ok(destination)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpdaterLaunchRequest {
    pub(super) schema_version: u32,
    pub(super) operation_id: String,
    pub(super) parent_pid: u32,
    pub(super) parent_start_time_utc: String,
    pub(super) install_directory: PathBuf,
    pub(super) updater_working_directory: PathBuf,
    pub(super) package_path: PathBuf,
    pub(super) manifest_path: PathBuf,
    pub(super) signature_path: PathBuf,
    pub(super) current_version: String,
    pub(super) target_version: String,
    pub(super) target: &'static str,
    pub(super) asset_kind: UpdateAssetKind,
    pub(super) from_version: Option<String>,
    pub(super) package_sha256: String,
    pub(super) package_size: u64,
    pub(super) application_executable: String,
    pub(super) handoff_nonce: String,
    pub(super) working_directory: PathBuf,
}

pub(super) struct PreparedUpdaterLaunch {
    pub(super) updater_path: PathBuf,
    pub(super) request_path: PathBuf,
}

pub(super) fn runtime_operation_component(operation_id: &str) -> String {
    let digest = sha256_hex(operation_id.as_bytes());
    format!("operation-{}", &digest[..32])
}

pub(super) fn generate_handoff_nonce() -> Result<String, UpdateServiceError> {
    use p256::elliptic_curve::rand_core::{OsRng, RngCore};
    use std::fmt::Write as _;

    let mut bytes = [0_u8; 32];
    OsRng.try_fill_bytes(&mut bytes).map_err(|_| {
        UpdateServiceError::new(
            "handoff-nonce-unavailable",
            "A secure update health token could not be created.",
            true,
        )
    })?;
    let mut nonce = String::with_capacity(64);
    for byte in bytes {
        write!(&mut nonce, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(nonce)
}

pub(super) async fn prepare_updater_launch(
    app: &AppHandle,
    operation_id: &str,
    current_version: &Version,
    release: &VerifiedRelease,
    package_path: PathBuf,
    manifest_path: PathBuf,
    signature_path: PathBuf,
) -> Result<PreparedUpdaterLaunch, UpdateServiceError> {
    let updater_source = packaged_native_path(app, UPDATER_RUNTIME_NATIVE_FILES[0])?;
    let application_path = std::env::current_exe().map_err(|_| {
        UpdateServiceError::new(
            "install-directory-unavailable",
            "The application installation directory is unavailable.",
            false,
        )
    })?;
    let install_directory = application_path.parent().ok_or_else(|| {
        UpdateServiceError::new(
            "install-directory-unavailable",
            "The application installation directory is unavailable.",
            false,
        )
    })?;
    let shared_release = to_shared_release(release);
    let prepared = crate::update_shared::prepare_updater_handoff(
        &update_root(app)?,
        crate::update_shared::HandoffInput {
            operation_id,
            parent_start_time_utc: crate::update_shared::current_process_start_time_utc()
                .map_err(shared_error)?,
            install_directory,
            application_path: &application_path,
            updater_source: &updater_source,
            current_version,
            release: &shared_release,
            package_path,
            manifest_path,
            signature_path,
        },
    )
    .await
    .map_err(shared_error)?;
    Ok(PreparedUpdaterLaunch {
        updater_path: prepared.updater_path,
        request_path: prepared.request_path,
    })
}

#[allow(dead_code)]
async fn prepare_updater_launch_legacy(
    app: &AppHandle,
    operation_id: &str,
    current_version: &Version,
    release: &VerifiedRelease,
    package_path: PathBuf,
    manifest_path: PathBuf,
    signature_path: PathBuf,
) -> Result<PreparedUpdaterLaunch, UpdateServiceError> {
    let handoff_nonce = generate_handoff_nonce()?;
    let updater_source = packaged_native_path(app, UPDATER_RUNTIME_NATIVE_FILES[0])?;
    let safe_operation = runtime_operation_component(operation_id);
    let runtime_root = update_root(app)?.join("updater-runtime");
    fs::create_dir_all(&runtime_root).await.map_err(|_| {
        UpdateServiceError::new(
            "updater-stage-failed",
            "The application updater could not be staged.",
            true,
        )
    })?;
    let runtime_directory = runtime_root.join(safe_operation);
    fs::create_dir(&runtime_directory).await.map_err(|_| {
        UpdateServiceError::new(
            "updater-runtime-collision",
            "A distinct updater runtime directory could not be created.",
            true,
        )
    })?;
    let updater_path = runtime_directory.join(UPDATER_RUNTIME_NATIVE_FILES[0]);
    copy_runtime_file(&updater_source, &updater_path).await?;
    let package_path =
        stage_runtime_artifact(&package_path, &runtime_directory, "update.package").await?;
    let manifest_path =
        stage_runtime_artifact(&manifest_path, &runtime_directory, "manifest.json").await?;
    let signature_path =
        stage_runtime_artifact(&signature_path, &runtime_directory, "manifest.sig").await?;

    let executable = std::env::current_exe().map_err(|_| {
        UpdateServiceError::new(
            "install-directory-unavailable",
            "The application installation directory is unavailable.",
            false,
        )
    })?;
    let install_directory = executable.parent().map(Path::to_path_buf).ok_or_else(|| {
        UpdateServiceError::new(
            "install-directory-unavailable",
            "The application installation directory is unavailable.",
            false,
        )
    })?;
    let asset = release.selected_asset.as_ref().ok_or_else(|| {
        UpdateServiceError::new(
            "update-not-available",
            "No compatible application update is available.",
            true,
        )
    })?;
    let request = UpdaterLaunchRequest {
        schema_version: UPDATE_REQUEST_SCHEMA_VERSION,
        operation_id: operation_id.to_string(),
        parent_pid: std::process::id(),
        parent_start_time_utc: parent_start_time_utc()?,
        install_directory: install_directory.clone(),
        updater_working_directory: runtime_directory.clone(),
        package_path,
        manifest_path,
        signature_path,
        current_version: current_version.to_string(),
        target_version: release.manifest.version.to_string(),
        target: "win-x64",
        asset_kind: asset.kind,
        from_version: asset.from_version.as_ref().map(ToString::to_string),
        package_sha256: asset.sha256.clone(),
        package_size: asset.size,
        application_executable: release.manifest.application_executable.clone(),
        handoff_nonce,
        working_directory: install_directory,
    };
    let bytes = serde_json::to_vec(&request).map_err(|_| {
        UpdateServiceError::new(
            "updater-request-invalid",
            "The application updater request could not be created.",
            false,
        )
    })?;
    if bytes.len() > MAX_UPDATER_REQUEST_BYTES {
        return Err(UpdateServiceError::new(
            "updater-request-too-large",
            "The application updater request exceeds the safety limit.",
            false,
        ));
    }
    let request_path = runtime_directory.join("update-request.json");
    write_new_file(&request_path, &bytes).await?;
    Ok(PreparedUpdaterLaunch {
        updater_path,
        request_path,
    })
}

fn value_array<'a>(value: &'a Value, key: &str) -> Option<&'a Vec<Value>> {
    value
        .as_array()
        .or_else(|| value.get(key).and_then(Value::as_array))
}

pub(super) fn has_active_downloads(value: &Value) -> bool {
    value_array(value, "downloads").is_some_and(|entries| {
        entries.iter().any(|entry| {
            entry
                .get("transferState")
                .and_then(Value::as_str)
                .is_some_and(|state| matches!(state, "queued" | "downloading" | "indexing"))
        })
    })
}

pub(super) fn has_active_installs(value: &Value) -> bool {
    value_array(value, "installs").is_some_and(|entries| {
        entries.iter().any(|entry| {
            entry
                .get("state")
                .and_then(Value::as_str)
                .is_some_and(|state| {
                    matches!(
                        state,
                        "queued"
                            | "validating"
                            | "extracting"
                            | "configuringFomod"
                            | "buildingStaging"
                            | "projectingConflicts"
                            | "waitingTarget"
                            | "committing"
                            | "finalizing"
                            | "recovering"
                    )
                })
        })
    })
}

async fn poll_project_work(
    app: &AppHandle,
    project_directory: &str,
    operation_id: &str,
) -> Result<bool, String> {
    let request = OperationRequest {
        operation_id: Some(operation_id.to_string()),
    };
    let downloads = {
        let state = bridge_state(app);
        let mut bridge = state.process(BridgeLane::Download).lock().await;
        bridge
            .request_for_update(
                app,
                "downloads.list",
                json!({ "projectDirectory": project_directory }),
                request.clone(),
                BRIDGE_TIMEOUT_MS,
            )
            .await?
    };
    if has_active_downloads(&downloads) {
        return Ok(true);
    }
    let installs = {
        let state = bridge_state(app);
        let mut bridge = state.process(BridgeLane::Install).lock().await;
        bridge
            .request_for_update(
                app,
                "installs.list",
                json!({ "projectDirectory": project_directory, "includeTerminal": false }),
                request,
                BRIDGE_TIMEOUT_MS,
            )
            .await?
    };
    Ok(has_active_installs(&installs))
}

async fn authoritative_project_directories(
    app: &AppHandle,
    operation_id: &str,
) -> Result<Vec<String>, UpdateServiceError> {
    let request = OperationRequest {
        operation_id: Some(operation_id.to_string()),
    };
    let catalog = {
        let state = bridge_state(app);
        let mut bridge = state.process(BridgeLane::Main).lock().await;
        bridge
            .request_for_update(
                app,
                "projects.listConfigs",
                json!({
                    "buildConfigsDirectory": fluxora_data_dir().join("Builds")
                }),
                request,
                BRIDGE_TIMEOUT_MS,
            )
            .await
            .map_err(|_| {
                UpdateServiceError::new(
                    "project-catalog-unavailable",
                    "Project scopes could not be checked safely.",
                    true,
                )
            })?
    };
    let projects = catalog.as_array().ok_or_else(|| {
        UpdateServiceError::new(
            "project-catalog-invalid",
            "Project scopes could not be checked safely.",
            false,
        )
    })?;
    let mut directories = known_project_directories();
    for project in projects {
        let Some(directory) = project
            .get("projectDirectory")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 32_767)
            .filter(|value| Path::new(value).is_absolute())
        else {
            return Err(UpdateServiceError::new(
                "project-catalog-invalid",
                "Project scopes could not be checked safely.",
                false,
            ));
        };
        if !directories
            .iter()
            .any(|known| known.eq_ignore_ascii_case(directory))
        {
            directories.push(directory.to_string());
        }
    }
    directories.sort_by_key(|value| value.to_ascii_lowercase());
    Ok(directories)
}

pub(super) async fn wait_for_application_work(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    operation_id: &str,
    project_directories: &[String],
) -> Result<(), UpdateServiceError> {
    let started = Instant::now();
    let mut consecutive_poll_failures = 0_u32;
    loop {
        if update_cancel_requested(state) {
            return Err(update_cancelled_error());
        }
        if started.elapsed() >= DRAIN_TIMEOUT {
            return Err(UpdateServiceError::new(
                "operation-drain-timeout",
                "The update is still waiting for application work to finish.",
                true,
            ));
        }
        let ai_active = !ai_host_state(app).active_operations.lock().await.is_empty();
        let speech_active = app.state::<crate::SpeechHostState>().has_active_request();
        let mut durable_active = false;
        let mut poll_failed = false;
        for project_directory in project_directories {
            match poll_project_work(app, project_directory, operation_id).await {
                Ok(true) => {
                    durable_active = true;
                    break;
                }
                Ok(false) => {}
                Err(_) => poll_failed = true,
            }
        }
        if poll_failed {
            consecutive_poll_failures = consecutive_poll_failures.saturating_add(1);
            if consecutive_poll_failures >= MAX_DRAIN_POLL_FAILURES {
                return Err(UpdateServiceError::new(
                    "operation-state-unavailable",
                    "Application work could not be checked safely.",
                    true,
                ));
            }
        } else {
            consecutive_poll_failures = 0;
        }
        if !ai_active
            && !speech_active
            && !durable_active
            && !poll_failed
            && in_flight_bridge_requests() == 0
        {
            return Ok(());
        }
        tokio::time::sleep(DRAIN_POLL_INTERVAL).await;
    }
}

async fn set_cancelled_status(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    current: &Version,
    release: &VerifiedRelease,
    operation_id: &str,
) -> FluxoraUpdateStatus {
    reset_install_decision(state);
    let status = set_status(
        app,
        state,
        FluxoraUpdateStatus::for_state(
            UpdateState::Available,
            current,
            Some(release),
            operation_id,
        ),
    )
    .await;
    let _ = write_log(
        app,
        "update",
        "info",
        "UpdateCancel",
        "cancelCompleted state=available",
        Some(operation_id),
    )
    .await;
    status
}

pub(super) struct ShutdownNativeHosts {
    bridge_lanes: Vec<BridgeLane>,
    ai_host: bool,
    speech_host: Option<crate::speech::SpeechHostRecoveryState>,
}

pub(super) async fn recover_native_hosts(
    app: &AppHandle,
    stopped: &ShutdownNativeHosts,
) -> Result<(), UpdateServiceError> {
    for lane in &stopped.bridge_lanes {
        let state = bridge_state(app);
        let mut bridge = state.process(*lane).lock().await;
        bridge.ensure_started(app).await.map_err(|_| {
            UpdateServiceError::new(
                "bridge-recovery-failed",
                "Application services could not be restored after cancelling the update.",
                false,
            )
        })?;
    }
    if stopped.ai_host {
        let state = ai_host_state(app);
        state
            .process
            .lock()
            .await
            .ensure_started(app)
            .await
            .map_err(|_| {
                UpdateServiceError::new(
                    "ai-recovery-failed",
                    "The AI service could not be restored after cancelling the update.",
                    false,
                )
            })?;
    }
    if let Some(recovery) = stopped.speech_host {
        app.state::<crate::SpeechHostState>()
            .recover_after_update_failure(app, recovery)
            .await
            .map_err(|_| {
                UpdateServiceError::new(
                    "speech-recovery-failed",
                    "The speech service could not be restored after cancelling the update.",
                    false,
                )
            })?;
    }
    Ok(())
}

pub(super) async fn shutdown_native_hosts(
    app: &AppHandle,
    operation_id: &str,
) -> Result<ShutdownNativeHosts, UpdateServiceError> {
    let request = OperationRequest {
        operation_id: Some(operation_id.to_string()),
    };
    let mut stopped = ShutdownNativeHosts {
        bridge_lanes: Vec::new(),
        ai_host: false,
        speech_host: None,
    };
    for lane in BridgeLane::ALL {
        let state = bridge_state(app);
        let mut bridge = state.process(lane).lock().await;
        if !bridge.is_running() {
            continue;
        }
        if bridge
            .shutdown_for_update(app, request.clone())
            .await
            .is_err()
        {
            drop(bridge);
            stopped.bridge_lanes.push(lane);
            clear_update_drain();
            let recovered = recover_native_hosts(app, &stopped).await.is_ok();
            return Err(UpdateServiceError::new(
                if recovered {
                    "bridge-shutdown-failed"
                } else {
                    "bridge-shutdown-recovery-failed"
                },
                if recovered {
                    "The application could not prepare safely for the update."
                } else {
                    "The application could not prepare for the update and its services could not be restored."
                },
                recovered,
            ));
        }
        stopped.bridge_lanes.push(lane);
    }
    let state = ai_host_state(app);
    let mut process = state.process.lock().await;
    if process.is_running() {
        if process.shutdown_for_update(app, request).await.is_err() {
            drop(process);
            stopped.ai_host = true;
            clear_update_drain();
            let recovered = recover_native_hosts(app, &stopped).await.is_ok();
            return Err(UpdateServiceError::new(
                if recovered {
                    "ai-shutdown-failed"
                } else {
                    "ai-shutdown-recovery-failed"
                },
                if recovered {
                    "The AI host could not prepare safely for the update."
                } else {
                    "The AI host could not prepare for the update and application services could not be restored."
                },
                recovered,
            ));
        }
        stopped.ai_host = true;
    }
    drop(process);
    stopped.speech_host = Some(
        app.state::<crate::SpeechHostState>()
            .shutdown_for_update()
            .await,
    );
    Ok(stopped)
}

pub(super) async fn run_download_and_install(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    operation_id: &str,
) -> FluxoraUpdateStatus {
    let _install_guard = state.install_gate.lock().await;
    reset_install_decision(state);
    let current = match current_version(app) {
        Ok(version) => version,
        Err(error) => {
            let fallback = Version::new(0, 0, 0);
            return set_error_status(app, state, &fallback, operation_id, error).await;
        }
    };
    let mut release = state.inner.lock().await.release.clone();
    if release.is_none() {
        let _ = run_update_check(app, state, operation_id).await;
        release = state.inner.lock().await.release.clone();
    }
    let Some(mut release) = release else {
        return state.inner.lock().await.status.clone();
    };
    emit_download_progress(app, state, &current, &release, operation_id, 0).await;
    release.selected_asset = select_safe_asset(app, &release.manifest, &current).await;
    {
        state.inner.lock().await.release = Some(release.clone());
    }
    emit_download_progress(app, state, &current, &release, operation_id, 0).await;
    let mut package_path =
        match download_selected_package(app, state, &current, &release, operation_id).await {
            Ok(path) => path,
            Err(error) => {
                let _ = write_log(
                    app,
                    "update",
                    "warning",
                    "UpdateDownload",
                    &format!("downloadFailed code={}", error.code),
                    Some(operation_id),
                )
                .await;
                if error.code == "update-cancelled" {
                    return set_cancelled_status(app, state, &current, &release, operation_id)
                        .await;
                }
                return set_error_status(app, state, &current, operation_id, error).await;
            }
        };
    if release
        .selected_asset
        .as_ref()
        .is_some_and(|asset| asset.kind == UpdateAssetKind::Delta)
    {
        let safe_asset = select_safe_asset(app, &release.manifest, &current).await;
        if safe_asset
            .as_ref()
            .is_some_and(|asset| asset.kind == UpdateAssetKind::Full)
        {
            release.selected_asset = safe_asset;
            state.inner.lock().await.release = Some(release.clone());
            emit_download_progress(app, state, &current, &release, operation_id, 0).await;
            package_path =
                match download_selected_package(app, state, &current, &release, operation_id).await
                {
                    Ok(path) => path,
                    Err(error) if error.code == "update-cancelled" => {
                        return set_cancelled_status(app, state, &current, &release, operation_id)
                            .await;
                    }
                    Err(error) => {
                        return set_error_status(app, state, &current, operation_id, error).await;
                    }
                };
        }
    }
    if update_cancel_requested(state) {
        return set_cancelled_status(app, state, &current, &release, operation_id).await;
    }
    if !begin_update_drain() {
        let error = UpdateServiceError::new(
            "update-already-draining",
            "Another update installation is already preparing.",
            true,
        );
        return set_error_status(app, state, &current, operation_id, error).await;
    }
    let mut project_directories = match authoritative_project_directories(app, operation_id).await {
        Ok(directories) => directories,
        Err(error) => {
            clear_update_drain();
            return set_error_status(app, state, &current, operation_id, error).await;
        }
    };
    if update_cancel_requested(state) {
        clear_update_drain();
        return set_cancelled_status(app, state, &current, &release, operation_id).await;
    }
    set_status(
        app,
        state,
        FluxoraUpdateStatus::for_state(
            UpdateState::WaitingForOperations,
            &current,
            Some(&release),
            operation_id,
        ),
    )
    .await;
    if let Err(error) =
        wait_for_application_work(app, state, operation_id, &project_directories).await
    {
        clear_update_drain();
        if error.code == "update-cancelled" {
            return set_cancelled_status(app, state, &current, &release, operation_id).await;
        }
        return set_error_status(app, state, &current, operation_id, error).await;
    }
    if !seal_update_drain() {
        clear_update_drain();
        return set_error_status(
            app,
            state,
            &current,
            operation_id,
            UpdateServiceError::new(
                "operation-drain-seal-failed",
                "Application work could not be sealed safely for the update.",
                true,
            ),
        )
        .await;
    }
    project_directories = match authoritative_project_directories(app, operation_id).await {
        Ok(directories) => directories,
        Err(error) => {
            clear_update_drain();
            return set_error_status(app, state, &current, operation_id, error).await;
        }
    };
    if let Err(error) =
        wait_for_application_work(app, state, operation_id, &project_directories).await
    {
        clear_update_drain();
        if error.code == "update-cancelled" {
            return set_cancelled_status(app, state, &current, &release, operation_id).await;
        }
        return set_error_status(app, state, &current, operation_id, error).await;
    }
    if update_cancel_requested(state) {
        clear_update_drain();
        return set_cancelled_status(app, state, &current, &release, operation_id).await;
    }
    if release
        .selected_asset
        .as_ref()
        .is_some_and(|asset| asset.kind == UpdateAssetKind::Delta)
    {
        let safe_asset = select_safe_asset(app, &release.manifest, &current).await;
        if safe_asset
            .as_ref()
            .is_some_and(|asset| asset.kind == UpdateAssetKind::Full)
        {
            release.selected_asset = safe_asset;
            state.inner.lock().await.release = Some(release.clone());
            emit_download_progress(app, state, &current, &release, operation_id, 0).await;
            package_path =
                match download_selected_package(app, state, &current, &release, operation_id).await
                {
                    Ok(path) => path,
                    Err(error) => {
                        clear_update_drain();
                        if error.code == "update-cancelled" {
                            return set_cancelled_status(
                                app,
                                state,
                                &current,
                                &release,
                                operation_id,
                            )
                            .await;
                        }
                        return set_error_status(app, state, &current, operation_id, error).await;
                    }
                };
        }
    }
    if update_cancel_requested(state) {
        clear_update_drain();
        return set_cancelled_status(app, state, &current, &release, operation_id).await;
    }
    let (manifest_path, signature_path) = match store_manifest_artifacts(app, &release).await {
        Ok(paths) => paths,
        Err(error) => {
            clear_update_drain();
            return set_error_status(app, state, &current, operation_id, error).await;
        }
    };
    let prepared = match prepare_updater_launch(
        app,
        operation_id,
        &current,
        &release,
        package_path,
        manifest_path,
        signature_path,
    )
    .await
    {
        Ok(prepared) => prepared,
        Err(error) => {
            clear_update_drain();
            return set_error_status(app, state, &current, operation_id, error).await;
        }
    };
    if update_cancel_requested(state) {
        clear_update_drain();
        return set_cancelled_status(app, state, &current, &release, operation_id).await;
    }
    set_status(
        app,
        state,
        FluxoraUpdateStatus::for_state(
            UpdateState::ReadyToInstall,
            &current,
            Some(&release),
            operation_id,
        ),
    )
    .await;
    let stopped_hosts = match shutdown_native_hosts(app, operation_id).await {
        Ok(stopped) => stopped,
        Err(error) => {
            clear_update_drain();
            return set_error_status(app, state, &current, operation_id, error).await;
        }
    };
    if update_cancel_requested(state) {
        clear_update_drain();
        if let Err(error) = recover_native_hosts(app, &stopped_hosts).await {
            return set_error_status(app, state, &current, operation_id, error).await;
        }
        return set_cancelled_status(app, state, &current, &release, operation_id).await;
    }
    let launching = set_status(
        app,
        state,
        FluxoraUpdateStatus::for_state(
            UpdateState::LaunchingUpdater,
            &current,
            Some(&release),
            operation_id,
        ),
    )
    .await;
    if !commit_updater_launch(state) {
        clear_update_drain();
        if let Err(error) = recover_native_hosts(app, &stopped_hosts).await {
            return set_error_status(app, state, &current, operation_id, error).await;
        }
        return set_cancelled_status(app, state, &current, &release, operation_id).await;
    }
    match Command::new(&prepared.updater_path)
        .arg("--request")
        .arg(&prepared.request_path)
        .current_dir(
            prepared
                .updater_path
                .parent()
                .unwrap_or_else(|| Path::new(".")),
        )
        .spawn()
    {
        Ok(_) => {
            let _ = write_log(
                app,
                "update",
                "info",
                "UpdaterLaunch",
                "updaterSpawned exitRequested=true",
                Some(operation_id),
            )
            .await;
            app.exit(0);
            launching
        }
        Err(_) => {
            reset_install_decision(state);
            clear_update_drain();
            let recovery = recover_native_hosts(app, &stopped_hosts).await;
            let error = UpdateServiceError::new(
                if recovery.is_ok() {
                    "updater-launch-failed"
                } else {
                    "updater-launch-recovery-failed"
                },
                if recovery.is_ok() {
                    "The application updater could not be started. Fluxora will remain open."
                } else {
                    "The updater could not start and application services could not be restored."
                },
                recovery.is_ok(),
            );
            set_error_status(app, state, &current, operation_id, error).await
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpdateHealthAcknowledgment {
    pub(super) schema_version: u32,
    pub(super) nonce: String,
    pub(super) operation_id: String,
    pub(super) app_version: String,
    pub(super) pid: u32,
    pub(super) process_start_time_utc: String,
}

pub(super) async fn write_update_health_acknowledgment(
    app: &AppHandle,
    state: &UpdateRuntimeState,
) -> Result<(), UpdateServiceError> {
    let Some(handoff) = state.health_handoff.clone() else {
        return Ok(());
    };
    let nonce = handoff.nonce;
    let operation_id = handoff.operation_id;
    match state
        .health_ack_state
        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
    {
        Ok(_) => {}
        Err(2) => return Ok(()),
        Err(_) => {
            return Err(UpdateServiceError::new(
                "health-ack-in-progress",
                "Application update health verification is already in progress.",
                true,
            ));
        }
    }

    let result: Result<(), UpdateServiceError> = async {
        let handshake = {
            let bridge_state = bridge_state(app);
            let mut bridge = bridge_state.process(BridgeLane::Main).lock().await;
            let handshake = bridge
                .request(
                    app,
                    "system.handshake",
                    json!({ "supportedProtocolVersions": [BRIDGE_PROTOCOL_VERSION] }),
                    OperationRequest {
                        operation_id: Some(operation_id.clone()),
                    },
                    HEALTH_HANDSHAKE_TIMEOUT_MS,
                )
                .await
                .map_err(|_| {
                    UpdateServiceError::new(
                        "health-bridge-unavailable",
                        "The updated application core did not become ready.",
                        true,
                    )
                })?;
            validate_negotiated_protocol(&handshake, BRIDGE_PROTOCOL_VERSION, "FluxoraBridgeHost")
                .map_err(|_| {
                    UpdateServiceError::new(
                        "health-bridge-incompatible",
                        "The updated application core protocol is incompatible.",
                        false,
                    )
                })?;
            bridge.handshake = Some(handshake.clone());
            handshake
        };
        let _ = handshake;
        let acknowledgment = UpdateHealthAcknowledgment {
            schema_version: 1,
            nonce: nonce.clone(),
            operation_id: operation_id.clone(),
            app_version: app.package_info().version.to_string(),
            pid: std::process::id(),
            process_start_time_utc: parent_start_time_utc()?,
        };
        let bytes = serde_json::to_vec(&acknowledgment).map_err(|_| {
            UpdateServiceError::new(
                "health-ack-invalid",
                "Application update health verification could not be recorded.",
                false,
            )
        })?;
        let path = update_root(app)?
            .join("health")
            .join(format!("{nonce}.ack"));
        write_new_file(&path, &bytes).await.map_err(|_| {
            UpdateServiceError::new(
                "health-ack-write-failed",
                "Application update health verification could not be recorded.",
                true,
            )
        })?;
        let _ = write_log(
            app,
            "update",
            "info",
            "UpdateHealth",
            "rendererReady=true bridgeReady=true acknowledgmentWritten=true",
            Some(&operation_id),
        )
        .await;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => {
            state.health_ack_state.store(2, Ordering::Release);
            Ok(())
        }
        Err(error) => {
            state.health_ack_state.store(0, Ordering::Release);
            let _ = write_log(
                app,
                "update",
                "warning",
                "UpdateHealth",
                &format!("acknowledgmentFailed code={}", error.code),
                Some(&operation_id),
            )
            .await;
            Err(error)
        }
    }
}
