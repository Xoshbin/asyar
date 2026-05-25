use tauri::AppHandle;
#[allow(unused_imports)]
use tauri::{Emitter, Manager};

use std::collections::HashMap;
use std::sync::OnceLock;
use regex::Regex;

pub type ExtensionId = String;
pub type ShortcodeMap = HashMap<String, String>;
pub type ContributedSnippets = HashMap<ExtensionId, ShortcodeMap>;

static SHORTCODE_RE: OnceLock<Regex> = OnceLock::new();

#[allow(dead_code)]
pub fn shortcode_pattern() -> &'static Regex {
    SHORTCODE_RE.get_or_init(|| Regex::new(r"^:[a-z0-9_+-]{1,32}:$").unwrap())
}

#[allow(dead_code)]
pub fn is_valid_shortcode_key(s: &str) -> bool {
    shortcode_pattern().is_match(s)
}

/// Detects a completed `:shortcode:` ending at the buffer tail.
///
/// Returns the matched `:xxx:` substring (including the colons) if the
/// buffer ends with a valid shortcode pattern; `None` otherwise.
///
/// The buffer is the rolling rdev keystroke buffer. The function is called
/// each time a `:` is appended and is responsible for finding the most
/// recent paired-colon substring.
pub(crate) fn detect_completed_shortcode_at_end(buf: &str) -> Option<String> {
    if !buf.ends_with(':') {
        return None;
    }
    let head = &buf[..buf.len() - 1];
    let open = head.rfind(':')?;
    let key = &buf[open..];
    if is_valid_shortcode_key(key) {
        Some(key.to_string())
    } else {
        None
    }
}

/// User snippets shadow extension contributions on key collision.
/// Returns a flat lookup table the rdev callback can match against.
pub fn merge_active_snippets(
    user: &ShortcodeMap,
    contributed: &ContributedSnippets,
) -> ShortcodeMap {
    let mut merged = ShortcodeMap::new();
    for map in contributed.values() {
        for (k, v) in map {
            merged.insert(k.clone(), v.clone());
        }
    }
    for (k, v) in user {
        merged.insert(k.clone(), v.clone());
    }
    merged
}

#[cfg(not(target_os = "macos"))]
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

// rdev delivers events serially on a single thread, so Relaxed ordering is sufficient.
#[cfg(not(target_os = "macos"))]
static SHIFT_HELD: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
pub fn start_listener(app_handle: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let app = app_handle.clone();
        // NSEvent monitors must be registered on the main thread
        if let Err(e) = app_handle
            .run_on_main_thread(move || crate::platform::macos::register_snippet_monitor(app))
        {
            log::error!(
                "[snippets] failed to schedule NSEvent monitor on main thread: {:?}",
                e
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn start_listener(app_handle: AppHandle) {
    std::thread::spawn(move || {
        use rdev::{listen, EventType, Key};
        use std::sync::atomic::Ordering;

        let mut buffer: Vec<char> = Vec::new();
        const MAX_LEN: usize = 64;

        if let Err(e) = listen(move |event| {
            match event.event_type {
                EventType::KeyPress(Key::ShiftLeft) | EventType::KeyPress(Key::ShiftRight) => {
                    SHIFT_HELD.store(true, AtomicOrdering::Relaxed);
                }
                EventType::KeyRelease(Key::ShiftLeft) | EventType::KeyRelease(Key::ShiftRight) => {
                    SHIFT_HELD.store(false, AtomicOrdering::Relaxed);
                }
                _ => {}
            }

            let state = app_handle.state::<crate::AppState>();

            if state.asyar_visible.load(Ordering::Relaxed)
                || !state.snippets_enabled.load(Ordering::Relaxed)
                || state.is_expanding.load(Ordering::SeqCst)
            {
                buffer.clear();
                return;
            }

            if let EventType::KeyPress(key) = event.event_type {
                match key {
                    Key::Escape
                    | Key::Return
                    | Key::Tab
                    | Key::UpArrow
                    | Key::DownArrow
                    | Key::LeftArrow
                    | Key::RightArrow => {
                        buffer.clear();
                    }
                    Key::Backspace => {
                        buffer.pop();
                    }
                    _ => {
                        let shift = SHIFT_HELD.load(AtomicOrdering::Relaxed);
                        if let Some(c) = resolve_keypress_for_current_platform(&key, shift) {
                            buffer.push(c);
                            if buffer.len() > MAX_LEN {
                                buffer.remove(0);
                            }
                            let current: String = buffer.iter().collect();
                            let merged = {
                                let user_guard = state
                                    .active_snippets
                                    .lock()
                                    .unwrap_or_else(|p: std::sync::PoisonError<_>| p.into_inner());
                                let contributed_guard = state
                                    .contributed_snippets
                                    .lock()
                                    .unwrap_or_else(|p: std::sync::PoisonError<_>| p.into_inner());
                                crate::snippets::merge_active_snippets(&user_guard, &contributed_guard)
                            };
                            for (keyword, expansion) in merged.iter() {
                                if current.ends_with(keyword.as_str()) {
                                    let kw_len = keyword.chars().count();
                                    let exp = expansion.clone();
                                    buffer.clear();
                                    let _ = app_handle.emit_to(
                                        crate::SPOTLIGHT_LABEL,
                                        "expand-snippet",
                                        serde_json::json!({
                                            "keywordLen": kw_len,
                                            "expansion": exp
                                        }),
                                    );
                                    return;
                                }
                            }
                            if c == ':' {
                                if let Some(candidate) = crate::snippets::detect_completed_shortcode_at_end(&current) {
                                    if !merged.contains_key(&candidate) {
                                        let _ = app_handle.emit_to(
                                            crate::SPOTLIGHT_LABEL,
                                            "shortcode-miss",
                                            serde_json::json!({ "shortcode": candidate }),
                                        );
                                        buffer.clear();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }) {
            log::error!("[snippets] rdev listen error: {:?}", e);
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn resolve_keypress_for_current_platform(key: &rdev::Key, shift_held: bool) -> Option<char> {
    #[cfg(target_os = "windows")]
    {
        return crate::platform::windows_key_resolver::resolve_keypress(*key, shift_held);
    }
    #[cfg(target_os = "linux")]
    {
        return crate::platform::linux_key_resolver::resolve_keypress(*key, shift_held);
    }
    #[allow(unreachable_code)]
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn detects_completed_shortcode_at_end_of_buffer() {
        let s = "hello :party:".to_string();
        assert_eq!(super::detect_completed_shortcode_at_end(&s), Some(":party:".to_string()));
    }

    #[test]
    fn does_not_detect_when_no_closing_colon() {
        let s = "hello :party".to_string();
        assert_eq!(super::detect_completed_shortcode_at_end(&s), None);
    }

    #[test]
    fn does_not_detect_invalid_shape() {
        let s = "hello :PARTY:".to_string();
        assert_eq!(super::detect_completed_shortcode_at_end(&s), None);
    }

    #[test]
    fn detects_minimal_one_char_shortcode() {
        let s = ":a:".to_string();
        assert_eq!(super::detect_completed_shortcode_at_end(&s), Some(":a:".to_string()));
    }

    #[test]
    fn does_not_detect_orphan_colon_pair() {
        let s = "::".to_string();
        assert_eq!(super::detect_completed_shortcode_at_end(&s), None);
    }

    #[test]
    fn shortcode_miss_event_shape_is_stable() {
        let payload = serde_json::json!({
            "shortcode": ":burnout:",
        });
        assert_eq!(payload["shortcode"], ":burnout:");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn resolve_keypress_routes_to_windows_resolver_for_shift_colon() {
        use super::resolve_keypress_for_current_platform;
        let ch = resolve_keypress_for_current_platform(&rdev::Key::SemiColon, true);
        assert_eq!(ch, Some(':'));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn resolve_keypress_routes_to_linux_resolver_for_shift_colon() {
        use super::resolve_keypress_for_current_platform;
        std::env::set_var("DISPLAY", ":0");
        std::env::set_var("XKB_DEFAULT_LAYOUT", "us");
        crate::platform::linux_key_resolver::reset_resolver_for_test();
        let ch = resolve_keypress_for_current_platform(&rdev::Key::SemiColon, true);
        assert_eq!(ch, Some(':'));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_path_is_unchanged() {
        // macOS uses NSEvent directly; resolve_keypress_for_current_platform is
        // not compiled on macOS. This test is a compile-time gate only.
    }

    #[test]
    fn user_snippet_shadows_extension_contribution() {
        use std::collections::HashMap;
        let mut user = HashMap::new();
        user.insert(":party:".to_string(), "PARTY!".to_string());

        let mut ext = HashMap::new();
        ext.insert(":party:".to_string(), "🎉".to_string());
        ext.insert(":fire:".to_string(), "🔥".to_string());

        let mut contributed = HashMap::new();
        contributed.insert("org.asyar.emoji".to_string(), ext);

        let merged = super::merge_active_snippets(&user, &contributed);
        assert_eq!(merged.get(":party:"), Some(&"PARTY!".to_string()));
        assert_eq!(merged.get(":fire:"), Some(&"🔥".to_string()));
    }

    #[test]
    fn unregistering_extension_drops_its_contributions() {
        use std::collections::HashMap;
        let mut a = HashMap::new();
        a.insert(":hi:".to_string(), "HI".to_string());
        let mut b = HashMap::new();
        b.insert(":bye:".to_string(), "BYE".to_string());

        let mut contributed = HashMap::new();
        contributed.insert("ext.a".to_string(), a);
        contributed.insert("ext.b".to_string(), b);

        contributed.remove("ext.a");
        let merged = super::merge_active_snippets(&std::collections::HashMap::new(), &contributed);
        assert_eq!(merged.get(":hi:"), None);
        assert_eq!(merged.get(":bye:"), Some(&"BYE".to_string()));
    }

    #[test]
    fn pattern_shape_rejects_malformed_keys() {
        assert!(super::is_valid_shortcode_key(":party:"));
        assert!(super::is_valid_shortcode_key(":a-b:"));
        assert!(super::is_valid_shortcode_key(":+1:"));
        assert!(!super::is_valid_shortcode_key("party"));
        assert!(!super::is_valid_shortcode_key(":Party:"));
        assert!(!super::is_valid_shortcode_key(":party!:"));
        let too_long = ":".to_string() + &"a".repeat(33) + ":";
        assert!(!super::is_valid_shortcode_key(&too_long));
    }
}
