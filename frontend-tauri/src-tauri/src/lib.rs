use keyring::Entry;
use notify_debouncer_full::{
    new_debouncer,
    new_debouncer_opt,
    notify::{
        event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
        Config, EventKind, RecommendedWatcher, RecursiveMode,
    },
    DebounceEventResult, DebouncedEvent, Debouncer, NoCache, RecommendedCache,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering},
    Arc, OnceLock,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    ipc::Response, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

const BRIDGE_PROTOCOL_VERSION: &str = "1.0";
const BRIDGE_TIMEOUT_MS: u64 = 10_000;
const BRIDGE_INVOKE_ERROR_SCHEMA: &str = "fluxora.tauri.bridge-error.v1";
const AI_HOST_PROTOCOL_VERSION: &str = "1.0";
const AI_HOST_TIMEOUT_MS: u64 = 5_000;
const AI_HOST_LONG_RUNNING_TIMEOUT_MS: u64 = 45 * 60 * 1_000;
const PRIVATE_NEXUS_API_AUTH_HEADER_METHOD: &str = "nexus.getApiAuthHeader";
const PRIVATE_AI_NEXUS_CREDENTIAL_FIELD: &str = "nativeNexusApiCredential";
const AI_CREDENTIAL_SERVICE: &str = "app.fluxora.desktop.ai.provider";
const PROGRESS_EVENT: &str = "fluxora:operations:progress";
const AI_RUN_EVENT: &str = "fluxora:ai:run-event";
const MAIN_WINDOW_LABEL: &str = "main";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const BUILD_SETTINGS_WINDOW_LABEL_PREFIX: &str = "build-settings";
const MOD_DETAILS_WINDOW_LABEL_PREFIX: &str = "mod-details";
const TEXT_EDITOR_WINDOW_LABEL_PREFIX: &str = "text-editor";
const FILE_PREVIEW_WINDOW_LABEL_PREFIX: &str = "file-preview";
const BUILD_SETTINGS_PATHS_SAVED_EVENT: &str = "fluxora:build-settings:paths-saved";

fn validate_negotiated_protocol(
    handshake: &Value,
    expected_protocol: &str,
    host_name: &str,
) -> Result<(), String> {
    let negotiated_protocol = handshake
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or("<missing>");
    if negotiated_protocol == expected_protocol {
        return Ok(());
    }

    Err(format!(
        "{host_name} negotiated unsupported protocol version {negotiated_protocol}; expected {expected_protocol}."
    ))
}
const TRANSFER_MO2_HANDOFF_EVENT: &str = "fluxora:transfer:mo2-handoff";
const TRANSFER_MO2_OPEN_EVENT: &str = "fluxora:transfer:mo2-open";
const NXM_INBOUND_LINKS_CAPTURED_EVENT: &str = "fluxora:nxm:inbound-links-captured";
const DOWNLOADS_FOLDER_CHANGED_EVENT: &str = "fluxora:downloads:folder-changed";
const BUILD_CONTENT_CHANGED_EVENT: &str = "fluxora:build-content:changed";
const OPERATION_CANCEL_DIR_NAME: &str = "operation-cancel";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const PROCESS_WATCH_DEFAULT_POLL_MS: u64 = 1_000;
const PROCESS_WATCH_MIN_POLL_MS: u64 = 250;
const PROCESS_WATCH_MAX_POLL_MS: u64 = 5_000;
const PROCESS_WATCH_DEFAULT_HANDOFF_MS: u64 = 30_000;
const PROCESS_WATCH_FALLBACK_POLL_MS: u64 = 250;
const FLUXORA_VFS_MODULE_NAME: &str = "FluxoraVfs.dll";
const OPERATION_PROGRESS_CACHE_LIMIT: usize = 100;
const RECENT_OPERATION_LOG_MAX_LIMIT: usize = 80;
const RECENT_OPERATION_LOG_TAIL_BYTES: u64 = 512 * 1024;
const DOWNLOADS_FOLDER_WATCH_DEBOUNCE_MS: u64 = 650;
const BUILD_CONTENT_WATCH_DEBOUNCE_MS: u64 = 900;
const NIF_PREVIEW_MAX_BATCH_ASSETS: usize = 64;
const NIF_PREVIEW_MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;
const NIF_PREVIEW_MAX_SESSION_BYTES: u64 = 256 * 1024 * 1024;
const NIF_PREVIEW_IDLE_TIMEOUT_MS: u128 = 15 * 60 * 1_000;
const NIF_PREVIEW_CLEANUP_INTERVAL_MS: u64 = 60 * 1_000;

fn encode_query_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn stable_label_suffix(value: &str) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in value.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

mod process_platform;

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

fn payload_string(payload: &Value, key: &str) -> String {
    payload
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn payload_percent(payload: &Value) -> f64 {
    payload
        .get("overallPercent")
        .and_then(Value::as_f64)
        .unwrap_or_default()
}

fn operation_progress_state(payload: &Value) -> &'static str {
    let phase = payload_string(payload, "phase").to_ascii_lowercase();
    let current_step = payload_string(payload, "currentStep").to_ascii_lowercase();
    let status_message = payload_string(payload, "statusMessage").to_ascii_lowercase();
    let percent = payload_percent(payload);
    if percent >= 100.0
        || [
            "done",
            "complete",
            "completed",
            "cancelled",
            "canceled",
            "failed",
        ]
        .iter()
        .any(|needle| {
            phase.contains(needle)
                || current_step.contains(needle)
                || status_message.contains(needle)
        })
    {
        "completed"
    } else {
        "running"
    }
}

fn operation_status_snapshot(payload: &Value) -> Option<Value> {
    let operation_id = payload
        .get("operationId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())?;

    Some(json!({
        "operationId": operation_id,
        "state": operation_progress_state(payload),
        "phase": payload_string(payload, "phase"),
        "currentStep": payload_string(payload, "currentStep"),
        "currentItem": payload_string(payload, "currentItem"),
        "overallPercent": payload_percent(payload),
        "statusMessage": payload_string(payload, "statusMessage"),
        "updatedAt": payload_string(payload, "updatedAt")
    }))
}

async fn record_operation_progress(app: &AppHandle, payload: &Value) {
    let state = app.state::<OperationStatusState>();
    let mut progress = state.progress.lock().await;
    let mut payload = payload.clone();
    if let Value::Object(fields) = &mut payload {
        fields
            .entry("updatedAt".to_string())
            .or_insert_with(|| Value::String(now_millis().to_string()));
    }
    progress.push(payload);
    if progress.len() > OPERATION_PROGRESS_CACHE_LIMIT {
        let extra = progress.len() - OPERATION_PROGRESS_CACHE_LIMIT;
        progress.drain(0..extra);
    }
}

#[derive(Default)]
struct BridgeState {
    process: Mutex<BridgeProcess>,
    interactive_process: Mutex<BridgeProcess>,
}

#[derive(Clone)]
struct NifPreviewAssetRecord {
    asset_id: String,
    resolved_path: PathBuf,
    size: u64,
    mime_type: String,
    relative_path: String,
    source: String,
    content_key: String,
}

impl NifPreviewAssetRecord {
    fn public_value(&self) -> Value {
        json!({
            "assetId": self.asset_id,
            "size": self.size,
            "mimeType": self.mime_type,
            "relativePath": self.relative_path,
            "source": self.source,
            "contentKey": self.content_key
        })
    }
}

#[derive(Clone)]
struct NifPreviewVariantRecord {
    variant_id: String,
    mod_path: String,
    mod_name: String,
    order: i64,
    enabled: bool,
    relative_path: String,
    size: u64,
}

impl NifPreviewVariantRecord {
    fn public_value(&self) -> Value {
        json!({
            "variantId": self.variant_id,
            "modName": self.mod_name,
            "order": self.order,
            "enabled": self.enabled,
            "relativePath": self.relative_path,
            "size": self.size
        })
    }
}

struct NifPreviewSession {
    window_label: String,
    project_directory: String,
    profile_name: String,
    operation_id: String,
    variants: Vec<NifPreviewVariantRecord>,
    active_index: usize,
    assets: HashMap<String, NifPreviewAssetRecord>,
    total_bytes: u64,
    last_access_ms: u128,
}

#[derive(Default)]
struct NifPreviewSessionState {
    sessions: Mutex<HashMap<String, NifPreviewSession>>,
    sequence: AtomicU64,
}

#[derive(Default)]
struct OperationStatusState {
    progress: Mutex<Vec<Value>>,
}

struct DownloadsFolderWatchState {
    active: Mutex<Option<DownloadsFolderWatcher>>,
    generation: Arc<AtomicU64>,
    requested_generation: AtomicU64,
    sequence: Arc<AtomicU64>,
}

impl Default for DownloadsFolderWatchState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
            requested_generation: AtomicU64::new(0),
            sequence: Arc::new(AtomicU64::new(0)),
        }
    }
}

struct DownloadsFolderWatcher {
    debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
    project_directory: String,
    downloads_directory: PathBuf,
    operation_id: String,
    generation: u64,
}

struct BuildContentWatchState {
    active: Mutex<Option<BuildContentWatcher>>,
    generation: Arc<AtomicU64>,
    requested_generation: AtomicU64,
    sequence: Arc<AtomicU64>,
}

impl Default for BuildContentWatchState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
            requested_generation: AtomicU64::new(0),
            sequence: Arc::new(AtomicU64::new(0)),
        }
    }
}

struct BuildContentWatcher {
    debouncer: Debouncer<RecommendedWatcher, NoCache>,
    project_directory: String,
    mods_directory: PathBuf,
    profiles_directory: PathBuf,
    profile_name: String,
    operation_id: String,
    generation: u64,
}

struct BuildContentWatchEventContext {
    app: AppHandle,
    project_directory: String,
    mods_directory: PathBuf,
    profiles_directory: PathBuf,
    profile_name: String,
    game_data_directory: Option<PathBuf>,
    sequence: Arc<AtomicU64>,
}

#[derive(Default)]
struct BridgeProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    host_path: Option<PathBuf>,
    handshake: Option<Value>,
}

struct AiHostState {
    process: Mutex<AiHostProcess>,
    active_process_id: Arc<AtomicU32>,
}

impl Default for AiHostState {
    fn default() -> Self {
        let active_process_id = Arc::new(AtomicU32::new(0));
        Self {
            process: Mutex::new(AiHostProcess {
                active_process_id: Arc::clone(&active_process_id),
                ..AiHostProcess::default()
            }),
            active_process_id,
        }
    }
}

struct AiHostProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    host_path: Option<PathBuf>,
    handshake: Option<Value>,
    active_process_id: Arc<AtomicU32>,
}

impl Default for AiHostProcess {
    fn default() -> Self {
        Self {
            child: None,
            stdin: None,
            stdout: None,
            host_path: None,
            handshake: None,
            active_process_id: Arc::new(AtomicU32::new(0)),
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
struct OperationRequest {
    #[serde(rename = "operationId")]
    operation_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadsFolderWatchResult {
    accepted: bool,
    operation_id: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildContentWatchRequest {
    project_directory: String,
    mods_directory: String,
    profiles_directory: String,
    profile_name: Option<String>,
    game_directory: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildContentWatchResult {
    accepted: bool,
    operation_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadsFolderChangedPayload {
    project_directory: String,
    downloads_directory: String,
    event_id: String,
    sequence: u64,
    reason: String,
    changes: Vec<DownloadsFolderChange>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadsFolderChange {
    path: String,
    file_name: String,
    kind: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildContentChangedPayload {
    project_directory: String,
    mods_directory: String,
    profiles_directory: String,
    profile_name: String,
    event_id: String,
    sequence: u64,
    reason: String,
    changes: Vec<BuildContentChange>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildContentChange {
    path: String,
    file_name: String,
    kind: String,
    area: String,
}

struct BuildContentWatchRoot {
    path: PathBuf,
    recursive: bool,
}

#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RecentOperationLogsOptions {
    max_entries: Option<usize>,
    operation_id_filter: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchProcessWatchRequest {
    process_id: u32,
    process_name: Option<String>,
    launch_tracking_kind: Option<String>,
    #[serde(default)]
    expected_child_process_names: Vec<String>,
    handoff_timeout_ms: Option<u64>,
    poll_interval_ms: Option<u64>,
    operation_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessWatchResult {
    process_id: u32,
    process_name: String,
    state: String,
    tracked_kind: String,
    operation_id: String,
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

fn bridge_core_status_is_ready(status: &Value) -> bool {
    status.get("available").and_then(Value::as_bool) == Some(true)
        && status.get("initialized").and_then(Value::as_bool) == Some(true)
}

fn bridge_runtime_is_ready(status: &Value, capabilities: &Value) -> bool {
    bridge_core_status_is_ready(status)
        && capabilities
            .get("core")
            .and_then(|core| core.get("available"))
            .and_then(Value::as_bool)
            == Some(true)
}

fn operation_id(request: Option<&OperationRequest>, scope: &str) -> String {
    request
        .and_then(|request| request.operation_id.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("op_{}_{}", now_millis(), scope))
}

fn downloads_watch_request(request: Option<OperationRequest>, scope: &str) -> OperationRequest {
    request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, scope)),
    })
}

fn build_content_watch_request(request: Option<OperationRequest>, scope: &str) -> OperationRequest {
    request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, scope)),
    })
}

fn build_content_watch_generation_is_current(
    active_generation: &AtomicU64,
    watcher_generation: u64,
) -> bool {
    active_generation.load(Ordering::SeqCst) == watcher_generation
}

fn reserve_build_content_watch_generation(requested_generation: &AtomicU64) -> u64 {
    requested_generation.fetch_add(1, Ordering::SeqCst) + 1
}

fn build_content_watch_install_is_current(
    requested_generation: &AtomicU64,
    watcher_generation: u64,
) -> bool {
    requested_generation.load(Ordering::SeqCst) == watcher_generation
}

fn is_transient_downloads_watch_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return true;
    };
    let file_name = file_name.trim();
    if file_name.is_empty() {
        return true;
    }

    let lower = file_name.to_ascii_lowercase();
    if matches!(lower.as_str(), ".ds_store" | "thumbs.db" | "desktop.ini") {
        return true;
    }
    if lower.starts_with("~$") || lower.starts_with(".~") {
        return true;
    }

    [
        ".tmp",
        ".temp",
        ".crdownload",
        ".download",
        ".partial",
        ".part",
        ".swp",
        ".swx",
        ".lock",
    ]
    .iter()
    .any(|suffix| lower.ends_with(suffix))
}

fn file_watch_event_kind(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(CreateKind::File | CreateKind::Folder | CreateKind::Any) => "created",
        EventKind::Modify(ModifyKind::Name(
            RenameMode::Any | RenameMode::Both | RenameMode::From | RenameMode::To,
        )) => "renamed",
        EventKind::Modify(_) => "modified",
        EventKind::Remove(RemoveKind::File | RemoveKind::Folder | RemoveKind::Any) => "removed",
        _ => "changed",
    }
}

fn downloads_folder_event_kind(kind: &EventKind) -> &'static str {
    file_watch_event_kind(kind)
}

fn downloads_folder_changes(events: Vec<DebouncedEvent>) -> Vec<DownloadsFolderChange> {
    let mut seen = HashSet::new();
    let mut changes = Vec::new();

    for event in events {
        let kind = downloads_folder_event_kind(&event.kind).to_string();
        for path in &event.paths {
            if is_transient_downloads_watch_path(path) {
                continue;
            }

            let path_string = path.to_string_lossy().to_string();
            let key = format!("{kind}\0{path_string}");
            if !seen.insert(key) {
                continue;
            }

            changes.push(DownloadsFolderChange {
                file_name: path
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_default(),
                path: path_string,
                kind: kind.clone(),
            });
        }
    }

    changes
}

fn downloads_folder_batch_reason(changes: &[DownloadsFolderChange]) -> String {
    let Some(first) = changes.first() else {
        return "changed".to_string();
    };
    if changes.iter().all(|change| change.kind == first.kind) {
        return first.kind.clone();
    }
    "batch".to_string()
}

fn is_transient_build_content_path(path: &Path) -> bool {
    if path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|value| value.eq_ignore_ascii_case(".flow"))
    }) {
        return true;
    }

    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return true;
    };
    let file_name = file_name.trim();
    if file_name.is_empty() {
        return true;
    }

    let lower = file_name.to_ascii_lowercase();
    let is_compact_atomic_backup = lower
        .strip_prefix(".fb")
        .is_some_and(|token| token.len() == 8 && token.bytes().all(|byte| byte.is_ascii_hexdigit()));
    if matches!(
        lower.as_str(),
        ".ds_store" | "thumbs.db" | "desktop.ini" | ".fluxora-mod.json"
    ) || is_compact_atomic_backup
        || lower.ends_with(".fluxora-bak")
    {
        return true;
    }
    if lower.starts_with("~$") || lower.starts_with(".~") {
        return true;
    }

    [
        ".tmp",
        ".temp",
        ".crdownload",
        ".download",
        ".partial",
        ".part",
        ".swp",
        ".swx",
        ".lock",
        ".journal",
    ]
    .iter()
    .any(|suffix| lower.ends_with(suffix))
}

fn push_build_content_watch_root(
    roots: &mut Vec<BuildContentWatchRoot>,
    path: PathBuf,
    recursive: bool,
) {
    if roots.iter().any(|root| root.path == path) {
        return;
    }
    roots.push(BuildContentWatchRoot { path, recursive });
}

fn build_content_watch_roots(
    mods_directory: &Path,
    profiles_directory: &Path,
    profile_name: &str,
    game_directory: Option<&Path>,
) -> Vec<BuildContentWatchRoot> {
    let mut roots = Vec::new();
    if mods_directory.is_dir() {
        push_build_content_watch_root(&mut roots, mods_directory.to_path_buf(), true);
    }

    if profiles_directory.is_dir() {
        let profile_directory = if profile_name.trim().is_empty() {
            None
        } else {
            Some(profiles_directory.join(profile_name))
        };
        match profile_directory {
            Some(path) if path.is_dir() => push_build_content_watch_root(&mut roots, path, false),
            _ => push_build_content_watch_root(&mut roots, profiles_directory.to_path_buf(), true),
        }
    }

    if let Some(game_directory) = game_directory {
        let data_directory = game_directory.join("Data");
        if data_directory.is_dir() {
            push_build_content_watch_root(&mut roots, data_directory, false);
        }
    }

    roots
}

fn build_content_area_for_path(
    path: &Path,
    mods_directory: &Path,
    profiles_directory: &Path,
    game_data_directory: Option<&Path>,
) -> &'static str {
    if path.starts_with(mods_directory) {
        return "mods";
    }
    if path.starts_with(profiles_directory) {
        return "profile";
    }
    if game_data_directory.is_some_and(|directory| path.starts_with(directory)) {
        return "game";
    }
    "content"
}

fn build_content_changes(
    events: Vec<DebouncedEvent>,
    mods_directory: &Path,
    profiles_directory: &Path,
    game_data_directory: Option<&Path>,
) -> Vec<BuildContentChange> {
    let mut seen = HashSet::new();
    let mut changes = Vec::new();

    for event in events {
        let kind = file_watch_event_kind(&event.kind).to_string();
        for path in &event.paths {
            if is_transient_build_content_path(path) {
                continue;
            }

            let area = build_content_area_for_path(
                path,
                mods_directory,
                profiles_directory,
                game_data_directory,
            )
            .to_string();
            let path_string = path.to_string_lossy().to_string();
            let key = format!("{area}\0{kind}\0{path_string}");
            if !seen.insert(key) {
                continue;
            }

            changes.push(BuildContentChange {
                path: path_string,
                file_name: path
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_default(),
                kind: kind.clone(),
                area,
            });
        }
    }

    changes
}

fn build_content_reconciliation_changes(
    mods_directory: &Path,
    profiles_directory: &Path,
    game_data_directory: Option<&Path>,
) -> Vec<BuildContentChange> {
    let mut roots = vec![
        (mods_directory, "mods"),
        (profiles_directory, "profile"),
    ];
    if let Some(game_data_directory) = game_data_directory {
        roots.push((game_data_directory, "game"));
    }
    roots
        .into_iter()
        .map(|(path, area)| BuildContentChange {
            path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default(),
            kind: "reconcile".to_string(),
            area: area.to_string(),
        })
        .collect()
}

fn build_content_batch_reason(changes: &[BuildContentChange]) -> String {
    let Some(first) = changes.first() else {
        return "changed".to_string();
    };
    if changes
        .iter()
        .all(|change| change.area == first.area && change.kind == first.kind)
    {
        return format!("{}-{}", first.area, first.kind);
    }
    "batch".to_string()
}

fn emit_downloads_folder_watch_result(
    app: &AppHandle,
    project_directory: &str,
    downloads_directory: &str,
    sequence: &AtomicU64,
    result: DebounceEventResult,
) {
    match result {
        Ok(events) => {
            let changes = downloads_folder_changes(events);
            if changes.is_empty() {
                return;
            }

            let sequence = sequence.fetch_add(1, Ordering::SeqCst) + 1;
            let reason = downloads_folder_batch_reason(&changes);
            let payload = DownloadsFolderChangedPayload {
                project_directory: project_directory.to_string(),
                downloads_directory: downloads_directory.to_string(),
                event_id: format!("evt_{}_downloads_folder_{sequence}", now_millis()),
                sequence,
                reason,
                changes,
            };
            let _ = app.emit_to(MAIN_WINDOW_LABEL, DOWNLOADS_FOLDER_CHANGED_EVENT, payload);
        }
        Err(errors) => {
            let message = errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ");
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = write_log(
                    &app,
                    "main",
                    "warning",
                    "DownloadsFolderWatcher",
                    &format!("Downloads folder watcher reported an error. reason={message}"),
                    None,
                )
                .await;
            });
        }
    }
}

fn emit_build_content_watch_result(
    context: &BuildContentWatchEventContext,
    result: DebounceEventResult,
) {
    match result {
        Ok(events) => {
            let changes = build_content_changes(
                events,
                &context.mods_directory,
                &context.profiles_directory,
                context.game_data_directory.as_deref(),
            );
            if changes.is_empty() {
                return;
            }

            let sequence = context.sequence.fetch_add(1, Ordering::SeqCst) + 1;
            let reason = build_content_batch_reason(&changes);
            let payload = BuildContentChangedPayload {
                project_directory: context.project_directory.clone(),
                mods_directory: context.mods_directory.to_string_lossy().to_string(),
                profiles_directory: context.profiles_directory.to_string_lossy().to_string(),
                profile_name: context.profile_name.clone(),
                event_id: format!("evt_{}_build_content_{sequence}", now_millis()),
                sequence,
                reason,
                changes,
            };
            let _ = context
                .app
                .emit_to(MAIN_WINDOW_LABEL, BUILD_CONTENT_CHANGED_EVENT, payload);
        }
        Err(errors) => {
            let message = errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ");
            let sequence = context.sequence.fetch_add(1, Ordering::SeqCst) + 1;
            let payload = BuildContentChangedPayload {
                project_directory: context.project_directory.clone(),
                mods_directory: context.mods_directory.to_string_lossy().to_string(),
                profiles_directory: context.profiles_directory.to_string_lossy().to_string(),
                profile_name: context.profile_name.clone(),
                event_id: format!("evt_{}_build_content_{sequence}", now_millis()),
                sequence,
                reason: "watcher-error-reconcile".to_string(),
                changes: build_content_reconciliation_changes(
                    &context.mods_directory,
                    &context.profiles_directory,
                    context.game_data_directory.as_deref(),
                ),
            };
            let _ = context
                .app
                .emit_to(MAIN_WINDOW_LABEL, BUILD_CONTENT_CHANGED_EVENT, payload);
            let app = context.app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = write_log(
                    &app,
                    "main",
                    "warning",
                    "BuildContentWatcher",
                    &format!("Build content watcher reported an error. reason={message}"),
                    None,
                )
                .await;
            });
        }
    }
}

fn is_nxm_activation_arg(value: &str) -> bool {
    value
        .get(..6)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("nxm://"))
}

fn extract_nxm_links_from_args<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for arg in args {
        let value = arg.as_ref().trim().trim_matches(['"', '\'']);
        if value.is_empty() || !is_nxm_activation_arg(value) {
            continue;
        }

        let key = value.to_ascii_lowercase();
        let value = value.to_string();
        if seen.insert(key) {
            links.push(value);
        }
    }
    links
}

fn handle_nxm_activation_args(app: AppHandle, args: Vec<String>, source: &'static str) {
    let links = extract_nxm_links_from_args(args);
    if links.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }

    tauri::async_runtime::spawn(async move {
        queue_inbound_nxm_links(app, links, source).await;
    });
}

async fn queue_inbound_nxm_links(app: AppHandle, links: Vec<String>, source: &'static str) {
    let count = links.len();
    if count == 0 {
        return;
    }

    let operation_id = operation_id(None, "nxm_activation_capture");
    let request = OperationRequest {
        operation_id: Some(operation_id.clone()),
    };
    let params = json!({
        "projectDirectory": "",
        "links": links
    });

    let result = {
        let state = bridge_state(&app);
        let mut bridge = state.process.lock().await;
        bridge
            .request(&app, "nxm.captureLinks", params, request, BRIDGE_TIMEOUT_MS)
            .await
    };

    match result {
        Ok(_) => {
            let _ = write_log(
                &app,
                "main",
                "info",
                "NxmActivation",
                &format!(
                    "Queued inbound NXM links. source={} count={}",
                    source, count
                ),
                Some(&operation_id),
            )
            .await;
            let _ = app.emit_to(
                MAIN_WINDOW_LABEL,
                NXM_INBOUND_LINKS_CAPTURED_EVENT,
                json!({
                    "count": count,
                    "operationId": operation_id,
                    "source": source
                }),
            );
        }
        Err(error) => {
            let _ = write_log(
                &app,
                "main",
                "error",
                "NxmActivation",
                &format!(
                    "Failed to queue inbound NXM links. source={} count={} reason={}",
                    source, count, error
                ),
                Some(&operation_id),
            )
            .await;
        }
    }
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

fn fluxora_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            return PathBuf::from(app_data).join("Fluxora");
        }

        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            return PathBuf::from(user_profile)
                .join("AppData")
                .join("Roaming")
                .join("Fluxora");
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(xdg_data_home) = std::env::var_os("XDG_DATA_HOME") {
            return PathBuf::from(xdg_data_home).join("Fluxora");
        }

        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("Fluxora");
        }
    }

    std::env::temp_dir().join("Fluxora")
}

fn executable_log_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("logs")))
}

static LOG_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
static LOG_DIRECTORY_PROBE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn directory_is_writable(path: &Path) -> bool {
    if std::fs::create_dir_all(path).is_err() {
        return false;
    }

    let sequence = LOG_DIRECTORY_PROBE_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    let probe_path = path.join(format!(
        ".fluxora-write-probe-{}-{}-{sequence}",
        std::process::id(),
        now_millis()
    ));
    let Ok(mut probe) = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe_path)
    else {
        return false;
    };
    if std::io::Write::write_all(&mut probe, b"probe").is_err() {
        drop(probe);
        let _ = std::fs::remove_file(probe_path);
        return false;
    }
    drop(probe);

    std::fs::remove_file(probe_path).is_ok()
}

fn choose_writable_directory(candidates: &[PathBuf]) -> PathBuf {
    candidates
        .iter()
        .find(|candidate| directory_is_writable(candidate))
        .cloned()
        .or_else(|| candidates.last().cloned())
        .unwrap_or_else(|| std::env::temp_dir().join("Fluxora").join("logs"))
}

fn log_directory_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("FLUXORA_LOG_DIR") {
        push_unique_candidate(&mut candidates, PathBuf::from(configured));
    }
    if let Some(executable) = executable_log_dir() {
        push_unique_candidate(&mut candidates, executable);
    }
    push_unique_candidate(&mut candidates, fluxora_data_dir().join("logs"));
    push_unique_candidate(
        &mut candidates,
        std::env::temp_dir().join("Fluxora").join("logs"),
    );
    candidates
}

fn logs_dir(_app: &AppHandle) -> PathBuf {
    LOG_DIRECTORY
        .get_or_init(|| choose_writable_directory(&log_directory_candidates()))
        .clone()
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

fn redact_query_key(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(index) = rest.to_ascii_lowercase().find("key=") {
        output.push_str(&rest[..index]);
        output.push_str("key=[redacted-secret]");
        let after_key = &rest[index + 4..];
        let end = after_key
            .find(|character: char| {
                character == '&'
                    || character.is_whitespace()
                    || matches!(character, '"' | '\'' | ')' | ']')
            })
            .unwrap_or(after_key.len());
        rest = &after_key[end..];
    }

    output.push_str(rest);
    output
}

fn redact_bearer_tokens(value: &str) -> String {
    let mut output = Vec::new();
    let mut redact_next = false;
    for token in value.split_whitespace() {
        if redact_next {
            output.push("[redacted-secret]".to_string());
            redact_next = false;
            continue;
        }

        output.push(token.to_string());
        if token.eq_ignore_ascii_case("bearer") {
            redact_next = true;
        }
    }

    output.join(" ")
}

fn redact_named_secret_assignments(value: &str) -> String {
    value
        .split_whitespace()
        .map(|token| {
            let lower = token.to_ascii_lowercase();
            for key in [
                "api_key",
                "apikey",
                "token",
                "secret",
                "password",
                "client_secret",
            ] {
                if lower.starts_with(&format!("{key}=")) || lower.starts_with(&format!("{key}:")) {
                    return format!("{key}=[redacted-secret]");
                }
            }
            token.to_string()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn sanitize_log(value: &str) -> String {
    let value = value.replace(['\r', '\n'], " ");
    let value = redact_query_key(&value);
    let value = redact_bearer_tokens(&value);
    redact_named_secret_assignments(&value).trim().to_string()
}

fn serialize_bridge_invoke_error(method: &str, operation_id: &str, error: &Value) -> String {
    json!({
        "schema": BRIDGE_INVOKE_ERROR_SCHEMA,
        "method": method,
        "operationId": operation_id,
        "error": error
    })
    .to_string()
}

fn bridge_status_error_fields(message: &str, fallback_category: &str) -> (String, String) {
    let Ok(payload) = serde_json::from_str::<Value>(message) else {
        return (message.to_string(), fallback_category.to_string());
    };
    if payload.get("schema").and_then(Value::as_str) != Some(BRIDGE_INVOKE_ERROR_SCHEMA) {
        return (message.to_string(), fallback_category.to_string());
    }

    let native_error = payload.get("error").and_then(Value::as_object);
    let decoded_message = native_error
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .unwrap_or("Native bridge request failed.");
    let decoded_category = native_error
        .and_then(|error| error.get("category"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|category| !category.is_empty())
        .unwrap_or(fallback_category);

    (decoded_message.to_string(), decoded_category.to_string())
}

fn sanitize_ai_event_text(value: &str, max_len: usize) -> String {
    let mut sanitized = sanitize_log(value);
    if sanitized.len() > max_len {
        sanitized.truncate(max_len);
    }
    sanitized
}

fn supported_ai_event_type(value: &str) -> bool {
    matches!(
        value,
        "progress"
            | "note"
            | "tool-started"
            | "tool-completed"
            | "site-visited"
            | "error"
            | "heartbeat"
    )
}

fn supported_ai_event_level(value: &str) -> bool {
    matches!(value, "info" | "warning" | "error")
}

fn supported_ai_event_visibility(value: &str) -> bool {
    matches!(value, "user" | "developer" | "audit")
}

fn sanitize_ai_event_payload_value(value: &Value) -> Option<Value> {
    match value {
        Value::Null => Some(Value::Null),
        Value::Bool(flag) => Some(json!(flag)),
        Value::Number(number) => Some(Value::Number(number.clone())),
        Value::String(text) => Some(json!(sanitize_ai_event_text(text, 240))),
        Value::Array(items) => {
            let values = items
                .iter()
                .take(12)
                .filter_map(sanitize_ai_event_payload_value)
                .filter(|item| {
                    item.is_null() || item.is_boolean() || item.is_number() || item.is_string()
                })
                .collect::<Vec<_>>();
            Some(Value::Array(values))
        }
        Value::Object(_) => None,
    }
}

fn sanitize_ai_event_payload(payload: Option<&Value>) -> Option<Value> {
    let payload = payload?.as_object()?;
    let kind = sanitize_ai_event_text(payload.get("kind")?.as_str()?, 80);
    if kind.is_empty() {
        return None;
    }

    let mut data = serde_json::Map::new();
    if let Some(raw_data) = payload.get("data").and_then(Value::as_object) {
        for (key, value) in raw_data.iter().take(16) {
            let safe_key = sanitize_ai_event_text(key, 64);
            if safe_key.is_empty() {
                continue;
            }
            if let Some(safe_value) = sanitize_ai_event_payload_value(value) {
                data.insert(safe_key, safe_value);
            }
        }
    }

    let mut result = serde_json::Map::new();
    result.insert("kind".to_string(), json!(kind));
    if !data.is_empty() {
        result.insert("data".to_string(), Value::Object(data));
    }
    Some(Value::Object(result))
}

fn sanitize_ai_intermediate_event(envelope: &Value, fallback_operation_id: &str) -> Option<Value> {
    if envelope.get("method").and_then(Value::as_str) != Some("ai.intermediateEvent") {
        return None;
    }

    let params = envelope.get("params")?.as_object()?;
    if params.get("schema").and_then(Value::as_str) != Some("fluxora.ai.intermediate-event.v1") {
        return None;
    }

    let event_id = sanitize_ai_event_text(params.get("eventId")?.as_str()?, 96);
    let run_id = sanitize_ai_event_text(params.get("runId")?.as_str()?, 96);
    let operation_id = sanitize_ai_event_text(
        params
            .get("operationId")
            .and_then(Value::as_str)
            .unwrap_or(fallback_operation_id),
        128,
    );
    let seq = params.get("seq")?.as_u64()?;
    let event_type = params.get("type")?.as_str()?;
    let level = params.get("level")?.as_str()?;
    let visibility = params.get("visibility")?.as_str()?;
    if event_id.is_empty()
        || run_id.is_empty()
        || operation_id.is_empty()
        || !supported_ai_event_type(event_type)
        || !supported_ai_event_level(level)
        || !supported_ai_event_visibility(visibility)
    {
        return None;
    }

    let stage = sanitize_ai_event_text(params.get("stage")?.as_str()?, 96);
    let message = sanitize_ai_event_text(params.get("message")?.as_str()?, 320);
    if stage.is_empty() || message.is_empty() {
        return None;
    }

    let mut event = serde_json::Map::new();
    event.insert(
        "schema".to_string(),
        json!("fluxora.ai.intermediate-event.v1"),
    );
    event.insert("eventId".to_string(), json!(event_id));
    event.insert("runId".to_string(), json!(run_id));
    event.insert("operationId".to_string(), json!(operation_id));
    event.insert("seq".to_string(), json!(seq));
    event.insert(
        "createdAt".to_string(),
        json!(sanitize_ai_event_text(
            params.get("createdAt")?.as_str()?,
            64
        )),
    );
    event.insert("type".to_string(), json!(event_type));
    event.insert("level".to_string(), json!(level));
    event.insert("visibility".to_string(), json!(visibility));
    event.insert("stage".to_string(), json!(stage));
    event.insert("message".to_string(), json!(message));
    if let Some(percent) = params.get("percent").and_then(Value::as_f64) {
        event.insert("percent".to_string(), json!(percent.clamp(0.0, 100.0)));
    }
    if let Some(payload) = sanitize_ai_event_payload(params.get("payload")) {
        event.insert("payload".to_string(), payload);
    }

    Some(Value::Object(event))
}

fn safe_external_url(url: &str) -> Result<String, &'static str> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return Err("invalid-url");
    }

    let parsed = Url::parse(trimmed).map_err(|_| "invalid-url")?;
    if parsed.scheme() != "https" && parsed.scheme() != "mailto" {
        return Err("unsupported-protocol");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("embedded-credentials");
    }

    Ok(parsed.to_string())
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
        push_unique_candidate(&mut candidates, PathBuf::from(path));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        push_unique_candidate(
            &mut candidates,
            resource_dir.join("native").join(executable),
        );
        push_packaged_native_candidate(&mut candidates, &resource_dir, executable);
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(executable_dir) = current_exe.parent() {
            push_packaged_native_candidate(&mut candidates, executable_dir, executable);
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        push_packaged_native_candidate(&mut candidates, &current_dir, executable);
        for root in [
            current_dir.as_path(),
            current_dir.parent().unwrap_or(current_dir.as_path()),
            current_dir
                .parent()
                .and_then(Path::parent)
                .unwrap_or(current_dir.as_path()),
        ] {
            let backend_dir = root.join("build").join("backend");
            for configuration in ["Release", "RelWithDebInfo", "Debug", "MinSizeRel"] {
                push_unique_candidate(
                    &mut candidates,
                    backend_dir.join(configuration).join(executable),
                );
            }
            push_unique_candidate(&mut candidates, backend_dir.join(executable));
        }
    }

    candidates
}

fn push_unique_candidate(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
}

fn push_packaged_native_candidate(candidates: &mut Vec<PathBuf>, root: &Path, executable: &str) {
    push_unique_candidate(
        candidates,
        root.join("resources").join("native").join(executable),
    );
    push_unique_candidate(candidates, root.join("native").join(executable));
}

async fn resolve_host_path(app: &AppHandle) -> Result<PathBuf, String> {
    for candidate in candidate_host_paths(app) {
        if tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return Ok(candidate);
        }
    }

    Err("FluxoraBridgeHost was not found. Build backend target FluxoraBridgeHost or set FLUXORA_BRIDGE_HOST_PATH.".to_string())
}

fn ai_host_executable_name() -> &'static str {
    if cfg!(windows) {
        "FluxoraAIHost.exe"
    } else {
        "FluxoraAIHost"
    }
}

fn ai_host_cargo_binary_name() -> &'static str {
    if cfg!(windows) {
        "fluxora-ai-host.exe"
    } else {
        "fluxora-ai-host"
    }
}

fn push_tauri_ai_host_candidates(candidates: &mut Vec<PathBuf>, root: &Path) {
    for profile in ["release", "debug"] {
        push_unique_candidate(
            candidates,
            root.join("frontend-tauri")
                .join("src-tauri")
                .join("target")
                .join(profile)
                .join(ai_host_cargo_binary_name()),
        );
        push_unique_candidate(
            candidates,
            root.join("src-tauri")
                .join("target")
                .join(profile)
                .join(ai_host_cargo_binary_name()),
        );
        push_unique_candidate(
            candidates,
            root.join("target")
                .join(profile)
                .join(ai_host_cargo_binary_name()),
        );
    }
}

fn candidate_ai_host_paths(app: &AppHandle) -> Vec<PathBuf> {
    let executable = ai_host_executable_name();
    let mut candidates = Vec::new();

    if let Some(path) = std::env::var_os("FLUXORA_AI_HOST_PATH") {
        push_unique_candidate(&mut candidates, PathBuf::from(path));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        push_unique_candidate(
            &mut candidates,
            resource_dir.join("native").join(executable),
        );
        push_packaged_native_candidate(&mut candidates, &resource_dir, executable);
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(executable_dir) = current_exe.parent() {
            push_packaged_native_candidate(&mut candidates, executable_dir, executable);
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        push_packaged_native_candidate(&mut candidates, &current_dir, executable);
        let roots = [
            current_dir.clone(),
            current_dir
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| current_dir.clone()),
            current_dir
                .parent()
                .and_then(Path::parent)
                .map(Path::to_path_buf)
                .unwrap_or_else(|| current_dir.clone()),
        ];

        for root in roots {
            push_tauri_ai_host_candidates(&mut candidates, &root);
        }
    }

    candidates
}

async fn resolve_ai_host_path(app: &AppHandle) -> Result<PathBuf, String> {
    for candidate in candidate_ai_host_paths(app) {
        if tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return Ok(candidate);
        }
    }

    Err(
        "FluxoraAIHost was not found. Build the Tauri ai host target or set FLUXORA_AI_HOST_PATH."
            .to_string(),
    )
}

impl BridgeProcess {
    async fn reset(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
        self.stdin = None;
        self.stdout = None;
        self.handshake = None;
    }

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
            .env("FLUXORA_OPERATION_CANCEL_DIR", &cancel_dir)
            .env("FLUXORA_TAURI_PROCESS_ID", std::process::id().to_string());

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

        let host_path_for_log = host_path.to_string_lossy().to_string();
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
                "Started FluxoraBridgeHost with hostPath={} FLUXORA_LOG_DIR={}",
                host_path_for_log,
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
            if let Err(error) = validate_negotiated_protocol(
                &handshake,
                BRIDGE_PROTOCOL_VERSION,
                "FluxoraBridgeHost",
            ) {
                self.reset().await;
                return Err(error);
            }
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
        let started_at = now_millis();
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

        let _ = write_log(
            app,
            "main-bridge",
            "info",
            "BridgeRequest",
            &format!(
                "Request started. method={} timeoutMs={}",
                sanitize_log(method),
                timeout_ms
            ),
            Some(&operation_id),
        )
        .await;

        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "Bridge host stdin is unavailable.".to_string())?;
        if let Err(error) = stdin.write_all(format!("{}\n", payload).as_bytes()).await {
            self.reset().await;
            return Err(error.to_string());
        }
        if let Err(error) = stdin.flush().await {
            self.reset().await;
            return Err(error.to_string());
        }

        loop {
            let mut line = String::new();
            let read_result = {
                let stdout = self
                    .stdout
                    .as_mut()
                    .ok_or_else(|| "Bridge host stdout is unavailable.".to_string())?;
                timeout(
                    Duration::from_millis(timeout_ms),
                    stdout.read_line(&mut line),
                )
                .await
            };
            let bytes = match read_result {
                Ok(Ok(bytes)) => bytes,
                Ok(Err(error)) => {
                    self.reset().await;
                    return Err(error.to_string());
                }
                Err(_) => {
                    let message = format!("Bridge request timed out: {}", method);
                    let _ = write_log(
                        app,
                        "main-bridge",
                        "error",
                        "BridgeRequest",
                        &format!(
                            "{}. Host process will be restarted for the next request.",
                            message
                        ),
                        Some(&operation_id),
                    )
                    .await;
                    self.reset().await;
                    return Err(message);
                }
            };
            if bytes == 0 {
                self.reset().await;
                return Err("Bridge host exited before replying.".to_string());
            }

            let envelope: Value = match serde_json::from_str(line.trim()) {
                Ok(envelope) => envelope,
                Err(error) => {
                    let _ = write_log(
                        app,
                        "main-bridge",
                        "warning",
                        "BridgeRequest",
                        &format!(
                            "Ignored non-JSON bridge stdout while waiting for method={}: {}",
                            sanitize_log(method),
                            sanitize_log(&error.to_string())
                        ),
                        Some(&operation_id),
                    )
                    .await;
                    continue;
                }
            };
            if envelope.get("id").and_then(Value::as_str) != Some(request_id.as_str()) {
                if envelope.get("method").and_then(Value::as_str) == Some("operations.progress") {
                    let payload = operation_progress_payload(&envelope);
                    record_operation_progress(app, &payload).await;
                    let _ = app.emit(PROGRESS_EVENT, payload);
                }
                continue;
            }

            if let Some(error) = envelope.get("error") {
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Native bridge request failed.")
                    .to_string();
                let _ = write_log(
                    app,
                    "main-bridge",
                    "error",
                    "BridgeRequest",
                    &format!(
                        "Request failed. method={} durationMs={} error={}",
                        sanitize_log(method),
                        now_millis().saturating_sub(started_at),
                        sanitize_log(&message)
                    ),
                    Some(&operation_id),
                )
                .await;
                return Err(serialize_bridge_invoke_error(method, &operation_id, error));
            }

            let result = envelope
                .get("result")
                .ok_or_else(|| "Bridge response missing result.".to_string())?;
            if result.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err("Bridge response did not include an ok result.".to_string());
            }
            let _ = write_log(
                app,
                "main-bridge",
                "info",
                "BridgeRequest",
                &format!(
                    "Request completed. method={} durationMs={}",
                    sanitize_log(method),
                    now_millis().saturating_sub(started_at)
                ),
                Some(&operation_id),
            )
            .await;
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
        self.reset().await;
        Ok(())
    }
}

impl AiHostProcess {
    async fn reset(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
        self.active_process_id.store(0, Ordering::SeqCst);
        self.stdin = None;
        self.stdout = None;
        self.handshake = None;
    }

    async fn ensure_started(&mut self, app: &AppHandle) -> Result<(), String> {
        if self.child.is_some() && self.stdin.is_some() && self.stdout.is_some() {
            return Ok(());
        }

        let host_path = resolve_ai_host_path(app).await?;
        let ai_log_dir = logs_dir(app);
        tokio::fs::create_dir_all(&ai_log_dir)
            .await
            .map_err(|error| error.to_string())?;
        let mut command = Command::new(&host_path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("FLUXORA_AI_LOG_DIR", &ai_log_dir)
            .env("FLUXORA_TAURI_PROCESS_ID", std::process::id().to_string());

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let child_process_id = child.id().unwrap_or_default();

        if let Some(stderr) = child.stderr.take() {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or_default() > 0 {
                    let message = line.trim();
                    if !message.is_empty() {
                        let _ =
                            write_log(&app, "ai-host", "warning", "AiHost", message, None).await;
                    }
                    line.clear();
                }
            });
        }

        let host_path_for_log = host_path.to_string_lossy().to_string();
        self.stdin = child.stdin.take();
        self.stdout = child.stdout.take().map(BufReader::new);
        self.child = Some(child);
        self.host_path = Some(host_path);
        self.handshake = None;
        self.active_process_id
            .store(child_process_id, Ordering::SeqCst);

        let _ = write_log(
            app,
            "ai-host",
            "info",
            "AiHost",
            &format!("Started FluxoraAIHost with hostPath={}", host_path_for_log),
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
                    json!({ "supportedProtocolVersions": [AI_HOST_PROTOCOL_VERSION] }),
                    request.clone(),
                    timeout_ms,
                )
                .await?;
            if let Err(error) =
                validate_negotiated_protocol(&handshake, AI_HOST_PROTOCOL_VERSION, "FluxoraAIHost")
            {
                self.reset().await;
                return Err(error);
            }
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
        let request_id = format!("ai_req_{}_{}", now_millis(), method.replace('.', "_"));
        let operation_id = operation_id(Some(&request), method);
        let started_at = now_millis();
        let payload = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
            "meta": {
                "protocolVersion": AI_HOST_PROTOCOL_VERSION,
                "operationId": operation_id,
                "requestSource": "tauri-shell",
                "appVersion": "0.0.0",
                "platform": platform_name(),
                "arch": arch_name(),
                "locale": "ru-RU"
            }
        });

        let _ = write_log(
            app,
            "ai-host",
            "info",
            "AiHostRequest",
            &format!(
                "Request started. method={} timeoutMs={}",
                sanitize_log(method),
                timeout_ms
            ),
            Some(&operation_id),
        )
        .await;

        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "AI host stdin is unavailable.".to_string())?;
        if let Err(error) = stdin.write_all(format!("{}\n", payload).as_bytes()).await {
            self.reset().await;
            return Err(error.to_string());
        }
        if let Err(error) = stdin.flush().await {
            self.reset().await;
            return Err(error.to_string());
        }

        loop {
            let mut line = String::new();
            let read_result = {
                let stdout = self
                    .stdout
                    .as_mut()
                    .ok_or_else(|| "AI host stdout is unavailable.".to_string())?;
                timeout(
                    Duration::from_millis(timeout_ms),
                    stdout.read_line(&mut line),
                )
                .await
            };
            let bytes = match read_result {
                Ok(Ok(bytes)) => bytes,
                Ok(Err(error)) => {
                    self.reset().await;
                    return Err(error.to_string());
                }
                Err(_) => {
                    let message = format!("AI host request timed out: {}", method);
                    let _ = write_log(
                        app,
                        "ai-host",
                        "error",
                        "AiHostRequest",
                        &format!(
                            "{}. Host process will be restarted for the next request.",
                            message
                        ),
                        Some(&operation_id),
                    )
                    .await;
                    self.reset().await;
                    return Err(message);
                }
            };
            if bytes == 0 {
                self.reset().await;
                return Err("AI host exited before replying.".to_string());
            }

            let envelope: Value = match serde_json::from_str(line.trim()) {
                Ok(envelope) => envelope,
                Err(error) => {
                    let _ = write_log(
                        app,
                        "ai-host",
                        "warning",
                        "AiHostRequest",
                        &format!(
                            "Ignored non-JSON AI host stdout while waiting for method={}: {}",
                            sanitize_log(method),
                            sanitize_log(&error.to_string())
                        ),
                        Some(&operation_id),
                    )
                    .await;
                    continue;
                }
            };
            if envelope.get("method").and_then(Value::as_str) == Some("ai.intermediateEvent") {
                if let Some(event) = sanitize_ai_intermediate_event(&envelope, &operation_id) {
                    let event_operation_id = event
                        .get("operationId")
                        .and_then(Value::as_str)
                        .unwrap_or(&operation_id)
                        .to_string();
                    let event_level = event
                        .get("level")
                        .and_then(Value::as_str)
                        .unwrap_or("info")
                        .to_string();
                    let event_type = event
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("progress");
                    let event_stage = event
                        .get("stage")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    let event_message = event
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let _ = write_log(
                        app,
                        "ai-host",
                        &event_level,
                        "AiRunEvent",
                        &format!(
                            "Event received. type={} stage={} message={}",
                            sanitize_log(event_type),
                            sanitize_log(event_stage),
                            sanitize_log(event_message)
                        ),
                        Some(&event_operation_id),
                    )
                    .await;
                    let _ = app.emit(AI_RUN_EVENT, event);
                }
                continue;
            }
            if envelope.get("id").and_then(Value::as_str) != Some(request_id.as_str()) {
                continue;
            }

            if let Some(error) = envelope.get("error") {
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("AI host request failed.")
                    .to_string();
                let _ = write_log(
                    app,
                    "ai-host",
                    "error",
                    "AiHostRequest",
                    &format!(
                        "Request failed. method={} durationMs={} error={}",
                        sanitize_log(method),
                        now_millis().saturating_sub(started_at),
                        sanitize_log(&message)
                    ),
                    Some(&operation_id),
                )
                .await;
                return Err(message);
            }

            let result = envelope
                .get("result")
                .ok_or_else(|| "AI host response missing result.".to_string())?;
            if result.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err("AI host response did not include an ok result.".to_string());
            }
            let _ = write_log(
                app,
                "ai-host",
                "info",
                "AiHostRequest",
                &format!(
                    "Request completed. method={} durationMs={}",
                    sanitize_log(method),
                    now_millis().saturating_sub(started_at)
                ),
                Some(&operation_id),
            )
            .await;
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
                AI_HOST_TIMEOUT_MS,
            )
            .await;
        self.reset().await;
        Ok(())
    }
}

fn bridge_state(app: &AppHandle) -> tauri::State<'_, BridgeState> {
    app.state::<BridgeState>()
}

fn ai_host_state(app: &AppHandle) -> tauri::State<'_, AiHostState> {
    app.state::<AiHostState>()
}

fn normalized_ai_provider_id(value: &str) -> Option<String> {
    let provider_id = value.trim().to_ascii_lowercase();
    if provider_id.is_empty()
        || !provider_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return None;
    }
    Some(provider_id)
}

fn ai_credential_entry(provider_id: &str) -> Result<Entry, String> {
    Entry::new(AI_CREDENTIAL_SERVICE, provider_id)
        .map_err(|_| "OS credential store is unavailable.".to_string())
}

fn ai_credential_available(provider_id: &str) -> bool {
    ai_credential_entry(provider_id)
        .and_then(|entry| entry.get_password().map_err(|_| "missing".to_string()))
        .map(|secret| !secret.trim().is_empty())
        .unwrap_or(false)
}

fn with_ai_provider_connection_state(mut providers: Value) -> Value {
    if let Value::Array(items) = &mut providers {
        for provider in items {
            let Value::Object(fields) = provider else {
                continue;
            };

            let provider_id = fields.get("id").and_then(Value::as_str).map(str::to_string);
            let requires_credential = fields
                .get("requiresCredential")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let host_connected = fields
                .get("connected")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let local_connected = if requires_credential && !host_connected {
                provider_id
                    .as_deref()
                    .map(ai_credential_available)
                    .unwrap_or(false)
            } else {
                false
            };
            let connected = if requires_credential {
                host_connected || local_connected
            } else {
                true
            };
            let credential_state = if requires_credential {
                if connected {
                    "connected"
                } else {
                    "disconnected"
                }
            } else {
                "notRequired"
            };

            fields.insert("connected".to_string(), json!(connected));
            fields.insert("credentialState".to_string(), json!(credential_state));
        }
    }

    providers
}

fn ai_connection_result(
    provider_id: &str,
    connected: bool,
    state: &str,
    message: &str,
    operation_id: &str,
) -> Value {
    json!({
        "providerId": provider_id,
        "connected": connected,
        "state": state,
        "message": message,
        "operationId": operation_id
    })
}

fn ai_context_usage_level(percent: f64) -> &'static str {
    if percent >= 97.0 {
        "almost-full"
    } else if percent >= 92.0 {
        "critical"
    } else if percent >= 80.0 {
        "warning"
    } else if percent >= 60.0 {
        "moderate"
    } else {
        "normal"
    }
}

fn ai_context_usage_mode(percent: f64) -> &'static str {
    if percent >= 95.0 {
        "strict"
    } else if percent >= 85.0 {
        "compressed"
    } else if percent >= 70.0 {
        "smart"
    } else {
        "full"
    }
}

fn ai_request_context_window_tokens(request: &Value) -> u64 {
    match request.get("modelId").and_then(Value::as_str) {
        Some("local-dry-run") | None => 8_192,
        _ => 1_000_000,
    }
}

fn ai_request_estimated_context_tokens(request: &Value) -> u64 {
    let chars = request
        .get("messages")
        .and_then(Value::as_array)
        .map(|messages| {
            messages
                .iter()
                .filter_map(|message| message.get("text").and_then(Value::as_str))
                .map(|text| text.chars().count() as u64)
                .sum::<u64>()
        })
        .unwrap_or_default();

    std::cmp::max(1, chars.div_ceil(4))
}

fn ai_context_usage_fallback(request: &Value, operation_id: &str) -> Value {
    let context_window_tokens = ai_request_context_window_tokens(request);
    let current_context_tokens = ai_request_estimated_context_tokens(request);
    let percent =
        ((current_context_tokens as f64 / context_window_tokens as f64) * 100.0).min(100.0);

    json!({
        "schema": "fluxora.ai.context-usage.v1",
        "operationId": operation_id,
        "providerId": request.get("providerId").and_then(Value::as_str).unwrap_or("local-dry-run"),
        "modelId": request.get("modelId").and_then(Value::as_str).unwrap_or("local-dry-run"),
        "contextWindowTokens": context_window_tokens,
        "currentContextTokens": current_context_tokens,
        "currentContextPercent": percent,
        "precision": "estimated",
        "level": ai_context_usage_level(percent),
        "mode": ai_context_usage_mode(percent),
        "includedSections": ["messages", "tauri-shell-fallback"],
        "autoCompressionApplied": false,
        "actionRequired": percent >= 97.0,
        "countedAt": now_millis().to_string()
    })
}

async fn ai_status_payload(app: &AppHandle, request: OperationRequest) -> Value {
    let operation_id = operation_id(Some(&request), "ai_status");
    let state = ai_host_state(app);
    let mut host = state.process.lock().await;
    let health = host
        .request(
            app,
            "system.health",
            json!({}),
            request.clone(),
            AI_HOST_TIMEOUT_MS,
        )
        .await;

    match health {
        Ok(health) => {
            let providers = with_ai_provider_connection_state(
                health
                    .get("providers")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
            );
            let models = health.get("models").cloned().unwrap_or_else(|| json!([]));
            let handshake = host.handshake.clone().unwrap_or_default();
            json!({
                "ready": true,
                "operationId": operation_id,
                "health": "ready",
                "protocolVersion": handshake.get("protocolVersion").cloned().unwrap_or(json!(AI_HOST_PROTOCOL_VERSION)),
                "hostVersion": handshake.get("hostVersion").cloned().unwrap_or(json!("0.0.0-dev")),
                "hostPath": host.host_path.as_ref().map(|path| path.to_string_lossy().to_string()),
                "processId": health.get("processId").cloned().unwrap_or(Value::Null),
                "providers": providers,
                "models": models,
                "capabilities": health.get("capabilities").cloned().unwrap_or_else(|| json!({}))
            })
        }
        Err(error) => {
            let safe_error = sanitize_log(&error);
            let _ = write_log(
                app,
                "ai-host",
                "warning",
                "AiHostStatus",
                &format!("AI host unavailable. reason={}", safe_error),
                Some(&operation_id),
            )
            .await;
            json!({
                "ready": false,
                "operationId": operation_id,
                "health": "unavailable",
                "providers": [],
                "models": [],
                "capabilities": {},
                "error": {
                    "code": "ai.host.unavailable",
                    "message": "AI host is unavailable.",
                    "category": "transport",
                    "retryable": true,
                    "capabilityId": Value::Null,
                    "details": {
                        "reason": safe_error
                    }
                }
            })
        }
    }
}

async fn ai_provider_known(
    app: &AppHandle,
    provider_id: &str,
    request: OperationRequest,
) -> Result<bool, String> {
    let state = ai_host_state(app);
    let mut host = state.process.lock().await;
    let data = host
        .request(
            app,
            "providers.list",
            json!({}),
            request,
            AI_HOST_TIMEOUT_MS,
        )
        .await?;
    Ok(data
        .get("providers")
        .and_then(Value::as_array)
        .map(|providers| {
            providers
                .iter()
                .any(|provider| provider.get("id").and_then(Value::as_str) == Some(provider_id))
        })
        .unwrap_or(false))
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
fn fluxora_runtime_paths(_app: AppHandle) -> RuntimePaths {
    let root = fluxora_data_dir();
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
        "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
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
async fn fluxora_ai_get_status(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "ai_status")),
    });
    Ok(ai_status_payload(&app, request).await)
}

#[tauri::command]
async fn fluxora_ai_restart_host(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "ai_restart_host")),
    });

    {
        let state = ai_host_state(&app);
        let mut host = state.process.lock().await;
        host.shutdown(&app, request.clone()).await?;
        host.reset().await;
    }

    Ok(ai_status_payload(&app, request).await)
}

#[tauri::command]
async fn fluxora_ai_cancel_run(
    app: AppHandle,
    operation_id: String,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let target_operation_id = operation_id.trim().to_string();
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(crate::operation_id(None, "ai_cancel_run")),
    });
    let cancel_operation_id = crate::operation_id(Some(&request), "ai_cancel_run");
    if target_operation_id.is_empty() {
        return Ok(json!({
            "operationId": "",
            "status": "notFound",
            "accepted": false,
            "processId": Value::Null
        }));
    }

    let state = ai_host_state(&app);
    let process_id = state.active_process_id.load(Ordering::SeqCst);
    let accepted = process_id != 0 && process_platform::terminate_process(process_id);
    if accepted {
        state.active_process_id.store(0, Ordering::SeqCst);
    }

    let _ = write_log(
        &app,
        "ai-host",
        if accepted { "warning" } else { "info" },
        "AiChatCancel",
        &format!(
            "AI run cancel requested. targetOperationId={} processId={} accepted={}",
            sanitize_log(&target_operation_id),
            process_id,
            accepted
        ),
        Some(&cancel_operation_id),
    )
    .await;

    Ok(json!({
        "operationId": target_operation_id,
        "status": if accepted { "accepted" } else { "notFound" },
        "accepted": accepted,
        "processId": if process_id == 0 { Value::Null } else { json!(process_id) }
    }))
}

#[tauri::command]
async fn fluxora_ai_list_providers(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "ai_list_providers")),
    });
    let status = ai_status_payload(&app, request).await;
    Ok(status
        .get("providers")
        .cloned()
        .unwrap_or_else(|| json!([])))
}

#[tauri::command]
async fn fluxora_ai_list_models(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "ai_list_models")),
    });
    let status = ai_status_payload(&app, request).await;
    Ok(status.get("models").cloned().unwrap_or_else(|| json!([])))
}

#[tauri::command]
async fn fluxora_ai_connect_provider(
    app: AppHandle,
    provider_id: String,
    api_key: String,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "ai_provider_connect")),
    });
    let operation_id = operation_id(Some(&request), "ai_provider_connect");
    let Some(provider_id) = normalized_ai_provider_id(&provider_id) else {
        return Ok(ai_connection_result(
            "",
            false,
            "invalidProvider",
            "AI provider id is invalid.",
            &operation_id,
        ));
    };
    let secret = api_key.trim();
    if secret.is_empty() {
        return Ok(ai_connection_result(
            &provider_id,
            false,
            "invalidCredential",
            "Provider credential is empty.",
            &operation_id,
        ));
    }

    match ai_provider_known(&app, &provider_id, request.clone()).await {
        Ok(true) => {}
        Ok(false) => {
            return Ok(ai_connection_result(
                &provider_id,
                false,
                "unknownProvider",
                "AI provider is not in the host registry.",
                &operation_id,
            ));
        }
        Err(error) => {
            let _ = write_log(
                &app,
                "ai-host",
                "warning",
                "AiCredential",
                &format!(
                    "Provider connect failed closed before storing credential. providerId={} reason={}",
                    sanitize_log(&provider_id),
                    sanitize_log(&error)
                ),
                Some(&operation_id),
            )
            .await;
            return Ok(ai_connection_result(
                &provider_id,
                false,
                "hostUnavailable",
                "AI host is unavailable.",
                &operation_id,
            ));
        }
    }

    let entry = match ai_credential_entry(&provider_id) {
        Ok(entry) => entry,
        Err(message) => {
            return Ok(ai_connection_result(
                &provider_id,
                false,
                "credentialStoreUnavailable",
                &message,
                &operation_id,
            ));
        }
    };
    if entry.set_password(secret).is_err() {
        return Ok(ai_connection_result(
            &provider_id,
            false,
            "credentialStoreUnavailable",
            "Provider credential could not be stored.",
            &operation_id,
        ));
    }

    let _ = write_log(
        &app,
        "ai-host",
        "info",
        "AiCredential",
        &format!(
            "Provider credential stored in OS credential manager. providerId={}",
            sanitize_log(&provider_id)
        ),
        Some(&operation_id),
    )
    .await;

    Ok(ai_connection_result(
        &provider_id,
        true,
        "connected",
        "Provider credential is connected.",
        &operation_id,
    ))
}

#[tauri::command]
async fn fluxora_ai_disconnect_provider(
    app: AppHandle,
    provider_id: String,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "ai_provider_disconnect")),
    });
    let operation_id = operation_id(Some(&request), "ai_provider_disconnect");
    let Some(provider_id) = normalized_ai_provider_id(&provider_id) else {
        return Ok(ai_connection_result(
            "",
            false,
            "invalidProvider",
            "AI provider id is invalid.",
            &operation_id,
        ));
    };

    let state = match ai_credential_entry(&provider_id) {
        Ok(entry) => {
            let _ = entry.delete_credential();
            "disconnected"
        }
        Err(_) => "credentialStoreUnavailable",
    };

    let _ = write_log(
        &app,
        "ai-host",
        "info",
        "AiCredential",
        &format!(
            "Provider credential disconnected. providerId={} state={}",
            sanitize_log(&provider_id),
            state
        ),
        Some(&operation_id),
    )
    .await;

    Ok(ai_connection_result(
        &provider_id,
        false,
        state,
        if state == "disconnected" {
            "Provider credential is disconnected."
        } else {
            "Provider credential store is unavailable."
        },
        &operation_id,
    ))
}

#[tauri::command]
async fn fluxora_ai_test_provider(
    app: AppHandle,
    provider_id: String,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "ai_provider_test")),
    });
    let operation_id = operation_id(Some(&request), "ai_provider_test");
    let Some(provider_id) = normalized_ai_provider_id(&provider_id) else {
        return Ok(json!({
            "providerId": "",
            "ok": false,
            "state": "invalidProvider",
            "message": "AI provider id is invalid.",
            "operationId": operation_id,
            "hostRoundTrip": false,
            "checkedAt": now_millis(),
            "modelIds": []
        }));
    };
    let credential_available = ai_credential_available(&provider_id);
    let state = ai_host_state(&app);
    let mut host = state.process.lock().await;
    let result = host
        .request(
            &app,
            "providers.test",
            json!({
                "providerId": provider_id,
                "credentialAvailable": credential_available
            }),
            request,
            AI_HOST_TIMEOUT_MS,
        )
        .await;

    match result {
        Ok(mut data) => {
            if let Value::Object(fields) = &mut data {
                fields.insert("operationId".to_string(), json!(operation_id));
                fields.insert("hostRoundTrip".to_string(), json!(true));
            }
            Ok(data)
        }
        Err(error) => {
            let _ = write_log(
                &app,
                "ai-host",
                "warning",
                "AiProviderTest",
                &format!(
                    "Provider test failed closed. providerId={} reason={}",
                    sanitize_log(&provider_id),
                    sanitize_log(&error)
                ),
                Some(&operation_id),
            )
            .await;
            Ok(json!({
                "providerId": provider_id,
                "ok": false,
                "state": "hostUnavailable",
                "message": "AI host is unavailable.",
                "operationId": operation_id,
                "hostRoundTrip": false,
                "checkedAt": now_millis(),
                "modelIds": []
            }))
        }
    }
}

#[tauri::command]
async fn fluxora_ai_estimate_context(app: AppHandle, request: Value) -> Result<Value, String> {
    let operation_id = request
        .get("operationId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| operation_id(None, "ai_context_estimate"));
    let operation_request = OperationRequest {
        operation_id: Some(operation_id.clone()),
    };
    let state = ai_host_state(&app);
    let mut host = state.process.lock().await;
    let result = host
        .request(
            &app,
            "chat.estimateContext",
            request.clone(),
            operation_request,
            AI_HOST_TIMEOUT_MS,
        )
        .await;

    match result {
        Ok(mut data) => {
            if let Value::Object(fields) = &mut data {
                fields.insert("operationId".to_string(), json!(operation_id.clone()));
            }
            let _ = write_log(
                &app,
                "ai-host",
                "info",
                "AiContextEstimate",
                "AI context estimate completed.",
                Some(&operation_id),
            )
            .await;
            Ok(data)
        }
        Err(error) => {
            let safe_error = sanitize_log(&error);
            let _ = write_log(
                &app,
                "ai-host",
                "warning",
                "AiContextEstimate",
                &format!(
                    "AI context estimate used local fallback. reason={}",
                    safe_error
                ),
                Some(&operation_id),
            )
            .await;
            Ok(ai_context_usage_fallback(&request, &operation_id))
        }
    }
}

fn remove_private_nexus_credential(request: &mut Value) {
    if let Value::Object(fields) = request {
        fields.remove(PRIVATE_AI_NEXUS_CREDENTIAL_FIELD);
    }
}

fn nexus_api_auth_header_from_bridge_payload(payload: &Value) -> Option<Value> {
    if payload.get("isAvailable").and_then(Value::as_bool) != Some(true) {
        return None;
    }

    let header_name = payload
        .get("headerName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| matches!(*value, "apikey" | "Authorization"))?;
    let header_value = payload
        .get("headerValue")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let credential_kind = payload
        .get("credentialKind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("linked-account");

    if header_name
        .chars()
        .any(|character| matches!(character, '\r' | '\n'))
        || header_value
            .chars()
            .any(|character| matches!(character, '\r' | '\n'))
    {
        return None;
    }

    Some(json!({
        "headerName": header_name,
        "headerValue": header_value,
        "credentialKind": credential_kind,
        "source": "linked-account"
    }))
}

async fn trusted_nexus_api_credential_for_ai(app: &AppHandle, operation_id: &str) -> Option<Value> {
    let state = bridge_state(app);
    let mut bridge = state.process.lock().await;
    let payload = bridge
        .request(
            app,
            PRIVATE_NEXUS_API_AUTH_HEADER_METHOD,
            json!({}),
            OperationRequest {
                operation_id: Some(operation_id.to_string()),
            },
            BRIDGE_TIMEOUT_MS,
        )
        .await
        .ok()?;

    nexus_api_auth_header_from_bridge_payload(&payload)
}

async fn enrich_ai_request_with_private_nexus_credential(
    app: &AppHandle,
    request: &mut Value,
    operation_id: &str,
) {
    remove_private_nexus_credential(request);
    let Some(credential) = trusted_nexus_api_credential_for_ai(app, operation_id).await else {
        return;
    };

    if let Value::Object(fields) = request {
        fields.insert(PRIVATE_AI_NEXUS_CREDENTIAL_FIELD.to_string(), credential);
    }
}

#[tauri::command]
async fn fluxora_ai_chat_respond(app: AppHandle, request: Value) -> Result<Value, String> {
    let mut request = request;
    let operation_id = request
        .get("operationId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| operation_id(None, "ai_chat_run"));
    let operation_request = OperationRequest {
        operation_id: Some(operation_id.clone()),
    };
    enrich_ai_request_with_private_nexus_credential(&app, &mut request, &operation_id).await;
    let state = ai_host_state(&app);
    let mut host = state.process.lock().await;
    let result = host
        .request(
            &app,
            "chat.respond",
            request,
            operation_request,
            AI_HOST_LONG_RUNNING_TIMEOUT_MS,
        )
        .await;

    match result {
        Ok(mut data) => {
            if let Value::Object(fields) = &mut data {
                fields.insert("operationId".to_string(), json!(operation_id.clone()));
            }
            let _ = write_log(
                &app,
                "ai-host",
                "info",
                "AiChat",
                "Chat-only AI response completed.",
                Some(&operation_id),
            )
            .await;
            Ok(data)
        }
        Err(error) => {
            let safe_error = sanitize_log(&error);
            let _ = write_log(
                &app,
                "ai-host",
                "warning",
                "AiChat",
                &format!("Chat-only AI response failed closed. reason={}", safe_error),
                Some(&operation_id),
            )
            .await;
            Ok(json!({
                "operationId": operation_id,
                "providerId": "local-dry-run",
                "modelId": "local-dry-run",
                "routingPreset": "free-demo",
                "status": "blocked",
                "text": "AI host is unavailable. Chat-only mode cannot answer until the host is ready.",
                "streamChunks": [
                    { "index": 0, "text": "AI host is unavailable. Chat-only mode cannot answer until the host is ready." }
                ],
                "sources": [],
                "costEstimate": {
                    "currency": "USD",
                    "estimatedInputTokens": 0,
                    "estimatedOutputTokens": 0,
                    "estimatedCost": 0.0,
                    "actualCost": Value::Null,
                    "internalCost": 0.0,
                    "pricingSource": "host-unavailable",
                    "isEstimate": true
                },
                "ledgerEntry": {
                    "operationId": operation_id,
                    "providerId": "local-dry-run",
                    "modelId": "local-dry-run",
                    "routingPreset": "free-demo",
                    "estimatedInternalCost": 0.0,
                    "actualInternalCost": Value::Null,
                    "currency": "USD",
                    "billable": false,
                    "createdAt": now_millis().to_string()
                },
                "fallbackProviders": [],
                "toolCallsAllowed": false,
                "error": {
                    "code": "ai.host.unavailable",
                    "message": "AI host is unavailable.",
                    "category": "transport",
                    "retryable": true,
                    "capabilityId": Value::Null,
                    "details": {
                        "reason": safe_error
                    }
                }
            }))
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BridgeLane {
    Main,
    Interactive,
}

impl BridgeLane {
    fn label(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Interactive => "interactive",
        }
    }
}

fn bridge_lane_for_method(method: &str) -> BridgeLane {
    match method {
        "mods.getFileTree"
        | "mods.getModDetailsContent"
        | "mods.readTextFile"
        | "mods.startNifPreview"
        | "mods.prepareNifPreviewVariant"
        | "mods.prepareNifPreviewTextures"
        | "mods.listInstalled"
        | "downloads.analyzeFomod"
        | "downloads.analyzeContentLayout"
        | "downloads.analyzeFomodContentLayout"
        | "downloads.install"
        | "downloads.installFomod"
        | "archives.install"
        | "archives.installFomod"
        | "nexus.connect"
        | "textFiles.read" => BridgeLane::Interactive,
        _ => BridgeLane::Main,
    }
}

fn nif_preview_required_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("NIF preview response field {key} is missing."))
}

fn nif_preview_required_size(value: &Value, key: &str) -> Result<u64, String> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("NIF preview response field {key} is invalid."))
}

fn nif_preview_public_asset(asset_id: &str, prepared: &Value) -> Result<Value, String> {
    let size = nif_preview_required_size(prepared, "size")?;
    if size > NIF_PREVIEW_MAX_ASSET_BYTES {
        return Err("NIF preview asset exceeds the 64 MiB limit.".to_string());
    }

    Ok(json!({
        "assetId": asset_id,
        "size": size,
        "mimeType": nif_preview_required_string(prepared, "mimeType")?,
        "relativePath": nif_preview_required_string(prepared, "relativePath")?,
        "source": nif_preview_required_string(prepared, "source")?,
        "contentKey": nif_preview_required_string(prepared, "contentKey")?
    }))
}

fn nif_preview_asset_record(asset_id: String, prepared: &Value) -> Result<NifPreviewAssetRecord, String> {
    let public = nif_preview_public_asset(&asset_id, prepared)?;
    let resolved_path = PathBuf::from(nif_preview_required_string(prepared, "resolvedPath")?);
    if !resolved_path.is_absolute() {
        return Err("NIF preview core returned a non-absolute asset path.".to_string());
    }

    Ok(NifPreviewAssetRecord {
        asset_id,
        resolved_path,
        size: public["size"].as_u64().unwrap_or_default(),
        mime_type: public["mimeType"].as_str().unwrap_or_default().to_string(),
        relative_path: public["relativePath"].as_str().unwrap_or_default().to_string(),
        source: public["source"].as_str().unwrap_or_default().to_string(),
        content_key: public["contentKey"].as_str().unwrap_or_default().to_string(),
    })
}

fn next_nif_preview_token(
    state: &NifPreviewSessionState,
    prefix: &str,
    seed: &str,
) -> String {
    let sequence = state.sequence.fetch_add(1, Ordering::Relaxed);
    let digest = stable_label_suffix(&format!(
        "{}:{}:{}:{}",
        std::process::id(),
        now_millis(),
        sequence,
        seed
    ));
    format!("{prefix}_{digest}")
}

fn parse_nif_preview_variant(
    variant_id: String,
    value: &Value,
) -> Result<NifPreviewVariantRecord, String> {
    Ok(NifPreviewVariantRecord {
        variant_id,
        mod_path: nif_preview_required_string(value, "modPath")?,
        mod_name: nif_preview_required_string(value, "modName")?,
        order: value
            .get("order")
            .and_then(Value::as_i64)
            .ok_or_else(|| "NIF preview variant order is invalid.".to_string())?,
        enabled: value
            .get("enabled")
            .and_then(Value::as_bool)
            .ok_or_else(|| "NIF preview variant enabled state is invalid.".to_string())?,
        relative_path: nif_preview_required_string(value, "relativePath")?,
        size: nif_preview_required_size(value, "size")?,
    })
}

fn register_nif_preview_assets(
    state: &NifPreviewSessionState,
    session: &mut NifPreviewSession,
    prepared_assets: &[Value],
) -> Result<Vec<Value>, String> {
    let mut new_records = Vec::<NifPreviewAssetRecord>::new();
    let mut output_content_keys = Vec::<String>::with_capacity(prepared_assets.len());

    for prepared in prepared_assets {
        let content_key = nif_preview_required_string(prepared, "contentKey")?;
        output_content_keys.push(content_key.clone());
        if session
            .assets
            .values()
            .any(|asset| asset.content_key == content_key)
            || new_records
                .iter()
                .any(|asset| asset.content_key == content_key)
        {
            continue;
        }

        let asset_id = next_nif_preview_token(state, "nif_asset", &content_key);
        new_records.push(nif_preview_asset_record(asset_id, prepared)?);
    }

    let added_bytes = new_records
        .iter()
        .try_fold(0u64, |total, asset| total.checked_add(asset.size))
        .ok_or_else(|| "NIF preview session byte count overflowed.".to_string())?;
    if session.total_bytes > NIF_PREVIEW_MAX_SESSION_BYTES.saturating_sub(added_bytes) {
        return Err("NIF preview session exceeds the 256 MiB limit.".to_string());
    }

    session.total_bytes += added_bytes;
    for asset in new_records {
        session.assets.insert(asset.asset_id.clone(), asset);
    }

    output_content_keys
        .iter()
        .map(|content_key| {
            session
                .assets
                .values()
                .find(|asset| asset.content_key == *content_key)
                .map(NifPreviewAssetRecord::public_value)
                .ok_or_else(|| "NIF preview asset registration failed.".to_string())
        })
        .collect()
}

fn purge_expired_nif_preview_sessions(
    sessions: &mut HashMap<String, NifPreviewSession>,
    now: u128,
) -> usize {
    let previous_len = sessions.len();
    sessions.retain(|_, session| {
        now.saturating_sub(session.last_access_ms) < NIF_PREVIEW_IDLE_TIMEOUT_MS
    });
    previous_len.saturating_sub(sessions.len())
}

fn ensure_nif_preview_window(
    session: &NifPreviewSession,
    window_label: &str,
) -> Result<(), String> {
    if session.window_label != window_label {
        return Err("NIF preview session belongs to another window.".to_string());
    }
    Ok(())
}

fn bridge_queue_performance_message(method: &str, queue_wait_us: u128, lane: BridgeLane) -> String {
    format!(
        "bridgeQueue lane={} method={} queueWaitUs={}",
        lane.label(),
        method,
        queue_wait_us
    )
}

#[tauri::command]
async fn fluxora_bridge_request(
    app: AppHandle,
    method: String,
    params: Value,
    request: Option<OperationRequest>,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    if method == PRIVATE_NEXUS_API_AUTH_HEADER_METHOD {
        return Err("Unsupported bridge method.".to_string());
    }

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
    let lane = bridge_lane_for_method(&method);
    let queue_started_at = Instant::now();
    let timeout_ms = timeout_ms.unwrap_or(BRIDGE_TIMEOUT_MS);
    let (result, queue_wait_us) = match lane {
        BridgeLane::Main => {
            let mut bridge = state.process.lock().await;
            let queue_wait_us = queue_started_at.elapsed().as_micros();
            let result = bridge
                .request(&app, &method, params, request, timeout_ms)
                .await;
            (result, queue_wait_us)
        }
        BridgeLane::Interactive => {
            let mut bridge = state.interactive_process.lock().await;
            let queue_wait_us = queue_started_at.elapsed().as_micros();
            let result = bridge
                .request(&app, &method, params, request, timeout_ms)
                .await;
            (result, queue_wait_us)
        }
    };

    let log_app = app.clone();
    let log_method = method.clone();
    let log_operation_id = operation_id.clone();
    tauri::async_runtime::spawn(async move {
        let message = bridge_queue_performance_message(&log_method, queue_wait_us, lane);
        let _ = write_log(
            &log_app,
            "main-bridge",
            "info",
            "Performance",
            &message,
            Some(&log_operation_id),
        )
        .await;
    });
    result
}

#[tauri::command]
async fn fluxora_start_nif_preview(
    app: AppHandle,
    window: WebviewWindow,
    project_directory: String,
    profile_name: String,
    initial_mod_path: String,
    relative_path: String,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    if project_directory.trim().is_empty()
        || initial_mod_path.trim().is_empty()
        || relative_path.trim().is_empty()
    {
        return Err("Project directory, initial mod path and NIF path are required.".to_string());
    }

    let started_at = Instant::now();
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "nif_preview")),
    });
    let operation_id = operation_id(Some(&request), "nif_preview");
    let payload = fluxora_bridge_request(
        app.clone(),
        "mods.startNifPreview".to_string(),
        json!({
            "projectDirectory": project_directory,
            "profileName": profile_name,
            "initialModPath": initial_mod_path,
            "relativePath": relative_path
        }),
        Some(request),
        Some(BRIDGE_TIMEOUT_MS),
    )
    .await?;

    let state = app.state::<NifPreviewSessionState>();
    let variants_payload = payload
        .get("variants")
        .and_then(Value::as_array)
        .filter(|variants| !variants.is_empty())
        .ok_or_else(|| "NIF preview core returned no variants.".to_string())?;
    let active_index = payload
        .get("activeIndex")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .filter(|index| *index < variants_payload.len())
        .ok_or_else(|| "NIF preview core returned an invalid active variant.".to_string())?;

    let mut variants = Vec::with_capacity(variants_payload.len());
    for variant in variants_payload {
        let variant_seed = format!(
            "{}:{}",
            nif_preview_required_string(variant, "modPath")?,
            nif_preview_required_string(variant, "relativePath")?
        );
        let variant_id = next_nif_preview_token(&state, "nif_variant", &variant_seed);
        variants.push(parse_nif_preview_variant(variant_id, variant)?);
    }

    let model = payload
        .get("model")
        .ok_or_else(|| "NIF preview core returned no model handle.".to_string())?;
    let session_id = next_nif_preview_token(
        &state,
        "nif_session",
        &format!("{}:{}", project_directory, relative_path),
    );
    let mut session = NifPreviewSession {
        window_label: window.label().to_string(),
        project_directory,
        profile_name,
        operation_id: operation_id.clone(),
        variants,
        active_index,
        assets: HashMap::new(),
        total_bytes: 0,
        last_access_ms: now_millis(),
    };
    let model_handle = register_nif_preview_assets(&state, &mut session, std::slice::from_ref(model))?
        .into_iter()
        .next()
        .ok_or_else(|| "NIF preview model registration failed.".to_string())?;
    let public_variants = session
        .variants
        .iter()
        .map(NifPreviewVariantRecord::public_value)
        .collect::<Vec<_>>();

    {
        let mut sessions = state.sessions.lock().await;
        purge_expired_nif_preview_sessions(&mut sessions, now_millis());
        sessions.insert(session_id.clone(), session);
    }

    let _ = write_log(
        &app,
        "main-bridge",
        "info",
        "NifPreview",
        &format!(
            "sessionStarted sessionId={} variants={} prepareMs={}",
            sanitize_log(&session_id),
            public_variants.len(),
            started_at.elapsed().as_millis()
        ),
        Some(&operation_id),
    )
    .await;

    Ok(json!({
        "sessionId": session_id,
        "variants": public_variants,
        "activeIndex": active_index,
        "modelHandle": model_handle
    }))
}

#[tauri::command]
async fn fluxora_prepare_nif_preview_variant(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    variant_id: String,
) -> Result<Value, String> {
    let state = app.state::<NifPreviewSessionState>();
    let (project_directory, operation_id, variant, variant_index) = {
        let mut sessions = state.sessions.lock().await;
        purge_expired_nif_preview_sessions(&mut sessions, now_millis());
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| "NIF preview session is missing or expired.".to_string())?;
        ensure_nif_preview_window(session, window.label())?;
        let variant_index = session
            .variants
            .iter()
            .position(|variant| variant.variant_id == variant_id)
            .ok_or_else(|| "NIF preview variant token is invalid.".to_string())?;
        session.last_access_ms = now_millis();
        (
            session.project_directory.clone(),
            session.operation_id.clone(),
            session.variants[variant_index].clone(),
            variant_index,
        )
    };

    let prepared = fluxora_bridge_request(
        app.clone(),
        "mods.prepareNifPreviewVariant".to_string(),
        json!({
            "projectDirectory": project_directory,
            "modPath": variant.mod_path,
            "relativePath": variant.relative_path
        }),
        Some(OperationRequest {
            operation_id: Some(operation_id.clone()),
        }),
        Some(BRIDGE_TIMEOUT_MS),
    )
    .await?;

    let handle = {
        let mut sessions = state.sessions.lock().await;
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| "NIF preview session ended while preparing a variant.".to_string())?;
        ensure_nif_preview_window(session, window.label())?;
        let handle = register_nif_preview_assets(
            &state,
            session,
            std::slice::from_ref(&prepared),
        )?
        .into_iter()
        .next()
        .ok_or_else(|| "NIF preview variant registration failed.".to_string())?;
        session.active_index = variant_index;
        session.last_access_ms = now_millis();
        handle
    };

    let _ = write_log(
        &app,
        "main-bridge",
        "info",
        "NifPreview",
        &format!(
            "variantPrepared sessionId={} variantId={}",
            sanitize_log(&session_id),
            sanitize_log(&variant_id)
        ),
        Some(&operation_id),
    )
    .await;
    Ok(handle)
}

#[tauri::command]
async fn fluxora_prepare_nif_preview_textures(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    texture_paths: Vec<String>,
) -> Result<Value, String> {
    if texture_paths.len() > NIF_PREVIEW_MAX_BATCH_ASSETS {
        return Err("NIF preview texture batch exceeds the 64-item limit.".to_string());
    }

    let mut seen = HashSet::<String>::new();
    let mut deduplicated = Vec::<String>::new();
    for texture_path in texture_paths {
        let texture_path = texture_path.trim();
        if texture_path.is_empty() {
            return Err("NIF preview texture paths must not be empty.".to_string());
        }
        let key = texture_path.replace('\\', "/").to_ascii_lowercase();
        if seen.insert(key) {
            deduplicated.push(texture_path.to_string());
        }
    }

    let state = app.state::<NifPreviewSessionState>();
    let (project_directory, profile_name, model_mod_path, operation_id) = {
        let mut sessions = state.sessions.lock().await;
        purge_expired_nif_preview_sessions(&mut sessions, now_millis());
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| "NIF preview session is missing or expired.".to_string())?;
        ensure_nif_preview_window(session, window.label())?;
        session.last_access_ms = now_millis();
        (
            session.project_directory.clone(),
            session.profile_name.clone(),
            session.variants[session.active_index].mod_path.clone(),
            session.operation_id.clone(),
        )
    };

    if deduplicated.is_empty() {
        return Ok(json!({ "assets": [], "missing": [] }));
    }

    let prepared = fluxora_bridge_request(
        app.clone(),
        "mods.prepareNifPreviewTextures".to_string(),
        json!({
            "projectDirectory": project_directory,
            "profileName": profile_name,
            "modelModPath": model_mod_path,
            "texturePaths": deduplicated
        }),
        Some(OperationRequest {
            operation_id: Some(operation_id.clone()),
        }),
        Some(BRIDGE_TIMEOUT_MS),
    )
    .await?;
    let prepared_assets = prepared
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| "NIF preview texture response has no assets array.".to_string())?;
    if prepared_assets.len() > NIF_PREVIEW_MAX_BATCH_ASSETS {
        return Err("NIF preview core returned too many texture assets.".to_string());
    }
    let missing = prepared
        .get("missing")
        .and_then(Value::as_array)
        .ok_or_else(|| "NIF preview texture response has no missing array.".to_string())?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| "NIF preview missing entry is invalid.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    let assets = {
        let mut sessions = state.sessions.lock().await;
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| "NIF preview session ended while preparing textures.".to_string())?;
        ensure_nif_preview_window(session, window.label())?;
        let assets = register_nif_preview_assets(&state, session, prepared_assets)?;
        session.last_access_ms = now_millis();
        assets
    };

    let _ = write_log(
        &app,
        "main-bridge",
        "info",
        "NifPreview",
        &format!(
            "texturesPrepared sessionId={} assets={} missing={} bytes={} archiveIndexHits={} archiveIndexMisses={} archiveAssetCacheHits={} archiveAssetCacheMisses={}",
            sanitize_log(&session_id),
            assets.len(),
            missing.len(),
            prepared.get("totalBytes").and_then(Value::as_u64).unwrap_or_default(),
            prepared.get("archiveIndexHits").and_then(Value::as_u64).unwrap_or_default(),
            prepared.get("archiveIndexMisses").and_then(Value::as_u64).unwrap_or_default(),
            prepared.get("archiveAssetCacheHits").and_then(Value::as_u64).unwrap_or_default(),
            prepared.get("archiveAssetCacheMisses").and_then(Value::as_u64).unwrap_or_default()
        ),
        Some(&operation_id),
    )
    .await;
    Ok(json!({ "assets": assets, "missing": missing }))
}

#[tauri::command]
async fn fluxora_read_nif_preview_asset_bytes(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    asset_id: String,
) -> Result<Response, String> {
    let state = app.state::<NifPreviewSessionState>();
    let (asset, operation_id) = {
        let mut sessions = state.sessions.lock().await;
        purge_expired_nif_preview_sessions(&mut sessions, now_millis());
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| "NIF preview session is missing or expired.".to_string())?;
        ensure_nif_preview_window(session, window.label())?;
        let asset = session
            .assets
            .get(&asset_id)
            .cloned()
            .ok_or_else(|| "NIF preview asset token is invalid for this session.".to_string())?;
        session.last_access_ms = now_millis();
        (asset, session.operation_id.clone())
    };

    let metadata = tokio::fs::metadata(&asset.resolved_path)
        .await
        .map_err(|error| format!("NIF preview asset is unavailable: {error}"))?;
    if !metadata.is_file()
        || metadata.len() != asset.size
        || metadata.len() > NIF_PREVIEW_MAX_ASSET_BYTES
    {
        return Err("NIF preview asset changed or exceeds its prepared limit.".to_string());
    }
    let bytes = tokio::fs::read(&asset.resolved_path)
        .await
        .map_err(|error| format!("NIF preview asset read failed: {error}"))?;

    let _ = write_log(
        &app,
        "main-bridge",
        "info",
        "NifPreview",
        &format!(
            "assetReadRaw sessionId={} assetId={} bytes={}",
            sanitize_log(&session_id),
            sanitize_log(&asset_id),
            bytes.len()
        ),
        Some(&operation_id),
    )
    .await;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn fluxora_end_nif_preview(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    let state = app.state::<NifPreviewSessionState>();
    let removed = {
        let mut sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get(&session_id) {
            ensure_nif_preview_window(session, window.label())?;
        }
        sessions.remove(&session_id)
    };
    if let Some(session) = removed {
        let _ = write_log(
            &app,
            "main-bridge",
            "info",
            "NifPreview",
            &format!("sessionEnded sessionId={}", sanitize_log(&session_id)),
            Some(&session.operation_id),
        )
        .await;
    }
    Ok(())
}

fn bridge_status_failure(
    app: &AppHandle,
    bridge: &BridgeProcess,
    operation_id: &str,
    code: &str,
    category: &str,
    retryable: bool,
    message: &str,
) -> Value {
    let log_directory = logs_dir(app);
    let (message, category) = bridge_status_error_fields(message, category);
    json!({
        "ready": false,
        "operationId": operation_id,
        "hostPath": bridge.host_path.as_ref().map(|path| path.to_string_lossy().to_string()),
        "error": {
            "code": code,
            "message": message,
            "category": category,
            "retryable": retryable,
            "capabilityId": null,
            "details": {}
        },
        "logs": {
            "uiLogPath": log_directory.join("fluxora-tauri-ui-current.log").to_string_lossy().to_string(),
            "mainBridgeLogPath": log_directory.join("fluxora-tauri-main-bridge-current.log").to_string_lossy().to_string(),
            "nativeLogDirectory": log_directory.to_string_lossy().to_string()
        }
    })
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
            if !bridge_core_status_is_ready(&status) {
                let message = status
                    .get("lastError")
                    .and_then(Value::as_str)
                    .filter(|message| !message.trim().is_empty())
                    .unwrap_or("Native core failed to initialize.");
                return Ok(bridge_status_failure(
                    &app,
                    &bridge,
                    &operation_id,
                    "bridge.coreUnavailable",
                    "core",
                    true,
                    message,
                ));
            }

            let capabilities = match bridge
                .request(
                    &app,
                    "system.getCapabilities",
                    json!({}),
                    request.clone(),
                    BRIDGE_TIMEOUT_MS,
                )
                .await
            {
                Ok(capabilities) => capabilities,
                Err(message) => {
                    return Ok(bridge_status_failure(
                        &app,
                        &bridge,
                        &operation_id,
                        "bridge.capabilitiesUnavailable",
                        "transport",
                        true,
                        &message,
                    ));
                }
            };
            if !bridge_runtime_is_ready(&status, &capabilities) {
                return Ok(bridge_status_failure(
                    &app,
                    &bridge,
                    &operation_id,
                    "bridge.coreUnavailable",
                    "core",
                    true,
                    "Native bridge capabilities report that the core is unavailable.",
                ));
            }
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
        Err(message) => Ok(bridge_status_failure(
            &app,
            &bridge,
            &operation_id,
            "bridge.unavailable",
            "transport",
            true,
            &message,
        )),
    }
}

#[tauri::command]
async fn fluxora_operations_get_status(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "operations_status")),
    });
    let operation_id = operation_id(Some(&request), "operations_status");
    let state = app.state::<OperationStatusState>();
    let progress = state.progress.lock().await;
    let mut seen = HashSet::new();
    let mut recent = Vec::new();

    for payload in progress.iter().rev() {
        let Some(snapshot) = operation_status_snapshot(payload) else {
            continue;
        };
        let Some(snapshot_operation_id) = snapshot.get("operationId").and_then(Value::as_str)
        else {
            continue;
        };
        if seen.insert(snapshot_operation_id.to_string()) {
            recent.push(snapshot);
        }
    }

    let active: Vec<Value> = recent
        .iter()
        .filter(|snapshot| snapshot.get("state").and_then(Value::as_str) == Some("running"))
        .cloned()
        .collect();

    Ok(json!({
        "operationId": operation_id,
        "source": "tauri-progress-cache",
        "active": active,
        "recent": recent,
        "message": "Operation status is derived from recent bridge progress events."
    }))
}

async fn read_log_tail(path: &Path) -> Result<String, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| error.to_string())?;
    let length = file
        .metadata()
        .await
        .map_err(|error| error.to_string())?
        .len();
    if length > RECENT_OPERATION_LOG_TAIL_BYTES {
        file.seek(SeekFrom::Start(length - RECENT_OPERATION_LOG_TAIL_BYTES))
            .await
            .map_err(|error| error.to_string())?;
    }

    let mut content = String::new();
    file.read_to_string(&mut content)
        .await
        .map_err(|error| error.to_string())?;
    Ok(content)
}

async fn recent_log_files(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let dir = logs_dir(app);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut files = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| error.to_string())?
    {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let lower_name = file_name.to_ascii_lowercase();
        if path.extension().and_then(|extension| extension.to_str()) == Some("log")
            && lower_name.contains("fluxora")
        {
            files.push(path);
        }
    }

    files.sort();
    Ok(files)
}

fn log_level_from_line(line: &str) -> Option<&'static str> {
    if line.contains("[ERROR]") {
        Some("error")
    } else if line.contains("[WARNING]") || line.contains("[WARN]") {
        Some("warning")
    } else if line.contains("[DEBUG]") {
        Some("debug")
    } else if line.contains("[INFO]") {
        Some("info")
    } else {
        None
    }
}

fn bracket_field(line: &str, index: usize) -> Option<String> {
    line.split('[')
        .nth(index + 1)
        .and_then(|part| part.split(']').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn operation_id_from_log_line(line: &str) -> Option<String> {
    line.split("[operationId=")
        .nth(1)
        .and_then(|part| part.split(']').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn operation_log_entry(source: &str, line: &str) -> Value {
    let mut entry = json!({
        "source": source,
        "line": sanitize_log(line)
    });
    if let Value::Object(fields) = &mut entry {
        if let Some(timestamp) = bracket_field(line, 0) {
            fields.insert("timestamp".to_string(), json!(timestamp));
        }
        if let Some(level) = log_level_from_line(line) {
            fields.insert("level".to_string(), json!(level));
        }
        if let Some(category) = bracket_field(line, 2) {
            fields.insert("category".to_string(), json!(category));
        }
        if let Some(operation_id) = operation_id_from_log_line(line) {
            fields.insert("operationId".to_string(), json!(operation_id));
        }
    }
    entry
}

fn is_operation_log_line(line: &str, operation_id_filter: Option<&str>) -> bool {
    if let Some(filter) = operation_id_filter.filter(|value| !value.trim().is_empty()) {
        return line.contains(filter);
    }

    line.contains("operationId=") || line.to_ascii_lowercase().contains("operation")
}

#[tauri::command]
async fn fluxora_recent_operation_logs(
    app: AppHandle,
    options: Option<RecentOperationLogsOptions>,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "operations_recent_logs")),
    });
    let operation_id = operation_id(Some(&request), "operations_recent_logs");
    let options = options.unwrap_or_default();
    let max_entries = options
        .max_entries
        .unwrap_or(20)
        .clamp(1, RECENT_OPERATION_LOG_MAX_LIMIT);
    let operation_id_filter = options
        .operation_id_filter
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let files = recent_log_files(&app).await?;
    let mut entries = Vec::new();
    let mut log_paths = Vec::new();

    for path in &files {
        let source = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("fluxora.log")
            .to_string();
        log_paths.push(path.to_string_lossy().to_string());
        let content = match read_log_tail(path).await {
            Ok(content) => content,
            Err(_) => continue,
        };
        for line in content.lines() {
            if is_operation_log_line(line, operation_id_filter) {
                entries.push(operation_log_entry(&source, line));
            }
        }
    }

    let truncated = entries.len() > max_entries;
    if truncated {
        let extra = entries.len() - max_entries;
        entries.drain(0..extra);
    }

    Ok(json!({
        "operationId": operation_id,
        "entries": entries,
        "logPaths": log_paths,
        "maxEntries": max_entries,
        "truncated": truncated
    }))
}

#[tauri::command]
async fn fluxora_shutdown_bridge(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<(), String> {
    let state = bridge_state(&app);
    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, "bridge_shutdown")),
    });
    let main_result = {
        let mut bridge = state.process.lock().await;
        bridge.shutdown(&app, request.clone()).await
    };
    let interactive_result = {
        let mut bridge = state.interactive_process.lock().await;
        bridge.shutdown(&app, request).await
    };
    main_result.and(interactive_result)
}

fn process_watch_request(
    request: Option<OperationRequest>,
    embedded_operation_id: Option<String>,
    scope: &str,
) -> OperationRequest {
    request.unwrap_or(OperationRequest {
        operation_id: embedded_operation_id
            .filter(|value| !value.trim().is_empty())
            .or_else(|| Some(operation_id(None, scope))),
    })
}

fn process_watch_result(
    process_id: u32,
    process_name: String,
    state: &str,
    tracked_kind: &str,
    operation_id: String,
) -> ProcessWatchResult {
    ProcessWatchResult {
        process_id,
        process_name,
        state: state.to_string(),
        tracked_kind: tracked_kind.to_string(),
        operation_id,
    }
}

fn process_watch_poll_interval(request: &LaunchProcessWatchRequest) -> Duration {
    Duration::from_millis(
        request
            .poll_interval_ms
            .unwrap_or(PROCESS_WATCH_DEFAULT_POLL_MS)
            .clamp(PROCESS_WATCH_MIN_POLL_MS, PROCESS_WATCH_MAX_POLL_MS),
    )
}

fn cleaned_process_names(names: &[String]) -> Vec<String> {
    names
        .iter()
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn launch_process_display_name(
    request: &LaunchProcessWatchRequest,
    expected_names: &[String],
) -> String {
    request
        .process_name
        .as_ref()
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
        .or_else(|| expected_names.first().cloned())
        .unwrap_or_else(|| "launched process".to_string())
}

async fn wait_for_native_process_exit(process_id: u32) -> process_platform::NativeExitWait {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let spawn_result = std::thread::Builder::new()
        .name(format!("fluxora-process-wait-{process_id}"))
        .spawn(move || {
            let _ = sender.send(process_platform::wait_for_exit_signal(process_id));
        });
    if spawn_result.is_err() {
        return process_platform::NativeExitWait::Unavailable;
    }

    receiver
        .await
        .unwrap_or(process_platform::NativeExitWait::Unavailable)
}

async fn find_remaining_vfs_process(exited_process_id: u32) -> Option<process_platform::ProcessInfo> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let spawn_result = std::thread::Builder::new()
        .name("fluxora-vfs-process-probe".to_string())
        .spawn(move || {
            let holder = process_platform::find_processes_using_module(FLUXORA_VFS_MODULE_NAME)
                .into_iter()
                .find(|process| {
                    process.process_id != exited_process_id
                        && process_platform::is_process_running(process.process_id)
                });
            let _ = sender.send(holder);
        });
    if spawn_result.is_err() {
        return process_platform::find_processes_using_module(FLUXORA_VFS_MODULE_NAME)
            .into_iter()
            .find(|process| {
                process.process_id != exited_process_id
                    && process_platform::is_process_running(process.process_id)
            });
    }

    receiver.await.unwrap_or(None)
}

#[tauri::command]
async fn fluxora_wait_for_launch_ready(
    app: AppHandle,
    launch: LaunchProcessWatchRequest,
    request: Option<OperationRequest>,
) -> Result<ProcessWatchResult, String> {
    let request =
        process_watch_request(request, launch.operation_id.clone(), "process_watch_launch");
    let operation_id = operation_id(Some(&request), "process_watch_launch");
    let tracking_kind = launch
        .launch_tracking_kind
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("directProcess")
        .to_string();
    let expected_names = cleaned_process_names(&launch.expected_child_process_names);
    let display_name = launch_process_display_name(&launch, &expected_names);
    let poll_interval = process_watch_poll_interval(&launch);

    let _ = write_log(
        &app,
        "main",
        "info",
        "LaunchProcess",
        &format!(
            "Waiting for launch readiness. pid={} kind={} expectedChildren={}",
            launch.process_id,
            sanitize_log(&tracking_kind),
            sanitize_log(&expected_names.join(","))
        ),
        Some(&operation_id),
    )
    .await;

    if tracking_kind == "expectedChildProcess" && !expected_names.is_empty() {
        let handoff_timeout = Duration::from_millis(
            launch
                .handoff_timeout_ms
                .unwrap_or(PROCESS_WATCH_DEFAULT_HANDOFF_MS),
        );
        let started_at = Instant::now();
        loop {
            if let Some((process_id, process_name)) =
                process_platform::find_process_by_names(&expected_names)
            {
                let _ = write_log(
                    &app,
                    "main",
                    "info",
                    "LaunchProcess",
                    &format!(
                        "Expected child process is running. pid={} name={}",
                        process_id,
                        sanitize_log(&process_name)
                    ),
                    Some(&operation_id),
                )
                .await;
                return Ok(process_watch_result(
                    process_id,
                    process_name,
                    "running",
                    "expectedChildProcess",
                    operation_id,
                ));
            }

            if started_at.elapsed() >= handoff_timeout {
                let _ = write_log(
                    &app,
                    "main",
                    "warning",
                    "LaunchProcess",
                    &format!(
                        "Timed out waiting for expected child process. pid={} expectedChildren={}",
                        launch.process_id,
                        sanitize_log(&expected_names.join(","))
                    ),
                    Some(&operation_id),
                )
                .await;
                return Ok(process_watch_result(
                    launch.process_id,
                    display_name,
                    "timeout",
                    "expectedChildProcess",
                    operation_id,
                ));
            }

            tokio::time::sleep(poll_interval).await;
        }
    }

    let state = if process_platform::is_process_running(launch.process_id) {
        "running"
    } else if launch.process_id == 0 {
        "notFound"
    } else {
        "exited"
    };
    let _ = write_log(
        &app,
        "main",
        if state == "running" {
            "info"
        } else {
            "warning"
        },
        "LaunchProcess",
        &format!(
            "Direct launch process readiness state={}. pid={} name={}",
            state,
            launch.process_id,
            sanitize_log(&display_name)
        ),
        Some(&operation_id),
    )
    .await;
    Ok(process_watch_result(
        launch.process_id,
        display_name,
        state,
        "directProcess",
        operation_id,
    ))
}

#[tauri::command]
async fn fluxora_wait_for_process_exit(
    app: AppHandle,
    process_id: u32,
    request: Option<OperationRequest>,
) -> Result<ProcessWatchResult, String> {
    let request = process_watch_request(request, None, "process_wait_exit");
    let operation_id = operation_id(Some(&request), "process_wait_exit");
    let _ = write_log(
        &app,
        "main",
        "info",
        "LaunchProcess",
        &format!("Waiting for native process exit signal. pid={}", process_id),
        Some(&operation_id),
    )
    .await;

    let native_wait = wait_for_native_process_exit(process_id).await;
    if native_wait == process_platform::NativeExitWait::Unavailable {
        let _ = write_log(
            &app,
            "main",
            "warning",
            "LaunchProcess",
            &format!(
                "Native process exit signal unavailable; using fallback polling. pid={}",
                process_id
            ),
            Some(&operation_id),
        )
        .await;
        let poll_interval = Duration::from_millis(PROCESS_WATCH_FALLBACK_POLL_MS);
        while process_platform::is_process_running(process_id) {
            tokio::time::sleep(poll_interval).await;
        }
    }

    let remaining_vfs_process = find_remaining_vfs_process(process_id).await;
    if let Some(process) = remaining_vfs_process {
        let _ = write_log(
            &app,
            "main",
            "info",
            "LaunchProcess",
            &format!(
                "Tracked process exited but a VFS holder remains. exitedPid={} holderPid={} holderName={}",
                process_id,
                process.process_id,
                sanitize_log(&process.process_name)
            ),
            Some(&operation_id),
        )
        .await;
        return Ok(process_watch_result(
            process.process_id,
            process.process_name,
            "running",
            "vfsHolder",
            operation_id,
        ));
    }

    let _ = write_log(
        &app,
        "main",
        "info",
        "LaunchProcess",
        &format!(
            "Tracked launch process exited and no VFS holder remains. pid={} watcher={}",
            process_id,
            if native_wait == process_platform::NativeExitWait::Signaled {
                "nativeSignal"
            } else {
                "fallbackPolling"
            }
        ),
        Some(&operation_id),
    )
    .await;

    Ok(process_watch_result(
        process_id,
        String::new(),
        if process_id == 0 {
            "notFound"
        } else {
            "exited"
        },
        "directProcess",
        operation_id,
    ))
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
    let url = match safe_external_url(&url) {
        Ok(url) => url,
        Err(reason) => {
            return Ok(OpenExternalResult {
                ok: false,
                reason: Some(reason.to_string()),
            });
        }
    };

    if !url.to_ascii_lowercase().starts_with("https://")
        && !url.to_ascii_lowercase().starts_with("mailto:")
    {
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
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("/?window=settings".into()),
    )
    .title("Settings")
    .inner_size(980.0, 700.0)
    .min_inner_size(860.0, 620.0)
    .resizable(true)
    .minimizable(false)
    .maximizable(false)
    .decorations(false)
    .background_color(tauri::window::Color(0x10, 0x13, 0x17, 0xff))
    .center()
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn fluxora_open_build_settings_window(
    app: AppHandle,
    config_path: String,
    build_name: String,
) -> Result<(), String> {
    let config_path = config_path.trim();
    if config_path.is_empty() {
        return Err("Build settings require a project config path.".to_string());
    }

    let build_name = build_name.trim();
    let build_title = if build_name.is_empty() {
        "Build"
    } else {
        build_name
    };
    let label = format!(
        "{BUILD_SETTINGS_WINDOW_LABEL_PREFIX}:{}",
        stable_label_suffix(config_path)
    );
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let url = format!(
        "/?window=build-settings&project={}&name={}",
        encode_query_component(config_path),
        encode_query_component(build_title)
    );

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(format!("Settings \u{00B7} {build_title}"))
        .inner_size(980.0, 700.0)
        .min_inner_size(860.0, 620.0)
        .resizable(true)
        .minimizable(false)
        .maximizable(false)
        .decorations(false)
        .background_color(tauri::window::Color(0x10, 0x13, 0x17, 0xff))
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn fluxora_open_mod_details_window(
    app: AppHandle,
    config_path: String,
    mod_path: String,
    mod_name: String,
    profile_name: Option<String>,
    bootstrap_key: Option<String>,
    bootstrap: Option<Value>,
) -> Result<(), String> {
    let config_path = config_path.trim();
    if config_path.is_empty() {
        return Err("Mod details require a project config path.".to_string());
    }

    let mod_path = mod_path.trim();
    if mod_path.is_empty() {
        return Err("Mod details require a mod path.".to_string());
    }

    let mod_name = mod_name.trim();
    let mod_title = if mod_name.is_empty() { "Mod" } else { mod_name };
    let profile_name = profile_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let bootstrap_key = bootstrap_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let label = format!(
        "{MOD_DETAILS_WINDOW_LABEL_PREFIX}:{}",
        stable_label_suffix(&format!("{config_path}\u{0}{mod_path}\u{0}{profile_name}"))
    );
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let mut url = format!(
        "/?window=mod-details&project={}&mod={}&name={}&profile={}",
        encode_query_component(config_path),
        encode_query_component(mod_path),
        encode_query_component(mod_title),
        encode_query_component(profile_name)
    );
    if !bootstrap_key.is_empty() {
        url.push_str("&bootstrap=");
        url.push_str(&encode_query_component(bootstrap_key));
    }

    let initialization_script = bootstrap
        .as_ref()
        .map(|value| {
            serde_json::to_string(value)
                .map(|serialized| {
                    serialized
                        .replace('\u{2028}', "\\u2028")
                        .replace('\u{2029}', "\\u2029")
                })
                .map(|serialized| {
                    format!(
                        "if (new URLSearchParams(globalThis.location.search).get('window') === 'mod-details') {{ globalThis.__FLUXORA_MOD_DETAILS_BOOTSTRAP__ = {serialized}; }}"
                    )
                })
        })
        .transpose()
        .map_err(|error| format!("Mod details bootstrap could not be serialized: {error}"))?;
    let mut builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()));
    if let Some(script) = initialization_script {
        builder = builder.initialization_script(script);
    }

    builder
        .title(mod_title)
        .inner_size(1120.0, 760.0)
        .min_inner_size(900.0, 620.0)
        .resizable(true)
        .minimizable(false)
        .maximizable(false)
        .decorations(false)
        .background_color(tauri::window::Color(0x10, 0x13, 0x17, 0xff))
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn text_editor_window_url(
    config_path: &str,
    project_directory: &str,
    mod_path: &str,
    relative_path: &str,
    file_name: &str,
) -> String {
    format!(
        "/?window=text-editor&project={}&directory={}&mod={}&path={}&name={}",
        encode_query_component(config_path),
        encode_query_component(project_directory),
        encode_query_component(mod_path),
        encode_query_component(relative_path),
        encode_query_component(file_name)
    )
}

#[tauri::command]
async fn fluxora_open_text_editor_window(
    app: AppHandle,
    config_path: String,
    project_directory: String,
    mod_path: Option<String>,
    relative_path: Option<String>,
    file_name: Option<String>,
) -> Result<(), String> {
    let config_path = config_path.trim();
    if config_path.is_empty() {
        return Err("Text editor requires a project config path.".to_string());
    }
    let project_directory = project_directory.trim();
    if project_directory.is_empty() {
        return Err("Text editor requires a project directory.".to_string());
    }

    let mod_path = mod_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let relative_path = relative_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let file_name = file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            relative_path
                .rsplit(['/', '\\'])
                .next()
                .filter(|value| !value.is_empty())
                .unwrap_or("Editor")
        });

    let label = format!(
        "{TEXT_EDITOR_WINDOW_LABEL_PREFIX}:{}",
        stable_label_suffix(&format!(
            "{config_path}\u{0}{project_directory}\u{0}{mod_path}\u{0}{relative_path}"
        ))
    );
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let url = text_editor_window_url(
        config_path,
        project_directory,
        mod_path,
        relative_path,
        file_name,
    );

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(format!("Editor \u{00B7} {file_name}"))
        .inner_size(1344.0, 912.0)
        .min_inner_size(1080.0, 720.0)
        .resizable(true)
        .minimizable(false)
        .maximizable(false)
        .decorations(false)
        .background_color(tauri::window::Color(0x10, 0x13, 0x17, 0xff))
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn file_preview_window_url(
    config_path: &str,
    project_directory: &str,
    mod_path: &str,
    relative_path: &str,
    file_title: &str,
    profile_name: &str,
    preview_kind: &str,
) -> String {
    format!(
        "/?window=file-preview&project={}&directory={}&mod={}&path={}&name={}&profile={}&kind={}",
        encode_query_component(config_path),
        encode_query_component(project_directory),
        encode_query_component(mod_path),
        encode_query_component(relative_path),
        encode_query_component(file_title),
        encode_query_component(profile_name),
        encode_query_component(preview_kind)
    )
}

#[tauri::command]
async fn fluxora_open_file_preview_window(
    app: AppHandle,
    config_path: String,
    project_directory: String,
    mod_path: String,
    relative_path: String,
    file_name: String,
    profile_name: String,
    kind: String,
) -> Result<(), String> {
    let config_path = config_path.trim();
    if config_path.is_empty() {
        return Err("File preview requires a project config path.".to_string());
    }

    let project_directory = project_directory.trim();
    if project_directory.is_empty() {
        return Err("File preview requires a project directory.".to_string());
    }

    let mod_path = mod_path.trim();
    if mod_path.is_empty() {
        return Err("File preview requires a mod path.".to_string());
    }

    let relative_path = relative_path.trim();
    if relative_path.is_empty() {
        return Err("File preview requires a relative file path.".to_string());
    }

    let file_name = file_name.trim();
    let file_title = if file_name.is_empty() {
        relative_path
            .rsplit(['/', '\\'])
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("Preview")
    } else {
        file_name
    };
    let profile_name = profile_name.trim();
    let kind = kind.trim();
    let preview_kind = if kind.is_empty() { "nif" } else { kind };

    let label = format!(
        "{FILE_PREVIEW_WINDOW_LABEL_PREFIX}:{}",
        stable_label_suffix(&format!(
            "{config_path}\u{0}{mod_path}\u{0}{relative_path}\u{0}{profile_name}\u{0}{preview_kind}"
        ))
    );
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let url = file_preview_window_url(
        config_path,
        project_directory,
        mod_path,
        relative_path,
        file_title,
        profile_name,
        preview_kind,
    );

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(format!("Preview \u{00B7} {file_title}"))
        .inner_size(1344.0, 912.0)
        .min_inner_size(1080.0, 720.0)
        .resizable(true)
        .minimizable(false)
        .maximizable(false)
        .decorations(false)
        .background_color(tauri::window::Color(0x10, 0x13, 0x17, 0xff))
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn fluxora_build_settings_paths_saved(app: AppHandle, project: Value) -> Result<(), String> {
    app.emit_to(MAIN_WINDOW_LABEL, BUILD_SETTINGS_PATHS_SAVED_EVENT, project)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn fluxora_downloads_watch_folder(
    app: AppHandle,
    project_directory: String,
    downloads_directory: String,
    request: Option<OperationRequest>,
) -> Result<DownloadsFolderWatchResult, String> {
    let request = downloads_watch_request(request, "downloads_watch_folder");
    let operation_id = operation_id(Some(&request), "downloads_watch_folder");
    let project_directory = project_directory.trim().to_string();
    let downloads_directory = downloads_directory.trim().to_string();

    if project_directory.is_empty() {
        return Err("projectDirectory is required".to_string());
    }
    if downloads_directory.is_empty() {
        return Err("downloadsDirectory is required".to_string());
    }

    let downloads_path = PathBuf::from(&downloads_directory);
    if !downloads_path.is_dir() {
        return Err("downloadsDirectory must point to an existing folder".to_string());
    }

    let state = app.state::<DownloadsFolderWatchState>();
    let watcher_generation =
        reserve_build_content_watch_generation(&state.requested_generation);
    let active_generation = state.generation.clone();
    let sequence = state.sequence.clone();
    let app_for_events = app.clone();
    let project_for_events = project_directory.clone();
    let downloads_for_events = downloads_path.to_string_lossy().to_string();

    let mut debouncer = new_debouncer(
        Duration::from_millis(DOWNLOADS_FOLDER_WATCH_DEBOUNCE_MS),
        None,
        move |result: DebounceEventResult| {
            if active_generation.load(Ordering::SeqCst) != watcher_generation {
                return;
            }
            emit_downloads_folder_watch_result(
                &app_for_events,
                &project_for_events,
                &downloads_for_events,
                &sequence,
                result,
            );
        },
    )
    .map_err(|error| error.to_string())?;

    debouncer
        .watch(&downloads_path, RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    let mut active = state.active.lock().await;
    if !build_content_watch_install_is_current(
        &state.requested_generation,
        watcher_generation,
    ) {
        drop(active);
        debouncer.stop_nonblocking();
        return Ok(DownloadsFolderWatchResult {
            accepted: false,
            operation_id,
        });
    }
    state.generation.store(watcher_generation, Ordering::SeqCst);
    let previous = active.take();
    *active = Some(DownloadsFolderWatcher {
        debouncer,
        project_directory: project_directory.clone(),
        downloads_directory: downloads_path.clone(),
        operation_id: operation_id.clone(),
        generation: watcher_generation,
    });
    drop(active);

    if let Some(previous) = previous {
        previous.debouncer.stop_nonblocking();
    }

    let _ = write_log(
        &app,
        "main",
        "info",
        "DownloadsFolderWatcher",
        &format!(
            "Watching downloads folder. projectDirectory={} downloadsDirectory={}",
            project_directory,
            downloads_path.to_string_lossy()
        ),
        Some(&operation_id),
    )
    .await;

    Ok(DownloadsFolderWatchResult {
        accepted: true,
        operation_id,
    })
}

#[tauri::command]
async fn fluxora_downloads_unwatch_folder(
    app: AppHandle,
    request: Option<OperationRequest>,
) -> Result<DownloadsFolderWatchResult, String> {
    let request = downloads_watch_request(request, "downloads_unwatch_folder");
    let operation_id = operation_id(Some(&request), "downloads_unwatch_folder");
    let state = app.state::<DownloadsFolderWatchState>();
    let stopped_generation =
        reserve_build_content_watch_generation(&state.requested_generation);
    state.generation.store(stopped_generation, Ordering::SeqCst);

    let mut active = state.active.lock().await;
    let previous = active.take();
    drop(active);

    let had_active_watcher = previous.is_some();
    if let Some(previous) = previous {
        let previous_project_directory = previous.project_directory;
        let previous_downloads_directory = previous.downloads_directory;
        let previous_operation_id = previous.operation_id;
        let previous_generation = previous.generation;
        previous.debouncer.stop_nonblocking();
        let _ = write_log(
            &app,
            "main",
            "info",
            "DownloadsFolderWatcher",
            &format!(
                "Stopped downloads folder watcher. projectDirectory={} downloadsDirectory={} previousOperationId={} generation={}",
                previous_project_directory,
                previous_downloads_directory.to_string_lossy(),
                previous_operation_id,
                previous_generation
            ),
            Some(&operation_id),
        )
        .await;
    }

    if !had_active_watcher {
        let _ = write_log(
            &app,
            "main",
            "info",
            "DownloadsFolderWatcher",
            "Downloads folder watcher stop requested with no active watcher.",
            Some(&operation_id),
        )
        .await;
    }

    Ok(DownloadsFolderWatchResult {
        accepted: true,
        operation_id,
    })
}

#[tauri::command]
async fn fluxora_build_content_watch(
    app: AppHandle,
    watch_request: BuildContentWatchRequest,
    operation: Option<OperationRequest>,
) -> Result<BuildContentWatchResult, String> {
    let operation = build_content_watch_request(operation, "build_content_watch");
    let operation_id = operation_id(Some(&operation), "build_content_watch");
    let project_directory = watch_request.project_directory.trim().to_string();
    let mods_directory = watch_request.mods_directory.trim().to_string();
    let profiles_directory = watch_request.profiles_directory.trim().to_string();
    let profile_name = watch_request
        .profile_name
        .unwrap_or_default()
        .trim()
        .to_string();
    let game_directory = watch_request
        .game_directory
        .unwrap_or_default()
        .trim()
        .to_string();

    if project_directory.is_empty() {
        return Err("projectDirectory is required".to_string());
    }
    if mods_directory.is_empty() {
        return Err("modsDirectory is required".to_string());
    }
    if profiles_directory.is_empty() {
        return Err("profilesDirectory is required".to_string());
    }

    let mods_path = PathBuf::from(&mods_directory);
    if !mods_path.is_dir() {
        return Err("modsDirectory must point to an existing folder".to_string());
    }
    let profiles_path = PathBuf::from(&profiles_directory);
    if !profiles_path.is_dir() {
        return Err("profilesDirectory must point to an existing folder".to_string());
    }
    let game_path = if game_directory.is_empty() {
        None
    } else {
        Some(PathBuf::from(&game_directory))
    };
    let game_data_path = game_path
        .as_ref()
        .map(|path| path.join("Data"))
        .filter(|path| path.is_dir());
    let watch_roots = build_content_watch_roots(
        &mods_path,
        &profiles_path,
        &profile_name,
        game_path.as_deref(),
    );
    if watch_roots.is_empty() {
        return Err("No build content folders are available to watch".to_string());
    }

    let state = app.state::<BuildContentWatchState>();
    let watcher_generation =
        reserve_build_content_watch_generation(&state.requested_generation);
    let active_generation = state.generation.clone();
    let event_context = BuildContentWatchEventContext {
        app: app.clone(),
        project_directory: project_directory.clone(),
        mods_directory: mods_path.clone(),
        profiles_directory: profiles_path.clone(),
        profile_name: profile_name.clone(),
        game_data_directory: game_data_path.clone(),
        sequence: state.sequence.clone(),
    };

    // The built-in FileIdMap recursively indexes every watched entry during
    // watch(), which makes opening a large modlist O(files) before T3. Fluxora
    // invalidates by path and does not require file-ID rename stitching.
    let mut debouncer = new_debouncer_opt::<_, RecommendedWatcher, NoCache>(
        Duration::from_millis(BUILD_CONTENT_WATCH_DEBOUNCE_MS),
        None,
        move |result: DebounceEventResult| {
            if !build_content_watch_generation_is_current(
                &active_generation,
                watcher_generation,
            ) {
                return;
            }
            emit_build_content_watch_result(&event_context, result);
        },
        NoCache,
        Config::default(),
    )
    .map_err(|error| error.to_string())?;

    for root in &watch_roots {
        debouncer
            .watch(
                &root.path,
                if root.recursive {
                    RecursiveMode::Recursive
                } else {
                    RecursiveMode::NonRecursive
                },
            )
            .map_err(|error| error.to_string())?;
    }

    let mut active = state.active.lock().await;
    if !build_content_watch_install_is_current(
        &state.requested_generation,
        watcher_generation,
    ) {
        drop(active);
        debouncer.stop_nonblocking();
        return Ok(BuildContentWatchResult {
            accepted: false,
            operation_id,
        });
    }
    state.generation.store(watcher_generation, Ordering::SeqCst);
    let previous = active.take();
    *active = Some(BuildContentWatcher {
        debouncer,
        project_directory: project_directory.clone(),
        mods_directory: mods_path.clone(),
        profiles_directory: profiles_path.clone(),
        profile_name: profile_name.clone(),
        operation_id: operation_id.clone(),
        generation: watcher_generation,
    });
    drop(active);

    if let Some(previous) = previous {
        previous.debouncer.stop_nonblocking();
    }

    let watched_roots = watch_roots
        .iter()
        .map(|root| root.path.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(";");
    let _ = write_log(
        &app,
        "main",
        "info",
        "BuildContentWatcher",
        &format!(
            "Watching build content. projectDirectory={} modsDirectory={} profilesDirectory={} profileName={} watchedRoots={}",
            project_directory,
            mods_path.to_string_lossy(),
            profiles_path.to_string_lossy(),
            profile_name,
            watched_roots
        ),
        Some(&operation_id),
    )
    .await;

    Ok(BuildContentWatchResult {
        accepted: true,
        operation_id,
    })
}

#[tauri::command]
async fn fluxora_build_content_unwatch(
    app: AppHandle,
    operation: Option<OperationRequest>,
) -> Result<BuildContentWatchResult, String> {
    let operation = build_content_watch_request(operation, "build_content_unwatch");
    let operation_id = operation_id(Some(&operation), "build_content_unwatch");
    let state = app.state::<BuildContentWatchState>();
    let stopped_generation =
        reserve_build_content_watch_generation(&state.requested_generation);
    state.generation.store(stopped_generation, Ordering::SeqCst);

    let mut active = state.active.lock().await;
    let previous = active.take();
    drop(active);

    let had_active_watcher = previous.is_some();
    if let Some(previous) = previous {
        let previous_project_directory = previous.project_directory;
        let previous_mods_directory = previous.mods_directory;
        let previous_profiles_directory = previous.profiles_directory;
        let previous_profile_name = previous.profile_name;
        let previous_operation_id = previous.operation_id;
        let previous_generation = previous.generation;
        previous.debouncer.stop_nonblocking();
        let _ = write_log(
            &app,
            "main",
            "info",
            "BuildContentWatcher",
            &format!(
                "Stopped build content watcher. projectDirectory={} modsDirectory={} profilesDirectory={} profileName={} previousOperationId={} generation={}",
                previous_project_directory,
                previous_mods_directory.to_string_lossy(),
                previous_profiles_directory.to_string_lossy(),
                previous_profile_name,
                previous_operation_id,
                previous_generation
            ),
            Some(&operation_id),
        )
        .await;
    }

    if !had_active_watcher {
        let _ = write_log(
            &app,
            "main",
            "info",
            "BuildContentWatcher",
            "Build content watcher stop requested with no active watcher.",
            Some(&operation_id),
        )
        .await;
    }

    Ok(BuildContentWatchResult {
        accepted: true,
        operation_id,
    })
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_nxm_activation_args(app.clone(), argv, "second-instance");
        }));
    }

    builder
        .manage(BridgeState::default())
        .manage(AiHostState::default())
        .manage(OperationStatusState::default())
        .manage(DownloadsFolderWatchState::default())
        .manage(BuildContentWatchState::default())
        .manage(NifPreviewSessionState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app = app.handle().clone();
            handle_nxm_activation_args(app.clone(), std::env::args().collect(), "startup");
            let cleanup_app = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(
                    NIF_PREVIEW_CLEANUP_INTERVAL_MS,
                ));
                loop {
                    interval.tick().await;
                    let state = cleanup_app.state::<NifPreviewSessionState>();
                    let removed = {
                        let mut sessions = state.sessions.lock().await;
                        purge_expired_nif_preview_sessions(&mut sessions, now_millis())
                    };
                    if removed > 0 {
                        let _ = write_log(
                            &cleanup_app,
                            "main-bridge",
                            "info",
                            "NifPreview",
                            &format!("expiredSessionsRemoved count={removed}"),
                            None,
                        )
                        .await;
                    }
                }
            });
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
        .on_window_event(|window, event| {
            if !matches!(
                event,
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            ) {
                return;
            }
            let app = window.app_handle().clone();
            let window_label = window.label().to_string();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<NifPreviewSessionState>();
                state
                    .sessions
                    .lock()
                    .await
                    .retain(|_, session| session.window_label != window_label);
            });
        })
        .invoke_handler(tauri::generate_handler![
            fluxora_app_info,
            fluxora_runtime_paths,
            fluxora_current_executable,
            fluxora_security_state,
            fluxora_log,
            fluxora_ai_cancel_run,
            fluxora_ai_get_status,
            fluxora_ai_restart_host,
            fluxora_ai_list_providers,
            fluxora_ai_list_models,
            fluxora_ai_connect_provider,
            fluxora_ai_disconnect_provider,
            fluxora_ai_test_provider,
            fluxora_ai_estimate_context,
            fluxora_ai_chat_respond,
            fluxora_bridge_request,
            fluxora_start_nif_preview,
            fluxora_prepare_nif_preview_variant,
            fluxora_prepare_nif_preview_textures,
            fluxora_read_nif_preview_asset_bytes,
            fluxora_end_nif_preview,
            fluxora_bridge_status,
            fluxora_operations_get_status,
            fluxora_recent_operation_logs,
            fluxora_shutdown_bridge,
            fluxora_wait_for_launch_ready,
            fluxora_wait_for_process_exit,
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
            fluxora_open_settings_window,
            fluxora_open_build_settings_window,
            fluxora_open_mod_details_window,
            fluxora_open_text_editor_window,
            fluxora_open_file_preview_window,
            fluxora_build_settings_paths_saved,
            fluxora_downloads_watch_folder,
            fluxora_downloads_unwatch_folder,
            fluxora_build_content_watch,
            fluxora_build_content_unwatch
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fluxora");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::ffi::{OsStr, OsString};
    use std::fs;
    use std::sync::{Mutex, OnceLock};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: impl AsRef<OsStr>) -> Self {
            let previous = env::var_os(key);
            env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                env::set_var(self.key, previous);
            } else {
                env::remove_var(self.key);
            }
        }
    }

    #[test]
    fn sanitize_log_redacts_provider_secrets_and_control_characters() {
        let message = sanitize_log(
            "provider failed\r\nurl=https://example.test?key=abcd1234 Bearer secret-bearer-token api_key=secret token:secret2",
        );

        assert!(!message.contains('\n'));
        assert!(!message.contains('\r'));
        assert!(!message.contains("abcd1234"));
        assert!(!message.contains("secret-bearer-token"));
        assert!(!message.contains("secret2"));
        assert!(message.contains("key=[redacted-secret]"));
        assert!(message.contains("Bearer [redacted-secret]"));
        assert!(message.contains("api_key=[redacted-secret]"));
        assert!(message.contains("token=[redacted-secret]"));
    }

    #[test]
    fn bridge_invoke_error_serialization_preserves_native_contract() {
        let native_error = json!({
            "code": "core.projectOpenFailed",
            "message": "The selected build could not be opened.",
            "category": "core",
            "retryable": true,
            "capabilityId": "projects.openConfig",
            "details": {
                "configPath": "C:/Builds/Foundation/fluxora.json",
                "attempt": 2
            }
        });

        let serialized = serialize_bridge_invoke_error(
            "projects.openConfig",
            "op_project_open_42",
            &native_error,
        );
        let payload: Value = serde_json::from_str(&serialized).expect("versioned error payload");

        assert_eq!(payload["schema"], BRIDGE_INVOKE_ERROR_SCHEMA);
        assert_eq!(payload["method"], "projects.openConfig");
        assert_eq!(payload["operationId"], "op_project_open_42");
        assert_eq!(payload["error"], native_error);
    }

    #[test]
    fn bridge_status_decodes_message_and_category_from_versioned_invoke_error() {
        let native_error = json!({
            "code": "core.initializationFailed",
            "message": "Native core failed to initialize.",
            "category": "core",
            "retryable": true,
            "capabilityId": null,
            "details": {}
        });
        let serialized =
            serialize_bridge_invoke_error("system.initialize", "op_bridge_status", &native_error);

        let (message, category) = bridge_status_error_fields(&serialized, "transport");

        assert_eq!(message, "Native core failed to initialize.");
        assert_eq!(category, "core");
        assert!(!message.contains(BRIDGE_INVOKE_ERROR_SCHEMA));
    }

    #[test]
    fn bridge_invoke_error_keeps_renderer_details_while_log_message_is_redacted() {
        let native_error = json!({
            "code": "bridge.transport",
            "message": "Request failed url=https://example.test?key=secret Bearer private-token",
            "category": "transport",
            "retryable": true,
            "capabilityId": null,
            "details": { "reason": "connection reset" }
        });

        let serialized =
            serialize_bridge_invoke_error("projects.list", "op_projects_list", &native_error);
        let payload: Value = serde_json::from_str(&serialized).expect("versioned error payload");
        assert_eq!(payload["error"]["message"], native_error["message"]);

        let log_message = sanitize_log(native_error["message"].as_str().expect("message"));
        assert!(!log_message.contains("key=secret"));
        assert!(!log_message.contains("private-token"));
        assert!(log_message.contains("key=[redacted-secret]"));
        assert!(log_message.contains("Bearer [redacted-secret]"));
    }

    #[test]
    fn bridge_handshake_rejects_incompatible_protocol_version() {
        let handshake = json!({
            "protocolVersion": "2.0"
        });

        let result =
            validate_negotiated_protocol(&handshake, BRIDGE_PROTOCOL_VERSION, "FluxoraBridgeHost");

        assert_eq!(
            result.unwrap_err(),
            "FluxoraBridgeHost negotiated unsupported protocol version 2.0; expected 1.0."
        );
    }

    #[test]
    fn bridge_runtime_readiness_rejects_uninitialized_core() {
        let status = json!({
            "available": true,
            "initialized": false
        });
        let capabilities = json!({
            "core": {
                "available": true
            }
        });

        assert!(!bridge_runtime_is_ready(&status, &capabilities));
    }

    #[test]
    fn bridge_runtime_readiness_requires_available_core_capability() {
        let status = json!({
            "available": true,
            "initialized": true
        });
        let unavailable_capabilities = json!({
            "core": {
                "available": false
            }
        });
        let ready_capabilities = json!({
            "core": {
                "available": true
            }
        });

        assert!(!bridge_runtime_is_ready(&status, &unavailable_capabilities));
        assert!(bridge_runtime_is_ready(&status, &ready_capabilities));
    }

    #[test]
    fn writable_directory_chooser_skips_protected_candidate() {
        let root = env::temp_dir().join(format!(
            "fluxora-writable-directory-test-{}-{}",
            std::process::id(),
            now_millis()
        ));
        let blocked_parent = root.join("blocked-parent");
        let writable = root.join("app-data").join("logs");
        fs::create_dir_all(&root).expect("create test root");
        fs::write(&blocked_parent, "not a directory").expect("create blocking file");

        let selected = choose_writable_directory(&[
            blocked_parent.join("logs"),
            writable.clone(),
            root.join("temp").join("logs"),
        ]);

        assert_eq!(selected, writable);
        assert!(selected.is_dir());
        assert!(
            fs::read_dir(&selected)
                .expect("read selected directory")
                .next()
                .is_none(),
            "writability probe must clean up its temporary file"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ai_intermediate_event_validator_redacts_and_rejects_unknown_notifications() {
        let event = sanitize_ai_intermediate_event(
            &json!({
                "jsonrpc": "2.0",
                "method": "ai.intermediateEvent",
                "params": {
                    "schema": "fluxora.ai.intermediate-event.v1",
                    "eventId": "evt-1",
                    "runId": "run-1",
                    "operationId": "op-ai",
                    "seq": 2,
                    "createdAt": "2026-07-04T10:00:00.000Z",
                    "type": "site-visited",
                    "level": "warning",
                    "visibility": "user",
                    "stage": "nexus-capture",
                    "message": "Captured https://example.test?key=secret Bearer token",
                    "percent": 140,
                    "payload": {
                        "kind": "source",
                        "data": {
                            "url": "https://example.test?key=secret",
                            "count": 3,
                            "raw": { "html": "<body>secret</body>" }
                        }
                    }
                }
            }),
            "op-fallback",
        )
        .expect("canonical event should validate");

        assert_eq!(event["schema"], "fluxora.ai.intermediate-event.v1");
        assert_eq!(event["percent"], 100.0);
        let serialized = serde_json::to_string(&event).unwrap();
        assert!(!serialized.contains("key=secret"));
        assert!(!serialized.contains("Bearer token"));
        assert!(!serialized.contains("<body>"));
        assert!(serialized.contains("key=[redacted-secret]"));
        assert!(serialized.contains("Bearer [redacted-secret]"));

        assert!(sanitize_ai_intermediate_event(
            &json!({
                "jsonrpc": "2.0",
                "method": "response.output_text.delta",
                "params": {}
            }),
            "op-fallback",
        )
        .is_none());
        assert!(sanitize_ai_intermediate_event(
            &json!({
                "jsonrpc": "2.0",
                "method": "ai.intermediateEvent",
                "params": {
                    "schema": "fluxora.ai.intermediate-event.v1",
                    "eventId": "evt-provider",
                    "runId": "run-1",
                    "operationId": "op-ai",
                    "seq": 3,
                    "createdAt": "2026-07-04T10:00:01.000Z",
                    "type": "response.output_text.delta",
                    "level": "info",
                    "visibility": "user",
                    "stage": "provider",
                    "message": "raw delta"
                }
            }),
            "op-fallback",
        )
        .is_none());
    }

    #[test]
    fn extract_nxm_links_from_args_preserves_query_and_deduplicates() {
        let links = extract_nxm_links_from_args([
            "Fluxora.exe",
            "\"nxm://skyrimspecialedition/mods/3863/files/123?key=abc&expires=999\"",
            "https://www.nexusmods.com/skyrimspecialedition/mods/3863",
            "NXM://skyrimspecialedition/mods/3863/files/123?key=abc&expires=999",
            "nxm://fallout4/mods/10/files/20?key=def&expires=1000",
        ]);

        assert_eq!(
            links,
            vec![
                "nxm://skyrimspecialedition/mods/3863/files/123?key=abc&expires=999",
                "nxm://fallout4/mods/10/files/20?key=def&expires=1000"
            ]
        );
    }

    #[test]
    fn downloads_folder_watch_suppresses_only_transient_sidecars() {
        assert!(is_transient_downloads_watch_path(Path::new(
            "C:/Downloads/mod.7z.crdownload"
        )));
        assert!(is_transient_downloads_watch_path(Path::new(
            "C:/Downloads/~$lock.tmp"
        )));
        assert!(!is_transient_downloads_watch_path(Path::new(
            "C:/Downloads/mod.7z"
        )));
        assert!(!is_transient_downloads_watch_path(Path::new(
            "C:/Downloads/mod.zip"
        )));
        assert!(!is_transient_downloads_watch_path(Path::new(
            "C:/Downloads/mod.rar"
        )));
    }

    #[test]
    fn downloads_folder_batch_reason_uses_batch_for_mixed_changes() {
        let changes = vec![
            DownloadsFolderChange {
                path: "C:/Downloads/a.7z".to_string(),
                file_name: "a.7z".to_string(),
                kind: "created".to_string(),
            },
            DownloadsFolderChange {
                path: "C:/Downloads/b.7z".to_string(),
                file_name: "b.7z".to_string(),
                kind: "modified".to_string(),
            },
        ];

        assert_eq!(downloads_folder_batch_reason(&changes), "batch");
    }

    #[test]
    fn build_content_watch_roots_track_mods_active_profile_and_game_data() {
        let root = env::temp_dir().join(format!(
            "fluxora-build-content-watch-roots-{}-{}",
            std::process::id(),
            now_millis()
        ));
        let mods = root.join("mods");
        let profiles = root.join("profiles");
        let profile = profiles.join("Default");
        let game = root.join("game");
        let game_data = game.join("Data");

        fs::create_dir_all(&mods).expect("create mods");
        fs::create_dir_all(&profile).expect("create profile");
        fs::create_dir_all(&game_data).expect("create game data");

        let roots = build_content_watch_roots(&mods, &profiles, "Default", Some(&game));

        assert!(roots.iter().any(|root| root.path == mods && root.recursive));
        assert!(roots
            .iter()
            .any(|root| root.path == profile && !root.recursive));
        assert!(roots
            .iter()
            .any(|root| root.path == game_data && !root.recursive));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn build_content_watcher_errors_request_conservative_root_reconciliation() {
        let changes = build_content_reconciliation_changes(
            Path::new("C:/Build/mods"),
            Path::new("C:/Build/profiles"),
            Some(Path::new("C:/Game/Data")),
        );

        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].area, "mods");
        assert_eq!(changes[0].kind, "reconcile");
        assert_eq!(changes[0].path, "C:/Build/mods");
        assert_eq!(changes[1].area, "profile");
        assert_eq!(changes[2].area, "game");
    }

    #[test]
    fn build_content_watch_filters_sidecars_but_keeps_profile_state_files() {
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/mods/SkyUI/.fluxora-mod.json"
        )));
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/mods/SkyUI/.flow"
        )));
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/mods/SkyUI/.flow/manifest.json"
        )));
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/mods/SkyUI/.FLOW/manifest.json.tmp"
        )));
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/mods/SkyUI/SkyUI_SE.esp.tmp"
        )));
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/profiles/Default/.fbc0f04f63"
        )));
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/profiles/Default/plugins.txt.fluxora-bak"
        )));
        assert!(!is_transient_build_content_path(Path::new(
            "C:/Build/mods/SkyUI/SkyUI_SE.esp"
        )));
        assert!(!is_transient_build_content_path(Path::new(
            "C:/Build/mods/SkyUI/.flowchart/diagram.json"
        )));
        assert!(!is_transient_build_content_path(Path::new(
            "C:/Build/profiles/Default/plugins.txt"
        )));
        assert!(!is_transient_build_content_path(Path::new(
            "C:/Build/profiles/Default/modlist.txt"
        )));
    }

    #[test]
    fn build_content_watch_batch_drops_generated_manifests_without_hiding_real_changes() {
        let mods = Path::new("C:/Build/mods");
        let profiles = Path::new("C:/Build/profiles");
        let now = Instant::now();
        let generated_manifest = DebouncedEvent::new(
            notify_debouncer_full::notify::Event::new(EventKind::Modify(ModifyKind::Any))
                .add_path(mods.join("SkyUI/.flow/manifest.json")),
            now,
        );
        let real_plugin = DebouncedEvent::new(
            notify_debouncer_full::notify::Event::new(EventKind::Modify(ModifyKind::Any))
                .add_path(mods.join("SkyUI/Data/SkyUI_SE.esp")),
            now,
        );

        const NO_GAME_DATA: Option<&Path> = None;
        let mixed = build_content_changes(
            vec![generated_manifest.clone(), real_plugin],
            mods,
            profiles,
            NO_GAME_DATA,
        );
        assert_eq!(mixed.len(), 1);
        assert_eq!(mixed[0].area, "mods");
        assert_eq!(
            mixed[0].path,
            mods.join("SkyUI/Data/SkyUI_SE.esp")
                .to_string_lossy()
                .to_string()
        );

        let generated_only = build_content_changes(
            vec![generated_manifest],
            mods,
            profiles,
            NO_GAME_DATA,
        );
        assert!(generated_only.is_empty());
    }

    #[test]
    fn build_content_watcher_rejects_superseded_generation() {
        let generation = AtomicU64::new(1);
        assert!(build_content_watch_generation_is_current(&generation, 1));

        generation.store(2, Ordering::SeqCst);
        assert!(!build_content_watch_generation_is_current(&generation, 1));
        assert!(build_content_watch_generation_is_current(&generation, 2));
    }

    #[test]
    fn build_content_watcher_failed_setup_keeps_previous_generation_live() {
        let active_generation = AtomicU64::new(7);
        let requested_generation = AtomicU64::new(7);

        let candidate = reserve_build_content_watch_generation(&requested_generation);
        assert_eq!(candidate, 8);
        assert!(build_content_watch_install_is_current(
            &requested_generation,
            candidate
        ));

        // Setup failure never publishes the reserved generation, so callbacks
        // from the previously installed watcher remain current.
        assert!(build_content_watch_generation_is_current(
            &active_generation,
            7
        ));
        assert!(!build_content_watch_generation_is_current(
            &active_generation,
            candidate
        ));
    }

    #[test]
    fn build_content_watcher_only_publishes_latest_successful_reservation() {
        let active_generation = AtomicU64::new(3);
        let requested_generation = AtomicU64::new(3);
        let first = reserve_build_content_watch_generation(&requested_generation);
        let latest = reserve_build_content_watch_generation(&requested_generation);

        assert!(!build_content_watch_install_is_current(
            &requested_generation,
            first
        ));
        assert!(build_content_watch_install_is_current(
            &requested_generation,
            latest
        ));
        active_generation.store(latest, Ordering::SeqCst);
        assert!(build_content_watch_generation_is_current(
            &active_generation,
            latest
        ));
    }

    #[test]
    fn build_content_batch_reason_includes_area_for_uniform_changes() {
        let changes = vec![
            BuildContentChange {
                path: "C:/Build/mods/SkyUI".to_string(),
                file_name: "SkyUI".to_string(),
                kind: "created".to_string(),
                area: "mods".to_string(),
            },
            BuildContentChange {
                path: "C:/Build/mods/RaceMenu".to_string(),
                file_name: "RaceMenu".to_string(),
                kind: "created".to_string(),
                area: "mods".to_string(),
            },
        ];

        assert_eq!(build_content_batch_reason(&changes), "mods-created");
    }

    #[test]
    fn ai_provider_state_preserves_host_supabase_connection() {
        let providers = with_ai_provider_connection_state(json!([
            {
                "id": "gemini",
                "displayName": "Google Gemini",
                "requiresCredential": true,
                "connected": true,
                "credentialState": "connected"
            },
            {
                "id": "local-dry-run",
                "displayName": "Local dry run",
                "requiresCredential": false,
                "connected": false,
                "credentialState": "notRequired"
            }
        ]));

        assert_eq!(providers[0]["connected"], true);
        assert_eq!(providers[0]["credentialState"], "connected");
        assert_eq!(providers[1]["connected"], true);
        assert_eq!(providers[1]["credentialState"], "notRequired");
    }

    #[test]
    fn safe_external_url_allows_only_https_and_mailto_without_embedded_credentials() {
        assert_eq!(
            safe_external_url("https://www.nexusmods.com/skyrimspecialedition/mods/1").as_deref(),
            Ok("https://www.nexusmods.com/skyrimspecialedition/mods/1")
        );
        assert_eq!(
            safe_external_url("mailto:privacy@example.test").as_deref(),
            Ok("mailto:privacy@example.test")
        );
        assert_eq!(
            safe_external_url("http://example.test").unwrap_err(),
            "unsupported-protocol"
        );
        assert_eq!(
            safe_external_url("javascript:alert(1)").unwrap_err(),
            "unsupported-protocol"
        );
        assert_eq!(
            safe_external_url("https://user:pass@example.test/path").unwrap_err(),
            "embedded-credentials"
        );
        assert_eq!(
            safe_external_url("https://example.test/a b").unwrap_err(),
            "invalid-url"
        );
    }

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
    fn nexus_api_auth_header_payload_is_filtered_for_ai_host() {
        let credential = nexus_api_auth_header_from_bridge_payload(&json!({
            "isAvailable": true,
            "headerName": "apikey",
            "headerValue": "linked-key",
            "credentialKind": "api-key"
        }))
        .expect("credential");

        assert_eq!(credential["headerName"], "apikey");
        assert_eq!(credential["headerValue"], "linked-key");
        assert_eq!(credential["credentialKind"], "api-key");
        assert_eq!(credential["source"], "linked-account");
        assert!(nexus_api_auth_header_from_bridge_payload(&json!({
            "isAvailable": true,
            "headerName": "apikey",
            "headerValue": "bad\r\nkey",
            "credentialKind": "api-key"
        }))
        .is_none());
        assert!(nexus_api_auth_header_from_bridge_payload(&json!({
            "isAvailable": true,
            "headerName": "X-Unsafe",
            "headerValue": "linked-key",
            "credentialKind": "api-key"
        }))
        .is_none());
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

    #[test]
    fn operation_status_snapshot_marks_completed_progress() {
        let payload = json!({
            "operationId": "op_install",
            "phase": "install",
            "currentStep": "completed",
            "currentItem": "Example Mod",
            "overallPercent": 100,
            "statusMessage": "Done",
            "updatedAt": "123"
        });

        let snapshot = operation_status_snapshot(&payload).expect("snapshot");

        assert_eq!(snapshot["operationId"], "op_install");
        assert_eq!(snapshot["state"], "completed");
        assert_eq!(snapshot["overallPercent"], 100.0);
    }

    #[test]
    fn operation_log_entry_extracts_operation_id_and_category() {
        let entry = operation_log_entry(
            "fluxora-tauri-main-bridge-current.log",
            "[123] [INFO] [AI.Tool] [operationId=op_ai_chat_run] tool=mods.installed phase=succeeded",
        );

        assert_eq!(entry["operationId"], "op_ai_chat_run");
        assert_eq!(entry["category"], "AI.Tool");
        assert_eq!(entry["level"], "info");
    }

    #[test]
    fn bridge_queue_performance_log_is_machine_readable() {
        assert_eq!(
            bridge_lane_for_method("mods.getModDetailsContent"),
            BridgeLane::Interactive
        );
        assert_eq!(
            bridge_lane_for_method("mods.getWorkspace"),
            BridgeLane::Main
        );
        assert_eq!(
            bridge_queue_performance_message(
                "mods.getModDetailsContent",
                12_345,
                BridgeLane::Interactive
            ),
            "bridgeQueue lane=interactive method=mods.getModDetailsContent queueWaitUs=12345"
        );
    }

    #[test]
    fn nif_preview_commands_use_the_interactive_bridge_lane() {
        for method in [
            "mods.startNifPreview",
            "mods.prepareNifPreviewVariant",
            "mods.prepareNifPreviewTextures",
        ] {
            assert_eq!(bridge_lane_for_method(method), BridgeLane::Interactive);
        }
    }

    #[test]
    fn nexus_oauth_uses_the_interactive_bridge_lane() {
        assert_eq!(
            bridge_lane_for_method("nexus.connect"),
            BridgeLane::Interactive
        );
    }

    #[test]
    fn install_preflight_and_mutations_use_the_interactive_bridge_lane() {
        for method in [
            "mods.listInstalled",
            "downloads.analyzeFomod",
            "downloads.analyzeContentLayout",
            "downloads.analyzeFomodContentLayout",
            "downloads.install",
            "downloads.installFomod",
            "archives.install",
            "archives.installFomod",
        ] {
            assert_eq!(bridge_lane_for_method(method), BridgeLane::Interactive);
        }
    }

    #[test]
    fn text_editor_reads_are_not_queued_behind_background_workspace_work() {
        for method in ["mods.getFileTree", "mods.readTextFile", "textFiles.read"] {
            assert_eq!(bridge_lane_for_method(method), BridgeLane::Interactive);
        }
    }

    #[test]
    fn nif_preview_asset_public_shape_never_contains_a_native_path() {
        let prepared = json!({
            "resolvedPath": "C:/private/mods/example/meshes/example.nif",
            "kind": "nif",
            "relativePath": "meshes/example.nif",
            "fileName": "example.nif",
            "size": 4096,
            "mimeType": "application/x-nif",
            "source": "Example Mod",
            "contentKey": "model-fingerprint"
        });

        let public = nif_preview_public_asset("asset-token", &prepared).expect("public handle");

        assert_eq!(public["assetId"], "asset-token");
        assert!(public.get("resolvedPath").is_none());
        assert!(public.get("fileName").is_none());
        assert!(public.get("kind").is_none());
    }

    #[test]
    fn nif_preview_session_limits_and_idle_expiration_are_enforced() {
        let state = NifPreviewSessionState::default();
        let mut session = NifPreviewSession {
            window_label: "file-preview:test".to_string(),
            project_directory: "C:/Build".to_string(),
            profile_name: "Default".to_string(),
            operation_id: "op_preview".to_string(),
            variants: Vec::new(),
            active_index: 0,
            assets: HashMap::new(),
            total_bytes: 0,
            last_access_ms: now_millis(),
        };
        for index in 0..4 {
            let prepared = json!({
                "resolvedPath": format!("C:/Build/cache/{index}.dds"),
                "size": NIF_PREVIEW_MAX_ASSET_BYTES,
                "mimeType": "image/vnd-ms.dds",
                "relativePath": format!("textures/{index}.dds"),
                "source": "Test",
                "contentKey": format!("texture-{index}")
            });
            register_nif_preview_assets(&state, &mut session, &[prepared]).expect("within limit");
        }
        let overflow = json!({
            "resolvedPath": "C:/Build/cache/overflow.dds",
            "size": 1,
            "mimeType": "image/vnd-ms.dds",
            "relativePath": "textures/overflow.dds",
            "source": "Test",
            "contentKey": "texture-overflow"
        });

        assert!(register_nif_preview_assets(&state, &mut session, &[overflow]).is_err());
        assert_eq!(session.total_bytes, NIF_PREVIEW_MAX_SESSION_BYTES);

        session.last_access_ms = now_millis().saturating_sub(NIF_PREVIEW_IDLE_TIMEOUT_MS + 1);
        let mut sessions = HashMap::from([("session".to_string(), session)]);
        assert_eq!(purge_expired_nif_preview_sessions(&mut sessions, now_millis()), 1);
        assert!(sessions.is_empty());
    }

    #[test]
    fn nif_preview_session_tokens_are_owned_by_the_creating_window() {
        let session = NifPreviewSession {
            window_label: "file-preview:owner".to_string(),
            project_directory: "C:/Build".to_string(),
            profile_name: "Default".to_string(),
            operation_id: "op_preview".to_string(),
            variants: Vec::new(),
            active_index: 0,
            assets: HashMap::new(),
            total_bytes: 0,
            last_access_ms: now_millis(),
        };

        assert!(ensure_nif_preview_window(&session, "file-preview:owner").is_ok());
        assert_eq!(
            ensure_nif_preview_window(&session, "main").unwrap_err(),
            "NIF preview session belongs to another window."
        );
    }

    #[test]
    fn file_preview_window_url_carries_project_directory_without_catalog_lookup() {
        let url = file_preview_window_url(
            "C:\\Users\\Tester\\AppData\\Roaming\\Fluxora\\Builds\\Foundation Edition.json",
            "E:\\Fluxora Builds\\Foundation Edition",
            "E:\\Fluxora Builds\\Foundation Edition\\mods\\PGPatcher Output",
            "meshes/traps/pressureplate/trapstonepressureplate01.nif",
            "trapstonepressureplate01.nif",
            "Default",
            "nif",
        );

        assert!(url.contains("&directory=E%3A%5CFluxora%20Builds%5CFoundation%20Edition&mod="));
        assert!(url.contains("&path=meshes%2Ftraps%2Fpressureplate%2Ftrapstonepressureplate01.nif"));
    }

    #[test]
    fn text_editor_window_url_carries_project_directory_without_catalog_lookup() {
        let url = text_editor_window_url(
            "C:\\Users\\Tester\\AppData\\Roaming\\Fluxora\\Builds\\Foundation Edition.json",
            "E:\\Fluxora Builds\\Foundation Edition",
            "E:\\Fluxora Builds\\Foundation Edition\\mods\\SSE Display Tweaks",
            "SKSE/Plugins/SSEDisplayTweaks.ini",
            "SSEDisplayTweaks.ini",
        );

        assert!(url.contains("window=text-editor"));
        assert!(url.contains("&directory=E%3A%5CFluxora%20Builds%5CFoundation%20Edition&mod="));
        assert!(url.contains("&path=SKSE%2FPlugins%2FSSEDisplayTweaks.ini"));
    }

    #[test]
    fn interactive_bridge_lane_does_not_wait_for_the_main_lane_lock() {
        tauri::async_runtime::block_on(async {
            let state = BridgeState::default();
            let _main_lane = state.process.lock().await;
            let interactive_lane =
                timeout(Duration::from_millis(50), state.interactive_process.lock()).await;

            assert!(interactive_lane.is_ok());
        });
    }

    #[cfg(windows)]
    #[test]
    fn fluxora_data_dir_uses_shared_appdata_catalog_root_on_windows() {
        let _env_lock = ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let root = env::temp_dir().join(format!("fluxora-tauri-test-{}", now_millis()));
        let app_data = root.join("Roaming");
        let user_profile = root.join("Profile");
        let _app_data_guard = EnvVarGuard::set("APPDATA", &app_data);
        let _user_profile_guard = EnvVarGuard::set("USERPROFILE", &user_profile);

        let data_dir = fluxora_data_dir();

        assert_eq!(data_dir, app_data.join("Fluxora"));
        assert_eq!(
            data_dir.join("Builds"),
            app_data.join("Fluxora").join("Builds")
        );
    }
}
