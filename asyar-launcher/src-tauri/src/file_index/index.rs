//! The in-memory file index: a struct-of-arrays arena.
//!
//! Layout invariants:
//! - `entries[i]`, `file_ids[i]`, `path_hashes[i]` are parallel arrays.
//! - Entries `[..sealed]` are laid out in descending `static_rank` order
//!   (scan roots first, then ranked items); `[sealed..]` is the live tail
//!   appended by the watcher between rescans.
//! - `lc_arena` holds each entry's lowercased name bytes followed by one
//!   `0xFF` separator byte. `0xFF` never occurs in valid UTF-8, so a UTF-8
//!   needle can never match across a name boundary — the memmem scan needs
//!   no boundary checks.
//! - Scan roots are entries with `parent == NO_PARENT` and `lc_len == 0`
//!   (empty match region: a root can never be a search hit). Their display
//!   name is the root's full path, which anchors `materialize_path`.
//! - Paths are never stored per entry; they are materialized on demand by
//!   walking the `parent` chain through `disp_arena`.
//! - A `Removed` event only tombstones the exact path. Children of a
//!   removed directory linger until the next rescan diff — accepted
//!   staleness, corrected in the background.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::file_id;
use super::ranking;
use super::types::{pack_flags, EntryKind, EntryMeta, FileType, NO_PARENT};

/// Separator byte between names in `lc_arena`. Invalid in UTF-8 by design.
pub const NAME_SEPARATOR: u8 = 0xFF;

/// One filesystem object produced by the walker or the watcher.
#[derive(Debug, Clone)]
pub struct ScannedEntry {
    pub path: PathBuf,
    pub kind: EntryKind,
    /// Unix mtime seconds (truncated).
    pub mtime: u32,
    /// Dotfile / OS-hidden.
    pub hidden: bool,
    /// Cloud placeholder (not materialized on disk).
    pub placeholder: bool,
}

/// Watcher-originated incremental change.
#[derive(Debug, Clone)]
pub enum IndexUpdate {
    Upserted(ScannedEntry),
    Removed(PathBuf),
}

pub struct FileIndex {
    entries: Vec<EntryMeta>,
    file_ids: Vec<u64>,
    path_hashes: Vec<u64>,
    lc_arena: Vec<u8>,
    disp_arena: Vec<u8>,
    /// Bitset over entry indices.
    tombstones: Vec<u64>,
    /// Indices `[..sealed]` are static-rank ordered.
    sealed: usize,
    generation: u64,
    /// Entry indices sorted by `path_hashes[idx]` for binary-search lookup,
    /// covering `[..sealed]`. Tail lookups go through `tail_by_hash`.
    path_lookup: Vec<u32>,
    /// Path-hash → entry index for the live tail `[sealed..]`.
    tail_by_hash: HashMap<u64, u32>,
    /// Count of scan-root entries (they occupy indices `0..roots_len`).
    roots_len: usize,
}

impl FileIndex {
    /// An index with no roots and no entries — the placeholder state
    /// before the first scan or snapshot load completes, and what a
    /// disabled feature falls back to.
    pub fn empty() -> Self {
        Self::build(Vec::new(), Vec::new(), 0)
    }

    /// Builds a fresh index from a complete scan. Roots come first, then
    /// items in descending `static_rank` order (name-ascending tiebreak for
    /// determinism). `items` must contain every directory that appears as
    /// an ancestor of any other item (the walker guarantees this).
    pub fn build(roots: Vec<PathBuf>, items: Vec<ScannedEntry>, now: i64) -> Self {
        let total = roots.len() + items.len();
        let mut index = FileIndex {
            entries: Vec::with_capacity(total),
            file_ids: Vec::with_capacity(total),
            path_hashes: Vec::with_capacity(total),
            lc_arena: Vec::new(),
            disp_arena: Vec::new(),
            tombstones: vec![0; total.div_ceil(64)],
            sealed: 0,
            generation: 0,
            path_lookup: Vec::new(),
            tail_by_hash: HashMap::new(),
            roots_len: roots.len(),
        };

        // Dir path → final entry index, so children can resolve `parent`.
        let mut dir_map: HashMap<PathBuf, u32> = HashMap::new();

        for root in &roots {
            let idx = index.entries.len() as u32;
            let disp = root.to_string_lossy();
            let disp_off = index.disp_arena.len() as u32;
            index.disp_arena.extend_from_slice(disp.as_bytes());
            index.entries.push(EntryMeta {
                lc_off: index.lc_arena.len() as u32,
                disp_off,
                lc_len: 0,
                name_len: disp.len().min(u16::MAX as usize) as u16,
                parent: NO_PARENT,
                mtime: 0,
                flags: pack_flags(EntryKind::Dir, false, false),
                ext_class: FileType::Folder as u8,
            });
            index.lc_arena.push(NAME_SEPARATOR);
            index.file_ids.push(file_id::derive_u64(root));
            index.path_hashes.push(file_id::hash_path(root));
            dir_map.insert(root.clone(), idx);
        }

        // Static-rank ordering: rank desc, name asc for determinism.
        struct Ranked {
            item: usize,
            rank: f32,
            name: String,
        }
        let mut ranked: Vec<Ranked> = items
            .iter()
            .enumerate()
            .map(|(i, it)| {
                let name = entry_name(&it.path);
                let depth = relative_depth(&it.path, &roots);
                let ft = classify(it);
                Ranked {
                    item: i,
                    rank: ranking::static_rank(it.mtime, now, depth, ft, &name),
                    name,
                }
            })
            .collect();
        ranked.sort_by(|a, b| {
            b.rank
                .partial_cmp(&a.rank)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.name.cmp(&b.name))
        });

        // Register every directory's final index before emitting entries, so
        // a child can reference a parent that sorts after it.
        for (pos, r) in ranked.iter().enumerate() {
            let it = &items[r.item];
            if matches!(it.kind, EntryKind::Dir) {
                dir_map.insert(it.path.clone(), (roots.len() + pos) as u32);
            }
        }

        for r in &ranked {
            let it = &items[r.item];
            let parent = it
                .path
                .parent()
                .and_then(|p| dir_map.get(p).copied())
                .unwrap_or(NO_PARENT);
            index.emit_entry(it, &r.name, parent);
        }

        index.sealed = index.entries.len();
        index.rebuild_path_lookup();
        index
    }

    /// Writes one entry's metadata + arena bytes. Assumes `entries`,
    /// `file_ids`, `path_hashes` stay parallel and `lc_off` stays monotonic.
    fn emit_entry(&mut self, it: &ScannedEntry, name: &str, parent: u32) {
        let lc = name.to_lowercase();
        let lc_off = self.lc_arena.len() as u32;
        let disp_off = self.disp_arena.len() as u32;
        self.lc_arena.extend_from_slice(lc.as_bytes());
        self.lc_arena.push(NAME_SEPARATOR);
        self.disp_arena.extend_from_slice(name.as_bytes());
        self.entries.push(EntryMeta {
            lc_off,
            disp_off,
            lc_len: lc.len().min(u16::MAX as usize) as u16,
            name_len: name.len().min(u16::MAX as usize) as u16,
            parent,
            mtime: it.mtime,
            flags: pack_flags(it.kind, it.hidden, it.placeholder),
            ext_class: classify(it) as u8,
        });
        self.file_ids.push(file_id::derive_u64(&it.path));
        self.path_hashes.push(file_id::hash_path(&it.path));
    }

    fn rebuild_path_lookup(&mut self) {
        let mut lookup: Vec<u32> = (0..self.sealed as u32).collect();
        lookup.sort_unstable_by_key(|&i| self.path_hashes[i as usize]);
        self.path_lookup = lookup;
    }

    /// Total entries including roots, tail and tombstoned.
    pub fn entries_len(&self) -> usize {
        self.entries.len()
    }

    /// Live (non-tombstoned, non-root) entry count — the user-facing
    /// "indexed files" number.
    pub fn live_count(&self) -> usize {
        let dead: usize = self
            .tombstones
            .iter()
            .map(|w| w.count_ones() as usize)
            .sum();
        self.entries.len() - self.roots_len - dead
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn sealed(&self) -> usize {
        self.sealed
    }

    pub fn roots_len(&self) -> usize {
        self.roots_len
    }

    pub fn entry(&self, idx: u32) -> &EntryMeta {
        &self.entries[idx as usize]
    }

    pub fn file_id(&self, idx: u32) -> u64 {
        self.file_ids[idx as usize]
    }

    pub fn lc_arena(&self) -> &[u8] {
        &self.lc_arena
    }

    /// Lowercased name bytes of one entry.
    pub fn lc_name(&self, idx: u32) -> &[u8] {
        let e = &self.entries[idx as usize];
        &self.lc_arena[e.lc_off as usize..e.lc_off as usize + e.lc_len as usize]
    }

    /// Original-case display name of one entry.
    pub fn disp_name(&self, idx: u32) -> &str {
        let e = &self.entries[idx as usize];
        let bytes =
            &self.disp_arena[e.disp_off as usize..e.disp_off as usize + e.name_len as usize];
        std::str::from_utf8(bytes).unwrap_or_default()
    }

    /// Maps an `lc_arena` byte offset (a memmem hit position) to the entry
    /// whose name region contains it. `None` when the offset lands on a
    /// separator byte or a root's empty region.
    pub fn entry_at_offset(&self, off: usize) -> Option<u32> {
        // Entries are emitted in arena order, so `lc_off` is monotonic and
        // binary search applies (~20 comparisons at 1M entries).
        let i = self.entries.partition_point(|e| e.lc_off as usize <= off);
        if i == 0 {
            return None;
        }
        let idx = (i - 1) as u32;
        let e = &self.entries[idx as usize];
        let end = e.lc_off as usize + e.lc_len as usize;
        (off < end).then_some(idx)
    }

    /// Parent-chain hops to the scan root (root itself = 0, a file directly
    /// in the root = 1). Capped walk — corrupt chains return the cap rather
    /// than looping.
    pub fn depth(&self, idx: u32) -> u32 {
        const MAX_HOPS: u32 = 64;
        let mut hops = 0;
        let mut cur = self.entries[idx as usize].parent;
        while cur != NO_PARENT && hops < MAX_HOPS {
            hops += 1;
            cur = self.entries[cur as usize].parent;
        }
        hops
    }

    /// Full path, rebuilt by walking the parent chain.
    pub fn materialize_path(&self, idx: u32) -> String {
        const MAX_HOPS: usize = 64;
        let mut chain: Vec<u32> = Vec::with_capacity(8);
        let mut cur = idx;
        loop {
            chain.push(cur);
            let parent = self.entries[cur as usize].parent;
            if parent == NO_PARENT || chain.len() >= MAX_HOPS {
                break;
            }
            cur = parent;
        }
        let mut path = String::new();
        for (i, &e) in chain.iter().rev().enumerate() {
            if i > 0 {
                path.push(std::path::MAIN_SEPARATOR);
            }
            path.push_str(self.disp_name(e));
        }
        path
    }

    pub fn is_tombstoned(&self, idx: u32) -> bool {
        let (word, bit) = (idx as usize / 64, idx as usize % 64);
        self.tombstones
            .get(word)
            .is_some_and(|w| w & (1u64 << bit) != 0)
    }

    fn set_tombstone(&mut self, idx: u32, dead: bool) {
        let (word, bit) = (idx as usize / 64, idx as usize % 64);
        if word >= self.tombstones.len() {
            self.tombstones.resize(word + 1, 0);
        }
        if dead {
            self.tombstones[word] |= 1u64 << bit;
        } else {
            self.tombstones[word] &= !(1u64 << bit);
        }
    }

    pub fn is_root(&self, idx: u32) -> bool {
        let e = &self.entries[idx as usize];
        e.parent == NO_PARENT && e.lc_len == 0
    }

    /// Finds the entry for an exact path (sealed region via binary search,
    /// tail via the overlay map). Tombstoned entries still resolve — an
    /// upsert for a previously removed path revives the entry.
    pub fn lookup_path(&self, path: &Path) -> Option<u32> {
        let hash = file_id::hash_path(path);
        let want = path.to_string_lossy();

        if let Some(&idx) = self.tail_by_hash.get(&hash) {
            if self.materialize_path(idx) == want {
                return Some(idx);
            }
        }

        // Binary search the sealed region, then verify each equal-hash
        // neighbor by materializing (collision guard).
        let start = self
            .path_lookup
            .partition_point(|&i| self.path_hashes[i as usize] < hash);
        self.path_lookup[start..]
            .iter()
            .take_while(|&&i| self.path_hashes[i as usize] == hash)
            .find(|&&idx| self.materialize_path(idx) == want)
            .copied()
    }

    /// Applies a batch of watcher updates and bumps the generation when
    /// anything changed. New entries (including any missing ancestor
    /// directories) are appended to the live tail.
    pub fn apply_batch(&mut self, updates: Vec<IndexUpdate>, now: i64) {
        let _ = now;
        let mut changed = false;
        for update in updates {
            match update {
                IndexUpdate::Removed(path) => {
                    if let Some(idx) = self.lookup_path(&path) {
                        if !self.is_root(idx) && !self.is_tombstoned(idx) {
                            self.set_tombstone(idx, true);
                            changed = true;
                        }
                    }
                }
                IndexUpdate::Upserted(se) => {
                    if let Some(idx) = self.lookup_path(&se.path) {
                        let revived = self.is_tombstoned(idx);
                        self.set_tombstone(idx, false);
                        let flags = pack_flags(se.kind, se.hidden, se.placeholder);
                        let ext_class = classify(&se) as u8;
                        let e = &mut self.entries[idx as usize];
                        e.mtime = se.mtime;
                        e.flags = flags;
                        e.ext_class = ext_class;
                        let _ = revived;
                        changed = true;
                    } else {
                        let parent = self.ensure_parent(&se.path, 0);
                        let name = entry_name(&se.path);
                        self.push_tail(&se, &name, parent);
                        changed = true;
                    }
                }
            }
        }
        if changed {
            self.generation += 1;
        }
    }

    /// Resolves (creating if necessary) the parent entry for `path`.
    /// Watcher events only arrive for paths under watched roots, so the
    /// chain terminates at an already-indexed directory; the depth cap
    /// guards against pathological paths.
    fn ensure_parent(&mut self, path: &Path, hops: u32) -> u32 {
        const MAX_HOPS: u32 = 64;
        let Some(parent_path) = path.parent() else {
            return NO_PARENT;
        };
        if parent_path.as_os_str().is_empty() || hops >= MAX_HOPS {
            return NO_PARENT;
        }
        if let Some(idx) = self.lookup_path(parent_path) {
            return idx;
        }
        let grandparent = self.ensure_parent(parent_path, hops + 1);
        let dir = ScannedEntry {
            path: parent_path.to_path_buf(),
            kind: EntryKind::Dir,
            mtime: 0,
            hidden: entry_name(parent_path).starts_with('.'),
            placeholder: false,
        };
        let name = entry_name(parent_path);
        self.push_tail(&dir, &name, grandparent)
    }

    /// Appends one entry to the live tail and registers it in the overlay
    /// lookup. Returns its index.
    fn push_tail(&mut self, se: &ScannedEntry, name: &str, parent: u32) -> u32 {
        let idx = self.entries.len() as u32;
        self.emit_entry(se, name, parent);
        let hash = self.path_hashes[idx as usize];
        self.tail_by_hash.insert(hash, idx);
        // Keep the bitset covering every entry.
        let words = self.entries.len().div_ceil(64);
        if self.tombstones.len() < words {
            self.tombstones.resize(words, 0);
        }
        idx
    }
}

/// Serializable form of the whole index — the body of the v3 snapshot.
/// Derived lookup structures (`path_lookup`, `tail_by_hash`) are rebuilt at
/// load time, not persisted.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct IndexSnapshot {
    pub sealed: u64,
    pub roots_len: u64,
    pub generation: u64,
    pub entries: Vec<EntryMeta>,
    pub file_ids: Vec<u64>,
    pub path_hashes: Vec<u64>,
    pub lc_arena: Vec<u8>,
    pub disp_arena: Vec<u8>,
    pub tombstones: Vec<u64>,
}

impl FileIndex {
    pub fn to_snapshot(&self) -> IndexSnapshot {
        IndexSnapshot {
            sealed: self.sealed as u64,
            roots_len: self.roots_len as u64,
            generation: self.generation,
            entries: self.entries.clone(),
            file_ids: self.file_ids.clone(),
            path_hashes: self.path_hashes.clone(),
            lc_arena: self.lc_arena.clone(),
            disp_arena: self.disp_arena.clone(),
            tombstones: self.tombstones.clone(),
        }
    }

    /// Reconstructs an index from a snapshot, validating every structural
    /// invariant. `None` means "treat as no snapshot" — rescan.
    pub fn from_snapshot(snapshot: IndexSnapshot) -> Option<FileIndex> {
        let n = snapshot.entries.len();
        let sealed = usize::try_from(snapshot.sealed).ok()?;
        let roots_len = usize::try_from(snapshot.roots_len).ok()?;
        if snapshot.file_ids.len() != n || snapshot.path_hashes.len() != n {
            return None;
        }
        if sealed > n || roots_len > sealed {
            return None;
        }
        for e in &snapshot.entries {
            // The lc region must fit AND leave room for its separator byte.
            if e.lc_off as usize + e.lc_len as usize > snapshot.lc_arena.len() {
                return None;
            }
            if e.disp_off as usize + e.name_len as usize > snapshot.disp_arena.len() {
                return None;
            }
            if e.parent != NO_PARENT && e.parent as usize >= n {
                return None;
            }
        }
        let mut tombstones = snapshot.tombstones;
        tombstones.resize(n.div_ceil(64), 0);

        let mut index = FileIndex {
            entries: snapshot.entries,
            file_ids: snapshot.file_ids,
            path_hashes: snapshot.path_hashes,
            lc_arena: snapshot.lc_arena,
            disp_arena: snapshot.disp_arena,
            tombstones,
            sealed,
            generation: snapshot.generation,
            path_lookup: Vec::new(),
            tail_by_hash: HashMap::new(),
            roots_len,
        };
        index.rebuild_path_lookup();
        for i in sealed..n {
            index.tail_by_hash.insert(index.path_hashes[i], i as u32);
        }
        Some(index)
    }
}

/// File name component as an owned string (empty for `/`-like paths).
fn entry_name(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Parent-hop depth of `path` relative to its longest-prefix scan root.
/// Falls back to the raw component count when no root matches.
fn relative_depth(path: &Path, roots: &[PathBuf]) -> u32 {
    roots
        .iter()
        .filter_map(|r| path.strip_prefix(r).ok())
        .map(|rel| rel.components().count() as u32)
        .min()
        .unwrap_or_else(|| path.components().count() as u32)
}

fn classify(it: &ScannedEntry) -> FileType {
    if matches!(it.kind, EntryKind::Dir) {
        FileType::Folder
    } else {
        let ext = it
            .path
            .extension()
            .map(|e| e.to_string_lossy())
            .unwrap_or_default();
        FileType::from_extension(&ext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Convert a unix-style fixture path to the platform's native
    /// separators. The index joins components with `MAIN_SEPARATOR` (via
    /// `materialize_path`) and compares that against requested paths, so a
    /// fixture must use native separators to round-trip — otherwise on
    /// Windows a `/tmp/rootA` root joins with `\` to `/tmp/rootA\docs`,
    /// which never equals the unix-spelled lookup key. No-op on Unix.
    fn np(unix: &str) -> String {
        unix.chars()
            .map(|c| {
                if c == '/' {
                    std::path::MAIN_SEPARATOR
                } else {
                    c
                }
            })
            .collect()
    }

    fn scanned(path: &str, kind: EntryKind, mtime: u32) -> ScannedEntry {
        ScannedEntry {
            path: PathBuf::from(np(path)),
            kind,
            mtime,
            hidden: false,
            placeholder: false,
        }
    }

    const NOW: i64 = 100_000_000;

    /// A small realistic tree under one root.
    fn small_index() -> FileIndex {
        let root = PathBuf::from(np("/tmp/rootA"));
        let items = vec![
            scanned("/tmp/rootA/docs", EntryKind::Dir, NOW as u32 - 86_400 * 40),
            scanned(
                "/tmp/rootA/docs/report.pdf",
                EntryKind::File,
                NOW as u32 - 3_600, // very recent → highest static rank
            ),
            scanned(
                "/tmp/rootA/old-notes.txt",
                EntryKind::File,
                NOW as u32 - 86_400 * 400, // >1y old
            ),
        ];
        FileIndex::build(vec![root], items, NOW)
    }

    #[test]
    fn build_places_roots_first_and_items_by_static_rank() {
        let idx = small_index();
        assert_eq!(idx.roots_len(), 1);
        assert!(idx.is_root(0));
        // Recent shallow-ish doc must come before the >1y-old text file.
        let report_pos = (0..idx.entries_len() as u32)
            .find(|&i| idx.disp_name(i) == "report.pdf")
            .unwrap();
        let notes_pos = (0..idx.entries_len() as u32)
            .find(|&i| idx.disp_name(i) == "old-notes.txt")
            .unwrap();
        assert!(
            report_pos < notes_pos,
            "recent report.pdf ({report_pos}) must precede old-notes.txt ({notes_pos})"
        );
        assert_eq!(idx.sealed(), idx.entries_len());
        assert_eq!(idx.live_count(), 3);
    }

    #[test]
    fn lc_names_are_lowercased_and_roots_unmatchable() {
        let root = PathBuf::from(np("/tmp/RootB"));
        let items = vec![scanned("/tmp/RootB/MyFile.TXT", EntryKind::File, 0)];
        let idx = FileIndex::build(vec![root], items, NOW);
        assert_eq!(idx.entry(0).lc_len, 0, "root has an empty match region");
        let file_idx = (0..idx.entries_len() as u32)
            .find(|&i| !idx.is_root(i))
            .unwrap();
        assert_eq!(idx.lc_name(file_idx), b"myfile.txt");
        assert_eq!(idx.disp_name(file_idx), "MyFile.TXT");
    }

    #[test]
    fn arena_names_are_separated_by_invalid_utf8_byte() {
        let idx = small_index();
        // Every entry's region must be followed by the separator.
        for i in 0..idx.entries_len() as u32 {
            let e = *idx.entry(i);
            let sep_pos = e.lc_off as usize + e.lc_len as usize;
            assert_eq!(
                idx.lc_arena()[sep_pos],
                NAME_SEPARATOR,
                "entry {i} not followed by separator"
            );
        }
    }

    #[test]
    fn entry_at_offset_maps_hits_and_rejects_separators() {
        let idx = small_index();
        for i in 0..idx.entries_len() as u32 {
            let e = *idx.entry(i);
            if e.lc_len == 0 {
                continue; // root: no matchable region
            }
            let first = e.lc_off as usize;
            let last = first + e.lc_len as usize - 1;
            assert_eq!(idx.entry_at_offset(first), Some(i));
            assert_eq!(idx.entry_at_offset(last), Some(i));
            assert_eq!(
                idx.entry_at_offset(last + 1),
                None,
                "separator offset must not map to an entry"
            );
        }
    }

    #[test]
    fn materialize_path_walks_parent_chain() {
        let idx = small_index();
        let report = (0..idx.entries_len() as u32)
            .find(|&i| idx.disp_name(i) == "report.pdf")
            .unwrap();
        assert_eq!(
            idx.materialize_path(report),
            np("/tmp/rootA/docs/report.pdf")
        );
        let notes = (0..idx.entries_len() as u32)
            .find(|&i| idx.disp_name(i) == "old-notes.txt")
            .unwrap();
        assert_eq!(idx.materialize_path(notes), np("/tmp/rootA/old-notes.txt"));
    }

    #[test]
    fn depth_counts_hops_from_root() {
        let idx = small_index();
        let report = (0..idx.entries_len() as u32)
            .find(|&i| idx.disp_name(i) == "report.pdf")
            .unwrap();
        let docs = (0..idx.entries_len() as u32)
            .find(|&i| idx.disp_name(i) == "docs")
            .unwrap();
        assert_eq!(idx.depth(0), 0, "root");
        assert_eq!(idx.depth(docs), 1);
        assert_eq!(idx.depth(report), 2);
    }

    #[test]
    fn lookup_path_finds_entries_and_misses_unknown() {
        let idx = small_index();
        let found = idx.lookup_path(Path::new(&np("/tmp/rootA/docs/report.pdf")));
        assert!(found.is_some());
        assert_eq!(idx.disp_name(found.unwrap()), "report.pdf");
        assert!(idx
            .lookup_path(Path::new(&np("/tmp/rootA/nope.txt")))
            .is_none());
    }

    #[test]
    fn removed_tombstones_and_upsert_revives() {
        let mut idx = small_index();
        let gen0 = idx.generation();
        let target = PathBuf::from(np("/tmp/rootA/docs/report.pdf"));

        idx.apply_batch(vec![IndexUpdate::Removed(target.clone())], NOW);
        let i = idx
            .lookup_path(&target)
            .expect("tombstoned entry still resolves");
        assert!(idx.is_tombstoned(i));
        assert_eq!(idx.live_count(), 2);
        assert!(idx.generation() > gen0);

        idx.apply_batch(
            vec![IndexUpdate::Upserted(scanned(
                "/tmp/rootA/docs/report.pdf",
                EntryKind::File,
                NOW as u32,
            ))],
            NOW,
        );
        let i2 = idx.lookup_path(&target).unwrap();
        assert!(!idx.is_tombstoned(i2), "revived");
        assert_eq!(idx.live_count(), 3);
    }

    #[test]
    fn upsert_existing_updates_mtime_without_growing() {
        let mut idx = small_index();
        let len_before = idx.entries_len();
        let target = PathBuf::from(np("/tmp/rootA/old-notes.txt"));
        idx.apply_batch(
            vec![IndexUpdate::Upserted(scanned(
                "/tmp/rootA/old-notes.txt",
                EntryKind::File,
                NOW as u32, // freshly modified
            ))],
            NOW,
        );
        assert_eq!(idx.entries_len(), len_before, "no new entry");
        let i = idx.lookup_path(&target).unwrap();
        assert_eq!(idx.entry(i).mtime, NOW as u32);
    }

    #[test]
    fn upsert_new_appends_to_tail_after_sealed() {
        let mut idx = small_index();
        let sealed = idx.sealed();
        idx.apply_batch(
            vec![IndexUpdate::Upserted(scanned(
                "/tmp/rootA/brand-new.md",
                EntryKind::File,
                NOW as u32,
            ))],
            NOW,
        );
        let i = idx
            .lookup_path(Path::new(&np("/tmp/rootA/brand-new.md")))
            .unwrap();
        assert!(i as usize >= sealed, "tail entry must live after sealed");
        assert_eq!(idx.materialize_path(i), np("/tmp/rootA/brand-new.md"));
        assert_eq!(idx.lc_name(i), b"brand-new.md");
    }

    #[test]
    fn upsert_creates_missing_ancestor_chain() {
        let mut idx = small_index();
        idx.apply_batch(
            vec![IndexUpdate::Upserted(scanned(
                "/tmp/rootA/new1/new2/deep.txt",
                EntryKind::File,
                NOW as u32,
            ))],
            NOW,
        );
        let i = idx
            .lookup_path(Path::new(&np("/tmp/rootA/new1/new2/deep.txt")))
            .unwrap();
        assert_eq!(idx.materialize_path(i), np("/tmp/rootA/new1/new2/deep.txt"));
        assert_eq!(idx.depth(i), 3);
        // Intermediate dirs are real, findable entries.
        let mid = idx
            .lookup_path(Path::new(&np("/tmp/rootA/new1/new2")))
            .unwrap();
        assert!(idx.entry(mid).is_dir());
    }

    #[test]
    fn empty_batch_does_not_bump_generation() {
        let mut idx = small_index();
        let gen0 = idx.generation();
        idx.apply_batch(vec![], NOW);
        assert_eq!(idx.generation(), gen0);
        // Removing an unknown path changes nothing either.
        idx.apply_batch(
            vec![IndexUpdate::Removed(PathBuf::from(np(
                "/tmp/rootA/ghost.txt",
            )))],
            NOW,
        );
        assert_eq!(idx.generation(), gen0);
    }

    #[test]
    fn file_ids_are_stable_path_hashes_for_nonexistent_test_paths() {
        // Test paths don't exist on disk, so derive falls back to the path
        // hash — the parallel array must still be populated and unique.
        let idx = small_index();
        let mut ids: Vec<u64> = (idx.roots_len() as u32..idx.entries_len() as u32)
            .map(|i| idx.file_id(i))
            .collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 3, "distinct ids per entry");
    }
}
