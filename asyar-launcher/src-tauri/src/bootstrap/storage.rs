//! Storage bootstrap module.
//!
//! Handles pending factory reset checks, at-rest keystore derivation,
//! SQLite DataStore pool initialization, background FTS indexing for
//! clipboard and notes, and Notes AI tools registration.

use std::sync::Arc;
use tauri::Manager;

/// Honors any pending factory-reset request from the previous session FIRST,
/// before anything touches `app_data_dir`.
pub fn perform_pending_factory_reset_if_marked(app: &tauri::AppHandle) -> bool {
    let reset = crate::commands::perform_pending_factory_reset_if_marked(app);
    if reset {
        log::warn!("[bootstrap::storage] factory reset performed; continuing fresh boot");
    }
    reset
}

/// Initializes keystore, DataStore, and prunes expired extension cache.
pub fn init_storage(
    app: &mut tauri::App,
) -> Result<Arc<crate::storage::DataStore>, Box<dyn std::error::Error>> {
    // At-rest encryption keystore — must come up before the SQLite store
    // so any storage code path that runs during setup already has access
    // to the master key.
    let app_data_dir = app
        .handle()
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_data_dir)?;
    let store: Arc<dyn crate::crypto::keystore::KeyStore> =
        Arc::from(crate::crypto::keystore::select_keystore(&app_data_dir));
    let keystore_state = crate::crypto::keystore::KeystoreState::from_keystore(&*store)?;
    log::info!(
        "[crypto] keystore initialised — os-backed: {}",
        keystore_state.is_os_backed()
    );
    app.manage(keystore_state);
    app.manage(store);

    // Initialize the SQLite data store for clipboard, snippets, shortcuts, search
    let data_store = crate::storage::DataStore::initialize(app.handle())?;
    let data_store = Arc::new(data_store);
    app.manage(data_store.as_ref().clone());

    // Prune all expired cache entries on setup
    if let Ok(conn) = data_store.conn() {
        let _ = crate::storage::extension_cache::prune_all_expired(&conn);
    }

    Ok(data_store)
}

/// Initializes clipboard and notes in-memory FTS indexes and kicks off background rebuild tasks.
/// Also registers Notes AI tools once the master key and NotesFts are available.
pub fn init_fts(
    app: &mut tauri::App,
    data_store: &Arc<crate::storage::DataStore>,
) -> Result<(), Box<dyn std::error::Error>> {
    let master_key: [u8; 32] = *app
        .state::<crate::crypto::keystore::KeystoreState>()
        .master_key();

    // Clipboard FTS: build the in-memory index and spawn a background task
    // that decrypts every row, feeds the FTS, and backfills content_hash for
    // legacy rows. Emits `clipboard:fts-ready` when done.
    {
        let fts = Arc::new(
            crate::storage::clipboard_fts::ClipboardFts::new_in_memory()
                .expect("Clipboard FTS in-memory DB must initialise"),
        );
        app.manage(fts.clone());

        let store = data_store.as_ref().clone();
        let app_handle = app.handle().clone();
        let fts_for_task = fts;
        tauri::async_runtime::spawn(async move {
            let result = tokio::task::spawn_blocking(move || {
                let conn = match store.conn() {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                crate::storage::clipboard_fts::rebuild_from_disk(&conn, &fts_for_task, &master_key)
                    .is_ok()
            })
            .await
            .unwrap_or(false);
            if result {
                crate::storage::clipboard_fts::mark_ready();
                crate::event_bridge::bridge_emit(&app_handle, "clipboard:fts-ready", ());
            }
        });
    }

    // Notes FTS: in-memory-index-plus-background-rebuild pattern.
    // Emits `notes:fts-ready` when done.
    {
        let fts = Arc::new(
            crate::storage::notes_fts::NotesFts::new_in_memory()
                .expect("Notes FTS in-memory DB must initialise"),
        );
        app.manage(fts.clone());

        let store = data_store.as_ref().clone();
        let app_handle = app.handle().clone();
        let fts_for_task = fts.clone();
        tauri::async_runtime::spawn(async move {
            let result = tokio::task::spawn_blocking(move || {
                let conn = match store.conn() {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                crate::storage::notes_fts::rebuild_from_disk(&conn, &fts_for_task, &master_key)
                    .is_ok()
            })
            .await
            .unwrap_or(false);
            if result {
                crate::storage::notes_fts::mark_ready();
                crate::event_bridge::bridge_emit(&app_handle, "notes:fts-ready", ());
            }
        });

        // Notes AI tools registered here because they need this block's DataStore / master key / NotesFts
        register_notes_tools(app.handle(), fts)?;
    }

    Ok(())
}

fn register_notes_tools(
    app_handle: &tauri::AppHandle,
    fts: Arc<crate::storage::notes_fts::NotesFts>,
) -> Result<(), Box<dyn std::error::Error>> {
    use crate::agents::builtin_tools::notes::{
        NotesAppendTool, NotesCreateTool, NotesGetTool, NotesListTool, NotesSearchTool,
    };

    let registry = app_handle
        .try_state::<crate::agents::tools::ToolRegistryState>()
        .ok_or("ToolRegistry not managed")?;
    let data_store = app_handle
        .try_state::<crate::storage::DataStore>()
        .ok_or("DataStore not managed")?
        .inner()
        .clone();
    let master_key: [u8; 32] = *app_handle
        .try_state::<crate::crypto::keystore::KeystoreState>()
        .ok_or("KeystoreState not managed")?
        .master_key();

    registry
        .register_builtin(Arc::new(NotesSearchTool::new(
            data_store.clone(),
            master_key,
            fts.clone(),
        )))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(NotesListTool::new(data_store.clone(), master_key)))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(NotesGetTool::new(data_store.clone(), master_key)))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(NotesCreateTool::new(
            data_store.clone(),
            master_key,
            fts.clone(),
        )))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(NotesAppendTool::new(data_store, master_key, fts)))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    Ok(())
}
