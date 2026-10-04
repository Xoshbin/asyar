| Metric                                 | Asyar 0.1.1-49 | Raycast 1.104.31 | Raycast Beta 0.71.7.0 |
| -------------------------------------- | -------------: | ---------------: | --------------------: |
| Hotkey → window visible (median of 15) |        12.0 ms |          30.6 ms |               22.9 ms |
| Hotkey → window visible (p95)          |        16.6 ms |          42.3 ms |               33.7 ms |
| Hotkey → window visible (p99)          |        21.1 ms |          43.0 ms |               35.1 ms |
| Keystroke → results painted (p50)      |            n/a |              n/a |                   n/a |
| Keystroke → results painted (p95)      |            n/a |              n/a |                   n/a |
| Cold start → usable                    |         750 ms |          1289 ms |               1195 ms |
| Memory footprint, idle (all processes) |       499.0 MB |         142.4 MB |              464.5 MB |
| CPU while idle (30s average)           |         1.06 % |           0.05 % |                1.34 % |
| CPU deep idle (60s, after 120s quiet)  |         0.65 % |           0.05 % |                1.05 % |
| Memory deep idle                       |       632.0 MB |         148.6 MB |              784.5 MB |
| CPU ms/s (powermetrics, deep idle)     |            n/a |              n/a |                   n/a |
| Idle wakeups/s (deep idle)             |            n/a |              n/a |                   n/a |
| Idle disk write ops (60s)              |            n/a |              n/a |                   n/a |
| Idle network bytes in (60s)            |           4017 |                0 |                     0 |
| Idle network bytes out (60s)           |           1151 |                0 |                     0 |
| App size on disk                       |          68 MB |           133 MB |                184 MB |

<sub>Measured 2026-10-04 on a Apple M4 Max (36 GB RAM), macOS 27.0.1, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>
