| Metric                                 | Asyar 0.1.1-49 | Raycast 2.6.2.0 |
| -------------------------------------- | -------------: | --------------: |
| Hotkey → window visible (median of 15) |        13.9 ms |         22.2 ms |
| Hotkey → window visible (p95)          |        17.3 ms |         32.0 ms |
| Hotkey → window visible (p99)          |        20.5 ms |         32.5 ms |
| Keystroke → results painted (p50)      |            n/a |             n/a |
| Keystroke → results painted (p95)      |            n/a |             n/a |
| Cold start → usable                    |         585 ms |         2129 ms |
| Memory footprint, idle (all processes) |       419.2 MB |        451.5 MB |
| CPU while idle (30s average)           |         0.64 % |          1.44 % |
| CPU deep idle (60s, after 120s quiet)  |         0.10 % |          1.41 % |
| Memory deep idle                       |       664.4 MB |        680.4 MB |
| CPU ms/s (powermetrics, deep idle)     |           1.02 |           13.92 |
| Idle wakeups/s (deep idle)             |          11.82 |           46.33 |
| Idle disk write ops (60s)              |              0 |              96 |
| App size on disk                       |          68 MB |          223 MB |

<sub>Measured 2026-10-04 on a Apple M4 Max (36 GB RAM), macOS 27.0.1, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>
