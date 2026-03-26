use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "category", rename_all = "camelCase")]
pub enum SearchableItem {
    Application(Application),
    Command(Command),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
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
}

#[derive(Serialize, Deserialize, Debug, Clone)]
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
}

// SearchResult remains the same for frontend compatibility
#[derive(Serialize, Deserialize, Debug, Clone)]
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
}