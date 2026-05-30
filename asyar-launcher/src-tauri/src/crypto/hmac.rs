//! Deterministic keyed MAC for indexed lookup of encrypted-at-rest values.
//!
//! Distinct from `cipher` (random-nonce AES-GCM): same (key, message)
//! always produces the same 32-byte output. Used by clipboard dedup to
//! avoid an O(N) decrypt-and-compare scan per capture.

use ::hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// HMAC-SHA256(key, message) → 32 raw bytes. Deterministic and constant-time
/// for the verify path (we don't currently verify, but this keeps the door
/// open if a use case appears).
pub fn hmac_sha256(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC-SHA256 accepts any 32-byte key");
    mac.update(message);
    mac.finalize().into_bytes().into()
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
    fn same_inputs_produce_same_output() {
        let key = test_key();
        let a = hmac_sha256(&key, b"hello");
        let b = hmac_sha256(&key, b"hello");
        assert_eq!(a, b, "HMAC must be deterministic");
    }

    #[test]
    fn different_message_produces_different_output() {
        let key = test_key();
        let a = hmac_sha256(&key, b"hello");
        let b = hmac_sha256(&key, b"world");
        assert_ne!(a, b);
    }

    #[test]
    fn different_key_produces_different_output() {
        let k1 = test_key();
        let mut k2 = test_key();
        k2[0] ^= 0xFF;
        let a = hmac_sha256(&k1, b"same message");
        let b = hmac_sha256(&k2, b"same message");
        assert_ne!(a, b);
    }

    #[test]
    fn known_answer_pins_the_algorithm() {
        let key = test_key();
        let out = hmac_sha256(&key, b"asyar-clipboard-hmac-test");
        // Computed once from the same (key, message). Pinning this byte-for-byte
        // catches a silent swap of the hash function or HMAC construction.
        let expected: [u8; 32] = [
            119, 183, 107, 219, 96, 141, 147, 239, 25, 229, 141, 134, 186, 200, 166, 253, 120, 248,
            171, 200, 172, 165, 237, 59, 129, 251, 146, 82, 42, 242, 121, 93,
        ];
        assert_eq!(out, expected);
    }

    #[test]
    fn empty_message_still_produces_output() {
        let key = test_key();
        let out = hmac_sha256(&key, b"");
        assert_eq!(out.len(), 32);
    }
}
