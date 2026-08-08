//! The launcher's position arithmetic. Pure, platform-free, and the **only**
//! place the formula lives — before #596 it was copy-pasted into
//! `platform::macos::window::center_at_cursor_monitor` and
//! `commands::app::center_on_primary_monitor`, which is how Windows and Linux
//! ended up permanently pinned to the primary display.

use super::types::LauncherAnchor;

/// A rectangle in a neutral **top-left origin, y-down** space. Callers put
/// the monitor and its work area into the same space and convert the result
/// back; see [`super::service`] for the two conversions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

/// Resolves the launcher's top-left corner.
///
/// Two rectangles, on purpose:
///
/// - `monitor` is what the **anchor** is measured against. Keeping the anchor
///   on the full monitor is what makes `TopWeighted { bias: 0.16 }` reproduce
///   the pre-#596 position exactly, and it keeps a dragged fraction stable
///   when the dock auto-hides.
/// - `work` is what the result is **clamped** into, so the launcher never
///   opens under the menu bar, the taskbar, or the dock.
///
/// `reserve_height` is the height the window is allowed to grow to, not its
/// current height. The launcher pins its *top* edge and expands downward
/// (`platform::macos::window::set_launcher_window_height`), so a position that
/// fits while compact (96px) would hang off the bottom once expanded. Both the
/// vertical centring and the bottom clamp therefore use the expanded height —
/// which also means the top edge does not move between a compact and an
/// expanded reveal.
pub fn resolve_origin(
    anchor: &LauncherAnchor,
    monitor: Rect,
    work: Rect,
    window_width: f64,
    reserve_height: f64,
) -> (f64, f64) {
    let (x, y) = match *anchor {
        LauncherAnchor::TopWeighted { bias } => (
            monitor.x + (monitor.width - window_width) / 2.0,
            monitor.y + monitor.height * bias,
        ),
        LauncherAnchor::Centered => (
            monitor.x + (monitor.width - window_width) / 2.0,
            monitor.y + (monitor.height - reserve_height) / 2.0,
        ),
        LauncherAnchor::Free { x, y } => (
            monitor.x + monitor.width * x,
            monitor.y + monitor.height * y,
        ),
    };

    (
        clamp_into(x, work.x, work.x + work.width - window_width),
        clamp_into(y, work.y, work.y + work.height - reserve_height),
    )
}

/// Expresses `origin` as fractions of `monitor` — the inverse of the `Free`
/// branch above, used to turn a drop position into a persistable anchor.
pub fn origin_to_fractions(origin: (f64, f64), monitor: Rect) -> (f64, f64) {
    let fx = fraction(origin.0 - monitor.x, monitor.width);
    let fy = fraction(origin.1 - monitor.y, monitor.height);
    (fx, fy)
}

fn fraction(offset: f64, extent: f64) -> f64 {
    if extent <= 0.0 || !offset.is_finite() {
        return 0.0;
    }
    (offset / extent).clamp(0.0, 1.0)
}

/// `f64::clamp` panics on an inverted range or a NaN bound, both of which are
/// reachable here: a monitor narrower than the launcher inverts the horizontal
/// range, and one shorter than `reserve_height` inverts the vertical one.
/// Collapsing to `lo` in that case pins the window to the top-left of the work
/// area, which is the only fully-visible choice available.
fn clamp_into(v: f64, lo: f64, hi: f64) -> f64 {
    if !v.is_finite() || !lo.is_finite() {
        return if lo.is_finite() { lo } else { 0.0 };
    }
    let hi = if hi.is_finite() { hi.max(lo) } else { lo };
    v.clamp(lo, hi)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1920x1080 monitor at the origin whose work area excludes a 25px
    /// menu bar — the ordinary single-display Mac.
    fn primary() -> (Rect, Rect) {
        (
            Rect::new(0.0, 0.0, 1920.0, 1080.0),
            Rect::new(0.0, 25.0, 1920.0, 1055.0),
        )
    }

    const WIN_W: f64 = 800.0;
    const MAX_H: f64 = 480.0;

    fn top_weighted() -> LauncherAnchor {
        LauncherAnchor::default()
    }

    // --- TopWeighted: must reproduce the pre-#596 position exactly ---------

    #[test]
    fn top_weighted_centers_horizontally_and_sits_at_16_percent() {
        let (m, w) = primary();
        let (x, y) = resolve_origin(&top_weighted(), m, w, WIN_W, MAX_H);
        assert_eq!(x, (1920.0 - 800.0) / 2.0);
        assert_eq!(y, 1080.0 * 0.16);
    }

    #[test]
    fn top_weighted_includes_the_monitor_origin() {
        // Secondary display whose top-left is at (1920, -200) — a common
        // multi-monitor layout. This is the case the old
        // `compute_centered_position` covered.
        let m = Rect::new(1920.0, -200.0, 2560.0, 1440.0);
        let w = m;
        let (x, y) = resolve_origin(&top_weighted(), m, w, WIN_W, MAX_H);
        assert_eq!(x, 1920.0 + (2560.0 - 800.0) / 2.0);
        assert_eq!(y, -200.0 + 1440.0 * 0.16);
    }

    #[test]
    fn top_weighted_honours_a_custom_bias() {
        let (m, w) = primary();
        let (_, y) = resolve_origin(
            &LauncherAnchor::TopWeighted { bias: 0.4 },
            m,
            w,
            WIN_W,
            MAX_H,
        );
        assert_eq!(y, 1080.0 * 0.4);
    }

    // --- Centered ----------------------------------------------------------

    #[test]
    fn centered_uses_the_expanded_height_so_the_top_edge_never_moves() {
        let (m, w) = primary();
        let (x, y) = resolve_origin(&LauncherAnchor::Centered, m, w, WIN_W, MAX_H);
        assert_eq!(x, (1920.0 - 800.0) / 2.0);
        assert_eq!(y, (1080.0 - 480.0) / 2.0);
    }

    // --- Free --------------------------------------------------------------

    #[test]
    fn free_maps_fractions_onto_the_monitor() {
        let (m, w) = primary();
        let (x, y) = resolve_origin(
            &LauncherAnchor::Free { x: 0.25, y: 0.1 },
            m,
            w,
            WIN_W,
            MAX_H,
        );
        assert_eq!(x, 1920.0 * 0.25);
        assert_eq!(y, 1080.0 * 0.1);
    }

    #[test]
    fn free_lands_in_the_same_relative_spot_on_a_smaller_display() {
        let anchor = LauncherAnchor::Free { x: 0.25, y: 0.1 };
        let big = Rect::new(0.0, 0.0, 2560.0, 1440.0);
        let small = Rect::new(0.0, 0.0, 1280.0, 720.0);
        let (bx, by) = resolve_origin(&anchor, big, big, WIN_W, MAX_H);
        let (sx, sy) = resolve_origin(&anchor, small, small, WIN_W, MAX_H);
        assert_eq!(bx / 2560.0, sx / 1280.0);
        assert_eq!(by / 1440.0, sy / 720.0);
    }

    // --- Clamping ----------------------------------------------------------

    #[test]
    fn clamps_a_low_drop_so_the_expanded_window_still_fits() {
        let (m, w) = primary();
        // Dropped at 95% down — the expanded 480px window would hang far off
        // the bottom.
        let (_, y) = resolve_origin(
            &LauncherAnchor::Free { x: 0.5, y: 0.95 },
            m,
            w,
            WIN_W,
            MAX_H,
        );
        assert_eq!(y, 25.0 + 1055.0 - 480.0);
        assert!(y + MAX_H <= w.y + w.height);
    }

    #[test]
    fn clamps_off_the_right_edge() {
        let (m, w) = primary();
        let (x, _) = resolve_origin(&LauncherAnchor::Free { x: 1.0, y: 0.2 }, m, w, WIN_W, MAX_H);
        assert_eq!(x, 1920.0 - 800.0);
    }

    #[test]
    fn clamps_above_the_menu_bar() {
        let (m, w) = primary();
        let (_, y) = resolve_origin(&LauncherAnchor::Free { x: 0.5, y: 0.0 }, m, w, WIN_W, MAX_H);
        assert_eq!(y, 25.0, "must not slide under the menu bar");
    }

    #[test]
    fn respects_a_work_area_inset_on_an_offset_monitor() {
        // Left-hand display with a 60px dock on its left edge.
        let m = Rect::new(-1440.0, 0.0, 1440.0, 900.0);
        let w = Rect::new(-1380.0, 0.0, 1380.0, 900.0);
        let (x, _) = resolve_origin(&LauncherAnchor::Free { x: 0.0, y: 0.2 }, m, w, WIN_W, MAX_H);
        assert_eq!(x, -1380.0);
    }

    #[test]
    fn does_not_invert_when_the_window_is_wider_than_the_monitor() {
        let m = Rect::new(0.0, 0.0, 600.0, 400.0);
        let (x, y) = resolve_origin(&top_weighted(), m, m, WIN_W, MAX_H);
        assert_eq!(x, 0.0, "pins to the left edge rather than panicking");
        assert_eq!(y, 0.0, "pins to the top edge rather than panicking");
    }

    #[test]
    fn survives_a_nan_bias() {
        let (m, w) = primary();
        let (x, y) = resolve_origin(
            &LauncherAnchor::TopWeighted { bias: f64::NAN },
            m,
            w,
            WIN_W,
            MAX_H,
        );
        assert!(x.is_finite() && y.is_finite());
    }

    // --- origin_to_fractions ----------------------------------------------

    #[test]
    fn fractions_round_trip_through_resolve() {
        let m = Rect::new(1920.0, -200.0, 2560.0, 1440.0);
        let anchor = LauncherAnchor::Free { x: 0.3, y: 0.25 };
        let origin = resolve_origin(&anchor, m, m, WIN_W, MAX_H);
        assert_eq!(origin_to_fractions(origin, m), (0.3, 0.25));
    }

    #[test]
    fn fractions_clamp_a_drop_outside_the_monitor() {
        let m = Rect::new(0.0, 0.0, 1920.0, 1080.0);
        assert_eq!(origin_to_fractions((-500.0, 5000.0), m), (0.0, 1.0));
    }

    #[test]
    fn fractions_of_a_degenerate_monitor_are_zero() {
        let m = Rect::new(0.0, 0.0, 0.0, 0.0);
        assert_eq!(origin_to_fractions((10.0, 10.0), m), (0.0, 0.0));
    }
}
