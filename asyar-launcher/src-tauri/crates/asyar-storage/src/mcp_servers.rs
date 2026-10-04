use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// A persisted MCP server configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRow {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    /// "stdio" or "http"
    pub transport_kind: String,
    /// Populated for stdio transport.
    pub command: Option<String>,
    /// JSON array of strings.
    pub args_json: String,
    /// JSON object {string: string}.
    pub env_json: String,
    /// Populated for http transport.
    pub url: Option<String>,
    /// JSON object {string: string}.
    pub headers_json: String,
    pub enabled: bool,
    /// Unix millis.
    pub created_at: i64,
    /// Unix millis.
    pub updated_at: i64,
}

/// Idempotent: creates the mcp_servers table and its indexes if missing.
pub(crate) fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS mcp_servers (
            id             TEXT    PRIMARY KEY,
            display_name   TEXT    NOT NULL,
            description    TEXT,
            transport_kind TEXT    NOT NULL,
            command        TEXT,
            args_json      TEXT    NOT NULL DEFAULT '[]',
            env_json       TEXT    NOT NULL DEFAULT '{}',
            url            TEXT,
            headers_json   TEXT    NOT NULL DEFAULT '{}',
            enabled        INTEGER NOT NULL DEFAULT 0,
            created_at     INTEGER NOT NULL,
            updated_at     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init mcp_servers table: {e}")))?;
    Ok(())
}

/// Insert a new MCP server row. Returns an error if the id already exists.
pub fn insert_server(conn: &Connection, row: &McpServerRow) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO mcp_servers
            (id, display_name, description, transport_kind, command, args_json,
             env_json, url, headers_json, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            row.id,
            row.display_name,
            row.description,
            row.transport_kind,
            row.command,
            row.args_json,
            row.env_json,
            row.url,
            row.headers_json,
            row.enabled as i64,
            row.created_at,
            row.updated_at,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Update an existing MCP server row identified by `row.id`.
pub fn update_server(conn: &Connection, row: &McpServerRow) -> Result<(), AppError> {
    conn.execute(
        "UPDATE mcp_servers
         SET display_name=?2, description=?3, transport_kind=?4, command=?5,
             args_json=?6, env_json=?7, url=?8, headers_json=?9,
             enabled=?10, updated_at=?11
         WHERE id=?1",
        params![
            row.id,
            row.display_name,
            row.description,
            row.transport_kind,
            row.command,
            row.args_json,
            row.env_json,
            row.url,
            row.headers_json,
            row.enabled as i64,
            row.updated_at,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Delete an MCP server by id. Deleting an unknown id is a no-op.
pub fn delete_server(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Return a single MCP server by id, or `None` if not found.
pub fn get_server(conn: &Connection, id: &str) -> Result<Option<McpServerRow>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, display_name, description, transport_kind, command, args_json,
                    env_json, url, headers_json, enabled, created_at, updated_at
             FROM mcp_servers
             WHERE id = ?1",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut rows = stmt
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, i64>(11)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    match rows.next() {
        None => Ok(None),
        Some(row) => {
            let (
                id,
                display_name,
                description,
                transport_kind,
                command,
                args_json,
                env_json,
                url,
                headers_json,
                enabled_int,
                created_at,
                updated_at,
            ) = row.map_err(|e| AppError::Database(e.to_string()))?;
            Ok(Some(McpServerRow {
                id,
                display_name,
                description,
                transport_kind,
                command,
                args_json,
                env_json,
                url,
                headers_json,
                enabled: enabled_int != 0,
                created_at,
                updated_at,
            }))
        }
    }
}

/// Return all MCP servers ordered by `created_at` ascending.
pub fn list_servers(conn: &Connection) -> Result<Vec<McpServerRow>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, display_name, description, transport_kind, command, args_json,
                    env_json, url, headers_json, enabled, created_at, updated_at
             FROM mcp_servers
             ORDER BY created_at ASC",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, i64>(11)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut servers = Vec::new();
    for row in rows {
        let (
            id,
            display_name,
            description,
            transport_kind,
            command,
            args_json,
            env_json,
            url,
            headers_json,
            enabled_int,
            created_at,
            updated_at,
        ) = row.map_err(|e| AppError::Database(e.to_string()))?;
        servers.push(McpServerRow {
            id,
            display_name,
            description,
            transport_kind,
            command,
            args_json,
            env_json,
            url,
            headers_json,
            enabled: enabled_int != 0,
            created_at,
            updated_at,
        });
    }
    Ok(servers)
}

/// Flip the enabled flag for the given server id.
pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> Result<(), AppError> {
    conn.execute(
        "UPDATE mcp_servers SET enabled = ?2 WHERE id = ?1",
        params![id, enabled as i64],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
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

    fn stdio_row(id: &str, created_at: i64) -> McpServerRow {
        McpServerRow {
            id: id.to_string(),
            display_name: format!("Server {id}"),
            description: Some("A test server".to_string()),
            transport_kind: "stdio".to_string(),
            command: Some("/usr/bin/npx".to_string()),
            args_json: r#"["mcp-server","--port","9000"]"#.to_string(),
            env_json: r#"{"API_KEY":"secret","DEBUG":"1"}"#.to_string(),
            url: None,
            headers_json: "{}".to_string(),
            enabled: false,
            created_at,
            updated_at: created_at,
        }
    }

    fn http_row(id: &str, created_at: i64) -> McpServerRow {
        McpServerRow {
            id: id.to_string(),
            display_name: format!("HTTP Server {id}"),
            description: None,
            transport_kind: "http".to_string(),
            command: None,
            args_json: "[]".to_string(),
            env_json: "{}".to_string(),
            url: Some("https://api.example.com/mcp".to_string()),
            headers_json: r#"{"Authorization":"Bearer tok","X-Tenant":"abc"}"#.to_string(),
            enabled: true,
            created_at,
            updated_at: created_at,
        }
    }

    #[test]
    fn init_table_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        init_table(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='mcp_servers'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn insert_then_get_round_trips_full_row() {
        let conn = make_conn();
        let row = stdio_row("s1", 1000);
        insert_server(&conn, &row).unwrap();

        let got = get_server(&conn, "s1").unwrap().expect("server not found");
        assert_eq!(got.id, row.id);
        assert_eq!(got.display_name, row.display_name);
        assert_eq!(got.description, row.description);
        assert_eq!(got.transport_kind, "stdio");
        assert_eq!(got.command, row.command);
        assert_eq!(got.args_json, row.args_json);
        assert_eq!(got.env_json, row.env_json);
        assert_eq!(got.url, None);
        assert_eq!(got.headers_json, "{}");
        assert!(!got.enabled);
        assert_eq!(got.created_at, 1000);
        assert_eq!(got.updated_at, 1000);
    }

    #[test]
    fn insert_then_get_round_trips_http_variant() {
        let conn = make_conn();
        let row = http_row("h1", 2000);
        insert_server(&conn, &row).unwrap();

        let got = get_server(&conn, "h1").unwrap().expect("server not found");
        assert_eq!(got.transport_kind, "http");
        assert_eq!(got.command, None);
        assert_eq!(got.url, Some("https://api.example.com/mcp".to_string()));
        assert_eq!(got.headers_json, row.headers_json);
        assert!(got.enabled);
    }

    #[test]
    fn update_server_changes_command_and_args() {
        let conn = make_conn();
        let mut row = stdio_row("s1", 1000);
        insert_server(&conn, &row).unwrap();

        row.command = Some("/usr/local/bin/mcp".to_string());
        row.args_json = r#"["--verbose"]"#.to_string();
        row.updated_at = 9999;
        update_server(&conn, &row).unwrap();

        let got = get_server(&conn, "s1").unwrap().expect("server not found");
        assert_eq!(got.command, Some("/usr/local/bin/mcp".to_string()));
        assert_eq!(got.args_json, r#"["--verbose"]"#);
        assert_eq!(got.updated_at, 9999);
    }

    #[test]
    fn set_enabled_flips_column() {
        let conn = make_conn();
        let row = stdio_row("s1", 1000);
        insert_server(&conn, &row).unwrap();
        assert!(!get_server(&conn, "s1").unwrap().unwrap().enabled);

        set_enabled(&conn, "s1", true).unwrap();
        assert!(get_server(&conn, "s1").unwrap().unwrap().enabled);
    }

    #[test]
    fn delete_server_is_noop_for_unknown_id() {
        let conn = make_conn();
        // Should not return an error for a non-existent id
        delete_server(&conn, "nonexistent").unwrap();
    }

    #[test]
    fn list_servers_returns_in_creation_order() {
        let conn = make_conn();
        insert_server(&conn, &stdio_row("s3", 3000)).unwrap();
        insert_server(&conn, &stdio_row("s1", 1000)).unwrap();
        insert_server(&conn, &stdio_row("s2", 2000)).unwrap();

        let servers = list_servers(&conn).unwrap();
        assert_eq!(servers.len(), 3);
        assert_eq!(servers[0].id, "s1");
        assert_eq!(servers[1].id, "s2");
        assert_eq!(servers[2].id, "s3");
    }
}
