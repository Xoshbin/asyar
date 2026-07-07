| Metric                                 | Asyar 0.1.1-34 | Raycast 1.104.21 | Raycast Beta 0.67.1.0 |
| -------------------------------------- | -------------: | ---------------: | --------------------: |
| Hotkey → window visible (median of 15) |        16.2 ms |          20.5 ms |               19.3 ms |
| Hotkey → window visible (p95)          |        18.4 ms |          21.5 ms |               21.6 ms |
| Cold start → usable                    |         406 ms |           889 ms |                928 ms |
| Memory footprint, idle (all processes) |       434.7 MB |         326.2 MB |              477.7 MB |
| CPU while idle (30s average)           |         0.74 % |           1.13 % |      61450278246.85 % |
| App size on disk                       |         384 MB |           133 MB |                178 MB |

<sub>Measured 2026-07-07 on a Apple M4 Max (36 GB RAM), macOS 26.5.2, each app
as installed with default hotkeys, one at a time on a quiet machine. Black-box
measurement: synthetic hotkey press → launcher window on screen. Reproduce with
[`benchmarks/bench.sh`](benchmarks/README.md).</sub>
