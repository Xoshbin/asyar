use crate::agents::tools::{
    agents_tools_list_impl, BuiltinTool, ManifestTool, ToolDescriptor, ToolRegistry, ToolSource,
};
use crate::error::AppError;
use std::sync::Arc;

// ── Test fixture ──────────────────────────────────────────────────────────────

struct EchoTool {
    id: String,
}

#[async_trait::async_trait]
impl BuiltinTool for EchoTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: self.id.clone(),
            name: format!("Echo ({})", self.id),
            description: "Echoes its input.".to_string(),
            parameters: serde_json::json!({}),
            source: ToolSource::Builtin,
            fully_qualified_id: format!("builtin:{}", self.id),
        }
    }

    async fn invoke(
        &self,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, AppError> {
        Ok(args)
    }
}

fn echo(id: &str) -> Arc<dyn BuiltinTool> {
    Arc::new(EchoTool { id: id.to_string() })
}

fn manifest_tool(id: &str) -> ManifestTool {
    ManifestTool {
        id: id.to_string(),
        name: format!("Tool {id}"),
        description: format!("Description for {id}"),
        parameters: serde_json::json!({}),
    }
}

// ── 1. new_registry_is_empty ──────────────────────────────────────────────────

#[test]
fn new_registry_is_empty() {
    let registry = ToolRegistry::new();
    assert!(registry.list_all().is_empty(), "new registry must return empty list");
}

// ── 2. register_builtin_appears_in_list ──────────────────────────────────────

#[test]
fn register_builtin_appears_in_list() {
    let registry = ToolRegistry::new();
    registry.register_builtin(echo("echo")).unwrap();

    let list = registry.list_all();
    assert_eq!(list.len(), 1, "list must contain 1 entry");
    let entry = &list[0];
    assert_eq!(entry.id, "echo");
    assert_eq!(entry.source, ToolSource::Builtin);
    assert_eq!(entry.fully_qualified_id, "builtin:echo");
}

// ── 3. register_builtin_rejects_duplicate_id ─────────────────────────────────

#[test]
fn register_builtin_rejects_duplicate_id() {
    let registry = ToolRegistry::new();
    registry.register_builtin(echo("echo")).unwrap();

    let result = registry.register_builtin(echo("echo"));
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "duplicate builtin id must return Err(AppError::Validation), got {result:?}"
    );
}

// ── 4. get_builtin_returns_registered_tool ────────────────────────────────────

#[test]
fn get_builtin_returns_registered_tool() {
    let registry = ToolRegistry::new();
    registry.register_builtin(echo("echo")).unwrap();

    let found = registry.get_builtin("echo");
    assert!(found.is_some(), "get_builtin must return Some after registration");
    assert_eq!(found.unwrap().descriptor().id, "echo");
}

// ── 5. get_builtin_returns_none_for_unknown ───────────────────────────────────

#[test]
fn get_builtin_returns_none_for_unknown() {
    let registry = ToolRegistry::new();
    assert!(
        registry.get_builtin("missing").is_none(),
        "get_builtin must return None for unknown id"
    );
}

// ── 6. register_tier2_inserts_tools ──────────────────────────────────────────

#[test]
fn register_tier2_inserts_tools() {
    let registry = ToolRegistry::new();
    registry
        .register_tier2("ext.foo", vec![manifest_tool("a"), manifest_tool("b")])
        .unwrap();

    let list = registry.list_all();
    assert_eq!(list.len(), 2, "list must contain 2 tier2 entries");

    let ids: Vec<&str> = list.iter().map(|d| d.fully_qualified_id.as_str()).collect();
    assert!(ids.contains(&"ext.foo:a"), "missing ext.foo:a");
    assert!(ids.contains(&"ext.foo:b"), "missing ext.foo:b");

    for entry in &list {
        assert_eq!(
            entry.source,
            ToolSource::Tier2("ext.foo".to_string()),
            "source must be Tier2(ext.foo)"
        );
    }
}

// ── 7. register_tier2_replaces_previous_set ──────────────────────────────────

#[test]
fn register_tier2_replaces_previous_set() {
    let registry = ToolRegistry::new();
    registry
        .register_tier2("ext.foo", vec![manifest_tool("a"), manifest_tool("b")])
        .unwrap();
    registry
        .register_tier2("ext.foo", vec![manifest_tool("c")])
        .unwrap();

    let list = registry.list_all();
    assert_eq!(
        list.len(),
        1,
        "after replace, list must contain only 1 entry, got {}",
        list.len()
    );
    assert_eq!(list[0].fully_qualified_id, "ext.foo:c");
}

// ── 8. register_tier2_does_not_affect_other_extensions ───────────────────────

#[test]
fn register_tier2_does_not_affect_other_extensions() {
    let registry = ToolRegistry::new();
    registry
        .register_tier2("ext.alpha", vec![manifest_tool("x")])
        .unwrap();
    registry
        .register_tier2("ext.beta", vec![manifest_tool("y")])
        .unwrap();

    // Replace alpha's set; beta must be untouched.
    registry
        .register_tier2("ext.alpha", vec![manifest_tool("z")])
        .unwrap();

    let list = registry.list_all();
    let fqids: Vec<&str> = list.iter().map(|d| d.fully_qualified_id.as_str()).collect();
    assert!(fqids.contains(&"ext.beta:y"), "ext.beta:y must still be present");
    assert!(!fqids.contains(&"ext.alpha:x"), "ext.alpha:x must have been replaced");
    assert!(fqids.contains(&"ext.alpha:z"), "ext.alpha:z must be present after replace");
}

// ── 9. unregister_tier2_drops_extension_tools ────────────────────────────────

#[test]
fn unregister_tier2_drops_extension_tools() {
    let registry = ToolRegistry::new();
    registry
        .register_tier2("ext.foo", vec![manifest_tool("a"), manifest_tool("b")])
        .unwrap();

    registry.unregister_tier2("ext.foo").unwrap();

    let list = registry.list_all();
    assert!(
        list.is_empty(),
        "list must be empty after unregister, got {} entries",
        list.len()
    );
}

// ── 10. unregister_tier2_unknown_extension_is_noop ───────────────────────────

#[test]
fn unregister_tier2_unknown_extension_is_noop() {
    let registry = ToolRegistry::new();
    let result = registry.unregister_tier2("never-registered");
    assert!(
        result.is_ok(),
        "unregister of unknown extension must return Ok, got {result:?}"
    );
    assert!(registry.list_all().is_empty());
}

// ── 11. list_all_orders_builtins_first_then_tier2_each_alpha ─────────────────

#[test]
fn list_all_orders_builtins_first_then_tier2_each_alpha() {
    let registry = ToolRegistry::new();
    registry.register_builtin(echo("z-builtin")).unwrap();
    registry
        .register_tier2("ext.foo", vec![manifest_tool("b-tier2"), manifest_tool("a-tier2")])
        .unwrap();

    let list = registry.list_all();
    assert_eq!(list.len(), 3, "expected 3 entries total, got {}", list.len());

    // Builtins first.
    assert_eq!(
        list[0].fully_qualified_id, "builtin:z-builtin",
        "first entry must be the builtin"
    );
    // Tier2 entries alphabetical by fully_qualified_id.
    assert_eq!(
        list[1].fully_qualified_id, "ext.foo:a-tier2",
        "second entry must be tier2 a (alphabetical)"
    );
    assert_eq!(
        list[2].fully_qualified_id, "ext.foo:b-tier2",
        "third entry must be tier2 b (alphabetical)"
    );
}

// ── 12. agents_tools_list_impl_returns_descriptors ───────────────────────────

#[test]
fn agents_tools_list_impl_returns_descriptors() {
    let registry = Arc::new(ToolRegistry::new());
    registry.register_builtin(echo("echo")).unwrap();

    let result = agents_tools_list_impl(&registry).unwrap();
    assert_eq!(result, registry.list_all(), "impl must return same as list_all");
}

// ── 13. register_tier2_rejects_tool_id_with_colon ────────────────────────────

#[test]
fn register_tier2_rejects_tool_id_with_colon() {
    let registry = ToolRegistry::new();
    let result = registry.register_tier2("ext.foo", vec![manifest_tool("bad:id")]);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "tool id containing ':' must return Err(AppError::Validation), got {result:?}"
    );
}

// ── 14. register_tier2_rejects_empty_extension_id ────────────────────────────

#[test]
fn register_tier2_rejects_empty_extension_id() {
    let registry = ToolRegistry::new();
    let result = registry.register_tier2("", vec![manifest_tool("a")]);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "empty extension_id must return Err(AppError::Validation), got {result:?}"
    );
}

// ── 15. register_tier2_rejects_empty_tool_id ─────────────────────────────────

#[test]
fn register_tier2_rejects_empty_tool_id() {
    let registry = ToolRegistry::new();
    let result = registry.register_tier2("ext.foo", vec![manifest_tool("")]);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "empty tool id must return Err(AppError::Validation), got {result:?}"
    );
}

// ── Item 7: builtin invocation command ───────────────────────────────────────

// ── 16. agents_invoke_builtin_tool_impl_invokes_handler ──────────────────────

#[tokio::test]
async fn agents_invoke_builtin_tool_impl_invokes_handler() {
    let registry = Arc::new(ToolRegistry::new());
    registry.register_builtin(echo("echo")).unwrap();

    let result = crate::agents::tools::agents_invoke_builtin_tool_impl(
        &registry,
        "echo",
        serde_json::json!({"x": 1}),
    )
    .await;

    assert!(
        result.is_ok(),
        "agents_invoke_builtin_tool_impl must return Ok for a registered builtin, got {result:?}"
    );
    assert_eq!(
        result.unwrap(),
        serde_json::json!({"x": 1}),
        "EchoTool must return its input unchanged"
    );
}

// ── 17. agents_invoke_builtin_tool_impl_errors_on_unknown_id ─────────────────

#[tokio::test]
async fn agents_invoke_builtin_tool_impl_errors_on_unknown_id() {
    let registry = Arc::new(ToolRegistry::new());

    let result = crate::agents::tools::agents_invoke_builtin_tool_impl(
        &registry,
        "nonexistent",
        serde_json::json!({}),
    )
    .await;

    assert!(
        result.is_err(),
        "agents_invoke_builtin_tool_impl must return Err for an unknown id"
    );
    assert!(
        matches!(result, Err(AppError::NotFound(_))),
        "error must be AppError::NotFound for unknown builtin id, got {result:?}"
    );
}

// ── Wire format contract with SDK ─────────────────────────────────────────────
//
// The SDK declares `source: 'builtin' | { extensionId: string }`. Rust must
// emit JSON matching that shape so the TS `groupDescriptorsBySource` helper
// resolves descriptors correctly. A mismatch silently hides the tool picker.

#[test]
fn tool_source_serializes_builtin_as_string() {
    let s = ToolSource::Builtin;
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(
        json,
        serde_json::json!("builtin"),
        "ToolSource::Builtin must serialize as the plain string \"builtin\" \
         to match the SDK contract; got {json}"
    );
}

#[test]
fn tool_source_serializes_tier2_as_object_with_extension_id() {
    let s = ToolSource::Tier2("ext.foo".into());
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "extensionId": "ext.foo" }),
        "ToolSource::Tier2 must serialize as {{\"extensionId\": ...}}; got {json}"
    );
}

#[test]
fn tool_source_round_trips_through_json() {
    let cases = [
        ToolSource::Builtin,
        ToolSource::Tier2("ext.bar".into()),
        ToolSource::Mcp("srv1".into()),
    ];
    for original in cases {
        let json = serde_json::to_value(&original).unwrap();
        let back: ToolSource = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(back, original, "round trip via {json} dropped the variant");
    }
}

// ── MCP tests ─────────────────────────────────────────────────────────────────

#[test]
fn register_mcp_inserts_tools() {
    let registry = ToolRegistry::new();
    registry
        .register_mcp("srv-acme", vec![manifest_tool("tool-a"), manifest_tool("tool-b")])
        .unwrap();

    let list = registry.list_all();
    assert_eq!(list.len(), 2, "list must contain 2 mcp entries");

    let fqids: Vec<&str> = list.iter().map(|d| d.fully_qualified_id.as_str()).collect();
    assert!(fqids.contains(&"mcp:srv-acme:tool-a"), "missing mcp:srv-acme:tool-a");
    assert!(fqids.contains(&"mcp:srv-acme:tool-b"), "missing mcp:srv-acme:tool-b");

    for entry in &list {
        assert_eq!(
            entry.source,
            ToolSource::Mcp("srv-acme".to_string()),
            "source must be Mcp(srv-acme)"
        );
    }
}

#[test]
fn register_mcp_replaces_previous_set() {
    let registry = ToolRegistry::new();
    registry
        .register_mcp("srv-acme", vec![manifest_tool("tool-a"), manifest_tool("tool-b")])
        .unwrap();
    registry
        .register_mcp("srv-acme", vec![manifest_tool("tool-c")])
        .unwrap();

    let list = registry.list_all();
    assert_eq!(
        list.len(),
        1,
        "after replace, list must contain only 1 entry, got {}",
        list.len()
    );
    assert_eq!(list[0].fully_qualified_id, "mcp:srv-acme:tool-c");
}

#[test]
fn register_mcp_does_not_affect_other_servers() {
    let registry = ToolRegistry::new();
    registry
        .register_mcp("srv-alpha", vec![manifest_tool("x")])
        .unwrap();
    registry
        .register_mcp("srv-beta", vec![manifest_tool("y")])
        .unwrap();

    // Replace alpha's set; beta must be untouched.
    registry
        .register_mcp("srv-alpha", vec![manifest_tool("z")])
        .unwrap();

    let list = registry.list_all();
    let fqids: Vec<&str> = list.iter().map(|d| d.fully_qualified_id.as_str()).collect();
    assert!(fqids.contains(&"mcp:srv-beta:y"), "mcp:srv-beta:y must still be present");
    assert!(!fqids.contains(&"mcp:srv-alpha:x"), "mcp:srv-alpha:x must have been replaced");
    assert!(fqids.contains(&"mcp:srv-alpha:z"), "mcp:srv-alpha:z must be present after replace");
}

#[test]
fn register_mcp_rejects_empty_server_id() {
    let registry = ToolRegistry::new();
    let result = registry.register_mcp("", vec![manifest_tool("a")]);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "empty server_id must return Err(AppError::Validation), got {result:?}"
    );
}

#[test]
fn register_mcp_rejects_tool_id_with_colon() {
    let registry = ToolRegistry::new();
    let result = registry.register_mcp("srv-acme", vec![manifest_tool("bad:id")]);
    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "tool id containing ':' must return Err(AppError::Validation), got {result:?}"
    );
}

#[test]
fn unregister_mcp_drops_server_tools() {
    let registry = ToolRegistry::new();
    registry
        .register_mcp("srv-acme", vec![manifest_tool("tool-a"), manifest_tool("tool-b")])
        .unwrap();

    registry.unregister_mcp("srv-acme").unwrap();

    let list = registry.list_all();
    assert!(
        list.is_empty(),
        "list must be empty after unregister_mcp, got {} entries",
        list.len()
    );
}

#[test]
fn list_all_orders_builtins_then_tier2_then_mcp_each_alpha() {
    let registry = ToolRegistry::new();
    registry.register_builtin(echo("z-builtin")).unwrap();
    registry
        .register_tier2("ext.foo", vec![manifest_tool("b-tier2"), manifest_tool("a-tier2")])
        .unwrap();
    registry
        .register_mcp("srv-x", vec![manifest_tool("b-mcp"), manifest_tool("a-mcp")])
        .unwrap();

    let list = registry.list_all();
    assert_eq!(list.len(), 5, "expected 5 entries total, got {}", list.len());

    // Builtins first.
    assert_eq!(
        list[0].fully_qualified_id, "builtin:z-builtin",
        "first entry must be the builtin"
    );
    // Tier2 entries alphabetical by fully_qualified_id.
    assert_eq!(
        list[1].fully_qualified_id, "ext.foo:a-tier2",
        "second entry must be tier2 a (alphabetical)"
    );
    assert_eq!(
        list[2].fully_qualified_id, "ext.foo:b-tier2",
        "third entry must be tier2 b (alphabetical)"
    );
    // MCP entries alphabetical by fully_qualified_id.
    assert_eq!(
        list[3].fully_qualified_id, "mcp:srv-x:a-mcp",
        "fourth entry must be mcp a (alphabetical)"
    );
    assert_eq!(
        list[4].fully_qualified_id, "mcp:srv-x:b-mcp",
        "fifth entry must be mcp b (alphabetical)"
    );
}

#[test]
fn tool_source_serializes_mcp_as_object_with_mcp_server_id() {
    let s = ToolSource::Mcp("srv1".into());
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "mcpServerId": "srv1" }),
        "ToolSource::Mcp must serialize as {{\"mcpServerId\": ...}}; got {json}"
    );
}
