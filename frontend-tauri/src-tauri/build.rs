use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[path = "src/installer_shell/setup_resource_ids.rs"]
mod setup_resource_ids;

const WEBVIEW2_BOOTSTRAPPER_LENGTH: u64 = 1_691_856;
const WEBVIEW2_BOOTSTRAPPER_SHA256: &str =
    "0223fa1e8d5bd5e4344fb8734e60d088e79f262c0a24444d01f240bc996f04e5";

fn required_file_from_env(variable: &str) -> PathBuf {
    println!("cargo:rerun-if-env-changed={variable}");
    let value = env::var_os(variable)
        .unwrap_or_else(|| panic!("{variable} must point to an absolute release input file"));
    let path = PathBuf::from(value);
    assert!(
        path.is_absolute(),
        "{variable} must be an absolute path, got {}",
        path.display()
    );
    assert!(
        path.is_file(),
        "{variable} does not point to a file: {}",
        path.display()
    );
    let canonical = fs::canonicalize(&path)
        .unwrap_or_else(|error| panic!("failed to resolve {variable}: {error}"));
    println!("cargo:rerun-if-changed={}", canonical.display());
    canonical
}

fn sha256_hex(path: &Path) -> String {
    let bytes =
        fs::read(path).unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    format!("{:x}", Sha256::digest(bytes))
}

fn resource_script_path(path: &Path) -> String {
    let path = path
        .to_str()
        .unwrap_or_else(|| panic!("setup resource path is not Unicode: {}", path.display()));
    assert!(
        !path.contains(['"', '\r', '\n']),
        "setup resource path contains an unsupported resource-script character: {}",
        path
    );
    path.replace('\\', "/")
}

fn compile_setup_resources(payload: &Path, bootstrapper: &Path) {
    let out_dir = PathBuf::from(
        env::var_os("OUT_DIR").expect("Cargo must define OUT_DIR for the Setup resource build"),
    );
    let resource_script = out_dir.join("fluxora_setup_assets.rc");
    let source = format!(
        "#pragma code_page(65001)\n{} {} \"{}\"\n{} {} \"{}\"\n",
        setup_resource_ids::SETUP_PAYLOAD_RESOURCE_ID,
        setup_resource_ids::WINDOWS_RCDATA_RESOURCE_TYPE,
        resource_script_path(payload),
        setup_resource_ids::WEBVIEW2_BOOTSTRAPPER_RESOURCE_ID,
        setup_resource_ids::WINDOWS_RCDATA_RESOURCE_TYPE,
        resource_script_path(bootstrapper),
    );
    fs::write(&resource_script, source).unwrap_or_else(|error| {
        panic!(
            "failed to write Setup resource script {}: {error}",
            resource_script.display()
        )
    });
    embed_resource::compile_for(&resource_script, ["FluxoraSetup"], embed_resource::NONE)
        .manifest_required()
        .unwrap_or_else(|error| {
            panic!("failed to compile required Setup RCDATA resources: {error}")
        });
}

fn configure_setup_assets() {
    if env::var_os("CARGO_FEATURE_SETUP_PRODUCTION_ASSETS").is_none() {
        return;
    }

    let payload = required_file_from_env("FLUXORA_SETUP_PAYLOAD_PATH");
    let bootstrapper = required_file_from_env("FLUXORA_WEBVIEW2_BOOTSTRAPPER_PATH");
    println!("cargo:rerun-if-env-changed=FLUXORA_SETUP_PAYLOAD_EXPANDED_BYTES");
    let expanded_payload_bytes = env::var("FLUXORA_SETUP_PAYLOAD_EXPANDED_BYTES")
        .ok()
        .filter(|value| {
            !value.is_empty()
                && value.bytes().all(|byte| byte.is_ascii_digit())
                && !value.starts_with('0')
        })
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or_else(|| {
            panic!("FLUXORA_SETUP_PAYLOAD_EXPANDED_BYTES must be a positive canonical decimal u64")
        });
    let payload_length = fs::metadata(&payload)
        .unwrap_or_else(|error| panic!("failed to inspect setup payload: {error}"))
        .len();
    assert!(payload_length > 0, "setup payload must not be empty");
    let bootstrapper_length = fs::metadata(&bootstrapper)
        .unwrap_or_else(|error| panic!("failed to inspect WebView2 bootstrapper: {error}"))
        .len();
    assert_eq!(
        bootstrapper_length, WEBVIEW2_BOOTSTRAPPER_LENGTH,
        "WebView2 bootstrapper length does not match the pinned Microsoft artifact"
    );
    assert_eq!(
        sha256_hex(&bootstrapper),
        WEBVIEW2_BOOTSTRAPPER_SHA256,
        "WebView2 bootstrapper SHA-256 does not match the pinned Microsoft artifact"
    );
    assert!(
        payload_length <= u32::MAX as u64,
        "setup payload exceeds the Windows RCDATA size limit"
    );

    compile_setup_resources(&payload, &bootstrapper);
    println!("cargo:rustc-env=FLUXORA_SETUP_PAYLOAD_EXPANDED_BYTES={expanded_payload_bytes}");
}

fn configure_installer_static_link() {
    if env::var_os("CARGO_FEATURE_INSTALLER_NATIVE").is_none() {
        return;
    }

    println!("cargo:rerun-if-env-changed=FLUXORA_INSTALLER_CORE_LIB_DIR");
    let directory = env::var_os("FLUXORA_INSTALLER_CORE_LIB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            panic!(
                "FLUXORA_INSTALLER_CORE_LIB_DIR must point to the directory containing FluxoraInstallerCore.lib"
            )
        });
    assert!(
        directory.is_absolute() && directory.is_dir(),
        "FLUXORA_INSTALLER_CORE_LIB_DIR must be an existing absolute directory"
    );
    let library = directory.join("FluxoraInstallerCore.lib");
    assert!(
        library.is_file(),
        "FluxoraInstallerCore.lib is missing from {}",
        directory.display()
    );
    println!("cargo:rerun-if-changed={}", library.display());
    println!("cargo:rustc-link-search=native={}", directory.display());
    println!("cargo:rustc-link-lib=static=FluxoraInstallerCore");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        for library in [
            "bcrypt", "crypt32", "advapi32", "ole32", "shell32", "user32", "version",
        ] {
            println!("cargo:rustc-link-lib=dylib={library}");
        }
    }
}

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!(
            "cargo:rustc-link-arg-bin=FluxoraSetup=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    if std::env::var_os("CARGO_FEATURE_NATIVE_AI_INTEGRATION_FIXTURE").is_some() {
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    configure_setup_assets();
    configure_installer_static_link();
    tauri_build::build()
}
