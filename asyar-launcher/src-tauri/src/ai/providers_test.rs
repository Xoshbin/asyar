use super::providers::{build_request, ProviderStreamParser};
use super::types::{
    ChatMessage, ChatParams, ChatStreamEvent, ProviderConfig, ToolCall, ToolDefinition,
};
use serde_json::json;

fn mock_messages() -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            id: "1".to_string(),
            role: "user".to_string(),
            content: "Hello".to_string(),
            timestamp: 1000,
            tool_calls: None,
            tool_call_id: None,
            provider_context: None,
        },
        ChatMessage {
            id: "2".to_string(),
            role: "assistant".to_string(),
            content: "Hi there".to_string(),
            timestamp: 2000,
            tool_calls: None,
            tool_call_id: None,
            provider_context: None,
        },
    ]
}

fn mock_params(system: Option<&str>) -> ChatParams {
    ChatParams {
        model_id: "gpt-4o".to_string(),
        temperature: Some(0.7),
        max_tokens: 1024,
        system_prompt: system.map(|s| s.to_string()),
        tools: None,
    }
}

fn mock_config() -> ProviderConfig {
    ProviderConfig {
        enabled: true,
        name: None,
        provider_type: None,
        api_key: Some("test-key".to_string()),
        base_url: None,
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
        temperature: None,
        max_tokens: None,
    }
}

#[test]
fn test_provider_config_preserves_openai_api_mode_wire_key() {
    let config: ProviderConfig = serde_json::from_value(json!({
        "enabled": true,
        "openAIApiMode": "responses"
    }))
    .unwrap();

    assert_eq!(config.open_ai_api_mode.as_deref(), Some("responses"));
    let encoded = serde_json::to_value(config).unwrap();
    assert_eq!(encoded["openAIApiMode"], "responses");
    assert!(encoded.get("openAiApiMode").is_none());
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
    let mut parser = ProviderStreamParser::new("openai", &config);
    let event = parser.push_line(line).unwrap().remove(0);

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
    let mut parser = ProviderStreamParser::new("openai", &config);
    let event = parser.push_line(line).unwrap().remove(0);

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
    let mut parser = ProviderStreamParser::new("anthropic", &config);
    let event = parser.push_line(line).unwrap().remove(0);

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
    let mut parser = ProviderStreamParser::new("google", &config);
    let event = parser.push_line(line).unwrap().remove(0);

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
    let mut parser = ProviderStreamParser::new("ollama", &config);
    let event = parser.push_line(line).unwrap().remove(0);

    match event {
        ChatStreamEvent::Token { token } => assert_eq!(token, "local-token"),
        _ => panic!("Expected token event"),
    }
}

fn tool_params() -> ChatParams {
    let mut params = mock_params(Some("Use tools."));
    params.tools = Some(vec![ToolDefinition {
        name: "builtin__echo".to_string(),
        description: "Echo input".to_string(),
        parameters: serde_json::json!({ "type": "object" }),
    }]);
    params
}

fn tool_history() -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            id: "user-1".to_string(),
            role: "user".to_string(),
            content: "echo this".to_string(),
            timestamp: 1,
            tool_calls: None,
            tool_call_id: None,
            provider_context: None,
        },
        ChatMessage {
            id: "assistant-1".to_string(),
            role: "assistant".to_string(),
            content: String::new(),
            timestamp: 2,
            tool_calls: Some(vec![ToolCall {
                id: "call-1".to_string(),
                name: "builtin:echo".to_string(),
                input: serde_json::json!({ "value": "hello" }),
            }]),
            tool_call_id: None,
            provider_context: None,
        },
        ChatMessage {
            id: "tool-1".to_string(),
            role: "tool".to_string(),
            content: "{\"value\":\"hello\"}".to_string(),
            timestamp: 3,
            tool_calls: None,
            tool_call_id: Some("call-1".to_string()),
            provider_context: None,
        },
    ]
}

#[test]
fn test_build_openai_tool_request_preserves_tool_history() {
    let req = build_request("openai", &mock_config(), &tool_history(), &tool_params()).unwrap();
    let messages = req.body["messages"].as_array().unwrap();

    assert_eq!(messages[2]["tool_calls"][0]["id"], "call-1");
    assert_eq!(
        messages[2]["tool_calls"][0]["function"]["name"],
        "builtin__echo"
    );
    assert_eq!(
        messages[2]["tool_calls"][0]["function"]["arguments"],
        "{\"value\":\"hello\"}"
    );
    assert_eq!(messages[3]["role"], "tool");
    assert_eq!(messages[3]["tool_call_id"], "call-1");
}

#[test]
fn test_parse_openai_tool_call_across_chunks() {
    let config = mock_config();
    let mut parser = ProviderStreamParser::new("openai", &config);

    assert!(parser
        .push_line("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"builtin__echo\",\"arguments\":\"{\\\"value\\\":\"}}]}}]}")
        .unwrap()
        .is_empty());
    assert!(parser
        .push_line("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"hello\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}")
        .unwrap()
        .is_empty());

    let events = parser.finish().unwrap();
    assert!(matches!(
        &events[0],
        ChatStreamEvent::ToolCall { id, name, input }
            if id == "call-1"
                && name == "builtin__echo"
                && input == &serde_json::json!({ "value": "hello" })
    ));
}

#[test]
fn test_build_anthropic_tool_request_uses_content_blocks() {
    let req = build_request("anthropic", &mock_config(), &tool_history(), &tool_params()).unwrap();
    let messages = req.body["messages"].as_array().unwrap();

    assert_eq!(req.body["tools"][0]["name"], "builtin__echo");
    assert_eq!(messages[1]["content"][0]["type"], "tool_use");
    assert_eq!(messages[2]["role"], "user");
    assert_eq!(messages[2]["content"][0]["type"], "tool_result");
}

#[test]
fn test_parse_anthropic_tool_call_across_events() {
    let config = mock_config();
    let mut parser = ProviderStreamParser::new("anthropic", &config);
    parser
        .push_line("data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"call-a\",\"name\":\"builtin__echo\"}}")
        .unwrap();
    parser
        .push_line("data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"value\\\":\\\"hello\\\"}\"}}")
        .unwrap();
    let events = parser
        .push_line("data: {\"type\":\"content_block_stop\"}")
        .unwrap();

    assert!(matches!(
        &events[0],
        ChatStreamEvent::ToolCall { id, name, input }
            if id == "call-a"
                && name == "builtin__echo"
                && input == &serde_json::json!({ "value": "hello" })
    ));
}

#[test]
fn test_build_google_tool_request_includes_function_response_name() {
    let req = build_request("google", &mock_config(), &tool_history(), &tool_params()).unwrap();
    let contents = req.body["contents"].as_array().unwrap();

    assert_eq!(
        req.body["tools"][0]["functionDeclarations"][0]["name"],
        "builtin__echo"
    );
    assert_eq!(
        contents[1]["parts"][0]["functionCall"]["name"],
        "builtin__echo"
    );
    assert_eq!(contents[2]["parts"][0]["functionResponse"]["id"], "call-1");
    assert_eq!(
        contents[2]["parts"][0]["functionResponse"]["name"],
        "builtin__echo"
    );
}

#[test]
fn test_build_ollama_tool_request_uses_object_arguments() {
    let mut config = mock_config();
    config.base_url = Some("http://localhost:11434".to_string());
    let req = build_request("ollama", &config, &tool_history(), &tool_params()).unwrap();
    let messages = req.body["messages"].as_array().unwrap();

    assert_eq!(
        messages[2]["tool_calls"][0]["function"]["arguments"]["value"],
        "hello"
    );
    assert!(messages[2]["tool_calls"][0]["function"]["arguments"].is_object());
}

#[test]
fn test_build_openai_responses_tool_request_uses_function_items() {
    let mut config = mock_config();
    config.open_ai_api_mode = Some("responses".to_string());
    let req = build_request("openai", &config, &tool_history(), &tool_params()).unwrap();
    let input = req.body["input"].as_array().unwrap();

    assert!(input.iter().any(|item| {
        item["type"] == "function_call"
            && item["call_id"] == "call-1"
            && item["name"] == "builtin__echo"
    }));
    assert!(input
        .iter()
        .any(|item| { item["type"] == "function_call_output" && item["call_id"] == "call-1" }));
    assert_eq!(req.body["tools"][0]["name"], "builtin__echo");
}

#[test]
fn test_custom_responses_parser_emits_function_call() {
    let mut config = mock_config();
    config.open_ai_api_mode = Some("responses".to_string());
    let mut parser = ProviderStreamParser::new("custom", &config);
    let events = parser
        .push_line(
            "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"function_call\",\"call_id\":\"call-custom\",\"name\":\"builtin__echo\",\"arguments\":\"{\\\"value\\\":1}\"}}",
        )
        .unwrap();

    assert!(matches!(
        &events[0],
        ChatStreamEvent::ToolCall { id, name, input }
            if id == "call-custom"
                && name == "builtin__echo"
                && input == &serde_json::json!({ "value": 1 })
    ));
}

#[test]
fn test_build_request_and_parser_with_custom_named_instance() {
    let mut config = mock_config();
    config.name = Some("Local DeepSeek".into());
    config.provider_type = Some("custom".into());
    config.base_url = Some("http://localhost:8000/v1".into());

    let req = build_request("custom_deepseek_123", &config, &[], &mock_params(None)).unwrap();
    assert_eq!(req.url, "http://localhost:8000/v1/chat/completions");

    let mut parser = ProviderStreamParser::new("custom_deepseek_123", &config);
    let events = parser
        .push_line("data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}")
        .unwrap();
    assert_eq!(events.len(), 1);
    assert!(matches!(
        &events[0],
        ChatStreamEvent::Token { token } if token == "hello"
    ));
}

#[test]
fn test_build_openai_request_omits_temperature_when_none() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = None;

    let req = build_request("openai", &config, &messages, &params).unwrap();
    assert!(req.body.get("temperature").is_none());
}

#[test]
fn test_build_openai_request_includes_temperature_when_some() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = Some(0.85);

    let req = build_request("openai", &config, &messages, &params).unwrap();
    assert_eq!(req.body["temperature"], 0.85);
}

#[test]
fn test_build_custom_request_omits_temperature_when_none() {
    let mut config = mock_config();
    config.base_url = Some("https://api.opencode.ai/v1".to_string());
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.model_id = "gpt-5.6-luna".to_string();
    params.temperature = None;

    let req = build_request("custom", &config, &messages, &params).unwrap();
    assert_eq!(req.url, "https://api.opencode.ai/v1/chat/completions");
    assert_eq!(req.body["model"], "gpt-5.6-luna");
    assert!(
        req.body.get("temperature").is_none(),
        "Custom OpenAI-compatible provider must omit temperature when None"
    );
}

#[test]
fn test_build_custom_request_includes_temperature_when_some() {
    let mut config = mock_config();
    config.base_url = Some("https://api.opencode.ai/v1".to_string());
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = Some(0.3);

    let req = build_request("custom", &config, &messages, &params).unwrap();
    assert_eq!(req.body["temperature"], 0.3);
}

#[test]
fn test_build_custom_responses_request_omits_temperature_when_none() {
    let mut config = mock_config();
    config.base_url = Some("https://api.custom.ai/v1".to_string());
    config.open_ai_api_mode = Some("responses".to_string());
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = None;

    let req = build_request("custom", &config, &messages, &params).unwrap();
    assert!(req.body.get("temperature").is_none());
}

#[test]
fn test_build_openrouter_request_omits_temperature_when_none() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = None;

    let req = build_request("openrouter", &config, &messages, &params).unwrap();
    assert!(req.body.get("temperature").is_none());
}

#[test]
fn test_build_google_request_omits_temperature_when_none() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = None;

    let req = build_request("google", &config, &messages, &params).unwrap();
    assert!(req.body["generationConfig"].get("temperature").is_none());
}

#[test]
fn test_build_google_request_includes_temperature_when_some() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = Some(0.4);

    let req = build_request("google", &config, &messages, &params).unwrap();
    assert_eq!(req.body["generationConfig"]["temperature"], 0.4);
}

#[test]
fn test_build_anthropic_request_includes_temperature_when_some() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = Some(0.5);

    let req = build_request("anthropic", &config, &messages, &params).unwrap();
    assert_eq!(req.body["temperature"], 0.5);
}

#[test]
fn test_build_anthropic_request_omits_temperature_when_none() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = None;

    let req = build_request("anthropic", &config, &messages, &params).unwrap();
    assert!(req.body.get("temperature").is_none());
}

#[test]
fn test_build_ollama_request_omits_temperature_when_none() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = None;

    let req = build_request("ollama", &config, &messages, &params).unwrap();
    assert!(req.body.get("options").is_none());
}

#[test]
fn test_build_ollama_request_includes_temperature_when_some() {
    let config = mock_config();
    let messages = mock_messages();
    let mut params = mock_params(None);
    params.temperature = Some(0.6);

    let req = build_request("ollama", &config, &messages, &params).unwrap();
    assert_eq!(req.body["options"]["temperature"], 0.6);
}
