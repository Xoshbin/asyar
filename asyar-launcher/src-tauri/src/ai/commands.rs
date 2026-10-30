use crate::ai::providers;
use crate::ai::sse::LineBuffer;
use crate::ai::types::{ChatMessage, ChatParams, ChatStreamEventPayload, ProviderConfig};
use crate::error::AppError;
use futures_util::StreamExt;

fn emit_stream_event<F>(event: crate::ai::types::ChatStreamEvent, on_event: &F)
where
    F: Fn(ChatStreamEventPayload),
{
    match event {
        crate::ai::types::ChatStreamEvent::Token { token } => {
            on_event(ChatStreamEventPayload::Token { token });
        }
        crate::ai::types::ChatStreamEvent::Status { status } => {
            on_event(ChatStreamEventPayload::Status { status });
        }
        crate::ai::types::ChatStreamEvent::ToolCall { id, name, input } => {
            on_event(ChatStreamEventPayload::ToolCall { id, name, input });
        }
        crate::ai::types::ChatStreamEvent::ProviderContext { item } => {
            on_event(ChatStreamEventPayload::ProviderContext { item });
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn ai_stream_chat_impl<F>(
    provider_id: &str,
    config: ProviderConfig,
    resolved_api_key: Option<zeroize::Zeroizing<String>>,
    messages: Vec<ChatMessage>,
    params: ChatParams,
    stream_id: String,
    workspace_dir: Option<&std::path::Path>,
    codex_home_dir: Option<&std::path::Path>,
    on_event: F,
) -> Result<(), AppError>
where
    F: Fn(ChatStreamEventPayload) + Send + Sync + 'static,
{
    if config.connection_mode.as_deref() == Some("cli") {
        let workspace_dir = workspace_dir.ok_or_else(|| {
            AppError::Other("CLI connection requires workspace directory".to_string())
        })?;
        let default_codex_home = workspace_dir.parent().map(|p| p.join("codex-home"));
        let codex_home = codex_home_dir
            .or(default_codex_home.as_deref())
            .unwrap_or(workspace_dir);
        return crate::ai::cli::cli_stream_chat_impl(
            provider_id,
            config,
            messages,
            params,
            stream_id,
            workspace_dir,
            codex_home,
            on_event,
        )
        .await;
    }

    let key_to_use = resolved_api_key.as_deref().map(|s| s.as_str());

    let spec = providers::build_request(provider_id, &config, key_to_use, &messages, &params)?;

    let client = reqwest::Client::new();
    let timeout = if config.hosted_web_search == Some(true) {
        std::time::Duration::from_secs(120)
    } else {
        std::time::Duration::from_secs(30)
    };

    let mut req_builder = client.post(&spec.url);
    for (k, v) in spec.headers {
        req_builder = req_builder.header(k, v);
    }

    let response = req_builder.json(&spec.body).timeout(timeout).send().await;

    let res = match response {
        Ok(r) => r,
        Err(e) => {
            on_event(ChatStreamEventPayload::Error {
                error: e.to_string(),
            });
            return Err(AppError::Other(e.to_string()));
        }
    };

    if !res.status().is_success() {
        let status = res.status();
        let err_body = res
            .text()
            .await
            .unwrap_or_else(|_| format!("HTTP {}", status));
        on_event(ChatStreamEventPayload::Error {
            error: err_body.clone(),
        });
        return Err(AppError::Other(err_body));
    }

    let mut stream = res.bytes_stream();
    let mut line_buffer = LineBuffer::new();
    let mut parser = providers::ProviderStreamParser::new(provider_id, &config);

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                on_event(ChatStreamEventPayload::Error {
                    error: e.to_string(),
                });
                return Err(AppError::Other(e.to_string()));
            }
        };

        let lines = line_buffer.feed(&chunk);
        for line in lines {
            for event in parser.push_line(&line)? {
                emit_stream_event(event, &on_event);
            }
        }
    }

    if let Some(line) = line_buffer.flush() {
        for event in parser.push_line(&line)? {
            emit_stream_event(event, &on_event);
        }
    }

    for event in parser.finish()? {
        emit_stream_event(event, &on_event);
    }

    on_event(ChatStreamEventPayload::Done);
    Ok(())
}

#[tauri::command]
pub async fn ai_check_cli_status(
    provider_id: String,
    custom_path: Option<String>,
) -> Result<crate::ai::types::CliStatus, AppError> {
    Ok(crate::ai::cli::check_cli_status(&provider_id, custom_path.as_deref()).await)
}

pub use crate::storage::ai_credentials::{AiCredentialStatus, CredentialState, CredentialTarget};

#[tauri::command]
pub async fn ai_save_credential(
    target: CredentialTarget,
    secret: String,
    data_store: tauri::State<'_, crate::storage::DataStore>,
    keystore: tauri::State<'_, crate::crypto::keystore::KeystoreState>,
) -> Result<(), AppError> {
    let secret = zeroize::Zeroizing::new(secret);
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "Credential secret cannot be empty".to_string(),
        ));
    }
    let credential_id = target.to_credential_id()?;
    let conn = data_store.conn()?;
    crate::storage::ai_credentials::set(&conn, &credential_id, trimmed, keystore.master_key())?;
    Ok(())
}

#[tauri::command]
pub async fn ai_delete_credential(
    target: CredentialTarget,
    data_store: tauri::State<'_, crate::storage::DataStore>,
) -> Result<bool, AppError> {
    let credential_id = target.to_credential_id()?;
    let conn = data_store.conn()?;
    let deleted = crate::storage::ai_credentials::delete(&conn, &credential_id)?;
    Ok(deleted)
}

/// One state per keyed engine, so the UI can show each engine's own key independently.
pub(crate) fn web_search_states(
    cred_map: &std::collections::HashMap<String, CredentialState>,
) -> std::collections::HashMap<String, CredentialState> {
    crate::storage::ai_credentials::KEYED_WEB_SEARCH_ENGINES
        .iter()
        .map(|engine| {
            let state = cred_map
                .get(&crate::storage::ai_credentials::web_search_credential_id(
                    engine,
                ))
                .copied()
                .unwrap_or(CredentialState::NotConfigured);
            (engine.to_string(), state)
        })
        .collect()
}

#[tauri::command]
pub async fn ai_get_credential_status(
    app: tauri::AppHandle,
    data_store: tauri::State<'_, crate::storage::DataStore>,
    keystore: tauri::State<'_, crate::crypto::keystore::KeystoreState>,
) -> Result<AiCredentialStatus, AppError> {
    let conn = data_store.conn()?;
    let master_key = keystore.master_key();
    let cred_map = crate::storage::ai_credentials::list_all_statuses(&conn, master_key)?;

    let mut providers = std::collections::HashMap::new();

    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.dat") {
        if let Some(settings) = store.get("settings") {
            if let Some(providers_obj) = settings
                .get("ai")
                .and_then(|a| a.get("providers"))
                .and_then(|p| p.as_object())
            {
                for provider_id in providers_obj.keys() {
                    let cred_id = format!("provider:{provider_id}");
                    let state = cred_map
                        .get(&cred_id)
                        .copied()
                        .unwrap_or(CredentialState::NotConfigured);
                    providers.insert(provider_id.clone(), state);
                }
            }
        }
    }

    for (cred_id, state) in &cred_map {
        if let Some(provider_id) = cred_id.strip_prefix("provider:") {
            providers.entry(provider_id.to_string()).or_insert(*state);
        }
    }

    let web_search = web_search_states(&cred_map);

    Ok(AiCredentialStatus {
        providers,
        web_search,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::ChatMessage;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn test_ai_stream_chat_impl_success() {
        use tokio::io::AsyncWriteExt;
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0; 1024];
                let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut buf).await;

                let response = "HTTP/1.1 200 OK\r\n\
                                Content-Type: text/event-stream\r\n\
                                Transfer-Encoding: chunked\r\n\r\n\
                                36\r\n\
                                data: {\"choices\": [{\"delta\": {\"content\": \"hello\"}}]}\n\n\r\n\
                                0\r\n\r\n";
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let events = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();

        let config = ProviderConfig {
            enabled: true,
            base_url: Some(format!("http://{}", addr)),
            ..Default::default()
        };

        let result = ai_stream_chat_impl(
            "custom",
            config,
            None,
            vec![ChatMessage {
                id: "1".to_string(),
                role: "user".to_string(),
                content: "Hello".to_string(),
                timestamp: 0,
                tool_calls: None,
                tool_call_id: None,
                provider_context: None,
            }],
            ChatParams {
                model_id: "test".to_string(),
                temperature: Some(0.7),
                max_tokens: 100,
                system_prompt: None,
                tools: None,
            },
            "stream-123".to_string(),
            None,
            None,
            move |ev| {
                events_clone.lock().unwrap().push(ev);
            },
        )
        .await;

        assert!(result.is_ok());
        let evs = events.lock().unwrap();
        assert_eq!(evs.len(), 2);
        match &evs[0] {
            ChatStreamEventPayload::Token { token } => assert_eq!(token, "hello"),
            _ => panic!("Expected token event"),
        }
        match &evs[1] {
            ChatStreamEventPayload::Done => {}
            _ => panic!("Expected done event"),
        }
    }

    #[tokio::test]
    async fn test_ai_stream_chat_uses_resolved_stored_key_ignoring_ipc_config_key() {
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("POST", "/chat/completions")
            .match_header("Authorization", "Bearer stored-stream-key")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(
                "data: {\"choices\": [{\"delta\": {\"content\": \"hi\"}}]}\n\ndata: [DONE]\n\n",
            )
            .create_async()
            .await;

        let config = ProviderConfig {
            enabled: true,
            base_url: Some(server.url()),
            ..Default::default()
        };

        let resolved_api_key = Some(zeroize::Zeroizing::new("stored-stream-key".to_string()));

        let result = ai_stream_chat_impl(
            "custom",
            config,
            resolved_api_key,
            vec![ChatMessage {
                id: "1".to_string(),
                role: "user".to_string(),
                content: "Hello".to_string(),
                timestamp: 0,
                tool_calls: None,
                tool_call_id: None,
                provider_context: None,
            }],
            ChatParams {
                model_id: "test".to_string(),
                temperature: None,
                max_tokens: 100,
                system_prompt: None,
                tools: None,
            },
            "stream-test".to_string(),
            None,
            None,
            |_| {},
        )
        .await;

        assert!(result.is_ok());
        m.assert_async().await;
    }

    #[tokio::test]
    async fn test_list_models_uses_passed_key_ignoring_ipc_config_key() {
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("GET", "/v1/models")
            .match_header("Authorization", "Bearer stored-models-key")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"data":[{"id":"custom-model-1"}]}"#)
            .create_async()
            .await;

        let config = ProviderConfig {
            enabled: true,
            base_url: Some(format!("{}/v1", server.url())),
            ..Default::default()
        };

        let models = crate::ai::models::list_models("custom", &config, Some("stored-models-key"))
            .await
            .unwrap();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "custom-model-1");
        m.assert_async().await;
    }
}

#[cfg(test)]
mod web_search_status_tests {
    use super::*;
    use crate::storage::ai_credentials::{self, CredentialState};

    #[test]
    fn web_search_status_is_reported_per_keyed_engine() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::storage::migrations::run(&conn).unwrap();
        let key = [5u8; 32];
        ai_credentials::set(&conn, "web_search:brave", "k", &key).unwrap();
        ai_credentials::set(&conn, "web_search:serply", "k", &[6u8; 32]).unwrap();

        let all = ai_credentials::list_all_statuses(&conn, &key).unwrap();
        let states = web_search_states(&all);

        assert_eq!(states.len(), 3);
        assert_eq!(states["brave"], CredentialState::Configured);
        assert_eq!(states["tavily"], CredentialState::NotConfigured);
        assert_eq!(states["serply"], CredentialState::NeedsReentry);
    }

    #[test]
    fn web_search_targets_for_unkeyed_engines_are_rejected() {
        for engine in ["duckduckgo", "searxng", "bing", ""] {
            let target = CredentialTarget::WebSearch {
                engine: engine.into(),
            };
            assert!(target.to_credential_id().is_err(), "{engine:?}");
        }
    }
}
