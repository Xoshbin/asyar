use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
#[serde(tag = "category", rename_all = "camelCase")]
pub enum SearchableItem {
    Application(Application),
    Command(Command),
}

#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)] // Add this default for usage count
    pub usage_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub trigger: String,
    #[serde(rename = "type")]
    pub command_type: String,
    #[serde(default)] // Add this default for usage count
    pub usage_count: u32,
    pub icon: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
}

// SearchResult remains the same for frontend compatibility
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub object_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub result_type: String, // 'application' or 'command'
    pub score: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}

/// Represents a search result contributed by a frontend extension.
/// Sent from TypeScript to Rust for unified ranking.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSearchResult {
    pub object_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub result_type: String,
    pub score: f32,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub extension_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
}

// Helper to get the name for sorting/searching
impl SearchableItem {
    pub fn get_name(&self) -> &str {
        match self {
            SearchableItem::Application(a) => &a.name,
            SearchableItem::Command(c) => &c.name,
        }
    }
    // Helper to get the type string
    pub fn get_type_str(&self) -> &str {
         match self {
            SearchableItem::Application(_) => "application",
            SearchableItem::Command(_) => "command",
        }
    }

    pub fn id(&self) -> &str {
        match self {
            SearchableItem::Application(app) => &app.id,
            SearchableItem::Command(cmd) => &cmd.id,
        }
    }

    pub fn usage_count(&self) -> u32 {
        match self {
            SearchableItem::Application(app) => app.usage_count,
            SearchableItem::Command(cmd) => cmd.usage_count,
        }
    }

    pub fn last_used_at(&self) -> Option<u32> {
        match self {
            SearchableItem::Application(app) => app.last_used_at,
            SearchableItem::Command(cmd) => cmd.last_used_at,
        }
    }
}

// Helper function to generate a stable ID from path (keep this)
#[allow(dead_code)]
pub fn generate_app_id_from_path(path: &str) -> String {
    // Use a simple hash or keep your Sha256 implementation
    // Example using a basic hash:
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("app_{:x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_app(id: &str, name: &str) -> SearchableItem {
        SearchableItem::Application(Application {
            id: id.to_string(),
            name: name.to_string(),
            path: format!("/Applications/{}.app", name),
            usage_count: 2,
            icon: None,
            last_used_at: None,
        })
    }

    fn make_cmd(id: &str, name: &str) -> SearchableItem {
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
        })
    }

    #[test]
    fn test_generate_app_id_starts_with_app_prefix() {
        let id = generate_app_id_from_path("/Applications/Finder.app");
        assert!(id.starts_with("app_"), "Expected 'app_' prefix, got: {}", id);
    }

    #[test]
    fn test_generate_app_id_is_deterministic() {
        let path = "/Applications/Safari.app";
        assert_eq!(
            generate_app_id_from_path(path),
            generate_app_id_from_path(path)
        );
    }

    #[test]
    fn test_generate_app_id_differs_for_different_paths() {
        assert_ne!(
            generate_app_id_from_path("/Applications/Chrome.app"),
            generate_app_id_from_path("/Applications/Firefox.app")
        );
    }

    #[test]
    fn test_application_get_name() {
        let item = make_app("app_finder", "Finder");
        assert_eq!(item.get_name(), "Finder");
    }

    #[test]
    fn test_command_get_name() {
        let item = make_cmd("cmd_search", "Search Google");
        assert_eq!(item.get_name(), "Search Google");
    }

    #[test]
    fn test_application_get_type_str() {
        let item = make_app("app_arc", "Arc");
        assert_eq!(item.get_type_str(), "application");
    }

    #[test]
    fn test_command_get_type_str() {
        let item = make_cmd("cmd_find", "Find");
        assert_eq!(item.get_type_str(), "command");
    }

    #[test]
    fn test_command_subtitle_defaults_to_none() {
        let json = r#"{
            "id": "cmd_test_hello",
            "name": "Hello",
            "extension": "test",
            "trigger": "hello",
            "type": "command"
        }"#;
        let cmd: Command = serde_json::from_str(json).unwrap();
        assert_eq!(cmd.subtitle, None);
    }

    #[test]
    fn test_command_subtitle_round_trips() {
        let cmd = Command {
            id: "cmd_test_weather".to_string(),
            name: "Weather".to_string(),
            extension: "test".to_string(),
            trigger: "weather".to_string(),
            command_type: "command".to_string(),
            usage_count: 0,
            icon: None,
            last_used_at: None,
            subtitle: Some("72 F".to_string()),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: Command = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.subtitle, Some("72 F".to_string()));
    }
}

#[cfg(test)]
mod bindings_export {
    use super::*;
    use crate::search_engine::commands::UpdateCommandMetadataInput;
    use specta_typescript::Typescript;

    /// Run `cargo test export_bindings -- --ignored` from src-tauri/ to regenerate
    /// asyar-launcher/src/bindings.ts whenever Rust model types change.
    #[test]
    #[ignore = "Only run manually to regenerate TypeScript bindings"]
    fn export_bindings() {
        let types = specta::TypeCollection::default()
            .register::<Application>()
            .register::<Command>()
            .register::<SearchableItem>()
            .register::<SearchResult>()
            .register::<ExternalSearchResult>()
            .register::<UpdateCommandMetadataInput>();

        Typescript::default()
            .export_to(
                std::path::PathBuf::from("../src/bindings.ts"),
                &types,
            )
            .expect("Failed to export TypeScript bindings to src/bindings.ts");
    }
}