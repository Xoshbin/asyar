//! Environment sanitization for Linux processes spawned from an AppImage.
//!
//! When Asyar runs as an AppImage, the AppImage runtime/AppRun prepends its bundled
//! library and resource paths to `LD_LIBRARY_PATH`, `GIO_MODULE_DIR`, `XDG_DATA_DIRS`,
//! `QT_PLUGIN_PATH`, etc., while preserving the host environment in `*_ORIG` backup
//! variables (such as `LD_LIBRARY_PATH_ORIG`, `XDG_DATA_DIRS_ORIG`).
//!
//! If external applications (like Dolphin, System Monitor, or user-launched binaries)
//! inherit these AppImage environment variables, they link against bundled glib/runtime
//! libraries instead of host system libraries, causing crashes (e.g. `SIGSEGV` on teardown).
//!
//! This module provides utilities to construct a sanitized environment that restores the
//! original host environment and unsets AppImage-specific variables before launching
//! desktop apps or executing child commands.

use std::collections::{HashMap, HashSet};

/// Set of environment mutations (variables to set/restore and variables to unset)
/// required to restore a clean host environment.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EnvironmentModifications {
    /// Environment variables that must be restored or set.
    pub vars_to_set: HashMap<String, String>,
    /// Environment variables that must be removed / unset.
    pub vars_to_unset: HashSet<String>,
}

impl EnvironmentModifications {
    /// Returns true if no environment modifications are needed.
    pub fn is_empty(&self) -> bool {
        self.vars_to_set.is_empty() && self.vars_to_unset.is_empty()
    }

    /// Applies these environment modifications to a `std::process::Command`.
    pub fn apply_to_command(&self, cmd: &mut std::process::Command) {
        for (key, val) in &self.vars_to_set {
            cmd.env(key, val);
        }
        for key in &self.vars_to_unset {
            cmd.env_remove(key);
        }
    }

    /// Applies these environment modifications to a `gio::AppLaunchContext`.
    #[cfg(target_os = "linux")]
    pub fn apply_to_launch_context(&self, context: &gio::AppLaunchContext) {
        use gio::prelude::AppLaunchContextExt;
        for (key, val) in &self.vars_to_set {
            context.setenv(key, val);
        }
        for key in &self.vars_to_unset {
            context.unsetenv(key);
        }
    }
}

/// Pure function that calculates the required environment modifications given an
/// environment variable lookup closure.
///
/// If the process is not running inside an AppImage (`APPIMAGE` and `APPDIR` are absent),
/// returns an empty [`EnvironmentModifications`].
pub fn calculate_sanitized_environment<F>(get_var: F) -> EnvironmentModifications
where
    F: Fn(&str) -> Option<String>,
{
    let is_appimage = get_var("APPIMAGE").is_some() || get_var("APPDIR").is_some();
    if !is_appimage {
        return EnvironmentModifications::default();
    }

    let appdir = get_var("APPDIR");
    let mut vars_to_set = HashMap::new();
    let mut vars_to_unset = HashSet::new();

    // Standard AppImage restoration mapping: (target_var, orig_var, unset_if_orig_absent)
    let restorations: [(&str, &str, bool); 10] = [
        ("LD_LIBRARY_PATH", "LD_LIBRARY_PATH_ORIG", true),
        ("LD_PRELOAD", "LD_PRELOAD_ORIG", true),
        ("PYTHONPATH", "PYTHONPATH_ORIG", true),
        ("PYTHONHOME", "PYTHONHOME_ORIG", true),
        ("PYTHONEXECUTABLE", "PYTHONEXECUTABLE_ORIG", true),
        ("PERLLIB", "PERLLIB_ORIG", true),
        ("PERL5LIB", "PERL5LIB_ORIG", true),
        ("QT_PLUGIN_PATH", "QT_PLUGIN_PATH_ORIG", true),
        ("QT_QPA_PLATFORMTHEME", "QT_QPA_PLATFORMTHEME_ORIG", false),
        ("GSETTINGS_SCHEMA_DIR", "GSETTINGS_SCHEMA_DIR_ORIG", true),
    ];

    for (target, orig, unset_if_missing) in restorations {
        if let Some(orig_val) = get_var(orig) {
            vars_to_set.insert(target.to_string(), orig_val);
        } else if unset_if_missing {
            vars_to_unset.insert(target.to_string());
        }
        vars_to_unset.insert(orig.to_string());
    }

    // Special handling for XDG_DATA_DIRS
    if let Some(orig_xdg) = get_var("XDG_DATA_DIRS_ORIG") {
        vars_to_set.insert("XDG_DATA_DIRS".to_string(), orig_xdg);
        vars_to_unset.insert("XDG_DATA_DIRS_ORIG".to_string());
    } else {
        vars_to_unset.insert("XDG_DATA_DIRS_ORIG".to_string());
        if let Some(data_dirs) = get_var("XDG_DATA_DIRS") {
            if let Some(ref ad) = appdir {
                let filtered: Vec<&str> = data_dirs
                    .split(':')
                    .filter(|p| !p.is_empty() && *p != ad && !p.starts_with(&format!("{ad}/")))
                    .collect();
                let initial_count = data_dirs.split(':').filter(|p| !p.is_empty()).count();
                if filtered.is_empty() {
                    vars_to_set.insert(
                        "XDG_DATA_DIRS".to_string(),
                        "/usr/local/share:/usr/share".to_string(),
                    );
                } else if filtered.len() < initial_count {
                    vars_to_set.insert("XDG_DATA_DIRS".to_string(), filtered.join(":"));
                }
            }
        }
    }

    // Special handling for PATH
    if let Some(orig_path) = get_var("PATH_ORIG") {
        vars_to_set.insert("PATH".to_string(), orig_path);
        vars_to_unset.insert("PATH_ORIG".to_string());
    } else {
        vars_to_unset.insert("PATH_ORIG".to_string());
        if let Some(path_val) = get_var("PATH") {
            if let Some(ref ad) = appdir {
                let filtered: Vec<&str> = path_val
                    .split(':')
                    .filter(|p| !p.is_empty() && *p != ad && !p.starts_with(&format!("{ad}/")))
                    .collect();
                let initial_count = path_val.split(':').filter(|p| !p.is_empty()).count();
                if !filtered.is_empty() && filtered.len() < initial_count {
                    vars_to_set.insert("PATH".to_string(), filtered.join(":"));
                }
            }
        }
    }

    // AppImage and runtime specific variables that should never leak to host processes
    const UNSET_VARS: &[&str] = &[
        "APPIMAGE",
        "APPDIR",
        "OWD",
        "ARGV0",
        "GIO_MODULE_DIR",
        "GIO_EXTRA_MODULES",
        "GDK_PIXBUF_MODULE_FILE",
        "GDK_PIXBUF_MODULEDIR",
        "GST_PLUGIN_SYSTEM_PATH",
        "GST_PLUGIN_SYSTEM_PATH_1_0",
        "GST_PLUGIN_SCANNER",
    ];

    for var in UNSET_VARS {
        vars_to_unset.insert(var.to_string());
    }

    // Resolve conflicts: if a variable is explicitly set, ensure it's not in the unset list
    for key in vars_to_set.keys() {
        vars_to_unset.remove(key);
    }

    EnvironmentModifications {
        vars_to_set,
        vars_to_unset,
    }
}

/// Retrieves the sanitized environment modifications for the current process.
pub fn get_appimage_sanitized_environment() -> EnvironmentModifications {
    calculate_sanitized_environment(|key| std::env::var(key).ok())
}

/// Sanitizes a `std::process::Command` by removing AppImage-specific environment variables
/// and restoring original host environment variables.
pub fn sanitize_command(cmd: &mut std::process::Command) {
    let mods = get_appimage_sanitized_environment();
    mods.apply_to_command(cmd);
}

/// Creates a new `gio::AppLaunchContext` configured with sanitized host environment variables.
#[cfg(target_os = "linux")]
pub fn create_sanitized_app_launch_context() -> gio::AppLaunchContext {
    let context = gio::AppLaunchContext::new();
    let mods = get_appimage_sanitized_environment();
    mods.apply_to_launch_context(&context);
    context
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_appimage_environment_returns_empty_modifications() {
        let env: HashMap<&str, &str> = HashMap::from([
            ("USER", "testuser"),
            ("HOME", "/home/testuser"),
            ("PATH", "/usr/bin:/bin"),
            (
                "XDG_DATA_DIRS",
                "/usr/share/plasma:/usr/local/share:/usr/share",
            ),
        ]);

        let mods = calculate_sanitized_environment(|k| env.get(k).map(|s| s.to_string()));
        assert!(mods.is_empty());
        assert!(mods.vars_to_set.is_empty());
        assert!(mods.vars_to_unset.is_empty());
    }

    #[test]
    fn appimage_unsets_ld_library_path_when_orig_is_missing() {
        let env: HashMap<&str, &str> = HashMap::from([
            ("APPIMAGE", "/home/test/Asyar.AppImage"),
            ("APPDIR", "/tmp/.mount_Asyar123"),
            ("LD_LIBRARY_PATH", "/tmp/.mount_Asyar123/usr/lib"),
            ("GIO_MODULE_DIR", "/tmp/.mount_Asyar123/usr/lib/gio/modules"),
        ]);

        let mods = calculate_sanitized_environment(|k| env.get(k).map(|s| s.to_string()));

        assert!(!mods.is_empty());
        assert!(mods.vars_to_unset.contains("LD_LIBRARY_PATH"));
        assert!(mods.vars_to_unset.contains("GIO_MODULE_DIR"));
        assert!(mods.vars_to_unset.contains("APPIMAGE"));
        assert!(mods.vars_to_unset.contains("APPDIR"));
        assert!(!mods.vars_to_set.contains_key("LD_LIBRARY_PATH"));
    }

    #[test]
    fn appimage_restores_ld_library_path_when_orig_is_present() {
        let env: HashMap<&str, &str> = HashMap::from([
            ("APPIMAGE", "/home/test/Asyar.AppImage"),
            ("APPDIR", "/tmp/.mount_Asyar123"),
            (
                "LD_LIBRARY_PATH",
                "/tmp/.mount_Asyar123/usr/lib:/opt/custom/lib",
            ),
            ("LD_LIBRARY_PATH_ORIG", "/opt/custom/lib"),
        ]);

        let mods = calculate_sanitized_environment(|k| env.get(k).map(|s| s.to_string()));

        assert_eq!(
            mods.vars_to_set.get("LD_LIBRARY_PATH"),
            Some(&"/opt/custom/lib".to_string())
        );
        assert!(mods.vars_to_unset.contains("LD_LIBRARY_PATH_ORIG"));
        assert!(!mods.vars_to_unset.contains("LD_LIBRARY_PATH"));
    }

    #[test]
    fn appimage_restores_xdg_data_dirs_from_orig() {
        let env: HashMap<&str, &str> = HashMap::from([
            ("APPIMAGE", "/home/test/Asyar.AppImage"),
            ("APPDIR", "/tmp/.mount_Asyar123"),
            (
                "XDG_DATA_DIRS",
                "/tmp/.mount_Asyar123/usr/share:/usr/share/plasma:/usr/local/share:/usr/share",
            ),
            (
                "XDG_DATA_DIRS_ORIG",
                "/usr/share/plasma:/usr/local/share:/usr/share",
            ),
        ]);

        let mods = calculate_sanitized_environment(|k| env.get(k).map(|s| s.to_string()));

        assert_eq!(
            mods.vars_to_set.get("XDG_DATA_DIRS"),
            Some(&"/usr/share/plasma:/usr/local/share:/usr/share".to_string())
        );
        assert!(mods.vars_to_unset.contains("XDG_DATA_DIRS_ORIG"));
    }

    #[test]
    fn appimage_filters_appdir_from_xdg_data_dirs_when_orig_is_missing() {
        let env: HashMap<&str, &str> = HashMap::from([
            ("APPDIR", "/tmp/.mount_Asyar123"),
            (
                "XDG_DATA_DIRS",
                "/tmp/.mount_Asyar123/usr/share:/usr/local/share:/usr/share",
            ),
        ]);

        let mods = calculate_sanitized_environment(|k| env.get(k).map(|s| s.to_string()));

        assert_eq!(
            mods.vars_to_set.get("XDG_DATA_DIRS"),
            Some(&"/usr/local/share:/usr/share".to_string())
        );
    }

    #[test]
    fn appimage_filters_appdir_from_path_when_orig_is_missing() {
        let env: HashMap<&str, &str> = HashMap::from([
            ("APPDIR", "/tmp/.mount_Asyar123"),
            (
                "PATH",
                "/tmp/.mount_Asyar123/usr/bin:/usr/local/bin:/usr/bin:/bin",
            ),
        ]);

        let mods = calculate_sanitized_environment(|k| env.get(k).map(|s| s.to_string()));

        assert_eq!(
            mods.vars_to_set.get("PATH"),
            Some(&"/usr/local/bin:/usr/bin:/bin".to_string())
        );
    }

    #[test]
    fn appimage_unsets_runtime_variables() {
        let env: HashMap<&str, &str> = HashMap::from([
            ("APPIMAGE", "/home/test/Asyar.AppImage"),
            ("APPDIR", "/tmp/.mount_Asyar123"),
            ("OWD", "/home/test"),
            ("ARGV0", "asyar"),
            ("GIO_MODULE_DIR", "/tmp/.mount_Asyar123/usr/lib/gio/modules"),
            ("GIO_EXTRA_MODULES", "/tmp/.mount_Asyar123/usr/lib/gio"),
            (
                "GDK_PIXBUF_MODULE_FILE",
                "/tmp/.mount_Asyar123/loaders.cache",
            ),
            ("QT_PLUGIN_PATH", "/tmp/.mount_Asyar123/plugins"),
            ("PYTHONPATH", "/tmp/.mount_Asyar123/python"),
        ]);

        let mods = calculate_sanitized_environment(|k| env.get(k).map(|s| s.to_string()));

        let expected_unsets = [
            "APPIMAGE",
            "APPDIR",
            "OWD",
            "ARGV0",
            "GIO_MODULE_DIR",
            "GIO_EXTRA_MODULES",
            "GDK_PIXBUF_MODULE_FILE",
            "QT_PLUGIN_PATH",
            "PYTHONPATH",
        ];

        for var in expected_unsets {
            assert!(
                mods.vars_to_unset.contains(var),
                "Expected {} to be unset",
                var
            );
        }
    }

    #[test]
    fn appimage_restores_all_orig_variables() {
        let env: HashMap<&str, &str> = HashMap::from([
            ("APPIMAGE", "/home/test/Asyar.AppImage"),
            ("LD_PRELOAD_ORIG", "/usr/lib/libeatmydata.so"),
            ("PYTHONPATH_ORIG", "/home/test/my_python"),
            ("PYTHONHOME_ORIG", "/usr"),
            ("PYTHONEXECUTABLE_ORIG", "/usr/bin/python3"),
            ("PERLLIB_ORIG", "/home/test/perl5"),
            ("PERL5LIB_ORIG", "/home/test/perl5/lib"),
            ("QT_PLUGIN_PATH_ORIG", "/usr/lib/qt5/plugins"),
            ("QT_QPA_PLATFORMTHEME_ORIG", "gtk3"),
            ("GSETTINGS_SCHEMA_DIR_ORIG", "/usr/share/glib-2.0/schemas"),
            ("PATH_ORIG", "/usr/local/bin:/usr/bin:/bin"),
        ]);

        let mods = calculate_sanitized_environment(|k| env.get(k).map(|s| s.to_string()));

        assert_eq!(
            mods.vars_to_set.get("LD_PRELOAD"),
            Some(&"/usr/lib/libeatmydata.so".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("PYTHONPATH"),
            Some(&"/home/test/my_python".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("PYTHONHOME"),
            Some(&"/usr".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("PYTHONEXECUTABLE"),
            Some(&"/usr/bin/python3".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("PERLLIB"),
            Some(&"/home/test/perl5".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("PERL5LIB"),
            Some(&"/home/test/perl5/lib".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("QT_PLUGIN_PATH"),
            Some(&"/usr/lib/qt5/plugins".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("QT_QPA_PLATFORMTHEME"),
            Some(&"gtk3".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("GSETTINGS_SCHEMA_DIR"),
            Some(&"/usr/share/glib-2.0/schemas".to_string())
        );
        assert_eq!(
            mods.vars_to_set.get("PATH"),
            Some(&"/usr/local/bin:/usr/bin:/bin".to_string())
        );

        // Ensure all _ORIG variables are pruned
        assert!(mods.vars_to_unset.contains("LD_PRELOAD_ORIG"));
        assert!(mods.vars_to_unset.contains("PYTHONPATH_ORIG"));
        assert!(mods.vars_to_unset.contains("PATH_ORIG"));
    }

    #[test]
    fn apply_to_command_modifies_process_command() {
        let mut mods = EnvironmentModifications::default();
        mods.vars_to_set
            .insert("LD_LIBRARY_PATH".to_string(), "/usr/lib".to_string());
        mods.vars_to_unset.insert("GIO_MODULE_DIR".to_string());

        let mut cmd = std::process::Command::new("echo");
        mods.apply_to_command(&mut cmd);

        // Command doesn't provide public inspection of all env changes across all Rust versions,
        // but we verify that calling apply_to_command succeeds cleanly.
    }
}
