//! Owns the on-disk file behind an `image` clipboard entry.
//!
//! The clipboard plugin writes every copied image to
//! `$APPDATA/tauri-plugin-clipboard-x/images/<hash>.png`, keyed by a hash of
//! the pixel bytes — so two history rows holding the same image share one
//! file, and deleting either row would break the other. It also never cleans
//! that directory up.
//!
//! So each captured image is *moved* out of the plugin's directory into
//! `$APPDATA/clipboard_cache/<item-id>.png`, giving the row sole ownership of
//! its file. A move (not a copy) because both live under `$APPDATA`, so the
//! rename is O(1) and leaves one file on disk instead of two; the plugin
//! re-encodes on the next identical copy anyway (it only skips writing when
//! the hash path still exists).
//!
//! Like `thumbnail`, this deliberately lives in Rust rather than going
//! through `@tauri-apps/plugin-fs`: the webview's fs capability grants no
//! write, copy, rename, or remove anywhere, and widening it to cover this
//! would hand the webview a general write primitive in the app data
//! directory for the sake of one internal file move.

use std::path::{Path, PathBuf};

pub mod commands;

/// Directory holding one PNG per `image` clipboard row, named by item id.
pub fn cache_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("clipboard_cache")
}

/// Where the row with `id` keeps its image.
///
/// `id` is a uuid minted by the capture path, but it arrives from the
/// webview, so it is validated rather than trusted: anything that is not a
/// plain `[A-Za-z0-9_-]` token is rejected so a crafted id cannot escape the
/// cache directory or overwrite a file elsewhere.
pub fn cached_image_path(app_data_dir: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid clipboard item id: {id:?}"));
    }
    Ok(cache_dir(app_data_dir).join(format!("{id}.png")))
}

/// True when `path` is a file directly inside the cache directory.
///
/// Guards the delete command: without it, the webview could name any path on
/// disk and have Rust unlink it.
pub fn is_cached_image(app_data_dir: &Path, path: &Path) -> bool {
    path.parent() == Some(cache_dir(app_data_dir).as_path())
}

/// Moves `source` to the cache slot for `id` and returns that path.
///
/// Falls back to copy-then-delete if the rename fails — the plugin's image
/// directory is normally the same volume as ours, but a user who has
/// relocated app data (or a `saveImagePath` override) could put them on
/// different ones, and `rename` cannot cross a filesystem boundary.
pub fn adopt_image(app_data_dir: &Path, id: &str, source: &Path) -> Result<PathBuf, String> {
    let dest = cached_image_path(app_data_dir, id)?;

    if source == dest {
        return Ok(dest);
    }

    let dir = cache_dir(app_data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    if std::fs::rename(source, &dest).is_ok() {
        return Ok(dest);
    }

    std::fs::copy(source, &dest)
        .map_err(|e| format!("copy {} -> {}: {e}", source.display(), dest.display()))?;
    // Best-effort: the copy is what matters; a leftover source is only
    // wasted space, and the plugin's directory already accumulates.
    let _ = std::fs::remove_file(source);
    Ok(dest)
}

/// Deletes a cached image. No-op for a path outside the cache directory or a
/// file that is already gone.
pub fn forget_image(app_data_dir: &Path, path: &Path) -> Result<(), String> {
    if !is_cached_image(app_data_dir, path) {
        return Ok(());
    }
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "asyar_clipcache_{tag}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn cache_dir_hangs_off_app_data() {
        let root = Path::new("/some/app/data");
        assert_eq!(cache_dir(root), Path::new("/some/app/data/clipboard_cache"));
    }

    #[test]
    fn cached_image_path_is_the_id_as_png() {
        let root = Path::new("/some/app/data");
        assert_eq!(
            cached_image_path(root, "abc-123").unwrap(),
            Path::new("/some/app/data/clipboard_cache/abc-123.png")
        );
    }

    #[test]
    fn cached_image_path_rejects_ids_that_would_escape_the_cache() {
        let root = Path::new("/some/app/data");
        for bad in ["../../etc/passwd", "a/b", "", "id with space", "id.png"] {
            assert!(
                cached_image_path(root, bad).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
    }

    #[test]
    fn adopt_image_moves_the_source_file() {
        let root = temp_root("adopt");
        let source = root.join("plugin_images/998877.png");
        write(&source, b"pixels");

        let dest = adopt_image(&root, "item-1", &source).unwrap();

        assert_eq!(dest, root.join("clipboard_cache/item-1.png"));
        assert_eq!(std::fs::read(&dest).unwrap(), b"pixels");
        assert!(
            !source.exists(),
            "source should have been moved, not copied"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn adopt_image_creates_the_cache_directory() {
        let root = temp_root("mkdir");
        let source = root.join("plugin_images/1.png");
        write(&source, b"x");

        assert!(!cache_dir(&root).exists());
        adopt_image(&root, "item-1", &source).unwrap();
        assert!(cache_dir(&root).is_dir());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn adopt_image_is_idempotent_for_an_already_adopted_file() {
        let root = temp_root("idem");
        let source = root.join("plugin_images/1.png");
        write(&source, b"x");

        let first = adopt_image(&root, "item-1", &source).unwrap();
        let second = adopt_image(&root, "item-1", &first).unwrap();

        assert_eq!(first, second);
        assert_eq!(std::fs::read(&second).unwrap(), b"x");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn adopt_image_reports_a_missing_source() {
        let root = temp_root("missing");
        let err = adopt_image(&root, "item-1", &root.join("nope.png")).unwrap_err();
        assert!(err.contains("nope.png"), "unhelpful error: {err}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn forget_image_deletes_a_cached_file() {
        let root = temp_root("forget");
        let path = cache_dir(&root).join("item-1.png");
        write(&path, b"x");

        forget_image(&root, &path).unwrap();
        assert!(!path.exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn forget_image_ignores_an_already_deleted_file() {
        let root = temp_root("forget_missing");
        let path = cache_dir(&root).join("item-1.png");
        assert!(forget_image(&root, &path).is_ok());
        std::fs::remove_dir_all(&root).ok();
    }

    // Legacy rows still point at the plugin's shared, hash-addressed file.
    // Deleting one of those would break every other row holding the same
    // image, so paths outside the cache must be left alone.
    #[test]
    fn forget_image_refuses_paths_outside_the_cache() {
        let root = temp_root("forget_outside");
        let outside = root.join("plugin_images/998877.png");
        write(&outside, b"shared");

        forget_image(&root, &outside).unwrap();
        assert!(outside.exists(), "must not delete outside the cache dir");

        let nested = cache_dir(&root).join("sub/item.png");
        write(&nested, b"nested");
        forget_image(&root, &nested).unwrap();
        assert!(nested.exists(), "only direct children are cache entries");

        std::fs::remove_dir_all(&root).ok();
    }
}
