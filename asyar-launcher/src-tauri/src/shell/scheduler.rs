//! Periodic GC for finished shell entries.
//!
//! Mirrors [`crate::app_updater::scheduler`] and
//! [`crate::notifications::scheduler`] — a tokio task spawned once from
//! `setup_app` that sleeps between iterations rather than holding a
//! `tokio::time::interval`. Keeps the shape identical to the other
//! periodic background jobs.

use crate::shell::{now_millis, ShellProcessRegistry};
use log::info;
use std::time::Duration;
use tauri::async_runtime;

const STARTUP_DELAY_SECS: u64 = 60;
const PRUNE_INTERVAL_SECS: u64 = 60;
/// Finished entries linger this long so reattach-right-after-exit can still
/// resolve the stored exit_code before the GC collects them.
pub const PRUNE_AGE_MILLIS: u64 = 10 * 60 * 1000;

pub fn start(registry: ShellProcessRegistry) {
    async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;

        loop {
            match registry.prune_finished(PRUNE_AGE_MILLIS, now_millis()) {
                Ok(n) if n > 0 => info!("[shell] pruned {n} finished entries"),
                Ok(_) => {}
                Err(e) => log::warn!("[shell] prune error: {e}"),
            }
            tokio::time::sleep(Duration::from_secs(PRUNE_INTERVAL_SECS)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // Const blocks so clippy's `assertions_on_constants` (which flags
    // runtime assert! on purely compile-time values) stays quiet while
    // still tripping the compile if a human knocks these thresholds out
    // of their intended shape.
    const _: () = {
        assert!(PRUNE_AGE_MILLIS == 10 * 60 * 1000);
        assert!(STARTUP_DELAY_SECS > 0);
        assert!(PRUNE_INTERVAL_SECS >= 30);
        assert!(PRUNE_INTERVAL_SECS <= 300);
    };

    #[test]
    fn constants_are_reachable_from_test_binary() {
        // Touch each constant so the const_assert block above compiles in
        // the same crate graph as the test harness. Without a runtime
        // touch the const block lives only in release builds and the
        // thresholds drift without warning.
        let _ = PRUNE_AGE_MILLIS;
        let _ = STARTUP_DELAY_SECS;
        let _ = PRUNE_INTERVAL_SECS;
    }
}
