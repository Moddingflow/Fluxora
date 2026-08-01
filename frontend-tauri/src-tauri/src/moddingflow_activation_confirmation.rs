use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use tauri::AppHandle;

pub(crate) const MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED: bool = true;
const MAX_OPERATION_ID_BYTES: usize = 256;
const MAX_INSTANCE_ID_BYTES: usize = 32 * 1024;
const MAX_PROFILE_NAME_BYTES: usize = 256;
const MAX_PROJECTS: usize = 256;
const MAX_PROFILES: usize = 256;
const MAX_PROVIDER_MAPPINGS: usize = 32;
const MAX_PROVIDER_SLUGS: usize = 32;
const MAX_NATIVE_PATH_BYTES: usize = 32 * 1024;
const MAX_LOCALIZED_TITLES: usize = 32;
const MAX_DISPLAY_TEXT_BYTES: usize = 512;
const MAX_GAME_VERSION_BYTES: usize = 80;
const MAX_PLAN_STEPS: usize = 256;
const MAX_PLAN_CONFLICTS: usize = 256;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;
const LOOKUP_TIMEOUT_MS: u64 = 30_000;
const LOCAL_REVALIDATION_TIMEOUT_MS: u64 = 10_000;
const PLAN_TIMEOUT_MS: u64 = 30_000;
const QUEUE_TIMEOUT_MS: u64 = 30_000;
const UNAVAILABLE_MESSAGE: &str =
    "ModdingFlow activation confirmation is unavailable in this build.";

type ActivationBridgeFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'a>>;

trait ModdingFlowActivationBridge: Send + Sync {
    fn call<'a>(
        &'a self,
        method: &'a str,
        params: Value,
        operation_id: &'a str,
        timeout_ms: u64,
    ) -> ActivationBridgeFuture<'a>;

    fn build_configs_directory(&self) -> String;
}

struct TauriModdingFlowActivationBridge {
    app: AppHandle,
}

impl ModdingFlowActivationBridge for TauriModdingFlowActivationBridge {
    fn call<'a>(
        &'a self,
        method: &'a str,
        params: Value,
        operation_id: &'a str,
        timeout_ms: u64,
    ) -> ActivationBridgeFuture<'a> {
        Box::pin(async move {
            crate::trusted_moddingflow_bridge_request(
                &self.app,
                method,
                params,
                operation_id,
                timeout_ms,
            )
            .await
        })
    }

    fn build_configs_directory(&self) -> String {
        crate::fluxora_runtime_paths(self.app.clone()).build_configs_directory
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModdingFlowActivationPreviewRequest {
    pub(crate) artifact_id: String,
    pub(crate) operation_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModdingFlowActivationPlanPreviewRequest {
    pub(crate) artifact_id: String,
    pub(crate) instance_id: String,
    pub(crate) profile_name: String,
    pub(crate) operation_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModdingFlowActivationAcceptRequest {
    pub(crate) artifact_id: String,
    pub(crate) instance_id: String,
    pub(crate) profile_name: String,
    pub(crate) confirmed_plan_id: String,
    pub(crate) operation_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModdingFlowActivationDismissRequest {
    pub(crate) artifact_id: String,
    pub(crate) operation_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ModdingFlowActivationPreviewState {
    Available,
    Unknown,
    Deleted,
    Ineligible,
    Disconnected,
    UnsupportedGame,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModdingFlowActivationPreview {
    pub(crate) artifact_id: String,
    pub(crate) state: ModdingFlowActivationPreviewState,
    pub(crate) eligible: Option<bool>,
    pub(crate) requires_account: bool,
    pub(crate) metadata: Option<ModdingFlowActivationPreviewMetadata>,
    pub(crate) operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModdingFlowActivationPreviewMetadata {
    #[serde(rename = "mod")]
    pub(crate) mod_info: ModdingFlowActivationModMetadata,
    pub(crate) version: ModdingFlowActivationVersionMetadata,
    pub(crate) game: ModdingFlowActivationGameMetadata,
    pub(crate) file: ModdingFlowActivationFileMetadata,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModdingFlowActivationModMetadata {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModdingFlowActivationVersionMetadata {
    pub(crate) id: String,
    pub(crate) label: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModdingFlowActivationGameMetadata {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModdingFlowActivationFileMetadata {
    pub(crate) name: String,
    pub(crate) size_bytes: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModdingFlowActivationPlanPreview {
    pub(crate) artifact_id: String,
    pub(crate) plan_id: String,
    pub(crate) required_download_count: usize,
    pub(crate) optional_download_count: usize,
    pub(crate) required_disk_size_bytes: u64,
    pub(crate) conflict_count: usize,
    pub(crate) operation_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ModdingFlowActivationDecisionState {
    Accepted,
    Dismissed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModdingFlowActivationDecisionResult {
    pub(crate) artifact_id: String,
    pub(crate) state: ModdingFlowActivationDecisionState,
    pub(crate) operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeArtifactPreview {
    artifact_id: String,
    mod_id: String,
    version_id: String,
    game_id: String,
    game_slug: String,
    title: BTreeMap<String, String>,
    version: String,
    filename: String,
    size_bytes: u64,
    sha256: String,
    access_tier: String,
    operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeActivationPlan {
    plan_id: String,
    game_slug: String,
    game_version: String,
    required_disk_size_bytes: u64,
    conflicts: Vec<NativeActivationPlanConflict>,
    steps: Vec<NativeActivationPlanStep>,
    operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeActivationPlanConflict {
    dependency_id: String,
    mod_id: Option<String>,
    target_mod_id: Option<String>,
    relation: String,
    reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeActivationPlanStep {
    index: usize,
    mod_id: String,
    version_id: String,
    artifact_id: String,
    required: bool,
    selection_kind: String,
    file_kind: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SelectedProjectTarget {
    project_directory: String,
    game_version: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ValidatedActivationPlan {
    plan_id: String,
    required_steps: Vec<NativeActivationPlanStep>,
    optional_download_count: usize,
    required_disk_size_bytes: u64,
    conflict_count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ResolvedActivationTargetPlan {
    selected_project: SelectedProjectTarget,
    plan: ValidatedActivationPlan,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NativeLookupFailure {
    ArtifactNotFound,
    AuthenticationRequired,
    TemporarilyUnavailable,
    InvalidResponse,
    Unknown,
}

fn disabled_preview(
    request: ModdingFlowActivationPreviewRequest,
) -> Result<ModdingFlowActivationPreview, String> {
    validate_preview_request(&request)?;
    Ok(state_preview(
        request.artifact_id,
        request.operation_id,
        ModdingFlowActivationPreviewState::Unavailable,
        false,
    ))
}

async fn preview_activation_with_bridge(
    bridge: &dyn ModdingFlowActivationBridge,
    request: ModdingFlowActivationPreviewRequest,
) -> Result<ModdingFlowActivationPreview, String> {
    validate_preview_request(&request)?;
    match resolve_native_preview(bridge, &request.artifact_id, &request.operation_id).await {
        Ok(native) => native_to_renderer_preview(native),
        Err(failure) => Ok(state_preview(
            request.artifact_id,
            request.operation_id,
            lookup_failure_state(failure),
            failure == NativeLookupFailure::AuthenticationRequired,
        )),
    }
}

async fn resolve_activation_target_plan(
    bridge: &dyn ModdingFlowActivationBridge,
    artifact_id: &str,
    instance_id: &str,
    profile_name: &str,
    operation_id: &str,
) -> Result<ResolvedActivationTargetPlan, String> {
    let native = resolve_native_preview(bridge, artifact_id, operation_id)
        .await
        .map_err(accept_lookup_failure_message)?;
    let projects = bridge
        .call(
            "projects.listConfigs",
            json!({ "buildConfigsDirectory": bridge.build_configs_directory() }),
            operation_id,
            LOCAL_REVALIDATION_TIMEOUT_MS,
        )
        .await
        .map_err(|_| "Fluxora could not revalidate the selected instance.".to_string())?;
    let selected_project = selected_project_target(&projects, instance_id, &native.game_slug)?;

    let profiles = bridge
        .call(
            "profiles.list",
            json!({
                "projectDirectory": selected_project.project_directory,
                "defaultProfileName": ""
            }),
            operation_id,
            LOCAL_REVALIDATION_TIMEOUT_MS,
        )
        .await
        .map_err(|_| "Fluxora could not revalidate the selected profile.".to_string())?;
    validate_selected_profile(&profiles, profile_name)?;

    let plan = bridge
        .call(
            "moddingflow.previewActivationPlan",
            json!({
                "artifactId": native.artifact_id,
                "gameSlug": native.game_slug,
                "gameVersion": selected_project.game_version,
                "includeOptional": false,
                "idempotencyKey": stable_activation_plan_idempotency_key(
                    artifact_id,
                    instance_id,
                    profile_name,
                    &native.game_slug,
                    &selected_project.game_version,
                )
            }),
            operation_id,
            PLAN_TIMEOUT_MS,
        )
        .await
        .map_err(|_| "Fluxora could not resolve the ModdingFlow install plan.".to_string())?;
    let plan =
        parse_native_activation_plan(plan, &native, &selected_project.game_version, operation_id)?;
    Ok(ResolvedActivationTargetPlan {
        selected_project,
        plan,
    })
}

async fn preview_activation_plan_with_bridge(
    bridge: &dyn ModdingFlowActivationBridge,
    request: ModdingFlowActivationPlanPreviewRequest,
) -> Result<ModdingFlowActivationPlanPreview, String> {
    validate_plan_preview_request(&request)?;
    let resolved = resolve_activation_target_plan(
        bridge,
        &request.artifact_id,
        &request.instance_id,
        &request.profile_name,
        &request.operation_id,
    )
    .await?;
    Ok(ModdingFlowActivationPlanPreview {
        artifact_id: request.artifact_id,
        plan_id: resolved.plan.plan_id,
        required_download_count: resolved.plan.required_steps.len(),
        optional_download_count: resolved.plan.optional_download_count,
        required_disk_size_bytes: resolved.plan.required_disk_size_bytes,
        conflict_count: resolved.plan.conflict_count,
        operation_id: request.operation_id,
    })
}

async fn accept_activation_with_bridge(
    bridge: &dyn ModdingFlowActivationBridge,
    request: ModdingFlowActivationAcceptRequest,
) -> Result<ModdingFlowActivationDecisionResult, String> {
    validate_accept_request(&request)?;
    let resolved = resolve_activation_target_plan(
        bridge,
        &request.artifact_id,
        &request.instance_id,
        &request.profile_name,
        &request.operation_id,
    )
    .await?;
    if resolved.plan.plan_id != request.confirmed_plan_id {
        return Err(
            "The ModdingFlow install plan changed. Preview and confirm the new plan.".to_string(),
        );
    }
    if resolved.plan.conflict_count > 0 {
        return Err(
            "The ModdingFlow install plan contains a conflict and cannot be queued.".to_string(),
        );
    }

    for step in resolved.plan.required_steps {
        let job_id = stable_download_job_id(
            &step.artifact_id,
            &request.instance_id,
            &request.profile_name,
        );
        let queued = bridge
            .call(
                "downloads.queueModdingFlowArtifact",
                json!({
                    "projectDirectory": resolved.selected_project.project_directory,
                    "artifactId": step.artifact_id,
                    "modId": step.mod_id,
                    "versionId": step.version_id,
                    "jobId": job_id
                }),
                &request.operation_id,
                QUEUE_TIMEOUT_MS,
            )
            .await
            .map_err(|_| {
                "Fluxora could not queue every required ModdingFlow download. Retry is safe and preserves already queued steps."
                    .to_string()
            })?;
        validate_queued_download(&queued)?;
    }

    Ok(ModdingFlowActivationDecisionResult {
        artifact_id: request.artifact_id,
        state: ModdingFlowActivationDecisionState::Accepted,
        operation_id: request.operation_id,
    })
}

fn parse_native_activation_plan(
    value: Value,
    root: &NativeArtifactPreview,
    game_version: &str,
    operation_id: &str,
) -> Result<ValidatedActivationPlan, String> {
    let plan: NativeActivationPlan = serde_json::from_value(value)
        .map_err(|_| "Native ModdingFlow install plan is invalid.".to_string())?;
    if !is_canonical_lowercase_uuid(&plan.plan_id)
        || plan.operation_id != operation_id
        || plan.game_slug != root.game_slug
        || plan.game_version != game_version
        || plan.required_disk_size_bytes == 0
        || plan.required_disk_size_bytes > MAX_SAFE_JSON_INTEGER
        || plan.steps.is_empty()
        || plan.steps.len() > MAX_PLAN_STEPS
        || plan.conflicts.len() > MAX_PLAN_CONFLICTS
    {
        return Err("Native ModdingFlow install plan identity is invalid.".to_string());
    }

    for conflict in &plan.conflicts {
        if !is_canonical_lowercase_uuid(&conflict.dependency_id)
            || conflict
                .mod_id
                .as_deref()
                .is_some_and(|value| !is_canonical_lowercase_uuid(value))
            || conflict
                .target_mod_id
                .as_deref()
                .is_some_and(|value| !is_canonical_lowercase_uuid(value))
            || validate_text(&conflict.relation, MAX_DISPLAY_TEXT_BYTES, "plan conflict").is_err()
            || conflict.reason.as_deref().is_some_and(|value| {
                validate_text(value, MAX_DISPLAY_TEXT_BYTES, "plan conflict reason").is_err()
            })
        {
            return Err("Native ModdingFlow install plan conflict is invalid.".to_string());
        }
    }
    let mut artifacts = HashSet::new();
    let mut root_steps = 0usize;
    let mut previous_index: Option<usize> = None;
    let mut required_size_total = 0u64;
    for step in &plan.steps {
        if previous_index.is_some_and(|previous| step.index <= previous)
            || !artifacts.insert(step.artifact_id.as_str())
            || !is_canonical_lowercase_uuid(&step.artifact_id)
            || !is_canonical_lowercase_uuid(&step.mod_id)
            || !is_canonical_lowercase_uuid(&step.version_id)
            || !is_lowercase_sha256(&step.sha256)
            || step.size_bytes == 0
            || !matches!(step.file_kind.as_str(), "main" | "optional" | "old")
            || !matches!(
                (step.required, step.selection_kind.as_str()),
                (true, "selected_artifact" | "required_dependency")
                    | (false, "optional_dependency")
            )
        {
            return Err("Native ModdingFlow install plan step is invalid.".to_string());
        }
        previous_index = Some(step.index);
        if step.required {
            required_size_total = required_size_total
                .checked_add(step.size_bytes)
                .filter(|total| *total <= MAX_SAFE_JSON_INTEGER)
                .ok_or_else(|| "Native ModdingFlow install plan size is invalid.".to_string())?;
        }
        if step.artifact_id == root.artifact_id
            || step.mod_id == root.mod_id
            || step.version_id == root.version_id
        {
            if step.artifact_id != root.artifact_id
                || step.mod_id != root.mod_id
                || step.version_id != root.version_id
                || !step.required
                || step.selection_kind != "selected_artifact"
                || step.size_bytes != root.size_bytes
                || step.sha256 != root.sha256
            {
                return Err("Native ModdingFlow install plan root is invalid.".to_string());
            }
            root_steps += 1;
        }
    }
    if root_steps != 1 {
        return Err("Native ModdingFlow install plan root is missing.".to_string());
    }
    if plan.required_disk_size_bytes < required_size_total {
        return Err("Native ModdingFlow install plan size is invalid.".to_string());
    }

    let optional_download_count = plan.steps.iter().filter(|step| !step.required).count();
    let required_steps = plan
        .steps
        .into_iter()
        .filter(|step| step.required)
        .collect();
    Ok(ValidatedActivationPlan {
        plan_id: plan.plan_id,
        required_steps,
        optional_download_count,
        required_disk_size_bytes: plan.required_disk_size_bytes,
        conflict_count: plan.conflicts.len(),
    })
}

fn stable_activation_plan_idempotency_key(
    artifact_id: &str,
    instance_id: &str,
    profile_name: &str,
    game_slug: &str,
    game_version: &str,
) -> String {
    format!(
        "activation-plan-{}",
        stable_uuid(
            b"fluxora:moddingflow-activation-plan:v1\n",
            &[
                artifact_id,
                instance_id,
                profile_name,
                game_slug,
                game_version
            ],
        )
    )
}

fn dismiss_activation(
    request: ModdingFlowActivationDismissRequest,
    enabled: bool,
) -> Result<ModdingFlowActivationDecisionResult, String> {
    validate_artifact_id(&request.artifact_id)?;
    validate_text(
        &request.operation_id,
        MAX_OPERATION_ID_BYTES,
        "operation id",
    )?;
    if !enabled {
        return Err(UNAVAILABLE_MESSAGE.to_string());
    }
    Ok(ModdingFlowActivationDecisionResult {
        artifact_id: request.artifact_id,
        state: ModdingFlowActivationDecisionState::Dismissed,
        operation_id: request.operation_id,
    })
}

async fn resolve_native_preview(
    bridge: &dyn ModdingFlowActivationBridge,
    artifact_id: &str,
    operation_id: &str,
) -> Result<NativeArtifactPreview, NativeLookupFailure> {
    let anonymous = match lookup_native_preview(bridge, artifact_id, "anonymous", operation_id)
        .await
    {
        Ok(preview) => preview,
        Err(NativeLookupFailure::AuthenticationRequired) => {
            let authenticated =
                lookup_native_preview(bridge, artifact_id, "bearerModsRead", operation_id).await?;
            if authenticated.access_tier == "public" {
                return Err(NativeLookupFailure::InvalidResponse);
            }
            return Ok(authenticated);
        }
        Err(failure) => return Err(failure),
    };
    if anonymous.access_tier == "public" {
        return Ok(anonymous);
    }

    let authenticated =
        lookup_native_preview(bridge, artifact_id, "bearerModsRead", operation_id).await?;
    if authenticated != anonymous {
        return Err(NativeLookupFailure::InvalidResponse);
    }
    Ok(authenticated)
}

async fn lookup_native_preview(
    bridge: &dyn ModdingFlowActivationBridge,
    artifact_id: &str,
    auth_mode: &str,
    operation_id: &str,
) -> Result<NativeArtifactPreview, NativeLookupFailure> {
    let value = bridge
        .call(
            "moddingflow.lookupArtifactPreview",
            json!({ "artifactId": artifact_id, "authMode": auth_mode }),
            operation_id,
            LOOKUP_TIMEOUT_MS,
        )
        .await
        .map_err(|error| native_lookup_failure(&error, operation_id))?;
    parse_native_artifact_preview(value, artifact_id, operation_id)
        .map_err(|_| NativeLookupFailure::InvalidResponse)
}

fn parse_native_artifact_preview(
    value: Value,
    artifact_id: &str,
    operation_id: &str,
) -> Result<NativeArtifactPreview, String> {
    let preview: NativeArtifactPreview = serde_json::from_value(value)
        .map_err(|_| "Native ModdingFlow artifact preview is invalid.".to_string())?;
    if preview.artifact_id != artifact_id
        || preview.operation_id != operation_id
        || !is_canonical_lowercase_uuid(&preview.artifact_id)
        || !is_canonical_lowercase_uuid(&preview.mod_id)
        || !is_canonical_lowercase_uuid(&preview.version_id)
        || !is_canonical_lowercase_uuid(&preview.game_id)
        || !is_canonical_key(&preview.game_slug)
        || !matches!(
            preview.access_tier.as_str(),
            "public" | "authenticated" | "paid" | "restricted"
        )
        || preview.size_bytes == 0
        || !is_lowercase_sha256(&preview.sha256)
    {
        return Err("Native ModdingFlow artifact preview identity is invalid.".to_string());
    }
    validate_text(&preview.version, MAX_DISPLAY_TEXT_BYTES, "version")?;
    validate_text(&preview.filename, MAX_DISPLAY_TEXT_BYTES, "filename")?;
    validate_localized_titles(&preview.title)?;
    Ok(preview)
}

fn native_to_renderer_preview(
    native: NativeArtifactPreview,
) -> Result<ModdingFlowActivationPreview, String> {
    let mod_name = preferred_localized_title(&native.title)
        .ok_or_else(|| "Native ModdingFlow artifact title is invalid.".to_string())?;
    Ok(ModdingFlowActivationPreview {
        artifact_id: native.artifact_id,
        state: ModdingFlowActivationPreviewState::Available,
        eligible: Some(true),
        requires_account: native.access_tier != "public",
        metadata: Some(ModdingFlowActivationPreviewMetadata {
            mod_info: ModdingFlowActivationModMetadata {
                id: native.mod_id,
                name: mod_name.to_string(),
            },
            version: ModdingFlowActivationVersionMetadata {
                id: native.version_id,
                label: native.version,
            },
            game: ModdingFlowActivationGameMetadata {
                id: native.game_slug.clone(),
                name: display_name_from_slug(&native.game_slug),
            },
            file: ModdingFlowActivationFileMetadata {
                name: native.filename,
                size_bytes: Some(native.size_bytes),
            },
        }),
        operation_id: native.operation_id,
    })
}

fn state_preview(
    artifact_id: String,
    operation_id: String,
    state: ModdingFlowActivationPreviewState,
    requires_account: bool,
) -> ModdingFlowActivationPreview {
    ModdingFlowActivationPreview {
        artifact_id,
        state,
        eligible: None,
        requires_account,
        metadata: None,
        operation_id,
    }
}

fn lookup_failure_state(failure: NativeLookupFailure) -> ModdingFlowActivationPreviewState {
    match failure {
        NativeLookupFailure::ArtifactNotFound => ModdingFlowActivationPreviewState::Unknown,
        NativeLookupFailure::AuthenticationRequired => {
            ModdingFlowActivationPreviewState::Disconnected
        }
        NativeLookupFailure::TemporarilyUnavailable
        | NativeLookupFailure::InvalidResponse
        | NativeLookupFailure::Unknown => ModdingFlowActivationPreviewState::Unavailable,
    }
}

fn accept_lookup_failure_message(failure: NativeLookupFailure) -> String {
    match failure {
        NativeLookupFailure::ArtifactNotFound => {
            "The ModdingFlow artifact is no longer available.".to_string()
        }
        NativeLookupFailure::AuthenticationRequired => {
            "Connect ModdingFlow before downloading this artifact.".to_string()
        }
        _ => "ModdingFlow could not revalidate this artifact.".to_string(),
    }
}

fn native_lookup_failure(error: &str, operation_id: &str) -> NativeLookupFailure {
    let Ok(value) = serde_json::from_str::<Value>(error) else {
        return NativeLookupFailure::Unknown;
    };
    if value.get("schema").and_then(Value::as_str) != Some("fluxora.tauri.bridge-error.v1")
        || value.get("method").and_then(Value::as_str) != Some("moddingflow.lookupArtifactPreview")
        || value.get("operationId").and_then(Value::as_str) != Some(operation_id)
    {
        return NativeLookupFailure::Unknown;
    }
    match value
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
    {
        Some("moddingflow.artifactNotFound") => NativeLookupFailure::ArtifactNotFound,
        Some("moddingflow.authenticationRequired") => NativeLookupFailure::AuthenticationRequired,
        Some("moddingflow.temporarilyUnavailable") => NativeLookupFailure::TemporarilyUnavailable,
        Some("moddingflow.invalidResponse") => NativeLookupFailure::InvalidResponse,
        _ => NativeLookupFailure::Unknown,
    }
}

fn selected_project_target(
    value: &Value,
    instance_id: &str,
    game_slug: &str,
) -> Result<SelectedProjectTarget, String> {
    let projects = value
        .as_array()
        .filter(|projects| projects.len() <= MAX_PROJECTS)
        .ok_or_else(|| "Native project catalog is invalid.".to_string())?;
    let mut selected: Option<&serde_json::Map<String, Value>> = None;
    for project in projects {
        let project = project
            .as_object()
            .ok_or_else(|| "Native project catalog is invalid.".to_string())?;
        let id = required_bounded_string(project, "id", MAX_INSTANCE_ID_BYTES)?;
        if id != instance_id {
            continue;
        }
        if selected.is_some() {
            return Err("Native project catalog contains duplicate instances.".to_string());
        }
        selected = Some(project);
    }
    let selected = selected.ok_or_else(|| "The selected instance no longer exists.".to_string())?;
    let project_directory =
        required_bounded_string(selected, "projectDirectory", MAX_NATIVE_PATH_BYTES)?;
    if !Path::new(project_directory).is_absolute() {
        return Err("Native project directory is invalid.".to_string());
    }
    let fingerprint = selected
        .get("projectFingerprint")
        .and_then(Value::as_object)
        .ok_or_else(|| "The selected instance has no trusted game version.".to_string())?;
    let game_version = required_bounded_string(fingerprint, "gameVersion", MAX_GAME_VERSION_BYTES)?;
    let mapping = selected
        .get("externalProviderGameSlugs")
        .and_then(Value::as_object)
        .filter(|mapping| !mapping.is_empty() && mapping.len() <= MAX_PROVIDER_MAPPINGS)
        .ok_or_else(|| "Native project provider mapping is invalid.".to_string())?;
    validate_provider_mapping(mapping)?;
    let compatible = mapping
        .get("moddingflow")
        .and_then(Value::as_array)
        .is_some_and(|slugs| slugs.iter().any(|slug| slug.as_str() == Some(game_slug)));
    if !compatible {
        return Err("The selected instance is not compatible with this game.".to_string());
    }
    Ok(SelectedProjectTarget {
        project_directory: project_directory.to_string(),
        game_version: game_version.to_string(),
    })
}

fn validate_provider_mapping(mapping: &serde_json::Map<String, Value>) -> Result<(), String> {
    for (provider_id, slugs) in mapping {
        if !is_canonical_key(provider_id) {
            return Err("Native project provider mapping is invalid.".to_string());
        }
        let slugs = slugs
            .as_array()
            .filter(|slugs| !slugs.is_empty() && slugs.len() <= MAX_PROVIDER_SLUGS)
            .ok_or_else(|| "Native project provider mapping is invalid.".to_string())?;
        let mut unique = HashSet::new();
        for slug in slugs {
            let slug = slug
                .as_str()
                .filter(|slug| is_canonical_key(slug))
                .ok_or_else(|| "Native project provider mapping is invalid.".to_string())?;
            if !unique.insert(slug) {
                return Err("Native project provider mapping contains duplicates.".to_string());
            }
        }
    }
    Ok(())
}

fn validate_selected_profile(value: &Value, selected_profile: &str) -> Result<(), String> {
    let profiles = value
        .as_array()
        .filter(|profiles| profiles.len() <= MAX_PROFILES)
        .ok_or_else(|| "Native profile catalog is invalid.".to_string())?;
    let mut unique = HashSet::new();
    let mut matched = false;
    for profile in profiles {
        let profile = profile
            .as_str()
            .ok_or_else(|| "Native profile catalog is invalid.".to_string())?;
        validate_text(profile, MAX_PROFILE_NAME_BYTES, "profile name")?;
        if !unique.insert(profile) {
            return Err("Native profile catalog contains duplicates.".to_string());
        }
        matched |= profile == selected_profile;
    }
    if !matched {
        return Err("The selected profile no longer exists.".to_string());
    }
    Ok(())
}

fn validate_queued_download(value: &Value) -> Result<(), String> {
    let queued = value
        .as_object()
        .ok_or_else(|| "Native ModdingFlow queue response is invalid.".to_string())?;
    let id = required_bounded_string(queued, "id", MAX_NATIVE_PATH_BYTES)?;
    let local_path = required_bounded_string(queued, "localPath", MAX_NATIVE_PATH_BYTES)?;
    let transfer_state = queued.get("transferState").and_then(Value::as_str);
    let is_downloading = queued.get("isDownloading").and_then(Value::as_bool);
    let lifecycle_is_valid = matches!(
        (transfer_state, is_downloading),
        (Some("queued" | "downloading"), Some(true)) | (Some("completed"), Some(false))
    ) || (transfer_state == Some("idle")
        && is_downloading == Some(false)
        && queued.get("canInstall").and_then(Value::as_bool) == Some(true));
    if id != local_path
        || !Path::new(local_path).is_absolute()
        || queued.get("source").and_then(Value::as_str) != Some("ModdingFlow")
        || !lifecycle_is_valid
    {
        return Err("Native ModdingFlow queue response is invalid.".to_string());
    }
    Ok(())
}

fn stable_download_job_id(artifact_id: &str, instance_id: &str, profile_name: &str) -> String {
    stable_uuid(
        b"fluxora:moddingflow-download:v1\n",
        &[artifact_id, instance_id, profile_name],
    )
}

fn stable_uuid(namespace: &[u8], fields: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(namespace);
    for field in fields {
        hasher.update(field.as_bytes());
        hasher.update(b"\n");
    }
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

fn preferred_localized_title(title: &BTreeMap<String, String>) -> Option<&str> {
    title
        .get("en")
        .or_else(|| title.get("en-US"))
        .or_else(|| title.values().next())
        .map(String::as_str)
}

fn display_name_from_slug(slug: &str) -> String {
    slug.split(['-', '_', '.'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            if part.len() <= 3 {
                part.to_ascii_uppercase()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn validate_preview_request(request: &ModdingFlowActivationPreviewRequest) -> Result<(), String> {
    validate_artifact_id(&request.artifact_id)?;
    validate_text(
        &request.operation_id,
        MAX_OPERATION_ID_BYTES,
        "operation id",
    )
}

fn validate_plan_preview_request(
    request: &ModdingFlowActivationPlanPreviewRequest,
) -> Result<(), String> {
    validate_artifact_id(&request.artifact_id)?;
    validate_text(&request.instance_id, MAX_INSTANCE_ID_BYTES, "instance id")?;
    validate_text(
        &request.profile_name,
        MAX_PROFILE_NAME_BYTES,
        "profile name",
    )?;
    validate_text(
        &request.operation_id,
        MAX_OPERATION_ID_BYTES,
        "operation id",
    )
}

fn validate_accept_request(request: &ModdingFlowActivationAcceptRequest) -> Result<(), String> {
    validate_plan_preview_request(&ModdingFlowActivationPlanPreviewRequest {
        artifact_id: request.artifact_id.clone(),
        instance_id: request.instance_id.clone(),
        profile_name: request.profile_name.clone(),
        operation_id: request.operation_id.clone(),
    })?;
    if !is_canonical_lowercase_uuid(&request.confirmed_plan_id) {
        return Err("ModdingFlow confirmed plan id is invalid.".to_string());
    }
    Ok(())
}

fn validate_localized_titles(title: &BTreeMap<String, String>) -> Result<(), String> {
    if title.is_empty() || title.len() > MAX_LOCALIZED_TITLES {
        return Err("Native ModdingFlow localized title is invalid.".to_string());
    }
    for (locale, value) in title {
        if !is_locale(locale) {
            return Err("Native ModdingFlow localized title is invalid.".to_string());
        }
        validate_text(value, MAX_DISPLAY_TEXT_BYTES, "title")?;
    }
    Ok(())
}

fn required_bounded_string<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
    max_bytes: usize,
) -> Result<&'a str, String> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Native response field {key} is invalid."))?;
    validate_text(value, max_bytes, key)?;
    Ok(value)
}

fn validate_artifact_id(value: &str) -> Result<(), String> {
    if is_canonical_lowercase_uuid(value) {
        Ok(())
    } else {
        Err("ModdingFlow artifact id is invalid.".to_string())
    }
}

fn validate_text(value: &str, max_bytes: usize, field: &str) -> Result<(), String> {
    if value.is_empty() || value.trim() != value {
        return Err(format!("ModdingFlow {field} is required."));
    }
    if value.len() > max_bytes || value.bytes().any(|byte| byte.is_ascii_control()) {
        return Err(format!("ModdingFlow {field} is invalid."));
    }
    Ok(())
}

fn is_canonical_key(value: &str) -> bool {
    if value.is_empty() || value.len() > 120 {
        return false;
    }
    let mut previous_was_separator = true;
    for byte in value.bytes() {
        if byte.is_ascii_lowercase() || byte.is_ascii_digit() {
            previous_was_separator = false;
        } else if matches!(byte, b'.' | b'_' | b'-') && !previous_was_separator {
            previous_was_separator = true;
        } else {
            return false;
        }
    }
    !previous_was_separator
}

fn is_locale(value: &str) -> bool {
    let bytes = value.as_bytes();
    (bytes.len() == 2 && bytes.iter().all(u8::is_ascii_lowercase))
        || (bytes.len() == 5
            && bytes[0..2].iter().all(u8::is_ascii_lowercase)
            && bytes[2] == b'-'
            && bytes[3..5].iter().all(u8::is_ascii_uppercase))
}

fn is_lowercase_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_canonical_lowercase_uuid(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    let bytes = value.as_bytes();
    bytes.iter().copied().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            byte == b'-'
        } else {
            byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
        }
    }) && (b'1'..=b'8').contains(&bytes[14])
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
}

#[tauri::command]
pub(crate) async fn fluxora_moddingflow_preview_activation(
    app: AppHandle,
    request: ModdingFlowActivationPreviewRequest,
) -> Result<ModdingFlowActivationPreview, String> {
    if !MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED {
        return disabled_preview(request);
    }
    preview_activation_with_bridge(&TauriModdingFlowActivationBridge { app }, request).await
}

#[tauri::command]
pub(crate) async fn fluxora_moddingflow_preview_activation_plan(
    app: AppHandle,
    request: ModdingFlowActivationPlanPreviewRequest,
) -> Result<ModdingFlowActivationPlanPreview, String> {
    if !MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED {
        validate_plan_preview_request(&request)?;
        return Err(UNAVAILABLE_MESSAGE.to_string());
    }
    preview_activation_plan_with_bridge(&TauriModdingFlowActivationBridge { app }, request).await
}

#[tauri::command]
pub(crate) async fn fluxora_moddingflow_accept_activation(
    app: AppHandle,
    request: ModdingFlowActivationAcceptRequest,
) -> Result<ModdingFlowActivationDecisionResult, String> {
    if !MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED {
        validate_accept_request(&request)?;
        return Err(UNAVAILABLE_MESSAGE.to_string());
    }
    accept_activation_with_bridge(&TauriModdingFlowActivationBridge { app }, request).await
}

#[tauri::command]
pub(crate) fn fluxora_moddingflow_dismiss_activation(
    request: ModdingFlowActivationDismissRequest,
) -> Result<ModdingFlowActivationDecisionResult, String> {
    dismiss_activation(request, MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    const ARTIFACT_ID: &str = "01234567-89ab-4cde-8fab-0123456789ab";
    const MOD_ID: &str = "11111111-2222-4333-8444-555555555555";
    const VERSION_ID: &str = "22222222-3333-4444-8555-666666666666";
    const GAME_ID: &str = "33333333-4444-4555-8666-777777777777";
    const DEPENDENCY_ARTIFACT_ID: &str = "44444444-5555-4666-8777-888888888888";
    const DEPENDENCY_MOD_ID: &str = "55555555-6666-4777-8888-999999999999";
    const DEPENDENCY_VERSION_ID: &str = "66666666-7777-4888-8999-aaaaaaaaaaaa";
    const OPTIONAL_ARTIFACT_ID: &str = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
    const OPTIONAL_MOD_ID: &str = "88888888-9999-4aaa-8bbb-cccccccccccc";
    const OPTIONAL_VERSION_ID: &str = "99999999-aaaa-4bbb-8ccc-dddddddddddd";

    #[derive(Clone, Debug, Eq, PartialEq)]
    struct RecordedCall {
        method: String,
        params: Value,
        operation_id: String,
        timeout_ms: u64,
    }

    struct FakeBridge {
        responses: Mutex<VecDeque<Result<Value, String>>>,
        calls: Mutex<Vec<RecordedCall>>,
        build_configs_directory: String,
    }

    impl FakeBridge {
        fn new(responses: impl IntoIterator<Item = Result<Value, String>>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().collect()),
                calls: Mutex::new(Vec::new()),
                build_configs_directory: "C:\\FluxoraData\\Builds".to_string(),
            }
        }

        fn calls(&self) -> Vec<RecordedCall> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl ModdingFlowActivationBridge for FakeBridge {
        fn call<'a>(
            &'a self,
            method: &'a str,
            params: Value,
            operation_id: &'a str,
            timeout_ms: u64,
        ) -> ActivationBridgeFuture<'a> {
            self.calls.lock().unwrap().push(RecordedCall {
                method: method.to_string(),
                params,
                operation_id: operation_id.to_string(),
                timeout_ms,
            });
            let response = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("fake bridge response");
            Box::pin(async move { response })
        }

        fn build_configs_directory(&self) -> String {
            self.build_configs_directory.clone()
        }
    }

    fn native_preview(operation_id: &str, access_tier: &str) -> Value {
        json!({
            "artifactId": ARTIFACT_ID,
            "modId": MOD_ID,
            "versionId": VERSION_ID,
            "gameId": GAME_ID,
            "gameSlug": "skyrim-se",
            "title": { "ru": "SkyUI RU", "en": "SkyUI" },
            "version": "5.2 SE",
            "filename": "SkyUI_5_2_SE.7z",
            "sizeBytes": 2_734_080,
            "sha256": "a".repeat(64),
            "accessTier": access_tier,
            "operationId": operation_id
        })
    }

    fn native_activation_plan(operation_id: &str, include_conflict: bool) -> Value {
        json!({
            "planId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "gameSlug": "skyrim-se",
            "gameVersion": "1.6.1170",
            "requiredDiskSizeBytes": 2_735_104,
            "conflicts": if include_conflict {
                json!([{
                    "dependencyId": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
                    "modId": MOD_ID,
                    "targetModId": DEPENDENCY_MOD_ID,
                    "relation": "incompatible",
                    "reason": "A conflicting dependency is installed."
                }])
            } else {
                json!([])
            },
            "steps": [
                {
                    "index": 0,
                    "modId": DEPENDENCY_MOD_ID,
                    "versionId": DEPENDENCY_VERSION_ID,
                    "artifactId": DEPENDENCY_ARTIFACT_ID,
                    "required": true,
                    "selectionKind": "required_dependency",
                    "fileKind": "main",
                    "sizeBytes": 1024,
                    "sha256": "b".repeat(64)
                },
                {
                    "index": 1,
                    "modId": MOD_ID,
                    "versionId": VERSION_ID,
                    "artifactId": ARTIFACT_ID,
                    "required": true,
                    "selectionKind": "selected_artifact",
                    "fileKind": "main",
                    "sizeBytes": 2_734_080,
                    "sha256": "a".repeat(64)
                },
                {
                    "index": 2,
                    "modId": OPTIONAL_MOD_ID,
                    "versionId": OPTIONAL_VERSION_ID,
                    "artifactId": OPTIONAL_ARTIFACT_ID,
                    "required": false,
                    "selectionKind": "optional_dependency",
                    "fileKind": "optional",
                    "sizeBytes": 2048,
                    "sha256": "c".repeat(64)
                }
            ],
            "operationId": operation_id
        })
    }

    fn queued_download(artifact_id: &str) -> Value {
        let pending_path = format!(
            "C:\\FluxoraData\\Projects\\Skyrim\\downloads\\.fluxora-remote-downloads\\{artifact_id}.json"
        );
        json!({
            "id": pending_path,
            "localPath": pending_path,
            "source": "ModdingFlow",
            "transferState": "queued",
            "isDownloading": true
        })
    }

    fn typed_lookup_error(operation_id: &str, code: &str) -> String {
        json!({
            "schema": "fluxora.tauri.bridge-error.v1",
            "method": "moddingflow.lookupArtifactPreview",
            "operationId": operation_id,
            "error": {
                "code": code,
                "message": "Safe fixed message.",
                "category": "availability",
                "retryable": false
            }
        })
        .to_string()
    }

    fn preview_request(operation_id: &str) -> ModdingFlowActivationPreviewRequest {
        ModdingFlowActivationPreviewRequest {
            artifact_id: ARTIFACT_ID.to_string(),
            operation_id: operation_id.to_string(),
        }
    }

    fn accept_request(operation_id: &str) -> ModdingFlowActivationAcceptRequest {
        ModdingFlowActivationAcceptRequest {
            artifact_id: ARTIFACT_ID.to_string(),
            instance_id: "C:\\FluxoraData\\Builds\\Skyrim.json".to_string(),
            profile_name: "Testing".to_string(),
            confirmed_plan_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_string(),
            operation_id: operation_id.to_string(),
        }
    }

    #[test]
    fn explicitly_disabled_preview_is_hard_unavailable() {
        let preview = disabled_preview(preview_request("op_native_preview"))
            .expect("safe unavailable preview");
        assert_eq!(
            preview.state,
            ModdingFlowActivationPreviewState::Unavailable
        );
        assert_eq!(preview.metadata, None);
        assert_eq!(preview.eligible, None);
        assert!(!preview.requires_account);
    }

    #[test]
    fn preview_returns_only_allowlisted_metadata_and_does_not_queue() {
        tauri::async_runtime::block_on(async {
            let bridge = FakeBridge::new([Ok(native_preview("op_preview", "public"))]);
            let preview = preview_activation_with_bridge(&bridge, preview_request("op_preview"))
                .await
                .expect("available preview");

            assert_eq!(preview.state, ModdingFlowActivationPreviewState::Available);
            assert_eq!(preview.eligible, Some(true));
            assert!(!preview.requires_account);
            assert_eq!(preview.metadata.as_ref().unwrap().game.id, "skyrim-se");
            assert_eq!(preview.metadata.as_ref().unwrap().game.name, "Skyrim SE");
            assert_eq!(preview.metadata.as_ref().unwrap().mod_info.name, "SkyUI");
            assert_eq!(bridge.calls().len(), 1);
            assert_eq!(
                bridge.calls()[0].method,
                "moddingflow.lookupArtifactPreview"
            );
            let serialized = serde_json::to_string(&preview)
                .unwrap()
                .to_ascii_lowercase();
            for forbidden in [
                "sha256",
                "url",
                "header",
                "token",
                "authorization",
                "userid",
            ] {
                assert!(!serialized.contains(forbidden));
            }
        });
    }

    #[test]
    fn account_tier_requires_a_bearer_recheck_and_maps_missing_auth_safely() {
        tauri::async_runtime::block_on(async {
            let operation_id = "op_private_preview";
            let bridge = FakeBridge::new([
                Ok(native_preview(operation_id, "authenticated")),
                Err(typed_lookup_error(
                    operation_id,
                    "moddingflow.authenticationRequired",
                )),
            ]);
            let preview = preview_activation_with_bridge(&bridge, preview_request(operation_id))
                .await
                .expect("safe disconnected preview");

            assert_eq!(
                preview.state,
                ModdingFlowActivationPreviewState::Disconnected
            );
            assert!(preview.requires_account);
            assert_eq!(preview.metadata, None);
            assert_eq!(bridge.calls().len(), 2);
            assert_eq!(bridge.calls()[0].params["authMode"], "anonymous");
            assert_eq!(bridge.calls()[1].params["authMode"], "bearerModsRead");
        });
    }

    #[test]
    fn anonymous_authentication_required_retries_once_with_bearer() {
        tauri::async_runtime::block_on(async {
            let operation_id = "op_protected_preview";
            let bridge = FakeBridge::new([
                Err(typed_lookup_error(
                    operation_id,
                    "moddingflow.authenticationRequired",
                )),
                Ok(native_preview(operation_id, "authenticated")),
            ]);

            let preview = preview_activation_with_bridge(&bridge, preview_request(operation_id))
                .await
                .expect("authenticated preview");

            assert_eq!(preview.state, ModdingFlowActivationPreviewState::Available);
            assert!(preview.requires_account);
            assert!(preview.metadata.is_some());
            assert_eq!(bridge.calls().len(), 2);
            assert_eq!(bridge.calls()[0].params["authMode"], "anonymous");
            assert_eq!(bridge.calls()[1].params["authMode"], "bearerModsRead");
        });
    }

    #[test]
    fn anonymous_non_authentication_failure_never_attempts_bearer() {
        tauri::async_runtime::block_on(async {
            let operation_id = "op_unavailable_preview";
            let bridge = FakeBridge::new([Err(typed_lookup_error(
                operation_id,
                "moddingflow.temporarilyUnavailable",
            ))]);

            let preview = preview_activation_with_bridge(&bridge, preview_request(operation_id))
                .await
                .expect("safe unavailable preview");

            assert_eq!(
                preview.state,
                ModdingFlowActivationPreviewState::Unavailable
            );
            assert!(!preview.requires_account);
            assert_eq!(bridge.calls().len(), 1);
            assert_eq!(bridge.calls()[0].params["authMode"], "anonymous");
        });
    }

    #[test]
    fn explicit_accept_resolves_the_native_plan_and_queues_required_steps_in_order() {
        tauri::async_runtime::block_on(async {
            let operation_id = "op_native_accept";
            let request = accept_request(operation_id);
            let bridge = FakeBridge::new([
                Ok(native_preview(operation_id, "public")),
                Ok(json!([{
                    "id": request.instance_id,
                    "projectDirectory": "C:\\FluxoraData\\Projects\\Skyrim",
                    "projectFingerprint": { "gameVersion": "1.6.1170" },
                    "externalProviderGameSlugs": {
                        "moddingflow": ["skyrim-se-ae", "skyrim-se"]
                    }
                }])),
                Ok(json!(["Default", "Testing"])),
                Ok(native_activation_plan(operation_id, false)),
                Ok(queued_download(DEPENDENCY_ARTIFACT_ID)),
                Ok(queued_download(ARTIFACT_ID)),
            ]);

            let result = accept_activation_with_bridge(&bridge, request.clone())
                .await
                .expect("accepted download");
            assert_eq!(result.state, ModdingFlowActivationDecisionState::Accepted);
            let calls = bridge.calls();
            assert_eq!(
                calls
                    .iter()
                    .map(|call| call.method.as_str())
                    .collect::<Vec<_>>(),
                vec![
                    "moddingflow.lookupArtifactPreview",
                    "projects.listConfigs",
                    "profiles.list",
                    "moddingflow.previewActivationPlan",
                    "downloads.queueModdingFlowArtifact",
                    "downloads.queueModdingFlowArtifact"
                ]
            );
            let plan = &calls[3].params;
            assert_eq!(plan["artifactId"], ARTIFACT_ID);
            assert_eq!(plan["gameSlug"], "skyrim-se");
            assert_eq!(plan["gameVersion"], "1.6.1170");
            assert_eq!(plan["includeOptional"], false);
            for (queue, expected) in [
                (
                    &calls[4].params,
                    (
                        DEPENDENCY_ARTIFACT_ID,
                        DEPENDENCY_MOD_ID,
                        DEPENDENCY_VERSION_ID,
                    ),
                ),
                (&calls[5].params, (ARTIFACT_ID, MOD_ID, VERSION_ID)),
            ] {
                assert_eq!(queue["artifactId"], expected.0);
                assert_eq!(queue["modId"], expected.1);
                assert_eq!(queue["versionId"], expected.2);
                assert!(is_canonical_lowercase_uuid(
                    queue["jobId"].as_str().unwrap()
                ));
                let serialized = queue.to_string().to_ascii_lowercase();
                for forbidden in ["url", "header", "token", "authorization", "profilename"] {
                    assert!(!serialized.contains(forbidden));
                }
            }
            assert!(calls.iter().all(|call| {
                call.params.get("artifactId").and_then(Value::as_str) != Some(OPTIONAL_ARTIFACT_ID)
            }));
        });
    }

    #[test]
    fn explicit_plan_preview_returns_only_safe_aggregates_and_never_queues() {
        tauri::async_runtime::block_on(async {
            let operation_id = "op_native_plan_preview";
            let request = ModdingFlowActivationPlanPreviewRequest {
                artifact_id: ARTIFACT_ID.to_string(),
                instance_id: "C:\\FluxoraData\\Builds\\Skyrim.json".to_string(),
                profile_name: "Testing".to_string(),
                operation_id: operation_id.to_string(),
            };
            let bridge = FakeBridge::new([
                Ok(native_preview(operation_id, "public")),
                Ok(json!([{
                    "id": request.instance_id,
                    "projectDirectory": "C:\\FluxoraData\\Projects\\Skyrim",
                    "projectFingerprint": { "gameVersion": "1.6.1170" },
                    "externalProviderGameSlugs": { "moddingflow": ["skyrim-se"] }
                }])),
                Ok(json!(["Default", "Testing"])),
                Ok(native_activation_plan(operation_id, false)),
            ]);

            let preview = preview_activation_plan_with_bridge(&bridge, request.clone())
                .await
                .expect("safe plan preview");
            assert_eq!(preview.artifact_id, ARTIFACT_ID);
            assert_eq!(preview.plan_id, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
            assert_eq!(preview.required_download_count, 2);
            assert_eq!(preview.optional_download_count, 1);
            assert_eq!(preview.required_disk_size_bytes, 2_735_104);
            assert_eq!(preview.conflict_count, 0);
            assert_eq!(preview.operation_id, operation_id);
            assert!(bridge
                .calls()
                .iter()
                .all(|call| call.method != "downloads.queueModdingFlowArtifact"));
            let serialized = serde_json::to_string(&preview)
                .unwrap()
                .to_ascii_lowercase();
            for forbidden in [
                "sha256",
                "artifactids",
                "steps",
                "dependencyid",
                "url",
                "token",
                "projectdirectory",
                "fluxoradata",
            ] {
                assert!(!serialized.contains(forbidden));
            }
        });
    }

    #[test]
    fn changed_plan_identity_blocks_every_download_mutation() {
        tauri::async_runtime::block_on(async {
            let operation_id = "op_changed_plan";
            let mut request = accept_request(operation_id);
            request.confirmed_plan_id = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff".to_string();
            let bridge = FakeBridge::new([
                Ok(native_preview(operation_id, "public")),
                Ok(json!([{
                    "id": request.instance_id,
                    "projectDirectory": "C:\\FluxoraData\\Projects\\Skyrim",
                    "projectFingerprint": { "gameVersion": "1.6.1170" },
                    "externalProviderGameSlugs": { "moddingflow": ["skyrim-se"] }
                }])),
                Ok(json!(["Default", "Testing"])),
                Ok(native_activation_plan(operation_id, false)),
            ]);

            let error = accept_activation_with_bridge(&bridge, request)
                .await
                .expect_err("changed plan rejected");
            assert!(error.contains("changed"));
            assert!(bridge
                .calls()
                .iter()
                .all(|call| call.method != "downloads.queueModdingFlowArtifact"));
        });
    }

    #[test]
    fn activation_plan_conflicts_block_every_download_mutation() {
        tauri::async_runtime::block_on(async {
            let operation_id = "op_native_conflict";
            let request = accept_request(operation_id);
            let bridge = FakeBridge::new([
                Ok(native_preview(operation_id, "public")),
                Ok(json!([{
                    "id": request.instance_id,
                    "projectDirectory": "C:\\FluxoraData\\Projects\\Skyrim",
                    "projectFingerprint": { "gameVersion": "1.6.1170" },
                    "externalProviderGameSlugs": { "moddingflow": ["skyrim-se"] }
                }])),
                Ok(json!(["Default", "Testing"])),
                Ok(native_activation_plan(operation_id, true)),
            ]);

            let error = accept_activation_with_bridge(&bridge, request)
                .await
                .expect_err("conflicting plan rejected");
            assert!(error.contains("conflict"));
            assert_eq!(bridge.calls().len(), 4);
            assert!(bridge
                .calls()
                .iter()
                .all(|call| call.method != "downloads.queueModdingFlowArtifact"));
        });
    }

    #[test]
    fn stale_profile_or_game_mapping_never_reaches_the_queue() {
        tauri::async_runtime::block_on(async {
            let operation_id = "op_stale_choice";
            let request = accept_request(operation_id);
            let bridge = FakeBridge::new([
                Ok(native_preview(operation_id, "public")),
                Ok(json!([{
                    "id": request.instance_id,
                    "projectDirectory": "C:\\FluxoraData\\Projects\\Skyrim",
                    "projectFingerprint": { "gameVersion": "1.6.1170" },
                    "externalProviderGameSlugs": { "moddingflow": ["skyrim-se"] }
                }])),
                Ok(json!(["Default"])),
            ]);

            let error = accept_activation_with_bridge(&bridge, request)
                .await
                .expect_err("stale profile rejected");
            assert!(error.contains("profile no longer exists"));
            assert_eq!(bridge.calls().len(), 3);
            assert!(bridge
                .calls()
                .iter()
                .all(|call| call.method != "downloads.queueModdingFlowArtifact"));
        });
    }

    #[test]
    fn job_identity_is_stable_for_safe_retry_and_changes_with_the_local_choice() {
        let first = stable_download_job_id(ARTIFACT_ID, "instance-a", "Default");
        assert_eq!(
            first,
            stable_download_job_id(ARTIFACT_ID, "instance-a", "Default")
        );
        assert_ne!(
            first,
            stable_download_job_id(ARTIFACT_ID, "instance-a", "Testing")
        );
        assert!(is_canonical_lowercase_uuid(&first));

        let plan = stable_activation_plan_idempotency_key(
            ARTIFACT_ID,
            "instance-a",
            "Default",
            "skyrim-se",
            "1.6.1170",
        );
        assert_eq!(
            plan,
            stable_activation_plan_idempotency_key(
                ARTIFACT_ID,
                "instance-a",
                "Default",
                "skyrim-se",
                "1.6.1170",
            )
        );
        assert_ne!(
            plan,
            stable_activation_plan_idempotency_key(
                ARTIFACT_ID,
                "instance-a",
                "Default",
                "skyrim-se",
                "1.6.1171",
            )
        );
    }

    #[test]
    fn idempotent_queue_retry_accepts_an_existing_completed_native_entry() {
        let archive = "C:\\FluxoraData\\Projects\\Skyrim\\downloads\\SkyUI.7z";
        assert!(validate_queued_download(&json!({
            "id": archive,
            "localPath": archive,
            "source": "ModdingFlow",
            "transferState": "idle",
            "isDownloading": false,
            "canInstall": true
        }))
        .is_ok());
        assert!(validate_queued_download(&json!({
            "id": archive,
            "localPath": archive,
            "source": "ModdingFlow",
            "transferState": "failed",
            "isDownloading": false
        }))
        .is_err());
    }

    #[test]
    fn explicit_dismiss_is_local_and_default_off_decisions_remain_unavailable() {
        let request = ModdingFlowActivationDismissRequest {
            artifact_id: ARTIFACT_ID.to_string(),
            operation_id: "op_native_dismiss".to_string(),
        };
        assert_eq!(
            dismiss_activation(request.clone(), false),
            Err(UNAVAILABLE_MESSAGE.to_string())
        );
        assert_eq!(
            dismiss_activation(request, true).unwrap().state,
            ModdingFlowActivationDecisionState::Dismissed
        );
    }

    #[test]
    fn requests_and_native_identity_are_strictly_validated() {
        assert!(disabled_preview(ModdingFlowActivationPreviewRequest {
            artifact_id: ARTIFACT_ID.to_ascii_uppercase(),
            operation_id: "op_native_preview".to_string(),
        })
        .is_err());
        assert!(dismiss_activation(
            ModdingFlowActivationDismissRequest {
                artifact_id: ARTIFACT_ID.to_string(),
                operation_id: "".to_string(),
            },
            true,
        )
        .is_err());
        let mut value = native_preview("op_native_response", "public");
        value["authorizationUrl"] = json!("https://evil.example/token");
        assert!(parse_native_artifact_preview(value, ARTIFACT_ID, "op_native_response").is_err());

        let root_value = native_preview("op_native_plan_response", "public");
        let root =
            parse_native_artifact_preview(root_value, ARTIFACT_ID, "op_native_plan_response")
                .unwrap();
        let mut plan = native_activation_plan("op_native_plan_response", false);
        plan["signedUrl"] = json!("https://evil.example/private-grant");
        assert!(
            parse_native_activation_plan(plan, &root, "1.6.1170", "op_native_plan_response",)
                .is_err()
        );

        let mut mismatched = native_activation_plan("op_native_plan_response", false);
        mismatched["steps"][1]["sha256"] = json!("d".repeat(64));
        assert!(parse_native_activation_plan(
            mismatched,
            &root,
            "1.6.1170",
            "op_native_plan_response",
        )
        .is_err());
    }
}
