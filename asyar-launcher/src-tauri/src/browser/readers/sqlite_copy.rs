use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use tempfile::TempDir;

const SNAPSHOT_TTL: Duration = Duration::from_secs(45);

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileFingerprint {
    modified: SystemTime,
    len: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SnapshotFingerprint {
    database: FileFingerprint,
    wal: Option<FileFingerprint>,
    shm: Option<FileFingerprint>,
}

struct Snapshot {
    _dir: TempDir,
    path: PathBuf,
}

struct CacheEntry {
    fingerprint: SnapshotFingerprint,
    created_at: Instant,
    snapshot: Arc<Snapshot>,
}

#[derive(Default)]
struct SnapshotCache {
    entries: Mutex<HashMap<PathBuf, CacheEntry>>,
    copy_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

fn snapshot_cache() -> &'static SnapshotCache {
    static CACHE: OnceLock<SnapshotCache> = OnceLock::new();
    CACHE.get_or_init(SnapshotCache::default)
}

pub struct CopiedSqlite {
    snapshot: Arc<Snapshot>,
}

impl CopiedSqlite {
    pub fn path(&self) -> &Path {
        &self.snapshot.path
    }
}

pub fn copy_for_read(src: &Path) -> Result<CopiedSqlite, String> {
    if !src.exists() {
        return Err(format!("source does not exist: {}", src.display()));
    }
    let cache = snapshot_cache();
    let copy_lock = {
        let mut locks = cache.copy_locks.lock().map_err(|e| e.to_string())?;
        locks
            .entry(src.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _copy_guard = copy_lock.lock().map_err(|e| e.to_string())?;
    let fingerprint = snapshot_fingerprint(src)?;

    if let Some(snapshot) = {
        let entries = cache.entries.lock().map_err(|e| e.to_string())?;
        entries.get(src).and_then(|entry| {
            (entry.fingerprint == fingerprint && entry.created_at.elapsed() < SNAPSHOT_TTL)
                .then(|| entry.snapshot.clone())
        })
    } {
        return Ok(CopiedSqlite { snapshot });
    }

    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let file_name = src
        .file_name()
        .ok_or_else(|| "source has no file name".to_string())?;
    let dest = dir.path().join(file_name);
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;

    // Copy -wal and -shm sidecars if they exist.
    for ext in ["-wal", "-shm"] {
        let sidecar_src = sidecar_path(src, ext);
        if sidecar_src.exists() {
            let sidecar_dest = dir
                .path()
                .join(format!("{}{}", file_name.to_string_lossy(), ext));
            std::fs::copy(&sidecar_src, &sidecar_dest).map_err(|e| e.to_string())?;
        }
    }

    let snapshot = Arc::new(Snapshot {
        _dir: dir,
        path: dest,
    });
    cache.entries.lock().map_err(|e| e.to_string())?.insert(
        src.to_path_buf(),
        CacheEntry {
            fingerprint,
            created_at: Instant::now(),
            snapshot: snapshot.clone(),
        },
    );
    Ok(CopiedSqlite { snapshot })
}

fn sidecar_path(src: &Path, suffix: &str) -> PathBuf {
    let mut value: OsString = src.as_os_str().to_owned();
    value.push(suffix);
    PathBuf::from(value)
}

fn file_fingerprint(path: &Path) -> Result<FileFingerprint, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(FileFingerprint {
        modified: metadata.modified().map_err(|e| e.to_string())?,
        len: metadata.len(),
    })
}

fn optional_fingerprint(path: &Path) -> Result<Option<FileFingerprint>, String> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(Some(FileFingerprint {
            modified: metadata.modified().map_err(|e| e.to_string())?,
            len: metadata.len(),
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn snapshot_fingerprint(src: &Path) -> Result<SnapshotFingerprint, String> {
    Ok(SnapshotFingerprint {
        database: file_fingerprint(src)?,
        wal: optional_fingerprint(&sidecar_path(src, "-wal"))?,
        shm: optional_fingerprint(&sidecar_path(src, "-shm"))?,
    })
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
        assert!(
            sidecar.exists() || wal_copy.exists(),
            "wal sidecar not copied"
        );
    }

    #[test]
    fn reuses_snapshot_while_source_fingerprint_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("cached.sqlite");
        std::fs::write(&src, b"DB").unwrap();

        let first = copy_for_read(&src).unwrap();
        let second = copy_for_read(&src).unwrap();

        assert_eq!(first.path(), second.path());
    }

    #[test]
    fn invalidates_snapshot_when_wal_size_changes() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("changing.sqlite");
        let wal = dir.path().join("changing.sqlite-wal");
        std::fs::write(&src, b"DB").unwrap();
        std::fs::write(&wal, b"WAL").unwrap();

        let first = copy_for_read(&src).unwrap();
        std::fs::write(&wal, b"WAL-expanded").unwrap();
        let second = copy_for_read(&src).unwrap();

        assert_ne!(first.path(), second.path());
        assert_eq!(
            std::fs::read(second.path().parent().unwrap().join("changing.sqlite-wal")).unwrap(),
            b"WAL-expanded"
        );
    }
}
