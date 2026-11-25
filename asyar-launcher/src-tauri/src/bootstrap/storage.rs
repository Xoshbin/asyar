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
    let keystore_state =
        crate::crypto::keystore::KeystoreState::from_keystore_or_locked(store.clone());
    log::info!(
        "[crypto] keystore initialised — os-backed: {}, unlocked: {}",
        keystore_state.is_os_backed(),
        keystore_state.is_unlocked()
    );
    app.manage(keystore_state.clone());
    app.manage(store);

    // Initialize the SQLite data store for clipboard, snippets, shortcuts, search
    let data_store = crate::storage::DataStore::initialize(&app_data_dir)?;
    let data_store = Arc::new(data_store);
    app.manage(data_store.as_ref().clone());

    // Prune all expired cache entries on setup
    if let Ok(conn) = data_store.conn() {
        let _ = crate::storage::extension_cache::prune_all_expired(&conn);
    }

    // Migrate any plaintext AI & web search credentials from settings.dat to encrypted SQLite table
    if let Some(master_key) = keystore_state.try_cached_master_key() {
        if let Err(e) =
            crate::ai::migration::migrate_settings_dat(app.handle(), &data_store, &master_key)
        {
            log::error!("[ai::migration] Failed to migrate credentials from settings.dat: {e}");
        }
    } else {
        log::warn!(
            "[ai::migration] Skipping settings.dat credential migration because keystore is locked"
        );
    }

    Ok(data_store)
}

fn spawn_clipboard_fts_rebuild(
    app_handle: tauri::AppHandle,
    store: crate::storage::DataStore,
    fts: Arc<crate::storage::clipboard_fts::ClipboardFts>,
    master_key: [u8; 32],
) {
    tauri::async_runtime::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            let conn = match store.conn() {
                Ok(c) => c,
                Err(_) => return false,
            };
            crate::storage::clipboard_fts::rebuild_from_disk(&conn, &fts, &master_key).is_ok()
        })
        .await
        .unwrap_or(false);
        if result {
            crate::storage::clipboard_fts::mark_ready();
            crate::event_bridge::bridge_emit(&app_handle, "clipboard:fts-ready", ());
        }
    });
}

fn spawn_notes_fts_rebuild(
    app_handle: tauri::AppHandle,
    store: crate::storage::DataStore,
    fts: Arc<crate::storage::notes_fts::NotesFts>,
    master_key: [u8; 32],
) {
    tauri::async_runtime::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            let conn = match store.conn() {
                Ok(c) => c,
                Err(_) => return false,
            };
            crate::storage::notes_fts::rebuild_from_disk(&conn, &fts, &master_key).is_ok()
        })
        .await
        .unwrap_or(false);
        if result {
            crate::storage::notes_fts::mark_ready();
            crate::event_bridge::bridge_emit(&app_handle, "notes:fts-ready", ());
        }
    });
}

/// Initializes clipboard and notes in-memory FTS indexes and kicks off background rebuild tasks.
/// Also registers Notes AI tools once the master key and NotesFts are available.
pub fn init_fts(
    app: &mut tauri::App,
    data_store: &Arc<crate::storage::DataStore>,
) -> Result<(), Box<dyn std::error::Error>> {
    let keystore = app
        .state::<crate::crypto::keystore::KeystoreState>()
        .inner()
        .clone();

    let clipboard_fts = Arc::new(
        crate::storage::clipboard_fts::ClipboardFts::new_in_memory()
            .expect("Clipboard FTS in-memory DB must initialise"),
    );
    app.manage(clipboard_fts.clone());

    let notes_fts = Arc::new(
        crate::storage::notes_fts::NotesFts::new_in_memory()
            .expect("Notes FTS in-memory DB must initialise"),
    );
    app.manage(notes_fts.clone());

    // Notes AI tools registered here because they need this block's DataStore / KeystoreState / NotesFts
    register_notes_tools(app.handle(), notes_fts.clone())?;

    if let Some(master_key) = keystore.try_cached_master_key() {
        spawn_clipboard_fts_rebuild(
            app.handle().clone(),
            data_store.as_ref().clone(),
            clipboard_fts,
            *master_key,
        );
        spawn_notes_fts_rebuild(
            app.handle().clone(),
            data_store.as_ref().clone(),
            notes_fts,
            *master_key,
        );
    } else {
        log::warn!(
            "[bootstrap::storage] deferring FTS rebuilds and credential migration until keystore unlocks"
        );
        let app_handle = app.handle().clone();
        let store_for_unlock = data_store.clone();
        keystore.set_on_first_unlock(move |master_key| {
            if let Err(e) = crate::ai::migration::migrate_settings_dat(
                &app_handle,
                &store_for_unlock,
                &master_key,
            ) {
                log::error!(
                    "[ai::migration] Failed to migrate credentials from settings.dat on unlock: {e}"
                );
            }
            spawn_clipboard_fts_rebuild(
                app_handle.clone(),
                store_for_unlock.as_ref().clone(),
                clipboard_fts,
                master_key,
            );
            spawn_notes_fts_rebuild(
                app_handle,
                store_for_unlock.as_ref().clone(),
                notes_fts,
                master_key,
            );
        });
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
    let keystore = app_handle
        .try_state::<crate::crypto::keystore::KeystoreState>()
        .ok_or("KeystoreState not managed")?
        .inner()
        .clone();

    registry
        .register_builtin(Arc::new(NotesSearchTool::with_keystore(
            data_store.clone(),
            keystore.clone(),
            fts.clone(),
        )))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(NotesListTool::with_keystore(
            data_store.clone(),
            keystore.clone(),
        )))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(NotesGetTool::with_keystore(
            data_store.clone(),
            keystore.clone(),
        )))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(NotesCreateTool::with_keystore(
            data_store.clone(),
            keystore.clone(),
            fts.clone(),
        )))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(NotesAppendTool::with_keystore(
            data_store, keystore, fts,
        )))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    Ok(())
}
