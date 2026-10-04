//! Per-item cloud-sync journal + global pull cursor.
//!
//! Records local-only metadata for the launcher's delta-sync cloud feature:
//!
//! - `cloud_sync_items_journal` — one row per syncable item (clipboard entry,
//!   snippet, shortcut, ...). Tracks whether the item has been modified
//!   locally since the last successful upload (`is_dirty`), whether it has
//!   been deleted locally and is awaiting a tombstone push (`is_tombstone`),
//!   and the last server-confirmed content hash + version assigned by the
//!   server.
//! - `cloud_sync_cursor` — single-row table holding the maximum `server_version`
//!   this device has seen on a successful pull, plus a stable `device_id` UUID
//!   and an optional `last_full_sync_at_ms` diagnostic timestamp.
//!
//! Both tables are local-only — never synced. They store no plaintext, only
//! cryptographically opaque SHA-256 hashes of payloads. The journal is wiped
//! on logout (so a different user's cursor can't inherit our hashes) and on
//! "Restore from Cloud" (so the next push reseeds from server-authoritative
//! state). The `device_id` is preserved across `clear_all` because servers
//! use it to attribute writes to a device.
//!
//! All public functions operate on a borrowed `&Connection` and follow the
//! free-function style used elsewhere in `storage::*`.

use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One row in the per-item delta-sync journal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemJournalEntry {
    pub item_id: String,
    pub category_id: String,
    /// SHA-256 of the plaintext payload last uploaded for this item.
    /// 32 bytes when set; None if never uploaded successfully.
    pub last_uploaded_hash: Option<Vec<u8>>,
    /// Server's last assigned version for this item; None if never uploaded.
    pub server_version: Option<i64>,
    pub is_dirty: bool,
    pub is_tombstone: bool,
}

/// Singleton row in `cloud_sync_cursor`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorState {
    /// Max server version this device has seen on a successful pull.
    pub cursor: i64,
    pub device_id: String,
    pub last_full_sync_at_ms: Option<i64>,
}

/// Idempotent. On first call: creates both tables and seeds a single
/// `cloud_sync_cursor` row with `cursor=0` and a fresh `device_id` UUID.
/// On subsequent calls: leaves the seeded row untouched (the `device_id`
/// is stable across reopens).
pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cloud_sync_items_journal (
            item_id            TEXT PRIMARY KEY,
            category_id        TEXT NOT NULL,
            last_uploaded_hash BLOB,
            server_version     INTEGER,
            is_dirty           INTEGER NOT NULL DEFAULT 0,
            is_tombstone       INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS cloud_sync_cursor (
            scope                TEXT PRIMARY KEY CHECK(scope = 'global'),
            cursor               INTEGER NOT NULL DEFAULT 0,
            device_id            TEXT NOT NULL,
            last_full_sync_at_ms INTEGER
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init cloud_sync tables: {e}")))?;

    // Seed the singleton cursor row exactly once. INSERT OR IGNORE is the
    // idempotency guard: if the row exists already, this is a no-op and the
    // existing device_id is preserved.
    let device_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR IGNORE INTO cloud_sync_cursor
            (scope, cursor, device_id, last_full_sync_at_ms)
         VALUES ('global', 0, ?1, NULL)",
        params![device_id],
    )
    .map_err(|e| AppError::Database(format!("Failed to seed cloud_sync_cursor: {e}")))?;

    Ok(())
}

/// Upsert a journal entry by `item_id` (PRIMARY KEY). Validates the hash
/// length (must be 32 bytes when `Some`).
pub fn upsert_item(conn: &Connection, entry: &ItemJournalEntry) -> Result<(), AppError> {
    if let Some(hash) = entry.last_uploaded_hash.as_ref() {
        if hash.len() != 32 {
            return Err(AppError::Validation(format!(
                "last_uploaded_hash must be 32 bytes (SHA-256), got {}",
                hash.len()
            )));
        }
    }
    conn.execute(
        "INSERT OR REPLACE INTO cloud_sync_items_journal
            (item_id, category_id, last_uploaded_hash, server_version, is_dirty, is_tombstone)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            entry.item_id,
            entry.category_id,
            entry.last_uploaded_hash,
            entry.server_version,
            entry.is_dirty as i64,
            entry.is_tombstone as i64,
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to upsert journal item: {e}")))?;
    Ok(())
}

/// Set `is_dirty = 1` for the given item. If the row doesn't exist yet,
/// inserts a fresh row with the given `category_id` and all other fields
/// at their defaults — used when a TS-side provider notifies the launcher
/// that a new item has been created or an existing one mutated locally.
///
/// If the row already exists with a different `category_id`, the existing
/// category is preserved — items are immutable in their category once
/// tracked. Pass the current `category_id` from the caller; mismatches are
/// silently tolerated.
pub fn mark_dirty(conn: &Connection, item_id: &str, category_id: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO cloud_sync_items_journal
            (item_id, category_id, last_uploaded_hash, server_version, is_dirty, is_tombstone)
         VALUES (?1, ?2, NULL, NULL, 1, 0)
         ON CONFLICT(item_id) DO UPDATE SET is_dirty = 1",
        params![item_id, category_id],
    )
    .map_err(|e| AppError::Database(format!("Failed to mark journal item dirty: {e}")))?;
    Ok(())
}

/// Set `is_dirty = 1` AND clear `last_uploaded_hash` (NULL) on every
/// journal row. Used at E2EE enrolment / disable to force the next sync
/// push to re-upload every locally-tracked item under the new (or
/// removed) encryption envelope.
///
/// **Why also NULL the hash:** [`crate::sync::orchestrator::decide_uploads`]
/// defensively SKIPs items whose plaintext content hash equals their
/// `last_uploaded_hash`, on the assumption that `is_dirty` should not be
/// set without a real change. `mark_all_dirty` is a deliberate exception
/// to that assumption — the *content* hasn't changed but the envelope
/// (plaintext ↔ ciphertext) has, and the envelope is wrapped *after*
/// `decide_uploads`. If we left the hash intact, the migration push
/// would skip every row and the journal would stay dirty forever.
/// Clearing the hash makes "force re-upload" actually force re-upload.
///
/// Returns the number of rows now marked dirty so callers can log the
/// migration scale. Note: this only touches rows the launcher already
/// knows about — server-side rows with no local journal entry (e.g. from
/// long-trimmed clipboard history) are not affected and stay in their
/// pre-toggle envelope until a future "Reset E2EE" / admin-cleanup flow.
pub fn mark_all_dirty(conn: &Connection) -> Result<usize, AppError> {
    let n = conn
        .execute(
            "UPDATE cloud_sync_items_journal
                SET is_dirty = 1, last_uploaded_hash = NULL
              WHERE is_dirty = 0 OR last_uploaded_hash IS NOT NULL",
            [],
        )
        .map_err(|e| AppError::Database(format!("Failed to mark all journal rows dirty: {e}")))?;
    Ok(n)
}

/// Set `is_tombstone = 1`, `is_dirty = 1`, and clear `last_uploaded_hash`
/// (NULL). Idempotent. If the item is not yet in the journal, inserts a
/// row pre-marked as a tombstone so the next push knows to send a delete
/// for this id.
pub fn mark_tombstone(conn: &Connection, item_id: &str, category_id: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO cloud_sync_items_journal
            (item_id, category_id, last_uploaded_hash, server_version, is_dirty, is_tombstone)
         VALUES (?1, ?2, NULL, NULL, 1, 1)
         ON CONFLICT(item_id) DO UPDATE SET
            is_tombstone = 1,
            is_dirty = 1,
            last_uploaded_hash = NULL",
        params![item_id, category_id],
    )
    .map_err(|e| AppError::Database(format!("Failed to mark journal item tombstone: {e}")))?;
    Ok(())
}

/// Returns every journal row, sorted by `item_id ASC`. Used by the pull
/// path's merge step to look up the last-seen server version per item
/// without filtering on the dirty flag (a clean row may still need
/// version comparison against the incoming server record).
pub fn get_all(conn: &Connection) -> Result<Vec<ItemJournalEntry>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT item_id, category_id, last_uploaded_hash, server_version,
                    is_dirty, is_tombstone
               FROM cloud_sync_items_journal
           ORDER BY item_id ASC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare get_all query: {e}")))?;

    let rows = stmt
        .query_map([], row_to_entry)
        .map_err(|e| AppError::Database(format!("Failed to query journal: {e}")))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| AppError::Database(format!("Failed to read journal row: {e}")))?);
    }
    Ok(out)
}

/// Returns all journal rows where `is_dirty = 1`, sorted by `item_id ASC`
/// for deterministic ordering.
pub fn get_dirty(conn: &Connection) -> Result<Vec<ItemJournalEntry>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT item_id, category_id, last_uploaded_hash, server_version,
                    is_dirty, is_tombstone
               FROM cloud_sync_items_journal
              WHERE is_dirty = 1
           ORDER BY item_id ASC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare dirty query: {e}")))?;

    let rows = stmt
        .query_map([], row_to_entry)
        .map_err(|e| AppError::Database(format!("Failed to query dirty journal: {e}")))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| AppError::Database(format!("Failed to read dirty row: {e}")))?);
    }
    Ok(out)
}

/// After a successful push of `item_id` at `server_version`, records the
/// new content hash + version and clears `is_dirty`. Creates a journal
/// row if one does not yet exist (typical for the very first upload of an
/// item the launcher's never seen before — we don't pre-mark items dirty
/// in the no-`markItemDirty` design, so the journal row is born here).
///
/// `is_tombstone` is preserved when the row already exists (so the
/// post-tombstone-upload sweep via `clear_synced_tombstones` can find it).
/// New rows are created with `is_tombstone = 0` — pass a tombstone item
/// through `mark_tombstone` first if you need that flag set.
pub fn clear_dirty_after_upload(
    conn: &Connection,
    item_id: &str,
    category_id: &str,
    last_uploaded_hash: Option<&[u8]>,
    server_version: i64,
) -> Result<(), AppError> {
    if let Some(hash) = last_uploaded_hash {
        if hash.len() != 32 {
            return Err(AppError::Validation(format!(
                "last_uploaded_hash must be 32 bytes (SHA-256), got {}",
                hash.len()
            )));
        }
    }
    conn.execute(
        "INSERT INTO cloud_sync_items_journal
            (item_id, category_id, last_uploaded_hash, server_version,
             is_dirty, is_tombstone)
         VALUES (?1, ?2, ?3, ?4, 0, 0)
         ON CONFLICT(item_id) DO UPDATE SET
            last_uploaded_hash = ?3,
            server_version     = ?4,
            is_dirty           = 0",
        params![item_id, category_id, last_uploaded_hash, server_version],
    )
    .map_err(|e| AppError::Database(format!("Failed to record uploaded item: {e}")))?;
    Ok(())
}

/// Hard-deletes journal rows that are tombstones the server has fully
/// acknowledged — `is_tombstone = 1`, `is_dirty = 0`, and `server_version`
/// non-NULL. Returns the number of rows deleted.
///
/// The `is_dirty = 0` check is load-bearing. `mark_tombstone` deliberately
/// preserves the existing `server_version` so the LWW path on the next pull
/// still has the prior version available — but that means a freshly-marked
/// pending tombstone has the SAME `(is_tombstone=1, server_version=non-null)`
/// shape as a confirmed tombstone. Without the `is_dirty = 0` filter, this
/// GC (which runs at the END of the pull phase, BEFORE push) would delete
/// the journal row before the push phase had a chance to emit the
/// `PushTombstone` decision, silently losing the deletion. With the filter,
/// pending-local-tombstones (is_dirty = 1) survive the pull and reach the
/// push; only after push succeeds — when `clear_dirty_after_upload` writes
/// `is_dirty = 0` — does the next pull's GC remove them.
pub fn clear_synced_tombstones(conn: &Connection) -> Result<usize, AppError> {
    let count = conn
        .execute(
            "DELETE FROM cloud_sync_items_journal
              WHERE is_tombstone = 1
                AND is_dirty = 0
                AND server_version IS NOT NULL",
            [],
        )
        .map_err(|e| AppError::Database(format!("Failed to clear synced tombstones: {e}")))?;
    Ok(count)
}

/// Apply a record fetched from the server's pull endpoint to the local
/// journal: upsert with the server's hash + version, set `is_dirty = 0`,
/// and `is_tombstone` matching the server's `deleted` flag. `server_hash`
/// may be `None` when the server row is a tombstone.
///
/// If the row exists with a different `category_id`, the server's
/// `category_id` wins — the server is authoritative on pull.
pub fn apply_pull_record(
    conn: &Connection,
    item_id: &str,
    category_id: &str,
    server_hash: Option<&[u8]>,
    server_version: i64,
    is_tombstone: bool,
) -> Result<(), AppError> {
    if let Some(hash) = server_hash {
        if hash.len() != 32 {
            return Err(AppError::Validation(format!(
                "server_hash must be 32 bytes (SHA-256), got {}",
                hash.len()
            )));
        }
    }
    conn.execute(
        "INSERT OR REPLACE INTO cloud_sync_items_journal
            (item_id, category_id, last_uploaded_hash, server_version, is_dirty, is_tombstone)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![
            item_id,
            category_id,
            server_hash,
            server_version,
            is_tombstone as i64,
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to apply pull record: {e}")))?;
    Ok(())
}

/// Returns the singleton cursor row. Always present after `init_table`.
pub fn get_cursor(conn: &Connection) -> Result<CursorState, AppError> {
    let row = conn
        .query_row(
            "SELECT cursor, device_id, last_full_sync_at_ms
               FROM cloud_sync_cursor
              WHERE scope = 'global'",
            [],
            |row| {
                Ok(CursorState {
                    cursor: row.get(0)?,
                    device_id: row.get(1)?,
                    last_full_sync_at_ms: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Database(format!("Failed to read cursor: {e}")))?;
    row.ok_or_else(|| {
        AppError::Database("cloud_sync_cursor singleton row missing — init_table not run?".into())
    })
}

/// Updates `cursor` to `max(current, new_cursor)` (never goes backwards) and
/// sets `last_full_sync_at_ms = now_ms`. `device_id` is left untouched.
pub fn advance_cursor(conn: &Connection, new_cursor: i64, now_ms: i64) -> Result<(), AppError> {
    let updated = conn
        .execute(
            "UPDATE cloud_sync_cursor
                SET cursor               = MAX(cursor, ?1),
                    last_full_sync_at_ms = ?2
              WHERE scope = 'global'",
            params![new_cursor, now_ms],
        )
        .map_err(|e| AppError::Database(format!("Failed to advance cursor: {e}")))?;
    if updated == 0 {
        return Err(AppError::Database(
            "cloud_sync_cursor singleton row missing — init_table not run?".into(),
        ));
    }
    Ok(())
}

/// Returns the `device_id` seeded at `init_table` time. Stable across
/// reopens.
pub fn device_id(conn: &Connection) -> Result<String, AppError> {
    Ok(get_cursor(conn)?.device_id)
}

/// Wipes every row in the journal AND resets the cursor to 0 (preserving
/// `device_id`). Used on logout and on user-triggered "Restore from Cloud."
pub fn clear_all(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM cloud_sync_items_journal", [])
        .map_err(|e| AppError::Database(format!("Failed to clear journal: {e}")))?;
    conn.execute(
        "UPDATE cloud_sync_cursor
            SET cursor               = 0,
                last_full_sync_at_ms = NULL
          WHERE scope = 'global'",
        [],
    )
    .map_err(|e| AppError::Database(format!("Failed to reset cursor: {e}")))?;
    Ok(())
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<ItemJournalEntry> {
    let is_dirty: i64 = row.get(4)?;
    let is_tombstone: i64 = row.get(5)?;
    Ok(ItemJournalEntry {
        item_id: row.get(0)?,
        category_id: row.get(1)?,
        last_uploaded_hash: row.get(2)?,
        server_version: row.get(3)?,
        is_dirty: is_dirty != 0,
        is_tombstone: is_tombstone != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    fn make_hash(byte: u8) -> Vec<u8> {
        vec![byte; 32]
    }

    fn fetch_one(conn: &Connection, item_id: &str) -> Option<ItemJournalEntry> {
        conn.query_row(
            "SELECT item_id, category_id, last_uploaded_hash, server_version,
                    is_dirty, is_tombstone
               FROM cloud_sync_items_journal
              WHERE item_id = ?1",
            params![item_id],
            row_to_entry,
        )
        .optional()
        .unwrap()
    }

    #[test]
    fn init_creates_journal_and_cursor_tables() {
        let conn = setup();

        let journal_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='cloud_sync_items_journal'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(journal_count, 1, "cloud_sync_items_journal should exist");

        let cursor_table_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='cloud_sync_cursor'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cursor_table_count, 1, "cloud_sync_cursor should exist");

        let cursor = get_cursor(&conn).unwrap();
        assert_eq!(cursor.cursor, 0);
        assert!(!cursor.device_id.is_empty(), "device_id should be seeded");
        assert!(cursor.last_full_sync_at_ms.is_none());
    }

    #[test]
    fn journal_upsert_returns_existing_then_replaces() {
        let conn = setup();
        let first = ItemJournalEntry {
            item_id: "item-1".into(),
            category_id: "snippets".into(),
            last_uploaded_hash: Some(make_hash(0x01)),
            server_version: Some(7),
            is_dirty: false,
            is_tombstone: false,
        };
        upsert_item(&conn, &first).unwrap();

        let second = ItemJournalEntry {
            item_id: "item-1".into(),
            category_id: "snippets".into(),
            last_uploaded_hash: Some(make_hash(0x02)),
            server_version: Some(8),
            is_dirty: true,
            is_tombstone: false,
        };
        upsert_item(&conn, &second).unwrap();

        let got = fetch_one(&conn, "item-1").unwrap();
        assert_eq!(got, second);
    }

    #[test]
    fn journal_get_dirty_items_returns_only_dirty() {
        let conn = setup();
        upsert_item(
            &conn,
            &ItemJournalEntry {
                item_id: "b-dirty".into(),
                category_id: "snippets".into(),
                last_uploaded_hash: None,
                server_version: None,
                is_dirty: true,
                is_tombstone: false,
            },
        )
        .unwrap();
        upsert_item(
            &conn,
            &ItemJournalEntry {
                item_id: "a-dirty".into(),
                category_id: "snippets".into(),
                last_uploaded_hash: None,
                server_version: None,
                is_dirty: true,
                is_tombstone: false,
            },
        )
        .unwrap();
        upsert_item(
            &conn,
            &ItemJournalEntry {
                item_id: "c-clean".into(),
                category_id: "snippets".into(),
                last_uploaded_hash: Some(make_hash(0x42)),
                server_version: Some(1),
                is_dirty: false,
                is_tombstone: false,
            },
        )
        .unwrap();

        let dirty = get_dirty(&conn).unwrap();
        let ids: Vec<_> = dirty.iter().map(|e| e.item_id.clone()).collect();
        assert_eq!(ids, vec!["a-dirty".to_string(), "b-dirty".to_string()]);
    }

    #[test]
    fn journal_clear_dirty_flag_after_upload() {
        let conn = setup();
        mark_dirty(&conn, "item-1", "snippets").unwrap();
        assert_eq!(get_dirty(&conn).unwrap().len(), 1);

        clear_dirty_after_upload(&conn, "item-1", "snippets", Some(&make_hash(0xAB)), 42).unwrap();

        assert!(get_dirty(&conn).unwrap().is_empty());
        let row = fetch_one(&conn, "item-1").unwrap();
        assert_eq!(row.last_uploaded_hash, Some(make_hash(0xAB)));
        assert_eq!(row.server_version, Some(42));
        assert!(!row.is_dirty);
    }

    #[test]
    fn cursor_starts_at_zero() {
        let conn = setup();
        let c = get_cursor(&conn).unwrap();
        assert_eq!(c.cursor, 0);
    }

    #[test]
    fn cursor_advances_to_max_seen_version() {
        let conn = setup();
        advance_cursor(&conn, 5, 1_000).unwrap();
        assert_eq!(get_cursor(&conn).unwrap().cursor, 5);

        advance_cursor(&conn, 3, 2_000).unwrap();
        assert_eq!(
            get_cursor(&conn).unwrap().cursor,
            5,
            "must not go backwards"
        );

        advance_cursor(&conn, 9, 3_000).unwrap();
        assert_eq!(get_cursor(&conn).unwrap().cursor, 9);
    }

    #[test]
    fn init_table_does_not_clobber_existing_cursor() {
        // The intent here is "init does not clobber an existing cursor."
        // Same-connection re-init proves idempotency without needing
        // tempfile (we are not allowed to add new dependencies).
        let conn = setup();
        advance_cursor(&conn, 17, 99_000).unwrap();
        assert_eq!(get_cursor(&conn).unwrap().cursor, 17);

        // Re-call init_table — must NOT reset the cursor row.
        init_table(&conn).unwrap();

        let after = get_cursor(&conn).unwrap();
        assert_eq!(after.cursor, 17);
        assert_eq!(after.last_full_sync_at_ms, Some(99_000));
    }

    #[test]
    fn device_id_is_stable_across_reopen() {
        let conn = setup();
        let id1 = device_id(&conn).unwrap();
        assert!(!id1.is_empty());

        init_table(&conn).unwrap();
        init_table(&conn).unwrap();

        let id2 = device_id(&conn).unwrap();
        assert_eq!(id1, id2, "device_id must not regenerate on re-init");
    }

    #[test]
    fn mark_tombstone_sets_is_tombstone_and_clears_hash() {
        let conn = setup();
        // Seed an existing entry with a hash, then tombstone it.
        upsert_item(
            &conn,
            &ItemJournalEntry {
                item_id: "item-1".into(),
                category_id: "snippets".into(),
                last_uploaded_hash: Some(make_hash(0xCD)),
                server_version: Some(3),
                is_dirty: false,
                is_tombstone: false,
            },
        )
        .unwrap();

        mark_tombstone(&conn, "item-1", "snippets").unwrap();

        let row = fetch_one(&conn, "item-1").unwrap();
        assert!(row.is_tombstone);
        assert!(row.is_dirty);
        assert_eq!(row.last_uploaded_hash, None);
    }

    #[test]
    fn cleanup_after_successful_tombstone_upload_removes_journal_row() {
        let conn = setup();
        mark_tombstone(&conn, "item-1", "snippets").unwrap();
        // Server confirmed the tombstone — pass None for hash and the new
        // server_version. is_tombstone stays 1 by virtue of the UPDATE not
        // touching it.
        clear_dirty_after_upload(&conn, "item-1", "snippets", None, 12).unwrap();
        // Sanity: row still present, tombstone still 1, server_version set.
        let row = fetch_one(&conn, "item-1").unwrap();
        assert!(row.is_tombstone);
        assert!(!row.is_dirty);
        assert_eq!(row.server_version, Some(12));

        let removed = clear_synced_tombstones(&conn).unwrap();
        assert_eq!(removed, 1);
        assert!(fetch_one(&conn, "item-1").is_none());
    }

    // Regression: pending-local-tombstone GC bug.
    //
    // Before the fix, `clear_synced_tombstones` only checked
    // `is_tombstone=1 AND server_version IS NOT NULL`. That filter ALSO
    // matches a freshly-marked pending tombstone, because `mark_tombstone`
    // deliberately preserves the existing server_version (so LWW comparisons
    // on the next pull still have the prior version available). The pull
    // phase ran this GC at the END (before push), silently deleting the
    // pending tombstone before the push phase could emit a PushTombstone.
    // Result: deletes never reached the server. After the fix, GC also
    // requires `is_dirty=0` — i.e., only tombstones the server has fully
    // acknowledged are cleaned up.
    #[test]
    fn pending_local_tombstone_survives_pull_phase_gc() {
        let conn = setup();
        // Simulate the launcher's natural sequence: an item was first pulled
        // from the server (apply_pull_record sets server_version + clears
        // is_dirty), then the user deleted it locally (mark_tombstone flips
        // is_tombstone + is_dirty to 1, preserves server_version).
        apply_pull_record(&conn, "doomed", "snippets", Some(&[0xAB; 32]), 1103, false).unwrap();
        mark_tombstone(&conn, "doomed", "snippets").unwrap();

        // State before GC: pending-local-tombstone shape.
        let before = fetch_one(&conn, "doomed").unwrap();
        assert!(before.is_tombstone, "marked");
        assert!(before.is_dirty, "needs push");
        assert_eq!(before.server_version, Some(1103), "preserved from pull");

        // GC must NOT delete this row — the push hasn't happened yet.
        let removed = clear_synced_tombstones(&conn).unwrap();
        assert_eq!(
            removed, 0,
            "GC removed a pending tombstone before push had a chance to emit it"
        );
        assert!(
            fetch_one(&conn, "doomed").is_some(),
            "row must survive GC so decide_uploads can emit PushTombstone"
        );

        // After successful push, is_dirty flips to 0 and the next GC sweeps it.
        clear_dirty_after_upload(&conn, "doomed", "snippets", None, 4500).unwrap();
        let removed_now = clear_synced_tombstones(&conn).unwrap();
        assert_eq!(removed_now, 1);
        assert!(fetch_one(&conn, "doomed").is_none());
    }

    #[test]
    fn upsert_rejects_non_32_byte_hash() {
        let conn = setup();
        let bad = ItemJournalEntry {
            item_id: "item-1".into(),
            category_id: "snippets".into(),
            last_uploaded_hash: Some(vec![0u8; 16]),
            server_version: None,
            is_dirty: false,
            is_tombstone: false,
        };
        let err = upsert_item(&conn, &bad).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn apply_pull_record_handles_tombstone_with_null_hash() {
        let conn = setup();
        apply_pull_record(&conn, "item-1", "snippets", None, 5, true).unwrap();

        let row = fetch_one(&conn, "item-1").unwrap();
        assert_eq!(row.item_id, "item-1");
        assert_eq!(row.category_id, "snippets");
        assert_eq!(row.last_uploaded_hash, None);
        assert_eq!(row.server_version, Some(5));
        assert!(!row.is_dirty);
        assert!(row.is_tombstone);
    }

    #[test]
    fn apply_pull_record_with_hash_sets_clean_row() {
        let conn = setup();
        apply_pull_record(
            &conn,
            "item-1",
            "snippets",
            Some(&make_hash(0x77)),
            9,
            false,
        )
        .unwrap();

        let row = fetch_one(&conn, "item-1").unwrap();
        assert_eq!(row.last_uploaded_hash, Some(make_hash(0x77)));
        assert_eq!(row.server_version, Some(9));
        assert!(!row.is_dirty);
        assert!(!row.is_tombstone);
    }

    #[test]
    fn clear_all_resets_cursor_but_preserves_device_id() {
        let conn = setup();
        let original_device = device_id(&conn).unwrap();

        upsert_item(
            &conn,
            &ItemJournalEntry {
                item_id: "x".into(),
                category_id: "snippets".into(),
                last_uploaded_hash: Some(make_hash(0x01)),
                server_version: Some(1),
                is_dirty: true,
                is_tombstone: false,
            },
        )
        .unwrap();
        advance_cursor(&conn, 100, 99_000).unwrap();

        clear_all(&conn).unwrap();

        assert!(get_dirty(&conn).unwrap().is_empty());
        assert!(fetch_one(&conn, "x").is_none());

        let cursor = get_cursor(&conn).unwrap();
        assert_eq!(cursor.cursor, 0);
        assert_eq!(cursor.last_full_sync_at_ms, None);
        assert_eq!(cursor.device_id, original_device);
    }

    #[test]
    fn mark_dirty_creates_row_when_absent() {
        let conn = setup();
        mark_dirty(&conn, "fresh-item", "snippets").unwrap();

        let row = fetch_one(&conn, "fresh-item").unwrap();
        assert_eq!(row.item_id, "fresh-item");
        assert_eq!(row.category_id, "snippets");
        assert!(row.is_dirty);
        assert!(!row.is_tombstone);
        assert_eq!(row.last_uploaded_hash, None);
        assert_eq!(row.server_version, None);
    }

    #[test]
    fn mark_dirty_preserves_existing_metadata_and_only_flips_flag() {
        let conn = setup();
        upsert_item(
            &conn,
            &ItemJournalEntry {
                item_id: "item-1".into(),
                category_id: "snippets".into(),
                last_uploaded_hash: Some(make_hash(0x55)),
                server_version: Some(4),
                is_dirty: false,
                is_tombstone: false,
            },
        )
        .unwrap();

        mark_dirty(&conn, "item-1", "snippets").unwrap();

        let row = fetch_one(&conn, "item-1").unwrap();
        assert!(row.is_dirty);
        // Metadata must still be there.
        assert_eq!(row.last_uploaded_hash, Some(make_hash(0x55)));
        assert_eq!(row.server_version, Some(4));
    }

    #[test]
    fn entry_serializes_with_camel_case() {
        let entry = ItemJournalEntry {
            item_id: "i".into(),
            category_id: "snippets".into(),
            last_uploaded_hash: Some(make_hash(0xAB)),
            server_version: Some(3),
            is_dirty: true,
            is_tombstone: false,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"itemId\":\"i\""));
        assert!(json.contains("\"categoryId\":\"snippets\""));
        assert!(json.contains("\"lastUploadedHash\""));
        assert!(json.contains("\"serverVersion\":3"));
        assert!(json.contains("\"isDirty\":true"));
        assert!(json.contains("\"isTombstone\":false"));
    }

    #[test]
    fn cursor_serializes_with_camel_case() {
        let c = CursorState {
            cursor: 7,
            device_id: "abc".into(),
            last_full_sync_at_ms: Some(123),
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"cursor\":7"));
        assert!(json.contains("\"deviceId\":\"abc\""));
        assert!(json.contains("\"lastFullSyncAtMs\":123"));
    }

    /// Regression: `mark_all_dirty` exists to force re-upload of every row
    /// after an E2EE toggle. Previously it left `last_uploaded_hash` intact,
    /// which caused [`crate::sync::orchestrator::decide_uploads`] to skip
    /// every dirty row (the plaintext content hash hadn't changed — the
    /// encryption envelope is wrapped *after* the decision). Net effect: the
    /// migration push was empty and the journal stayed dirty forever. The
    /// fix is to NULL the hash too, since the function's whole purpose is to
    /// say "ignore the optimistic skip — these need to go to the server."
    #[test]
    fn mark_all_dirty_clears_last_uploaded_hash_so_decide_uploads_cannot_skip() {
        let conn = setup();
        upsert_item(
            &conn,
            &ItemJournalEntry {
                item_id: "clean-with-hash".into(),
                category_id: "clipboard".into(),
                last_uploaded_hash: Some(make_hash(0x42)),
                server_version: Some(11),
                is_dirty: false,
                is_tombstone: false,
            },
        )
        .unwrap();

        let n = mark_all_dirty(&conn).unwrap();
        assert_eq!(n, 1);

        let row = fetch_one(&conn, "clean-with-hash").unwrap();
        assert!(row.is_dirty, "row must be dirty after mark_all_dirty");
        assert_eq!(
            row.last_uploaded_hash, None,
            "hash must be cleared so decide_uploads cannot defensively skip"
        );
        // server_version + category should still be there.
        assert_eq!(row.category_id, "clipboard");
        assert_eq!(row.server_version, Some(11));
    }

    /// Already-dirty rows must also have their hash cleared. Otherwise a
    /// previously-pushed-then-locally-edited row whose hash got reset by
    /// edit-time `mark_dirty` would be fine, but the more common case —
    /// post-toggle re-runs after a partial migration push — would leave
    /// some rows still skipping.
    #[test]
    fn mark_all_dirty_clears_hash_on_already_dirty_rows_too() {
        let conn = setup();
        upsert_item(
            &conn,
            &ItemJournalEntry {
                item_id: "stuck-dirty".into(),
                category_id: "clipboard".into(),
                last_uploaded_hash: Some(make_hash(0x99)),
                server_version: Some(7),
                is_dirty: true,
                is_tombstone: false,
            },
        )
        .unwrap();

        mark_all_dirty(&conn).unwrap();

        let row = fetch_one(&conn, "stuck-dirty").unwrap();
        assert!(row.is_dirty);
        assert_eq!(row.last_uploaded_hash, None);
    }

    #[test]
    fn clear_dirty_after_upload_creates_row_when_missing() {
        // Renamed from "_returns_not_found_when_missing": the function now
        // upserts so first-time uploads (which never went through
        // `mark_dirty`) can record their hash + version. Without this, the
        // no-`markItemDirty` design forces the journal row to be born via
        // a future pull's `apply_pull_record`, leaking churn on every tick
        // until that happens.
        let conn = setup();
        clear_dirty_after_upload(&conn, "fresh", "snippets", Some(&make_hash(0x01)), 7).unwrap();

        let row = fetch_one(&conn, "fresh").unwrap();
        assert_eq!(row.category_id, "snippets");
        assert_eq!(row.last_uploaded_hash, Some(make_hash(0x01)));
        assert_eq!(row.server_version, Some(7));
        assert!(!row.is_dirty);
        assert!(!row.is_tombstone);
    }
}
