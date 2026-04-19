use serde::Serialize;
use std::sync::Mutex;

pub trait EventEmitter: Send + Sync {
    fn emit_json(&self, event: &str, payload: serde_json::Value);
}

#[derive(Default)]
pub struct RecordingEmitter {
    pub emissions: Mutex<Vec<(String, serde_json::Value)>>,
}

impl EventEmitter for RecordingEmitter {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        self.emissions
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }
}

impl RecordingEmitter {
    pub fn events(&self) -> Vec<(String, serde_json::Value)> {
        self.emissions.lock().unwrap().clone()
    }
}

pub fn emit_typed<T: Serialize>(emitter: &dyn EventEmitter, event: &str, payload: &T) {
    let v = serde_json::to_value(payload).unwrap_or(serde_json::Value::Null);
    emitter.emit_json(event, v);
}

use tauri::{AppHandle, Emitter};

pub struct TauriEventEmitter {
    pub app: AppHandle,
}

impl EventEmitter for TauriEventEmitter {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        if let Err(e) = self.app.emit(event, &payload) {
            log::warn!("[iframe-lifecycle] emit {event} failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_emitter_captures_emits() {
        let e = RecordingEmitter::default();
        emit_typed(&e, "asyar:iframe:mount", &serde_json::json!({"extensionId": "x"}));
        let events = e.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "asyar:iframe:mount");
        assert_eq!(events[0].1["extensionId"], "x");
    }
}
