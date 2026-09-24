//! Launcher query recall. SQLite owns retention; this service owns the recall session.

use crate::{error::AppError, storage::query_history as storage};
use rusqlite::Connection;
use std::sync::Mutex;

#[derive(Debug, Default)]
struct RecallSession {
    session_id: String,
    entries: Vec<String>,
    index: isize,
}

#[derive(Debug, Default)]
pub struct QueryHistoryService {
    session: Mutex<Option<RecallSession>>,
}

impl QueryHistoryService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, conn: &Connection, query: &str) -> Result<(), AppError> {
        self.reset();
        storage::record(conn, query)
    }

    pub fn delete(&self, conn: &Connection, query: &str) -> Result<(), AppError> {
        self.reset();
        storage::delete(conn, query)
    }

    pub fn reset(&self) {
        if let Ok(mut session) = self.session.lock() {
            *session = None;
        }
    }

    pub fn navigate(
        &self,
        conn: &Connection,
        session_id: &str,
        direction: i32,
    ) -> Result<Option<String>, AppError> {
        if direction == 0 {
            return Err(AppError::Validation(
                "query history navigation direction cannot be 0".to_string(),
            ));
        }

        let mut guard = self.session.lock().map_err(|_| AppError::Lock)?;

        let session = match guard.as_mut() {
            Some(s) if s.session_id == session_id => s,
            _ => {
                if direction > 0 {
                    return Ok(None);
                }
                let entries = storage::list(conn)?;
                if entries.is_empty() {
                    return Ok(None);
                }
                *guard = Some(RecallSession {
                    session_id: session_id.to_string(),
                    entries,
                    index: -1,
                });
                guard.as_mut().unwrap()
            }
        };

        if session.entries.is_empty() {
            return Ok(None);
        }

        if direction < 0 {
            let next_index = (session.index + 1).min(session.entries.len() as isize - 1);
            session.index = next_index;
            Ok(Some(session.entries[session.index as usize].clone()))
        } else if session.index < 0 {
            Ok(None)
        } else if session.index == 0 {
            session.index = -1;
            Ok(Some(String::new()))
        } else {
            session.index -= 1;
            Ok(Some(session.entries[session.index as usize].clone()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::query_history as storage;
    use rusqlite::Connection;

    #[test]
    fn recall_is_newest_first_bounded_and_returns_to_empty() {
        let conn = Connection::open_in_memory().unwrap();
        storage::init_table(&conn).unwrap();
        let service = QueryHistoryService::default();
        service.record(&conn, "older").unwrap();
        service.record(&conn, "newest").unwrap();
        assert_eq!(
            service.navigate(&conn, "a", -1).unwrap().as_deref(),
            Some("newest")
        );
        assert_eq!(
            service.navigate(&conn, "a", -1).unwrap().as_deref(),
            Some("older")
        );
        assert_eq!(
            service.navigate(&conn, "a", -1).unwrap().as_deref(),
            Some("older")
        );
        assert_eq!(
            service.navigate(&conn, "a", 1).unwrap().as_deref(),
            Some("newest")
        );
        assert_eq!(
            service.navigate(&conn, "a", 1).unwrap().as_deref(),
            Some("")
        );
        assert_eq!(service.navigate(&conn, "a", 1).unwrap(), None);
    }

    #[test]
    fn fresh_session_and_mutations_invalidate_the_cached_cursor() {
        let conn = Connection::open_in_memory().unwrap();
        storage::init_table(&conn).unwrap();
        let service = QueryHistoryService::default();
        service.record(&conn, "older").unwrap();
        service.record(&conn, "newest").unwrap();
        service.navigate(&conn, "a", -1).unwrap();
        service.navigate(&conn, "a", -1).unwrap();
        assert_eq!(
            service.navigate(&conn, "b", -1).unwrap().as_deref(),
            Some("newest")
        );
        service.record(&conn, "last").unwrap();
        assert_eq!(
            service.navigate(&conn, "b", -1).unwrap().as_deref(),
            Some("last")
        );
        service.delete(&conn, "last").unwrap();
        assert_eq!(
            service.navigate(&conn, "b", -1).unwrap().as_deref(),
            Some("newest")
        );
    }

    #[test]
    fn empty_history_and_invalid_direction_do_not_move() {
        let conn = Connection::open_in_memory().unwrap();
        storage::init_table(&conn).unwrap();
        let service = QueryHistoryService::default();
        assert_eq!(service.navigate(&conn, "a", -1).unwrap(), None);
        service.record(&conn, "newest").unwrap();
        assert!(service.navigate(&conn, "a", 0).is_err());
        assert_eq!(service.navigate(&conn, "a", 1).unwrap(), None);
        assert_eq!(
            service.navigate(&conn, "a", -1).unwrap().as_deref(),
            Some("newest")
        );
    }
}
