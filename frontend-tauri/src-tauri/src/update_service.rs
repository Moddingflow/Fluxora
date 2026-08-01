use crate::update_manifest::{
    verify_and_parse_stable_manifest, UpdateAsset, UpdateAssetKind, UpdateFile, UpdateManifest,
    MAX_MANIFEST_BYTES,
};
use crate::{
    ai_host_state, bridge_state, fluxora_data_dir, now_millis, validate_negotiated_protocol,
    write_log, BridgeLane, OperationRequest, BRIDGE_PROTOCOL_VERSION, BRIDGE_TIMEOUT_MS,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};
use reqwest::header::{
    HeaderMap, HeaderValue, CONTENT_LENGTH, CONTENT_RANGE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH,
    IF_RANGE, LAST_MODIFIED, RANGE,
};
use reqwest::{redirect, Client, Response, StatusCode, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

const MANIFEST_URL: &str =
    "https://github.com/Moddingflow/Fluxora/releases/latest/download/fluxora-update-manifest.json";
const SIGNATURE_URL: &str =
    "https://github.com/Moddingflow/Fluxora/releases/latest/download/fluxora-update-manifest.sig";
const UPDATE_STATUS_EVENT: &str = "fluxora:updates:status";
const UPDATE_CACHE_SCHEMA_VERSION: u32 = 1;
const UPDATE_REQUEST_SCHEMA_VERSION: u32 = 1;
const MAX_CACHE_RECORD_BYTES: usize = 2 * 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 4 * 1024;
const MAX_UPDATER_REQUEST_BYTES: usize = 64 * 1024;
const MAX_REDIRECTS: usize = 5;
const CHECK_TIMEOUT: Duration = Duration::from_secs(6);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1_500);
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_HANDSHAKE_TIMEOUT_MS: u64 = 2_000;
const DRAIN_POLL_INTERVAL: Duration = Duration::from_millis(250);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_DRAIN_POLL_FAILURES: u32 = 20;
const STARTUP_RETRY_DELAYS: [Duration; 2] = [Duration::from_secs(5), Duration::from_secs(30)];
const ALLOWED_UPDATE_HOSTS: [&str; 3] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];
const UPDATE_DRAIN_OPEN: u8 = 0;
const UPDATE_DRAIN_DRAINING: u8 = 1;
const UPDATE_DRAIN_SEALED: u8 = 2;
static UPDATE_DRAIN_PHASE: AtomicU8 = AtomicU8::new(UPDATE_DRAIN_OPEN);
static IN_FLIGHT_BRIDGE_REQUESTS: AtomicU64 = AtomicU64::new(0);
static KNOWN_PROJECT_DIRECTORIES: OnceLock<StdMutex<HashSet<String>>> = OnceLock::new();
const INSTALL_DECISION_OPEN: u8 = 0;
const INSTALL_DECISION_CANCELLED: u8 = 1;
const INSTALL_DECISION_COMMITTED: u8 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum UpdateState {
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    WaitingForOperations,
    ReadyToInstall,
    LaunchingUpdater,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatusError {
    code: String,
    message: String,
    retryable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FluxoraUpdateStatus {
    state: UpdateState,
    current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    available_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    asset_kind: Option<UpdateAssetKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    downloaded_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    checked_at_utc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<UpdateStatusError>,
}

impl FluxoraUpdateStatus {
    fn idle(current_version: String) -> Self {
        Self {
            state: UpdateState::Idle,
            current_version,
            available_version: None,
            asset_kind: None,
            downloaded_bytes: None,
            total_bytes: None,
            progress_percent: None,
            checked_at_utc: None,
            operation_id: None,
            error: None,
        }
    }

    fn for_state(
        state: UpdateState,
        current_version: &Version,
        release: Option<&VerifiedRelease>,
        operation_id: &str,
    ) -> Self {
        let selected = release.and_then(|release| release.selected_asset.as_ref());
        Self {
            state,
            current_version: current_version.to_string(),
            available_version: release.map(|release| release.manifest.version.to_string()),
            asset_kind: selected.map(|asset| asset.kind),
            downloaded_bytes: None,
            total_bytes: selected.map(|asset| asset.size),
            progress_percent: None,
            checked_at_utc: None,
            operation_id: Some(operation_id.to_string()),
            error: None,
        }
    }
}

#[derive(Clone, Debug)]
struct VerifiedRelease {
    manifest: UpdateManifest,
    manifest_bytes: Vec<u8>,
    signature_text: Vec<u8>,
    validators: CacheValidators,
    selected_asset: Option<UpdateAsset>,
}

struct UpdateRuntimeInner {
    status: FluxoraUpdateStatus,
    release: Option<VerifiedRelease>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct UpdateHandoffContext {
    nonce: String,
    operation_id: String,
}

pub(crate) struct UpdateRuntimeState {
    inner: Mutex<UpdateRuntimeInner>,
    check_gate: Mutex<()>,
    install_gate: Mutex<()>,
    check_client: Option<Client>,
    download_client: Option<Client>,
    health_handoff: Option<UpdateHandoffContext>,
    health_ack_state: AtomicU64,
    install_decision: AtomicU8,
}

impl Default for UpdateRuntimeState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(UpdateRuntimeInner {
                status: FluxoraUpdateStatus::idle(env!("CARGO_PKG_VERSION").to_string()),
                release: None,
            }),
            check_gate: Mutex::new(()),
            install_gate: Mutex::new(()),
            check_client: crate::update_shared::build_http_client(
                Some(Duration::from_secs(4)),
                crate::update_shared::CONNECT_TIMEOUT,
            )
            .ok(),
            download_client: crate::update_shared::build_http_client(
                None,
                crate::update_shared::DOWNLOAD_CONNECT_TIMEOUT,
            )
            .ok(),
            health_handoff: update_handoff_context(std::env::args()),
            health_ack_state: AtomicU64::new(0),
            install_decision: AtomicU8::new(INSTALL_DECISION_OPEN),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FluxoraUpdateCancelResult {
    accepted: bool,
    state: UpdateState,
    operation_id: String,
}

#[derive(Clone, Copy, Debug)]
struct UpdateServiceError {
    code: &'static str,
    message: &'static str,
    retryable: bool,
}

impl UpdateServiceError {
    const fn new(code: &'static str, message: &'static str, retryable: bool) -> Self {
        Self {
            code,
            message,
            retryable,
        }
    }
}

impl std::fmt::Display for UpdateServiceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code)
    }
}

fn shared_error(error: crate::update_shared::UpdateServiceError) -> UpdateServiceError {
    UpdateServiceError::new(error.code, error.message, error.retryable)
}

fn from_shared_release(release: crate::update_shared::VerifiedRelease) -> VerifiedRelease {
    VerifiedRelease {
        manifest: release.manifest,
        manifest_bytes: release.manifest_bytes,
        signature_text: release.signature_text,
        validators: CacheValidators {
            etag: release.validators.etag,
            last_modified: release.validators.last_modified,
        },
        selected_asset: release.selected_asset,
    }
}

fn to_shared_release(release: &VerifiedRelease) -> crate::update_shared::VerifiedRelease {
    crate::update_shared::VerifiedRelease {
        manifest: release.manifest.clone(),
        manifest_bytes: release.manifest_bytes.clone(),
        signature_text: release.signature_text.clone(),
        validators: crate::update_shared::CacheValidators {
            etag: release.validators.etag.clone(),
            last_modified: release.validators.last_modified.clone(),
        },
        selected_asset: release.selected_asset.clone(),
    }
}

fn update_cancelled_error() -> UpdateServiceError {
    UpdateServiceError::new(
        "update-cancelled",
        "The application update was cancelled.",
        true,
    )
}

fn update_cancel_requested(state: &UpdateRuntimeState) -> bool {
    state.install_decision.load(Ordering::Acquire) == INSTALL_DECISION_CANCELLED
}

fn reset_install_decision(state: &UpdateRuntimeState) {
    state
        .install_decision
        .store(INSTALL_DECISION_OPEN, Ordering::Release);
}

fn request_update_cancel(state: &UpdateRuntimeState, cancellable: bool) -> bool {
    if !cancellable {
        return false;
    }
    match state.install_decision.compare_exchange(
        INSTALL_DECISION_OPEN,
        INSTALL_DECISION_CANCELLED,
        Ordering::AcqRel,
        Ordering::Acquire,
    ) {
        Ok(_) => true,
        Err(INSTALL_DECISION_CANCELLED) => true,
        Err(_) => false,
    }
}

fn commit_updater_launch(state: &UpdateRuntimeState) -> bool {
    state
        .install_decision
        .compare_exchange(
            INSTALL_DECISION_OPEN,
            INSTALL_DECISION_COMMITTED,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
}

fn build_http_client(
    total_timeout: Option<Duration>,
    connect_timeout: Duration,
) -> Result<Client, reqwest::Error> {
    let mut builder = Client::builder()
        .user_agent(concat!("Fluxora/", env!("CARGO_PKG_VERSION"), " updater"))
        .connect_timeout(connect_timeout)
        .read_timeout(DOWNLOAD_READ_TIMEOUT)
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many update redirects")
            } else if is_allowed_update_transport_url(attempt.url().as_str()) {
                attempt.follow()
            } else {
                attempt.error("update redirect target is not allowed")
            }
        }));
    if let Some(timeout) = total_timeout {
        builder = builder.timeout(timeout);
    }
    builder.build()
}

pub(crate) struct BridgeRequestPermit;

impl Drop for BridgeRequestPermit {
    fn drop(&mut self) {
        IN_FLIGHT_BRIDGE_REQUESTS.fetch_sub(1, Ordering::AcqRel);
    }
}

fn request_allowed_during_drain(method: &str) -> bool {
    matches!(
        method,
        "projects.listConfigs"
            | "downloads.list"
            | "installs.list"
            | "operations.cancel"
            | "downloads.cancel"
            | "installs.cancel"
    )
}

pub(crate) fn enter_host_request(method: &str) -> Result<BridgeRequestPermit, &'static str> {
    enter_bridge_request(method)
}

pub(crate) fn enter_bridge_request(method: &str) -> Result<BridgeRequestPermit, &'static str> {
    let allowed_during_drain = request_allowed_during_drain(method);
    loop {
        let phase_before = UPDATE_DRAIN_PHASE.load(Ordering::Acquire);
        if phase_before == UPDATE_DRAIN_SEALED
            || (phase_before == UPDATE_DRAIN_DRAINING && !allowed_during_drain)
        {
            return Err("Fluxora is waiting to install an application update.");
        }
        IN_FLIGHT_BRIDGE_REQUESTS.fetch_add(1, Ordering::AcqRel);
        let phase_after = UPDATE_DRAIN_PHASE.load(Ordering::Acquire);
        if phase_after == phase_before && (phase_after == UPDATE_DRAIN_OPEN || allowed_during_drain)
        {
            return Ok(BridgeRequestPermit);
        }
        IN_FLIGHT_BRIDGE_REQUESTS.fetch_sub(1, Ordering::AcqRel);
        if phase_after != UPDATE_DRAIN_OPEN {
            return Err("Fluxora is waiting to install an application update.");
        }
    }
}

pub(crate) struct UpdateDrainRequestPermit;

pub(crate) fn enter_update_drain_request() -> Result<UpdateDrainRequestPermit, &'static str> {
    match UPDATE_DRAIN_PHASE.load(Ordering::Acquire) {
        UPDATE_DRAIN_DRAINING | UPDATE_DRAIN_SEALED => Ok(UpdateDrainRequestPermit),
        _ => Err("Fluxora is not preparing an application update."),
    }
}

fn begin_update_drain() -> bool {
    UPDATE_DRAIN_PHASE
        .compare_exchange(
            UPDATE_DRAIN_OPEN,
            UPDATE_DRAIN_DRAINING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
}

fn seal_update_drain() -> bool {
    UPDATE_DRAIN_PHASE
        .compare_exchange(
            UPDATE_DRAIN_DRAINING,
            UPDATE_DRAIN_SEALED,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
}

fn clear_update_drain() {
    UPDATE_DRAIN_PHASE.store(UPDATE_DRAIN_OPEN, Ordering::Release);
}

pub(crate) fn is_update_draining() -> bool {
    UPDATE_DRAIN_PHASE.load(Ordering::Acquire) != UPDATE_DRAIN_OPEN
}

fn in_flight_bridge_requests() -> u64 {
    IN_FLIGHT_BRIDGE_REQUESTS.load(Ordering::Acquire)
}

fn project_directories() -> &'static StdMutex<HashSet<String>> {
    KNOWN_PROJECT_DIRECTORIES.get_or_init(|| StdMutex::new(HashSet::new()))
}

pub(crate) fn observe_project_directory(params: &Value) {
    let Some(project_directory) = params
        .get("projectDirectory")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 32_767)
        .filter(|value| Path::new(value).is_absolute())
    else {
        return;
    };
    let mut directories = project_directories()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !directories
        .iter()
        .any(|known| known.eq_ignore_ascii_case(project_directory))
    {
        directories.insert(project_directory.to_string());
    }
}

fn known_project_directories() -> Vec<String> {
    let mut directories = project_directories()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .cloned()
        .collect::<Vec<_>>();
    directories.sort_by_key(|value| value.to_ascii_lowercase());
    directories
}

fn is_allowed_update_transport_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| ALLOWED_UPDATE_HOSTS.contains(&host))
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct CacheValidators {
    etag: Option<String>,
    last_modified: Option<String>,
}

fn conditional_headers(validators: &CacheValidators) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(value) = validators
        .etag
        .as_deref()
        .filter(|value| value.len() <= 256)
        .and_then(|value| HeaderValue::from_str(value).ok())
    {
        headers.insert(IF_NONE_MATCH, value);
    }
    if let Some(value) = validators
        .last_modified
        .as_deref()
        .filter(|value| value.len() <= 128)
        .and_then(|value| HeaderValue::from_str(value).ok())
    {
        headers.insert(IF_MODIFIED_SINCE, value);
    }
    headers
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerifiedManifestCacheRecord {
    schema_version: u32,
    checked_at_epoch_ms: u128,
    manifest_sha256: String,
    manifest_bytes_base64: String,
    signature_text_base64: String,
    etag: Option<String>,
    last_modified: Option<String>,
}

fn current_version(app: &AppHandle) -> Result<Version, UpdateServiceError> {
    Version::parse(&app.package_info().version.to_string()).map_err(|_| {
        UpdateServiceError::new(
            "invalid-current-version",
            "The installed application version is invalid.",
            false,
        )
    })
}

fn checked_at_utc() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn update_operation_id(request: Option<&OperationRequest>, scope: &str) -> String {
    request
        .and_then(|request| request.operation_id.as_deref())
        .and_then(validated_update_operation_id)
        .map(str::to_string)
        .unwrap_or_else(|| format!("op_{}_{}", now_millis(), scope))
}

fn validated_update_operation_id(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        }))
    .then_some(value)
}

fn update_handoff_context<I, S>(arguments: I) -> Option<UpdateHandoffContext>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let arguments = arguments
        .into_iter()
        .map(|argument| argument.as_ref().to_string())
        .collect::<Vec<_>>();
    let exactly_one_value = |flag: &str| {
        let positions = arguments
            .iter()
            .enumerate()
            .filter_map(|(index, argument)| (argument == flag).then_some(index))
            .collect::<Vec<_>>();
        (positions.len() == 1)
            .then(|| arguments.get(positions[0] + 1))
            .flatten()
    };
    let nonce = exactly_one_value("--fluxora-update-handoff")
        .filter(|nonce| {
            nonce.len() == 64
                && nonce
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        .cloned()?;
    let operation_id = exactly_one_value("--fluxora-update-operation-id")
        .and_then(|value| validated_update_operation_id(value))
        .map(str::to_string)?;
    Some(UpdateHandoffContext {
        nonce,
        operation_id,
    })
}

async fn set_status(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    status: FluxoraUpdateStatus,
) -> FluxoraUpdateStatus {
    {
        let mut inner = state.inner.lock().await;
        inner.status = status.clone();
    }
    let _ = app.emit(UPDATE_STATUS_EVENT, status.clone());
    status
}

async fn set_error_status(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    current_version: &Version,
    operation_id: &str,
    error: UpdateServiceError,
) -> FluxoraUpdateStatus {
    let release = state.inner.lock().await.release.clone();
    let mut status = FluxoraUpdateStatus::for_state(
        UpdateState::Error,
        current_version,
        release.as_ref(),
        operation_id,
    );
    status.error = Some(UpdateStatusError {
        code: error.code.to_string(),
        message: error.message.to_string(),
        retryable: error.retryable,
    });
    set_status(app, state, status).await
}

fn update_root(app: &AppHandle) -> Result<PathBuf, UpdateServiceError> {
    let _ = app;
    Ok(fluxora_data_dir().join("updates"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn bounded_header(
    headers: &HeaderMap,
    name: reqwest::header::HeaderName,
    max: usize,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= max)
        .map(str::to_string)
}

async fn read_bounded_response(
    mut response: Response,
    max_bytes: usize,
) -> Result<Vec<u8>, UpdateServiceError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(UpdateServiceError::new(
            "response-too-large",
            "The update server response exceeds the safety limit.",
            false,
        ));
    }
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(max_bytes as u64) as usize,
    );
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        UpdateServiceError::new(
            "network-read-failed",
            "The update server response could not be read.",
            true,
        )
    })? {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err(UpdateServiceError::new(
                "response-too-large",
                "The update server response exceeds the safety limit.",
                false,
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn fetch_latest_release(
    client: &Client,
    cached: Option<&VerifiedRelease>,
) -> Result<VerifiedRelease, UpdateServiceError> {
    let manifest_url = Url::parse(MANIFEST_URL).map_err(|_| {
        UpdateServiceError::new("endpoint-invalid", "The update endpoint is invalid.", false)
    })?;
    if !is_allowed_update_transport_url(manifest_url.as_str()) {
        return Err(UpdateServiceError::new(
            "endpoint-invalid",
            "The update endpoint is invalid.",
            false,
        ));
    }
    let mut request = client.get(manifest_url);
    if let Some(cached) = cached {
        request = request.headers(conditional_headers(&cached.validators));
    }
    let response = request.send().await.map_err(|_| {
        UpdateServiceError::new(
            "update-server-unavailable",
            "The update server is temporarily unavailable.",
            true,
        )
    })?;
    if response.status() == StatusCode::NOT_MODIFIED {
        return cached.cloned().ok_or_else(|| {
            UpdateServiceError::new(
                "cache-miss",
                "The update cache could not satisfy the server response.",
                true,
            )
        });
    }
    if !response.status().is_success() {
        return Err(UpdateServiceError::new(
            "manifest-http-failed",
            "The update manifest could not be retrieved.",
            crate::update_shared::is_retryable_discovery_status(response.status()),
        ));
    }
    if !is_allowed_update_transport_url(response.url().as_str()) {
        return Err(UpdateServiceError::new(
            "redirect-rejected",
            "The update server redirect was rejected.",
            false,
        ));
    }
    let validators = CacheValidators {
        etag: bounded_header(response.headers(), ETAG, 256),
        last_modified: bounded_header(response.headers(), LAST_MODIFIED, 128),
    };
    let manifest_bytes = read_bounded_response(response, MAX_MANIFEST_BYTES).await?;

    let signature_url = Url::parse(SIGNATURE_URL).map_err(|_| {
        UpdateServiceError::new("endpoint-invalid", "The update endpoint is invalid.", false)
    })?;
    let signature_response = client.get(signature_url).send().await.map_err(|_| {
        UpdateServiceError::new(
            "update-server-unavailable",
            "The update server is temporarily unavailable.",
            true,
        )
    })?;
    if !signature_response.status().is_success() {
        return Err(UpdateServiceError::new(
            "signature-http-failed",
            "The update signature could not be retrieved.",
            crate::update_shared::is_retryable_discovery_status(signature_response.status()),
        ));
    }
    if !is_allowed_update_transport_url(signature_response.url().as_str()) {
        return Err(UpdateServiceError::new(
            "redirect-rejected",
            "The update server redirect was rejected.",
            false,
        ));
    }
    let signature_text = read_bounded_response(signature_response, MAX_SIGNATURE_BYTES).await?;
    let manifest =
        verify_and_parse_stable_manifest(&manifest_bytes, &signature_text).map_err(|_| {
            UpdateServiceError::new(
                "manifest-verification-failed",
                "The update manifest failed authenticity or integrity checks.",
                false,
            )
        })?;
    Ok(VerifiedRelease {
        manifest,
        manifest_bytes,
        signature_text,
        validators,
        selected_asset: None,
    })
}

async fn read_bounded_file(path: &Path, max_bytes: usize) -> Option<Vec<u8>> {
    let metadata = fs::metadata(path).await.ok()?;
    if metadata.len() > max_bytes as u64 {
        return None;
    }
    fs::read(path)
        .await
        .ok()
        .filter(|bytes| bytes.len() <= max_bytes)
}

async fn load_verified_cache(app: &AppHandle) -> Option<VerifiedRelease> {
    let directory = update_root(app).ok()?.join("cache");
    let mut entries = fs::read_dir(&directory).await.ok()?;
    let mut candidates = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("verified-manifest-v1-") && name.ends_with(".json") {
            candidates.push((name, entry.path()));
            if candidates.len() >= 32 {
                break;
            }
        }
    }
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in candidates {
        let Some(bytes) = read_bounded_file(&path, MAX_CACHE_RECORD_BYTES).await else {
            continue;
        };
        let Ok(record) = serde_json::from_slice::<VerifiedManifestCacheRecord>(&bytes) else {
            continue;
        };
        if record.schema_version != UPDATE_CACHE_SCHEMA_VERSION {
            continue;
        }
        let Ok(manifest_bytes) = STANDARD.decode(record.manifest_bytes_base64) else {
            continue;
        };
        let Ok(signature_text) = STANDARD.decode(record.signature_text_base64) else {
            continue;
        };
        if sha256_hex(&manifest_bytes) != record.manifest_sha256 {
            continue;
        }
        let Ok(manifest) = verify_and_parse_stable_manifest(&manifest_bytes, &signature_text)
        else {
            continue;
        };
        return Some(VerifiedRelease {
            manifest,
            manifest_bytes,
            signature_text,
            validators: CacheValidators {
                etag: record.etag,
                last_modified: record.last_modified,
            },
            selected_asset: None,
        });
    }
    None
}

async fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), UpdateServiceError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.map_err(|_| {
            UpdateServiceError::new(
                "storage-write-failed",
                "Update data could not be stored.",
                true,
            )
        })?;
    }
    let temporary = path.with_extension(format!("tmp-{}-{}", std::process::id(), now_millis()));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .await
        .map_err(|_| {
            UpdateServiceError::new(
                "storage-write-failed",
                "Update data could not be stored.",
                true,
            )
        })?;
    if file.write_all(bytes).await.is_err() || file.sync_all().await.is_err() {
        drop(file);
        let _ = fs::remove_file(&temporary).await;
        return Err(UpdateServiceError::new(
            "storage-write-failed",
            "Update data could not be stored.",
            true,
        ));
    }
    drop(file);
    if fs::hard_link(&temporary, path).await.is_err() {
        let _ = fs::remove_file(&temporary).await;
        return Err(UpdateServiceError::new(
            "storage-write-failed",
            "Update data could not be stored.",
            true,
        ));
    }
    let _ = fs::remove_file(&temporary).await;
    Ok(())
}

async fn store_verified_cache(
    app: &AppHandle,
    release: &VerifiedRelease,
) -> Result<(), UpdateServiceError> {
    let directory = update_root(app)?.join("cache");
    fs::create_dir_all(&directory).await.map_err(|_| {
        UpdateServiceError::new(
            "storage-write-failed",
            "Update data could not be stored.",
            true,
        )
    })?;
    let manifest_sha256 = sha256_hex(&release.manifest_bytes);
    let record = VerifiedManifestCacheRecord {
        schema_version: UPDATE_CACHE_SCHEMA_VERSION,
        checked_at_epoch_ms: now_millis(),
        manifest_sha256: manifest_sha256.clone(),
        manifest_bytes_base64: STANDARD.encode(&release.manifest_bytes),
        signature_text_base64: STANDARD.encode(&release.signature_text),
        etag: release.validators.etag.clone(),
        last_modified: release.validators.last_modified.clone(),
    };
    let bytes = serde_json::to_vec(&record).map_err(|_| {
        UpdateServiceError::new(
            "cache-serialization-failed",
            "The verified update cache could not be stored.",
            true,
        )
    })?;
    if bytes.len() > MAX_CACHE_RECORD_BYTES {
        return Err(UpdateServiceError::new(
            "cache-record-too-large",
            "The verified update cache exceeds the safety limit.",
            false,
        ));
    }
    let path = directory.join(format!(
        "verified-manifest-v1-{:020}-{}.json",
        now_millis(),
        manifest_sha256
    ));
    write_new_file(&path, &bytes).await?;

    let mut entries = fs::read_dir(&directory).await.map_err(|_| {
        UpdateServiceError::new(
            "cache-cleanup-failed",
            "The verified update cache could not be maintained.",
            true,
        )
    })?;
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("verified-manifest-v1-") && name.ends_with(".json") {
            files.push((name, entry.path()));
        }
    }
    files.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, stale) in files.into_iter().skip(2) {
        let _ = fs::remove_file(stale).await;
    }
    Ok(())
}

async fn verified_installed_file_manifest_digest(
    app: &AppHandle,
    current_version: &Version,
) -> Option<String> {
    let root = update_root(app).ok()?;
    let manifest_bytes =
        read_bounded_file(&root.join("installed-manifest.json"), MAX_MANIFEST_BYTES).await?;
    let signature_text =
        read_bounded_file(&root.join("installed-manifest.sig"), MAX_SIGNATURE_BYTES).await?;
    let manifest = verify_and_parse_stable_manifest(&manifest_bytes, &signature_text).ok()?;
    if manifest.version != *current_version {
        return None;
    }
    let install_root = std::env::current_exe().ok()?.parent()?.to_path_buf();
    verify_installed_file_inventory(&install_root, &manifest.files)
        .await
        .then_some(manifest.file_manifest_sha256)
}

async fn sha256_installed_file(path: &Path) -> Option<(u64, String)> {
    let metadata = fs::symlink_metadata(path).await.ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return None;
    }
    let mut file = fs::File::open(path).await.ok()?;
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut size = 0_u64;
    let mut hasher = Sha256::new();
    loop {
        let count = file.read(&mut buffer).await.ok()?;
        if count == 0 {
            break;
        }
        size = size.checked_add(count as u64)?;
        hasher.update(&buffer[..count]);
    }
    Some((size, format!("{:x}", hasher.finalize())))
}

fn installed_metadata_is_reparse(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

fn is_protected_update_tree(relative_parent: &str, name: &str) -> bool {
    relative_parent.is_empty()
        && (name.eq_ignore_ascii_case("Downloads") || name.eq_ignore_ascii_case("logs"))
}

async fn verify_installed_file_inventory(root: &Path, files: &[UpdateFile]) -> bool {
    let Ok(root_metadata) = fs::symlink_metadata(root).await else {
        return false;
    };
    if !root_metadata.is_dir() || installed_metadata_is_reparse(&root_metadata) {
        return false;
    }
    let Ok(canonical_root) = fs::canonicalize(root).await else {
        return false;
    };
    let expected = files
        .iter()
        .map(|file| (file.path.to_lowercase(), file))
        .collect::<HashMap<_, _>>();
    let mut actual_paths = HashSet::with_capacity(files.len());
    let mut directories = vec![(root.to_path_buf(), String::new())];
    while let Some((directory, relative_parent)) = directories.pop() {
        let Ok(mut entries) = fs::read_dir(&directory).await else {
            return false;
        };
        loop {
            let entry = match entries.next_entry().await {
                Ok(Some(entry)) => entry,
                Ok(None) => break,
                Err(_) => return false,
            };
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                return false;
            };
            let Ok(metadata) = fs::symlink_metadata(entry.path()).await else {
                return false;
            };
            if installed_metadata_is_reparse(&metadata) {
                return false;
            }
            if metadata.is_dir() && is_protected_update_tree(&relative_parent, &name) {
                continue;
            }
            let relative = if relative_parent.is_empty() {
                name
            } else {
                format!("{relative_parent}/{name}")
            };
            let Ok(canonical_path) = fs::canonicalize(entry.path()).await else {
                return false;
            };
            if !canonical_path.starts_with(&canonical_root) {
                return false;
            }
            if metadata.is_dir() {
                directories.push((entry.path(), relative));
                continue;
            }
            if !metadata.is_file() {
                return false;
            }
            let folded = relative.to_lowercase();
            if !actual_paths.insert(folded.clone()) {
                return false;
            }
            let Some(expected) = expected.get(&folded) else {
                return false;
            };
            if expected.path != relative
                || !matches!(
                    sha256_installed_file(&canonical_path).await,
                    Some((size, ref digest)) if size == expected.size && digest == &expected.sha256
                )
            {
                return false;
            }
        }
    }
    actual_paths.len() == files.len()
}

async fn select_safe_asset(
    app: &AppHandle,
    manifest: &UpdateManifest,
    current_version: &Version,
) -> Option<UpdateAsset> {
    let installed_digest = verified_installed_file_manifest_digest(app, current_version).await;
    select_asset_with_installed_digest(manifest, current_version, installed_digest.as_deref())
}

fn select_asset_with_installed_digest(
    manifest: &UpdateManifest,
    current_version: &Version,
    installed_digest: Option<&str>,
) -> Option<UpdateAsset> {
    if manifest.version <= *current_version {
        return None;
    }
    if let Some(installed_digest) = installed_digest {
        if let Some(delta) = manifest.assets.iter().find(|asset| {
            asset.kind == UpdateAssetKind::Delta
                && asset.from_version.as_ref() == Some(current_version)
                && asset.base_file_manifest_sha256.as_deref() == Some(installed_digest)
        }) {
            return Some(delta.clone());
        }
    }
    manifest
        .assets
        .iter()
        .find(|asset| asset.kind == UpdateAssetKind::Full)
        .cloned()
}

fn select_full_asset(manifest: &UpdateManifest, current_version: &Version) -> Option<UpdateAsset> {
    if manifest.version <= *current_version {
        return None;
    }
    manifest
        .assets
        .iter()
        .find(|asset| asset.kind == UpdateAssetKind::Full)
        .cloned()
}

async fn run_update_check(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    operation_id: &str,
) -> FluxoraUpdateStatus {
    let _check_guard = state.check_gate.lock().await;
    let current = match current_version(app) {
        Ok(version) => version,
        Err(error) => {
            let fallback = Version::new(0, 0, 0);
            return set_error_status(app, state, &fallback, operation_id, error).await;
        }
    };
    set_status(
        app,
        state,
        FluxoraUpdateStatus::for_state(UpdateState::Checking, &current, None, operation_id),
    )
    .await;
    let Some(client) = state.check_client.as_ref() else {
        let error = UpdateServiceError::new(
            "http-client-unavailable",
            "Secure update networking could not be initialized.",
            true,
        );
        return set_error_status(app, state, &current, operation_id, error).await;
    };
    let root = match update_root(app) {
        Ok(root) => root,
        Err(error) => {
            return set_error_status(app, state, &current, operation_id, error).await;
        }
    };
    let discovered =
        match crate::update_shared::discover_full_release(&root, client, &current).await {
            Ok(release) => release,
            Err(error) => {
                let error = shared_error(error);
                let _ = write_log(
                    app,
                    "update",
                    "warning",
                    "UpdateCheck",
                    &format!("checkFailed code={}", error.code),
                    Some(operation_id),
                )
                .await;
                return set_error_status(app, state, &current, operation_id, error).await;
            }
        };
    let release = discovered.map(from_shared_release);
    let update_available = release.is_some();
    {
        let mut inner = state.inner.lock().await;
        inner.release = release.clone();
    }
    let mut status = FluxoraUpdateStatus::for_state(
        if update_available {
            UpdateState::Available
        } else {
            UpdateState::UpToDate
        },
        &current,
        release.as_ref(),
        operation_id,
    );
    status.checked_at_utc = Some(checked_at_utc());
    let status = set_status(app, state, status).await;
    let _ = write_log(
        app,
        "update",
        "info",
        "UpdateCheck",
        if update_available {
            "checkCompleted result=available"
        } else {
            "checkCompleted result=up-to-date"
        },
        Some(operation_id),
    )
    .await;
    status
}

mod download;
mod lifecycle;

#[cfg(test)]
use download::{content_range_starts_at, DownloadResumeRecord};
use download::{download_selected_package, emit_download_progress, store_manifest_artifacts};
#[cfg(test)]
use lifecycle::{
    generate_handoff_nonce, has_active_downloads, has_active_installs, parent_start_time_utc,
    runtime_operation_component, stage_runtime_artifact, UpdateHealthAcknowledgment,
    UpdaterLaunchRequest, UPDATER_RUNTIME_NATIVE_FILES,
};
use lifecycle::{run_download_and_install, write_update_health_acknowledgment};

#[tauri::command]
pub(crate) async fn fluxora_updates_get_status(
    state: State<'_, UpdateRuntimeState>,
) -> Result<FluxoraUpdateStatus, String> {
    Ok(state.inner.lock().await.status.clone())
}

fn renderer_window_is_main(label: &str) -> bool {
    label == crate::MAIN_WINDOW_LABEL
}

#[tauri::command]
pub(crate) async fn fluxora_updates_renderer_ready(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, UpdateRuntimeState>,
) -> Result<(), String> {
    if !renderer_window_is_main(window.label()) {
        return Err("Only the main Fluxora window may acknowledge update health.".to_string());
    }
    write_update_health_acknowledgment(&app, &state)
        .await
        .map_err(|error| error.message.to_string())
}

#[tauri::command]
pub(crate) async fn fluxora_updates_check(
    app: AppHandle,
    state: State<'_, UpdateRuntimeState>,
    request: Option<OperationRequest>,
) -> Result<FluxoraUpdateStatus, String> {
    if is_update_draining() {
        return Ok(state.inner.lock().await.status.clone());
    }
    let operation_id = update_operation_id(request.as_ref(), "updates_check");
    Ok(run_update_check(&app, &state, &operation_id).await)
}

#[tauri::command]
pub(crate) async fn fluxora_updates_download_and_install(
    app: AppHandle,
    state: State<'_, UpdateRuntimeState>,
    request: Option<OperationRequest>,
) -> Result<FluxoraUpdateStatus, String> {
    let operation_id = update_operation_id(request.as_ref(), "updates_install");
    Ok(run_download_and_install(&app, &state, &operation_id).await)
}

#[tauri::command]
pub(crate) async fn fluxora_updates_cancel(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, UpdateRuntimeState>,
    request: Option<OperationRequest>,
) -> Result<FluxoraUpdateCancelResult, String> {
    if !renderer_window_is_main(window.label()) {
        return Err("Only the main Fluxora window may cancel an application update.".to_string());
    }
    let operation_id = update_operation_id(request.as_ref(), "updates_cancel");
    let current_state = state.inner.lock().await.status.state;
    let cancellable = matches!(
        current_state,
        UpdateState::Downloading | UpdateState::WaitingForOperations | UpdateState::ReadyToInstall
    );
    let accepted = request_update_cancel(&state, cancellable);
    let _ = write_log(
        &app,
        "update",
        "info",
        "UpdateCancel",
        if accepted {
            "cancelRequested accepted=true"
        } else {
            "cancelRequested accepted=false"
        },
        Some(&operation_id),
    )
    .await;
    Ok(FluxoraUpdateCancelResult {
        accepted,
        state: current_state,
        operation_id,
    })
}

pub(crate) fn start_startup_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let operation_id = update_operation_id(None, "updates_startup_check");
        let state = app.state::<UpdateRuntimeState>();
        for attempt in 0..=STARTUP_RETRY_DELAYS.len() {
            if is_update_draining() {
                break;
            }
            let status = run_update_check(&app, &state, &operation_id).await;
            let retryable = status.state == UpdateState::Error
                && status.error.as_ref().is_some_and(|error| error.retryable);
            if !retryable || attempt == STARTUP_RETRY_DELAYS.len() {
                break;
            }
            tokio::time::sleep(STARTUP_RETRY_DELAYS[attempt]).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use crate::update_manifest::{UpdateAsset, UpdateAssetKind, UpdateFile, UpdateManifest};
    use chrono::Utc;
    use reqwest::header::{IF_MODIFIED_SINCE, IF_NONE_MATCH};
    use semver::Version;
    use serde_json::json;
    use std::collections::BTreeSet;
    use std::path::PathBuf;

    #[test]
    fn allows_only_https_github_release_transport_hosts() {
        for url in [
            "https://github.com/Moddingflow/Fluxora/releases/latest/download/fluxora-update-manifest.json",
            "https://objects.githubusercontent.com/github-production-release-asset/file",
            "https://release-assets.githubusercontent.com/github-production-release-asset/file?sig=opaque",
        ] {
            assert!(super::is_allowed_update_transport_url(url), "{url}");
        }
        for url in [
            "http://github.com/Moddingflow/Fluxora/releases/download/v1/file.zip",
            "https://github.com.evil.example/Fluxora.zip",
            "https://example.com/Fluxora.zip",
            "file:///C:/Fluxora.zip",
        ] {
            assert!(!super::is_allowed_update_transport_url(url), "{url}");
        }
    }

    #[test]
    fn sends_bounded_conditional_headers_from_the_verified_cache() {
        let headers = super::conditional_headers(&super::CacheValidators {
            etag: Some("\"release-v1.2.0\"".to_string()),
            last_modified: Some("Wed, 30 Jul 2026 10:00:00 GMT".to_string()),
        });

        assert_eq!(headers[IF_NONE_MATCH], "\"release-v1.2.0\"");
        assert_eq!(headers[IF_MODIFIED_SINCE], "Wed, 30 Jul 2026 10:00:00 GMT");

        let poisoned = super::conditional_headers(&super::CacheValidators {
            etag: Some("bad\r\nx-injected: yes".to_string()),
            last_modified: None,
        });
        assert!(!poisoned.contains_key(IF_NONE_MATCH));
    }

    #[test]
    fn drain_gate_seals_public_list_and_cancel_requests_without_losing_existing_permits() {
        super::clear_update_drain();
        let current = super::enter_bridge_request("mods.getWorkspace")
            .expect("request before drain must enter");

        assert!(super::begin_update_drain());
        assert_eq!(super::in_flight_bridge_requests(), 1);
        assert!(super::enter_bridge_request("mods.checkUpdates").is_err());
        assert!(super::enter_bridge_request("installs.submit").is_err());
        assert!(super::enter_host_request("chat.respond").is_err());
        assert!(super::enter_host_request("transcribe").is_err());
        let terminal_read = super::enter_bridge_request("downloads.list")
            .expect("terminal reads remain available before sealing");
        assert_eq!(super::in_flight_bridge_requests(), 2);

        assert!(super::seal_update_drain());
        assert!(super::enter_bridge_request("projects.listConfigs").is_err());
        assert!(super::enter_bridge_request("downloads.list").is_err());
        assert!(super::enter_bridge_request("downloads.cancel").is_err());
        assert!(super::enter_host_request("system.shutdown").is_err());
        let internal = super::enter_update_drain_request()
            .expect("private updater probes and shutdown remain available while sealed");

        drop(internal);
        drop(terminal_read);
        drop(current);
        assert_eq!(super::in_flight_bridge_requests(), 0);
        super::clear_update_drain();
        assert!(super::enter_bridge_request("mods.getWorkspace").is_ok());

        super::clear_update_drain();
        assert!(super::begin_update_drain());
        assert_eq!(super::in_flight_bridge_requests(), 0);
        assert!(super::seal_update_drain());
        assert!(super::enter_bridge_request("downloads.list").is_err());
        assert!(super::enter_bridge_request("downloads.cancel").is_err());
        super::clear_update_drain();
    }

    #[test]
    fn remembers_only_authoritative_project_scopes_for_durable_work_polling() {
        super::observe_project_directory(&json!({
            "projectDirectory": "C:\\Fluxora Builds\\Authoritative Scope"
        }));
        super::observe_project_directory(&json!({
            "projectDirectory": "C:\\Fluxora Builds\\Authoritative Scope",
            "packagePath": "C:\\Users\\person\\private.zip"
        }));
        super::observe_project_directory(&json!({
            "packagePath": "C:\\Users\\person\\ignored.zip"
        }));

        let directories = super::known_project_directories();
        assert!(directories.contains(&"C:\\Fluxora Builds\\Authoritative Scope".to_string()));
        assert!(!directories.contains(&"C:\\Users\\person\\private.zip".to_string()));
    }

    #[test]
    fn retains_every_observed_project_scope_without_eviction() {
        for index in 0..64 {
            super::observe_project_directory(&json!({
                "projectDirectory": format!("C:\\Fluxora Builds\\Retention Scope {index:02}")
            }));
        }
        let directories = super::known_project_directories();
        for index in 0..64 {
            assert!(
                directories.contains(&format!("C:\\Fluxora Builds\\Retention Scope {index:02}"))
            );
        }
    }

    #[test]
    fn classifies_only_nonterminal_download_and_install_states_as_active() {
        assert!(super::has_active_downloads(&json!([{
            "transferState": "indexing"
        }])));
        assert!(!super::has_active_downloads(&json!([{
            "transferState": "awaiting-decision"
        }, {
            "transferState": "paused"
        }])));
        assert!(super::has_active_installs(&json!({
            "installs": [{ "state": "recovering" }]
        })));
        assert!(!super::has_active_installs(&json!([{
            "state": "needsReview"
        }, {
            "state": "completed"
        }, {
            "state": "failed"
        }])));
    }

    #[test]
    fn accepts_only_an_exact_bounded_content_range_for_resume() {
        let valid = reqwest::header::HeaderValue::from_static("bytes 1024-4095/4096");
        assert!(super::content_range_starts_at(Some(&valid), 1024, 4096));
        for invalid in [
            "bytes 0-4095/4096",
            "bytes 1024-4096/4096",
            "bytes 1024-4095/8192",
            "items 1024-4095/4096",
        ] {
            let invalid = reqwest::header::HeaderValue::from_str(invalid).unwrap();
            assert!(!super::content_range_starts_at(Some(&invalid), 1024, 4096));
        }
    }

    fn manifest_with_delta() -> UpdateManifest {
        let target_digest = "b".repeat(64);
        UpdateManifest {
            schema_version: 1,
            channel: "stable".to_string(),
            version: Version::new(2, 0, 0),
            target: "win-x64".to_string(),
            application_executable: "Fluxora.exe".to_string(),
            file_manifest_sha256: target_digest.clone(),
            files: Vec::new(),
            assets: vec![
                UpdateAsset {
                    kind: UpdateAssetKind::Delta,
                    from_version: Some(Version::new(1, 0, 0)),
                    url: "https://github.com/Moddingflow/Fluxora/releases/download/v2.0.0/delta"
                        .to_string(),
                    size: 1,
                    sha256: "c".repeat(64),
                    base_file_manifest_sha256: Some("a".repeat(64)),
                    target_file_manifest_sha256: target_digest.clone(),
                },
                UpdateAsset {
                    kind: UpdateAssetKind::Full,
                    from_version: None,
                    url: "https://github.com/Moddingflow/Fluxora/releases/download/v2.0.0/full"
                        .to_string(),
                    size: 2,
                    sha256: "d".repeat(64),
                    base_file_manifest_sha256: None,
                    target_file_manifest_sha256: target_digest,
                },
            ],
        }
    }

    #[test]
    fn selects_delta_only_with_a_matching_verified_install_receipt_digest() {
        let manifest = manifest_with_delta();
        let current = Version::new(1, 0, 0);
        assert_eq!(
            super::select_asset_with_installed_digest(&manifest, &current, Some(&"a".repeat(64)))
                .unwrap()
                .kind,
            UpdateAssetKind::Delta
        );
        for digest in [None, Some("wrong")] {
            assert_eq!(
                super::select_asset_with_installed_digest(&manifest, &current, digest)
                    .unwrap()
                    .kind,
                UpdateAssetKind::Full
            );
        }
    }

    #[test]
    fn delta_inventory_requires_the_actual_installed_bytes_to_match() {
        tauri::async_runtime::block_on(async {
            let root = std::env::temp_dir().join(format!(
                "fluxora-update-inventory-{}-{}",
                std::process::id(),
                super::now_millis()
            ));
            std::fs::create_dir_all(root.join("native")).unwrap();
            std::fs::write(root.join("Fluxora.exe"), b"signed application").unwrap();
            std::fs::write(root.join("native").join("core.dll"), b"signed core").unwrap();
            let files = vec![
                UpdateFile {
                    path: "Fluxora.exe".to_string(),
                    size: 18,
                    sha256: super::sha256_hex(b"signed application"),
                },
                UpdateFile {
                    path: "native/core.dll".to_string(),
                    size: 11,
                    sha256: super::sha256_hex(b"signed core"),
                },
            ];
            assert!(super::verify_installed_file_inventory(&root, &files).await);

            std::fs::write(root.join("unexpected.dll"), b"not in the signed receipt").unwrap();
            assert!(!super::verify_installed_file_inventory(&root, &files).await);
            std::fs::remove_file(root.join("unexpected.dll")).unwrap();

            std::fs::create_dir_all(root.join("Downloads")).unwrap();
            std::fs::create_dir_all(root.join("logs")).unwrap();
            std::fs::write(root.join("Downloads").join("kept.zip"), b"mutable").unwrap();
            std::fs::write(root.join("logs").join("current.log"), b"mutable").unwrap();
            assert!(super::verify_installed_file_inventory(&root, &files).await);

            let core_path = root.join("native").join("core.dll");
            let temporary_core_path = root.join("native").join("core.rename");
            let wrong_case_core_path = root.join("native").join("CORE.DLL");
            std::fs::rename(&core_path, &temporary_core_path).unwrap();
            std::fs::rename(&temporary_core_path, &wrong_case_core_path).unwrap();
            assert!(!super::verify_installed_file_inventory(&root, &files).await);
            std::fs::rename(&wrong_case_core_path, &core_path).unwrap();

            std::fs::write(root.join("native").join("core.dll"), b"modified core").unwrap();
            assert!(!super::verify_installed_file_inventory(&root, &files).await);
            let _ = std::fs::remove_dir_all(root);
        });
    }

    #[test]
    fn updater_request_serializes_the_strict_v1_contract_without_split_brain_fields() {
        let request = super::UpdaterLaunchRequest {
            schema_version: 1,
            operation_id: "op_update".to_string(),
            parent_pid: 42,
            parent_start_time_utc: "2026-07-30T10:00:00.000Z".to_string(),
            install_directory: PathBuf::from("C:\\Program Files\\Fluxora"),
            updater_working_directory: PathBuf::from("C:\\Temp\\FluxoraUpdater"),
            package_path: PathBuf::from("C:\\Temp\\update.package"),
            manifest_path: PathBuf::from("C:\\Temp\\manifest.json"),
            signature_path: PathBuf::from("C:\\Temp\\manifest.sig"),
            current_version: "1.0.0".to_string(),
            target_version: "2.0.0".to_string(),
            target: "win-x64",
            asset_kind: UpdateAssetKind::Delta,
            from_version: Some("1.0.0".to_string()),
            package_sha256: "a".repeat(64),
            package_size: 1024,
            application_executable: "Fluxora.exe".to_string(),
            handoff_nonce: "b".repeat(64),
            working_directory: PathBuf::from("C:\\Program Files\\Fluxora"),
        };
        let value = serde_json::to_value(&request).unwrap();
        let keys = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            keys,
            BTreeSet::from([
                "applicationExecutable",
                "assetKind",
                "currentVersion",
                "fromVersion",
                "handoffNonce",
                "installDirectory",
                "manifestPath",
                "operationId",
                "packagePath",
                "packageSha256",
                "packageSize",
                "parentPid",
                "parentStartTimeUtc",
                "schemaVersion",
                "signaturePath",
                "target",
                "targetVersion",
                "updaterWorkingDirectory",
                "workingDirectory",
            ])
        );
        assert!(serde_json::to_vec(&request).unwrap().len() < super::MAX_UPDATER_REQUEST_BYTES);
        assert_eq!(value["target"], "win-x64");
        assert_eq!(value["handoffNonce"], "b".repeat(64));
    }

    #[test]
    fn generated_health_handoff_nonces_are_strict_and_not_reused() {
        let first = super::generate_handoff_nonce().expect("secure nonce");
        let second = super::generate_handoff_nonce().expect("secure nonce");
        for nonce in [&first, &second] {
            assert_eq!(nonce.len(), 64);
            assert!(nonce
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
        }
        assert_ne!(first, second);
    }

    #[test]
    fn updater_artifacts_are_staged_inside_the_owned_runtime() {
        tauri::async_runtime::block_on(async {
            let root = std::env::temp_dir().join(format!(
                "fluxora-update-stage-{}-{}",
                std::process::id(),
                super::now_millis()
            ));
            let source_directory = root.join("download-cache");
            let runtime_directory = root.join("runtime");
            std::fs::create_dir_all(&source_directory).unwrap();
            std::fs::create_dir_all(&runtime_directory).unwrap();
            let source = source_directory.join("signed.package");
            std::fs::write(&source, b"verified package bytes").unwrap();

            let staged =
                super::stage_runtime_artifact(&source, &runtime_directory, "update.package")
                    .await
                    .unwrap();

            assert_eq!(staged, runtime_directory.join("update.package"));
            assert_eq!(std::fs::read(&staged).unwrap(), b"verified package bytes");
            assert_eq!(std::fs::read(&source).unwrap(), b"verified package bytes");
            let _ = std::fs::remove_dir_all(root);
        });
    }

    #[test]
    fn sanitizes_untrusted_operation_ids_before_using_them_as_runtime_components() {
        let injected = crate::OperationRequest {
            operation_id: Some("..\\evil\r\nlog".to_string()),
        };
        assert!(
            super::update_operation_id(Some(&injected), "updates_install")
                .ends_with("_updates_install")
        );
        let valid = crate::OperationRequest {
            operation_id: Some("op_update-1.safe".to_string()),
        };
        assert_eq!(
            super::update_operation_id(Some(&valid), "updates_install"),
            "op_update-1.safe"
        );
        assert_eq!(
            super::runtime_operation_component(".."),
            "operation-5ec1f7e700f37c3d0b2981d04855fc34"
        );
        assert!(!super::runtime_operation_component("CON").contains("CON"));
    }

    #[test]
    fn resume_metadata_rejects_unknown_fields() {
        let value = json!({
            "schemaVersion": 1,
            "assetUrlSha256": "a",
            "packageSha256": "b",
            "packageSize": 1,
            "etag": null,
            "lastModified": null,
            "packagePath": "C:\\secret"
        });
        assert!(serde_json::from_value::<super::DownloadResumeRecord>(value).is_err());
    }

    #[test]
    fn captures_the_real_parent_process_start_time_in_utc() {
        let value = super::parent_start_time_utc().expect("process start time must be available");
        let parsed = chrono::DateTime::parse_from_rfc3339(&value).expect("must be RFC3339");
        let age = Utc::now().signed_duration_since(parsed.with_timezone(&Utc));
        assert!(age.num_seconds() >= 0);
        assert!(age.num_hours() < 24);
    }

    #[test]
    fn accepts_only_one_strict_health_handoff_pair() {
        let nonce = "a".repeat(64);
        let operation_id = "update-operation_123".to_string();
        assert_eq!(
            super::update_handoff_context([
                "Fluxora.exe".to_string(),
                "--fluxora-update-handoff".to_string(),
                nonce.clone(),
                "--fluxora-update-operation-id".to_string(),
                operation_id.clone(),
            ]),
            Some(super::UpdateHandoffContext {
                nonce: nonce.clone(),
                operation_id: operation_id.clone(),
            })
        );
        for arguments in [
            vec![
                "Fluxora.exe".to_string(),
                "--fluxora-update-handoff".to_string(),
                "A".repeat(64),
                "--fluxora-update-operation-id".to_string(),
                operation_id.clone(),
            ],
            vec![
                "Fluxora.exe".to_string(),
                "--fluxora-update-handoff".to_string(),
                "../ack".to_string(),
                "--fluxora-update-operation-id".to_string(),
                operation_id.clone(),
            ],
            vec![
                "Fluxora.exe".to_string(),
                "--fluxora-update-handoff".to_string(),
                nonce.clone(),
                "--fluxora-update-handoff".to_string(),
                nonce.clone(),
                "--fluxora-update-operation-id".to_string(),
                operation_id.clone(),
            ],
            vec![
                "Fluxora.exe".to_string(),
                "--fluxora-update-handoff".to_string(),
                nonce.clone(),
            ],
            vec![
                "Fluxora.exe".to_string(),
                "--fluxora-update-handoff".to_string(),
                nonce.clone(),
                "--fluxora-update-operation-id".to_string(),
                "line\nbreak".to_string(),
            ],
        ] {
            assert_eq!(super::update_handoff_context(arguments), None);
        }
    }

    #[test]
    fn health_acknowledgment_has_the_exact_bounded_v1_contract() {
        let acknowledgment = super::UpdateHealthAcknowledgment {
            schema_version: 1,
            nonce: "a".repeat(64),
            operation_id: "update-operation_123".to_string(),
            app_version: "2.0.0".to_string(),
            pid: 42,
            process_start_time_utc: "2026-07-30T10:00:00.000Z".to_string(),
        };
        let value = serde_json::to_value(&acknowledgment).unwrap();
        assert_eq!(
            value
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "appVersion",
                "nonce",
                "operationId",
                "pid",
                "processStartTimeUtc",
                "schemaVersion"
            ])
        );
        assert!(serde_json::to_vec(&acknowledgment).unwrap().len() < 512);
    }

    #[test]
    fn health_ack_accepts_only_the_exact_main_window_label() {
        assert!(super::renderer_window_is_main("main"));
        for label in ["settings", "build-settings:1", "Main", "main:secondary"] {
            assert!(!super::renderer_window_is_main(label), "{label}");
        }
    }

    #[test]
    fn updater_runtime_stages_only_the_self_contained_executable() {
        assert_eq!(super::UPDATER_RUNTIME_NATIVE_FILES, ["FluxoraUpdater.exe"]);
        assert!(super::UPDATER_RUNTIME_NATIVE_FILES
            .iter()
            .all(|file| !file.ends_with(".dll")));
    }

    #[test]
    fn health_handshake_timeout_fits_inside_updater_probation() {
        assert!(super::HEALTH_HANDSHAKE_TIMEOUT_MS < 30_000);
        assert_eq!(super::HEALTH_HANDSHAKE_TIMEOUT_MS, 2_000);
    }

    #[test]
    fn startup_retry_budget_is_bounded_inside_one_session() {
        assert_eq!(super::STARTUP_RETRY_DELAYS.len(), 2);
        assert_eq!(
            super::STARTUP_RETRY_DELAYS
                .iter()
                .sum::<std::time::Duration>(),
            std::time::Duration::from_secs(35)
        );
    }

    #[test]
    fn missing_first_release_manifest_remains_retryable_in_the_running_app() {
        assert!(crate::update_shared::is_retryable_discovery_status(
            reqwest::StatusCode::NOT_FOUND
        ));
        assert!(crate::update_shared::is_retryable_discovery_status(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        ));
        assert!(!crate::update_shared::is_retryable_discovery_status(
            reqwest::StatusCode::UNAUTHORIZED
        ));
    }

    #[test]
    fn cancellation_wins_before_commit_and_is_rejected_after_commit() {
        let state = super::UpdateRuntimeState::default();
        assert!(super::request_update_cancel(&state, true));
        assert!(!super::commit_updater_launch(&state));

        super::reset_install_decision(&state);
        assert!(super::commit_updater_launch(&state));
        assert!(!super::request_update_cancel(&state, true));
    }

    #[test]
    fn cancel_and_updater_commit_have_one_atomic_winner_under_race() {
        for _ in 0..64 {
            let state = std::sync::Arc::new(super::UpdateRuntimeState::default());
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
            let cancel_state = state.clone();
            let cancel_barrier = barrier.clone();
            let cancel = std::thread::spawn(move || {
                cancel_barrier.wait();
                super::request_update_cancel(&cancel_state, true)
            });
            let commit_state = state.clone();
            let commit_barrier = barrier.clone();
            let commit = std::thread::spawn(move || {
                commit_barrier.wait();
                super::commit_updater_launch(&commit_state)
            });
            barrier.wait();

            let cancel_won = cancel.join().expect("cancel race thread");
            let commit_won = commit.join().expect("commit race thread");
            assert_ne!(cancel_won, commit_won);
            assert_eq!(super::update_cancel_requested(&state), cancel_won);
        }
    }
}
