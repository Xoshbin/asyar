//! Per-extension onboarded-state persistence. Mirrors the shape of
//! `storage::extension_kv` — same DB connection, same locking pattern.

use crate::error::AppError;
use rusqlite::{params, Connection};

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS extension_onboarding (
            extension_id TEXT PRIMARY KEY,
            completed_at INTEGER NOT NULL
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init extension_onboarding table: {e}")))?;
    Ok(())
}

pub fn mark_onboarded(conn: &Connection, extension_id: &str, now: i64) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO extension_onboarding (extension_id, completed_at)
         VALUES (?1, ?2)
         ON CONFLICT(extension_id) DO UPDATE SET completed_at = excluded.completed_at",
        params![extension_id, now],
    )
    .map_err(|e| AppError::Database(format!("Failed to mark_onboarded: {e}")))?;
    Ok(())
}

pub fn is_onboarded(conn: &Connection, extension_id: &str) -> Result<bool, AppError> {
    let mut stmt = conn
        .prepare("SELECT 1 FROM extension_onboarding WHERE extension_id = ?1 LIMIT 1")
        .map_err(|e| AppError::Database(format!("Failed to prepare is_onboarded: {e}")))?;
    let mut rows = stmt
        .query(params![extension_id])
        .map_err(|e| AppError::Database(format!("Failed to query is_onboarded: {e}")))?;
    Ok(rows
        .next()
        .map_err(|e| AppError::Database(format!("Failed to read is_onboarded row: {e}")))?
        .is_some())
}

pub fn clear(conn: &Connection, extension_id: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM extension_onboarding WHERE extension_id = ?1",
        params![extension_id],
    )
    .map_err(|e| AppError::Database(format!("Failed to clear onboarding: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    #[test]
    fn is_onboarded_returns_false_for_unknown_extension() {
        let c = fresh_conn();
        assert!(!is_onboarded(&c, "ext.unknown").unwrap());
    }

    #[test]
    fn mark_then_is_onboarded() {
        let c = fresh_conn();
        mark_onboarded(&c, "ext.a", 1234).unwrap();
        assert!(is_onboarded(&c, "ext.a").unwrap());
    }

    #[test]
    fn mark_is_idempotent() {
        let c = fresh_conn();
        mark_onboarded(&c, "ext.a", 1).unwrap();
        mark_onboarded(&c, "ext.a", 2).unwrap();
        assert!(is_onboarded(&c, "ext.a").unwrap());
    }

    #[test]
    fn clear_removes_row() {
        let c = fresh_conn();
        mark_onboarded(&c, "ext.a", 1).unwrap();
        clear(&c, "ext.a").unwrap();
        assert!(!is_onboarded(&c, "ext.a").unwrap());
    }

    #[test]
    fn clear_unknown_is_noop() {
        let c = fresh_conn();
        clear(&c, "ext.never-onboarded").unwrap();
    }

    #[test]
    fn init_table_is_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        init_table(&c).unwrap();
        init_table(&c).unwrap();
    }
}
