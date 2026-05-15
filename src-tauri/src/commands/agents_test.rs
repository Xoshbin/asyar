use crate::commands::agents::{
    agents_create_impl, agents_delete_impl, agents_get_impl, agents_list_impl,
    agents_message_insert_impl, agents_messages_list_impl, agents_thread_create_impl,
    agents_thread_delete_impl, agents_threads_list_impl, agents_update_impl, AgentCreateInput,
    AgentUpdateInput, MessageInsertInput, ThreadCreateInput,
};
use crate::error::AppError;
use crate::storage::agents::{insert_thread, MessageRole, ThreadRow};
use rusqlite::Connection;

fn make_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db");
    conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
    crate::storage::agents::init_table(&conn).unwrap();
    conn
}

fn valid_create_input() -> AgentCreateInput {
    AgentCreateInput {
        name: "Test Agent".to_string(),
        description: Some("A helpful agent".to_string()),
        system_prompt: "You are a helpful assistant.".to_string(),
        provider_id: "openai".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
    }
}

// ── agents_create ────────────────────────────────────────────────────────────

#[test]
fn agents_create_impl_inserts_and_returns_row() {
    let conn = make_conn();
    let input = valid_create_input();
    let row = agents_create_impl(&conn, input).unwrap();

    assert!(!row.id.is_empty(), "id must be non-empty");
    // UUID v4 has 36 chars: 8-4-4-4-12
    assert_eq!(row.id.len(), 36, "id must be UUID-shaped (36 chars)");
    assert_eq!(row.name, "Test Agent");
    assert!(row.created_at.is_some(), "created_at must be set");
    assert!(row.updated_at.is_some(), "updated_at must be set");

    let fetched = crate::storage::agents::get_agent(&conn, &row.id)
        .unwrap()
        .expect("inserted agent must be findable");
    assert_eq!(fetched.id, row.id);
    assert_eq!(fetched.name, row.name);
}

#[test]
fn agents_create_impl_rejects_empty_name() {
    let conn = make_conn();
    let input = AgentCreateInput {
        name: "   ".to_string(),
        description: None,
        system_prompt: "You are helpful.".to_string(),
        provider_id: "openai".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
    };
    let result = agents_create_impl(&conn, input);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "empty name must return Err(AppError::Validation), got {result:?}"
    );
}

#[test]
fn agents_create_impl_rejects_empty_system_prompt() {
    let conn = make_conn();
    let input = AgentCreateInput {
        name: "Agent".to_string(),
        description: None,
        system_prompt: "  ".to_string(),
        provider_id: "openai".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
    };
    let result = agents_create_impl(&conn, input);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "empty system_prompt must return Err(AppError::Validation), got {result:?}"
    );
}

#[test]
fn agents_create_impl_rejects_empty_provider_id() {
    let conn = make_conn();
    let input = AgentCreateInput {
        name: "Agent".to_string(),
        description: None,
        system_prompt: "You are helpful.".to_string(),
        provider_id: "  ".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
    };
    let result = agents_create_impl(&conn, input);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "empty provider_id must return Err(AppError::Validation), got {result:?}"
    );
}

#[test]
fn agents_create_impl_rejects_empty_model_id() {
    let conn = make_conn();
    let input = AgentCreateInput {
        name: "Agent".to_string(),
        description: None,
        system_prompt: "You are helpful.".to_string(),
        provider_id: "openai".to_string(),
        model_id: "  ".to_string(),
        tool_selection: vec![],
    };
    let result = agents_create_impl(&conn, input);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "empty model_id must return Err(AppError::Validation), got {result:?}"
    );
}

// ── agents_update ────────────────────────────────────────────────────────────

#[test]
fn agents_update_impl_updates_existing() {
    let conn = make_conn();
    let created = agents_create_impl(&conn, valid_create_input()).unwrap();

    let update_input = AgentUpdateInput {
        id: created.id.clone(),
        name: "Renamed Agent".to_string(),
        description: Some("Updated description".to_string()),
        system_prompt: "New system prompt.".to_string(),
        provider_id: "anthropic".to_string(),
        model_id: "claude-3-5-sonnet".to_string(),
        tool_selection: vec!["builtin:search".to_string()],
    };
    let updated = agents_update_impl(&conn, update_input).unwrap();

    assert_eq!(updated.name, "Renamed Agent");
    assert_eq!(updated.provider_id, "anthropic");
    assert_eq!(updated.model_id, "claude-3-5-sonnet");
    assert_eq!(updated.tool_selection, vec!["builtin:search"]);

    let fetched = crate::storage::agents::get_agent(&conn, &created.id)
        .unwrap()
        .expect("agent must still exist");
    assert_eq!(fetched.name, "Renamed Agent");
}

#[test]
fn agents_update_impl_errors_when_id_unknown() {
    let conn = make_conn();
    let input = AgentUpdateInput {
        id: "non-existent-id-00000000-0000-0000-0000-000000000000".to_string(),
        name: "Ghost".to_string(),
        description: None,
        system_prompt: "prompt".to_string(),
        provider_id: "openai".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
    };
    let result = agents_update_impl(&conn, input);
    assert!(
        result.is_err(),
        "update for unknown id must return Err, got Ok"
    );
}

// ── agents_delete ────────────────────────────────────────────────────────────

#[test]
fn agents_delete_impl_removes_agent() {
    let conn = make_conn();
    let created = agents_create_impl(&conn, valid_create_input()).unwrap();

    agents_delete_impl(&conn, created.id.clone()).unwrap();

    let fetched = agents_get_impl(&conn, created.id).unwrap();
    assert!(
        fetched.is_none(),
        "agent must be None after delete, got Some"
    );
}

// ── agents_list ──────────────────────────────────────────────────────────────

#[test]
fn agents_list_impl_returns_all() {
    let conn = make_conn();
    let input1 = AgentCreateInput {
        name: "First".to_string(),
        description: None,
        system_prompt: "prompt one".to_string(),
        provider_id: "openai".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
    };
    let input2 = AgentCreateInput {
        name: "Second".to_string(),
        description: None,
        system_prompt: "prompt two".to_string(),
        provider_id: "anthropic".to_string(),
        model_id: "claude-3-5-sonnet".to_string(),
        tool_selection: vec![],
    };
    agents_create_impl(&conn, input1).unwrap();
    agents_create_impl(&conn, input2).unwrap();

    let all = agents_list_impl(&conn).unwrap();
    assert_eq!(all.len(), 2, "agents_list must return 2 agents, got {}", all.len());
}

// ── agents_thread_create ─────────────────────────────────────────────────────

#[test]
fn agents_thread_create_impl_requires_existing_agent() {
    let conn = make_conn();
    let input = ThreadCreateInput {
        agent_id: "00000000-0000-0000-0000-000000000000".to_string(),
        title: Some("Orphan thread".to_string()),
    };
    let result = agents_thread_create_impl(&conn, input);
    assert!(
        result.is_err(),
        "thread create must fail when agent does not exist"
    );
}

#[test]
fn agents_thread_create_impl_inserts() {
    let conn = make_conn();
    let agent = agents_create_impl(&conn, valid_create_input()).unwrap();

    let input = ThreadCreateInput {
        agent_id: agent.id.clone(),
        title: Some("My Thread".to_string()),
    };
    let thread = agents_thread_create_impl(&conn, input).unwrap();

    assert!(!thread.id.is_empty(), "thread id must be non-empty");
    assert_eq!(thread.id.len(), 36, "thread id must be UUID-shaped");
    assert_eq!(thread.agent_id, agent.id);
    assert!(thread.created_at.is_some(), "created_at must be set");
    assert!(thread.updated_at.is_some(), "updated_at must be set");
}

// ── agents_thread_delete ─────────────────────────────────────────────────────

#[test]
fn agents_thread_delete_impl_removes_thread() {
    let conn = make_conn();
    let agent = agents_create_impl(&conn, valid_create_input()).unwrap();
    let thread_input = ThreadCreateInput {
        agent_id: agent.id.clone(),
        title: None,
    };
    let thread = agents_thread_create_impl(&conn, thread_input).unwrap();

    agents_thread_delete_impl(&conn, thread.id.clone()).unwrap();

    let threads = agents_threads_list_impl(&conn, agent.id).unwrap();
    assert!(threads.is_empty(), "thread list must be empty after delete");
}

// ── agents_threads_list ──────────────────────────────────────────────────────

#[test]
fn agents_threads_list_impl_orders_desc() {
    let conn = make_conn();
    let agent = agents_create_impl(&conn, valid_create_input()).unwrap();

    // Insert two threads with explicit updated_at values via storage layer
    // to avoid timing flakiness — control timestamps directly.
    let t1 = ThreadRow {
        id: "t-older-00000000-0000-0000-0000-000000000001".to_string(),
        agent_id: agent.id.clone(),
        title: Some("Older".to_string()),
        created_at: Some(1000),
        updated_at: Some(1000),
    };
    let t2 = ThreadRow {
        id: "t-newer-00000000-0000-0000-0000-000000000002".to_string(),
        agent_id: agent.id.clone(),
        title: Some("Newer".to_string()),
        created_at: Some(5000),
        updated_at: Some(5000),
    };
    insert_thread(&conn, &t1).unwrap();
    insert_thread(&conn, &t2).unwrap();

    let threads = agents_threads_list_impl(&conn, agent.id).unwrap();
    assert_eq!(threads.len(), 2, "expected 2 threads");
    assert_eq!(
        threads[0].id, t2.id,
        "most recently updated thread must be first"
    );
    assert_eq!(threads[1].id, t1.id);
}

// ── agents_message_insert ────────────────────────────────────────────────────

#[test]
fn agents_message_insert_impl_requires_existing_thread() {
    let conn = make_conn();
    let input = MessageInsertInput {
        thread_id: "00000000-0000-0000-0000-000000000000".to_string(),
        role: MessageRole::User,
        content: serde_json::json!({"text": "hello"}),
        run_id: None,
    };
    let result = agents_message_insert_impl(&conn, input);
    assert!(
        result.is_err(),
        "message insert must fail when thread does not exist"
    );
}

#[test]
fn agents_message_insert_impl_inserts() {
    let conn = make_conn();
    let agent = agents_create_impl(&conn, valid_create_input()).unwrap();
    let thread = agents_thread_create_impl(
        &conn,
        ThreadCreateInput {
            agent_id: agent.id.clone(),
            title: None,
        },
    )
    .unwrap();

    let content = serde_json::json!({"text": "Hello, world!"});
    let input = MessageInsertInput {
        thread_id: thread.id.clone(),
        role: MessageRole::User,
        content: content.clone(),
        run_id: Some("run-abc".to_string()),
    };
    let msg = agents_message_insert_impl(&conn, input).unwrap();

    assert!(!msg.id.is_empty(), "message id must be non-empty");
    assert_eq!(msg.thread_id, thread.id);
    assert!(matches!(msg.role, MessageRole::User));
    assert_eq!(msg.content, content);
    assert_eq!(msg.run_id.as_deref(), Some("run-abc"));

    let messages = agents_messages_list_impl(&conn, thread.id).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, msg.id);
}

// ── agents_messages_list ─────────────────────────────────────────────────────

#[test]
fn agents_messages_list_impl_orders_asc() {
    let conn = make_conn();
    let agent = agents_create_impl(&conn, valid_create_input()).unwrap();
    let thread = agents_thread_create_impl(
        &conn,
        ThreadCreateInput {
            agent_id: agent.id.clone(),
            title: None,
        },
    )
    .unwrap();

    // Insert messages with explicit created_at via storage layer to avoid
    // timing flakiness.
    let m1 = crate::storage::agents::MessageRow {
        id: "msg-early-00000000-0000-0000-0000-000000000001".to_string(),
        thread_id: thread.id.clone(),
        role: MessageRole::User,
        content: serde_json::json!({"text": "first"}),
        created_at: 1000,
        run_id: None,
    };
    let m2 = crate::storage::agents::MessageRow {
        id: "msg-late-00000000-0000-0000-0000-000000000002".to_string(),
        thread_id: thread.id.clone(),
        role: MessageRole::Assistant,
        content: serde_json::json!({"text": "second"}),
        created_at: 9000,
        run_id: None,
    };
    crate::storage::agents::insert_message(&conn, &m1).unwrap();
    crate::storage::agents::insert_message(&conn, &m2).unwrap();

    let messages = agents_messages_list_impl(&conn, thread.id).unwrap();
    assert_eq!(messages.len(), 2, "expected 2 messages");
    assert_eq!(messages[0].id, m1.id, "earliest message must be first");
    assert_eq!(messages[1].id, m2.id);
}
