use super::DataStore;
use crate::error::AppError;
use tauri::State;

// ── Clipboard ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn clipboard_add_item(
    item: super::clipboard::ClipboardItem,
    store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::clipboard::add_item(&conn, &item)
}

#[tauri::command]
pub fn clipboard_get_all(
    store: State<'_, DataStore>,
) -> Result<Vec<super::clipboard::ClipboardItem>, AppError> {
    let conn = store.conn()?;
    super::clipboard::get_all(&conn)
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
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::clipboard::delete_item(&conn, &id)
}

#[tauri::command]
pub fn clipboard_clear_non_favorites(
    store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::clipboard::clear_non_favorites(&conn)
}

#[tauri::command]
pub fn clipboard_find_duplicate(
    item_type: String,
    content: Option<String>,
    id: String,
    store: State<'_, DataStore>,
) -> Result<Option<super::clipboard::ClipboardItem>, AppError> {
    let conn = store.conn()?;
    super::clipboard::find_duplicate(&conn, &item_type, content.as_deref(), &id)
}

#[tauri::command]
pub fn clipboard_cleanup(
    max_age_ms: f64,
    max_items: usize,
    store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::clipboard::cleanup(&conn, max_age_ms, max_items)
}

// ── Snippets ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn snippet_upsert(
    snippet: super::snippets::Snippet,
    store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::snippets::upsert(&conn, &snippet)
}

#[tauri::command]
pub fn snippet_get_all(
    store: State<'_, DataStore>,
) -> Result<Vec<super::snippets::Snippet>, AppError> {
    let conn = store.conn()?;
    super::snippets::get_all(&conn)
}

#[tauri::command]
pub fn snippet_remove(
    id: String,
    store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::snippets::remove(&conn, &id)
}

#[tauri::command]
pub fn snippet_toggle_pin(
    id: String,
    store: State<'_, DataStore>,
) -> Result<bool, AppError> {
    let conn = store.conn()?;
    super::snippets::toggle_pin(&conn, &id)
}

#[tauri::command]
pub fn snippet_clear_all(
    store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::snippets::clear_all(&conn)
}

// ── Shortcuts ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn shortcut_upsert(
    shortcut: super::shortcuts::ItemShortcut,
    store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::shortcuts::upsert(&conn, &shortcut)
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
) -> Result<(), AppError> {
    let conn = store.conn()?;
    super::shortcuts::remove(&conn, &object_id)
}
