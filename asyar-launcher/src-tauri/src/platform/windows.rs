#![cfg(target_os = "windows")]

pub use asyar_platform::windows::*;

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_BACK, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_LSHIFT, VK_RETURN, VK_RIGHT,
    VK_RSHIFT, VK_SHIFT, VK_TAB, VK_UP,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
    WM_SYSKEYUP,
};

/// Configures a window with Windows-specific Spotlight styling.
pub fn setup_spotlight_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let hwnd = window.hwnd()?;
    asyar_platform::windows::setup_spotlight_window(hwnd);
    Ok(())
}

static SNIPPET_MONITOR_APP: OnceLock<AppHandle> = OnceLock::new();
static SHIFT_HELD: AtomicBool = AtomicBool::new(false);

thread_local! {
    static SNIPPET_BUFFER: RefCell<Vec<char>> = const { RefCell::new(Vec::new()) };
}

unsafe extern "system" fn snippet_keyboard_hook(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code >= 0 {
        let msg = wparam.0 as u32;
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        if (info.flags.0 & 0x10) == 0 {
            handle_snippet_key_event(msg, info);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn handle_snippet_key_event(msg: u32, info: &KBDLLHOOKSTRUCT) {
    let vk = info.vkCode;
    let scan = info.scanCode;

    if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
        if vk == VK_LSHIFT.0 as u32 || vk == VK_RSHIFT.0 as u32 || vk == VK_SHIFT.0 as u32 {
            SHIFT_HELD.store(true, Ordering::Relaxed);
        }
    } else if msg == WM_KEYUP || msg == WM_SYSKEYUP {
        if vk == VK_LSHIFT.0 as u32 || vk == VK_RSHIFT.0 as u32 || vk == VK_SHIFT.0 as u32 {
            SHIFT_HELD.store(false, Ordering::Relaxed);
        }
        return;
    }

    if msg != WM_KEYDOWN {
        return;
    }

    let Some(app) = SNIPPET_MONITOR_APP.get() else {
        return;
    };
    let state = app.state::<crate::AppState>();

    if state.asyar_visible.load(Ordering::Relaxed)
        || !state.snippets_enabled.load(Ordering::Relaxed)
        || state.is_expanding.load(Ordering::SeqCst)
    {
        SNIPPET_BUFFER.with(|b| b.borrow_mut().clear());
        return;
    }

    if vk == VK_ESCAPE.0 as u32
        || vk == VK_RETURN.0 as u32
        || vk == VK_TAB.0 as u32
        || vk == VK_UP.0 as u32
        || vk == VK_DOWN.0 as u32
        || vk == VK_LEFT.0 as u32
        || vk == VK_RIGHT.0 as u32
    {
        SNIPPET_BUFFER.with(|b| b.borrow_mut().clear());
        return;
    }

    if vk == VK_BACK.0 as u32 {
        SNIPPET_BUFFER.with(|b| b.borrow_mut().pop());
        return;
    }

    let shift = SHIFT_HELD.load(Ordering::Relaxed)
        || (unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) } as u16 & 0x8000) != 0;

    if let Some(c) = asyar_platform::windows_key_resolver::resolve_vk_scan(vk, scan, shift) {
        SNIPPET_BUFFER.with(|b| {
            let mut buf = b.borrow_mut();
            crate::snippets::process_snippet_char(app, &mut buf, c);
        });
    }
}

pub fn register_snippet_monitor(app_handle: AppHandle) {
    std::thread::spawn(move || {
        let _ = SNIPPET_MONITOR_APP.set(app_handle);

        let hook = match unsafe {
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(snippet_keyboard_hook), None, 0)
        } {
            Ok(h) => h,
            Err(e) => {
                log::error!("[snippets] failed to install Windows keyboard hook: {e}");
                return;
            }
        };

        unsafe {
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(hook);
        }
    });
}
