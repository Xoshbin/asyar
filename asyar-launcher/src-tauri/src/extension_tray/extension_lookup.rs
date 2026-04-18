//! `ExtensionDirLookup` impl backed by Tauri's managed state.
//!
//! Reads `ExtensionRegistryState` from the running `AppHandle` at call time
//! so the backend can resolve `asyar-extension://` icon URIs without holding
//! its own shared reference to the registry.

use crate::extension_tray::icon::ExtensionDirLookup;
use crate::extensions::ExtensionRegistryState;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub struct AppHandleExtensionDirLookup {
    app: AppHandle,
}

impl AppHandleExtensionDirLookup {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl ExtensionDirLookup for AppHandleExtensionDirLookup {
    fn base_dir(&self, extension_id: &str) -> Option<PathBuf> {
        let state = self.app.try_state::<ExtensionRegistryState>()?;
        let map = state.extensions.lock().ok()?;
        map.get(extension_id).map(|r| PathBuf::from(&r.path))
    }
}
