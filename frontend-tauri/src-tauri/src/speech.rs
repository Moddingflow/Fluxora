use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration, Instant};

const FRAME_MAGIC: &[u8; 4] = b"FLXS";
const FRAME_VERSION: u16 = 1;
const SAMPLE_RATE_HZ: usize = 16_000;
const MIN_SAMPLES: usize = 4_000;
const MAX_SAMPLES: usize = SAMPLE_RATE_HZ * 5 * 60;
const MAX_RESTARTS: usize = 1;
const PREPARE_TIMEOUT: Duration = Duration::from_secs(180);
const MIN_TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const HOST_RESET_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CONTEXT_HINTS: usize = 96;
const MAX_CONTEXT_HINT_CHARS: usize = 96;
const MAX_CONTEXT_HINT_TOTAL_CHARS: usize = 4_096;
const MAX_CONTEXT_HINT_HEADER_BYTES: usize = 12_288;

fn transcription_timeout(duration_ms: u64) -> Duration {
    let scaled_ms = duration_ms.saturating_mul(3).saturating_add(5_000);
    Duration::from_millis(scaled_ms).clamp(MIN_TRANSCRIBE_TIMEOUT, MAX_TRANSCRIBE_TIMEOUT)
}

#[derive(Default)]
pub(crate) struct SpeechHostState {
    processes: Mutex<SpeechHostProcesses>,
    cancelled_operations: Mutex<HashSet<String>>,
    active_process_id: AtomicU32,
}

struct SpeechHostProcesses {
    vulkan: SpeechHostProcess,
    cpu: SpeechHostProcess,
    selected_backend: Option<VoiceBackend>,
}

impl Default for SpeechHostProcesses {
    fn default() -> Self {
        Self {
            vulkan: SpeechHostProcess::new(VoiceBackend::Vulkan),
            cpu: SpeechHostProcess::new(VoiceBackend::Cpu),
            selected_backend: None,
        }
    }
}

struct SpeechHostProcess {
    backend: VoiceBackend,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    request_sequence: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoicePrepareRequest {
    operation_id: String,
}

#[derive(Debug, Clone)]
struct VoiceMetadata {
    operation_id: String,
    sample_rate_hz: u32,
    channel_count: u32,
    duration_ms: u64,
    completion_mode: String,
    language: String,
    context_hints: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum VoiceBackend {
    Vulkan,
    Cpu,
}

impl VoiceBackend {
    fn as_str(self) -> &'static str {
        match self {
            Self::Vulkan => "vulkan",
            Self::Cpu => "cpu",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceError {
    code: String,
    user_message: String,
    stage: String,
    operation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    debug_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostVoiceError {
    code: String,
    message: String,
    retryable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceStatus {
    operation_id: String,
    ready: bool,
    warmed: bool,
    health: String,
    model_version: String,
    glossary_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<VoiceError>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceTranscriptionResult {
    operation_id: String,
    transcript: String,
    detected_language: Option<String>,
    backend: VoiceBackend,
    model_version: String,
    glossary_version: String,
    duration_ms: u64,
    processing_time_ms: u64,
    no_speech: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostVoiceStatus {
    operation_id: String,
    ready: bool,
    warmed: bool,
    health: String,
    model_version: String,
    glossary_version: String,
    backend: VoiceBackend,
    threads: i32,
    model_load_time_ms: u64,
}

impl From<HostVoiceStatus> for VoiceStatus {
    fn from(value: HostVoiceStatus) -> Self {
        Self {
            operation_id: value.operation_id,
            ready: value.ready,
            warmed: value.warmed,
            health: value.health,
            model_version: value.model_version,
            glossary_version: value.glossary_version,
            error: None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostVoiceTranscriptionResult {
    operation_id: String,
    transcript: String,
    detected_language: Option<String>,
    backend: VoiceBackend,
    model_version: String,
    glossary_version: String,
    duration_ms: u64,
    processing_time_ms: u64,
    no_speech: bool,
    threads: i32,
    vad_time_ms: u64,
    inference_time_ms: u64,
    total_time_ms: u64,
    real_time_factor: f64,
    adaptive_pass_used: bool,
}

impl From<HostVoiceTranscriptionResult> for VoiceTranscriptionResult {
    fn from(value: HostVoiceTranscriptionResult) -> Self {
        Self {
            operation_id: value.operation_id,
            transcript: value.transcript,
            detected_language: value.detected_language,
            backend: value.backend,
            model_version: value.model_version,
            glossary_version: value.glossary_version,
            duration_ms: value.duration_ms,
            processing_time_ms: value.processing_time_ms,
            no_speech: value.no_speech,
        }
    }
}

fn transcription_metrics(value: &HostVoiceTranscriptionResult) -> String {
    format!(
        "backend={} threads={} modelLoadMs=0 vadMs={} inferenceMs={} totalMs={} realTimeFactor={:.4} adaptivePassUsed={}",
        value.backend.as_str(),
        value.threads,
        value.vad_time_ms,
        value.inference_time_ms,
        value.total_time_ms,
        value.real_time_factor,
        value.adaptive_pass_used
    )
}

#[derive(Debug, Deserialize)]
struct HostResponse {
    id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<HostVoiceError>,
}

#[derive(Debug)]
struct TransportError {
    code: &'static str,
}

fn voice_error_stage(code: &str) -> &'static str {
    if code.contains("permission") || code.contains("settings") {
        "permission"
    } else if code.contains("model") || code.contains("vad") || code.contains("resources") {
        "prepare"
    } else if code.contains("request") || code.contains("protocol") {
        "protocol"
    } else if code.contains("audio") {
        "capture"
    } else {
        "transcribe"
    }
}

fn safe_voice_message(code: &str) -> &'static str {
    match code {
        "speech.audio.too-short" => "The recording was too short. Try again.",
        "speech.audio.too-long" => "The recording is too long. Try a shorter message.",
        "speech.cancelled" => "Voice input was cancelled.",
        "speech.host.missing"
        | "speech.resources.missing"
        | "speech.model.corrupt"
        | "speech.model.hash-mismatch"
        | "speech.vad.corrupt"
        | "speech.vad.hash-mismatch" => {
            "Local voice resources are unavailable. Repair or reinstall Fluxora."
        }
        "speech.no-speech" => "No speech was detected. Try again.",
        _ => "Voice input could not be completed. Try again.",
    }
}

fn voice_error(code: &str, debug_message: &str, _retryable: bool) -> VoiceError {
    VoiceError {
        code: code.to_string(),
        user_message: safe_voice_message(code).to_string(),
        stage: voice_error_stage(code).to_string(),
        operation_id: String::new(),
        debug_message: (!debug_message.trim().is_empty()).then(|| debug_message.to_string()),
    }
}

fn operation_voice_error(
    code: &str,
    debug_message: &str,
    retryable: bool,
    operation_id: &str,
) -> VoiceError {
    voice_error(code, debug_message, retryable).with_operation(operation_id)
}

impl VoiceError {
    fn with_operation(mut self, operation_id: &str) -> Self {
        self.operation_id = operation_id.to_string();
        self
    }
}

impl HostVoiceError {
    fn into_voice_error(self, operation_id: &str) -> VoiceError {
        voice_error(&self.code, &self.message, self.retryable).with_operation(operation_id)
    }
}

fn header_value(
    headers: &tauri::http::HeaderMap,
    name: &'static str,
) -> Result<String, VoiceError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            voice_error(
                "speech.request.metadata",
                "Voice transcription metadata is incomplete.",
                false,
            )
        })
}

fn parse_u64_header(
    headers: &tauri::http::HeaderMap,
    name: &'static str,
) -> Result<u64, VoiceError> {
    header_value(headers, name)?.parse::<u64>().map_err(|_| {
        voice_error(
            "speech.request.metadata",
            "Voice transcription metadata is invalid.",
            false,
        )
    })
}

fn validate_operation_id(operation_id: &str) -> Result<(), VoiceError> {
    if operation_id.len() > 160
        || !operation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
    {
        return Err(voice_error(
            "speech.request.operation-id",
            "Voice operation id is invalid.",
            false,
        ));
    }
    Ok(())
}

fn decode_percent_encoded(value: &str) -> Result<String, VoiceError> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err(voice_error(
                "speech.request.metadata",
                "Voice transcription context is invalid.",
                false,
            ));
        }
        let hex = |byte: u8| match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        };
        let high = hex(bytes[index + 1]);
        let low = hex(bytes[index + 2]);
        let (Some(high), Some(low)) = (high, low) else {
            return Err(voice_error(
                "speech.request.metadata",
                "Voice transcription context is invalid.",
                false,
            ));
        };
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).map_err(|_| {
        voice_error(
            "speech.request.metadata",
            "Voice transcription context is invalid.",
            false,
        )
    })
}

fn parse_context_hints(headers: &tauri::http::HeaderMap) -> Result<Vec<String>, VoiceError> {
    let Some(encoded) = headers
        .get("x-fluxora-context-hints")
        .and_then(|value| value.to_str().ok())
    else {
        return Ok(Vec::new());
    };
    if encoded.len() > MAX_CONTEXT_HINT_HEADER_BYTES {
        return Err(voice_error(
            "speech.request.metadata",
            "Voice transcription context is too large.",
            false,
        ));
    }
    let decoded = decode_percent_encoded(encoded)?;
    let hints: Vec<String> = serde_json::from_str(&decoded).map_err(|_| {
        voice_error(
            "speech.request.metadata",
            "Voice transcription context is invalid.",
            false,
        )
    })?;
    let total_characters = hints.iter().map(|hint| hint.chars().count()).sum::<usize>();
    if hints.len() > MAX_CONTEXT_HINTS
        || total_characters > MAX_CONTEXT_HINT_TOTAL_CHARS
        || hints.iter().any(|hint| {
            let characters = hint.chars().count();
            !(2..=MAX_CONTEXT_HINT_CHARS).contains(&characters)
                || !hint.bytes().any(|byte| byte.is_ascii_alphabetic())
                || hint.chars().any(char::is_control)
        })
    {
        return Err(voice_error(
            "speech.request.metadata",
            "Voice transcription context is invalid.",
            false,
        ));
    }
    Ok(hints)
}

fn parse_voice_metadata(
    headers: &tauri::http::HeaderMap,
    pcm_len: usize,
) -> Result<VoiceMetadata, VoiceError> {
    if pcm_len % std::mem::size_of::<f32>() != 0 {
        return Err(voice_error(
            "speech.audio.format",
            "Voice PCM must use f32le samples.",
            false,
        ));
    }
    let sample_count = pcm_len / std::mem::size_of::<f32>();
    if sample_count < MIN_SAMPLES {
        return Err(voice_error(
            "speech.audio.too-short",
            "The voice recording is too short.",
            false,
        ));
    }
    if sample_count > MAX_SAMPLES {
        return Err(voice_error(
            "speech.audio.too-long",
            "The voice recording exceeds five minutes.",
            false,
        ));
    }

    let operation_id = header_value(headers, "x-fluxora-operation-id")?;
    validate_operation_id(&operation_id)?;
    let sample_rate_hz = parse_u64_header(headers, "x-fluxora-sample-rate-hz")? as u32;
    let channel_count = parse_u64_header(headers, "x-fluxora-channel-count")? as u32;
    let duration_ms = parse_u64_header(headers, "x-fluxora-duration-ms")?;
    let completion_mode = header_value(headers, "x-fluxora-completion-mode")?.to_ascii_lowercase();
    let language = header_value(headers, "x-fluxora-language")?.to_ascii_lowercase();
    let context_hints = parse_context_hints(headers)?;
    if sample_rate_hz != SAMPLE_RATE_HZ as u32
        || channel_count != 1
        || !matches!(completion_mode.as_str(), "draft" | "send")
        || !matches!(language.as_str(), "auto" | "en" | "ru" | "de")
    {
        return Err(voice_error(
            "speech.request.metadata",
            "Voice transcription metadata is unsupported.",
            false,
        ));
    }
    let measured_duration_ms = sample_count as u64 * 1_000 / SAMPLE_RATE_HZ as u64;
    if duration_ms.abs_diff(measured_duration_ms) > 1 {
        return Err(voice_error(
            "speech.audio.duration",
            "Voice duration does not match the PCM payload.",
            false,
        ));
    }
    Ok(VoiceMetadata {
        operation_id,
        sample_rate_hz,
        channel_count,
        duration_ms,
        completion_mode,
        language,
        context_hints,
    })
}

fn speech_host_name(backend: VoiceBackend) -> &'static str {
    match (backend, cfg!(windows)) {
        (VoiceBackend::Vulkan, true) => "FluxoraSpeechHostVulkan.exe",
        (VoiceBackend::Vulkan, false) => "FluxoraSpeechHostVulkan",
        (VoiceBackend::Cpu, true) => "FluxoraSpeechHost.exe",
        (VoiceBackend::Cpu, false) => "FluxoraSpeechHost",
    }
}

fn speech_cargo_name(backend: VoiceBackend) -> &'static str {
    match (backend, cfg!(windows)) {
        (VoiceBackend::Vulkan, true) => "fluxora_speech_host_vulkan.exe",
        (VoiceBackend::Vulkan, false) => "fluxora_speech_host_vulkan",
        (VoiceBackend::Cpu, true) => "fluxora_speech_host.exe",
        (VoiceBackend::Cpu, false) => "fluxora_speech_host",
    }
}

fn push_unique(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
}

fn host_candidates(app: &AppHandle, backend: VoiceBackend) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let override_name = match backend {
        VoiceBackend::Vulkan => "FLUXORA_SPEECH_VULKAN_HOST_PATH",
        VoiceBackend::Cpu => "FLUXORA_SPEECH_HOST_PATH",
    };
    if let Some(path) = std::env::var_os(override_name) {
        push_unique(&mut candidates, PathBuf::from(path));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        push_unique(
            &mut candidates,
            resource_dir.join("native").join(speech_host_name(backend)),
        );
        push_unique(
            &mut candidates,
            resource_dir
                .join("resources")
                .join("native")
                .join(speech_host_name(backend)),
        );
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(root) = executable.parent() {
            push_unique(
                &mut candidates,
                root.join("resources")
                    .join("native")
                    .join(speech_host_name(backend)),
            );
            push_unique(
                &mut candidates,
                root.join("native").join(speech_host_name(backend)),
            );
        }
    }
    if let Ok(current_dir) = std::env::current_dir() {
        for root in [
            current_dir.clone(),
            current_dir.parent().unwrap_or(&current_dir).to_path_buf(),
            current_dir
                .parent()
                .and_then(Path::parent)
                .unwrap_or(&current_dir)
                .to_path_buf(),
        ] {
            for profile in ["release", "debug"] {
                push_unique(
                    &mut candidates,
                    root.join("frontend-tauri")
                        .join("src-tauri")
                        .join("target")
                        .join(profile)
                        .join(speech_cargo_name(backend)),
                );
                push_unique(
                    &mut candidates,
                    root.join("src-tauri")
                        .join("target")
                        .join(profile)
                        .join(speech_cargo_name(backend)),
                );
                push_unique(
                    &mut candidates,
                    root.join("target")
                        .join(profile)
                        .join(speech_cargo_name(backend)),
                );
            }
        }
    }
    candidates
}

fn resource_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("FLUXORA_SPEECH_RESOURCE_DIR") {
        push_unique(&mut candidates, PathBuf::from(path));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        push_unique(&mut candidates, resource_dir.join("speech"));
        push_unique(
            &mut candidates,
            resource_dir.join("resources").join("speech"),
        );
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(root) = executable.parent() {
            push_unique(&mut candidates, root.join("resources").join("speech"));
            push_unique(&mut candidates, root.join("speech"));
        }
    }
    if let Ok(current_dir) = std::env::current_dir() {
        for root in [
            current_dir.clone(),
            current_dir.parent().unwrap_or(&current_dir).to_path_buf(),
            current_dir
                .parent()
                .and_then(Path::parent)
                .unwrap_or(&current_dir)
                .to_path_buf(),
        ] {
            push_unique(
                &mut candidates,
                root.join("frontend-tauri")
                    .join("src-tauri")
                    .join("resources")
                    .join("speech"),
            );
            push_unique(
                &mut candidates,
                root.join("src-tauri").join("resources").join("speech"),
            );
        }
    }
    candidates
}

async fn first_existing(
    candidates: Vec<PathBuf>,
    code: &str,
    message: &str,
) -> Result<PathBuf, VoiceError> {
    for candidate in candidates {
        if tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return Ok(candidate);
        }
    }
    Err(voice_error(code, message, false))
}

impl SpeechHostProcess {
    fn new(backend: VoiceBackend) -> Self {
        Self {
            backend,
            child: None,
            stdin: None,
            stdout: None,
            request_sequence: 0,
        }
    }

    async fn reset(&mut self, active_process_id: &AtomicU32) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
            let _ = timeout(HOST_RESET_TIMEOUT, child.wait()).await;
        }
        self.stdin = None;
        self.stdout = None;
        active_process_id.store(0, Ordering::SeqCst);
    }

    async fn ensure_started(
        &mut self,
        app: &AppHandle,
        active_process_id: &AtomicU32,
        deadline: Instant,
    ) -> Result<(), TransportError> {
        if self.child.is_some() && self.stdin.is_some() && self.stdout.is_some() {
            return Ok(());
        }
        let host = first_existing(
            host_candidates(app, self.backend),
            "speech.host.missing",
            "FluxoraSpeechHost is missing from the installation.",
        )
        .await
        .map_err(|_| TransportError {
            code: "speech.host.missing",
        })?;
        let resources = first_existing(
            resource_candidates(app),
            "speech.resources.missing",
            "Bundled local speech models are missing from the installation.",
        )
        .await
        .map_err(|_| TransportError {
            code: "speech.resources.missing",
        })?;
        let mut command = Command::new(host);
        command
            .arg("--resource-dir")
            .arg(resources)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(crate::CREATE_NO_WINDOW);
        let mut child = command.spawn().map_err(|_| TransportError {
            code: "speech.host.start",
        })?;
        let process_id = child.id().unwrap_or_default();
        let stdin = child.stdin.take().ok_or(TransportError {
            code: "speech.host.start",
        })?;
        let stdout = child.stdout.take().ok_or(TransportError {
            code: "speech.host.start",
        })?;
        let mut stdout = BufReader::new(stdout);
        let mut handshake = String::new();
        let handshake_timeout = deadline
            .checked_duration_since(Instant::now())
            .filter(|remaining| !remaining.is_zero())
            .map(|remaining| remaining.min(Duration::from_secs(10)))
            .ok_or(TransportError {
                code: "speech.host.timeout",
            })?;
        timeout(handshake_timeout, stdout.read_line(&mut handshake))
            .await
            .map_err(|_| TransportError {
                code: "speech.host.handshake-timeout",
            })?
            .map_err(|_| TransportError {
                code: "speech.host.handshake",
            })?;
        let handshake: Value =
            serde_json::from_str(handshake.trim()).map_err(|_| TransportError {
                code: "speech.host.handshake",
            })?;
        if handshake.get("schema").and_then(Value::as_str) != Some("fluxora.speech.handshake.v1") {
            return Err(TransportError {
                code: "speech.host.handshake",
            });
        }
        if handshake.get("backend").and_then(Value::as_str) != Some(self.backend.as_str()) {
            return Err(TransportError {
                code: "speech.host.handshake",
            });
        }
        self.child = Some(child);
        self.stdin = Some(stdin);
        self.stdout = Some(stdout);
        active_process_id.store(process_id, Ordering::SeqCst);
        Ok(())
    }

    async fn request(
        &mut self,
        app: &AppHandle,
        active_process_id: &AtomicU32,
        method: &str,
        operation_id: &str,
        metadata: Value,
        pcm: &[u8],
        deadline: Instant,
    ) -> Result<HostResponse, TransportError> {
        self.ensure_started(app, active_process_id, deadline)
            .await?;
        self.request_sequence = self.request_sequence.saturating_add(1);
        let id = format!("speech-{}", self.request_sequence);
        let header = serde_json::to_vec(&json!({
            "schema": "fluxora.speech.request.v1",
            "id": id,
            "method": method,
            "operationId": operation_id,
            "metadata": metadata
        }))
        .map_err(|_| TransportError {
            code: "speech.protocol.serialize",
        })?;
        let mut prefix = Vec::with_capacity(20);
        prefix.extend_from_slice(FRAME_MAGIC);
        prefix.extend_from_slice(&FRAME_VERSION.to_le_bytes());
        prefix.extend_from_slice(&0_u16.to_le_bytes());
        prefix.extend_from_slice(&(header.len() as u32).to_le_bytes());
        prefix.extend_from_slice(&(pcm.len() as u64).to_le_bytes());
        let stdin = self.stdin.as_mut().ok_or(TransportError {
            code: "speech.host.crashed",
        })?;
        stdin.write_all(&prefix).await.map_err(|_| TransportError {
            code: "speech.host.crashed",
        })?;
        stdin.write_all(&header).await.map_err(|_| TransportError {
            code: "speech.host.crashed",
        })?;
        stdin.write_all(pcm).await.map_err(|_| TransportError {
            code: "speech.host.crashed",
        })?;
        stdin.flush().await.map_err(|_| TransportError {
            code: "speech.host.crashed",
        })?;
        let stdout = self.stdout.as_mut().ok_or(TransportError {
            code: "speech.host.crashed",
        })?;
        let mut line = String::new();
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|value| !value.is_zero())
            .ok_or(TransportError {
                code: "speech.host.timeout",
            })?;
        let bytes = timeout(remaining, stdout.read_line(&mut line))
            .await
            .map_err(|_| TransportError {
                code: "speech.host.timeout",
            })?
            .map_err(|_| TransportError {
                code: "speech.host.crashed",
            })?;
        if bytes == 0 {
            return Err(TransportError {
                code: "speech.host.crashed",
            });
        }
        let response: HostResponse =
            serde_json::from_str(line.trim()).map_err(|_| TransportError {
                code: "speech.protocol.response",
            })?;
        if response.id != id {
            return Err(TransportError {
                code: "speech.protocol.response",
            });
        }
        Ok(response)
    }
}

async fn operation_cancelled(state: &SpeechHostState, operation_id: &str) -> bool {
    state
        .cancelled_operations
        .lock()
        .await
        .contains(operation_id)
}

fn force_cpu_backend() -> bool {
    std::env::var("FLUXORA_SPEECH_FORCE_CPU")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

fn is_vulkan_fallback_error(error: &HostVoiceError) -> bool {
    error.code.starts_with("speech.gpu.")
}

fn should_try_cpu_fallback(
    backend: VoiceBackend,
    cancelled: bool,
    failure_is_fallback_eligible: bool,
) -> bool {
    backend == VoiceBackend::Vulkan && !cancelled && failure_is_fallback_eligible
}

fn cancelled_voice_error(operation_id: &str) -> VoiceError {
    operation_voice_error(
        "speech.cancelled",
        "Voice transcription was cancelled.",
        false,
        operation_id,
    )
}

async fn host_request(
    app: &AppHandle,
    method: &str,
    operation_id: &str,
    metadata: Value,
    pcm: &[u8],
    deadline: Duration,
) -> Result<Value, VoiceError> {
    let state = app.state::<SpeechHostState>();
    state.cancelled_operations.lock().await.remove(operation_id);
    let absolute_deadline = Instant::now() + deadline;
    let mut backend = {
        let processes = state.processes.lock().await;
        if force_cpu_backend() {
            VoiceBackend::Cpu
        } else {
            processes.selected_backend.unwrap_or(VoiceBackend::Vulkan)
        }
    };
    let mut cpu_restarts = 0;
    let mut prepare_before_request = {
        let processes = state.processes.lock().await;
        method == "transcribe" && processes.selected_backend != Some(backend)
    };

    loop {
        if Instant::now() >= absolute_deadline {
            state.cancelled_operations.lock().await.remove(operation_id);
            return Err(operation_voice_error(
                "speech.host.timeout",
                "Local voice recognition timed out.",
                true,
                operation_id,
            ));
        }
        if operation_cancelled(&state, operation_id).await {
            state.cancelled_operations.lock().await.remove(operation_id);
            return Err(cancelled_voice_error(operation_id));
        }
        let response = {
            let mut processes = state.processes.lock().await;
            let process = match backend {
                VoiceBackend::Vulkan => &mut processes.vulkan,
                VoiceBackend::Cpu => &mut processes.cpu,
            };
            let prepared = if prepare_before_request {
                Some(
                    process
                        .request(
                            app,
                            &state.active_process_id,
                            "prepare",
                            operation_id,
                            json!({}),
                            &[],
                            absolute_deadline,
                        )
                        .await,
                )
            } else {
                None
            };
            match prepared {
                Some(Ok(response)) if !response.ok => Ok(response),
                Some(Err(error)) => Err(error),
                _ => {
                    process
                        .request(
                            app,
                            &state.active_process_id,
                            method,
                            operation_id,
                            metadata.clone(),
                            pcm,
                            absolute_deadline,
                        )
                        .await
                }
            }
        };
        match response {
            Ok(response) if response.ok => {
                state.processes.lock().await.selected_backend = Some(backend);
                state.cancelled_operations.lock().await.remove(operation_id);
                return response.result.ok_or_else(|| {
                    operation_voice_error(
                        "speech.protocol.response",
                        "The speech host returned an empty response.",
                        true,
                        operation_id,
                    )
                });
            }
            Ok(response) => {
                let error = response.error.unwrap_or(HostVoiceError {
                    code: "speech.host.failed".to_string(),
                    message: "The local speech host failed.".to_string(),
                    retryable: true,
                });
                let cancelled = operation_cancelled(&state, operation_id).await;
                if cancelled {
                    state.cancelled_operations.lock().await.remove(operation_id);
                    return Err(cancelled_voice_error(operation_id));
                }
                if should_try_cpu_fallback(backend, cancelled, is_vulkan_fallback_error(&error)) {
                    let mut processes = state.processes.lock().await;
                    processes.vulkan.reset(&state.active_process_id).await;
                    processes.selected_backend = Some(VoiceBackend::Cpu);
                    drop(processes);
                    if operation_cancelled(&state, operation_id).await {
                        state.cancelled_operations.lock().await.remove(operation_id);
                        return Err(cancelled_voice_error(operation_id));
                    }
                    backend = VoiceBackend::Cpu;
                    prepare_before_request = method == "transcribe";
                    continue;
                }
                state.cancelled_operations.lock().await.remove(operation_id);
                return Err(error.into_voice_error(operation_id));
            }
            Err(transport) => {
                {
                    let mut processes = state.processes.lock().await;
                    match backend {
                        VoiceBackend::Vulkan => {
                            processes.vulkan.reset(&state.active_process_id).await
                        }
                        VoiceBackend::Cpu => processes.cpu.reset(&state.active_process_id).await,
                    }
                }
                if operation_cancelled(&state, operation_id).await {
                    state.cancelled_operations.lock().await.remove(operation_id);
                    return Err(cancelled_voice_error(operation_id));
                }
                if transport.code == "speech.host.timeout" {
                    state.cancelled_operations.lock().await.remove(operation_id);
                    return Err(operation_voice_error(
                        "speech.host.timeout",
                        "Local voice recognition timed out.",
                        true,
                        operation_id,
                    ));
                }
                if backend == VoiceBackend::Vulkan {
                    state.processes.lock().await.selected_backend = Some(VoiceBackend::Cpu);
                    backend = VoiceBackend::Cpu;
                    prepare_before_request = method == "transcribe";
                    continue;
                }
                if cpu_restarts < MAX_RESTARTS {
                    cpu_restarts += 1;
                    prepare_before_request = method == "transcribe";
                    continue;
                }
                state.cancelled_operations.lock().await.remove(operation_id);
                return match transport.code {
                    "speech.host.missing" => Err(operation_voice_error(
                        "speech.host.missing",
                        "FluxoraSpeechHost is missing from the installation.",
                        false,
                        operation_id,
                    )),
                    "speech.resources.missing" => Err(operation_voice_error(
                        "speech.resources.missing",
                        "Bundled local speech models are missing from the installation.",
                        false,
                        operation_id,
                    )),
                    "speech.protocol.serialize" => Err(operation_voice_error(
                        "speech.protocol.serialize",
                        "The speech request could not be serialized.",
                        false,
                        operation_id,
                    )),
                    _ => Err(operation_voice_error(
                        "speech.host.repeated-crash",
                        &format!(
                            "The local CPU speech host failed twice ({}).",
                            transport.code
                        ),
                        false,
                        operation_id,
                    )),
                };
            }
        }
    }
}

async fn log_speech(
    app: &AppHandle,
    level: &str,
    category: &str,
    message: &str,
    operation_id: &str,
) {
    let _ = super::write_log(app, "speech", level, category, message, Some(operation_id)).await;
}

#[tauri::command]
pub(crate) async fn fluxora_ai_prepare_voice(
    app: AppHandle,
    request: VoicePrepareRequest,
) -> Result<VoiceStatus, VoiceError> {
    validate_operation_id(&request.operation_id)
        .map_err(|error| error.with_operation(&request.operation_id))?;
    log_speech(
        &app,
        "info",
        "SpeechPrepare",
        "modelLoad requested",
        &request.operation_id,
    )
    .await;
    let value = host_request(
        &app,
        "prepare",
        &request.operation_id,
        json!({}),
        &[],
        PREPARE_TIMEOUT,
    )
    .await;
    match value {
        Ok(value) => {
            let host_status = serde_json::from_value::<HostVoiceStatus>(value).map_err(|_| {
                operation_voice_error(
                    "speech.protocol.response",
                    "The speech status response is invalid.",
                    true,
                    &request.operation_id,
                )
            })?;
            log_speech(
                &app,
                "info",
                "SpeechPrepare",
                &format!(
                    "backend={} threads={} modelLoadMs={} warmed={}",
                    host_status.backend.as_str(),
                    host_status.threads,
                    host_status.model_load_time_ms,
                    host_status.warmed
                ),
                &request.operation_id,
            )
            .await;
            Ok(host_status.into())
        }
        Err(error) => {
            log_speech(
                &app,
                "error",
                "SpeechPrepare",
                &format!("errorCode={}", error.code),
                &request.operation_id,
            )
            .await;
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn fluxora_ai_transcribe_voice(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<VoiceTranscriptionResult, VoiceError> {
    let operation_id = request
        .headers()
        .get("x-fluxora-operation-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("voice-unknown")
        .to_string();
    let pcm = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => {
            return Err(operation_voice_error(
                "speech.request.raw-required",
                "Voice PCM must use raw IPC.",
                false,
                &operation_id,
            ))
        }
    };
    let metadata = parse_voice_metadata(request.headers(), pcm.len())
        .map_err(|error| error.with_operation(&operation_id))?;
    log_speech(
        &app,
        "info",
        "SpeechTranscription",
        "request=start",
        &metadata.operation_id,
    )
    .await;
    let value = host_request(
        &app,
        "transcribe",
        &metadata.operation_id,
        json!({
            "sampleRateHz": metadata.sample_rate_hz,
            "channelCount": metadata.channel_count,
            "durationMs": metadata.duration_ms,
            "completionMode": metadata.completion_mode,
            "language": metadata.language,
            "contextHints": metadata.context_hints
        }),
        &pcm,
        transcription_timeout(metadata.duration_ms),
    )
    .await;
    match value {
        Ok(value) => {
            let host_result = serde_json::from_value::<HostVoiceTranscriptionResult>(value)
                .map_err(|_| {
                    operation_voice_error(
                        "speech.protocol.response",
                        "The speech transcription response is invalid.",
                        true,
                        &metadata.operation_id,
                    )
                })?;
            log_speech(
                &app,
                "info",
                "SpeechTranscription",
                &transcription_metrics(&host_result),
                &metadata.operation_id,
            )
            .await;
            Ok(host_result.into())
        }
        Err(error) => {
            log_speech(
                &app,
                "error",
                "SpeechTranscription",
                &format!("errorCode={}", error.code),
                &metadata.operation_id,
            )
            .await;
            Err(error)
        }
    }
}

fn terminate_process(process_id: u32) {
    if process_id == 0 {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill.exe")
            .args(["/PID", &process_id.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &process_id.to_string()])
            .status();
    }
}

#[tauri::command]
pub(crate) async fn fluxora_ai_cancel_voice_transcription(
    app: AppHandle,
    operation_id: String,
) -> Result<(), VoiceError> {
    validate_operation_id(&operation_id).map_err(|error| error.with_operation(&operation_id))?;
    let state = app.state::<SpeechHostState>();
    state
        .cancelled_operations
        .lock()
        .await
        .insert(operation_id.clone());
    let process_id = state.active_process_id.load(Ordering::SeqCst);
    tokio::task::spawn_blocking(move || terminate_process(process_id))
        .await
        .map_err(|_| {
            operation_voice_error(
                "speech.cancel.failed",
                "Voice transcription could not be cancelled.",
                true,
                &operation_id,
            )
        })?;
    log_speech(
        &app,
        "info",
        "SpeechCancellation",
        "cancelled=true",
        &operation_id,
    )
    .await;
    Ok(())
}

#[tauri::command]
pub(crate) fn fluxora_ai_open_microphone_privacy_settings() -> Result<(), VoiceError> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:privacy-microphone")
            .spawn()
            .map_err(|_| {
                operation_voice_error(
                    "speech.settings.open",
                    "Windows microphone privacy settings could not be opened.",
                    true,
                    "voice-settings",
                )
            })?;
        return Ok(());
    }
    #[cfg(not(windows))]
    Err(operation_voice_error(
        "speech.settings.unsupported",
        "Microphone privacy settings are available only on Windows in voice input v1.",
        false,
        "voice-settings",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::{HeaderMap, HeaderValue};

    fn headers(duration_ms: u64) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in [
            ("x-fluxora-operation-id", "voice-operation-1".to_string()),
            ("x-fluxora-sample-rate-hz", "16000".to_string()),
            ("x-fluxora-channel-count", "1".to_string()),
            ("x-fluxora-duration-ms", duration_ms.to_string()),
            ("x-fluxora-completion-mode", "send".to_string()),
            ("x-fluxora-language", "auto".to_string()),
        ] {
            headers.insert(name, HeaderValue::from_str(&value).unwrap());
        }
        headers
    }

    #[test]
    fn raw_pcm_accepts_exactly_five_minutes_and_rejects_one_extra_sample() {
        let exact = parse_voice_metadata(&headers(300_000), MAX_SAMPLES * 4).unwrap();
        assert_eq!(exact.duration_ms, 300_000);
        assert_eq!(exact.language, "auto");
        let extra = parse_voice_metadata(&headers(300_000), (MAX_SAMPLES + 1) * 4).unwrap_err();
        assert_eq!(extra.code, "speech.audio.too-long");
    }

    #[test]
    fn raw_pcm_rejects_short_invalid_and_mismatched_payloads() {
        assert_eq!(
            parse_voice_metadata(&headers(1), 3).unwrap_err().code,
            "speech.audio.format"
        );
        assert_eq!(
            parse_voice_metadata(&headers(1), (MIN_SAMPLES - 1) * 4)
                .unwrap_err()
                .code,
            "speech.audio.too-short"
        );
        assert_eq!(
            parse_voice_metadata(&headers(999), MIN_SAMPLES * 4)
                .unwrap_err()
                .code,
            "speech.audio.duration"
        );
    }

    #[test]
    fn raw_pcm_accepts_auto_and_explicit_compatibility_languages() {
        for language in ["auto", "ru", "en", "de"] {
            let mut compatible = headers(250);
            compatible.insert(
                "x-fluxora-language",
                HeaderValue::from_str(language).unwrap(),
            );
            assert_eq!(
                parse_voice_metadata(&compatible, MIN_SAMPLES * 4)
                    .unwrap()
                    .language,
                language
            );
        }

        let mut unsupported = headers(250);
        unsupported.insert("x-fluxora-language", HeaderValue::from_static("fr"));

        assert_eq!(
            parse_voice_metadata(&unsupported, MIN_SAMPLES * 4)
                .unwrap_err()
                .code,
            "speech.request.metadata"
        );
    }

    #[test]
    fn raw_pcm_decodes_bounded_multilingual_context_hints() {
        let mut contextual = headers(250);
        contextual.insert(
            "x-fluxora-context-hints",
            HeaderValue::from_static(
                "%5B%22No%20Grass%20In%20Objects%22%2C%22GrassControl.ini%22%5D",
            ),
        );

        let metadata = parse_voice_metadata(&contextual, MIN_SAMPLES * 4).unwrap();

        assert_eq!(
            metadata.context_hints,
            ["No Grass In Objects", "GrassControl.ini"]
        );
    }

    #[test]
    fn host_crash_policy_allows_exactly_one_restart() {
        assert_eq!(MAX_RESTARTS, 1);
    }

    #[test]
    fn transcription_timeout_is_short_for_short_audio_and_bounded_for_long_audio() {
        assert_eq!(transcription_timeout(2_744), Duration::from_secs(15));
        assert_eq!(transcription_timeout(300_000), Duration::from_secs(5 * 60));
        assert_eq!(HOST_RESET_TIMEOUT, Duration::from_secs(5));
    }

    #[test]
    fn renderer_error_keeps_technical_detail_out_of_the_user_message() {
        let error = operation_voice_error(
            "speech.host.repeated-crash",
            "secret host path and transport details",
            false,
            "voice-operation-1",
        );
        assert!(!error.user_message.contains("secret"));
        assert_eq!(error.stage, "transcribe");
        assert_eq!(error.operation_id, "voice-operation-1");
        assert_eq!(
            error.debug_message.as_deref(),
            Some("secret host path and transport details")
        );
    }

    #[test]
    fn vulkan_failures_fall_back_to_cpu_but_cancellation_never_does() {
        let gpu_error = HostVoiceError {
            code: "speech.gpu.initialization".to_string(),
            message: String::new(),
            retryable: true,
        };
        let model_error = HostVoiceError {
            code: "speech.model.hash-mismatch".to_string(),
            message: String::new(),
            retryable: false,
        };

        assert!(should_try_cpu_fallback(
            VoiceBackend::Vulkan,
            false,
            is_vulkan_fallback_error(&gpu_error)
        ));
        assert!(!should_try_cpu_fallback(
            VoiceBackend::Vulkan,
            true,
            is_vulkan_fallback_error(&gpu_error)
        ));
        assert!(!should_try_cpu_fallback(
            VoiceBackend::Vulkan,
            false,
            is_vulkan_fallback_error(&model_error)
        ));
        assert!(!should_try_cpu_fallback(VoiceBackend::Cpu, false, true));
    }

    #[test]
    fn backend_host_names_keep_the_cpu_binary_gpu_dependency_free() {
        assert_eq!(speech_host_name(VoiceBackend::Cpu), "FluxoraSpeechHost.exe");
        assert_eq!(
            speech_host_name(VoiceBackend::Vulkan),
            "FluxoraSpeechHostVulkan.exe"
        );
        assert_ne!(
            speech_cargo_name(VoiceBackend::Cpu),
            speech_cargo_name(VoiceBackend::Vulkan)
        );
    }

    #[test]
    fn speech_metrics_never_include_transcript_or_detected_language() {
        let result = HostVoiceTranscriptionResult {
            operation_id: "voice-operation-1".to_string(),
            transcript: "secret spoken content".to_string(),
            detected_language: Some("secret-language".to_string()),
            backend: VoiceBackend::Vulkan,
            model_version: "small-q5_1".to_string(),
            glossary_version: "2.0.0".to_string(),
            duration_ms: 30_000,
            processing_time_ms: 1_250,
            no_speech: false,
            threads: 8,
            vad_time_ms: 10,
            inference_time_ms: 1_200,
            total_time_ms: 1_250,
            real_time_factor: 0.0417,
            adaptive_pass_used: true,
        };

        let metrics = transcription_metrics(&result);
        assert!(metrics.contains("backend=vulkan"));
        assert!(metrics.contains("threads=8"));
        assert!(metrics.contains("adaptivePassUsed=true"));
        assert!(!metrics.contains("secret spoken content"));
        assert!(!metrics.contains("secret-language"));
    }
}
