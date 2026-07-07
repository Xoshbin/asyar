# Benchmark run 2026-07-07

- Machine: Apple M4 Max, 36 GB RAM, macOS 26.5.2
- Asyar 0.1.1-34 (`/Applications/asyar.app`), hotkey `opt+space`
- Raycast 1.104.21 (`/Applications/Raycast.app`), hotkey `opt+space`
- Raycast Beta 0.67.1.0 (`/Applications/Raycast Beta.app`), hotkey `opt+space`
- 15 hotkey runs, 30s CPU window, 20s settle

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

## Raw output — Asyar 0.1.1-34

```
coldstart_ms=559
run=1 ms=19.5
run=2 ms=19.3
run=3 ms=14.9
run=4 ms=16.2
run=5 ms=15.2
run=6 ms=15.2
run=7 ms=17.2
run=8 ms=15.8
run=9 ms=16.3
run=10 ms=15.6
run=11 ms=19.2
run=12 ms=20.5
run=13 ms=13.5
run=14 ms=9.0
run=15 ms=15.0
median_ms=15.8
p95_ms=19.5
min_ms=9.0
process pid=94684 mb=148.4 name=asyar
process pid=94686 mb=18.7 name=com.apple.WebKit.GPU
process pid=94687 mb=6.4 name=com.apple.WebKit.Networking
process pid=94688 mb=134.5 name=com.apple.WebKit.WebContent
process pid=94689 mb=85.1 name=com.apple.WebKit.WebContent
process pid=94690 mb=18.4 name=com.apple.WebKit.WebContent
process pid=94691 mb=5.2 name=com.apple.audio.SandboxHelper
process pid=94701 mb=9.4 name=com.apple.SafariPlatformSupport.Helper
process_count=8
total_mb=426.1
cpu_pct=0.72
size_mb=384
```

## Raw output — Raycast 1.104.21

```
coldstart_ms=894
run=1 ms=21.1
run=2 ms=17.4
run=3 ms=20.0
run=4 ms=16.0
run=5 ms=17.2
run=6 ms=14.4
run=7 ms=19.5
run=8 ms=17.8
run=9 ms=16.9
run=10 ms=22.8
run=11 ms=20.9
run=12 ms=19.9
run=13 ms=18.4
run=14 ms=14.7
run=15 ms=19.3
median_ms=18.4
p95_ms=21.1
min_ms=14.4
process pid=94919 mb=185.2 name=Raycast
process pid=94941 mb=9.9 name=com.apple.SafariPlatformSupport.Helper
process pid=94960 mb=49.1 name=ollama
process pid=94965 mb=5.6 name=com.apple.WebKit.GPU
process pid=94966 mb=7.2 name=com.apple.WebKit.Networking
process pid=94967 mb=32.5 name=com.apple.WebKit.WebContent
process pid=94970 mb=5.2 name=com.apple.audio.SandboxHelper
process_count=7
total_mb=294.7
cpu_pct=1.12
size_mb=133
```

## Raw output — Raycast Beta 0.67.1.0

```
coldstart_ms=942
run=1 ms=17.9
run=2 ms=24.1
run=3 ms=15.5
run=4 ms=15.6
run=5 ms=26.6
run=6 ms=16.0
run=7 ms=29.4
run=8 ms=16.5
run=9 ms=20.1
run=10 ms=16.0
run=11 ms=20.4
run=12 ms=15.8
run=13 ms=15.1
run=14 ms=23.4
run=15 ms=15.3
median_ms=16.5
p95_ms=26.6
min_ms=15.1
process pid=95102 mb=44.6 name=Raycast Beta
process pid=95105 mb=18.8 name=com.apple.WebKit.GPU
process pid=95106 mb=15.7 name=com.apple.WebKit.Networking
process pid=95108 mb=236.9 name=node
process pid=95109 mb=5.2 name=com.apple.audio.SandboxHelper
process pid=95110 mb=3.2 name=com.raycast-x.macos.Accessibility
process pid=95111 mb=4.7 name=com.raycast-x.macos.Pasteboard
process pid=95133 mb=157.0 name=com.apple.WebKit.WebContent
process_count=8
total_mb=486.0
cpu_pct=1.92
size_mb=178
```
