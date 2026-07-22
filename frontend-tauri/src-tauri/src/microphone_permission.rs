use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const MICROPHONE_ARM_TTL: Duration = Duration::from_secs(10);
const FLUXORA_WEBVIEW_ORIGIN: &str = "http://tauri.localhost";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MicrophonePermissionRequest {
    operation_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MicrophonePermissionError {
    code: String,
    user_message: String,
    stage: String,
    operation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    debug_message: Option<String>,
}

fn permission_error(
    code: &str,
    user_message: &str,
    operation_id: &str,
    debug_message: Option<String>,
) -> MicrophonePermissionError {
    MicrophonePermissionError {
        code: code.to_string(),
        user_message: user_message.to_string(),
        stage: "permission".to_string(),
        operation_id: operation_id.to_string(),
        debug_message,
    }
}

fn validate_operation_id(operation_id: &str) -> bool {
    !operation_id.is_empty()
        && operation_id.len() <= 160
        && operation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PermissionKind {
    Microphone,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PermissionDecision {
    Allow,
    Deny,
    Untouched,
}

#[derive(Debug, Default)]
struct MicrophoneGate {
    armed_until: Option<Instant>,
}

impl MicrophoneGate {
    fn arm(&mut self, now: Instant) {
        self.armed_until = Some(now + MICROPHONE_ARM_TTL);
    }

    fn reset(&mut self) {
        self.armed_until = None;
    }

    fn decide(
        &mut self,
        kind: PermissionKind,
        origin: Option<&str>,
        now: Instant,
        profile_ready: bool,
    ) -> PermissionDecision {
        if kind == PermissionKind::Other {
            return PermissionDecision::Untouched;
        }

        let armed_until = self.armed_until.take();
        if profile_ready
            && origin == Some(FLUXORA_WEBVIEW_ORIGIN)
            && armed_until.is_some_and(|deadline| now <= deadline)
        {
            PermissionDecision::Allow
        } else {
            PermissionDecision::Deny
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct MicrophonePermissionState {
    inner: Arc<MicrophonePermissionStateInner>,
}

#[derive(Default)]
struct MicrophonePermissionStateInner {
    gate: Mutex<MicrophoneGate>,
    profile_ready: AtomicBool,
    profile_generation: AtomicU64,
    handler_ready: AtomicBool,
}

impl MicrophonePermissionState {
    fn arm(&self, now: Instant) -> bool {
        if !self.inner.profile_ready.load(Ordering::SeqCst)
            || !self.inner.handler_ready.load(Ordering::SeqCst)
        {
            return false;
        }
        self.inner.gate.lock().map(|mut gate| gate.arm(now)).is_ok()
    }

    fn reset_gate(&self) {
        if let Ok(mut gate) = self.inner.gate.lock() {
            gate.reset();
        }
    }

    fn set_profile_ready(&self, ready: bool) {
        self.inner.profile_ready.store(ready, Ordering::SeqCst);
        if !ready {
            self.reset_gate();
        }
    }

    fn start_profile_reset(&self) -> u64 {
        self.set_profile_ready(false);
        self.inner.profile_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn complete_profile_reset(&self, generation: u64, success: bool) {
        if self.inner.profile_generation.load(Ordering::SeqCst) == generation {
            self.set_profile_ready(success);
        }
    }

    fn invalidate_profile_reset(&self, generation: u64) {
        if self
            .inner
            .profile_generation
            .compare_exchange(
                generation,
                generation.saturating_add(1),
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
        {
            self.set_profile_ready(false);
        }
    }

    fn set_handler_ready(&self, ready: bool) {
        self.inner.handler_ready.store(ready, Ordering::SeqCst);
        if !ready {
            self.reset_gate();
        }
    }

    fn decide(
        &self,
        kind: PermissionKind,
        origin: Option<&str>,
        now: Instant,
    ) -> PermissionDecision {
        let profile_ready = self.inner.profile_ready.load(Ordering::SeqCst)
            && self.inner.handler_ready.load(Ordering::SeqCst);
        self.inner
            .gate
            .lock()
            .map(|mut gate| gate.decide(kind, origin, now, profile_ready))
            .unwrap_or(PermissionDecision::Deny)
    }
}

async fn log_permission(app: &AppHandle, level: &str, message: &str, operation_id: &str) {
    let _ = super::write_log(
        app,
        "speech-permission",
        level,
        "MicrophonePermission",
        message,
        Some(operation_id),
    )
    .await;
}

fn spawn_permission_log(app: AppHandle, message: &'static str) {
    tauri::async_runtime::spawn(async move {
        log_permission(&app, "error", message, "voice-startup").await;
    });
}

#[cfg(windows)]
fn normalized_origin(uri: &str) -> Option<String> {
    let url = reqwest::Url::parse(uri).ok()?;
    let host = url.host_str()?;
    let port = url
        .port()
        .map(|value| format!(":{value}"))
        .unwrap_or_default();
    Some(format!(
        "{}://{}{}",
        url.scheme().to_ascii_lowercase(),
        host.to_ascii_lowercase(),
        port
    ))
}

#[cfg(windows)]
fn microphone_default_permission_state(
) -> webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_STATE {
    webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_STATE_DEFAULT
}

#[cfg(windows)]
fn begin_profile_reset(
    platform: tauri::webview::PlatformWebview,
    completed: Box<dyn FnOnce(bool) + 'static>,
) -> Result<(), String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        },
        SetPermissionStateCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};

    let controller = platform.controller();
    let core = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
    let core13: ICoreWebView2_13 = core.cast().map_err(|error| error.to_string())?;
    let profile = unsafe { core13.Profile() }.map_err(|error| error.to_string())?;
    let profile4: ICoreWebView2Profile4 = profile.cast().map_err(|error| error.to_string())?;
    let handler = SetPermissionStateCompletedHandler::create(Box::new(move |result| {
        completed(result.is_ok());
        Ok(())
    }));
    unsafe {
        profile4.SetPermissionState(
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            &HSTRING::from(FLUXORA_WEBVIEW_ORIGIN),
            microphone_default_permission_state(),
            &handler,
        )
    }
    .map_err(|error| error.to_string())
}

#[cfg(windows)]
pub(crate) fn configure_main_webview(app: &AppHandle) {
    use webview2_com::{
        take_pwstr,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2PermissionRequestedEventArgs3, COREWEBVIEW2_PERMISSION_KIND,
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            COREWEBVIEW2_PERMISSION_STATE_DENY,
        },
        PermissionRequestedEventHandler,
    };
    use windows::core::{Interface, PWSTR};

    let state = app.state::<MicrophonePermissionState>().inner().clone();
    let profile_generation = state.start_profile_reset();
    state.set_handler_ready(false);
    let Some(window) = app.get_webview_window("main") else {
        spawn_permission_log(
            app.clone(),
            "result=init-failed code=speech.permission.window-unavailable",
        );
        return;
    };
    let callback_state = state.clone();
    let callback_log_app = app.clone();
    let dispatch = window.with_webview(move |platform| {
        let result = (|| -> Result<(), String> {
            let controller = platform.controller();
            let core = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
            let event_state = callback_state.clone();
            let event_log_app = callback_log_app.clone();
            let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                unsafe { args.PermissionKind(&mut kind)? };
                if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    return Ok(());
                }

                let args3: ICoreWebView2PermissionRequestedEventArgs3 = match args.cast() {
                    Ok(value) => value,
                    Err(_) => {
                        unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)? };
                        event_state.set_handler_ready(false);
                        spawn_permission_log(
                            event_log_app.clone(),
                            "result=denied code=speech.permission.profile-control-unavailable",
                        );
                        return Ok(());
                    }
                };
                if unsafe { args3.SetSavesInProfile(false) }.is_err() {
                    unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)? };
                    event_state.set_handler_ready(false);
                    spawn_permission_log(
                        event_log_app.clone(),
                        "result=denied code=speech.permission.profile-control-unavailable",
                    );
                    return Ok(());
                }

                let mut uri = PWSTR::null();
                let origin = if unsafe { args.Uri(&mut uri) }.is_ok() {
                    normalized_origin(&take_pwstr(uri))
                } else {
                    None
                };
                let decision = event_state.decide(
                    PermissionKind::Microphone,
                    origin.as_deref(),
                    Instant::now(),
                );
                unsafe {
                    args.SetState(match decision {
                        PermissionDecision::Allow => COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                        PermissionDecision::Deny | PermissionDecision::Untouched => {
                            COREWEBVIEW2_PERMISSION_STATE_DENY
                        }
                    })?
                };
                Ok(())
            }));
            let mut token = 0_i64;
            unsafe { core.add_PermissionRequested(&handler, &mut token) }
                .map_err(|error| error.to_string())?;
            callback_state.set_handler_ready(true);
            let profile_state = callback_state.clone();
            let profile_log_app = callback_log_app.clone();
            begin_profile_reset(
                platform,
                Box::new(move |success| {
                    profile_state.complete_profile_reset(profile_generation, success);
                    if !success {
                        spawn_permission_log(
                            profile_log_app,
                            "result=init-failed code=speech.permission.profile-reset-failed",
                        );
                    }
                }),
            )?;
            Ok(())
        })();
        if result.is_err() {
            callback_state.invalidate_profile_reset(profile_generation);
            callback_state.set_handler_ready(false);
            spawn_permission_log(
                callback_log_app,
                "result=init-failed code=speech.permission.webview2-unavailable",
            );
        }
    });
    if dispatch.is_err() {
        state.invalidate_profile_reset(profile_generation);
        state.set_handler_ready(false);
        spawn_permission_log(
            app.clone(),
            "result=init-failed code=speech.permission.webview-dispatch-failed",
        );
    }
}

#[cfg(not(windows))]
pub(crate) fn configure_main_webview(_app: &AppHandle) {}

#[tauri::command]
pub(crate) async fn fluxora_ai_arm_microphone_capture(
    app: AppHandle,
    request: MicrophonePermissionRequest,
) -> Result<(), MicrophonePermissionError> {
    if !validate_operation_id(&request.operation_id) {
        return Err(permission_error(
            "speech.request.operation-id",
            "Microphone access could not be prepared.",
            &request.operation_id,
            None,
        ));
    }
    let state = app.state::<MicrophonePermissionState>();
    if !state.arm(Instant::now()) {
        log_permission(
            &app,
            "error",
            "result=denied code=speech.permission.native-unavailable",
            &request.operation_id,
        )
        .await;
        return Err(permission_error(
            "speech.permission.native-unavailable",
            "Microphone access is temporarily unavailable.",
            &request.operation_id,
            None,
        ));
    }
    log_permission(
        &app,
        "info",
        "result=armed ttlMs=10000",
        &request.operation_id,
    )
    .await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn fluxora_ai_reset_microphone_permission(
    app: AppHandle,
    request: MicrophonePermissionRequest,
) -> Result<(), MicrophonePermissionError> {
    if !validate_operation_id(&request.operation_id) {
        return Err(permission_error(
            "speech.request.operation-id",
            "Microphone access could not be reset.",
            &request.operation_id,
            None,
        ));
    }
    let state = app.state::<MicrophonePermissionState>().inner().clone();
    state.reset_gate();
    let profile_generation = state.start_profile_reset();
    log_permission(&app, "info", "result=reset-started", &request.operation_id).await;

    #[cfg(windows)]
    {
        let Some(window) = app.get_webview_window("main") else {
            return Err(permission_error(
                "speech.permission.reset-unavailable",
                "Microphone access could not be reset.",
                &request.operation_id,
                None,
            ));
        };
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let callback_state = state.clone();
        let immediate_failure_state = state.clone();
        window
            .with_webview(move |platform| {
                let immediate = begin_profile_reset(
                    platform,
                    Box::new(move |success| {
                        callback_state.complete_profile_reset(profile_generation, success);
                        let _ = sender.send(success);
                    }),
                );
                if immediate.is_err() {
                    immediate_failure_state.invalidate_profile_reset(profile_generation);
                }
            })
            .map_err(|error| {
                permission_error(
                    "speech.permission.reset-unavailable",
                    "Microphone access could not be reset.",
                    &request.operation_id,
                    Some(error.to_string()),
                )
            })?;
        let success = tokio::time::timeout(Duration::from_secs(5), receiver)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(false);
        if success {
            log_permission(&app, "info", "result=reset-complete", &request.operation_id).await;
            return Ok(());
        }
        state.invalidate_profile_reset(profile_generation);
        log_permission(
            &app,
            "error",
            "result=reset-failed code=speech.permission.reset-failed",
            &request.operation_id,
        )
        .await;
        return Err(permission_error(
            "speech.permission.reset-failed",
            "Microphone access could not be reset.",
            &request.operation_id,
            None,
        ));
    }

    #[cfg(not(windows))]
    Err(permission_error(
        "speech.permission.unsupported",
        "Microphone permission reset is unavailable on this platform.",
        &request.operation_id,
        None,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn microphone_gate_is_exact_origin_one_shot_and_ttl_bounded() {
        let now = Instant::now();
        let mut gate = MicrophoneGate::default();
        gate.arm(now);
        assert_eq!(
            gate.decide(
                PermissionKind::Microphone,
                Some(FLUXORA_WEBVIEW_ORIGIN),
                now,
                true
            ),
            PermissionDecision::Allow
        );
        assert_eq!(
            gate.decide(
                PermissionKind::Microphone,
                Some(FLUXORA_WEBVIEW_ORIGIN),
                now,
                true
            ),
            PermissionDecision::Deny
        );

        gate.arm(now);
        assert_eq!(
            gate.decide(
                PermissionKind::Microphone,
                Some("https://tauri.localhost"),
                now,
                true
            ),
            PermissionDecision::Deny
        );
        gate.arm(now);
        assert_eq!(
            gate.decide(
                PermissionKind::Microphone,
                Some(FLUXORA_WEBVIEW_ORIGIN),
                now + MICROPHONE_ARM_TTL + Duration::from_millis(1),
                true,
            ),
            PermissionDecision::Deny
        );
    }

    #[test]
    fn other_permissions_are_untouched_and_do_not_consume_the_arm() {
        let now = Instant::now();
        let mut gate = MicrophoneGate::default();
        gate.arm(now);
        assert_eq!(
            gate.decide(PermissionKind::Other, None, now, true),
            PermissionDecision::Untouched
        );
        assert_eq!(
            gate.decide(
                PermissionKind::Microphone,
                Some(FLUXORA_WEBVIEW_ORIGIN),
                now,
                true
            ),
            PermissionDecision::Allow
        );
    }

    #[test]
    fn reset_and_unready_profile_fail_closed() {
        let now = Instant::now();
        let mut gate = MicrophoneGate::default();
        gate.arm(now);
        gate.reset();
        assert_eq!(
            gate.decide(
                PermissionKind::Microphone,
                Some(FLUXORA_WEBVIEW_ORIGIN),
                now,
                true
            ),
            PermissionDecision::Deny
        );
        gate.arm(now);
        assert_eq!(
            gate.decide(
                PermissionKind::Microphone,
                Some(FLUXORA_WEBVIEW_ORIGIN),
                now,
                false
            ),
            PermissionDecision::Deny
        );

        let state = MicrophonePermissionState::default();
        state.set_handler_ready(true);
        let generation = state.start_profile_reset();
        state.invalidate_profile_reset(generation);
        state.complete_profile_reset(generation, true);
        assert!(!state.arm(now));
    }

    #[cfg(windows)]
    #[test]
    fn webview_origin_is_normalized_and_profile_reset_uses_default() {
        use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_STATE_DEFAULT;

        assert_eq!(
            normalized_origin("http://TAURI.localhost/some/path").as_deref(),
            Some(FLUXORA_WEBVIEW_ORIGIN)
        );
        assert_ne!(
            normalized_origin("https://tauri.localhost/").as_deref(),
            Some(FLUXORA_WEBVIEW_ORIGIN)
        );
        assert_eq!(
            microphone_default_permission_state(),
            COREWEBVIEW2_PERMISSION_STATE_DEFAULT
        );
    }
}
