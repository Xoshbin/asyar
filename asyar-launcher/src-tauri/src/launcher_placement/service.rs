//! Applies a [`LauncherPlacement`] to the real window, and turns a drop back
//! into one.
//!
//! ## Two coordinate spaces, on purpose
//!
//! [`super::resolve`] works in a **monitor-relative, top-left origin, y-down**
//! space: `(0, 0)` is the monitor's top-left corner. Each platform converts in
//! and out of that space once, here:
//!
//! - **macOS** stays in AppKit's bottom-left, y-up space the whole way. The
//!   `monitor` crate (`get_monitor_with_cursor`) returns raw `NSScreen` frames
//!   — *not* Tauri's normalised coordinates — and the reveal path positions
//!   the panel with `set_window_frame` rather than `set_position`, because the
//!   flash-free reveal machinery in `platform::macos::window` is written
//!   against `NSRect`. Both directions go through [`macos_conv`].
//! - **Windows/Linux** use Tauri's monitor APIs, which are already top-left
//!   y-down, so the conversion is an origin offset.

use super::resolve::{origin_to_fractions, resolve_origin, Rect};
use super::store;
use super::types::{LauncherAnchor, LauncherMonitorChoice, LauncherPlacement};
use super::LAUNCHER_MAX_HEIGHT;
use crate::error::AppError;
use crate::SPOTLIGHT_LABEL;
use tauri::{AppHandle, Manager, Runtime};

/// A monitor and its usable area, both monitor-relative and y-down, as
/// [`resolve_origin`] wants them.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frames {
    pub monitor: Rect,
    pub work: Rect,
}

/// The AppKit ⇆ neutral-space conversion, kept pure so the sign errors that
/// this kind of code invites are caught by tests rather than by dragging the
/// launcher onto a second display.
#[cfg(target_os = "macos")]
pub mod macos_conv {
    use super::{Frames, Rect};

    /// An `NSRect`-shaped value: AppKit's bottom-left origin, y-up.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct AppKitRect {
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
    }

    impl AppKitRect {
        /// The screen y of this rect's *top* edge.
        pub fn top(&self) -> f64 {
            self.y + self.height
        }
    }

    /// Expresses a screen's frame and visible frame in the neutral space.
    pub fn frames(screen: AppKitRect, visible: AppKitRect) -> Frames {
        Frames {
            monitor: Rect::new(0.0, 0.0, screen.width, screen.height),
            work: Rect::new(
                visible.x - screen.x,
                screen.top() - visible.top(),
                visible.width,
                visible.height,
            ),
        }
    }

    /// Neutral offsets → the AppKit origin (bottom-left) of a window of
    /// `window_height`.
    pub fn to_appkit_origin(
        screen: AppKitRect,
        offsets: (f64, f64),
        window_height: f64,
    ) -> (f64, f64) {
        (
            screen.x + offsets.0,
            screen.top() - offsets.1 - window_height,
        )
    }

    /// An existing window's AppKit frame → neutral offsets from the screen's
    /// top-left. The inverse of [`to_appkit_origin`].
    pub fn to_offsets(screen: AppKitRect, window: AppKitRect) -> (f64, f64) {
        (window.x - screen.x, screen.top() - window.top())
    }
}

/// Positions the launcher for a reveal. Fail-soft by contract: the caller is
/// mid-reveal and a placement problem must never stop the window appearing, so
/// every failure path leaves the window where it was.
pub fn apply<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let placement = store::load(app);
    apply_placement(app, &placement)
}

#[cfg(target_os = "macos")]
fn apply_placement<R: Runtime>(
    app: &AppHandle<R>,
    placement: &LauncherPlacement,
) -> Result<(), AppError> {
    use crate::platform::macos::{get_window_frame, set_window_frame};
    use objc2_foundation::{NSPoint, NSRect};

    let window = app
        .get_webview_window(SPOTLIGHT_LABEL)
        .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;

    let screen = pick_screen(placement.monitor)
        .ok_or_else(|| AppError::NotFound("target monitor".to_string()))?;
    let frames = macos_conv::frames(screen.frame, screen.visible);

    let window_frame = get_window_frame(&window);
    let offsets = resolve_origin(
        &placement.anchor,
        frames.monitor,
        frames.work,
        window_frame.size.width,
        LAUNCHER_MAX_HEIGHT,
    );
    let (x, y) = macos_conv::to_appkit_origin(screen.frame, offsets, window_frame.size.height);

    set_window_frame(
        &window,
        NSRect {
            origin: NSPoint { x, y },
            size: window_frame.size,
        },
    );
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply_placement<R: Runtime>(
    app: &AppHandle<R>,
    placement: &LauncherPlacement,
) -> Result<(), AppError> {
    use tauri::{LogicalPosition, Position};

    let window = app
        .get_webview_window(SPOTLIGHT_LABEL)
        .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;

    let monitor = pick_monitor(app, &window, placement.monitor)
        .ok_or_else(|| AppError::NotFound("target monitor".to_string()))?;
    let (origin, frames) = monitor_frames(&monitor);

    let scale = monitor.scale_factor();
    let window_size = window
        .outer_size()
        .map_err(|e| AppError::Platform(format!("outer_size: {e}")))?
        .to_logical::<f64>(scale);

    let (dx, dy) = resolve_origin(
        &placement.anchor,
        frames.monitor,
        frames.work,
        window_size.width,
        LAUNCHER_MAX_HEIGHT,
    );

    window
        .set_position(Position::Logical(LogicalPosition {
            x: origin.0 + dx,
            y: origin.1 + dy,
        }))
        .map_err(|e| AppError::Platform(format!("set_position: {e}")))?;
    Ok(())
}

/// Records where a drag left the launcher, as fractions of the display it was
/// dropped on. Registered as the launcher's [`crate::window_drag`] drop
/// handler, so it runs once per drag rather than once per frame.
pub fn persist_dragged<R: Runtime>(app: &AppHandle<R>) {
    match dragged_anchor(app) {
        Some(anchor) => {
            let placement = LauncherPlacement {
                anchor,
                ..store::load(app)
            };
            if let Err(e) = store::save(app, placement) {
                log::warn!("[launcher-placement] could not persist dragged position: {e}");
            }
        }
        None => {
            log::warn!("[launcher-placement] drag ended but the window position was unreadable")
        }
    }
}

#[cfg(target_os = "macos")]
fn dragged_anchor<R: Runtime>(app: &AppHandle<R>) -> Option<LauncherAnchor> {
    use crate::platform::macos::get_window_frame;
    use macos_conv::AppKitRect;

    let window = app.get_webview_window(SPOTLIGHT_LABEL)?;
    let f = get_window_frame(&window);
    let window_rect = AppKitRect {
        x: f.origin.x,
        y: f.origin.y,
        width: f.size.width,
        height: f.size.height,
    };
    // The display the window ended up on, not the one it started on — a drag
    // can cross displays.
    let screen = screen_containing(center_of(window_rect))?;
    let frames = macos_conv::frames(screen.frame, screen.visible);
    let offsets = macos_conv::to_offsets(screen.frame, window_rect);
    let (x, y) = origin_to_fractions(offsets, frames.monitor);
    Some(LauncherAnchor::Free { x, y })
}

#[cfg(not(target_os = "macos"))]
fn dragged_anchor<R: Runtime>(app: &AppHandle<R>) -> Option<LauncherAnchor> {
    let window = app.get_webview_window(SPOTLIGHT_LABEL)?;
    let scale = window.scale_factor().ok()?;
    let pos = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.outer_size().ok()?.to_logical::<f64>(scale);

    let center = (pos.x + size.width / 2.0, pos.y + size.height / 2.0);
    let monitor = window
        .monitor_from_point(center.0, center.1)
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;

    let (origin, frames) = monitor_frames(&monitor);
    let offsets = (pos.x - origin.0, pos.y - origin.1);
    let (x, y) = origin_to_fractions(offsets, frames.monitor);
    Some(LauncherAnchor::Free { x, y })
}

// --- monitor selection -----------------------------------------------------

#[cfg(target_os = "macos")]
struct Screen {
    frame: macos_conv::AppKitRect,
    visible: macos_conv::AppKitRect,
}

#[cfg(target_os = "macos")]
fn to_screen(m: &monitor::Monitor) -> Screen {
    let scale = m.scale_factor();
    let f = m.size().to_logical::<f64>(scale);
    let p = m.position().to_logical::<f64>(scale);
    let visible = m.visible_area();
    let vs = visible.size().to_logical::<f64>(scale);
    let vp = visible.position().to_logical::<f64>(scale);
    Screen {
        frame: macos_conv::AppKitRect {
            x: p.x,
            y: p.y,
            width: f.width,
            height: f.height,
        },
        visible: macos_conv::AppKitRect {
            x: vp.x,
            y: vp.y,
            width: vs.width,
            height: vs.height,
        },
    }
}

#[cfg(target_os = "macos")]
fn pick_screen(choice: LauncherMonitorChoice) -> Option<Screen> {
    match choice {
        LauncherMonitorChoice::Cursor => monitor::get_monitor_with_cursor()
            .as_ref()
            .map(to_screen)
            .or_else(|| pick_screen(LauncherMonitorChoice::Primary)),
        LauncherMonitorChoice::Primary => monitor::get_monitors()
            .iter()
            .find(|m| m.is_primary())
            .map(to_screen),
    }
}

#[cfg(target_os = "macos")]
fn center_of(r: macos_conv::AppKitRect) -> (f64, f64) {
    (r.x + r.width / 2.0, r.y + r.height / 2.0)
}

#[cfg(target_os = "macos")]
fn screen_containing(point: (f64, f64)) -> Option<Screen> {
    let monitors = monitor::get_monitors();
    monitors
        .iter()
        .find(|m| {
            let s = to_screen(m);
            point.0 >= s.frame.x
                && point.0 < s.frame.x + s.frame.width
                && point.1 >= s.frame.y
                && point.1 < s.frame.y + s.frame.height
        })
        .or_else(|| monitors.iter().find(|m| m.is_primary()))
        .map(to_screen)
}

/// Cursor-monitor lookup on Windows/Linux. This is new with #596 — both
/// platforms previously hardcoded the primary display, which is the "it always
/// opens on the wrong screen" half of the issue.
#[cfg(not(target_os = "macos"))]
fn pick_monitor<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
    choice: LauncherMonitorChoice,
) -> Option<tauri::Monitor> {
    let primary = || window.primary_monitor().ok().flatten();
    match choice {
        LauncherMonitorChoice::Primary => primary(),
        LauncherMonitorChoice::Cursor => app
            .cursor_position()
            .ok()
            .and_then(|p| window.monitor_from_point(p.x, p.y).ok().flatten())
            .or_else(primary),
    }
}

/// A Tauri monitor's absolute logical origin, plus its frames in the neutral
/// (monitor-relative) space.
#[cfg(not(target_os = "macos"))]
fn monitor_frames(m: &tauri::Monitor) -> ((f64, f64), Frames) {
    let scale = m.scale_factor();
    let size = m.size().to_logical::<f64>(scale);
    let pos = m.position().to_logical::<f64>(scale);
    let work = m.work_area();
    let work_pos = work.position.to_logical::<f64>(scale);
    let work_size = work.size.to_logical::<f64>(scale);

    (
        (pos.x, pos.y),
        Frames {
            monitor: Rect::new(0.0, 0.0, size.width, size.height),
            work: Rect::new(
                work_pos.x - pos.x,
                work_pos.y - pos.y,
                work_size.width,
                work_size.height,
            ),
        },
    )
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::macos_conv::*;
    use super::*;

    /// The built-in display: AppKit origin (0,0), 25px menu bar at the top.
    fn builtin() -> (AppKitRect, AppKitRect) {
        (
            AppKitRect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
            },
            AppKitRect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1055.0,
            },
        )
    }

    /// A display stacked *above* the built-in one: in AppKit its origin.y is
    /// positive. This is the layout the neutral space exists to get right.
    fn above() -> (AppKitRect, AppKitRect) {
        (
            AppKitRect {
                x: 0.0,
                y: 1080.0,
                width: 2560.0,
                height: 1440.0,
            },
            AppKitRect {
                x: 0.0,
                y: 1080.0,
                width: 2560.0,
                height: 1440.0,
            },
        )
    }

    #[test]
    fn work_area_inset_is_measured_downward_from_the_screen_top() {
        let (screen, visible) = builtin();
        let f = frames(screen, visible);
        assert_eq!(f.monitor, Rect::new(0.0, 0.0, 1920.0, 1080.0));
        assert_eq!(
            f.work,
            Rect::new(0.0, 25.0, 1920.0, 1055.0),
            "the 25px menu bar sits at the top in the neutral space, even though AppKit measures the visible frame from the bottom"
        );
    }

    #[test]
    fn to_appkit_origin_reproduces_the_pre_596_position() {
        // The old center_at_cursor_monitor: top edge at 16% from the top.
        let (screen, _) = builtin();
        let (_, y) = to_appkit_origin(screen, (560.0, 1080.0 * 0.16), 480.0);
        let old = (screen.y + screen.height - screen.height * 0.16) - 480.0;
        assert_eq!(y, old);
    }

    #[test]
    fn to_appkit_origin_handles_a_screen_above_the_primary() {
        let (screen, _) = above();
        let (x, y) = to_appkit_origin(screen, (100.0, 200.0), 480.0);
        assert_eq!(x, 100.0);
        assert_eq!(y, 1080.0 + 1440.0 - 200.0 - 480.0);
    }

    #[test]
    fn offsets_round_trip_through_the_appkit_origin() {
        for (screen, _) in [builtin(), above()] {
            let offsets = (321.0, 654.0);
            let (x, y) = to_appkit_origin(screen, offsets, 480.0);
            let window = AppKitRect {
                x,
                y,
                width: 800.0,
                height: 480.0,
            };
            assert_eq!(to_offsets(screen, window), offsets);
        }
    }

    #[test]
    fn a_window_at_the_screen_top_left_has_zero_offsets() {
        let (screen, _) = above();
        let window = AppKitRect {
            x: screen.x,
            y: screen.top() - 480.0,
            width: 800.0,
            height: 480.0,
        };
        assert_eq!(to_offsets(screen, window), (0.0, 0.0));
    }
}
