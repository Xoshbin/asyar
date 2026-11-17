//! Tauri command layer for the process service. Thin wrappers over
//! `process_manager`, gated by the extension permission registry.
//!
//! Both commands are `async` and run the heavy `sysinfo` enumeration on a
//! blocking pool (`spawn_blocking`). Synchronous Tauri commands execute on the
//! main thread, so the enumeration's CPU-delta sleep + full process scan froze
//! the UI event loop (and, under the view's auto-refresh, did so continuously).
//! Off-loading keeps kills instant and the launcher responsive.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use crate::process_manager::types::{AppGroup, KillResult, SortBy};
use tauri::State;

const READ_PERMISSION: &str = "process:read";
const KILL_PERMISSION: &str = "process:kill";

#[tauri::command]
pub async fn process_list(
    app: tauri::AppHandle,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    query: Option<String>,
    sort_by: SortBy,
) -> Result<Vec<AppGroup>, AppError> {
    // Gate runs on the async runtime thread (not the UI thread); it's a cheap
    // mutex lock, so no need to push it to the blocking pool.
    ensure_can_list(&permissions, &extension_id)?;
    let query = query.unwrap_or_default();
    let cache_dir = crate::icons::remote::icon_cache_dir(&app);
    spawn_blocking_result(move || {
        let mut groups = crate::process_manager::list(&query, sort_by);
        for group in &mut groups {
            group.icon = resolve_group_icon(group, &cache_dir);
        }
        groups
    })
    .await
}

/// Best-effort icon resolver for an app group.
///
/// On macOS, GUI apps run inside `.app` bundles whose icons are extracted
/// via `extract_app_icon`. CLI binaries, daemon processes, and headless tools
/// leave `icon: None` so the UI renders the familiar `exec` squircle badge.
fn resolve_group_icon(group: &AppGroup, cache_dir: &std::path::Path) -> Option<String> {
    // 1. Scan children to see if any executable resides within an application bundle.
    for child in &group.children {
        if let Some(bundle_path) = find_bundle_path(&child.path) {
            if let Some(icon) =
                crate::application::service::extract_app_icon(&bundle_path, cache_dir)
            {
                return Some(icon);
            }
        }
    }

    // 2. On macOS, search standard system and user application paths matching app_name.
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let candidates = [
            format!("/Applications/{}.app", group.app_name),
            format!("/System/Applications/{}.app", group.app_name),
            format!("/System/Applications/Utilities/{}.app", group.app_name),
            format!("/System/Library/CoreServices/{}.app", group.app_name),
            format!("{home}/Applications/{}.app", group.app_name),
        ];
        for candidate in candidates {
            if std::path::Path::new(&candidate).exists() {
                if let Some(icon) =
                    crate::application::service::extract_app_icon(&candidate, cache_dir)
                {
                    return Some(icon);
                }
            }
        }
    }

    // 3. Only Windows supports direct executable icon extraction. Linux needs a
    // matching .desktop entry; without one, leave the icon unset.
    #[cfg(target_os = "windows")]
    for child in &group.children {
        if !child.path.is_empty() && std::path::Path::new(&child.path).exists() {
            if let Some(icon) =
                crate::application::service::extract_app_icon(&child.path, cache_dir)
            {
                return Some(icon);
            }
        }
    }

    None
}

/// Extract the `.app` bundle path from an executable path (e.g.
/// `/Applications/Raycast.app/Contents/MacOS/Raycast` -> `/Applications/Raycast.app`).
fn find_bundle_path(exe_path: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(idx) = exe_path.find(".app/") {
            return Some(exe_path[..idx + 4].to_string());
        }
        if exe_path.ends_with(".app") {
            return Some(exe_path.to_string());
        }
    }
    let _ = exe_path;
    None
}

#[tauri::command]
pub async fn process_kill(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    pids: Vec<u32>,
    force: bool,
    confirmed_protected: bool,
) -> Result<KillResult, AppError> {
    ensure_can_kill(&permissions, &extension_id)?;
    spawn_blocking_result(move || crate::process_manager::kill(pids, force, confirmed_protected))
        .await
}

/// Permission gate for `process_list`. Separated so the command stays a thin
/// thread-offload wrapper and the gate is directly unit-testable.
fn ensure_can_list(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &Option<String>,
) -> Result<(), AppError> {
    permissions.check(extension_id, READ_PERMISSION)
}

/// Permission gate for `process_kill`.
fn ensure_can_kill(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &Option<String>,
) -> Result<(), AppError> {
    permissions.check(extension_id, KILL_PERMISSION)
}

/// Run a blocking closure on Tauri's blocking pool and surface a panic as an
/// `AppError` rather than tearing down the runtime.
async fn spawn_blocking_result<T, F>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("process task failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn perms_with(ext: &str, perm: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = HashSet::new();
        set.insert(perm.to_string());
        inner.insert(ext.to_string(), set);
        drop(inner);
        reg
    }

    #[test]
    fn permission_constants_match_manifest_strings() {
        // The manifest declares these exact strings; a drift here would silently
        // deny every call (the registry compares against the declared set).
        assert_eq!(READ_PERMISSION, "process:read");
        assert_eq!(KILL_PERMISSION, "process:kill");
    }

    #[test]
    fn list_without_permission_is_rejected() {
        let perms = ExtensionPermissionRegistry::new();
        let err = ensure_can_list(&perms, &Some("ext-a".into())).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[test]
    fn list_with_permission_is_allowed() {
        let perms = perms_with("ext-a", "process:read");
        assert!(ensure_can_list(&perms, &Some("ext-a".into())).is_ok());
    }

    #[test]
    fn kill_without_permission_is_rejected() {
        let perms = perms_with("ext-a", "process:read"); // has read, not kill
        let err = ensure_can_kill(&perms, &Some("ext-a".into())).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[test]
    fn kill_with_permission_is_allowed() {
        let perms = perms_with("ext-a", "process:kill");
        assert!(ensure_can_kill(&perms, &Some("ext-a".into())).is_ok());
    }

    #[test]
    fn core_caller_bypasses_gate() {
        // None extension_id = privileged host call, always allowed.
        let perms = ExtensionPermissionRegistry::new();
        assert!(ensure_can_list(&perms, &None).is_ok());
        assert!(ensure_can_kill(&perms, &None).is_ok());
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn find_bundle_path_extracts_dot_app_bundle() {
        assert_eq!(
            find_bundle_path("/Applications/Raycast.app/Contents/MacOS/Raycast"),
            Some("/Applications/Raycast.app".to_string())
        );
        assert_eq!(
            find_bundle_path("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
            Some("/System/Applications/Utilities/Terminal.app".to_string())
        );
        assert_eq!(
            find_bundle_path("/Applications/Slack.app"),
            Some("/Applications/Slack.app".to_string())
        );
        assert_eq!(find_bundle_path("/usr/local/bin/node"), None);
        assert_eq!(
            find_bundle_path("/System/Library/Frameworks/CoreGraphics.framework/WindowServer"),
            None
        );
    }
}
