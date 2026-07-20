fn normalized_process_name(value: &str) -> String {
    value
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(value)
        .trim()
        .to_ascii_lowercase()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeExitWait {
    Signaled,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessInfo {
    pub process_id: u32,
    pub process_name: String,
}

#[cfg(windows)]
mod platform {
    use super::{normalized_process_name, NativeExitWait, ProcessInfo};
    use std::ffi::{c_void, OsString};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStringExt;

    type Handle = *mut c_void;

    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const TH32CS_SNAPMODULE: u32 = 0x0000_0008;
    const TH32CS_SNAPMODULE32: u32 = 0x0000_0010;
    const ERROR_BAD_LENGTH: u32 = 24;
    const INFINITE: u32 = 0xffff_ffff;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 0x0000_0102;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    struct ModuleEntry32W {
        dw_size: u32,
        th32_module_id: u32,
        th32_process_id: u32,
        glblcnt_usage: u32,
        proccnt_usage: u32,
        mod_base_addr: *mut u8,
        mod_base_size: u32,
        h_module: Handle,
        sz_module: [u16; 256],
        sz_exe_path: [u16; 260],
    }

    extern "system" {
        fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32)
            -> Handle;
        fn WaitForSingleObject(h_handle: Handle, dw_milliseconds: u32) -> u32;
        fn CloseHandle(h_object: Handle) -> i32;
        fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> Handle;
        fn Process32FirstW(h_snapshot: Handle, lppe: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(h_snapshot: Handle, lppe: *mut ProcessEntry32W) -> i32;
        fn Module32FirstW(h_snapshot: Handle, lpme: *mut ModuleEntry32W) -> i32;
        fn Module32NextW(h_snapshot: Handle, lpme: *mut ModuleEntry32W) -> i32;
        fn GetLastError() -> u32;
    }

    fn process_name(entry: &ProcessEntry32W) -> String {
        let end = entry
            .sz_exe_file
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(entry.sz_exe_file.len());
        OsString::from_wide(&entry.sz_exe_file[..end])
            .to_string_lossy()
            .to_string()
    }

    fn module_name(entry: &ModuleEntry32W) -> String {
        let end = entry
            .sz_module
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(entry.sz_module.len());
        OsString::from_wide(&entry.sz_module[..end])
            .to_string_lossy()
            .to_string()
    }

    fn module_snapshot(process_id: u32) -> Option<Handle> {
        for _ in 0..4 {
            let snapshot = unsafe {
                CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, process_id)
            };
            if snapshot != INVALID_HANDLE_VALUE {
                return Some(snapshot);
            }
            if unsafe { GetLastError() } != ERROR_BAD_LENGTH {
                break;
            }
        }
        None
    }

    fn process_uses_module(process_id: u32, wanted_module: &str) -> bool {
        let Some(snapshot) = module_snapshot(process_id) else {
            return false;
        };
        let mut entry: ModuleEntry32W = unsafe { zeroed() };
        entry.dw_size = size_of::<ModuleEntry32W>() as u32;
        let mut has_entry = unsafe { Module32FirstW(snapshot, &mut entry) } != 0;
        let mut found = false;
        while has_entry {
            if normalized_process_name(&module_name(&entry)) == wanted_module {
                found = true;
                break;
            }
            has_entry = unsafe { Module32NextW(snapshot, &mut entry) } != 0;
        }
        unsafe {
            CloseHandle(snapshot);
        }
        found
    }

    fn process_exists_in_snapshot(process_id: u32) -> bool {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }

        let mut entry: ProcessEntry32W = unsafe { zeroed() };
        entry.dw_size = size_of::<ProcessEntry32W>() as u32;
        let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
        let mut found = false;
        while has_entry {
            if entry.th32_process_id == process_id {
                found = true;
                break;
            }
            has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        }
        unsafe {
            CloseHandle(snapshot);
        }
        found
    }

    pub fn is_process_running(process_id: u32) -> bool {
        if process_id == 0 {
            return false;
        }

        let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, process_id) };
        if handle.is_null() {
            return process_exists_in_snapshot(process_id);
        }

        let wait_result = unsafe { WaitForSingleObject(handle, 0) };
        unsafe {
            CloseHandle(handle);
        }
        if wait_result == WAIT_TIMEOUT {
            true
        } else if wait_result == WAIT_OBJECT_0 {
            false
        } else {
            process_exists_in_snapshot(process_id)
        }
    }

    pub fn wait_for_exit_signal(process_id: u32) -> NativeExitWait {
        if process_id == 0 {
            return NativeExitWait::Unavailable;
        }

        let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, process_id) };
        if handle.is_null() {
            return NativeExitWait::Unavailable;
        }

        let wait_result = unsafe { WaitForSingleObject(handle, INFINITE) };
        unsafe {
            CloseHandle(handle);
        }
        if wait_result == WAIT_OBJECT_0 {
            NativeExitWait::Signaled
        } else {
            NativeExitWait::Unavailable
        }
    }

    pub fn find_process_by_names(names: &[String]) -> Option<(u32, String)> {
        if names.is_empty() {
            return None;
        }

        let wanted: Vec<String> = names
            .iter()
            .map(|name| normalized_process_name(name))
            .filter(|name| !name.is_empty())
            .collect();
        if wanted.is_empty() {
            return None;
        }

        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }

        let mut entry: ProcessEntry32W = unsafe { zeroed() };
        entry.dw_size = size_of::<ProcessEntry32W>() as u32;
        let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
        while has_entry {
            let name = process_name(&entry);
            if wanted
                .iter()
                .any(|wanted_name| normalized_process_name(&name) == *wanted_name)
            {
                unsafe {
                    CloseHandle(snapshot);
                }
                return Some((entry.th32_process_id, name));
            }

            has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        }

        unsafe {
            CloseHandle(snapshot);
        }
        None
    }

    pub fn find_processes_using_module(module_name: &str) -> Vec<ProcessInfo> {
        let wanted_module = normalized_process_name(module_name);
        if wanted_module.is_empty() {
            return Vec::new();
        }

        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Vec::new();
        }

        let mut processes = Vec::new();
        let mut entry: ProcessEntry32W = unsafe { zeroed() };
        entry.dw_size = size_of::<ProcessEntry32W>() as u32;
        let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
        while has_entry {
            if process_uses_module(entry.th32_process_id, &wanted_module) {
                processes.push(ProcessInfo {
                    process_id: entry.th32_process_id,
                    process_name: process_name(&entry),
                });
            }
            has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        }
        unsafe {
            CloseHandle(snapshot);
        }
        processes
    }
}

#[cfg(windows)]
pub use platform::{
    find_process_by_names, find_processes_using_module, is_process_running, wait_for_exit_signal,
};

#[cfg(not(windows))]
mod platform {
    use super::{NativeExitWait, ProcessInfo};

    pub fn is_process_running(process_id: u32) -> bool {
        process_id != 0
            && std::path::Path::new("/proc")
                .join(process_id.to_string())
                .exists()
    }

    pub fn find_process_by_names(_names: &[String]) -> Option<(u32, String)> {
        None
    }

    pub fn wait_for_exit_signal(_process_id: u32) -> NativeExitWait {
        NativeExitWait::Unavailable
    }

    pub fn find_processes_using_module(_module_name: &str) -> Vec<ProcessInfo> {
        Vec::new()
    }
}

#[cfg(not(windows))]
pub use platform::{
    find_process_by_names, find_processes_using_module, is_process_running, wait_for_exit_signal,
};

#[cfg(all(test, windows))]
mod tests {
    use super::{find_processes_using_module, wait_for_exit_signal, NativeExitWait};
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn waits_for_the_windows_process_exit_signal() {
        let mut child = Command::new("ping.exe")
            .args(["-t", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn wait fixture");
        let process_id = child.id();
        let killer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            let _ = child.kill();
            let _ = child.wait();
        });

        assert_eq!(wait_for_exit_signal(process_id), NativeExitWait::Signaled);
        killer.join().expect("join wait fixture");
    }

    #[test]
    fn discovers_the_process_that_has_a_named_module_loaded() {
        let processes = find_processes_using_module("kernel32.dll");

        assert!(
            processes
                .iter()
                .any(|process| process.process_id == std::process::id()),
            "the current test process should have kernel32.dll loaded"
        );
    }
}
