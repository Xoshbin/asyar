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
use crate::permissions::ExtensionPermissionRegistry;
use crate::storage::{shell as shell_storage, DataStore};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

/// Flag under `settings.extensions` marking that the one-shot grandfather
/// migration has run. Its presence distinguishes "installed before the consent
/// surface shipped" (recorded by the migration) from "fresh install that never
/// got consent" (flag set, no record → prompted).
const GRANDFATHER_FLAG: &str = "consentGrandfathered";

/// Event payload broadcast to all webview windows after a consent write.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsentChangedPayload {
    extension_id: String,
}

/// Fire `asyar:consent-changed` so all webview windows (main launcher,
/// settings window, any future windows) can re-derive their local
/// needs-review state — mirrors `asyar:preferences-changed`. Without this,
/// a grant/revoke recorded from one webview (e.g. Store install in the main
/// window) leaves another webview's "needs review" badge stale.
fn emit_consent_changed<R: tauri::Runtime>(app_handle: &AppHandle<R>, extension_id: &str) {
    let payload = ConsentChangedPayload {
        extension_id: extension_id.to_string(),
    };
    if let Err(e) = app_handle.emit("asyar:consent-changed", payload) {
        warn!(
            "Failed to emit asyar:consent-changed for {}: {}",
            extension_id, e
        );
    }
}

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

/// Programs declared under `permissionArgs["shell:spawn"]`. Only meaningful
/// when `shell:spawn` itself is in the permission set — mirrors
/// `consent_covers`, which ignores arg keys without a matching permission.
/// Non-string entries are skipped; they just don't get a trust seed.
pub fn declared_shell_programs(
    permissions: &[String],
    permission_args: &serde_json::Map<String, serde_json::Value>,
) -> Vec<String> {
    if !permissions.iter().any(|p| p == "shell:spawn") {
        return Vec::new();
    }
    permission_args
        .get("shell:spawn")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
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

/// Get (creating if absent) the object at `parent[key]`. Errors — rather than
/// panicking or silently replacing — when an existing value is not a JSON
/// object: a corrupt settings.dat should fail the consent write, not be
/// clobbered by it. Consent stays unrecorded and the registration backstop
/// keeps the permissions withheld, so failing here fails closed.
fn child_object_mut<'a>(
    parent: &'a mut serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<&'a mut serde_json::Map<String, serde_json::Value>, AppError> {
    parent
        .entry(key)
        .or_insert_with(|| serde_json::Value::Object(Default::default()))
        .as_object_mut()
        .ok_or_else(|| {
            AppError::Other(format!(
                "settings.dat is corrupt: '{}' is not a JSON object",
                key
            ))
        })
}

fn settings_root_mut(
    settings: &mut serde_json::Value,
) -> Result<&mut serde_json::Map<String, serde_json::Value>, AppError> {
    settings.as_object_mut().ok_or_else(|| {
        AppError::Other("settings.dat is corrupt: 'settings' is not a JSON object".into())
    })
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
    {
        let root = settings_root_mut(&mut settings)?;
        let extensions = child_object_mut(root, "extensions")?;
        let consent = child_object_mut(extensions, "consent")?;
        consent.insert(
            extension_id.to_string(),
            serde_json::to_value(record).map_err(|e| {
                AppError::Other(format!("Failed to serialize consent record: {}", e))
            })?,
        );
    }

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

    let now = now_ms();
    let mut grandfathered = 0usize;
    {
        let root = settings_root_mut(&mut settings)?;
        let extensions = child_object_mut(root, "extensions")?;
        let consent = child_object_mut(extensions, "consent")?;
        for record in records_to_grandfather(records) {
            let id = record.manifest.id.as_str();
            if consent.contains_key(id) {
                continue;
            }
            let consent_record = ConsentRecord {
                permissions: record.manifest.permissions.clone().unwrap_or_default(),
                permission_args: record.manifest.permission_args.clone().unwrap_or_default(),
                consented_at: now,
                grandfathered: true,
            };
            consent.insert(
                id.to_string(),
                serde_json::to_value(&consent_record).map_err(|e| {
                    AppError::Other(format!("Failed to serialize consent record: {}", e))
                })?,
            );
            grandfathered += 1;
        }
        extensions.insert(GRANDFATHER_FLAG.to_string(), serde_json::json!(true));
    }

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
    /// The extension's declared `runtimes` manifest field, so the frontend
    /// can look up download sizes (`get_runtime_download_sizes`) without a
    /// second round trip through the manifest itself.
    pub declared_runtimes: Vec<String>,
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
    let (is_built_in, declared_permissions, declared_args, declared_runtimes) = {
        let reg = extensions.extensions.lock().map_err(|_| AppError::Lock)?;
        let record = reg
            .get(&extension_id)
            .ok_or_else(|| AppError::NotFound(format!("Extension not found: {}", extension_id)))?;
        (
            record.is_built_in,
            record.manifest.permissions.clone().unwrap_or_default(),
            record.manifest.permission_args.clone().unwrap_or_default(),
            record.manifest.runtimes.clone().unwrap_or_default(),
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
        declared_runtimes,
    })
}

/// Record the user's acceptance of a permission set. Called by the host
/// frontend after the consent dialog is accepted.
///
/// Acceptance also seeds the shell trust store with the programs declared
/// under `permissionArgs["shell:spawn"]` — the list the dialog showed as
/// chips. Best-effort: a program that fails to resolve or persist falls
/// back to the runtime trust prompt on first spawn. Not applied to
/// grandfathered records, whose users never saw the declared programs.
#[tauri::command]
pub async fn set_extension_consent(
    app_handle: AppHandle,
    db: tauri::State<'_, DataStore>,
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
    set_consent(&app_handle, &extension_id, &record)?;

    for program in declared_shell_programs(&record.permissions, &record.permission_args) {
        // Bare names go through the same PATH lookup the spawn path uses,
        // so the seeded row matches the path `is_trusted` is checked against.
        let resolved = if std::path::Path::new(&program).is_absolute() {
            Ok(program.clone())
        } else {
            crate::shell::resolve_path(&program).await
        };
        match resolved {
            Ok(path) => {
                let grant = db
                    .conn()
                    .and_then(|conn| shell_storage::grant_trust(&conn, &extension_id, &path));
                if let Err(e) = grant {
                    warn!(
                        "Consent accepted for '{}' but seeding shell trust for '{}' failed: {}",
                        extension_id, path, e
                    );
                }
            }
            Err(e) => {
                warn!(
                    "Declared shell program '{}' for '{}' did not resolve; skipping trust seed ({}). The runtime prompt will cover it once installed.",
                    program, extension_id, e
                );
            }
        }
    }

    emit_consent_changed(&app_handle, &extension_id);
    Ok(())
}

/// Remove `extension_id`'s entry from `settings.extensions.consent`, if
/// present. Pure JSON manipulation — testable without an `AppHandle`.
/// Returns whether an entry was actually removed. Missing `extensions` or
/// `consent` objects are a no-op (nothing to remove), matching
/// `get_consent`'s "absent record" semantics; a *present but non-object*
/// value at either level is corruption and errors instead of being
/// silently clobbered, same as `child_object_mut`.
pub fn remove_consent(
    settings: &mut serde_json::Value,
    extension_id: &str,
) -> Result<bool, AppError> {
    let root = settings_root_mut(settings)?;
    let Some(extensions) = root.get_mut("extensions") else {
        return Ok(false);
    };
    let extensions = extensions.as_object_mut().ok_or_else(|| {
        AppError::Other("settings.dat is corrupt: 'extensions' is not a JSON object".into())
    })?;
    let Some(consent) = extensions.get_mut("consent") else {
        return Ok(false);
    };
    let consent = consent.as_object_mut().ok_or_else(|| {
        AppError::Other("settings.dat is corrupt: 'consent' is not a JSON object".into())
    })?;
    Ok(consent.remove(extension_id).is_some())
}

/// Withdraw a previously-granted consent record. Used by the Settings UI's
/// "Revoke" action — the extension stays installed/enabled; the record's
/// absence means the next registration attempt withholds its permissions
/// until the user re-grants via the normal review flow.
pub fn clear_consent(app_handle: &AppHandle, extension_id: &str) -> Result<(), AppError> {
    let store = app_handle
        .store("settings.dat")
        .map_err(|e| AppError::Other(format!("Failed to open settings store: {}", e)))?;
    let Some(mut settings) = store.get("settings") else {
        return Ok(());
    };
    if remove_consent(&mut settings, extension_id)? {
        store.set("settings", settings);
        store
            .save()
            .map_err(|e| AppError::Other(format!("Failed to save settings: {}", e)))?;
    }
    Ok(())
}

/// Tauri command backing the Settings → Extensions "Revoke" button. Clears
/// the consent record and immediately unregisters the extension from the
/// live permission registry, so its gated calls fail closed right away —
/// no restart or extension reload required.
///
/// Shell trust is withdrawn with it — rows seeded at acceptance and rows
/// granted through the runtime prompt were both granted under this consent.
#[tauri::command]
pub fn revoke_extension_consent(
    app_handle: AppHandle,
    db: tauri::State<'_, DataStore>,
    extension_id: String,
    registry: tauri::State<'_, ExtensionPermissionRegistry>,
) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation(
            "extension_id cannot be empty".to_string(),
        ));
    }
    clear_consent(&app_handle, &extension_id)?;
    registry.unregister(&extension_id);
    shell_storage::cleanup_extension(&*db.conn()?, &extension_id)?;
    emit_consent_changed(&app_handle, &extension_id);
    Ok(())
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
                runtimes: None,
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
    fn child_object_mut_creates_missing_and_returns_existing() {
        let mut value = serde_json::json!({ "existing": { "a": 1 } });
        let root = value.as_object_mut().unwrap();
        assert!(child_object_mut(root, "created").is_ok());
        let existing = child_object_mut(root, "existing").unwrap();
        assert_eq!(existing.get("a"), Some(&serde_json::json!(1)));
    }

    #[test]
    fn child_object_mut_errors_on_non_object_instead_of_clobbering() {
        let mut value = serde_json::json!({ "consent": "corrupt-string" });
        let root = value.as_object_mut().unwrap();
        assert!(child_object_mut(root, "consent").is_err());
        // The corrupt value must survive untouched.
        assert_eq!(
            value.get("consent"),
            Some(&serde_json::json!("corrupt-string"))
        );
    }

    #[test]
    fn settings_root_mut_errors_on_non_object_settings() {
        let mut value = serde_json::json!("corrupt");
        assert!(settings_root_mut(&mut value).is_err());
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

    // ---- declared_shell_programs (trust seeding at consent acceptance) ----

    #[test]
    fn shell_programs_extracted_when_permission_declared() {
        let programs = declared_shell_programs(
            &perms(&["shell:spawn", "network"]),
            &args(serde_json::json!({"shell:spawn": ["shortcuts", "/usr/bin/say"]})),
        );
        assert_eq!(programs, vec!["shortcuts", "/usr/bin/say"]);
    }

    #[test]
    fn shell_programs_empty_without_shell_spawn_permission() {
        let programs = declared_shell_programs(
            &perms(&["network"]),
            &args(serde_json::json!({"shell:spawn": ["shortcuts"]})),
        );
        assert!(programs.is_empty());
    }

    #[test]
    fn shell_programs_empty_without_declared_args() {
        let programs =
            declared_shell_programs(&perms(&["shell:spawn"]), &args(serde_json::json!({})));
        assert!(programs.is_empty());
    }

    #[test]
    fn shell_programs_drops_non_string_entries() {
        let programs = declared_shell_programs(
            &perms(&["shell:spawn"]),
            &args(serde_json::json!({"shell:spawn": ["shortcuts", 42, null, {"a": 1}]})),
        );
        assert_eq!(programs, vec!["shortcuts"]);
    }

    #[test]
    fn shell_programs_empty_when_args_not_an_array() {
        let programs = declared_shell_programs(
            &perms(&["shell:spawn"]),
            &args(serde_json::json!({"shell:spawn": "shortcuts"})),
        );
        assert!(programs.is_empty());
    }

    // ---- remove_consent (backs the Settings "Revoke" action) ----

    #[test]
    fn remove_consent_removes_existing_record() {
        let mut settings = serde_json::json!({
            "extensions": { "consent": { "ext.a": { "permissions": ["network"] } } }
        });
        assert!(remove_consent(&mut settings, "ext.a").unwrap());
        assert!(settings["extensions"]["consent"].get("ext.a").is_none());
    }

    #[test]
    fn remove_consent_preserves_sibling_entries() {
        let mut settings = serde_json::json!({
            "extensions": { "consent": {
                "ext.a": { "permissions": ["network"] },
                "ext.b": { "permissions": ["fs:watch"] },
            }}
        });
        assert!(remove_consent(&mut settings, "ext.a").unwrap());
        assert!(settings["extensions"]["consent"].get("ext.a").is_none());
        assert!(settings["extensions"]["consent"].get("ext.b").is_some());
    }

    #[test]
    fn remove_consent_is_noop_when_extensions_key_missing() {
        let mut settings = serde_json::json!({});
        assert!(!remove_consent(&mut settings, "ext.a").unwrap());
    }

    #[test]
    fn remove_consent_is_noop_when_consent_key_missing() {
        let mut settings = serde_json::json!({ "extensions": {} });
        assert!(!remove_consent(&mut settings, "ext.a").unwrap());
    }

    #[test]
    fn remove_consent_is_noop_when_id_not_present() {
        let mut settings = serde_json::json!({ "extensions": { "consent": {} } });
        assert!(!remove_consent(&mut settings, "ext.a").unwrap());
    }

    #[test]
    fn remove_consent_errors_on_corrupt_extensions() {
        let mut settings = serde_json::json!({ "extensions": "corrupt-string" });
        assert!(remove_consent(&mut settings, "ext.a").is_err());
    }

    #[test]
    fn remove_consent_errors_on_corrupt_consent() {
        let mut settings = serde_json::json!({ "extensions": { "consent": "corrupt-string" } });
        assert!(remove_consent(&mut settings, "ext.a").is_err());
    }

    #[test]
    fn remove_consent_errors_on_corrupt_settings_root() {
        let mut settings = serde_json::json!("corrupt");
        assert!(remove_consent(&mut settings, "ext.a").is_err());
    }

    // ---- emit_consent_changed (cross-window "needs review" sync) ----

    #[test]
    fn emit_consent_changed_broadcasts_the_extension_id() {
        use std::sync::{Arc, Mutex};
        use tauri::Listener;

        let app = tauri::test::mock_app();
        let received: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let received_clone = Arc::clone(&received);
        app.listen("asyar:consent-changed", move |event| {
            *received_clone.lock().unwrap() = Some(event.payload().to_string());
        });

        emit_consent_changed(app.handle(), "ext.test");

        let payload = received
            .lock()
            .unwrap()
            .clone()
            .expect("event was not emitted");
        assert!(payload.contains("ext.test"));
    }

    #[test]
    fn emit_consent_changed_fires_for_every_call_on_a_persistent_listener() {
        use std::sync::{Arc, Mutex};
        use tauri::Listener;

        let app = tauri::test::mock_app();
        let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let received_clone = Arc::clone(&received);
        app.listen("asyar:consent-changed", move |event| {
            received_clone
                .lock()
                .unwrap()
                .push(event.payload().to_string());
        });

        emit_consent_changed(app.handle(), "ext.one");
        emit_consent_changed(app.handle(), "ext.two");

        let payloads = received.lock().unwrap().clone();
        assert_eq!(payloads.len(), 2);
        assert!(payloads[0].contains("ext.one"));
        assert!(payloads[1].contains("ext.two"));
    }
}
