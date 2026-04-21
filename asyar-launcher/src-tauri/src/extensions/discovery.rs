use std::path::{Path};
use crate::error::AppError;
use super::{ExtensionManifest, ExtensionRecord, CompatibilityStatus, ManifestAction};
use log::{info, warn};
use semver::{Version, VersionReq};
use super::scheduler;
use super::{DropdownOption, PreferenceDeclaration, PreferenceType};
use std::collections::HashSet;

pub fn validate_preferences(prefs: &[PreferenceDeclaration]) -> Result<(), String> {
    let name_re = regex::Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*$").unwrap();
    let mut seen = HashSet::new();

    for p in prefs {
        if p.name.is_empty() {
            return Err("Preference name cannot be empty".to_string());
        }
        if !name_re.is_match(&p.name) {
            return Err(format!(
                "Preference name '{}' must match /^[a-zA-Z_][a-zA-Z0-9_]*$/",
                p.name
            ));
        }
        if !seen.insert(p.name.clone()) {
            return Err(format!("Duplicate preference name '{}'", p.name));
        }
        if p.title.trim().is_empty() {
            return Err(format!("Preference '{}' must have a title", p.name));
        }

        match p.preference_type {
            PreferenceType::Dropdown => {
                let data = p.data.as_ref().ok_or_else(|| {
                    format!("Preference '{}' of type 'dropdown' requires a 'data' field", p.name)
                })?;
                if data.is_empty() {
                    return Err(format!("Preference '{}' dropdown data cannot be empty", p.name));
                }
                if let Some(default) = &p.default {
                    let default_str = default.as_str().ok_or_else(|| {
                        format!("Preference '{}' dropdown default must be a string", p.name)
                    })?;
                    if !data.iter().any(|o: &DropdownOption| o.value == default_str) {
                        return Err(format!(
                            "Preference '{}' default '{}' not in dropdown data",
                            p.name, default_str
                        ));
                    }
                }
            }
            PreferenceType::Number => {
                if let Some(d) = &p.default {
                    if !d.is_number() {
                        return Err(format!(
                            "Preference '{}' default must be a number", p.name
                        ));
                    }
                }
            }
            PreferenceType::Checkbox => {
                if let Some(d) = &p.default {
                    if !d.is_boolean() {
                        return Err(format!(
                            "Preference '{}' default must be a boolean", p.name
                        ));
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}
pub fn validate_actions(actions: &[ManifestAction], scope: &str) -> Result<(), String> {
    let id_re = regex::Regex::new(r"^[a-zA-Z][a-zA-Z0-9_-]*$").unwrap();
    let mut seen = HashSet::new();

    for a in actions {
        if a.id.is_empty() {
            return Err(format!("Action in {} scope has empty id", scope));
        }
        if !id_re.is_match(&a.id) {
            return Err(format!(
                "Action id '{}' in {} scope must match /^[a-zA-Z][a-zA-Z0-9_-]*$/",
                a.id, scope
            ));
        }
        if !seen.insert(a.id.clone()) {
            return Err(format!("Duplicate action id '{}' in {} scope", a.id, scope));
        }
        if a.title.trim().is_empty() {
            return Err(format!("Action '{}' in {} scope must have a non-empty title", a.id, scope));
        }
    }
    Ok(())
}

pub fn validate_actions_cross_scope(
    ext_actions: &[ManifestAction],
    cmd_action_groups: &[&[ManifestAction]],
) -> Result<(), String> {
    let ext_ids: HashSet<&str> = ext_actions.iter().map(|a| a.id.as_str()).collect();
    for group in cmd_action_groups {
        for a in *group {
            if ext_ids.contains(a.id.as_str()) {
                return Err(format!(
                    "Action id '{}' declared at both extension and command level",
                    a.id
                ));
            }
        }
    }
    Ok(())
}

const SUPPORTED_SDK_VERSION: &str = env!("ASYAR_SDK_VERSION");

/// Scan a directory for extension subdirectories containing manifest.json.
/// Returns a Vec of (extension_id, manifest, directory_path).
pub fn scan_extensions_dir(dir: &Path, is_built_in: bool) -> Vec<ExtensionRecord> {
    let mut records = Vec::new();
    
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            warn!("Could not read extensions directory {:?}: {}", dir, e);
            return records;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        match read_manifest(&manifest_path) {
            Ok(mut manifest) => {
                let id = manifest.id.clone();
                
                // Validate schedule declarations — strip invalid ones gracefully
                for cmd in &mut manifest.commands {
                    if let Some(ref schedule) = cmd.schedule {
                        if let Err(e) = scheduler::validate_interval(schedule.interval_seconds) {
                            warn!(
                                "Extension '{}' command '{}': {}. Stripping schedule.",
                                manifest.id, cmd.id, e
                            );
                            cmd.schedule = None;
                        }
                    }
                }

                // Validate preferences — fail loud on invalid manifest.
                // Any invalid preference declaration (extension-level OR
                // command-level) skips the entire extension.
                let mut prefs_valid = true;
                if let Some(prefs) = &manifest.preferences {
                    if let Err(e) = validate_preferences(prefs) {
                        warn!(
                            "Extension '{}' has invalid preferences: {}. Skipping.",
                            manifest.id, e
                        );
                        prefs_valid = false;
                    }
                }
                if prefs_valid {
                    for cmd in &manifest.commands {
                        if let Some(prefs) = &cmd.preferences {
                            if let Err(e) = validate_preferences(prefs) {
                                warn!(
                                    "Extension '{}' command '{}' has invalid preferences: {}. Skipping extension.",
                                    manifest.id, cmd.id, e
                                );
                                prefs_valid = false;
                                break;
                            }
                        }
                    }
                }
                if !prefs_valid {
                    continue;
                }

                // Validate action declarations
                let mut actions_valid = true;
                if let Some(actions) = &manifest.actions {
                    if let Err(e) = validate_actions(actions, "extension") {
                        warn!(
                            "Extension '{}' has invalid actions: {}. Skipping.",
                            manifest.id, e
                        );
                        actions_valid = false;
                    }
                }
                if actions_valid {
                    for cmd in &manifest.commands {
                        if let Some(actions) = &cmd.actions {
                            if let Err(e) = validate_actions(actions, &format!("command '{}'", cmd.id)) {
                                warn!(
                                    "Extension '{}' command '{}' has invalid actions: {}. Skipping extension.",
                                    manifest.id, cmd.id, e
                                );
                                actions_valid = false;
                                break;
                            }
                        }
                    }
                }
                // Cross-scope uniqueness: extension-level action IDs must not collide with command-level
                if actions_valid {
                    let ext_actions = manifest.actions.as_deref().unwrap_or(&[]);
                    let cmd_action_groups: Vec<&[ManifestAction]> = manifest.commands.iter()
                        .filter_map(|c| c.actions.as_deref())
                        .collect();
                    if let Err(e) = validate_actions_cross_scope(ext_actions, &cmd_action_groups) {
                        warn!(
                            "Extension '{}' has conflicting action IDs: {}. Skipping.",
                            manifest.id, e
                        );
                        actions_valid = false;
                    }
                }
                if !actions_valid {
                    continue;
                }

                records.push(ExtensionRecord {
                    manifest: manifest.clone(),
                    enabled: true, // Will be updated from settings later
                    is_built_in,
                    path: path.to_string_lossy().to_string(),
                    compatibility: if is_built_in {
                        CompatibilityStatus::Compatible
                    } else {
                        validate_compatibility(&manifest)
                    },
                });
                info!("Discovered extension: {} at {:?}", id, path);
            }
            Err(e) => {
                warn!("Failed to parse manifest at {:?}: {}", manifest_path, e);
            }
        }
    }

    records
}

/// Read and parse a single manifest.json file
pub fn read_manifest(path: &Path) -> Result<ExtensionManifest, AppError> {
    let content = std::fs::read_to_string(path)
        .map_err(AppError::Io)?;
    let manifest: ExtensionManifest = serde_json::from_str(&content)
        .map_err(AppError::Json)?;
    crate::extensions::validate_permission_args(&manifest)?;
    Ok(manifest)
}

/// Check if an extension's declared requirements are compatible with this app.
pub fn validate_compatibility(manifest: &ExtensionManifest) -> CompatibilityStatus {
    // Platform check — most fundamental gate, evaluated first
    if let Some(ref platforms) = manifest.platforms {
        let current_os = std::env::consts::OS;
        if !platforms.iter().any(|p| p.as_str() == current_os) {
            return CompatibilityStatus::PlatformNotSupported {
                platform: current_os.to_string(),
                supported: platforms.clone(),
            };
        }
    }

    let app_version_str = env!("CARGO_PKG_VERSION");

    // Check asyarSdk requirement
    if let Some(ref sdk_req_str) = manifest.asyar_sdk {
        match VersionReq::parse(sdk_req_str) {
            Ok(req) => {
                match Version::parse(SUPPORTED_SDK_VERSION) {
                    Ok(supported) => {
                        if !req.matches(&supported) {
                            return CompatibilityStatus::SdkMismatch {
                                required: sdk_req_str.clone(),
                                supported: SUPPORTED_SDK_VERSION.to_string(),
                            };
                        }
                    }
                    Err(_) => {
                        // Our own version string is invalid — shouldn't happen, treat as compatible
                        warn!("Failed to parse SUPPORTED_SDK_VERSION: {}", SUPPORTED_SDK_VERSION);
                    }
                }
            }
            Err(_) => {
                warn!(
                    "Extension {} has invalid asyarSdk requirement: {}",
                    manifest.id, sdk_req_str
                );
                // Invalid semver range — treat as unknown rather than blocking
                return CompatibilityStatus::Unknown;
            }
        }
    }

    // Check minAppVersion requirement
    if let Some(ref min_app_str) = manifest.min_app_version {
        match (Version::parse(min_app_str), Version::parse(app_version_str)) {
            (Ok(required), Ok(current)) => {
                if current < required {
                    return CompatibilityStatus::AppVersionTooOld {
                        required: min_app_str.clone(),
                        current: app_version_str.to_string(),
                    };
                }
            }
            _ => {
                warn!(
                    "Failed to parse version strings for minAppVersion check: min={}, current={}",
                    min_app_str, app_version_str
                );
            }
        }
    }

    // If asyarSdk was declared and passed, it's Compatible
    // If neither field was set, it's Unknown
    if manifest.asyar_sdk.is_some() {
        CompatibilityStatus::Compatible
    } else {
        CompatibilityStatus::Unknown
    }
}

#[cfg(test)]
mod compatibility_tests {
    use super::*;
    use crate::extensions::{ExtensionManifest, CompatibilityStatus};

    fn test_manifest(asyar_sdk: Option<&str>, min_app_version: Option<&str>) -> ExtensionManifest {
        ExtensionManifest {
            id: "test.extension".to_string(),
            name: "Test".to_string(),
            version: "1.0.0".to_string(),
            description: "Test extension".to_string(),
            author: None,
            extension_type: None,
            default_view: None,
            searchable: None,
            icon: None,
            main: None,
            commands: vec![],
            permissions: None,
            permission_args: None,
            min_app_version: min_app_version.map(String::from),
            asyar_sdk: asyar_sdk.map(String::from),
            platforms: None,
            preferences: None,
            actions: None,
        }
    }

    fn make_manifest_with_platforms(platforms: Option<Vec<String>>) -> ExtensionManifest {
        let mut m = test_manifest(Some("^1.0.0"), None);
        m.platforms = platforms;
        m
    }

    #[test]
    fn test_no_version_fields_returns_unknown() {
        let manifest = test_manifest(None, None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Unknown);
    }

    #[test]
    fn test_compatible_sdk_range() {
        let manifest = test_manifest(Some("^1.0.0"), None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Compatible);
    }

    #[test]
    fn test_compatible_exact_sdk() {
        let manifest = test_manifest(Some("1.3.4"), None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Compatible);
    }

    #[test]
    fn test_incompatible_sdk_major() {
        let manifest = test_manifest(Some("^2.0.0"), None);
        match validate_compatibility(&manifest) {
            CompatibilityStatus::SdkMismatch { required, supported } => {
                assert_eq!(required, "^2.0.0");
                assert_eq!(supported, SUPPORTED_SDK_VERSION);
            }
            other => panic!("Expected SdkMismatch, got {:?}", other),
        }
    }

    #[test]
    fn test_incompatible_sdk_minor() {
        // Use a far-future minor version that will never be the supported SDK version
        let manifest = test_manifest(Some("^999.0.0"), None);
        match validate_compatibility(&manifest) {
            CompatibilityStatus::SdkMismatch { required, supported: _ } => {
                assert_eq!(required, "^999.0.0");
            }
            other => panic!("Expected SdkMismatch, got {:?}", other),
        }
    }

    #[test]
    fn supported_sdk_version_matches_sdk_package_json() {
        // Regression guard: SUPPORTED_SDK_VERSION must equal the version in
        // asyar-sdk/package.json. A drift between the two silently rejects
        // every third-party extension whose asyarSdk range targets the real
        // SDK — the exact bug this build-time injection prevents.
        let pkg_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("node_modules")
            .join("asyar-sdk")
            .join("package.json");
        let pkg = std::fs::read_to_string(&pkg_path)
            .unwrap_or_else(|e| panic!("could not read {:?}: {}", pkg_path, e));
        let sdk_version = pkg
            .lines()
            .find_map(|line| {
                let t = line.trim();
                t.strip_prefix("\"version\":")
                    .map(|r| r.trim().trim_end_matches(',').trim_matches('"').to_string())
            })
            .expect("asyar-sdk/package.json must contain a \"version\" field");

        assert_eq!(
            SUPPORTED_SDK_VERSION, sdk_version,
            "SUPPORTED_SDK_VERSION ({}) must match asyar-sdk/package.json version ({}). \
             If these drift, extensions declaring the real SDK version will be rejected as SdkMismatch.",
            SUPPORTED_SDK_VERSION, sdk_version
        );
    }

    #[test]
    fn test_app_version_satisfied() {
        // Use "0.0.1" which should always be <= current app version
        let manifest = test_manifest(None, Some("0.0.1"));
        // No asyarSdk field, so result is Unknown (minAppVersion passed but doesn't upgrade to Compatible)
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Unknown);
    }

    #[test]
    fn test_app_version_too_old() {
        let manifest = test_manifest(None, Some("99.0.0"));
        match validate_compatibility(&manifest) {
            CompatibilityStatus::AppVersionTooOld { required, current: _ } => {
                assert_eq!(required, "99.0.0");
            }
            other => panic!("Expected AppVersionTooOld, got {:?}", other),
        }
    }

    #[test]
    fn test_both_fields_compatible() {
        let manifest = test_manifest(Some("^1.0.0"), Some("0.0.1"));
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Compatible);
    }

    #[test]
    fn test_invalid_sdk_range_returns_unknown() {
        let manifest = test_manifest(Some("not-semver"), None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Unknown);
    }

    #[test]
    fn test_platforms_absent_allows_any_os() {
        let manifest = make_manifest_with_platforms(None);
        let result = validate_compatibility(&manifest);
        assert!(!matches!(result, CompatibilityStatus::PlatformNotSupported { .. }));
    }

    #[test]
    fn test_current_os_in_platforms_list_is_allowed() {
        let os = std::env::consts::OS;
        let manifest = make_manifest_with_platforms(Some(vec![os.to_string()]));
        assert!(!matches!(validate_compatibility(&manifest), CompatibilityStatus::PlatformNotSupported { .. }));
    }

    #[test]
    fn test_os_not_in_platforms_list_returns_not_supported() {
        let others: Vec<String> = ["macos", "windows", "linux"]
            .iter()
            .filter(|&&p| p != std::env::consts::OS)
            .map(|s| s.to_string())
            .collect();
        if others.is_empty() { return; }
        let manifest = make_manifest_with_platforms(Some(others.clone()));
        match validate_compatibility(&manifest) {
            CompatibilityStatus::PlatformNotSupported { platform, supported } => {
                assert_eq!(platform, std::env::consts::OS);
                assert_eq!(supported, others);
            }
            other => panic!("Expected PlatformNotSupported, got {:?}", other),
        }
    }

    #[test]
    fn test_empty_platforms_list_returns_not_supported() {
        let manifest = make_manifest_with_platforms(Some(vec![]));
        assert!(matches!(validate_compatibility(&manifest), CompatibilityStatus::PlatformNotSupported { .. }));
    }
}

#[cfg(test)]
mod discovery_tests {
    use super::*;
    use crate::extensions::{ExtensionCommand, ScheduleDeclaration};

    #[test]
    fn test_schedule_validation_strips_invalid() {
        let mut cmd = ExtensionCommand {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: String::new(),
            trigger: None,
            result_type: None,
            icon: None,
            view: None,
            schedule: Some(ScheduleDeclaration { interval_seconds: 5 }),
            preferences: None,
            actions: None,
            arguments: None,
        };
        // Simulate what discovery does
        if let Some(ref schedule) = cmd.schedule {
            if scheduler::validate_interval(schedule.interval_seconds).is_err() {
                cmd.schedule = None;
            }
        }
        assert!(cmd.schedule.is_none());
    }

    #[test]
    fn test_schedule_validation_preserves_valid() {
        let mut cmd = ExtensionCommand {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: String::new(),
            trigger: None,
            result_type: None,
            icon: None,
            view: None,
            schedule: Some(ScheduleDeclaration { interval_seconds: 300 }),
            preferences: None,
            actions: None,
            arguments: None,
        };
        if let Some(ref schedule) = cmd.schedule {
            if scheduler::validate_interval(schedule.interval_seconds).is_err() {
                cmd.schedule = None;
            }
        }
        assert!(cmd.schedule.is_some());
        assert_eq!(cmd.schedule.unwrap().interval_seconds, 300);
    }

    fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("{}-{}-{}", prefix, pid, nanos));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn invalid_command_preferences_skip_entire_extension() {
        // Regression test for the `continue` loop bug: an extension with
        // invalid command-level preferences must not load, even though only
        // the command's prefs are invalid.
        let tmp = unique_temp_dir("asyar-test-invalid-cmd-prefs");
        let ext_dir = tmp.join("bad-ext");
        std::fs::create_dir_all(&ext_dir).unwrap();
        let manifest = r#"{
            "id": "org.test.bad",
            "name": "Bad",
            "version": "1.0.0",
            "description": "x",
            "author": "t",
            "commands": [{
                "id": "c",
                "name": "C",
                "description": "x",
                "preferences": [{ "name": "", "type": "textfield", "title": "bad" }]
            }]
        }"#;
        std::fs::write(ext_dir.join("manifest.json"), manifest).unwrap();

        let records = scan_extensions_dir(&tmp, false);

        // Clean up before asserting so a failure doesn't leak the temp dir.
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(
            records.iter().all(|r| r.manifest.id != "org.test.bad"),
            "extension with invalid command-level preferences must not load"
        );
    }

    #[test]
    fn invalid_extension_preferences_skip_entire_extension() {
        let tmp = unique_temp_dir("asyar-test-invalid-ext-prefs");
        let ext_dir = tmp.join("bad-ext");
        std::fs::create_dir_all(&ext_dir).unwrap();
        let manifest = r#"{
            "id": "org.test.bad2",
            "name": "Bad2",
            "version": "1.0.0",
            "description": "x",
            "author": "t",
            "commands": [],
            "preferences": [
                { "name": "x", "type": "dropdown", "title": "X" }
            ]
        }"#;
        std::fs::write(ext_dir.join("manifest.json"), manifest).unwrap();

        let records = scan_extensions_dir(&tmp, false);
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(
            records.iter().all(|r| r.manifest.id != "org.test.bad2"),
            "extension with invalid extension-level preferences must not load"
        );
    }

    #[test]
    fn valid_preferences_allow_extension_to_load() {
        let tmp = unique_temp_dir("asyar-test-valid-prefs");
        let ext_dir = tmp.join("good-ext");
        std::fs::create_dir_all(&ext_dir).unwrap();
        let manifest = r#"{
            "id": "org.test.good",
            "name": "Good",
            "version": "1.0.0",
            "description": "x",
            "author": "t",
            "commands": [],
            "preferences": [
                { "name": "api_key", "type": "textfield", "title": "API Key" }
            ]
        }"#;
        std::fs::write(ext_dir.join("manifest.json"), manifest).unwrap();

        let records = scan_extensions_dir(&tmp, false);
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(
            records.iter().any(|r| r.manifest.id == "org.test.good"),
            "extension with valid preferences must load"
        );
    }
}

#[cfg(test)]
mod preference_validation_tests {
    use super::*;
    use crate::extensions::{DropdownOption, PreferenceDeclaration, PreferenceType};

    fn pref(name: &str, t: PreferenceType) -> PreferenceDeclaration {
        PreferenceDeclaration {
            name: name.to_string(),
            preference_type: t,
            title: "Test".to_string(),
            description: None,
            required: None,
            default: None,
            placeholder: None,
            data: None,
        }
    }

    #[test]
    fn valid_prefs_pass() {
        let prefs = vec![pref("apiKey", PreferenceType::Textfield)];
        assert!(validate_preferences(&prefs).is_ok());
    }

    #[test]
    fn rejects_empty_name() {
        let prefs = vec![pref("", PreferenceType::Textfield)];
        assert!(validate_preferences(&prefs).is_err());
    }

    #[test]
    fn rejects_invalid_name_chars() {
        let prefs = vec![pref("api-key", PreferenceType::Textfield)];
        assert!(validate_preferences(&prefs).is_err());
    }

    #[test]
    fn rejects_duplicate_names() {
        let prefs = vec![
            pref("x", PreferenceType::Textfield),
            pref("x", PreferenceType::Checkbox),
        ];
        assert!(validate_preferences(&prefs).is_err());
    }

    #[test]
    fn rejects_dropdown_without_data() {
        let prefs = vec![pref("d", PreferenceType::Dropdown)];
        assert!(validate_preferences(&prefs).is_err());
    }

    #[test]
    fn rejects_dropdown_with_empty_data() {
        let mut p = pref("d", PreferenceType::Dropdown);
        p.data = Some(vec![]);
        assert!(validate_preferences(&[p]).is_err());
    }

    #[test]
    fn accepts_dropdown_with_valid_default() {
        let mut p = pref("d", PreferenceType::Dropdown);
        p.data = Some(vec![
            DropdownOption { value: "a".into(), title: "A".into() },
            DropdownOption { value: "b".into(), title: "B".into() },
        ]);
        p.default = Some(serde_json::json!("a"));
        assert!(validate_preferences(&[p]).is_ok());
    }

    #[test]
    fn rejects_dropdown_default_not_in_data() {
        let mut p = pref("d", PreferenceType::Dropdown);
        p.data = Some(vec![
            DropdownOption { value: "a".into(), title: "A".into() },
        ]);
        p.default = Some(serde_json::json!("b"));
        assert!(validate_preferences(&[p]).is_err());
    }

    #[test]
    fn checkbox_default_must_be_bool() {
        let mut p = pref("c", PreferenceType::Checkbox);
        p.default = Some(serde_json::json!("yes"));
        assert!(validate_preferences(&[p]).is_err());
    }

    #[test]
    fn number_default_must_be_number() {
        let mut p = pref("n", PreferenceType::Number);
        p.default = Some(serde_json::json!("5"));
        assert!(validate_preferences(&[p]).is_err());
    }
}

#[cfg(test)]
mod action_validation_tests {
    use super::*;
    use crate::extensions::ManifestAction;

    fn action(id: &str, title: &str) -> ManifestAction {
        ManifestAction {
            id: id.to_string(),
            title: title.to_string(),
            description: None,
            icon: None,
            shortcut: None,
            category: None,
        }
    }

    #[test]
    fn valid_actions_pass() {
        let actions = vec![
            action("open-browser", "Open in Browser"),
            action("copy_url", "Copy URL"),
        ];
        assert!(validate_actions(&actions, "extension").is_ok());
    }

    #[test]
    fn rejects_empty_action_id() {
        let actions = vec![action("", "Some Action")];
        assert!(validate_actions(&actions, "extension").is_err());
    }

    #[test]
    fn rejects_invalid_action_id_chars() {
        let actions = vec![action("bad action!", "Bad")];
        assert!(validate_actions(&actions, "extension").is_err());
    }

    #[test]
    fn rejects_action_id_starting_with_number() {
        let actions = vec![action("1action", "Bad")];
        assert!(validate_actions(&actions, "extension").is_err());
    }

    #[test]
    fn rejects_duplicate_action_ids_in_scope() {
        let actions = vec![
            action("dup", "First"),
            action("dup", "Second"),
        ];
        assert!(validate_actions(&actions, "extension").is_err());
    }

    #[test]
    fn rejects_empty_action_title() {
        let actions = vec![action("valid-id", "")];
        assert!(validate_actions(&actions, "extension").is_err());
    }

    #[test]
    fn rejects_whitespace_only_title() {
        let actions = vec![action("valid-id", "   ")];
        assert!(validate_actions(&actions, "extension").is_err());
    }

    #[test]
    fn rejects_cross_scope_duplicate_ids() {
        let ext_actions = vec![action("shared-id", "Ext Action")];
        let cmd_actions = vec![action("shared-id", "Cmd Action")];
        assert!(validate_actions_cross_scope(&ext_actions, &[&cmd_actions]).is_err());
    }

    #[test]
    fn allows_non_overlapping_cross_scope_ids() {
        let ext_actions = vec![action("ext-only", "Ext Action")];
        let cmd_actions = vec![action("cmd-only", "Cmd Action")];
        assert!(validate_actions_cross_scope(&ext_actions, &[&cmd_actions]).is_ok());
    }
}
