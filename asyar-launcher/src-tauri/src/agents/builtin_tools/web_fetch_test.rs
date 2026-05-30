use crate::agents::builtin_tools::web_fetch::{parse_fetch_args, WebFetchTool};
use crate::agents::tools::{BuiltinTool, ToolSource};
use crate::error::AppError;
use serde_json::json;

// ── 1. descriptor_has_expected_shape ─────────────────────────────────────────

#[test]
fn descriptor_has_expected_shape() {
    let tool = WebFetchTool::new();
    let desc = tool.descriptor();

    assert_eq!(desc.id, "web-fetch");
    assert_eq!(desc.fully_qualified_id, "builtin:web-fetch");
    assert_eq!(desc.source, ToolSource::Builtin);

    let params = &desc.parameters;
    assert!(
        params["properties"]["url"].is_object(),
        "parameters.properties.url must be present, got {params}"
    );

    let required = params["required"]
        .as_array()
        .expect("required must be array");
    assert!(
        required.iter().any(|v| v.as_str() == Some("url")),
        "required must include 'url', got {required:?}"
    );
}

// ── 2. parse_args_with_url_only ───────────────────────────────────────────────

#[test]
fn parse_args_with_url_only() {
    match parse_fetch_args(json!({ "url": "https://example.com" })) {
        Ok(req) => {
            assert_eq!(req.url, "https://example.com");
            assert!(req.method.is_none(), "method must be None");
            assert!(req.headers.is_none(), "headers must be None");
            assert!(req.body.is_none(), "body must be None");
            assert!(req.timeout_ms.is_none(), "timeout_ms must be None");
        }
        Err(e) => panic!("expected Ok for url-only args, got Err: {e:?}"),
    }
}

// ── 3. parse_args_with_full_request ──────────────────────────────────────────

#[test]
fn parse_args_with_full_request() {
    match parse_fetch_args(json!({
        "url": "https://api.example.com/data",
        "method": "POST",
        "headers": { "X-Foo": "bar", "Content-Type": "application/json" },
        "body": "{\"key\":\"value\"}",
        "timeoutMs": 5000
    })) {
        Ok(req) => {
            assert_eq!(req.url, "https://api.example.com/data");
            assert_eq!(req.method, Some("POST".to_string()));
            assert_eq!(req.body, Some("{\"key\":\"value\"}".to_string()));
            assert_eq!(req.timeout_ms, Some(5000));

            let headers = req.headers.expect("headers must be Some");
            assert_eq!(
                headers.get("X-Foo"),
                Some(&"bar".to_string()),
                "headers must contain X-Foo=bar"
            );
            assert_eq!(
                headers.get("Content-Type"),
                Some(&"application/json".to_string()),
                "headers must contain Content-Type=application/json"
            );
        }
        Err(e) => panic!("expected Ok for full request args, got Err: {e:?}"),
    }
}

// ── 4. parse_args_returns_error_for_missing_url ───────────────────────────────

#[test]
fn parse_args_returns_error_for_missing_url() {
    match parse_fetch_args(json!({})) {
        Err(AppError::Validation(msg)) => assert!(
            msg.contains("url"),
            "Validation error must mention 'url', got: {msg}"
        ),
        Err(other) => panic!("expected AppError::Validation, got {other:?}"),
        Ok(_) => panic!("missing url must return Err, got Ok"),
    }
}

// ── 5. parse_args_returns_error_for_non_string_url ───────────────────────────

#[test]
fn parse_args_returns_error_for_non_string_url() {
    match parse_fetch_args(json!({ "url": 42 })) {
        Err(AppError::Validation(_)) => {}
        Err(other) => panic!("expected AppError::Validation, got {other:?}"),
        Ok(_) => panic!("non-string url must return Err, got Ok"),
    }
}

// ── 6. parse_args_returns_error_for_non_string_method ────────────────────────

#[test]
fn parse_args_returns_error_for_non_string_method() {
    match parse_fetch_args(json!({ "url": "https://example.com", "method": 1 })) {
        Err(AppError::Validation(_)) => {}
        Err(other) => panic!("expected AppError::Validation, got {other:?}"),
        Ok(_) => panic!("non-string method must return Err, got Ok"),
    }
}

// ── 7. parse_args_returns_error_for_non_object_headers ───────────────────────

#[test]
fn parse_args_returns_error_for_non_object_headers() {
    match parse_fetch_args(json!({ "url": "https://example.com", "headers": "not-object" })) {
        Err(AppError::Validation(_)) => {}
        Err(other) => panic!("expected AppError::Validation, got {other:?}"),
        Ok(_) => panic!("non-object headers must return Err, got Ok"),
    }
}

// ── 8. parse_args_returns_error_for_non_string_header_value ──────────────────

#[test]
fn parse_args_returns_error_for_non_string_header_value() {
    match parse_fetch_args(json!({
        "url": "https://example.com",
        "headers": { "X-Foo": 42 }
    })) {
        Err(AppError::Validation(msg)) => assert!(
            msg.contains("X-Foo") || msg.contains("string"),
            "Validation error must mention the header name or type, got: {msg}"
        ),
        Err(other) => panic!("expected AppError::Validation, got {other:?}"),
        Ok(_) => panic!("headers with non-string value must return Err, got Ok"),
    }
}

// ── 9. parse_args_returns_error_for_non_string_body ──────────────────────────

#[test]
fn parse_args_returns_error_for_non_string_body() {
    match parse_fetch_args(json!({ "url": "https://example.com", "body": 42 })) {
        Err(AppError::Validation(_)) => {}
        Err(other) => panic!("expected AppError::Validation, got {other:?}"),
        Ok(_) => panic!("non-string body must return Err, got Ok"),
    }
}

// ── 10. parse_args_returns_error_for_non_number_timeout ──────────────────────

#[test]
fn parse_args_returns_error_for_non_number_timeout() {
    match parse_fetch_args(json!({ "url": "https://example.com", "timeoutMs": "fast" })) {
        Err(AppError::Validation(_)) => {}
        Err(other) => panic!("expected AppError::Validation, got {other:?}"),
        Ok(_) => panic!("non-number timeoutMs must return Err, got Ok"),
    }
}

// ── 11. parse_args_accepts_method_lowercase ───────────────────────────────────

#[test]
fn parse_args_accepts_method_lowercase() {
    match parse_fetch_args(json!({ "url": "https://example.com", "method": "post" })) {
        Ok(req) => assert_eq!(
            req.method,
            Some("post".to_string()),
            "method must be passed through without normalization"
        ),
        Err(e) => panic!("lowercase method must be accepted, got Err: {e:?}"),
    }
}

// ── 12. parse_args_treats_null_fields_as_omitted ─────────────────────────────

#[test]
fn parse_args_treats_null_fields_as_omitted() {
    match parse_fetch_args(json!({
        "url": "https://example.com",
        "method": null,
        "body": null
    })) {
        Ok(req) => {
            assert!(req.method.is_none(), "method must be None when null");
            assert!(req.body.is_none(), "body must be None when null");
        }
        Err(e) => panic!("null fields must be treated as omitted, got Err: {e:?}"),
    }
}
