use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemShortcut {
    pub id: String,
    pub object_id: String,
    pub item_name: String,
    pub item_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_path: Option<String>,
    pub shortcut: String,
    pub created_at: f64,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS shortcuts (
            id TEXT PRIMARY KEY,
            object_id TEXT NOT NULL UNIQUE,
            item_name TEXT NOT NULL,
            item_type TEXT NOT NULL,
            item_path TEXT,
            shortcut TEXT NOT NULL,
            created_at REAL NOT NULL
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init shortcuts table: {e}")))?;
    Ok(())
}

/// Insert or replace a shortcut (upsert by object_id).
pub fn upsert(conn: &Connection, shortcut: &ItemShortcut) -> Result<(), AppError> {
    // Remove any existing entry with the same object_id first (handles id change)
    conn.execute(
        "DELETE FROM shortcuts WHERE object_id = ?1 AND id != ?2",
        params![shortcut.object_id, shortcut.id],
    )
    .map_err(|e| AppError::Database(format!("Failed to cleanup old shortcut: {e}")))?;

    conn.execute(
        "INSERT OR REPLACE INTO shortcuts
            (id, object_id, item_name, item_type, item_path, shortcut, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            shortcut.id,
            shortcut.object_id,
            shortcut.item_name,
            shortcut.item_type,
            shortcut.item_path,
            shortcut.shortcut,
            shortcut.created_at,
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to upsert shortcut: {e}")))?;
    Ok(())
}

/// Update specific fields of a shortcut by object_id.
pub fn update(
    conn: &Connection,
    object_id: &str,
    item_name: Option<&str>,
    item_path: Option<&str>,
    shortcut_str: Option<&str>,
) -> Result<(), AppError> {
    let mut sets = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(v) = item_name {
        sets.push("item_name = ?");
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = item_path {
        sets.push("item_path = ?");
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = shortcut_str {
        sets.push("shortcut = ?");
        values.push(Box::new(v.to_string()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    let sql = format!(
        "UPDATE shortcuts SET {} WHERE object_id = ?",
        sets.join(", ")
    );
    values.push(Box::new(object_id.to_string()));

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    conn.execute(&sql, params.as_slice())
        .map_err(|e| AppError::Database(format!("Failed to update shortcut: {e}")))?;
    Ok(())
}

/// Delete a shortcut by object_id.
pub fn remove(conn: &Connection, object_id: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM shortcuts WHERE object_id = ?1",
        params![object_id],
    )
    .map_err(|e| AppError::Database(format!("Failed to delete shortcut: {e}")))?;
    Ok(())
}

/// Get all shortcuts.
pub fn get_all(conn: &Connection) -> Result<Vec<ItemShortcut>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, object_id, item_name, item_type, item_path, shortcut, created_at
             FROM shortcuts ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare query: {e}")))?;

    let items = stmt
        .query_map([], |row| {
            Ok(ItemShortcut {
                id: row.get(0)?,
                object_id: row.get(1)?,
                item_name: row.get(2)?,
                item_type: row.get(3)?,
                item_path: row.get(4)?,
                shortcut: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query shortcuts: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

/// Migrate legacy shortcuts.dat data into SQLite.
pub fn migrate_legacy(conn: &Connection, data_dir: &std::path::Path) -> Result<(), AppError> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM shortcuts", [], |row| row.get(0))
        .unwrap_or(0);
    if count > 0 {
        return Ok(());
    }

    let legacy_path = data_dir.join("shortcuts.dat");
    if !legacy_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&legacy_path)
        .map_err(|e| AppError::Database(format!("Failed to read legacy shortcuts file: {e}")))?;

    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Database(format!("Failed to parse legacy shortcuts: {e}")))?;

    // Tauri plugin-store format: { "asyar:item-shortcuts": [...] }
    let items_val = parsed
        .get("asyar:item-shortcuts")
        .and_then(|v| v.as_array());

    if let Some(items) = items_val {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| AppError::Database(format!("Transaction error: {e}")))?;

        for item_val in items {
            if let Ok(shortcut) = serde_json::from_value::<ItemShortcut>(item_val.clone()) {
                let _ = upsert(&tx, &shortcut);
            }
        }

        tx.commit()
            .map_err(|e| AppError::Database(format!("Commit error: {e}")))?;

        log::info!(
            "Migrated {} shortcuts from legacy .dat to SQLite",
            items.len()
        );

        let backup_path = data_dir.join("shortcuts.dat.bak");
        let _ = std::fs::rename(&legacy_path, &backup_path);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    fn make_shortcut(id: &str, object_id: &str, shortcut: &str) -> ItemShortcut {
        ItemShortcut {
            id: id.to_string(),
            object_id: object_id.to_string(),
            item_name: format!("Item {object_id}"),
            item_type: "application".to_string(),
            item_path: Some("/usr/bin/test".to_string()),
            shortcut: shortcut.to_string(),
            created_at: 1000.0 + id.parse::<f64>().unwrap_or(0.0),
        }
    }

    #[test]
    fn test_upsert_and_get_all() {
        let conn = setup();
        upsert(&conn, &make_shortcut("1", "obj_a", "Alt+1")).unwrap();
        upsert(&conn, &make_shortcut("2", "obj_b", "Alt+2")).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "2"); // newest first
    }

    #[test]
    fn test_upsert_replaces_by_object_id() {
        let conn = setup();
        upsert(&conn, &make_shortcut("1", "obj_a", "Alt+1")).unwrap();
        upsert(&conn, &make_shortcut("1", "obj_a", "Alt+9")).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].shortcut, "Alt+9");
    }

    #[test]
    fn test_remove() {
        let conn = setup();
        upsert(&conn, &make_shortcut("1", "obj_a", "Alt+1")).unwrap();
        upsert(&conn, &make_shortcut("2", "obj_b", "Alt+2")).unwrap();

        remove(&conn, "obj_a").unwrap();
        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].object_id, "obj_b");
    }

    #[test]
    fn test_update_partial() {
        let conn = setup();
        upsert(&conn, &make_shortcut("1", "obj_a", "Alt+1")).unwrap();

        update(&conn, "obj_a", Some("New Name"), None, Some("Ctrl+1")).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items[0].item_name, "New Name");
        assert_eq!(items[0].shortcut, "Ctrl+1");
        assert_eq!(items[0].item_path.as_deref(), Some("/usr/bin/test")); // unchanged
    }
}
