//! Master-key lifecycle for at-rest encryption.
//!
//! The master key is 32 random bytes generated on first launch and
//! stored in the OS keychain (Keychain Services on macOS, Credential
//! Manager on Windows, Secret Service on Linux). On subsequent launches
//! it's loaded from the same place. The key is held in memory wrapped
//! in `Zeroizing<[u8; 32]>` so it is zeroed when the process exits or
//! the state is dropped.
//!
//! Linux degrades to a file-backed keystore (`0600` permissions) when
//! Secret Service is unavailable — see the spec for the rationale.

use crate::error::AppError;
use base64::Engine;
use rand::RngExt;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use zeroize::Zeroizing;

/// Service identifier under which the OS keychain entry lives. The
/// account name is versioned (`data-encryption-v1`) so a future key
/// rotation can use a separate identifier without colliding with the
/// current one.
pub const KEYCHAIN_SERVICE: &str = "org.asyar.app";
pub const KEYCHAIN_ACCOUNT: &str = "data-encryption-v1";

/// Filename used by the Linux file-backed fallback.
pub const FALLBACK_FILENAME: &str = "keystore-v1.dat";

/// Where the master key actually lives. The trait exists so the rest of
/// the codebase can be unit-tested against an in-memory fake without
/// touching the real keychain.
pub trait KeyStore: Send + Sync {
    /// Load the existing key, or generate + store a new one if absent.
    /// The returned bytes are wrapped in `Zeroizing` so the caller
    /// cannot accidentally leak them through `Debug` or `Drop`.
    fn load_or_create(&self) -> Result<Zeroizing<[u8; 32]>, AppError>;

    /// True if this keystore is the OS-backed primary; false when the
    /// caller is on the Linux file-backed fallback. Surfaced to the
    /// privacy UI so users can see when they're in the degraded mode.
    fn is_os_backed(&self) -> bool;

    /// Read raw bytes from the named slot. Returns `Ok(None)` if the slot
    /// doesn't exist. The returned bytes are wrapped in `Zeroizing` so the
    /// caller cannot accidentally leak them through `Debug` or `Drop`.
    fn read_slot(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, AppError>;

    /// Write raw bytes to the named slot, replacing any existing value.
    fn write_slot(&self, account: &str, value: &[u8]) -> Result<(), AppError>;

    /// Delete the named slot. Idempotent: returns `Ok(())` whether or not
    /// the slot existed.
    fn delete_slot(&self, account: &str) -> Result<(), AppError>;
}

/// Test-only in-memory keystore. Generates a fresh key on first call
/// and returns the same bytes on subsequent calls.
///
/// Stored bytes are not zeroized until overwritten or the map is
/// dropped; do not use this type outside tests.
pub struct InMemoryKeyStore {
    cached: Mutex<Option<[u8; 32]>>,
    slots: Mutex<HashMap<String, Vec<u8>>>,
}

impl InMemoryKeyStore {
    pub fn new() -> Self {
        Self {
            cached: Mutex::new(None),
            slots: Mutex::new(HashMap::new()),
        }
    }

    /// Construct with a pre-set key — useful for migration tests where
    /// the legacy and new keystores need to use specific bytes.
    pub fn with_key(key: [u8; 32]) -> Self {
        Self {
            cached: Mutex::new(Some(key)),
            slots: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for InMemoryKeyStore {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyStore for InMemoryKeyStore {
    fn load_or_create(&self) -> Result<Zeroizing<[u8; 32]>, AppError> {
        let mut guard = self.cached.lock().map_err(|_| AppError::Lock)?;
        if let Some(k) = *guard {
            return Ok(Zeroizing::new(k));
        }
        let mut k = [0u8; 32];
        rand::rng().fill(&mut k[..]);
        *guard = Some(k);
        Ok(Zeroizing::new(k))
    }

    fn is_os_backed(&self) -> bool {
        false
    }

    fn read_slot(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, AppError> {
        let slots = self.slots.lock().map_err(|_| AppError::Lock)?;
        Ok(slots.get(account).cloned().map(Zeroizing::new))
    }

    fn write_slot(&self, account: &str, value: &[u8]) -> Result<(), AppError> {
        let mut slots = self.slots.lock().map_err(|_| AppError::Lock)?;
        slots.insert(account.to_string(), value.to_vec());
        Ok(())
    }

    fn delete_slot(&self, account: &str) -> Result<(), AppError> {
        let mut slots = self.slots.lock().map_err(|_| AppError::Lock)?;
        slots.remove(account);
        Ok(())
    }
}

/// OS keychain–backed keystore via the `keyring` crate. On macOS this
/// wraps Keychain Services, on Windows it wraps Credential Manager, on
/// Linux it wraps the freedesktop Secret Service.
pub struct OsKeyStore {
    service: &'static str,
    account: &'static str,
}

impl OsKeyStore {
    pub fn new() -> Self {
        Self {
            service: KEYCHAIN_SERVICE,
            account: KEYCHAIN_ACCOUNT,
        }
    }
}

impl Default for OsKeyStore {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyStore for OsKeyStore {
    fn load_or_create(&self) -> Result<Zeroizing<[u8; 32]>, AppError> {
        let entry = keyring::Entry::new(self.service, self.account).map_err(|e| {
            AppError::Encryption(format!("keychain entry construction failed: {e}"))
        })?;

        match entry.get_password() {
            Ok(b64) => decode_key(&b64),
            Err(keyring::Error::NoEntry) => {
                let mut k = [0u8; 32];
                rand::rng().fill(&mut k[..]);
                let encoded = encode_key(&k);
                entry.set_password(&encoded).map_err(|e| {
                    AppError::Encryption(format!("keychain write failed: {e}"))
                })?;
                Ok(Zeroizing::new(k))
            }
            Err(e) => Err(AppError::Encryption(format!("keychain read failed: {e}"))),
        }
    }

    fn is_os_backed(&self) -> bool {
        true
    }

    fn read_slot(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, AppError> {
        let entry = keyring::Entry::new(self.service, account).map_err(|e| {
            AppError::Encryption(format!("keychain entry construction failed: {e}"))
        })?;
        match entry.get_password() {
            Ok(b64) => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64.trim())
                    .map_err(|e| {
                        AppError::Encryption(format!("keychain base64 decode: {e}"))
                    })?;
                Ok(Some(Zeroizing::new(bytes)))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Encryption(format!("keychain read failed: {e}"))),
        }
    }

    fn write_slot(&self, account: &str, value: &[u8]) -> Result<(), AppError> {
        let entry = keyring::Entry::new(self.service, account).map_err(|e| {
            AppError::Encryption(format!("keychain entry construction failed: {e}"))
        })?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(value);
        entry
            .set_password(&encoded)
            .map_err(|e| AppError::Encryption(format!("keychain write failed: {e}")))
    }

    fn delete_slot(&self, account: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(self.service, account).map_err(|e| {
            AppError::Encryption(format!("keychain entry construction failed: {e}"))
        })?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // idempotent
            Err(e) => Err(AppError::Encryption(format!(
                "keychain delete failed: {e}"
            ))),
        }
    }
}

/// Linux fallback when Secret Service is not available. Stores the key
/// as base64 in a file with `0600` permissions inside `appDataDir`.
pub struct FileKeyStore {
    path: PathBuf,
}

impl FileKeyStore {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            path: app_data_dir.join(FALLBACK_FILENAME),
        }
    }

    /// For tests: bypass the appDataDir layout.
    pub fn at_path(path: PathBuf) -> Self {
        Self { path }
    }

    /// Returns the on-disk path for a multi-slot value.
    ///
    /// Sanitizes `account` to a filesystem-safe filename by replacing every
    /// character outside `[a-zA-Z0-9\-_]` with `_`. Two account names that
    /// differ only in disallowed characters collide on disk (e.g. `a.b` and
    /// `a_b` both produce `keystore-slot-a_b.dat`); callers must use disjoint
    /// sanitized names. The launcher's actual slots (`data-encryption-v1`,
    /// `sync-master-seed-v1`) are pure ASCII and don't risk collision.
    fn slot_path(&self, account: &str) -> PathBuf {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        let safe_account = account
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect::<String>();
        parent.join(format!("keystore-slot-{safe_account}.dat"))
    }
}

impl KeyStore for FileKeyStore {
    fn load_or_create(&self) -> Result<Zeroizing<[u8; 32]>, AppError> {
        if self.path.exists() {
            let contents = std::fs::read_to_string(&self.path)
                .map_err(|e| AppError::Encryption(format!("keystore file read: {e}")))?;
            return decode_key(contents.trim());
        }

        // Ensure parent dir exists.
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Encryption(format!("keystore dir create: {e}")))?;
        }

        let mut k = [0u8; 32];
        rand::rng().fill(&mut k[..]);
        let encoded = encode_key(&k);

        write_with_restrictive_permissions(&self.path, &encoded)?;

        Ok(Zeroizing::new(k))
    }

    fn is_os_backed(&self) -> bool {
        false
    }

    fn read_slot(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, AppError> {
        let path = self.slot_path(account);
        let contents = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(AppError::Encryption(format!("keystore slot read: {e}"))),
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(contents.trim())
            .map_err(|e| AppError::Encryption(format!("keystore slot decode: {e}")))?;
        Ok(Some(Zeroizing::new(bytes)))
    }

    fn write_slot(&self, account: &str, value: &[u8]) -> Result<(), AppError> {
        let path = self.slot_path(account);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Encryption(format!("keystore dir create: {e}")))?;
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(value);
        write_with_restrictive_permissions(&path, &encoded)
    }

    fn delete_slot(&self, account: &str) -> Result<(), AppError> {
        let path = self.slot_path(account);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::Encryption(format!("keystore slot delete: {e}"))),
        }
    }
}

#[cfg(unix)]
fn write_with_restrictive_permissions(path: &Path, contents: &str) -> Result<(), AppError> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| AppError::Encryption(format!("keystore file open: {e}")))?;
    f.write_all(contents.as_bytes())
        .map_err(|e| AppError::Encryption(format!("keystore file write: {e}")))?;
    Ok(())
}

#[cfg(not(unix))]
fn write_with_restrictive_permissions(path: &Path, contents: &str) -> Result<(), AppError> {
    // On Windows the file inherits the user-profile ACL which is already
    // user-private; no extra mode bits to set.
    std::fs::write(path, contents)
        .map_err(|e| AppError::Encryption(format!("keystore file write: {e}")))
}

fn encode_key(key: &[u8; 32]) -> String {
    base64::engine::general_purpose::STANDARD.encode(key)
}

fn decode_key(encoded: &str) -> Result<Zeroizing<[u8; 32]>, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| AppError::Encryption(format!("keystore base64 decode: {e}")))?;
    if bytes.len() != 32 {
        return Err(AppError::Encryption(format!(
            "expected 32-byte key, got {}",
            bytes.len()
        )));
    }
    let mut k = [0u8; 32];
    k.copy_from_slice(&bytes);
    Ok(Zeroizing::new(k))
}

/// Tauri-managed state holding the resolved master key for the session.
pub struct KeystoreState {
    master_key: Zeroizing<[u8; 32]>,
    is_os_backed: bool,
}

impl KeystoreState {
    pub fn from_keystore(store: &dyn KeyStore) -> Result<Self, AppError> {
        let key = store.load_or_create()?;
        Ok(Self {
            master_key: key,
            is_os_backed: store.is_os_backed(),
        })
    }

    pub fn master_key(&self) -> &[u8; 32] {
        &self.master_key
    }

    pub fn is_os_backed(&self) -> bool {
        self.is_os_backed
    }
}

/// Decide which keystore to use on the current platform. macOS and
/// Windows always use the OS-backed primary. Linux tries the OS-backed
/// keystore first; on a `NoStorageAccess` / `PlatformFailure` error it
/// falls back to the file-backed keystore inside `app_data_dir`.
pub fn select_keystore(app_data_dir: &Path) -> Box<dyn KeyStore> {
    let os_store = OsKeyStore::new();

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let _ = app_data_dir; // unused on macOS/Windows
        Box::new(os_store)
    }

    #[cfg(target_os = "linux")]
    {
        // Probe the OS keystore by attempting a load. If the probe
        // fails with a "no storage access" or platform-failure
        // diagnostic, we treat it as Secret Service unavailable and
        // fall back. Any other error (e.g. transient I/O) propagates
        // by way of the OS keystore being chosen — startup will
        // surface it through `KeystoreState::from_keystore`.
        match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .and_then(|e| match e.get_password() {
                Ok(_) => Ok(()),
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(other) => Err(other),
            })
        {
            Ok(_) => Box::new(os_store),
            Err(keyring::Error::NoStorageAccess(_))
            | Err(keyring::Error::PlatformFailure(_)) => {
                log::warn!(
                    "Secret Service unavailable; falling back to file-backed keystore. \
                     Install gnome-keyring or KWallet for full at-rest protection."
                );
                Box::new(FileKeyStore::new(app_data_dir))
            }
            Err(_) => Box::new(os_store),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = app_data_dir;
        Box::new(os_store)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_first_call_generates_then_stable() {
        let store = InMemoryKeyStore::new();
        let k1 = store.load_or_create().unwrap();
        let k2 = store.load_or_create().unwrap();
        assert_eq!(*k1, *k2);
    }

    #[test]
    fn in_memory_with_key_returns_provided_bytes() {
        let mut bytes = [0u8; 32];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = i as u8;
        }
        let store = InMemoryKeyStore::with_key(bytes);
        assert_eq!(*store.load_or_create().unwrap(), bytes);
    }

    #[test]
    fn in_memory_is_not_os_backed() {
        assert!(!InMemoryKeyStore::new().is_os_backed());
    }

    #[test]
    fn file_keystore_roundtrips_via_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        let k1 = store.load_or_create().unwrap();
        let k2 = store.load_or_create().unwrap();
        assert_eq!(*k1, *k2);
    }

    #[cfg(unix)]
    #[test]
    fn file_keystore_writes_with_0600_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        let _ = store.load_or_create().unwrap();
        let path = dir.path().join(FALLBACK_FILENAME);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn file_keystore_is_not_os_backed() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!FileKeyStore::new(dir.path()).is_os_backed());
    }

    #[test]
    fn keystore_state_pulls_key_and_flag() {
        let store = InMemoryKeyStore::new();
        let state = KeystoreState::from_keystore(&store).unwrap();
        assert!(!state.is_os_backed());
        assert_eq!(state.master_key().len(), 32);
    }

    #[test]
    fn encode_decode_round_trip() {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i * 7) as u8;
        }
        let enc = encode_key(&k);
        let dec = decode_key(&enc).unwrap();
        assert_eq!(*dec, k);
    }

    #[test]
    fn decode_rejects_wrong_length() {
        let bad = base64::engine::general_purpose::STANDARD.encode([0u8; 16]);
        assert!(decode_key(&bad).is_err());
    }

    #[test]
    fn decode_rejects_malformed_base64() {
        assert!(decode_key("!!!not-base64!!!").is_err());
    }

    #[test]
    fn os_keystore_reports_os_backed() {
        // Constructor doesn't touch the OS yet — the flag is static.
        assert!(OsKeyStore::new().is_os_backed());
    }

    #[test]
    #[ignore = "interacts with the user's real OS keychain; run manually with --ignored"]
    fn os_keystore_round_trips_via_real_keychain() {
        let store = OsKeyStore::new();
        let k1 = store.load_or_create().unwrap();
        let k2 = store.load_or_create().unwrap();
        assert_eq!(*k1, *k2);
    }

    // --- InMemoryKeyStore multi-slot tests ---

    #[test]
    fn in_memory_read_slot_returns_none_when_absent() {
        let store = InMemoryKeyStore::new();
        assert!(store.read_slot("e2ee").unwrap().is_none());
    }

    #[test]
    fn in_memory_write_then_read_slot_roundtrips() {
        let store = InMemoryKeyStore::new();
        let payload = vec![1, 2, 3, 4];
        store.write_slot("e2ee", &payload).unwrap();
        let got = store.read_slot("e2ee").unwrap().unwrap();
        assert_eq!(*got, payload);
    }

    #[test]
    fn in_memory_write_replaces_existing() {
        let store = InMemoryKeyStore::new();
        store.write_slot("e2ee", &[1, 2, 3]).unwrap();
        store.write_slot("e2ee", &[9, 9, 9]).unwrap();
        let got = store.read_slot("e2ee").unwrap().unwrap();
        assert_eq!(*got, vec![9, 9, 9]);
    }

    #[test]
    fn in_memory_slots_are_independent() {
        let store = InMemoryKeyStore::new();
        store.write_slot("a", &[1]).unwrap();
        store.write_slot("b", &[2]).unwrap();
        assert_eq!(*store.read_slot("a").unwrap().unwrap(), vec![1]);
        assert_eq!(*store.read_slot("b").unwrap().unwrap(), vec![2]);
    }

    #[test]
    fn in_memory_delete_slot_is_idempotent() {
        let store = InMemoryKeyStore::new();
        store.delete_slot("nonexistent").unwrap(); // first call — slot was never written
        store.write_slot("e2ee", &[1, 2, 3]).unwrap();
        store.delete_slot("e2ee").unwrap();
        assert!(store.read_slot("e2ee").unwrap().is_none());
        store.delete_slot("e2ee").unwrap(); // second call — slot already gone
    }

    #[test]
    fn in_memory_load_or_create_does_not_clobber_slots() {
        // Verify that the existing single-slot API doesn't overwrite the new
        // multi-slot HashMap (and vice versa).
        let store = InMemoryKeyStore::new();
        store.write_slot("e2ee", &[42, 42, 42]).unwrap();
        let _master = store.load_or_create().unwrap();
        assert_eq!(*store.read_slot("e2ee").unwrap().unwrap(), vec![42, 42, 42]);
    }

    #[test]
    fn in_memory_empty_bytes_round_trip() {
        let store = InMemoryKeyStore::new();
        store.write_slot("e2ee", &[]).unwrap();
        let got = store.read_slot("e2ee").unwrap().unwrap();
        assert_eq!(*got, Vec::<u8>::new());
    }

    // --- FileKeyStore multi-slot tests ---

    #[test]
    fn file_keystore_read_slot_returns_none_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        assert!(store.read_slot("e2ee").unwrap().is_none());
    }

    #[test]
    fn file_keystore_write_then_read_slot_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        let payload = vec![0xab, 0xcd, 0xef];
        store.write_slot("e2ee", &payload).unwrap();
        let got = store.read_slot("e2ee").unwrap().unwrap();
        assert_eq!(*got, payload);
    }

    #[test]
    fn file_keystore_slots_are_independent_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        store.write_slot("a", &[1]).unwrap();
        store.write_slot("b", &[2]).unwrap();
        assert_eq!(*store.read_slot("a").unwrap().unwrap(), vec![1]);
        assert_eq!(*store.read_slot("b").unwrap().unwrap(), vec![2]);
        // Confirm two distinct files exist.
        assert!(dir.path().join("keystore-slot-a.dat").exists());
        assert!(dir.path().join("keystore-slot-b.dat").exists());
    }

    #[test]
    fn file_keystore_delete_slot_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        store.delete_slot("nonexistent").unwrap();
        store.write_slot("e2ee", &[1, 2, 3]).unwrap();
        store.delete_slot("e2ee").unwrap();
        assert!(store.read_slot("e2ee").unwrap().is_none());
        store.delete_slot("e2ee").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn file_keystore_slot_file_has_0600_perms() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        store.write_slot("e2ee", &[1, 2, 3]).unwrap();
        let path = dir.path().join("keystore-slot-e2ee.dat");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "slot file must be 0600");
    }

    #[test]
    fn file_keystore_load_or_create_does_not_collide_with_slots() {
        // The existing single-slot API uses `keystore-v1.dat`; the new
        // multi-slot API uses `keystore-slot-<account>.dat`. Different
        // filenames, no collision.
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        let _master = store.load_or_create().unwrap();
        store.write_slot("e2ee", &[42, 42]).unwrap();
        assert!(dir.path().join("keystore-v1.dat").exists());
        assert!(dir.path().join("keystore-slot-e2ee.dat").exists());
        assert_eq!(*store.read_slot("e2ee").unwrap().unwrap(), vec![42, 42]);
    }

    #[test]
    fn file_keystore_read_after_out_of_band_delete_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        store.write_slot("e2ee", &[1, 2, 3]).unwrap();
        // Simulate a concurrent process (or stale state) deleting the slot file
        // between the launcher's last write and its next read.
        let path = dir.path().join("keystore-slot-e2ee.dat");
        std::fs::remove_file(&path).unwrap();
        // read_slot must return Ok(None), not propagate the NotFound error.
        assert!(store.read_slot("e2ee").unwrap().is_none());
    }

    #[test]
    fn file_keystore_delete_after_out_of_band_delete_is_ok() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        store.write_slot("e2ee", &[1, 2, 3]).unwrap();
        let path = dir.path().join("keystore-slot-e2ee.dat");
        std::fs::remove_file(&path).unwrap();
        // delete_slot must still return Ok(()) — idempotent under concurrency.
        store.delete_slot("e2ee").unwrap();
    }

    #[test]
    fn file_keystore_empty_bytes_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path());
        store.write_slot("e2ee", &[]).unwrap();
        let got = store.read_slot("e2ee").unwrap().unwrap();
        assert_eq!(*got, Vec::<u8>::new());
    }

    // --- OsKeyStore multi-slot tests (ignored — requires live OS keychain) ---

    #[test]
    #[ignore = "interacts with the user's real OS keychain; run manually with --ignored"]
    fn os_keystore_slot_round_trip() {
        let store = OsKeyStore::new();
        let test_account = "test-slot-multislot-roundtrip";
        // Cleanup any prior leftovers.
        let _ = store.delete_slot(test_account);
        store.write_slot(test_account, &[1, 2, 3, 4]).unwrap();
        let got = store.read_slot(test_account).unwrap().unwrap();
        assert_eq!(*got, vec![1, 2, 3, 4]);
        store.delete_slot(test_account).unwrap();
        assert!(store.read_slot(test_account).unwrap().is_none());
    }
}
