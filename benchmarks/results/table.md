| Metric                                 | Asyar 0.1.1-38 | Raycast 1.104.23 | Raycast Beta 0.69.0.0 |
| -------------------------------------- | -------------: | ---------------: | --------------------: |
| Hotkey → window visible (median of 15) |        12.0 ms |          21.7 ms |               17.1 ms |
| Hotkey → window visible (p95)          |        14.7 ms |          24.0 ms |               27.0 ms |
| Cold start → usable                    |         572 ms |           888 ms |               1012 ms |
| Memory footprint, idle (all processes) |       435.6 MB |         272.6 MB |              463.9 MB |
| CPU while idle (30s average)           |         3.20 % |           0.04 % |                1.45 % |
| App size on disk                       |          64 MB |           209 MB |                179 MB |

<sub>Measured 2026-07-17 on a Apple M4 Max (36 GB RAM), macOS 26.5.2, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>
