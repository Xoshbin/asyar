//! Tauri command layer for one-shot system actions (sleep, lock, …).
//!
//! Host-only surface for the `system` built-in feature: like `quit_app`,
//! these commands are not mapped in the `asyar:api:*` permission table, so
//! extension workers cannot reach them through the broker. Exposing them to
//! extensions would need a dedicated permission plus consent wiring first.

use crate::error::AppError;
use crate::system_actions::{SystemAction, SystemActionsState};
use tauri::State;

/// Actions the current machine supports, in display order. Drives which
/// dynamic commands the `system` built-in feature registers in search.
///
/// Both commands are `async` so the blocking platform work (D-Bus calls on
/// Linux, process spawns on macOS, `SetSuspendState` blocking until resume
/// on Windows) runs on Tauri's thread pool instead of the main thread.
#[tauri::command]
pub async fn system_actions_supported(
    state: State<'_, SystemActionsState>,
) -> Result<Vec<SystemAction>, AppError> {
    Ok(state.supported())
}

#[tauri::command]
pub async fn system_action_run(
    state: State<'_, SystemActionsState>,
    action: SystemAction,
) -> Result<(), AppError> {
    state.run(action)
}

#[cfg(test)]
mod tests {
    use crate::system_actions::fake::FakeBackend;
    use crate::system_actions::{SystemAction, SystemActionsState};

    #[test]
    fn supported_reflects_backend() {
        let state = SystemActionsState::new(Box::new(FakeBackend::new(vec![
            SystemAction::Sleep,
            SystemAction::LockScreen,
        ])));
        assert_eq!(
            state.supported(),
            vec![SystemAction::Sleep, SystemAction::LockScreen]
        );
    }

    #[test]
    fn run_rejects_action_missing_from_supported() {
        let fake = FakeBackend::new(vec![SystemAction::Sleep]);
        let state = SystemActionsState::new(Box::new(fake.clone()));
        assert!(state.run(SystemAction::ShutDown).is_err());
        assert!(fake.ran.lock().unwrap().is_empty());
    }
}
