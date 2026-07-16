use std::collections::HashMap;
use std::sync::Arc;

use crate::agents::editor::{
    agents_editor_catalog_impl, agents_editor_save_impl, build_editor_view_model,
    select_initial_model_id, AgentEditorForm, AgentProviderDescriptor, AgentToolGroup,
};
use crate::agents::tools::{BuiltinTool, ManifestTool, ToolDescriptor, ToolRegistry, ToolSource};
use crate::ai::types::{ModelInfo, ProviderConfig};
use crate::error::AppError;
use crate::storage::agents::{SilentInputSource, SilentOutputAction};
use rusqlite::Connection;

struct TestBuiltin;

#[async_trait::async_trait]
impl BuiltinTool for TestBuiltin {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "calculator".into(),
            name: "Calculator".into(),
            description: "Calculate an expression".into(),
            parameters: serde_json::json!({}),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:calculator".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        Ok(args)
    }
}

fn provider(id: &str, requires_api_key: bool, requires_base_url: bool) -> AgentProviderDescriptor {
    AgentProviderDescriptor {
        id: id.into(),
        name: id.into(),
        requires_api_key,
        requires_base_url,
    }
}

fn config(enabled: bool, api_key: Option<&str>, base_url: Option<&str>) -> ProviderConfig {
    ProviderConfig {
        enabled,
        api_key: api_key.map(str::to_owned),
        base_url: base_url.map(str::to_owned),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
    }
}

#[test]
fn editor_catalog_groups_tools_and_filters_unavailable_providers() {
    let registry = ToolRegistry::new();
    registry.register_builtin(Arc::new(TestBuiltin)).unwrap();
    registry
        .register_tier2(
            "org.example.notes",
            vec![ManifestTool {
                id: "lookup".into(),
                name: "Lookup".into(),
                description: "Lookup a note".into(),
                parameters: serde_json::json!({}),
            }],
        )
        .unwrap();
    registry
        .register_mcp(
            "docs",
            vec![ManifestTool {
                id: "search".into(),
                name: "Search".into(),
                description: "Search docs".into(),
                parameters: serde_json::json!({}),
            }],
        )
        .unwrap();

    let providers = vec![
        provider("openai", true, false),
        provider("ollama", false, true),
        provider("disabled", false, false),
    ];
    let configs = HashMap::from([
        ("openai".into(), config(true, Some("  sk-test  "), None)),
        (
            "ollama".into(),
            config(true, None, Some("http://localhost:11434")),
        ),
        ("disabled".into(), config(false, None, None)),
    ]);

    let catalog = agents_editor_catalog_impl(&registry, &providers, &configs).unwrap();

    assert_eq!(
        catalog
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<Vec<_>>(),
        vec!["openai", "ollama"]
    );
    assert_eq!(catalog.tool_groups.len(), 3);
    assert!(matches!(
        catalog.tool_groups[0],
        AgentToolGroup::Builtin { .. }
    ));
    assert!(matches!(
        &catalog.tool_groups[1],
        AgentToolGroup::Tier2 { extension_id, .. } if extension_id == "org.example.notes"
    ));
    assert!(matches!(
        &catalog.tool_groups[2],
        AgentToolGroup::Mcp { server_id, .. } if server_id == "docs"
    ));
}

#[test]
fn editor_catalog_requires_non_blank_credentials() {
    let registry = ToolRegistry::new();
    let providers = vec![
        provider("openai", true, false),
        provider("ollama", false, true),
    ];
    let configs = HashMap::from([
        ("openai".into(), config(true, Some("   "), None)),
        ("ollama".into(), config(true, None, Some("   "))),
    ]);

    let catalog = agents_editor_catalog_impl(&registry, &providers, &configs).unwrap();

    assert!(catalog.providers.is_empty());
}

#[test]
fn editor_tool_groups_serialize_to_the_svelte_contract() {
    let descriptor = ToolDescriptor {
        id: "lookup".into(),
        name: "Lookup".into(),
        description: "Lookup".into(),
        parameters: serde_json::json!({}),
        source: ToolSource::Tier2("org.example.notes".into()),
        fully_qualified_id: "org.example.notes:lookup".into(),
    };

    let json = serde_json::to_value(AgentToolGroup::Tier2 {
        extension_id: "org.example.notes".into(),
        tools: vec![descriptor],
    })
    .unwrap();

    assert_eq!(json["kind"], "tier2");
    assert_eq!(json["extensionId"], "org.example.notes");
    assert_eq!(
        json["tools"][0]["fullyQualifiedId"],
        "org.example.notes:lookup"
    );
}

#[test]
fn initial_model_selection_is_owned_by_rust() {
    let models = vec![
        ModelInfo {
            id: "first".into(),
            label: "First".into(),
            reasoning_efforts: None,
        },
        ModelInfo {
            id: "second".into(),
            label: "Second".into(),
            reasoning_efforts: None,
        },
    ];

    assert_eq!(
        select_initial_model_id("current", Some("second"), &models),
        "current"
    );
    assert_eq!(
        select_initial_model_id("   ", Some("second"), &models),
        "second"
    );
    assert_eq!(select_initial_model_id("", Some("   "), &models), "first");
    assert_eq!(select_initial_model_id("", None, &[]), "");
}

#[test]
fn editor_view_model_uses_rust_owned_defaults_for_new_agents() {
    let registry = ToolRegistry::new();

    let view = build_editor_view_model(&registry, None, &[], &HashMap::new()).unwrap();

    assert_eq!(view.form.name, "");
    assert_eq!(view.form.description, "");
    assert_eq!(view.form.system_prompt, "");
    assert_eq!(view.form.provider_id, "");
    assert_eq!(view.form.model_id, "");
    assert!(view.form.tool_selection.is_empty());
    assert!(!view.form.silent);
    assert_eq!(view.form.input_source, SilentInputSource::Argument);
    assert_eq!(
        view.form.output_action,
        SilentOutputAction::ReplaceSelection
    );
    assert!(!view.form.cache_responses);
}

#[test]
fn editor_save_validates_and_persists_the_frontend_form() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
    crate::storage::agents::init_table(&conn).unwrap();
    let form = AgentEditorForm {
        name: "  Agent  ".into(),
        description: "".into(),
        system_prompt: "  Be useful.  ".into(),
        provider_id: "openai".into(),
        model_id: "gpt-4o".into(),
        tool_selection: vec!["builtin:calculator".into()],
        silent: true,
        input_source: SilentInputSource::Selection,
        output_action: SilentOutputAction::ReplaceSelection,
        cache_responses: true,
        shortcode_trigger: ":".to_string(),
    };

    let row = agents_editor_save_impl(&conn, None, form).unwrap();

    assert_eq!(row.name, "Agent");
    assert_eq!(row.description, None);
    assert_eq!(row.system_prompt, "Be useful.");
    assert!(row.silent);
    assert!(row.cache_responses);
    assert!(crate::storage::agents::get_agent(&conn, &row.id)
        .unwrap()
        .is_some());
}

#[test]
fn editor_save_rejects_invalid_forms_in_rust() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
    crate::storage::agents::init_table(&conn).unwrap();
    let form = AgentEditorForm {
        name: "   ".into(),
        description: "".into(),
        system_prompt: "Be useful.".into(),
        provider_id: "openai".into(),
        model_id: "gpt-4o".into(),
        tool_selection: vec![],
        silent: false,
        input_source: SilentInputSource::Argument,
        output_action: SilentOutputAction::ReplaceSelection,
        cache_responses: false,
        shortcode_trigger: ":".to_string(),
    };

    assert!(matches!(
        agents_editor_save_impl(&conn, None, form),
        Err(AppError::Validation(_))
    ));
}
