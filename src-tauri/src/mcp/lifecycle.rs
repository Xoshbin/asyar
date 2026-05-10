use crate::agents::tools::ToolRegistryState;
use crate::error::AppError;
use crate::mcp::install::transport_from_row;
use crate::mcp::supervisor::McpSupervisor;
use crate::mcp::tool_adapter::descriptors_from_mcp_tools;
use crate::mcp::types::McpServerConfig;
use crate::storage::mcp_audit;
use crate::storage::mcp_permissions;
use crate::storage::mcp_servers;
use std::sync::Arc;
use tauri::Manager;

// ── mcp_seed_enabled_servers_at_startup ───────────────────────────────────────

/// Called once during `setup_app`, after the supervisor and tool registry are
/// managed. Reads all enabled MCP servers from SQLite, probes each one for its
/// tool list, registers the tools in the tool registry, then starts the
/// supervisor watchdog for each.
pub async fn mcp_seed_enabled_servers_at_startup<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) {
    let supervisor = match app.try_state::<Arc<McpSupervisor>>() {
        Some(s) => Arc::clone(&*s),
        None => {
            log::warn!("[mcp seed] McpSupervisor not managed — skipping seed");
            return;
        }
    };
    let registry = match app.try_state::<ToolRegistryState>() {
        Some(r) => Arc::clone(&*r),
        None => {
            log::warn!("[mcp seed] ToolRegistry not managed — skipping seed");
            return;
        }
    };
    let store = match app.try_state::<crate::storage::DataStore>() {
        Some(s) => s,
        None => {
            log::warn!("[mcp seed] DataStore not managed — skipping seed");
            return;
        }
    };

    let rows = {
        let conn = match store.conn() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[mcp seed] failed to acquire DB connection: {e}");
                return;
            }
        };
        match mcp_servers::list_servers(&conn) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[mcp seed] failed to list servers: {e}");
                return;
            }
        }
    };

    let enabled: Vec<_> = rows.into_iter().filter(|r| r.enabled).collect();
    if enabled.is_empty() {
        return;
    }

    log::info!("[mcp seed] seeding {} enabled MCP server(s)", enabled.len());

    for row in enabled {
        let transport = match transport_from_row(&row) {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[mcp seed] skipping '{}': {e}", row.id);
                continue;
            }
        };

        // Fresh handshake to enumerate tools synchronously.
        let tools =
            match McpSupervisor::connect_and_list_tools(supervisor.factory(), &transport).await {
                Ok(t) => t,
                Err(e) => {
                    log::warn!("[mcp seed] handshake failed for '{}': {e}", row.id);
                    continue;
                }
            };

        let manifest_tools = descriptors_from_mcp_tools(&row.id, tools);
        if let Err(e) = registry.register_mcp(&row.id, manifest_tools) {
            log::warn!(
                "[mcp seed] failed to register tools for '{}': {e}",
                row.id
            );
        }

        // Start the persistent watchdog.
        let config = McpServerConfig {
            id: row.id.clone(),
            display_name: row.display_name.clone(),
            transport,
            enabled: true,
        };
        if let Err(e) = supervisor.enable(config).await {
            log::warn!(
                "[mcp seed] failed to enable supervisor for '{}': {e}",
                row.id
            );
        }
    }
}

// ── mcp_sync_on_enable_change ─────────────────────────────────────────────────

/// Called when the user flips the enabled toggle for an MCP server.
///
/// - `enabled = true` → probe for tools, register, start watchdog, update DB.
/// - `enabled = false` → stop watchdog, unregister tools, update DB.
pub async fn mcp_sync_on_enable_change<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    server_id: &str,
    enabled: bool,
) -> Result<(), AppError> {
    let supervisor = app
        .try_state::<Arc<McpSupervisor>>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("McpSupervisor not managed".to_string()))?;
    let registry = app
        .try_state::<ToolRegistryState>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("ToolRegistry not managed".to_string()))?;
    let store = app
        .try_state::<crate::storage::DataStore>()
        .ok_or_else(|| AppError::Other("DataStore not managed".to_string()))?;

    if enabled {
        // Load the row.
        let row = {
            let conn = store.conn()?;
            mcp_servers::get_server(&conn, server_id)?.ok_or_else(|| {
                AppError::NotFound(format!("MCP server '{}' not found", server_id))
            })?
        };

        let transport = transport_from_row(&row)?;

        // Probe to get tools.
        let tools = McpSupervisor::connect_and_list_tools(supervisor.factory(), &transport)
            .await
            .map_err(|e| {
                AppError::Other(format!(
                    "MCP server '{}' handshake failed: {}",
                    server_id, e
                ))
            })?;

        let manifest_tools = descriptors_from_mcp_tools(server_id, tools);
        registry.register_mcp(server_id, manifest_tools)?;

        // Start watchdog.
        let config = McpServerConfig {
            id: row.id.clone(),
            display_name: row.display_name.clone(),
            transport,
            enabled: true,
        };
        supervisor.enable(config).await.map_err(|e| {
            AppError::Other(format!(
                "Failed to start supervisor for '{}': {}",
                server_id, e
            ))
        })?;

        // Persist enabled=true.
        let conn = store.conn()?;
        mcp_servers::set_enabled(&conn, server_id, true)?;
    } else {
        // Stop watchdog.
        supervisor
            .disable(&server_id.to_string())
            .await
            .map_err(|e| {
                AppError::Other(format!(
                    "Failed to disable supervisor for '{}': {}",
                    server_id, e
                ))
            })?;

        // Unregister tools.
        registry.unregister_mcp(server_id)?;

        // Persist enabled=false.
        let conn = store.conn()?;
        mcp_servers::set_enabled(&conn, server_id, false)?;
    }

    Ok(())
}

// ── mcp_cleanup_on_delete ─────────────────────────────────────────────────────

/// Called when the user deletes an MCP server. Stops the watchdog, removes all
/// registered tools, and deletes the persisted rows (server, audit, permissions).
pub async fn mcp_cleanup_on_delete<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    server_id: &str,
) -> Result<(), AppError> {
    let supervisor = app
        .try_state::<Arc<McpSupervisor>>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("McpSupervisor not managed".to_string()))?;
    let registry = app
        .try_state::<ToolRegistryState>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("ToolRegistry not managed".to_string()))?;
    let store = app
        .try_state::<crate::storage::DataStore>()
        .ok_or_else(|| AppError::Other("DataStore not managed".to_string()))?;

    // Stop watchdog (idempotent if not running).
    supervisor
        .disable(&server_id.to_string())
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to disable supervisor for '{}': {}",
                server_id, e
            ))
        })?;

    // Unregister tools (no-op if not registered).
    registry.unregister_mcp(server_id)?;

    // Delete persisted data.
    {
        let conn = store.conn()?;
        mcp_servers::delete_server(&conn, server_id)?;
        mcp_audit::purge_for_server(&conn, server_id)?;
        mcp_permissions::delete_for_server(&conn, server_id)?;
    }

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::transport::{duplex_pair, Transport, TransportFactory};
    use crate::mcp::types::{McpClientError, McpTransportSpec};
    use crate::mcp::{McpSupervisor, SupervisorConfig};
    use async_trait::async_trait;

    use std::sync::Arc;
    use std::time::Duration;

    struct MockSucceedFactory;

    #[async_trait]
    impl TransportFactory for MockSucceedFactory {
        async fn connect(
            &self,
            _spec: &McpTransportSpec,
        ) -> Result<Box<dyn Transport>, McpClientError> {
            let (transport, mut server) = duplex_pair();
            tokio::spawn(async move {
                let _req = server.recv_line().await;
                server
                    .send_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"mock","version":"0"}}}"#)
                    .await;
                let _ = server.recv_line().await;
                let _list = server.recv_line().await;
                server
                    .send_line(r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"lifecycle_tool","description":"a tool","inputSchema":{"type":"object"}}]}}"#)
                    .await;
                loop {
                    if server.recv_line().await.is_none() {
                        break;
                    }
                }
            });
            Ok(transport)
        }
    }

    fn make_supervisor() -> Arc<McpSupervisor> {
        let factory = Arc::new(MockSucceedFactory);
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        Arc::new(McpSupervisor::new(factory, cfg))
    }

    // ── Test-only helpers that avoid AppHandle dependency ────────────────────

    /// Equivalent to `mcp_seed_enabled_servers_at_startup` but called with
    /// direct references (no AppHandle needed in tests).
    async fn seed_servers_directly(
        supervisor: &Arc<McpSupervisor>,
        registry: &Arc<crate::agents::tools::ToolRegistry>,
        store: &crate::storage::DataStore,
    ) {
        let rows = {
            let conn = store.conn().unwrap();
            mcp_servers::list_servers(&conn).unwrap()
        };

        for row in rows.into_iter().filter(|r| r.enabled) {
            let transport = match transport_from_row(&row) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let tools = match McpSupervisor::connect_and_list_tools(
                supervisor.factory(),
                &transport,
            )
            .await
            {
                Ok(t) => t,
                Err(_) => continue,
            };
            let manifest_tools = descriptors_from_mcp_tools(&row.id, tools);
            let _ = registry.register_mcp(&row.id, manifest_tools);
            let config = McpServerConfig {
                id: row.id.clone(),
                display_name: row.display_name.clone(),
                transport,
                enabled: true,
            };
            let _ = supervisor.enable(config).await;
        }
    }

    async fn sync_enable_change_directly(
        supervisor: &Arc<McpSupervisor>,
        registry: &Arc<crate::agents::tools::ToolRegistry>,
        store: &crate::storage::DataStore,
        server_id: &str,
        enabled: bool,
    ) -> Result<(), AppError> {
        if enabled {
            let row = {
                let conn = store.conn()?;
                mcp_servers::get_server(&conn, server_id)?
                    .ok_or_else(|| AppError::NotFound(format!("server '{server_id}' not found")))?
            };
            let transport = transport_from_row(&row)?;
            let tools = McpSupervisor::connect_and_list_tools(supervisor.factory(), &transport)
                .await
                .map_err(|e| AppError::Other(e.to_string()))?;
            let manifest_tools = descriptors_from_mcp_tools(server_id, tools);
            registry.register_mcp(server_id, manifest_tools)?;
            let config = McpServerConfig {
                id: row.id.clone(),
                display_name: row.display_name.clone(),
                transport,
                enabled: true,
            };
            supervisor
                .enable(config)
                .await
                .map_err(|e| AppError::Other(e.to_string()))?;
            let conn = store.conn()?;
            mcp_servers::set_enabled(&conn, server_id, true)?;
        } else {
            supervisor
                .disable(&server_id.to_string())
                .await
                .map_err(|e| AppError::Other(e.to_string()))?;
            registry.unregister_mcp(server_id)?;
            let conn = store.conn()?;
            mcp_servers::set_enabled(&conn, server_id, false)?;
        }
        Ok(())
    }

    async fn cleanup_delete_directly(
        supervisor: &Arc<McpSupervisor>,
        registry: &Arc<crate::agents::tools::ToolRegistry>,
        store: &crate::storage::DataStore,
        server_id: &str,
    ) -> Result<(), AppError> {
        supervisor
            .disable(&server_id.to_string())
            .await
            .map_err(|e| AppError::Other(e.to_string()))?;
        registry.unregister_mcp(server_id)?;
        let conn = store.conn()?;
        mcp_servers::delete_server(&conn, server_id)?;
        mcp_audit::purge_for_server(&conn, server_id)?;
        mcp_permissions::delete_for_server(&conn, server_id)?;
        Ok(())
    }

    // ── 1. seed_enabled_servers_registers_tools_for_enabled_rows ─────────────

    #[tokio::test]
    async fn seed_enabled_servers_registers_tools_for_enabled_rows() {
        let supervisor = make_supervisor();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        // Insert an enabled server row into SQLite.
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "seed-srv".to_string(),
                    display_name: "Seed Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("/usr/bin/mcp-server".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: true,
                    created_at: 1000,
                    updated_at: 1000,
                },
            )
            .unwrap();
        }

        seed_servers_directly(&supervisor, &registry, &store).await;

        // The tool should be registered.
        let tools = registry.list_all();
        let mcp: Vec<_> = tools
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(mcp.len(), 1, "expected 1 MCP tool after seed");
        assert_eq!(mcp[0].id, "lifecycle_tool");
    }

    // ── 2. sync_enable_registers_then_disable_unregisters ────────────────────

    #[tokio::test]
    async fn sync_enable_registers_then_disable_unregisters() {
        let supervisor = make_supervisor();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        // Insert a disabled server row.
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "toggle-srv".to_string(),
                    display_name: "Toggle Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("/usr/bin/mcp-server".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: false,
                    created_at: 2000,
                    updated_at: 2000,
                },
            )
            .unwrap();
        }

        // Enable → tools should appear.
        sync_enable_change_directly(&supervisor, &registry, &store, "toggle-srv", true)
            .await
            .expect("enable failed");

        let tools_after_enable = registry.list_all();
        let mcp: Vec<_> = tools_after_enable
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(mcp.len(), 1, "expected 1 MCP tool after enable");

        // DB should reflect enabled=true.
        {
            let conn = store.conn().unwrap();
            let row = crate::storage::mcp_servers::get_server(&conn, "toggle-srv")
                .unwrap()
                .unwrap();
            assert!(row.enabled);
        }

        // Disable → tools should be gone.
        sync_enable_change_directly(&supervisor, &registry, &store, "toggle-srv", false)
            .await
            .expect("disable failed");

        let tools_after_disable = registry.list_all();
        let mcp_after_disable: Vec<_> = tools_after_disable
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(
            mcp_after_disable.len(),
            0,
            "expected no MCP tools after disable"
        );

        // DB should reflect enabled=false.
        {
            let conn = store.conn().unwrap();
            let row = crate::storage::mcp_servers::get_server(&conn, "toggle-srv")
                .unwrap()
                .unwrap();
            assert!(!row.enabled);
        }
    }

    // ── 3. cleanup_on_delete_drops_tools_audit_and_permissions ───────────────

    #[tokio::test]
    async fn cleanup_on_delete_drops_tools_audit_and_permissions() {
        let supervisor = make_supervisor();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        // Insert a server.
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "delete-srv".to_string(),
                    display_name: "Delete Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("/usr/bin/mcp-server".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: true,
                    created_at: 3000,
                    updated_at: 3000,
                },
            )
            .unwrap();

            // Insert audit + permission rows.
            crate::storage::mcp_audit::insert_entry(
                &conn,
                &crate::storage::mcp_audit::NewMcpAuditEntry {
                    server_id: "delete-srv".to_string(),
                    tool_id: "lifecycle_tool".to_string(),
                    agent_id: None,
                    called_at: 3001,
                    success: true,
                    error_summary: None,
                    args_summary: "{}".to_string(),
                },
            )
            .unwrap();

            crate::storage::mcp_permissions::set_permission(
                &conn,
                &crate::storage::mcp_permissions::McpPermissionRow {
                    server_id: "delete-srv".to_string(),
                    tool_id: "lifecycle_tool".to_string(),
                    agent_id: "agent-1".to_string(),
                    decision: crate::storage::mcp_permissions::PermissionDecision::AllowAlways,
                    set_at: 3002,
                },
            )
            .unwrap();
        }

        // Seed tools.
        seed_servers_directly(&supervisor, &registry, &store).await;

        // Delete.
        cleanup_delete_directly(&supervisor, &registry, &store, "delete-srv")
            .await
            .expect("cleanup failed");

        // Server row gone.
        {
            let conn = store.conn().unwrap();
            assert!(
                crate::storage::mcp_servers::get_server(&conn, "delete-srv")
                    .unwrap()
                    .is_none(),
                "server row should be deleted"
            );
            // Audit rows gone.
            let audit =
                crate::storage::mcp_audit::list_recent(&conn, Some("delete-srv"), 10).unwrap();
            assert_eq!(audit.len(), 0, "audit rows should be purged");
            // Permission rows gone.
            let perm = crate::storage::mcp_permissions::get_permission(
                &conn,
                "delete-srv",
                "lifecycle_tool",
                "agent-1",
            )
            .unwrap();
            assert!(perm.is_none(), "permission row should be deleted");
        }

        // Tool registry empty.
        let tools = registry.list_all();
        let mcp: Vec<_> = tools
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(mcp.len(), 0, "tool registry should be empty after delete");
    }
}
