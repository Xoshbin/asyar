use std::sync::{Arc, Mutex};

pub struct AppUpdaterState {
    /// The currently available update (if found and not yet applied).
    /// Held in memory so `app_updater_get_pending` can restore badge state
    /// after the webview loads without re-checking the sentinel file.
    pub pending: Arc<Mutex<Option<PendingUpdate>>>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdate {
    pub version: String,
}

impl AppUpdaterState {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for AppUpdaterState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_state_has_no_pending_update() {
        let state = AppUpdaterState::new();
        let pending = state.pending.lock().unwrap();
        assert!(pending.is_none());
    }

    #[test]
    fn test_default_matches_new() {
        let state = AppUpdaterState::default();
        let pending = state.pending.lock().unwrap();
        assert!(pending.is_none());
    }

    #[test]
    fn test_pending_update_serialize() {
        let update = PendingUpdate {
            version: "1.2.3".to_string(),
        };
        let json = serde_json::to_string(&update).unwrap();
        assert!(json.contains("\"version\""));
        assert!(json.contains("1.2.3"));
    }

    #[test]
    fn test_pending_update_clone() {
        let update = PendingUpdate {
            version: "2.0.0".to_string(),
        };
        let cloned = update.clone();
        assert_eq!(cloned.version, "2.0.0");
    }
}
