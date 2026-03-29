use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use crate::error::AppError;
use serde::Serialize;

/// Rust-side extension permission registry. Populated by extensionManager.ts at extension
/// load time. Queried by sensitive commands for defense-in-depth enforcement.
pub struct ExtensionPermissionRegistry {
    pub inner: Mutex<HashMap<String, HashSet<String>>>,
}

impl Default for ExtensionPermissionRegistry {
    fn default() -> Self {
        Self::new()
    }
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

/// Maps an IPC call type string to the required permission.
/// Returns None if the call type is a core call that doesn't require a permission.
fn get_required_permission(call_type: &str) -> Option<&'static str> {
    match call_type {
        // Clipboard
        "asyar:api:clipboard:readCurrentClipboard" => Some("clipboard:read"),
        "asyar:api:clipboard:getRecentItems" => Some("clipboard:read"),
        "asyar:api:clipboard:writeToClipboard" => Some("clipboard:write"),
        "asyar:api:clipboard:pasteItem" => Some("clipboard:write"),
        "asyar:api:clipboard:simulatePaste" => Some("clipboard:write"),
        "asyar:api:clipboard:toggleItemFavorite" => Some("clipboard:write"),
        "asyar:api:clipboard:deleteItem" => Some("clipboard:write"),
        "asyar:api:clipboard:clearNonFavorites" => Some("clipboard:write"),
        // Notifications
        "asyar:api:notification:notify" => Some("notifications:send"),
        "asyar:api:notification:show" => Some("notifications:send"),
        // Raw Tauri invoke
        "asyar:api:invoke" => Some("shell:execute"),
        // Network
        "asyar:api:network:fetch" => Some("network"),
        // Opener
        "asyar:api:opener:open" => Some("shell:open-url"),
        // Service-style calls
        "asyar:service:ClipboardService:read" => Some("clipboard:read"),
        "asyar:service:ClipboardService:write" => Some("clipboard:write"),
        "asyar:service:ClipboardHistoryService:get" => Some("clipboard:read"),
        "asyar:service:NotificationService:show" => Some("notifications:send"),
        "asyar:service:NotificationService:info" => Some("notifications:send"),
        "asyar:service:NotificationService:error" => Some("notifications:send"),
        "asyar:service:StoreService:get" => Some("store:read"),
        "asyar:service:StoreService:set" => Some("store:write"),
        "asyar:service:StoreService:delete" => Some("store:write"),
        "asyar:service:StoreService:list" => Some("store:read"),
        "asyar:service:FileService:read" => Some("fs:read"),
        "asyar:service:FileService:write" => Some("fs:write"),
        "asyar:service:FileService:list" => Some("fs:read"),
        "asyar:service:FileService:delete" => Some("fs:write"),
        "asyar:service:ShellService:execute" => Some("shell:execute"),
        "asyar:service:NetworkService:fetch" => Some("network"),
        // Not in map = core call, always allowed
        _ => None,
    }
}

/// Result of a permission check, returned to the frontend.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCheckResult {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_permission: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Called by the frontend IPC router to check if an extension is allowed to make a specific call.
/// This is the single enforcement point for extension permissions.
#[tauri::command]
pub fn check_extension_permission(
    extension_id: String,
    call_type: String,
    registry: tauri::State<'_, ExtensionPermissionRegistry>,
) -> PermissionCheckResult {
    let required = match get_required_permission(&call_type) {
        Some(perm) => perm,
        None => {
            // Call type not in map — core call, always allowed
            return PermissionCheckResult { allowed: true, required_permission: None, reason: None };
        }
    };

    let reg = match registry.inner.lock() {
        Ok(r) => r,
        Err(_) => {
            return PermissionCheckResult {
                allowed: false,
                required_permission: Some(required.to_string()),
                reason: Some("Internal error: permission registry lock failed".to_string()),
            };
        }
    };

    let permissions = match reg.get(&extension_id) {
        Some(p) => p,
        None => {
            return PermissionCheckResult {
                allowed: false,
                required_permission: Some(required.to_string()),
                reason: Some(format!("Extension \"{}\" is not registered in the permission registry.", extension_id)),
            };
        }
    };

    if permissions.contains(required) {
        PermissionCheckResult { allowed: true, required_permission: None, reason: None }
    } else {
        PermissionCheckResult {
            allowed: false,
            required_permission: Some(required.to_string()),
            reason: Some(format!(
                "Extension \"{}\" called \"{}\" but did not declare permission \"{}\" in its manifest.json",
                extension_id, call_type, required
            )),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_registry() -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        inner.insert("org.asyar.test".to_string(), {
            let mut s = HashSet::new();
            s.insert("network".to_string());
            s.insert("clipboard:read".to_string());
            s
        });
        drop(inner);
        reg
    }

    #[test]
    fn test_get_required_permission_known_call() {
        assert_eq!(get_required_permission("asyar:api:network:fetch"), Some("network"));
    }

    #[test]
    fn test_get_required_permission_unknown_call() {
        assert_eq!(get_required_permission("asyar:api:log:info"), None);
    }

    #[test]
    fn test_check_allows_registered_permission() {
        let reg = make_registry();
        assert!(reg.check(&Some("org.asyar.test".to_string()), "network").is_ok());
    }

    #[test]
    fn test_check_denies_missing_permission() {
        let reg = make_registry();
        assert!(reg.check(&Some("org.asyar.test".to_string()), "notifications:send").is_err());
    }

    #[test]
    fn test_check_allows_core_call() {
        let reg = make_registry();
        assert!(reg.check(&None, "network").is_ok());
    }

    #[test]
    fn test_check_denies_unregistered_extension() {
        let reg = make_registry();
        assert!(reg.check(&Some("org.asyar.unknown".to_string()), "network").is_err());
    }

    #[test]
    fn test_get_required_permission_clipboard_write() {
        assert_eq!(get_required_permission("asyar:api:clipboard:writeToClipboard"), Some("clipboard:write"));
    }

    #[test]
    fn test_get_required_permission_service_style() {
        assert_eq!(get_required_permission("asyar:service:NetworkService:fetch"), Some("network"));
    }
}
