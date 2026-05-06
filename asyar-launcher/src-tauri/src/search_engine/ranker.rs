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
        return RankKey { tier: Tier::ExactTitle, frecency, fuzzy_score: 0, name_lower };
    }

    if name_lower.starts_with(&query_lower) {
        return RankKey { tier: Tier::TitlePrefix, frecency, fuzzy_score: 0, name_lower };
    }

    let matcher = SkimMatcherV2::default();
    if let Some(score) = matcher.fuzzy_match(title, query) {
        return RankKey { tier: Tier::TitleFuzzy, frecency, fuzzy_score: score, name_lower };
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
            return RankKey { tier: Tier::SubtitleOrKeyword, frecency, fuzzy_score: score, name_lower };
        }
    }

    RankKey { tier: Tier::FrecencyOnly, frecency, fuzzy_score: 0, name_lower }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let key = classify("safari", "Safari", None, &[], 3.14, false);
        assert_eq!(key.frecency, 3.14_f32);
    }

    #[test]
    fn name_lower_carried_through() {
        let key = classify("Safari", "Safari", None, &[], 0.0, false);
        assert_eq!(key.name_lower, "safari");
    }
}
