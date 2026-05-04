//! BIP-39 24-word mnemonic ↔ 32-byte seed.
//!
//! Used as the human-readable form of `master_seed` in the E2EE
//! recovery flow. 24 words = 256 bits entropy + 8 bits checksum
//! (BIP-39 standard for 256-bit entropy).

use crate::error::AppError;
use bip39::{Language, Mnemonic};
use zeroize::Zeroizing;

pub const SEED_LEN: usize = 32;
pub const PHRASE_WORD_COUNT: usize = 24;

/// Encode a 32-byte seed as 24 BIP-39 English words separated by single spaces.
pub fn encode(seed: &[u8; SEED_LEN]) -> Result<String, AppError> {
    let mnemonic = Mnemonic::from_entropy_in(Language::English, seed)
        .map_err(|e| AppError::Encryption(format!("mnemonic encode: {e}")))?;
    Ok(mnemonic.to_string())
}

/// Decode a 24-word BIP-39 phrase to a 32-byte seed. Validates the
/// 8-bit checksum (any single mistyped or transposed word triggers a
/// `Decode` error).
pub fn decode(phrase: &str) -> Result<Zeroizing<[u8; SEED_LEN]>, AppError> {
    let normalized = normalize_phrase(phrase);
    let words: Vec<&str> = normalized.split_whitespace().collect();
    if words.len() != PHRASE_WORD_COUNT {
        return Err(AppError::Validation(format!(
            "mnemonic must be exactly {} words, got {}",
            PHRASE_WORD_COUNT,
            words.len()
        )));
    }
    let mnemonic = Mnemonic::parse_in(Language::English, &normalized)
        .map_err(|e| AppError::Validation(format!("mnemonic decode: {e}")))?;
    let entropy = mnemonic.to_entropy();
    if entropy.len() != SEED_LEN {
        return Err(AppError::Validation(format!(
            "mnemonic decoded to {} bytes, expected {}",
            entropy.len(),
            SEED_LEN
        )));
    }
    let mut out = Zeroizing::new([0u8; SEED_LEN]);
    out.copy_from_slice(&entropy);
    Ok(out)
}

fn normalize_phrase(phrase: &str) -> String {
    phrase
        .split_whitespace()
        .map(|w| w.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_roundtrip() {
        let seed: [u8; 32] = [
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
        ];
        let phrase = encode(&seed).unwrap();
        let words: Vec<&str> = phrase.split_whitespace().collect();
        assert_eq!(words.len(), 24);
        let recovered = decode(&phrase).unwrap();
        assert_eq!(*recovered, seed);
    }

    #[test]
    fn decode_rejects_wrong_word_count() {
        let err = decode("apple banana cherry").unwrap_err();
        assert!(format!("{err:?}").contains("24 words"));
    }

    #[test]
    fn decode_rejects_bad_checksum() {
        let seed = [0x42u8; 32];
        let mut phrase = encode(&seed).unwrap();
        let last_word = phrase.split_whitespace().last().unwrap().to_string();
        let replacement = if last_word == "zoo" { "zone" } else { "zoo" };
        phrase = format!(
            "{} {}",
            phrase
                .split_whitespace()
                .take(PHRASE_WORD_COUNT - 1)
                .collect::<Vec<_>>()
                .join(" "),
            replacement
        );
        let err = decode(&phrase).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn decode_is_case_insensitive_and_whitespace_tolerant() {
        let seed = [0x55u8; 32];
        let canonical = encode(&seed).unwrap();
        let upper = canonical.to_uppercase();
        let extra_spaces = canonical.replace(' ', "   \n  ");
        assert_eq!(*decode(&upper).unwrap(), seed);
        assert_eq!(*decode(&extra_spaces).unwrap(), seed);
    }

    #[test]
    fn decode_rejects_unknown_word() {
        let err = decode(&"floofloo ".repeat(24)).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
