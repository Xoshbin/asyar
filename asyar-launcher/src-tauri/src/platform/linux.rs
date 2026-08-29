pub mod desktop_entry;
pub mod environment;
#[cfg(target_os = "linux")]
pub(crate) mod launcher_dbus;
pub use desktop_entry::*;
pub use environment::*;

use std::path::{Path, PathBuf};
use tauri::{Runtime, WebviewWindow};

/// The localized name a `.desktop` file presents to the user.
pub fn localized_bundle_name(path: &Path) -> Option<String> {
    let entry = DesktopEntry::from_file(path)?;
    let locale = crate::locale::detect().raw;
    let name = entry.display_name(Some(&locale));
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Checks if a `.desktop` file is visible in an application launcher.
pub fn is_visible_desktop_file(path: &Path) -> bool {
    if let Some(entry) = DesktopEntry::from_file(path) {
        let desktops = current_desktop_environments();
        let desktop_refs: Vec<&str> = desktops.iter().map(|s| s.as_str()).collect();
        entry.is_visible(&desktop_refs)
    } else {
        false
    }
}

/// Configures GTK hints for a Spotlight-style window on Linux.
pub fn setup_spotlight_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::GtkWindowExt;
        let gtk_window = window.gtk_window()?;
        gtk_window.set_type_hint(gdk::WindowTypeHint::Utility);
        gtk_window.set_skip_taskbar_hint(true);
        gtk_window.set_skip_pager_hint(true);
        gtk_window.set_accept_focus(true);
        gtk_window.set_focus_on_map(true);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
    }
    Ok(())
}

/// Builds the 5-element 32-bit payload for an EWMH `_NET_ACTIVE_WINDOW` ClientMessage.
/// Source indication 2 indicates the request originates from a pager/launcher, which
/// window managers (KWin, Mutter, XFWM) recognize to bypass Focus Stealing Prevention.
pub fn build_net_active_window_data(server_time: u32, active_window: u32) -> [u32; 5] {
    [2, server_time, active_window, 0, 0]
}

/// Presents and focuses the spotlight window on Linux.
///
/// Under X11/EWMH and Wayland compositors with Focus Stealing Prevention (KWin, Mutter),
/// a standard `window.show()` + `window.set_focus()` often fails to acquire keyboard focus
/// because background activation requests lack user interaction timestamps.
///
/// This helper:
/// 1. Ensures the GTK window accepts focus and requests focus on map.
/// 2. Presents the GTK window with the current user/server time.
/// 3. Directly requests GDK focus on the underlying GDK window if available.
/// 4. Under X11, sends an EWMH `_NET_ACTIVE_WINDOW` ClientMessage to the root window with
///    source indication `2` (pager/launcher) and the server timestamp to explicitly bypass
///    Focus Stealing Prevention.
pub fn present_and_focus_spotlight_window<R: Runtime>(
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;

        const GDK_CURRENT_TIME: u32 = 0;

        let gtk_window = window.gtk_window()?;
        gtk_window.set_accept_focus(true);
        gtk_window.set_focus_on_map(true);

        let gdk_window = gtk_window.window();
        let server_time = get_x11_server_time(gdk_window.as_ref()).unwrap_or(GDK_CURRENT_TIME);

        gtk_window.present_with_time(server_time);

        if let Some(ref gdk_win) = gdk_window {
            gdk_win.focus(server_time);
        }

        activate_x11_window(&gtk_window, server_time);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window.set_focus();
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn get_x11_server_time(gdk_window: Option<&gdk::Window>) -> Option<u32> {
    use gtk::glib::Cast;
    let gdk_win = gdk_window?;
    let x11_win = gdk_win.downcast_ref::<gdkx11::X11Window>()?;
    Some(gdkx11::x11_get_server_time(x11_win))
}

#[cfg(target_os = "linux")]
fn activate_x11_window(gtk_window: &gtk::ApplicationWindow, server_time: u32) {
    use gtk::glib::Cast;
    use gtk::prelude::*;

    let Some(gdk_win) = gtk_window.window() else {
        return;
    };
    let Some(x11_win) = gdk_win.downcast_ref::<gdkx11::X11Window>() else {
        // Not running on X11 backend (e.g. native Wayland)
        return;
    };

    let xid = x11_win.xid() as u32;
    send_x11_net_active_window(xid, server_time);
}

#[cfg(target_os = "linux")]
fn send_x11_net_active_window(xid: u32, server_time: u32) {
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{
        ClientMessageData, ClientMessageEvent, ConnectionExt as _, EventMask, CLIENT_MESSAGE_EVENT,
    };

    let Ok((conn, screen_num)) = x11rb::connect(None) else {
        return;
    };
    let root = conn.setup().roots[screen_num].root;

    let Ok(net_active_reply) = conn.intern_atom(false, b"_NET_ACTIVE_WINDOW") else {
        return;
    };
    let Ok(net_active) = net_active_reply.reply() else {
        return;
    };

    let event = ClientMessageEvent {
        response_type: CLIENT_MESSAGE_EVENT,
        format: 32,
        sequence: 0,
        window: xid,
        type_: net_active.atom,
        data: ClientMessageData::from(build_net_active_window_data(server_time, 0)),
    };

    let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
    let _ = conn.send_event(false, root, mask, event);
    let _ = conn.flush();
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
    let mut seen = std::collections::HashSet::new();

    let mut add_dir = |p: PathBuf| {
        if seen.insert(p.clone()) {
            dirs.push(p);
        }
    };

    if let Some(home) = dirs::home_dir() {
        add_dir(home.join(".local/share/icons"));
        add_dir(home.join(".icons"));
        add_dir(home.join(".local/share/flatpak/exports/share/icons"));
        add_dir(home.join(".nix-profile/share/icons"));
    }

    if let Ok(data_home) = std::env::var("XDG_DATA_HOME") {
        let trimmed = data_home.trim();
        if !trimmed.is_empty() {
            add_dir(PathBuf::from(trimmed).join("icons"));
        }
    }

    if let Ok(data_dirs) = std::env::var("XDG_DATA_DIRS") {
        for dir in data_dirs.split(':') {
            let trimmed = dir.trim();
            if !trimmed.is_empty() {
                add_dir(PathBuf::from(trimmed).join("icons"));
            }
        }
    }

    add_dir(PathBuf::from("/var/lib/flatpak/exports/share/icons"));
    add_dir(PathBuf::from("/snap/share/icons"));
    add_dir(PathBuf::from("/nix/var/nix/profiles/default/share/icons"));
    add_dir(PathBuf::from("/usr/local/share/icons"));
    add_dir(PathBuf::from("/usr/share/icons/hicolor"));
    add_dir(PathBuf::from("/usr/share/icons/Adwaita"));
    add_dir(PathBuf::from("/usr/share/icons"));
    add_dir(PathBuf::from("/usr/share/pixmaps"));

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
    let icon_value = DesktopEntry::from_file(path)
        .and_then(|entry| entry.icon)
        .or_else(|| {
            let content = std::fs::read_to_string(path).ok()?;
            parse_desktop_icon_value(&content)
        })?;
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

    #[test]
    fn build_net_active_window_data_encodes_pager_source_and_timestamps() {
        let data = build_net_active_window_data(12345, 67890);
        assert_eq!(data, [2, 12345, 67890, 0, 0]);
    }
}
