// src-tauri/src/search_engine/commands.rs

use super::models::{Application, Command, SearchableItem, SearchResult};
use super::{SearchError, SearchState, FIELD_CONTENT, FIELD_NAME, FIELD_OBJECT_ID, FIELD_TYPE};
use std::collections::HashSet;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, Schema, Value};
use tantivy::{TantivyDocument, Term}; // Use alias
use tauri::State;
use sha2::{Digest, Sha256};


// Helper function to generate a stable ID from path
fn generate_app_id_from_path(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let result = hasher.finalize();
    // Use a portion of the hash for a shorter ID
    format!("{:x}", result)[..16].to_string() // Use first 16 hex characters
}

#[tauri::command]
pub async fn index_item(
    item: SearchableItem,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    log::info!("Indexing item: category={:?}", item);

    let object_id_str: String;
    let mut doc = TantivyDocument::default();
    let schema: &Schema = &state.schema;

    // --- CORRECTED: Use '?' directly on get_field's Result ---
    let object_id_field = schema.get_field(FIELD_OBJECT_ID)?;
    let name_field = schema.get_field(FIELD_NAME)?;
    let type_field = schema.get_field(FIELD_TYPE)?;
    let content_field = schema.get_field(FIELD_CONTENT)?;
    // --- End Correction ---

    match item {
        SearchableItem::Application(mut app) => {
            // Generate ID if it's missing or empty
            if app.id.is_empty() {
                app.id = generate_app_id_from_path(&app.path);
                log::info!("Generated Application ID: {} for path: {}", app.id, app.path);
            }

            // Use the (potentially generated) app.id for the object_id
            object_id_str = format!("app_{}", app.id); // Use the final app.id
            doc.add_text(object_id_field, &object_id_str);
            doc.add_text(name_field, &app.name);
            doc.add_text(type_field, "application");
            doc.add_text(content_field, &format!("{} {}", app.name, app.path));
        }
        SearchableItem::Command(cmd) => {
            object_id_str = format!("cmd_{}", cmd.id);
            doc.add_text(object_id_field, &object_id_str);
            doc.add_text(name_field, &cmd.name);
            doc.add_text(type_field, "command");
            doc.add_text(
                content_field,
                &format!(
                    "{} {} {} {}",
                    cmd.name, cmd.extension, cmd.trigger, cmd.command_type
                ),
            );
        }
    }

    let mut writer = state.writer.lock().map_err(|_| SearchError::LockError)?;
    let id_term = Term::from_field_text(object_id_field, &object_id_str);
    writer.delete_term(id_term);
    writer.add_document(doc)?;
    writer.commit()?;
    log::info!("Committed index for object_id: {}", object_id_str);
    state.reader.reload()?;
    log::info!("Reader reloaded.");
    Ok(())
}

#[tauri::command]
pub async fn search_items(
    query: String,
    state: State<'_, SearchState>,
) -> Result<Vec<SearchResult>, SearchError> {
    log::info!("Searching for: {}", query);
    state.reader.reload()?;

    let searcher = state.reader.searcher();
    let schema: &Schema = &state.schema;

    // --- CORRECTED: Use '?' directly on get_field's Result ---
    let object_id_field = schema.get_field(FIELD_OBJECT_ID)?;
    let name_field = schema.get_field(FIELD_NAME)?;
    let type_field = schema.get_field(FIELD_TYPE)?;
    let content_field = schema.get_field(FIELD_CONTENT)?;
    // --- End Correction ---

    let query_parser = QueryParser::for_index(&state.index, vec![name_field, content_field]);
    let parsed_query = if query.trim().is_empty() {
        query_parser.parse_query("*")?
    } else {
        query_parser.parse_query(&query)?
    };

    let top_docs = TopDocs::with_limit(20);
    let search_results = searcher.search(&parsed_query, &top_docs)?;

    let mut results: Vec<SearchResult> = Vec::new();
    for (score, doc_address) in search_results {
        let retrieved_doc: TantivyDocument = searcher.doc(doc_address)?;
        let object_id = retrieved_doc.get_first(object_id_field).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let name = retrieved_doc.get_first(name_field).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let result_type = retrieved_doc.get_first(type_field).and_then(|v| v.as_str()).unwrap_or("").to_string();
        results.push(SearchResult { object_id, name, result_type, score });
    }

    log::info!("Found {} results for query '{}'", results.len(), query);
    Ok(results)
}

#[tauri::command]
pub async fn get_indexed_object_ids(
    state: State<'_, SearchState>,
) -> Result<HashSet<String>, SearchError> {
    log::debug!("Retrieving all indexed object IDs");
    let searcher = state.reader.searcher();
    let schema: &Schema = &state.schema;

    // --- CORRECTED: Use '?' directly on get_field's Result ---
    let object_id_field = schema.get_field(FIELD_OBJECT_ID)?;
    // --- End Correction ---

    let mut indexed_ids = HashSet::new();
    for segment_reader in searcher.segment_readers() {
        if segment_reader.num_docs() > 0 {
            let store_reader = segment_reader.get_store_reader(1)?;
            for doc_id in 0..segment_reader.max_doc() {
                if !segment_reader.is_deleted(doc_id) {
                    let doc: TantivyDocument = store_reader.get(doc_id)?;
                    if let Some(value) = doc.get_first(object_id_field).and_then(|v| v.as_str()) {
                        indexed_ids.insert(value.to_string());
                    }
                }
            }
        }
    }

    log::info!("Found {} unique object IDs in the index.", indexed_ids.len());
    Ok(indexed_ids)
}

#[tauri::command]
pub async fn delete_item(
    object_id: String,
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    log::info!("Deleting item with object_id: {}", object_id);
    let schema: &Schema = &state.schema;

    // --- CORRECTED: Use '?' directly on get_field's Result ---
    let object_id_field = schema.get_field(FIELD_OBJECT_ID)?;
    // --- End Correction ---

    let mut writer = state.writer.lock().map_err(|_| SearchError::LockError)?;
    let id_term = Term::from_field_text(object_id_field, &object_id);
    writer.delete_term(id_term);
    writer.commit()?;
    log::info!("Committed deletion for object_id: {}", object_id);
    state.reader.reload()?;
    log::info!("Reader reloaded after deletion.");
    Ok(())
}