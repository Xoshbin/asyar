//! One-shot system actions (sleep, lock screen, restart, …).
//!
//! Platform-neutral state + backend trait, mirroring the `power` module's
//! shape. Per-platform backends live in sibling modules (`macos`, `linux`,
//! `windows`) and implement [`SystemActionsBackend`].
//!
//! Unlike `power` inhibitors these are fire-and-forget: no tokens, no
//! handles. The interesting per-platform question is *which* actions exist
//! at all (e.g. hibernate is disabled on many Windows machines and absent
//! on macOS), so the backend reports a `supported()` set that the frontend
//! uses to register only the commands this machine can actually perform.

use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SystemAction {
    Sleep,
    Hibernate,
    LockScreen,
    LogOut,
    Restart,
    ShutDown,
}

impl SystemAction {
    pub fn label(&self) -> &'static str {
        match self {
            SystemAction::Sleep => "sleep",
            SystemAction::Hibernate => "hibernate",
            SystemAction::LockScreen => "lock screen",
            SystemAction::LogOut => "log out",
            SystemAction::Restart => "restart",
            SystemAction::ShutDown => "shut down",
        }
    }
}

/// Implemented by each per-platform backend.
pub trait SystemActionsBackend: Send + Sync {
    /// Actions this machine can perform right now. Determined once per call
    /// so OS-level changes (e.g. enabling hibernation) are picked up on the
    /// next launcher start without caching invalidation.
    fn supported(&self) -> Vec<SystemAction>;

    /// Perform the action. Only called with actions from `supported()` —
    /// [`SystemActionsState::run`] enforces that.
    fn run(&self, action: SystemAction) -> Result<(), AppError>;
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn session_actions_for_capabilities(
    has_logind_session: bool,
    has_screensaver: bool,
) -> Vec<SystemAction> {
    let mut actions = Vec::new();
    if has_logind_session || has_screensaver {
        actions.push(SystemAction::LockScreen);
    }
    if has_logind_session {
        actions.push(SystemAction::LogOut);
    }
    actions
}

/// Tauri managed state wrapping the platform backend.
pub struct SystemActionsState {
    backend: Box<dyn SystemActionsBackend>,
}

impl SystemActionsState {
    pub fn new(backend: Box<dyn SystemActionsBackend>) -> Self {
        Self { backend }
    }

    pub fn supported(&self) -> Vec<SystemAction> {
        self.backend.supported()
    }

    /// Fail-closed: re-checks `supported()` so an action that was never
    /// registered (or stopped being available) errors cleanly instead of
    /// reaching the backend.
    pub fn run(&self, action: SystemAction) -> Result<(), AppError> {
        if !self.backend.supported().contains(&action) {
            return Err(AppError::Platform(format!(
                "system action \"{}\" is not supported on this machine",
                action.label()
            )));
        }
        self.backend.run(action)
    }
}

/// In-memory fake backend for tests and unsupported platforms.
pub mod fake {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    pub struct FakeBackend {
        pub supported: Vec<SystemAction>,
        pub ran: Arc<Mutex<Vec<SystemAction>>>,
        pub fail_next: Arc<Mutex<bool>>,
    }

    impl FakeBackend {
        pub fn new(supported: Vec<SystemAction>) -> Self {
            Self {
                supported,
                ran: Arc::new(Mutex::new(Vec::new())),
                fail_next: Arc::new(Mutex::new(false)),
            }
        }

        pub fn fail_next_run(&self) {
            *self.fail_next.lock().unwrap() = true;
        }
    }

    impl SystemActionsBackend for FakeBackend {
        fn supported(&self) -> Vec<SystemAction> {
            self.supported.clone()
        }

        fn run(&self, action: SystemAction) -> Result<(), AppError> {
            let mut fail = self.fail_next.lock().map_err(|_| AppError::Lock)?;
            if *fail {
                *fail = false;
                return Err(AppError::Platform("fake failure".into()));
            }
            self.ran.lock().map_err(|_| AppError::Lock)?.push(action);
            Ok(())
        }
    }
}

/// Returns the default per-platform backend.
#[cfg(target_os = "macos")]
pub fn default_backend() -> Box<dyn SystemActionsBackend> {
    Box::new(macos::MacSystemActionsBackend::new())
}
#[cfg(target_os = "linux")]
pub fn default_backend() -> Box<dyn SystemActionsBackend> {
    Box::new(linux::LinuxSystemActionsBackend::new())
}
#[cfg(target_os = "windows")]
pub fn default_backend() -> Box<dyn SystemActionsBackend> {
    Box::new(windows::WindowsSystemActionsBackend::new())
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn default_backend() -> Box<dyn SystemActionsBackend> {
    Box::new(fake::FakeBackend::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::fake::FakeBackend;
    use super::*;

    #[test]
    fn run_supported_action_reaches_backend() {
        let fake = FakeBackend::new(vec![SystemAction::Sleep, SystemAction::LockScreen]);
        let state = SystemActionsState::new(Box::new(fake.clone()));
        state.run(SystemAction::Sleep).expect("run ok");
        assert_eq!(*fake.ran.lock().unwrap(), vec![SystemAction::Sleep]);
    }

    #[test]
    fn run_unsupported_action_is_rejected_before_backend() {
        let fake = FakeBackend::new(vec![SystemAction::Sleep]);
        let state = SystemActionsState::new(Box::new(fake.clone()));
        let err = state.run(SystemAction::Hibernate).unwrap_err();
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
        assert!(fake.ran.lock().unwrap().is_empty());
    }

    #[test]
    fn backend_failure_is_propagated() {
        let fake = FakeBackend::new(vec![SystemAction::Restart]);
        fake.fail_next_run();
        let state = SystemActionsState::new(Box::new(fake.clone()));
        let err = state.run(SystemAction::Restart).unwrap_err();
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }

    #[test]
    fn supported_passes_through() {
        let fake = FakeBackend::new(vec![SystemAction::Sleep, SystemAction::ShutDown]);
        let state = SystemActionsState::new(Box::new(fake));
        assert_eq!(
            state.supported(),
            vec![SystemAction::Sleep, SystemAction::ShutDown]
        );
    }

    #[test]
    fn action_serializes_camel_case() {
        // The frontend keys dynamic command ids off these exact strings.
        assert_eq!(
            serde_json::to_string(&SystemAction::LockScreen).unwrap(),
            "\"lockScreen\""
        );
        assert_eq!(
            serde_json::to_string(&SystemAction::ShutDown).unwrap(),
            "\"shutDown\""
        );
        let round: SystemAction = serde_json::from_str("\"logOut\"").unwrap();
        assert_eq!(round, SystemAction::LogOut);
    }

    #[test]
    fn linux_session_actions_require_real_capabilities() {
        assert_eq!(session_actions_for_capabilities(false, false), vec![]);
        assert_eq!(
            session_actions_for_capabilities(false, true),
            vec![SystemAction::LockScreen]
        );
        assert_eq!(
            session_actions_for_capabilities(true, false),
            vec![SystemAction::LockScreen, SystemAction::LogOut]
        );
    }
}
