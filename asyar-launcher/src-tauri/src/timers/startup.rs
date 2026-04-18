//! One-shot startup scan for timers whose `fire_at` elapsed while Asyar
//! was quit.
//!
//! If the launcher was closed for three days and 50 timers accrued, firing
//! them all in one tick would slam the extension-iframe bridge. Instead
//! we stagger the emits — `INTER_FIRE_DELAY_MS` between each, capped at
//! `max_burst` concurrent in-flight delays — so the bridge has time to
//! mount-on-demand each extension iframe and dispatch the command.

use crate::timers::TimerDescriptor;
use std::time::Duration;

pub const INTER_FIRE_DELAY_MS: u64 = 100;

/// Assign each overdue timer a delay (`Duration`) before its emit should
/// happen. Pure function, unit-testable without SQLite or Tauri.
///
/// The first `max_burst` timers fire immediately (`Duration::ZERO`); any
/// beyond that are staggered by `INTER_FIRE_DELAY_MS` per slot so the
/// bridge has time to mount extension iframes on demand.
pub fn stagger_startup_fires(
    mut due: Vec<TimerDescriptor>,
    max_burst: usize,
) -> Vec<(TimerDescriptor, Duration)> {
    // Stable ordering: earliest fire_at first so the longest-overdue
    // timers reach the bridge ahead of newer ones. `due_now` already
    // returns this order, but callers may pre-sort differently.
    due.sort_by_key(|d| d.fire_at);

    let burst = max_burst.max(1);
    let mut out = Vec::with_capacity(due.len());
    for (idx, d) in due.into_iter().enumerate() {
        let delay = if idx < burst {
            Duration::ZERO
        } else {
            let extra = (idx - burst + 1) as u64;
            Duration::from_millis(extra * INTER_FIRE_DELAY_MS)
        };
        out.push((d, delay));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(id: &str, fire_at: u64) -> TimerDescriptor {
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
    fn zero_timers_yields_empty_vec() {
        assert!(stagger_startup_fires(vec![], 10).is_empty());
    }

    #[test]
    fn single_timer_fires_with_no_delay() {
        let out = stagger_startup_fires(vec![d("a", 1_000)], 10);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].1, Duration::ZERO);
    }

    #[test]
    fn up_to_burst_size_fires_with_no_delay() {
        let timers: Vec<_> = (0..5)
            .map(|i| d(&format!("t{i}"), 1_000 + i))
            .collect();
        let out = stagger_startup_fires(timers, 5);
        assert_eq!(out.len(), 5);
        for (_, delay) in &out {
            assert_eq!(*delay, Duration::ZERO);
        }
    }

    #[test]
    fn beyond_burst_are_staggered_by_inter_fire_delay() {
        let timers: Vec<_> = (0..5)
            .map(|i| d(&format!("t{i}"), 1_000 + i as u64))
            .collect();
        let out = stagger_startup_fires(timers, 2);
        assert_eq!(out.len(), 5);
        // First two in the burst
        assert_eq!(out[0].1, Duration::ZERO);
        assert_eq!(out[1].1, Duration::ZERO);
        // Then 100ms, 200ms, 300ms
        assert_eq!(out[2].1, Duration::from_millis(INTER_FIRE_DELAY_MS));
        assert_eq!(out[3].1, Duration::from_millis(2 * INTER_FIRE_DELAY_MS));
        assert_eq!(out[4].1, Duration::from_millis(3 * INTER_FIRE_DELAY_MS));
    }

    #[test]
    fn one_hundred_timers_stay_ordered_and_bounded_in_delay() {
        let timers: Vec<_> = (0..100)
            .map(|i| d(&format!("t{i}"), 1_000 + i as u64))
            .collect();
        let out = stagger_startup_fires(timers, 10);
        assert_eq!(out.len(), 100);

        // First 10 are immediate
        for (i, (_, delay)) in out.iter().take(10).enumerate() {
            assert_eq!(*delay, Duration::ZERO, "idx {i} should be immediate");
        }
        // 11th is 100ms; last is (100 - 10) * 100 = 9_000ms
        assert_eq!(out[10].1, Duration::from_millis(INTER_FIRE_DELAY_MS));
        assert_eq!(
            out[99].1,
            Duration::from_millis(90 * INTER_FIRE_DELAY_MS)
        );
    }

    #[test]
    fn sorts_by_fire_at_ascending_before_staggering() {
        let out = stagger_startup_fires(
            vec![d("late", 5_000), d("early", 1_000), d("mid", 3_000)],
            3,
        );
        let ids: Vec<&str> = out.iter().map(|(d, _)| d.timer_id.as_str()).collect();
        assert_eq!(ids, vec!["early", "mid", "late"]);
    }

    #[test]
    fn max_burst_zero_is_treated_as_one() {
        // Don't panic/divide on a 0 cap — clamp to 1 so progress still happens.
        let out = stagger_startup_fires(vec![d("a", 1), d("b", 2)], 0);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].1, Duration::ZERO);
        assert_eq!(out[1].1, Duration::from_millis(INTER_FIRE_DELAY_MS));
    }
}
