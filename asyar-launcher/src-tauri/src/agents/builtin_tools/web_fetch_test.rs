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

// ── 13. extension web reader routing & fallback ──────────────────────────────

#[tokio::test]
async fn test_web_fetch_extension_reader_success() {
    let tool = WebFetchTool::new();
    let dispatcher = std::sync::Arc::new(|req: crate::agents::runner::ExternalToolRequest| {
        Box::pin(async move {
            assert_eq!(req.tool_id, "webreader:org.example.jina:jina-reader");
            assert_eq!(req.arguments["url"], "https://example.com/post");
            Ok(json!({
                "url": "https://example.com/post",
                "title": "Clean Post Title",
                "content": "# Clean Post Title\nThis is clean markdown extracted by reader.",
                "status": 200,
            }))
        })
            as std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<serde_json::Value, AppError>> + Send>,
            >
    });

    let context = crate::agents::tools::ToolContext {
        web_reader: Some(crate::agents::runner::WebReaderConfig {
            reader: Some("ext:org.example.jina:jina-reader".to_string()),
            ..Default::default()
        }),
        external_dispatcher: Some(dispatcher),
        ..Default::default()
    };

    let output = tool
        .invoke_with_context(json!({ "url": "https://example.com/post" }), &context)
        .await
        .unwrap();

    assert_eq!(output["status"], 200);
    assert_eq!(output["statusText"], "OK");
    assert_eq!(output["ok"], true);
    assert_eq!(output["title"], "Clean Post Title");
    assert_eq!(output["url"], "https://example.com/post");
    assert_eq!(
        output["body"],
        "# Clean Post Title\nThis is clean markdown extracted by reader."
    );
}

#[tokio::test]
async fn test_web_fetch_non_get_bypasses_web_reader() {
    let tool = WebFetchTool::new();
    let called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let called_clone = called.clone();

    let dispatcher =
        std::sync::Arc::new(move |_req: crate::agents::runner::ExternalToolRequest| {
            called_clone.store(true, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async move { Ok(json!({ "content": "should not be called" })) })
                as std::pin::Pin<
                    Box<
                        dyn std::future::Future<Output = Result<serde_json::Value, AppError>>
                            + Send,
                    >,
                >
        });

    let context = crate::agents::tools::ToolContext {
        web_reader: Some(crate::agents::runner::WebReaderConfig {
            reader: Some("ext:org.example.jina:jina-reader".to_string()),
            ..Default::default()
        }),
        external_dispatcher: Some(dispatcher),
        ..Default::default()
    };

    // A POST request should bypass the reader and invoke native fetch directly
    let _ = tool
        .invoke_with_context(
            json!({ "url": "http://127.0.0.1:9", "method": "POST" }),
            &context,
        )
        .await;

    assert!(
        !called.load(std::sync::atomic::Ordering::SeqCst),
        "Extension web reader must NOT be invoked for non-GET requests"
    );
}

#[tokio::test]
async fn test_web_fetch_with_body_bypasses_web_reader() {
    let tool = WebFetchTool::new();
    let called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let called_clone = called.clone();

    let dispatcher =
        std::sync::Arc::new(move |_req: crate::agents::runner::ExternalToolRequest| {
            called_clone.store(true, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async move { Ok(json!({ "content": "should not be called" })) })
                as std::pin::Pin<
                    Box<
                        dyn std::future::Future<Output = Result<serde_json::Value, AppError>>
                            + Send,
                    >,
                >
        });

    let context = crate::agents::tools::ToolContext {
        web_reader: Some(crate::agents::runner::WebReaderConfig {
            reader: Some("ext:org.example.jina:jina-reader".to_string()),
            ..Default::default()
        }),
        external_dispatcher: Some(dispatcher),
        ..Default::default()
    };

    // A GET request with body should bypass the reader and invoke native fetch directly
    let _ = tool
        .invoke_with_context(
            json!({ "url": "http://127.0.0.1:9", "body": "some payload" }),
            &context,
        )
        .await;

    assert!(
        !called.load(std::sync::atomic::Ordering::SeqCst),
        "Extension web reader must NOT be invoked for requests with a body"
    );
}

#[tokio::test]
async fn test_web_fetch_extension_reader_with_store_resolves_api_key() {
    let store = crate::storage::DataStore::in_memory().unwrap();
    let master_key = crate::crypto::test_master_key();

    // Store encrypted credential for the reader
    {
        let conn = store.conn().unwrap();
        crate::storage::ai_credentials::set(
            &conn,
            "web_reader:ext:org.example.jina:jina-reader",
            "jina-test-secret-456",
            &master_key,
        )
        .unwrap();
    }

    let tool = WebFetchTool::with_store(store, master_key);
    let captured_key = std::sync::Arc::new(std::sync::Mutex::new(None));
    let captured_key_clone = captured_key.clone();

    let dispatcher = std::sync::Arc::new(move |req: crate::agents::runner::ExternalToolRequest| {
        let key = req
            .arguments
            .get("apiKey")
            .and_then(|k| k.as_str())
            .map(|s| s.to_string());
        *captured_key_clone.lock().unwrap() = key;
        Box::pin(async move {
            Ok(json!({
                "url": "https://example.com/secured",
                "title": "Secured Page",
                "content": "# Secured Content",
                "status": 200,
            }))
        })
            as std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<serde_json::Value, AppError>> + Send>,
            >
    });

    let context = crate::agents::tools::ToolContext {
        web_reader: Some(crate::agents::runner::WebReaderConfig {
            reader: Some("ext:org.example.jina:jina-reader".to_string()),
            ..Default::default()
        }),
        external_dispatcher: Some(dispatcher),
        ..Default::default()
    };

    let output = tool
        .invoke_with_context(json!({ "url": "https://example.com/secured" }), &context)
        .await
        .unwrap();

    assert_eq!(output["status"], 200);
    assert_eq!(
        captured_key.lock().unwrap().as_deref(),
        Some("jina-test-secret-456"),
        "API key should be decrypted and forwarded to external reader"
    );
}
