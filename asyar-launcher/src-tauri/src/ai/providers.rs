use crate::ai::types::{ChatMessage, ChatParams, ChatStreamEvent, ProviderConfig, RequestSpec};
use crate::error::AppError;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn build_request(
    provider_id: &str,
    config: &ProviderConfig,
    messages: &[ChatMessage],
    params: &ChatParams,
) -> Result<RequestSpec, AppError> {
    match provider_id {
        "openai" => build_openai_request(config, messages, params),
        "anthropic" => build_anthropic_request(config, messages, params),
        "google" => build_google_request(config, messages, params),
        "ollama" => build_ollama_request(config, messages, params),
        "openrouter" => build_openrouter_request(config, messages, params),
        "custom" => build_custom_request(config, messages, params),
        _ => Err(AppError::Other(format!("Unknown provider: {provider_id}"))),
    }
}

pub fn parse_stream_line(
    provider_id: &str,
    config: &ProviderConfig,
    line: &str,
) -> Option<ChatStreamEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    if provider_id == "ollama" {
        // Ollama uses newline-delimited JSON without "data: " prefix
        return parse_ollama_chunk(trimmed);
    }

    // Standard SSE uses "data: " prefix
    if !trimmed.starts_with("data: ") {
        return None;
    }

    let payload = trimmed["data: ".len()..].trim();
    if payload == "[DONE]" {
        return None;
    }

    match provider_id {
        "openai" => parse_openai_chunk(config, payload),
        "anthropic" => parse_anthropic_chunk(payload),
        "google" => parse_google_chunk(payload),
        "openrouter" => parse_openai_chunk(config, payload), // OpenRouter uses OpenAI format
        "custom" => parse_openai_chunk(config, payload),     // Custom uses OpenAI format
        _ => None,
    }
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
        // Build OpenAI Responses API format
        let mut input = Vec::new();
        if let Some(ref sys) = params.system_prompt {
            if !sys.trim().is_empty() {
                input.push(json!({ "role": "system", "content": sys }));
            }
        }
        for msg in messages {
            if msg.role != "system" {
                input.push(json!({ "role": msg.role, "content": msg.content }));
            }
        }

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
            if config.hosted_web_search == Some(true) {
                obj.insert(
                    "tools".to_string(),
                    json!([{ "type": "web_search", "search_context_size": "medium" }]),
                );
                if let Some(include_arr) = obj.get_mut("include").and_then(|i| i.as_array_mut()) {
                    include_arr.push(json!("web_search_call.action.sources"));
                }
            }
        }
        body_map
    } else {
        // Standard OpenAI Chat Completions format
        let mut msgs = Vec::new();
        if let Some(ref sys) = params.system_prompt {
            if !sys.trim().is_empty() {
                msgs.push(json!({ "role": "system", "content": sys }));
            }
        }
        for msg in messages {
            if msg.role != "system" {
                msgs.push(json!({ "role": msg.role, "content": msg.content }));
            }
        }

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
        }
        body_map
    };

    Ok(RequestSpec { url, headers, body })
}

fn parse_openai_chunk(config: &ProviderConfig, payload: &str) -> Option<ChatStreamEvent> {
    let json: Value = serde_json::from_str(payload).ok()?;
    let is_responses = config.open_ai_api_mode.as_deref() == Some("responses");

    if is_responses {
        // Parse OpenAI Responses format
        let event_type = json.get("type")?.as_str()?;
        if event_type == "response.web_search_call.in_progress"
            || event_type == "response.web_search_call.searching"
        {
            return Some(ChatStreamEvent::Status {
                status: "searching".to_string(),
            });
        }
        if event_type == "response.output_text.delta" {
            let delta = json.get("delta")?.as_str()?;
            return Some(ChatStreamEvent::Token {
                token: delta.to_string(),
            });
        }
        None
    } else {
        // Parse standard Chat Completions format
        let choice = json.get("choices")?.get(0)?;
        let delta = choice.get("delta")?;
        let content = delta.get("content")?.as_str()?;
        Some(ChatStreamEvent::Token {
            token: content.to_string(),
        })
    }
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
        .filter(|m| m.role != "system")
        .map(|m| {
            json!({
                "role": if m.role == "assistant" { "assistant" } else { "user" },
                "content": m.content
            })
        })
        .collect::<Vec<_>>();

    let mut body_map = json!({
        "model": params.model_id,
        "messages": filtered,
        "max_tokens": params.max_tokens,
        "temperature": params.temperature,
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

    Ok(RequestSpec {
        url,
        headers,
        body: body_map,
    })
}

fn parse_anthropic_chunk(payload: &str) -> Option<ChatStreamEvent> {
    let json: Value = serde_json::from_str(payload).ok()?;
    let event_type = json.get("type")?.as_str()?;
    if event_type == "content_block_delta" {
        let delta = json.get("delta")?;
        let text = delta.get("text")?.as_str()?;
        return Some(ChatStreamEvent::Token {
            token: text.to_string(),
        });
    }
    None
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

    let contents = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            json!({
                "role": if m.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": m.content }]
            })
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

    Ok(RequestSpec {
        url,
        headers,
        body: body_map,
    })
}

fn parse_google_chunk(payload: &str) -> Option<ChatStreamEvent> {
    let json: Value = serde_json::from_str(payload).ok()?;
    let candidate = json.get("candidates")?.get(0)?;
    let parts = candidate.get("content")?.get("parts")?.as_array()?;
    let text = parts.get(0)?.get("text")?.as_str()?;
    Some(ChatStreamEvent::Token {
        token: text.to_string(),
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
    for msg in messages {
        if msg.role != "system" {
            msgs.push(json!({ "role": msg.role, "content": msg.content }));
        }
    }

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

    Ok(RequestSpec {
        url,
        headers,
        body: body_map,
    })
}

fn parse_ollama_chunk(payload: &str) -> Option<ChatStreamEvent> {
    let json: Value = serde_json::from_str(payload).ok()?;
    let content = json.get("message")?.get("content")?.as_str()?;
    Some(ChatStreamEvent::Token {
        token: content.to_string(),
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
    for msg in messages {
        if msg.role != "system" {
            msgs.push(json!({ "role": msg.role, "content": msg.content }));
        }
    }

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
        let mut input = Vec::new();
        if let Some(ref sys) = params.system_prompt {
            if !sys.trim().is_empty() {
                input.push(json!({ "role": "system", "content": sys }));
            }
        }
        for msg in messages {
            if msg.role != "system" {
                input.push(json!({ "role": msg.role, "content": msg.content }));
            }
        }

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
            if config.hosted_web_search == Some(true) {
                obj.insert(
                    "tools".to_string(),
                    json!([{ "type": "web_search", "search_context_size": "medium" }]),
                );
                if let Some(include_arr) = obj.get_mut("include").and_then(|i| i.as_array_mut()) {
                    include_arr.push(json!("web_search_call.action.sources"));
                }
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
        for msg in messages {
            if msg.role != "system" {
                msgs.push(json!({ "role": msg.role, "content": msg.content }));
            }
        }

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
        }
        body_map
    };

    Ok(RequestSpec { url, headers, body })
}
