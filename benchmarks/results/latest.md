# Benchmark run 2026-07-17

- Machine: Apple M4 Max, 36 GB RAM, macOS 26.5.2
- Asyar 0.1.1-38 (`/Applications/asyar.app`), hotkey `opt+space`
- Raycast 1.104.23 (`/Applications/Raycast.app`), hotkey `opt+space`
- Raycast Beta 0.69.0.0 (`/Applications/Raycast Beta.app`), hotkey `opt+space`
- 15 hotkey runs, 30s CPU window, 20s settle

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

## Raw output — Asyar 0.1.1-38

```
coldstart_ms=572
run=1 ms=11.6
run=2 ms=10.9
run=3 ms=11.1
run=4 ms=11.7
run=5 ms=14.1
run=6 ms=12.8
run=7 ms=11.0
run=8 ms=14.4
run=9 ms=14.2
run=10 ms=11.3
run=11 ms=12.0
run=12 ms=15.7
run=13 ms=14.7
run=14 ms=13.3
run=15 ms=11.9
median_ms=12.0
p95_ms=14.7
min_ms=10.9
process pid=48873 mb=241.3 name=asyar
process pid=48874 mb=19.5 name=com.apple.WebKit.GPU
process pid=48875 mb=6.2 name=com.apple.WebKit.Networking
process pid=48876 mb=95.5 name=com.apple.WebKit.WebContent
process pid=48877 mb=43.0 name=com.apple.WebKit.WebContent
process pid=48878 mb=15.6 name=com.apple.WebKit.WebContent
process pid=48882 mb=5.2 name=com.apple.audio.SandboxHelper
process pid=48896 mb=9.4 name=com.apple.SafariPlatformSupport.Helper
process_count=8
total_mb=435.6
cpu_pct=3.20
size_mb=64
```

## Raw output — Raycast 1.104.23

```
coldstart_ms=888
run=1 ms=20.0
run=2 ms=23.9
run=3 ms=24.0
run=4 ms=21.7
run=5 ms=22.5
run=6 ms=23.7
run=7 ms=22.1
run=8 ms=21.2
run=9 ms=20.5
run=10 ms=24.4
run=11 ms=22.8
run=12 ms=21.1
run=13 ms=21.2
run=14 ms=20.0
run=15 ms=21.3
median_ms=21.7
p95_ms=24.0
min_ms=20.0
process pid=49027 mb=174.0 name=Raycast
process pid=49067 mb=48.4 name=ollama
process pid=49072 mb=5.6 name=com.apple.WebKit.GPU
process pid=49073 mb=7.2 name=com.apple.WebKit.Networking
process pid=49074 mb=32.1 name=com.apple.WebKit.WebContent
process pid=49077 mb=5.2 name=com.apple.audio.SandboxHelper
process_count=6
total_mb=272.6
cpu_pct=0.04
size_mb=209
```

## Raw output — Raycast Beta 0.69.0.0

```
coldstart_ms=1012
run=1 ms=12.7
run=2 ms=17.1
run=3 ms=12.2
run=4 ms=12.8
run=5 ms=30.4
run=6 ms=18.3
run=7 ms=27.0
run=8 ms=15.9
run=9 ms=11.9
run=10 ms=18.1
run=11 ms=14.9
run=12 ms=17.7
run=13 ms=16.8
run=14 ms=21.3
run=15 ms=21.9
median_ms=17.1
p95_ms=27.0
min_ms=11.9
process pid=49216 mb=44.5 name=Raycast Beta
process pid=49219 mb=19.0 name=com.apple.WebKit.GPU
process pid=49220 mb=15.4 name=com.apple.WebKit.Networking
process pid=49222 mb=231.4 name=node
process pid=49231 mb=5.3 name=com.apple.audio.SandboxHelper
process pid=49232 mb=3.2 name=com.raycast-x.macos.Accessibility
process pid=49233 mb=4.5 name=com.raycast-x.macos.Pasteboard
process pid=49259 mb=140.5 name=com.apple.WebKit.WebContent
process_count=8
total_mb=463.9
cpu_pct=1.45
size_mb=179
```
