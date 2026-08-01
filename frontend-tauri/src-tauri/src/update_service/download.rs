use super::*;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DownloadResumeRecord {
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

fn asset_kind_label(kind: UpdateAssetKind) -> &'static str {
    match kind {
        UpdateAssetKind::Full => "full",
        UpdateAssetKind::Delta => "delta",
    }
}

fn download_paths(
    app: &AppHandle,
    release: &VerifiedRelease,
) -> Result<DownloadPaths, UpdateServiceError> {
    let asset = release.selected_asset.as_ref().ok_or_else(|| {
        UpdateServiceError::new(
            "update-not-available",
            "No compatible application update is available.",
            true,
        )
    })?;
    let directory = update_root(app)?
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

pub(super) fn content_range_starts_at(
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

pub(super) async fn emit_download_progress(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    current: &Version,
    release: &VerifiedRelease,
    operation_id: &str,
    downloaded: u64,
) {
    let total = release
        .selected_asset
        .as_ref()
        .map(|asset| asset.size)
        .unwrap_or_default();
    let mut status = FluxoraUpdateStatus::for_state(
        UpdateState::Downloading,
        current,
        Some(release),
        operation_id,
    );
    status.downloaded_bytes = Some(downloaded);
    status.total_bytes = Some(total);
    status.progress_percent = (total > 0).then_some(downloaded as f64 * 100.0 / total as f64);
    set_status(app, state, status).await;
}

pub(super) async fn download_selected_package(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    current: &Version,
    release: &VerifiedRelease,
    operation_id: &str,
) -> Result<PathBuf, UpdateServiceError> {
    let Some(client) = state.download_client.as_ref() else {
        return Err(UpdateServiceError::new(
            "http-client-unavailable",
            "Secure update networking could not be initialized.",
            true,
        ));
    };
    let root = update_root(app)?;
    let shared_release = to_shared_release(release);
    crate::update_shared::download_selected_package(
        &root,
        client,
        &shared_release,
        || update_cancel_requested(state),
        |downloaded, _| async move {
            emit_download_progress(app, state, current, release, operation_id, downloaded).await;
        },
    )
    .await
    .map_err(shared_error)
}

#[allow(dead_code)]
async fn download_selected_package_legacy(
    app: &AppHandle,
    state: &UpdateRuntimeState,
    current: &Version,
    release: &VerifiedRelease,
    operation_id: &str,
) -> Result<PathBuf, UpdateServiceError> {
    if update_cancel_requested(state) {
        return Err(update_cancelled_error());
    }
    let asset = release.selected_asset.as_ref().ok_or_else(|| {
        UpdateServiceError::new(
            "update-not-available",
            "No compatible application update is available.",
            true,
        )
    })?;
    let paths = download_paths(app, release)?;
    fs::create_dir_all(&paths.directory).await.map_err(|_| {
        UpdateServiceError::new(
            "storage-write-failed",
            "Update data could not be stored.",
            true,
        )
    })?;
    if verified_package_exists(&paths.package, asset).await {
        emit_download_progress(app, state, current, release, operation_id, asset.size).await;
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
        return Ok(paths.package);
    }

    let can_resume = partial_size > 0 && partial_size < asset.size && resume.is_some();
    if !can_resume && partial_size > 0 {
        let _ = fs::remove_file(&paths.partial).await;
    }
    let Some(client) = state.download_client.as_ref() else {
        return Err(UpdateServiceError::new(
            "http-client-unavailable",
            "Secure update networking could not be initialized.",
            true,
        ));
    };
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
    emit_download_progress(app, state, current, release, operation_id, downloaded).await;
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        UpdateServiceError::new(
            "package-download-failed",
            "The update package download was interrupted.",
            true,
        )
    })? {
        if update_cancel_requested(state) {
            output.sync_all().await.map_err(|_| {
                UpdateServiceError::new(
                    "package-write-failed",
                    "The update package could not be stored.",
                    true,
                )
            })?;
            return Err(update_cancelled_error());
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
            emit_download_progress(app, state, current, release, operation_id, downloaded).await;
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

pub(super) async fn store_manifest_artifacts(
    app: &AppHandle,
    release: &VerifiedRelease,
) -> Result<(PathBuf, PathBuf), UpdateServiceError> {
    crate::update_shared::store_manifest_artifacts(&update_root(app)?, &to_shared_release(release))
        .await
        .map_err(shared_error)
}
