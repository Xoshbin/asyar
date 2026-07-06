# File Search — Architecture

> Rust-owned filename index + thumbnail cache backing the "Search Files"
> built-in feature and the root-search fallback row.

File search answers two questions: "find a file by name across `$HOME`" and
"show me what it looks like without opening it." Both are implemented so
the cost lives in Rust and scales independently of how much is indexed —
the root search hot path is untouched, and the query engine's per-keystroke
work is bounded by construction, not by how many files exist on disk.

## 1. Rust module map

All of it lives under `asyar-launcher/src-tauri/src/file_index/`:

| File | Responsibility |
|---|---|
| `types.rs` | Wire types (`FileHit`, `FileSearchResponse`, `IndexStatus`, `FileIndexConfig`, `FileType`, `WorkMeter`) |
| `index.rs` | `FileIndex` — the arena (struct-of-arrays), `apply_batch` for incremental updates, snapshot (de)serialization |
| `query.rs` | The bounded query engine — memmem prefiltering, incremental narrowing, bounded fuzzy fallback, top-N heap |
| `matcher.rs` | Reused `nucleo` fuzzy matcher (never allocated per query) |
| `ranking.rs` | Pure scoring functions (match quality, frecency, depth, type prior) |
| `file_id.rs` | Stable file id: FNV hash of `(dev, inode)` (Unix) / `(volume, file_index)` (Windows) — survives renames |
| `walker.rs` | Parallel initial scan (`ignore` crate), exclusion patterns, hard entry cap, bundle-as-leaf handling |
| `watcher.rs` | Raw `notify` watcher + Asyar-owned coalescer (exclusion check first, flush every 500 ms), `FileIndexWatcherHandle` |
| `snapshot.rs` | Versioned bincode snapshot — instant restart without a full rescan |
| `learning.rs` | In-memory per-query selection/pin boosts, loaded once at startup (never queried on the keystroke path) |
| `service.rs` | `FileIndexState` — the lifecycle/state machine tying everything together, Tauri-agnostic by design |
| `provider.rs` + `deep/{mdfind,everything,plocate}.rs` | On-demand "Deep Search" escalation to the OS-native search tool |
| `commands.rs` | Thin `#[tauri::command]` wrappers — no logic beyond extract/delegate/map-error |

`asyar-launcher/src-tauri/src/thumbnail/` is a separate, related subsystem
(§7).

Two SQLite tables back learning/pins: `storage/file_search_selections.rs`,
`storage/file_search_pinned.rs`.

## 2. The index: an arena, not a hash map

`FileIndex` (`index.rs`) is a struct-of-arrays:

```rust
pub struct FileIndex {
    entries: Vec<EntryMeta>,   // ~24 B/entry, static-rank sorted at build time
    file_ids: Vec<u64>,
    lc_arena: Vec<u8>,         // lowercased names, concatenated, 0xFF-separated
    disp_arena: Vec<u8>,       // original-case names, for display/materialization
    tombstones: Vec<u64>,      // bitset — watcher removals, no compaction needed for correctness
    sealed: usize,             // [..sealed] static-rank order; [sealed..] = watcher-appended live tail
    generation: u64,           // bumped on every apply_batch; invalidates the narrowing cache
}
```

Paths are **never stored**. A hit's path is materialized on demand by
walking the `parent` chain through `disp_arena` — only for the ≤50 entries
that make it into a response.

At the 1,000,000-entry hard cap this is ≈72 MB total (~72 B/entry); a
typical `$HOME` (300k entries) is ≈22 MB.

## 3. The query engine — why it's fast at any index size

`query.rs::execute` is the whole story. Every phase has a hard bound:

1. **Collection** — `memchr::memmem` scans `lc_arena` for the longest query
   token, capped at 2048 candidates. Because entries are static-rank
   sorted, truncating at the cap keeps the *best* candidates, not an
   arbitrary prefix.
2. **Incremental narrowing** — if the new query extends the previous one
   (same index generation), only the previous candidate set is
   re-verified — no fresh arena scan. If the previous scan was truncated,
   the scan *resumes* from where it stopped with the new, rarer needle, so
   narrowing never silently loses matches.
3. **Bounded fuzzy fallback** — only runs when substring matching is
   sparse (<48 candidates) and the query is ≥3 chars. Hard op budget
   (100k), single reused `nucleo::Matcher` — never allocated per query.
4. **Scoring + top-N** — a `BinaryHeap` of 50, not a full sort. Pinned
   files get a flat `+10` bonus that dominates any unpinned score.

Measured budget at 1M entries / ~18 MB `lc_arena`: 2–6 ms on a rare first
keystroke, <1 ms on narrowed follow-up keystrokes, ≤15 ms provable worst
case. A CI-stable perf regression test (`query.rs::perf_budget_op_counts_on_synthetic_index`)
asserts operation counts, not wall-clock, so it can't flake — a
`#[ignore]`d wall-clock bench (`perf_bench_wall_clock_1m_entries`) is run
manually in release mode when tuning this path.

## 4. Lifecycle

`lib.rs` wires a detached startup thread (mirroring the pre-existing
application-index watcher's own detached-thread rationale — a synchronous
cold scan would dominate cold-launch latency):

```
load snapshot (instant, if present)
  → publish Ready
  → arm watcher over the configured roots
  → background rescan-diff
  → debounced snapshot save
```

A manual or config-triggered rebuild (`file_index_rebuild` /
`file_index_set_config`) calls `FileIndexState::mark_rescanning()`
**synchronously** — before the actual scan is spawned — and emits
`asyar:file-index-status` immediately. This matters: the scan itself runs
on a `spawn_blocking` task and can take several seconds on a large
`$HOME`; without the synchronous status flip, the UI would show stale
`Ready` data with no indication anything was happening until the scan
silently finished.

## 5. Coverage: what gets indexed, and what must never be watched

Default root is `$HOME`. `walker::DEFAULT_IGNORE_PATTERNS` (shared by both
the walker *and* the watcher's exclusion set — one source of truth) drops:
`node_modules`, `.git`, `Library` (macOS app support/caches — this alone
avoids ~500k+ entries), build/dependency directories (`target`, `dist`,
`DerivedData`, …), and VM storage folders (`Virtual Machines.localized`,
`VirtualBox VMs`).

The VM exclusion is not just an index-size optimization. A **running** VM
writes to its virtual disk continuously — on the host that's a constant
stream of filesystem-change events for files inside the VM's bundle. If
the watcher isn't told to ignore that path, it reacts to every write for
as long as the VM is powered on, so the exclusion applies to both the
walker and `watcher.rs`'s exclusion set (the same pattern list).

`walker::BUNDLE_EXTENSIONS` treats `.app`, `.framework`, `.photoslibrary`,
`.pvm`, `.vmwarevm` directories as opaque leaves — indexed as one entry,
never descended into, regardless of what folder they live in. The
watcher's exclusion set mirrors this with `**/*.<ext>/**` globs so events
from *inside* a bundle (Photos doing library maintenance, an app updating
itself) can't append tail entries the walker would never emit.

## 6. Watcher internals: why not `notify-debouncer-full`

`watcher.rs` uses a **raw `notify` watcher** plus a small Asyar-owned
coalescer, not `notify-debouncer-full`. The debouncer's default
`FileIdMap` cache walks and `stat`s **every file under each watched
root** into a `HashMap<PathBuf, FileId>` — no exclusions, symlinks
followed — and re-walks the entire tree on every kernel "events dropped"
flag. Watching `$HOME` that way kept a core pinned in a self-feeding
rescan loop (the walk blocks the event thread → the kernel drops events →
another rescan flag → another walk) and held gigabytes of path strings,
all to power rename stitching the index never consumed.

The replacement pipeline:

```
notify event callback (FSEvents/inotify thread)
  → Coalescer.ingest: exclusion glob check FIRST — no stat, no queueing
    for excluded paths; survivors de-dup into a HashSet
flush thread, every 500 ms
  → drain → resolve(path): one symlink_metadata per survivor —
    exists ⇒ Upserted, gone ⇒ Removed (renames tombstone the old name)
  → FileIndexState::apply_watcher_batch
```

Two valves degrade a window to a **bounded** walker rescan
(`commands::make_on_rescan` → `spawn_rescan`, which never re-arms the
watcher and never stacks on a running scan): the kernel's rescan flag,
and a >50k pending-path overflow. Both replace the library's answer
(unbounded cache walk) with ours (exclusion-aware, hard-capped scan).

The other two debouncer users (`application/index_watcher.rs`,
`fs_watcher/mod.rs`) keep `notify-debouncer-full` for its debouncing but
pass `NoCache` explicitly — neither consumes rename stitching, and an
extension watching a large tree must not make the host stat-walk it.

A hard cap (`walker::HARD_CAP` = 1,000,000 entries) stops the walk and
flips status to `CapReached` rather than growing unbounded.

## 7. Thumbnails — a separate, related subsystem

`asyar-launcher/src-tauri/src/thumbnail/` generates and caches file preview
thumbnails, served the same way application icons already are:

```
get_file_thumbnail(path, maxDim)
  → cache key = hash(path, mtime, size, maxDim)   // an edit produces a new key automatically
  → cache hit?  → return asyar-thumb://<key>.png instantly
  → cache miss  → generate (bounded to 3 concurrent generations), cache, return
```

- **Images**: cross-platform via the `image` crate — decode, downscale
  (never upscale — `DynamicImage::thumbnail` upscales small images to fill
  the box by default, which is wrong for a preview; `image_thumb.rs`
  guards this explicitly), encode PNG.
- **Everything else, macOS only**: `qlmanage -t`, the same Quick Look
  thumbnailing service Finder uses — one mechanism covers PDFs, videos,
  Office docs, archives, with no per-type Rust decoder needed.
- **Windows/Linux, non-image types**: no thumbnail yet (`None` — caller
  falls back to a type icon/metadata display). A native shell-thumbnail
  integration per OS is the natural follow-up; deliberately out of scope
  for the initial pass.

`qlmanage` is a thumbnailing **daemon**, not a plain CLI tool — it hangs
indefinitely without a real WindowServer session (observed directly in a
headless dev/test environment). `thumbnail::macos::generate_via_quicklook`
therefore never calls it directly; it goes through
`file_index::provider::run_with_timeout` (the same bounded
spawn-with-kill-on-timeout helper the Deep Search providers use), capped
at 5 seconds.

**Where thumbnails are requested matters as much as how they're
generated.** The row list only ever requests thumbnails for `image` type —
never the qlmanage path — because `document`/`code` are usually the
majority of a `$HOME` result set and already have a fast text preview;
requesting a qlmanage thumbnail for every non-folder row would mean a
subprocess spawn per newly-visible file on every keystroke. The detail
pane (one file at a time, debounced ~150 ms against fast arrow-key
scrolling) is where the qlmanage-backed richer preview lives. The row list
is separately debounced (~120 ms) against fast typing replacing the
visible set before a request would even land.

Cache: `$APPDATA/thumbnail_cache/`, size-capped at 300 MB
(`thumbnail::cache::CACHE_CAP_BYTES`), oldest-by-mtime eviction sweep on
every write once over budget.

## 8. IPC contract

| Command | Args (camelCase) | Returns |
|---|---|---|
| `file_search` | `{query, typeFilter?, limit?}` | `FileSearchResponse` |
| `file_index_status` | `{}` | `IndexStatus` |
| `file_index_rebuild` | `{}` | `()` — see §4 for the synchronous status flip |
| `file_index_set_config` | `{config: FileIndexConfig}` | `()` |
| `file_search_record_selection` | `{query, fileId}` | `()` |
| `file_search_pin` / `file_search_unpin` | `{fileId, path?}` | `()` |
| `file_search_list_pinned` | `{}` | `FileHit[]` |
| `file_search_clear_history` | `{}` | `()` |
| `deep_search_availability` | `{}` | `string \| null` (provider id) |
| `deep_search` | `{query, limit?}` | `FileHit[]` |
| `get_file_thumbnail` | `{path, maxDim?}` | `string \| null` (an `asyar-thumb://` URL) |
| `read_text_preview` | `{pathStr, maxBytes?}` | `string` (bounded, lossy-UTF8) |
| `open_in_terminal` / `quick_look_path` | `{pathStr}` | `()` |

`read_text_preview` exists because `@tauri-apps/plugin-fs`'s `readFile` is
gated by the webview's fs capability scope, which only ever covered
`$APPDATA/extensions/**` and `$APPDATA/clipboard_cache/**` — never
arbitrary `$HOME` paths. Every file-search preview read goes through a
Rust command instead, which isn't subject to that scope at all. This is
also why thumbnails are generated Rust-side rather than read via
`plugin-fs` in the frontend.

Event: `asyar:file-index-status` — emitted on every state transition
(startup, rebuild start/end, config change). A rebuild's only visible
milestones are the synchronous `Rescanning` flip and the final
`Ready`/`CapReached` emission (§4); there is no mid-scan progress event.

TS wrappers: `src/lib/ipc/fileSearchCommands.ts`,
`src/lib/ipc/thumbnailCommands.ts`.

## 9. Root-search fallback row

`search_engine/file_search_fallback.rs::append_file_search_fallback` is the
**only** touch point on the root-search hot path — everything else about
file search is fully decoupled from `SearchState`. Called from
`search_engine/commands.rs::merged_search` after the normal ranking result
is computed:

```rust
if file_search_available && query.trim().chars().count() >= 2 && matched_count < 5 {
    append_file_search_fallback(&mut results, query, matched_count, file_search_available);
}
```

`file_search_available` is one atomic-ish read (`FileIndexState::config()`
via `try_state`) — no file-index data is touched on this path. The
synthetic row shares the real "Search Files" command's object id
(`cmd_file-search_show-files`), so it's deduplicated automatically if the
real command already matched, and the existing command-dispatch mapper
handles navigation with no file-search-specific frontend code.

`FileSearchExtension.executeCommand` (in
`src/built-in-features/file-search/index.ts`) seeds **both** the view's
own internal query state and the shared search bar
(`searchStores.query`). Both are required: the two are otherwise
independent reactive stores, so seeding only the internal query state
leaves the visible search bar showing whatever the user had typed in
root search even though results have already updated underneath it.

## 10. Settings

```ts
AppSettings.fileSearch: {
  enabled: boolean;           // default true
  includeRoots: string[];     // default [] ⇒ $HOME
  excludePatterns: string[];  // layered on top of the built-in list, never replacing it
  indexHidden: boolean;       // default false
}
```

`src/services/fileIndex/fileIndexConfigSync.svelte.ts` mirrors
`services/application/scanPathsSync.svelte.ts`'s pattern exactly: push the
current settings value to Rust on init, diff-and-repush on every change.
UI: `src/routes/settings/tabs/FileSearchTab.svelte`.

## 11. Known follow-ups

- Windows/Linux native thumbnail providers for non-image types
  (`thumbnail::windows`/`thumbnail::linux` are stubs today, always
  returning `Err`).
- No debug override for `HARD_CAP` — testing the `CapReached` state
  requires actually pointing the index at ~1M real files.
- Cloud-sync churn (iCloud Desktop/Documents, Dropbox, Google Drive) is
  *not* excluded — those files are legitimately useful to search, unlike
  VM disk images, so exclusion isn't a valid mitigation if their sync
  activity turns out to be a meaningful CPU contributor. Would need
  separate profiling and a different approach.
