use super::scheduler;
use super::{CompatibilityStatus, ExtensionManifest, ExtensionRecord};
use super::{DropdownOption, PreferenceDeclaration, PreferenceType};
use crate::error::AppError;
use log::{info, warn};
use semver::{Version, VersionReq};
use std::collections::HashSet;
use std::path::Path;

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
    if m.commands.is_empty() && !m.searchable.unwrap_or(false) && m.background.is_none() {
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

    if let Some(runtimes) = &m.runtimes {
        for name in runtimes {
            if !crate::runtimes::catalog::is_known_runtime(name) {
                return Err(AppError::Validation(format!(
                    "Extension '{}' declares unknown runtime '{}'. Known runtimes: {}.",
                    m.id,
                    name,
                    crate::runtimes::catalog::known_names().join(", ")
                )));
            }
        }
    }

    if let Some(tasks) = &m.walkthrough {
        if let Err(e) = crate::walkthrough::validate_declarations(tasks) {
            return Err(AppError::Validation(format!("Extension '{}': {}", m.id, e)));
        }
    }

    if let Some(onb) = &m.onboarding {
        let target = m.commands.iter().find(|c| c.id == onb.command);
        match target {
            None => {
                return Err(AppError::Validation(format!(
                    "Extension '{}': onboarding.command '{}' does not match any command id",
                    m.id, onb.command
                )));
            }
            Some(cmd) => {
                let mode = cmd.mode.as_deref().unwrap_or(COMMAND_MODE_VIEW);
                if mode != COMMAND_MODE_VIEW {
                    return Err(AppError::Validation(format!(
                        "Extension '{}': onboarding.command '{}' must have mode \"view\", found \"{}\"",
                        m.id, onb.command, mode
                    )));
                }
            }
        }
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
                    format!(
                        "Preference '{}' of type 'dropdown' requires a 'data' field",
                        p.name
                    )
                })?;
                if data.is_empty() {
                    return Err(format!(
                        "Preference '{}' dropdown data cannot be empty",
                        p.name
                    ));
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
                        return Err(format!("Preference '{}' default must be a number", p.name));
                    }
                }
            }
            PreferenceType::Checkbox => {
                if let Some(d) = &p.default {
                    if !d.is_boolean() {
                        return Err(format!("Preference '{}' default must be a boolean", p.name));
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}
const SUPPORTED_SDK_VERSION: &str = env!("ASYAR_SDK_VERSION");

static BUILTIN_RECORDS: std::sync::OnceLock<Vec<ExtensionRecord>> = std::sync::OnceLock::new();

/// Returns statically compiled ExtensionRecord descriptors for all built-in platform features.
/// This completely eliminates cold-boot disk crawling and runtime manifest deserialization
/// for core built-in features.
pub fn get_builtin_records() -> Vec<ExtensionRecord> {
    BUILTIN_RECORDS
        .get_or_init(|| {
            let raw_manifests: &[(&str, &str)] = &[
                (
                    "agents",
                    include_str!("../../../src/built-in-features/agents/manifest.json"),
                ),
                (
                    "calculator",
                    include_str!("../../../src/built-in-features/calculator/manifest.json"),
                ),
                (
                    "clipboard-history",
                    include_str!("../../../src/built-in-features/clipboard-history/manifest.json"),
                ),
                (
                    "create-extension",
                    include_str!("../../../src/built-in-features/create-extension/manifest.json"),
                ),
                (
                    "feedback",
                    include_str!("../../../src/built-in-features/feedback/manifest.json"),
                ),
                (
                    "file-search",
                    include_str!("../../../src/built-in-features/file-search/manifest.json"),
                ),
                (
                    "help",
                    include_str!("../../../src/built-in-features/help/manifest.json"),
                ),
                (
                    "mcp",
                    include_str!("../../../src/built-in-features/mcp/manifest.json"),
                ),
                (
                    "notes",
                    include_str!("../../../src/built-in-features/notes/manifest.json"),
                ),
                (
                    "portals",
                    include_str!("../../../src/built-in-features/portals/manifest.json"),
                ),
                (
                    "quit",
                    include_str!("../../../src/built-in-features/quit/manifest.json"),
                ),
                (
                    "raycast-import",
                    include_str!("../../../src/built-in-features/raycast-import/manifest.json"),
                ),
                (
                    "runs",
                    include_str!("../../../src/built-in-features/runs/manifest.json"),
                ),
                (
                    "screen-ocr",
                    include_str!("../../../src/built-in-features/screen-ocr/manifest.json"),
                ),
                (
                    "scripts",
                    include_str!("../../../src/built-in-features/scripts/manifest.json"),
                ),
                (
                    "settings",
                    include_str!("../../../src/built-in-features/settings/manifest.json"),
                ),
                (
                    "shortcuts",
                    include_str!("../../../src/built-in-features/shortcuts/manifest.json"),
                ),
                (
                    "snippets",
                    include_str!("../../../src/built-in-features/snippets/manifest.json"),
                ),
                (
                    "store",
                    include_str!("../../../src/built-in-features/store/manifest.json"),
                ),
                (
                    "system",
                    include_str!("../../../src/built-in-features/system/manifest.json"),
                ),
                (
                    "system-settings",
                    include_str!("../../../src/built-in-features/system-settings/manifest.json"),
                ),
                (
                    "usage-stats",
                    include_str!("../../../src/built-in-features/usage-stats/manifest.json"),
                ),
                (
                    "walkthrough",
                    include_str!("../../../src/built-in-features/walkthrough/manifest.json"),
                ),
                (
                    "window-management",
                    include_str!("../../../src/built-in-features/window-management/manifest.json"),
                ),
            ];

            let mut records = Vec::with_capacity(raw_manifests.len());
            for (id, raw) in raw_manifests {
                match serde_json::from_str::<ExtensionManifest>(raw) {
                    Ok(manifest) => {
                        let disableable = manifest
                            .lifecycle
                            .as_ref()
                            .and_then(|l| l.disableable)
                            .unwrap_or(false);
                        records.push(ExtensionRecord {
                            first_view_component: manifest.first_view_component().map(String::from),
                            manifest,
                            enabled: true,
                            is_built_in: true,
                            disableable,
                            path: format!("builtin://{}", id),
                            compatibility: CompatibilityStatus::Compatible,
                        });
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to parse statically compiled built-in manifest for '{}': {}",
                            id,
                            e
                        );
                    }
                }
            }
            records
        })
        .clone()
}

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

                resolve_background_entry_for_layout(&mut manifest, &path);

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

                let disableable = if is_built_in {
                    manifest
                        .lifecycle
                        .as_ref()
                        .and_then(|l| l.disableable)
                        .unwrap_or(false)
                } else {
                    true
                };

                records.push(ExtensionRecord {
                    first_view_component: manifest.first_view_component().map(String::from),
                    manifest: manifest.clone(),
                    enabled: true, // Will be updated from settings later
                    is_built_in,
                    disableable,
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

/// Resolve the manifest's worker entry against the extension layout once, at
/// discovery time. Linked extensions retain their source-relative `dist/`
/// entry, while packages produced by older SDKs can use the flattened entry.
fn resolve_background_entry_for_layout(manifest: &mut ExtensionManifest, root: &Path) {
    let Some(background) = manifest.background.as_mut() else {
        return;
    };
    if let Some(resolved) = resolve_entry_for_layout(root, &background.main) {
        background.main = resolved;
    }
}

/// Find the on-disk spelling of a manifest-declared entry path under `root`.
/// Returns the declared path when it exists, the `dist/`-stripped path when
/// only the flattened (packaged) layout is present, and `None` otherwise.
pub(crate) fn resolve_entry_for_layout(root: &Path, declared: &str) -> Option<String> {
    if root.join(declared).is_file() {
        return Some(declared.to_string());
    }
    let flat = declared.strip_prefix("dist/")?;
    root.join(flat).is_file().then(|| flat.to_string())
}

#[cfg(test)]
mod background_entry_resolution_tests {
    use super::*;
    use crate::extensions::BackgroundSpec;
    use tempfile::TempDir;

    fn manifest_with_worker(main: &str) -> ExtensionManifest {
        ExtensionManifest {
            id: "test.worker".into(),
            name: "Worker".into(),
            version: "1.0.0".into(),
            description: String::new(),
            author: None,
            extension_type: Some("extension".into()),
            lifecycle: None,
            background: Some(BackgroundSpec { main: main.into() }),
            searchable: None,
            icon: None,
            commands: Vec::new(),
            permissions: None,
            permission_args: None,
            min_app_version: None,
            asyar_sdk: None,
            platforms: None,
            preferences: None,
            onboarding: None,
            runtimes: None,
            walkthrough: None,
            tools: None,
        }
    }

    #[test]
    fn keeps_declared_worker_entry_for_dev_linked_layout() {
        let tmp = TempDir::new().unwrap();
        let worker = tmp.path().join("dist/worker.js");
        std::fs::create_dir_all(worker.parent().unwrap()).unwrap();
        std::fs::write(worker, "export {};").unwrap();
        let mut manifest = manifest_with_worker("dist/worker.js");

        resolve_background_entry_for_layout(&mut manifest, tmp.path());

        assert_eq!(manifest.background.unwrap().main, "dist/worker.js");
    }

    #[test]
    fn falls_back_to_flat_worker_entry_for_installed_layout() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("worker.js"), "export {};").unwrap();
        let mut manifest = manifest_with_worker("dist/worker.js");

        resolve_background_entry_for_layout(&mut manifest, tmp.path());

        assert_eq!(manifest.background.unwrap().main, "worker.js");
    }
}

// remove in 0.2.0 — compatibility for published manifests that still declare
// `actions`. Manifest-declared root-search actions were removed; actions now
// live in views. The field is dropped before parsing (the manifest structs deny
// unknown fields) so those extensions keep loading, and a notice tells their
// authors it is going away. When this goes, `actions` becomes an ordinary
// unknown field again and such manifests are rejected.
const REMOVED_ACTIONS_VERSION: &str = "0.2.0";

/// Strip the removed `actions` field from a raw manifest and report where it
/// was declared (`"extension"` or `"command '<id>'"`).
fn strip_removed_actions(manifest: &mut serde_json::Value) -> Vec<String> {
    let mut found = Vec::new();
    let Some(root) = manifest.as_object_mut() else {
        return found;
    };
    if root.remove("actions").is_some() {
        found.push("extension".to_string());
    }
    if let Some(commands) = root.get_mut("commands").and_then(|c| c.as_array_mut()) {
        for cmd in commands {
            let Some(cmd) = cmd.as_object_mut() else {
                continue;
            };
            if cmd.remove("actions").is_some() {
                let id = cmd.get("id").and_then(|i| i.as_str()).unwrap_or("?");
                found.push(format!("command '{id}'"));
            }
        }
    }
    found
}

/// The warning logged for an extension that still declares `actions`.
pub fn removed_actions_notice(extension_id: &str, locations: &[String]) -> String {
    format!(
        "Extension '{extension_id}' declares manifest `actions` ({}). Manifest actions are no longer \
         supported and are ignored; register actions inside your view instead. The field is \
         rejected from launcher {REMOVED_ACTIONS_VERSION}.",
        locations.join(", ")
    )
}

/// Parse manifest JSON, tolerating the removed `actions` field. Returns the
/// manifest and where `actions` was declared (empty when it was not).
pub fn parse_manifest_str(content: &str) -> Result<(ExtensionManifest, Vec<String>), AppError> {
    let mut value: serde_json::Value = serde_json::from_str(content).map_err(AppError::Json)?;
    let removed = strip_removed_actions(&mut value);
    let manifest: ExtensionManifest = serde_json::from_value(value).map_err(AppError::Json)?;
    Ok((manifest, removed))
}

/// Read and parse a single manifest.json file
pub fn read_manifest(path: &Path) -> Result<ExtensionManifest, AppError> {
    let content = std::fs::read_to_string(path).map_err(AppError::Io)?;
    let (manifest, removed) = parse_manifest_str(&content)?;
    if !removed.is_empty() {
        warn!("{}", removed_actions_notice(&manifest.id, &removed));
    }
    validate_manifest(&manifest)?;
    crate::extensions::validate_permission_args(&manifest)?;
    Ok(manifest)
}

/// Whether a declared `platforms` list permits the current OS. `None` means
/// the extension declared no restriction (compatible everywhere); an empty
/// list declares support for zero platforms (compatible nowhere).
pub fn is_platform_compatible(platforms: Option<&[String]>) -> bool {
    match platforms {
        None => true,
        Some(platforms) => {
            let current_os = std::env::consts::OS;
            platforms.iter().any(|p| p.as_str() == current_os)
        }
    }
}

/// A `{id, platforms}` pair for batch-checking platform compatibility of
/// items that don't carry a full `ExtensionManifest` (e.g. store API listings).
#[derive(Clone, Debug, serde::Deserialize, specta::Type)]
pub struct PlatformCheckItem {
    pub id: String,
    #[serde(default)]
    pub platforms: Option<Vec<String>>,
}

/// Ids of items whose declared platforms permit the current OS, in input order.
pub fn filter_platform_compatible_ids(items: &[PlatformCheckItem]) -> Vec<String> {
    items
        .iter()
        .filter(|it| is_platform_compatible(it.platforms.as_deref()))
        .map(|it| it.id.clone())
        .collect()
}

/// Check if an extension's declared requirements are compatible with this app.
pub fn validate_compatibility(manifest: &ExtensionManifest) -> CompatibilityStatus {
    // Platform check — most fundamental gate, evaluated first
    if let Some(ref platforms) = manifest.platforms {
        if !is_platform_compatible(Some(platforms)) {
            return CompatibilityStatus::PlatformNotSupported {
                platform: std::env::consts::OS.to_string(),
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
                        warn!(
                            "Failed to parse SUPPORTED_SDK_VERSION: {}",
                            SUPPORTED_SDK_VERSION
                        );
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
    use crate::extensions::{ExtensionCommand, ExtensionManifest};

    fn manifest_with_commands(commands: Vec<ExtensionCommand>) -> ExtensionManifest {
        ExtensionManifest {
            id: "test".into(),
            name: "Test".into(),
            version: "1.0.0".into(),
            description: String::new(),
            author: None,
            extension_type: Some("extension".into()),
            lifecycle: None,
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
            onboarding: None,
            tools: None,
            runtimes: None,
            walkthrough: None,
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
            searchable: None,
            preferences: None,
            arguments: None,
            require_any_of: None,
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
            searchable: None,
            preferences: None,
            arguments: None,
            require_any_of: None,
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
        let m = manifest_with_commands(vec![bg_cmd("tick"), view_cmd("open", "MainView")]);
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
            searchable: None,
            preferences: None,
            arguments: None,
            require_any_of: None,
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
            searchable: None,
            preferences: None,
            arguments: None,
            require_any_of: None,
            search_bar_accessory: None,
        }]);
        assert_eq!(m.first_view_component(), Some("DefaultView"));
    }
}

#[cfg(test)]
mod onboarding_validation_tests {
    use super::*;
    use crate::extensions::{ExtensionCommand, ExtensionManifest};

    fn manifest_with_commands(commands: Vec<ExtensionCommand>) -> ExtensionManifest {
        ExtensionManifest {
            id: "test".into(),
            name: "Test".into(),
            version: "1.0.0".into(),
            description: String::new(),
            author: None,
            extension_type: Some("extension".into()),
            lifecycle: None,
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
            onboarding: None,
            tools: None,
            runtimes: None,
            walkthrough: None,
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
            searchable: None,
            preferences: None,
            arguments: None,
            require_any_of: None,
            search_bar_accessory: None,
        }
    }

    #[test]
    fn validate_manifest_accepts_onboarding_pointing_at_view_command() {
        let mut m = manifest_with_commands(vec![view_cmd("setup", "dist/setup.html")]);
        m.onboarding = Some(crate::extensions::OnboardingDecl {
            command: "setup".to_string(),
        });
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn validate_manifest_rejects_onboarding_command_missing() {
        let mut m = manifest_with_commands(vec![view_cmd("brew", "dist/brew.html")]);
        m.onboarding = Some(crate::extensions::OnboardingDecl {
            command: "nope".to_string(),
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_rejects_onboarding_pointing_at_background_command() {
        let bg = ExtensionCommand {
            id: "setup".to_string(),
            name: "setup".to_string(),
            description: String::new(),
            trigger: None,
            mode: Some("background".to_string()),
            icon: None,
            component: None,
            schedule: None,
            searchable: None,
            preferences: None,
            arguments: None,
            require_any_of: None,
            search_bar_accessory: None,
        };
        // background command requires a background.main bundle
        let mut m = manifest_with_commands(vec![bg]);
        use crate::extensions::BackgroundSpec;
        m.background = Some(BackgroundSpec {
            main: "dist/worker.js".into(),
        });
        m.onboarding = Some(crate::extensions::OnboardingDecl {
            command: "setup".to_string(),
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_passes_when_onboarding_absent() {
        let m = manifest_with_commands(vec![view_cmd("brew", "dist/brew.html")]);
        assert!(validate_manifest(&m).is_ok());
    }

    fn walkthrough_task(id: &str) -> crate::walkthrough::WalkthroughTaskDecl {
        crate::walkthrough::WalkthroughTaskDecl {
            id: id.into(),
            title: "Learn something".into(),
            summary: String::new(),
            body: String::new(),
            icon: None,
            image: None,
            order: 0,
            completion: crate::walkthrough::CompletionRule::Launch {
                target: "cmd_org.asyar.test_*".into(),
            },
        }
    }

    #[test]
    fn validate_manifest_accepts_declared_walkthrough_tasks() {
        let mut m = manifest_with_commands(vec![view_cmd("brew", "dist/brew.html")]);
        m.walkthrough = Some(vec![walkthrough_task("first"), walkthrough_task("second")]);
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn validate_manifest_rejects_duplicate_walkthrough_task_ids() {
        let mut m = manifest_with_commands(vec![view_cmd("brew", "dist/brew.html")]);
        m.walkthrough = Some(vec![walkthrough_task("same"), walkthrough_task("same")]);
        let err = validate_manifest(&m).unwrap_err();
        assert!(
            format!("{err}").contains("duplicate"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn validate_manifest_rejects_a_malformed_walkthrough_task() {
        let mut m = manifest_with_commands(vec![view_cmd("brew", "dist/brew.html")]);
        let mut bad = walkthrough_task("ok");
        bad.title = String::new();
        m.walkthrough = Some(vec![bad]);
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn validate_manifest_passes_when_walkthrough_absent() {
        let m = manifest_with_commands(vec![view_cmd("brew", "dist/brew.html")]);
        assert!(m.walkthrough.is_none());
        assert!(validate_manifest(&m).is_ok());
    }
}

#[cfg(test)]
mod compatibility_tests {
    use super::*;
    use crate::extensions::{CompatibilityStatus, ExtensionManifest};

    fn test_manifest(asyar_sdk: Option<&str>, min_app_version: Option<&str>) -> ExtensionManifest {
        ExtensionManifest {
            id: "test.extension".to_string(),
            name: "Test".to_string(),
            version: "1.0.0".to_string(),
            description: "Test extension".to_string(),
            author: None,
            extension_type: None,
            lifecycle: None,
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
            onboarding: None,
            tools: None,
            runtimes: None,
            walkthrough: None,
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
        assert_eq!(
            validate_compatibility(&manifest),
            CompatibilityStatus::Unknown
        );
    }

    #[test]
    fn test_compatible_sdk_range() {
        let range = compatible_caret_range();
        let manifest = test_manifest(Some(&range), None);
        assert_eq!(
            validate_compatibility(&manifest),
            CompatibilityStatus::Compatible
        );
    }

    #[test]
    fn test_compatible_exact_sdk() {
        // Exact match against the SDK actually compiled in. Always Compatible.
        let manifest = test_manifest(Some(SUPPORTED_SDK_VERSION), None);
        assert_eq!(
            validate_compatibility(&manifest),
            CompatibilityStatus::Compatible
        );
    }

    #[test]
    fn test_incompatible_sdk_major() {
        let range = incompatible_major_range();
        let manifest = test_manifest(Some(&range), None);
        match validate_compatibility(&manifest) {
            CompatibilityStatus::SdkMismatch {
                required,
                supported,
            } => {
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
            CompatibilityStatus::SdkMismatch {
                required,
                supported: _,
            } => {
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
        assert_eq!(
            validate_compatibility(&manifest),
            CompatibilityStatus::Unknown
        );
    }

    #[test]
    fn test_app_version_too_old() {
        let manifest = test_manifest(None, Some("99.0.0"));
        match validate_compatibility(&manifest) {
            CompatibilityStatus::AppVersionTooOld {
                required,
                current: _,
            } => {
                assert_eq!(required, "99.0.0");
            }
            other => panic!("Expected AppVersionTooOld, got {:?}", other),
        }
    }

    #[test]
    fn test_both_fields_compatible() {
        let range = compatible_caret_range();
        let manifest = test_manifest(Some(&range), Some("0.0.1"));
        assert_eq!(
            validate_compatibility(&manifest),
            CompatibilityStatus::Compatible
        );
    }

    #[test]
    fn test_invalid_sdk_range_returns_unknown() {
        let manifest = test_manifest(Some("not-semver"), None);
        assert_eq!(
            validate_compatibility(&manifest),
            CompatibilityStatus::Unknown
        );
    }

    #[test]
    fn test_platforms_absent_allows_any_os() {
        let manifest = make_manifest_with_platforms(None);
        let result = validate_compatibility(&manifest);
        assert!(!matches!(
            result,
            CompatibilityStatus::PlatformNotSupported { .. }
        ));
    }

    #[test]
    fn test_current_os_in_platforms_list_is_allowed() {
        let os = std::env::consts::OS;
        let manifest = make_manifest_with_platforms(Some(vec![os.to_string()]));
        assert!(!matches!(
            validate_compatibility(&manifest),
            CompatibilityStatus::PlatformNotSupported { .. }
        ));
    }

    #[test]
    fn test_os_not_in_platforms_list_returns_not_supported() {
        let others: Vec<String> = ["macos", "windows", "linux"]
            .iter()
            .filter(|&&p| p != std::env::consts::OS)
            .map(|s| s.to_string())
            .collect();
        if others.is_empty() {
            return;
        }
        let manifest = make_manifest_with_platforms(Some(others.clone()));
        match validate_compatibility(&manifest) {
            CompatibilityStatus::PlatformNotSupported {
                platform,
                supported,
            } => {
                assert_eq!(platform, std::env::consts::OS);
                assert_eq!(supported, others);
            }
            other => panic!("Expected PlatformNotSupported, got {:?}", other),
        }
    }

    #[test]
    fn test_empty_platforms_list_returns_not_supported() {
        let manifest = make_manifest_with_platforms(Some(vec![]));
        assert!(matches!(
            validate_compatibility(&manifest),
            CompatibilityStatus::PlatformNotSupported { .. }
        ));
    }

    #[test]
    fn test_is_platform_compatible_none_allows_any_os() {
        assert!(is_platform_compatible(None));
    }

    #[test]
    fn test_is_platform_compatible_current_os_in_list() {
        let os = std::env::consts::OS;
        assert!(is_platform_compatible(Some(&[os.to_string()])));
    }

    #[test]
    fn test_is_platform_compatible_other_os_only() {
        let others: Vec<String> = ["macos", "windows", "linux"]
            .iter()
            .filter(|&&p| p != std::env::consts::OS)
            .map(|s| s.to_string())
            .collect();
        if others.is_empty() {
            return;
        }
        assert!(!is_platform_compatible(Some(&others)));
    }

    #[test]
    fn test_is_platform_compatible_empty_list_is_incompatible() {
        assert!(!is_platform_compatible(Some(&[])));
    }

    #[test]
    fn test_filter_platform_compatible_ids_keeps_compatible_drops_rest() {
        let os = std::env::consts::OS;
        let items = vec![
            PlatformCheckItem {
                id: "keep-no-restriction".to_string(),
                platforms: None,
            },
            PlatformCheckItem {
                id: "keep-current-os".to_string(),
                platforms: Some(vec![os.to_string()]),
            },
            PlatformCheckItem {
                id: "drop-empty-list".to_string(),
                platforms: Some(vec![]),
            },
            PlatformCheckItem {
                id: "drop-other-os".to_string(),
                platforms: Some(vec!["nonexistent-os".to_string()]),
            },
        ];
        let kept = filter_platform_compatible_ids(&items);
        assert_eq!(kept, vec!["keep-no-restriction", "keep-current-os"]);
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
            schedule: Some(ScheduleDeclaration {
                interval_seconds: 5,
            }),
            searchable: None,
            preferences: None,
            arguments: None,
            require_any_of: None,
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
            schedule: Some(ScheduleDeclaration {
                interval_seconds: 300,
            }),
            searchable: None,
            preferences: None,
            arguments: None,
            require_any_of: None,
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
            DropdownOption {
                value: "a".into(),
                title: "A".into(),
            },
            DropdownOption {
                value: "b".into(),
                title: "B".into(),
            },
        ]);
        p.default = Some(serde_json::json!("a"));
        assert!(validate_preferences(&[p]).is_ok());
    }

    #[test]
    fn rejects_dropdown_default_not_in_data() {
        let mut p = pref("d", PreferenceType::Dropdown);
        p.data = Some(vec![DropdownOption {
            value: "a".into(),
            title: "A".into(),
        }]);
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
        let manifest: ExtensionManifest = serde_json::from_str(json).map_err(AppError::Json)?;
        validate_manifest(&manifest)?;
        Ok(manifest)
    }

    // ── Removed manifest `actions` (compatibility until 0.2.0) ──────────

    const MANIFEST_WITH_REMOVED_ACTIONS: &str = r#"{
        "id": "org.test.legacy-actions", "name": "Legacy", "version": "1.0.0",
        "type": "extension",
        "actions": [{ "id": "a", "title": "A", "shortcut": "\u2318N" }],
        "commands": [{
            "id": "c", "name": "C", "mode": "view", "component": "V",
            "actions": [{ "id": "b", "title": "B" }]
        }]
    }"#;

    #[test]
    fn manifest_with_removed_actions_still_loads() {
        let (manifest, removed) = parse_manifest_str(MANIFEST_WITH_REMOVED_ACTIONS)
            .expect("published extensions that declare `actions` must keep loading");
        assert_eq!(manifest.id, "org.test.legacy-actions");
        assert_eq!(manifest.commands.len(), 1);
        assert_eq!(
            removed,
            vec!["extension".to_string(), "command 'c'".to_string()]
        );
    }

    #[test]
    fn manifest_without_actions_reports_nothing_removed() {
        let json = r#"{
            "id": "org.test.clean", "name": "Clean", "version": "1.0.0", "type": "extension",
            "commands": [{ "id": "c", "name": "C", "mode": "view", "component": "V" }]
        }"#;
        let (_, removed) = parse_manifest_str(json).unwrap();
        assert!(removed.is_empty());
    }

    #[test]
    fn removed_actions_do_not_loosen_the_rest_of_the_schema() {
        let json = r#"{
            "id": "org.test.typo", "name": "Typo", "version": "1.0.0", "type": "extension",
            "actions": [], "notAField": 1,
            "commands": [{ "id": "c", "name": "C", "mode": "view", "component": "V" }]
        }"#;
        assert!(parse_manifest_str(json).is_err());
    }

    #[test]
    fn removed_actions_notice_names_the_extension_and_the_removal_version() {
        let notice = removed_actions_notice("org.test.legacy-actions", &["extension".into()]);
        assert!(notice.contains("org.test.legacy-actions"), "{notice}");
        assert!(notice.contains("0.2.0"), "{notice}");
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
        parse(json)
            .expect("background.main without background commands should be legal (warning only)");
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
        let err =
            parse(json).expect_err("legacy command.resultType must be rejected at parse time");
        let msg = format!("{err}");
        assert!(
            msg.contains("resultType") || msg.contains("unknown field"),
            "got: {msg}"
        );
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
        assert!(
            msg.contains("defaultView") || msg.contains("unknown field"),
            "got: {msg}"
        );
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
        assert!(
            msg.contains("main") || msg.contains("unknown field"),
            "got: {msg}"
        );
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
        assert!(
            msg.contains("view") || msg.contains("unknown field"),
            "got: {msg}"
        );
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
        let err =
            parse(json).expect_err("mode=view with whitespace-only component must fail validation");
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
        let err =
            parse(json).expect_err("mode=background without background.main must fail validation");
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
        let err = parse(json).expect_err(
            "mode=background with whitespace-only background.main must fail validation",
        );
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
        assert!(
            format!("{err}").contains("contributes nothing"),
            "got: {err}"
        );
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
            .join("..") // asyar-launcher/
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
            // Match production loading: statically compiled built-ins are
            // host primitives, not installed worker/view extensions.
            let result = if path.starts_with(repo_root.join("asyar-launcher/src/built-in-features"))
            {
                serde_json::from_str::<ExtensionManifest>(&std::fs::read_to_string(path).unwrap())
                    .map_err(|error| error.to_string())
            } else {
                read_manifest(path).map_err(|error| error.to_string())
            };
            assert!(
                result.is_ok(),
                "manifest at {:?} failed parse/validate: {:?}",
                path,
                result.err()
            );
            let manifest = result.unwrap();
            for cmd in manifest.commands {
                assert_ne!(
                    cmd.component.as_deref(),
                    Some("__TBD__"),
                    "manifest at {:?} has placeholder component '__TBD__'",
                    path
                );
            }
        }
    }

    #[test]
    fn bundled_feature_disableability_policy_is_explicit() {
        let builtin_root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/built-in-features");
        if !builtin_root.exists() {
            return;
        }

        let required = ["settings", "system"];
        for entry in std::fs::read_dir(&builtin_root).unwrap().flatten() {
            let path = entry.path().join("manifest.json");
            if !path.exists() {
                continue;
            }
            let manifest: ExtensionManifest =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap())
                    .unwrap_or_else(|error| panic!("manifest at {path:?} failed parsing: {error}"));
            assert!(
                manifest.background.is_none(),
                "built-in {} must not declare a worker bundle",
                manifest.id
            );
            let disableable = manifest
                .lifecycle
                .as_ref()
                .and_then(|lifecycle| lifecycle.disableable);

            if required.contains(&manifest.id.as_str()) {
                assert_eq!(
                    disableable,
                    Some(false),
                    "required built-in '{}' must explicitly declare lifecycle.disableable=false",
                    manifest.id
                );
            } else {
                assert_eq!(
                    disableable,
                    Some(true),
                    "optional built-in '{}' must explicitly declare lifecycle.disableable=true",
                    manifest.id
                );
            }
        }
    }

    #[test]
    fn test_get_builtin_records_statically_compiled() {
        let records = get_builtin_records();
        assert_eq!(records.len(), 24, "expected 24 built-in feature records");
        for record in &records {
            assert!(
                record.is_built_in,
                "record {} should be built-in",
                record.manifest.id
            );
            if record.manifest.id == "system" || record.manifest.id == "settings" {
                assert!(
                    !record.disableable,
                    "built-in {} must not be disableable",
                    record.manifest.id
                );
            } else {
                assert!(
                    record.disableable,
                    "built-in {} must be disableable",
                    record.manifest.id
                );
            }
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
    fn validate_manifest_accepts_a_known_declared_runtime() {
        let json = r#"{
            "id": "org.test.runtime-ok",
            "name": "Runtime OK",
            "version": "1.0.0",
            "searchable": true,
            "type": "extension",
            "runtimes": ["bun"]
        }"#;
        parse(json).expect("a known runtime name must validate");
    }

    #[test]
    fn validate_manifest_rejects_an_unknown_declared_runtime() {
        let json = r#"{
            "id": "org.test.runtime-bad",
            "name": "Runtime Bad",
            "version": "1.0.0",
            "searchable": true,
            "type": "extension",
            "runtimes": ["ffmpeg"]
        }"#;
        let err = parse(json).expect_err("an unknown runtime name must fail validation");
        assert!(format!("{err}").contains("ffmpeg"), "got: {err}");
    }

    #[test]
    fn validate_manifest_passes_when_runtimes_absent() {
        let json = r#"{
            "id": "org.test.runtime-absent",
            "name": "Runtime Absent",
            "version": "1.0.0",
            "searchable": true,
            "type": "extension"
        }"#;
        parse(json).expect("absent runtimes field must be legal");
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
            lifecycle: None,
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
                searchable: None,
                preferences: None,
                arguments: None,
                require_any_of: None,
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
            onboarding: None,
            tools: None,
            runtimes: None,
            walkthrough: None,
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

    #[test]
    fn validate_manifest_accepts_valid_lifecycle() {
        let json = r#"{
            "id": "org.test.lifecycle",
            "name": "Lifecycle Test",
            "version": "1.0.0",
            "description": "Tests lifecycle policy declaration",
            "author": "tester",
            "type": "extension",
            "lifecycle": {
                "disableable": true,
                "background": true
            },
            "commands": [{
                "id": "run",
                "name": "Run",
                "mode": "view",
                "component": "MainView"
            }]
        }"#;

        let manifest: ExtensionManifest =
            serde_json::from_str(json).expect("valid lifecycle manifest should parse");
        assert_eq!(
            manifest.lifecycle.as_ref().and_then(|l| l.disableable),
            Some(true)
        );
        assert_eq!(
            manifest.lifecycle.as_ref().and_then(|l| l.background),
            Some(true)
        );
        validate_manifest(&manifest).expect("manifest with valid lifecycle should pass validation");
    }

    #[test]
    fn validate_manifest_rejects_unknown_fields_in_lifecycle() {
        let json = r#"{
            "id": "org.test.lifecycle.bad",
            "name": "Lifecycle Bad",
            "version": "1.0.0",
            "description": "Tests unknown field rejection in lifecycle",
            "author": "tester",
            "type": "extension",
            "lifecycle": {
                "disableable": true,
                "nonExistentField": 123
            },
            "commands": [{
                "id": "run",
                "name": "Run",
                "mode": "view",
                "component": "MainView"
            }]
        }"#;

        let result: Result<ExtensionManifest, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "unknown field in lifecycle must fail deserialization (deny_unknown_fields)"
        );
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
    fn scan_extensions_dir_sets_disableable_flag_appropriately() {
        let tmp = unique_temp_dir("asyar-test-lifecycle-discovery");

        // 1. Built-in with lifecycle.disableable: true -> disableable: true
        let ext1_dir = tmp.join("opted-in-builtin");
        std::fs::create_dir_all(&ext1_dir).unwrap();
        std::fs::write(
            ext1_dir.join("manifest.json"),
            r#"{
                "id": "opted-in-builtin",
                "name": "Opted In",
                "version": "1.0.0",
                "description": "Optional built-in feature",
                "lifecycle": { "disableable": true },
                "commands": [{ "id": "cmd", "name": "Cmd", "mode": "view", "component": "View" }]
            }"#,
        )
        .unwrap();

        // 2. Built-in without lifecycle -> disableable: false (required core)
        let ext2_dir = tmp.join("required-builtin");
        std::fs::create_dir_all(&ext2_dir).unwrap();
        std::fs::write(
            ext2_dir.join("manifest.json"),
            r#"{
                "id": "required-builtin",
                "name": "Required Builtin",
                "version": "1.0.0",
                "description": "Required built-in feature",
                "commands": [{ "id": "cmd", "name": "Cmd", "mode": "view", "component": "View" }]
            }"#,
        )
        .unwrap();

        // 3. Built-in with lifecycle.disableable: false -> disableable: false
        let ext3_dir = tmp.join("explicit-required-builtin");
        std::fs::create_dir_all(&ext3_dir).unwrap();
        std::fs::write(
            ext3_dir.join("manifest.json"),
            r#"{
                "id": "explicit-required-builtin",
                "name": "Explicit Required",
                "version": "1.0.0",
                "description": "Explicitly required built-in",
                "lifecycle": { "disableable": false },
                "commands": [{ "id": "cmd", "name": "Cmd", "mode": "view", "component": "View" }]
            }"#,
        )
        .unwrap();

        let builtin_records = scan_extensions_dir(&tmp, true);

        let opt_in = builtin_records
            .iter()
            .find(|r| r.manifest.id == "opted-in-builtin")
            .unwrap();
        assert!(
            opt_in.disableable,
            "opted-in built-in must be disableable: true"
        );

        let req = builtin_records
            .iter()
            .find(|r| r.manifest.id == "required-builtin")
            .unwrap();
        assert!(
            !req.disableable,
            "default built-in must be disableable: false"
        );

        let exp_req = builtin_records
            .iter()
            .find(|r| r.manifest.id == "explicit-required-builtin")
            .unwrap();
        assert!(
            !exp_req.disableable,
            "explicit false built-in must be disableable: false"
        );

        // 4. Installed extension (is_built_in: false) -> always disableable: true
        let installed_records = scan_extensions_dir(&tmp, false);
        for rec in installed_records {
            assert!(
                rec.disableable,
                "installed extension must always be disableable: true"
            );
        }

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
