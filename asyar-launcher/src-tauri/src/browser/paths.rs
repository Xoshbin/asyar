use std::path::{Path, PathBuf};

pub struct ChromiumVariant {
    pub id: &'static str,
    /// macOS sub-path under `~/Library/Application Support`
    pub macos_subpath: &'static str,
    /// Linux sub-path under `~/.config`
    pub linux_subpath: &'static str,
    /// Windows sub-path under `%LOCALAPPDATA%`
    pub windows_subpath: &'static str,
}

pub fn chromium_variants() -> &'static [ChromiumVariant] {
    &[
        ChromiumVariant {
            id: "chrome",
            macos_subpath: "Google/Chrome",
            linux_subpath: "google-chrome",
            windows_subpath: "Google/Chrome/User Data",
        },
        ChromiumVariant {
            id: "brave",
            macos_subpath: "BraveSoftware/Brave-Browser",
            linux_subpath: "BraveSoftware/Brave-Browser",
            windows_subpath: "BraveSoftware/Brave-Browser/User Data",
        },
        ChromiumVariant {
            id: "arc",
            macos_subpath: "Arc/User Data",
            linux_subpath: "Arc/User Data",
            windows_subpath: "Arc/User Data",
        },
        ChromiumVariant {
            id: "edge",
            macos_subpath: "Microsoft Edge",
            linux_subpath: "microsoft-edge",
            windows_subpath: "Microsoft/Edge/User Data",
        },
        ChromiumVariant {
            id: "vivaldi",
            macos_subpath: "Vivaldi",
            linux_subpath: "vivaldi",
            windows_subpath: "Vivaldi/User Data",
        },
    ]
}

pub struct FirefoxVariant {
    pub id: &'static str,
    pub macos_subpath: &'static str,
    pub linux_subpath: &'static str,
    pub windows_subpath: &'static str,
}

pub fn firefox_variants() -> &'static [FirefoxVariant] {
    &[
        FirefoxVariant {
            id: "firefox",
            macos_subpath: "Firefox",
            // Linux Firefox lives at ~/.mozilla/firefox (relative to home, NOT under
            // ~/.config). No `../` — a leading `../` would climb above home AND, in
            // tempdir-scoped tests, escape the sandbox to read the real filesystem.
            linux_subpath: ".mozilla/firefox",
            windows_subpath: "Mozilla/Firefox",
        },
        FirefoxVariant {
            id: "librewolf",
            macos_subpath: "LibreWolf",
            linux_subpath: ".librewolf",
            windows_subpath: "LibreWolf",
        },
    ]
}

pub fn chromium_user_data_root(home: &Path, variant_id: &str) -> PathBuf {
    let variant = chromium_variants()
        .iter()
        .find(|v| v.id == variant_id)
        .expect("unknown chromium variant");
    #[cfg(target_os = "macos")]
    {
        home.join("Library/Application Support")
            .join(variant.macos_subpath)
    }
    #[cfg(target_os = "linux")]
    {
        home.join(".config").join(variant.linux_subpath)
    }
    #[cfg(target_os = "windows")]
    {
        // %LOCALAPPDATA% is approximated as home/AppData/Local for portability in tests.
        home.join("AppData/Local").join(variant.windows_subpath)
    }
}

pub fn firefox_profiles_dir(home: &Path, variant_id: &str) -> PathBuf {
    let variant = firefox_variants()
        .iter()
        .find(|v| v.id == variant_id)
        .expect("unknown firefox variant");
    #[cfg(target_os = "macos")]
    {
        home.join("Library/Application Support")
            .join(variant.macos_subpath)
            .join("Profiles")
    }
    #[cfg(target_os = "linux")]
    {
        home.join(variant.linux_subpath).join("Profiles")
    }
    #[cfg(target_os = "windows")]
    {
        home.join("AppData/Roaming")
            .join(variant.windows_subpath)
            .join("Profiles")
    }
}

pub fn safari_root(home: &Path) -> PathBuf {
    home.join("Library/Safari")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chromium_variants_listed() {
        let variants = chromium_variants();
        assert!(variants.iter().any(|v| v.id == "chrome"));
        assert!(variants.iter().any(|v| v.id == "brave"));
        assert!(variants.iter().any(|v| v.id == "arc"));
        assert!(variants.iter().any(|v| v.id == "edge"));
        assert!(variants.iter().any(|v| v.id == "vivaldi"));
    }

    #[test]
    fn firefox_variants_listed() {
        let variants = firefox_variants();
        assert!(variants.iter().any(|v| v.id == "firefox"));
        assert!(variants.iter().any(|v| v.id == "librewolf"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn chromium_user_data_root_macos_chrome() {
        let home = std::path::Path::new("/Users/test");
        let root = chromium_user_data_root(home, "chrome");
        assert_eq!(
            root,
            std::path::Path::new("/Users/test/Library/Application Support/Google/Chrome")
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn chromium_user_data_root_linux_chrome() {
        let home = std::path::Path::new("/home/test");
        let root = chromium_user_data_root(home, "chrome");
        assert_eq!(
            root,
            std::path::Path::new("/home/test/.config/google-chrome")
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn firefox_profiles_dir_macos() {
        let home = std::path::Path::new("/Users/test");
        let dir = firefox_profiles_dir(home, "firefox");
        assert_eq!(
            dir,
            std::path::Path::new("/Users/test/Library/Application Support/Firefox/Profiles")
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn firefox_profiles_dir_linux_stays_within_home() {
        // Regression guard for the `../` escape bug: the resolved path MUST stay
        // under home (no climbing above it), so tempdir-scoped scans stay hermetic.
        let home = std::path::Path::new("/home/test");
        let dir = firefox_profiles_dir(home, "firefox");
        assert!(
            dir.starts_with("/home/test"),
            "firefox dir escaped home: {dir:?}"
        );
        assert!(
            !dir.to_string_lossy().contains(".."),
            "firefox dir contains ..: {dir:?}"
        );
    }

    #[test]
    fn safari_root_macos() {
        let home = std::path::Path::new("/Users/test");
        assert_eq!(
            safari_root(home),
            std::path::Path::new("/Users/test/Library/Safari")
        );
    }
}
