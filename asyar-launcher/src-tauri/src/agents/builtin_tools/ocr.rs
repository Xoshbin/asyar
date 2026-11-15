use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use serde_json::json;

pub struct OcrImageTool;

impl OcrImageTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for OcrImageTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl BuiltinTool for OcrImageTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "ocr-image".into(),
            name: "Read Text From Image (OCR)".into(),
            description:
                "Extracts and recognizes text from a local image file using on-device OCR.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute filesystem path to the image file to read text from."
                    }
                },
                "required": ["path"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:ocr-image".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let path_str = args.get("path").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::Validation("missing required 'path' string argument".into())
        })?;
        let path = std::path::PathBuf::from(path_str);
        let text = tauri::async_runtime::spawn_blocking(move || {
            crate::ocr::extract_text_from_image_file(&path)
        })
        .await
        .map_err(|e| AppError::Platform(format!("OCR task failed: {e}")))??;

        Ok(json!({ "text": text }))
    }
}
