use crate::error::AppError;
use rusqlite::{params, Connection};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS extension_cache (
            extension_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            expires_at INTEGER,
            PRIMARY KEY (extension_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_ext_cache_ext_id
            ON extension_cache(extension_id);
        CREATE INDEX IF NOT EXISTS idx_ext_cache_expiry
            ON extension_cache(expires_at);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init extension_cache table: {e}")))?;
    Ok(())
}

/// Get a single value by key for an extension.
/// Returns None if missing or expired.
pub fn get(conn: &Connection, extension_id: &str, key: &str) -> Result<Option<String>, AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let result = conn.query_row(
        "SELECT value, expires_at FROM extension_cache 
         WHERE extension_id = ?1 AND key = ?2",
        params![extension_id, key],
        |row| {
            let value: String = row.get(0)?;
            let expires_at: Option<u64> = row.get(1)?;
            Ok((value, expires_at))
        },
    );

    match result {
        Ok((val, expires_at)) => {
            if let Some(expiry) = expires_at {
                if expiry < now {
                    // Lazy cleanup
                    let _ = conn.execute(
                        "DELETE FROM extension_cache WHERE extension_id = ?1 AND key = ?2",
                        params![extension_id, key],
                    );
                    return Ok(None);
                }
            }
            Ok(Some(val))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to get cache: {e}"))),
    }
}

/// Set a key-value pair for an extension (upsert) with an optional expiry.
pub fn set(
    conn: &Connection,
    extension_id: &str,
    key: &str,
    value: &str,
    expires_at: Option<u64>,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO extension_cache (extension_id, key, value, expires_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![extension_id, key, value, expires_at],
    )
    .map_err(|e| AppError::Database(format!("Failed to set cache: {e}")))?;
    Ok(())
}

/// Delete a single key for an extension.
pub fn delete(conn: &Connection, extension_id: &str, key: &str) -> Result<bool, AppError> {
    let count = conn
        .execute(
            "DELETE FROM extension_cache WHERE extension_id = ?1 AND key = ?2",
            params![extension_id, key],
        )
        .map_err(|e| AppError::Database(format!("Failed to delete cache: {e}")))?;
    Ok(count > 0)
}

/// Clear all cache for an extension.
pub fn clear(conn: &Connection, extension_id: &str) -> Result<u64, AppError> {
    let count = conn
        .execute(
            "DELETE FROM extension_cache WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| AppError::Database(format!("Failed to clear cache: {e}")))?;
    Ok(count as u64)
}

/// Prune all expired entries from the cache globally.
pub fn prune_all_expired(conn: &Connection) -> Result<u64, AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let count = conn
        .execute(
            "DELETE FROM extension_cache WHERE expires_at IS NOT NULL AND expires_at < ?1",
            params![now],
        )
        .map_err(|e| AppError::Database(format!("Failed to prune cache: {e}")))?;
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

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    #[test]
    fn test_set_and_get_unexpired() {
        let conn = setup();
        let ext = "test.ext";
        set(&conn, ext, "k1", "v1", Some(now() + 100)).unwrap();
        
        let val = get(&conn, ext, "k1").unwrap();
        assert_eq!(val, Some("v1".to_string()));
    }

    #[test]
    fn test_get_expired_returns_none() {
        let conn = setup();
        let ext = "test.ext";
        // Set with expiry in the past
        set(&conn, ext, "k1", "v1", Some(now() - 10)).unwrap();
        
        let val = get(&conn, ext, "k1").unwrap();
        assert!(val.is_none());
    }

    #[test]
    fn test_get_no_expiry_returns_value() {
        let conn = setup();
        let ext = "test.ext";
        set(&conn, ext, "k1", "v1", None).unwrap();
        
        let val = get(&conn, ext, "k1").unwrap();
        assert_eq!(val, Some("v1".to_string()));
    }

    #[test]
    fn test_delete_isolation() {
        let conn = setup();
        set(&conn, "ext.a", "k1", "v1", None).unwrap();
        set(&conn, "ext.b", "k1", "v1", None).unwrap();
        
        delete(&conn, "ext.a", "k1").unwrap();
        
        assert!(get(&conn, "ext.a", "k1").unwrap().is_none());
        assert!(get(&conn, "ext.b", "k1").unwrap().is_some());
    }

    #[test]
    fn test_clear_extension() {
        let conn = setup();
        set(&conn, "ext.a", "k1", "v1", None).unwrap();
        set(&conn, "ext.a", "k2", "v2", None).unwrap();
        set(&conn, "ext.b", "k1", "v1", None).unwrap();

        let count = clear(&conn, "ext.a").unwrap();
        assert_eq!(count, 2);

        assert!(get(&conn, "ext.a", "k1").unwrap().is_none());
        assert!(get(&conn, "ext.a", "k2").unwrap().is_none());
        assert!(get(&conn, "ext.b", "k1").unwrap().is_some());
    }

    #[test]
    fn test_prune_all_expired() {
        let conn = setup();
        set(&conn, "ext.a", "exp", "v", Some(now() - 10)).unwrap();
        set(&conn, "ext.a", "live", "v", Some(now() + 100)).unwrap();
        
        let pruned = prune_all_expired(&conn).unwrap();
        assert_eq!(pruned, 1);
        
        assert!(get(&conn, "ext.a", "exp").unwrap().is_none());
        assert!(get(&conn, "ext.a", "live").unwrap().is_some());
    }
}
