use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

/// Maximum number of output lines retained per run.
/// When the cap is exceeded the oldest line is evicted.
pub const MAX_LINES_PER_RUN: usize = 10_000;

/// Maximum character length (Unicode scalar count) of a tail-output preview
/// returned by [`format_tail_output`]. Longer previews are truncated and
/// suffixed with `…`.
pub const MAX_TAIL_CHARS: usize = 200;

/// Pick a one-line preview from a per-run output snapshot, for surfacing in
/// row subtitles, notifications, and the RunView header.
///
/// Contract:
/// - Returns the **last non-empty** line from `lines` (whitespace-only
///   lines count as empty).
/// - Trims trailing whitespace from the chosen line.
/// - Truncates to [`MAX_TAIL_CHARS`] Unicode scalars (NOT bytes) and
///   appends `…` when truncation happens.
/// - Returns `None` when `lines` is empty or every line is whitespace-only.
///
/// Notes:
/// - `lines` is chronological (push_back order from [`OutputBuffer::snapshot`]).
/// - Stream tag (stdout vs stderr) is **not** preserved by `OutputBuffer`
///   today; this formatter picks whichever was last regardless of stream.
pub fn format_tail_output(lines: &[String]) -> Option<String> {
    let trimmed = lines
        .iter()
        .rev()
        .map(|l| l.trim_end())
        .find(|l| !l.is_empty())?;

    if trimmed.chars().count() <= MAX_TAIL_CHARS {
        Some(trimmed.to_string())
    } else {
        let mut out: String = trimmed.chars().take(MAX_TAIL_CHARS).collect();
        out.push('…');
        Some(out)
    }
}

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

    // ---------------------------------------------------------------------
    // format_tail_output — user-contribution spec
    // ---------------------------------------------------------------------

    #[test]
    fn format_tail_output_returns_none_for_empty_slice() {
        assert_eq!(format_tail_output(&[]), None);
    }

    #[test]
    fn format_tail_output_returns_none_for_only_whitespace_lines() {
        let lines = vec!["".to_string(), "   ".to_string(), "\t\n".to_string()];
        assert_eq!(format_tail_output(&lines), None);
    }

    #[test]
    fn format_tail_output_returns_last_non_empty_line() {
        let lines = vec!["first".to_string(), "middle".to_string(), "last".to_string()];
        assert_eq!(format_tail_output(&lines).as_deref(), Some("last"));
    }

    #[test]
    fn format_tail_output_skips_trailing_blank_lines() {
        let lines = vec![
            "real output".to_string(),
            "".to_string(),
            "   ".to_string(),
        ];
        assert_eq!(format_tail_output(&lines).as_deref(), Some("real output"));
    }

    #[test]
    fn format_tail_output_trims_trailing_whitespace() {
        let lines = vec!["hello world   \n".to_string()];
        assert_eq!(format_tail_output(&lines).as_deref(), Some("hello world"));
    }

    #[test]
    fn format_tail_output_truncates_long_line_with_ellipsis() {
        let long = "x".repeat(MAX_TAIL_CHARS + 50);
        let out = format_tail_output(&[long]).expect("non-empty input must yield Some");
        assert!(
            out.chars().count() <= MAX_TAIL_CHARS + 1,
            "max {MAX_TAIL_CHARS} chars + ellipsis, got {} chars",
            out.chars().count()
        );
        assert!(
            out.ends_with('…'),
            "truncated output must end with an ellipsis, got {out:?}"
        );
    }

    #[test]
    fn format_tail_output_preserves_short_unicode_unchanged() {
        let s = "héllo 🚀".to_string();
        assert_eq!(format_tail_output(std::slice::from_ref(&s)).as_deref(), Some(s.as_str()));
    }
}
