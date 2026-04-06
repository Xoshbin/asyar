use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvEntry {
    pub key: String,
    pub value: String,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS extension_storage (
            extension_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (extension_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_ext_storage_ext_id
            ON extension_storage(extension_id);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init extension_storage table: {e}")))?;
    Ok(())
}

/// Get a single value by key for an extension.
pub fn get(conn: &Connection, extension_id: &str, key: &str) -> Result<Option<String>, AppError> {
    let result = conn.query_row(
        "SELECT value FROM extension_storage WHERE extension_id = ?1 AND key = ?2",
        params![extension_id, key],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to get kv: {e}"))),
    }
}

/// Set a key-value pair for an extension (upsert).
pub fn set(
    conn: &Connection,
    extension_id: &str,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO extension_storage (extension_id, key, value)
         VALUES (?1, ?2, ?3)",
        params![extension_id, key, value],
    )
    .map_err(|e| AppError::Database(format!("Failed to set kv: {e}")))?;
    Ok(())
}

/// Delete a single key for an extension. Returns true if a row was deleted.
pub fn delete(conn: &Connection, extension_id: &str, key: &str) -> Result<bool, AppError> {
    let count = conn
        .execute(
            "DELETE FROM extension_storage WHERE extension_id = ?1 AND key = ?2",
            params![extension_id, key],
        )
        .map_err(|e| AppError::Database(format!("Failed to delete kv: {e}")))?;
    Ok(count > 0)
}

/// Get all key-value pairs for an extension.
pub fn get_all(conn: &Connection, extension_id: &str) -> Result<Vec<KvEntry>, AppError> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM extension_storage WHERE extension_id = ?1 ORDER BY key")
        .map_err(|e| AppError::Database(format!("Failed to prepare kv query: {e}")))?;

    let entries = stmt
        .query_map(params![extension_id], |row| {
            Ok(KvEntry {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query kv: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

/// Delete all data for an extension (used during uninstall).
pub fn clear(conn: &Connection, extension_id: &str) -> Result<u64, AppError> {
    let count = conn
        .execute(
            "DELETE FROM extension_storage WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| AppError::Database(format!("Failed to clear kv: {e}")))?;
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
    fn test_set_and_get() {
        let conn = setup();
        set(&conn, "ext.todo", "theme", "\"dark\"").unwrap();

        let val = get(&conn, "ext.todo", "theme").unwrap();
        assert_eq!(val.as_deref(), Some("\"dark\""));
    }

    #[test]
    fn test_get_missing_key() {
        let conn = setup();
        let val = get(&conn, "ext.todo", "missing").unwrap();
        assert!(val.is_none());
    }

    #[test]
    fn test_upsert_replaces() {
        let conn = setup();
        set(&conn, "ext.todo", "count", "1").unwrap();
        set(&conn, "ext.todo", "count", "2").unwrap();

        let val = get(&conn, "ext.todo", "count").unwrap();
        assert_eq!(val.as_deref(), Some("2"));
    }

    #[test]
    fn test_delete_returns_true_when_exists() {
        let conn = setup();
        set(&conn, "ext.todo", "key", "val").unwrap();

        assert!(delete(&conn, "ext.todo", "key").unwrap());
        assert!(!delete(&conn, "ext.todo", "key").unwrap()); // already gone
    }

    #[test]
    fn test_get_all_returns_only_own_keys() {
        let conn = setup();
        set(&conn, "ext.a", "k1", "v1").unwrap();
        set(&conn, "ext.a", "k2", "v2").unwrap();
        set(&conn, "ext.b", "k1", "other").unwrap();

        let entries = get_all(&conn, "ext.a").unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].key, "k1");
        assert_eq!(entries[1].key, "k2");
    }

    #[test]
    fn test_clear_deletes_all_for_extension() {
        let conn = setup();
        set(&conn, "ext.a", "k1", "v1").unwrap();
        set(&conn, "ext.a", "k2", "v2").unwrap();
        set(&conn, "ext.b", "k1", "safe").unwrap();

        let count = clear(&conn, "ext.a").unwrap();
        assert_eq!(count, 2);

        let remaining = get_all(&conn, "ext.a").unwrap();
        assert_eq!(remaining.len(), 0);

        // ext.b is untouched
        let b_val = get(&conn, "ext.b", "k1").unwrap();
        assert_eq!(b_val.as_deref(), Some("safe"));
    }

    #[test]
    fn test_isolation_between_extensions() {
        let conn = setup();
        set(&conn, "ext.a", "shared_key", "a_value").unwrap();
        set(&conn, "ext.b", "shared_key", "b_value").unwrap();

        assert_eq!(get(&conn, "ext.a", "shared_key").unwrap().as_deref(), Some("a_value"));
        assert_eq!(get(&conn, "ext.b", "shared_key").unwrap().as_deref(), Some("b_value"));
    }
}
