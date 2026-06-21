//! Cross-platform "is this an OS-critical process?" classifier.
//!
//! `classify` takes an explicit `Os` so every platform's rules are unit
//! testable on any CI host. `is_protected` applies the current platform's
//! rules.

use crate::process_manager::types::RawProcess;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Macos,
    Windows,
    Linux,
}

/// Apply `os`'s rules to a single process.
pub fn classify(os: Os, p: &RawProcess) -> bool {
    match os {
        Os::Macos => macos_rule(p),
        Os::Windows => windows_rule(p),
        Os::Linux => linux_rule(p),
    }
}

/// Apply the current platform's rules.
pub fn is_protected(p: &RawProcess) -> bool {
    #[cfg(target_os = "macos")]
    {
        classify(Os::Macos, p)
    }
    #[cfg(target_os = "windows")]
    {
        classify(Os::Windows, p)
    }
    #[cfg(target_os = "linux")]
    {
        classify(Os::Linux, p)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = p;
        false
    }
}

fn macos_rule(p: &RawProcess) -> bool {
    const CORE: &[&str] = &[
        "kernel_task",
        "launchd",
        "WindowServer",
        "loginwindow",
        "Dock",
        "Finder",
    ];
    if CORE.contains(&p.name.as_str()) {
        return true;
    }
    let root = p.owner == "root" || p.owner.is_empty();
    let sys_path = p.exe_path.starts_with("/System/")
        || p.exe_path.starts_with("/usr/libexec/")
        || p.exe_path.starts_with("/sbin/")
        || p.exe_path.starts_with("/usr/sbin/");
    root && sys_path
}

fn windows_rule(p: &RawProcess) -> bool {
    const CORE: &[&str] = &[
        "System",
        "smss.exe",
        "csrss.exe",
        "wininit.exe",
        "services.exe",
        "lsass.exe",
        "winlogon.exe",
    ];
    let name = p.name.to_ascii_lowercase();
    CORE.iter().any(|c| c.to_ascii_lowercase() == name)
        || (p.owner.eq_ignore_ascii_case("SYSTEM")
            && p.exe_path
                .to_ascii_lowercase()
                .contains("\\windows\\system32"))
}

fn linux_rule(p: &RawProcess) -> bool {
    if p.pid == 1 {
        return true; // init / systemd
    }
    if p.parent_pid == Some(2) || p.pid == 2 {
        return true; // kernel threads (kthreadd is pid 2)
    }
    let root = p.owner == "root" || p.owner.is_empty();
    root && (p.exe_path.starts_with("/usr/sbin/") || p.exe_path.starts_with("/sbin/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(name: &str, owner: &str, exe: &str, ppid: Option<u32>) -> RawProcess {
        RawProcess {
            pid: 100,
            parent_pid: ppid,
            name: name.into(),
            cpu_percent: 0.0,
            memory_bytes: 0,
            exe_path: exe.into(),
            owner: owner.into(),
        }
    }

    #[test]
    fn macos_system_paths_and_core_names_are_protected() {
        assert!(classify(
            Os::Macos,
            &raw("WindowServer", "root", "/System/Library/...", None)
        ));
        assert!(classify(
            Os::Macos,
            &raw("launchd", "root", "/sbin/launchd", None)
        ));
        assert!(classify(
            Os::Macos,
            &raw("x", "root", "/usr/libexec/x", None)
        ));
    }

    #[test]
    fn macos_user_app_is_not_protected() {
        assert!(!classify(
            Os::Macos,
            &raw(
                "Google Chrome",
                "alice",
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                None
            )
        ));
    }

    #[test]
    fn windows_core_names_are_protected() {
        for n in [
            "System",
            "csrss.exe",
            "wininit.exe",
            "services.exe",
            "lsass.exe",
            "winlogon.exe",
            "smss.exe",
        ] {
            assert!(
                classify(
                    Os::Windows,
                    &raw(n, "SYSTEM", "C:\\Windows\\System32", None)
                ),
                "{n}"
            );
        }
    }

    #[test]
    fn linux_init_and_kernel_threads_are_protected() {
        let mut init = raw("systemd", "root", "/usr/lib/systemd/systemd", None);
        init.pid = 1;
        assert!(classify(Os::Linux, &init));
        assert!(classify(
            Os::Linux,
            &raw("kworker/0:1", "root", "", Some(2))
        )); // ppid 2 = kthreadd
    }

    #[test]
    fn linux_user_app_is_not_protected() {
        let mut p = raw("code", "alice", "/usr/share/code/code", Some(1234));
        p.pid = 1234;
        assert!(!classify(Os::Linux, &p));
    }
}
