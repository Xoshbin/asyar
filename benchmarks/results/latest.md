# Benchmark run 2026-07-07

- Machine: Apple M4 Max, 36 GB RAM, macOS 26.5.2
- Asyar 0.1.1-34 (`/Applications/asyar.app`), hotkey `opt+space`
- Raycast 1.104.21 (`/Applications/Raycast.app`), hotkey `opt+space`
- Raycast Beta 0.67.1.0 (`/Applications/Raycast Beta.app`), hotkey `opt+space`
- 15 hotkey runs, 30s CPU window, 20s settle

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

## Raw output — Asyar 0.1.1-34

```
coldstart_ms=427
run=1 ms=27.1
run=2 ms=18.6
run=3 ms=23.0
run=4 ms=19.2
run=5 ms=21.0
run=6 ms=16.0
run=7 ms=13.7
run=8 ms=15.6
run=9 ms=16.3
run=10 ms=15.7
run=11 ms=20.8
run=12 ms=17.2
run=13 ms=8.5
run=14 ms=22.0
run=15 ms=23.0
median_ms=18.6
p95_ms=23.0
min_ms=8.5
process pid=91440 mb=147.3 name=asyar
process pid=91443 mb=18.7 name=com.apple.WebKit.GPU
process pid=91444 mb=5.9 name=com.apple.WebKit.Networking
process pid=91445 mb=139.3 name=com.apple.WebKit.WebContent
process pid=91446 mb=87.3 name=com.apple.WebKit.WebContent
process pid=91447 mb=18.5 name=com.apple.WebKit.WebContent
process pid=91449 mb=5.2 name=com.apple.audio.SandboxHelper
process pid=91462 mb=9.5 name=com.apple.SafariPlatformSupport.Helper
process_count=8
total_mb=431.8
cpu_pct=0.75
size_mb=384
```

## Raw output — Raycast 1.104.21

```
coldstart_ms=906
run=1 ms=20.4
run=2 ms=17.1
run=3 ms=17.2
run=4 ms=17.4
run=5 ms=22.1
run=6 ms=22.7
run=7 ms=14.8
run=8 ms=17.8
run=9 ms=21.5
run=10 ms=18.1
run=11 ms=19.7
run=12 ms=16.0
run=13 ms=19.9
run=14 ms=17.5
run=15 ms=20.8
median_ms=18.1
p95_ms=22.1
min_ms=14.8
process pid=91586 mb=187.3 name=Raycast
process pid=91608 mb=9.7 name=com.apple.SafariPlatformSupport.Helper
process pid=91626 mb=60.5 name=ollama
process pid=91631 mb=5.6 name=com.apple.WebKit.GPU
process pid=91632 mb=7.2 name=com.apple.WebKit.Networking
process pid=91633 mb=32.5 name=com.apple.WebKit.WebContent
process pid=91636 mb=5.2 name=com.apple.audio.SandboxHelper
process_count=7
total_mb=308.0
cpu_pct=1.13
size_mb=133
```

## Raw output — Raycast Beta 0.67.1.0

```
coldstart_ms=964
run=1 ms=16.3
run=2 ms=20.0
run=3 ms=23.1
run=4 ms=20.5
run=5 ms=21.0
run=6 ms=24.9
run=7 ms=20.2
run=8 ms=21.8
run=9 ms=20.7
run=10 ms=20.1
run=11 ms=20.1
run=12 ms=22.5
run=13 ms=22.3
run=14 ms=24.2
run=15 ms=24.3
median_ms=21.0
p95_ms=24.3
min_ms=16.3
process pid=91873 mb=45.3 name=Raycast Beta
process pid=91878 mb=18.9 name=com.apple.WebKit.GPU
process pid=91879 mb=15.7 name=com.apple.WebKit.Networking
process pid=91882 mb=255.3 name=node
process pid=91885 mb=5.3 name=com.apple.audio.SandboxHelper
process pid=91886 mb=3.2 name=com.raycast-x.macos.Accessibility
process pid=91887 mb=4.7 name=com.raycast-x.macos.Pasteboard
process pid=91900 mb=136.1 name=com.apple.WebKit.WebContent
process_count=8
total_mb=484.4
cpu_pct=4.15
size_mb=178
```
