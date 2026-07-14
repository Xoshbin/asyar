use crate::ai::providers;
use crate::ai::sse::LineBuffer;
use crate::ai::types::{
    ChatMessage, ChatParams, ChatStreamEventPayload, ProviderConfig, StreamEventPayload,
};
use crate::error::AppError;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};

pub async fn ai_stream_chat_impl<F>(
    provider_id: &str,
    config: ProviderConfig,
    messages: Vec<ChatMessage>,
    params: ChatParams,
    _stream_id: String,
    on_event: F,
) -> Result<(), AppError>
where
    F: Fn(ChatStreamEventPayload) + Send + Sync + 'static,
{
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
            if let Some(event) = providers::parse_stream_line(provider_id, &config, &line) {
                match event {
                    crate::ai::types::ChatStreamEvent::Token { token } => {
                        on_event(ChatStreamEventPayload::Token { token });
                    }
                    crate::ai::types::ChatStreamEvent::Status { status } => {
                        on_event(ChatStreamEventPayload::Status { status });
                    }
                }
            }
        }
    }

    if let Some(line) = line_buffer.flush() {
        if let Some(event) = providers::parse_stream_line(provider_id, &config, &line) {
            match event {
                crate::ai::types::ChatStreamEvent::Token { token } => {
                    on_event(ChatStreamEventPayload::Token { token });
                }
                crate::ai::types::ChatStreamEvent::Status { status } => {
                    on_event(ChatStreamEventPayload::Status { status });
                }
            }
        }
    }

    on_event(ChatStreamEventPayload::Done);
    Ok(())
}

#[tauri::command]
pub async fn ai_stream_chat(
    app: AppHandle,
    provider_id: String,
    config: ProviderConfig,
    messages: Vec<ChatMessage>,
    params: ChatParams,
    stream_id: String,
) -> Result<(), AppError> {
    ai_stream_chat_impl(
        &provider_id,
        config,
        messages,
        params,
        stream_id.clone(),
        move |event| {
            let payload = StreamEventPayload {
                stream_id: stream_id.clone(),
                event,
            };
            let _ = app.emit("ai-stream-event", payload);
        },
    )
    .await
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
            api_key: Some("key".to_string()),
            base_url: Some(format!("http://{}", addr)),
            last_model_id: None,
            open_ai_api_mode: None,
            hosted_web_search: None,
            reasoning_effort: None,
        };

        let result = ai_stream_chat_impl(
            "custom",
            config,
            vec![ChatMessage {
                id: "1".to_string(),
                role: "user".to_string(),
                content: "Hello".to_string(),
                timestamp: 0,
            }],
            ChatParams {
                model_id: "test".to_string(),
                temperature: 0.7,
                max_tokens: 100,
                system_prompt: None,
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
