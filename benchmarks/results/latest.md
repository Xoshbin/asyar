# Benchmark run 2026-10-04

- Machine: Apple M4 Max, 36 GB RAM, macOS 27.0.1
- Asyar 0.1.1-49 (`/Applications/asyar.app`), hotkey `cmd+space`
- Raycast 2.6.2.0 (`/Applications/Raycast.app`), hotkey `cmd+space`
- 15 hotkey runs, 30s post-activity CPU window, 20s initial settle
- 60s deep-idle window after 120s quiet

| Metric                                 | Asyar 0.1.1-49 | Raycast 2.6.2.0 |
| -------------------------------------- | -------------: | --------------: |
| Hotkey → window visible (median of 15) |        18.0 ms |         21.7 ms |
| Hotkey → window visible (p95)          |        21.7 ms |         24.9 ms |
| Hotkey → window visible (p99)          |        22.4 ms |         27.5 ms |
| Keystroke → results painted (p50)      |            n/a |             n/a |
| Keystroke → results painted (p95)      |            n/a |             n/a |
| Cold start → usable                    |        1363 ms |         1747 ms |
| Memory footprint, idle (all processes) |       429.8 MB |        447.4 MB |
| CPU while idle (30s average)           |         0.94 % |          1.53 % |
| CPU deep idle (60s, after 120s quiet)  |         0.42 % |          1.33 % |
| Memory deep idle                       |       620.8 MB |        669.2 MB |
| CPU ms/s (powermetrics, deep idle)     |            n/a |             n/a |
| Idle wakeups/s (deep idle)             |            n/a |             n/a |
| Idle disk write ops (60s)              |            n/a |             n/a |
| Idle network bytes in (60s)            |           3983 |               0 |
| Idle network bytes out (60s)           |           1151 |               0 |
| App size on disk                       |          68 MB |          223 MB |

<sub>Measured 2026-10-04 on a Apple M4 Max (36 GB RAM), macOS 27.0.1, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>

## Raw output — Asyar 0.1.1-49

```
coldstart_ms=1363
run=1 ms=15.9
run=2 ms=19.7
run=3 ms=21.7
run=4 ms=17.8
run=5 ms=18.4
run=6 ms=22.4
run=7 ms=17.2
run=8 ms=7.9
run=9 ms=18.0
run=10 ms=15.3
run=11 ms=16.7
run=12 ms=13.7
run=13 ms=19.0
run=14 ms=19.1
run=15 ms=18.2
median_ms=18.0
p95_ms=21.7
min_ms=7.9
p99_ms=22.4
samples_ms=15.9,19.7,21.7,17.8,18.4,22.4,17.2,7.9,18.0,15.3,16.7,13.7,19.0,19.1,18.2
process pid=77071 mb=156.8 name=asyar
process pid=77084 mb=2.6 name=SetStoreUpdateService
process pid=77085 mb=21.9 name=com.apple.WebKit.GPU
process pid=77086 mb=122.9 name=com.apple.WebKit.WebContent
process pid=77087 mb=6.5 name=com.apple.WebKit.Networking
process pid=77088 mb=71.3 name=com.apple.WebKit.WebContent
process pid=77089 mb=15.7 name=com.apple.WebKit.WebContent
process pid=77090 mb=15.5 name=com.apple.WebKit.WebContent
process pid=77091 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=77101 mb=11.3 name=com.apple.SafariPlatformSupport.Helper
process_count=10
total_mb=429.8
cpu_pct=0.94
cpu_pct_deep=0.42
net_bytes_in=3983
net_bytes_out=1151
pm_cpu_ms_s=n/a
pm_wakeups_s=n/a
disk_write_ops=n/a
disk_files_touched=n/a
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
process pid=77071 mb=159.4 name=asyar
process pid=77084 mb=2.5 name=SetStoreUpdateService
process pid=77085 mb=224.2 name=com.apple.WebKit.GPU
process pid=77086 mb=120.8 name=com.apple.WebKit.WebContent
process pid=77087 mb=6.4 name=com.apple.WebKit.Networking
process pid=77088 mb=62.0 name=com.apple.WebKit.WebContent
process pid=77089 mb=15.7 name=com.apple.WebKit.WebContent
process pid=77090 mb=15.5 name=com.apple.WebKit.WebContent
process pid=77091 mb=3.2 name=com.apple.audio.SandboxHelper
process pid=77101 mb=11.2 name=com.apple.SafariPlatformSupport.Helper
process_count=10
total_mb_deep=620.8
size_mb=68
```

## Raw output — Raycast 2.6.2.0

```
coldstart_ms=1747
run=1 ms=21.3
run=2 ms=23.3
run=3 ms=20.8
run=4 ms=20.7
run=5 ms=21.4
run=6 ms=27.5
run=7 ms=21.2
run=8 ms=24.0
run=9 ms=23.1
run=10 ms=20.4
run=11 ms=22.0
run=12 ms=24.9
run=13 ms=21.7
run=14 ms=19.2
run=15 ms=24.5
median_ms=21.7
p95_ms=24.9
min_ms=19.2
p99_ms=27.5
samples_ms=21.3,23.3,20.8,20.7,21.4,27.5,21.2,24.0,23.1,20.4,22.0,24.9,21.7,19.2,24.5
process pid=78960 mb=30.7 name=Raycast
process pid=78965 mb=2.6 name=SetStoreUpdateService
process pid=78967 mb=19.5 name=com.apple.WebKit.GPU
process pid=78968 mb=115.4 name=com.apple.WebKit.WebContent
process pid=78969 mb=7.3 name=com.apple.WebKit.Networking
process pid=78971 mb=255.6 name=node
process pid=78972 mb=3.2 name=com.apple.audio.SandboxHelper
process pid=78985 mb=6.3 name=com.raycast.macos.Accessibility
process pid=78986 mb=6.8 name=com.raycast.macos.Pasteboard
process_count=9
total_mb=447.4
cpu_pct=1.53
cpu_pct_deep=1.33
net_bytes_in=0
net_bytes_out=0
pm_cpu_ms_s=n/a
pm_wakeups_s=n/a
disk_write_ops=n/a
disk_files_touched=n/a
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
process pid=78960 mb=30.5 name=Raycast
process pid=78965 mb=2.5 name=SetStoreUpdateService
process pid=78967 mb=228.2 name=com.apple.WebKit.GPU
process pid=78968 mb=151.9 name=com.apple.WebKit.WebContent
process pid=78969 mb=7.2 name=com.apple.WebKit.Networking
process pid=78971 mb=232.6 name=node
process pid=78972 mb=3.2 name=com.apple.audio.SandboxHelper
process pid=78985 mb=6.3 name=com.raycast.macos.Accessibility
process pid=78986 mb=6.8 name=com.raycast.macos.Pasteboard
process_count=9
total_mb_deep=669.2
size_mb=223
```
