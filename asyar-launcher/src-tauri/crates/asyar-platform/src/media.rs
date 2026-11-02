//! Cross-platform media-session abstraction.
//!
//! - macOS: media-key transport plus scripting of Music, TV, Spotify and VLC
//!   (`macos::media`). `MediaRemote.framework` is deliberately unused — Apple
//!   blocked it for third-party apps in macOS 15.4+.
//! - Linux: MPRIS over the session D-Bus (`linux::media`).
//! - Windows: System Media Transport Controls plus `SendInput` media keys
//!   (`windows::media`).

use crate::error::PlatformError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaTransportAction {
    PlayPause,
    Play,
    Pause,
    Next,
    Previous,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionInfo {
    /// Bundle identifier, e.g. `com.apple.Music`.
    pub player_id: String,
    /// Display name, e.g. `Music`.
    pub player_name: String,
    pub status: PlaybackStatus,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_seconds: Option<f64>,
    pub position_seconds: Option<f64>,
}

/// Now-playing info for `player_id`, or the best running player (playing
/// preferred over paused) when `None`. What `player_id` accepts is
/// platform-specific: a bundle id or alias (macOS), a bus name or its suffix
/// (Linux MPRIS), an app user model id or a substring of it (Windows).
pub fn get_now_playing(player_id: Option<&str>) -> Result<Option<MediaSessionInfo>, PlatformError> {
    #[cfg(target_os = "macos")]
    {
        crate::macos::media::get_now_playing(player_id)
    }
    #[cfg(target_os = "linux")]
    {
        crate::linux::media::get_now_playing(player_id)
    }
    #[cfg(target_os = "windows")]
    {
        crate::windows::media::get_now_playing(player_id)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = player_id;
        Ok(None)
    }
}

/// All running, supported players that currently have a track loaded.
pub fn list_sessions() -> Result<Vec<MediaSessionInfo>, PlatformError> {
    #[cfg(target_os = "macos")]
    {
        crate::macos::media::list_sessions()
    }
    #[cfg(target_os = "linux")]
    {
        crate::linux::media::list_sessions()
    }
    #[cfg(target_os = "windows")]
    {
        crate::windows::media::list_sessions()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Ok(Vec::new())
    }
}

/// Sends a transport action. With `player_id == None` it goes to the active
/// player (Linux, Windows) or whichever app owns the system media keys.
pub fn send_transport(
    action: MediaTransportAction,
    player_id: Option<&str>,
) -> Result<(), PlatformError> {
    #[cfg(target_os = "macos")]
    {
        crate::macos::media::send_transport(action, player_id)
    }
    #[cfg(target_os = "linux")]
    {
        crate::linux::media::send_transport(action, player_id)
    }
    #[cfg(target_os = "windows")]
    {
        crate::windows::media::send_transport(action, player_id)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (action, player_id);
        Ok(())
    }
}

/// Prefers a playing session over a paused one; stopped sessions never win.
/// Ties keep the earliest session.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "linux", target_os = "windows")),
    allow(dead_code)
)]
pub(crate) fn pick_best(sessions: Vec<MediaSessionInfo>) -> Option<MediaSessionInfo> {
    let mut best: Option<MediaSessionInfo> = None;
    for s in sessions {
        match (&best, s.status) {
            (_, PlaybackStatus::Stopped) => {}
            (None, _) => best = Some(s),
            (Some(b), PlaybackStatus::Playing) if b.status != PlaybackStatus::Playing => {
                best = Some(s)
            }
            _ => {}
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_format_is_camel_case_with_lowercase_status() {
        let info = MediaSessionInfo {
            player_id: "com.apple.Music".into(),
            player_name: "Music".into(),
            status: PlaybackStatus::Playing,
            title: Some("T".into()),
            artist: None,
            album: None,
            duration_seconds: Some(1.5),
            position_seconds: None,
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["playerId"], "com.apple.Music");
        assert_eq!(v["status"], "playing");
        assert_eq!(v["durationSeconds"], 1.5);
        assert_eq!(
            serde_json::to_value(MediaTransportAction::PlayPause).unwrap(),
            "playPause"
        );
    }

    fn session(id: &str, status: PlaybackStatus) -> MediaSessionInfo {
        MediaSessionInfo {
            player_id: id.into(),
            player_name: id.into(),
            status,
            title: None,
            artist: None,
            album: None,
            duration_seconds: None,
            position_seconds: None,
        }
    }

    #[test]
    fn pick_best_prefers_playing_over_paused() {
        let best = pick_best(vec![
            session("a", PlaybackStatus::Paused),
            session("b", PlaybackStatus::Playing),
            session("c", PlaybackStatus::Stopped),
        ])
        .unwrap();
        assert_eq!(best.player_id, "b");
        assert!(pick_best(vec![session("c", PlaybackStatus::Stopped)]).is_none());
        assert!(pick_best(vec![]).is_none());
    }
}
