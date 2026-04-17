//! Linux system-events watcher (zbus / dbus).
//!
//! Currently a stub — sleep/wake/battery/lid detection on Linux requires
//! running each source on its own blocking thread and is non-trivial to
//! wire correctly against the wide variety of desktop environments. The
//! hub stays running; events simply never fire. Extensions degrade
//! gracefully (no callback).

use crate::error::AppError;
use crate::system_events::{SystemEventsHub, SystemEventsWatcher};
use log::warn;
use std::sync::Arc;

pub struct LinuxWatcher;

impl LinuxWatcher {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LinuxWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemEventsWatcher for LinuxWatcher {
    fn start(&self, _hub: Arc<SystemEventsHub>) -> Result<(), AppError> {
        warn!(
            "[system_events/linux] watcher not yet implemented — \
             sleep/wake/lid/battery events will not fire on this platform"
        );
        Ok(())
    }
}
