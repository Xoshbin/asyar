//! Persistence for walkthrough completions.
//!
//! Completions **latch**: the first write for a task wins and is never
//! overwritten. That is what makes the derived-from-usage design safe —
//! `usage.db` is a rolling record the user is free to clear, but clearing it
//! must not un-teach them. Once a task is done it is done, with the timestamp
//! and source of the moment it first happened.

use crate::error::AppError;
use crate::walkthrough::progress::Latched;
use crate::walkthrough::{CompletionRecord, CompletionSource};
use rusqlite::{params, Connection};

const DISMISSED_KEY: &str = "dismissed";

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS walkthrough_state (
            task_id      TEXT PRIMARY KEY,
            completed_at INTEGER NOT NULL,
            source       TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS walkthrough_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init walkthrough tables: {e}")))?;
    Ok(())
}

fn source_to_str(source: CompletionSource) -> &'static str {
    match source {
        CompletionSource::Auto => "auto",
        CompletionSource::Manual => "manual",
    }
}

/// Unknown values read back as `Auto` — a corrupted row should show as
/// "completed", never crash the list.
fn source_from_str(raw: &str) -> CompletionSource {
    match raw {
        "manual" => CompletionSource::Manual,
        _ => CompletionSource::Auto,
    }
}

/// Every latched completion, keyed by task id.
pub fn latched(conn: &Connection) -> Result<Latched, AppError> {
    let mut stmt = conn
        .prepare("SELECT task_id, completed_at, source FROM walkthrough_state")
        .map_err(|e| AppError::Database(format!("Failed to read walkthrough state: {e}")))?;

    let rows = stmt
        .query_map([], |row| {
            let task_id: String = row.get(0)?;
            let completed_at: i64 = row.get(1)?;
            let source: String = row.get(2)?;
            Ok((task_id, completed_at, source))
        })
        .map_err(|e| AppError::Database(format!("Failed to read walkthrough state: {e}")))?;

    let mut out = Latched::new();
    for row in rows {
        let (task_id, completed_at, source) =
            row.map_err(|e| AppError::Database(format!("Failed to read walkthrough row: {e}")))?;
        out.insert(
            task_id.clone(),
            CompletionRecord {
                task_id,
                completed_at,
                source: source_from_str(&source),
            },
        );
    }
    Ok(out)
}

/// Latch `task_id` as complete. Idempotent: a task already recorded keeps
/// its original timestamp and source.
pub fn mark_complete(
    conn: &Connection,
    task_id: &str,
    source: CompletionSource,
    completed_at: i64,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO walkthrough_state (task_id, completed_at, source)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(task_id) DO NOTHING",
        params![task_id, completed_at, source_to_str(source)],
    )
    .map_err(|e| AppError::Database(format!("Failed to mark walkthrough task complete: {e}")))?;
    Ok(())
}

/// Un-tick a task. Only reachable for tasks the user ticked by hand — an
/// auto-completed task un-ticked here would simply re-latch on the next
/// evaluation, which would be a confusing thing to offer.
pub fn clear(conn: &Connection, task_id: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM walkthrough_state WHERE task_id = ?1",
        params![task_id],
    )
    .map_err(|e| AppError::Database(format!("Failed to clear walkthrough task: {e}")))?;
    Ok(())
}

/// Wipe all completions and un-dismiss — "start the walkthrough over".
pub fn reset(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("DELETE FROM walkthrough_state; DELETE FROM walkthrough_meta;")
        .map_err(|e| AppError::Database(format!("Failed to reset walkthrough: {e}")))?;
    Ok(())
}

/// Has the user dismissed the root-search progress row? Defaults to false.
pub fn is_dismissed(conn: &Connection) -> Result<bool, AppError> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM walkthrough_meta WHERE key = ?1",
            params![DISMISSED_KEY],
            |row| row.get(0),
        )
        .ok();
    Ok(value.as_deref() == Some("1"))
}

pub fn set_dismissed(conn: &Connection, dismissed: bool) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO walkthrough_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![DISMISSED_KEY, if dismissed { "1" } else { "0" }],
    )
    .map_err(|e| AppError::Database(format!("Failed to set walkthrough dismissal: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    #[test]
    fn init_creates_both_tables() {
        let conn = mem_conn();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'
                 AND name IN ('walkthrough_state', 'walkthrough_meta')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn latched_is_empty_on_a_fresh_database() {
        assert!(latched(&mem_conn()).unwrap().is_empty());
    }

    #[test]
    fn mark_complete_then_read_back() {
        let conn = mem_conn();
        mark_complete(&conn, "wt_a", CompletionSource::Auto, 1_700_000_000).unwrap();

        let all = latched(&conn).unwrap();
        let record = all.get("wt_a").unwrap();
        assert_eq!(record.task_id, "wt_a");
        assert_eq!(record.completed_at, 1_700_000_000);
        assert_eq!(record.source, CompletionSource::Auto);
    }

    #[test]
    fn mark_complete_latches_the_first_write() {
        // Re-running evaluation every launch must not keep bumping the
        // timestamp — "completed 3 weeks ago" has to stay true.
        let conn = mem_conn();
        mark_complete(&conn, "wt_a", CompletionSource::Auto, 1000).unwrap();
        mark_complete(&conn, "wt_a", CompletionSource::Manual, 9999).unwrap();

        let record = latched(&conn).unwrap().get("wt_a").cloned().unwrap();
        assert_eq!(record.completed_at, 1000);
        assert_eq!(record.source, CompletionSource::Auto);
    }

    #[test]
    fn manual_and_auto_sources_round_trip_distinctly() {
        let conn = mem_conn();
        mark_complete(&conn, "wt_auto", CompletionSource::Auto, 1).unwrap();
        mark_complete(&conn, "wt_manual", CompletionSource::Manual, 2).unwrap();

        let all = latched(&conn).unwrap();
        assert_eq!(all["wt_auto"].source, CompletionSource::Auto);
        assert_eq!(all["wt_manual"].source, CompletionSource::Manual);
    }

    #[test]
    fn unknown_source_string_reads_back_as_auto() {
        let conn = mem_conn();
        conn.execute(
            "INSERT INTO walkthrough_state (task_id, completed_at, source)
             VALUES ('wt_x', 5, 'garbage')",
            [],
        )
        .unwrap();
        assert_eq!(
            latched(&conn).unwrap()["wt_x"].source,
            CompletionSource::Auto
        );
    }

    #[test]
    fn clear_removes_only_the_named_task() {
        let conn = mem_conn();
        mark_complete(&conn, "wt_a", CompletionSource::Manual, 1).unwrap();
        mark_complete(&conn, "wt_b", CompletionSource::Manual, 2).unwrap();

        clear(&conn, "wt_a").unwrap();
        let all = latched(&conn).unwrap();
        assert!(!all.contains_key("wt_a"));
        assert!(all.contains_key("wt_b"));
    }

    #[test]
    fn clear_on_a_missing_task_is_a_no_op() {
        let conn = mem_conn();
        assert!(clear(&conn, "wt_never").is_ok());
    }

    #[test]
    fn dismissal_defaults_to_false_and_round_trips() {
        let conn = mem_conn();
        assert!(!is_dismissed(&conn).unwrap());

        set_dismissed(&conn, true).unwrap();
        assert!(is_dismissed(&conn).unwrap());

        set_dismissed(&conn, false).unwrap();
        assert!(!is_dismissed(&conn).unwrap());
    }

    #[test]
    fn reset_clears_completions_and_dismissal() {
        let conn = mem_conn();
        mark_complete(&conn, "wt_a", CompletionSource::Auto, 1).unwrap();
        set_dismissed(&conn, true).unwrap();

        // Assert the setup landed before resetting it. Without this the test
        // passes vacuously against a no-op writer: "empty after reset" is
        // trivially true if nothing was ever written.
        assert!(!latched(&conn).unwrap().is_empty());
        assert!(is_dismissed(&conn).unwrap());

        reset(&conn).unwrap();

        assert!(latched(&conn).unwrap().is_empty());
        assert!(!is_dismissed(&conn).unwrap());
    }
}
