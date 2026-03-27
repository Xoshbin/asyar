// src/search_engine/commands.rs

use super::models::{SearchableItem, SearchResult};
use super::{save_items_to_disk, SearchError, SearchState};
use fuzzy_matcher::skim::SkimMatcherV2; // Added fuzzy-matcher
use fuzzy_matcher::FuzzyMatcher; // Added fuzzy-matcher trait
use std::collections::HashSet;
use tauri::{Manager, State};

fn get_id(item: &SearchableItem) -> &str {
    match item {
        SearchableItem::Application(app) => &app.id, // app.id now holds "app_..."
        SearchableItem::Command(cmd) => &cmd.id,    // Assume cmd.id also holds the full ID "cmd_..."
    }
}

// ... (get_name, get_type_str, get_usage_count remain unchanged) ...
fn get_name(item: &SearchableItem) -> &str {
    match item {
        SearchableItem::Application(app) => &app.name,
        SearchableItem::Command(cmd) => &cmd.name,
    }
}
fn get_type_str(item: &SearchableItem) -> &str {
    match item {
        SearchableItem::Application(_) => "application",
        SearchableItem::Command(_) => "command",
    }
}
fn get_usage_count(item: &SearchableItem) -> u32 {
    match item {
        SearchableItem::Application(app) => app.usage_count,
        SearchableItem::Command(cmd) => cmd.usage_count,
    }
}


#[tauri::command]
pub async fn batch_index_items(
    items: Vec<SearchableItem>,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    log::info!("Batch indexing {} items", items.len());
    let mut items_guard = state.items.lock().map_err(|_| SearchError::LockError)?;
    
    for item in items {
        let object_id_str: String = match &item {
            SearchableItem::Application(app) => app.id.to_string(),
            SearchableItem::Command(cmd) => cmd.id.to_string(),
        };
        items_guard.retain(|existing_item| get_id(existing_item) != object_id_str);
        items_guard.push(item);
    }

    drop(items_guard);
    save_items_to_disk(&state)?;
    Ok(())
}

#[tauri::command]
pub async fn save_search_index(
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    save_items_to_disk(&state)
}

#[tauri::command]
pub async fn index_item(
    item: SearchableItem, // item is owned here
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    log::info!("Indexing item request: {:?}", item);

    // --- Use item.id directly and create an OWNED String ---
    let object_id_str: String = match &item { // Still borrows item temporarily...
        SearchableItem::Application(app) => {
            if app.id.is_empty() || !app.id.starts_with("app_") {
                // ... error handling ...
                 return Err(SearchError::Other("Application ID is invalid".to_string()));
            }
            app.id.to_string() // Convert the borrowed &str to an owned String
        }
        SearchableItem::Command(cmd) => {
            if cmd.id.is_empty() || !cmd.id.starts_with("cmd_") {
                // ... error handling ...
                  return Err(SearchError::Other("Command ID is invalid".to_string()));
            }
            cmd.id.to_string() // Convert the borrowed &str to an owned String
        }
    }; // ...the temporary borrow of item ends here. object_id_str is now independent.
    log::debug!("Using object_id for indexing: {}", object_id_str);
    // --- End ID usage ---

    // --- Update the in-memory list ---
    let mut items_guard = state.items.lock().map_err(|_| SearchError::LockError)?;
    // Now we compare get_id(existing_item) with the owned object_id_str.
    // This doesn't borrow the original `item` argument anymore.
    items_guard.retain(|existing_item| get_id(existing_item) != object_id_str);
    log::debug!("Removed existing item (if any) with id: {}", object_id_str);

    // --- Move item: This is now allowed! ---
    items_guard.push(item); // item (which the function owns) can be moved into the vector
    // --- End Move ---

    log::debug!("Added/Updated item with id: {}", object_id_str);

    // --- Save to disk (Unchanged) ---
    drop(items_guard);
    save_items_to_disk(&state)?;

    Ok(())
}


#[tauri::command]
pub async fn search_items(
    query: String,
    state: State<'_, SearchState>,
) -> Result<Vec<SearchResult>, SearchError> {
    let trimmed_query = query.trim();
    log::info!("Received search request for: '{}'", trimmed_query);

    let items_guard = state.items.lock().map_err(|_| SearchError::LockError)?;
    let mut results: Vec<SearchResult> = Vec::new();
    let limit = 20;

    if trimmed_query.is_empty() {
        // --- Empty Query: Show suggestions based on usage ---
        log::debug!("Query is empty, suggesting items based on usage count.");
        let mut sorted_by_usage: Vec<&SearchableItem> = items_guard.iter().collect();

        // --- FIX 1: Ensure closure returns Ordering ---
        // Remove the {} braces OR explicitly return the result
        sorted_by_usage.sort_unstable_by(|a, b| // No {} braces needed for single expression
            get_usage_count(b)
                .cmp(&get_usage_count(a)) // Descending usage
                .then_with(|| get_name(a).cmp(get_name(b))) // Ascending name
        );
        // --- END FIX 1 ---

        // --- FIX 2: Handle &&SearchableItem in loop ---
        for item_ref in sorted_by_usage.iter().take(limit) { // item_ref is &&SearchableItem
             // Dereference once (`*item_ref`) when matching
            let item_path = match *item_ref { // Match on &SearchableItem
                SearchableItem::Application(ref app) => Some(app.path.clone()),
                SearchableItem::Command(_) => None,
            };

            let item_icon = match *item_ref {
                SearchableItem::Application(ref app) => app.icon.clone(),
                SearchableItem::Command(ref cmd) => cmd.icon.clone(),
            };

            let item_extension_id = match *item_ref {
                SearchableItem::Application(_) => None,
                SearchableItem::Command(ref cmd) => Some(cmd.extension.clone()),
            };

            // Pass item_ref directly to helpers (auto-deref works here)
            results.push(SearchResult {
                object_id: get_id(item_ref).to_string(),
                name: get_name(item_ref).to_string(),
                result_type: get_type_str(item_ref).to_string(),
                score: get_usage_count(item_ref) as f32,
                path: item_path,
                icon: item_icon,
                extension_id: item_extension_id,
            });
        }
        // --- END FIX 2 ---

        log::info!("Returning {} suggestions based on usage.", results.len());

    } else {
        // --- Non-Empty Query (Using fuzzy-matcher) ---
        log::debug!("Query non-empty, using fuzzy-matcher (SkimV2) + usage count ranking.");
        let matcher = SkimMatcherV2::default();
        let mut scored_items: Vec<(i64, u32, &SearchableItem)> = Vec::new(); // Score is now i64

        // No need to lowercase query for SkimMatcherV2
        // let query_lowercase = trimmed_query.to_lowercase();

        for item in items_guard.iter() {
            let item_name = get_name(item);
            if let Some(score) = matcher.fuzzy_match(item_name, trimmed_query) {
                let usage_count = get_usage_count(item);
                scored_items.push((score, usage_count, item));
            }
        }

        // Sort by fuzzy score (desc), then usage count (desc)
        scored_items.sort_unstable_by(|a, b| {
            b.0.cmp(&a.0) // Compare i64 score
                .then_with(|| b.1.cmp(&a.1)) // Compare u32 usage count
        });

        let mut added_ids = HashSet::new();
        for (fuzzy_score, _usage_count, item) in scored_items.iter().take(limit) {
            let object_id = get_id(item);
            if added_ids.insert(object_id.to_string()) {
                let item_path = match item {
                    SearchableItem::Application(app) => Some(app.path.clone()),
                    SearchableItem::Command(_) => None,
                };
                let item_icon = match item {
                    SearchableItem::Application(app) => app.icon.clone(),
                    SearchableItem::Command(cmd) => cmd.icon.clone(),
                };
                let item_extension_id = match item {
                    SearchableItem::Application(_) => None,
                    SearchableItem::Command(cmd) => Some(cmd.extension.clone()),
                };
                results.push(SearchResult {
                    object_id: object_id.to_string(),
                    name: get_name(item).to_string(),
                    result_type: get_type_str(item).to_string(),
                    score: *fuzzy_score as f32, // Convert i64 score to f32 for frontend
                    path: item_path,
                    icon: item_icon,
                    extension_id: item_extension_id,
                });
            }
        }
        log::info!("Found {} results using fuzzy-matcher + usage.", results.len());
    }


    log::info!(
        "Returning {} processed results/suggestions for query '{}'",
        results.len(),
        trimmed_query
    );
    Ok(results)
}


#[tauri::command]
pub async fn record_item_usage(
    object_id: String, // This is the full ID ("app_..." or "cmd_...")
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    log::info!("Recording usage for item: {}", object_id);
    let mut items_guard = state.items.lock().map_err(|_| SearchError::LockError)?;

    let mut found = false;
    for item in items_guard.iter_mut() {
        // Compare directly with item's ID (which is now the full object ID)
        if get_id(item) == object_id {
            match item {
                SearchableItem::Application(app) => app.usage_count += 1,
                SearchableItem::Command(cmd) => cmd.usage_count += 1,
            }
            log::debug!("Incremented usage count for {}", object_id);
            found = true;
            break;
        }
    }
    drop(items_guard);
    if found {
        save_items_to_disk(&state)?;
    } else {
        log::warn!("record_item_usage: item '{}' not found in index, skipping save", object_id);
    }
    Ok(())
}


#[tauri::command]
pub async fn get_indexed_object_ids(
    state: State<'_, SearchState>,
) -> Result<HashSet<String>, SearchError> {
    log::debug!("Retrieving all indexed object IDs");
    let items_guard = state.items.lock().map_err(|_| SearchError::LockError)?;

    // Map directly using the item's ID (which is the full object ID)
    let indexed_ids: HashSet<String> = items_guard.iter().map(|item| get_id(item).to_string()).collect();

    log::info!("Found {} unique object IDs.", indexed_ids.len());
    Ok(indexed_ids)
}

#[tauri::command]
pub async fn delete_item(
    object_id: String, // This is the full ID ("app_..." or "cmd_...")
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    log::info!("Deleting item with object_id: {}", object_id);
    let mut items_guard = state.items.lock().map_err(|_| SearchError::LockError)?;

    let initial_len = items_guard.len();
    // Use item's ID directly for comparison
    items_guard.retain(|item| get_id(item) != object_id);
    let deleted = items_guard.len() < initial_len;

    drop(items_guard);
    if deleted {
        log::info!("Deleted item with ID: {}", object_id);
        save_items_to_disk(&state)?;
    } else {
        log::warn!("delete_item: item '{}' not found in index", object_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn reset_search_index(
    app_handle: tauri::AppHandle,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    log::info!("Attempting to reset the search index...");
    let mut items_guard = state.items.lock().map_err(|_| SearchError::LockError)?;

    items_guard.clear(); // Clear the in-memory vector
    log::debug!("In-memory index cleared.");

    // Drop guard before saving
    drop(items_guard);

    // Save the empty list to disk
    save_items_to_disk(&state)?;
    log::info!("Empty index saved to disk.");

    // Clear the icon cache array
    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        let icon_cache = app_data_dir.join("icon_cache");
        if icon_cache.exists() {
            let _ = std::fs::remove_dir_all(&icon_cache);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search_engine::models::{Application, Command, SearchableItem};

    fn make_app(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Application(Application {
            id: id.to_string(),
            name: name.to_string(),
            path: format!("/Applications/{}.app", name),
            usage_count: usage,
            icon: None,
        })
    }

    fn make_cmd(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Command(Command {
            id: id.to_string(),
            name: name.to_string(),
            extension: "test-ext".to_string(),
            trigger: name.to_lowercase(),
            command_type: "command".to_string(),
            usage_count: usage,
            icon: None,
        })
    }

    #[test]
    fn test_get_id_application() {
        let item = make_app("app_finder", "Finder", 0);
        assert_eq!(get_id(&item), "app_finder");
    }

    #[test]
    fn test_get_id_command() {
        let item = make_cmd("cmd_search_google", "Search Google", 0);
        assert_eq!(get_id(&item), "cmd_search_google");
    }

    #[test]
    fn test_get_name_application() {
        let item = make_app("app_safari", "Safari", 0);
        assert_eq!(get_name(&item), "Safari");
    }

    #[test]
    fn test_get_name_command() {
        let item = make_cmd("cmd_x", "Find Files", 0);
        assert_eq!(get_name(&item), "Find Files");
    }

    #[test]
    fn test_get_type_str_application() {
        let item = make_app("app_arc", "Arc", 0);
        assert_eq!(get_type_str(&item), "application");
    }

    #[test]
    fn test_get_type_str_command() {
        let item = make_cmd("cmd_x", "X", 0);
        assert_eq!(get_type_str(&item), "command");
    }

    #[test]
    fn test_get_usage_count_application() {
        let item = make_app("app_chrome", "Chrome", 42);
        assert_eq!(get_usage_count(&item), 42);
    }

    #[test]
    fn test_get_usage_count_command() {
        let item = make_cmd("cmd_y", "Y", 7);
        assert_eq!(get_usage_count(&item), 7);
    }

    #[test]
    fn test_get_usage_count_zero() {
        let item = make_app("app_new", "NewApp", 0);
        assert_eq!(get_usage_count(&item), 0);
    }
}

