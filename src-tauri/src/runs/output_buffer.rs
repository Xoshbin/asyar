use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

/// Maximum number of output lines retained per run.
/// When the cap is exceeded the oldest line is evicted.
pub const MAX_LINES_PER_RUN: usize = 10_000;

/// Per-run ring buffer of streamed output lines (stdout / stderr).
/// Singleton via `instance()`; tests should construct isolated instances
/// with `new_for_test()`.
pub struct OutputBuffer {
    buffers: Mutex<HashMap<String, VecDeque<String>>>,
}

static INSTANCE: OnceLock<OutputBuffer> = OnceLock::new();

impl OutputBuffer {
    /// Returns the global singleton instance.
    pub fn instance() -> &'static OutputBuffer {
        INSTANCE.get_or_init(|| OutputBuffer {
            buffers: Mutex::new(HashMap::new()),
        })
    }

    /// Append `line` to the buffer for `run_id`.
    /// If the buffer already holds `MAX_LINES_PER_RUN` lines the oldest
    /// line is dropped before the new one is pushed.
    pub fn append(&self, run_id: &str, line: String) {
        let mut guard = self.buffers.lock().expect("OutputBuffer mutex poisoned");
        let vec = guard.entry(run_id.to_string()).or_default();
        vec.push_back(line);
        if vec.len() > MAX_LINES_PER_RUN {
            vec.pop_front();
        }
    }

    /// Return a cloned snapshot of all lines for `run_id` in chronological
    /// order.  Returns an empty `Vec` if `run_id` has no buffer.
    pub fn snapshot(&self, run_id: &str) -> Vec<String> {
        let guard = self.buffers.lock().expect("OutputBuffer mutex poisoned");
        match guard.get(run_id) {
            None => Vec::new(),
            Some(vec) => vec.iter().cloned().collect(),
        }
    }

    /// Remove the buffer entry for `run_id`.  No-op if the id is absent.
    pub fn drop_for_run(&self, run_id: &str) {
        let mut guard = self.buffers.lock().expect("OutputBuffer mutex poisoned");
        guard.remove(run_id);
    }

    /// Return the current number of lines stored for `run_id`.
    /// Returns `0` if `run_id` has no buffer.
    pub fn line_count(&self, run_id: &str) -> usize {
        let guard = self.buffers.lock().expect("OutputBuffer mutex poisoned");
        guard.get(run_id).map(|v| v.len()).unwrap_or(0)
    }
}

#[cfg(test)]
impl OutputBuffer {
    /// Construct a fresh, isolated buffer for unit tests.
    /// Never shares state with the global `instance()`.
    pub fn new_for_test() -> Self {
        OutputBuffer {
            buffers: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_buffer() -> OutputBuffer {
        OutputBuffer::new_for_test()
    }

    /// Append 3 lines for run_id "r1", snapshot returns those 3 lines in order.
    #[test]
    fn append_then_snapshot_round_trips() {
        let buf = make_buffer();
        buf.append("r1", "line 0".to_string());
        buf.append("r1", "line 1".to_string());
        buf.append("r1", "line 2".to_string());

        let snap = buf.snapshot("r1");
        assert_eq!(snap, vec!["line 0", "line 1", "line 2"]);
    }

    /// snapshot for an id that was never appended returns an empty Vec.
    #[test]
    fn snapshot_unknown_id_returns_empty() {
        let buf = make_buffer();
        let snap = buf.snapshot("never-seen");
        assert!(snap.is_empty(), "expected empty snapshot for unknown id, got {snap:?}");
    }

    /// After appending MAX_LINES_PER_RUN + 5 lines, the snapshot length is
    /// exactly MAX_LINES_PER_RUN and the first retained line is the one at
    /// index 5 (lines 0..4 were evicted).
    #[test]
    fn cap_drops_oldest_when_exceeding_max() {
        let buf = make_buffer();
        let total = MAX_LINES_PER_RUN + 5;
        for i in 0..total {
            buf.append("r1", format!("line {i}"));
        }

        let snap = buf.snapshot("r1");
        assert_eq!(
            snap.len(),
            MAX_LINES_PER_RUN,
            "snapshot must be capped at MAX_LINES_PER_RUN"
        );
        assert_eq!(
            snap[0], "line 5",
            "oldest 5 lines must have been evicted; first retained is line 5"
        );
    }

    /// append lines for "r1", call drop_for_run("r1"), snapshot returns empty,
    /// line_count returns 0.
    #[test]
    fn drop_for_run_removes_buffer() {
        let buf = make_buffer();
        buf.append("r1", "hello".to_string());
        buf.append("r1", "world".to_string());

        buf.drop_for_run("r1");

        let snap = buf.snapshot("r1");
        assert!(snap.is_empty(), "snapshot must be empty after drop_for_run");
        assert_eq!(buf.line_count("r1"), 0, "line_count must be 0 after drop_for_run");
    }

    /// Calling drop_for_run on a nonexistent id must not panic and must not
    /// disturb other ids.
    #[test]
    fn drop_for_run_unknown_id_is_noop() {
        let buf = make_buffer();
        buf.append("r2", "surviving line".to_string());

        buf.drop_for_run("nonexistent");

        let snap = buf.snapshot("r2");
        assert_eq!(snap, vec!["surviving line"], "r2 must be unaffected by drop of unknown id");
    }

    /// Lines for "r1" and "r2" are independent; each snapshot shows only its
    /// own lines, and dropping "r1" leaves "r2" intact.
    #[test]
    fn multiple_runs_isolated() {
        let buf = make_buffer();
        buf.append("r1", "r1-a".to_string());
        buf.append("r1", "r1-b".to_string());
        buf.append("r2", "r2-a".to_string());

        assert_eq!(buf.snapshot("r1"), vec!["r1-a", "r1-b"]);
        assert_eq!(buf.snapshot("r2"), vec!["r2-a"]);

        buf.drop_for_run("r1");

        assert!(buf.snapshot("r1").is_empty(), "r1 must be empty after drop");
        assert_eq!(buf.snapshot("r2"), vec!["r2-a"], "r2 must be unaffected by drop of r1");
    }

    /// For any sequence of appends below the cap, line_count equals snapshot len.
    #[test]
    fn line_count_matches_snapshot_len() {
        let buf = make_buffer();
        for i in 0..50 {
            buf.append("r1", format!("line {i}"));
            assert_eq!(
                buf.line_count("r1"),
                buf.snapshot("r1").len(),
                "line_count and snapshot len must agree after {i} appends"
            );
        }
    }

    /// After MAX_LINES_PER_RUN + 1 appends, line_count is capped at MAX_LINES_PER_RUN.
    #[test]
    fn line_count_caps_at_max() {
        let buf = make_buffer();
        for i in 0..=MAX_LINES_PER_RUN {
            buf.append("r1", format!("line {i}"));
        }
        assert_eq!(
            buf.line_count("r1"),
            MAX_LINES_PER_RUN,
            "line_count must not exceed MAX_LINES_PER_RUN"
        );
    }

    /// Appending an empty string produces a buffer entry that round-trips correctly.
    #[test]
    fn append_empty_string_is_preserved() {
        let buf = make_buffer();
        buf.append("r1", String::new());

        let snap = buf.snapshot("r1");
        assert_eq!(snap.len(), 1, "one empty-string line must be stored");
        assert_eq!(snap[0], "", "the stored line must be the empty string");
    }

    /// Appending for "r1" must not create any entry for "r2".
    #[test]
    fn append_does_not_create_phantom_buffers_for_unrelated_ids() {
        let buf = make_buffer();
        buf.append("r1", "something".to_string());

        let snap = buf.snapshot("r2");
        assert!(
            snap.is_empty(),
            "r2 must have no buffer after appending only to r1"
        );
        assert_eq!(
            buf.line_count("r2"),
            0,
            "line_count for r2 must be 0 after appending only to r1"
        );
    }
}
