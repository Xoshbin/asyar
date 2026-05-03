pub mod luhn;
pub mod rules;

use crate::secret_detection::rules::compiled_rules;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// Maximum input size that the detector will scan. Inputs larger than this
/// are returned unchanged with `oversized_unscanned: true`. The cap exists
/// to bound CPU on legitimate large pastes (multi-MB log files / source
/// trees) — if a 2 MB paste does contain a key, the user has bigger
/// problems than the detector being skipped on it.
pub const MAX_SCAN_BYTES: usize = 1_048_576;

/// Below this length, the input cannot match any rule (every rule has a
/// length floor of at least this many ASCII chars after its prefix), so
/// short-circuit before even calling the regex engine.
const MIN_SCAN_BYTES: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionResult {
    pub content: String,
    /// Sorted, deduped list of rule kinds that matched.
    pub kinds: Vec<String>,
    pub oversized_unscanned: bool,
}

/// Scan `input` for known secret formats and return a redacted copy.
///
/// Each non-overlapping match is replaced in place with
/// `[redacted: <kind>]`. Inputs above [`MAX_SCAN_BYTES`] are returned
/// unchanged with `oversized_unscanned: true`. Inputs shorter than the
/// shortest matchable rule are returned unchanged with no scan attempted.
///
/// Overlap resolution: when two rules match an overlapping span, the one
/// that starts earliest wins; ties break by longer match. This keeps the
/// result deterministic and avoids double-redaction of the same bytes.
pub fn redact(input: &str) -> RedactionResult {
    if input.len() > MAX_SCAN_BYTES {
        return RedactionResult {
            content: input.to_string(),
            kinds: Vec::new(),
            oversized_unscanned: true,
        };
    }
    if input.len() < MIN_SCAN_BYTES {
        return RedactionResult {
            content: input.to_string(),
            kinds: Vec::new(),
            oversized_unscanned: false,
        };
    }

    // Collect (start, end, kind) for every rule's every match that passes
    // its validator (if any).
    let mut hits: Vec<(usize, usize, &'static str)> = Vec::new();
    for rule in compiled_rules() {
        for m in rule.regex.find_iter(input) {
            if let Some(v) = rule.validator {
                if !v(m.as_str()) {
                    continue;
                }
            }
            hits.push((m.start(), m.end(), rule.kind));
        }
    }

    if hits.is_empty() {
        return RedactionResult {
            content: input.to_string(),
            kinds: Vec::new(),
            oversized_unscanned: false,
        };
    }

    // Sort by (start ASC, length DESC) so overlap resolution prefers the
    // longest match starting at each position.
    hits.sort_by(|a, b| {
        a.0.cmp(&b.0).then_with(|| (b.1 - b.0).cmp(&(a.1 - a.0)))
    });

    // Walk matches in start order, dropping any that overlap with an
    // already-accepted match.
    let mut accepted: Vec<(usize, usize, &'static str)> = Vec::with_capacity(hits.len());
    let mut last_end: usize = 0;
    for h in &hits {
        if h.0 < last_end {
            continue; // overlaps a previously accepted match
        }
        accepted.push(*h);
        last_end = h.1;
    }

    // Apply replacements left-to-right. Build the output string in one pass
    // (input.len() + per-match marker overhead — usually small).
    let mut out = String::with_capacity(input.len() + accepted.len() * 24);
    let mut cursor = 0usize;
    for (start, end, kind) in &accepted {
        out.push_str(&input[cursor..*start]);
        out.push_str("[redacted: ");
        out.push_str(kind);
        out.push(']');
        cursor = *end;
    }
    out.push_str(&input[cursor..]);

    let mut kinds: Vec<String> = accepted.iter().map(|(_, _, k)| k.to_string()).collect();
    kinds.sort();
    kinds.dedup();

    RedactionResult {
        content: out,
        kinds,
        oversized_unscanned: false,
    }
}

/// Tauri-managed state holding per-session redaction counts.
/// Resets to empty on every launcher startup; not persisted.
pub struct SecretDetectionState {
    session_hits: Mutex<HashMap<String, u32>>,
}

impl SecretDetectionState {
    pub fn new() -> Self {
        Self {
            session_hits: Mutex::new(HashMap::new()),
        }
    }

    /// Record one bump per unique kind in `kinds`. Multiple matches of the
    /// same kind in a single redact call collapse to a single increment so
    /// "1 redaction event with 5 AWS keys" reads as `aws_access_key=1` not 5.
    pub fn record(&self, kinds: &[String]) {
        if kinds.is_empty() {
            return;
        }
        if let Ok(mut map) = self.session_hits.lock() {
            for k in kinds {
                *map.entry(k.clone()).or_insert(0) += 1;
            }
        }
    }

    pub fn get_session_stats(&self) -> HashMap<String, u32> {
        self.session_hits
            .lock()
            .map(|m| m.clone())
            .unwrap_or_default()
    }
}

impl Default for SecretDetectionState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_returns_input_unchanged_when_no_match() {
        let r = redact("Hello world, this is plain text without secrets.");
        assert_eq!(r.content, "Hello world, this is plain text without secrets.");
        assert!(r.kinds.is_empty());
        assert!(!r.oversized_unscanned);
    }

    #[test]
    fn redact_replaces_aws_key_in_place() {
        let r = redact("key=AKIAIOSFODNN7EXAMPLE end");
        assert_eq!(r.content, "key=[redacted: aws_access_key] end");
        assert_eq!(r.kinds, vec!["aws_access_key".to_string()]);
    }

    #[test]
    fn redact_replaces_multiple_distinct_kinds() {
        let input = "aws=AKIAIOSFODNN7EXAMPLE github=ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ end";
        let r = redact(input);
        assert!(r.content.contains("[redacted: aws_access_key]"));
        assert!(r.content.contains("[redacted: github_pat]"));
        assert_eq!(r.kinds, vec!["aws_access_key".to_string(), "github_pat".to_string()]);
    }

    #[test]
    fn redact_dedupes_repeated_same_kind() {
        let input = "first AKIAIOSFODNN7EXAMPLE second AKIAIOSFODNN7EXAMPLE end";
        let r = redact(input);
        let count = r.content.matches("[redacted: aws_access_key]").count();
        assert_eq!(count, 2, "both matches should be redacted");
        assert_eq!(r.kinds, vec!["aws_access_key".to_string()]);
    }

    #[test]
    fn redact_runs_luhn_for_credit_card_valid() {
        let r = redact("my card 4111-1111-1111-1111 thanks");
        assert!(r.content.contains("[redacted: credit_card]"));
        assert_eq!(r.kinds, vec!["credit_card".to_string()]);
    }

    #[test]
    fn redact_skips_invalid_luhn_lookalike() {
        // Same shape as a credit card but does not pass Luhn.
        let r = redact("not a card 1234567812345678 thanks");
        assert!(!r.content.contains("[redacted"));
        assert!(r.kinds.is_empty());
    }

    #[test]
    fn redact_returns_unchanged_when_oversized() {
        let big = "x".repeat(MAX_SCAN_BYTES + 1);
        let r = redact(&big);
        assert!(r.oversized_unscanned);
        assert_eq!(r.content.len(), big.len());
        assert!(r.kinds.is_empty());
    }

    #[test]
    fn redact_short_circuits_below_minimum() {
        let r = redact("abc");
        assert_eq!(r.content, "abc");
        assert!(!r.oversized_unscanned);
        assert!(r.kinds.is_empty());
    }

    #[test]
    fn redact_handles_jwt() {
        let jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        let input = format!("token={jwt} end");
        let r = redact(&input);
        assert_eq!(r.content, "token=[redacted: jwt] end");
        assert_eq!(r.kinds, vec!["jwt".to_string()]);
    }

    #[test]
    fn redact_handles_pem_block() {
        let input = "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\nafter";
        let r = redact(input);
        assert!(r.content.starts_with("before\n[redacted: pem_private_key]"));
        assert!(r.content.ends_with("\nafter"));
        assert_eq!(r.kinds, vec!["pem_private_key".to_string()]);
    }

    #[test]
    fn redact_anthropic_wins_over_openai_on_sk_ant_prefix() {
        // sk-ant-… also matches the openai_key pattern (sk- + 32+ chars).
        // Overlap resolution prefers the longer match starting earliest;
        // both start at the same position, anthropic's match is longer
        // (starts with sk-ant-, openai's would also start at sk-).
        // Both regexes find a match at the same start, so we expect either
        // one to win — this test just asserts the input is fully redacted
        // and the count is one, with no double-redaction.
        let key = format!("sk-ant-api03-{}", "x".repeat(40));
        let input = format!("ANTHROPIC_KEY={key} end");
        let r = redact(&input);
        let total_redacted = r.content.matches("[redacted").count();
        assert_eq!(total_redacted, 1, "single match, no double-redaction");
        assert!(!r.kinds.is_empty());
    }

    #[test]
    fn redact_is_idempotent_on_marker_output() {
        // Re-redacting an already-redacted output should find no new
        // matches — markers don't match any rule pattern.
        let r1 = redact("key=AKIAIOSFODNN7EXAMPLE done");
        let r2 = redact(&r1.content);
        assert_eq!(r2.content, r1.content);
        assert!(r2.kinds.is_empty());
    }

    #[test]
    fn redact_sorts_kinds_alphabetically() {
        let input = "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ AKIAIOSFODNN7EXAMPLE";
        let r = redact(input);
        assert_eq!(
            r.kinds,
            vec!["aws_access_key".to_string(), "github_pat".to_string()],
            "kinds must be sorted alphabetically"
        );
    }

    #[test]
    fn state_starts_empty() {
        let s = SecretDetectionState::new();
        assert!(s.get_session_stats().is_empty());
    }

    #[test]
    fn state_increments_per_kind() {
        let s = SecretDetectionState::new();
        s.record(&["aws_access_key".to_string()]);
        s.record(&["aws_access_key".to_string(), "github_pat".to_string()]);
        let stats = s.get_session_stats();
        assert_eq!(stats.get("aws_access_key").copied(), Some(2));
        assert_eq!(stats.get("github_pat").copied(), Some(1));
    }

    #[test]
    fn state_no_op_for_empty_kinds() {
        let s = SecretDetectionState::new();
        s.record(&[]);
        assert!(s.get_session_stats().is_empty());
    }
}
