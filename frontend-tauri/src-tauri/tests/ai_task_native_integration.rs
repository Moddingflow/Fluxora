#![cfg(feature = "native-ai-integration-fixture")]

use serde_json::json;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

struct TempFixture {
    path: PathBuf,
}

impl TempFixture {
    fn new() -> Self {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "fluxora-native-ai-integration-{}-{suffix}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create integration fixture root");
        Self { path }
    }
}

impl Drop for TempFixture {
    fn drop(&mut self) {
        if self.path.starts_with(std::env::temp_dir()) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

struct EnvGuard {
    name: &'static str,
    previous: Option<std::ffi::OsString>,
}

impl EnvGuard {
    fn set(name: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, previous }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.take() {
            std::env::set_var(self.name, previous);
        } else {
            std::env::remove_var(self.name);
        }
    }
}

struct MockGeminiGateway {
    url: String,
    stopping: Arc<AtomicBool>,
    methods: Arc<Mutex<Vec<String>>>,
    worker: Option<thread::JoinHandle<()>>,
}

fn strings_for_key(value: &Value, key: &str, output: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                strings_for_key(item, key, output);
            }
        }
        Value::Object(fields) => {
            for (field, child) in fields {
                if field == key {
                    if let Some(text) = child.as_str() {
                        output.push(text.to_string());
                    }
                }
                strings_for_key(child, key, output);
            }
        }
        _ => {}
    }
}

fn last_string(value: &Value, key: &str) -> String {
    let mut values = Vec::new();
    strings_for_key(value, key, &mut values);
    values.pop().unwrap_or_default()
}

fn function_turn(id: &str, name: &str, args: Value) -> Value {
    json!({
        "candidates": [{
            "content": {
                "role": "model",
                "parts": [{ "functionCall": { "id": id, "name": name, "args": args } }]
            }
        }],
        "usageMetadata": { "promptTokenCount": 100, "candidatesTokenCount": 20, "totalTokenCount": 120 }
    })
}

fn text_turn(text: &str) -> Value {
    json!({
        "candidates": [{ "content": { "role": "model", "parts": [{ "text": text }] } }],
        "usageMetadata": { "promptTokenCount": 100, "candidatesTokenCount": 20, "totalTokenCount": 120 }
    })
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, Value)> {
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok()?;
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let count = stream.read(&mut buffer).ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
    };
    let headers = String::from_utf8_lossy(&bytes[..header_end]).to_ascii_lowercase();
    if headers.lines().any(|line| line.trim() == "expect: 100-continue") {
        stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").ok()?;
        stream.flush().ok()?;
    }
    let content_length = headers
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or_default();
    while bytes.len() < header_end + content_length {
        let count = stream.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let method = headers
        .lines()
        .find_map(|line| line.strip_prefix("x-fluxora-ai-method:"))
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    let body = serde_json::from_slice(&bytes[header_end..header_end + content_length])
        .unwrap_or_else(|_| json!({}));
    Some((method, body))
}

fn write_http_response(stream: &mut TcpStream, body: Value) {
    let body = serde_json::to_vec(&body).expect("serialize mock Gemini response");
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

impl MockGeminiGateway {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock Gemini gateway");
        let address = listener.local_addr().expect("mock gateway address");
        let stopping = Arc::new(AtomicBool::new(false));
        let worker_stopping = stopping.clone();
        let methods = Arc::new(Mutex::new(Vec::new()));
        let worker_methods = methods.clone();
        let generation = Arc::new(Mutex::new(0_u8));
        let worker_generation = generation.clone();
        let worker = thread::spawn(move || {
            while !worker_stopping.load(Ordering::Relaxed) {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(_) => continue,
                };
                let request_methods = worker_methods.clone();
                let request_generation = worker_generation.clone();
                thread::spawn(move || {
                    let Some((method, body)) = read_http_request(&mut stream) else {
                        return;
                    };
                    request_methods
                        .lock()
                        .expect("record mock method")
                        .push(method.clone());
                    let response = match method.as_str() {
                    "" => json!({
                        "available": true,
                        "providerId": "gemini",
                        "modelId": "gemini-3.1-flash-lite"
                    }),
                    "getmodel" => json!({
                        "inputTokenLimit": 1_048_576,
                        "outputTokenLimit": 65_536
                    }),
                    "counttokens" => json!({ "totalTokens": 512 }),
                    "generatecontent" => {
                        let current = {
                            let mut generation = request_generation
                                .lock()
                                .expect("advance mock generation");
                            let current = *generation;
                            *generation = generation.saturating_add(1);
                            current
                        };
                        match current {
                            0 => text_turn("You can locate and edit the file manually."),
                            1 => function_turn(
                                "declare-goal",
                                "local_execution_declare_goal",
                                json!({
                                    "mode": "repair",
                                    "origin": "explicit",
                                    "requestedOutcome": "Set Community Shaders Menu.ToggleKey to PageDown and verify the managed override."
                                }),
                            ),
                            2 => function_turn(
                                "discover",
                                "local_files_discover",
                                json!({
                                    "scopes": ["build"],
                                    "aliases": ["Community Shaders", "CommunityShaders", "CS"],
                                    "extensions": [".json"],
                                    "configHints": ["SettingsUser.json"],
                                    "semanticKeys": ["Menu.ToggleKey"]
                                }),
                            ),
                            3 => function_turn(
                                "search-exact",
                                "local_files_search",
                                json!({
                                    "query": "Cabbage CS Preset/SKSE/Plugins/CommunityShaders/SettingsUser.json"
                                }),
                            ),
                            4 => {
                                let file_ref = last_string(&body, "fileRef");
                                function_turn(
                                    "read-range-1",
                                    "local_text_read",
                                    json!({ "fileRef": file_ref, "startLine": 1, "maxLines": 3 }),
                                )
                            }
                            5 => function_turn(
                                "read-range-2",
                                "local_text_read",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "startLine": 4,
                                    "maxLines": 3
                                }),
                            ),
                            6 => function_turn(
                                "search-toggle-text",
                                "local_text_search",
                                json!({ "query": "ToggleKey" }),
                            ),
                            7 => function_turn(
                                "query-toggle",
                                "local_json_query",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "pointer": "/Menu/ToggleKey"
                                }),
                            ),
                            8 => function_turn(
                                "inspect-recipe",
                                "local_config_inspect_recipe",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "targetPointer": "/Menu/ToggleKey",
                                    "requestedValue": "PageDown"
                                }),
                            ),
                            9 => function_turn(
                                "stage-toggle",
                                "local_json_stage_set_pointer",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "revision": last_string(&body, "indexRevision"),
                                    "baseSha256": last_string(&body, "sha256"),
                                    "pointer": "/Menu/ToggleKey",
                                    "expectedValue": last_string(&body, "currentValue"),
                                    "value": last_string(&body, "encodedValue"),
                                    "format": "json"
                                }),
                            ),
                            10 => function_turn("commit", "local_files_commit", json!({})),
                            11 => text_turn(
                                "Готово: PageDown записан и проверен в Fluxora AI Overrides.",
                            ),
                            12 => function_turn(
                                "declare-implicit-audio-goal",
                                "local_execution_declare_goal",
                                json!({
                                    "mode": "repair",
                                    "origin": "implicit",
                                    "requestedOutcome": "Reduce the painfully loud battle music using the single safe reversible build setting."
                                }),
                            ),
                            13 => function_turn(
                                "discover-audio-ini",
                                "local_files_discover",
                                json!({
                                    "scopes": ["build"],
                                    "extensions": [".ini"],
                                    "configHints": ["AudioMixer.ini"],
                                    "semanticKeys": ["BattleMusicVolume"]
                                }),
                            ),
                            14 => function_turn(
                                "search-audio-ini",
                                "local_files_search",
                                json!({ "query": "SKSE/Plugins/AudioMixer.ini" }),
                            ),
                            15 => function_turn(
                                "read-audio-ini",
                                "local_text_read",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "startLine": 1,
                                    "maxLines": 16
                                }),
                            ),
                            16 => function_turn(
                                "query-audio-volume",
                                "local_ini_query",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "section": "Audio",
                                    "key": "BattleMusicVolume"
                                }),
                            ),
                            17 => function_turn(
                                "stage-audio-volume",
                                "local_ini_stage_set_key",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "revision": last_string(&body, "indexRevision"),
                                    "baseSha256": last_string(&body, "sha256"),
                                    "section": "Audio",
                                    "key": "BattleMusicVolume",
                                    "expectedValue": "1.0",
                                    "value": "0.35",
                                    "operation": "set"
                                }),
                            ),
                            18 => function_turn("commit-audio", "local_files_commit", json!({})),
                            19 => text_turn(
                                "Done: the battle-music volume was reduced in a verified managed override.",
                            ),
                            20 => function_turn(
                                "declare-ambiguous-audio-goal",
                                "local_execution_declare_goal",
                                json!({
                                    "mode": "repair",
                                    "origin": "implicit",
                                    "requestedOutcome": "Reduce the painfully loud music after identifying which of the two plausible volume controls the user means."
                                }),
                            ),
                            21 => function_turn(
                                "discover-dual-audio-ini",
                                "local_files_discover",
                                json!({
                                    "scopes": ["build"],
                                    "extensions": [".ini"],
                                    "configHints": ["DualAudio.ini"],
                                    "semanticKeys": ["CombatVolume", "AmbientVolume"]
                                }),
                            ),
                            22 => function_turn(
                                "search-dual-audio-ini",
                                "local_files_search",
                                json!({ "query": "SKSE/Plugins/DualAudio.ini" }),
                            ),
                            23 => function_turn(
                                "read-dual-audio-ini",
                                "local_text_read",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "startLine": 1,
                                    "maxLines": 16
                                }),
                            ),
                            24 => function_turn(
                                "ask-audio-choice",
                                "local_execution_request_input",
                                json!({
                                    "question": "Should Fluxora reduce the first setting (combat music) or the second setting (ambient music)?"
                                }),
                            ),
                            25 => function_turn(
                                "continue-ambiguous-audio-goal",
                                "local_execution_declare_goal",
                                json!({
                                    "mode": "repair",
                                    "origin": "continuation",
                                    "requestedOutcome": "Reduce the first setting, combat music, and verify the reversible managed override."
                                }),
                            ),
                            26 => function_turn(
                                "rediscover-dual-audio-ini",
                                "local_files_discover",
                                json!({
                                    "scopes": ["build"],
                                    "extensions": [".ini"],
                                    "configHints": ["DualAudio.ini"],
                                    "semanticKeys": ["CombatVolume"]
                                }),
                            ),
                            27 => function_turn(
                                "research-dual-audio-exact",
                                "local_files_search",
                                json!({ "query": "SKSE/Plugins/DualAudio.ini" }),
                            ),
                            28 => function_turn(
                                "reread-dual-audio-ini",
                                "local_text_read",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "startLine": 1,
                                    "maxLines": 16
                                }),
                            ),
                            29 => function_turn(
                                "query-combat-volume",
                                "local_ini_query",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "section": "Audio",
                                    "key": "CombatVolume"
                                }),
                            ),
                            30 => function_turn(
                                "stage-combat-volume",
                                "local_ini_stage_set_key",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "revision": last_string(&body, "indexRevision"),
                                    "baseSha256": last_string(&body, "sha256"),
                                    "section": "Audio",
                                    "key": "CombatVolume",
                                    "expectedValue": "1.0",
                                    "value": "0.35",
                                    "operation": "set"
                                }),
                            ),
                            31 => function_turn("commit-combat-volume", "local_files_commit", json!({})),
                            32 => text_turn(
                                "Done: combat music was reduced and verified in the managed override.",
                            ),
                            33 => function_turn(
                                "declare-unsupported-config-goal",
                                "local_execution_declare_goal",
                                json!({
                                    "mode": "repair",
                                    "origin": "implicit",
                                    "requestedOutcome": "Correct the bad volume in the unsupported binary config if Fluxora can do so safely."
                                }),
                            ),
                            34 => function_turn(
                                "discover-unsupported-config",
                                "local_files_discover",
                                json!({
                                    "scopes": ["build"],
                                    "extensions": [".ini"],
                                    "configHints": ["UnsupportedAudio.ini"]
                                }),
                            ),
                            35 => function_turn(
                                "search-unsupported-config",
                                "local_files_search",
                                json!({ "query": "SKSE/Plugins/UnsupportedAudio.ini" }),
                            ),
                            36 => function_turn(
                                "read-unsupported-config",
                                "local_text_read",
                                json!({
                                    "fileRef": last_string(&body, "fileRef"),
                                    "startLine": 1,
                                    "maxLines": 16
                                }),
                            ),
                            _ => text_turn("This unsupported file cannot be changed safely."),
                        }
                    }
                    _ => json!({}),
                    };
                    write_http_response(&mut stream, response);
                });
            }
        });
        Self {
            url: format!("http://{address}"),
            stopping,
            methods,
            worker: Some(worker),
        }
    }

    fn recorded_methods(&self) -> Vec<String> {
        self.methods.lock().expect("read mock methods").clone()
    }
}

impl Drop for MockGeminiGateway {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(self.url.trim_start_matches("http://"));
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn bridge_host_path() -> PathBuf {
    if let Some(path) = std::env::var_os("FLUXORA_BRIDGE_HOST_PATH") {
        return PathBuf::from(path);
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .join("..")
        .join("..")
        .join("build")
        .join("backend")
        .join("Release")
        .join(if cfg!(windows) {
            "FluxoraBridgeHost.exe"
        } else {
            "FluxoraBridgeHost"
        })
}

fn main() {
    let fixture = TempFixture::new();
    let game = fixture.path.join("Game");
    let install_root = fixture.path.join("Builds");
    std::fs::create_dir_all(game.join("Data")).expect("create game data");
    std::fs::write(game.join("SkyrimSE.exe"), b"MZ").expect("write game exe");
    std::fs::write(game.join("Data").join("Skyrim.esm"), b"master").expect("write game master");
    std::fs::write(game.join("Data").join("Update.esm"), b"master").expect("write update master");
    let archive_source = fixture.path.join("ArchiveContent");
    let archive_path = fixture.path.join("AI Integration Mod.zip");
    let archive_plugin_directory = archive_source.join("SKSE").join("Plugins");
    std::fs::create_dir_all(&archive_plugin_directory).expect("create archive source");
    std::fs::write(
        archive_plugin_directory.join("AIIntegration.ini"),
        b"[Fixture]\r\nEnabled=true\r\n",
    )
    .expect("write archive source file");
    let archive_status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Compress-Archive -Path (Join-Path $env:FLUXORA_AI_ARCHIVE_SOURCE '*') -DestinationPath $env:FLUXORA_AI_ARCHIVE_PATH -Force",
        ])
        .env("FLUXORA_AI_ARCHIVE_SOURCE", &archive_source)
        .env("FLUXORA_AI_ARCHIVE_PATH", &archive_path)
        .status()
        .expect("start Compress-Archive");
    assert!(
        archive_status.success(),
        "create native AI integration archive"
    );

    let bridge = bridge_host_path();
    assert!(
        bridge.is_file(),
        "build the Release BridgeHost first: {}",
        bridge.display()
    );
    let real_ai_host = PathBuf::from(env!("CARGO_BIN_EXE_fluxora_ai_host"));
    assert!(
        real_ai_host.is_file(),
        "the real FluxoraAIHost fixture binary was not built"
    );
    let gateway = MockGeminiGateway::start();

    let _app_data = EnvGuard::set("APPDATA", fixture.path.join("AppData"));
    let app_root = fixture.path.join("AppRoot");
    std::fs::create_dir_all(&app_root).expect("create fixture app root");
    let _app_root = EnvGuard::set("FLUXORA_APP_ROOT", &app_root);
    let _bridge = EnvGuard::set("FLUXORA_BRIDGE_HOST_PATH", &bridge);
    let _provider = EnvGuard::set("FLUXORA_AI_HOST_PATH", &real_ai_host);
    let _gateway = EnvGuard::set("FLUXORA_AI_TEST_GATEWAY_URL", &gateway.url);

    let result =
        fluxora_tauri_lib::run_native_ai_integration_fixture(&game, &install_root, &archive_path)
            .unwrap_or_else(|error| {
                panic!(
                    "native AI integration fixture: {error}; mock methods: {:?}",
                    gateway.recorded_methods()
                )
            });
    assert_eq!(
        result.pointer("/response/status").and_then(Value::as_str),
        Some("done")
    );
    assert_eq!(
        result
            .pointer("/response/providerId")
            .and_then(Value::as_str),
        Some("gemini")
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/verifiedMutations")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/validationRetries")
            .and_then(Value::as_u64),
        Some(0),
        "the successful scope-less search must not consume validation retries"
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/thinkingLevel")
            .and_then(Value::as_str),
        Some("high")
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/mode")
            .and_then(Value::as_str),
        Some("repair")
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/origin")
            .and_then(Value::as_str),
        Some("explicit")
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/allowedRisk")
            .and_then(Value::as_str),
        Some("irreversible-with-confirmation")
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/searches")
            .and_then(Value::as_u64),
        Some(3)
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/nativeSessionPreopened")
            .and_then(Value::as_bool),
        Some(true),
        "a new chat must open the native session before the first Gemini round"
    );
    assert!(
        result
            .pointer("/response/fileToolDiagnostics/newEvidenceCount")
            .and_then(Value::as_u64)
            .is_some_and(|count| count >= 9),
        "every distinct search page, read range, value, stage and verification must count"
    );
    assert_eq!(
        result
            .pointer("/response/fileToolDiagnostics/stagnantResultCount")
            .and_then(Value::as_u64),
        Some(0)
    );
    assert!(
        result
            .pointer("/response/fileToolDiagnostics/phaseTransitions")
            .and_then(Value::as_array)
            .is_some_and(|transitions| !transitions.is_empty()),
        "monotonic phase transitions must remain diagnostic evidence"
    );
    assert_eq!(
        result
            .pointer("/response/fileChangeSet/files/0/verification")
            .and_then(Value::as_str),
        Some("json-pointer-matched-after-reread")
    );
    assert!(
        result
            .pointer("/response/fileChangeSet/files/0/hunks")
            .and_then(Value::as_array)
            .is_some_and(|hunks| !hunks.is_empty()),
        "native response must expose the verified diff"
    );

    let _source_path = PathBuf::from(
        result
            .get("sourcePath")
            .and_then(Value::as_str)
            .expect("source path"),
    );
    let override_path = PathBuf::from(
        result
            .get("overridePath")
            .and_then(Value::as_str)
            .expect("override path"),
    );
    let source = result
        .get("sourceContent")
        .and_then(Value::as_str)
        .expect("captured source config");
    let managed = result
        .get("managedContent")
        .and_then(Value::as_str)
        .expect("captured managed override");
    assert!(
        source.contains("\"ToggleKey\":35"),
        "source mod must remain unchanged"
    );
    assert!(
        managed.contains("\"ToggleKey\":34"),
        "managed override must contain PageDown"
    );
    assert_eq!(
        result.pointer("/rollback/state").and_then(Value::as_str),
        Some("rolled-back")
    );
    assert_eq!(
        result
            .get("overrideExistsAfterRollback")
            .and_then(Value::as_bool),
        Some(false)
    );
    assert!(
        !override_path.exists(),
        "managed override must be removed by rollback"
    );
    assert_eq!(
        result
            .pointer("/implicitAudio/response/status")
            .and_then(Value::as_str),
        Some("done")
    );
    assert_eq!(
        result
            .pointer("/implicitAudio/response/execution/mode")
            .and_then(Value::as_str),
        Some("repair")
    );
    assert_eq!(
        result
            .pointer("/implicitAudio/response/execution/origin")
            .and_then(Value::as_str),
        Some("implicit")
    );
    assert_eq!(
        result
            .pointer("/implicitAudio/response/fileToolDiagnostics/allowedRisk")
            .and_then(Value::as_str),
        Some("reversible")
    );
    assert_eq!(
        result
            .pointer("/implicitAudio/response/fileToolDiagnostics/verifiedMutations")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert!(
        result
            .pointer("/implicitAudio/sourceContent")
            .and_then(Value::as_str)
            .is_some_and(|source| source.contains("BattleMusicVolume=1.0")),
        "implicit repair must leave the source mod unchanged"
    );
    assert!(
        result
            .pointer("/implicitAudio/managedContent")
            .and_then(Value::as_str)
            .is_some_and(|managed| managed.contains("BattleMusicVolume=0.35")),
        "implicit repair must write the generic INI setting to the managed override"
    );
    assert_eq!(
        result
            .pointer("/implicitAudio/rollback/state")
            .and_then(Value::as_str),
        Some("rolled-back")
    );
    assert_eq!(
        result
            .pointer("/implicitAudio/overrideExistsAfterRollback")
            .and_then(Value::as_bool),
        Some(false)
    );
    assert_eq!(
        result
            .pointer("/ambiguousAudio/response/status")
            .and_then(Value::as_str),
        Some("needs-input"),
        "ambiguous response: {}",
        result.pointer("/ambiguousAudio/response").unwrap_or(&Value::Null)
    );
    assert_eq!(
        result
            .pointer("/ambiguousAudio/response/execution/state")
            .and_then(Value::as_str),
        Some("needs-input")
    );
    assert!(
        result
            .pointer("/ambiguousAudio/response/execution/pendingQuestion")
            .and_then(Value::as_str)
            .is_some_and(|question| question.contains("first setting") && question.contains("second setting")),
        "ambiguity must produce exactly one concrete decision question"
    );
    assert_eq!(
        result
            .pointer("/ambiguousAudio/continuationResponse/status")
            .and_then(Value::as_str),
        Some("done")
    );
    assert_eq!(
        result
            .pointer("/ambiguousAudio/continuationResponse/execution/origin")
            .and_then(Value::as_str),
        Some("continuation")
    );
    assert_eq!(
        result
            .pointer("/ambiguousAudio/response/execution/goalId")
            .and_then(Value::as_str),
        result
            .pointer("/ambiguousAudio/continuationResponse/execution/goalId")
            .and_then(Value::as_str),
        "the short answer must continue the same active goal"
    );
    assert!(
        result
            .pointer("/ambiguousAudio/sourceContent")
            .and_then(Value::as_str)
            .is_some_and(|source| source.contains("CombatVolume=1.0") && source.contains("AmbientVolume=1.0")),
        "the ambiguous source mod must remain unchanged"
    );
    assert!(
        result
            .pointer("/ambiguousAudio/managedContent")
            .and_then(Value::as_str)
            .is_some_and(|managed| managed.contains("CombatVolume=0.35") && managed.contains("AmbientVolume=1.0")),
        "the continuation must change only the selected first setting"
    );
    assert_eq!(
        result
            .pointer("/ambiguousAudio/rollback/state")
            .and_then(Value::as_str),
        Some("rolled-back")
    );
    assert_eq!(
        result
            .pointer("/ambiguousAudio/overrideExistsAfterRollback")
            .and_then(Value::as_bool),
        Some(false)
    );
    assert_eq!(
        result
            .pointer("/unsupportedConfig/response/status")
            .and_then(Value::as_str),
        Some("blocked")
    );
    assert_eq!(
        result
            .pointer("/unsupportedConfig/response/execution/terminalReason")
            .and_then(Value::as_str),
        Some("binary"),
        "unsupported response: {}",
        result.pointer("/unsupportedConfig/response").unwrap_or(&Value::Null)
    );
    assert_eq!(
        result
            .pointer("/unsupportedConfig/overrideExists")
            .and_then(Value::as_bool),
        Some(false)
    );
    assert!(
        result
            .pointer("/unsupportedConfig/response/text")
            .and_then(Value::as_str)
            .is_some_and(|text| !text.to_ascii_lowercase().contains("manually")),
        "unsupported files must return the exact blocker without manual-edit advice"
    );
    let distractor_path = PathBuf::from(
        result
            .get("distractorPath")
            .and_then(Value::as_str)
            .expect("distractor path"),
    );
    assert!(
        std::fs::read_to_string(distractor_path)
            .expect("read distractor")
            .contains("PageDown=unrelated"),
        "the unrelated INI distractor must remain unchanged"
    );
    let weak_match_path = PathBuf::from(
        result
            .get("weakMatchPath")
            .and_then(Value::as_str)
            .expect("weak match path"),
    );
    assert!(
        weak_match_path.is_file(),
        "weak discovery match must remain untouched"
    );

    let order = result
        .get("modOrder")
        .and_then(Value::as_array)
        .expect("mod order array");
    assert_eq!(
        order
            .last()
            .and_then(|item| item.get("name"))
            .and_then(Value::as_str),
        Some("Fluxora AI Overrides")
    );
    assert_eq!(
        order
            .last()
            .and_then(|item| item.get("isEnabled"))
            .and_then(Value::as_bool),
        Some(true)
    );
    for scenario in ["mod", "plugin", "install", "profile", "setting"] {
        assert_eq!(
            result
                .pointer(&format!(
                    "/capabilityScenarios/{scenario}/postconditionVerified"
                ))
                .and_then(Value::as_bool),
            Some(true),
            "{scenario} capability must verify its native effect"
        );
        assert_eq!(
            result
                .pointer(&format!(
                    "/capabilityScenarios/{scenario}/undo/postconditionVerified"
                ))
                .and_then(Value::as_bool),
            Some(true),
            "{scenario} capability Undo must verify its native compensation"
        );
    }
    assert_eq!(
        result
            .pointer("/capabilityScenarios/download/opaqueRefVerified")
            .and_then(Value::as_bool),
        Some(true),
        "download integration must expose only its opaque adapter reference"
    );
    assert_eq!(
        result
            .pointer("/capabilityScenarios/profile/conflict/result/error/code")
            .and_then(Value::as_str),
        Some("conflict")
    );
}
