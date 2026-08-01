use crate::update_manifest::{
    verify_and_parse_stable_manifest, UpdateAsset, UpdateAssetKind, UpdateManifest,
    MAX_MANIFEST_BYTES,
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
use sha2::{Digest, Sha256};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(crate) const MANIFEST_URL: &str =
    "https://github.com/Moddingflow/Fluxora/releases/latest/download/fluxora-update-manifest.json";
pub(crate) const SIGNATURE_URL: &str =
    "https://github.com/Moddingflow/Fluxora/releases/latest/download/fluxora-update-manifest.sig";
pub(crate) const MAX_CACHE_RECORD_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_SIGNATURE_BYTES: usize = 4 * 1024;
pub(crate) const MAX_UPDATER_REQUEST_BYTES: usize = 64 * 1024;
pub(crate) const CHECK_TIMEOUT: Duration = Duration::from_secs(6);
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_millis(1_500);
pub(crate) const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(30);
const UPDATE_CACHE_SCHEMA_VERSION: u32 = 1;
const UPDATE_REQUEST_SCHEMA_VERSION: u32 = 1;
const MAX_REDIRECTS: usize = 5;
const ALLOWED_UPDATE_HOSTS: [&str; 3] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];
const DECISION_OPEN: u8 = 0;
const DECISION_CANCELLED: u8 = 1;
const DECISION_COMMITTED: u8 = 2;

#[derive(Clone, Copy, Debug)]
pub(crate) struct UpdateServiceError {
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
    pub(crate) retryable: bool,
}

impl UpdateServiceError {
    pub(crate) const fn new(code: &'static str, message: &'static str, retryable: bool) -> Self {
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

#[derive(Default)]
pub(crate) struct UpdateDecision {
    state: AtomicU8,
}

impl UpdateDecision {
    pub(crate) fn reset(&self) {
        self.state.store(DECISION_OPEN, Ordering::Release);
    }

    pub(crate) fn request_cancel(&self, cancellable: bool) -> bool {
        if !cancellable {
            return false;
        }
        match self.state.compare_exchange(
            DECISION_OPEN,
            DECISION_CANCELLED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) | Err(DECISION_CANCELLED) => true,
            Err(_) => false,
        }
    }

    pub(crate) fn commit(&self) -> bool {
        self.state
            .compare_exchange(
                DECISION_OPEN,
                DECISION_COMMITTED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.state.load(Ordering::Acquire) == DECISION_CANCELLED
    }

    pub(crate) fn committed(&self) -> bool {
        self.state.load(Ordering::Acquire) == DECISION_COMMITTED
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct CacheValidators {
    pub(crate) etag: Option<String>,
    pub(crate) last_modified: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct VerifiedRelease {
    pub(crate) manifest: UpdateManifest,
    pub(crate) manifest_bytes: Vec<u8>,
    pub(crate) signature_text: Vec<u8>,
    pub(crate) validators: CacheValidators,
    pub(crate) selected_asset: Option<UpdateAsset>,
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DownloadResumeRecord {
    schema_version: u32,
    asset_url_sha256: String,
    package_sha256: String,
    package_size: u64,
    etag: Option<String>,
    last_modified: Option<String>,
}

struct DownloadPaths {
    directory: PathBuf,
    partial: PathBuf,
    resume: PathBuf,
    package: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdaterLaunchRequest {
    pub(crate) schema_version: u32,
    pub(crate) operation_id: String,
    pub(crate) parent_pid: u32,
    pub(crate) parent_start_time_utc: String,
    pub(crate) install_directory: PathBuf,
    pub(crate) updater_working_directory: PathBuf,
    pub(crate) package_path: PathBuf,
    pub(crate) manifest_path: PathBuf,
    pub(crate) signature_path: PathBuf,
    pub(crate) current_version: String,
    pub(crate) target_version: String,
    pub(crate) target: &'static str,
    pub(crate) asset_kind: UpdateAssetKind,
    pub(crate) from_version: Option<String>,
    pub(crate) package_sha256: String,
    pub(crate) package_size: u64,
    pub(crate) application_executable: String,
    pub(crate) handoff_nonce: String,
    pub(crate) working_directory: PathBuf,
}

pub(crate) struct HandoffInput<'a> {
    pub(crate) operation_id: &'a str,
    pub(crate) parent_start_time_utc: String,
    pub(crate) install_directory: &'a Path,
    pub(crate) application_path: &'a Path,
    pub(crate) updater_source: &'a Path,
    pub(crate) current_version: &'a Version,
    pub(crate) release: &'a VerifiedRelease,
    pub(crate) package_path: PathBuf,
    pub(crate) manifest_path: PathBuf,
    pub(crate) signature_path: PathBuf,
}

pub(crate) struct PreparedUpdaterLaunch {
    pub(crate) updater_path: PathBuf,
    pub(crate) request_path: PathBuf,
}

pub(crate) fn stable_update_root() -> Result<PathBuf, UpdateServiceError> {
    let app_data = std::env::var_os("APPDATA").ok_or_else(|| {
        UpdateServiceError::new(
            "update-data-root-unavailable",
            "The stable application data directory is unavailable.",
            false,
        )
    })?;
    Ok(PathBuf::from(app_data).join("Fluxora").join("updates"))
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn is_allowed_update_transport_url(value: &str) -> bool {
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

pub(crate) fn is_retryable_discovery_status(status: StatusCode) -> bool {
    status == StatusCode::NOT_FOUND || status.is_server_error()
}

pub(crate) fn build_http_client(
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

pub(crate) fn conditional_headers(validators: &CacheValidators) -> HeaderMap {
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

pub(crate) async fn fetch_latest_release(
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
            is_retryable_discovery_status(response.status()),
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
            is_retryable_discovery_status(signature_response.status()),
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

pub(crate) async fn read_bounded_file(path: &Path, max_bytes: usize) -> Option<Vec<u8>> {
    let metadata = fs::metadata(path).await.ok()?;
    if metadata.len() > max_bytes as u64 {
        return None;
    }
    fs::read(path)
        .await
        .ok()
        .filter(|bytes| bytes.len() <= max_bytes)
}

pub(crate) async fn load_verified_cache(root: &Path) -> Option<VerifiedRelease> {
    let directory = root.join("cache");
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

pub(crate) async fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), UpdateServiceError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.map_err(|_| {
            UpdateServiceError::new(
                "storage-write-failed",
                "Update data could not be stored.",
                true,
            )
        })?;
    }
    let temporary = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        Utc::now().timestamp_millis()
    ));
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

pub(crate) async fn store_verified_cache(
    root: &Path,
    release: &VerifiedRelease,
) -> Result<(), UpdateServiceError> {
    let directory = root.join("cache");
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
        checked_at_epoch_ms: Utc::now().timestamp_millis().max(0) as u128,
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
        Utc::now().timestamp_millis().max(0),
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

pub(crate) async fn discover_full_release(
    root: &Path,
    client: &Client,
    current_version: &Version,
) -> Result<Option<VerifiedRelease>, UpdateServiceError> {
    let cached = load_verified_cache(root).await;
    let fetched =
        tokio::time::timeout(CHECK_TIMEOUT, fetch_latest_release(client, cached.as_ref())).await;
    let mut release = match fetched {
        Ok(Ok(release)) => release,
        Ok(Err(error)) if error.retryable && cached.is_some() => {
            cached.clone().expect("cache presence was checked")
        }
        Ok(Err(error)) => return Err(error),
        Err(_) if cached.is_some() => cached.clone().expect("cache presence was checked"),
        Err(_) => {
            return Err(UpdateServiceError::new(
                "update-check-timeout",
                "The update check timed out.",
                true,
            ));
        }
    };
    let cache_changed = cached.as_ref().is_none_or(|cached| {
        cached.manifest_bytes != release.manifest_bytes
            || cached.signature_text != release.signature_text
            || cached.validators != release.validators
    });
    if cache_changed {
        let _ = store_verified_cache(root, &release).await;
    }
    release.selected_asset = select_full_asset(&release.manifest, current_version);
    Ok(release.selected_asset.is_some().then_some(release))
}

pub(crate) fn select_full_asset(
    manifest: &UpdateManifest,
    current_version: &Version,
) -> Option<UpdateAsset> {
    if manifest.version <= *current_version {
        return None;
    }
    manifest
        .assets
        .iter()
        .find(|asset| asset.kind == UpdateAssetKind::Full)
        .cloned()
}

fn asset_kind_label(kind: UpdateAssetKind) -> &'static str {
    match kind {
        UpdateAssetKind::Full => "full",
        UpdateAssetKind::Delta => "delta",
    }
}

fn download_paths(
    root: &Path,
    release: &VerifiedRelease,
) -> Result<DownloadPaths, UpdateServiceError> {
    let asset = release.selected_asset.as_ref().ok_or_else(|| {
        UpdateServiceError::new(
            "update-not-available",
            "No compatible application update is available.",
            true,
        )
    })?;
    let directory = root
        .join("downloads")
        .join(release.manifest.version.to_string());
    let stem = format!("{}-{}", asset_kind_label(asset.kind), asset.sha256);
    Ok(DownloadPaths {
        partial: directory.join(format!("{stem}.package.partial")),
        resume: directory.join(format!("{stem}.resume.json")),
        package: directory.join(format!("{stem}.package")),
        directory,
    })
}

async fn sha256_file(path: &Path) -> Result<(u64, String), UpdateServiceError> {
    let mut file = fs::File::open(path).await.map_err(|_| {
        UpdateServiceError::new(
            "package-read-failed",
            "The downloaded update package could not be read.",
            true,
        )
    })?;
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut size = 0_u64;
    let mut hasher = Sha256::new();
    loop {
        let count = file.read(&mut buffer).await.map_err(|_| {
            UpdateServiceError::new(
                "package-read-failed",
                "The downloaded update package could not be read.",
                true,
            )
        })?;
        if count == 0 {
            break;
        }
        size = size.saturating_add(count as u64);
        hasher.update(&buffer[..count]);
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}

async fn verified_package_exists(path: &Path, asset: &UpdateAsset) -> bool {
    matches!(
        sha256_file(path).await,
        Ok((size, digest)) if size == asset.size && digest == asset.sha256
    )
}

async fn load_resume_record(path: &Path, asset: &UpdateAsset) -> Option<DownloadResumeRecord> {
    let bytes = read_bounded_file(path, 16 * 1024).await?;
    let record: DownloadResumeRecord = serde_json::from_slice(&bytes).ok()?;
    let validators_present = record.etag.is_some() || record.last_modified.is_some();
    (record.schema_version == 1
        && record.asset_url_sha256 == sha256_hex(asset.url.as_bytes())
        && record.package_sha256 == asset.sha256
        && record.package_size == asset.size
        && validators_present)
        .then_some(record)
}

async fn store_resume_record(
    path: &Path,
    asset: &UpdateAsset,
    validators: &CacheValidators,
) -> Result<(), UpdateServiceError> {
    if validators.etag.is_none() && validators.last_modified.is_none() {
        let _ = fs::remove_file(path).await;
        return Ok(());
    }
    let record = DownloadResumeRecord {
        schema_version: 1,
        asset_url_sha256: sha256_hex(asset.url.as_bytes()),
        package_sha256: asset.sha256.clone(),
        package_size: asset.size,
        etag: validators.etag.clone(),
        last_modified: validators.last_modified.clone(),
    };
    let bytes = serde_json::to_vec(&record).map_err(|_| {
        UpdateServiceError::new(
            "resume-metadata-failed",
            "The update download resume metadata could not be stored.",
            true,
        )
    })?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .await
        .map_err(|_| {
            UpdateServiceError::new(
                "resume-metadata-failed",
                "The update download resume metadata could not be stored.",
                true,
            )
        })?;
    file.write_all(&bytes).await.map_err(|_| {
        UpdateServiceError::new(
            "resume-metadata-failed",
            "The update download resume metadata could not be stored.",
            true,
        )
    })?;
    file.sync_all().await.map_err(|_| {
        UpdateServiceError::new(
            "resume-metadata-failed",
            "The update download resume metadata could not be stored.",
            true,
        )
    })
}

pub(crate) fn content_range_starts_at(
    value: Option<&HeaderValue>,
    expected: u64,
    total: u64,
) -> bool {
    let Some(value) = value.and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let Some(value) = value.strip_prefix("bytes ") else {
        return false;
    };
    let Some((range, total_value)) = value.split_once('/') else {
        return false;
    };
    let Some((start, end)) = range.split_once('-') else {
        return false;
    };
    let (Ok(start), Ok(end), Ok(response_total)) = (
        start.parse::<u64>(),
        end.parse::<u64>(),
        total_value.parse::<u64>(),
    ) else {
        return false;
    };
    start == expected && end >= start && response_total == total && end < total
}

pub(crate) async fn download_selected_package<F, Fut, C>(
    root: &Path,
    client: &Client,
    release: &VerifiedRelease,
    is_cancelled: C,
    mut on_progress: F,
) -> Result<PathBuf, UpdateServiceError>
where
    F: FnMut(u64, u64) -> Fut,
    Fut: Future<Output = ()>,
    C: Fn() -> bool,
{
    if is_cancelled() {
        return Err(UpdateServiceError::new(
            "update-cancelled",
            "The application update was cancelled.",
            true,
        ));
    }
    let asset = release.selected_asset.as_ref().ok_or_else(|| {
        UpdateServiceError::new(
            "update-not-available",
            "No compatible application update is available.",
            true,
        )
    })?;
    let paths = download_paths(root, release)?;
    fs::create_dir_all(&paths.directory).await.map_err(|_| {
        UpdateServiceError::new(
            "storage-write-failed",
            "Update data could not be stored.",
            true,
        )
    })?;
    if verified_package_exists(&paths.package, asset).await {
        on_progress(asset.size, asset.size).await;
        return Ok(paths.package);
    }
    if fs::try_exists(&paths.package).await.unwrap_or(false) {
        let _ = fs::remove_file(&paths.package).await;
    }
    let resume = load_resume_record(&paths.resume, asset).await;
    let partial_size = fs::metadata(&paths.partial)
        .await
        .ok()
        .map(|metadata| metadata.len())
        .filter(|size| *size <= asset.size)
        .unwrap_or_default();
    if partial_size == asset.size && verified_package_exists(&paths.partial, asset).await {
        fs::rename(&paths.partial, &paths.package)
            .await
            .map_err(|_| {
                UpdateServiceError::new(
                    "package-finalize-failed",
                    "The update package could not be finalized.",
                    true,
                )
            })?;
        let _ = fs::remove_file(&paths.resume).await;
        on_progress(asset.size, asset.size).await;
        return Ok(paths.package);
    }
    let can_resume = partial_size > 0 && partial_size < asset.size && resume.is_some();
    if !can_resume && partial_size > 0 {
        let _ = fs::remove_file(&paths.partial).await;
    }
    let asset_url = Url::parse(&asset.url).map_err(|_| {
        UpdateServiceError::new(
            "asset-url-invalid",
            "The signed update package URL is invalid.",
            false,
        )
    })?;
    if !is_allowed_update_transport_url(asset_url.as_str()) {
        return Err(UpdateServiceError::new(
            "asset-url-invalid",
            "The signed update package URL is invalid.",
            false,
        ));
    }
    let mut request = client.get(asset_url);
    let requested_offset = if can_resume { partial_size } else { 0 };
    if requested_offset > 0 {
        request = request.header(RANGE, format!("bytes={requested_offset}-"));
        if let Some(record) = resume.as_ref() {
            if let Some(value) = record.etag.as_deref().or(record.last_modified.as_deref()) {
                request = request.header(IF_RANGE, value);
            }
        }
    }
    let mut response = request.send().await.map_err(|_| {
        UpdateServiceError::new(
            "package-download-failed",
            "The update package download was interrupted.",
            true,
        )
    })?;
    if !is_allowed_update_transport_url(response.url().as_str()) {
        return Err(UpdateServiceError::new(
            "redirect-rejected",
            "The update package redirect was rejected.",
            false,
        ));
    }
    let append = requested_offset > 0
        && response.status() == StatusCode::PARTIAL_CONTENT
        && content_range_starts_at(
            response.headers().get(CONTENT_RANGE),
            requested_offset,
            asset.size,
        );
    if response.status() != StatusCode::OK && !append {
        return Err(UpdateServiceError::new(
            "package-http-failed",
            "The update package could not be retrieved.",
            response.status().is_server_error(),
        ));
    }
    let offset = if append { requested_offset } else { 0 };
    let remaining = asset.size.saturating_sub(offset);
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length != remaining)
    {
        return Err(UpdateServiceError::new(
            "package-size-mismatch",
            "The update package size does not match the signed manifest.",
            false,
        ));
    }
    let validators = CacheValidators {
        etag: bounded_header(response.headers(), ETAG, 256),
        last_modified: bounded_header(response.headers(), LAST_MODIFIED, 128),
    };
    store_resume_record(&paths.resume, asset, &validators).await?;
    let mut output = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&paths.partial)
        .await
        .map_err(|_| {
            UpdateServiceError::new(
                "package-write-failed",
                "The update package could not be stored.",
                true,
            )
        })?;
    let mut downloaded = offset;
    let emit_stride = (asset.size / 100).clamp(1024 * 1024, 64 * 1024 * 1024);
    let mut next_emit = downloaded.saturating_add(emit_stride);
    on_progress(downloaded, asset.size).await;
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        UpdateServiceError::new(
            "package-download-failed",
            "The update package download was interrupted.",
            true,
        )
    })? {
        if is_cancelled() {
            output.sync_all().await.map_err(|_| {
                UpdateServiceError::new(
                    "package-write-failed",
                    "The update package could not be stored.",
                    true,
                )
            })?;
            return Err(UpdateServiceError::new(
                "update-cancelled",
                "The application update was cancelled.",
                true,
            ));
        }
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > asset.size {
            drop(output);
            let _ = fs::remove_file(&paths.partial).await;
            let _ = fs::remove_file(&paths.resume).await;
            return Err(UpdateServiceError::new(
                "package-size-mismatch",
                "The update package size does not match the signed manifest.",
                false,
            ));
        }
        output.write_all(&chunk).await.map_err(|_| {
            UpdateServiceError::new(
                "package-write-failed",
                "The update package could not be stored.",
                true,
            )
        })?;
        if downloaded >= next_emit || downloaded == asset.size {
            on_progress(downloaded, asset.size).await;
            next_emit = downloaded.saturating_add(emit_stride);
        }
    }
    output.sync_all().await.map_err(|_| {
        UpdateServiceError::new(
            "package-write-failed",
            "The update package could not be stored.",
            true,
        )
    })?;
    drop(output);
    let (actual_size, actual_sha256) = sha256_file(&paths.partial).await?;
    if actual_size != asset.size || actual_sha256 != asset.sha256 {
        let _ = fs::remove_file(&paths.partial).await;
        let _ = fs::remove_file(&paths.resume).await;
        return Err(UpdateServiceError::new(
            "package-verification-failed",
            "The update package failed integrity verification.",
            false,
        ));
    }
    fs::rename(&paths.partial, &paths.package)
        .await
        .map_err(|_| {
            UpdateServiceError::new(
                "package-finalize-failed",
                "The update package could not be finalized.",
                true,
            )
        })?;
    let _ = fs::remove_file(&paths.resume).await;
    Ok(paths.package)
}

async fn ensure_exact_file(path: &Path, bytes: &[u8]) -> Result<(), UpdateServiceError> {
    if let Some(existing) = read_bounded_file(path, MAX_CACHE_RECORD_BYTES).await {
        if existing == bytes {
            return Ok(());
        }
        return Err(UpdateServiceError::new(
            "staged-file-collision",
            "A staged update file did not match its verified content.",
            false,
        ));
    }
    write_new_file(path, bytes).await
}

pub(crate) async fn store_manifest_artifacts(
    root: &Path,
    release: &VerifiedRelease,
) -> Result<(PathBuf, PathBuf), UpdateServiceError> {
    let digest = sha256_hex(&release.manifest_bytes);
    let directory = root.join("manifests");
    let manifest_path = directory.join(format!("{digest}.json"));
    let signature_path = directory.join(format!("{digest}.sig"));
    ensure_exact_file(&manifest_path, &release.manifest_bytes).await?;
    ensure_exact_file(&signature_path, &release.signature_text).await?;
    Ok((manifest_path, signature_path))
}

pub(crate) fn runtime_operation_component(operation_id: &str) -> String {
    let digest = sha256_hex(operation_id.as_bytes());
    format!("operation-{}", &digest[..32])
}

pub(crate) fn generate_handoff_nonce() -> Result<String, UpdateServiceError> {
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

fn is_reparse_or_link(metadata: &std::fs::Metadata) -> bool {
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

fn trusted_installed_file(
    install_directory: &Path,
    source: &Path,
) -> Result<PathBuf, UpdateServiceError> {
    let install_metadata = std::fs::symlink_metadata(install_directory).map_err(|_| {
        UpdateServiceError::new(
            "install-directory-unavailable",
            "The installed application directory is unavailable.",
            false,
        )
    })?;
    let source_metadata = std::fs::symlink_metadata(source).map_err(|_| {
        UpdateServiceError::new(
            "updater-resource-missing",
            "The installed updater is unavailable.",
            false,
        )
    })?;
    if !install_metadata.is_dir()
        || is_reparse_or_link(&install_metadata)
        || !source_metadata.is_file()
        || is_reparse_or_link(&source_metadata)
    {
        return Err(UpdateServiceError::new(
            "updater-resource-untrusted",
            "The installed updater could not be trusted.",
            false,
        ));
    }
    let canonical_install = std::fs::canonicalize(install_directory).map_err(|_| {
        UpdateServiceError::new(
            "install-directory-unavailable",
            "The installed application directory is unavailable.",
            false,
        )
    })?;
    let canonical_source = std::fs::canonicalize(source).map_err(|_| {
        UpdateServiceError::new(
            "updater-resource-untrusted",
            "The installed updater could not be trusted.",
            false,
        )
    })?;
    if !canonical_source.starts_with(&canonical_install) {
        return Err(UpdateServiceError::new(
            "updater-resource-untrusted",
            "The installed updater could not be trusted.",
            false,
        ));
    }
    Ok(canonical_source)
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

pub(crate) async fn stage_runtime_artifact(
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

pub(crate) async fn prepare_updater_handoff(
    root: &Path,
    input: HandoffInput<'_>,
) -> Result<PreparedUpdaterLaunch, UpdateServiceError> {
    let updater_source = trusted_installed_file(input.install_directory, input.updater_source)?;
    let canonical_install = std::fs::canonicalize(input.install_directory).map_err(|_| {
        UpdateServiceError::new(
            "install-directory-unavailable",
            "The installed application directory is unavailable.",
            false,
        )
    })?;
    let canonical_application = std::fs::canonicalize(input.application_path).map_err(|_| {
        UpdateServiceError::new(
            "application-path-unavailable",
            "The installed application executable is unavailable.",
            false,
        )
    })?;
    if canonical_application.parent() != Some(canonical_install.as_path())
        || canonical_application
            .file_name()
            .is_none_or(|name| !name.eq_ignore_ascii_case("Fluxora.exe"))
    {
        return Err(UpdateServiceError::new(
            "application-path-untrusted",
            "The installed application executable could not be trusted.",
            false,
        ));
    }
    let asset = input.release.selected_asset.as_ref().ok_or_else(|| {
        UpdateServiceError::new(
            "update-not-available",
            "No compatible application update is available.",
            true,
        )
    })?;
    let runtime_root = root.join("updater-runtime");
    fs::create_dir_all(&runtime_root).await.map_err(|_| {
        UpdateServiceError::new(
            "updater-stage-failed",
            "The application updater could not be staged.",
            true,
        )
    })?;
    let canonical_root = fs::canonicalize(&runtime_root).await.map_err(|_| {
        UpdateServiceError::new(
            "updater-stage-failed",
            "The application updater could not be staged.",
            true,
        )
    })?;
    if canonical_root.starts_with(&canonical_install) {
        return Err(UpdateServiceError::new(
            "updater-runtime-inside-install",
            "The updater runtime must remain outside the installation.",
            false,
        ));
    }
    let runtime_directory = runtime_root.join(runtime_operation_component(input.operation_id));
    fs::create_dir(&runtime_directory).await.map_err(|_| {
        UpdateServiceError::new(
            "updater-runtime-collision",
            "A distinct updater runtime directory could not be created.",
            true,
        )
    })?;
    let updater_path = runtime_directory.join("FluxoraUpdater.exe");
    copy_runtime_file(&updater_source, &updater_path).await?;
    let package_path =
        stage_runtime_artifact(&input.package_path, &runtime_directory, "update.package").await?;
    let manifest_path =
        stage_runtime_artifact(&input.manifest_path, &runtime_directory, "manifest.json").await?;
    let signature_path =
        stage_runtime_artifact(&input.signature_path, &runtime_directory, "manifest.sig").await?;
    let request = UpdaterLaunchRequest {
        schema_version: UPDATE_REQUEST_SCHEMA_VERSION,
        operation_id: input.operation_id.to_string(),
        parent_pid: std::process::id(),
        parent_start_time_utc: input.parent_start_time_utc,
        install_directory: canonical_install.clone(),
        updater_working_directory: runtime_directory.clone(),
        package_path,
        manifest_path,
        signature_path,
        current_version: input.current_version.to_string(),
        target_version: input.release.manifest.version.to_string(),
        target: "win-x64",
        asset_kind: asset.kind,
        from_version: asset.from_version.as_ref().map(ToString::to_string),
        package_sha256: asset.sha256.clone(),
        package_size: asset.size,
        application_executable: input.release.manifest.application_executable.clone(),
        handoff_nonce: generate_handoff_nonce()?,
        working_directory: canonical_install,
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

#[cfg(windows)]
pub(crate) fn current_process_start_time_utc() -> Result<String, UpdateServiceError> {
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
pub(crate) fn current_process_start_time_utc() -> Result<String, UpdateServiceError> {
    Ok(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn transport_accepts_only_https_github_release_hosts() {
        assert!(is_allowed_update_transport_url(
            "https://github.com/Moddingflow/Fluxora/releases/latest/download/manifest.json"
        ));
        assert!(is_allowed_update_transport_url(
            "https://release-assets.githubusercontent.com/asset?opaque=true"
        ));
        for value in [
            "http://github.com/Moddingflow/Fluxora/releases/download/v1/file",
            "https://github.com.evil.invalid/file",
            "file:///C:/Fluxora.flxupd",
        ] {
            assert!(!is_allowed_update_transport_url(value), "{value}");
        }
    }

    #[test]
    fn cancel_and_handoff_commit_have_exactly_one_winner() {
        for _ in 0..64 {
            let decision = Arc::new(UpdateDecision::default());
            let cancel = Arc::clone(&decision);
            let commit = Arc::clone(&decision);
            let cancel_thread = thread::spawn(move || cancel.request_cancel(true));
            let commit_thread = thread::spawn(move || commit.commit());
            let cancel_won = cancel_thread.join().unwrap();
            let commit_won = commit_thread.join().unwrap();
            assert_ne!(cancel_won, commit_won);
            assert_ne!(decision.cancelled(), decision.committed());
        }
    }

    #[test]
    fn runtime_path_uses_only_a_digest_of_the_operation_id() {
        let component = runtime_operation_component("setup-private-operation");
        assert!(component.starts_with("operation-"));
        assert_eq!(component.len(), "operation-".len() + 32);
        assert!(!component.contains("private"));
    }

    fn asset(kind: UpdateAssetKind) -> UpdateAsset {
        UpdateAsset {
            kind,
            from_version: (kind == UpdateAssetKind::Delta).then(|| Version::new(2, 4, 0)),
            url: "https://github.com/Moddingflow/Fluxora/releases/download/v2.5.0/package.flxupd"
                .to_string(),
            size: 64,
            sha256: "a".repeat(64),
            base_file_manifest_sha256: (kind == UpdateAssetKind::Delta).then(|| "b".repeat(64)),
            target_file_manifest_sha256: "c".repeat(64),
        }
    }

    #[test]
    fn setup_selection_requires_a_newer_full_asset_and_never_downgrades() {
        let manifest = UpdateManifest {
            schema_version: 1,
            channel: "stable".to_string(),
            version: Version::new(2, 5, 0),
            target: "win-x64".to_string(),
            application_executable: "Fluxora.exe".to_string(),
            file_manifest_sha256: "d".repeat(64),
            files: Vec::new(),
            assets: vec![asset(UpdateAssetKind::Delta), asset(UpdateAssetKind::Full)],
        };
        assert_eq!(
            select_full_asset(&manifest, &Version::new(2, 4, 0)).map(|asset| asset.kind),
            Some(UpdateAssetKind::Full)
        );
        assert!(select_full_asset(&manifest, &Version::new(2, 5, 0)).is_none());
        assert!(select_full_asset(&manifest, &Version::new(2, 6, 0)).is_none());

        let delta_only = UpdateManifest {
            assets: vec![asset(UpdateAssetKind::Delta)],
            ..manifest
        };
        assert!(select_full_asset(&delta_only, &Version::new(2, 4, 0)).is_none());
    }
}
