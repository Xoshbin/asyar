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
        crate::ai::types::ChatStreamEvent::Usage { usage } => {
            on_event(ChatStreamEventPayload::Usage { usage });
        }
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

pub async fn ai_stream_chat_impl<F>(
    provider_id: &str,
    config: ProviderConfig,
    messages: Vec<ChatMessage>,
    params: ChatParams,
    stream_id: String,
    on_event: F,
) -> Result<(), AppError>
where
    F: Fn(ChatStreamEventPayload) + Send + Sync + 'static,
{
    if config.connection_mode.as_deref() == Some("cli") {
        return crate::ai::cli::cli_stream_chat_impl(
            provider_id,
            config,
            messages,
            params,
            stream_id,
            on_event,
        )
        .await;
    }

    let spec = providers::build_request(provider_id, &config, &messages, &params)?;

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

    let result: Result<(), AppError> = async {
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|error| AppError::Other(error.to_string()))?;
            for line in line_buffer.feed(&chunk) {
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
        Ok(())
    }
    .await;

    // Usage can precede a provider/transport failure. Flush it even on error,
    // but never publish partially assembled tool calls from a failed stream.
    for event in parser.finish()? {
        if result.is_ok() || matches!(event, crate::ai::types::ChatStreamEvent::Usage { .. }) {
            emit_stream_event(event, &on_event);
        }
    }
    if let Err(error) = result {
        on_event(ChatStreamEventPayload::Error {
            error: error.to_string(),
        });
        return Err(error);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::ChatMessage;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn test_ai_stream_chat_impl_forwards_usage_before_done() {
        use tokio::io::AsyncWriteExt;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0; 4096];
            let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut buf).await;
            let body = "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\ndata: [DONE]\n\n";
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        ai_stream_chat_impl(
            "openai",
            ProviderConfig {
                enabled: true,
                api_key: Some("key".into()),
                base_url: Some(format!("http://{addr}")),
                ..Default::default()
            },
            vec![],
            ChatParams {
                model_id: "test".into(),
                temperature: None,
                max_tokens: 100,
                system_prompt: None,
                tools: None,
            },
            "usage".into(),
            move |e| sink.lock().unwrap().push(serde_json::to_value(e).unwrap()),
        )
        .await
        .unwrap();
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["type"], "usage");
        assert_eq!(events[0]["usage"]["inputTokens"], 10);
        assert_eq!(events[1]["type"], "done");
    }

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
            api_key: Some("key".to_string()),
            base_url: Some(format!("http://{}", addr)),
            ..Default::default()
        };

        let result = ai_stream_chat_impl(
            "custom",
            config,
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
}
