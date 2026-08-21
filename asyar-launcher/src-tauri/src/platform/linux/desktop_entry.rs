use std::collections::HashMap;
use std::path::Path;

/// Represents a parsed Freedesktop `.desktop` file (specifically the `[Desktop Entry]` group).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DesktopEntry {
    pub name: String,
    pub localized_names: HashMap<String, String>,
    pub exec: Option<String>,
    pub try_exec: Option<String>,
    pub icon: Option<String>,
    pub entry_type: Option<String>,
    pub no_display: bool,
    pub hidden: bool,
    pub only_show_in: Vec<String>,
    pub not_show_in: Vec<String>,
    pub startup_wm_class: Option<String>,
    pub terminal: bool,
}

impl DesktopEntry {
    /// Parses the content of a `.desktop` file.
    ///
    /// Only processes the `[Desktop Entry]` group as per the Freedesktop specification.
    pub fn parse(content: &str) -> Option<Self> {
        let mut in_desktop_entry = false;
        let mut entry = DesktopEntry::default();
        let mut has_desktop_entry_group = false;

        for line in content.lines() {
            let trimmed = line.trim();

            // Skip comments and empty lines
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            // Group header
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                if trimmed == "[Desktop Entry]" {
                    in_desktop_entry = true;
                    has_desktop_entry_group = true;
                } else {
                    // Any subsequent group (e.g. [Desktop Action ...]) stops parsing main entry
                    in_desktop_entry = false;
                }
                continue;
            }

            if !in_desktop_entry {
                continue;
            }

            let Some((key, value)) = trimmed.split_once('=') else {
                continue;
            };

            let key = key.trim();
            let value = value.trim();

            if key == "Name" {
                entry.name = value.to_string();
            } else if key.starts_with("Name[") && key.ends_with(']') {
                let locale = &key[5..key.len() - 1];
                if !locale.is_empty() {
                    entry
                        .localized_names
                        .insert(locale.to_string(), value.to_string());
                }
            } else if key == "Type" {
                entry.entry_type = Some(value.to_string());
            } else if key == "Exec" {
                entry.exec = Some(value.to_string());
            } else if key == "TryExec" {
                entry.try_exec = Some(value.to_string());
            } else if key == "Icon" {
                entry.icon = Some(value.to_string());
            } else if key == "StartupWMClass" {
                entry.startup_wm_class = Some(value.to_string());
            } else if key == "NoDisplay" {
                entry.no_display = is_truthy(value);
            } else if key == "Hidden" {
                entry.hidden = is_truthy(value);
            } else if key == "Terminal" {
                entry.terminal = is_truthy(value);
            } else if key == "OnlyShowIn" {
                entry.only_show_in = parse_semicolon_list(value);
            } else if key == "NotShowIn" {
                entry.not_show_in = parse_semicolon_list(value);
            }
        }

        if has_desktop_entry_group {
            Some(entry)
        } else {
            None
        }
    }

    /// Reads and parses a `.desktop` file from disk.
    pub fn from_file(path: &Path) -> Option<Self> {
        let content = std::fs::read_to_string(path).ok()?;
        Self::parse(&content)
    }

    /// Determines whether the entry should be visible in an application launcher.
    ///
    /// Checks:
    /// - `Type`: must be `Application` (or omitted, which defaults to Application)
    /// - `NoDisplay`: must not be `true`
    /// - `Hidden`: must not be `true`
    /// - `OnlyShowIn`: if set, must contain at least one of the active desktop environments
    /// - `NotShowIn`: if set, must not contain any of the active desktop environments
    /// - `TryExec`: if specified, binary must exist on disk / in `$PATH`
    pub fn is_visible(&self, current_desktops: &[&str]) -> bool {
        // Non-Application types (e.g. Directory, Link) are not launcher applications
        if let Some(ref t) = self.entry_type {
            if !t.eq_ignore_ascii_case("Application") {
                return false;
            }
        }

        if self.no_display || self.hidden {
            return false;
        }

        // OnlyShowIn check
        if !self.only_show_in.is_empty() {
            let matched = self.only_show_in.iter().any(|target| {
                current_desktops
                    .iter()
                    .any(|curr| curr.eq_ignore_ascii_case(target))
            });
            if !matched {
                return false;
            }
        }

        // NotShowIn check
        if !self.not_show_in.is_empty() {
            let excluded = self.not_show_in.iter().any(|target| {
                current_desktops
                    .iter()
                    .any(|curr| curr.eq_ignore_ascii_case(target))
            });
            if excluded {
                return false;
            }
        }

        // TryExec check
        if let Some(ref try_exec) = self.try_exec {
            if !is_executable_available(try_exec) {
                return false;
            }
        }

        true
    }

    /// Resolves the display name according to the provided locale (or fallback to `Name=`).
    pub fn display_name(&self, preferred_locale: Option<&str>) -> String {
        if let Some(locale) = preferred_locale {
            for candidate in locale_candidates(locale) {
                if let Some(name) = self.localized_names.get(&candidate) {
                    if !name.trim().is_empty() {
                        return name.trim().to_string();
                    }
                }
            }
        }

        if !self.name.trim().is_empty() {
            self.name.trim().to_string()
        } else {
            String::new()
        }
    }

    /// Extracts a stable process/bundle identifier from StartupWMClass or Exec.
    pub fn extract_bundle_id(&self) -> Option<String> {
        if let Some(ref wm) = self.startup_wm_class {
            let trimmed = wm.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        if let Some(ref exec) = self.exec {
            let first_token = exec
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(|c| c == '"' || c == '\'');
            if !first_token.is_empty() {
                let basename = Path::new(first_token)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(first_token);
                if !basename.is_empty() {
                    return Some(basename.to_string());
                }
            }
        }

        None
    }
}

/// Helper to parse truthy boolean values ("true", "1", case-insensitive).
fn is_truthy(val: &str) -> bool {
    val.eq_ignore_ascii_case("true") || val == "1"
}

/// Parses a semicolon-separated string list (e.g. "GNOME;Unity;").
fn parse_semicolon_list(val: &str) -> Vec<String> {
    val.split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Generates locale search candidates from most specific to least specific.
/// E.g. "de_DE.UTF-8" -> ["de_DE.UTF-8", "de_DE", "de-DE", "de"]
pub(crate) fn locale_candidates(locale: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let clean = locale.trim();
    if clean.is_empty() {
        return candidates;
    }

    // Strip encoding suffix if present (.UTF-8)
    let no_encoding = clean.split('.').next().unwrap_or(clean);

    candidates.push(clean.to_string());
    if no_encoding != clean {
        candidates.push(no_encoding.to_string());
    }

    // Handle underscore vs hyphen (e.g. de_DE <-> de-DE)
    if no_encoding.contains('_') {
        let hyphenated = no_encoding.replace('_', "-");
        if !candidates.contains(&hyphenated) {
            candidates.push(hyphenated);
        }
    } else if no_encoding.contains('-') {
        let underscored = no_encoding.replace('-', "_");
        if !candidates.contains(&underscored) {
            candidates.push(underscored);
        }
    }

    // Strip country/region part (e.g. "de_DE" -> "de", "de-DE" -> "de", "de@euro" -> "de")
    let base = no_encoding
        .split(['_', '-', '@'])
        .next()
        .unwrap_or(no_encoding);
    if !base.is_empty() && !candidates.iter().any(|c| c == base) {
        candidates.push(base.to_string());
    }

    candidates
}

/// Checks if an executable binary exists on the file system or in any `$PATH` directory.
pub(crate) fn is_executable_available(binary: &str) -> bool {
    let binary = binary.trim().trim_matches(|c| c == '"' || c == '\'');
    if binary.is_empty() {
        return false;
    }

    let bin_path = Path::new(binary);
    if binary.contains('/') || binary.contains('\\') {
        return bin_path.is_file();
    }

    if let Ok(path_env) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let candidate = dir.join(binary);
            if candidate.is_file() {
                return true;
            }
        }
    }

    false
}

/// Queries current desktop environments from standard XDG environment variables.
pub fn current_desktop_environments() -> Vec<String> {
    let mut desktops = Vec::new();

    if let Ok(curr) = std::env::var("XDG_CURRENT_DESKTOP") {
        for d in curr.split(':') {
            let trimmed = d.trim();
            if !trimmed.is_empty()
                && !desktops
                    .iter()
                    .any(|existing: &String| existing.eq_ignore_ascii_case(trimmed))
            {
                desktops.push(trimmed.to_string());
            }
        }
    }

    if let Ok(curr) = std::env::var("XDG_SESSION_DESKTOP") {
        let trimmed = curr.trim();
        if !trimmed.is_empty()
            && !desktops
                .iter()
                .any(|existing: &String| existing.eq_ignore_ascii_case(trimmed))
        {
            desktops.push(trimmed.to_string());
        }
    }

    if let Ok(curr) = std::env::var("DESKTOP_SESSION") {
        let trimmed = curr.trim();
        if !trimmed.is_empty()
            && !desktops
                .iter()
                .any(|existing: &String| existing.eq_ignore_ascii_case(trimmed))
        {
            desktops.push(trimmed.to_string());
        }
    }

    desktops
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_parse_valid_desktop_entry() {
        let content = r#"
[Desktop Entry]
Version=1.0
Type=Application
Name=Firefox Web Browser
Name[de]=Firefox Webbrowser
Name[fr]=Navigateur Web Firefox
Exec=firefox %u
Icon=firefox
StartupWMClass=firefox
Categories=Network;WebBrowser;
"#;

        let entry = DesktopEntry::parse(content).expect("Should parse desktop entry");
        assert_eq!(entry.name, "Firefox Web Browser");
        assert_eq!(entry.entry_type.as_deref(), Some("Application"));
        assert_eq!(entry.exec.as_deref(), Some("firefox %u"));
        assert_eq!(entry.icon.as_deref(), Some("firefox"));
        assert_eq!(entry.startup_wm_class.as_deref(), Some("firefox"));
        assert_eq!(
            entry.localized_names.get("de").map(|s| s.as_str()),
            Some("Firefox Webbrowser")
        );
        assert_eq!(
            entry.localized_names.get("fr").map(|s| s.as_str()),
            Some("Navigateur Web Firefox")
        );
        assert!(!entry.no_display);
        assert!(!entry.hidden);
    }

    #[test]
    fn test_parse_ignores_secondary_groups() {
        let content = r#"
[Desktop Entry]
Type=Application
Name=Text Editor
Exec=gedit %U

[Desktop Action NewWindow]
Name=New Window
Exec=gedit --new-window
"#;

        let entry = DesktopEntry::parse(content).unwrap();
        assert_eq!(entry.name, "Text Editor");
        assert_eq!(entry.exec.as_deref(), Some("gedit %U"));
    }

    #[test]
    fn test_visibility_nodisplay_and_hidden() {
        let mut entry = DesktopEntry {
            name: "Internal App".to_string(),
            entry_type: Some("Application".to_string()),
            ..Default::default()
        };

        assert!(entry.is_visible(&[]));

        entry.no_display = true;
        assert!(!entry.is_visible(&[]));

        entry.no_display = false;
        entry.hidden = true;
        assert!(!entry.is_visible(&[]));
    }

    #[test]
    fn test_visibility_non_application_type() {
        let entry = DesktopEntry {
            name: "Folder Link".to_string(),
            entry_type: Some("Link".to_string()),
            ..Default::default()
        };

        assert!(!entry.is_visible(&[]));
    }

    #[test]
    fn test_visibility_only_show_in() {
        let entry = DesktopEntry {
            name: "GNOME Settings".to_string(),
            entry_type: Some("Application".to_string()),
            only_show_in: vec!["GNOME".to_string(), "Unity".to_string()],
            ..Default::default()
        };

        assert!(entry.is_visible(&["GNOME"]));
        assert!(entry.is_visible(&["ubuntu", "GNOME"]));
        assert!(entry.is_visible(&["unity"]));
        assert!(!entry.is_visible(&["KDE"]));
        assert!(!entry.is_visible(&["XFCE"]));
        assert!(!entry.is_visible(&[]));
    }

    #[test]
    fn test_visibility_not_show_in() {
        let entry = DesktopEntry {
            name: "KDE Only Tool".to_string(),
            entry_type: Some("Application".to_string()),
            not_show_in: vec!["GNOME".to_string()],
            ..Default::default()
        };

        assert!(entry.is_visible(&["KDE"]));
        assert!(!entry.is_visible(&["GNOME"]));
        assert!(!entry.is_visible(&["ubuntu", "gnome"]));
    }

    #[test]
    fn test_visibility_try_exec() {
        let tmp = tempdir().unwrap();
        let existing_bin = tmp.path().join("my_bin");
        std::fs::write(&existing_bin, b"#!/bin/sh\necho ok").unwrap();

        let mut entry = DesktopEntry {
            name: "TryExec App".to_string(),
            entry_type: Some("Application".to_string()),
            try_exec: Some(existing_bin.to_str().unwrap().to_string()),
            ..Default::default()
        };

        assert!(entry.is_visible(&[]));

        entry.try_exec = Some("/nonexistent/path/to/binary_12345".to_string());
        assert!(!entry.is_visible(&[]));
    }

    #[test]
    fn test_localized_display_name_resolution() {
        let mut entry = DesktopEntry {
            name: "Calculator".to_string(),
            ..Default::default()
        };
        entry
            .localized_names
            .insert("de".to_string(), "Rechner".to_string());
        entry
            .localized_names
            .insert("de_DE".to_string(), "Rechner (DE)".to_string());
        entry
            .localized_names
            .insert("fr".to_string(), "Calculatrice".to_string());

        assert_eq!(entry.display_name(Some("de_DE.UTF-8")), "Rechner (DE)");
        assert_eq!(entry.display_name(Some("de_AT.UTF-8")), "Rechner");
        assert_eq!(entry.display_name(Some("fr_FR")), "Calculatrice");
        assert_eq!(entry.display_name(Some("es_ES")), "Calculator");
        assert_eq!(entry.display_name(None), "Calculator");
    }

    #[test]
    fn test_extract_bundle_id() {
        let entry_with_wm = DesktopEntry {
            startup_wm_class: Some("Code".to_string()),
            exec: Some("code --unity-launch %F".to_string()),
            ..Default::default()
        };
        assert_eq!(entry_with_wm.extract_bundle_id(), Some("Code".to_string()));

        let entry_with_exec = DesktopEntry {
            exec: Some("/usr/bin/google-chrome-stable --incognito %U".to_string()),
            ..Default::default()
        };
        assert_eq!(
            entry_with_exec.extract_bundle_id(),
            Some("google-chrome-stable".to_string())
        );
    }
}
