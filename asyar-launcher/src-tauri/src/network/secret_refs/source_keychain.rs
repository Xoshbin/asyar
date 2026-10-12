use super::{extract_json_secret, validate_pointer, SecretError};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use zeroize::Zeroizing;

pub fn validate_keychain_source(
    service: &str,
    account: Option<&str>,
    pointer: Option<&str>,
) -> Result<(), SecretError> {
    let lower = service.to_lowercase();
    if service.is_empty()
        || service.chars().any(char::is_control)
        || account.is_some_and(|s| s.chars().any(char::is_control))
        || lower == crate::crypto::keystore::KEYCHAIN_SERVICE.to_lowercase()
        || lower == crate::browser::bridge::token_store::KEYRING_SERVICE.to_lowercase()
        || lower.starts_with("asyar")
        || lower.starts_with("org.asyar.")
        || lower.ends_with("safe storage")
        || lower.starts_with("com.apple.")
        || lower == "airport"
    {
        return Err(SecretError::SourceDenied);
    }
    if let Some(p) = pointer {
        validate_pointer(p)?;
    }
    Ok(())
}
pub trait KeychainReader: Send + Sync + 'static {
    fn read(&self, service: &str, account: Option<&str>)
        -> Result<Zeroizing<Vec<u8>>, SecretError>;
}
pub struct OsKeychainReader;
impl KeychainReader for OsKeychainReader {
    fn read(
        &self,
        service: &str,
        account: Option<&str>,
    ) -> Result<Zeroizing<Vec<u8>>, SecretError> {
        #[cfg(target_os = "macos")]
        {
            use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};
            let mut options = ItemSearchOptions::new();
            options
                .class(ItemClass::generic_password())
                .service(service)
                .load_data(true)
                .limit(1);
            if let Some(a) = account {
                options.account(a);
            }
            let results = options.search().map_err(|e| match e.code() {
                -128 | -25293 => SecretError::UserDenied,
                _ => SecretError::SourceUnavailable,
            })?;
            match results.into_iter().next() {
                Some(SearchResult::Data(data)) => Ok(Zeroizing::new(data)),
                _ => Err(SecretError::SourceUnavailable),
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (service, account);
            Err(SecretError::UnsupportedPlatform)
        }
    }
}
#[derive(Default)]
pub struct KeychainSession {
    entries: Mutex<HashMap<String, Arc<tokio::sync::Mutex<bool>>>>,
}
impl KeychainSession {
    fn entry(&self, key: &str) -> Result<Arc<tokio::sync::Mutex<bool>>, SecretError> {
        Ok(self
            .entries
            .lock()
            .map_err(|_| SecretError::SourceUnavailable)?
            .entry(key.into())
            .or_default()
            .clone())
    }
    #[cfg(test)]
    async fn is_denied(&self, key: &str) -> bool {
        *self.entry(key).unwrap().lock().await
    }
    pub async fn read(
        &self,
        key: &str,
        reader: Arc<dyn KeychainReader>,
        service: &str,
        account: Option<&str>,
        pointer: Option<&str>,
    ) -> Result<Zeroizing<String>, SecretError> {
        let entry = self.entry(key)?;
        let service = service.to_owned();
        let account = account.map(str::to_owned);
        let task = async {
            let mut guard = entry.lock_owned().await;
            if *guard {
                return Err(SecretError::UserDenied);
            }
            // The blocking task owns the lock even if the caller times out or cancels.
            tokio::task::spawn_blocking(move || {
                let result = reader.read(&service, account.as_deref());
                if matches!(result, Err(SecretError::UserDenied)) {
                    *guard = true;
                }
                result
            })
            .await
            .map_err(|_| SecretError::SourceUnavailable)?
        };
        let bytes = tokio::time::timeout(Duration::from_secs(60), task)
            .await
            .map_err(|_| SecretError::Timeout)??;
        if bytes.len() > 1024 * 1024 {
            return Err(SecretError::InvalidSecret);
        }
        match pointer {
            Some(p) => extract_json_secret(&bytes, p),
            None => Ok(Zeroizing::new(
                std::str::from_utf8(&bytes)
                    .map_err(|_| SecretError::InvalidSecret)?
                    .to_string(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_service_denylist() {
        for s in [
            crate::crypto::keystore::KEYCHAIN_SERVICE,
            crate::browser::bridge::token_store::KEYRING_SERVICE,
            "Chrome Safe Storage",
            "com.apple.account",
            "AirPort",
        ] {
            assert!(validate_keychain_source(s, None, None).is_err(), "{s}");
        }
        assert!(validate_keychain_source("Some-CLI-credentials", None, Some("/token")).is_ok());
    }
    struct Denied;
    impl KeychainReader for Denied {
        fn read(
            &self,
            _service: &str,
            _account: Option<&str>,
        ) -> Result<zeroize::Zeroizing<Vec<u8>>, super::super::SecretError> {
            Err(super::super::SecretError::UserDenied)
        }
    }
    #[tokio::test]
    async fn user_denied_is_sticky_for_session() {
        let state = KeychainSession::default();
        assert!(matches!(
            state
                .read(
                    "ext:ref",
                    std::sync::Arc::new(Denied),
                    "service",
                    None,
                    None
                )
                .await,
            Err(super::super::SecretError::UserDenied)
        ));
        assert!(state.is_denied("ext:ref").await);
    }
    #[tokio::test]
    async fn concurrent_reads_are_serialized() {
        struct Reader {
            active: std::sync::atomic::AtomicUsize,
            max: std::sync::atomic::AtomicUsize,
        }
        impl KeychainReader for Reader {
            fn read(&self, _s: &str, _a: Option<&str>) -> Result<Zeroizing<Vec<u8>>, SecretError> {
                use std::sync::atomic::Ordering::SeqCst;
                let n = self.active.fetch_add(1, SeqCst) + 1;
                self.max.fetch_max(n, SeqCst);
                std::thread::sleep(Duration::from_millis(20));
                self.active.fetch_sub(1, SeqCst);
                Ok(Zeroizing::new(b"abcdefgh".to_vec()))
            }
        }
        let reader = Arc::new(Reader {
            active: 0.into(),
            max: 0.into(),
        });
        let session = KeychainSession::default();
        let (a, b) = tokio::join!(
            session.read("ref", reader.clone(), "s", None, None),
            session.read("ref", reader.clone(), "s", None, None)
        );
        assert!(a.is_ok() && b.is_ok());
        assert_eq!(reader.max.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_platform_returns_skip() {
        assert!(matches!(
            OsKeychainReader.read("s", None),
            Err(super::super::SecretError::UnsupportedPlatform)
        ));
    }
}
