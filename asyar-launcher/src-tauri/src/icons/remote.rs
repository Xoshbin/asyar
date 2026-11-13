//! Remote extension icons.
//!
//! An extension may return an `https://` icon from a search result or action.
//! The webview never loads that URL directly: the host fetches it through the
//! same scoped network path as extension requests (permission, private-network
//! and LAN checks), shrinks raster icons to 128px, and caches the bytes
//! under `icon_cache/`. The row then receives an `asyar-icon://` URL.
//!
//! SVG and GIF pass through unchanged: an SVG stays sharp at every size, and a
//! GIF may be animated. Both are only ever rendered by an `<img>` or CSS mask,
//! never `{@html}`.

use crate::error::AppError;
use crate::network::client_pool::ScopedHttpClientPool;
use crate::network::lan_policy::LanPolicy;
use crate::network::service::{fetch_scoped_bytes, FetchRequest};
use sha2::{Digest, Sha256};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Longest side of a cached raster icon, in pixels. Matches the bundled-icon
/// copies so every icon surface gets the same density at up to 300% scaling.
const COPY_SIZE: u32 = 128;

/// A remote icon body larger than this is refused before it is decoded.
pub const MAX_ICON_BYTES: usize = 2 * 1024 * 1024;

/// Sources larger than this on either side are refused rather than decoded,
/// so a hostile icon can't make the launcher allocate gigabytes.
const MAX_SOURCE_SIDE: u32 = 8192;

/// Ceiling for the decoder's own allocations.
const MAX_DECODE_ALLOC: u64 = 64 * 1024 * 1024;

const CACHE_PREFIX: &str = "remote-";
const CACHE_EXTENSIONS: [&str; 3] = ["png", "svg", "gif"];

/// A processed icon ready to be written to the cache.
#[derive(Debug)]
pub struct ProcessedIcon {
    pub bytes: Vec<u8>,
    pub extension: &'static str,
}

/// The `icon_cache/` directory shared with application icons and served by
/// `asyar-icon://`.
pub fn icon_cache_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|path| path.join("icon_cache"))
        .unwrap_or_else(|_| {
            #[cfg(target_os = "windows")]
            {
                app.path()
                    .app_local_data_dir()
                    .unwrap_or_default()
                    .join("icon_cache")
            }
            #[cfg(not(target_os = "windows"))]
            {
                PathBuf::from("/tmp/asyar_icon_cache")
            }
        })
}

/// Cache key for one extension's icon URL. The owner is part of the key so two
/// extensions can never share a cached file, and the URL is hashed so no part
/// of it becomes a path.
pub fn cache_key(extension_id: &str, url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(extension_id.as_bytes());
    hasher.update([0]);
    hasher.update(url.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Returns the cached filename for `key`, if one of the supported formats is
/// already present.
pub fn cached_icon(cache_dir: &Path, key: &str) -> Option<String> {
    CACHE_EXTENSIONS.iter().find_map(|extension| {
        let filename = format!("{CACHE_PREFIX}{key}.{extension}");
        cache_dir.join(&filename).is_file().then_some(filename)
    })
}

fn icon_url(filename: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("http://asyar-icon.localhost/{filename}")
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("asyar-icon://localhost/{filename}")
    }
}

/// Fetches, processes and caches a remote icon, returning its `asyar-icon://`
/// URL. The caller must already have checked the extension's `network`
/// permission: that check intentionally runs before the cache lookup so a
/// revoked permission always yields a fallback.
pub async fn fetch_remote_icon(
    extension_id: &str,
    url: &str,
    cache_dir: &Path,
    lan_policy: Option<&LanPolicy>,
    client_pool: &ScopedHttpClientPool,
) -> Result<String, AppError> {
    validate_owner(extension_id)?;
    validate_remote_url(url)?;

    let key = cache_key(extension_id, url);
    if let Some(filename) = cached_icon(cache_dir, &key) {
        return Ok(icon_url(&filename));
    }

    let fetched = fetch_scoped_bytes(
        FetchRequest {
            url: url.to_string(),
            method: None,
            headers: None,
            body: None,
            timeout_ms: Some(10_000),
        },
        MAX_ICON_BYTES,
        true,
        lan_policy,
        Some(extension_id),
        client_pool,
    )
    .await?;

    if !(200..300).contains(&fetched.status) {
        return Err(AppError::Validation(format!(
            "Remote icon request returned HTTP {}",
            fetched.status
        )));
    }
    // A redirect must not downgrade the icon to plain HTTP.
    if !fetched.url.starts_with("https://") {
        return Err(AppError::Validation(
            "Remote icons must be served over HTTPS".into(),
        ));
    }

    let dir = cache_dir.to_path_buf();
    let filename = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let processed = process_remote_icon(&fetched.bytes)?;
        let filename = format!("{CACHE_PREFIX}{key}.{}", processed.extension);
        write_cache_file(&dir, &filename, &processed.bytes)?;
        Ok(filename)
    })
    .await
    .map_err(|error| AppError::Other(format!("Remote icon worker failed: {error}")))??;

    Ok(icon_url(&filename))
}

/// Remote icons are only allowed for a real extension owner. `None`/`asyar`
/// are the host's privileged identities, and letting them through would bypass
/// the permission check entirely.
pub(crate) fn validate_owner(extension_id: &str) -> Result<(), AppError> {
    if extension_id.is_empty() || extension_id == "asyar" {
        return Err(AppError::Permission(
            "Remote icons require an extension caller".into(),
        ));
    }
    Ok(())
}

fn validate_remote_url(url: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url)
        .map_err(|_| AppError::Validation("Remote icon URL is invalid".into()))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Validation(
            "Remote icons must use https://".into(),
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::Validation(
            "Remote icon URLs cannot contain credentials".into(),
        ));
    }
    Ok(())
}

/// Turns fetched bytes into a cacheable icon. Raster formats are decoded,
/// resized to at most 128px on the longest side, and re-encoded as PNG
/// (which also strips metadata). SVG and GIF pass through byte-for-byte.
pub fn process_remote_icon(bytes: &[u8]) -> Result<ProcessedIcon, AppError> {
    if bytes.is_empty() {
        return Err(AppError::Validation("Remote icon is empty".into()));
    }
    if is_gif(bytes) {
        return Ok(ProcessedIcon {
            bytes: bytes.to_vec(),
            extension: "gif",
        });
    }
    if is_svg(bytes) {
        return Ok(ProcessedIcon {
            bytes: bytes.to_vec(),
            extension: "svg",
        });
    }
    resize_raster(bytes)
}

fn is_gif(bytes: &[u8]) -> bool {
    bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
}

fn is_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(4096)];
    String::from_utf8_lossy(head)
        .to_ascii_lowercase()
        .contains("<svg")
}

fn resize_raster(bytes: &[u8]) -> Result<ProcessedIcon, AppError> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| {
            AppError::Validation(format!("Remote icon is not a readable image: {error}"))
        })?;
    reader.limits({
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(MAX_SOURCE_SIDE);
        limits.max_image_height = Some(MAX_SOURCE_SIDE);
        limits.max_alloc = Some(MAX_DECODE_ALLOC);
        limits
    });
    let image = reader.decode().map_err(|error| {
        AppError::Validation(format!("Remote icon could not be decoded: {error}"))
    })?;

    let resized = if image.width().max(image.height()) > COPY_SIZE {
        image.resize(COPY_SIZE, COPY_SIZE, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };

    let mut png = Vec::new();
    resized
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| {
            AppError::Validation(format!("Remote icon could not be encoded: {error}"))
        })?;

    Ok(ProcessedIcon {
        bytes: png,
        extension: "png",
    })
}

fn write_cache_file(cache_dir: &Path, filename: &str, bytes: &[u8]) -> Result<(), AppError> {
    std::fs::create_dir_all(cache_dir)?;
    let mut temp = tempfile::NamedTempFile::new_in(cache_dir)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(cache_dir.join(filename))
        .map_err(|error| AppError::Io(error.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let image = image::DynamicImage::ImageRgb8(image::RgbImage::new(width, height));
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        bytes.into_inner()
    }

    fn pool() -> ScopedHttpClientPool {
        ScopedHttpClientPool::new()
    }

    #[test]
    fn cache_key_is_stable_and_owner_scoped() {
        let key = cache_key("org.x", "https://example.com/x.png");
        assert_eq!(key, cache_key("org.x", "https://example.com/x.png"));
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(key, cache_key("org.y", "https://example.com/x.png"));
        assert_ne!(key, cache_key("org.x", "https://example.com/y.png"));
    }

    #[test]
    fn cached_icon_probes_every_supported_format() {
        let dir = tempfile::tempdir().unwrap();
        let key = "abc";
        assert_eq!(cached_icon(dir.path(), key), None);

        write_cache_file(dir.path(), &format!("{CACHE_PREFIX}{key}.svg"), b"<svg/>").unwrap();
        assert_eq!(
            cached_icon(dir.path(), key),
            Some(format!("{CACHE_PREFIX}{key}.svg"))
        );

        write_cache_file(dir.path(), &format!("{CACHE_PREFIX}{key}.gif"), b"GIF89a").unwrap();
        assert_eq!(
            cached_icon(dir.path(), key),
            Some(format!("{CACHE_PREFIX}{key}.svg")),
            "png/svg/gif probe order is stable"
        );
    }

    #[test]
    fn large_raster_icons_are_resized_to_128px_png() {
        let processed = process_remote_icon(&png_bytes(512, 256)).unwrap();
        assert_eq!(processed.extension, "png");
        let decoded = image::load_from_memory(&processed.bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (128, 64));
    }

    #[test]
    fn small_raster_icons_keep_their_size_but_are_normalised_to_png() {
        let processed = process_remote_icon(&png_bytes(32, 24)).unwrap();
        assert_eq!(processed.extension, "png");
        let decoded = image::load_from_memory(&processed.bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (32, 24));
    }

    #[test]
    fn svg_and_gif_pass_through_unchanged() {
        let svg = br#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>"#;
        let processed = process_remote_icon(svg).unwrap();
        assert_eq!(processed.extension, "svg");
        assert_eq!(processed.bytes, svg);

        let gif = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;";
        let processed = process_remote_icon(gif).unwrap();
        assert_eq!(processed.extension, "gif");
        assert_eq!(processed.bytes, gif);
    }

    #[test]
    fn non_images_and_oversized_sources_are_refused() {
        let error = process_remote_icon(b"not an image").unwrap_err();
        assert!(
            error.to_string().contains("could not be decoded"),
            "{error}"
        );

        let error = process_remote_icon(&png_bytes(MAX_SOURCE_SIDE + 1, 1)).unwrap_err();
        assert!(
            error.to_string().contains("could not be decoded"),
            "{error}"
        );
    }

    #[test]
    fn owners_must_be_real_extensions() {
        for owner in ["", "asyar"] {
            assert!(validate_owner(owner).is_err(), "{owner}");
        }
        assert!(validate_owner("org.x").is_ok());
    }

    #[test]
    fn only_https_urls_without_credentials_are_accepted() {
        assert!(validate_remote_url("https://example.com/x.png").is_ok());
        for url in [
            "http://example.com/x.png",
            "https://user:pass@example.com/x.png",
            "file:///x.png",
            "not a url",
        ] {
            assert!(validate_remote_url(url).is_err(), "{url}");
        }
    }

    #[tokio::test]
    async fn cache_hit_returns_the_asyar_icon_url_without_network() {
        let dir = tempfile::tempdir().unwrap();
        let url = "https://example.com/x.png";
        let key = cache_key("org.x", url);
        write_cache_file(
            dir.path(),
            &format!("{CACHE_PREFIX}{key}.png"),
            &png_bytes(16, 16),
        )
        .unwrap();

        let result = fetch_remote_icon("org.x", url, dir.path(), None, &pool())
            .await
            .unwrap();

        assert_eq!(result, icon_url(&format!("{CACHE_PREFIX}{key}.png")));
    }

    #[tokio::test]
    async fn invalid_owner_or_url_is_rejected_before_the_cache() {
        let dir = tempfile::tempdir().unwrap();
        let url = "https://example.com/x.png";
        let key = cache_key("asyar", url);
        write_cache_file(
            dir.path(),
            &format!("{CACHE_PREFIX}{key}.png"),
            &png_bytes(16, 16),
        )
        .unwrap();

        assert!(fetch_remote_icon("asyar", url, dir.path(), None, &pool())
            .await
            .is_err());
        assert!(fetch_remote_icon(
            "org.x",
            "http://example.com/x.png",
            dir.path(),
            None,
            &pool()
        )
        .await
        .is_err());
    }
}
