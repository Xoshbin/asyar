use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::AppError;

/// Origin of a tool descriptor. Wire format (must match the SDK contract
/// `'builtin' | { extensionId: string }` in `asyar-sdk/src/contracts/tools.ts`):
///
/// - `Builtin` → JSON string `"builtin"`
/// - `Tier2("foo")` → JSON object `{ "extensionId": "foo" }`
///
/// Default serde tagging produces a `{ "kind": ... }` discriminator which
/// doesn't match the SDK shape; the TS `groupDescriptorsBySource` helper
/// would silently drop every descriptor and the agent edit view would render
/// an empty tool picker. Custom impls keep both sides aligned.
#[derive(Debug, Clone, PartialEq, Type)]
pub enum ToolSource {
    Builtin,
    Tier2(String),
}

impl Serialize for ToolSource {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        match self {
            ToolSource::Builtin => ser.serialize_str("builtin"),
            ToolSource::Tier2(extension_id) => {
                use serde::ser::SerializeMap;
                let mut map = ser.serialize_map(Some(1))?;
                map.serialize_entry("extensionId", extension_id)?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for ToolSource {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        use serde::de::Error as _;
        let value = serde_json::Value::deserialize(de)?;
        match value {
            serde_json::Value::String(s) if s == "builtin" => Ok(ToolSource::Builtin),
            serde_json::Value::String(other) => Err(D::Error::custom(format!(
                "unknown ToolSource string variant '{}': expected \"builtin\"",
                other
            ))),
            serde_json::Value::Object(map) => match map.get("extensionId") {
                Some(serde_json::Value::String(ext)) => Ok(ToolSource::Tier2(ext.clone())),
                Some(other) => Err(D::Error::custom(format!(
                    "Tier2 'extensionId' must be a string, got {}",
                    other
                ))),
                None => Err(D::Error::custom(
                    "Tier2 ToolSource object missing required 'extensionId' field",
                )),
            },
            _ => Err(D::Error::custom(
                "ToolSource must be the string \"builtin\" or an object with 'extensionId'",
            )),
        }
    }
}

/// A resolved tool descriptor returned to callers (e.g. the Tauri IPC layer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
    pub source: ToolSource,
    pub fully_qualified_id: String,
}

/// The shape of a tool entry as declared inside an extension manifest.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Trait implemented by every built-in tool.
#[async_trait::async_trait]
pub trait BuiltinTool: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;
    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError>;
}

/// Central registry for all tools — built-in and Tier 2.
pub struct ToolRegistry {
    builtins: RwLock<HashMap<String, Arc<dyn BuiltinTool>>>,
    tier2: RwLock<HashMap<String, ToolDescriptor>>,
}

impl ToolRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self {
            builtins: RwLock::new(HashMap::new()),
            tier2: RwLock::new(HashMap::new()),
        }
    }

    /// Registers a built-in tool. Returns an error if a tool with the same id
    /// is already registered.
    pub fn register_builtin(&self, tool: Arc<dyn BuiltinTool>) -> Result<(), AppError> {
        let id = tool.descriptor().id.clone();
        let mut map = self.builtins.write().map_err(|_| AppError::Lock)?;
        if map.contains_key(&id) {
            return Err(AppError::Validation(format!(
                "tool with id {} already registered",
                id
            )));
        }
        map.insert(id, tool);
        Ok(())
    }

    /// Registers (or replaces) the set of tools exported by a Tier 2 extension.
    ///
    /// The call is replace-style: all previously registered entries for
    /// `extension_id` are removed and replaced by the new `tools` list.
    pub fn register_tier2(
        &self,
        extension_id: &str,
        tools: Vec<ManifestTool>,
    ) -> Result<(), AppError> {
        if extension_id.trim().is_empty() {
            return Err(AppError::Validation(
                "extension_id must not be empty".to_string(),
            ));
        }
        for tool in &tools {
            if tool.id.trim().is_empty() {
                return Err(AppError::Validation(
                    "tool id must not be empty".to_string(),
                ));
            }
            if tool.id.contains(':') {
                return Err(AppError::Validation(format!(
                    "tool id '{}' must not contain ':'",
                    tool.id
                )));
            }
        }

        let mut map = self.tier2.write().map_err(|_| AppError::Lock)?;
        // Drop all existing entries for this extension.
        map.retain(|_, desc| desc.source != ToolSource::Tier2(extension_id.to_string()));
        // Insert the new entries.
        for tool in tools {
            let fqid = format!("{}:{}", extension_id, tool.id);
            let descriptor = ToolDescriptor {
                id: tool.id,
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
                source: ToolSource::Tier2(extension_id.to_string()),
                fully_qualified_id: fqid.clone(),
            };
            map.insert(fqid, descriptor);
        }
        Ok(())
    }

    /// Removes all tools registered by the given extension. A no-op if the
    /// extension was never registered.
    pub fn unregister_tier2(&self, extension_id: &str) -> Result<(), AppError> {
        let mut map = self.tier2.write().map_err(|_| AppError::Lock)?;
        map.retain(|_, desc| desc.source != ToolSource::Tier2(extension_id.to_string()));
        Ok(())
    }

    /// Returns all registered tools: builtins first (sorted by id), then Tier 2
    /// (sorted by fully-qualified id). The `fully_qualified_id` for builtins is
    /// always `"builtin:<id>"`.
    pub fn list_all(&self) -> Vec<ToolDescriptor> {
        let builtins = self.builtins.read().unwrap_or_else(|e| e.into_inner());
        let tier2 = self.tier2.read().unwrap_or_else(|e| e.into_inner());

        let mut builtin_descs: Vec<ToolDescriptor> = builtins
            .values()
            .map(|t| {
                let mut d = t.descriptor();
                d.fully_qualified_id = format!("builtin:{}", d.id);
                d
            })
            .collect();
        builtin_descs.sort_by(|a, b| a.id.cmp(&b.id));

        let mut tier2_descs: Vec<ToolDescriptor> = tier2.values().cloned().collect();
        tier2_descs.sort_by(|a, b| a.fully_qualified_id.cmp(&b.fully_qualified_id));

        builtin_descs.extend(tier2_descs);
        builtin_descs
    }

    /// Returns the built-in tool registered under `id` (bare id, not FQID), or
    /// `None` if no such tool exists.
    pub fn get_builtin(&self, id: &str) -> Option<Arc<dyn BuiltinTool>> {
        let map = self.builtins.read().unwrap_or_else(|e| e.into_inner());
        map.get(id).cloned()
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience type alias used as Tauri managed state.
pub type ToolRegistryState = Arc<ToolRegistry>;

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// Testable implementation — takes a plain reference so tests can call it
/// without a full Tauri app context.
pub fn agents_tools_list_impl(registry: &ToolRegistry) -> Result<Vec<ToolDescriptor>, AppError> {
    Ok(registry.list_all())
}

/// Tauri command wrapper.
#[tauri::command]
pub async fn agents_tools_list(
    state: tauri::State<'_, ToolRegistryState>,
) -> Result<Vec<ToolDescriptor>, AppError> {
    agents_tools_list_impl(&state)
}

/// Replace the full set of tools registered by a Tier 2 extension.
/// Called from the launcher TS service after `registerTool` or `unregisterTool`
/// mutates the per-extension tool map.
#[tauri::command]
pub async fn agents_tools_register_tier2(
    state: tauri::State<'_, ToolRegistryState>,
    extension_id: String,
    tools: Vec<ManifestTool>,
) -> Result<(), AppError> {
    state.register_tier2(&extension_id, tools)
}

/// Remove all tools registered by a Tier 2 extension.
#[tauri::command]
pub async fn agents_tools_unregister_tier2(
    state: tauri::State<'_, ToolRegistryState>,
    extension_id: String,
) -> Result<(), AppError> {
    state.unregister_tier2(&extension_id)
}

/// Testable core for `agents_invoke_builtin_tool`. Looks up the builtin tool
/// by bare id, delegates to its `invoke` method, and returns the result.
pub async fn agents_invoke_builtin_tool_impl(
    registry: &ToolRegistry,
    id: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let tool = registry
        .get_builtin(id)
        .ok_or_else(|| AppError::NotFound(format!("builtin tool '{}' not found", id)))?;
    tool.invoke(args).await
}

/// Tauri command — invoke a built-in tool by its bare id.
#[tauri::command]
pub async fn agents_invoke_builtin_tool(
    state: tauri::State<'_, ToolRegistryState>,
    id: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    agents_invoke_builtin_tool_impl(&state, &id, args).await
}
