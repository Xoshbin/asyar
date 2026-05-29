use std::path::{Path, PathBuf};
use tempfile::TempDir;

pub struct CopiedSqlite {
    _dir: TempDir,
    path: PathBuf,
}

impl CopiedSqlite {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

pub fn copy_for_read(src: &Path) -> Result<CopiedSqlite, String> {
    if !src.exists() {
        return Err(format!("source does not exist: {}", src.display()));
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let file_name = src
        .file_name()
        .ok_or_else(|| "source has no file name".to_string())?;
    let dest = dir.path().join(file_name);
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;

    // Copy -wal and -shm sidecars if they exist.
    let src_str = src.to_str().ok_or_else(|| "non-utf8 source path".to_string())?;
    for ext in ["-wal", "-shm"] {
        let sidecar_src = PathBuf::from(format!("{}{}", src_str, ext));
        if sidecar_src.exists() {
            let sidecar_dest = dir.path().join(format!(
                "{}{}",
                file_name.to_string_lossy(),
                ext
            ));
            std::fs::copy(&sidecar_src, &sidecar_dest).map_err(|e| e.to_string())?;
        }
    }

    Ok(CopiedSqlite { _dir: dir, path: dest })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_returns_a_readable_path() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("orig.sqlite");
        std::fs::write(&src, b"FAKEDB").unwrap();
        let copied = copy_for_read(&src).unwrap();
        let contents = std::fs::read(copied.path()).unwrap();
        assert_eq!(contents, b"FAKEDB");
    }

    #[test]
    fn missing_source_errors() {
        let result = copy_for_read(std::path::Path::new("/no/such/db"));
        assert!(result.is_err());
    }

    #[test]
    fn copies_wal_sidecar_if_present() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("orig.sqlite");
        let wal = dir.path().join("orig.sqlite-wal");
        std::fs::write(&src, b"DB").unwrap();
        std::fs::write(&wal, b"WAL").unwrap();
        let copied = copy_for_read(&src).unwrap();
        let wal_copy = copied.path().with_extension("sqlite-wal");
        // Sidecar exists at the copied location next to the main file.
        let sidecar_path = copied.path().to_path_buf();
        let parent = sidecar_path.parent().unwrap();
        let file_name = sidecar_path.file_name().unwrap().to_str().unwrap();
        let sidecar = parent.join(format!("{}-wal", file_name));
        assert!(sidecar.exists() || wal_copy.exists(), "wal sidecar not copied");
    }
}
