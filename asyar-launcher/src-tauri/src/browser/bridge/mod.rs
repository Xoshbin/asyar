pub mod cache;
pub mod connections;
pub mod pairing;
pub mod protocol;
pub mod server;
pub mod token_store;
pub mod ws_handler;
// More submodules added in later tasks.

use crate::browser::events::BrowserEventsHub;
use std::sync::Arc;

pub struct BridgeState<R: tauri::Runtime = tauri::Wry> {
    pub tokens: Arc<dyn token_store::TokenStore>,
    pub pairing: Arc<pairing::PairingRegistry>,
    pub connections: Arc<connections::CompanionRegistry>,
    pub cache: Arc<cache::TabSnapshotCache>,
    pub events: Arc<BrowserEventsHub>,
    pub app_handle: tauri::AppHandle<R>,
}

// Manual Clone impl: `#[derive(Clone)]` would add `R: Clone`, but tauri's
// `Runtime` trait does not require `Clone`. `AppHandle<R>` is always `Clone`
// regardless of `R`, and every other field is already `Clone`.
impl<R: tauri::Runtime> Clone for BridgeState<R> {
    fn clone(&self) -> Self {
        Self {
            tokens: self.tokens.clone(),
            pairing: self.pairing.clone(),
            connections: self.connections.clone(),
            cache: self.cache.clone(),
            events: self.events.clone(),
            app_handle: self.app_handle.clone(),
        }
    }
}
