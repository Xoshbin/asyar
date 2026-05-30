use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use serde_json::json;

pub struct FsReadTool;

impl FsReadTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FsReadTool {
    fn default() -> Self {
        Self::new()
    }
}

pub struct FsWriteTool;

impl FsWriteTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FsWriteTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl BuiltinTool for FsReadTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "fs-read".into(),
            name: "Read File".into(),
            description: "Read the contents of a UTF-8 text file at the given path.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to the file." }
                },
                "required": ["path"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:fs-read".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::Validation("missing required 'path' string argument".into())
        })?;
        let content = std::fs::read_to_string(path)
            .map_err(|e| AppError::Other(format!("failed to read '{}': {}", path, e)))?;
        Ok(json!({ "content": content }))
    }
}

#[async_trait::async_trait]
impl BuiltinTool for FsWriteTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "fs-write".into(),
            name: "Write File".into(),
            description: "Write UTF-8 text to a file at the given path. Overwrites existing files."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to the file." },
                    "content": { "type": "string", "description": "Text content to write." }
                },
                "required": ["path", "content"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:fs-write".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::Validation("missing required 'path' string argument".into())
        })?;
        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AppError::Validation("missing required 'content' string argument".into())
            })?;
        let bytes = content.len();
        std::fs::write(path, content)
            .map_err(|e| AppError::Other(format!("failed to write '{}': {}", path, e)))?;
        Ok(json!({ "ok": true, "bytesWritten": bytes }))
    }
}
