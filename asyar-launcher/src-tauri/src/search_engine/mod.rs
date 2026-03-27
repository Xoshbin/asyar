pub mod commands;
pub mod models;

// Import necessary items
use models::{SearchableItem, SearchResult};
use std::fs;
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::sync::Mutex;
use std::collections::HashSet;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use tauri::{AppHandle, Manager};

// Constant for the persistence file name
const INDEX_FILE_NAME: &str = "search_data.json";

// Simplified state: A list of searchable items protected by a Mutex
pub struct SearchState {
    pub items: Mutex<Vec<SearchableItem>>,
    pub persistence_path: PathBuf, // Store the path for saving
}

// Helper to get the path for the JSON persistence file
fn get_persistence_path(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join(INDEX_FILE_NAME)
}


// Function to load items from the JSON file
fn load_items_from_disk(path: &PathBuf) -> Result<Vec<SearchableItem>, SearchError> {
    log::info!("Attempting to load index from: {:?}", path);
    if !path.exists() {
        log::info!("Index file not found, starting with empty index.");
        return Ok(Vec::new()); // Return empty list if file doesn't exist
    }
    let file = fs::File::open(path).map_err(SearchError::Io)?;
    let reader = BufReader::new(file);
    let items: Vec<SearchableItem> =
        serde_json::from_reader(reader).map_err(SearchError::Json)?;
    log::info!("Successfully loaded {} items from index file.", items.len());
    Ok(items)
}

// Function to save items to the JSON file
// Takes a reference to the state to avoid cloning the potentially large Vec
fn save_items_to_disk(
    state: &SearchState, // Pass the whole state
) -> Result<(), SearchError> {
    let path = &state.persistence_path;
    log::debug!("Attempting to save index to: {:?}", path);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(SearchError::Io)?;
    }

    let items_guard = state.items.lock().map_err(|_| SearchError::LockError)?;

    let file = fs::File::create(path).map_err(SearchError::Io)?;
    let writer = BufWriter::new(file);

    serde_json::to_writer_pretty(writer, &*items_guard).map_err(SearchError::Json)?;
    log::info!(
        "Successfully saved {} items to index file.",
        items_guard.len()
    );
    Ok(())
}

// Initialize the state by loading from disk
pub fn initialize_search_state(
    app_handle: &AppHandle,
) -> Result<SearchState, Box<dyn std::error::Error>> {
    let persistence_path = get_persistence_path(app_handle);
    let items = load_items_from_disk(&persistence_path)?;
    Ok(SearchState {
        items: Mutex::new(items),
        persistence_path,
    })
}

// Updated Error type
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("Index lock poisoned")]
    LockError,
    #[error("JSON serialization/deserialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Item not found with ID: {0}")]
    #[allow(dead_code)]
    NotFound(String),
    #[error("Invalid item data: {0}")]
    Other(String),
    // Keep other generic errors if needed, remove Tantivy/Schema errors
}

// Implement Serialize for the error type (needed for Tauri)
impl serde::Serialize for SearchError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl SearchState {
    pub fn save(&self) -> Result<(), SearchError> {
        save_items_to_disk(self)
    }

    pub fn batch_index(&self, items: Vec<SearchableItem>) -> Result<(), SearchError> {
        let mut guard = self.items.lock().map_err(|_| SearchError::LockError)?;
        for item in items {
            let id = item.id().to_string();
            guard.retain(|e| e.id() != id);
            guard.push(item);
        }
        drop(guard);
        self.save()
    }

    pub fn index_one(&self, item: SearchableItem) -> Result<(), SearchError> {
        let id = match &item {
            SearchableItem::Application(app) => {
                if app.id.is_empty() || !app.id.starts_with("app_") {
                    return Err(SearchError::Other("Application ID is invalid".to_string()));
                }
                app.id.clone()
            }
            SearchableItem::Command(cmd) => {
                if cmd.id.is_empty() || !cmd.id.starts_with("cmd_") {
                    return Err(SearchError::Other("Command ID is invalid".to_string()));
                }
                cmd.id.clone()
            }
        };
        let mut guard = self.items.lock().map_err(|_| SearchError::LockError)?;
        guard.retain(|e| e.id() != id);
        guard.push(item);
        drop(guard);
        self.save()
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchResult>, SearchError> {
        let trimmed = query.trim();
        let guard = self.items.lock().map_err(|_| SearchError::LockError)?;
        let limit = 20;
        let mut results: Vec<SearchResult> = Vec::new();

        if trimmed.is_empty() {
            let mut sorted: Vec<&SearchableItem> = guard.iter().collect();
            sorted.sort_unstable_by(|a, b| {
                b.usage_count().cmp(&a.usage_count())
                    .then_with(|| a.get_name().cmp(b.get_name()))
            });
            for item in sorted.into_iter().take(limit) {
                results.push(SearchResult {
                    object_id: item.id().to_string(),
                    name: item.get_name().to_string(),
                    result_type: item.get_type_str().to_string(),
                    score: item.usage_count() as f32,
                    path: match item {
                        SearchableItem::Application(app) => Some(app.path.clone()),
                        SearchableItem::Command(_) => None,
                    },
                    icon: match item {
                        SearchableItem::Application(app) => app.icon.clone(),
                        SearchableItem::Command(cmd) => cmd.icon.clone(),
                    },
                    extension_id: match item {
                        SearchableItem::Application(_) => None,
                        SearchableItem::Command(cmd) => Some(cmd.extension.clone()),
                    },
                });
            }
        } else {
            let matcher = SkimMatcherV2::default();
            let mut scored: Vec<(i64, u32, &SearchableItem)> = guard
                .iter()
                .filter_map(|item| {
                    matcher.fuzzy_match(item.get_name(), trimmed)
                        .map(|score| (score, item.usage_count(), item))
                })
                .collect();
            scored.sort_unstable_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));

            let mut seen = HashSet::new();
            for (score, _, item) in scored.into_iter().take(limit) {
                if seen.insert(item.id().to_string()) {
                    results.push(SearchResult {
                        object_id: item.id().to_string(),
                        name: item.get_name().to_string(),
                        result_type: item.get_type_str().to_string(),
                        score: score as f32,
                        path: match item {
                            SearchableItem::Application(app) => Some(app.path.clone()),
                            SearchableItem::Command(_) => None,
                        },
                        icon: match item {
                            SearchableItem::Application(app) => app.icon.clone(),
                            SearchableItem::Command(cmd) => cmd.icon.clone(),
                        },
                        extension_id: match item {
                            SearchableItem::Application(_) => None,
                            SearchableItem::Command(cmd) => Some(cmd.extension.clone()),
                        },
                    });
                }
            }
        }
        Ok(results)
    }

    pub fn record_usage(&self, object_id: &str) -> Result<(), SearchError> {
        let mut guard = self.items.lock().map_err(|_| SearchError::LockError)?;
        let mut found = false;
        for item in guard.iter_mut() {
            if item.id() == object_id {
                match item {
                    SearchableItem::Application(app) => app.usage_count += 1,
                    SearchableItem::Command(cmd) => cmd.usage_count += 1,
                }
                found = true;
                break;
            }
        }
        drop(guard);
        if found { self.save()?; }
        Ok(())
    }

    pub fn all_ids(&self) -> Result<HashSet<String>, SearchError> {
        let guard = self.items.lock().map_err(|_| SearchError::LockError)?;
        Ok(guard.iter().map(|item| item.id().to_string()).collect())
    }

    pub fn delete(&self, object_id: &str) -> Result<(), SearchError> {
        let mut guard = self.items.lock().map_err(|_| SearchError::LockError)?;
        let before = guard.len();
        guard.retain(|item| item.id() != object_id);
        let deleted = guard.len() < before;
        drop(guard);
        if deleted { self.save()?; }
        Ok(())
    }

    pub fn reset(&self, icon_cache_dir: Option<std::path::PathBuf>) -> Result<(), SearchError> {
        let mut guard = self.items.lock().map_err(|_| SearchError::LockError)?;
        guard.clear();
        drop(guard);
        self.save()?;
        if let Some(cache) = icon_cache_dir {
            if cache.exists() { let _ = std::fs::remove_dir_all(cache); }
        }
        Ok(())
    }
}

#[cfg(test)]
mod service_tests {
    use super::*;
    use models::{Application, Command};
    use std::sync::Mutex;

    fn make_state() -> SearchState {
        SearchState {
            items: Mutex::new(vec![]),
            persistence_path: std::env::temp_dir().join(
                format!("asyar_test_{}.json",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos())
            ),
        }
    }

    fn app(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Application(Application {
            id: id.to_string(), name: name.to_string(),
            path: format!("/Applications/{}.app", name),
            usage_count: usage, icon: None,
        })
    }

    fn cmd(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Command(Command {
            id: id.to_string(), name: name.to_string(),
            extension: "test".to_string(), trigger: name.to_lowercase(),
            command_type: "command".to_string(), usage_count: usage, icon: None,
        })
    }

    #[test]
    fn test_index_one_rejects_bad_app_prefix() {
        let state = make_state();
        assert!(state.index_one(app("bad_id", "Bad", 0)).is_err());
    }

    #[test]
    fn test_index_one_rejects_bad_cmd_prefix() {
        let state = make_state();
        assert!(state.index_one(cmd("bad_cmd", "Bad", 0)).is_err());
    }

    #[test]
    fn test_index_one_replaces_duplicate() {
        let state = make_state();
        state.index_one(app("app_safari", "Safari", 0)).unwrap();
        state.index_one(app("app_safari", "Safari Updated", 1)).unwrap();
        assert_eq!(state.all_ids().unwrap().len(), 1);
    }

    #[test]
    fn test_search_empty_returns_by_usage() {
        let state = make_state();
        state.index_one(app("app_a", "Alpha", 5)).unwrap();
        state.index_one(app("app_b", "Beta", 10)).unwrap();
        let results = state.search("").unwrap();
        assert_eq!(results[0].name, "Beta");
    }

    #[test]
    fn test_search_fuzzy_finds_match() {
        let state = make_state();
        state.index_one(app("app_safari", "Safari", 0)).unwrap();
        let results = state.search("saf").unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].name, "Safari");
    }

    #[test]
    fn test_delete_removes_item() {
        let state = make_state();
        state.index_one(app("app_arc", "Arc", 0)).unwrap();
        state.delete("app_arc").unwrap();
        assert!(state.all_ids().unwrap().is_empty());
    }

    #[test]
    fn test_record_usage_increments() {
        let state = make_state();
        state.index_one(app("app_chrome", "Chrome", 0)).unwrap();
        state.record_usage("app_chrome").unwrap();
        // Verify by checking empty-query result puts it first (score = usage_count)
        let by_usage = state.search("").unwrap();
        assert_eq!(by_usage[0].name, "Chrome");
        assert_eq!(by_usage[0].score, 1.0);
    }

    #[test]
    fn test_batch_index_deduplicates() {
        let state = make_state();
        state.batch_index(vec![
            app("app_x", "X", 0),
            app("app_x", "X v2", 1),
        ]).unwrap();
        assert_eq!(state.all_ids().unwrap().len(), 1);
    }
}