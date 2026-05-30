use crate::agents::builtin_tools::calculator::CalculatorTool;
use crate::agents::tools::{BuiltinTool, ToolSource};
use crate::error::AppError;
use serde_json::{json, Value};

// ── 1. descriptor_has_expected_shape ─────────────────────────────────────────

#[test]
fn descriptor_has_expected_shape() {
    let tool = CalculatorTool::new();
    let desc = tool.descriptor();

    assert_eq!(desc.id, "calculator");
    assert_eq!(desc.fully_qualified_id, "builtin:calculator");
    assert_eq!(desc.source, ToolSource::Builtin);

    let params = &desc.parameters;
    assert!(
        params.is_object(),
        "parameters must be a JSON object, got {params}"
    );
    assert!(
        params["properties"]["expression"].is_object(),
        "parameters.properties.expression must be present, got {params}"
    );
}

// ── 2. invoke_evaluates_simple_arithmetic ────────────────────────────────────

#[tokio::test]
async fn invoke_evaluates_simple_arithmetic() {
    let tool = CalculatorTool::new();
    let result: Result<Value, AppError> = tool.invoke(json!({"expression": "2 + 3"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    assert_eq!(result.unwrap(), json!(5), "2 + 3 must return 5");
}

// ── 3. invoke_evaluates_floats ────────────────────────────────────────────────

#[tokio::test]
async fn invoke_evaluates_floats() {
    let tool = CalculatorTool::new();
    let result: Result<Value, AppError> = tool.invoke(json!({"expression": "1.5 + 2.5"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    assert_eq!(result.unwrap(), json!(4.0), "1.5 + 2.5 must return 4.0");
}

// ── 4. invoke_returns_error_for_missing_expression ───────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_missing_expression() {
    let tool = CalculatorTool::new();
    let result: Result<Value, AppError> = tool.invoke(json!({})).await;

    assert!(result.is_err(), "expected Err, got Ok");

    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(
        err_msg.contains("expression"),
        "error must mention 'expression', got {err_msg}"
    );
}

// ── 5. invoke_returns_error_for_non_string_expression ────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_non_string_expression() {
    let tool = CalculatorTool::new();
    let result: Result<Value, AppError> = tool.invoke(json!({"expression": 42})).await;

    assert!(
        result.is_err(),
        "numeric expression value must return Err, got Ok"
    );
}

// ── 6. invoke_returns_error_for_invalid_expression ───────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_invalid_expression() {
    let tool = CalculatorTool::new();
    let result: Result<Value, AppError> =
        tool.invoke(json!({"expression": "this is not math"})).await;

    assert!(
        result.is_err(),
        "invalid expression must return Err, got Ok"
    );
}

// ── 7. invoke_evaluates_with_parens ──────────────────────────────────────────

#[tokio::test]
async fn invoke_evaluates_with_parens() {
    let tool = CalculatorTool::new();
    let result: Result<Value, AppError> = tool.invoke(json!({"expression": "(2 + 3) * 4"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    assert_eq!(result.unwrap(), json!(20), "(2 + 3) * 4 must return 20");
}
