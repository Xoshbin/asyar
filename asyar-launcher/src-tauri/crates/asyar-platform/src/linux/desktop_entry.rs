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
            let candidates = crate::locale::ParsedLocale::parse(locale)
                .map(|l| l.desktop_entry_candidates())
                .unwrap_or_default();
            for candidate in candidates {
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

        self.exec_program()
    }

    /// Basename of the program `Exec=` launches, for matching against running
    /// processes. `None` for wrapper launchers (`env`, shells, `flatpak`):
    /// their basename names the wrapper, which would mark unrelated apps as
    /// running.
    pub fn exec_basename(&self) -> Option<String> {
        let program_path = self.exec_program_path()?;
        Path::new(&program_path)
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }

    /// Whether `Exec=` launches a Flatpak sandbox (`flatpak ...`).
    pub fn is_flatpak_exec(&self) -> bool {
        let Some(ref exec) = self.exec else {
            return false;
        };
        let tokens = parse_exec_tokens(exec);
        let Some(first) = tokens.first().map(String::as_str) else {
            return false;
        };
        let first_base = Path::new(first)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(first);
        first_base == "flatpak"
    }

    /// Resolves the target program token/path launched by `Exec=`, honoring quotes,
    /// backslash escapes, `env` wrappers, and `flatpak run --command=...`.
    pub fn exec_program_path(&self) -> Option<String> {
        const WRAPPERS: &[&str] = &["env", "sh", "bash", "dash", "zsh", "flatpak", "bwrap"];

        let tokens = parse_exec_tokens(self.exec.as_ref()?);
        let first = tokens.first()?.as_str();
        let first_base = Path::new(first)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(first);

        let candidate = if first_base == "env" {
            let mut found = None;
            let mut i = 1;
            while i < tokens.len() {
                let tok = &tokens[i];
                if tok.starts_with('-') {
                    if matches!(tok.as_str(), "-u" | "-C" | "-S" | "--unset" | "--chdir")
                        && tokens.get(i + 1).is_some_and(|next| !next.contains('='))
                    {
                        i += 2;
                    } else {
                        i += 1;
                    }
                    continue;
                }
                if tok.contains('=') && !tok.starts_with('=') {
                    i += 1;
                    continue;
                }
                found = Some(tok.clone());
                break;
            }
            found?
        } else if first_base == "flatpak" {
            let run_idx = tokens.iter().skip(1).position(|t| t == "run")? + 1;
            let mut cmd = None;
            let mut i = run_idx + 1;
            while i < tokens.len() {
                let tok = &tokens[i];
                if let Some(val) = tok.strip_prefix("--command=") {
                    if !val.is_empty() {
                        cmd = Some(val.to_string());
                    }
                    break;
                }
                if tok == "--command" {
                    if let Some(val) = tokens.get(i + 1).filter(|v| !v.is_empty()) {
                        cmd = Some(val.clone());
                    }
                    break;
                }
                i += 1;
            }
            cmd?
        } else {
            first.to_string()
        };

        if candidate.is_empty() || candidate.starts_with('%') {
            return None;
        }
        let basename = Path::new(&candidate).file_name().and_then(|s| s.to_str())?;
        if basename.is_empty() || WRAPPERS.contains(&basename) {
            return None;
        }
        Some(candidate)
    }

    fn exec_program(&self) -> Option<String> {
        self.exec_basename().or_else(|| {
            let tokens = parse_exec_tokens(self.exec.as_ref()?);
            let first = tokens.first()?;
            Path::new(first)
                .file_name()
                .and_then(|s| s.to_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
    }
}

/// Splits a `.desktop` `Exec=` value into argument tokens, honoring double/single
/// quotes and backslash escapes.
fn parse_exec_tokens(exec: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_token = false;
    let mut quote: Option<char> = None;
    let mut chars = exec.chars().peekable();

    while let Some(c) = chars.next() {
        match quote {
            Some('"') => {
                if c == '"' {
                    quote = None;
                } else if c == '\\' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(c);
                }
            }
            Some('\'') => {
                if c == '\'' {
                    quote = None;
                } else {
                    current.push(c);
                }
            }
            _ => {
                if c.is_whitespace() {
                    if in_token {
                        tokens.push(std::mem::take(&mut current));
                        in_token = false;
                    }
                } else if c == '"' || c == '\'' {
                    quote = Some(c);
                    in_token = true;
                } else if c == '\\' {
                    in_token = true;
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    in_token = true;
                    current.push(c);
                }
            }
        }
    }

    if in_token {
        tokens.push(current);
    }
    tokens
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

    #[test]
    fn exec_basename_ignores_wm_class_and_rejects_wrappers() {
        let code = DesktopEntry {
            startup_wm_class: Some("Code".to_string()),
            exec: Some("/usr/share/code/code --unity-launch %F".to_string()),
            ..Default::default()
        };
        assert_eq!(code.exec_basename(), Some("code".to_string()));

        for exec in [
            "/usr/bin/flatpak run org.mozilla.firefox",
            "env FOO=1",
            "env GDK_BACKEND=x11 sh -c \"app --flag\"",
            "sh -c \"app --flag\"",
        ] {
            let entry = DesktopEntry {
                exec: Some(exec.to_string()),
                ..Default::default()
            };
            assert_eq!(entry.exec_basename(), None, "{exec}");
        }
    }

    #[test]
    fn exec_basename_handles_quoted_paths_with_spaces() {
        let entry = DesktopEntry {
            exec: Some(r#""/opt/My App/bin/editor" --flag %F"#.to_string()),
            ..Default::default()
        };
        assert_eq!(
            entry.exec_program_path(),
            Some("/opt/My App/bin/editor".to_string())
        );
        assert_eq!(entry.exec_basename(), Some("editor".to_string()));
    }

    #[test]
    fn exec_basename_unwraps_env_assignments_and_flags() {
        let slack = DesktopEntry {
            exec: Some("env GDK_BACKEND=x11 /usr/bin/slack %U".to_string()),
            ..Default::default()
        };
        assert_eq!(
            slack.exec_program_path(),
            Some("/usr/bin/slack".to_string())
        );
        assert_eq!(slack.exec_basename(), Some("slack".to_string()));

        let discord = DesktopEntry {
            exec: Some(
                "/usr/bin/env -i BAMF_DESKTOP_FILE_HINT=/var/lib/snapd/desktop/applications/discord_discord.desktop /snap/bin/discord".to_string(),
            ),
            ..Default::default()
        };
        assert!(!discord.is_flatpak_exec());
        assert_eq!(discord.exec_basename(), Some("discord".to_string()));

        let runner = DesktopEntry {
            exec: Some("env -u WAYLAND_DISPLAY /opt/app/runner".to_string()),
            ..Default::default()
        };
        assert_eq!(runner.exec_basename(), Some("runner".to_string()));
    }

    #[test]
    fn exec_basename_extracts_flatpak_command_when_present() {
        let discord = DesktopEntry {
            exec: Some(
                "/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=discord com.discordapp.Discord".to_string(),
            ),
            ..Default::default()
        };
        assert!(discord.is_flatpak_exec());
        assert_eq!(discord.exec_basename(), Some("discord".to_string()));

        let telegram = DesktopEntry {
            exec: Some(
                "flatpak run --command=/app/bin/telegram-desktop org.telegram.desktop -- %u"
                    .to_string(),
            ),
            ..Default::default()
        };
        assert_eq!(
            telegram.exec_basename(),
            Some("telegram-desktop".to_string())
        );

        let shell_wrapper = DesktopEntry {
            exec: Some("/usr/bin/flatpak run --command=sh com.example.Wrapper".to_string()),
            ..Default::default()
        };
        assert_eq!(shell_wrapper.exec_basename(), None);
    }
}
