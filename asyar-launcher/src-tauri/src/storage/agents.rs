use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Where the silent-AI dispatcher pulls the input from before it calls the
/// LLM. Meaningless when `AgentRow.silent == false`. Stored as a short
/// stable lowercase string in SQLite so adding variants later is purely
/// additive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SilentInputSource {
    /// `selectionService.getSelectedText()` — captured from the previously
    /// frontmost app via macOS AX before the launcher takes focus.
    Selection,
    /// Whatever is currently on the system clipboard.
    Clipboard,
    /// String passed in via the dispatcher's `arguments.<firstArgName>`.
    /// Default — matches the existing "type a question in the bar" UX.
    Argument,
    /// Empty string — the prompt itself is fully self-contained.
    None,
}

impl SilentInputSource {
    fn as_str(self) -> &'static str {
        match self {
            SilentInputSource::Selection => "selection",
            SilentInputSource::Clipboard => "clipboard",
            SilentInputSource::Argument => "argument",
            SilentInputSource::None => "none",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "selection" => SilentInputSource::Selection,
            "clipboard" => SilentInputSource::Clipboard,
            "none" => SilentInputSource::None,
            _ => SilentInputSource::Argument,
        }
    }
}

/// What the silent-AI dispatcher does with the LLM's final assistant
/// message. Meaningless when `AgentRow.silent == false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SilentOutputAction {
    /// Write result to clipboard, hide launcher, simulate Cmd+V, restore
    /// previous clipboard. Default — matches the Reddit "grammar fix"
    /// reference flow.
    ReplaceSelection,
    /// Write result to clipboard only. No paste, no clipboard restore.
    Copy,
    /// Same flow as ReplaceSelection. Distinct intent — explicit "paste,
    /// don't replace": for apps where there's no selection to overwrite.
    Paste,
    /// Show last non-empty line of result in a transient HUD toast.
    Hud,
}

impl SilentOutputAction {
    fn as_str(self) -> &'static str {
        match self {
            SilentOutputAction::ReplaceSelection => "replaceSelection",
            SilentOutputAction::Copy => "copy",
            SilentOutputAction::Paste => "paste",
            SilentOutputAction::Hud => "hud",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "copy" => SilentOutputAction::Copy,
            "paste" => SilentOutputAction::Paste,
            "hud" => SilentOutputAction::Hud,
            _ => SilentOutputAction::ReplaceSelection,
        }
    }
}

/// A persisted AI agent configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub provider_id: String,
    pub model_id: String,
    /// Ordered list of tool identifiers (stored as JSON array in SQLite).
    pub tool_selection: Vec<String>,
    /// When true, dispatching this agent skips the chat view, runs a
    /// single-turn loop headlessly, and applies `output_action` to the
    /// result. When false the other two fields are stored but ignored.
    pub silent: bool,
    /// Where the silent dispatcher gets the user-text payload. Ignored
    /// when `silent == false`.
    pub input_source: SilentInputSource,
    /// What the silent dispatcher does with the LLM's final text. Ignored
    /// when `silent == false`.
    pub output_action: SilentOutputAction,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

/// A conversation thread belonging to an agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRow {
    pub id: String,
    pub agent_id: String,
    pub title: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

/// The role of a participant in a conversation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    Tool,
}

/// A single message in a thread.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub thread_id: String,
    pub role: MessageRole,
    /// Structured content stored as JSON TEXT in SQLite.
    pub content: serde_json::Value,
    pub created_at: i64,
    pub run_id: Option<String>,
}

/// Idempotent: creates the agents, threads, and messages tables and their
/// indexes if missing. Also patches in the silent-AI columns (`silent`,
/// `input_source`, `output_action`) for installs whose `agents` table
/// predates them — mirrors the `runs_history.subject_id` / `tail_output`
/// ALTER TABLE guard pattern.
pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agents (
            id              TEXT    PRIMARY KEY,
            name            TEXT    NOT NULL,
            description     TEXT,
            system_prompt   TEXT    NOT NULL,
            provider_id     TEXT    NOT NULL,
            model_id        TEXT    NOT NULL,
            tool_selection  TEXT    NOT NULL DEFAULT '[]',
            silent          INTEGER NOT NULL DEFAULT 0,
            input_source    TEXT    NOT NULL DEFAULT 'argument',
            output_action   TEXT    NOT NULL DEFAULT 'replaceSelection',
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS threads (
            id          TEXT    PRIMARY KEY,
            agent_id    TEXT    NOT NULL,
            title       TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_threads_agent_updated
            ON threads(agent_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
            id          TEXT    PRIMARY KEY,
            thread_id   TEXT    NOT NULL,
            role        TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            created_at  INTEGER NOT NULL,
            run_id      TEXT,
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_thread_created
            ON messages(thread_id, created_at);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init agents tables: {e}")))?;

    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(agents)")
        .map_err(|e| AppError::Database(e.to_string()))?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| AppError::Database(e.to_string()))?
        .filter_map(Result::ok)
        .collect();

    if !cols.contains(&"silent".to_string()) {
        conn.execute(
            "ALTER TABLE agents ADD COLUMN silent INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    }
    if !cols.contains(&"input_source".to_string()) {
        conn.execute(
            "ALTER TABLE agents ADD COLUMN input_source TEXT NOT NULL DEFAULT 'argument'",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    }
    if !cols.contains(&"output_action".to_string()) {
        conn.execute(
            "ALTER TABLE agents ADD COLUMN output_action TEXT NOT NULL DEFAULT 'replaceSelection'",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    }
    Ok(())
}

/// Insert a new agent row. Returns an error if the id already exists.
pub fn insert_agent(conn: &Connection, agent: &AgentRow) -> Result<(), AppError> {
    let tool_json = serde_json::to_string(&agent.tool_selection)
        .map_err(|e| AppError::Database(format!("serialize tool_selection: {e}")))?;
    conn.execute(
        "INSERT INTO agents (id, name, description, system_prompt, provider_id, model_id,
                             tool_selection, silent, input_source, output_action,
                             created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            agent.id,
            agent.name,
            agent.description,
            agent.system_prompt,
            agent.provider_id,
            agent.model_id,
            tool_json,
            agent.silent as i64,
            agent.input_source.as_str(),
            agent.output_action.as_str(),
            agent.created_at,
            agent.updated_at,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Update an existing agent row identified by `agent.id`.
pub fn update_agent(conn: &Connection, agent: &AgentRow) -> Result<(), AppError> {
    let tool_json = serde_json::to_string(&agent.tool_selection)
        .map_err(|e| AppError::Database(format!("serialize tool_selection: {e}")))?;
    conn.execute(
        "UPDATE agents SET name=?2, description=?3, system_prompt=?4, provider_id=?5,
         model_id=?6, tool_selection=?7, silent=?8, input_source=?9, output_action=?10,
         updated_at=?11 WHERE id=?1",
        params![
            agent.id,
            agent.name,
            agent.description,
            agent.system_prompt,
            agent.provider_id,
            agent.model_id,
            tool_json,
            agent.silent as i64,
            agent.input_source.as_str(),
            agent.output_action.as_str(),
            agent.updated_at,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Delete an agent by id. Cascades to threads and messages when FK is enabled.
/// Deleting an unknown id is a no-op.
pub fn delete_agent(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM agents WHERE id = ?1", params![id])
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Return all agents ordered by `created_at` ascending.
pub fn list_agents(conn: &Connection) -> Result<Vec<AgentRow>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, system_prompt, provider_id, model_id,
                    tool_selection, silent, input_source, output_action,
                    created_at, updated_at
             FROM agents
             ORDER BY created_at ASC",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, Option<i64>>(10)?,
                row.get::<_, Option<i64>>(11)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut agents = Vec::new();
    for row in rows {
        let (
            id,
            name,
            description,
            system_prompt,
            provider_id,
            model_id,
            tool_json,
            silent_int,
            input_str,
            output_str,
            created_at,
            updated_at,
        ) = row.map_err(|e| AppError::Database(e.to_string()))?;
        let tool_selection = serde_json::from_str::<Vec<String>>(&tool_json)
            .map_err(|e| AppError::Database(format!("deserialize tool_selection: {e}")))?;
        agents.push(AgentRow {
            id,
            name,
            description,
            system_prompt,
            provider_id,
            model_id,
            tool_selection,
            silent: silent_int != 0,
            input_source: SilentInputSource::parse(&input_str),
            output_action: SilentOutputAction::parse(&output_str),
            created_at,
            updated_at,
        });
    }
    Ok(agents)
}

/// Return a single agent by id, or `None` if not found.
pub fn get_agent(conn: &Connection, id: &str) -> Result<Option<AgentRow>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, system_prompt, provider_id, model_id,
                    tool_selection, silent, input_source, output_action,
                    created_at, updated_at
             FROM agents
             WHERE id = ?1",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut rows = stmt
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, Option<i64>>(10)?,
                row.get::<_, Option<i64>>(11)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    match rows.next() {
        None => Ok(None),
        Some(row) => {
            let (
                id,
                name,
                description,
                system_prompt,
                provider_id,
                model_id,
                tool_json,
                silent_int,
                input_str,
                output_str,
                created_at,
                updated_at,
            ) = row.map_err(|e| AppError::Database(e.to_string()))?;
            let tool_selection = serde_json::from_str::<Vec<String>>(&tool_json)
                .map_err(|e| AppError::Database(format!("deserialize tool_selection: {e}")))?;
            Ok(Some(AgentRow {
                id,
                name,
                description,
                system_prompt,
                provider_id,
                model_id,
                tool_selection,
                silent: silent_int != 0,
                input_source: SilentInputSource::parse(&input_str),
                output_action: SilentOutputAction::parse(&output_str),
                created_at,
                updated_at,
            }))
        }
    }
}

/// Insert a new thread row.
pub fn insert_thread(conn: &Connection, thread: &ThreadRow) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO threads (id, agent_id, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            thread.id,
            thread.agent_id,
            thread.title,
            thread.created_at,
            thread.updated_at,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Delete a thread by id. Cascades to messages when FK is enabled.
/// Deleting an unknown id is a no-op.
pub fn delete_thread(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM threads WHERE id = ?1", params![id])
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Look up the agent + thread that produced messages tagged with `run_id`.
/// Returns `None` when the run is unknown (not an agent run, or the messages
/// were deleted). Used by the "Open Run in Chat" action so the user can
/// navigate from a Run row back to the conversation that produced it.
pub fn find_run_origin(conn: &Connection, run_id: &str) -> Result<Option<RunOrigin>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.agent_id
             FROM messages m
             JOIN threads t ON t.id = m.thread_id
             WHERE m.run_id = ?1
             LIMIT 1",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut rows = stmt
        .query(params![run_id])
        .map_err(|e| AppError::Database(e.to_string()))?;
    match rows.next().map_err(|e| AppError::Database(e.to_string()))? {
        Some(row) => {
            let thread_id: String = row.get(0).map_err(|e| AppError::Database(e.to_string()))?;
            let agent_id: String = row.get(1).map_err(|e| AppError::Database(e.to_string()))?;
            Ok(Some(RunOrigin {
                agent_id,
                thread_id,
            }))
        }
        None => Ok(None),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOrigin {
    pub agent_id: String,
    pub thread_id: String,
}

/// Fill in titles for any threads that have a null/empty title by deriving
/// one from the thread's first user message. A one-time migration for
/// threads created before auto-title-generation landed. Returns the number
/// of threads that were updated.
///
/// SQLite quirk: `json_extract(content, '$.text')` is used because messages
/// store their text inside a JSON blob (`{"text": "..."}`).
pub fn backfill_thread_titles(conn: &Connection) -> Result<usize, AppError> {
    // Pull the threads that need a title. Cap derived title length at 80
    // chars at the SQL layer so we don't carry huge strings into TS.
    let mut stmt = conn
        .prepare(
            "SELECT t.id, substr(json_extract(m.content, '$.text'), 1, 80)
             FROM threads t
             JOIN messages m ON m.thread_id = t.id
             WHERE (t.title IS NULL OR trim(t.title) = '')
               AND m.role = 'user'
               AND m.id = (
                 SELECT id FROM messages
                 WHERE thread_id = t.id AND role = 'user'
                 ORDER BY created_at ASC
                 LIMIT 1
               )",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let text: Option<String> = row.get(1)?;
            Ok((id, text))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let mut count = 0usize;
    for row in rows {
        let (id, text) = row.map_err(|e| AppError::Database(e.to_string()))?;
        let trimmed = text
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or("New thread");
        conn.execute(
            "UPDATE threads SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![trimmed, now, id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        count += 1;
    }
    Ok(count)
}

/// Update a thread's title and bump its `updated_at` to the given timestamp.
/// Used when the chat view derives a title from the first user message.
pub fn update_thread_title(
    conn: &Connection,
    id: &str,
    title: &str,
    updated_at: i64,
) -> Result<(), AppError> {
    let rows = conn
        .execute(
            "UPDATE threads SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, updated_at, id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("thread '{}' not found", id)));
    }
    Ok(())
}

/// Return all threads for the given agent ordered by `updated_at` descending.
pub fn list_threads_for_agent(
    conn: &Connection,
    agent_id: &str,
) -> Result<Vec<ThreadRow>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, agent_id, title, created_at, updated_at
             FROM threads
             WHERE agent_id = ?1
             ORDER BY updated_at DESC",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let rows = stmt
        .query_map(params![agent_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut threads = Vec::new();
    for row in rows {
        let (id, agent_id, title, created_at, updated_at) =
            row.map_err(|e| AppError::Database(e.to_string()))?;
        threads.push(ThreadRow {
            id,
            agent_id,
            title,
            created_at,
            updated_at,
        });
    }
    Ok(threads)
}

/// Insert a new message row.
pub fn insert_message(conn: &Connection, msg: &MessageRow) -> Result<(), AppError> {
    let role_str = serde_json::to_string(&msg.role)
        .map_err(|e| AppError::Database(format!("serialize role: {e}")))?;
    let role_str = role_str.trim_matches('"').to_string();
    let content_json = serde_json::to_string(&msg.content)
        .map_err(|e| AppError::Database(format!("serialize content: {e}")))?;
    conn.execute(
        "INSERT INTO messages (id, thread_id, role, content, created_at, run_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            msg.id,
            msg.thread_id,
            role_str,
            content_json,
            msg.created_at,
            msg.run_id,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Return all messages for the given thread ordered by `created_at` ascending.
pub fn list_messages_for_thread(
    conn: &Connection,
    thread_id: &str,
) -> Result<Vec<MessageRow>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, thread_id, role, content, created_at, run_id
             FROM messages
             WHERE thread_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let rows = stmt
        .query_map(params![thread_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut messages = Vec::new();
    for row in rows {
        let (id, thread_id, role_str, content_json, created_at, run_id) =
            row.map_err(|e| AppError::Database(e.to_string()))?;
        let role = serde_json::from_str::<MessageRole>(&format!("\"{role_str}\""))
            .map_err(|e| AppError::Database(format!("deserialize role '{role_str}': {e}")))?;
        let content = serde_json::from_str::<serde_json::Value>(&content_json)
            .map_err(|e| AppError::Database(format!("deserialize content: {e}")))?;
        messages.push(MessageRow {
            id,
            thread_id,
            role,
            content,
            created_at,
            run_id,
        });
    }
    Ok(messages)
}
