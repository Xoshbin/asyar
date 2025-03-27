pub mod commands;
pub mod models;

use std::path::PathBuf;
use std::sync::Mutex;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, directory::MmapDirectory};
use tauri::{AppHandle, Manager}; // To get app paths

// Define field names for clarity
const FIELD_OBJECT_ID: &str = "object_id";
const FIELD_NAME: &str = "name";
const FIELD_TYPE: &str = "type";
const FIELD_CONTENT: &str = "content";

// Define our schema (like database columns)
fn build_schema() -> Schema {
    let mut schema_builder = Schema::builder();
    // object_id: Unique ID, indexed for quick lookup/updates, stored
    schema_builder.add_text_field(FIELD_OBJECT_ID, STRING | STORED);
    // name: Searchable text, also stored
    schema_builder.add_text_field(FIELD_NAME, TEXT | STORED);
    // type: 'application' or 'extension', indexed for filtering, stored
    schema_builder.add_text_field(FIELD_TYPE, STRING | STORED);
    // content: Main searchable text field
    schema_builder.add_text_field(FIELD_CONTENT, TEXT);
    schema_builder.build()
}

// Tauri managed state to hold the index components
pub struct SearchState {
    pub index: Index,
    pub schema: Schema,
    pub reader: IndexReader, // Reader for searching
    // Use Mutex for writer because multiple commands might try to index concurrently
    // although for simplicity, maybe only allow one write at a time
    pub writer: Mutex<IndexWriter>,
}

// Helper to get the index directory path
fn get_index_path(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir() // Use Tauri's recommended app data directory
        .expect("Failed to get app data dir")
        .join("search_index")
}

// Function to initialize the index and state (call this in main.rs setup)
pub fn initialize_search_state(app_handle: &AppHandle) -> Result<SearchState, Box<dyn std::error::Error>> {
    let schema = build_schema();
    let index_path = get_index_path(app_handle);
    std::fs::create_dir_all(&index_path)?; // Ensure directory exists

    // Create a MmapDirectory from the path before opening the index
    let directory = MmapDirectory::open(index_path)?;
    let index = Index::open_or_create(directory, schema.clone())?;

    // Create a writer - higher memory usage, faster indexing
    // Use a larger heap size for potentially faster indexing
    let writer = index.writer(50_000_000)?; // 50MB heap

    // Create a reader for searching
    let reader = index
        .reader_builder()
        .reload_policy(tantivy::ReloadPolicy::Manual) // Reload manually in search command
        .try_into()?;

    Ok(SearchState {
        index,
        schema,
        reader,
        writer: Mutex::new(writer),
    })
}

// Custom Error type for search operations
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("Tantivy error: {0}")]
    Tantivy(#[from] tantivy::TantivyError),
    #[error("Index writer lock poisoned")]
    LockError,
    #[error("Document not found for object ID: {0}")]
    DocNotFound(String),
    #[error("Query parse error: {0}")]
    QueryParse(#[from] tantivy::query::QueryParserError),
    #[error("Schema error: Field '{0}' not found")]
    SchemaError(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Allow converting SearchError to a String for Tauri frontend
impl serde::Serialize for SearchError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}