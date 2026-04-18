//! Persistent one-shot timers for extensions.
//!
//! An extension asks the host to "fire command `C` with args `A` at Unix-
//! millis `T`". The timer survives an app quit — at next boot any row with
//! `fired = 0 AND fire_at <= now` is caught up (staggered so 50 overdue
//! timers don't slam the bridge in one tick).
//!
//! Persist-first-emit-second is the load-bearing ordering: the scheduler
//! updates `fired = 1` in SQLite *before* calling `emit("asyar:timer:fire")`
//! so a crash mid-emit can't re-fire the same timer on the next tick.

pub mod scheduler;
pub mod startup;

use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// Tauri event name used when a timer fires. The TS-side bridge
/// (`timerBridge.svelte.ts`) listens for this and dispatches the
/// command into the extension iframe — same path as
/// `asyar:scheduler:tick` for recurring manifest-declared schedules.
pub const TIMER_FIRE_EVENT: &str = "asyar:timer:fire";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerDescriptor {
    pub timer_id: String,
    pub extension_id: String,
    pub command_id: String,
    pub args_json: String,
    pub fire_at: u64,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerFirePayload {
    pub extension_id: String,
    pub timer_id: String,
    pub command_id: String,
    pub args_json: String,
    pub fire_at: u64,
    pub fired_at: u64,
}

#[derive(Clone)]
pub struct TimerRegistry {
    conn: Arc<Mutex<Connection>>,
}

impl TimerRegistry {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    #[cfg(test)]
    pub(crate) fn in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("in-memory SQLite");
        crate::storage::timers::init_table(&conn).expect("init extension_timers");
        Self {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    pub fn schedule(
        &self,
        extension_id: &str,
        command_id: &str,
        args_json: &str,
        fire_at: u64,
        now_ms: u64,
    ) -> Result<String, AppError> {
        let parsed: serde_json::Value = serde_json::from_str(args_json)
            .map_err(|e| AppError::Validation(format!("args_json is not valid JSON: {e}")))?;
        if !parsed.is_object() {
            return Err(AppError::Validation(
                "args_json must be a JSON object".to_string(),
            ));
        }
        if fire_at <= now_ms {
            return Err(AppError::Validation(format!(
                "fire_at ({fire_at}) must be strictly greater than now ({now_ms})"
            )));
        }
        let timer_id = uuid::Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        conn.execute(
            "INSERT INTO extension_timers
                (timer_id, extension_id, command_id, args_json, fire_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                timer_id,
                extension_id,
                command_id,
                args_json,
                fire_at as i64,
                now_ms as i64
            ],
        )
        .map_err(|e| AppError::Database(format!("Failed to insert timer: {e}")))?;
        Ok(timer_id)
    }

    pub fn cancel(&self, extension_id: &str, timer_id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        let owner: Option<String> = conn
            .query_row(
                "SELECT extension_id FROM extension_timers WHERE timer_id = ?1",
                params![timer_id],
                |r| r.get(0),
            )
            .ok();
        match owner {
            Some(o) if o == extension_id => {
                conn.execute(
                    "DELETE FROM extension_timers WHERE timer_id = ?1 AND extension_id = ?2",
                    params![timer_id, extension_id],
                )
                .map_err(|e| AppError::Database(format!("Failed to delete timer: {e}")))?;
                Ok(())
            }
            Some(_) => Err(AppError::Permission(format!(
                "Extension \"{}\" does not own timer \"{}\"",
                extension_id, timer_id
            ))),
            None => Err(AppError::NotFound(format!(
                "Timer \"{}\" not found",
                timer_id
            ))),
        }
    }

    pub fn list_pending(&self, extension_id: &str) -> Result<Vec<TimerDescriptor>, AppError> {
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        let mut stmt = conn
            .prepare(
                "SELECT timer_id, extension_id, command_id, args_json, fire_at, created_at
                 FROM extension_timers
                 WHERE extension_id = ?1 AND fired = 0
                 ORDER BY fire_at ASC",
            )
            .map_err(|e| AppError::Database(format!("Failed to prepare list_pending: {e}")))?;
        let iter = stmt
            .query_map(params![extension_id], Self::map_row)
            .map_err(|e| AppError::Database(format!("Failed to query list_pending: {e}")))?;
        let mut out = Vec::new();
        for r in iter {
            out.push(r.map_err(|e| AppError::Database(format!("Row error: {e}")))?);
        }
        Ok(out)
    }

    pub fn due_now(&self, now_ms: u64) -> Result<Vec<TimerDescriptor>, AppError> {
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        let mut stmt = conn
            .prepare(
                "SELECT timer_id, extension_id, command_id, args_json, fire_at, created_at
                 FROM extension_timers
                 WHERE fired = 0 AND fire_at <= ?1
                 ORDER BY fire_at ASC",
            )
            .map_err(|e| AppError::Database(format!("Failed to prepare due_now: {e}")))?;
        let iter = stmt
            .query_map(params![now_ms as i64], Self::map_row)
            .map_err(|e| AppError::Database(format!("Failed to query due_now: {e}")))?;
        let mut out = Vec::new();
        for r in iter {
            out.push(r.map_err(|e| AppError::Database(format!("Row error: {e}")))?);
        }
        Ok(out)
    }

    pub fn mark_fired(
        &self,
        extension_id: &str,
        timer_id: &str,
        fired_at: u64,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        // Guard the update with `fired = 0` so a second mark_fired (e.g. a
        // retry after a panic mid-emit) becomes a zero-row update we can
        // detect rather than silently toggling state.
        let n = conn
            .execute(
                "UPDATE extension_timers
                 SET fired = 1, fired_at = ?1
                 WHERE extension_id = ?2 AND timer_id = ?3 AND fired = 0",
                params![fired_at as i64, extension_id, timer_id],
            )
            .map_err(|e| AppError::Database(format!("Failed to mark fired: {e}")))?;
        if n == 0 {
            return Err(AppError::NotFound(format!(
                "No unfired timer \"{}\" for extension \"{}\"",
                timer_id, extension_id
            )));
        }
        Ok(())
    }

    pub fn clear_all_for_extension(&self, extension_id: &str) -> Result<usize, AppError> {
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        let n = conn
            .execute(
                "DELETE FROM extension_timers WHERE extension_id = ?1",
                params![extension_id],
            )
            .map_err(|e| AppError::Database(format!("Failed to clear timers: {e}")))?;
        Ok(n)
    }

    pub fn prune_old_fired(&self, older_than_ms: u64) -> Result<usize, AppError> {
        let conn = self.conn.lock().map_err(|_| AppError::Lock)?;
        let n = conn
            .execute(
                "DELETE FROM extension_timers
                 WHERE fired = 1 AND fired_at IS NOT NULL AND fired_at < ?1",
                params![older_than_ms as i64],
            )
            .map_err(|e| AppError::Database(format!("Failed to prune fired timers: {e}")))?;
        Ok(n)
    }

    fn map_row(row: &rusqlite::Row) -> rusqlite::Result<TimerDescriptor> {
        Ok(TimerDescriptor {
            timer_id: row.get(0)?,
            extension_id: row.get(1)?,
            command_id: row.get(2)?,
            args_json: row.get(3)?,
            fire_at: row.get::<_, i64>(4)? as u64,
            created_at: row.get::<_, i64>(5)? as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make() -> TimerRegistry {
        TimerRegistry::in_memory()
    }

    #[test]
    fn schedule_returns_uuid_and_persists_row() {
        let r = make();
        let id = r.schedule("ext-a", "cmd.bell", "{}", 2_000, 1_000).unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok(), "got: {id}");
        let pending = r.list_pending("ext-a").unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].timer_id, id);
        assert_eq!(pending[0].extension_id, "ext-a");
        assert_eq!(pending[0].command_id, "cmd.bell");
        assert_eq!(pending[0].fire_at, 2_000);
        assert_eq!(pending[0].created_at, 1_000);
        assert_eq!(pending[0].args_json, "{}");
    }

    #[test]
    fn schedule_persists_args_json_verbatim() {
        let r = make();
        let id = r
            .schedule("ext-a", "cmd", r#"{"snooze":300000,"note":"hi"}"#, 5_000, 1_000)
            .unwrap();
        let got = r.list_pending("ext-a").unwrap();
        assert_eq!(got[0].timer_id, id);
        assert_eq!(got[0].args_json, r#"{"snooze":300000,"note":"hi"}"#);
    }

    #[test]
    fn schedule_rejects_past_fire_at() {
        let r = make();
        let err = r
            .schedule("ext-a", "cmd", "{}", 1_000, 2_000)
            .expect_err("past fire_at should fail");
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn schedule_rejects_fire_at_equal_to_now() {
        let r = make();
        let err = r
            .schedule("ext-a", "cmd", "{}", 2_000, 2_000)
            .expect_err("fire_at == now should fail");
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn schedule_rejects_non_object_args_json() {
        let r = make();
        // Array JSON - valid JSON but not an object
        let err = r
            .schedule("ext-a", "cmd", "[1, 2, 3]", 2_000, 1_000)
            .expect_err("array args_json should fail");
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        // Invalid JSON entirely
        let err = r
            .schedule("ext-a", "cmd", "not json", 2_000, 1_000)
            .expect_err("bad json should fail");
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn cancel_deletes_row_and_returns_ok() {
        let r = make();
        let id = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        r.cancel("ext-a", &id).unwrap();
        assert!(r.list_pending("ext-a").unwrap().is_empty());
    }

    #[test]
    fn cancel_returns_not_found_for_unknown_id() {
        let r = make();
        let err = r.cancel("ext-a", "no-such-id").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn cancel_returns_permission_denied_for_other_extensions_timer() {
        let r = make();
        let id = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        let err = r.cancel("ext-b", &id).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
        // Timer still present
        assert_eq!(r.list_pending("ext-a").unwrap().len(), 1);
    }

    #[test]
    fn list_pending_scoped_to_extension_and_unfired_only() {
        let r = make();
        let _a1 = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        let a2 = r.schedule("ext-a", "cmd", "{}", 3_000, 1_000).unwrap();
        let _b1 = r.schedule("ext-b", "cmd", "{}", 2_500, 1_000).unwrap();
        // Mark a2 fired
        r.mark_fired("ext-a", &a2, 3_001).unwrap();

        let a = r.list_pending("ext-a").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].fire_at, 2_000);

        let b = r.list_pending("ext-b").unwrap();
        assert_eq!(b.len(), 1);
    }

    #[test]
    fn list_pending_orders_by_fire_at_ascending() {
        let r = make();
        let _late = r.schedule("ext-a", "cmd", "{}", 5_000, 1_000).unwrap();
        let _early = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        let _mid = r.schedule("ext-a", "cmd", "{}", 3_000, 1_000).unwrap();

        let pending = r.list_pending("ext-a").unwrap();
        let fires: Vec<u64> = pending.iter().map(|p| p.fire_at).collect();
        assert_eq!(fires, vec![2_000, 3_000, 5_000]);
    }

    #[test]
    fn due_now_returns_unfired_rows_at_or_before_now_across_extensions() {
        let r = make();
        let a_early = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        let _a_late = r.schedule("ext-a", "cmd", "{}", 10_000, 1_000).unwrap();
        let b_early = r.schedule("ext-b", "cmd", "{}", 2_500, 1_000).unwrap();

        let due = r.due_now(3_000).unwrap();
        let ids: Vec<&str> = due.iter().map(|d| d.timer_id.as_str()).collect();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&a_early.as_str()));
        assert!(ids.contains(&b_early.as_str()));
    }

    #[test]
    fn due_now_excludes_already_fired_rows() {
        let r = make();
        let id = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        r.mark_fired("ext-a", &id, 2_001).unwrap();
        assert!(r.due_now(9_000).unwrap().is_empty());
    }

    #[test]
    fn mark_fired_sets_flag_and_hides_row_from_pending() {
        let r = make();
        let id = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        r.mark_fired("ext-a", &id, 2_001).unwrap();
        assert!(r.list_pending("ext-a").unwrap().is_empty());
    }

    #[test]
    fn mark_fired_errors_on_unknown_pair() {
        let r = make();
        let err = r.mark_fired("ext-a", "nope", 1).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn mark_fired_is_idempotent_not_double_fire() {
        // Second mark_fired on an already-fired row should return NotFound,
        // preventing a re-emit from accidentally toggling the row again.
        let r = make();
        let id = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        r.mark_fired("ext-a", &id, 2_001).unwrap();
        let err = r.mark_fired("ext-a", &id, 2_002).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn clear_all_for_extension_deletes_only_that_extensions_rows() {
        let r = make();
        let _a1 = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        let _a2 = r.schedule("ext-a", "cmd", "{}", 3_000, 1_000).unwrap();
        let _b1 = r.schedule("ext-b", "cmd", "{}", 4_000, 1_000).unwrap();

        let n = r.clear_all_for_extension("ext-a").unwrap();
        assert_eq!(n, 2);
        assert!(r.list_pending("ext-a").unwrap().is_empty());
        assert_eq!(r.list_pending("ext-b").unwrap().len(), 1);
    }

    #[test]
    fn clear_all_for_extension_removes_fired_and_unfired() {
        let r = make();
        let a1 = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        let _a2 = r.schedule("ext-a", "cmd", "{}", 3_000, 1_000).unwrap();
        r.mark_fired("ext-a", &a1, 2_500).unwrap();
        let n = r.clear_all_for_extension("ext-a").unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn clear_all_for_extension_returns_zero_when_no_rows() {
        let r = make();
        assert_eq!(r.clear_all_for_extension("nobody").unwrap(), 0);
    }

    #[test]
    fn prune_old_fired_drops_fired_rows_older_than_cutoff() {
        let r = make();
        let a1 = r.schedule("ext-a", "cmd", "{}", 2_000, 1_000).unwrap();
        let a2 = r.schedule("ext-a", "cmd", "{}", 3_000, 1_000).unwrap();
        r.mark_fired("ext-a", &a1, 2_500).unwrap();
        r.mark_fired("ext-a", &a2, 5_000).unwrap();
        // Cutoff excludes a2 (fired at 5_000 >= 3_000), drops a1 (fired at 2_500 < 3_000)
        let removed = r.prune_old_fired(3_000).unwrap();
        assert_eq!(removed, 1);
    }

    #[test]
    fn prune_old_fired_does_not_touch_unfired_rows() {
        let r = make();
        let _p = r.schedule("ext-a", "cmd", "{}", 10_000, 1_000).unwrap();
        let removed = r.prune_old_fired(u64::MAX).unwrap();
        assert_eq!(removed, 0);
        assert_eq!(r.list_pending("ext-a").unwrap().len(), 1);
    }

    #[test]
    fn scheduled_timer_id_collisions_are_astronomically_unlikely() {
        let r = make();
        let mut seen = std::collections::HashSet::new();
        for i in 0..50 {
            let fire = 2_000 + i;
            let id = r.schedule("ext-a", "cmd", "{}", fire, 1_000).unwrap();
            assert!(seen.insert(id.clone()), "duplicate timer id: {id}");
        }
    }
}
