# Benchmark run 2026-10-04

- Machine: Apple M4 Max, 36 GB RAM, macOS 27.0.1
- Asyar 0.1.1-49 (`/Applications/asyar.app`), hotkey `cmd+space`
- Raycast 2.6.2.0 (`/Applications/Raycast.app`), hotkey `cmd+space`
- 15 hotkey runs, 30s post-activity CPU window, 20s initial settle
- 60s deep-idle window after 120s quiet

| Metric                                 | Asyar 0.1.1-49 | Raycast 2.6.2.0 |
| -------------------------------------- | -------------: | --------------: |
| Hotkey → window visible (median of 15) |        13.9 ms |         22.2 ms |
| Hotkey → window visible (p95)          |        17.3 ms |         32.0 ms |
| Hotkey → window visible (p99)          |        20.5 ms |         32.5 ms |
| Keystroke → results painted (p50)      |            n/a |             n/a |
| Keystroke → results painted (p95)      |            n/a |             n/a |
| Cold start → usable                    |         585 ms |         2129 ms |
| Memory footprint, idle (all processes) |       419.2 MB |        451.5 MB |
| CPU while idle (30s average)           |         0.64 % |          1.44 % |
| CPU deep idle (60s, after 120s quiet)  |         0.10 % |          1.41 % |
| Memory deep idle                       |       664.4 MB |        680.4 MB |
| CPU ms/s (powermetrics, deep idle)     |           1.02 |           13.92 |
| Idle wakeups/s (deep idle)             |          11.82 |           46.33 |
| Idle disk write ops (60s)              |              0 |              96 |
| Idle network bytes in (60s)            |           3106 |               0 |
| Idle network bytes out (60s)           |            948 |               0 |
| App size on disk                       |          68 MB |          223 MB |

<sub>Measured 2026-10-04 on a Apple M4 Max (36 GB RAM), macOS 27.0.1, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>

## Raw output — Asyar 0.1.1-49

```
coldstart_ms=585
run=1 ms=13.1
run=2 ms=13.0
run=3 ms=15.0
run=4 ms=15.3
run=5 ms=13.7
run=6 ms=11.9
run=7 ms=13.7
run=8 ms=17.3
run=9 ms=14.2
run=10 ms=12.7
run=11 ms=14.9
run=12 ms=14.2
run=13 ms=13.9
run=14 ms=20.5
run=15 ms=12.9
median_ms=13.9
p95_ms=17.3
min_ms=11.9
p99_ms=20.5
samples_ms=13.1,13.0,15.0,15.3,13.7,11.9,13.7,17.3,14.2,12.7,14.9,14.2,13.9,20.5,12.9
process pid=68573 mb=174.3 name=asyar
process pid=68574 mb=2.6 name=SetStoreUpdateService
process pid=68575 mb=22.1 name=com.apple.WebKit.GPU
process pid=68576 mb=92.4 name=com.apple.WebKit.WebContent
process pid=68577 mb=6.4 name=com.apple.WebKit.Networking
process pid=68578 mb=72.9 name=com.apple.WebKit.WebContent
process pid=68579 mb=15.8 name=com.apple.WebKit.WebContent
process pid=68580 mb=15.7 name=com.apple.WebKit.WebContent
process pid=68583 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=68588 mb=11.3 name=com.apple.SafariPlatformSupport.Helper
process_count=10
total_mb=419.2
cpu_pct=0.64
cpu_pct_deep=0.10
net_bytes_in=3106
net_bytes_out=948
pm_cpu_ms_s=1.02
pm_wakeups_s=11.82
disk_write_ops=0
disk_files_touched=0
run=1 ms=timeout
run=2 ms=timeout
run=3 ms=timeout
run=4 ms=timeout
run=5 ms=timeout
run=6 ms=timeout
run=7 ms=timeout
run=8 ms=timeout
run=9 ms=timeout
run=10 ms=timeout
type_p50_ms=n/a
type_p95_ms=n/a
type_p99_ms=n/a
process pid=68573 mb=174.4 name=asyar
process pid=68574 mb=2.5 name=SetStoreUpdateService
process pid=68575 mb=225.0 name=com.apple.WebKit.GPU
process pid=68576 mb=142.5 name=com.apple.WebKit.WebContent
process pid=68577 mb=6.5 name=com.apple.WebKit.Networking
process pid=68578 mb=65.2 name=com.apple.WebKit.WebContent
process pid=68579 mb=15.8 name=com.apple.WebKit.WebContent
process pid=68580 mb=15.7 name=com.apple.WebKit.WebContent
process pid=68583 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=68588 mb=11.2 name=com.apple.SafariPlatformSupport.Helper
process_count=10
total_mb_deep=664.4
size_mb=68
```

## Raw output — Raycast 2.6.2.0

```
coldstart_ms=2129
run=1 ms=31.8
run=2 ms=32.0
run=3 ms=29.5
run=4 ms=22.0
run=5 ms=23.7
run=6 ms=32.5
run=7 ms=22.2
run=8 ms=28.0
run=9 ms=29.1
run=10 ms=19.1
run=11 ms=18.9
run=12 ms=18.6
run=13 ms=21.8
run=14 ms=19.3
run=15 ms=20.3
median_ms=22.2
p95_ms=32.0
min_ms=18.6
p99_ms=32.5
samples_ms=31.8,32.0,29.5,22.0,23.7,32.5,22.2,28.0,29.1,19.1,18.9,18.6,21.8,19.3,20.3
process pid=70432 mb=30.5 name=Raycast
process pid=70439 mb=2.6 name=SetStoreUpdateService
process pid=70440 mb=19.8 name=com.apple.WebKit.GPU
process pid=70441 mb=115.7 name=com.apple.WebKit.WebContent
process pid=70442 mb=7.5 name=com.apple.WebKit.Networking
process pid=70443 mb=254.0 name=node
process pid=70445 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=70453 mb=7.7 name=com.raycast.macos.Accessibility
process pid=70455 mb=8.3 name=com.raycast.macos.Pasteboard
process_count=9
total_mb=451.5
cpu_pct=1.44
cpu_pct_deep=1.41
net_bytes_in=0
net_bytes_out=0
pm_cpu_ms_s=13.92
pm_wakeups_s=46.33
disk_write_ops=96
disk_files_touched=0
run=1 ms=timeout
run=2 ms=timeout
run=3 ms=timeout
run=4 ms=timeout
run=5 ms=timeout
run=6 ms=timeout
run=7 ms=timeout
run=8 ms=timeout
run=9 ms=timeout
run=10 ms=timeout
type_p50_ms=n/a
type_p95_ms=n/a
type_p99_ms=n/a
process pid=70432 mb=30.4 name=Raycast
process pid=70439 mb=2.5 name=SetStoreUpdateService
process pid=70440 mb=232.1 name=com.apple.WebKit.GPU
process pid=70441 mb=156.0 name=com.apple.WebKit.WebContent
process pid=70442 mb=7.4 name=com.apple.WebKit.Networking
process pid=70443 mb=230.6 name=node
process pid=70445 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=70453 mb=7.7 name=com.raycast.macos.Accessibility
process pid=70455 mb=8.3 name=com.raycast.macos.Pasteboard
process_count=9
total_mb_deep=680.4
size_mb=223
```
