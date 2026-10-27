//! One-time background cleanup of legacy "asyar" MCP server registrations
//! written into external CLI configurations (Claude Code, Google Antigravity, and OpenAI Codex).

use std::path::Path;

pub const CLEANUP_MARKER_FILE_NAME: &str = "cli-config-cleanup-v1.done";

/// Outcome of attempting cleanup on a specific configuration file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupAction {
    /// Matching entry was found, safely removed, and changes written back.
    Removed,
    /// Configuration file does not exist, or does not contain an "asyar" entry.
    NotPresent,
    /// An "asyar" entry was present, but command or args did not match Asyar.
    LeftNotOurs,
    /// File could not be read, failed to parse, or could not be safely repaired.
    LeftUnreadable,
    /// File was continuously modified concurrently between read and rename attempts.
    LeftBusy,
}

impl CleanupAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            CleanupAction::Removed => "removed",
            CleanupAction::NotPresent => "not present",
            CleanupAction::LeftNotOurs => "left: not ours",
            CleanupAction::LeftUnreadable => "left: unreadable",
            CleanupAction::LeftBusy => "left: busy",
        }
    }
}

/// Overall report of the one-time cleanup run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CleanupReport {
    pub marker_already_present: bool,
    pub claude_action: CleanupAction,
    pub gemini_action: CleanupAction,
    pub codex_action: CleanupAction,
}

/// Checks whether a command string refers to an Asyar binary.
/// Matches:
/// - "asyar" or "asyar.exe" (case-insensitive)
/// - Cargo test binary pattern: "asyar_lib-" followed by hex digits (e.g. asyar_lib-29471f0ea99c274b)
/// - Any explicitly injected custom binary name (e.g. for testing)
pub fn is_matching_binary(command: &str, extra_exe_name: Option<&str>) -> bool {
    let file_name = command.rsplit(['/', '\\']).next().unwrap_or(command);

    if let Some(extra) = extra_exe_name {
        let extra_name = extra.rsplit(['/', '\\']).next().unwrap_or(extra);
        if file_name.eq_ignore_ascii_case(extra_name) {
            return true;
        }
    }

    if file_name.eq_ignore_ascii_case("asyar") || file_name.eq_ignore_ascii_case("asyar.exe") {
        return true;
    }

    // Cargo test binary pattern: "asyar_lib-" followed by hex characters
    if let Some(rest) = file_name.strip_prefix("asyar_lib-") {
        let hex_part = rest.strip_suffix(".exe").unwrap_or(rest);
        if !hex_part.is_empty() && hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
            return true;
        }
    }

    false
}

/// Creates a uniquely named temporary file born with the specified permissions mode.
/// On Unix, sets `mode` via `OpenOptionsExt` and explicitly calls `set_permissions` to ensure
/// no restrictive umask leaves it in an incorrect state. Never leaves the file open to others.
pub fn create_temp_file_with_mode(
    parent: &Path,
    file_name: &str,
    mode: u32,
) -> std::io::Result<(std::fs::File, std::path::PathBuf)> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rand_id = uuid::Uuid::new_v4();
    let tmp_path = parent.join(format!("{file_name}.{pid}.{nanos}.{rand_id}.tmp"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        use std::os::unix::fs::PermissionsExt;
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode & 0o777)
            .open(&tmp_path)?;
        if let Err(e) = file.set_permissions(std::fs::Permissions::from_mode(mode & 0o777)) {
            drop(file);
            let _ = std::fs::remove_file(&tmp_path);
            return Err(e);
        }
        Ok((file, tmp_path))
    }
    #[cfg(not(unix))]
    {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)?;
        Ok((file, tmp_path))
    }
}

/// Atomically writes content to `path` via a temporary file in the same directory,
/// preserving existing file permissions (on Unix).
/// Generic atomic cleanup engine with:
/// - Symlink resolution (canonicalize to edit real target without replacing the symlink)
/// - Safe temp file creation born with original target's mode (or 0o600)
/// - `sync_all()` before rename
/// - Lost-update protection: compares file content right before rename and retries up to 3 times
/// - Fallback to "left: busy" if concurrent modifications persist
fn cleanup_file_atomic<T, F, C>(
    path: &Path,
    mut transform: T,
    mut before_rename: F,
    create_temp: C,
) -> CleanupAction
where
    T: FnMut(&str) -> Result<Option<String>, CleanupAction>,
    F: FnMut(&Path, usize),
    C: Fn(&Path, &str, u32) -> std::io::Result<(std::fs::File, std::path::PathBuf)>,
{
    let real_path = if path.is_symlink() {
        match std::fs::canonicalize(path) {
            Ok(p) => p,
            Err(_) => {
                log::info!("[cli_config_cleanup] {}: left: unreadable", path.display());
                return CleanupAction::LeftUnreadable;
            }
        }
    } else {
        path.to_path_buf()
    };

    if !real_path.exists() {
        log::info!("[cli_config_cleanup] {}: not present", path.display());
        return CleanupAction::NotPresent;
    }

    const MAX_ATTEMPTS: usize = 3;

    for attempt in 0..MAX_ATTEMPTS {
        let initial_content = match std::fs::read_to_string(&real_path) {
            Ok(c) => c,
            Err(_) => {
                log::info!("[cli_config_cleanup] {}: left: unreadable", path.display());
                return CleanupAction::LeftUnreadable;
            }
        };

        let new_content = match transform(&initial_content) {
            Ok(Some(content)) => content,
            Ok(None) => {
                log::info!("[cli_config_cleanup] {}: not present", path.display());
                return CleanupAction::NotPresent;
            }
            Err(action) => {
                log::info!(
                    "[cli_config_cleanup] {}: {}",
                    path.display(),
                    action.as_str()
                );
                return action;
            }
        };

        #[cfg(unix)]
        let original_mode = match std::fs::metadata(&real_path) {
            Ok(m) => {
                use std::os::unix::fs::PermissionsExt;
                m.permissions().mode() & 0o777
            }
            Err(_) => 0o600,
        };
        #[cfg(not(unix))]
        let original_mode = 0o600;

        let parent = match real_path.parent() {
            Some(p) => p,
            None => {
                log::info!("[cli_config_cleanup] {}: left: unreadable", path.display());
                return CleanupAction::LeftUnreadable;
            }
        };

        let file_name = real_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("config");

        let (mut tmp_file, tmp_path) = match create_temp(parent, file_name, original_mode) {
            Ok(pair) => pair,
            Err(e) => {
                log::warn!(
                    "[cli_config_cleanup] {}: failed to create temp file: {}",
                    path.display(),
                    e
                );
                return CleanupAction::LeftUnreadable;
            }
        };

        let write_res = (|| -> std::io::Result<()> {
            use std::io::Write;
            tmp_file.write_all(new_content.as_bytes())?;
            tmp_file.sync_all()?;
            Ok(())
        })();

        if let Err(e) = write_res {
            drop(tmp_file);
            let _ = std::fs::remove_file(&tmp_path);
            log::warn!(
                "[cli_config_cleanup] {}: failed to write temp file: {}",
                path.display(),
                e
            );
            return CleanupAction::LeftUnreadable;
        }

        drop(tmp_file);

        // Seam for testing concurrent modifications
        before_rename(&real_path, attempt);

        // Lost-update protection: re-read target file and compare byte-for-byte
        let current_content = match std::fs::read_to_string(&real_path) {
            Ok(c) => c,
            Err(_) => {
                let _ = std::fs::remove_file(&tmp_path);
                log::info!("[cli_config_cleanup] {}: left: unreadable", path.display());
                return CleanupAction::LeftUnreadable;
            }
        };

        if current_content != initial_content {
            let _ = std::fs::remove_file(&tmp_path);
            log::info!(
                "[cli_config_cleanup] {}: file changed concurrently, retrying (attempt {}/{})",
                path.display(),
                attempt + 1,
                MAX_ATTEMPTS
            );
            continue;
        }

        if let Err(e) = std::fs::rename(&tmp_path, &real_path) {
            let _ = std::fs::remove_file(&tmp_path);
            log::warn!(
                "[cli_config_cleanup] {}: rename failed: {}",
                path.display(),
                e
            );
            return CleanupAction::LeftUnreadable;
        }

        log::info!("[cli_config_cleanup] {}: removed", path.display());
        return CleanupAction::Removed;
    }

    log::info!("[cli_config_cleanup] {}: left: busy", path.display());
    CleanupAction::LeftBusy
}

/// Cleans an "asyar" entry from a JSON config file (e.g. ~/.claude.json or ~/.gemini/config/mcp_config.json).
pub fn cleanup_json_file(path: &Path, extra_exe_name: Option<&str>) -> CleanupAction {
    cleanup_json_file_with_hooks(path, extra_exe_name, |_, _| (), create_temp_file_with_mode)
}

/// Allows injecting a seam hook right before rename for concurrent update testing.
pub fn cleanup_json_file_with_seam<F>(
    path: &Path,
    extra_exe_name: Option<&str>,
    before_rename: F,
) -> CleanupAction
where
    F: FnMut(&Path, usize),
{
    cleanup_json_file_with_hooks(
        path,
        extra_exe_name,
        before_rename,
        create_temp_file_with_mode,
    )
}

/// Allows injecting hooks for both `before_rename` and temp file creation.
pub fn cleanup_json_file_with_hooks<F, C>(
    path: &Path,
    extra_exe_name: Option<&str>,
    before_rename: F,
    create_temp: C,
) -> CleanupAction
where
    F: FnMut(&Path, usize),
    C: Fn(&Path, &str, u32) -> std::io::Result<(std::fs::File, std::path::PathBuf)>,
{
    cleanup_file_atomic(
        path,
        |content| {
            let mut doc: serde_json::Value = match serde_json::from_str(content) {
                Ok(v) => v,
                Err(_) => return Err(CleanupAction::LeftUnreadable),
            };

            let Some(doc_obj) = doc.as_object_mut() else {
                return Err(CleanupAction::LeftUnreadable);
            };

            let Some(mcp_servers) = doc_obj
                .get_mut("mcpServers")
                .and_then(|v| v.as_object_mut())
            else {
                return Ok(None);
            };

            let Some(asyar_val) = mcp_servers.get("asyar") else {
                return Ok(None);
            };

            let args_match = match asyar_val.get("args").and_then(|a| a.as_array()) {
                Some(arr) => arr.len() == 1 && arr[0].as_str() == Some("mcp-server"),
                None => false,
            };

            let command_match = match asyar_val.get("command").and_then(|c| c.as_str()) {
                Some(cmd) => is_matching_binary(cmd, extra_exe_name),
                None => false,
            };

            if !args_match || !command_match {
                return Err(CleanupAction::LeftNotOurs);
            }

            mcp_servers.remove("asyar");

            let mut formatted = match serde_json::to_string_pretty(&doc) {
                Ok(f) => f,
                Err(_) => return Err(CleanupAction::LeftUnreadable),
            };
            if !formatted.ends_with('\n') {
                formatted.push('\n');
            }

            Ok(Some(formatted))
        },
        before_rename,
        create_temp,
    )
}

fn extract_toml_command_and_args(item: &toml_edit::Item) -> (Option<String>, Option<Vec<String>>) {
    match item {
        toml_edit::Item::Table(t) => {
            let cmd = t
                .get("command")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let args = t.get("args").and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            });
            (cmd, args)
        }
        toml_edit::Item::Value(toml_edit::Value::InlineTable(t)) => {
            let cmd = t
                .get("command")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let args = t.get("args").and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            });
            (cmd, args)
        }
        _ => (None, None),
    }
}

fn parse_block_command_and_args(block: &str) -> (Option<String>, Option<Vec<String>>) {
    let mut command = None;
    let mut args = None;

    for line in block.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("command") {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let val_str = rest.trim();
                let is_quoted = (val_str.starts_with('"') && val_str.ends_with('"'))
                    || (val_str.starts_with('\'') && val_str.ends_with('\''));
                if is_quoted && val_str.len() >= 2 {
                    command = Some(val_str[1..val_str.len() - 1].to_string());
                }
            }
        } else if let Some(rest) = trimmed.strip_prefix("args") {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let val_str = rest.trim();
                if let Some(inner) = val_str.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
                    let items: Vec<String> = inner
                        .split(',')
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .map(|s| {
                            if (s.starts_with('"') && s.ends_with('"'))
                                || (s.starts_with('\'') && s.ends_with('\''))
                            {
                                if s.len() >= 2 {
                                    s[1..s.len() - 1].to_string()
                                } else {
                                    s.to_string()
                                }
                            } else {
                                s.to_string()
                            }
                        })
                        .collect();
                    args = Some(items);
                }
            }
        }
    }

    (command, args)
}

fn remove_asyar_toml_block(content: &str, extra_exe_name: Option<&str>) -> Option<String> {
    if !content.contains("[mcp_servers.asyar]") {
        return None;
    }

    let lines: Vec<&str> = content.lines().collect();
    let mut block_start = None;
    let mut block_end = None;

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed == "[mcp_servers.asyar]" {
            block_start = Some(i);
        } else if block_start.is_some() && block_end.is_none() && trimmed.starts_with('[') {
            block_end = Some(i);
            break;
        }
    }

    let start_idx = block_start?;
    let end_idx = block_end.unwrap_or(lines.len());

    let block_lines = &lines[start_idx..end_idx];
    let block_text = block_lines.join("\n");

    let (cmd, args) = parse_block_command_and_args(&block_text);

    let is_cmd_match = cmd
        .as_deref()
        .is_some_and(|c| is_matching_binary(c, extra_exe_name));
    let is_args_match = args
        .as_ref()
        .is_some_and(|a| a.len() == 1 && a[0] == "mcp-server");

    if !is_cmd_match || !is_args_match {
        return None;
    }

    let mut actual_start = start_idx;
    if actual_start > 0 && lines[actual_start - 1].trim().is_empty() {
        actual_start -= 1;
    }

    let mut remaining_lines = Vec::new();
    remaining_lines.extend_from_slice(&lines[..actual_start]);
    remaining_lines.extend_from_slice(&lines[end_idx..]);

    let mut result = remaining_lines.join("\n");
    if content.ends_with('\n') && !result.ends_with('\n') {
        result.push('\n');
    }

    if result.parse::<toml_edit::DocumentMut>().is_ok() {
        Some(result)
    } else {
        None
    }
}

/// Cleans an "asyar" entry from Codex config TOML (~/.codex/config.toml).
/// Preserves comments and other tables via `toml_edit`.
/// Falls back to text repair if the file failed to parse due to Windows unescaped paths.
pub fn cleanup_codex_toml(path: &Path, extra_exe_name: Option<&str>) -> CleanupAction {
    cleanup_codex_toml_with_hooks(path, extra_exe_name, |_, _| (), create_temp_file_with_mode)
}

/// Allows injecting a seam hook right before rename for concurrent update testing.
pub fn cleanup_codex_toml_with_seam<F>(
    path: &Path,
    extra_exe_name: Option<&str>,
    before_rename: F,
) -> CleanupAction
where
    F: FnMut(&Path, usize),
{
    cleanup_codex_toml_with_hooks(
        path,
        extra_exe_name,
        before_rename,
        create_temp_file_with_mode,
    )
}

/// Allows injecting hooks for both `before_rename` and temp file creation.
pub fn cleanup_codex_toml_with_hooks<F, C>(
    path: &Path,
    extra_exe_name: Option<&str>,
    before_rename: F,
    create_temp: C,
) -> CleanupAction
where
    F: FnMut(&Path, usize),
    C: Fn(&Path, &str, u32) -> std::io::Result<(std::fs::File, std::path::PathBuf)>,
{
    cleanup_file_atomic(
        path,
        |content| match content.parse::<toml_edit::DocumentMut>() {
            Ok(mut doc) => {
                let Some(mcp_servers_item) = doc.get_mut("mcp_servers") else {
                    return Ok(None);
                };
                let Some(mcp_servers_table) = mcp_servers_item.as_table_like_mut() else {
                    return Ok(None);
                };
                let Some(asyar_item) = mcp_servers_table.get("asyar") else {
                    return Ok(None);
                };

                let (cmd, args) = extract_toml_command_and_args(asyar_item);
                let cmd_match = cmd
                    .as_deref()
                    .is_some_and(|c| is_matching_binary(c, extra_exe_name));
                let args_match = args
                    .as_ref()
                    .is_some_and(|a| a.len() == 1 && a[0] == "mcp-server");

                if !cmd_match || !args_match {
                    return Err(CleanupAction::LeftNotOurs);
                }

                mcp_servers_table.remove("asyar");
                Ok(Some(doc.to_string()))
            }
            Err(_) => {
                if !content.contains("[mcp_servers.asyar]") {
                    return Err(CleanupAction::LeftUnreadable);
                }

                if let Some(cleaned) = remove_asyar_toml_block(content, extra_exe_name) {
                    Ok(Some(cleaned))
                } else {
                    Err(CleanupAction::LeftUnreadable)
                }
            }
        },
        before_rename,
        create_temp,
    )
}

/// Runs the one-time cleanup against the provided home and app data directories.
/// The `extra_exe_name` allows matching custom binary names during tests or development.
pub fn run_cleanup(
    home_dir: &Path,
    app_data_dir: &Path,
    extra_exe_name: Option<&str>,
) -> CleanupReport {
    run_cleanup_with_seam(home_dir, app_data_dir, extra_exe_name, |_, _| ())
}

/// Runs cleanup with an optional seam hook right before file rename for testing.
pub fn run_cleanup_with_seam<F>(
    home_dir: &Path,
    app_data_dir: &Path,
    extra_exe_name: Option<&str>,
    mut before_rename: F,
) -> CleanupReport
where
    F: FnMut(&Path, usize),
{
    let marker_path = app_data_dir.join(CLEANUP_MARKER_FILE_NAME);
    if marker_path.exists() {
        return CleanupReport {
            marker_already_present: true,
            claude_action: CleanupAction::NotPresent,
            gemini_action: CleanupAction::NotPresent,
            codex_action: CleanupAction::NotPresent,
        };
    }

    let claude_path = home_dir.join(".claude.json");
    let gemini_path = home_dir.join(".gemini/config/mcp_config.json");
    let codex_path = home_dir.join(".codex/config.toml");

    let claude_action =
        cleanup_json_file_with_seam(&claude_path, extra_exe_name, &mut before_rename);
    let gemini_action =
        cleanup_json_file_with_seam(&gemini_path, extra_exe_name, &mut before_rename);
    let codex_action =
        cleanup_codex_toml_with_seam(&codex_path, extra_exe_name, &mut before_rename);

    // Afterwards, write marker file in app_data_dir so it never runs again.
    let _ = std::fs::create_dir_all(app_data_dir);
    if let Err(e) = std::fs::write(&marker_path, b"done\n") {
        log::warn!(
            "[cli_config_cleanup] failed to write marker file {}: {}",
            marker_path.display(),
            e
        );
    }

    CleanupReport {
        marker_already_present: false,
        claude_action,
        gemini_action,
        codex_action,
    }
}

/// Entrypoint called from background startup daemons (`bootstrap::services::init_daemons`).
pub fn run_cleanup_if_needed(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(app_data_dir) = app_handle.path().app_data_dir() else {
        log::warn!("[cli_config_cleanup] could not resolve app_data_dir");
        return;
    };

    let marker_path = app_data_dir.join(CLEANUP_MARKER_FILE_NAME);
    if marker_path.exists() {
        return;
    }

    let Some(home_dir) = app_handle.path().home_dir().ok().or_else(dirs::home_dir) else {
        log::warn!("[cli_config_cleanup] could not resolve home_dir");
        return;
    };

    let current_exe_name = std::env::current_exe()
        .ok()
        .as_ref()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());

    run_cleanup(&home_dir, &app_data_dir, current_exe_name.as_deref());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_matching_binary_rules() {
        assert!(is_matching_binary("asyar", None));
        assert!(is_matching_binary("asyar.exe", None));
        assert!(is_matching_binary("ASYAR", None));
        assert!(is_matching_binary("Asyar.exe", None));
        assert!(is_matching_binary(
            "/Applications/Asyar.app/Contents/MacOS/asyar",
            None
        ));
        assert!(is_matching_binary(
            "C:\\Program Files\\Asyar\\asyar.exe",
            None
        ));
        assert!(is_matching_binary(
            "target/debug/deps/asyar_lib-29471f0ea99c274b",
            None
        ));
        assert!(is_matching_binary(
            "target\\debug\\deps\\asyar_lib-29471f0ea99c274b.exe",
            None
        ));
        assert!(is_matching_binary(
            "/custom/path/custom_launcher",
            Some("custom_launcher")
        ));

        // Negative cases
        assert!(!is_matching_binary("/usr/bin/python", None));
        assert!(!is_matching_binary("asyar_lib-", None));
        assert!(!is_matching_binary("asyar_lib-nothex!", None));
        assert!(!is_matching_binary("node", None));
    }

    #[test]
    fn test_cleanup_matching_entry_removed_others_preserved_json_and_toml() {
        let home_dir = tempfile::tempdir().unwrap();
        let app_data_dir = tempfile::tempdir().unwrap();

        // 1. ~/.claude.json
        let claude_file = home_dir.path().join(".claude.json");
        let claude_init = serde_json::json!({
            "mcpServers": {
                "other-server": {
                    "command": "node",
                    "args": ["server.js"]
                },
                "asyar": {
                    "command": "/Applications/Asyar.app/Contents/MacOS/asyar",
                    "args": ["mcp-server"]
                }
            },
            "otherKey": "preserved"
        });
        std::fs::write(&claude_file, claude_init.to_string()).unwrap();

        // 2. ~/.gemini/config/mcp_config.json
        let gemini_file = home_dir.path().join(".gemini/config/mcp_config.json");
        std::fs::create_dir_all(gemini_file.parent().unwrap()).unwrap();
        let gemini_init = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "target/debug/deps/asyar_lib-29471f0ea99c274b",
                    "args": ["mcp-server"]
                }
            }
        });
        std::fs::write(&gemini_file, gemini_init.to_string()).unwrap();

        // 3. ~/.codex/config.toml
        let codex_file = home_dir.path().join(".codex/config.toml");
        std::fs::create_dir_all(codex_file.parent().unwrap()).unwrap();
        let codex_init = r#"
[general]
model = "gpt-4"

[mcp_servers.other]
command = "node"
args = ["index.js"]

[mcp_servers.asyar]
command = "C:\\Program Files\\Asyar\\asyar.exe"
args = ["mcp-server"]
"#;
        std::fs::write(&codex_file, codex_init).unwrap();

        let report = run_cleanup(home_dir.path(), app_data_dir.path(), None);
        assert!(!report.marker_already_present);
        assert_eq!(report.claude_action, CleanupAction::Removed);
        assert_eq!(report.gemini_action, CleanupAction::Removed);
        assert_eq!(report.codex_action, CleanupAction::Removed);

        // Verify claude.json
        let claude_doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&claude_file).unwrap()).unwrap();
        assert!(claude_doc["mcpServers"].get("asyar").is_none());
        assert_eq!(claude_doc["mcpServers"]["other-server"]["command"], "node");
        assert_eq!(claude_doc["otherKey"], "preserved");

        // Verify gemini mcp_config.json
        let gemini_doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&gemini_file).unwrap()).unwrap();
        assert!(gemini_doc["mcpServers"].get("asyar").is_none());
        assert!(gemini_doc["mcpServers"].is_object());

        // Verify codex config.toml
        let codex_str = std::fs::read_to_string(&codex_file).unwrap();
        let codex_doc: toml_edit::DocumentMut = codex_str.parse().unwrap();
        assert!(codex_doc.get("mcp_servers").unwrap().get("asyar").is_none());
        assert!(codex_doc.get("mcp_servers").unwrap().get("other").is_some());
        assert_eq!(
            codex_doc
                .get("general")
                .unwrap()
                .get("model")
                .unwrap()
                .as_str(),
            Some("gpt-4")
        );

        // Verify marker file exists
        assert!(app_data_dir.path().join(CLEANUP_MARKER_FILE_NAME).exists());
    }

    #[test]
    fn test_cleanup_entry_named_asyar_with_different_command_or_args_left_alone() {
        let home_dir = tempfile::tempdir().unwrap();
        let app_data_dir = tempfile::tempdir().unwrap();

        // 1. ~/.claude.json with non-asyar command
        let claude_file = home_dir.path().join(".claude.json");
        let claude_init = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "python",
                    "args": ["mcp-server"]
                }
            }
        });
        std::fs::write(&claude_file, claude_init.to_string()).unwrap();

        // 2. ~/.gemini/config/mcp_config.json with non-matching args
        let gemini_file = home_dir.path().join(".gemini/config/mcp_config.json");
        std::fs::create_dir_all(gemini_file.parent().unwrap()).unwrap();
        let gemini_init = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "asyar",
                    "args": ["other-subcommand"]
                }
            }
        });
        std::fs::write(&gemini_file, gemini_init.to_string()).unwrap();

        // 3. ~/.codex/config.toml with non-asyar command
        let codex_file = home_dir.path().join(".codex/config.toml");
        std::fs::create_dir_all(codex_file.parent().unwrap()).unwrap();
        let codex_init = r#"
[mcp_servers.asyar]
command = "other_custom_tool"
args = ["mcp-server"]
"#;
        std::fs::write(&codex_file, codex_init).unwrap();

        let report = run_cleanup(home_dir.path(), app_data_dir.path(), None);
        assert_eq!(report.claude_action, CleanupAction::LeftNotOurs);
        assert_eq!(report.gemini_action, CleanupAction::LeftNotOurs);
        assert_eq!(report.codex_action, CleanupAction::LeftNotOurs);

        // Verify files still have their asyar entries
        let claude_doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&claude_file).unwrap()).unwrap();
        assert_eq!(claude_doc["mcpServers"]["asyar"]["command"], "python");

        let gemini_doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&gemini_file).unwrap()).unwrap();
        assert_eq!(
            gemini_doc["mcpServers"]["asyar"]["args"][0],
            "other-subcommand"
        );

        let codex_str = std::fs::read_to_string(&codex_file).unwrap();
        assert!(codex_str.contains("other_custom_tool"));
    }

    #[test]
    fn test_cleanup_invalid_json_byte_for_byte_unchanged() {
        let home_dir = tempfile::tempdir().unwrap();

        let claude_file = home_dir.path().join(".claude.json");
        let malformed = b"{ not valid json at all ::: ";
        std::fs::write(&claude_file, malformed).unwrap();

        let action = cleanup_json_file(&claude_file, None);
        assert_eq!(action, CleanupAction::LeftUnreadable);

        let bytes_after = std::fs::read(&claude_file).unwrap();
        assert_eq!(bytes_after, malformed);
    }

    #[test]
    fn test_cleanup_codex_valid_toml_with_comments_preserved() {
        let home_dir = tempfile::tempdir().unwrap();
        let codex_file = home_dir.path().join(".codex/config.toml");
        std::fs::create_dir_all(codex_file.parent().unwrap()).unwrap();

        let original_toml = r#"# Top comment for Codex
model = "o3-mini"

# Another server comment
[mcp_servers.other]
command = "node"
args = ["index.js"]

# Asyar server comment
[mcp_servers.asyar]
command = "/usr/local/bin/asyar"
args = ["mcp-server"]

# Trailing section
[preferences]
dark_mode = true
"#;
        std::fs::write(&codex_file, original_toml).unwrap();

        let action = cleanup_codex_toml(&codex_file, None);
        assert_eq!(action, CleanupAction::Removed);

        let updated_str = std::fs::read_to_string(&codex_file).unwrap();

        // Comments must be preserved
        assert!(updated_str.contains("# Top comment for Codex"));
        assert!(updated_str.contains("# Another server comment"));
        assert!(updated_str.contains("# Trailing section"));

        // Other table preserved
        assert!(updated_str.contains("[mcp_servers.other]"));
        assert!(updated_str.contains("[preferences]"));

        // Asyar entry removed
        assert!(!updated_str.contains("[mcp_servers.asyar]"));

        // Result parses as valid TOML
        assert!(updated_str.parse::<toml_edit::DocumentMut>().is_ok());
    }

    #[test]
    fn test_cleanup_codex_windows_case_repairs_broken_toml() {
        let home_dir = tempfile::tempdir().unwrap();
        let codex_file = home_dir.path().join(".codex/config.toml");
        std::fs::create_dir_all(codex_file.parent().unwrap()).unwrap();

        // Windows unescaped backslashes written by older Asyar versions:
        // C:\Users\Tester\AppData\Local\Programs\Asyar\asyar.exe
        // This is invalid TOML because \U, \T, \A, \P, \a are illegal escape sequences.
        let broken_toml = "\
# Codex settings
model = \"o3-mini\"

[mcp_servers.asyar]
command = \"C:\\Users\\Tester\\AppData\\Local\\Programs\\Asyar\\asyar.exe\"
args = [\"mcp-server\"]

[network]
offline = false
";

        std::fs::write(&codex_file, broken_toml).unwrap();

        // Confirm it initially fails to parse as valid TOML
        assert!(broken_toml.parse::<toml_edit::DocumentMut>().is_err());

        let action = cleanup_codex_toml(&codex_file, None);
        assert_eq!(action, CleanupAction::Removed);

        let repaired_str = std::fs::read_to_string(&codex_file).unwrap();

        // Must now parse cleanly as valid TOML
        assert!(repaired_str.parse::<toml_edit::DocumentMut>().is_ok());

        // Asyar block is removed
        assert!(!repaired_str.contains("[mcp_servers.asyar]"));

        // Rest of configuration is preserved
        assert!(repaired_str.contains("model = \"o3-mini\""));
        assert!(repaired_str.contains("[network]"));
        assert!(repaired_str.contains("offline = false"));
    }

    #[test]
    fn test_cleanup_codex_invalid_toml_for_other_reason_unchanged() {
        let home_dir = tempfile::tempdir().unwrap();
        let codex_file = home_dir.path().join(".codex/config.toml");
        std::fs::create_dir_all(codex_file.parent().unwrap()).unwrap();

        let invalid_toml = r#"
this is a completely broken toml file [[ [ {
[mcp_servers.asyar]
command = "/usr/local/bin/asyar"
args = ["mcp-server"]
"#;
        std::fs::write(&codex_file, invalid_toml).unwrap();

        let action = cleanup_codex_toml(&codex_file, None);
        assert_eq!(action, CleanupAction::LeftUnreadable);

        let after = std::fs::read_to_string(&codex_file).unwrap();
        assert_eq!(after, invalid_toml);
    }

    #[cfg(unix)]
    #[test]
    fn test_temp_file_mode_and_cleanup_preserves_modes() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = tempfile::tempdir().unwrap();

        // 1. Assert helper creates file with 0600 mode
        let (file_600, path_600) =
            create_temp_file_with_mode(temp_dir.path(), "test600", 0o600).unwrap();
        let mode_600 = file_600.metadata().unwrap().permissions().mode() & 0o777;
        assert_eq!(mode_600, 0o600);
        drop(file_600);
        let _ = std::fs::remove_file(&path_600);

        // 2. Assert helper creates file with 0640 mode
        let (file_640, path_640) =
            create_temp_file_with_mode(temp_dir.path(), "test640", 0o640).unwrap();
        let mode_640 = file_640.metadata().unwrap().permissions().mode() & 0o777;
        assert_eq!(mode_640, 0o640);
        drop(file_640);
        let _ = std::fs::remove_file(&path_640);

        // 3. Assert full cleanup preserves 0600 original
        let claude_file_600 = temp_dir.path().join(".claude_600.json");
        let claude_init = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "/Applications/Asyar.app/Contents/MacOS/asyar",
                    "args": ["mcp-server"]
                }
            }
        });
        std::fs::write(&claude_file_600, claude_init.to_string()).unwrap();
        std::fs::set_permissions(&claude_file_600, std::fs::Permissions::from_mode(0o600)).unwrap();

        let action_600 = cleanup_json_file(&claude_file_600, None);
        assert_eq!(action_600, CleanupAction::Removed);
        let final_perms_600 = std::fs::metadata(&claude_file_600)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(final_perms_600, 0o600);

        // 4. Assert full cleanup preserves 0640 original
        let claude_file_640 = temp_dir.path().join(".claude_640.json");
        std::fs::write(&claude_file_640, claude_init.to_string()).unwrap();
        std::fs::set_permissions(&claude_file_640, std::fs::Permissions::from_mode(0o640)).unwrap();

        let action_640 = cleanup_json_file(&claude_file_640, None);
        assert_eq!(action_640, CleanupAction::Removed);
        let final_perms_640 = std::fs::metadata(&claude_file_640)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(final_perms_640, 0o640);
    }

    #[test]
    fn test_cleanup_permission_failure_surfaces_error_and_leaves_file_untouched() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join(".claude.json");
        let initial_json = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "asyar",
                    "args": ["mcp-server"]
                }
            },
            "token": "secret_abc"
        });
        std::fs::write(&file_path, initial_json.to_string()).unwrap();

        let action = cleanup_json_file_with_hooks(
            &file_path,
            None,
            |_, _| (),
            |_parent, _name, _mode| {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "permission denied",
                ))
            },
        );

        assert_eq!(action, CleanupAction::LeftUnreadable);

        // Original file must be completely untouched
        let content_after = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(content_after, initial_json.to_string());

        // No temp files left
        let entries: Vec<_> = std::fs::read_dir(temp_dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file_name(), ".claude.json");
    }

    #[test]
    fn test_cleanup_lost_update_retry_preserves_concurrent_modification() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join(".claude.json");

        let initial_json = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "asyar",
                    "args": ["mcp-server"]
                }
            },
            "original_field": "kept"
        });
        std::fs::write(&file_path, initial_json.to_string()).unwrap();

        // Seam modifies file once on attempt 0
        let mut did_mutate = false;
        let action = cleanup_json_file_with_seam(&file_path, None, |real_path, attempt| {
            if attempt == 0 {
                did_mutate = true;
                let concurrent_json = serde_json::json!({
                    "mcpServers": {
                        "asyar": {
                            "command": "asyar",
                            "args": ["mcp-server"]
                        }
                    },
                    "original_field": "kept",
                    "concurrent_writer_data": "must_preserve"
                });
                std::fs::write(real_path, concurrent_json.to_string()).unwrap();
            }
        });

        assert!(did_mutate);
        assert_eq!(action, CleanupAction::Removed);

        // Verify that BOTH the other writer's change and the removal are present
        let final_doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file_path).unwrap()).unwrap();
        assert!(final_doc["mcpServers"].get("asyar").is_none());
        assert_eq!(final_doc["original_field"], "kept");
        assert_eq!(final_doc["concurrent_writer_data"], "must_preserve");
    }

    #[test]
    fn test_cleanup_file_keeps_changing_returns_left_busy() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join(".claude.json");

        let initial_json = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "asyar",
                    "args": ["mcp-server"]
                }
            }
        });
        std::fs::write(&file_path, initial_json.to_string()).unwrap();

        // Mutate on every attempt (0, 1, 2)
        let mut mutation_count = 0;
        let action = cleanup_json_file_with_seam(&file_path, None, |real_path, attempt| {
            mutation_count += 1;
            let dynamic_json = serde_json::json!({
                "mcpServers": {
                    "asyar": {
                        "command": "asyar",
                        "args": ["mcp-server"]
                    }
                },
                "attempt": attempt
            });
            std::fs::write(real_path, dynamic_json.to_string()).unwrap();
        });

        assert_eq!(mutation_count, 3);
        assert_eq!(action, CleanupAction::LeftBusy);

        // Original file was NOT overwritten with our removal; it contains the 3rd concurrent mutation
        let final_doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file_path).unwrap()).unwrap();
        assert_eq!(final_doc["attempt"], 2);
    }

    #[cfg(unix)]
    #[test]
    fn test_cleanup_symlink_preserved_and_target_edited_unix() {
        let home_dir = tempfile::tempdir().unwrap();
        let target_dir = tempfile::tempdir().unwrap();

        // Real target file lives in target_dir
        let real_file = target_dir.path().join("real_claude.json");
        let initial_json = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "asyar",
                    "args": ["mcp-server"]
                },
                "other": {
                    "command": "node",
                    "args": ["app.js"]
                }
            },
            "preserveMe": true
        });
        std::fs::write(&real_file, initial_json.to_string()).unwrap();

        // Symlink in home_dir points to real_file
        let symlink_path = home_dir.path().join(".claude.json");
        std::os::unix::fs::symlink(&real_file, &symlink_path).unwrap();

        assert!(symlink_path.is_symlink());

        let action = cleanup_json_file(&symlink_path, None);
        assert_eq!(action, CleanupAction::Removed);

        // Path must still be a symlink!
        assert!(symlink_path.is_symlink());
        assert_eq!(
            std::fs::canonicalize(&symlink_path).unwrap(),
            std::fs::canonicalize(&real_file).unwrap()
        );

        // Real target file has asyar removed and other entries preserved
        let doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&real_file).unwrap()).unwrap();
        assert!(doc["mcpServers"].get("asyar").is_none());
        assert!(doc["mcpServers"].get("other").is_some());
        assert_eq!(doc["preserveMe"], true);
    }

    #[test]
    fn test_cleanup_marker_present_touches_nothing() {
        let home_dir = tempfile::tempdir().unwrap();
        let app_data_dir = tempfile::tempdir().unwrap();

        // Pre-create marker file
        let marker = app_data_dir.path().join(CLEANUP_MARKER_FILE_NAME);
        std::fs::write(&marker, b"done\n").unwrap();

        // Create claude.json with matching asyar
        let claude_file = home_dir.path().join(".claude.json");
        let claude_init = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": "asyar",
                    "args": ["mcp-server"]
                }
            }
        });
        std::fs::write(&claude_file, claude_init.to_string()).unwrap();

        let report = run_cleanup(home_dir.path(), app_data_dir.path(), None);
        assert!(report.marker_already_present);

        // Verify claude.json was not touched
        let doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&claude_file).unwrap()).unwrap();
        assert!(doc["mcpServers"].get("asyar").is_some());
    }
}
