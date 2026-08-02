use serde::{Deserialize, Serialize};

pub const INSTALLER_SCHEMA_VERSION: u32 = 1;
pub const SETUP_PROGRESS_EVENT: &str = "fluxora:setup-progress";
pub const SETUP_POST_INSTALL_UPDATE_PROGRESS_EVENT: &str =
    "fluxora:setup-post-install-update-progress";
pub const SETUP_CLOSE_BLOCKED_EVENT: &str = "fluxora:setup-close-blocked";
pub const UPDATER_PROGRESS_EVENT: &str = "fluxora:updater-progress";
pub const UPDATER_CLOSE_BLOCKED_EVENT: &str = "fluxora:updater-close-blocked";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFailure {
    pub code: String,
    pub message_key: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_key: Option<String>,
    // Native diagnostics belong in the separated installer/updater logs. They
    // must never cross the Tauri boundary into renderer-visible error payloads.
    #[serde(skip_serializing)]
    pub technical_detail: Option<String>,
}

impl NativeFailure {
    pub fn new(code: impl Into<String>, message_key: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message_key: message_key.into(),
            retryable,
            action_key: None,
            technical_detail: None,
        }
    }

    pub fn with_action(mut self, action_key: impl Into<String>) -> Self {
        self.action_key = Some(action_key.into());
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.technical_detail = Some(detail.into());
        self
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SetupMode {
    Install,
    Repair,
    Update,
    Downgrade,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSetupBootstrapState {
    pub schema_version: u32,
    pub default_install_directory: String,
    pub mode: SetupMode,
    #[serde(default)]
    pub installed_version: Option<String>,
    pub required_bytes: u64,
    pub free_bytes: u64,
    pub is_owned_install: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetupBootstrapState {
    pub schema_version: u32,
    pub language: String,
    pub default_install_directory: String,
    pub mode: SetupMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    pub required_bytes: u64,
    pub free_bytes: u64,
    pub is_owned_install: bool,
    pub payload_bytes: u64,
    pub webview2_version: Option<String>,
    pub native_available: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstallPathStatus {
    Valid,
    InsufficientSpace,
    ForeignInstall,
    InvalidPath,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallPathValidation {
    pub schema_version: u32,
    pub status: InstallPathStatus,
    pub code: String,
    pub message_key: String,
    pub normalized_install_directory: String,
    pub required_bytes: u64,
    pub free_bytes: u64,
    pub mode: SetupMode,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPathRequest {
    pub operation_id: String,
    pub install_directory: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOptions {
    pub operation_id: String,
    pub install_directory: String,
    pub create_desktop_shortcut: bool,
    pub language: String,
    pub terms_accepted: bool,
    pub privacy_acknowledged: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRequest {
    pub operation_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPickerRequest {
    #[serde(default)]
    pub initial_directory: Option<String>,
    #[serde(default)]
    pub language: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderPickerResult {
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInstallProgress {
    pub phase: String,
    #[serde(default)]
    pub current_item: String,
    #[serde(default, alias = "bytesCompleted", alias = "copiedBytes")]
    pub copied_bytes: u64,
    #[serde(default)]
    pub total_bytes: u64,
    #[serde(default)]
    pub percent: f64,
    #[serde(default)]
    pub status_key: Option<String>,
    #[serde(default)]
    pub can_cancel: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub operation_id: String,
    pub phase: String,
    pub copied_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub status_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_item: Option<String>,
    pub can_cancel: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInstallResult {
    pub install_directory: String,
    pub application_path: String,
    #[serde(default)]
    pub desktop_shortcut_path: String,
    pub created_desktop_shortcut: bool,
    pub mode: SetupMode,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstallOutcome {
    Succeeded,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub schema_version: u32,
    pub operation_id: String,
    pub outcome: InstallOutcome,
    pub install_directory: String,
    pub application_path: String,
    pub installed_version: String,
    pub created_desktop_shortcut: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancelResult {
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowActionResult {
    pub completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_key: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SetupPostInstallUpdateState {
    Checking,
    UpToDate,
    UpdateAvailable,
    Downloading,
    Verifying,
    PreparingHandoff,
    HandoffCommitted,
    LaunchingBundled,
    Cancelled,
    Error,
    LaunchError,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupPostInstallUpdateProgress {
    pub schema_version: u32,
    pub operation_id: String,
    pub state: SetupPostInstallUpdateState,
    pub phase: SetupPostInstallUpdateState,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_version: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    pub can_cancel: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SetupPostInstallUpdateOutcome {
    BundledLaunched,
    UpdaterLaunched,
    Cancelled,
    LaunchFailed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetupPostInstallUpdateResult {
    pub schema_version: u32,
    pub operation_id: String,
    pub outcome: SetupPostInstallUpdateOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<NativeFailure>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateAssetKind {
    Full,
    Delta,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRequestSummary {
    pub schema_version: u32,
    pub operation_id: String,
    pub current_version: String,
    pub target_version: String,
    pub asset_kind: UpdateAssetKind,
    #[serde(default = "default_updater_presentation")]
    pub presentation: String,
    #[serde(default = "default_installer_language")]
    pub language: String,
}

fn default_updater_presentation() -> String {
    "compact".to_string()
}

fn default_installer_language() -> String {
    "en".to_string()
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    #[serde(default)]
    pub schema_version: u32,
    pub operation_id: String,
    pub phase: String,
    #[serde(
        default,
        alias = "bytesCompleted",
        alias = "completedBytes",
        alias = "copiedBytes"
    )]
    pub copied_bytes: u64,
    #[serde(default)]
    pub total_bytes: u64,
    #[serde(default)]
    pub percent: f64,
    pub status_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_item: Option<String>,
    #[serde(default)]
    pub can_cancel: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateOutcome {
    Succeeded,
    RolledBack,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub schema_version: u32,
    pub operation_id: String,
    pub outcome: UpdateOutcome,
    pub target_version: String,
    #[serde(default)]
    pub error: Option<NativeFailure>,
}

pub fn validate_operation_id(operation_id: &str) -> Result<(), NativeFailure> {
    let operation_id = operation_id.trim();
    if operation_id.is_empty()
        || operation_id.len() > 128
        || operation_id.chars().any(char::is_control)
    {
        return Err(NativeFailure::new(
            "installer.invalidOperationId",
            "installer.error.invalidOperationId",
            false,
        ));
    }
    Ok(())
}

fn sanitized_relative_item(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 1_024
        || value.chars().any(char::is_control)
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.contains(':')
        || value.split(['/', '\\']).any(|component| component == "..")
    {
        return None;
    }
    Some(value.to_string())
}

pub fn normalize_setup_progress(
    operation_id: &str,
    raw: NativeInstallProgress,
) -> Result<InstallProgress, NativeFailure> {
    validate_operation_id(operation_id)?;
    let phase = match raw.phase.as_str() {
        "preparing" | "validating" | "copying" | "staging" | "finalizing" | "committing"
        | "rolling-back" | "completed" => raw.phase,
        _ => "working".to_string(),
    };
    let phase_is_cancellable = !matches!(
        phase.as_str(),
        "finalizing" | "committing" | "rolling-back" | "completed"
    );
    let can_cancel = phase_is_cancellable && raw.can_cancel.unwrap_or(true);
    let percent = if raw.percent.is_finite() {
        raw.percent.clamp(0.0, 100.0)
    } else {
        0.0
    };
    let status_key = format!("setup.progress.{phase}");
    Ok(InstallProgress {
        operation_id: operation_id.to_string(),
        status_key,
        current_item: sanitized_relative_item(&raw.current_item),
        phase,
        copied_bytes: raw.copied_bytes,
        total_bytes: raw.total_bytes,
        percent,
        can_cancel,
    })
}

pub fn normalize_updater_progress(
    operation_id: &str,
    mut raw: UpdateProgress,
) -> Result<UpdateProgress, NativeFailure> {
    validate_operation_id(operation_id)?;
    validate_schema(raw.schema_version, "update progress")?;
    let (phase, expected_status_key) = match raw.phase.as_str() {
        "recovering" => ("recovering", "updater.status.recovering"),
        "waiting-for-parent" => ("waiting-for-parent", "updater.status.waitingForParent"),
        "verifying" => ("verifying", "updater.status.verifying"),
        "installing" => ("installing", "updater.status.installing"),
        "launching" => ("launching", "updater.status.launching"),
        "health-check" => ("health-check", "updater.status.healthCheck"),
        "finalizing" => ("finalizing", "updater.status.finalizing"),
        "rolling-back" => ("rolling-back", "updater.status.rollingBack"),
        "rolled-back" => ("rolled-back", "updater.status.rolledBack"),
        "completed" => ("completed", "updater.status.completed"),
        _ => ("working", "updater.status.working"),
    };
    raw.operation_id = operation_id.to_string();
    raw.phase = phase.to_string();
    raw.status_key = if raw.status_key == expected_status_key {
        raw.status_key
    } else {
        expected_status_key.to_string()
    };
    raw.percent = if raw.percent.is_finite() {
        raw.percent.clamp(0.0, 100.0)
    } else {
        0.0
    };
    raw.can_cancel = false;
    raw.current_item = raw
        .current_item
        .as_deref()
        .and_then(sanitized_relative_item);
    Ok(raw)
}

pub fn validate_schema(schema_version: u32, source: &str) -> Result<(), NativeFailure> {
    if schema_version != INSTALLER_SCHEMA_VERSION {
        return Err(NativeFailure::new(
            "installer.unsupportedSchema",
            "installer.error.unsupportedSchema",
            false,
        )
        .with_detail(format!(
            "{source} schemaVersion={schema_version}, expected={INSTALLER_SCHEMA_VERSION}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_setup_bootstrap_omits_the_absent_installed_version() {
        let state = SetupBootstrapState {
            schema_version: INSTALLER_SCHEMA_VERSION,
            language: "en".to_string(),
            default_install_directory: r"C:\Users\Owner\AppData\Local\Programs\Fluxora".to_string(),
            mode: SetupMode::Install,
            installed_version: None,
            required_bytes: 100,
            free_bytes: 1_000,
            is_owned_install: false,
            payload_bytes: 90,
            webview2_version: None,
            native_available: true,
        };

        let serialized = serde_json::to_value(state).unwrap();
        assert!(serialized.get("installedVersion").is_none());
    }

    #[test]
    fn native_install_result_accepts_authoritative_downgrade_mode() {
        let result: NativeInstallResult = serde_json::from_value(serde_json::json!({
            "installDirectory": r"C:\Fluxora Installed",
            "applicationPath": r"C:\Fluxora Installed\Fluxora.exe",
            "desktopShortcutPath": "",
            "createdDesktopShortcut": false,
            "mode": "downgrade"
        }))
        .unwrap();

        assert_eq!(result.mode, SetupMode::Downgrade);
    }

    #[test]
    fn commit_phases_are_never_cancellable() {
        let progress = normalize_setup_progress(
            "setup-123",
            NativeInstallProgress {
                phase: "committing".to_string(),
                current_item: String::new(),
                copied_bytes: 10,
                total_bytes: 10,
                percent: 100.0,
                status_key: None,
                can_cancel: None,
            },
        )
        .unwrap();
        assert!(!progress.can_cancel);
        assert_eq!(progress.status_key, "setup.progress.committing");
    }

    #[test]
    fn operation_ids_are_bounded_and_control_free() {
        assert!(validate_operation_id("install-123").is_ok());
        assert!(validate_operation_id("").is_err());
        assert!(validate_operation_id("line\nbreak").is_err());
        assert!(validate_operation_id(&"x".repeat(129)).is_err());
    }

    #[test]
    fn updater_progress_rejects_untrusted_phase_and_status_key() {
        let progress = normalize_updater_progress(
            "update-123",
            UpdateProgress {
                schema_version: INSTALLER_SCHEMA_VERSION,
                operation_id: "native-value-is-not-trusted".to_string(),
                phase: "open-arbitrary-url".to_string(),
                copied_bytes: 40,
                total_bytes: 100,
                percent: f64::INFINITY,
                status_key: "attacker.controlled.translation".to_string(),
                current_item: None,
                can_cancel: true,
            },
        )
        .unwrap();

        assert_eq!(progress.operation_id, "update-123");
        assert_eq!(progress.phase, "working");
        assert_eq!(progress.status_key, "updater.status.working");
        assert_eq!(progress.percent, 0.0);
        assert!(!progress.can_cancel);
    }

    #[test]
    fn updater_progress_preserves_only_allowlisted_values() {
        let progress = normalize_updater_progress(
            "update-123",
            UpdateProgress {
                schema_version: INSTALLER_SCHEMA_VERSION,
                operation_id: String::new(),
                phase: "health-check".to_string(),
                copied_bytes: 100,
                total_bytes: 100,
                percent: 120.0,
                status_key: "updater.status.healthCheck".to_string(),
                current_item: Some("bin/Fluxora.exe".to_string()),
                can_cancel: true,
            },
        )
        .unwrap();

        assert_eq!(progress.phase, "health-check");
        assert_eq!(progress.status_key, "updater.status.healthCheck");
        assert_eq!(progress.percent, 100.0);
        assert!(!progress.can_cancel);
    }

    #[test]
    fn progress_never_exposes_absolute_or_control_character_paths() {
        let setup = normalize_setup_progress(
            "setup-123",
            NativeInstallProgress {
                phase: "copying".to_string(),
                current_item: "C:\\private\\Fluxora.exe".to_string(),
                copied_bytes: 1,
                total_bytes: 2,
                percent: 50.0,
                status_key: Some("setup.progress.completed".to_string()),
                can_cancel: Some(true),
            },
        )
        .unwrap();
        assert_eq!(setup.status_key, "setup.progress.copying");
        assert_eq!(setup.current_item, None);

        let updater = normalize_updater_progress(
            "update-123",
            UpdateProgress {
                schema_version: INSTALLER_SCHEMA_VERSION,
                operation_id: String::new(),
                phase: "installing".to_string(),
                copied_bytes: 1,
                total_bytes: 2,
                percent: 50.0,
                status_key: "updater.status.installing".to_string(),
                current_item: Some("bin/\nFluxora.exe".to_string()),
                can_cancel: false,
            },
        )
        .unwrap();
        assert_eq!(updater.current_item, None);
    }
}
