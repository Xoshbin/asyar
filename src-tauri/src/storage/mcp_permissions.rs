use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// The outcome of a user's permission decision for an MCP tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    AllowOnce,
    AllowAlways,
    Never,
}

impl PermissionDecision {
    fn as_str(self) -> &'static str {
        match self {
            PermissionDecision::AllowOnce => "allow_once",
            PermissionDecision::AllowAlways => "allow_always",
            PermissionDecision::Never => "never",
        }
    }

    fn from_str(s: &str) -> Result<Self, AppError> {
        match s {
            "allow_once" => Ok(PermissionDecision::AllowOnce),
            "allow_always" => Ok(PermissionDecision::AllowAlways),
            "never" => Ok(PermissionDecision::Never),
            other => Err(AppError::Database(format!(
                "unknown permission decision: {other}"
            ))),
        }
    }
}

/// A persisted first-call permission decision for a (server, tool, agent) triple.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPermissionRow {
    pub server_id: String,
    pub tool_id: String,
    /// Empty string for anonymous callers.
    pub agent_id: String,
    pub decision: PermissionDecision,
    /// Unix millis.
    pub set_at: i64,
}

/// Idempotent: creates the mcp_permissions table if missing.
pub(crate) fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS mcp_permissions (
            server_id TEXT NOT NULL,
            tool_id   TEXT NOT NULL,
            agent_id  TEXT NOT NULL,
            decision  TEXT NOT NULL CHECK (decision IN ('allow_once', 'allow_always', 'never')),
            set_at    INTEGER NOT NULL,
            PRIMARY KEY (server_id, tool_id, agent_id)
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init mcp_permissions table: {e}")))?;
    Ok(())
}

/// Upsert a permission decision for the (server_id, tool_id, agent_id) composite key.
pub fn set_permission(conn: &Connection, row: &McpPermissionRow) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO mcp_permissions
            (server_id, tool_id, agent_id, decision, set_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            row.server_id,
            row.tool_id,
            row.agent_id,
            row.decision.as_str(),
            row.set_at,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Return the permission row for the given triple, or `None` if not set.
pub fn get_permission(
    conn: &Connection,
    server_id: &str,
    tool_id: &str,
    agent_id: &str,
) -> Result<Option<McpPermissionRow>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT server_id, tool_id, agent_id, decision, set_at
             FROM mcp_permissions
             WHERE server_id = ?1 AND tool_id = ?2 AND agent_id = ?3",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut rows = stmt
        .query_map(params![server_id, tool_id, agent_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    match rows.next() {
        None => Ok(None),
        Some(row) => {
            let (server_id, tool_id, agent_id, decision_str, set_at) =
                row.map_err(|e| AppError::Database(e.to_string()))?;
            let decision = PermissionDecision::from_str(&decision_str)?;
            Ok(Some(McpPermissionRow {
                server_id,
                tool_id,
                agent_id,
                decision,
                set_at,
            }))
        }
    }
}

/// Atomically read and optionally consume an `AllowOnce` permission.
///
/// - `AllowOnce`: returns `Some(AllowOnce)` and deletes the row.
/// - `AllowAlways` / `Never`: returns the decision without touching the row.
/// - Not found: returns `None`.
pub fn consume_allow_once(
    conn: &Connection,
    server_id: &str,
    tool_id: &str,
    agent_id: &str,
) -> Result<Option<PermissionDecision>, AppError> {
    let perm = get_permission(conn, server_id, tool_id, agent_id)?;
    match perm {
        None => Ok(None),
        Some(row) => {
            if row.decision == PermissionDecision::AllowOnce {
                conn.execute(
                    "DELETE FROM mcp_permissions
                     WHERE server_id = ?1 AND tool_id = ?2 AND agent_id = ?3",
                    params![server_id, tool_id, agent_id],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            }
            Ok(Some(row.decision))
        }
    }
}

/// Delete all permissions for the given server. Returns the number of rows deleted.
pub fn delete_for_server(conn: &Connection, server_id: &str) -> Result<usize, AppError> {
    let n = conn
        .execute(
            "DELETE FROM mcp_permissions WHERE server_id = ?1",
            params![server_id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(n)
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

    fn perm(server_id: &str, tool_id: &str, agent_id: &str, decision: PermissionDecision) -> McpPermissionRow {
        McpPermissionRow {
            server_id: server_id.to_string(),
            tool_id: tool_id.to_string(),
            agent_id: agent_id.to_string(),
            decision,
            set_at: 1000,
        }
    }

    #[test]
    fn set_then_get_round_trips() {
        let conn = make_conn();
        let row = perm("srv-1", "search", "agent-1", PermissionDecision::AllowAlways);
        set_permission(&conn, &row).unwrap();

        let got = get_permission(&conn, "srv-1", "search", "agent-1")
            .unwrap()
            .expect("permission not found");
        assert_eq!(got.server_id, "srv-1");
        assert_eq!(got.tool_id, "search");
        assert_eq!(got.agent_id, "agent-1");
        assert_eq!(got.decision, PermissionDecision::AllowAlways);
        assert_eq!(got.set_at, 1000);
    }

    #[test]
    fn set_permission_overwrites_existing_decision() {
        let conn = make_conn();
        set_permission(&conn, &perm("srv-1", "search", "agent-1", PermissionDecision::AllowOnce)).unwrap();
        set_permission(&conn, &perm("srv-1", "search", "agent-1", PermissionDecision::Never)).unwrap();

        let got = get_permission(&conn, "srv-1", "search", "agent-1")
            .unwrap()
            .expect("permission not found");
        assert_eq!(got.decision, PermissionDecision::Never);
    }

    #[test]
    fn consume_allow_once_returns_decision_then_deletes_row() {
        let conn = make_conn();
        set_permission(&conn, &perm("srv-1", "search", "agent-1", PermissionDecision::AllowOnce)).unwrap();

        let decision = consume_allow_once(&conn, "srv-1", "search", "agent-1").unwrap();
        assert_eq!(decision, Some(PermissionDecision::AllowOnce));

        // Row must be gone after consume
        let after = get_permission(&conn, "srv-1", "search", "agent-1").unwrap();
        assert!(after.is_none(), "expected row to be deleted after AllowOnce consume");
    }

    #[test]
    fn consume_allow_always_returns_decision_and_keeps_row() {
        let conn = make_conn();
        set_permission(&conn, &perm("srv-1", "search", "agent-1", PermissionDecision::AllowAlways)).unwrap();

        let decision = consume_allow_once(&conn, "srv-1", "search", "agent-1").unwrap();
        assert_eq!(decision, Some(PermissionDecision::AllowAlways));

        // Row must still exist
        let after = get_permission(&conn, "srv-1", "search", "agent-1").unwrap();
        assert!(after.is_some(), "expected row to remain after AllowAlways consume");
        assert_eq!(after.unwrap().decision, PermissionDecision::AllowAlways);
    }

    #[test]
    fn delete_for_server_drops_only_that_server() {
        let conn = make_conn();
        set_permission(&conn, &perm("srv-1", "tool-a", "agent-1", PermissionDecision::AllowAlways)).unwrap();
        set_permission(&conn, &perm("srv-1", "tool-b", "agent-1", PermissionDecision::Never)).unwrap();
        set_permission(&conn, &perm("srv-2", "tool-a", "agent-1", PermissionDecision::AllowOnce)).unwrap();

        let deleted = delete_for_server(&conn, "srv-1").unwrap();
        assert_eq!(deleted, 2);

        assert!(get_permission(&conn, "srv-1", "tool-a", "agent-1").unwrap().is_none());
        assert!(get_permission(&conn, "srv-1", "tool-b", "agent-1").unwrap().is_none());
        assert!(get_permission(&conn, "srv-2", "tool-a", "agent-1").unwrap().is_some());
    }
}
