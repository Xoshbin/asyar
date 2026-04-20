//! Application discovery and launch commands.
//!
//! Thin Tauri command wrappers delegating to `crate::application::service`.

use crate::search_engine::SearchState;
use crate::error::AppError;
use crate::application::service::{self, FrontmostApplication, SyncResult};
use crate::application::{uninstall, IndexWatcher};
use crate::permissions::ExtensionPermissionRegistry;
use crate::search_engine::models::Application;
use std::path::PathBuf;
use std::sync::Arc;
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

/// Pushes the user-configured `additionalScanPaths` down to the Rust
/// index watcher. Called by `applicationService` whenever the TS settings
/// service reports a change to `search.additionalScanPaths`.
///
/// The watcher re-arms itself idempotently — unchanged paths stay watched,
/// removed paths are unwatched, new paths are watched. A missing watcher
/// (e.g. when setup hasn't finished yet) is a silent no-op so the settings
/// service doesn't need to know about lifecycle ordering.
#[tauri::command]
pub fn set_application_scan_paths(
    watcher: tauri::State<'_, Arc<IndexWatcher>>,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let normalized: Vec<PathBuf> = paths
        .into_iter()
        .map(|p| PathBuf::from(service::normalize_scan_path(&p)))
        .filter(|p| !p.as_os_str().is_empty())
        .collect();
    watcher.set_extra_paths(normalized)
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

/// Moves the application bundle at `path` to the OS Trash.
///
/// Core-only (Tier 1 action panel). Rejects any Tier 2 caller — uninstalling
/// arbitrary apps is a capability beyond the read-only `application:*`
/// surface we expose to extensions. Delegates all safety gating and the
/// actual trash call to [`crate::application::uninstall::uninstall_application`].
#[tauri::command]
pub fn uninstall_application(
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    path: String,
) -> Result<(), AppError> {
    uninstall_application_inner(&permissions, extension_id, path)
}

pub(crate) fn uninstall_application_inner(
    _permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    path: String,
) -> Result<(), AppError> {
    if extension_id.is_some() {
        return Err(AppError::Permission(
            "uninstall_application is only available to core callers".to_string(),
        ));
    }
    uninstall::uninstall_application(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_any_extension_caller() {
        let perms = ExtensionPermissionRegistry::new();
        let err = uninstall_application_inner(
            &perms,
            Some("any-extension-id".to_string()),
            "/Applications/Whatever.app".to_string(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn core_caller_reaches_validator() {
        // extension_id = None should bypass the core-only gate and fall through
        // to the real validator — which then rejects the non-existent path.
        let perms = ExtensionPermissionRegistry::new();
        let err = uninstall_application_inner(
            &perms,
            None,
            "/tmp/__asyar_nonexistent_uninstall_cmd_test__.app".to_string(),
        )
        .unwrap_err();
        // On macOS this should be NotFound; on other platforms Platform.
        #[cfg(target_os = "macos")]
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
        #[cfg(not(target_os = "macos"))]
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }
}
