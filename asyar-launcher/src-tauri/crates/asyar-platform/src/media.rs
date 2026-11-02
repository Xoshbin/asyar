//! Cross-platform media-session abstraction.
//!
//! macOS: media-key transport plus Music/Spotify scripting (see
//! `macos::media`). `MediaRemote.framework` is deliberately unused — Apple
//! blocked it for third-party apps in macOS 15.4+. Windows/Linux are stubs.

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

/// Now-playing info for `player_id` (alias or bundle id), or the best running
/// player (playing preferred over paused) when `None`.
pub fn get_now_playing(player_id: Option<&str>) -> Result<Option<MediaSessionInfo>, PlatformError> {
    #[cfg(target_os = "macos")]
    {
        crate::macos::media::get_now_playing(player_id)
    }
    #[cfg(not(target_os = "macos"))]
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
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

/// Sends a transport action. With `player_id == None` it goes to whichever app
/// currently owns the system media keys.
pub fn send_transport(
    action: MediaTransportAction,
    player_id: Option<&str>,
) -> Result<(), PlatformError> {
    #[cfg(target_os = "macos")]
    {
        crate::macos::media::send_transport(action, player_id)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (action, player_id);
        Ok(())
    }
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
}
