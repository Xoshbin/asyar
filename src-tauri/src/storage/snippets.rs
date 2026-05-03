use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword: Option<String>,
    pub expansion: String,
    pub name: String,
    pub created_at: f64,
    #[serde(default)]
    pub pinned: bool,
    /// Comma-separated list of secret-detector kind names matched in
    /// `expansion` at save time. See [`crate::secret_detection::redact`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redacted_kinds: Option<Vec<String>>,
}

fn encode_redacted_kinds(kinds: &Option<Vec<String>>) -> Option<String> {
    kinds
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| v.join(","))
}

fn decode_redacted_kinds(raw: Option<String>) -> Option<Vec<String>> {
    raw.filter(|s| !s.is_empty())
        .map(|s| s.split(',').map(|p| p.to_string()).collect())
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS snippets (
            id TEXT PRIMARY KEY,
            keyword TEXT,
            expansion TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at REAL NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init snippets table: {e}")))?;

    // Migration: add redacted_kinds column if it doesn't exist yet.
    let redacted_kinds_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('snippets') WHERE name='redacted_kinds'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if !redacted_kinds_exists {
        conn.execute("ALTER TABLE snippets ADD COLUMN redacted_kinds TEXT", [])
            .map_err(|e| {
                AppError::Database(format!("Failed to add redacted_kinds column: {e}"))
            })?;
    }

    Ok(())
}

/// Insert or replace a snippet (upsert by id).
pub fn upsert(conn: &Connection, snippet: &Snippet) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO snippets (id, keyword, expansion, name, created_at, pinned, redacted_kinds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            snippet.id,
            snippet.keyword,
            snippet.expansion,
            snippet.name,
            snippet.created_at,
            snippet.pinned as i32,
            encode_redacted_kinds(&snippet.redacted_kinds),
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to upsert snippet: {e}")))?;
    Ok(())
}

/// Update specific fields of a snippet.
pub fn update(
    conn: &Connection,
    id: &str,
    keyword: Option<&str>,
    expansion: Option<&str>,
    name: Option<&str>,
    pinned: Option<bool>,
) -> Result<(), AppError> {
    // Build SET clauses dynamically
    let mut sets = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(v) = keyword {
        sets.push("keyword = ?");
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = expansion {
        sets.push("expansion = ?");
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = name {
        sets.push("name = ?");
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = pinned {
        sets.push("pinned = ?");
        values.push(Box::new(v as i32));
    }

    if sets.is_empty() {
        return Ok(());
    }

    let sql = format!(
        "UPDATE snippets SET {} WHERE id = ?",
        sets.join(", ")
    );
    values.push(Box::new(id.to_string()));

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    conn.execute(&sql, params.as_slice())
        .map_err(|e| AppError::Database(format!("Failed to update snippet: {e}")))?;
    Ok(())
}

/// Delete a snippet by id.
pub fn remove(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])
        .map_err(|e| AppError::Database(format!("Failed to delete snippet: {e}")))?;
    Ok(())
}

/// Toggle pinned status. Returns the new pinned value.
pub fn toggle_pin(conn: &Connection, id: &str) -> Result<bool, AppError> {
    conn.execute(
        "UPDATE snippets SET pinned = 1 - pinned WHERE id = ?1",
        params![id],
    )
    .map_err(|e| AppError::Database(format!("Failed to toggle pin: {e}")))?;

    let new_val: bool = conn
        .query_row(
            "SELECT pinned FROM snippets WHERE id = ?1",
            params![id],
            |row| Ok(row.get::<_, i32>(0)? != 0),
        )
        .map_err(|e| AppError::Database(format!("Failed to read pinned: {e}")))?;

    Ok(new_val)
}

/// Delete all snippets.
pub fn clear_all(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM snippets", [])
        .map_err(|e| AppError::Database(format!("Failed to clear snippets: {e}")))?;
    Ok(())
}

/// Get all snippets.
pub fn get_all(conn: &Connection) -> Result<Vec<Snippet>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, keyword, expansion, name, created_at, pinned, redacted_kinds
             FROM snippets ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare query: {e}")))?;

    let items = stmt
        .query_map([], |row| {
            let redacted_kinds_str: Option<String> = row.get(6)?;
            Ok(Snippet {
                id: row.get(0)?,
                keyword: row.get(1)?,
                expansion: row.get(2)?,
                name: row.get(3)?,
                created_at: row.get(4)?,
                pinned: row.get::<_, i32>(5)? != 0,
                redacted_kinds: decode_redacted_kinds(redacted_kinds_str),
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query snippets: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    fn make_snippet(id: &str, keyword: &str, expansion: &str) -> Snippet {
        Snippet {
            id: id.to_string(),
            keyword: Some(keyword.to_string()),
            expansion: expansion.to_string(),
            name: format!("Snippet {id}"),
            created_at: 1000.0 + id.parse::<f64>().unwrap_or(0.0),
            pinned: false,
            redacted_kinds: None,
        }
    }

    #[test]
    fn test_redacted_kinds_round_trip() {
        let conn = setup();
        let mut s = make_snippet("1", ";a", "[redacted: aws_access_key]");
        s.redacted_kinds = Some(vec!["aws_access_key".into()]);
        upsert(&conn, &s).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].redacted_kinds.as_ref().unwrap(),
            &vec!["aws_access_key".to_string()]
        );
    }

    #[test]
    fn test_init_table_idempotent_adds_redacted_kinds() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE snippets (
                id TEXT PRIMARY KEY,
                keyword TEXT,
                expansion TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at REAL NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();

        init_table(&conn).unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('snippets') WHERE name='redacted_kinds'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        // Idempotent re-run.
        init_table(&conn).unwrap();
    }

    #[test]
    fn test_upsert_and_get_all() {
        let conn = setup();
        upsert(&conn, &make_snippet("1", ";a", "alpha")).unwrap();
        upsert(&conn, &make_snippet("2", ";b", "beta")).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "2"); // newest first
    }

    #[test]
    fn test_upsert_replaces() {
        let conn = setup();
        upsert(&conn, &make_snippet("1", ";a", "alpha")).unwrap();
        upsert(&conn, &make_snippet("1", ";a", "updated")).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].expansion, "updated");
    }

    #[test]
    fn test_update_partial() {
        let conn = setup();
        upsert(&conn, &make_snippet("1", ";a", "alpha")).unwrap();

        update(&conn, "1", None, Some("new expansion"), None, None).unwrap();

        let items = get_all(&conn).unwrap();
        assert_eq!(items[0].expansion, "new expansion");
        assert_eq!(items[0].keyword.as_deref(), Some(";a")); // unchanged
    }

    #[test]
    fn test_remove() {
        let conn = setup();
        upsert(&conn, &make_snippet("1", ";a", "alpha")).unwrap();
        upsert(&conn, &make_snippet("2", ";b", "beta")).unwrap();

        remove(&conn, "1").unwrap();
        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2");
    }

    #[test]
    fn test_toggle_pin() {
        let conn = setup();
        upsert(&conn, &make_snippet("1", ";a", "alpha")).unwrap();

        let pinned = toggle_pin(&conn, "1").unwrap();
        assert!(pinned);

        let pinned = toggle_pin(&conn, "1").unwrap();
        assert!(!pinned);
    }

    #[test]
    fn test_clear_all() {
        let conn = setup();
        upsert(&conn, &make_snippet("1", ";a", "alpha")).unwrap();
        upsert(&conn, &make_snippet("2", ";b", "beta")).unwrap();

        clear_all(&conn).unwrap();
        let items = get_all(&conn).unwrap();
        assert_eq!(items.len(), 0);
    }
}
