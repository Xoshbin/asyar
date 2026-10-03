pub mod desktop_entry;
pub mod environment;
#[cfg(target_os = "linux")]
pub mod launcher_dbus;

pub use desktop_entry::*;
pub use environment::*;

use std::path::{Path, PathBuf};

/// The localized name a `.desktop` file presents to the user.
pub fn localized_bundle_name(path: &Path) -> Option<String> {
    let entry = DesktopEntry::from_file(path)?;
    let locale = crate::locale::detect_locale();
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

#[cfg(target_os = "linux")]
pub fn setup_spotlight_gtk_window(gtk_window: &gtk::ApplicationWindow) {
    use gtk::prelude::GtkWindowExt;
    gtk_window.set_type_hint(gdk::WindowTypeHint::Utility);
    gtk_window.set_skip_taskbar_hint(true);
    gtk_window.set_skip_pager_hint(true);
    gtk_window.set_accept_focus(true);
    gtk_window.set_focus_on_map(true);
}

pub fn build_net_active_window_data(server_time: u32, active_window: u32) -> [u32; 5] {
    [2, server_time, active_window, 0, 0]
}

#[cfg(target_os = "linux")]
pub fn present_and_focus_spotlight_gtk_window(gtk_window: &gtk::ApplicationWindow) {
    use gtk::prelude::*;

    const GDK_CURRENT_TIME: u32 = 0;

    gtk_window.set_accept_focus(true);
    gtk_window.set_focus_on_map(true);

    let gdk_window = gtk_window.window();
    let server_time = get_x11_server_time(gdk_window.as_ref()).unwrap_or(GDK_CURRENT_TIME);

    gtk_window.present_with_time(server_time);

    if let Some(ref gdk_win) = gdk_window {
        gdk_win.focus(server_time);
    }

    activate_x11_window(gtk_window, server_time);
}

#[cfg(target_os = "linux")]
fn get_x11_server_time(gdk_window: Option<&gdk::Window>) -> Option<u32> {
    use gtk::glib::Cast;
    let gdk_win = gdk_window?;
    let x11_win = gdk_win.downcast_ref::<gdkx11::X11Window>()?;
    Some(gdkx11::functions::x11_get_server_time(x11_win))
}

#[cfg(target_os = "linux")]
fn activate_x11_window(gtk_window: &gtk::ApplicationWindow, server_time: u32) {
    use gtk::glib::Cast;
    use gtk::prelude::*;

    let Some(gdk_win) = gtk_window.window() else {
        return;
    };
    let Some(x11_win) = gdk_win.downcast_ref::<gdkx11::X11Window>() else {
        return;
    };

    let xid = x11_win.xid() as u32;
    send_x11_net_active_window(xid, server_time);
}

#[cfg(target_os = "linux")]
pub fn send_x11_net_active_window(xid: u32, server_time: u32) {
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

pub fn resolve_icon_path(icon_value: &str, search_dirs: &[PathBuf]) -> Option<PathBuf> {
    let icon_value = icon_value.trim();
    if icon_value.is_empty() {
        return None;
    }

    if icon_value.starts_with('/') {
        let p = PathBuf::from(icon_value);
        if p.is_file() {
            return Some(p);
        }
        for ext in &["svg", "png", "xpm"] {
            let with_ext = PathBuf::from(format!("{icon_value}.{ext}"));
            if with_ext.is_file() {
                return Some(with_ext);
            }
        }
        return None;
    }

    let raw_name = icon_value
        .strip_suffix(".png")
        .or_else(|| icon_value.strip_suffix(".svg"))
        .or_else(|| icon_value.strip_suffix(".xpm"))
        .unwrap_or(icon_value);

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
        for ext in &extensions {
            let candidate = base.join(format!("{raw_name}.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }

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

pub fn parse_wm_class(bytes: &[u8]) -> Option<(String, String)> {
    let mut parts = bytes
        .split(|&b| b == 0)
        .map(|slice| String::from_utf8_lossy(slice).trim().to_string())
        .filter(|s| !s.is_empty());

    let instance = parts.next()?;
    let class = parts.next().unwrap_or_else(|| instance.clone());
    Some((instance, class))
}

pub fn parse_wm_name(bytes: &[u8]) -> Option<String> {
    let title = String::from_utf8_lossy(bytes)
        .trim_matches(|c: char| c == '\0' || c.is_whitespace())
        .to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

pub fn resolve_app_name(
    class_name: Option<&str>,
    instance_name: Option<&str>,
    exe_name: Option<&str>,
) -> Option<String> {
    fn clean_str(s: Option<&str>) -> Option<&str> {
        s.map(str::trim).filter(|t| !t.is_empty())
    }

    if let Some(cls) = clean_str(class_name) {
        return Some(cls.to_string());
    }
    if let Some(inst) = clean_str(instance_name) {
        return Some(inst.to_string());
    }
    if let Some(exe) = clean_str(exe_name) {
        return Some(exe.to_string());
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinuxFrontmostMetadata {
    pub name: String,
    pub bundle_id: Option<String>,
    pub path: Option<String>,
    pub window_title: Option<String>,
}

#[cfg(target_os = "linux")]
pub fn get_frontmost_application_metadata() -> Option<LinuxFrontmostMetadata> {
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _};

    let (conn, screen_num) = x11rb::connect(None).ok()?;
    let root = conn.setup().roots.get(screen_num)?.root;

    let net_active_reply = conn.intern_atom(false, b"_NET_ACTIVE_WINDOW").ok()?;
    let net_wm_pid_reply = conn.intern_atom(false, b"_NET_WM_PID").ok()?;
    let net_wm_name_reply = conn.intern_atom(false, b"_NET_WM_NAME").ok()?;
    let utf8_string_reply = conn.intern_atom(false, b"UTF8_STRING").ok()?;

    let net_active = net_active_reply.reply().ok()?.atom;
    let net_wm_pid = net_wm_pid_reply.reply().ok()?.atom;
    let net_wm_name = net_wm_name_reply.reply().ok()?.atom;
    let utf8_string = utf8_string_reply.reply().ok()?.atom;

    let active_prop = conn
        .get_property(false, root, net_active, AtomEnum::WINDOW, 0, 1)
        .ok()?
        .reply()
        .ok()?;

    let win = active_prop
        .value32()
        .and_then(|mut it| it.next())
        .unwrap_or(0);
    if win == 0 {
        return None;
    }

    let window_title = conn
        .get_property(false, win, net_wm_name, utf8_string, 0, 1024)
        .ok()
        .and_then(|c| c.reply().ok())
        .and_then(|r| parse_wm_name(&r.value))
        .or_else(|| {
            conn.get_property(false, win, AtomEnum::WM_NAME, AtomEnum::STRING, 0, 1024)
                .ok()
                .and_then(|c| c.reply().ok())
                .and_then(|r| parse_wm_name(&r.value))
        });

    let wm_class = conn
        .get_property(false, win, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 1024)
        .ok()
        .and_then(|c| c.reply().ok())
        .and_then(|r| parse_wm_class(&r.value));

    let pid = conn
        .get_property(false, win, net_wm_pid, AtomEnum::CARDINAL, 0, 1)
        .ok()
        .and_then(|c| c.reply().ok())
        .and_then(|r| r.value32().and_then(|mut it| it.next()));

    let exe_path = pid.and_then(|p| {
        std::fs::read_link(format!("/proc/{p}/exe"))
            .ok()
            .map(|pb| pb.to_string_lossy().into_owned())
    });

    let exe_name = exe_path
        .as_deref()
        .and_then(|p| std::path::Path::new(p).file_name().and_then(|n| n.to_str()));

    let (instance_name, class_name) = match wm_class {
        Some((inst, cls)) => (Some(inst), Some(cls)),
        None => (None, None),
    };

    let name = resolve_app_name(class_name.as_deref(), instance_name.as_deref(), exe_name)?;

    let bundle_id = instance_name.or_else(|| exe_name.map(|s| s.to_string()));

    Some(LinuxFrontmostMetadata {
        name,
        bundle_id,
        path: exe_path,
        window_title,
    })
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

    #[test]
    fn parse_wm_class_extracts_instance_and_class() {
        let bytes = b"google-chrome\0Google-chrome\0";
        assert_eq!(
            parse_wm_class(bytes),
            Some(("google-chrome".to_string(), "Google-chrome".to_string()))
        );
    }

    #[test]
    fn parse_wm_class_handles_single_entry() {
        let bytes = b"slack\0";
        assert_eq!(
            parse_wm_class(bytes),
            Some(("slack".to_string(), "slack".to_string()))
        );
    }

    #[test]
    fn parse_wm_class_returns_none_for_empty() {
        assert_eq!(parse_wm_class(b""), None);
        assert_eq!(parse_wm_class(b"\0\0"), None);
    }

    #[test]
    fn parse_wm_name_extracts_clean_title() {
        let bytes = b"My Window Title\0";
        assert_eq!(parse_wm_name(bytes), Some("My Window Title".to_string()));
    }

    #[test]
    fn parse_wm_name_returns_none_for_empty_or_whitespace() {
        assert_eq!(parse_wm_name(b""), None);
        assert_eq!(parse_wm_name(b"   \0"), None);
    }

    #[test]
    fn resolve_app_name_prioritizes_class_then_instance_then_exe() {
        assert_eq!(
            resolve_app_name(Some("Code"), Some("code"), Some("code-bin")),
            Some("Code".to_string())
        );
        assert_eq!(
            resolve_app_name(None, Some("code"), Some("code-bin")),
            Some("code".to_string())
        );
        assert_eq!(
            resolve_app_name(None, None, Some("code-bin")),
            Some("code-bin".to_string())
        );
        assert_eq!(resolve_app_name(None, None, None), None);
        assert_eq!(resolve_app_name(Some("  "), Some(""), None), None);
    }
}
