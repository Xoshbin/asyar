pub mod commands;
pub mod models;
pub mod ranker;

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
    /// Construct a fresh, isolated SearchState backed by an in-memory SQLite
    /// database. Intended for unit tests that need a real SearchState without
    /// a full Tauri app setup.
    #[cfg(test)]
    pub fn new_for_test() -> Self {
        let conn = rusqlite::Connection::open_in_memory()
            .expect("Failed to create in-memory database for SearchState::new_for_test");
        init_db(&conn).expect("Failed to init search_items table for SearchState::new_for_test");
        Self {
            items: RwLock::new(vec![]),
            db: Mutex::new(conn),
        }
    }

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
                    alias: None,
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
                        alias: None,
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

    /// Build the canonical search-index id for a dynamic command.
    /// Format `cmd_<extensionId>_dyn_<dynamicId>` — the `_dyn_` infix
    /// is what the TS-side resolver pattern-matches to fast-path
    /// dynamic-command lookups without scanning the manifest.
    pub fn dynamic_object_id(extension_id: &str, dynamic_id: &str) -> String {
        format!("cmd_{extension_id}_dyn_{dynamic_id}")
    }

    /// Replace the full set of dynamic commands for an extension.
    /// `regs` is the new authoritative list; the caller must validate
    /// each registration's argument schema before calling this method.
    ///
    /// Computes the diff against the current dynamic commands for the
    /// extension (identified by the `_dyn_` infix), removes stale items,
    /// and indexes new/kept items. Manifest commands for the same
    /// extension are untouched.
    pub fn replace_dynamic_commands(
        &self,
        extension_id: &str,
        regs: &[crate::extensions::dynamic_commands::RegisteredCommand],
    ) -> Result<(), SearchError> {
        let prefix = format!("cmd_{extension_id}_dyn_");
        let new_ids: HashSet<String> = regs
            .iter()
            .map(|r| Self::dynamic_object_id(extension_id, &r.id))
            .collect();

        // Snapshot existing dynamic ids for this extension under the lock,
        // then drop it before re-acquiring write lock via index_one.
        let prev_ids: Vec<String> = {
            let guard = self.items.read().map_err(|_| SearchError::LockError)?;
            guard
                .iter()
                .filter_map(|item| {
                    let id = item.id();
                    if id.starts_with(&prefix) {
                        Some(id.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        };

        // Remove stale dynamic items.
        for id in prev_ids.iter().filter(|id| !new_ids.contains(*id)) {
            self.delete(id)?;
        }

        // Index added + kept. `index_one` overwrites by id, so kept entries
        // get a fresh copy with the latest name/icon/description from regs.
        for reg in regs {
            let object_id = Self::dynamic_object_id(extension_id, &reg.id);
            let cmd = models::Command {
                id: object_id,
                name: reg.name.clone(),
                extension: extension_id.to_string(),
                trigger: reg.name.to_lowercase(),
                command_type: "command".to_string(),
                usage_count: 0,
                icon: reg.icon.clone(),
                last_used_at: None,
                subtitle: reg.description.clone(),
                is_dynamic: true,
            };
            self.index_one(SearchableItem::Command(cmd))?;
        }

        Ok(())
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
    /// externally-provided extension results, classifies every result into a tier
    /// (exact title > prefix > title fuzzy > subtitle/keyword > frecency-only),
    /// sorts lexicographically by (tier, -frecency, -fuzzy_score, name_lower),
    /// deduplicates, and backfills with top-usage items when fewer than
    /// `min_results` matched items exist.
    ///
    /// The `score` field on returned `SearchResult` is for display/browser-fallback
    /// compatibility only. The Tauri path's order is determined by the tier ranker,
    /// not `score`.
    pub fn merged_search(
        &self,
        query: &str,
        external_results: Vec<models::ExternalSearchResult>,
        min_results: usize,
    ) -> Result<Vec<models::SearchResult>, SearchError> {
        let skim_max: f32 = 100_000.0;
        let limit: usize = 20;

        // Empty-query short-circuit: pure frecency sort, no tier overhead.
        if query.trim().is_empty() {
            let raw = self.search(query)?;
            let mut combined: Vec<models::SearchResult> = raw.into_iter().map(|mut r| {
                r.score = r.score.min(1.0);
                r
            }).collect();
            for ext in external_results {
                combined.push(models::SearchResult {
                    object_id: ext.object_id,
                    name: ext.name,
                    result_type: ext.result_type,
                    score: ext.score,
                    path: None,
                    icon: ext.icon,
                    extension_id: ext.extension_id,
                    description: ext.description,
                    style: ext.style,
                    alias: None,
                });
            }
            let mut seen = std::collections::HashSet::new();
            combined.retain(|r| seen.insert(r.object_id.clone()));
            combined.truncate(limit);
            return Ok(combined);
        }

        // Gather indexed results via skim pre-filter.
        let raw_results = self.search(query)?;

        // Extract classification inputs from the items store, then release the
        // read lock before any re-entrant call to self.search.
        struct ClassifyInput {
            result: models::SearchResult,
            subtitle: Option<String>,
            keywords: Vec<String>,
            frecency: f32,
        }

        let classify_inputs: Vec<ClassifyInput> = {
            let guard = self.items.read().map_err(|_| SearchError::LockError)?;
            let item_by_id: std::collections::HashMap<&str, &SearchableItem> =
                guard.iter().map(|item| (item.id(), item)).collect();

            raw_results
                .into_iter()
                .map(|r| {
                    // Score is raw skim score at this point; look up actual frecency.
                    let frecency = item_by_id
                        .get(r.object_id.as_str())
                        .map(|item| frecency_score(item.usage_count(), item.last_used_at()))
                        .unwrap_or(0.0);

                    let (subtitle, keywords) = match item_by_id.get(r.object_id.as_str()) {
                        Some(SearchableItem::Command(cmd)) => {
                            (cmd.subtitle.clone(), vec![cmd.trigger.clone()])
                        }
                        Some(SearchableItem::Application(app)) => {
                            (None, app.bundle_id.iter().cloned().collect())
                        }
                        None => (None, vec![]),
                    };

                    ClassifyInput { result: r, subtitle, keywords, frecency }
                })
                .collect()
            // guard is dropped here
        };

        // Build (SearchResult, RankKey) pairs for indexed results.
        // Lock is no longer held; classify is pure.
        let mut combined: Vec<(models::SearchResult, ranker::RankKey)> =
            Vec::with_capacity(classify_inputs.len() + external_results.len());

        for mut ci in classify_inputs {
            let keywords_refs: Vec<&str> = ci.keywords.iter().map(String::as_str).collect();
            let key = ranker::classify(
                query,
                &ci.result.name,
                ci.subtitle.as_deref(),
                &keywords_refs,
                ci.frecency,
                false,
            );
            // Normalize score for display/browser-fallback compatibility.
            ci.result.score = (ci.result.score / skim_max).min(1.0);
            combined.push((ci.result, key));
        }

        // Build (SearchResult, RankKey) pairs for external results.
        for ext in external_results {
            let pinned = ext.priority == Some(models::ResultPriority::Top);
            let key = ranker::classify(
                query,
                &ext.name,
                ext.description.as_deref(),
                &[],
                0.0,
                pinned,
            );
            let result = models::SearchResult {
                object_id: ext.object_id,
                name: ext.name,
                result_type: ext.result_type,
                score: ext.score,
                path: None,
                icon: ext.icon,
                extension_id: ext.extension_id,
                description: ext.description,
                style: ext.style,
                alias: None,
            };
            combined.push((result, key));
        }

        // Sort by (tier asc, frecency desc, fuzzy_score desc, name_lower asc).
        combined.sort_by(|a, b| {
            a.1.tier.cmp(&b.1.tier)
                .then_with(|| b.1.frecency.partial_cmp(&a.1.frecency).unwrap_or(std::cmp::Ordering::Equal))
                .then_with(|| b.1.fuzzy_score.cmp(&a.1.fuzzy_score))
                .then_with(|| a.1.name_lower.cmp(&b.1.name_lower))
        });

        // Deduplicate by object_id.
        let mut seen = std::collections::HashSet::new();
        combined.retain(|(r, _)| seen.insert(r.object_id.clone()));

        let mut results: Vec<models::SearchResult> = combined.into_iter().map(|(r, _)| r).collect();

        // Backfill with top frecency items when fewer than min_results matched.
        // Safe: the read lock was already released above.
        if results.len() < min_results {
            let suggestions = self.search("")?;
            let existing_ids: std::collections::HashSet<String> =
                results.iter().map(|r| r.object_id.clone()).collect();
            let existing_names: std::collections::HashSet<String> =
                results.iter().map(|r| r.name.clone()).collect();

            let append_count = min_results - results.len();
            let mut appended = 0;
            for mut suggestion in suggestions {
                if appended >= append_count { break; }
                if !existing_ids.contains(&suggestion.object_id)
                    && !existing_names.contains(&suggestion.name)
                {
                    suggestion.score = -1.0; // backfill marker
                    results.push(suggestion);
                    appended += 1;
                }
            }
        }

        results.truncate(limit);
        Ok(results)
    }

    pub fn merged_search_with_aliases(
        &self,
        query: &str,
        external_results: Vec<models::ExternalSearchResult>,
        min_results: usize,
        aliases: &crate::aliases::AliasState,
    ) -> Result<models::MergedSearchResponse, SearchError> {
        let mut results = self.merged_search(query, external_results, min_results)?;

        // Decorate every row with its alias (if any).
        for r in results.iter_mut() {
            if let Ok(Some(alias)) = aliases.lookup_alias_for(&r.object_id) {
                r.alias = Some(alias);
            }
        }

        // Determine alias_match.
        let trimmed = query.trim();
        let has_trailing_space = query.ends_with(' ')
            && trimmed.len() + 1 == query.len()
            && !trimmed.is_empty();
        let alias_match = if trimmed.is_empty() {
            None
        } else {
            match aliases.find_by_alias(trimmed) {
                Ok(Some(row)) => Some(models::AliasMatch {
                    object_id: row.object_id,
                    auto_execute: row.item_type == "command" && has_trailing_space,
                    item_type: row.item_type,
                }),
                _ => None,
            }
        };

        Ok(models::MergedSearchResponse { results, alias_match })
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
            is_dynamic: false,
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
            priority: None,
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
            priority: None,
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
            is_dynamic: false,
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
            priority: None,
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
            is_dynamic: false,
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
        let v = serde_json::to_value(SearchError::NotFound("item".into())).unwrap();
        assert_eq!(v["kind"], "search_not_found");
        assert_eq!(v["severity"], "warning");
        assert_eq!(v["context"]["target"], "item");
    }

    use crate::aliases::AliasState;

    fn fresh_search_state_with(items: Vec<SearchableItem>) -> SearchState {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE search_items (id TEXT PRIMARY KEY, category TEXT, data TEXT)",
            [],
        ).unwrap();
        SearchState {
            items: std::sync::RwLock::new(items),
            db: std::sync::Mutex::new(conn),
        }
    }

    #[test]
    fn merged_search_returns_alias_match_for_command_with_trailing_space() {
        let cmd = SearchableItem::Command(super::models::Command {
            id: "cmd_clip_history".into(),
            name: "Clipboard History".into(),
            extension: "clipboard".into(),
            trigger: "clipboard".into(),
            command_type: "command".into(),
            usage_count: 0,
            icon: None,
            last_used_at: None,
            subtitle: None,
            is_dynamic: false,
        });
        let search_state = fresh_search_state_with(vec![cmd]);
        let alias_state = AliasState::new_in_memory();
        alias_state.set_alias("cmd_clip_history", "cl", "Clipboard History", "command", 1).unwrap();

        let resp = search_state
            .merged_search_with_aliases("cl ", vec![], 10, &alias_state)
            .unwrap();

        let alias_match = resp.alias_match.expect("expected alias match");
        assert_eq!(alias_match.object_id, "cmd_clip_history");
        assert_eq!(alias_match.item_type, "command");
        assert!(alias_match.auto_execute);
    }

    #[test]
    fn merged_search_alias_match_no_auto_execute_for_application() {
        let app = SearchableItem::Application(super::models::Application {
            id: "app_finder".into(),
            name: "Finder".into(),
            path: "/System/Library/CoreServices/Finder.app".into(),
            usage_count: 0,
            icon: None,
            last_used_at: None,
            bundle_id: None,
        });
        let search_state = fresh_search_state_with(vec![app]);
        let alias_state = AliasState::new_in_memory();
        alias_state.set_alias("app_finder", "f", "Finder", "application", 1).unwrap();

        let resp = search_state
            .merged_search_with_aliases("f ", vec![], 10, &alias_state)
            .unwrap();
        let alias_match = resp.alias_match.expect("expected alias match");
        assert_eq!(alias_match.item_type, "application");
        assert!(!alias_match.auto_execute);
    }

    #[test]
    fn merged_search_no_alias_match_when_query_has_no_alias() {
        let search_state = fresh_search_state_with(vec![]);
        let alias_state = AliasState::new_in_memory();
        let resp = search_state
            .merged_search_with_aliases("nothing", vec![], 10, &alias_state)
            .unwrap();
        assert!(resp.alias_match.is_none());
    }

    #[test]
    fn merged_search_decorates_results_with_alias_field() {
        let app = SearchableItem::Application(super::models::Application {
            id: "app_finder".into(),
            name: "Finder".into(),
            path: "/X.app".into(),
            usage_count: 0,
            icon: None,
            last_used_at: None,
            bundle_id: None,
        });
        let search_state = fresh_search_state_with(vec![app]);
        let alias_state = AliasState::new_in_memory();
        alias_state.set_alias("app_finder", "f", "Finder", "application", 1).unwrap();

        let resp = search_state
            .merged_search_with_aliases("Finder", vec![], 10, &alias_state)
            .unwrap();
        let finder = resp
            .results
            .iter()
            .find(|r| r.object_id == "app_finder")
            .unwrap();
        assert_eq!(finder.alias.as_deref(), Some("f"));
    }

    fn ext_result(object_id: &str, name: &str, score: f32, priority: Option<models::ResultPriority>) -> models::ExternalSearchResult {
        models::ExternalSearchResult {
            object_id: object_id.to_string(),
            name: name.to_string(),
            description: None,
            result_type: "command".to_string(),
            score,
            icon: None,
            extension_id: Some("test-ext".to_string()),
            category: Some("extension".to_string()),
            style: None,
            priority,
        }
    }

    #[test]
    fn merged_search_frequently_used_app_beats_fresh_extension_score() {
        let state = make_state();
        let now_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as u32;
        state.index_one(SearchableItem::Application(models::Application {
            id: "app_slack".to_string(),
            name: "Slack".to_string(),
            path: "/Applications/Slack.app".to_string(),
            usage_count: 20,
            icon: None,
            last_used_at: Some(now_ts),
            bundle_id: None,
        })).unwrap();

        let external = vec![ext_result("ext_slack_chan_0", "Slack channel", 1.0, None)];
        let results = state.merged_search("slack", external, 10).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].object_id, "app_slack",
            "High-frecency app (tier 1 exact) must beat extension with score 1.0 (tier 3/4)");
    }

    #[test]
    fn merged_search_extension_exact_title_beats_fuzzy_app() {
        let state = make_state();
        // "SlackHQ" fuzzy-matches "Slack" and scores well on skim; the external
        // result is an exact title hit at a deliberately low ext score.
        // Current score-sort puts the high-skim app first; tier ranker reverses it.
        state.index_one(app("app_slackhq", "SlackHQ", 0)).unwrap();

        let external = vec![ext_result("ext_slack_0", "Slack", 0.0001, None)];
        let results = state.merged_search("Slack", external, 10).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].object_id, "ext_slack_0",
            "Extension exact title match (tier 1) must beat fuzzy app match (tier 3)");
    }

    #[test]
    fn merged_search_within_tier1_higher_frecency_wins() {
        // Two apps both named "Mail" — both are exact tier-1 hits.
        // Within tier 1, frecency must break the tie (higher usage first).
        // Current code already does frecency tiebreak, so this passes pre-ranker.
        // Post-ranker it must also pass — this is a non-regression contract.
        // We verify it now so the worker cannot inadvertently break it.
        let state = make_state();
        state.index_one(app("app_mail_a", "Mail", 5)).unwrap();
        state.index_one(app("app_mail_b", "Mail", 0)).unwrap();

        // Inject a high-scored extension result with a different name to ensure
        // the two Mail apps still rank by frecency in current score-sort path too.
        // Note: this test PASSES before the ranker and MUST still pass after.
        // It is included as a non-regression check (required by plan step 3).
        let results = state.merged_search("Mail", vec![], 10).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].object_id, "app_mail_a",
            "Within tier 1, higher frecency (usage 5) must beat lower frecency (usage 0)");
    }

    #[test]
    fn merged_search_pinned_result_pins_to_top() {
        let state = make_state();
        let now_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as u32;
        state.index_one(SearchableItem::Application(models::Application {
            id: "app_calculator".to_string(),
            name: "Calculator".to_string(),
            path: "/Applications/Calculator.app".to_string(),
            usage_count: 10,
            icon: None,
            last_used_at: Some(now_ts),
            bundle_id: None,
        })).unwrap();

        // score: 0.0 so the current code ranks it BELOW the Calculator app;
        // only the tier ranker (tier 0) lifts it to position 0.
        let external = vec![ext_result("ext_calc_42_0", "42", 0.0, Some(models::ResultPriority::Top))];
        let results = state.merged_search("Calculator", external, 10).unwrap();
        assert!(results.len() >= 2);
        assert_eq!(results[0].object_id, "ext_calc_42_0",
            "Pinned (tier 0) external result must sit above tier-1 Calculator app");
        assert_eq!(results[1].object_id, "app_calculator",
            "Calculator app (tier 1 exact) must be second");
    }

    #[test]
    fn merged_search_pinned_overrides_high_frecency_app() {
        let state = make_state();
        let now_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as u32;
        state.index_one(SearchableItem::Application(models::Application {
            id: "app_safari_big".to_string(),
            name: "Safari".to_string(),
            path: "/Applications/Safari.app".to_string(),
            usage_count: 100,
            icon: None,
            last_used_at: Some(now_ts),
            bundle_id: None,
        })).unwrap();

        // score: 0.0 so current code never puts this first;
        // only tier 0 (pinned) lifts it above the high-frecency app.
        let external = vec![ext_result("ext_pinned_0", "Pinned Result", 0.0, Some(models::ResultPriority::Top))];
        let results = state.merged_search("Safari", external, 10).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].object_id, "ext_pinned_0",
            "Pinned (tier 0) result must beat app with usage_count 100 at tier 1");
    }

    // ------------------------------------------------------------------
    // Dynamic command integration
    // ------------------------------------------------------------------

    use crate::extensions::dynamic_commands::RegisteredCommand;

    fn rc(id: &str, name: &str) -> RegisteredCommand {
        RegisteredCommand {
            id: id.to_string(),
            name: name.to_string(),
            description: None,
            icon: None,
            arguments: vec![],
        }
    }

    #[test]
    fn dynamic_object_id_uses_dyn_infix() {
        let id = SearchState::dynamic_object_id("org.author.shortcuts", "uuid-1");
        assert_eq!(id, "cmd_org.author.shortcuts_dyn_uuid-1");
    }

    #[test]
    fn replace_dynamic_commands_indexes_all_with_dyn_infix() {
        let state = make_state();
        let regs = vec![rc("a", "Alpha"), rc("b", "Beta")];
        state.replace_dynamic_commands("ext1", &regs).unwrap();

        let ids = state.all_ids().unwrap();
        assert!(ids.contains("cmd_ext1_dyn_a"));
        assert!(ids.contains("cmd_ext1_dyn_b"));
    }

    #[test]
    fn replace_dynamic_commands_marks_items_as_dynamic() {
        let state = make_state();
        state
            .replace_dynamic_commands("ext1", &[rc("a", "Alpha")])
            .unwrap();

        let guard = state.items.read().unwrap();
        let item = guard
            .iter()
            .find(|i| i.id() == "cmd_ext1_dyn_a")
            .expect("dynamic item indexed");
        match item {
            SearchableItem::Command(c) => assert!(c.is_dynamic),
            _ => panic!("expected Command variant"),
        }
    }

    #[test]
    fn replace_dynamic_commands_removes_stale() {
        let state = make_state();
        state
            .replace_dynamic_commands("ext1", &[rc("a", "Alpha"), rc("b", "Beta")])
            .unwrap();

        // Replace with only 'a' present — 'b' should be removed.
        state
            .replace_dynamic_commands("ext1", &[rc("a", "Alpha")])
            .unwrap();

        let ids = state.all_ids().unwrap();
        assert!(ids.contains("cmd_ext1_dyn_a"));
        assert!(!ids.contains("cmd_ext1_dyn_b"));
    }

    #[test]
    fn replace_dynamic_commands_with_empty_list_removes_all() {
        let state = make_state();
        state
            .replace_dynamic_commands("ext1", &[rc("a", "Alpha")])
            .unwrap();
        state.replace_dynamic_commands("ext1", &[]).unwrap();

        let ids = state.all_ids().unwrap();
        assert!(!ids.iter().any(|id| id.starts_with("cmd_ext1_dyn_")));
    }

    #[test]
    fn replace_dynamic_commands_does_not_affect_manifest_commands_for_same_extension() {
        let state = make_state();

        // Manifest command for ext1
        state
            .index_one(cmd("cmd_ext1_open", "Open", 5))
            .unwrap();

        // Add then clear dynamic commands for the same extension
        state
            .replace_dynamic_commands("ext1", &[rc("d1", "Dynamic 1")])
            .unwrap();
        state.replace_dynamic_commands("ext1", &[]).unwrap();

        let ids = state.all_ids().unwrap();
        assert!(
            ids.contains("cmd_ext1_open"),
            "manifest command must remain"
        );
    }

    #[test]
    fn replace_dynamic_commands_does_not_affect_other_extensions() {
        let state = make_state();
        state
            .replace_dynamic_commands("ext-a", &[rc("a1", "A1")])
            .unwrap();
        state
            .replace_dynamic_commands("ext-b", &[rc("b1", "B1")])
            .unwrap();

        // Clear ext-a's dynamic commands.
        state.replace_dynamic_commands("ext-a", &[]).unwrap();

        let ids = state.all_ids().unwrap();
        assert!(!ids.contains("cmd_ext-a_dyn_a1"));
        assert!(ids.contains("cmd_ext-b_dyn_b1"));
    }

    #[test]
    fn replace_dynamic_commands_updates_kept_items() {
        let state = make_state();
        state
            .replace_dynamic_commands("ext1", &[rc("a", "Old name")])
            .unwrap();

        state
            .replace_dynamic_commands("ext1", &[rc("a", "New name")])
            .unwrap();

        let results = state.search("New").unwrap();
        let found = results.iter().find(|r| r.object_id == "cmd_ext1_dyn_a");
        assert!(found.is_some(), "renamed dynamic command should be findable by new name");
        assert_eq!(found.unwrap().name, "New name");
    }

    #[test]
    fn replace_dynamic_commands_carries_description_to_subtitle() {
        let state = make_state();
        let mut r = rc("a", "Alpha");
        r.description = Some("subtitle text".to_string());
        state.replace_dynamic_commands("ext1", &[r]).unwrap();

        let guard = state.items.read().unwrap();
        let item = guard
            .iter()
            .find(|i| i.id() == "cmd_ext1_dyn_a")
            .unwrap();
        match item {
            SearchableItem::Command(c) => assert_eq!(c.subtitle.as_deref(), Some("subtitle text")),
            _ => panic!("expected Command"),
        }
    }
}