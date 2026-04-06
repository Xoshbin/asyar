use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub created_at: f64,
    pub favorite: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clipboard_items (
            id TEXT PRIMARY KEY,
            item_type TEXT NOT NULL,
            content TEXT,
            preview TEXT,
            created_at REAL NOT NULL,
            favorite INTEGER NOT NULL DEFAULT 0,
            metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_clipboard_created_at
            ON clipboard_items(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clipboard_favorite
            ON clipboard_items(favorite);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init clipboard table: {e}")))?;
    Ok(())
}

/// Insert or replace a clipboard item (upsert by id).
pub fn add_item(conn: &Connection, item: &ClipboardItem) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO clipboard_items
            (id, item_type, content, preview, created_at, favorite, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            item.id,
            item.item_type,
            item.content,
            item.preview,
            item.created_at,
            item.favorite as i32,
            item.metadata.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()),
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to add clipboard item: {e}")))?;
    Ok(())
}

/// Get all clipboard items ordered by created_at DESC.
pub fn get_all(conn: &Connection) -> Result<Vec<ClipboardItem>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, item_type, content, preview, created_at, favorite, metadata
             FROM clipboard_items
             ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare query: {e}")))?;

    let items = stmt
        .query_map([], |row| {
            let metadata_str: Option<String> = row.get(6)?;
            Ok(ClipboardItem {
                id: row.get(0)?,
                item_type: row.get(1)?,
                content: row.get(2)?,
                preview: row.get(3)?,
                created_at: row.get(4)?,
                favorite: row.get::<_, i32>(5)? != 0,
                metadata: metadata_str
                    .and_then(|s| serde_json::from_str(&s).ok()),
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query clipboard items: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

/// Toggle the favorite status of an item. Returns the new favorite value.
pub fn toggle_favorite(conn: &Connection, id: &str) -> Result<bool, AppError> {
    conn.execute(
        "UPDATE clipboard_items SET favorite = 1 - favorite WHERE id = ?1",
        params![id],
    )
    .map_err(|e| AppError::Database(format!("Failed to toggle favorite: {e}")))?;

    // Return the new value
    let new_val: bool = conn
        .query_row(
            "SELECT favorite FROM clipboard_items WHERE id = ?1",
            params![id],
            |row| Ok(row.get::<_, i32>(0)? != 0),
        )
        .map_err(|e| AppError::Database(format!("Failed to read favorite: {e}")))?;

    Ok(new_val)
}

/// Delete a single clipboard item.
pub fn delete_item(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
        .map_err(|e| AppError::Database(format!("Failed to delete clipboard item: {e}")))?;
    Ok(())
}

/// Delete all non-favorite items.
pub fn clear_non_favorites(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM clipboard_items WHERE favorite = 0", [])
        .map_err(|e| AppError::Database(format!("Failed to clear clipboard: {e}")))?;
    Ok(())
}

/// Remove items older than max_age_ms that are not favorited, and enforce a max item count.
pub fn cleanup(conn: &Connection, max_age_ms: f64, max_items: usize) -> Result<(), AppError> {
    let cutoff = js_sys_now() - max_age_ms;

    // Remove expired non-favorite items
    conn.execute(
        "DELETE FROM clipboard_items WHERE favorite = 0 AND created_at < ?1",
        params![cutoff],
    )
    .map_err(|e| AppError::Database(format!("Failed to cleanup old items: {e}")))?;

    // Enforce max count: keep only the newest max_items rows
    conn.execute(
        "DELETE FROM clipboard_items WHERE id NOT IN (
            SELECT id FROM clipboard_items ORDER BY created_at DESC LIMIT ?1
        )",
        params![max_items as i64],
    )
    .map_err(|e| AppError::Database(format!("Failed to enforce max items: {e}")))?;

    Ok(())
}

/// Find duplicate by content+type or by id+type(image).
pub fn find_duplicate(
    conn: &Connection,
    item_type: &str,
    content: Option<&str>,
    id: &str,
) -> Result<Option<ClipboardItem>, AppError> {
    // For images, match by id; for text-like types, match by content
    let result = if item_type == "image" {
        conn.query_row(
            "SELECT id, item_type, content, preview, created_at, favorite, metadata
             FROM clipboard_items WHERE item_type = ?1 AND id = ?2",
            params![item_type, id],
            |row| {
                let metadata_str: Option<String> = row.get(6)?;
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    item_type: row.get(1)?,
                    content: row.get(2)?,
                    preview: row.get(3)?,
                    created_at: row.get(4)?,
                    favorite: row.get::<_, i32>(5)? != 0,
                    metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                })
            },
        )
    } else {
        match content {
            Some(c) => conn.query_row(
                "SELECT id, item_type, content, preview, created_at, favorite, metadata
                 FROM clipboard_items WHERE item_type = ?1 AND content = ?2",
                params![item_type, c],
                |row| {
                    let metadata_str: Option<String> = row.get(6)?;
                    Ok(ClipboardItem {
                        id: row.get(0)?,
                        item_type: row.get(1)?,
                        content: row.get(2)?,
                        preview: row.get(3)?,
                        created_at: row.get(4)?,
                        favorite: row.get::<_, i32>(5)? != 0,
                        metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                    })
                },
            ),
            None => return Ok(None),
        }
    };

    match result {
        Ok(item) => Ok(Some(item)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to find duplicate: {e}"))),
    }
}

/// JavaScript-compatible timestamp (milliseconds since epoch).
fn js_sys_now() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

/// Migrate legacy clipboard_history.json data into SQLite.
pub fn migrate_legacy(conn: &Connection, data_dir: &std::path::Path) -> Result<(), AppError> {
    // Only migrate if the table is empty
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM clipboard_items", [], |row| row.get(0))
        .unwrap_or(0);
    if count > 0 {
        return Ok(());
    }

    let legacy_path = data_dir.join("clipboard_history.json");
    if !legacy_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&legacy_path)
        .map_err(|e| AppError::Database(format!("Failed to read legacy clipboard file: {e}")))?;

    // Tauri plugin-store format: { "items": [...] }
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Database(format!("Failed to parse legacy clipboard: {e}")))?;

    if let Some(items) = parsed.get("items").and_then(|v| v.as_array()) {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| AppError::Database(format!("Transaction error: {e}")))?;

        for item_val in items {
            if let Ok(item) = serde_json::from_value::<ClipboardItem>(item_val.clone()) {
                let _ = add_item(&tx, &item);
            }
        }

        tx.commit()
            .map_err(|e| AppError::Database(format!("Commit error: {e}")))?;

        log::info!(
            "Migrated {} clipboard items from legacy JSON to SQLite",
            items.len()
        );

        // Rename legacy file
        let backup_path = data_dir.join("clipboard_history.json.bak");
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

    fn make_item(id: &str, content: &str, favorite: bool) -> ClipboardItem {
        ClipboardItem {
            id: id.to_string(),
            item_type: "text".to_string(),
            content: Some(content.to_string()),
            preview: None,
            created_at: 1000.0 + id.parse::<f64>().unwrap_or(0.0),
            favorite,
            metadata: None,
        }
    }

    #[test]
    fn test_add_and_get_all() {
        let conn = setup();
        add_item(&conn, &make_item("1", "hello", false)).unwrap();
        add_item(&conn, &make_item("2", "world", true)).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 2);
        // Ordered by created_at DESC
        assert_eq!(items[0].id, "2");
        assert_eq!(items[1].id, "1");
    }

    #[test]
    fn test_upsert_replaces_existing() {
        let conn = setup();
        add_item(&conn, &make_item("1", "original", false)).unwrap();
        add_item(&conn, &make_item("1", "updated", true)).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].content.as_deref(), Some("updated"));
        assert!(items[0].favorite);
    }

    #[test]
    fn test_toggle_favorite() {
        let conn = setup();
        add_item(&conn, &make_item("1", "hello", false)).unwrap();

        let new_val = toggle_favorite(&conn, "1").unwrap();
        assert!(new_val);

        let new_val = toggle_favorite(&conn, "1").unwrap();
        assert!(!new_val);
    }

    #[test]
    fn test_delete_item() {
        let conn = setup();
        add_item(&conn, &make_item("1", "hello", false)).unwrap();
        add_item(&conn, &make_item("2", "world", false)).unwrap();

        delete_item(&conn, "1").unwrap();
        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2");
    }

    #[test]
    fn test_clear_non_favorites() {
        let conn = setup();
        add_item(&conn, &make_item("1", "hello", false)).unwrap();
        add_item(&conn, &make_item("2", "world", true)).unwrap();
        add_item(&conn, &make_item("3", "foo", false)).unwrap();

        clear_non_favorites(&conn).unwrap();
        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2");
    }

    #[test]
    fn test_find_duplicate_by_content() {
        let conn = setup();
        add_item(&conn, &make_item("1", "hello", true)).unwrap();

        let dup = find_duplicate(&conn, "text", Some("hello"), "999").unwrap();
        assert!(dup.is_some());
        assert!(dup.unwrap().favorite);

        let no_dup = find_duplicate(&conn, "text", Some("missing"), "999").unwrap();
        assert!(no_dup.is_none());
    }

    #[test]
    fn test_cleanup_enforces_max_items() {
        let conn = setup();
        let now = js_sys_now();
        for i in 0..10 {
            let mut item = make_item(&i.to_string(), &format!("item{i}"), false);
            item.created_at = now - 1000.0 + i as f64; // recent timestamps
            add_item(&conn, &item).unwrap();
        }

        // Use a large max_age so age cleanup doesn't interfere; only max_items matters
        cleanup(&conn, 999_999_999.0, 5).unwrap();
        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 5);
        // Should keep the 5 newest (ids 5-9)
        assert_eq!(items[0].id, "9");
    }

    #[test]
    fn test_metadata_roundtrip() {
        let conn = setup();
        let mut item = make_item("1", "img", false);
        item.item_type = "image".to_string();
        item.metadata = Some(serde_json::json!({"width": 100, "height": 200}));

        add_item(&conn, &item).unwrap();
        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        let meta = items[0].metadata.as_ref().unwrap();
        assert_eq!(meta["width"], 100);
        assert_eq!(meta["height"], 200);
    }
}
