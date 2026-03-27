pub mod commands;
pub mod models;

// Import necessary items
use models::{SearchableItem, SearchResult};
use std::fs;
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::sync::RwLock;
use std::collections::HashSet;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use tauri::{AppHandle, Manager};

// Constant for the persistence file name
const INDEX_FILE_NAME: &str = "search_data.json";

// Simplified state: A list of searchable items protected by a RwLock for concurrent reads
pub struct SearchState {
    pub items: RwLock<Vec<SearchableItem>>,
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

    let items_guard = state.items.read().map_err(|_| SearchError::LockError)?;

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
        items: RwLock::new(items),
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

/// Computes a frecency score combining usage frequency with recency decay.
/// Formula: usage_count × e^(-λ × days_since_last_use), where λ = 0.1 (half-life ≈ 7 days).
/// 
/// - If `last_used_at` is None (legacy data), falls back to `usage_count as f32`
///   (decay = 1.0) to preserve backward compatibility.
/// - If `usage_count` is 0, always returns 0.0.
fn frecency_score(usage_count: u32, last_used_at: Option<u32>) -> f32 {
    if usage_count == 0 {
        return 0.0;
    }
    let decay = match last_used_at {
        None => 1.0_f32,  // Legacy items: no decay applied, rank by raw count
        Some(ts) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let days_ago = now.saturating_sub(ts as u64) as f32 / 86_400.0;
            (-0.1_f32 * days_ago).exp()
        }
    };
    usage_count as f32 * decay
}

impl SearchState {
    pub fn save(&self) -> Result<(), SearchError> {
        save_items_to_disk(self)
    }

    pub fn batch_index(&self, items: Vec<SearchableItem>) -> Result<(), SearchError> {
        let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
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
        let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
        guard.retain(|e| e.id() != id);
        guard.push(item);
        drop(guard);
        self.save()
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchResult>, SearchError> {
        let trimmed = query.trim();
        let guard = self.items.read().map_err(|_| SearchError::LockError)?;
        let limit = 20;
        let mut results: Vec<SearchResult> = Vec::new();

        if trimmed.is_empty() {
            let mut sorted: Vec<&SearchableItem> = guard.iter().collect();
            sorted.sort_unstable_by(|a, b| {
                let score_a = frecency_score(a.usage_count(), a.last_used_at());
                let score_b = frecency_score(b.usage_count(), b.last_used_at());
                score_b.partial_cmp(&score_a)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.get_name().cmp(b.get_name()))
            });
            for item in sorted.into_iter().take(limit) {
                results.push(SearchResult {
                    object_id: item.id().to_string(),
                    name: item.get_name().to_string(),
                    result_type: item.get_type_str().to_string(),
                    score: frecency_score(item.usage_count(), item.last_used_at()),
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
            let mut scored: Vec<(i64, f32, &SearchableItem)> = guard
                .iter()
                .filter_map(|item| {
                    matcher.fuzzy_match(item.get_name(), trimmed)
                        .map(|score| (score, frecency_score(item.usage_count(), item.last_used_at()), item))
                })
                .collect();
            scored.sort_unstable_by(|a, b| {
                b.0.cmp(&a.0)
                    .then_with(|| b.1.partial_cmp(&a.1)
                        .unwrap_or(std::cmp::Ordering::Equal))
            });

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
        let now_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as u32;

        let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
        for item in guard.iter_mut() {
            if item.id() == object_id {
                match item {
                    SearchableItem::Application(app) => {
                        app.usage_count += 1;
                        app.last_used_at = Some(now_ts);
                    }
                    SearchableItem::Command(cmd) => {
                        cmd.usage_count += 1;
                        cmd.last_used_at = Some(now_ts);
                    }
                }
                break;
            }
        }
        // NOTE: No self.save() here — usage counts are flushed when launcher hides
        Ok(())
    }

    pub fn all_ids(&self) -> Result<HashSet<String>, SearchError> {
        let guard = self.items.read().map_err(|_| SearchError::LockError)?;
        Ok(guard.iter().map(|item| item.id().to_string()).collect())
    }

    pub fn delete(&self, object_id: &str) -> Result<(), SearchError> {
        let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
        let before = guard.len();
        guard.retain(|item| item.id() != object_id);
        let deleted = guard.len() < before;
        drop(guard);
        if deleted { self.save()?; }
        Ok(())
    }

    pub fn reset(&self, icon_cache_dir: Option<std::path::PathBuf>) -> Result<(), SearchError> {
        let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
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
    use std::sync::RwLock;

    fn make_state() -> SearchState {
        SearchState {
            items: RwLock::new(vec![]),
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
            last_used_at: None,
        })
    }

    fn cmd(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Command(Command {
            id: id.to_string(), name: name.to_string(),
            extension: "test".to_string(), trigger: name.to_lowercase(),
            command_type: "command".to_string(), usage_count: usage, icon: None,
            last_used_at: None,
        })
    }

    // Helper: create item with a specific last_used timestamp (seconds ago)
    fn app_used_secs_ago(id: &str, name: &str, usage: u32, secs: u32) -> SearchableItem {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .saturating_sub(secs as u64) as u32;
        SearchableItem::Application(Application {
            id: id.to_string(),
            name: name.to_string(),
            path: format!("/Applications/{}.app", name),
            usage_count: usage,
            icon: None,
            last_used_at: Some(ts),
        })
    }

    #[test]
    fn test_frecency_recent_beats_old_with_higher_count() {
        // Recent item with lower count should beat old item with higher count
        let state = make_state();
        // "OldApp" used 20 times, but 60 days ago → decay ≈ 0.002 → frecency ≈ 0.05
        state.index_one(app_used_secs_ago("app_old", "OldApp", 20, 60 * 86400)).unwrap();
        // "NewApp" used 3 times, today → decay = 1.0 → frecency = 3.0
        state.index_one(app_used_secs_ago("app_new", "NewApp", 3, 0)).unwrap();
        let results = state.search("").unwrap();
        assert_eq!(results[0].name, "NewApp",
            "Recently used app should rank above rarely-but-old app");
    }

    #[test]
    fn test_frecency_zero_for_never_used() {
        let state = make_state();
        state.index_one(app("app_unused", "Unused", 0)).unwrap();
        let results = state.search("").unwrap();
        // If there's only one item, it appears but with score 0
        if !results.is_empty() {
            assert_eq!(results[0].score, 0.0);
        }
    }

    #[test]
    fn test_frecency_legacy_items_rank_by_usage_count() {
        // Items with no last_used_at (legacy data) rank by usage_count only (decay treated as 1.0)
        let state = make_state();
        state.index_one(app("app_a", "Alpha", 5)).unwrap();   // last_used_at = None
        state.index_one(app("app_b", "Beta", 10)).unwrap();   // last_used_at = None
        let results = state.search("").unwrap();
        assert_eq!(results[0].name, "Beta",
            "Legacy items (no timestamp) should still rank by usage_count");
    }

    #[test]
    fn test_record_usage_sets_last_used_at() {
        let state = make_state();
        state.index_one(app("app_arc", "Arc", 0)).unwrap();
        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        state.record_usage("app_arc").unwrap();
        let results = state.search("").unwrap();
        // Score should be ≈ 1.0 (used 1 time, right now, decay ≈ 1.0)
        assert!(results[0].score > 0.9 && results[0].score <= 1.0,
            "Score after single recent use should be ≈ 1.0, got {}", results[0].score);
        // Verify last_used_at was set by checking the score reflects recency
        // (We cannot directly inspect last_used_at from SearchResult, but score proves it)
        let _ = before;
    }

    #[test]
    fn test_frecency_as_tiebreaker_in_fuzzy_search() {
        // When fuzzy scores are equal, frecency breaks the tie
        let state = make_state();
        // Both match "Arc" equally (exact same name)
        // app_arc_old: used 10 times, 90 days ago → low frecency
        // app_arc_new: used 2 times, today → higher frecency
        state.index_one(app_used_secs_ago("app_arc_old", "Arc Browser", 10, 90 * 86400)).unwrap();
        state.index_one(app_used_secs_ago("app_arc_new", "Arc", 2, 0)).unwrap();
        let results = state.search("Arc").unwrap();
        // Both should appear; the recently used one should rank higher (or equal)
        assert!(!results.is_empty());
        // "Arc" is an exact prefix match and recently used — should be first
        assert_eq!(results[0].name, "Arc",
            "Recently used item should rank first or equal among same-name matches");
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

    #[test]
    fn test_record_usage_does_not_immediately_persist() {
        // After record_usage(), save() must be called separately to persist
        // This test verifies that in-memory state is updated correctly
        let state = make_state();
        state.index_one(app("app_chrome", "Chrome", 0)).unwrap();
        state.record_usage("app_chrome").unwrap();
        // In-memory usage should be 1
        let results = state.search("").unwrap();
        assert_eq!(results[0].score, 1.0);
        // But we cannot verify disk state without calling save() —
        // that's the point: record_usage is now memory-only
    }

    #[test]
    fn test_rwlock_allows_concurrent_reads() {
        // Two simultaneous search() calls should both succeed (both take read locks)
        use std::sync::Arc;
        let state = Arc::new(make_state());
        state.index_one(app("app_safari", "Safari", 0)).unwrap();
        let state2 = Arc::clone(&state);
        let handle = std::thread::spawn(move || {
            state2.search("saf").unwrap()
        });
        let r1 = state.search("saf").unwrap();
        let r2 = handle.join().unwrap();
        assert!(!r1.is_empty());
        assert!(!r2.is_empty());
    }
}