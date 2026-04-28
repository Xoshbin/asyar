pub mod commands;
pub mod models;

pub use models::{ItemAlias, AliasError, validate_alias};

use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex, RwLock};

pub fn init_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS item_aliases (
            object_id   TEXT PRIMARY KEY,
            alias       TEXT NOT NULL UNIQUE,
            item_name   TEXT NOT NULL,
            item_type   TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );"
    )
}

fn is_unique_alias_violation(err: &rusqlite::Error) -> bool {
    if let rusqlite::Error::SqliteFailure(sqlite_err, msg) = err {
        if sqlite_err.code == rusqlite::ErrorCode::ConstraintViolation {
            // Unique constraint on the `alias` column (vs. `object_id` PK, which is handled by ON CONFLICT)
            if let Some(detail) = msg {
                return detail.contains("item_aliases.alias");
            }
        }
    }
    false
}

pub struct AliasState {
    pub items: RwLock<Vec<ItemAlias>>,
    pub db: Arc<Mutex<Connection>>,
}

impl AliasState {
    /// Open an in-memory SQLite DB (used by tests) with the schema applied.
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_table(&conn).expect("init schema");
        Self {
            items: RwLock::new(Vec::new()),
            db: Arc::new(Mutex::new(conn)),
        }
    }

    /// Build an `AliasState` sharing the DataStore SQLite connection.
    /// The schema must already be initialised by `DataStore::initialize`
    /// calling `aliases::init_table`; this constructor only loads cached rows.
    pub fn new_with_db(db: Arc<Mutex<Connection>>) -> Result<Self, AliasError> {
        let state = Self {
            items: RwLock::new(Vec::new()),
            db,
        };
        state.load_from_db()?;
        Ok(state)
    }

    fn load_from_db(&self) -> Result<(), AliasError> {
        let conn = self.db.lock().map_err(|_| AliasError::Storage("db mutex poisoned in load_from_db".into()))?;
        let mut stmt = conn
            .prepare("SELECT object_id, alias, item_name, item_type, created_at FROM item_aliases")
            .map_err(|e| AliasError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ItemAlias {
                    object_id: row.get(0)?,
                    alias: row.get(1)?,
                    item_name: row.get(2)?,
                    item_type: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| AliasError::Storage(e.to_string()))?;
        let mut loaded = Vec::new();
        for row in rows {
            loaded.push(row.map_err(|e| AliasError::Storage(e.to_string()))?);
        }
        let mut items = self.items.write().map_err(|_| AliasError::Storage("items write lock poisoned in load_from_db".into()))?;
        *items = loaded;
        Ok(())
    }

    pub fn set_alias(
        &self,
        object_id: &str,
        alias: &str,
        item_name: &str,
        item_type: &str,
        created_at: i64,
    ) -> Result<ItemAlias, AliasError> {
        let normalized = validate_alias(alias)?;

        // Conflict: another object already owns this alias.
        {
            let items = self.items.read().map_err(|_| AliasError::Storage("items read lock poisoned in set_alias".into()))?;
            if let Some(existing) = items.iter().find(|a| a.alias == normalized && a.object_id != object_id) {
                return Err(AliasError::Conflict(normalized.clone(), existing.item_name.clone()));
            }
        }

        let entry = ItemAlias {
            object_id: object_id.to_string(),
            alias: normalized,
            item_name: item_name.to_string(),
            item_type: item_type.to_string(),
            created_at,
        };

        // Persist (UPSERT semantics: replace any existing row for this object_id).
        {
            let conn = self.db.lock().map_err(|_| AliasError::Storage("db mutex poisoned in set_alias".into()))?;
            let exec_result = conn.execute(
                "INSERT INTO item_aliases (object_id, alias, item_name, item_type, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(object_id) DO UPDATE SET
                    alias = excluded.alias,
                    item_name = excluded.item_name,
                    item_type = excluded.item_type,
                    created_at = excluded.created_at",
                params![entry.object_id, entry.alias, entry.item_name, entry.item_type, entry.created_at],
            );
            if let Err(e) = &exec_result {
                if is_unique_alias_violation(e) {
                    // Race: another caller acquired this alias between our cache check and this insert.
                    let owner_name: Option<String> = conn
                        .query_row(
                            "SELECT item_name FROM item_aliases WHERE alias = ?1",
                            params![entry.alias],
                            |r| r.get(0),
                        )
                        .ok();
                    return Err(AliasError::Conflict(
                        entry.alias,
                        owner_name.unwrap_or_else(|| "unknown".to_string()),
                    ));
                }
            }
            exec_result.map_err(|e| AliasError::Storage(e.to_string()))?;
        }

        // Update cache: remove any existing entry for this object_id, then push.
        {
            let mut items = self.items.write().map_err(|_| AliasError::Storage("items write lock poisoned in set_alias".into()))?;
            items.retain(|a| a.object_id != entry.object_id);
            items.push(entry.clone());
        }
        Ok(entry)
    }

    pub fn unset_alias(&self, alias: &str) -> Result<(), AliasError> {
        let normalized = alias.trim().to_lowercase();
        let conn = self.db.lock().map_err(|_| AliasError::Storage("db mutex poisoned in unset_alias".into()))?;
        let affected = conn
            .execute("DELETE FROM item_aliases WHERE alias = ?1", params![normalized])
            .map_err(|e| AliasError::Storage(e.to_string()))?;
        if affected == 0 {
            return Err(AliasError::NotFound(normalized));
        }
        drop(conn);
        let mut items = self.items.write().map_err(|_| AliasError::Storage("items write lock poisoned in unset_alias".into()))?;
        items.retain(|a| a.alias != normalized);
        Ok(())
    }

    pub fn unset_for_object_id(&self, object_id: &str) -> Result<(), AliasError> {
        let conn = self.db.lock().map_err(|_| AliasError::Storage("db mutex poisoned in unset_for_object_id".into()))?;
        conn
            .execute("DELETE FROM item_aliases WHERE object_id = ?1", params![object_id])
            .map_err(|e| AliasError::Storage(e.to_string()))?;
        drop(conn);
        let mut items = self.items.write().map_err(|_| AliasError::Storage("items write lock poisoned in unset_for_object_id".into()))?;
        items.retain(|a| a.object_id != object_id);
        Ok(())
    }

    pub fn find_by_alias(&self, alias: &str) -> Result<Option<ItemAlias>, AliasError> {
        let normalized = alias.trim().to_lowercase();
        let items = self.items.read().map_err(|_| AliasError::Storage("items read lock poisoned in find_by_alias".into()))?;
        Ok(items.iter().find(|a| a.alias == normalized).cloned())
    }

    /// Returns a conflicting alias entry if `alias` is already used by an
    /// object other than `excluding_object_id`.
    pub fn find_conflict(
        &self,
        alias: &str,
        excluding_object_id: Option<&str>,
    ) -> Result<Option<ItemAlias>, AliasError> {
        let normalized = alias.trim().to_lowercase();
        let items = self.items.read().map_err(|_| AliasError::Storage("items read lock poisoned in find_conflict".into()))?;
        Ok(items
            .iter()
            .find(|a| a.alias == normalized && Some(a.object_id.as_str()) != excluding_object_id)
            .cloned())
    }

    pub fn list_all(&self) -> Result<Vec<ItemAlias>, AliasError> {
        let items = self.items.read().map_err(|_| AliasError::Storage("items read lock poisoned in list_all".into()))?;
        let mut out: Vec<ItemAlias> = items.clone();
        out.sort_unstable_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(out)
    }

    pub fn lookup_alias_for(&self, object_id: &str) -> Result<Option<String>, AliasError> {
        let items = self.items.read().map_err(|_| AliasError::Storage("items read lock poisoned in lookup_alias_for".into()))?;
        Ok(items.iter().find(|a| a.object_id == object_id).map(|a| a.alias.clone()))
    }

    /// Removes all aliases whose `object_id` is NOT in `live_ids`.
    /// Returns the count of removed entries.
    pub fn prune_orphans(&self, live_ids: &std::collections::HashSet<String>) -> Result<usize, AliasError> {
        let to_remove: Vec<String> = {
            let items = self.items.read().map_err(|_| AliasError::Storage("items read lock poisoned in prune_orphans".into()))?;
            items
                .iter()
                .filter(|a| !live_ids.contains(&a.object_id))
                .map(|a| a.object_id.clone())
                .collect()
        };
        if to_remove.is_empty() {
            return Ok(0);
        }
        {
            let conn = self.db.lock().map_err(|_| AliasError::Storage("db mutex poisoned in prune_orphans".into()))?;
            for id in &to_remove {
                conn.execute("DELETE FROM item_aliases WHERE object_id = ?1", params![id])
                    .map_err(|e| AliasError::Storage(e.to_string()))?;
            }
        }
        let mut items = self.items.write().map_err(|_| AliasError::Storage("items write lock poisoned in prune_orphans".into()))?;
        let before = items.len();
        items.retain(|a| live_ids.contains(&a.object_id));
        Ok(before - items.len())
    }

    /// Removes all aliases whose `object_id` starts with `cmd_<extension_id>_`.
    /// Returns the count of removed entries.
    pub fn clear_for_extension(&self, extension_id: &str) -> Result<usize, AliasError> {
        let prefix = format!("cmd_{}_", extension_id);
        let to_remove: Vec<String> = {
            let items = self.items.read().map_err(|_| AliasError::Storage("items read lock poisoned in clear_for_extension".into()))?;
            items
                .iter()
                .filter(|a| a.object_id.starts_with(&prefix))
                .map(|a| a.object_id.clone())
                .collect()
        };
        if to_remove.is_empty() {
            return Ok(0);
        }
        {
            let conn = self.db.lock().map_err(|_| AliasError::Storage("db mutex poisoned in clear_for_extension".into()))?;
            for id in &to_remove {
                conn.execute("DELETE FROM item_aliases WHERE object_id = ?1", params![id])
                    .map_err(|e| AliasError::Storage(e.to_string()))?;
            }
        }
        let mut items = self.items.write().map_err(|_| AliasError::Storage("items write lock poisoned in clear_for_extension".into()))?;
        let before = items.len();
        items.retain(|a| !a.object_id.starts_with(&prefix));
        Ok(before - items.len())
    }
}

#[cfg(test)]
mod state_tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn new_in_memory_starts_empty() {
        let state = AliasState::new_in_memory();
        let items = state.items.read().unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn schema_creates_table() {
        let state = AliasState::new_in_memory();
        let conn = state.db.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='item_aliases'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn schema_enforces_alias_uniqueness() {
        let state = AliasState::new_in_memory();
        let conn = state.db.lock().unwrap();
        conn.execute(
            "INSERT INTO item_aliases (object_id, alias, item_name, item_type, created_at) VALUES ('id1','a','Name','application',0)",
            [],
        ).unwrap();
        let result = conn.execute(
            "INSERT INTO item_aliases (object_id, alias, item_name, item_type, created_at) VALUES ('id2','a','Other','command',1)",
            [],
        );
        assert!(result.is_err(), "duplicate alias should be rejected by UNIQUE constraint");
    }

    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }

    #[test]
    fn set_alias_persists_and_caches() {
        let state = AliasState::new_in_memory();
        state
            .set_alias("app_finder", "f", "Finder", "application", now_ms())
            .unwrap();
        let items = state.items.read().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].object_id, "app_finder");
        assert_eq!(items[0].alias, "f");
        // verify in DB too
        let conn = state.db.lock().unwrap();
        let alias: String = conn
            .query_row("SELECT alias FROM item_aliases WHERE object_id = ?1", params!["app_finder"], |r| r.get(0))
            .unwrap();
        assert_eq!(alias, "f");
    }

    #[test]
    fn set_alias_replaces_existing_for_same_object_id() {
        let state = AliasState::new_in_memory();
        state.set_alias("app_finder", "f", "Finder", "application", now_ms()).unwrap();
        state.set_alias("app_finder", "fi", "Finder", "application", now_ms()).unwrap();
        let items = state.items.read().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].alias, "fi");
        // Confirm UPSERT replaced rather than duplicated in the DB.
        let conn = state.db.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM item_aliases WHERE object_id = 'app_finder'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let alias: String = conn
            .query_row("SELECT alias FROM item_aliases WHERE object_id = 'app_finder'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(alias, "fi");
    }

    #[test]
    fn set_alias_validates_input() {
        let state = AliasState::new_in_memory();
        let err = state.set_alias("app_x", "no spaces", "X", "application", now_ms()).unwrap_err();
        assert_eq!(err, AliasError::InvalidChars);
    }

    #[test]
    fn set_alias_rejects_conflict() {
        let state = AliasState::new_in_memory();
        state.set_alias("app_finder", "f", "Finder", "application", now_ms()).unwrap();
        let err = state
            .set_alias("app_other", "f", "Other", "application", now_ms())
            .unwrap_err();
        assert!(matches!(err, AliasError::Conflict(_, _)));
    }

    #[test]
    fn unset_alias_removes_from_cache_and_db() {
        let state = AliasState::new_in_memory();
        state.set_alias("app_finder", "f", "Finder", "application", now_ms()).unwrap();
        state.unset_alias("f").unwrap();
        let items = state.items.read().unwrap();
        assert!(items.is_empty());
        let conn = state.db.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM item_aliases", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn unset_alias_returns_not_found_for_missing() {
        let state = AliasState::new_in_memory();
        let err = state.unset_alias("nope").unwrap_err();
        assert!(matches!(err, AliasError::NotFound(_)));
    }

    #[test]
    fn unset_for_object_id_removes_when_present() {
        let state = AliasState::new_in_memory();
        state.set_alias("app_finder", "f", "Finder", "application", now_ms()).unwrap();
        state.unset_for_object_id("app_finder").unwrap();
        assert!(state.items.read().unwrap().is_empty());
    }

    #[test]
    fn unset_for_object_id_is_noop_when_absent() {
        let state = AliasState::new_in_memory();
        state.unset_for_object_id("app_missing").unwrap();
        // Cache and DB both stay empty.
        assert!(state.items.read().unwrap().is_empty());
        let conn = state.db.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM item_aliases", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn set_alias_re_classifies_unique_violation_as_conflict() {
        // Simulate the race: insert a conflicting row directly through the DB
        // before calling set_alias. The cache check passes (cache is empty),
        // but the DB UNIQUE constraint fires and is_unique_alias_violation
        // re-classifies the rusqlite error as AliasError::Conflict.
        let state = AliasState::new_in_memory();
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO item_aliases (object_id, alias, item_name, item_type, created_at)
                 VALUES ('app_smuggled', 'cl', 'Smuggled', 'application', 0)",
                [],
            ).unwrap();
        }
        let err = state
            .set_alias("cmd_clip_history", "cl", "Clipboard History", "command", now_ms())
            .unwrap_err();
        assert!(
            matches!(err, AliasError::Conflict(_, _)),
            "expected Conflict, got {:?}",
            err
        );
    }

    #[test]
    fn find_by_alias_returns_match() {
        let state = AliasState::new_in_memory();
        state.set_alias("cmd_clip_history", "cl", "Clipboard History", "command", now_ms()).unwrap();
        let hit = state.find_by_alias("cl").unwrap();
        assert!(hit.is_some());
        assert_eq!(hit.unwrap().object_id, "cmd_clip_history");
    }

    #[test]
    fn find_by_alias_lowercases_input() {
        let state = AliasState::new_in_memory();
        state.set_alias("cmd_clip_history", "cl", "Clipboard History", "command", now_ms()).unwrap();
        let hit = state.find_by_alias("CL").unwrap();
        assert!(hit.is_some());
    }

    #[test]
    fn find_by_alias_returns_none_for_unknown() {
        let state = AliasState::new_in_memory();
        let hit = state.find_by_alias("ghost").unwrap();
        assert!(hit.is_none());
    }

    #[test]
    fn find_conflict_excludes_self() {
        let state = AliasState::new_in_memory();
        state.set_alias("cmd_x", "x", "X", "command", now_ms()).unwrap();
        // Same object querying its own alias should NOT see a conflict.
        let conflict = state.find_conflict("x", Some("cmd_x")).unwrap();
        assert!(conflict.is_none());
    }

    #[test]
    fn find_conflict_finds_other_owner() {
        let state = AliasState::new_in_memory();
        state.set_alias("cmd_x", "x", "X", "command", now_ms()).unwrap();
        let conflict = state.find_conflict("x", Some("cmd_y")).unwrap();
        let conflict = conflict.expect("expected conflict");
        assert_eq!(conflict.object_id, "cmd_x");
    }

    #[test]
    fn find_conflict_with_no_exclusion_finds_any_owner() {
        // None means "exclude nobody" — any matching alias is reported.
        // Guards against a future refactor that flips the != to == in the predicate.
        let state = AliasState::new_in_memory();
        state.set_alias("cmd_x", "x", "X", "command", now_ms()).unwrap();
        let conflict = state.find_conflict("x", None).unwrap();
        assert_eq!(conflict.expect("expected conflict").object_id, "cmd_x");
    }

    #[test]
    fn list_all_returns_sorted_by_created_at_descending() {
        let state = AliasState::new_in_memory();
        state.set_alias("a", "a", "A", "application", 100).unwrap();
        state.set_alias("b", "b", "B", "application", 200).unwrap();
        state.set_alias("c", "c", "C", "application", 50).unwrap();
        let listed = state.list_all().unwrap();
        let order: Vec<&str> = listed.iter().map(|x| x.object_id.as_str()).collect();
        assert_eq!(order, vec!["b", "a", "c"]);
    }

    #[test]
    fn lookup_alias_for_returns_alias_or_none() {
        let state = AliasState::new_in_memory();
        state.set_alias("cmd_x", "xx", "X", "command", now_ms()).unwrap();
        assert_eq!(state.lookup_alias_for("cmd_x").unwrap().as_deref(), Some("xx"));
        assert_eq!(state.lookup_alias_for("cmd_y").unwrap(), None);
    }

    #[test]
    fn prune_orphans_drops_aliases_for_unknown_ids() {
        let state = AliasState::new_in_memory();
        state.set_alias("app_finder", "f", "Finder", "application", now_ms()).unwrap();
        state.set_alias("cmd_clip_history", "cl", "Clipboard History", "command", now_ms()).unwrap();
        let live: HashSet<String> = ["app_finder".to_string()].into_iter().collect();
        let removed = state.prune_orphans(&live).unwrap();
        assert_eq!(removed, 1);
        let items = state.items.read().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].object_id, "app_finder");
        // Verify the DELETE path actually fired against the DB, not just the cache.
        drop(items);
        let conn = state.db.lock().unwrap();
        let db_count: i64 = conn
            .query_row("SELECT count(*) FROM item_aliases", [], |r| r.get(0))
            .unwrap();
        assert_eq!(db_count, 1);
        let surviving: String = conn
            .query_row("SELECT object_id FROM item_aliases", [], |r| r.get(0))
            .unwrap();
        assert_eq!(surviving, "app_finder");
    }

    #[test]
    fn prune_orphans_returns_zero_when_all_live() {
        let state = AliasState::new_in_memory();
        state.set_alias("app_finder", "f", "Finder", "application", now_ms()).unwrap();
        let live: HashSet<String> = ["app_finder".to_string()].into_iter().collect();
        let removed = state.prune_orphans(&live).unwrap();
        assert_eq!(removed, 0);
    }

    #[test]
    fn clear_for_extension_removes_only_that_extensions_aliases() {
        let state = AliasState::new_in_memory();
        state.set_alias("cmd_pomodoro_start", "ps", "Start Timer", "command", now_ms()).unwrap();
        state.set_alias("cmd_pomodoro_stop", "pst", "Stop Timer", "command", now_ms()).unwrap();
        state.set_alias("cmd_clip_history", "cl", "Clipboard History", "command", now_ms()).unwrap();
        let removed = state.clear_for_extension("pomodoro").unwrap();
        assert_eq!(removed, 2);
        let items = state.items.read().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].object_id, "cmd_clip_history");
        // DB also reflects the removal.
        drop(items);
        let conn = state.db.lock().unwrap();
        let db_count: i64 = conn
            .query_row("SELECT count(*) FROM item_aliases", [], |r| r.get(0))
            .unwrap();
        assert_eq!(db_count, 1);
    }
}
