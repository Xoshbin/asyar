//! Linux media control over MPRIS (`org.mpris.MediaPlayer2.*` on the session
//! bus).
//!
//! The wire handling lives behind `cfg(target_os = "linux")`; everything that
//! decides *what* to do with the answers (bus-name filtering, player matching,
//! metadata conversion) is plain Rust so it is tested on every host.

// Off Linux only the tests exercise the pure helpers.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use crate::media::{MediaSessionInfo, PlaybackStatus};

const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";

/// Bus names that are MPRIS players, in the order given.
fn filter_mpris_names<S: AsRef<str>>(names: &[S]) -> Vec<String> {
    names
        .iter()
        .map(AsRef::as_ref)
        .filter(|n| n.len() > MPRIS_PREFIX.len() && n.starts_with(MPRIS_PREFIX))
        .map(str::to_string)
        .collect()
}

/// True if `query` names `bus_name`: the full bus name, or its suffix
/// (`spotify`), both case-insensitive. Players that run several instances use
/// `vlc.instance1234`, which the bare `vlc` also matches.
fn matches_player(bus_name: &str, query: &str) -> bool {
    let query = query.trim();
    if query.is_empty() {
        return false;
    }
    if bus_name.eq_ignore_ascii_case(query) {
        return true;
    }
    let Some(suffix) = bus_name.strip_prefix(MPRIS_PREFIX) else {
        return false;
    };
    suffix.eq_ignore_ascii_case(query)
        || suffix
            .split('.')
            .next()
            .is_some_and(|base| base.eq_ignore_ascii_case(query))
}

/// Player properties as read off the bus, before conversion.
#[derive(Debug, Default, Clone, PartialEq)]
struct RawMpris {
    identity: Option<String>,
    playback_status: Option<String>,
    title: Option<String>,
    artists: Vec<String>,
    album: Option<String>,
    length_us: Option<i64>,
    position_us: Option<i64>,
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn micros_to_seconds(us: i64) -> f64 {
    us as f64 / 1_000_000.0
}

fn status_from_mpris(s: &str) -> PlaybackStatus {
    match s {
        "Playing" => PlaybackStatus::Playing,
        "Paused" => PlaybackStatus::Paused,
        _ => PlaybackStatus::Stopped,
    }
}

/// Short display name for a bus name when the player has no `Identity`.
fn fallback_name(bus_name: &str) -> String {
    bus_name
        .strip_prefix(MPRIS_PREFIX)
        .unwrap_or(bus_name)
        .split('.')
        .next()
        .unwrap_or(bus_name)
        .to_string()
}

fn session_from_raw(bus_name: &str, raw: RawMpris) -> MediaSessionInfo {
    let artists: Vec<String> = raw
        .artists
        .into_iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
        .collect();
    MediaSessionInfo {
        player_id: bus_name.to_string(),
        player_name: non_empty(raw.identity).unwrap_or_else(|| fallback_name(bus_name)),
        status: raw
            .playback_status
            .as_deref()
            .map_or(PlaybackStatus::Stopped, status_from_mpris),
        title: non_empty(raw.title),
        artist: (!artists.is_empty()).then(|| artists.join(", ")),
        album: non_empty(raw.album),
        // `mpris:length` is optional and some players report 0 for "unknown".
        duration_seconds: raw.length_us.filter(|us| *us > 0).map(micros_to_seconds),
        position_seconds: raw.position_us.filter(|us| *us >= 0).map(micros_to_seconds),
    }
}

#[cfg(target_os = "linux")]
mod bus {
    use super::*;
    use crate::error::PlatformError;
    use crate::media::MediaTransportAction;
    use gio::glib::prelude::*;
    use gio::glib::Variant;
    use std::collections::HashMap;

    const TIMEOUT_MS: i32 = 1000;
    const OBJECT_PATH: &str = "/org/mpris/MediaPlayer2";
    const PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";
    const ROOT_IFACE: &str = "org.mpris.MediaPlayer2";

    fn err(context: &str, e: impl std::fmt::Display) -> PlatformError {
        PlatformError::OsError(format!("MPRIS {context}: {e}"))
    }

    fn connection() -> Result<gio::DBusConnection, PlatformError> {
        gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE)
            .map_err(|e| err("session bus unavailable", e))
    }

    fn call(
        conn: &gio::DBusConnection,
        dest: &str,
        path: &str,
        iface: &str,
        method: &str,
        params: Option<&Variant>,
    ) -> Result<Variant, gio::glib::Error> {
        conn.call_sync(
            Some(dest),
            path,
            iface,
            method,
            params,
            None,
            gio::DBusCallFlags::NONE,
            TIMEOUT_MS,
            gio::Cancellable::NONE,
        )
    }

    fn list_players(conn: &gio::DBusConnection) -> Result<Vec<String>, PlatformError> {
        let reply = call(
            conn,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "ListNames",
            None,
        )
        .map_err(|e| err("ListNames", e))?;
        let (names,): (Vec<String>,) = reply
            .get()
            .ok_or_else(|| err("ListNames", "unexpected reply type"))?;
        Ok(filter_mpris_names(&names))
    }

    fn get_all(
        conn: &gio::DBusConnection,
        bus_name: &str,
        iface: &str,
    ) -> Result<HashMap<String, Variant>, gio::glib::Error> {
        let reply = call(
            conn,
            bus_name,
            OBJECT_PATH,
            "org.freedesktop.DBus.Properties",
            "GetAll",
            Some(&(iface,).to_variant()),
        )?;
        Ok(reply
            .get::<(HashMap<String, Variant>,)>()
            .map(|(m,)| m)
            .unwrap_or_default())
    }

    fn as_i64(v: &Variant) -> Option<i64> {
        v.get::<i64>()
            .or_else(|| v.get::<u64>().and_then(|u| i64::try_from(u).ok()))
    }

    fn read_raw(conn: &gio::DBusConnection, bus_name: &str) -> Result<RawMpris, PlatformError> {
        let player = get_all(conn, bus_name, PLAYER_IFACE).map_err(|e| err(bus_name, e))?;
        // `Identity` is cosmetic; a player that hides it still works.
        let identity = get_all(conn, bus_name, ROOT_IFACE)
            .ok()
            .and_then(|root| root.get("Identity").and_then(|v| v.str().map(String::from)));
        let metadata = player
            .get("Metadata")
            .and_then(|v| v.get::<HashMap<String, Variant>>())
            .unwrap_or_default();
        let artists = metadata
            .get("xesam:artist")
            .map(|v| {
                v.get::<Vec<String>>()
                    .or_else(|| v.str().map(|s| vec![s.to_string()]))
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        Ok(RawMpris {
            identity,
            playback_status: player
                .get("PlaybackStatus")
                .and_then(|v| v.str().map(String::from)),
            title: metadata
                .get("xesam:title")
                .and_then(|v| v.str().map(String::from)),
            artists,
            album: metadata
                .get("xesam:album")
                .and_then(|v| v.str().map(String::from)),
            length_us: metadata.get("mpris:length").and_then(as_i64),
            position_us: player.get("Position").and_then(as_i64),
        })
    }

    fn sessions(conn: &gio::DBusConnection) -> Result<Vec<MediaSessionInfo>, PlatformError> {
        let mut out = Vec::new();
        for name in list_players(conn)? {
            match read_raw(conn, &name) {
                Ok(raw) => out.push(session_from_raw(&name, raw)),
                // A player that is mid-exit must not hide the others.
                Err(e) => log::warn!("[media] {e}"),
            }
        }
        Ok(out)
    }

    fn resolve(conn: &gio::DBusConnection, query: &str) -> Result<Option<String>, PlatformError> {
        Ok(list_players(conn)?
            .into_iter()
            .find(|name| matches_player(name, query)))
    }

    pub fn list_sessions() -> Result<Vec<MediaSessionInfo>, PlatformError> {
        let mut all = sessions(&connection()?)?;
        all.retain(|s| s.status != PlaybackStatus::Stopped);
        Ok(all)
    }

    pub fn get_now_playing(
        player_id: Option<&str>,
    ) -> Result<Option<MediaSessionInfo>, PlatformError> {
        let conn = connection()?;
        match player_id {
            Some(id) => match resolve(&conn, id)? {
                Some(name) => Ok(Some(session_from_raw(&name, read_raw(&conn, &name)?))),
                None => Ok(None),
            },
            None => Ok(crate::media::pick_best(sessions(&conn)?)),
        }
    }

    pub fn send_transport(
        action: MediaTransportAction,
        player_id: Option<&str>,
    ) -> Result<(), PlatformError> {
        let conn = connection()?;
        let target = match player_id {
            Some(id) => resolve(&conn, id)?
                .ok_or_else(|| PlatformError::OsError(format!("no MPRIS player matches '{id}'")))?,
            None => crate::media::pick_best(sessions(&conn)?)
                .map(|s| s.player_id)
                // Nothing playing: wake the first player rather than doing nothing.
                .or_else(|| list_players(&conn).ok().and_then(|p| p.into_iter().next()))
                .ok_or_else(|| PlatformError::OsError("no MPRIS player is running".into()))?,
        };
        call(
            &conn,
            &target,
            OBJECT_PATH,
            PLAYER_IFACE,
            method_name(action),
            None,
        )
        .map(|_| ())
        .map_err(|e| err(&target, e))
    }
}

#[cfg(target_os = "linux")]
fn method_name(action: crate::media::MediaTransportAction) -> &'static str {
    use crate::media::MediaTransportAction as A;
    match action {
        A::PlayPause => "PlayPause",
        A::Play => "Play",
        A::Pause => "Pause",
        A::Next => "Next",
        A::Previous => "Previous",
    }
}

#[cfg(target_os = "linux")]
pub use bus::{get_now_playing, list_sessions, send_transport};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_only_mpris_players() {
        let names = [
            "org.freedesktop.DBus",
            ":1.42",
            "org.mpris.MediaPlayer2.spotify",
            "org.mpris.MediaPlayer2.",
            "org.mpris.MediaPlayer2.vlc.instance77",
            "org.gnome.Shell",
        ];
        assert_eq!(
            filter_mpris_names(&names),
            vec![
                "org.mpris.MediaPlayer2.spotify".to_string(),
                "org.mpris.MediaPlayer2.vlc.instance77".to_string(),
            ]
        );
    }

    #[test]
    fn matches_full_name_or_suffix_case_insensitively() {
        let spotify = "org.mpris.MediaPlayer2.spotify";
        assert!(matches_player(spotify, "spotify"));
        assert!(matches_player(spotify, "Spotify"));
        assert!(matches_player(spotify, "ORG.MPRIS.MEDIAPLAYER2.SPOTIFY"));
        assert!(!matches_player(spotify, "spot"));
        assert!(!matches_player(spotify, ""));
        assert!(!matches_player(spotify, "vlc"));
    }

    #[test]
    fn instance_suffixed_players_match_their_base_name() {
        let vlc = "org.mpris.MediaPlayer2.vlc.instance1234";
        assert!(matches_player(vlc, "vlc"));
        assert!(matches_player(vlc, "vlc.instance1234"));
        assert!(!matches_player(vlc, "instance1234"));
    }

    #[test]
    fn converts_metadata_to_a_session() {
        let s = session_from_raw(
            "org.mpris.MediaPlayer2.spotify",
            RawMpris {
                identity: Some("Spotify".into()),
                playback_status: Some("Playing".into()),
                title: Some("Song".into()),
                artists: vec!["A".into(), "B".into()],
                album: Some("Album".into()),
                length_us: Some(215_500_000),
                position_us: Some(12_250_000),
            },
        );
        assert_eq!(s.player_id, "org.mpris.MediaPlayer2.spotify");
        assert_eq!(s.player_name, "Spotify");
        assert_eq!(s.status, PlaybackStatus::Playing);
        assert_eq!(s.artist.as_deref(), Some("A, B"));
        assert_eq!(s.duration_seconds, Some(215.5));
        assert_eq!(s.position_seconds, Some(12.25));
    }

    #[test]
    fn sparse_metadata_degrades_gracefully() {
        let s = session_from_raw(
            "org.mpris.MediaPlayer2.mpv",
            RawMpris {
                playback_status: Some("Paused".into()),
                title: Some("  ".into()),
                artists: vec!["".into()],
                length_us: Some(0),
                position_us: Some(-1),
                ..Default::default()
            },
        );
        assert_eq!(s.player_name, "mpv");
        assert_eq!(s.status, PlaybackStatus::Paused);
        assert_eq!((s.title, s.artist, s.album), (None, None, None));
        assert_eq!((s.duration_seconds, s.position_seconds), (None, None));
    }

    #[test]
    fn unknown_status_is_stopped() {
        assert_eq!(status_from_mpris("Stopped"), PlaybackStatus::Stopped);
        assert_eq!(status_from_mpris("Weird"), PlaybackStatus::Stopped);
        assert_eq!(status_from_mpris("Paused"), PlaybackStatus::Paused);
    }
}
