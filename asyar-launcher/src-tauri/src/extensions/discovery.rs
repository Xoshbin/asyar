use std::path::{Path};
use crate::error::AppError;
use super::{ExtensionManifest, ExtensionRecord, CompatibilityStatus, ManifestAction};
use log::{info, warn};
use semver::{Version, VersionReq};
use super::scheduler;
use super::{DropdownOption, PreferenceDeclaration, PreferenceType};
use std::collections::HashSet;

/// Legal values for `manifest.type`.
const EXTENSION_TYPE_EXTENSION: &str = "extension";
const EXTENSION_TYPE_THEME: &str = "theme";

/// Legal values for `commands[].mode`.
const COMMAND_MODE_VIEW: &str = "view";
const COMMAND_MODE_BACKGROUND: &str = "background";

/// Enforce the semantic invariants of the new manifest schema beyond what
/// serde alone expresses. `#[serde(deny_unknown_fields)]` on the struct
/// handles legacy-field rejection; this function handles the cross-field
/// rules from `docs/superpowers/plans/2026-04-21-tier2-worker-view-split.md`
/// §4.1.
pub fn validate_manifest(m: &ExtensionManifest) -> Result<(), AppError> {
    // `type` defaults to "extension" when absent. Narrow the legal set.
    let ext_type = m
        .extension_type
        .as_deref()
        .unwrap_or(EXTENSION_TYPE_EXTENSION);
    match ext_type {
        EXTENSION_TYPE_EXTENSION | EXTENSION_TYPE_THEME => {}
        other => {
            return Err(AppError::Validation(format!(
                "Extension '{}' has unsupported type '{}'. Legal values: \"extension\", \"theme\".",
                m.id, other
            )));
        }
    }

    if ext_type == EXTENSION_TYPE_THEME {
        if !m.commands.is_empty() {
            return Err(AppError::Validation(format!(
                "Theme extension '{}' must not declare commands ({} found).",
                m.id,
                m.commands.len()
            )));
        }
        if m.background.is_some() {
            return Err(AppError::Validation(format!(
                "Theme extension '{}' must not declare a background bundle.",
                m.id
            )));
        }
        return Ok(());
    }

    // type === "extension": must contribute something — either at least one
    // command, or `searchable: true` (the built-in calculator pattern), or
    // a reserved `background.main` bundle (for future push-event-only
    // extensions). An otherwise-empty manifest is user error.
    if m.commands.is_empty()
        && !m.searchable.unwrap_or(false)
        && m.background.is_none()
    {
        return Err(AppError::Validation(format!(
            "Extension '{}' (type=\"extension\") has no commands, is not searchable, and declares no background bundle — it contributes nothing.",
            m.id
        )));
    }

    let mut has_background_command = false;
    for cmd in &m.commands {
        let mode = cmd.mode.as_deref().unwrap_or(COMMAND_MODE_VIEW);
        match mode {
            COMMAND_MODE_VIEW => {
                let component_ok = cmd
                    .component
                    .as_ref()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
                if !component_ok {
                    return Err(AppError::Validation(format!(
                        "Command '{}' in extension '{}' has mode=\"view\" but no non-empty `component` field.",
                        cmd.id, m.id
                    )));
                }
            }
            COMMAND_MODE_BACKGROUND => {
                if cmd.component.is_some() {
                    return Err(AppError::Validation(format!(
                        "Command '{}' in extension '{}' has mode=\"background\" and must not declare `component`.",
                        cmd.id, m.id
                    )));
                }
                has_background_command = true;
            }
            other => {
                return Err(AppError::Validation(format!(
                    "Command '{}' in extension '{}' has unsupported mode '{}'. Legal values: \"view\", \"background\".",
                    cmd.id, m.id, other
                )));
            }
        }

        // Per-command structural + cross-field rules (e.g. `searchBarAccessory`
        // is only legal on `mode: "view"`). Wraps the validator's `String`
        // error in `AppError::Validation` to match the surrounding propagation
        // style.
        if let Err(e) = crate::extensions::validate_extension_command(cmd) {
            return Err(AppError::Validation(format!(
                "Command '{}' in extension '{}': {}",
                cmd.id, m.id, e
            )));
        }
    }

    if has_background_command {
        let main_ok = m
            .background
            .as_ref()
            .map(|b| !b.main.trim().is_empty())
            .unwrap_or(false);
        if !main_ok {
            return Err(AppError::Validation(format!(
                "Extension '{}' declares at least one mode=\"background\" command but has no non-empty `background.main`.",
                m.id
            )));
        }
    } else if m.background.is_some() {
        // Legal but unusual: a push-event-only extension may reserve a
        // worker bundle without yet declaring any background commands.
        // Surface as a warning to catch plausible author mistakes.
        warn!(
            "Extension '{}' declares a background bundle but no mode=\"background\" commands; the worker will still mount.",
            m.id
        );
    }

    Ok(())
}

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
                    first_view_component: manifest.first_view_component().map(String::from),
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
    validate_manifest(&manifest)?;
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
mod first_view_component_tests {
    use crate::extensions::{ExtensionManifest, ExtensionCommand, BackgroundSpec};

    fn manifest_with_commands(commands: Vec<ExtensionCommand>) -> ExtensionManifest {
        ExtensionManifest {
            id: "test".into(),
            name: "Test".into(),
            version: "1.0.0".into(),
            description: String::new(),
            author: None,
            extension_type: Some("extension".into()),
            background: None,
            searchable: None,
            icon: None,
            commands,
            permissions: None,
            permission_args: None,
            min_app_version: None,
            asyar_sdk: None,
            platforms: None,
            preferences: None,
            actions: None,
        }
    }

    fn view_cmd(id: &str, component: &str) -> ExtensionCommand {
        ExtensionCommand {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            trigger: None,
            mode: Some("view".into()),
            icon: None,
            component: Some(component.into()),
            schedule: None,
            preferences: None,
            actions: None,
            arguments: None,
            search_bar_accessory: None,
        }
    }

    fn bg_cmd(id: &str) -> ExtensionCommand {
        ExtensionCommand {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            trigger: None,
            mode: Some("background".into()),
            icon: None,
            component: None,
            schedule: None,
            preferences: None,
            actions: None,
            arguments: None,
            search_bar_accessory: None,
        }
    }

    #[test]
    fn returns_component_of_first_view_command() {
        let m = manifest_with_commands(vec![
            view_cmd("open", "MainView"),
            view_cmd("settings", "SettingsView"),
        ]);
        assert_eq!(m.first_view_component(), Some("MainView"));
    }

    #[test]
    fn skips_background_commands_to_find_first_view() {
        let m = manifest_with_commands(vec![
            bg_cmd("tick"),
            view_cmd("open", "MainView"),
        ]);
        assert_eq!(m.first_view_component(), Some("MainView"));
    }

    #[test]
    fn returns_none_when_no_view_commands() {
        let m = manifest_with_commands(vec![bg_cmd("tick")]);
        assert_eq!(m.first_view_component(), None);
    }

    #[test]
    fn returns_none_for_empty_commands() {
        let m = manifest_with_commands(vec![]);
        assert_eq!(m.first_view_component(), None);
    }

    #[test]
    fn returns_none_for_command_with_absent_mode_treated_as_view_but_no_component() {
        // mode defaults to "view" per schema rules, but we only return a
        // component if it is present and non-empty.
        let m = manifest_with_commands(vec![ExtensionCommand {
            id: "open".into(),
            name: "Open".into(),
            description: String::new(),
            trigger: None,
            mode: None,
            icon: None,
            component: None,
            schedule: None,
            preferences: None,
            actions: None,
            arguments: None,
            search_bar_accessory: None,
        }]);
        assert_eq!(m.first_view_component(), None);
    }

    #[test]
    fn preserves_tbd_placeholder_from_migration_script() {
        // Migration script writes "__TBD__" for un-migrated extensions.
        // first_view_component must return it as-is so the frontend can
        // detect and display a placeholder UI.
        let m = manifest_with_commands(vec![view_cmd("open", "__TBD__")]);
        assert_eq!(m.first_view_component(), Some("__TBD__"));
    }

    #[test]
    fn uses_mode_absent_default_when_component_present() {
        // A command with no explicit mode but with a component is treated as
        // view (mode defaults to "view"). It should be returned.
        let m = manifest_with_commands(vec![ExtensionCommand {
            id: "open".into(),
            name: "Open".into(),
            description: String::new(),
            trigger: None,
            mode: None,
            icon: None,
            component: Some("DefaultView".into()),
            schedule: None,
            preferences: None,
            actions: None,
            arguments: None,
            search_bar_accessory: None,
        }]);
        assert_eq!(m.first_view_component(), Some("DefaultView"));
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
            background: None,
            searchable: None,
            icon: None,
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
        let mut m = test_manifest(Some(&compatible_caret_range()), None);
        m.platforms = platforms;
        m
    }

    /// `^X.0.0` where `X` is the major of the SDK actually compiled in.
    /// Always matches `SUPPORTED_SDK_VERSION` regardless of the SDK's
    /// release cadence — pins the test to "compatible by construction"
    /// without freezing the version.
    fn compatible_caret_range() -> String {
        let v = semver::Version::parse(SUPPORTED_SDK_VERSION)
            .expect("SUPPORTED_SDK_VERSION must be valid semver");
        format!("^{}.0.0", v.major)
    }

    /// `^(X+1).0.0` — always one major above the SDK actually compiled
    /// in. Always rejected with SdkMismatch regardless of release cadence.
    fn incompatible_major_range() -> String {
        let v = semver::Version::parse(SUPPORTED_SDK_VERSION)
            .expect("SUPPORTED_SDK_VERSION must be valid semver");
        format!("^{}.0.0", v.major + 1)
    }

    #[test]
    fn test_no_version_fields_returns_unknown() {
        let manifest = test_manifest(None, None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Unknown);
    }

    #[test]
    fn test_compatible_sdk_range() {
        let range = compatible_caret_range();
        let manifest = test_manifest(Some(&range), None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Compatible);
    }

    #[test]
    fn test_compatible_exact_sdk() {
        // Exact match against the SDK actually compiled in. Always Compatible.
        let manifest = test_manifest(Some(SUPPORTED_SDK_VERSION), None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Compatible);
    }

    #[test]
    fn test_incompatible_sdk_major() {
        let range = incompatible_major_range();
        let manifest = test_manifest(Some(&range), None);
        match validate_compatibility(&manifest) {
            CompatibilityStatus::SdkMismatch { required, supported } => {
                assert_eq!(required, range);
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
        let range = compatible_caret_range();
        let manifest = test_manifest(Some(&range), Some("0.0.1"));
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
            mode: Some("background".into()),
            component: None,
            icon: None,
            schedule: Some(ScheduleDeclaration { interval_seconds: 5 }),
            preferences: None,
            actions: None,
            arguments: None,
            search_bar_accessory: None,
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
            mode: Some("background".into()),
            component: None,
            icon: None,
            schedule: Some(ScheduleDeclaration { interval_seconds: 300 }),
            preferences: None,
            actions: None,
            arguments: None,
            search_bar_accessory: None,
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
                "mode": "view",
                "component": "MainView",
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
            "commands": [
                { "id": "c", "name": "C", "mode": "view", "component": "MainView" }
            ],
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
            "commands": [
                { "id": "c", "name": "C", "mode": "view", "component": "MainView" }
            ],
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

#[cfg(test)]
mod manifest_schema_tests {
    //! Covers the new manifest schema introduced by the Tier 2 worker/view
    //! split (plan: docs/superpowers/plans/2026-04-21-tier2-worker-view-split.md
    //! §4.1). Every test walks a JSON fixture through `read_manifest`-style
    //! parsing (serde + `validate_manifest`) so the top-level
    //! `deny_unknown_fields` contract and the semantic rules are both
    //! exercised from the same vantage point.

    use super::*;

    /// Parse + validate; returns the full pipeline error whether serde or
    /// validator raises it.
    fn parse(json: &str) -> Result<ExtensionManifest, AppError> {
        let manifest: ExtensionManifest = serde_json::from_str(json)
            .map_err(AppError::Json)?;
        validate_manifest(&manifest)?;
        Ok(manifest)
    }

    // ── Happy paths ─────────────────────────────────────────────────────

    #[test]
    fn valid_minimal_extension_parses() {
        let json = r#"{
            "id": "org.test.min",
            "name": "Min",
            "version": "1.0.0",
            "background": { "main": "dist/worker.js" },
            "commands": [
                { "id": "run", "name": "Run", "mode": "background" }
            ]
        }"#;
        let m = parse(json).expect("minimal extension must parse");
        assert_eq!(m.extension_type, None);
        assert_eq!(m.commands.len(), 1);
        assert_eq!(m.commands[0].mode.as_deref(), Some("background"));
    }

    #[test]
    fn type_absent_defaults_to_extension() {
        let json = r#"{
            "id": "org.test.default",
            "name": "Default",
            "version": "0.1.0",
            "commands": [
                { "id": "open", "name": "Open", "mode": "view", "component": "MainView" }
            ]
        }"#;
        parse(json).expect("type absent should default to extension and validate");
    }

    #[test]
    fn valid_theme_manifest_parses() {
        let json = r#"{
            "id": "org.test.theme",
            "name": "Theme",
            "version": "1.0.0",
            "type": "theme"
        }"#;
        let m = parse(json).expect("valid theme must parse");
        assert_eq!(m.extension_type.as_deref(), Some("theme"));
        assert!(m.commands.is_empty());
        assert!(m.background.is_none());
    }

    #[test]
    fn valid_mixed_extension_with_background_and_view_parses() {
        let json = r#"{
            "id": "org.test.mixed",
            "name": "Mixed",
            "version": "2.0.0",
            "type": "extension",
            "background": { "main": "dist/worker.js" },
            "commands": [
                { "id": "open", "name": "Open", "mode": "view", "component": "MainView" },
                { "id": "tick", "name": "Tick", "mode": "background",
                  "schedule": { "intervalSeconds": 60 } }
            ]
        }"#;
        let m = parse(json).expect("mixed extension must parse");
        assert_eq!(m.commands.len(), 2);
        assert_eq!(m.background.as_ref().unwrap().main, "dist/worker.js");
    }

    #[test]
    fn background_main_without_background_commands_is_warning_not_error() {
        // Push-event-only extensions (future fs-watch style) may mount a
        // worker without exposing any user-invocable background commands.
        let json = r#"{
            "id": "org.test.pushonly",
            "name": "Push Only",
            "version": "1.0.0",
            "type": "extension",
            "background": { "main": "dist/worker.js" },
            "commands": [
                { "id": "open", "name": "Open", "mode": "view", "component": "MainView" }
            ]
        }"#;
        parse(json).expect("background.main without background commands should be legal (warning only)");
    }

    // ── Rejects legacy fields (deny_unknown_fields) ─────────────────────

    #[test]
    fn rejects_legacy_top_level_type_view() {
        let json = r#"{
            "id": "org.test.legacy",
            "name": "Legacy",
            "version": "1.0.0",
            "type": "view",
            "commands": [
                { "id": "open", "name": "Open", "mode": "view", "component": "MainView" }
            ]
        }"#;
        let err = parse(json).expect_err("legacy type \"view\" must be rejected");
        // Validator-level rejection (not serde) because "view" is a legal
        // JSON string, just not a legal value for the narrowed set.
        let msg = format!("{}", err);
        assert!(msg.contains("unsupported type"), "got: {msg}");
    }

    #[test]
    fn rejects_legacy_top_level_type_result() {
        let json = r#"{
            "id": "org.test.legacy",
            "name": "Legacy",
            "version": "1.0.0",
            "type": "result",
            "commands": []
        }"#;
        let err = parse(json).expect_err("legacy type \"result\" must be rejected");
        assert!(format!("{err}").contains("unsupported type"), "got: {err}");
    }

    #[test]
    fn rejects_legacy_command_result_type_field() {
        let json = r#"{
            "id": "org.test.legacy-cmd",
            "name": "Legacy Cmd",
            "version": "1.0.0",
            "commands": [
                { "id": "run", "name": "Run", "resultType": "no-view" }
            ]
        }"#;
        let err = parse(json).expect_err("legacy command.resultType must be rejected at parse time");
        let msg = format!("{err}");
        assert!(msg.contains("resultType") || msg.contains("unknown field"), "got: {msg}");
    }

    #[test]
    fn rejects_legacy_top_level_default_view_field() {
        let json = r#"{
            "id": "org.test.legacy-dv",
            "name": "Legacy DV",
            "version": "1.0.0",
            "defaultView": "SomeView",
            "commands": [
                { "id": "open", "name": "Open", "mode": "view", "component": "MainView" }
            ]
        }"#;
        let err = parse(json).expect_err("legacy defaultView must be rejected at parse time");
        let msg = format!("{err}");
        assert!(msg.contains("defaultView") || msg.contains("unknown field"), "got: {msg}");
    }

    #[test]
    fn rejects_legacy_top_level_main_field() {
        let json = r#"{
            "id": "org.test.legacy-main",
            "name": "Legacy Main",
            "version": "1.0.0",
            "main": "dist/index.js",
            "commands": [
                { "id": "run", "name": "Run", "mode": "background" }
            ]
        }"#;
        let err = parse(json).expect_err("legacy top-level main must be rejected at parse time");
        let msg = format!("{err}");
        assert!(msg.contains("main") || msg.contains("unknown field"), "got: {msg}");
    }

    #[test]
    fn rejects_unknown_top_level_field() {
        let json = r#"{
            "id": "org.test.unknown",
            "name": "Unknown",
            "version": "1.0.0",
            "commands": [
                { "id": "run", "name": "Run", "mode": "background" }
            ],
            "mysteryField": true
        }"#;
        let err = parse(json).expect_err("unknown top-level field must be rejected");
        assert!(format!("{err}").contains("unknown field"), "got: {err}");
    }

    #[test]
    fn rejects_legacy_command_view_field() {
        // The old schema had an optional `view` field on commands; it was
        // shadowed by the new `component` field so must be rejected.
        let json = r#"{
            "id": "org.test.legacy-view",
            "name": "Legacy View",
            "version": "1.0.0",
            "commands": [
                { "id": "open", "name": "Open", "mode": "view", "view": "MainView" }
            ]
        }"#;
        let err = parse(json).expect_err("legacy command.view must be rejected at parse time");
        let msg = format!("{err}");
        assert!(msg.contains("view") || msg.contains("unknown field"), "got: {msg}");
    }

    // ── Semantic validator rules ────────────────────────────────────────

    #[test]
    fn mode_view_without_component_is_rejected() {
        let json = r#"{
            "id": "org.test.no-component",
            "name": "No Component",
            "version": "1.0.0",
            "commands": [
                { "id": "open", "name": "Open", "mode": "view" }
            ]
        }"#;
        let err = parse(json).expect_err("mode=view missing component must fail validation");
        assert!(format!("{err}").contains("component"), "got: {err}");
    }

    #[test]
    fn mode_view_with_empty_component_is_rejected() {
        let json = r#"{
            "id": "org.test.empty-component",
            "name": "Empty Component",
            "version": "1.0.0",
            "commands": [
                { "id": "open", "name": "Open", "mode": "view", "component": "   " }
            ]
        }"#;
        let err = parse(json).expect_err("mode=view with whitespace-only component must fail validation");
        assert!(format!("{err}").contains("component"), "got: {err}");
    }

    #[test]
    fn mode_background_with_component_is_rejected() {
        let json = r#"{
            "id": "org.test.bg-component",
            "name": "BG with Component",
            "version": "1.0.0",
            "background": { "main": "dist/worker.js" },
            "commands": [
                { "id": "tick", "name": "Tick", "mode": "background", "component": "SomeView" }
            ]
        }"#;
        let err = parse(json).expect_err("mode=background with component must fail validation");
        assert!(format!("{err}").contains("component"), "got: {err}");
    }

    #[test]
    fn background_command_without_background_main_is_rejected() {
        let json = r#"{
            "id": "org.test.no-bg-main",
            "name": "No BG Main",
            "version": "1.0.0",
            "commands": [
                { "id": "tick", "name": "Tick", "mode": "background" }
            ]
        }"#;
        let err = parse(json)
            .expect_err("mode=background without background.main must fail validation");
        assert!(format!("{err}").contains("background.main"), "got: {err}");
    }

    #[test]
    fn background_command_with_blank_background_main_is_rejected() {
        let json = r#"{
            "id": "org.test.blank-bg-main",
            "name": "Blank BG Main",
            "version": "1.0.0",
            "background": { "main": "   " },
            "commands": [
                { "id": "tick", "name": "Tick", "mode": "background" }
            ]
        }"#;
        let err = parse(json)
            .expect_err("mode=background with whitespace-only background.main must fail validation");
        assert!(format!("{err}").contains("background.main"), "got: {err}");
    }

    #[test]
    fn theme_with_commands_is_rejected() {
        let json = r#"{
            "id": "org.test.theme-cmd",
            "name": "Theme With Cmd",
            "version": "1.0.0",
            "type": "theme",
            "commands": [
                { "id": "open", "name": "Open", "mode": "view", "component": "V" }
            ]
        }"#;
        let err = parse(json).expect_err("theme with commands must fail validation");
        assert!(format!("{err}").contains("commands"), "got: {err}");
    }

    #[test]
    fn theme_with_background_is_rejected() {
        let json = r#"{
            "id": "org.test.theme-bg",
            "name": "Theme With Background",
            "version": "1.0.0",
            "type": "theme",
            "background": { "main": "dist/worker.js" }
        }"#;
        let err = parse(json).expect_err("theme with background must fail validation");
        assert!(format!("{err}").contains("background"), "got: {err}");
    }

    #[test]
    fn extension_type_with_no_commands_and_no_contribution_is_rejected() {
        // An "extension" that declares nothing — no commands, no background,
        // not searchable — contributes nothing and is rejected.
        let json = r#"{
            "id": "org.test.empty",
            "name": "Empty",
            "version": "1.0.0",
            "type": "extension"
        }"#;
        let err = parse(json).expect_err("fully-empty type=extension must fail validation");
        assert!(format!("{err}").contains("contributes nothing"), "got: {err}");
    }

    #[test]
    fn searchable_extension_with_no_commands_is_allowed() {
        // The built-in Calculator pattern: a search-only extension that
        // implements its surface through the Rust search engine and exposes
        // no user-invocable commands of its own.
        let json = r#"{
            "id": "calculator",
            "name": "Calculator",
            "version": "1.0.0",
            "type": "extension",
            "searchable": true
        }"#;
        parse(json).expect("searchable extension with no commands should be legal");
    }

    /// Integration-style: every in-repo manifest.json (five extensions +
    /// all built-in features) must parse + validate under the new schema.
    /// This is the test that would fail if the migration script ever drifted
    /// out of sync with the Rust validator. Runs only when the workspace
    /// root is reachable from this crate — skipped in isolated test envs.
    #[test]
    fn every_in_repo_manifest_parses_and_validates() {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")  // asyar-launcher/
            .join(".."); // workspace root

        if !repo_root.exists() {
            // Running outside the workspace (e.g. from a tarball). Skip.
            return;
        }

        let manifest_paths: Vec<std::path::PathBuf> = {
            let mut paths = Vec::new();
            // Tier 2 extensions
            let ext_root = repo_root.join("extensions");
            if let Ok(entries) = std::fs::read_dir(&ext_root) {
                for entry in entries.flatten() {
                    let m = entry.path().join("manifest.json");
                    if m.exists() {
                        paths.push(m);
                    }
                }
            }
            // Tier 1 built-in features (exclude create-extension/template)
            let builtin_root = repo_root.join("asyar-launcher/src/built-in-features");
            if let Ok(entries) = std::fs::read_dir(&builtin_root) {
                for entry in entries.flatten() {
                    let m = entry.path().join("manifest.json");
                    if m.exists() {
                        paths.push(m);
                    }
                }
            }
            paths
        };

        assert!(
            manifest_paths.len() >= 5,
            "expected at least the five extension manifests, found {}",
            manifest_paths.len()
        );

        for path in &manifest_paths {
            let result = read_manifest(path);
            assert!(
                result.is_ok(),
                "manifest at {:?} failed parse/validate: {:?}",
                path,
                result.err()
            );
        }
    }

    #[test]
    fn background_only_extension_with_no_commands_is_allowed() {
        // Future push-event-only extensions reserve a worker bundle without
        // any user-invocable commands.
        let json = r#"{
            "id": "org.test.bg-only",
            "name": "BG Only",
            "version": "1.0.0",
            "type": "extension",
            "background": { "main": "dist/worker.js" }
        }"#;
        parse(json).expect("background-only extension with no commands should be legal");
    }

    #[test]
    fn unsupported_command_mode_is_rejected() {
        let json = r#"{
            "id": "org.test.bad-mode",
            "name": "Bad Mode",
            "version": "1.0.0",
            "commands": [
                { "id": "run", "name": "Run", "mode": "unknown" }
            ]
        }"#;
        let err = parse(json).expect_err("unsupported command mode must fail validation");
        assert!(format!("{err}").contains("mode"), "got: {err}");
    }

    #[test]
    fn mode_absent_defaults_to_view_and_requires_component() {
        // `mode` defaults to "view" per §4.1. A command with neither mode
        // nor component is a view command missing its component.
        let json = r#"{
            "id": "org.test.default-mode",
            "name": "Default Mode",
            "version": "1.0.0",
            "commands": [
                { "id": "open", "name": "Open" }
            ]
        }"#;
        let err = parse(json).expect_err("mode absent + component absent must fail validation");
        assert!(format!("{err}").contains("component"), "got: {err}");
    }

    #[test]
    fn validate_manifest_rejects_search_bar_accessory_on_background_mode_command() {
        // Per the searchbar-accessory feature: `searchBarAccessory` is only
        // legal on `mode: "view"` commands. The mode-level rule lives in
        // `validate_extension_command` — this test confirms `validate_manifest`
        // wires it into the production manifest validation path so install
        // time enforcement actually triggers.
        use crate::extensions::{
            BackgroundSpec, ExtensionCommand, ExtensionManifest, SearchBarAccessory,
            SearchBarAccessoryDropdownOption,
        };

        let manifest = ExtensionManifest {
            id: "org.test.bad-accessory".into(),
            name: "Bad Accessory".into(),
            version: "1.0.0".into(),
            description: String::new(),
            author: None,
            extension_type: Some("extension".into()),
            background: Some(BackgroundSpec {
                main: "dist/worker.js".into(),
            }),
            searchable: None,
            icon: None,
            commands: vec![ExtensionCommand {
                id: "tick".into(),
                name: "Tick".into(),
                description: String::new(),
                trigger: None,
                mode: Some("background".into()),
                icon: None,
                component: None,
                schedule: None,
                preferences: None,
                actions: None,
                arguments: None,
                search_bar_accessory: Some(SearchBarAccessory::Dropdown {
                    default: None,
                    options: vec![SearchBarAccessoryDropdownOption {
                        value: "x".into(),
                        title: "X".into(),
                    }],
                }),
            }],
            permissions: None,
            permission_args: None,
            min_app_version: None,
            asyar_sdk: None,
            platforms: None,
            preferences: None,
            actions: None,
        };

        let err = validate_manifest(&manifest)
            .expect_err("searchBarAccessory on mode=background command must fail validation");
        let msg = format!("{err}");
        assert!(
            msg.contains("searchBarAccessory"),
            "expected error to mention searchBarAccessory, got: {msg}"
        );
        assert!(
            msg.contains("view"),
            "expected error to mention view, got: {msg}"
        );
    }
}
