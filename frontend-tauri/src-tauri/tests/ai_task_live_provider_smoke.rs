#![cfg(feature = "native-ai-integration-fixture")]

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
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
            "fluxora-live-ai-smoke-{}-{suffix}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create live smoke root");
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

    fn remove(name: &'static str) -> Self {
        let previous = std::env::var_os(name);
        std::env::remove_var(name);
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

fn bridge_host_path() -> PathBuf {
    if let Some(path) = std::env::var_os("FLUXORA_BRIDGE_HOST_PATH") {
        return PathBuf::from(path);
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
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
    if std::env::var("FLUXORA_AI_LIVE_PROVIDER_SMOKE").as_deref() != Ok("1") {
        eprintln!("Skipped live Gemini smoke; set FLUXORA_AI_LIVE_PROVIDER_SMOKE=1 to opt in.");
        return;
    }

    let fixture = TempFixture::new();
    let game = fixture.path.join("Game");
    let install_root = fixture.path.join("Builds");
    std::fs::create_dir_all(game.join("Data")).expect("create game data");
    std::fs::write(game.join("SkyrimSE.exe"), b"MZ").expect("write game executable");
    std::fs::write(game.join("Data").join("Skyrim.esm"), b"master").expect("write game master");
    let archive_source = fixture.path.join("ArchiveContent");
    let archive_path = fixture.path.join("AI Live Smoke Mod.zip");
    let archive_plugin_directory = archive_source.join("SKSE").join("Plugins");
    std::fs::create_dir_all(&archive_plugin_directory).expect("create archive source");
    std::fs::write(
        archive_plugin_directory.join("AILiveSmoke.ini"),
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
    assert!(archive_status.success(), "create live AI smoke archive");

    let bridge = bridge_host_path();
    assert!(
        bridge.is_file(),
        "build the Release BridgeHost first: {}",
        bridge.display()
    );
    let real_ai_host = PathBuf::from(env!("CARGO_BIN_EXE_fluxora_ai_host"));
    assert!(real_ai_host.is_file(), "real Fluxora AI host was not built");

    let _app_data = EnvGuard::set("APPDATA", fixture.path.join("AppData"));
    let _bridge = EnvGuard::set("FLUXORA_BRIDGE_HOST_PATH", &bridge);
    let _provider = EnvGuard::set("FLUXORA_AI_HOST_PATH", &real_ai_host);
    let _mock_override = EnvGuard::remove("FLUXORA_AI_TEST_GATEWAY_URL");

    let result =
        fluxora_tauri_lib::run_native_ai_integration_fixture(&game, &install_root, &archive_path)
            .expect("live Gemini evidence-first NGIO smoke");
    let ngio_response = result
        .pointer("/ngioEvidenceFirst/response")
        .expect("live NGIO response");
    let ngio_status = ngio_response
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(
        matches!(ngio_status, "done" | "needs-input"),
        "live NGIO smoke must either verify a managed override or ask one evidence-based settings question: {ngio_response}"
    );
    assert!(
        ngio_response
            .pointer("/fileToolDiagnostics/newEvidenceCount")
            .and_then(Value::as_u64)
            .is_some_and(|count| count > 0),
        "live NGIO smoke must inspect the temporary build before finishing"
    );
    let bridge_methods = result
        .pointer("/ngioEvidenceFirst/bridgeMethods")
        .and_then(Value::as_array)
        .expect("live NGIO bridge trace");
    assert!(bridge_methods
        .iter()
        .any(|method| method == "buildFiles.search"));
    assert!(bridge_methods
        .iter()
        .any(|method| method == "buildFiles.readText"));
    if ngio_status == "done" {
        assert!(
            ngio_response
                .pointer("/fileToolDiagnostics/verifiedMutations")
                .and_then(Value::as_u64)
                .is_some_and(|count| count > 0),
            "a completed live NGIO smoke requires native verification"
        );
        assert_eq!(
            result
                .pointer("/ngioEvidenceFirst/overrideExistsAfterRollback")
                .and_then(Value::as_bool),
            Some(false),
            "the temporary live managed override must be rolled back"
        );
    } else {
        let question = ngio_response
            .pointer("/execution/pendingQuestion")
            .and_then(Value::as_str)
            .or_else(|| ngio_response.get("text").and_then(Value::as_str))
            .expect("live NGIO settings question");
        assert!(
            question.contains("Use-grass-cache")
                || question.contains("Only-load-from-cache")
                || question.to_lowercase().contains("кэш"),
            "the live question must be about the inspected settings: {question}"
        );
        assert!(!question.to_ascii_lowercase().contains("path"));
        assert!(!question.to_lowercase().contains("путь"));
    }
}
