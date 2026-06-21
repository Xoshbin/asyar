//! Serializable contract types for the `process` service (camelCase to TS)
//! plus the internal `RawProcess` used by the pure transforms.

use serde::{Deserialize, Serialize};

/// Internal, pre-grouping snapshot of one OS process. Not sent over IPC.
#[derive(Debug, Clone)]
pub struct RawProcess {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub exe_path: String,
    pub owner: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub path: String,
    pub owner: String,
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppGroup {
    pub app_name: String,
    pub icon: Option<String>,
    pub owner: String,
    pub total_cpu: f32,
    pub total_memory_bytes: u64,
    pub process_count: u32,
    pub protected: bool,
    pub children: Vec<ProcessInfo>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KillFailure {
    pub pid: u32,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KillResult {
    pub killed: Vec<u32>,
    pub failed: Vec<KillFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SortBy {
    Cpu,
    Memory,
    Name,
}
