| Metric                                 | Asyar 0.1.1-34 | Raycast 1.104.21 | Raycast Beta 0.67.1.0 |
| -------------------------------------- | -------------: | ---------------: | --------------------: |
| Hotkey → window visible (median of 15) |        18.6 ms |          18.1 ms |               21.0 ms |
| Hotkey → window visible (p95)          |        23.0 ms |          22.1 ms |               24.3 ms |
| Cold start → usable                    |         427 ms |           906 ms |                964 ms |
| Memory footprint, idle (all processes) |       431.8 MB |         308.0 MB |              484.4 MB |
| CPU while idle (30s average)           |         0.75 % |           1.13 % |                4.15 % |
| App size on disk                       |         384 MB |           133 MB |                178 MB |

<sub>Measured 2026-07-07 on a Apple M4 Max (36 GB RAM), macOS 26.5.2, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>
