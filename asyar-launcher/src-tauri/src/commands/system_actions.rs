//! Tauri command layer for one-shot system actions (sleep, lock, …).
//!
//! Host-only surface for the `system` built-in feature: like `quit_app`,
//! these commands are not mapped in the `asyar:api:*` permission table, so
//! extension workers cannot reach them through the broker. Exposing them to
//! extensions would need a dedicated permission plus consent wiring first.

use crate::error::AppError;
use crate::system_actions::{SystemAction, SystemActionsState};
use std::sync::Arc;
use tauri::State;

async fn spawn_blocking_result<T, F>(work: F) -> Result<T, AppError>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| AppError::Other(format!("system action task failed: {e}")))
}

/// Actions the current machine supports, in display order. Drives which
/// dynamic commands the `system` built-in feature registers in search.
///
/// Both commands are `async` so the blocking platform work (D-Bus calls on
/// Linux, process spawns on macOS, `SetSuspendState` blocking until resume
/// on Windows) runs on Tauri's thread pool instead of the main thread.
#[tauri::command]
pub async fn system_actions_supported(
    state: State<'_, Arc<SystemActionsState>>,
) -> Result<Vec<SystemAction>, AppError> {
    let state = Arc::clone(state.inner());
    spawn_blocking_result(move || state.supported()).await
}

#[tauri::command]
pub async fn system_action_run(
    state: State<'_, Arc<SystemActionsState>>,
    action: SystemAction,
) -> Result<(), AppError> {
    let state = Arc::clone(state.inner());
    spawn_blocking_result(move || state.run(action)).await?
}

#[cfg(test)]
mod tests {
    use super::spawn_blocking_result;
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

    #[tokio::test]
    async fn blocking_helper_runs_work_off_the_async_thread() {
        let caller = std::thread::current().id();
        let worker = spawn_blocking_result(|| std::thread::current().id())
            .await
            .expect("blocking task");
        assert_ne!(caller, worker);
    }
}
