use std::sync::{Arc, Mutex};

use crate::agents::builtin_tools::clipboard::{
    ClipboardProvider, ClipboardReadTool, ClipboardWriteTool,
};
use crate::agents::tools::{BuiltinTool, ToolSource};
use crate::error::AppError;
use serde_json::json;

// ── MockClipboard fixture ─────────────────────────────────────────────────────

struct MockClipboard {
    contents: Mutex<Option<String>>,
}

impl MockClipboard {
    fn new() -> Self {
        Self {
            contents: Mutex::new(None),
        }
    }

    fn with(initial: &str) -> Self {
        Self {
            contents: Mutex::new(Some(initial.to_string())),
        }
    }
}

impl ClipboardProvider for MockClipboard {
    fn read_text(&self) -> Result<String, AppError> {
        self.contents
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| AppError::Validation("clipboard is empty".into()))
    }

    fn write_text(&self, text: &str) -> Result<(), AppError> {
        *self.contents.lock().unwrap() = Some(text.to_string());
        Ok(())
    }
}

// ── 1. read_descriptor_has_expected_shape ────────────────────────────────────

#[test]
fn read_descriptor_has_expected_shape() {
    let tool = ClipboardReadTool::new(Arc::new(MockClipboard::new()));
    let desc = tool.descriptor();

    assert_eq!(desc.id, "clipboard-read");
    assert_eq!(desc.fully_qualified_id, "builtin:clipboard-read");
    assert_eq!(desc.source, ToolSource::Builtin);
    assert!(
        desc.parameters.is_object(),
        "parameters must be a JSON object, got {:?}",
        desc.parameters
    );
}

// ── 2. write_descriptor_has_expected_shape ───────────────────────────────────

#[test]
fn write_descriptor_has_expected_shape() {
    let tool = ClipboardWriteTool::new(Arc::new(MockClipboard::new()));
    let desc = tool.descriptor();

    assert_eq!(desc.id, "clipboard-write");
    assert_eq!(desc.fully_qualified_id, "builtin:clipboard-write");
    assert_eq!(desc.source, ToolSource::Builtin);

    let params = &desc.parameters;
    assert!(
        params["properties"]["text"].is_object(),
        "parameters.properties.text must be present, got {params}"
    );

    let required = params["required"].as_array().expect("required must be array");
    assert!(
        required.iter().any(|v| v.as_str() == Some("text")),
        "required must include 'text', got {required:?}"
    );
}

// ── 3. read_returns_clipboard_text ───────────────────────────────────────────

#[tokio::test]
async fn read_returns_clipboard_text() {
    let mock = Arc::new(MockClipboard::with("hello world"));
    let tool = ClipboardReadTool::new(mock);

    let result = tool.invoke(json!({})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    assert_eq!(
        result.unwrap(),
        json!({"text": "hello world"}),
        "must return {{\"text\": \"hello world\"}}"
    );
}

// ── 4. read_returns_error_when_empty ─────────────────────────────────────────

#[tokio::test]
async fn read_returns_error_when_empty() {
    let mock = Arc::new(MockClipboard::new());
    let tool = ClipboardReadTool::new(mock);

    let result = tool.invoke(json!({})).await;

    assert!(result.is_err(), "expected Err for empty clipboard, got Ok");
}

// ── 5. write_sets_clipboard_text ─────────────────────────────────────────────

#[tokio::test]
async fn write_sets_clipboard_text() {
    let mock = Arc::new(MockClipboard::new());
    let read_back = Arc::clone(&mock);
    let tool = ClipboardWriteTool::new(mock);

    let result = tool.invoke(json!({"text": "abc"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    assert_eq!(result.unwrap(), json!({"ok": true}));

    let stored = read_back.read_text().expect("mock must contain 'abc'");
    assert_eq!(stored, "abc", "clipboard must contain 'abc' after write");
}

// ── 6. write_returns_error_for_missing_text ──────────────────────────────────

#[tokio::test]
async fn write_returns_error_for_missing_text() {
    let tool = ClipboardWriteTool::new(Arc::new(MockClipboard::new()));

    let result = tool.invoke(json!({})).await;

    assert!(
        result.is_err(),
        "missing 'text' argument must return Err, got Ok"
    );
}

// ── 7. write_returns_error_for_non_string_text ───────────────────────────────

#[tokio::test]
async fn write_returns_error_for_non_string_text() {
    let tool = ClipboardWriteTool::new(Arc::new(MockClipboard::new()));

    let result = tool.invoke(json!({"text": 42})).await;

    assert!(
        result.is_err(),
        "non-string 'text' argument must return Err, got Ok"
    );
}

// ── 8. write_accepts_empty_string ────────────────────────────────────────────

#[tokio::test]
async fn write_accepts_empty_string() {
    let mock = Arc::new(MockClipboard::new());
    let read_back = Arc::clone(&mock);
    let tool = ClipboardWriteTool::new(mock);

    let result = tool.invoke(json!({"text": ""})).await;

    assert!(
        result.is_ok(),
        "empty string must be a valid clipboard write, got {result:?}"
    );
    assert_eq!(result.unwrap(), json!({"ok": true}));

    let stored = read_back.read_text().expect("mock must contain empty string");
    assert_eq!(stored, "", "clipboard must contain empty string after write");
}
