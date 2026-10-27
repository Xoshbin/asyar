//! Matching a typed query against an extension's display name.
//!
//! The index stores commands under the extension's technical id
//! (`org.asyar.color-picker`), but users know it as "Color Picker" — the label
//! printed on every row. This module lets root search and `@` scoping find an
//! extension's commands by that display name.
//!
//! The rule is deliberately strict (start-of-word prefix, not fuzzy): a loose
//! match on "Clipboard History" would surface every one of its commands for
//! two scattered letters like `cl` or `hi`.

/// Fewest characters a query needs before it can match an extension name.
pub const MIN_QUERY_CHARS: usize = 2;

/// Lowercase `text` and collapse every run of non-alphanumeric characters into
/// a single space, so `Color-Picker`, `color_picker` and `Color  Picker` all
/// compare equal.
fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.extend(ch.to_lowercase());
        } else {
            pending_space = true;
        }
    }
    out
}

/// `true` when `query` starts at the beginning of `name` or of any word in it.
/// `cup` and `world cup` match "World Cup"; `ld` and `rld` do not.
pub fn name_matches(name: &str, query: &str) -> bool {
    let query = normalize(query);
    if query.chars().count() < MIN_QUERY_CHARS {
        return false;
    }
    let name = normalize(name);
    name.match_indices(' ')
        .map(|(i, _)| i + 1)
        .chain(std::iter::once(0))
        .any(|start| name[start..].starts_with(&query))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search_engine::models::{Command, SearchableItem};
    use crate::search_engine::SearchState;
    use std::collections::HashMap;

    #[test]
    fn matches_from_start_of_name() {
        assert!(name_matches("Coffee", "cof"));
        assert!(name_matches("Coffee", "coffee"));
        assert!(name_matches("World Cup", "world"));
    }

    #[test]
    fn matches_from_start_of_any_word() {
        assert!(name_matches("World Cup", "cup"));
        assert!(name_matches("Color Picker", "picker"));
    }

    #[test]
    fn matches_a_multi_word_query() {
        assert!(name_matches("World Cup", "world cup"));
        assert!(name_matches("Color Picker", "color pick"));
        assert!(name_matches("Google Translate", "google trans"));
    }

    #[test]
    fn treats_separators_and_case_alike() {
        assert!(name_matches("Color Picker", "color-picker"));
        assert!(name_matches("Color Picker", "COLOR_PICKER"));
        assert!(name_matches("Color  Picker", "color picker"));
    }

    #[test]
    fn rejects_letters_from_the_middle_of_a_word() {
        assert!(!name_matches("Coffee", "ffee"));
        assert!(!name_matches("World Cup", "ld"));
        assert!(!name_matches("World Cup", "rld cup"));
    }

    #[test]
    fn rejects_scattered_letters() {
        assert!(!name_matches("Color Picker", "cp"));
        assert!(!name_matches("Clipboard History", "chy"));
    }

    #[test]
    fn rejects_queries_shorter_than_two_characters() {
        assert!(!name_matches("Coffee", "c"));
        assert!(!name_matches("Coffee", ""));
        assert!(!name_matches("Coffee", " "));
        assert!(!name_matches("Coffee", "-"));
    }

    #[test]
    fn rejects_a_query_longer_than_the_name() {
        assert!(!name_matches("Coffee", "coffee shop"));
    }

    // --- Through the real search paths ---------------------------------

    fn command(id: &str, name: &str, extension: &str, usage: u32) -> SearchableItem {
        SearchableItem::Command(Command {
            id: id.to_string(),
            name: name.to_string(),
            extension: extension.to_string(),
            trigger: name.to_lowercase(),
            command_type: "command".to_string(),
            usage_count: usage,
            icon: None,
            last_used_at: None,
            subtitle: None,
            type_label: None,
            has_arguments: false,
            is_dynamic: false,
        })
    }

    fn names(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(id, name)| (id.to_string(), name.to_string()))
            .collect()
    }

    /// Coffee ships commands none of whose titles contain "coffee" — the exact
    /// shape reported in #932.
    fn coffee_state() -> SearchState {
        let state = SearchState::new_for_test();
        state
            .index_one(command(
                "cmd_org.asyar.coffee_caffeinate",
                "Caffeinate",
                "org.asyar.coffee",
                0,
            ))
            .unwrap();
        state
            .index_one(command(
                "cmd_org.asyar.coffee_decaffeinate",
                "Decaffeinate",
                "org.asyar.coffee",
                0,
            ))
            .unwrap();
        state
            .index_one(command(
                "cmd_org.asyar.coffee_status",
                "Caffeination Status",
                "org.asyar.coffee",
                0,
            ))
            .unwrap();
        state
            .index_one(command(
                "cmd_org.asyar.speedtest_run",
                "Speed Test",
                "org.asyar.speedtest",
                0,
            ))
            .unwrap();
        state.set_extension_names(names(&[
            ("org.asyar.coffee", "Coffee"),
            ("org.asyar.speedtest", "Speed Test"),
        ]));
        state
    }

    fn ids(results: Vec<crate::search_engine::models::SearchResult>) -> Vec<String> {
        results.into_iter().map(|r| r.object_id).collect()
    }

    fn coffee_ids() -> Vec<String> {
        vec![
            "cmd_org.asyar.coffee_caffeinate".to_string(),
            "cmd_org.asyar.coffee_decaffeinate".to_string(),
            "cmd_org.asyar.coffee_status".to_string(),
        ]
    }

    fn sorted(mut v: Vec<String>) -> Vec<String> {
        v.sort();
        v
    }

    #[test]
    fn plain_search_by_extension_name_finds_every_command() {
        let state = coffee_state();
        let found = ids(state.search("coffee").unwrap());
        assert_eq!(sorted(found), sorted(coffee_ids()));
    }

    #[test]
    fn plain_search_by_a_name_prefix_finds_every_command() {
        let state = coffee_state();
        let found = ids(state.search("cof").unwrap());
        assert_eq!(sorted(found), sorted(coffee_ids()));
    }

    #[test]
    fn plain_search_by_the_middle_of_a_name_finds_nothing() {
        // The command title shares no letters with the query, so only the
        // extension name could match — and "ster" is mid-word in "Brewmaster".
        let state = SearchState::new_for_test();
        state
            .index_one(command("cmd_brew_zap", "Zap", "org.asyar.brew", 0))
            .unwrap();
        state.set_extension_names(names(&[("org.asyar.brew", "Brewmaster")]));
        assert!(ids(state.search("ster").unwrap()).is_empty());
        assert!(ids(state.search("bmr").unwrap()).is_empty());
        assert_eq!(ids(state.search("brew").unwrap()), vec!["cmd_brew_zap"]);
    }

    #[test]
    fn plain_search_without_a_name_map_is_unchanged() {
        let state = coffee_state();
        state.set_extension_names(HashMap::new());
        assert!(ids(state.search("coffee").unwrap()).is_empty());
    }

    #[test]
    fn title_matches_still_rank_above_extension_name_matches() {
        let state = coffee_state();
        state
            .index_one(command(
                "cmd_other_brew",
                "Coffee Brewer",
                "org.other.brew",
                0,
            ))
            .unwrap();
        state.set_extension_names(names(&[
            ("org.asyar.coffee", "Coffee"),
            ("org.other.brew", "Brew"),
        ]));
        let found = ids(state.merged_search("coffee", vec![], 0, &[]).unwrap());
        assert_eq!(found[0], "cmd_other_brew");
        assert_eq!(sorted(found[1..].to_vec()), sorted(coffee_ids()));
    }

    #[test]
    fn extension_name_matches_are_ordered_by_use() {
        let state = coffee_state();
        state
            .record_usage("cmd_org.asyar.coffee_status")
            .expect("record usage");
        let found = ids(state.merged_search("coffee", vec![], 0, &[]).unwrap());
        assert_eq!(found[0], "cmd_org.asyar.coffee_status");
    }

    #[test]
    fn extension_name_matches_survive_a_crowd_of_title_matches() {
        let state = coffee_state();
        for i in 0..30 {
            state
                .index_one(command(
                    &format!("cmd_noise_{i}"),
                    &format!("Cof Noise {i}"),
                    "org.noise",
                    0,
                ))
                .unwrap();
        }
        let found = ids(state.search("cof").unwrap());
        for id in coffee_ids() {
            assert!(found.contains(&id), "{id} was crowded out");
        }
    }

    #[test]
    fn scoped_search_accepts_a_multi_word_display_name() {
        let state = coffee_state();
        let found = ids(state.search("@speed test").unwrap());
        assert_eq!(found, vec!["cmd_org.asyar.speedtest_run"]);
    }

    #[test]
    fn scoped_search_accepts_a_display_name_and_a_subquery() {
        let state = coffee_state();
        let found = ids(state.search("@coffee decaf").unwrap());
        assert_eq!(found, vec!["cmd_org.asyar.coffee_decaffeinate"]);
    }

    #[test]
    fn scoped_search_matches_a_word_inside_the_display_name() {
        let state = SearchState::new_for_test();
        state
            .index_one(command(
                "cmd_org.asyar.worldcup_schedule",
                "Schedule",
                "org.asyar.worldcup",
                0,
            ))
            .unwrap();
        state
            .index_one(command(
                "cmd_org.asyar.worldcup_follow",
                "Follow a Team",
                "org.asyar.worldcup",
                0,
            ))
            .unwrap();
        state.set_extension_names(names(&[("org.asyar.worldcup", "World Cup")]));
        // `cup` is neither an id prefix nor in "Follow a Team"; only the
        // display name can reach that command.
        let found = ids(state.search("@cup").unwrap());
        assert_eq!(
            sorted(found),
            sorted(vec![
                "cmd_org.asyar.worldcup_follow".to_string(),
                "cmd_org.asyar.worldcup_schedule".to_string(),
            ])
        );
    }

    #[test]
    fn scoped_search_by_id_still_works() {
        let state = coffee_state();
        let found = ids(state.search("@coffee").unwrap());
        assert_eq!(sorted(found), sorted(coffee_ids()));
    }
}
