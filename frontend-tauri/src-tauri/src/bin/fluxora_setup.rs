#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "../installer_shell/contracts.rs"]
mod contracts;
#[path = "../installer_shell/invocation.rs"]
mod invocation;
#[path = "../installer_shell/native.rs"]
mod native;
#[path = "../installer_shell/post_install_update.rs"]
mod post_install_update;
#[path = "../installer_shell/setup_embedded_assets.rs"]
mod setup_embedded_assets;
#[path = "../installer_shell/setup_runtime.rs"]
mod setup_runtime;
#[path = "../update_manifest.rs"]
mod update_manifest;
#[path = "../update_shared.rs"]
mod update_shared;
#[path = "../installer_shell/webview2_bootstrap.rs"]
mod webview2_bootstrap;

#[cfg(feature = "setup-production-assets")]
fn setup_payload_expanded_bytes() -> u64 {
    env!("FLUXORA_SETUP_PAYLOAD_EXPANDED_BYTES")
        .parse()
        .expect("build.rs must validate the trusted expanded Setup payload size")
}

#[cfg(not(feature = "setup-production-assets"))]
fn setup_payload_expanded_bytes() -> u64 {
    0
}

fn main() {
    let embedded_assets = match setup_embedded_assets::load() {
        Ok(assets) => assets,
        Err(_) => std::process::exit(4),
    };
    let invocation = match invocation::parse_setup_invocation(std::env::args_os().skip(1)) {
        Ok(invocation) => invocation,
        Err(_) => std::process::exit(2),
    };
    match invocation {
        invocation::SetupInvocation::RepairManagerProtocol { application_path } => {
            let application_path = match invocation::path_for_native(&application_path) {
                Ok(path) => path,
                Err(_) => std::process::exit(2),
            };
            std::process::exit(
                if native::NativeInstaller::repair_manager_protocol(application_path).is_ok() {
                    0
                } else {
                    3
                },
            );
        }
        invocation::SetupInvocation::UnregisterManagerProtocol { application_path } => {
            let application_path = match invocation::path_for_native(&application_path) {
                Ok(path) => path,
                Err(_) => std::process::exit(2),
            };
            std::process::exit(
                if native::NativeInstaller::unregister_manager_protocol(application_path).is_ok() {
                    0
                } else {
                    3
                },
            );
        }
        invocation::SetupInvocation::Interactive => {}
    }
    let webview2_version =
        match webview2_bootstrap::ensure_webview2(&webview2_bootstrap::PreWebViewAssets {
            bootstrapper: embedded_assets.webview2_bootstrapper,
        }) {
            Ok(version) => version,
            Err(()) => return,
        };
    setup_runtime::run_setup(
        setup_runtime::EmbeddedSetupRuntimeAssets {
            payload: embedded_assets.payload,
            expanded_payload_bytes: setup_payload_expanded_bytes(),
        },
        webview2_version,
    )
    .expect("Fluxora Setup native shell failed");
}

#[cfg(all(test, feature = "setup-production-assets"))]
mod production_asset_tests {
    use super::*;

    #[test]
    fn production_assets_are_complete_and_bound_to_the_static_native_core() {
        let assets = setup_embedded_assets::load()
            .expect("production Setup resources must be linked into FluxoraSetup.exe");
        assert!(
            cfg!(feature = "installer-native"),
            "production Setup assets require the adjacent static native binding"
        );
        assert!(!assets.payload.is_empty());
        assert!(setup_payload_expanded_bytes() > 0);
        assert_ne!(
            setup_payload_expanded_bytes(),
            assets.payload.len() as u64,
            "trusted expanded bytes must not fall back to compressed payload length"
        );
        assert!(
            webview2_bootstrap::is_pinned_bootstrapper(assets.webview2_bootstrapper),
            "embedded WebView2 bootstrapper must match the pinned Microsoft artifact"
        );
    }
}
