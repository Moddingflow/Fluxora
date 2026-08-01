use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::contracts::NativeFailure;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SetupInvocation {
    Interactive,
    RepairManagerProtocol { application_path: PathBuf },
    UnregisterManagerProtocol { application_path: PathBuf },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdaterPresentation {
    Compact,
    SetupHandoff,
}

impl UpdaterPresentation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Compact => "compact",
            Self::SetupHandoff => "setup-handoff",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InstallerLanguage {
    En,
    De,
    Ru,
}

impl InstallerLanguage {
    pub fn parse(value: &OsString) -> Result<Self, NativeFailure> {
        match value.to_str() {
            Some("en") => Ok(Self::En),
            Some("de") => Ok(Self::De),
            Some("ru") => Ok(Self::Ru),
            _ => Err(NativeFailure::new(
                "updater.invalidLanguage",
                "updater.error.invalidRequest",
                false,
            )),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::En => "en",
            Self::De => "de",
            Self::Ru => "ru",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdaterInvocation {
    Interactive {
        request_path: PathBuf,
        presentation: UpdaterPresentation,
        language: Option<InstallerLanguage>,
    },
    RunOnceRecovery {
        request_path: PathBuf,
    },
    RecoveryWatchdog {
        request_path: PathBuf,
        owner_pid: u32,
        owner_start_ticks_utc: u64,
        ready_event_name: String,
    },
}

fn request_path(value: &OsString) -> Result<PathBuf, NativeFailure> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || path.as_os_str().is_empty() {
        return Err(NativeFailure::new(
            "updater.invalidRequestPath",
            "updater.error.invalidRequest",
            false,
        ));
    }
    Ok(path)
}

fn unicode_argument(value: &OsString, code: &str) -> Result<String, NativeFailure> {
    value
        .to_str()
        .filter(|value| !value.is_empty() && !value.chars().any(char::is_control))
        .map(str::to_string)
        .ok_or_else(|| NativeFailure::new(code, "updater.error.invalidRequest", false))
}

pub fn parse_updater_invocation(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<UpdaterInvocation, NativeFailure> {
    let arguments = arguments.into_iter().collect::<Vec<_>>();
    let mode = arguments
        .first()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            NativeFailure::new(
                "updater.invalidArguments",
                "updater.error.invalidRequest",
                false,
            )
        })?;
    match (mode, arguments.as_slice()) {
        ("--request", [_, path]) => Ok(UpdaterInvocation::Interactive {
            request_path: request_path(path)?,
            presentation: UpdaterPresentation::Compact,
            language: None,
        }),
        ("--request", [_, path, presentation_flag, presentation, language_flag, language])
            if presentation_flag == "--presentation"
                && presentation == "setup-handoff"
                && language_flag == "--language" =>
        {
            Ok(UpdaterInvocation::Interactive {
                request_path: request_path(path)?,
                presentation: UpdaterPresentation::SetupHandoff,
                language: Some(InstallerLanguage::parse(language)?),
            })
        }
        ("--recover-request", [_, path]) => Ok(UpdaterInvocation::RunOnceRecovery {
            request_path: request_path(path)?,
        }),
        ("--recovery-watchdog", [_, path, owner_pid, owner_ticks, ready_event]) => {
            let owner_pid = unicode_argument(owner_pid, "updater.invalidWatchdogOwnerPid")?
                .parse::<u32>()
                .ok()
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    NativeFailure::new(
                        "updater.invalidWatchdogOwnerPid",
                        "updater.error.invalidRequest",
                        false,
                    )
                })?;
            let owner_start_ticks_utc =
                unicode_argument(owner_ticks, "updater.invalidWatchdogOwnerStart")?
                    .parse::<u64>()
                    .ok()
                    .filter(|value| *value > 0)
                    .ok_or_else(|| {
                        NativeFailure::new(
                            "updater.invalidWatchdogOwnerStart",
                            "updater.error.invalidRequest",
                            false,
                        )
                    })?;
            let ready_event_name =
                unicode_argument(ready_event, "updater.invalidWatchdogReadyEvent")?;
            if ready_event_name.len() > 128 {
                return Err(NativeFailure::new(
                    "updater.invalidWatchdogReadyEvent",
                    "updater.error.invalidRequest",
                    false,
                ));
            }
            Ok(UpdaterInvocation::RecoveryWatchdog {
                request_path: request_path(path)?,
                owner_pid,
                owner_start_ticks_utc,
                ready_event_name,
            })
        }
        _ => Err(NativeFailure::new(
            "updater.invalidArguments",
            "updater.error.invalidRequest",
            false,
        )),
    }
}

pub fn parse_setup_invocation(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<SetupInvocation, NativeFailure> {
    let arguments = arguments.into_iter().collect::<Vec<_>>();
    match arguments.as_slice() {
        [] => Ok(SetupInvocation::Interactive),
        [mode, application_path]
            if mode == "--repair-manager-protocol" || mode == "--unregister-manager-protocol" =>
        {
            let application_path = request_path(application_path)?;
            if mode == "--repair-manager-protocol" {
                Ok(SetupInvocation::RepairManagerProtocol { application_path })
            } else {
                Ok(SetupInvocation::UnregisterManagerProtocol { application_path })
            }
        }
        _ => Err(NativeFailure::new(
            "setup.invalidArguments",
            "setup.error.invalidArguments",
            false,
        )),
    }
}

pub fn path_for_native(path: &Path) -> Result<&str, NativeFailure> {
    path.to_str().ok_or_else(|| {
        NativeFailure::new(
            "updater.nonUnicodePath",
            "updater.error.invalidRequest",
            false,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn absolute_request() -> OsString {
        if cfg!(windows) {
            OsString::from(r"C:\Fluxora Update\update-request.json")
        } else {
            OsString::from("/tmp/fluxora-update/update-request.json")
        }
    }

    #[test]
    fn parses_interactive_and_runonce_without_webview_ambiguity() {
        let interactive =
            parse_updater_invocation([OsString::from("--request"), absolute_request()]).unwrap();
        assert!(matches!(interactive, UpdaterInvocation::Interactive { .. }));
        let handoff = parse_updater_invocation([
            OsString::from("--request"),
            absolute_request(),
            OsString::from("--presentation"),
            OsString::from("setup-handoff"),
            OsString::from("--language"),
            OsString::from("ru"),
        ])
        .unwrap();
        assert!(matches!(
            handoff,
            UpdaterInvocation::Interactive {
                presentation: UpdaterPresentation::SetupHandoff,
                language: Some(InstallerLanguage::Ru),
                ..
            }
        ));
        let recovery =
            parse_updater_invocation([OsString::from("--recover-request"), absolute_request()])
                .unwrap();
        assert!(matches!(
            recovery,
            UpdaterInvocation::RunOnceRecovery { .. }
        ));
    }

    #[test]
    fn parses_the_strict_watchdog_identity_contract() {
        let watchdog = parse_updater_invocation([
            OsString::from("--recovery-watchdog"),
            absolute_request(),
            OsString::from("42"),
            OsString::from("638896320000000000"),
            OsString::from("Local\\FluxoraUpdateWatchdog-deadbeef"),
        ])
        .unwrap();
        assert!(matches!(
            watchdog,
            UpdaterInvocation::RecoveryWatchdog {
                owner_pid: 42,
                owner_start_ticks_utc: 638896320000000000,
                ..
            }
        ));
    }

    #[test]
    fn rejects_relative_paths_and_malformed_watchdog_fields() {
        assert!(parse_updater_invocation([
            OsString::from("--request"),
            OsString::from("update-request.json"),
        ])
        .is_err());
        assert!(parse_updater_invocation([
            OsString::from("--request"),
            absolute_request(),
            OsString::from("--presentation"),
            OsString::from("setup-handoff"),
            OsString::from("--language"),
            OsString::from("fr"),
        ])
        .is_err());
        assert!(parse_updater_invocation([
            OsString::from("--request"),
            absolute_request(),
            OsString::from("--language"),
            OsString::from("en"),
            OsString::from("--presentation"),
            OsString::from("setup-handoff"),
        ])
        .is_err());
        assert!(parse_updater_invocation([
            OsString::from("--recovery-watchdog"),
            absolute_request(),
            OsString::from("0"),
            OsString::from("1"),
            OsString::from("Local\\ready"),
        ])
        .is_err());
    }

    #[test]
    fn setup_protocol_modes_are_strict_and_headless() {
        let application = if cfg!(windows) {
            OsString::from(r"C:\Users\Test\AppData\Local\Programs\Fluxora\Fluxora.exe")
        } else {
            OsString::from("/opt/fluxora/Fluxora")
        };
        assert_eq!(
            parse_setup_invocation(std::iter::empty()).unwrap(),
            SetupInvocation::Interactive
        );
        assert!(matches!(
            parse_setup_invocation([
                OsString::from("--repair-manager-protocol"),
                application.clone()
            ])
            .unwrap(),
            SetupInvocation::RepairManagerProtocol { .. }
        ));
        assert!(matches!(
            parse_setup_invocation([OsString::from("--unregister-manager-protocol"), application])
                .unwrap(),
            SetupInvocation::UnregisterManagerProtocol { .. }
        ));
        assert!(parse_setup_invocation([OsString::from("--repair-manager-protocol")]).is_err());
    }
}
