//! Extension permission consent: user-approved permission sets persisted in
//! settings.dat, checked before an extension's permissions are registered in
//! the runtime permission registry.
//!
//! Consent is host-owned trust state (like shell binary trust), keyed by
//! extension id under `settings.extensions.consent.<id>`. The frontend prompts
//! at install/enable/update time; `register_extension_permissions` enforces at
//! load time as the backstop — permissions never enter the registry without a
//! covering consent record, so every gated call fails closed until the user
//! accepts.

use crate::error::AppError;
use crate::extensions::{ExtensionRecord, ExtensionRegistryState};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Flag under `settings.extensions` marking that the one-shot grandfather
/// migration has run. Its presence distinguishes "installed before the consent
/// surface shipped" (recorded by the migration) from "fresh install that never
/// got consent" (flag set, no record → prompted).
const GRANDFATHER_FLAG: &str = "consentGrandfathered";

/// A user-approved permission set for one extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRecord {
    pub permissions: Vec<String>,
    #[serde(default)]
    pub permission_args: serde_json::Map<String, serde_json::Value>,
    /// Epoch milliseconds.
    pub consented_at: u64,
    /// Recorded by the migration for extensions already installed and enabled
    /// when the consent surface shipped, rather than by an explicit prompt.
    #[serde(default)]
    pub grandfathered: bool,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Subset semantics: consent covers the declared set when every declared
/// permission was consented, and every declared arg value is contained in the
/// consented one. Removing a permission or an arg entry never re-prompts;
/// adding one does. Array args compare element-wise containment; any other
/// JSON shape requires exact equality. Arg keys without a matching declared
/// permission are a manifest-validation concern, not a consent one.
pub fn consent_covers(
    consented: &ConsentRecord,
    declared_permissions: &[String],
    declared_args: &serde_json::Map<String, serde_json::Value>,
) -> bool {
    for perm in declared_permissions {
        if !consented.permissions.iter().any(|p| p == perm) {
            return false;
        }
    }
    for (perm, declared) in declared_args {
        if !declared_permissions.iter().any(|p| p == perm) {
            continue;
        }
        let Some(consented_value) = consented.permission_args.get(perm) else {
            return false;
        };
        match (declared.as_array(), consented_value.as_array()) {
            (Some(d), Some(c)) => {
                if d.iter().any(|item| !c.contains(item)) {
                    return false;
                }
            }
            _ => {
                if declared != consented_value {
                    return false;
                }
            }
        }
    }
    true
}

#[derive(Debug, PartialEq)]
pub enum RegistrationDecision {
    Register,
    WithholdNeedsConsent,
}

/// Whether an extension's declared permissions may enter the runtime registry.
/// Built-ins bypass consent entirely; an empty declared set registers as-is
/// (there is nothing to consent to, and keeping the extension registered keeps
/// `check_extension_permission`'s "did not declare" error accurate).
pub fn registration_decision(
    is_built_in: bool,
    declared_permissions: &[String],
    declared_args: &serde_json::Map<String, serde_json::Value>,
    consent: Option<&ConsentRecord>,
) -> RegistrationDecision {
    if is_built_in || declared_permissions.is_empty() {
        return RegistrationDecision::Register;
    }
    match consent {
        Some(record) if consent_covers(record, declared_permissions, declared_args) => {
            RegistrationDecision::Register
        }
        _ => RegistrationDecision::WithholdNeedsConsent,
    }
}

/// Read the persisted consent record. A record that fails to deserialize is
/// treated as absent (fail closed → re-prompt) rather than an error.
pub fn get_consent(
    app_handle: &AppHandle,
    extension_id: &str,
) -> Result<Option<ConsentRecord>, AppError> {
    let store = app_handle
        .store("settings.dat")
        .map_err(|e| AppError::Other(format!("Failed to open settings store: {}", e)))?;
    let Some(settings) = store.get("settings") else {
        return Ok(None);
    };
    let value = settings
        .get("extensions")
        .and_then(|e| e.get("consent"))
        .and_then(|c| c.get(extension_id))
        .cloned();
    match value {
        Some(v) => match serde_json::from_value::<ConsentRecord>(v) {
            Ok(record) => Ok(Some(record)),
            Err(e) => {
                warn!(
                    "Corrupt consent record for '{}' ({}); treating as unconsented",
                    extension_id, e
                );
                Ok(None)
            }
        },
        None => Ok(None),
    }
}

/// Persist a consent record under `settings.extensions.consent.<id>`.
pub fn set_consent(
    app_handle: &AppHandle,
    extension_id: &str,
    record: &ConsentRecord,
) -> Result<(), AppError> {
    let store = app_handle
        .store("settings.dat")
        .map_err(|e| AppError::Other(format!("Failed to open settings store: {}", e)))?;

    let mut settings = store.get("settings").unwrap_or(serde_json::json!({}));
    if settings.get("extensions").is_none() {
        settings["extensions"] = serde_json::json!({});
    }
    let extensions = settings.get_mut("extensions").unwrap();
    if extensions.get("consent").is_none() {
        extensions["consent"] = serde_json::json!({});
    }
    extensions["consent"][extension_id] = serde_json::to_value(record)
        .map_err(|e| AppError::Other(format!("Failed to serialize consent record: {}", e)))?;

    store.set("settings", settings);
    store
        .save()
        .map_err(|e| AppError::Other(format!("Failed to save settings: {}", e)))
}

/// The records the one-shot migration grandfathers: non-built-in, currently
/// enabled, with a non-empty declared permission set.
pub fn records_to_grandfather(records: &[ExtensionRecord]) -> Vec<&ExtensionRecord> {
    records
        .iter()
        .filter(|r| {
            !r.is_built_in
                && r.enabled
                && r.manifest
                    .permissions
                    .as_ref()
                    .map(|p| !p.is_empty())
                    .unwrap_or(false)
        })
        .collect()
}

/// One-shot migration: on the first launch after the consent surface ships,
/// record the current manifest permission set as consented for every
/// already-enabled extension, then set the flag. Runs after enabled state has
/// been applied to the records (see `lifecycle::discover_all`).
///
/// This mirrors how browsers introduced permission prompts to extension
/// ecosystems that predated them: extensions the user already chose to
/// install keep the access they visibly have today, and the prompt fires
/// only for new installs and for permission growth on update. The
/// alternative — prompting for every installed extension on first launch
/// after upgrade — front-loads a wall of dialogs for grants the user cannot
/// meaningfully re-evaluate in bulk, training them to click through exactly
/// the surface this feature adds.
pub fn run_grandfather_migration(
    app_handle: &AppHandle,
    records: &[ExtensionRecord],
) -> Result<(), AppError> {
    let store = app_handle
        .store("settings.dat")
        .map_err(|e| AppError::Other(format!("Failed to open settings store: {}", e)))?;

    let mut settings = store.get("settings").unwrap_or(serde_json::json!({}));
    let already_ran = settings
        .get("extensions")
        .and_then(|e| e.get(GRANDFATHER_FLAG))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if already_ran {
        return Ok(());
    }

    if settings.get("extensions").is_none() {
        settings["extensions"] = serde_json::json!({});
    }
    let extensions = settings.get_mut("extensions").unwrap();
    if extensions.get("consent").is_none() {
        extensions["consent"] = serde_json::json!({});
    }

    let now = now_ms();
    let mut grandfathered = 0usize;
    for record in records_to_grandfather(records) {
        let id = record.manifest.id.as_str();
        if extensions["consent"].get(id).is_some() {
            continue;
        }
        let consent = ConsentRecord {
            permissions: record.manifest.permissions.clone().unwrap_or_default(),
            permission_args: record.manifest.permission_args.clone().unwrap_or_default(),
            consented_at: now,
            grandfathered: true,
        };
        extensions["consent"][id] = serde_json::to_value(&consent)
            .map_err(|e| AppError::Other(format!("Failed to serialize consent record: {}", e)))?;
        grandfathered += 1;
    }
    extensions[GRANDFATHER_FLAG] = serde_json::json!(true);

    store.set("settings", settings);
    store
        .save()
        .map_err(|e| AppError::Other(format!("Failed to save settings: {}", e)))?;

    if grandfathered > 0 {
        info!(
            "Grandfathered permission consent for {} pre-existing extension(s)",
            grandfathered
        );
    }
    Ok(())
}

/// Consent status for one extension, returned to the frontend.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionConsentStatus {
    pub needs_consent: bool,
    pub declared_permissions: Vec<String>,
    pub declared_args: serde_json::Map<String, serde_json::Value>,
    pub consented: Option<ConsentRecord>,
}

/// Resolve the declared set from the discovered manifest and report whether a
/// covering consent record exists. Built-in or permissionless extensions never
/// need consent.
#[tauri::command]
pub fn check_extension_consent(
    app_handle: AppHandle,
    extension_id: String,
    extensions: tauri::State<'_, ExtensionRegistryState>,
) -> Result<ExtensionConsentStatus, AppError> {
    let (is_built_in, declared_permissions, declared_args) = {
        let reg = extensions.extensions.lock().map_err(|_| AppError::Lock)?;
        let record = reg
            .get(&extension_id)
            .ok_or_else(|| AppError::NotFound(format!("Extension not found: {}", extension_id)))?;
        (
            record.is_built_in,
            record.manifest.permissions.clone().unwrap_or_default(),
            record.manifest.permission_args.clone().unwrap_or_default(),
        )
    };
    let consented = get_consent(&app_handle, &extension_id)?;
    let needs_consent = registration_decision(
        is_built_in,
        &declared_permissions,
        &declared_args,
        consented.as_ref(),
    ) == RegistrationDecision::WithholdNeedsConsent;
    Ok(ExtensionConsentStatus {
        needs_consent,
        declared_permissions,
        declared_args,
        consented,
    })
}

/// Record the user's acceptance of a permission set. Called by the host
/// frontend after the consent dialog is accepted.
#[tauri::command]
pub fn set_extension_consent(
    app_handle: AppHandle,
    extension_id: String,
    permissions: Vec<String>,
    permission_args: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation(
            "extension_id cannot be empty".to_string(),
        ));
    }
    let record = ConsentRecord {
        permissions,
        permission_args: permission_args.unwrap_or_default(),
        consented_at: now_ms(),
        grandfathered: false,
    };
    set_consent(&app_handle, &extension_id, &record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::{CompatibilityStatus, ExtensionManifest};

    fn record_with(permissions: &[&str], args: serde_json::Value) -> ConsentRecord {
        ConsentRecord {
            permissions: permissions.iter().map(|s| s.to_string()).collect(),
            permission_args: args.as_object().cloned().unwrap_or_default(),
            consented_at: 0,
            grandfathered: false,
        }
    }

    fn args(value: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        value.as_object().cloned().unwrap_or_default()
    }

    fn perms(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn covers_identical_set() {
        let consent = record_with(
            &["fs:watch", "network"],
            serde_json::json!({"fs:watch": ["~/a/**"]}),
        );
        assert!(consent_covers(
            &consent,
            &perms(&["fs:watch", "network"]),
            &args(serde_json::json!({"fs:watch": ["~/a/**"]})),
        ));
    }

    #[test]
    fn added_permission_is_not_covered() {
        let consent = record_with(&["network"], serde_json::json!({}));
        assert!(!consent_covers(
            &consent,
            &perms(&["network", "clipboard:read"]),
            &args(serde_json::json!({})),
        ));
    }

    #[test]
    fn removed_permission_is_still_covered() {
        let consent = record_with(&["network", "clipboard:read"], serde_json::json!({}));
        assert!(consent_covers(
            &consent,
            &perms(&["network"]),
            &args(serde_json::json!({})),
        ));
    }

    #[test]
    fn added_arg_element_is_not_covered() {
        let consent = record_with(&["fs:watch"], serde_json::json!({"fs:watch": ["~/a/**"]}));
        assert!(!consent_covers(
            &consent,
            &perms(&["fs:watch"]),
            &args(serde_json::json!({"fs:watch": ["~/a/**", "~/b/**"]})),
        ));
    }

    #[test]
    fn removed_arg_element_is_still_covered() {
        let consent = record_with(
            &["fs:watch"],
            serde_json::json!({"fs:watch": ["~/a/**", "~/b/**"]}),
        );
        assert!(consent_covers(
            &consent,
            &perms(&["fs:watch"]),
            &args(serde_json::json!({"fs:watch": ["~/a/**"]})),
        ));
    }

    #[test]
    fn missing_consented_arg_is_not_covered() {
        let consent = record_with(&["fs:watch"], serde_json::json!({}));
        assert!(!consent_covers(
            &consent,
            &perms(&["fs:watch"]),
            &args(serde_json::json!({"fs:watch": ["~/a/**"]})),
        ));
    }

    #[test]
    fn non_array_arg_requires_exact_equality() {
        let consent = record_with(&["some:perm"], serde_json::json!({"some:perm": {"max": 5}}));
        assert!(consent_covers(
            &consent,
            &perms(&["some:perm"]),
            &args(serde_json::json!({"some:perm": {"max": 5}})),
        ));
        assert!(!consent_covers(
            &consent,
            &perms(&["some:perm"]),
            &args(serde_json::json!({"some:perm": {"max": 6}})),
        ));
    }

    #[test]
    fn orphan_declared_arg_without_permission_is_ignored() {
        let consent = record_with(&["network"], serde_json::json!({}));
        assert!(consent_covers(
            &consent,
            &perms(&["network"]),
            &args(serde_json::json!({"fs:watch": ["~/a/**"]})),
        ));
    }

    #[test]
    fn empty_declared_set_is_always_covered() {
        let consent = record_with(&[], serde_json::json!({}));
        assert!(consent_covers(&consent, &[], &args(serde_json::json!({}))));
    }

    #[test]
    fn decision_registers_built_in_without_consent() {
        assert_eq!(
            registration_decision(
                true,
                &perms(&["network"]),
                &args(serde_json::json!({})),
                None
            ),
            RegistrationDecision::Register
        );
    }

    #[test]
    fn decision_registers_empty_declared_set_without_consent() {
        assert_eq!(
            registration_decision(false, &[], &args(serde_json::json!({})), None),
            RegistrationDecision::Register
        );
    }

    #[test]
    fn decision_withholds_when_consent_missing() {
        assert_eq!(
            registration_decision(
                false,
                &perms(&["network"]),
                &args(serde_json::json!({})),
                None
            ),
            RegistrationDecision::WithholdNeedsConsent
        );
    }

    #[test]
    fn decision_withholds_when_consent_stale() {
        let consent = record_with(&["network"], serde_json::json!({}));
        assert_eq!(
            registration_decision(
                false,
                &perms(&["network", "shell:spawn"]),
                &args(serde_json::json!({})),
                Some(&consent)
            ),
            RegistrationDecision::WithholdNeedsConsent
        );
    }

    #[test]
    fn decision_registers_when_consent_covers() {
        let consent = record_with(&["fs:watch"], serde_json::json!({"fs:watch": ["~/a/**"]}));
        assert_eq!(
            registration_decision(
                false,
                &perms(&["fs:watch"]),
                &args(serde_json::json!({"fs:watch": ["~/a/**"]})),
                Some(&consent)
            ),
            RegistrationDecision::Register
        );
    }

    fn make_record(
        id: &str,
        is_built_in: bool,
        enabled: bool,
        permissions: Option<Vec<String>>,
    ) -> ExtensionRecord {
        ExtensionRecord {
            manifest: ExtensionManifest {
                id: id.into(),
                name: id.into(),
                version: "1.0.0".into(),
                description: String::new(),
                author: None,
                extension_type: None,
                background: None,
                searchable: None,
                icon: None,
                commands: vec![],
                permissions,
                permission_args: None,
                min_app_version: None,
                asyar_sdk: None,
                platforms: None,
                preferences: None,
                actions: None,
                onboarding: None,
                tools: None,
            },
            enabled,
            is_built_in,
            path: format!("/tmp/{id}"),
            compatibility: CompatibilityStatus::Unknown,
            first_view_component: None,
        }
    }

    #[test]
    fn grandfather_selection_skips_built_ins_disabled_and_permissionless() {
        let records = vec![
            make_record("ext.builtin", true, true, Some(vec!["network".into()])),
            make_record("ext.disabled", false, false, Some(vec!["network".into()])),
            make_record("ext.no-perms", false, true, None),
            make_record("ext.empty-perms", false, true, Some(vec![])),
            make_record("ext.keeper", false, true, Some(vec!["fs:watch".into()])),
        ];
        let selected = records_to_grandfather(&records);
        let ids: Vec<&str> = selected.iter().map(|r| r.manifest.id.as_str()).collect();
        assert_eq!(ids, vec!["ext.keeper"]);
    }

    #[test]
    fn consent_record_serializes_camel_case() {
        let record = ConsentRecord {
            permissions: vec!["fs:watch".into()],
            permission_args: args(serde_json::json!({"fs:watch": ["~/a/**"]})),
            consented_at: 42,
            grandfathered: true,
        };
        let value = serde_json::to_value(&record).unwrap();
        assert!(value.get("permissionArgs").is_some());
        assert!(value.get("consentedAt").is_some());
        assert!(value.get("grandfathered").is_some());
    }
}
