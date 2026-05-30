//! Launcher-wide MCP feature settings. Singleton row, schema migrated via
//! `init_table` like every other storage module. Currently holds only
//! `strict_mode` — when on, every MCP tool call prompts the user on first
//! use, regardless of whether the tool name matches a read-only prefix.

use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};

/// Idempotent: creates the mcp_settings table and seeds the single row if
/// it's not yet present. Mirrors the shape used by other singleton tables
/// (one row, no auto-increment, keyed by a constant).
pub(crate) fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS mcp_settings (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            strict_mode INTEGER NOT NULL DEFAULT 0
         );
         INSERT OR IGNORE INTO mcp_settings (id, strict_mode) VALUES (1, 0);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init mcp_settings table: {e}")))?;
    Ok(())
}

/// Read the current strict-mode flag. Defaults to `false` if the row is
/// somehow missing (defensive — the seed in `init_table` should prevent it).
pub fn get_strict_mode(conn: &Connection) -> Result<bool, AppError> {
    let value: Option<i64> = conn
        .query_row(
            "SELECT strict_mode FROM mcp_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(value.unwrap_or(0) != 0)
}

/// Update the strict-mode flag. Caller decides when to flip it.
pub fn set_strict_mode(conn: &Connection, enabled: bool) -> Result<(), AppError> {
    conn.execute(
        "UPDATE mcp_settings SET strict_mode = ?1 WHERE id = 1",
        params![if enabled { 1 } else { 0 }],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_table(&conn).unwrap();
        conn
    }

    #[test]
    fn strict_mode_defaults_to_false_on_fresh_db() {
        let conn = make_conn();
        assert!(!get_strict_mode(&conn).unwrap());
    }

    #[test]
    fn set_then_get_round_trips() {
        let conn = make_conn();
        set_strict_mode(&conn, true).unwrap();
        assert!(get_strict_mode(&conn).unwrap());
        set_strict_mode(&conn, false).unwrap();
        assert!(!get_strict_mode(&conn).unwrap());
    }

    #[test]
    fn init_is_idempotent() {
        let conn = make_conn();
        set_strict_mode(&conn, true).unwrap();
        init_table(&conn).unwrap();
        // The row's value must survive re-init (INSERT OR IGNORE preserves it).
        assert!(get_strict_mode(&conn).unwrap());
    }
}
