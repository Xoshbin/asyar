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

#[tauri::command]
pub async fn download_runtime(
    app_handle: AppHandle,
    manager: State<'_, RuntimeManager>,
    name: String,
) -> Result<(), AppError> {
    manager.download(&app_handle, &name).await
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
