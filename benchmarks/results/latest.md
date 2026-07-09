# Benchmark run 2026-07-09

- Machine: Apple M4 Max, 36 GB RAM, macOS 26.5.2
- Asyar 0.1.1-35 (`/Applications/asyar.app`), hotkey `opt+space`
- Raycast 1.104.21 (`/Applications/Raycast.app`), hotkey `opt+space`
- Raycast Beta 0.67.1.0 (`/Applications/Raycast Beta.app`), hotkey `opt+space`
- 15 hotkey runs, 30s CPU window, 20s settle

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

## Raw output — Asyar 0.1.1-35

```
coldstart_ms=451
run=1 ms=18.6
run=2 ms=13.3
run=3 ms=13.2
run=4 ms=16.2
run=5 ms=14.9
run=6 ms=12.5
run=7 ms=19.2
run=8 ms=13.6
run=9 ms=10.8
run=10 ms=18.7
run=11 ms=12.7
run=12 ms=17.4
run=13 ms=20.3
run=14 ms=14.0
run=15 ms=19.0
median_ms=14.9
p95_ms=19.2
min_ms=10.8
process pid=36523 mb=150.5 name=asyar
process pid=36525 mb=19.1 name=com.apple.WebKit.GPU
process pid=36526 mb=6.1 name=com.apple.WebKit.Networking
process pid=36527 mb=135.3 name=com.apple.WebKit.WebContent
process pid=36528 mb=85.7 name=com.apple.WebKit.WebContent
process pid=36529 mb=75.2 name=com.apple.WebKit.WebContent
process pid=36535 mb=5.2 name=com.apple.audio.SandboxHelper
process pid=36549 mb=9.5 name=com.apple.SafariPlatformSupport.Helper
process_count=8
total_mb=486.6
cpu_pct=0.30
size_mb=391
```

## Raw output — Raycast 1.104.21

```
coldstart_ms=1097
run=1 ms=15.0
run=2 ms=17.0
run=3 ms=18.7
run=4 ms=18.6
run=5 ms=18.7
run=6 ms=20.3
run=7 ms=19.7
run=8 ms=19.2
run=9 ms=23.7
run=10 ms=19.1
run=11 ms=15.9
run=12 ms=18.5
run=13 ms=16.3
run=14 ms=18.0
run=15 ms=11.3
median_ms=18.6
p95_ms=20.3
min_ms=11.3
process pid=36665 mb=184.4 name=Raycast
process pid=36687 mb=9.6 name=com.apple.SafariPlatformSupport.Helper
process pid=36708 mb=5.6 name=com.apple.WebKit.GPU
process pid=36709 mb=7.1 name=com.apple.WebKit.Networking
process pid=36710 mb=32.4 name=com.apple.WebKit.WebContent
process pid=36712 mb=5.3 name=com.apple.audio.SandboxHelper
process_count=6
total_mb=244.4
cpu_pct=6.63
size_mb=133
```

## Raw output — Raycast Beta 0.67.1.0

```
coldstart_ms=1392
run=1 ms=27.7
run=2 ms=25.2
run=3 ms=20.7
run=4 ms=23.2
run=5 ms=20.0
run=6 ms=14.4
run=7 ms=19.6
run=8 ms=19.2
run=9 ms=23.5
run=10 ms=20.2
run=11 ms=24.8
run=12 ms=24.2
run=13 ms=21.1
run=14 ms=23.4
run=15 ms=16.7
median_ms=21.1
p95_ms=25.2
min_ms=14.4
process pid=37054 mb=43.7 name=Raycast Beta
process pid=37057 mb=18.6 name=com.apple.WebKit.GPU
process pid=37058 mb=15.5 name=com.apple.WebKit.Networking
process pid=37059 mb=139.1 name=com.apple.WebKit.WebContent
process pid=37060 mb=315.7 name=node
process pid=37061 mb=3.0 name=com.apple.audio.SandboxHelper
process pid=37064 mb=3.2 name=com.raycast-x.macos.Accessibility
process pid=37065 mb=4.6 name=com.raycast-x.macos.Pasteboard
process_count=8
total_mb=543.3
cpu_pct=4.45
size_mb=178
```
