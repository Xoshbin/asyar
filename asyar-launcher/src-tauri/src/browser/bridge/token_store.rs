use crate::browser::types::{BrowserFamily, BrowserKey};
use crate::crypto::cipher;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

pub(crate) const KEYRING_SERVICE: &str = "asyar-browser-bridge";

/// The durable secret backend behind [`KeyringTokenStore`]. Abstracted so the
/// caching layer can be tested without touching the real OS keychain.
pub trait SecretBackend: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, String>;
    fn write(&self, account: &str, secret: &str) -> Result<(), String>;
    fn remove(&self, account: &str) -> Result<(), String>;
}

/// Legacy OS-keychain backend via `keyring` (`asyar-browser-bridge` service).
/// Kept for one-time migration into [`EncryptedFileBackend`] in release builds
/// and factory-reset cleanup.
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

/// Filename inside `app_data_dir` for encrypted browser bridge tokens.
pub const ENCRYPTED_TOKENS_FILENAME: &str = "browser-bridge-tokens.enc";

/// Primary secret backend: stores all browser bridge tokens in a single file
/// encrypted under the app's 32-byte master key (`AES-256-GCM`).
///
/// This avoids creating separate OS Keychain items per browser under
/// `"asyar-browser-bridge"` and eliminates Keychain password prompts in dev
/// builds.
pub struct EncryptedFileBackend {
    path: PathBuf,
    master_key: [u8; 32],
    state: Mutex<Option<HashMap<String, String>>>,
}

impl EncryptedFileBackend {
    pub fn new(path: PathBuf, master_key: [u8; 32]) -> Self {
        Self {
            path,
            master_key,
            state: Mutex::new(None),
        }
    }

    fn load_map_locked(&self, guard: &mut Option<HashMap<String, String>>) -> Result<(), String> {
        if guard.is_some() {
            return Ok(());
        }
        let map = match std::fs::read_to_string(&self.path) {
            Ok(contents) => {
                let json = cipher::decrypt(contents.trim(), &self.master_key)
                    .map_err(|e| format!("decrypt browser bridge tokens: {e}"))?;
                serde_json::from_str::<HashMap<String, String>>(&json)
                    .map_err(|e| format!("parse browser bridge tokens: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(e) => return Err(format!("read browser bridge tokens: {e}")),
        };
        *guard = Some(map);
        Ok(())
    }

    fn persist_map(&self, map: &HashMap<String, String>) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create browser bridge tokens dir: {e}"))?;
        }
        let json = serde_json::to_string(map)
            .map_err(|e| format!("serialize browser bridge tokens: {e}"))?;
        let encrypted = cipher::encrypt(&json, &self.master_key)
            .map_err(|e| format!("encrypt browser bridge tokens: {e}"))?;
        write_restrictive(&self.path, &encrypted)
    }

    /// One-time migration from the legacy per-browser OS keychain entries into
    /// this encrypted file. Runs only when `self.path` does not exist yet on
    /// disk, and persists the file afterwards so it never probes the legacy
    /// backend a second time.
    pub fn migrate_from_legacy(&self, legacy: &dyn SecretBackend) {
        if self.path.exists() {
            return;
        }
        let mut migrated = HashMap::new();
        for key in all_known_browser_keys() {
            let account = account_for(&key);
            match legacy.read(&account) {
                Ok(Some(token)) => {
                    migrated.insert(account.clone(), token);
                    if let Err(e) = legacy.remove(&account) {
                        log::warn!(
                            "[browser] failed to remove legacy keychain token for {account}: {e}"
                        );
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    log::warn!(
                        "[browser] failed to read legacy keychain token for {account} during migration: {e}"
                    );
                }
            }
        }
        if let Err(e) = self.persist_map(&migrated) {
            log::warn!("[browser] failed to persist migrated bridge tokens: {e}");
            return;
        }
        *self.state.lock().unwrap() = Some(migrated);
    }
}

impl SecretBackend for EncryptedFileBackend {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        let mut guard = self.state.lock().unwrap();
        self.load_map_locked(&mut guard)?;
        Ok(guard.as_ref().and_then(|m| m.get(account).cloned()))
    }

    fn write(&self, account: &str, secret: &str) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        self.load_map_locked(&mut guard)?;
        let map = guard.as_mut().expect("loaded above");
        map.insert(account.to_string(), secret.to_string());
        self.persist_map(map)
    }

    fn remove(&self, account: &str) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        self.load_map_locked(&mut guard)?;
        let map = guard.as_mut().expect("loaded above");
        if map.remove(account).is_some() {
            self.persist_map(map)?;
        }
        Ok(())
    }
}

fn write_restrictive(path: &Path, contents: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| format!("open browser bridge tokens file: {e}"))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("write browser bridge tokens file: {e}"))?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, contents).map_err(|e| format!("write browser bridge tokens file: {e}"))
    }
}

fn all_known_browser_keys() -> Vec<BrowserKey> {
    let mut known_keys = Vec::new();
    for variant in crate::browser::paths::chromium_variants() {
        known_keys.push(BrowserKey {
            family: BrowserFamily::Chromium,
            variant: variant.id.to_string(),
        });
    }
    for variant in crate::browser::paths::firefox_variants() {
        known_keys.push(BrowserKey {
            family: BrowserFamily::Firefox,
            variant: variant.id.to_string(),
        });
    }
    known_keys.push(BrowserKey {
        family: BrowserFamily::Safari,
        variant: "safari".to_string(),
    });
    known_keys
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

    pub fn load_paired_from_backend(&self) {
        let mut paired = Vec::new();
        let mut cache_updates = Vec::new();
        for key in all_known_browser_keys() {
            let account = account_for(&key);
            match self.backend.read(&account) {
                Ok(Some(token)) => {
                    cache_updates.push((key.clone(), Some(token)));
                    paired.push(key);
                }
                Ok(None) => {
                    cache_updates.push((key, None));
                }
                Err(e) => {
                    // Cache as absent so a denied/unreadable backend doesn't
                    // get re-probed on every incoming /bridge reconnect.
                    log::warn!("[browser] failed to read bridge token for {account}: {e}");
                    cache_updates.push((key, None));
                }
            }
        }

        if !cache_updates.is_empty() {
            let mut cache = self.cache.write().unwrap();
            for (key, val) in cache_updates {
                cache.insert(key, val);
            }
        }

        *self.index.write().unwrap() = paired;
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
        let account = account_for(key);
        let value = match self.backend.read(&account) {
            Ok(v) => v,
            Err(e) => {
                // Cache as absent so a denied keychain prompt or transient
                // backend failure doesn't re-trigger on every reconnect.
                log::warn!("[browser] failed to read bridge token for {account}: {e}");
                self.cache.write().unwrap().insert(key.clone(), None);
                return Err(e);
            }
        };
        self.cache
            .write()
            .unwrap()
            .insert(key.clone(), value.clone());
        if value.is_some() {
            let mut idx = self.index.write().unwrap();
            if !idx.contains(key) {
                idx.push(key.clone());
            }
        }
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

    #[test]
    fn load_paired_from_backend_populates_index() {
        let backend = Arc::new(CountingBackend::default());
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        backend.write(&account_for(&key), "tok").unwrap();

        let store = KeyringTokenStore::with_backend(backend);
        assert!(store.list_paired().unwrap().is_empty());

        store.load_paired_from_backend();
        assert_eq!(store.list_paired().unwrap(), vec![key]);
    }

    /// Fake backend that fails every `read` with an error (simulating OS
    /// keychain denial / "Deny" click) and counts how many times `read` ran.
    #[derive(Default)]
    struct FailingReadBackend {
        reads: AtomicUsize,
    }
    impl SecretBackend for FailingReadBackend {
        fn read(&self, _account: &str) -> Result<Option<String>, String> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            Err("user denied keychain access".to_string())
        }
        fn write(&self, _account: &str, _secret: &str) -> Result<(), String> {
            Ok(())
        }
        fn remove(&self, _account: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn failed_backend_read_is_cached_so_get_does_not_loop() {
        let backend = Arc::new(FailingReadBackend::default());
        let store = KeyringTokenStore::with_backend(backend.clone());

        assert!(store.get(&key()).is_err());
        for _ in 0..10 {
            assert_eq!(store.get(&key()).unwrap(), None);
        }
        assert_eq!(
            backend.reads.load(Ordering::SeqCst),
            1,
            "a denied keychain read must not be retried on every reconnect"
        );
    }

    #[test]
    fn load_paired_from_backend_caches_unpaired_and_error_keys() {
        let backend = Arc::new(FailingReadBackend::default());
        let store = KeyringTokenStore::with_backend(backend.clone());

        store.load_paired_from_backend();
        let reads_after_boot = backend.reads.load(Ordering::SeqCst);
        assert!(reads_after_boot > 0);

        assert_eq!(store.get(&key()).unwrap(), None);
        assert_eq!(
            backend.reads.load(Ordering::SeqCst),
            reads_after_boot,
            "get after load_paired_from_backend must not re-probe failed keys"
        );
    }

    #[test]
    fn encrypted_file_backend_roundtrips_and_encrypts_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(ENCRYPTED_TOKENS_FILENAME);
        let key_bytes = [42u8; 32];

        let backend = EncryptedFileBackend::new(path.clone(), key_bytes);
        backend.write("chromium:chrome", "secret-tok-1").unwrap();
        backend.write("firefox:firefox", "secret-tok-2").unwrap();

        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.starts_with(cipher::VERSION_PREFIX));
        assert!(!raw.contains("secret-tok-1"));
        assert!(!raw.contains("chromium:chrome"));

        // Fresh instance with same key reads both back.
        let reloaded = EncryptedFileBackend::new(path.clone(), key_bytes);
        assert_eq!(
            reloaded.read("chromium:chrome").unwrap(),
            Some("secret-tok-1".to_string())
        );
        assert_eq!(
            reloaded.read("firefox:firefox").unwrap(),
            Some("secret-tok-2".to_string())
        );
        reloaded.remove("chromium:chrome").unwrap();

        let reloaded_after_delete = EncryptedFileBackend::new(path.clone(), key_bytes);
        assert_eq!(reloaded_after_delete.read("chromium:chrome").unwrap(), None);
        assert_eq!(
            reloaded_after_delete.read("firefox:firefox").unwrap(),
            Some("secret-tok-2".to_string())
        );

        // Wrong master key fails decryption.
        let wrong = EncryptedFileBackend::new(path, [99u8; 32]);
        assert!(wrong.read("firefox:firefox").is_err());
    }

    #[test]
    fn migrate_from_legacy_runs_once_and_cleans_up_legacy_backend() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(ENCRYPTED_TOKENS_FILENAME);
        let legacy = CountingBackend::default();
        legacy.write("chromium:chrome", "legacy-tok").unwrap();

        let encrypted = EncryptedFileBackend::new(path.clone(), [7u8; 32]);
        encrypted.migrate_from_legacy(&legacy);

        assert!(path.exists());
        assert_eq!(
            encrypted.read("chromium:chrome").unwrap(),
            Some("legacy-tok".to_string())
        );
        assert_eq!(legacy.read("chromium:chrome").unwrap(), None);

        // Second call must not probe the legacy backend again.
        let reads_before = legacy.reads();
        encrypted.migrate_from_legacy(&legacy);
        assert_eq!(legacy.reads(), reads_before);
    }
}
