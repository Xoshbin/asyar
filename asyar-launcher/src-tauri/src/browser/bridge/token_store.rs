use crate::browser::types::{BrowserFamily, BrowserKey};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

const KEYRING_SERVICE: &str = "asyar-browser-bridge";

/// The durable secret backend behind [`KeyringTokenStore`]. Abstracted so the
/// caching layer can be tested without touching the real OS keychain.
pub trait SecretBackend: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, String>;
    fn write(&self, account: &str, secret: &str) -> Result<(), String>;
    fn remove(&self, account: &str) -> Result<(), String>;
}

/// Production backend: persists secrets in the OS keychain via `keyring`.
pub struct KeyringBackend;

impl SecretBackend for KeyringBackend {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn write(&self, account: &str, secret: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
        entry.set_password(secret).map_err(|e| e.to_string())
    }
    fn remove(&self, account: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

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

/// Token store backed by a durable [`SecretBackend`] with an in-memory cache in
/// front of it. The cache makes auth checks on the hot `/bridge` path free after
/// the first lookup per browser — a reconnect loop no longer hammers the OS
/// keychain. Negative lookups (no pairing) are cached too, so an unpaired or
/// malicious client looping on the bridge also touches the backend only once.
pub struct KeyringTokenStore {
    backend: Arc<dyn SecretBackend>,
    cache: RwLock<HashMap<BrowserKey, Option<String>>>,
    index: RwLock<Vec<BrowserKey>>,
}

impl KeyringTokenStore {
    pub fn new() -> Self {
        Self::with_backend(Arc::new(KeyringBackend))
    }

    pub fn with_backend(backend: Arc<dyn SecretBackend>) -> Self {
        Self {
            backend,
            cache: RwLock::new(HashMap::new()),
            index: RwLock::new(Vec::new()),
        }
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
        self.backend.write(&account_for(key), token)?;
        self.cache
            .write()
            .unwrap()
            .insert(key.clone(), Some(token.to_string()));
        let mut idx = self.index.write().unwrap();
        if !idx.contains(key) {
            idx.push(key.clone());
        }
        Ok(())
    }

    fn get(&self, key: &BrowserKey) -> Result<Option<String>, String> {
        if let Some(cached) = self.cache.read().unwrap().get(key) {
            return Ok(cached.clone());
        }
        let value = self.backend.read(&account_for(key))?;
        self.cache
            .write()
            .unwrap()
            .insert(key.clone(), value.clone());
        Ok(value)
    }

    fn delete(&self, key: &BrowserKey) -> Result<(), String> {
        self.backend.remove(&account_for(key))?;
        // Mark as known-absent rather than evicting, so a follow-up `get` is
        // still served from cache instead of re-probing the backend.
        self.cache.write().unwrap().insert(key.clone(), None);
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
        self.inner
            .write()
            .unwrap()
            .insert(key.clone(), token.to_string());
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    fn key() -> BrowserKey {
        BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        }
    }

    /// Fake backend that records how many times each operation was called, so
    /// tests can prove the cache shields the keychain on the hot path.
    #[derive(Default)]
    struct CountingBackend {
        store: Mutex<HashMap<String, String>>,
        reads: AtomicUsize,
        writes: AtomicUsize,
        removes: AtomicUsize,
    }
    impl CountingBackend {
        fn reads(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }
    }
    impl SecretBackend for CountingBackend {
        fn read(&self, account: &str) -> Result<Option<String>, String> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            Ok(self.store.lock().unwrap().get(account).cloned())
        }
        fn write(&self, account: &str, secret: &str) -> Result<(), String> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            self.store
                .lock()
                .unwrap()
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }
        fn remove(&self, account: &str) -> Result<(), String> {
            self.removes.fetch_add(1, Ordering::SeqCst);
            self.store.lock().unwrap().remove(account);
            Ok(())
        }
    }

    #[test]
    fn repeated_get_hits_backend_only_once() {
        let backend = Arc::new(CountingBackend::default());
        backend.write(&account_for(&key()), "tok").unwrap();
        let store = KeyringTokenStore::with_backend(backend.clone());

        // Backend read count before the first get (write doesn't read).
        let base = backend.reads();
        for _ in 0..10 {
            assert_eq!(store.get(&key()).unwrap(), Some("tok".to_string()));
        }
        assert_eq!(
            backend.reads() - base,
            1,
            "10 gets must touch the backend exactly once"
        );
    }

    #[test]
    fn repeated_get_of_unpaired_key_hits_backend_only_once() {
        let backend = Arc::new(CountingBackend::default());
        let store = KeyringTokenStore::with_backend(backend.clone());
        for _ in 0..10 {
            assert_eq!(store.get(&key()).unwrap(), None);
        }
        assert_eq!(
            backend.reads(),
            1,
            "a looping unpaired client must not re-probe the backend"
        );
    }

    #[test]
    fn set_populates_cache_so_get_needs_no_read() {
        let backend = Arc::new(CountingBackend::default());
        let store = KeyringTokenStore::with_backend(backend.clone());
        store.set(&key(), "tok").unwrap();
        let before = backend.reads();
        assert_eq!(store.get(&key()).unwrap(), Some("tok".to_string()));
        assert_eq!(
            backend.reads(),
            before,
            "get after set must not read backend"
        );
    }

    #[test]
    fn delete_caches_absence_so_get_needs_no_read() {
        let backend = Arc::new(CountingBackend::default());
        let store = KeyringTokenStore::with_backend(backend.clone());
        store.set(&key(), "tok").unwrap();
        store.delete(&key()).unwrap();
        let before = backend.reads();
        assert_eq!(store.get(&key()).unwrap(), None);
        assert_eq!(
            backend.reads(),
            before,
            "get after delete must be served from cache"
        );
    }

    #[test]
    fn set_then_delete_updates_paired_list() {
        let backend = Arc::new(CountingBackend::default());
        let store = KeyringTokenStore::with_backend(backend);
        store.set(&key(), "tok").unwrap();
        assert_eq!(store.list_paired().unwrap(), vec![key()]);
        store.delete(&key()).unwrap();
        assert!(store.list_paired().unwrap().is_empty());
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
        let k1 = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        let k2 = BrowserKey {
            family: BrowserFamily::Firefox,
            variant: "firefox".to_string(),
        };
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
        assert!(token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    }
}
