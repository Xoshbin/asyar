use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use serde_json::json;
use tokio::process::Command;

pub struct ShellExecTool;

impl ShellExecTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ShellExecTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl BuiltinTool for ShellExecTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "shell-exec".into(),
            name: "Run Shell Command".into(),
            description: "Execute a command and return stdout, stderr, and exit code.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Executable to run." },
                    "args":    { "type": "array", "items": {"type": "string"}, "description": "Arguments." },
                    "cwd":     { "type": "string", "description": "Working directory (optional)." }
                },
                "required": ["command"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:shell-exec".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AppError::Validation("missing required 'command' string argument".into())
            })?;

        let parsed_args: Vec<String> = match args.get("args") {
            None | Some(serde_json::Value::Null) => Vec::new(),
            Some(serde_json::Value::Array(arr)) => {
                let mut out = Vec::with_capacity(arr.len());
                for v in arr {
                    let s = v.as_str().ok_or_else(|| {
                        AppError::Validation("all 'args' entries must be strings".into())
                    })?;
                    out.push(s.to_string());
                }
                out
            }
            _ => {
                return Err(AppError::Validation(
                    "'args' must be an array of strings".into(),
                ))
            }
        };

        let cwd: Option<String> = match args.get("cwd") {
            None | Some(serde_json::Value::Null) => None,
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            _ => return Err(AppError::Validation("'cwd' must be a string".into())),
        };

        let mut cmd = Command::new(command);
        cmd.args(&parsed_args);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        let output = cmd.output().await.map_err(|e| {
            AppError::Other(format!("failed to spawn '{}': {}", command, e))
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let exit_code: serde_json::Value = match output.status.code() {
            Some(code) => json!(code),
            None => json!(null),
        };

        Ok(json!({
            "stdout": stdout,
            "stderr": stderr,
            "exitCode": exit_code,
        }))
    }
}
