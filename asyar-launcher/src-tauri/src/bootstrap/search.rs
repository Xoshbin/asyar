//! Search bootstrap module.
//!
//! Initializes `SearchState` backed by `DataStore` and registers it in Tauri's managed state.

use std::sync::Arc;
use tauri::Manager;

pub fn init_search(
    app: &mut tauri::App,
    data_store: Arc<crate::storage::DataStore>,
) -> Result<Arc<crate::search_engine::SearchState>, Box<dyn std::error::Error>> {
    let state = crate::search_engine::initialize_search_state(app.handle(), data_store)?;
    let state = Arc::new(state);
    app.manage(state.clone());
    Ok(state)
}
