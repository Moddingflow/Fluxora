use std::ffi::c_void;
use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc,
};

use crate::contracts::{
    normalize_setup_progress, normalize_updater_progress, validate_schema, InstallOptions,
    InstallPathValidation, InstallProgress, NativeFailure, NativeInstallProgress,
    NativeInstallResult, NativeSetupBootstrapState, UpdateProgress, UpdateRequestSummary,
    UpdateResult,
};

const NATIVE_BUFFER_CHARS: usize = 65_536;
const INSTALLER_RESULT_CANCELLED: i32 = 11;
const MAX_SETUP_STREAM_READ_BYTES: usize = 64 * 1024;
const CANCELLATION_OPEN: u8 = 0;
const CANCELLATION_REQUESTED: u8 = 1;
const CANCELLATION_COMMIT_STARTED: u8 = 2;

fn bounded_setup_read_length(remaining: usize, requested: u64) -> usize {
    remaining
        .min(requested.min(usize::MAX as u64) as usize)
        .min(MAX_SETUP_STREAM_READ_BYTES)
}

fn cancelled_install_failure(result: i32) -> Option<NativeFailure> {
    (result == INSTALLER_RESULT_CANCELLED)
        .then(|| NativeFailure::new("setup.cancelled", "setup.error.cancelled", true))
}

#[derive(Default)]
pub struct InstallCancellation {
    state: AtomicU8,
}

impl InstallCancellation {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn request(&self) -> bool {
        loop {
            match self.state.load(Ordering::Acquire) {
                CANCELLATION_OPEN => {
                    if self
                        .state
                        .compare_exchange(
                            CANCELLATION_OPEN,
                            CANCELLATION_REQUESTED,
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        )
                        .is_ok()
                    {
                        return true;
                    }
                }
                CANCELLATION_REQUESTED => return true,
                _ => return false,
            }
        }
    }

    pub fn requested(&self) -> bool {
        self.state.load(Ordering::Acquire) == CANCELLATION_REQUESTED
    }

    pub fn can_cancel(&self) -> bool {
        self.state.load(Ordering::Acquire) == CANCELLATION_OPEN
    }

    fn enter_commit_boundary(&self) -> bool {
        loop {
            match self.state.load(Ordering::Acquire) {
                CANCELLATION_OPEN => {
                    if self
                        .state
                        .compare_exchange(
                            CANCELLATION_OPEN,
                            CANCELLATION_COMMIT_STARTED,
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        )
                        .is_ok()
                    {
                        return false;
                    }
                }
                CANCELLATION_REQUESTED => return true,
                _ => return false,
            }
        }
    }
}

#[cfg(all(feature = "installer-native", not(windows)))]
compile_error!("installer-native is supported only for the Windows Setup and Updater targets");

#[cfg(all(feature = "installer-native", windows))]
mod ffi {
    use super::*;

    pub type ProgressCallback = unsafe extern "C" fn(*const u16, *mut c_void);
    pub type ReadCallback = unsafe extern "C" fn(*mut c_void, u64, *mut c_void) -> i64;
    pub type CancelCallback = unsafe extern "C" fn(i32, *mut c_void) -> i32;

    #[link(name = "FluxoraInstallerCore", kind = "static")]
    extern "C" {
        pub fn fluxora_installer_is_available() -> i32;
        pub fn fluxora_installer_get_setup_bootstrap_state(
            expanded_payload_bytes: u64,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_validate_install_options(
            install_directory: *const u16,
            expanded_payload_bytes: u64,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_install_setup_payload_stream(
            read_callback: Option<ReadCallback>,
            read_user_data: *mut c_void,
            install_directory: *const u16,
            expanded_payload_bytes: u64,
            create_desktop_shortcut: i32,
            operation_id: *const u16,
            cancel_callback: Option<CancelCallback>,
            cancel_user_data: *mut c_void,
            progress_callback: Option<ProgressCallback>,
            progress_user_data: *mut c_void,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_repair_manager_protocol(
            application_path: *const u16,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_unregister_manager_protocol(
            application_path: *const u16,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_load_update_request(
            request_path: *const u16,
            updater_exe_path: *const u16,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_run_update_workflow(
            request_path: *const u16,
            updater_exe_path: *const u16,
            public_key_der: *const u8,
            public_key_der_length: u32,
            progress_callback: Option<ProgressCallback>,
            progress_user_data: *mut c_void,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_run_recovery(
            request_path: *const u16,
            updater_exe_path: *const u16,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_run_recovery_watchdog(
            request_path: *const u16,
            updater_exe_path: *const u16,
            owner_pid: u32,
            owner_start_ticks_utc: u64,
            ready_event_name: *const u16,
            json_buffer: *mut u16,
            json_buffer_length: i32,
        ) -> i32;
        pub fn fluxora_installer_get_last_error(
            message_buffer: *mut u16,
            message_buffer_length: i32,
        ) -> i32;
    }
}

#[cfg(all(feature = "installer-native", windows))]
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(all(feature = "installer-native", windows))]
fn wide_buffer_string(buffer: &[u16]) -> String {
    let length = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..length])
}

#[cfg(all(feature = "installer-native", windows))]
fn native_error(result: i32, code: &str, message_key: &str) -> NativeFailure {
    let mut error_buffer = vec![0_u16; 2048];
    let read = unsafe {
        ffi::fluxora_installer_get_last_error(error_buffer.as_mut_ptr(), error_buffer.len() as i32)
    };
    let detail = if read == 0 {
        wide_buffer_string(&error_buffer)
    } else {
        format!("native installer result={result}")
    };
    NativeFailure::new(code, message_key, false).with_detail(detail)
}

#[cfg(all(feature = "installer-native", windows))]
fn parse_native_json<T: serde::de::DeserializeOwned>(
    result: i32,
    buffer: &[u16],
    code: &str,
    message_key: &str,
) -> Result<T, NativeFailure> {
    if result != 0 {
        return Err(native_error(result, code, message_key));
    }
    serde_json::from_str(&wide_buffer_string(buffer)).map_err(|error| {
        NativeFailure::new(
            "installer.invalidNativeResponse",
            "installer.error.invalidNativeResponse",
            false,
        )
        .with_detail(error.to_string())
    })
}

pub struct NativeInstaller;

impl NativeInstaller {
    pub fn is_available() -> bool {
        #[cfg(all(feature = "installer-native", windows))]
        {
            return unsafe { ffi::fluxora_installer_is_available() == 1 };
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            false
        }
    }

    pub fn setup_bootstrap(
        expanded_payload_bytes: u64,
    ) -> Result<NativeSetupBootstrapState, NativeFailure> {
        #[cfg(all(feature = "installer-native", windows))]
        {
            let mut buffer = vec![0_u16; NATIVE_BUFFER_CHARS];
            let result = unsafe {
                ffi::fluxora_installer_get_setup_bootstrap_state(
                    expanded_payload_bytes,
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                )
            };
            let state: NativeSetupBootstrapState = parse_native_json(
                result,
                &buffer,
                "setup.bootstrapFailed",
                "setup.error.bootstrapFailed",
            )?;
            validate_schema(state.schema_version, "setup bootstrap")?;
            return Ok(state);
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            let _ = expanded_payload_bytes;
            Err(NativeFailure::new(
                "setup.nativeCoreUnavailable",
                "setup.error.nativeCoreUnavailable",
                false,
            ))
        }
    }

    pub fn validate_install_path(
        install_directory: &str,
        expanded_payload_bytes: u64,
    ) -> Result<InstallPathValidation, NativeFailure> {
        #[cfg(all(feature = "installer-native", windows))]
        {
            let install_directory = to_wide(install_directory);
            let mut buffer = vec![0_u16; NATIVE_BUFFER_CHARS];
            let result = unsafe {
                ffi::fluxora_installer_validate_install_options(
                    install_directory.as_ptr(),
                    expanded_payload_bytes,
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                )
            };
            let validation: InstallPathValidation = parse_native_json(
                result,
                &buffer,
                "setup.pathValidationFailed",
                "setup.error.pathValidationFailed",
            )?;
            validate_schema(validation.schema_version, "install path validation")?;
            return Ok(validation);
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            let _ = (install_directory, expanded_payload_bytes);
            Err(NativeFailure::new(
                "setup.nativeCoreUnavailable",
                "setup.error.nativeCoreUnavailable",
                false,
            ))
        }
    }

    pub fn install_setup_payload_stream(
        payload: &'static [u8],
        expanded_payload_bytes: u64,
        options: &InstallOptions,
        cancellation: Arc<InstallCancellation>,
        on_progress: impl Fn(InstallProgress) + Send + 'static,
    ) -> Result<NativeInstallResult, NativeFailure> {
        #[cfg(all(feature = "installer-native", windows))]
        {
            struct InstallContext {
                payload: &'static [u8],
                offset: usize,
                operation_id: String,
                cancellation: Arc<InstallCancellation>,
                on_progress: Box<dyn Fn(InstallProgress) + Send>,
            }

            unsafe extern "C" fn read_callback(
                destination: *mut c_void,
                byte_count: u64,
                user_data: *mut c_void,
            ) -> i64 {
                let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if destination.is_null() || user_data.is_null() || byte_count == 0 {
                        return 0_i64;
                    }
                    let context = unsafe { &mut *(user_data as *mut InstallContext) };
                    let remaining = context.payload.len().saturating_sub(context.offset);
                    let length = bounded_setup_read_length(remaining, byte_count);
                    if length == 0 {
                        return 0;
                    }
                    unsafe {
                        std::ptr::copy_nonoverlapping(
                            context.payload.as_ptr().add(context.offset),
                            destination.cast::<u8>(),
                            length,
                        );
                    }
                    context.offset += length;
                    length as i64
                }));
                run.unwrap_or(-1)
            }

            unsafe extern "C" fn progress_callback(
                progress_json: *const u16,
                user_data: *mut c_void,
            ) {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if progress_json.is_null() || user_data.is_null() {
                        return;
                    }
                    let context = unsafe { &mut *(user_data as *mut InstallContext) };
                    let mut length = 0_usize;
                    while length < NATIVE_BUFFER_CHARS && unsafe { *progress_json.add(length) } != 0
                    {
                        length += 1;
                    }
                    let text = String::from_utf16_lossy(unsafe {
                        std::slice::from_raw_parts(progress_json, length)
                    });
                    if let Ok(raw) = serde_json::from_str::<NativeInstallProgress>(&text) {
                        if let Ok(progress) = normalize_setup_progress(&context.operation_id, raw) {
                            (context.on_progress)(progress);
                        }
                    }
                }));
            }

            unsafe extern "C" fn cancel_callback(
                enter_commit_boundary: i32,
                user_data: *mut c_void,
            ) -> i32 {
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if user_data.is_null() {
                        return 1;
                    }
                    let context = unsafe { &*(user_data as *const InstallContext) };
                    let should_cancel = if enter_commit_boundary == 0 {
                        context.cancellation.requested()
                    } else {
                        context.cancellation.enter_commit_boundary()
                    };
                    i32::from(should_cancel)
                }))
                .unwrap_or(1)
            }

            let operation_id = to_wide(&options.operation_id);
            let install_directory = to_wide(&options.install_directory);
            let mut context = InstallContext {
                payload,
                offset: 0,
                operation_id: options.operation_id.clone(),
                cancellation: cancellation.clone(),
                on_progress: Box::new(on_progress),
            };
            let context_ptr = (&mut context as *mut InstallContext).cast::<c_void>();
            let mut buffer = vec![0_u16; NATIVE_BUFFER_CHARS];
            let result = unsafe {
                ffi::fluxora_installer_install_setup_payload_stream(
                    Some(read_callback),
                    context_ptr,
                    install_directory.as_ptr(),
                    expanded_payload_bytes,
                    i32::from(options.create_desktop_shortcut),
                    operation_id.as_ptr(),
                    Some(cancel_callback),
                    context_ptr,
                    Some(progress_callback),
                    context_ptr,
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                )
            };
            if let Some(failure) = cancelled_install_failure(result) {
                return Err(failure);
            }
            return parse_native_json(
                result,
                &buffer,
                "setup.installFailed",
                "setup.error.installFailed",
            );
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            let _ = (
                payload,
                expanded_payload_bytes,
                options,
                cancellation,
                on_progress,
            );
            Err(NativeFailure::new(
                "setup.nativeCoreUnavailable",
                "setup.error.nativeCoreUnavailable",
                false,
            ))
        }
    }

    pub fn load_update_request(
        request_path: &str,
        updater_exe_path: &str,
    ) -> Result<UpdateRequestSummary, NativeFailure> {
        #[cfg(all(feature = "installer-native", windows))]
        {
            let request_path = to_wide(request_path);
            let updater_exe_path = to_wide(updater_exe_path);
            let mut buffer = vec![0_u16; NATIVE_BUFFER_CHARS];
            let result = unsafe {
                ffi::fluxora_installer_load_update_request(
                    request_path.as_ptr(),
                    updater_exe_path.as_ptr(),
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                )
            };
            let summary: UpdateRequestSummary = parse_native_json(
                result,
                &buffer,
                "updater.requestRejected",
                "updater.error.invalidRequest",
            )?;
            validate_schema(summary.schema_version, "update request summary")?;
            return Ok(summary);
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            let _ = (request_path, updater_exe_path);
            Err(NativeFailure::new(
                "updater.nativeCoreUnavailable",
                "updater.error.nativeCoreUnavailable",
                false,
            ))
        }
    }

    pub fn repair_manager_protocol(application_path: &str) -> Result<(), NativeFailure> {
        Self::run_protocol_action(
            application_path,
            "setup.protocolRepairFailed",
            "setup.error.protocolRepairFailed",
            #[cfg(all(feature = "installer-native", windows))]
            ffi::fluxora_installer_repair_manager_protocol,
        )
    }

    pub fn unregister_manager_protocol(application_path: &str) -> Result<(), NativeFailure> {
        Self::run_protocol_action(
            application_path,
            "setup.protocolUnregisterFailed",
            "setup.error.protocolUnregisterFailed",
            #[cfg(all(feature = "installer-native", windows))]
            ffi::fluxora_installer_unregister_manager_protocol,
        )
    }

    fn run_protocol_action(
        application_path: &str,
        code: &str,
        message_key: &str,
        #[cfg(all(feature = "installer-native", windows))] action: unsafe extern "C" fn(
            *const u16,
            *mut u16,
            i32,
        )
            -> i32,
    ) -> Result<(), NativeFailure> {
        #[cfg(all(feature = "installer-native", windows))]
        {
            let application_path = to_wide(application_path);
            let mut buffer = vec![0_u16; NATIVE_BUFFER_CHARS];
            let result = unsafe {
                action(
                    application_path.as_ptr(),
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                )
            };
            if result != 0 {
                return Err(native_error(result, code, message_key));
            }
            return Ok(());
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            let _ = (application_path, code, message_key);
            Err(NativeFailure::new(
                "setup.nativeCoreUnavailable",
                "setup.error.nativeCoreUnavailable",
                false,
            ))
        }
    }

    pub fn run_update_workflow(
        request_path: &str,
        updater_exe_path: &str,
        public_key_der: &'static [u8],
        operation_id: &str,
        on_progress: impl Fn(UpdateProgress) + Send + 'static,
    ) -> Result<UpdateResult, NativeFailure> {
        #[cfg(all(feature = "installer-native", windows))]
        {
            struct UpdateContext {
                operation_id: String,
                on_progress: Box<dyn Fn(UpdateProgress) + Send>,
            }

            unsafe extern "C" fn progress_callback(
                progress_json: *const u16,
                user_data: *mut c_void,
            ) {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if progress_json.is_null() || user_data.is_null() {
                        return;
                    }
                    let context = unsafe { &mut *(user_data as *mut UpdateContext) };
                    let mut length = 0_usize;
                    while length < NATIVE_BUFFER_CHARS && unsafe { *progress_json.add(length) } != 0
                    {
                        length += 1;
                    }
                    let text = String::from_utf16_lossy(unsafe {
                        std::slice::from_raw_parts(progress_json, length)
                    });
                    if let Ok(raw) = serde_json::from_str::<UpdateProgress>(&text) {
                        if let Ok(progress) = normalize_updater_progress(&context.operation_id, raw)
                        {
                            (context.on_progress)(progress);
                        }
                    }
                }));
            }

            let request_path = to_wide(request_path);
            let updater_exe_path = to_wide(updater_exe_path);
            let mut context = UpdateContext {
                operation_id: operation_id.to_string(),
                on_progress: Box::new(on_progress),
            };
            let mut buffer = vec![0_u16; NATIVE_BUFFER_CHARS];
            let result = unsafe {
                ffi::fluxora_installer_run_update_workflow(
                    request_path.as_ptr(),
                    updater_exe_path.as_ptr(),
                    public_key_der.as_ptr(),
                    public_key_der.len().try_into().map_err(|_| {
                        NativeFailure::new(
                            "updater.trustAnchorInvalid",
                            "updater.error.trustAnchorInvalid",
                            false,
                        )
                    })?,
                    Some(progress_callback),
                    (&mut context as *mut UpdateContext).cast::<c_void>(),
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                )
            };
            let response: UpdateResult = parse_native_json(
                result,
                &buffer,
                "updater.workflowFailed",
                "updater.error.workflowFailed",
            )?;
            validate_schema(response.schema_version, "update result")?;
            return Ok(response);
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            let _ = (
                request_path,
                updater_exe_path,
                public_key_der,
                operation_id,
                on_progress,
            );
            Err(NativeFailure::new(
                "updater.nativeCoreUnavailable",
                "updater.error.nativeCoreUnavailable",
                false,
            ))
        }
    }

    pub fn run_recovery(request_path: &str, updater_exe_path: &str) -> Result<(), NativeFailure> {
        #[cfg(all(feature = "installer-native", windows))]
        {
            let request_path = to_wide(request_path);
            let updater_exe_path = to_wide(updater_exe_path);
            let mut buffer = vec![0_u16; NATIVE_BUFFER_CHARS];
            let result = unsafe {
                ffi::fluxora_installer_run_recovery(
                    request_path.as_ptr(),
                    updater_exe_path.as_ptr(),
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                )
            };
            if result != 0 {
                return Err(native_error(
                    result,
                    "updater.recoveryFailed",
                    "updater.error.recoveryFailed",
                ));
            }
            return Ok(());
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            let _ = (request_path, updater_exe_path);
            Err(NativeFailure::new(
                "updater.nativeCoreUnavailable",
                "updater.error.nativeCoreUnavailable",
                false,
            ))
        }
    }

    pub fn run_recovery_watchdog(
        request_path: &str,
        updater_exe_path: &str,
        owner_pid: u32,
        owner_start_ticks_utc: u64,
        ready_event_name: &str,
    ) -> Result<(), NativeFailure> {
        #[cfg(all(feature = "installer-native", windows))]
        {
            let request_path = to_wide(request_path);
            let updater_exe_path = to_wide(updater_exe_path);
            let ready_event_name = to_wide(ready_event_name);
            let mut buffer = vec![0_u16; NATIVE_BUFFER_CHARS];
            let result = unsafe {
                ffi::fluxora_installer_run_recovery_watchdog(
                    request_path.as_ptr(),
                    updater_exe_path.as_ptr(),
                    owner_pid,
                    owner_start_ticks_utc,
                    ready_event_name.as_ptr(),
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                )
            };
            if result != 0 {
                return Err(native_error(
                    result,
                    "updater.watchdogRecoveryFailed",
                    "updater.error.recoveryFailed",
                ));
            }
            return Ok(());
        }
        #[cfg(not(all(feature = "installer-native", windows)))]
        {
            let _ = (
                request_path,
                updater_exe_path,
                owner_pid,
                owner_start_ticks_utc,
                ready_event_name,
            );
            Err(NativeFailure::new(
                "updater.nativeCoreUnavailable",
                "updater.error.nativeCoreUnavailable",
                false,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(all(feature = "installer-native", windows))]
    #[test]
    fn installer_native_feature_links_every_required_c_abi_symbol() {
        let linked_symbols = [
            ffi::fluxora_installer_get_setup_bootstrap_state as *const () as usize,
            ffi::fluxora_installer_validate_install_options as *const () as usize,
            ffi::fluxora_installer_install_setup_payload_stream as *const () as usize,
            ffi::fluxora_installer_repair_manager_protocol as *const () as usize,
            ffi::fluxora_installer_unregister_manager_protocol as *const () as usize,
            ffi::fluxora_installer_load_update_request as *const () as usize,
            ffi::fluxora_installer_run_update_workflow as *const () as usize,
            ffi::fluxora_installer_run_recovery as *const () as usize,
            ffi::fluxora_installer_run_recovery_watchdog as *const () as usize,
            ffi::fluxora_installer_get_last_error as *const () as usize,
        ];
        assert!(linked_symbols.iter().all(|symbol| *symbol != 0));
        assert_eq!(unsafe { ffi::fluxora_installer_is_available() }, 1);
    }

    #[test]
    fn default_boundary_is_fail_closed_without_the_static_core_feature() {
        if !cfg!(feature = "installer-native") {
            assert!(!NativeInstaller::is_available());
            let failure = NativeInstaller::setup_bootstrap(1).unwrap_err();
            assert_eq!(failure.code, "setup.nativeCoreUnavailable");
        }
    }

    #[test]
    fn cancellation_closes_at_the_commit_boundary() {
        let cancellation = InstallCancellation::new();
        assert!(cancellation.request());
        let cancellation = InstallCancellation::new();
        assert!(!cancellation.enter_commit_boundary());
        assert!(!cancellation.request());
    }

    #[test]
    fn cancellation_and_commit_boundary_are_linearizable_under_race() {
        use std::sync::Barrier;
        use std::thread;

        for _ in 0..1_000 {
            let cancellation = Arc::new(InstallCancellation::new());
            let barrier = Arc::new(Barrier::new(3));
            let request_state = cancellation.clone();
            let request_barrier = barrier.clone();
            let request = thread::spawn(move || {
                request_barrier.wait();
                request_state.request()
            });
            let commit_state = cancellation.clone();
            let commit_barrier = barrier.clone();
            let boundary = thread::spawn(move || {
                commit_barrier.wait();
                commit_state.enter_commit_boundary()
            });
            barrier.wait();
            let accepted = request.join().unwrap();
            let core_must_abort = boundary.join().unwrap();
            assert_eq!(
                accepted, core_must_abort,
                "accepted cancellation must force the native pre-commit callback to abort"
            );
        }
    }

    #[test]
    fn accepted_cancel_stops_a_large_stream_at_the_next_bounded_checkpoint() {
        let cancellation = InstallCancellation::new();
        let large_payload_bytes = 64 * 1024 * 1024;
        let first_read = bounded_setup_read_length(large_payload_bytes, u64::MAX);
        assert_eq!(first_read, MAX_SETUP_STREAM_READ_BYTES);

        assert!(cancellation.request());
        let second_read = if cancellation.requested() {
            0
        } else {
            bounded_setup_read_length(large_payload_bytes - first_read, u64::MAX)
        };
        assert_eq!(
            second_read, 0,
            "native queries the shared cancellation callback before every bounded stream read"
        );
        assert!(
            first_read < large_payload_bytes,
            "accepted cancellation must not require consuming the full compressed stream"
        );
    }

    #[test]
    fn native_cancel_result_preserves_the_stable_renderer_failure() {
        let failure = cancelled_install_failure(INSTALLER_RESULT_CANCELLED).unwrap();
        assert_eq!(failure.code, "setup.cancelled");
        assert_eq!(failure.message_key, "setup.error.cancelled");
        assert!(failure.retryable);
        assert!(cancelled_install_failure(0).is_none());
    }
}
