//! Cross-platform image downscaling via the `image` crate. This is the one
//! file-type family every OS can thumbnail identically in Rust — no need
//! to shell out, unlike PDFs/video/docs which get an OS-native path on
//! macOS (`thumbnail::macos`) and no thumbnail yet elsewhere.

use std::path::Path;

const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

pub fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Decodes `path`, downscales (aspect-preserving) so neither dimension
/// exceeds `max_dim`, and writes a PNG to `dest`. Images already at or
/// under `max_dim` are left at their original size — `DynamicImage`'s own
/// `.thumbnail()` upscales to fill the box, which would blur small source
/// images instead of leaving them alone.
pub fn generate(path: &Path, dest: &Path, max_dim: u32) -> Result<(), String> {
    let img = image::open(path).map_err(|e| e.to_string())?;
    let thumb = if img.width() <= max_dim && img.height() <= max_dim {
        img
    } else {
        img.thumbnail(max_dim, max_dim)
    };
    let tmp = dest.with_extension("tmp");
    thumb
        .save_with_format(&tmp, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // `name`'s own extension (e.g. `.png`) must stay the last path segment
    // for `Path::extension()` to parse correctly — the uniqueness suffix
    // goes before it, not after.
    fn tmp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "image_thumb_test_{}_{}_{name}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn write_fixture_png(path: &std::path::Path, w: u32, h: u32) {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([200, 100, 50]));
        image::DynamicImage::ImageRgb8(img)
            .save_with_format(path, image::ImageFormat::Png)
            .unwrap();
    }

    #[test]
    fn is_supported_image_recognises_common_extensions() {
        assert!(is_supported_image(std::path::Path::new("a.png")));
        assert!(is_supported_image(std::path::Path::new("a.JPG")));
        assert!(!is_supported_image(std::path::Path::new("a.pdf")));
        assert!(!is_supported_image(std::path::Path::new("a")));
    }

    #[test]
    fn generate_downscales_and_writes_a_valid_png() {
        let src = tmp_path("src.png");
        let dest = tmp_path("dest.png");
        write_fixture_png(&src, 400, 200);

        generate(&src, &dest, 100).unwrap();

        let out = image::open(&dest).unwrap();
        assert!(out.width() <= 100 && out.height() <= 100);
        // Aspect ratio preserved (2:1 source).
        assert_eq!(out.width(), out.height() * 2);
        assert!(!dest.with_extension("tmp").exists(), "tmp file must be renamed away");

        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn generate_leaves_small_images_undownscaled_dimensions_within_bound() {
        let src = tmp_path("small_src.png");
        let dest = tmp_path("small_dest.png");
        write_fixture_png(&src, 20, 10);

        generate(&src, &dest, 100).unwrap();

        let out = image::open(&dest).unwrap();
        assert_eq!((out.width(), out.height()), (20, 10));

        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn generate_fails_gracefully_on_missing_source() {
        let dest = tmp_path("missing_dest.png");
        let result = generate(std::path::Path::new("/definitely/missing.png"), &dest, 100);
        assert!(result.is_err());
    }
}
