//! Cross-platform native path, application, and URL opener for extension callers.
//!
//! Provides first-class opener APIs:
//! - `opener_open_url`: Scheme-gated URL opener (`shell:open-url` permission)
//! - `opener_open_path`: Opens local file/dir paths with default or specified apps (`shell:open-path` permission)
//! - `opener_reveal`: Reveals local file/dir paths in native file manager (`fs:read` permission)

use crate::error::AppError;
use crate::opener_scope;
use crate::permissions::ExtensionPermissionRegistry;
use std::path::PathBuf;
use tauri::State;

pub const SHELL_OPEN_URL_PERMISSION: &str = "shell:open-url";
pub const SHELL_OPEN_PATH_PERMISSION: &str = "shell:open-path";
pub const FS_READ_PERMISSION: &str = "fs:read";

/// Resolves and validates a path for opener commands.
/// Expands `~` prefix to the user's home directory.
/// Ensures the path is absolute and exists on disk.
pub(crate) fn resolve_path(path_str: &str) -> Result<PathBuf, AppError> {
    crate::opener_service::resolve_existing_path(path_str)
}

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

/// Opens a portal link (URL, deeplink, or local file/folder path) with an
/// optional target application (`with`).
#[tauri::command]
pub async fn portal_open_link(
    app_handle: tauri::AppHandle,
    link: String,
    r#with: Option<String>,
) -> Result<(), AppError> {
    crate::opener_service::open_link(&app_handle, &link, r#with.as_deref())
}

/// Picks a local file or folder path safely across platforms and build modes.
#[tauri::command]
pub async fn portal_pick_path(
    app_handle: tauri::AppHandle,
    kind: Option<String>,
) -> Result<Option<String>, AppError> {
    crate::opener_service::pick_path(&app_handle, kind.as_deref().unwrap_or("file")).await
}

/// Permission + scheme gate for URLs.
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

#[tauri::command]
pub async fn opener_open_path<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    path: String,
    r#with: Option<String>,
) -> Result<(), AppError> {
    opener_path_check(&permissions, &extension_id, &path).map_err(|e| {
        log::error!(
            "[opener_open_path] path check failed for {:?} (ext={:?}): {:?}",
            path,
            extension_id,
            e
        );
        e
    })?;
    validate_open_with_target(r#with.as_deref(), cfg!(target_os = "windows"))?;
    let resolved = resolve_path(&path)?;

    #[cfg(target_os = "linux")]
    if let Some(ref app_path) = r#with {
        let app = std::path::Path::new(app_path);
        if crate::application::service::application_launch_route(app)
            == crate::application::service::ApplicationLaunchRoute::GioDesktopEntry
        {
            return crate::application::service::launch_linux_desktop_entry(app, Some(&resolved))
                .map_err(|e| {
                    log::error!(
                        "[opener_open_path] desktop entry {:?} failed for {:?}: {}",
                        app,
                        resolved,
                        e
                    );
                    e
                });
        }
    }

    use tauri_plugin_opener::OpenerExt;
    app_handle
        .opener()
        .open_path(resolved.to_string_lossy().to_string(), r#with.as_deref())
        .map_err(|e| {
            log::error!(
                "[opener_open_path] OS opener failed for {:?}: {}",
                resolved,
                e
            );
            AppError::Other(format!("OS opener failed: {}", e))
        })
}

/// Rejects synthetic `with` targets that cannot accept a file path argument.
fn validate_open_with_target(with: Option<&str>, is_windows: bool) -> Result<(), AppError> {
    if is_windows && with.is_some_and(crate::application::location::is_store_app) {
        return Err(AppError::Platform(
            "Opening files with Microsoft Store apps is not supported".to_string(),
        ));
    }
    Ok(())
}

/// Permission + path validity gate for open_path.
pub(crate) fn opener_path_check(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &Option<String>,
    path: &str,
) -> Result<(), AppError> {
    permissions.check(extension_id, SHELL_OPEN_PATH_PERMISSION)?;
    resolve_path(path)?;
    Ok(())
}

#[tauri::command]
pub async fn opener_reveal<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    path: String,
) -> Result<(), AppError> {
    opener_reveal_check(&permissions, &extension_id, &path)?;
    let resolved = resolve_path(&path)?;
    use tauri_plugin_opener::OpenerExt;
    app_handle
        .opener()
        .reveal_item_in_dir(&resolved)
        .map_err(|e| AppError::Other(format!("OS reveal failed: {}", e)))
}

/// Permission + path validity gate for reveal.
pub(crate) fn opener_reveal_check(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &Option<String>,
    path: &str,
) -> Result<(), AppError> {
    permissions.check(extension_id, FS_READ_PERMISSION)?;
    resolve_path(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use tempfile::TempDir;

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

    // --- resolve_path tests ---

    #[test]
    fn resolve_path_rejects_empty() {
        let err = resolve_path("   ").unwrap_err();
        assert!(format!("{err}").contains("empty"), "got: {err}");
    }

    #[test]
    fn resolve_path_rejects_relative() {
        let err = resolve_path("relative/path/to/file").unwrap_err();
        assert!(format!("{err}").contains("absolute"), "got: {err}");
    }

    #[test]
    fn resolve_path_rejects_nonexistent() {
        let tmp = TempDir::new().unwrap();
        let nonexistent = tmp.path().join("__asyar_nonexistent_opener_test__");
        let err = resolve_path(nonexistent.to_str().unwrap()).unwrap_err();
        assert!(format!("{err}").contains("does not exist"), "got: {err}");
    }

    #[test]
    fn resolve_path_accepts_existing_absolute() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();
        let resolved = resolve_path(file.to_str().unwrap()).unwrap();
        assert_eq!(resolved, file);
    }

    #[test]
    fn resolve_path_expands_tilde() {
        let home = dirs::home_dir().unwrap();
        let resolved = resolve_path("~").unwrap();
        assert_eq!(resolved, home);
    }

    // --- opener_path_check tests ---

    #[test]
    fn opener_path_check_requires_permission() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();

        let reg = ExtensionPermissionRegistry::default();
        reg.register("ext.no_perm", HashSet::new(), HashMap::new());
        let err = opener_path_check(&reg, &Some("ext.no_perm".into()), file.to_str().unwrap())
            .unwrap_err();
        assert!(format!("{err}").contains("shell:open-path"), "got: {err}");

        reg.register(
            "ext.with_perm",
            HashSet::from(["shell:open-path".to_string()]),
            HashMap::new(),
        );
        assert!(
            opener_path_check(&reg, &Some("ext.with_perm".into()), file.to_str().unwrap()).is_ok()
        );
    }

    #[test]
    fn opener_path_check_allows_host_context() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();

        let reg = ExtensionPermissionRegistry::default();
        assert!(opener_path_check(&reg, &None, file.to_str().unwrap()).is_ok());
    }

    // --- validate_open_with_target tests ---

    #[test]
    fn validate_open_with_target_rejects_store_apps_on_windows() {
        let store_app = Some(r"shell:AppsFolder\Microsoft.Windows.Photos!App");
        let err = validate_open_with_target(store_app, true).unwrap_err();
        assert!(matches!(err, AppError::Platform(_)));
        assert!(validate_open_with_target(Some(r"C:\Program Files\Zed\zed.exe"), true).is_ok());
        assert!(validate_open_with_target(None, true).is_ok());
    }

    // --- opener_reveal_check tests ---

    #[test]
    fn opener_reveal_check_requires_fs_read_permission() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();

        let reg = ExtensionPermissionRegistry::default();
        reg.register("ext.no_perm", HashSet::new(), HashMap::new());
        let err = opener_reveal_check(&reg, &Some("ext.no_perm".into()), file.to_str().unwrap())
            .unwrap_err();
        assert!(format!("{err}").contains("fs:read"), "got: {err}");

        reg.register(
            "ext.with_perm",
            HashSet::from(["fs:read".to_string()]),
            HashMap::new(),
        );
        assert!(
            opener_reveal_check(&reg, &Some("ext.with_perm".into()), file.to_str().unwrap())
                .is_ok()
        );
    }

    #[test]
    fn opener_reveal_check_allows_host_context() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();

        let reg = ExtensionPermissionRegistry::default();
        assert!(opener_reveal_check(&reg, &None, file.to_str().unwrap()).is_ok());
    }
}
