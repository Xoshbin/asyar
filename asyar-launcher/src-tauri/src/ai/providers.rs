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
struct AnthropicContentBlock {
    value: Value,
    arguments: String,
}

/// Stateful parser for provider streaming protocols. Tool arguments may span
/// multiple SSE/NDJSON chunks, so parsing cannot be a stateless line mapping.
pub struct ProviderStreamParser {
    provider_id: String,
    config: ProviderConfig,
    openai_tools: BTreeMap<u32, PendingToolCall>,
    anthropic_blocks: BTreeMap<u64, AnthropicContentBlock>,
    search_sources: Vec<crate::ai::types::GroundingSource>,
    search_error: Option<String>,
    google_tool_counter: u32,
    google_grounding: serde_json::Map<String, Value>,
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
            anthropic_blocks: BTreeMap::new(),
            search_sources: Vec::new(),
            search_error: None,
            google_tool_counter: 0,
            google_grounding: serde_json::Map::new(),
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
        // Native content blocks have already been emitted for conversation replay.
        if let Some(error) = self.search_error.take() {
            return Err(AppError::Other(error));
        }
        let mut events = Vec::new();
        for (_, pending) in std::mem::take(&mut self.openai_tools) {
            let input = serde_json::from_str(&pending.arguments).unwrap_or_else(|_| json!({}));
            events.push(ChatStreamEvent::ToolCall {
                id: pending.id,
                name: pending.name,
                input,
            });
        }
        if !self.google_grounding.is_empty() {
            let metadata = Value::Object(std::mem::take(&mut self.google_grounding));
            events.push(google_grounding_event(metadata));
        }
        if !self.search_sources.is_empty() {
            events.push(ChatStreamEvent::ProviderContext {
                item: json!({"webSearchGroundingDisplay": crate::ai::types::WebSearchGrounding {
                    sources: std::mem::take(&mut self.search_sources), search_suggestions_html: None,
                }}),
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
        if self.provider_id == "openrouter" {
            for annotations in [
                choice.pointer("/delta/annotations"),
                choice.pointer("/message/annotations"),
            ]
            .into_iter()
            .flatten()
            .filter_map(Value::as_array)
            {
                for annotation in annotations {
                    if annotation["type"] == "url_citation" {
                        if let Some(source) = web_source(&annotation["url_citation"], "url") {
                            add_source(&mut self.search_sources, source);
                        }
                    }
                    events.push(ChatStreamEvent::ProviderContext {
                        item: json!({"openrouterAnnotation": annotation}),
                    });
                }
            }
        }

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
        let index = value.get("index").and_then(Value::as_u64).unwrap_or(0);
        let mut events = Vec::new();
        match value.get("type").and_then(Value::as_str) {
            Some("content_block_start") => {
                let block = value.get("content_block").cloned().unwrap_or(Value::Null);
                if let Some(code) = block.pointer("/content/error_code").and_then(Value::as_str) {
                    if block["type"] == "web_search_tool_result" {
                        self.search_error = Some(format!("Anthropic web search failed: {code}"));
                    }
                }
                if block["type"] == "server_tool_use" && block["name"] == "web_search" {
                    events.push(ChatStreamEvent::Status {
                        status: "searching".into(),
                    });
                }
                if let Some(text) = block
                    .get("text")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                {
                    events.push(ChatStreamEvent::Token {
                        token: text.to_owned(),
                    });
                }
                self.anthropic_blocks.insert(
                    index,
                    AnthropicContentBlock {
                        value: block,
                        arguments: String::new(),
                    },
                );
            }
            Some("content_block_delta") => {
                let delta = &value["delta"];
                if delta["type"] == "text_delta" {
                    if let Some(text) = delta["text"].as_str() {
                        events.push(ChatStreamEvent::Token {
                            token: text.to_owned(),
                        });
                    }
                }
                if let Some(block) = self.anthropic_blocks.get_mut(&index) {
                    match delta["type"].as_str() {
                        Some("text_delta") | Some("thinking_delta") | Some("signature_delta") => {
                            let field = match delta["type"].as_str() {
                                Some("thinking_delta") => "thinking",
                                Some("signature_delta") => "signature",
                                _ => "text",
                            };
                            if let Some(text) = delta[field].as_str() {
                                let previous = block.value[field].as_str().unwrap_or_default();
                                block.value[field] = json!(format!("{previous}{text}"));
                            }
                        }
                        Some("input_json_delta") => {
                            if let Some(partial) = delta["partial_json"].as_str() {
                                block.arguments.push_str(partial);
                            }
                        }
                        Some("citations_delta") => {
                            if let Some(citation) = delta.get("citation") {
                                if !block.value["citations"].is_array() {
                                    block.value["citations"] = json!([]);
                                }
                                block.value["citations"]
                                    .as_array_mut()
                                    .unwrap()
                                    .push(citation.clone());
                            }
                        }
                        _ => {}
                    }
                }
            }
            Some("content_block_stop") => {
                if let Some(mut block) = self.anthropic_blocks.remove(&index) {
                    if !block.arguments.is_empty() {
                        block.value["input"] =
                            serde_json::from_str(&block.arguments).map_err(|error| {
                                AppError::Other(format!("invalid Anthropic tool input: {error}"))
                            })?;
                    }
                    if block.value["type"] == "tool_use" {
                        events.push(ChatStreamEvent::ToolCall {
                            id: block.value["id"].as_str().unwrap_or_default().into(),
                            name: block.value["name"].as_str().unwrap_or_default().into(),
                            input: block
                                .value
                                .get("input")
                                .cloned()
                                .unwrap_or_else(|| json!({})),
                        });
                    }
                    // Citation links are presentation only. Native text, encrypted
                    // references and server results are replayed without these links.
                    for citation in block
                        .value
                        .get("citations")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        if citation["type"] == "web_search_result_location" {
                            if let Some(source) = web_source(citation, "url") {
                                let destination = url::Url::parse(&source.url)
                                    .unwrap()
                                    .to_string()
                                    .replace('(', "%28")
                                    .replace(')', "%29")
                                    .replace('<', "%3C")
                                    .replace('>', "%3E");
                                let number = add_source(&mut self.search_sources, source);
                                events.push(ChatStreamEvent::Token {
                                    token: format!(" [{number}]({destination})"),
                                });
                            }
                        }
                    }
                    events.push(ChatStreamEvent::ProviderContext {
                        item: json!({"anthropicBlock": block.value}),
                    });
                }
            }
            Some("message_delta")
                if value.pointer("/delta/stop_reason").and_then(Value::as_str)
                    == Some("pause_turn") =>
            {
                events.push(ChatStreamEvent::ProviderContext {
                    item: json!({"continueTurn": true}),
                });
            }
            Some("error") => {
                return Err(AppError::Other(
                    value
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Anthropic request failed")
                        .into(),
                ));
            }
            _ => {}
        }
        Ok(events)
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
            // Preserve every part (including signed thoughts and server-side tool
            // context) unchanged for Gemini's next tool-continuation request.
            if part.get("thought").and_then(Value::as_bool) == Some(true) {
                events.push(ChatStreamEvent::ProviderContext {
                    item: json!({ "geminiPart": part }),
                });
                continue;
            }
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
            events.push(ChatStreamEvent::ProviderContext {
                item: json!({ "geminiPart": part }),
            });
        }
        if let Some(metadata) = value
            .pointer("/candidates/0/groundingMetadata")
            .and_then(Value::as_object)
        {
            // Metadata may arrive separately from text and in several chunks.
            // Keep the latest value for each field and publish one presentation.
            self.google_grounding.extend(metadata.clone());
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

fn web_source(value: &Value, url_key: &str) -> Option<crate::ai::types::GroundingSource> {
    let uri = value.get(url_key)?.as_str()?;
    if uri.chars().any(char::is_control) {
        return None;
    }
    let url = url::Url::parse(uri).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(crate::ai::types::GroundingSource {
        title: value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(uri)
            .to_owned(),
        url: uri.to_owned(),
    })
}

fn add_source(
    sources: &mut Vec<crate::ai::types::GroundingSource>,
    source: crate::ai::types::GroundingSource,
) -> usize {
    if let Some(index) = sources
        .iter()
        .position(|existing| existing.url == source.url)
    {
        return index + 1;
    }
    sources.push(source);
    sources.len()
}

fn google_grounding_event(metadata: Value) -> ChatStreamEvent {
    let sources = metadata
        .get("groundingChunks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|chunk| web_source(chunk.get("web")?, "uri"))
        .collect();
    let display = crate::ai::types::WebSearchGrounding {
        sources,
        search_suggestions_html: metadata
            .pointer("/searchEntryPoint/renderedContent")
            .and_then(Value::as_str)
            .map(str::to_owned),
    };
    ChatStreamEvent::ProviderContext {
        item: json!({
            "geminiGrounding": metadata,
            "geminiGroundingDisplay": display,
        }),
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
                    let reasoning: Vec<Value> = context
                        .iter()
                        .filter(|item| {
                            item.get("type")
                                .and_then(Value::as_str)
                                .is_some_and(|kind| kind.starts_with("reasoning."))
                        })
                        .cloned()
                        .collect();
                    if !reasoning.is_empty() {
                        value["reasoning_details"] = json!(reasoning);
                    }
                    let annotations: Vec<Value> = context
                        .iter()
                        .filter_map(|item| item.get("openrouterAnnotation").cloned())
                        .collect();
                    if !annotations.is_empty() {
                        value["annotations"] = json!(annotations);
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
            if let Some(temperature) = params.temperature {
                obj.insert("temperature".to_string(), json!(temperature));
            }

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
            if let Some(temperature) = params.temperature {
                obj.insert("temperature".to_string(), json!(temperature));
            }

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
                let original_blocks: Vec<Value> = message
                    .provider_context
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|item| item.get("anthropicBlock").cloned())
                    .collect();
                if !original_blocks.is_empty() {
                    return json!({ "role": "assistant", "content": original_blocks });
                }
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

    if let Some(temperature) = params.temperature {
        if config.reasoning_effort.is_none() {
            body_map
                .as_object_mut()
                .unwrap()
                .insert("temperature".to_string(), json!(temperature));
        }
    }

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

    let mut tools: Vec<Value> = params
        .tools
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters,
            })
        })
        .collect();
    if config.hosted_web_search == Some(true) {
        tools.push(json!({"type": "web_search_20250305", "name": "web_search", "max_uses": 5}));
    }
    if !tools.is_empty() {
        body_map["tools"] = json!(tools);
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
    let custom_tools = params.tools.as_deref().unwrap_or_default();
    let search_enabled = config.hosted_web_search == Some(true);
    let gemini_3 =
        params.model_id.starts_with("gemini-3-") || params.model_id.starts_with("gemini-3.");
    if search_enabled && !custom_tools.is_empty() && !gemini_3 {
        return Err(AppError::Validation(
            "Google Search with agent tools requires Gemini 3. Select a Gemini 3 model, remove the agent's tools, or disable Google Search in AI settings.".into(),
        ));
    }
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
    // Internal IDs also identify calls from older Gemini models that omit IDs
    // on the wire. Pair calls by their original order, without editing signatures.
    let mut wire_ids = HashMap::new();
    for message in messages {
        let original_calls: Vec<&Value> = message
            .provider_context
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter_map(|item| item.pointer("/geminiPart/functionCall"))
            .collect();
        for (index, call) in message
            .tool_calls
            .as_deref()
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let wire_id = original_calls
                .get(index)
                .map(|original| original.get("id").cloned())
                .unwrap_or_else(|| Some(json!(call.id)));
            wire_ids.insert(call.id.as_str(), wire_id);
        }
    }
    let contents = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| match message.role.as_str() {
            "assistant" => {
                let original_parts: Vec<Value> = message
                    .provider_context
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|item| item.get("geminiPart").cloned())
                    .collect();
                if !original_parts.is_empty() {
                    return json!({ "role": "model", "parts": original_parts });
                }
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
                let mut response = json!({
                    "name": tool_names_by_id.get(tool_call_id).cloned().unwrap_or_default(),
                    "response": { "output": output },
                });
                if let Some(Some(id)) = wire_ids.get(tool_call_id) {
                    response["id"] = id.clone();
                }
                json!({ "role": "user", "parts": [{ "functionResponse": response }] })
            }
            _ => json!({ "role": "user", "parts": [{ "text": message.content }] }),
        })
        .collect::<Vec<_>>();

    let mut generation_config = json!({
        "maxOutputTokens": params.max_tokens,
    });
    if let Some(temperature) = params.temperature {
        generation_config
            .as_object_mut()
            .unwrap()
            .insert("temperature".to_string(), json!(temperature));
    }

    let mut body_map = json!({
        "contents": contents,
        "generationConfig": generation_config,
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

    let mut tools = Vec::new();
    if !custom_tools.is_empty() {
        tools.push(json!({
            "functionDeclarations": custom_tools.iter().map(|tool| json!({
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            })).collect::<Vec<_>>()
        }));
    }
    if search_enabled {
        tools.push(json!({ "google_search": {} }));
        if !custom_tools.is_empty() {
            body_map["toolConfig"] = json!({ "includeServerSideToolInvocations": true });
        }
    }
    if !tools.is_empty() {
        body_map["tools"] = json!(tools);
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

    if let Some(temperature) = params.temperature {
        body_map
            .as_object_mut()
            .unwrap()
            .insert("options".to_string(), json!({ "temperature": temperature }));
    }

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
        if let Some(temperature) = params.temperature {
            obj.insert("temperature".to_string(), json!(temperature));
        }

        if let Some(ref effort) = config.reasoning_effort {
            obj.insert("reasoning".to_string(), json!({ "effort": effort }));
        }
        let tools = openai_tool_definitions(params);
        if !tools.is_empty() {
            obj.insert("tools".to_string(), Value::Array(tools));
        }
    }

    if config.hosted_web_search == Some(true) {
        body_map["plugins"] = json!([{ "id": "web" }]);
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
            if let Some(temperature) = params.temperature {
                obj.insert("temperature".to_string(), json!(temperature));
            }

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
            if let Some(temperature) = params.temperature {
                obj.insert("temperature".to_string(), json!(temperature));
            }

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
