#![cfg(target_os = "windows")]

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, MoveWindow, ShowWindow,
    SW_MAXIMIZE, SW_RESTORE,
};
use crate::error::AppError;
use crate::window_management::types::{WindowBounds, WindowBoundsUpdate};

/// Converts a Win32 RECT (left, top, right, bottom) to WindowBounds.
pub fn rect_to_bounds(rect: &RECT) -> WindowBounds {
    WindowBounds {
        x: rect.left as f64,
        y: rect.top as f64,
        width: (rect.right - rect.left) as f64,
        height: (rect.bottom - rect.top) as f64,
    }
}

pub fn get_window_bounds(previous_hwnd: isize) -> Result<WindowBounds, AppError> {
    if previous_hwnd == 0 {
        return Err(AppError::NotFound(
            "No previous window captured. Open Asyar via its launcher shortcut first.".to_string()
        ));
    }
    unsafe {
        let hwnd = HWND(previous_hwnd as *mut _);
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)
            .map_err(|e| AppError::Platform(format!("GetWindowRect failed: {e}")))?;
        Ok(rect_to_bounds(&rect))
    }
}

pub fn set_window_bounds(previous_hwnd: isize, update: &WindowBoundsUpdate) -> Result<(), AppError> {
    if previous_hwnd == 0 {
        return Err(AppError::NotFound(
            "No previous window captured.".to_string()
        ));
    }
    unsafe {
        let hwnd = HWND(previous_hwnd as *mut _);
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)
            .map_err(|e| AppError::Platform(format!("GetWindowRect failed: {e}")))?;

        let x = update.x.map(|v| v as i32).unwrap_or(rect.left);
        let y = update.y.map(|v| v as i32).unwrap_or(rect.top);
        let w = update.width.map(|v| v as i32).unwrap_or(rect.right - rect.left);
        let h = update.height.map(|v| v as i32).unwrap_or(rect.bottom - rect.top);

        MoveWindow(hwnd, x, y, w, h, true)
            .map_err(|e| AppError::Platform(format!("MoveWindow failed: {e}")))
    }
}

/// Maximizes (fullscreen equivalent on Windows) or restores the window.
pub fn set_window_fullscreen(previous_hwnd: isize, enable: bool) -> Result<(), AppError> {
    if previous_hwnd == 0 {
        return Err(AppError::NotFound("No previous window captured.".to_string()));
    }
    unsafe {
        let hwnd = HWND(previous_hwnd as *mut _);
        let cmd = if enable { SW_MAXIMIZE } else { SW_RESTORE };
        ShowWindow(hwnd, cmd);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_to_bounds_basic() {
        let rect = RECT { left: 100, top: 200, right: 1380, bottom: 1000 };
        let bounds = rect_to_bounds(&rect);
        assert_eq!(bounds.x, 100.0);
        assert_eq!(bounds.y, 200.0);
        assert_eq!(bounds.width, 1280.0);
        assert_eq!(bounds.height, 800.0);
    }

    #[test]
    fn rect_to_bounds_at_origin() {
        let rect = RECT { left: 0, top: 0, right: 800, bottom: 600 };
        let bounds = rect_to_bounds(&rect);
        assert_eq!(bounds.x, 0.0);
        assert_eq!(bounds.y, 0.0);
        assert_eq!(bounds.width, 800.0);
        assert_eq!(bounds.height, 600.0);
    }

    #[test]
    fn get_window_bounds_rejects_null_hwnd() {
        let result = get_window_bounds(0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }

    #[test]
    fn set_window_bounds_rejects_null_hwnd() {
        let update = WindowBoundsUpdate { x: Some(0.0), y: None, width: None, height: None };
        assert!(set_window_bounds(0, &update).is_err());
    }

    #[test]
    fn set_window_fullscreen_rejects_null_hwnd() {
        assert!(set_window_fullscreen(0, true).is_err());
    }
}
