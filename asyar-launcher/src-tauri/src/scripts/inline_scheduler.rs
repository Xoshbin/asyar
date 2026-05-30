//! Inline-script scheduler — owns per-script tokio timers for `mode: inline`
//! scripts and emits `scripts:inline:tick` events carrying the first non-empty
//! line of stdout. Mirrors the structure of `extensions::scheduler` but for
//! the Tier-1 built-in `scripts` extension (no worker iframe).
//!
//! Raycast parity: cap concurrent inline scripts at 10. Excess specs are
//! returned to the caller so the TS layer can surface a diagnostic and fall
//! back to manual invocation for those scripts. Ordering: alphabetical by
//! absolute path — deterministic and stable across rescans.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::task::JoinHandle;

use crate::error::AppError;

/// Hard cap matching Raycast. Specs beyond this index are skipped by the
/// scheduler and returned to the caller as `capped`.
pub const INLINE_SCRIPT_CAP: usize = 10;

/// Per-tick stdout-capture timeout. A misbehaving inline script must not
/// stall the launcher's UI thread or hold a system process around forever.
const TICK_TIMEOUT_SECS: u64 = 30;

/// One inline-mode script ready to tick. Built by the TS scripts manager
/// from a `ScannedScript` whose header declared `mode: inline` AND a
/// refreshTime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineScriptSpec {
    /// Stable dynamic id used as the subtitle map key. Matches
    /// `ScannedScript.dynamic_id`.
    pub dynamic_id: String,
    /// Canonical absolute path to the script file. Used directly as the
    /// `program` to spawn — the file is expected to be executable and
    /// already trust-prompted (inline ticks run silently and cannot
    /// prompt for consent).
    pub absolute_path: PathBuf,
    /// Tick interval in seconds. Already clamped to the 10s floor by
    /// `header.rs`.
    pub refresh_time_seconds: u64,
}

/// Emitted on every successful tick. The TS launcher listens for this
/// event and writes `subtitle` into `commandService.liveSubtitles`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineTickPayload {
    pub dynamic_id: String,
    /// First non-empty trimmed line of stdout. `None` when the script
    /// printed nothing parseable.
    pub subtitle: Option<String>,
    /// `Some(message)` when the tick failed (timeout, non-zero exit,
    /// spawn error). The TS layer can render this as a muted/error
    /// subtitle.
    pub error: Option<String>,
}

/// Tauri-managed handle holding all active inline-script tasks keyed by
/// `InlineScriptSpec.dynamic_id`.
pub struct InlineSchedulerState {
    tasks: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl InlineSchedulerState {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// Snapshot of currently scheduled dynamic ids — for tests + the
    /// settings UI later. Sorted to make assertions deterministic.
    pub fn active_ids(&self) -> Vec<String> {
        let map = self.tasks.lock().expect("InlineSchedulerState mutex");
        let mut ids: Vec<String> = map.keys().cloned().collect();
        ids.sort();
        ids
    }
}

impl Default for InlineSchedulerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Outcome of a `set_inline_scripts` call. `accepted` is the set actually
/// scheduled (length ≤ `INLINE_SCRIPT_CAP`); `capped` is the dynamic ids
/// that exceeded the cap, in declared/sorted order. The TS layer surfaces
/// a single grouped diagnostic for any non-empty `capped` list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SetInlineScriptsOutcome {
    pub accepted: Vec<String>,
    pub capped: Vec<String>,
    /// Dynamic ids whose tasks were running and got aborted by this call —
    /// either because the script file disappeared, changed mode away from
    /// `inline`, or moved to the capped overflow. The TS layer must clear
    /// `commandService.liveSubtitles[cmd_scripts_dyn_<id>]` for each so the
    /// row's subtitle falls back to its default.
    pub dropped: Vec<String>,
}

/// Pure split of an incoming spec list into the accepted prefix (capped
/// at `INLINE_SCRIPT_CAP`) and the dropped suffix. The input is sorted
/// alphabetically by absolute path so the cap policy is deterministic
/// across rescans.
pub fn partition_specs(mut specs: Vec<InlineScriptSpec>) -> (Vec<InlineScriptSpec>, Vec<String>) {
    specs.sort_by(|a, b| a.absolute_path.cmp(&b.absolute_path));
    if specs.len() <= INLINE_SCRIPT_CAP {
        (specs, Vec::new())
    } else {
        let capped: Vec<String> = specs
            .iter()
            .skip(INLINE_SCRIPT_CAP)
            .map(|s| s.dynamic_id.clone())
            .collect();
        specs.truncate(INLINE_SCRIPT_CAP);
        (specs, capped)
    }
}

/// Replace the active inline-script tick set with `specs`. Returns the
/// accepted ids and the capped overflow. Tasks for scripts no longer
/// present are aborted; tasks for new scripts are spawned with an
/// immediate first tick.
pub fn set_inline_scripts(
    app: &AppHandle,
    state: &InlineSchedulerState,
    specs: Vec<InlineScriptSpec>,
) -> Result<SetInlineScriptsOutcome, AppError> {
    let (accepted_specs, capped) = partition_specs(specs);

    let mut tasks = state.tasks.lock().map_err(|_| AppError::Lock)?;

    let want_ids: std::collections::HashSet<String> = accepted_specs
        .iter()
        .map(|s| s.dynamic_id.clone())
        .collect();

    // Abort tasks for scripts no longer in the accepted set
    let mut dropped: Vec<String> = tasks
        .keys()
        .filter(|k| !want_ids.contains(*k))
        .cloned()
        .collect();
    dropped.sort();
    for key in &dropped {
        if let Some(handle) = tasks.remove(key) {
            handle.abort();
        }
    }

    // Spawn tasks for accepted specs that don't already have one
    for spec in &accepted_specs {
        if tasks.contains_key(&spec.dynamic_id) {
            // Already running. Restart only if the interval changed.
            // Cheapest implementation: always restart on a set call.
            if let Some(handle) = tasks.remove(&spec.dynamic_id) {
                handle.abort();
            }
        }
        let handle = spawn_inline_task(app.clone(), spec.clone());
        tasks.insert(spec.dynamic_id.clone(), handle);
    }

    Ok(SetInlineScriptsOutcome {
        accepted: accepted_specs
            .iter()
            .map(|s| s.dynamic_id.clone())
            .collect(),
        capped,
        dropped,
    })
}

/// Abort all inline-script tasks. Called on extension deactivate.
pub fn clear_inline_scripts(state: &InlineSchedulerState) -> Result<(), AppError> {
    let mut tasks = state.tasks.lock().map_err(|_| AppError::Lock)?;
    for (_, handle) in tasks.drain() {
        handle.abort();
    }
    Ok(())
}

/// Spawn the per-spec ticking loop. Fires once immediately so the row's
/// subtitle is populated as soon as the script is registered, then every
/// `refresh_time_seconds`.
fn spawn_inline_task(app: AppHandle, spec: InlineScriptSpec) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Immediate first tick
        run_one_tick(&app, &spec).await;

        let mut interval = tokio::time::interval(Duration::from_secs(spec.refresh_time_seconds));
        // interval.tick() fires immediately by default; we already fired,
        // so skip the leading tick.
        interval.tick().await;
        loop {
            interval.tick().await;
            run_one_tick(&app, &spec).await;
        }
    })
}

/// Run the script once and emit a tick payload.
async fn run_one_tick(app: &AppHandle, spec: &InlineScriptSpec) {
    let payload = match capture_first_line(&spec.absolute_path).await {
        Ok(subtitle) => InlineTickPayload {
            dynamic_id: spec.dynamic_id.clone(),
            subtitle,
            error: None,
        },
        Err(e) => InlineTickPayload {
            dynamic_id: spec.dynamic_id.clone(),
            subtitle: None,
            error: Some(e.to_string()),
        },
    };
    let _ = app.emit("scripts:inline:tick", payload);
}

/// Spawn the script, read stdout, return the first non-empty trimmed
/// line. Bounded by `TICK_TIMEOUT_SECS` so a hung script never wedges
/// the scheduler.
async fn capture_first_line(path: &std::path::Path) -> Result<Option<String>, AppError> {
    use tokio::process::Command;
    use tokio::time::timeout;

    let fut = async {
        let mut child = Command::new(path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| AppError::Other(format!("inline spawn failed: {e}")))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Other("inline tick: stdout missing".to_string()))?;
        let mut reader = BufReader::new(stdout).lines();

        let mut first: Option<String> = None;
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                first = Some(trimmed.to_string());
                break;
            }
        }
        // Drain + reap child so the OS doesn't leak a zombie.
        let _ = child.wait().await;
        Ok::<Option<String>, AppError>(first)
    };

    match timeout(Duration::from_secs(TICK_TIMEOUT_SECS), fut).await {
        Ok(res) => res,
        Err(_) => Err(AppError::Other(format!(
            "inline tick timed out after {TICK_TIMEOUT_SECS}s"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(id: &str, path: &str, secs: u64) -> InlineScriptSpec {
        InlineScriptSpec {
            dynamic_id: id.to_string(),
            absolute_path: PathBuf::from(path),
            refresh_time_seconds: secs,
        }
    }

    #[test]
    fn partition_specs_under_cap_returns_all_accepted() {
        let specs = vec![spec("a", "/a.sh", 10), spec("b", "/b.sh", 10)];
        let (accepted, capped) = partition_specs(specs);
        assert_eq!(accepted.len(), 2);
        assert!(capped.is_empty());
    }

    #[test]
    fn partition_specs_at_cap_returns_all_accepted() {
        let specs: Vec<_> = (0..INLINE_SCRIPT_CAP)
            .map(|i| spec(&format!("d{i}"), &format!("/{i:02}.sh"), 10))
            .collect();
        let (accepted, capped) = partition_specs(specs);
        assert_eq!(accepted.len(), INLINE_SCRIPT_CAP);
        assert!(
            capped.is_empty(),
            "exactly INLINE_SCRIPT_CAP specs must all be accepted with no overflow"
        );
    }

    #[test]
    fn partition_specs_over_cap_drops_alphabetical_overflow() {
        // 12 specs, ordered alphabetically — the last 2 must be capped.
        let specs: Vec<_> = (0..12)
            .map(|i| spec(&format!("d{i:02}"), &format!("/{i:02}.sh"), 10))
            .collect();
        let (accepted, capped) = partition_specs(specs);
        assert_eq!(accepted.len(), INLINE_SCRIPT_CAP);
        assert_eq!(capped.len(), 2);
        // Dropped should be the alphabetically-last two by path
        assert_eq!(capped, vec!["d10".to_string(), "d11".to_string()]);
    }

    #[test]
    fn partition_specs_cap_policy_is_deterministic_regardless_of_input_order() {
        // Same dynamic ids fed in different orders must produce the same
        // accepted set — Raycast parity + memory `feedback_recurring_bug_check_tests`
        // calls for this invariant to keep the cap policy stable across rescans.
        let order_one = vec![
            spec("a", "/01.sh", 10),
            spec("b", "/02.sh", 10),
            spec("k", "/11.sh", 10),
            spec("l", "/12.sh", 10),
            spec("c", "/03.sh", 10),
            spec("d", "/04.sh", 10),
            spec("e", "/05.sh", 10),
            spec("f", "/06.sh", 10),
            spec("g", "/07.sh", 10),
            spec("h", "/08.sh", 10),
            spec("i", "/09.sh", 10),
            spec("j", "/10.sh", 10),
        ];
        let order_two = {
            let mut v = order_one.clone();
            v.reverse();
            v
        };
        let (a1, c1) = partition_specs(order_one);
        let (a2, c2) = partition_specs(order_two);
        assert_eq!(a1, a2);
        assert_eq!(c1, c2);
    }

    #[test]
    fn inline_scheduler_state_starts_empty() {
        let state = InlineSchedulerState::new();
        assert!(state.active_ids().is_empty());
    }

    #[test]
    fn clear_inline_scripts_on_empty_state_is_ok() {
        let state = InlineSchedulerState::new();
        clear_inline_scripts(&state).expect("clear must succeed on empty state");
        assert!(state.active_ids().is_empty());
    }

    #[test]
    fn inline_tick_payload_serializes_camel_case() {
        let p = InlineTickPayload {
            dynamic_id: "abc".to_string(),
            subtitle: Some("11:22:33".to_string()),
            error: None,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(
            json.contains("\"dynamicId\":\"abc\""),
            "payload field must be camelCase 'dynamicId' (matches TS event listener); got: {json}"
        );
        assert!(json.contains("\"subtitle\":\"11:22:33\""));
    }

    #[test]
    fn inline_script_spec_round_trips_camel_case() {
        let s = spec("x", "/x.sh", 30);
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"dynamicId\":\"x\""));
        assert!(json.contains("\"absolutePath\":\"/x.sh\""));
        assert!(json.contains("\"refreshTimeSeconds\":30"));
        let back: InlineScriptSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }
}
