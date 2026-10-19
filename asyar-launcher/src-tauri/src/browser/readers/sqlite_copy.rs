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

struct SnapshotCache {
    entries: Mutex<HashMap<PathBuf, CacheEntry>>,
    copy_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    /// How long a snapshot may be served — and kept on disk. Injectable so the
    /// expiry tests don't have to sleep for the production TTL.
    ttl: Duration,
}

impl SnapshotCache {
    fn new(ttl: Duration) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            copy_locks: Mutex::new(HashMap::new()),
            ttl,
        }
    }

    /// Drop every entry past its TTL, then prune the locks left behind.
    ///
    /// A snapshot is a full plaintext copy of the user's browsing history in
    /// the OS temp directory, so the TTL is a retention bound and not merely a
    /// freshness hint. The cache used to replace an entry only on the next read
    /// of the *same* path, which meant a database that is never read again —
    /// the browser the user stopped searching — kept its copy for the lifetime
    /// of an always-resident process. Sweeping on every read bounds that.
    ///
    /// Dropping the entry releases the cache's `Arc<Snapshot>`; the `TempDir`
    /// (and the files in it) go away when the LAST reference does, so a reader
    /// still holding a `CopiedSqlite` keeps reading safely and the delete
    /// happens when it finishes.
    fn evict_expired(&self) -> Result<(), String> {
        let ttl = self.ttl;
        let mut entries = self.entries.lock().map_err(|e| e.to_string())?;
        entries.retain(|_, entry| entry.created_at.elapsed() < ttl);
        // `copy_locks` is keyed by database path and was insert-only. Keep a
        // lock only while it still guards something: an entry in the cache, or
        // a copy in flight (strong_count > 1 means another caller holds it, so
        // dropping our map reference could hand a second caller a *different*
        // mutex and let two copies of one path race).
        let mut locks = self.copy_locks.lock().map_err(|e| e.to_string())?;
        locks.retain(|path, lock| entries.contains_key(path) || Arc::strong_count(lock) > 1);
        Ok(())
    }

    #[cfg(test)]
    fn entry_count(&self) -> Result<usize, String> {
        Ok(self.entries.lock().map_err(|e| e.to_string())?.len())
    }

    #[cfg(test)]
    fn copy_lock_count(&self) -> Result<usize, String> {
        Ok(self.copy_locks.lock().map_err(|e| e.to_string())?.len())
    }
}

fn snapshot_cache() -> &'static SnapshotCache {
    static CACHE: OnceLock<SnapshotCache> = OnceLock::new();
    CACHE.get_or_init(|| SnapshotCache::new(SNAPSHOT_TTL))
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
    copy_for_read_in(snapshot_cache(), src)
}

fn copy_for_read_in(cache: &SnapshotCache, src: &Path) -> Result<CopiedSqlite, String> {
    if !src.exists() {
        return Err(format!("source does not exist: {}", src.display()));
    }
    // Sweep before anything else: any read is an opportunity to delete every
    // OTHER path's expired plaintext copy, which is the only thing that ever
    // will for a database the user has stopped searching.
    cache.evict_expired()?;
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
            (entry.fingerprint == fingerprint && entry.created_at.elapsed() < cache.ttl)
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

    // ---- expiry eviction (privacy) ----
    //
    // A snapshot is a full plaintext copy of the user's browsing history in the
    // OS temp directory. Before the snapshot cache existed it was deleted as
    // soon as the read finished; the cache replaced an entry only on the next
    // read of the SAME path, so a path that is never read again kept its copy
    // alive for the process lifetime — and the launcher is always resident.

    fn short_ttl_cache() -> SnapshotCache {
        SnapshotCache::new(Duration::from_millis(1))
    }

    /// The directory a snapshot's files live in — `TempDir` deletes it on drop.
    fn snapshot_dir_of(copied: &CopiedSqlite) -> PathBuf {
        copied
            .path()
            .parent()
            .expect("snapshot has a parent")
            .to_path_buf()
    }

    #[test]
    fn evicting_an_expired_snapshot_deletes_its_plaintext_copy() {
        let cache = short_ttl_cache();
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("History");
        std::fs::write(&src, b"PLAINTEXT-BROWSING-HISTORY").unwrap();

        let copied = copy_for_read_in(&cache, &src).unwrap();
        let snapshot_dir = snapshot_dir_of(&copied);
        assert!(snapshot_dir.exists(), "snapshot should exist while in use");
        drop(copied); // reader finished; only the cache still references it

        std::thread::sleep(Duration::from_millis(10));
        cache.evict_expired().unwrap();

        assert_eq!(
            cache.entry_count().unwrap(),
            0,
            "expired entry must be dropped"
        );
        assert!(
            !snapshot_dir.exists(),
            "expired snapshot directory must be deleted from the temp dir"
        );
    }

    #[test]
    fn a_fresh_snapshot_survives_a_sweep() {
        let cache = SnapshotCache::new(Duration::from_secs(600));
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("History");
        std::fs::write(&src, b"DB").unwrap();

        let copied = copy_for_read_in(&cache, &src).unwrap();
        let snapshot_dir = snapshot_dir_of(&copied);
        drop(copied);

        cache.evict_expired().unwrap();

        assert_eq!(cache.entry_count().unwrap(), 1);
        assert!(snapshot_dir.exists());
    }

    #[test]
    fn reading_one_database_sweeps_an_unrelated_paths_expired_snapshot() {
        // The real leak: the user searches, then stops. Nothing ever reads that
        // browser's database again, so no replacement is triggered. Any read
        // must sweep every path, not just its own.
        let cache = short_ttl_cache();
        let dir = tempfile::tempdir().unwrap();
        let abandoned = dir.path().join("Abandoned");
        let other = dir.path().join("Other");
        std::fs::write(&abandoned, b"DB-A").unwrap();
        std::fs::write(&other, b"DB-B").unwrap();

        let first = copy_for_read_in(&cache, &abandoned).unwrap();
        let abandoned_dir = snapshot_dir_of(&first);
        drop(first);

        std::thread::sleep(Duration::from_millis(10));
        let _second = copy_for_read_in(&cache, &other).unwrap();

        assert!(
            !abandoned_dir.exists(),
            "a read of another database must evict the abandoned snapshot"
        );
    }

    #[test]
    fn an_expired_snapshot_is_never_served() {
        let cache = short_ttl_cache();
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("History");
        std::fs::write(&src, b"DB").unwrap();

        let first = copy_for_read_in(&cache, &src).unwrap();
        let first_path = first.path().to_path_buf();
        drop(first);
        std::thread::sleep(Duration::from_millis(10));
        let second = copy_for_read_in(&cache, &src).unwrap();

        assert_ne!(
            first_path,
            second.path(),
            "an expired snapshot must be re-copied, not re-served"
        );
    }

    #[test]
    fn an_in_use_snapshot_outlives_its_eviction() {
        // Eviction drops the cache's `Arc`; a live reader holds another, so the
        // directory must survive until that reader is done.
        let cache = short_ttl_cache();
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("History");
        std::fs::write(&src, b"DB").unwrap();

        let in_use = copy_for_read_in(&cache, &src).unwrap();
        let snapshot_dir = snapshot_dir_of(&in_use);
        std::thread::sleep(Duration::from_millis(10));
        cache.evict_expired().unwrap();

        assert!(
            snapshot_dir.exists(),
            "an evicted snapshot must stay readable while a reader holds it"
        );
        assert_eq!(std::fs::read(in_use.path()).unwrap(), b"DB");
        drop(in_use);
        assert!(
            !snapshot_dir.exists(),
            "deleted once the last reader drops it"
        );
    }

    #[test]
    fn copy_locks_do_not_accumulate_for_evicted_paths() {
        // One lock per distinct database path, inserted and never removed, is
        // an unbounded map keyed by caller-influenced paths.
        let cache = short_ttl_cache();
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            let src = dir.path().join(format!("History-{i}"));
            std::fs::write(&src, b"DB").unwrap();
            let _ = copy_for_read_in(&cache, &src).unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }

        assert!(
            cache.copy_lock_count().unwrap() <= 2,
            "expected locks for evicted paths to be pruned, got {}",
            cache.copy_lock_count().unwrap()
        );
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
