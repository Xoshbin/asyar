use crate::error::AppError;
use rusqlite::Connection;

fn database_error(error: rusqlite::Error) -> AppError {
    AppError::Database(format!("Query history: {error}"))
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS query_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL UNIQUE);")
        .map_err(database_error)
}

pub fn record(conn: &Connection, query: &str) -> Result<(), AppError> {
    if query.trim().is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(database_error)?;
    tx.execute("DELETE FROM query_history WHERE query = ?1", [query])
        .map_err(database_error)?;
    tx.execute("INSERT INTO query_history (query) VALUES (?1)", [query])
        .map_err(database_error)?;
    tx.execute("DELETE FROM query_history WHERE sequence NOT IN (SELECT sequence FROM query_history ORDER BY sequence DESC LIMIT 48)", []).map_err(database_error)?;
    tx.commit().map_err(database_error)
}

pub fn list(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut statement = conn
        .prepare("SELECT query FROM query_history ORDER BY sequence DESC LIMIT 48")
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| row.get(0))
        .map_err(database_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(database_error)
}

pub fn delete(conn: &Connection, query: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM query_history WHERE query = ?1", [query])
        .map_err(database_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_only_the_latest_48_queries_and_promotes_duplicates() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        for i in 0..50 {
            record(&conn, &format!("query {i}")).unwrap();
        }
        let entries = list(&conn).unwrap();
        assert_eq!(entries.len(), 48);
        assert_eq!(entries[0], "query 49");
        assert_eq!(entries[47], "query 2");
        record(&conn, "query 2").unwrap();
        let entries = list(&conn).unwrap();
        assert_eq!(entries.len(), 48);
        assert_eq!(entries[0], "query 2");
    }

    #[test]
    fn preserves_exact_text_ignores_blanks_and_deletes_only_the_requested_query() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        record(&conn, " 22+5 ").unwrap();
        record(&conn, "other").unwrap();
        record(&conn, " \n ").unwrap();
        assert_eq!(list(&conn).unwrap(), vec!["other", " 22+5 "]);
        delete(&conn, "other").unwrap();
        delete(&conn, "missing").unwrap();
        assert_eq!(list(&conn).unwrap(), vec![" 22+5 "]);
    }
}
