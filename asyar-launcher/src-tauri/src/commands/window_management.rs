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
        let wid = *state.linux_prev_window_id.lock().map_err(|_| AppError::Lock)?;
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
    let update = WindowBoundsUpdate { x, y, width, height };
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
        let wid = *state.linux_prev_window_id.lock().map_err(|_| AppError::Lock)?;
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
        let wid = *state.linux_prev_window_id.lock().map_err(|_| AppError::Lock)?;
        return crate::window_management::linux::set_window_fullscreen(wid, enable);
    }

    #[allow(unreachable_code)]
    Err(AppError::Platform(
        "Window management is not supported on this platform.".to_string(),
    ))
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
        assert!(reg.check(&Some("ext-1".to_string()), "window:manage").is_ok());
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
