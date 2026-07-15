use crate::agents::runner::{ExternalToolRequest, McpPermissionChoice};
use crate::agents::tools::{ToolRegistry, ToolSource};
use crate::error::AppError;
use crate::mcp::McpSupervisor;
use crate::storage::DataStore;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

const BROWSER_BRIDGE_TIMEOUT: Duration = Duration::from_secs(120);

#[async_trait::async_trait]
pub trait AgentToolRuntime: Send + Sync {
    async fn invoke_mcp(
        &self,
        server_id: &str,
        tool_id: &str,
        agent_id: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, AppError>;

    async fn invoke_tier2(
        &self,
        extension_id: &str,
        tool_id: &str,
        request: &ExternalToolRequest,
    ) -> Result<serde_json::Value, AppError>;

    async fn request_mcp_permission(
        &self,
        tool_call_id: &str,
        server_id: &str,
        tool_id: &str,
        agent_id: &str,
    ) -> Result<McpPermissionChoice, AppError>;

    fn persist_mcp_permission(
        &self,
        server_id: &str,
        tool_id: &str,
        agent_id: &str,
        decision: McpPermissionChoice,
    ) -> Result<(), AppError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentToolTarget {
    Builtin {
        tool_id: String,
    },
    Tier2 {
        extension_id: String,
        tool_id: String,
    },
    Mcp {
        server_id: String,
        tool_id: String,
    },
}

pub fn resolve_agent_tool_target(
    registry: &ToolRegistry,
    fully_qualified_id: &str,
) -> Result<AgentToolTarget, AppError> {
    let descriptor = registry
        .get_tool_descriptor(fully_qualified_id)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "agent tool '{fully_qualified_id}' is not registered"
            ))
        })?;
    Ok(match descriptor.source {
        ToolSource::Builtin => AgentToolTarget::Builtin {
            tool_id: descriptor.id,
        },
        ToolSource::Tier2(extension_id) => AgentToolTarget::Tier2 {
            extension_id,
            tool_id: descriptor.id,
        },
        ToolSource::Mcp(server_id) => AgentToolTarget::Mcp {
            server_id,
            tool_id: descriptor.id,
        },
    })
}

pub async fn execute_agent_tool<R: AgentToolRuntime>(
    registry: &ToolRegistry,
    runtime: &R,
    agent_id: &str,
    request: &ExternalToolRequest,
) -> Result<serde_json::Value, AppError> {
    match resolve_agent_tool_target(registry, &request.tool_id)? {
        AgentToolTarget::Builtin { tool_id } => Err(AppError::Validation(format!(
            "built-in tool '{tool_id}' must execute inside the agent runner"
        ))),
        AgentToolTarget::Tier2 {
            extension_id,
            tool_id,
        } => runtime.invoke_tier2(&extension_id, &tool_id, request).await,
        AgentToolTarget::Mcp { server_id, tool_id } => {
            let first_attempt = runtime
                .invoke_mcp(&server_id, &tool_id, agent_id, request.arguments.clone())
                .await;
            if !matches!(first_attempt, Err(AppError::McpPermissionRequired { .. })) {
                return first_attempt;
            }

            let decision = runtime
                .request_mcp_permission(&request.tool_call_id, &server_id, &tool_id, agent_id)
                .await?;
            if decision == McpPermissionChoice::Cancel {
                return Err(AppError::Validation(format!(
                    "MCP permission request for {server_id}:{tool_id} was cancelled"
                )));
            }
            runtime.persist_mcp_permission(&server_id, &tool_id, agent_id, decision)?;
            runtime
                .invoke_mcp(&server_id, &tool_id, agent_id, request.arguments.clone())
                .await
        }
    }
}

async fn await_bridge_response<T>(
    receiver: oneshot::Receiver<T>,
    timeout: Duration,
    label: &str,
) -> Result<T, AppError> {
    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err(AppError::Other(format!(
            "{label} channel closed before a response arrived"
        ))),
        Err(_) => Err(AppError::Other(format!("{label} timed out"))),
    }
}

#[derive(Clone)]
pub struct TauriAgentToolRuntime {
    app: AppHandle,
    runner_state: crate::agents::runner::AgentRunnerState,
    stream_id: String,
    supervisor: Arc<McpSupervisor>,
    store: DataStore,
}

impl TauriAgentToolRuntime {
    pub fn new(
        app: AppHandle,
        runner_state: crate::agents::runner::AgentRunnerState,
        stream_id: String,
        supervisor: Arc<McpSupervisor>,
        store: DataStore,
    ) -> Self {
        Self {
            app,
            runner_state,
            stream_id,
            supervisor,
            store,
        }
    }

    fn emit(&self, event: crate::agents::runner::AgentStreamEvent) -> Result<(), AppError> {
        self.app
            .emit(
                "agent-stream-event",
                &crate::agents::runner::AgentStreamEventPayload {
                    stream_id: self.stream_id.clone(),
                    event,
                },
            )
            .map_err(|error| AppError::Other(error.to_string()))
    }
}

#[async_trait::async_trait]
impl AgentToolRuntime for TauriAgentToolRuntime {
    async fn invoke_mcp(
        &self,
        server_id: &str,
        tool_id: &str,
        agent_id: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, AppError> {
        crate::mcp::tool_adapter::invoke_mcp_tool(
            &self.supervisor,
            &self.store,
            server_id,
            tool_id,
            Some(agent_id),
            args,
        )
        .await
    }

    async fn invoke_tier2(
        &self,
        extension_id: &str,
        tool_id: &str,
        request: &ExternalToolRequest,
    ) -> Result<serde_json::Value, AppError> {
        let receiver = self
            .runner_state
            .begin_tool_call(&self.stream_id, request)?;
        if let Err(error) = self.emit(crate::agents::runner::AgentStreamEvent::ToolDispatch {
            tool_call_id: request.tool_call_id.clone(),
            extension_id: extension_id.to_string(),
            tool_id: tool_id.to_string(),
            arguments: request.arguments.clone(),
        }) {
            self.runner_state.cancel_tool_call(&self.stream_id)?;
            return Err(error);
        }

        let response =
            await_bridge_response(receiver, BROWSER_BRIDGE_TIMEOUT, "Tier 2 tool call").await;
        match response {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(AppError::Other(error)),
            Err(error) => {
                self.runner_state.cancel_tool_call(&self.stream_id)?;
                let _ = self.emit(
                    crate::agents::runner::AgentStreamEvent::ToolDispatchCancelled {
                        tool_call_id: request.tool_call_id.clone(),
                    },
                );
                Err(error)
            }
        }
    }

    async fn request_mcp_permission(
        &self,
        tool_call_id: &str,
        server_id: &str,
        tool_id: &str,
        agent_id: &str,
    ) -> Result<McpPermissionChoice, AppError> {
        let receiver = self
            .runner_state
            .begin_mcp_permission(&self.stream_id, tool_call_id)?;
        if let Err(error) = self.emit(
            crate::agents::runner::AgentStreamEvent::McpPermissionRequest {
                tool_call_id: tool_call_id.to_string(),
                server_id: server_id.to_string(),
                tool_id: tool_id.to_string(),
                agent_id: agent_id.to_string(),
            },
        ) {
            self.runner_state.cancel_mcp_permission(&self.stream_id)?;
            return Err(error);
        }

        match await_bridge_response(receiver, BROWSER_BRIDGE_TIMEOUT, "MCP permission request")
            .await
        {
            Ok(decision) => Ok(decision),
            Err(error) => {
                self.runner_state.cancel_mcp_permission(&self.stream_id)?;
                let _ = self.emit(
                    crate::agents::runner::AgentStreamEvent::McpPermissionCancelled {
                        tool_call_id: tool_call_id.to_string(),
                    },
                );
                Err(error)
            }
        }
    }

    fn persist_mcp_permission(
        &self,
        server_id: &str,
        tool_id: &str,
        agent_id: &str,
        decision: McpPermissionChoice,
    ) -> Result<(), AppError> {
        use crate::storage::mcp_permissions::{McpPermissionRow, PermissionDecision};
        let decision = match decision {
            McpPermissionChoice::AllowOnce => PermissionDecision::AllowOnce,
            McpPermissionChoice::AllowAlways => PermissionDecision::AllowAlways,
            McpPermissionChoice::Never => PermissionDecision::Never,
            McpPermissionChoice::Cancel => {
                return Err(AppError::Validation(
                    "cancel is not a persistent MCP permission decision".to_string(),
                ));
            }
        };
        let conn = self.store.conn()?;
        crate::storage::mcp_permissions::set_permission(
            &conn,
            &McpPermissionRow {
                server_id: server_id.to_string(),
                tool_id: tool_id.to_string(),
                agent_id: agent_id.to_string(),
                decision,
                set_at: chrono::Utc::now().timestamp_millis(),
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::tools::{ManifestTool, ToolRegistry};
    use std::sync::Mutex;

    fn manifest_tool(id: &str) -> ManifestTool {
        ManifestTool {
            id: id.to_string(),
            name: id.to_string(),
            description: format!("{id} description"),
            parameters: serde_json::json!({ "type": "object" }),
        }
    }

    #[test]
    fn resolves_tier2_target_from_registered_descriptor() {
        let registry = ToolRegistry::new();
        registry
            .register_tier2("org.example.notes", vec![manifest_tool("lookup")])
            .unwrap();

        let target = resolve_agent_tool_target(&registry, "org.example.notes:lookup").unwrap();

        assert_eq!(
            target,
            AgentToolTarget::Tier2 {
                extension_id: "org.example.notes".to_string(),
                tool_id: "lookup".to_string(),
            }
        );
    }

    #[test]
    fn resolves_mcp_target_without_frontend_id_parsing() {
        let registry = ToolRegistry::new();
        registry
            .register_mcp("linear", vec![manifest_tool("create_issue")])
            .unwrap();

        let target = resolve_agent_tool_target(&registry, "mcp:linear:create_issue").unwrap();

        assert_eq!(
            target,
            AgentToolTarget::Mcp {
                server_id: "linear".to_string(),
                tool_id: "create_issue".to_string(),
            }
        );
    }

    #[test]
    fn rejects_unregistered_tool_ids() {
        let error =
            resolve_agent_tool_target(&ToolRegistry::new(), "mcp:missing:tool").unwrap_err();

        assert!(error.to_string().contains("not registered"));
    }

    #[derive(Default)]
    struct MockRuntime {
        mcp_results: Mutex<Vec<Result<serde_json::Value, AppError>>>,
        mcp_calls: Mutex<Vec<(String, String, String, serde_json::Value)>>,
        tier2_calls: Mutex<Vec<(String, String, ExternalToolRequest)>>,
        permission_requests: Mutex<Vec<(String, String, String, String)>>,
        persisted: Mutex<Vec<(String, String, String, McpPermissionChoice)>>,
        permission_choice: Mutex<Option<McpPermissionChoice>>,
    }

    #[async_trait::async_trait]
    impl AgentToolRuntime for MockRuntime {
        async fn invoke_mcp(
            &self,
            server_id: &str,
            tool_id: &str,
            agent_id: &str,
            args: serde_json::Value,
        ) -> Result<serde_json::Value, AppError> {
            self.mcp_calls.lock().unwrap().push((
                server_id.to_string(),
                tool_id.to_string(),
                agent_id.to_string(),
                args,
            ));
            self.mcp_results.lock().unwrap().remove(0)
        }

        async fn invoke_tier2(
            &self,
            extension_id: &str,
            tool_id: &str,
            request: &ExternalToolRequest,
        ) -> Result<serde_json::Value, AppError> {
            self.tier2_calls.lock().unwrap().push((
                extension_id.to_string(),
                tool_id.to_string(),
                request.clone(),
            ));
            Ok(serde_json::json!({ "source": "tier2" }))
        }

        async fn request_mcp_permission(
            &self,
            tool_call_id: &str,
            server_id: &str,
            tool_id: &str,
            agent_id: &str,
        ) -> Result<McpPermissionChoice, AppError> {
            self.permission_requests.lock().unwrap().push((
                tool_call_id.to_string(),
                server_id.to_string(),
                tool_id.to_string(),
                agent_id.to_string(),
            ));
            self.permission_choice
                .lock()
                .unwrap()
                .take()
                .ok_or_else(|| AppError::Other("missing mock permission choice".to_string()))
        }

        fn persist_mcp_permission(
            &self,
            server_id: &str,
            tool_id: &str,
            agent_id: &str,
            decision: McpPermissionChoice,
        ) -> Result<(), AppError> {
            self.persisted.lock().unwrap().push((
                server_id.to_string(),
                tool_id.to_string(),
                agent_id.to_string(),
                decision,
            ));
            Ok(())
        }
    }

    fn request(tool_id: &str) -> ExternalToolRequest {
        ExternalToolRequest {
            tool_call_id: "call-1".to_string(),
            tool_id: tool_id.to_string(),
            arguments: serde_json::json!({ "value": 7 }),
        }
    }

    #[tokio::test]
    async fn executes_tier2_tools_only_through_the_browser_bridge() {
        let registry = ToolRegistry::new();
        registry
            .register_tier2("org.example.notes", vec![manifest_tool("lookup")])
            .unwrap();
        let runtime = MockRuntime::default();

        let result = execute_agent_tool(
            &registry,
            &runtime,
            "agent-1",
            &request("org.example.notes:lookup"),
        )
        .await
        .unwrap();

        assert_eq!(result, serde_json::json!({ "source": "tier2" }));
        assert_eq!(runtime.tier2_calls.lock().unwrap().len(), 1);
        assert!(runtime.mcp_calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn executes_mcp_tools_in_rust_without_browser_dispatch() {
        let registry = ToolRegistry::new();
        registry
            .register_mcp("linear", vec![manifest_tool("list_issues")])
            .unwrap();
        let runtime = MockRuntime::default();
        runtime
            .mcp_results
            .lock()
            .unwrap()
            .push(Ok(serde_json::json!({ "issues": [] })));

        let result = execute_agent_tool(
            &registry,
            &runtime,
            "agent-1",
            &request("mcp:linear:list_issues"),
        )
        .await
        .unwrap();

        assert_eq!(result, serde_json::json!({ "issues": [] }));
        assert!(runtime.tier2_calls.lock().unwrap().is_empty());
        assert!(runtime.permission_requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn mcp_permission_is_prompted_persisted_and_retried_in_rust() {
        let registry = ToolRegistry::new();
        registry
            .register_mcp("linear", vec![manifest_tool("create_issue")])
            .unwrap();
        let runtime = MockRuntime::default();
        runtime.mcp_results.lock().unwrap().extend([
            Err(AppError::McpPermissionRequired {
                server_id: "linear".to_string(),
                tool_id: "create_issue".to_string(),
            }),
            Ok(serde_json::json!({ "created": true })),
        ]);
        *runtime.permission_choice.lock().unwrap() = Some(McpPermissionChoice::AllowOnce);

        let result = execute_agent_tool(
            &registry,
            &runtime,
            "agent-1",
            &request("mcp:linear:create_issue"),
        )
        .await
        .unwrap();

        assert_eq!(result, serde_json::json!({ "created": true }));
        assert_eq!(runtime.mcp_calls.lock().unwrap().len(), 2);
        assert_eq!(runtime.permission_requests.lock().unwrap().len(), 1);
        assert_eq!(
            runtime.persisted.lock().unwrap().as_slice(),
            &[(
                "linear".to_string(),
                "create_issue".to_string(),
                "agent-1".to_string(),
                McpPermissionChoice::AllowOnce,
            )]
        );
    }

    #[tokio::test]
    async fn cancelling_mcp_permission_does_not_persist_or_retry() {
        let registry = ToolRegistry::new();
        registry
            .register_mcp("linear", vec![manifest_tool("create_issue")])
            .unwrap();
        let runtime = MockRuntime::default();
        runtime
            .mcp_results
            .lock()
            .unwrap()
            .push(Err(AppError::McpPermissionRequired {
                server_id: "linear".to_string(),
                tool_id: "create_issue".to_string(),
            }));
        *runtime.permission_choice.lock().unwrap() = Some(McpPermissionChoice::Cancel);

        let error = execute_agent_tool(
            &registry,
            &runtime,
            "agent-1",
            &request("mcp:linear:create_issue"),
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("cancelled"));
        assert_eq!(runtime.mcp_calls.lock().unwrap().len(), 1);
        assert!(runtime.persisted.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn browser_bridge_wait_is_bounded() {
        let (_sender, receiver) = tokio::sync::oneshot::channel::<serde_json::Value>();

        let error = await_bridge_response(
            receiver,
            std::time::Duration::from_millis(1),
            "Tier 2 tool call",
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("timed out"));
    }
}
