//! Tauri commands for resolving host OS user directory paths.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use serde::Serialize;
use std::path::Path;
use tauri::Manager;

/// Cross-platform OS user directory paths returned to `files:read`-authorized extensions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPaths {
    pub home: String,
    pub app_data: String,
    pub local_app_data: String,
    pub config: String,
}

/// Normalizes an OS directory path consistently with `files:read` / `files:glob`
/// (strips Windows `\\?\` verbatim UNC prefixes while keeping platform-native separators).
pub(crate) fn normalize_os_path(path: &Path) -> String {
    dunce::simplified(path).to_string_lossy().into_owned()
}

pub(crate) fn environment_get_paths_inner<F>(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &Option<String>,
    resolve: F,
) -> Result<EnvironmentPaths, AppError>
where
    F: FnOnce() -> Result<EnvironmentPaths, AppError>,
{
    permissions.check(extension_id, "files:read")?;
    resolve()
}

/// Resolves the host OS user directories (`home`, `appData`, `localAppData`, `config`).
///
/// Requires `files:read` when invoked on behalf of an extension so unprivileged
/// extensions cannot fingerprint the user's OS username or filesystem layout.
#[tauri::command]
pub fn environment_get_paths<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<EnvironmentPaths, AppError> {
    environment_get_paths_inner(&permissions, &extension_id, || {
        let resolver = app_handle.path();
        let home = resolver
            .home_dir()
            .map_err(|e| AppError::Other(format!("Failed to resolve home_dir: {e}")))?;
        let app_data = resolver
            .data_dir()
            .map_err(|e| AppError::Other(format!("Failed to resolve data_dir: {e}")))?;
        let local_app_data = resolver
            .local_data_dir()
            .map_err(|e| AppError::Other(format!("Failed to resolve local_data_dir: {e}")))?;
        let config = resolver
            .config_dir()
            .map_err(|e| AppError::Other(format!("Failed to resolve config_dir: {e}")))?;

        Ok(EnvironmentPaths {
            home: normalize_os_path(&home),
            app_data: normalize_os_path(&app_data),
            local_app_data: normalize_os_path(&local_app_data),
            config: normalize_os_path(&config),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn sample_paths() -> EnvironmentPaths {
        EnvironmentPaths {
            home: "/Users/alice".to_string(),
            app_data: "/Users/alice/Library/Application Support".to_string(),
            local_app_data: "/Users/alice/Library/Application Support".to_string(),
            config: "/Users/alice/Library/Application Support".to_string(),
        }
    }

    #[test]
    fn environment_get_paths_inner_rejects_unregistered_extension() {
        let reg = ExtensionPermissionRegistry::new();
        let err =
            environment_get_paths_inner(&reg, &Some("ext.unknown".into()), || Ok(sample_paths()))
                .unwrap_err();
        assert!(err.to_string().contains("not registered"));
    }

    #[test]
    fn environment_get_paths_inner_rejects_without_files_read_permission() {
        let reg = ExtensionPermissionRegistry::new();
        reg.register(
            "ext.noperm",
            HashSet::from(["network".to_string()]),
            HashMap::new(),
        );
        let err =
            environment_get_paths_inner(&reg, &Some("ext.noperm".into()), || Ok(sample_paths()))
                .unwrap_err();
        assert!(err.to_string().contains("files:read"));
    }

    #[test]
    fn environment_get_paths_inner_allows_with_files_read_permission() {
        let reg = ExtensionPermissionRegistry::new();
        reg.register(
            "ext.files",
            HashSet::from(["files:read".to_string()]),
            HashMap::new(),
        );
        let paths =
            environment_get_paths_inner(&reg, &Some("ext.files".into()), || Ok(sample_paths()))
                .unwrap();
        assert_eq!(paths, sample_paths());
    }

    #[test]
    fn environment_get_paths_inner_allows_host_caller() {
        let reg = ExtensionPermissionRegistry::new();
        let paths = environment_get_paths_inner(&reg, &None, || Ok(sample_paths())).unwrap();
        assert_eq!(paths, sample_paths());
    }

    #[test]
    fn environment_paths_serializes_to_camel_case() {
        let json = serde_json::to_value(sample_paths()).unwrap();
        assert_eq!(json["home"], "/Users/alice");
        assert_eq!(json["appData"], "/Users/alice/Library/Application Support");
        assert_eq!(
            json["localAppData"],
            "/Users/alice/Library/Application Support"
        );
        assert_eq!(json["config"], "/Users/alice/Library/Application Support");
    }

    #[test]
    fn normalize_os_path_preserves_standard_paths() {
        assert_eq!(normalize_os_path(Path::new("/Users/alice")), "/Users/alice");
    }
}
