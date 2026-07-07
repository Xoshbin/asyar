//! Snapshot persistence — versioned bincode dump of the arena index for
//! instant cold start. Atomic write (tmp + rename); any load problem
//! (missing, corrupt, version mismatch, inconsistent arrays) returns `None`
//! and the caller falls back to a fresh scan. That fallback IS the
//! migration strategy — no compat shims.

use std::path::Path;

use super::index::{FileIndex, IndexSnapshot};

const SNAPSHOT_VERSION: u32 = 3;
pub const SNAPSHOT_FILE_NAME: &str = "file_index_snapshot.bin";

#[derive(serde::Serialize, serde::Deserialize)]
struct SnapshotPayload {
    version: u32,
    index: IndexSnapshot,
}

/// Serialize the index to `path` atomically (write tmp → rename).
pub fn save(index: &FileIndex, path: &Path) -> std::io::Result<()> {
    let payload = SnapshotPayload {
        version: SNAPSHOT_VERSION,
        index: index.to_snapshot(),
    };
    let bytes = bincode::serialize(&payload)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Load a previously saved snapshot. `None` on missing file, unreadable
/// bytes, deserialize error, version mismatch, or inconsistent payload.
pub fn load(path: &Path) -> Option<FileIndex> {
    let bytes = std::fs::read(path).ok()?;
    let payload: SnapshotPayload = bincode::deserialize(&bytes).ok()?;
    if payload.version != SNAPSHOT_VERSION {
        return None;
    }
    FileIndex::from_snapshot(payload.index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_index::index::{IndexUpdate, ScannedEntry};
    use crate::file_index::types::EntryKind;
    use std::path::PathBuf;

    const NOW: i64 = 100_000_000;

    fn tmp_path() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let pid = std::process::id();
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("asyar_fi_snapshot_test_{pid}_{n}.bin"))
    }

    fn sample_index() -> FileIndex {
        let items = vec![
            ScannedEntry {
                path: PathBuf::from("/tmp/rootA/docs"),
                kind: EntryKind::Dir,
                mtime: NOW as u32 - 86_400,
                hidden: false,
                placeholder: false,
            },
            ScannedEntry {
                path: PathBuf::from("/tmp/rootA/docs/Report.pdf"),
                kind: EntryKind::File,
                mtime: NOW as u32,
                hidden: false,
                placeholder: false,
            },
        ];
        let mut idx = FileIndex::build(vec![PathBuf::from("/tmp/rootA")], items, NOW);
        // Give it a tail entry and a tombstone so those survive too.
        idx.apply_batch(
            vec![IndexUpdate::Upserted(ScannedEntry {
                path: PathBuf::from("/tmp/rootA/tail.txt"),
                kind: EntryKind::File,
                mtime: NOW as u32,
                hidden: false,
                placeholder: false,
            })],
            NOW,
        );
        idx.apply_batch(
            vec![IndexUpdate::Removed(PathBuf::from(
                "/tmp/rootA/docs/Report.pdf",
            ))],
            NOW,
        );
        idx
    }

    #[test]
    fn round_trip_preserves_structure_and_lookups() {
        let p = tmp_path();
        let original = sample_index();
        save(&original, &p).unwrap();
        let loaded = load(&p).expect("snapshot must load");

        assert_eq!(loaded.entries_len(), original.entries_len());
        assert_eq!(loaded.sealed(), original.sealed());
        assert_eq!(loaded.roots_len(), original.roots_len());
        assert_eq!(loaded.generation(), original.generation());
        assert_eq!(loaded.live_count(), original.live_count());

        // Lookups must be rebuilt and functional for sealed AND tail entries.
        let tail = loaded
            .lookup_path(Path::new("/tmp/rootA/tail.txt"))
            .expect("tail entry resolves after load");
        assert_eq!(loaded.materialize_path(tail), "/tmp/rootA/tail.txt");

        let report = loaded
            .lookup_path(Path::new("/tmp/rootA/docs/Report.pdf"))
            .expect("sealed entry resolves after load");
        assert!(
            loaded.is_tombstoned(report),
            "tombstone survives round-trip"
        );

        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn load_missing_returns_none() {
        assert!(load(Path::new("/definitely/does/not/exist.bin")).is_none());
    }

    #[test]
    fn load_corrupted_returns_none() {
        let p = tmp_path();
        std::fs::write(&p, b"not valid bincode at all").unwrap();
        assert!(load(&p).is_none());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn load_version_mismatch_returns_none() {
        let p = tmp_path();
        save(&sample_index(), &p).unwrap();
        // bincode lays the u32 version out in the first 4 bytes; stamp an
        // old version over it.
        let mut bytes = std::fs::read(&p).unwrap();
        bytes[..4].copy_from_slice(&99u32.to_le_bytes());
        std::fs::write(&p, &bytes).unwrap();
        assert!(load(&p).is_none());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn load_inconsistent_arrays_returns_none() {
        let p = tmp_path();
        let idx = sample_index();
        let mut snap = idx.to_snapshot();
        snap.file_ids.pop(); // break the parallel-array invariant
        let payload = SnapshotPayload {
            version: SNAPSHOT_VERSION,
            index: snap,
        };
        std::fs::write(&p, bincode::serialize(&payload).unwrap()).unwrap();
        assert!(load(&p).is_none());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn save_is_atomic_via_rename() {
        let p = tmp_path();
        save(&sample_index(), &p).unwrap();
        assert!(!p.with_extension("tmp").exists());
        assert!(p.exists());
        let _ = std::fs::remove_file(&p);
    }
}
