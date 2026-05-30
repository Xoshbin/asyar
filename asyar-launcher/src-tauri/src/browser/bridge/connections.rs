use crate::browser::bridge::protocol::ServerMessage;
use crate::browser::types::BrowserKey;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};

type RpcResult = Result<serde_json::Value, String>;
type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<RpcResult>>>>;

struct Connection {
    sender: mpsc::Sender<ServerMessage>,
    pending: PendingMap,
}

pub struct CompanionRegistry {
    by_key: Mutex<HashMap<BrowserKey, Arc<Connection>>>,
    req_index: Mutex<HashMap<String, BrowserKey>>,
}

impl CompanionRegistry {
    pub fn new() -> Self {
        Self {
            by_key: Mutex::new(HashMap::new()),
            req_index: Mutex::new(HashMap::new()),
        }
    }

    pub async fn register(&self, key: BrowserKey, sender: mpsc::Sender<ServerMessage>) {
        let conn = Arc::new(Connection {
            sender,
            pending: Arc::new(Mutex::new(HashMap::new())),
        });
        self.by_key.lock().await.insert(key, conn);
    }

    pub async fn unregister(&self, key: &BrowserKey) {
        let conn = self.by_key.lock().await.remove(key);
        if let Some(conn) = conn {
            let pending = std::mem::take(&mut *conn.pending.lock().await);
            for (_id, tx) in pending {
                let _ = tx.send(Err("connection closed".to_string()));
            }
        }
        let mut idx = self.req_index.lock().await;
        idx.retain(|_id, k| k != key);
    }

    pub async fn is_connected(&self, key: &BrowserKey) -> bool {
        self.by_key.lock().await.contains_key(key)
    }

    pub async fn list_connected(&self) -> Vec<BrowserKey> {
        self.by_key.lock().await.keys().cloned().collect()
    }

    pub async fn send_req(
        &self,
        key: &BrowserKey,
        method: String,
        params: serde_json::Value,
        timeout: std::time::Duration,
    ) -> Result<serde_json::Value, String> {
        let conn = {
            let map = self.by_key.lock().await;
            map.get(key).cloned()
        };
        let conn = conn.ok_or_else(|| format!("no connection for {:?}", key))?;
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        conn.pending.lock().await.insert(id.clone(), tx);
        self.req_index.lock().await.insert(id.clone(), key.clone());
        conn.sender
            .send(ServerMessage::Req {
                id: id.clone(),
                method,
                params,
            })
            .await
            .map_err(|e| format!("send failed: {}", e))?;
        match tokio::time::timeout(timeout, rx).await {
            Err(_) => {
                conn.pending.lock().await.remove(&id);
                self.req_index.lock().await.remove(&id);
                Err(format!("RPC timeout for id {}", id))
            }
            Ok(Err(_)) => Err("response channel dropped".to_string()),
            Ok(Ok(result)) => result,
        }
    }

    pub async fn deliver_response(
        &self,
        id: &str,
        result: Result<serde_json::Value, String>,
    ) -> Result<(), String> {
        let key = self
            .req_index
            .lock()
            .await
            .remove(id)
            .ok_or_else(|| format!("unknown request id: {}", id))?;
        let conn = self
            .by_key
            .lock()
            .await
            .get(&key)
            .cloned()
            .ok_or_else(|| format!("connection {:?} gone", key))?;
        let tx = conn
            .pending
            .lock()
            .await
            .remove(id)
            .ok_or_else(|| format!("no waiter for id {}", id))?;
        let _ = tx.send(result);
        Ok(())
    }
}

impl Default for CompanionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::types::BrowserFamily;

    fn key() -> BrowserKey {
        BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        }
    }

    #[tokio::test]
    async fn register_and_get_connection() {
        let reg = CompanionRegistry::new();
        let (tx, _rx) = mpsc::channel::<ServerMessage>(8);
        reg.register(key(), tx).await;
        assert!(reg.is_connected(&key()).await);
        assert_eq!(reg.list_connected().await.len(), 1);
    }

    #[tokio::test]
    async fn unregister_removes_connection() {
        let reg = CompanionRegistry::new();
        let (tx, _rx) = mpsc::channel::<ServerMessage>(8);
        reg.register(key(), tx).await;
        reg.unregister(&key()).await;
        assert!(!reg.is_connected(&key()).await);
    }

    #[tokio::test]
    async fn send_req_routes_to_correct_channel() {
        let reg = Arc::new(CompanionRegistry::new());
        let (tx, mut rx) = mpsc::channel::<ServerMessage>(8);
        reg.register(key(), tx).await;

        let reg2 = Arc::clone(&reg);
        let fut = tokio::spawn(async move {
            reg2.send_req(
                &key(),
                "tabs.activate".to_string(),
                serde_json::json!({ "tabId": "1" }),
                std::time::Duration::from_secs(2),
            )
            .await
        });

        let received = rx.recv().await.expect("expected req");
        let id = match received {
            ServerMessage::Req { id, .. } => id,
        };

        reg.deliver_response(&id, Ok(serde_json::json!({ "activated": true })))
            .await
            .unwrap();

        let result = fut.await.unwrap().unwrap();
        assert_eq!(result, serde_json::json!({ "activated": true }));
    }

    #[tokio::test]
    async fn send_req_times_out_if_no_response() {
        let reg = CompanionRegistry::new();
        let (tx, _rx) = mpsc::channel::<ServerMessage>(8);
        reg.register(key(), tx).await;
        let result = reg
            .send_req(
                &key(),
                "tabs.activate".to_string(),
                serde_json::Value::Null,
                std::time::Duration::from_millis(100),
            )
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("timeout"));
    }

    #[tokio::test]
    async fn send_req_errors_if_not_connected() {
        let reg = CompanionRegistry::new();
        let result = reg
            .send_req(
                &key(),
                "tabs.activate".to_string(),
                serde_json::Value::Null,
                std::time::Duration::from_secs(1),
            )
            .await;
        assert!(result.is_err());
    }
}
