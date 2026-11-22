//! Shared host service for opening URLs/paths/deeplinks and picking local
//! files or folders safely across platforms and build modes.

use crate::error::AppError;
use std::path::PathBuf;
use tauri::AppHandle;

/// Resolves and validates a path for opener commands.
/// Expands `~` prefix to the user's home directory and ensures existence.
pub fn resolve_existing_path(path_str: &str) -> Result<PathBuf, AppError> {
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Path cannot be empty".to_string()));
    }

    let path = if trimmed == "~" || trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Other("Could not resolve user home directory".to_string()))?;
        if trimmed == "~" {
            home
        } else {
            home.join(&trimmed[2..])
        }
    } else {
        PathBuf::from(trimmed)
    };

    if !path.is_absolute() {
        return Err(AppError::Validation(format!(
            "Path must be absolute: {}",
            path_str
        )));
    }
    if !path.exists() {
        return Err(AppError::Other(format!(
            "Path does not exist: {}",
            path_str
        )));
    }
    Ok(path)
}

/// Opens a URL, deeplink, or local file/folder path with an optional target app.
pub fn open_link(app_handle: &AppHandle, link: &str, with: Option<&str>) -> Result<(), AppError> {
    let trimmed = link.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Link cannot be empty".to_string()));
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("javascript:")
        || lower.starts_with("data:")
        || lower.starts_with("vbscript:")
    {
        return Err(AppError::Validation(format!(
            "Unsupported link scheme: {}",
            trimmed
        )));
    }

    let target_app = with.map(str::trim).filter(|s| !s.is_empty());

    let is_local_path = trimmed == "~"
        || trimmed.starts_with("~/")
        || trimmed.starts_with("~\\")
        || trimmed.starts_with('/')
        || trimmed.starts_with("\\\\")
        || (trimmed.len() >= 3
            && trimmed.as_bytes()[0].is_ascii_alphabetic()
            && trimmed.as_bytes()[1] == b':'
            && (trimmed.as_bytes()[2] == b'\\' || trimmed.as_bytes()[2] == b'/'))
        || lower.starts_with("file://");

    use tauri_plugin_opener::OpenerExt;
    if is_local_path {
        let raw_path = if lower.starts_with("file://") {
            &trimmed[7..]
        } else {
            trimmed
        };
        let resolved = resolve_existing_path(raw_path)?;
        app_handle
            .opener()
            .open_path(resolved.to_string_lossy().to_string(), target_app)
            .map_err(|e| AppError::Other(format!("OS opener failed: {}", e)))
    } else {
        app_handle
            .opener()
            .open_url(trimmed, target_app)
            .map_err(|e| AppError::Other(format!("OS opener failed: {}", e)))
    }
}

#[cfg(target_os = "macos")]
async fn park_launcher_panel_sync(app_handle: &AppHandle) {
    use tauri::Manager;
    use tauri_nspanel::ManagerExt;
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let app = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Ok(panel) = app.get_webview_panel(crate::SPOTLIGHT_LABEL) {
            if let Some(window) = app.get_webview_window(crate::SPOTLIGHT_LABEL) {
                crate::platform::macos::park_launcher_panel(&window, &panel);
            }
        }
        let _ = tx.send(());
    });
    let _ = rx.await;
}

#[cfg(target_os = "macos")]
fn restore_launcher_panel(app_handle: &AppHandle) {
    let app = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        let _ = crate::commands::app::show_launcher(&app);
    });
}

/// Picks a local file or folder path.
///
/// On macOS dev builds (`debug_assertions`), the unbundled `target/debug/asyar`
/// binary lacks an `.app` bundle/signature, causing `com.apple.view-bridge` to
/// drop `+[NSOpenPanel openPanel]` (`NULL` panic); we therefore use
/// out-of-process `osascript` in debug builds and the instant native
/// `tauri_plugin_dialog` picker in release `.app` builds (and other OSes).
pub async fn pick_path(app_handle: &AppHandle, kind: &str) -> Result<Option<String>, AppError> {
    #[cfg(target_os = "macos")]
    park_launcher_panel_sync(app_handle).await;

    let result = pick_path_platform(app_handle, kind).await;

    #[cfg(target_os = "macos")]
    restore_launcher_panel(app_handle);

    result
}

#[cfg(all(target_os = "macos", debug_assertions))]
async fn pick_path_platform(
    _app_handle: &AppHandle,
    kind: &str,
) -> Result<Option<String>, AppError> {
    let choose_expr = match kind {
        "folder" => "POSIX path of (choose folder)",
        "json" => "POSIX path of (choose file of type {\"public.json\"})",
        "raycast" => "POSIX path of (choose file of type {\"public.json\", \"com.raycast.rayconfig\", \"rayconfig\"})",
        _ => "POSIX path of (choose file)",
    };
    let output = tokio::process::Command::new("osascript")
        .arg("-e")
        .arg("activate")
        .arg("-e")
        .arg(choose_expr)
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Failed to launch file picker: {e}")))?;

    if !output.status.success() {
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!path.is_empty()).then_some(path))
}

#[cfg(not(all(target_os = "macos", debug_assertions)))]
async fn pick_path_platform(
    app_handle: &AppHandle,
    kind: &str,
) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let builder = app_handle.dialog().file();
    match kind {
        "folder" => builder.pick_folder(move |p| {
            let _ = tx.send(p);
        }),
        "json" => builder.add_filter("JSON", &["json"]).pick_file(move |p| {
            let _ = tx.send(p);
        }),
        "raycast" => builder
            .add_filter("Raycast Export", &["rayconfig", "json"])
            .pick_file(move |p| {
                let _ = tx.send(p);
            }),
        _ => builder.pick_file(move |p| {
            let _ = tx.send(p);
        }),
    }
    let result = rx.await.ok().flatten();
    Ok(result.map(|p| p.to_string()))
}
