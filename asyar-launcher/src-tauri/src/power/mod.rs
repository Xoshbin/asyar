//! Power-inhibitor service.
//!
//! Platform-neutral registry + backend trait. Per-platform backends live in
//! sibling modules (`macos`, `linux`, `windows`) and implement [`PowerBackend`].
//!
//! Tokens are opaque UUIDs owned by the [`PowerRegistry`] (Tauri managed
//! state), so OS resources survive iframe teardown.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "windows")]
pub mod windows;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KeepAwakeOptions {
    pub system: Option<bool>,
    pub display: Option<bool>,
    pub disk: Option<bool>,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedOptions {
    pub system: bool,
    pub display: bool,
    pub disk: bool,
}

impl ResolvedOptions {
    pub fn from(opts: &KeepAwakeOptions) -> Self {
        Self {
            system: opts.system.unwrap_or(true),
            display: opts.display.unwrap_or(false),
            disk: opts.disk.unwrap_or(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActiveInhibitor {
    pub token: String,
    pub options: ResolvedOptions,
    pub reason: String,
    pub created_at: u64,
}

/// Implemented by each per-platform backend. The returned handle owns the OS
/// resource — its `Drop` impl releases it.
pub trait PowerBackend: Send + Sync {
    fn inhibit(
        &self,
        token: &str,
        options: ResolvedOptions,
        reason: &str,
    ) -> Result<Box<dyn PowerHandle>, AppError>;
}

/// Opaque, RAII handle to an OS-level inhibitor.
pub trait PowerHandle: Send + Sync {}

struct Entry {
    extension_id: Option<String>,
    options: ResolvedOptions,
    reason: String,
    created_at: u64,
    /// Held solely for its `Drop` impl — do not read.
    _handle: Box<dyn PowerHandle>,
}

pub struct PowerRegistry {
    entries: Mutex<HashMap<String, Entry>>,
    backend: Box<dyn PowerBackend>,
}

impl PowerRegistry {
    pub fn new(backend: Box<dyn PowerBackend>) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            backend,
        }
    }

    pub fn keep_awake(
        &self,
        extension_id: Option<String>,
        options: KeepAwakeOptions,
    ) -> Result<String, AppError> {
        let resolved = ResolvedOptions::from(&options);
        let token = uuid::Uuid::new_v4().to_string();
        let handle = self.backend.inhibit(&token, resolved, &options.reason)?;
        let entry = Entry {
            extension_id,
            options: resolved,
            reason: options.reason,
            created_at: now_secs(),
            _handle: handle,
        };
        self.entries
            .lock()
            .map_err(|_| AppError::Lock)?
            .insert(token.clone(), entry);
        Ok(token)
    }

    pub fn release(&self, token: &str) -> Result<(), AppError> {
        let mut guard = self.entries.lock().map_err(|_| AppError::Lock)?;
        if guard.remove(token).is_some() {
            Ok(())
        } else {
            Err(AppError::NotFound(format!(
                "power token \"{}\" is not active",
                token
            )))
        }
    }

    pub fn release_all_for_extension(&self, extension_id: &str) -> Result<usize, AppError> {
        let mut guard = self.entries.lock().map_err(|_| AppError::Lock)?;
        let tokens: Vec<String> = guard
            .iter()
            .filter_map(|(t, e)| {
                if e.extension_id.as_deref() == Some(extension_id) {
                    Some(t.clone())
                } else {
                    None
                }
            })
            .collect();
        let n = tokens.len();
        for t in tokens {
            guard.remove(&t);
        }
        Ok(n)
    }

    pub fn list(&self, extension_id: Option<&str>) -> Result<Vec<ActiveInhibitor>, AppError> {
        let guard = self.entries.lock().map_err(|_| AppError::Lock)?;
        let mut out: Vec<ActiveInhibitor> = guard
            .iter()
            .filter(|(_, e)| match extension_id {
                Some(want) => e.extension_id.as_deref() == Some(want),
                None => true,
            })
            .map(|(t, e)| ActiveInhibitor {
                token: t.clone(),
                options: e.options,
                reason: e.reason.clone(),
                created_at: e.created_at,
            })
            .collect();
        out.sort_by_key(|a| a.created_at);
        Ok(out)
    }
}

/// In-memory fake backend for tests and for platforms where the real backend
/// is not yet wired. Unconditionally compiled so `default_backend()` can fall
/// back to it during incremental integration.
pub mod fake {
    use super::*;
    use std::sync::Arc;

    #[derive(Default)]
    pub struct FakeState {
        pub active: Mutex<HashMap<String, ResolvedOptions>>,
    }

    #[derive(Clone, Default)]
    pub struct FakeBackend {
        pub state: Arc<FakeState>,
        pub fail_next: Arc<Mutex<bool>>,
    }

    impl FakeBackend {
        pub fn new() -> Self {
            Self {
                state: Arc::new(FakeState::default()),
                fail_next: Arc::new(Mutex::new(false)),
            }
        }

        pub fn active_count(&self) -> usize {
            self.state.active.lock().unwrap().len()
        }

        pub fn fail_next_inhibit(&self) {
            *self.fail_next.lock().unwrap() = true;
        }
    }

    struct FakeHandle {
        token: String,
        state: Arc<FakeState>,
    }

    impl PowerHandle for FakeHandle {}

    impl Drop for FakeHandle {
        fn drop(&mut self) {
            if let Ok(mut active) = self.state.active.lock() {
                active.remove(&self.token);
            }
        }
    }

    impl PowerBackend for FakeBackend {
        fn inhibit(
            &self,
            token: &str,
            options: ResolvedOptions,
            _reason: &str,
        ) -> Result<Box<dyn PowerHandle>, AppError> {
            let mut fail = self
                .fail_next
                .lock()
                .map_err(|_| AppError::Lock)?;
            if *fail {
                *fail = false;
                return Err(AppError::Power("fake failure".into()));
            }
            self.state
                .active
                .lock()
                .map_err(|_| AppError::Lock)?
                .insert(token.to_string(), options);
            Ok(Box::new(FakeHandle {
                token: token.to_string(),
                state: Arc::clone(&self.state),
            }))
        }
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Returns the default per-platform backend.
#[cfg(target_os = "macos")]
pub fn default_backend() -> Box<dyn PowerBackend> {
    Box::new(macos::MacPowerBackend::new())
}
#[cfg(target_os = "linux")]
pub fn default_backend() -> Box<dyn PowerBackend> {
    Box::new(linux::LinuxPowerBackend::new())
}
#[cfg(target_os = "windows")]
pub fn default_backend() -> Box<dyn PowerBackend> {
    Box::new(windows::WindowsPowerBackend::new())
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn default_backend() -> Box<dyn PowerBackend> {
    Box::new(fake::FakeBackend::new())
}

#[cfg(test)]
mod tests {
    use super::fake::FakeBackend;
    use super::*;

    fn make_registry() -> (PowerRegistry, FakeBackend) {
        let fake = FakeBackend::new();
        let reg = PowerRegistry::new(Box::new(fake.clone()));
        (reg, fake)
    }

    fn basic_opts() -> KeepAwakeOptions {
        KeepAwakeOptions {
            system: None,
            display: None,
            disk: None,
            reason: "test".into(),
        }
    }

    #[test]
    fn keep_awake_returns_uuid_and_activates_backend() {
        let (reg, fake) = make_registry();
        let token = reg
            .keep_awake(Some("ext-a".into()), basic_opts())
            .expect("keep_awake ok");
        assert!(uuid::Uuid::parse_str(&token).is_ok(), "token must be UUID");
        assert_eq!(fake.active_count(), 1);
    }

    #[test]
    fn resolved_options_defaults() {
        let (reg, fake) = make_registry();
        let _ = reg.keep_awake(Some("ext-a".into()), basic_opts()).unwrap();
        let snap = fake.state.active.lock().unwrap();
        let (_, opts) = snap.iter().next().unwrap();
        assert!(opts.system);
        assert!(!opts.display);
        assert!(!opts.disk);
    }

    #[test]
    fn release_removes_entry_and_drops_backend_handle() {
        let (reg, fake) = make_registry();
        let token = reg.keep_awake(Some("ext-a".into()), basic_opts()).unwrap();
        assert_eq!(fake.active_count(), 1);
        reg.release(&token).expect("release ok");
        assert_eq!(fake.active_count(), 0);
    }

    #[test]
    fn release_unknown_token_returns_err() {
        let (reg, _fake) = make_registry();
        let err = reg.release("not-a-real-token").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn release_all_for_extension_drops_only_that_extensions_tokens() {
        let (reg, fake) = make_registry();
        let _a1 = reg.keep_awake(Some("ext-a".into()), basic_opts()).unwrap();
        let _a2 = reg.keep_awake(Some("ext-a".into()), basic_opts()).unwrap();
        let _b1 = reg.keep_awake(Some("ext-b".into()), basic_opts()).unwrap();
        assert_eq!(fake.active_count(), 3);
        let dropped = reg.release_all_for_extension("ext-a").unwrap();
        assert_eq!(dropped, 2);
        assert_eq!(fake.active_count(), 1);
    }

    #[test]
    fn list_filters_by_extension_id() {
        let (reg, _fake) = make_registry();
        let _a = reg.keep_awake(Some("ext-a".into()), basic_opts()).unwrap();
        let _b = reg.keep_awake(Some("ext-b".into()), basic_opts()).unwrap();
        let only_a = reg.list(Some("ext-a")).unwrap();
        assert_eq!(only_a.len(), 1);
        let all = reg.list(None).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn backend_failure_is_propagated_and_no_entry_recorded() {
        let (reg, fake) = make_registry();
        fake.fail_next_inhibit();
        let err = reg.keep_awake(Some("ext-a".into()), basic_opts()).unwrap_err();
        assert!(matches!(err, AppError::Power(_)), "got: {err:?}");
        assert_eq!(fake.active_count(), 0);
        assert_eq!(reg.list(None).unwrap().len(), 0);
    }
}
