//! Text snippet expansion commands.
//!
//! Syncs snippet definitions to the Rust listener, enables/disables
//! expansion, and checks macOS Accessibility permissions.

use crate::ai::inline_emoji_fallback::CacheEntry;
use crate::error::AppError;
use crate::AppState;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter};

/// Syncs the active snippet definitions from the frontend into the Rust listener.
#[tauri::command]
pub fn sync_snippets_to_rust(
    snippets: Vec<(String, String)>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let mut map = state.active_snippets.lock().map_err(|_| AppError::Lock)?;
    map.clear();
    for (keyword, expansion) in snippets {
        map.insert(keyword, expansion);
    }
    Ok(())
}

/// Enables or disables the snippet expansion listener.
#[tauri::command]
pub fn set_snippets_enabled(
    enabled: bool,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), AppError> {
    if enabled {
        if !check_snippet_permission() {
            return Err(AppError::Platform(
                "Background expansion requires Accessibility permission. Open System Settings → Privacy & Security → Accessibility and add Asyar, then try again.".to_string(),
            ));
        }
        // Start the listener thread exactly once (rdev::listen is not restartable)
        if !state.listener_started.swap(true, Ordering::Relaxed) {
            crate::snippets::start_listener(app_handle);
        }
    }
    state.snippets_enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Returns `true` if the Accessibility permission required for snippets is granted (macOS only).
#[tauri::command]
pub fn check_snippet_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::is_accessibility_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Opens the macOS Accessibility preferences pane so the user can grant permission.
#[tauri::command]
pub fn open_accessibility_preferences() {
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::open_accessibility_prefs();
    }
}

/// Registers or replaces an extension's shortcode → expansion map.
///
/// All keys are validated before any mutation; the call is atomic — either
/// every key is stored or none are.
#[tauri::command]
pub fn contribute_shortcodes(
    extension_id: String,
    map: crate::snippets::ShortcodeMap,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    contribute_shortcodes_inner(extension_id, map, &state)
}

pub(crate) fn contribute_shortcodes_inner(
    extension_id: String,
    map: crate::snippets::ShortcodeMap,
    state: &AppState,
) -> Result<(), AppError> {
    for k in map.keys() {
        if !crate::snippets::is_valid_shortcode_key(k) {
            return Err(AppError::Platform(format!(
                "Invalid shortcode key \"{}\" (must match :[a-z0-9_+-]{{1,32}}:)",
                k
            )));
        }
    }
    let mut contributed = state
        .contributed_snippets
        .lock()
        .map_err(|_| AppError::Lock)?;
    contributed.insert(extension_id, map);
    Ok(())
}

/// Removes all shortcodes previously contributed by the given extension.
#[tauri::command]
pub fn revoke_shortcodes(
    extension_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    revoke_shortcodes_inner(extension_id, &state)
}

pub(crate) fn revoke_shortcodes_inner(
    extension_id: String,
    state: &AppState,
) -> Result<(), AppError> {
    let mut contributed = state
        .contributed_snippets
        .lock()
        .map_err(|_| AppError::Lock)?;
    contributed.remove(&extension_id);
    Ok(())
}

/// Records the outcome of an inline emoji fallback agent run.
///
/// On a hit, also emits `expand-snippet` so the existing paste-replace
/// pathway fires identically to a normal snippet expansion.
#[tauri::command]
pub fn record_inline_emoji_fallback_outcome(
    shortcode: String,
    outcome: String,
    emoji: Option<String>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), AppError> {
    let entry = match outcome.as_str() {
        "hit" => {
            let e = emoji.ok_or_else(|| AppError::Platform("hit requires emoji".into()))?;
            let kw_len = shortcode.chars().count();
            let _ = app_handle.emit_to(
                crate::SPOTLIGHT_LABEL,
                "expand-snippet",
                serde_json::json!({
                    "keywordLen": kw_len,
                    "expansion": e,
                }),
            );
            CacheEntry::Hit(e)
        }
        _ => CacheEntry::Miss,
    };
    state
        .inline_emoji_fallback
        .record_outcome(&shortcode, entry, std::time::Instant::now());
    Ok(())
}

/// Returns all learned shortcode → emoji hit pairs for the settings UI.
#[tauri::command]
pub fn list_learned_shortcodes(state: tauri::State<'_, AppState>) -> Vec<(String, String)> {
    list_learned_shortcodes_inner(&state)
}

pub(crate) fn list_learned_shortcodes_inner(state: &AppState) -> Vec<(String, String)> {
    state.inline_emoji_fallback.snapshot_hits()
}

/// Removes a single cached shortcode entry.
#[tauri::command]
pub fn forget_learned_shortcode(shortcode: String, state: tauri::State<'_, AppState>) {
    forget_learned_shortcode_inner(shortcode, &state);
}

pub(crate) fn forget_learned_shortcode_inner(shortcode: String, state: &AppState) {
    state.inline_emoji_fallback.forget(&shortcode);
}

/// Clears all cached shortcode entries.
#[tauri::command]
pub fn clear_learned_shortcodes(state: tauri::State<'_, AppState>) {
    clear_learned_shortcodes_inner(&state);
}

pub(crate) fn clear_learned_shortcodes_inner(state: &AppState) {
    state.inline_emoji_fallback.clear();
}

/// Enables or disables the inline AI emoji fallback dispatcher.
///
/// When disabled, every `shortcode-miss` event is silently dropped without
/// consuming rate-limit budget or touching the cache.
#[tauri::command]
pub fn set_inline_emoji_fallback_enabled(
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    set_inline_emoji_fallback_enabled_inner(enabled, &state);
    Ok(())
}

pub(crate) fn set_inline_emoji_fallback_enabled_inner(enabled: bool, state: &AppState) {
    state
        .inline_emoji_fallback
        .enabled
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
}

pub struct PromotedSnippet {
    pub keyword: String,
    pub expansion: String,
}

pub(crate) fn promote_learned_to_snippet_inner(
    shortcode: String,
    state: &AppState,
) -> Result<PromotedSnippet, AppError> {
    let hits = state.inline_emoji_fallback.snapshot_hits();
    let (_, emoji) = hits
        .into_iter()
        .find(|(k, _)| k == &shortcode)
        .ok_or_else(|| {
            AppError::Platform(format!(
                "Shortcode \"{}\" is not in the AI cache",
                shortcode
            ))
        })?;

    state.inline_emoji_fallback.forget(&shortcode);
    Ok(PromotedSnippet {
        keyword: shortcode,
        expansion: emoji,
    })
}

/// Promotes a learned AI-shortcode to a permanent user snippet.
///
/// Reads the emoji from the AI fallback cache, drops the cache entry, then
/// emits `snippet:promote-from-cache` so the frontend snippets service can
/// persist it via its existing SQLite path.
#[tauri::command]
pub fn promote_learned_to_snippet(
    shortcode: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    let promoted = promote_learned_to_snippet_inner(shortcode, &state)?;
    let _ = app_handle.emit_to(
        crate::SPOTLIGHT_LABEL,
        "snippet:promote-from-cache",
        serde_json::json!({
            "keyword": promoted.keyword,
            "expansion": promoted.expansion,
        }),
    );
    Ok(())
}

#[cfg(test)]
mod contribute_tests {
    use super::*;
    use crate::AppState;
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;
    use std::sync::Mutex;

    fn fresh_state() -> AppState {
        AppState {
            focus_locked: AtomicBool::new(false),
            user_shortcuts: Mutex::new(HashMap::new()),
            launcher_shortcut: Mutex::new(String::from("Alt+Space")),
            snippets_enabled: AtomicBool::new(false),
            asyar_visible: AtomicBool::new(false),
            launcher_keep_expanded: AtomicBool::new(false),
            active_snippets: Mutex::new(HashMap::new()),
            contributed_snippets: Mutex::new(HashMap::new()),
            listener_started: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            previous_hwnd: Mutex::new(0),
            #[cfg(target_os = "linux")]
            linux_prev_window_id: Mutex::new(0),
            is_expanding: AtomicBool::new(false),
            inline_emoji_fallback: Default::default(),
        }
    }

    #[test]
    fn list_learned_shortcodes_returns_only_hits() {
        let state = fresh_state();
        let now = std::time::Instant::now();
        state.inline_emoji_fallback.record_outcome(
            ":hit:",
            crate::ai::inline_emoji_fallback::CacheEntry::Hit("✨".into()),
            now,
        );
        state.inline_emoji_fallback.record_outcome(
            ":miss:",
            crate::ai::inline_emoji_fallback::CacheEntry::Miss,
            now,
        );
        let result = list_learned_shortcodes_inner(&state);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], (":hit:".to_string(), "✨".to_string()));
    }

    #[test]
    fn forget_learned_shortcode_drops_specific_entry() {
        let state = fresh_state();
        let now = std::time::Instant::now();
        state.inline_emoji_fallback.record_outcome(
            ":a:",
            crate::ai::inline_emoji_fallback::CacheEntry::Hit("A".into()),
            now,
        );
        state.inline_emoji_fallback.record_outcome(
            ":b:",
            crate::ai::inline_emoji_fallback::CacheEntry::Hit("B".into()),
            now,
        );
        forget_learned_shortcode_inner(":a:".to_string(), &state);
        let result = list_learned_shortcodes_inner(&state);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, ":b:");
    }

    #[test]
    fn clear_learned_shortcodes_drops_everything() {
        let state = fresh_state();
        let now = std::time::Instant::now();
        state.inline_emoji_fallback.record_outcome(
            ":a:",
            crate::ai::inline_emoji_fallback::CacheEntry::Hit("A".into()),
            now,
        );
        state.inline_emoji_fallback.record_outcome(
            ":b:",
            crate::ai::inline_emoji_fallback::CacheEntry::Hit("B".into()),
            now,
        );
        clear_learned_shortcodes_inner(&state);
        assert!(list_learned_shortcodes_inner(&state).is_empty());
    }

    #[test]
    fn contribute_stores_under_namespace() {
        let state = fresh_state();
        let mut map = HashMap::new();
        map.insert(":party:".to_string(), "🎉".to_string());

        contribute_shortcodes_inner("org.asyar.emoji".to_string(), map.clone(), &state).unwrap();

        let contributed = state.contributed_snippets.lock().unwrap();
        assert_eq!(
            contributed
                .get("org.asyar.emoji")
                .map(|m| m.get(":party:").cloned()),
            Some(Some("🎉".to_string())),
        );
    }

    #[test]
    fn revoke_drops_only_the_callers_contribution() {
        let state = fresh_state();
        let mut a = HashMap::new();
        a.insert(":hi:".to_string(), "HI".to_string());
        let mut b = HashMap::new();
        b.insert(":bye:".to_string(), "BYE".to_string());

        contribute_shortcodes_inner("ext.a".into(), a, &state).unwrap();
        contribute_shortcodes_inner("ext.b".into(), b, &state).unwrap();

        revoke_shortcodes_inner("ext.a".into(), &state).unwrap();

        let contributed = state.contributed_snippets.lock().unwrap();
        assert!(contributed.get("ext.a").is_none());
        assert!(contributed.get("ext.b").is_some());
    }

    #[test]
    fn contribute_rejects_malformed_keys_atomically() {
        let state = fresh_state();
        let mut map = HashMap::new();
        map.insert(":good:".into(), "ok".into());
        map.insert(":BAD KEY:".into(), "no".into());

        let res = contribute_shortcodes_inner("ext.x".into(), map, &state);
        assert!(res.is_err());
        let contributed = state.contributed_snippets.lock().unwrap();
        assert!(contributed.get("ext.x").is_none());
    }

    #[test]
    fn promote_learned_writes_to_snippet_store_and_drops_cache() {
        let state = fresh_state();
        let now = std::time::Instant::now();
        state.inline_emoji_fallback.record_outcome(
            ":burnout:",
            crate::ai::inline_emoji_fallback::CacheEntry::Hit("😮‍💨".into()),
            now,
        );
        assert_eq!(
            state.inline_emoji_fallback.snapshot_hits(),
            vec![(":burnout:".to_string(), "😮‍💨".to_string())]
        );

        let payload = promote_learned_to_snippet_inner(":burnout:".to_string(), &state)
            .expect("promote_inner ok");
        assert_eq!(payload.keyword, ":burnout:");
        assert_eq!(payload.expansion, "😮‍💨");

        assert!(state.inline_emoji_fallback.snapshot_hits().is_empty());
    }

    #[test]
    fn promote_learned_returns_err_when_shortcode_not_cached() {
        let state = fresh_state();
        let res = promote_learned_to_snippet_inner(":unknown:".to_string(), &state);
        assert!(res.is_err());
    }

    #[test]
    fn set_inline_emoji_fallback_enabled_updates_the_atomic() {
        let state = fresh_state();
        assert!(state
            .inline_emoji_fallback
            .enabled
            .load(std::sync::atomic::Ordering::Relaxed));
        set_inline_emoji_fallback_enabled_inner(false, &state);
        assert!(!state
            .inline_emoji_fallback
            .enabled
            .load(std::sync::atomic::Ordering::Relaxed));
        set_inline_emoji_fallback_enabled_inner(true, &state);
        assert!(state
            .inline_emoji_fallback
            .enabled
            .load(std::sync::atomic::Ordering::Relaxed));
    }
}
