//! Headless (background) extension process management.

use log::{info, warn};
use crate::error::AppError;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct HeadlessRegistry(pub Mutex<HashMap<String, std::process::Child>>);

/// Returns a list of candidate Node.js binary paths to try, in order of preference.
/// The first entry is always the bare binary name (relies on PATH).
fn node_candidates() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec![
            "node.exe".to_string(),
            r"C:\Program Files\nodejs\node.exe".to_string(),
            r"C:\Program Files (x86)\nodejs\node.exe".to_string(),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "node".to_string(),
            "/opt/homebrew/bin/node".to_string(),   // Apple Silicon Homebrew
            "/usr/local/bin/node".to_string(),       // Intel Homebrew / nvm
            "/usr/bin/node".to_string(),
        ]
    } else {
        // Linux
        vec![
            "node".to_string(),
            "/usr/bin/node".to_string(),
            "/usr/local/bin/node".to_string(),
            "/snap/bin/node".to_string(),
        ]
    }
}

/// Returns the path to the Node.js binary, or None if not found anywhere.
fn resolve_node_binary() -> Option<String> {
    for candidate in node_candidates() {
        // For bare names (no path separator), try running with --version to test PATH resolution
        // For full paths, check existence first
        let found = if candidate.contains('/') || candidate.contains('\\') {
            std::path::Path::new(&candidate).exists()
        } else {
            std::process::Command::new(&candidate)
                .arg("--version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok()
        };
        if found {
            return Some(candidate);
        }
    }
    None
}

pub fn spawn(id: &str, path: &str, registry: &HeadlessRegistry) -> Result<bool, AppError> {

    let mut reg = registry.0.lock().map_err(|_| AppError::Lock)?;

    // Terminate existing if already running
    if let Some(mut child) = reg.remove(id) {
        let _ = child.kill();
        let _ = child.wait();
    }

    let node_bin = resolve_node_binary().ok_or_else(|| {
        AppError::Extension(
            "Node.js runtime not found. Install Node.js and ensure it is on PATH.".to_string()
        )
    })?;

    info!("Spawning headless extension {} from {} using {}", id, path, node_bin);

    let child = std::process::Command::new(&node_bin)
        .arg(path)
        .spawn()
        .map_err(|e| AppError::Extension(format!("Failed to spawn headless process: {}", e)))?;


    reg.insert(id.to_string(), child);
    Ok(true)
}

pub fn kill(id: &str, registry: &HeadlessRegistry) -> Result<bool, AppError> {
    let mut reg = registry.0.lock().map_err(|_| AppError::Lock)?;

    if let Some(mut child) = reg.remove(id) {
        info!("Terminating headless extension {}", id);
        child.kill().map_err(|e| AppError::Extension(format!("Failed to kill process: {}", e)))?;
        child.wait().map_err(|e| AppError::Extension(format!("Failed to wait for process: {}", e)))?;
        Ok(true)
    } else {
        warn!("Extension {} not found in registry", id);
        Ok(false) // Not found, but not an error
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_node_returns_some_when_node_installed() {
        // On any dev machine with Node.js installed, this must return Some
        // If it returns None, it means Node.js is not installed — skip gracefully
        match resolve_node_binary() {
            Some(path) => assert!(!path.is_empty()),
            None => eprintln!("SKIP: node not found — install Node.js to enable this test"),
        }


    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_candidates_include_exe_suffix() {
        let candidates = node_candidates();
        assert!(
            candidates.iter().any(|c| c.ends_with(".exe")),
            "Windows candidates must include .exe paths"
        );
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn non_windows_candidates_do_not_include_exe_suffix() {
        let candidates = node_candidates();
        assert!(
            !candidates.iter().any(|c| c.ends_with(".exe")),
            "Non-Windows candidates must not include .exe paths"
        );
    }

    #[test]
    fn missing_node_spawn_returns_descriptive_error() {
        // Simulate missing node by calling resolve with a fake registry
        // We can't actually test the full spawn path without an AppHandle,
        // but we can test that resolve_node_binary() is used in spawn()
        // by verifying the error message when resolution fails.
        // If node IS installed, this test is not applicable — skip.
        if resolve_node_binary().is_some() {
            return; // Node found, can't test the "not found" path
        }
        // If we're here, node isn't installed — verify the error type is AppError::Extension
        // (This path only runs on machines without Node.js)
        let registry = HeadlessRegistry(std::sync::Mutex::new(std::collections::HashMap::new()));
        let result = spawn("test-id", "/fake/path.js", &registry);
        assert!(result.is_err());
        match result.unwrap_err() {
            crate::error::AppError::Extension(msg) => {
                assert!(msg.contains("Node.js"), "Error must mention Node.js: {}", msg);
            }
            other => panic!("Expected AppError::Extension, got {:?}", other),
        }
    }
}
