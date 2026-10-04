# Hand-off: finish benchmark measurement for arch/principles-and-zero-ipc

## Status: correctness is done, merge-ready. Only performance benchmarks remain unmeasured.

Everything below is scoped to **just** getting a clean cold-start/latency comparison
(`main` vs the fixed branch vs Raycast/Raycast Beta) to run successfully. Don't
re-litigate correctness — version guard, Svelte types, and packaged-runtime
acceptance (worker RPC, preferences, lifecycle) were all independently verified
this session via manual interactive testing and a full CI pass. See
`fixed-guarded/README.md` in this same directory for that evidence.

## Uncommitted diagnostic logging — resolved

Removed. The three `[DIAG]` `log::info!`/`log::error!` additions in
`asyar-launcher/src-tauri/src/bootstrap/windows.rs` and
`asyar-launcher/src-tauri/src/commands/shortcuts.rs` were reverted — both
files now match HEAD again (`git diff` on them is empty). They were debug
scaffolding for the hotkey mystery below, not part of the fix set.

## What actually went wrong tonight (read this before re-debugging)

The benchmark's cold-start test (`benchtool coldstart <bundle> <hotkey>`) kept
reporting `window never appeared within 30s` for Asyar across many attempts,
with three different, unrelated causes discovered in sequence — don't assume
it's still the first one:

1. **Real bug, found and fixed**: `extensionStateService.ts`'s RPC delivery and
   `extensionEventSubscriptions.ts`'s cross-window event listening were broken
   (already fixed, see git diff / fixed-guarded/README.md). Irrelevant to the
   benchmark specifically, but was discovered via the same testing session.

2. **`tauri-plugin-single-instance` + path-based PID tracking**: all
   `org.asyar.dev`-identified bundle copies (main, fixed-guarded, your
   `/Applications` copy, anything else) share ONE OS-level singleton. Launching
   any copy while another is already running just activates the existing
   process instead of starting fresh. `benchtool.swift`'s `processGroup()`
   matches PIDs by the exact bundle **path** it was told to launch, so a
   redirected-to instance at a different path is invisible to it →
   `launcherWindowVisible()` never gets checked against the right PID →
   false "never appeared."
   **Mitigation**: `pkill -f "Asyar Dev.app/Contents/MacOS/asyar"` and confirm
   `ps aux | grep -i "asyar dev"` is empty before every single cold-start
   invocation, including ones inside `run-fixed-guarded-comparison.sh`'s loop
   (main phase, then fixed-guarded phase — each needs this).

3. **The real blocker**: the app was actually **crashing** on every launch —
   `thread caused non-unwinding panic. aborting.`, root-caused via
   `~/Library/Application Support/org.asyar.dev/last_crash.json` to a panic
   inside `tao::platform_impl::platform::app_delegate::did_finish_launching`
   (very early AppKit launch callback, before Asyar's own setup/logging code
   ever runs — hence zero `[DIAG]` lines no matter what). Confirmed as **state
   corruption, not a code bug**: even a previously-proven-working build (used
   successfully for hours of manual testing earlier in the session) crashed
   identically once the data dir got corrupted — almost certainly from one of
   the many `pkill` force-kills during testing interrupting a write.
   Fixed by moving `~/Library/Application Support/org.asyar.dev` aside (backup
   preserved at `org.asyar.dev.bak`) and restoring everything except the stale
   `*-wal`/`*-shm` SQLite sidecar files and the 62MB `file_index_snapshot.bin`
   (all three main `.db` files passed `sqlite3 ... "PRAGMA integrity_check;"`
   fine — the WAL/SHM pair specifically was the suspect, from an interrupted
   checkpoint). All JSON `.dat` files validated clean too.
   **If this recurs** (likely, given how many restart cycles a full benchmark
   run does): same fix. Check `ps aux | grep -i "asyar dev"` for a process
   that's alive-but-unresponsive-to-hotkey (if it's genuinely crashed it won't
   show in `ps` at all — check `last_crash.json`'s mtime instead), and
   `cat ~/Library/Application\ Support/org.asyar.dev/last_crash.json` for a
   fresh panic message.

   **It recurred twice more tonight, and the trigger is now nailed down
   precisely**: a plain `pkill`/hard-kill of a live Asyar process reliably
   corrupts the WAL; a graceful quit does not. Reproduced directly —
   launch `main`, `osascript -e 'quit app "Asyar Dev"'` → `*.db-wal` goes to
   **0 bytes** (clean checkpoint), no crash on next launch. Launch again,
   `pkill -f ".../asyar"` instead → corrupted again, `did_finish_launching`
   panic on the very next launch. So: **never `pkill` a live Asyar process.
   Always quit it via `osascript -e 'quit app "Asyar Dev"'` first** (same
   thing `bench.sh`'s own `quit_app()` already does, with `pkill` only as a
   10s-timeout fallback — that part of the harness is fine as-is).

   The two recurrences tonight: (1) my own post-fix verification ended with a
   bare `pkill` cleanup instead of a graceful quit — that's what re-corrupted
   it; (2) more subtly, `bench.sh --yes` calls `die` immediately when
   `coldstart` fails, **skipping its own trailing `quit_app` cleanup** and
   leaving the just-launched process alive — if the _next_ command you run
   starts with a bare `pkill` (as the original resume recipe did, between
   phases), that hard-kills the orphaned live process. Fix applied each time:
   confirm `asyar_data.db`/`search_index.db`/`usage.db` pass
   `PRAGMA integrity_check` (they always have — only `*-wal`/`*-shm` are the
   casualty), move the directory aside to a fresh `org.asyar.dev.bak-<UTC
timestamp>` (never overwrite an existing `.bak*`), restore everything
   except `*-wal`/`*-shm`/`file_index_snapshot.bin`. Confirm clean via a
   graceful-quit launch/quit cycle (WAL back to 0 bytes, no new
   `last_crash.json`).

   **Going forward**: use the "To resume" commands below, which replace the
   bare pre-flight `pkill` with a graceful-quit-first helper. If `coldstart`
   still fails after that, check `last_crash.json`'s mtime before assuming
   it's a hotkey problem — and if it died, graceful-quit (don't pkill) any
   orphaned process before touching anything else.

Window detection itself (`CGWindowListCopyWindowInfo`-based
`launcherWindowVisible()` in benchtool.swift) is confirmed **working
correctly** for Asyar's NSPanel — verified directly: `alpha=1 onscreen=1
bounds={Height=480;Width=750;...}` when genuinely shown, which satisfies the
tool's `height>=60, width>=400` check. Don't re-investigate this axis.

Synthetic key delivery (`CGEventPost` at `.cghidEventTap`, same as what
`benchtool` uses) is also confirmed working in general — isolated test against
Raycast succeeded (`coldstart_ms=823`). Don't re-investigate this axis either
unless Asyar-specific symptoms return after ruling out #2 and #3 above.

## Open item: the `main` baseline bundle — ROOT-CAUSED, not a bug to fix

Confirmed why `main` never responds to `cmd+space`, via source inspection
(`git show 9145d66c...:asyar-launcher/src-tauri/src/lib.rs`) plus its live
log file, no Accessibility-gated input needed:

- At boot, Rust eagerly registers the **compiled-in default** shortcut
  (`ShortcutConfig::default()` = `Alt+Space`, i.e. `opt+space`) synchronously,
  before the frontend has loaded — identical in `main` and in this branch
  (`setup_global_shortcut` in `lib.rs` at that SHA is the same code that's now
  `bootstrap::windows::setup_global_shortcut`).
- `cmd+space` only takes over once the frontend boots and
  `settingsService.syncShortcut()` reads the real persisted value from
  `settings.dat` (confirmed `{"modifier":"Super","key":"Space"}` on disk —
  shared across all `org.asyar.dev` copies) and calls
  `initialize_shortcut_from_settings`, which logs
  `"Initializing shortcut from settings: {modifier} + {key}"`.
- Ran the `main` bundle standalone and grepped its boot window in
  `~/Library/Logs/org.asyar.dev/Asyar Dev.log` (times there are UTC, local is
  UTC+3): **that log line never appears**. `main`'s frontend never completes
  the settings sync, so it stays on `opt+space` for its whole run. (Plausibly
  downstream of the same broken RPC/event-bridge in item 1 above, but that's
  unconfirmed and out of scope — correctness work on `main`-vs-branch is done;
  `main` is the fixed point being measured against, not something to patch.)

**Fix for the benchmark, not the code**: drive `main`'s phase with
`--asyar-hotkey opt+space` instead of `cmd+space`. `fixed-guarded` keeps
`cmd+space` (already confirmed working). Because
`run-fixed-guarded-comparison.sh` applies one shared `--asyar-hotkey` value to
_both_ phases, it can't express this — run `bench.sh` directly per phase
instead (see "To resume" below).

## Bundles on disk

- `/private/tmp/asyar-benchmark-apps/main/Asyar Dev.app` — baseline, git `main`
  @ `9145d66c145e9f58f824945606d0df43266dbb25`
- `/private/tmp/asyar-benchmark-apps/fixed/Asyar Dev.app` — diagnostic build,
  **guard bypassed** (`--ignore-version-mismatches`). Don't use as evidence.
- `/private/tmp/asyar-benchmark-apps/fixed-guarded/Asyar Dev.app` — **the one
  to use**. Normal guarded `pnpm tauri build`, HEAD `1e807ce8` plus the
  uncommitted diff (see `fixed-guarded/compiled-changes.patch`). Confirmed
  working via manual interactive testing tonight.

## To resume

The wrapper script can't use a different Asyar hotkey per phase (see above),
so run `bench.sh` directly for each phase and assemble the comparison folder
the same way the wrapper does:

```bash
HARNESS="/private/tmp/asyar-comparison-harness/benchmarks"
OUT="/Users/khoshbin/develop/Asyar-Project/benchmarks/results/2026-10-03-architecture-review"
RUN="$OUT/comparisons/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN"

# Graceful-quit-first helper — NEVER bare-pkill a live Asyar process (hard
# kills corrupt its SQLite WAL; a graceful quit checkpoints it cleanly).
# Mirrors bench.sh's own quit_app(): osascript first, pkill only as a
# last resort after a 10s timeout.
safe_quit_asyar() {
  pgrep -f "Asyar Dev.app/Contents/MacOS/asyar" >/dev/null || return 0
  osascript -e 'quit app "Asyar Dev"' >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "Asyar Dev.app/Contents/MacOS/asyar" >/dev/null || return 0
    sleep 0.5
  done
  pkill -f "Asyar Dev.app/Contents/MacOS/asyar" || true
  sleep 1
}

# Phase 1: main baseline (git 9145d66c). Its boot always lands on opt+space —
# see "Open item" above — so it must be driven with that, not cmd+space.
safe_quit_asyar
ps aux | grep -i "asyar dev" | grep -v grep   # must print nothing
bash "$HARNESS/bench.sh" --yes \
  --asyar-app "/private/tmp/asyar-benchmark-apps/main/Asyar Dev.app" \
  --asyar-hotkey opt+space --raycast-hotkey cmd+space --raycast-beta-hotkey cmd+space
mkdir -p "$RUN/main"
ditto "$HARNESS/results" "$RUN/main"
printf '\nSource: `9145d66c145e9f58f824945606d0df43266dbb25`\nCompiler: Rust 1.97.0. Dev identity/profile/keychain: org.asyar.dev.\n' >> "$RUN/main/latest.md"

# Phase 2: fixed-guarded (HEAD 1e807ce8 + uncommitted diff). Confirmed to
# pick up the real cmd+space binding from settings.dat.
safe_quit_asyar
ps aux | grep -i "asyar dev" | grep -v grep   # must print nothing
bash "$HARNESS/bench.sh" --yes \
  --asyar-app "/private/tmp/asyar-benchmark-apps/fixed-guarded/Asyar Dev.app" \
  --asyar-hotkey cmd+space --raycast-hotkey cmd+space --raycast-beta-hotkey cmd+space
mkdir -p "$RUN/fixed-guarded"
ditto "$HARNESS/results" "$RUN/fixed-guarded"
printf '\nSource: `%s plus compiled-changes.patch`\nCompiler: Rust 1.97.0. Dev identity/profile/keychain: org.asyar.dev. Release symbol stripping disabled; sizes differ from normal releases. Built through the normal guarded `pnpm tauri build` path — no --ignore-version-mismatches, no bypass. See fixed-guarded/compiled-changes.patch for the exact diff.\n' "$(cat "$OUT/fixed-guarded/source-head.txt")" >> "$RUN/fixed-guarded/latest.md"

echo "Saved fresh reports to $RUN"
```

Must run from a Terminal with Accessibility permission already granted (an
agent's own Bash tool will have `AXIsProcessTrusted() == false` and cannot run
this itself — ask the user to run it and report output). If `coldstart`
fails for a reason unrelated to corruption (check `last_crash.json`'s mtime
first), `bench.sh --yes` will have `die`'d immediately, skipping its own
cleanup and leaving the process alive — run `safe_quit_asyar` (not `pkill`)
before doing anything else, then apply the WAL-corruption recovery above only
if `last_crash.json` is actually fresh. Each phase writes to its own
subfolder under `$RUN`, so re-running one phase doesn't disturb the other.

`/tmp/benchtool` (compiled from `/private/tmp/asyar-comparison-harness/benchmarks/benchtool.swift`)
and `/tmp/dump_windows` (ad-hoc window-state diagnostic, source likely gone —
recreate from the `CGWindowListCopyWindowInfo` snippet in the session
transcript if needed) may still exist from tonight for isolated testing
outside the full comparison script.
