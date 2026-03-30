//! Keyboard input simulation commands.
//!
//! Provides paste simulation and keyword expansion-and-paste functionality.

use enigo::{Enigo, KeyboardControllable};
use crate::error::AppError;

/// Simulates a system-level paste keystroke (Cmd+V / Ctrl+V).
#[tauri::command]
pub fn simulate_paste() {
    #[cfg(target_os = "macos")]
    {
        log::info!("[paste] simulate_paste called. accessibility={}",
            crate::platform::macos::is_accessibility_trusted());
        // Allow macOS time to process panel.order_out() and settle state
        std::thread::sleep(std::time::Duration::from_millis(50));

        let self_pid = std::process::id() as i32;
        if let Some(pid) = crate::platform::macos::get_frontmost_app_pid() {
            if pid != self_pid {
                log::info!("[paste] CGEventPostToPid path: target_pid={}, self_pid={}", pid, self_pid);
                simulate_paste_to_pid(pid);
                return;
            }
            log::warn!("[paste] frontmost app is Asyar itself (pid={}), using enigo fallback", pid);
        }

        // Fallback: use enigo (same approach as expand_and_paste which works reliably)
        let mut enigo = Enigo::new();
        enigo.key_down(enigo::Key::Meta);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut enigo = Enigo::new();
        enigo.key_down(enigo::Key::Control);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Control);
    }
}

#[cfg(target_os = "macos")]
fn simulate_paste_to_pid(pid: i32) {
    use std::ffi::c_void;

    // CoreGraphics is part of ApplicationServices (already linked in macos.rs)
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreateKeyboardEvent(
            source: *const c_void,
            virtual_key: u16,
            key_down: bool,
        ) -> *mut c_void;
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventPostToPid(pid: i32, event: *mut c_void);
        fn CFRelease(cf: *mut c_void);
    }

    // kCGEventFlagMaskCommand = 0x00100000
    const CMD_FLAG: u64 = 0x00100000;
    // macOS keycode for 'v'
    const V_KEYCODE: u16 = 9;

    log::info!("[paste] simulate_paste_to_pid: posting Cmd+V events to pid={}", pid);

    unsafe {
        // Key-down: Cmd+V
        let down = CGEventCreateKeyboardEvent(std::ptr::null(), V_KEYCODE, true);
        if !down.is_null() {
            CGEventSetFlags(down, CMD_FLAG);
            CGEventPostToPid(pid, down);
            log::info!("[paste] key-down event created and posted to pid={}", pid);
            CFRelease(down);
        } else {
            log::error!("[paste] CGEventCreateKeyboardEvent returned null for key-down");
        }
        // Key-up: V (no modifier needed on key-up)
        let up = CGEventCreateKeyboardEvent(std::ptr::null(), V_KEYCODE, false);
        if !up.is_null() {
            CGEventPostToPid(pid, up);
            log::info!("[paste] key-up event created and posted to pid={}", pid);
            CFRelease(up);
        } else {
            log::error!("[paste] CGEventCreateKeyboardEvent returned null for key-up");
        }
    }
}

struct ExpandGuard<'a>(&'a std::sync::atomic::AtomicBool);
impl Drop for ExpandGuard<'_> {
    fn drop(&mut self) {
        // Allow queued events to be processed before re-enabling the monitor
        std::thread::sleep(std::time::Duration::from_millis(50));
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Replaces the typed keyword (of `keyword_len` characters) with expanded text via paste.
#[tauri::command]
pub fn expand_and_paste(keyword_len: u32, state: tauri::State<'_, crate::AppState>) -> Result<(), AppError> {
    use std::sync::atomic::Ordering;
    // If another expansion is already in progress, skip this one
    if state.is_expanding.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let _guard = ExpandGuard(&state.is_expanding);

    let mut enigo = Enigo::new();
    for _ in 0..keyword_len {
        enigo.key_click(enigo::Key::Backspace);
        std::thread::sleep(std::time::Duration::from_millis(8));
    }
    std::thread::sleep(std::time::Duration::from_millis(50));
    // macOS uses Cmd+V; Windows and Linux use Ctrl+V
    #[cfg(target_os = "macos")]
    {
        enigo.key_down(enigo::Key::Meta);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(enigo::Key::Control);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Control);
    }

    Ok(())
}
