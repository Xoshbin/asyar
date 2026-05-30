//! Argon2id key derivation for E2EE wrap-key derivation.
//!
//! Parameters match OWASP 2024 recommendations and the existing
//! `profile::encryption` legacy profile-export module:
//! `m = 65536 KiB`, `t = 3`, `p = 1`, output = 32 bytes.
//!
//! Used by `sync::e2ee::service` to derive a `wrap_key` from a user
//! passphrase + per-account random salt.

use crate::error::AppError;
use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

pub const ARGON2_M_COST: u32 = 65536; // 64 MiB
pub const ARGON2_T_COST: u32 = 3;
pub const ARGON2_P_COST: u32 = 1;
pub const KEY_LEN: usize = 32;

pub fn derive_wrap_key(
    passphrase: &str,
    salt: &[u8],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Zeroizing<[u8; KEY_LEN]>, AppError> {
    if salt.len() < 8 {
        return Err(AppError::Validation("salt must be at least 8 bytes".into()));
    }
    let params = Params::new(m_cost, t_cost, p_cost, Some(KEY_LEN))
        .map_err(|e| AppError::Encryption(format!("argon2 params: {e}")))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut *out)
        .map_err(|e| AppError::Encryption(format!("argon2 derive: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_wrap_key_returns_32_bytes() {
        let salt = [7u8; 32];
        let key = derive_wrap_key(
            "hunter2hunter2",
            &salt,
            ARGON2_M_COST,
            ARGON2_T_COST,
            ARGON2_P_COST,
        )
        .unwrap();
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn derive_wrap_key_is_deterministic() {
        let salt = [9u8; 32];
        let a = derive_wrap_key("same-passphrase", &salt, 16384, 2, 1).unwrap();
        let b = derive_wrap_key("same-passphrase", &salt, 16384, 2, 1).unwrap();
        assert_eq!(*a, *b);
    }

    #[test]
    fn derive_wrap_key_differs_for_different_passphrase() {
        let salt = [9u8; 32];
        let a = derive_wrap_key("passphrase-a", &salt, 16384, 2, 1).unwrap();
        let b = derive_wrap_key("passphrase-b", &salt, 16384, 2, 1).unwrap();
        assert_ne!(*a, *b);
    }

    #[test]
    fn derive_wrap_key_differs_for_different_salt() {
        let a = derive_wrap_key("same", &[1u8; 32], 16384, 2, 1).unwrap();
        let b = derive_wrap_key("same", &[2u8; 32], 16384, 2, 1).unwrap();
        assert_ne!(*a, *b);
    }

    #[test]
    fn derive_wrap_key_rejects_short_salt() {
        let err = derive_wrap_key("p", &[1u8; 4], 16384, 2, 1).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
