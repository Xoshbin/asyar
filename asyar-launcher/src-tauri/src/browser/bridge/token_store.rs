use crate::browser::types::{BrowserFamily, BrowserKey};
use std::sync::{Arc, RwLock};

const KEYRING_SERVICE: &str = "asyar-browser-bridge";

pub trait TokenStore: Send + Sync {
    fn set(&self, key: &BrowserKey, token: &str) -> Result<(), String>;
    fn get(&self, key: &BrowserKey) -> Result<Option<String>, String>;
    fn delete(&self, key: &BrowserKey) -> Result<(), String>;
    fn list_paired(&self) -> Result<Vec<BrowserKey>, String>;
}

fn account_for(key: &BrowserKey) -> String {
    let family = match key.family {
        BrowserFamily::Chromium => "chromium",
        BrowserFamily::Firefox => "firefox",
        BrowserFamily::Safari => "safari",
    };
    format!("{}:{}", family, key.variant)
}

pub struct KeyringTokenStore {
    index: Arc<RwLock<Vec<BrowserKey>>>,
}

impl KeyringTokenStore {
    pub fn new() -> Self {
        Self { index: Arc::new(RwLock::new(Vec::new())) }
    }

    pub fn seed_index(&self, known: Vec<BrowserKey>) {
        *self.index.write().unwrap() = known;
    }
}

impl Default for KeyringTokenStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStore for KeyringTokenStore {
    fn set(&self, key: &BrowserKey, token: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account_for(key))
            .map_err(|e| e.to_string())?;
        entry.set_password(token).map_err(|e| e.to_string())?;
        let mut idx = self.index.write().unwrap();
        if !idx.contains(key) {
            idx.push(key.clone());
        }
        Ok(())
    }

    fn get(&self, key: &BrowserKey) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account_for(key))
            .map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn delete(&self, key: &BrowserKey) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account_for(key))
            .map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.to_string()),
        }
        let mut idx = self.index.write().unwrap();
        idx.retain(|k| k != key);
        Ok(())
    }

    fn list_paired(&self) -> Result<Vec<BrowserKey>, String> {
        Ok(self.index.read().unwrap().clone())
    }
}

#[derive(Default)]
pub struct InMemoryTokenStore {
    inner: Arc<RwLock<std::collections::HashMap<BrowserKey, String>>>,
}

impl InMemoryTokenStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl TokenStore for InMemoryTokenStore {
    fn set(&self, key: &BrowserKey, token: &str) -> Result<(), String> {
        self.inner.write().unwrap().insert(key.clone(), token.to_string());
        Ok(())
    }
    fn get(&self, key: &BrowserKey) -> Result<Option<String>, String> {
        Ok(self.inner.read().unwrap().get(key).cloned())
    }
    fn delete(&self, key: &BrowserKey) -> Result<(), String> {
        self.inner.write().unwrap().remove(key);
        Ok(())
    }
    fn list_paired(&self) -> Result<Vec<BrowserKey>, String> {
        Ok(self.inner.read().unwrap().keys().cloned().collect())
    }
}

pub fn generate_token() -> String {
    use base64::Engine;
    use rand::Rng;
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> BrowserKey {
        BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() }
    }

    #[test]
    fn in_memory_store_set_and_get() {
        let store = InMemoryTokenStore::new();
        store.set(&key(), "tok-123").unwrap();
        assert_eq!(store.get(&key()).unwrap(), Some("tok-123".to_string()));
    }

    #[test]
    fn in_memory_store_returns_none_for_missing() {
        let store = InMemoryTokenStore::new();
        assert_eq!(store.get(&key()).unwrap(), None);
    }

    #[test]
    fn in_memory_store_delete() {
        let store = InMemoryTokenStore::new();
        store.set(&key(), "tok-x").unwrap();
        store.delete(&key()).unwrap();
        assert_eq!(store.get(&key()).unwrap(), None);
    }

    #[test]
    fn in_memory_store_lists_all_paired() {
        let store = InMemoryTokenStore::new();
        let k1 = BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() };
        let k2 = BrowserKey { family: BrowserFamily::Firefox, variant: "firefox".to_string() };
        store.set(&k1, "t1").unwrap();
        store.set(&k2, "t2").unwrap();
        let all = store.list_paired().unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn generates_32_byte_base64url_token() {
        let token = generate_token();
        // 32 bytes -> 43 base64url chars (no padding).
        assert_eq!(token.len(), 43);
        // base64url alphabet: [A-Za-z0-9_-]
        assert!(token.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    }
}
