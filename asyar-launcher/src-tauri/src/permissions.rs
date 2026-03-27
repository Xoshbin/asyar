use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use crate::error::AppError;

/// Rust-side extension permission registry. Populated by extensionManager.ts at extension
/// load time. Queried by sensitive commands for defense-in-depth enforcement.
pub struct ExtensionPermissionRegistry {
    pub inner: Mutex<HashMap<String, HashSet<String>>>,
}

impl ExtensionPermissionRegistry {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()) }
    }

    /// Returns Ok(()) if allowed. None caller = system/core call, always allowed.
    pub fn check(
        &self,
        caller_extension_id: &Option<String>,
        required_permission: &str,
    ) -> Result<(), AppError> {
        let Some(id) = caller_extension_id else {
            return Ok(());
        };
        let registry = self.inner.lock().map_err(|_| AppError::Lock)?;
        let permissions = registry.get(id).ok_or_else(|| {
            AppError::Permission(format!(
                "Extension \"{}\" is not registered in the Rust permission registry.",
                id
            ))
        })?;
        if permissions.contains(required_permission) {
            Ok(())
        } else {
            Err(AppError::Permission(format!(
                "Extension \"{}\" requires the \"{}\" permission.",
                id, required_permission
            )))
        }
    }
}

/// Called by extensionManager.ts when an extension loads. Stores the extension's
/// declared permission strings so sensitive Rust commands can check them.
#[tauri::command]
pub fn register_extension_permissions(
    extension_id: String,
    permissions: Vec<String>,
    registry: tauri::State<'_, ExtensionPermissionRegistry>,
) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation("extension_id cannot be empty".to_string()));
    }
    let mut inner = registry.inner.lock().map_err(|_| AppError::Lock)?;
    inner.insert(extension_id, permissions.into_iter().collect());
    Ok(())
}
