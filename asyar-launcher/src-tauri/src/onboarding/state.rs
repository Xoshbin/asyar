use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OnboardingStep {
    Welcome,
    GrantAccessibility,
    PickHotkey,
    PickLaunchView,
    PickTheme,
    FeaturedExtensions,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingState {
    pub current: OnboardingStep,
    pub total: u8,
    pub position: u8, // 1-indexed for display
    pub is_macos: bool,
}

pub fn step_order(is_macos: bool) -> Vec<OnboardingStep> {
    let mut steps = vec![OnboardingStep::Welcome];
    if is_macos {
        steps.push(OnboardingStep::GrantAccessibility);
    }
    steps.extend([
        OnboardingStep::PickHotkey,
        OnboardingStep::PickLaunchView,
        OnboardingStep::PickTheme,
        OnboardingStep::FeaturedExtensions,
        OnboardingStep::Done,
    ]);
    steps
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

    #[test]
    fn order_on_macos_includes_accessibility() {
        let order = step_order(true);
        assert_eq!(
            order,
            vec![
                OnboardingStep::Welcome,
                OnboardingStep::GrantAccessibility,
                OnboardingStep::PickHotkey,
                OnboardingStep::PickLaunchView,
                OnboardingStep::PickTheme,
                OnboardingStep::FeaturedExtensions,
                OnboardingStep::Done,
            ]
        );
    }

    #[test]
    fn order_off_macos_skips_accessibility() {
        let order = step_order(false);
        assert!(!order.contains(&OnboardingStep::GrantAccessibility));
        assert_eq!(order.len(), 6);
    }

    #[test]
    fn initial_starts_at_welcome_position_one() {
        let s = initial(true);
        assert_eq!(s.current, OnboardingStep::Welcome);
        assert_eq!(s.position, 1);
        assert_eq!(s.total, 7);
        assert!(s.is_macos);
    }

    #[test]
    fn advance_moves_one_step() {
        let s = advance(initial(true));
        assert_eq!(s.current, OnboardingStep::GrantAccessibility);
        assert_eq!(s.position, 2);
    }

    #[test]
    fn advance_at_done_stays_done() {
        let mut s = initial(false);
        for _ in 0..10 {
            s = advance(s);
        }
        assert_eq!(s.current, OnboardingStep::Done);
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
