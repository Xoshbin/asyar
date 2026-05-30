use crate::browser::paths;
use crate::browser::types::{BrowserFamily, BrowserId};
use std::path::PathBuf;

pub struct BrowserScanner {
    home: PathBuf,
}

impl BrowserScanner {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        Self { home }
    }

    pub fn with_home(home: PathBuf) -> Self {
        Self { home }
    }

    pub fn scan(&self) -> Vec<BrowserId> {
        let mut out = Vec::new();
        self.scan_chromium(&mut out);
        self.scan_firefox(&mut out);
        #[cfg(target_os = "macos")]
        self.scan_safari(&mut out);
        out
    }

    fn scan_chromium(&self, out: &mut Vec<BrowserId>) {
        for variant in paths::chromium_variants() {
            let root = paths::chromium_user_data_root(&self.home, variant.id);
            if !root.exists() {
                continue;
            }
            let entries = match std::fs::read_dir(&root) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                // Chromium profile dirs are 'Default' or 'Profile N'.
                if name != "Default" && !name.starts_with("Profile ") {
                    continue;
                }
                out.push(BrowserId {
                    family: BrowserFamily::Chromium,
                    variant: variant.id.to_string(),
                    profile_id: name,
                });
            }
        }
    }

    fn scan_firefox(&self, out: &mut Vec<BrowserId>) {
        for variant in paths::firefox_variants() {
            let profiles_root = paths::firefox_profiles_dir(&self.home, variant.id);
            if !profiles_root.exists() {
                continue;
            }
            let entries = match std::fs::read_dir(&profiles_root) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                out.push(BrowserId {
                    family: BrowserFamily::Firefox,
                    variant: variant.id.to_string(),
                    profile_id: name,
                });
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn scan_safari(&self, out: &mut Vec<BrowserId>) {
        if paths::safari_root(&self.home).exists() {
            out.push(BrowserId {
                family: BrowserFamily::Safari,
                variant: "safari".to_string(),
                profile_id: "Default".to_string(),
            });
        }
    }
}

impl Default for BrowserScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn make_chromium_layout(home: &Path, variant_id: &str, profiles: &[&str]) {
        let root = paths::chromium_user_data_root(home, variant_id);
        std::fs::create_dir_all(&root).unwrap();
        for p in profiles {
            std::fs::create_dir_all(root.join(p)).unwrap();
        }
    }

    fn make_firefox_layout(home: &Path, variant_id: &str, profile_dirs: &[&str]) {
        let root = paths::firefox_profiles_dir(home, variant_id);
        std::fs::create_dir_all(&root).unwrap();
        for p in profile_dirs {
            std::fs::create_dir_all(root.join(p)).unwrap();
        }
    }

    #[test]
    fn detects_chromium_chrome_default_profile() {
        let dir = tempfile::tempdir().unwrap();
        make_chromium_layout(dir.path(), "chrome", &["Default"]);
        let scanner = BrowserScanner::with_home(dir.path().to_path_buf());
        let browsers = scanner.scan();
        assert!(browsers.iter().any(|b| b.family == BrowserFamily::Chromium
            && b.variant == "chrome"
            && b.profile_id == "Default"));
    }

    #[test]
    fn detects_multiple_chromium_profiles() {
        let dir = tempfile::tempdir().unwrap();
        make_chromium_layout(dir.path(), "chrome", &["Default", "Profile 1", "Profile 2"]);
        let scanner = BrowserScanner::with_home(dir.path().to_path_buf());
        let browsers = scanner.scan();
        let chrome_profiles: Vec<&BrowserId> =
            browsers.iter().filter(|b| b.variant == "chrome").collect();
        assert_eq!(chrome_profiles.len(), 3);
    }

    #[test]
    fn detects_firefox_profiles() {
        let dir = tempfile::tempdir().unwrap();
        make_firefox_layout(dir.path(), "firefox", &["abc123.default-release"]);
        let scanner = BrowserScanner::with_home(dir.path().to_path_buf());
        let browsers = scanner.scan();
        assert!(browsers
            .iter()
            .any(|b| b.family == BrowserFamily::Firefox && b.variant == "firefox"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn detects_safari_when_root_exists() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(paths::safari_root(dir.path())).unwrap();
        let scanner = BrowserScanner::with_home(dir.path().to_path_buf());
        let browsers = scanner.scan();
        assert!(browsers.iter().any(|b| b.family == BrowserFamily::Safari));
    }

    #[test]
    fn returns_empty_when_no_browser_dirs_exist() {
        let dir = tempfile::tempdir().unwrap();
        let scanner = BrowserScanner::with_home(dir.path().to_path_buf());
        assert!(scanner.scan().is_empty());
    }
}
