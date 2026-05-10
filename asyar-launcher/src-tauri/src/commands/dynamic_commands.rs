//! Tauri commands for runtime-registered dynamic commands.
//!
//! Both commands are reachable from a Tier 2 extension's worker iframe
//! through the SDK `commandsService` proxy. The IPC router injects the
//! trusted `extension_id` from the iframe `data-extension-id` attribute
//! before invoking these commands — never trust an `extension_id`
//! coming from a user-supplied payload.
//!
//! `replace_dynamic_commands_builtin` is a gate-bypass variant for
//! first-party built-in extensions (e.g. `scripts`) that have
//! no worker iframe and therefore cannot pass the `background.main` check.
//! Only extension ids on `BUILTIN_DYNAMIC_COMMAND_ALLOWLIST` are accepted.

/// Extension ids that may bypass the `background.main` worker gate.
/// Only first-party built-ins belong here.
const BUILTIN_DYNAMIC_COMMAND_ALLOWLIST: &[&str] = &["scripts", "agents"];

use crate::error::AppError;
use crate::extensions::dynamic_commands::{
    validate_arguments, validate_dynamic_id, DynamicCommandRegistry, RegisteredCommand,
};
use crate::extensions::ExtensionRegistryState;
use crate::search_engine::SearchState;
use crate::storage::{command_arg_defaults, DataStore};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Reply for `get_dynamic_command_meta`. Mirrors the launcher-side
/// `CommandArgMeta` shape (Tier 2 fields only — `isBuiltIn` is always
/// false for dynamic commands by construction).
///
/// Not `specta::Type`: the TS side imports `CommandArgument` from
/// `asyar-sdk/contracts`, so this struct's wire shape is owned by the
/// SDK types, not by an auto-generated `bindings.ts` entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicCommandMeta {
    pub extension_id: String,
    /// The bare dynamic id as registered by the extension (no `dynamic:`
    /// prefix). The launcher composes the persistence key when needed.
    pub command_id: String,
    pub command_name: String,
    pub icon: Option<String>,
    pub args: Vec<crate::extensions::CommandArgument>,
}

/// Replace the calling extension's dynamic command list with `regs`.
/// Atomic: validates every registration first; if any fails, the
/// previous list is preserved and the call rejects with a validation
/// error describing the offending registration.
///
/// Side effects (in order):
///   1. Validate each `reg.id` and `reg.arguments`.
///   2. Confirm the extension declares `background.main` — calling this
///      from an extension without a worker is a programmer error and
///      almost certainly indicates an extension wired to the wrong SDK
///      entry. Reject loud, do not silently install into a registry the
///      extension cannot reach.
///   3. Replace the registry entry; capture the diff.
///   4. Sync the search index (remove stale dynamic items, re-index
///      added/kept).
///   5. GC persisted argument last-values for removed dynamic ids.
#[tauri::command]
pub async fn replace_dynamic_commands(
    extension_id: String,
    regs: Vec<RegisteredCommand>,
    registry_state: State<'_, ExtensionRegistryState>,
    dynamic_registry: State<'_, DynamicCommandRegistry>,
    search_state: State<'_, SearchState>,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation(
            "extension_id missing — IPC router should inject it from the trusted iframe".into(),
        ));
    }

    // Step 1: validate every registration before touching any state.
    for reg in &regs {
        validate_dynamic_id(&reg.id).map_err(|e| {
            AppError::Validation(format!("dynamic command id '{}': {e}", reg.id))
        })?;
        if reg.name.trim().is_empty() {
            return Err(AppError::Validation(format!(
                "dynamic command id '{}': name must not be empty",
                reg.id
            )));
        }
        validate_arguments(&reg.arguments).map_err(|e| {
            AppError::Validation(format!("dynamic command id '{}': {e}", reg.id))
        })?;
    }

    // Step 2: gate on background.main. Dynamic commands must register
    // from the worker, and a worker only exists for extensions that
    // declare background.main in their manifest.
    {
        let reg_guard = registry_state
            .extensions
            .lock()
            .map_err(|_| AppError::Lock)?;
        let record = reg_guard.get(&extension_id).ok_or_else(|| {
            AppError::NotFound(format!("Extension not found: {extension_id}"))
        })?;
        let has_worker = record
            .manifest
            .background
            .as_ref()
            .map(|b| !b.main.trim().is_empty())
            .unwrap_or(false);
        if !has_worker {
            return Err(AppError::Validation(format!(
                "extension '{extension_id}' does not declare background.main; \
                 dynamic commands must be registered from a worker iframe"
            )));
        }
    }

    // Step 3: replace in registry and capture the diff.
    let diff = dynamic_registry.replace_for_extension(&extension_id, regs.clone())?;

    // Step 4: sync the search index. `replace_dynamic_commands` does the
    // diff against indexed items internally, so we can pass the full
    // current set and it will remove stale + index added/kept.
    search_state
        .replace_dynamic_commands(&extension_id, &regs)
        .map_err(|e| AppError::Other(format!("Failed to sync dynamic command search index: {e}")))?;

    // Step 5: GC persisted argument last-values for ids that no longer exist.
    let conn = data_store.conn()?;
    for removed_id in &diff.removed {
        if let Err(e) = command_arg_defaults::clear_for_dynamic_id(&conn, &extension_id, removed_id) {
            log::warn!(
                "Failed to clear persisted args for removed dynamic command '{}/{}': {}",
                extension_id,
                removed_id,
                e
            );
        }
    }

    log::info!(
        "Dynamic commands for '{}': +{} -{} ={}",
        extension_id,
        diff.added.len(),
        diff.removed.len(),
        diff.kept.len()
    );

    Ok(())
}

/// Inner logic for `replace_dynamic_commands_builtin`. Accepts explicit
/// dependencies so tests can exercise it without a Tauri runtime.
///
/// Gate: rejects `extension_id`s not in `BUILTIN_DYNAMIC_COMMAND_ALLOWLIST`
/// with `AppError::Validation`. Does NOT check `background.main` — built-in
/// extensions have no worker iframe by design.
pub(crate) fn replace_dynamic_commands_builtin_impl(
    dynamic_registry: &DynamicCommandRegistry,
    search_state: &crate::search_engine::SearchState,
    conn: &rusqlite::Connection,
    extension_id: &str,
    regs: Vec<RegisteredCommand>,
) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation(
            "extension_id must not be empty".into(),
        ));
    }

    if !BUILTIN_DYNAMIC_COMMAND_ALLOWLIST.contains(&extension_id) {
        return Err(AppError::Validation(format!(
            "extension '{}' is not in the built-in dynamic commands allowlist",
            extension_id
        )));
    }

    // Validate every registration before touching any state.
    for reg in &regs {
        validate_dynamic_id(&reg.id).map_err(|e| {
            AppError::Validation(format!("dynamic command id '{}': {e}", reg.id))
        })?;
        if reg.name.trim().is_empty() {
            return Err(AppError::Validation(format!(
                "dynamic command id '{}': name must not be empty",
                reg.id
            )));
        }
        validate_arguments(&reg.arguments).map_err(|e| {
            AppError::Validation(format!("dynamic command id '{}': {e}", reg.id))
        })?;
    }

    // Replace in registry and capture the diff.
    let diff = dynamic_registry.replace_for_extension(extension_id, regs.clone())?;

    // Sync the search index.
    search_state
        .replace_dynamic_commands(extension_id, &regs)
        .map_err(|e| AppError::Other(format!("Failed to sync dynamic command search index: {e}")))?;

    // GC persisted argument last-values for ids that no longer exist.
    for removed_id in &diff.removed {
        if let Err(e) = crate::storage::command_arg_defaults::clear_for_dynamic_id(
            conn,
            extension_id,
            removed_id,
        ) {
            log::warn!(
                "Failed to clear persisted args for removed dynamic command '{}/{}': {}",
                extension_id,
                removed_id,
                e
            );
        }
    }

    log::info!(
        "Dynamic commands (builtin) for '{}': +{} -{} ={}",
        extension_id,
        diff.added.len(),
        diff.removed.len(),
        diff.kept.len()
    );

    Ok(())
}

/// Replace a built-in extension's dynamic command list, bypassing the
/// `background.main` worker check.
///
/// Accepts only extension ids declared in `BUILTIN_DYNAMIC_COMMAND_ALLOWLIST`.
/// All other steps (validation, registry replace, search sync, persistence GC)
/// are identical to `replace_dynamic_commands`.
#[tauri::command]
pub async fn replace_dynamic_commands_builtin(
    extension_id: String,
    regs: Vec<RegisteredCommand>,
    dynamic_registry: State<'_, DynamicCommandRegistry>,
    search_state: State<'_, crate::search_engine::SearchState>,
    data_store: State<'_, crate::storage::DataStore>,
) -> Result<(), AppError> {
    let conn = data_store.conn()?;
    replace_dynamic_commands_builtin_impl(&dynamic_registry, &search_state, &conn, &extension_id, regs)
}

/// Look up the meta for a dynamic command by its full search-index
/// `object_id` (`cmd_<extensionId>_dyn_<dynamicId>`). Returns `None`
/// when the id does not match the dynamic format or when the registry
/// has no matching entry.
///
/// Used by the launcher's TS argument-mode resolver as a fallback when
/// the in-memory manifest scan misses.
#[tauri::command]
pub async fn get_dynamic_command_meta(
    object_id: String,
    dynamic_registry: State<'_, DynamicCommandRegistry>,
) -> Result<Option<DynamicCommandMeta>, AppError> {
    let Some((extension_id, dynamic_id)) = parse_dynamic_object_id(&object_id) else {
        return Ok(None);
    };

    let reg = match dynamic_registry.get_meta(&extension_id, &dynamic_id)? {
        Some(r) => r,
        None => return Ok(None),
    };

    Ok(Some(DynamicCommandMeta {
        extension_id,
        command_id: dynamic_id,
        command_name: reg.name,
        icon: reg.icon,
        args: reg.arguments,
    }))
}

/// Parse a `cmd_<extensionId>_dyn_<dynamicId>` object id into its parts.
/// Returns `None` when the format does not match.
///
/// `_dyn_` is split from the right so an extension id containing
/// `_dyn_` (allowed but rare) does not break parsing — the dynamic id
/// itself only contains `[a-zA-Z0-9_-]`, so no `_dyn_` can appear
/// inside it.
pub fn parse_dynamic_object_id(object_id: &str) -> Option<(String, String)> {
    let rest = object_id.strip_prefix("cmd_")?;
    let (ext, dyn_id) = rest.rsplit_once("_dyn_")?;
    if ext.is_empty() || dyn_id.is_empty() {
        return None;
    }
    Some((ext.to_string(), dyn_id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::dynamic_commands::RegisteredCommand;
    use crate::search_engine::SearchState;

    fn make_db_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::storage::command_arg_defaults::init_table(&conn).unwrap();
        conn
    }

    fn rc(id: &str, name: &str) -> RegisteredCommand {
        RegisteredCommand {
            id: id.to_string(),
            name: name.to_string(),
            description: None,
            icon: None,
            arguments: vec![],
        }
    }

    // 9. allowlisted id is accepted and registrations land in registry
    #[test]
    fn replace_builtin_accepts_allowlisted_id() {
        let registry = DynamicCommandRegistry::new();
        let search = SearchState::new_for_test();
        let conn = make_db_conn();

        let result = replace_dynamic_commands_builtin_impl(
            &registry,
            &search,
            &conn,
            "scripts",
            vec![rc("script-1", "Run Alpha")],
        );
        assert!(
            result.is_ok(),
            "allowlisted id must be accepted, got {result:?}"
        );

        let stored = registry
            .get_meta("scripts", "script-1")
            .unwrap();
        assert!(
            stored.is_some(),
            "registration must be present in registry after builtin replace"
        );
        assert_eq!(stored.unwrap().name, "Run Alpha");
    }

    // 10. non-allowlisted id is rejected with AppError::Validation
    #[test]
    fn replace_builtin_rejects_unknown_id() {
        let registry = DynamicCommandRegistry::new();
        let search = SearchState::new_for_test();
        let conn = make_db_conn();

        let result = replace_dynamic_commands_builtin_impl(
            &registry,
            &search,
            &conn,
            "com.example.notbuiltin",
            vec![rc("x", "X")],
        );
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "non-allowlisted id must return Err(AppError::Validation), got {result:?}"
        );
    }

    // 11. empty extension_id is rejected
    #[test]
    fn replace_builtin_rejects_empty_id() {
        let registry = DynamicCommandRegistry::new();
        let search = SearchState::new_for_test();
        let conn = make_db_conn();

        let result = replace_dynamic_commands_builtin_impl(
            &registry,
            &search,
            &conn,
            "",
            vec![rc("x", "X")],
        );
        assert!(
            result.is_err(),
            "empty extension_id must return Err, got {result:?}"
        );
    }

    // 12. calling with empty regs clears existing registrations for that extension
    #[test]
    fn replace_builtin_with_empty_regs_clears_registrations() {
        let registry = DynamicCommandRegistry::new();
        let search = SearchState::new_for_test();
        let conn = make_db_conn();

        replace_dynamic_commands_builtin_impl(
            &registry,
            &search,
            &conn,
            "scripts",
            vec![rc("s1", "Script One"), rc("s2", "Script Two")],
        )
        .unwrap();

        replace_dynamic_commands_builtin_impl(
            &registry,
            &search,
            &conn,
            "scripts",
            vec![],
        )
        .unwrap();

        let list = registry.list_for_extension("scripts").unwrap();
        assert!(
            list.is_empty(),
            "registry must be empty after replace with empty regs, got {list:?}"
        );
    }

    #[test]
    fn parse_dynamic_object_id_extracts_parts() {
        let parsed = parse_dynamic_object_id("cmd_org.author.shortcuts_dyn_uuid-1");
        assert_eq!(
            parsed,
            Some(("org.author.shortcuts".to_string(), "uuid-1".to_string()))
        );
    }

    #[test]
    fn parse_dynamic_object_id_rejects_manifest_id() {
        // Manifest commands lack the _dyn_ infix.
        assert_eq!(parse_dynamic_object_id("cmd_ext_open"), None);
    }

    #[test]
    fn parse_dynamic_object_id_rejects_non_cmd_prefix() {
        assert_eq!(parse_dynamic_object_id("app_safari"), None);
        assert_eq!(parse_dynamic_object_id("foo_dyn_bar"), None);
    }

    #[test]
    fn parse_dynamic_object_id_rejects_empty_pieces() {
        assert_eq!(parse_dynamic_object_id("cmd__dyn_x"), None);
        assert_eq!(parse_dynamic_object_id("cmd_ext_dyn_"), None);
    }

    #[test]
    fn parse_dynamic_object_id_handles_extension_id_with_underscores() {
        let parsed = parse_dynamic_object_id("cmd_org_author_name_dyn_id-1");
        assert_eq!(
            parsed,
            Some(("org_author_name".to_string(), "id-1".to_string()))
        );
    }

    #[test]
    fn parse_dynamic_object_id_picks_rightmost_dyn_separator() {
        // If an extension id literally contained "_dyn_" (rare, but allowed
        // by the manifest validator), rsplit picks the rightmost occurrence
        // so the dynamic id remains intact.
        let parsed = parse_dynamic_object_id("cmd_weird_dyn_ext_dyn_actual-id");
        assert_eq!(
            parsed,
            Some(("weird_dyn_ext".to_string(), "actual-id".to_string()))
        );
    }

    #[test]
    fn builtin_allowlist_contains_agents() {
        assert!(
            BUILTIN_DYNAMIC_COMMAND_ALLOWLIST.contains(&"agents"),
            "'agents' must be in BUILTIN_DYNAMIC_COMMAND_ALLOWLIST so the \
             built-in feature can bypass the background.main worker gate"
        );
    }

    #[test]
    fn replace_builtin_accepts_agents_id() {
        let registry = DynamicCommandRegistry::new();
        let search = SearchState::new_for_test();
        let conn = make_db_conn();

        let result = replace_dynamic_commands_builtin_impl(
            &registry,
            &search,
            &conn,
            "agents",
            vec![rc("agent-1", "My Agent")],
        );
        assert!(
            result.is_ok(),
            "allowlisted 'agents' id must be accepted, got {result:?}"
        );
    }
}
