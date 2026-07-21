//! Sticky-note window lifecycle: one always-on-top webview per pinned note.
//!
//! A sticky is a *window onto an existing note* — content lives in the
//! encrypted `notes` table; this module only owns windows and geometry.

use crate::error::AppError;
use crate::storage::sticky_notes::{self, StickyNote};
use crate::storage::DataStore;
use tauri::{AppHandle, Manager};

const LABEL_PREFIX: &str = "sticky-";
const WINDOW_URL_BASE: &str = "/sticky";

const DEFAULT_WIDTH: f64 = 320.0;
const DEFAULT_HEIGHT: f64 = 260.0;
/// Where the first sticky lands, with each additional one cascaded down-right
/// so a fresh batch doesn't stack invisibly on one spot.
const CASCADE_ORIGIN: f64 = 120.0;
const CASCADE_STEP: f64 = 28.0;

#[cfg(target_os = "macos")]
const REVEAL_FALLBACK_MS: u64 = 400;

/// Deterministic window label so an already-open sticky can be found, focused,
/// and closed by note id alone.
pub fn window_label(note_id: &str) -> String {
    format!("{LABEL_PREFIX}{note_id}")
}

/// Inverse of [`window_label`] — `None` for any non-sticky window label.
pub fn note_id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix(LABEL_PREFIX)
}

/// Keep a restored rect on a visible monitor. A sticky saved on a display that
/// is no longer connected would otherwise be restored off-screen and be
/// unreachable. Falls back to the origin corner when the rect can't fit.
pub fn clamp_to_bounds(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    monitor: (f64, f64, f64, f64),
) -> (f64, f64) {
    let (mx, my, mw, mh) = monitor;
    // Keep the whole window inside when it fits; otherwise pin to the corner.
    let max_x = (mx + mw - width).max(mx);
    let max_y = (my + mh - height).max(my);
    (x.clamp(mx, max_x), y.clamp(my, max_y))
}

fn default_geometry(note_id: &str, existing_count: usize, now: f64) -> StickyNote {
    let offset = CASCADE_ORIGIN + (existing_count as f64) * CASCADE_STEP;
    StickyNote {
        note_id: note_id.to_string(),
        x: offset,
        y: offset,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        created_at: now,
    }
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Quiet period after the last move/resize before geometry is written. A drag
/// emits hundreds of events; without this every pixel would be a SQLite write.
const GEOMETRY_DEBOUNCE_MS: u64 = 400;

/// Per-note generation counter — a scheduled save only runs if it is still the
/// most recent one for that note.
fn debounce_generations() -> &'static std::sync::Mutex<std::collections::HashMap<String, u64>> {
    static STATE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, u64>>> =
        std::sync::OnceLock::new();
    STATE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Read the window's current geometry and persist it.
fn persist_geometry(app: &AppHandle, note_id: &str) {
    let Some(window) = app.get_webview_window(&window_label(note_id)) else {
        return;
    };
    let (Ok(scale), Ok(pos), Ok(size)) = (
        window.scale_factor(),
        window.outer_position(),
        window.inner_size(),
    ) else {
        return;
    };
    let pos = pos.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);

    let store = app.state::<DataStore>().inner().clone();
    let Ok(conn) = store.conn() else {
        return;
    };
    let _ = sticky_notes::save_geometry(&conn, note_id, pos.x, pos.y, size.width, size.height);
}

/// Window position captured at mousedown, per note, so each drag frame can be
/// applied as an absolute offset from where the drag started (rather than
/// accumulating per-frame deltas, which drifts).
fn drag_anchors() -> &'static std::sync::Mutex<std::collections::HashMap<String, (f64, f64)>> {
    static STATE: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, (f64, f64)>>,
    > = std::sync::OnceLock::new();
    STATE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Debounced geometry save — the last move/resize in a burst wins.
fn schedule_geometry_save(app: &AppHandle, note_id: &str) {
    let generation = {
        let Ok(mut map) = debounce_generations().lock() else {
            return;
        };
        let counter = map.entry(note_id.to_string()).or_insert(0);
        *counter += 1;
        *counter
    };

    let app = app.clone();
    let note_id = note_id.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(GEOMETRY_DEBOUNCE_MS)).await;
        let still_current = debounce_generations()
            .lock()
            .ok()
            .and_then(|m| m.get(&note_id).copied())
            == Some(generation);
        if still_current {
            persist_geometry(&app, &note_id);
        }
    });
}

/// Build the webview window for an already-persisted sticky row.
fn build_window(app: &AppHandle, sticky: &StickyNote) -> Result<(), AppError> {
    let label = window_label(&sticky.note_id);
    let url = format!("{WINDOW_URL_BASE}?id={}", sticky.note_id);

    // Clamp against the primary monitor so a rect saved on a now-disconnected
    // display still lands somewhere reachable.
    let (x, y) = match app.primary_monitor() {
        Ok(Some(m)) => {
            let scale = m.scale_factor();
            let pos = m.position().to_logical::<f64>(scale);
            let size = m.size().to_logical::<f64>(scale);
            clamp_to_bounds(
                sticky.x,
                sticky.y,
                sticky.width,
                sticky.height,
                (pos.x, pos.y, size.width, size.height),
            )
        }
        _ => (sticky.x, sticky.y),
    };

    let _window = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(url.into()))
        .title("Sticky Note")
        .inner_size(sticky.width, sticky.height)
        .position(x, y)
        .resizable(true)
        .always_on_top(true)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        // macOS: build hidden and reveal on the first painted frame, same
        // cold-open flash fix the onboarding window uses.
        .visible(cfg!(not(target_os = "macos")))
        .focused(cfg!(not(target_os = "macos")))
        .build()
        .map_err(|e| AppError::Other(format!("create sticky window: {e}")))?;

    #[cfg(target_os = "macos")]
    {
        // Float over fullscreen Spaces while still being able to take focus
        // for typing (unlike the HUD, which is deliberately non-activating).
        let _ = crate::platform::macos::setup_sticky_window(&_window);
        crate::platform::macos::reveal_window_after_first_paint(&_window, REVEAL_FALLBACK_MS);
    }

    // Remember where the user puts it. Debounced so a drag is one write.
    {
        let app_handle = app.clone();
        let note_id = sticky.note_id.clone();
        _window.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            ) {
                schedule_geometry_save(&app_handle, &note_id);
            }
        });
    }

    Ok(())
}

/// Pin a note to the desktop: persist it (if new) and open/focus its window.
pub fn open(app: &AppHandle, note_id: &str) -> Result<(), AppError> {
    if let Some(existing) = app.get_webview_window(&window_label(note_id)) {
        existing
            .show()
            .map_err(|e| AppError::Other(format!("show sticky: {e}")))?;
        existing
            .set_focus()
            .map_err(|e| AppError::Other(format!("focus sticky: {e}")))?;
        return Ok(());
    }

    // Scope the DB lock so it isn't held while the window is being created.
    let sticky = {
        let store = app.state::<DataStore>();
        let conn = store.conn()?;
        let rows = sticky_notes::list(&conn)?;
        match rows.iter().find(|s| s.note_id == note_id) {
            Some(found) => found.clone(),
            None => {
                let fresh = default_geometry(note_id, rows.len(), now_ms());
                sticky_notes::upsert(&conn, &fresh)?;
                fresh
            }
        }
    };

    build_window(app, &sticky)
}

/// Unpin: close the window and drop the row.
pub fn close(app: &AppHandle, note_id: &str) -> Result<(), AppError> {
    if let Some(w) = app.get_webview_window(&window_label(note_id)) {
        w.close()
            .map_err(|e| AppError::Other(format!("close sticky: {e}")))?;
    }
    let store = app.state::<DataStore>();
    let conn = store.conn()?;
    sticky_notes::remove(&conn, note_id)
}

/// Re-open every pinned note's window. Called once during `setup_app`.
/// Orphans (note deleted while the app was closed) are pruned first so a
/// deleted note can never resurrect a window.
pub fn restore_all(app: &AppHandle) -> Result<(), AppError> {
    let rows = {
        let store = app.state::<DataStore>();
        let conn = store.conn()?;
        let _ = sticky_notes::prune_orphans(&conn);
        sticky_notes::list(&conn)?
    };

    for sticky in rows {
        if let Err(e) = build_window(app, &sticky) {
            log::warn!("[sticky] restore failed for {}: {e}", sticky.note_id);
        }
    }
    Ok(())
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn sticky_open(note_id: String, app: AppHandle) -> Result<(), AppError> {
    open(&app, &note_id)
}

#[tauri::command]
pub fn sticky_close(note_id: String, app: AppHandle) -> Result<(), AppError> {
    close(&app, &note_id)
}

/// Create a brand-new empty note and immediately stick it to the desktop.
/// Backs both the "New Sticky Note" command and the `+` button on a sticky.
/// Still a real note (decision: a sticky is always a view onto one), so it
/// syncs, is searchable, and shows up in the Notes list like any other.
#[tauri::command]
pub fn sticky_new(
    app: AppHandle,
    store: tauri::State<'_, DataStore>,
    keystore: tauri::State<'_, crate::crypto::keystore::KeystoreState>,
    fts: tauri::State<'_, std::sync::Arc<crate::storage::notes_fts::NotesFts>>,
) -> Result<String, AppError> {
    let now = now_ms();
    let note = crate::storage::notes::Note {
        id: uuid::Uuid::new_v4().to_string(),
        title: String::new(),
        body: String::new(),
        created_at: now,
        updated_at: now,
        pinned: false,
    };

    {
        let conn = store.conn()?;
        crate::storage::notes::upsert_with_fts(&conn, &note, keystore.master_key(), fts.inner())?;
    }

    open(&app, &note.id)?;
    crate::storage::commands::emit_note_changed(&app, &note.id);
    Ok(note.id)
}

/// Begin a drag: remember where the window currently is.
///
/// Dragging is done manually rather than with `data-tauri-drag-region` because
/// these windows are converted to `NSPanel`s on macOS, and the native
/// `startDragging` path (`performWindowDragWithEvent:`) is not something we can
/// rely on there. Anchor + absolute offset is deterministic on every platform.
#[tauri::command]
pub fn sticky_drag_start(note_id: String, app: AppHandle) -> Result<(), AppError> {
    let Some(window) = app.get_webview_window(&window_label(&note_id)) else {
        return Ok(());
    };
    let (Ok(scale), Ok(pos)) = (window.scale_factor(), window.outer_position()) else {
        return Ok(());
    };
    let pos = pos.to_logical::<f64>(scale);
    if let Ok(mut anchors) = drag_anchors().lock() {
        anchors.insert(note_id, (pos.x, pos.y));
    }
    Ok(())
}

/// Move the window to `anchor + (dx, dy)`, where the deltas are screen-space
/// pixels accumulated since [`sticky_drag_start`].
#[tauri::command]
pub fn sticky_drag_move(note_id: String, dx: f64, dy: f64, app: AppHandle) -> Result<(), AppError> {
    let anchor = drag_anchors()
        .lock()
        .ok()
        .and_then(|anchors| anchors.get(&note_id).copied());
    let Some((anchor_x, anchor_y)) = anchor else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window(&window_label(&note_id)) else {
        return Ok(());
    };
    let _ = window.set_position(tauri::LogicalPosition::new(anchor_x + dx, anchor_y + dy));
    Ok(())
}

/// Drop the drag anchor. The `Moved` events emitted during the drag already
/// scheduled the debounced geometry save, so there's nothing to persist here.
#[tauri::command]
pub fn sticky_drag_end(note_id: String) -> Result<(), AppError> {
    if let Ok(mut anchors) = drag_anchors().lock() {
        anchors.remove(&note_id);
    }
    Ok(())
}

#[tauri::command]
pub fn sticky_is_stuck(
    note_id: String,
    store: tauri::State<'_, DataStore>,
) -> Result<bool, AppError> {
    let conn = store.conn()?;
    sticky_notes::is_stuck(&conn, &note_id)
}

#[tauri::command]
pub fn sticky_list(store: tauri::State<'_, DataStore>) -> Result<Vec<StickyNote>, AppError> {
    let conn = store.conn()?;
    sticky_notes::list(&conn)
}

#[tauri::command]
pub fn sticky_save_geometry(
    note_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    store: tauri::State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = store.conn()?;
    sticky_notes::save_geometry(&conn, &note_id, x, y, width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_round_trips_with_note_id() {
        let label = window_label("abc-123");
        assert_eq!(label, "sticky-abc-123");
        assert_eq!(note_id_from_label(&label), Some("abc-123"));
    }

    #[test]
    fn note_id_from_label_ignores_other_windows() {
        assert_eq!(note_id_from_label("settings"), None);
        assert_eq!(note_id_from_label("hud"), None);
        assert_eq!(note_id_from_label("main"), None);
    }

    #[test]
    fn default_geometry_cascades_so_stickies_dont_stack() {
        let first = default_geometry("a", 0, 1.0);
        let second = default_geometry("b", 1, 2.0);
        assert_eq!(first.x, CASCADE_ORIGIN);
        assert_eq!(second.x, CASCADE_ORIGIN + CASCADE_STEP);
        assert_ne!(first.y, second.y);
        assert_eq!(first.width, DEFAULT_WIDTH);
    }

    #[test]
    fn clamp_leaves_an_on_screen_rect_untouched() {
        let (x, y) = clamp_to_bounds(200.0, 300.0, 320.0, 260.0, (0.0, 0.0, 1920.0, 1080.0));
        assert_eq!((x, y), (200.0, 300.0));
    }

    #[test]
    fn clamp_pulls_back_a_rect_saved_on_a_disconnected_display() {
        // Saved far right (second monitor), now only a 1920x1080 primary exists.
        let (x, y) = clamp_to_bounds(4000.0, 2000.0, 320.0, 260.0, (0.0, 0.0, 1920.0, 1080.0));
        assert_eq!(x, 1920.0 - 320.0);
        assert_eq!(y, 1080.0 - 260.0);
    }

    #[test]
    fn clamp_handles_negative_coordinates() {
        let (x, y) = clamp_to_bounds(-500.0, -400.0, 320.0, 260.0, (0.0, 0.0, 1920.0, 1080.0));
        assert_eq!((x, y), (0.0, 0.0));
    }

    #[test]
    fn clamp_pins_to_origin_when_window_is_larger_than_the_monitor() {
        let (x, y) = clamp_to_bounds(50.0, 50.0, 2000.0, 1200.0, (0.0, 0.0, 1920.0, 1080.0));
        assert_eq!((x, y), (0.0, 0.0));
    }

    #[test]
    fn clamp_respects_a_non_zero_monitor_origin() {
        // Monitor positioned to the right of the primary.
        let (x, y) = clamp_to_bounds(0.0, 0.0, 320.0, 260.0, (1920.0, 0.0, 1920.0, 1080.0));
        assert_eq!((x, y), (1920.0, 0.0));
    }
}
