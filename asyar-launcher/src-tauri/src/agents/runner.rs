use crate::agents::tools::ToolRegistry;
use crate::ai::types::{
    ChatMessage, ChatParams, ChatStreamEventPayload, ProviderConfig, ToolCall, ToolDefinition,
};
use crate::error::AppError;
use crate::storage::agents::{
    get_agent, get_thread, insert_message, list_messages_for_thread, update_thread_title, AgentRow,
    MessageRole, MessageRow,
};
use crate::storage::DataStore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Arc, Mutex};
use tokio::sync::{oneshot, watch};
use uuid::Uuid;

const MAX_TURNS: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentStreamEvent {
    UserMessagePersisted,
    TextDelta {
        delta: String,
        accumulated: String,
    },
    Status {
        status: Option<String>,
    },
    AssistantTurnPersisted,
    ToolDispatch {
        tool_call_id: String,
        extension_id: String,
        tool_id: String,
        #[specta(type = specta_typescript::Any)]
        arguments: Value,
    },
    ToolDispatchCancelled {
        tool_call_id: String,
    },
    McpPermissionRequest {
        tool_call_id: String,
        server_id: String,
        tool_id: String,
        agent_id: String,
    },
    McpPermissionCancelled {
        tool_call_id: String,
    },
    Error {
        message: String,
    },
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamEventPayload {
    pub stream_id: String,
    pub event: AgentStreamEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunConfig {
    pub provider: ProviderConfig,
    pub temperature: f64,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExternalToolRequest {
    pub tool_call_id: String,
    pub tool_id: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum McpPermissionChoice {
    AllowOnce,
    AllowAlways,
    Never,
    Cancel,
}

struct PendingToolResult {
    tool_call_id: String,
    sender: oneshot::Sender<Result<Value, String>>,
}

struct PendingMcpPermission {
    tool_call_id: String,
    sender: oneshot::Sender<McpPermissionChoice>,
}

#[derive(Clone, Default)]
pub struct AgentRunnerState {
    pending: Arc<Mutex<HashMap<String, PendingToolResult>>>,
    pending_mcp_permissions: Arc<Mutex<HashMap<String, PendingMcpPermission>>>,
    cancellations: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    pre_cancelled: Arc<Mutex<HashSet<String>>>,
}

impl AgentRunnerState {
    pub fn begin_run(&self, stream_id: &str) -> Result<watch::Receiver<bool>, AppError> {
        let (sender, receiver) = watch::channel(false);
        let mut cancellations = self.cancellations.lock().map_err(|_| AppError::Lock)?;
        if cancellations
            .insert(stream_id.to_string(), sender)
            .is_some()
        {
            return Err(AppError::Validation(format!(
                "agent stream '{stream_id}' is already active"
            )));
        }
        if self
            .pre_cancelled
            .lock()
            .map_err(|_| AppError::Lock)?
            .remove(stream_id)
        {
            cancellations
                .get(stream_id)
                .expect("inserted above")
                .send(true)
                .map_err(|_| AppError::Other("agent cancellation receiver is closed".into()))?;
        }
        Ok(receiver)
    }

    pub fn finish_run(&self, stream_id: &str) -> Result<(), AppError> {
        self.cancellations
            .lock()
            .map_err(|_| AppError::Lock)?
            .remove(stream_id);
        self.pre_cancelled
            .lock()
            .map_err(|_| AppError::Lock)?
            .remove(stream_id);
        self.cancel_pending_requests(stream_id)
    }

    pub fn cancel_run(&self, stream_id: &str) -> Result<(), AppError> {
        let sender = self
            .cancellations
            .lock()
            .map_err(|_| AppError::Lock)?
            .get(stream_id)
            .cloned();
        if let Some(sender) = sender {
            // Cancellation is idempotent. The runner can finish between the
            // frontend's cancel click and this command acquiring the lock.
            let _ = sender.send(true);
        } else {
            self.pre_cancelled
                .lock()
                .map_err(|_| AppError::Lock)?
                .insert(stream_id.to_string());
        }
        self.cancel_pending_requests(stream_id)
    }

    pub fn begin_tool_call(
        &self,
        stream_id: &str,
        request: &ExternalToolRequest,
    ) -> Result<oneshot::Receiver<Result<Value, String>>, AppError> {
        let (sender, receiver) = oneshot::channel();
        let mut pending = self.pending.lock().map_err(|_| AppError::Lock)?;
        if pending.contains_key(stream_id) {
            return Err(AppError::Validation(format!(
                "agent stream '{stream_id}' already has a pending tool call"
            )));
        }
        pending.insert(
            stream_id.to_string(),
            PendingToolResult {
                tool_call_id: request.tool_call_id.clone(),
                sender,
            },
        );
        Ok(receiver)
    }

    pub fn report_tool_result(
        &self,
        stream_id: &str,
        tool_call_id: &str,
        result: Value,
        error: Option<String>,
    ) -> Result<(), AppError> {
        let mut pending = self.pending.lock().map_err(|_| AppError::Lock)?;
        let expected = pending.get(stream_id).ok_or_else(|| {
            AppError::NotFound(format!(
                "agent stream '{stream_id}' has no pending tool call"
            ))
        })?;
        if expected.tool_call_id != tool_call_id {
            return Err(AppError::Validation(format!(
                "tool result id '{tool_call_id}' does not match pending call '{}'",
                expected.tool_call_id
            )));
        }
        let pending = pending.remove(stream_id).expect("checked above");
        pending
            .sender
            .send(error.map_or_else(|| Ok(result), Err))
            .map_err(|_| AppError::Other("agent runner stopped before tool result arrived".into()))
    }

    pub fn begin_mcp_permission(
        &self,
        stream_id: &str,
        tool_call_id: &str,
    ) -> Result<oneshot::Receiver<McpPermissionChoice>, AppError> {
        let (sender, receiver) = oneshot::channel();
        let mut pending = self
            .pending_mcp_permissions
            .lock()
            .map_err(|_| AppError::Lock)?;
        if pending.contains_key(stream_id) {
            return Err(AppError::Validation(format!(
                "agent stream '{stream_id}' already has a pending MCP permission request"
            )));
        }
        pending.insert(
            stream_id.to_string(),
            PendingMcpPermission {
                tool_call_id: tool_call_id.to_string(),
                sender,
            },
        );
        Ok(receiver)
    }

    pub fn report_mcp_permission(
        &self,
        stream_id: &str,
        tool_call_id: &str,
        decision: McpPermissionChoice,
    ) -> Result<(), AppError> {
        let mut pending = self
            .pending_mcp_permissions
            .lock()
            .map_err(|_| AppError::Lock)?;
        let expected = pending.get(stream_id).ok_or_else(|| {
            AppError::NotFound(format!(
                "agent stream '{stream_id}' has no pending MCP permission request"
            ))
        })?;
        if expected.tool_call_id != tool_call_id {
            return Err(AppError::Validation(format!(
                "MCP permission result id '{tool_call_id}' does not match pending call '{}'",
                expected.tool_call_id
            )));
        }
        let pending = pending.remove(stream_id).expect("checked above");
        pending.sender.send(decision).map_err(|_| {
            AppError::Other("agent runner stopped before MCP permission arrived".into())
        })
    }

    pub fn cancel_tool_call(&self, stream_id: &str) -> Result<(), AppError> {
        self.pending
            .lock()
            .map_err(|_| AppError::Lock)?
            .remove(stream_id);
        Ok(())
    }

    pub fn cancel_mcp_permission(&self, stream_id: &str) -> Result<(), AppError> {
        self.pending_mcp_permissions
            .lock()
            .map_err(|_| AppError::Lock)?
            .remove(stream_id);
        Ok(())
    }

    fn cancel_pending_requests(&self, stream_id: &str) -> Result<(), AppError> {
        self.cancel_tool_call(stream_id)?;
        self.cancel_mcp_permission(stream_id)
    }
}

#[derive(Default)]
struct TurnOutput {
    text: String,
    tool_calls: Vec<ToolCall>,
    provider_context: Vec<Value>,
    status_active: bool,
}

enum Conversation<'a> {
    Persistent {
        store: &'a DataStore,
        thread_id: &'a str,
        run_id: &'a str,
    },
    Ephemeral {
        messages: Vec<ChatMessage>,
    },
}

impl Conversation<'_> {
    fn messages(&self) -> Result<Vec<ChatMessage>, AppError> {
        match self {
            Self::Persistent {
                store, thread_id, ..
            } => {
                let rows = list_messages_for_thread(&*store.conn()?, thread_id)?;
                Ok(rows.iter().map(row_to_chat_message).collect())
            }
            Self::Ephemeral { messages } => Ok(messages.clone()),
        }
    }

    fn push_assistant(
        &mut self,
        text: String,
        tool_calls: Vec<ToolCall>,
        provider_context: Vec<Value>,
    ) -> Result<bool, AppError> {
        if text.is_empty() && tool_calls.is_empty() && provider_context.is_empty() {
            return Ok(false);
        }
        let id = Uuid::new_v4().to_string();
        let timestamp = chrono::Utc::now().timestamp_millis();
        match self {
            Self::Persistent {
                store,
                thread_id,
                run_id,
            } => {
                let mut content = json!({ "text": text });
                if !tool_calls.is_empty() {
                    content["toolUse"] = serde_json::to_value(&tool_calls)
                        .map_err(|error| AppError::Other(error.to_string()))?;
                }
                if !provider_context.is_empty() {
                    content["providerContext"] = Value::Array(provider_context);
                }
                insert_message(
                    &*store.conn()?,
                    &MessageRow {
                        id,
                        thread_id: (*thread_id).to_string(),
                        role: MessageRole::Assistant,
                        content,
                        created_at: timestamp,
                        run_id: Some((*run_id).to_string()),
                    },
                )?;
            }
            Self::Ephemeral { messages } => messages.push(ChatMessage {
                id,
                role: "assistant".to_string(),
                content: text,
                timestamp,
                tool_calls: (!tool_calls.is_empty()).then_some(tool_calls),
                tool_call_id: None,
                provider_context: (!provider_context.is_empty()).then_some(provider_context),
            }),
        }
        Ok(true)
    }

    fn push_tool_result(&mut self, tool_call_id: String, output: Value) -> Result<(), AppError> {
        let id = Uuid::new_v4().to_string();
        let timestamp = chrono::Utc::now().timestamp_millis();
        match self {
            Self::Persistent {
                store,
                thread_id,
                run_id,
            } => insert_message(
                &*store.conn()?,
                &MessageRow {
                    id,
                    thread_id: (*thread_id).to_string(),
                    role: MessageRole::Tool,
                    content: json!({
                        "toolResult": {
                            "toolUseId": tool_call_id,
                            "output": output,
                        }
                    }),
                    created_at: timestamp,
                    run_id: Some((*run_id).to_string()),
                },
            )?,
            Self::Ephemeral { messages } => messages.push(ChatMessage {
                id,
                role: "tool".to_string(),
                content: output.to_string(),
                timestamp,
                tool_calls: None,
                tool_call_id: Some(tool_call_id),
                provider_context: None,
            }),
        }
        Ok(())
    }
}

fn row_to_chat_message(row: &MessageRow) -> ChatMessage {
    let tool_calls = row
        .content
        .get("toolUse")
        .and_then(|value| serde_json::from_value::<Vec<ToolCall>>(value.clone()).ok());
    let provider_context = row
        .content
        .get("providerContext")
        .and_then(Value::as_array)
        .cloned();
    let tool_call_id = row
        .content
        .pointer("/toolResult/toolUseId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let content = if row.role == MessageRole::Tool {
        row.content
            .pointer("/toolResult/output")
            .map(Value::to_string)
            .unwrap_or_default()
    } else {
        row.content
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };

    ChatMessage {
        id: row.id.clone(),
        role: match row.role {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
            MessageRole::Tool => "tool",
        }
        .to_string(),
        content,
        timestamp: row.created_at,
        tool_calls,
        tool_call_id,
        provider_context,
    }
}

pub(crate) fn coalesce_consecutive_messages(messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
    let mut output: Vec<ChatMessage> = Vec::new();
    for message in messages {
        let can_merge = output.last().is_some_and(|previous| {
            previous.role == message.role
                && matches!(message.role.as_str(), "user" | "assistant")
                && previous.tool_calls.as_ref().is_none_or(Vec::is_empty)
                && message.tool_calls.as_ref().is_none_or(Vec::is_empty)
        });
        if can_merge {
            let previous = output.last_mut().expect("checked above");
            previous.content = match (previous.content.is_empty(), message.content.is_empty()) {
                (false, false) => format!("{}\n\n{}", previous.content, message.content),
                (true, _) => message.content,
                _ => previous.content.clone(),
            };
        } else {
            output.push(message);
        }
    }
    output
}

pub(crate) async fn build_system_prompt(
    base_prompt: &str,
    hosted_web_search: bool,
    trigger: Option<&str>,
    query: Option<&str>,
) -> String {
    let mut sections = vec![
        "The available horizontal display space is 400px. Format responses for this width and avoid unnecessarily wide content."
            .to_string(),
    ];
    if !base_prompt.trim().is_empty() {
        let prompt = base_prompt.trim().to_string();
        let ctx = crate::templating::TemplateContext {
            query: query.map(|s| s.to_string()),
            trigger: trigger.map(|s| s.to_string()),
        };
        let resolved = crate::templating::resolve_template(&prompt, &ctx)
            .await
            .unwrap_or(prompt);
        sections.push(resolved);
    }
    if hosted_web_search {
        sections.push(
            "Today is {date}. Use web search for facts that may have changed, especially current events, schedules, sports, prices, availability, laws, and public roles. For ambiguous current-event queries, search first and use the most prominent current interpretation; ask only when no interpretation is clearly more likely. Do not search for stable facts or ordinary writing tasks.".to_string(),
        );
    }

    // Resolve any remaining placeholders like {date} injected above
    let joined = sections.join("\n\n");
    let final_ctx = crate::templating::TemplateContext {
        query: query.map(|s| s.to_string()),
        trigger: trigger.map(|s| s.to_string()),
    };
    crate::templating::resolve_template(&joined, &final_ctx)
        .await
        .unwrap_or(joined)
}

fn validate_provider_config(provider_id: &str, config: &ProviderConfig) -> Result<(), AppError> {
    if !config.enabled {
        return Err(AppError::Validation(format!(
            "provider '{provider_id}' is disabled"
        )));
    }
    if !matches!(
        provider_id,
        "openai" | "anthropic" | "google" | "ollama" | "openrouter" | "custom"
    ) {
        return Err(AppError::Validation(format!(
            "provider '{provider_id}' is not registered"
        )));
    }
    if matches!(
        provider_id,
        "openai" | "anthropic" | "google" | "openrouter"
    ) && config
        .api_key
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Err(AppError::Validation(format!(
            "API key for provider '{provider_id}' is not configured"
        )));
    }
    if matches!(provider_id, "ollama" | "custom")
        && config
            .base_url
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        return Err(AppError::Validation(format!(
            "Base URL for provider '{provider_id}' is not configured"
        )));
    }
    Ok(())
}

fn resolve_tools(
    agent: &AgentRow,
    registry: &ToolRegistry,
) -> Result<(Vec<ToolDefinition>, HashMap<String, String>), AppError> {
    let mut definitions = Vec::new();
    let mut wire_to_fqid = HashMap::new();
    for fully_qualified_id in &agent.tool_selection {
        let descriptor = registry
            .get_tool_descriptor(fully_qualified_id)
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "agent tool '{fully_qualified_id}' is not registered"
                ))
            })?;
        let wire_name = fully_qualified_id.replace(':', "__").replace('.', "--");
        if let Some(existing) = wire_to_fqid.insert(wire_name.clone(), fully_qualified_id.clone()) {
            return Err(AppError::Validation(format!(
                "agent tools '{existing}' and '{fully_qualified_id}' encode to the same provider name"
            )));
        }
        definitions.push(ToolDefinition {
            name: wire_name,
            description: descriptor.description,
            parameters: descriptor.parameters,
        });
    }
    Ok((definitions, wire_to_fqid))
}

#[allow(clippy::too_many_arguments)]
async fn run_loop<F, D, Fut>(
    agent: &AgentRow,
    registry: &ToolRegistry,
    config: AgentRunConfig,
    conversation: &mut Conversation<'_>,
    on_event: F,
    dispatch_external: D,
    mut cancellation: Option<watch::Receiver<bool>>,
    query: Option<&str>,
) -> Result<Option<String>, AppError>
where
    F: Fn(AgentStreamEvent) + Clone + Send + Sync + 'static,
    D: Fn(ExternalToolRequest) -> Fut + Send + Sync,
    Fut: Future<Output = Result<Value, AppError>> + Send,
{
    validate_provider_config(&agent.provider_id, &config.provider)?;
    let (tool_definitions, wire_to_fqid) = resolve_tools(agent, registry)?;
    let tools = (!tool_definitions.is_empty()).then_some(tool_definitions);
    let system_prompt = build_system_prompt(
        &agent.system_prompt,
        config.provider.hosted_web_search.unwrap_or(false),
        Some(&agent.shortcode_trigger),
        query,
    )
    .await;

    for _ in 0..MAX_TURNS {
        if cancellation.as_ref().is_some_and(|signal| *signal.borrow()) {
            return Ok(None);
        }
        let messages = coalesce_consecutive_messages(conversation.messages()?);
        let params = ChatParams {
            model_id: agent.model_id.clone(),
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            system_prompt: Some(system_prompt.clone()),
            tools: tools.clone(),
        };
        let output = Arc::new(Mutex::new(TurnOutput::default()));
        let output_for_stream = Arc::clone(&output);
        let on_stream_event = on_event.clone();
        let stream_future = crate::ai::commands::ai_stream_chat_impl(
            &agent.provider_id,
            config.provider.clone(),
            messages,
            params,
            Uuid::new_v4().to_string(),
            move |event| {
                let Ok(mut output) = output_for_stream.lock() else {
                    return;
                };
                match event {
                    ChatStreamEventPayload::Token { token } => {
                        if output.status_active {
                            output.status_active = false;
                            on_stream_event(AgentStreamEvent::Status { status: None });
                        }
                        output.text.push_str(&token);
                        on_stream_event(AgentStreamEvent::TextDelta {
                            delta: token,
                            accumulated: output.text.clone(),
                        });
                    }
                    ChatStreamEventPayload::Status { status } => {
                        output.status_active = true;
                        on_stream_event(AgentStreamEvent::Status {
                            status: Some(status),
                        });
                    }
                    ChatStreamEventPayload::ToolCall { id, name, input } => {
                        output.tool_calls.push(ToolCall { id, name, input });
                    }
                    ChatStreamEventPayload::ProviderContext { item } => {
                        output.provider_context.push(item);
                    }
                    ChatStreamEventPayload::Error { error } => {
                        on_stream_event(AgentStreamEvent::Error { message: error });
                    }
                    ChatStreamEventPayload::Done => {}
                }
            },
        );
        let stream_result = if let Some(signal) = cancellation.as_mut() {
            tokio::select! {
                result = stream_future => result,
                _ = wait_for_cancellation(signal) => return Ok(None),
            }
        } else {
            stream_future.await
        };

        let mut turn = {
            let mut guard = output.lock().map_err(|_| AppError::Lock)?;
            if guard.status_active {
                on_event(AgentStreamEvent::Status { status: None });
            }
            std::mem::take(&mut *guard)
        };

        let mut resolved_calls = Vec::with_capacity(turn.tool_calls.len());
        for tool_call in turn.tool_calls.drain(..) {
            let fully_qualified_id = wire_to_fqid
                .get(&tool_call.name)
                .cloned()
                .or_else(|| {
                    agent
                        .tool_selection
                        .iter()
                        .find(|selected| *selected == &tool_call.name)
                        .cloned()
                })
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "provider returned unknown tool '{}'",
                        tool_call.name
                    ))
                })?;
            resolved_calls.push(ToolCall {
                name: fully_qualified_id,
                ..tool_call
            });
        }

        let assistant_persisted = conversation.push_assistant(
            turn.text.clone(),
            resolved_calls.clone(),
            turn.provider_context,
        )?;
        if assistant_persisted {
            on_event(AgentStreamEvent::AssistantTurnPersisted);
        }

        stream_result?;
        if resolved_calls.is_empty() {
            return Ok(Some(turn.text));
        }

        for tool_call in resolved_calls {
            let output = if let Some(builtin_id) = tool_call.name.strip_prefix("builtin:") {
                crate::agents::tools::agents_invoke_builtin_tool_impl(
                    registry,
                    builtin_id,
                    tool_call.input.clone(),
                )
                .await?
            } else {
                let request = ExternalToolRequest {
                    tool_call_id: tool_call.id.clone(),
                    tool_id: tool_call.name.clone(),
                    arguments: tool_call.input.clone(),
                };
                let dispatch_future = dispatch_external(request);
                if let Some(signal) = cancellation.as_mut() {
                    tokio::select! {
                        result = dispatch_future => result?,
                        _ = wait_for_cancellation(signal) => return Ok(None),
                    }
                } else {
                    dispatch_future.await?
                }
            };
            conversation.push_tool_result(tool_call.id, output)?;
        }
    }

    Err(AppError::Validation(format!(
        "agent loop exceeded max turns ({MAX_TURNS})"
    )))
}

async fn wait_for_cancellation(signal: &mut watch::Receiver<bool>) {
    if *signal.borrow() {
        return;
    }
    while signal.changed().await.is_ok() {
        if *signal.borrow() {
            return;
        }
    }
}

#[allow(clippy::too_many_arguments)] // Explicit dependencies keep the runner independently testable.
pub async fn run_thread_loop_impl<F, D, Fut>(
    store: &DataStore,
    registry: &ToolRegistry,
    agent_id: &str,
    thread_id: &str,
    user_text: String,
    run_id: Option<String>,
    config: AgentRunConfig,
    on_event: F,
    dispatch_external: D,
    cancellation: Option<watch::Receiver<bool>>,
) -> Result<(), AppError>
where
    F: Fn(AgentStreamEvent) + Clone + Send + Sync + 'static,
    D: Fn(ExternalToolRequest) -> Fut + Send + Sync,
    Fut: Future<Output = Result<Value, AppError>> + Send,
{
    let (agent, thread) = {
        let conn = store.conn()?;
        let agent = get_agent(&conn, agent_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent '{agent_id}' not found")))?;
        let thread = get_thread(&conn, thread_id)?
            .ok_or_else(|| AppError::NotFound(format!("thread '{thread_id}' not found")))?;
        (agent, thread)
    };
    if thread.agent_id != agent_id {
        return Err(AppError::Validation(format!(
            "thread '{thread_id}' does not belong to agent '{agent_id}'"
        )));
    }
    let run_id = run_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    if !user_text.trim().is_empty() {
        let derived_title = thread
            .title
            .as_deref()
            .filter(|title| !title.trim().is_empty())
            .is_none()
            .then(|| crate::agents::lifecycle::derive_thread_title(&user_text));
        insert_message(
            &*store.conn()?,
            &MessageRow {
                id: Uuid::new_v4().to_string(),
                thread_id: thread_id.to_string(),
                role: MessageRole::User,
                content: json!({ "text": user_text }),
                created_at: chrono::Utc::now().timestamp_millis(),
                run_id: Some(run_id.clone()),
            },
        )?;
        if let Some(title) = derived_title {
            update_thread_title(
                &*store.conn()?,
                thread_id,
                &title,
                chrono::Utc::now().timestamp_millis(),
            )?;
        }
        on_event(AgentStreamEvent::UserMessagePersisted);
    }

    let mut conversation = Conversation::Persistent {
        store,
        thread_id,
        run_id: &run_id,
    };
    let result = run_loop(
        &agent,
        registry,
        config,
        &mut conversation,
        on_event.clone(),
        dispatch_external,
        cancellation,
        Some(&user_text),
    )
    .await?;
    on_event(if result.is_some() {
        AgentStreamEvent::Completed
    } else {
        AgentStreamEvent::Cancelled
    });
    Ok(())
}

pub async fn run_silent_agent_loop_impl<F, D, Fut>(
    agent: &AgentRow,
    registry: &ToolRegistry,
    user_text: String,
    config: AgentRunConfig,
    on_event: F,
    dispatch_external: D,
    cancellation: Option<watch::Receiver<bool>>,
) -> Result<String, AppError>
where
    F: Fn(AgentStreamEvent) + Clone + Send + Sync + 'static,
    D: Fn(ExternalToolRequest) -> Fut + Send + Sync,
    Fut: Future<Output = Result<Value, AppError>> + Send,
{
    if !agent.silent {
        return Err(AppError::Validation(format!(
            "agent '{}' is not configured for silent execution",
            agent.id
        )));
    }
    let mut conversation = Conversation::Ephemeral {
        messages: vec![ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: "user".to_string(),
            content: user_text.clone(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            tool_calls: None,
            tool_call_id: None,
            provider_context: None,
        }],
    };
    let result = run_loop(
        agent,
        registry,
        config,
        &mut conversation,
        on_event.clone(),
        dispatch_external,
        cancellation,
        Some(&user_text),
    )
    .await?;
    match result {
        Some(result) => {
            on_event(AgentStreamEvent::Completed);
            Ok(result)
        }
        None => {
            on_event(AgentStreamEvent::Cancelled);
            Ok(String::new())
        }
    }
}

#[allow(clippy::too_many_arguments)] // Explicit dependencies keep the runner independently testable.
pub async fn run_silent_loop_impl<F, D, Fut>(
    store: &DataStore,
    registry: &ToolRegistry,
    agent_id: &str,
    user_text: String,
    config: AgentRunConfig,
    on_event: F,
    dispatch_external: D,
    cancellation: Option<watch::Receiver<bool>>,
) -> Result<String, AppError>
where
    F: Fn(AgentStreamEvent) + Clone + Send + Sync + 'static,
    D: Fn(ExternalToolRequest) -> Fut + Send + Sync,
    Fut: Future<Output = Result<Value, AppError>> + Send,
{
    let agent = get_agent(&*store.conn()?, agent_id)?
        .ok_or_else(|| AppError::NotFound(format!("agent '{agent_id}' not found")))?;
    run_silent_agent_loop_impl(
        &agent,
        registry,
        user_text,
        config,
        on_event,
        dispatch_external,
        cancellation,
    )
    .await
}
