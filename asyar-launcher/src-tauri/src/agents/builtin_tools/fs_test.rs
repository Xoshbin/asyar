use crate::agents::builtin_tools::fs::{FsReadTool, FsWriteTool};
use crate::agents::tools::{BuiltinTool, ToolSource};
use serde_json::json;

// ── 1. read_descriptor_has_expected_shape ────────────────────────────────────

#[test]
fn read_descriptor_has_expected_shape() {
    let tool = FsReadTool::new();
    let desc = tool.descriptor();

    assert_eq!(desc.id, "fs-read");
    assert_eq!(desc.fully_qualified_id, "builtin:fs-read");
    assert_eq!(desc.source, ToolSource::Builtin);

    let params = &desc.parameters;
    assert!(
        params["properties"]["path"].is_object(),
        "parameters.properties.path must be present, got {params}"
    );

    let required = params["required"]
        .as_array()
        .expect("required must be array");
    assert!(
        required.iter().any(|v| v.as_str() == Some("path")),
        "required must include 'path', got {required:?}"
    );
}

// ── 2. write_descriptor_has_expected_shape ───────────────────────────────────

#[test]
fn write_descriptor_has_expected_shape() {
    let tool = FsWriteTool::new();
    let desc = tool.descriptor();

    assert_eq!(desc.id, "fs-write");
    assert_eq!(desc.fully_qualified_id, "builtin:fs-write");
    assert_eq!(desc.source, ToolSource::Builtin);

    let params = &desc.parameters;
    assert!(
        params["properties"]["path"].is_object(),
        "parameters.properties.path must be present, got {params}"
    );
    assert!(
        params["properties"]["content"].is_object(),
        "parameters.properties.content must be present, got {params}"
    );

    let required = params["required"]
        .as_array()
        .expect("required must be array");
    assert!(
        required.iter().any(|v| v.as_str() == Some("path")),
        "required must include 'path', got {required:?}"
    );
    assert!(
        required.iter().any(|v| v.as_str() == Some("content")),
        "required must include 'content', got {required:?}"
    );
}

// ── 3. read_returns_file_content ─────────────────────────────────────────────

#[tokio::test]
async fn read_returns_file_content() {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let path = dir.path().join("hello.txt");
    std::fs::write(&path, "hello world\n").expect("failed to write temp file");

    let tool = FsReadTool::new();
    let result = tool.invoke(json!({ "path": path.to_str().unwrap() })).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    assert_eq!(result.unwrap(), json!({"content": "hello world\n"}));
}

// ── 4. read_returns_error_when_file_missing ──────────────────────────────────

#[tokio::test]
async fn read_returns_error_when_file_missing() {
    let tool = FsReadTool::new();
    let result = tool
        .invoke(json!({ "path": "/nonexistent/path/blah_asyar_test_404.txt" }))
        .await;

    assert!(result.is_err(), "expected Err for missing file, got Ok");
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("blah_asyar_test_404")
            || err_str.contains("not found")
            || err_str.contains("No such file"),
        "error message should mention the path or 'not found', got: {err_str}"
    );
}

// ── 5. read_returns_error_for_missing_path ───────────────────────────────────

#[tokio::test]
async fn read_returns_error_for_missing_path() {
    let tool = FsReadTool::new();
    let result = tool.invoke(json!({})).await;

    assert!(
        result.is_err(),
        "missing 'path' argument must return Err, got Ok"
    );
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("path") || err_str.to_lowercase().contains("validation"),
        "error must mention 'path' or be a Validation error, got: {err_str}"
    );
}

// ── 6. read_returns_error_for_non_string_path ────────────────────────────────

#[tokio::test]
async fn read_returns_error_for_non_string_path() {
    let tool = FsReadTool::new();
    let result = tool.invoke(json!({ "path": 42 })).await;

    assert!(result.is_err(), "non-string 'path' must return Err, got Ok");
}

// ── 7. write_creates_file_with_content ───────────────────────────────────────

#[tokio::test]
async fn write_creates_file_with_content() {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let path = dir.path().join("out.txt");

    let tool = FsWriteTool::new();
    let result = tool
        .invoke(json!({ "path": path.to_str().unwrap(), "content": "abc" }))
        .await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    assert_eq!(result.unwrap(), json!({"ok": true, "bytesWritten": 3}));

    let on_disk = std::fs::read_to_string(&path).expect("file must exist after write");
    assert_eq!(on_disk, "abc", "file content must be 'abc'");
}

// ── 8. write_overwrites_existing_file ────────────────────────────────────────

#[tokio::test]
async fn write_overwrites_existing_file() {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let path = dir.path().join("overwrite.txt");
    std::fs::write(&path, "old content").expect("failed to write initial file");

    let tool = FsWriteTool::new();
    let result = tool
        .invoke(json!({ "path": path.to_str().unwrap(), "content": "new" }))
        .await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");

    let on_disk = std::fs::read_to_string(&path).expect("file must exist after overwrite");
    assert_eq!(
        on_disk, "new",
        "file must contain only 'new' after overwrite"
    );
}

// ── 9. write_returns_error_for_missing_path ──────────────────────────────────

#[tokio::test]
async fn write_returns_error_for_missing_path() {
    let tool = FsWriteTool::new();
    let result = tool.invoke(json!({ "content": "x" })).await;

    assert!(
        result.is_err(),
        "missing 'path' argument must return Err, got Ok"
    );
}

// ── 10. write_returns_error_for_missing_content ──────────────────────────────

#[tokio::test]
async fn write_returns_error_for_missing_content() {
    let tool = FsWriteTool::new();
    let result = tool.invoke(json!({ "path": "/tmp/x" })).await;

    assert!(
        result.is_err(),
        "missing 'content' argument must return Err, got Ok"
    );
}

// ── 11. write_returns_error_for_non_string_args ──────────────────────────────

#[tokio::test]
async fn write_returns_error_for_non_string_args() {
    let tool = FsWriteTool::new();
    let result = tool.invoke(json!({ "path": 42, "content": 7 })).await;

    assert!(
        result.is_err(),
        "non-string 'path' and 'content' must return Err, got Ok"
    );
}

// ── 12. read_handles_empty_file ──────────────────────────────────────────────

#[tokio::test]
async fn read_handles_empty_file() {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let path = dir.path().join("empty.txt");
    std::fs::write(&path, "").expect("failed to create empty temp file");

    let tool = FsReadTool::new();
    let result = tool.invoke(json!({ "path": path.to_str().unwrap() })).await;

    assert!(result.is_ok(), "expected Ok for empty file, got {result:?}");
    assert_eq!(result.unwrap(), json!({"content": ""}));
}
