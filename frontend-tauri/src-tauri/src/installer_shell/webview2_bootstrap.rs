use sha2::{Digest, Sha256};

const PINNED_BOOTSTRAPPER_LENGTH: usize = 1_691_856;
const PINNED_BOOTSTRAPPER_SHA256: &str =
    "0223fa1e8d5bd5e4344fb8734e60d088e79f262c0a24444d01f240bc996f04e5";

pub(crate) fn is_pinned_bootstrapper(bytes: &[u8]) -> bool {
    bytes.len() == PINNED_BOOTSTRAPPER_LENGTH
        && format!("{:x}", Sha256::digest(bytes)) == PINNED_BOOTSTRAPPER_SHA256
}

pub struct PreWebViewAssets {
    pub bootstrapper: &'static [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BootstrapDecision {
    StartTauri,
    AskToInstall,
    Exit,
}

pub fn bootstrap_decision(
    webview2_available: bool,
    bootstrapper_available: bool,
    user_confirmed: bool,
) -> BootstrapDecision {
    if webview2_available {
        BootstrapDecision::StartTauri
    } else if !bootstrapper_available {
        BootstrapDecision::Exit
    } else if user_confirmed {
        BootstrapDecision::StartTauri
    } else {
        BootstrapDecision::AskToInstall
    }
}

#[cfg(windows)]
fn detect_webview2() -> Option<String> {
    use webview2_com::take_pwstr;
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    use windows::core::{PCWSTR, PWSTR};

    let mut version = PWSTR::null();
    let result =
        unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version) };
    result
        .ok()
        .map(|_| take_pwstr(version))
        .filter(|value| !value.trim().is_empty())
}

#[cfg(not(windows))]
fn detect_webview2() -> Option<String> {
    Some("platform-webview".to_string())
}

#[cfg(windows)]
pub fn initial_language() -> &'static str {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;

    let mut locale = [0_u16; 85];
    let length = unsafe { GetUserDefaultLocaleName(&mut locale) };
    if length <= 1 {
        return "en";
    }
    let value = String::from_utf16_lossy(&locale[..(length as usize - 1)]).to_ascii_lowercase();
    if value.starts_with("de") {
        "de"
    } else if value.starts_with("ru") {
        "ru"
    } else {
        "en"
    }
}

#[cfg(not(windows))]
pub fn initial_language() -> &'static str {
    "en"
}

#[cfg(windows)]
fn task_dialog(
    language: &str,
    instruction_key: &str,
    content_key: &str,
    allow_confirm: bool,
) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::UI::Controls::{
        TaskDialog, TDCBF_CANCEL_BUTTON, TDCBF_OK_BUTTON, TD_ERROR_ICON, TD_INFORMATION_ICON,
    };
    use windows::Win32::UI::WindowsAndMessaging::IDOK;

    fn localized(language: &str, key: &str) -> &'static str {
        match (language, key) {
            ("de", "missing") => "Microsoft WebView2 wird benötigt",
            ("de", "explain") => "Fluxora Setup lädt nach Ihrer Bestätigung den offiziellen Microsoft Evergreen-Bootstrapper. Microsoft erhält dabei Ihre IP-Adresse und übliche Verbindungsmetadaten.",
            ("de", "unavailable") => "Der eingebettete Microsoft-Bootstrapper ist nicht verfügbar. Installieren Sie WebView2 und starten Sie Fluxora Setup erneut.",
            ("de", "failed") => "Microsoft WebView2 konnte nicht installiert oder überprüft werden. Prüfen Sie die Netzwerkverbindung und versuchen Sie es erneut.",
            ("ru", "missing") => "Требуется Microsoft WebView2",
            ("ru", "explain") => "После подтверждения Fluxora Setup запустит официальный online Evergreen bootstrapper Microsoft. Microsoft получит ваш IP-адрес и обычные метаданные соединения.",
            ("ru", "unavailable") => "Встроенный bootstrapper Microsoft недоступен. Установите WebView2 и снова запустите Fluxora Setup.",
            ("ru", "failed") => "Не удалось установить или проверить Microsoft WebView2. Проверьте подключение к сети и повторите попытку.",
            (_, "missing") => "Microsoft WebView2 is required",
            (_, "explain") => "After you confirm, Fluxora Setup will run the official Microsoft online Evergreen bootstrapper. Microsoft will receive your IP address and ordinary connection metadata.",
            (_, "unavailable") => "The embedded Microsoft bootstrapper is unavailable. Install WebView2, then run Fluxora Setup again.",
            (_, "failed") => "Microsoft WebView2 could not be installed or verified. Check the network connection and try again.",
            _ => "Fluxora Setup cannot continue.",
        }
    }

    let title = HSTRING::from("Fluxora Setup");
    let instruction = HSTRING::from(localized(language, instruction_key));
    let content = HSTRING::from(localized(language, content_key));
    let mut pressed = 0_i32;
    let buttons = if allow_confirm {
        TDCBF_OK_BUTTON | TDCBF_CANCEL_BUTTON
    } else {
        TDCBF_OK_BUTTON
    };
    let icon = if allow_confirm {
        TD_INFORMATION_ICON
    } else {
        TD_ERROR_ICON
    };
    unsafe {
        TaskDialog(
            None,
            None,
            &title,
            &instruction,
            &content,
            buttons,
            icon,
            Some(&mut pressed),
        )
    }
    .is_ok()
        && pressed == IDOK.0
}

#[cfg(windows)]
fn verify_authenticode(path: &std::path::Path) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::Security::WinTrust::{
        WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
        WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_REVOKE_NONE,
        WTD_STATEACTION_IGNORE, WTD_UICONTEXT_INSTALL, WTD_UI_NONE,
    };

    let path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(path.as_ptr()),
        hFile: HANDLE::default(),
        pgKnownSubject: std::ptr::null_mut(),
    };
    let mut data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &mut file_info,
        },
        dwStateAction: WTD_STATEACTION_IGNORE,
        dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL,
        dwUIContext: WTD_UICONTEXT_INSTALL,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    unsafe {
        WinVerifyTrust(
            HWND::default(),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast::<c_void>(),
        ) == 0
    }
}

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
fn run_bootstrapper(bytes: &[u8]) -> bool {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::process::Command;

    if !is_pinned_bootstrapper(bytes) {
        return false;
    }
    let directory = std::env::temp_dir().join(format!(
        "Fluxora-WebView2-{}-{}",
        std::process::id(),
        &PINNED_BOOTSTRAPPER_SHA256[..12]
    ));
    if directory.exists() || fs::create_dir(&directory).is_err() {
        return false;
    }
    let executable = directory.join("MicrosoftEdgeWebview2Setup.exe");
    let written = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&executable)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        });
    if written.is_err() || !verify_authenticode(&executable) {
        let _ = fs::remove_file(&executable);
        let _ = fs::remove_dir(&directory);
        return false;
    }
    let succeeded = Command::new(&executable)
        .args(["/silent", "/install"])
        .current_dir(&directory)
        .status()
        .is_ok_and(|status| status.success());
    let _ = fs::remove_file(&executable);
    let _ = fs::remove_dir(&directory);
    succeeded
}

#[cfg(not(windows))]
fn run_bootstrapper(_bytes: &[u8]) -> bool {
    false
}

pub fn ensure_webview2(assets: &PreWebViewAssets) -> Result<Option<String>, ()> {
    if let Some(version) = detect_webview2() {
        return Ok(Some(version));
    }
    let language = initial_language();
    if assets.bootstrapper.is_empty() {
        #[cfg(windows)]
        {
            task_dialog(language, "missing", "unavailable", false);
        }
        return Err(());
    }
    #[cfg(windows)]
    if !task_dialog(language, "missing", "explain", true) {
        return Err(());
    }
    if !run_bootstrapper(assets.bootstrapper) {
        #[cfg(windows)]
        {
            task_dialog(language, "missing", "failed", false);
        }
        return Err(());
    }
    detect_webview2().map(Some).ok_or_else(|| {
        #[cfg(windows)]
        {
            task_dialog(language, "missing", "failed", false);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webview_presence_never_prompts_or_needs_embedded_assets() {
        assert_eq!(
            bootstrap_decision(true, false, false),
            BootstrapDecision::StartTauri
        );
    }

    #[test]
    fn missing_webview_fails_closed_without_the_pinned_bootstrapper() {
        assert_eq!(
            bootstrap_decision(false, false, true),
            BootstrapDecision::Exit
        );
        assert_eq!(
            bootstrap_decision(false, true, false),
            BootstrapDecision::AskToInstall
        );
    }
}
