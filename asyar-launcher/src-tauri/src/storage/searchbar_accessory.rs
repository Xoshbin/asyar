use crate::error::AppError;
use rusqlite::{params, Connection};

/// Persistence for the per-command searchbar accessory dropdown's
/// selected value.
///
/// Single row per `(extension_id, command_id)`. Values are opaque
/// strings — mapping the stored value back to the dropdown's declared
/// options (and falling back to the manifest `default` when the stored
/// value is no longer in `options[]`) is the caller's concern.
///
/// Cleared on extension uninstall by the lifecycle hook.
pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS searchbar_accessory_state (
            extension_id TEXT NOT NULL,
            command_id   TEXT NOT NULL,
            value        TEXT NOT NULL,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY (extension_id, command_id)
        );
        CREATE INDEX IF NOT EXISTS idx_searchbar_accessory_extension
            ON searchbar_accessory_state(extension_id);",
    )
    .map_err(|e| {
        AppError::Database(format!(
            "Failed to init searchbar_accessory_state table: {e}"
        ))
    })?;
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Return the stored value for `(extension_id, command_id)` or `None`
/// if nothing has been stored yet.
pub fn get(
    conn: &Connection,
    extension_id: &str,
    command_id: &str,
) -> Result<Option<String>, AppError> {
    let result = conn.query_row(
        "SELECT value FROM searchbar_accessory_state
         WHERE extension_id = ?1 AND command_id = ?2",
        params![extension_id, command_id],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!(
            "Failed to get searchbar accessory value: {e}"
        ))),
    }
}

/// Upsert the stored value for `(extension_id, command_id)`.
pub fn set(
    conn: &Connection,
    extension_id: &str,
    command_id: &str,
    value: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO searchbar_accessory_state (extension_id, command_id, value, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(extension_id, command_id) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at",
        params![extension_id, command_id, value, now_millis()],
    )
    .map_err(|e| {
        AppError::Database(format!("Failed to set searchbar accessory value: {e}"))
    })?;
    Ok(())
}

/// Remove every persisted row for this extension — called on uninstall
/// so a reinstall doesn't leak the previous lifetime's accessory state.
/// Returns the number of rows removed.
pub fn clear_for_extension(conn: &Connection, extension_id: &str) -> Result<u64, AppError> {
    let count = conn
        .execute(
            "DELETE FROM searchbar_accessory_state WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| {
            AppError::Database(format!("Failed to clear searchbar accessory state: {e}"))
        })?;
    Ok(count as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    #[test]
    fn init_creates_table() {
        let conn = mem_conn();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='searchbar_accessory_state'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn get_returns_none_when_no_row() {
        let conn = mem_conn();
        assert_eq!(get(&conn, "ext", "cmd").unwrap(), None);
    }

    #[test]
    fn set_then_get_roundtrip() {
        let conn = mem_conn();
        set(&conn, "ext-a", "cmd-1", "images").unwrap();
        assert_eq!(get(&conn, "ext-a", "cmd-1").unwrap(), Some("images".to_string()));
    }

    #[test]
    fn set_overwrites_existing_row() {
        let conn = mem_conn();
        set(&conn, "ext", "cmd", "a").unwrap();
        set(&conn, "ext", "cmd", "b").unwrap();
        assert_eq!(get(&conn, "ext", "cmd").unwrap(), Some("b".to_string()));
    }

    #[test]
    fn get_is_scoped_by_extension_and_command() {
        let conn = mem_conn();
        set(&conn, "ext-a", "cmd-1", "x").unwrap();
        set(&conn, "ext-a", "cmd-2", "y").unwrap();
        set(&conn, "ext-b", "cmd-1", "z").unwrap();
        assert_eq!(get(&conn, "ext-a", "cmd-1").unwrap(), Some("x".to_string()));
        assert_eq!(get(&conn, "ext-a", "cmd-2").unwrap(), Some("y".to_string()));
        assert_eq!(get(&conn, "ext-b", "cmd-1").unwrap(), Some("z".to_string()));
    }

    #[test]
    fn clear_for_extension_removes_only_that_extensions_rows() {
        let conn = mem_conn();
        set(&conn, "ext-a", "cmd-1", "x").unwrap();
        set(&conn, "ext-a", "cmd-2", "y").unwrap();
        set(&conn, "ext-b", "cmd-1", "z").unwrap();

        let removed = clear_for_extension(&conn, "ext-a").unwrap();
        assert_eq!(removed, 2);
        assert_eq!(get(&conn, "ext-a", "cmd-1").unwrap(), None);
        assert_eq!(get(&conn, "ext-a", "cmd-2").unwrap(), None);
        assert_eq!(get(&conn, "ext-b", "cmd-1").unwrap(), Some("z".to_string()));
    }

    #[test]
    fn clear_for_extension_returns_zero_when_no_rows() {
        let conn = mem_conn();
        assert_eq!(clear_for_extension(&conn, "missing").unwrap(), 0);
    }
}
