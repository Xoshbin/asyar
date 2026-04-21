//! Tauri command layer for the per-extension fs:watch SDK.
//!
//! Thin wrappers over `FsWatcherRegistry`. The `*_inner` split mirrors
//! `commands/app_events.rs` so the permission + validation logic is
//! testable without a Tauri context. Permission check runs first
//! (defense-in-depth); the permission gate in the TS layer has already
//! rejected unauthorized callers, but this enforces the contract at
//! the boundary.

use crate::error::AppError;
use crate::fs_watcher::matcher::{expand_tilde, paths_covered_by_patterns};
use crate::fs_watcher::{FsWatcherOptions, FsWatcherRegistry};
use crate::permissions::ExtensionPermissionRegistry;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

pub const FS_WATCH_PERMISSION: &str = "fs:watch";

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FsWatcherOptionsWire {
    pub recursive: Option<bool>,
    pub debounce_ms: Option<u64>,
}

impl From<FsWatcherOptionsWire> for FsWatcherOptions {
    fn from(w: FsWatcherOptionsWire) -> Self {
        Self {
            recursive: w.recursive.unwrap_or(true),
            debounce: Duration::from_millis(w.debounce_ms.unwrap_or(500)),
        }
    }
}

#[tauri::command]
pub fn fs_watch_create(
    registry: State<'_, Arc<FsWatcherRegistry>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    paths: Vec<String>,
    opts: Option<FsWatcherOptionsWire>,
) -> Result<String, AppError> {
    fs_watch_create_inner(&registry, &permissions, extension_id, paths, opts)
}

#[tauri::command]
pub fn fs_watch_dispose(
    registry: State<'_, Arc<FsWatcherRegistry>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    handle_id: String,
) -> Result<(), AppError> {
    fs_watch_dispose_inner(&registry, &permissions, extension_id, handle_id)
}

pub(crate) fn fs_watch_create_inner(
    registry: &FsWatcherRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    paths: Vec<String>,
    opts: Option<FsWatcherOptionsWire>,
) -> Result<String, AppError> {
    permissions.check(&extension_id, FS_WATCH_PERMISSION)?;
    let ext = extension_id.ok_or_else(|| {
        AppError::Validation("extensionId required for fs_watch_create".into())
    })?;
    let patterns = permissions.fs_watch_patterns(&ext)?;
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Other("could not determine $HOME".into()))?;
    let requested: Vec<PathBuf> = paths.iter().map(|p| expand_tilde(p, &home)).collect();
    paths_covered_by_patterns(&patterns, &requested, &home)?;
    registry.create(&ext, requested, opts.unwrap_or_default().into())
}

pub(crate) fn fs_watch_dispose_inner(
    registry: &FsWatcherRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    handle_id: String,
) -> Result<(), AppError> {
    permissions.check(&extension_id, FS_WATCH_PERMISSION)?;
    let ext = extension_id.ok_or_else(|| {
        AppError::Validation("extensionId required for fs_watch_dispose".into())
    })?;
    registry.dispose(&ext, &handle_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn setup() -> (FsWatcherRegistry, ExtensionPermissionRegistry, tempfile::TempDir) {
        let reg = FsWatcherRegistry::new();
        let perms = ExtensionPermissionRegistry::default();
        let tmp = tempfile::tempdir().unwrap();
        let tmp_str = tmp.path().to_string_lossy().to_string();
        let mut args = HashMap::new();
        args.insert(
            "fs:watch".to_string(),
            serde_json::json!([format!("{tmp_str}/**")]),
        );
        perms.register(
            "ext.a",
            HashSet::from(["fs:watch".to_string()]),
            args,
        );
        (reg, perms, tmp)
    }

    #[test]
    fn create_inner_rejects_without_permission() {
        let (reg, perms, tmp) = setup();
        let err = fs_watch_create_inner(
            &reg,
            &perms,
            Some("ext.b".into()),
            vec![tmp.path().to_string_lossy().into()],
            None,
        )
        .unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.to_lowercase().contains("permission"),
            "expected permission error, got: {msg}"
        );
    }

    #[test]
    fn create_inner_rejects_path_outside_declared_patterns() {
        let (reg, perms, _tmp) = setup();
        let err = fs_watch_create_inner(
            &reg,
            &perms,
            Some("ext.a".into()),
            vec!["/etc".into()],
            None,
        )
        .unwrap_err();
        assert!(format!("{err}").contains("not covered"), "got: {err}");
    }

    #[test]
    fn create_inner_happy_path_returns_handle_id() {
        let (reg, perms, tmp) = setup();
        let h = fs_watch_create_inner(
            &reg,
            &perms,
            Some("ext.a".into()),
            vec![tmp.path().to_string_lossy().into()],
            None,
        )
        .unwrap();
        assert!(!h.is_empty());
    }

    #[test]
    fn dispose_inner_rejects_without_permission() {
        let (reg, perms, _tmp) = setup();
        let err = fs_watch_dispose_inner(
            &reg,
            &perms,
            Some("ext.b".into()),
            "any-handle".into(),
        )
        .unwrap_err();
        assert!(format!("{err}").to_lowercase().contains("permission"));
    }

    #[test]
    fn dispose_inner_errors_when_extension_id_missing() {
        let (reg, perms, _tmp) = setup();
        // None caller bypasses the permission check (core call) and hits
        // the explicit extensionId-required guard.
        let err = fs_watch_dispose_inner(&reg, &perms, None, "h".into()).unwrap_err();
        assert!(
            format!("{err}").contains("extensionId required"),
            "got: {err}"
        );
    }
}
