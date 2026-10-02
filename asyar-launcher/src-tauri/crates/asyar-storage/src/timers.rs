//! Schema init for the `extension_timers` table backing
//! [`crate::timers::TimerRegistry`].
//!
//! Persistence is the whole point of the timers subsystem — a one-shot fire
//! whose `fire_at` passes while Asyar is quit must still run at the next boot.
//! Rows survive restart; the scheduler scans `fired = 0 AND fire_at <= now`
//! and staggers emits so dormant-extension timers catch up without slamming
//! the bridge.

use crate::error::AppError;
use rusqlite::Connection;

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS extension_timers (
            timer_id      TEXT NOT NULL,
            extension_id  TEXT NOT NULL,
            command_id    TEXT NOT NULL,
            args_json     TEXT NOT NULL DEFAULT '{}',
            fire_at       INTEGER NOT NULL,
            created_at    INTEGER NOT NULL,
            fired         INTEGER NOT NULL DEFAULT 0,
            fired_at      INTEGER,
            PRIMARY KEY (extension_id, timer_id)
        );
        CREATE INDEX IF NOT EXISTS idx_extension_timers_fire_at
            ON extension_timers (fired, fire_at);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init extension_timers table: {e}")))?;
    Ok(())
}
