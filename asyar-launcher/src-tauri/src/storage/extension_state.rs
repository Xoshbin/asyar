//! SQLite persistence primitives for the launcher-brokered extension state
//! store. Matches the `extension_kv` table shape but stores JSON values and
//! tracks `updated_at` for future diagnostics.
//!
//! This module owns only the row-level CRUD. The in-memory subscription
//! registry, fan-out, and RPC routing live in
//! [`crate::extensions::extension_state`] — the two are split so the
//! persistence layer stays trivially unit-testable without spinning up any
//! subscriber machinery.

use crate::error::AppError;
use crate::extensions::extension_state::StateEntry;
use rusqlite::{params, Connection};
use serde_json::Value;

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS extension_state (
            extension_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (extension_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_ext_state_ext_id
            ON extension_state(extension_id);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init extension_state table: {e}")))?;
    Ok(())
}

/// Fetch the latest value for `(extension_id, key)`. Returns `None` when no
/// row exists. The stored JSON is parsed on read — rows written by `set` are
/// guaranteed to be valid JSON, so parse failure here indicates an external
/// mutation and is surfaced as a `Database` error rather than `None`.
pub fn get(
    conn: &Connection,
    extension_id: &str,
    key: &str,
) -> Result<Option<Value>, AppError> {
    let row = conn.query_row(
        "SELECT value_json FROM extension_state WHERE extension_id = ?1 AND key = ?2",
        params![extension_id, key],
        |row| row.get::<_, String>(0),
    );
    match row {
        Ok(json) => {
            let v: Value = serde_json::from_str(&json)
                .map_err(|e| AppError::Database(format!("Corrupt extension_state JSON: {e}")))?;
            Ok(Some(v))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to get extension_state: {e}"))),
    }
}

/// Upsert the row for `(extension_id, key)`. `now_ms` is the caller-supplied
/// wall clock so tests can pin time and production code can use
/// `shell::now_millis()` for consistency with timers / cache.
pub fn set(
    conn: &Connection,
    extension_id: &str,
    key: &str,
    value: &Value,
    now_ms: u64,
) -> Result<(), AppError> {
    let json = serde_json::to_string(value)
        .map_err(|e| AppError::Database(format!("Failed to serialise extension_state: {e}")))?;
    conn.execute(
        "INSERT OR REPLACE INTO extension_state (extension_id, key, value_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![extension_id, key, json, now_ms],
    )
    .map_err(|e| AppError::Database(format!("Failed to set extension_state: {e}")))?;
    Ok(())
}

/// Read every `(key, value, updated_at)` row for `extension_id`. Used by
/// the dev inspector's State panel so the user can eyeball what's in the
/// launcher-brokered store without reaching in via a SQLite client. Rows
/// are returned in arbitrary order.
pub fn get_all(conn: &Connection, extension_id: &str) -> Result<Vec<StateEntry>, AppError> {
    let mut stmt = conn
        .prepare("SELECT key, value_json, updated_at FROM extension_state WHERE extension_id = ?1")
        .map_err(|e| AppError::Database(format!("Failed to prepare get_all: {e}")))?;
    let rows = stmt
        .query_map(params![extension_id], |row| {
            let key: String = row.get(0)?;
            let json: String = row.get(1)?;
            let updated_at: i64 = row.get(2)?;
            Ok((key, json, updated_at))
        })
        .map_err(|e| AppError::Database(format!("Failed to query extension_state: {e}")))?;
    let mut out = Vec::new();
    for row in rows {
        let (key, json, updated_at) = row.map_err(|e| {
            AppError::Database(format!("Failed to read extension_state row: {e}"))
        })?;
        let value: Value = serde_json::from_str(&json).map_err(|e| {
            AppError::Database(format!("Corrupt extension_state JSON for {key}: {e}"))
        })?;
        out.push(StateEntry {
            key,
            value,
            updated_at: updated_at as u64,
        });
    }
    Ok(out)
}

/// Delete all rows for `extension_id`. Returns the number of rows deleted so
/// uninstall / disable can log a one-line summary.
pub fn clear(conn: &Connection, extension_id: &str) -> Result<u64, AppError> {
    let count = conn
        .execute(
            "DELETE FROM extension_state WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| AppError::Database(format!("Failed to clear extension_state: {e}")))?;
    Ok(count as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    #[test]
    fn get_returns_none_for_unseen_key() {
        let conn = setup();
        assert!(get(&conn, "ext.a", "missing").unwrap().is_none());
    }

    #[test]
    fn set_then_get_round_trips_the_value() {
        let conn = setup();
        let v = serde_json::json!({ "seconds": 42, "running": true });
        set(&conn, "ext.a", "timer", &v, 10).unwrap();
        assert_eq!(get(&conn, "ext.a", "timer").unwrap(), Some(v));
    }

    #[test]
    fn set_upserts_and_keeps_the_latest_value() {
        let conn = setup();
        set(&conn, "ext.a", "k", &serde_json::json!(1), 10).unwrap();
        set(&conn, "ext.a", "k", &serde_json::json!(2), 20).unwrap();
        assert_eq!(get(&conn, "ext.a", "k").unwrap(), Some(serde_json::json!(2)));
    }

    #[test]
    fn clear_deletes_all_keys_for_the_extension_only() {
        let conn = setup();
        set(&conn, "ext.a", "k1", &serde_json::json!("v1"), 10).unwrap();
        set(&conn, "ext.a", "k2", &serde_json::json!("v2"), 10).unwrap();
        set(&conn, "ext.b", "k1", &serde_json::json!("other"), 10).unwrap();

        assert_eq!(clear(&conn, "ext.a").unwrap(), 2);
        assert!(get(&conn, "ext.a", "k1").unwrap().is_none());
        assert!(get(&conn, "ext.a", "k2").unwrap().is_none());
        // ext.b survives
        assert_eq!(
            get(&conn, "ext.b", "k1").unwrap(),
            Some(serde_json::json!("other"))
        );
    }

    #[test]
    fn init_table_is_idempotent() {
        // Guards "running the launcher twice does not error" — mirrors the
        // DataStore::initialize path which calls each module's init_table on
        // every boot. A reachable `CREATE TABLE IF NOT EXISTS` should no-op
        // the second time; any row written in between must still be there.
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        set(&conn, "ext.a", "k", &serde_json::json!("v"), 10).unwrap();
        init_table(&conn).unwrap();
        assert_eq!(
            get(&conn, "ext.a", "k").unwrap(),
            Some(serde_json::json!("v"))
        );
    }

    #[test]
    fn set_persists_null_and_scalar_values() {
        let conn = setup();
        set(&conn, "ext.a", "null", &serde_json::Value::Null, 0).unwrap();
        assert_eq!(get(&conn, "ext.a", "null").unwrap(), Some(serde_json::Value::Null));

        set(&conn, "ext.a", "num", &serde_json::json!(2.5), 0).unwrap();
        assert_eq!(get(&conn, "ext.a", "num").unwrap(), Some(serde_json::json!(2.5)));
    }

    #[test]
    fn get_all_returns_every_row_for_the_extension_only() {
        let conn = setup();
        set(&conn, "ext.a", "k1", &serde_json::json!(1), 100).unwrap();
        set(&conn, "ext.a", "k2", &serde_json::json!("two"), 200).unwrap();
        set(&conn, "ext.b", "k1", &serde_json::json!("other"), 300).unwrap();

        let mut rows = get_all(&conn, "ext.a").unwrap();
        rows.sort_by(|a, b| a.key.cmp(&b.key));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].key, "k1");
        assert_eq!(rows[0].value, serde_json::json!(1));
        assert_eq!(rows[0].updated_at, 100);
        assert_eq!(rows[1].key, "k2");
        assert_eq!(rows[1].value, serde_json::json!("two"));
        assert_eq!(rows[1].updated_at, 200);
    }

    #[test]
    fn get_all_returns_empty_for_unseen_extension() {
        let conn = setup();
        assert!(get_all(&conn, "ext.missing").unwrap().is_empty());
    }

    #[test]
    fn isolation_between_extensions_same_key() {
        let conn = setup();
        set(&conn, "ext.a", "shared", &serde_json::json!("a"), 0).unwrap();
        set(&conn, "ext.b", "shared", &serde_json::json!("b"), 0).unwrap();
        assert_eq!(
            get(&conn, "ext.a", "shared").unwrap(),
            Some(serde_json::json!("a"))
        );
        assert_eq!(
            get(&conn, "ext.b", "shared").unwrap(),
            Some(serde_json::json!("b"))
        );
    }
}
