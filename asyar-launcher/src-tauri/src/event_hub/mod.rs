//! Generic per-extension event subscription registry + fan-out.
//!
//! Extracted from the original `system_events::SystemEventsHub` so the
//! `app_events` service can reuse the same subscription/unsubscribe/dispatch
//! logic without copy-paste. The hub is event-shape-agnostic — callers
//! implement [`HubEvent`] on their concrete event enum to expose a `Kind`
//! associated type, which the hub uses as the registry key.
//!
//! Contract:
//!
//! - [`EventHub::subscribe`] records `(extension_id, HashSet<Kind>)` under a
//!   fresh UUID and returns the UUID.
//! - [`EventHub::unsubscribe`] removes by UUID, but only if the caller owns
//!   the subscription (permission check); otherwise returns
//!   [`AppError::Permission`].
//! - [`EventHub::remove_all_for_extension`] removes every subscription owned
//!   by `extension_id`; called from `extensions::lifecycle::uninstall`.
//! - [`EventHub::dispatch`] is called by platform watchers. It looks up all
//!   extensions with a matching kind subscription, dedupes per extension
//!   (same extension subscribing twice → one emit per dispatch), and invokes
//!   the caller-installed `EmitFn` once per unique extension.

use crate::error::AppError;
use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::sync::Mutex;

/// Contract that makes an event routable through an [`EventHub`].
///
/// Implement this on the concrete event enum. The hub uses
/// [`HubEvent::Kind`] as the subscription registry key and [`HubEvent::kind`]
/// to look up matching subscriptions at dispatch time.
pub trait HubEvent: Clone + Send + Sync + 'static {
    type Kind: Copy + Eq + Hash + Send + Sync + 'static;
    fn kind(&self) -> Self::Kind;
}

/// Fan-out function — injected by the caller. In production this is a
/// closure that forwards to `app_handle.emit("asyar:<tag>", payload)`; in
/// tests, a vec-pushing closure. Takes `(extension_id, event)`.
pub type EmitFn<E> = Box<dyn Fn(String, E) + Send + Sync>;

struct Subscription<K> {
    extension_id: String,
    kinds: HashSet<K>,
}

pub struct EventHub<E: HubEvent> {
    subscriptions: Mutex<HashMap<String, Subscription<E::Kind>>>,
    emit: Mutex<Option<EmitFn<E>>>,
}

impl<E: HubEvent> Default for EventHub<E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<E: HubEvent> EventHub<E> {
    pub fn new() -> Self {
        Self {
            subscriptions: Mutex::new(HashMap::new()),
            emit: Mutex::new(None),
        }
    }

    /// Replace the emit function. Called once during `setup_app` with a
    /// closure that forwards to `app_handle.emit("asyar:<tag>", …)`.
    pub fn set_emitter(&self, f: EmitFn<E>) {
        if let Ok(mut guard) = self.emit.lock() {
            *guard = Some(f);
        }
    }

    pub fn subscribe(
        &self,
        extension_id: &str,
        kinds: HashSet<E::Kind>,
    ) -> Result<String, AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        self.subscriptions
            .lock()
            .map_err(|_| AppError::Lock)?
            .insert(
                id.clone(),
                Subscription {
                    extension_id: extension_id.to_string(),
                    kinds,
                },
            );
        Ok(id)
    }

    pub fn unsubscribe(
        &self,
        extension_id: &str,
        subscription_id: &str,
    ) -> Result<(), AppError> {
        let mut guard = self.subscriptions.lock().map_err(|_| AppError::Lock)?;
        match guard.get(subscription_id) {
            Some(s) if s.extension_id == extension_id => {
                guard.remove(subscription_id);
                Ok(())
            }
            Some(_) => Err(AppError::Permission(
                "subscription belongs to a different extension".into(),
            )),
            None => Err(AppError::NotFound(format!(
                "subscription \"{}\" is not active",
                subscription_id
            ))),
        }
    }

    pub fn remove_all_for_extension(&self, extension_id: &str) -> Result<usize, AppError> {
        let mut guard = self.subscriptions.lock().map_err(|_| AppError::Lock)?;
        let before = guard.len();
        guard.retain(|_, s| s.extension_id != extension_id);
        Ok(before - guard.len())
    }

    /// Invoked by platform watchers when a concrete event fires. Dedupes
    /// per-extension and invokes the emitter once per unique extension that
    /// has a matching subscription. Silent no-op if no subscriptions match
    /// or the emitter was never installed.
    pub fn dispatch(&self, event: E) {
        let kind = event.kind();
        let targets: HashSet<String> = match self.subscriptions.lock() {
            Ok(guard) => guard
                .values()
                .filter(|s| s.kinds.contains(&kind))
                .map(|s| s.extension_id.clone())
                .collect(),
            Err(_) => return,
        };
        if targets.is_empty() {
            return;
        }
        let emit_guard = match self.emit.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let Some(emit) = emit_guard.as_ref() else {
            return;
        };
        for ext in targets {
            emit(ext, event.clone());
        }
    }

    #[cfg(test)]
    pub(crate) fn active_subscription_count(&self) -> usize {
        self.subscriptions.lock().map(|g| g.len()).unwrap_or(0)
    }
}

pub mod fake {
    use super::*;
    use std::sync::Arc;

    /// Records every `dispatch` call on the hub it's wired into. Use in
    /// tests to assert the hub fanned out correctly.
    pub struct RecordingEmitter<E: HubEvent> {
        pub emitted: Arc<Mutex<Vec<(String, E)>>>,
    }

    impl<E: HubEvent> Default for RecordingEmitter<E> {
        fn default() -> Self {
            Self::new()
        }
    }

    impl<E: HubEvent> Clone for RecordingEmitter<E> {
        fn clone(&self) -> Self {
            Self {
                emitted: Arc::clone(&self.emitted),
            }
        }
    }

    impl<E: HubEvent> RecordingEmitter<E> {
        pub fn new() -> Self {
            Self {
                emitted: Arc::new(Mutex::new(Vec::new())),
            }
        }

        pub fn into_emit_fn(self) -> EmitFn<E> {
            let emitted = self.emitted.clone();
            Box::new(move |ext, ev| {
                if let Ok(mut guard) = emitted.lock() {
                    guard.push((ext, ev));
                }
            })
        }

        pub fn snapshot(&self) -> Vec<(String, E)>
        where
            E: Clone,
        {
            self.emitted.lock().unwrap().clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A tiny event type defined here so the hub's tests don't depend on any
    // real service's event shape.
    #[derive(Debug, Clone, PartialEq)]
    enum TestEvent {
        A,
        B,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    enum TestKind {
        A,
        B,
    }

    impl HubEvent for TestEvent {
        type Kind = TestKind;
        fn kind(&self) -> Self::Kind {
            match self {
                Self::A => TestKind::A,
                Self::B => TestKind::B,
            }
        }
    }

    fn kinds(ks: &[TestKind]) -> HashSet<TestKind> {
        ks.iter().copied().collect()
    }

    #[test]
    fn subscribe_returns_uuid_and_records_subscription() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let id = hub.subscribe("ext-a", kinds(&[TestKind::A])).unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
        assert_eq!(hub.active_subscription_count(), 1);
    }

    #[test]
    fn unsubscribe_by_owner_removes_entry() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let id = hub.subscribe("ext-a", kinds(&[TestKind::A])).unwrap();
        hub.unsubscribe("ext-a", &id).unwrap();
        assert_eq!(hub.active_subscription_count(), 0);
    }

    #[test]
    fn unsubscribe_by_non_owner_is_permission_error() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let id = hub.subscribe("ext-a", kinds(&[TestKind::A])).unwrap();
        let err = hub.unsubscribe("ext-b", &id).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
        assert_eq!(hub.active_subscription_count(), 1);
    }

    #[test]
    fn unsubscribe_unknown_id_is_not_found() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let err = hub.unsubscribe("ext-a", "bogus").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn remove_all_for_extension_drops_only_that_extensions_subs() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let _a1 = hub.subscribe("ext-a", kinds(&[TestKind::A])).unwrap();
        let _a2 = hub.subscribe("ext-a", kinds(&[TestKind::B])).unwrap();
        let _b1 = hub.subscribe("ext-b", kinds(&[TestKind::A])).unwrap();
        let dropped = hub.remove_all_for_extension("ext-a").unwrap();
        assert_eq!(dropped, 2);
        assert_eq!(hub.active_subscription_count(), 1);
    }

    #[test]
    fn dispatch_emits_to_matching_extension_only() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let rec = fake::RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-a", kinds(&[TestKind::A])).unwrap();
        hub.subscribe("ext-b", kinds(&[TestKind::B])).unwrap();

        hub.dispatch(TestEvent::A);

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].0, "ext-a");
        assert_eq!(snap[0].1, TestEvent::A);
    }

    #[test]
    fn dispatch_dedupes_same_extension_across_multiple_subs() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let rec = fake::RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-a", kinds(&[TestKind::A])).unwrap();
        hub.subscribe("ext-a", kinds(&[TestKind::A, TestKind::B]))
            .unwrap();

        hub.dispatch(TestEvent::A);

        assert_eq!(
            rec.snapshot().len(),
            1,
            "duplicate subs from same extension must emit once"
        );
    }

    #[test]
    fn dispatch_without_emitter_is_silent_noop() {
        let hub: EventHub<TestEvent> = EventHub::new();
        hub.subscribe("ext-a", kinds(&[TestKind::A])).unwrap();
        // No emitter installed. Must not panic.
        hub.dispatch(TestEvent::A);
    }

    #[test]
    fn dispatch_with_no_matching_subs_does_not_invoke_emitter() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let rec = fake::RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-a", kinds(&[TestKind::B])).unwrap();

        hub.dispatch(TestEvent::A);

        assert!(rec.snapshot().is_empty());
    }

    #[test]
    fn dispatch_routes_by_kind_across_both_variants() {
        let hub: EventHub<TestEvent> = EventHub::new();
        let rec = fake::RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-b", kinds(&[TestKind::B])).unwrap();

        hub.dispatch(TestEvent::B);
        hub.dispatch(TestEvent::A); // not subscribed — no-op

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].1, TestEvent::B);
    }
}
