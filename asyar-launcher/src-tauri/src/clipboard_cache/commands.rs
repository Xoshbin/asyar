//! Thin Tauri command layer for [`crate::clipboard_cache`]. All logic —
//! including the id and path validation — lives in the parent module so it
//! is unit testable without a running Tauri app; this only resolves the app
//! data directory and delegates.

use tauri::{AppHandle, Manager};

fn app_data_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))
}

/// Moves the clipboard plugin's freshly written PNG into the history item's
/// own cache slot and returns the new absolute path, which the row stores as
/// its content.
#[tauri::command]
pub async fn clipboard_adopt_image<R: tauri::Runtime>(
    id: String,
    source_path: String,
    app: AppHandle<R>,
) -> Result<String, String> {
    let root = app_data_dir(&app)?;
    let dest = crate::clipboard_cache::adopt_image(&root, &id, std::path::Path::new(&source_path))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Deletes a cached image when its history row goes away. Paths outside
/// `clipboard_cache/` are ignored rather than rejected — legacy rows still
/// point into the plugin's shared directory, and deleting there would break
/// other rows holding the same image.
#[tauri::command]
pub async fn clipboard_forget_image<R: tauri::Runtime>(
    path: String,
    app: AppHandle<R>,
) -> Result<(), String> {
    let root = app_data_dir(&app)?;
    crate::clipboard_cache::forget_image(&root, std::path::Path::new(&path))
}
