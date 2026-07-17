use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::agents::tools::{ToolDescriptor, ToolRegistry, ToolSource};
use crate::ai::models::list_models_impl;
use crate::ai::types::{ModelInfo, ProviderConfig};
use crate::commands::agents::{
    agents_create_impl, agents_update_impl, AgentCreateInput, AgentUpdateInput,
};
use crate::error::AppError;
use crate::storage::agents::{get_agent, AgentRow, SilentInputSource, SilentOutputAction};
use crate::storage::DataStore;
use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

/// Display metadata supplied by the frontend provider registry. Availability
/// policy is evaluated in Rust against the stored provider configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderDescriptor {
    pub id: String,
    pub name: String,
    pub requires_api_key: bool,
    pub requires_base_url: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderOption {
    pub id: String,
    pub name: String,
}

/// Tool descriptors grouped into the exact branches rendered by the editor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentToolGroup {
    Builtin {
        tools: Vec<ToolDescriptor>,
    },
    Tier2 {
        extension_id: String,
        tools: Vec<ToolDescriptor>,
    },
    Mcp {
        server_id: String,
        tools: Vec<ToolDescriptor>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentEditorCatalog {
    pub providers: Vec<AgentProviderOption>,
    pub tool_groups: Vec<AgentToolGroup>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentEditorForm {
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub provider_id: String,
    pub model_id: String,
    pub tool_selection: Vec<String>,
    pub silent: bool,
    pub input_source: SilentInputSource,
    pub output_action: SilentOutputAction,
    pub cache_responses: bool,
    pub shortcode_trigger: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentEditorViewModel {
    pub form: AgentEditorForm,
    pub providers: Vec<AgentProviderOption>,
    pub tool_groups: Vec<AgentToolGroup>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentEditorModelOptions {
    pub models: Vec<ModelInfo>,
    pub selected_model_id: String,
}

fn group_tools(descriptors: Vec<ToolDescriptor>) -> Vec<AgentToolGroup> {
    let mut builtins = Vec::new();
    let mut tier2: BTreeMap<String, Vec<ToolDescriptor>> = BTreeMap::new();
    let mut mcp: BTreeMap<String, Vec<ToolDescriptor>> = BTreeMap::new();

    for descriptor in descriptors {
        match &descriptor.source {
            ToolSource::Builtin => builtins.push(descriptor),
            ToolSource::Tier2(extension_id) => {
                tier2
                    .entry(extension_id.clone())
                    .or_default()
                    .push(descriptor);
            }
            ToolSource::Mcp(server_id) => {
                mcp.entry(server_id.clone()).or_default().push(descriptor);
            }
        }
    }

    let mut groups = Vec::new();
    if !builtins.is_empty() {
        groups.push(AgentToolGroup::Builtin { tools: builtins });
    }
    groups.extend(
        tier2
            .into_iter()
            .map(|(extension_id, tools)| AgentToolGroup::Tier2 {
                extension_id,
                tools,
            }),
    );
    groups.extend(
        mcp.into_iter()
            .map(|(server_id, tools)| AgentToolGroup::Mcp { server_id, tools }),
    );
    groups
}

fn has_non_blank(value: Option<&String>) -> bool {
    value.is_some_and(|value| !value.trim().is_empty())
}

/// Availability policy for a provider: enabled, and carrying whatever
/// credentials its descriptor says it requires. Shared by the Agent editor's
/// provider dropdown (`agents_editor_catalog_impl`) and by agent-run
/// resolution (`agents::lifecycle::resolve_runnable_agent`), so both consult
/// the same rule instead of drifting apart.
pub fn is_provider_usable(
    provider: &AgentProviderDescriptor,
    config: Option<&ProviderConfig>,
) -> bool {
    let Some(config) = config else {
        return false;
    };
    config.enabled
        && (!provider.requires_api_key || has_non_blank(config.api_key.as_ref()))
        && (!provider.requires_base_url || has_non_blank(config.base_url.as_ref()))
}

pub fn agents_editor_catalog_impl(
    registry: &ToolRegistry,
    providers: &[AgentProviderDescriptor],
    configs: &HashMap<String, ProviderConfig>,
) -> Result<AgentEditorCatalog, AppError> {
    let providers = providers
        .iter()
        .filter(|provider| is_provider_usable(provider, configs.get(&provider.id)))
        .map(|provider| AgentProviderOption {
            id: provider.id.clone(),
            name: provider.name.clone(),
        })
        .collect();

    Ok(AgentEditorCatalog {
        providers,
        tool_groups: group_tools(registry.list_all()),
    })
}

fn editor_form(agent: Option<&AgentRow>) -> AgentEditorForm {
    match agent {
        Some(agent) => AgentEditorForm {
            name: agent.name.clone(),
            description: agent.description.clone().unwrap_or_default(),
            system_prompt: agent.system_prompt.clone(),
            provider_id: agent.provider_id.clone(),
            model_id: agent.model_id.clone(),
            tool_selection: agent.tool_selection.clone(),
            silent: agent.silent,
            input_source: agent.input_source,
            output_action: agent.output_action,
            cache_responses: agent.cache_responses,
            shortcode_trigger: agent.shortcode_trigger.clone(),
        },
        None => AgentEditorForm {
            name: String::new(),
            description: String::new(),
            system_prompt: String::new(),
            provider_id: String::new(),
            model_id: String::new(),
            tool_selection: Vec::new(),
            silent: false,
            input_source: SilentInputSource::Argument,
            output_action: SilentOutputAction::ReplaceSelection,
            cache_responses: false,
            shortcode_trigger: ":".to_string(),
        },
    }
}

pub fn build_editor_view_model(
    registry: &ToolRegistry,
    agent: Option<&AgentRow>,
    providers: &[AgentProviderDescriptor],
    configs: &HashMap<String, ProviderConfig>,
) -> Result<AgentEditorViewModel, AppError> {
    let catalog = agents_editor_catalog_impl(registry, providers, configs)?;
    Ok(AgentEditorViewModel {
        form: editor_form(agent),
        providers: catalog.providers,
        tool_groups: catalog.tool_groups,
    })
}

pub fn agents_editor_save_impl(
    conn: &Connection,
    agent_id: Option<String>,
    form: AgentEditorForm,
) -> Result<AgentRow, AppError> {
    let description = if form.description.trim().is_empty() {
        None
    } else {
        Some(form.description)
    };
    match agent_id {
        Some(id) => agents_update_impl(
            conn,
            AgentUpdateInput {
                id,
                name: form.name,
                description,
                system_prompt: form.system_prompt,
                provider_id: form.provider_id,
                model_id: form.model_id,
                tool_selection: form.tool_selection,
                silent: Some(form.silent),
                input_source: Some(form.input_source),
                output_action: Some(form.output_action),
                cache_responses: Some(form.cache_responses),
                shortcode_trigger: Some(form.shortcode_trigger.clone()),
            },
        ),
        None => agents_create_impl(
            conn,
            AgentCreateInput {
                name: form.name,
                description,
                system_prompt: form.system_prompt,
                provider_id: form.provider_id,
                model_id: form.model_id,
                tool_selection: form.tool_selection,
                silent: Some(form.silent),
                input_source: Some(form.input_source),
                output_action: Some(form.output_action),
                cache_responses: Some(form.cache_responses),
                shortcode_trigger: Some(form.shortcode_trigger),
            },
        ),
    }
}

pub fn select_initial_model_id(
    current_model_id: &str,
    last_model_id: Option<&str>,
    models: &[ModelInfo],
) -> String {
    if !current_model_id.trim().is_empty() {
        return current_model_id.to_owned();
    }
    if let Some(last_model_id) = last_model_id.filter(|id| !id.trim().is_empty()) {
        return last_model_id.to_owned();
    }
    models
        .first()
        .map(|model| model.id.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn agents_editor_load(
    state: tauri::State<'_, crate::agents::tools::ToolRegistryState>,
    db: tauri::State<'_, DataStore>,
    agent_id: Option<String>,
    providers: Vec<AgentProviderDescriptor>,
    configs: HashMap<String, ProviderConfig>,
) -> Result<AgentEditorViewModel, AppError> {
    let conn = db.conn()?;
    let agent = match agent_id {
        Some(id) => {
            Some(get_agent(&conn, &id)?.ok_or_else(|| AppError::NotFound(format!("agent {id}")))?)
        }
        None => None,
    };
    build_editor_view_model(&state, agent.as_ref(), &providers, &configs)
}

#[tauri::command]
pub fn agents_editor_save(
    app: AppHandle,
    db: tauri::State<'_, DataStore>,
    agent_id: Option<String>,
    form: AgentEditorForm,
) -> Result<AgentRow, AppError> {
    let row = {
        let conn = db.conn()?;
        agents_editor_save_impl(&conn, agent_id, form)?
    };
    let _ = app.emit("agents:changed", ());
    Ok(row)
}

#[tauri::command]
pub async fn agents_editor_list_models(
    provider_id: String,
    config: ProviderConfig,
    current_model_id: String,
) -> Result<AgentEditorModelOptions, AppError> {
    let models = list_models_impl(&provider_id, &config).await?;
    let selected_model_id =
        select_initial_model_id(&current_model_id, config.last_model_id.as_deref(), &models);
    Ok(AgentEditorModelOptions {
        models,
        selected_model_id,
    })
}
