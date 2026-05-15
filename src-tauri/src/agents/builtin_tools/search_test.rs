use std::sync::Arc;

use crate::agents::builtin_tools::search::SearchTool;
use crate::agents::tools::{BuiltinTool, ToolSource};
use crate::search_engine::models::{Application, Command, SearchableItem};
use crate::search_engine::SearchState;
use serde_json::json;

// ── fixture helpers ────────────────────────────────────────────────────────────

fn make_state() -> Arc<SearchState> {
    Arc::new(SearchState::new_for_test())
}

fn app(id: &str, name: &str) -> SearchableItem {
    SearchableItem::Application(Application {
        id: id.to_string(),
        name: name.to_string(),
        path: format!("/Applications/{}.app", name),
        usage_count: 1,
        icon: None,
        last_used_at: None,
        bundle_id: None,
    })
}

fn cmd(id: &str, name: &str) -> SearchableItem {
    SearchableItem::Command(Command {
        id: id.to_string(),
        name: name.to_string(),
        extension: "test-ext".to_string(),
        trigger: name.to_lowercase(),
        command_type: "command".to_string(),
        usage_count: 1,
        icon: None,
        last_used_at: None,
        subtitle: None,
        is_dynamic: false,
    })
}

// ── 1. descriptor_has_expected_shape ──────────────────────────────────────────

#[test]
fn descriptor_has_expected_shape() {
    let tool = SearchTool::new(make_state());
    let desc = tool.descriptor();

    assert_eq!(desc.id, "search");
    assert_eq!(desc.fully_qualified_id, "builtin:search");
    assert_eq!(desc.source, ToolSource::Builtin);

    let params = &desc.parameters;
    assert!(
        params["properties"]["query"].is_object(),
        "parameters.properties.query must be present, got {params}"
    );
    assert!(
        params["properties"]["limit"].is_object(),
        "parameters.properties.limit must be present, got {params}"
    );

    let required = params["required"].as_array().expect("required must be an array");
    assert!(
        required.iter().any(|v| v.as_str() == Some("query")),
        "required must include 'query', got {required:?}"
    );
    assert!(
        !required.iter().any(|v| v.as_str() == Some("limit")),
        "required must NOT include 'limit' (it is optional), got {required:?}"
    );
}

// ── 2. invoke_returns_matching_apps ───────────────────────────────────────────

#[tokio::test]
async fn invoke_returns_matching_apps() {
    let state = make_state();
    state.index_one(app("app_safari", "Safari")).unwrap();
    state.index_one(app("app_slack", "Slack")).unwrap();

    let tool = SearchTool::new(state);
    let result = tool.invoke(json!({"query": "saf"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let results = val["results"].as_array().expect("results must be an array");
    let safari = results.iter().find(|r| r["name"].as_str() == Some("Safari"));
    assert!(safari.is_some(), "expected Safari in results, got {results:?}");
    assert_eq!(
        safari.unwrap()["type"].as_str(),
        Some("application"),
        "Safari must have type 'application'"
    );
}

// ── 3. invoke_returns_matching_commands ───────────────────────────────────────

#[tokio::test]
async fn invoke_returns_matching_commands() {
    let state = make_state();
    state.index_one(cmd("cmd_ext_clipboard", "Clipboard History")).unwrap();

    let tool = SearchTool::new(state);
    let result = tool.invoke(json!({"query": "clipboard"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let results = val["results"].as_array().expect("results must be an array");
    let clip = results
        .iter()
        .find(|r| r["name"].as_str() == Some("Clipboard History"));
    assert!(clip.is_some(), "expected 'Clipboard History' in results, got {results:?}");
    assert_eq!(
        clip.unwrap()["type"].as_str(),
        Some("command"),
        "Clipboard History must have type 'command'"
    );
}

// ── 4. invoke_returns_empty_for_no_matches ────────────────────────────────────

#[tokio::test]
async fn invoke_returns_empty_for_no_matches() {
    let state = make_state();
    state.index_one(app("app_safari", "Safari")).unwrap();

    let tool = SearchTool::new(state);
    let result = tool.invoke(json!({"query": "xyznomatch_asyartest"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let results = val["results"].as_array().expect("results must be an array");
    assert!(results.is_empty(), "expected empty results, got {results:?}");
}

// ── 5. invoke_respects_limit ──────────────────────────────────────────────────

#[tokio::test]
async fn invoke_respects_limit() {
    let state = make_state();
    state.index_one(app("app_alpha", "Alpha")).unwrap();
    state.index_one(app("app_almond", "Almond")).unwrap();
    state.index_one(app("app_albatross", "Albatross")).unwrap();
    state.index_one(app("app_alligator", "Alligator")).unwrap();
    state.index_one(app("app_almanac", "Almanac")).unwrap();

    let tool = SearchTool::new(state);
    let result = tool.invoke(json!({"query": "al", "limit": 2})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let results = val["results"].as_array().expect("results must be an array");
    assert_eq!(results.len(), 2, "limit 2 must return exactly 2 results, got {}", results.len());
}

// ── 6. invoke_uses_default_limit_when_omitted ─────────────────────────────────

#[tokio::test]
async fn invoke_uses_default_limit_when_omitted() {
    let state = make_state();
    state.index_one(app("app_beta1", "Beta One")).unwrap();
    state.index_one(app("app_beta2", "Beta Two")).unwrap();
    state.index_one(app("app_beta3", "Beta Three")).unwrap();

    let tool = SearchTool::new(state);
    let result = tool.invoke(json!({"query": "beta"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let results = val["results"].as_array().expect("results must be an array");
    assert_eq!(
        results.len(),
        3,
        "3 matching items with default limit (10) must return 3, got {}",
        results.len()
    );
}

// ── 7. invoke_returns_error_for_missing_query ─────────────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_missing_query() {
    let tool = SearchTool::new(make_state());
    let result = tool.invoke(json!({})).await;

    assert!(result.is_err(), "expected Err for missing query, got Ok");
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("query"),
        "error must mention 'query', got: {err_str}"
    );
}

// ── 8. invoke_returns_error_for_non_string_query ──────────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_non_string_query() {
    let tool = SearchTool::new(make_state());
    let result = tool.invoke(json!({"query": 42})).await;

    assert!(
        result.is_err(),
        "non-string query must return Err, got Ok"
    );
}

// ── 9. invoke_returns_error_for_negative_limit ───────────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_negative_limit() {
    let tool = SearchTool::new(make_state());
    let result = tool.invoke(json!({"query": "x", "limit": -1})).await;

    assert!(result.is_err(), "negative limit must return Err, got Ok");
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("limit"),
        "error must mention 'limit', got: {err_str}"
    );
}

// ── 10. invoke_returns_error_for_non_number_limit ─────────────────────────────

#[tokio::test]
async fn invoke_returns_error_for_non_number_limit() {
    let tool = SearchTool::new(make_state());
    let result = tool.invoke(json!({"query": "x", "limit": "lots"})).await;

    assert!(
        result.is_err(),
        "non-number limit must return Err, got Ok"
    );
}

// ── 11. invoke_omits_extra_fields ─────────────────────────────────────────────

#[tokio::test]
async fn invoke_omits_extra_fields() {
    let state = make_state();
    state.index_one(app("app_finder", "Finder")).unwrap();

    let tool = SearchTool::new(state);
    let result = tool.invoke(json!({"query": "finder"})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let results = val["results"].as_array().expect("results must be an array");
    assert!(!results.is_empty(), "expected at least one result");

    let entry = &results[0];
    assert!(entry.get("id").is_some(), "result must have 'id'");
    assert!(entry.get("name").is_some(), "result must have 'name'");
    assert!(entry.get("type").is_some(), "result must have 'type'");
    assert!(entry.get("score").is_some(), "result must have 'score'");

    assert!(
        entry.get("path").is_none(),
        "result must NOT expose 'path', got {entry:?}"
    );
    assert!(
        entry.get("objectId").is_none(),
        "result must NOT expose 'objectId', got {entry:?}"
    );
    assert!(
        entry.get("object_id").is_none(),
        "result must NOT expose 'object_id', got {entry:?}"
    );
    assert!(
        entry.get("extensionId").is_none(),
        "result must NOT expose 'extensionId', got {entry:?}"
    );
    assert!(
        entry.get("icon").is_none(),
        "result must NOT expose 'icon', got {entry:?}"
    );
    assert!(
        entry.get("description").is_none(),
        "result must NOT expose 'description', got {entry:?}"
    );
}

// ── 12. limit_zero_returns_empty ──────────────────────────────────────────────

#[tokio::test]
async fn limit_zero_returns_empty() {
    let state = make_state();
    state.index_one(app("app_safari", "Safari")).unwrap();

    let tool = SearchTool::new(state);
    let result = tool.invoke(json!({"query": "safari", "limit": 0})).await;

    assert!(result.is_ok(), "expected Ok, got {result:?}");
    let val = result.unwrap();
    let results = val["results"].as_array().expect("results must be an array");
    assert!(results.is_empty(), "limit 0 must return empty results, got {results:?}");
}
