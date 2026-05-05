//! AES-256-GCM encryption keyed by a pre-derived 32-byte master key.
//!
//! Distinct from [`crate::profile::encryption`]: the legacy module derives
//! its key via Argon2id from a hardcoded password+salt and uses the
//! `enc:aes256gcm:` prefix. This module skips Argon2id (the keystore
//! supplies a 32-byte high-entropy key directly) and uses the `enc:v1:`
//! prefix so storage call sites can distinguish migrated rows from legacy
//! plaintext or legacy-encrypted rows during the one-shot Layer 3
//! migration.

use crate::error::AppError;
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::Engine;

pub const VERSION_PREFIX: &str = "enc:v1:";

/// Encrypt `plaintext` under `key` and return a string of the form
/// `enc:v1:<base64(nonce || ciphertext_with_tag)>`.
///
/// A fresh 12-byte nonce is generated per call from the OS RNG —
/// re-encrypting the same plaintext under the same key produces a
/// different ciphertext, which is the AES-GCM contract.
pub fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, AppError> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Encryption(e.to_string()))?;

    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Encryption(format!("Encryption failed: {e}")))?;

    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    let encoded = base64::engine::general_purpose::STANDARD.encode(&combined);
    Ok(format!("{VERSION_PREFIX}{encoded}"))
}

/// Decrypt a value previously produced by [`encrypt`] under the same key.
/// Returns `Err` if the prefix is missing, the base64 is malformed, the
/// ciphertext is too short to contain a nonce, or the AEAD tag fails to
/// verify (wrong key or tampered bytes — both indistinguishable from the
/// caller's perspective, by design).
pub fn decrypt(value: &str, key: &[u8; 32]) -> Result<String, AppError> {
    let encoded = value
        .strip_prefix(VERSION_PREFIX)
        .ok_or_else(|| AppError::Encryption("Missing enc:v1: prefix".into()))?;

    let combined = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| AppError::Encryption(format!("Base64 decode failed: {e}")))?;

    if combined.len() < 12 {
        return Err(AppError::Encryption("Ciphertext too short".into()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Encryption(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Encryption("Decryption failed — wrong key or tampered ciphertext".into()))?;

    String::from_utf8(plaintext)
        .map_err(|e| AppError::Encryption(format!("UTF-8 decode failed: {e}")))
}

/// Cheap prefix check used by storage call sites + the migration to skip
/// already-encrypted values.
pub fn is_encrypted_value(value: &str) -> bool {
    value.starts_with(VERSION_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> [u8; 32] {
        // Deterministic test key — never used in production.
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = i as u8;
        }
        k
    }

    #[test]
    fn round_trip_short_text() {
        let key = test_key();
        let encrypted = encrypt("hello world", &key).unwrap();
        assert!(encrypted.starts_with(VERSION_PREFIX));
        assert_eq!(decrypt(&encrypted, &key).unwrap(), "hello world");
    }

    #[test]
    fn round_trip_empty_string() {
        let key = test_key();
        let encrypted = encrypt("", &key).unwrap();
        assert_eq!(decrypt(&encrypted, &key).unwrap(), "");
    }

    #[test]
    fn round_trip_unicode() {
        let key = test_key();
        let text = "API Key: 秘密のキー 🔑";
        let encrypted = encrypt(text, &key).unwrap();
        assert_eq!(decrypt(&encrypted, &key).unwrap(), text);
    }

    #[test]
    fn round_trip_long_text() {
        let key = test_key();
        let text = "x".repeat(100_000);
        let encrypted = encrypt(&text, &key).unwrap();
        assert_eq!(decrypt(&encrypted, &key).unwrap(), text);
    }

    #[test]
    fn nonce_is_unique_per_call() {
        let key = test_key();
        let e1 = encrypt("same input", &key).unwrap();
        let e2 = encrypt("same input", &key).unwrap();
        assert_ne!(e1, e2, "two encrypts of same plaintext must differ (random nonce)");
    }

    #[test]
    fn wrong_key_fails_decrypt() {
        let key1 = test_key();
        let mut key2 = test_key();
        key2[0] ^= 0xFF;
        let encrypted = encrypt("secret", &key1).unwrap();
        let result = decrypt(&encrypted, &key2);
        assert!(result.is_err());
    }

    #[test]
    fn tampered_ciphertext_fails_decrypt() {
        let key = test_key();
        let encrypted = encrypt("secret", &key).unwrap();
        // Flip a byte inside the base64 portion (after the prefix).
        let mut bytes = encrypted.into_bytes();
        let prefix_len = VERSION_PREFIX.len();
        let flip_idx = prefix_len + 5;
        bytes[flip_idx] = if bytes[flip_idx] == b'A' { b'B' } else { b'A' };
        let tampered = String::from_utf8(bytes).unwrap();
        let result = decrypt(&tampered, &key);
        assert!(result.is_err());
    }

    #[test]
    fn missing_prefix_fails_decrypt() {
        let key = test_key();
        let result = decrypt("just plain text", &key);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("prefix"));
    }

    #[test]
    fn legacy_prefix_is_not_v1() {
        // Sanity: a legacy `enc:aes256gcm:` value is not mistaken for v1.
        let key = test_key();
        let result = decrypt("enc:aes256gcm:somebase64", &key);
        assert!(result.is_err());
    }

    #[test]
    fn malformed_base64_fails_decrypt() {
        let key = test_key();
        let result = decrypt("enc:v1:not!valid@base64", &key);
        assert!(result.is_err());
    }

    #[test]
    fn too_short_ciphertext_fails_decrypt() {
        let key = test_key();
        let result = decrypt("enc:v1:dG9vc2hvcnQ=", &key); // "tooshort" base64
        assert!(result.is_err());
    }

    #[test]
    fn is_encrypted_value_detects_prefix() {
        assert!(is_encrypted_value("enc:v1:abc"));
        assert!(!is_encrypted_value("plain"));
        assert!(!is_encrypted_value(""));
        assert!(!is_encrypted_value("enc:aes256gcm:abc"), "legacy prefix is not v1");
    }
}
