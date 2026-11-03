//! 128px copies of an extension's bundled icons, written once at install.
//!
//! A 512px PNG shown in a 22px row still costs about 1 MB once decoded. A
//! 128px copy covers every icon surface at up to 300% display scaling and
//! costs about 64 KB. Each copy is a hidden file next to its original, so
//! uninstalling or updating the extension removes it with the folder.
//!
//! Icon URLs carry [`COPY_QUERY`], and `asyar-extension://` serves the copy
//! when one exists. Small images, SVGs, GIFs (which may be animated), dev
//! extensions and installs from before this change have no copy and get
//! the original.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Query marker on icon URLs: "serve the icon-sized copy if there is one".
pub const COPY_QUERY: &str = "icon";

/// Longest side of a copy, in pixels.
pub const COPY_SIZE: u32 = 128;

/// Formats worth a copy. GIF is left out so animated icons keep animating.
const COPY_FORMATS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];

/// Sources larger than this on either side are skipped rather than decoded,
/// so a hostile package can't make the installer allocate gigabytes.
const MAX_SOURCE_SIDE: u32 = 8192;

/// Where the copy of `original` lives: `dir/icon.png` → `dir/.icon.png.128.png`.
pub fn copy_path(original: &Path) -> PathBuf {
    let name = original
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    original.with_file_name(format!(".{name}.{COPY_SIZE}.png"))
}

/// Writes a copy for every large raster icon in `raw_icons` (raw manifest
/// strings) found inside `ext_dir`. Never fails: a bad icon only means that
/// icon is served at full size. Returns how many copies were written.
pub fn write_copies<'a>(ext_dir: &Path, raw_icons: impl IntoIterator<Item = &'a str>) -> usize {
    let mut seen = HashSet::new();
    raw_icons
        .into_iter()
        .filter_map(super::bundled_icon_path)
        .filter_map(|rel| locate(ext_dir, rel))
        .filter(|original| seen.insert(original.clone()))
        .filter(|original| write_copy(original))
        .count()
}

/// Same lookup order as `asyar-extension://` uses for installed extensions.
fn locate(ext_dir: &Path, rel: &str) -> Option<PathBuf> {
    [ext_dir.join("dist").join(rel), ext_dir.join(rel)]
        .into_iter()
        .find(|p| p.is_file())
}

fn write_copy(original: &Path) -> bool {
    let is_copy_format = original
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| COPY_FORMATS.contains(&e.to_ascii_lowercase().as_str()));
    if !is_copy_format {
        return false;
    }
    let (w, h) = match image::image_dimensions(original) {
        Ok(dims) => dims,
        Err(e) => {
            log::warn!("Skipping icon copy for {original:?}: {e}");
            return false;
        }
    };
    if w.max(h) <= COPY_SIZE || w.max(h) > MAX_SOURCE_SIDE {
        return false;
    }
    match crate::thumbnail::image_thumb::generate(original, &copy_path(original), COPY_SIZE) {
        Ok(()) => true,
        Err(e) => {
            log::warn!("Could not write icon copy for {original:?}: {e}");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_png(path: &Path, w: u32, h: u32) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        image::DynamicImage::ImageRgb8(image::RgbImage::new(w, h))
            .save_with_format(path, image::ImageFormat::Png)
            .unwrap();
    }

    #[test]
    fn copy_sits_hidden_next_to_its_original() {
        assert_eq!(
            copy_path(Path::new("/ext/dist/assets/icon.png")),
            Path::new("/ext/dist/assets/.icon.png.128.png")
        );
    }

    #[test]
    fn large_raster_icons_get_a_128px_copy() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("dist/assets/icon.png");
        write_png(&original, 512, 256);

        assert_eq!(write_copies(dir.path(), ["assets/icon.png"]), 1);

        let (w, h) = image::image_dimensions(copy_path(&original)).unwrap();
        assert_eq!((w, h), (128, 64), "aspect ratio is kept");
    }

    #[test]
    fn icons_at_the_root_are_found_when_dist_has_none() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("icon.png");
        write_png(&original, 300, 300);

        assert_eq!(write_copies(dir.path(), ["icon.png"]), 1);
        assert!(copy_path(&original).is_file());
    }

    #[test]
    fn small_vector_animated_and_unsafe_icons_are_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        write_png(&dir.path().join("small.png"), 128, 96);
        std::fs::write(dir.path().join("logo.svg"), b"<svg/>").unwrap();
        write_png(&dir.path().join("spin.gif"), 512, 512);
        write_png(&dir.path().join("big.png"), 512, 512);

        let written = write_copies(
            dir.path(),
            [
                "small.png",
                "logo.svg",
                "spin.gif",
                "../big.png",
                "icon:timer",
                "🍅",
                "missing.png",
            ],
        );

        assert_eq!(written, 0);
        assert!(!copy_path(&dir.path().join("small.png")).exists());
    }

    #[test]
    fn a_broken_image_never_fails_the_install() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("broken.png"), b"not a png").unwrap();
        assert_eq!(write_copies(dir.path(), ["broken.png"]), 0);
    }

    #[test]
    fn the_same_icon_listed_twice_is_written_once() {
        let dir = tempfile::tempdir().unwrap();
        write_png(&dir.path().join("icon.png"), 512, 512);
        assert_eq!(write_copies(dir.path(), ["icon.png", "./icon.png"]), 1);
    }
}
