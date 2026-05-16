//! In-memory FTS5 index over decrypted clipboard preview + content.
//!
//! Lives in a separate SQLite `:memory:` connection so the on-disk
//! clipboard database stays opaque ciphertext while search still works.
//! Rebuilt at process start (see `lib.rs::setup_app` — added in Task 17)
//! by streaming every row of `clipboard_items`, decrypting, and inserting
//! here. Kept in sync at steady state by every mutation in `storage::clipboard`.

use crate::error::AppError;
use rusqlite::{params, Connection};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Set to `true` when `rebuild_from_disk` completes. Search queries
/// arriving before this is true return `{ items: [], indexState:
/// "indexing" }` so the UI can show a hint.
pub static FTS_READY: AtomicBool = AtomicBool::new(false);

pub fn is_ready() -> bool {
    FTS_READY.load(Ordering::Acquire)
}

pub fn mark_ready() {
    FTS_READY.store(true, Ordering::Release);
}

/// Walk every clipboard row newest-first, decrypt content + preview,
/// insert into FTS, and backfill `content_hash` for rows where it's NULL.
/// Idempotent on the FTS side (INSERT OR REPLACE) and on the hash-backfill
/// side (only writes rows with NULL hash).
///
/// One disk read pass produces three outputs: FTS index entries, hash
/// backfill for legacy rows, and a deterministic done-state.
pub fn rebuild_from_disk(
    conn: &Connection,
    fts: &ClipboardFts,
    master_key: &[u8; 32],
) -> Result<(), AppError> {
    use crate::crypto::cipher;

    let mut stmt = conn
        .prepare(
            "SELECT id, item_type, content, preview, content_hash \
               FROM clipboard_items ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| AppError::Database(format!("FTS rebuild prepare: {e}")))?;

    struct Row {
        id: String,
        item_type: String,
        raw_content: Option<String>,
        raw_preview: Option<String>,
        existing_hash: Option<Vec<u8>>,
    }

    let rows: Vec<Row> = stmt
        .query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                item_type: r.get(1)?,
                raw_content: r.get(2)?,
                raw_preview: r.get(3)?,
                existing_hash: r.get(4)?,
            })
        })
        .map_err(|e| AppError::Database(format!("FTS rebuild query: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    let mut hash_writes: Vec<(String, Vec<u8>)> = Vec::new();

    for row in &rows {
        let content = row.raw_content.as_ref().and_then(|v| {
            if cipher::is_encrypted_value(v) {
                cipher::decrypt(v, master_key).ok()
            } else {
                None
            }
        });
        let preview = row.raw_preview.as_ref().and_then(|v| {
            if cipher::is_encrypted_value(v) {
                cipher::decrypt(v, master_key).ok()
            } else {
                None
            }
        });
        fts.upsert(&row.id, preview.as_deref(), content.as_deref())?;

        if row.existing_hash.is_none() && row.item_type != "image" {
            if let Some(c) = content.as_deref() {
                let hash = crate::crypto::hmac::hmac_sha256(
                    master_key,
                    format!("{}\n{}", row.item_type, c).as_bytes(),
                );
                hash_writes.push((row.id.clone(), hash.to_vec()));
            }
        }
    }

    // Batch the hash backfill in a single transaction so it's atomic.
    if !hash_writes.is_empty() {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| AppError::Database(format!("FTS rebuild hash tx: {e}")))?;
        {
            let mut stmt = tx
                .prepare("UPDATE clipboard_items SET content_hash = ?1 WHERE id = ?2")
                .map_err(|e| AppError::Database(format!("FTS rebuild hash prepare: {e}")))?;
            for (id, hash) in &hash_writes {
                stmt.execute(params![&hash[..], id])
                    .map_err(|e| AppError::Database(format!("FTS rebuild hash row: {e}")))?;
            }
        }
        tx.commit()
            .map_err(|e| AppError::Database(format!("FTS rebuild hash commit: {e}")))?;
    }

    Ok(())
}

/// Hash a clipboard id (`String`) to a stable i64 used as the FTS rowid.
/// Required because FTS5 rowids must be integers; clipboard ids are UUIDs.
/// Collision rate at 50k entries is negligible (birthday bound ≈ 2^-32 over 50k inserts).
pub fn rowid_for(id: &str) -> i64 {
    use std::hash::{BuildHasher, BuildHasherDefault, Hasher};
    let mut hasher = BuildHasherDefault::<std::collections::hash_map::DefaultHasher>::new()
        .build_hasher();
    hasher.write(id.as_bytes());
    hasher.finish() as i64
}

pub struct ClipboardFts {
    conn: Mutex<Connection>,
}

impl ClipboardFts {
    pub fn new_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()
            .map_err(|e| AppError::Database(format!("Failed to open FTS memory DB: {e}")))?;
        conn.execute_batch(
            "CREATE VIRTUAL TABLE fts_clipboard USING fts5(
                clip_id UNINDEXED,
                preview, content,
                prefix='2 3',
                tokenize='unicode61 remove_diacritics 2'
            );",
        )
        .map_err(|e| AppError::Database(format!("Failed to create FTS table: {e}")))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Insert or replace the FTS row for a clipboard id.
    pub fn upsert(&self, id: &str, preview: Option<&str>, content: Option<&str>) -> Result<(), AppError> {
        let rowid = rowid_for(id);
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        conn.execute(
            "INSERT OR REPLACE INTO fts_clipboard(rowid, clip_id, preview, content) \
             VALUES (?1, ?2, ?3, ?4)",
            params![rowid, id, preview.unwrap_or(""), content.unwrap_or("")],
        )
        .map_err(|e| AppError::Database(format!("FTS upsert: {e}")))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let rowid = rowid_for(id);
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        conn.execute("DELETE FROM fts_clipboard WHERE rowid = ?1", params![rowid])
            .map_err(|e| AppError::Database(format!("FTS delete: {e}")))?;
        Ok(())
    }

    /// Bulk delete used by cleanup / clear_non_favorites.
    pub fn delete_many(&self, ids: &[String]) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        let tx = conn.unchecked_transaction()
            .map_err(|e| AppError::Database(format!("FTS delete_many tx: {e}")))?;
        {
            let mut stmt = tx
                .prepare("DELETE FROM fts_clipboard WHERE rowid = ?1")
                .map_err(|e| AppError::Database(format!("FTS delete_many prepare: {e}")))?;
            for id in ids {
                stmt.execute(params![rowid_for(id)])
                    .map_err(|e| AppError::Database(format!("FTS delete_many row: {e}")))?;
            }
        }
        tx.commit().map_err(|e| AppError::Database(format!("FTS delete_many commit: {e}")))?;
        Ok(())
    }

    /// FTS5 MATCH with bm25 ranking. Returns the original clipboard ids
    /// (strings, taken from the UNINDEXED `clip_id` column) ordered
    /// best-match first. Caller JOINs to `clipboard_items` for the row
    /// payload.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<String>, AppError> {
        let sanitized = sanitize_for_fts5(query);
        if sanitized.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        let ids: Vec<String> = conn
            .prepare(
                "SELECT clip_id FROM fts_clipboard \
                  WHERE fts_clipboard MATCH ?1 \
                  ORDER BY bm25(fts_clipboard) LIMIT ?2",
            )
            .map_err(|e| AppError::Database(format!("FTS search prepare: {e}")))?
            .query_map(params![sanitized, limit as i64], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(format!("FTS search query: {e}")))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }
}

/// Turn a free-form user query into an FTS5 MATCH expression that does
/// prefix matching on every token.
///
/// FTS5's MATCH operator treats query terms as **exact tokens** by
/// default — `MATCH 'appl'` will not match a document containing
/// `apple`. Without prefix matching, an as-you-type search appears
/// broken: nothing matches until the user types a complete indexed
/// word. Appending `*` to each token (`appl*`) enables prefix matching,
/// so results refine smoothly as the user types.
///
/// Reserved FTS5 syntax characters (`" ( ) * : '`) are also dropped so
/// arbitrary user input cannot trigger an FTS5 syntax error or change
/// the query's logical structure. Multi-term queries combine with the
/// implicit AND that FTS5 already uses between bareword tokens, e.g.
/// `"apple pie"` → `apple* pie*` → rows containing both prefixes.
fn sanitize_for_fts5(query: &str) -> String {
    query
        .chars()
        .map(|c| match c {
            '"' | '*' | '(' | ')' | ':' | '\'' => ' ',
            _ => c,
        })
        .collect::<String>()
        .split_whitespace()
        .map(|tok| format!("{tok}*"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rowid_is_deterministic() {
        assert_eq!(rowid_for("abc"), rowid_for("abc"));
        assert_ne!(rowid_for("abc"), rowid_for("abd"));
    }

    #[test]
    fn upsert_then_search_matches() {
        let fts = ClipboardFts::new_in_memory().unwrap();
        fts.upsert("id-1", Some("greeting"), Some("hello world this is a test")).unwrap();
        fts.upsert("id-2", Some("goodbye"), Some("farewell sweet world")).unwrap();

        let hits = fts.search("hello", 10).unwrap();
        assert_eq!(hits, vec!["id-1".to_string()]);
        let hits = fts.search("world", 10).unwrap();
        // Both rows match — order is by bm25; just assert both are present.
        assert!(hits.contains(&"id-1".to_string()));
        assert!(hits.contains(&"id-2".to_string()));
    }

    #[test]
    fn delete_removes_row_from_search() {
        let fts = ClipboardFts::new_in_memory().unwrap();
        fts.upsert("id-1", None, Some("findable text")).unwrap();
        assert_eq!(fts.search("findable", 10).unwrap(), vec!["id-1".to_string()]);
        fts.delete("id-1").unwrap();
        assert!(fts.search("findable", 10).unwrap().is_empty());
    }

    #[test]
    fn delete_many_removes_all_specified_rows() {
        let fts = ClipboardFts::new_in_memory().unwrap();
        for i in 0..5u32 {
            fts.upsert(&i.to_string(), None, Some(&format!("findable {i}"))).unwrap();
        }
        fts.delete_many(&["1".to_string(), "3".to_string()]).unwrap();
        let hits = fts.search("findable", 10).unwrap();
        assert_eq!(hits.len(), 3);
        assert!(!hits.contains(&"1".to_string()));
        assert!(!hits.contains(&"3".to_string()));
    }

    #[test]
    fn empty_query_returns_empty() {
        let fts = ClipboardFts::new_in_memory().unwrap();
        fts.upsert("id-1", None, Some("anything")).unwrap();
        assert!(fts.search("   ", 10).unwrap().is_empty());
        assert!(fts.search("", 10).unwrap().is_empty());
    }

    #[test]
    fn upsert_replaces_existing_row() {
        let fts = ClipboardFts::new_in_memory().unwrap();
        fts.upsert("id-1", None, Some("apple")).unwrap();
        fts.upsert("id-1", None, Some("banana")).unwrap();
        assert!(fts.search("apple", 10).unwrap().is_empty(), "old content gone after replace");
        assert_eq!(fts.search("banana", 10).unwrap(), vec!["id-1".to_string()]);
    }

    #[test]
    fn search_matches_partial_prefix_from_first_character() {
        let fts = ClipboardFts::new_in_memory().unwrap();
        fts.upsert("id-1", None, Some("apple pie recipe")).unwrap();
        fts.upsert("id-2", None, Some("applied physics notes")).unwrap();
        fts.upsert("id-3", None, Some("banana smoothie")).unwrap();

        // Single-character query → "a*" → both "apple" and "applied"
        // share that prefix; banana also starts with "b" so it is excluded.
        let hits = fts.search("a", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.contains(&"id-1".to_string()));
        assert!(hits.contains(&"id-2".to_string()));

        // Three-char prefix — still both.
        let hits = fts.search("app", 10).unwrap();
        assert_eq!(hits.len(), 2);

        // Four-char prefix — both still match ("apple" and "applied" both
        // start with "appl").
        let hits = fts.search("appl", 10).unwrap();
        assert_eq!(hits.len(), 2);

        // Five-char prefix "apple" — only the "apple" row matches now;
        // "applied" branches off at index 4 (appli…, not apple…).
        let hits = fts.search("apple", 10).unwrap();
        assert_eq!(hits, vec!["id-1".to_string()]);
    }

    #[test]
    fn search_multi_token_query_prefix_matches_each_token() {
        let fts = ClipboardFts::new_in_memory().unwrap();
        fts.upsert("id-1", None, Some("quarterly report summary")).unwrap();
        fts.upsert("id-2", None, Some("quarterly meeting agenda")).unwrap();
        fts.upsert("id-3", None, Some("annual report")).unwrap();

        // "quar rep" → "quar* rep*" — implicit AND, only id-1 has both prefixes.
        let hits = fts.search("quar rep", 10).unwrap();
        assert_eq!(hits, vec!["id-1".to_string()]);
    }

    #[test]
    fn search_sanitizes_fts5_special_chars() {
        let fts = ClipboardFts::new_in_memory().unwrap();
        fts.upsert("id-1", None, Some("look here please")).unwrap();
        // Without sanitization, these characters would either throw an
        // FTS5 syntax error or shift the query's semantics.
        for raw in ["(look)", "look*", "\"look\"", "look:here", "look'"] {
            let hits = fts.search(raw, 10).unwrap();
            assert!(
                hits.contains(&"id-1".to_string()),
                "query {raw:?} must still match the underlying token",
            );
        }
    }
}

#[cfg(test)]
mod rebuild_tests {
    use super::*;
    use crate::storage::clipboard::{add_item, init_table, ClipboardItem};

    fn test_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i * 11) as u8;
        }
        k
    }

    fn make_item(id: &str, content: &str) -> ClipboardItem {
        ClipboardItem {
            id: id.to_string(),
            item_type: "text".into(),
            content: Some(content.to_string()),
            preview: Some(format!("preview {id}")),
            created_at: 1000.0,
            favorite: false,
            metadata: None,
            source_app: None,
            redacted_kinds: None,
        }
    }

    #[test]
    fn rebuild_from_disk_indexes_every_row() {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        crate::storage::cloud_sync_state::init_table(&conn).unwrap();
        let key = test_key();
        for i in 0..20u32 {
            add_item(&conn, &make_item(&i.to_string(), &format!("apple {i}")), &key).unwrap();
        }
        let fts = ClipboardFts::new_in_memory().unwrap();
        rebuild_from_disk(&conn, &fts, &key).unwrap();

        let hits = fts.search("apple", 100).unwrap();
        assert_eq!(hits.len(), 20);
    }

    #[test]
    fn rebuild_backfills_null_content_hash_rows() {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        crate::storage::cloud_sync_state::init_table(&conn).unwrap();
        let key = test_key();
        // Insert a row with NULL content_hash directly (simulating a legacy row).
        let encrypted = crate::crypto::cipher::encrypt("legacy body", &key).unwrap();
        conn.execute(
            "INSERT INTO clipboard_items
                (id, item_type, content, preview, created_at, favorite, content_hash)
             VALUES ('legacy', 'text', ?1, NULL, 1.0, 0, NULL)",
            rusqlite::params![encrypted],
        )
        .unwrap();

        let fts = ClipboardFts::new_in_memory().unwrap();
        rebuild_from_disk(&conn, &fts, &key).unwrap();

        let hash: Option<Vec<u8>> = conn
            .query_row(
                "SELECT content_hash FROM clipboard_items WHERE id = 'legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(hash.is_some(), "rebuild backfilled content_hash for legacy row");
        assert_eq!(hash.unwrap().len(), 32);
    }

    #[test]
    fn is_ready_flips_on_mark_ready() {
        // Reset to a known state first (test isolation note: FTS_READY is
        // a process-wide atomic; tests that run in parallel could
        // interfere. Use #[serial] if the launcher has serial-test —
        // otherwise accept that this test only checks the API surface
        // and not the strict default).
        FTS_READY.store(false, std::sync::atomic::Ordering::Release);
        assert!(!is_ready());
        mark_ready();
        assert!(is_ready());
        // Restore for other tests.
        FTS_READY.store(false, std::sync::atomic::Ordering::Release);
    }
}
