//! Windows media control through the System Media Transport Controls (SMTC)
//! with a synthesized hardware media key as the fallback.
//!
//! SMTC sessions are what the Windows volume flyout lists, so this sees every
//! player that integrates with it (Spotify, browsers, Groove, VLC, …).

use crate::error::PlatformError;
use crate::media::{pick_best, MediaSessionInfo, MediaTransportAction, PlaybackStatus};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as WinStatus,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
};

/// One 100 ns tick (`TimeSpan.Duration`) is 1e-7 s.
const TICKS_PER_SECOND: f64 = 10_000_000.0;

fn os_err(context: &str, e: impl std::fmt::Display) -> PlatformError {
    PlatformError::OsError(format!("SMTC {context}: {e}"))
}

fn ticks_to_seconds(ticks: i64) -> f64 {
    ticks as f64 / TICKS_PER_SECOND
}

/// True if `query` names the session's app user model id: exact or substring,
/// case-insensitive (`"spotify"` matches `"Spotify.exe"`).
fn matches_aumid(aumid: &str, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    !query.is_empty() && aumid.to_lowercase().contains(&query)
}

/// A readable name from an AUMID: `Spotify.exe` → `Spotify`,
/// `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify` → `Spotify`.
fn display_name_from_aumid(aumid: &str) -> String {
    let tail = aumid.rsplit('!').next().unwrap_or(aumid);
    let tail = tail.strip_suffix(".exe").unwrap_or(tail);
    let name = tail.rsplit('.').next().unwrap_or(tail);
    if name.is_empty() {
        aumid.to_string()
    } else {
        name.to_string()
    }
}

fn non_empty(s: String) -> Option<String> {
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn status_from_win(s: WinStatus) -> PlaybackStatus {
    if s == WinStatus::Playing {
        PlaybackStatus::Playing
    } else if s == WinStatus::Paused {
        PlaybackStatus::Paused
    } else {
        PlaybackStatus::Stopped
    }
}

/// Runs `f` on a fresh thread. WinRT's blocking `.join()` must not run on an
/// STA thread (the UI thread), and a new thread gets an implicit MTA.
fn on_worker_thread<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, PlatformError> + Send + 'static,
) -> Result<T, PlatformError> {
    std::thread::spawn(f)
        .join()
        .map_err(|_| PlatformError::OsError("media worker thread panicked".into()))?
}

fn manager() -> Result<Manager, PlatformError> {
    Manager::RequestAsync()
        .and_then(|op| op.join())
        .map_err(|e| os_err("session manager", e))
}

fn read_session(session: &Session) -> Result<MediaSessionInfo, PlatformError> {
    let aumid = session
        .SourceAppUserModelId()
        .map_err(|e| os_err("SourceAppUserModelId", e))?
        .to_string();
    let status = session
        .GetPlaybackInfo()
        .and_then(|i| i.PlaybackStatus())
        .map(status_from_win)
        .unwrap_or(PlaybackStatus::Stopped);
    // Metadata and timeline are best-effort: apps routinely omit them.
    let props = session
        .TryGetMediaPropertiesAsync()
        .and_then(|op| op.join())
        .ok();
    let text = |f: fn(
        &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> windows::core::Result<windows::core::HSTRING>| {
        props
            .as_ref()
            .and_then(|p| f(p).ok())
            .and_then(|h| non_empty(h.to_string()))
    };
    let timeline = session.GetTimelineProperties().ok();
    let duration_seconds = timeline
        .as_ref()
        .and_then(|t| t.EndTime().ok())
        .map(|t| t.Duration)
        .filter(|ticks| *ticks > 0)
        .map(ticks_to_seconds);
    let position_seconds = timeline
        .as_ref()
        .and_then(|t| t.Position().ok())
        .map(|t| t.Duration)
        .filter(|ticks| *ticks >= 0)
        .map(ticks_to_seconds);
    Ok(MediaSessionInfo {
        player_name: display_name_from_aumid(&aumid),
        player_id: aumid,
        status,
        title: text(|p| p.Title()),
        artist: text(|p| p.Artist()),
        album: text(|p| p.AlbumTitle()),
        duration_seconds,
        position_seconds,
    })
}

fn all_sessions(manager: &Manager) -> Result<Vec<(Session, MediaSessionInfo)>, PlatformError> {
    let sessions = manager
        .GetSessions()
        .map_err(|e| os_err("GetSessions", e))?;
    let mut out = Vec::new();
    for session in sessions {
        match read_session(&session) {
            Ok(info) => out.push((session, info)),
            Err(e) => log::warn!("[media] {e}"),
        }
    }
    Ok(out)
}

fn find_session(
    manager: &Manager,
    query: &str,
) -> Result<Option<(Session, MediaSessionInfo)>, PlatformError> {
    Ok(all_sessions(manager)?
        .into_iter()
        .find(|(_, info)| matches_aumid(&info.player_id, query)))
}

pub fn list_sessions() -> Result<Vec<MediaSessionInfo>, PlatformError> {
    on_worker_thread(|| {
        let mut infos: Vec<_> = all_sessions(&manager()?)?
            .into_iter()
            .map(|(_, info)| info)
            .collect();
        infos.retain(|i| i.status != PlaybackStatus::Stopped);
        Ok(infos)
    })
}

pub fn get_now_playing(player_id: Option<&str>) -> Result<Option<MediaSessionInfo>, PlatformError> {
    let player_id = player_id.map(str::to_string);
    on_worker_thread(move || {
        let manager = manager()?;
        match player_id {
            Some(id) => Ok(find_session(&manager, &id)?.map(|(_, info)| info)),
            None => {
                // Windows' own notion of "current" wins over our ranking.
                if let Ok(current) = manager.GetCurrentSession() {
                    if let Ok(info) = read_session(&current) {
                        if info.status != PlaybackStatus::Stopped {
                            return Ok(Some(info));
                        }
                    }
                }
                Ok(pick_best(
                    all_sessions(&manager)?
                        .into_iter()
                        .map(|(_, i)| i)
                        .collect(),
                ))
            }
        }
    })
}

/// Performs `action` on `session`; false if the app declined it.
fn transport_on(session: &Session, action: MediaTransportAction) -> Result<bool, PlatformError> {
    let op = match action {
        MediaTransportAction::PlayPause => session.TryTogglePlayPauseAsync(),
        MediaTransportAction::Play => session.TryPlayAsync(),
        MediaTransportAction::Pause => session.TryPauseAsync(),
        MediaTransportAction::Next => session.TrySkipNextAsync(),
        MediaTransportAction::Previous => session.TrySkipPreviousAsync(),
    };
    op.and_then(|op| op.join())
        .map_err(|e| os_err("transport", e))
}

fn media_key_for(action: MediaTransportAction) -> VIRTUAL_KEY {
    match action {
        MediaTransportAction::PlayPause
        | MediaTransportAction::Play
        | MediaTransportAction::Pause => VK_MEDIA_PLAY_PAUSE,
        MediaTransportAction::Next => VK_MEDIA_NEXT_TRACK,
        MediaTransportAction::Previous => VK_MEDIA_PREV_TRACK,
    }
}

fn key_input(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Synthesizes the hardware media key (down then up).
fn send_media_key(action: MediaTransportAction) -> Result<(), PlatformError> {
    let vk = media_key_for(action);
    let inputs = [
        key_input(vk, KEYBD_EVENT_FLAGS(0)),
        key_input(vk, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err(PlatformError::OsError(format!(
            "SendInput injected {sent} of {} media key events",
            inputs.len()
        )))
    }
}

pub fn send_transport(
    action: MediaTransportAction,
    player_id: Option<&str>,
) -> Result<(), PlatformError> {
    let player_id = player_id.map(str::to_string);
    on_worker_thread(move || {
        let manager = manager();
        match player_id {
            Some(id) => {
                let (session, info) = find_session(&manager?, &id)?.ok_or_else(|| {
                    PlatformError::OsError(format!("no media session matches '{id}'"))
                })?;
                if transport_on(&session, action)? {
                    Ok(())
                } else {
                    Err(PlatformError::OsError(format!(
                        "{} did not accept the command",
                        info.player_name
                    )))
                }
            }
            None => {
                // No SMTC session, or the app declined: use the hardware key.
                let handled = manager
                    .ok()
                    .and_then(|m| m.GetCurrentSession().ok())
                    .map(|s| transport_on(&s, action).unwrap_or(false))
                    .unwrap_or(false);
                if handled {
                    Ok(())
                } else {
                    send_media_key(action)
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aumid_matching_is_a_case_insensitive_substring() {
        assert!(matches_aumid("Spotify.exe", "spotify"));
        assert!(matches_aumid(
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify",
            "SPOTIFY"
        ));
        assert!(matches_aumid("Spotify.exe", "Spotify.exe"));
        assert!(!matches_aumid("Spotify.exe", "vlc"));
        assert!(!matches_aumid("Spotify.exe", "  "));
    }

    #[test]
    fn display_names_are_derived_from_aumids() {
        assert_eq!(display_name_from_aumid("Spotify.exe"), "Spotify");
        assert_eq!(
            display_name_from_aumid("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"),
            "Spotify"
        );
        assert_eq!(display_name_from_aumid("chrome.exe"), "chrome");
        assert_eq!(display_name_from_aumid("Plain"), "Plain");
    }

    #[test]
    fn ticks_convert_to_seconds() {
        assert_eq!(ticks_to_seconds(10_000_000), 1.0);
        assert_eq!(ticks_to_seconds(2_155_000_000), 215.5);
    }

    #[test]
    fn statuses_and_keys_map() {
        assert_eq!(status_from_win(WinStatus::Playing), PlaybackStatus::Playing);
        assert_eq!(status_from_win(WinStatus::Paused), PlaybackStatus::Paused);
        assert_eq!(status_from_win(WinStatus::Stopped), PlaybackStatus::Stopped);
        assert_eq!(status_from_win(WinStatus::Closed), PlaybackStatus::Stopped);
        assert_eq!(
            media_key_for(MediaTransportAction::Pause),
            VK_MEDIA_PLAY_PAUSE
        );
        assert_eq!(
            media_key_for(MediaTransportAction::Next),
            VK_MEDIA_NEXT_TRACK
        );
        assert_eq!(
            media_key_for(MediaTransportAction::Previous),
            VK_MEDIA_PREV_TRACK
        );
    }
}
