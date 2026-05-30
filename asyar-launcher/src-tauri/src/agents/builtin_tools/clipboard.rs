use std::sync::Arc;

use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use serde_json::json;

pub trait ClipboardProvider: Send + Sync {
    fn read_text(&self) -> Result<String, AppError>;
    fn write_text(&self, text: &str) -> Result<(), AppError>;
}

pub struct SystemClipboard;

impl ClipboardProvider for SystemClipboard {
    fn read_text(&self) -> Result<String, AppError> {
        let mut cb = arboard::Clipboard::new()
            .map_err(|e| AppError::Other(format!("failed to access clipboard: {}", e)))?;
        cb.get_text()
            .map_err(|e| AppError::Other(format!("failed to read clipboard: {}", e)))
    }

    fn write_text(&self, text: &str) -> Result<(), AppError> {
        let mut cb = arboard::Clipboard::new()
            .map_err(|e| AppError::Other(format!("failed to access clipboard: {}", e)))?;
        cb.set_text(text.to_string())
            .map_err(|e| AppError::Other(format!("failed to write clipboard: {}", e)))
    }
}

pub struct ClipboardReadTool {
    provider: Arc<dyn ClipboardProvider>,
}

impl ClipboardReadTool {
    pub fn new(provider: Arc<dyn ClipboardProvider>) -> Self {
        Self { provider }
    }
}

pub struct ClipboardWriteTool {
    provider: Arc<dyn ClipboardProvider>,
}

impl ClipboardWriteTool {
    pub fn new(provider: Arc<dyn ClipboardProvider>) -> Self {
        Self { provider }
    }
}

#[async_trait::async_trait]
impl BuiltinTool for ClipboardReadTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "clipboard-read".to_string(),
            name: "Clipboard Read".to_string(),
            description: "Read the current text content of the system clipboard.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:clipboard-read".to_string(),
        }
    }

    async fn invoke(&self, _args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let text = self.provider.read_text()?;
        Ok(json!({"text": text}))
    }
}

#[async_trait::async_trait]
impl BuiltinTool for ClipboardWriteTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "clipboard-write".to_string(),
            name: "Clipboard Write".to_string(),
            description: "Write text to the system clipboard.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The text to write to the clipboard."
                    }
                },
                "required": ["text"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:clipboard-write".to_string(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let text = args.get("text").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::Validation("missing or invalid 'text' argument".to_string())
        })?;
        self.provider.write_text(text)?;
        Ok(json!({"ok": true}))
    }
}
