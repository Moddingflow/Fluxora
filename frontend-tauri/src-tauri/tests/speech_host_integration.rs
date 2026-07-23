use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

const FRAME_MAGIC: &[u8; 4] = b"FLXS";

fn write_frame(writer: &mut impl Write, header: Value, pcm: &[u8]) {
    let header = serde_json::to_vec(&header).expect("serialize speech request");
    writer.write_all(FRAME_MAGIC).expect("write magic");
    writer
        .write_all(&1_u16.to_le_bytes())
        .expect("write version");
    writer
        .write_all(&0_u16.to_le_bytes())
        .expect("write reserved");
    writer
        .write_all(&(header.len() as u32).to_le_bytes())
        .expect("write header size");
    writer
        .write_all(&(pcm.len() as u64).to_le_bytes())
        .expect("write pcm size");
    writer.write_all(&header).expect("write header");
    writer.write_all(pcm).expect("write pcm");
    writer.flush().expect("flush frame");
}

fn read_response(reader: &mut impl BufRead) -> Value {
    let mut line = String::new();
    reader.read_line(&mut line).expect("read speech response");
    serde_json::from_str(line.trim()).expect("parse speech response")
}

#[test]
fn fake_engine_exercises_framing_warmup_vad_and_glossary_without_logging_content() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_fluxora_speech_host"))
        .arg("--fake-engine")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn speech host");
    let mut stdin = child.stdin.take().expect("speech stdin");
    let mut stdout = BufReader::new(child.stdout.take().expect("speech stdout"));

    let handshake = read_response(&mut stdout);
    assert_eq!(handshake["schema"], "fluxora.speech.handshake.v1");
    assert_eq!(handshake["warmed"], false);
    assert_eq!(handshake["backend"], "cpu");

    write_frame(
        &mut stdin,
        json!({
            "schema": "fluxora.speech.request.v1",
            "id": "prepare-1",
            "method": "prepare",
            "operationId": "voice-operation-1",
            "metadata": {}
        }),
        &[],
    );
    let prepared = read_response(&mut stdout);
    assert_eq!(prepared["ok"], true);
    assert_eq!(prepared["result"]["warmed"], true);

    let pcm = [0.25_f32; 4_000]
        .into_iter()
        .flat_map(f32::to_le_bytes)
        .collect::<Vec<_>>();
    write_frame(
        &mut stdin,
        json!({
            "schema": "fluxora.speech.request.v1",
            "id": "transcribe-1",
            "method": "transcribe",
            "operationId": "voice-operation-1",
            "metadata": {
                "durationMs": 250,
                "language": "auto",
                "fakeDetectedLanguage": "de",
                "fakeTranscript": "flux ora, em oh zwei und ladereihenfolge"
            }
        }),
        &pcm,
    );
    let transcript = read_response(&mut stdout);
    assert_eq!(transcript["ok"], true);
    assert_eq!(
        transcript["result"]["transcript"],
        "Fluxora, MO2 und Ladereihenfolge"
    );
    assert_eq!(transcript["result"]["noSpeech"], false);
    assert_eq!(transcript["result"]["detectedLanguage"], "de");
    assert_eq!(transcript["result"]["backend"], "cpu");

    write_frame(
        &mut stdin,
        json!({
            "schema": "fluxora.speech.request.v1",
            "id": "contextual-transcribe-1",
            "method": "transcribe",
            "operationId": "voice-operation-context-1",
            "metadata": {
                "durationMs": 250,
                "language": "auto",
                "contextHints": ["Custom Grass Preset"],
                "fakeDetectedLanguage": "ru",
                "fakeTranscript": "включи custom grass preset"
            }
        }),
        &pcm,
    );
    let contextual = read_response(&mut stdout);
    assert_eq!(contextual["ok"], true);
    assert_eq!(
        contextual["result"]["transcript"],
        "включи Custom Grass Preset"
    );

    let silence = vec![0_u8; 4_000 * 4];
    write_frame(
        &mut stdin,
        json!({
            "schema": "fluxora.speech.request.v1",
            "id": "silence-1",
            "method": "transcribe",
            "operationId": "voice-operation-2",
            "metadata": { "durationMs": 250, "language": "auto" }
        }),
        &silence,
    );
    let no_speech = read_response(&mut stdout);
    assert_eq!(no_speech["result"]["noSpeech"], true);
    assert_eq!(no_speech["result"]["transcript"], "");
    assert_eq!(no_speech["result"]["detectedLanguage"], Value::Null);

    write_frame(
        &mut stdin,
        json!({
            "schema": "fluxora.speech.request.v1",
            "id": "shutdown-1",
            "method": "shutdown",
            "operationId": "voice-operation-3",
            "metadata": {}
        }),
        &[],
    );
    assert_eq!(read_response(&mut stdout)["ok"], true);
    drop(stdin);
    let status = child.wait().expect("wait for speech host");
    assert!(status.success());
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .expect("speech stderr")
        .read_to_string(&mut stderr)
        .expect("read speech stderr");
    assert!(
        stderr.is_empty(),
        "speech host must not log PCM or transcript: {stderr}"
    );
}

fn prepare_real_engine(binary: &Path, expected_backend: &str) {
    let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("speech");
    assert!(
        resource_dir.join("manifest.json").is_file(),
        "stage the bundled speech resources before running this integration test"
    );
    let mut child = Command::new(binary)
        .arg("--resource-dir")
        .arg(&resource_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn real speech host");
    let mut stdin = child.stdin.take().expect("speech stdin");
    let mut stdout = BufReader::new(child.stdout.take().expect("speech stdout"));

    let handshake = read_response(&mut stdout);
    assert_eq!(handshake["schema"], "fluxora.speech.handshake.v1");
    assert_eq!(handshake["backend"], expected_backend);
    write_frame(
        &mut stdin,
        json!({
            "schema": "fluxora.speech.request.v1",
            "id": "prepare-real-1",
            "method": "prepare",
            "operationId": "voice-real-prepare-1",
            "metadata": {}
        }),
        &[],
    );

    let mut response_line = String::new();
    let response_bytes = stdout
        .read_line(&mut response_line)
        .expect("read real speech prepare response");
    if response_bytes == 0 {
        drop(stdin);
        let status = child.wait().expect("wait for crashed real speech host");
        let mut stderr = String::new();
        child
            .stderr
            .take()
            .expect("speech stderr")
            .read_to_string(&mut stderr)
            .expect("read speech stderr");
        panic!("real speech host exited before prepare response: status={status}, stderr={stderr}");
    }
    let prepared: Value =
        serde_json::from_str(response_line.trim()).expect("parse real speech prepare response");
    assert_eq!(prepared["ok"], true, "prepare failed: {prepared}");
    assert_eq!(prepared["result"]["warmed"], true);
    assert_eq!(prepared["result"]["backend"], expected_backend);

    let silence = vec![0_u8; 4_000 * std::mem::size_of::<f32>()];
    write_frame(
        &mut stdin,
        json!({
            "schema": "fluxora.speech.request.v1",
            "id": "silence-real-1",
            "method": "transcribe",
            "operationId": "voice-real-silence-1",
            "metadata": { "durationMs": 250, "language": "auto" }
        }),
        &silence,
    );
    let no_speech = read_response(&mut stdout);
    assert_eq!(no_speech["ok"], true, "no-speech failed: {no_speech}");
    assert_eq!(no_speech["result"]["backend"], expected_backend);
    assert_eq!(no_speech["result"]["noSpeech"], true);
    assert_eq!(no_speech["result"]["detectedLanguage"], Value::Null);

    if let Ok(pcm_path) = std::env::var("FLUXORA_TEST_SPEECH_PCM") {
        let pcm = std::fs::read(&pcm_path).expect("read configured raw f32 PCM fixture");
        assert_eq!(pcm.len() % std::mem::size_of::<f32>(), 0);
        let duration_ms = (pcm.len() / std::mem::size_of::<f32>()) as u64 * 1_000 / 16_000;
        let context_hints = std::env::var("FLUXORA_TEST_SPEECH_HINT")
            .ok()
            .into_iter()
            .collect::<Vec<_>>();
        write_frame(
            &mut stdin,
            json!({
                "schema": "fluxora.speech.request.v1",
                "id": "fixture-real-1",
                "method": "transcribe",
                "operationId": "voice-real-fixture-1",
                "metadata": {
                    "durationMs": duration_ms,
                    "language": "auto",
                    "contextHints": context_hints
                }
            }),
            &pcm,
        );
        let fixture = read_response(&mut stdout);
        assert_eq!(
            fixture["ok"], true,
            "configured fixture transcription failed"
        );
        assert_eq!(fixture["result"]["backend"], expected_backend);
        assert_eq!(fixture["result"]["noSpeech"], false);
        if let Ok(expected_language) = std::env::var("FLUXORA_TEST_SPEECH_LANGUAGE") {
            assert_eq!(fixture["result"]["detectedLanguage"], expected_language);
        }
        if let Ok(expected_text) = std::env::var("FLUXORA_TEST_SPEECH_TEXT") {
            let transcript = fixture["result"]["transcript"]
                .as_str()
                .expect("fixture transcript string");
            assert!(
                transcript
                    .to_lowercase()
                    .contains(&expected_text.to_lowercase()),
                "configured fixture transcript did not preserve the expected text: {transcript}; adaptivePassUsed={}",
                fixture["result"]["adaptivePassUsed"]
            );
        }
        let total_ms = fixture["result"]["totalTimeMs"]
            .as_u64()
            .expect("fixture total time metric");
        let rtf = fixture["result"]["realTimeFactor"]
            .as_f64()
            .expect("fixture real-time factor metric");
        println!(
            "speech fixture backend={expected_backend} durationMs={duration_ms} totalMs={total_ms} realTimeFactor={rtf:.4}"
        );
        if let Ok(max_ms) = std::env::var("FLUXORA_TEST_SPEECH_MAX_MS") {
            assert!(
                total_ms <= max_ms.parse::<u64>().expect("numeric fixture deadline"),
                "configured fixture exceeded its processing budget"
            );
        }
    }

    write_frame(
        &mut stdin,
        json!({
            "schema": "fluxora.speech.request.v1",
            "id": "shutdown-real-1",
            "method": "shutdown",
            "operationId": "voice-real-shutdown-1",
            "metadata": {}
        }),
        &[],
    );
    assert_eq!(read_response(&mut stdout)["ok"], true);
    drop(stdin);
    assert!(child.wait().expect("wait for real speech host").success());
}

#[test]
fn real_engine_prepares_bundled_models_without_crashing() {
    let configured = std::env::var("FLUXORA_TEST_CPU_SPEECH_HOST").ok();
    let binary = configured
        .as_deref()
        .map(Path::new)
        .unwrap_or_else(|| Path::new(env!("CARGO_BIN_EXE_fluxora_speech_host")));
    prepare_real_engine(binary, "cpu");
}

#[test]
fn configured_vulkan_engine_prepares_bundled_models_without_crashing() {
    let Ok(binary) = std::env::var("FLUXORA_TEST_VULKAN_SPEECH_HOST") else {
        return;
    };
    prepare_real_engine(Path::new(&binary), "vulkan");
}
