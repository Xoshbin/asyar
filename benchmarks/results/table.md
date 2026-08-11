| Metric                                 | Asyar 0.1.1-40 | Raycast Beta 0.71.3.0 |
| -------------------------------------- | -------------: | --------------------: |
| Hotkey → window visible (median of 15) |        17.4 ms |               39.1 ms |
| Hotkey → window visible (p95)          |        22.0 ms |               42.5 ms |
| Hotkey → window visible (p99)          |        23.8 ms |               43.2 ms |
| Keystroke → results painted (p50)      |        62.0 ms |                   n/a |
| Keystroke → results painted (p95)      |        76.8 ms |                   n/a |
| Cold start → usable                    |        1577 ms |               1199 ms |
| Memory footprint, idle (all processes) |       494.9 MB |             1121.7 MB |
| CPU while idle (30s average)           |         1.07 % |               97.72 % |
| CPU deep idle (60s, after 120s quiet)  |         0.84 % |                0.76 % |
| Memory deep idle                       |       408.1 MB |              623.2 MB |
| CPU ms/s (powermetrics, deep idle)     |           8.32 |                  7.61 |
| Idle wakeups/s (deep idle)             |          52.22 |                 49.27 |
| Idle disk write ops (60s)              |            487 |                     2 |
| Idle network bytes in (60s)            |              0 |                     0 |
| Idle network bytes out (60s)           |              0 |                     0 |
| App size on disk                       |          65 MB |                184 MB |

<sub>Measured 2026-08-08 on a Apple M3 (16 GB RAM), macOS 27.0 beta, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine on AC power. Raycast Beta's post-activity CPU/memory reflect a
first-run indexing storm (97.7%); its deep-idle row is the comparable figure.
Keystroke→results uses panel-growth detection, n/a for fixed-size windows.
Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>
