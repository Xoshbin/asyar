use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use tauri::{Runtime, WebviewWindow};

/// Configures GTK hints for a Spotlight-style window on Linux.
pub fn setup_spotlight_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::GtkWindowExt;
        let gtk_window = window.gtk_window()?;
        gtk_window.set_type_hint(gdk::WindowTypeHint::Utility);
        gtk_window.set_skip_taskbar_hint(true);
        gtk_window.set_skip_pager_hint(true);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
    }
    Ok(())
}

/// Pure helper: parse the `Icon=` value from a Linux `.desktop` file content.
pub fn parse_desktop_icon_value(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("Icon=") {
            let val = val.trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Common Linux Freedesktop icon search directories.
pub fn default_icon_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/share/icons"));
    }
    dirs.push(PathBuf::from("/usr/local/share/icons"));
    dirs.push(PathBuf::from("/usr/share/icons/hicolor"));
    dirs.push(PathBuf::from("/usr/share/icons/Adwaita"));
    dirs.push(PathBuf::from("/usr/share/icons"));
    dirs.push(PathBuf::from("/usr/share/pixmaps"));
    dirs
}

/// Resolves an icon name/path according to Freedesktop theme conventions.
/// Checks scalable (SVG), standard pixel dimensions, and flat pixmaps.
pub fn resolve_icon_path(icon_value: &str, search_dirs: &[PathBuf]) -> Option<PathBuf> {
    let icon_value = icon_value.trim();
    if icon_value.is_empty() {
        return None;
    }

    // 1. Direct absolute path
    if icon_value.starts_with('/') {
        let p = PathBuf::from(icon_value);
        if p.is_file() {
            return Some(p);
        }
        // If extension was omitted on an absolute path, try common extensions
        for ext in &["svg", "png", "xpm"] {
            let with_ext = PathBuf::from(format!("{icon_value}.{ext}"));
            if with_ext.is_file() {
                return Some(with_ext);
            }
        }
        return None;
    }

    // Strip extension if specified (e.g. "firefox.png" -> "firefox")
    let raw_name = icon_value
        .strip_suffix(".png")
        .or_else(|| icon_value.strip_suffix(".svg"))
        .or_else(|| icon_value.strip_suffix(".xpm"))
        .unwrap_or(icon_value);

    // Prioritized context/size subdirectories
    let subdirs = [
        "scalable/apps",
        "symbolic/apps",
        "512x512/apps",
        "256x256/apps",
        "128x128/apps",
        "64x64/apps",
        "48x48/apps",
        "32x32/apps",
        "24x24/apps",
        "16x16/apps",
        "apps/48",
        "apps",
        "48",
        "32",
        "256",
        "128",
        "64",
    ];
    let extensions = ["svg", "png", "xpm"];

    for base in search_dirs {
        // Direct match in base (e.g. /usr/share/pixmaps/foo.svg, /usr/share/pixmaps/foo.png)
        for ext in &extensions {
            let candidate = base.join(format!("{raw_name}.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        // Subdirectory matches (e.g. /usr/share/icons/hicolor/scalable/apps/foo.svg)
        for subdir in &subdirs {
            for ext in &extensions {
                let candidate = base.join(subdir).join(format!("{raw_name}.{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

/// Extracts an application icon from a Linux .desktop file by searching icon themes.
pub fn extract_icon(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut content = String::new();
    for line in reader.lines().map_while(Result::ok) {
        content.push_str(&line);
        content.push('\n');
    }

    let icon_value = parse_desktop_icon_value(&content)?;
    let search_dirs = default_icon_search_dirs();
    let resolved = resolve_icon_path(&icon_value, &search_dirs)?;
    std::fs::read(resolved).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parse_desktop_icon_value_finds_icon_entry() {
        let content = "[Desktop Entry]\nType=Application\nName=Firefox\nIcon=org.mozilla.firefox\nExec=firefox\n";
        assert_eq!(
            parse_desktop_icon_value(content),
            Some("org.mozilla.firefox".to_string())
        );
    }

    #[test]
    fn parse_desktop_icon_value_returns_none_when_missing() {
        let content = "[Desktop Entry]\nType=Application\nName=NoIcon\nExec=test\n";
        assert_eq!(parse_desktop_icon_value(content), None);
    }

    #[test]
    fn resolve_icon_path_finds_scalable_svg() {
        let tmp = tempdir().unwrap();
        let hicolor = tmp.path().join("hicolor");
        let scalable_dir = hicolor.join("scalable/apps");
        std::fs::create_dir_all(&scalable_dir).unwrap();

        let icon_file = scalable_dir.join("org.gnome.Boxes.svg");
        std::fs::write(&icon_file, b"<svg></svg>").unwrap();

        let resolved = resolve_icon_path("org.gnome.Boxes", &[hicolor]);
        assert_eq!(resolved, Some(icon_file));
    }

    #[test]
    fn resolve_icon_path_finds_direct_pixmap() {
        let tmp = tempdir().unwrap();
        let pixmaps = tmp.path().join("pixmaps");
        std::fs::create_dir_all(&pixmaps).unwrap();

        let icon_file = pixmaps.join("my-app.png");
        std::fs::write(&icon_file, b"\x89PNG\r\n\x1a\n").unwrap();

        let resolved = resolve_icon_path("my-app", &[pixmaps]);
        assert_eq!(resolved, Some(icon_file));
    }

    #[test]
    fn resolve_icon_path_returns_none_for_missing() {
        let tmp = tempdir().unwrap();
        let resolved = resolve_icon_path("nonexistent.app", &[tmp.path().to_path_buf()]);
        assert_eq!(resolved, None);
    }
}
