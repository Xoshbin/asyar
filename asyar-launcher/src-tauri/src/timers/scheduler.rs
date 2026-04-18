//! Background tick loop for the one-shot timer registry.
//!
//! Mirrors the shape of [`crate::shell::scheduler`] and
//! [`crate::notifications::scheduler`] — a `tokio::async_runtime::spawn`
//! task that sleeps between iterations rather than holding a
//! `tokio::time::interval` handle. 1-second polling matches the promised
//! resolution (Pomodoros, reminders — low-frequency user-scale timers).
//!
//! Persist-first-emit-second: a timer is marked fired in SQLite *before*
//! the Tauri event is emitted, so a crash mid-emit can't cause a duplicate
//! fire on the next tick.

use crate::shell::now_millis;
use crate::timers::{TimerDescriptor, TimerFirePayload, TimerRegistry, TIMER_FIRE_EVENT};
use log::{info, warn};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const POLL_INTERVAL_SECS: u64 = 1;
const PRUNE_INTERVAL_SECS: u64 = 3600;
const PRUNE_AGE_MILLIS: u64 = 24 * 60 * 60 * 1000;

/// Compute the subset of pending timers whose `fire_at <= now_ms`.
///
/// Pure function extracted for unit testing without SQLite or Tauri.
/// Callers pass the list of currently-pending descriptors (usually the
/// output of [`TimerRegistry::due_now`]).
pub fn select_fireable(
    pending: &[TimerDescriptor],
    now_ms: u64,
) -> Vec<&TimerDescriptor> {
    pending.iter().filter(|d| d.fire_at <= now_ms).collect()
}

pub fn start(app: AppHandle, registry: TimerRegistry) {
    tauri::async_runtime::spawn(async move {
        let mut last_prune_ms: u64 = 0;

        loop {
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;

            let now = now_millis();
            match registry.due_now(now) {
                Ok(due) => {
                    for desc in due {
                        fire_one(&app, &registry, desc, now);
                    }
                }
                Err(e) => warn!("[timers] due_now query failed: {e}"),
            }

            if now.saturating_sub(last_prune_ms) >= PRUNE_INTERVAL_SECS * 1000 {
                let cutoff = now.saturating_sub(PRUNE_AGE_MILLIS);
                match registry.prune_old_fired(cutoff) {
                    Ok(n) if n > 0 => info!("[timers] pruned {n} stale fired timers"),
                    Ok(_) => {}
                    Err(e) => warn!("[timers] prune failed: {e}"),
                }
                last_prune_ms = now;
            }
        }
    });
}

/// Mark-before-emit guarantee: even if `emit` panics or the app crashes
/// between these two steps the row is already `fired = 1`, so the next
/// tick won't surface it again.
pub(crate) fn fire_one(
    app: &AppHandle,
    registry: &TimerRegistry,
    desc: TimerDescriptor,
    fired_at: u64,
) {
    if let Err(e) = registry.mark_fired(&desc.extension_id, &desc.timer_id, fired_at) {
        warn!(
            "[timers] mark_fired failed for {}::{} — skipping emit: {}",
            desc.extension_id, desc.timer_id, e
        );
        return;
    }
    let payload = TimerFirePayload {
        extension_id: desc.extension_id,
        timer_id: desc.timer_id,
        command_id: desc.command_id,
        args_json: desc.args_json,
        fire_at: desc.fire_at,
        fired_at,
    };
    if let Err(e) = app.emit(TIMER_FIRE_EVENT, &payload) {
        warn!(
            "[timers] failed to emit {}: {}",
            TIMER_FIRE_EVENT, e
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn desc(id: &str, fire_at: u64) -> TimerDescriptor {
        TimerDescriptor {
            timer_id: id.to_string(),
            extension_id: "ext".to_string(),
            command_id: "cmd".to_string(),
            args_json: "{}".to_string(),
            fire_at,
            created_at: 0,
        }
    }

    #[test]
    fn select_fireable_empty_input_returns_empty() {
        let v: Vec<TimerDescriptor> = vec![];
        assert_eq!(select_fireable(&v, 10_000).len(), 0);
    }

    #[test]
    fn select_fireable_all_future_returns_empty() {
        let v = vec![desc("a", 10_000), desc("b", 15_000)];
        assert_eq!(select_fireable(&v, 5_000).len(), 0);
    }

    #[test]
    fn select_fireable_all_past_returns_all() {
        let v = vec![desc("a", 1_000), desc("b", 2_000)];
        let got = select_fireable(&v, 3_000);
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn select_fireable_includes_rows_equal_to_now() {
        let v = vec![desc("on-time", 5_000)];
        let got = select_fireable(&v, 5_000);
        assert_eq!(got.len(), 1);
    }

    #[test]
    fn select_fireable_splits_at_boundary() {
        let v = vec![desc("a", 1_000), desc("b", 5_000), desc("c", 9_000)];
        let got = select_fireable(&v, 5_000);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].timer_id, "a");
        assert_eq!(got[1].timer_id, "b");
    }

    #[test]
    fn poll_interval_is_one_second() {
        assert_eq!(POLL_INTERVAL_SECS, 1);
    }

    #[test]
    fn prune_interval_and_age_are_one_hour_and_twenty_four_hours() {
        assert_eq!(PRUNE_INTERVAL_SECS, 3600);
        assert_eq!(PRUNE_AGE_MILLIS, 24 * 60 * 60 * 1000);
    }
}
