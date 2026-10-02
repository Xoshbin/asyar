use crate::error::StorageError;
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::Engine;

pub const VERSION_PREFIX: &str = "enc:v1:";

/// Encrypt `plaintext` under `key` and return a string of the form
/// `enc:v1:<base64(nonce || ciphertext_with_tag)>`.
pub fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, StorageError> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| StorageError::Encryption(e.to_string()))?;

    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| StorageError::Encryption(format!("Encryption failed: {e}")))?;

    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    let encoded = base64::engine::general_purpose::STANDARD.encode(&combined);
    Ok(format!("{VERSION_PREFIX}{encoded}"))
}

/// Decrypt a value previously produced by [`encrypt`] under the same key.
pub fn decrypt(value: &str, key: &[u8; 32]) -> Result<String, StorageError> {
    let encoded = value
        .strip_prefix(VERSION_PREFIX)
        .ok_or_else(|| StorageError::Encryption("Missing enc:v1: prefix".into()))?;

    let combined = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| StorageError::Encryption(format!("Base64 decode failed: {e}")))?;

    if combined.len() < 12 {
        return Err(StorageError::Encryption("Ciphertext too short".into()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| StorageError::Encryption(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|_| {
        StorageError::Encryption("Decryption failed — wrong key or tampered ciphertext".into())
    })?;

    String::from_utf8(plaintext)
        .map_err(|e| StorageError::Encryption(format!("UTF-8 decode failed: {e}")))
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
}
