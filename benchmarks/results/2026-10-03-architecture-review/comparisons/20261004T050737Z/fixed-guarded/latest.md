# Benchmark run 2026-10-04

- Machine: Apple M4 Max, 36 GB RAM, macOS 27.0.1
- Asyar 0.1.1-49 (`/Applications/asyar.app`), hotkey `cmd+space`
- Raycast 1.104.31 (`/Applications/Raycast.app`), hotkey `cmd+space`
- Raycast Beta 0.71.7.0 (`/Applications/Raycast Beta.app`), hotkey `cmd+space`
- 15 hotkey runs, 30s post-activity CPU window, 20s initial settle
- 60s deep-idle window after 120s quiet

| Metric                                 | Asyar 0.1.1-49 | Raycast 1.104.31 | Raycast Beta 0.71.7.0 |
| -------------------------------------- | -------------: | ---------------: | --------------------: |
| Hotkey → window visible (median of 15) |        12.0 ms |          30.6 ms |               22.9 ms |
| Hotkey → window visible (p95)          |        16.6 ms |          42.3 ms |               33.7 ms |
| Hotkey → window visible (p99)          |        21.1 ms |          43.0 ms |               35.1 ms |
| Keystroke → results painted (p50)      |            n/a |              n/a |                   n/a |
| Keystroke → results painted (p95)      |            n/a |              n/a |                   n/a |
| Cold start → usable                    |         750 ms |          1289 ms |               1195 ms |
| Memory footprint, idle (all processes) |       499.0 MB |         142.4 MB |              464.5 MB |
| CPU while idle (30s average)           |         1.06 % |           0.05 % |                1.34 % |
| CPU deep idle (60s, after 120s quiet)  |         0.65 % |           0.05 % |                1.05 % |
| Memory deep idle                       |       632.0 MB |         148.6 MB |              784.5 MB |
| CPU ms/s (powermetrics, deep idle)     |            n/a |              n/a |                   n/a |
| Idle wakeups/s (deep idle)             |            n/a |              n/a |                   n/a |
| Idle disk write ops (60s)              |            n/a |              n/a |                   n/a |
| Idle network bytes in (60s)            |           4017 |                0 |                     0 |
| Idle network bytes out (60s)           |           1151 |                0 |                     0 |
| App size on disk                       |          68 MB |           133 MB |                184 MB |

<sub>Measured 2026-10-04 on a Apple M4 Max (36 GB RAM), macOS 27.0.1, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>

## Raw output — Asyar 0.1.1-49

```
coldstart_ms=750
run=1 ms=16.6
run=2 ms=15.3
run=3 ms=7.5
run=4 ms=10.0
run=5 ms=14.0
run=6 ms=21.1
run=7 ms=10.4
run=8 ms=14.2
run=9 ms=11.8
run=10 ms=11.7
run=11 ms=12.7
run=12 ms=12.9
run=13 ms=10.6
run=14 ms=11.3
run=15 ms=12.0
median_ms=12.0
p95_ms=16.6
min_ms=7.5
p99_ms=21.1
samples_ms=16.6,15.3,7.5,10.0,14.0,21.1,10.4,14.2,11.8,11.7,12.7,12.9,10.6,11.3,12.0
process pid=51361 mb=227.3 name=asyar
process pid=51362 mb=2.6 name=SetStoreUpdateService
process pid=51363 mb=19.8 name=com.apple.WebKit.GPU
process pid=51364 mb=126.1 name=com.apple.WebKit.WebContent
process pid=51365 mb=6.7 name=com.apple.WebKit.Networking
process pid=51366 mb=68.9 name=com.apple.WebKit.WebContent
process pid=51367 mb=15.3 name=com.apple.WebKit.WebContent
process pid=51368 mb=15.4 name=com.apple.WebKit.WebContent
process pid=51369 mb=5.6 name=com.apple.audio.SandboxHelper
process pid=51382 mb=11.2 name=com.apple.SafariPlatformSupport.Helper
process_count=10
total_mb=499.0
cpu_pct=1.06
cpu_pct_deep=0.65
net_bytes_in=4017
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
process pid=51361 mb=153.0 name=asyar
process pid=51362 mb=2.5 name=SetStoreUpdateService
process pid=51363 mb=224.2 name=com.apple.WebKit.GPU
process pid=51364 mb=129.3 name=com.apple.WebKit.WebContent
process pid=51365 mb=6.6 name=com.apple.WebKit.Networking
process pid=51366 mb=68.9 name=com.apple.WebKit.WebContent
process pid=51367 mb=15.3 name=com.apple.WebKit.WebContent
process pid=51368 mb=15.4 name=com.apple.WebKit.WebContent
process pid=51369 mb=5.6 name=com.apple.audio.SandboxHelper
process pid=51382 mb=11.2 name=com.apple.SafariPlatformSupport.Helper
process_count=10
total_mb_deep=632.0
size_mb=68
```

## Raw output — Raycast 1.104.31

```
coldstart_ms=1289
run=1 ms=27.4
run=2 ms=38.7
run=3 ms=43.0
run=4 ms=30.6
run=5 ms=40.7
run=6 ms=37.4
run=7 ms=22.0
run=8 ms=33.9
run=9 ms=42.3
run=10 ms=29.0
run=11 ms=16.0
run=12 ms=19.3
run=13 ms=16.1
run=14 ms=19.3
run=15 ms=41.8
median_ms=30.6
p95_ms=42.3
min_ms=16.0
p99_ms=43.0
samples_ms=27.4,38.7,43.0,30.6,40.7,37.4,22.0,33.9,42.3,29.0,16.0,19.3,16.1,19.3,41.8
process pid=53061 mb=70.2 name=Raycast
process pid=53080 mb=2.3 name=SetStoreUpdateService
process pid=53107 mb=18.5 name=ollama
process pid=53113 mb=5.4 name=com.apple.WebKit.GPU
process pid=53114 mb=34.2 name=com.apple.WebKit.WebContent
process pid=53115 mb=6.3 name=com.apple.WebKit.Networking
process pid=53116 mb=5.5 name=com.apple.audio.SandboxHelper
process_count=7
total_mb=142.4
cpu_pct=0.05
cpu_pct_deep=0.05
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
process pid=53061 mb=76.4 name=Raycast
process pid=53080 mb=2.5 name=SetStoreUpdateService
process pid=53107 mb=18.4 name=ollama
process pid=53113 mb=5.4 name=com.apple.WebKit.GPU
process pid=53114 mb=34.2 name=com.apple.WebKit.WebContent
process pid=53115 mb=6.2 name=com.apple.WebKit.Networking
process pid=53116 mb=5.5 name=com.apple.audio.SandboxHelper
process_count=7
total_mb_deep=148.6
size_mb=133
```

## Raw output — Raycast Beta 0.71.7.0

```
coldstart_ms=1195
run=1 ms=19.8
run=2 ms=19.2
run=3 ms=23.3
run=4 ms=29.5
run=5 ms=23.3
run=6 ms=22.9
run=7 ms=33.7
run=8 ms=20.0
run=9 ms=18.9
run=10 ms=23.3
run=11 ms=35.1
run=12 ms=19.5
run=13 ms=22.2
run=14 ms=21.5
run=15 ms=24.2
median_ms=22.9
p95_ms=33.7
min_ms=18.9
p99_ms=35.1
samples_ms=19.8,19.2,23.3,29.5,23.3,22.9,33.7,20.0,18.9,23.3,35.1,19.5,22.2,21.5,24.2
process pid=54815 mb=46.7 name=Raycast Beta
process pid=54821 mb=2.7 name=SetStoreUpdateService
process pid=54822 mb=20.5 name=com.apple.WebKit.GPU
process pid=54823 mb=146.3 name=com.apple.WebKit.WebContent
process pid=54824 mb=7.3 name=com.apple.WebKit.Networking
process pid=54825 mb=222.3 name=node
process pid=54826 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=54836 mb=6.4 name=com.raycast-x.macos.Accessibility
process pid=54837 mb=7.0 name=com.raycast-x.macos.Pasteboard
process_count=9
total_mb=464.5
cpu_pct=1.34
cpu_pct_deep=1.05
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
process pid=54815 mb=44.3 name=Raycast Beta
process pid=54821 mb=2.5 name=SetStoreUpdateService
process pid=54822 mb=228.4 name=com.apple.WebKit.GPU
process pid=54824 mb=7.3 name=com.apple.WebKit.Networking
process pid=54825 mb=204.8 name=node
process pid=54826 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=54836 mb=6.4 name=com.raycast-x.macos.Accessibility
process pid=54837 mb=7.0 name=com.raycast-x.macos.Pasteboard
process pid=55684 mb=278.3 name=com.apple.WebKit.WebContent
process_count=9
total_mb_deep=784.5
size_mb=184
```

Source: `1e807ce8303e1883adb77fc640510ec5f4e376f7 plus compiled-changes.patch`
Bundle: `/Applications/asyar.app` (version 0.1.1-49)
Identity/profile/keychain: `org.asyar.app`; app-data `~/Library/Application Support/org.asyar.app` held 201 search_items before this run.
Compiler: Rust 1.97.0. Built through the normal guarded `pnpm tauri build` path — no --ignore-version-mismatches, no bypass.
