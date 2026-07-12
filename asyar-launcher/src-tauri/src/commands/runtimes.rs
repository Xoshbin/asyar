//! Thin Tauri command wrappers over `runtimes::RuntimeManager`. No business
//! logic lives here — see `runtimes/mod.rs` for the actual resolve/ensure/
//! download/list/remove implementations.

use crate::error::AppError;
use crate::runtimes::{EnsureResult, InstalledRuntimeInfo, RuntimeManager};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// IPC-facing shape for `EnsureResult` — kept separate from the internal
/// enum so the internal type stays free of serde concerns.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum EnsureRuntimeResponse {
    Installed { path: PathBuf },
    NeedsDownload { size_bytes: u64 },
}

/// IPC-facing shape for `runtimes::MissingRuntime`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDownloadWire {
    pub name: String,
    pub size_bytes: u64,
}

impl From<crate::runtimes::MissingRuntime> for RuntimeDownloadWire {
    fn from(m: crate::runtimes::MissingRuntime) -> Self {
        Self {
            name: m.name,
            size_bytes: m.size_bytes,
        }
    }
}

impl From<EnsureResult> for EnsureRuntimeResponse {
    fn from(result: EnsureResult) -> Self {
        match result {
            EnsureResult::Installed(path) => EnsureRuntimeResponse::Installed { path },
            EnsureResult::NeedsDownload { size_bytes } => {
                EnsureRuntimeResponse::NeedsDownload { size_bytes }
            }
        }
    }
}

#[tauri::command]
pub fn resolve_runtime(
    app_handle: AppHandle,
    manager: State<'_, RuntimeManager>,
    name: String,
) -> Result<Option<PathBuf>, AppError> {
    Ok(manager.resolve(&app_handle, &name))
}

#[tauri::command]
pub async fn ensure_runtime(
    app_handle: AppHandle,
    manager: State<'_, RuntimeManager>,
    name: String,
) -> Result<EnsureRuntimeResponse, AppError> {
    manager.ensure(&app_handle, &name).await.map(Into::into)
}

/// `consumer`, when present, registers this runtime as needed by that
/// consumer id (e.g. `ext:<extensionId>`) once the download succeeds, so
/// Settings' future "remove runtime" check (Phase 5) can warn if another
/// consumer still needs it before deleting.
#[tauri::command]
pub async fn download_runtime(
    app_handle: AppHandle,
    manager: State<'_, RuntimeManager>,
    name: String,
    consumer: Option<String>,
) -> Result<(), AppError> {
    manager.download(&app_handle, &name).await?;
    if let Some(consumer) = consumer {
        manager.add_consumer(&name, &consumer);
    }
    Ok(())
}

#[tauri::command]
pub fn list_runtimes(
    app_handle: AppHandle,
    manager: State<'_, RuntimeManager>,
) -> Result<Vec<InstalledRuntimeInfo>, AppError> {
    manager.list(&app_handle)
}

#[tauri::command]
pub fn remove_runtime(
    app_handle: AppHandle,
    manager: State<'_, RuntimeManager>,
    name: String,
) -> Result<(), AppError> {
    manager.remove(&app_handle, &name)
}

/// Given a set of declared runtime names (e.g. an extension manifest's
/// `runtimes` field), returns the ones not yet installed with their
/// download size — for the install consent dialog's "Downloads" section.
#[tauri::command]
pub async fn get_runtime_download_sizes(
    app_handle: AppHandle,
    manager: State<'_, RuntimeManager>,
    names: Vec<String>,
) -> Result<Vec<RuntimeDownloadWire>, AppError> {
    manager
        .missing_of(&app_handle, &names)
        .await
        .map(|v| v.into_iter().map(Into::into).collect())
}
