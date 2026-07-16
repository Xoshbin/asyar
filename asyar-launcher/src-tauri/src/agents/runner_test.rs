use crate::agents::runner::{
    build_system_prompt, coalesce_consecutive_messages, run_silent_agent_loop_impl,
    run_silent_loop_impl, run_thread_loop_impl, AgentRunConfig, AgentRunnerState, AgentStreamEvent,
    ExternalToolRequest,
};
use crate::agents::tools::ToolRegistry;
use crate::error::AppError;
use crate::storage::agents::{
    insert_agent, insert_thread, list_messages_for_thread, AgentRow, MessageRole, ThreadRow,
};
use rusqlite::Connection;
use serde_json::json;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

fn make_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db");
    conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
    crate::storage::agents::init_table(&conn).unwrap();
    conn
}

fn chat_message(role: &str, content: &str) -> crate::ai::types::ChatMessage {
    crate::ai::types::ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        role: role.to_string(),
        content: content.to_string(),
        timestamp: 0,
        tool_calls: None,
        tool_call_id: None,
        provider_context: None,
    }
}

fn run_config(
    provider: crate::ai::types::ProviderConfig,
    temperature: f64,
    max_tokens: u32,
) -> AgentRunConfig {
    AgentRunConfig {
        provider,
        temperature,
        max_tokens,
    }
}

#[test]
fn test_coalesce_consecutive_user_messages() {
    let messages = vec![
        chat_message("user", "first"),
        chat_message("user", "second"),
        chat_message("assistant", "answer"),
    ];

    let coalesced = coalesce_consecutive_messages(messages);

    assert_eq!(coalesced.len(), 2);
    assert_eq!(coalesced[0].role, "user");
    assert_eq!(coalesced[0].content, "first\n\nsecond");
    assert_eq!(coalesced[1].content, "answer");
}

#[tokio::test]
async fn test_system_prompt_adds_hosted_search_date_guidance() {
    let prompt = build_system_prompt(" Be concise. ", true, None, None).await;

    assert!(prompt.starts_with("The available horizontal display space is 400px."));
    assert!(prompt.contains("Be concise."));
    assert!(prompt.contains("Today is "));
    assert!(prompt.contains("Use web search for facts that may have changed"));
}

#[tokio::test]
async fn test_runner_state_reports_only_matching_tool_result() {
    let state = AgentRunnerState::default();
    let receiver = state
        .begin_tool_call(
            "stream-1",
            &ExternalToolRequest {
                tool_call_id: "call-1".to_string(),
                tool_id: "extension:tool".to_string(),
                arguments: json!({}),
            },
        )
        .unwrap();

    let mismatch =
        state.report_tool_result("stream-1", "wrong-call", json!({ "ignored": true }), None);
    assert!(mismatch.is_err());

    state
        .report_tool_result("stream-1", "call-1", json!({ "answer": 42 }), None)
        .unwrap();
    assert_eq!(receiver.await.unwrap().unwrap(), json!({ "answer": 42 }));
}

#[tokio::test]
async fn test_runner_state_reports_only_matching_mcp_permission_decision() {
    let state = AgentRunnerState::default();
    let receiver = state.begin_mcp_permission("stream-1", "call-1").unwrap();

    let mismatch = state.report_mcp_permission(
        "stream-1",
        "wrong-call",
        crate::agents::runner::McpPermissionChoice::AllowOnce,
    );
    assert!(mismatch.is_err());

    state
        .report_mcp_permission(
            "stream-1",
            "call-1",
            crate::agents::runner::McpPermissionChoice::AllowAlways,
        )
        .unwrap();
    assert_eq!(
        receiver.await.unwrap(),
        crate::agents::runner::McpPermissionChoice::AllowAlways
    );
}

#[test]
fn test_mcp_permission_event_serializes_as_typed_frontend_contract() {
    let event = AgentStreamEvent::McpPermissionRequest {
        tool_call_id: "call-1".to_string(),
        server_id: "linear".to_string(),
        tool_id: "create_issue".to_string(),
        agent_id: "agent-1".to_string(),
    };

    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({
            "type": "mcp_permission_request",
            "tool_call_id": "call-1",
            "server_id": "linear",
            "tool_id": "create_issue",
            "agent_id": "agent-1",
        })
    );
}

#[tokio::test]
async fn test_runner_state_cancels_active_stream() {
    let state = AgentRunnerState::default();
    let mut cancellation = state.begin_run("stream-cancel").unwrap();

    assert!(!*cancellation.borrow());
    state.cancel_run("stream-cancel").unwrap();
    cancellation.changed().await.unwrap();
    assert!(*cancellation.borrow());
}

#[test]
fn test_runner_state_cancellation_is_idempotent_after_receiver_closes() {
    let state = AgentRunnerState::default();
    let cancellation = state.begin_run("stream-finished").unwrap();
    drop(cancellation);

    assert!(state.cancel_run("stream-finished").is_ok());
    assert!(state.finish_run("stream-finished").is_ok());
}

#[test]
fn test_runner_state_remembers_cancel_before_command_starts() {
    let state = AgentRunnerState::default();

    state.cancel_run("stream-late").unwrap();
    let cancellation = state.begin_run("stream-late").unwrap();

    assert!(*cancellation.borrow());
}

#[tokio::test]
async fn test_silent_runner_rejects_non_silent_agent() {
    let agent = AgentRow {
        id: "agent-chat-only".to_string(),
        name: "Chat only".to_string(),
        description: None,
        system_prompt: String::new(),
        provider_id: "openai".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
        silent: false,
        input_source: crate::storage::agents::SilentInputSource::Argument,
        output_action: crate::storage::agents::SilentOutputAction::ReplaceSelection,
        cache_responses: false,
        shortcode_trigger: ":".to_string(),
        created_at: None,
        updated_at: None,
    };
    let provider = crate::ai::types::ProviderConfig {
        enabled: true,
        api_key: Some("test-key".to_string()),
        base_url: Some("http://127.0.0.1:9".to_string()),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    };

    let error = run_silent_agent_loop_impl(
        &agent,
        &ToolRegistry::new(),
        "hello".to_string(),
        run_config(provider, 0.7, 2048),
        |_| {},
        |_| async { Err(AppError::Other("unexpected tool dispatch".to_string())) },
        None,
    )
    .await
    .unwrap_err();

    assert!(error
        .to_string()
        .contains("is not configured for silent execution"));
}

fn shortcode_miss_agent() -> AgentRow {
    AgentRow {
        id: "agent-emoji-fallback".to_string(),
        name: "Inline Emoji Fallback".to_string(),
        description: None,
        system_prompt: "resolve emoji".to_string(),
        provider_id: "openai".to_string(),
        model_id: "gpt-4o".to_string(),
        tool_selection: vec![],
        silent: true,
        input_source: crate::storage::agents::SilentInputSource::ShortcodeMiss,
        output_action: crate::storage::agents::SilentOutputAction::Paste,
        cache_responses: true,
        shortcode_trigger: ":".to_string(),
        created_at: None,
        updated_at: None,
    }
}

async fn run_shortcode_miss_with_mocked_reply(reply_chunks: &[&str]) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let body = reply_chunks
        .iter()
        .map(|chunk| format!("data: {{\"choices\":[{{\"delta\":{{\"content\":{chunk}}}}}]}}\n\n"))
        .collect::<String>();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0; 4096];
        let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut buf)
            .await
            .unwrap();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n{body}data: [DONE]\n\n"
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });

    let provider = crate::ai::types::ProviderConfig {
        enabled: true,
        api_key: Some("test-key".to_string()),
        base_url: Some(format!("http://127.0.0.1:{port}")),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    };

    run_silent_agent_loop_impl(
        &shortcode_miss_agent(),
        &ToolRegistry::new(),
        "party".to_string(),
        run_config(provider, 0.7, 2048),
        |_| {},
        |_| async { Err(AppError::Other("unexpected tool dispatch".to_string())) },
        None,
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn test_silent_runner_sanitizes_shortcode_miss_prose_to_empty() {
    let result =
        run_shortcode_miss_with_mocked_reply(&["\"Here are some \"", "\"party ideas!\""]).await;

    assert_eq!(
        result, "",
        "prose from a ShortcodeMiss agent must be sanitized to empty, not pasted verbatim"
    );
}

#[tokio::test]
async fn test_silent_runner_passes_through_a_single_emoji_for_shortcode_miss() {
    let result = run_shortcode_miss_with_mocked_reply(&["\"🎉\""]).await;

    assert_eq!(result, "🎉");
}

#[tokio::test]
async fn test_thread_runner_rejects_thread_owned_by_another_agent() {
    let conn = make_conn();
    let now = chrono::Utc::now().timestamp_millis();
    for id in ["agent-1", "agent-2"] {
        insert_agent(
            &conn,
            &AgentRow {
                id: id.to_string(),
                name: id.to_string(),
                description: None,
                system_prompt: String::new(),
                provider_id: "openai".to_string(),
                model_id: "gpt-4o".to_string(),
                tool_selection: vec![],
                silent: false,
                input_source: crate::storage::agents::SilentInputSource::Argument,
                output_action: crate::storage::agents::SilentOutputAction::ReplaceSelection,
                cache_responses: false,
                shortcode_trigger: ":".to_string(),
                created_at: Some(now),
                updated_at: Some(now),
            },
        )
        .unwrap();
    }
    insert_thread(
        &conn,
        &ThreadRow {
            id: "thread-2".to_string(),
            agent_id: "agent-2".to_string(),
            title: None,
            created_at: Some(now),
            updated_at: Some(now),
        },
    )
    .unwrap();
    let provider = crate::ai::types::ProviderConfig {
        enabled: true,
        api_key: Some("test-key".to_string()),
        base_url: Some("http://127.0.0.1:9".to_string()),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    };
    let store = crate::storage::DataStore::from_conn(conn);

    let error = run_thread_loop_impl(
        &store,
        &ToolRegistry::new(),
        "agent-1",
        "thread-2",
        "hello".to_string(),
        None,
        run_config(provider, 0.7, 2048),
        |_| {},
        |_| async { Err(AppError::Other("unexpected tool dispatch".to_string())) },
        None,
    )
    .await
    .unwrap_err();

    assert!(error
        .to_string()
        .contains("does not belong to agent 'agent-1'"));
    assert!(list_messages_for_thread(&store.conn().unwrap(), "thread-2")
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn test_run_thread_loop_text_only() {
    // 1. Mock TCP Server for LLM responses
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let (request_tx, request_rx) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0; 4096];
        let bytes_read = tokio::io::AsyncReadExt::read(&mut socket, &mut buf)
            .await
            .unwrap();
        let _ = request_tx.send(String::from_utf8_lossy(&buf[..bytes_read]).to_string());

        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n\
                        data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n\
                        data: {\"choices\":[{\"delta\":{\"content\":\"world!\"}}]}\n\n\
                        data: [DONE]\n\n";
        socket.write_all(response.as_bytes()).await.unwrap();
    });

    let conn = make_conn();

    // Insert mock agent & thread
    let agent_id = "agent-1".to_string();
    let thread_id = "thread-1".to_string();
    let now = chrono::Utc::now().timestamp_millis();

    insert_agent(
        &conn,
        &AgentRow {
            id: agent_id.clone(),
            name: "Test Agent".to_string(),
            description: None,
            system_prompt: "Be a helpful assistant.".to_string(),
            provider_id: "openai".to_string(),
            model_id: "gpt-4o".to_string(),
            tool_selection: vec![],
            silent: false,
            input_source: crate::storage::agents::SilentInputSource::Argument,
            output_action: crate::storage::agents::SilentOutputAction::ReplaceSelection,
            cache_responses: false,
            shortcode_trigger: ":".to_string(),
            created_at: Some(now),
            updated_at: Some(now),
        },
    )
    .unwrap();

    insert_thread(
        &conn,
        &ThreadRow {
            id: thread_id.clone(),
            agent_id: agent_id.clone(),
            title: None,
            created_at: Some(now),
            updated_at: Some(now),
        },
    )
    .unwrap();

    let registry = Arc::new(ToolRegistry::new());

    let config = crate::ai::types::ProviderConfig {
        enabled: true,
        api_key: Some("test-key".to_string()),
        base_url: Some(format!("http://127.0.0.1:{}", port)),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    };

    let tokens_clone = Arc::new(std::sync::Mutex::new(Vec::new()));
    let t_clone = tokens_clone.clone();
    let on_event = move |event: AgentStreamEvent| {
        if let AgentStreamEvent::TextDelta { delta, .. } = event {
            if let Ok(mut t) = t_clone.lock() {
                t.push(delta);
            }
        }
    };

    let store = crate::storage::DataStore::from_conn(conn);

    run_thread_loop_impl(
        &store,
        &registry,
        &agent_id,
        &thread_id,
        "Hello".to_string(),
        None,
        run_config(config, 0.25, 123),
        on_event,
        |_| async {
            Err(AppError::Other(
                "unexpected external tool dispatch".to_string(),
            ))
        },
        None,
    )
    .await
    .unwrap();

    let request = request_rx.await.unwrap();
    assert!(request.contains("\"temperature\":0.25"));
    assert!(request.contains("\"max_tokens\":123"));

    let msgs = list_messages_for_thread(&store.conn().unwrap(), &thread_id).unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].role, MessageRole::User);
    assert_eq!(msgs[0].content["text"].as_str().unwrap(), "Hello");

    assert_eq!(msgs[1].role, MessageRole::Assistant);
    assert_eq!(msgs[1].content["text"].as_str().unwrap(), "Hello world!");
    assert_eq!(
        crate::storage::agents::get_thread(&store.conn().unwrap(), &thread_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("Hello")
    );

    let final_tokens = tokens_clone.lock().unwrap();
    assert_eq!(final_tokens.join(""), "Hello world!");
}

#[tokio::test]
async fn test_run_thread_loop_with_tool_call() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        // Turn 0 Connection
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0; 4096];
        let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut buf)
            .await
            .unwrap();

        let response_turn_0 = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n\
data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-abc\",\"type\":\"function\",\"function\":{\"name\":\"builtin__echo\",\"arguments\":\"{\\\"message\\\":\\\"hello\\\"}\"}}]}}]}\n\ndata: [DONE]\n\n";
        socket.write_all(response_turn_0.as_bytes()).await.unwrap();
        drop(socket);

        // Turn 1 Connection
        let (mut socket2, _) = listener.accept().await.unwrap();
        let _ = tokio::io::AsyncReadExt::read(&mut socket2, &mut buf)
            .await
            .unwrap();

        let response_turn_1 = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n\
data: {\"choices\":[{\"delta\":{\"content\":\"Final result!\"}}]}\n\ndata: [DONE]\n\n";
        socket2.write_all(response_turn_1.as_bytes()).await.unwrap();
    });

    let conn = make_conn();
    let agent_id = "agent-tool".to_string();
    let thread_id = "thread-tool".to_string();
    let now = chrono::Utc::now().timestamp_millis();

    insert_agent(
        &conn,
        &AgentRow {
            id: agent_id.clone(),
            name: "Tool Agent".to_string(),
            description: None,
            system_prompt: "Helper".to_string(),
            provider_id: "openai".to_string(),
            model_id: "gpt-4o".to_string(),
            tool_selection: vec!["builtin:echo".to_string()],
            silent: false,
            input_source: crate::storage::agents::SilentInputSource::Argument,
            output_action: crate::storage::agents::SilentOutputAction::ReplaceSelection,
            cache_responses: false,
            shortcode_trigger: ":".to_string(),
            created_at: Some(now),
            updated_at: Some(now),
        },
    )
    .unwrap();

    insert_thread(
        &conn,
        &ThreadRow {
            id: thread_id.clone(),
            agent_id: agent_id.clone(),
            title: Some("Title".to_string()),
            created_at: Some(now),
            updated_at: Some(now),
        },
    )
    .unwrap();

    let registry = Arc::new(ToolRegistry::new());
    struct EchoTool;
    #[async_trait::async_trait]
    impl crate::agents::tools::BuiltinTool for EchoTool {
        fn descriptor(&self) -> crate::agents::tools::ToolDescriptor {
            crate::agents::tools::ToolDescriptor {
                id: "echo".to_string(),
                name: "echo".to_string(),
                description: "echo".to_string(),
                parameters: json!({}),
                source: crate::agents::tools::ToolSource::Builtin,
                fully_qualified_id: "builtin:echo".to_string(),
            }
        }
        async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
            Ok(args)
        }
    }
    registry.register_builtin(Arc::new(EchoTool)).unwrap();

    let config = crate::ai::types::ProviderConfig {
        enabled: true,
        api_key: Some("test-key".to_string()),
        base_url: Some(format!("http://127.0.0.1:{}", port)),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    };

    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let e_clone = events.clone();
    let on_event = move |event| {
        e_clone.lock().unwrap().push(event);
    };

    let store = crate::storage::DataStore::from_conn(conn);

    run_thread_loop_impl(
        &store,
        &registry,
        &agent_id,
        &thread_id,
        "Calculate".to_string(),
        None,
        run_config(config, 0.7, 2048),
        on_event,
        |_| async {
            Err(AppError::Other(
                "unexpected external tool dispatch".to_string(),
            ))
        },
        None,
    )
    .await
    .unwrap();

    let msgs = list_messages_for_thread(&store.conn().unwrap(), &thread_id).unwrap();
    assert_eq!(msgs.len(), 4);
    assert_eq!(msgs[0].role, MessageRole::User);

    assert_eq!(msgs[1].role, MessageRole::Assistant);
    let tool_calls = msgs[1].content["toolUse"].as_array().unwrap();
    assert_eq!(tool_calls.len(), 1);
    assert_eq!(tool_calls[0]["name"].as_str().unwrap(), "builtin:echo");
    assert_eq!(tool_calls[0]["input"]["message"].as_str().unwrap(), "hello");

    assert_eq!(msgs[2].role, MessageRole::Tool);
    assert_eq!(
        msgs[2].content["toolResult"]["output"]["message"]
            .as_str()
            .unwrap(),
        "hello"
    );

    assert_eq!(msgs[3].role, MessageRole::Assistant);
    assert_eq!(msgs[3].content["text"].as_str().unwrap(), "Final result!");
}

#[tokio::test]
async fn test_run_thread_loop_suspends_and_resumes_tier2_tool() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        // Turn 0 Connection
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0; 4096];
        let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut buf)
            .await
            .unwrap();

        let response_turn_0 = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n\
data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-xyz\",\"type\":\"function\",\"function\":{\"name\":\"extension__mytool\",\"arguments\":\"{\\\"param\\\":\\\"value\\\"}\"}}]}}]}\n\ndata: [DONE]\n\n";
        socket.write_all(response_turn_0.as_bytes()).await.unwrap();
        drop(socket);

        let (mut socket2, _) = listener.accept().await.unwrap();
        let _ = tokio::io::AsyncReadExt::read(&mut socket2, &mut buf)
            .await
            .unwrap();
        let response_turn_1 = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n\
data: {\"choices\":[{\"delta\":{\"content\":\"Extension result used\"}}]}\n\ndata: [DONE]\n\n";
        socket2.write_all(response_turn_1.as_bytes()).await.unwrap();
    });

    let conn = make_conn();
    let agent_id = "agent-suspend".to_string();
    let thread_id = "thread-suspend".to_string();
    let now = chrono::Utc::now().timestamp_millis();

    insert_agent(
        &conn,
        &AgentRow {
            id: agent_id.clone(),
            name: "Suspend Agent".to_string(),
            description: None,
            system_prompt: "Helper".to_string(),
            provider_id: "openai".to_string(),
            model_id: "gpt-4o".to_string(),
            tool_selection: vec!["extension:mytool".to_string()],
            silent: false,
            input_source: crate::storage::agents::SilentInputSource::Argument,
            output_action: crate::storage::agents::SilentOutputAction::ReplaceSelection,
            cache_responses: false,
            shortcode_trigger: ":".to_string(),
            created_at: Some(now),
            updated_at: Some(now),
        },
    )
    .unwrap();

    insert_thread(
        &conn,
        &ThreadRow {
            id: thread_id.clone(),
            agent_id: agent_id.clone(),
            title: Some("Title".to_string()),
            created_at: Some(now),
            updated_at: Some(now),
        },
    )
    .unwrap();

    let registry = Arc::new(ToolRegistry::new());
    // Create ToolDescriptor for extension:mytool so runner can resolve it
    registry
        .register_tier2(
            "extension",
            vec![crate::agents::tools::ManifestTool {
                id: "mytool".to_string(),
                name: "mytool".to_string(),
                description: "some extension tool".to_string(),
                parameters: json!({}),
            }],
        )
        .unwrap();

    let config = crate::ai::types::ProviderConfig {
        enabled: true,
        api_key: Some("test-key".to_string()),
        base_url: Some(format!("http://127.0.0.1:{}", port)),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    };

    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let e_clone = events.clone();
    let on_event = move |event| {
        e_clone.lock().unwrap().push(event);
    };
    let dispatched = Arc::new(std::sync::Mutex::new(Vec::new()));
    let dispatched_clone = dispatched.clone();
    let events_for_dispatch = events.clone();

    let store = crate::storage::DataStore::from_conn(conn);

    run_thread_loop_impl(
        &store,
        &registry,
        &agent_id,
        &thread_id,
        "Run extension".to_string(),
        None,
        run_config(config, 0.7, 2048),
        on_event,
        move |request| {
            events_for_dispatch
                .lock()
                .unwrap()
                .push(AgentStreamEvent::ToolDispatch {
                    tool_call_id: request.tool_call_id.clone(),
                    extension_id: "extension".to_string(),
                    tool_id: request.tool_id.clone(),
                    arguments: request.arguments.clone(),
                });
            dispatched_clone.lock().unwrap().push(request);
            async { Ok(json!({ "answer": 42 })) }
        },
        None,
    )
    .await
    .unwrap();

    let msgs = list_messages_for_thread(&store.conn().unwrap(), &thread_id).unwrap();
    assert_eq!(msgs.len(), 4);
    assert_eq!(msgs[0].role, MessageRole::User);
    assert_eq!(msgs[1].role, MessageRole::Assistant);
    let tool_calls = msgs[1].content["toolUse"].as_array().unwrap();
    assert_eq!(tool_calls.len(), 1);
    assert_eq!(tool_calls[0]["name"].as_str().unwrap(), "extension:mytool");
    assert_eq!(msgs[2].role, MessageRole::Tool);
    assert_eq!(msgs[2].content["toolResult"]["toolUseId"], "call-xyz");
    assert_eq!(msgs[2].content["toolResult"]["output"]["answer"], 42);
    assert_eq!(msgs[3].role, MessageRole::Assistant);
    assert_eq!(msgs[3].content["text"], "Extension result used");

    let dispatched = dispatched.lock().unwrap();
    assert_eq!(dispatched.len(), 1);
    assert_eq!(dispatched[0].tool_call_id, "call-xyz");
    assert_eq!(dispatched[0].tool_id, "extension:mytool");
    assert_eq!(dispatched[0].arguments, json!({ "param": "value" }));

    let events = events.lock().unwrap();
    assert!(events.iter().any(|event| matches!(
        event,
        AgentStreamEvent::ToolDispatch {
            tool_call_id,
            tool_id,
            arguments,
            ..
        } if tool_call_id == "call-xyz"
            && tool_id == "extension:mytool"
            && arguments == &json!({ "param": "value" })
    )));
}

#[tokio::test]
async fn test_run_silent_loop_is_ephemeral() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0; 4096];
        let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut buf)
            .await
            .unwrap();
        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n\
data: {\"choices\":[{\"delta\":{\"content\":\"Corrected text\"}}]}\n\ndata: [DONE]\n\n";
        socket.write_all(response.as_bytes()).await.unwrap();
    });

    let conn = make_conn();
    let agent_id = "silent-agent".to_string();
    let now = chrono::Utc::now().timestamp_millis();
    insert_agent(
        &conn,
        &AgentRow {
            id: agent_id.clone(),
            name: "Silent Agent".to_string(),
            description: None,
            system_prompt: "Correct grammar".to_string(),
            provider_id: "openai".to_string(),
            model_id: "gpt-4o".to_string(),
            tool_selection: vec![],
            silent: true,
            input_source: crate::storage::agents::SilentInputSource::Argument,
            output_action: crate::storage::agents::SilentOutputAction::ReplaceSelection,
            cache_responses: false,
            shortcode_trigger: ":".to_string(),
            created_at: Some(now),
            updated_at: Some(now),
        },
    )
    .unwrap();

    let store = crate::storage::DataStore::from_conn(conn);
    let registry = Arc::new(ToolRegistry::new());
    let config = crate::ai::types::ProviderConfig {
        enabled: true,
        api_key: Some("test-key".to_string()),
        base_url: Some(format!("http://127.0.0.1:{}", port)),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    };

    let before = {
        let conn = store.conn().unwrap();
        (
            conn.query_row("SELECT COUNT(*) FROM threads", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            conn.query_row("SELECT COUNT(*) FROM messages", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        )
    };

    let result = run_silent_loop_impl(
        &store,
        &registry,
        &agent_id,
        "helo".to_string(),
        run_config(config, 0.7, 2048),
        |_| {},
        |_| async {
            Err(AppError::Other(
                "unexpected external tool dispatch".to_string(),
            ))
        },
        None,
    )
    .await
    .unwrap();

    let after = {
        let conn = store.conn().unwrap();
        (
            conn.query_row("SELECT COUNT(*) FROM threads", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            conn.query_row("SELECT COUNT(*) FROM messages", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        )
    };

    assert_eq!(result, "Corrected text");
    assert_eq!(
        after, before,
        "silent execution must not write threads or messages"
    );
}
