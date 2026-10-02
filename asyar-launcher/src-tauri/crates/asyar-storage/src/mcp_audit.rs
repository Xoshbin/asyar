use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// A single MCP tool-call audit log entry (read from DB).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuditRow {
    /// SQLite autoincrement id.
    pub id: i64,
    pub server_id: String,
    pub tool_id: String,
    /// `None` means the call was anonymous (no agent).
    pub agent_id: Option<String>,
    /// Unix millis.
    pub called_at: i64,
    pub success: bool,
    /// `None` on success; truncated error message on failure.
    pub error_summary: Option<String>,
    /// Truncated representation of the tool arguments (max 200 chars).
    pub args_summary: String,
}

/// Input for creating a new audit entry (id is assigned by SQLite).
#[derive(Debug, Clone)]
pub struct NewMcpAuditEntry {
    pub server_id: String,
    pub tool_id: String,
    pub agent_id: Option<String>,
    pub called_at: i64,
    pub success: bool,
    pub error_summary: Option<String>,
    pub args_summary: String,
}

/// Idempotent: creates the mcp_audit table and its indexes if missing.
pub(crate) fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS mcp_audit (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id     TEXT    NOT NULL,
            tool_id       TEXT    NOT NULL,
            agent_id      TEXT,
            called_at     INTEGER NOT NULL,
            success       INTEGER NOT NULL,
            error_summary TEXT,
            args_summary  TEXT    NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_audit_called_at ON mcp_audit(called_at DESC);
        CREATE INDEX IF NOT EXISTS idx_mcp_audit_server_id ON mcp_audit(server_id);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init mcp_audit table: {e}")))?;
    Ok(())
}

/// Insert a new audit entry and return its assigned row id.
pub fn insert_entry(conn: &Connection, entry: &NewMcpAuditEntry) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO mcp_audit
            (server_id, tool_id, agent_id, called_at, success, error_summary, args_summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            entry.server_id,
            entry.tool_id,
            entry.agent_id,
            entry.called_at,
            entry.success as i64,
            entry.error_summary,
            entry.args_summary,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(conn.last_insert_rowid())
}

/// Return audit entries ordered by `called_at` descending.
/// When `server_id` is `Some`, only entries for that server are returned.
/// At most `limit` rows are returned.
pub fn list_recent(
    conn: &Connection,
    server_id: Option<&str>,
    limit: u32,
) -> Result<Vec<McpAuditRow>, AppError> {
    let rows = match server_id {
        Some(sid) => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, server_id, tool_id, agent_id, called_at,
                            success, error_summary, args_summary
                     FROM mcp_audit
                     WHERE server_id = ?1
                     ORDER BY called_at DESC
                     LIMIT ?2",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;

            let iter = stmt
                .query_map(params![sid, limit], map_row)
                .map_err(|e| AppError::Database(e.to_string()))?;

            collect_rows(iter)?
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, server_id, tool_id, agent_id, called_at,
                            success, error_summary, args_summary
                     FROM mcp_audit
                     ORDER BY called_at DESC
                     LIMIT ?1",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;

            let iter = stmt
                .query_map(params![limit], map_row)
                .map_err(|e| AppError::Database(e.to_string()))?;

            collect_rows(iter)?
        }
    };

    Ok(rows)
}

/// Delete all audit entries with `called_at < cutoff_millis`.
/// Returns the number of rows deleted.
pub fn purge_older_than(conn: &Connection, cutoff_millis: i64) -> Result<usize, AppError> {
    let n = conn
        .execute(
            "DELETE FROM mcp_audit WHERE called_at < ?1",
            params![cutoff_millis],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(n)
}

/// Delete all audit entries for the given server.
/// Returns the number of rows deleted.
pub fn purge_for_server(conn: &Connection, server_id: &str) -> Result<usize, AppError> {
    let n = conn
        .execute(
            "DELETE FROM mcp_audit WHERE server_id = ?1",
            params![server_id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(n)
}

type AuditTuple = (
    i64,
    String,
    String,
    Option<String>,
    i64,
    i64,
    Option<String>,
    String,
);

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuditTuple> {
    Ok((
        row.get::<_, i64>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, String>(2)?,
        row.get::<_, Option<String>>(3)?,
        row.get::<_, i64>(4)?,
        row.get::<_, i64>(5)?,
        row.get::<_, Option<String>>(6)?,
        row.get::<_, String>(7)?,
    ))
}

fn collect_rows(
    iter: impl Iterator<Item = rusqlite::Result<AuditTuple>>,
) -> Result<Vec<McpAuditRow>, AppError> {
    let mut out = Vec::new();
    for item in iter {
        let (id, server_id, tool_id, agent_id, called_at, success_int, error_summary, args_summary) =
            item.map_err(|e| AppError::Database(e.to_string()))?;
        out.push(McpAuditRow {
            id,
            server_id,
            tool_id,
            agent_id,
            called_at,
            success: success_int != 0,
            error_summary,
            args_summary,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn make_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_table(&conn).unwrap();
        conn
    }

    fn entry(server_id: &str, tool_id: &str, called_at: i64) -> NewMcpAuditEntry {
        NewMcpAuditEntry {
            server_id: server_id.to_string(),
            tool_id: tool_id.to_string(),
            agent_id: Some("agent-1".to_string()),
            called_at,
            success: true,
            error_summary: None,
            args_summary: r#"{"q":"test"}"#.to_string(),
        }
    }

    #[test]
    fn insert_entry_persists_full_row_and_returns_id() {
        let conn = make_conn();
        let e = NewMcpAuditEntry {
            server_id: "srv-1".to_string(),
            tool_id: "search".to_string(),
            agent_id: Some("agent-42".to_string()),
            called_at: 5000,
            success: false,
            error_summary: Some("timeout".to_string()),
            args_summary: r#"{"q":"hello"}"#.to_string(),
        };
        let id = insert_entry(&conn, &e).unwrap();
        assert!(id > 0, "expected positive rowid, got {id}");

        let rows = list_recent(&conn, None, 10).unwrap();
        assert_eq!(rows.len(), 1);
        let got = &rows[0];
        assert_eq!(got.id, id);
        assert_eq!(got.server_id, "srv-1");
        assert_eq!(got.tool_id, "search");
        assert_eq!(got.agent_id, Some("agent-42".to_string()));
        assert_eq!(got.called_at, 5000);
        assert!(!got.success);
        assert_eq!(got.error_summary, Some("timeout".to_string()));
        assert_eq!(got.args_summary, r#"{"q":"hello"}"#);
    }

    #[test]
    fn list_recent_returns_descending_called_at_capped_at_limit() {
        let conn = make_conn();
        insert_entry(&conn, &entry("srv-1", "tool-a", 1000)).unwrap();
        insert_entry(&conn, &entry("srv-1", "tool-b", 3000)).unwrap();
        insert_entry(&conn, &entry("srv-1", "tool-c", 2000)).unwrap();

        let rows = list_recent(&conn, None, 2).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].called_at, 3000);
        assert_eq!(rows[1].called_at, 2000);
    }

    #[test]
    fn list_recent_filters_by_server_id_when_provided() {
        let conn = make_conn();
        insert_entry(&conn, &entry("srv-1", "tool-a", 1000)).unwrap();
        insert_entry(&conn, &entry("srv-2", "tool-b", 2000)).unwrap();
        insert_entry(&conn, &entry("srv-1", "tool-c", 3000)).unwrap();

        let rows = list_recent(&conn, Some("srv-1"), 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.server_id == "srv-1"));
        // Descending order
        assert_eq!(rows[0].called_at, 3000);
        assert_eq!(rows[1].called_at, 1000);
    }

    #[test]
    fn purge_older_than_drops_old_rows_only() {
        let conn = make_conn();
        insert_entry(&conn, &entry("srv-1", "tool-a", 1000)).unwrap();
        insert_entry(&conn, &entry("srv-1", "tool-b", 2000)).unwrap();
        insert_entry(&conn, &entry("srv-1", "tool-c", 5000)).unwrap();

        let deleted = purge_older_than(&conn, 3000).unwrap();
        assert_eq!(deleted, 2);

        let remaining = list_recent(&conn, None, 10).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].called_at, 5000);
    }

    #[test]
    fn purge_for_server_drops_only_that_server() {
        let conn = make_conn();
        insert_entry(&conn, &entry("srv-1", "tool-a", 1000)).unwrap();
        insert_entry(&conn, &entry("srv-2", "tool-b", 2000)).unwrap();
        insert_entry(&conn, &entry("srv-1", "tool-c", 3000)).unwrap();

        let deleted = purge_for_server(&conn, "srv-1").unwrap();
        assert_eq!(deleted, 2);

        let remaining = list_recent(&conn, None, 10).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].server_id, "srv-2");
    }
}
