use crate::browser::types::{BrowserKey, PairDecision};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Notify};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairingOutcome {
    Approved { token: String },
    Denied,
    TimedOut,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct PendingPairing {
    pub id: String,
    pub browser: BrowserKey,
    // Surfaced via Settings UI in a later task ("request age"). Keep public.
    #[allow(dead_code)]
    pub created_at: std::time::Instant,
}

#[derive(Debug)]
struct PendingEntry {
    browser: BrowserKey,
    notify: Arc<Notify>,
    resolution: Option<PairingOutcome>,
    created_at: std::time::Instant,
}

pub struct PairingRegistry {
    pending: Mutex<HashMap<String, PendingEntry>>,
}

impl PairingRegistry {
    pub fn new() -> Self {
        Self { pending: Mutex::new(HashMap::new()) }
    }

    pub async fn request(&self, browser: BrowserKey) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let entry = PendingEntry {
            browser,
            notify: Arc::new(Notify::new()),
            resolution: None,
            created_at: std::time::Instant::now(),
        };
        self.pending.lock().await.insert(id.clone(), entry);
        id
    }

    pub async fn wait(&self, id: &str, timeout: Duration) -> PairingOutcome {
        let notify = {
            let map = self.pending.lock().await;
            match map.get(id) {
                Some(entry) => Arc::clone(&entry.notify),
                None => return PairingOutcome::Unknown,
            }
        };
        let waited = tokio::time::timeout(timeout, notify.notified()).await;
        let mut map = self.pending.lock().await;
        match waited {
            Err(_) => {
                map.remove(id);
                PairingOutcome::TimedOut
            }
            Ok(()) => {
                let entry = map.remove(id);
                entry
                    .and_then(|e| e.resolution)
                    .unwrap_or(PairingOutcome::Unknown)
            }
        }
    }

    pub async fn resolve(
        &self,
        id: &str,
        decision: PairDecision,
        token: Option<String>,
    ) -> Result<(), String> {
        let mut map = self.pending.lock().await;
        let entry = map
            .get_mut(id)
            .ok_or_else(|| format!("unknown pairing id: {}", id))?;
        entry.resolution = Some(match decision {
            PairDecision::Allow => {
                let t = token.ok_or_else(|| "Allow decision requires a token".to_string())?;
                PairingOutcome::Approved { token: t }
            }
            PairDecision::Deny => PairingOutcome::Denied,
        });
        entry.notify.notify_one();
        Ok(())
    }

    pub async fn pending_requests(&self) -> Vec<PendingPairing> {
        self.pending
            .lock()
            .await
            .iter()
            .map(|(id, entry)| PendingPairing {
                id: id.clone(),
                browser: entry.browser.clone(),
                created_at: entry.created_at,
            })
            .collect()
    }

    pub async fn browser_for(&self, id: &str) -> Option<BrowserKey> {
        self.pending.lock().await.get(id).map(|e| e.browser.clone())
    }
}

impl Default for PairingRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::types::BrowserFamily;

    fn key() -> BrowserKey {
        BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() }
    }

    #[tokio::test]
    async fn request_returns_an_id() {
        let reg = PairingRegistry::new();
        let id = reg.request(key()).await;
        assert!(!id.is_empty());
    }

    #[tokio::test]
    async fn wait_returns_approved_with_token_after_resolve_allow() {
        let reg = Arc::new(PairingRegistry::new());
        let id = reg.request(key()).await;

        let reg_for_wait = Arc::clone(&reg);
        let id_for_wait = id.clone();
        let waiter = tokio::spawn(async move {
            reg_for_wait.wait(&id_for_wait, std::time::Duration::from_secs(2)).await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        reg.resolve(&id, PairDecision::Allow, Some("tok-123".to_string()))
            .await
            .unwrap();

        let outcome = waiter.await.unwrap();
        match outcome {
            PairingOutcome::Approved { token } => assert_eq!(token, "tok-123"),
            other => panic!("expected Approved, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn wait_returns_denied_after_resolve_deny() {
        let reg = Arc::new(PairingRegistry::new());
        let id = reg.request(key()).await;

        let reg_for_wait = Arc::clone(&reg);
        let id_for_wait = id.clone();
        let waiter = tokio::spawn(async move {
            reg_for_wait.wait(&id_for_wait, std::time::Duration::from_secs(2)).await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        reg.resolve(&id, PairDecision::Deny, None).await.unwrap();

        match waiter.await.unwrap() {
            PairingOutcome::Denied => {}
            other => panic!("expected Denied, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn wait_times_out() {
        let reg = PairingRegistry::new();
        let id = reg.request(key()).await;
        let outcome = reg.wait(&id, std::time::Duration::from_millis(100)).await;
        assert!(matches!(outcome, PairingOutcome::TimedOut));
    }

    #[tokio::test]
    async fn pending_requests_returns_current_pending() {
        let reg = PairingRegistry::new();
        let _id1 = reg.request(key()).await;
        let _id2 = reg.request(BrowserKey { family: BrowserFamily::Firefox, variant: "firefox".to_string() }).await;
        let pending = reg.pending_requests().await;
        assert_eq!(pending.len(), 2);
    }
}
