//! Local encryption-at-rest (Layer 3 of the privacy stack).
//!
//! Provides [`cipher::encrypt`] / [`cipher::decrypt`] over a 32-byte
//! master key sourced from the OS keychain (or a file fallback on
//! Linux when Secret Service is unavailable).
//!
//! Spec: `docs/superpowers/specs/2026-05-03-encryption-at-rest.md`.

pub mod cipher;
pub mod keystore;
