use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

pub mod discovery;
pub mod installer;
pub mod lifecycle;
pub mod headless;
pub mod iframe_lifecycle;
pub mod updater;
pub mod scheduler;
pub mod update_scheduler;

use tauri::{AppHandle, Manager};
use crate::error::AppError;
use std::path::{Path, PathBuf};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDeclaration {
    pub interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PreferenceType {
    Textfield,
    Password,
    Number,
    Checkbox,
    Dropdown,
    AppPicker,
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropdownOption {
    pub value: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceDeclaration {
    pub name: String,
    #[serde(rename = "type")]
    pub preference_type: PreferenceType,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub data: Option<Vec<DropdownOption>>,
}

/// Mirrors the CommandArgumentType enum from asyar-sdk. Lower-case variants
/// match the wire format ("text", "password", "dropdown", "number").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CommandArgumentType {
    Text,
    Password,
    Dropdown,
    Number,
}

/// Mirrors CommandArgument from asyar-sdk — a single declarative input
/// field collected inline in the search bar before a command runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandArgument {
    pub name: String,
    #[serde(rename = "type")]
    pub argument_type: CommandArgumentType,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub data: Option<Vec<DropdownOption>>,
}

/// An action declared in manifest.json that surfaces in the launcher action drawer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAction {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub shortcut: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
}

/// Mirrors the ExtensionCommand from asyar-sdk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionCommand {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub trigger: Option<String>,
    /// Execution mode. `"view"` commands open the on-demand view iframe and
    /// render the component named by `component`. `"background"` commands
    /// execute in the always-on worker context (Phase 2/3). Replaces the
    /// legacy `resultType` field.
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    /// Name of the Svelte component exported by the extension's `view.ts`
    /// entry. Required iff `mode === "view"`; forbidden otherwise.
    #[serde(default)]
    pub component: Option<String>,
    #[serde(default)]
    pub schedule: Option<ScheduleDeclaration>,
    #[serde(default)]
    pub preferences: Option<Vec<PreferenceDeclaration>>,
    #[serde(default)]
    pub actions: Option<Vec<ManifestAction>>,
    /// Declarative argument list — when present, Tab on the selected command
    /// in the launcher promotes it into argument-entry mode.
    #[serde(default)]
    pub arguments: Option<Vec<CommandArgument>>,
}

/// Declares the always-on worker bundle for extensions that host background
/// work (subscriptions, schedules, timers, tray updates). Required when any
/// command declares `mode: "background"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundSpec {
    /// Path (relative to the extension root) of the compiled worker bundle.
    pub main: String,
}

/// Mirrors the ExtensionManifest from asyar-sdk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: Option<String>,
    /// Top-level extension kind. Legal values are `"extension"` (default
    /// when absent) and `"theme"`. The legacy values `"view"` and `"result"`
    /// are strictly rejected at parse time; per-command `mode` now carries
    /// the view/background distinction.
    #[serde(rename = "type", default)]
    pub extension_type: Option<String>,
    /// Worker bundle declaration. Present iff the extension declares at
    /// least one `mode: "background"` command (or reserves a push-event
    /// subscription for a future phase).
    #[serde(default)]
    pub background: Option<BackgroundSpec>,
    #[serde(default)]
    pub searchable: Option<bool>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub commands: Vec<ExtensionCommand>,
    #[serde(default)]
    pub permissions: Option<Vec<String>>,
    /// Sidecar for parameterized permissions. Each key must also appear
    /// in `permissions`. Value shape is permission-specific; currently only
    /// `fs:watch` uses it (value must be `string[]` of glob patterns).
    #[serde(default, rename = "permissionArgs")]
    pub permission_args: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default)]
    pub min_app_version: Option<String>,
    #[serde(default)]
    pub asyar_sdk: Option<String>,
    #[serde(default)]
    pub platforms: Option<Vec<String>>,
    #[serde(default)]
    pub preferences: Option<Vec<PreferenceDeclaration>>,
    #[serde(default)]
    pub actions: Option<Vec<ManifestAction>>,
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
    #[serde(rename_all = "camelCase")]
    PlatformNotSupported {
        platform: String,
        supported: Vec<String>,
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

/// The parsed content of a theme extension's theme.json file.
/// Note: no `rename_all = "camelCase"` — theme.json keys are CSS variable names
/// (with hyphens) and simple lowercase field names, not camelCase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeDefinition {
    pub variables: HashMap<String, String>,
    #[serde(default)]
    pub fonts: Vec<ThemeFontEntry>,
}

/// A single @font-face entry declared by a theme.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeFontEntry {
    pub family: String,
    #[serde(default)]
    pub weight: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    pub src: String,
}

/// Cross-validate `permissions` and `permission_args` on a loaded
/// manifest. Enforces: `fs:watch` declared iff `permission_args["fs:watch"]`
/// is present; value is `Array<String>`; every string is a valid manifest
/// pattern (see `fs_watcher::matcher::validate_manifest_pattern`).
pub fn validate_permission_args(m: &ExtensionManifest) -> Result<(), AppError> {
    let has_fs_watch = m
        .permissions
        .as_ref()
        .map(|list| list.iter().any(|p| p == "fs:watch"))
        .unwrap_or(false);
    let fs_watch_args = m
        .permission_args
        .as_ref()
        .and_then(|map| map.get("fs:watch"));

    match (has_fs_watch, fs_watch_args) {
        (false, None) => Ok(()),
        (true, None) => Err(AppError::Validation(
            "manifest declares permission 'fs:watch' but no permissionArgs.fs:watch entry"
                .into(),
        )),
        (false, Some(_)) => Err(AppError::Validation(
            "manifest declares permissionArgs.fs:watch but does not declare 'fs:watch' in permissions"
                .into(),
        )),
        (true, Some(value)) => {
            let arr = value.as_array().ok_or_else(|| {
                AppError::Validation(
                    "permissionArgs.fs:watch must be an array of glob strings".into(),
                )
            })?;
            let home = dirs::home_dir().ok_or_else(|| {
                AppError::Other("could not determine $HOME".into())
            })?;
            for item in arr {
                let s = item.as_str().ok_or_else(|| {
                    AppError::Validation(
                        "permissionArgs.fs:watch entries must be strings".into(),
                    )
                })?;
                crate::fs_watcher::matcher::validate_manifest_pattern(s, &home)?;
            }
            Ok(())
        }
    }
}

/// Reads and parses theme.json from an extension directory.
pub(crate) fn read_theme_definition(extension_dir: &Path) -> Result<ThemeDefinition, AppError> {
    let theme_path = extension_dir.join("theme.json");
    let content = fs::read_to_string(&theme_path).map_err(AppError::Io)?;
    let definition: ThemeDefinition = serde_json::from_str(&content).map_err(AppError::Json)?;
    Ok(definition)
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
            "type": "extension",
            "commands": [{
                "id": "test-cmd",
                "name": "Test Command",
                "description": "A test command",
                "mode": "view",
                "component": "MainView"
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
            "type": "extension",
            "background": { "main": "dist/worker.js" },
            "searchable": true,
            "icon": "🔍",
            "permissions": ["clipboard:read", "network"],
            "commands": [
                { "id": "tick", "name": "Tick", "mode": "background" }
            ]
        });
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();

        let m = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap();
        assert_eq!(m.extension_type.as_deref(), Some("extension"));
        assert_eq!(m.background.as_ref().unwrap().main, "dist/worker.js");
        assert_eq!(m.searchable, Some(true));
        assert_eq!(m.icon, Some("🔍".into()));
        assert_eq!(m.permissions, Some(vec!["clipboard:read".into(), "network".into()]));
    }

    /// A single-command manifest body that passes the new schema validator.
    /// Tests that exercise orthogonal concerns (permission_args, etc.) should
    /// merge this with their specific fields.
    fn valid_manifest_fields() -> serde_json::Value {
        serde_json::json!({
            "type": "extension",
            "commands": [
                { "id": "run", "name": "Run", "mode": "view", "component": "MainView" }
            ]
        })
    }

    /// Merge two JSON objects shallowly (b overrides a).
    fn merge_json(mut a: serde_json::Value, b: serde_json::Value) -> serde_json::Value {
        if let (Some(map_a), Some(map_b)) = (a.as_object_mut(), b.as_object()) {
            for (k, v) in map_b {
                map_a.insert(k.clone(), v.clone());
            }
        }
        a
    }

    #[test]
    fn reads_manifest_with_permission_args() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path();
        // Use /tmp as the prefix so validation accepts it regardless of $HOME.
        let manifest = merge_json(valid_manifest_fields(), serde_json::json!({
            "id": "test.fs-watch-ext",
            "name": "FS Watch Test",
            "version": "0.1.0",
            "permissions": ["fs:watch"],
            "permissionArgs": {
                "fs:watch": ["/tmp/asyar-fs-watch/**", "/tmp/asyar-ssh-config"]
            }
        }));
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();

        let m = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap();
        assert_eq!(m.permissions, Some(vec!["fs:watch".into()]));
        let args = m.permission_args.as_ref().expect("permission_args parsed");
        let fs_watch = args.get("fs:watch").expect("fs:watch key present");
        let arr = fs_watch.as_array().expect("fs:watch value is array");
        assert_eq!(arr.len(), 2);
    }

    #[test]
    fn rejects_manifest_declaring_fs_watch_without_args() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path();
        let manifest = merge_json(valid_manifest_fields(), serde_json::json!({
            "id": "bad.ext",
            "name": "Bad",
            "version": "0.1.0",
            "permissions": ["fs:watch"]
        }));
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
        let err = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap_err();
        assert!(format!("{err}").contains("fs:watch"), "got: {err}");
    }

    #[test]
    fn rejects_manifest_declaring_fs_watch_args_without_permission() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path();
        let manifest = merge_json(valid_manifest_fields(), serde_json::json!({
            "id": "bad.ext",
            "name": "Bad",
            "version": "0.1.0",
            "permissionArgs": {
                "fs:watch": ["/tmp/foo"]
            }
        }));
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
        let err = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap_err();
        assert!(format!("{err}").contains("fs:watch"), "got: {err}");
    }

    #[test]
    fn rejects_manifest_with_fs_watch_non_array_value() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path();
        let manifest = merge_json(valid_manifest_fields(), serde_json::json!({
            "id": "bad.ext",
            "name": "Bad",
            "version": "0.1.0",
            "permissions": ["fs:watch"],
            "permissionArgs": { "fs:watch": "/tmp/foo" }
        }));
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
        let err = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap_err();
        assert!(format!("{err}").contains("fs:watch"), "got: {err}");
    }

    #[test]
    fn rejects_manifest_with_fs_watch_pattern_outside_home() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path();
        let manifest = merge_json(valid_manifest_fields(), serde_json::json!({
            "id": "bad.ext",
            "name": "Bad",
            "version": "0.1.0",
            "permissions": ["fs:watch"],
            "permissionArgs": { "fs:watch": ["/etc/passwd"] }
        }));
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
        let err = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap_err();
        assert!(format!("{err}").contains("must resolve"), "got: {err}");
    }

    #[test]
    fn test_read_manifest_minimal() {
        let tmp = TempDir::new().unwrap();
        let ext_dir = tmp.path().join("min-ext");
        fs::create_dir_all(&ext_dir).unwrap();
        // Minimum valid manifest under the new schema: one background command
        // plus a background.main bundle path.
        let manifest = serde_json::json!({
            "id": "min-ext",
            "name": "Minimal",
            "version": "0.1.0",
            "background": { "main": "dist/worker.js" },
            "commands": [
                { "id": "tick", "name": "Tick", "mode": "background" }
            ]
        });
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();

        let m = discovery::read_manifest(&ext_dir.join("manifest.json")).unwrap();
        assert_eq!(m.id, "min-ext");
        assert_eq!(m.commands.len(), 1);
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
    fn test_theme_definition_deserializes_from_json() {
        let json = r#"{
            "variables": {
                "--bg-primary": "rgba(25, 25, 35, 0.85)",
                "--accent-primary": "rgb(138, 43, 226)"
            },
            "fonts": [
                {
                    "family": "Inter",
                    "weight": "400",
                    "style": "normal",
                    "src": "fonts/Inter-Regular.woff2"
                }
            ]
        }"#;
        let def: ThemeDefinition = serde_json::from_str(json).unwrap();
        assert_eq!(def.variables.len(), 2);
        assert_eq!(def.variables.get("--bg-primary").unwrap(), "rgba(25, 25, 35, 0.85)");
        assert_eq!(def.fonts.len(), 1);
        assert_eq!(def.fonts[0].family, "Inter");
        assert_eq!(def.fonts[0].src, "fonts/Inter-Regular.woff2");
    }

    #[test]
    fn test_theme_definition_empty_fonts_optional() {
        let json = r#"{"variables": {"--bg-primary": "red"}}"#;
        let def: ThemeDefinition = serde_json::from_str(json).unwrap();
        assert!(def.fonts.is_empty());
    }

    #[test]
    fn test_read_theme_definition_from_dir() {
        let tmp = TempDir::new().unwrap();
        let theme_json = r#"{
            "variables": {"--bg-primary": "blue"},
            "fonts": []
        }"#;
        fs::write(tmp.path().join("theme.json"), theme_json).unwrap();
        let def = read_theme_definition(tmp.path()).unwrap();
        assert_eq!(def.variables.get("--bg-primary").unwrap(), "blue");
    }

    #[test]
    fn test_read_theme_definition_missing_file_errors() {
        let tmp = TempDir::new().unwrap();
        let result = read_theme_definition(tmp.path());
        assert!(matches!(result, Err(AppError::Io(_))));
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
                background: None,
                searchable: None,
                icon: None,
                commands: vec![],
                permissions: None,
                permission_args: None,
                min_app_version: None,
                asyar_sdk: None,
                platforms: None,
                preferences: None,
                actions: None,
            },
            enabled: true,
            is_built_in: false,
            path: "/tmp/test".into(),
            compatibility: CompatibilityStatus::Unknown,
        });
        assert_eq!(reg.len(), 1);
    }

    #[test]
    fn test_deserialize_command_with_schedule() {
        let json = r#"{
            "id": "check-deploys",
            "name": "Check Deployments",
            "description": "Checks deploy status",
            "mode": "background",
            "schedule": { "intervalSeconds": 300 }
        }"#;
        let cmd: ExtensionCommand = serde_json::from_str(json).unwrap();
        assert!(cmd.schedule.is_some());
        assert_eq!(cmd.schedule.unwrap().interval_seconds, 300);
    }

    #[test]
    fn test_deserialize_command_without_schedule() {
        let json = r#"{
            "id": "open-settings",
            "name": "Open Settings",
            "description": ""
        }"#;
        let cmd: ExtensionCommand = serde_json::from_str(json).unwrap();
        assert!(cmd.schedule.is_none());
    }

    #[test]
    fn test_schedule_roundtrip_serialization() {
        let decl = ScheduleDeclaration { interval_seconds: 600 };
        let json = serde_json::to_string(&decl).unwrap();
        let parsed: ScheduleDeclaration = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.interval_seconds, 600);
    }

    #[test]
    fn preference_declaration_deserializes_textfield() {
        let json = r#"{
            "name": "apiKey",
            "type": "password",
            "title": "API Key",
            "required": true
        }"#;
        let pref: PreferenceDeclaration = serde_json::from_str(json).unwrap();
        assert_eq!(pref.name, "apiKey");
        assert!(matches!(pref.preference_type, PreferenceType::Password));
        assert_eq!(pref.required, Some(true));
        assert_eq!(pref.default, None);
    }

    #[test]
    fn preference_declaration_dropdown_with_data() {
        let json = r#"{
            "name": "units",
            "type": "dropdown",
            "title": "Units",
            "default": "metric",
            "data": [
                { "value": "metric", "title": "Celsius" },
                { "value": "imperial", "title": "Fahrenheit" }
            ]
        }"#;
        let pref: PreferenceDeclaration = serde_json::from_str(json).unwrap();
        assert!(matches!(pref.preference_type, PreferenceType::Dropdown));
        let data = pref.data.as_ref().expect("data should be present");
        assert_eq!(data.len(), 2);
        assert_eq!(data[0].value, "metric");
        assert_eq!(data[0].title, "Celsius");
    }

    #[test]
    fn preference_type_accepts_all_supported_variants() {
        for t in &["textfield", "password", "number", "checkbox", "dropdown", "appPicker", "file", "directory"] {
            let json = format!(r#"{{ "name":"x", "type":"{}", "title":"x" }}"#, t);
            let _: PreferenceDeclaration = serde_json::from_str(&json)
                .unwrap_or_else(|e| panic!("Failed to parse type {}: {}", t, e));
        }
    }
}
