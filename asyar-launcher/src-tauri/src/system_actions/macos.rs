//! macOS backend.
//!
//! All actions go through small system binaries rather than private
//! frameworks:
//!
//! - Sleep: `pmset sleepnow` — no TCC consent needed.
//! - Lock: `pmset displaysleepnow` — sleeps the display, which locks the
//!   session under the default "require password after display sleep"
//!   security setting. No TCC consent needed. (The historical
//!   `CGSession -suspend` binary was removed in macOS 11; a hard lock
//!   without it needs either the private `SACLockScreenImmediate` API or
//!   an Accessibility-consented ⌃⌘Q keystroke — deliberately avoided.)
//! - Log out / Restart / Shut down: `osascript` telling System Events —
//!   same graceful semantics as the Apple-menu items (apps may prompt to
//!   save). First use triggers a one-time Automation consent prompt for
//!   controlling System Events.
//!
//! Hibernate is not offered: macOS manages safe-sleep itself and exposes
//! no user-facing hibernate action.

use crate::error::AppError;
use crate::system_actions::{SystemAction, SystemActionsBackend};
use std::process::Command;

pub struct MacSystemActionsBackend;

impl MacSystemActionsBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MacSystemActionsBackend {
    fn default() -> Self {
        Self::new()
    }
}

fn run_checked(label: &str, cmd: &mut Command) -> Result<(), AppError> {
    let output = cmd
        .output()
        .map_err(|e| AppError::Platform(format!("{label}: failed to spawn: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Platform(format!(
            "{label}: exited with {}: {}",
            output.status,
            stderr.trim()
        )));
    }
    Ok(())
}

fn system_events(verb: &str) -> Result<(), AppError> {
    run_checked(
        verb,
        Command::new("osascript")
            .arg("-e")
            .arg(format!("tell application \"System Events\" to {verb}")),
    )
}

impl SystemActionsBackend for MacSystemActionsBackend {
    fn supported(&self) -> Vec<SystemAction> {
        vec![
            SystemAction::Sleep,
            SystemAction::LockScreen,
            SystemAction::LogOut,
            SystemAction::Restart,
            SystemAction::ShutDown,
        ]
    }

    fn run(&self, action: SystemAction) -> Result<(), AppError> {
        match action {
            SystemAction::Sleep => {
                run_checked("pmset sleepnow", Command::new("pmset").arg("sleepnow"))
            }
            SystemAction::LockScreen => run_checked(
                "pmset displaysleepnow",
                Command::new("pmset").arg("displaysleepnow"),
            ),
            SystemAction::LogOut => system_events("log out"),
            SystemAction::Restart => system_events("restart"),
            SystemAction::ShutDown => system_events("shut down"),
            SystemAction::Hibernate => Err(AppError::Platform(
                "hibernate is not available on macOS".into(),
            )),
        }
    }
}
