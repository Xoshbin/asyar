//! Pure-logic decision for whether a dispatched message should be
//! intercepted by onboarding. Stash data structure for the originally
//! requested dispatch.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::extensions::extension_runtime::types::{MessageKind, PendingMessage, TriggerSource};
use crate::extensions::OnboardingDecl;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StashedDispatch {
    pub extension_id: String,
    pub original_payload: serde_json::Value,
    pub kind: MessageKind,
    pub source: TriggerSource,
}

pub enum InterceptDecision {
    /// Dispatch as-is — extension has no onboarding, is already onboarded,
    /// or this kind/source is exempt from the rule.
    PassThrough,
    /// Replace the message's command id with the onboarding command id;
    /// stash the original on the caller side.
    Reroute {
        onboarding_command: String,
        stash: StashedDispatch,
    },
}

pub fn decide(
    extension_id: &str,
    msg: &PendingMessage,
    onboarding_decl: Option<&OnboardingDecl>,
    is_onboarded: bool,
) -> InterceptDecision {
    if msg.kind != MessageKind::Command || !msg.source.is_user_facing() {
        return InterceptDecision::PassThrough;
    }
    let Some(decl) = onboarding_decl else {
        return InterceptDecision::PassThrough;
    };
    if is_onboarded {
        return InterceptDecision::PassThrough;
    }
    InterceptDecision::Reroute {
        onboarding_command: decl.command.clone(),
        stash: StashedDispatch {
            extension_id: extension_id.to_string(),
            original_payload: msg.payload.clone(),
            kind: msg.kind,
            source: msg.source,
        },
    }
}

#[derive(Default)]
pub struct StashRegistry(pub Mutex<HashMap<String, StashedDispatch>>);

impl StashRegistry {
    /// Insert (or replace) the pending dispatch for an extension.
    /// Returns whether a previous slot was replaced.
    pub fn put(&self, stash: StashedDispatch) -> bool {
        let mut guard = self.0.lock().expect("StashRegistry poisoned");
        guard.insert(stash.extension_id.clone(), stash).is_some()
    }

    /// Drain and return the pending dispatch for this extension, if any.
    pub fn take(&self, extension_id: &str) -> Option<StashedDispatch> {
        let mut guard = self.0.lock().expect("StashRegistry poisoned");
        guard.remove(extension_id)
    }

    /// Drop the pending dispatch without returning it.
    pub fn drop_for(&self, extension_id: &str) {
        let mut guard = self.0.lock().expect("StashRegistry poisoned");
        guard.remove(extension_id);
    }
}

#[cfg(test)]
mod decide_tests {
    use super::*;
    use serde_json::json;
    use std::time::Instant;

    fn user_command(payload: serde_json::Value) -> PendingMessage {
        PendingMessage {
            kind: MessageKind::Command,
            payload,
            enqueued_at: Instant::now(),
            source: TriggerSource::Search,
        }
    }

    fn schedule_command(payload: serde_json::Value) -> PendingMessage {
        PendingMessage {
            kind: MessageKind::Command,
            payload,
            enqueued_at: Instant::now(),
            source: TriggerSource::Schedule,
        }
    }

    #[test]
    fn no_decl_passes_through() {
        let m = user_command(json!({ "commandId": "brew" }));
        match decide("ext.coffee", &m, None, false) {
            InterceptDecision::PassThrough => {}
            _ => panic!("expected PassThrough"),
        }
    }

    #[test]
    fn already_onboarded_passes_through() {
        let m = user_command(json!({ "commandId": "brew" }));
        let d = OnboardingDecl { command: "setup".into() };
        match decide("ext.coffee", &m, Some(&d), true) {
            InterceptDecision::PassThrough => {}
            _ => panic!(),
        }
    }

    #[test]
    fn reroutes_user_initiated_command_when_not_onboarded() {
        let m = user_command(json!({ "commandId": "brew" }));
        let d = OnboardingDecl { command: "setup".into() };
        match decide("ext.coffee", &m, Some(&d), false) {
            InterceptDecision::Reroute { onboarding_command, stash } => {
                assert_eq!(onboarding_command, "setup");
                assert_eq!(stash.extension_id, "ext.coffee");
                assert_eq!(stash.original_payload, json!({ "commandId": "brew" }));
            }
            _ => panic!("expected Reroute"),
        }
    }

    #[test]
    fn schedule_source_passes_through_even_when_not_onboarded() {
        let m = schedule_command(json!({ "commandId": "tick" }));
        let d = OnboardingDecl { command: "setup".into() };
        match decide("ext.coffee", &m, Some(&d), false) {
            InterceptDecision::PassThrough => {}
            _ => panic!("expected PassThrough for schedule"),
        }
    }

    #[test]
    fn search_kind_passes_through() {
        let mut m = user_command(json!({ "query": "x" }));
        m.kind = MessageKind::ViewSearch;
        let d = OnboardingDecl { command: "setup".into() };
        match decide("ext.coffee", &m, Some(&d), false) {
            InterceptDecision::PassThrough => {}
            _ => panic!(),
        }
    }

    #[test]
    fn action_kind_passes_through() {
        let mut m = user_command(json!({ "actionId": "x" }));
        m.kind = MessageKind::Action;
        let d = OnboardingDecl { command: "setup".into() };
        match decide("ext.coffee", &m, Some(&d), false) {
            InterceptDecision::PassThrough => {}
            _ => panic!(),
        }
    }
}

#[cfg(test)]
mod stash_tests {
    use super::*;
    use serde_json::json;

    fn make(ext: &str, payload: serde_json::Value) -> StashedDispatch {
        StashedDispatch {
            extension_id: ext.into(),
            original_payload: payload,
            kind: MessageKind::Command,
            source: TriggerSource::Search,
        }
    }

    #[test]
    fn put_and_take_returns_value() {
        let r = StashRegistry::default();
        assert!(!r.put(make("a", json!(1))));
        let got = r.take("a").unwrap();
        assert_eq!(got.original_payload, json!(1));
    }

    #[test]
    fn put_replaces_returns_true() {
        let r = StashRegistry::default();
        r.put(make("a", json!(1)));
        let replaced = r.put(make("a", json!(2)));
        assert!(replaced);
        let got = r.take("a").unwrap();
        assert_eq!(got.original_payload, json!(2));
    }

    #[test]
    fn take_after_take_returns_none() {
        let r = StashRegistry::default();
        r.put(make("a", json!(1)));
        r.take("a");
        assert!(r.take("a").is_none());
    }

    #[test]
    fn drop_for_clears_slot() {
        let r = StashRegistry::default();
        r.put(make("a", json!(1)));
        r.drop_for("a");
        assert!(r.take("a").is_none());
    }

    #[test]
    fn isolated_per_extension() {
        let r = StashRegistry::default();
        r.put(make("a", json!(1)));
        r.put(make("b", json!(2)));
        assert_eq!(r.take("a").unwrap().original_payload, json!(1));
        assert_eq!(r.take("b").unwrap().original_payload, json!(2));
    }
}
