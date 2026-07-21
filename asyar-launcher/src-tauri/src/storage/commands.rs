use super::clipboard_fts::ClipboardFts;
use super::notes_fts::NotesFts;
use super::DataStore;
use crate::crypto::keystore::KeystoreState;
use crate::error::AppError;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

// ── Clipboard ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn clipboard_list_initial(
    limit: u32,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<super::clipboard::InitialPage, AppError> {
    let conn = store.conn()?;
    super::clipboard::list_initial(&conn, limit as usize, keystore.master_key())
}

#[tauri::command]
pub fn clipboard_list_older(
    cursor: super::clipboard::Cursor,
    limit: u32,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<super::clipboard::OlderPage, AppError> {
    let conn = store.conn()?;
    super::clipboard::list_older(&conn, &cursor, limit as usize, keystore.master_key())
}

#[tauri::command]
pub fn clipboard_search(
    query: String,
    limit: u32,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
    fts: State<'_, Arc<ClipboardFts>>,
) -> Result<super::clipboard::SearchResult, AppError> {
    let conn = store.conn()?;
    super::clipboard::search(
        &conn,
        fts.inner(),
        &query,
        limit as usize,
        keystore.master_key(),
    )
}

#[tauri::command]
pub fn clipboard_get_item(
    id: String,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<Option<super::clipboard::ClipboardItem>, AppError> {
    let conn = store.conn()?;
    super::clipboard::get_item(&conn, &id, keystore.master_key())
}

#[tauri::command]
pub fn clipboard_get_merged_text(
    ids: Vec<String>,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<super::clipboard::MergedText, AppError> {
    let conn = store.conn()?;
    super::clipboard::get_merged_text(&conn, &ids, keystore.master_key())
}

#[tauri::command]
pub fn clipboard_export_for_sync(
    cursor: Option<super::clipboard::Cursor>,
    limit: u32,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<super::clipboard::ExportPage, AppError> {
    let conn = store.conn()?;
    super::clipboard::export_for_sync(
        &conn,
        cursor.as_ref(),
        limit as usize,
        keystore.master_key(),
    )
}

#[tauri::command]
pub fn clipboard_count(
    store: State<'_, DataStore>,
) -> Result<super::clipboard::ClipboardCount, AppError> {
    let conn = store.conn()?;
    super::clipboard::count(&conn)
}

#[tauri::command]
pub fn clipboard_record_capture(
    app: tauri::AppHandle,
    item: super::clipboard::ClipboardItem,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
    fts: State<'_, Arc<ClipboardFts>>,
) -> Result<super::clipboard::CaptureResult, AppError> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.join("icon_cache"))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/asyar_icon_cache"));
    let conn = store.conn()?;
    super::clipboard::record_capture_with_fts(
        &conn,
        &item,
        Some(&cache_dir),
        keystore.master_key(),
        fts.inner(),
    )
}

#[tauri::command]
pub fn clipboard_toggle_favorite(
    id: String,
    store: State<'_, DataStore>,
) -> Result<bool, AppError> {
    let conn = store.conn()?;
    super::clipboard::toggle_favorite(&conn, &id)
}

#[tauri::command]
pub fn clipboard_delete_item(
    id: String,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
    fts: State<'_, Arc<ClipboardFts>>,
) -> Result<super::clipboard::DeleteResult, AppError> {
    let conn = store.conn()?;
    super::clipboard::delete_item_with_fts(&conn, &id, keystore.master_key(), fts.inner())
}

#[tauri::command]
pub fn clipboard_clear_non_favorites(
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
    fts: State<'_, Arc<ClipboardFts>>,
) -> Result<super::clipboard::ClearResult, AppError> {
    let conn = store.conn()?;
    super::clipboard::clear_non_favorites_with_fts(&conn, keystore.master_key(), fts.inner())
}

// ── Snippets ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn snippet_upsert(
    snippet: super::snippets::Snippet,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::snippets::upsert(&conn, &snippet, keystore.master_key())
}

#[tauri::command]
pub fn snippet_get_all(
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<Vec<super::snippets::Snippet>, AppError> {
    let conn = store.conn()?;
    super::snippets::get_all(&conn, keystore.master_key())
}

#[tauri::command]
pub fn snippet_remove(id: String, store: State<'_, DataStore>) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::snippets::remove(&conn, &id)
}

#[tauri::command]
pub fn snippet_toggle_pin(id: String, store: State<'_, DataStore>) -> Result<bool, AppError> {
    let conn = store.conn()?;
    super::snippets::toggle_pin(&conn, &id)
}

#[tauri::command]
pub fn snippet_clear_all(store: State<'_, DataStore>) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::snippets::clear_all(&conn)
}

// ── Notes ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn note_upsert(
    note: super::notes::Note,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
    fts: State<'_, Arc<NotesFts>>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::notes::upsert_with_fts(&conn, &note, keystore.master_key(), fts.inner())
}

#[tauri::command]
pub fn note_get_all(
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<Vec<super::notes::Note>, AppError> {
    let conn = store.conn()?;
    super::notes::get_all(&conn, keystore.master_key())
}

#[tauri::command]
pub fn note_get_by_id(
    id: String,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<Option<super::notes::Note>, AppError> {
    let conn = store.conn()?;
    super::notes::get_by_id(&conn, &id, keystore.master_key())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn note_update(
    id: String,
    title: Option<String>,
    body: Option<String>,
    pinned: Option<bool>,
    updated_at: f64,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
    fts: State<'_, Arc<NotesFts>>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::notes::update_with_fts(
        &conn,
        &id,
        title.as_deref(),
        body.as_deref(),
        pinned,
        updated_at,
        keystore.master_key(),
        fts.inner(),
    )
}

#[tauri::command]
pub fn note_remove(
    id: String,
    store: State<'_, DataStore>,
    fts: State<'_, Arc<NotesFts>>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::notes::remove_with_fts(&conn, &id, fts.inner())
}

#[tauri::command]
pub fn note_toggle_pin(id: String, store: State<'_, DataStore>) -> Result<bool, AppError> {
    let conn = store.conn()?;
    super::notes::toggle_pin(&conn, &id)
}

#[tauri::command]
pub fn note_search(
    query: String,
    limit: u32,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
    fts: State<'_, Arc<NotesFts>>,
) -> Result<super::notes::NoteSearchResult, AppError> {
    let conn = store.conn()?;
    super::notes::search(
        &conn,
        fts.inner(),
        &query,
        limit as usize,
        keystore.master_key(),
    )
}

/// Resolve a note by id or exact (case-insensitive) title. Returns `None`
/// when nothing matches.
#[tauri::command]
pub fn note_find(
    id_or_title: String,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<Option<super::notes::Note>, AppError> {
    let conn = store.conn()?;
    super::notes::get_by_id_or_title(&conn, &id_or_title, keystore.master_key())
}

/// Notes that link to the target (resolved by id or title) via `[[Title]]`.
#[tauri::command]
pub fn note_backlinks(
    id_or_title: String,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<Vec<super::notes::Note>, AppError> {
    let conn = store.conn()?;
    super::notes::backlinks(&conn, &id_or_title, keystore.master_key())
}

/// Export a note as a real `.md` file: prompt for a location (default name
/// derived from the title), write the Markdown, and reveal it in the OS file
/// manager. Returns the saved path, or `None` if the user cancels the dialog.
#[tauri::command]
pub async fn note_export_markdown(
    id: String,
    app_handle: AppHandle,
    store: State<'_, DataStore>,
    keystore: State<'_, KeystoreState>,
) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let note = {
        let conn = store.conn()?;
        super::notes::get_by_id(&conn, &id, keystore.master_key())?
    }
    .ok_or_else(|| AppError::NotFound(format!("note {id} not found")))?;

    let default_name = format!("{}.md", crate::notes_export::sanitize_filename(&note.title));
    let dest = app_handle
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();
    let Some(dest) = dest else {
        return Ok(None); // user cancelled
    };
    let path = dest.to_string();

    let markdown = crate::notes_export::note_to_markdown(&note.title, &note.body);
    std::fs::write(&path, markdown)
        .map_err(|e| AppError::Other(format!("Failed to write note file: {e}")))?;

    // Best-effort reveal — the export already succeeded if we got here.
    let _ = crate::commands::file_manager::reveal_in_file_manager(&path);
    Ok(Some(path))
}

// ── Extension Key-Value Storage ───────────────────────────────────────────────

#[tauri::command]
pub fn ext_kv_get(
    extension_id: String,
    key: String,
    store: State<'_, DataStore>,
) -> Result<Option<String>, AppError> {
    let conn = store.conn()?;
    super::extension_kv::get(&conn, &extension_id, &key)
}

#[tauri::command]
pub fn ext_kv_set(
    extension_id: String,
    key: String,
    value: String,
    store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::extension_kv::set(&conn, &extension_id, &key, &value)
}

#[tauri::command]
pub fn ext_kv_delete(
    extension_id: String,
    key: String,
    store: State<'_, DataStore>,
) -> Result<bool, AppError> {
    let conn = store.conn()?;
    super::extension_kv::delete(&conn, &extension_id, &key)
}

#[tauri::command]
pub fn ext_kv_get_all(
    extension_id: String,
    store: State<'_, DataStore>,
) -> Result<Vec<super::extension_kv::KvEntry>, AppError> {
    let conn = store.conn()?;
    super::extension_kv::get_all(&conn, &extension_id)
}

#[tauri::command]
pub fn ext_kv_clear(extension_id: String, store: State<'_, DataStore>) -> Result<u64, AppError> {
    let conn = store.conn()?;
    super::extension_kv::clear(&conn, &extension_id)
}

#[tauri::command]
pub async fn ext_cache_get(
    extension_id: String,
    key: String,
    store: tauri::State<'_, super::DataStore>,
) -> Result<Option<String>, AppError> {
    let conn = store.conn()?;
    super::extension_cache::get(&conn, &extension_id, &key)
}

#[tauri::command]
pub async fn ext_cache_set(
    extension_id: String,
    key: String,
    value: String,
    expires_at: Option<u64>,
    store: tauri::State<'_, super::DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::extension_cache::set(&conn, &extension_id, &key, &value, expires_at)
}

#[tauri::command]
pub async fn ext_cache_delete(
    extension_id: String,
    key: String,
    store: tauri::State<'_, super::DataStore>,
) -> Result<bool, AppError> {
    let conn = store.conn()?;
    super::extension_cache::delete(&conn, &extension_id, &key)
}

#[tauri::command]
pub async fn ext_cache_clear(
    extension_id: String,
    store: tauri::State<'_, super::DataStore>,
) -> Result<u64, AppError> {
    let conn = store.conn()?;
    super::extension_cache::clear(&conn, &extension_id)
}

// ── Shortcuts ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn shortcut_upsert(
    shortcut: super::shortcuts::ItemShortcut,
    store: State<'_, DataStore>,
    app: AppHandle,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::shortcuts::upsert(&conn, &shortcut)?;
    // Broadcast so every webview's shortcutStore reloads. Without this,
    // a shortcut added from the onboarding webview never lands in the
    // main launcher's in-memory cache — `handleFiredShortcut` then logs
    // "Received shortcut for unknown objectId" because the lookup misses
    // even though Rust dispatched the event correctly.
    let _ = app.emit("shortcuts:changed", ());
    Ok(())
}

#[tauri::command]
pub fn shortcut_get_all(
    store: State<'_, DataStore>,
) -> Result<Vec<super::shortcuts::ItemShortcut>, AppError> {
    let conn = store.conn()?;
    super::shortcuts::get_all(&conn)
}

#[tauri::command]
pub fn shortcut_remove(
    object_id: String,
    store: State<'_, DataStore>,
    app: AppHandle,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::shortcuts::remove(&conn, &object_id)?;
    let _ = app.emit("shortcuts:changed", ());
    Ok(())
}
