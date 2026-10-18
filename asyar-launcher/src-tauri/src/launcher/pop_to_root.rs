use crate::{AppState, HideStamp};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime};
use tauri::Manager;

const HIDE_COALESCE_WINDOW: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PopToRootDelay {
    Immediately,
    Secs10,
    Min1,
    Min5,
    Never,
}

impl PopToRootDelay {
    pub(crate) const DEFAULT: Self = Self::Min1;

    pub(crate) fn as_duration(self) -> Option<Duration> {
        match self {
            Self::Immediately => Some(Duration::ZERO),
            Self::Secs10 => Some(Duration::from_secs(10)),
            Self::Min1 => Some(Duration::from_secs(60)),
            Self::Min5 => Some(Duration::from_secs(5 * 60)),
            Self::Never => None,
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value {
            "immediately" => Some(Self::Immediately),
            "10s" => Some(Self::Secs10),
            "1m" => Some(Self::Min1),
            "5m" => Some(Self::Min5),
            "never" => Some(Self::Never),
            _ => None,
        }
    }
}

pub(crate) fn parse_pop_to_root_delay(settings: Option<&serde_json::Value>) -> PopToRootDelay {
    let general = settings.and_then(|root| root.get("general"));
    if let Some(value) = general.and_then(|value| value.get("popToRootDelay")) {
        return value
            .as_str()
            .and_then(PopToRootDelay::from_str)
            .unwrap_or(PopToRootDelay::DEFAULT);
    }

    if general
        .and_then(|value| value.get("restoreLastView"))
        .and_then(|value| value.as_bool())
        == Some(false)
    {
        return PopToRootDelay::Immediately;
    }

    PopToRootDelay::DEFAULT
}

pub(crate) fn effective_hidden_elapsed(mono: Duration, wall: Option<Duration>) -> Duration {
    wall.map_or(mono, |wall| wall.max(mono))
}

pub(crate) fn should_pop_to_root(elapsed: Option<Duration>, delay: PopToRootDelay) -> bool {
    let Some(elapsed) = elapsed else {
        return false;
    };
    delay
        .as_duration()
        .is_some_and(|threshold| elapsed >= threshold)
}

pub(crate) fn should_coalesce_hide(since_previous: Option<Duration>) -> bool {
    since_previous.is_some_and(|elapsed| elapsed < HIDE_COALESCE_WINDOW)
}

pub(crate) fn read_pop_to_root_delay(app: &tauri::AppHandle) -> PopToRootDelay {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("settings.dat") else {
        return PopToRootDelay::DEFAULT;
    };
    parse_pop_to_root_delay(store.get("settings").as_ref())
}

fn elapsed_since(stamp: &HideStamp) -> Duration {
    effective_hidden_elapsed(
        stamp.mono.elapsed(),
        SystemTime::now().duration_since(stamp.wall).ok(),
    )
}

fn emit_pop_to_root(app: &tauri::AppHandle) {
    crate::event_bridge::bridge_emit(app, "asyar:pop-to-root", ());
}

pub(crate) fn on_launcher_hidden(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    if state.focus_locked.load(Ordering::Relaxed) {
        return;
    }
    let now = HideStamp {
        mono: Instant::now(),
        wall: SystemTime::now(),
    };
    let since_previous = state
        .last_hidden_at
        .lock()
        .ok()
        .and_then(|mut stamp| stamp.replace(now).map(|previous| previous.mono.elapsed()));

    if should_coalesce_hide(since_previous) {
        return;
    }

    crate::event_bridge::bridge_emit(app, "asyar:launcher-did-hide", ());
    arm(app);
}

pub(crate) fn arm(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let generation = state.pop_to_root_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let delay = read_pop_to_root_delay(app);
    let Some(threshold) = delay.as_duration() else {
        return;
    };

    let elapsed = state
        .last_hidden_at
        .lock()
        .ok()
        .and_then(|stamp| stamp.as_ref().map(elapsed_since));
    if should_pop_to_root(elapsed, delay) {
        if let Ok(mut stamp) = state.last_hidden_at.lock() {
            *stamp = None;
        }
        emit_pop_to_root(app);
        return;
    }
    let Some(elapsed) = elapsed else {
        return;
    };
    let mut remaining = threshold.saturating_sub(elapsed);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(remaining).await;
            let state = app.state::<AppState>();
            if state.pop_to_root_generation.load(Ordering::SeqCst) != generation
                || state.asyar_visible.load(Ordering::Relaxed)
            {
                return;
            }

            let elapsed = state
                .last_hidden_at
                .lock()
                .ok()
                .and_then(|stamp| stamp.as_ref().map(elapsed_since));
            if should_pop_to_root(elapsed, delay) {
                if let Ok(mut stamp) = state.last_hidden_at.lock() {
                    *stamp = None;
                }
                emit_pop_to_root(&app);
                return;
            }
            let Some(elapsed) = elapsed else {
                return;
            };
            remaining = threshold.saturating_sub(elapsed);
        }
    });
}

pub(crate) fn on_native_summon(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    state.pop_to_root_generation.fetch_add(1, Ordering::SeqCst);
    let stamp = state
        .last_hidden_at
        .lock()
        .ok()
        .and_then(|mut stamp| stamp.take());
    if should_pop_to_root(
        stamp.as_ref().map(elapsed_since),
        read_pop_to_root_delay(app),
    ) {
        emit_pop_to_root(app);
    }
}

pub(crate) fn on_launcher_revealed(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    state.pop_to_root_generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut stamp) = state.last_hidden_at.lock() {
        *stamp = None;
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_all_delay_values() {
        for (raw, expected) in [
            ("immediately", PopToRootDelay::Immediately),
            ("10s", PopToRootDelay::Secs10),
            ("1m", PopToRootDelay::Min1),
            ("5m", PopToRootDelay::Min5),
            ("never", PopToRootDelay::Never),
        ] {
            let settings = json!({ "general": { "popToRootDelay": raw } });
            assert_eq!(parse_pop_to_root_delay(Some(&settings)), expected);
        }
    }

    #[test]
    fn missing_or_unknown_delay_uses_default() {
        assert_eq!(parse_pop_to_root_delay(None), PopToRootDelay::Min1);
        assert_eq!(
            parse_pop_to_root_delay(Some(&json!({}))),
            PopToRootDelay::Min1
        );
        assert_eq!(
            parse_pop_to_root_delay(Some(&json!({ "general": {} }))),
            PopToRootDelay::Min1
        );
        assert_eq!(
            parse_pop_to_root_delay(Some(&json!({ "general": { "popToRootDelay": "later" } }))),
            PopToRootDelay::Min1
        );
        assert_eq!(
            parse_pop_to_root_delay(Some(&json!({
                "general": { "popToRootDelay": "later", "restoreLastView": false }
            }))),
            PopToRootDelay::Min1
        );
    }

    #[test]
    fn legacy_false_maps_to_immediately_and_true_to_default() {
        assert_eq!(
            parse_pop_to_root_delay(Some(&json!({ "general": { "restoreLastView": false } }))),
            PopToRootDelay::Immediately
        );
        assert_eq!(
            parse_pop_to_root_delay(Some(&json!({ "general": { "restoreLastView": true } }))),
            PopToRootDelay::Min1
        );
    }

    #[test]
    fn explicit_delay_wins_over_legacy_boolean() {
        let settings = json!({
            "general": { "popToRootDelay": "never", "restoreLastView": false }
        });
        assert_eq!(
            parse_pop_to_root_delay(Some(&settings)),
            PopToRootDelay::Never
        );
    }

    #[test]
    fn pop_policy_honors_boundaries_and_never() {
        assert!(!should_pop_to_root(None, PopToRootDelay::Immediately));
        assert!(should_pop_to_root(
            Some(Duration::ZERO),
            PopToRootDelay::Immediately
        ));
        assert!(!should_pop_to_root(
            Some(Duration::from_secs(9)),
            PopToRootDelay::Secs10
        ));
        assert!(should_pop_to_root(
            Some(Duration::from_secs(10)),
            PopToRootDelay::Secs10
        ));
        assert!(!should_pop_to_root(
            Some(Duration::from_secs(24 * 60 * 60)),
            PopToRootDelay::Never
        ));
    }

    #[test]
    fn effective_elapsed_uses_the_larger_safe_clock() {
        assert_eq!(
            effective_hidden_elapsed(Duration::from_secs(5), Some(Duration::from_secs(300))),
            Duration::from_secs(300)
        );
        assert_eq!(
            effective_hidden_elapsed(Duration::from_secs(5), None),
            Duration::from_secs(5)
        );
    }

    #[test]
    fn coalesces_only_reentrant_hides_inside_grace_window() {
        assert!(!should_coalesce_hide(None));
        assert!(should_coalesce_hide(Some(Duration::from_millis(10))));
        assert!(!should_coalesce_hide(Some(Duration::from_millis(400))));
    }
}
