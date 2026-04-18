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
            autostart_manager.enable().map_err(|e| AppError::Platform(format!("Failed to enable autostart: {}", e)))?;
        } else if !enable && current_status {
            autostart_manager.disable().map_err(|e| AppError::Platform(format!("Failed to disable autostart: {}", e)))?;
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
            Err(e) => Err(AppError::Platform(format!("Failed to get autostart status: {}", e))),
        }
    }

    #[cfg(not(desktop))]
    {
        let _ = app_handle;
        return Ok(false);
    }
}

/// Validates a URL to prevent SSRF attacks.
/// Blocks non-http(s) schemes, localhost, loopback addresses, and private IP ranges.
fn validate_url_for_ssrf(url: &str) -> Result<(), crate::error::AppError> {
    use url::Url;
    use std::net::IpAddr;

    let parsed = Url::parse(url)
        .map_err(|_| crate::error::AppError::Other(format!("Invalid URL: {}", url)))?;

    // Only allow http and https schemes
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(crate::error::AppError::Other(format!(
                "URL scheme '{}' is not allowed. Only http and https are permitted.",
                scheme
            )));
        }
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| crate::error::AppError::Other("URL has no host".to_string()))?;

    // Block localhost by name
    if host.eq_ignore_ascii_case("localhost") {
        return Err(crate::error::AppError::Other(
            "Requests to localhost are not allowed".to_string(),
        ));
    }

    // Block if host parses as a private/loopback IP address
    if let Ok(ip) = host.parse::<IpAddr>() {
        let blocked = match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()       // 127.0.0.0/8
                    || v4.is_private() // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                    || v4.is_link_local() // 169.254.0.0/16
                    || v4.is_unspecified() // 0.0.0.0
                    || v4.is_broadcast() // 255.255.255.255
            }
            IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        };
        if blocked {
            return Err(crate::error::AppError::Other(format!(
                "Requests to private or loopback address '{}' are not allowed",
                ip
            )));
        }
    }

    Ok(())
}

/// Performs an outbound HTTP request and returns the JSON response body.
#[tauri::command]
pub async fn fetch_url(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
) -> Result<serde_json::Value, AppError> {
    registry.check(&caller_extension_id, "network")?;
    validate_url_for_ssrf(&url)?;

    use std::net::{IpAddr, Ipv4Addr};

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(20000));

    let client = reqwest::Client::builder()
        .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED)) // force IPv4
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(timeout)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")
        .build()?;

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

    let response = req.send().await?;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let ok = response.status().is_success();

    let mut resp_headers = serde_json::Map::new();
    for (key, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(key.as_str().to_string(), serde_json::Value::String(v.to_string()));
        }
    }

    let body = response.text().await?;

    Ok(serde_json::json!({
        "status": status,
        "statusText": status_text,
        "headers": resp_headers,
        "body": body,
        "ok": ok,
    }))
}

/// Returns the current operating system identifier ("macos", "windows", or "linux").
/// Used by the store feature to filter platform-incompatible extensions.
#[tauri::command]
pub fn get_current_platform() -> String {
    std::env::consts::OS.to_string()
}
