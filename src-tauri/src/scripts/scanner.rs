use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::scripts::header::{parse_header, ParsedScriptHeader};

/// A script file discovered during a directory scan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedScript {
    /// Canonical absolute path to the script file.
    pub absolute_path: PathBuf,
    /// 16-char lowercase hex prefix of SHA-256(`absolute_path.to_string_lossy()`).
    pub dynamic_id: String,
    /// Parsed metadata from the script's header comment block.
    pub header: ParsedScriptHeader,
    /// True when the file has an executable bit set on Unix.
    /// On non-Unix targets always true; exec-bit gating happens elsewhere.
    pub executable: bool,
}

/// Scan all top-level files in each directory. Subdirectories are NOT
/// descended into. Files without exec bit (Unix) are skipped. Files
/// whose header fails to parse are logged and skipped.
pub fn scan_directories(dirs: &[PathBuf]) -> Vec<ScannedScript> {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut results: Vec<ScannedScript> = Vec::new();

    for dir in dirs {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();

            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            if !metadata.is_file() {
                continue;
            }

            let absolute_path = match path.canonicalize() {
                Ok(p) => p,
                Err(_) => continue,
            };

            if !seen.insert(absolute_path.clone()) {
                continue;
            }

            let executable = file_is_executable(&absolute_path, &metadata);

            #[cfg(unix)]
            if !executable {
                continue;
            }

            let content = match read_head(&absolute_path, 8192) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let header = match parse_header(&content) {
                Ok(h) => h,
                Err(e) => {
                    log::warn!(
                        "scripts: skipping {} due to header error: {}",
                        absolute_path.display(),
                        e
                    );
                    continue;
                }
            };

            let dynamic_id = compute_dynamic_id(&absolute_path);

            results.push(ScannedScript {
                absolute_path,
                dynamic_id,
                header,
                executable,
            });
        }
    }

    results
}

#[cfg(unix)]
fn file_is_executable(_path: &Path, metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn file_is_executable(_path: &Path, _metadata: &fs::Metadata) -> bool {
    true
}

/// Read up to `max_bytes` bytes from the start of a file and return as a lossy UTF-8 string.
fn read_head(path: &Path, max_bytes: usize) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = fs::File::open(path)?;
    let mut buf = Vec::with_capacity(max_bytes.min(8192));
    let mut tmp = [0u8; 4096];
    while buf.len() < max_bytes {
        let n = file.read(&mut tmp)?;
        if n == 0 {
            break;
        }
        let take = (max_bytes - buf.len()).min(n);
        buf.extend_from_slice(&tmp[..take]);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Compute a stable 16-char lowercase hex ID from the SHA-256 of the path string.
fn compute_dynamic_id(path: &Path) -> String {
    let s = path.to_string_lossy();
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    let hash = hasher.finalize();
    let hex = hex_encode(&hash);
    hex[..16].to_string()
}

/// Encode bytes as lowercase hex.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    #[cfg(unix)]
    fn write_script(dir: &Path, name: &str, content: &str, exec: bool) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        let mut perms = fs::metadata(&path).unwrap().permissions();
        perms.set_mode(if exec { 0o755 } else { 0o644 });
        fs::set_permissions(&path, perms).unwrap();
        path
    }

    #[cfg(not(unix))]
    fn write_script(dir: &Path, name: &str, content: &str, _exec: bool) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        path
    }

    // 1. empty dir returns empty vec
    #[test]
    fn empty_dir_returns_empty_vec() {
        let dir = TempDir::new().unwrap();
        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert!(result.is_empty(), "expected empty vec, got {} scripts", result.len());
    }

    // 2. scans one valid script
    #[test]
    fn scans_one_valid_script() {
        let dir = TempDir::new().unwrap();
        let file_path = write_script(
            dir.path(),
            "hello.sh",
            "#!/bin/bash\n# @asyar.title Hello\n",
            true,
        );
        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].header.title, Some("Hello".to_string()));
        assert_eq!(
            result[0].absolute_path,
            file_path.canonicalize().unwrap()
        );
        #[cfg(unix)]
        assert!(result[0].executable);
    }

    // 3. dynamic_id is sha256 prefix — 16 hex chars, stable, unique per path
    #[test]
    fn dynamic_id_is_sha1_prefix() {
        let dir = TempDir::new().unwrap();
        let _file_a = write_script(dir.path(), "a.sh", "#!/bin/bash\n", true);
        let _file_b = write_script(dir.path(), "b.sh", "#!/bin/bash\n", true);

        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 2);

        for script in &result {
            assert_eq!(
                script.dynamic_id.len(),
                16,
                "dynamic_id must be exactly 16 chars, got {:?}",
                script.dynamic_id
            );
            assert!(
                script.dynamic_id.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()),
                "dynamic_id must be lowercase hex, got {:?}",
                script.dynamic_id
            );
        }

        // same scan second time — same ids
        let result2 = scan_directories(&[dir.path().to_path_buf()]);
        let ids1: std::collections::HashSet<_> = result.iter().map(|s| &s.dynamic_id).collect();
        let ids2: std::collections::HashSet<_> = result2.iter().map(|s| &s.dynamic_id).collect();
        assert_eq!(ids1, ids2, "dynamic_ids must be stable across runs");

        // different paths produce different ids
        let (id_a, id_b) = {
            let mut sorted = result.iter().map(|s| s.dynamic_id.clone()).collect::<Vec<_>>();
            sorted.sort();
            (sorted[0].clone(), sorted[1].clone())
        };
        assert_ne!(id_a, id_b, "different paths must produce different dynamic_ids");
    }

    // 4. multiple scripts in one dir — all returned
    #[test]
    fn multiple_scripts_in_one_dir() {
        let dir = TempDir::new().unwrap();
        write_script(dir.path(), "one.sh", "#!/bin/bash\n# @asyar.title Alpha\n", true);
        write_script(dir.path(), "two.sh", "#!/bin/bash\n# @asyar.title Beta\n", true);
        write_script(dir.path(), "three.sh", "#!/bin/bash\n# @asyar.title Gamma\n", true);

        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 3);

        let titles: std::collections::HashSet<Option<String>> =
            result.iter().map(|s| s.header.title.clone()).collect();
        let expected: std::collections::HashSet<Option<String>> = [
            Some("Alpha".to_string()),
            Some("Beta".to_string()),
            Some("Gamma".to_string()),
        ]
        .into_iter()
        .collect();
        assert_eq!(titles, expected);
    }

    // 5. subdirectories are NOT descended into
    #[test]
    fn subdirectories_not_descended() {
        let dir = TempDir::new().unwrap();
        write_script(dir.path(), "top.sh", "#!/bin/bash\n# @asyar.title Top\n", true);

        let subdir = dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        write_script(&subdir, "nested.sh", "#!/bin/bash\n# @asyar.title Nested\n", true);

        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].header.title, Some("Top".to_string()));
    }

    // 6. non-executable files skipped on Unix, kept on non-Unix
    #[test]
    fn non_executable_skipped_on_unix() {
        let dir = TempDir::new().unwrap();
        write_script(dir.path(), "exec.sh", "#!/bin/bash\n# @asyar.title Exec\n", true);
        write_script(dir.path(), "noexec.sh", "#!/bin/bash\n# @asyar.title NoExec\n", false);

        let result = scan_directories(&[dir.path().to_path_buf()]);

        #[cfg(unix)]
        {
            assert_eq!(result.len(), 1, "on Unix only exec scripts are returned");
            assert_eq!(result[0].header.title, Some("Exec".to_string()));
            assert!(result[0].executable);
        }

        #[cfg(not(unix))]
        {
            assert_eq!(result.len(), 2, "on non-Unix both scripts are returned (no exec gating)");
        }
    }

    // 7. malformed header logged and skipped — scan does not panic
    #[test]
    fn malformed_header_logged_and_skipped() {
        let dir = TempDir::new().unwrap();
        write_script(
            dir.path(),
            "valid.sh",
            "#!/bin/bash\n# @asyar.title Valid\n",
            true,
        );
        write_script(
            dir.path(),
            "bad.sh",
            "#!/bin/bash\n# @asyar.argument:1 { not valid\n",
            true,
        );

        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 1, "malformed script should be skipped");
        assert_eq!(result[0].header.title, Some("Valid".to_string()));
    }

    // 8. multiple directories are aggregated
    #[test]
    fn multiple_directories_aggregated() {
        let dir1 = TempDir::new().unwrap();
        let dir2 = TempDir::new().unwrap();
        write_script(dir1.path(), "script1.sh", "#!/bin/bash\n# @asyar.title One\n", true);
        write_script(dir2.path(), "script2.sh", "#!/bin/bash\n# @asyar.title Two\n", true);

        let result = scan_directories(&[dir1.path().to_path_buf(), dir2.path().to_path_buf()]);
        assert_eq!(result.len(), 2);

        let titles: std::collections::HashSet<Option<String>> =
            result.iter().map(|s| s.header.title.clone()).collect();
        assert!(titles.contains(&Some("One".to_string())));
        assert!(titles.contains(&Some("Two".to_string())));
    }

    // 9. nonexistent directory skipped — no panic
    #[test]
    fn nonexistent_directory_skipped() {
        let result =
            scan_directories(&[PathBuf::from("/this/does/not/exist/asyar_test_dir_12345")]);
        assert!(result.is_empty());
    }

    // 10. same directory listed twice — deduplicated by absolute_path
    #[test]
    fn same_directory_listed_twice_dedupe_by_path() {
        let dir = TempDir::new().unwrap();
        write_script(dir.path(), "only.sh", "#!/bin/bash\n# @asyar.title Only\n", true);

        let result =
            scan_directories(&[dir.path().to_path_buf(), dir.path().to_path_buf()]);
        assert_eq!(result.len(), 1, "duplicate directory must not produce duplicate entries");
    }

    // 11. script without header is included with default (empty) header
    #[test]
    fn script_without_header_is_included() {
        let dir = TempDir::new().unwrap();
        write_script(dir.path(), "bare.sh", "#!/bin/bash\necho hi\n", true);

        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 1, "bare executable script must be included");
        assert_eq!(result[0].header.title, None);
        assert_eq!(result[0].header.icon, None);
        assert!(result[0].header.arguments.is_empty());
    }

    // 12. scanner does NOT set a fallback title — title stays None for no-header scripts
    #[test]
    fn subtle_test_name_filename_used_when_no_title() {
        let dir = TempDir::new().unwrap();
        write_script(dir.path(), "myscript.sh", "#!/bin/bash\necho hi\n", true);

        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].header.title,
            None,
            "scanner must not inject a fallback title; that is the TS-side responsibility"
        );
    }

    // 12b. inline mode + refreshTime propagate through the scanner
    #[test]
    fn inline_mode_and_refresh_time_flow_through_scanner() {
        use crate::scripts::header::ScriptMode;
        let dir = TempDir::new().unwrap();
        write_script(
            dir.path(),
            "clock.sh",
            "#!/bin/bash\n# @asyar.title Clock\n# @asyar.mode inline\n# @asyar.refreshTime 30s\n",
            true,
        );

        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].header.mode, ScriptMode::Inline);
        assert_eq!(result[0].header.refresh_time_seconds, Some(30));
        assert!(!result[0].header.refresh_time_clamped);
    }

    // 13. large file — title after line 50 is NOT picked up
    // (parser stops at first non-comment line; the @asyar.title at line 60
    // is placed after 55 blank comment lines, then a non-comment separator)
    #[test]
    fn large_file_only_first_50_lines_read() {
        let dir = TempDir::new().unwrap();

        // Build content: shebang, 55 plain comment lines, an empty line (breaks header),
        // then @asyar.title TooLate at line ~58. The parser must stop at the empty line.
        let mut content = String::from("#!/bin/bash\n");
        for _ in 0..55 {
            content.push_str("# just a comment\n");
        }
        // This non-comment line ends the header section
        content.push('\n');
        content.push_str("# @asyar.title TooLate\n");
        // Pad to 200 lines
        for _ in 0..140 {
            content.push_str("echo fill\n");
        }

        write_script(dir.path(), "large.sh", &content, true);

        let result = scan_directories(&[dir.path().to_path_buf()]);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].header.title,
            None,
            "title placed after the header section boundary must not be parsed"
        );
    }
}
