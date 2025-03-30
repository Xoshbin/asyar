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
    #[serde(skip_serializing_if = "Option::is_none")] // Don't include if None
    pub path: Option<String>,
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
pub fn generate_app_id_from_path(path: &str) -> String {
    // Use a simple hash or keep your Sha256 implementation
    // Example using a basic hash:
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("app_{:x}", hasher.finish())
}