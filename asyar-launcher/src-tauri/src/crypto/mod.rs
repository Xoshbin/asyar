//! Application crypto primitives.
//!
//! - [`cipher`] / [`keystore`]: Layer 3 encryption-at-rest.
//! - [`kdf`] / [`mnemonic`] / [`sync_envelope`]: Layer 4b/4c E2EE cloud sync.
//!
//! Specs: `docs/superpowers/specs/2026-05-03-encryption-at-rest.md`
//! and `docs/superpowers/specs/2026-05-04-e2ee-cloud-sync.md`.

pub mod cipher;
pub mod hmac;
pub mod kdf;
pub mod keystore;
pub mod mnemonic;
pub mod sync_envelope;

/// A fresh random master key for tests. Tests never use a fixed key: a literal
/// key reads as a hard-coded secret to code scanners, and nothing depends on its value.
#[cfg(test)]
pub fn test_master_key() -> [u8; 32] {
    rand::random()
}
