//! Tauri command layer for the screen color sampler.
//!
//! Thin wrapper: defense-in-depth permission check, then delegate to
//! `crate::color_sampler`. All sampling logic lives in the service module.

use crate::color_sampler::{self, PickedColor};
use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use tauri::State;

const REQUIRED_PERMISSION: &str = "screen:pick-color";

#[tauri::command]
pub async fn screen_pick_color(
    app: tauri::AppHandle,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<Option<PickedColor>, AppError> {
    ensure_pick_allowed(&permissions, &extension_id)?;
    color_sampler::pick_color(&app).await
}

pub(crate) fn ensure_pick_allowed(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &Option<String>,
) -> Result<(), AppError> {
    permissions.check(extension_id, REQUIRED_PERMISSION)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn registered_permissions(ext_id: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = HashSet::new();
        set.insert(REQUIRED_PERMISSION.to_string());
        inner.insert(ext_id.to_string(), set);
        drop(inner);
        reg
    }

    #[test]
    fn pick_without_permission_is_rejected() {
        let perms = ExtensionPermissionRegistry::new();
        let err = ensure_pick_allowed(&perms, &Some("ext-a".into()))
            .expect_err("undeclared permission must be rejected");
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn pick_with_declared_permission_is_allowed() {
        let perms = registered_permissions("ext-a");
        ensure_pick_allowed(&perms, &Some("ext-a".into())).expect("declared permission allows");
    }

    #[test]
    fn core_caller_bypasses_permission_check() {
        // extension_id = None means core/system call — always allowed.
        let perms = ExtensionPermissionRegistry::new();
        ensure_pick_allowed(&perms, &None).expect("core caller is always allowed");
    }
}
