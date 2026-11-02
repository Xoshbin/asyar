//! Device-to-device pairing cryptography for Cloud Sync E2EE.
//!
//! Protocol:
//! 1. Requester generates an ephemeral X25519 keypair (r, R).
//! 2. Pairing fingerprint = first 6 decimal digits (zero-padded; first 4 bytes
//!    of SHA-256(b"asyar-pair-v1" || R) as big-endian u32 % 1,000,000),
//!    rendered as "123 456".
//! 3. Approver generates ephemeral keypair (a, A), computes shared = X25519(a, R).
//!    Derives key = HKDF-SHA256(salt = R || A, ikm = shared, info = b"asyar-sync-pairing-v1", 32 bytes).
//!    Seals S: base64( nonce(12) || AES-256-GCM(key, nonce, plaintext = S, aad = R || A) ).
//! 4. Requester computes shared = X25519(r, A), derives same key, decrypts AEAD
//!    with aad = R || A, and verifies HMAC-SHA256(S, b"asyar-sync-kcv-v1") equals
//!    the mirror's kcv in constant time before accepting S.

use crate::error::AppError;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

/// In-memory store for pending requester pairing secret keys.
///
/// An ephemeral secret key generated on the new device during `pairing_request`
/// must survive between the request and the poll. Entries expire after 15 minutes
/// and are dropped/zeroized on completion or cancel.
#[derive(Clone)]
pub enum PairingSession {
    Requested {
        requester_secret: Zeroizing<[u8; 32]>,
        requester_pub: [u8; 32],
        created_at: Instant,
    },
    AwaitingConfirmation {
        decrypted_seed: Zeroizing<[u8; 32]>,
        confirmation_words: String,
        created_at: Instant,
    },
}

type PendingSessionMap = HashMap<String, PairingSession>;

#[derive(Default)]
pub struct PairingSessionStore(pub Mutex<PendingSessionMap>);

impl PairingSessionStore {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    fn cleanup(lock: &mut PendingSessionMap) {
        let now = Instant::now();
        lock.retain(|_, session| match session {
            PairingSession::Requested { created_at, .. } => {
                now.duration_since(*created_at).as_secs() < 900
            }
            PairingSession::AwaitingConfirmation { created_at, .. } => {
                now.duration_since(*created_at).as_secs() < 900
            }
        });
    }

    pub fn insert_request(&self, id: String, secret: Zeroizing<[u8; 32]>, requester_pub: [u8; 32]) {
        if let Ok(mut lock) = self.0.lock() {
            Self::cleanup(&mut lock);
            lock.insert(
                id,
                PairingSession::Requested {
                    requester_secret: secret,
                    requester_pub,
                    created_at: Instant::now(),
                },
            );
        }
    }

    pub fn get(&self, id: &str) -> Option<PairingSession> {
        if let Ok(mut lock) = self.0.lock() {
            Self::cleanup(&mut lock);
            lock.get(id).cloned()
        } else {
            None
        }
    }

    pub fn set_awaiting_confirmation(
        &self,
        id: &str,
        decrypted_seed: Zeroizing<[u8; 32]>,
        confirmation_words: String,
    ) {
        if let Ok(mut lock) = self.0.lock() {
            Self::cleanup(&mut lock);
            lock.insert(
                id.to_string(),
                PairingSession::AwaitingConfirmation {
                    decrypted_seed,
                    confirmation_words,
                    created_at: Instant::now(),
                },
            );
        }
    }

    pub fn take_awaiting_confirmation(&self, id: &str) -> Option<Zeroizing<[u8; 32]>> {
        if let Ok(mut lock) = self.0.lock() {
            Self::cleanup(&mut lock);
            match lock.remove(id) {
                Some(PairingSession::AwaitingConfirmation { decrypted_seed, .. }) => {
                    Some(decrypted_seed)
                }
                _ => None,
            }
        } else {
            None
        }
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut lock) = self.0.lock() {
            lock.remove(id);
        }
    }
}

/// Constant-time slice equality comparison.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub const KCV_MESSAGE: &[u8] = b"asyar-sync-kcv-v1";
pub const PAIRING_INFO: &[u8] = b"asyar-sync-pairing-v1";
pub const FINGERPRINT_PREFIX: &[u8] = b"asyar-pair-v1";

type HmacSha256 = Hmac<Sha256>;

/// Compute the 32-byte key check value (KCV) for the master sync seed:
/// `HMAC-SHA256(key = S, msg = b"asyar-sync-kcv-v1")`.
pub fn compute_kcv(seed: &[u8; 32]) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(seed).expect("HMAC accepts 32-byte key");
    mac.update(KCV_MESSAGE);
    let result = mac.finalize().into_bytes();
    result.into()
}

/// Verify a candidate master sync seed against an expected KCV in constant time.
pub fn verify_kcv(seed: &[u8; 32], expected_kcv: &[u8]) -> bool {
    let mut mac = match <HmacSha256 as Mac>::new_from_slice(seed) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(KCV_MESSAGE);
    mac.verify_slice(expected_kcv).is_ok()
}

pub const CONFIRMATION_PREFIX: &[u8] = b"asyar-pair-confirm-v1";

/// Extract the first 66 bits of a SHA-256 digest as 6 BIP-39 English words
/// (11 bits per word, big-endian bit order).
pub fn bits_66_to_bip39_words(digest: &[u8; 32]) -> String {
    let mut words = Vec::with_capacity(6);
    for word_idx in 0..6 {
        let start_bit = word_idx * 11;
        let mut index = 0usize;
        for bit_offset in 0..11 {
            let bit_idx = start_bit + bit_offset;
            let byte_idx = bit_idx / 8;
            let bit_in_byte = 7 - (bit_idx % 8);
            let bit = (digest[byte_idx] >> bit_in_byte) & 1;
            index = (index << 1) | (bit as usize);
        }
        words.push(crate::crypto::mnemonic::word_by_index(index));
    }
    words.join(" ")
}

/// Format a pairing fingerprint from a requester's 32-byte X25519 public key:
/// first 66 bits of SHA-256(b"asyar-pair-v1" || requester_public_key) as 6 BIP-39 words.
pub fn compute_pairing_fingerprint(requester_public_key: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_PREFIX);
    hasher.update(requester_public_key);
    let hash: [u8; 32] = hasher.finalize().into();
    bits_66_to_bip39_words(&hash)
}

/// Compute a two-way confirmation code from the requester and approver public keys:
/// first 66 bits of SHA-256(b"asyar-pair-confirm-v1" || requester_pub || approver_pub) as 6 BIP-39 words.
pub fn compute_confirmation_words(
    requester_public_key: &[u8; 32],
    approver_public_key: &[u8; 32],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(CONFIRMATION_PREFIX);
    hasher.update(requester_public_key);
    hasher.update(approver_public_key);
    let hash: [u8; 32] = hasher.finalize().into();
    bits_66_to_bip39_words(&hash)
}

/// Generate a fresh ephemeral X25519 keypair.
pub fn generate_keypair() -> (Zeroizing<[u8; 32]>, [u8; 32]) {
    let secret_bytes: [u8; 32] = rand::random();
    let secret = StaticSecret::from(secret_bytes);
    let public = PublicKey::from(&secret);
    (Zeroizing::new(secret_bytes), *public.as_bytes())
}

/// Derive the 32-byte pairing encryption key using X25519 Diffie-Hellman + HKDF-SHA256.
///
/// Salt: `R || A` (64 bytes).
/// IKM: `X25519(secret, peer_pub)`. Rejects all-zero / low-order points.
/// Info: `b"asyar-sync-pairing-v1"`.
pub fn derive_pairing_key(
    my_secret_bytes: &[u8; 32],
    peer_public_bytes: &[u8; 32],
    requester_pub: &[u8; 32],
    approver_pub: &[u8; 32],
) -> Result<Zeroizing<[u8; 32]>, AppError> {
    let my_secret = StaticSecret::from(*my_secret_bytes);
    let peer_public = PublicKey::from(*peer_public_bytes);
    let shared = my_secret.diffie_hellman(&peer_public);

    // Reject all-zero shared secret (e.g. low-order curve points).
    if constant_time_eq(shared.as_bytes(), &[0u8; 32]) {
        return Err(AppError::Encryption(
            "invalid Diffie-Hellman shared secret: low order or zero".into(),
        ));
    }

    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(requester_pub);
    salt[32..].copy_from_slice(approver_pub);

    let hk = Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes());
    let mut okm = Zeroizing::new([0u8; 32]);
    hk.expand(PAIRING_INFO, &mut *okm)
        .map_err(|e| AppError::Encryption(format!("hkdf expand: {e}")))?;

    Ok(okm)
}

/// Approver side: encrypt `master_seed` S under an ephemeral keypair and return
/// the base64-encoded sealed seed and the approver's public key A.
pub fn seal_seed_for_pairing(
    master_seed: &[u8; 32],
    requester_public_bytes: &[u8; 32],
) -> Result<(String, [u8; 32]), AppError> {
    let (approver_secret, approver_pub) = generate_keypair();
    let key = derive_pairing_key(
        &approver_secret,
        requester_public_bytes,
        requester_public_bytes,
        &approver_pub,
    )?;

    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let mut aad = [0u8; 64];
    aad[..32].copy_from_slice(requester_public_bytes);
    aad[32..].copy_from_slice(&approver_pub);

    let cipher = Aes256Gcm::new_from_slice(&*key)
        .map_err(|e| AppError::Encryption(format!("aes-gcm init: {e}")))?;

    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: master_seed,
                aad: &aad,
            },
        )
        .map_err(|e| AppError::Encryption(format!("seal seed encrypt: {e}")))?;

    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    let sealed_b64 = B64.encode(&combined);
    Ok((sealed_b64, approver_pub))
}

/// Requester side: decrypt sealed seed, verify AAD, check length, and verify KCV
/// in constant time against `expected_kcv`.
pub fn open_sealed_seed_for_pairing(
    requester_secret_bytes: &[u8; 32],
    approver_public_bytes: &[u8; 32],
    sealed_b64: &str,
    expected_kcv: &[u8],
) -> Result<Zeroizing<[u8; 32]>, AppError> {
    let raw = B64
        .decode(sealed_b64.as_bytes())
        .map_err(|e| AppError::Validation(format!("invalid base64 in sealed seed: {e}")))?;

    // Nonce (12) + AES-GCM Tag (16) + 32-byte seed = 60 bytes minimum.
    if raw.len() < 28 {
        return Err(AppError::Validation(
            "sealed seed payload is too short".into(),
        ));
    }

    let nonce_bytes = &raw[..12];
    let ciphertext = &raw[12..];

    let requester_secret = StaticSecret::from(*requester_secret_bytes);
    let requester_pub = PublicKey::from(&requester_secret);

    let key = derive_pairing_key(
        requester_secret_bytes,
        approver_public_bytes,
        requester_pub.as_bytes(),
        approver_public_bytes,
    )?;

    let mut aad = [0u8; 64];
    aad[..32].copy_from_slice(requester_pub.as_bytes());
    aad[32..].copy_from_slice(approver_public_bytes);

    let cipher = Aes256Gcm::new_from_slice(&*key)
        .map_err(|e| AppError::Encryption(format!("aes-gcm init: {e}")))?;

    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(nonce_bytes),
            Payload {
                msg: ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| AppError::Encryption("sealed seed AEAD decryption failed".into()))?;

    if plaintext.len() != 32 {
        return Err(AppError::Encryption(
            "decrypted seed has invalid length (expected 32 bytes)".into(),
        ));
    }

    let mut seed = Zeroizing::new([0u8; 32]);
    seed.copy_from_slice(&plaintext);

    if !verify_kcv(&seed, expected_kcv) {
        return Err(AppError::Validation(
            "pairing failed: decrypted seed does not match expected KCV".into(),
        ));
    }

    Ok(seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pairing_round_trip() {
        let master_seed: [u8; 32] = rand::random();
        let expected_kcv = compute_kcv(&master_seed);

        let (requester_secret, requester_pub) = generate_keypair();
        let fingerprint = compute_pairing_fingerprint(&requester_pub);
        assert_eq!(fingerprint.split_whitespace().count(), 6);

        let (sealed_b64, approver_pub) =
            seal_seed_for_pairing(&master_seed, &requester_pub).unwrap();

        let recovered = open_sealed_seed_for_pairing(
            &requester_secret,
            &approver_pub,
            &sealed_b64,
            &expected_kcv,
        )
        .unwrap();

        assert_eq!(*recovered, master_seed);
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let master_seed: [u8; 32] = rand::random();
        let expected_kcv = compute_kcv(&master_seed);
        let (requester_secret, requester_pub) = generate_keypair();

        let (sealed_b64, approver_pub) =
            seal_seed_for_pairing(&master_seed, &requester_pub).unwrap();

        let mut raw = B64.decode(sealed_b64.as_bytes()).unwrap();
        // Tamper with the ciphertext byte
        let last_idx = raw.len() - 1;
        raw[last_idx] ^= 0x55;
        let tampered_b64 = B64.encode(&raw);

        let err = open_sealed_seed_for_pairing(
            &requester_secret,
            &approver_pub,
            &tampered_b64,
            &expected_kcv,
        )
        .unwrap_err();

        assert!(matches!(err, AppError::Encryption(_)));
    }

    #[test]
    fn test_wrong_key_fails() {
        let master_seed: [u8; 32] = rand::random();
        let expected_kcv = compute_kcv(&master_seed);
        let (_requester_secret, requester_pub) = generate_keypair();
        let (other_secret, _other_pub) = generate_keypair();

        let (sealed_b64, approver_pub) =
            seal_seed_for_pairing(&master_seed, &requester_pub).unwrap();

        let err =
            open_sealed_seed_for_pairing(&other_secret, &approver_pub, &sealed_b64, &expected_kcv)
                .unwrap_err();

        assert!(matches!(err, AppError::Encryption(_)));
    }

    #[test]
    fn test_wrong_aad_fails() {
        let master_seed: [u8; 32] = rand::random();
        let expected_kcv = compute_kcv(&master_seed);
        let (requester_secret, requester_pub) = generate_keypair();

        let (sealed_b64, _approver_pub) =
            seal_seed_for_pairing(&master_seed, &requester_pub).unwrap();

        let (_fake_secret, fake_approver_pub) = generate_keypair();

        let err = open_sealed_seed_for_pairing(
            &requester_secret,
            &fake_approver_pub,
            &sealed_b64,
            &expected_kcv,
        )
        .unwrap_err();

        assert!(matches!(err, AppError::Encryption(_)));
    }

    #[test]
    fn test_wrong_kcv_fails() {
        let master_seed: [u8; 32] = rand::random();
        let fake_kcv = [0x99u8; 32];
        let (requester_secret, requester_pub) = generate_keypair();

        let (sealed_b64, approver_pub) =
            seal_seed_for_pairing(&master_seed, &requester_pub).unwrap();

        let err =
            open_sealed_seed_for_pairing(&requester_secret, &approver_pub, &sealed_b64, &fake_kcv)
                .unwrap_err();

        match err {
            AppError::Validation(msg) => {
                assert!(
                    msg.contains("KCV"),
                    "expected KCV failure message, got: {msg}"
                )
            }
            other => panic!("expected AppError::Validation, got: {other:?}"),
        }
    }

    #[test]
    fn test_fingerprint_format_and_stability() {
        let key = [0x42u8; 32];
        let fp1 = compute_pairing_fingerprint(&key);
        let fp2 = compute_pairing_fingerprint(&key);
        assert_eq!(fp1, fp2);
        let words: Vec<&str> = fp1.split_whitespace().collect();
        assert_eq!(words.len(), 6);
        for w in &words {
            assert!(w.chars().all(|c| c.is_ascii_lowercase()));
        }

        let other_key = [0x43u8; 32];
        let fp_other = compute_pairing_fingerprint(&other_key);
        assert_ne!(fp1, fp_other);
    }

    #[test]
    fn test_known_answer_fingerprint() {
        // Known input test vector: 32 zero bytes
        let zero_key = [0u8; 32];
        let mut hasher = Sha256::new();
        hasher.update(b"asyar-pair-v1");
        hasher.update(zero_key);
        let h: [u8; 32] = hasher.finalize().into();
        let expected_fp = bits_66_to_bip39_words(&h);

        assert_eq!(compute_pairing_fingerprint(&zero_key), expected_fp);
        assert_eq!(expected_fp, "nature laptop expect boil rent cost");
    }

    #[test]
    fn test_known_answer_confirmation_words() {
        let zero_key = [0u8; 32];
        let words = compute_confirmation_words(&zero_key, &zero_key);
        assert_eq!(words.split_whitespace().count(), 6);
        assert_eq!(words, "balance patch patch extend copper twin");
    }

    #[test]
    fn test_confirmation_words_mismatching_approver_key_changes_code() {
        let req_pub = [1u8; 32];
        let app_pub_1 = [2u8; 32];
        let app_pub_2 = [3u8; 32];

        let code1 = compute_confirmation_words(&req_pub, &app_pub_1);
        let code2 = compute_confirmation_words(&req_pub, &app_pub_2);
        assert_ne!(code1, code2);
    }

    #[test]
    fn test_known_answer_hkdf_fixed_inputs() {
        let salt = [0x01u8; 64];
        let ikm = [0x02u8; 32];
        let info = b"asyar-sync-pairing-v1";

        let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
        let mut okm1 = [0u8; 32];
        hk.expand(info, &mut okm1).unwrap();

        // Second derivation with same inputs must be byte-identical
        let hk2 = Hkdf::<Sha256>::new(Some(&salt), &ikm);
        let mut okm2 = [0u8; 32];
        hk2.expand(info, &mut okm2).unwrap();

        assert_eq!(okm1, okm2);
        assert_ne!(okm1, [0u8; 32]);
    }

    #[test]
    fn test_reject_low_order_or_zero_shared_secret() {
        // A low order point on Curve25519 produces an all-zero shared secret.
        // For example, the point of order 1 is all zeros.
        let secret = [1u8; 32];
        let zero_point = [0u8; 32];
        let req_pub = [1u8; 32];
        let app_pub = [2u8; 32];

        let res = derive_pairing_key(&secret, &zero_point, &req_pub, &app_pub);
        assert!(res.is_err(), "low order point must be rejected");
    }

    #[test]
    fn test_pairing_session_store_lifecycle_and_ttl() {
        let store = PairingSessionStore::new();
        let secret = Zeroizing::new([42u8; 32]);
        let pub_key = [10u8; 32];
        store.insert_request("pair-1".into(), secret, pub_key);

        assert!(store.get("pair-unknown").is_none());

        // get() returns Requested
        match store.get("pair-1") {
            Some(PairingSession::Requested { requester_pub, .. }) => {
                assert_eq!(requester_pub, pub_key);
            }
            _ => panic!("expected Requested session"),
        }

        // Transition to AwaitingConfirmation
        let seed = Zeroizing::new([77u8; 32]);
        store.set_awaiting_confirmation(
            "pair-1",
            seed,
            "word1 word2 word3 word4 word5 word6".into(),
        );

        match store.get("pair-1") {
            Some(PairingSession::AwaitingConfirmation {
                confirmation_words, ..
            }) => {
                assert_eq!(confirmation_words, "word1 word2 word3 word4 word5 word6");
            }
            _ => panic!("expected AwaitingConfirmation session"),
        }

        // take_awaiting_confirmation retrieves seed and removes it
        let taken = store
            .take_awaiting_confirmation("pair-1")
            .expect("must take seed");
        assert_eq!(*taken, [77u8; 32]);
        assert!(store.get("pair-1").is_none(), "already taken");

        // TTL expiry drops the secret
        {
            let mut map = store.0.lock().unwrap();
            map.insert(
                "expired-pair".into(),
                PairingSession::Requested {
                    requester_secret: Zeroizing::new([99u8; 32]),
                    requester_pub: [0u8; 32],
                    created_at: Instant::now() - std::time::Duration::from_secs(901),
                },
            );
        }
        assert!(
            store.get("expired-pair").is_none(),
            "expired session must be dropped"
        );
    }
}
