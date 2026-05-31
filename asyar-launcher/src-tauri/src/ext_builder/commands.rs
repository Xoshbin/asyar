use std::sync::Arc;
use tauri::{AppHandle, Runtime, State};
use tokio::sync::Mutex;

use super::process::{spawn_build, BuildHandle};
use super::ExtBuilderState;

#[tauri::command]
pub async fn ext_builder_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ExtBuilderState>,
    prompt: String,
    target_dir: String,
    capability_spec_dir: String,
    anthropic_key: String,
) -> Result<(), String> {
    // Kill+clear any in-flight build so we don't orphan a child process. The
    // explicit scope releases the lock before spawn_build re-locks to store the
    // new handle.
    {
        let mut guard = state.current.lock().await;
        if let Some(h) = guard.as_mut() {
            h.kill().await;
        }
        *guard = None;
    }

    let current: Arc<Mutex<Option<BuildHandle>>> = state.current.clone();
    spawn_build(
        app,
        current,
        prompt,
        target_dir,
        capability_spec_dir,
        anthropic_key,
    )
    .await
}

#[tauri::command]
pub async fn ext_builder_answer(
    state: State<'_, ExtBuilderState>,
    line: String, // pre-serialized BuilderCommand JSON
) -> Result<(), String> {
    let mut guard = state.current.lock().await;
    match guard.as_mut() {
        Some(h) => h.write_line(&line).await,
        None => Err("no active build".into()),
    }
}

#[tauri::command]
pub async fn ext_builder_cancel(state: State<'_, ExtBuilderState>) -> Result<(), String> {
    let mut guard = state.current.lock().await;
    if let Some(h) = guard.as_mut() {
        h.kill().await;
    }
    *guard = None;
    Ok(())
}
