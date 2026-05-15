use crate::mcp::types::McpClientError;
use std::path::PathBuf;

/// The result of resolving a user-supplied command to an actual executable +
/// args, considering system PATH availability and bundled sidecar fallback.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// Probe for `cmd` on PATH using a manual scan (no extra deps).
pub fn system_command_exists(cmd: &str) -> bool {
    let path_var = match std::env::var("PATH") {
        Ok(v) => v,
        Err(_) => return false,
    };
    let extensions: &[&str] = if cfg!(windows) {
        &[".exe", ".bat", ".cmd", ""]
    } else {
        &[""]
    };
    for dir in std::env::split_paths(&path_var) {
        for ext in extensions {
            let candidate = dir.join(format!("{cmd}{ext}"));
            if candidate.is_file() {
                return true;
            }
        }
    }
    false
}

/// Resolve a user-supplied command + args into an executable path + args,
/// preferring system commands and falling back to bundled sidecars.
///
/// `bundled_bun` and `bundled_uv` are the absolute paths to the sidecar
/// binaries. Pass `None` to disable sidecar fallback (e.g. in tests).
pub fn resolve_command(
    command: &str,
    args: &[String],
    bundled_bun: Option<&PathBuf>,
    bundled_uv: Option<&PathBuf>,
) -> Result<ResolvedCommand, McpClientError> {
    resolve_command_with_probe(command, args, bundled_bun, bundled_uv, system_command_exists)
}

/// Resolve with an injectable probe function for testability.
pub fn resolve_command_with_probe<F: Fn(&str) -> bool>(
    command: &str,
    args: &[String],
    bundled_bun: Option<&PathBuf>,
    bundled_uv: Option<&PathBuf>,
    probe: F,
) -> Result<ResolvedCommand, McpClientError> {
    // System path takes priority.
    if probe(command) {
        return Ok(ResolvedCommand {
            program: PathBuf::from(command),
            args: args.to_vec(),
        });
    }

    // Sidecar fallback.
    match command {
        "npx" => {
            let bun = bundled_bun.ok_or_else(|| {
                McpClientError::Transport(
                    "npx not found on PATH and no bundled bun available".into(),
                )
            })?;
            let mut new_args = vec!["x".to_string()];
            new_args.extend(args.iter().cloned());
            Ok(ResolvedCommand {
                program: bun.clone(),
                args: new_args,
            })
        }
        "node" => {
            let bun = bundled_bun.ok_or_else(|| {
                McpClientError::Transport(
                    "node not found on PATH and no bundled bun available".into(),
                )
            })?;
            let mut new_args = vec!["run".to_string()];
            new_args.extend(args.iter().cloned());
            Ok(ResolvedCommand {
                program: bun.clone(),
                args: new_args,
            })
        }
        "uvx" => {
            let uv = bundled_uv.ok_or_else(|| {
                McpClientError::Transport(
                    "uvx not found on PATH and no bundled uv available".into(),
                )
            })?;
            let mut new_args = vec!["tool".to_string(), "run".to_string()];
            new_args.extend(args.iter().cloned());
            Ok(ResolvedCommand {
                program: uv.clone(),
                args: new_args,
            })
        }
        "python" | "python3" => {
            let uv = bundled_uv.ok_or_else(|| {
                McpClientError::Transport(
                    "python not found on PATH and no bundled uv available".into(),
                )
            })?;
            let mut new_args = vec![
                "run".to_string(),
                "python".to_string(),
                "--".to_string(),
            ];
            new_args.extend(args.iter().cloned());
            Ok(ResolvedCommand {
                program: uv.clone(),
                args: new_args,
            })
        }
        other => {
            // Not a known command and not on PATH — return as-is and let spawn fail naturally.
            Ok(ResolvedCommand {
                program: PathBuf::from(other),
                args: args.to_vec(),
            })
        }
    }
}

/// Discover bundled sidecar paths from the Tauri app handle.
///
/// Tauri places `externalBin` entries next to the executable on macOS/Linux
/// (Contents/MacOS/ on macOS app bundles) and in the resources/ directory on
/// Windows. We check both locations so development builds (exe next to
/// binaries) and packaged builds both work.
pub fn discover_bundled_paths<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> (Option<PathBuf>, Option<PathBuf>) {
    use tauri::Manager;

    let resource_dir = app.path().resource_dir().ok();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));

    let find = |name: &str| -> Option<PathBuf> {
        // Check resource dir first (Windows packaging path).
        if let Some(ref dir) = resource_dir {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
        // Then check next-to-exe (macOS/Linux packaging + dev builds).
        if let Some(ref dir) = exe_dir {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
        None
    };

    let bun = find("bun");
    let uv = find("uv");

    if bun.is_none() {
        log::warn!("[mcp::sidecar] bundled bun not found; npx/node commands will require system installation");
    }
    if uv.is_none() {
        log::warn!("[mcp::sidecar] bundled uv not found; uvx/python commands will require system installation");
    }

    (bun, uv)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sv(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    // 1. resolve_command_returns_system_command_when_available
    #[test]
    fn resolve_command_returns_system_command_when_available() {
        let bun = PathBuf::from("/bundled/bun");
        let uv = PathBuf::from("/bundled/uv");
        let args = sv(&["--version"]);

        let result = resolve_command_with_probe("npx", &args, Some(&bun), Some(&uv), |_| true)
            .expect("resolve");

        assert_eq!(result.program, PathBuf::from("npx"));
        assert_eq!(result.args, args);
    }

    // 2. resolve_command_rewrites_npx_to_bun_x_when_bun_available
    #[test]
    fn resolve_command_rewrites_npx_to_bun_x_when_bun_available() {
        let bun = PathBuf::from("/bundled/bun");
        let args = sv(&["@modelcontextprotocol/server-filesystem", "/tmp"]);

        let result =
            resolve_command_with_probe("npx", &args, Some(&bun), None, |_| false).expect("resolve");

        assert_eq!(result.program, bun);
        assert_eq!(result.args, sv(&["x", "@modelcontextprotocol/server-filesystem", "/tmp"]));
    }

    // 3. resolve_command_rewrites_node_to_bun_run_when_bun_available
    #[test]
    fn resolve_command_rewrites_node_to_bun_run_when_bun_available() {
        let bun = PathBuf::from("/bundled/bun");
        let args = sv(&["server.js", "--port", "3000"]);

        let result =
            resolve_command_with_probe("node", &args, Some(&bun), None, |_| false).expect("resolve");

        assert_eq!(result.program, bun);
        assert_eq!(result.args, sv(&["run", "server.js", "--port", "3000"]));
    }

    // 4. resolve_command_rewrites_uvx_to_uv_tool_run
    #[test]
    fn resolve_command_rewrites_uvx_to_uv_tool_run() {
        let uv = PathBuf::from("/bundled/uv");
        let args = sv(&["mcp-server-git", "--repository", "/repo"]);

        let result =
            resolve_command_with_probe("uvx", &args, None, Some(&uv), |_| false).expect("resolve");

        assert_eq!(result.program, uv);
        assert_eq!(result.args, sv(&["tool", "run", "mcp-server-git", "--repository", "/repo"]));
    }

    // 5. resolve_command_rewrites_python_to_uv_run_python
    #[test]
    fn resolve_command_rewrites_python_to_uv_run_python() {
        let uv = PathBuf::from("/bundled/uv");
        let args = sv(&["server.py"]);

        let result =
            resolve_command_with_probe("python", &args, None, Some(&uv), |_| false)
                .expect("resolve python");

        assert_eq!(result.program, uv);
        assert_eq!(result.args, sv(&["run", "python", "--", "server.py"]));

        // Also test python3 alias
        let result3 =
            resolve_command_with_probe("python3", &args, None, Some(&uv), |_| false)
                .expect("resolve python3");

        assert_eq!(result3.program, uv);
        assert_eq!(result3.args, sv(&["run", "python", "--", "server.py"]));
    }

    // 6. resolve_command_returns_error_when_no_bun_for_npx_fallback
    #[test]
    fn resolve_command_returns_error_when_no_bun_for_npx_fallback() {
        let args = sv(&["some-package"]);

        let result =
            resolve_command_with_probe("npx", &args, None, None, |_| false);

        match result {
            Err(McpClientError::Transport(msg)) => {
                assert!(
                    msg.contains("npx not found on PATH"),
                    "error must mention npx not found, got: {msg}"
                );
            }
            other => panic!("expected Transport error, got: {other:?}"),
        }
    }

    // 7. resolve_command_passes_through_unknown_commands
    #[test]
    fn resolve_command_passes_through_unknown_commands() {
        let args = sv(&["--help"]);

        let result =
            resolve_command_with_probe("my-custom-server", &args, None, None, |_| false)
                .expect("resolve");

        assert_eq!(result.program, PathBuf::from("my-custom-server"));
        assert_eq!(result.args, args);
    }
}
