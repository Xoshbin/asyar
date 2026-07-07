| Metric                                 | Asyar 0.1.1-34 | Raycast 1.104.21 | Raycast Beta 0.67.1.0 |
| -------------------------------------- | -------------: | ---------------: | --------------------: |
| Hotkey → window visible (median of 15) |        15.8 ms |          18.4 ms |               16.5 ms |
| Hotkey → window visible (p95)          |        19.5 ms |          21.1 ms |               26.6 ms |
| Cold start → usable                    |         559 ms |           894 ms |                942 ms |
| Memory footprint, idle (all processes) |       426.1 MB |         294.7 MB |              486.0 MB |
| CPU while idle (30s average)           |         0.72 % |           1.12 % |                1.92 % |
| App size on disk                       |         384 MB |           133 MB |                178 MB |

<sub>Measured 2026-07-07 on a Apple M4 Max (36 GB RAM), macOS 26.5.2, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>
