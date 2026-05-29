use crate::browser::types::Tab;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserHello {
    pub family: String,
    pub variant: String,
    pub profiles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum CompanionMessage {
    Hello {
        version: u32,
        browser: BrowserHello,
    },
    Event {
        name: String,
        payload: serde_json::Value,
    },
    Res {
        id: String,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ServerMessage {
    Req {
        id: String,
        method: String,
        params: serde_json::Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabsSnapshotPayload(pub Vec<Tab>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hello_message() {
        let raw = r#"{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default","Profile 1"]}}"#;
        let parsed: CompanionMessage = serde_json::from_str(raw).unwrap();
        match parsed {
            CompanionMessage::Hello { version, browser } => {
                assert_eq!(version, 1);
                assert_eq!(browser.variant, "chrome");
                assert_eq!(browser.profiles, vec!["Default", "Profile 1"]);
            }
            _ => panic!("expected Hello"),
        }
    }

    #[test]
    fn parses_tabs_snapshot_event() {
        let raw = r#"{"type":"event","name":"tabs.snapshot","payload":[]}"#;
        let parsed: CompanionMessage = serde_json::from_str(raw).unwrap();
        match parsed {
            CompanionMessage::Event { name, .. } => assert_eq!(name, "tabs.snapshot"),
            _ => panic!("expected Event"),
        }
    }

    #[test]
    fn parses_response_with_result() {
        let raw = r#"{"type":"res","id":"r1","ok":true,"result":{"tabId":"42"}}"#;
        let parsed: CompanionMessage = serde_json::from_str(raw).unwrap();
        match parsed {
            CompanionMessage::Res { id, ok, error, .. } => {
                assert_eq!(id, "r1");
                assert!(ok);
                assert!(error.is_none());
            }
            _ => panic!("expected Res"),
        }
    }

    #[test]
    fn parses_response_with_error() {
        let raw = r#"{"type":"res","id":"r2","ok":false,"error":"tab not found"}"#;
        let parsed: CompanionMessage = serde_json::from_str(raw).unwrap();
        match parsed {
            CompanionMessage::Res { id, ok, error, .. } => {
                assert_eq!(id, "r2");
                assert!(!ok);
                assert_eq!(error.as_deref(), Some("tab not found"));
            }
            _ => panic!("expected Res"),
        }
    }

    #[test]
    fn serializes_server_req() {
        let msg = ServerMessage::Req {
            id: "s1".to_string(),
            method: "tabs.activate".to_string(),
            params: serde_json::json!({ "tabId": "42" }),
        };
        let raw = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["type"], "req");
        assert_eq!(parsed["id"], "s1");
        assert_eq!(parsed["method"], "tabs.activate");
    }
}
