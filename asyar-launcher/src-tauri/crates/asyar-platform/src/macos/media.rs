//! macOS media control without `MediaRemote.framework` (blocked for
//! third-party apps since macOS 15.4).
//!
//! - **Untargeted transport** posts the same system-defined media-key events
//!   the keyboard's F7–F9 keys produce, so whichever app owns the media keys
//!   reacts.
//! - **Targeted control / now-playing** scripts Music and Spotify in-process
//!   via `NSAppleScript`. A player is only scripted while it is already
//!   running — `tell application` would otherwise launch it.

use crate::error::PlatformError;
use crate::media::{pick_best, MediaSessionInfo, MediaTransportAction, PlaybackStatus};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, msg_send_id, ClassType, Encoding, RefEncode};
use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType};
use objc2_foundation::{NSAppleScript, NSPoint, NSString};

const NX_KEYTYPE_PLAY: isize = 16;
const NX_KEYTYPE_FAST: isize = 19;
const NX_KEYTYPE_REWIND: isize = 20;
/// `NX_SUBTYPE_AUX_CONTROL_BUTTONS`.
const MEDIA_KEY_SUBTYPE: i16 = 8;
const KEY_DOWN_FLAGS: usize = 0x0a00;
const KEY_UP_FLAGS: usize = 0x0b00;
/// `kCGHIDEventTap`.
const HID_EVENT_TAP: u32 = 0;
/// ASCII unit separator — cannot plausibly appear in track metadata.
const FIELD_SEP: char = '\u{1f}';

/// How a player's AppleScript dictionary is spoken to.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Dialect {
    /// `player state`, `current track`, `playpause`, `next track` (Music, TV, Spotify).
    Music,
    /// `playing`, `current item`, a toggling `play`, `next` (VLC).
    Vlc,
}

struct Player {
    bundle_id: &'static str,
    dialect: Dialect,
    name: &'static str,
    alias: &'static str,
    /// Multiplier turning the player's `duration` into seconds
    /// (Music reports seconds, Spotify milliseconds).
    duration_to_seconds: f64,
}

const PLAYERS: [Player; 4] = [
    Player {
        bundle_id: "com.apple.Music",
        dialect: Dialect::Music,
        name: "Music",
        alias: "music",
        duration_to_seconds: 1.0,
    },
    Player {
        bundle_id: "com.spotify.client",
        dialect: Dialect::Music,
        name: "Spotify",
        alias: "spotify",
        duration_to_seconds: 0.001,
    },
    Player {
        bundle_id: "com.apple.TV",
        dialect: Dialect::Music,
        name: "TV",
        alias: "tv",
        duration_to_seconds: 1.0,
    },
    Player {
        bundle_id: "org.videolan.vlc",
        dialect: Dialect::Vlc,
        name: "VLC",
        alias: "vlc",
        duration_to_seconds: 1.0,
    },
];

/// Resolves a friendly alias (`"music"`, `"spotify"`, `"tv"`, `"vlc"`) or a bundle id.
fn resolve_player(player_id: &str) -> Option<&'static Player> {
    PLAYERS
        .iter()
        .find(|p| p.bundle_id == player_id || p.alias.eq_ignore_ascii_case(player_id))
}

fn media_key_for(action: MediaTransportAction) -> isize {
    match action {
        MediaTransportAction::PlayPause
        | MediaTransportAction::Play
        | MediaTransportAction::Pause => NX_KEYTYPE_PLAY,
        MediaTransportAction::Next => NX_KEYTYPE_FAST,
        MediaTransportAction::Previous => NX_KEYTYPE_REWIND,
    }
}

fn script_verb(action: MediaTransportAction) -> &'static str {
    match action {
        MediaTransportAction::PlayPause => "playpause",
        MediaTransportAction::Play => "play",
        MediaTransportAction::Pause => "pause",
        MediaTransportAction::Next => "next track",
        MediaTransportAction::Previous => "previous track",
    }
}

/// Opaque `CGEventRef` target. objc2 verifies selector return encodings at
/// runtime, so the pointee must encode as `^{__CGEvent=}` (a bare `*mut c_void`
/// is `^v` and panics, which aborts the process across the FFI boundary).
#[repr(C)]
struct CGEventOpaque {
    _private: [u8; 0],
}

unsafe impl RefEncode for CGEventOpaque {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("__CGEvent", &[]));
}

/// Builds one system-defined media-key event (`down` or up).
fn media_key_event(key: isize, down: bool) -> Result<Retained<NSEvent>, PlatformError> {
    let (flags, state) = if down {
        (KEY_DOWN_FLAGS, 0x0a)
    } else {
        (KEY_UP_FLAGS, 0x0b)
    };
    unsafe {
        NSEvent::otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2(
            NSEventType::SystemDefined,
            NSPoint::new(0.0, 0.0),
            NSEventModifierFlags(flags),
            0.0,
            0,
            None,
            MEDIA_KEY_SUBTYPE,
            (key << 16) | (state << 8),
            -1,
        )
    }
    .ok_or_else(|| PlatformError::OsError("failed to create media key event".into()))
}

/// The event's underlying `CGEventRef`, owned by `event` (do not release).
fn cg_event_of(event: &NSEvent) -> Result<*mut CGEventOpaque, PlatformError> {
    let cg_event: *mut CGEventOpaque = unsafe { msg_send![event, CGEvent] };
    if cg_event.is_null() {
        return Err(PlatformError::OsError(
            "media key event has no CGEvent".into(),
        ));
    }
    Ok(cg_event)
}

/// The script that performs `action` on `player`. VLC's `play` toggles and it
/// has no `pause`, so explicit play/pause check `playing` first.
fn transport_script(player: &Player, action: MediaTransportAction) -> String {
    match (player.dialect, action) {
        (Dialect::Music, _) => format!(
            "tell application id \"{}\" to {}",
            player.bundle_id,
            script_verb(action)
        ),
        (Dialect::Vlc, _) => {
            let body = match action {
                MediaTransportAction::PlayPause => "play",
                MediaTransportAction::Play => "if not playing then play",
                MediaTransportAction::Pause => "if playing then play",
                MediaTransportAction::Next => "next",
                MediaTransportAction::Previous => "previous",
            };
            format!(
                "tell application id \"{}\"\n{body}\nend tell",
                player.bundle_id
            )
        }
    }
}

fn post_media_key(key: isize) -> Result<(), PlatformError> {
    extern "C" {
        fn CGEventPost(tap: u32, event: *mut CGEventOpaque);
    }
    for down in [true, false] {
        let event = media_key_event(key, down)?;
        let cg_event = cg_event_of(&event)?;
        unsafe { CGEventPost(HID_EVENT_TAP, cg_event) };
    }
    Ok(())
}

/// Longest a single script may wait on a player's Apple Event reply. The
/// default is ~2 minutes, and these run on the main thread, so a hung player
/// would otherwise freeze the launcher.
const SCRIPT_TIMEOUT_SECS: u32 = 2;

/// Runs AppleScript source in-process, returning the result as a string.
fn run_script(source: &str) -> Result<String, PlatformError> {
    unsafe {
        let source = NSString::from_str(&with_timeout(source));
        let script = NSAppleScript::alloc();
        let script = NSAppleScript::initWithSource(script, &source)
            .ok_or_else(|| PlatformError::OsError("failed to create AppleScript".into()))?;
        let mut error: *mut AnyObject = std::ptr::null_mut();
        // The generated binding returns a non-null `Retained`, but AppleScript
        // returns nil on failure, so the call is made by hand.
        let result: Option<Retained<AnyObject>> =
            msg_send_id![&script, executeAndReturnError: &mut error];
        let Some(result) = result else {
            let message: Option<Retained<NSString>> = if error.is_null() {
                None
            } else {
                msg_send_id![error, objectForKey: &*NSString::from_str("NSAppleScriptErrorMessage")]
            };
            return Err(PlatformError::OsError(format!(
                "AppleScript failed: {}",
                message.map_or_else(|| "unknown error".to_string(), |m| m.to_string())
            )));
        };
        let value: Option<Retained<NSString>> = msg_send_id![&result, stringValue];
        Ok(value.map(|s| s.to_string()).unwrap_or_default())
    }
}

fn with_timeout(source: &str) -> String {
    format!("with timeout of {SCRIPT_TIMEOUT_SECS} seconds\n{source}\nend timeout")
}

fn state_script(player: &Player) -> String {
    match player.dialect {
        Dialect::Music => music_state_script(player),
        Dialect::Vlc => vlc_state_script(player),
    }
}

/// VLC has no `player state`, artist or album: not playing with an item loaded
/// is treated as paused, and no item as stopped. Output matches the Music
/// dialect so `parse_session` handles both.
fn vlc_state_script(player: &Player) -> String {
    let sep = FIELD_SEP as u32;
    format!(
        r#"set sep to (ASCII character {sep})
tell application id "{id}"
    set isPlaying to playing
    set n to ""
    try
        set n to (name of current item) as text
    end try
    if n is "" and not isPlaying then return "stopped"
    set d to ""
    try
        set d to (duration of current item) as text
    end try
    set p to ""
    try
        set p to (current time) as text
    end try
    set s to "paused"
    if isPlaying then set s to "playing"
    return s & sep & n & sep & "" & sep & "" & sep & d & sep & p
end tell"#,
        id = player.bundle_id
    )
}

fn music_state_script(player: &Player) -> String {
    let sep = FIELD_SEP as u32;
    format!(
        r#"set sep to (ASCII character {sep})
tell application id "{id}"
    set s to (player state as text)
    if s is "stopped" then return s
    set t to current track
    set n to ""
    set a to ""
    set b to ""
    set d to ""
    try
        set n to (name of t) as text
    end try
    try
        set a to (artist of t) as text
    end try
    try
        set b to (album of t) as text
    end try
    try
        set d to (duration of t) as text
    end try
    set p to ""
    try
        set p to (player position) as text
    end try
    return s & sep & n & sep & a & sep & b & sep & d & sep & p
end tell"#,
        id = player.bundle_id
    )
}

fn parse_number(raw: &str) -> Option<f64> {
    // `number as text` honors the user's locale ("12,5").
    raw.trim().replace(',', ".").parse::<f64>().ok()
}

fn non_empty(raw: &str) -> Option<String> {
    (!raw.is_empty()).then(|| raw.to_string())
}

/// Parses the state script's output for `player` into a session.
fn parse_session(player: &Player, raw: &str) -> Option<MediaSessionInfo> {
    let mut fields = raw.trim_end_matches(['\r', '\n']).split(FIELD_SEP);
    let status = match fields.next()?.trim() {
        "playing" => PlaybackStatus::Playing,
        "paused" => PlaybackStatus::Paused,
        "stopped" => PlaybackStatus::Stopped,
        _ => return None,
    };
    let mut next = || fields.next().unwrap_or("");
    let (title, artist, album) = (next(), next(), next());
    let (duration, position) = (next(), next());
    Some(MediaSessionInfo {
        player_id: player.bundle_id.to_string(),
        player_name: player.name.to_string(),
        status,
        title: non_empty(title),
        artist: non_empty(artist),
        album: non_empty(album),
        duration_seconds: parse_number(duration).map(|d| d * player.duration_to_seconds),
        position_seconds: parse_number(position),
    })
}

fn query_player(player: &Player) -> Result<Option<MediaSessionInfo>, PlatformError> {
    // Never launch a closed player.
    if !super::system::is_app_running(player.bundle_id) {
        return Ok(None);
    }
    let raw = run_script(&state_script(player))?;
    Ok(parse_session(player, &raw))
}

pub fn list_sessions() -> Result<Vec<MediaSessionInfo>, PlatformError> {
    let mut sessions = Vec::new();
    for player in &PLAYERS {
        match query_player(player) {
            Ok(Some(s)) if s.status != PlaybackStatus::Stopped => sessions.push(s),
            Ok(_) => {}
            // One player failing (e.g. Automation denied) must not hide the other.
            Err(e) => log::warn!("[media] {} query failed: {e}", player.name),
        }
    }
    Ok(sessions)
}

pub fn get_now_playing(player_id: Option<&str>) -> Result<Option<MediaSessionInfo>, PlatformError> {
    match player_id {
        Some(id) => {
            let player = resolve_player(id).ok_or_else(|| {
                PlatformError::Unsupported(format!("unknown media player '{id}'"))
            })?;
            query_player(player)
        }
        None => Ok(pick_best(list_sessions()?)),
    }
}

pub fn send_transport(
    action: MediaTransportAction,
    player_id: Option<&str>,
) -> Result<(), PlatformError> {
    let Some(id) = player_id else {
        return post_media_key(media_key_for(action));
    };
    let player = resolve_player(id)
        .ok_or_else(|| PlatformError::Unsupported(format!("unknown media player '{id}'")))?;
    if !super::system::is_app_running(player.bundle_id) {
        return Err(PlatformError::OsError(format!(
            "{} is not running",
            player.name
        )));
    }
    run_script(&transport_script(player, action)).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_aliases_and_bundle_ids() {
        assert_eq!(
            resolve_player("music").unwrap().bundle_id,
            "com.apple.Music"
        );
        assert_eq!(
            resolve_player("Spotify").unwrap().bundle_id,
            "com.spotify.client"
        );
        assert_eq!(resolve_player("com.apple.Music").unwrap().name, "Music");
        assert!(resolve_player("com.example.Unknown").is_none());
        assert!(resolve_player("").is_none());
    }

    #[test]
    fn scripts_are_wrapped_in_a_timeout() {
        let wrapped = with_timeout("return 1");
        assert!(wrapped.starts_with("with timeout of 2 seconds\n"));
        assert!(wrapped.ends_with("\nend timeout"));
    }

    #[test]
    fn resolves_tv_and_vlc() {
        assert_eq!(resolve_player("tv").unwrap().bundle_id, "com.apple.TV");
        assert_eq!(resolve_player("VLC").unwrap().name, "VLC");
        assert_eq!(resolve_player("org.videolan.vlc").unwrap().alias, "vlc");
    }

    #[test]
    fn transport_scripts_follow_each_dialect() {
        let tv = resolve_player("tv").unwrap();
        assert_eq!(
            transport_script(tv, MediaTransportAction::Next),
            "tell application id \"com.apple.TV\" to next track"
        );
        let vlc = resolve_player("vlc").unwrap();
        assert!(transport_script(vlc, MediaTransportAction::Pause).contains("if playing then play"));
        assert!(transport_script(vlc, MediaTransportAction::Next).contains("\nnext\n"));
        assert!(vlc_state_script(vlc).contains("org.videolan.vlc"));
    }

    #[test]
    fn maps_actions_to_media_keys_and_verbs() {
        assert_eq!(media_key_for(MediaTransportAction::PlayPause), 16);
        assert_eq!(media_key_for(MediaTransportAction::Next), 19);
        assert_eq!(media_key_for(MediaTransportAction::Previous), 20);
        assert_eq!(script_verb(MediaTransportAction::Next), "next track");
        assert_eq!(script_verb(MediaTransportAction::PlayPause), "playpause");
    }

    fn sep(fields: &[&str]) -> String {
        fields.join(&FIELD_SEP.to_string())
    }

    #[test]
    fn parses_music_session_in_seconds() {
        let p = resolve_player("music").unwrap();
        let raw = sep(&["playing", "Song", "Artist", "Album", "215.5", "12,25"]);
        let s = parse_session(p, &raw).unwrap();
        assert_eq!(s.player_id, "com.apple.Music");
        assert_eq!(s.status, PlaybackStatus::Playing);
        assert_eq!(s.title.as_deref(), Some("Song"));
        assert_eq!(s.duration_seconds, Some(215.5));
        assert_eq!(s.position_seconds, Some(12.25));
    }

    #[test]
    fn spotify_duration_is_converted_from_milliseconds() {
        let p = resolve_player("spotify").unwrap();
        let raw = sep(&["paused", "S", "", "", "180000", "3.5"]);
        let s = parse_session(p, &raw).unwrap();
        assert_eq!(s.status, PlaybackStatus::Paused);
        assert_eq!(s.artist, None);
        assert_eq!(s.duration_seconds, Some(180.0));
    }

    #[test]
    fn parses_stopped_and_rejects_garbage() {
        let p = resolve_player("music").unwrap();
        let s = parse_session(p, "stopped\n").unwrap();
        assert_eq!(s.status, PlaybackStatus::Stopped);
        assert_eq!(s.title, None);
        assert!(parse_session(p, "").is_none());
        assert!(parse_session(p, "buffering").is_none());
    }

    #[test]
    fn media_key_events_expose_a_cg_event_without_posting() {
        // Regression: a wrongly-encoded `CGEvent` return type panicked at
        // runtime and aborted the app on the first transport click.
        for down in [true, false] {
            let event = media_key_event(NX_KEYTYPE_PLAY, down).unwrap();
            assert!(!cg_event_of(&event).unwrap().is_null());
        }
    }

    #[test]
    fn unknown_player_is_rejected_before_any_os_call() {
        assert!(matches!(
            send_transport(MediaTransportAction::Next, Some("com.example.Nope")),
            Err(PlatformError::Unsupported(_))
        ));
        assert!(matches!(
            get_now_playing(Some("nope")),
            Err(PlatformError::Unsupported(_))
        ));
    }
}
