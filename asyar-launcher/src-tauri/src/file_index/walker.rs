//! Initial-scan walker. Walks configured roots in parallel, applies the
//! default + custom ignore pattern list, honours `.gitignore` files
//! encountered, treats macOS/Windows app bundles as opaque leaves, and
//! enforces a hard entry-count cap so a pathological root (or a missing
//! exclusion) can never grow the index past what the query engine budgets
//! for. The old attempt indexed all of `$HOME` including `~/Library`
//! (hundreds of thousands of extra entries) and had no cap at all — both
//! are fixed here.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use ignore::{WalkBuilder, WalkState};

use super::index::ScannedEntry;
use super::types::EntryKind;

/// Safety valve: stop scanning once the index would exceed this many
/// entries, regardless of exclusions. Surfaced to the user as `CapReached`.
pub const HARD_CAP: usize = 1_000_000;

pub const DEFAULT_IGNORE_PATTERNS: &[&str] = &[
    "node_modules",
    ".git",
    ".cache",
    "Library",
    ".Trash",
    ".cargo/registry",
    ".rustup",
    "AppData/Local",
    "target",
    "__pycache__",
    "dist",
    "build",
    ".venv",
    ".next",
    ".terraform",
    "vendor",
    "bower_components",
    ".gradle",
    "Pods",
    "DerivedData",
    "coverage",
    ".pytest_cache",
    // VM disk images are internally structured as many small files (e.g.
    // Parallels' "expanding disk" format) and are rewritten continuously
    // while a VM is running — indexing them balloons entry count for no
    // search value, and *watching* them means a running VM's guest-OS
    // disk writes translate into a constant stream of host-side fs
    // events that never stop for the life of the VM.
    "Virtual Machines.localized",
    "VirtualBox VMs",
];

/// Directory extensions treated as opaque leaf "bundles" — indexed as one
/// entry, never descended into (app bundles, frameworks, photo libraries,
/// VM disk images). The watcher's exclusion set mirrors this so events
/// from inside a bundle can't append entries the walker would never emit.
pub(crate) const BUNDLE_EXTENSIONS: &[&str] = &[
    "app",
    "framework",
    "photoslibrary",
    "bundle",
    "pvm",
    "vmwarevm",
    "vbox",
];

pub struct WalkOutcome {
    pub entries: Vec<ScannedEntry>,
    pub cap_reached: bool,
}

/// Walks `root`, honoring the default + `custom_ignore_patterns` exclusion
/// list, and stops once `cap` entries have been collected.
pub fn walk_root(root: &Path, custom_ignore_patterns: &[String], cap: usize) -> WalkOutcome {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(4))
        .unwrap_or(1);
    walk_root_with_threads(root, custom_ignore_patterns, cap, threads)
}

/// Same as `walk_root` with an explicit thread count — the parallel walk is
/// still correct with `threads=1`, which tests use for determinism.
pub(crate) fn walk_root_with_threads(
    root: &Path,
    custom_ignore_patterns: &[String],
    cap: usize,
    threads: usize,
) -> WalkOutcome {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(false)
        .ignore(true)
        .require_git(false)
        .threads(threads);

    let mut overrides = ignore::overrides::OverrideBuilder::new(root);
    for pat in DEFAULT_IGNORE_PATTERNS {
        let _ = overrides.add(&format!("!{pat}"));
    }
    for pat in custom_ignore_patterns {
        let _ = overrides.add(&format!("!{pat}"));
    }
    if let Ok(ov) = overrides.build() {
        builder.overrides(ov);
    }

    let entries: Mutex<Vec<ScannedEntry>> = Mutex::new(Vec::new());
    let count = AtomicUsize::new(0);
    let cap_reached = AtomicBool::new(false);

    builder.build_parallel().run(|| {
        let entries = &entries;
        let count = &count;
        let cap_reached = &cap_reached;
        Box::new(move |result| {
            let Ok(entry) = result else {
                return WalkState::Continue;
            };
            if entry.depth() == 0 {
                // The root itself is owned by `FileIndex::build`'s `roots`
                // list, not emitted as a scanned item.
                return WalkState::Continue;
            }
            let Some(ft) = entry.file_type() else {
                return WalkState::Continue;
            };
            let Ok(meta) = entry.metadata() else {
                return WalkState::Continue;
            };
            let path = entry.path();
            let is_dir = ft.is_dir();
            let is_bundle = is_dir
                && path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| BUNDLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
                    .unwrap_or(false);

            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let hidden = name.starts_with('.');
            let kind = if is_dir {
                EntryKind::Dir
            } else if ft.is_symlink() {
                EntryKind::Symlink
            } else {
                EntryKind::File
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as u32)
                .unwrap_or(0);

            if count.fetch_add(1, Ordering::Relaxed) >= cap {
                cap_reached.store(true, Ordering::Relaxed);
                return WalkState::Quit;
            }

            entries.lock().unwrap().push(ScannedEntry {
                path: path.to_path_buf(),
                kind,
                mtime,
                hidden,
                placeholder: false,
            });

            if is_bundle {
                // Record the bundle as a single leaf; don't index its
                // internals.
                WalkState::Skip
            } else {
                WalkState::Continue
            }
        })
    });

    WalkOutcome {
        entries: entries.into_inner().unwrap(),
        cap_reached: cap_reached.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture_root() -> PathBuf {
        let id = std::process::id();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("file_index_walker_test_{id}_{now}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn touch(root: &Path, rel: &str) {
        let full = root.join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, "x").unwrap();
    }

    fn names(out: &WalkOutcome) -> Vec<String> {
        out.entries
            .iter()
            .map(|e| e.path.file_name().unwrap().to_string_lossy().into_owned())
            .collect()
    }

    fn walk(root: &Path) -> WalkOutcome {
        walk_root_with_threads(root, &[], HARD_CAP, 1)
    }

    #[test]
    fn walks_plain_files() {
        let root = fixture_root();
        touch(&root, "a.txt");
        touch(&root, "sub/b.pdf");
        let out = walk(&root);
        let n = names(&out);
        assert!(n.contains(&"a.txt".to_string()));
        assert!(n.contains(&"b.pdf".to_string()));
        assert!(
            n.contains(&"sub".to_string()),
            "directories are entries too"
        );
        assert!(!out.cap_reached);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn skips_default_ignore_dirs_including_library() {
        let root = fixture_root();
        touch(&root, "a.txt");
        touch(&root, "node_modules/react/index.js");
        touch(&root, "target/debug/foo");
        touch(&root, "Library/Caches/whatever.bin");
        let out = walk(&root);
        let n = names(&out);
        assert!(n.contains(&"a.txt".to_string()));
        assert!(!n.iter().any(|x| x == "index.js"));
        assert!(!n.iter().any(|x| x == "foo"));
        assert!(!n.iter().any(|x| x == "whatever.bin"));
        assert!(!n.iter().any(|x| x == "Library"), "whole Library excluded");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn honours_gitignore() {
        let root = fixture_root();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".gitignore"), "secret.txt\n").unwrap();
        touch(&root, "secret.txt");
        touch(&root, "public.txt");
        let out = walk(&root);
        let n = names(&out);
        assert!(n.contains(&"public.txt".to_string()));
        assert!(!n.iter().any(|x| x == "secret.txt"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn custom_ignore_patterns_apply() {
        let root = fixture_root();
        touch(&root, "keep.txt");
        touch(&root, "skip-me.txt");
        let out = walk_root_with_threads(&root, &["skip-me.txt".to_string()], HARD_CAP, 1);
        let n = names(&out);
        assert!(n.contains(&"keep.txt".to_string()));
        assert!(!n.iter().any(|x| x == "skip-me.txt"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn bundle_directory_indexed_as_leaf_not_descended() {
        let root = fixture_root();
        touch(&root, "MyApp.app/Contents/Info.plist");
        let out = walk(&root);
        let n = names(&out);
        assert!(n.contains(&"MyApp.app".to_string()));
        assert!(
            !n.iter().any(|x| x == "Info.plist"),
            "bundle contents must not be indexed, got {n:?}"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn vm_storage_folder_is_entirely_excluded() {
        let root = fixture_root();
        touch(&root, "a.txt");
        // Parallels' expanding-disk format nests many small band files —
        // simulate that shape to prove the whole folder is dropped, not
        // just the top-level VM bundle.
        touch(
            &root,
            "Virtual Machines.localized/Ubuntu.pvm/Ubuntu.hdd/disk-s001.hds",
        );
        touch(&root, "VirtualBox VMs/Ubuntu/Ubuntu-disk001.vdi");
        let out = walk(&root);
        let n = names(&out);
        assert!(n.contains(&"a.txt".to_string()));
        assert!(!n.iter().any(|x| x == "Ubuntu.pvm"));
        assert!(!n.iter().any(|x| x.ends_with(".hds")));
        assert!(!n.iter().any(|x| x.ends_with(".vdi")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn vm_bundle_extension_is_a_leaf_even_outside_the_default_vm_folder() {
        let root = fixture_root();
        // A VM stored somewhere other than the conventional folder (e.g. a
        // custom location) must still not be descended into.
        touch(&root, "my-vms/Ubuntu.vmwarevm/Virtual Disk.vmdk");
        let out = walk(&root);
        let n = names(&out);
        assert!(n.contains(&"Ubuntu.vmwarevm".to_string()));
        assert!(!n.iter().any(|x| x.contains("Virtual Disk")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hard_cap_stops_walk_and_reports_cap_reached() {
        let root = fixture_root();
        for i in 0..20 {
            touch(&root, &format!("f{i}.txt"));
        }
        let out = walk_root_with_threads(&root, &[], 5, 1);
        assert!(out.cap_reached);
        assert!(out.entries.len() <= 5, "got {} entries", out.entries.len());
        let _ = fs::remove_dir_all(&root);
    }
}
