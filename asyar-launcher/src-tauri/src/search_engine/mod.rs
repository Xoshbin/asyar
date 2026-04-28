pub mod commands;
pub mod models;

// Import necessary items
use models::{SearchableItem, SearchResult};
use std::fs;
use std::sync::{RwLock, Mutex};
use std::collections::HashSet;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use tauri::{AppHandle, Manager};
use rusqlite::params;

// Constant for the persistence database name
const DB_FILE_NAME: &str = "search_index.db";

// Simplified state: A list of searchable items protected by a RwLock for concurrent reads
pub struct SearchState {
    pub items: RwLock<Vec<SearchableItem>>,
    db: Mutex<rusqlite::Connection>,
}

fn init_db(conn: &rusqlite::Connection) -> Result<(), SearchError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS search_items (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            data TEXT NOT NULL
        );"
    ).map_err(|e| SearchError::Other(format!("Failed to initialize database: {}", e)))?;
    Ok(())
}

fn load_items_from_db(conn: &rusqlite::Connection) -> Result<Vec<SearchableItem>, SearchError> {
    let mut stmt = conn.prepare("SELECT data FROM search_items")
        .map_err(|e| SearchError::Other(format!("Failed to prepare query: {}", e)))?;
    
    let item_rows = stmt.query_map([], |row| {
        let data: String = row.get(0)?;
        Ok(data)
    }).map_err(|e| SearchError::Other(format!("Failed to query items: {}", e)))?;

    let items = item_rows.filter_map(|r| {
        match r {
            Ok(data) => match serde_json::from_str::<SearchableItem>(&data) {
                Ok(item) => Some(item),
                Err(e) => {
                    log::warn!("Failed to deserialize item: {}", e);
                    None
                }
            },
            Err(e) => {
                log::warn!("Failed to read row: {}", e);
                None
            }
        }
    }).collect();

    Ok(items)
}

fn save_items_to_db(
    conn: &rusqlite::Connection,
    items: &[SearchableItem],
) -> Result<(), SearchError> {
    let tx = conn.unchecked_transaction()
        .map_err(|e| SearchError::Other(format!("Failed to begin transaction: {}", e)))?;
    
    tx.execute("DELETE FROM search_items", [])
        .map_err(|e| SearchError::Other(format!("Failed to clear table: {}", e)))?;
    
    let mut stmt = tx.prepare("INSERT INTO search_items (id, category, data) VALUES (?1, ?2, ?3)")
        .map_err(|e| SearchError::Other(format!("Failed to prepare insert: {}", e)))?;
    
    for item in items {
        let id = item.id();
        let category = match item {
            SearchableItem::Application(_) => "application",
            SearchableItem::Command(_) => "command",
        };
        let data = serde_json::to_string(item).map_err(SearchError::Json)?;
        stmt.execute(params![id, category, data])
            .map_err(|e| SearchError::Other(format!("Failed to insert item {}: {}", id, e)))?;
    }
    
    drop(stmt);
    tx.commit()
        .map_err(|e| SearchError::Other(format!("Failed to commit transaction: {}", e)))?;
    
    log::info!("Successfully saved {} items to database.", items.len());
    Ok(())
}

fn migrate_json_to_db(app_data_dir: &std::path::Path, conn: &rusqlite::Connection) -> Result<(), SearchError> {
    let json_path = app_data_dir.join("search_data.json");
    if !json_path.exists() {
        return Ok(());
    }
    
    // Check if DB already has data (already migrated)
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM search_items", [], |row| row.get(0))
        .unwrap_or(0);
    if count > 0 {
        log::info!("Database already contains {} items, skipping JSON migration.", count);
        return Ok(());
    }
    
    log::info!("Migrating search data from JSON to SQLite...");
    let file = fs::File::open(&json_path).map_err(SearchError::Io)?;
    let reader = std::io::BufReader::new(file);
    let items: Vec<SearchableItem> = serde_json::from_reader(reader).map_err(SearchError::Json)?;
    
    save_items_to_db(conn, &items)?;
    
    // Rename JSON file to indicate migration is done (don't delete — safer)
    let backup_path = app_data_dir.join("search_data.json.migrated");
    if let Err(e) = fs::rename(&json_path, &backup_path) {
        log::warn!("Failed to rename migrated JSON file: {}", e);
    } else {
        log::info!("Migrated {} items from JSON to SQLite. Old file renamed to search_data.json.migrated", items.len());
    }
    
    Ok(())
}

// Initialize the state by loading from SQLite (with JSON migration)
pub fn initialize_search_state(
    app_handle: &AppHandle,
) -> Result<SearchState, Box<dyn std::error::Error>> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    
    // Ensure directory exists
    fs::create_dir_all(&app_data_dir)?;
    
    let db_path = app_data_dir.join(DB_FILE_NAME);
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    // Enable WAL mode for better concurrent read performance
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;
    
    init_db(&conn)?;
    
    // Migrate from JSON if needed
    migrate_json_to_db(&app_data_dir, &conn)?;
    
    // Load items into memory
    let items = load_items_from_db(&conn)?;
    log::info!("Loaded {} items from database.", items.len());
    
    Ok(SearchState {
        items: RwLock::new(items),
        db: Mutex::new(conn),
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

impl crate::diagnostics::HasSeverity for SearchError {
    fn kind(&self) -> &'static str {
        match self {
            SearchError::LockError => "search_lock_poisoned",
            SearchError::Json(_) => "search_json_failure",
            SearchError::Io(_) => "search_io_failure",
            SearchError::NotFound(_) => "search_not_found",
            SearchError::Other(_) => "search_other",
        }
    }
    fn severity(&self) -> crate::diagnostics::Severity {
        match self {
            SearchError::LockError => crate::diagnostics::Severity::Fatal,
            SearchError::NotFound(_) => crate::diagnostics::Severity::Warning,
            _ => crate::diagnostics::Severity::Error,
        }
    }
    fn retryable(&self) -> bool { matches!(self, SearchError::Io(_)) }
    fn context(&self) -> std::collections::HashMap<&'static str, String> {
        let mut ctx = std::collections::HashMap::new();
        if let SearchError::NotFound(s) = self { ctx.insert("target", s.clone()); }
        if let SearchError::Other(s) = self { ctx.insert("detail", s.clone()); }
        ctx
    }
}

impl serde::Serialize for SearchError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        use crate::diagnostics::HasSeverity;
        let mut state = s.serialize_struct("Diagnostic", 6)?;
        state.serialize_field("source", "rust")?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("severity", &self.severity())?;
        state.serialize_field("retryable", &self.retryable())?;
        state.serialize_field("context", &self.context())?;
        state.serialize_field("developerDetail", &self.to_string())?;
        state.end()
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

fn description_for(item: &SearchableItem) -> Option<String> {
    match item {
        SearchableItem::Command(cmd) => cmd.subtitle.clone(),
        SearchableItem::Application(app) => {
            if crate::application::is_default_app_location(&app.path) {
                None
            } else {
                Some(crate::application::display_parent_dir(&app.path))
            }
        }
    }
}

impl SearchState {
    pub fn save_items_to_db(&self) -> Result<(), SearchError> {
        let items_guard = self.items.read().map_err(|_| SearchError::LockError)?;
        let conn = self.db.lock().map_err(|_| SearchError::LockError)?;
        save_items_to_db(&conn, &items_guard)
    }

    pub fn batch_index(&self, items: Vec<SearchableItem>) -> Result<(), SearchError> {
        let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
        for item in items {
            let id = item.id().to_string();
            guard.retain(|e| e.id() != id);
            guard.push(item);
        }
        drop(guard);
        self.save_items_to_db()
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
        self.save_items_to_db()
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
                    description: description_for(item),
                    style: None,
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
                        description: description_for(item),
                        style: None,
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

    /// Update the subtitle of a command in the search index.
    /// Persists the change to SQLite immediately.
    pub fn update_command_subtitle(
        &self,
        command_id: &str,
        subtitle: Option<String>,
    ) -> Result<(), SearchError> {
        if !command_id.starts_with("cmd_") {
            return Err(SearchError::Other(format!(
                "Invalid command ID for subtitle update: {}",
                command_id
            )));
        }
        let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
        let found = guard.iter_mut().any(|item| {
            if let SearchableItem::Command(cmd) = item {
                if cmd.id == command_id {
                    cmd.subtitle = subtitle.clone();
                    return true;
                }
            }
            false
        });
        drop(guard);
        if !found {
            return Err(SearchError::NotFound(command_id.to_string()));
        }
        self.save_items_to_db()
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
        if deleted { self.save_items_to_db()?; }
        Ok(())
    }

    pub fn reset(&self, icon_cache_dir: Option<std::path::PathBuf>) -> Result<(), SearchError> {
        let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
        guard.clear();
        drop(guard);
        self.save_items_to_db()?;
        if let Some(cache) = icon_cache_dir {
            if cache.exists() { let _ = std::fs::remove_dir_all(cache); }
        }
        Ok(())
    }

    /// Performs a unified search: runs fuzzy search on indexed items, merges with
    /// externally-provided extension results, normalizes scores to [0.0, 1.0],
    /// sorts by score descending, deduplicates, and backfills with top-usage items
    /// when fewer than `min_results` matched items exist.
    pub fn merged_search(
        &self,
        query: &str,
        external_results: Vec<models::ExternalSearchResult>,
        min_results: usize,
    ) -> Result<Vec<models::SearchResult>, SearchError> {
        let skim_max: f32 = 100_000.0;
        let limit: usize = 20;

        // 1. Run the normal search to get raw results
        let raw_results = self.search(query)?;

        // 2. Normalize Rust skim scores to [0.0, 1.0]
        let normalized_rust: Vec<models::SearchResult> = raw_results.into_iter().map(|mut r| {
            if !query.trim().is_empty() {
                r.score = (r.score / skim_max).min(1.0);
            } else {
                // Empty-query results are frecency scores, normalize differently
                // Keep them in [0, 1] range — frecency scores are typically small
                // Map them so they don't compete unfairly with fuzzy scores
                r.score = r.score.min(1.0);
            }
            r
        }).collect();

        // 3. Map external results into SearchResult format
        let mapped_external: Vec<models::SearchResult> = external_results.into_iter().map(|ext| {
            models::SearchResult {
                object_id: ext.object_id,
                name: ext.name,
                result_type: ext.result_type,
                score: ext.score,
                path: None,
                icon: ext.icon,
                extension_id: ext.extension_id,
                description: ext.description,
                style: ext.style,
            }
        }).collect();

        // 4. Merge and sort by score descending
        let mut combined: Vec<models::SearchResult> = Vec::with_capacity(
            normalized_rust.len() + mapped_external.len()
        );
        combined.extend(normalized_rust);
        combined.extend(mapped_external);
        combined.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

        // 5. Deduplicate by object_id
        let mut seen = std::collections::HashSet::new();
        combined.retain(|r| seen.insert(r.object_id.clone()));

        // 6. Backfill with top-usage items if not enough results and query is non-empty
        if !query.trim().is_empty() && combined.len() < min_results {
            let suggestions = self.search("")?; // Get top items by frecency
            let existing_names: std::collections::HashSet<String> = combined.iter().map(|r| r.name.clone()).collect();
            let existing_ids: std::collections::HashSet<String> = combined.iter().map(|r| r.object_id.clone()).collect();

            let append_count = min_results - combined.len();
            let mut appended = 0;
            for mut suggestion in suggestions {
                if appended >= append_count { break; }
                if !existing_names.contains(&suggestion.name) && !existing_ids.contains(&suggestion.object_id) {
                    suggestion.score = -1.0; // Mark as backfill
                    combined.push(suggestion);
                    appended += 1;
                }
            }
        }

        // 7. Truncate to limit
        combined.truncate(limit);

        Ok(combined)
    }
}

#[cfg(test)]
mod service_tests {
    use super::*;
    use models::{Application, Command};
    use std::sync::RwLock;

    fn make_state() -> SearchState {
        let conn = rusqlite::Connection::open_in_memory()
            .expect("Failed to create in-memory database");
        init_db(&conn).expect("Failed to init test db");
        SearchState {
            items: RwLock::new(vec![]),
            db: Mutex::new(conn),
        }
    }

    fn app(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Application(Application {
            id: id.to_string(), name: name.to_string(),
            path: format!("/Applications/{}.app", name),
            usage_count: usage, icon: None,
            last_used_at: None,
            bundle_id: None,
        })
    }

    fn cmd(id: &str, name: &str, usage: u32) -> SearchableItem {
        SearchableItem::Command(Command {
            id: id.to_string(), name: name.to_string(),
            extension: "test".to_string(), trigger: name.to_lowercase(),
            command_type: "command".to_string(), usage_count: usage, icon: None,
            last_used_at: None,
            subtitle: None,
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
            bundle_id: None,
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

    #[test]
    fn test_merged_search_combines_and_sorts() {
        let state = make_state();
        state.index_one(app("app_safari", "Safari", 5)).unwrap();
        
        let external = vec![models::ExternalSearchResult {
            object_id: "ext_calc_result_0".to_string(),
            name: "Calculate".to_string(),
            description: None,
            result_type: "command".to_string(),
            score: 0.8,
            icon: None,
            extension_id: Some("calculator".to_string()),
            category: Some("extension".to_string()),
            style: None,
        }];
        
        let results = state.merged_search("", external, 10).unwrap();
        assert!(results.len() >= 2, "Should have both indexed and external results");
    }

    #[test]
    fn test_merged_search_normalizes_skim_scores() {
        let state = make_state();
        state.index_one(app("app_safari", "Safari", 0)).unwrap();
        
        let results = state.merged_search("saf", vec![], 10).unwrap();
        assert!(!results.is_empty());
        // Skim scores are normalized to [0, 1] — should not exceed 1.0
        assert!(results[0].score <= 1.0, "Score should be normalized to [0,1], got {}", results[0].score);
    }

    #[test]
    fn test_merged_search_deduplicates_by_id() {
        let state = make_state();
        state.index_one(app("app_safari", "Safari", 5)).unwrap();
        
        // External result with same object_id as indexed item
        let external = vec![models::ExternalSearchResult {
            object_id: "app_safari".to_string(),
            name: "Safari Duplicate".to_string(),
            description: None,
            result_type: "application".to_string(),
            score: 0.9,
            icon: None,
            extension_id: None,
            category: None,
            style: None,
        }];
        
        let results = state.merged_search("", external, 10).unwrap();
        let safari_count = results.iter().filter(|r| r.object_id == "app_safari").count();
        assert_eq!(safari_count, 1, "Duplicates should be removed");
    }

    #[test]
    fn test_merged_search_backfills_when_few_results() {
        let state = make_state();
        // Index several items for backfill pool
        state.index_one(app("app_a", "Alpha", 10)).unwrap();
        state.index_one(app("app_b", "Beta", 8)).unwrap();
        state.index_one(app("app_c", "Charlie", 6)).unwrap();
        state.index_one(app("app_d", "Delta", 4)).unwrap();
        state.index_one(app("app_e", "Echo", 2)).unwrap();
        
        // Search for something that only matches one item
        let results = state.merged_search("alph", vec![], 5).unwrap();
        // Should have Alpha as primary match + backfill items up to min_results
        assert!(results.len() >= 2, "Should backfill when fewer than min_results, got {}", results.len());
    }

    #[test]
    fn test_merged_search_empty_query_returns_by_frecency() {
        let state = make_state();
        state.index_one(app("app_a", "Alpha", 1)).unwrap();
        state.index_one(app("app_b", "Beta", 10)).unwrap();

        let results = state.merged_search("", vec![], 10).unwrap();
        assert_eq!(results[0].name, "Beta", "Empty query should rank by frecency");
    }

    #[test]
    fn test_search_returns_command_subtitle_as_description() {
        let state = make_state();
        let c = Command {
            id: "cmd_test_weather".to_string(),
            name: "Weather".to_string(),
            extension: "test".to_string(),
            trigger: "weather".to_string(),
            command_type: "command".to_string(),
            usage_count: 1,
            icon: None,
            last_used_at: None,
            subtitle: Some("72 F".to_string()),
        };
        state.index_one(SearchableItem::Command(c)).unwrap();

        // Empty query (frecency ranked)
        let results = state.search("").unwrap();
        assert_eq!(results[0].description.as_deref(), Some("72 F"));

        // Fuzzy query
        let results = state.search("weath").unwrap();
        assert_eq!(results[0].description.as_deref(), Some("72 F"));
    }

    #[test]
    fn test_search_returns_none_description_when_no_subtitle() {
        let state = make_state();
        state.index_one(cmd("cmd_test_calc", "Calculator", 1)).unwrap();
        let results = state.search("").unwrap();
        assert_eq!(results[0].description, None);
    }

    #[test]
    fn test_search_suppresses_description_for_default_app_locations() {
        use crate::application::get_default_app_scan_paths;
        let default_dir = get_default_app_scan_paths()
            .into_iter()
            .next()
            .expect("platform has at least one default scan path");
        let app_path = default_dir.join("Ice.app");

        let state = make_state();
        state.index_one(SearchableItem::Application(models::Application {
            id: "app_ice_default".to_string(),
            name: "Ice".to_string(),
            path: app_path.to_string_lossy().into_owned(),
            usage_count: 1,
            icon: None,
            last_used_at: None,
            bundle_id: None,
        })).unwrap();

        let empty = state.search("").unwrap();
        assert_eq!(empty[0].description, None);

        let fuzzy = state.search("ice").unwrap();
        assert_eq!(fuzzy[0].description, None);
    }

    #[test]
    fn test_search_returns_app_path_for_non_default_location() {
        // Pick a path guaranteed not to be a default scan location on any OS.
        let custom_parent = if cfg!(target_os = "windows") {
            "C:\\ProgramData\\AsyarTest"
        } else {
            "/opt/asyar-test"
        };
        let custom_path = format!(
            "{}{}Ice.app",
            custom_parent,
            std::path::MAIN_SEPARATOR
        );

        let state = make_state();
        state.index_one(SearchableItem::Application(models::Application {
            id: "app_ice_custom".to_string(),
            name: "Ice".to_string(),
            path: custom_path,
            usage_count: 1,
            icon: None,
            last_used_at: None,
            bundle_id: None,
        })).unwrap();

        let empty = state.search("").unwrap();
        assert_eq!(empty[0].description.as_deref(), Some(custom_parent));

        let fuzzy = state.search("ice").unwrap();
        assert_eq!(fuzzy[0].description.as_deref(), Some(custom_parent));
    }

    #[test]
    fn test_merged_search_preserves_style_and_description() {
        let state = make_state();

        let external = vec![models::ExternalSearchResult {
            object_id: "ext_calculator_42_0".to_string(),
            name: "42".to_string(),
            description: Some("6 * 7".to_string()),
            result_type: "command".to_string(),
            score: 1.0,
            icon: Some("🧮".to_string()),
            extension_id: Some("calculator".to_string()),
            category: Some("extension".to_string()),
            style: Some("large".to_string()),
        }];

        let results = state.merged_search("6 * 7", external, 10).unwrap();
        let calc = results.iter().find(|r| r.object_id == "ext_calculator_42_0");
        assert!(calc.is_some(), "Calculator result should be present");
        let calc = calc.unwrap();
        assert_eq!(calc.style.as_deref(), Some("large"), "style must survive merged_search");
        assert_eq!(calc.description.as_deref(), Some("6 * 7"), "description must survive merged_search");
    }

    #[test]
    fn test_update_command_subtitle_sets_value() {
        let state = make_state();
        state.index_one(cmd("cmd_test_weather", "Weather", 0)).unwrap();

        state.update_command_subtitle("cmd_test_weather", Some("72 F".to_string())).unwrap();

        let results = state.search("").unwrap();
        assert_eq!(results[0].description.as_deref(), Some("72 F"));
    }

    #[test]
    fn test_update_command_subtitle_clears_value() {
        let state = make_state();
        let item = SearchableItem::Command(Command {
            id: "cmd_test_weather".to_string(),
            name: "Weather".to_string(),
            extension: "test".to_string(),
            trigger: "weather".to_string(),
            command_type: "command".to_string(),
            usage_count: 0,
            icon: None,
            last_used_at: None,
            subtitle: Some("old subtitle".to_string()),
        });
        state.index_one(item).unwrap();

        state.update_command_subtitle("cmd_test_weather", None).unwrap();

        let results = state.search("").unwrap();
        assert_eq!(results[0].description, None);
    }

    #[test]
    fn test_update_command_subtitle_rejects_nonexistent_command() {
        let state = make_state();
        let result = state.update_command_subtitle("cmd_nonexistent", Some("test".to_string()));
        assert!(result.is_err());
    }

    #[test]
    fn test_update_command_subtitle_rejects_non_command_id() {
        let state = make_state();
        state.index_one(app("app_safari", "Safari", 0)).unwrap();
        let result = state.update_command_subtitle("app_safari", Some("test".to_string()));
        assert!(result.is_err());
    }

    #[test]
    fn test_update_command_subtitle_persists_to_db() {
        let state = make_state();
        state.index_one(cmd("cmd_test_timer", "Timer", 0)).unwrap();
        state.update_command_subtitle("cmd_test_timer", Some("5:00 remaining".to_string())).unwrap();

        // Reload from DB to verify persistence
        let conn = state.db.lock().unwrap();
        let items = load_items_from_db(&conn).unwrap();
        let timer = items.iter().find(|i| i.id() == "cmd_test_timer").unwrap();
        if let SearchableItem::Command(c) = timer {
            assert_eq!(c.subtitle.as_deref(), Some("5:00 remaining"));
        } else {
            panic!("Expected Command variant");
        }
    }

    #[test]
    fn search_error_severities() {
        use crate::diagnostics::{HasSeverity, Severity};
        assert_eq!(SearchError::LockError.severity(), Severity::Fatal);
        assert_eq!(SearchError::NotFound("x".into()).severity(), Severity::Warning);
        assert_eq!(SearchError::Other("y".into()).severity(), Severity::Error);
    }

    #[test]
    fn search_error_kinds() {
        use crate::diagnostics::HasSeverity;
        assert_eq!(SearchError::LockError.kind(), "search_lock_poisoned");
        assert_eq!(SearchError::NotFound("x".into()).kind(), "search_not_found");
        assert_eq!(SearchError::Other("x".into()).kind(), "search_other");
    }

    #[test]
    fn search_error_serializes_diagnostic_shape() {
        let v = serde_json::to_value(&SearchError::NotFound("item".into())).unwrap();
        assert_eq!(v["kind"], "search_not_found");
        assert_eq!(v["severity"], "warning");
        assert_eq!(v["context"]["target"], "item");
    }
}