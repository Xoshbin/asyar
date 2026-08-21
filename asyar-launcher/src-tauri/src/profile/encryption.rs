use crate::error::AppError;
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use zeroize::Zeroizing;

const ENC_PREFIX: &str = "enc:aes256gcm:";

/// Derive a 256-bit encryption key from a user password using Argon2id.
fn derive_key(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, AppError> {
    let params = Params::new(65536, 3, 1, Some(32))
        .map_err(|e| AppError::Encryption(format!("Invalid Argon2 params: {}", e)))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut *key)
        .map_err(|e| AppError::Encryption(format!("Key derivation failed: {}", e)))?;
    Ok(key)
}

/// Encrypt a plaintext string. Returns `"enc:aes256gcm:<base64(nonce|ciphertext)>"`.
pub fn encrypt_value(plaintext: &str, password: &str, salt: &[u8]) -> Result<String, AppError> {
    let key = derive_key(password, salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&*key).map_err(|e| AppError::Encryption(e.to_string()))?;
    // key is Zeroizing<[u8; 32]> — automatically zeroed on drop

    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Encryption(format!("Encryption failed: {}", e)))?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);

    let encoded = base64::engine::general_purpose::STANDARD.encode(&combined);
    Ok(format!("{}{}", ENC_PREFIX, encoded))
}

/// Decrypt a value previously encrypted with `encrypt_value`.
pub fn decrypt_value(encrypted: &str, password: &str, salt: &[u8]) -> Result<String, AppError> {
    let encoded = encrypted
        .strip_prefix(ENC_PREFIX)
        .ok_or_else(|| AppError::Encryption("Invalid encrypted field format".into()))?;

    let combined = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| AppError::Encryption(format!("Base64 decode failed: {}", e)))?;

    if combined.len() < 12 {
        return Err(AppError::Encryption("Ciphertext too short".into()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let key = derive_key(password, salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&*key).map_err(|e| AppError::Encryption(e.to_string()))?;
    // key is Zeroizing<[u8; 32]> — automatically zeroed on drop

    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Encryption("Decryption failed — wrong password?".into()))?;

    String::from_utf8(plaintext)
        .map_err(|e| AppError::Encryption(format!("UTF-8 decode failed: {}", e)))
}

/// Returns true if the string looks like an encrypted value.
pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(ENC_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_salt() -> [u8; 16] {
        rand::random()
    }

    fn test_pw() -> String {
        format!("test-passphrase-{}", rand::random::<u64>())
    }

    #[test]
    fn round_trip_encrypt_decrypt() {
        let password = test_pw();
        let salt = test_salt();
        let plaintext = "sk-abc123-my-api-key";

        let encrypted = encrypt_value(plaintext, &password, &salt).unwrap();
        assert!(encrypted.starts_with(ENC_PREFIX));

        let decrypted = decrypt_value(&encrypted, &password, &salt).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_password_fails() {
        let salt = test_salt();
        let encrypted = encrypt_value("secret", &test_pw(), &salt).unwrap();
        let result = decrypt_value(&encrypted, &test_pw(), &salt);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("wrong password"));
    }

    #[test]
    fn invalid_prefix_fails() {
        let salt = test_salt();
        let result = decrypt_value("not-encrypted", &test_pw(), &salt);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid encrypted"));
    }

    #[test]
    fn too_short_ciphertext_fails() {
        let salt = test_salt();
        let result = decrypt_value("enc:aes256gcm:dG9vc2hvcnQ=", &test_pw(), &salt);
        assert!(result.is_err());
    }

    #[test]
    fn is_encrypted_detects_prefix() {
        assert!(is_encrypted("enc:aes256gcm:abc123"));
        assert!(!is_encrypted("plain-text-value"));
        assert!(!is_encrypted(""));
    }

    #[test]
    fn different_salts_produce_different_ciphertexts() {
        let pw = test_pw();
        let s1 = test_salt();
        let mut s2 = s1;
        s2[0] ^= 0xff;
        let e1 = encrypt_value("data", &pw, &s1).unwrap();
        let e2 = encrypt_value("data", &pw, &s2).unwrap();
        assert_ne!(e1, e2);
    }

    #[test]
    fn empty_plaintext_round_trips() {
        let pw = test_pw();
        let salt = test_salt();
        let encrypted = encrypt_value("", &pw, &salt).unwrap();
        let decrypted = decrypt_value(&encrypted, &pw, &salt).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn unicode_plaintext_round_trips() {
        let pw = test_pw();
        let salt = test_salt();
        let text = "API Key: 秘密のキー 🔑";
        let encrypted = encrypt_value(text, &pw, &salt).unwrap();
        let decrypted = decrypt_value(&encrypted, &pw, &salt).unwrap();
        assert_eq!(decrypted, text);
    }
}
