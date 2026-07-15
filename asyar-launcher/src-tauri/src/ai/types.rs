use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    #[specta(type = specta_typescript::Any)]
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    #[specta(type = specta_typescript::Any)]
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String, // "user", "assistant", "system", "tool"
    pub content: String,
    pub timestamp: i64,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub tool_call_id: Option<String>,
    #[specta(type = Option<Vec<specta_typescript::Any>>)]
    pub provider_context: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub enabled: bool,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub last_model_id: Option<String>,
    #[serde(rename = "openAIApiMode")]
    pub open_ai_api_mode: Option<String>, // "responses", "chat-completions"
    pub hosted_web_search: Option<bool>,
    pub reasoning_effort: Option<String>, // "none", "minimal", "low", etc.
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatParams {
    pub model_id: String,
    pub temperature: f64,
    pub max_tokens: u32,
    pub system_prompt: Option<String>,
    pub tools: Option<Vec<ToolDefinition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestSpec {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatStreamEvent {
    Token {
        token: String,
    },
    Status {
        status: String,
    }, // e.g., "searching"
    ToolCall {
        id: String,
        name: String,
        #[specta(type = specta_typescript::Any)]
        input: serde_json::Value,
    },
    ProviderContext {
        #[specta(type = specta_typescript::Any)]
        item: serde_json::Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StreamEventPayload {
    pub stream_id: String,
    pub event: ChatStreamEventPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatStreamEventPayload {
    Token {
        token: String,
    },
    Status {
        status: String,
    },
    ToolCall {
        id: String,
        name: String,
        #[specta(type = specta_typescript::Any)]
        input: serde_json::Value,
    },
    ProviderContext {
        #[specta(type = specta_typescript::Any)]
        item: serde_json::Value,
    },
    Done,
    Error {
        error: String,
    },
}
