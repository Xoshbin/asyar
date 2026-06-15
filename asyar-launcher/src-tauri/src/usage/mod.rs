//! Local-first usage recording. Owns a dedicated `usage.db`.
//! Recording always runs locally; the network sender (sender.rs) is gated
//! behind UsageShareMode and is OFF by default.

use std::collections::HashMap;
use std::sync::Mutex;

pub mod sender;

/// Managed Tauri state: the single connection to usage.db.
pub struct UsageState {
    pub db: Mutex<rusqlite::Connection>,
}

#[derive(Debug, thiserror::Error)]
pub enum UsageError {
    #[error("usage db error: {0}")]
    Db(String),
    #[error("usage lock poisoned")]
    Lock,
}

impl serde::Serialize for UsageError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

const DB_FILE_NAME: &str = "usage.db";

pub fn init_schema(conn: &rusqlite::Connection) -> Result<(), UsageError> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS usage_events (
            event_type TEXT NOT NULL,        -- 'launch' | 'heartbeat'
            target     TEXT NOT NULL,        -- item id, '' for heartbeat
            day        TEXT NOT NULL,        -- 'YYYY-MM-DD' local date
            count      INTEGER NOT NULL DEFAULT 0,
            sent       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (event_type, target, day)
         );
         CREATE TABLE IF NOT EXISTS usage_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
         );",
    )
    .map_err(|e| UsageError::Db(e.to_string()))?;
    Ok(())
}

/// Open (or create) usage.db in the app data dir and build managed state.
pub fn initialize_usage_state<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<UsageState, Box<dyn std::error::Error>> {
    use tauri::Manager;
    let dir = app_handle.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = rusqlite::Connection::open(dir.join(DB_FILE_NAME))?;
    init_schema(&conn)?;
    Ok(UsageState {
        db: Mutex::new(conn),
    })
}

impl UsageState {
    pub fn record_launch(&self, target: &str, day: &str) -> Result<(), UsageError> {
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;
        conn.execute(
            "INSERT INTO usage_events (event_type, target, day, count, sent)
             VALUES ('launch', ?1, ?2, 1, 0)
             ON CONFLICT(event_type, target, day)
             DO UPDATE SET count = count + 1",
            rusqlite::params![target, day],
        )
        .map_err(|e| UsageError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn record_active_day(&self, day: &str) -> Result<(), UsageError> {
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;
        conn.execute(
            "INSERT INTO usage_events (event_type, target, day, count, sent)
             VALUES ('heartbeat', '', ?1, 1, 0)
             ON CONFLICT(event_type, target, day) DO NOTHING",
            rusqlite::params![day],
        )
        .map_err(|e| UsageError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn anon_id(&self) -> Result<String, UsageError> {
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;
        let existing: Option<String> = conn
            .query_row(
                "SELECT value FROM usage_meta WHERE key='anon_id'",
                [],
                |r| r.get(0),
            )
            .ok();
        if let Some(id) = existing {
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO usage_meta (key, value) VALUES ('anon_id', ?1)",
            rusqlite::params![id],
        )
        .map_err(|e| UsageError::Db(e.to_string()))?;
        Ok(id)
    }

    pub fn reset_anon_id(&self) -> Result<String, UsageError> {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;
        conn.execute(
            "INSERT INTO usage_meta (key, value) VALUES ('anon_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| UsageError::Db(e.to_string()))?;
        Ok(id)
    }

    pub fn rollup_for_day(&self, day: &str) -> Result<DayRollup, UsageError> {
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;

        let active: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE event_type='heartbeat' AND day=?1",
                rusqlite::params![day],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| UsageError::Db(e.to_string()))?
            > 0;

        let mut launches = HashMap::new();
        let mut stmt = conn
            .prepare("SELECT target, count FROM usage_events WHERE event_type='launch' AND day=?1")
            .map_err(|e| UsageError::Db(e.to_string()))?;
        let rows = stmt
            .query_map(rusqlite::params![day], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u32))
            })
            .map_err(|e| UsageError::Db(e.to_string()))?;
        for row in rows {
            let (t, c) = row.map_err(|e| UsageError::Db(e.to_string()))?;
            launches.insert(t, c);
        }

        Ok(DayRollup {
            day: day.to_string(),
            active,
            launches,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageShareMode {
    Off,
    Ask,
    Auto,
}

/// Mirrors feedback::parse_crash_report_mode. Default Off on any parse miss.
pub fn parse_usage_share_mode(settings_json: &str) -> UsageShareMode {
    let value: serde_json::Value = match serde_json::from_str(settings_json) {
        Ok(v) => v,
        Err(_) => return UsageShareMode::Off,
    };
    match value
        .get("privacy")
        .and_then(|p| p.get("usageShareMode"))
        .and_then(|m| m.as_str())
    {
        Some("ask") => UsageShareMode::Ask,
        Some("auto") => UsageShareMode::Auto,
        _ => UsageShareMode::Off,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DayRollup {
    pub day: String,
    pub active: bool,
    pub launches: HashMap<String, u32>,
}

/// Today's local date as YYYY-MM-DD.
pub fn local_day() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopItem {
    pub id: String,
    /// Human-friendly display title resolved from the search index (e.g.
    /// "Paste" for `cmd_org.asyar.clipboard_paste`). `None` here in
    /// `UsageState::stats()` — it has no access to the search index — and is
    /// populated by the `get_usage_stats` command via `SearchState`.
    pub label: Option<String>,
    pub count: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub active_days: u32,
    pub total_launches: u32,
    pub top: Vec<TopItem>,
}

impl UsageState {
    pub fn stats(&self) -> Result<UsageStats, UsageError> {
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;

        let active_days: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE event_type='heartbeat'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| UsageError::Db(e.to_string()))? as u32;

        let total_launches: u32 = conn
            .query_row(
                "SELECT COALESCE(SUM(count),0) FROM usage_events WHERE event_type='launch'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| UsageError::Db(e.to_string()))? as u32;

        let mut top = Vec::new();
        let mut stmt = conn
            .prepare(
                "SELECT target, SUM(count) AS c FROM usage_events
                 WHERE event_type='launch' GROUP BY target ORDER BY c DESC LIMIT 20",
            )
            .map_err(|e| UsageError::Db(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TopItem {
                    id: r.get(0)?,
                    label: None,
                    count: r.get::<_, i64>(1)? as u32,
                })
            })
            .map_err(|e| UsageError::Db(e.to_string()))?;
        for row in rows {
            top.push(row.map_err(|e| UsageError::Db(e.to_string()))?);
        }

        Ok(UsageStats {
            active_days,
            total_launches,
            top,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_state() -> UsageState {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        UsageState {
            db: std::sync::Mutex::new(conn),
        }
    }

    #[test]
    fn schema_creates_tables() {
        let state = mem_state();
        let conn = state.db.lock().unwrap();
        // querying the empty tables must succeed
        let events: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_events", [], |r| r.get(0))
            .unwrap();
        let meta: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_meta", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 0);
        assert_eq!(meta, 0);
    }

    #[test]
    fn record_launch_increments_same_day() {
        let state = mem_state();
        state
            .record_launch("org.asyar.calculator", "2026-06-15")
            .unwrap();
        state
            .record_launch("org.asyar.calculator", "2026-06-15")
            .unwrap();
        state
            .record_launch("org.asyar.calculator", "2026-06-15")
            .unwrap();

        let conn = state.db.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count FROM usage_events WHERE event_type='launch' AND target=?1 AND day=?2",
                rusqlite::params!["org.asyar.calculator", "2026-06-15"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn record_launch_separates_days() {
        let state = mem_state();
        state.record_launch("a", "2026-06-15").unwrap();
        state.record_launch("a", "2026-06-16").unwrap();
        let conn = state.db.lock().unwrap();
        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE target='a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 2);
    }

    #[test]
    fn heartbeat_is_idempotent_per_day() {
        let state = mem_state();
        state.record_active_day("2026-06-15").unwrap();
        state.record_active_day("2026-06-15").unwrap();
        let conn = state.db.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count FROM usage_events WHERE event_type='heartbeat' AND day='2026-06-15'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1); // stays 1, never increments
    }

    #[test]
    fn anon_id_is_stable_then_resettable() {
        let state = mem_state();
        let a = state.anon_id().unwrap();
        let b = state.anon_id().unwrap();
        assert_eq!(a, b); // stable across calls
        assert_eq!(a.len(), 36); // uuid v4 hyphenated

        let c = state.reset_anon_id().unwrap();
        assert_ne!(a, c); // reset produces a new id
        assert_eq!(state.anon_id().unwrap(), c);
    }

    #[test]
    fn rollup_for_day_collects_launches_and_active() {
        let state = mem_state();
        state.record_launch("a", "2026-06-15").unwrap();
        state.record_launch("a", "2026-06-15").unwrap();
        state.record_launch("b", "2026-06-15").unwrap();
        state.record_active_day("2026-06-15").unwrap();
        state.record_launch("c", "2026-06-16").unwrap(); // other day excluded

        let r = state.rollup_for_day("2026-06-15").unwrap();
        assert!(r.active);
        assert_eq!(r.launches.get("a"), Some(&2));
        assert_eq!(r.launches.get("b"), Some(&1));
        assert_eq!(r.launches.get("c"), None);
    }

    #[test]
    fn parse_share_mode_defaults_off() {
        assert_eq!(parse_usage_share_mode("{}"), UsageShareMode::Off);
        assert_eq!(parse_usage_share_mode("not json"), UsageShareMode::Off);
        assert_eq!(
            parse_usage_share_mode(r#"{"privacy":{"usageShareMode":"ask"}}"#),
            UsageShareMode::Ask
        );
        assert_eq!(
            parse_usage_share_mode(r#"{"privacy":{"usageShareMode":"auto"}}"#),
            UsageShareMode::Auto
        );
    }

    #[test]
    fn stats_returns_totals_and_active_days() {
        let state = mem_state();
        state.record_launch("a", "2026-06-15").unwrap();
        state.record_launch("a", "2026-06-15").unwrap();
        state.record_launch("b", "2026-06-16").unwrap();
        state.record_active_day("2026-06-15").unwrap();
        state.record_active_day("2026-06-16").unwrap();

        let s = state.stats().unwrap();
        assert_eq!(s.active_days, 2);
        assert_eq!(s.total_launches, 3);
        // top items sorted desc by count
        assert_eq!(s.top.first().map(|t| t.id.as_str()), Some("a"));
        assert_eq!(s.top.first().map(|t| t.count), Some(2));
    }

    #[test]
    fn local_day_format_is_yyyy_mm_dd() {
        // local_day() returns today in YYYY-MM-DD; assert shape, not value.
        let d = local_day();
        assert_eq!(d.len(), 10);
        assert_eq!(d.as_bytes()[4], b'-');
        assert_eq!(d.as_bytes()[7], b'-');
    }
}
