use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tier {
    Pinned = 0,
    ExactTitle = 1,
    TitlePrefix = 2,
    TitleFuzzy = 3,
    SubtitleOrKeyword = 4,
    FrecencyOnly = 5,
}

#[derive(Clone, Debug)]
pub struct RankKey {
    pub tier: Tier,
    pub frecency: f32,
    pub fuzzy_score: i64,
    pub name_lower: String,
}

/// Classify a result into the appropriate tier given a user query.
/// `pinned`: result has declared itself a synthetic answer (priority: "top").
/// `frecency`: precomputed frecency score (used as within-tier tiebreaker).
pub fn classify(
    query: &str,
    title: &str,
    subtitle: Option<&str>,
    keywords: &[&str],
    frecency: f32,
    pinned: bool,
) -> RankKey {
    if pinned {
        return RankKey {
            tier: Tier::Pinned,
            frecency,
            fuzzy_score: 0,
            name_lower: title.to_lowercase(),
        };
    }

    if query.trim().is_empty() {
        return RankKey {
            tier: Tier::FrecencyOnly,
            frecency,
            fuzzy_score: 0,
            name_lower: title.to_lowercase(),
        };
    }

    let query_lower = query.to_lowercase();
    let title_lower = title.to_lowercase();
    let name_lower = title_lower;

    if name_lower == query_lower {
        return RankKey {
            tier: Tier::ExactTitle,
            frecency,
            fuzzy_score: 0,
            name_lower,
        };
    }

    if name_lower.starts_with(&query_lower) {
        return RankKey {
            tier: Tier::TitlePrefix,
            frecency,
            fuzzy_score: 0,
            name_lower,
        };
    }

    let matcher = SkimMatcherV2::default();
    if let Some(score) = matcher.fuzzy_match(title, query) {
        return RankKey {
            tier: Tier::TitleFuzzy,
            frecency,
            fuzzy_score: score,
            name_lower,
        };
    }

    // Build haystack from subtitle + keywords for secondary fuzzy match.
    let mut haystack_parts: Vec<&str> = Vec::new();
    if let Some(sub) = subtitle {
        haystack_parts.push(sub);
    }
    for kw in keywords {
        haystack_parts.push(kw);
    }
    if !haystack_parts.is_empty() {
        let haystack = haystack_parts.join(" ");
        if let Some(score) = matcher.fuzzy_match(&haystack, query) {
            return RankKey {
                tier: Tier::SubtitleOrKeyword,
                frecency,
                fuzzy_score: score,
                name_lower,
            };
        }
    }

    RankKey {
        tier: Tier::FrecencyOnly,
        frecency,
        fuzzy_score: 0,
        name_lower,
    }
}

/// A frontend-supplied item to be ranked against a query. The `id` is opaque
/// to Rust — it is returned verbatim, best-match first, so the caller can map
/// the ordered ids back to its own item objects.
#[derive(Clone, Debug, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RankInput {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
}

/// Rank arbitrary frontend items for a query using the shared tiered ranker.
///
/// - Empty/whitespace query: returns every id in the input order (no ranking).
/// - Non-empty query: classifies each item, drops items that match nowhere
///   (the `FrecencyOnly` tier), and returns the rest best-match first
///   (tier, then fuzzy score, then title).
pub fn rank_ids(query: &str, items: &[RankInput]) -> Vec<String> {
    if query.trim().is_empty() {
        return items.iter().map(|i| i.id.clone()).collect();
    }

    let mut ranked: Vec<(RankKey, &RankInput)> = items
        .iter()
        .map(|item| {
            let keyword_refs: Vec<&str> = item.keywords.iter().map(|k| k.as_str()).collect();
            let key = classify(
                query,
                &item.title,
                item.subtitle.as_deref(),
                &keyword_refs,
                0.0,
                false,
            );
            (key, item)
        })
        // No match anywhere → exclude from results (mirrors the old JS engine,
        // which only returned matching items).
        .filter(|(key, _)| key.tier != Tier::FrecencyOnly)
        .collect();

    ranked.sort_by(|(a, _), (b, _)| {
        a.tier
            .cmp(&b.tier)
            // Higher fuzzy score is a better match.
            .then(b.fuzzy_score.cmp(&a.fuzzy_score))
            .then(a.name_lower.cmp(&b.name_lower))
    });

    ranked
        .into_iter()
        .map(|(_, item)| item.id.clone())
        .collect()
}

/// Per-item tier classification result, returned by `classify_many`.
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TierResult {
    pub id: String,
    pub tier: u8,
}

/// Classify every item against `query`, preserving input order and keeping
/// every id (no filtering, no sorting) — unlike `rank_ids`. Used where the
/// caller needs a tier value per item to interleave against data tiered
/// elsewhere (e.g. Run rows interleaved with already-tiered search results).
pub fn classify_many(query: &str, items: &[RankInput]) -> Vec<TierResult> {
    items
        .iter()
        .map(|item| {
            let keyword_refs: Vec<&str> = item.keywords.iter().map(|k| k.as_str()).collect();
            let key = classify(
                query,
                &item.title,
                item.subtitle.as_deref(),
                &keyword_refs,
                0.0,
                false,
            );
            TierResult {
                id: item.id.clone(),
                tier: key.tier as u8,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: &str, title: &str, subtitle: Option<&str>, keywords: &[&str]) -> RankInput {
        RankInput {
            id: id.to_string(),
            title: title.to_string(),
            subtitle: subtitle.map(|s| s.to_string()),
            keywords: keywords.iter().map(|k| k.to_string()).collect(),
        }
    }

    #[test]
    fn rank_empty_query_returns_all_in_order() {
        let items = vec![
            input("a", "Banana", None, &[]),
            input("b", "Apple", None, &[]),
        ];
        assert_eq!(rank_ids("", &items), vec!["a", "b"]);
        assert_eq!(rank_ids("   ", &items), vec!["a", "b"]);
    }

    #[test]
    fn rank_drops_non_matches() {
        let items = vec![
            input("hit", "Safari", None, &[]),
            input("miss", "Notes", None, &[]),
        ];
        assert_eq!(rank_ids("safari", &items), vec!["hit"]);
    }

    #[test]
    fn rank_orders_exact_before_prefix_before_fuzzy() {
        let items = vec![
            input("fuzzy", "Snow Safari", None, &[]), // substring, not a prefix
            input("prefix", "Safari Books", None, &[]), // prefix
            input("exact", "Safari", None, &[]),      // exact
        ];
        assert_eq!(rank_ids("safari", &items), vec!["exact", "prefix", "fuzzy"]);
    }

    #[test]
    fn rank_matches_via_subtitle() {
        let items = vec![input("s", "Address", Some("123 Main Street"), &[])];
        assert_eq!(rank_ids("main", &items), vec!["s"]);
    }

    #[test]
    fn rank_matches_via_keyword() {
        let items = vec![input("k", "Safari", None, &["com.apple.safari"])];
        assert_eq!(rank_ids("apple", &items), vec!["k"]);
    }

    #[test]
    fn tier0_pinned_overrides_query() {
        let key = classify("zzz", "NoMatchAtAll", None, &[], 0.0, true);
        assert_eq!(key.tier, Tier::Pinned);
    }

    #[test]
    fn tier0_pinned_beats_tier1_via_ord() {
        assert!(Tier::Pinned < Tier::ExactTitle);
    }

    #[test]
    fn tier1_exact_title_match() {
        let key = classify("Safari", "Safari", None, &[], 0.0, false);
        assert_eq!(key.tier, Tier::ExactTitle);
    }

    #[test]
    fn tier1_case_insensitive() {
        let key = classify("safari", "Safari", None, &[], 0.0, false);
        assert_eq!(key.tier, Tier::ExactTitle);
    }

    #[test]
    fn tier2_title_prefix() {
        let key = classify("saf", "Safari", None, &[], 0.0, false);
        assert_eq!(key.tier, Tier::TitlePrefix);
    }

    #[test]
    fn tier2_case_insensitive_prefix() {
        let key = classify("SAF", "Safari", None, &[], 0.0, false);
        assert_eq!(key.tier, Tier::TitlePrefix);
    }

    #[test]
    fn tier3_title_fuzzy_non_prefix() {
        let key = classify("fri", "Safari", None, &[], 0.0, false);
        assert_eq!(key.tier, Tier::TitleFuzzy);
    }

    #[test]
    fn tier4_subtitle_only() {
        let key = classify("team", "Slack", Some("Team chat"), &[], 0.0, false);
        assert_eq!(key.tier, Tier::SubtitleOrKeyword);
    }

    #[test]
    fn tier4_keyword_match() {
        let key = classify("apple", "Safari", None, &["com.apple.safari"], 0.0, false);
        assert_eq!(key.tier, Tier::SubtitleOrKeyword);
    }

    #[test]
    fn tier5_empty_query_not_pinned() {
        let key = classify("", "Safari", None, &[], 0.0, false);
        assert_eq!(key.tier, Tier::FrecencyOnly);
    }

    #[test]
    fn tier5_no_match_anywhere() {
        let key = classify("zzz", "Safari", None, &[], 0.0, false);
        assert_eq!(key.tier, Tier::FrecencyOnly);
    }

    #[test]
    fn tier_full_ordering_holds() {
        assert!(Tier::Pinned < Tier::ExactTitle);
        assert!(Tier::ExactTitle < Tier::TitlePrefix);
        assert!(Tier::TitlePrefix < Tier::TitleFuzzy);
        assert!(Tier::TitleFuzzy < Tier::SubtitleOrKeyword);
        assert!(Tier::SubtitleOrKeyword < Tier::FrecencyOnly);
    }

    #[test]
    fn frecency_carried_through() {
        let key = classify("safari", "Safari", None, &[], 1.5, false);
        assert_eq!(key.frecency, 1.5_f32);
    }

    #[test]
    fn name_lower_carried_through() {
        let key = classify("Safari", "Safari", None, &[], 0.0, false);
        assert_eq!(key.name_lower, "safari");
    }

    #[test]
    fn classify_many_preserves_input_order_unsorted() {
        // "fuzzy" would sort after "exact" under rank_ids; classify_many must
        // not reorder — callers need per-item tiers against their own list order.
        let items = vec![
            input("fuzzy", "Snow Safari", None, &[]),
            input("exact", "Safari", None, &[]),
        ];
        let results = classify_many("safari", &items);
        assert_eq!(
            results.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["fuzzy", "exact"]
        );
    }

    #[test]
    fn classify_many_does_not_filter_non_matches() {
        // Unlike rank_ids, classify_many must keep every input id — callers
        // need a tier value for non-matches too (e.g. to sink them below
        // already-tiered data from elsewhere).
        let items = vec![
            input("hit", "Safari", None, &[]),
            input("miss", "Notes", None, &[]),
        ];
        let results = classify_many("safari", &items);
        assert_eq!(results.len(), 2);
        assert_eq!(
            results.iter().find(|r| r.id == "miss").unwrap().tier,
            Tier::FrecencyOnly as u8
        );
    }

    #[test]
    fn classify_many_tier_values_match_classify() {
        let items = vec![input("exact", "Safari", None, &[])];
        let results = classify_many("safari", &items);
        let expected = classify("safari", "Safari", None, &[], 0.0, false);
        assert_eq!(results[0].tier, expected.tier as u8);
    }

    #[test]
    fn classify_many_empty_query_returns_frecency_only_for_all() {
        let items = vec![
            input("a", "Banana", None, &[]),
            input("b", "Apple", None, &[]),
        ];
        let results = classify_many("", &items);
        assert!(results.iter().all(|r| r.tier == Tier::FrecencyOnly as u8));
    }
}
