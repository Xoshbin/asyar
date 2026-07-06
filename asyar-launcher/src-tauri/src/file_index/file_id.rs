//! Stable file_id derivation.
//!
//! file_id is a deterministic FNV hash of (volume identifier, inode/file
//! index) so per-query learning and pins survive a rename within a volume.
//! Internally the id is a `u64`; the wire and SQL forms are 16-char
//! lowercase hex (JS-safe, matches the learning/pinned table schemas).

use fnv::FnvHasher;
use std::hash::Hasher;
use std::path::Path;

/// Returns the stable u64 file id for the given path's inode (Unix) or
/// file index (Windows).
///
/// Falls back to hashing the path string if the OS lookup fails — that
/// keeps learning *path-stable* even if not *rename-stable*, which is the
/// correct degradation.
pub fn derive_u64(path: &Path) -> u64 {
    let (volume_id, inode) = inode_for(path).unwrap_or((0, hash_path(path)));
    let mut h = FnvHasher::default();
    h.write_u64(volume_id);
    h.write_u64(inode);
    h.finish()
}

/// 16-char lowercase hex wire/SQL form.
pub fn to_hex(id: u64) -> String {
    format!("{id:016x}")
}

/// Parses the 16-char hex wire form back to the internal u64.
pub fn from_hex(s: &str) -> Option<u64> {
    if s.len() != 16 {
        return None;
    }
    u64::from_str_radix(s, 16).ok()
}

/// FNV hash of the full path string. Used as the index's path-lookup key
/// and as the file-id fallback for paths that can't be stat'ed.
pub(crate) fn hash_path(path: &Path) -> u64 {
    let mut h = FnvHasher::default();
    h.write(path.to_string_lossy().as_bytes());
    h.finish()
}

/// Folds a 128-bit value into 64 bits by XORing both halves, preserving
/// entropy from both instead of truncating to the low bits.
fn fold_u128(x: u128) -> u64 {
    (x as u64) ^ ((x >> 64) as u64)
}

/// Cross-platform (volume/device, file) identity via the `file-id` crate —
/// `std::os::windows::fs::MetadataExt`'s `volume_serial_number`/`file_index`
/// are nightly-only (`windows_by_handle`, rust-lang/rust#63010) and can
/// never compile on stable Rust, which this replaces uniformly for both
/// platforms.
fn inode_for(path: &Path) -> Option<(u64, u64)> {
    match file_id::get_file_id(path).ok()? {
        file_id::FileId::Inode {
            device_id,
            inode_number,
        } => Some((device_id, inode_number)),
        file_id::FileId::LowRes {
            volume_serial_number,
            file_index,
        } => Some((volume_serial_number as u64, file_index)),
        file_id::FileId::HighRes {
            volume_serial_number,
            file_id,
        } => Some((volume_serial_number, fold_u128(file_id))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_is_deterministic_for_same_path() {
        let tmp = std::env::temp_dir();
        let p = tmp.join("file_id_test.txt");
        std::fs::write(&p, "x").unwrap();
        let a = derive_u64(&p);
        let b = derive_u64(&p);
        assert_eq!(a, b);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn derive_differs_for_different_paths() {
        let tmp = std::env::temp_dir();
        let p1 = tmp.join("file_id_a.txt");
        let p2 = tmp.join("file_id_b.txt");
        std::fs::write(&p1, "x").unwrap();
        std::fs::write(&p2, "y").unwrap();
        assert_ne!(derive_u64(&p1), derive_u64(&p2));
        let _ = std::fs::remove_file(&p1);
        let _ = std::fs::remove_file(&p2);
    }

    #[test]
    fn derive_falls_back_to_path_hash_for_missing_file() {
        let p = std::path::PathBuf::from("/definitely/does/not/exist/x.txt");
        let a = derive_u64(&p);
        let b = derive_u64(&p);
        assert_eq!(a, b);
        assert_ne!(a, 0);
    }

    #[test]
    fn fold_u128_combines_both_64bit_halves() {
        assert_eq!(fold_u128(0x1), 1, "low half only");
        assert_eq!(fold_u128(1u128 << 64), 1, "high half only");
        assert_eq!(fold_u128((5u128 << 64) | 3), 5 ^ 3, "both halves XORed");
        assert_eq!(fold_u128(0), 0);
    }

    #[test]
    fn hex_round_trip() {
        for id in [0u64, 1, 0xdead_beef_cafe_f00d, u64::MAX] {
            let hex = to_hex(id);
            assert_eq!(hex.len(), 16, "got {hex}");
            assert_eq!(hex, hex.to_lowercase());
            assert_eq!(from_hex(&hex), Some(id));
        }
    }

    #[test]
    fn from_hex_rejects_garbage() {
        assert_eq!(from_hex(""), None);
        assert_eq!(from_hex("zzzzzzzzzzzzzzzz"), None);
        assert_eq!(from_hex("abc"), None); // wrong length
        assert_eq!(from_hex("00000000000000000"), None); // 17 chars
    }
}
