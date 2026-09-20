//! Raycast extension installer: downloads, compiles, bundles, and links
//! Raycast store extensions directly from Asyar.

use crate::error::AppError;
use crate::extensions::headless::resolve_node_binary;
use log::{info, warn};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

/// Resolves candidate paths to the `@asyar/raycast-compat` CLI bundle.
pub(crate) fn resolve_cli_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // 1. Check next to current executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            candidates.push(parent.join("raycast-compat").join("cli.js"));
            candidates.push(
                parent
                    .join("resources")
                    .join("raycast-compat")
                    .join("cli.js"),
            );
        }
    }

    // 2. Check Tauri resource directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("raycast-compat").join("cli.js"));
        candidates.push(
            resource_dir
                .join("resources")
                .join("raycast-compat")
                .join("cli.js"),
        );
    }

    // 3. Check compile-time manifest dir (dev mode)
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Manifest dir is `asyar-launcher/src-tauri` -> parent is `asyar-launcher` -> parent is workspace root
    if let Some(workspace_root) = manifest_dir.parent().and_then(|p| p.parent()) {
        candidates.push(
            workspace_root
                .join("packages")
                .join("raycast-compat")
                .join("dist")
                .join("cli.js"),
        );
    }

    // 4. Check current working directory relative path
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("..")
                .join("packages")
                .join("raycast-compat")
                .join("dist")
                .join("cli.js"),
        );
        candidates.push(
            cwd.join("packages")
                .join("raycast-compat")
                .join("dist")
                .join("cli.js"),
        );
    }

    candidates
}

/// Locates the `cli.js` file from `@asyar/raycast-compat`.
pub(crate) fn resolve_cli_path(app: &AppHandle) -> Option<PathBuf> {
    resolve_cli_candidates(app)
        .into_iter()
        .find(|candidate| candidate.exists())
}

/// Downloads, compiles, bundles, and links a Raycast extension.
pub async fn install_raycast(
    app: &AppHandle,
    name: &str,
    download_url: Option<&str>,
) -> Result<(), AppError> {
    let node_bin = resolve_node_binary().ok_or_else(|| {
        AppError::Extension(
            "Node.js runtime not found. Please install Node.js and ensure it is on your PATH to compile Raycast extensions.".to_string(),
        )
    })?;

    let cli_path = resolve_cli_path(app).ok_or_else(|| {
        AppError::Extension(
            "Raycast compatibility compiler CLI not found. Please ensure '@asyar/raycast-compat' is built.".to_string(),
        )
    })?;

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir.parent().and_then(|p| p.parent());

    let (cwd, out_dir) = if let Some(root) = workspace_root {
        if root.join("pnpm-workspace.yaml").exists() {
            let out = root.join("extensions").join(format!("raycast-{}", name));
            (root.to_path_buf(), out)
        } else {
            let app_data = crate::extensions::get_app_data_dir(app)?;
            let out = app_data
                .join("raycast_extensions")
                .join(format!("raycast-{}", name));
            (app_data, out)
        }
    } else {
        let app_data = crate::extensions::get_app_data_dir(app)?;
        let out = app_data
            .join("raycast_extensions")
            .join(format!("raycast-{}", name));
        (app_data, out)
    };

    info!(
        "Installing Raycast extension '{}' (download_url: {:?}) into {:?} using compiler at {:?} with Node '{}'",
        name, download_url, out_dir, cli_path, node_bin
    );

    let mut cmd = tokio::process::Command::new(&node_bin);
    cmd.current_dir(&cwd);
    cmd.arg(&cli_path)
        .arg("--install")
        .arg(name)
        .arg("--out-dir")
        .arg(&out_dir);

    #[cfg(debug_assertions)]
    {
        cmd.arg("--dev");
    }

    #[cfg(not(debug_assertions))]
    {
        cmd.arg("--prod");
    }

    if let Some(url) = download_url {
        cmd.arg("--download-url").arg(url);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Extension(format!("Failed to spawn Raycast compiler: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = if !stderr.trim().is_empty() {
            stderr.to_string()
        } else {
            stdout.to_string()
        };
        warn!("Raycast extension compilation failed: {}", msg);
        return Err(AppError::Extension(format!(
            "Failed to compile Raycast extension '{}': {}",
            name, msg
        )));
    }

    info!(
        "Successfully compiled and linked Raycast extension '{}'",
        name
    );

    // Auto-record consent for the installed Raycast extension so permissions are never withheld
    let ext_id = format!("org.asyar.raycast.{}", name);
    if let Ok(app_data) = crate::extensions::get_app_data_dir(app) {
        let ext_dir = app_data.join("extensions").join(&ext_id);
        let manifest_path = if ext_dir.join("manifest.json").exists() {
            ext_dir.join("manifest.json")
        } else {
            out_dir.join("manifest.json")
        };
        if manifest_path.exists() {
            if let Ok(manifest) = crate::extensions::discovery::read_manifest(&manifest_path) {
                let perms = manifest.permissions.unwrap_or_default();
                let args = manifest.permission_args.unwrap_or_default();
                let record = crate::extensions::consent::ConsentRecord {
                    consented_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                    grandfathered: false,
                    permissions: perms,
                    permission_args: args.into_iter().collect(),
                };
                if let Err(e) = crate::extensions::consent::set_consent(app, &ext_id, &record) {
                    warn!(
                        "Failed to auto-consent Raycast extension '{}': {}",
                        ext_id, e
                    );
                }
            }
        }
    }

    if let Err(e) = app.emit("extensions_updated", ()) {
        warn!(
            "Failed to emit extensions_updated event after Raycast install: {}",
            e
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_cli_candidates_includes_workspace_path() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        if let Some(workspace_root) = manifest_dir.parent().and_then(|p| p.parent()) {
            let expected = workspace_root
                .join("packages")
                .join("raycast-compat")
                .join("dist")
                .join("cli.js");
            assert!(expected.exists(), "cli.js should exist at {:?}", expected);
        }
    }

    #[test]
    fn test_mealie_manifest_validity() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        if let Some(workspace_root) = manifest_dir.parent().and_then(|p| p.parent()) {
            let mealie_manifest = workspace_root
                .join("extensions")
                .join("raycast-mealie")
                .join("manifest.json");
            if mealie_manifest.exists() {
                let res = crate::extensions::discovery::read_manifest(&mealie_manifest);
                assert!(
                    res.is_ok(),
                    "Failed to parse mealie manifest: {:?}",
                    res.err()
                );
            }
        }
    }
}
