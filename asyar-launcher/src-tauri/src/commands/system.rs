use crate::tray::TRAY_ID;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::AppHandle;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::Manager;

/// Data structure for a single extension tray menu item.
/// `id` is composite: "extensionId:itemId" — used to route click events to the right extension.
#[derive(Debug, Serialize, Deserialize)]
pub struct TrayMenuItemDef {
    pub id: String,      // e.g., "org.asyar.pomodoro:timer-status"
    pub label: String,   // display text, e.g., "🍅 18:32"
}

#[tauri::command]
pub async fn initialize_autostart_from_settings(
    app_handle: AppHandle,
    enable: bool,
) -> Result<(), String> {
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
            if let Err(e) = autostart_manager.enable() {
                return Err(format!("Failed to enable autostart: {}", e));
            }
        } else if !enable && current_status {
            if let Err(e) = autostart_manager.disable() {
                return Err(format!("Failed to disable autostart: {}", e));
            }
        }

        // Verify the change was successful
        let new_status = autostart_manager.is_enabled().unwrap_or(false);
        if new_status != enable {
            return Err(format!(
                "Failed to set autostart: expected {}, got {}",
                enable, new_status
            ));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_autostart_status(app_handle: AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app_handle.autolaunch();
        match autostart_manager.is_enabled() {
            Ok(enabled) => return Ok(enabled),
            Err(e) => return Err(format!("Failed to get autostart status: {}", e)),
        }
    }

    #[cfg(not(desktop))]
    {
        let _ = app_handle;
        return Ok(false);
    }
}

/// Rebuilds the tray menu with current extension status items plus static Quit/Settings.
/// Called from the frontend whenever statusBarItemsStore changes.
#[tauri::command]
pub fn update_tray_menu(
    app_handle: AppHandle,
    items: Vec<TrayMenuItemDef>,
) -> Result<(), String> {
    let menu = Menu::new(&app_handle).map_err(|e| e.to_string())?;

    // Add extension status items at the top
    for item_def in &items {
        let menu_item = MenuItem::with_id(
            &app_handle,
            &item_def.id,
            &item_def.label,
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        menu.append(&menu_item).map_err(|e| e.to_string())?;
    }

    // Separator between extension items and static items (only if there are extension items)
    if !items.is_empty() {
        let sep = PredefinedMenuItem::separator(&app_handle).map_err(|e| e.to_string())?;
        menu.append(&sep).map_err(|e| e.to_string())?;
    }

    // Static items always at the bottom
    let settings_i = MenuItem::with_id(&app_handle, "settings", "Settings", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit_i = MenuItem::with_id(&app_handle, "quit", "Quit Asyar", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    menu.append(&settings_i).map_err(|e| e.to_string())?;
    menu.append(&quit_i).map_err(|e| e.to_string())?;

    // Apply to the tray icon
    let tray = app_handle
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon not found".to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;

    Ok(())
}

/// HTTP fetch that forces IPv4 to avoid the reqwest IPv6 Happy Eyeballs stall on macOS.
/// Returns the response body as a string alongside status metadata.
#[tauri::command]
pub async fn fetch_url(url: String, method: Option<String>, headers: Option<HashMap<String, String>>, timeout_ms: Option<u64>) -> Result<serde_json::Value, String> {
    use std::net::{IpAddr, Ipv4Addr};

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(20000));

    let client = reqwest::Client::builder()
        .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED)) // force IPv4
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(timeout)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")
        .build()
        .map_err(|e| e.to_string())?;

    let req_method = match method.as_deref().unwrap_or("GET") {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(req_method, &url);
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(&k, &v);
        }
    }

    let response = req.send().await.map_err(|e| e.to_string())?;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let ok = response.status().is_success();

    let mut resp_headers = serde_json::Map::new();
    for (key, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(key.as_str().to_string(), serde_json::Value::String(v.to_string()));
        }
    }

    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "status": status,
        "statusText": status_text,
        "headers": resp_headers,
        "body": body,
        "ok": ok,
    }))
}

/// Send a system notification.
#[tauri::command]
pub fn send_notification(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    {
        let _ = &app;
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            body.replace('"', "\\\""),
            title.replace('"', "\\\"")
        );
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn()
            .map_err(|e| format!("osascript error: {}", e))?;
        return Ok(());
    }

    #[cfg(not(all(debug_assertions, target_os = "macos")))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(&title)
            .body(&body)
            .show()
            .map_err(|e| e.to_string())
    }
}
