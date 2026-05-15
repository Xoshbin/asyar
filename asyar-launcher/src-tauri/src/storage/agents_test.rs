#[allow(unused_imports)]
use crate::storage::agents::{
    delete_agent, delete_thread, get_agent, init_table, insert_agent, insert_message,
    insert_thread, list_agents, list_messages_for_thread, list_threads_for_agent, update_agent,
    AgentRow, MessageRole, MessageRow, ThreadRow,
};
use rusqlite::Connection;

fn make_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db");
    conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
    init_table(&conn).unwrap();
    conn
}

fn agent(id: &str, created_at: i64) -> AgentRow {
    AgentRow {
        id: id.to_string(),
        name: format!("Agent {id}"),
        description: Some("A test agent".to_string()),
        system_prompt: "You are helpful.".to_string(),
        provider_id: "openai".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
        created_at: Some(created_at),
        updated_at: Some(created_at),
    }
}

fn thread(id: &str, agent_id: &str, updated_at: i64) -> ThreadRow {
    ThreadRow {
        id: id.to_string(),
        agent_id: agent_id.to_string(),
        title: Some(format!("Thread {id}")),
        created_at: Some(updated_at),
        updated_at: Some(updated_at),
    }
}

fn message(id: &str, thread_id: &str, role: MessageRole, created_at: i64) -> MessageRow {
    MessageRow {
        id: id.to_string(),
        thread_id: thread_id.to_string(),
        role,
        content: serde_json::json!({"text": "hello"}),
        created_at,
        run_id: None,
    }
}

#[test]
fn init_table_creates_all_tables() {
    let conn = Connection::open_in_memory().unwrap();
    init_table(&conn).unwrap();

    let table_names: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
            )
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };

    assert!(
        table_names.contains(&"agents".to_string()),
        "agents table missing; found: {table_names:?}"
    );
    assert!(
        table_names.contains(&"threads".to_string()),
        "threads table missing; found: {table_names:?}"
    );
    assert!(
        table_names.contains(&"messages".to_string()),
        "messages table missing; found: {table_names:?}"
    );
}

#[test]
fn init_table_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    init_table(&conn).unwrap();
    init_table(&conn).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='agents'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn agent_round_trip() {
    let conn = make_conn();
    let mut a = agent("a1", 1000);
    a.tool_selection = vec!["builtin:search".to_string(), "ext.foo:bar".to_string()];
    a.description = None;

    insert_agent(&conn, &a).unwrap();
    let got = get_agent(&conn, "a1").unwrap().expect("agent not found");

    assert_eq!(got.id, a.id);
    assert_eq!(got.name, a.name);
    assert_eq!(got.description, a.description);
    assert_eq!(got.system_prompt, a.system_prompt);
    assert_eq!(got.provider_id, a.provider_id);
    assert_eq!(got.model_id, a.model_id);
    assert_eq!(got.tool_selection, vec!["builtin:search", "ext.foo:bar"]);
    assert_eq!(got.created_at, a.created_at);
    assert_eq!(got.updated_at, a.updated_at);
}

#[test]
fn list_agents_orders_by_created_at_asc() {
    let conn = make_conn();
    insert_agent(&conn, &agent("a2", 2000)).unwrap();
    insert_agent(&conn, &agent("a1", 1000)).unwrap();

    let rows = list_agents(&conn).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].id, "a1");
    assert_eq!(rows[1].id, "a2");
}

#[test]
fn update_agent_changes_fields() {
    let conn = make_conn();
    let mut a = agent("a1", 1000);
    insert_agent(&conn, &a).unwrap();

    a.name = "Updated Name".to_string();
    a.tool_selection = vec!["builtin:clipboard".to_string()];
    a.updated_at = Some(9999);
    update_agent(&conn, &a).unwrap();

    let got = get_agent(&conn, "a1").unwrap().expect("agent not found");
    assert_eq!(got.name, "Updated Name");
    assert_eq!(got.tool_selection, vec!["builtin:clipboard"]);
    assert_eq!(got.updated_at, Some(9999));
}

#[test]
fn delete_agent_cascades_to_threads_and_messages() {
    let conn = make_conn();
    conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

    let a = agent("a1", 1000);
    insert_agent(&conn, &a).unwrap();

    let t = thread("t1", "a1", 1000);
    insert_thread(&conn, &t).unwrap();

    insert_message(&conn, &message("m1", "t1", MessageRole::User, 1001)).unwrap();
    insert_message(&conn, &message("m2", "t1", MessageRole::Assistant, 1002)).unwrap();

    delete_agent(&conn, "a1").unwrap();

    let threads = list_threads_for_agent(&conn, "a1").unwrap();
    assert!(threads.is_empty(), "expected no threads after agent deleted");

    let msg_count: i64 = conn
        .query_row("SELECT count(*) FROM messages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(msg_count, 0, "expected cascade to delete messages");
}

#[test]
fn list_messages_for_thread_orders_ascending() {
    let conn = make_conn();
    let a = agent("a1", 1000);
    insert_agent(&conn, &a).unwrap();

    let t = thread("t1", "a1", 1000);
    insert_thread(&conn, &t).unwrap();

    insert_message(&conn, &message("m3", "t1", MessageRole::User, 3000)).unwrap();
    insert_message(&conn, &message("m1", "t1", MessageRole::User, 1000)).unwrap();
    insert_message(&conn, &message("m2", "t1", MessageRole::User, 2000)).unwrap();

    let msgs = list_messages_for_thread(&conn, "t1").unwrap();
    assert_eq!(msgs.len(), 3);
    assert_eq!(msgs[0].created_at, 1000);
    assert_eq!(msgs[1].created_at, 2000);
    assert_eq!(msgs[2].created_at, 3000);
}

#[test]
fn list_threads_for_agent_orders_by_updated_at_desc() {
    let conn = make_conn();
    let a = agent("a1", 1000);
    insert_agent(&conn, &a).unwrap();

    insert_thread(&conn, &thread("t1", "a1", 1000)).unwrap();
    insert_thread(&conn, &thread("t2", "a1", 5000)).unwrap();

    let threads = list_threads_for_agent(&conn, "a1").unwrap();
    assert_eq!(threads.len(), 2);
    assert_eq!(threads[0].id, "t2");
    assert_eq!(threads[1].id, "t1");
}

#[test]
fn messages_role_round_trips() {
    let conn = make_conn();
    insert_agent(&conn, &agent("a1", 1000)).unwrap();
    insert_thread(&conn, &thread("t1", "a1", 1000)).unwrap();

    insert_message(&conn, &message("m1", "t1", MessageRole::User, 1000)).unwrap();
    insert_message(&conn, &message("m2", "t1", MessageRole::Assistant, 2000)).unwrap();
    insert_message(&conn, &message("m3", "t1", MessageRole::Tool, 3000)).unwrap();

    let msgs = list_messages_for_thread(&conn, "t1").unwrap();
    assert_eq!(msgs.len(), 3);
    assert!(matches!(msgs[0].role, MessageRole::User));
    assert!(matches!(msgs[1].role, MessageRole::Assistant));
    assert!(matches!(msgs[2].role, MessageRole::Tool));
}

#[test]
fn messages_content_json_round_trips() {
    let conn = make_conn();
    insert_agent(&conn, &agent("a1", 1000)).unwrap();
    insert_thread(&conn, &thread("t1", "a1", 1000)).unwrap();

    let expected = serde_json::json!({
        "text": "hello",
        "toolUse": [{"id": "t1", "name": "search", "input": {"q": "x"}}]
    });
    let msg = MessageRow {
        id: "m1".to_string(),
        thread_id: "t1".to_string(),
        role: MessageRole::Assistant,
        content: expected.clone(),
        created_at: 1000,
        run_id: None,
    };
    insert_message(&conn, &msg).unwrap();

    let msgs = list_messages_for_thread(&conn, "t1").unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].content, expected);
}
