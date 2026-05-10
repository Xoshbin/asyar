use crate::mcp::client::McpClient;
use crate::mcp::transport::TransportFactory;
use crate::mcp::types::{
    McpCallResult, McpClientError, McpServerConfig, McpServerId, McpServerStatus,
    McpToolDescriptor, McpTransportSpec,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Notify};

#[derive(Debug, Clone)]
pub struct SupervisorConfig {
    pub crash_window: Duration,
    pub max_crashes_in_window: u32,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
}

impl Default for SupervisorConfig {
    fn default() -> Self {
        Self {
            crash_window: Duration::from_secs(60),
            max_crashes_in_window: 3,
            initial_backoff: Duration::from_millis(500),
            max_backoff: Duration::from_secs(30),
        }
    }
}

struct ServerHandle {
    status: McpServerStatus,
    tools: Vec<McpToolDescriptor>,
    client: Option<Arc<Mutex<McpClient>>>,
    cancel: Arc<Notify>,
    /// Fired by `call_tool` when it detects a transport error mid-session so
    /// that `monitor_client` wakes up immediately and the watchdog restarts.
    client_died: Arc<Notify>,
    _watchdog: tokio::task::JoinHandle<()>,
}

struct Inner {
    servers: HashMap<McpServerId, ServerHandle>,
}

pub struct McpSupervisor {
    factory: Arc<dyn TransportFactory>,
    cfg: SupervisorConfig,
    inner: Arc<std::sync::Mutex<Inner>>,
}

impl McpSupervisor {
    pub fn new(factory: Arc<dyn TransportFactory>, cfg: SupervisorConfig) -> Self {
        Self {
            factory,
            cfg,
            inner: Arc::new(std::sync::Mutex::new(Inner {
                servers: HashMap::new(),
            })),
        }
    }

    pub async fn enable(&self, config: McpServerConfig) -> Result<(), McpClientError> {
        // Idempotency: cancel and drop any previous watchdog for this id.
        self.disable(&config.id).await?;

        let id = config.id.clone();
        let cancel = Arc::new(Notify::new());
        let client_died = Arc::new(Notify::new());
        let cancel_clone = cancel.clone();
        let client_died_clone = client_died.clone();
        let inner = self.inner.clone();
        let factory = self.factory.clone();
        let cfg = self.cfg.clone();
        let spec = config.transport.clone();

        let watchdog = tokio::spawn(async move {
            run_watchdog(
                id.clone(),
                factory,
                spec,
                cfg,
                cancel_clone,
                client_died_clone,
                inner,
            )
            .await;
        });

        let handle = ServerHandle {
            status: McpServerStatus::Starting,
            tools: vec![],
            client: None,
            cancel,
            client_died,
            _watchdog: watchdog,
        };

        self.inner
            .lock()
            .unwrap()
            .servers
            .insert(config.id.clone(), handle);

        Ok(())
    }

    pub async fn disable(&self, id: &McpServerId) -> Result<(), McpClientError> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(handle) = guard.servers.get_mut(id) {
            handle.cancel.notify_one();
            handle.status = McpServerStatus::Disabled;
            handle.client = None;
        }
        Ok(())
    }

    pub async fn status(&self, id: &McpServerId) -> Option<McpServerStatus> {
        self.inner.lock().unwrap().servers.get(id).map(|h| h.status)
    }

    pub async fn list_tools(
        &self,
        id: &McpServerId,
    ) -> Result<Vec<McpToolDescriptor>, McpClientError> {
        let tools = self
            .inner
            .lock()
            .unwrap()
            .servers
            .get(id)
            .map(|h| h.tools.clone());
        tools.ok_or_else(|| McpClientError::Transport(format!("unknown server: {id}")))
    }

    pub async fn call_tool(
        &self,
        id: &McpServerId,
        name: &str,
        args: serde_json::Value,
    ) -> Result<McpCallResult, McpClientError> {
        let (client, client_died) = {
            let guard = self.inner.lock().unwrap();
            let handle = guard.servers.get(id);
            (
                handle.and_then(|h| h.client.clone()),
                handle.map(|h| h.client_died.clone()),
            )
        };
        match client {
            None => {
                // No live client — signal the watchdog to restart immediately.
                if let Some(died) = client_died {
                    died.notify_one();
                }
                Err(McpClientError::Transport(format!(
                    "server {id} not connected"
                )))
            }
            Some(arc_client) => {
                let result = {
                    let mut guard = arc_client.lock().await;
                    guard.call_tool(name, args).await
                };
                if let Err(ref e) = result {
                    let is_transport_err = matches!(
                        e,
                        McpClientError::Io(_)
                            | McpClientError::EarlyExit
                            | McpClientError::Transport(_)
                    );
                    if is_transport_err {
                        if let Some(died) = client_died {
                            died.notify_one();
                        }
                    }
                }
                result
            }
        }
    }

    /// Returns a clone of the underlying transport factory so callers (e.g.
    /// `install::test_server`) can probe a server without starting a watchdog.
    pub fn factory(&self) -> Arc<dyn TransportFactory> {
        Arc::clone(&self.factory)
    }

    /// Connect once, run the MCP handshake, list tools, and close the
    /// connection. Does NOT start a watchdog or register anything.
    pub async fn connect_and_list_tools(
        factory: Arc<dyn TransportFactory>,
        spec: &McpTransportSpec,
    ) -> Result<Vec<McpToolDescriptor>, McpClientError> {
        let transport = factory.connect(spec).await?;
        let mut client = McpClient::new(transport);
        client.initialize().await?;
        client.list_tools().await
    }
}

async fn run_watchdog(
    id: McpServerId,
    factory: Arc<dyn TransportFactory>,
    spec: McpTransportSpec,
    cfg: SupervisorConfig,
    cancel: Arc<Notify>,
    client_died: Arc<Notify>,
    inner: Arc<std::sync::Mutex<Inner>>,
) {
    let mut crash_times: std::collections::VecDeque<tokio::time::Instant> =
        std::collections::VecDeque::new();
    let mut attempt: u32 = 0;

    loop {
        set_status(&inner, &id, McpServerStatus::Starting);

        let result = tokio::select! {
            _ = cancel.notified() => {
                set_status(&inner, &id, McpServerStatus::Disabled);
                return;
            }
            r = attempt_connect(&factory, &spec, &inner, &id) => r,
        };

        match result {
            Ok(arc_client) => {
                // Connected — keep running until cancelled, the client drops,
                // or call_tool signals a transport error via `client_died`.
                let client_clone = arc_client.clone();
                tokio::select! {
                    _ = cancel.notified() => {
                        clear_client(&inner, &id);
                        set_status(&inner, &id, McpServerStatus::Disabled);
                        return;
                    }
                    _ = monitor_client(client_clone, client_died.clone()) => {
                        // Connection dropped or transport error — will retry below
                        clear_client(&inner, &id);
                    }
                }
            }
            Err(_) => {
                // Connection or initialize failed — count as crash below
            }
        }

        // Record crash time and prune stale entries
        let now = tokio::time::Instant::now();
        crash_times.push_back(now);
        let window = cfg.crash_window;
        crash_times.retain(|t| now.duration_since(*t) < window);

        if crash_times.len() >= cfg.max_crashes_in_window as usize {
            set_status(&inner, &id, McpServerStatus::Failed);
            break;
        }

        // Exponential backoff before next attempt
        let exp = attempt.min(10);
        let backoff = std::cmp::min(
            cfg.initial_backoff * 2u32.pow(exp),
            cfg.max_backoff,
        );
        attempt += 1;

        tokio::select! {
            _ = cancel.notified() => {
                set_status(&inner, &id, McpServerStatus::Disabled);
                return;
            }
            _ = tokio::time::sleep(backoff) => {}
        }
    }
}

async fn attempt_connect(
    factory: &Arc<dyn TransportFactory>,
    spec: &McpTransportSpec,
    inner: &Arc<std::sync::Mutex<Inner>>,
    id: &McpServerId,
) -> Result<Arc<Mutex<McpClient>>, McpClientError> {
    let transport = factory.connect(spec).await?;
    let mut client = McpClient::new(transport);
    client.initialize().await?;
    let tools = client.list_tools().await?;
    let arc_client = Arc::new(Mutex::new(client));

    {
        let mut guard = inner.lock().unwrap();
        if let Some(handle) = guard.servers.get_mut(id) {
            handle.tools = tools;
            handle.client = Some(arc_client.clone());
            handle.status = McpServerStatus::Connected;
        }
    }

    Ok(arc_client)
}

async fn monitor_client(client: Arc<Mutex<McpClient>>, client_died: Arc<Notify>) {
    loop {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(60)) => {
                if Arc::strong_count(&client) == 1 {
                    break;
                }
            }
            _ = client_died.notified() => {
                // A call_tool detected a transport error — return immediately
                // so the watchdog can start the next attempt.
                log::warn!("MCP monitor_client: transport error signalled, restarting");
                break;
            }
        }
    }
}

fn set_status(inner: &Arc<std::sync::Mutex<Inner>>, id: &McpServerId, status: McpServerStatus) {
    let mut guard = inner.lock().unwrap();
    if let Some(handle) = guard.servers.get_mut(id) {
        handle.status = status;
    }
}

fn clear_client(inner: &Arc<std::sync::Mutex<Inner>>, id: &McpServerId) {
    let mut guard = inner.lock().unwrap();
    if let Some(handle) = guard.servers.get_mut(id) {
        handle.client = None;
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::transport::{duplex_pair, Transport, TransportFactory};
    use crate::mcp::types::{McpClientError, McpServerConfig, McpTransportSpec};
    use async_trait::async_trait;
    use std::collections::BTreeMap;
    use std::sync::{Arc, Mutex};

    // ── Mock transport factory ────────────────────────────────────────────────

    enum MockConnectBehavior {
        /// Factory succeeds: auto-complete initialize + list_tools then stay open
        Succeed,
        /// Factory connection fails immediately
        Fail,
        /// Server stream closes immediately after receiving initialize (crash)
        ImmediateCrash,
    }

    struct MockTransportFactory {
        behaviors: Mutex<Vec<MockConnectBehavior>>,
        connect_count: Mutex<u32>,
    }

    impl MockTransportFactory {
        fn new(behaviors: Vec<MockConnectBehavior>) -> Self {
            Self {
                behaviors: Mutex::new(behaviors),
                connect_count: Mutex::new(0),
            }
        }

        fn call_count(&self) -> u32 {
            *self.connect_count.lock().unwrap()
        }
    }

    #[async_trait]
    impl TransportFactory for MockTransportFactory {
        async fn connect(
            &self,
            _spec: &McpTransportSpec,
        ) -> Result<Box<dyn Transport>, McpClientError> {
            let mut count = self.connect_count.lock().unwrap();
            let idx = *count as usize;
            *count += 1;
            drop(count);

            let behaviors = self.behaviors.lock().unwrap();
            let behavior = behaviors.get(idx).unwrap_or(&MockConnectBehavior::Fail);

            match behavior {
                MockConnectBehavior::Fail => Err(McpClientError::Transport(
                    "mock: connection refused".to_string(),
                )),
                MockConnectBehavior::Succeed | MockConnectBehavior::ImmediateCrash => {
                    let (transport, mut server) = duplex_pair();
                    let is_crash = matches!(behavior, MockConnectBehavior::ImmediateCrash);
                    tokio::spawn(async move {
                        // Handle initialize
                        let req = server.recv_line().await;
                        if req.is_none() {
                            return;
                        }
                        if is_crash {
                            // Drop server — closes stream, simulating crash
                            drop(server);
                            return;
                        }
                        server
                            .send_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"mock","version":"0"}}}"#)
                            .await;
                        let _ = server.recv_line().await; // notifications/initialized

                        // Handle list_tools
                        let _list = server.recv_line().await;
                        server
                            .send_line(r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"mock_tool","description":"a tool","inputSchema":{"type":"object"}}]}}"#)
                            .await;

                        // Keep server alive until dropped
                        loop {
                            if server.recv_line().await.is_none() {
                                break;
                            }
                        }
                    });
                    Ok(transport)
                }
            }
        }
    }

    fn make_config(id: &str) -> McpServerConfig {
        McpServerConfig {
            id: id.to_string(),
            display_name: format!("Server {id}"),
            transport: McpTransportSpec::Stdio {
                command: "/usr/bin/mcp-server".to_string(),
                args: vec![],
                env: BTreeMap::new(),
                cwd: None,
            },
            enabled: true,
        }
    }

    // Helper: poll status until it matches or timeout
    async fn wait_for_status(
        supervisor: &McpSupervisor,
        id: &str,
        expected: McpServerStatus,
        timeout_ms: u64,
    ) -> Option<McpServerStatus> {
        let deadline = tokio::time::Instant::now()
            + tokio::time::Duration::from_millis(timeout_ms);
        loop {
            let s = supervisor.status(&id.to_string()).await;
            if s == Some(expected) {
                return s;
            }
            if tokio::time::Instant::now() >= deadline {
                return supervisor.status(&id.to_string()).await;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        }
    }

    // 1. enable_starts_server_and_reports_connected_status_after_initialize
    #[tokio::test]
    async fn enable_starts_server_and_reports_connected_status_after_initialize() {
        let factory = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::Succeed,
        ]));
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let config = make_config("srv1");

        supervisor.enable(config).await.expect("enable");

        let status = wait_for_status(&supervisor, "srv1", McpServerStatus::Connected, 2000).await;
        assert_eq!(
            status,
            Some(McpServerStatus::Connected),
            "expected Connected after successful initialize"
        );
    }

    // 2. enable_with_failing_factory_reports_failed_status
    #[tokio::test]
    async fn enable_with_failing_factory_reports_failed_status() {
        // Three failures = max_crashes_in_window → Failed
        let factory = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::Fail,
            MockConnectBehavior::Fail,
            MockConnectBehavior::Fail,
        ]));
        let cfg = SupervisorConfig {
            max_crashes_in_window: 3,
            initial_backoff: Duration::from_millis(10),
            max_backoff: Duration::from_millis(50),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let config = make_config("srv2");

        supervisor.enable(config).await.expect("enable");

        let status = wait_for_status(&supervisor, "srv2", McpServerStatus::Failed, 3000).await;
        assert_eq!(
            status,
            Some(McpServerStatus::Failed),
            "expected Failed after 3 factory failures"
        );
    }

    // 3. disable_marks_status_disabled_and_does_not_restart
    #[tokio::test]
    async fn disable_marks_status_disabled_and_does_not_restart() {
        let factory = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::Succeed,
        ]));
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory.clone(), cfg);
        let config = make_config("srv3");

        supervisor.enable(config).await.expect("enable");
        let _ = wait_for_status(&supervisor, "srv3", McpServerStatus::Connected, 2000).await;

        supervisor.disable(&"srv3".to_string()).await.expect("disable");

        let status = supervisor.status(&"srv3".to_string()).await;
        assert_eq!(status, Some(McpServerStatus::Disabled), "expected Disabled");

        let connect_count_before = factory.call_count();
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        let connect_count_after = factory.call_count();
        assert_eq!(
            connect_count_before, connect_count_after,
            "factory must not be called again after disable"
        );
    }

    // 4. crashed_server_is_restarted_within_backoff_budget
    #[tokio::test]
    async fn crashed_server_is_restarted_within_backoff_budget() {
        let factory = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::ImmediateCrash,
            MockConnectBehavior::Succeed,
        ]));
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(20),
            max_backoff: Duration::from_millis(100),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let config = make_config("srv4");

        supervisor.enable(config).await.expect("enable");

        let status = wait_for_status(&supervisor, "srv4", McpServerStatus::Connected, 3000).await;
        assert_eq!(
            status,
            Some(McpServerStatus::Connected),
            "expected Connected after restart from crash"
        );
    }

    // 5. three_crashes_within_window_marks_server_failed_and_stops_restarting
    #[tokio::test]
    async fn three_crashes_within_window_marks_server_failed_and_stops_restarting() {
        let factory = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::ImmediateCrash,
            MockConnectBehavior::ImmediateCrash,
            MockConnectBehavior::ImmediateCrash,
        ]));
        let cfg = SupervisorConfig {
            crash_window: Duration::from_secs(60),
            max_crashes_in_window: 3,
            initial_backoff: Duration::from_millis(10),
            max_backoff: Duration::from_millis(100),
        };
        let supervisor = McpSupervisor::new(factory.clone(), cfg);
        let config = make_config("srv5");

        supervisor.enable(config).await.expect("enable");

        let status = wait_for_status(&supervisor, "srv5", McpServerStatus::Failed, 3000).await;
        assert_eq!(
            status,
            Some(McpServerStatus::Failed),
            "expected Failed after 3 crashes within window"
        );

        let count_at_failure = factory.call_count();
        assert!(
            count_at_failure <= 3,
            "factory must be called at most 3 times, got {count_at_failure}"
        );

        // Short wait — assert no further restarts
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        let count_after = factory.call_count();
        assert_eq!(
            count_at_failure, count_after,
            "supervisor must not restart after Failed status"
        );
    }

    // 6. crash_outside_window_does_not_count_toward_failure_budget
    // Uses a short crash_window so real time works
    #[tokio::test]
    async fn crash_outside_window_does_not_count_toward_failure_budget() {
        // Crash 1, then succeed, then crash 2 (outside window) — still restarts
        let factory = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::ImmediateCrash,
            MockConnectBehavior::Succeed,
            MockConnectBehavior::ImmediateCrash,
            MockConnectBehavior::Succeed,
        ]));
        let cfg = SupervisorConfig {
            crash_window: Duration::from_millis(100), // short window for real-time test
            max_crashes_in_window: 3,
            initial_backoff: Duration::from_millis(10),
            max_backoff: Duration::from_millis(50),
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let config = make_config("srv6");

        supervisor.enable(config).await.expect("enable");

        // First crash + restart
        let _ = wait_for_status(&supervisor, "srv6", McpServerStatus::Connected, 2000).await;

        // Wait past crash_window to reset the counter
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        // Second crash outside the window should not push over threshold
        // The supervisor should restart and eventually reach Connected again
        let status = wait_for_status(&supervisor, "srv6", McpServerStatus::Connected, 3000).await;
        assert_ne!(
            status,
            Some(McpServerStatus::Failed),
            "crash outside window must not cause Failed status"
        );
    }

    // 8. enable_twice_for_same_id_disables_first_then_starts_second
    #[tokio::test]
    async fn enable_twice_for_same_id_disables_first_then_starts_second() {
        let factory = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::Succeed,
            MockConnectBehavior::Succeed,
        ]));
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory.clone(), cfg);
        let config = make_config("srv8");

        // First enable — wait for it to connect
        supervisor.enable(config.clone()).await.expect("enable 1");
        let _ = wait_for_status(&supervisor, "srv8", McpServerStatus::Connected, 2000).await;

        // Second enable for same id — must disable first, then start second
        supervisor.enable(config.clone()).await.expect("enable 2");
        let status = wait_for_status(&supervisor, "srv8", McpServerStatus::Connected, 2000).await;
        assert_eq!(
            status,
            Some(McpServerStatus::Connected),
            "second enable must eventually reach Connected"
        );

        // Factory must have been called exactly twice (once per enable)
        let count = factory.call_count();
        assert_eq!(count, 2, "factory must be called twice, got {count}");
    }

    // 9. call_tool_transport_error_triggers_watchdog_restart
    #[tokio::test]
    async fn call_tool_transport_error_triggers_watchdog_restart() {
        // Script: first connect succeeds normally; then a second connect (after
        // the error-triggered restart) also succeeds.
        let factory = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::Succeed,
            MockConnectBehavior::Succeed,
        ]));
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            max_backoff: Duration::from_millis(50),
            ..SupervisorConfig::default()
        };
        let supervisor = Arc::new(McpSupervisor::new(factory.clone(), cfg));
        let config = make_config("srv9");

        supervisor.enable(config).await.expect("enable");

        // Wait until Connected (first connect)
        let _ = wait_for_status(&supervisor, "srv9", McpServerStatus::Connected, 2000).await;
        assert_eq!(
            supervisor.status(&"srv9".to_string()).await,
            Some(McpServerStatus::Connected),
            "must reach Connected before poisoning"
        );
        // Factory must have been called exactly once at this point.
        assert_eq!(factory.call_count(), 1, "exactly one connect before poisoning");

        // Poison the client so the next call_tool returns a Transport error.
        // We replace the client with None so call_tool gets "not connected",
        // which triggers client_died and causes the watchdog to restart.
        {
            let mut guard = supervisor.inner.lock().unwrap();
            if let Some(handle) = guard.servers.get_mut("srv9") {
                handle.client = None;
            }
        }

        let result = supervisor
            .call_tool(&"srv9".to_string(), "any_tool", serde_json::json!({}))
            .await;
        assert!(result.is_err(), "expected error from poisoned call_tool");

        // The client_died notification was fired. The watchdog will:
        //   1. Break from monitor_client
        //   2. Record a crash (1 of 3 budget)
        //   3. Sleep the initial_backoff (10ms)
        //   4. Call attempt_connect again (factory call #2)
        //   5. Set status to Connected
        //
        // We wait for the factory to be called a second time, which proves the
        // watchdog restarted. The transition through Starting may be too fast
        // to observe reliably, so we poll factory.call_count() directly.
        let second_connect_happened = {
            let deadline =
                tokio::time::Instant::now() + tokio::time::Duration::from_millis(3000);
            loop {
                if factory.call_count() >= 2 {
                    break true;
                }
                if tokio::time::Instant::now() >= deadline {
                    break false;
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
            }
        };
        assert!(
            second_connect_happened,
            "watchdog must call factory.connect a second time after client_died; count={}",
            factory.call_count()
        );

        // After the second connect, the watchdog reaches Connected again.
        let status = wait_for_status(&supervisor, "srv9", McpServerStatus::Connected, 2000).await;
        assert_eq!(
            status,
            Some(McpServerStatus::Connected),
            "watchdog must reach Connected again after restart; final status: {status:?}"
        );
    }

    // 7. connect_and_list_tools_static_helper_returns_tools_without_supervising
    #[tokio::test]
    async fn connect_and_list_tools_static_helper_returns_tools_without_supervising() {
        let factory: Arc<dyn TransportFactory> = Arc::new(MockTransportFactory::new(vec![
            MockConnectBehavior::Succeed,
        ]));
        let spec = McpTransportSpec::Stdio {
            command: "/usr/bin/mcp-server".to_string(),
            args: vec![],
            env: BTreeMap::new(),
            cwd: None,
        };

        let tools = McpSupervisor::connect_and_list_tools(factory, &spec)
            .await
            .expect("connect_and_list_tools");

        assert_eq!(tools.len(), 1, "expected 1 tool from mock server");
        assert_eq!(tools[0].name, "mock_tool");
        // Calling this static method does NOT require a supervisor instance
        // (the type-level call above proves no McpSupervisor was constructed)
    }
}
