use crate::crypto::cipher;
use crate::error::AppError;
use crate::storage::clipboard_fts::ClipboardFts;
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

/// Hot-path list payload — decrypts `preview` only, never `content`.
/// Returned by all paged-list and search IPCs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardListItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub created_at: f64,
    pub favorite: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_app: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redacted_kinds: Option<Vec<String>>,
}

/// Opaque pagination cursor. Comparisons use tuple semantics
/// `(created_at, id)` — both fields are required to disambiguate
/// rows that share a millisecond timestamp.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub created_at: f64,
    pub id: String,
}

/// Return type for `list_initial`: all favorites plus the newest `limit`
/// non-favorites, with an optional cursor for fetching older rows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialPage {
    pub favorites: Vec<ClipboardListItem>,
    pub recent: Vec<ClipboardListItem>,
    pub next_cursor: Option<Cursor>,
}

/// Return type for `list_older`: the next page of non-favorites strictly
/// older than the supplied cursor, with an optional cursor for the page
/// after that.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OlderPage {
    pub items: Vec<ClipboardListItem>,
    pub next_cursor: Option<Cursor>,
}

/// Counts returned by [`count`]. Used by sync provider summaries to
/// decide whether a full export is needed without materialising rows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardCount {
    pub total: u32,
    pub favorites: u32,
}

/// Return type for [`export_for_sync`]: a page of full `ClipboardItem`
/// rows (content decrypted) plus an optional cursor for the next page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPage {
    pub items: Vec<ClipboardItem>,
    pub next_cursor: Option<Cursor>,
}

/// Return type for [`delete_item`]: carries the decrypted image cache-file
/// path so the TS layer can unlink it without a separate list scan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    /// Decrypted `content` of an image row, which is the cache file path,
    /// so the TS layer can unlink it. `None` for non-image rows.
    pub image_content_path: Option<String>,
}

/// Return type for [`clear_non_favorites`]: ids that were removed and
/// the decrypted image-cache paths for any image rows among them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearResult {
    pub removed_ids: Vec<String>,
    pub removed_image_paths: Vec<String>,
}

/// Return type for [`record_capture`]: the id of the newly inserted item and
/// the ids of any items evicted by the age/count cleanup that followed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub inserted_id: String,
    pub evicted_ids: Vec<String>,
}

/// Return type for [`search`]: FTS5-ranked list items and the index state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub items: Vec<ClipboardListItem>,
    /// `"ready"` once the FTS rebuild has completed; `"indexing"` before.
    pub index_state: &'static str,
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

/// Deterministic dedup hash for a (type, content) pair under the
/// master key. Returns `None` for image rows or rows with no content —
/// these never participate in the text-dedup index.
fn compute_content_hash(
    item_type: &str,
    content: Option<&str>,
    master_key: &[u8; 32],
) -> Option<Vec<u8>> {
    if item_type == "image" {
        return None;
    }
    let needle = content?;
    let message = format!("{item_type}\n{needle}");
    Some(crate::crypto::hmac::hmac_sha256(master_key, message.as_bytes()).to_vec())
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
        -- Replace single-column indices from earlier schema versions.
        DROP INDEX IF EXISTS idx_clipboard_created_at;
        DROP INDEX IF EXISTS idx_clipboard_favorite;
        CREATE INDEX IF NOT EXISTS idx_clipboard_fav_created_id
            ON clipboard_items(favorite, created_at DESC, id DESC);",
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
        conn.execute("ALTER TABLE clipboard_items ADD COLUMN source_app TEXT", [])
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

    // Migration: add content_hash column if it doesn't exist yet. Nullable
    // for migrated rows; the FTS rebuild task backfills values as it
    // decrypts each row at process start.
    let content_hash_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('clipboard_items') WHERE name='content_hash'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if !content_hash_exists {
        conn.execute(
            "ALTER TABLE clipboard_items ADD COLUMN content_hash BLOB",
            [],
        )
        .map_err(|e| AppError::Database(format!("Failed to add content_hash column: {e}")))?;
    }

    // idx_clipboard_hash must be created after the content_hash ALTER TABLE
    // guard above — the column doesn't exist on upgrade installs until that
    // migration runs. Do NOT move this into the execute_batch block.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_clipboard_hash
            ON clipboard_items(item_type, content_hash)",
        [],
    )
    .map_err(|e| AppError::Database(format!("Failed to create idx_clipboard_hash: {e}")))?;

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
    let content_hash = compute_content_hash(&item.item_type, item.content.as_deref(), master_key);

    conn.execute(
        "INSERT OR REPLACE INTO clipboard_items
            (id, item_type, content, preview, created_at, favorite, metadata, source_app, redacted_kinds, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
            content_hash,
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
        .query_map([], row_to_item_factory(master_key))
        .map_err(|e| AppError::Database(format!("Failed to query clipboard items: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

/// Get all favorites plus the newest `limit` non-favorites, ordered
/// favorites-first then `created_at DESC`. Decrypts content/preview
/// per row. Used by the launcher view; sync uses `get_all`.
pub fn get_recent(
    conn: &Connection,
    limit: usize,
    master_key: &[u8; 32],
) -> Result<Vec<ClipboardItem>, AppError> {
    let select_cols = "SELECT id, item_type, content, preview, created_at, favorite, metadata, source_app, redacted_kinds";

    // Favorites — all of them, newest first.
    let mut fav_stmt = conn
        .prepare(&format!(
            "{select_cols} FROM clipboard_items WHERE favorite = 1 ORDER BY created_at DESC"
        ))
        .map_err(|e| {
            AppError::Database(format!("Failed to prepare get_recent favorites query: {e}"))
        })?;
    let mut items: Vec<ClipboardItem> = fav_stmt
        .query_map([], row_to_item_factory(master_key))
        .map_err(|e| AppError::Database(format!("Failed to query favorites: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    // Non-favorites — newest `limit` rows only.
    let mut non_fav_stmt = conn
        .prepare(&format!(
            "{select_cols} FROM clipboard_items WHERE favorite = 0 ORDER BY created_at DESC LIMIT ?1"
        ))
        .map_err(|e| AppError::Database(format!("Failed to prepare get_recent non-favorites query: {e}")))?;
    let non_favs: Vec<ClipboardItem> = non_fav_stmt
        .query_map(
            rusqlite::params![limit as i64],
            row_to_item_factory(master_key),
        )
        .map_err(|e| AppError::Database(format!("Failed to query non-favorites: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    items.extend(non_favs);
    Ok(items)
}

/// First-page load: all favorites (newest-first) plus the newest `limit`
/// non-favorites. Returns a `Cursor` pointing at the oldest non-favorite
/// in the page when more older rows exist.
pub fn list_initial(
    conn: &Connection,
    limit: usize,
    master_key: &[u8; 32],
) -> Result<InitialPage, AppError> {
    let favorites: Vec<ClipboardListItem> = conn
        .prepare(&format!(
            "{LIST_SELECT_COLS} FROM clipboard_items \
              WHERE favorite = 1 ORDER BY created_at DESC, id DESC"
        ))
        .map_err(|e| AppError::Database(format!("Failed to prepare favorites query: {e}")))?
        .query_map([], list_row_to_item_factory(master_key))
        .map_err(|e| AppError::Database(format!("Failed to query favorites: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    // Fetch limit + 1 to detect whether more older rows exist.
    let probe_limit = (limit as i64).saturating_add(1);
    let mut probe: Vec<ClipboardListItem> = conn
        .prepare(&format!(
            "{LIST_SELECT_COLS} FROM clipboard_items \
              WHERE favorite = 0 ORDER BY created_at DESC, id DESC LIMIT ?1"
        ))
        .map_err(|e| AppError::Database(format!("Failed to prepare recent query: {e}")))?
        .query_map(params![probe_limit], list_row_to_item_factory(master_key))
        .map_err(|e| AppError::Database(format!("Failed to query recent: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    let has_more = probe.len() > limit;
    probe.truncate(limit);
    let next_cursor = if has_more {
        probe.last().map(|row| Cursor {
            created_at: row.created_at,
            id: row.id.clone(),
        })
    } else {
        None
    };

    Ok(InitialPage {
        favorites,
        recent: probe,
        next_cursor,
    })
}

/// Older page: strictly less than `(cursor.created_at, cursor.id)` in
/// the `(created_at DESC, id DESC)` ordering. Favorites are excluded
/// from older pages (they all live in the initial page).
pub fn list_older(
    conn: &Connection,
    cursor: &Cursor,
    limit: usize,
    master_key: &[u8; 32],
) -> Result<OlderPage, AppError> {
    let probe_limit = (limit as i64).saturating_add(1);
    let mut probe: Vec<ClipboardListItem> = conn
        .prepare(&format!(
            "{LIST_SELECT_COLS} FROM clipboard_items \
              WHERE favorite = 0 \
                AND (created_at < ?1 OR (created_at = ?1 AND id < ?2)) \
              ORDER BY created_at DESC, id DESC LIMIT ?3"
        ))
        .map_err(|e| AppError::Database(format!("Failed to prepare list_older query: {e}")))?
        .query_map(
            params![cursor.created_at, cursor.id, probe_limit],
            list_row_to_item_factory(master_key),
        )
        .map_err(|e| AppError::Database(format!("Failed to query list_older: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    let has_more = probe.len() > limit;
    probe.truncate(limit);
    let next_cursor = if has_more {
        probe.last().map(|row| Cursor {
            created_at: row.created_at,
            id: row.id.clone(),
        })
    } else {
        None
    };

    Ok(OlderPage {
        items: probe,
        next_cursor,
    })
}

/// FTS5-backed search. Returns items in bm25 rank order joined to
/// `clipboard_items` for the row payload. Capped at `limit` results
/// (no pagination — refine the query for more).
pub fn search(
    conn: &Connection,
    fts: &ClipboardFts,
    query: &str,
    limit: usize,
    master_key: &[u8; 32],
) -> Result<SearchResult, AppError> {
    if !crate::storage::clipboard_fts::is_ready() {
        return Ok(SearchResult {
            items: Vec::new(),
            index_state: "indexing",
        });
    }

    let ids = fts.search(query, limit)?;
    if ids.is_empty() {
        return Ok(SearchResult {
            items: Vec::new(),
            index_state: "ready",
        });
    }

    // Per-id PK lookup in ranked order; preserves the bm25 ordering FTS
    // returned. At limit=200 this is ~0.5 ms total.
    let mut items: Vec<ClipboardListItem> = Vec::with_capacity(ids.len());
    let select_one = format!("{LIST_SELECT_COLS} FROM clipboard_items WHERE id = ?1");
    let mut stmt = conn
        .prepare(&select_one)
        .map_err(|e| AppError::Database(format!("search lookup prepare: {e}")))?;
    for id in ids {
        if let Ok(item) = stmt.query_row(params![id], list_row_to_item_factory(master_key)) {
            items.push(item);
        }
    }

    Ok(SearchResult {
        items,
        index_state: "ready",
    })
}

/// Iterate every row (favorites + non-favorites) newest-first in pages.
/// Returns full `ClipboardItem` (content decrypted) — sync needs the
/// plaintext to encrypt under the per-item sync envelope.
pub fn export_for_sync(
    conn: &Connection,
    cursor: Option<&Cursor>,
    limit: usize,
    master_key: &[u8; 32],
) -> Result<ExportPage, AppError> {
    let probe_limit = (limit as i64).saturating_add(1);
    let select = "SELECT id, item_type, content, preview, created_at, favorite, \
                         metadata, source_app, redacted_kinds FROM clipboard_items";

    let mut probe: Vec<ClipboardItem> = match cursor {
        Some(c) => conn
            .prepare(&format!(
                "{select} WHERE (created_at < ?1 OR (created_at = ?1 AND id < ?2)) \
                   ORDER BY created_at DESC, id DESC LIMIT ?3"
            ))
            .map_err(|e| AppError::Database(format!("export_for_sync prepare: {e}")))?
            .query_map(
                params![c.created_at, c.id, probe_limit],
                row_to_item_factory(master_key),
            )
            .map_err(|e| AppError::Database(format!("export_for_sync query: {e}")))?
            .filter_map(|r| r.ok())
            .collect(),
        None => conn
            .prepare(&format!(
                "{select} ORDER BY created_at DESC, id DESC LIMIT ?1"
            ))
            .map_err(|e| AppError::Database(format!("export_for_sync prepare: {e}")))?
            .query_map(params![probe_limit], row_to_item_factory(master_key))
            .map_err(|e| AppError::Database(format!("export_for_sync query: {e}")))?
            .filter_map(|r| r.ok())
            .collect(),
    };

    let has_more = probe.len() > limit;
    probe.truncate(limit);
    let next_cursor = if has_more {
        probe.last().map(|row| Cursor {
            created_at: row.created_at,
            id: row.id.clone(),
        })
    } else {
        None
    };

    Ok(ExportPage {
        items: probe,
        next_cursor,
    })
}

/// Single-row full decrypt by id. Returns `None` if the row is gone.
/// Used by the lazy-decrypt path: list queries return preview-only
/// `ClipboardListItem`; on paste/detail open, the TS layer calls this
/// to fetch the full content for one row.
pub fn get_item(
    conn: &Connection,
    id: &str,
    master_key: &[u8; 32],
) -> Result<Option<ClipboardItem>, AppError> {
    let result = conn.query_row(
        "SELECT id, item_type, content, preview, created_at, favorite,
                metadata, source_app, redacted_kinds
           FROM clipboard_items WHERE id = ?1",
        params![id],
        row_to_item_factory(master_key),
    );
    match result {
        Ok(item) => Ok(Some(item)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to get item {id}: {e}"))),
    }
}

/// Total and favorites-only counts. Cheap (two `COUNT(*)` queries with
/// indexed lookups) and used by sync provider summaries to avoid
/// materialising the whole table.
pub fn count(conn: &Connection) -> Result<ClipboardCount, AppError> {
    let total: u32 = conn
        .query_row("SELECT COUNT(*) FROM clipboard_items", [], |r| r.get(0))
        .map_err(|e| AppError::Database(format!("Failed to count clipboard items: {e}")))?;
    let favorites: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM clipboard_items WHERE favorite = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| AppError::Database(format!("Failed to count favorites: {e}")))?;
    Ok(ClipboardCount { total, favorites })
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

/// Delete a single clipboard item. Returns a [`DeleteResult`] carrying
/// the decrypted image-cache path when the deleted row was an image, so
/// the TS layer can unlink the file without a separate list scan.
pub fn delete_item(
    conn: &Connection,
    id: &str,
    master_key: &[u8; 32],
) -> Result<DeleteResult, AppError> {
    // Look up image path (if any) before deletion so the TS layer can
    // unlink the cache file. One indexed PK lookup; no full table scan.
    let image_content_path: Option<String> = {
        let row = conn.query_row(
            "SELECT item_type, content FROM clipboard_items WHERE id = ?1",
            params![id],
            |r| {
                let item_type: String = r.get(0)?;
                let raw_content: Option<String> = r.get(1)?;
                Ok((item_type, raw_content))
            },
        );
        match row {
            Ok((it_type, raw)) if it_type == "image" => decrypt_opt(raw, master_key),
            _ => None,
        }
    };

    delete_and_tombstone(conn, id)?;
    Ok(DeleteResult { image_content_path })
}

/// FTS-aware wrapper: delete a row from disk and from the FTS index.
pub fn delete_item_with_fts(
    conn: &Connection,
    id: &str,
    master_key: &[u8; 32],
    fts: &ClipboardFts,
) -> Result<DeleteResult, AppError> {
    let res = delete_item(conn, id, master_key)?;
    fts.delete(id)?;
    Ok(res)
}

/// Delete all non-favorite items. Returns a [`ClearResult`] with the ids
/// removed and decrypted image-cache paths for any image rows, so the TS
/// layer can unlink those files without a separate list scan.
pub fn clear_non_favorites(
    conn: &Connection,
    master_key: &[u8; 32],
) -> Result<ClearResult, AppError> {
    let rows: Vec<(String, String, Option<String>)> = conn
        .prepare("SELECT id, item_type, content FROM clipboard_items WHERE favorite = 0")
        .map_err(|e| AppError::Database(format!("clear_non_favorites prepare: {e}")))?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| AppError::Database(format!("clear_non_favorites query: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    let mut removed_ids = Vec::with_capacity(rows.len());
    let mut removed_image_paths = Vec::new();
    for (id, item_type, raw_content) in rows {
        if item_type == "image" {
            if let Some(path) = decrypt_opt(raw_content, master_key) {
                removed_image_paths.push(path);
            }
        }
        delete_and_tombstone(conn, &id)?;
        removed_ids.push(id);
    }
    Ok(ClearResult {
        removed_ids,
        removed_image_paths,
    })
}

/// FTS-aware wrapper: clear all non-favorite rows on disk and drop their
/// FTS index entries.
pub fn clear_non_favorites_with_fts(
    conn: &Connection,
    master_key: &[u8; 32],
    fts: &ClipboardFts,
) -> Result<ClearResult, AppError> {
    let res = clear_non_favorites(conn, master_key)?;
    fts.delete_many(&res.removed_ids)?;
    Ok(res)
}

/// Remove items older than `max_age_ms` (non-favorites only) and enforce a
/// max-item cap. Returns the ids of every evicted row so callers can drop
/// their FTS index entries in the same logical operation.
pub fn cleanup(
    conn: &Connection,
    max_age_ms: f64,
    max_items: usize,
) -> Result<Vec<String>, AppError> {
    let cutoff = js_sys_now() - max_age_ms;
    let mut evicted: Vec<String> = Vec::new();

    // Age-based eviction.
    let age_ids: Vec<String> = conn
        .prepare("SELECT id FROM clipboard_items WHERE favorite = 0 AND created_at < ?1")
        .map_err(|e| AppError::Database(format!("cleanup age prepare: {e}")))?
        .query_map(params![cutoff], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Database(format!("cleanup age query: {e}")))?
        .filter_map(|r| r.ok())
        .collect();
    for id in age_ids {
        delete_and_tombstone(conn, &id)?;
        evicted.push(id);
    }

    // Count-based eviction: anything beyond the newest `max_items` (across
    // favorites + non-favorites) gets evicted.
    let overflow_ids: Vec<String> = conn
        .prepare(
            "SELECT id FROM clipboard_items
              WHERE id NOT IN (
                  SELECT id FROM clipboard_items ORDER BY created_at DESC, id DESC LIMIT ?1
              )",
        )
        .map_err(|e| AppError::Database(format!("cleanup overflow prepare: {e}")))?
        .query_map(params![max_items as i64], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Database(format!("cleanup overflow query: {e}")))?
        .filter_map(|r| r.ok())
        .collect();
    for id in overflow_ids {
        delete_and_tombstone(conn, &id)?;
        evicted.push(id);
    }

    Ok(evicted)
}

/// Row → ClipboardItem mapper used by every read path. Centralised so the
/// decrypt-and-deserialise logic lives in one place. SELECT must project
/// columns in this exact order:
///   id, item_type, content, preview, created_at, favorite,
///   metadata, source_app, redacted_kinds
fn row_to_item_factory(
    master_key: &[u8; 32],
) -> impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<ClipboardItem> + '_ {
    move |row| {
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
    }
}

/// Row → ClipboardListItem mapper. SELECT must project columns in this exact order:
///   id, item_type, preview, created_at, favorite,
///   metadata, source_app, redacted_kinds
fn list_row_to_item_factory(
    master_key: &[u8; 32],
) -> impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<ClipboardListItem> + '_ {
    move |row| {
        let metadata_str: Option<String> = row.get(5)?;
        let source_app_str: Option<String> = row.get(6)?;
        let redacted_kinds_str: Option<String> = row.get(7)?;
        let raw_preview: Option<String> = row.get(2)?;
        Ok(ClipboardListItem {
            id: row.get(0)?,
            item_type: row.get(1)?,
            preview: decrypt_opt(raw_preview, master_key),
            created_at: row.get(3)?,
            favorite: row.get::<_, i32>(4)? != 0,
            metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
            source_app: source_app_str.and_then(|s| serde_json::from_str(&s).ok()),
            redacted_kinds: decode_redacted_kinds(redacted_kinds_str),
        })
    }
}

/// Find duplicate by content+type or by id+type(image).
///
/// For text-like types a single indexed equality on `content_hash` replaces
/// the former O(N) decrypt-scan. Rows with a NULL `content_hash` (legacy rows
/// inserted before the hash column existed) are not matched — the backfill
/// task will populate them on next startup.
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
        // Image dedup is still by id; content for an image row is the cache
        // file path, not free text, and content_hash is NULL for image rows.
        let result = conn.query_row(
            "SELECT id, item_type, content, preview, created_at, favorite,
                    metadata, source_app, redacted_kinds
               FROM clipboard_items WHERE item_type = ?1 AND id = ?2",
            params![item_type, id],
            row_to_item_factory(master_key),
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
    let hash =
        crate::crypto::hmac::hmac_sha256(master_key, format!("{item_type}\n{needle}").as_bytes());

    let result = conn.query_row(
        "SELECT id, item_type, content, preview, created_at, favorite,
                metadata, source_app, redacted_kinds
           FROM clipboard_items
          WHERE item_type = ?1 AND content_hash = ?2
          LIMIT 1",
        params![item_type, &hash[..]],
        row_to_item_factory(master_key),
    );
    match result {
        Ok(item) => Ok(Some(item)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to find duplicate: {e}"))),
    }
}

/// Cloud-sync category identifier for clipboard items.
const CLIPBOARD_CATEGORY: &str = "clipboard";

/// MAX age: 90 days in milliseconds (matches TS-side constant).
const MAX_HISTORY_AGE_MS: f64 = 90.0 * 24.0 * 60.0 * 60.0 * 1000.0;
/// Maximum number of history items to keep.
const MAX_HISTORY_ITEMS: usize = 50_000;

/// Shared SELECT column list for `ClipboardListItem` queries. Columns must
/// match the index expectations of `list_row_to_item_factory` exactly:
///   0=id, 1=item_type, 2=preview, 3=created_at, 4=favorite,
///   5=metadata, 6=source_app, 7=redacted_kinds
const LIST_SELECT_COLS: &str =
    "SELECT id, item_type, preview, created_at, favorite, metadata, source_app, redacted_kinds";

/// Atomically record a new clipboard capture:
/// 1. Find any duplicate (same content+type; same id for images).
/// 2. If found: inherit its favorite status, then delete it.
/// 3. Insert the new item.
/// 4. Enforce age and count limits.
/// 5. Return the inserted id and the ids of any evicted items.
pub fn record_capture(
    conn: &Connection,
    item: &ClipboardItem,
    icon_cache_dir: Option<&Path>,
    master_key: &[u8; 32],
) -> Result<CaptureResult, AppError> {
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
                        obj.insert("iconUrl".to_string(), serde_json::Value::String(icon_url));
                    }
                }
            }
        }
    }

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
        // We discard the returned DeleteResult here — the captured item
        // is the same one being re-inserted, so its image path (if any)
        // remains valid.
        let _ = delete_item(conn, &dup.id, master_key)?;
    }

    add_item(conn, &new_item, master_key)?;
    let evicted_ids = cleanup(conn, MAX_HISTORY_AGE_MS, MAX_HISTORY_ITEMS)?;

    Ok(CaptureResult {
        inserted_id: new_item.id,
        evicted_ids,
    })
}

/// FTS-aware wrapper: insert the new row's content into the FTS index
/// and delete any dedup-replaced + cleanup-evicted rows from it. Use this
/// from IPC handlers; the bare `record_capture` exists for unit tests
/// that don't need the in-memory FTS connection.
pub fn record_capture_with_fts(
    conn: &Connection,
    item: &ClipboardItem,
    icon_cache_dir: Option<&Path>,
    master_key: &[u8; 32],
    fts: &ClipboardFts,
) -> Result<CaptureResult, AppError> {
    // Look up the dup id (if any) BEFORE record_capture deletes it, so
    // we can drop its FTS row.
    let dup = find_duplicate(
        conn,
        &item.item_type,
        item.content.as_deref(),
        &item.id,
        master_key,
    )?;
    if let Some(d) = &dup {
        fts.delete(&d.id)?;
    }
    let res = record_capture(conn, item, icon_cache_dir, master_key)?;
    // New row is in the DB now — index it.
    fts.upsert(
        &res.inserted_id,
        item.preview.as_deref(),
        item.content.as_deref(),
    )?;
    // Evicted ids from cleanup must come out of FTS too.
    fts.delete_many(&res.evicted_ids)?;
    Ok(res)
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

        let _ = delete_item(&conn, "1", &key).unwrap();
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

        let _ = clear_non_favorites(&conn, &key).unwrap();
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
        let items = get_all(&conn, &key).unwrap();

        // The inserted id is the new item
        assert_eq!(result.inserted_id, "2");
        // Only one item in history (duplicate was replaced)
        assert_eq!(items.len(), 1);
        // The new item is at the top (newest)
        assert_eq!(items[0].id, "2");
        // favorite was inherited from the original
        assert!(
            items[0].favorite,
            "favorite should be preserved from the duplicate"
        );
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
        let items = get_all(&conn, &key).unwrap();

        // The inserted id is the new item
        assert_eq!(result.inserted_id, "2");
        // Only one item — the duplicate was removed and the new one inserted
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2");
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
        let items = get_all(&conn, &key).unwrap();

        // The inserted id is the new item
        assert_eq!(result.inserted_id, "2");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "2"); // newest first
        assert_eq!(items[1].id, "1");
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
        assert!(
            items[0].content.is_none(),
            "legacy plaintext content surfaces as None"
        );
        assert!(
            items[0].preview.is_none(),
            "legacy plaintext preview surfaces as None"
        );
    }

    #[test]
    fn test_find_duplicate_works_with_encryption() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "duplicate me", true), &key).unwrap();

        let found =
            find_duplicate(&conn, "text", Some("duplicate me"), "different-id", &key).unwrap();
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

        let _ = delete_item(&conn, "42", &key).unwrap();

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

        let _ = clear_non_favorites(&conn, &key).unwrap();

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
        assert!(
            fav_row.is_none(),
            "favorite id 20 must not appear in journal"
        );

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
            add_item(
                &conn,
                &make_item(&i.to_string(), &format!("item {i}"), false),
                &key,
            )
            .unwrap();
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
        assert!(
            row.is_some(),
            "journal row must exist for replaced id 'old'"
        );
        let (is_tombstone, is_dirty, _) = row.unwrap();
        assert!(
            is_tombstone,
            "'old' must be tombstoned after dedup replacement"
        );
        assert!(is_dirty, "'old' must be dirty");
    }

    // ── get_recent tests ────────────────────────────────────────────────────

    #[test]
    fn get_recent_returns_favorites_plus_newest_n_non_favorites() {
        let conn = setup();
        let key = test_key();

        // 3 favorites (ids 100, 101, 102 — created_at 1100, 1101, 1102)
        for i in 0..3usize {
            let mut item = make_item(&format!("fav{i}"), &format!("fav content {i}"), true);
            item.created_at = 1100.0 + i as f64;
            add_item(&conn, &item, &key).unwrap();
        }
        // 5 non-favorites (ids 200–204 — created_at 2000–2004)
        for i in 0..5usize {
            let mut item = make_item(&format!("non{i}"), &format!("non content {i}"), false);
            item.created_at = 2000.0 + i as f64;
            add_item(&conn, &item, &key).unwrap();
        }

        let items = get_recent(&conn, 2, &key).unwrap();
        // All 3 favorites + the 2 newest non-favorites = 5
        assert_eq!(
            items.len(),
            5,
            "expected 3 favorites + 2 newest non-favorites"
        );
        let fav_count = items.iter().filter(|i| i.favorite).count();
        assert_eq!(fav_count, 3);
        let non_fav: Vec<_> = items.iter().filter(|i| !i.favorite).collect();
        assert_eq!(non_fav.len(), 2);
        // The 2 newest non-favorites are non3 (created_at 2003) and non4 (2004)
        let non_ids: Vec<&str> = non_fav.iter().map(|i| i.id.as_str()).collect();
        assert!(non_ids.contains(&"non3"), "non3 must be included");
        assert!(non_ids.contains(&"non4"), "non4 must be included");
    }

    #[test]
    fn get_recent_orders_favorites_before_non_favorites_then_newest_first() {
        let conn = setup();
        let key = test_key();

        // 2 favorites with old timestamps
        let mut fav_a = make_item("fav_a", "fav a", true);
        fav_a.created_at = 500.0;
        add_item(&conn, &fav_a, &key).unwrap();
        let mut fav_b = make_item("fav_b", "fav b", true);
        fav_b.created_at = 600.0;
        add_item(&conn, &fav_b, &key).unwrap();

        // 3 non-favorites with newer timestamps
        for i in 0..3usize {
            let mut item = make_item(&format!("nf{i}"), &format!("nf {i}"), false);
            item.created_at = 3000.0 + i as f64;
            add_item(&conn, &item, &key).unwrap();
        }

        let items = get_recent(&conn, 10, &key).unwrap();
        assert_eq!(items.len(), 5);
        // First 2 must be favorites
        assert!(items[0].favorite, "items[0] must be a favorite");
        assert!(items[1].favorite, "items[1] must be a favorite");
        // Favorites ordered newest-first among themselves
        assert!(
            items[0].created_at >= items[1].created_at,
            "favorites must be sorted created_at DESC"
        );
        // Remaining 3 must be non-favorites
        for item in &items[2..] {
            assert!(!item.favorite, "items[2..] must all be non-favorites");
        }
        // Non-favorites ordered newest-first
        assert!(
            items[2].created_at >= items[3].created_at,
            "non-favorites must be sorted created_at DESC"
        );
    }

    #[test]
    fn get_recent_with_zero_limit_returns_only_favorites() {
        let conn = setup();
        let key = test_key();

        let mut fav0 = make_item("f0", "fav 0", true);
        fav0.created_at = 1000.0;
        add_item(&conn, &fav0, &key).unwrap();
        let mut fav1 = make_item("f1", "fav 1", true);
        fav1.created_at = 2000.0;
        add_item(&conn, &fav1, &key).unwrap();

        for i in 0..5usize {
            let mut item = make_item(&format!("n{i}"), &format!("non {i}"), false);
            item.created_at = 3000.0 + i as f64;
            add_item(&conn, &item, &key).unwrap();
        }

        let items = get_recent(&conn, 0, &key).unwrap();
        assert_eq!(items.len(), 2, "limit=0 must return only the 2 favorites");
        assert!(
            items.iter().all(|i| i.favorite),
            "all returned items must be favorites"
        );
    }

    #[test]
    fn get_recent_decrypts_content_and_preview() {
        let conn = setup();
        let key = test_key();

        let mut item = make_item("decrypt_me", "secret content", false);
        item.preview = Some("secret preview".to_string());
        item.created_at = 5000.0;
        add_item(&conn, &item, &key).unwrap();

        let items = get_recent(&conn, 5, &key).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].content.as_deref(),
            Some("secret content"),
            "content must be decrypted"
        );
        assert_eq!(
            items[0].preview.as_deref(),
            Some("secret preview"),
            "preview must be decrypted"
        );
    }

    #[test]
    fn get_recent_returns_empty_when_table_empty() {
        let conn = setup();
        let key = test_key();

        let items = get_recent(&conn, 10, &key).unwrap();
        assert_eq!(items.len(), 0, "empty table must yield empty result");
    }

    #[test]
    fn init_table_adds_content_hash_column() {
        let conn = Connection::open_in_memory().unwrap();
        // Pre-create with the old schema (no content_hash column).
        conn.execute_batch(
            "CREATE TABLE clipboard_items (
                id TEXT PRIMARY KEY,
                item_type TEXT NOT NULL,
                content TEXT,
                preview TEXT,
                created_at REAL NOT NULL,
                favorite INTEGER NOT NULL DEFAULT 0,
                metadata TEXT,
                source_app TEXT,
                redacted_kinds TEXT
            );",
        )
        .unwrap();

        init_table(&conn).unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('clipboard_items') WHERE name='content_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "content_hash column must be added");

        // Idempotent — second call must not fail.
        init_table(&conn).unwrap();
    }

    #[test]
    fn add_item_populates_content_hash_for_text() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("1", "hello world", false), &key).unwrap();

        let hash: Option<Vec<u8>> = conn
            .query_row(
                "SELECT content_hash FROM clipboard_items WHERE id = '1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let hash = hash.expect("content_hash must be set");
        assert_eq!(hash.len(), 32, "HMAC-SHA256 output is 32 bytes");

        // Same content + same type + same key → same hash (deterministic).
        add_item(&conn, &make_item("2", "hello world", true), &key).unwrap();
        let hash2: Vec<u8> = conn
            .query_row(
                "SELECT content_hash FROM clipboard_items WHERE id = '2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hash, hash2);
    }

    #[test]
    fn add_item_leaves_content_hash_null_for_images() {
        let conn = setup();
        let key = test_key();
        let mut img = make_item("img-1", "/path/to/img.png", false);
        img.item_type = "image".to_string();
        add_item(&conn, &img, &key).unwrap();

        let hash: Option<Vec<u8>> = conn
            .query_row(
                "SELECT content_hash FROM clipboard_items WHERE id = 'img-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(hash.is_none(), "image rows have NULL content_hash");
    }

    #[test]
    fn find_duplicate_uses_indexed_hash_not_decrypt_scan() {
        let conn = setup();
        let key = test_key();
        // Insert 50 rows of the same type, all with distinct content.
        for i in 0..50u32 {
            add_item(
                &conn,
                &make_item(&i.to_string(), &format!("content-{i}"), false),
                &key,
            )
            .unwrap();
        }
        // The needle is row 42.
        let found = find_duplicate(&conn, "text", Some("content-42"), "any-id", &key).unwrap();
        assert!(found.is_some(), "hash lookup must match the row");
        assert_eq!(found.unwrap().id, "42");

        // A miss must return None.
        let miss = find_duplicate(&conn, "text", Some("not present"), "any-id", &key).unwrap();
        assert!(miss.is_none());
    }

    #[test]
    fn find_duplicate_returns_none_for_legacy_null_hash_rows() {
        let conn = setup();
        let key = test_key();
        // Insert a legacy row by going around add_item — content_hash stays NULL.
        let encrypted = crate::crypto::cipher::encrypt("legacy content", &key).unwrap();
        conn.execute(
            "INSERT INTO clipboard_items
                (id, item_type, content, preview, created_at, favorite)
             VALUES ('legacy', 'text', ?1, NULL, 1.0, 0)",
            params![encrypted],
        )
        .unwrap();

        // Hash-lookup miss is expected — the row exists but has no hash yet.
        let found = find_duplicate(&conn, "text", Some("legacy content"), "any", &key).unwrap();
        assert!(
            found.is_none(),
            "rows with NULL content_hash must not match (rebuild will backfill)"
        );
    }

    #[test]
    fn init_table_creates_composite_and_hash_indices() {
        let conn = setup();
        // The composite + hash indices must exist after init_table.
        let names: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='clipboard_items'",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(
            names.contains(&"idx_clipboard_fav_created_id".to_string()),
            "composite index must exist; got {names:?}"
        );
        assert!(
            names.contains(&"idx_clipboard_hash".to_string()),
            "content_hash index must exist; got {names:?}"
        );
        // Legacy indices are gone.
        assert!(
            !names.contains(&"idx_clipboard_created_at".to_string()),
            "legacy idx_clipboard_created_at must be removed"
        );
        assert!(
            !names.contains(&"idx_clipboard_favorite".to_string()),
            "legacy idx_clipboard_favorite must be removed"
        );
    }

    #[test]
    fn list_item_excludes_content_decrypt() {
        let conn = setup();
        let key = test_key();
        let mut item = make_item("1", "secret content body", false);
        item.preview = Some("short preview".into());
        add_item(&conn, &item, &key).unwrap();

        let row: ClipboardListItem = conn
            .query_row(
                "SELECT id, item_type, preview, created_at, favorite,
                        metadata, source_app, redacted_kinds
                   FROM clipboard_items WHERE id = '1'",
                [],
                list_row_to_item_factory(&key),
            )
            .unwrap();

        assert_eq!(row.id, "1");
        assert_eq!(row.preview.as_deref(), Some("short preview"));
        // ClipboardListItem has no `content` field — this is the compile-time guarantee.
    }

    #[test]
    fn list_initial_returns_all_favorites_plus_n_newest_non_favorites_with_cursor() {
        let conn = setup();
        let key = test_key();

        // 2 favorites at older timestamps.
        let mut fa = make_item("fa", "fav a", true);
        fa.created_at = 500.0;
        let mut fb = make_item("fb", "fav b", true);
        fb.created_at = 600.0;
        add_item(&conn, &fa, &key).unwrap();
        add_item(&conn, &fb, &key).unwrap();
        // 5 non-favorites with newer timestamps.
        for i in 0..5u32 {
            let mut nf = make_item(&format!("n{i}"), &format!("nf {i}"), false);
            nf.created_at = 3000.0 + i as f64;
            add_item(&conn, &nf, &key).unwrap();
        }

        let page = list_initial(&conn, 3, &key).unwrap();
        assert_eq!(page.favorites.len(), 2);
        assert_eq!(page.recent.len(), 3, "limit honoured for non-favorites");
        // Cursor points at the oldest non-favorite in the page (n2 with created_at 3002).
        let cursor = page
            .next_cursor
            .expect("more rows exist, cursor must be set");
        assert_eq!(cursor.created_at, 3002.0);
        assert_eq!(cursor.id, "n2");

        // Page fits entirely → no cursor.
        let full = list_initial(&conn, 10, &key).unwrap();
        assert_eq!(full.recent.len(), 5);
        assert!(full.next_cursor.is_none(), "no cursor when everything fits");
    }

    #[test]
    fn list_older_returns_strictly_older_non_favorites() {
        let conn = setup();
        let key = test_key();
        // 10 non-favorites with strictly increasing timestamps.
        for i in 0..10u32 {
            let mut nf = make_item(&format!("n{i}"), &format!("nf {i}"), false);
            nf.created_at = 1000.0 + i as f64;
            add_item(&conn, &nf, &key).unwrap();
        }

        let first = list_initial(&conn, 3, &key).unwrap();
        assert_eq!(first.recent.len(), 3);
        let cursor = first.next_cursor.unwrap();
        let next = list_older(&conn, &cursor, 3, &key).unwrap();
        assert_eq!(next.items.len(), 3);
        // Combined ids of the two pages must be disjoint.
        let first_ids: std::collections::HashSet<&str> =
            first.recent.iter().map(|r| r.id.as_str()).collect();
        for row in &next.items {
            assert!(
                !first_ids.contains(row.id.as_str()),
                "older page must not duplicate first-page rows"
            );
        }
    }

    #[test]
    fn list_older_cursor_handles_duplicate_timestamps_via_id_tiebreaker() {
        let conn = setup();
        let key = test_key();
        // Three rows at the exact same timestamp with different ids.
        for id in ["a", "b", "c"] {
            let mut nf = make_item(id, &format!("content {id}"), false);
            nf.created_at = 5000.0;
            add_item(&conn, &nf, &key).unwrap();
        }
        // Load 2, then ask for the 3rd via cursor.
        let first = list_initial(&conn, 2, &key).unwrap();
        assert_eq!(first.recent.len(), 2);
        let cursor = first.next_cursor.unwrap();
        let next = list_older(&conn, &cursor, 5, &key).unwrap();
        assert_eq!(next.items.len(), 1, "exactly one row past the cursor");
        // The remaining row must be the one with the smallest id.
        let seen: std::collections::HashSet<String> = first
            .recent
            .iter()
            .map(|r| r.id.clone())
            .chain(next.items.iter().map(|r| r.id.clone()))
            .collect();
        assert_eq!(
            seen,
            ["a", "b", "c"].into_iter().map(String::from).collect()
        );
    }

    #[test]
    fn get_item_returns_full_decrypted_row_by_id() {
        let conn = setup();
        let key = test_key();
        let mut it = make_item("solo", "full text body", false);
        it.preview = Some("preview".into());
        add_item(&conn, &it, &key).unwrap();

        let got = get_item(&conn, "solo", &key).unwrap().unwrap();
        assert_eq!(got.id, "solo");
        assert_eq!(got.content.as_deref(), Some("full text body"));
        assert_eq!(got.preview.as_deref(), Some("preview"));

        let missing = get_item(&conn, "does-not-exist", &key).unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn count_returns_total_and_favorites_without_loading_rows() {
        let conn = setup();
        let key = test_key();
        for i in 0..5u32 {
            add_item(
                &conn,
                &make_item(&i.to_string(), &format!("c{i}"), i % 2 == 0),
                &key,
            )
            .unwrap();
        }
        let c = count(&conn).unwrap();
        assert_eq!(c.total, 5);
        assert_eq!(c.favorites, 3, "ids 0/2/4 are favorites");
    }

    #[test]
    fn export_for_sync_walks_all_rows_in_pages() {
        let conn = setup();
        let key = test_key();
        for i in 0..7u32 {
            let mut it = make_item(&i.to_string(), &format!("body {i}"), false);
            it.created_at = 1000.0 + i as f64;
            add_item(&conn, &it, &key).unwrap();
        }

        let mut all = Vec::new();
        let mut cursor = None;
        loop {
            let page = export_for_sync(&conn, cursor.as_ref(), 3, &key).unwrap();
            all.extend(page.items);
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(all.len(), 7);
        // Content must be decrypted — sync needs plaintext.
        assert!(all.iter().all(|i| i.content.is_some()));
        // Order is newest-first.
        let cas: Vec<f64> = all.iter().map(|i| i.created_at).collect();
        let mut sorted = cas.clone();
        sorted.sort_by(|a, b| b.partial_cmp(a).unwrap());
        assert_eq!(cas, sorted);
    }

    #[test]
    fn delete_item_returns_image_path_for_image_rows() {
        let conn = setup();
        let key = test_key();
        let mut img = make_item("img-1", "/cache/img-1.png", false);
        img.item_type = "image".to_string();
        add_item(&conn, &img, &key).unwrap();

        let res = delete_item(&conn, "img-1", &key).unwrap();
        assert_eq!(res.image_content_path.as_deref(), Some("/cache/img-1.png"));
    }

    #[test]
    fn delete_item_returns_none_for_text_rows() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("t1", "text body", false), &key).unwrap();

        let res = delete_item(&conn, "t1", &key).unwrap();
        assert!(res.image_content_path.is_none());
    }

    #[test]
    fn delete_item_with_missing_id_returns_none_and_tombstones() {
        let conn = setup();
        let key = test_key();

        // No row exists with this id.
        let res = delete_item(&conn, "ghost", &key).unwrap();
        assert!(res.image_content_path.is_none(), "no row, no image path");

        // A tombstone is still written — current contract, intentional for
        // cloud-sync idempotency on cross-device delete races.
        let row = journal_row(&conn, "ghost");
        assert!(
            row.is_some(),
            "tombstone written even for a never-existing id"
        );
        let (is_tombstone, is_dirty, _) = row.unwrap();
        assert!(is_tombstone);
        assert!(is_dirty);
    }

    #[test]
    fn clear_non_favorites_returns_removed_ids_and_image_paths() {
        let conn = setup();
        let key = test_key();
        add_item(&conn, &make_item("t1", "text", false), &key).unwrap();
        let mut img = make_item("img1", "/cache/img1.png", false);
        img.item_type = "image".to_string();
        add_item(&conn, &img, &key).unwrap();
        add_item(&conn, &make_item("favtext", "fav body", true), &key).unwrap();

        let res = clear_non_favorites(&conn, &key).unwrap();
        let mut ids = res.removed_ids.clone();
        ids.sort();
        assert_eq!(ids, vec!["img1".to_string(), "t1".to_string()]);
        assert_eq!(res.removed_image_paths, vec!["/cache/img1.png".to_string()]);
    }

    #[test]
    fn record_capture_returns_inserted_id_only_not_full_list() {
        let conn = setup();
        let key = test_key();
        for i in 0..5u32 {
            add_item(
                &conn,
                &make_item(&format!("seed{i}"), &format!("body {i}"), false),
                &key,
            )
            .unwrap();
        }

        let mut new_item = make_item("fresh", "new body", false);
        new_item.created_at = 9999.0;
        let res = record_capture(&conn, &new_item, None, &key).unwrap();
        assert_eq!(res.inserted_id, "fresh");
        assert!(
            res.evicted_ids.is_empty(),
            "no eviction at 6 rows < MAX_HISTORY_ITEMS"
        );
    }

    #[test]
    fn cleanup_returns_evicted_ids() {
        let conn = setup();
        let key = test_key();
        for i in 0..6u32 {
            let mut it = make_item(&i.to_string(), &format!("body {i}"), false);
            it.created_at = 1000.0 + i as f64;
            add_item(&conn, &it, &key).unwrap();
        }
        // Keep only the 2 newest non-favorites.
        let evicted = cleanup(&conn, MAX_HISTORY_AGE_MS, 2).unwrap();
        let mut ids: Vec<String> = evicted.into_iter().collect();
        ids.sort();
        // Newest 2 survive (ids "4" and "5"), the other 4 are evicted (ids "0","1","2","3").
        assert_eq!(
            ids,
            vec![
                "0".to_string(),
                "1".to_string(),
                "2".to_string(),
                "3".to_string()
            ]
        );
    }

    fn setup_with_fts() -> (Connection, crate::storage::clipboard_fts::ClipboardFts) {
        let conn = setup();
        let fts = crate::storage::clipboard_fts::ClipboardFts::new_in_memory().unwrap();
        (conn, fts)
    }

    #[test]
    fn record_capture_inserts_into_fts() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        let mut item = make_item("c1", "searchable apple body", false);
        item.preview = Some("preview apple".into());
        record_capture_with_fts(&conn, &item, None, &key, &fts).unwrap();

        let hits = fts.search("apple", 10).unwrap();
        assert_eq!(hits, vec!["c1".to_string()]);
    }

    #[test]
    fn delete_item_with_fts_removes_from_index() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        let item = make_item("c1", "banana body", false);
        record_capture_with_fts(&conn, &item, None, &key, &fts).unwrap();
        assert!(!fts.search("banana", 10).unwrap().is_empty());

        delete_item_with_fts(&conn, "c1", &key, &fts).unwrap();
        assert!(fts.search("banana", 10).unwrap().is_empty());
    }

    #[test]
    fn clear_non_favorites_with_fts_clears_only_non_favorite_fts_rows() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        record_capture_with_fts(
            &conn,
            &make_item("nf", "carrot body", false),
            None,
            &key,
            &fts,
        )
        .unwrap();
        let mut fav = make_item("favid", "carrot favorite", true);
        fav.created_at = 2000.0;
        record_capture_with_fts(&conn, &fav, None, &key, &fts).unwrap();

        clear_non_favorites_with_fts(&conn, &key, &fts).unwrap();
        let hits = fts.search("carrot", 10).unwrap();
        assert_eq!(hits, vec!["favid".to_string()]);
    }

    #[test]
    fn capture_dedup_replaces_old_fts_row() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        let mut old = make_item("old", "duplicate body", false);
        old.created_at = 1000.0;
        record_capture_with_fts(&conn, &old, None, &key, &fts).unwrap();

        let mut new = make_item("new", "duplicate body", false);
        new.created_at = 2000.0;
        record_capture_with_fts(&conn, &new, None, &key, &fts).unwrap();

        let hits = fts.search("duplicate", 10).unwrap();
        assert_eq!(
            hits,
            vec!["new".to_string()],
            "old row removed from FTS, new row inserted"
        );
    }

    #[test]
    fn max_history_items_is_fifty_thousand() {
        assert_eq!(MAX_HISTORY_ITEMS, 50_000);
    }

    #[test]
    fn search_returns_list_items_for_fts_matches() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        for i in 0..10u32 {
            let mut it = make_item(&i.to_string(), &format!("body apple {i}"), false);
            it.created_at = 1000.0 + i as f64;
            record_capture_with_fts(&conn, &it, None, &key, &fts).unwrap();
        }
        let mut other = make_item("z", "body banana z", false);
        other.created_at = 2000.0;
        record_capture_with_fts(&conn, &other, None, &key, &fts).unwrap();

        // Ready required.
        crate::storage::clipboard_fts::mark_ready();

        let res = search(&conn, &fts, "apple", 20, &key).unwrap();
        assert_eq!(res.items.len(), 10);
        assert!(res.items.iter().all(|i| i.id != "z"));
        assert_eq!(res.index_state, "ready");

        // Clean up for other tests.
        crate::storage::clipboard_fts::FTS_READY.store(false, std::sync::atomic::Ordering::Release);
    }

    #[test]
    fn search_returns_empty_when_index_not_ready() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        crate::storage::clipboard_fts::FTS_READY.store(false, std::sync::atomic::Ordering::Release);
        let res = search(&conn, &fts, "anything", 20, &key).unwrap();
        assert_eq!(res.index_state, "indexing");
        assert!(res.items.is_empty());
    }
}
