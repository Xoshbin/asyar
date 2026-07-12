use tauri::{AppHandle, State};

use crate::runtimes::RuntimeManager;
use serde::Serialize;

use super::process::StartOutcome;
use super::ExtBuilderState;

/// Same `{name, sizeBytes}` IPC shape as `commands::runtimes::RuntimeDownloadWire`
/// (also `From<runtimes::MissingRuntime>`, which `super::process::MissingRuntime`
/// is a re-export of) — reused rather than redefined so there's one wire type
/// for "a runtime that still needs downloading", not two identical twins.
pub type MissingRuntimeWire = crate::commands::runtimes::RuntimeDownloadWire;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ExtBuilderStartResponse {
    Started,
    NeedsRuntimes { runtimes: Vec<MissingRuntimeWire> },
}

#[tauri::command]
pub async fn ext_builder_check_runtimes(
    app: AppHandle,
    runtime_manager: State<'_, RuntimeManager>,
) -> Result<Vec<MissingRuntimeWire>, String> {
    super::process::missing_runtimes(&app, &runtime_manager)
        .await
        .map(|v| v.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ext_builder_start(
    app: AppHandle,
    state: State<'_, ExtBuilderState>,
    runtime_manager: State<'_, RuntimeManager>,
    prompt: String,
    target_dir: String,
    capability_spec_dir: String,
    anthropic_key: String,
) -> Result<ExtBuilderStartResponse, String> {
    let current = state.current.clone();
    let outcome = super::process::start_checking_runtimes_ensuring(
        app,
        &runtime_manager,
        current,
        prompt,
        target_dir,
        capability_spec_dir,
        anthropic_key,
    )
    .await?;
    Ok(match outcome {
        StartOutcome::NeedsRuntimes(missing) => ExtBuilderStartResponse::NeedsRuntimes {
            runtimes: missing.into_iter().map(Into::into).collect(),
        },
        StartOutcome::Started => ExtBuilderStartResponse::Started,
    })
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
