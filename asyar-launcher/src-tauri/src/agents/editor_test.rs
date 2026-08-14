use std::collections::HashMap;
use std::sync::Arc;

use crate::agents::editor::{
    agents_editor_catalog_impl, agents_editor_save_impl, agents_stranded_by_provider_removal,
    build_editor_view_model, provider_removal_blocked_message, select_initial_model_id,
    AgentEditorForm, AgentProviderDescriptor, AgentToolGroup,
};
use crate::agents::tools::{BuiltinTool, ManifestTool, ToolDescriptor, ToolRegistry, ToolSource};
use crate::ai::types::{ModelInfo, ProviderConfig};
use crate::error::AppError;
use crate::storage::agents::{AgentRow, SilentInputSource, SilentOutputAction};
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
        name: None,
        provider_type: None,
        api_key: api_key.map(str::to_owned),
        base_url: base_url.map(str::to_owned),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
        temperature: None,
        max_tokens: None,
    }
}

fn agent(id: &str, provider_id: &str, model_id: &str) -> AgentRow {
    AgentRow {
        id: id.to_string(),
        name: "Asyar Assistant".to_string(),
        description: None,
        system_prompt: "You are helpful.".to_string(),
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
        tool_selection: Vec::new(),
        silent: false,
        input_source: SilentInputSource::Argument,
        output_action: SilentOutputAction::ReplaceSelection,
        cache_responses: false,
        shortcode_trigger: ":".to_string(),
        created_at: Some(1),
        updated_at: Some(1),
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
        vec!["ollama", "openai"]
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

    let view = build_editor_view_model(&registry, None, None, &[], &HashMap::new()).unwrap();

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
fn new_agent_form_defaults_to_the_default_agents_provider_and_model_when_usable() {
    let registry = ToolRegistry::new();
    let providers = vec![provider("anthropic", true, false)];
    let configs = HashMap::from([("anthropic".into(), config(true, Some("sk-ant"), None))]);
    let default_agent = agent("default-agent", "anthropic", "claude-sonnet-5");

    let view = build_editor_view_model(&registry, None, Some(&default_agent), &providers, &configs)
        .unwrap();

    assert_eq!(view.form.provider_id, "anthropic");
    assert_eq!(view.form.model_id, "claude-sonnet-5");
}

#[test]
fn new_agent_form_stays_blank_when_default_agents_provider_is_unusable() {
    let registry = ToolRegistry::new();
    // Default agent points at a provider that is no longer configured/usable.
    let providers = vec![provider("anthropic", true, false)];
    let configs = HashMap::from([("anthropic".into(), config(true, None, None))]);
    let default_agent = agent("default-agent", "anthropic", "claude-sonnet-5");

    let view = build_editor_view_model(&registry, None, Some(&default_agent), &providers, &configs)
        .unwrap();

    assert_eq!(view.form.provider_id, "");
    assert_eq!(view.form.model_id, "");
}

#[test]
fn new_agent_form_stays_blank_when_there_is_no_default_agent() {
    let registry = ToolRegistry::new();
    let providers = vec![provider("anthropic", true, false)];
    let configs = HashMap::from([("anthropic".into(), config(true, Some("sk-ant"), None))]);

    let view = build_editor_view_model(&registry, None, None, &providers, &configs).unwrap();

    assert_eq!(view.form.provider_id, "");
    assert_eq!(view.form.model_id, "");
}

#[test]
fn editing_an_existing_agent_ignores_the_default_agent() {
    let registry = ToolRegistry::new();
    let providers = vec![
        provider("anthropic", true, false),
        provider("openai", true, false),
    ];
    let configs = HashMap::from([
        ("anthropic".into(), config(true, Some("sk-ant"), None)),
        ("openai".into(), config(true, Some("sk-oai"), None)),
    ]);
    let existing = agent("agent-1", "openai", "gpt-5");
    let default_agent = agent("default-agent", "anthropic", "claude-sonnet-5");

    let view = build_editor_view_model(
        &registry,
        Some(&existing),
        Some(&default_agent),
        &providers,
        &configs,
    )
    .unwrap();

    assert_eq!(view.form.provider_id, "openai");
    assert_eq!(view.form.model_id, "gpt-5");
}

#[test]
fn stranded_by_provider_removal_is_empty_when_another_usable_provider_remains() {
    let providers = vec![
        provider("anthropic", true, false),
        provider("openai", true, false),
    ];
    let configs = HashMap::from([
        ("anthropic".into(), config(true, Some("sk-ant"), None)),
        ("openai".into(), config(true, Some("sk-oai"), None)),
    ]);
    let agents = vec![agent("agent-1", "openai", "gpt-5")];

    let stranded = agents_stranded_by_provider_removal("openai", &agents, &providers, &configs);

    assert!(stranded.is_empty());
}

#[test]
fn stranded_by_provider_removal_lists_agents_when_it_is_the_last_usable_provider() {
    let providers = vec![provider("anthropic", true, false)];
    let configs = HashMap::from([("anthropic".into(), config(true, Some("sk-ant"), None))]);
    let agents = vec![
        agent("agent-1", "anthropic", "claude-sonnet-5"),
        agent("agent-2", "anthropic", "claude-sonnet-5"),
    ];

    let stranded = agents_stranded_by_provider_removal("anthropic", &agents, &providers, &configs);

    assert_eq!(
        stranded.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
        vec!["agent-1", "agent-2"]
    );
}

#[test]
fn stranded_by_provider_removal_ignores_agents_already_on_other_providers() {
    let providers = vec![provider("anthropic", true, false)];
    let configs = HashMap::from([("anthropic".into(), config(true, Some("sk-ant"), None))]);
    let agents = vec![
        agent("agent-1", "anthropic", "claude-sonnet-5"),
        agent("agent-2", "already-stale-provider", "some-model"),
    ];

    let stranded = agents_stranded_by_provider_removal("anthropic", &agents, &providers, &configs);

    assert_eq!(
        stranded.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
        vec!["agent-1"]
    );
}

#[test]
fn stranded_by_provider_removal_is_empty_when_no_agents_reference_it() {
    let providers = vec![provider("anthropic", true, false)];
    let configs = HashMap::from([("anthropic".into(), config(true, Some("sk-ant"), None))]);

    let stranded = agents_stranded_by_provider_removal("anthropic", &[], &providers, &configs);

    assert!(stranded.is_empty());
}

#[test]
fn stranded_by_provider_removal_is_empty_when_the_provider_being_removed_is_already_unusable() {
    // "anthropic" is the only configured provider, but its API key was
    // cleared — it's already broken. Agents still reference it from
    // before it broke. Removing this dead row changes nothing for them
    // (self-heal already can't save them), so it must not be blocked.
    let providers = vec![provider("anthropic", true, false)];
    let configs = HashMap::from([("anthropic".into(), config(true, None, None))]);
    let agents = vec![agent("agent-1", "anthropic", "claude-sonnet-5")];

    let stranded = agents_stranded_by_provider_removal("anthropic", &agents, &providers, &configs);

    assert!(stranded.is_empty());
}

#[test]
fn provider_removal_blocked_message_is_none_when_nothing_is_stranded() {
    let providers = vec![provider("anthropic", true, false)];

    let message = provider_removal_blocked_message("anthropic", &providers, &HashMap::new(), &[]);

    assert_eq!(message, None);
}

#[test]
fn provider_removal_blocked_message_uses_the_providers_display_name() {
    let providers = vec![AgentProviderDescriptor {
        id: "anthropic".into(),
        name: "Anthropic".into(),
        requires_api_key: true,
        requires_base_url: false,
    }];
    let stranded = vec![agent("agent-1", "anthropic", "claude-sonnet-5")];

    let message =
        provider_removal_blocked_message("anthropic", &providers, &HashMap::new(), &stranded)
            .expect("should be blocked");

    assert!(message.contains("Anthropic"));
    assert!(message.contains("Asyar Assistant"));
}

#[test]
fn provider_removal_blocked_message_uses_custom_connection_name_when_available() {
    let providers = vec![AgentProviderDescriptor {
        id: "custom".into(),
        name: "Custom (OpenAI-compatible)".into(),
        requires_api_key: false,
        requires_base_url: true,
    }];
    let mut custom_cfg = config(true, None, Some("http://localhost:11434"));
    custom_cfg.name = Some("Local Ollama".into());
    custom_cfg.provider_type = Some("custom".into());

    let configs = HashMap::from([("custom_123".into(), custom_cfg)]);
    let stranded = vec![agent("agent-1", "custom_123", "llama3.2")];

    let message = provider_removal_blocked_message("custom_123", &providers, &configs, &stranded)
        .expect("should be blocked");

    assert!(message.contains("Local Ollama"));
    assert!(message.contains("Asyar Assistant"));
}

#[test]
fn editor_catalog_lists_multiple_named_provider_instances() {
    let registry = ToolRegistry::new();
    let providers = vec![
        provider("custom", false, true),
        provider("openai", true, false),
    ];
    let mut ollama_cfg = config(true, None, Some("http://localhost:11434"));
    ollama_cfg.name = Some("Local Ollama".into());
    ollama_cfg.provider_type = Some("custom".into());

    let mut deepseek_cfg = config(true, Some("sk-ds"), Some("https://api.deepseek.com"));
    deepseek_cfg.name = Some("DeepSeek".into());
    deepseek_cfg.provider_type = Some("custom".into());

    let mut work_openai_cfg = config(true, Some("sk-work"), None);
    work_openai_cfg.name = Some("Work OpenAI".into());
    work_openai_cfg.provider_type = Some("openai".into());

    let configs = HashMap::from([
        ("custom_ollama".into(), ollama_cfg),
        ("custom_deepseek".into(), deepseek_cfg),
        ("openai_work".into(), work_openai_cfg),
    ]);

    let catalog = agents_editor_catalog_impl(&registry, &providers, &configs).unwrap();

    let options = catalog.providers;
    assert_eq!(options.len(), 3);
    assert_eq!(options[0].name, "DeepSeek");
    assert_eq!(options[0].id, "custom_deepseek");
    assert_eq!(options[1].name, "Local Ollama");
    assert_eq!(options[1].id, "custom_ollama");
    assert_eq!(options[2].name, "Work OpenAI");
    assert_eq!(options[2].id, "openai_work");
}

#[test]
fn provider_removal_blocked_message_falls_back_to_the_raw_id_when_the_provider_is_unknown() {
    let stranded = vec![agent("agent-1", "openrouter", "openrouter/free")];

    let message = provider_removal_blocked_message("openrouter", &[], &HashMap::new(), &stranded)
        .expect("should be blocked");

    assert!(message.contains("openrouter"));
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
