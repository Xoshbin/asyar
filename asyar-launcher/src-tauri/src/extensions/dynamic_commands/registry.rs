//! In-memory registry of runtime-registered commands per extension.
//!
//! The registry is the source of truth for "what dynamic commands does
//! extension X currently expose." Search engine indexing and persistence
//! GC are derived from registry diffs, not from a parallel store.
//!
//! Held in a `Mutex` rather than `RwLock` because writes
//! (`replace_for_extension`) and reads (`get_meta`) are both common and
//! the typical command-list size (~5-100 per extension) makes lock
//! contention a non-issue.

use crate::error::AppError;
use crate::extensions::CommandArgument;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// One runtime-registered command. Mirrors
/// `DynamicCommandRegistration` in `asyar-sdk/src/types/CommandType.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredCommand {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arguments: Vec<CommandArgument>,
}

/// Diff returned by a `replace_for_extension` call. Callers use this
/// to drive search-index synchronization and persistence GC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ReplaceDiff {
    /// Dynamic ids that did not exist before this replace.
    pub added: Vec<String>,
    /// Dynamic ids that existed before but are not in the new list.
    pub removed: Vec<String>,
    /// Dynamic ids that existed before and remain in the new list.
    pub kept: Vec<String>,
}

/// Per-extension dynamic command registry.
///
/// Construct one in app state during `setup_app`; the registry is purely
/// in-memory and is rebuilt on every launcher start when extensions
/// re-call `replaceDynamicCommands` from their workers.
pub struct DynamicCommandRegistry {
    inner: Mutex<HashMap<String, HashMap<String, RegisteredCommand>>>,
}

impl Default for DynamicCommandRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl DynamicCommandRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Replace this extension's full dynamic command list. Atomic: the
    /// previous list is overwritten only if all registrations validate.
    /// Validation is performed by the caller (typically the Tauri
    /// command handler) — this method assumes inputs are already checked
    /// and focuses on diff computation.
    ///
    /// Returns the diff of added / removed / kept ids, in the order the
    /// caller can iterate `removed` for search-index removal and
    /// `added`/`kept` for re-index.
    pub fn replace_for_extension(
        &self,
        extension_id: &str,
        regs: Vec<RegisteredCommand>,
    ) -> Result<ReplaceDiff, AppError> {
        let mut guard = self.inner.lock().map_err(|_| AppError::Lock)?;

        let mut new_map: HashMap<String, RegisteredCommand> = HashMap::with_capacity(regs.len());
        for r in regs {
            // Last-write-wins on duplicate ids; validation should have
            // rejected duplicates before we got here, but be defensive.
            new_map.insert(r.id.clone(), r);
        }
        let new_ids: std::collections::HashSet<String> = new_map.keys().cloned().collect();

        let prev_ids: std::collections::HashSet<String> = guard
            .get(extension_id)
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();

        let mut diff = ReplaceDiff::default();
        for id in &new_ids {
            if prev_ids.contains(id) {
                diff.kept.push(id.clone());
            } else {
                diff.added.push(id.clone());
            }
        }
        for id in &prev_ids {
            if !new_ids.contains(id) {
                diff.removed.push(id.clone());
            }
        }
        diff.added.sort();
        diff.removed.sort();
        diff.kept.sort();

        if new_map.is_empty() {
            guard.remove(extension_id);
        } else {
            guard.insert(extension_id.to_string(), new_map);
        }

        Ok(diff)
    }

    /// Look up a single registration. Returns `None` if the extension
    /// hasn't registered anything or the id is unknown.
    pub fn get_meta(
        &self,
        extension_id: &str,
        dynamic_id: &str,
    ) -> Result<Option<RegisteredCommand>, AppError> {
        let guard = self.inner.lock().map_err(|_| AppError::Lock)?;
        Ok(guard
            .get(extension_id)
            .and_then(|m| m.get(dynamic_id))
            .cloned())
    }

    /// Drop every registration for this extension, returning the dropped
    /// dynamic ids so the caller can sync the search index and persistence.
    pub fn clear_for_extension(&self, extension_id: &str) -> Result<Vec<String>, AppError> {
        let mut guard = self.inner.lock().map_err(|_| AppError::Lock)?;
        let removed = guard
            .remove(extension_id)
            .map(|m| {
                let mut ids: Vec<String> = m.into_keys().collect();
                ids.sort();
                ids
            })
            .unwrap_or_default();
        Ok(removed)
    }

    /// List the currently-registered commands for an extension. Used by
    /// the dev inspector and lifecycle restoration paths.
    pub fn list_for_extension(
        &self,
        extension_id: &str,
    ) -> Result<Vec<RegisteredCommand>, AppError> {
        let guard = self.inner.lock().map_err(|_| AppError::Lock)?;
        let mut out: Vec<RegisteredCommand> = guard
            .get(extension_id)
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rc(id: &str, name: &str) -> RegisteredCommand {
        RegisteredCommand {
            id: id.to_string(),
            name: name.to_string(),
            description: None,
            icon: None,
            arguments: vec![],
        }
    }

    #[test]
    fn empty_registry_get_meta_returns_none() {
        let r = DynamicCommandRegistry::new();
        assert!(r.get_meta("ext", "x").unwrap().is_none());
    }

    #[test]
    fn replace_with_one_then_get_meta_returns_it() {
        let r = DynamicCommandRegistry::new();
        let diff = r
            .replace_for_extension("ext", vec![rc("sc-1", "Lights")])
            .unwrap();
        assert_eq!(diff.added, vec!["sc-1".to_string()]);
        assert!(diff.removed.is_empty());
        assert!(diff.kept.is_empty());

        let got = r.get_meta("ext", "sc-1").unwrap().unwrap();
        assert_eq!(got.name, "Lights");
    }

    #[test]
    fn replace_with_empty_list_clears_extension() {
        let r = DynamicCommandRegistry::new();
        r.replace_for_extension("ext", vec![rc("sc-1", "A")])
            .unwrap();

        let diff = r.replace_for_extension("ext", vec![]).unwrap();
        assert_eq!(diff.removed, vec!["sc-1".to_string()]);
        assert!(diff.added.is_empty());
        assert!(diff.kept.is_empty());

        assert!(r.get_meta("ext", "sc-1").unwrap().is_none());
    }

    #[test]
    fn replace_returns_diff_added_removed_kept() {
        let r = DynamicCommandRegistry::new();
        r.replace_for_extension("ext", vec![rc("a", "A"), rc("b", "B"), rc("c", "C")])
            .unwrap();

        let diff = r
            .replace_for_extension("ext", vec![rc("b", "B"), rc("c", "C2"), rc("d", "D")])
            .unwrap();

        assert_eq!(diff.added, vec!["d".to_string()]);
        assert_eq!(diff.removed, vec!["a".to_string()]);
        assert_eq!(diff.kept, vec!["b".to_string(), "c".to_string()]);
    }

    #[test]
    fn replace_updates_kept_command_data() {
        let r = DynamicCommandRegistry::new();
        r.replace_for_extension("ext", vec![rc("c", "Old name")])
            .unwrap();
        r.replace_for_extension("ext", vec![rc("c", "New name")])
            .unwrap();

        let got = r.get_meta("ext", "c").unwrap().unwrap();
        assert_eq!(got.name, "New name");
    }

    #[test]
    fn replace_does_not_affect_other_extensions() {
        let r = DynamicCommandRegistry::new();
        r.replace_for_extension("ext-a", vec![rc("a1", "A1")])
            .unwrap();
        r.replace_for_extension("ext-b", vec![rc("b1", "B1")])
            .unwrap();

        // Replace ext-a; ext-b's items must remain intact.
        r.replace_for_extension("ext-a", vec![]).unwrap();

        assert!(r.get_meta("ext-a", "a1").unwrap().is_none());
        assert!(r.get_meta("ext-b", "b1").unwrap().is_some());
    }

    #[test]
    fn replace_with_duplicate_ids_keeps_last() {
        // Defense-in-depth: validation should have rejected this, but
        // the registry must not crash on it.
        let r = DynamicCommandRegistry::new();
        let diff = r
            .replace_for_extension("ext", vec![rc("dup", "First"), rc("dup", "Second")])
            .unwrap();
        assert_eq!(diff.added, vec!["dup".to_string()]);
        let got = r.get_meta("ext", "dup").unwrap().unwrap();
        assert_eq!(got.name, "Second");
    }

    #[test]
    fn clear_for_extension_returns_ids_and_empties_registry() {
        let r = DynamicCommandRegistry::new();
        r.replace_for_extension("ext", vec![rc("a", "A"), rc("b", "B")])
            .unwrap();

        let removed = r.clear_for_extension("ext").unwrap();
        assert_eq!(removed, vec!["a".to_string(), "b".to_string()]);

        assert!(r.list_for_extension("ext").unwrap().is_empty());
    }

    #[test]
    fn clear_for_unknown_extension_returns_empty_vec() {
        let r = DynamicCommandRegistry::new();
        let removed = r.clear_for_extension("never-registered").unwrap();
        assert!(removed.is_empty());
    }

    #[test]
    fn list_for_extension_is_sorted() {
        let r = DynamicCommandRegistry::new();
        r.replace_for_extension("ext", vec![rc("z", "Z"), rc("a", "A"), rc("m", "M")])
            .unwrap();
        let list = r.list_for_extension("ext").unwrap();
        let ids: Vec<&str> = list.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "m", "z"]);
    }
}
