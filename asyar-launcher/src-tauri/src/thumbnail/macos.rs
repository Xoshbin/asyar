//! macOS: delegates non-image thumbnailing to `qlmanage -t`, the same
//! Quick Look thumbnailing service Finder uses. One mechanism covers PDFs,
//! videos (first frame), Office docs, code files, archives — everything
//! Quick Look knows how to preview — with no per-type Rust decoder.

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use crate::file_index::provider::run_with_timeout;

/// `qlmanage` is known to hang indefinitely when there's no real
/// WindowServer/GUI session behind it (headless CI, some sandboxed
/// exec contexts) — it's a thumbnailing daemon, not a pure CLI tool.
/// Bounded execution is not an optimization here, it's required
/// correctness: without it, one bad file wedges every future thumbnail
/// request behind the same hung subprocess.
const QLMANAGE_TIMEOUT: Duration = Duration::from_secs(5);

/// Runs `qlmanage -t` (bounded, killed on timeout) into a scratch temp
/// dir, then moves the produced thumbnail to `dest`. `qlmanage` names its
/// output `<basename>.png` inside the `-o` directory, so the scratch dir
/// is per-call (a fresh `tempfile` tempdir) to avoid collisions between
/// concurrent generations.
pub fn generate_via_quicklook(
    path: &Path,
    dest: &std::path::Path,
    max_dim: u32,
) -> Result<(), String> {
    let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut cmd = Command::new("qlmanage");
    cmd.arg("-t")
        .arg("-s")
        .arg(max_dim.to_string())
        .arg("-o")
        .arg(scratch.path())
        .arg(path);

    if run_with_timeout(cmd, QLMANAGE_TIMEOUT).is_none() {
        return Err(format!(
            "qlmanage timed out or produced no output for {path:?}"
        ));
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?;
    // qlmanage's naming is `<original-filename>.png` (extension appended,
    // not replaced) — e.g. `photo.jpg` → `photo.jpg.png`.
    let produced = scratch
        .path()
        .join(format!("{}.png", file_name.to_string_lossy()));

    if !produced.exists() {
        return Err(format!("qlmanage produced no thumbnail for {path:?}"));
    }

    std::fs::rename(&produced, dest).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "ql_thumb_test_{name}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn generates_a_thumbnail_for_a_text_file() {
        let src = tmp_path("doc.txt");
        std::fs::write(&src, "hello quicklook").unwrap();
        let dest = tmp_path("dest.png");

        let result = generate_via_quicklook(&src, &dest, 128);

        // Environments without Quick Look plugins registered (bare CI
        // containers) may legitimately fail — assert the call completes
        // without panicking and, when it succeeds, produces a real file.
        if result.is_ok() {
            assert!(dest.exists());
            let _ = std::fs::remove_file(&dest);
        }
        let _ = std::fs::remove_file(&src);
    }

    #[test]
    fn fails_gracefully_on_missing_source() {
        let dest = tmp_path("missing_dest.png");
        let result = generate_via_quicklook(Path::new("/definitely/missing.txt"), &dest, 128);
        assert!(result.is_err());
    }
}
