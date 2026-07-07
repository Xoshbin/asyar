# Benchmark run 2026-07-07

- Machine: Apple M4 Max, 36 GB RAM, macOS 26.5.2
- Asyar 0.1.1-34 (`/Applications/asyar.app`), hotkey `opt+space`
- Raycast 1.104.21 (`/Applications/Raycast.app`), hotkey `opt+space`
- Raycast Beta 0.67.1.0 (`/Applications/Raycast Beta.app`), hotkey `opt+space`
- 15 hotkey runs, 30s CPU window, 20s settle

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

## Raw output — Asyar 0.1.1-34

```
coldstart_ms=406
run=1 ms=15.5
run=2 ms=12.4
run=3 ms=12.7
run=4 ms=18.3
run=5 ms=17.0
run=6 ms=15.9
run=7 ms=17.3
run=8 ms=16.2
run=9 ms=13.1
run=10 ms=16.0
run=11 ms=18.4
run=12 ms=14.2
run=13 ms=16.6
run=14 ms=16.3
run=15 ms=21.9
median_ms=16.2
p95_ms=18.4
min_ms=12.4
process pid=88830 mb=148.5 name=asyar
process pid=88831 mb=18.7 name=com.apple.WebKit.GPU
process pid=88832 mb=6.2 name=com.apple.WebKit.Networking
process pid=88833 mb=140.7 name=com.apple.WebKit.WebContent
process pid=88834 mb=87.5 name=com.apple.WebKit.WebContent
process pid=88835 mb=18.5 name=com.apple.WebKit.WebContent
process pid=88836 mb=5.2 name=com.apple.audio.SandboxHelper
process pid=88849 mb=9.4 name=com.apple.SafariPlatformSupport.Helper
process_count=8
total_mb=434.7
cpu_pct=0.74
size_mb=384
```

## Raw output — Raycast 1.104.21

```
coldstart_ms=889
run=1 ms=17.2
run=2 ms=15.6
run=3 ms=20.2
run=4 ms=17.7
run=5 ms=21.0
run=6 ms=20.5
run=7 ms=21.4
run=8 ms=18.6
run=9 ms=18.9
run=10 ms=21.5
run=11 ms=21.0
run=12 ms=22.7
run=13 ms=17.2
run=14 ms=20.6
run=15 ms=21.3
median_ms=20.5
p95_ms=21.5
min_ms=15.6
process pid=89068 mb=175.6 name=Raycast
process pid=89087 mb=9.7 name=com.apple.SafariPlatformSupport.Helper
process pid=89108 mb=90.1 name=ollama
process pid=89113 mb=5.6 name=com.apple.WebKit.GPU
process pid=89114 mb=7.3 name=com.apple.WebKit.Networking
process pid=89115 mb=32.7 name=com.apple.WebKit.WebContent
process pid=89116 mb=5.2 name=com.apple.audio.SandboxHelper
process_count=7
total_mb=326.2
cpu_pct=1.13
size_mb=133
```

## Raw output — Raycast Beta 0.67.1.0

```
coldstart_ms=928
run=1 ms=19.3
run=2 ms=21.1
run=3 ms=18.8
run=4 ms=19.2
run=5 ms=18.0
run=6 ms=14.2
run=7 ms=17.0
run=8 ms=19.4
run=9 ms=21.6
run=10 ms=15.9
run=11 ms=23.1
run=12 ms=20.7
run=13 ms=19.4
run=14 ms=16.7
run=15 ms=20.7
median_ms=19.3
p95_ms=21.6
min_ms=14.2
process pid=89248 mb=46.6 name=Raycast Beta
process pid=89251 mb=18.9 name=com.apple.WebKit.GPU
process pid=89252 mb=15.7 name=com.apple.WebKit.Networking
process pid=89254 mb=247.5 name=node
process pid=89255 mb=5.3 name=com.apple.audio.SandboxHelper
process pid=89256 mb=3.2 name=com.raycast-x.macos.Accessibility
process pid=89257 mb=4.6 name=com.raycast-x.macos.Pasteboard
process pid=89271 mb=135.9 name=com.apple.WebKit.WebContent
process_count=8
total_mb=477.7
cpu_pct=61450278246.85
size_mb=178
```
