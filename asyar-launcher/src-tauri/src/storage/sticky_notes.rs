//! Which notes are pinned to the desktop, and where their windows sit.
//!
//! Geometry only — the note's content lives in the encrypted `notes` table, so
//! nothing sensitive is stored here (same class as other window/UI state).

use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyNote {
    pub note_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub created_at: f64,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sticky_notes (
            note_id TEXT PRIMARY KEY,
            x REAL NOT NULL,
            y REAL NOT NULL,
            width REAL NOT NULL,
            height REAL NOT NULL,
            created_at REAL NOT NULL
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init sticky_notes table: {e}")))?;
    Ok(())
}

/// Pin a note (or update its geometry if already pinned). `created_at` is
/// preserved on re-pin so restore order stays stable.
pub fn upsert(conn: &Connection, sticky: &StickyNote) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO sticky_notes (note_id, x, y, width, height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(note_id) DO UPDATE SET
             x = excluded.x,
             y = excluded.y,
             width = excluded.width,
             height = excluded.height",
        params![
            sticky.note_id,
            sticky.x,
            sticky.y,
            sticky.width,
            sticky.height,
            sticky.created_at,
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to upsert sticky note: {e}")))?;
    Ok(())
}

/// Update just the window geometry. No-op when the note isn't pinned.
pub fn save_geometry(
    conn: &Connection,
    note_id: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE sticky_notes SET x = ?2, y = ?3, width = ?4, height = ?5 WHERE note_id = ?1",
        params![note_id, x, y, width, height],
    )
    .map_err(|e| AppError::Database(format!("Failed to save sticky geometry: {e}")))?;
    Ok(())
}

/// Unpin a note. Safe to call when it isn't pinned.
pub fn remove(conn: &Connection, note_id: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM sticky_notes WHERE note_id = ?1",
        params![note_id],
    )
    .map_err(|e| AppError::Database(format!("Failed to remove sticky note: {e}")))?;
    Ok(())
}

pub fn is_stuck(conn: &Connection, note_id: &str) -> Result<bool, AppError> {
    conn.query_row(
        "SELECT COUNT(*) FROM sticky_notes WHERE note_id = ?1",
        params![note_id],
        |row| row.get::<_, i32>(0),
    )
    .map(|c| c > 0)
    .map_err(|e| AppError::Database(format!("Failed to check sticky note: {e}")))
}

/// Every pinned note, oldest-pinned first — the order windows are restored in.
pub fn list(conn: &Connection) -> Result<Vec<StickyNote>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT note_id, x, y, width, height, created_at
             FROM sticky_notes ORDER BY created_at ASC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare sticky query: {e}")))?;

    let items = stmt
        .query_map([], |row| {
            Ok(StickyNote {
                note_id: row.get(0)?,
                x: row.get(1)?,
                y: row.get(2)?,
                width: row.get(3)?,
                height: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query sticky notes: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

/// Drop sticky rows whose note no longer exists. Belt-and-braces for the
/// delete-note cascade so a deleted note can never resurrect a window on the
/// next launch.
pub fn prune_orphans(conn: &Connection) -> Result<usize, AppError> {
    conn.execute(
        "DELETE FROM sticky_notes WHERE note_id NOT IN (SELECT id FROM notes)",
        [],
    )
    .map_err(|e| AppError::Database(format!("Failed to prune sticky notes: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    fn sticky(note_id: &str, created_at: f64) -> StickyNote {
        StickyNote {
            note_id: note_id.to_string(),
            x: 100.0,
            y: 200.0,
            width: 300.0,
            height: 240.0,
            created_at,
        }
    }

    #[test]
    fn upsert_then_list_round_trips() {
        let conn = setup();
        upsert(&conn, &sticky("n1", 1000.0)).unwrap();

        let rows = list(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0], sticky("n1", 1000.0));
    }

    #[test]
    fn list_is_ordered_oldest_pinned_first() {
        let conn = setup();
        upsert(&conn, &sticky("newer", 2000.0)).unwrap();
        upsert(&conn, &sticky("older", 1000.0)).unwrap();

        let ids: Vec<String> = list(&conn)
            .unwrap()
            .into_iter()
            .map(|s| s.note_id)
            .collect();
        assert_eq!(ids, vec!["older".to_string(), "newer".to_string()]);
    }

    #[test]
    fn re_pinning_updates_geometry_but_keeps_created_at() {
        let conn = setup();
        upsert(&conn, &sticky("n1", 1000.0)).unwrap();

        let mut moved = sticky("n1", 9999.0); // caller passes a new created_at
        moved.x = 42.0;
        upsert(&conn, &moved).unwrap();

        let rows = list(&conn).unwrap();
        assert_eq!(rows.len(), 1, "still one row — upsert by note_id");
        assert_eq!(rows[0].x, 42.0, "geometry updated");
        assert_eq!(rows[0].created_at, 1000.0, "original pin time preserved");
    }

    #[test]
    fn save_geometry_updates_only_position_and_size() {
        let conn = setup();
        upsert(&conn, &sticky("n1", 1000.0)).unwrap();

        save_geometry(&conn, "n1", 10.0, 20.0, 30.0, 40.0).unwrap();

        let row = &list(&conn).unwrap()[0];
        assert_eq!(
            (row.x, row.y, row.width, row.height),
            (10.0, 20.0, 30.0, 40.0)
        );
        assert_eq!(row.created_at, 1000.0);
    }

    #[test]
    fn save_geometry_for_unpinned_note_is_a_noop() {
        let conn = setup();
        save_geometry(&conn, "ghost", 1.0, 2.0, 3.0, 4.0).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn remove_unpins() {
        let conn = setup();
        upsert(&conn, &sticky("n1", 1000.0)).unwrap();
        upsert(&conn, &sticky("n2", 2000.0)).unwrap();

        remove(&conn, "n1").unwrap();

        let ids: Vec<String> = list(&conn)
            .unwrap()
            .into_iter()
            .map(|s| s.note_id)
            .collect();
        assert_eq!(ids, vec!["n2".to_string()]);
    }

    #[test]
    fn remove_is_safe_for_a_note_that_is_not_pinned() {
        let conn = setup();
        remove(&conn, "never-pinned").unwrap();
    }

    #[test]
    fn is_stuck_reports_pin_state() {
        let conn = setup();
        assert!(!is_stuck(&conn, "n1").unwrap());
        upsert(&conn, &sticky("n1", 1000.0)).unwrap();
        assert!(is_stuck(&conn, "n1").unwrap());
        remove(&conn, "n1").unwrap();
        assert!(!is_stuck(&conn, "n1").unwrap());
    }

    #[test]
    fn prune_orphans_drops_stickies_whose_note_is_gone() {
        let conn = setup();
        crate::storage::notes::init_table(&conn).unwrap();
        let key = [7u8; 32];
        crate::storage::notes::upsert(
            &conn,
            &crate::storage::notes::Note {
                id: "alive".into(),
                title: "Alive".into(),
                body: "b".into(),
                created_at: 1.0,
                updated_at: 1.0,
                pinned: false,
            },
            &key,
        )
        .unwrap();

        upsert(&conn, &sticky("alive", 1000.0)).unwrap();
        upsert(&conn, &sticky("deleted", 2000.0)).unwrap();

        let pruned = prune_orphans(&conn).unwrap();

        assert_eq!(pruned, 1);
        let ids: Vec<String> = list(&conn)
            .unwrap()
            .into_iter()
            .map(|s| s.note_id)
            .collect();
        assert_eq!(ids, vec!["alive".to_string()]);
    }
}
