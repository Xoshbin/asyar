use crate::crypto::cipher;
use crate::error::AppError;
use crate::storage::notes_fts::NotesFts;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Decrypt an encrypted note field. Mirrors `snippets::decrypt_expansion` —
/// pre-encryption rows are not a concern here since Notes ships encrypted
/// from day one (no legacy plaintext era to special-case).
fn decrypt_field(stored: String, master_key: &[u8; 32]) -> String {
    if cipher::is_encrypted_value(&stored) {
        cipher::decrypt(&stored, master_key).unwrap_or_default()
    } else {
        String::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: f64,
    pub updated_at: f64,
    #[serde(default)]
    pub pinned: bool,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init notes table: {e}")))?;
    Ok(())
}

/// Insert or replace a note (upsert by id). `title` and `body` are both
/// encrypted under `master_key` — unlike snippets (where only the body is
/// encrypted), note titles can themselves be sensitive, so both fields get
/// the same encryption-at-rest treatment clipboard content gets.
pub fn upsert(conn: &Connection, note: &Note, master_key: &[u8; 32]) -> Result<(), AppError> {
    let encrypted_title = cipher::encrypt(&note.title, master_key)?;
    let encrypted_body = cipher::encrypt(&note.body, master_key)?;
    conn.execute(
        "INSERT OR REPLACE INTO notes (id, title, body, created_at, updated_at, pinned)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            note.id,
            encrypted_title,
            encrypted_body,
            note.created_at,
            note.updated_at,
            note.pinned as i32,
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to upsert note: {e}")))?;
    Ok(())
}

/// Update specific fields of a note. `updated_at` is caller-supplied (the
/// frontend's clock), matching how `created_at` is caller-supplied on
/// `upsert` everywhere else in this storage layer — Rust storage functions
/// stay pure/deterministic rather than reaching for `SystemTime::now()`.
#[allow(clippy::too_many_arguments)]
pub fn update(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    body: Option<&str>,
    pinned: Option<bool>,
    updated_at: f64,
    master_key: &[u8; 32],
) -> Result<(), AppError> {
    let mut sets = vec!["updated_at = ?".to_string()];
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(updated_at)];

    if let Some(v) = title {
        sets.push("title = ?".to_string());
        values.push(Box::new(cipher::encrypt(v, master_key)?));
    }
    if let Some(v) = body {
        sets.push("body = ?".to_string());
        values.push(Box::new(cipher::encrypt(v, master_key)?));
    }
    if let Some(v) = pinned {
        sets.push("pinned = ?".to_string());
        values.push(Box::new(v as i32));
    }

    let sql = format!("UPDATE notes SET {} WHERE id = ?", sets.join(", "));
    values.push(Box::new(id.to_string()));

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    conn.execute(&sql, params.as_slice())
        .map_err(|e| AppError::Database(format!("Failed to update note: {e}")))?;
    Ok(())
}

/// Delete a note by id.
pub fn remove(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| AppError::Database(format!("Failed to delete note: {e}")))?;
    Ok(())
}

/// Toggle pinned status. Returns the new pinned value.
pub fn toggle_pin(conn: &Connection, id: &str) -> Result<bool, AppError> {
    conn.execute(
        "UPDATE notes SET pinned = 1 - pinned WHERE id = ?1",
        params![id],
    )
    .map_err(|e| AppError::Database(format!("Failed to toggle pin: {e}")))?;

    let new_val: bool = conn
        .query_row(
            "SELECT pinned FROM notes WHERE id = ?1",
            params![id],
            |row| Ok(row.get::<_, i32>(0)? != 0),
        )
        .map_err(|e| AppError::Database(format!("Failed to read pinned: {e}")))?;

    Ok(new_val)
}

/// Get every note, decrypting `title`/`body` under `master_key`. Pinned
/// notes float to the top, then most-recently-updated first — mirrors the
/// `org.asyar.memory` extension's pinned-first list ordering.
pub fn get_all(conn: &Connection, master_key: &[u8; 32]) -> Result<Vec<Note>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, body, created_at, updated_at, pinned
             FROM notes ORDER BY pinned DESC, updated_at DESC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare query: {e}")))?;

    let items = stmt
        .query_map([], |row| {
            let raw_title: String = row.get(1)?;
            let raw_body: String = row.get(2)?;
            Ok(Note {
                id: row.get(0)?,
                title: decrypt_field(raw_title, master_key),
                body: decrypt_field(raw_body, master_key),
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                pinned: row.get::<_, i32>(5)? != 0,
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query notes: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

/// Get a single note by id, decrypting `title`/`body` under `master_key`.
pub fn get_by_id(
    conn: &Connection,
    id: &str,
    master_key: &[u8; 32],
) -> Result<Option<Note>, AppError> {
    conn.query_row(
        "SELECT id, title, body, created_at, updated_at, pinned FROM notes WHERE id = ?1",
        params![id],
        |row| {
            let raw_title: String = row.get(1)?;
            let raw_body: String = row.get(2)?;
            Ok(Note {
                id: row.get(0)?,
                title: decrypt_field(raw_title, master_key),
                body: decrypt_field(raw_body, master_key),
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                pinned: row.get::<_, i32>(5)? != 0,
            })
        },
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        e => Err(AppError::Database(format!("Failed to get note: {e}"))),
    })
}

/// Upsert a note and keep the in-memory FTS index in sync in the same
/// call — mirrors `storage::clipboard::record_capture_with_fts`.
pub fn upsert_with_fts(
    conn: &Connection,
    note: &Note,
    master_key: &[u8; 32],
    fts: &NotesFts,
) -> Result<(), AppError> {
    upsert(conn, note, master_key)?;
    fts.upsert(&note.id, &note.title, &note.body)?;
    Ok(())
}

/// Partial-update a note and keep the in-memory FTS index in sync. Since
/// `update` is a partial write, this re-fetches the full decrypted row
/// afterward so the FTS entry always reflects the current title + body,
/// not just the fields that changed in this call.
#[allow(clippy::too_many_arguments)]
pub fn update_with_fts(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    body: Option<&str>,
    pinned: Option<bool>,
    updated_at: f64,
    master_key: &[u8; 32],
    fts: &NotesFts,
) -> Result<(), AppError> {
    update(conn, id, title, body, pinned, updated_at, master_key)?;
    if let Some(note) = get_by_id(conn, id, master_key)? {
        fts.upsert(&note.id, &note.title, &note.body)?;
    }
    Ok(())
}

/// Delete a note and keep the in-memory FTS index in sync.
pub fn remove_with_fts(conn: &Connection, id: &str, fts: &NotesFts) -> Result<(), AppError> {
    remove(conn, id)?;
    fts.delete(id)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchResult {
    pub items: Vec<Note>,
    pub index_state: &'static str,
}

/// FTS5-backed search. Returns items in bm25 rank order. Capped at `limit`
/// results (no pagination). Mirrors `storage::clipboard::search`'s
/// indexing-state contract: queries that arrive before the in-memory FTS
/// index has finished its startup rebuild get `index_state: "indexing"`
/// with no results, so the UI can show a "still indexing" hint instead of
/// a false "no notes found."
pub fn search(
    conn: &Connection,
    fts: &NotesFts,
    query: &str,
    limit: usize,
    master_key: &[u8; 32],
) -> Result<NoteSearchResult, AppError> {
    if !crate::storage::notes_fts::is_ready() {
        return Ok(NoteSearchResult {
            items: Vec::new(),
            index_state: "indexing",
        });
    }

    let ids = fts.search(query, limit)?;
    let mut items: Vec<Note> = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(note) = get_by_id(conn, &id, master_key)? {
            items.push(note);
        }
    }

    Ok(NoteSearchResult {
        items,
        index_state: "ready",
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

    fn test_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i * 17) as u8;
        }
        k
    }

    fn make_note(id: &str, title: &str, body: &str, updated_at: f64) -> Note {
        Note {
            id: id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            created_at: 1000.0,
            updated_at,
            pinned: false,
        }
    }

    #[test]
    fn test_upsert_and_get_all_orders_newest_updated_first() {
        let conn = setup();
        let key = test_key();
        upsert(&conn, &make_note("1", "First", "alpha", 1000.0), &key).unwrap();
        upsert(&conn, &make_note("2", "Second", "beta", 2000.0), &key).unwrap();

        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "2"); // most recently updated first
        assert_eq!(items[0].title, "Second");
        assert_eq!(items[0].body, "beta");
    }

    #[test]
    fn test_pinned_notes_float_to_top_regardless_of_updated_at() {
        let conn = setup();
        let key = test_key();
        upsert(&conn, &make_note("1", "Old", "alpha", 1000.0), &key).unwrap();
        upsert(&conn, &make_note("2", "New", "beta", 2000.0), &key).unwrap();
        toggle_pin(&conn, "1").unwrap();

        let items = get_all(&conn, &key).unwrap();
        assert_eq!(
            items[0].id, "1",
            "pinned note must lead even though it's older"
        );
        assert_eq!(items[1].id, "2");
    }

    #[test]
    fn test_title_and_body_are_encrypted_at_rest() {
        let conn = setup();
        let key = test_key();
        upsert(
            &conn,
            &make_note("1", "Secret title", "Secret body", 1000.0),
            &key,
        )
        .unwrap();

        let (raw_title, raw_body): (String, String) = conn
            .query_row("SELECT title, body FROM notes WHERE id = '1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_ne!(raw_title, "Secret title");
        assert_ne!(raw_body, "Secret body");
        assert!(cipher::is_encrypted_value(&raw_title));
        assert!(cipher::is_encrypted_value(&raw_body));
    }

    #[test]
    fn test_upsert_replaces() {
        let conn = setup();
        let key = test_key();
        upsert(&conn, &make_note("1", "Title", "alpha", 1000.0), &key).unwrap();
        upsert(&conn, &make_note("1", "Title", "updated", 1000.0), &key).unwrap();

        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].body, "updated");
    }

    #[test]
    fn test_update_partial_bumps_updated_at() {
        let conn = setup();
        let key = test_key();
        upsert(&conn, &make_note("1", "Title", "alpha", 1000.0), &key).unwrap();

        update(&conn, "1", None, Some("new body"), None, 5000.0, &key).unwrap();

        let item = get_by_id(&conn, "1", &key).unwrap().unwrap();
        assert_eq!(item.body, "new body");
        assert_eq!(item.title, "Title"); // unchanged
        assert_eq!(item.updated_at, 5000.0);
    }

    #[test]
    fn test_remove() {
        let conn = setup();
        let key = test_key();
        upsert(&conn, &make_note("1", "A", "alpha", 1000.0), &key).unwrap();
        upsert(&conn, &make_note("2", "B", "beta", 1000.0), &key).unwrap();

        remove(&conn, "1").unwrap();
        let items = get_all(&conn, &key).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2");
    }

    #[test]
    fn test_toggle_pin() {
        let conn = setup();
        let key = test_key();
        upsert(&conn, &make_note("1", "A", "alpha", 1000.0), &key).unwrap();

        let pinned = toggle_pin(&conn, "1").unwrap();
        assert!(pinned);
        let pinned = toggle_pin(&conn, "1").unwrap();
        assert!(!pinned);
    }

    #[test]
    fn test_get_by_id_missing_returns_none() {
        let conn = setup();
        let key = test_key();
        assert!(get_by_id(&conn, "nope", &key).unwrap().is_none());
    }
}

#[cfg(test)]
mod fts_coordination_tests {
    use super::*;
    use crate::storage::notes_fts::NotesFts;

    fn setup_with_fts() -> (Connection, NotesFts) {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        let fts = NotesFts::new_in_memory().unwrap();
        (conn, fts)
    }

    fn test_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i * 23) as u8;
        }
        k
    }

    #[test]
    fn upsert_with_fts_inserts_into_index() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        let note = Note {
            id: "1".into(),
            title: "Grocery list".into(),
            body: "buy milk".into(),
            created_at: 1000.0,
            updated_at: 1000.0,
            pinned: false,
        };
        upsert_with_fts(&conn, &note, &key, &fts).unwrap();

        assert_eq!(fts.search("grocery", 10).unwrap(), vec!["1".to_string()]);
        assert_eq!(fts.search("milk", 10).unwrap(), vec!["1".to_string()]);
    }

    #[test]
    fn update_with_fts_reindexes_full_current_content() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        let note = Note {
            id: "1".into(),
            title: "Fixed heading".into(),
            body: "stale body content".into(),
            created_at: 1000.0,
            updated_at: 1000.0,
            pinned: false,
        };
        upsert_with_fts(&conn, &note, &key, &fts).unwrap();

        // Only change the body; title should still be searchable afterward.
        update_with_fts(
            &conn,
            "1",
            None,
            Some("fresh body content"),
            None,
            2000.0,
            &key,
            &fts,
        )
        .unwrap();

        assert!(
            fts.search("stale", 10).unwrap().is_empty(),
            "old body term is gone"
        );
        assert_eq!(
            fts.search("fresh", 10).unwrap(),
            vec!["1".to_string()],
            "body change is indexed"
        );
        assert_eq!(
            fts.search("heading", 10).unwrap(),
            vec!["1".to_string()],
            "unchanged title is still indexed after a partial update"
        );
    }

    #[test]
    fn search_returns_indexing_state_before_fts_marked_ready() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        crate::storage::notes_fts::FTS_READY.store(false, std::sync::atomic::Ordering::Release);

        let result = search(&conn, &fts, "anything", 10, &key).unwrap();
        assert_eq!(result.index_state, "indexing");
        assert!(result.items.is_empty());
    }

    #[test]
    fn search_returns_matching_notes_once_ready() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        let note = Note {
            id: "1".into(),
            title: "Grocery list".into(),
            body: "buy milk".into(),
            created_at: 1000.0,
            updated_at: 1000.0,
            pinned: false,
        };
        upsert_with_fts(&conn, &note, &key, &fts).unwrap();
        crate::storage::notes_fts::mark_ready();

        let result = search(&conn, &fts, "grocery", 10, &key).unwrap();
        assert_eq!(result.index_state, "ready");
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].title, "Grocery list");

        crate::storage::notes_fts::FTS_READY.store(false, std::sync::atomic::Ordering::Release);
    }

    #[test]
    fn remove_with_fts_deletes_from_index() {
        let (conn, fts) = setup_with_fts();
        let key = test_key();
        let note = Note {
            id: "1".into(),
            title: "T".into(),
            body: "findable".into(),
            created_at: 1000.0,
            updated_at: 1000.0,
            pinned: false,
        };
        upsert_with_fts(&conn, &note, &key, &fts).unwrap();
        remove_with_fts(&conn, "1", &fts).unwrap();

        assert!(fts.search("findable", 10).unwrap().is_empty());
    }
}
