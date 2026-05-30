use crate::agents::builtin_tools::shell::ShellExecTool;
use crate::agents::tools::{BuiltinTool, ToolSource};
use crate::error::AppError;
use serde_json::json;

// ── 1. descriptor_has_expected_shape ─────────────────────────────────────────

#[test]
fn descriptor_has_expected_shape() {
    let tool = ShellExecTool::new();
    let desc = tool.descriptor();

    assert_eq!(desc.id, "shell-exec");
    assert_eq!(desc.fully_qualified_id, "builtin:shell-exec");
    assert_eq!(desc.source, ToolSource::Builtin);

    let params = &desc.parameters;
    assert!(
        params["properties"]["command"].is_object(),
        "parameters.properties.command must be present, got {params}"
    );

    let required = params["required"]
        .as_array()
        .expect("required must be array");
    assert!(
        required.iter().any(|v| v.as_str() == Some("command")),
        "required must include 'command', got {required:?}"
    );
}

// ── 2. invoke_runs_simple_command ─────────────────────────────────────────────

#[tokio::test]
async fn invoke_runs_simple_command() {
    let tool = ShellExecTool::new();
    let result = tool
        .invoke(json!({ "command": "echo", "args": ["hello"] }))
        .await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let stdout = val["stdout"].as_str().expect("stdout must be a string");
    assert!(
        stdout.trim() == "hello",
        "stdout must contain 'hello', got: {stdout:?}"
    );
}

// ── 3. invoke_returns_exit_code_zero_on_success ───────────────────────────────

#[tokio::test]
async fn invoke_returns_exit_code_zero_on_success() {
    let tool = ShellExecTool::new();
    let result = tool
        .invoke(json!({ "command": "echo", "args": ["hi"] }))
        .await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    assert_eq!(
        val["exitCode"],
        json!(0),
        "exitCode must be 0 for successful echo, got: {}",
        val["exitCode"]
    );
}

// ── 4. invoke_returns_non_zero_exit_code_for_failed_command ──────────────────

#[tokio::test]
async fn invoke_returns_non_zero_exit_code_for_failed_command() {
    let tool = ShellExecTool::new();
    let result = tool
        .invoke(json!({ "command": "sh", "args": ["-c", "exit 7"] }))
        .await;

    assert!(
        result.is_ok(),
        "non-zero exit must resolve Ok, not Err — got {result:?}"
    );
    let val = result.unwrap();
    assert_eq!(
        val["exitCode"],
        json!(7),
        "exitCode must be 7, got: {}",
        val["exitCode"]
    );
}

// ── 5. invoke_captures_stderr ─────────────────────────────────────────────────

#[tokio::test]
async fn invoke_captures_stderr() {
    let tool = ShellExecTool::new();
    let result = tool
        .invoke(json!({ "command": "sh", "args": ["-c", "echo err >&2"] }))
        .await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let stderr = val["stderr"].as_str().expect("stderr must be a string");
    assert!(
        stderr.contains("err"),
        "stderr must contain 'err', got: {stderr:?}"
    );
}

// ── 6. invoke_returns_error_for_missing_command ───────────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_missing_command() {
    let tool = ShellExecTool::new();
    let result = tool.invoke(json!({})).await;

    assert!(result.is_err(), "missing 'command' must return Err, got Ok");
    match result.unwrap_err() {
        AppError::Validation(msg) => assert!(
            msg.contains("command"),
            "Validation error must mention 'command', got: {msg}"
        ),
        other => panic!("expected AppError::Validation, got {other:?}"),
    }
}

// ── 7. invoke_returns_error_for_non_string_command ────────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_non_string_command() {
    let tool = ShellExecTool::new();
    let result = tool.invoke(json!({ "command": 42 })).await;

    assert!(
        result.is_err(),
        "non-string 'command' must return Err, got Ok"
    );
    match result.unwrap_err() {
        AppError::Validation(_) => {}
        other => panic!("expected AppError::Validation, got {other:?}"),
    }
}

// ── 8. invoke_returns_error_for_non_string_array_args ────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_non_string_array_args() {
    let tool = ShellExecTool::new();
    let result = tool
        .invoke(json!({ "command": "echo", "args": [1, 2] }))
        .await;

    assert!(
        result.is_err(),
        "args array with non-string elements must return Err, got Ok"
    );
    match result.unwrap_err() {
        AppError::Validation(_) => {}
        other => panic!("expected AppError::Validation, got {other:?}"),
    }
}

// ── 9. invoke_returns_error_for_non_array_args ────────────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_non_array_args() {
    let tool = ShellExecTool::new();
    let result = tool
        .invoke(json!({ "command": "echo", "args": "not-array" }))
        .await;

    assert!(result.is_err(), "non-array 'args' must return Err, got Ok");
    match result.unwrap_err() {
        AppError::Validation(_) => {}
        other => panic!("expected AppError::Validation, got {other:?}"),
    }
}

// ── 10. invoke_returns_error_for_unknown_binary ───────────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_unknown_binary() {
    let tool = ShellExecTool::new();
    let result = tool
        .invoke(json!({ "command": "/this/binary/does/not/exist/asyar_no_such_bin" }))
        .await;

    assert!(
        result.is_err(),
        "spawn of nonexistent binary must return Err, got Ok"
    );
    match result.unwrap_err() {
        AppError::Other(msg) => assert!(
            !msg.is_empty(),
            "Other error message must describe spawn failure, got empty string"
        ),
        other => panic!("expected AppError::Other for spawn failure, got {other:?}"),
    }
}

// ── 11. invoke_runs_in_cwd ────────────────────────────────────────────────────

#[tokio::test]
async fn invoke_runs_in_cwd() {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let marker = dir.path().join("marker.txt");
    std::fs::write(&marker, "present").expect("failed to write marker file");

    let tool = ShellExecTool::new();
    let result = tool
        .invoke(json!({
            "command": "ls",
            "cwd": dir.path().to_str().unwrap()
        }))
        .await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let stdout = val["stdout"].as_str().expect("stdout must be a string");
    assert!(
        stdout.contains("marker.txt"),
        "stdout must list 'marker.txt', got: {stdout:?}"
    );
}

// ── 12. invoke_treats_args_as_omitted_when_missing ───────────────────────────

#[tokio::test]
async fn invoke_treats_args_as_omitted_when_missing() {
    let tool = ShellExecTool::new();
    let result = tool.invoke(json!({ "command": "echo" })).await;

    assert!(
        result.is_ok(),
        "expected Ok when args omitted, got {result:?}"
    );
    let val = result.unwrap();
    assert_eq!(
        val["exitCode"],
        json!(0),
        "exitCode must be 0, got: {}",
        val["exitCode"]
    );
}
