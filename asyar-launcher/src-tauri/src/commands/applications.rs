//! Application discovery and launch commands.
//!
//! Thin Tauri command wrappers delegating to `crate::application::service`.

use crate::search_engine::SearchState;
use crate::error::AppError;
use crate::application::service::{self, FrontmostApplication, SyncResult};
use crate::application::{uninstall, IndexWatcher};
#[cfg(target_os = "macos")]
use crate::application::uninstall::UninstallScanResult;
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

/// Uninstalls the selected application, optionally trashing associated
/// user-data paths (macOS).
///
/// macOS: moves the `.app` bundle to Trash, then trashes each path in
/// `data_paths` that survives the per-path safety validator
/// (`~/Library/*` scope, absolute, not a symlink). Windows: launches the
/// vendor uninstaller (`data_paths` is ignored — the uninstaller handles
/// user-data cleanup). Linux: unsupported.
///
/// Core-only (Tier 1 action panel). Rejects any Tier 2 caller — uninstalling
/// arbitrary apps is a capability beyond the read-only `application:*`
/// surface we expose to extensions. Delegates all safety gating and the
/// actual work to [`crate::application::uninstall::uninstall_application`].
#[tauri::command]
pub fn uninstall_application(
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    path: String,
    data_paths: Option<Vec<String>>,
) -> Result<(), AppError> {
    uninstall_application_inner(&permissions, extension_id, path, data_paths.unwrap_or_default())
}

pub(crate) fn uninstall_application_inner(
    _permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    path: String,
    data_paths: Vec<String>,
) -> Result<(), AppError> {
    if extension_id.is_some() {
        return Err(AppError::Permission(
            "uninstall_application is only available to core callers".to_string(),
        ));
    }
    uninstall::uninstall_application(&path, &data_paths)
}

/// Scans for associated user data left behind by the application at `path`
/// (macOS only). Returns the `.app` bundle size plus every matching
/// `~/Library/*` entry with its on-disk size, for the frontend to render in
/// the uninstall-confirmation sheet.
///
/// Core-only. Tier 2 extensions cannot inspect arbitrary user data — this
/// is part of the Tier 1 uninstall capability boundary.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn scan_uninstall_targets(
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    path: String,
) -> Result<UninstallScanResult, AppError> {
    scan_uninstall_targets_inner(&permissions, extension_id, path)
}

/// Stub for non-macOS targets. Returns an empty scan so the frontend can
/// treat the call uniformly — Windows and Linux simply don't show a
/// data-path breakdown in their confirm flow.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn scan_uninstall_targets(
    _permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    _extension_id: Option<String>,
    _path: String,
) -> Result<crate::application::uninstall::UninstallScanResult, AppError> {
    Err(AppError::Platform(
        "scan_uninstall_targets is only supported on macOS".to_string(),
    ))
}

#[cfg(target_os = "macos")]
pub(crate) fn scan_uninstall_targets_inner(
    _permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    path: String,
) -> Result<UninstallScanResult, AppError> {
    use crate::application::uninstall::{dir_size_bytes, scan_app_data, AppDataPath};
    use std::path::Path;

    if extension_id.is_some() {
        return Err(AppError::Permission(
            "scan_uninstall_targets is only available to core callers".to_string(),
        ));
    }

    let raw = Path::new(&path);
    if !raw.is_absolute() {
        return Err(AppError::Validation(format!(
            "path must be absolute: {}",
            path
        )));
    }
    if raw.extension().and_then(|e| e.to_str()) != Some("app") {
        return Err(AppError::Validation(format!(
            "path must point to a .app bundle: {}",
            path
        )));
    }
    if !raw.exists() {
        return Err(AppError::NotFound(format!(
            "application does not exist: {}",
            path
        )));
    }

    let app_name = raw
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let bundle_id = service::extract_bundle_id(raw);

    let app_size_bytes = dir_size_bytes(raw);
    let data_paths: Vec<AppDataPath> = scan_app_data(bundle_id.as_deref(), &app_name);
    let total_bytes = app_size_bytes
        + data_paths
            .iter()
            .fold(0u64, |acc, p| acc.saturating_add(p.size_bytes));

    Ok(UninstallScanResult {
        app_path: path,
        app_size_bytes,
        data_paths,
        total_bytes,
    })
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
            vec![],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn core_caller_reaches_validator() {
        // extension_id = None should bypass the core-only gate and fall through
        // to the platform-specific validator. We assert the error is NOT the
        // "only available to core callers" permission error — that's the
        // point. The exact downstream error varies per platform (NotFound on
        // macOS/Windows for a non-existent path, Platform on Linux).
        let perms = ExtensionPermissionRegistry::new();
        #[cfg(target_os = "macos")]
        let probe = "/tmp/__asyar_nonexistent_uninstall_cmd_test__.app".to_string();
        #[cfg(target_os = "windows")]
        let probe = r"C:\__asyar_nonexistent_uninstall_cmd_test__.lnk".to_string();
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let probe = "/anything".to_string();

        let err = uninstall_application_inner(&perms, None, probe, vec![]).unwrap_err();

        #[cfg(target_os = "macos")]
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
        #[cfg(target_os = "windows")]
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn scan_rejects_extension_caller() {
        let perms = ExtensionPermissionRegistry::new();
        let err = scan_uninstall_targets_inner(
            &perms,
            Some("any-extension-id".to_string()),
            "/Applications/Whatever.app".to_string(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn scan_rejects_non_dot_app_path() {
        let perms = ExtensionPermissionRegistry::new();
        let err =
            scan_uninstall_targets_inner(&perms, None, "/tmp/not-an-app".to_string()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn scan_rejects_missing_app() {
        let perms = ExtensionPermissionRegistry::new();
        let err = scan_uninstall_targets_inner(
            &perms,
            None,
            "/tmp/__asyar_nonexistent_uninstall_scan_test__.app".to_string(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }
}
