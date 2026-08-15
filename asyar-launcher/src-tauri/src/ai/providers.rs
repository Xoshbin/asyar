use crate::ai::types::{ChatMessage, ChatParams, ChatStreamEvent, ProviderConfig, RequestSpec};
use crate::error::AppError;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

pub fn build_request(
    provider_id: &str,
    config: &ProviderConfig,
    messages: &[ChatMessage],
    params: &ChatParams,
) -> Result<RequestSpec, AppError> {
    let engine_type = config.provider_type.as_deref().unwrap_or(provider_id);
    match engine_type {
        "openai" => build_openai_request(config, messages, params),
        "anthropic" => build_anthropic_request(config, messages, params),
        "google" => build_google_request(config, messages, params),
        "ollama" => build_ollama_request(config, messages, params),
        "openrouter" => build_openrouter_request(config, messages, params),
        "custom" => build_custom_request(config, messages, params),
        _ => Err(AppError::Other(format!("Unknown provider: {provider_id}"))),
    }
}

#[derive(Default)]
struct PendingToolCall {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Default)]
struct AnthropicToolBlock {
    id: String,
    name: String,
    arguments: String,
}

/// Stateful parser for provider streaming protocols. Tool arguments may span
/// multiple SSE/NDJSON chunks, so parsing cannot be a stateless line mapping.
pub struct ProviderStreamParser {
    provider_id: String,
    config: ProviderConfig,
    openai_tools: BTreeMap<u32, PendingToolCall>,
    anthropic_tool: Option<AnthropicToolBlock>,
    google_tool_counter: u32,
    ollama_tool_counter: u32,
}

impl ProviderStreamParser {
    pub fn new(provider_id: &str, config: &ProviderConfig) -> Self {
        let engine_type = config
            .provider_type
            .clone()
            .unwrap_or_else(|| provider_id.to_string());
        Self {
            provider_id: engine_type,
            config: config.clone(),
            openai_tools: BTreeMap::new(),
            anthropic_tool: None,
            google_tool_counter: 0,
            ollama_tool_counter: 0,
        }
    }

    pub fn push_line(&mut self, line: &str) -> Result<Vec<ChatStreamEvent>, AppError> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        if self.provider_id == "ollama" {
            return self.parse_ollama(trimmed);
        }

        let Some(payload) = trimmed.strip_prefix("data: ").map(str::trim) else {
            return Ok(Vec::new());
        };
        if payload == "[DONE]" {
            return self.finish();
        }

        match self.provider_id.as_str() {
            "openai" | "custom" if self.config.open_ai_api_mode.as_deref() == Some("responses") => {
                self.parse_openai_responses(payload)
            }
            "openai" | "openrouter" | "custom" => self.parse_openai_compatible(payload),
            "anthropic" => self.parse_anthropic(payload),
            "google" => self.parse_google(payload),
            _ => Ok(Vec::new()),
        }
    }

    pub fn finish(&mut self) -> Result<Vec<ChatStreamEvent>, AppError> {
        let mut events = Vec::new();
        for (_, pending) in std::mem::take(&mut self.openai_tools) {
            let input = serde_json::from_str(&pending.arguments).unwrap_or_else(|_| json!({}));
            events.push(ChatStreamEvent::ToolCall {
                id: pending.id,
                name: pending.name,
                input,
            });
        }
        Ok(events)
    }

    fn parse_openai_compatible(&mut self, payload: &str) -> Result<Vec<ChatStreamEvent>, AppError> {
        let value: Value = serde_json::from_str(payload).map_err(|error| {
            AppError::Other(format!("invalid OpenAI-compatible stream event: {error}"))
        })?;
        let Some(choice) = value.get("choices").and_then(|choices| choices.get(0)) else {
            return Ok(Vec::new());
        };
        let mut events = Vec::new();
        if let Some(delta) = choice.get("delta") {
            for item in delta
                .get("reasoning_details")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                events.push(ChatStreamEvent::ProviderContext { item: item.clone() });
            }
            if let Some(content) = delta.get("content").and_then(Value::as_str) {
                if !content.is_empty() {
                    events.push(ChatStreamEvent::Token {
                        token: content.to_string(),
                    });
                }
            }
            for tool_call in delta
                .get("tool_calls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let index = tool_call.get("index").and_then(Value::as_u64).unwrap_or(0) as u32;
                let pending = self.openai_tools.entry(index).or_default();
                if let Some(id) = tool_call.get("id").and_then(Value::as_str) {
                    pending.id = id.to_string();
                }
                if let Some(function) = tool_call.get("function") {
                    if let Some(name) = function.get("name").and_then(Value::as_str) {
                        pending.name = name.to_string();
                    }
                    if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                        pending.arguments.push_str(arguments);
                    }
                }
            }
        }
        Ok(events)
    }

    fn parse_openai_responses(&mut self, payload: &str) -> Result<Vec<ChatStreamEvent>, AppError> {
        let value: Value = serde_json::from_str(payload)
            .map_err(|error| AppError::Other(format!("invalid OpenAI Responses event: {error}")))?;
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match event_type {
            "response.web_search_call.in_progress" | "response.web_search_call.searching" => {
                Ok(vec![ChatStreamEvent::Status {
                    status: "searching".to_string(),
                }])
            }
            "response.output_text.delta" => Ok(value
                .get("delta")
                .and_then(Value::as_str)
                .map(|token| {
                    vec![ChatStreamEvent::Token {
                        token: token.to_string(),
                    }]
                })
                .unwrap_or_default()),
            "response.output_item.done" => {
                let Some(item) = value.get("item") else {
                    return Ok(Vec::new());
                };
                match item.get("type").and_then(Value::as_str) {
                    Some("reasoning") => Ok(vec![ChatStreamEvent::ProviderContext {
                        item: item.clone(),
                    }]),
                    Some("function_call") => {
                        let arguments = item
                            .get("arguments")
                            .and_then(Value::as_str)
                            .unwrap_or("{}");
                        Ok(vec![ChatStreamEvent::ToolCall {
                            id: item
                                .get("call_id")
                                .or_else(|| item.get("id"))
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                            name: item
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                            input: serde_json::from_str(arguments).unwrap_or_else(|_| json!({})),
                        }])
                    }
                    _ => Ok(Vec::new()),
                }
            }
            "error" | "response.failed" => {
                let error = value
                    .get("error")
                    .or_else(|| value.pointer("/response/error"));
                let message = error
                    .and_then(|error| {
                        error
                            .as_str()
                            .or_else(|| error.get("message").and_then(Value::as_str))
                    })
                    .unwrap_or("OpenAI Responses request failed");
                Err(AppError::Other(message.to_string()))
            }
            _ => Ok(Vec::new()),
        }
    }

    fn parse_anthropic(&mut self, payload: &str) -> Result<Vec<ChatStreamEvent>, AppError> {
        let value: Value = serde_json::from_str(payload)
            .map_err(|error| AppError::Other(format!("invalid Anthropic stream event: {error}")))?;
        match value.get("type").and_then(Value::as_str) {
            Some("content_block_start") => {
                let block = value.get("content_block").unwrap_or(&Value::Null);
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    self.anthropic_tool = Some(AnthropicToolBlock {
                        id: block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        name: block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        arguments: String::new(),
                    });
                }
                Ok(Vec::new())
            }
            Some("content_block_delta") => {
                let delta = value.get("delta").unwrap_or(&Value::Null);
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => Ok(delta
                        .get("text")
                        .and_then(Value::as_str)
                        .map(|token| {
                            vec![ChatStreamEvent::Token {
                                token: token.to_string(),
                            }]
                        })
                        .unwrap_or_default()),
                    Some("input_json_delta") => {
                        if let (Some(tool), Some(partial)) = (
                            self.anthropic_tool.as_mut(),
                            delta.get("partial_json").and_then(Value::as_str),
                        ) {
                            tool.arguments.push_str(partial);
                        }
                        Ok(Vec::new())
                    }
                    _ => Ok(Vec::new()),
                }
            }
            Some("content_block_stop") => {
                let Some(tool) = self.anthropic_tool.take() else {
                    return Ok(Vec::new());
                };
                Ok(vec![ChatStreamEvent::ToolCall {
                    id: tool.id,
                    name: tool.name,
                    input: serde_json::from_str(&tool.arguments).unwrap_or_else(|_| json!({})),
                }])
            }
            Some("error") => {
                let message = value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Anthropic request failed");
                Err(AppError::Other(message.to_string()))
            }
            _ => Ok(Vec::new()),
        }
    }

    fn parse_google(&mut self, payload: &str) -> Result<Vec<ChatStreamEvent>, AppError> {
        let value: Value = serde_json::from_str(payload)
            .map_err(|error| AppError::Other(format!("invalid Gemini stream event: {error}")))?;
        let mut events = Vec::new();
        for part in value
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(token) = part.get("text").and_then(Value::as_str) {
                if !token.is_empty() {
                    events.push(ChatStreamEvent::Token {
                        token: token.to_string(),
                    });
                }
            } else if let Some(call) = part.get("functionCall") {
                self.google_tool_counter += 1;
                events.push(ChatStreamEvent::ToolCall {
                    id: call
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("gemini-{}", self.google_tool_counter)),
                    name: call
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    input: call.get("args").cloned().unwrap_or_else(|| json!({})),
                });
            }
        }
        Ok(events)
    }

    fn parse_ollama(&mut self, payload: &str) -> Result<Vec<ChatStreamEvent>, AppError> {
        let value: Value = serde_json::from_str(payload)
            .map_err(|error| AppError::Other(format!("invalid Ollama stream event: {error}")))?;
        let mut events = Vec::new();
        if let Some(token) = value.pointer("/message/content").and_then(Value::as_str) {
            if !token.is_empty() {
                events.push(ChatStreamEvent::Token {
                    token: token.to_string(),
                });
            }
        }
        for call in value
            .pointer("/message/tool_calls")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(name) = call.pointer("/function/name").and_then(Value::as_str) else {
                continue;
            };
            self.ollama_tool_counter += 1;
            events.push(ChatStreamEvent::ToolCall {
                id: format!("ollama-{}", self.ollama_tool_counter),
                name: name.to_string(),
                input: call
                    .pointer("/function/arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            });
        }
        Ok(events)
    }
}

fn encode_tool_id_for_wire(id: &str) -> String {
    id.replace(':', "__").replace('.', "--")
}

fn openai_messages(messages: &[ChatMessage], stringify_tool_arguments: bool) -> Vec<Value> {
    messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| match message.role.as_str() {
            "assistant" => {
                let mut value = json!({
                    "role": "assistant",
                    "content": message.content,
                });
                if let Some(tool_calls) = &message.tool_calls {
                    value["tool_calls"] = Value::Array(
                        tool_calls
                            .iter()
                            .map(|tool_call| {
                                json!({
                                    "id": tool_call.id,
                                    "type": "function",
                                    "function": {
                                        "name": encode_tool_id_for_wire(&tool_call.name),
                                        "arguments": if stringify_tool_arguments {
                                            Value::String(tool_call.input.to_string())
                                        } else {
                                            tool_call.input.clone()
                                        },
                                    },
                                })
                            })
                            .collect(),
                    );
                }
                if let Some(context) = &message.provider_context {
                    if !context.is_empty() {
                        value["reasoning_details"] = Value::Array(context.clone());
                    }
                }
                value
            }
            "tool" => json!({
                "role": "tool",
                "tool_call_id": message.tool_call_id,
                "content": message.content,
            }),
            _ => json!({ "role": message.role, "content": message.content }),
        })
        .collect()
}

fn openai_tool_definitions(params: &ChatParams) -> Vec<Value> {
    params
        .tools
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            })
        })
        .collect()
}

fn openai_responses_input(messages: &[ChatMessage], system_prompt: Option<&str>) -> Vec<Value> {
    let mut input = Vec::new();
    if let Some(system_prompt) = system_prompt.filter(|prompt| !prompt.trim().is_empty()) {
        input.push(json!({ "role": "system", "content": system_prompt }));
    }
    for message in messages.iter().filter(|message| message.role != "system") {
        match message.role.as_str() {
            "assistant" => {
                input.extend(message.provider_context.clone().unwrap_or_default());
                if !message.content.is_empty() {
                    input.push(json!({ "role": "assistant", "content": message.content }));
                }
                for tool_call in message.tool_calls.as_deref().unwrap_or_default() {
                    input.push(json!({
                        "type": "function_call",
                        "call_id": tool_call.id,
                        "name": encode_tool_id_for_wire(&tool_call.name),
                        "arguments": tool_call.input.to_string(),
                    }));
                }
            }
            "tool" => {
                if let Some(tool_call_id) = &message.tool_call_id {
                    input.push(json!({
                        "type": "function_call_output",
                        "call_id": tool_call_id,
                        "output": message.content,
                    }));
                }
            }
            _ => input.push(json!({
                "role": message.role,
                "content": message.content,
            })),
        }
    }
    input
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

fn build_openai_request(
    config: &ProviderConfig,
    messages: &[ChatMessage],
    params: &ChatParams,
) -> Result<RequestSpec, AppError> {
    let api_key = config.api_key.as_deref().unwrap_or("");
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.openai.com/v1");
    let is_responses = config.open_ai_api_mode.as_deref() == Some("responses");

    let url = if is_responses {
        format!("{}/responses", base_url.trim_end_matches('/'))
    } else {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    };

    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("Authorization".to_string(), format!("Bearer {api_key}"));

    let body = if is_responses {
        let input = openai_responses_input(messages, params.system_prompt.as_deref());

        let mut body_map = json!({
            "model": params.model_id,
            "input": input,
            "stream": true,
            "store": false,
            "include": ["reasoning.encrypted_content"]
        });

        if let Some(obj) = body_map.as_object_mut() {
            obj.insert("max_output_tokens".to_string(), json!(params.max_tokens));
            obj.insert("temperature".to_string(), json!(params.temperature));

            if let Some(ref effort) = config.reasoning_effort {
                obj.insert("reasoning".to_string(), json!({ "effort": effort }));
            }
            let mut tools: Vec<Value> = params
                .tools
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                        "strict": false,
                    })
                })
                .collect();
            if config.hosted_web_search == Some(true) {
                tools.push(json!({ "type": "web_search", "search_context_size": "medium" }));
                if let Some(include_arr) = obj.get_mut("include").and_then(|i| i.as_array_mut()) {
                    include_arr.push(json!("web_search_call.action.sources"));
                }
            }
            if !tools.is_empty() {
                obj.insert("tools".to_string(), Value::Array(tools));
            }
        }
        body_map
    } else {
        let mut msgs = Vec::new();
        if let Some(ref sys) = params.system_prompt {
            if !sys.trim().is_empty() {
                msgs.push(json!({ "role": "system", "content": sys }));
            }
        }
        msgs.extend(openai_messages(messages, true));

        let mut body_map = json!({
            "model": params.model_id,
            "messages": msgs,
            "stream": true,
        });

        if let Some(obj) = body_map.as_object_mut() {
            obj.insert("max_tokens".to_string(), json!(params.max_tokens));
            obj.insert("temperature".to_string(), json!(params.temperature));

            if let Some(ref effort) = config.reasoning_effort {
                obj.insert("reasoning_effort".to_string(), json!(effort));
            }
            let tools = openai_tool_definitions(params);
            if !tools.is_empty() {
                obj.insert("tools".to_string(), Value::Array(tools));
            }
        }
        body_map
    };

    Ok(RequestSpec { url, headers, body })
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

fn build_anthropic_request(
    config: &ProviderConfig,
    messages: &[ChatMessage],
    params: &ChatParams,
) -> Result<RequestSpec, AppError> {
    let api_key = config.api_key.as_deref().unwrap_or("");
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.anthropic.com/v1");
    let url = format!("{}/messages", base_url.trim_end_matches('/'));

    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("x-api-key".to_string(), api_key.to_string());
    headers.insert("anthropic-version".to_string(), "2023-06-01".to_string());

    let filtered = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| match message.role.as_str() {
            "assistant" => {
                let mut blocks = Vec::new();
                if !message.content.is_empty() {
                    blocks.push(json!({ "type": "text", "text": message.content }));
                }
                blocks.extend(
                    message
                        .tool_calls
                        .as_deref()
                        .unwrap_or_default()
                        .iter()
                        .map(|tool_call| {
                            json!({
                                "type": "tool_use",
                                "id": tool_call.id,
                                "name": encode_tool_id_for_wire(&tool_call.name),
                                "input": tool_call.input,
                            })
                        }),
                );
                json!({ "role": "assistant", "content": blocks })
            }
            "tool" => json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": message.tool_call_id,
                    "content": message.content,
                }],
            }),
            _ => json!({ "role": "user", "content": message.content }),
        })
        .collect::<Vec<_>>();

    let mut body_map = json!({
        "model": params.model_id,
        "messages": filtered,
        "max_tokens": params.max_tokens,
        "stream": true,
    });

    if let Some(ref sys) = params.system_prompt {
        if !sys.trim().is_empty() {
            body_map
                .as_object_mut()
                .unwrap()
                .insert("system".to_string(), json!(sys));
        }
    }

    if let Some(ref _effort) = config.reasoning_effort {
        body_map.as_object_mut().unwrap().insert(
            "thinking".to_string(),
            json!({ "type": "enabled", "budget_tokens": params.max_tokens }),
        );
    }

    if let Some(tools) = &params.tools {
        if !tools.is_empty() {
            body_map.as_object_mut().unwrap().insert(
                "tools".to_string(),
                Value::Array(
                    tools
                        .iter()
                        .map(|tool| {
                            json!({
                                "name": tool.name,
                                "description": tool.description,
                                "input_schema": tool.parameters,
                            })
                        })
                        .collect(),
                ),
            );
        }
    }

    Ok(RequestSpec {
        url,
        headers,
        body: body_map,
    })
}

// ─── Google Gemini ───────────────────────────────────────────────────────────

fn build_google_request(
    config: &ProviderConfig,
    messages: &[ChatMessage],
    params: &ChatParams,
) -> Result<RequestSpec, AppError> {
    let api_key = config.api_key.as_deref().unwrap_or("");
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse",
        params.model_id
    );

    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("x-goog-api-key".to_string(), api_key.to_string());

    let tool_names_by_id: HashMap<&str, String> = messages
        .iter()
        .flat_map(|message| message.tool_calls.as_deref().unwrap_or_default())
        .map(|tool_call| {
            (
                tool_call.id.as_str(),
                encode_tool_id_for_wire(&tool_call.name),
            )
        })
        .collect();
    let contents = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| match message.role.as_str() {
            "assistant" => {
                let mut parts = Vec::new();
                if !message.content.is_empty() {
                    parts.push(json!({ "text": message.content }));
                }
                parts.extend(
                    message
                        .tool_calls
                        .as_deref()
                        .unwrap_or_default()
                        .iter()
                        .map(|tool_call| {
                            json!({
                                "functionCall": {
                                    "id": tool_call.id,
                                    "name": encode_tool_id_for_wire(&tool_call.name),
                                    "args": tool_call.input,
                                }
                            })
                        }),
                );
                json!({ "role": "model", "parts": parts })
            }
            "tool" => {
                let tool_call_id = message.tool_call_id.as_deref().unwrap_or_default();
                let output = serde_json::from_str::<Value>(&message.content)
                    .unwrap_or_else(|_| Value::String(message.content.clone()));
                json!({
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "id": tool_call_id,
                            "name": tool_names_by_id.get(tool_call_id).cloned().unwrap_or_default(),
                            "response": { "output": output },
                        }
                    }]
                })
            }
            _ => json!({ "role": "user", "parts": [{ "text": message.content }] }),
        })
        .collect::<Vec<_>>();

    let mut body_map = json!({
        "contents": contents,
        "generationConfig": {
            "temperature": params.temperature,
            "maxOutputTokens": params.max_tokens,
        }
    });

    if let Some(ref sys) = params.system_prompt {
        if !sys.trim().is_empty() {
            body_map.as_object_mut().unwrap().insert(
                "systemInstruction".to_string(),
                json!({ "parts": [{ "text": sys }] }),
            );
        }
    }

    if let Some(ref effort) = config.reasoning_effort {
        // Gemini 2.5 thinking budget / Gemini 3 thinking config mapping
        let thinking_config = if params.model_id.starts_with("gemini-2.5") {
            let budget = match effort.as_str() {
                "minimal" | "low" => 1024,
                "medium" => 8192,
                _ => 24576,
            };
            json!({ "thinkingBudget": budget })
        } else {
            json!({ "thinkingLevel": effort })
        };
        body_map
            .get_mut("generationConfig")
            .and_then(|g| g.as_object_mut())
            .unwrap()
            .insert("thinkingConfig".to_string(), thinking_config);
    }

    if let Some(tools) = &params.tools {
        if !tools.is_empty() {
            body_map.as_object_mut().unwrap().insert(
                "tools".to_string(),
                json!([{
                    "functionDeclarations": tools.iter().map(|tool| json!({
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                    })).collect::<Vec<_>>()
                }]),
            );
        }
    }

    Ok(RequestSpec {
        url,
        headers,
        body: body_map,
    })
}

// ─── Ollama ──────────────────────────────────────────────────────────────────

fn build_ollama_request(
    config: &ProviderConfig,
    messages: &[ChatMessage],
    params: &ChatParams,
) -> Result<RequestSpec, AppError> {
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("http://localhost:11434");
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());

    let mut msgs = Vec::new();
    if let Some(ref sys) = params.system_prompt {
        if !sys.trim().is_empty() {
            msgs.push(json!({ "role": "system", "content": sys }));
        }
    }
    msgs.extend(openai_messages(messages, false));

    let mut body_map = json!({
        "model": params.model_id,
        "messages": msgs,
        "stream": true,
    });

    if let Some(ref effort) = config.reasoning_effort {
        body_map
            .as_object_mut()
            .unwrap()
            .insert("think".to_string(), json!(effort));
    }
    let tools = openai_tool_definitions(params);
    if !tools.is_empty() {
        body_map
            .as_object_mut()
            .unwrap()
            .insert("tools".to_string(), Value::Array(tools));
    }

    Ok(RequestSpec {
        url,
        headers,
        body: body_map,
    })
}

// ─── OpenRouter ──────────────────────────────────────────────────────────────

fn build_openrouter_request(
    config: &ProviderConfig,
    messages: &[ChatMessage],
    params: &ChatParams,
) -> Result<RequestSpec, AppError> {
    let api_key = config.api_key.as_deref().unwrap_or("");
    let url = "https://openrouter.ai/api/v1/chat/completions".to_string();

    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("Authorization".to_string(), format!("Bearer {api_key}"));
    headers.insert("HTTP-Referer".to_string(), "https://asyar.app".to_string());
    headers.insert("X-Title".to_string(), "Asyar".to_string());

    let mut msgs = Vec::new();
    if let Some(ref sys) = params.system_prompt {
        if !sys.trim().is_empty() {
            msgs.push(json!({ "role": "system", "content": sys }));
        }
    }
    msgs.extend(openai_messages(messages, true));

    let mut body_map = json!({
        "model": params.model_id,
        "messages": msgs,
        "stream": true,
    });

    if let Some(obj) = body_map.as_object_mut() {
        obj.insert("max_tokens".to_string(), json!(params.max_tokens));
        obj.insert("temperature".to_string(), json!(params.temperature));

        if let Some(ref effort) = config.reasoning_effort {
            obj.insert("reasoning".to_string(), json!({ "effort": effort }));
        }
        let tools = openai_tool_definitions(params);
        if !tools.is_empty() {
            obj.insert("tools".to_string(), Value::Array(tools));
        }
    }

    Ok(RequestSpec {
        url,
        headers,
        body: body_map,
    })
}

// ─── Custom ──────────────────────────────────────────────────────────────────

fn build_custom_request(
    config: &ProviderConfig,
    messages: &[ChatMessage],
    params: &ChatParams,
) -> Result<RequestSpec, AppError> {
    let api_key = config.api_key.as_deref().unwrap_or("");
    let base_url = config.base_url.as_deref().unwrap_or("");
    if base_url.trim().is_empty() {
        return Err(AppError::Other(
            "Custom provider base URL must not be empty".to_string(),
        ));
    }

    let is_responses = config.open_ai_api_mode.as_deref() == Some("responses");
    let url = if is_responses {
        format!("{}/responses", base_url.trim_end_matches('/'))
    } else {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    };

    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    if !api_key.trim().is_empty() {
        headers.insert("Authorization".to_string(), format!("Bearer {api_key}"));
    }

    let body = if is_responses {
        let input = openai_responses_input(messages, params.system_prompt.as_deref());

        let mut body_map = json!({
            "model": params.model_id,
            "input": input,
            "stream": true,
            "store": false,
            "include": ["reasoning.encrypted_content"]
        });

        if let Some(obj) = body_map.as_object_mut() {
            obj.insert("max_output_tokens".to_string(), json!(params.max_tokens));
            obj.insert("temperature".to_string(), json!(params.temperature));

            if let Some(ref effort) = config.reasoning_effort {
                obj.insert("reasoning".to_string(), json!({ "effort": effort }));
            }
            let mut tools: Vec<Value> = params
                .tools
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                        "strict": false,
                    })
                })
                .collect();
            if config.hosted_web_search == Some(true) {
                tools.push(json!({ "type": "web_search", "search_context_size": "medium" }));
                if let Some(include_arr) = obj.get_mut("include").and_then(|i| i.as_array_mut()) {
                    include_arr.push(json!("web_search_call.action.sources"));
                }
            }
            if !tools.is_empty() {
                obj.insert("tools".to_string(), Value::Array(tools));
            }
        }
        body_map
    } else {
        let mut msgs = Vec::new();
        if let Some(ref sys) = params.system_prompt {
            if !sys.trim().is_empty() {
                msgs.push(json!({ "role": "system", "content": sys }));
            }
        }
        msgs.extend(openai_messages(messages, true));

        let mut body_map = json!({
            "model": params.model_id,
            "messages": msgs,
            "stream": true,
        });

        if let Some(obj) = body_map.as_object_mut() {
            obj.insert("max_tokens".to_string(), json!(params.max_tokens));
            obj.insert("temperature".to_string(), json!(params.temperature));

            if let Some(ref effort) = config.reasoning_effort {
                obj.insert("reasoning_effort".to_string(), json!(effort));
            }
            let tools = openai_tool_definitions(params);
            if !tools.is_empty() {
                obj.insert("tools".to_string(), Value::Array(tools));
            }
        }
        body_map
    };

    Ok(RequestSpec { url, headers, body })
}
