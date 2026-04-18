//! Application discovery and launch commands.
//!
//! Thin Tauri command wrappers delegating to `crate::application::service`.

use crate::search_engine::SearchState;
use crate::error::AppError;
use crate::application::service::{self, FrontmostApplication, SyncResult};
use crate::search_engine::models::Application;
use std::path::PathBuf;
use tauri::AppHandle;

/// Scans installed applications, diffs against the current search index,
/// and updates the index.
#[tauri::command]
pub async fn sync_application_index(
    app: AppHandle,
    search_state: tauri::State<'_, SearchState>,
    extra_paths: Option<Vec<String>>,
) -> Result<SyncResult, AppError> {
    let paths = extra_paths.unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
        
    service::sync_application_index(&app, &search_state, paths)
}

/// Returns all installed applications found in system scan paths.
#[tauri::command]
pub async fn list_applications(
    app: AppHandle,
    extra_paths: Option<Vec<String>>,
) -> Result<Vec<Application>, AppError> {
    let paths = extra_paths.unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
        
    service::list_applications(&app, paths)
}

/// Retrieves metadata about the currently focused application.
#[tauri::command]
pub async fn get_frontmost_application() -> Result<FrontmostApplication, AppError> {
    service::get_frontmost_application()
}

#[tauri::command]
pub fn get_default_app_scan_paths() -> Vec<String> {
    service::get_default_app_scan_paths()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Normalizes a user-supplied scan path: trims whitespace and strips a
/// trailing separator. Canonicalization of the duplicate-against-defaults
/// check lives in Rust, so the UI stays display-only.
#[tauri::command]
pub fn normalize_scan_path(path: String) -> String {
    service::normalize_scan_path(&path)
}

/// Opens an application at the given file system path.
#[tauri::command]
pub fn open_application_path(
    app_handle: AppHandle,
    path: String,
) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    app_handle
        .opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| AppError::Platform(format!("Failed to open path '{}': {}", path, e)))
}
