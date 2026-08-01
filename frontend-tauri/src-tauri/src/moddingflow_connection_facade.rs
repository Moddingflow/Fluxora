use crate::moddingflow_oauth::{
    AuthorizationBrowserOpenError, CoreCallFuture, ModdingFlowAuthorizationBrowser,
    ModdingFlowOAuthError, PreparedModdingFlowOAuth, TrustedModdingFlowOAuthBegin,
    TrustedModdingFlowOAuthCallError, TrustedModdingFlowOAuthCompletion,
    TrustedModdingFlowOAuthCore,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{Mutex, Notify};
use tokio::time::{timeout, Duration};

const PROVIDER_ID: &str = "moddingflow";
const PROVIDER_LABEL: &str = "ModdingFlow";
const UNAVAILABLE_MESSAGE: &str = "ModdingFlow connection is not available in this build.";
const MAX_OPERATION_ID_BYTES: usize = 256;
const MAX_ACCOUNT_NAME_BYTES: usize = 512;
const MAX_STATUS_MESSAGE_BYTES: usize = 2 * 1024;
const MAX_TIMESTAMP_BYTES: usize = 64;
const CONTROL_PLANE_TIMEOUT_MS: u64 = 30_000;
const RESTORE_TIMEOUT_MS: u64 = 3_000;
const MAX_RESTORE_ATTEMPT: u32 = 100;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConnectionOperationRequest {
    operation_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SafeExternalConnectionStatus {
    provider_id: String,
    label: String,
    state: String,
    account_name: String,
    has_stored_session: bool,
    retryable: bool,
    requires_user_action: bool,
    message: String,
    checked_at_utc: String,
    operation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeOAuthBegin {
    transaction_id: String,
    authorization_url: String,
    expires_at_epoch_seconds: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeOAuthCancellation {
    cancelled: bool,
}

#[derive(Default)]
struct PendingOAuthFlow {
    running: bool,
    cancel_handle: Option<crate::oauth_loopback::OAuthLoopbackCancelHandle>,
}

#[derive(Default)]
pub(crate) struct ModdingFlowConnectionRuntimeState {
    flow: Mutex<PendingOAuthFlow>,
    settled: Notify,
}

struct BridgeOAuthCore {
    app: AppHandle,
}

struct TauriAuthorizationBrowser {
    app: AppHandle,
}

impl TrustedModdingFlowOAuthCore for BridgeOAuthCore {
    fn begin<'a>(
        &'a self,
        redirect_uri: &'a str,
        operation_id: &'a str,
    ) -> CoreCallFuture<'a, TrustedModdingFlowOAuthBegin> {
        Box::pin(async move {
            let value = crate::trusted_moddingflow_bridge_request(
                &self.app,
                "connections.beginConnect",
                json!({ "redirectUri": redirect_uri }),
                operation_id,
                CONTROL_PLANE_TIMEOUT_MS,
            )
            .await
            .map_err(|_| TrustedModdingFlowOAuthCallError)?;
            let begin: NativeOAuthBegin =
                serde_json::from_value(value).map_err(|_| TrustedModdingFlowOAuthCallError)?;
            if begin.expires_at_epoch_seconds == 0 {
                return Err(TrustedModdingFlowOAuthCallError);
            }
            Ok(TrustedModdingFlowOAuthBegin {
                transaction_id: begin.transaction_id,
                authorization_url: begin.authorization_url,
            })
        })
    }

    fn complete<'a>(
        &'a self,
        transaction_id: &'a str,
        completion: TrustedModdingFlowOAuthCompletion,
        operation_id: &'a str,
    ) -> CoreCallFuture<'a, ()> {
        Box::pin(async move {
            let callback = match completion {
                TrustedModdingFlowOAuthCompletion::AuthorizationCode {
                    code,
                    state,
                    issuer,
                } => json!({
                    "kind": "success",
                    "authorizationCode": code,
                    "state": state,
                    "issuer": issuer
                }),
                TrustedModdingFlowOAuthCompletion::AuthorizationError {
                    error,
                    error_description,
                    state,
                    issuer,
                } => {
                    let mut callback = Map::new();
                    callback.insert("kind".to_string(), json!("error"));
                    callback.insert("oauthError".to_string(), json!(error));
                    if let Some(error_description) = error_description {
                        callback.insert("errorDescription".to_string(), json!(error_description));
                    }
                    callback.insert("state".to_string(), json!(state));
                    callback.insert("issuer".to_string(), json!(issuer));
                    Value::Object(callback)
                }
            };
            let value = crate::trusted_moddingflow_bridge_request(
                &self.app,
                "connections.completeConnect",
                json!({
                    "transactionId": transaction_id,
                    "callback": callback
                }),
                operation_id,
                CONTROL_PLANE_TIMEOUT_MS,
            )
            .await
            .map_err(|_| TrustedModdingFlowOAuthCallError)?;
            parse_safe_status(value, operation_id)
                .map(|_| ())
                .map_err(|_| TrustedModdingFlowOAuthCallError)
        })
    }

    fn cancel<'a>(
        &'a self,
        transaction_id: &'a str,
        operation_id: &'a str,
    ) -> CoreCallFuture<'a, ()> {
        Box::pin(async move {
            let value = crate::trusted_moddingflow_bridge_request(
                &self.app,
                "connections.cancelPendingConnect",
                json!({ "transactionId": transaction_id }),
                operation_id,
                CONTROL_PLANE_TIMEOUT_MS,
            )
            .await
            .map_err(|_| TrustedModdingFlowOAuthCallError)?;
            let cancellation: NativeOAuthCancellation =
                serde_json::from_value(value).map_err(|_| TrustedModdingFlowOAuthCallError)?;
            if !cancellation.cancelled {
                return Err(TrustedModdingFlowOAuthCallError);
            }
            Ok(())
        })
    }
}

impl ModdingFlowAuthorizationBrowser for TauriAuthorizationBrowser {
    fn open_authorization_url(
        &self,
        authorization_url: &str,
    ) -> Result<(), AuthorizationBrowserOpenError> {
        self.app
            .opener()
            .open_url(authorization_url, None::<String>)
            .map_err(|_| AuthorizationBrowserOpenError)
    }
}

fn validated_operation_id(request: Option<ConnectionOperationRequest>) -> Result<String, String> {
    let operation_id = request
        .and_then(|request| request.operation_id)
        .ok_or_else(|| "Operation identifier is required.".to_string())?;
    if operation_id.is_empty()
        || operation_id.len() > MAX_OPERATION_ID_BYTES
        || operation_id.trim() != operation_id
        || operation_id.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err("Operation identifier is invalid.".to_string());
    }
    Ok(operation_id)
}

fn unavailable_status(
    request: Option<ConnectionOperationRequest>,
) -> Result<SafeExternalConnectionStatus, String> {
    Ok(SafeExternalConnectionStatus {
        provider_id: PROVIDER_ID.to_string(),
        label: PROVIDER_LABEL.to_string(),
        state: "notConfigured".to_string(),
        account_name: String::new(),
        has_stored_session: false,
        retryable: false,
        requires_user_action: false,
        message: UNAVAILABLE_MESSAGE.to_string(),
        checked_at_utc: String::new(),
        operation_id: validated_operation_id(request)?,
    })
}

fn validate_bounded_text(value: &str, maximum_bytes: usize) -> Result<(), String> {
    if value.len() > maximum_bytes || value.bytes().any(|byte| byte.is_ascii_control()) {
        return Err("Native connection status contained invalid text.".to_string());
    }
    Ok(())
}

fn parse_safe_status(
    value: Value,
    expected_operation_id: &str,
) -> Result<SafeExternalConnectionStatus, String> {
    let status: SafeExternalConnectionStatus = serde_json::from_value(value)
        .map_err(|_| "Native ModdingFlow connection status is invalid.".to_string())?;
    if status.provider_id != PROVIDER_ID
        || status.label != PROVIDER_LABEL
        || status.operation_id != expected_operation_id
        || !matches!(
            status.state.as_str(),
            "notConfigured"
                | "notLinked"
                | "connecting"
                | "restoring"
                | "ready"
                | "temporarilyUnavailable"
                | "reauthRequired"
        )
    {
        return Err("Native ModdingFlow connection status is invalid.".to_string());
    }
    validate_operation_id_for_status(&status.operation_id)?;
    validate_bounded_text(&status.account_name, MAX_ACCOUNT_NAME_BYTES)?;
    validate_bounded_text(&status.message, MAX_STATUS_MESSAGE_BYTES)?;
    validate_bounded_text(&status.checked_at_utc, MAX_TIMESTAMP_BYTES)?;
    Ok(status)
}

fn validate_operation_id_for_status(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_OPERATION_ID_BYTES
        || value.trim() != value
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err("Native ModdingFlow operation identifier is invalid.".to_string());
    }
    Ok(())
}

fn find_moddingflow_status(
    value: Value,
    expected_operation_id: &str,
) -> Result<Option<SafeExternalConnectionStatus>, String> {
    let providers = value
        .as_object()
        .and_then(|object| object.get("providers"))
        .and_then(Value::as_array)
        .ok_or_else(|| "Native connection snapshot is invalid.".to_string())?;
    if providers.len() > 16 {
        return Err("Native connection snapshot is invalid.".to_string());
    }

    let mut matched = None;
    for provider in providers {
        if provider
            .as_object()
            .and_then(|object| object.get("providerId"))
            .and_then(Value::as_str)
            != Some(PROVIDER_ID)
        {
            continue;
        }
        if matched.is_some() {
            return Err("Native connection snapshot contains duplicate providers.".to_string());
        }
        matched = Some(parse_safe_status(provider.clone(), expected_operation_id)?);
    }
    Ok(matched)
}

async fn native_status(
    app: &AppHandle,
    operation_id: &str,
) -> Result<Option<SafeExternalConnectionStatus>, String> {
    let value = crate::trusted_moddingflow_bridge_request(
        app,
        "connections.listStatus",
        json!({}),
        operation_id,
        CONTROL_PLANE_TIMEOUT_MS,
    )
    .await?;
    find_moddingflow_status(value, operation_id)
}

fn oauth_error_message(error: ModdingFlowOAuthError) -> String {
    match error {
        ModdingFlowOAuthError::AuthorizationRejected => {
            "ModdingFlow authorization was not completed.".to_string()
        }
        ModdingFlowOAuthError::Cancelled { .. } => {
            "ModdingFlow authorization was cancelled.".to_string()
        }
        ModdingFlowOAuthError::TimedOut { .. } => {
            "ModdingFlow authorization timed out.".to_string()
        }
        ModdingFlowOAuthError::BrowserOpenFailed { .. } => {
            "The ModdingFlow authorization page could not be opened.".to_string()
        }
        _ => "ModdingFlow authorization failed safely.".to_string(),
    }
}

#[tauri::command]
pub(crate) async fn fluxora_moddingflow_connection_status(
    app: AppHandle,
    request: Option<ConnectionOperationRequest>,
) -> Result<Option<SafeExternalConnectionStatus>, String> {
    let operation_id = validated_operation_id(request)?;
    native_status(&app, &operation_id).await
}

#[tauri::command]
pub(crate) async fn fluxora_moddingflow_restore_connection(
    app: AppHandle,
    attempt: u32,
    request: Option<ConnectionOperationRequest>,
) -> Result<Option<SafeExternalConnectionStatus>, String> {
    let operation_id = validated_operation_id(request)?;
    if attempt == 0 || attempt > MAX_RESTORE_ATTEMPT {
        return Err("Connection restore attempt is invalid.".to_string());
    }
    let value = crate::trusted_moddingflow_bridge_request(
        &app,
        "connections.restoreAll",
        json!({ "attempt": attempt }),
        &operation_id,
        RESTORE_TIMEOUT_MS,
    )
    .await?;
    find_moddingflow_status(value, &operation_id)
}

#[tauri::command]
pub(crate) async fn fluxora_moddingflow_connect(
    app: AppHandle,
    runtime: State<'_, ModdingFlowConnectionRuntimeState>,
    request: Option<ConnectionOperationRequest>,
) -> Result<SafeExternalConnectionStatus, String> {
    let operation_id = validated_operation_id(request)?;
    let Some(initial_status) = native_status(&app, &operation_id).await? else {
        return unavailable_status(Some(ConnectionOperationRequest {
            operation_id: Some(operation_id),
        }));
    };
    if initial_status.state == "ready" {
        return Ok(initial_status);
    }

    let prepared = {
        let mut flow = runtime.flow.lock().await;
        if flow.running {
            let mut status = initial_status;
            status.state = "connecting".to_string();
            status.message = "ModdingFlow authorization is already in progress.".to_string();
            return Ok(status);
        }
        let (prepared, cancel_handle) = PreparedModdingFlowOAuth::bind(&operation_id)
            .await
            .map_err(oauth_error_message)?;
        flow.running = true;
        flow.cancel_handle = Some(cancel_handle);
        prepared
    };

    let core = BridgeOAuthCore { app: app.clone() };
    let browser = TauriAuthorizationBrowser { app: app.clone() };
    let outcome = prepared.run(&core, &browser).await;
    {
        let mut flow = runtime.flow.lock().await;
        flow.running = false;
        flow.cancel_handle.take();
    }
    runtime.settled.notify_waiters();

    outcome.map_err(oauth_error_message)?;
    native_status(&app, &operation_id)
        .await?
        .ok_or_else(|| "ModdingFlow connection capability disappeared.".to_string())
}

#[tauri::command]
pub(crate) async fn fluxora_moddingflow_cancel_connect(
    app: AppHandle,
    runtime: State<'_, ModdingFlowConnectionRuntimeState>,
    request: Option<ConnectionOperationRequest>,
) -> Result<SafeExternalConnectionStatus, String> {
    let operation_id = validated_operation_id(request)?;
    let settled = runtime.settled.notified();
    let was_running = {
        let mut flow = runtime.flow.lock().await;
        if !flow.running {
            false
        } else {
            if let Some(cancel_handle) = flow.cancel_handle.take() {
                let _ = cancel_handle.cancel();
            }
            true
        }
    };
    if was_running {
        let _ = timeout(Duration::from_secs(2), settled).await;
    }
    Ok(native_status(&app, &operation_id)
        .await?
        .unwrap_or(SafeExternalConnectionStatus {
            operation_id,
            provider_id: PROVIDER_ID.to_string(),
            label: PROVIDER_LABEL.to_string(),
            state: "notConfigured".to_string(),
            account_name: String::new(),
            has_stored_session: false,
            retryable: false,
            requires_user_action: false,
            message: UNAVAILABLE_MESSAGE.to_string(),
            checked_at_utc: String::new(),
        }))
}

#[tauri::command]
pub(crate) async fn fluxora_moddingflow_disconnect(
    app: AppHandle,
    runtime: State<'_, ModdingFlowConnectionRuntimeState>,
    request: Option<ConnectionOperationRequest>,
) -> Result<SafeExternalConnectionStatus, String> {
    let operation_id = validated_operation_id(request)?;
    if runtime.flow.lock().await.running {
        return Err("Cancel the pending ModdingFlow authorization first.".to_string());
    }
    if native_status(&app, &operation_id).await?.is_none() {
        return unavailable_status(Some(ConnectionOperationRequest {
            operation_id: Some(operation_id),
        }));
    }
    let value = crate::trusted_moddingflow_bridge_request(
        &app,
        "connections.disconnect",
        json!({ "providerId": PROVIDER_ID }),
        &operation_id,
        CONTROL_PLANE_TIMEOUT_MS,
    )
    .await?;
    parse_safe_status(value, &operation_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn request(operation_id: &str) -> Option<ConnectionOperationRequest> {
        Some(ConnectionOperationRequest {
            operation_id: Some(operation_id.to_string()),
        })
    }

    #[test]
    fn every_public_action_returns_the_same_explicit_unavailable_status() {
        let operation_id = "op_moddingflow_connection";
        let status = unavailable_status(request(operation_id)).expect("safe unavailable status");
        assert_eq!(status.provider_id, PROVIDER_ID);
        assert_eq!(status.state, "notConfigured");
        assert_eq!(status.operation_id, operation_id);
        assert_eq!(status.message, UNAVAILABLE_MESSAGE);
    }

    #[test]
    fn serialized_status_contains_only_renderer_safe_allowlisted_fields() {
        let value = serde_json::to_value(
            unavailable_status(request("op_safe_status")).expect("safe status"),
        )
        .expect("serialize status");
        let Value::Object(fields) = value else {
            panic!("status must serialize as an object");
        };
        let mut keys = fields.keys().map(String::as_str).collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "accountName",
                "checkedAtUtc",
                "hasStoredSession",
                "label",
                "message",
                "operationId",
                "providerId",
                "requiresUserAction",
                "retryable",
                "state",
            ]
        );
        let serialized = serde_json::to_string(&fields).expect("serialize fields");
        for forbidden in [
            "authorizationUrl",
            "callback",
            "code",
            "query",
            "stateValue",
            "token",
            "transactionId",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn operation_id_is_required_and_strictly_bounded() {
        assert!(unavailable_status(None).is_err());
        assert!(unavailable_status(request("")).is_err());
        assert!(unavailable_status(request(" padded ")).is_err());
        assert!(unavailable_status(request(&"x".repeat(MAX_OPERATION_ID_BYTES + 1))).is_err());
    }

    #[test]
    fn native_status_is_allowlisted_and_bound_to_the_call_operation() {
        let value = serde_json::json!({
            "providerId": "moddingflow",
            "label": "ModdingFlow",
            "state": "ready",
            "accountName": "Safe account",
            "hasStoredSession": true,
            "retryable": false,
            "requiresUserAction": false,
            "message": "Connected.",
            "checkedAtUtc": "2026-07-29T12:00:00Z",
            "operationId": "op_status"
        });

        let status = parse_safe_status(value, "op_status").expect("strict status");
        assert_eq!(status.provider_id, PROVIDER_ID);
        assert_eq!(status.state, "ready");
        assert_eq!(status.account_name, "Safe account");
    }

    #[test]
    fn native_status_rejects_wrong_provider_operation_unknown_fields_and_oversized_text() {
        let base = serde_json::json!({
            "providerId": "moddingflow",
            "label": "ModdingFlow",
            "state": "notLinked",
            "accountName": "",
            "hasStoredSession": false,
            "retryable": false,
            "requiresUserAction": true,
            "message": "",
            "checkedAtUtc": "",
            "operationId": "op_status"
        });

        let mut wrong_provider = base.clone();
        wrong_provider["providerId"] = serde_json::json!("nexus");
        assert!(parse_safe_status(wrong_provider, "op_status").is_err());

        assert!(parse_safe_status(base.clone(), "op_other").is_err());

        let mut unknown = base.clone();
        unknown["accessToken"] = serde_json::json!("secret");
        assert!(parse_safe_status(unknown, "op_status").is_err());

        let mut oversized = base;
        oversized["accountName"] = serde_json::json!("x".repeat(MAX_ACCOUNT_NAME_BYTES + 1));
        assert!(parse_safe_status(oversized, "op_status").is_err());
    }

    #[test]
    fn provider_lookup_rejects_duplicates_and_returns_none_when_feature_is_absent() {
        let status = serde_json::json!({
            "providerId": "moddingflow",
            "label": "ModdingFlow",
            "state": "notLinked",
            "accountName": "",
            "hasStoredSession": false,
            "retryable": false,
            "requiresUserAction": true,
            "message": "",
            "checkedAtUtc": "",
            "operationId": "op_list"
        });
        let absent = serde_json::json!({"providers": []});
        assert_eq!(find_moddingflow_status(absent, "op_list").unwrap(), None);

        let duplicate = serde_json::json!({"providers": [status.clone(), status]});
        assert!(find_moddingflow_status(duplicate, "op_list").is_err());
    }
}
