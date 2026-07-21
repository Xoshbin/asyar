use super::notes::{
    NotesAppendTool, NotesCreateTool, NotesGetTool, NotesListTool, NotesSearchTool,
};
use crate::agents::tools::BuiltinTool;
use crate::storage::notes::{self, Note};
use crate::storage::notes_fts::NotesFts;
use crate::storage::DataStore;
use rusqlite::Connection;
use serde_json::json;
use std::sync::Arc;

fn test_key() -> [u8; 32] {
    let mut k = [0u8; 32];
    for (i, b) in k.iter_mut().enumerate() {
        *b = (i * 29) as u8;
    }
    k
}

fn test_store() -> (DataStore, [u8; 32], Arc<NotesFts>) {
    let conn = Connection::open_in_memory().unwrap();
    notes::init_table(&conn).unwrap();
    let store = DataStore::from_conn(conn);
    let fts = Arc::new(NotesFts::new_in_memory().unwrap());
    (store, test_key(), fts)
}

fn seed(store: &DataStore, key: &[u8; 32], fts: &NotesFts, id: &str, title: &str, body: &str) {
    let conn = store.conn().unwrap();
    let note = Note {
        id: id.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        created_at: 1000.0,
        updated_at: 1000.0,
        pinned: false,
    };
    notes::upsert_with_fts(&conn, &note, key, fts).unwrap();
}

#[tokio::test]
async fn notes_search_finds_matching_notes() {
    let (store, key, fts) = test_store();
    seed(&store, &key, &fts, "1", "Grocery List", "buy milk and eggs");
    seed(&store, &key, &fts, "2", "Meeting Notes", "quarterly review");
    crate::storage::notes_fts::mark_ready();

    let tool = NotesSearchTool::new(store, key, fts);
    let result = tool.invoke(json!({"query": "milk"})).await.unwrap();
    let results = result["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["id"], "1");
    assert_eq!(results[0]["title"], "Grocery List");
    assert!(results[0]["snippet"].as_str().unwrap().contains("milk"));

    crate::storage::notes_fts::FTS_READY.store(false, std::sync::atomic::Ordering::Release);
}

#[tokio::test]
async fn notes_search_rejects_missing_query() {
    let (store, key, fts) = test_store();
    let tool = NotesSearchTool::new(store, key, fts);
    let err = tool.invoke(json!({})).await.unwrap_err();
    assert!(matches!(err, crate::error::AppError::Validation(_)));
}

#[tokio::test]
async fn notes_list_returns_notes_pinned_first_newest_first() {
    let (store, key, fts) = test_store();
    seed(&store, &key, &fts, "1", "Old", "a");
    seed(&store, &key, &fts, "2", "New", "b");
    {
        let conn = store.conn().unwrap();
        notes::update(&conn, "2", None, None, None, 2000.0, &key).unwrap();
    }

    let tool = NotesListTool::new(store, key);
    let result = tool.invoke(json!({})).await.unwrap();
    let results = result["results"].as_array().unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["id"], "2"); // most recently updated first
}

#[tokio::test]
async fn notes_list_respects_limit() {
    let (store, key, fts) = test_store();
    seed(&store, &key, &fts, "1", "A", "a");
    seed(&store, &key, &fts, "2", "B", "b");
    seed(&store, &key, &fts, "3", "C", "c");

    let tool = NotesListTool::new(store, key);
    let result = tool.invoke(json!({"limit": 2})).await.unwrap();
    assert_eq!(result["results"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn notes_get_by_id_returns_full_note() {
    let (store, key, fts) = test_store();
    seed(&store, &key, &fts, "1", "Grocery List", "buy milk and eggs");

    let tool = NotesGetTool::new(store, key);
    let result = tool.invoke(json!({"idOrTitle": "1"})).await.unwrap();
    assert_eq!(result["id"], "1");
    assert_eq!(result["title"], "Grocery List");
    assert_eq!(result["body"], "buy milk and eggs");
}

#[tokio::test]
async fn notes_get_by_title_case_insensitive() {
    let (store, key, fts) = test_store();
    seed(&store, &key, &fts, "1", "Grocery List", "buy milk and eggs");

    let tool = NotesGetTool::new(store, key);
    let result = tool
        .invoke(json!({"idOrTitle": "grocery list"}))
        .await
        .unwrap();
    assert_eq!(result["id"], "1");
}

#[tokio::test]
async fn notes_get_not_found_is_an_error() {
    let (store, key, _fts) = test_store();
    let tool = NotesGetTool::new(store, key);
    let err = tool.invoke(json!({"idOrTitle": "nope"})).await.unwrap_err();
    assert!(matches!(err, crate::error::AppError::NotFound(_)));
}

#[tokio::test]
async fn notes_create_makes_a_new_note_findable_by_get() {
    let (store, key, fts) = test_store();
    let tool = NotesCreateTool::new(store.clone(), key, fts);

    let result = tool
        .invoke(json!({"title": "Idea", "body": "build a launcher"}))
        .await
        .unwrap();
    let id = result["id"].as_str().unwrap().to_string();

    let conn = store.conn().unwrap();
    let saved = notes::get_by_id(&conn, &id, &key).unwrap().unwrap();
    assert_eq!(saved.title, "Idea");
    assert_eq!(saved.body, "build a launcher");
}

#[tokio::test]
async fn notes_create_defaults_body_to_empty_when_omitted() {
    let (store, key, fts) = test_store();
    let tool = NotesCreateTool::new(store.clone(), key, fts);
    let result = tool.invoke(json!({"title": "Just a title"})).await.unwrap();
    let id = result["id"].as_str().unwrap().to_string();

    let conn = store.conn().unwrap();
    let saved = notes::get_by_id(&conn, &id, &key).unwrap().unwrap();
    assert_eq!(saved.body, "");
}

#[tokio::test]
async fn notes_create_rejects_missing_title() {
    let (store, key, fts) = test_store();
    let tool = NotesCreateTool::new(store, key, fts);
    let err = tool.invoke(json!({})).await.unwrap_err();
    assert!(matches!(err, crate::error::AppError::Validation(_)));
}

#[tokio::test]
async fn notes_append_adds_text_to_existing_note_by_id() {
    let (store, key, fts) = test_store();
    seed(&store, &key, &fts, "1", "Daily Log", "9am: started work");
    let tool = NotesAppendTool::new(store.clone(), key, fts);

    tool.invoke(json!({"idOrTitle": "1", "text": "10am: standup"}))
        .await
        .unwrap();

    let conn = store.conn().unwrap();
    let saved = notes::get_by_id(&conn, "1", &key).unwrap().unwrap();
    assert_eq!(saved.body, "9am: started work\n10am: standup");
    assert!(saved.updated_at > 1000.0);
}

#[tokio::test]
async fn notes_append_finds_note_by_title() {
    let (store, key, fts) = test_store();
    seed(&store, &key, &fts, "1", "Daily Log", "9am: started work");
    let tool = NotesAppendTool::new(store.clone(), key, fts);

    tool.invoke(json!({"idOrTitle": "daily log", "text": "10am: standup"}))
        .await
        .unwrap();

    let conn = store.conn().unwrap();
    let saved = notes::get_by_id(&conn, "1", &key).unwrap().unwrap();
    assert!(saved.body.ends_with("10am: standup"));
}

#[tokio::test]
async fn notes_append_not_found_is_an_error() {
    let (store, key, fts) = test_store();
    let tool = NotesAppendTool::new(store, key, fts);
    let err = tool
        .invoke(json!({"idOrTitle": "nope", "text": "x"}))
        .await
        .unwrap_err();
    assert!(matches!(err, crate::error::AppError::NotFound(_)));
}

#[tokio::test]
async fn notes_append_keeps_the_fts_index_current() {
    let (store, key, fts) = test_store();
    seed(&store, &key, &fts, "1", "Daily Log", "stale content");
    crate::storage::notes_fts::mark_ready();
    let tool = NotesAppendTool::new(store.clone(), key, fts.clone());

    tool.invoke(json!({"idOrTitle": "1", "text": "fresh content"}))
        .await
        .unwrap();

    assert_eq!(fts.search("fresh", 10).unwrap(), vec!["1".to_string()]);
    crate::storage::notes_fts::FTS_READY.store(false, std::sync::atomic::Ordering::Release);
}
