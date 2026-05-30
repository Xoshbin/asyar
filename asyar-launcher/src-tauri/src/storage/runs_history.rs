use crate::error::AppError;
use crate::runs::types::{Run, RunKind, RunStatus};
use rusqlite::{params, Connection};

pub const HISTORY_CAP: usize = 50;

/// Idempotent: creates the runs_history table and its index if missing.
/// Also adds the `subject_id` column to existing rows via an ALTER TABLE
/// guard — the column was introduced after the initial schema landed, so
/// upgraded installs need it patched in without dropping history.
pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS runs_history (
            id            TEXT    PRIMARY KEY,
            kind          TEXT    NOT NULL,
            label         TEXT    NOT NULL,
            status        TEXT    NOT NULL,
            extension_id  TEXT,
            started_at    INTEGER NOT NULL,
            ended_at      INTEGER,
            cancellable   INTEGER NOT NULL,
            error_message TEXT,
            subject_id    TEXT,
            tail_output   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_runs_history_started_at
            ON runs_history(started_at DESC);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init runs_history table: {e}")))?;

    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(runs_history)")
        .map_err(|e| AppError::Database(e.to_string()))?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| AppError::Database(e.to_string()))?
        .filter_map(Result::ok)
        .collect();

    // Patch upgrades: pre-subject_id databases get the column added in place.
    if !cols.contains(&"subject_id".to_string()) {
        conn.execute("ALTER TABLE runs_history ADD COLUMN subject_id TEXT", [])
            .map_err(|e| AppError::Database(e.to_string()))?;
    }
    // Patch upgrades: pre-tail_output databases get the column added in place.
    if !cols.contains(&"tail_output".to_string()) {
        conn.execute("ALTER TABLE runs_history ADD COLUMN tail_output TEXT", [])
            .map_err(|e| AppError::Database(e.to_string()))?;
    }
    Ok(())
}

/// Insert a Run into history with INSERT OR REPLACE semantics, then evict over-cap rows.
pub fn insert(conn: &Connection, run: &Run) -> Result<(), AppError> {
    let kind = kind_to_db(run.kind)?;
    let status = status_to_db(run.status)?;
    conn.execute(
        "INSERT OR REPLACE INTO runs_history
         (id, kind, label, status, extension_id, started_at, ended_at, cancellable, error_message, subject_id, tail_output)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            run.id,
            kind,
            run.label,
            status,
            run.extension_id,
            run.started_at,
            run.ended_at,
            run.cancellable as i64,
            run.error_message,
            run.subject_id,
            run.tail_output,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    evict_over_cap(conn, HISTORY_CAP)?;
    Ok(())
}

/// Return up to `limit` runs ordered most-recent first (ORDER BY started_at DESC).
pub fn list_recent(conn: &Connection, limit: usize) -> Result<Vec<Run>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, label, status, extension_id, started_at, ended_at,
                    cancellable, error_message, subject_id, tail_output
             FROM runs_history
             ORDER BY started_at DESC
             LIMIT ?1",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let rows = stmt
        .query_map(params![limit as i64], |row| {
            let kind_str: String = row.get(1)?;
            let status_str: String = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?, // id
                kind_str,
                row.get::<_, String>(2)?, // label
                status_str,
                row.get::<_, Option<String>>(4)?,  // extension_id
                row.get::<_, i64>(5)?,             // started_at
                row.get::<_, Option<i64>>(6)?,     // ended_at
                row.get::<_, i64>(7)?,             // cancellable
                row.get::<_, Option<String>>(8)?,  // error_message
                row.get::<_, Option<String>>(9)?,  // subject_id
                row.get::<_, Option<String>>(10)?, // tail_output
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut runs = Vec::new();
    for row in rows {
        let (
            id,
            kind_str,
            label,
            status_str,
            extension_id,
            started_at,
            ended_at,
            cancellable_int,
            error_message,
            subject_id,
            tail_output,
        ) = row.map_err(|e| AppError::Database(e.to_string()))?;
        let kind = kind_from_db(&kind_str)?;
        let status = status_from_db(&status_str)?;
        runs.push(Run {
            id,
            kind,
            label,
            status,
            extension_id,
            started_at,
            ended_at,
            cancellable: cancellable_int != 0,
            error_message,
            subject_id,
            tail_output,
        });
    }
    Ok(runs)
}

/// Delete a single run by id. Deleting an unknown id is a no-op (0 rows affected, no error).
pub fn delete_one(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM runs_history WHERE id = ?1", params![id])
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Delete all rows from runs_history.
pub fn delete_all(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM runs_history", [])
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Drop rows with the oldest started_at until the total count is at most `cap`.
fn evict_over_cap(conn: &Connection, cap: usize) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM runs_history
         WHERE id NOT IN (
             SELECT id FROM runs_history ORDER BY started_at DESC LIMIT ?1
         )",
        params![cap as i64],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Serialize a RunKind to its DB string via serde_json round-trip (no manual match to maintain).
fn kind_to_db(kind: RunKind) -> Result<String, AppError> {
    let json = serde_json::to_string(&kind)
        .map_err(|e| AppError::Database(format!("serialize RunKind: {e}")))?;
    Ok(json.trim_matches('"').to_string())
}

/// Deserialize a RunKind from its DB string via serde_json round-trip (no manual match to maintain).
fn kind_from_db(s: &str) -> Result<RunKind, AppError> {
    let quoted = format!("\"{s}\"");
    serde_json::from_str(&quoted)
        .map_err(|e| AppError::Database(format!("deserialize RunKind '{s}': {e}")))
}

/// Serialize a RunStatus to its DB string via serde_json round-trip (no manual match to maintain).
fn status_to_db(status: RunStatus) -> Result<String, AppError> {
    let json = serde_json::to_string(&status)
        .map_err(|e| AppError::Database(format!("serialize RunStatus: {e}")))?;
    Ok(json.trim_matches('"').to_string())
}

/// Deserialize a RunStatus from its DB string via serde_json round-trip (no manual match to maintain).
fn status_from_db(s: &str) -> Result<RunStatus, AppError> {
    let quoted = format!("\"{s}\"");
    serde_json::from_str(&quoted)
        .map_err(|e| AppError::Database(format!("deserialize RunStatus '{s}': {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::types::{RunKind, RunStatus};

    fn make_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    fn make_run(id: &str, started_at: i64) -> Run {
        Run {
            id: id.to_string(),
            kind: RunKind::ShellScript,
            label: format!("Run {id}"),
            status: RunStatus::Succeeded,
            extension_id: None,
            started_at,
            ended_at: None,
            cancellable: true,
            error_message: None,
            subject_id: None,
            tail_output: None,
        }
    }

    #[test]
    fn init_table_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        init_table(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='runs_history'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn insert_then_list_recent_round_trips() {
        let conn = make_conn();
        let mut run = make_run("r1", 1000);
        run.extension_id = Some("org.test.ext".to_string());
        run.ended_at = Some(2000);
        run.cancellable = false;
        run.error_message = Some("minor issue".to_string());

        insert(&conn, &run).unwrap();
        let rows = list_recent(&conn, 10).unwrap();

        assert_eq!(rows.len(), 1);
        let got = &rows[0];
        assert_eq!(got.id, run.id);
        assert_eq!(got.kind, run.kind);
        assert_eq!(got.label, run.label);
        assert_eq!(got.status, run.status);
        assert_eq!(got.extension_id, run.extension_id);
        assert_eq!(got.started_at, run.started_at);
        assert_eq!(got.ended_at, run.ended_at);
        assert_eq!(got.cancellable, run.cancellable);
        assert_eq!(got.error_message, run.error_message);
    }

    #[test]
    fn list_recent_orders_by_started_at_desc() {
        let conn = make_conn();
        insert(&conn, &make_run("a", 100)).unwrap();
        insert(&conn, &make_run("b", 200)).unwrap();
        insert(&conn, &make_run("c", 300)).unwrap();

        let rows = list_recent(&conn, 10).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].started_at, 300);
        assert_eq!(rows[1].started_at, 200);
        assert_eq!(rows[2].started_at, 100);
    }

    #[test]
    fn list_recent_respects_limit() {
        let conn = make_conn();
        for i in 1..=5 {
            insert(&conn, &make_run(&format!("r{i}"), i as i64 * 100)).unwrap();
        }

        let top3 = list_recent(&conn, 3).unwrap();
        assert_eq!(top3.len(), 3);
        assert_eq!(top3[0].started_at, 500);
        assert_eq!(top3[1].started_at, 400);
        assert_eq!(top3[2].started_at, 300);

        let all = list_recent(&conn, 10).unwrap();
        assert_eq!(all.len(), 5);
    }

    #[test]
    fn evict_over_cap_drops_oldest() {
        let conn = make_conn();
        let total = HISTORY_CAP + 5;
        for i in 0..total {
            insert(&conn, &make_run(&format!("r{i}"), i as i64 + 1)).unwrap();
        }

        let rows = list_recent(&conn, HISTORY_CAP * 2).unwrap();
        assert_eq!(rows.len(), HISTORY_CAP);

        let min_started_at = rows.iter().map(|r| r.started_at).min().unwrap();
        assert!(
            min_started_at > 5,
            "expected oldest 5 evicted, but min started_at={min_started_at}"
        );
    }

    #[test]
    fn evict_below_cap_is_noop() {
        let conn = make_conn();
        insert(&conn, &make_run("a", 1)).unwrap();
        insert(&conn, &make_run("b", 2)).unwrap();
        insert(&conn, &make_run("c", 3)).unwrap();

        let rows = list_recent(&conn, HISTORY_CAP * 2).unwrap();
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn delete_one_removes_only_target() {
        let conn = make_conn();
        insert(&conn, &make_run("a", 1)).unwrap();
        insert(&conn, &make_run("b", 2)).unwrap();
        insert(&conn, &make_run("c", 3)).unwrap();

        delete_one(&conn, "b").unwrap();

        let rows = list_recent(&conn, 10).unwrap();
        assert_eq!(rows.len(), 2);
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"a"), "expected 'a' in results");
        assert!(ids.contains(&"c"), "expected 'c' in results");
        assert!(!ids.contains(&"b"), "expected 'b' removed");
    }

    #[test]
    fn delete_one_unknown_id_is_noop() {
        let conn = make_conn();
        insert(&conn, &make_run("a", 1)).unwrap();

        delete_one(&conn, "nonexistent").unwrap();

        let rows = list_recent(&conn, 10).unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn delete_all_clears_table() {
        let conn = make_conn();
        for i in 1..=5 {
            insert(&conn, &make_run(&format!("r{i}"), i as i64 * 100)).unwrap();
        }

        delete_all(&conn).unwrap();

        let rows = list_recent(&conn, 10).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn insert_with_null_optional_fields_round_trips() {
        let conn = make_conn();
        let run = make_run("r1", 1000);
        assert!(run.extension_id.is_none());
        assert!(run.ended_at.is_none());
        assert!(run.error_message.is_none());

        insert(&conn, &run).unwrap();
        let rows = list_recent(&conn, 10).unwrap();

        assert_eq!(rows.len(), 1);
        let got = &rows[0];
        assert!(got.extension_id.is_none(), "expected extension_id=None");
        assert!(got.ended_at.is_none(), "expected ended_at=None");
        assert!(got.error_message.is_none(), "expected error_message=None");
    }

    #[test]
    fn insert_with_some_optional_fields_round_trips() {
        let conn = make_conn();
        let mut run = make_run("r1", 1000);
        run.extension_id = Some("ext.x".to_string());
        run.ended_at = Some(123);
        run.error_message = Some("boom".to_string());

        insert(&conn, &run).unwrap();
        let rows = list_recent(&conn, 10).unwrap();

        assert_eq!(rows.len(), 1);
        let got = &rows[0];
        assert_eq!(got.extension_id, Some("ext.x".to_string()));
        assert_eq!(got.ended_at, Some(123));
        assert_eq!(got.error_message, Some("boom".to_string()));
    }

    #[test]
    fn insert_duplicate_id_replaces() {
        let conn = make_conn();
        let mut first = make_run("r1", 1000);
        first.label = "first".to_string();
        insert(&conn, &first).unwrap();

        let mut second = make_run("r1", 1000);
        second.label = "second".to_string();
        insert(&conn, &second).unwrap();

        let rows = list_recent(&conn, 10).unwrap();
        assert_eq!(rows.len(), 1, "expected exactly one row after upsert");
        assert_eq!(rows[0].label, "second");
    }

    #[test]
    fn kind_round_trips_for_all_variants() {
        let conn = make_conn();
        let kinds = [
            RunKind::AiChat,
            RunKind::ShellScript,
            RunKind::Agent,
            RunKind::Custom,
        ];
        for (i, kind) in kinds.iter().enumerate() {
            let mut run = make_run(&format!("r{i}"), i as i64 + 1);
            run.kind = *kind;
            insert(&conn, &run).unwrap();
        }

        let rows = list_recent(&conn, 10).unwrap();
        assert_eq!(rows.len(), 4);

        let mut found_ai_chat = false;
        let mut found_shell_script = false;
        let mut found_agent = false;
        let mut found_custom = false;

        for row in &rows {
            match row.kind {
                RunKind::AiChat => found_ai_chat = true,
                RunKind::ShellScript => found_shell_script = true,
                RunKind::Agent => found_agent = true,
                RunKind::Custom => found_custom = true,
            }
        }

        assert!(found_ai_chat, "AiChat kind did not round-trip");
        assert!(found_shell_script, "ShellScript kind did not round-trip");
        assert!(found_agent, "Agent kind did not round-trip");
        assert!(found_custom, "Custom kind did not round-trip");
    }

    #[test]
    fn init_table_adds_subject_id_column_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        init_table(&conn).unwrap(); // second call must not fail when column already exists

        let mut stmt = conn.prepare("PRAGMA table_info(runs_history)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert!(
            cols.contains(&"subject_id".to_string()),
            "expected subject_id column, got {cols:?}"
        );
    }

    #[test]
    fn insert_and_list_recent_round_trips_subject_id_some() {
        let conn = make_conn();
        let mut run = make_run("r1", 1000);
        run.subject_id = Some("cmd_scripts_dyn_abc".to_string());

        insert(&conn, &run).unwrap();
        let rows = list_recent(&conn, 10).unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].subject_id.as_deref(), Some("cmd_scripts_dyn_abc"));
    }

    #[test]
    fn insert_with_none_subject_id_round_trips_as_none() {
        let conn = make_conn();
        let run = make_run("r1", 1000);
        assert!(run.subject_id.is_none());

        insert(&conn, &run).unwrap();
        let rows = list_recent(&conn, 10).unwrap();

        assert_eq!(rows.len(), 1);
        assert!(rows[0].subject_id.is_none());
    }

    #[test]
    fn init_table_adds_tail_output_column_to_legacy_db() {
        // Simulate a legacy DB that predates the tail_output column.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE runs_history (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                label TEXT NOT NULL,
                status TEXT NOT NULL,
                extension_id TEXT,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                cancellable INTEGER NOT NULL,
                error_message TEXT,
                subject_id TEXT
            );",
        )
        .unwrap();
        init_table(&conn).unwrap();
        let mut stmt = conn.prepare("PRAGMA table_info(runs_history)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert!(
            cols.contains(&"tail_output".to_string()),
            "expected tail_output column after init_table on legacy schema, got: {cols:?}"
        );
    }

    #[test]
    fn tail_output_round_trips_through_sqlite() {
        let conn = make_conn();
        let mut run = make_run("r1", 1000);
        run.tail_output = Some("last line".to_string());

        insert(&conn, &run).unwrap();
        let recent = list_recent(&conn, 10).unwrap();

        assert_eq!(recent.len(), 1);
        assert_eq!(
            recent[0].tail_output.as_deref(),
            Some("last line"),
            "tail_output must round-trip through SQLite"
        );
    }

    #[test]
    fn status_round_trips_for_all_terminal_variants() {
        let conn = make_conn();
        let statuses = [
            RunStatus::Succeeded,
            RunStatus::Failed,
            RunStatus::Cancelled,
        ];
        for (i, status) in statuses.iter().enumerate() {
            let mut run = make_run(&format!("r{i}"), i as i64 + 1);
            run.status = *status;
            insert(&conn, &run).unwrap();
        }

        let rows = list_recent(&conn, 10).unwrap();
        assert_eq!(rows.len(), 3);

        let mut found_succeeded = false;
        let mut found_failed = false;
        let mut found_cancelled = false;

        for row in &rows {
            match row.status {
                RunStatus::Succeeded => found_succeeded = true,
                RunStatus::Failed => found_failed = true,
                RunStatus::Cancelled => found_cancelled = true,
                other => panic!("unexpected status in history: {other:?}"),
            }
        }

        assert!(found_succeeded, "Succeeded status did not round-trip");
        assert!(found_failed, "Failed status did not round-trip");
        assert!(found_cancelled, "Cancelled status did not round-trip");
    }
}
