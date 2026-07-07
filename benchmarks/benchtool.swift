// benchtool — black-box launcher benchmark helper for macOS.
//
// Measures, for any .app bundle:
//   mem        physical memory footprint of the app's whole process group
//              (main process + WebKit/XPC helpers, attributed via the OS
//              "responsible process" mechanism — same grouping idea as
//              Activity Monitor)
//   hotkey     global-hotkey press → launcher window visible on screen, in ms
//   coldstart  app launch → window can be summoned, in ms
//   cpu        average CPU % of the process group over a sampling window
//   group      debug: list the resolved process group
//
// Usage:
//   benchtool mem       <bundle-path>
//   benchtool hotkey    <bundle-path> <keyspec> [runs]
//   benchtool coldstart <bundle-path> <keyspec>
//   benchtool cpu       <bundle-path> [seconds]
//   benchtool group     <bundle-path>
//
// keyspec examples: "opt+space", "cmd+space", "ctrl+shift+k"
//
// Machine-readable results are printed as key=value lines on stdout.

import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Process attribution

// Private-but-stable libquarantine API; the sanctioned way to answer
// "which app is this XPC helper doing work for?". WebKit helpers of a
// Tauri app are launchd children, so parent-pid walking cannot find them.
typealias ResponsibleFn = @convention(c) (pid_t) -> pid_t
let responsiblePid: ResponsibleFn = {
    guard let handle = dlopen("/usr/lib/system/libquarantine.dylib", RTLD_NOW),
        let sym = dlsym(handle, "responsibility_get_pid_responsible_for_pid")
    else {
        fputs("error: responsibility API unavailable on this macOS\n", stderr)
        exit(1)
    }
    return unsafeBitCast(sym, to: ResponsibleFn.self)
}()

func allPids() -> [pid_t] {
    let expected = proc_listallpids(nil, 0)
    guard expected > 0 else { return [] }
    var buf = [pid_t](repeating: 0, count: Int(expected) * 2)
    let stride = Int32(MemoryLayout<pid_t>.size)
    let got = proc_listallpids(&buf, Int32(buf.count) * stride)
    guard got > 0 else { return [] }
    return Array(buf.prefix(Int(got))).filter { $0 > 0 }
}

func procPath(_ pid: pid_t) -> String? {
    var buf = [CChar](repeating: 0, count: 4096)
    guard proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 else { return nil }
    return String(cString: buf)
}

func procName(_ pid: pid_t) -> String {
    guard let path = procPath(pid) else { return "pid-\(pid)" }
    return (path as NSString).lastPathComponent
}

/// The app's main process: executable lives in <bundle>/Contents/MacOS
/// and the process is responsible for itself (i.e. it was launched as an
/// app, not spawned by a terminal — dev builds launched from a shell are
/// rejected on purpose).
func mainPid(bundlePath: String) -> pid_t? {
    let prefix = bundlePath.hasSuffix("/") ? bundlePath : bundlePath + "/"
    let candidates = allPids().filter {
        procPath($0)?.hasPrefix(prefix + "Contents/MacOS/") ?? false
    }
    return candidates.first { responsiblePid($0) == $0 } ?? candidates.min()
}

/// Main process + every process the OS attributes to it (WebKit helpers,
/// XPC services) + anything else running out of the bundle (appex, helpers).
func processGroup(bundlePath: String) -> [pid_t] {
    guard let main = mainPid(bundlePath: bundlePath) else { return [] }
    let prefix = bundlePath.hasSuffix("/") ? bundlePath : bundlePath + "/"
    return allPids().filter { pid in
        pid == main
            || responsiblePid(pid) == main
            || (procPath(pid)?.hasPrefix(prefix) ?? false)
    }
}

// MARK: - Memory / CPU sampling

/// Same figure as Activity Monitor's "Memory" column (phys_footprint),
/// which unlike RSS does not over-count shared pages.
func physFootprint(_ pid: pid_t) -> UInt64? {
    var usage = rusage_info_current()
    let ok = withUnsafeMutablePointer(to: &usage) {
        $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
            proc_pid_rusage(pid, RUSAGE_INFO_CURRENT, $0)
        }
    }
    guard ok == 0 else { return nil }
    return usage.ri_phys_footprint
}

let timebase: mach_timebase_info_data_t = {
    var tb = mach_timebase_info_data_t()
    mach_timebase_info(&tb)
    return tb
}()

/// Total CPU time (user + system) consumed so far, in nanoseconds.
func cpuTimeNs(_ pid: pid_t) -> UInt64? {
    var usage = rusage_info_current()
    let ok = withUnsafeMutablePointer(to: &usage) {
        $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
            proc_pid_rusage(pid, RUSAGE_INFO_CURRENT, $0)
        }
    }
    guard ok == 0 else { return nil }
    let ticks = usage.ri_user_time + usage.ri_system_time
    return ticks * UInt64(timebase.numer) / UInt64(timebase.denom)
}

// MARK: - Window detection

/// True when the app has a real (launcher-sized) window on screen.
/// Small always-on windows like the menu-bar status item are filtered
/// out by the size threshold.
func launcherWindowVisible(pids: Set<pid_t>) -> Bool {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]]
    else { return false }
    for w in info {
        guard let owner = (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
            pids.contains(owner)
        else { continue }
        if let alpha = (w[kCGWindowAlpha as String] as? NSNumber)?.doubleValue, alpha <= 0.01 {
            continue
        }
        guard let boundsDict = w[kCGWindowBounds as String] as? NSDictionary,
            let rect = CGRect(dictionaryRepresentation: boundsDict)
        else { continue }
        if rect.height >= 100, rect.width >= 200 { return true }
    }
    return false
}

// MARK: - Key events

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
    "o": 31, "u": 32, "i": 34, "p": 35, "return": 36, "l": 37, "j": 38, "k": 40,
    "n": 45, "m": 46, "tab": 48, "space": 49, "escape": 53,
]

func parseKeySpec(_ spec: String) -> (CGKeyCode, CGEventFlags)? {
    var flags: CGEventFlags = []
    var key: CGKeyCode?
    for part in spec.lowercased().split(separator: "+") {
        switch part {
        case "cmd", "command", "meta", "super": flags.insert(.maskCommand)
        case "opt", "option", "alt": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        case "shift": flags.insert(.maskShift)
        default:
            guard let code = keyCodes[String(part)] else { return nil }
            key = code
        }
    }
    guard let key else { return nil }
    return (key, flags)
}

func postKey(_ code: CGKeyCode, _ flags: CGEventFlags) {
    let src = CGEventSource(stateID: .hidSystemState)
    guard let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true),
        let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)
    else {
        fputs("error: could not create key event\n", stderr)
        exit(1)
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func requireAccessibility() {
    let opts =
        [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    guard AXIsProcessTrustedWithOptions(opts) else {
        fputs(
            """
            error: posting keyboard events needs Accessibility permission.
            Grant it to your terminal app in
            System Settings → Privacy & Security → Accessibility, then re-run.

            """, stderr)
        exit(2)
    }
}

// MARK: - Timing helpers

func nowNs() -> UInt64 { DispatchTime.now().uptimeNanoseconds }

func msSince(_ startNs: UInt64) -> Double {
    Double(nowNs() - startNs) / 1_000_000.0
}

/// Polls `condition` until true or timeout. Returns elapsed ms, or nil on timeout.
func waitFor(timeoutMs: Double, pollUs: UInt32 = 500, _ condition: () -> Bool) -> Double? {
    let t0 = nowNs()
    while msSince(t0) < timeoutMs {
        if condition() { return msSince(t0) }
        usleep(pollUs)
    }
    return nil
}

func median(_ xs: [Double]) -> Double {
    let s = xs.sorted()
    let mid = s.count / 2
    return s.count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

func percentile(_ xs: [Double], _ p: Double) -> Double {
    let s = xs.sorted()
    let idx = Int((Double(s.count - 1) * p).rounded())
    return s[idx]
}

// MARK: - Commands

func cmdGroup(_ bundle: String) {
    let group = processGroup(bundlePath: bundle)
    guard !group.isEmpty else {
        fputs("error: no running process found for \(bundle) (launch it via Finder/open first)\n", stderr)
        exit(1)
    }
    for pid in group.sorted() {
        let mb = physFootprint(pid).map { Double($0) / 1_048_576 } ?? 0
        print("pid=\(pid) mb=\(String(format: "%.1f", mb)) name=\(procName(pid))")
    }
}

func cmdMem(_ bundle: String) {
    let group = processGroup(bundlePath: bundle)
    guard !group.isEmpty else {
        fputs("error: no running process found for \(bundle) (launch it via Finder/open first)\n", stderr)
        exit(1)
    }
    var total: UInt64 = 0
    for pid in group.sorted() {
        guard let fp = physFootprint(pid) else { continue }
        total += fp
        print(
            "process pid=\(pid) mb=\(String(format: "%.1f", Double(fp) / 1_048_576)) name=\(procName(pid))"
        )
    }
    print("process_count=\(group.count)")
    print("total_mb=\(String(format: "%.1f", Double(total) / 1_048_576))")
}

func cmdCpu(_ bundle: String, seconds: Int) {
    let g0 = processGroup(bundlePath: bundle)
    guard !g0.isEmpty else {
        fputs("error: no running process found for \(bundle)\n", stderr)
        exit(1)
    }
    // Deltas must be computed per process: helper/XPC processes can exit
    // mid-window (taking their accumulated CPU time with them), and a
    // group-total subtraction would then underflow to a giant number.
    var startNs: [pid_t: UInt64] = [:]
    for pid in g0 {
        if let ns = cpuTimeNs(pid) { startNs[pid] = ns }
    }
    let t0 = nowNs()
    sleep(UInt32(seconds))
    let wallNs = nowNs() - t0
    var deltaNs: UInt64 = 0
    for pid in Set(processGroup(bundlePath: bundle)) {
        guard let end = cpuTimeNs(pid) else { continue }
        if let start = startNs[pid] {
            if end > start { deltaNs += end - start }  // end < start ⇒ reused PID; skip
        } else {
            // born during the window, so all of its CPU time counts
            deltaNs += end
        }
    }
    // Processes that exited during the window are undercounted slightly;
    // for an idle measurement that error is negligible and conservative.
    let pct = Double(deltaNs) / Double(wallNs) * 100
    print("cpu_pct=\(String(format: "%.2f", pct))")
}

/// Dismiss the launcher window and report whether it is really gone.
/// Esc is used first: with an empty query all launchers close on Esc, and
/// unlike the hotkey it is never typed into the search field. (Raycast v1
/// treats a synthetic ⌥Space as text — a non-breaking space — when its own
/// search field has focus, so re-pressing the hotkey fills its query with
/// spaces and the window never hides.)
@discardableResult
func hideWindow(_ key: CGKeyCode, _ flags: CGEventFlags, pids: Set<pid_t>) -> Bool {
    if !launcherWindowVisible(pids: pids) { return true }
    for _ in 0..<3 {  // repeated Esc also clears any leftover query text first
        postKey(keyCodes["escape"]!, [])
        if waitFor(timeoutMs: 1500, { !launcherWindowVisible(pids: pids) }) != nil { return true }
    }
    postKey(key, flags)  // last resort: hotkey toggle
    return waitFor(timeoutMs: 1500, { !launcherWindowVisible(pids: pids) }) != nil
}

func cmdHotkey(_ bundle: String, spec: String, runs: Int) {
    requireAccessibility()
    guard let (key, flags) = parseKeySpec(spec) else {
        fputs("error: cannot parse keyspec '\(spec)'\n", stderr)
        exit(1)
    }
    let group = processGroup(bundlePath: bundle)
    guard !group.isEmpty else {
        fputs("error: \(bundle) is not running — launch it first\n", stderr)
        exit(1)
    }
    let pids = Set(group)

    var samples: [Double] = []
    var failures = 0
    hideWindow(key, flags, pids: pids)

    // one untimed warmup press so caches/first-paint costs don't skew run 1
    postKey(key, flags)
    _ = waitFor(timeoutMs: 5000) { launcherWindowVisible(pids: pids) }
    usleep(300_000)

    for run in 1...runs {
        // A run timed against an already-open window would measure ~0 ms,
        // so refuse to continue unless the window is really hidden.
        guard hideWindow(key, flags, pids: pids) else {
            fputs("error: could not hide the launcher window between runs — results would be invalid\n", stderr)
            exit(1)
        }
        usleep(400_000)
        let t0 = nowNs()
        postKey(key, flags)
        if waitFor(timeoutMs: 5000, pollUs: 300, { launcherWindowVisible(pids: pids) }) != nil {
            let ms = msSince(t0)
            samples.append(ms)
            print("run=\(run) ms=\(String(format: "%.1f", ms))")
        } else {
            failures += 1
            print("run=\(run) ms=timeout")
        }
        usleep(250_000)
    }
    hideWindow(key, flags, pids: pids)

    guard !samples.isEmpty, failures * 5 < runs else {
        fputs(
            "error: too many timeouts (\(failures)/\(runs)) — hotkey wrong or not registered in the app?\n",
            stderr)
        exit(1)
    }
    print("median_ms=\(String(format: "%.1f", median(samples)))")
    print("p95_ms=\(String(format: "%.1f", percentile(samples, 0.95)))")
    print("min_ms=\(String(format: "%.1f", samples.min()!))")
}

func cmdColdstart(_ bundle: String, spec: String) {
    requireAccessibility()
    guard let (key, flags) = parseKeySpec(spec) else {
        fputs("error: cannot parse keyspec '\(spec)'\n", stderr)
        exit(1)
    }
    guard processGroup(bundlePath: bundle).isEmpty else {
        fputs("error: \(bundle) is already running — quit it before a cold-start run\n", stderr)
        exit(1)
    }

    let t0 = nowNs()
    let open = Process()
    open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    open.arguments = [bundle]
    try? open.run()

    // Press the hotkey until the launcher answers with a window: measures
    // "launch → actually usable", not just "process exists".
    var lastPress: UInt64 = 0
    var pids: Set<pid_t> = []
    while msSince(t0) < 30_000 {
        if pids.isEmpty {
            pids = Set(processGroup(bundlePath: bundle))
        }
        if !pids.isEmpty, nowNs() - lastPress > 150_000_000 {
            postKey(key, flags)
            lastPress = nowNs()
        }
        if !pids.isEmpty, launcherWindowVisible(pids: pids) {
            print("coldstart_ms=\(String(format: "%.0f", msSince(t0)))")
            usleep(300_000)
            guard hideWindow(key, flags, pids: pids) else {
                fputs("error: could not hide the launcher window after cold start\n", stderr)
                exit(3)
            }
            // Some apps (Raycast) show a window by themselves on manual
            // launch, so the detection above does not prove the hotkey
            // works. Verify with one toggle now, instead of letting every
            // timed run fail later.
            usleep(400_000)
            postKey(key, flags)
            if waitFor(timeoutMs: 5000, { launcherWindowVisible(pids: pids) }) == nil {
                fputs(
                    "error: app is running but the hotkey does not summon it — the app may "
                        + "have NO hotkey registered (updates can clear it), a different key, "
                        + "or another launcher owns this key; check the app's settings\n",
                    stderr)
                exit(3)
            }
            usleep(300_000)
            hideWindow(key, flags, pids: pids)
            return
        }
        usleep(5000)
    }
    fputs("error: window never appeared within 30 s — wrong hotkey?\n", stderr)
    exit(1)
}

// MARK: - Entry point

let args = CommandLine.arguments
guard args.count >= 3 else {
    fputs(
        """
        usage: benchtool mem       <bundle-path>
               benchtool hotkey    <bundle-path> <keyspec> [runs]
               benchtool coldstart <bundle-path> <keyspec>
               benchtool cpu       <bundle-path> [seconds]
               benchtool group     <bundle-path>

        """, stderr)
    exit(64)
}

let bundle = (args[2] as NSString).standardizingPath
switch args[1] {
case "mem": cmdMem(bundle)
case "group": cmdGroup(bundle)
case "cpu": cmdCpu(bundle, seconds: args.count > 3 ? Int(args[3]) ?? 30 : 30)
case "hotkey":
    guard args.count >= 4 else {
        fputs("error: hotkey needs a keyspec, e.g. opt+space\n", stderr)
        exit(64)
    }
    cmdHotkey(bundle, spec: args[3], runs: args.count > 4 ? Int(args[4]) ?? 15 : 15)
case "coldstart":
    guard args.count >= 4 else {
        fputs("error: coldstart needs a keyspec, e.g. opt+space\n", stderr)
        exit(64)
    }
    cmdColdstart(bundle, spec: args[3])
default:
    fputs("error: unknown command '\(args[1])'\n", stderr)
    exit(64)
}
