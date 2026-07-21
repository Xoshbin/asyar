//! AI-callable tools over the user's Notes — search, list, get, create,
//! append. Mirrors `org.asyar.memory`'s tool-quality bar (rich,
//! proactive-trigger descriptions) but for user-authored documents rather
//! than AI-recalled facts about the user; see the plan's positioning note
//! (`Notes` = documents you write, `Memory` = facts the AI remembers).

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use crate::storage::notes::{self, Note};
use crate::storage::notes_fts::NotesFts;
use crate::storage::DataStore;
use serde_json::json;

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn snippet_of(body: &str, max_chars: usize) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() <= max_chars {
        trimmed.to_string()
    } else {
        let truncated: String = trimmed.chars().take(max_chars).collect();
        format!("{truncated}…")
    }
}

fn note_to_json(note: &Note) -> serde_json::Value {
    json!({
        "id": note.id,
        "title": note.title,
        "body": note.body,
        "pinned": note.pinned,
        "updatedAt": note.updated_at,
    })
}

/// Look up a note by id or case-insensitive title. Thin alias over the
/// shared `storage::notes::get_by_id_or_title` so `notes-get`/`notes-append`,
/// the SDK Notes service, and backlinks all resolve "id or title" the same way.
fn find_note(
    conn: &rusqlite::Connection,
    master_key: &[u8; 32],
    id_or_title: &str,
) -> Result<Option<Note>, AppError> {
    notes::get_by_id_or_title(conn, id_or_title, master_key)
}

fn require_str<'a>(args: &'a serde_json::Value, field: &str) -> Result<&'a str, AppError> {
    args.get(field)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::Validation(format!("missing or invalid '{field}' argument")))
}

fn optional_limit(args: &serde_json::Value, default: usize) -> Result<usize, AppError> {
    match args.get("limit") {
        None | Some(serde_json::Value::Null) => Ok(default),
        Some(serde_json::Value::Number(n)) => {
            let i = n
                .as_i64()
                .ok_or_else(|| AppError::Validation("'limit' must be an integer".into()))?;
            if i < 0 {
                return Err(AppError::Validation("'limit' must be non-negative".into()));
            }
            Ok(i as usize)
        }
        _ => Err(AppError::Validation("'limit' must be a number".into())),
    }
}

// ── notes-search ─────────────────────────────────────────────────────────────

pub struct NotesSearchTool {
    data_store: DataStore,
    master_key: [u8; 32],
    fts: Arc<NotesFts>,
}

impl NotesSearchTool {
    pub fn new(data_store: DataStore, master_key: [u8; 32], fts: Arc<NotesFts>) -> Self {
        Self {
            data_store,
            master_key,
            fts,
        }
    }
}

#[async_trait::async_trait]
impl BuiltinTool for NotesSearchTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "notes-search".into(),
            name: "Search Notes".into(),
            description: "Search the user's Notes by title AND body content (not just \
                title). Use this whenever the user asks you to find, recall, or reference \
                something they previously wrote down — e.g. 'what did I write about the \
                Q3 roadmap', 'find my notes on the trip', 'do I have a note about X'. \
                Returns matching notes with a short snippet; call notes-get with the \
                returned id for the full body before answering."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query." },
                    "limit": { "type": "number", "description": "Max results to return (default 10)." }
                },
                "required": ["query"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:notes-search".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let query = require_str(&args, "query")?;
        let limit = optional_limit(&args, 10)?;

        let conn = self.data_store.conn()?;
        let result = notes::search(&conn, &self.fts, query, limit, &self.master_key)?;

        if result.index_state == "indexing" {
            return Ok(json!({
                "results": [],
                "notice": "The notes search index is still starting up — try again in a moment."
            }));
        }

        let results: Vec<serde_json::Value> = result
            .items
            .iter()
            .map(|n| {
                json!({
                    "id": n.id,
                    "title": n.title,
                    "snippet": snippet_of(&n.body, 160),
                })
            })
            .collect();
        Ok(json!({ "results": results }))
    }
}

// ── notes-list ───────────────────────────────────────────────────────────────

pub struct NotesListTool {
    data_store: DataStore,
    master_key: [u8; 32],
}

impl NotesListTool {
    pub fn new(data_store: DataStore, master_key: [u8; 32]) -> Self {
        Self {
            data_store,
            master_key,
        }
    }
}

#[async_trait::async_trait]
impl BuiltinTool for NotesListTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "notes-list".into(),
            name: "List Notes".into(),
            description: "Browse the user's most recent notes (pinned notes first, then \
                newest-edited first), without a search query. Use this for open-ended \
                requests like 'what are my notes' or 'show me my pinned notes', or when \
                notes-search returns nothing and you want to check what exists at all."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "limit": { "type": "number", "description": "Max notes to return (default 20)." }
                }
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:notes-list".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let limit = optional_limit(&args, 20)?;
        let conn = self.data_store.conn()?;
        let all = notes::get_all(&conn, &self.master_key)?;
        let results: Vec<serde_json::Value> = all
            .iter()
            .take(limit)
            .map(|n| {
                json!({
                    "id": n.id,
                    "title": n.title,
                    "snippet": snippet_of(&n.body, 160),
                    "pinned": n.pinned,
                })
            })
            .collect();
        Ok(json!({ "results": results }))
    }
}

// ── notes-get ────────────────────────────────────────────────────────────────

pub struct NotesGetTool {
    data_store: DataStore,
    master_key: [u8; 32],
}

impl NotesGetTool {
    pub fn new(data_store: DataStore, master_key: [u8; 32]) -> Self {
        Self {
            data_store,
            master_key,
        }
    }
}

#[async_trait::async_trait]
impl BuiltinTool for NotesGetTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "notes-get".into(),
            name: "Get Note".into(),
            description: "Fetch a single note's full content by id (from notes-search / \
                notes-list) or by its exact title. Call this before answering questions \
                about a specific note's content — notes-search/notes-list only return \
                short snippets, not the full body."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "idOrTitle": { "type": "string", "description": "The note's id, or its exact title." }
                },
                "required": ["idOrTitle"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:notes-get".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let id_or_title = require_str(&args, "idOrTitle")?;
        let conn = self.data_store.conn()?;
        let note = find_note(&conn, &self.master_key, id_or_title)?
            .ok_or_else(|| AppError::NotFound(format!("no note matching '{id_or_title}'")))?;
        Ok(note_to_json(&note))
    }
}

// ── notes-create ─────────────────────────────────────────────────────────────

pub struct NotesCreateTool {
    data_store: DataStore,
    master_key: [u8; 32],
    fts: Arc<NotesFts>,
}

impl NotesCreateTool {
    pub fn new(data_store: DataStore, master_key: [u8; 32], fts: Arc<NotesFts>) -> Self {
        Self {
            data_store,
            master_key,
            fts,
        }
    }
}

#[async_trait::async_trait]
impl BuiltinTool for NotesCreateTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "notes-create".into(),
            name: "Create Note".into(),
            description: "Create a new note. Use this when the user asks you to save, \
                write down, jot down, or remember something as a note — e.g. 'save this \
                as a note', 'write this down', 'make a note titled X with...'. This is \
                for documents the user wants to read and edit later, not for facts about \
                the user themselves (use the memory tools for that)."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "The note's title." },
                    "body": { "type": "string", "description": "The note's Markdown content. Defaults to empty." }
                },
                "required": ["title"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:notes-create".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let title = require_str(&args, "title")?;
        let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("");

        let note = Note {
            id: uuid::Uuid::new_v4().to_string(),
            title: title.to_string(),
            body: body.to_string(),
            created_at: now_ms(),
            updated_at: now_ms(),
            pinned: false,
        };

        let conn = self.data_store.conn()?;
        notes::upsert_with_fts(&conn, &note, &self.master_key, &self.fts)?;
        Ok(json!({ "id": note.id, "title": note.title }))
    }
}

// ── notes-append ─────────────────────────────────────────────────────────────

pub struct NotesAppendTool {
    data_store: DataStore,
    master_key: [u8; 32],
    fts: Arc<NotesFts>,
}

impl NotesAppendTool {
    pub fn new(data_store: DataStore, master_key: [u8; 32], fts: Arc<NotesFts>) -> Self {
        Self {
            data_store,
            master_key,
            fts,
        }
    }
}

#[async_trait::async_trait]
impl BuiltinTool for NotesAppendTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "notes-append".into(),
            name: "Append to Note".into(),
            description: "Add a new line of text to the end of an existing note, found by \
                id or exact title. Use this for 'add X to my Y note' or 'log this in my \
                daily note' requests, instead of notes-create, when the note already \
                exists. Look it up with notes-search/notes-list first if you don't already \
                know its id or exact title."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "idOrTitle": { "type": "string", "description": "The note's id, or its exact title." },
                    "text": { "type": "string", "description": "Text to append as a new line." }
                },
                "required": ["idOrTitle", "text"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:notes-append".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let id_or_title = require_str(&args, "idOrTitle")?;
        let text = require_str(&args, "text")?;

        let conn = self.data_store.conn()?;
        let note = find_note(&conn, &self.master_key, id_or_title)?
            .ok_or_else(|| AppError::NotFound(format!("no note matching '{id_or_title}'")))?;

        let new_body = if note.body.trim().is_empty() {
            text.to_string()
        } else {
            format!("{}\n{}", note.body, text)
        };

        notes::update_with_fts(
            &conn,
            &note.id,
            None,
            Some(&new_body),
            None,
            now_ms(),
            &self.master_key,
            &self.fts,
        )?;
        Ok(json!({ "id": note.id, "title": note.title }))
    }
}
