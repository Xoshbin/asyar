use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OnboardingStep {
    Welcome,
    SummonSearch,
    Clipboard,
    Portals,
    AiSetup,
    HiddenCommands,
    Emoji,
    Snippets,
    FeaturedExtensions,
    PickTheme,
    PrivacyConsent,
    CheatSheet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingState {
    pub current: OnboardingStep,
    pub total: u8,
    pub position: u8, // 1-indexed for display
    pub is_macos: bool,
}

pub fn step_order(_is_macos: bool) -> Vec<OnboardingStep> {
    vec![
        OnboardingStep::Welcome,
        OnboardingStep::SummonSearch,
        OnboardingStep::Clipboard,
        OnboardingStep::Portals,
        OnboardingStep::AiSetup,
        OnboardingStep::HiddenCommands,
        OnboardingStep::Emoji,
        OnboardingStep::Snippets,
        OnboardingStep::FeaturedExtensions,
        OnboardingStep::PickTheme,
        OnboardingStep::PrivacyConsent,
        OnboardingStep::CheatSheet,
    ]
}

pub fn initial(is_macos: bool) -> OnboardingState {
    let order = step_order(is_macos);
    OnboardingState {
        current: order[0],
        total: order.len() as u8,
        position: 1,
        is_macos,
    }
}

pub fn advance(state: OnboardingState) -> OnboardingState {
    let order = step_order(state.is_macos);
    let idx = order.iter().position(|s| *s == state.current).unwrap_or(0);
    let next_idx = (idx + 1).min(order.len() - 1);
    OnboardingState {
        current: order[next_idx],
        total: order.len() as u8,
        position: (next_idx + 1) as u8,
        is_macos: state.is_macos,
    }
}

pub fn go_back(state: OnboardingState) -> OnboardingState {
    let order = step_order(state.is_macos);
    let idx = order.iter().position(|s| *s == state.current).unwrap_or(0);
    let prev_idx = idx.saturating_sub(1);
    OnboardingState {
        current: order[prev_idx],
        total: order.len() as u8,
        position: (prev_idx + 1) as u8,
        is_macos: state.is_macos,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED: [OnboardingStep; 12] = [
        OnboardingStep::Welcome,
        OnboardingStep::SummonSearch,
        OnboardingStep::Clipboard,
        OnboardingStep::Portals,
        OnboardingStep::AiSetup,
        OnboardingStep::HiddenCommands,
        OnboardingStep::Emoji,
        OnboardingStep::Snippets,
        OnboardingStep::FeaturedExtensions,
        OnboardingStep::PickTheme,
        OnboardingStep::PrivacyConsent,
        OnboardingStep::CheatSheet,
    ];

    #[test]
    fn order_is_platform_uniform() {
        assert_eq!(step_order(true), EXPECTED.to_vec());
        assert_eq!(step_order(false), EXPECTED.to_vec());
    }

    #[test]
    fn order_has_twelve_steps() {
        assert_eq!(step_order(true).len(), 12);
    }

    #[test]
    fn ai_setup_precedes_hidden_commands() {
        let order = step_order(false);
        let ai = order
            .iter()
            .position(|s| *s == OnboardingStep::AiSetup)
            .unwrap();
        let hidden = order
            .iter()
            .position(|s| *s == OnboardingStep::HiddenCommands)
            .unwrap();
        assert!(ai < hidden);
    }

    #[test]
    fn text_expansion_cluster_is_contiguous() {
        let order = step_order(false);
        let emoji = order
            .iter()
            .position(|s| *s == OnboardingStep::Emoji)
            .unwrap();
        let snippets = order
            .iter()
            .position(|s| *s == OnboardingStep::Snippets)
            .unwrap();
        assert_eq!(snippets, emoji + 1);
    }

    #[test]
    fn initial_starts_at_welcome_position_one() {
        let s = initial(true);
        assert_eq!(s.current, OnboardingStep::Welcome);
        assert_eq!(s.position, 1);
        assert_eq!(s.total, 12);
        assert!(s.is_macos);
    }

    #[test]
    fn advance_moves_one_step() {
        let s = advance(initial(true));
        assert_eq!(s.current, OnboardingStep::SummonSearch);
        assert_eq!(s.position, 2);
    }

    #[test]
    fn advance_at_last_stays_last() {
        let mut s = initial(false);
        for _ in 0..20 {
            s = advance(s);
        }
        assert_eq!(s.current, OnboardingStep::CheatSheet);
        assert_eq!(s.position, s.total);
    }

    #[test]
    fn go_back_at_welcome_stays_welcome() {
        let s = go_back(initial(true));
        assert_eq!(s.current, OnboardingStep::Welcome);
        assert_eq!(s.position, 1);
    }

    #[test]
    fn go_back_after_advance_returns() {
        let s = go_back(advance(initial(true)));
        assert_eq!(s.current, OnboardingStep::Welcome);
        assert_eq!(s.position, 1);
    }
}
