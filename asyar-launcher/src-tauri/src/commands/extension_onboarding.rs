//! Tauri commands for per-extension onboarding completion / reset.

use crate::error::AppError;
use crate::extensions::extension_runtime::{
    emitter::TauriEventEmitter,
    manager::ExtensionRuntimeManager,
    types::ContextRole,
    wire::IpcPendingMessage,
};
use crate::extensions::onboarding_intercept::StashRegistry;
use crate::storage::DataStore;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, State};

/// Called by the SDK's `context.proxies.onboarding.complete()` via the IPC
/// route `asyar:api:onboarding:complete`. Marks the extension as onboarded in
/// the SQLite store, then re-dispatches the stashed original command (if any)
/// so the user's intended action runs immediately after onboarding.
#[tauri::command]
pub fn complete_extension_onboarding(
    app: AppHandle,
    extension_id: String,
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
    registry: State<'_, crate::extensions::ExtensionRegistryState>,
    data_store: State<'_, DataStore>,
    stash: State<'_, StashRegistry>,
) -> Result<(), AppError> {
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    {
        let conn = data_store.conn()?;
        crate::extensions::onboarding_state::mark_onboarded(&conn, &extension_id, now_unix)?;
    }

    if let Some(p) = stash.take(&extension_id) {
        let emitter = TauriEventEmitter { app: app.clone() };
        let ipc_msg = IpcPendingMessage::from_stashed(p);

        let manifest_lookup = |id: &str| {
            let guard = registry.extensions.lock().expect("ExtensionRegistryState poisoned");
            guard.get(id).map(|r| r.manifest.clone())
        };
        // After marking onboarded, the is_onboarded lookup must return true so
        // the re-dispatch passes through without another interception cycle.
        let is_onboarded_lookup = |id: &str| {
            let conn = match data_store.conn() {
                Ok(c) => c,
                Err(_) => return true, // fail-open: don't re-intercept on DB error
            };
            crate::extensions::onboarding_state::is_onboarded(&conn, id).unwrap_or(true)
        };

        crate::commands::extension_runtime::dispatch_to_extension_inner(
            &mgr,
            &emitter,
            &manifest_lookup,
            &is_onboarded_lookup,
            &stash,
            extension_id,
            ipc_msg,
            ContextRole::View,
            Instant::now(),
        )?;
    }
    Ok(())
}

/// Resets the onboarding state for an extension (dev / settings use). Clears
/// the persisted onboarded flag and drops any stashed pending dispatch.
#[tauri::command]
pub fn reset_extension_onboarding(
    extension_id: String,
    data_store: State<'_, DataStore>,
    stash: State<'_, StashRegistry>,
) -> Result<(), AppError> {
    {
        let conn = data_store.conn()?;
        crate::extensions::onboarding_state::clear(&conn, &extension_id)?;
    }
    stash.drop_for(&extension_id);
    Ok(())
}
