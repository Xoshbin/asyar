//! Windows app-events watcher.
//!
//! Strategy:
//!
//! - Frontmost changes: `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, …)` on a
//!   dedicated thread running a standard Win32 message pump. The hook
//!   callback receives the new HWND; we resolve it to a process name via
//!   `GetWindowThreadProcessId` + `QueryFullProcessImageNameW`.
//! - Launch / terminate: WMI subscriptions to
//!   `__InstanceCreationEvent`/`__InstanceDeletionEvent WITHIN 1 WHERE
//!   TargetInstance ISA 'Win32_Process'` on a second dedicated thread.
//!   WMI returns the target `Win32_Process` instance which carries
//!   `ProcessId`, `Name`, and `ExecutablePath`.
//!
//! Pure parser helpers below compile on every platform so their logic can
//! be exercised from macOS. The Win32-using watcher glue is gated behind
//! `#[cfg(target_os = "windows")]`.

/// Extract the executable basename (without `.exe`) from a full path. Used
/// to produce a user-friendly `name` for `AppEvent::Launched` when only the
/// `ExecutablePath` is available from WMI.
pub fn exe_basename_without_ext(full_path: &str) -> String {
    let last = full_path.rsplit(['\\', '/']).next().unwrap_or(full_path);
    match last.to_ascii_lowercase().strip_suffix(".exe") {
        // Preserve original casing of the stem.
        Some(_) => last[..last.len() - 4].to_string(),
        None => last.to_string(),
    }
}

/// Filter for whether a Win32_Process event looks like a GUI app worth
/// emitting. This is heuristic — Windows has no reliable "is GUI"
/// classification without per-process introspection, but we can drop the
/// obvious system helpers.
pub fn is_interesting_win_process(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // System processes that fire constantly and aren't user-facing.
    const BORING: &[&str] = &[
        "svchost.exe",
        "conhost.exe",
        "dllhost.exe",
        "taskhostw.exe",
        "wmiprvse.exe",
        "rundll32.exe",
        "smartscreen.exe",
        "backgroundtaskhost.exe",
    ];
    !BORING.contains(&lower.as_str())
}

// ---------------------------------------------------------------------------
// Windows-only watcher glue
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub use watcher::{WindowsAppWatcher, WindowsPresenceQuery};

#[cfg(target_os = "windows")]
mod watcher {
    use super::*;
    use crate::app_events::{AppEvent, AppEventsHub, AppEventsWatcher, AppPresenceQuery};
    use crate::error::AppError;
    use log::{info, warn};
    use std::sync::Arc;
    use std::sync::OnceLock;
    use ::windows::Win32::Foundation::HWND;
    use ::windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, GetWindowThreadProcessId, TranslateMessage, MSG,
        EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT,
    };

    static HUB_PTR: OnceLock<usize> = OnceLock::new();

    pub struct WindowsAppWatcher;

    impl WindowsAppWatcher {
        pub fn new() -> Self {
            Self
        }
    }

    impl Default for WindowsAppWatcher {
        fn default() -> Self {
            Self::new()
        }
    }

    impl AppEventsWatcher for WindowsAppWatcher {
        fn start(&self, hub: Arc<AppEventsHub>) -> Result<(), AppError> {
            // Stash an Arc pointer in a OnceLock so the extern callback can
            // recover it without a thread-local. Pointer lives for app
            // lifetime — hub is a singleton.
            let arc_ptr = Arc::into_raw(hub.clone()) as usize;
            let _ = HUB_PTR.set(arc_ptr);

            std::thread::Builder::new()
                .name("asyar-app-events-foreground".into())
                .spawn(move || {
                    if let Err(e) = run_foreground_hook() {
                        warn!("[app_events/windows] foreground hook ended: {e}");
                    }
                })
                .ok();

            std::thread::Builder::new()
                .name("asyar-app-events-wmi".into())
                .spawn(move || {
                    if let Err(e) = run_wmi_loop(hub) {
                        warn!("[app_events/windows] WMI source failed: {e}");
                    }
                })
                .ok();

            info!("[app_events/windows] watcher started");
            Ok(())
        }
    }

    fn hub_ref() -> Option<Arc<AppEventsHub>> {
        let ptr = *HUB_PTR.get()? as *const AppEventsHub;
        if ptr.is_null() {
            return None;
        }
        // Safety: we leaked exactly one Arc handle at startup; clone without
        // taking ownership.
        unsafe {
            let original = Arc::from_raw(ptr);
            let cloned = Arc::clone(&original);
            std::mem::forget(original);
            Some(cloned)
        }
    }

    unsafe extern "system" fn foreground_callback(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let Some(hub) = hub_ref() else { return };
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        let name = process_name_for_pid(pid).unwrap_or_else(|| format!("pid-{pid}"));
        hub.dispatch(AppEvent::FrontmostChanged {
            pid,
            bundle_id: None,
            name,
        });
    }

    fn run_foreground_hook() -> Result<(), String> {
        unsafe {
            let hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(foreground_callback),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            if hook.is_invalid() {
                return Err("SetWinEventHook failed".into());
            }
            // Need a message pump in this thread for OUTOFCONTEXT hooks.
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        Ok(())
    }

    fn process_name_for_pid(pid: u32) -> Option<String> {
        use ::windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                ::windows::core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            if ok.is_err() {
                return None;
            }
            let s = String::from_utf16_lossy(&buf[..size as usize]);
            Some(exe_basename_without_ext(&s))
        }
    }

    // ---- WMI process-creation / -deletion ----

    fn run_wmi_loop(hub: Arc<AppEventsHub>) -> Result<(), String> {
        use wmi::{COMLibrary, WMIConnection};

        let com_con = COMLibrary::new().map_err(|e| format!("COM init: {e}"))?;
        let wmi_con = WMIConnection::new(com_con).map_err(|e| format!("WMI connect: {e}"))?;

        // We run two blocking iterators back-to-back on this thread — the
        // creation iterator drains first (unbounded) so use a separate helper
        // thread for terminations if that proves limiting. For baseline
        // behaviour one thread is enough because we alternate via
        // raw_notification and peek.
        std::thread::Builder::new()
            .name("asyar-app-events-wmi-term".into())
            .spawn({
                let hub = hub.clone();
                move || {
                    if let Err(e) = run_wmi_termination_loop(hub) {
                        warn!("[app_events/windows] WMI termination loop: {e}");
                    }
                }
            })
            .ok();

        let creation_query = "SELECT * FROM __InstanceCreationEvent WITHIN 1 \
             WHERE TargetInstance ISA 'Win32_Process'";
        let iter = wmi_con
            .raw_notification::<std::collections::HashMap<String, wmi::Variant>>(creation_query)
            .map_err(|e| format!("WMI creation subscribe: {e}"))?;
        for result in iter {
            let map = match result {
                Ok(m) => m,
                Err(_) => continue,
            };
            if let Some((pid, name, path)) = extract_proc_fields(&map) {
                if !is_interesting_win_process(&name) {
                    continue;
                }
                hub.dispatch(AppEvent::Launched {
                    pid,
                    bundle_id: None,
                    name: exe_basename_without_ext(&name),
                    path: Some(path),
                });
            }
        }
        Ok(())
    }

    fn run_wmi_termination_loop(hub: Arc<AppEventsHub>) -> Result<(), String> {
        use wmi::{COMLibrary, WMIConnection};

        let com_con = COMLibrary::new().map_err(|e| format!("COM init: {e}"))?;
        let wmi_con = WMIConnection::new(com_con).map_err(|e| format!("WMI connect: {e}"))?;
        let q = "SELECT * FROM __InstanceDeletionEvent WITHIN 1 \
             WHERE TargetInstance ISA 'Win32_Process'";
        let iter = wmi_con
            .raw_notification::<std::collections::HashMap<String, wmi::Variant>>(q)
            .map_err(|e| format!("WMI deletion subscribe: {e}"))?;
        for result in iter {
            let map = match result {
                Ok(m) => m,
                Err(_) => continue,
            };
            if let Some((pid, name, _path)) = extract_proc_fields(&map) {
                if !is_interesting_win_process(&name) {
                    continue;
                }
                hub.dispatch(AppEvent::Terminated {
                    pid,
                    bundle_id: None,
                    name: exe_basename_without_ext(&name),
                });
            }
        }
        Ok(())
    }

    /// Extract (pid, name, path) from a raw WMI notification map that carries
    /// a `TargetInstance` nested object.
    fn extract_proc_fields(
        map: &std::collections::HashMap<String, wmi::Variant>,
    ) -> Option<(u32, String, String)> {
        let target = map.get("TargetInstance")?;
        let nested = if let wmi::Variant::Object(obj) = target {
            obj
        } else {
            return None;
        };
        let pid = match nested.get_property("ProcessId") {
            Ok(wmi::Variant::UI4(p)) => p,
            Ok(wmi::Variant::UI8(p)) => p as u32,
            _ => 0,
        };
        let name = match nested.get_property("Name") {
            Ok(wmi::Variant::String(s)) => s,
            _ => String::new(),
        };
        let path = match nested.get_property("ExecutablePath") {
            Ok(wmi::Variant::String(s)) => s,
            _ => String::new(),
        };
        Some((pid, name, path))
    }

    // ---- presence query ----

    pub struct WindowsPresenceQuery;

    impl AppPresenceQuery for WindowsPresenceQuery {
        fn is_running(&self, bundle_id: &str) -> bool {
            // No real bundle IDs on Windows — treat argument as either an
            // exe basename (with or without .exe) or a process Name. Scan
            // via CreateToolhelp32Snapshot.
            use ::windows::Win32::System::Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            };
            unsafe {
                let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                    Ok(h) => h,
                    Err(_) => return false,
                };
                let mut entry = PROCESSENTRY32W {
                    dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                    ..Default::default()
                };
                if Process32FirstW(snap, &mut entry).is_err() {
                    return false;
                }
                let target = bundle_id.to_ascii_lowercase();
                loop {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(0);
                    let name = String::from_utf16_lossy(&entry.szExeFile[..len])
                        .to_ascii_lowercase();
                    if name == target || exe_basename_without_ext(&name) == target {
                        return true;
                    }
                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- exe_basename_without_ext ----

    #[test]
    fn exe_basename_extracts_stem_from_full_path() {
        assert_eq!(
            exe_basename_without_ext("C:\\Program Files\\Slack\\Slack.exe"),
            "Slack"
        );
    }

    #[test]
    fn exe_basename_is_case_insensitive_on_extension() {
        assert_eq!(
            exe_basename_without_ext("C:\\App\\Discord.EXE"),
            "Discord"
        );
    }

    #[test]
    fn exe_basename_preserves_no_extension() {
        assert_eq!(exe_basename_without_ext("C:\\weird\\noextension"), "noextension");
    }

    #[test]
    fn exe_basename_handles_forward_slashes() {
        assert_eq!(exe_basename_without_ext("C:/Apps/Firefox.exe"), "Firefox");
    }

    #[test]
    fn exe_basename_handles_bare_filename() {
        assert_eq!(exe_basename_without_ext("notepad.exe"), "notepad");
    }

    // ---- is_interesting_win_process ----

    #[test]
    fn filters_out_svchost() {
        assert!(!is_interesting_win_process("svchost.exe"));
    }

    #[test]
    fn filters_out_conhost() {
        assert!(!is_interesting_win_process("conhost.exe"));
    }

    #[test]
    fn accepts_typical_user_app() {
        assert!(is_interesting_win_process("Slack.exe"));
        assert!(is_interesting_win_process("Discord.exe"));
        assert!(is_interesting_win_process("firefox.exe"));
    }

    #[test]
    fn filter_is_case_insensitive() {
        assert!(!is_interesting_win_process("SvcHost.exe"));
        assert!(!is_interesting_win_process("SVCHOST.EXE"));
    }
}
