pub mod client;
pub mod install;
pub mod lifecycle;
pub mod sidecar;
pub mod supervisor;
pub mod tool_adapter;
pub mod transport;
pub mod types;

pub use client::McpClient;
pub use install::{DetectedConfig, McpServerInstallInput, McpServerSummary, McpTestResult};
pub use supervisor::{McpSupervisor, SupervisorConfig};
pub use transport::{
    HttpTransportFactory, MultiTransportFactory, SidecarPath, StdioTransportFactory, Transport,
    TransportFactory,
};

/// Managed state holding the shared sidecar path handles.
/// Constructed in `run()` from the factory, then populated in `setup_app`.
pub struct McpSidecarState {
    pub bun: SidecarPath,
    pub uv: SidecarPath,
}
pub use types::{
    McpCallResult, McpClientError, McpServerConfig, McpServerId, McpServerStatus,
    McpToolDescriptor, McpTransportSpec,
};
