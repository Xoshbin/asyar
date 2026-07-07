//! Per-query file-search selection learning rows.
//!
//! `query_prefix` is capped at 8 lowercased chars (privacy floor: full
//! queries are never persisted). `file_id` is the 16-char hex form of the
//! stable file id. Rows older than 180 days are garbage-collected — the
//! boost formula in `file_index::learning` yields zero for them anyway.

use rusqlite::{params, Connection, Result};

pub fn init_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS file_search_selections (
            query_prefix TEXT NOT NULL,
            file_id      TEXT NOT NULL,
            count        INTEGER NOT NULL DEFAULT 1,
            last_used    INTEGER NOT NULL,
            PRIMARY KEY (query_prefix, file_id)
        )",
        [],
    )?;
    Ok(())
}

/// Cap stored query prefix at 8 chars (privacy floor).
pub fn normalize_prefix(query: &str) -> String {
    query.chars().take(8).collect::<String>().to_lowercase()
}

pub fn record_selection(conn: &Connection, query: &str, file_id: &str, now: i64) -> Result<()> {
    let prefix = normalize_prefix(query);
    conn.execute(
        "INSERT INTO file_search_selections (query_prefix, file_id, count, last_used)
         VALUES (?1, ?2, 1, ?3)
         ON CONFLICT (query_prefix, file_id) DO UPDATE
           SET count = count + 1, last_used = ?3",
        params![prefix, file_id, now],
    )?;
    Ok(())
}

pub struct SelectionRow {
    pub query_prefix: String,
    pub file_id: String,
    pub count: i64,
    pub last_used: i64,
}

/// Everything in the table — loaded once at startup into the in-memory
/// `LearningCache` (never queried on the keystroke path).
pub fn load_all(conn: &Connection) -> Result<Vec<SelectionRow>> {
    let mut stmt =
        conn.prepare("SELECT query_prefix, file_id, count, last_used FROM file_search_selections")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SelectionRow {
                query_prefix: r.get(0)?,
                file_id: r.get(1)?,
                count: r.get(2)?,
                last_used: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// Garbage-collect stale rows: `last_used` older than 180 days is deleted.
pub fn gc_stale(conn: &Connection, now: i64) -> Result<usize> {
    let cutoff = now - (180 * 86_400);
    conn.execute(
        "DELETE FROM file_search_selections WHERE last_used < ?1",
        params![cutoff],
    )
}

pub fn clear_all(conn: &Connection) -> Result<usize> {
    conn.execute("DELETE FROM file_search_selections", [])
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
    fn normalize_prefix_caps_at_8_chars_lowercase() {
        assert_eq!(normalize_prefix("ABCDEFGHIJ"), "abcdefgh");
        assert_eq!(normalize_prefix("rep"), "rep");
    }

    #[test]
    fn record_and_load_all() {
        let c = open();
        record_selection(&c, "report", "00000000000000f1", 1000).unwrap();
        let rows = load_all(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].query_prefix, "report");
        assert_eq!(rows[0].file_id, "00000000000000f1");
        assert_eq!(rows[0].count, 1);
    }

    #[test]
    fn record_twice_increments_count() {
        let c = open();
        record_selection(&c, "report", "f1f1f1f1f1f1f1f1", 1000).unwrap();
        record_selection(&c, "report", "f1f1f1f1f1f1f1f1", 1001).unwrap();
        let rows = load_all(&c).unwrap();
        assert_eq!(rows[0].count, 2);
        assert_eq!(rows[0].last_used, 1001);
    }

    #[test]
    fn prefix_truncation_groups_long_queries() {
        let c = open();
        record_selection(&c, "reportsareverylong", "f1f1f1f1f1f1f1f1", 1000).unwrap();
        record_selection(&c, "reportsadifferentremainder", "f1f1f1f1f1f1f1f1", 1001).unwrap();
        let rows = load_all(&c).unwrap();
        assert_eq!(rows.len(), 1, "same 8-char prefix must upsert one row");
        assert_eq!(rows[0].count, 2);
    }

    #[test]
    fn gc_removes_stale_rows() {
        let c = open();
        record_selection(&c, "a", "00000000000000f1", 0).unwrap();
        record_selection(&c, "a", "00000000000000f2", 1_000_000_000).unwrap();
        let removed = gc_stale(&c, 1_000_000_000).unwrap();
        assert_eq!(removed, 1);
        let rows = load_all(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_id, "00000000000000f2");
    }

    #[test]
    fn clear_all_empties_table() {
        let c = open();
        record_selection(&c, "a", "00000000000000f1", 0).unwrap();
        record_selection(&c, "b", "00000000000000f2", 0).unwrap();
        assert_eq!(clear_all(&c).unwrap(), 2);
        assert!(load_all(&c).unwrap().is_empty());
    }

    #[test]
    fn init_table_is_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        init_table(&c).unwrap();
        init_table(&c).unwrap();
    }
}
