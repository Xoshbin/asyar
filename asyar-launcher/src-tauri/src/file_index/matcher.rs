//! Nucleo-backed fuzzy scorer. Returns normalized 0..1 scores.
//!
//! One instance is reused across queries (the old attempt allocated a fresh
//! matcher per keystroke — one of its failure causes). Char buffers are
//! cleared, never dropped, so non-ASCII haystacks don't allocate per call.

use nucleo::{Config, Matcher as NucleoMatcher, Utf32Str};

pub struct Matcher {
    inner: NucleoMatcher,
    needle_buf: Vec<char>,
    hay_buf: Vec<char>,
}

impl Default for Matcher {
    fn default() -> Self {
        Self::new()
    }
}

impl Matcher {
    pub fn new() -> Self {
        Self {
            inner: NucleoMatcher::new(Config::DEFAULT.match_paths()),
            needle_buf: Vec::with_capacity(64),
            hay_buf: Vec::with_capacity(256),
        }
    }

    /// Score `haystack` against `needle`. Returns `Some(0..1)` if matched,
    /// `None` if no match. Higher is better.
    pub fn score(&mut self, needle: &str, haystack: &str) -> Option<f32> {
        if needle.is_empty() {
            return Some(0.5);
        }
        self.needle_buf.clear();
        self.hay_buf.clear();
        let needle_u = Utf32Str::new(needle, &mut self.needle_buf);
        let hay_u = Utf32Str::new(haystack, &mut self.hay_buf);
        let raw = self.inner.fuzzy_match(hay_u, needle_u)?;
        // Nucleo returns scores up to a few thousand. Map roughly to 0..1
        // with diminishing returns above 200 (very strong match).
        Some((raw as f32 / 200.0).min(1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_match_scores_high() {
        let mut m = Matcher::new();
        let s = m.score("report", "report").unwrap();
        assert!(s > 0.5, "got {s}");
    }

    #[test]
    fn substring_match_scores_lower_than_exact() {
        let mut m = Matcher::new();
        let exact = m.score("rep", "rep").unwrap();
        let sub = m.score("rep", "my-report-2026").unwrap();
        assert!(exact > sub, "exact {exact} vs sub {sub}");
    }

    #[test]
    fn no_match_returns_none() {
        let mut m = Matcher::new();
        assert!(m.score("xyz", "abc").is_none());
    }

    #[test]
    fn empty_needle_returns_neutral_score() {
        let mut m = Matcher::new();
        assert_eq!(m.score("", "anything"), Some(0.5));
    }

    #[test]
    fn score_is_capped_to_one() {
        let mut m = Matcher::new();
        let s = m.score("report", "report").unwrap();
        assert!(s <= 1.0);
    }

    #[test]
    fn matcher_score_reuses_buffers_across_calls() {
        let mut m = Matcher::new();
        let s1 = m.score("report", "annual-report-2026.pdf").unwrap();
        let s2 = m.score("report", "annual-report-2026.pdf").unwrap();
        assert_eq!(s1, s2, "repeated calls must return identical scores");
        let s3 = m.score("annual", "annual-report-2026.pdf").unwrap();
        let s4 = m.score("annual", "annual-report-2026.pdf").unwrap();
        assert_eq!(s3, s4, "second query must be stable across calls");
    }
}
