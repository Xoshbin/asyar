//! macOS backend.
//!
//! All actions go through Apple's System Events application via AppleScript
//! rather than private frameworks. This is unrelated to Asyar's read-only
//! `system_events` subscription service.
//!
//! - Sleep uses System Events' native `sleep` command.
//! - Lock sends the standard Control-Command-Q shortcut, which performs an
//!   immediate session lock instead of merely sleeping the display.
//! - Log out / Restart / Shut down: `osascript` telling System Events —
//!   same graceful semantics as the Apple-menu items (apps may prompt to
//!   save). First use triggers a one-time Automation consent prompt for
//!   controlling System Events; Lock also requires Accessibility consent
//!   for the synthetic shortcut.
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

fn command_for(action: SystemAction) -> Result<Command, AppError> {
    let script = match action {
        SystemAction::Sleep => "tell application \"System Events\" to sleep",
        SystemAction::LockScreen => {
            "tell application \"System Events\" to keystroke \"q\" using {control down, command down}"
        }
        SystemAction::LogOut => "tell application \"System Events\" to log out",
        SystemAction::Restart => "tell application \"System Events\" to restart",
        SystemAction::ShutDown => "tell application \"System Events\" to shut down",
        SystemAction::Hibernate => {
            return Err(AppError::Platform(
                "hibernate is not available on macOS".into(),
            ));
        }
    };
    let mut command = Command::new("/usr/bin/osascript");
    command.arg("-e").arg(script);
    Ok(command)
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
        let mut command = command_for(action)?;
        run_checked(action.label(), &mut command)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn sleep_uses_system_events_instead_of_pmset() {
        let command = command_for(SystemAction::Sleep).expect("sleep command");
        assert_eq!(command.get_program(), "/usr/bin/osascript");
        assert_eq!(
            args(&command),
            vec!["-e", "tell application \"System Events\" to sleep"]
        );
    }

    #[test]
    fn lock_uses_the_immediate_system_lock_shortcut() {
        let command = command_for(SystemAction::LockScreen).expect("lock command");
        assert_eq!(command.get_program(), "/usr/bin/osascript");
        assert_eq!(
            args(&command),
            vec![
                "-e",
                "tell application \"System Events\" to keystroke \"q\" using {control down, command down}",
            ]
        );
    }
}
