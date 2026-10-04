| Metric                                 | Asyar 0.1.1-49 | Raycast 2.6.2.0 |
| -------------------------------------- | -------------: | --------------: |
| Hotkey → window visible (median of 15) |        18.0 ms |         21.7 ms |
| Hotkey → window visible (p95)          |        21.7 ms |         24.9 ms |
| Hotkey → window visible (p99)          |        22.4 ms |         27.5 ms |
| Keystroke → results painted (p50)      |            n/a |             n/a |
| Keystroke → results painted (p95)      |            n/a |             n/a |
| Cold start → usable                    |        1363 ms |         1747 ms |
| Memory footprint, idle (all processes) |       429.8 MB |        447.4 MB |
| CPU while idle (30s average)           |         0.94 % |          1.53 % |
| CPU deep idle (60s, after 120s quiet)  |         0.42 % |          1.33 % |
| Memory deep idle                       |       620.8 MB |        669.2 MB |
| CPU ms/s (powermetrics, deep idle)     |            n/a |             n/a |
| Idle wakeups/s (deep idle)             |            n/a |             n/a |
| Idle disk write ops (60s)              |            n/a |             n/a |
| Idle network bytes in (60s)            |           3983 |               0 |
| Idle network bytes out (60s)           |           1151 |               0 |
| App size on disk                       |          68 MB |          223 MB |

<sub>Measured 2026-10-04 on a Apple M4 Max (36 GB RAM), macOS 27.0.1, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>
