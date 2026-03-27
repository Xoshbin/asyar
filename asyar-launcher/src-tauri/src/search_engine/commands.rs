// src/search_engine/commands.rs
// Thin Tauri command adapters — business logic lives in SearchState impl (mod.rs)

use super::models::{SearchResult, SearchableItem};
use super::{SearchError, SearchState};
use std::collections::HashSet;
use tauri::{Manager, State};

#[tauri::command]
pub async fn batch_index_items(
    items: Vec<SearchableItem>,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.batch_index(items)
}

#[tauri::command]
pub async fn save_search_index(
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.save()
}

#[tauri::command]
pub async fn index_item(
    item: SearchableItem,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.index_one(item)
}

#[tauri::command]
pub async fn search_items(
    query: String,
    state: State<'_, SearchState>,
) -> Result<Vec<SearchResult>, SearchError> {
    state.search(&query)
}

#[tauri::command]
pub async fn record_item_usage(
    object_id: String,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.record_usage(&object_id)
}

#[tauri::command]
pub async fn get_indexed_object_ids(
    state: State<'_, SearchState>,
) -> Result<HashSet<String>, SearchError> {
    state.all_ids()
}

#[tauri::command]
pub async fn delete_item(
    object_id: String,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.delete(&object_id)
}

#[tauri::command]
pub async fn reset_search_index(
    app_handle: tauri::AppHandle,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    let icon_cache = app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|d: std::path::PathBuf| d.join("icon_cache"));
    state.reset(icon_cache)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search_engine::models::{Application, Command};

    fn make_app(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Application(Application {
            id: id.to_string(), name: name.to_string(),
            path: format!("/Applications/{}.app", name),
            usage_count: usage, icon: None,
            last_used_at: None,
        })
    }

    fn make_cmd(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Command(Command {
            id: id.to_string(), name: name.to_string(),
            extension: "test-ext".to_string(), trigger: name.to_lowercase(),
            command_type: "command".to_string(), usage_count: usage, icon: None,
            last_used_at: None,
        })
    }

    #[test]
    fn test_get_id_application() {
        let item = make_app("app_finder", "Finder", 0);
        assert_eq!(item.id(), "app_finder");
    }

    #[test]
    fn test_get_id_command() {
        let item = make_cmd("cmd_search_google", "Search Google", 0);
        assert_eq!(item.id(), "cmd_search_google");
    }

    #[test]
    fn test_get_name_application() {
        let item = make_app("app_safari", "Safari", 0);
        assert_eq!(item.get_name(), "Safari");
    }

    #[test]
    fn test_get_name_command() {
        let item = make_cmd("cmd_x", "Find Files", 0);
        assert_eq!(item.get_name(), "Find Files");
    }

    #[test]
    fn test_get_type_str_application() {
        let item = make_app("app_arc", "Arc", 0);
        assert_eq!(item.get_type_str(), "application");
    }

    #[test]
    fn test_get_type_str_command() {
        let item = make_cmd("cmd_x", "X", 0);
        assert_eq!(item.get_type_str(), "command");
    }

    #[test]
    fn test_get_usage_count_application() {
        let item = make_app("app_chrome", "Chrome", 42);
        assert_eq!(item.usage_count(), 42);
    }

    #[test]
    fn test_get_usage_count_command() {
        let item = make_cmd("cmd_y", "Y", 7);
        assert_eq!(item.usage_count(), 7);
    }

    #[test]
    fn test_get_usage_count_zero() {
        let item = make_app("app_new", "NewApp", 0);
        assert_eq!(item.usage_count(), 0);
    }
}
