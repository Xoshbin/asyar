//! Window visibility and focus-lock commands.
//!
//! Controls showing, hiding, and focus-locking the launcher window.

use crate::{AppState, SPOTLIGHT_LABEL};
use crate::error::AppError;
use std::sync::atomic::Ordering;
use tauri::AppHandle;
#[allow(unused_imports)]
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

/// Makes the launcher window visible and brings it to focus.
#[tauri::command]
pub fn show(app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state.asyar_visible.store(true, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        panel.show();
    }
    #[cfg(not(target_os = "macos"))]
    {
        #[cfg(target_os = "windows")]
        {
            let prev = crate::platform::windows::capture_foreground_window();
            let mut previous_hwnd = state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
            *previous_hwnd = prev;
        }
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

/// Hides the launcher window.
#[tauri::command]
pub fn hide(app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state.asyar_visible.store(false, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        if panel.is_visible() {
            panel.order_out(None);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            #[cfg(target_os = "windows")]
            {
                let prev = *state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
                crate::platform::windows::restore_foreground_window(prev);
            }
        }
    }
    Ok(())
}

/// Locks or unlocks keyboard focus to prevent the window from losing focus.
#[tauri::command]
pub fn set_focus_lock(state: tauri::State<'_, AppState>, locked: bool) {
    state.focus_locked.store(locked, Ordering::Relaxed);
}
