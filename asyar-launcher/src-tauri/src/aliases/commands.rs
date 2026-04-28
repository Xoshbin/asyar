use super::{AliasState, ItemAlias};
use crate::search_engine::models::SearchableItem;
use tauri::State;

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AliasConflict {
    pub object_id: String,
    pub item_name: String,
}

#[tauri::command]
pub async fn set_alias(
    object_id: String,
    alias: String,
    item_name: String,
    item_type: String,
    state: State<'_, AliasState>,
) -> Result<ItemAlias, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    state
        .set_alias(&object_id, &alias, &item_name, &item_type, now)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unset_alias(alias: String, state: State<'_, AliasState>) -> Result<(), String> {
    state.unset_alias(&alias).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_aliases(state: State<'_, AliasState>) -> Result<Vec<ItemAlias>, String> {
    state.list_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn find_alias_conflict(
    alias: String,
    excluding_object_id: Option<String>,
    state: State<'_, AliasState>,
) -> Result<Option<AliasConflict>, String> {
    let conflict = state
        .find_conflict(&alias, excluding_object_id.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(conflict.map(|c| AliasConflict {
        object_id: c.object_id,
        item_name: c.item_name,
    }))
}

#[tauri::command]
pub async fn get_indexed_items(
    search_state: State<'_, crate::search_engine::SearchState>,
) -> Result<Vec<SearchableItem>, String> {
    let items = search_state
        .items
        .read()
        .map_err(|_| "search items lock poisoned in get_indexed_items".to_string())?;
    Ok(items.clone())
}
