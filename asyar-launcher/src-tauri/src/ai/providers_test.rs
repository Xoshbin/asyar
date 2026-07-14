use super::providers::{build_request, parse_stream_line};
use super::types::{ChatMessage, ChatParams, ChatStreamEvent, ProviderConfig};

fn mock_messages() -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            id: "1".to_string(),
            role: "user".to_string(),
            content: "Hello".to_string(),
            timestamp: 1000,
        },
        ChatMessage {
            id: "2".to_string(),
            role: "assistant".to_string(),
            content: "Hi there".to_string(),
            timestamp: 2000,
        },
    ]
}

fn mock_params(system: Option<&str>) -> ChatParams {
    ChatParams {
        model_id: "gpt-4o".to_string(),
        temperature: 0.7,
        max_tokens: 1024,
        system_prompt: system.map(|s| s.to_string()),
    }
}

fn mock_config() -> ProviderConfig {
    ProviderConfig {
        enabled: true,
        api_key: Some("test-key".to_string()),
        base_url: None,
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    }
}

#[test]
fn test_build_openai_request() {
    let config = mock_config();
    let messages = mock_messages();
    let params = mock_params(Some("You are helpful."));
    let req = build_request("openai", &config, &messages, &params).unwrap();

    assert_eq!(req.url, "https://api.openai.com/v1/chat/completions");
    assert_eq!(req.headers.get("Authorization").unwrap(), "Bearer test-key");

    let body = req.body;
    assert_eq!(body.get("model").unwrap().as_str().unwrap(), "gpt-4o");
    let msgs_arr = body.get("messages").unwrap().as_array().unwrap();
    assert_eq!(msgs_arr.len(), 3);
    assert_eq!(msgs_arr[0].get("role").unwrap().as_str().unwrap(), "system");
    assert_eq!(
        msgs_arr[0].get("content").unwrap().as_str().unwrap(),
        "You are helpful."
    );
    assert_eq!(msgs_arr[1].get("role").unwrap().as_str().unwrap(), "user");
    assert_eq!(
        msgs_arr[1].get("content").unwrap().as_str().unwrap(),
        "Hello"
    );
}

#[test]
fn test_parse_openai_chunk() {
    let config = mock_config();
    let line = "data: {\"choices\": [{\"delta\": {\"content\": \"hello\"}}]}";
    let event = parse_stream_line("openai", &config, line).unwrap();

    match event {
        ChatStreamEvent::Token { token } => assert_eq!(token, "hello"),
        _ => panic!("Expected token event"),
    }
}

#[test]
fn test_build_openai_responses_request() {
    let mut config = mock_config();
    config.open_ai_api_mode = Some("responses".to_string());
    config.hosted_web_search = Some(true);
    let messages = mock_messages();
    let params = mock_params(None);
    let req = build_request("openai", &config, &messages, &params).unwrap();

    assert_eq!(req.url, "https://api.openai.com/v1/responses");
    let body = req.body;
    assert!(body.get("input").is_some());
    assert!(body.get("tools").is_some());
}

#[test]
fn test_parse_openai_responses_chunk() {
    let mut config = mock_config();
    config.open_ai_api_mode = Some("responses".to_string());

    let line = "data: {\"type\": \"response.output_text.delta\", \"delta\": \"world\"}";
    let event = parse_stream_line("openai", &config, line).unwrap();

    match event {
        ChatStreamEvent::Token { token } => assert_eq!(token, "world"),
        _ => panic!("Expected token event"),
    }
}

#[test]
fn test_build_anthropic_request() {
    let config = mock_config();
    let messages = mock_messages();
    let params = mock_params(Some("Helpful bot."));
    let req = build_request("anthropic", &config, &messages, &params).unwrap();

    assert_eq!(req.url, "https://api.anthropic.com/v1/messages");
    assert_eq!(req.headers.get("x-api-key").unwrap(), "test-key");
    assert_eq!(req.headers.get("anthropic-version").unwrap(), "2023-06-01");

    let body = req.body;
    assert_eq!(
        body.get("system").unwrap().as_str().unwrap(),
        "Helpful bot."
    );
    let msgs_arr = body.get("messages").unwrap().as_array().unwrap();
    assert_eq!(msgs_arr.len(), 2);
}

#[test]
fn test_parse_anthropic_chunk() {
    let config = mock_config();
    let line = "data: {\"type\": \"content_block_delta\", \"delta\": {\"type\": \"text_delta\", \"text\": \"bot-reply\"}}";
    let event = parse_stream_line("anthropic", &config, line).unwrap();

    match event {
        ChatStreamEvent::Token { token } => assert_eq!(token, "bot-reply"),
        _ => panic!("Expected token event"),
    }
}

#[test]
fn test_build_google_request() {
    let config = mock_config();
    let messages = mock_messages();
    let params = mock_params(Some("Google prompt."));
    let req = build_request("google", &config, &messages, &params).unwrap();

    assert!(req.url.contains("models/gpt-4o:streamGenerateContent"));
    assert_eq!(req.headers.get("x-goog-api-key").unwrap(), "test-key");

    let body = req.body;
    assert!(body.get("systemInstruction").is_some());
    let contents = body.get("contents").unwrap().as_array().unwrap();
    assert_eq!(contents.len(), 2);
}

#[test]
fn test_parse_google_chunk() {
    let config = mock_config();
    let line =
        "data: {\"candidates\": [{\"content\": {\"parts\": [{\"text\": \"gemini-token\"}]}}]}";
    let event = parse_stream_line("google", &config, line).unwrap();

    match event {
        ChatStreamEvent::Token { token } => assert_eq!(token, "gemini-token"),
        _ => panic!("Expected token event"),
    }
}

#[test]
fn test_build_ollama_request() {
    let config = mock_config();
    let messages = mock_messages();
    let params = mock_params(None);
    let req = build_request("ollama", &config, &messages, &params).unwrap();

    assert_eq!(req.url, "http://localhost:11434/api/chat");
}

#[test]
fn test_parse_ollama_chunk() {
    let config = mock_config();
    let line = "{\"message\": {\"content\": \"local-token\"}}";
    let event = parse_stream_line("ollama", &config, line).unwrap();

    match event {
        ChatStreamEvent::Token { token } => assert_eq!(token, "local-token"),
        _ => panic!("Expected token event"),
    }
}
