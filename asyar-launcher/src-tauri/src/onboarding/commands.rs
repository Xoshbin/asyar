//! Tauri-layer wrappers around the onboarding state machine. Pure logic
//! lives in `state.rs` and `persistence.rs`.

use crate::error::AppError;
use crate::onboarding::state::{advance, go_back, initial, OnboardingState};
use std::sync::Mutex;

/// Cursor stored across invocations — reset to `initial(...)` whenever
/// the onboarding window is opened (Task 6 owns that reset).
pub struct OnboardingCursor(pub Mutex<OnboardingState>);

impl OnboardingCursor {
    pub fn new(is_macos: bool) -> Self {
        Self(Mutex::new(initial(is_macos)))
    }
}

pub fn get_state_inner(cursor: &OnboardingCursor) -> Result<OnboardingState, AppError> {
    let guard = cursor.0.lock().map_err(|_| AppError::Lock)?;
    Ok(*guard)
}

pub fn advance_inner(cursor: &OnboardingCursor) -> Result<OnboardingState, AppError> {
    let mut guard = cursor.0.lock().map_err(|_| AppError::Lock)?;
    *guard = advance(*guard);
    Ok(*guard)
}

pub fn go_back_inner(cursor: &OnboardingCursor) -> Result<OnboardingState, AppError> {
    let mut guard = cursor.0.lock().map_err(|_| AppError::Lock)?;
    *guard = go_back(*guard);
    Ok(*guard)
}

// ── Tauri command wrappers ─────────────────────────────────────────────────

use tauri::{AppHandle, Emitter, State};

/// Emit cross-window settings events so the launcher webview's listeners
/// (in `appInitializer.ts`) apply the user's onboarding choices to the
/// running launcher panel — geometry for `launchView`, `applyTheme` for
/// `activeTheme`. The launcher reacts identically whether the source is
/// the Settings window or onboarding.
fn broadcast_onboarding_settings(app: &AppHandle) {
    let launch_view = crate::onboarding::persistence::read_launch_view(app);
    if let Err(e) = app.emit(
        "asyar:launch-view-changed",
        serde_json::json!({ "launchView": launch_view }),
    ) {
        log::warn!("emit asyar:launch-view-changed: {e}");
    }

    let theme_id = crate::onboarding::persistence::read_active_theme(app);
    if let Err(e) = app.emit(
        "asyar:theme-changed",
        serde_json::json!({ "themeId": theme_id }),
    ) {
        log::warn!("emit asyar:theme-changed: {e}");
    }
}

#[tauri::command]
pub fn get_onboarding_state(
    cursor: State<'_, OnboardingCursor>,
) -> Result<OnboardingState, AppError> {
    get_state_inner(&cursor)
}

#[tauri::command]
pub fn advance_onboarding_step(
    cursor: State<'_, OnboardingCursor>,
) -> Result<OnboardingState, AppError> {
    advance_inner(&cursor)
}

#[tauri::command]
pub fn go_back_onboarding_step(
    cursor: State<'_, OnboardingCursor>,
) -> Result<OnboardingState, AppError> {
    go_back_inner(&cursor)
}

#[tauri::command]
pub fn complete_onboarding(app: AppHandle) -> Result<(), AppError> {
    crate::onboarding::persistence::write_onboarding_completed(&app, true)?;
    // Broadcast the user's choices to the launcher webview before showing
    // it — guarantees the launcher applies the selected launch view + theme
    // even if a JS-emit during the flow was racy.
    broadcast_onboarding_settings(&app);
    crate::onboarding::window::close(&app)?;
    crate::onboarding::window::show_launcher_panel(&app)?;
    Ok(())
}

#[tauri::command]
pub fn dismiss_onboarding(app: AppHandle) -> Result<(), AppError> {
    // Recommended close behavior: dismiss = mark completed, no panel pop.
    crate::onboarding::persistence::write_onboarding_completed(&app, true)?;
    crate::onboarding::window::close(&app)?;
    Ok(())
}

#[tauri::command]
pub fn reset_onboarding(
    app: AppHandle,
    cursor: State<'_, OnboardingCursor>,
) -> Result<(), AppError> {
    crate::onboarding::persistence::write_onboarding_completed(&app, false)?;
    {
        let mut guard = cursor.0.lock().map_err(|_| AppError::Lock)?;
        *guard = initial(cfg!(target_os = "macos"));
    }
    crate::onboarding::window::open(&app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onboarding::state::OnboardingStep;

    #[test]
    fn get_state_returns_initial() {
        let c = OnboardingCursor::new(true);
        let s = get_state_inner(&c).unwrap();
        assert_eq!(s.current, OnboardingStep::Welcome);
        assert_eq!(s.position, 1);
    }

    #[test]
    fn advance_then_get_returns_advanced() {
        let c = OnboardingCursor::new(true);
        let advanced = advance_inner(&c).unwrap();
        let fetched = get_state_inner(&c).unwrap();
        assert_eq!(fetched, advanced);
        assert_eq!(fetched.current, OnboardingStep::GrantAccessibility);
    }

    #[test]
    fn go_back_at_first_step_is_idempotent() {
        let c = OnboardingCursor::new(false);
        let s1 = go_back_inner(&c).unwrap();
        let s2 = go_back_inner(&c).unwrap();
        assert_eq!(s1, s2);
    }
}
