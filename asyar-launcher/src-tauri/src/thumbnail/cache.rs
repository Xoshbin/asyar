//! Thumbnail cache: directory resolution, content-addressed key derivation,
//! and a size-capped eviction sweep. Mirrors the app-icon cache
//! (`application::service::get_icon_cache_dir` / `extract_app_icon`) —
//! same shape, different invalidation semantics: an app icon is keyed by
//! install path alone (apps rarely change in place), but an arbitrary file
//! can be edited, so the key must include `mtime` + `size` too.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Total on-disk budget for `thumbnail_cache/`. Sweeps evict the
/// least-recently-generated entries first once this is exceeded.
pub const CACHE_CAP_BYTES: u64 = 300 * 1024 * 1024;

pub fn get_thumbnail_cache_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|p| p.join("thumbnail_cache"))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/asyar_thumbnail_cache"))
}

/// Deterministic cache-key filename for `(path, mtime, size, max_dim)`.
/// Any edit (mtime/size change) or a different requested size produces a
/// new key — stale entries are simply orphaned, not overwritten, and get
/// swept by `evict_if_over_cap`.
pub fn cache_key(path: &Path, mtime: u64, size: u64, max_dim: u32) -> String {
    let mut h = fnv::FnvHasher::default();
    path.to_string_lossy().hash(&mut h);
    mtime.hash(&mut h);
    size.hash(&mut h);
    max_dim.hash(&mut h);
    format!("{:016x}.png", h.finish())
}

/// Sweeps `cache_dir` if its total size exceeds `cap_bytes`, deleting the
/// oldest-by-mtime entries first until back under budget. `mtime` is used
/// as the recency signal (write time doubles as "last generated") since
/// access-time tracking is unreliable across platforms/filesystems.
pub fn evict_if_over_cap(cache_dir: &Path, cap_bytes: u64) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            Some((e.path(), meta.len(), mtime))
        })
        .collect();

    let total: u64 = files.iter().map(|(_, len, _)| len).sum();
    if total <= cap_bytes {
        return;
    }

    files.sort_by_key(|(_, _, mtime)| *mtime);
    let mut over = total - cap_bytes;
    for (path, len, _) in files {
        if over == 0 {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            over = over.saturating_sub(len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;

    fn tmp_dir(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "thumb_cache_test_{name}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn cache_key_is_deterministic() {
        let p = Path::new("/tmp/a.jpg");
        let a = cache_key(p, 1000, 2000, 28);
        let b = cache_key(p, 1000, 2000, 28);
        assert_eq!(a, b);
        assert!(a.ends_with(".png"));
    }

    #[test]
    fn cache_key_changes_with_mtime_size_or_dimension() {
        let p = Path::new("/tmp/a.jpg");
        let base = cache_key(p, 1000, 2000, 28);
        assert_ne!(base, cache_key(p, 1001, 2000, 28), "mtime change");
        assert_ne!(base, cache_key(p, 1000, 2001, 28), "size change (edit)");
        assert_ne!(
            base,
            cache_key(p, 1000, 2000, 800),
            "different requested size"
        );
    }

    #[test]
    fn cache_key_differs_per_path() {
        let a = cache_key(Path::new("/tmp/a.jpg"), 1, 1, 28);
        let b = cache_key(Path::new("/tmp/b.jpg"), 1, 1, 28);
        assert_ne!(a, b);
    }

    #[test]
    fn eviction_is_a_no_op_under_cap() {
        let dir = tmp_dir("under");
        fs::write(dir.join("a.png"), vec![0u8; 100]).unwrap();
        evict_if_over_cap(&dir, 1_000_000);
        assert!(dir.join("a.png").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn eviction_removes_oldest_first_until_under_cap() {
        let dir = tmp_dir("over");
        fs::write(dir.join("old.png"), vec![0u8; 100]).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::write(dir.join("new.png"), vec![0u8; 100]).unwrap();

        evict_if_over_cap(&dir, 150);

        assert!(
            !dir.join("old.png").exists(),
            "oldest entry must be evicted first"
        );
        assert!(dir.join("new.png").exists(), "newest entry must survive");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn eviction_on_missing_dir_does_not_panic() {
        evict_if_over_cap(Path::new("/definitely/missing/dir"), 100);
    }
}
