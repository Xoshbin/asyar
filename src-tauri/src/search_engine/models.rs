use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "category", rename_all = "camelCase")] // Use 'category' to match TS discriminant
pub enum SearchableItem {
    Application(Application),
    Command(Command),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    // Make id optional during deserialization, but we'll ensure it exists later
    #[serde(default)] // If 'id' is missing, use the default value (which is None for Option<String>, or empty string for String)
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub trigger: String,
    #[serde(rename = "type")] // Handle the 'type' field name conflict
    pub command_type: String,
}

// Structure for returning search results to frontend
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub object_id: String,
    pub name: String,
    #[serde(rename = "type")] // Consistent naming with SearchDocument
    pub result_type: String, // 'application' or 'command'
    pub score: f32, // Optionally add relevance score
}