pub mod client;
pub mod install;
pub mod lifecycle;
pub mod sidecar;
pub mod supervisor;
pub mod tool_adapter;
pub mod transport;
pub mod types;

pub use client::McpClient;
pub use install::{
    DetectedConfig, InstallOutcome, McpServerInstallInput, McpServerSummary, McpTestResult,
};
pub use supervisor::{McpSupervisor, SupervisorConfig};
pub use transport::{
    HttpTransportFactory, MultiTransportFactory, RuntimeResolver, StdioTransportFactory, Transport,
    TransportFactory,
};
pub use types::{
    McpCallResult, McpClientError, McpServerConfig, McpServerId, McpServerStatus,
    McpToolDescriptor, McpTransportSpec,
};
