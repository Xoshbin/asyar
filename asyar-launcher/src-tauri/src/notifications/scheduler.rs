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

const STARTUP_DELAY_SECS: u64 = 60;
const PURGE_INTERVAL_SECS: u64 = 3600; // 1 hour
const TTL_SECS: u64 = 86_400; // 24 h — matches NotificationActionRegistry::DEFAULT_TTL

/// Drop action entries older than the registry TTL. One tick of the GC job.
fn run_purge(registry: &NotificationActionRegistry) {
    let removed = registry.purge_expired(Instant::now(), Duration::from_secs(TTL_SECS));
    if removed > 0 {
        info!("[notifications] purged {removed} expired action entries");
    }
}

/// Scheduler job: purge expired action entries 60s after launch, then hourly.
pub fn job(registry: Arc<NotificationActionRegistry>) -> crate::scheduler::Job {
    crate::scheduler::Job::fixed_interval(
        "notification-gc",
        Duration::from_secs(STARTUP_DELAY_SECS),
        Duration::from_secs(PURGE_INTERVAL_SECS),
        move || {
            let registry = Arc::clone(&registry);
            async move { run_purge(&registry) }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_matches_registry_default() {
        assert_eq!(
            Duration::from_secs(TTL_SECS),
            crate::notifications::DEFAULT_TTL
        );
    }

    #[test]
    fn purge_interval_is_one_hour() {
        assert_eq!(PURGE_INTERVAL_SECS, 3600);
    }

    #[test]
    fn startup_delay_is_positive() {
        const { assert!(STARTUP_DELAY_SECS > 0) };
    }
}
