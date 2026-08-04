use keyring::Entry;
use notify_debouncer_full::{
    new_debouncer, new_debouncer_opt,
    notify::{
        event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
        Config, EventKind, RecommendedWatcher, RecursiveMode,
    },
    DebounceEventResult, DebouncedEvent, Debouncer, NoCache, RecommendedCache,
};
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
#[cfg(windows)]
use std::ffi::OsStr;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering},
    Arc, OnceLock,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{
    ipc::Response, AppHandle, Emitter, Manager, UserAttentionType, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

mod ai_capability_adapters;
#[allow(dead_code)]
#[path = "bin/fluxora_ai_host/tool_contract.rs"]
mod ai_tool_contract;
mod microphone_permission;
#[allow(dead_code)]
mod moddingflow_activation;
#[allow(dead_code)]
mod moddingflow_activation_confirmation;
mod moddingflow_activation_runtime;
mod moddingflow_connection_facade;
#[allow(dead_code)]
mod moddingflow_oauth;
#[allow(dead_code)]
mod oauth_loopback;
mod speech;
mod update_manifest;
mod update_service;
mod update_shared;

use ai_capability_adapters::{
    find_download_can_install, find_download_state, find_mod_enabled, find_plugin_order,
    is_capability_tool, is_read_only_capability_tool, sanitize_downloads, sanitize_install,
    sanitize_installs, sanitize_mod_workspace, sanitize_plugins, AiEntityKind, AiEntityRefRegistry,
};
use ai_tool_contract::{tool_contract, ToolDomain, ToolOperation, ToolRisk};
use microphone_permission::{
    configure_main_webview, fluxora_ai_arm_microphone_capture,
    fluxora_ai_reset_microphone_permission, MicrophonePermissionState,
};
use moddingflow_activation::FluxoraActivationSource;
use moddingflow_activation_confirmation::{
    fluxora_moddingflow_accept_activation, fluxora_moddingflow_dismiss_activation,
    fluxora_moddingflow_preview_activation, fluxora_moddingflow_preview_activation_plan,
    MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED,
};
use moddingflow_activation_runtime::{
    fluxora_moddingflow_consume_activations, ModdingFlowActivationRuntimeState,
    MODDINGFLOW_ACTIVATION_CAPTURED_EVENT, MODDINGFLOW_ACTIVATION_FEATURE_ENABLED,
};
use moddingflow_connection_facade::{
    fluxora_moddingflow_cancel_connect, fluxora_moddingflow_connect,
    fluxora_moddingflow_connection_status, fluxora_moddingflow_disconnect,
    fluxora_moddingflow_restore_connection, ModdingFlowConnectionRuntimeState,
};
use speech::{
    fluxora_ai_cancel_voice_transcription, fluxora_ai_open_microphone_privacy_settings,
    fluxora_ai_prepare_voice, fluxora_ai_transcribe_voice, SpeechHostState,
};
use update_service::{
    app_update_window_close_is_blocked, fluxora_updates_cancel, fluxora_updates_check,
    fluxora_updates_dismiss_installer, fluxora_updates_download_and_install,
    fluxora_updates_get_status, fluxora_updates_installer_window_ready,
    fluxora_updates_open_installer, fluxora_updates_renderer_ready, UpdateRuntimeState,
    APP_UPDATE_WINDOW_LABEL,
};

const BRIDGE_PROTOCOL_VERSION: &str = "1.0";
const BRIDGE_TIMEOUT_MS: u64 = 10_000;
const BRIDGE_INVOKE_ERROR_SCHEMA: &str = "fluxora.tauri.bridge-error.v1";
const SETTINGS_LANGUAGE_CHANGED_EVENT: &str = "fluxora:settings:language-changed";
const AI_HOST_PROTOCOL_VERSION: &str = "1.0";
const AI_HOST_TIMEOUT_MS: u64 = 5_000;
const AI_HOST_LONG_RUNNING_TIMEOUT_MS: u64 = 10 * 60 * 1_000 + 30_000;
const PRIVATE_NEXUS_API_AUTH_HEADER_METHOD: &str = "nexus.getApiAuthHeader";
const PRIVATE_MODDINGFLOW_NATIVE_METHODS: [&str; 7] = [
    "connections.beginConnect",
    "connections.completeConnect",
    "connections.cancelPendingConnect",
    "moddingflow.getManagedAiAccessToken",
    "moddingflow.lookupArtifactPreview",
    "moddingflow.previewActivationPlan",
    "downloads.queueModdingFlowArtifact",
];
const PRIVATE_AI_NEXUS_CREDENTIAL_FIELD: &str = "nativeNexusApiCredential";
const PRIVATE_MANAGED_AI_ACCESS_TOKEN_FIELD: &str = "managedAiAccessToken";
const AI_CREDENTIAL_SERVICE: &str = "app.fluxora.desktop.ai.provider";
const PROGRESS_EVENT: &str = "fluxora:operations:progress";
const INSTALL_PROGRESS_EVENT: &str = "fluxora:installs:progress";
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
const DOWNLOADS_CHANGED_EVENT: &str = "fluxora:downloads:changed";
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
const DOWNLOADS_FOLDER_WATCH_DEBOUNCE_MS: u64 = 100;
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

struct BridgeState {
    process: Mutex<BridgeProcess>,
    plugin_process: Mutex<BridgeProcess>,
    interactive_process: Mutex<BridgeProcess>,
    background_process: Mutex<BridgeProcess>,
    connection_process: Mutex<BridgeProcess>,
    download_process: Mutex<BridgeProcess>,
    install_process: Mutex<BridgeProcess>,
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

struct BridgeProcess {
    lane: BridgeLane,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pending_responses: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    reader_task: Option<JoinHandle<()>>,
    host_path: Option<PathBuf>,
    handshake: Option<Value>,
}

struct AiHostState {
    process: Mutex<AiHostProcess>,
    active_process_id: Arc<AtomicU32>,
    active_operations: Mutex<HashSet<String>>,
    cancelled_operations: Mutex<HashSet<String>>,
}

#[derive(Default)]
struct AiDirtyEditorState {
    refs: Mutex<HashSet<String>>,
}

#[derive(Clone)]
enum AiCompensationVerification {
    ModEnabled {
        project_directory: String,
        profile_name: String,
        native_id: String,
        expected: bool,
    },
    ModAbsent {
        project_directory: String,
        profile_name: String,
        native_id: String,
    },
    PluginOrder {
        project_directory: String,
        template_id: String,
        profile_name: String,
        native_id: String,
        expected: u64,
    },
    DownloadStateChanged {
        project_directory: String,
        native_id: String,
        previous_state: String,
    },
    ProfileAbsent {
        project_directory: String,
        default_profile_name: String,
        profile_name: String,
    },
    Language {
        expected: String,
    },
}

#[derive(Clone)]
struct AiCompensationAction {
    method: String,
    params: Value,
    verification: AiCompensationVerification,
}

#[derive(Default)]
struct AiCompensationState {
    actions: Mutex<HashMap<String, AiCompensationAction>>,
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
            active_operations: Mutex::new(HashSet::new()),
            cancelled_operations: Mutex::new(HashSet::new()),
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
            features.insert(
                "moddingFlowActivation".to_string(),
                json!({
                    "state": if MODDINGFLOW_ACTIVATION_FEATURE_ENABLED
                        && MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED
                    {
                        "available"
                    } else {
                        "disabled"
                    },
                    "platforms": ["win32", "linux", "darwin"],
                    "requires": ["trusted-metadata", "confirmation-ui", "protocol-registration"],
                    "supports": ["command-line-capture", "single-instance-capture"],
                    "reason": if MODDINGFLOW_ACTIVATION_FEATURE_ENABLED
                        && MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED
                    {
                        Value::Null
                    } else {
                        json!("Rollout remains disabled until trusted metadata and confirmation are complete.")
                    }
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
    let is_compact_atomic_backup = lower.strip_prefix(".fb").is_some_and(|token| {
        token.len() == 8 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
    });
    if matches!(lower.as_str(), ".ds_store" | "thumbs.db" | "desktop.ini")
        || is_compact_atomic_backup
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

fn is_transient_install_work_component(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    [
        ".fomod-package",
        ".installing",
        ".merging",
        ".replacing",
        ".root",
    ]
    .iter()
    .any(|marker| {
        lower.rfind(marker).is_some_and(|marker_position| {
            let continuation = &lower[marker_position + marker.len()..];
            // Content-layout normalization writes through a generated
            // "<install-work-directory>.layout[-N]" sibling.
            continuation.is_empty()
                || continuation == ".layout"
                || continuation.strip_prefix(".layout-").is_some_and(|suffix| {
                    !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
                })
        })
    })
}

fn is_transient_build_content_path(path: &Path) -> bool {
    if path.components().any(|component| {
        component.as_os_str().to_str().is_some_and(|value| {
            value.eq_ignore_ascii_case(".flow") || is_transient_install_work_component(value)
        })
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
    let is_compact_atomic_backup = lower.strip_prefix(".fb").is_some_and(|token| {
        token.len() == 8 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
    });
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
    let mut roots = vec![(mods_directory, "mods"), (profiles_directory, "profile")];
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
    revision: &Arc<Mutex<String>>,
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
                reason: reason.clone(),
                changes,
            };
            let _ = app.emit_to(MAIN_WINDOW_LABEL, DOWNLOADS_FOLDER_CHANGED_EVENT, payload);

            let app = app.clone();
            let project_directory = project_directory.to_string();
            let reason = reason.to_string();
            let revision = revision.clone();
            tauri::async_runtime::spawn(async move {
                let mut current_revision = revision.lock().await;
                let operation_id = format!("op_{}_downloads_changed_{sequence}", now_millis());
                let request = OperationRequest {
                    operation_id: Some(operation_id),
                };
                let delta = fluxora_bridge_request(
                    app.clone(),
                    "downloads.getDelta".to_string(),
                    json!({
                        "projectDirectory": project_directory,
                        "sinceRevision": current_revision.as_str(),
                        "reason": reason,
                    }),
                    Some(request),
                    None,
                )
                .await;
                match delta {
                    Ok(delta) => {
                        if let Some(next_revision) = delta.get("revision").and_then(Value::as_str) {
                            *current_revision = next_revision.to_string();
                        }
                        let _ = app.emit_to(MAIN_WINDOW_LABEL, DOWNLOADS_CHANGED_EVENT, delta);
                    }
                    Err(error) => {
                        drop(current_revision);
                        let _ = write_log(
                            &app,
                            "main",
                            "warning",
                            "DownloadsFolderWatcher",
                            &format!("Failed to capture downloads delta. reason={error}"),
                            None,
                        )
                        .await;
                    }
                }
            });
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ActivationFocusPolicy {
    Preserve,
    Request,
}

fn should_request_activation_window_focus(
    window_is_focused: Option<bool>,
    policy: ActivationFocusPolicy,
) -> bool {
    policy == ActivationFocusPolicy::Request && window_is_focused == Some(false)
}

fn present_activation_window<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    unminimize: bool,
    focus_policy: ActivationFocusPolicy,
) {
    let focus_state = window.is_focused().ok();

    if unminimize {
        let _ = window.unminimize();
    }
    let _ = window.show();
    if should_request_activation_window_focus(focus_state, focus_policy) {
        let _ = window.set_focus();
    } else if focus_policy == ActivationFocusPolicy::Preserve && focus_state != Some(true) {
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    }
}

fn show_activation_window<R: tauri::Runtime>(window: &WebviewWindow<R>, unminimize: bool) {
    present_activation_window(window, unminimize, ActivationFocusPolicy::Request);
}

fn show_background_activation_window<R: tauri::Runtime>(window: &WebviewWindow<R>) {
    present_activation_window(window, true, ActivationFocusPolicy::Preserve);
}

fn handle_nxm_activation_args(app: AppHandle, args: Vec<String>, source: &'static str) {
    let links = extract_nxm_links_from_args(args);
    if links.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        show_background_activation_window(&window);
    }

    tauri::async_runtime::spawn(async move {
        queue_inbound_nxm_links(app, links, source).await;
    });
}

fn handle_runtime_activation_args(
    app: AppHandle,
    args: Vec<String>,
    source: FluxoraActivationSource,
) {
    let source_name = match source {
        FluxoraActivationSource::Startup => "startup",
        FluxoraActivationSource::DeepLink => "deep-link",
        FluxoraActivationSource::SecondInstance => "second-instance",
    };
    handle_nxm_activation_args(app.clone(), args.clone(), source_name);

    let state = app.state::<ModdingFlowActivationRuntimeState>();
    let report = state.capture_args(args, source, |activation| {
        app.emit_to(
            MAIN_WINDOW_LABEL,
            MODDINGFLOW_ACTIVATION_CAPTURED_EVENT,
            activation,
        )
        .is_ok()
    });
    if report.disabled {
        return;
    }
    let activity_count =
        report.queued + report.duplicates + report.rejected + report.full + report.delivered;
    if activity_count == 0 {
        return;
    }
    let log_app = app.clone();
    let report_message = moddingflow_activation_report_message(source_name, report);
    tauri::async_runtime::spawn(async move {
        let _ = write_log(
            &log_app,
            "main",
            if report.rejected + report.full > 0 {
                "warning"
            } else {
                "info"
            },
            "ModdingFlowActivation",
            &report_message,
            None,
        )
        .await;
    });
    if report.queued + report.duplicates + report.delivered == 0 {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        show_background_activation_window(&window);
    }
}

fn moddingflow_activation_report_message(
    source: &str,
    report: moddingflow_activation_runtime::ActivationRouteReport,
) -> String {
    format!(
        "Activation routing completed. source={} queued={} duplicates={} rejected={} full={} delivered={}",
        source,
        report.queued,
        report.duplicates,
        report.rejected,
        report.full,
        report.delivered
    )
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

    let queue_started_at = Instant::now();
    let (result, queue_wait_us) = {
        let state = bridge_state(&app);
        let mut bridge = state.process(BridgeLane::Download).lock().await;
        let queue_wait_us = queue_started_at.elapsed().as_micros();
        let result = bridge
            .request(&app, "nxm.captureLinks", params, request, BRIDGE_TIMEOUT_MS)
            .await;
        (result, queue_wait_us)
    };
    let queue_message =
        bridge_queue_performance_message("nxm.captureLinks", queue_wait_us, BridgeLane::Download);
    let _ = write_log(
        &app,
        "main-bridge",
        "info",
        "Performance",
        &queue_message,
        Some(&operation_id),
    )
    .await;

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

#[cfg(windows)]
fn windows_drive_root(value: &OsStr) -> Option<PathBuf> {
    let raw = value.to_string_lossy();
    let mut characters = raw.trim().chars();
    let drive_letter = characters.next()?;
    if !drive_letter.is_ascii_alphabetic() || characters.next()? != ':' {
        return None;
    }

    Some(PathBuf::from(format!("{}:\\", drive_letter.to_ascii_uppercase())))
}

fn default_install_root_directory(data_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let _ = data_dir;
        let system_drive = std::env::var_os("SystemDrive")
            .as_deref()
            .and_then(windows_drive_root)
            .or_else(|| {
                std::env::var_os("SystemRoot")
                    .as_deref()
                    .and_then(windows_drive_root)
            })
            .unwrap_or_else(|| PathBuf::from(r"C:\"));
        return system_drive.join("Fluxora Builds");
    }

    #[cfg(not(windows))]
    {
        data_dir.join("Projects")
    }
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

fn redact_named_query_value(value: &str, key: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;
    let needle = format!("{key}=");

    while let Some(index) = rest.to_ascii_lowercase().find(&needle) {
        output.push_str(&rest[..index]);
        output.push_str(&format!("{key}=[redacted-secret]"));
        let after_key = &rest[index + needle.len()..];
        let end = after_key
            .find(|character: char| {
                character == '&'
                    || character.is_whitespace()
                    || matches!(character, '"' | '\'' | ')' | ']' | '#')
            })
            .unwrap_or(after_key.len());
        rest = &after_key[end..];
    }

    output.push_str(rest);
    output
}

fn redact_query_secrets(value: &str) -> String {
    [
        "x-amz-security-token",
        "x-amz-signature",
        "access_token",
        "refresh_token",
        "id_token",
        "authorization_code",
        "code_verifier",
        "code_challenge",
        "signed_url",
        "signature",
        "nonce",
        "state",
        "code",
        "key",
    ]
    .into_iter()
    .fold(value.to_string(), |current, key| {
        redact_named_query_value(&current, key)
    })
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
                "access_token",
                "refresh_token",
                "id_token",
                "authorization_code",
                "code_verifier",
                "code_challenge",
                "signed_url",
                "signature",
                "nonce",
                "state",
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

fn redact_personal_identifiers(value: &str) -> String {
    static EMAIL_PATTERN: OnceLock<Regex> = OnceLock::new();
    static UUID_PATTERN: OnceLock<Regex> = OnceLock::new();
    let email_pattern = EMAIL_PATTERN.get_or_init(|| {
        Regex::new(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
            .expect("static email redaction pattern")
    });
    let uuid_pattern = UUID_PATTERN.get_or_init(|| {
        Regex::new(
            r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}",
        )
        .expect("static UUID redaction pattern")
    });
    let value = email_pattern.replace_all(value, "[redacted-email]");
    uuid_pattern
        .replace_all(value.as_ref(), "[redacted-uuid]")
        .into_owned()
}

fn sanitize_log(value: &str) -> String {
    let value = value.replace(['\r', '\n'], " ");
    let value = redact_query_secrets(&value);
    let value = redact_bearer_tokens(&value);
    let value = redact_named_secret_assignments(&value);
    redact_personal_identifiers(&value).trim().to_string()
}

fn sanitize_log_operation_id(value: &str) -> String {
    if !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        value.to_string()
    } else {
        "[invalid-operation-id]".to_string()
    }
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
            | "tool-blocked"
            | "recovery-started"
            | "verification-completed"
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
        .map(|value| format!(" [operationId={}]", sanitize_log_operation_id(value)))
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
        "fluxora_ai_host.exe"
    } else {
        "fluxora_ai_host"
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

fn fluxora_app_root() -> Result<PathBuf, String> {
    #[cfg(feature = "native-ai-integration-fixture")]
    if let Some(path) = std::env::var_os("FLUXORA_APP_ROOT") {
        return Ok(PathBuf::from(path));
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("Fluxora executable path is unavailable: {error}"))?;
    executable
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Fluxora executable directory is unavailable.".to_string())
}

impl BridgeProcess {
    fn for_lane(lane: BridgeLane) -> Self {
        Self {
            lane,
            child: None,
            stdin: None,
            pending_responses: Arc::new(Mutex::new(HashMap::new())),
            reader_task: None,
            host_path: None,
            handshake: None,
        }
    }

    async fn reset(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
        if let Some(reader_task) = self.reader_task.take() {
            reader_task.abort();
        }
        self.pending_responses.lock().await.clear();
        self.stdin = None;
        self.handshake = None;
    }

    fn is_running(&self) -> bool {
        self.child.is_some()
    }

    async fn ensure_started(&mut self, app: &AppHandle) -> Result<(), String> {
        if self.child.is_some()
            && self.stdin.is_some()
            && self
                .reader_task
                .as_ref()
                .is_some_and(|reader_task| !reader_task.is_finished())
        {
            return Ok(());
        }
        if self.child.is_some() || self.stdin.is_some() || self.reader_task.is_some() {
            self.reset().await;
        }

        let host_path = resolve_host_path(app).await?;
        let app_root = fluxora_app_root()?;
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
            .env("FLUXORA_APP_ROOT", &app_root)
            .env("FLUXORA_BRIDGE_LANE", self.lane.label())
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
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Bridge host stdout is unavailable.".to_string())?;
        let pending_responses = Arc::clone(&self.pending_responses);
        let reader_app = app.clone();
        self.reader_task = Some(tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                let bytes = match reader.read_line(&mut line).await {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        let _ = write_log(
                            &reader_app,
                            "main-bridge",
                            "error",
                            "BridgeReader",
                            &format!("Bridge stdout reader failed: {error}"),
                            None,
                        )
                        .await;
                        break;
                    }
                };
                if bytes == 0 {
                    break;
                }

                let envelope: Value = match serde_json::from_str(line.trim()) {
                    Ok(envelope) => envelope,
                    Err(error) => {
                        let _ = write_log(
                            &reader_app,
                            "main-bridge",
                            "warning",
                            "BridgeReader",
                            &format!(
                                "Ignored non-JSON bridge stdout: {}",
                                sanitize_log(&error.to_string())
                            ),
                            None,
                        )
                        .await;
                        continue;
                    }
                };

                match envelope.get("method").and_then(Value::as_str) {
                    Some("operations.progress") => {
                        let payload = operation_progress_payload(&envelope);
                        record_operation_progress(&reader_app, &payload).await;
                        let _ = reader_app.emit(PROGRESS_EVENT, payload);
                        continue;
                    }
                    Some("installs.progress") => {
                        let payload = envelope.get("params").cloned().unwrap_or(Value::Null);
                        let _ = reader_app.emit(INSTALL_PROGRESS_EVENT, payload);
                        continue;
                    }
                    _ => {}
                }

                if let Some(request_id) = envelope.get("id").and_then(Value::as_str) {
                    if let Some(sender) = pending_responses.lock().await.remove(request_id) {
                        let _ = sender.send(envelope);
                    }
                }
            }
            pending_responses.lock().await.clear();
        }));
        self.child = Some(child);
        self.host_path = Some(host_path);
        self.handshake = None;

        let _ = write_log(
            app,
            "main-bridge",
            "info",
            "BridgeHost",
            &format!(
                "Started FluxoraBridgeHost with hostPath={} FLUXORA_LOG_DIR={} FLUXORA_APP_ROOT={}",
                host_path_for_log,
                native_log_dir.to_string_lossy(),
                app_root.to_string_lossy()
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
        let _update_drain_permit =
            update_service::enter_bridge_request(method).map_err(str::to_string)?;
        self.request_admitted(app, method, params, request, timeout_ms)
            .await
    }

    async fn request_for_update(
        &mut self,
        app: &AppHandle,
        method: &str,
        params: Value,
        request: OperationRequest,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        let _update_drain_permit =
            update_service::enter_update_drain_request().map_err(str::to_string)?;
        self.request_admitted(app, method, params, request, timeout_ms)
            .await
    }

    async fn request_admitted(
        &mut self,
        app: &AppHandle,
        method: &str,
        params: Value,
        request: OperationRequest,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        update_service::observe_project_directory(&params);
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
                "appVersion": env!("CARGO_PKG_VERSION"),
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

        let (response_sender, response_receiver) = oneshot::channel();
        self.pending_responses
            .lock()
            .await
            .insert(request_id.clone(), response_sender);
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

        let envelope = match timeout(Duration::from_millis(timeout_ms), response_receiver).await {
            Ok(Ok(envelope)) => envelope,
            Ok(Err(_)) => {
                self.reset().await;
                return Err("Bridge host exited before replying.".to_string());
            }
            Err(_) => {
                self.pending_responses.lock().await.remove(&request_id);
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
        Ok(result.get("data").cloned().unwrap_or(Value::Null))
    }

    async fn shutdown(&mut self, app: &AppHandle, request: OperationRequest) -> Result<(), String> {
        self.shutdown_with_admission(app, request, false).await
    }

    async fn shutdown_for_update(
        &mut self,
        app: &AppHandle,
        request: OperationRequest,
    ) -> Result<(), String> {
        self.shutdown_with_admission(app, request, true).await
    }

    async fn shutdown_with_admission(
        &mut self,
        app: &AppHandle,
        request: OperationRequest,
        update_drain: bool,
    ) -> Result<(), String> {
        if self.child.is_none() {
            return Ok(());
        }
        if update_drain {
            self.request_for_update(
                app,
                "system.shutdown",
                json!({}),
                request,
                BRIDGE_TIMEOUT_MS,
            )
            .await?;
        } else {
            self.request(
                app,
                "system.shutdown",
                json!({}),
                request,
                BRIDGE_TIMEOUT_MS,
            )
            .await?;
        }
        self.stdin = None;
        let mut child = self
            .child
            .take()
            .ok_or_else(|| "Bridge host process disappeared during shutdown.".to_string())?;
        match tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
            Ok(Ok(_)) => {
                if let Some(reader_task) = self.reader_task.take() {
                    reader_task.abort();
                }
                self.pending_responses.lock().await.clear();
                self.handshake = None;
                Ok(())
            }
            Ok(Err(error)) => {
                self.child = Some(child);
                Err(error.to_string())
            }
            Err(_) => {
                self.child = Some(child);
                Err("Bridge host did not exit after acknowledging shutdown.".to_string())
            }
        }
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

    fn is_running(&self) -> bool {
        self.child.is_some()
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
        let _update_drain_permit =
            update_service::enter_host_request(method).map_err(str::to_string)?;
        self.request_admitted(app, method, params, request, timeout_ms)
            .await
    }

    async fn request_for_update(
        &mut self,
        app: &AppHandle,
        method: &str,
        params: Value,
        request: OperationRequest,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        let _update_drain_permit =
            update_service::enter_update_drain_request().map_err(str::to_string)?;
        self.request_admitted(app, method, params, request, timeout_ms)
            .await
    }

    async fn request_admitted(
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

        let operation_id = operation_id(Some(&request), method);
        let managed_request = ai_host_requires_managed_credential(method)
            && !ai_credential_available("gemini");
        let first_params = if managed_request {
            match with_managed_ai_access_token(app, params.clone(), &operation_id, false).await {
                Ok(params) => params,
                Err(_) if method == "system.health" => params.clone(),
                Err(error) => return Err(error),
            }
        } else {
            params.clone()
        };
        let first = self
            .send_request(app, method, first_params, request.clone(), timeout_ms)
            .await;
        if !managed_request
            || !first
                .as_ref()
                .err()
                .is_some_and(|error| should_retry_managed_ai_oauth(error, 0))
        {
            return first;
        }

        let retry_params =
            with_managed_ai_access_token(app, params, &operation_id, true).await?;
        self.send_request(app, method, retry_params, request, timeout_ms)
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
                "appVersion": env!("CARGO_PKG_VERSION"),
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
                    #[cfg(feature = "native-ai-integration-fixture")]
                    record_native_ai_fixture_event(&event);
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
                return Err(serde_json::to_string(error).unwrap_or(message));
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
        self.shutdown_with_admission(app, request, false).await
    }

    async fn shutdown_for_update(
        &mut self,
        app: &AppHandle,
        request: OperationRequest,
    ) -> Result<(), String> {
        self.shutdown_with_admission(app, request, true).await
    }

    async fn shutdown_with_admission(
        &mut self,
        app: &AppHandle,
        request: OperationRequest,
        update_drain: bool,
    ) -> Result<(), String> {
        if self.child.is_none() {
            return Ok(());
        }
        if update_drain {
            self.request_for_update(
                app,
                "system.shutdown",
                json!({}),
                request,
                AI_HOST_TIMEOUT_MS,
            )
            .await?;
        } else {
            self.request(
                app,
                "system.shutdown",
                json!({}),
                request,
                AI_HOST_TIMEOUT_MS,
            )
            .await?;
        }
        self.stdin = None;
        self.stdout = None;
        let mut child = self
            .child
            .take()
            .ok_or_else(|| "AI host process disappeared during shutdown.".to_string())?;
        match tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
            Ok(Ok(_)) => {
                self.handshake = None;
                self.active_process_id.store(0, Ordering::SeqCst);
                Ok(())
            }
            Ok(Err(error)) => {
                self.child = Some(child);
                Err(error.to_string())
            }
            Err(_) => {
                self.child = Some(child);
                Err("AI host did not exit after acknowledging shutdown.".to_string())
            }
        }
    }
}

fn bridge_state(app: &AppHandle) -> tauri::State<'_, BridgeState> {
    app.state::<BridgeState>()
}

fn ai_host_state(app: &AppHandle) -> tauri::State<'_, AiHostState> {
    app.state::<AiHostState>()
}

async fn register_ai_operation(app: &AppHandle, operation_id: &str) {
    let state = ai_host_state(app);
    state.cancelled_operations.lock().await.remove(operation_id);
    state
        .active_operations
        .lock()
        .await
        .insert(operation_id.to_string());
}

async fn ai_operation_cancelled(app: &AppHandle, operation_id: &str) -> bool {
    ai_host_state(app)
        .cancelled_operations
        .lock()
        .await
        .contains(operation_id)
}

async fn finish_ai_operation(app: &AppHandle, operation_id: &str) {
    let state = ai_host_state(app);
    state.active_operations.lock().await.remove(operation_id);
    state.cancelled_operations.lock().await.remove(operation_id);
}

fn ai_cancelled_error_payload() -> Value {
    json!({
        "code": "ai.run.cancelled",
        "category": "cancelled",
        "stage": "tool-loop",
        "retryable": false,
        "userMessage": "The AI request was stopped.",
        "debugId": format!("shell-{}", now_millis())
    })
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

fn ai_host_requires_managed_credential(method: &str) -> bool {
    matches!(
        method,
        "system.health"
            | "providers.test"
            | "chat.respond"
            | "chat.beginToolRun"
            | "chat.continueToolRun"
            | "chat.estimateContext"
    )
}

fn ai_host_error_has_code(error: &str, code: &str) -> bool {
    serde_json::from_str::<Value>(error)
        .ok()
        .and_then(|payload| payload.get("code").and_then(Value::as_str).map(str::to_string))
        .as_deref()
        == Some(code)
}

fn should_retry_managed_ai_oauth(error: &str, completed_retries: u8) -> bool {
    completed_retries == 0 && ai_host_error_has_code(error, "ai.oauth.refresh-required")
}

fn managed_ai_native_error(error: &str) -> String {
    let temporary = error.contains("temporarilyUnavailable")
        || error.contains("temporarily-unavailable")
        || error.contains("timed out");
    serde_json::to_string(&json!({
        "code": if temporary { "ai.managed.accounting-unavailable" } else { "ai.managed.connection-required" },
        "category": if temporary { "gateway" } else { "provider-credential" },
        "stage": "session-start",
        "retryable": temporary,
        "userMessage": if temporary {
            "Managed Fluxora AI is temporarily unavailable. Try again shortly."
        } else {
            "Connect ModdingFlow again to use managed Fluxora AI."
        },
        "debugId": format!("shell-{}", now_millis())
    }))
    .unwrap_or_else(|_| "Managed AI credential request failed.".to_string())
}

async fn with_managed_ai_access_token(
    app: &AppHandle,
    mut params: Value,
    operation_id: &str,
    force_refresh: bool,
) -> Result<Value, String> {
    if ai_credential_available("gemini") {
        if let Some(object) = params.as_object_mut() {
            object.remove(PRIVATE_MANAGED_AI_ACCESS_TOKEN_FIELD);
        }
        return Ok(params);
    }

    #[cfg(feature = "native-ai-integration-fixture")]
    let token_result = std::env::var("FLUXORA_AI_TEST_MANAGED_ACCESS_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|access_token| json!({ "accessToken": access_token, "scope": "agent:run" }));
    #[cfg(not(feature = "native-ai-integration-fixture"))]
    let token_result: Option<Value> = None;

    let token_result = match token_result {
        Some(value) => value,
        None => trusted_moddingflow_bridge_request(
            app,
            "moddingflow.getManagedAiAccessToken",
            json!({ "forceRefresh": force_refresh }),
            operation_id,
            BRIDGE_TIMEOUT_MS,
        )
        .await
        .map_err(|error| managed_ai_native_error(&error))?,
    };
    if token_result.get("scope").and_then(Value::as_str) != Some("agent:run") {
        return Err(managed_ai_native_error("missing agent:run scope"));
    }
    let access_token = token_result
        .get("accessToken")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| managed_ai_native_error("missing managed AI access token"))?;
    let object = params
        .as_object_mut()
        .ok_or_else(|| managed_ai_native_error("invalid AI host params"))?;
    object.insert(
        PRIVATE_MANAGED_AI_ACCESS_TOKEN_FIELD.to_string(),
        json!(access_token),
    );
    Ok(params)
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
    let _ = request;
    1_048_576
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
        "providerId": "gemini",
        "modelId": "gemini-3.1-flash-lite",
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

fn ai_quota_from_error(error: &Value) -> Value {
    let code = error
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("ai.managed.accounting-unavailable");
    let availability = match code {
        "ai.managed.connection-required" | "ai.oauth.refresh-required" => "connectionRequired",
        "ai.managed.premium-required" => "premiumRequired",
        "ai.managed.quota-exhausted" => "quotaExhausted",
        "ai.managed.search-quota-exhausted" => "searchQuotaExhausted",
        "ai.managed.rate-limited" => "rateLimited",
        _ => "temporaryServerError",
    };
    json!({
        "schema": "fluxora.ai.quota.v1",
        "availability": availability,
        "available": false,
        "eligibility": false,
        "reason": code,
        "periodStart": null,
        "resetAt": null,
        "rollover": false,
        "limit": 0,
        "used": 0,
        "reserved": 0,
        "remaining": 0,
        "remainingInputTokenEquivalent": 0,
        "search": { "limit": 0, "used": 0, "reserved": 0, "remaining": 0 },
        "model": "gemini-3.1-flash-lite",
        "priceVersion": null
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
                "capabilities": health.get("capabilities").cloned().unwrap_or_else(|| json!({})),
                "quota": health.get("quota").cloned().unwrap_or_else(|| ai_quota_from_error(&json!({
                    "code": "ai.managed.accounting-unavailable"
                })))
            })
        }
        Err(error) => {
            let safe_error = sanitize_log(&error);
            let typed_error = ai_host_error_payload(&error, "provider");
            let user_message = typed_error
                .get("userMessage")
                .and_then(Value::as_str)
                .unwrap_or("Gemini is unavailable. Try again in a moment.")
                .to_string();
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
                "quota": ai_quota_from_error(&typed_error),
                "error": typed_error,
                "message": user_message
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
        default_install_root_directory: default_install_root_directory(&root)
            .to_string_lossy()
            .to_string(),
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
        "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; font-src 'self'; connect-src 'self' https://tpciohumwahlctpeuduv.supabase.co wss://tpciohumwahlctpeuduv.supabase.co; object-src 'none'; base-uri 'none'; form-action 'none'"
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
    let accepted = state
        .active_operations
        .lock()
        .await
        .contains(&target_operation_id);
    if accepted {
        state
            .cancelled_operations
            .lock()
            .await
            .insert(target_operation_id.clone());
    }

    let _ = write_log(
        &app,
        "ai-host",
        if accepted { "warning" } else { "info" },
        "AiChatCancel",
        &format!(
            "AI run cancel requested without terminating other chat sessions. targetOperationId={} processId={} accepted={}",
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

fn known_ai_file_tool_error_code(error: &str) -> Option<&'static str> {
    for code in [
        "outside-scope",
        "protected",
        "ambiguous",
        "binary",
        "unsupported-encoding",
        "too-large",
        "stale-revision",
        "stale-version",
        "dirty-editor",
        "locked",
        "permission-denied",
        "validation-failed",
        "effective-winner-ref-mismatch",
        "multiple-virtual-targets",
        "mutation-ineligible",
        "unproven-file-ref",
        "rollback-conflict",
        "needs-input",
    ] {
        if error.contains(code) {
            return Some(code);
        }
    }
    None
}

fn ai_core_file_tool_error_code(error: &str) -> &'static str {
    if error.contains("AI file workspace chat is not active")
        || error.contains("Bridge request timed out")
    {
        "session-inactive"
    } else {
        known_ai_file_tool_error_code(error).unwrap_or("native-failed")
    }
}

fn ai_host_error_payload(error: &str, fallback_stage: &str) -> Value {
    if let Ok(payload) = serde_json::from_str::<Value>(error) {
        if payload.get("code").and_then(Value::as_str).is_some()
            && payload.get("userMessage").and_then(Value::as_str).is_some()
        {
            return payload;
        }
    }
    json!({
        "code": "ai.host.transport",
        "category": "transport",
        "stage": fallback_stage,
        "retryable": true,
        "userMessage": "Gemini is unavailable. Try again in a moment.",
        "debugId": format!("shell-{}", now_millis()),
        "details": { "reason": sanitize_log(error) }
    })
}

#[cfg(test)]
fn ai_host_file_tool_error_code(error: &str) -> String {
    ai_host_error_payload(error, "tool-loop")
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("ai.tool-loop.failed")
        .to_string()
}

fn ai_file_tool_failure_message(reason: &str) -> String {
    match reason {
        "session-inactive" => {
            "Fluxora lost the native file session and could not restore it within the bounded recovery attempt."
                .to_string()
        }
        "native-failed" => {
            "The native Fluxora operation failed without a recognized recovery code. Check the correlated operation log."
                .to_string()
        }
        "stale-revision" => {
            "Fluxora could not stabilize the build file index after one safe restart. Retry after current build file changes finish."
                .to_string()
        }
        "tool-session-invalid-response" => {
            "Fluxora could not continue the file-tool session safely (tool-session-invalid-response)."
                .to_string()
        }
        "no-new-evidence" => {
            "Fluxora stopped the tool loop after three semantically repeated successful results produced no new evidence."
                .to_string()
        }
        "request-input-evidence-required" => {
            "Fluxora blocked the file action because the model repeatedly tried to ask for input before inspecting the selected build. No native read-only evidence was available."
                .to_string()
        }
        "effective-winner-ref-mismatch" => {
            "Fluxora rejected a stale or physical file reference. Repeat the exact search and use the effective-winner reference returned by the core."
                .to_string()
        }
        "multiple-virtual-targets" => {
            "Fluxora found more than one virtual file target. Choose the intended virtual file; no write was attempted."
                .to_string()
        }
        "mutation-ineligible" => {
            "Fluxora proved the effective target but it is not eligible for this structured mutation. No write was attempted."
                .to_string()
        }
        "unproven-file-ref" => {
            "Fluxora rejected an unproven file reference. Search the exact virtual target before staging."
                .to_string()
        }
        _ => format!("Fluxora blocked the file operation safely ({reason})."),
    }
}

fn ai_tool_terminal_error_classification(reason: &str) -> (&'static str, &'static str) {
    match reason {
        "outside-scope" | "path-escape" | "protected" | "permission-denied" => {
            ("safety", "native-guard")
        }
        "no-new-evidence" | "no-progress-repetition" | "request-input-evidence-required" => {
            ("tool-loop", "tool-loop")
        }
        _ => ("tool-loop", "verification"),
    }
}

fn should_request_independent_chat_response(
    has_file_workspace: bool,
    tool_flow_started: bool,
) -> bool {
    !has_file_workspace && !tool_flow_started
}

fn ai_shell_completion_evidence_satisfied(
    task_kind: &str,
    response: &Value,
    has_file_change_set: bool,
) -> bool {
    if task_kind != "action" {
        return true;
    }
    let Some(execution) = response.get("execution") else {
        return false;
    };
    let completed = execution.get("state").and_then(Value::as_str) == Some("completed");
    let verified = execution
        .get("verifiedEffects")
        .and_then(Value::as_array)
        .is_some_and(|effects| !effects.is_empty());
    let file_evidence_satisfied =
        execution.get("domain").and_then(Value::as_str) != Some("files") || has_file_change_set;
    completed && verified && file_evidence_satisfied
}

fn ai_tool_string<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn ai_tool_integer(value: &Value, key: &str, fallback: u64, maximum: u64) -> u64 {
    value
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or(fallback)
        .clamp(1, maximum)
}

fn ai_tool_string_array(value: &Value, key: &str) -> Value {
    Value::Array(
        value
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|item| Value::String(item.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
    )
}

fn secret_like_line(line: &str) -> bool {
    let normalized = line.to_ascii_lowercase();
    [
        "api_key",
        "apikey",
        "api-key",
        "password",
        "passwd",
        "secret",
        "authorization",
        "access_token",
        "refresh_token",
        "private_key",
        "-----begin private key",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn redact_ai_file_text(text: &str) -> (String, bool) {
    let mut redacted = false;
    let value = text
        .split_inclusive('\n')
        .map(|line| {
            if secret_like_line(line) {
                redacted = true;
                if line.ends_with('\n') {
                    "[REDACTED SECRET-LIKE LINE]\n"
                } else {
                    "[REDACTED SECRET-LIKE LINE]"
                }
            } else {
                line
            }
        })
        .collect::<String>();
    (value, redacted)
}

fn redact_ai_file_tool_value(value: Value) -> (Value, bool, u64) {
    match value {
        Value::String(text) => {
            let local_bytes = text.len() as u64;
            let (text, redacted) = redact_ai_file_text(&text);
            (Value::String(text), redacted, local_bytes)
        }
        Value::Array(items) => {
            let mut redacted = false;
            let mut local_bytes = 0;
            let items = items
                .into_iter()
                .map(|item| {
                    let (item, item_redacted, item_bytes) = redact_ai_file_tool_value(item);
                    redacted |= item_redacted;
                    local_bytes += item_bytes;
                    item
                })
                .collect();
            (Value::Array(items), redacted, local_bytes)
        }
        Value::Object(fields) => {
            let mut redacted = false;
            let mut local_bytes = 0;
            let fields = fields
                .into_iter()
                .map(|(key, value)| {
                    let (value, value_redacted, value_bytes) = redact_ai_file_tool_value(value);
                    redacted |= value_redacted;
                    local_bytes += value_bytes;
                    (key, value)
                })
                .collect();
            (Value::Object(fields), redacted, local_bytes)
        }
        value => (value, false, 0),
    }
}

#[cfg(feature = "native-ai-integration-fixture")]
static NATIVE_AI_FIXTURE_BRIDGE_TRACE: OnceLock<std::sync::Mutex<Vec<Value>>> = OnceLock::new();
#[cfg(feature = "native-ai-integration-fixture")]
static NATIVE_AI_FIXTURE_EVENT_TRACE: OnceLock<std::sync::Mutex<Vec<Value>>> = OnceLock::new();

#[cfg(feature = "native-ai-integration-fixture")]
fn native_ai_fixture_bridge_trace() -> &'static std::sync::Mutex<Vec<Value>> {
    NATIVE_AI_FIXTURE_BRIDGE_TRACE.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

#[cfg(feature = "native-ai-integration-fixture")]
fn native_ai_fixture_event_trace() -> &'static std::sync::Mutex<Vec<Value>> {
    NATIVE_AI_FIXTURE_EVENT_TRACE.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

#[cfg(feature = "native-ai-integration-fixture")]
fn reset_native_ai_fixture_traces() {
    native_ai_fixture_bridge_trace()
        .lock()
        .expect("reset native AI fixture bridge trace")
        .clear();
    native_ai_fixture_event_trace()
        .lock()
        .expect("reset native AI fixture event trace")
        .clear();
}

#[cfg(feature = "native-ai-integration-fixture")]
fn record_native_ai_fixture_bridge_call(operation_id: &str, method: &str) {
    native_ai_fixture_bridge_trace()
        .lock()
        .expect("record native AI fixture bridge call")
        .push(json!({ "operationId": operation_id, "method": method }));
}

#[cfg(feature = "native-ai-integration-fixture")]
fn record_native_ai_fixture_event(event: &Value) {
    native_ai_fixture_event_trace()
        .lock()
        .expect("record native AI fixture event")
        .push(event.clone());
}

#[cfg(feature = "native-ai-integration-fixture")]
fn native_ai_fixture_bridge_methods(operation_id: &str) -> Vec<Value> {
    native_ai_fixture_bridge_trace()
        .lock()
        .expect("read native AI fixture bridge trace")
        .iter()
        .filter(|entry| entry.get("operationId").and_then(Value::as_str) == Some(operation_id))
        .filter_map(|entry| entry.get("method").cloned())
        .collect()
}

#[cfg(feature = "native-ai-integration-fixture")]
fn native_ai_fixture_events(operation_id: &str) -> Vec<Value> {
    native_ai_fixture_event_trace()
        .lock()
        .expect("read native AI fixture event trace")
        .iter()
        .filter(|event| event.get("operationId").and_then(Value::as_str) == Some(operation_id))
        .cloned()
        .collect()
}

async fn request_ai_build_files(
    app: &AppHandle,
    method: &str,
    params: Value,
    operation_id: &str,
) -> Result<Value, String> {
    #[cfg(feature = "native-ai-integration-fixture")]
    record_native_ai_fixture_bridge_call(operation_id, method);
    let state = bridge_state(app);
    let mut bridge = state.process.lock().await;
    let timeout_ms = ai_build_files_timeout_ms(method);
    bridge
        .request(
            app,
            method,
            params,
            OperationRequest {
                operation_id: Some(operation_id.to_string()),
            },
            timeout_ms,
        )
        .await
}

fn ai_build_files_timeout_ms(method: &str) -> u64 {
    match method {
        "buildFiles.searchText" => 120_000,
        "buildFiles.discover" | "buildFiles.search" => 60_000,
        "buildFiles.apply" => 120_000,
        _ => BRIDGE_TIMEOUT_MS,
    }
}

fn should_reopen_ai_file_session(error: &str) -> bool {
    error.contains("AI file workspace chat is not active")
        || error.contains("Bridge request timed out")
}

fn stale_ai_index_retry_params(
    method: &str,
    params: &Value,
    error: &str,
    read_only: bool,
) -> Option<Value> {
    if !read_only
        || !matches!(
            method,
            "buildFiles.discover" | "buildFiles.search" | "buildFiles.searchText"
        )
        || ai_core_file_tool_error_code(error) != "stale-revision"
    {
        return None;
    }

    let mut retry = params.clone();
    retry["revision"] = json!("");
    retry["cursor"] = json!("");
    Some(retry)
}

async fn request_ai_build_files_with_recovery(
    app: &AppHandle,
    request: &Value,
    method: &str,
    params: Value,
    operation_id: &str,
    read_only: bool,
) -> Result<(Value, Option<&'static str>), String> {
    match request_ai_build_files(app, method, params.clone(), operation_id).await {
        Ok(data) => Ok((data, None)),
        Err(error) => {
            if let Some(retry_params) =
                stale_ai_index_retry_params(method, &params, &error, read_only)
            {
                return request_ai_build_files(app, method, retry_params, operation_id)
                    .await
                    .map(|data| (data, Some("restart-stale-index-search")));
            }
            if read_only && should_reopen_ai_file_session(&error) {
                let workspace = request.get("fileWorkspace").unwrap_or(&Value::Null);
                let chat_id = params
                    .get("chatId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let project_directory = workspace
                    .get("projectDirectory")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if chat_id.is_empty() || project_directory.is_empty() {
                    return Err(error);
                }
                request_ai_build_files(
                    app,
                    "buildFiles.beginChat",
                    json!({
                        "chatId": chat_id,
                        "projectDirectory": project_directory,
                        "profile": workspace.get("profile").and_then(Value::as_str).unwrap_or_default()
                    }),
                    operation_id,
                )
                .await?;
                return request_ai_build_files(app, method, params, operation_id)
                    .await
                    .map(|data| (data, Some("reopen-native-session-and-retry")));
            }
            Err(error)
        }
    }
}

fn dirty_ai_file_refs(request: &Value) -> HashSet<String> {
    request
        .get("fileWorkspace")
        .and_then(|workspace| workspace.get("dirtyFileRefs"))
        .and_then(Value::as_array)
        .map(|refs| {
            refs.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

async fn is_ai_file_dirty(app: &AppHandle, file_ref: &str) -> bool {
    if file_ref.is_empty() {
        return false;
    }
    app.state::<AiDirtyEditorState>()
        .refs
        .lock()
        .await
        .contains(file_ref)
}

fn is_ai_read_only_file_tool(name: &str) -> bool {
    tool_contract(name).is_some_and(|contract| {
        contract.domain == ToolDomain::Files && contract.risk == ToolRisk::ReadOnly
    })
}

fn ai_file_tool_cache_key(name: &str, args: &Value) -> String {
    format!("{name}:{}", serde_json::to_string(args).unwrap_or_default())
}

fn normalize_ai_file_tool_args(name: &str, args: &Value) -> Value {
    if !matches!(name, "local.files.search" | "local.text.search") {
        return args.clone();
    }
    let mut normalized = args.as_object().cloned().unwrap_or_default();
    let scope_is_empty = normalized
        .get("scope")
        .and_then(Value::as_str)
        .is_none_or(|scope| scope.trim().is_empty());
    if scope_is_empty {
        normalized.insert("scope".to_string(), json!("build"));
    }
    let cursor_is_empty = normalized
        .get("cursor")
        .and_then(Value::as_str)
        .is_none_or(|cursor| cursor.trim().is_empty());
    let has_revision = normalized
        .get("revision")
        .and_then(Value::as_str)
        .is_some_and(|revision| !revision.trim().is_empty());
    if cursor_is_empty && has_revision {
        normalized.insert("revision".to_string(), json!(""));
    }
    Value::Object(normalized)
}

fn normalize_ai_file_tool_call(call: &Value) -> Value {
    let mut normalized = call.clone();
    let name = ai_tool_string(call, "name");
    let args = call.get("args").cloned().unwrap_or_else(|| json!({}));
    normalized["args"] = normalize_ai_file_tool_args(name, &args);
    normalized
}

fn should_cache_ai_file_tool_result(result: &Value) -> bool {
    result.pointer("/result/ok").and_then(Value::as_bool) == Some(true)
}

fn ai_staged_mutation_target(mutation: &Value) -> String {
    if mutation.get("kind").and_then(Value::as_str) == Some("create") {
        format!(
            "create:{}:{}",
            ai_tool_string(mutation, "parentRef"),
            ai_tool_string(mutation, "fileName").to_lowercase()
        )
    } else if mutation
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind.starts_with("ini-"))
    {
        format!(
            "ini:{}:{}:{}",
            ai_tool_string(mutation, "fileRef"),
            ai_tool_string(mutation, "section").trim().to_lowercase(),
            ai_tool_string(mutation, "key").trim().to_lowercase()
        )
    } else {
        format!("patch:{}", ai_tool_string(mutation, "fileRef"))
    }
}

fn ai_local_tool_error(call: &Value, code: &str, message: &str) -> Value {
    json!({
        "callId": ai_tool_string(call, "callId"),
        "name": ai_tool_string(call, "name"),
        "result": { "ok": false, "error": { "code": code, "message": message } }
    })
}

#[derive(Default)]
struct AiFileMutationBlockers {
    effective_winner_ref_mismatches: HashSet<String>,
    ineligible_refs: HashSet<String>,
    multiple_virtual_target_refs: HashSet<String>,
}

fn ai_file_mutation_authorization_blocker(
    file_ref: &str,
    authorized_refs: &HashSet<String>,
    blockers: &AiFileMutationBlockers,
) -> Option<(&'static str, &'static str)> {
    if authorized_refs.contains(file_ref) {
        return None;
    }
    if blockers.multiple_virtual_target_refs.contains(file_ref) {
        return Some((
            "multiple-virtual-targets",
            "The search resolved more than one virtual file. Choose one exact virtual target and search it again before staging.",
        ));
    }
    if blockers.effective_winner_ref_mismatches.contains(file_ref) {
        return Some((
            "effective-winner-ref-mismatch",
            "This opaque reference is not the effective winner returned by the core. Repeat the exact search and use its current winner reference.",
        ));
    }
    if blockers.ineligible_refs.contains(file_ref) {
        return Some((
            "mutation-ineligible",
            "The effective build target lacks managedOverrideEligible/directMutationEligible for this structured operation. No write was attempted.",
        ));
    }
    Some((
        "unproven-file-ref",
        "This opaque reference was not proven by one current effective-winner search. Search the exact virtual target before staging.",
    ))
}

async fn execute_ai_file_tool_call(
    app: &AppHandle,
    request: &Value,
    call: &Value,
    chat_id: &str,
    run_id: &str,
    operation_id: &str,
    write_granted: bool,
    staged_mutations: &[Value],
    managed_override_refs: &HashSet<String>,
    authorization_blockers: &AiFileMutationBlockers,
) -> (Value, bool, u64, bool, Option<Value>) {
    let call_id = ai_tool_string(call, "callId");
    let name = ai_tool_string(call, "name");
    let args = call.get("args").cloned().unwrap_or_else(|| json!({}));
    let operation = tool_contract(name).map(|contract| contract.operation);
    let is_staging = operation == Some(ToolOperation::Stage);
    let is_commit = operation == Some(ToolOperation::Commit);
    let is_write = is_staging || is_commit;
    let file_ref = ai_tool_string(&args, "fileRef");
    if is_write && !write_granted {
        return (
            json!({
                "callId": call_id,
                "name": name,
                "result": { "ok": false, "error": { "code": "protected", "message": "This prompt did not grant a file write." } }
            }),
            false,
            0,
            false,
            None,
        );
    }
    if is_staging
        && !file_ref.is_empty()
        && (dirty_ai_file_refs(request).contains(file_ref) || is_ai_file_dirty(app, file_ref).await)
    {
        return (
            json!({
                "callId": call_id,
                "name": name,
                "result": { "ok": false, "error": { "code": "dirty-editor", "message": "Save or close the unsaved Fluxora Editor tab before AI writes this file." } }
            }),
            false,
            0,
            false,
            None,
        );
    }
    if is_staging
        && ["expectedText", "replacementText", "content", "value"]
            .iter()
            .filter_map(|key| args.get(*key).and_then(Value::as_str))
            .any(secret_like_line)
    {
        return (
            json!({
                "callId": call_id,
                "name": name,
                "result": { "ok": false, "error": { "code": "protected", "message": "Secret-like text must be edited locally in Fluxora Editor." } }
            }),
            false,
            0,
            true,
            None,
        );
    }
    let staging_target_ref = if name == "local.text.stage_create" {
        ai_tool_string(&args, "parentRef")
    } else {
        file_ref
    };
    if is_staging {
        if let Some((code, message)) = ai_file_mutation_authorization_blocker(
            staging_target_ref,
            managed_override_refs,
            authorization_blockers,
        ) {
            let _ = write_log(
                app,
                "ai-host",
                "warning",
                "AiFileMutationAuthorization",
                &format!("tool={name} decision=blocked reason={code}"),
                Some(operation_id),
            )
            .await;
            return (
                json!({
                    "callId": call_id,
                    "name": name,
                    "result": {
                        "ok": false,
                        "error": {
                            "code": code,
                            "message": message
                        }
                    }
                }),
                false,
                0,
                false,
                None,
            );
        }
        let _ = write_log(
            app,
            "ai-host",
            "info",
            "AiFileMutationAuthorization",
            &format!("tool={name} decision=authorized reason=effective-winner-ref"),
            Some(operation_id),
        )
        .await;
    }

    let staged_mutation = if name == "local.json.stage_set_pointer" {
        Some(json!({
            "kind": "json-set-pointer",
            "fileRef": file_ref,
            "revision": ai_tool_string(&args, "revision"),
            "baseSha256": ai_tool_string(&args, "baseSha256"),
            "pointer": ai_tool_string(&args, "pointer"),
            "expectedValue": ai_tool_string(&args, "expectedValue"),
            "value": ai_tool_string(&args, "value"),
            "format": ai_tool_string(&args, "format"),
            "allowKnownConflict": args.get("allowKnownConflict").and_then(Value::as_bool).unwrap_or(false)
        }))
    } else if name == "local.ini.stage_set_key" {
        Some(json!({
            "kind": format!("ini-{}", ai_tool_string(&args, "operation")),
            "fileRef": file_ref,
            "revision": ai_tool_string(&args, "revision"),
            "baseSha256": ai_tool_string(&args, "baseSha256"),
            "section": ai_tool_string(&args, "section"),
            "key": ai_tool_string(&args, "key"),
            "expectedValue": ai_tool_string(&args, "expectedValue"),
            "value": ai_tool_string(&args, "value"),
            "format": "ini"
        }))
    } else if name == "local.text.stage_patch" {
        Some(json!({
            "kind": "patch",
            "fileRef": file_ref,
            "revision": ai_tool_string(&args, "revision"),
            "baseSha256": ai_tool_string(&args, "baseSha256"),
            "expectedText": ai_tool_string(&args, "expectedText"),
            "replacementText": ai_tool_string(&args, "replacementText"),
            "format": ai_tool_string(&args, "format")
        }))
    } else if name == "local.text.stage_create" {
        Some(json!({
            "kind": "create",
            "parentRef": ai_tool_string(&args, "parentRef"),
            "fileName": ai_tool_string(&args, "fileName"),
            "content": ai_tool_string(&args, "content"),
            "expectedAbsent": args.get("expectedAbsent").and_then(Value::as_bool).unwrap_or(false),
            "format": ai_tool_string(&args, "format")
        }))
    } else {
        None
    };
    if let Some(mutation) = staged_mutation {
        return (
            json!({
                "callId": call_id,
                "name": name,
                "result": {
                    "ok": true,
                    "data": { "staged": true, "stagedCount": staged_mutations.len() + 1 }
                }
            }),
            false,
            0,
            false,
            Some(mutation),
        );
    }

    if is_commit && staged_mutations.is_empty() {
        return (
            json!({
                "callId": call_id,
                "name": name,
                "result": { "ok": false, "error": { "code": "nothing-staged", "message": "Stage at least one file before commit." } }
            }),
            false,
            0,
            false,
            None,
        );
    }

    let mapped = match name {
        "local.files.discover" => {
            let scopes = ai_tool_string_array(&args, "scopes");
            Some((
                "buildFiles.discover",
                json!({
                    "chatId": chat_id,
                    "scopes": if scopes.as_array().is_some_and(|items| items.is_empty()) { json!(["build"]) } else { scopes },
                    "aliases": ai_tool_string_array(&args, "aliases"),
                    "extensions": ai_tool_string_array(&args, "extensions"),
                    "configHints": ai_tool_string_array(&args, "configHints"),
                    "semanticKeys": ai_tool_string_array(&args, "semanticKeys"),
                    "revision": ai_tool_string(&args, "revision"),
                    "cursor": ai_tool_string(&args, "cursor"),
                    "limit": 20
                }),
            ))
        }
        "local.files.search" => Some((
            "buildFiles.search",
            json!({
                "chatId": chat_id,
                "scope": ai_tool_string(&args, "scope"),
                "query": ai_tool_string(&args, "query"),
                "revision": ai_tool_string(&args, "revision"),
                "cursor": ai_tool_string(&args, "cursor"),
                "limit": 20
            }),
        )),
        "local.files.stat" => Some((
            "buildFiles.stat",
            json!({ "chatId": chat_id, "fileRef": file_ref }),
        )),
        "local.text.read" => Some((
            "buildFiles.readText",
            json!({
                "chatId": chat_id,
                "fileRef": file_ref,
                "startLine": ai_tool_integer(&args, "startLine", 1, u64::MAX),
                "maxLines": ai_tool_integer(&args, "maxLines", 120, 120),
                "maxBytes": ai_tool_integer(&args, "maxBytes", 8192, 64 * 1024)
            }),
        )),
        "local.json.query" => Some((
            "buildFiles.queryJson",
            json!({
                "chatId": chat_id,
                "fileRef": file_ref,
                "pointer": ai_tool_string(&args, "pointer")
            }),
        )),
        "local.config.inspect_recipe" => Some((
            "buildFiles.inspectConfigRecipe",
            json!({
                "chatId": chat_id,
                "fileRef": file_ref,
                "targetPointer": ai_tool_string(&args, "targetPointer"),
                "requestedValue": ai_tool_string(&args, "requestedValue")
            }),
        )),
        "local.ini.query" => Some((
            "buildFiles.queryIni",
            json!({
                "chatId": chat_id,
                "fileRef": file_ref,
                "section": ai_tool_string(&args, "section"),
                "key": ai_tool_string(&args, "key")
            }),
        )),
        "local.text.search" => Some((
            "buildFiles.searchText",
            json!({
                "chatId": chat_id,
                "scope": ai_tool_string(&args, "scope"),
                "query": ai_tool_string(&args, "query"),
                "revision": ai_tool_string(&args, "revision"),
                "cursor": ai_tool_string(&args, "cursor"),
                "limit": 20
            }),
        )),
        "local.files.commit" => Some((
            "buildFiles.apply",
            json!({
                "chatId": chat_id,
                "runId": run_id,
                "mutations": staged_mutations
            }),
        )),
        _ => None,
    };
    let Some((method, params)) = mapped else {
        return (
            json!({
                "callId": call_id,
                "name": name,
                "result": { "ok": false, "error": { "code": "protected", "message": "Undeclared file tool." } }
            }),
            false,
            0,
            false,
            None,
        );
    };
    match request_ai_build_files_with_recovery(
        app,
        request,
        method,
        params,
        operation_id,
        is_ai_read_only_file_tool(name),
    )
    .await
    {
        Ok((data, recovery_action)) => {
            let (data, redacted, local_bytes) = redact_ai_file_tool_value(data);
            (
                json!({
                    "callId": call_id,
                    "name": name,
                    "result": {
                        "ok": true,
                        "data": data,
                        "redacted": redacted,
                        "recoveryAction": recovery_action
                    }
                }),
                is_commit,
                local_bytes,
                redacted,
                None,
            )
        }
        Err(error) => {
            let code = ai_core_file_tool_error_code(&error);
            let message = if code == "needs-input" {
                "PageDown (34) is already assigned to ShaderBlockNextKey. Reassign Menu.ToggleKey to PageDown anyway?".to_string()
            } else {
                ai_file_tool_failure_message(&code)
            };
            (
                json!({
                    "callId": call_id,
                    "name": name,
                    "result": {
                        "ok": false,
                        "error": { "code": code, "message": message }
                    }
                }),
                false,
                0,
                false,
                None,
            )
        }
    }
}

fn ai_metadata_allows_managed_override(metadata: &Value) -> bool {
    metadata.get("scope").and_then(Value::as_str) == Some("build")
        && (metadata
            .get("managedOverrideEligible")
            .and_then(Value::as_bool)
            == Some(true)
            || metadata
                .get("directMutationEligible")
                .and_then(Value::as_bool)
                == Some(true))
}

fn ai_metadata_allows_parent_create(metadata: &Value) -> bool {
    metadata
        .get("managedOverrideEligible")
        .and_then(Value::as_bool)
        == Some(true)
}

#[cfg(test)]
fn ai_exact_search_proves_read_target(data: &Value, file_ref: &str) -> bool {
    let entries = data
        .get("entries")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    entries.len() == 1
        && entries[0].get("fileRef").and_then(Value::as_str) == Some(file_ref)
        && ai_metadata_allows_managed_override(&entries[0])
}

async fn prove_ai_managed_override_after_read(
    app: &AppHandle,
    request: &Value,
    result: &Value,
    chat_id: &str,
    operation_id: &str,
    eligible_candidate_refs: &HashSet<String>,
    managed_override_refs: &mut HashSet<String>,
    authorization_blockers: &mut AiFileMutationBlockers,
) -> bool {
    let Some(file_ref) = result
        .pointer("/result/data/fileRef")
        .and_then(Value::as_str)
    else {
        return false;
    };
    if managed_override_refs.contains(file_ref) {
        return false;
    }
    if !eligible_candidate_refs.contains(file_ref) {
        return false;
    }
    let Some(relative_path) = result
        .pointer("/result/data/relativePath")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())
    else {
        return false;
    };
    let Ok((data, _recovered)) = request_ai_build_files_with_recovery(
        app,
        request,
        "buildFiles.search",
        json!({
            "chatId": chat_id,
            "scope": "build",
            "query": relative_path,
            "revision": "",
            "cursor": "",
            "limit": 20
        }),
        operation_id,
        true,
    )
    .await
    else {
        return false;
    };
    let entries = data
        .get("entries")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if entries.len() > 1 {
        authorization_blockers
            .multiple_virtual_target_refs
            .insert(file_ref.to_string());
        return false;
    }
    let Some(metadata) = entries.first() else {
        return false;
    };
    if metadata.get("fileRef").and_then(Value::as_str) != Some(file_ref) {
        authorization_blockers
            .effective_winner_ref_mismatches
            .insert(file_ref.to_string());
        return false;
    }
    if !ai_metadata_allows_managed_override(metadata) {
        authorization_blockers
            .ineligible_refs
            .insert(file_ref.to_string());
        return false;
    }
    managed_override_refs.insert(file_ref.to_string());
    authorization_blockers
        .effective_winner_ref_mismatches
        .remove(file_ref);
    authorization_blockers.ineligible_refs.remove(file_ref);
    authorization_blockers
        .multiple_virtual_target_refs
        .remove(file_ref);
    true
}

fn record_ai_managed_override_refs(
    tool_name: &str,
    result: &Value,
    eligible_candidate_refs: &mut HashSet<String>,
    managed_override_refs: &mut HashSet<String>,
    authorization_blockers: &mut AiFileMutationBlockers,
) {
    if result.pointer("/result/ok").and_then(Value::as_bool) != Some(true) {
        return;
    }
    if tool_name == "local.files.search" {
        let entries = result
            .pointer("/result/data/entries")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        for entry in entries {
            if let Some(reference) = entry
                .get("fileRef")
                .and_then(Value::as_str)
                .filter(|reference| !reference.is_empty())
            {
                if ai_metadata_allows_managed_override(entry) {
                    authorization_blockers.ineligible_refs.remove(reference);
                    eligible_candidate_refs.insert(reference.to_string());
                } else {
                    managed_override_refs.remove(reference);
                    authorization_blockers
                        .ineligible_refs
                        .insert(reference.to_string());
                }
                if entries.len() > 1 {
                    authorization_blockers
                        .multiple_virtual_target_refs
                        .insert(reference.to_string());
                } else {
                    authorization_blockers
                        .multiple_virtual_target_refs
                        .remove(reference);
                }
            }
        }
        if entries.len() == 1 && ai_metadata_allows_managed_override(&entries[0]) {
            let keys: &[&str] = if ai_metadata_allows_parent_create(&entries[0]) {
                &["fileRef", "parentRef"]
            } else {
                &["fileRef"]
            };
            for key in keys {
                if let Some(reference) = entries[0].get(key).and_then(Value::as_str) {
                    if !reference.is_empty() {
                        authorization_blockers
                            .effective_winner_ref_mismatches
                            .remove(reference);
                        authorization_blockers.ineligible_refs.remove(reference);
                        authorization_blockers
                            .multiple_virtual_target_refs
                            .remove(reference);
                        managed_override_refs.insert(reference.to_string());
                    }
                }
            }
        }
        return;
    }
    if tool_name == "local.files.discover" {
        let unique = result
            .pointer("/result/data/resolution")
            .and_then(Value::as_str)
            == Some("unique");
        for candidate in result
            .pointer("/result/data/candidates")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let Some(metadata) = candidate.get("file") else {
                continue;
            };
            let reference = metadata
                .get("fileRef")
                .and_then(Value::as_str)
                .filter(|reference| !reference.is_empty());
            if candidate.get("effectiveWinner").and_then(Value::as_bool) != Some(true) {
                if let Some(reference) = reference {
                    authorization_blockers
                        .effective_winner_ref_mismatches
                        .insert(reference.to_string());
                }
                continue;
            }
            let Some(reference) = reference else {
                continue;
            };
            if !ai_metadata_allows_managed_override(metadata) {
                managed_override_refs.remove(reference);
                authorization_blockers
                    .ineligible_refs
                    .insert(reference.to_string());
                continue;
            }
            authorization_blockers.ineligible_refs.remove(reference);
            eligible_candidate_refs.insert(reference.to_string());
            if !unique {
                authorization_blockers
                    .multiple_virtual_target_refs
                    .insert(reference.to_string());
                continue;
            }
            authorization_blockers
                .multiple_virtual_target_refs
                .remove(reference);
            let keys: &[&str] = if ai_metadata_allows_parent_create(metadata) {
                &["fileRef", "parentRef"]
            } else {
                &["fileRef"]
            };
            for key in keys {
                if let Some(reference) = metadata.get(key).and_then(Value::as_str) {
                    if !reference.is_empty() {
                        authorization_blockers
                            .effective_winner_ref_mismatches
                            .remove(reference);
                        authorization_blockers.ineligible_refs.remove(reference);
                        authorization_blockers
                            .multiple_virtual_target_refs
                            .remove(reference);
                        eligible_candidate_refs.insert(reference.to_string());
                        managed_override_refs.insert(reference.to_string());
                    }
                }
            }
        }
        return;
    }
}

async fn request_ai_capability_bridge(
    app: &AppHandle,
    method: &str,
    params: Value,
    operation_id: &str,
) -> Result<Value, String> {
    let state = bridge_state(app);
    let lane = bridge_lane_for_method(method);
    let mut bridge = state.process(lane).lock().await;
    let timeout_ms = if method == "installs.submit" {
        120_000
    } else {
        30_000
    };
    bridge
        .request(
            app,
            method,
            params,
            OperationRequest {
                operation_id: Some(operation_id.to_string()),
            },
            timeout_ms,
        )
        .await
}

fn ai_capability_error(call: &Value, code: &str, message: &str, details: Value) -> Value {
    json!({
        "callId": ai_tool_string(call, "callId"),
        "name": ai_tool_string(call, "name"),
        "result": {
            "ok": false,
            "error": {
                "code": code,
                "message": message,
                "details": details
            }
        }
    })
}

fn ai_expired_entity_ref(
    call: &Value,
    field: &str,
    kind: AiEntityKind,
    refs: &AiEntityRefRegistry,
) -> Value {
    ai_capability_error(
        call,
        "expired-reference",
        &format!(
            "The {field} is unknown or stale. Run the matching Fluxora list tool and use one current opaque reference."
        ),
        json!({
            "field": field,
            "allowedValues": refs.current_refs(kind),
            "recoveryAction": "rediscover-current-opaque-refs"
        }),
    )
}

fn ai_native_capability_error(call: &Value, error: &str) -> Value {
    let normalized = error.to_ascii_lowercase();
    let (code, message, recovery_action) = if normalized.contains("timeout") {
        (
            "native-timeout",
            "The native capability timed out before a verified result was returned.",
            "reread-native-state-and-retry",
        )
    } else if normalized.contains("stale") || normalized.contains("revision") {
        (
            "stale-revision",
            "Native state changed after discovery; reread the current revision before retrying.",
            "reread-current-revision",
        )
    } else if normalized.contains("notfound") || normalized.contains("not found") {
        (
            "expired-reference",
            "The referenced native entity no longer exists; rediscover current opaque references.",
            "rediscover-current-opaque-refs",
        )
    } else if normalized.contains("invalidparams") || normalized.contains("validation") {
        (
            "invalid-scope",
            "The native capability rejected its typed arguments; normalize them to the declared scope.",
            "normalize-arguments-and-retry",
        )
    } else if normalized.contains("conflict") || normalized.contains("alreadyexists") {
        (
            "conflict",
            "The native capability found a conflicting current state and needs one exact user choice.",
            "ask-one-exact-conflict-question",
        )
    } else if normalized.contains("permission") {
        (
            "permission-denied",
            "The native capability was denied by the operating system or Fluxora policy.",
            "inspect-permission-and-correlated-log",
        )
    } else {
        (
            "native-failed",
            "The native capability returned no verified effect; inspect the correlated operation log before changing arguments.",
            "inspect-correlated-native-log",
        )
    };
    ai_capability_error(
        call,
        code,
        message,
        json!({ "recoveryAction": recovery_action }),
    )
}

fn sanitize_ai_native_error_message(message: &str) -> String {
    sanitize_log(message)
        .split_whitespace()
        .map(|token| {
            let looks_like_drive_path = token.len() >= 3
                && token.as_bytes().get(1) == Some(&b':')
                && matches!(token.as_bytes().get(2), Some(b'\\' | b'/'));
            if looks_like_drive_path || token.starts_with("\\\\") {
                "[local-path]".to_string()
            } else {
                token.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(320)
        .collect()
}

fn ai_capability_success(call: &Value, data: Value) -> Value {
    json!({
        "callId": ai_tool_string(call, "callId"),
        "name": ai_tool_string(call, "name"),
        "result": { "ok": true, "data": data }
    })
}

fn ai_compensation_token(prefix: &str, operation_id: &str, call: &Value) -> String {
    format!(
        "{prefix}_{}",
        stable_label_suffix(&format!(
            "{operation_id}:{}:{}",
            ai_tool_string(call, "callId"),
            ai_tool_string(call, "name")
        ))
    )
}

async fn remember_ai_compensation(app: &AppHandle, token: String, action: AiCompensationAction) {
    let state = app.state::<AiCompensationState>();
    let mut actions = state.actions.lock().await;
    if actions.len() >= 256 {
        if let Some(expired) = actions.keys().next().cloned() {
            actions.remove(&expired);
        }
    }
    actions.insert(token, action);
}

async fn verify_ai_compensation(
    app: &AppHandle,
    verification: &AiCompensationVerification,
    operation_id: &str,
) -> Result<(), String> {
    let verified = match verification {
        AiCompensationVerification::ModEnabled {
            project_directory,
            profile_name,
            native_id,
            expected,
        } => {
            let data = request_ai_capability_bridge(
                app,
                "mods.getPersistedWorkspace",
                json!({ "projectDirectory": project_directory, "profileName": profile_name }),
                operation_id,
            )
            .await?;
            find_mod_enabled(&data, native_id) == Some(*expected)
        }
        AiCompensationVerification::ModAbsent {
            project_directory,
            profile_name,
            native_id,
        } => {
            let data = request_ai_capability_bridge(
                app,
                "mods.getPersistedWorkspace",
                json!({ "projectDirectory": project_directory, "profileName": profile_name }),
                operation_id,
            )
            .await?;
            find_mod_enabled(&data, native_id).is_none()
        }
        AiCompensationVerification::PluginOrder {
            project_directory,
            template_id,
            profile_name,
            native_id,
            expected,
        } => {
            let data = request_ai_capability_bridge(
                app,
                "plugins.listPersisted",
                json!({
                    "projectDirectory": project_directory,
                    "templateId": template_id,
                    "profileName": profile_name
                }),
                operation_id,
            )
            .await?;
            find_plugin_order(&data, native_id) == Some(*expected)
        }
        AiCompensationVerification::DownloadStateChanged {
            project_directory,
            native_id,
            previous_state,
        } => {
            let data = request_ai_capability_bridge(
                app,
                "downloads.list",
                json!({ "projectDirectory": project_directory }),
                operation_id,
            )
            .await?;
            let state = find_download_state(&data, native_id).unwrap_or_default();
            if matches!(previous_state.as_str(), "canceled" | "paused") {
                matches!(state, "canceled" | "paused")
            } else {
                !matches!(state, "canceled" | "paused")
            }
        }
        AiCompensationVerification::ProfileAbsent {
            project_directory,
            default_profile_name,
            profile_name,
        } => {
            let data = request_ai_capability_bridge(
                app,
                "profiles.list",
                json!({
                    "projectDirectory": project_directory,
                    "defaultProfileName": default_profile_name
                }),
                operation_id,
            )
            .await?;
            data.as_array().is_some_and(|items| {
                !items
                    .iter()
                    .any(|item| item.as_str() == Some(profile_name.as_str()))
            })
        }
        AiCompensationVerification::Language { expected } => {
            let data =
                request_ai_capability_bridge(app, "settings.getLanguage", json!({}), operation_id)
                    .await?;
            data.get("language").and_then(Value::as_str) == Some(expected.as_str())
        }
    };
    if verified {
        Ok(())
    } else {
        Err("native postcondition mismatch after AI compensation".to_string())
    }
}

#[tauri::command]
async fn fluxora_ai_undo_capability(
    app: AppHandle,
    compensation_token: String,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let operation_id = operation_id(request.as_ref(), "ai_capability_undo");
    let action = app
        .state::<AiCompensationState>()
        .actions
        .lock()
        .await
        .get(&compensation_token)
        .cloned()
        .ok_or_else(|| {
            "AI compensation token is unknown, expired, or was already applied; refresh current state before continuing."
                .to_string()
        })?;
    request_ai_capability_bridge(&app, &action.method, action.params.clone(), &operation_id)
        .await?;
    verify_ai_compensation(&app, &action.verification, &operation_id).await?;
    app.state::<AiCompensationState>()
        .actions
        .lock()
        .await
        .remove(&compensation_token);
    Ok(json!({
        "state": "rolled-back",
        "compensationToken": compensation_token,
        "operationId": operation_id,
        "postconditionVerified": true
    }))
}

fn irreversible_capability_question(name: &str) -> Option<(&'static str, &'static str)> {
    let contract = tool_contract(name)?;
    if contract.risk != ToolRisk::Irreversible {
        return None;
    }
    match name {
        "local.installs.cancel" => Some((
            "Cancel this active install? Cancellation is irreversible and has no compensation token.",
            "confirm-native-install-cancellation",
        )),
        "local.projects.request_create" => Some((
            "Open Fluxora's New Build dialog and choose the game directory and install root? Gemini cannot choose local filesystem paths.",
            "open-native-project-creation-dialog",
        )),
        "local.fluxpack.request_selection" => Some((
            "Select a FluxPack and confirm its native install plan? Gemini cannot provide an arbitrary local pack path.",
            "select-fluxpack-and-confirm-native-plan",
        )),
        _ => None,
    }
}

async fn execute_ai_capability_tool_call_inner(
    app: &AppHandle,
    request: &Value,
    call: &Value,
    operation_id: &str,
    refs: &mut AiEntityRefRegistry,
) -> Result<Value, String> {
    let name = ai_tool_string(call, "name");
    let args = call.get("args").cloned().unwrap_or_else(|| json!({}));
    let workspace = request.get("fileWorkspace").unwrap_or(&Value::Null);
    let project_directory = ai_tool_string(workspace, "projectDirectory");
    let template_id = ai_tool_string(workspace, "templateId");
    let profile = ai_tool_string(workspace, "profile");

    if let Some((question, recovery_action)) = irreversible_capability_question(name) {
        return Ok(ai_capability_error(
            call,
            "needs-input",
            question,
            json!({ "recoveryAction": recovery_action }),
        ));
    }

    let result = match name {
        "local.mods.list" => request_ai_capability_bridge(
            app,
            "mods.getPersistedWorkspace",
            json!({ "projectDirectory": project_directory, "profileName": profile }),
            operation_id,
        )
        .await
        .map(|data| ai_capability_success(call, sanitize_mod_workspace(&data, refs))),
        "local.mods.set_enabled" => {
            let opaque_ref = ai_tool_string(&args, "modRef");
            let Some(native_id) = refs.resolve(AiEntityKind::Mod, opaque_ref).map(str::to_string)
            else {
                return Ok(ai_expired_entity_ref(
                    call,
                    "modRef",
                    AiEntityKind::Mod,
                    refs,
                ));
            };
            let requested = args
                .get("isEnabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let before = request_ai_capability_bridge(
                app,
                "mods.getPersistedWorkspace",
                json!({ "projectDirectory": project_directory, "profileName": profile }),
                operation_id,
            )
            .await;
            match before {
                Ok(before) => {
                    let previous = find_mod_enabled(&before, &native_id);
                    if previous.is_none() {
                        Ok(ai_expired_entity_ref(
                            call,
                            "modRef",
                            AiEntityKind::Mod,
                            refs,
                        ))
                    } else {
                        request_ai_capability_bridge(
                            app,
                            "mods.setEnabled",
                            json!({ "projectDirectory": project_directory, "modPath": native_id, "isEnabled": requested }),
                            operation_id,
                        )
                        .await?;
                        let verified = request_ai_capability_bridge(
                            app,
                            "mods.getPersistedWorkspace",
                            json!({ "projectDirectory": project_directory, "profileName": profile }),
                            operation_id,
                        )
                        .await?;
                        let postcondition = find_mod_enabled(&verified, &native_id) == Some(requested);
                        if !postcondition {
                            Err("native postcondition mismatch for mods.setEnabled".to_string())
                        } else {
                            let previous = previous.unwrap_or(requested);
                            let compensation_token =
                                ai_compensation_token("undo_mod", operation_id, call);
                            remember_ai_compensation(
                                app,
                                compensation_token.clone(),
                                AiCompensationAction {
                                    method: "mods.setEnabled".to_string(),
                                    params: json!({
                                        "projectDirectory": project_directory,
                                        "modPath": native_id,
                                        "isEnabled": previous
                                    }),
                                    verification: AiCompensationVerification::ModEnabled {
                                        project_directory: project_directory.to_string(),
                                        profile_name: profile.to_string(),
                                        native_id: native_id.to_string(),
                                        expected: previous,
                                    },
                                },
                            )
                            .await;
                            Ok(ai_capability_success(
                                call,
                                json!({
                                    "modRef": opaque_ref,
                                    "isEnabled": requested,
                                    "postconditionVerified": true,
                                    "verification": "mods.getPersistedWorkspace",
                                    "compensationToken": compensation_token,
                                    "previousState": previous
                                }),
                            ))
                        }
                    }
                }
                Err(error) => Err(error),
            }
        }
        "local.plugins.list" => request_ai_capability_bridge(
            app,
            "plugins.listPersisted",
            json!({ "projectDirectory": project_directory, "templateId": template_id, "profileName": profile }),
            operation_id,
        )
        .await
        .map(|data| ai_capability_success(call, sanitize_plugins(&data, refs))),
        "local.plugins.move" => {
            let opaque_ref = ai_tool_string(&args, "pluginRef");
            let Some(native_id) = refs
                .resolve(AiEntityKind::Plugin, opaque_ref)
                .map(str::to_string)
            else {
                return Ok(ai_expired_entity_ref(
                    call,
                    "pluginRef",
                    AiEntityKind::Plugin,
                    refs,
                ));
            };
            let target_index = args
                .get("targetIndex")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            let before = request_ai_capability_bridge(
                app,
                "plugins.listPersisted",
                json!({ "projectDirectory": project_directory, "templateId": template_id, "profileName": profile }),
                operation_id,
            )
            .await?;
            let previous = find_plugin_order(&before, &native_id);
            if previous.is_none() {
                Ok(ai_expired_entity_ref(
                    call,
                    "pluginRef",
                    AiEntityKind::Plugin,
                    refs,
                ))
            } else {
                request_ai_capability_bridge(
                    app,
                    "plugins.move",
                    json!({
                        "projectDirectory": project_directory,
                        "templateId": template_id,
                        "profileName": profile,
                        "orderItemId": native_id,
                        "targetIndex": target_index
                    }),
                    operation_id,
                )
                .await?;
                let verified = request_ai_capability_bridge(
                    app,
                    "plugins.listPersisted",
                    json!({ "projectDirectory": project_directory, "templateId": template_id, "profileName": profile }),
                    operation_id,
                )
                .await?;
                let actual_index = find_plugin_order(&verified, &native_id);
                if actual_index != Some(target_index) {
                    Err(format!(
                        "native postcondition mismatch for plugins.move: expected index {target_index}, actual {actual_index:?}"
                    ))
                } else {
                    let previous = previous.unwrap_or(target_index);
                    let compensation_token =
                        ai_compensation_token("undo_plugin", operation_id, call);
                    remember_ai_compensation(
                        app,
                        compensation_token.clone(),
                        AiCompensationAction {
                            method: "plugins.move".to_string(),
                            params: json!({
                                "projectDirectory": project_directory,
                                "templateId": template_id,
                                "profileName": profile,
                                "orderItemId": native_id,
                                "targetIndex": previous
                            }),
                            verification: AiCompensationVerification::PluginOrder {
                                project_directory: project_directory.to_string(),
                                template_id: template_id.to_string(),
                                profile_name: profile.to_string(),
                                native_id: native_id.to_string(),
                                expected: previous,
                            },
                        },
                    )
                    .await;
                    Ok(ai_capability_success(
                        call,
                        json!({
                            "pluginRef": opaque_ref,
                            "targetIndex": target_index,
                            "postconditionVerified": true,
                            "verification": "plugins.listPersisted",
                            "compensationToken": compensation_token,
                            "previousIndex": previous
                        }),
                    ))
                }
            }
        }
        "local.downloads.list" => request_ai_capability_bridge(
            app,
            "downloads.list",
            json!({ "projectDirectory": project_directory }),
            operation_id,
        )
        .await
        .map(|data| ai_capability_success(call, sanitize_downloads(&data, refs))),
        "local.downloads.cancel" | "local.downloads.resume" => {
            let opaque_ref = ai_tool_string(&args, "downloadRef");
            let Some(native_id) = refs
                .resolve(AiEntityKind::Download, opaque_ref)
                .map(str::to_string)
            else {
                return Ok(ai_expired_entity_ref(
                    call,
                    "downloadRef",
                    AiEntityKind::Download,
                    refs,
                ));
            };
            let method = match name {
                "local.downloads.cancel" => "downloads.cancel",
                "local.downloads.resume" => "downloads.resume",
                _ => unreachable!("typed contract routes only download control tools here"),
            };
            let before = request_ai_capability_bridge(
                app,
                "downloads.list",
                json!({ "projectDirectory": project_directory }),
                operation_id,
            )
            .await?;
            let Some(previous) = find_download_state(&before, &native_id).map(str::to_string) else {
                return Ok(ai_expired_entity_ref(
                    call,
                    "downloadRef",
                    AiEntityKind::Download,
                    refs,
                ));
            };
            request_ai_capability_bridge(
                app,
                method,
                json!({ "projectDirectory": project_directory, "downloadPath": native_id }),
                operation_id,
            )
            .await?;
            let verified = request_ai_capability_bridge(
                app,
                "downloads.list",
                json!({ "projectDirectory": project_directory }),
                operation_id,
            )
            .await?;
            let state = find_download_state(&verified, &native_id).unwrap_or_default();
            let postcondition = if method == "downloads.cancel" {
                matches!(state, "canceled" | "paused")
            } else {
                matches!(state, "queued" | "downloading" | "indexing" | "idle")
            };
            if !postcondition {
                Err(format!("native postcondition mismatch for {method}"))
            } else {
                let compensation_method = if method == "downloads.cancel" {
                    "downloads.resume"
                } else {
                    "downloads.cancel"
                };
                let compensation_token =
                    ai_compensation_token("undo_download", operation_id, call);
                remember_ai_compensation(
                    app,
                    compensation_token.clone(),
                    AiCompensationAction {
                        method: compensation_method.to_string(),
                        params: json!({
                            "projectDirectory": project_directory,
                            "downloadPath": native_id
                        }),
                        verification: AiCompensationVerification::DownloadStateChanged {
                            project_directory: project_directory.to_string(),
                            native_id: native_id.to_string(),
                            previous_state: previous.clone(),
                        },
                    },
                )
                .await;
                Ok(ai_capability_success(
                    call,
                    json!({
                        "downloadRef": opaque_ref,
                        "transferState": state,
                        "postconditionVerified": true,
                        "verification": "downloads.list",
                        "compensationToken": compensation_token,
                        "previousState": previous
                    }),
                ))
            }
        }
        "local.installs.list" => request_ai_capability_bridge(
            app,
            "installs.list",
            json!({ "projectDirectory": project_directory, "includeTerminal": true }),
            operation_id,
        )
        .await
        .map(|data| ai_capability_success(call, sanitize_installs(&data, refs))),
        "local.installs.submit_download" => {
            let opaque_ref = ai_tool_string(&args, "downloadRef");
            let Some(native_id) = refs
                .resolve(AiEntityKind::Download, opaque_ref)
                .map(str::to_string)
            else {
                return Ok(ai_expired_entity_ref(
                    call,
                    "downloadRef",
                    AiEntityKind::Download,
                    refs,
                ));
            };
            let downloads = request_ai_capability_bridge(
                app,
                "downloads.list",
                json!({ "projectDirectory": project_directory }),
                operation_id,
            )
            .await?;
            if find_download_can_install(&downloads, &native_id) != Some(true) {
                return Ok(ai_capability_error(
                    call,
                    "precondition-failed",
                    "The selected download is not currently installable. Refresh downloads and resolve its native transfer or indexing state first.",
                    json!({ "downloadRef": opaque_ref, "recoveryAction": "refresh-downloads-and-resolve-state" }),
                ));
            }
            let data = request_ai_capability_bridge(
                app,
                "installs.submit",
                json!({
                    "projectDirectory": project_directory,
                    "operationId": operation_id,
                    "sourceKind": "download",
                    "sourcePath": native_id,
                    "isFomod": false,
                    "modName": ai_tool_string(&args, "modName"),
                    "profileName": profile,
                    "existingModMode": 0,
                    "selectedOptionIdsJson": "[]"
                }),
                operation_id,
            )
            .await?;
            let completed = data.get("state").and_then(Value::as_str) == Some("completed");
            let native_mod_id = data
                .pointer("/result/id")
                .and_then(Value::as_str)
                .map(str::to_string);
            let mut clean = sanitize_install(&data, refs);
            if let Some(fields) = clean.as_object_mut() {
                fields.insert("postconditionVerified".to_string(), json!(completed));
                fields.insert("verification".to_string(), json!("installs.get"));
            }
            if completed {
                if let Some(native_mod_id) = native_mod_id {
                    let compensation_token =
                        ai_compensation_token("undo_install", operation_id, call);
                    remember_ai_compensation(
                        app,
                        compensation_token.clone(),
                        AiCompensationAction {
                            method: "mods.deleteInstalled".to_string(),
                            params: json!({
                                "projectDirectory": project_directory,
                                "modPath": native_mod_id
                            }),
                            verification: AiCompensationVerification::ModAbsent {
                                project_directory: project_directory.to_string(),
                                profile_name: profile.to_string(),
                                native_id: native_mod_id,
                            },
                        },
                    )
                    .await;
                    clean["compensationToken"] = json!(compensation_token);
                }
            }
            Ok(ai_capability_success(call, clean))
        }
        "local.installs.cancel" => {
            let opaque_ref = ai_tool_string(&args, "operationRef");
            let Some(native_id) = refs
                .resolve(AiEntityKind::Install, opaque_ref)
                .map(str::to_string)
            else {
                return Ok(ai_expired_entity_ref(
                    call,
                    "operationRef",
                    AiEntityKind::Install,
                    refs,
                ));
            };
            request_ai_capability_bridge(
                app,
                "installs.cancel",
                json!({ "projectDirectory": project_directory, "operationId": native_id }),
                operation_id,
            )
            .await?;
            let verified = request_ai_capability_bridge(
                app,
                "installs.get",
                json!({ "projectDirectory": project_directory, "operationId": native_id }),
                operation_id,
            )
            .await?;
            let clean = sanitize_install(&verified, refs);
            if clean.get("state").and_then(Value::as_str) != Some("cancelled") {
                Err("native postcondition mismatch for installs.cancel".to_string())
            } else {
                Ok(ai_capability_success(
                    call,
                    json!({
                        "operationRef": opaque_ref,
                        "state": "cancelled",
                        "postconditionVerified": true,
                        "verification": "installs.get"
                    }),
                ))
            }
        }
        "local.installs.get" => {
            let opaque_ref = ai_tool_string(&args, "operationRef");
            let Some(native_id) = refs
                .resolve(AiEntityKind::Install, opaque_ref)
                .map(str::to_string)
            else {
                return Ok(ai_expired_entity_ref(
                    call,
                    "operationRef",
                    AiEntityKind::Install,
                    refs,
                ));
            };
            let data = request_ai_capability_bridge(
                app,
                "installs.get",
                json!({ "projectDirectory": project_directory, "operationId": native_id }),
                operation_id,
            )
            .await?;
            let native_mod_id = data
                .pointer("/result/id")
                .and_then(Value::as_str)
                .map(str::to_string);
            let native_error_message = data
                .get("errorMessage")
                .and_then(Value::as_str)
                .map(sanitize_ai_native_error_message)
                .filter(|message| !message.is_empty());
            let mut clean = sanitize_install(&data, refs);
            let state = clean
                .get("state")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if matches!(state.as_str(), "failed" | "cancelled" | "needsReview") {
                Ok(ai_capability_error(
                    call,
                    if state == "cancelled" { "cancelled" } else { "install-failed" },
                    "The native install did not complete successfully. Use its typed error code and correlated operation log before retrying.",
                    json!({
                        "operationRef": opaque_ref,
                        "state": state,
                        "nativeErrorCode": clean.get("errorCode").cloned().unwrap_or(Value::Null),
                        "nativeErrorMessage": native_error_message,
                        "recoveryAction": "inspect-install-error-code-and-correlated-log"
                    }),
                ))
            } else {
                if let Some(fields) = clean.as_object_mut() {
                    fields.insert(
                        "postconditionVerified".to_string(),
                        json!(state == "completed"),
                    );
                    fields.insert("verification".to_string(), json!("installs.get"));
                }
                if state == "completed" {
                    if let Some(native_mod_id) = native_mod_id {
                        let compensation_token =
                            ai_compensation_token("undo_install", operation_id, call);
                        remember_ai_compensation(
                            app,
                            compensation_token.clone(),
                            AiCompensationAction {
                                method: "mods.deleteInstalled".to_string(),
                                params: json!({
                                    "projectDirectory": project_directory,
                                    "modPath": native_mod_id
                                }),
                                verification: AiCompensationVerification::ModAbsent {
                                    project_directory: project_directory.to_string(),
                                    profile_name: profile.to_string(),
                                    native_id: native_mod_id,
                                },
                            },
                        )
                        .await;
                        clean["compensationToken"] = json!(compensation_token);
                    }
                }
                Ok(ai_capability_success(call, clean))
            }
        }
        "local.profiles.list" => request_ai_capability_bridge(
            app,
            "profiles.list",
            json!({ "projectDirectory": project_directory, "defaultProfileName": profile }),
            operation_id,
        )
        .await
        .map(|data| {
            let revision = stable_label_suffix(&data.to_string());
            ai_capability_success(
                call,
                json!({
                    "profiles": data,
                    "revision": revision
                }),
            )
        }),
        "local.profiles.create" => {
            let profile_name = ai_tool_string(&args, "profileName");
            let before = request_ai_capability_bridge(
                app,
                "profiles.list",
                json!({ "projectDirectory": project_directory, "defaultProfileName": profile }),
                operation_id,
            )
            .await?;
            if before
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(profile_name)))
            {
                Ok(ai_capability_error(
                    call,
                    "conflict",
                    "A profile with that exact name already exists. Choose one different profile name.",
                    json!({ "allowedValues": before }),
                ))
            } else {
                request_ai_capability_bridge(
                    app,
                    "profiles.create",
                    json!({
                        "projectDirectory": project_directory,
                        "profileName": profile_name,
                        "defaultProfileName": profile,
                        "profileFiles": []
                    }),
                    operation_id,
                )
                .await?;
                let verified = request_ai_capability_bridge(
                    app,
                    "profiles.list",
                    json!({ "projectDirectory": project_directory, "defaultProfileName": profile }),
                    operation_id,
                )
                .await?;
                let postcondition = verified.as_array().is_some_and(|items| {
                    items.iter().any(|item| item.as_str() == Some(profile_name))
                });
                if !postcondition {
                    Err("native postcondition mismatch for profiles.create".to_string())
                } else {
                    let compensation_token =
                        ai_compensation_token("undo_profile", operation_id, call);
                    remember_ai_compensation(
                        app,
                        compensation_token.clone(),
                        AiCompensationAction {
                            method: "profiles.delete".to_string(),
                            params: json!({
                                "projectDirectory": project_directory,
                                "profileName": profile_name,
                                "defaultProfileName": profile
                            }),
                            verification: AiCompensationVerification::ProfileAbsent {
                                project_directory: project_directory.to_string(),
                                default_profile_name: profile.to_string(),
                                profile_name: profile_name.to_string(),
                            },
                        },
                    )
                    .await;
                    Ok(ai_capability_success(
                        call,
                        json!({
                            "profileName": profile_name,
                            "postconditionVerified": true,
                            "verification": "profiles.list",
                            "compensationToken": compensation_token
                        }),
                    ))
                }
            }
        }
        "local.settings.get_language" => request_ai_capability_bridge(
            app,
            "settings.getLanguage",
            json!({}),
            operation_id,
        )
        .await
        .map(|data| {
            ai_capability_success(
                call,
                json!({
                    "language": data.get("language").cloned().unwrap_or(Value::Null),
                    "revision": data.get("language").cloned().unwrap_or(Value::Null)
                }),
            )
        }),
        "local.settings.set_language" => {
            let language = ai_tool_string(&args, "language");
            let before = request_ai_capability_bridge(
                app,
                "settings.getLanguage",
                json!({}),
                operation_id,
            )
            .await?;
            request_ai_capability_bridge(
                app,
                "settings.setLanguage",
                json!({ "language": language }),
                operation_id,
            )
            .await?;
            let verified = request_ai_capability_bridge(
                app,
                "settings.getLanguage",
                json!({}),
                operation_id,
            )
            .await?;
            if verified.get("language").and_then(Value::as_str) != Some(language) {
                Err("native postcondition mismatch for settings.setLanguage".to_string())
            } else {
                let previous_language = before
                    .get("language")
                    .and_then(Value::as_str)
                    .unwrap_or("en")
                    .to_string();
                let compensation_token =
                    ai_compensation_token("undo_setting", operation_id, call);
                remember_ai_compensation(
                    app,
                    compensation_token.clone(),
                    AiCompensationAction {
                        method: "settings.setLanguage".to_string(),
                        params: json!({ "language": previous_language }),
                        verification: AiCompensationVerification::Language {
                            expected: previous_language.clone(),
                        },
                    },
                )
                .await;
                Ok(ai_capability_success(
                    call,
                    json!({
                        "language": language,
                        "postconditionVerified": true,
                        "verification": "settings.getLanguage",
                        "compensationToken": compensation_token,
                        "previousLanguage": previous_language
                    }),
                ))
            }
        }
        "local.projects.current" => Ok(ai_capability_success(
            call,
            json!({
                "projectRef": workspace.get("projectId").cloned().unwrap_or(Value::Null),
                "name": workspace.get("buildLabel").cloned().unwrap_or(Value::Null),
                "templateId": template_id,
                "game": workspace.get("game").cloned().unwrap_or(Value::Null),
                "profile": profile,
                "revision": workspace.get("projectId").cloned().unwrap_or(Value::Null)
            }),
        )),
        _ => Ok(ai_capability_error(
            call,
            "protected",
            "This capability tool is not part of the supported Fluxora typed contract.",
            json!({ "recoveryAction": "use-declared-typed-tools-only" }),
        )),
    };

    result
}

async fn execute_ai_capability_tool_call(
    app: &AppHandle,
    request: &Value,
    call: &Value,
    operation_id: &str,
    refs: &mut AiEntityRefRegistry,
) -> (Value, bool, u64, bool, Option<Value>) {
    let result = execute_ai_capability_tool_call_inner(app, request, call, operation_id, refs)
        .await
        .unwrap_or_else(|error| ai_native_capability_error(call, &error));
    let bytes = serde_json::to_vec(&result)
        .map(|bytes| bytes.len() as u64)
        .unwrap_or_default();
    (result, false, bytes, false, None)
}

#[tauri::command]
async fn fluxora_ai_file_read(app: AppHandle, request: Value) -> Result<Value, String> {
    let operation_id = request
        .get("operationId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| operation_id(None, "ai_file_read"));
    request_ai_build_files(
        &app,
        "buildFiles.readText",
        json!({
            "chatId": ai_tool_string(&request, "chatId"),
            "fileRef": ai_tool_string(&request, "fileRef"),
            "startLine": ai_tool_integer(&request, "startLine", 1, u64::MAX),
            "maxLines": ai_tool_integer(
                &request,
                "maxLines",
                120,
                if request.get("editorMode").and_then(Value::as_bool).unwrap_or(false) { 65_536 } else { 120 },
            ),
            "maxBytes": ai_tool_integer(&request, "maxBytes", 8192, 64 * 1024),
            "editorMode": request.get("editorMode").and_then(Value::as_bool).unwrap_or(false)
        }),
        &operation_id,
    )
    .await
}

#[tauri::command]
async fn fluxora_ai_file_end_chat(
    app: AppHandle,
    chat_id: String,
    request: Option<OperationRequest>,
) -> Result<(), String> {
    let operation_id = operation_id(request.as_ref(), "ai_file_end_chat");
    request_ai_build_files(
        &app,
        "buildFiles.endChat",
        json!({ "chatId": chat_id }),
        &operation_id,
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn fluxora_ai_file_save(app: AppHandle, request: Value) -> Result<Value, String> {
    let operation_id = request
        .get("operationId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| operation_id(None, "ai_file_save"));
    let file_ref = ai_tool_string(&request, "fileRef");
    request_ai_build_files(
        &app,
        "buildFiles.apply",
        json!({
            "chatId": ai_tool_string(&request, "chatId"),
            "runId": ai_tool_string(&request, "runId"),
            "mutations": [{
                "kind": "replace-document",
                "fileRef": file_ref,
                "revision": ai_tool_string(&request, "revision"),
                "baseSha256": ai_tool_string(&request, "baseSha256"),
                "expectedText": ai_tool_string(&request, "expectedText"),
                "replacementText": ai_tool_string(&request, "replacementText"),
                "format": ai_tool_string(&request, "format")
            }]
        }),
        &operation_id,
    )
    .await
}

#[tauri::command]
async fn fluxora_ai_file_set_dirty(
    app: AppHandle,
    file_ref: String,
    dirty: bool,
) -> Result<(), String> {
    let file_ref = file_ref.trim();
    if file_ref.is_empty() {
        return Err("AI fileRef is required.".to_string());
    }
    let state = app.state::<AiDirtyEditorState>();
    let mut refs = state.refs.lock().await;
    if dirty {
        refs.insert(file_ref.to_string());
    } else {
        refs.remove(file_ref);
    }
    Ok(())
}

#[tauri::command]
async fn fluxora_ai_file_rollback_file(
    app: AppHandle,
    chat_id: String,
    run_id: String,
    file_ref: String,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let operation_id = operation_id(request.as_ref(), "ai_file_rollback_file");
    request_ai_build_files(
        &app,
        "buildFiles.rollbackFile",
        json!({ "chatId": chat_id, "runId": run_id, "fileRef": file_ref }),
        &operation_id,
    )
    .await
}

#[tauri::command]
async fn fluxora_ai_file_rollback_run(
    app: AppHandle,
    chat_id: String,
    run_id: String,
    request: Option<OperationRequest>,
) -> Result<Value, String> {
    let operation_id = operation_id(request.as_ref(), "ai_file_rollback_run");
    request_ai_build_files(
        &app,
        "buildFiles.rollbackRun",
        json!({ "chatId": chat_id, "runId": run_id }),
        &operation_id,
    )
    .await
}

#[tauri::command]
async fn fluxora_ai_file_get_rollback_states(
    app: AppHandle,
    chat_id: String,
    operation_id: String,
) -> Result<Value, String> {
    let operation_id = if operation_id.trim().is_empty() {
        crate::operation_id(None, "ai_file_get_rollback_states")
    } else {
        operation_id
    };
    request_ai_build_files(
        &app,
        "buildFiles.getRollbackStates",
        json!({ "chatId": chat_id }),
        &operation_id,
    )
    .await
}

#[tauri::command]
async fn fluxora_ai_file_reset_rollback_checkpoints(
    app: AppHandle,
    operation_id: String,
) -> Result<(), String> {
    let operation_id = if operation_id.trim().is_empty() {
        crate::operation_id(None, "ai_file_reset_rollback_checkpoints")
    } else {
        operation_id
    };
    request_ai_build_files(
        &app,
        "buildFiles.resetRollbackCheckpoints",
        json!({}),
        &operation_id,
    )
    .await
    .map(|_| ())
}

async fn execute_ai_chat_request(app: AppHandle, request: Value) -> Result<Value, String> {
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
    register_ai_operation(&app, &operation_id).await;
    enrich_ai_request_with_private_nexus_credential(&app, &mut request, &operation_id).await;
    let workspace = request.get("fileWorkspace").cloned().unwrap_or(Value::Null);
    let has_file_workspace = workspace.as_object().is_some();
    let project_directory = ai_tool_string(&workspace, "projectDirectory").to_string();
    let chat_id = workspace
        .get("chatId")
        .and_then(Value::as_str)
        .or_else(|| request.get("sessionId").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let run_id = request
        .get("runId")
        .and_then(Value::as_str)
        .unwrap_or(&operation_id)
        .to_string();

    let mut staged_text: Option<String> = None;
    let mut staged_response: Option<Value> = None;
    let mut staged_change_set: Option<Value> = None;
    let mut staged_needs_input: Option<String> = None;
    let mut staged_blocked_reason: Option<String> = None;
    let mut staged_error: Option<Value> = None;
    let mut tool_flow_started = false;
    let mut tool_call_count = 0_u64;
    let mut tool_round_count = 0_u64;
    let mut metadata_bytes = 0_u64;
    let mut content_bytes = 0_u64;
    let mut search_count = 0_u64;
    let mut empty_result_count = 0_u64;
    let mut candidate_count = 0_u64;
    let mut provider_bytes = 0_u64;
    let mut redaction_applied = false;
    let mut mutation_count = 0_u64;
    let mut truncated_responses = 0_u64;
    let mut validation_retry_count = 0_u64;
    let mut duplicate_call_count = 0_u64;
    let mut host_new_evidence_count = 0_u64;
    let mut host_stagnant_result_count = 0_u64;
    let mut host_phase_transitions = Vec::<Value>::new();
    let mut task_kind = "answer".to_string();
    let mut thinking_level = "medium".to_string();
    let mut goal_mode = "answer".to_string();
    let mut goal_origin = "explicit".to_string();
    let mut allowed_risk = "read-only".to_string();
    let mut continued_goal = false;
    let mut provider_routing = if has_file_workspace {
        "local-auto"
    } else {
        "web-search"
    }
    .to_string();
    let mut staged_mutations = Vec::<Value>::new();
    let mut staged_targets = HashSet::<String>::new();
    let mut managed_override_candidate_refs = HashSet::<String>::new();
    let mut managed_override_refs = HashSet::<String>::new();
    let mut mutation_authorization_blockers = AiFileMutationBlockers::default();
    let mut read_only_cache = HashMap::<String, Value>::new();
    let mut entity_refs = AiEntityRefRegistry::default();
    let mut commit_completed = false;
    let mut native_session_preopened = false;

    if !project_directory.is_empty() && !chat_id.is_empty() {
        match request_ai_build_files(
            &app,
            "buildFiles.beginChat",
            json!({
                "chatId": chat_id,
                "projectDirectory": project_directory,
                "profile": workspace.get("profile").and_then(Value::as_str).unwrap_or_default()
            }),
            &operation_id,
        )
        .await
        {
            Ok(_) => native_session_preopened = true,
            Err(error) => {
                let reason = ai_core_file_tool_error_code(&error).to_string();
                staged_blocked_reason = Some(reason.clone());
                staged_error = Some(json!({
                    "code": format!("ai.tool.{reason}"),
                    "category": "safety",
                    "stage": "native-session",
                    "retryable": reason == "session-inactive",
                    "userMessage": ai_file_tool_failure_message(&reason),
                    "debugId": format!("shell-{}", now_millis())
                }));
            }
        }
    }

    if native_session_preopened {
        let begin = {
            let state = ai_host_state(&app);
            let mut host = state.process.lock().await;
            host.request(
                &app,
                "chat.beginToolRun",
                request.clone(),
                operation_request.clone(),
                AI_HOST_LONG_RUNNING_TIMEOUT_MS,
            )
            .await
        };
        let begin_error = begin
            .as_ref()
            .err()
            .map(|error| ai_host_error_payload(error, "session-start"));
        if let Ok(mut turn) = begin {
            tool_flow_started = turn.get("state").and_then(Value::as_str) != Some("fallback");
            let mut tool_session_id = turn
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            'tool_loop: loop {
                if ai_operation_cancelled(&app, &operation_id).await {
                    staged_blocked_reason = Some("cancelled".to_string());
                    staged_error = Some(ai_cancelled_error_payload());
                    break;
                }
                tool_round_count = turn
                    .get("toolRounds")
                    .and_then(Value::as_u64)
                    .unwrap_or(tool_round_count);
                tool_call_count = turn
                    .get("toolCalls")
                    .and_then(Value::as_u64)
                    .unwrap_or(tool_call_count);
                let observed_new_evidence_count = turn
                    .get("newEvidenceCount")
                    .and_then(Value::as_u64)
                    .unwrap_or(host_new_evidence_count);
                let new_fact = observed_new_evidence_count > host_new_evidence_count;
                host_new_evidence_count = observed_new_evidence_count;
                host_stagnant_result_count = turn
                    .get("stagnantResultCount")
                    .and_then(Value::as_u64)
                    .unwrap_or(host_stagnant_result_count);
                host_phase_transitions = turn
                    .get("phaseTransitions")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_else(|| host_phase_transitions.clone());
                let phase = turn
                    .pointer("/execution/phase")
                    .or_else(|| turn.pointer("/response/execution/phase"))
                    .and_then(Value::as_str)
                    .unwrap_or("discover");
                let terminal_reason = turn
                    .get("terminalReason")
                    .and_then(Value::as_str)
                    .unwrap_or("none");
                let _ = write_log(
                    &app,
                    "ai-host",
                    "info",
                    "AiToolLoop",
                    &format!(
                        "phase={} newFact={} newEvidenceCount={} stagnantResultCount={} terminalReason={}",
                        phase,
                        new_fact,
                        host_new_evidence_count,
                        host_stagnant_result_count,
                        terminal_reason
                    ),
                    Some(&operation_id),
                )
                .await;
                validation_retry_count = turn
                    .get("validationRetries")
                    .and_then(Value::as_u64)
                    .unwrap_or(validation_retry_count);
                task_kind = turn
                    .get("taskKind")
                    .and_then(Value::as_str)
                    .unwrap_or(&task_kind)
                    .to_string();
                goal_mode = turn
                    .get("mode")
                    .and_then(Value::as_str)
                    .unwrap_or(&goal_mode)
                    .to_string();
                goal_origin = turn
                    .get("origin")
                    .and_then(Value::as_str)
                    .unwrap_or(&goal_origin)
                    .to_string();
                allowed_risk = turn
                    .get("allowedRisk")
                    .and_then(Value::as_str)
                    .unwrap_or(&allowed_risk)
                    .to_string();
                continued_goal = turn
                    .get("continuedGoal")
                    .and_then(Value::as_bool)
                    .unwrap_or(continued_goal);
                provider_routing = turn
                    .get("providerRouting")
                    .and_then(Value::as_str)
                    .unwrap_or(&provider_routing)
                    .to_string();
                thinking_level = turn
                    .get("thinkingLevel")
                    .and_then(Value::as_str)
                    .unwrap_or(&thinking_level)
                    .to_string();
                match turn.get("state").and_then(Value::as_str) {
                    Some("fallback") => break,
                    Some("final") => {
                        staged_response = turn.get("response").cloned();
                        staged_text = turn.get("text").and_then(Value::as_str).map(str::to_string);
                        break;
                    }
                    Some("tool-calls") => {
                        tool_session_id = turn
                            .get("sessionId")
                            .and_then(Value::as_str)
                            .unwrap_or(&tool_session_id)
                            .to_string();
                        let write_granted = turn
                            .get("writeGranted")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        let calls = turn
                            .get("calls")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        let mut results = Vec::with_capacity(calls.len());
                        for call in &calls {
                            if ai_operation_cancelled(&app, &operation_id).await {
                                staged_blocked_reason = Some("cancelled".to_string());
                                staged_error = Some(ai_cancelled_error_payload());
                                break 'tool_loop;
                            }
                            let normalized_call = normalize_ai_file_tool_call(call);
                            let tool_name = ai_tool_string(&normalized_call, "name");
                            let args = normalized_call
                                .get("args")
                                .cloned()
                                .unwrap_or_else(|| json!({}));
                            let capability_tool = is_capability_tool(tool_name);
                            let is_read_only = is_ai_read_only_file_tool(tool_name)
                                || is_read_only_capability_tool(tool_name);
                            let cacheable_read = is_ai_read_only_file_tool(tool_name);
                            let cache_key = ai_file_tool_cache_key(tool_name, &args);
                            let cache_hit =
                                cacheable_read && read_only_cache.contains_key(&cache_key);
                            let (mut result, committed, bytes, redacted, staged_mutation) =
                                if is_read_only {
                                    if cacheable_read {
                                        if let Some(cached) = read_only_cache.get(&cache_key) {
                                            duplicate_call_count += 1;
                                            (
                                                json!({
                                                    "callId": ai_tool_string(&normalized_call, "callId"),
                                                    "name": tool_name,
                                                    "result": cached
                                                }),
                                                false,
                                                0,
                                                false,
                                                None,
                                            )
                                        } else if capability_tool {
                                            execute_ai_capability_tool_call(
                                                &app,
                                                &request,
                                                &normalized_call,
                                                &operation_id,
                                                &mut entity_refs,
                                            )
                                            .await
                                        } else {
                                            execute_ai_file_tool_call(
                                                &app,
                                                &request,
                                                &normalized_call,
                                                &chat_id,
                                                &run_id,
                                                &operation_id,
                                                write_granted,
                                                &staged_mutations,
                                                &managed_override_refs,
                                                &mutation_authorization_blockers,
                                            )
                                            .await
                                        }
                                    } else if capability_tool {
                                        execute_ai_capability_tool_call(
                                            &app,
                                            &request,
                                            &normalized_call,
                                            &operation_id,
                                            &mut entity_refs,
                                        )
                                        .await
                                    } else {
                                        execute_ai_file_tool_call(
                                            &app,
                                            &request,
                                            &normalized_call,
                                            &chat_id,
                                            &run_id,
                                            &operation_id,
                                            write_granted,
                                            &staged_mutations,
                                            &managed_override_refs,
                                            &mutation_authorization_blockers,
                                        )
                                        .await
                                    }
                                } else if commit_completed && !capability_tool {
                                    (
                                            ai_local_tool_error(
                                                &normalized_call,
                                                "already-committed",
                                                "This action already committed its one atomic file batch.",
                                            ),
                                            false,
                                            0,
                                            false,
                                            None,
                                        )
                                } else if capability_tool {
                                    execute_ai_capability_tool_call(
                                        &app,
                                        &request,
                                        &normalized_call,
                                        &operation_id,
                                        &mut entity_refs,
                                    )
                                    .await
                                } else {
                                    execute_ai_file_tool_call(
                                        &app,
                                        &request,
                                        &normalized_call,
                                        &chat_id,
                                        &run_id,
                                        &operation_id,
                                        write_granted,
                                        &staged_mutations,
                                        &managed_override_refs,
                                        &mutation_authorization_blockers,
                                    )
                                    .await
                                };
                            if cacheable_read && !read_only_cache.contains_key(&cache_key) {
                                if should_cache_ai_file_tool_result(&result) {
                                    let payload = result
                                        .get("result")
                                        .cloned()
                                        .expect("successful AI tool result payload");
                                    read_only_cache.insert(cache_key, payload);
                                }
                            }
                            if tool_name == "local.text.read"
                                && prove_ai_managed_override_after_read(
                                    &app,
                                    &request,
                                    &result,
                                    &chat_id,
                                    &operation_id,
                                    &managed_override_candidate_refs,
                                    &mut managed_override_refs,
                                    &mut mutation_authorization_blockers,
                                )
                                .await
                            {
                                search_count = search_count.saturating_add(1);
                            }
                            record_ai_managed_override_refs(
                                tool_name,
                                &result,
                                &mut managed_override_candidate_refs,
                                &mut managed_override_refs,
                                &mut mutation_authorization_blockers,
                            );
                            if let Some(mutation) = staged_mutation {
                                let target = ai_staged_mutation_target(&mutation);
                                if staged_mutations.len() >= 16 {
                                    result = ai_local_tool_error(
                                        &normalized_call,
                                        "too-large",
                                        "One action can stage at most 16 mutations.",
                                    );
                                } else if !staged_targets.insert(target) {
                                    result = ai_local_tool_error(
                                        &normalized_call,
                                        "duplicate-mutation",
                                        "One action cannot stage the same file target twice.",
                                    );
                                } else {
                                    staged_mutations.push(mutation);
                                    result["result"]["data"]["stagedCount"] =
                                        json!(staged_mutations.len());
                                }
                            }
                            if result.pointer("/result/error/code").and_then(Value::as_str)
                                == Some("needs-input")
                            {
                                staged_needs_input = Some(
                                        result
                                            .pointer("/result/error/message")
                                            .and_then(Value::as_str)
                                            .unwrap_or(
                                                "PageDown (34) is already assigned to ShaderBlockNextKey. Reassign Menu.ToggleKey to PageDown anyway?",
                                            )
                                            .to_string(),
                                    );
                            }
                            if committed {
                                commit_completed = true;
                                staged_change_set = result
                                    .get("result")
                                    .and_then(|result| result.get("data"))
                                    .cloned();
                                mutation_count = staged_change_set
                                    .as_ref()
                                    .and_then(|change_set| change_set.get("files"))
                                    .and_then(Value::as_array)
                                    .map(|files| files.len() as u64)
                                    .unwrap_or_default();
                            }
                            if result
                                .pointer("/result/data/truncated")
                                .and_then(Value::as_bool)
                                .unwrap_or(false)
                            {
                                truncated_responses += 1;
                            }
                            let is_search = matches!(
                                tool_name,
                                "local.files.discover" | "local.files.search" | "local.text.search"
                            );
                            if is_search {
                                search_count += 1;
                                let result_count = ["candidates", "entries", "matches"]
                                    .iter()
                                    .find_map(|field| {
                                        result
                                            .pointer(&format!("/result/data/{field}"))
                                            .and_then(Value::as_array)
                                            .map(|items| items.len() as u64)
                                    })
                                    .unwrap_or_default();
                                if result_count == 0 {
                                    empty_result_count += 1;
                                }
                                if tool_name == "local.files.discover" {
                                    candidate_count += result_count;
                                }
                            }
                            if matches!(
                                tool_name,
                                "local.files.discover" | "local.files.search" | "local.files.stat"
                            ) {
                                metadata_bytes += bytes;
                            } else if is_read_only {
                                content_bytes += bytes;
                            }
                            redaction_applied |= redacted;
                            provider_bytes += serde_json::to_vec(&result)
                                .map(|bytes| bytes.len() as u64)
                                .unwrap_or_default();
                            let validation_code = result
                                .pointer("/result/error/validationCode")
                                .or_else(|| result.pointer("/result/error/code"))
                                .and_then(Value::as_str)
                                .unwrap_or("ok");
                            let validation_field = result
                                .pointer("/result/error/field")
                                .and_then(Value::as_str)
                                .unwrap_or("none");
                            let outcome = if result.pointer("/result/ok").and_then(Value::as_bool)
                                == Some(true)
                            {
                                "succeeded"
                            } else {
                                "blocked"
                            };
                            let _ = write_log(
                                    &app,
                                    "ai-host",
                                    if outcome == "succeeded" { "info" } else { "warning" },
                                    "AiTool",
                                    &format!(
                                        "tool={} round={} validationField={} validationCode={} retry={} cached={} resultCount=1 outcome={}",
                                        tool_name,
                                        tool_round_count,
                                        validation_field,
                                        validation_code,
                                        validation_retry_count,
                                        cache_hit,
                                        outcome
                                    ),
                                    Some(&operation_id),
                                )
                                .await;
                            results.push(result);
                        }
                        if ai_operation_cancelled(&app, &operation_id).await {
                            staged_blocked_reason = Some("cancelled".to_string());
                            staged_error = Some(ai_cancelled_error_payload());
                            break;
                        }
                        let continued = {
                            let state = ai_host_state(&app);
                            let mut host = state.process.lock().await;
                            host.request(
                                &app,
                                "chat.continueToolRun",
                                json!({ "sessionId": tool_session_id, "results": results }),
                                operation_request.clone(),
                                AI_HOST_LONG_RUNNING_TIMEOUT_MS,
                            )
                            .await
                        };
                        match continued {
                            Ok(next) => turn = next,
                            Err(error) => {
                                let payload = ai_host_error_payload(&error, "tool-loop");
                                staged_blocked_reason = payload
                                    .get("code")
                                    .and_then(Value::as_str)
                                    .map(str::to_string);
                                staged_error = Some(payload);
                                break;
                            }
                        }
                    }
                    _ => {
                        staged_blocked_reason = Some("tool-session-invalid-response".to_string());
                        break;
                    }
                }
            }
            if staged_blocked_reason.is_some() && !tool_session_id.is_empty() {
                let state = ai_host_state(&app);
                let mut host = state.process.lock().await;
                let _ = host
                    .request(
                        &app,
                        "chat.abortToolRun",
                        json!({ "sessionId": tool_session_id }),
                        operation_request.clone(),
                        AI_HOST_TIMEOUT_MS,
                    )
                    .await;
            }
        } else {
            staged_blocked_reason = begin_error
                .as_ref()
                .and_then(|payload| payload.get("code"))
                .and_then(Value::as_str)
                .map(str::to_string);
            staged_error = begin_error;
        }
    }

    let mut result: Result<Value, String> =
        if should_request_independent_chat_response(has_file_workspace, tool_flow_started) {
            let state = ai_host_state(&app);
            let mut host = state.process.lock().await;
            host.request(
                &app,
                "chat.respond",
                request,
                operation_request,
                AI_HOST_LONG_RUNNING_TIMEOUT_MS,
            )
            .await
        } else if let Some(response) = staged_response {
            Ok(response)
        } else {
            let reason = staged_blocked_reason
                .clone()
                .unwrap_or_else(|| "tool-session-invalid-response".to_string());
            let error = staged_error.clone().unwrap_or_else(|| {
                let user_message = ai_file_tool_failure_message(&reason);
                json!({
                    "code": format!("ai.tool.{reason}"),
                    "category": "tool-loop",
                    "stage": "tool-loop",
                    "retryable": false,
                    "userMessage": user_message,
                    "debugId": format!("shell-{}", now_millis())
                })
            });
            let blocked_text = error
                .get("userMessage")
                .and_then(Value::as_str)
                .unwrap_or("Fluxora stopped the AI tool loop safely.")
                .to_string();
            Ok(json!({
                "operationId": operation_id,
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "status": "blocked",
                "text": blocked_text,
                "streamChunks": [{ "index": 0, "text": blocked_text }],
                "sources": [],
                "toolCallsAllowed": true,
                "error": error
            }))
        };
    if ai_operation_cancelled(&app, &operation_id).await {
        let error = ai_cancelled_error_payload();
        let text = error
            .get("userMessage")
            .and_then(Value::as_str)
            .unwrap_or("The AI request was stopped.")
            .to_string();
        result = Ok(json!({
            "operationId": operation_id,
            "providerId": "gemini",
            "modelId": "gemini-3.1-flash-lite",
            "status": "blocked",
            "text": text,
            "streamChunks": [{ "index": 0, "text": text }],
            "sources": [],
            "toolCallsAllowed": false,
            "error": error
        }));
    }
    let final_result = match result {
        Ok(mut data) => {
            task_kind = data
                .pointer("/fileToolDiagnostics/taskKind")
                .and_then(Value::as_str)
                .unwrap_or(&task_kind)
                .to_string();
            thinking_level = data
                .pointer("/internalDiagnostics/thinkingLevel")
                .or_else(|| data.pointer("/fileToolDiagnostics/thinkingLevel"))
                .and_then(Value::as_str)
                .unwrap_or(&thinking_level)
                .to_string();
            goal_mode = data
                .pointer("/fileToolDiagnostics/mode")
                .and_then(Value::as_str)
                .unwrap_or(&goal_mode)
                .to_string();
            goal_origin = data
                .pointer("/fileToolDiagnostics/origin")
                .and_then(Value::as_str)
                .unwrap_or(&goal_origin)
                .to_string();
            allowed_risk = data
                .pointer("/fileToolDiagnostics/allowedRisk")
                .and_then(Value::as_str)
                .unwrap_or(&allowed_risk)
                .to_string();
            continued_goal = data
                .pointer("/fileToolDiagnostics/continuedGoal")
                .and_then(Value::as_bool)
                .unwrap_or(continued_goal);
            let host_terminal_reason = data
                .get("toolLoopTerminalReason")
                .and_then(Value::as_str)
                .map(str::to_string);
            if data.get("status").and_then(Value::as_str) == Some("needs-input")
                && data.pointer("/execution/state").and_then(Value::as_str) == Some("needs-input")
            {
                staged_needs_input = data
                    .pointer("/execution/pendingQuestion")
                    .and_then(Value::as_str)
                    .or_else(|| data.get("text").and_then(Value::as_str))
                    .map(str::to_string);
            }
            if let Value::Object(fields) = &mut data {
                fields.insert("operationId".to_string(), json!(operation_id.clone()));
                if let Some(text) = staged_text.filter(|text| !text.trim().is_empty()) {
                    fields.insert("text".to_string(), json!(text.clone()));
                    fields.insert(
                        "streamChunks".to_string(),
                        json!([{ "index": 0, "text": text }]),
                    );
                    fields.insert("toolCallsAllowed".to_string(), json!(true));
                }
                if let Some(change_set) = staged_change_set.clone() {
                    fields.insert("fileChangeSet".to_string(), change_set);
                }
                if let Some(question) = &staged_needs_input {
                    fields.insert("status".to_string(), json!("needs-input"));
                    fields.insert("text".to_string(), json!(question));
                    fields.insert(
                        "streamChunks".to_string(),
                        json!([{ "index": 0, "text": question }]),
                    );
                }
                if let Some(reason) = &staged_blocked_reason {
                    let error = staged_error.clone().unwrap_or_else(|| {
                        json!({
                            "code": format!("ai.tool.{reason}"),
                            "category": "tool-loop",
                            "stage": "tool-loop",
                            "retryable": false,
                            "userMessage": ai_file_tool_failure_message(reason),
                            "debugId": format!("shell-{}", now_millis())
                        })
                    });
                    let blocked_text = error
                        .get("userMessage")
                        .and_then(Value::as_str)
                        .unwrap_or("Fluxora stopped the AI tool loop safely.")
                        .to_string();
                    fields.insert("status".to_string(), json!("blocked"));
                    fields.insert("text".to_string(), json!(blocked_text.clone()));
                    fields.insert(
                        "streamChunks".to_string(),
                        json!([{ "index": 0, "text": blocked_text }]),
                    );
                    fields.insert("error".to_string(), error);
                }
                let completion_candidate = json!({
                    "execution": fields.get("execution").cloned().unwrap_or(Value::Null)
                });
                if !ai_shell_completion_evidence_satisfied(
                    &task_kind,
                    &completion_candidate,
                    staged_change_set.is_some(),
                ) && staged_needs_input.is_none()
                    && staged_blocked_reason.is_none()
                {
                    let is_file_action = fields
                        .get("execution")
                        .and_then(|execution| execution.get("domain"))
                        .and_then(Value::as_str)
                        == Some("files");
                    let reason = host_terminal_reason.clone().unwrap_or_else(|| {
                        if is_file_action {
                            "action-without-verified-commit".to_string()
                        } else {
                            "action-without-verified-effect".to_string()
                        }
                    });
                    let blocked_text = ai_file_tool_failure_message(&reason);
                    let (category, stage) = ai_tool_terminal_error_classification(&reason);
                    fields.insert("status".to_string(), json!("blocked"));
                    fields.insert("text".to_string(), json!(blocked_text.clone()));
                    fields.insert(
                        "streamChunks".to_string(),
                        json!([{ "index": 0, "text": blocked_text }]),
                    );
                    fields.insert("toolLoopTerminalReason".to_string(), json!(reason.clone()));
                    fields.insert(
                        "error".to_string(),
                        json!({
                            "code": format!("ai.tool.{reason}"),
                            "category": category,
                            "stage": stage,
                            "retryable": false,
                            "userMessage": ai_file_tool_failure_message(&reason),
                            "debugId": format!("shell-{}", now_millis())
                        }),
                    );
                }
                let outcome = fields
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("blocked")
                    .to_string();
                let terminal_reason = fields
                    .get("toolLoopTerminalReason")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| staged_blocked_reason.clone());
                fields.insert(
                    "fileToolDiagnostics".to_string(),
                    json!({
                        "schema": "fluxora.ai.file-tool-diagnostics.v2",
                        "taskKind": task_kind,
                        "mode": goal_mode,
                        "origin": goal_origin,
                        "allowedRisk": allowed_risk,
                        "continuedGoal": continued_goal,
                        "providerRouting": provider_routing,
                        "thinkingLevel": thinking_level.clone(),
                        "outcome": outcome,
                        "validationRetries": validation_retry_count,
                        "duplicateCalls": duplicate_call_count,
                        "stagedChanges": staged_mutations.len(),
                        "verifiedMutations": mutation_count,
                        "terminalReason": terminal_reason,
                        "toolCalls": tool_call_count,
                        "toolRounds": tool_round_count,
                        "metadataBytes": metadata_bytes,
                        "contentBytes": content_bytes,
                        "searches": search_count,
                        "emptyResults": empty_result_count,
                        "candidateCount": candidate_count,
                        "providerBytes": provider_bytes,
                        "redactionApplied": redaction_applied,
                        "mutations": mutation_count,
                        "truncatedResponses": truncated_responses,
                        "blockedReason": staged_blocked_reason,
                        "nativeSessionPreopened": native_session_preopened,
                        "newEvidenceCount": host_new_evidence_count,
                        "stagnantResultCount": host_stagnant_result_count,
                        "phaseTransitions": host_phase_transitions
                    }),
                );
            }
            let _ = write_log(
                &app,
                "ai-host",
                "info",
                "AiChat",
                &format!(
                    "AI response completed through the bounded tool-session broker. mode={} origin={} allowedRisk={} continuedGoal={} thinkingLevel={}",
                    goal_mode,
                    goal_origin,
                    allowed_risk,
                    continued_goal,
                    thinking_level
                ),
                Some(&operation_id),
            )
            .await;
            Ok(data)
        }
        Err(error) => {
            let safe_error = sanitize_log(&error);
            let typed_error = ai_host_error_payload(&error, "provider");
            let user_message = typed_error
                .get("userMessage")
                .and_then(Value::as_str)
                .unwrap_or("Gemini is unavailable. Try again in a moment.")
                .to_string();
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
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "status": "blocked",
                "text": user_message,
                "streamChunks": [{ "index": 0, "text": user_message }],
                "sources": [],
                "toolCallsAllowed": false,
                "error": typed_error
            }))
        }
    };
    finish_ai_operation(&app, &operation_id).await;
    final_result
}

#[tauri::command]
async fn fluxora_ai_chat_respond(app: AppHandle, request: Value) -> Result<Value, String> {
    execute_ai_chat_request(app, request).await
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BridgeLane {
    Main,
    Plugin,
    Interactive,
    Background,
    Connection,
    Download,
    Install,
}

impl BridgeLane {
    const ALL: [Self; 7] = [
        Self::Main,
        Self::Plugin,
        Self::Interactive,
        Self::Background,
        Self::Connection,
        Self::Download,
        Self::Install,
    ];

    fn label(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Plugin => "plugin",
            Self::Interactive => "interactive",
            Self::Background => "background",
            Self::Connection => "connection",
            Self::Download => "download",
            Self::Install => "install",
        }
    }
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            process: Mutex::new(BridgeProcess::for_lane(BridgeLane::Main)),
            plugin_process: Mutex::new(BridgeProcess::for_lane(BridgeLane::Plugin)),
            interactive_process: Mutex::new(BridgeProcess::for_lane(BridgeLane::Interactive)),
            background_process: Mutex::new(BridgeProcess::for_lane(BridgeLane::Background)),
            connection_process: Mutex::new(BridgeProcess::for_lane(BridgeLane::Connection)),
            download_process: Mutex::new(BridgeProcess::for_lane(BridgeLane::Download)),
            install_process: Mutex::new(BridgeProcess::for_lane(BridgeLane::Install)),
        }
    }
}

impl BridgeState {
    fn process(&self, lane: BridgeLane) -> &Mutex<BridgeProcess> {
        match lane {
            BridgeLane::Main => &self.process,
            BridgeLane::Plugin => &self.plugin_process,
            BridgeLane::Interactive => &self.interactive_process,
            BridgeLane::Background => &self.background_process,
            BridgeLane::Connection => &self.connection_process,
            BridgeLane::Download => &self.download_process,
            BridgeLane::Install => &self.install_process,
        }
    }
}

fn bridge_lane_for_method(method: &str) -> BridgeLane {
    match method {
        "plugins.list" | "plugins.listPersisted" => BridgeLane::Plugin,
        "mods.checkUpdates" | "apiLimits.list" => BridgeLane::Background,
        "connections.listStatus"
        | "connections.restoreAll"
        | "connections.connect"
        | "connections.disconnect"
        | "nexus.getAuthStatus"
        | "nexus.connect"
        | "nexus.connectWithApiKey"
        | "nexus.disconnect" => BridgeLane::Connection,
        "connections.beginConnect"
        | "connections.completeConnect"
        | "connections.cancelPendingConnect"
        | "moddingflow.getManagedAiAccessToken"
        | "moddingflow.lookupArtifactPreview"
        | "moddingflow.previewActivationPlan"
        | "downloads.queueModdingFlowArtifact"
        | "nxm.captureLinks"
        | "nxm.importInboundDownloads"
        | "downloads.cancel"
        | "downloads.delete"
        | "downloads.rename"
        | "downloads.getDelta"
        | "downloads.list"
        | "downloads.resolveDuplicateDecision"
        | "downloads.resume" => BridgeLane::Download,
        "downloads.analyzeFomod"
        | "downloads.planInstall"
        | "downloads.analyzeFomodContentLayout"
        | "downloads.install"
        | "downloads.installFomod"
        | "archives.install"
        | "archives.planInstall"
        | "archives.installFomod"
        | "installs.submit"
        | "installs.cancel"
        | "installs.restore"
        | "installs.list"
        | "installs.get" => BridgeLane::Install,
        "downloads.analyzeContentLayout"
        | "profiles.previewTextFile"
        | "mods.getFileTree"
        | "mods.getModDetailsContent"
        | "mods.getModConflictTree"
        | "mods.getModDetailsSummary"
        | "mods.getEffectiveFileTreeRoot"
        | "mods.getEffectiveFileTreeChildren"
        | "mods.readTextFile"
        | "mods.previewTextFile"
        | "mods.startNifPreview"
        | "mods.prepareNifPreviewVariant"
        | "mods.prepareNifPreviewTextures"
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

fn nif_preview_asset_record(
    asset_id: String,
    prepared: &Value,
) -> Result<NifPreviewAssetRecord, String> {
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
        relative_path: public["relativePath"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        source: public["source"].as_str().unwrap_or_default().to_string(),
        content_key: public["contentKey"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    })
}

fn next_nif_preview_token(state: &NifPreviewSessionState, prefix: &str, seed: &str) -> String {
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

fn validate_public_bridge_method(method: &str) -> Result<(), &'static str> {
    if method == PRIVATE_NEXUS_API_AUTH_HEADER_METHOD
        || PRIVATE_MODDINGFLOW_NATIVE_METHODS.contains(&method)
    {
        return Err("Unsupported bridge method.");
    }
    Ok(())
}

fn language_changed_event_payload(
    method: &str,
    result: &Result<Value, String>,
    operation_id: &str,
) -> Option<Value> {
    if method != "settings.setLanguage" {
        return None;
    }

    let language = result.as_ref().ok()?.get("language")?.as_str()?;
    Some(json!({
        "language": language,
        "operationId": operation_id
    }))
}

#[tauri::command]
async fn fluxora_bridge_request(
    app: AppHandle,
    method: String,
    params: Value,
    request: Option<OperationRequest>,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    validate_public_bridge_method(&method).map_err(str::to_string)?;

    let request = request.unwrap_or(OperationRequest {
        operation_id: Some(operation_id(None, &method)),
    });
    execute_bridge_request(
        app,
        method,
        params,
        request,
        timeout_ms.unwrap_or(BRIDGE_TIMEOUT_MS),
        None,
    )
    .await
}

pub(crate) async fn trusted_moddingflow_bridge_request(
    app: &AppHandle,
    method: &str,
    params: Value,
    operation_id: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    execute_bridge_request(
        app.clone(),
        method.to_string(),
        params,
        OperationRequest {
            operation_id: Some(operation_id.to_string()),
        },
        timeout_ms,
        Some(BridgeLane::Download),
    )
    .await
}

async fn execute_bridge_request(
    app: AppHandle,
    method: String,
    params: Value,
    request: OperationRequest,
    timeout_ms: u64,
    lane_override: Option<BridgeLane>,
) -> Result<Value, String> {
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
    let lane = lane_override.unwrap_or_else(|| bridge_lane_for_method(&method));
    let queue_started_at = Instant::now();
    let mut bridge = state.process(lane).lock().await;
    let queue_wait_us = queue_started_at.elapsed().as_micros();
    let result = bridge
        .request(&app, &method, params, request, timeout_ms)
        .await;

    if let Some(payload) = language_changed_event_payload(&method, &result, &operation_id) {
        let _ = app.emit(SETTINGS_LANGUAGE_CHANGED_EVENT, &payload);
    }

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
    let model_handle =
        register_nif_preview_assets(&state, &mut session, std::slice::from_ref(model))?
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
        let handle = register_nif_preview_assets(&state, session, std::slice::from_ref(&prepared))?
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
        let asset =
            session.assets.get(&asset_id).cloned().ok_or_else(|| {
                "NIF preview asset token is invalid for this session.".to_string()
            })?;
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
    let mut first_error = None;
    for lane in BridgeLane::ALL {
        let result = {
            let mut bridge = state.process(lane).lock().await;
            bridge.shutdown(&app, request.clone()).await
        };
        if first_error.is_none() {
            first_error = result.err();
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
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

async fn find_remaining_vfs_process(
    exited_process_id: u32,
) -> Option<process_platform::ProcessInfo> {
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
fn fluxora_open_manager_default_app_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:defaultapps?registeredAppUser=Fluxora")
            .spawn()
            .map_err(|_| {
                "Windows Default Apps settings could not be opened for Fluxora.".to_string()
            })?;
        return Ok(());
    }

    #[cfg(not(windows))]
    Err("Manager protocol selection is available only on Windows.".to_string())
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
fn fluxora_clipboard_write_text(app: AppHandle, text: String) -> Result<(), String> {
    if text.is_empty() {
        return Err("Clipboard text must not be empty.".to_string());
    }

    app.clipboard()
        .write_text(text)
        .map_err(|error| format!("Failed to write clipboard text: {error}"))
}

#[tauri::command]
async fn fluxora_show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        show_activation_window(&window, true);
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskbarProgressStateDto {
    status: TaskbarProgressStatusDto,
    progress: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TaskbarProgressStatusDto {
    None,
    Normal,
    Indeterminate,
    Paused,
    Error,
}

fn to_tauri_taskbar_progress(state: TaskbarProgressStateDto) -> Result<ProgressBarState, String> {
    if state.progress.is_some_and(|progress| progress > 100) {
        return Err("taskbar progress must be within 0..=100".to_string());
    }
    if matches!(state.status, TaskbarProgressStatusDto::Normal) && state.progress.is_none() {
        return Err("normal taskbar progress requires a percentage".to_string());
    }
    if matches!(
        state.status,
        TaskbarProgressStatusDto::None | TaskbarProgressStatusDto::Indeterminate
    ) && state.progress.is_some()
    {
        return Err("non-determinate taskbar progress must not include a percentage".to_string());
    }

    let status = match state.status {
        TaskbarProgressStatusDto::None => ProgressBarStatus::None,
        TaskbarProgressStatusDto::Normal => ProgressBarStatus::Normal,
        TaskbarProgressStatusDto::Indeterminate => ProgressBarStatus::Indeterminate,
        TaskbarProgressStatusDto::Paused => ProgressBarStatus::Paused,
        TaskbarProgressStatusDto::Error => ProgressBarStatus::Error,
    };
    Ok(ProgressBarState {
        status: Some(status),
        progress: state.progress,
    })
}

#[tauri::command]
async fn fluxora_window_set_taskbar_progress(
    window: tauri::WebviewWindow,
    state: TaskbarProgressStateDto,
) -> Result<(), String> {
    let progress = to_tauri_taskbar_progress(state)?;
    window
        .set_progress_bar(progress)
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
        show_activation_window(&window, true);
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
        show_activation_window(&window, true);
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
        show_activation_window(&window, true);
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

fn ai_text_editor_window_url(
    chat_id: &str,
    file_ref: &str,
    file_name: &str,
    first_changed_line: usize,
) -> String {
    format!(
        "/?window=text-editor&aiChat={}&fileRef={}&name={}&line={}",
        encode_query_component(chat_id),
        encode_query_component(file_ref),
        encode_query_component(file_name),
        first_changed_line.max(1)
    )
}

#[tauri::command]
async fn fluxora_open_ai_text_editor_window(
    app: AppHandle,
    chat_id: String,
    file_ref: String,
    file_name: String,
    first_changed_line: usize,
) -> Result<(), String> {
    let chat_id = chat_id.trim();
    let file_ref = file_ref.trim();
    if chat_id.is_empty() || file_ref.is_empty() {
        return Err("AI text editor requires chatId and fileRef.".to_string());
    }
    let file_name = if file_name.trim().is_empty() {
        "Editor"
    } else {
        file_name.trim()
    };
    let label = format!(
        "{TEXT_EDITOR_WINDOW_LABEL_PREFIX}:ai:{}",
        stable_label_suffix(&format!("{chat_id}\u{0}{file_ref}"))
    );
    if let Some(window) = app.get_webview_window(&label) {
        show_activation_window(&window, true);
        return Ok(());
    }
    let url = ai_text_editor_window_url(chat_id, file_ref, file_name, first_changed_line);
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
        show_activation_window(&window, true);
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
        show_activation_window(&window, true);
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
    let watcher_generation = reserve_build_content_watch_generation(&state.requested_generation);
    let active_generation = state.generation.clone();
    let sequence = state.sequence.clone();
    let app_for_events = app.clone();
    let project_for_events = project_directory.clone();
    let downloads_for_events = downloads_path.to_string_lossy().to_string();
    let initial_delta = fluxora_bridge_request(
        app.clone(),
        "downloads.getDelta".to_string(),
        json!({
            "projectDirectory": project_directory.clone(),
            "sinceRevision": "",
            "reason": "watch-started",
        }),
        Some(request.clone()),
        None,
    )
    .await?;
    let revision = Arc::new(Mutex::new(
        initial_delta
            .get("revision")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    ));
    let revision_for_events = revision.clone();

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
                &revision_for_events,
                result,
            );
        },
    )
    .map_err(|error| error.to_string())?;

    debouncer
        .watch(&downloads_path, RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    let mut active = state.active.lock().await;
    if !build_content_watch_install_is_current(&state.requested_generation, watcher_generation) {
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
    let stopped_generation = reserve_build_content_watch_generation(&state.requested_generation);
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
    let watcher_generation = reserve_build_content_watch_generation(&state.requested_generation);
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
            if !build_content_watch_generation_is_current(&active_generation, watcher_generation) {
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
    if !build_content_watch_install_is_current(&state.requested_generation, watcher_generation) {
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
    let stopped_generation = reserve_build_content_watch_generation(&state.requested_generation);
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

#[cfg(feature = "native-ai-integration-fixture")]
#[doc(hidden)]
async fn run_native_ai_capability_fixture_call(
    app: &AppHandle,
    request: &Value,
    refs: &mut AiEntityRefRegistry,
    call_id: &str,
    name: &str,
    args: Value,
) -> Result<Value, String> {
    execute_ai_capability_tool_call_inner(
        app,
        request,
        &json!({ "callId": call_id, "name": name, "args": args }),
        "op_native_ai_capabilities",
        refs,
    )
    .await
}

#[cfg(feature = "native-ai-integration-fixture")]
fn native_ai_fixture_required_string(
    value: &Value,
    pointer: &str,
    label: &str,
) -> Result<String, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Native AI capability fixture did not return {label}: {value}"))
}

#[cfg(feature = "native-ai-integration-fixture")]
#[doc(hidden)]
pub fn run_native_ai_integration_fixture(
    game_directory: &Path,
    install_root_directory: &Path,
    download_archive: &Path,
) -> Result<Value, String> {
    reset_native_ai_fixture_traces();
    let app = tauri::Builder::default()
        .manage(BridgeState::default())
        .manage(AiHostState::default())
        .manage(SpeechHostState::default())
        .manage(MicrophonePermissionState::default())
        .manage(AiDirtyEditorState::default())
        .manage(AiCompensationState::default())
        .manage(OperationStatusState::default())
        .manage(DownloadsFolderWatchState::default())
        .manage(BuildContentWatchState::default())
        .manage(NifPreviewSessionState::default())
        .build(tauri::generate_context!())
        .map_err(|error| format!("Tauri integration fixture could not start: {error}"))?;
    let handle = app.handle().clone();

    tauri::async_runtime::block_on(async move {
        let operation = OperationRequest {
            operation_id: Some("op_native_ai_integration".to_string()),
        };
        let created = {
            let state = bridge_state(&handle);
            let mut bridge = state.process.lock().await;
            bridge
                .request(
                    &handle,
                    "projects.create",
                    json!({
                        "projectName": "AI Native Integration",
                        "templateId": "skyrimse",
                        "gamePath": game_directory.to_string_lossy(),
                        "installRootDirectory": install_root_directory.to_string_lossy()
                    }),
                    operation.clone(),
                    BRIDGE_TIMEOUT_MS,
                )
                .await?
        };
        let project_directory = created
            .get("projectDirectory")
            .and_then(Value::as_str)
            .ok_or_else(|| "Native project fixture did not return projectDirectory.".to_string())?
            .to_string();
        {
            let state = bridge_state(&handle);
            let mut bridge = state.process.lock().await;
            bridge
                .request(
                    &handle,
                    "mods.createEmpty",
                    json!({
                        "projectDirectory": project_directory,
                        "modName": "Cabbage CS Preset"
                    }),
                    operation.clone(),
                    BRIDGE_TIMEOUT_MS,
                )
                .await?;
            let initial_order = bridge
                .request(
                    &handle,
                    "mods.getOrder",
                    json!({
                        "projectDirectory": project_directory,
                        "profileName": "Default"
                    }),
                    operation.clone(),
                    BRIDGE_TIMEOUT_MS,
                )
                .await?;
            let order_item_id = initial_order
                .as_array()
                .and_then(|items| items.first())
                .and_then(|item| item.get("orderId"))
                .and_then(Value::as_str)
                .ok_or_else(|| "Native source mod order id is unavailable.".to_string())?;
            bridge
                .request(
                    &handle,
                    "mods.moveOrderItem",
                    json!({
                        "projectDirectory": project_directory,
                        "profileName": "Default",
                        "orderItemId": order_item_id,
                        "targetIndex": 0
                    }),
                    operation.clone(),
                    BRIDGE_TIMEOUT_MS,
                )
                .await?;
            for mod_name in [
                "No Grass In Objects - Grass Control",
                "Generic Visual Tuning",
                "Fluxora AI Overrides",
            ] {
                bridge
                    .request(
                        &handle,
                        "mods.createEmpty",
                        json!({
                            "projectDirectory": project_directory,
                            "modName": mod_name
                        }),
                        operation.clone(),
                        BRIDGE_TIMEOUT_MS,
                    )
                    .await?;
            }
        }
        let capability_request = json!({
            "fileWorkspace": {
                "projectDirectory": project_directory,
                "templateId": "skyrimse",
                "profile": "Default"
            }
        });
        let plugin_fixture_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Cabbage CS Preset")
            .join("AIIntegration.esp");
        std::fs::write(&plugin_fixture_path, b"TES4")
            .map_err(|error| format!("Native plugin fixture could not be written: {error}"))?;
        std::fs::write(
            plugin_fixture_path.with_file_name("AIIntegrationSecond.esp"),
            b"TES4",
        )
        .map_err(|error| format!("Second native plugin fixture could not be written: {error}"))?;
        let mut capability_refs = AiEntityRefRegistry::default();

        let mod_list = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "mods-list",
            "local.mods.list",
            json!({}),
        )
        .await?;
        let mod_ref =
            native_ai_fixture_required_string(&mod_list, "/result/data/mods/0/modRef", "modRef")?;
        let mod_enabled = mod_list
            .pointer("/result/data/mods/0/isEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let mod_change = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "mods-set-enabled",
            "local.mods.set_enabled",
            json!({ "modRef": mod_ref, "isEnabled": !mod_enabled }),
        )
        .await?;
        let mod_token = native_ai_fixture_required_string(
            &mod_change,
            "/result/data/compensationToken",
            "mod compensation token",
        )?;
        let mod_undo = fluxora_ai_undo_capability(
            handle.clone(),
            mod_token,
            Some(OperationRequest {
                operation_id: Some("op_native_ai_mod_undo".to_string()),
            }),
        )
        .await?;

        let plugin_list = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "plugins-list",
            "local.plugins.list",
            json!({}),
        )
        .await?;
        let plugins = plugin_list
            .pointer("/result/data/plugins")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                format!("Native plugin fixture did not return plugins: {plugin_list}")
            })?;
        let movable_plugins = plugins
            .iter()
            .find(|plugin| {
                plugin.get("isPlugin").and_then(Value::as_bool) == Some(true)
                    && plugin.get("isLocked").and_then(Value::as_bool) != Some(true)
            })
            .into_iter()
            .chain(
                plugins
                    .iter()
                    .filter(|plugin| {
                        plugin.get("isPlugin").and_then(Value::as_bool) == Some(true)
                            && plugin.get("isLocked").and_then(Value::as_bool) != Some(true)
                    })
                    .skip(1),
            )
            .collect::<Vec<_>>();
        let movable_plugin = movable_plugins
            .last()
            .copied()
            .or_else(|| plugins.first())
            .ok_or_else(|| "Native plugin fixture returned no plugin rows.".to_string())?;
        let plugin_ref = movable_plugin
            .get("pluginRef")
            .and_then(Value::as_str)
            .ok_or_else(|| "Native plugin fixture did not return pluginRef.".to_string())?
            .to_string();
        let plugin_order = movable_plugin
            .get("order")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let plugin_target = movable_plugins
            .first()
            .and_then(|plugin| plugin.get("order"))
            .and_then(Value::as_u64)
            .unwrap_or(plugin_order);
        let plugin_change = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "plugins-move",
            "local.plugins.move",
            json!({ "pluginRef": plugin_ref, "targetIndex": plugin_target }),
        )
        .await?;
        let plugin_token = native_ai_fixture_required_string(
            &plugin_change,
            "/result/data/compensationToken",
            "plugin compensation token",
        )?;
        let plugin_undo = fluxora_ai_undo_capability(
            handle.clone(),
            plugin_token,
            Some(OperationRequest {
                operation_id: Some("op_native_ai_plugin_undo".to_string()),
            }),
        )
        .await?;

        request_ai_capability_bridge(
            &handle,
            "downloads.importFile",
            json!({
                "projectDirectory": project_directory,
                "sourcePath": download_archive.to_string_lossy()
            }),
            "op_native_ai_download_import",
        )
        .await?;
        let download_list = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "downloads-list",
            "local.downloads.list",
            json!({}),
        )
        .await?;
        let download_ref = native_ai_fixture_required_string(
            &download_list,
            "/result/data/downloads/0/downloadRef",
            "downloadRef",
        )?;

        let mut install_result = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "install-submit",
            "local.installs.submit_download",
            json!({ "downloadRef": download_ref, "modName": "AI Integration Installed Mod" }),
        )
        .await?;
        let operation_ref = native_ai_fixture_required_string(
            &install_result,
            "/result/data/operationRef",
            "install operationRef",
        )?;
        for poll in 0..80 {
            if install_result
                .pointer("/result/data/postconditionVerified")
                .and_then(Value::as_bool)
                == Some(true)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
            install_result = run_native_ai_capability_fixture_call(
                &handle,
                &capability_request,
                &mut capability_refs,
                &format!("install-get-{poll}"),
                "local.installs.get",
                json!({ "operationRef": operation_ref }),
            )
            .await?;
        }
        let install_token = native_ai_fixture_required_string(
            &install_result,
            "/result/data/compensationToken",
            "install compensation token after completion",
        )?;
        let install_undo = fluxora_ai_undo_capability(
            handle.clone(),
            install_token,
            Some(OperationRequest {
                operation_id: Some("op_native_ai_install_undo".to_string()),
            }),
        )
        .await?;

        let refreshed_downloads = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "downloads-refresh",
            "local.downloads.list",
            json!({}),
        )
        .await?;
        let refreshed_download_ref = native_ai_fixture_required_string(
            &refreshed_downloads,
            "/result/data/downloads/0/downloadRef",
            "refreshed downloadRef",
        )?;
        let profile_change = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "profiles-create",
            "local.profiles.create",
            json!({ "profileName": "AI Integration Profile" }),
        )
        .await?;
        let profile_conflict = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "profiles-create-conflict",
            "local.profiles.create",
            json!({ "profileName": "AI Integration Profile" }),
        )
        .await?;
        let profile_token = native_ai_fixture_required_string(
            &profile_change,
            "/result/data/compensationToken",
            "profile compensation token",
        )?;
        let profile_undo = fluxora_ai_undo_capability(
            handle.clone(),
            profile_token,
            Some(OperationRequest {
                operation_id: Some("op_native_ai_profile_undo".to_string()),
            }),
        )
        .await?;

        let language = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "settings-get-language",
            "local.settings.get_language",
            json!({}),
        )
        .await?;
        let original_language = language
            .pointer("/result/data/language")
            .and_then(Value::as_str)
            .unwrap_or("en");
        let requested_language = if original_language == "de" {
            "en"
        } else {
            "de"
        };
        let setting_change = run_native_ai_capability_fixture_call(
            &handle,
            &capability_request,
            &mut capability_refs,
            "settings-set-language",
            "local.settings.set_language",
            json!({ "language": requested_language }),
        )
        .await?;
        let setting_token = native_ai_fixture_required_string(
            &setting_change,
            "/result/data/compensationToken",
            "setting compensation token",
        )?;
        let setting_undo = fluxora_ai_undo_capability(
            handle.clone(),
            setting_token,
            Some(OperationRequest {
                operation_id: Some("op_native_ai_setting_undo".to_string()),
            }),
        )
        .await?;

        let capability_scenarios = json!({
            "mod": {
                "postconditionVerified": mod_change.pointer("/result/data/postconditionVerified").cloned().unwrap_or(Value::Null),
                "undo": mod_undo
            },
            "plugin": {
                "postconditionVerified": plugin_change.pointer("/result/data/postconditionVerified").cloned().unwrap_or(Value::Null),
                "undo": plugin_undo
            },
            "download": {
                "postconditionVerified": !refreshed_download_ref.is_empty(),
                "opaqueRefVerified": refreshed_download_ref.starts_with("download_")
            },
            "install": {
                "postconditionVerified": install_result.pointer("/result/data/postconditionVerified").cloned().unwrap_or(Value::Null),
                "undo": install_undo
            },
            "profile": {
                "postconditionVerified": profile_change.pointer("/result/data/postconditionVerified").cloned().unwrap_or(Value::Null),
                "conflict": profile_conflict,
                "undo": profile_undo
            },
            "setting": {
                "postconditionVerified": setting_change.pointer("/result/data/postconditionVerified").cloned().unwrap_or(Value::Null),
                "undo": setting_undo
            }
        });
        let virtual_path = PathBuf::from("SKSE")
            .join("Plugins")
            .join("CommunityShaders")
            .join("SettingsUser.json");
        let source_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Cabbage CS Preset")
            .join(&virtual_path);
        std::fs::create_dir_all(
            source_path
                .parent()
                .ok_or_else(|| "Native fixture source parent is unavailable.".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        std::fs::write(
            &source_path,
            b"{\r\n\"Menu\":{\r\n\"ToggleKey\":35\r\n},\r\n\"ShaderBlockNextKey\":33\r\n}\r\n",
        )
        .map_err(|error| error.to_string())?;
        let distractor_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Cabbage CS Preset")
            .join("SKSE")
            .join("Plugins")
            .join("EternalFlamesCandles_SWAP.ini");
        std::fs::write(&distractor_path, b"[Shader]\r\nPageDown=unrelated\r\n")
            .map_err(|error| error.to_string())?;
        let weak_match_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Cabbage CS Preset")
            .join("Docs")
            .join("CommunityShaders-notes.json");
        std::fs::create_dir_all(
            weak_match_path
                .parent()
                .ok_or_else(|| "Native fixture weak-match parent is unavailable.".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        std::fs::write(&weak_match_path, b"{\"note\":\"weak discovery match\"}\r\n")
            .map_err(|error| error.to_string())?;
        let audio_virtual_path = PathBuf::from("SKSE").join("Plugins").join("AudioMixer.ini");
        let audio_source_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Cabbage CS Preset")
            .join(&audio_virtual_path);
        std::fs::write(
            &audio_source_path,
            b"; generic fixture\r\n[Audio]\r\nBattleMusicVolume=1.0\r\n",
        )
        .map_err(|error| error.to_string())?;
        let audio_distractor_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Cabbage CS Preset")
            .join("Docs")
            .join("AudioMixer.ini");
        std::fs::write(
            &audio_distractor_path,
            b"; unrelated documentation fixture\r\n[Audio]\r\nBattleMusicVolume=0.8\r\n",
        )
        .map_err(|error| error.to_string())?;
        let dual_audio_virtual_path = PathBuf::from("SKSE").join("Plugins").join("DualAudio.ini");
        let dual_audio_source_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Cabbage CS Preset")
            .join(&dual_audio_virtual_path);
        std::fs::write(
            &dual_audio_source_path,
            b"; ambiguous generic fixture\r\n[Audio]\r\nCombatVolume=1.0\r\nAmbientVolume=1.0\r\n",
        )
        .map_err(|error| error.to_string())?;
        let unsupported_virtual_path = PathBuf::from("SKSE")
            .join("Plugins")
            .join("UnsupportedAudio.ini");
        let unsupported_source_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Cabbage CS Preset")
            .join(&unsupported_virtual_path);
        std::fs::write(
            &unsupported_source_path,
            [0_u8, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8],
        )
        .map_err(|error| error.to_string())?;
        let ngio_virtual_path = PathBuf::from("SKSE")
            .join("Plugins")
            .join("GrassControl.ini");
        let ngio_source_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("No Grass In Objects - Grass Control")
            .join(&ngio_virtual_path);
        let ngio_managed_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Fluxora AI Overrides")
            .join(&ngio_virtual_path);
        let ngio_overwrite_path = PathBuf::from(&project_directory)
            .join("overwrite")
            .join(&ngio_virtual_path);
        std::fs::create_dir_all(
            ngio_source_path
                .parent()
                .ok_or_else(|| "Native NGIO fixture parent is unavailable.".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        std::fs::create_dir_all(
            ngio_managed_path
                .parent()
                .ok_or_else(|| "Native NGIO managed parent is unavailable.".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        std::fs::create_dir_all(
            ngio_overwrite_path
                .parent()
                .ok_or_else(|| "Native NGIO Overwrite parent is unavailable.".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        std::fs::write(
            &ngio_source_path,
            b"; source fixture\r\n[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=true\r\nSource-only=keep\r\n",
        )
        .map_err(|error| error.to_string())?;
        std::fs::write(
            &ngio_managed_path,
            b"; managed fixture\r\n[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=true\r\nManaged-only=keep\r\n",
        )
        .map_err(|error| error.to_string())?;
        std::fs::write(
            &ngio_overwrite_path,
            b"; overwrite fixture\r\n[Grass]\r\nUse-grass-cache=false\r\nOnly-load-from-cache=true\r\nOverwrite-only=keep\r\n",
        )
        .map_err(|error| error.to_string())?;
        let neutral_virtual_path = PathBuf::from("SKSE")
            .join("Plugins")
            .join("RendererTuning.ini");
        let neutral_source_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Generic Visual Tuning")
            .join(&neutral_virtual_path);
        std::fs::create_dir_all(
            neutral_source_path
                .parent()
                .ok_or_else(|| "Native neutral fixture parent is unavailable.".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        std::fs::write(
            &neutral_source_path,
            b"; neutral evidence-first fixture\r\n[Display]\r\nSharpness=0.50\r\nBloom=true\r\n",
        )
        .map_err(|error| error.to_string())?;

        if std::env::var("FLUXORA_AI_LIVE_PROVIDER_SMOKE").as_deref() == Ok("1") {
            let live_ngio_response = execute_ai_chat_request(
                handle.clone(),
                json!({
                    "operationId": "op_live_ai_ngio_evidence_first",
                    "runId": "run-live-ai-ngio-evidence-first",
                    "sessionId": "chat-live-ai-ngio-evidence-first",
                    "providerId": "gemini",
                    "modelId": "gemini-3.1-flash-lite",
                    "messages": [{
                        "role": "user",
                        "text": "Пожалуйста, безопасно настрой параметры травяного кэша в выбранной сборке. Сначала сам найди и прочитай конфиг. Если по найденным текущим значениям остаются два правдоподобных безопасных режима, задай один вопрос именно о настройках; путь у меня не спрашивай."
                    }],
                    "fileWorkspace": {
                        "schema": "fluxora.ai.file-workspace-envelope.v1",
                        "chatId": "chat-live-ai-ngio-evidence-first",
                        "projectId": "native-ai-integration",
                        "projectDirectory": project_directory,
                        "game": "Skyrim Special Edition",
                        "profile": "Default",
                        "counts": { "mods": 3, "plugins": 0, "downloads": 0 },
                        "dirtyFileRefs": []
                    }
                }),
            )
            .await?;
            let live_ngio_bridge_methods =
                native_ai_fixture_bridge_methods("op_live_ai_ngio_evidence_first");
            let live_ngio_events = native_ai_fixture_events("op_live_ai_ngio_evidence_first");
            let live_ngio_override_path = PathBuf::from(&project_directory)
                .join("mods")
                .join("Fluxora AI Overrides")
                .join(&ngio_virtual_path);
            let live_ngio_rollback = if live_ngio_response.get("status").and_then(Value::as_str)
                == Some("done")
                && live_ngio_override_path.is_file()
            {
                let state = bridge_state(&handle);
                let mut bridge = state.process.lock().await;
                Some(
                    bridge
                        .request(
                            &handle,
                            "buildFiles.rollbackRun",
                            json!({
                                "chatId": "chat-live-ai-ngio-evidence-first",
                                "runId": "run-live-ai-ngio-evidence-first"
                            }),
                            OperationRequest {
                                operation_id: Some(
                                    "op_live_ai_ngio_evidence_first_rollback".to_string(),
                                ),
                            },
                            BRIDGE_TIMEOUT_MS,
                        )
                        .await?,
                )
            } else {
                None
            };
            let live_ngio_override_exists_after_rollback = live_ngio_override_path.exists();
            {
                let state = ai_host_state(&handle);
                state.process.lock().await.reset().await;
            }
            {
                let state = bridge_state(&handle);
                state.process.lock().await.reset().await;
            }
            return Ok(json!({
                "ngioEvidenceFirst": {
                    "response": live_ngio_response,
                    "sourcePath": ngio_source_path.to_string_lossy(),
                    "overridePath": live_ngio_override_path.to_string_lossy(),
                    "rollback": live_ngio_rollback,
                    "overrideExistsAfterRollback": live_ngio_override_exists_after_rollback,
                    "bridgeMethods": live_ngio_bridge_methods,
                    "events": live_ngio_events
                }
            }));
        }

        let response = execute_ai_chat_request(
            handle.clone(),
            json!({
                "operationId": "op_native_ai_integration",
                "runId": "run-native-ai-integration",
                "sessionId": "chat-native-ai-integration",
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "messages": [{
                    "role": "user",
                    "text": "Можешь в Community Shaders сделать так, чтобы Menu.ToggleKey был PageDown?"
                }],
                "fileWorkspace": {
                    "schema": "fluxora.ai.file-workspace-envelope.v1",
                    "chatId": "chat-native-ai-integration",
                    "projectId": "native-ai-integration",
                    "projectDirectory": project_directory,
                    "game": "Skyrim Special Edition",
                    "profile": "Default",
                    "counts": { "mods": 1, "plugins": 0, "downloads": 0 },
                    "dirtyFileRefs": []
                }
            }),
        )
        .await?;
        let order = {
            let state = bridge_state(&handle);
            let mut bridge = state.process.lock().await;
            bridge
                .request(
                    &handle,
                    "mods.getOrder",
                    json!({
                        "projectDirectory": project_directory,
                        "profileName": "Default"
                    }),
                    operation.clone(),
                    BRIDGE_TIMEOUT_MS,
                )
                .await?
        };
        let override_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Fluxora AI Overrides")
            .join(&virtual_path);
        if !override_path.is_file() {
            return Err(format!(
                "Native fixture did not create the managed override. Response: {}",
                serde_json::to_string(&response).unwrap_or_else(|_| "<unavailable>".to_string())
            ));
        }
        let source_content = std::fs::read_to_string(&source_path)
            .map_err(|error| format!("Native fixture source reread failed: {error}"))?;
        let managed_content = std::fs::read_to_string(&override_path)
            .map_err(|error| format!("Native fixture managed reread failed: {error}"))?;
        let rollback = {
            let state = bridge_state(&handle);
            let mut bridge = state.process.lock().await;
            bridge
                .request(
                    &handle,
                    "buildFiles.rollbackRun",
                    json!({
                        "chatId": "chat-native-ai-integration",
                        "runId": "run-native-ai-integration"
                    }),
                    OperationRequest {
                        operation_id: Some("op_native_ai_integration_rollback".to_string()),
                    },
                    BRIDGE_TIMEOUT_MS,
                )
                .await?
        };
        let override_exists_after_rollback = override_path.exists();

        let implicit_audio_response = execute_ai_chat_request(
            handle.clone(),
            json!({
                "operationId": "op_native_ai_implicit_audio",
                "runId": "run-native-ai-implicit-audio",
                "sessionId": "chat-native-ai-implicit-audio",
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "messages": [{
                    "role": "user",
                    "text": "The battle music in this build is painfully loud."
                }],
                "fileWorkspace": {
                    "schema": "fluxora.ai.file-workspace-envelope.v1",
                    "chatId": "chat-native-ai-implicit-audio",
                    "projectId": "native-ai-integration",
                    "projectDirectory": project_directory,
                    "game": "Skyrim Special Edition",
                    "profile": "Default",
                    "counts": { "mods": 1, "plugins": 0, "downloads": 0 },
                    "dirtyFileRefs": []
                }
            }),
        )
        .await?;
        let audio_override_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Fluxora AI Overrides")
            .join(&audio_virtual_path);
        if !audio_override_path.is_file() {
            return Err(format!(
                "Implicit repair fixture did not create the managed INI override. Response: {}",
                serde_json::to_string(&implicit_audio_response)
                    .unwrap_or_else(|_| "<unavailable>".to_string())
            ));
        }
        let audio_source_content = std::fs::read_to_string(&audio_source_path)
            .map_err(|error| format!("Implicit repair source reread failed: {error}"))?;
        let audio_managed_content = std::fs::read_to_string(&audio_override_path)
            .map_err(|error| format!("Implicit repair override reread failed: {error}"))?;
        let implicit_audio_rollback = {
            let state = bridge_state(&handle);
            let mut bridge = state.process.lock().await;
            bridge
                .request(
                    &handle,
                    "buildFiles.rollbackRun",
                    json!({
                        "chatId": "chat-native-ai-implicit-audio",
                        "runId": "run-native-ai-implicit-audio"
                    }),
                    OperationRequest {
                        operation_id: Some("op_native_ai_implicit_audio_rollback".to_string()),
                    },
                    BRIDGE_TIMEOUT_MS,
                )
                .await?
        };
        let audio_override_exists_after_rollback = audio_override_path.exists();

        let ambiguity_response = execute_ai_chat_request(
            handle.clone(),
            json!({
                "operationId": "op_native_ai_ambiguous_audio",
                "runId": "run-native-ai-ambiguous-audio",
                "sessionId": "chat-native-ai-ambiguous-audio",
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "messages": [{
                    "role": "user",
                    "text": "The music in this build is painfully loud."
                }],
                "fileWorkspace": {
                    "schema": "fluxora.ai.file-workspace-envelope.v1",
                    "chatId": "chat-native-ai-ambiguous-audio",
                    "projectId": "native-ai-integration",
                    "projectDirectory": project_directory,
                    "game": "Skyrim Special Edition",
                    "profile": "Default",
                    "counts": { "mods": 1, "plugins": 0, "downloads": 0 },
                    "dirtyFileRefs": []
                }
            }),
        )
        .await?;
        let ambiguity_goal_id = ambiguity_response
            .pointer("/execution/goalId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                format!("Ambiguity fixture did not return a goalId: {ambiguity_response}")
            })?
            .to_string();
        let ambiguity_question = ambiguity_response
            .pointer("/execution/pendingQuestion")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                format!(
                    "Ambiguity fixture did not return one pending question: {ambiguity_response}"
                )
            })?
            .to_string();
        let ambiguity_active_goal = json!({
            "goalId": ambiguity_goal_id,
            "mode": "repair",
            "origin": "implicit",
            "requestedOutcome": ambiguity_response
                .pointer("/execution/requestedOutcome")
                .and_then(Value::as_str)
                .unwrap_or("Reduce the painfully loud music."),
            "pendingQuestion": ambiguity_question
        });
        let ambiguity_continuation_response = execute_ai_chat_request(
            handle.clone(),
            json!({
                "operationId": "op_native_ai_ambiguous_audio_continuation",
                "runId": "run-native-ai-ambiguous-audio-continuation",
                "sessionId": "chat-native-ai-ambiguous-audio",
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "messages": [
                    { "role": "user", "text": "The music in this build is painfully loud." },
                    { "role": "assistant", "text": ambiguity_question },
                    { "role": "user", "text": "the first one" }
                ],
                "activeGoal": ambiguity_active_goal,
                "fileWorkspace": {
                    "schema": "fluxora.ai.file-workspace-envelope.v1",
                    "chatId": "chat-native-ai-ambiguous-audio",
                    "projectId": "native-ai-integration",
                    "projectDirectory": project_directory,
                    "game": "Skyrim Special Edition",
                    "profile": "Default",
                    "counts": { "mods": 1, "plugins": 0, "downloads": 0 },
                    "dirtyFileRefs": []
                }
            }),
        )
        .await?;
        let dual_audio_override_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Fluxora AI Overrides")
            .join(&dual_audio_virtual_path);
        if !dual_audio_override_path.is_file() {
            return Err(format!(
                "Ambiguity continuation did not create the managed INI override. Response: {}",
                serde_json::to_string(&ambiguity_continuation_response)
                    .unwrap_or_else(|_| "<unavailable>".to_string())
            ));
        }
        let dual_audio_source_content = std::fs::read_to_string(&dual_audio_source_path)
            .map_err(|error| format!("Ambiguity source reread failed: {error}"))?;
        let dual_audio_managed_content = std::fs::read_to_string(&dual_audio_override_path)
            .map_err(|error| format!("Ambiguity override reread failed: {error}"))?;
        let ambiguity_rollback = {
            let state = bridge_state(&handle);
            let mut bridge = state.process.lock().await;
            bridge
                .request(
                    &handle,
                    "buildFiles.rollbackRun",
                    json!({
                        "chatId": "chat-native-ai-ambiguous-audio",
                        "runId": "run-native-ai-ambiguous-audio-continuation"
                    }),
                    OperationRequest {
                        operation_id: Some(
                            "op_native_ai_ambiguous_audio_continuation_rollback".to_string(),
                        ),
                    },
                    BRIDGE_TIMEOUT_MS,
                )
                .await?
        };
        let dual_audio_override_exists_after_rollback = dual_audio_override_path.exists();

        let unsupported_response = execute_ai_chat_request(
            handle.clone(),
            json!({
                "operationId": "op_native_ai_unsupported_config",
                "runId": "run-native-ai-unsupported-config",
                "sessionId": "chat-native-ai-unsupported-config",
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "messages": [{
                    "role": "user",
                    "text": "This mod's unsupported binary config has the wrong volume."
                }],
                "fileWorkspace": {
                    "schema": "fluxora.ai.file-workspace-envelope.v1",
                    "chatId": "chat-native-ai-unsupported-config",
                    "projectId": "native-ai-integration",
                    "projectDirectory": project_directory,
                    "game": "Skyrim Special Edition",
                    "profile": "Default",
                    "counts": { "mods": 1, "plugins": 0, "downloads": 0 },
                    "dirtyFileRefs": []
                }
            }),
        )
        .await?;
        let unsupported_override_path = PathBuf::from(&project_directory)
            .join("mods")
            .join("Fluxora AI Overrides")
            .join(&unsupported_virtual_path);

        let ngio_evidence_first_response = execute_ai_chat_request(
            handle.clone(),
            json!({
                "operationId": "op_native_ai_ngio_evidence_first",
                "runId": "run-native-ai-ngio-evidence-first",
                "sessionId": "chat-native-ai-ngio-evidence-first",
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "messages": [{
                    "role": "user",
                    "text": "Проверь настройки травяного кэша в выбранной сборке и безопасно настрой их; если намерение неоднозначно, сначала выясни, какой режим нужен."
                }],
                "fileWorkspace": {
                    "schema": "fluxora.ai.file-workspace-envelope.v1",
                    "chatId": "chat-native-ai-ngio-evidence-first",
                    "projectId": "native-ai-integration",
                    "projectDirectory": project_directory,
                    "game": "Skyrim Special Edition",
                    "profile": "Default",
                    "counts": { "mods": 3, "plugins": 0, "downloads": 0 },
                    "dirtyFileRefs": []
                }
            }),
        )
        .await?;
        let ngio_bridge_methods =
            native_ai_fixture_bridge_methods("op_native_ai_ngio_evidence_first");
        let ngio_events = native_ai_fixture_events("op_native_ai_ngio_evidence_first");

        let neutral_evidence_first_response = execute_ai_chat_request(
            handle.clone(),
            json!({
                "operationId": "op_native_ai_neutral_evidence_first",
                "runId": "run-native-ai-neutral-evidence-first",
                "sessionId": "chat-native-ai-neutral-evidence-first",
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "messages": [{
                    "role": "user",
                    "text": "Inspect the selected build's renderer tuning and ask only about the settings if more than one safe adjustment remains."
                }],
                "fileWorkspace": {
                    "schema": "fluxora.ai.file-workspace-envelope.v1",
                    "chatId": "chat-native-ai-neutral-evidence-first",
                    "projectId": "native-ai-integration",
                    "projectDirectory": project_directory,
                    "game": "Skyrim Special Edition",
                    "profile": "Default",
                    "counts": { "mods": 3, "plugins": 0, "downloads": 0 },
                    "dirtyFileRefs": []
                }
            }),
        )
        .await?;
        let neutral_bridge_methods =
            native_ai_fixture_bridge_methods("op_native_ai_neutral_evidence_first");
        let neutral_events = native_ai_fixture_events("op_native_ai_neutral_evidence_first");

        let ngio_batch_response = execute_ai_chat_request(
            handle.clone(),
            json!({
                "operationId": "op_native_ai_ngio_batch",
                "runId": "run-native-ai-ngio-batch",
                "sessionId": "chat-native-ai-ngio-batch",
                "providerId": "gemini",
                "modelId": "gemini-3.1-flash-lite",
                "messages": [{
                    "role": "user",
                    "text": "Включи генерацию кэша травы: Use-grass-cache=true и Only-load-from-cache=false."
                }],
                "fileWorkspace": {
                    "schema": "fluxora.ai.file-workspace-envelope.v1",
                    "chatId": "chat-native-ai-ngio-batch",
                    "projectId": "native-ai-integration",
                    "projectDirectory": project_directory,
                    "game": "Skyrim Special Edition",
                    "profile": "Default",
                    "counts": { "mods": 3, "plugins": 0, "downloads": 0 },
                    "dirtyFileRefs": []
                }
            }),
        )
        .await?;
        let ngio_batch_bridge_methods = native_ai_fixture_bridge_methods("op_native_ai_ngio_batch");
        let ngio_batch_events = native_ai_fixture_events("op_native_ai_ngio_batch");
        let ngio_batch_source_content =
            std::fs::read_to_string(&ngio_source_path).map_err(|error| error.to_string())?;
        let ngio_batch_managed_content =
            std::fs::read_to_string(&ngio_managed_path).map_err(|error| error.to_string())?;
        let ngio_batch_overwrite_content =
            std::fs::read_to_string(&ngio_overwrite_path).map_err(|error| error.to_string())?;
        let ngio_batch_rollback =
            if ngio_batch_response.get("status").and_then(Value::as_str) == Some("done") {
                let state = bridge_state(&handle);
                let mut bridge = state.process.lock().await;
                Some(
                    bridge
                        .request(
                            &handle,
                            "buildFiles.rollbackRun",
                            json!({
                                "chatId": "chat-native-ai-ngio-batch",
                                "runId": "run-native-ai-ngio-batch"
                            }),
                            OperationRequest {
                                operation_id: Some("op_native_ai_ngio_batch_rollback".to_string()),
                            },
                            BRIDGE_TIMEOUT_MS,
                        )
                        .await?,
                )
            } else {
                None
            };
        let ngio_batch_source_after_rollback =
            std::fs::read_to_string(&ngio_source_path).map_err(|error| error.to_string())?;
        let ngio_batch_managed_after_rollback =
            std::fs::read_to_string(&ngio_managed_path).map_err(|error| error.to_string())?;
        let ngio_batch_overwrite_after_rollback =
            std::fs::read_to_string(&ngio_overwrite_path).map_err(|error| error.to_string())?;

        {
            let state = ai_host_state(&handle);
            state.process.lock().await.reset().await;
        }
        {
            let state = bridge_state(&handle);
            state.process.lock().await.reset().await;
        }

        Ok(json!({
            "response": response,
            "projectDirectory": project_directory,
            "sourcePath": source_path.to_string_lossy(),
            "overridePath": override_path.to_string_lossy(),
            "sourceContent": source_content,
            "managedContent": managed_content,
            "distractorPath": distractor_path.to_string_lossy(),
            "weakMatchPath": weak_match_path.to_string_lossy(),
            "rollback": rollback,
            "overrideExistsAfterRollback": override_exists_after_rollback,
            "implicitAudio": {
                "response": implicit_audio_response,
                "sourcePath": audio_source_path.to_string_lossy(),
                "overridePath": audio_override_path.to_string_lossy(),
                "sourceContent": audio_source_content,
                "managedContent": audio_managed_content,
                "rollback": implicit_audio_rollback,
                "overrideExistsAfterRollback": audio_override_exists_after_rollback
            },
            "ambiguousAudio": {
                "response": ambiguity_response,
                "continuationResponse": ambiguity_continuation_response,
                "sourcePath": dual_audio_source_path.to_string_lossy(),
                "overridePath": dual_audio_override_path.to_string_lossy(),
                "sourceContent": dual_audio_source_content,
                "managedContent": dual_audio_managed_content,
                "rollback": ambiguity_rollback,
                "overrideExistsAfterRollback": dual_audio_override_exists_after_rollback
            },
            "unsupportedConfig": {
                "response": unsupported_response,
                "sourcePath": unsupported_source_path.to_string_lossy(),
                "overridePath": unsupported_override_path.to_string_lossy(),
                "overrideExists": unsupported_override_path.exists()
            },
            "ngioEvidenceFirst": {
                "response": ngio_evidence_first_response,
                "sourcePath": ngio_source_path.to_string_lossy(),
                "bridgeMethods": ngio_bridge_methods,
                "events": ngio_events
            },
            "neutralEvidenceFirst": {
                "response": neutral_evidence_first_response,
                "sourcePath": neutral_source_path.to_string_lossy(),
                "bridgeMethods": neutral_bridge_methods,
                "events": neutral_events
            },
            "ngioBatch": {
                "response": ngio_batch_response,
                "sourceContent": ngio_batch_source_content,
                "managedContent": ngio_batch_managed_content,
                "overwriteContent": ngio_batch_overwrite_content,
                "rollback": ngio_batch_rollback,
                "sourceAfterRollback": ngio_batch_source_after_rollback,
                "managedAfterRollback": ngio_batch_managed_after_rollback,
                "overwriteAfterRollback": ngio_batch_overwrite_after_rollback,
                "bridgeMethods": ngio_batch_bridge_methods,
                "events": ngio_batch_events
            },
            "modOrder": order,
            "capabilityScenarios": capability_scenarios
        }))
    })
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_runtime_activation_args(
                app.clone(),
                argv,
                FluxoraActivationSource::SecondInstance,
            );
        }));
        builder = builder.plugin(tauri_plugin_deep_link::init());
    }

    builder
        .manage(BridgeState::default())
        .manage(AiHostState::default())
        .manage(SpeechHostState::default())
        .manage(MicrophonePermissionState::default())
        .manage(AiDirtyEditorState::default())
        .manage(AiCompensationState::default())
        .manage(OperationStatusState::default())
        .manage(DownloadsFolderWatchState::default())
        .manage(BuildContentWatchState::default())
        .manage(NifPreviewSessionState::default())
        .manage(ModdingFlowActivationRuntimeState::default())
        .manage(ModdingFlowConnectionRuntimeState::default())
        .manage(UpdateRuntimeState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app = app.handle().clone();
            configure_main_webview(&app);
            #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                let event_app = app.clone();
                app.deep_link().on_open_url(move |event| {
                    handle_runtime_activation_args(
                        event_app.clone(),
                        event.urls().iter().map(ToString::to_string).collect(),
                        FluxoraActivationSource::DeepLink,
                    );
                });
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    handle_runtime_activation_args(
                        app.clone(),
                        urls.iter().map(ToString::to_string).collect(),
                        FluxoraActivationSource::Startup,
                    );
                }
            }
            handle_runtime_activation_args(
                app.clone(),
                std::env::args().collect(),
                FluxoraActivationSource::Startup,
            );
            update_service::start_startup_update_check(app.clone());
            let cleanup_app = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval =
                    tokio::time::interval(Duration::from_millis(NIF_PREVIEW_CLEANUP_INTERVAL_MS));
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
            if matches!(event, WindowEvent::Focused(true)) {
                let _ = window.request_user_attention(None);
            }
            if window.label() == APP_UPDATE_WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let update_state = window.state::<UpdateRuntimeState>();
                    if app_update_window_close_is_blocked(&update_state) {
                        api.prevent_close();
                        return;
                    }
                    if let Some(main) = window.app_handle().get_webview_window(MAIN_WINDOW_LABEL) {
                        show_activation_window(&main, true);
                    }
                }
            }
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
            fluxora_updates_get_status,
            fluxora_updates_check,
            fluxora_updates_open_installer,
            fluxora_updates_installer_window_ready,
            fluxora_updates_download_and_install,
            fluxora_updates_cancel,
            fluxora_updates_dismiss_installer,
            fluxora_updates_renderer_ready,
            fluxora_runtime_paths,
            fluxora_current_executable,
            fluxora_security_state,
            fluxora_log,
            fluxora_ai_cancel_run,
            fluxora_ai_prepare_voice,
            fluxora_ai_arm_microphone_capture,
            fluxora_ai_reset_microphone_permission,
            fluxora_ai_transcribe_voice,
            fluxora_ai_cancel_voice_transcription,
            fluxora_ai_open_microphone_privacy_settings,
            fluxora_ai_get_status,
            fluxora_ai_restart_host,
            fluxora_ai_list_providers,
            fluxora_ai_list_models,
            fluxora_ai_connect_provider,
            fluxora_ai_disconnect_provider,
            fluxora_ai_test_provider,
            fluxora_ai_estimate_context,
            fluxora_ai_chat_respond,
            fluxora_ai_undo_capability,
            fluxora_ai_file_read,
            fluxora_ai_file_end_chat,
            fluxora_ai_file_save,
            fluxora_ai_file_set_dirty,
            fluxora_ai_file_rollback_file,
            fluxora_ai_file_rollback_run,
            fluxora_ai_file_get_rollback_states,
            fluxora_ai_file_reset_rollback_checkpoints,
            fluxora_bridge_request,
            fluxora_moddingflow_connection_status,
            fluxora_moddingflow_restore_connection,
            fluxora_moddingflow_connect,
            fluxora_moddingflow_cancel_connect,
            fluxora_moddingflow_disconnect,
            fluxora_moddingflow_consume_activations,
            fluxora_moddingflow_preview_activation,
            fluxora_moddingflow_preview_activation_plan,
            fluxora_moddingflow_accept_activation,
            fluxora_moddingflow_dismiss_activation,
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
            fluxora_open_manager_default_app_settings,
            fluxora_open_external,
            fluxora_shell_open_path,
            fluxora_shell_show_item_in_folder,
            fluxora_clipboard_write_text,
            fluxora_show_main_window,
            fluxora_transfer_open_mo2_in_main,
            fluxora_transfer_start_mo2_in_main,
            fluxora_window_set_taskbar_progress,
            fluxora_window_minimize,
            fluxora_window_toggle_maximize,
            fluxora_window_close,
            fluxora_open_settings_window,
            fluxora_open_build_settings_window,
            fluxora_open_mod_details_window,
            fluxora_open_text_editor_window,
            fluxora_open_ai_text_editor_window,
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
    use std::collections::BTreeSet;
    use std::env;
    use std::ffi::{OsStr, OsString};
    use std::fs;
    use std::sync::{Mutex, OnceLock};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[test]
    fn successful_language_mutation_selects_cross_window_event_payload() {
        let success = Ok(json!({ "language": "ru-ru" }));
        let failure = Err("language write failed".to_string());

        assert_eq!(
            language_changed_event_payload("settings.setLanguage", &success, "op_language_ru"),
            Some(json!({
                "language": "ru-ru",
                "operationId": "op_language_ru"
            }))
        );
        assert_eq!(
            language_changed_event_payload("settings.getLanguage", &success, "op_language_ru"),
            None
        );
        assert_eq!(
            language_changed_event_payload("settings.setLanguage", &failure, "op_language_ru"),
            None
        );
    }

    #[test]
    fn taskbar_progress_maps_normal_percentage() {
        let state = to_tauri_taskbar_progress(TaskbarProgressStateDto {
            status: TaskbarProgressStatusDto::Normal,
            progress: Some(42),
        })
        .expect("normal taskbar progress should be valid");

        assert!(matches!(state.status, Some(ProgressBarStatus::Normal)));
        assert_eq!(state.progress, Some(42));
    }

    #[test]
    fn taskbar_progress_maps_clear_indeterminate_paused_and_error_states() {
        let cleared = to_tauri_taskbar_progress(TaskbarProgressStateDto {
            status: TaskbarProgressStatusDto::None,
            progress: None,
        })
        .expect("cleared taskbar progress should be valid");
        let indeterminate = to_tauri_taskbar_progress(TaskbarProgressStateDto {
            status: TaskbarProgressStatusDto::Indeterminate,
            progress: None,
        })
        .expect("indeterminate taskbar progress should be valid");
        let paused = to_tauri_taskbar_progress(TaskbarProgressStateDto {
            status: TaskbarProgressStatusDto::Paused,
            progress: Some(55),
        })
        .expect("paused taskbar progress should be valid");
        let error = to_tauri_taskbar_progress(TaskbarProgressStateDto {
            status: TaskbarProgressStatusDto::Error,
            progress: Some(55),
        })
        .expect("error taskbar progress should be valid");

        assert!(matches!(cleared.status, Some(ProgressBarStatus::None)));
        assert!(matches!(
            indeterminate.status,
            Some(ProgressBarStatus::Indeterminate)
        ));
        assert!(matches!(paused.status, Some(ProgressBarStatus::Paused)));
        assert!(matches!(error.status, Some(ProgressBarStatus::Error)));
    }

    #[test]
    fn taskbar_progress_rejects_percentage_above_one_hundred() {
        let error = to_tauri_taskbar_progress(TaskbarProgressStateDto {
            status: TaskbarProgressStatusDto::Normal,
            progress: Some(101),
        })
        .err()
        .expect("out-of-range taskbar progress should fail");

        assert!(error.contains("0..=100"));
    }

    #[test]
    fn taskbar_progress_requires_percentage_for_normal_state() {
        let error = to_tauri_taskbar_progress(TaskbarProgressStateDto {
            status: TaskbarProgressStatusDto::Normal,
            progress: None,
        })
        .err()
        .expect("normal taskbar progress without a percentage should fail");

        assert!(error.contains("requires a percentage"));
    }

    #[test]
    fn taskbar_progress_rejects_percentage_for_non_determinate_states() {
        for status in [
            TaskbarProgressStatusDto::None,
            TaskbarProgressStatusDto::Indeterminate,
        ] {
            let error = to_tauri_taskbar_progress(TaskbarProgressStateDto {
                status,
                progress: Some(10),
            })
            .err()
            .expect("non-determinate taskbar progress should reject a percentage");

            assert!(error.contains("must not include a percentage"));
        }
    }

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
    fn sanitize_log_redacts_oauth_and_signed_transport_fields() {
        let message = sanitize_log(
            "callback=http://127.0.0.1:49152/oauth/fluxora/callback?code=oauth-code-42&state=oauth-state-42 \
             access_token=access-token-42 refresh_token:refresh-token-42 \
             code_verifier=verifier-42 signed=https://objects.example/file?X-Amz-Signature=signature-42&X-Amz-Security-Token=session-token-42 \
             email=user42@example.test user_id=01234567-89ab-4cde-8fab-0123456789ab",
        );

        for forbidden in [
            "oauth-code-42",
            "oauth-state-42",
            "access-token-42",
            "refresh-token-42",
            "verifier-42",
            "signature-42",
            "session-token-42",
            "user42@example.test",
            "01234567-89ab-4cde-8fab-0123456789ab",
        ] {
            assert!(
                !message.contains(forbidden),
                "sanitized log leaked forbidden OAuth material: {forbidden}"
            );
        }
        assert!(message.contains("code=[redacted-secret]"));
        assert!(message.contains("state=[redacted-secret]"));
        assert!(message.contains("access_token=[redacted-secret]"));
        assert!(message.contains("refresh_token=[redacted-secret]"));
        assert!(message.contains("code_verifier=[redacted-secret]"));
        assert!(message.contains("x-amz-signature=[redacted-secret]"));
        assert!(message.contains("x-amz-security-token=[redacted-secret]"));
    }

    #[test]
    fn operation_log_ids_preserve_safe_correlation_and_reject_personal_identifiers() {
        assert_eq!(
            sanitize_log_operation_id("01234567-89ab-4cde-8fab-0123456789ab"),
            "01234567-89ab-4cde-8fab-0123456789ab"
        );
        assert_eq!(
            sanitize_log_operation_id("user42@example.test"),
            "[invalid-operation-id]"
        );
        assert_eq!(
            sanitize_log_operation_id("op_safe\r\nforged"),
            "[invalid-operation-id]"
        );
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
            "fluxora://moddingflow/download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab",
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
    fn background_protocol_activation_never_forces_foreground_focus() {
        for focus_state in [Some(true), Some(false), None] {
            assert!(!should_request_activation_window_focus(
                focus_state,
                ActivationFocusPolicy::Preserve
            ));
        }
    }

    #[test]
    fn moddingflow_activation_log_contains_only_bounded_counts_and_source() {
        let message = moddingflow_activation_report_message(
            "second-instance",
            moddingflow_activation_runtime::ActivationRouteReport {
                disabled: false,
                queued: 1,
                duplicates: 2,
                rejected: 3,
                full: 4,
                delivered: 5,
            },
        );
        assert_eq!(
            message,
            "Activation routing completed. source=second-instance queued=1 duplicates=2 rejected=3 full=4 delivered=5"
        );
        assert!(!message.contains("artifact"));
        assert!(!message.contains("fluxora://"));
    }

    #[test]
    fn explicit_window_activation_focuses_only_when_confirmed_unfocused() {
        assert!(!should_request_activation_window_focus(
            Some(true),
            ActivationFocusPolicy::Request
        ));
        assert!(should_request_activation_window_focus(
            Some(false),
            ActivationFocusPolicy::Request
        ));
        assert!(!should_request_activation_window_focus(
            None,
            ActivationFocusPolicy::Request
        ));
    }

    #[test]
    fn downloads_folder_watch_suppresses_only_transient_sidecars() {
        assert!(is_transient_downloads_watch_path(Path::new(
            "C:/Downloads/mod.7z.crdownload"
        )));
        assert!(is_transient_downloads_watch_path(Path::new(
            "C:/Downloads/~$lock.tmp"
        )));
        assert!(is_transient_downloads_watch_path(Path::new(
            "C:/Downloads/.fb16ecc071"
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
    fn downloads_folder_delta_cadence_is_not_slower_than_legacy_polling() {
        assert!(DOWNLOADS_FOLDER_WATCH_DEBOUNCE_MS <= 500);
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
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/mods/Interrupted Install.installing/textures/partial.dds"
        )));
        assert!(is_transient_build_content_path(Path::new(
            "C:/Build/mods/Faultier's PBR Armors and Clothes.installing.layout/textures/layout.dds"
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

        let generated_only =
            build_content_changes(vec![generated_manifest], mods, profiles, NO_GAME_DATA);
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
            }
        ]));

        assert_eq!(providers[0]["connected"], true);
        assert_eq!(providers[0]["credentialState"], "connected");
        assert_eq!(providers.as_array().map(Vec::len), Some(1));
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
    fn operation_progress_payload_preserves_mod_update_progress() {
        let envelope = json!({
            "jsonrpc": "2.0",
            "method": "operations.progress",
            "params": {
                "phase": "checking-mod-updates",
                "completed": 2,
                "total": 5,
                "currentItem": "Unofficial Patch",
                "overallPercent": 40
            },
            "meta": {
                "operationId": "op_mod_updates_manual"
            }
        });

        let payload = operation_progress_payload(&envelope);

        assert_eq!(payload["operationId"], "op_mod_updates_manual");
        assert_eq!(payload["phase"], "checking-mod-updates");
        assert_eq!(payload["completed"], 2);
        assert_eq!(payload["total"], 5);
        assert_eq!(payload["currentItem"], "Unofficial Patch");
        assert_eq!(payload["overallPercent"], 40);
    }

    #[test]
    fn operation_progress_payload_preserves_nested_install_conflict_snapshot() {
        let envelope = json!({
            "jsonrpc": "2.0",
            "method": "operations.progress",
            "params": {
                "stage": "install-conflicts",
                "installConflictSnapshot": {
                    "operationId": "op_install",
                    "revision": 3,
                    "state": "ready",
                    "pendingOrderId": "pending-install:op_install",
                    "orderId": "",
                    "targetIndex": 2,
                    "rows": [{
                        "orderId": "pending-install:op_install",
                        "modUuid": "",
                        "fileCount": 4,
                        "conflictingFileCount": 1,
                        "overwrittenFileCount": 0,
                        "overwritingFileCount": 1,
                        "overwritesModIds": ["uuid-alpha"],
                        "overwrittenByModIds": []
                    }]
                }
            },
            "meta": {
                "operationId": "op_install"
            }
        });

        let payload = operation_progress_payload(&envelope);

        assert_eq!(payload["operationId"], "op_install");
        assert_eq!(payload["installConflictSnapshot"]["revision"], 3);
        assert_eq!(
            payload["installConflictSnapshot"]["rows"][0]["overwritesModIds"][0],
            "uuid-alpha"
        );
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
    fn public_bridge_blocks_private_native_methods_and_preserves_connection_routes() {
        for method in [
            PRIVATE_NEXUS_API_AUTH_HEADER_METHOD,
            "connections.beginConnect",
            "connections.completeConnect",
            "connections.cancelPendingConnect",
            "moddingflow.getManagedAiAccessToken",
            "moddingflow.lookupArtifactPreview",
            "moddingflow.previewActivationPlan",
        ] {
            assert_eq!(
                validate_public_bridge_method(method),
                Err("Unsupported bridge method."),
                "private auth method reached generic bridge dispatch: {method}"
            );
        }

        for method in [
            "connections.listStatus",
            "connections.connect",
            "connections.disconnect",
        ] {
            assert_eq!(validate_public_bridge_method(method), Ok(()));
            assert_eq!(bridge_lane_for_method(method), BridgeLane::Connection);
        }
    }

    #[test]
    fn managed_ai_oauth_refresh_is_allowed_exactly_once() {
        let error = serde_json::to_string(&json!({
            "code": "ai.oauth.refresh-required",
            "userMessage": "refresh"
        }))
        .expect("error payload");

        assert!(should_retry_managed_ai_oauth(&error, 0));
        assert!(!should_retry_managed_ai_oauth(&error, 1));
        assert!(!should_retry_managed_ai_oauth(
            r#"{"code":"ai.managed.quota-exhausted"}"#,
            0
        ));
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
            bridge_lane_for_method("workspace.getDelta"),
            BridgeLane::Main
        );
        assert_eq!(bridge_lane_for_method("plugins.list"), BridgeLane::Plugin);
        assert_eq!(
            bridge_lane_for_method("mods.checkUpdates"),
            BridgeLane::Background
        );
        assert_eq!(
            bridge_lane_for_method("connections.restoreAll"),
            BridgeLane::Connection
        );
        assert_eq!(
            bridge_queue_performance_message(
                "mods.getModDetailsContent",
                12_345,
                BridgeLane::Interactive
            ),
            "bridgeQueue lane=interactive method=mods.getModDetailsContent queueWaitUs=12345"
        );
        assert_eq!(
            bridge_queue_performance_message("downloads.list", 12, BridgeLane::Download),
            "bridgeQueue lane=download method=downloads.list queueWaitUs=12"
        );
        assert_eq!(
            bridge_queue_performance_message("installs.submit", 34, BridgeLane::Install),
            "bridgeQueue lane=install method=installs.submit queueWaitUs=34"
        );
    }

    #[test]
    fn bridge_routing_covers_every_native_method() {
        let expected = [
            ("system.handshake", BridgeLane::Main),
            ("system.initialize", BridgeLane::Main),
            ("system.getCapabilities", BridgeLane::Main),
            ("system.getCoreStatus", BridgeLane::Main),
            ("settings.getLanguage", BridgeLane::Main),
            ("settings.setLanguage", BridgeLane::Main),
            ("settings.getTheme", BridgeLane::Main),
            ("settings.setTheme", BridgeLane::Main),
            ("templates.list", BridgeLane::Main),
            ("templates.resolve", BridgeLane::Main),
            ("projects.previewDirectory", BridgeLane::Main),
            ("projects.create", BridgeLane::Main),
            ("projects.listConfigs", BridgeLane::Main),
            ("projects.openConfig", BridgeLane::Main),
            ("projects.rename", BridgeLane::Main),
            ("projects.delete", BridgeLane::Main),
            ("buildPaths.get", BridgeLane::Main),
            ("buildPaths.save", BridgeLane::Main),
            ("build.prepareWorkspaceIndexes", BridgeLane::Main),
            ("fluxPack.export", BridgeLane::Main),
            ("fluxPack.inspect", BridgeLane::Main),
            ("fluxPack.planInstall", BridgeLane::Main),
            ("fluxPack.install", BridgeLane::Main),
            ("profiles.list", BridgeLane::Main),
            ("profiles.previewTextFile", BridgeLane::Interactive),
            ("profiles.create", BridgeLane::Main),
            ("profiles.clone", BridgeLane::Main),
            ("profiles.rename", BridgeLane::Main),
            ("profiles.delete", BridgeLane::Main),
            ("executables.list", BridgeLane::Main),
            ("executables.save", BridgeLane::Main),
            ("executables.launch", BridgeLane::Main),
            ("executables.completeManagedLaunch", BridgeLane::Main),
            ("executables.getIcon", BridgeLane::Main),
            ("mods.listInstalled", BridgeLane::Main),
            ("mods.getWorkspace", BridgeLane::Main),
            ("workspace.getDelta", BridgeLane::Main),
            ("mods.getPersistedWorkspace", BridgeLane::Main),
            ("mods.invalidateFileCaches", BridgeLane::Main),
            ("mods.getOrder", BridgeLane::Main),
            ("mods.createSeparator", BridgeLane::Main),
            ("mods.deleteSeparator", BridgeLane::Main),
            ("mods.moveOrderItem", BridgeLane::Main),
            ("mods.rebasePendingInstall", BridgeLane::Main),
            ("mods.deleteInstalled", BridgeLane::Main),
            ("mods.renameInstalled", BridgeLane::Main),
            ("mods.createEmpty", BridgeLane::Main),
            ("mods.setEnabled", BridgeLane::Main),
            ("mods.setAllEnabled", BridgeLane::Main),
            ("mods.checkUpdates", BridgeLane::Background),
            ("mods.clearOverwrite", BridgeLane::Main),
            ("grassCache.generate", BridgeLane::Main),
            ("mods.getFileTree", BridgeLane::Interactive),
            ("mods.getModDetailsContent", BridgeLane::Interactive),
            ("mods.getModConflictTree", BridgeLane::Interactive),
            ("mods.getModDetailsSummary", BridgeLane::Interactive),
            ("mods.getEffectiveFileTree", BridgeLane::Main),
            ("mods.getEffectiveFileTreeRoot", BridgeLane::Interactive),
            ("mods.getEffectiveFileTreeChildren", BridgeLane::Interactive),
            ("mods.startNifPreview", BridgeLane::Interactive),
            ("mods.prepareNifPreviewVariant", BridgeLane::Interactive),
            ("mods.prepareNifPreviewTextures", BridgeLane::Interactive),
            ("mods.readTextFile", BridgeLane::Interactive),
            ("mods.previewTextFile", BridgeLane::Interactive),
            ("mods.saveTextFile", BridgeLane::Main),
            ("textFiles.read", BridgeLane::Interactive),
            ("textFiles.save", BridgeLane::Main),
            ("plugins.list", BridgeLane::Plugin),
            ("plugins.listPersisted", BridgeLane::Plugin),
            ("plugins.move", BridgeLane::Main),
            ("plugins.createSeparator", BridgeLane::Main),
            ("plugins.deleteSeparator", BridgeLane::Main),
            ("plugins.setEnabled", BridgeLane::Main),
            ("plugins.setAllEnabled", BridgeLane::Main),
            ("connections.listStatus", BridgeLane::Connection),
            ("connections.restoreAll", BridgeLane::Connection),
            ("connections.connect", BridgeLane::Connection),
            ("connections.disconnect", BridgeLane::Connection),
            ("connections.beginConnect", BridgeLane::Download),
            ("connections.completeConnect", BridgeLane::Download),
            ("connections.cancelPendingConnect", BridgeLane::Download),
            ("moddingflow.getManagedAiAccessToken", BridgeLane::Download),
            ("moddingflow.lookupArtifactPreview", BridgeLane::Download),
            ("moddingflow.previewActivationPlan", BridgeLane::Download),
            ("downloads.queueModdingFlowArtifact", BridgeLane::Download),
            ("nexus.getAuthStatus", BridgeLane::Connection),
            ("nexus.getApiAuthHeader", BridgeLane::Main),
            ("apiLimits.list", BridgeLane::Background),
            ("nexus.connect", BridgeLane::Connection),
            ("nexus.connectWithApiKey", BridgeLane::Connection),
            ("nexus.disconnect", BridgeLane::Connection),
            ("transfer.analyzeMo2", BridgeLane::Main),
            ("transfer.importMo2", BridgeLane::Main),
            ("nxm.registerProtocol", BridgeLane::Main),
            ("nxm.captureLinks", BridgeLane::Download),
            ("nxm.importInboundDownloads", BridgeLane::Download),
            ("downloads.list", BridgeLane::Download),
            ("downloads.getDelta", BridgeLane::Download),
            ("downloads.resolveDuplicateDecision", BridgeLane::Download),
            ("downloads.importFile", BridgeLane::Main),
            ("downloads.delete", BridgeLane::Download),
            ("downloads.rename", BridgeLane::Download),
            ("downloads.cancel", BridgeLane::Download),
            ("downloads.resume", BridgeLane::Download),
            ("downloads.analyzeContentLayout", BridgeLane::Interactive),
            ("downloads.planInstall", BridgeLane::Install),
            ("downloads.analyzeFomod", BridgeLane::Install),
            ("downloads.analyzeFomodContentLayout", BridgeLane::Install),
            ("installs.submit", BridgeLane::Install),
            ("installs.cancel", BridgeLane::Install),
            ("installs.restore", BridgeLane::Install),
            ("installs.list", BridgeLane::Install),
            ("installs.get", BridgeLane::Install),
            ("downloads.install", BridgeLane::Install),
            ("downloads.installFomod", BridgeLane::Install),
            ("archives.install", BridgeLane::Install),
            ("archives.planInstall", BridgeLane::Install),
            ("archives.installFomod", BridgeLane::Install),
            ("operations.setContext", BridgeLane::Main),
            ("operations.clearContext", BridgeLane::Main),
            ("operations.cancel", BridgeLane::Main),
            ("system.shutdown", BridgeLane::Main),
        ];

        let expected_methods = expected
            .iter()
            .map(|(method, _)| *method)
            .collect::<BTreeSet<_>>();
        let native_methods = include_str!("../../../backend/src/BridgeHost/FluxoraBridgeHost.cpp")
            .lines()
            .filter_map(|line| {
                line.split_once("request.method == L\"")
                    .map(|(_, rest)| rest)
            })
            .filter_map(|rest| rest.split_once('"').map(|(method, _)| method))
            .collect::<BTreeSet<_>>();

        assert_eq!(native_methods, expected_methods);
        for (method, expected_lane) in expected {
            assert_eq!(
                bridge_lane_for_method(method),
                expected_lane,
                "unexpected bridge lane for {method}"
            );
        }
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
    fn generic_and_compatible_connection_calls_use_the_connection_bridge_lane() {
        for method in [
            "connections.listStatus",
            "connections.restoreAll",
            "connections.connect",
            "connections.disconnect",
            "nexus.getAuthStatus",
            "nexus.connect",
            "nexus.connectWithApiKey",
            "nexus.disconnect",
        ] {
            assert_eq!(bridge_lane_for_method(method), BridgeLane::Connection);
        }
    }

    #[test]
    fn private_moddingflow_calls_use_the_single_download_bridge_owner() {
        for method in PRIVATE_MODDINGFLOW_NATIVE_METHODS {
            assert_eq!(bridge_lane_for_method(method), BridgeLane::Download);
        }
    }

    #[test]
    fn update_and_api_limit_calls_stay_on_the_background_bridge_lane() {
        assert_eq!(
            bridge_lane_for_method("mods.checkUpdates"),
            BridgeLane::Background
        );
        assert_eq!(
            bridge_lane_for_method("apiLimits.list"),
            BridgeLane::Background
        );
    }

    #[test]
    fn managed_launch_completion_uses_the_launch_bridge_host() {
        assert_eq!(
            bridge_lane_for_method("executables.launch"),
            BridgeLane::Main
        );
        assert_eq!(
            bridge_lane_for_method("executables.completeManagedLaunch"),
            BridgeLane::Main
        );
    }

    #[test]
    fn install_preflight_and_mutations_use_one_install_bridge_host() {
        for method in [
            "downloads.analyzeFomod",
            "downloads.planInstall",
            "downloads.analyzeFomodContentLayout",
            "downloads.install",
            "downloads.installFomod",
            "archives.install",
            "archives.planInstall",
            "archives.installFomod",
            "installs.submit",
            "installs.cancel",
            "installs.restore",
            "installs.list",
            "installs.get",
        ] {
            assert_eq!(bridge_lane_for_method(method), BridgeLane::Install);
        }
        assert_eq!(
            bridge_lane_for_method("downloads.analyzeContentLayout"),
            BridgeLane::Interactive
        );
    }

    #[test]
    fn destructive_installed_mod_delete_stays_on_the_main_bridge_lane() {
        assert_eq!(
            bridge_lane_for_method("mods.deleteInstalled"),
            BridgeLane::Main
        );
    }

    #[test]
    fn nexus_download_lifecycle_uses_one_download_bridge_host() {
        for method in [
            "nxm.captureLinks",
            "nxm.importInboundDownloads",
            "downloads.list",
            "downloads.getDelta",
            "downloads.resolveDuplicateDecision",
            "downloads.cancel",
            "downloads.resume",
            "downloads.delete",
        ] {
            assert_eq!(bridge_lane_for_method(method), BridgeLane::Download);
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
        assert_eq!(
            purge_expired_nif_preview_sessions(&mut sessions, now_millis()),
            1
        );
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
    fn ai_text_editor_url_uses_only_opaque_ref_and_reveal_line() {
        let url =
            ai_text_editor_window_url("chat private/1", "file_ref:opaque/42", "settings.ini", 17);
        assert!(url.contains("window=text-editor"));
        assert!(url.contains("aiChat=chat%20private%2F1"));
        assert!(url.contains("fileRef=file_ref%3Aopaque%2F42"));
        assert!(url.contains("line=17"));
        assert!(!url.contains("C%3A"));
    }

    #[test]
    fn ai_file_tool_redaction_and_dirty_envelope_are_local_guards() {
        let (redacted, applied) =
            redact_ai_file_text("safe=true\napi_key=abcdefghijklmnopqrstuvwxyz123456\nnext=value");
        assert!(applied);
        assert!(redacted.contains("[REDACTED SECRET-LIKE LINE]"));
        assert!(!redacted.contains("abcdefghijklmnopqrstuvwxyz123456"));

        let request = json!({
            "fileWorkspace": { "dirtyFileRefs": ["opaque-a", "opaque-b"] }
        });
        let refs = dirty_ai_file_refs(&request);
        assert!(refs.contains("opaque-a"));
        assert!(refs.contains("opaque-b"));
    }

    #[test]
    fn ai_host_tool_failures_do_not_impersonate_core_validation_failures() {
        let provider_error = "Gemini returned HTTP 400 with an unsupported function schema.";
        assert_eq!(
            ai_host_file_tool_error_code(provider_error),
            "ai.host.transport"
        );
        assert_eq!(
            ai_core_file_tool_error_code(provider_error),
            "native-failed"
        );
        assert_eq!(
            ai_core_file_tool_error_code("stale-version: the file changed"),
            "stale-version"
        );
        assert_eq!(
            ai_core_file_tool_error_code("AI file workspace chat is not active."),
            "session-inactive"
        );
        let typed = r#"{"code":"ai.provider.http","category":"provider","stage":"provider","retryable":false,"userMessage":"Gemini rejected the request.","debugId":"debug-1"}"#;
        assert_eq!(ai_host_file_tool_error_code(typed), "ai.provider.http");
    }

    #[test]
    fn ai_file_tool_failure_copy_distinguishes_host_outages_from_core_guards() {
        assert_eq!(
            ai_file_tool_failure_message("validation-failed"),
            "Fluxora blocked the file operation safely (validation-failed)."
        );
        assert_eq!(
            ai_file_tool_failure_message("stale-revision"),
            "Fluxora could not stabilize the build file index after one safe restart. Retry after current build file changes finish."
        );
        assert!(!ai_file_tool_failure_message("stale-revision").contains("native operation failed"));
    }

    #[test]
    fn ai_file_tool_cache_and_staged_targets_are_exact_and_run_local() {
        let args = json!({ "query": "SettingsUser.json", "scope": "build" });
        assert!(is_ai_read_only_file_tool("local.files.search"));
        assert!(!is_ai_read_only_file_tool("local.files.commit"));
        assert_eq!(
            ai_file_tool_cache_key("local.files.search", &args),
            ai_file_tool_cache_key("local.files.search", &args)
        );
        assert_ne!(
            ai_file_tool_cache_key("local.files.search", &args),
            ai_file_tool_cache_key(
                "local.files.search",
                &json!({ "query": "CommunityShaders", "scope": "build" })
            )
        );
        assert_eq!(
            ai_staged_mutation_target(&json!({ "kind": "patch", "fileRef": "opaque-1" })),
            "patch:opaque-1"
        );
        assert_eq!(
            ai_staged_mutation_target(&json!({
                "kind": "create",
                "parentRef": "folder-1",
                "fileName": "Settings.JSON"
            })),
            "create:folder-1:settings.json"
        );
        let first_ini_key = ai_staged_mutation_target(&json!({
            "kind": "ini-set",
            "fileRef": "opaque-ini-1",
            "section": "Grass",
            "key": "Use-grass-cache"
        }));
        let second_ini_key = ai_staged_mutation_target(&json!({
            "kind": "ini-set",
            "fileRef": "opaque-ini-1",
            "section": "Grass",
            "key": "Only-load-from-cache"
        }));
        let same_ini_key_with_different_case = ai_staged_mutation_target(&json!({
            "kind": "ini-remove",
            "fileRef": "opaque-ini-1",
            "section": " grass ",
            "key": "USE-GRASS-CACHE"
        }));
        assert_ne!(first_ini_key, second_ini_key);
        assert_eq!(first_ini_key, same_ini_key_with_different_case);
    }

    #[test]
    fn managed_override_staging_records_only_unique_or_explicitly_proven_refs() {
        let mut candidates = HashSet::new();
        let mut refs = HashSet::new();
        let mut blockers = AiFileMutationBlockers::default();
        record_ai_managed_override_refs(
            "local.files.discover",
            &json!({
                "result": {
                    "ok": true,
                    "data": {
                        "resolution": "ambiguous",
                        "candidates": [{
                            "effectiveWinner": true,
                            "file": {
                                "fileRef": "ambiguous-ref",
                                "scope": "build",
                                "managedOverrideEligible": true
                            }
                        }]
                    }
                }
            }),
            &mut candidates,
            &mut refs,
            &mut blockers,
        );
        assert!(candidates.contains("ambiguous-ref"));
        assert!(!refs.contains("ambiguous-ref"));

        record_ai_managed_override_refs(
            "local.files.discover",
            &json!({
                "result": {
                    "ok": true,
                    "data": {
                        "resolution": "unique",
                        "candidates": [
                            {
                                "effectiveWinner": true,
                                "file": {
                                    "fileRef": "overwrite-ref",
                                    "scope": "build",
                                    "managedOverrideEligible": false,
                                    "directMutationEligible": true
                                }
                            },
                            {
                                "effectiveWinner": false,
                                "file": {
                                    "fileRef": "non-winner-ref",
                                    "scope": "build",
                                    "managedOverrideEligible": true
                                }
                            }
                        ]
                    }
                }
            }),
            &mut candidates,
            &mut refs,
            &mut blockers,
        );
        record_ai_managed_override_refs(
            "local.files.search",
            &json!({
                "result": {
                    "ok": true,
                    "data": {
                        "entries": [{
                            "fileRef": "game-ref",
                            "parentRef": "game-parent-ref",
                            "scope": "game",
                            "managedOverrideEligible": true
                        }]
                    }
                }
            }),
            &mut candidates,
            &mut refs,
            &mut blockers,
        );
        record_ai_managed_override_refs(
            "local.files.search",
            &json!({
                "result": {
                    "ok": true,
                    "data": {
                        "entries": [{
                            "fileRef": "exact-search-ref",
                            "parentRef": "exact-parent-ref",
                            "scope": "build",
                            "managedOverrideEligible": true
                        }]
                    }
                }
            }),
            &mut candidates,
            &mut refs,
            &mut blockers,
        );
        record_ai_managed_override_refs(
            "local.files.search",
            &json!({
                "result": {
                    "ok": true,
                    "data": {
                        "entries": [
                            {
                                "fileRef": "chosen-candidate-ref",
                                "scope": "build",
                                "managedOverrideEligible": true
                            },
                            {
                                "fileRef": "other-candidate-ref",
                                "scope": "build",
                                "managedOverrideEligible": true
                            }
                        ]
                    }
                }
            }),
            &mut candidates,
            &mut refs,
            &mut blockers,
        );
        assert!(candidates.contains("chosen-candidate-ref"));
        assert!(candidates.contains("other-candidate-ref"));
        assert!(!refs.contains("chosen-candidate-ref"));
        assert!(refs.contains("overwrite-ref"));
        assert!(!refs.contains("non-winner-ref"));
        assert!(!refs.contains("game-ref"));
        assert!(!refs.contains("game-parent-ref"));
        assert!(refs.contains("exact-search-ref"));
        assert!(refs.contains("exact-parent-ref"));
        assert!(!refs.contains("other-candidate-ref"));
        assert_eq!(
            ai_file_mutation_authorization_blocker("ambiguous-ref", &refs, &blockers)
                .map(|(code, _)| code),
            Some("multiple-virtual-targets")
        );
        assert_eq!(
            ai_file_mutation_authorization_blocker("non-winner-ref", &refs, &blockers)
                .map(|(code, _)| code),
            Some("effective-winner-ref-mismatch")
        );
        assert_eq!(
            ai_file_mutation_authorization_blocker("game-ref", &refs, &blockers)
                .map(|(code, _)| code),
            Some("mutation-ineligible")
        );
        assert_eq!(
            ai_file_mutation_authorization_blocker("chosen-candidate-ref", &refs, &blockers)
                .map(|(code, _)| code),
            Some("multiple-virtual-targets")
        );
        assert_eq!(
            ai_file_mutation_authorization_blocker("unknown-ref", &refs, &blockers)
                .map(|(code, _)| code),
            Some("unproven-file-ref")
        );
        assert!(
            ai_file_mutation_authorization_blocker("exact-search-ref", &refs, &blockers).is_none()
        );
    }

    #[test]
    fn exact_search_after_read_requires_the_same_single_eligible_target() {
        assert!(ai_exact_search_proves_read_target(
            &json!({
                "entries": [{
                    "fileRef": "chosen-ref",
                    "scope": "build",
                    "managedOverrideEligible": true
                }]
            }),
            "chosen-ref"
        ));
        assert!(ai_exact_search_proves_read_target(
            &json!({
                "entries": [{
                    "fileRef": "overwrite-ref",
                    "scope": "build",
                    "managedOverrideEligible": false,
                    "directMutationEligible": true
                }]
            }),
            "overwrite-ref"
        ));
        for data in [
            json!({
                "entries": [
                    { "fileRef": "chosen-ref", "scope": "build", "managedOverrideEligible": true },
                    { "fileRef": "other-ref", "scope": "build", "managedOverrideEligible": true }
                ]
            }),
            json!({
                "entries": [{ "fileRef": "other-ref", "scope": "build", "managedOverrideEligible": true }]
            }),
            json!({
                "entries": [{ "fileRef": "chosen-ref", "scope": "downloads", "managedOverrideEligible": true }]
            }),
            json!({
                "entries": [{
                    "fileRef": "chosen-ref",
                    "scope": "build",
                    "managedOverrideEligible": false,
                    "directMutationEligible": false
                }]
            }),
        ] {
            assert!(!ai_exact_search_proves_read_target(&data, "chosen-ref"));
        }
    }

    #[test]
    fn ai_search_scope_is_normalized_before_native_dispatch_and_only_successes_are_cached() {
        let missing = normalize_ai_file_tool_args(
            "local.files.search",
            &json!({ "query": "SettingsUser.json" }),
        );
        let empty = normalize_ai_file_tool_args(
            "local.text.search",
            &json!({ "query": "ToggleKey", "scope": "  " }),
        );
        let initial_with_untrusted_revision = normalize_ai_file_tool_args(
            "local.files.search",
            &json!({
                "query": "GrassControl.ini",
                "scope": "build",
                "revision": "build-context-revision",
                "cursor": ""
            }),
        );
        let continuation = normalize_ai_file_tool_args(
            "local.files.search",
            &json!({
                "query": "GrassControl.ini",
                "scope": "build",
                "revision": "workspace-index-v2:abc",
                "cursor": "workspace-index-v2:abc|20"
            }),
        );
        assert_eq!(missing.get("scope").and_then(Value::as_str), Some("build"));
        assert_eq!(empty.get("scope").and_then(Value::as_str), Some("build"));
        assert_eq!(
            initial_with_untrusted_revision
                .get("revision")
                .and_then(Value::as_str),
            Some("")
        );
        assert_eq!(
            continuation.get("revision").and_then(Value::as_str),
            Some("workspace-index-v2:abc")
        );
        assert_eq!(
            continuation.get("cursor").and_then(Value::as_str),
            Some("workspace-index-v2:abc|20")
        );
        for scope in ["game", "downloads"] {
            let normalized = normalize_ai_file_tool_args(
                "local.files.search",
                &json!({ "query": "SettingsUser.json", "scope": scope }),
            );
            assert_eq!(normalized.get("scope").and_then(Value::as_str), Some(scope));
        }
        assert_eq!(
            ai_file_tool_cache_key("local.files.search", &missing),
            ai_file_tool_cache_key(
                "local.files.search",
                &json!({ "query": "SettingsUser.json", "scope": "build" })
            )
        );
        assert!(should_cache_ai_file_tool_result(&json!({
            "result": { "ok": true, "data": { "entries": [] } }
        })));
        assert!(!should_cache_ai_file_tool_result(&json!({
            "result": { "ok": false, "error": { "code": "validation-failed" } }
        })));
    }

    #[test]
    fn ai_content_search_uses_a_non_destructive_timeout_and_session_loss_is_recoverable() {
        assert_eq!(ai_build_files_timeout_ms("buildFiles.searchText"), 120_000);
        assert_eq!(ai_build_files_timeout_ms("buildFiles.search"), 60_000);
        assert_eq!(
            ai_build_files_timeout_ms("buildFiles.readText"),
            BRIDGE_TIMEOUT_MS
        );
        assert!(should_reopen_ai_file_session(
            "Bridge request timed out: buildFiles.searchText. Host process will be restarted"
        ));
        assert!(should_reopen_ai_file_session(
            "AI file workspace chat is not active."
        ));
        assert!(!should_reopen_ai_file_session("stale-version"));

        let stale_error = r#"{"schema":"fluxora.bridge.invoke-error.v1","method":"buildFiles.search","error":{"message":"Filename index changed; restart search before using earlier results.","details":{"reason":"build-files:stale-revision"}}}"#;
        assert_eq!(ai_core_file_tool_error_code(stale_error), "stale-revision");
        let retry = stale_ai_index_retry_params(
            "buildFiles.search",
            &json!({
                "chatId": "chat-stale-index",
                "scope": "build",
                "query": "GrassControl.ini",
                "revision": "workspace-index-v2:old",
                "cursor": "workspace-index-v2:old|20",
                "limit": 20
            }),
            stale_error,
            true,
        )
        .expect("read-only stale filename search should restart once");
        assert_eq!(retry.get("revision").and_then(Value::as_str), Some(""));
        assert_eq!(retry.get("cursor").and_then(Value::as_str), Some(""));
        assert_eq!(
            retry.get("query").and_then(Value::as_str),
            Some("GrassControl.ini")
        );
        assert!(stale_ai_index_retry_params(
            "buildFiles.apply",
            &json!({ "revision": "old", "cursor": "old|20" }),
            stale_error,
            false,
        )
        .is_none());
    }

    #[test]
    fn file_workspace_never_requests_a_second_chat_response_after_failed_begin() {
        assert!(should_request_independent_chat_response(false, false));
        assert!(!should_request_independent_chat_response(true, false));
        assert!(!should_request_independent_chat_response(true, true));
    }

    #[test]
    fn ai_shell_completion_gate_uses_verified_effects_and_requires_file_changes_only_for_files() {
        let domain_action = json!({
            "execution": {
                "kind": "action",
                "domain": "mods",
                "state": "completed",
                "verifiedEffects": [{ "tool": "local.mods.set_enabled" }]
            }
        });
        assert!(ai_shell_completion_evidence_satisfied(
            "action",
            &domain_action,
            false
        ));

        let file_action = json!({
            "execution": {
                "kind": "action",
                "domain": "files",
                "state": "completed",
                "verifiedEffects": [{ "tool": "local.files.commit" }]
            }
        });
        assert!(!ai_shell_completion_evidence_satisfied(
            "action",
            &file_action,
            false
        ));
        assert!(ai_shell_completion_evidence_satisfied(
            "action",
            &file_action,
            true
        ));

        let unverified = json!({
            "execution": {
                "kind": "action",
                "domain": "mods",
                "state": "completed",
                "verifiedEffects": []
            }
        });
        assert!(!ai_shell_completion_evidence_satisfied(
            "action",
            &unverified,
            false
        ));
    }

    #[test]
    fn semantic_stagnation_and_native_guards_keep_distinct_error_stages() {
        assert_eq!(
            ai_tool_terminal_error_classification("no-new-evidence"),
            ("tool-loop", "tool-loop")
        );
        assert_eq!(
            ai_tool_terminal_error_classification("protected"),
            ("safety", "native-guard")
        );
        assert_eq!(
            ai_tool_terminal_error_classification("permission-denied"),
            ("safety", "native-guard")
        );
        assert_eq!(
            ai_tool_terminal_error_classification("request-input-evidence-required"),
            ("tool-loop", "tool-loop")
        );
        let blocker = ai_file_tool_failure_message("request-input-evidence-required");
        assert!(blocker.contains("native read-only evidence"));
        assert!(!blocker.to_ascii_lowercase().contains("manually"));
    }

    #[test]
    fn irreversible_typed_tools_ask_one_concrete_native_question() {
        for (tool, expected_action) in [
            (
                "local.installs.cancel",
                "confirm-native-install-cancellation",
            ),
            (
                "local.projects.request_create",
                "open-native-project-creation-dialog",
            ),
            (
                "local.fluxpack.request_selection",
                "select-fluxpack-and-confirm-native-plan",
            ),
        ] {
            let (question, action) = irreversible_capability_question(tool)
                .expect("irreversible contract entry must ask exactly one question");
            assert!(!question.trim().is_empty());
            assert_eq!(action, expected_action);
        }
        assert_eq!(
            irreversible_capability_question("local.mods.set_enabled"),
            None
        );
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

    #[test]
    fn bridge_processes_keep_the_lane_identity_exported_to_the_native_host() {
        tauri::async_runtime::block_on(async {
            let state = BridgeState::default();
            for lane in BridgeLane::ALL {
                assert_eq!(state.process(lane).lock().await.lane, lane);
            }
        });
    }

    #[test]
    fn plugin_bridge_lane_does_not_wait_for_the_main_lane_lock() {
        tauri::async_runtime::block_on(async {
            let state = BridgeState::default();
            let _main_lane = state.process.lock().await;
            let plugin_lane = timeout(Duration::from_millis(50), state.plugin_process.lock()).await;

            assert!(plugin_lane.is_ok());
        });
    }

    #[test]
    fn background_bridge_lane_does_not_wait_for_the_main_or_interactive_lane_locks() {
        tauri::async_runtime::block_on(async {
            let state = BridgeState::default();
            let _main_lane = state.process.lock().await;
            let _interactive_lane = state.interactive_process.lock().await;
            let background_lane =
                timeout(Duration::from_millis(50), state.background_process.lock()).await;

            assert!(background_lane.is_ok());
        });
    }

    #[test]
    fn connection_bridge_lane_does_not_wait_for_background_or_main_lane_locks() {
        tauri::async_runtime::block_on(async {
            let state = BridgeState::default();
            let _main_lane = state.process.lock().await;
            let _background_lane = state.background_process.lock().await;
            let connection_lane =
                timeout(Duration::from_millis(50), state.connection_process.lock()).await;

            assert!(connection_lane.is_ok());
        });
    }

    #[test]
    fn download_bridge_lane_does_not_wait_for_install_or_main_lane_locks() {
        tauri::async_runtime::block_on(async {
            let state = BridgeState::default();
            let _main_lane = state.process.lock().await;
            let _install_lane = state.install_process.lock().await;
            let download_lane =
                timeout(Duration::from_millis(50), state.download_process.lock()).await;

            assert!(download_lane.is_ok());
        });
    }

    #[test]
    fn restarting_one_bridge_lane_preserves_other_host_sessions() {
        tauri::async_runtime::block_on(async {
            let state = BridgeState::default();
            state.process(BridgeLane::Main).lock().await.handshake = Some(json!({
                "host": "main"
            }));
            state.process(BridgeLane::Install).lock().await.handshake = Some(json!({
                "host": "install"
            }));
            state.process(BridgeLane::Download).lock().await.handshake = Some(json!({
                "host": "download"
            }));

            state
                .process(BridgeLane::Download)
                .lock()
                .await
                .reset()
                .await;

            assert!(state
                .process(BridgeLane::Download)
                .lock()
                .await
                .handshake
                .is_none());
            assert_eq!(
                state.process(BridgeLane::Install).lock().await.handshake,
                Some(json!({ "host": "install" }))
            );
            assert_eq!(
                state.process(BridgeLane::Main).lock().await.handshake,
                Some(json!({ "host": "main" }))
            );
        });
    }

    #[test]
    fn bridge_lifecycle_enumerates_every_independent_host() {
        assert_eq!(
            BridgeLane::ALL,
            [
                BridgeLane::Main,
                BridgeLane::Plugin,
                BridgeLane::Interactive,
                BridgeLane::Background,
                BridgeLane::Connection,
                BridgeLane::Download,
                BridgeLane::Install,
            ]
        );
    }

    #[test]
    fn ai_compensation_tokens_are_per_effect_and_native_errors_hide_paths() {
        let first = json!({ "callId": "call-1", "name": "local.mods.set_enabled" });
        let second = json!({ "callId": "call-2", "name": "local.mods.set_enabled" });
        assert_ne!(
            ai_compensation_token("undo_mod", "operation-1", &first),
            ai_compensation_token("undo_mod", "operation-1", &second)
        );
        let sanitized = sanitize_ai_native_error_message(
            "Could not open C:\\Users\\Example\\secret.zip token=abc123",
        );
        assert!(!sanitized.contains("C:\\Users"));
        assert!(!sanitized.contains("abc123"));
        assert!(sanitized.contains("[local-path]"));
        assert!(sanitized.contains("token=[redacted-secret]"));
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

    #[cfg(windows)]
    #[test]
    fn default_install_root_directory_uses_the_windows_system_drive() {
        let _env_lock = ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let _system_drive_guard = EnvVarGuard::set("SystemDrive", "R:");

        assert_eq!(
            default_install_root_directory(&PathBuf::from(r"D:\AppData\Fluxora")),
            PathBuf::from(r"R:\Fluxora Builds")
        );
    }
}
