use crate::error::AppError;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub struct ShellProcessRegistry(pub Arc<Mutex<HashMap<String, u32>>>);

impl ShellProcessRegistry {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

impl Default for ShellProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellChunkPayload {
    pub spawn_id: String,
    pub stream: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellDonePayload {
    pub spawn_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellErrorPayload {
    pub spawn_id: String,
    pub message: String,
}

pub fn spawn(
    app: AppHandle,
    shell_registry: &ShellProcessRegistry,
    spawn_id: String,
    program: String,
    args: Vec<String>,
) -> Result<(), AppError> {
    let mut child_process = std::process::Command::new(&program);
    child_process.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    
    // Use tokio::process::Command to get async pipes and waitability
    let mut child = Command::from(child_process).spawn()?;

    let pid = child.id().ok_or_else(|| AppError::Other("Failed to capture process ID".to_string()))?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::Other("Failed to capture stdout".to_string()))?;
    let stderr = child.stderr.take().ok_or_else(|| AppError::Other("Failed to capture stderr".to_string()))?;

    {
        let mut registry = shell_registry.0.lock().map_err(|_| AppError::Lock)?;
        registry.insert(spawn_id.clone(), pid);
    }

    let app_clone = app.clone();
    let spawn_id_clone = spawn_id.clone();
    let registry_clone = shell_registry.0.clone();

    tokio::spawn(async move {
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let app_c1 = app_clone.clone();
        let sid_c1 = spawn_id_clone.clone();
        let stdout_task = async move {
            while let Ok(Some(data)) = stdout_reader.next_line().await {
                let _ = app_c1.emit("asyar:shell:chunk", ShellChunkPayload {
                    spawn_id: sid_c1.clone(),
                    stream: "stdout".to_string(),
                    data,
                });
            }
        };

        let app_c2 = app_clone.clone();
        let sid_c2 = spawn_id_clone.clone();
        let stderr_task = async move {
            while let Ok(Some(data)) = stderr_reader.next_line().await {
                let _ = app_c2.emit("asyar:shell:chunk", ShellChunkPayload {
                    spawn_id: sid_c2.clone(),
                    stream: "stderr".to_string(),
                    data,
                });
            }
        };

        let wait_task = child.wait();

        let (_, _, status_result) = tokio::join!(stdout_task, stderr_task, wait_task);

        {
            if let Ok(mut reg) = registry_clone.lock() {
                reg.remove(&spawn_id_clone);
            }
        }

        match status_result {
            Ok(status) => {
                let _ = app_clone.emit("asyar:shell:done", ShellDonePayload {
                    spawn_id: spawn_id_clone,
                    exit_code: status.code(),
                });
            }
            Err(e) => {
                let _ = app_clone.emit("asyar:shell:error", ShellErrorPayload {
                    spawn_id: spawn_id_clone,
                    message: e.to_string(),
                });
            }
        }
    });

    Ok(())
}

pub fn kill(
    shell_registry: &ShellProcessRegistry,
    spawn_id: &str,
) -> Result<(), AppError> {
    let mut registry = shell_registry.0.lock().map_err(|_| AppError::Lock)?;
    if let Some(pid) = registry.remove(spawn_id) {
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        {
            use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
            use windows::Win32::Foundation::CloseHandle;
            unsafe {
                if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                    let _ = TerminateProcess(handle, 1);
                    let _ = CloseHandle(handle);
                }
            }
        }
    }
    Ok(())
}

pub async fn resolve_path(program: &str) -> Result<String, AppError> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = Command::new(cmd)
        .arg(program)
        .output()
        .await?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let first_path = path.lines().next().unwrap_or(&path).to_string();
        Ok(first_path)
    } else {
        Err(AppError::NotFound(format!("Executable \"{}\" not found.", program)))
    }
}
