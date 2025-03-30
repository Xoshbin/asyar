// src/search_engine/commands.rs

use super::models::{Application, Command, SearchableItem, SearchResult};
use super::{save_items_to_disk, SearchError, SearchState};
use strsim::jaro_winkler;
use std::collections::HashSet;
use tauri::State;
use std::cmp::Ordering;

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
                SearchableItem::Application(app) => Some(app.path.clone()),
                SearchableItem::Command(_) => None,
            };

            // Pass item_ref directly to helpers (auto-deref works here)
            results.push(SearchResult {
                object_id: get_id(item_ref).to_string(),
                name: get_name(item_ref).to_string(),
                result_type: get_type_str(item_ref).to_string(),
                score: get_usage_count(item_ref) as f32,
                path: item_path,
            });
        }
        // --- END FIX 2 ---

        log::info!("Returning {} suggestions based on usage.", results.len());

    } else {
        // --- Non-Empty Query (Keep as before) ---
        log::debug!("Query non-empty, using Jaro-Winkler + usage count ranking.");
        let mut scored_items: Vec<(f64, u32, &SearchableItem)> = Vec::new();
        let query_lowercase = trimmed_query.to_lowercase();

        for item in items_guard.iter() { // item here is &SearchableItem (correct)
            let item_name = get_name(item);
            let score = jaro_winkler(&query_lowercase, &item_name.to_lowercase());
            let usage_count = get_usage_count(item);
            scored_items.push((score, usage_count, item));
        }

        scored_items.sort_unstable_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(Ordering::Equal)
                .then_with(|| b.1.cmp(&a.1))
        });

        let mut added_ids = HashSet::new();
        for (jaro_score, _usage_count, item) in scored_items.iter().take(limit) { // item here is &SearchableItem (correct)
            let object_id = get_id(item);
            if added_ids.insert(object_id.to_string()) {
                let item_path = match item { // Match on &SearchableItem (correct)
                    SearchableItem::Application(app) => Some(app.path.clone()),
                    SearchableItem::Command(_) => None,
                };
                results.push(SearchResult {
                    object_id: object_id.to_string(),
                    name: get_name(item).to_string(),
                    result_type: get_type_str(item).to_string(),
                    score: *jaro_score as f32,
                    path: item_path,
                });
            }
        }
         log::info!("Found {} results using Jaro-Winkler + usage.", results.len());
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
    // ... (rest of function unchanged) ...
    if !found { /* ... */ }
    drop(items_guard);
    save_items_to_disk(&state)?;
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

    // ... (rest of function unchanged) ...
     drop(items_guard);
     if deleted { /* ... */ } else { /* ... */ }
     Ok(()) // Should return Ok(()) only if deletion was attempted or successful logic path is taken
}

#[tauri::command]
pub async fn reset_search_index(
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

    Ok(())
}