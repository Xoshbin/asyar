# Benchmarks: Asyar vs Raycast

Reproducible, black-box performance comparison between Asyar and Raycast —
both stable Raycast (v1) and Raycast Beta (the v2 rewrite) — on macOS.
"Black-box" means every app is measured the same way from the outside — no
instrumentation inside Asyar that Raycast wouldn't have.

```
                 ┌─────────────────────────────────────────────┐
   bench.sh ───▶ │ 1. cold start   open app ──▶ window usable  │
   (one app      │ 2. hotkey       ⌥Space ──▶ window on screen │──▶ results/latest.md
    at a time)   │ 3. post-activity CPU + memory               │──▶ README table
                 │ 4. deep idle    CPU, memory, wakeups, I/O   │
                 │ 5. disk size    du -sm App.app              │
                 └─────────────────────────────────────────────┘
```

## What is measured, and how

| Metric                        | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hotkey → window visible**   | A synthetic hotkey press (`CGEvent`) is posted, then the window list (`CGWindowListCopyWindowInfo`) is polled until a launcher-sized window owned by the app is on screen. Between runs the window is dismissed with Esc — re-pressing the hotkey is not reliable, because Raycast v1 types a focused synthetic ⌥Space into its search field as text instead of toggling. A run only starts once the window is verified hidden. Median, p95, and p99 of 15 runs are reported, together with the complete comma-separated sample list. Resolution is ≈1–3 ms (window-server poll cost). |
| **Cold start → usable**       | App is fully quit, then launched with `open`. The hotkey is pressed repeatedly until the launcher window appears — so this measures "launch → you can actually use it", not "process exists".                                                                                                                                                                                                                                                                                                                                                                                          |
| **Memory footprint**          | `phys_footprint` (the Activity Monitor "Memory" column) summed over the app's **whole process group**: the main process plus every WebKit/XPC helper the OS attributes to it via the responsible-process mechanism. This is fair to both sides — Raycast's node extension host and Asyar's WebKit processes are both counted. Memory is captured once after hotkey activity and again during deep idle.                                                                                                                                                                                |
| **CPU after activity**        | User+system CPU time of the process group sampled over 30 s with the launcher hidden, shortly after the hotkey runs. This preserves the legacy "CPU while idle" metric while distinguishing it from deep idle. CPU percentages are percentages of one core.                                                                                                                                                                                                                                                                                                                            |
| **Deep-idle CPU and wakeups** | After a 120 s quiet settling period, CPU is sampled for 60 s. `benchtool cpu` reports process-group CPU percentage. When optional passwordless `sudo` is available, the `powermetrics` tasks sampler also reports process-group CPU ms/s and interrupt wakeups/s, averaged across its one-second samples.                                                                                                                                                                                                                                                                              |
| **Deep-idle disk writes**     | During the same 60 s window, optional `fs_usage` collection counts `write`, `pwrite`, `WrData`, and `WrMeta` calls by the process group, plus the number of distinct absolute paths touched.                                                                                                                                                                                                                                                                                                                                                                                           |
| **Keystroke → results**       | After summoning the launcher, one character is typed synthetically and the time until the launcher window's height changes is measured (300 µs polling of `CGWindowList` bounds). This works because Asyar presents results by growing its collapsed 96 px panel; launchers with a fixed-size window (Raycast) cannot be measured this way and report `n/a`. A proxy for "results painted", measurable black-box on the shipping app.                                                                                                                                                  |
| **Deep-idle network**         | Unprivileged `nettop -P -x -l 1` snapshots before and after the deep-idle CPU window provide per-process-group byte deltas in each direction.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **App size on disk**          | `du -sm` of the installed bundle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Running it

```bash
./benchmarks/bench.sh                  # interactive, ~4-6 minutes per app
./benchmarks/bench.sh --update-readme  # also refresh the table in the root README
./benchmarks/bench.sh --asyar dev      # build and test this checkout's local release bundle
```

Defaults assume `/Applications/asyar.app` and `/Applications/Raycast.app`.
Use `--asyar dev` to build the current checkout with `pnpm build -- --local`
and test the resulting release bundle. It is a release build, but uses the
isolated `Asyar Dev` bundle (`org.asyar.dev`): its dev marker, profile,
keychain entry, and default `Option-Space` shortcut are separate from the
installed app. The terminal and report label it as `local worktree <revision>`
and note any compiled uncommitted changes. This is suitable for local
comparisons against Raycast, but deliberately cannot be combined with
`--update-readme`.
If `/Applications/Raycast Beta.app` (Raycast v2) is installed, it is
benchmarked too, automatically. All hotkeys default to `⌥Space` (each app's
factory default — the apps never run at the same time, so the shared hotkey
is fine). Override with `--asyar-hotkey` / `--raycast-hotkey` /
`--raycast-beta-hotkey` (e.g. `cmd+space`) if your setup differs. **Each
hotkey must match what that app is actually bound to**, or its runs will
time out.

The deep-idle defaults can be changed independently:

```bash
./benchmarks/bench.sh --deep-settle 120 --deep-idle-seconds 60
```

`--deep-settle N` controls the quiet period after the legacy post-activity
CPU window. `--deep-idle-seconds N` controls the later CPU, `powermetrics`,
`fs_usage`, and network measurement window.

### Prerequisites

1. **Accessibility permission** for your terminal
   (System Settings → Privacy & Security → Accessibility) — needed to post
   synthetic key presses. The script prompts on first run.
2. **A quiet machine**: plugged in, other heavy apps closed, no builds
   running. Don't touch the keyboard/mouse during the run.
3. **Release builds only.** The script refuses to run while a
   `target/debug` Asyar is alive — dev builds are unrepresentative and
   their helper processes can't be attributed correctly.
4. **A hotkey registered in every app.** Open each app's settings and
   confirm the hotkey is actually set — app updates can silently clear it.
   The script lists the app → hotkey pairs before starting; make sure they
   match reality. On an interactive run, a failed cold-start check prompts
   for the correct key and retries that app; `--yes` fails immediately.

## Fairness rules

- Both apps measured **one at a time**, same machine, same session,
  identical procedure and identical measurement code.
- Whole process groups are counted, so neither side hides memory in
  helper processes.
- Raycast is measured **as installed** — the extensions you have (and
  Asyar's, too) affect memory and cold start. For publishable numbers,
  use fresh/default-ish configurations and say so.
- Raycast is closed source, so external observation is the only option;
  everything here observes both apps externally.
- Published numbers must state date, hardware, macOS and app versions —
  `bench.sh` embeds all of that in the generated table automatically.

## Troubleshooting

- **"the hotkey does not summon it" / runs time out** — the app has **no
  hotkey registered at all** (updates and beta installs can silently clear
  it — this really happens), or it is bound to a different key than you
  passed, or another launcher owns the key. The interactive script asks for
  the matching key and retries; with `--yes`, pass the matching
  `--…-hotkey` flag. Which key you use does not change the timing, so this
  stays fair.
- **Cold start passes but the hotkey phase fails** — some apps (Raycast)
  show a window by themselves on manual launch, which can mask a wrong
  hotkey. The tool verifies the hotkey with one toggle right after cold
  start, so a wrong hotkey now fails fast with a clear message instead of
  timing out on every run.

## Outputs

- `results/latest.md` — full report: environment, per-run latencies,
  per-process memory, raw tool output.
- `results/table.md` — just the Markdown table (one column per app).
- `results/raw-<app>.txt` — raw tool output per app (gitignored).
- `--update-readme` splices the table into the root `README.md` between
  the `<!-- benchmarks:start -->` / `<!-- benchmarks:end -->` markers.

## Files

- `benchtool.swift` — the measurement tool (compiled on first run to
  `.build/benchtool`; no dependencies beyond Xcode command-line tools).
- `bench.sh` — orchestrates the protocol: quit both → per app: cold
  start → settle → hotkey runs → post-activity memory and CPU → deep settle →
  deep-idle metrics → quit; then renders the report.
