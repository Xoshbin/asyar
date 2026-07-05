//! File-preview thumbnail generation, cached and served the same way
//! application icons already are (`asyar-icon://` → `icon_cache/`): a
//! content-addressed PNG on disk, served via a dedicated custom URI scheme
//! (`asyar-thumb://` → `thumbnail_cache/`).
//!
//! Unlike the JS-side preview it replaces, none of this is subject to the
//! webview's `@tauri-apps/plugin-fs` capability scope — Rust reads the
//! source file directly, so a path outside the declared fs-scope (which
//! only ever covered `$APPDATA/extensions/**` and
//! `$APPDATA/clipboard_cache/**`, never arbitrary `$HOME` paths) still
//! works.
//!
//! Cross-platform: images are downscaled with the `image` crate. On
//! macOS, every other previewable type (PDF, video, docs, archives, code)
//! goes through `qlmanage -t` — the same Quick Look thumbnailing service
//! Finder itself uses — so no per-type Rust decoder is needed there.
//! Windows/Linux get image-only thumbnails in this pass; other types fall
//! back to the frontend's existing type/metadata display (documented
//! follow-up: native shell thumbnail providers per OS).

pub mod cache;
pub mod commands;
pub mod image_thumb;

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "linux")]
pub mod linux;

use std::path::{Path, PathBuf};

/// Caps concurrent thumbnail generations (image decode or `qlmanage`
/// subprocess) so opening a folder full of never-before-seen large
/// files doesn't spawn dozens of decoders/processes at once.
const MAX_CONCURRENT_GENERATIONS: usize = 3;

pub struct ThumbnailState {
    semaphore: tokio::sync::Semaphore,
}

impl Default for ThumbnailState {
    fn default() -> Self {
        Self {
            semaphore: tokio::sync::Semaphore::new(MAX_CONCURRENT_GENERATIONS),
        }
    }
}

/// Returns a cached or freshly-generated thumbnail's absolute path, or
/// `None` when this file type/platform combination has no thumbnail
/// strategy (the frontend keeps its existing fallback in that case).
pub async fn get_or_generate(
    state: &ThumbnailState,
    cache_dir: &Path,
    path: &Path,
    max_dim: u32,
) -> Option<PathBuf> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let key = cache::cache_key(path, mtime, meta.len(), max_dim);
    let cached = cache_dir.join(&key);
    if tokio::fs::metadata(&cached).await.is_ok() {
        return Some(cached);
    }

    let _permit = state.semaphore.acquire().await.ok()?;
    // Re-check after acquiring the permit — a concurrent request for the
    // same file may have generated it while we waited.
    if tokio::fs::metadata(&cached).await.is_ok() {
        return Some(cached);
    }

    let _ = tokio::fs::create_dir_all(cache_dir).await;
    generate(path, &cached, max_dim).await?;
    cache::evict_if_over_cap(cache_dir, cache::CACHE_CAP_BYTES);
    Some(cached)
}

async fn generate(path: &Path, dest: &Path, max_dim: u32) -> Option<()> {
    let path = path.to_path_buf();
    let dest_owned = dest.to_path_buf();
    let is_image = image_thumb::is_supported_image(&path);

    tokio::task::spawn_blocking(move || {
        if is_image {
            return image_thumb::generate(&path, &dest_owned, max_dim).ok();
        }
        #[cfg(target_os = "macos")]
        let result = macos::generate_via_quicklook(&path, &dest_owned, max_dim);
        #[cfg(target_os = "windows")]
        let result = windows::generate_via_quicklook(&path, &dest_owned, max_dim);
        #[cfg(target_os = "linux")]
        let result = linux::generate_via_quicklook(&path, &dest_owned, max_dim);
        result.ok()
    })
    .await
    .ok()
    .flatten()
}
