//! Per-sync-run E2EE mode. Loaded once at the start of `sync_run` and
//! threaded through `encrypt_decisions` / `decrypt_pull_page`.

use zeroize::Zeroizing;

#[derive(Clone)]
pub enum Mode {
    /// E2EE is disabled. Transforms are identity.
    Off,
    /// E2EE is enabled. The cached `master_seed` is used to encrypt
    /// outgoing payloads and decrypt incoming ones; `key_version` is
    /// echoed in the push body so the server can reject stale-key
    /// pushes during rotation.
    On {
        master_seed: Zeroizing<[u8; 32]>,
        key_version: u64,
    },
}

impl Mode {
    pub fn is_enabled(&self) -> bool {
        matches!(self, Mode::On { .. })
    }

    pub fn key_version(&self) -> Option<u64> {
        match self {
            Mode::Off => None,
            Mode::On { key_version, .. } => Some(*key_version),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_is_disabled() {
        let m = Mode::Off;
        assert!(!m.is_enabled());
        assert_eq!(m.key_version(), None);
    }

    #[test]
    fn on_is_enabled_with_version() {
        let m = Mode::On {
            master_seed: Zeroizing::new([7u8; 32]),
            key_version: 3,
        };
        assert!(m.is_enabled());
        assert_eq!(m.key_version(), Some(3));
    }
}
