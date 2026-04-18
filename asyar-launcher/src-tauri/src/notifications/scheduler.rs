//! Hourly GC timer for the notification action registry.
//!
//! Mirrors [`crate::app_updater::scheduler`] and
//! [`crate::extensions::update_scheduler`] — a tokio task spawned once
//! during `setup_app`, sleeping between iterations rather than holding a
//! long-lived `tokio::time::interval` handle. Keeps the shape identical
//! to the other per-hour background jobs in the launcher.

use crate::notifications::NotificationActionRegistry;
use log::info;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::async_runtime;

const STARTUP_DELAY_SECS: u64 = 60;
const PURGE_INTERVAL_SECS: u64 = 3600; // 1 hour
const TTL_SECS: u64 = 86_400; // 24 h — matches NotificationActionRegistry::DEFAULT_TTL

/// Spawn a background tokio task that drops action entries older than the
/// registry TTL every hour. Fires once after `STARTUP_DELAY_SECS`, then
/// every `PURGE_INTERVAL_SECS`.
pub fn start(registry: Arc<NotificationActionRegistry>) {
    async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;

        loop {
            let removed = registry.purge_expired(Instant::now(), Duration::from_secs(TTL_SECS));
            if removed > 0 {
                info!("[notifications] purged {removed} expired action entries");
            }
            tokio::time::sleep(Duration::from_secs(PURGE_INTERVAL_SECS)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_matches_registry_default() {
        assert_eq!(Duration::from_secs(TTL_SECS), crate::notifications::DEFAULT_TTL);
    }

    #[test]
    fn purge_interval_is_one_hour() {
        assert_eq!(PURGE_INTERVAL_SECS, 3600);
    }

    #[test]
    fn startup_delay_is_positive() {
        assert!(STARTUP_DELAY_SECS > 0);
    }
}
