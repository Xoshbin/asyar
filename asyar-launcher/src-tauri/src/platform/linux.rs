use std::path::Path;
use std::io::{BufRead, BufReader};
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
    Ok(())
}

/// Extracts an application icon from a Linux .desktop file by searching icon themes.
pub fn extract_icon(path: &Path) -> Option<Vec<u8>> {
    let desktop_path = path.to_str()?;

    // Parse .desktop file for Icon= entry
    let file = std::fs::File::open(desktop_path).ok()?;
    let reader = BufReader::new(file);
    let icon_value = reader
        .lines()
        .filter_map(|l| l.ok())
        .find(|l| l.starts_with("Icon="))
        .map(|l| l[5..].trim().to_string())?;

    // If it's an absolute path, read it directly
    if icon_value.starts_with('/') {
        return std::fs::read(&icon_value).ok();
    }

    // Resolve from common icon theme directories
    let sizes = ["48", "32", "256", "128", "64", "22", "16"];
    let extensions = ["png", "xpm"];
    let search_dirs = vec![
        "/usr/share/icons/hicolor",
        "/usr/share/icons/Adwaita",
        "/usr/share/icons",
        "/usr/share/pixmaps",
    ];

    for base in &search_dirs {
        for size in &sizes {
            for ext in &extensions {
                let path = format!("{}/{}/apps/{}.{}", base, size, icon_value, ext);
                if let Ok(bytes) = std::fs::read(&path) {
                    return Some(bytes);
                }
                let path2 = format!("{}/{}.{}", base, icon_value, ext);
                if let Ok(bytes) = std::fs::read(&path2) {
                    return Some(bytes);
                }
            }
        }
    }

    None
}
