use crate::crypto::cipher;
use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Encrypt an optional plaintext column. `None` is preserved as `None`.
fn encrypt_opt(plaintext: Option<&str>, master_key: &[u8; 32]) -> Result<Option<String>, AppError> {
    match plaintext {
        None => Ok(None),
        Some(v) => Ok(Some(cipher::encrypt(v, master_key)?)),
    }
}

/// Decrypt an optional ciphertext column. Pre-Layer-3 plaintext rows
/// (no `enc:v1:` prefix) and rows that fail to decrypt under the
/// current master key are returned as `None` — beta-phase clean break,
/// no migration of legacy values.
fn decrypt_opt(stored: Option<String>, master_key: &[u8; 32]) -> Option<String> {
    match stored {
        None => None,
        Some(v) if cipher::is_encrypted_value(&v) => cipher::decrypt(&v, master_key).ok(),
        Some(_) => None, // legacy plaintext — surface as missing so cleanup evicts it naturally
    }
}

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
    /// Set when [`crate::secret_detection::redact`] matched one or more
    /// substrings in this item's content. Stored as a comma-separated
    /// list of kind names (e.g. `"aws_access_key,jwt"`). Kind names are
    /// alphanumeric+underscore so no escaping is required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redacted_kinds: Option<Vec<String>>,
}

fn encode_redacted_kinds(kinds: &Option<Vec<String>>) -> Option<String> {
    kinds
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| v.join(","))
}

fn decode_redacted_kinds(raw: Option<String>) -> Option<Vec<String>> {
    raw.filter(|s| !s.is_empty())
        .map(|s| s.split(',').map(|p| p.to_string()).collect())
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

    // Migration: add redacted_kinds column if it doesn't exist yet.
    let redacted_kinds_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('clipboard_items') WHERE name='redacted_kinds'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if !redacted_kinds_exists {
        conn.execute(
            "ALTER TABLE clipboard_items ADD COLUMN redacted_kinds TEXT",
            [],
        )
        .map_err(|e| AppError::Database(format!("Failed to add redacted_kinds column: {e}")))?;
    }

    Ok(())
}

/// Insert or replace a clipboard item (upsert by id). The `content` and
/// `preview` columns are encrypted under `master_key` before insertion;
/// every other column stays plaintext so SQL filters and sorts work.
pub fn add_item(
    conn: &Connection,
    item: &ClipboardItem,
    master_key: &[u8; 32],
) -> Result<(), AppError> {
    let encrypted_content = encrypt_opt(item.content.as_deref(), master_key)?;
    let encrypted_preview = encrypt_opt(item.preview.as_deref(), master_key)?;

    conn.execute(
        "INSERT OR REPLACE INTO clipboard_items
            (id, item_type, content, preview, created_at, favorite, metadata, source_app, redacted_kinds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            item.id,
            item.item_type,
            encrypted_content,
            encrypted_preview,
            item.created_at,
            item.favorite as i32,
            item.metadata.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()),
            item.source_app.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()),
            encode_redacted_kinds(&item.redacted_kinds),
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to add clipboard item: {e}")))?;
    Ok(())
}

/// Get all clipboard items ordered by `created_at` DESC. `content` and
/// `preview` are decrypted on read; rows whose ciphertext fails to
/// decrypt under the current master key (e.g. pre-Layer-3 plaintext or
/// keychain-reset orphans) surface with `content`/`preview` set to
/// `None` so the row stays listed but its body is hidden.
pub fn get_all(conn: &Connection, master_key: &[u8; 32]) -> Result<Vec<ClipboardItem>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, item_type, content, preview, created_at, favorite, metadata, source_app, redacted_kinds
             FROM clipboard_items
             ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare query: {e}")))?;

    let items = stmt
        .query_map([], |row| {
            let metadata_str: Option<String> = row.get(6)?;
            let source_app_str: Option<String> = row.get(7)?;
            let redacted_kinds_str: Option<String> = row.get(8)?;
            let raw_content: Option<String> = row.get(2)?;
            let raw_preview: Option<String> = row.get(3)?;
            Ok(ClipboardItem {
                id: row.get(0)?,
                item_type: row.get(1)?,
                content: decrypt_opt(raw_content, master_key),
                preview: decrypt_opt(raw_preview, master_key),
                created_at: row.get(4)?,
                favorite: row.get::<_, i32>(5)? != 0,
                metadata: metadata_str
                    .and_then(|s| serde_json::from_str(&s).ok()),
                source_app: source_app_str
                    .and_then(|s| serde_json::from_str(&s).ok()),
                redacted_kinds: decode_redacted_kinds(redacted_kinds_str),
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

/// Tombstone the item in the cloud-sync journal then hard-delete it from
/// `clipboard_items`. Order matters: tombstone first so the journal row is
/// always present before the item disappears from the primary table.
fn delete_and_tombstone(conn: &Connection, id: &str) -> Result<(), AppError> {
    crate::storage::cloud_sync_state::mark_tombstone(conn, id, CLIPBOARD_CATEGORY)?;
    conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
        .map_err(|e| AppError::Database(format!("Failed to delete clipboard item: {e}")))?;
    Ok(())
}

/// Delete a single clipboard item.
pub fn delete_item(conn: &Connection, id: &str) -> Result<(), AppError> {
    delete_and_tombstone(conn, id)
}

/// Delete all non-favorite items.
pub fn clear_non_favorites(conn: &Connection) -> Result<(), AppError> {
    let ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM clipboard_items WHERE favorite = 0")
            .map_err(|e| AppError::Database(format!("Failed to prepare clear query: {e}")))?;
        let collected: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| AppError::Database(format!("Failed to query non-favorites: {e}")))?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };
    for id in ids {
        delete_and_tombstone(conn, &id)?;
    }
    Ok(())
}

/// Remove items older than max_age_ms that are not favorited, and enforce a max item count.
pub fn cleanup(conn: &Connection, max_age_ms: f64, max_items: usize) -> Result<(), AppError> {
    let cutoff = js_sys_now() - max_age_ms;

    // Enumerate and remove expired non-favorite items
    let age_ids: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM clipboard_items WHERE favorite = 0 AND created_at < ?1",
            )
            .map_err(|e| AppError::Database(format!("Failed to prepare age-cleanup query: {e}")))?;
        let collected: Vec<String> = stmt
            .query_map(params![cutoff], |row| row.get(0))
            .map_err(|e| AppError::Database(format!("Failed to query expired items: {e}")))?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };
    for id in age_ids {
        delete_and_tombstone(conn, &id)?;
    }

    // Enumerate overflow rows: everything NOT in the newest max_items
    let overflow_ids: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM clipboard_items WHERE id NOT IN (
                    SELECT id FROM clipboard_items ORDER BY created_at DESC LIMIT ?1
                )",
            )
            .map_err(|e| AppError::Database(format!("Failed to prepare max-items query: {e}")))?;
        let collected: Vec<String> = stmt
            .query_map(params![max_items as i64], |row| row.get(0))
            .map_err(|e| AppError::Database(format!("Failed to query overflow items: {e}")))?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };
    for id in overflow_ids {
        delete_and_tombstone(conn, &id)?;
    }

    Ok(())
}

/// Find duplicate by content+type or by id+type(image).
///
/// Encryption is non-deterministic (random nonce per write), so two
/// encryptions of the same plaintext produce different ciphertext and
/// the previous SQL `WHERE content = ?` cannot match. For text-like
/// item types we now scan all rows of that type, decrypt their
/// `content`, and compare against the requested plaintext. Volume is
/// bounded by `MAX_HISTORY_ITEMS = 1000` so this is sub-millisecond.
///
/// For images, `content` is the cache file path (not free text); the
/// duplicate match is still by `id`, unchanged.
pub fn find_duplicate(
    conn: &Connection,
    item_type: &str,
    content: Option<&str>,
    id: &str,
    master_key: &[u8; 32],
) -> Result<Option<ClipboardItem>, AppError> {
    if item_type == "image" {
        let result = conn.query_row(
            "SELECT id, item_type, content, preview, created_at, favorite, metadata, source_app, redacted_kinds
             FROM clipboard_items WHERE item_type = ?1 AND id = ?2",
            params![item_type, id],
            |row| {
                let metadata_str: Option<String> = row.get(6)?;
                let source_app_str: Option<String> = row.get(7)?;
                let redacted_kinds_str: Option<String> = row.get(8)?;
                let raw_content: Option<String> = row.get(2)?;
                let raw_preview: Option<String> = row.get(3)?;
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    item_type: row.get(1)?,
                    content: decrypt_opt(raw_content, master_key),
                    preview: decrypt_opt(raw_preview, master_key),
                    created_at: row.get(4)?,
                    favorite: row.get::<_, i32>(5)? != 0,
                    metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                    source_app: source_app_str.and_then(|s| serde_json::from_str(&s).ok()),
                    redacted_kinds: decode_redacted_kinds(redacted_kinds_str),
                })
            },
        );
        return match result {
            Ok(item) => Ok(Some(item)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(format!("Failed to find duplicate: {e}"))),
        };
    }

    let needle = match content {
        Some(c) => c,
        None => return Ok(None),
    };

    // Scan all rows of this item_type, decrypt-compare. Bounded by
    // `MAX_HISTORY_ITEMS` so this is sub-millisecond in practice.
    let mut stmt = conn
        .prepare(
            "SELECT id, item_type, content, preview, created_at, favorite, metadata, source_app, redacted_kinds
             FROM clipboard_items WHERE item_type = ?1",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare find_duplicate query: {e}")))?;

    let candidates = stmt
        .query_map(params![item_type], |row| {
            let metadata_str: Option<String> = row.get(6)?;
            let source_app_str: Option<String> = row.get(7)?;
            let redacted_kinds_str: Option<String> = row.get(8)?;
            let raw_content: Option<String> = row.get(2)?;
            let raw_preview: Option<String> = row.get(3)?;
            Ok(ClipboardItem {
                id: row.get(0)?,
                item_type: row.get(1)?,
                content: decrypt_opt(raw_content, master_key),
                preview: decrypt_opt(raw_preview, master_key),
                created_at: row.get(4)?,
                favorite: row.get::<_, i32>(5)? != 0,
                metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                source_app: source_app_str.and_then(|s| serde_json::from_str(&s).ok()),
                redacted_kinds: decode_redacted_kinds(redacted_kinds_str),
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query find_duplicate: {e}")))?;

    for candidate in candidates.flatten() {
        if candidate.content.as_deref() == Some(needle) {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

/// Cloud-sync category identifier for clipboard items.
const CLIPBOARD_CATEGORY: &str = "clipboard";

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
pub fn record_capture(
    conn: &Connection,
    item: &ClipboardItem,
    icon_cache_dir: Option<&Path>,
    master_key: &[u8; 32],
) -> Result<Vec<ClipboardItem>, AppError> {
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
    let duplicate = find_duplicate(
        conn,
        &new_item.item_type,
        new_item.content.as_deref(),
        &new_item.id,
        master_key,
    )?;
    if let Some(dup) = duplicate {
        if dup.favorite {
            new_item.favorite = true;
        }
        delete_item(conn, &dup.id)?;
    }

    // 3. Insert
    add_item(conn, &new_item, master_key)?;

    // 4. Cleanup
    cleanup(conn, MAX_HISTORY_AGE_MS, MAX_HISTORY_ITEMS)?;

    // 5. Return full list
    get_all(conn, master_key)
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
    use rusqlite::OptionalExtension;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        crate::storage::cloud_sync_state::init_table(&conn).unwrap();
        conn
    }

    /// Query the journal directly for a specific item_id and return
    /// (is_tombstone, is_dirty, last_uploaded_hash_is_none).
    fn journal_row(conn: &Connection, id: &str) -> Option<(bool, bool, bool)> {
        conn.query_row(
            "SELECT is_tombstone, is_dirty, last_uploaded_hash
               FROM cloud_sync_items_journal
              WHERE item_id = ?1",
            params![id],
            |row| {
                let ts: i64 = row.get(0)?;
                let dirty: i64 = row.get(1)?;
                let hash: Option<Vec<u8>> = row.get(2)?;
                Ok((ts != 0, dirty != 0, hash.is_none()))
            },
        )
        .optional()
        .unwrap()
    }

    fn test_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i * 11) as u8;
        }
        k
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
            redacted_kinds: None,
        }
    }

    #[test]
    fn test_redacted_kinds_round_trip() {
        let conn = setup();
        let key = test_key();
        let mut item = make_item("1", "[redacted: aws_access_key]", false);
        item.redacted_kinds = Some(vec!["aws_access_key".to_string(), "jwt".to_string()]);
        add_item(&conn, &item, &key).unwrap();

        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].redacted_kinds.as_ref().unwrap(),
            &vec!["aws_access_key".to_string(), "jwt".to_string()]
        );
    }

    #[test]
    fn test_redacted_kinds_none_round_trips_as_none() {
        let conn = setup();
        let key = test_key();
        let item = make_item("1", "plain text", false);
        add_item(&conn, &item, &key).unwrap();

        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].redacted_kinds.is_none());
    }

    #[test]
    fn test_init_table_idempotent_adds_redacted_kinds() {
        // Pre-create with the old schema (no redacted_kinds column).
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE clipboard_items (
                id TEXT PRIMARY KEY,
                item_type TEXT NOT NULL,
                content TEXT,
                preview TEXT,
                created_at REAL NOT NULL,
                favorite INTEGER NOT NULL DEFAULT 0,
                metadata TEXT
            );",
        )
        .unwrap();

        // Run init_table — should add both source_app and redacted_kinds.
        init_table(&conn).unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('clipboard_items') WHERE name='redacted_kinds'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "redacted_kinds column added");

        // Running again should not re-attempt the ALTER (idempotent).
        init_table(&conn).unwrap();
    }

    #[test]
    fn test_add_and_get_all() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "hello", false), &key).unwrap();
        add_item(&conn, &make_item("2", "world", true), &key).unwrap();

        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 2);
        // Ordered by created_at DESC
        assert_eq!(items[0].id, "2");
        assert_eq!(items[1].id, "1");
    }

    #[test]
    fn test_upsert_replaces_existing() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "original", false), &key).unwrap();
        add_item(&conn, &make_item("1", "updated", true), &key).unwrap();

        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].content.as_deref(), Some("updated"));
        assert!(items[0].favorite);
    }

    #[test]
    fn test_toggle_favorite() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "hello", false), &key).unwrap();

        let new_val = toggle_favorite(&conn, "1").unwrap();
        assert!(new_val);

        let new_val = toggle_favorite(&conn, "1").unwrap();
        assert!(!new_val);
    }

    #[test]
    fn test_delete_item() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "hello", false), &key).unwrap();
        add_item(&conn, &make_item("2", "world", false), &key).unwrap();

        delete_item(&conn, "1").unwrap();
        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2");
    }

    #[test]
    fn test_clear_non_favorites() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "hello", false), &key).unwrap();
        add_item(&conn, &make_item("2", "world", true), &key).unwrap();
        add_item(&conn, &make_item("3", "foo", false), &key).unwrap();

        clear_non_favorites(&conn).unwrap();
        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2");
    }

    #[test]
    fn test_find_duplicate_by_content() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "hello", true), &key).unwrap();

        let dup = find_duplicate(&conn, "text", Some("hello"), "999", &key).unwrap();
        assert!(dup.is_some());
        assert!(dup.unwrap().favorite);

        let no_dup = find_duplicate(&conn, "text", Some("missing"), "999", &key).unwrap();
        assert!(no_dup.is_none());
    }

    #[test]
    fn test_cleanup_enforces_max_items() {
        let conn = setup();
        let key = test_key();
        let now = js_sys_now();
        for i in 0..10 {
            let mut item = make_item(&i.to_string(), &format!("item{i}"), false);
            item.created_at = now - 1000.0 + i as f64; // recent timestamps
            add_item(&conn, &item, &key).unwrap();
        }

        // Use a large max_age so age cleanup doesn't interfere; only max_items matters
        cleanup(&conn, 999_999_999.0, 5).unwrap();
        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 5);
        // Should keep the 5 newest (ids 5-9)
        assert_eq!(items[0].id, "9");
    }

    #[test]
    fn test_metadata_roundtrip() {
        let conn = setup();
        let key = test_key();
        let mut item = make_item("1", "img", false);
        item.item_type = "image".to_string();
        item.metadata = Some(serde_json::json!({"width": 100, "height": 200}));

        add_item(&conn, &item, &key).unwrap();
        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1);
        let meta = items[0].metadata.as_ref().unwrap();
        assert_eq!(meta["width"], 100);
        assert_eq!(meta["height"], 200);
    }

    #[test]
    fn test_item_with_source_app_roundtrips() {
        let conn = setup();
        let key = test_key();
        let mut item = make_item("1", "hello", false);
        item.source_app = Some(serde_json::json!({
            "name": "Chrome",
            "bundleId": "com.google.Chrome",
            "windowTitle": "Google",
            "iconUrl": "asyar-icon://localhost/Chrome.png"
        }));

        add_item(&conn, &item, &key).unwrap();
        let items = get_all(&conn, &key).unwrap();

        assert_eq!(items.len(), 1);
        let app = items[0].source_app.as_ref().unwrap();
        assert_eq!(app["name"], "Chrome");
        assert_eq!(app["bundleId"], "com.google.Chrome");
        assert_eq!(app["iconUrl"], "asyar-icon://localhost/Chrome.png");
    }

    #[test]
    fn test_item_without_source_app_roundtrips() {
        let conn = setup();
        let key = test_key();
        let item = make_item("1", "hello", false); // source_app = None by default
        add_item(&conn, &item, &key).unwrap();
        let items = get_all(&conn, &key).unwrap();
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
        let key = test_key();

        // Insert an existing favorited item with the same content
        let mut original = make_item("1", "hello", true); // favorite = true
        original.created_at = 1000.0;
        add_item(&conn, &original, &key).unwrap();

        // Capture a new item with the same content (different id, later timestamp)
        let mut new_item = make_item("2", "hello", false); // favorite = false
        new_item.created_at = 2000.0;

        let result = record_capture(&conn, &new_item, None, &key).unwrap();

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
        let key = test_key();

        let item_a = make_item("1", "same content", false);
        add_item(&conn, &item_a, &key).unwrap();

        let mut item_b = make_item("2", "same content", false);
        item_b.created_at = 2000.0;

        let result = record_capture(&conn, &item_b, None, &key).unwrap();

        // Only one item — the duplicate was removed and the new one inserted
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "2");
    }

    #[test]
    fn test_record_capture_returns_newest_first() {
        let conn = setup();
        let key = test_key();

        // Pre-populate with two different items
        let mut old = make_item("1", "old", false);
        old.created_at = 1000.0;
        add_item(&conn, &old, &key).unwrap();

        // Capture a new unique item
        let mut new_item = make_item("2", "new", false);
        new_item.created_at = 2000.0;

        let result = record_capture(&conn, &new_item, None, &key).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "2"); // newest first
        assert_eq!(result[1].id, "1");
    }

    #[test]
    fn test_content_column_in_db_is_encrypted_not_plaintext() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "highly secret content", false), &key).unwrap();

        let raw_content: String = conn
            .query_row(
                "SELECT content FROM clipboard_items WHERE id = '1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            raw_content.starts_with(cipher::VERSION_PREFIX),
            "content column must use enc:v1: scheme, got: {raw_content}"
        );
        assert!(
            !raw_content.contains("highly secret content"),
            "plaintext must not appear in the column"
        );
    }

    #[test]
    fn test_get_all_returns_none_for_legacy_plaintext_rows() {
        let conn = setup();
        let key = test_key();
        // Insert a pre-Layer-3 plaintext row by going around add_item.
        conn.execute(
            "INSERT INTO clipboard_items
                (id, item_type, content, preview, created_at, favorite)
             VALUES ('legacy', 'text', 'plaintext leftover', 'plaintext leftover', 1.0, 0)",
            [],
        )
        .unwrap();

        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1, "row still listed");
        assert_eq!(items[0].id, "legacy");
        assert!(items[0].content.is_none(), "legacy plaintext content surfaces as None");
        assert!(items[0].preview.is_none(), "legacy plaintext preview surfaces as None");
    }

    #[test]
    fn test_find_duplicate_works_with_encryption() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "duplicate me", true), &key).unwrap();

        let found = find_duplicate(&conn, "text", Some("duplicate me"), "different-id", &key).unwrap();
        assert!(found.is_some(), "decrypt-compare must find the row");
        let found = found.unwrap();
        assert_eq!(found.id, "1");
        assert!(found.favorite);
    }

    #[test]
    fn test_find_duplicate_image_still_uses_id_match() {
        let conn = setup();
        let key = test_key();
        let mut img = make_item("img-id", "/path/to/img.png", false);
        img.item_type = "image".to_string();
        add_item(&conn, &img, &key).unwrap();

        let found = find_duplicate(&conn, "image", None, "img-id", &key).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "img-id");
    }

    // ── Tombstone regression tests ──────────────────────────────────────────

    #[test]
    fn delete_item_marks_journal_tombstone() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("42", "some text", false), &key).unwrap();

        delete_item(&conn, "42").unwrap();

        let row = journal_row(&conn, "42");
        assert!(row.is_some(), "journal row must exist after delete");
        let (is_tombstone, is_dirty, hash_is_none) = row.unwrap();
        assert!(is_tombstone, "is_tombstone must be 1");
        assert!(is_dirty, "is_dirty must be 1");
        assert!(hash_is_none, "last_uploaded_hash must be NULL");
    }

    #[test]
    fn clear_non_favorites_marks_each_removed_id_as_tombstone() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("10", "non-fav a", false), &key).unwrap();
        add_item(&conn, &make_item("20", "favorited", true), &key).unwrap();
        add_item(&conn, &make_item("30", "non-fav b", false), &key).unwrap();

        clear_non_favorites(&conn).unwrap();

        // Non-favorites are tombstoned
        for id in &["10", "30"] {
            let row = journal_row(&conn, id);
            assert!(row.is_some(), "journal row must exist for id {id}");
            let (is_tombstone, is_dirty, _) = row.unwrap();
            assert!(is_tombstone, "id {id} must be tombstoned");
            assert!(is_dirty, "id {id} must be dirty");
        }

        // Favorite is NOT tombstoned
        let fav_row = journal_row(&conn, "20");
        assert!(fav_row.is_none(), "favorite id 20 must not appear in journal");

        // Only the favorite remains in clipboard_items
        let remaining = get_all(&conn, &key).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "20");
    }

    #[test]
    fn cleanup_age_based_marks_evicted_ids_as_tombstone() {
        let conn = setup();
        let key = test_key();
        // js_sys_now() returns 0 in test builds. Use negative max_age_ms so that
        // cutoff = 0 - (-1) = 1 > any created_at in make_item (which starts at 1000),
        // triggering age eviction for all non-favorites.
        add_item(&conn, &make_item("1", "item a", false), &key).unwrap();
        add_item(&conn, &make_item("2", "item b", false), &key).unwrap();

        // Negative max_age_ms: cutoff = 0 - (-1.0) = 1.0
        // make_item sets created_at = 1000 + id, so all rows have created_at >= 1001 > 1.0
        // That means they are NOT expired under the cutoff logic. Adjust to ensure eviction:
        // We need created_at < cutoff. cutoff = js_sys_now() - max_age_ms = 0 - max_age_ms.
        // For cutoff to exceed created_at=1001, we need 0 - max_age_ms > 1001
        // => max_age_ms < -1001.
        cleanup(&conn, -2000.0, 1000).unwrap();

        for id in &["1", "2"] {
            let row = journal_row(&conn, id);
            assert!(row.is_some(), "journal row must exist for evicted id {id}");
            let (is_tombstone, is_dirty, _) = row.unwrap();
            assert!(is_tombstone, "evicted id {id} must be tombstoned");
            assert!(is_dirty, "evicted id {id} must be dirty");
        }
    }

    #[test]
    fn cleanup_count_limit_marks_overflow_ids_as_tombstone() {
        let conn = setup();
        let key = test_key();
        // Insert 5 items with distinct timestamps (make_item uses 1000 + id as f64)
        for i in 1..=5u32 {
            add_item(&conn, &make_item(&i.to_string(), &format!("item {i}"), false), &key).unwrap();
        }
        // Use a large max_age so age cleanup doesn't fire; only max_items=2 matters
        cleanup(&conn, MAX_HISTORY_AGE_MS, 2).unwrap();

        // The 2 newest survive (ids 4 and 5 — created_at 1004 and 1005)
        let remaining = get_all(&conn, &key).unwrap();
        assert_eq!(remaining.len(), 2);
        let remaining_ids: Vec<_> = remaining.iter().map(|i| i.id.as_str()).collect();
        assert!(remaining_ids.contains(&"5"));
        assert!(remaining_ids.contains(&"4"));

        // The 3 oldest (ids 1, 2, 3) must be tombstoned
        for id in &["1", "2", "3"] {
            let row = journal_row(&conn, id);
            assert!(row.is_some(), "journal row must exist for evicted id {id}");
            let (is_tombstone, is_dirty, _) = row.unwrap();
            assert!(is_tombstone, "evicted id {id} must be tombstoned");
            assert!(is_dirty, "evicted id {id} must be dirty");
        }
    }

    #[test]
    fn record_capture_dedup_path_tombstones_replaced_id() {
        let conn = setup();
        let key = test_key();

        // Original item with id "old"
        let mut original = make_item("old", "same content", false);
        original.created_at = 1000.0;
        add_item(&conn, &original, &key).unwrap();

        // Capture same content with a new id — triggers dedup → delete_item("old")
        let mut new_item = make_item("new", "same content", false);
        new_item.created_at = 2000.0;
        record_capture(&conn, &new_item, None, &key).unwrap();

        // "old" must be tombstoned
        let row = journal_row(&conn, "old");
        assert!(row.is_some(), "journal row must exist for replaced id 'old'");
        let (is_tombstone, is_dirty, _) = row.unwrap();
        assert!(is_tombstone, "'old' must be tombstoned after dedup replacement");
        assert!(is_dirty, "'old' must be dirty");
    }
}
