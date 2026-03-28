use super::models::{SearchResult, SearchableItem};
use super::{SearchError, SearchState};
use std::collections::HashSet;
use tauri::{Manager, State};

#[tauri::command]
pub async fn search_items(
    query: String,
    state: State<'_, SearchState>,
) -> Result<Vec<SearchResult>, SearchError> {
    state.search(&query)
}

#[tauri::command]
pub async fn merged_search(
    query: String,
    external_results: Vec<super::models::ExternalSearchResult>,
    min_results: Option<usize>,
    state: State<'_, SearchState>,
) -> Result<Vec<SearchResult>, SearchError> {
    state.merged_search(&query, external_results, min_results.unwrap_or(20))
}

#[tauri::command]
pub async fn index_item(
    item: SearchableItem,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.index_one(item)?;
    state.save_items_to_db().map_err(SearchError::from)
}

#[tauri::command]
pub async fn batch_index_items(
    items: Vec<SearchableItem>,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.batch_index(items)?;
    state.save_items_to_db().map_err(SearchError::from)
}

#[tauri::command]
pub async fn get_indexed_object_ids(
    state: State<'_, SearchState>,
) -> Result<Vec<String>, SearchError> {
    state.all_ids().map(|set| set.into_iter().collect())
}

#[tauri::command]
pub async fn record_item_usage(
    object_id: String,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.record_usage(&object_id)
}

#[tauri::command]
pub async fn save_search_index(
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    state.save_items_to_db().map_err(SearchError::from)
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

/// Input: a list of commands currently known to the frontend.
/// Rust diffs against indexed `cmd_` items, adds new ones, removes stale ones, persists to SQLite.
#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommandSyncInput {
    pub id: String,        // Full object ID, e.g. "cmd_extensionId_commandId"
    pub name: String,
    pub extension: String, // Extension ID
    pub trigger: String,
    #[serde(rename = "type")]
    pub command_type: String,
    pub icon: Option<String>,
}

#[derive(serde::Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommandSyncResult {
    pub added: u32,
    pub removed: u32,
    pub total: u32,
}

#[tauri::command]
pub async fn sync_command_index(
    commands: Vec<CommandSyncInput>,
    search_state: tauri::State<'_, crate::search_engine::SearchState>,
) -> Result<CommandSyncResult, crate::error::AppError> {
    sync_command_index_internal(commands, &search_state)
}

/// Internal logic for Command Sync, separated for testability without tauri::State complexity.
pub fn sync_command_index_internal(
    commands: Vec<CommandSyncInput>,
    search_state: &crate::search_engine::SearchState,
) -> Result<CommandSyncResult, crate::error::AppError> {
    use std::collections::{HashMap, HashSet};
    use crate::search_engine::models::{SearchableItem, Command};

    // 1. Build current command map from input
    let mut current_commands: HashMap<String, CommandSyncInput> = HashMap::new();
    for cmd in commands {
        current_commands.insert(cmd.id.clone(), cmd);
    }

    // 2. Get currently indexed cmd_ IDs
    let indexed_ids: Vec<String> = {
        let items = search_state.items.read()
            .map_err(|_| crate::error::AppError::Lock)?;
        items.iter()
            .filter_map(|item| {
                let id = item.id();
                if id.starts_with("cmd_") { Some(id.to_string()) } else { None }
            })
            .collect()
    };

    let indexed_set: HashSet<&str> = indexed_ids.iter().map(|s| s.as_str()).collect();
    let current_set: HashSet<&str> = current_commands.keys().map(|s| s.as_str()).collect();

    // 3. Diff
    let to_add: Vec<String> = current_set.difference(&indexed_set).map(|s| s.to_string()).collect();
    let to_remove: Vec<String> = indexed_set.difference(&current_set).map(|s| s.to_string()).collect();

    let added = to_add.len() as u32;
    let removed = to_remove.len() as u32;

    // 4. Update SearchState
    if !to_add.is_empty() || !to_remove.is_empty() {
        let mut items = search_state.items.write()
            .map_err(|_| crate::error::AppError::Lock)?;

        // Remove stale commands
        if !to_remove.is_empty() {
            let remove_set: HashSet<String> = to_remove.into_iter().collect();
            items.retain(|item| !remove_set.contains(item.id()));
        }

        // Add new commands (preserve usage_count=0, last_used_at=None for new entries)
        for id in to_add {
            if let Some(cmd_input) = current_commands.remove(&id) {
                items.push(SearchableItem::Command(Command {
                    id: cmd_input.id,
                    name: cmd_input.name,
                    extension: cmd_input.extension,
                    trigger: cmd_input.trigger,
                    command_type: cmd_input.command_type,
                    usage_count: 0,
                    icon: cmd_input.icon,
                    last_used_at: None,
                }));
            }
        }
    }

    // 5. Persist
    search_state.save_items_to_db()
        .map_err(|e| crate::error::AppError::Other(format!("Failed to save index: {}", e)))?;

    let total = {
        let items = search_state.items.read()
            .map_err(|_| crate::error::AppError::Lock)?;
        items.iter().filter(|i| i.id().starts_with("cmd_")).count() as u32
    };

    log::info!("Command sync complete: {} added, {} removed, {} total commands", added, removed, total);

    Ok(CommandSyncResult { added, removed, total })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_app(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Application(super::super::models::Application {
            id: id.to_string(),
            name: name.to_string(),
            path: format!("/apps/{}", name),
            usage_count: usage,
            icon: None,
            last_used_at: None,
        })
    }

    fn make_cmd(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Command(super::super::models::Command {
            id: id.to_string(),
            name: name.to_string(),
            extension: "test_ext".to_string(),
            trigger: name.to_string(),
            command_type: "command".to_string(),
            usage_count: usage,
            icon: None,
            last_used_at: None,
        })
    }

    #[test]
    fn test_get_usage_count_zero() {
        let item = make_app("app_new", "NewApp", 0);
        assert_eq!(item.usage_count(), 0);
    }

    // --- sync_command_index tests ---

    fn make_test_state() -> SearchState {
        use std::sync::{RwLock, Mutex};
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        // Since we can't easily call init_db from here without making it public or duplicating,
        // we'll just skip the DB persistence part in these unit tests by mocking save_items_to_db if needed,
        // or just let it fail if it hits DB. Actually, let's just initialize the table.
        conn.execute("CREATE TABLE search_items (id TEXT PRIMARY KEY, category TEXT, data TEXT)", []).unwrap();
        SearchState {
            items: RwLock::new(vec![]),
            db: Mutex::new(conn),
        }
    }

    #[tokio::test]
    async fn test_sync_command_index_empty_removes_all() {
        let state = make_test_state();
        state.index_one(make_cmd("cmd_1", "Cmd 1", 0)).unwrap();
        state.index_one(make_cmd("cmd_2", "Cmd 2", 0)).unwrap();
        
        let result = sync_command_index_internal(vec![], &state).unwrap();
        
        assert_eq!(result.removed, 2);
        assert_eq!(result.total, 0);
    }

    #[tokio::test]
    async fn test_sync_command_index_adds_new() {
        let state = make_test_state();
        
        let input = vec![CommandSyncInput {
            id: "cmd_new".to_string(),
            name: "New".to_string(),
            extension: "ext".to_string(),
            trigger: "new".to_string(),
            command_type: "command".to_string(),
            icon: None,
        }];
        
        let result = sync_command_index_internal(input, &state).unwrap();
        assert_eq!(result.added, 1);
        assert_eq!(result.total, 1);
    }

    #[tokio::test]
    async fn test_sync_command_index_preserves_apps() {
        let state = make_test_state();
        state.index_one(make_app("app_1", "App 1", 0)).unwrap();
        state.index_one(make_cmd("cmd_1", "Cmd 1", 0)).unwrap();
        
        // Syncing with empty command list should remove cmd_1 but KEEP app_1
        let result = sync_command_index_internal(vec![], &state).unwrap();
        
        assert_eq!(result.removed, 1);
        assert_eq!(result.total, 0);
        
        // Final check of the state
        let items = state.items.read().unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].id().starts_with("app_"));
    }

    #[tokio::test]
    async fn test_sync_command_index_deduplicates_input() {
        let state = make_test_state();
        
        // Same ID twice in input
        let input = vec![
            CommandSyncInput {
                id: "cmd_dup".to_string(),
                name: "First".to_string(),
                extension: "ext".to_string(),
                trigger: "first".to_string(),
                command_type: "command".to_string(),
                icon: None,
            },
            CommandSyncInput {
                id: "cmd_dup".to_string(),
                name: "Second".to_string(),
                extension: "ext".to_string(),
                trigger: "second".to_string(),
                command_type: "command".to_string(),
                icon: None,
            }
        ];
        
        let result = sync_command_index_internal(input, &state).unwrap();
        assert_eq!(result.added, 1); // Only one added
        assert_eq!(result.total, 1);
        
        let items = state.items.read().unwrap();
        assert_eq!(items[0].get_name(), "Second"); // Last one wins
    }
}
