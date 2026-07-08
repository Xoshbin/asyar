//! Scheme-gated URL opener for extension callers.
//!
//! `asyar:api:opener:open` used to invoke the webview plugin command
//! `plugin:opener|open_url`, whose ACL scope (`opener:allow-default-urls`)
//! is web-only — so non-web protocol handlers (`steam://`, `vscode://`)
//! were unreachable without `shell:spawn`. This command is the Rust-side
//! replacement: it checks the caller's `shell:open-url` permission plus
//! its declared scheme allowlist (`opener_scope`), then calls the plugin's
//! scope-free Rust API. The webview ACL stays web-only for host code.

use crate::error::AppError;
use crate::opener_scope;
use crate::permissions::ExtensionPermissionRegistry;
use tauri::State;

pub const SHELL_OPEN_URL_PERMISSION: &str = "shell:open-url";

#[tauri::command]
pub async fn opener_open_url<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    url: String,
) -> Result<(), AppError> {
    opener_check(&permissions, &extension_id, &url)?;
    use tauri_plugin_opener::OpenerExt;
    app_handle
        .opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::Other(format!("OS opener failed: {}", e)))
}

/// Permission + scheme gate, split from the command so it's testable
/// without a Tauri context (same shape as `commands/fs_watcher.rs`).
/// Callers without an extension identity (privileged host context) get
/// the web-default schemes only — parity with the webview ACL this
/// command replaces.
pub(crate) fn opener_check(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &Option<String>,
    url: &str,
) -> Result<(), AppError> {
    permissions.check(extension_id, SHELL_OPEN_URL_PERMISSION)?;
    let declared = match extension_id {
        Some(ext) => opener_scope::declared_schemes(permissions, ext),
        None => Vec::new(),
    };
    opener_scope::check_url_allowed(url, &declared)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn registry(schemes: Option<serde_json::Value>) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::default();
        let mut args = HashMap::new();
        if let Some(v) = schemes {
            args.insert("shell:open-url".to_string(), v);
        }
        reg.register("ext.a", HashSet::from(["shell:open-url".to_string()]), args);
        reg
    }

    #[test]
    fn rejects_caller_without_permission() {
        let reg = ExtensionPermissionRegistry::default();
        reg.register("ext.b", HashSet::new(), HashMap::new());
        let err = opener_check(&reg, &Some("ext.b".into()), "https://x").unwrap_err();
        assert!(format!("{err}").contains("shell:open-url"), "got: {err}");
    }

    #[test]
    fn allows_web_default_with_bare_permission() {
        let reg = registry(None);
        assert!(opener_check(&reg, &Some("ext.a".into()), "https://example.com").is_ok());
    }

    #[test]
    fn rejects_undeclared_scheme_with_bare_permission() {
        let reg = registry(None);
        let err = opener_check(&reg, &Some("ext.a".into()), "steam://run/42").unwrap_err();
        assert!(
            format!("{err}").contains("declared scheme list"),
            "got: {err}"
        );
    }

    #[test]
    fn allows_declared_scheme() {
        let reg = registry(Some(serde_json::json!(["steam"])));
        assert!(opener_check(&reg, &Some("ext.a".into()), "steam://run/3932890").is_ok());
    }

    #[test]
    fn declared_scheme_does_not_leak_to_other_extensions() {
        let reg = registry(Some(serde_json::json!(["steam"])));
        reg.register(
            "ext.other",
            HashSet::from(["shell:open-url".to_string()]),
            HashMap::new(),
        );
        assert!(opener_check(&reg, &Some("ext.other".into()), "steam://run/42").is_err());
    }

    #[test]
    fn rejects_schemeless_url() {
        let reg = registry(Some(serde_json::json!(["steam"])));
        let err = opener_check(&reg, &Some("ext.a".into()), "example.com/x").unwrap_err();
        assert!(format!("{err}").contains("no URL scheme"), "got: {err}");
    }

    #[test]
    fn host_context_gets_web_defaults_only() {
        let reg = ExtensionPermissionRegistry::default();
        assert!(opener_check(&reg, &None, "https://example.com").is_ok());
        assert!(opener_check(&reg, &None, "steam://run/42").is_err());
    }
}
