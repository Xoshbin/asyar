use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// HMAC-SHA256(key, message) -> 32 raw bytes.
pub fn hmac_sha256(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC-SHA256 accepts any 32-byte key");
    mac.update(message);
    mac.finalize().into_bytes().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keys_are_fresh() {
        assert_ne!(test_key(), test_key());
    }

    fn test_key() -> [u8; 32] {
        rand::random()
    }

    #[test]
    fn same_inputs_produce_same_output() {
        let key = test_key();
        let a = hmac_sha256(&key, b"hello");
        let b = hmac_sha256(&key, b"hello");
        assert_eq!(a, b, "HMAC must be deterministic");
    }
}
