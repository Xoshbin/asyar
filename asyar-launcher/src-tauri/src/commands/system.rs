//! System integration commands.
//!
//! Manages autostart, outbound HTTP requests, and a few miscellaneous
//! platform integrations. Notifications moved to `crate::notifications`.

use crate::error::AppError;
use log::info;
use std::collections::HashMap;
use tauri::AppHandle;

/// Enables or disables launching Asyar at login (autostart).
#[tauri::command]
pub async fn initialize_autostart_from_settings(
    app_handle: AppHandle,
    enable: bool,
) -> Result<(), AppError> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app_handle.autolaunch();
        let current_status = autostart_manager.is_enabled().unwrap_or(false);

        info!(
            "Initializing autostart: should be {}, currently {}",
            enable, current_status
        );

        if enable && !current_status {
            autostart_manager
                .enable()
                .map_err(|e| AppError::Platform(format!("Failed to enable autostart: {}", e)))?;
        } else if !enable && current_status {
            autostart_manager
                .disable()
                .map_err(|e| AppError::Platform(format!("Failed to disable autostart: {}", e)))?;
        }

        // Verify the change was successful
        let new_status = autostart_manager.is_enabled().unwrap_or(false);
        if new_status != enable {
            return Err(AppError::Platform(format!(
                "Failed to set autostart: expected {}, got {}",
                enable, new_status
            )));
        }
    }

    Ok(())
}

/// Returns `true` if Asyar is configured to launch at login.
#[tauri::command]
pub async fn get_autostart_status(app_handle: AppHandle) -> Result<bool, AppError> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app_handle.autolaunch();
        match autostart_manager.is_enabled() {
            Ok(enabled) => Ok(enabled),
            Err(e) => Err(AppError::Platform(format!(
                "Failed to get autostart status: {}",
                e
            ))),
        }
    }

    #[cfg(not(desktop))]
    {
        let _ = app_handle;
        return Ok(false);
    }
}

/// Performs an outbound HTTP request and returns the JSON response body.
/// Thin wrapper: enforces the per-extension `network` permission and the
/// SSRF guard, then delegates to `network::service::fetch`.
#[tauri::command]
pub async fn fetch_url(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
) -> Result<serde_json::Value, AppError> {
    registry.check(&caller_extension_id, "network")?;
    crate::network::service::validate_url_for_ssrf(&url)?;

    crate::network::service::fetch(crate::network::service::FetchRequest {
        url,
        method,
        headers,
        body,
        timeout_ms,
    })
    .await
}

#[tauri::command]
pub async fn ws_connect(
    socket_id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    ws_manager: tauri::State<'_, crate::network::websocket::WebSocketManager>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    registry.check(&caller_extension_id, "network")?;
    crate::network::service::validate_url_for_ssrf(&url)?;

    let ext_id = caller_extension_id.unwrap_or_else(|| "system".to_string());
    ws_manager
        .connect(socket_id, url, headers, ext_id, app)
        .await
}

#[tauri::command]
pub async fn ws_send(
    socket_id: String,
    message: String,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    ws_manager: tauri::State<'_, crate::network::websocket::WebSocketManager>,
) -> Result<(), AppError> {
    registry.check(&caller_extension_id, "network")?;
    let ext_id = caller_extension_id.unwrap_or_else(|| "system".to_string());
    ws_manager.send(&socket_id, message, &ext_id)
}

#[tauri::command]
pub async fn ws_close(
    socket_id: String,
    code: Option<u16>,
    reason: Option<String>,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    ws_manager: tauri::State<'_, crate::network::websocket::WebSocketManager>,
) -> Result<(), AppError> {
    registry.check(&caller_extension_id, "network")?;
    let ext_id = caller_extension_id.unwrap_or_else(|| "system".to_string());
    ws_manager.close(&socket_id, code, reason, &ext_id)
}
