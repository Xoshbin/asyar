use super::{extract_json_secret, SecretError};
use crate::files_scope::{secret_source_deny_roots, starts_with_case_aware};
use std::{
    io::Read,
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

pub fn validate_json_file_path(path: &str) -> Result<(), SecretError> {
    let rel = path.strip_prefix("~/").ok_or(SecretError::SourceDenied)?;
    if rel.contains(['*', '?', '[', ']', '{', '}', '\\', ':'])
        || rel.contains("..")
        || !rel.ends_with(".json")
        || rel.split('/').any(|c| c.is_empty() || c == ".")
    {
        return Err(SecretError::SourceDenied);
    }
    if !(rel.split('/').next().is_some_and(|c| c.starts_with('.'))
        || rel.starts_with("Library/Application Support/"))
    {
        return Err(SecretError::SourceDenied);
    }
    Ok(())
}
pub fn read_json_file_secret(
    path: &str,
    pointer: &str,
    home: &Path,
    extra: &[PathBuf],
) -> Result<Zeroizing<String>, SecretError> {
    validate_json_file_path(path)?;
    let home = dunce::canonicalize(home).map_err(|_| SecretError::SourceDenied)?;
    let canonical =
        dunce::canonicalize(home.join(&path[2..])).map_err(|_| SecretError::SourceUnavailable)?;
    if !starts_with_case_aware(&canonical, &home) {
        return Err(SecretError::SourceDenied);
    }
    let rel = canonical
        .strip_prefix(&home)
        .map_err(|_| SecretError::SourceDenied)?;
    validate_json_file_path(&format!("~/{}", rel.to_string_lossy().replace('\\', "/")))?;
    for root in secret_source_deny_roots(&home).iter().chain(extra) {
        if starts_with_case_aware(&canonical, root)
            || dunce::canonicalize(root)
                .ok()
                .is_some_and(|r| starts_with_case_aware(&canonical, &r))
        {
            return Err(SecretError::SourceDenied);
        }
    }
    let meta = std::fs::metadata(&canonical).map_err(|_| SecretError::SourceUnavailable)?;
    if !meta.is_file() || meta.len() > 1024 * 1024 {
        return Err(SecretError::SourceDenied);
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Reject a replaced leaf symlink or FIFO without blocking the worker pool.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options
        .open(&canonical)
        .map_err(|_| SecretError::SourceUnavailable)?;
    let meta = file
        .metadata()
        .map_err(|_| SecretError::SourceUnavailable)?;
    if !meta.is_file() || meta.len() > 1024 * 1024 {
        return Err(SecretError::SourceDenied);
    }
    let mut bytes = Zeroizing::new(Vec::new());
    (&mut file)
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| SecretError::SourceUnavailable)?;
    if bytes.len() > 1024 * 1024 {
        return Err(SecretError::SourceDenied);
    }
    extract_json_secret(&bytes, pointer)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn named_pipe_is_rejected_without_waiting_for_a_writer() {
        use std::os::unix::fs::OpenOptionsExt;
        let (_t, h) = setup();
        let path = h.join(".cli/pipe.json");
        let cpath = std::ffi::CString::new(path.to_str().unwrap()).unwrap();
        // SAFETY: cpath is a live NUL-terminated path; mkfifo does not retain it.
        assert_eq!(unsafe { libc::mkfifo(cpath.as_ptr(), 0o600) }, 0);
        let writer = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .custom_flags(libc::O_NONBLOCK)
                .open(path);
        });
        let start = std::time::Instant::now();
        let result = read_json_file_secret("~/.cli/pipe.json", "", &h, &[]);
        let elapsed = start.elapsed();
        writer.join().unwrap();
        assert!(result.is_err());
        assert!(
            elapsed < std::time::Duration::from_millis(100),
            "{elapsed:?}"
        );
    }
    #[test]
    fn rejects_non_tilde_glob_dotdot_and_non_json_paths() {
        for p in [
            "/tmp/a.json",
            "~/a/*.json",
            "~/.cli/../a.json",
            "~/.cli/a.txt",
            "~/.cli/a?.json",
            "~/.cli/a\\b.json",
        ] {
            assert!(validate_json_file_path(p).is_err(), "{p}");
        }
    }
    #[test]
    fn rejects_path_outside_allowed_shapes() {
        for p in [
            "~/Documents/a.json",
            "~/Downloads/a.json",
            "~/Library/a.json",
        ] {
            assert!(validate_json_file_path(p).is_err());
        }
        for p in [
            "~/.cli/a.json",
            "~/.config/cli/a.json",
            "~/Library/Application Support/cli/a.json",
        ] {
            assert!(validate_json_file_path(p).is_ok());
        }
    }
    fn setup() -> (tempfile::TempDir, std::path::PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let h = dunce::canonicalize(t.path()).unwrap();
        std::fs::create_dir(h.join(".cli")).unwrap();
        (t, h)
    }
    #[test]
    fn reads_string_at_pointer() {
        let (_t, h) = setup();
        std::fs::write(h.join(".cli/a.json"), r#"{"token":"abcdefgh"}"#).unwrap();
        assert_eq!(
            &*read_json_file_secret("~/.cli/a.json", "/token", &h, &[]).unwrap(),
            "abcdefgh"
        );
    }
    #[test]
    fn non_string_pointer_target_fails_without_echoing_value() {
        let (_t, h) = setup();
        std::fs::write(
            h.join(".cli/a.json"),
            r#"{"token":{"secret":"NEVER-ECHO"}}"#,
        )
        .unwrap();
        let e = read_json_file_secret("~/.cli/a.json", "/token", &h, &[]).unwrap_err();
        assert!(!e.to_string().contains("NEVER-ECHO"));
    }
    #[test]
    fn rejects_ssh_aws_gnupg_keychains_and_app_data() {
        let (_t, h) = setup();
        for p in [
            ".ssh/a.json",
            ".aws/a.json",
            ".gnupg/a.json",
            "Library/Keychains/a.json",
            ".app/a.json",
        ] {
            std::fs::create_dir_all(h.join(p).parent().unwrap()).unwrap();
            std::fs::write(h.join(p), r#"{"token":"abcdefgh"}"#).unwrap();
            assert!(
                read_json_file_secret(&format!("~/{p}"), "/token", &h, &[h.join(".app")]).is_err()
            );
        }
    }
    #[cfg(unix)]
    #[test]
    fn symlink_into_denied_root_is_rejected_after_canonicalize() {
        let (_t, h) = setup();
        std::fs::create_dir(h.join(".ssh")).unwrap();
        std::fs::write(h.join(".ssh/a.json"), r#"{"token":"abcdefgh"}"#).unwrap();
        std::os::unix::fs::symlink(h.join(".ssh/a.json"), h.join(".cli/a.json")).unwrap();
        assert!(read_json_file_secret("~/.cli/a.json", "/token", &h, &[]).is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn case_variant_of_denied_root_rejected_on_macos() {
        let (_t, h) = setup();
        std::fs::create_dir(h.join(".SSH")).unwrap();
        std::fs::write(h.join(".SSH/a.json"), "{}").unwrap();
        assert!(read_json_file_secret("~/.SSH/a.json", "", &h, &[]).is_err());
    }
    #[test]
    fn oversize_and_non_regular_file_rejected() {
        let (_t, h) = setup();
        std::fs::write(h.join(".cli/a.json"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
        assert!(read_json_file_secret("~/.cli/a.json", "", &h, &[]).is_err());
        std::fs::create_dir(h.join(".cli/dir.json")).unwrap();
        assert!(read_json_file_secret("~/.cli/dir.json", "", &h, &[]).is_err());
    }
}
