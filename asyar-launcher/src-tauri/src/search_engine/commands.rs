use super::models::{SearchableItem, SearchResult};
use super::{SearchError, SearchState, FIELD_CONTENT, FIELD_NAME, FIELD_OBJECT_ID, FIELD_TYPE};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{doc, Document, Term};
use tauri::State;

#[tauri::command]
pub async fn index_item(
    item: SearchableItem, // Receives JSON from frontend, deserialized by Serde
    state: State<'_, SearchState>,
) -> Result<(), SearchError> {
    log::info!("Indexing item: {:?}", item);

    // --- Adapter Pattern in Rust ---
    let object_id_str: String;
    // Use tantivy::Document directly as it's a concrete struct, not a trait
    let mut doc = TantivyDocument::default();

    // Get schema fields - handle potential errors if fields don't exist
    let schema = &state.schema;
    let object_id_field = schema
        .get_field(FIELD_OBJECT_ID).unwrap();
    let name_field = schema
        .get_field(FIELD_NAME)
        .unwrap();
    let type_field = schema
        .get_field(FIELD_TYPE)
        .unwrap();
    let content_field = schema
        .get_field(FIELD_CONTENT)
        .unwrap();

    match item {
        SearchableItem::Application(app) => {
            object_id_str = format!("app_{}", app.name.replace(' ', "_").to_lowercase());
            doc.add_text(object_id_field, &object_id_str);
            doc.add_text(name_field, &app.name);
            doc.add_text(type_field, "application");
            doc.add_text(content_field, &format!("{} {}", app.name, app.path));
        }
        SearchableItem::Command(ext) => {
            object_id_str = format!("ext_{}", ext.id);
            doc.add_text(object_id_field, &object_id_str);
            doc.add_text(name_field, &ext.name);
            doc.add_text(type_field, "extension");
            // Include all relevant fields for better searching
            doc.add_text(
                content_field,
                &format!(
                    "{} {} {} {}",
                    ext.name, ext.extension, ext.trigger, ext.command_type
                ),
            );
        }
    }
    // --- End Adapter Pattern ---

    // Get exclusive access to the writer
    let mut writer = state.writer.lock().map_err(|_| SearchError::LockError)?;

    // Delete existing doc with same object_id first (for updates)
    let id_term = Term::from_field_text(object_id_field, &object_id_str);
    writer.delete_term(id_term);

    // Add the new document
    writer.add_document(doc)?;

    // Commit changes to the index (makes them searchable)
    writer.commit()?;
    log::info!("Committed index for object_id: {}", object_id_str);

    // Reload the reader to make the changes visible
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

    // Reload the reader to see latest changes
    state.reader.reload()?;

    // Create a searcher from the reader
    let searcher = state.reader.searcher();
    let schema = &state.schema;

    // Get schema fields for searching and result formatting
    let object_id_field = schema
        .get_field(FIELD_OBJECT_ID)
        .unwrap();
    let name_field = schema
        .get_field(FIELD_NAME)
        .unwrap();
    let type_field = schema
        .get_field(FIELD_TYPE)
        .unwrap();
    let content_field = schema
        .get_field(FIELD_CONTENT)
        .unwrap();

    // Create a query parser that searches in both name and content fields
    let query_parser = QueryParser::for_index(
        &state.index,
        vec![name_field, content_field]
    );

    // Parse the user's query string with a default match if empty
    let parsed_query = if query.trim().is_empty() {
        // For empty queries, find all documents (can be customized)
        query_parser.parse_query("*")?
    } else {
        query_parser.parse_query(&query)?
    };

    // Define how to collect results (Top 20 documents)
    let top_docs = TopDocs::with_limit(20);

    // Perform the search
    let search_results = searcher.search(&parsed_query, &top_docs)?;

    // Format results for the frontend
    let mut results: Vec<SearchResult> = Vec::new();
    for (score, doc_address) in search_results {
        // Retrieve the stored document fields
        let retrieved_doc: TantivyDocument = searcher.doc(doc_address)?;
        
        // Extract fields with proper error handling
        let object_id = retrieved_doc
            .get_first(object_id_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
            
        let name = retrieved_doc
            .get_first(name_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
            
        let result_type = retrieved_doc
            .get_first(type_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Create a search result with the normalized score (0-100)
        results.push(SearchResult {
            object_id,
            name,
            result_type,
            score: (score * 100.0) as f32, // Convert score to percentage
        });
    }

    log::info!("Found {} results for query '{}'", results.len(), query);
    Ok(results)
}