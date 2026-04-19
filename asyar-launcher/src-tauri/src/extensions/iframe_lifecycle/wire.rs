use super::types::*;
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcPendingMessage {
    pub kind: MessageKind,
    pub payload: serde_json::Value,
    pub source: TriggerSource,
}

impl From<PendingMessage> for IpcPendingMessage {
    fn from(m: PendingMessage) -> Self {
        Self {
            kind: m.kind,
            payload: m.payload,
            source: m.source,
        }
    }
}

impl IpcPendingMessage {
    pub fn into_internal(self, now: Instant) -> PendingMessage {
        PendingMessage {
            kind: self.kind,
            payload: self.payload,
            enqueued_at: now,
            source: self.source,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum IpcDispatchOutcome {
    ReadyDeliverNow { messages: Vec<IpcPendingMessage> },
    MountingWaitForReady,
    NeedsMount { mount_token: u64 },
    Degraded { strikes: u32 },
}

impl From<DispatchOutcome> for IpcDispatchOutcome {
    fn from(o: DispatchOutcome) -> Self {
        match o {
            DispatchOutcome::ReadyDeliverNow { messages } => Self::ReadyDeliverNow {
                messages: messages.into_iter().map(Into::into).collect(),
            },
            DispatchOutcome::MountingWaitForReady => Self::MountingWaitForReady,
            DispatchOutcome::NeedsMount { mount_token } => Self::NeedsMount { mount_token },
            DispatchOutcome::Degraded { strikes } => Self::Degraded { strikes },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_pending_message_roundtrips_through_json() {
        let original = PendingMessage {
            kind: MessageKind::Command,
            payload: serde_json::json!({"cmd": "run"}),
            enqueued_at: Instant::now(),
            source: TriggerSource::Search,
        };
        let ipc: IpcPendingMessage = original.clone().into();
        let json = serde_json::to_string(&ipc).unwrap();
        let back: IpcPendingMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, original.kind);
        assert_eq!(back.source, original.source);
        assert_eq!(back.payload, original.payload);
    }

    #[test]
    fn ipc_dispatch_outcome_serializes_with_kind_tag() {
        let o = IpcDispatchOutcome::NeedsMount { mount_token: 42 };
        let json = serde_json::to_value(&o).unwrap();
        assert_eq!(json["kind"], "needsMount");
        assert_eq!(json["mountToken"], 42);
    }
}
