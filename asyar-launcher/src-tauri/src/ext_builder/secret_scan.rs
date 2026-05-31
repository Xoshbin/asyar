use std::path::Path;

use crate::error::AppError;

/// File extensions we treat as text and scan for a leaked secret. Mirrors the
/// set the former TypeScript walker used.
const TEXT_EXT: [&str; 7] = [".ts", ".js", ".svelte", ".json", ".html", ".css", ".md"];

/// Directory names we never descend into while scanning a built extension.
const SKIP_DIRS: [&str; 3] = ["node_modules", "dist", ".git"];

/// Recursively walk `base`, scanning every text file for `secret` (matched as
/// raw bytes so odd encodings can't hide it). Skips `node_modules`, `dist`, and
/// `.git`. Returns the path of the first offending file, or `None` if clean.
///
/// An empty or whitespace-only secret means there is nothing to scan, so this
/// returns `Ok(None)`. IO errors propagate so the caller can fail closed.
pub fn scan_dir_for_secret(base: &Path, secret: &str) -> Result<Option<String>, std::io::Error> {
    let needle = secret.trim().as_bytes().to_vec();
    if needle.is_empty() {
        return Ok(None);
    }
    walk(base, &needle)
}

fn walk(dir: &Path, needle: &[u8]) -> Result<Option<String>, std::io::Error> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        // A missing directory has nothing to leak.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if SKIP_DIRS.contains(&name.as_ref()) {
                continue;
            }
            if let Some(hit) = walk(&path, needle)? {
                return Ok(Some(hit));
            }
        } else if file_type.is_file() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if TEXT_EXT.iter().any(|ext| name.ends_with(ext)) {
                let bytes = std::fs::read(&path)?;
                if contains_subslice(&bytes, needle) {
                    return Ok(Some(path.to_string_lossy().into_owned()));
                }
            }
        }
    }
    Ok(None)
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Scan a built extension directory for a build-time secret that leaked into
/// source. Runs in Rust so it is not bound by the frontend Tauri fs allowlist
/// (which does not cover `$HOME/AsyarExtensions`). Returns the offending file
/// path, or `None` when no file contains the secret.
#[tauri::command]
pub fn scan_extension_for_secret(path: String, secret: String) -> Result<Option<String>, AppError> {
    Ok(scan_dir_for_secret(Path::new(&path), &secret)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("asyar-secret-scan-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, rel: &str, content: &str) {
        let full = dir.join(rel);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, content).unwrap();
    }

    #[test]
    fn returns_none_when_secret_absent() {
        let dir = temp_dir("absent");
        write(
            &dir,
            "src/worker.ts",
            "const url = \"https://api.notion.com\";",
        );
        write(&dir, "manifest.json", "{\"name\":\"x\"}");
        assert_eq!(scan_dir_for_secret(&dir, "secret-ABC-123").unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn returns_offending_path_when_secret_present() {
        let dir = temp_dir("present");
        write(&dir, "src/worker.ts", "ok");
        write(&dir, "src/config.ts", "KEY=\"secret-ABC-123\"");
        let hit = scan_dir_for_secret(&dir, "secret-ABC-123").unwrap();
        assert_eq!(
            hit,
            Some(dir.join("src/config.ts").to_string_lossy().into_owned())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_node_modules_dist_and_git() {
        let dir = temp_dir("skip");
        write(&dir, "node_modules/leak.js", "secret-ABC-123");
        write(&dir, "dist/leak.js", "secret-ABC-123");
        write(&dir, ".git/leak.js", "secret-ABC-123");
        assert_eq!(scan_dir_for_secret(&dir, "secret-ABC-123").unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_non_text_files() {
        let dir = temp_dir("nontext");
        write(&dir, "icon.png", "secret-ABC-123");
        assert_eq!(scan_dir_for_secret(&dir, "secret-ABC-123").unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_or_whitespace_secret_scans_nothing() {
        let dir = temp_dir("empty");
        write(&dir, "src/config.ts", "anything");
        assert_eq!(scan_dir_for_secret(&dir, "").unwrap(), None);
        assert_eq!(scan_dir_for_secret(&dir, "   ").unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_base_dir_yields_none() {
        let missing = std::env::temp_dir().join("asyar-secret-scan-missing-xyz");
        let _ = std::fs::remove_dir_all(&missing);
        assert_eq!(
            scan_dir_for_secret(&missing, "secret-ABC-123").unwrap(),
            None
        );
    }

    #[test]
    fn trims_secret_before_matching() {
        let dir = temp_dir("trim");
        write(&dir, "src/config.ts", "KEY=secret-ABC-123;");
        assert_eq!(
            scan_dir_for_secret(&dir, "  secret-ABC-123  ").unwrap(),
            Some(dir.join("src/config.ts").to_string_lossy().into_owned())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
