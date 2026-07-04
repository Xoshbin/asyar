//! In-memory selection-learning cache.
//!
//! The old attempt ran a SQL query per keystroke to build boosts — one of
//! its failure causes. This cache loads the whole (small, GC'd) selections
//! table once at startup, is updated in memory on every selection, and
//! answers `boost()` with two hash lookups on the hot path. SQL writes
//! happen in the command layer, off the keystroke path.

use std::collections::{HashMap, HashSet};

use crate::storage::file_search_selections::normalize_prefix;

#[derive(Debug, Clone, Copy)]
struct SelectionStat {
    count: u32,
    last_used: i64,
}

#[derive(Default)]
pub struct LearningCache {
    /// query prefix (8-char floor) → file id → selection stats.
    by_prefix: HashMap<String, HashMap<u64, SelectionStat>>,
    pinned: HashSet<u64>,
}

/// Boost formula (ported): saturates at 0.5 for count ≥ 10, halved between
/// 90 and 180 days since last use, zero after 180 days.
pub fn boost_for(count: u32, last_used: i64, now: i64) -> f32 {
    let age_days = ((now - last_used).max(0) as f32) / 86_400.0;
    let decay = if age_days < 90.0 {
        1.0
    } else if age_days < 180.0 {
        0.5
    } else {
        0.0
    };
    let saturated = (count as f32 / 10.0).min(1.0);
    saturated * 0.5 * decay
}

impl LearningCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Builds the cache from persisted rows. `rows` are
    /// `(query_prefix, file_id_u64, count, last_used)`.
    pub fn load(rows: Vec<(String, u64, u32, i64)>, pinned_ids: Vec<u64>) -> Self {
        let mut by_prefix: HashMap<String, HashMap<u64, SelectionStat>> = HashMap::new();
        for (prefix, file_id, count, last_used) in rows {
            by_prefix
                .entry(normalize_prefix(&prefix))
                .or_default()
                .insert(file_id, SelectionStat { count, last_used });
        }
        Self {
            by_prefix,
            pinned: pinned_ids.into_iter().collect(),
        }
    }

    /// Additive ranking boost (0..0.5) for `file_id` under `query`.
    pub fn boost(&self, query: &str, file_id: u64, now: i64) -> f32 {
        let Some(stats) = self.by_prefix.get(&normalize_prefix(query)) else {
            return 0.0;
        };
        stats
            .get(&file_id)
            .map(|s| boost_for(s.count, s.last_used, now))
            .unwrap_or(0.0)
    }

    pub fn is_pinned(&self, file_id: u64) -> bool {
        self.pinned.contains(&file_id)
    }

    /// In-memory mirror of a persisted selection.
    pub fn record_selection(&mut self, query: &str, file_id: u64, now: i64) {
        let stat = self
            .by_prefix
            .entry(normalize_prefix(query))
            .or_default()
            .entry(file_id)
            .or_insert(SelectionStat {
                count: 0,
                last_used: now,
            });
        stat.count += 1;
        stat.last_used = now;
    }

    pub fn set_pinned(&mut self, file_id: u64, pinned: bool) {
        if pinned {
            self.pinned.insert(file_id);
        } else {
            self.pinned.remove(&file_id);
        }
    }

    /// Drops all learned selections (pins are kept — they are explicit).
    pub fn clear_selections(&mut self) {
        self.by_prefix.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boost_caps_at_half() {
        let b = boost_for(100, 1_000_000, 1_000_000);
        assert!((b - 0.5).abs() < 0.01);
    }

    #[test]
    fn boost_zero_after_180_days() {
        assert_eq!(boost_for(100, 0, 200 * 86_400), 0.0);
    }

    #[test]
    fn boost_halved_between_90_and_180_days() {
        let b = boost_for(100, 0, 120 * 86_400);
        assert!((b - 0.25).abs() < 0.01);
    }

    #[test]
    fn boost_scales_with_count() {
        let one = boost_for(1, 1000, 1000);
        let five = boost_for(5, 1000, 1000);
        assert!((one - 0.05).abs() < 0.01);
        assert!((five - 0.25).abs() < 0.01);
    }

    #[test]
    fn cache_boosts_only_matching_prefix() {
        let cache = LearningCache::load(vec![("rep".into(), 7, 10, 1000)], vec![]);
        assert!(cache.boost("rep", 7, 1000) > 0.4);
        assert_eq!(cache.boost("xyz", 7, 1000), 0.0);
        assert_eq!(cache.boost("rep", 8, 1000), 0.0);
    }

    #[test]
    fn cache_normalizes_query_to_prefix8() {
        let cache = LearningCache::load(vec![("reportsa".into(), 7, 10, 1000)], vec![]);
        // Long query shares the same first-8 prefix.
        assert!(cache.boost("REPORTSAREVERYLONG", 7, 1000) > 0.4);
    }

    #[test]
    fn record_selection_increments_in_memory() {
        let mut cache = LearningCache::new();
        assert_eq!(cache.boost("rep", 7, 1000), 0.0);
        cache.record_selection("rep", 7, 1000);
        let one = cache.boost("rep", 7, 1000);
        assert!(one > 0.0);
        cache.record_selection("rep", 7, 1001);
        assert!(cache.boost("rep", 7, 1001) > one);
    }

    #[test]
    fn pinned_set_and_clear() {
        let mut cache = LearningCache::new();
        assert!(!cache.is_pinned(9));
        cache.set_pinned(9, true);
        assert!(cache.is_pinned(9));
        cache.set_pinned(9, false);
        assert!(!cache.is_pinned(9));
    }

    #[test]
    fn clear_selections_keeps_pins() {
        let mut cache = LearningCache::load(vec![("rep".into(), 7, 10, 1000)], vec![9]);
        cache.clear_selections();
        assert_eq!(cache.boost("rep", 7, 1000), 0.0);
        assert!(cache.is_pinned(9));
    }
}
