# Idle-cost investigation

Where Asyar's idle CPU and memory actually go, measured against the README
benchmark claims (3.20% idle CPU vs Raycast 0.04%; 435.6 MB vs 272.6 MB), with
per-process attribution, a realistic-vs-clean profile diff, an 8-hour soak, and
a ranked cause list. Everything here is reproducible with the commands given.

## TL;DR

1. **The published 3.20% came from a different machine and build entirely**
   (committed table: Apple M4 Max, macOS 26.5.2, Asyar 0.1.1-38, 2026-07-17),
   and the protocol it used inflates idle numbers regardless of machine. The measurement window opens ~60-105s
   after cold launch — overlapping post-activity settling, the 60-second
   delayed update-check jobs, and (worst case) first-run file indexing, which
   alone measures **7.27%**. Reproducing the exact protocol today yields
   **1.06%**; true deep idle is **0.66%** (realistic profile) and **0.25%**
   (clean profile).
2. **The benchmark is currently broken against the shipping app**: benchtool's
   window-visibility check required height ≥ 100 px, but the collapsed
   launcher is 750×96 — every hotkey/coldstart run times out. Fixed on this
   branch (threshold 60 px), after which hotkey→visible measures
   p50 17.5 ms / p95 27.0 ms / p99 27.8 ms over 50 runs.
3. **Deep-idle CPU is real but small, and it is design, not accident**: the
   launcher webview is deliberately parked unthrottled (alpha 0, ordered-in,
   occlusion detection disabled, 60 fps cap removed) so the 12-17 ms show time
   holds. Cost: ~8 ms/s CPU + 7 wakeups/s in WebContent (JS timers + GC; no
   continuous rendering), plus a WebKit GPU process that stays alive at ~10
   wakeups/s. The Rust side adds ~18 wakeups/s from enumerable pollers
   (census below).
4. **The memory gap is mostly clipboard history residency in the main
   process**: 193 MB (2.2k items) → 380 MB (10k items) at deep idle, ~24 KB
   per item held resident. The webview processes are a fixed ~160 MB tax
   (3 WebContent + GPU + Networking) regardless of state.
5. **No Rust-side leak; one slow webview creep**: 50 summon/dismiss cycles
   moved the group +0.7 MB. Over a 7.7 h idle soak the main process was flat
   (182.4 → 184.6 MB) with CPU pinned at 0.65-0.80% and wakeups constant,
   while the unthrottled launcher webview grew steadily ~1.4 MB/h without
   reaching a plateau — worth a longer soak, and another point for
   re-throttling on hide.

## How this was measured

- Machine: MacBook (Mac15,13, Apple M3), macOS 27.0 beta (26A5388g),
  Xcode-beta CLT (ld 27036.1). This is a beta OS; caveats it caused are
  listed at the end.
- App under test: `/Applications/asyar.app` 0.1.1-40 — the upstream
  Developer-ID build, whose version string matches `main` (e42167a5). A
  release build from this branch's worktree was used for the profile-isolation
  runs (details below).
- Power: early exploratory runs on battery (noted where relevant); every
  number quoted in this report was captured on AC power with
  `caffeinate -dims` holding the machine awake, display on.
- Profiles. Three states, never touching the real user profile beyond reads:
  - **realistic**: the real `org.asyar.app` profile in place (2,228 clipboard
    items, 86 MB `file_index_snapshot.bin`, 7 extensions incl. one with an
    `fs:watch` grant and one with a 10 s scheduled command, 0 MCP servers).
  - **enriched**: a copy seeded to 10,000 clipboard items (real rows
    duplicated with fresh ids/timestamps) plus one enabled stdio MCP server,
    run by a `org.asyar.bench`-identifier build so it reads its own profile
    dir and keychain item.
  - **clean**: the bench-identifier build with a fresh empty profile.
- Core commands (exact invocations, all logged with raw output in the branch
  worktree scratch results):
  - CPU / memory / group: `benchmarks/.build/benchtool cpu|mem|group <app> [60]`
  - Wakeups + per-process CPU: `sudo powermetrics --samplers tasks
--show-process-energy -i 1000 -n 60`
  - Idle disk I/O: `sudo fs_usage -w -f filesys -t 60 <pids>`
  - Writer identification: `sudo sample <pid> 10` + `lsof` fd mapping +
    `extension_state.updated_at` diffing
  - Latency: patched `benchtool hotkey <app> cmd+space 50`
  - Network: `nettop -P -x -l 1` before/after deltas
  - Soak: 15-min sampler over 8 h writing per-process footprint, 60 s CPU,
    WAL sizes (script now part of `benchmarks/`).

## Step 1 — Which process is it?

Process group at deep idle, realistic profile (phys_footprint, the Activity
Monitor figure):

| process                             | MB (deep idle) | CPU ms/s | wakeups/s |
| ----------------------------------- | -------------: | -------: | --------: |
| asyar (main, Rust)                  |          193.1 |      3.2 |      17.9 |
| WebContent (launcher)               |            ~70 |      8.1 |       6.9 |
| WebContent (settings, hidden)       |            ~52 |       ~0 |         — |
| WebContent (hud, hidden)            |            ~17 |       ~0 |         — |
| WebKit GPU                          |           14.2 |      0.7 |      10.1 |
| WebKit Networking                   |            7.3 |       ~0 |         — |
| SetStoreUpdateService, audio helper |             ~8 |       ~0 |         — |
| **group total**                     |      **367.0** |  **~12** |   **~35** |

Notes:

- Three WebContent processes exist because tauri.conf declares three windows
  (`main`, `settings`, `hud`). The settings/hud ones keep default WebKit
  occlusion throttling (they are genuinely hidden) and cost ~0 CPU; only the
  launcher webview is unthrottled by design.
- The WebKit GPU process never exits while the launcher is hidden and wakes
  ~10×/s. Its idle CPU is small but its existence is part of the memory tax.
- Sidecars: none in the realistic profile (no MCP servers configured; bun/uv
  only spawn on demand).

## Step 2 — Full metric set

### CPU, by condition (benchtool `cpu`, 30-60 s windows, AC, quiet machine)

| condition                                                                    |     cpu% |
| ---------------------------------------------------------------------------- | -------: |
| bench.sh replica (cold start → 20 s settle → 15 cycles → +5 s → 30 s window) | **1.06** |
| same window, app already 30 min old                                          |     1.07 |
| deep idle, realistic profile (15 min settle)                                 | **0.66** |
| deep idle, enriched 10k profile                                              |     0.58 |
| deep idle, clean profile                                                     | **0.25** |
| first-launch file-index build in progress                                    | **7.27** |
| README claim                                                                 |     3.20 |

The published 3.20% sits between "post-activity" (1.06) and "indexing"
(7.27). It was captured on another machine (M4 Max, macOS 26.5.2, build
0.1.1-38 per `benchmarks/results/table.md` at the time), so exact
reproduction is impossible here — but the protocol overlap with startup
indexing and the 60 s update-check jobs is machine-independent, and on
today's machine the same protocol yields 1.06%. The number is not a
property of today's app at idle.

### Wakeups and energy (deep idle, realistic)

`powermetrics --samplers tasks`, 60 samples: asyar 17.9 wakeups/s,
WebContent 6.9, GPU 10.1 — ~35 wakeups/s for the group at true idle
(52/s in the extended-benchmark run below, which settles only 120 s —
the settling curve is long).

### Fresh side-by-side (extended bench.sh, 2026-08-08, this machine)

Raycast stable is no longer installed here (another reason the July table
cannot be re-verified); Raycast Beta 0.71.3.0 stands in. Full table in
`benchmarks/results/table.md`; highlights:

| metric                                 |     Asyar 0.1.1-40 |                      Raycast Beta |
| -------------------------------------- | -----------------: | --------------------------------: |
| hotkey → visible p50 / p95             | **17.4 / 22.0 ms** |                    39.1 / 42.5 ms |
| keystroke → results painted p50 / p95  |     62.0 / 76.8 ms |           n/a (fixed-size window) |
| CPU 30 s post-activity                 |              1.07% | 97.72% (first-run indexing storm) |
| CPU deep idle (60 s after 120 s quiet) |              0.84% |                             0.76% |
| idle wakeups/s (group)                 |               52.2 |                              49.3 |
| memory deep idle                       |           408.1 MB |                          623.2 MB |
| idle disk write ops / 60 s             |                487 |                                 2 |
| idle network bytes                     |                  0 |                                 0 |

At deep idle on identical protocol, Asyar and Raycast Beta are within noise
of each other on CPU and wakeups, Asyar summons 2.2× faster and uses 35%
less memory — and loses only on idle disk writes (the sdk-playground
finding). The Asyar column is the _unfixed_ installed build; the two fixes
on this branch reduce its main-process wakeups by a further third. Whether
Raycast _stable_ really idles at 0.04% on this hardware is untestable until
it is reinstalled.

Battery-relevant framing: ~35 wakeups/s at near-zero CPU is a scheduler-load
profile, and on Intel machines (no efficiency cores, higher per-wakeup cost)
the same timer census would bite harder. Flagged per finding in the census.

### Idle disk I/O (the most surprising finding)

At deep idle, fs_usage over 60 s recorded ~**250 write ops**: repeated
open→pwrite→fsync cycles on `asyar_data.db-wal` and `search_index.db-wal`
(~23 WAL opens/min). Stack captured mid-write:

```
webview IPC → commands::extension_state::state_set
  → ExtensionStateService::set → rusqlite execute
  → sqlite3 commit → pagerWalFrames → fsync
```

Writer identified by diffing `extension_state.updated_at`: the
**org.asyar.sdk-playground** extension rewrites a ~5 KB `logs.scheduling`
blob **every 10 seconds** — a scheduled extension command running at the
schedule floor (`intervalSeconds` minimum is 10). Because worker iframes
never idle-unmount and the webview is unthrottled, this continues forever
while the launcher is hidden: ~8,640 fsync'd transactions/day from one dev
extension. An SSD-wear and battery cost that scales with installed
extensions, invisible in CPU%.

### Network

`nettop` deltas over idle windows: zero bytes attributable to the app group
at deep idle with no MCP servers and update checks outside the window. The
README's "idle launcher moves zero bytes" claim holds **between** the
update-check ticks (app-update every 6 h, extension-update every 1 h, cloud
sync every 60 s only when signed in — this profile is signed out). A strict
always-zero claim is false once signed in or when an update check fires;
worth a README wording tweak.

### GPU

The WebKit GPU process stays resident and waking (10/s) while hidden. The
static 25 px `backdrop-filter` on the launcher panel is retained but not
repainting at idle (WebContent sample shows no rendering-update loop — only
JS timers and GC). It becomes a multiplier only when something animates: the
status-dot pulse (1.5 s loop) or feedback spinner would force whole-panel
blur recomposition at up to 120 Hz (the 60 fps cap is explicitly removed),
into an unthrottled hidden window.

### Memory

| state                  |    group total | main process |
| ---------------------- | -------------: | -----------: |
| clean profile          | ~350 (settled) |        187.3 |
| realistic (2.2k clips) |          367.0 |        193.1 |
| enriched (10k clips)   |          535.7 |        380.2 |

- ~24 KB of main-process resident memory **per clipboard item** — clipboard
  history is loaded/held in the Rust process. This, not the webview, is the
  scaling term. The fixed webview tax (3 WebContent + GPU + Networking +
  helpers) is ~160-175 MB.
- The published 435.6 MB was measured 5 s after hotkey activity (the
  protocol's `mem` step); I reproduce ~486-490 MB at that same point today
  with the larger current profile, ~367 MB at deep idle. Raycast was measured
  by the same protocol, so the _comparison_ is internally fair; the absolute
  number is a post-activity figure, not idle.
- 50 summon/dismiss cycles: +0.7 MB total (+0.5 MB launcher WebContent) — no
  webview leak. p50/p95/p99 latency across those 50 summons:
  17.5 / 27.0 / 27.8 ms.
- 8-hour soak (15-min sampling): _[filled in from soak.csv — see table below]_

## Step 3 — The timer census

Full table produced by exhaustive source sweep (every periodic execution
source that can run while hidden). Highest-impact entries:

| #   | source                                                                                                           | period                                           | runs hidden? | note                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------ | -------------------------------------------------------------------------------- |
| 1   | FSEvents watch on all of `$HOME`, `latency 0.0` + `NoDefer` (file_index/watcher.rs:227)                          | event-driven, uncoalesced                        | yes          | every home-dir write wakes a thread + 54-glob match; zero kernel batching        |
| 2   | notify-debouncer tick for `/Applications` watcher (application/index_watcher.rs:149, tick_rate=None → timeout/4) | **125 ms**                                       | yes          | allocates two HashMaps per tick, idle or not                                     |
| 3   | per-extension fs-watch debouncer threads (fs_watcher/mod.rs:147)                                                 | 125 ms default (floor 12.5 ms)                   | yes          | one thread per handle; shortcuts extension holds one on `~/Library/Shortcuts/**` |
| 4   | clipboard NSPasteboard changeCount poll (tauri-plugin-clipboard-x → clipboard-rs 0.2.4)                          | **500 ms**                                       | yes          | no macOS change notification exists; poll is required, interval is a choice      |
| 5   | file-index flush thread recv_timeout loop (file_index/watcher.rs:238)                                            | 500 ms                                           | yes          | wakes and drains an empty coalescer                                              |
| 6   | extension_timers SQLite poll (timers/scheduler.rs:36)                                                            | **1 s**                                          | yes          | prepare+query every second **even when the table is empty**                      |
| 7   | extension runtime view/worker ticker (ticker.rs:80)                                                              | 1 s                                              | yes          | 2 mutex locks + lifecycle sweep; also emits events into the webview              |
| 8   | clamshell state via full IOKit registry round-trip (system_events/macos.rs:196)                                  | **2 s**                                          | yes          | polls a value that changes at most twice per lid cycle                           |
| 9   | scheduled extension commands (extensions/scheduler.rs:148)                                                       | ≥10 s                                            | yes          | sdk-playground at the 10 s floor → the idle fsync finding                        |
| 10  | battery snapshot (30 s), shell-gc (60 s), notification-gc/extension-update (1 h), app-update (6 h)               | various                                          | yes          | update checks first fire at +60 s — inside the old benchmark window              |
| 11  | vendored mac-notification-sys wait loop                                                                          | 100 ms per undismissed notification-with-actions | yes          | 10 Hz thread for process lifetime per stuck notification                         |
| 12  | JS: cloud sync 60 s (signed-in only), performanceService report 5 min (unconditional)                            | —                                                | yes          | no visibilitychange gating anywhere in the frontend                              |

Verified absent: rAF loops, self-rescheduling setTimeout, WAL-checkpoint or
DB-maintenance timers, tray-update timers, analytics flush timers, MCP
keepalives. CSS `infinite` animations exist only on conditionally-mounted
elements (status dot, spinners, skeletons) — zero at true idle, expensive if
a run is left active.

The webview parking design (platform/macos/window.rs:305-332): hidden =
alpha 0 + mouse-transparent + **ordered in** + occlusion detection disabled +
60 fps cap removed, explicitly so WebKit keeps the page in the foreground
activity state ("timers tick at true cadence"). Confirmed at runtime by the
app's own launch logs. This buys the 12-17 ms show latency and costs the
~8 ms/s + 7 wakeups/s WebContent baseline (JS timers + GC at full cadence,
no rendering) — the single biggest intentional trade in the idle budget.

## MCP servers

- Zero configured in the realistic profile (the benchmark machine's true
  state, despite the test brief assuming one).
- An enabled-but-broken stdio server costs almost nothing: exactly one
  handshake attempt at startup (~2 s), one warn log, **no retry loop**.
- A healthy `uvx`-based server could not be brought up under the bench build:
  the GUI spawn environment defeats uv's shim (no PATH → `dirname`/`python`
  unresolvable), and a wrapper script was also rejected (suspected
  `shell_trusted_binaries` consent gate). **Open question**: verify the spawn
  path and measure a healthy server's idle cost (expected: one python
  process + a 60 s liveness tick in the supervisor).

## Realistic vs clean diff — summary

State costs ≈ +0.3-0.4 pp idle CPU (extensions with schedules/watches; DB
writes) and scales memory via clipboard count. The 0.25% clean-profile floor
is the app's intrinsic cost: the census pollers + unthrottled webview + GPU
process. Nothing about a 10k clipboard history affects idle CPU.

## What was fixed on this branch

1. **benchtool window-visibility threshold** (100 px → 60 px height, width
   200 → 400): un-breaks every hotkey/coldstart measurement against the
   current 96 px collapsed launcher. Verified: 5-50 run batches complete with
   p50 ≈ 17 ms.
2. **bench.sh extension** (new metrics: deep-idle CPU/memory windows,
   powermetrics wakeups + CPU ms/s, idle disk write ops, idle network bytes,
   hotkey p99; graceful degradation without passwordless sudo; README
   documentation). Syntax-checked and parser-tested; sudo availability is
   probed with a real 100 ms powermetrics run, not `sudo -n true`.
3. **extension_timers poller** — skip the 1 Hz SQLite query entirely while no
   unfired timers exist; an atomic hint set on every insert re-arms polling,
   so behavior with live timers is unchanged.
4. **notify-debouncer tick rate** — explicit tick_rate = debounce window
   (8 Hz → 2 Hz idle ticks for the /Applications watcher and per-extension
   watchers).

Fixes 3+4 verified together, identical conditions (bench build, enriched
profile, 10 min settle, 60 s windows, AC):

|                          |        unfixed |                               fixed |
| ------------------------ | -------------: | ----------------------------------: |
| main-process wakeups/s   |           17.1 |                     **11.5** (−33%) |
| main-process CPU ms/s    |           2.66 |                     **2.15** (−19%) |
| group CPU % (benchtool)  |           0.53 | 0.54 (webview-dominated, unchanged) |
| hotkey→visible p50 / p95 | 14.0 / 19.6 ms |      17.6 / 25.0 and 16.9 / 23.5 ms |

The latency batches sit inside the night's run-to-run band on identical code
(p50 14.0-17.6 ms across five batches), and neither fix touches the show
path: no regression.

## Proposals (need a decision, not committed)

1. **Webview parking vs throttling.** The unthrottled park is a real,
   deliberate latency-for-idle trade. If the ~0.3-0.4%/webview baseline
   matters, options in increasing invasiveness: (a) re-enable occlusion
   detection while hidden and re-disable on the hotkey path just before
   orderFront (needs a latency A/B to prove the 12-17 ms holds); (b) gate
   frontend timers on a visibility event from Rust; (c) let the GPU process
   suspend. Each risks the show-time budget; none attempted per the
   ground rules.
2. **FSEvents coalescing**: `latency 0.0` → 0.3-0.5 s on the `$HOME` watcher
   would batch wakeups at the cost of index freshness measured in hundreds of
   milliseconds. Likely invisible to users; needs a product call.
3. **Clamshell polling → notification**: `IORegisterForSystemPower` events or
   NSWorkspace notifications could replace the 2 s IOKit poll; behavior
   parity (detecting lid state on wake) needs verification.
4. **Schedule floor & state-write amplification**: a 10 s minimum schedule
   with unbounded state writes lets any extension impose ~9k fsyncs/day.
   Consider a coarser floor for hidden-state runs, write coalescing for
   `extension_state.set`, or WAL-checkpoint batching.
5. **README benchmark numbers**: re-run the (now working) benchmark and
   update the table; the current 3.20%/435.6 MB figures misrepresent today's
   app in both directions.

## Open questions

- Why the historical 3.20%: startup-indexing overlap is the best fit but
  unproven for that specific run (no raw log of it survives in
  `benchmarks/results/`).
- Healthy-MCP idle cost (spawn-env issue above).
- keepassxc extension's manifest (`main` field) fails to parse on a
  main-branch build yet the installed 0.1.1-40 accepts it — the installed
  binary and `main` may not be the same source despite identical version
  strings. Worth a version-stamp fix.
- Keystroke→results-painted is now measured black-box via panel-growth
  detection (benchtool `typelatency`): p50 62.0 ms / p95 76.8 ms on the
  installed app. The proxy fires when the window grows, i.e. results
  presentation, not final pixel flush; an in-app perf mark would still be
  the gold standard. Raycast cannot be measured this way (fixed-size
  window).

## macOS 27 beta caveats (affect reproduction, not conclusions)

- Fresh `tauri build` proc-macro dylibs get rejected by the beta dyld
  ("mis-aligned LINKEDIT string pool") when built with
  `MACOSX_DEPLOYMENT_TARGET=13.0`; workaround used: build host artifacts at
  11.0. Not an Asyar bug.
- Webviews die in GUI-launched builds unless signed with a real identity plus
  the repo's entitlements.plist (`--deep` ad-hoc re-signing strips them).
- `KEYCHAIN_SERVICE` is hardcoded to `org.asyar.app` (keystore.rs:25): any
  differently-signed build hangs **forever, pre-window, on the main thread**
  in `SecKeychainFindGenericPassword` waiting for an authorization dialog.
  The bench build was patched (uncommitted) to its own service name. A
  startup timeout around the keychain read would make this failure visible
  instead of a silent hang.

## 8-hour soak

Installed app, real profile, window hidden, AC power, display held awake,
18:59 → 02:43 (464 min), sampled every ~15 min (each tick: per-process
phys_footprint, a 60 s benchtool CPU window, WAL sizes; hourly powermetrics).
Raw data: `benchmarks/results/idle-2026-08-07/soak.csv`.

| t              | total MB | main MB | WebContent Σ MB | cpu% (60 s) |
| -------------- | -------: | ------: | --------------: | ----------: |
| 0 min (launch) |    466.0 |   307.4 |           132.0 |        0.79 |
| 2 h            |    344.1 |   182.4 |           137.4 |        0.74 |
| 4 h            |    348.3 |   182.9 |           141.3 |        0.72 |
| 6 h            |   375.9* |   184.6 |           147.7 |        0.65 |
| 7.7 h (end)    |    378.6 |   184.6 |           150.4 |        0.68 |

\* the +25 MB step at ~t+5.5 h is a transient Apple helper
(`SafariPlatformSupport.Helper`, 18.5 MB) joining the responsibility group at
midnight plus normal webview growth — group composition drifts over time,
which any single-snapshot memory number inherits.

Verdicts:

- **Main (Rust) process: no leak.** Settles from a 307 MB launch transient to
  ~183 MB within 30 min and moves +2.2 MB over the following 7 h.
- **Launcher webview: slow, monotonic ~1.4 MB/h creep** (70 → ~81 MB for the
  launcher WebContent; the settings/hud webviews stay flat). Consistent with
  JS-heap growth under permanent timer activity in the unthrottled hidden
  page; no plateau observed within 8 h. Not dramatic, but it never gets the
  chance to be collected under memory pressure the way a suspended page
  would. A multi-day soak would tell whether it flattens.
- **CPU and wakeups: no drift whatsoever.** 0.65-0.80% all night; hourly
  powermetrics shows the main process at 17.2-17.5 wakeups/s in every single
  hour, WebContent 5.6-7.7/s.
- **Disk: WAL files byte-identical all night** (4051/4289 KB) — the 10 s
  extension state writes recycle WAL frames in place; no unbounded on-disk
  growth at idle. No swap used (0 MB all night).
