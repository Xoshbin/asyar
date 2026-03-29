//! Headless (background) extension process management.

use log::{info, warn};
use crate::error::AppError;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct HeadlessRegistry(pub Mutex<HashMap<String, std::process::Child>>);

pub fn spawn(id: &str, path: &str, registry: &HeadlessRegistry) -> Result<bool, AppError> {
    let mut reg = registry.0.lock().map_err(|_| AppError::Lock)?;

    // Terminate existing if already running
    if let Some(mut child) = reg.remove(id) {
        let _ = child.kill();
        let _ = child.wait();
    }

    info!("Spawning headless extension {} from {}", id, path);

    // Assuming it's a Node.js background worker for now
    let child = std::process::Command::new("node")
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
