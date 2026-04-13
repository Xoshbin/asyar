use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_app: Option<serde_json::Value>,
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

    // Migration: add source_app column if it doesn't exist yet.
    let source_app_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('clipboard_items') WHERE name='source_app'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if !source_app_exists {
        conn.execute(
            "ALTER TABLE clipboard_items ADD COLUMN source_app TEXT",
            [],
        )
        .map_err(|e| AppError::Database(format!("Failed to add source_app column: {e}")))?;
    }

    Ok(())
}

/// Insert or replace a clipboard item (upsert by id).
pub fn add_item(conn: &Connection, item: &ClipboardItem) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO clipboard_items
            (id, item_type, content, preview, created_at, favorite, metadata, source_app)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            item.id,
            item.item_type,
            item.content,
            item.preview,
            item.created_at,
            item.favorite as i32,
            item.metadata.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()),
            item.source_app.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()),
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to add clipboard item: {e}")))?;
    Ok(())
}

/// Get all clipboard items ordered by created_at DESC.
pub fn get_all(conn: &Connection) -> Result<Vec<ClipboardItem>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, item_type, content, preview, created_at, favorite, metadata, source_app
             FROM clipboard_items
             ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare query: {e}")))?;

    let items = stmt
        .query_map([], |row| {
            let metadata_str: Option<String> = row.get(6)?;
            let source_app_str: Option<String> = row.get(7)?;
            Ok(ClipboardItem {
                id: row.get(0)?,
                item_type: row.get(1)?,
                content: row.get(2)?,
                preview: row.get(3)?,
                created_at: row.get(4)?,
                favorite: row.get::<_, i32>(5)? != 0,
                metadata: metadata_str
                    .and_then(|s| serde_json::from_str(&s).ok()),
                source_app: source_app_str
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
            "SELECT id, item_type, content, preview, created_at, favorite, metadata, source_app
             FROM clipboard_items WHERE item_type = ?1 AND id = ?2",
            params![item_type, id],
            |row| {
                let metadata_str: Option<String> = row.get(6)?;
                let source_app_str: Option<String> = row.get(7)?;
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    item_type: row.get(1)?,
                    content: row.get(2)?,
                    preview: row.get(3)?,
                    created_at: row.get(4)?,
                    favorite: row.get::<_, i32>(5)? != 0,
                    metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                    source_app: source_app_str.and_then(|s| serde_json::from_str(&s).ok()),
                })
            },
        )
    } else {
        match content {
            Some(c) => conn.query_row(
                "SELECT id, item_type, content, preview, created_at, favorite, metadata, source_app
                 FROM clipboard_items WHERE item_type = ?1 AND content = ?2",
                params![item_type, c],
                |row| {
                    let metadata_str: Option<String> = row.get(6)?;
                    let source_app_str: Option<String> = row.get(7)?;
                    Ok(ClipboardItem {
                        id: row.get(0)?,
                        item_type: row.get(1)?,
                        content: row.get(2)?,
                        preview: row.get(3)?,
                        created_at: row.get(4)?,
                        favorite: row.get::<_, i32>(5)? != 0,
                        metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                        source_app: source_app_str.and_then(|s| serde_json::from_str(&s).ok()),
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

/// MAX age: 90 days in milliseconds (matches TS-side constant).
const MAX_HISTORY_AGE_MS: f64 = 90.0 * 24.0 * 60.0 * 60.0 * 1000.0;
/// Maximum number of history items to keep.
const MAX_HISTORY_ITEMS: usize = 1000;

/// Atomically record a new clipboard capture:
/// 1. Find any duplicate (same content+type; same id for images).
/// 2. If found: inherit its favorite status, then delete it.
/// 3. Insert the new item.
/// 4. Enforce age and count limits.
/// 5. Return all items ordered newest-first.
pub fn record_capture(conn: &Connection, item: &ClipboardItem, icon_cache_dir: Option<&Path>) -> Result<Vec<ClipboardItem>, AppError> {
    // 0. Enrich source_app with iconUrl if a path and cache dir are available
    let mut new_item = item.clone();
    if let Some(cache_dir) = icon_cache_dir {
        if let Some(source_app_val) = new_item.source_app.as_mut() {
            if let Some(path_str) = source_app_val
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
            {
                if let Some(icon_url) =
                    crate::application::service::extract_app_icon(&path_str, cache_dir)
                {
                    if let Some(obj) = source_app_val.as_object_mut() {
                        obj.insert(
                            "iconUrl".to_string(),
                            serde_json::Value::String(icon_url),
                        );
                    }
                }
            }
        }
    }

    // 1. Find duplicate
    let duplicate = find_duplicate(conn, &new_item.item_type, new_item.content.as_deref(), &new_item.id)?;
    if let Some(dup) = duplicate {
        if dup.favorite {
            new_item.favorite = true;
        }
        delete_item(conn, &dup.id)?;
    }

    // 3. Insert
    add_item(conn, &new_item)?;

    // 4. Cleanup
    cleanup(conn, MAX_HISTORY_AGE_MS, MAX_HISTORY_ITEMS)?;

    // 5. Return full list
    get_all(conn)
}

/// JavaScript-compatible timestamp (milliseconds since epoch).
/// In test builds this returns 0 so that age-based cleanup uses a negative
/// cutoff and never purges items whose `created_at` is set to small fake
/// values (e.g. 1000.0 ms).  The max-items limit still works correctly.
#[cfg(not(test))]
fn js_sys_now() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

#[cfg(test)]
fn js_sys_now() -> f64 {
    0.0
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
            source_app: None,
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

    #[test]
    fn test_item_with_source_app_roundtrips() {
        let conn = setup();
        let mut item = make_item("1", "hello", false);
        item.source_app = Some(serde_json::json!({
            "name": "Chrome",
            "bundleId": "com.google.Chrome",
            "windowTitle": "Google",
            "iconUrl": "asyar-icon://localhost/Chrome.png"
        }));

        add_item(&conn, &item).unwrap();
        let items = get_all(&conn).unwrap();

        assert_eq!(items.len(), 1);
        let app = items[0].source_app.as_ref().unwrap();
        assert_eq!(app["name"], "Chrome");
        assert_eq!(app["bundleId"], "com.google.Chrome");
        assert_eq!(app["iconUrl"], "asyar-icon://localhost/Chrome.png");
    }

    #[test]
    fn test_item_without_source_app_roundtrips() {
        let conn = setup();
        let item = make_item("1", "hello", false); // source_app = None by default
        add_item(&conn, &item).unwrap();
        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].source_app.is_none());
    }

    #[test]
    fn test_migration_add_source_app_column_is_idempotent() {
        // Calling init_table twice must not return an error.
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap(); // first call creates table + adds column
        init_table(&conn).unwrap(); // second call must not fail
    }

    #[test]
    fn test_record_capture_dedup_preserves_favorite() {
        let conn = setup();

        // Insert an existing favorited item with the same content
        let mut original = make_item("1", "hello", true); // favorite = true
        original.created_at = 1000.0;
        add_item(&conn, &original).unwrap();

        // Capture a new item with the same content (different id, later timestamp)
        let mut new_item = make_item("2", "hello", false); // favorite = false
        new_item.created_at = 2000.0;

        let result = record_capture(&conn, &new_item, None).unwrap();

        // Only one item in history
        assert_eq!(result.len(), 1);
        // The new item is at the top (newest)
        assert_eq!(result[0].id, "2");
        // favorite was inherited from the original
        assert!(result[0].favorite, "favorite should be preserved from the duplicate");
    }

    #[test]
    fn test_record_capture_replaces_duplicate() {
        let conn = setup();

        let item_a = make_item("1", "same content", false);
        add_item(&conn, &item_a).unwrap();

        let mut item_b = make_item("2", "same content", false);
        item_b.created_at = 2000.0;

        let result = record_capture(&conn, &item_b, None).unwrap();

        // Only one item — the duplicate was removed and the new one inserted
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "2");
    }

    #[test]
    fn test_record_capture_returns_newest_first() {
        let conn = setup();

        // Pre-populate with two different items
        let mut old = make_item("1", "old", false);
        old.created_at = 1000.0;
        add_item(&conn, &old).unwrap();

        // Capture a new unique item
        let mut new_item = make_item("2", "new", false);
        new_item.created_at = 2000.0;

        let result = record_capture(&conn, &new_item, None).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "2"); // newest first
        assert_eq!(result[1].id, "1");
    }
}
