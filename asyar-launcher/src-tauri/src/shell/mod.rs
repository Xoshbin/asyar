use crate::error::AppError;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub mod scheduler;

#[derive(Clone, Debug)]
pub struct ShellEntry {
    pub pid: u32,
    pub extension_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub started_at: u64,
    pub finished: bool,
    pub exit_code: Option<i32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ShellDescriptor {
    pub spawn_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub pid: u32,
    pub started_at: u64,
}

impl ShellDescriptor {
    fn from_entry(spawn_id: &str, entry: &ShellEntry) -> Self {
        Self {
            spawn_id: spawn_id.to_string(),
            program: entry.program.clone(),
            args: entry.args.clone(),
            pid: entry.pid,
            started_at: entry.started_at,
        }
    }
}

pub struct ShellProcessRegistry {
    entries: Arc<Mutex<HashMap<String, ShellEntry>>>,
}

impl Clone for ShellProcessRegistry {
    fn clone(&self) -> Self {
        Self {
            entries: Arc::clone(&self.entries),
        }
    }
}

impl Default for ShellProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ShellProcessRegistry {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register_spawn(
        &self,
        spawn_id: &str,
        extension_id: &str,
        program: &str,
        args: &[String],
        pid: u32,
    ) -> Result<(), AppError> {
        let mut map = self.entries.lock().map_err(|_| AppError::Lock)?;
        map.insert(
            spawn_id.to_string(),
            ShellEntry {
                pid,
                extension_id: extension_id.to_string(),
                program: program.to_string(),
                args: args.to_vec(),
                started_at: now_millis(),
                finished: false,
                exit_code: None,
            },
        );
        Ok(())
    }

    pub fn mark_finished(&self, spawn_id: &str, exit_code: Option<i32>) -> Result<(), AppError> {
        let mut map = self.entries.lock().map_err(|_| AppError::Lock)?;
        if let Some(entry) = map.get_mut(spawn_id) {
            entry.finished = true;
            entry.exit_code = exit_code;
        }
        Ok(())
    }

    /// Returns the entry only when the caller owns it. Cross-extension
    /// lookups get `None` — same shape as "not found" so callers cannot
    /// distinguish ownership errors from missing IDs via this method alone.
    pub fn get(&self, spawn_id: &str, extension_id: &str) -> Result<Option<ShellEntry>, AppError> {
        let map = self.entries.lock().map_err(|_| AppError::Lock)?;
        Ok(map
            .get(spawn_id)
            .filter(|e| e.extension_id == extension_id)
            .cloned())
    }

    pub fn contains(&self, spawn_id: &str) -> Result<bool, AppError> {
        let map = self.entries.lock().map_err(|_| AppError::Lock)?;
        Ok(map.contains_key(spawn_id))
    }

    /// Live (not-finished) spawns owned by the given extension, sorted by
    /// ascending `started_at`.
    pub fn list_for_extension(
        &self,
        extension_id: &str,
    ) -> Result<Vec<ShellDescriptor>, AppError> {
        let map = self.entries.lock().map_err(|_| AppError::Lock)?;
        let mut out: Vec<ShellDescriptor> = map
            .iter()
            .filter(|(_, e)| e.extension_id == extension_id && !e.finished)
            .map(|(sid, e)| ShellDescriptor::from_entry(sid, e))
            .collect();
        out.sort_by_key(|d| d.started_at);
        Ok(out)
    }

    pub fn remove(&self, spawn_id: &str) -> Result<Option<ShellEntry>, AppError> {
        let mut map = self.entries.lock().map_err(|_| AppError::Lock)?;
        Ok(map.remove(spawn_id))
    }

    /// Drops every entry owned by `extension_id` and returns their pids.
    /// Lifecycle hooks should call [`Self::kill_all_for_extension`] so the
    /// underlying processes are actually signalled — this method is the
    /// testable drop-only primitive so unit tests don't invoke `libc::kill`.
    pub fn remove_all_for_extension(&self, extension_id: &str) -> Result<Vec<u32>, AppError> {
        let mut map = self.entries.lock().map_err(|_| AppError::Lock)?;
        let victim_ids: Vec<String> = map
            .iter()
            .filter(|(_, e)| e.extension_id == extension_id)
            .map(|(sid, _)| sid.clone())
            .collect();
        let mut pids = Vec::with_capacity(victim_ids.len());
        for sid in victim_ids {
            if let Some(entry) = map.remove(&sid) {
                pids.push(entry.pid);
            }
        }
        Ok(pids)
    }

    /// Lifecycle-facing: drains entries and signals each pid.
    pub fn kill_all_for_extension(&self, extension_id: &str) -> Result<usize, AppError> {
        let pids = self.remove_all_for_extension(extension_id)?;
        let n = pids.len();
        for pid in pids {
            kill_pid(pid);
        }
        Ok(n)
    }

    pub fn prune_finished(
        &self,
        older_than_millis: u64,
        now_millis: u64,
    ) -> Result<usize, AppError> {
        let mut map = self.entries.lock().map_err(|_| AppError::Lock)?;
        Ok(prune_finished_entries(&mut map, older_than_millis, now_millis))
    }
}

/// Drops finished entries whose `started_at` is older than
/// `older_than_millis` relative to `now_millis`. Kept finished entries for
/// ~10min so reattach-right-after-exit resolves the stored exit_code before
/// the GC scheduler collects them.
pub(crate) fn prune_finished_entries(
    entries: &mut HashMap<String, ShellEntry>,
    older_than_millis: u64,
    now_millis: u64,
) -> usize {
    let to_drop: Vec<String> = entries
        .iter()
        .filter(|(_, e)| {
            e.finished && now_millis.saturating_sub(e.started_at) >= older_than_millis
        })
        .map(|(sid, _)| sid.clone())
        .collect();
    let n = to_drop.len();
    for sid in to_drop {
        entries.remove(&sid);
    }
    n
}

fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        // Guardrail: libc::kill treats pid ≤ 0 as broadcast (0 = process
        // group, -1 = every process the caller can signal). A u32 cast to
        // i32 becomes negative for pid > i32::MAX, so reject those before
        // syscalling. Real tokio-spawned PIDs never reach that range on
        // any supported OS, so a rejection here only fires on fake test
        // pids or outright bugs.
        let Ok(signed) = i32::try_from(pid) else {
            log::warn!("[shell] refusing to signal out-of-range pid {pid}");
            return;
        };
        if signed <= 0 {
            log::warn!("[shell] refusing to signal non-positive pid {signed}");
            return;
        }
        unsafe {
            libc::kill(signed, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
        unsafe {
            if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                let _ = TerminateProcess(handle, 1);
                let _ = CloseHandle(handle);
            }
        }
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellChunkPayload {
    pub spawn_id: String,
    pub stream: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellDonePayload {
    pub spawn_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellErrorPayload {
    pub spawn_id: String,
    pub message: String,
}

pub fn spawn(
    app: AppHandle,
    shell_registry: &ShellProcessRegistry,
    spawn_id: String,
    extension_id: String,
    program: String,
    args: Vec<String>,
) -> Result<(), AppError> {
    let mut child_process = std::process::Command::new(&program);
    child_process
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = Command::from(child_process).spawn()?;

    let pid = child
        .id()
        .ok_or_else(|| AppError::Other("Failed to capture process ID".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("Failed to capture stdout".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Other("Failed to capture stderr".to_string()))?;

    shell_registry.register_spawn(&spawn_id, &extension_id, &program, &args, pid)?;

    let app_clone = app.clone();
    let spawn_id_clone = spawn_id.clone();
    let registry_clone = shell_registry.clone();

    tokio::spawn(async move {
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let app_c1 = app_clone.clone();
        let sid_c1 = spawn_id_clone.clone();
        let stdout_task = async move {
            while let Ok(Some(data)) = stdout_reader.next_line().await {
                let _ = app_c1.emit(
                    "asyar:shell:chunk",
                    ShellChunkPayload {
                        spawn_id: sid_c1.clone(),
                        stream: "stdout".to_string(),
                        data,
                    },
                );
            }
        };

        let app_c2 = app_clone.clone();
        let sid_c2 = spawn_id_clone.clone();
        let stderr_task = async move {
            while let Ok(Some(data)) = stderr_reader.next_line().await {
                let _ = app_c2.emit(
                    "asyar:shell:chunk",
                    ShellChunkPayload {
                        spawn_id: sid_c2.clone(),
                        stream: "stderr".to_string(),
                        data,
                    },
                );
            }
        };

        let wait_task = child.wait();

        let (_, _, status_result) = tokio::join!(stdout_task, stderr_task, wait_task);

        match status_result {
            Ok(status) => {
                let exit_code = status.code();
                // Mark finished before emit so an attach landing in the gap
                // between emit and its Tauri listener still sees the state.
                let _ = registry_clone.mark_finished(&spawn_id_clone, exit_code);
                let _ = app_clone.emit(
                    "asyar:shell:done",
                    ShellDonePayload {
                        spawn_id: spawn_id_clone,
                        exit_code,
                    },
                );
            }
            Err(e) => {
                let _ = registry_clone.mark_finished(&spawn_id_clone, None);
                let _ = app_clone.emit(
                    "asyar:shell:error",
                    ShellErrorPayload {
                        spawn_id: spawn_id_clone,
                        message: e.to_string(),
                    },
                );
            }
        }
    });

    Ok(())
}

pub fn kill(shell_registry: &ShellProcessRegistry, spawn_id: &str) -> Result<(), AppError> {
    if let Some(entry) = shell_registry.remove(spawn_id)? {
        kill_pid(entry.pid);
    }
    Ok(())
}

pub async fn resolve_path(program: &str) -> Result<String, AppError> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = Command::new(cmd).arg(program).output().await?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let first_path = path.lines().next().unwrap_or(&path).to_string();
        Ok(first_path)
    } else {
        Err(AppError::NotFound(format!(
            "Executable \"{}\" not found.",
            program
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn register_entry(reg: &ShellProcessRegistry, spawn_id: &str, ext: &str, pid: u32) {
        reg.register_spawn(spawn_id, ext, "/bin/echo", &["hello".to_string()], pid)
            .expect("register ok");
    }

    #[test]
    fn list_for_extension_returns_only_matching_entries() {
        let reg = ShellProcessRegistry::new();
        register_entry(&reg, "s1", "ext-a", 100);
        register_entry(&reg, "s2", "ext-b", 101);
        register_entry(&reg, "s3", "ext-a", 102);
        let list_a = reg.list_for_extension("ext-a").unwrap();
        assert_eq!(list_a.len(), 2);
        let ids: Vec<&str> = list_a.iter().map(|d| d.spawn_id.as_str()).collect();
        assert!(ids.contains(&"s1"));
        assert!(ids.contains(&"s3"));
        assert!(!ids.contains(&"s2"));
    }

    #[test]
    fn list_for_extension_excludes_finished_entries() {
        let reg = ShellProcessRegistry::new();
        register_entry(&reg, "s1", "ext-a", 100);
        register_entry(&reg, "s2", "ext-a", 101);
        reg.mark_finished("s1", Some(0)).unwrap();
        let live = reg.list_for_extension("ext-a").unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].spawn_id, "s2");
    }

    #[test]
    fn list_for_extension_sorts_by_started_at() {
        let reg = ShellProcessRegistry::new();
        register_entry(&reg, "s1", "ext-a", 100);
        std::thread::sleep(std::time::Duration::from_millis(2));
        register_entry(&reg, "s2", "ext-a", 101);
        let list = reg.list_for_extension("ext-a").unwrap();
        assert_eq!(list[0].spawn_id, "s1");
        assert_eq!(list[1].spawn_id, "s2");
    }

    #[test]
    fn mark_finished_keeps_entry_reachable_via_get() {
        let reg = ShellProcessRegistry::new();
        register_entry(&reg, "s1", "ext-a", 100);
        reg.mark_finished("s1", Some(0)).unwrap();
        let found = reg
            .get("s1", "ext-a")
            .unwrap()
            .expect("finished entry should still be reachable");
        assert!(found.finished);
        assert_eq!(found.exit_code, Some(0));
    }

    #[test]
    fn get_returns_entry_for_same_extension() {
        let reg = ShellProcessRegistry::new();
        register_entry(&reg, "s1", "ext-a", 100);
        let result = reg.get("s1", "ext-a").unwrap().expect("entry for owner");
        assert_eq!(result.pid, 100);
    }

    #[test]
    fn get_returns_none_on_cross_extension_attempt() {
        let reg = ShellProcessRegistry::new();
        register_entry(&reg, "s1", "ext-a", 100);
        let result = reg.get("s1", "ext-b").unwrap();
        assert!(result.is_none(), "cross-extension get must not leak entry");
    }

    #[test]
    fn get_returns_none_for_unknown_spawn_id() {
        let reg = ShellProcessRegistry::new();
        let result = reg.get("unknown", "ext-a").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn contains_is_owner_agnostic() {
        let reg = ShellProcessRegistry::new();
        register_entry(&reg, "s1", "ext-a", 100);
        assert!(reg.contains("s1").unwrap());
        assert!(!reg.contains("missing").unwrap());
    }

    #[test]
    fn remove_all_for_extension_drops_only_matching_entries() {
        let reg = ShellProcessRegistry::new();
        register_entry(&reg, "s1", "ext-a", 100);
        register_entry(&reg, "s2", "ext-b", 101);
        register_entry(&reg, "s3", "ext-a", 102);
        let removed = reg.remove_all_for_extension("ext-a").unwrap();
        assert_eq!(removed.len(), 2);
        assert!(removed.contains(&100));
        assert!(removed.contains(&102));
        assert!(reg.get("s2", "ext-b").unwrap().is_some());
        assert!(reg.get("s1", "ext-a").unwrap().is_none());
        assert!(reg.get("s3", "ext-a").unwrap().is_none());
    }

    #[test]
    fn prune_finished_drops_old_finished_entries() {
        let mut map: HashMap<String, ShellEntry> = HashMap::new();
        map.insert(
            "old-finished".into(),
            ShellEntry {
                pid: 1,
                extension_id: "ext-a".into(),
                program: "p".into(),
                args: vec![],
                started_at: 0,
                finished: true,
                exit_code: Some(0),
            },
        );
        map.insert(
            "recent-finished".into(),
            ShellEntry {
                pid: 2,
                extension_id: "ext-a".into(),
                program: "p".into(),
                args: vec![],
                started_at: 500_000,
                finished: true,
                exit_code: Some(0),
            },
        );
        map.insert(
            "old-live".into(),
            ShellEntry {
                pid: 3,
                extension_id: "ext-a".into(),
                program: "p".into(),
                args: vec![],
                started_at: 0,
                finished: false,
                exit_code: None,
            },
        );
        let dropped = prune_finished_entries(&mut map, 600_000, 600_000);
        assert_eq!(dropped, 1);
        assert!(!map.contains_key("old-finished"));
        assert!(map.contains_key("recent-finished"));
        assert!(map.contains_key("old-live"));
    }

    #[test]
    fn prune_finished_is_noop_when_nothing_eligible() {
        let mut map: HashMap<String, ShellEntry> = HashMap::new();
        map.insert(
            "live".into(),
            ShellEntry {
                pid: 1,
                extension_id: "ext-a".into(),
                program: "p".into(),
                args: vec![],
                started_at: 0,
                finished: false,
                exit_code: None,
            },
        );
        map.insert(
            "young-finished".into(),
            ShellEntry {
                pid: 2,
                extension_id: "ext-a".into(),
                program: "p".into(),
                args: vec![],
                started_at: 590_000,
                finished: true,
                exit_code: Some(0),
            },
        );
        let dropped = prune_finished_entries(&mut map, 600_000, 600_000);
        assert_eq!(dropped, 0);
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn prune_finished_does_not_touch_live_entries() {
        let mut map: HashMap<String, ShellEntry> = HashMap::new();
        map.insert(
            "stale-live".into(),
            ShellEntry {
                pid: 1,
                extension_id: "ext-a".into(),
                program: "p".into(),
                args: vec![],
                started_at: 0,
                finished: false,
                exit_code: None,
            },
        );
        let dropped = prune_finished_entries(&mut map, 1, 1_000_000);
        assert_eq!(dropped, 0);
        assert!(map.contains_key("stale-live"));
    }

    #[test]
    fn register_spawn_populates_fields() {
        let reg = ShellProcessRegistry::new();
        let before = now_millis();
        reg.register_spawn("s1", "ext-a", "/bin/true", &["--flag".into()], 42)
            .unwrap();
        let after = now_millis();

        let entry = reg.get("s1", "ext-a").unwrap().unwrap();
        assert_eq!(entry.pid, 42);
        assert_eq!(entry.extension_id, "ext-a");
        assert_eq!(entry.program, "/bin/true");
        assert_eq!(entry.args, vec!["--flag".to_string()]);
        assert!(!entry.finished);
        assert!(entry.exit_code.is_none());
        assert!(entry.started_at >= before && entry.started_at <= after);
    }
}
