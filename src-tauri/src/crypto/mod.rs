//! Application crypto primitives.
//!
//! - [`cipher`] / [`keystore`]: Layer 3 encryption-at-rest.
//! - [`kdf`] / [`mnemonic`] / [`sync_envelope`]: Layer 4b/4c E2EE cloud sync.
//!
//! Specs: `docs/superpowers/specs/2026-05-03-encryption-at-rest.md`
//! and `docs/superpowers/specs/2026-05-04-e2ee-cloud-sync.md`.

pub mod cipher;
pub mod keystore;
pub mod kdf;
pub mod mnemonic;
pub mod sync_envelope;
