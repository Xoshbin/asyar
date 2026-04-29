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
use tauri::{AppHandle, Emitter, State};

/// Read-only check: has this extension's onboarding flow been completed?
/// Used by the TS view-navigation interception path (Tier 2 view-mode
/// commands bypass the Rust dispatch path, so the launcher's frontend
/// performs its own onboarding gate before calling navigateToView).
#[tauri::command]
pub fn is_extension_onboarded(
    extension_id: String,
    data_store: State<'_, DataStore>,
) -> Result<bool, AppError> {
    let conn = data_store.conn()?;
    crate::extensions::onboarding_state::is_onboarded(&conn, &extension_id)
}

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

    // Notify the launcher webview that this extension is now onboarded so the
    // TS-side view-navigation interception can re-navigate to whatever view
    // the user originally tried to open (Tier 2 view commands bypass the
    // Rust dispatch path; this event is the bridge).
    if let Err(e) = app.emit(
        "asyar:extension-onboarded",
        serde_json::json!({ "extensionId": extension_id.clone() }),
    ) {
        log::warn!("emit asyar:extension-onboarded: {e}");
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
