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
        #[cfg(target_os = "linux")]
        {
            let wid = crate::window_management::linux::capture_active_window_id();
            let mut prev = state.linux_prev_window_id.lock().map_err(|_| AppError::Lock)?;
            *prev = wid;
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

/// Validates a launcher height value before it reaches platform window APIs.
/// Rejects NaN, Infinity, and values outside the allowed range.
fn validate_launcher_height(height: f64) -> Result<(), AppError> {
    if !height.is_finite() {
        return Err(AppError::Validation(format!(
            "launcher height must be finite, got {height}"
        )));
    }
    if !(50.0..=2000.0).contains(&height) {
        return Err(AppError::Validation(format!(
            "launcher height must be between 50 and 2000, got {height}"
        )));
    }
    Ok(())
}

/// Resizes the launcher window height, keeping the top edge pinned.
#[tauri::command]
pub fn set_launcher_height(app_handle: AppHandle, height: f64) -> Result<(), AppError> {
    validate_launcher_height(height)?;
    let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
        .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;

    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSRect, NSPoint, NSSize};
        let frame = crate::platform::macos::get_window_frame(&window);
        let top = frame.origin.y + frame.size.height;
        let rect = NSRect {
            origin: NSPoint {
                x: frame.origin.x,
                y: top - height,
            },
            size: NSSize {
                width: frame.size.width,
                height,
            },
        };
        crate::platform::macos::set_window_frame(&window, rect);
    }

    #[cfg(not(target_os = "macos"))]
    {
        use tauri::LogicalSize;
        let size = window.inner_size().map_err(|e| AppError::Platform(e.to_string()))?;
        let scale = window.scale_factor().unwrap_or(1.0);
        let logical_width = size.width as f64 / scale;
        let _ = window.set_size(tauri::Size::Logical(LogicalSize {
            width: logical_width,
            height,
        }));
    }

    Ok(())
}

/// Cleanly exits the application.
#[tauri::command]
pub fn quit_app(app_handle: AppHandle) {
    app_handle.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_nan() {
        assert!(validate_launcher_height(f64::NAN).is_err());
    }

    #[test]
    fn rejects_positive_infinity() {
        assert!(validate_launcher_height(f64::INFINITY).is_err());
    }

    #[test]
    fn rejects_negative_infinity() {
        assert!(validate_launcher_height(f64::NEG_INFINITY).is_err());
    }

    #[test]
    fn rejects_zero() {
        assert!(validate_launcher_height(0.0).is_err());
    }

    #[test]
    fn rejects_negative() {
        assert!(validate_launcher_height(-10.0).is_err());
    }

    #[test]
    fn rejects_below_minimum() {
        assert!(validate_launcher_height(49.9).is_err());
    }

    #[test]
    fn rejects_above_maximum() {
        assert!(validate_launcher_height(2000.1).is_err());
    }

    #[test]
    fn accepts_compact_height() {
        assert!(validate_launcher_height(96.0).is_ok());
    }

    #[test]
    fn accepts_default_height() {
        assert!(validate_launcher_height(560.0).is_ok());
    }

    #[test]
    fn accepts_minimum_boundary() {
        assert!(validate_launcher_height(50.0).is_ok());
    }

    #[test]
    fn accepts_maximum_boundary() {
        assert!(validate_launcher_height(2000.0).is_ok());
    }

    #[test]
    fn error_is_validation_variant() {
        let err = validate_launcher_height(f64::NAN).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
