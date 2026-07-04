//! Pinned files for the file-search view. `file_id` is the 16-char hex
//! stable id; `path` is stored so pins survive an index rebuild and can be
//! re-resolved even if the file's inode changed.

use rusqlite::{params, Connection, Result};

pub struct PinnedRow {
    pub file_id: String,
    pub path: String,
    pub pinned_at: i64,
}

pub fn init_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS file_search_pinned (
            file_id   TEXT PRIMARY KEY,
            path      TEXT NOT NULL,
            pinned_at INTEGER NOT NULL
        )",
        [],
    )?;
    Ok(())
}

pub fn pin(conn: &Connection, file_id: &str, path: &str, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO file_search_pinned (file_id, path, pinned_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT (file_id) DO NOTHING",
        params![file_id, path, now],
    )?;
    Ok(())
}

pub fn unpin(conn: &Connection, file_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM file_search_pinned WHERE file_id = ?1",
        params![file_id],
    )?;
    Ok(())
}

/// Newest-pinned first.
pub fn list(conn: &Connection) -> Result<Vec<PinnedRow>> {
    let mut stmt = conn.prepare(
        "SELECT file_id, path, pinned_at FROM file_search_pinned
         ORDER BY pinned_at DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PinnedRow {
                file_id: r.get(0)?,
                path: r.get(1)?,
                pinned_at: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_table(&c).unwrap();
        c
    }

    #[test]
    fn pin_and_list_newest_first() {
        let c = open();
        pin(&c, "00000000000000f1", "/tmp/a.pdf", 1000).unwrap();
        pin(&c, "00000000000000f2", "/tmp/b.pdf", 2000).unwrap();
        let rows = list(&c).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].file_id, "00000000000000f2");
        assert_eq!(rows[0].path, "/tmp/b.pdf");
    }

    #[test]
    fn pin_is_idempotent() {
        let c = open();
        pin(&c, "00000000000000f1", "/tmp/a.pdf", 1000).unwrap();
        pin(&c, "00000000000000f1", "/tmp/a.pdf", 2000).unwrap();
        assert_eq!(list(&c).unwrap().len(), 1);
    }

    #[test]
    fn unpin_removes_row() {
        let c = open();
        pin(&c, "00000000000000f1", "/tmp/a.pdf", 1000).unwrap();
        unpin(&c, "00000000000000f1").unwrap();
        assert!(list(&c).unwrap().is_empty());
    }

    #[test]
    fn init_table_is_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        init_table(&c).unwrap();
        init_table(&c).unwrap();
    }
}
