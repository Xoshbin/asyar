//! Tauri command layer for Apple Shortcuts (`services.shortcuts`).
//!
//! Named `apple_shortcuts` because `commands::shortcuts` already owns the
//! launcher's global hotkeys. Thin wrappers delegate to pure `*_inner`
//! functions so the permission gates are unit testable without a running
//! Tauri app. `shortcuts:read` covers listing; `shortcuts:run` covers
//! execution.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use asyar_platform::{RunShortcutInput, ShortcutInfo};
use tauri::State;

const SHORTCUTS_READ: &str = "shortcuts:read";
const SHORTCUTS_RUN: &str = "shortcuts:run";

fn platform_err(e: asyar_platform::PlatformError) -> AppError {
    match e {
        asyar_platform::PlatformError::InvalidInput(msg) => AppError::Validation(msg),
        other => AppError::Platform(other.to_string()),
    }
}

// Both commands block on a child process (a user shortcut can run for
// minutes), so they run on the async runtime's pool, not the main thread.
#[tauri::command(async)]
pub fn shortcuts_list(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<Vec<ShortcutInfo>, AppError> {
    shortcuts_list_inner(&permissions, extension_id)
}

#[tauri::command(async)]
pub fn shortcuts_run(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    id_or_name: String,
    input: Option<String>,
) -> Result<String, AppError> {
    shortcuts_run_inner(&permissions, extension_id, id_or_name, input)
}

pub(crate) fn shortcuts_list_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
) -> Result<Vec<ShortcutInfo>, AppError> {
    permissions.check(&extension_id, SHORTCUTS_READ)?;
    asyar_platform::list_shortcuts().map_err(platform_err)
}

pub(crate) fn shortcuts_run_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    id_or_name: String,
    input: Option<String>,
) -> Result<String, AppError> {
    permissions.check(&extension_id, SHORTCUTS_RUN)?;
    asyar_platform::run_shortcut(RunShortcutInput { id_or_name, input }).map_err(platform_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn registered(ext_id: &str, perms: &[&str]) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let set: HashSet<String> = perms.iter().map(|p| p.to_string()).collect();
        reg.inner.lock().unwrap().insert(ext_id.to_string(), set);
        reg
    }

    fn ext() -> Option<String> {
        Some("ext-a".to_string())
    }

    fn is_permission_denied<T: std::fmt::Debug>(r: &Result<T, AppError>) -> bool {
        matches!(r, Err(AppError::Permission(_)))
    }

    #[test]
    fn list_requires_read_permission() {
        let reg = registered("ext-a", &["shortcuts:run"]);
        assert!(is_permission_denied(&shortcuts_list_inner(&reg, ext())));
    }

    #[test]
    fn run_requires_run_permission() {
        let reg = registered("ext-a", &["shortcuts:read"]);
        let r = shortcuts_run_inner(&reg, ext(), "Anything".into(), None);
        assert!(is_permission_denied(&r));
    }

    // Empty targets are rejected by platform validation before any process is
    // spawned, proving the gate passed without running a real shortcut.
    #[test]
    fn run_with_permission_reaches_validation() {
        let reg = registered("ext-a", &["shortcuts:run"]);
        let r = shortcuts_run_inner(&reg, ext(), "  ".into(), None);
        assert!(matches!(r, Err(AppError::Validation(_))));
    }

    #[test]
    fn unregistered_extension_is_denied() {
        let reg = ExtensionPermissionRegistry::new();
        assert!(is_permission_denied(&shortcuts_list_inner(&reg, ext())));
    }
}
