#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "../installer_shell/contracts.rs"]
mod contracts;
#[path = "../installer_shell/invocation.rs"]
mod invocation;
#[path = "../installer_shell/native.rs"]
mod native;
#[path = "../installer_shell/updater_runtime.rs"]
mod updater_runtime;
#[path = "../installer_shell/webview2_bootstrap.rs"]
mod webview2_bootstrap;

use invocation::{parse_updater_invocation, path_for_native, UpdaterInvocation};
use native::NativeInstaller;

static UPDATE_PUBLIC_KEY_DER: &[u8] =
    include_bytes!("../../resources/update/stable-public-key.der");

fn run() -> Result<(), contracts::NativeFailure> {
    let updater_exe_path = std::env::current_exe().map_err(|error| {
        contracts::NativeFailure::new(
            "updater.executableUnavailable",
            "updater.error.invalidRequest",
            false,
        )
        .with_detail(error.to_string())
    })?;
    let updater_exe = path_for_native(&updater_exe_path)?;
    match parse_updater_invocation(std::env::args_os().skip(1))? {
        UpdaterInvocation::Interactive {
            request_path,
            presentation,
            language,
        } => {
            let request = path_for_native(&request_path)?;
            let mut summary = NativeInstaller::load_update_request(request, updater_exe)?;
            summary.presentation = presentation.as_str().to_string();
            summary.language = language
                .as_ref()
                .map(invocation::InstallerLanguage::as_str)
                .unwrap_or_else(webview2_bootstrap::initial_language)
                .to_string();
            updater_runtime::run_updater(
                request_path,
                updater_exe_path,
                UPDATE_PUBLIC_KEY_DER,
                summary,
            )
            .map_err(|error| {
                contracts::NativeFailure::new(
                    "updater.shellFailed",
                    "updater.error.shellFailed",
                    false,
                )
                .with_detail(error.to_string())
            })
        }
        UpdaterInvocation::RunOnceRecovery { request_path } => {
            NativeInstaller::run_recovery(path_for_native(&request_path)?, updater_exe)
        }
        UpdaterInvocation::RecoveryWatchdog {
            request_path,
            owner_pid,
            owner_start_ticks_utc,
            ready_event_name,
        } => NativeInstaller::run_recovery_watchdog(
            path_for_native(&request_path)?,
            updater_exe,
            owner_pid,
            owner_start_ticks_utc,
            &ready_event_name,
        ),
    }
}

fn main() {
    if run().is_err() {
        std::process::exit(2);
    }
}
