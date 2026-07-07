# Benchmarks: Asyar vs Raycast

Reproducible, black-box performance comparison between Asyar and Raycast
on macOS. "Black-box" means both apps are measured the same way from the
outside — no instrumentation inside Asyar that Raycast wouldn't have.

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

| Metric                      | How                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hotkey → window visible** | A synthetic hotkey press (`CGEvent`) is posted, then the window list (`CGWindowListCopyWindowInfo`) is polled until a launcher-sized window owned by the app is on screen. Median and p95 of 15 runs. Resolution is ≈1–3 ms (window-server poll cost).                                                                        |
| **Cold start → usable**     | App is fully quit, then launched with `open`. The hotkey is pressed repeatedly until the launcher window appears — so this measures "launch → you can actually use it", not "process exists".                                                                                                                                 |
| **Memory footprint**        | `phys_footprint` (the Activity Monitor "Memory" column) summed over the app's **whole process group**: the main process plus every WebKit/XPC helper the OS attributes to it via the responsible-process mechanism. This is fair to both sides — Raycast's node extension host and Asyar's WebKit processes are both counted. |
| **CPU while idle**          | User+system CPU time of the process group sampled over 30 s with the launcher hidden, as a percentage of one core.                                                                                                                                                                                                            |
| **App size on disk**        | `du -sm` of the installed bundle.                                                                                                                                                                                                                                                                                             |

## Running it

```bash
./benchmarks/bench.sh                  # interactive, ~4-5 minutes
./benchmarks/bench.sh --update-readme  # also refresh the table in the root README
```

Defaults assume `/Applications/asyar.app` and `/Applications/Raycast.app`,
both bound to `⌥Space` (each app's factory default — they never run at the
same time, so the shared hotkey is fine). Override with
`--asyar-hotkey` / `--raycast-hotkey` (e.g. `cmd+space`) if your setup
differs. **The hotkey you pass must match what the app is actually bound
to**, or runs will time out.

### Prerequisites

1. **Accessibility permission** for your terminal
   (System Settings → Privacy & Security → Accessibility) — needed to post
   synthetic key presses. The script prompts on first run.
2. **A quiet machine**: plugged in, other heavy apps closed, no builds
   running. Don't touch the keyboard/mouse during the run.
3. **Release builds only.** The script refuses to run while a
   `target/debug` Asyar is alive — dev builds are unrepresentative and
   their helper processes can't be attributed correctly.
4. Quit **Raycast Beta** if installed (the script does this for you).

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

## Outputs

- `results/latest.md` — full report: environment, per-run latencies,
  per-process memory, raw tool output.
- `results/table.md` — just the Markdown table.
- `--update-readme` splices the table into the root `README.md` between
  the `<!-- benchmarks:start -->` / `<!-- benchmarks:end -->` markers.

## Files

- `benchtool.swift` — the measurement tool (compiled on first run to
  `.build/benchtool`; no dependencies beyond Xcode command-line tools).
- `bench.sh` — orchestrates the protocol: quit both → per app: cold
  start → settle → hotkey runs → memory → idle CPU → quit; then renders
  the report.
