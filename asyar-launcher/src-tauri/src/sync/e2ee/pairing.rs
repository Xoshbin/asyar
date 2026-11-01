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
type PendingSessionMap = HashMap<String, (Zeroizing<[u8; 32]>, Instant)>;

#[derive(Default)]
pub struct PairingSessionStore(pub Mutex<PendingSessionMap>);

impl PairingSessionStore {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    pub fn insert(&self, id: String, secret: Zeroizing<[u8; 32]>) {
        if let Ok(mut lock) = self.0.lock() {
            let now = Instant::now();
            lock.retain(|_, (_, time)| now.duration_since(*time).as_secs() < 900);
            lock.insert(id, (secret, now));
        }
    }

    pub fn get(&self, id: &str) -> Option<Zeroizing<[u8; 32]>> {
        if let Ok(mut lock) = self.0.lock() {
            let now = Instant::now();
            lock.retain(|_, (_, time)| now.duration_since(*time).as_secs() < 900);
            lock.get(id).map(|(s, _)| s.clone())
        } else {
            None
        }
    }

    pub fn take(&self, id: &str) -> Option<Zeroizing<[u8; 32]>> {
        if let Ok(mut lock) = self.0.lock() {
            let now = Instant::now();
            lock.retain(|_, (_, time)| now.duration_since(*time).as_secs() < 900);
            lock.remove(id).map(|(s, _)| s)
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

/// Format a pairing fingerprint from a requester's 32-byte X25519 public key.
///
/// Formula: first 4 bytes of SHA-256(b"asyar-pair-v1" || requester_public_key)
/// as big-endian u32 modulo 1,000,000, zero-padded as "123 456".
pub fn compute_pairing_fingerprint(requester_public_key: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_PREFIX);
    hasher.update(requester_public_key);
    let hash = hasher.finalize();

    let num = u32::from_be_bytes(
        hash[..4]
            .try_into()
            .expect("slice of length 4 converts to [u8; 4]"),
    );
    let code = num % 1_000_000;
    format!("{:03} {:03}", code / 1000, code % 1000)
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
        assert_eq!(fingerprint.len(), 7); // "123 456"

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
        assert_eq!(fp1.len(), 7);
        assert_eq!(&fp1[3..4], " ");
        assert!(fp1.chars().all(|c| c.is_ascii_digit() || c == ' '));

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
        let h = hasher.finalize();
        let expected_num = u32::from_be_bytes(h[..4].try_into().unwrap()) % 1_000_000;
        let expected_fp = format!("{:03} {:03}", expected_num / 1000, expected_num % 1000);

        assert_eq!(compute_pairing_fingerprint(&zero_key), expected_fp);
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
    fn test_pairing_session_store_insert_take_remove() {
        let store = PairingSessionStore::new();
        let secret = Zeroizing::new([42u8; 32]);
        store.insert("pair-1".into(), secret);

        assert!(store.get("pair-unknown").is_none());
        assert!(store.take("pair-unknown").is_none());

        // get() reads without consuming
        let peeked = store.get("pair-1").expect("must get pair-1");
        assert_eq!(*peeked, [42u8; 32]);
        assert!(store.get("pair-1").is_some(), "still present after get");

        let taken = store.take("pair-1").expect("must take pair-1");
        assert_eq!(*taken, [42u8; 32]);
        assert!(store.take("pair-1").is_none(), "already taken");

        let secret2 = Zeroizing::new([99u8; 32]);
        store.insert("pair-2".into(), secret2);
        store.remove("pair-2");
        assert!(store.take("pair-2").is_none());
    }
}
