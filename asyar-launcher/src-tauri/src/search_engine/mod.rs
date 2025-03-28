pub mod commands;
pub mod models;

// Import necessary items
use models::SearchableItem;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// Constant for the persistence file name
const INDEX_FILE_NAME: &str = "search_data.json";

// Simplified state: A list of searchable items protected by a Mutex
pub struct SearchState {
    items: Mutex<Vec<SearchableItem>>,
    persistence_path: PathBuf, // Store the path for saving
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

    serde_json::to_writer_pretty(writer, &*items_guard).map_err(SearchError::Json)?; // Deref the guard
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