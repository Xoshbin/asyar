//! Thin Tauri command wrapper for the Raycast importer.
//!
//! All parsing/decryption/translation logic lives in `crate::raycast_import`.

use crate::error::AppError;
use crate::raycast_import::{self, ParseOutcome};
use crate::search_engine::models::SearchableItem;
use crate::search_engine::SearchState;
use std::sync::Arc;

/// Parse a Raycast export file into a normalized import bundle. App hotkeys
/// are resolved against the current search index so the frontend receives
/// ready-to-register shortcut targets.
#[tauri::command]
pub async fn raycast_import_parse(
    path: String,
    password: Option<String>,
    search_state: tauri::State<'_, Arc<SearchState>>,
) -> Result<ParseOutcome, AppError> {
    let bytes = std::fs::read(&path)?;
    let mut outcome = raycast_import::parse_export(&bytes, password.as_deref())?;

    if let ParseOutcome::Ok { bundle } = &mut outcome {
        let apps: Vec<_> = search_state
            .items
            .read()
            .map_err(|_| AppError::Lock)?
            .iter()
            .filter_map(|item| match item {
                SearchableItem::Application(app) => Some(app.clone()),
                _ => None,
            })
            .collect();
        raycast_import::resolve_app_shortcuts(bundle, &apps);
    }

    Ok(outcome)
}
