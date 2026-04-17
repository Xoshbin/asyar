//! Windows system-events watcher.
//!
//! Currently a stub — the full implementation requires a hidden message-only
//! window + `RegisterPowerSettingNotification` + a `GetMessageW` pump on a
//! dedicated thread. The hub stays running; events simply never fire.
//! Extensions degrade gracefully (no callback).

use crate::error::AppError;
use crate::system_events::{SystemEventsHub, SystemEventsWatcher};
use log::warn;
use std::sync::Arc;

pub struct WindowsWatcher;

impl WindowsWatcher {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WindowsWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemEventsWatcher for WindowsWatcher {
    fn start(&self, _hub: Arc<SystemEventsHub>) -> Result<(), AppError> {
        warn!(
            "[system_events/windows] watcher not yet implemented — \
             sleep/wake/lid/battery events will not fire on this platform"
        );
        Ok(())
    }
}
