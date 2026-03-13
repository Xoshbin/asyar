import re

with open('src-tauri/src/command.rs', 'r') as f:
    content = f.read()

# Add imports for Child processes
imports = """
use std::collections::HashMap;
use std::sync::Mutex;
use std::process::{Command, Child};
use std::os::unix::process::CommandExt;
"""
content = re.sub(r'(use tokio_util::compat::FuturesAsyncReadCompatExt;)', r'\1\n' + imports, content)

# Add state structure for ExtensionRegistry
state_struct = """
// Registry to keep track of running headless extensions
pub struct ExtensionRegistry(pub Mutex<HashMap<String, Child>>);

#[tauri::command]
pub fn spawn_headless_extension(
    id: String,
    path: String,
    state: tauri::State<'_, ExtensionRegistry>,
) -> Result<bool, String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;

    // Terminate existing if already running
    if let Some(mut child) = registry.remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }

    info!("Spawning headless extension {} from {}", id, path);

    // Assuming it's a Node.js background worker for now
    let child = Command::new("node")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to spawn headless process: {}", e))?;

    registry.insert(id, child);
    Ok(true)
}

#[tauri::command]
pub fn kill_extension(
    id: String,
    state: tauri::State<'_, ExtensionRegistry>,
) -> Result<bool, String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = registry.remove(&id) {
        info!("Terminating headless extension {}", id);
        child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
        child.wait().map_err(|e| format!("Failed to wait for process: {}", e))?;
        Ok(true)
    } else {
        warn!("Extension {} not found in registry", id);
        Ok(false) // Not found, but not an error
    }
}
"""

content = content + "\n" + state_struct

with open('src-tauri/src/command.rs', 'w') as f:
    f.write(content)
