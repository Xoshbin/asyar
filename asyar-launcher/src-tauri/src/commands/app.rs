use crate::{AppState, SPOTLIGHT_LABEL};
use std::sync::atomic::Ordering;
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

#[tauri::command]
pub fn show(app_handle: AppHandle, state: tauri::State<'_, AppState>) {
    state.asyar_visible.store(true, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL).unwrap();
        panel.show();
    }
    #[cfg(not(target_os = "macos"))]
    {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
            let prev = unsafe { GetForegroundWindow() };
            *state.previous_hwnd.lock().unwrap() = prev.0 as isize;
        }
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL).unwrap();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn hide(app_handle: AppHandle, state: tauri::State<'_, AppState>) {
    state.asyar_visible.store(false, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL).unwrap();
        if panel.is_visible() {
            panel.order_out(None);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL).unwrap();
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            #[cfg(target_os = "windows")]
            {
                use windows::Win32::Foundation::HWND;
                use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
                let prev = *state.previous_hwnd.lock().unwrap();
                if prev != 0 {
                    unsafe { SetForegroundWindow(HWND(prev as *mut _)); }
                }
            }
        }
    }
}

#[tauri::command]
pub fn set_focus_lock(state: tauri::State<'_, AppState>, locked: bool) {
    state.focus_locked.store(locked, Ordering::Relaxed);
}
