//! Network sender for usage pings. Separate from recording so the egress
//! path is gated entirely behind UsageShareMode (default Off).

use std::collections::HashMap;

use super::{UsageError, UsageShareMode, UsageState};

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsagePingPayload {
    pub anon_id: String,
    pub period: String,
    pub app_version: String,
    pub platform: String,
    pub active: bool,
    pub launches: HashMap<String, u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SendAction {
    DoNothing, // Off
    Prompt,    // Ask  → emit event, let the user confirm
    SendNow,   // Auto → fire-and-forget
}

pub fn decide_send_action(mode: UsageShareMode) -> SendAction {
    match mode {
        UsageShareMode::Off => SendAction::DoNothing,
        UsageShareMode::Ask => SendAction::Prompt,
        UsageShareMode::Auto => SendAction::SendNow,
    }
}

pub fn build_payload(
    state: &UsageState,
    day: &str,
    app_version: &str,
    platform: &str,
) -> Result<UsagePingPayload, UsageError> {
    let rollup = state.rollup_for_day(day)?;
    let anon_id = state.anon_id()?;
    Ok(UsagePingPayload {
        anon_id,
        period: rollup.day,
        app_version: app_version.to_string(),
        platform: platform.to_string(),
        active: rollup.active,
        launches: rollup.launches,
    })
}

pub fn mark_day_sent(state: &UsageState, day: &str) -> Result<(), UsageError> {
    let conn = state.db.lock().map_err(|_| UsageError::Lock)?;
    conn.execute(
        "UPDATE usage_events SET sent = 1 WHERE day = ?1",
        rusqlite::params![day],
    )
    .map_err(|e| UsageError::Db(e.to_string()))?;
    Ok(())
}

/// The most recent day that has unsent rows AND is strictly before `today`.
pub fn earliest_unsent_day_before(
    state: &UsageState,
    today: &str,
) -> Result<Option<String>, UsageError> {
    let conn = state.db.lock().map_err(|_| UsageError::Lock)?;
    let day: Option<String> = conn
        .query_row(
            "SELECT day FROM usage_events WHERE sent = 0 AND day < ?1
             ORDER BY day DESC LIMIT 1",
            rusqlite::params![today],
            |r| r.get(0),
        )
        .ok();
    Ok(day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::{init_schema, UsageShareMode, UsageState};

    fn mem_state() -> UsageState {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        UsageState {
            db: std::sync::Mutex::new(conn),
        }
    }

    #[test]
    fn off_mode_yields_no_action() {
        let action = decide_send_action(UsageShareMode::Off);
        assert!(matches!(action, SendAction::DoNothing));
    }

    #[test]
    fn ask_and_auto_map_to_their_actions() {
        assert!(matches!(
            decide_send_action(UsageShareMode::Ask),
            SendAction::Prompt
        ));
        assert!(matches!(
            decide_send_action(UsageShareMode::Auto),
            SendAction::SendNow
        ));
    }

    #[test]
    fn build_payload_uses_rollup_and_meta() {
        let state = mem_state();
        state.record_launch("a", "2026-06-15").unwrap();
        state.record_active_day("2026-06-15").unwrap();
        let payload = build_payload(&state, "2026-06-15", "0.1.0", "linux-x86_64").unwrap();
        assert_eq!(payload.period, "2026-06-15");
        assert!(payload.active);
        assert_eq!(payload.launches.get("a"), Some(&1));
        assert_eq!(payload.anon_id.len(), 36);
    }

    #[test]
    fn mark_day_sent_flips_flag() {
        let state = mem_state();
        state.record_launch("a", "2026-06-15").unwrap();
        mark_day_sent(&state, "2026-06-15").unwrap();
        let conn = state.db.lock().unwrap();
        let unsent: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE day='2026-06-15' AND sent=0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(unsent, 0);
    }

    #[test]
    fn earliest_unsent_day_before_today_skips_today() {
        let state = mem_state();
        state.record_launch("a", "2026-06-14").unwrap();
        state.record_launch("b", "2026-06-15").unwrap(); // "today"
        let day = earliest_unsent_day_before(&state, "2026-06-15").unwrap();
        assert_eq!(day, Some("2026-06-14".to_string()));
    }
}
