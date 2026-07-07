# Benchmarks: Asyar vs Raycast

Reproducible, black-box performance comparison between Asyar and Raycast —
both stable Raycast (v1) and Raycast Beta (the v2 rewrite) — on macOS.
"Black-box" means every app is measured the same way from the outside — no
instrumentation inside Asyar that Raycast wouldn't have.

```
                 ┌─────────────────────────────────────────────┐
   bench.sh ───▶ │ 1. cold start   open app ──▶ window usable  │
   (one app      │ 2. hotkey       ⌥Space ──▶ window on screen │──▶ results/latest.md
    at a time)   │ 3. memory       app + ALL helper processes  │──▶ README table
                 │ 4. idle CPU     30 s average                │
                 │ 5. disk size    du -sm App.app              │
                 └─────────────────────────────────────────────┘
```

## What is measured, and how

| Metric                      | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hotkey → window visible** | A synthetic hotkey press (`CGEvent`) is posted, then the window list (`CGWindowListCopyWindowInfo`) is polled until a launcher-sized window owned by the app is on screen. Between runs the window is dismissed with Esc — re-pressing the hotkey is not reliable, because Raycast v1 types a focused synthetic ⌥Space into its search field as text instead of toggling. A run only starts once the window is verified hidden. Median and p95 of 15 runs. Resolution is ≈1–3 ms (window-server poll cost). |
| **Cold start → usable**     | App is fully quit, then launched with `open`. The hotkey is pressed repeatedly until the launcher window appears — so this measures "launch → you can actually use it", not "process exists".                                                                                                                                                                                                                                                                                                               |
| **Memory footprint**        | `phys_footprint` (the Activity Monitor "Memory" column) summed over the app's **whole process group**: the main process plus every WebKit/XPC helper the OS attributes to it via the responsible-process mechanism. This is fair to both sides — Raycast's node extension host and Asyar's WebKit processes are both counted.                                                                                                                                                                               |
| **CPU while idle**          | User+system CPU time of the process group sampled over 30 s with the launcher hidden, as a percentage of one core.                                                                                                                                                                                                                                                                                                                                                                                          |
| **App size on disk**        | `du -sm` of the installed bundle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Running it

```bash
./benchmarks/bench.sh                  # interactive, ~4-5 minutes
./benchmarks/bench.sh --update-readme  # also refresh the table in the root README
```

Defaults assume `/Applications/asyar.app` and `/Applications/Raycast.app`.
If `/Applications/Raycast Beta.app` (Raycast v2) is installed, it is
benchmarked too, automatically. All hotkeys default to `⌥Space` (each app's
factory default — the apps never run at the same time, so the shared hotkey
is fine). Override with `--asyar-hotkey` / `--raycast-hotkey` /
`--raycast-beta-hotkey` (e.g. `cmd+space`) if your setup differs. **Each
hotkey must match what that app is actually bound to**, or its runs will
time out.

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
   match reality.

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
  passed, or another launcher owns the key. Launchers cannot share one
  global hotkey: with Asyar, Raycast, and Raycast Beta on one machine, only
  one of them owns `⌥Space` at a time. Open each app's settings, register a
  unique hotkey, and pass the matching `--…-hotkey` flags. Which key you use
  does not change the timing, so this stays fair.
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
  start → settle → hotkey runs → memory → idle CPU → quit; then renders
  the report.
