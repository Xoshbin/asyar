use crate::error::AppError;
use rusqlite::{params, Connection};

/// Persistence for user-configured script directories.
///
/// Stores the set of filesystem paths the user has added via Settings → Scripts.
/// Each path is stored once; adding the same path a second time is silently
/// ignored. Rows are returned in insertion order (added_at ASC) so the UI
/// shows a stable, deterministic list.
pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS script_directories (
            path     TEXT PRIMARY KEY,
            added_at INTEGER NOT NULL
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init script_directories table: {e}")))?;
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Add a directory path. If the path is already present the call is a no-op.
pub fn add(conn: &Connection, path: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR IGNORE INTO script_directories (path, added_at) VALUES (?1, ?2)",
        params![path, now_millis()],
    )
    .map_err(|e| AppError::Database(format!("Failed to add script directory: {e}")))?;
    Ok(())
}

/// Remove a directory path. If the path is not present the call is a no-op.
pub fn remove(conn: &Connection, path: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM script_directories WHERE path = ?1",
        params![path],
    )
    .map_err(|e| AppError::Database(format!("Failed to remove script directory: {e}")))?;
    Ok(())
}

/// Return all configured directories sorted by added_at ASC.
pub fn list(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut stmt = conn
        .prepare("SELECT path FROM script_directories ORDER BY added_at ASC")
        .map_err(|e| AppError::Database(format!("Failed to list script directories: {e}")))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Database(format!("Failed to list script directories: {e}")))?;
    let mut paths = Vec::new();
    for r in rows {
        paths.push(
            r.map_err(|e| AppError::Database(format!("Failed to read script directory row: {e}")))?,
        );
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    #[test]
    fn init_table_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        init_table(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='script_directories'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn add_then_list_returns_path() {
        let conn = make_conn();
        add(&conn, "/foo").unwrap();
        let result = list(&conn).unwrap();
        assert_eq!(result, vec!["/foo".to_string()]);
    }

    #[test]
    fn add_same_path_twice_is_idempotent() {
        let conn = make_conn();
        add(&conn, "/foo").unwrap();
        add(&conn, "/foo").unwrap();
        let result = list(&conn).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "/foo");
    }

    #[test]
    fn add_two_paths_returns_both_in_added_order() {
        let conn = make_conn();
        add(&conn, "/a").unwrap();
        add(&conn, "/b").unwrap();
        let result = list(&conn).unwrap();
        assert_eq!(result, vec!["/a".to_string(), "/b".to_string()]);
    }

    #[test]
    fn remove_existing_path() {
        let conn = make_conn();
        add(&conn, "/foo").unwrap();
        remove(&conn, "/foo").unwrap();
        let result = list(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn remove_unknown_path_no_error() {
        let conn = make_conn();
        let result = remove(&conn, "/never-added");
        assert!(result.is_ok());
    }

    #[test]
    fn list_empty_when_no_rows() {
        let conn = make_conn();
        let result = list(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn add_three_paths_list_returns_three() {
        let conn = make_conn();
        add(&conn, "/x").unwrap();
        add(&conn, "/y").unwrap();
        add(&conn, "/z").unwrap();
        let result = list(&conn).unwrap();
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn paths_with_unicode_round_trip() {
        let conn = make_conn();
        let path = "/Users/имя/scripts";
        add(&conn, path).unwrap();
        let result = list(&conn).unwrap();
        assert_eq!(result, vec![path.to_string()]);
    }
}
