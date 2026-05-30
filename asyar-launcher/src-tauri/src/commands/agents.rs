use crate::error::AppError;
use crate::storage::agents::{
    backfill_thread_titles, delete_agent, delete_thread, find_run_origin, get_agent, insert_agent,
    insert_message, insert_thread, list_agents, list_messages_for_thread, list_threads_for_agent,
    update_agent, update_thread_title, AgentRow, MessageRole, MessageRow, RunOrigin,
    SilentInputSource, SilentOutputAction, ThreadRow,
};
use crate::storage::DataStore;
use rusqlite::Connection;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn require_non_empty(value: &str, field: &str) -> Result<String, AppError> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{field} must not be empty")));
    }
    Ok(trimmed)
}

// ── Input structs ─────────────────────────────────────────────────────────────

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateInput {
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub provider_id: String,
    pub model_id: String,
    pub tool_selection: Vec<String>,
    /// Optional silent-AI command settings. Defaults: `silent=false`,
    /// `input_source=argument`, `output_action=replaceSelection`. The three
    /// fields are stored regardless of `silent` — the agent editor flips
    /// the toggle without re-validating the other two.
    #[serde(default)]
    pub silent: Option<bool>,
    #[serde(default)]
    pub input_source: Option<SilentInputSource>,
    #[serde(default)]
    pub output_action: Option<SilentOutputAction>,
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdateInput {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub provider_id: String,
    pub model_id: String,
    pub tool_selection: Vec<String>,
    #[serde(default)]
    pub silent: Option<bool>,
    #[serde(default)]
    pub input_source: Option<SilentInputSource>,
    #[serde(default)]
    pub output_action: Option<SilentOutputAction>,
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThreadCreateInput {
    pub agent_id: String,
    pub title: Option<String>,
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MessageInsertInput {
    pub thread_id: String,
    pub role: MessageRole,
    pub content: serde_json::Value,
    pub run_id: Option<String>,
}

// ── Inner functions (testable without Tauri runtime) ─────────────────────────

pub fn agents_create_impl(
    conn: &Connection,
    input: AgentCreateInput,
) -> Result<AgentRow, AppError> {
    let name = require_non_empty(&input.name, "name")?;
    let system_prompt = require_non_empty(&input.system_prompt, "system_prompt")?;
    let provider_id = require_non_empty(&input.provider_id, "provider_id")?;
    let model_id = require_non_empty(&input.model_id, "model_id")?;
    let now = now_ms();
    let row = AgentRow {
        id: new_id(),
        name,
        description: input.description,
        system_prompt,
        provider_id,
        model_id,
        tool_selection: input.tool_selection,
        silent: input.silent.unwrap_or(false),
        input_source: input.input_source.unwrap_or(SilentInputSource::Argument),
        output_action: input
            .output_action
            .unwrap_or(SilentOutputAction::ReplaceSelection),
        created_at: Some(now),
        updated_at: Some(now),
    };
    insert_agent(conn, &row)?;
    Ok(row)
}

pub fn agents_update_impl(
    conn: &Connection,
    input: AgentUpdateInput,
) -> Result<AgentRow, AppError> {
    let name = require_non_empty(&input.name, "name")?;
    let system_prompt = require_non_empty(&input.system_prompt, "system_prompt")?;
    let provider_id = require_non_empty(&input.provider_id, "provider_id")?;
    let model_id = require_non_empty(&input.model_id, "model_id")?;

    let existing = get_agent(conn, &input.id)?
        .ok_or_else(|| AppError::NotFound(format!("agent {}", input.id)))?;

    let row = AgentRow {
        id: input.id,
        name,
        description: input.description,
        system_prompt,
        provider_id,
        model_id,
        tool_selection: input.tool_selection,
        // For silent fields, fall back to the existing row's values when the
        // input omits them — lets clients PATCH-style update without sending
        // every field every time, while still allowing explicit overrides.
        silent: input.silent.unwrap_or(existing.silent),
        input_source: input.input_source.unwrap_or(existing.input_source),
        output_action: input.output_action.unwrap_or(existing.output_action),
        created_at: existing.created_at,
        updated_at: Some(now_ms()),
    };
    update_agent(conn, &row)?;
    Ok(row)
}

pub fn agents_delete_impl(conn: &Connection, id: String) -> Result<(), AppError> {
    delete_agent(conn, &id)
}

pub fn agents_list_impl(conn: &Connection) -> Result<Vec<AgentRow>, AppError> {
    list_agents(conn)
}

pub fn agents_get_impl(conn: &Connection, id: String) -> Result<Option<AgentRow>, AppError> {
    get_agent(conn, &id)
}

pub fn agents_thread_create_impl(
    conn: &Connection,
    input: ThreadCreateInput,
) -> Result<ThreadRow, AppError> {
    get_agent(conn, &input.agent_id)?
        .ok_or_else(|| AppError::NotFound(format!("agent {}", input.agent_id)))?;
    let now = now_ms();
    let row = ThreadRow {
        id: new_id(),
        agent_id: input.agent_id,
        title: input.title,
        created_at: Some(now),
        updated_at: Some(now),
    };
    insert_thread(conn, &row)?;
    Ok(row)
}

pub fn agents_thread_delete_impl(conn: &Connection, id: String) -> Result<(), AppError> {
    delete_thread(conn, &id)
}

pub fn agents_thread_update_title_impl(
    conn: &Connection,
    id: String,
    title: String,
) -> Result<(), AppError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "thread title must not be empty".to_string(),
        ));
    }
    update_thread_title(conn, &id, trimmed, now_ms())
}

pub fn agents_find_run_origin_impl(
    conn: &Connection,
    run_id: String,
) -> Result<Option<RunOrigin>, AppError> {
    find_run_origin(conn, &run_id)
}

pub fn agents_backfill_thread_titles_impl(conn: &Connection) -> Result<usize, AppError> {
    backfill_thread_titles(conn)
}

pub fn agents_threads_list_impl(
    conn: &Connection,
    agent_id: String,
) -> Result<Vec<ThreadRow>, AppError> {
    list_threads_for_agent(conn, &agent_id)
}

pub fn agents_message_insert_impl(
    conn: &Connection,
    input: MessageInsertInput,
) -> Result<MessageRow, AppError> {
    get_thread(conn, &input.thread_id)?
        .ok_or_else(|| AppError::NotFound(format!("thread {}", input.thread_id)))?;
    let row = MessageRow {
        id: new_id(),
        thread_id: input.thread_id,
        role: input.role,
        content: input.content,
        created_at: now_ms(),
        run_id: input.run_id,
    };
    insert_message(conn, &row)?;
    Ok(row)
}

pub fn agents_messages_list_impl(
    conn: &Connection,
    thread_id: String,
) -> Result<Vec<MessageRow>, AppError> {
    list_messages_for_thread(conn, &thread_id)
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

#[tauri::command]
pub async fn agents_create(
    app: AppHandle,
    db: State<'_, DataStore>,
    input: AgentCreateInput,
) -> Result<AgentRow, AppError> {
    let conn = db.conn()?;
    let row = agents_create_impl(&conn, input)?;
    let _ = app.emit("agents:changed", ());
    Ok(row)
}

#[tauri::command]
pub async fn agents_update(
    app: AppHandle,
    db: State<'_, DataStore>,
    input: AgentUpdateInput,
) -> Result<AgentRow, AppError> {
    let conn = db.conn()?;
    let row = agents_update_impl(&conn, input)?;
    let _ = app.emit("agents:changed", ());
    Ok(row)
}

#[tauri::command]
pub async fn agents_delete(
    app: AppHandle,
    db: State<'_, DataStore>,
    id: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    agents_delete_impl(&conn, id)?;
    let _ = app.emit("agents:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn agents_list(db: State<'_, DataStore>) -> Result<Vec<AgentRow>, AppError> {
    let conn = db.conn()?;
    agents_list_impl(&conn)
}

#[tauri::command]
pub async fn agents_get(
    db: State<'_, DataStore>,
    id: String,
) -> Result<Option<AgentRow>, AppError> {
    let conn = db.conn()?;
    agents_get_impl(&conn, id)
}

#[tauri::command]
pub async fn agents_thread_create(
    db: State<'_, DataStore>,
    input: ThreadCreateInput,
) -> Result<ThreadRow, AppError> {
    let conn = db.conn()?;
    agents_thread_create_impl(&conn, input)
}

#[tauri::command]
pub async fn agents_thread_delete(db: State<'_, DataStore>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    agents_thread_delete_impl(&conn, id)
}

#[tauri::command]
pub async fn agents_thread_update_title(
    db: State<'_, DataStore>,
    id: String,
    title: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    agents_thread_update_title_impl(&conn, id, title)
}

#[tauri::command]
pub async fn agents_find_run_origin(
    db: State<'_, DataStore>,
    run_id: String,
) -> Result<Option<RunOrigin>, AppError> {
    let conn = db.conn()?;
    agents_find_run_origin_impl(&conn, run_id)
}

#[tauri::command]
pub async fn agents_backfill_thread_titles(db: State<'_, DataStore>) -> Result<usize, AppError> {
    let conn = db.conn()?;
    agents_backfill_thread_titles_impl(&conn)
}

#[tauri::command]
pub async fn agents_threads_list(
    db: State<'_, DataStore>,
    agent_id: String,
) -> Result<Vec<ThreadRow>, AppError> {
    let conn = db.conn()?;
    agents_threads_list_impl(&conn, agent_id)
}

#[tauri::command]
pub async fn agents_message_insert(
    db: State<'_, DataStore>,
    input: MessageInsertInput,
) -> Result<MessageRow, AppError> {
    let conn = db.conn()?;
    agents_message_insert_impl(&conn, input)
}

#[tauri::command]
pub async fn agents_messages_list(
    db: State<'_, DataStore>,
    thread_id: String,
) -> Result<Vec<MessageRow>, AppError> {
    let conn = db.conn()?;
    agents_messages_list_impl(&conn, thread_id)
}

// ── Private helper ────────────────────────────────────────────────────────────

fn get_thread(conn: &Connection, id: &str) -> Result<Option<ThreadRow>, AppError> {
    use rusqlite::params;
    let mut stmt = conn
        .prepare(
            "SELECT id, agent_id, title, created_at, updated_at
             FROM threads
             WHERE id = ?1",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut rows = stmt
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    match rows.next() {
        None => Ok(None),
        Some(row) => {
            let (id, agent_id, title, created_at, updated_at) =
                row.map_err(|e| AppError::Database(e.to_string()))?;
            Ok(Some(ThreadRow {
                id,
                agent_id,
                title,
                created_at,
                updated_at,
            }))
        }
    }
}
