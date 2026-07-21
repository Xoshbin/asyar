//! In-memory FTS5 index over decrypted note title + body.
//!
//! Mirrors `storage::clipboard_fts` exactly and for the same reason: lives
//! in a separate SQLite `:memory:` connection so the on-disk notes table
//! stays opaque ciphertext while search still works. Rebuilt at process
//! start (see `lib.rs::setup_app`, following the clipboard FTS bootstrap)
//! by streaming every row of `notes`, decrypting, and inserting here. Kept
//! in sync at steady state by every mutation in `storage::notes`.

use crate::error::AppError;
use rusqlite::{params, Connection};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Set to `true` when `rebuild_from_disk` completes. Search queries
/// arriving before this is true should be treated as "still indexing" by
/// the caller, exactly like `clipboard_fts::FTS_READY`.
pub static FTS_READY: AtomicBool = AtomicBool::new(false);

pub fn is_ready() -> bool {
    FTS_READY.load(Ordering::Acquire)
}

pub fn mark_ready() {
    FTS_READY.store(true, Ordering::Release);
}

/// Walk every note row, decrypt title + body, insert into FTS. Idempotent
/// (INSERT OR REPLACE).
pub fn rebuild_from_disk(
    conn: &Connection,
    fts: &NotesFts,
    master_key: &[u8; 32],
) -> Result<(), AppError> {
    let notes = super::notes::get_all(conn, master_key)?;
    for note in &notes {
        fts.upsert(&note.id, &note.title, &note.body)?;
    }
    Ok(())
}

/// Hash a note id (`String`) to a stable i64 used as the FTS rowid.
/// Required because FTS5 rowids must be integers; note ids are UUIDs.
pub fn rowid_for(id: &str) -> i64 {
    use std::hash::{BuildHasher, BuildHasherDefault, Hasher};
    let mut hasher =
        BuildHasherDefault::<std::collections::hash_map::DefaultHasher>::new().build_hasher();
    hasher.write(id.as_bytes());
    hasher.finish() as i64
}

pub struct NotesFts {
    conn: Mutex<Connection>,
}

impl NotesFts {
    pub fn new_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()
            .map_err(|e| AppError::Database(format!("Failed to open notes FTS memory DB: {e}")))?;
        conn.execute_batch(
            "CREATE VIRTUAL TABLE fts_notes USING fts5(
                note_id UNINDEXED,
                title, body,
                prefix='2 3',
                tokenize='unicode61 remove_diacritics 2'
            );",
        )
        .map_err(|e| AppError::Database(format!("Failed to create notes FTS table: {e}")))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Insert or replace the FTS row for a note id.
    pub fn upsert(&self, id: &str, title: &str, body: &str) -> Result<(), AppError> {
        let rowid = rowid_for(id);
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        conn.execute(
            "INSERT OR REPLACE INTO fts_notes(rowid, note_id, title, body) \
             VALUES (?1, ?2, ?3, ?4)",
            params![rowid, id, title, body],
        )
        .map_err(|e| AppError::Database(format!("Notes FTS upsert: {e}")))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let rowid = rowid_for(id);
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        conn.execute("DELETE FROM fts_notes WHERE rowid = ?1", params![rowid])
            .map_err(|e| AppError::Database(format!("Notes FTS delete: {e}")))?;
        Ok(())
    }

    /// FTS5 MATCH with bm25 ranking. Returns note ids ordered best-match
    /// first. Caller JOINs to `storage::notes::get_by_id` for the payload.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<String>, AppError> {
        let sanitized = sanitize_for_fts5(query);
        if sanitized.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        let ids: Vec<String> = conn
            .prepare(
                "SELECT note_id FROM fts_notes \
                  WHERE fts_notes MATCH ?1 \
                  ORDER BY bm25(fts_notes) LIMIT ?2",
            )
            .map_err(|e| AppError::Database(format!("Notes FTS search prepare: {e}")))?
            .query_map(params![sanitized, limit as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| AppError::Database(format!("Notes FTS search query: {e}")))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }
}

/// Turn a free-form user query into an FTS5 MATCH expression that does
/// prefix matching on every token. Identical logic to
/// `clipboard_fts::sanitize_for_fts5` — see that function's doc comment
/// for the full rationale (as-you-type prefix matching + FTS5
/// syntax-injection guarding).
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
    fn upsert_then_search_matches_title_and_body() {
        let fts = NotesFts::new_in_memory().unwrap();
        fts.upsert("id-1", "Grocery list", "buy milk and eggs")
            .unwrap();
        fts.upsert("id-2", "Meeting notes", "quarterly review")
            .unwrap();

        assert_eq!(fts.search("grocery", 10).unwrap(), vec!["id-1".to_string()]);
        assert_eq!(fts.search("milk", 10).unwrap(), vec!["id-1".to_string()]);
        assert_eq!(
            fts.search("quarterly", 10).unwrap(),
            vec!["id-2".to_string()]
        );
    }

    #[test]
    fn delete_removes_row_from_search() {
        let fts = NotesFts::new_in_memory().unwrap();
        fts.upsert("id-1", "Findable", "findable text").unwrap();
        assert_eq!(
            fts.search("findable", 10).unwrap(),
            vec!["id-1".to_string()]
        );
        fts.delete("id-1").unwrap();
        assert!(fts.search("findable", 10).unwrap().is_empty());
    }

    #[test]
    fn upsert_replaces_existing_row() {
        let fts = NotesFts::new_in_memory().unwrap();
        fts.upsert("id-1", "T", "apple").unwrap();
        fts.upsert("id-1", "T", "banana").unwrap();
        assert!(fts.search("apple", 10).unwrap().is_empty());
        assert_eq!(fts.search("banana", 10).unwrap(), vec!["id-1".to_string()]);
    }

    #[test]
    fn search_sanitizes_fts5_special_chars() {
        let fts = NotesFts::new_in_memory().unwrap();
        fts.upsert("id-1", "T", "look here please").unwrap();
        for raw in ["(look)", "look*", "\"look\"", "look:here", "look'"] {
            let hits = fts.search(raw, 10).unwrap();
            assert!(
                hits.contains(&"id-1".to_string()),
                "query {raw:?} must still match the underlying token",
            );
        }
    }

    #[test]
    fn empty_query_returns_empty() {
        let fts = NotesFts::new_in_memory().unwrap();
        fts.upsert("id-1", "T", "anything").unwrap();
        assert!(fts.search("   ", 10).unwrap().is_empty());
        assert!(fts.search("", 10).unwrap().is_empty());
    }

    #[test]
    fn is_ready_flips_on_mark_ready() {
        FTS_READY.store(false, std::sync::atomic::Ordering::Release);
        assert!(!is_ready());
        mark_ready();
        assert!(is_ready());
        FTS_READY.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[cfg(test)]
mod rebuild_tests {
    use super::*;
    use crate::storage::notes::{upsert, Note};

    fn test_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i * 19) as u8;
        }
        k
    }

    fn make_note(id: &str, title: &str, body: &str) -> Note {
        Note {
            id: id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            created_at: 1000.0,
            updated_at: 1000.0,
            pinned: false,
        }
    }

    #[test]
    fn rebuild_from_disk_indexes_every_row() {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::notes::init_table(&conn).unwrap();
        let key = test_key();
        for i in 0..20u32 {
            upsert(
                &conn,
                &make_note(&i.to_string(), &format!("Note {i}"), &format!("apple {i}")),
                &key,
            )
            .unwrap();
        }
        let fts = NotesFts::new_in_memory().unwrap();
        rebuild_from_disk(&conn, &fts, &key).unwrap();

        let hits = fts.search("apple", 100).unwrap();
        assert_eq!(hits.len(), 20);
    }
}
