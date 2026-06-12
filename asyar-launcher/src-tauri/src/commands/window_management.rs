//! Tauri command wrappers for the window management feature.
//!
//! Each command requires the `window:manage` permission and dispatches to the
//! appropriate platform implementation.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use crate::window_management::types::{validate_bounds_update, WindowBounds, WindowBoundsUpdate};
use crate::AppState;

/// Returns the bounds of the frontmost OS application window.
/// Requires 'window:manage' permission.
#[tauri::command]
#[allow(unused_variables)]
pub async fn window_management_get_bounds(
    state: tauri::State<'_, AppState>,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<WindowBounds, AppError> {
    permissions.check(&extension_id, "window:manage")?;

    #[cfg(target_os = "macos")]
    return crate::window_management::macos::get_window_bounds();

    #[cfg(target_os = "windows")]
    {
        let hwnd = *state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
        return crate::window_management::windows::get_window_bounds(hwnd);
    }

    #[cfg(target_os = "linux")]
    {
        let wid = *state
            .linux_prev_window_id
            .lock()
            .map_err(|_| AppError::Lock)?;
        return crate::window_management::linux::get_window_bounds(wid);
    }

    #[allow(unreachable_code)]
    Err(AppError::Platform(
        "Window management is not supported on this platform.".to_string(),
    ))
}

/// Updates the bounds of the frontmost OS application window.
/// Requires 'window:manage' permission.
#[tauri::command]
#[allow(unused_variables)]
pub async fn window_management_set_bounds(
    state: tauri::State<'_, AppState>,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), AppError> {
    permissions.check(&extension_id, "window:manage")?;
    let update = WindowBoundsUpdate {
        x,
        y,
        width,
        height,
    };
    validate_bounds_update(&update)?;

    #[cfg(target_os = "macos")]
    return crate::window_management::macos::set_window_bounds(&update);

    #[cfg(target_os = "windows")]
    {
        let hwnd = *state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
        return crate::window_management::windows::set_window_bounds(hwnd, &update);
    }

    #[cfg(target_os = "linux")]
    {
        let wid = *state
            .linux_prev_window_id
            .lock()
            .map_err(|_| AppError::Lock)?;
        return crate::window_management::linux::set_window_bounds(wid, &update);
    }

    #[allow(unreachable_code)]
    Err(AppError::Platform(
        "Window management is not supported on this platform.".to_string(),
    ))
}

/// Toggles the fullscreen state of the frontmost OS application window.
/// Requires 'window:manage' permission.
#[tauri::command]
#[allow(unused_variables)]
pub async fn window_management_set_fullscreen(
    state: tauri::State<'_, AppState>,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    enable: bool,
) -> Result<(), AppError> {
    permissions.check(&extension_id, "window:manage")?;

    #[cfg(target_os = "macos")]
    return crate::window_management::macos::set_window_fullscreen(enable);

    #[cfg(target_os = "windows")]
    {
        let hwnd = *state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
        return crate::window_management::windows::set_window_fullscreen(hwnd, enable);
    }

    #[cfg(target_os = "linux")]
    {
        let wid = *state
            .linux_prev_window_id
            .lock()
            .map_err(|_| AppError::Lock)?;
        return crate::window_management::linux::set_window_fullscreen(wid, enable);
    }

    #[allow(unreachable_code)]
    Err(AppError::Platform(
        "Window management is not supported on this platform.".to_string(),
    ))
}

/// Returns all available monitors with their logical bounds.
/// Requires 'window:manage' permission.
#[tauri::command]
#[allow(unused_variables)]
pub fn window_management_get_monitors(
    app: tauri::AppHandle,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<Vec<WindowBounds>, AppError> {
    permissions.check(&extension_id, "window:manage")?;

    let monitors = app
        .available_monitors()
        .map_err(|e| AppError::Platform(format!("available_monitors: {e}")))?;

    let mut result = Vec::new();
    for m in monitors {
        let scale = m.scale_factor();
        let size = m.size().to_logical::<f64>(scale);
        let pos = m.position().to_logical::<f64>(scale);
        result.push(WindowBounds {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
        });
    }

    Ok(result)
}

/// Applies a preset layout to the frontmost OS application window relative to the monitor it is on.
/// Requires 'window:manage' permission.
#[tauri::command]
#[allow(unused_variables)]
pub fn window_management_apply_preset(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    preset_id: String,
) -> Result<(), AppError> {
    permissions.check(&extension_id, "window:manage")?;

    let current_bounds = {
        #[cfg(target_os = "macos")]
        {
            crate::window_management::macos::get_window_bounds()?
        }
        #[cfg(target_os = "windows")]
        {
            let hwnd = *state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
            crate::window_management::windows::get_window_bounds(hwnd)?
        }
        #[cfg(target_os = "linux")]
        {
            let wid = *state
                .linux_prev_window_id
                .lock()
                .map_err(|_| AppError::Lock)?;
            crate::window_management::linux::get_window_bounds(wid)?
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            return Err(AppError::Platform(
                "Window management is not supported on this platform.".to_string(),
            ));
        }
    };

    let monitors = app
        .available_monitors()
        .map_err(|e| AppError::Platform(format!("available_monitors: {e}")))?;

    let mut target_monitor = None;
    if !monitors.is_empty() {
        let mut best_monitor = &monitors[0];
        let mut max_overlap = -1.0;

        for m in &monitors {
            let scale = m.scale_factor();
            let size = m.size().to_logical::<f64>(scale);
            let pos = m.position().to_logical::<f64>(scale);

            let overlap_x = (current_bounds.x + current_bounds.width).min(pos.x + size.width) - current_bounds.x.max(pos.x);
            let overlap_y = (current_bounds.y + current_bounds.height).min(pos.y + size.height) - current_bounds.y.max(pos.y);
            let overlap = overlap_x.max(0.0) * overlap_y.max(0.0);

            if overlap > max_overlap {
                max_overlap = overlap;
                best_monitor = m;
            }
        }

        if max_overlap <= 0.0 {
            let wcx = current_bounds.x + current_bounds.width / 2.0;
            let wcy = current_bounds.y + current_bounds.height / 2.0;
            let mut min_dist = f64::INFINITY;
            for m in &monitors {
                let scale = m.scale_factor();
                let size = m.size().to_logical::<f64>(scale);
                let pos = m.position().to_logical::<f64>(scale);
                let mcx = pos.x + size.width / 2.0;
                let mcy = pos.y + size.height / 2.0;
                let dist = ((wcx - mcx).powi(2) + (wcy - mcy).powi(2)).sqrt();
                if dist < min_dist {
                    min_dist = dist;
                    best_monitor = m;
                }
            }
        }
        target_monitor = Some(best_monitor);
    }

    let (mx, my, mw, mh) = if let Some(m) = target_monitor {
        let scale = m.scale_factor();
        let size = m.size().to_logical::<f64>(scale);
        let pos = m.position().to_logical::<f64>(scale);
        (pos.x, pos.y, size.width, size.height)
    } else {
        (0.0, 0.0, 1920.0, 1080.0)
    };

    let apply_fullscreen = |enable: bool| -> Result<(), AppError> {
        #[cfg(target_os = "macos")]
        {
            crate::window_management::macos::set_window_fullscreen(enable)
        }
        #[cfg(target_os = "windows")]
        {
            let hwnd = *state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
            crate::window_management::windows::set_window_fullscreen(hwnd, enable)
        }
        #[cfg(target_os = "linux")]
        {
            let wid = *state
                .linux_prev_window_id
                .lock()
                .map_err(|_| AppError::Lock)?;
            crate::window_management::linux::set_window_fullscreen(wid, enable)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Err(AppError::Platform(
                "Window management is not supported on this platform.".to_string(),
            ))
        }
    };

    let apply_bounds = |update: &WindowBoundsUpdate| -> Result<(), AppError> {
        #[cfg(target_os = "macos")]
        {
            crate::window_management::macos::set_window_bounds(update)
        }
        #[cfg(target_os = "windows")]
        {
            let hwnd = *state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
            crate::window_management::windows::set_window_bounds(hwnd, update)
        }
        #[cfg(target_os = "linux")]
        {
            let wid = *state
                .linux_prev_window_id
                .lock()
                .map_err(|_| AppError::Lock)?;
            crate::window_management::linux::set_window_bounds(wid, update)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Err(AppError::Platform(
                "Window management is not supported on this platform.".to_string(),
            ))
        }
    };

    if preset_id == "maximize" {
        apply_fullscreen(true)?;
    } else {
        let (x, y, w, h) = match preset_id.as_str() {
            "left-half" => (mx, my, mw / 2.0, mh),
            "right-half" => (mx + mw / 2.0, my, mw / 2.0, mh),
            "top-half" => (mx, my, mw, mh / 2.0),
            "bottom-half" => (mx, my + mh / 2.0, mw, mh / 2.0),
            "top-left-quarter" => (mx, my, mw / 2.0, mh / 2.0),
            "top-right-quarter" => (mx + mw / 2.0, my, mw / 2.0, mh / 2.0),
            "bottom-left-quarter" => (mx, my + mh / 2.0, mw / 2.0, mh / 2.0),
            "bottom-right-quarter" => (mx + mw / 2.0, my + mh / 2.0, mw / 2.0, mh / 2.0),
            "left-third" => (mx, my, mw / 3.0, mh),
            "center-third" => (mx + mw / 3.0, my, mw / 3.0, mh),
            "right-third" => (mx + (mw / 3.0) * 2.0, my, mw / 3.0, mh),
            "left-two-thirds" => (mx, my, (mw / 3.0) * 2.0, mh),
            "right-two-thirds" => (mx + mw / 3.0, my, (mw / 3.0) * 2.0, mh),
            "center" => (mx + mw * 0.1, my + mh * 0.1, mw * 0.8, mh * 0.8),
            "almost-maximize" => (mx + mw * 0.05, my + mh * 0.05, mw * 0.9, mh * 0.9),
            _ => return Err(AppError::Validation(format!("Unknown preset ID: {preset_id}"))),
        };

        apply_bounds(&WindowBoundsUpdate {
            x: Some(x),
            y: Some(y),
            width: Some(w),
            height: Some(h),
        })?;
    }

    Ok(())
}



#[cfg(test)]
mod tests {
    use super::*;
    use crate::permissions::ExtensionPermissionRegistry;

    fn make_registry_with(id: &str, perms: &[&str]) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        inner.insert(
            id.to_string(),
            perms.iter().map(|s| s.to_string()).collect(),
        );
        drop(inner);
        reg
    }

    #[test]
    fn permission_check_blocks_missing_permission() {
        let reg = make_registry_with("ext-1", &["clipboard:read"]);
        let result = reg.check(&Some("ext-1".to_string()), "window:manage");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Permission(_)));
    }

    #[test]
    fn permission_check_allows_with_correct_permission() {
        let reg = make_registry_with("ext-1", &["window:manage"]);
        assert!(reg
            .check(&Some("ext-1".to_string()), "window:manage")
            .is_ok());
    }

    #[test]
    fn validate_bounds_update_rejects_all_none_in_command() {
        let update = WindowBoundsUpdate {
            x: None,
            y: None,
            width: None,
            height: None,
        };
        assert!(validate_bounds_update(&update).is_err());
    }
}
