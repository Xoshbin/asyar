use std::sync::Arc;

use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use crate::search_engine::SearchState;
use serde_json::json;

pub struct SearchTool {
    search_state: Arc<SearchState>,
}

impl SearchTool {
    pub fn new(search_state: Arc<SearchState>) -> Self {
        Self { search_state }
    }
}

#[async_trait::async_trait]
impl BuiltinTool for SearchTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "search".into(),
            name: "Search Launcher Index".into(),
            description: "Search the launcher's index of installed apps and commands.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query." },
                    "limit": { "type": "number", "description": "Max results to return (default 10)." }
                },
                "required": ["query"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:search".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let query = args.get("query").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::Validation("missing required 'query' string argument".into())
        })?;

        let limit: usize = match args.get("limit") {
            None | Some(serde_json::Value::Null) => 10,
            Some(serde_json::Value::Number(n)) => {
                let i = n
                    .as_i64()
                    .ok_or_else(|| AppError::Validation("'limit' must be an integer".into()))?;
                if i < 0 {
                    return Err(AppError::Validation("'limit' must be non-negative".into()));
                }
                i as usize
            }
            _ => return Err(AppError::Validation("'limit' must be a number".into())),
        };

        let results = self
            .search_state
            .search(query)
            .map_err(|e| AppError::Other(format!("search failed: {}", e)))?;

        let trimmed: Vec<serde_json::Value> = results
            .into_iter()
            .take(limit)
            .map(|r| {
                json!({
                    "id":    r.object_id,
                    "name":  r.name,
                    "type":  r.result_type,
                    "score": r.score,
                })
            })
            .collect();

        Ok(json!({ "results": trimmed }))
    }
}
