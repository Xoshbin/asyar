use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

pub mod discovery;
pub mod installer;
pub mod lifecycle;
pub mod headless;

use tauri::{AppHandle, Manager};
use crate::error::AppError;
use std::path::PathBuf;
use std::fs;

/// Returns the app's data directory.
pub(crate) fn get_app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, AppError> {
    app_handle.path().app_data_dir().map_err(|e| AppError::Other(e.to_string()))
}

/// Returns the path to the user extensions directory, creating it if needed.
pub(crate) fn get_extensions_dir(app_handle: &AppHandle) -> Result<String, AppError> {
    let app_data_dir = get_app_data_dir(app_handle)?;
    let extensions_dir = app_data_dir.join("extensions");
    
    // Create the directory if it doesn't exist
    if !extensions_dir.exists() {
        fs::create_dir_all(&extensions_dir)?;
    }
    
    extensions_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Other("Invalid UTF-8 in extensions directory path".to_string()))
}

/// Returns the path to the built-in features directory.
pub(crate) fn get_builtin_features_path(app_handle: &AppHandle) -> Result<String, AppError> {
    #[cfg(debug_assertions)]
    {
        let current_dir = std::env::current_dir().unwrap_or_default();
        let dev_dir = current_dir
            .join("src")
            .join("built-in-features");
        
        log::info!("[Rust] Current working directory: {:?}", current_dir);
        log::info!("[Rust] Constructing dev features path: {:?}", dev_dir);

        if dev_dir.exists() {
            log::info!("[Rust] Dev features path EXISTS.");
            return Ok(dev_dir.to_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Invalid UTF-8 in dev features path".to_string()));
        } else {
            log::warn!("[Rust] Dev features path DOES NOT EXIST at {:?}", dev_dir);
        }
    }

    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| AppError::Other(format!("Failed to access resource directory path resolver: {}", e)))?;
        
    if !resource_dir.exists() {
        return Err(AppError::NotFound("Resource directory does not exist".to_string()));
    }

    let builtin_dir = resource_dir.join("built-in-features");

    builtin_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Other("Invalid UTF-8 in built-in features directory path".to_string()))
}

/// Returns dev extension paths from dev_extensions.json.
pub(crate) fn get_dev_extension_paths(app_handle: &AppHandle) -> Result<HashMap<String, String>, AppError> {
    let dev_extensions_file = get_app_data_dir(app_handle)?.join("dev_extensions.json");
    if !dev_extensions_file.exists() {
        return Ok(HashMap::new());
    }
    
    let content = fs::read_to_string(&dev_extensions_file)?;
        
    let dev_extensions: HashMap<String, String> = serde_json::from_str(&content).unwrap_or_default();
    Ok(dev_extensions)
}

/// Mirrors the ExtensionCommand from asyar-sdk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCommand {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub trigger: Option<String>,
    #[serde(default)]
    pub result_type: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub view: Option<String>,
}

/// Mirrors the ExtensionManifest from asyar-sdk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(rename = "type", default)]
    pub extension_type: Option<String>,
    #[serde(default)]
    pub default_view: Option<String>,
    #[serde(default)]
    pub searchable: Option<bool>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub commands: Vec<ExtensionCommand>,
    #[serde(default)]
    pub permissions: Option<Vec<String>>,
    #[serde(default)]
    pub min_app_version: Option<String>,
    #[serde(default)]
    pub asyar_sdk: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum CompatibilityStatus {
    Compatible,
    #[serde(rename_all = "camelCase")]
    SdkMismatch {
        required: String,
        supported: String,
    },
    #[serde(rename_all = "camelCase")]
    AppVersionTooOld {
        required: String,
        current: String,
    },
    #[default]
    Unknown,
}

/// A fully resolved extension record returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRecord {
    pub manifest: ExtensionManifest,
    pub enabled: bool,
    pub is_built_in: bool,
    /// Filesystem path to the extension directory
    pub path: String,
    #[serde(default)]
    pub compatibility: CompatibilityStatus,
}

/// Central registry holding all discovered extensions
pub struct ExtensionRegistryState {
    pub extensions: Mutex<HashMap<String, ExtensionRecord>>,
}

impl ExtensionRegistryState {
    pub fn new() -> Self {
        Self {
            extensions: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for ExtensionRegistryState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn create_test_manifest(dir: &Path, id: &str, name: &str) {
        let ext_dir = dir.join(id);
        fs::create_dir_all(&ext_dir).unwrap();
        let manifest = serde_json::json!({
            "id": id,
            "name": name,
            "version": "1.0.0",
            "description": "Test extension",
            "type": "view",
            "commands": [{
                "id": "test-cmd",
                "name": "Test Command",
                "description": "A test command"
            }]
        });
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
    }

    #[test]
    fn test_read_manifest_valid() {
        let tmp = TempDir::new().unwrap();
        create_test_manifest(tmp.path(), "test-ext", "Test Extension");
        let manifest = discovery::read_manifest(&tmp.path().join("test-ext/manifest.json")).unwrap();
        assert_eq!(manifest.id, "test-ext");
        assert_eq!(manifest.name, "Test Extension");
        assert_eq!(manifest.commands.len(), 1);
        assert_eq!(manifest.commands[0].id, "test-cmd");
    }

    #[test]
    fn test_read_manifest_with_optional_fields() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path().join("full-ext");
        fs::create_dir_all(&ext_dir).unwrap();
        let manifest = serde_json::json!({
            "id": "full-ext",
            "name": "Full Extension",
            "version": "2.0.0",
            "description": "Full test",
            "type": "result",
            "defaultView": "DefaultView",
            "searchable": true,
            "icon": "🔍",
            "permissions": ["clipboard:read", "network"],
            "commands": []
        });
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
        
        let m = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap();
        assert_eq!(m.default_view, Some("DefaultView".into()));
        assert_eq!(m.searchable, Some(true));
        assert_eq!(m.icon, Some("🔍".into()));
        assert_eq!(m.permissions, Some(vec!["clipboard:read".into(), "network".into()]));
    }

    #[test]
    fn test_read_manifest_minimal() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path().join("min-ext");
        fs::create_dir_all(&ext_dir).unwrap();
        let manifest = serde_json::json!({
            "id": "min-ext",
            "name": "Minimal",
            "version": "0.1.0"
        });
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
        
        let m = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap();
        assert_eq!(m.id, "min-ext");
        assert!(m.commands.is_empty());
        assert!(m.permissions.is_none());
    }

    #[test]
    fn test_scan_extensions_dir() {
        let tmp = TempDir::new().unwrap();
        create_test_manifest(tmp.path(), "ext-a", "Extension A");
        create_test_manifest(tmp.path(), "ext-b", "Extension B");
        // Add a non-extension directory (no manifest)
        fs::create_dir_all(tmp.path().join("not-an-ext")).unwrap();
        // Add a file (should be skipped)
        fs::write(tmp.path().join("random.txt"), "hello").unwrap();
        
        let records = discovery::scan_extensions_dir(tmp.path(), false);
        assert_eq!(records.len(), 2);
        assert!(records.iter().all(|r| !r.is_built_in));
    }

    #[test]
    fn test_scan_extensions_dir_built_in() {
        let tmp = TempDir::new().unwrap();
        create_test_manifest(tmp.path(), "calculator", "Calculator");
        
        let records = discovery::scan_extensions_dir(tmp.path(), true);
        assert_eq!(records.len(), 1);
        assert!(records[0].is_built_in);
        assert!(records[0].enabled); // Default enabled
    }

    #[test]
    fn test_scan_nonexistent_dir() {
        let records = discovery::scan_extensions_dir(Path::new("/nonexistent/path"), false);
        assert!(records.is_empty()); // Should not panic, just return empty
    }

    #[test]
    fn test_scan_skips_invalid_manifest() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path().join("bad-ext");
        fs::create_dir_all(&ext_dir).unwrap();
        fs::write(ext_dir.join("manifest.json"), "not valid json").unwrap();
        create_test_manifest(tmp.path(), "good-ext", "Good");
        
        let records = discovery::scan_extensions_dir(tmp.path(), false);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].manifest.id, "good-ext");
    }

    #[test]
    fn test_extension_registry_state() {
        let registry = ExtensionRegistryState::new();
        let mut reg = registry.extensions.lock().unwrap();
        assert!(reg.is_empty());
        
        reg.insert("test".into(), ExtensionRecord {
            manifest: ExtensionManifest {
                id: "test".into(),
                name: "Test".into(),
                version: "1.0.0".into(),
                description: String::new(),
                author: None,
                extension_type: None,
                default_view: None,
                searchable: None,
                icon: None,
                main: None,
                commands: vec![],
                permissions: None,
                min_app_version: None,
                asyar_sdk: None,
            },
            enabled: true,
            is_built_in: false,
            path: "/tmp/test".into(),
            compatibility: CompatibilityStatus::Unknown,
        });
        assert_eq!(reg.len(), 1);
    }
}
