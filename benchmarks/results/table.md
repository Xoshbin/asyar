| Metric                                 | Asyar 0.1.1-35 | Raycast 1.104.21 | Raycast Beta 0.67.1.0 |
| -------------------------------------- | -------------: | ---------------: | --------------------: |
| Hotkey → window visible (median of 15) |        14.9 ms |          18.6 ms |               21.1 ms |
| Hotkey → window visible (p95)          |        19.2 ms |          20.3 ms |               25.2 ms |
| Cold start → usable                    |         451 ms |          1097 ms |               1392 ms |
| Memory footprint, idle (all processes) |       486.6 MB |         244.4 MB |              543.3 MB |
| CPU while idle (30s average)           |         0.30 % |           6.63 % |                4.45 % |
| App size on disk                       |         391 MB |           133 MB |                178 MB |

<sub>Measured 2026-07-09 on a Apple M4 Max (36 GB RAM), macOS 26.5.2, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>
