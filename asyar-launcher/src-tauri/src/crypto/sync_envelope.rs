//! Per-item payload encrypt/decrypt for E2EE cloud sync.
//!
//! Composes [`crate::crypto::cipher`]: the master_seed is the AES-256-GCM
//! key, fresh 12-byte random nonce per encryption, AEAD tag
//! verification on decrypt. Output envelope is the same `enc:v1:`
//! prefix used by Layer 3 at-rest encryption.

use crate::crypto::cipher;
use crate::error::AppError;

pub fn encrypt_payload(plaintext: &str, master_seed: &[u8; 32]) -> Result<String, AppError> {
    cipher::encrypt(plaintext, master_seed)
}

pub fn decrypt_payload(ciphertext: &str, master_seed: &[u8; 32]) -> Result<String, AppError> {
    cipher::decrypt(ciphertext, master_seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_returns_original_plaintext() {
        let key = [42u8; 32];
        let plaintext = "{\"items\":[{\"id\":\"abc\",\"text\":\"hello\"}]}";
        let ct = encrypt_payload(plaintext, &key).unwrap();
        assert!(ct.starts_with("enc:v1:"));
        let pt = decrypt_payload(&ct, &key).unwrap();
        assert_eq!(pt, plaintext);
    }

    #[test]
    fn each_encryption_uses_fresh_nonce() {
        let key = [7u8; 32];
        let plaintext = "same input";
        let a = encrypt_payload(plaintext, &key).unwrap();
        let b = encrypt_payload(plaintext, &key).unwrap();
        assert_ne!(a, b, "different nonces should yield different ciphertexts");
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let plaintext = "secret";
        let ct = encrypt_payload(plaintext, &[1u8; 32]).unwrap();
        let err = decrypt_payload(&ct, &[2u8; 32]).unwrap_err();
        assert!(matches!(err, AppError::Encryption(_)));
    }

    #[test]
    fn decrypt_rejects_tampered_ciphertext() {
        let key = [3u8; 32];
        let ct = encrypt_payload("payload", &key).unwrap();
        let mut bytes = ct.into_bytes();
        // Pick a position inside the base64 body (skip "enc:v1:" prefix) and
        // flip A↔B / a↔b / 0↔1 to stay inside the base64 alphabet, ensuring
        // the failure goes through AEAD tag verification rather than base64
        // decode. Mirrors cipher.rs's tamper test.
        let prefix_len = "enc:v1:".len();
        let flip_idx = prefix_len + 4; // arbitrary position well inside the body
        bytes[flip_idx] = match bytes[flip_idx] {
            b'A' => b'B',
            b'B' => b'A',
            b'a' => b'b',
            b'b' => b'a',
            b'0' => b'1',
            b'1' => b'0',
            // Fall back: pick any other valid base64 char that's reliably present.
            c => {
                if c == b'+' {
                    b'/'
                } else {
                    b'A'
                }
            }
        };
        let tampered = String::from_utf8(bytes).unwrap();
        let err = decrypt_payload(&tampered, &key).unwrap_err();
        assert!(matches!(err, AppError::Encryption(_)));
    }
}
