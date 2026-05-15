use crate::agents::tools::ToolRegistryState;
use crate::error::AppError;
use crate::mcp::install::{
    detect_existing_configs, install_server, list_servers_with_status, parse_mcp_config_json,
    test_server, DetectedConfig, McpServerInstallInput, McpServerSummary, McpTestResult,
};
use crate::mcp::lifecycle::{mcp_cleanup_on_delete, mcp_sync_on_enable_change};
use crate::mcp::tool_adapter::invoke_mcp_tool;
use crate::mcp::{McpSupervisor, McpToolDescriptor};
use crate::storage::mcp_audit::McpAuditRow;
use crate::storage::mcp_permissions;
use crate::storage::DataStore;
use std::sync::Arc;
use tauri::State;

// ── mcp_list_servers ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_list_servers(
    supervisor: State<'_, Arc<McpSupervisor>>,
    data_store: State<'_, DataStore>,
) -> Result<Vec<McpServerSummary>, AppError> {
    list_servers_with_status(&supervisor, &data_store).await
}

// ── mcp_install_server ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_install_server(
    supervisor: State<'_, Arc<McpSupervisor>>,
    registry: State<'_, ToolRegistryState>,
    data_store: State<'_, DataStore>,
    input: McpServerInstallInput,
) -> Result<McpServerSummary, AppError> {
    install_server(&supervisor, &registry, &data_store, input).await
}

// ── mcp_test_server ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_test_server(
    supervisor: State<'_, Arc<McpSupervisor>>,
    input: McpServerInstallInput,
) -> Result<McpTestResult, AppError> {
    Ok(test_server(supervisor.factory(), input).await)
}

// ── mcp_set_server_enabled ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_set_server_enabled<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    server_id: String,
    enabled: bool,
) -> Result<(), AppError> {
    mcp_sync_on_enable_change(&app, &server_id, enabled).await
}

// ── mcp_uninstall_server ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_uninstall_server<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    server_id: String,
) -> Result<(), AppError> {
    mcp_cleanup_on_delete(&app, &server_id).await
}

// ── mcp_list_audit ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_list_audit(
    data_store: State<'_, DataStore>,
    server_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<McpAuditRow>, AppError> {
    let conn = data_store.conn()?;
    crate::storage::mcp_audit::list_recent(
        &conn,
        server_id.as_deref(),
        limit.unwrap_or(100),
    )
}

// ── mcp_invoke_tool ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_invoke_tool(
    supervisor: State<'_, Arc<McpSupervisor>>,
    data_store: State<'_, DataStore>,
    server_id: String,
    tool_id: String,
    agent_id: Option<String>,
    args: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    invoke_mcp_tool(
        &supervisor,
        &data_store,
        &server_id,
        &tool_id,
        agent_id.as_deref(),
        args,
    )
    .await
}

// ── mcp_detect_existing_configs ───────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_detect_existing_configs() -> Result<Vec<DetectedConfig>, AppError> {
    Ok(detect_existing_configs().await)
}

// ── mcp_parse_config_json ─────────────────────────────────────────────────────

#[tauri::command]
pub fn mcp_parse_config_json(json: String) -> Result<Vec<McpServerInstallInput>, AppError> {
    parse_mcp_config_json(&json)
}

// ── mcp_set_permission ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_set_permission(
    data_store: State<'_, DataStore>,
    server_id: String,
    tool_id: String,
    agent_id: String,
    decision: String,
) -> Result<(), AppError> {
    let decision_enum = match decision.as_str() {
        "allow_once" => crate::storage::mcp_permissions::PermissionDecision::AllowOnce,
        "allow_always" => crate::storage::mcp_permissions::PermissionDecision::AllowAlways,
        "never" => crate::storage::mcp_permissions::PermissionDecision::Never,
        other => return Err(AppError::Validation(format!("invalid decision: {other}"))),
    };
    let conn = data_store.conn()?;
    let row = crate::storage::mcp_permissions::McpPermissionRow {
        server_id,
        tool_id,
        agent_id,
        decision: decision_enum,
        set_at: now_millis(),
    };
    crate::storage::mcp_permissions::set_permission(&conn, &row)
}

// ── mcp_list_server_tools ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_list_server_tools(
    supervisor: State<'_, Arc<McpSupervisor>>,
    server_id: String,
) -> Result<Vec<McpToolDescriptor>, AppError> {
    supervisor
        .list_tools(&server_id)
        .await
        .map_err(|e| AppError::Other(format!("{e}")))
}

// ── mcp_list_permissions ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_list_permissions(
    data_store: State<'_, DataStore>,
    server_id: Option<String>,
) -> Result<Vec<mcp_permissions::McpPermissionRow>, AppError> {
    let conn = data_store.conn()?;
    mcp_permissions::list_permissions(&conn, server_id.as_deref())
}

// ── mcp_delete_permission ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_delete_permission(
    data_store: State<'_, DataStore>,
    server_id: String,
    tool_id: String,
    agent_id: String,
) -> Result<(), AppError> {
    let conn = data_store.conn()?;
    mcp_permissions::delete_permission(&conn, &server_id, &tool_id, &agent_id)
}

// ── mcp_get_permission ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_get_permission(
    data_store: State<'_, DataStore>,
    server_id: String,
    tool_id: String,
    agent_id: String,
) -> Result<Option<String>, AppError> {
    let conn = data_store.conn()?;
    let row = crate::storage::mcp_permissions::get_permission(
        &conn, &server_id, &tool_id, &agent_id,
    )?;
    Ok(row.map(|r| {
        match r.decision {
            crate::storage::mcp_permissions::PermissionDecision::AllowOnce => "allow_once",
            crate::storage::mcp_permissions::PermissionDecision::AllowAlways => "allow_always",
            crate::storage::mcp_permissions::PermissionDecision::Never => "never",
        }
        .to_string()
    }))
}

// ── mcp_get_strict_mode / mcp_set_strict_mode ────────────────────────────────
//
// Strict mode forces every tool call to require a user permission decision,
// even tools that match the read-only name-prefix heuristic. Defaults off.

#[tauri::command]
pub async fn mcp_get_strict_mode(data_store: State<'_, DataStore>) -> Result<bool, AppError> {
    let conn = data_store.conn()?;
    crate::storage::mcp_settings::get_strict_mode(&conn)
}

#[tauri::command]
pub async fn mcp_set_strict_mode(
    data_store: State<'_, DataStore>,
    enabled: bool,
) -> Result<(), AppError> {
    let conn = data_store.conn()?;
    crate::storage::mcp_settings::set_strict_mode(&conn, enabled)
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
