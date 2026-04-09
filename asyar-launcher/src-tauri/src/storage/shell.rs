use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedBinary {
    pub binary_path: String,
    pub trusted_at: i64,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS shell_trusted_binaries (
            extension_id  TEXT NOT NULL,
            binary_path   TEXT NOT NULL,
            trusted_at    INTEGER NOT NULL,
            PRIMARY KEY (extension_id, binary_path)
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init shell_trusted_binaries table: {e}")))?;
    Ok(())
}

pub fn is_trusted(conn: &Connection, extension_id: &str, binary_path: &str) -> Result<bool, AppError> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM shell_trusted_binaries WHERE extension_id = ?1 AND binary_path = ?2",
        params![extension_id, binary_path],
        |row| row.get(0),
    ).map_err(|e| AppError::Database(format!("Failed to check trust: {e}")))?;
    Ok(count > 0)
}

pub fn grant_trust(conn: &Connection, extension_id: &str, binary_path: &str) -> Result<(), AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT OR REPLACE INTO shell_trusted_binaries (extension_id, binary_path, trusted_at) VALUES (?1, ?2, ?3)",
        params![extension_id, binary_path, now],
    ).map_err(|e| AppError::Database(format!("Failed to grant trust: {e}")))?;
    Ok(())
}

pub fn revoke_trust(conn: &Connection, extension_id: &str, binary_path: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM shell_trusted_binaries WHERE extension_id = ?1 AND binary_path = ?2",
        params![extension_id, binary_path],
    ).map_err(|e| AppError::Database(format!("Failed to revoke trust: {e}")))?;
    Ok(())
}

pub fn list_trusted(conn: &Connection, extension_id: &str) -> Result<Vec<TrustedBinary>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT binary_path, trusted_at FROM shell_trusted_binaries WHERE extension_id = ?1 ORDER BY trusted_at DESC"
    ).map_err(|e| AppError::Database(format!("Failed to prepare list_trusted: {e}")))?;

    let iter = stmt.query_map(params![extension_id], |row| {
        Ok(TrustedBinary {
            binary_path: row.get(0)?,
            trusted_at: row.get(1)?,
        })
    }).map_err(|e| AppError::Database(format!("Failed to query trusted binaries: {e}")))?;

    let mut results = Vec::new();
    for item in iter {
        results.push(item.map_err(|e| AppError::Database(format!("Row error: {e}")))?);
    }
    Ok(results)
}

pub fn cleanup_extension(conn: &Connection, extension_id: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM shell_trusted_binaries WHERE extension_id = ?1",
        params![extension_id],
    ).map_err(|e| AppError::Database(format!("Failed to cleanup shell trust for extension: {e}")))?;
    Ok(())
}
