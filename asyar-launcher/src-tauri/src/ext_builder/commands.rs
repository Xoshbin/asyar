use tauri::{AppHandle, State};

use crate::runtimes::RuntimeManager;
use serde::Serialize;

use super::process::StartOutcome;
use super::ExtBuilderState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingRuntimeWire {
    pub name: String,
    pub size_bytes: u64,
}

impl From<super::process::MissingRuntime> for MissingRuntimeWire {
    fn from(m: super::process::MissingRuntime) -> Self {
        Self {
            name: m.name,
            size_bytes: m.size_bytes,
        }
    }
}

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
