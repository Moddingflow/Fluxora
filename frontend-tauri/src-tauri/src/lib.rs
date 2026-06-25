use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

const BRIDGE_PROTOCOL_VERSION: &str = "1.0";
const BRIDGE_TIMEOUT_MS: u64 = 10_000;
const PROGRESS_EVENT: &str = "fluxora:operations:progress";
const MAIN_WINDOW_LABEL: &str = "main";
const TRANSFER_MO2_HANDOFF_EVENT: &str = "fluxora:transfer:mo2-handoff";
const TRANSFER_MO2_OPEN_EVENT: &str = "fluxora:transfer:mo2-open";
const OPERATION_CANCEL_DIR_NAME: &str = "operation-cancel";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn operation_progress_payload(envelope: &Value) -> Value {
    let mut payload = envelope.get("params").cloned().unwrap_or(Value::Null);
    let operation_id = envelope
        .get("meta")
        .and_then(|meta| meta.get("operationId"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());

    if let (Value::Object(fields), Some(operation_id)) = (&mut payload, operation_id) {
        fields
            .entry("operationId")
            .or_insert_with(|| Value::String(operation_id.to_string()));
    }

    payload
}

#[derive(Default)]
struct BridgeState {
    process: Mutex<BridgeProcess>,
}

#[derive(Default)]
struct BridgeProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    host_path: Option<PathBuf>,
    handshake: Option<Value>,
}

#[derive(Clone, Deserialize, Serialize)]
struct OperationRequest {
    #[serde(rename = "operationId")]
    operation_id: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogFileRequest {
    title: String,
    initial_directory: Option<String>,
    filters: Option<Vec<DialogFilter>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogFolderRequest {
    title: String,
    initial_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogSaveFileRequest {
    title: String,
    default_path: Option<String>,
    filters: Option<Vec<DialogFilter>>,
}

#[derive(Serialize)]
struct DialogPathResult {
    canceled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenExternalResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellPathResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Serialize)]
struct RuntimePaths {
    #[serde(rename = "buildConfigsDirectory")]
    build_configs_directory: String,
    #[serde(rename = "defaultInstallRootDirectory")]
    default_install_root_directory: String,
}

#[derive(Serialize)]
struct AppInfo {
    #[serde(rename = "appName")]
    app_name: String,
    version: String,
    platform: String,
    arch: String,
    #[serde(rename = "isPackaged")]
    is_packaged: bool,
}

#[derive(Deserialize)]
struct UiLogEntry {
    level: String,
    message: String,
    #[serde(rename = "operationId")]
    operation_id: Option<String>,
    category: Option<String>,
}

#[derive(Serialize)]
struct TransferDriveOption {
    id: String,
    #[serde(rename = "rootPath")]
    root_path: String,
    label: String,
    #[serde(rename = "volumeName")]
    volume_name: String,
    #[serde(rename = "fileSystem")]
    file_system: String,
    #[serde(rename = "totalBytes")]
    total_bytes: u64,
    #[serde(rename = "availableBytes")]
    available_bytes: u64,
    #[serde(rename = "driveKind")]
    drive_kind: String,
    #[serde(rename = "mediaLabel")]
    media_label: String,
    #[serde(rename = "busType")]
    bus_type: String,
    #[serde(rename = "friendlyName")]
    friendly_name: String,
    #[serde(rename = "isSystem")]
    is_system: bool,
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        "linux" => "linux",
        other => other,
    }
}

fn arch_name() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

fn runtime_support_matrix() -> Value {
    json!([
        {
            "platform": "win32",
            "label": "Windows",
            "state": "available",
            "nativeLibraryName": "FluxoraCore.dll",
            "bridgeHostName": "FluxoraBridgeHost.exe",
            "packageFormats": ["FluxoraSetup.exe"],
            "protocolState": "available",
            "protocolNotes": "NXM uses Tauri activation plus Windows registry verification.",
            "shellOpenState": "runtime-shell",
            "vfsState": "available",
            "vfsNotes": "VFS launch is available when FluxoraVfs.dll is present.",
            "pathRules": ["Unicode paths", "spaces", "long-path guard"],
            "releaseNotes": ["Installer-only public release policy remains in force."]
        },
        {
            "platform": "linux",
            "label": "Linux",
            "state": "limited",
            "nativeLibraryName": "libFluxoraCore.so",
            "bridgeHostName": "FluxoraBridgeHost",
            "packageFormats": ["Tauri Linux bundle"],
            "protocolState": "limited",
            "protocolNotes": "Protocol registration is package-manager dependent.",
            "shellOpenState": "runtime-shell",
            "vfsState": "unsupported",
            "vfsNotes": "VFS launch is Windows-only in the current native core.",
            "pathRules": ["UTF-8 paths", "case-sensitive paths", "no Windows drive roots"],
            "releaseNotes": ["Linux release remains a validation target, not the approved public artifact."]
        },
        {
            "platform": "darwin",
            "label": "macOS",
            "state": "limited",
            "nativeLibraryName": "libFluxoraCore.dylib",
            "bridgeHostName": "FluxoraBridgeHost",
            "packageFormats": ["Tauri macOS bundle"],
            "protocolState": "limited",
            "protocolNotes": "Protocol registration requires signed bundle validation.",
            "shellOpenState": "runtime-shell",
            "vfsState": "unsupported",
            "vfsNotes": "VFS launch is Windows-only in the current native core.",
            "pathRules": ["UTF-8 paths", "app translocation guard", "case-sensitive volume guard"],
            "releaseNotes": ["macOS release remains a validation target, not the approved public artifact."]
        }
    ])
}

fn merge_runtime_capabilities(mut capabilities: Value) -> Value {
    if !capabilities.is_object() {
        capabilities = json!({
            "platform": platform_name(),
            "arch": arch_name(),
            "core": { "available": false, "libraryName": native_library_name() },
            "features": {}
        });
    }

    if let Some(object) = capabilities.as_object_mut() {
        object
            .entry("platform")
            .or_insert_with(|| json!(platform_name()));
        object.entry("arch").or_insert_with(|| json!(arch_name()));
        object
            .entry("core")
            .or_insert_with(|| json!({ "available": false, "libraryName": native_library_name() }));
        let features = object.entry("features").or_insert_with(|| json!({}));
        if !features.is_object() {
            *features = json!({});
        }
        if let Some(features) = features.as_object_mut() {
            features.insert(
                "nativeDialogs".to_string(),
                json!({
                    "state": "runtime-shell",
                    "platforms": ["win32", "linux", "darwin"],
                    "supports": ["openFile", "openDirectory", "saveFile"]
                }),
            );
            features.insert(
                "shellOpen".to_string(),
                json!({
                    "state": "runtime-shell",
                    "platforms": ["win32", "linux", "darwin"],
                    "supports": ["openPath", "showItemInFolder"]
                }),
            );
            features.insert(
                "externalLinks".to_string(),
                json!({
                    "state": "runtime-shell",
                    "platforms": ["win32", "linux", "darwin"],
                    "supports": ["https", "mailto"]
                }),
            );
        }
        object
            .entry("supportMatrix")
            .or_insert_with(runtime_support_matrix);
    }

    capabilities
}

fn operation_id(request: Option<&OperationRequest>, scope: &str) -> String {
    request
        .and_then(|request| request.operation_id.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("op_{}_{}", now_millis(), scope))
}

fn host_executable_name() -> &'static str {
    if cfg!(windows) {
        "FluxoraBridgeHost.exe"
    } else {
        "FluxoraBridgeHost"
    }
}

fn native_library_name() -> &'static str {
    match platform_name() {
        "win32" => "FluxoraCore.dll",
        "darwin" => "libFluxoraCore.dylib",
        "linux" => "libFluxoraCore.so",
        _ => "FluxoraCore",
    }
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            .join("Fluxora")
    })
}

fn executable_log_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("logs")))
}

fn logs_dir(_app: &AppHandle) -> PathBuf {
    executable_log_dir().unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("logs")
    })
}

fn operation_cancel_dir(app: &AppHandle) -> PathBuf {
    logs_dir(app).join(OPERATION_CANCEL_DIR_NAME)
}

fn operation_cancel_marker_name(operation_id: &str) -> Option<String> {
    let trimmed = operation_id.trim();
    if trimmed.is_empty() {
        return None;
    }

    let safe: String = trimmed
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '_'
                || character == '-'
                || character == '.'
            {
                character
            } else {
                '_'
            }
        })
        .collect();
    Some(format!("{}.cancel", safe))
}

fn operation_cancel_marker_path(app: &AppHandle, operation_id: &str) -> Option<PathBuf> {
    operation_cancel_marker_name(operation_id)
        .map(|file_name| operation_cancel_dir(app).join(file_name))
}

async fn clear_operation_cancel_marker(app: &AppHandle, operation_id: &str) {
    if let Some(path) = operation_cancel_marker_path(app, operation_id) {
        let _ = tokio::fs::remove_file(path).await;
    }
}

async fn request_operation_cancel(
    app: &AppHandle,
    target_operation_id: &str,
    request_operation_id: Option<&str>,
) -> Result<Value, String> {
    let Some(path) = operation_cancel_marker_path(app, target_operation_id) else {
        return Ok(json!({
            "operationId": target_operation_id.trim(),
            "status": "notFound",
            "accepted": false
        }));
    };

    let directory = path
        .parent()
        .ok_or_else(|| "Operation cancellation marker path is invalid.".to_string())?;
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(|error| error.to_string())?;
    tokio::fs::write(&path, format!("{}\n", now_millis()))
        .await
        .map_err(|error| error.to_string())?;

    let _ = write_log(
        app,
        "main-bridge",
        "info",
        "OperationCancel",
        &format!(
            "Cancellation requested for operationId={} marker={}",
            sanitize_log(target_operation_id),
            path.to_string_lossy()
        ),
        request_operation_id,
    )
    .await;

    Ok(json!({
        "operationId": target_operation_id.trim(),
        "status": "accepted",
        "accepted": true
    }))
}

fn sanitize_log(value: &str) -> String {
    value.replace(['\r', '\n'], " ").trim().to_string()
}

async fn write_log(
    app: &AppHandle,
    channel: &str,
    level: &str,
    category: &str,
    message: &str,
    operation_id: Option<&str>,
) -> Result<(), String> {
    let dir = logs_dir(app);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| error.to_string())?;
    let file = dir.join(format!("fluxora-tauri-{}-{}.log", channel, "current"));
    let op = operation_id
        .map(|value| format!(" [operationId={}]", sanitize_log(value)))
        .unwrap_or_default();
    let line = format!(
        "[{}] [{}] [{}]{} {}\n",
        now_millis(),
        sanitize_log(level).to_uppercase(),
        sanitize_log(category),
        op,
        sanitize_log(message)
    );
    tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .await
        .map_err(|error| error.to_string())?
        .write_all(line.as_bytes())
        .await
        .map_err(|error| error.to_string())
}

fn candidate_host_paths(app: &AppHandle) -> Vec<PathBuf> {
    let executable = host_executable_name();
    let mut candidates = Vec::new();

    if let Some(path) = std::env::var_os("FLUXORA_BRIDGE_HOST_PATH") {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("native").join(executable));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for root in [
            current_dir.as_path(),
            current_dir.parent().unwrap_or(current_dir.as_path()),
            current_dir
                .parent()
                .and_then(Path::parent)
                .unwrap_or(current_dir.as_path()),
        ] {
            candidates.push(root.join("build").join("backend").join(executable));
            candidates.push(
                root.join("build")
                    .join("backend")
                    .join("Debug")
                    .join(executable),
            );
            candidates.push(
                root.join("build")
                    .join("backend")
                    .join("Release")
                    .join(executable),
            );
            candidates.push(
                root.join("build")
                    .join("backend")
                    .join("RelWithDebInfo")
                    .join(executable),
            );
        }
    }

    candidates
}

async fn resolve_host_path(app: &AppHandle) -> Result<PathBuf, String> {
    for candidate in candidate_host_paths(app) {
        if tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return Ok(candidate);
        }
    }

    Err("FluxoraBridgeHost was not found. Build backend target FluxoraBridgeHost or set FLUXORA_BRIDGE_HOST_PATH.".to_string())
}

impl BridgeProcess {
    async fn ensure_started(&mut self, app: &AppHandle) -> Result<(), String> {
        if self.child.is_some() && self.stdin.is_some() && self.stdout.is_some() {
            return Ok(());
        }

        let host_path = resolve_host_path(app).await?;
        let native_log_dir = logs_dir(app);
        let cancel_dir = operation_cancel_dir(app);
        tokio::fs::create_dir_all(&cancel_dir)
            .await
            .map_err(|error| error.to_string())?;
        let mut command = Command::new(&host_path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("FLUXORA_LOG_DIR", &native_log_dir)
            .env("FLUXORA_OPERATION_CANCEL_DIR", &cancel_dir);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn().map_err(|error| error.to_string())?;

        if let Some(stderr) = child.stderr.take() {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or_default() > 0 {
                    let message = line.trim();
                    if !message.is_empty() {
                        let _ =
                            write_log(&app, "main-bridge", "warning", "BridgeHost", message, None)
                                .await;
                    }
                    line.clear();
                }
            });
        }

        self.stdin = child.stdin.take();
        self.stdout = child.stdout.take().map(BufReader::new);
        self.child = Some(child);
        self.host_path = Some(host_path);
        self.handshake = None;

        let _ = write_log(
            app,
            "main-bridge",
            "info",
            "BridgeHost",
            &format!(
                "Started FluxoraBridgeHost with FLUXORA_LOG_DIR={}",
                native_log_dir.to_string_lossy()
            ),
            None,
        )
        .await;

        Ok(())
    }

    async fn request(
        &mut self,
        app: &AppHandle,
        method: &str,
        params: Value,
        request: OperationRequest,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        self.ensure_started(app).await?;
        if method != "system.handshake" && self.handshake.is_none() {
            let handshake = self
                .send_request(
                    app,
                    "system.handshake",
                    json!({ "supportedProtocolVersions": [BRIDGE_PROTOCOL_VERSION] }),
                    request.clone(),
                    timeout_ms,
                )
                .await?;
            self.handshake = Some(handshake);
        }

        self.send_request(app, method, params, request, timeout_ms)
            .await
    }

    async fn send_request(
        &mut self,
        app: &AppHandle,
        method: &str,
        params: Value,
        request: OperationRequest,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        let request_id = format!("req_{}_{}", now_millis(), method.replace('.', "_"));
        let operation_id = operation_id(Some(&request), method);
        let payload = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
            "meta": {
                "protocolVersion": BRIDGE_PROTOCOL_VERSION,
                "operationId": operation_id,
                "requestSource": "tauri-shell",
                "appVersion": "0.0.0",
                "platform": platform_name(),
                "arch": arch_name(),
                "locale": "ru-RU"
            }
        });

        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "Bridge host stdin is unavailable.".to_string())?;
        stdin
            .write_all(format!("{}\n", payload).as_bytes())
            .await
            .map_err(|error| error.to_string())?;

        loop {
            let mut line = String::new();
            let stdout = self
                .stdout
                .as_mut()
                .ok_or_else(|| "Bridge host stdout is unavailable.".to_string())?;
            let bytes = timeout(
                Duration::from_millis(timeout_ms),
                stdout.read_line(&mut line),
            )
            .await
            .map_err(|_| format!("Bridge request timed out: {}", method))?
            .map_err(|error| error.to_string())?;
            if bytes == 0 {
                self.child = None;
                self.stdin = None;
                self.stdout = None;
                self.handshake = None;
                return Err("Bridge host exited before replying.".to_string());
            }

            let envelope: Value =
                serde_json::from_str(line.trim()).map_err(|error| error.to_string())?;
            if envelope.get("id").and_then(Value::as_str) != Some(request_id.as_str()) {
                if envelope.get("method").and_then(Value::as_str) == Some("operations.progress") {
                    let payload = operation_progress_payload(&envelope);
                    let _ = app.emit(PROGRESS_EVENT, payload);
                }
                continue;
            }

            if let Some(error) = envelope.get("error") {
                return Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Native bridge request failed.")
                    .to_string());
            }

            let result = envelope
                .get("result")
                .ok_or_else(|| "Bridge response missing result.".to_string())?;
            if result.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err("Bridge response did not include an ok result.".to_string());
            }
            return Ok(result.get("data").cloned().unwrap_or(Value::Null));
        }
    }

    async fn shutdown(&mut self, app: &AppHandle, request: OperationRequest) -> Result<(), String> {
        if self.child.is_none() {
            return Ok(());
        }
        let _ = self
            .request(
                app,
                "system.shutdown",
                json!({}),
                request,
                BRIDGE_TIMEOUT_MS,
            )
            .await;
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
        self.stdin = None;
        self.stdout = None;
        self.handshake = None;
        Ok(())
    }
}

fn bridge_state(app: &AppHandle) -> tauri::State<'_, BridgeState> {
    app.state::<BridgeState>()
}

#[tauri::command]
fn fluxora_app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        app_name: "Fluxora".to_string(),
        version: app.package_info().version.to_string(),
        platform: platform_name().to_string(),
        arch: arch_name().to_string(),
        is_packaged: !cfg!(debug_assertions),
    }
}

#[tauri::command]
fn fluxora_runtime_paths(app: AppHandle) -> RuntimePaths {
    let root = app_data_dir(&app);
    RuntimePaths {
        build_configs_directory: root.join("Builds").to_string_lossy().to_string(),
        default_install_root_directory: root.join("Projects").to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn fluxora_current_executable() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn fluxora_security_state(allowed_channels: Vec<String>) -> Value {
    json!({
        "contextIsolation": true,
        "nodeIntegration": false,
        "sandbox": true,
        "remoteModule": false,
        "allowedIpcChannels": allowed_channels,
        "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
    })
}

#[tauri::command]
async fn fluxora_log(app: AppHandle, entry: UiLogEntry) -> Result<(), String> {
    write_log(
        &app,
        "ui",
        &entry.level,
        entry.category.as_deref().unwrap_or("Renderer"),
        &entry.message,
        entry.operation_id.as_deref(),
    )
    .await
}

#[tauri::command]
async fn fluxora_bridge_request(
    app: AppHandle,
    method: String,
    params: Value,
    request: Option<OperationRequest>,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, &method)),
    });
    if method == "operations.cancel" {
        let target_operation_id = params
            .get("operationId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        return request_operation_cancel(
            &app,
            &target_operation_id,
            request.operation_id.as_deref(),
        )
        .await;
    }

    let operation_id = operation_id(Some(&request), &method);
    clear_operation_cancel_marker(&app, &operation_id).await;
    let state = bridge_state(&app);
    let mut bridge = state.process.lock().await;
    let timeout_ms = timeout_ms.unwrap_or(BRIDGE_TIMEOUT_MS);
    bridge
        .request(&app, &method, params, request, timeout_ms)
        .await
}

#[tauri::command]
async fn fluxora_bridge_status(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "bridge_status")),
    });
    let operation_id = operation_id(Some(&request), "bridge_status");
    let state = bridge_state(&app);
    let mut bridge = state.process.lock().await;
    let status = bridge
        .request(
            &app,
            "system.initialize",
            json!({}),
            request.clone(),
            BRIDGE_TIMEOUT_MS,
        )
        .await;

    match status {
        Ok(status) => {
            let capabilities = bridge
                .request(
                    &app,
                    "system.getCapabilities",
                    json!({}),
                    request.clone(),
                    BRIDGE_TIMEOUT_MS,
                )
                .await
                .unwrap_or_else(|_| {
                    json!({
                        "platform": platform_name(),
                        "arch": arch_name(),
                        "core": { "available": false, "libraryName": native_library_name() },
                        "features": {}
                    })
                });
            let capabilities = merge_runtime_capabilities(capabilities);
            let handshake = bridge.handshake.clone().unwrap_or_default();
            Ok(json!({
                "ready": true,
                "operationId": operation_id,
                "protocolVersion": handshake.get("protocolVersion").cloned().unwrap_or(json!(BRIDGE_PROTOCOL_VERSION)),
                "hostVersion": handshake.get("hostVersion").cloned().unwrap_or(json!("0.0.0-dev")),
                "coreVersion": handshake.get("coreVersion").cloned().unwrap_or(json!("0.0.0-dev")),
                "coreApiVersion": status.get("coreApiVersion").cloned().unwrap_or_else(|| handshake.get("coreApiVersion").cloned().unwrap_or(json!("FluxoraCoreApi/legacy-cabi"))),
                "language": status.get("language").cloned().unwrap_or(json!("en-us")),
                "theme": status.get("theme").cloned().unwrap_or(json!("dark")),
                "hostPath": bridge.host_path.as_ref().map(|path| path.to_string_lossy().to_string()),
                "capabilities": capabilities,
                "logs": {
                    "uiLogPath": logs_dir(&app).join("fluxora-tauri-ui-current.log").to_string_lossy().to_string(),
                    "mainBridgeLogPath": logs_dir(&app).join("fluxora-tauri-main-bridge-current.log").to_string_lossy().to_string(),
                    "nativeLogDirectory": logs_dir(&app).to_string_lossy().to_string()
                }
            }))
        }
        Err(message) => Ok(json!({
            "ready": false,
            "operationId": operation_id,
            "hostPath": bridge.host_path.as_ref().map(|path| path.to_string_lossy().to_string()),
            "error": {
                "code": "bridge.unavailable",
                "message": message,
                "category": "transport",
                "retryable": true,
                "capabilityId": null,
                "details": {}
            },
            "logs": {
                "uiLogPath": logs_dir(&app).join("fluxora-tauri-ui-current.log").to_string_lossy().to_string(),
                "mainBridgeLogPath": logs_dir(&app).join("fluxora-tauri-main-bridge-current.log").to_string_lossy().to_string(),
                "nativeLogDirectory": logs_dir(&app).to_string_lossy().to_string()
            }
        })),
    }
}

#[tauri::command]
async fn fluxora_shutdown_bridge(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<(), String> {
    let state = bridge_state(&app);
    let mut bridge = state.process.lock().await;
    bridge
        .shutdown(
            &app,
            request.unwrap_or(OperationRequest {
                operation_id: Some(operation_id(None, "bridge_shutdown")),
            }),
        )
        .await
}

#[tauri::command]
async fn fluxora_list_destination_drives() -> Result<Vec<TransferDriveOption>, String> {
    let mut drives = Vec::new();
    if cfg!(windows) {
        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).exists() {
                drives.push(TransferDriveOption {
                    id: root.clone(),
                    root_path: root.clone(),
                    label: format!("Local disk ({})", root.trim_end_matches('\\')),
                    volume_name: String::new(),
                    file_system: String::new(),
                    total_bytes: 0,
                    available_bytes: 0,
                    drive_kind: "unknown".to_string(),
                    media_label: "Drive".to_string(),
                    bus_type: String::new(),
                    friendly_name: String::new(),
                    is_system: root.starts_with("C:"),
                });
            }
        }
    } else {
        drives.push(TransferDriveOption {
            id: "/".to_string(),
            root_path: "/".to_string(),
            label: "/".to_string(),
            volume_name: String::new(),
            file_system: String::new(),
            total_bytes: 0,
            available_bytes: 0,
            drive_kind: "unknown".to_string(),
            media_label: "Drive".to_string(),
            bus_type: String::new(),
            friendly_name: String::new(),
            is_system: true,
        });
    }
    Ok(drives)
}

fn optional_non_empty(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn dialog_path_result(path: Option<FilePath>) -> Result<DialogPathResult, String> {
    match path {
        Some(path) => {
            let path = path.into_path().map_err(|error| error.to_string())?;
            Ok(DialogPathResult {
                canceled: false,
                path: Some(path.to_string_lossy().to_string()),
            })
        }
        None => Ok(DialogPathResult {
            canceled: true,
            path: None,
        }),
    }
}

fn add_dialog_filters<R: tauri::Runtime>(
    mut builder: tauri_plugin_dialog::FileDialogBuilder<R>,
    filters: Option<Vec<DialogFilter>>,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    for filter in filters.unwrap_or_default() {
        let extensions = filter.extensions;
        let extension_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(filter.name, &extension_refs);
    }
    builder
}

fn apply_save_default_path<R: tauri::Runtime>(
    mut builder: tauri_plugin_dialog::FileDialogBuilder<R>,
    default_path: Option<&str>,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    if let Some(default_path) = default_path {
        let path = PathBuf::from(default_path);
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            builder = builder.set_directory(parent);
        }
        if let Some(file_name) = path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .filter(|file_name| !file_name.is_empty())
        {
            builder = builder.set_file_name(file_name.to_string());
        } else {
            builder = builder.set_file_name(default_path.to_string());
        }
    }
    builder
}

#[tauri::command]
async fn fluxora_dialog_pick_file(
    app: AppHandle,
    request: DialogFileRequest,
) -> Result<DialogPathResult, String> {
    let mut dialog = app.dialog().file().set_title(request.title);
    if let Some(initial_directory) = optional_non_empty(&request.initial_directory) {
        dialog = dialog.set_directory(initial_directory);
    }
    dialog_path_result(add_dialog_filters(dialog, request.filters).blocking_pick_file())
}

#[tauri::command]
async fn fluxora_dialog_pick_folder(
    app: AppHandle,
    request: DialogFolderRequest,
) -> Result<DialogPathResult, String> {
    let mut dialog = app.dialog().file().set_title(request.title);
    if let Some(initial_path) = optional_non_empty(&request.initial_path) {
        dialog = dialog.set_directory(initial_path);
    }
    dialog_path_result(dialog.blocking_pick_folder())
}

#[tauri::command]
async fn fluxora_dialog_save_file(
    app: AppHandle,
    request: DialogSaveFileRequest,
) -> Result<DialogPathResult, String> {
    let dialog = app.dialog().file().set_title(request.title);
    let dialog = apply_save_default_path(dialog, optional_non_empty(&request.default_path));
    dialog_path_result(add_dialog_filters(dialog, request.filters).blocking_save_file())
}

#[tauri::command]
async fn fluxora_open_external(app: AppHandle, url: String) -> Result<OpenExternalResult, String> {
    let url = url.trim().to_string();
    if url.is_empty() || url.chars().any(char::is_whitespace) {
        return Ok(OpenExternalResult {
            ok: false,
            reason: Some("invalid-url".to_string()),
        });
    }

    let lower_url = url.to_ascii_lowercase();
    if !lower_url.starts_with("https://") && !lower_url.starts_with("mailto:") {
        return Ok(OpenExternalResult {
            ok: false,
            reason: Some("unsupported-protocol".to_string()),
        });
    }

    match app.opener().open_url(url, None::<String>) {
        Ok(()) => Ok(OpenExternalResult {
            ok: true,
            reason: None,
        }),
        Err(_) => Ok(OpenExternalResult {
            ok: false,
            reason: Some("open-failed".to_string()),
        }),
    }
}

#[tauri::command]
async fn fluxora_shell_open_path(app: AppHandle, path: String) -> Result<ShellPathResult, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Ok(ShellPathResult {
            ok: false,
            reason: Some("invalid-path".to_string()),
            message: Some("Path is empty.".to_string()),
        });
    }

    match app.opener().open_path(path, None::<String>) {
        Ok(()) => Ok(ShellPathResult {
            ok: true,
            reason: None,
            message: None,
        }),
        Err(error) => Ok(ShellPathResult {
            ok: false,
            reason: Some("open-failed".to_string()),
            message: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
async fn fluxora_shell_show_item_in_folder(
    app: AppHandle,
    path: String,
) -> Result<ShellPathResult, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Ok(ShellPathResult {
            ok: false,
            reason: Some("invalid-path".to_string()),
            message: Some("Path is empty.".to_string()),
        });
    }

    match app.opener().reveal_item_in_dir(PathBuf::from(path)) {
        Ok(()) => Ok(ShellPathResult {
            ok: true,
            reason: None,
            message: None,
        }),
        Err(error) => Ok(ShellPathResult {
            ok: false,
            reason: Some("show-failed".to_string()),
            message: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
async fn fluxora_show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
async fn fluxora_transfer_open_mo2_in_main(app: AppHandle) -> Result<(), String> {
    fluxora_show_main_window(app.clone()).await?;
    app.emit_to(MAIN_WINDOW_LABEL, TRANSFER_MO2_OPEN_EVENT, ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn fluxora_transfer_start_mo2_in_main(app: AppHandle, handoff: Value) -> Result<(), String> {
    fluxora_show_main_window(app.clone()).await?;
    app.emit_to(MAIN_WINDOW_LABEL, TRANSFER_MO2_HANDOFF_EVENT, handoff)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn fluxora_window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
async fn fluxora_window_toggle_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
async fn fluxora_window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
async fn fluxora_open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("/?window=settings".into()),
    )
    .title("Settings")
    .inner_size(980.0, 700.0)
    .min_inner_size(860.0, 620.0)
    .resizable(true)
    .decorations(false)
    .background_color(tauri::window::Color(0x10, 0x13, 0x17, 0xff))
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(BridgeState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let log_directory = logs_dir(&app);
                let _ = write_log(
                    &app,
                    "main",
                    "info",
                    "Startup",
                    &format!(
                        "Fluxora Tauri shell started. logsDir={}",
                        log_directory.to_string_lossy()
                    ),
                    None,
                )
                .await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fluxora_app_info,
            fluxora_runtime_paths,
            fluxora_current_executable,
            fluxora_security_state,
            fluxora_log,
            fluxora_bridge_request,
            fluxora_bridge_status,
            fluxora_shutdown_bridge,
            fluxora_list_destination_drives,
            fluxora_dialog_pick_file,
            fluxora_dialog_pick_folder,
            fluxora_dialog_save_file,
            fluxora_open_external,
            fluxora_shell_open_path,
            fluxora_shell_show_item_in_folder,
            fluxora_show_main_window,
            fluxora_transfer_open_mo2_in_main,
            fluxora_transfer_start_mo2_in_main,
            fluxora_window_minimize,
            fluxora_window_toggle_maximize,
            fluxora_window_close,
            fluxora_open_settings_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fluxora");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_progress_payload_adds_operation_id_from_meta() {
        let envelope = json!({
            "jsonrpc": "2.0",
            "method": "operations.progress",
            "params": {
                "phase": "copy",
                "overallPercent": 42
            },
            "meta": {
                "operationId": "op_transfer_import"
            }
        });

        let payload = operation_progress_payload(&envelope);

        assert_eq!(payload["operationId"], "op_transfer_import");
        assert_eq!(payload["overallPercent"], 42);
    }

    #[test]
    fn operation_progress_payload_keeps_payload_operation_id() {
        let envelope = json!({
            "jsonrpc": "2.0",
            "method": "operations.progress",
            "params": {
                "operationId": "op_from_payload",
                "phase": "copy"
            },
            "meta": {
                "operationId": "op_from_meta"
            }
        });

        let payload = operation_progress_payload(&envelope);

        assert_eq!(payload["operationId"], "op_from_payload");
    }
}
