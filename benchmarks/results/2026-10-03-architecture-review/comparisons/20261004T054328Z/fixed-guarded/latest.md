# Benchmark run 2026-10-04

- Machine: Apple M4 Max, 36 GB RAM, macOS 27.0.1
- Asyar 0.1.1-49 (`/Applications/asyar.app`), hotkey `cmd+space`
- Raycast 2.6.2.0 (`/Applications/Raycast.app`), hotkey `cmd+space`
- 15 hotkey runs, 30s post-activity CPU window, 20s initial settle
- 60s deep-idle window after 120s quiet

| Metric                                 | Asyar 0.1.1-49 | Raycast 2.6.2.0 |
| -------------------------------------- | -------------: | --------------: |
| Hotkey → window visible (median of 15) |        12.4 ms |         20.0 ms |
| Hotkey → window visible (p95)          |        16.7 ms |         24.2 ms |
| Hotkey → window visible (p99)          |        18.3 ms |         31.0 ms |
| Keystroke → results painted (p50)      |            n/a |             n/a |
| Keystroke → results painted (p95)      |            n/a |             n/a |
| Cold start → usable                    |         732 ms |         1052 ms |
| Memory footprint, idle (all processes) |       486.2 MB |        457.4 MB |
| CPU while idle (30s average)           |         1.10 % |          1.52 % |
| CPU deep idle (60s, after 120s quiet)  |         0.71 % |          1.31 % |
| Memory deep idle                       |       677.1 MB |        675.1 MB |
| CPU ms/s (powermetrics, deep idle)     |            n/a |             n/a |
| Idle wakeups/s (deep idle)             |            n/a |             n/a |
| Idle disk write ops (60s)              |            n/a |             n/a |
| Idle network bytes in (60s)            |           4017 |               0 |
| Idle network bytes out (60s)           |           1151 |               0 |
| App size on disk                       |          68 MB |          223 MB |

<sub>Measured 2026-10-04 on a Apple M4 Max (36 GB RAM), macOS 27.0.1, each app
as installed, summoned by its own registered global hotkey, one at a time on a
quiet machine. Black-box measurement: synthetic hotkey press → launcher window
on screen. Reproduce with [`benchmarks/bench.sh`](benchmarks/README.md).</sub>

## Raw output — Asyar 0.1.1-49

```
coldstart_ms=732
run=1 ms=11.1
run=2 ms=16.7
run=3 ms=12.3
run=4 ms=13.1
run=5 ms=14.8
run=6 ms=12.8
run=7 ms=11.6
run=8 ms=14.9
run=9 ms=11.8
run=10 ms=11.8
run=11 ms=13.8
run=12 ms=12.4
run=13 ms=18.3
run=14 ms=11.3
run=15 ms=11.8
median_ms=12.4
p95_ms=16.7
min_ms=11.1
p99_ms=18.3
samples_ms=11.1,16.7,12.3,13.1,14.8,12.8,11.6,14.9,11.8,11.8,13.8,12.4,18.3,11.3,11.8
process pid=63899 mb=219.6 name=asyar
process pid=63900 mb=2.7 name=SetStoreUpdateService
process pid=63901 mb=21.1 name=com.apple.WebKit.GPU
process pid=63902 mb=120.2 name=com.apple.WebKit.WebContent
process pid=63903 mb=6.8 name=com.apple.WebKit.Networking
process pid=63904 mb=68.7 name=com.apple.WebKit.WebContent
process pid=63905 mb=15.4 name=com.apple.WebKit.WebContent
process pid=63906 mb=15.4 name=com.apple.WebKit.WebContent
process pid=63908 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=63925 mb=11.0 name=com.apple.SafariPlatformSupport.Helper
process_count=10
total_mb=486.2
cpu_pct=1.10
cpu_pct_deep=0.71
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
process pid=63899 mb=175.5 name=asyar
process pid=63900 mb=2.5 name=SetStoreUpdateService
process pid=63901 mb=225.9 name=com.apple.WebKit.GPU
process pid=63902 mb=150.6 name=com.apple.WebKit.WebContent
process pid=63903 mb=6.7 name=com.apple.WebKit.Networking
process pid=63904 mb=68.7 name=com.apple.WebKit.WebContent
process pid=63905 mb=15.4 name=com.apple.WebKit.WebContent
process pid=63906 mb=15.4 name=com.apple.WebKit.WebContent
process pid=63908 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=63925 mb=11.0 name=com.apple.SafariPlatformSupport.Helper
process_count=10
total_mb_deep=677.1
size_mb=68
```

## Raw output — Raycast 2.6.2.0

```
coldstart_ms=1052
run=1 ms=24.0
run=2 ms=12.5
run=3 ms=20.0
run=4 ms=20.6
run=5 ms=18.2
run=6 ms=21.8
run=7 ms=22.2
run=8 ms=18.8
run=9 ms=17.9
run=10 ms=19.8
run=11 ms=21.3
run=12 ms=18.2
run=13 ms=24.2
run=14 ms=18.6
run=15 ms=31.0
median_ms=20.0
p95_ms=24.2
min_ms=12.5
p99_ms=31.0
samples_ms=24.0,12.5,20.0,20.6,18.2,21.8,22.2,18.8,17.9,19.8,21.3,18.2,24.2,18.6,31.0
process pid=65585 mb=30.3 name=Raycast
process pid=65590 mb=2.6 name=SetStoreUpdateService
process pid=65591 mb=19.6 name=com.apple.WebKit.GPU
process pid=65592 mb=117.4 name=com.apple.WebKit.WebContent
process pid=65593 mb=7.5 name=com.apple.WebKit.Networking
process pid=65594 mb=261.5 name=node
process pid=65595 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=65603 mb=6.3 name=com.raycast.macos.Accessibility
process pid=65604 mb=6.8 name=com.raycast.macos.Pasteboard
process_count=9
total_mb=457.4
cpu_pct=1.52
cpu_pct_deep=1.31
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
process pid=65585 mb=30.0 name=Raycast
process pid=65590 mb=2.5 name=SetStoreUpdateService
process pid=65591 mb=228.3 name=com.apple.WebKit.GPU
process pid=65592 mb=158.2 name=com.apple.WebKit.WebContent
process pid=65593 mb=7.4 name=com.apple.WebKit.Networking
process pid=65594 mb=230.2 name=node
process pid=65595 mb=5.5 name=com.apple.audio.SandboxHelper
process pid=65603 mb=6.3 name=com.raycast.macos.Accessibility
process pid=65604 mb=6.8 name=com.raycast.macos.Pasteboard
process_count=9
total_mb_deep=675.1
size_mb=223
```

Source: `1e807ce8303e1883adb77fc640510ec5f4e376f7 plus compiled-changes.patch`
Bundle: `/Applications/asyar.app` (version 0.1.1-49)
Identity/profile/keychain: `org.asyar.app`; app-data `~/Library/Application Support/org.asyar.app` held 201 search_items before this run.
Compiler: Rust 1.97.0. Built through the normal guarded `pnpm tauri build` path — no --ignore-version-mismatches, no bypass.
