//! Inline AI fallback for unmatched `:xxx:` shortcodes.
//! Receives `shortcode-miss` events, gates on rate limit + caches, then
//! emits `emoji-fallback` to the frontend bridge which dispatches a silent
//! agent run that paste-replaces the trigger.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_DISPATCHES_PER_MIN: usize = 10;
const CACHE_CAP: usize = 512;
const CACHE_TTL: Duration = Duration::from_secs(60 * 60 * 24);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CacheEntry {
    Hit(String),
    Miss,
}

pub struct InlineEmojiFallbackState {
    cache: Mutex<HashMap<String, (CacheEntry, Instant)>>,
    cache_order: Mutex<VecDeque<String>>,
    in_flight: Mutex<HashMap<String, ()>>,
    recent_dispatches: Mutex<VecDeque<Instant>>,
    pub enabled: AtomicBool,
}

impl Default for InlineEmojiFallbackState {
    fn default() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
            cache_order: Mutex::new(VecDeque::new()),
            in_flight: Mutex::new(HashMap::new()),
            recent_dispatches: Mutex::new(VecDeque::new()),
            enabled: AtomicBool::new(true),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum DispatchDecision {
    UseCached(String),
    SkipCached,
    SkipInFlight,
    SkipRateLimit,
    Dispatch,
}

impl InlineEmojiFallbackState {
    pub fn evaluate(&self, shortcode: &str, now: Instant) -> DispatchDecision {
        if !self.enabled.load(Ordering::Relaxed) {
            return DispatchDecision::SkipCached;
        }
        self.evict_expired(now);

        if let Some((entry, _)) = self.cache.lock().unwrap().get(shortcode).cloned() {
            return match entry {
                CacheEntry::Hit(emoji) => DispatchDecision::UseCached(emoji),
                CacheEntry::Miss => DispatchDecision::SkipCached,
            };
        }

        let mut in_flight = self.in_flight.lock().unwrap();
        if in_flight.contains_key(shortcode) {
            return DispatchDecision::SkipInFlight;
        }

        let mut recent = self.recent_dispatches.lock().unwrap();
        while let Some(&front) = recent.front() {
            if now.duration_since(front) > Duration::from_secs(60) {
                recent.pop_front();
            } else {
                break;
            }
        }
        if recent.len() >= MAX_DISPATCHES_PER_MIN {
            return DispatchDecision::SkipRateLimit;
        }

        recent.push_back(now);
        in_flight.insert(shortcode.to_string(), ());
        DispatchDecision::Dispatch
    }

    pub fn record_outcome(&self, shortcode: &str, outcome: CacheEntry, now: Instant) {
        self.in_flight.lock().unwrap().remove(shortcode);
        let mut cache = self.cache.lock().unwrap();
        let mut order = self.cache_order.lock().unwrap();

        if cache.len() >= CACHE_CAP && !cache.contains_key(shortcode) {
            if let Some(oldest) = order.pop_front() {
                cache.remove(&oldest);
            }
        }
        cache.insert(shortcode.to_string(), (outcome, now));
        order.retain(|s| s != shortcode);
        order.push_back(shortcode.to_string());
    }

    fn evict_expired(&self, now: Instant) {
        let mut cache = self.cache.lock().unwrap();
        let mut order = self.cache_order.lock().unwrap();
        let expired: Vec<String> = cache
            .iter()
            .filter(|(_, (_, t))| now.duration_since(*t) > CACHE_TTL)
            .map(|(k, _)| k.clone())
            .collect();
        for k in &expired {
            cache.remove(k);
            order.retain(|s| s != k);
        }
    }

    pub fn snapshot_hits(&self) -> Vec<(String, String)> {
        let cache = self.cache.lock().unwrap();
        cache
            .iter()
            .filter_map(|(k, (e, _))| {
                if let CacheEntry::Hit(emoji) = e {
                    Some((k.clone(), emoji.clone()))
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn forget(&self, shortcode: &str) {
        self.cache.lock().unwrap().remove(shortcode);
        self.cache_order.lock().unwrap().retain(|s| s != shortcode);
    }

    pub fn clear(&self) {
        self.cache.lock().unwrap().clear();
        self.cache_order.lock().unwrap().clear();
    }
}

use tauri::{AppHandle, Emitter, Listener, Manager};

pub fn install_shortcode_miss_listener(app: AppHandle) {
    let Some(window) = app.get_webview_window(crate::SPOTLIGHT_LABEL) else {
        log::warn!(
            "[inline-emoji-fallback] main window not found; shortcode-miss listener not installed"
        );
        return;
    };
    let app_for_handler = app.clone();
    window.listen("shortcode-miss", move |event| {
        let payload: serde_json::Value = match serde_json::from_str(event.payload()) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("[inline-emoji-fallback] malformed shortcode-miss payload: {e}");
                return;
            }
        };
        let shortcode = match payload.get("shortcode").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => return,
        };

        let state = app_for_handler.state::<crate::AppState>();
        let decision = state
            .inline_emoji_fallback
            .evaluate(&shortcode, std::time::Instant::now());

        match decision {
            DispatchDecision::Dispatch => {
                let inner = shortcode.trim_matches(':').to_string();
                let _ = app_for_handler.emit_to(
                    crate::SPOTLIGHT_LABEL,
                    "emoji-fallback",
                    serde_json::json!({
                        "agentId": "emoji-fallback",
                        "shortcode": shortcode,
                        "userText": inner,
                        "timeoutMs": 1500,
                    }),
                );
            }
            DispatchDecision::UseCached(emoji) => {
                let kw_len = shortcode.chars().count();
                let _ = app_for_handler.emit_to(
                    crate::SPOTLIGHT_LABEL,
                    "expand-snippet",
                    serde_json::json!({
                        "keywordLen": kw_len,
                        "expansion": emoji,
                    }),
                );
            }
            DispatchDecision::SkipCached
            | DispatchDecision::SkipInFlight
            | DispatchDecision::SkipRateLimit => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_miss_dispatches() {
        let s = InlineEmojiFallbackState::default();
        assert!(matches!(
            s.evaluate(":party:", Instant::now()),
            DispatchDecision::Dispatch
        ));
    }

    #[test]
    fn second_call_for_same_shortcode_in_flight_is_deduped() {
        let s = InlineEmojiFallbackState::default();
        let now = Instant::now();
        let _ = s.evaluate(":party:", now);
        assert!(matches!(
            s.evaluate(":party:", now),
            DispatchDecision::SkipInFlight
        ));
    }

    #[test]
    fn hit_cache_skips_dispatch() {
        let s = InlineEmojiFallbackState::default();
        let now = Instant::now();
        let _ = s.evaluate(":party:", now);
        s.record_outcome(":party:", CacheEntry::Hit("🎉".into()), now);
        let d = s.evaluate(":party:", now);
        assert!(matches!(d, DispatchDecision::UseCached(ref e) if e == "🎉"));
    }

    #[test]
    fn miss_cache_skips_dispatch_silently() {
        let s = InlineEmojiFallbackState::default();
        let now = Instant::now();
        let _ = s.evaluate(":asdfgh:", now);
        s.record_outcome(":asdfgh:", CacheEntry::Miss, now);
        assert!(matches!(
            s.evaluate(":asdfgh:", now),
            DispatchDecision::SkipCached
        ));
    }

    #[test]
    fn rate_limit_drops_11th_dispatch_within_window() {
        let s = InlineEmojiFallbackState::default();
        let now = Instant::now();
        for i in 0..10 {
            let key = format!(":x{i}:");
            assert!(matches!(s.evaluate(&key, now), DispatchDecision::Dispatch));
            s.record_outcome(&key, CacheEntry::Miss, now);
            s.forget(&key);
        }
        assert!(matches!(
            s.evaluate(":x11:", now),
            DispatchDecision::SkipRateLimit
        ));
    }

    #[test]
    fn rate_limit_resets_after_minute_window() {
        let s = InlineEmojiFallbackState::default();
        let start = Instant::now();
        for i in 0..10 {
            let key = format!(":y{i}:");
            let _ = s.evaluate(&key, start);
            s.record_outcome(&key, CacheEntry::Miss, start);
            s.forget(&key);
        }
        let later = start + Duration::from_secs(61);
        assert!(matches!(
            s.evaluate(":y11:", later),
            DispatchDecision::Dispatch
        ));
    }

    #[test]
    fn cache_evicts_after_24h() {
        let s = InlineEmojiFallbackState::default();
        let t0 = Instant::now();
        s.record_outcome(":party:", CacheEntry::Hit("🎉".into()), t0);
        let later = t0 + CACHE_TTL + Duration::from_secs(1);
        assert!(matches!(
            s.evaluate(":party:", later),
            DispatchDecision::Dispatch
        ));
    }

    #[test]
    fn promoting_an_entry_forgets_it() {
        let s = InlineEmojiFallbackState::default();
        let t = Instant::now();
        s.record_outcome(":party:", CacheEntry::Hit("🎉".into()), t);
        s.forget(":party:");
        assert!(matches!(
            s.evaluate(":party:", t),
            DispatchDecision::Dispatch
        ));
    }

    #[test]
    fn snapshot_returns_only_hits_not_misses() {
        let s = InlineEmojiFallbackState::default();
        let t = Instant::now();
        s.record_outcome(":hit:", CacheEntry::Hit("✨".into()), t);
        s.record_outcome(":miss:", CacheEntry::Miss, t);
        let snap = s.snapshot_hits();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0], (":hit:".to_string(), "✨".to_string()));
    }

    #[test]
    fn record_outcome_hit_makes_subsequent_evaluate_use_cached() {
        let s = InlineEmojiFallbackState::default();
        let t = Instant::now();
        s.record_outcome(":party:", CacheEntry::Hit("🎉".into()), t);
        assert!(
            matches!(s.evaluate(":party:", t), DispatchDecision::UseCached(ref e) if e == "🎉")
        );
    }

    #[test]
    fn lru_eviction_drops_oldest_when_full() {
        let s = InlineEmojiFallbackState::default();
        let t = Instant::now();
        for i in 0..CACHE_CAP {
            s.record_outcome(&format!(":k{i}:"), CacheEntry::Hit(format!("{i}")), t);
        }
        s.record_outcome(":overflow:", CacheEntry::Hit("X".into()), t);
        let snap_keys: Vec<String> = s.snapshot_hits().iter().map(|(k, _)| k.clone()).collect();
        assert!(
            !snap_keys.contains(&":k0:".to_string()),
            ":k0: should have been evicted"
        );
        assert!(snap_keys.contains(&":overflow:".to_string()));
    }

    #[test]
    fn disabled_returns_skip_cached_immediately() {
        let s = InlineEmojiFallbackState::default();
        s.enabled.store(false, std::sync::atomic::Ordering::Relaxed);
        let d = s.evaluate(":party:", Instant::now());
        assert!(matches!(d, DispatchDecision::SkipCached));
    }

    #[test]
    fn enabled_defaults_to_true() {
        let s = InlineEmojiFallbackState::default();
        assert!(s.enabled.load(std::sync::atomic::Ordering::Relaxed));
    }
}
