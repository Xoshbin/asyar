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
    Ok(())
}

/// Insert or replace a snippet (upsert by id).
pub fn upsert(conn: &Connection, snippet: &Snippet) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO snippets (id, keyword, expansion, name, created_at, pinned)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            snippet.id,
            snippet.keyword,
            snippet.expansion,
            snippet.name,
            snippet.created_at,
            snippet.pinned as i32,
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
            "SELECT id, keyword, expansion, name, created_at, pinned
             FROM snippets ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare query: {e}")))?;

    let items = stmt
        .query_map([], |row| {
            Ok(Snippet {
                id: row.get(0)?,
                keyword: row.get(1)?,
                expansion: row.get(2)?,
                name: row.get(3)?,
                created_at: row.get(4)?,
                pinned: row.get::<_, i32>(5)? != 0,
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
        }
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
