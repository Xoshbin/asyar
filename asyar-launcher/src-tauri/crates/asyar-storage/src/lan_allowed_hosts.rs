use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanAllowedHost {
    pub id: String,
    pub extension_id: String,
    pub host: String,
    pub port: u16,
    pub label: String,
    pub created_at: i64,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS lan_allowed_hosts (
            id           TEXT    NOT NULL PRIMARY KEY,
            extension_id TEXT    NOT NULL,
            host         TEXT    NOT NULL,
            port         INTEGER NOT NULL,
            label        TEXT    NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL,
            UNIQUE (extension_id, host, port)
        );
        CREATE INDEX IF NOT EXISTS idx_lan_hosts_extension
            ON lan_allowed_hosts(extension_id);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init lan_allowed_hosts: {e}")))?;
    Ok(())
}

pub fn list(conn: &Connection, extension_id: &str) -> Result<Vec<LanAllowedHost>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, extension_id, host, port, label, created_at
         FROM lan_allowed_hosts WHERE extension_id = ?1
         ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map(params![extension_id], |row| {
            Ok(LanAllowedHost {
                id: row.get(0)?,
                extension_id: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, u32>(3)? as u16,
                label: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn add(
    conn: &Connection,
    extension_id: &str,
    host: &str,
    port: u16,
    label: &str,
) -> Result<LanAllowedHost, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_millis();
    conn.execute(
        "INSERT INTO lan_allowed_hosts (id, extension_id, host, port, label, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(extension_id, host, port) DO NOTHING",
        params![id, extension_id, host, port as u32, label, now],
    )?;
    let row = conn.query_row(
        "SELECT id, extension_id, host, port, label, created_at
         FROM lan_allowed_hosts WHERE extension_id = ?1 AND host = ?2 AND port = ?3",
        params![extension_id, host, port as u32],
        |row| {
            Ok(LanAllowedHost {
                id: row.get(0)?,
                extension_id: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, u32>(3)? as u16,
                label: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )?;
    Ok(row)
}

pub fn remove(
    conn: &Connection,
    extension_id: &str,
    host: &str,
    port: u16,
) -> Result<bool, AppError> {
    let n = conn.execute(
        "DELETE FROM lan_allowed_hosts WHERE extension_id = ?1 AND host = ?2 AND port = ?3",
        params![extension_id, host, port as u32],
    )?;
    Ok(n > 0)
}

pub fn clear_for_extension(conn: &Connection, extension_id: &str) -> Result<u64, AppError> {
    let n = conn.execute(
        "DELETE FROM lan_allowed_hosts WHERE extension_id = ?1",
        params![extension_id],
    )?;
    Ok(n as u64)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    #[test]
    fn add_and_list_round_trip() {
        let conn = setup();
        let row = add(&conn, "org.test", "ha.local", 8123, "Home Assistant").unwrap();
        assert_eq!(row.host, "ha.local");
        assert_eq!(row.port, 8123);
        let list = list(&conn, "org.test").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].host, "ha.local");
    }

    #[test]
    fn duplicate_add_is_idempotent() {
        let conn = setup();
        add(&conn, "org.test", "ha.local", 8123, "HA").unwrap();
        let second = add(&conn, "org.test", "ha.local", 8123, "HA").unwrap();
        assert_eq!(second.host, "ha.local");
        let list = list(&conn, "org.test").unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn remove_returns_true_when_deleted() {
        let conn = setup();
        add(&conn, "org.test", "ha.local", 8123, "HA").unwrap();
        let deleted = remove(&conn, "org.test", "ha.local", 8123).unwrap();
        assert!(deleted);
        assert!(list(&conn, "org.test").unwrap().is_empty());
    }

    #[test]
    fn remove_returns_false_when_not_found() {
        let conn = setup();
        let deleted = remove(&conn, "org.test", "ha.local", 8123).unwrap();
        assert!(!deleted);
    }

    #[test]
    fn list_is_scoped_to_extension() {
        let conn = setup();
        add(&conn, "org.a", "ha.local", 8123, "HA").unwrap();
        add(&conn, "org.b", "sonos.local", 1400, "Sonos").unwrap();
        assert_eq!(list(&conn, "org.a").unwrap().len(), 1);
        assert_eq!(list(&conn, "org.b").unwrap().len(), 1);
        assert!(list(&conn, "org.c").unwrap().is_empty());
    }

    #[test]
    fn clear_for_extension_removes_only_that_extension() {
        let conn = setup();
        add(&conn, "org.a", "ha.local", 8123, "HA").unwrap();
        add(&conn, "org.b", "sonos.local", 1400, "Sonos").unwrap();
        let count = clear_for_extension(&conn, "org.a").unwrap();
        assert_eq!(count, 1);
        assert!(list(&conn, "org.a").unwrap().is_empty());
        assert_eq!(list(&conn, "org.b").unwrap().len(), 1);
    }
}
