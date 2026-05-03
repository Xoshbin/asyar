//! Local journal recording the last-uploaded content hash + timestamp
//! per cloud-sync category. Used by the per-category sync orchestrator
//! to short-circuit uploads when a category's plaintext hash matches
//! what was last sent to the server — eliminating the 14 MB-every-2-h
//! upload pattern that the previous monolithic snapshot caused.
//!
//! The journal is local-only — never synced. It stores neither the
//! plaintext nor any decryptable derivative; only a SHA-256 of the
//! plaintext, which is cryptographically opaque. Cleared on logout
//! (so a different user logging in cannot inherit "already synced"
//! claims) and on explicit "Restore from Cloud" (so the next upload
//! reseeds from the server's authoritative hashes).

use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalJournalEntry {
    pub category_id: String,
    /// SHA-256 of the plaintext payload that was last uploaded for this
    /// category. 32 bytes — stored as BLOB.
    pub last_uploaded_hash: Vec<u8>,
    /// When the server confirmed the last upload (server's `synced_at`
    /// echoed back), as Unix milliseconds. Used for status display + the
    /// "X minutes ago" diagnostic surface.
    pub last_synced_at_ms: i64,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cloud_sync_local_state (
            category_id        TEXT PRIMARY KEY,
            last_uploaded_hash BLOB NOT NULL,
            last_synced_at_ms  INTEGER NOT NULL
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init cloud_sync_local_state: {e}")))?;
    Ok(())
}

pub fn upsert(conn: &Connection, entry: &LocalJournalEntry) -> Result<(), AppError> {
    if entry.last_uploaded_hash.len() != 32 {
        return Err(AppError::Validation(format!(
            "last_uploaded_hash must be 32 bytes (SHA-256), got {}",
            entry.last_uploaded_hash.len()
        )));
    }
    conn.execute(
        "INSERT OR REPLACE INTO cloud_sync_local_state
            (category_id, last_uploaded_hash, last_synced_at_ms)
         VALUES (?1, ?2, ?3)",
        params![
            entry.category_id,
            entry.last_uploaded_hash,
            entry.last_synced_at_ms,
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to upsert journal entry: {e}")))?;
    Ok(())
}

pub fn get(
    conn: &Connection,
    category_id: &str,
) -> Result<Option<LocalJournalEntry>, AppError> {
    let result = conn.query_row(
        "SELECT category_id, last_uploaded_hash, last_synced_at_ms
           FROM cloud_sync_local_state
          WHERE category_id = ?1",
        params![category_id],
        |row| {
            Ok(LocalJournalEntry {
                category_id: row.get(0)?,
                last_uploaded_hash: row.get(1)?,
                last_synced_at_ms: row.get(2)?,
            })
        },
    );
    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to get journal entry: {e}"))),
    }
}

pub fn get_all(conn: &Connection) -> Result<Vec<LocalJournalEntry>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT category_id, last_uploaded_hash, last_synced_at_ms
               FROM cloud_sync_local_state
           ORDER BY category_id ASC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare journal query: {e}")))?;

    let entries = stmt
        .query_map([], |row| {
            Ok(LocalJournalEntry {
                category_id: row.get(0)?,
                last_uploaded_hash: row.get(1)?,
                last_synced_at_ms: row.get(2)?,
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query journal: {e}")))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

pub fn delete(conn: &Connection, category_id: &str) -> Result<bool, AppError> {
    let count = conn
        .execute(
            "DELETE FROM cloud_sync_local_state WHERE category_id = ?1",
            params![category_id],
        )
        .map_err(|e| AppError::Database(format!("Failed to delete journal entry: {e}")))?;
    Ok(count > 0)
}

pub fn clear_all(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM cloud_sync_local_state", [])
        .map_err(|e| AppError::Database(format!("Failed to clear journal: {e}")))?;
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

    fn make_hash(byte: u8) -> Vec<u8> {
        vec![byte; 32]
    }

    fn make_entry(category_id: &str, hash_byte: u8, ts_ms: i64) -> LocalJournalEntry {
        LocalJournalEntry {
            category_id: category_id.to_string(),
            last_uploaded_hash: make_hash(hash_byte),
            last_synced_at_ms: ts_ms,
        }
    }

    #[test]
    fn init_table_is_idempotent() {
        let conn = setup();
        // Second call must not error.
        init_table(&conn).unwrap();
        // Insert still works.
        upsert(&conn, &make_entry("settings", 0xAB, 1)).unwrap();
        assert!(get(&conn, "settings").unwrap().is_some());
    }

    #[test]
    fn upsert_then_get_round_trips() {
        let conn = setup();
        let entry = make_entry("snippets", 0x42, 1_700_000_000_000);
        upsert(&conn, &entry).unwrap();

        let got = get(&conn, "snippets").unwrap().unwrap();
        assert_eq!(got.category_id, "snippets");
        assert_eq!(got.last_uploaded_hash, vec![0x42; 32]);
        assert_eq!(got.last_synced_at_ms, 1_700_000_000_000);
    }

    #[test]
    fn get_returns_none_when_absent() {
        let conn = setup();
        assert!(get(&conn, "nonexistent").unwrap().is_none());
    }

    #[test]
    fn upsert_replaces_existing_row() {
        let conn = setup();
        upsert(&conn, &make_entry("settings", 0x01, 100)).unwrap();
        upsert(&conn, &make_entry("settings", 0x02, 200)).unwrap();

        let got = get(&conn, "settings").unwrap().unwrap();
        assert_eq!(got.last_uploaded_hash, vec![0x02; 32]);
        assert_eq!(got.last_synced_at_ms, 200);
    }

    #[test]
    fn upsert_rejects_non_32_byte_hash() {
        let conn = setup();
        let bad = LocalJournalEntry {
            category_id: "settings".into(),
            last_uploaded_hash: vec![0u8; 16], // wrong length
            last_synced_at_ms: 1,
        };
        let err = upsert(&conn, &bad).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn get_all_returns_entries_sorted_by_category_id() {
        let conn = setup();
        upsert(&conn, &make_entry("snippets", 0x01, 1)).unwrap();
        upsert(&conn, &make_entry("clipboard", 0x02, 2)).unwrap();
        upsert(&conn, &make_entry("settings", 0x03, 3)).unwrap();

        let all = get_all(&conn).unwrap();
        let ids: Vec<_> = all.iter().map(|e| e.category_id.clone()).collect();
        assert_eq!(ids, vec!["clipboard", "settings", "snippets"]);
    }

    #[test]
    fn get_all_returns_empty_on_fresh_table() {
        let conn = setup();
        assert!(get_all(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_removes_one_category_only() {
        let conn = setup();
        upsert(&conn, &make_entry("a", 0x01, 1)).unwrap();
        upsert(&conn, &make_entry("b", 0x02, 2)).unwrap();

        let removed = delete(&conn, "a").unwrap();
        assert!(removed);
        assert!(get(&conn, "a").unwrap().is_none());
        assert!(get(&conn, "b").unwrap().is_some());
    }

    #[test]
    fn delete_returns_false_when_no_row() {
        let conn = setup();
        let removed = delete(&conn, "missing").unwrap();
        assert!(!removed);
    }

    #[test]
    fn clear_all_removes_every_row() {
        let conn = setup();
        upsert(&conn, &make_entry("a", 0x01, 1)).unwrap();
        upsert(&conn, &make_entry("b", 0x02, 2)).unwrap();
        upsert(&conn, &make_entry("c", 0x03, 3)).unwrap();

        clear_all(&conn).unwrap();
        assert!(get_all(&conn).unwrap().is_empty());
    }

    #[test]
    fn entry_serializes_with_camel_case() {
        let entry = make_entry("settings", 0xAB, 12345);
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"categoryId\":\"settings\""));
        assert!(json.contains("\"lastUploadedHash\""));
        assert!(json.contains("\"lastSyncedAtMs\":12345"));
    }
}
