#![cfg(target_os = "windows")]

use crate::error::AppError;
use crate::window_management::types::{AppWindowInfo, WindowBounds, WindowBoundsUpdate};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetWindowLongW, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, MoveWindow, PostMessageW,
    SetForegroundWindow, ShowWindow, GWL_EXSTYLE, SW_MAXIMIZE, SW_RESTORE, WM_CLOSE,
    WS_EX_TOOLWINDOW,
};

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
            "No previous window captured. Open Asyar via its launcher shortcut first.".to_string(),
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

pub fn set_window_bounds(
    previous_hwnd: isize,
    update: &WindowBoundsUpdate,
) -> Result<(), AppError> {
    if previous_hwnd == 0 {
        return Err(AppError::NotFound(
            "No previous window captured.".to_string(),
        ));
    }
    unsafe {
        let hwnd = HWND(previous_hwnd as *mut _);
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)
            .map_err(|e| AppError::Platform(format!("GetWindowRect failed: {e}")))?;

        let x = update.x.map(|v| v as i32).unwrap_or(rect.left);
        let y = update.y.map(|v| v as i32).unwrap_or(rect.top);
        let w = update
            .width
            .map(|v| v as i32)
            .unwrap_or(rect.right - rect.left);
        let h = update
            .height
            .map(|v| v as i32)
            .unwrap_or(rect.bottom - rect.top);

        MoveWindow(hwnd, x, y, w, h, true)
            .map_err(|e| AppError::Platform(format!("MoveWindow failed: {e}")))
    }
}

/// Maximizes (fullscreen equivalent on Windows) or restores the window.
pub fn set_window_fullscreen(previous_hwnd: isize, enable: bool) -> Result<(), AppError> {
    if previous_hwnd == 0 {
        return Err(AppError::NotFound(
            "No previous window captured.".to_string(),
        ));
    }
    unsafe {
        let hwnd = HWND(previous_hwnd as *mut _);
        let cmd = if enable { SW_MAXIMIZE } else { SW_RESTORE };
        ShowWindow(hwnd, cmd);
    }
    Ok(())
}

/// Enumerates visible top-level application windows on Windows.
pub fn list_windows(_app: &tauri::AppHandle) -> Result<Vec<AppWindowInfo>, AppError> {
    struct EnumState {
        windows: Vec<AppWindowInfo>,
        our_pid: u32,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = &mut *(lparam.0 as *mut EnumState);

        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if (ex_style & WS_EX_TOOLWINDOW.0) != 0 {
            return BOOL(1);
        }

        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return BOOL(1);
        }

        let mut title_buf = vec![0u16; (len + 1) as usize];
        let actual_len = GetWindowTextW(hwnd, &mut title_buf);
        if actual_len == 0 {
            return BOOL(1);
        }
        let title = String::from_utf16_lossy(&title_buf[..actual_len as usize]);
        let title = title.trim().to_string();
        if title.is_empty() {
            return BOOL(1);
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == state.our_pid {
            return BOOL(1);
        }

        let is_minimized = IsIconic(hwnd).as_bool();
        let is_focused = state.windows.is_empty();

        let app_name = title.clone();

        state.windows.push(AppWindowInfo {
            id: format!("win:{}", hwnd.0 as isize),
            pid: pid as i32,
            app_name,
            app_bundle_id: None,
            title,
            is_minimized,
            is_focused,
            app_icon: None,
        });

        BOOL(1)
    }

    let mut state = EnumState {
        windows: Vec::new(),
        our_pid: std::process::id(),
    };

    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut state as *mut _ as isize));
    }

    Ok(state.windows)
}

/// Restores and brings the target window to the foreground on Windows.
pub fn focus_window(id: &str) -> Result<(), AppError> {
    let raw = id.strip_prefix("win:").unwrap_or(id);
    let hwnd_val: isize = raw
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid Windows HWND: {id}")))?;
    if hwnd_val == 0 {
        return Err(AppError::NotFound("Null HWND".to_string()));
    }

    unsafe {
        let hwnd = HWND(hwnd_val as *mut _);
        if IsIconic(hwnd).as_bool() {
            ShowWindow(hwnd, SW_RESTORE);
        }
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
    }
    Ok(())
}

/// Closes the target window on Windows by posting WM_CLOSE.
pub fn close_window(id: &str) -> Result<(), AppError> {
    let raw = id.strip_prefix("win:").unwrap_or(id);
    let hwnd_val: isize = raw
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid Windows HWND: {id}")))?;
    if hwnd_val == 0 {
        return Err(AppError::NotFound("Null HWND".to_string()));
    }

    unsafe {
        let hwnd = HWND(hwnd_val as *mut _);
        let _ = PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_to_bounds_basic() {
        let rect = RECT {
            left: 100,
            top: 200,
            right: 1380,
            bottom: 1000,
        };
        let bounds = rect_to_bounds(&rect);
        assert_eq!(bounds.x, 100.0);
        assert_eq!(bounds.y, 200.0);
        assert_eq!(bounds.width, 1280.0);
        assert_eq!(bounds.height, 800.0);
    }

    #[test]
    fn rect_to_bounds_at_origin() {
        let rect = RECT {
            left: 0,
            top: 0,
            right: 800,
            bottom: 600,
        };
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
        let update = WindowBoundsUpdate {
            x: Some(0.0),
            y: None,
            width: None,
            height: None,
        };
        assert!(set_window_bounds(0, &update).is_err());
    }

    #[test]
    fn set_window_fullscreen_rejects_null_hwnd() {
        assert!(set_window_fullscreen(0, true).is_err());
    }

    #[test]
    fn focus_window_rejects_invalid_hwnd() {
        assert!(focus_window("win:0").is_err());
        assert!(focus_window("invalid").is_err());
    }

    #[test]
    fn close_window_rejects_invalid_hwnd() {
        assert!(close_window("win:0").is_err());
        assert!(close_window("invalid").is_err());
    }
}
