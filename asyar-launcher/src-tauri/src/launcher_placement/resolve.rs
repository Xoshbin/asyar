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

/// The space a [`LauncherAnchor::Free`] anchor's fractions live in: the
/// window's available travel inside the monitor, not the monitor itself.
///
/// Both directions live on this type so persisting and resolving an anchor
/// cannot silently use different coordinate spaces again.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TravelSpace {
    pub monitor: Rect,
    pub window_width: f64,
    /// The expanded launcher height reserved by [`resolve_origin`].
    pub reserve_height: f64,
}

impl TravelSpace {
    pub fn new(monitor: Rect, window_width: f64, reserve_height: f64) -> Self {
        Self {
            monitor,
            window_width,
            reserve_height,
        }
    }

    /// Horizontal travel, with a one-pixel denominator for degenerate spans.
    pub fn span_x(&self) -> f64 {
        travel(self.monitor.width, self.window_width)
    }

    /// Vertical travel, with a one-pixel denominator for degenerate spans.
    pub fn span_y(&self) -> f64 {
        travel(self.monitor.height, self.reserve_height)
    }

    /// Converts a monitor-space origin to fractions of the available travel.
    pub fn to_fractions(&self, origin: (f64, f64)) -> (f64, f64) {
        (
            fraction(origin.0 - self.monitor.x, self.span_x()),
            fraction(origin.1 - self.monitor.y, self.span_y()),
        )
    }

    /// Converts fractions of the available travel to a monitor-space origin.
    pub fn to_origin(&self, fractions: (f64, f64)) -> (f64, f64) {
        (
            self.monitor.x + self.span_x() * fractions.0,
            self.monitor.y + self.span_y() * fractions.1,
        )
    }
}

fn travel(extent: f64, window: f64) -> f64 {
    if !extent.is_finite() || !window.is_finite() {
        return 1.0;
    }
    (extent - window).max(1.0)
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
        LauncherAnchor::Free { x, y } => {
            TravelSpace::new(monitor, window_width, reserve_height).to_origin((x, y))
        }
        // COMPAT(remove in 0.2.0): pre-#860 fractions used the monitor's full
        // extent. Keep the old formula only until the reveal path migrates it.
        LauncherAnchor::LegacyFree { x, y } => legacy_monitor_fraction_origin((x, y), monitor),
    };

    (
        clamp_into(x, work.x, work.x + work.width - window_width),
        clamp_into(y, work.y, work.y + work.height - reserve_height),
    )
}

/// COMPAT(remove in 0.2.0): resolves the pre-#860 fraction space, where a
/// free anchor described the window corner as fractions of the full monitor.
pub fn legacy_monitor_fraction_origin(fractions: (f64, f64), monitor: Rect) -> (f64, f64) {
    (
        monitor.x + monitor.width * fractions.0,
        monitor.y + monitor.height * fractions.1,
    )
}

/// `offset / extent` clamped to `0..=1`, or zero for invalid input.
pub(super) fn fraction(offset: f64, extent: f64) -> f64 {
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

/// Which axes of a drag are currently within the magnetic snap radius.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SnapState {
    pub x: bool,
    pub y: bool,
}

/// The launcher's snap target: identical to where it would sit at its
/// default placement. There is no separate formula to maintain — snapping
/// *is* "does this drag match the default anchor," so this simply reuses
/// [`resolve_origin`] with [`LauncherAnchor::default()`]. The two vertical
/// guide lines the frontend draws are `target.0` and `target.0 + window_width`
/// — both edges of this one x value.
pub fn snap_targets(
    monitor: Rect,
    work: Rect,
    window_width: f64,
    reserve_height: f64,
) -> (f64, f64) {
    resolve_origin(
        &LauncherAnchor::default(),
        monitor,
        work,
        window_width,
        reserve_height,
    )
}

/// Clamps a live drag position onto `target` per-axis when within
/// `threshold` (a strict `<` — sitting exactly on the boundary does not
/// count as snapped). Independent per axis, matching the crosshair: you can
/// be snapped horizontally with a free vertical position, or vice versa.
pub fn apply_snap(x: f64, y: f64, target: (f64, f64), threshold: f64) -> ((f64, f64), SnapState) {
    let snap_x = (x - target.0).abs() < threshold;
    let snap_y = (y - target.1).abs() < threshold;
    (
        (
            if snap_x { target.0 } else { x },
            if snap_y { target.1 } else { y },
        ),
        SnapState {
            x: snap_x,
            y: snap_y,
        },
    )
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
    fn free_maps_fractions_onto_the_available_travel() {
        let (m, w) = primary();
        let (x, y) = resolve_origin(
            &LauncherAnchor::Free { x: 0.25, y: 0.1 },
            m,
            w,
            WIN_W,
            MAX_H,
        );
        assert_eq!(x, (1920.0 - WIN_W) * 0.25);
        assert_eq!(y, (1080.0 - MAX_H) * 0.1);
    }

    #[test]
    fn free_lands_in_the_same_relative_spot_on_a_smaller_display() {
        let anchor = LauncherAnchor::Free { x: 0.25, y: 0.1 };
        let big = Rect::new(0.0, 0.0, 2560.0, 1440.0);
        let small = Rect::new(0.0, 0.0, 1280.0, 720.0);
        let (bx, by) = resolve_origin(&anchor, big, big, WIN_W, MAX_H);
        let (sx, sy) = resolve_origin(&anchor, small, small, WIN_W, MAX_H);
        assert_eq!(bx / (2560.0 - WIN_W), sx / (1280.0 - WIN_W));
        assert_eq!(by / (1440.0 - MAX_H), sy / (720.0 - MAX_H));
    }

    // --- Clamping ----------------------------------------------------------

    #[test]
    fn a_bottom_of_travel_drop_keeps_the_expanded_window_on_screen() {
        let (m, w) = primary();
        // `1.0` is the bottom of the available travel, with the expanded
        // launcher height already reserved.
        let (_, y) = resolve_origin(&LauncherAnchor::Free { x: 0.5, y: 1.0 }, m, w, WIN_W, MAX_H);
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

    // --- TravelSpace -------------------------------------------------------

    #[test]
    fn fractions_round_trip_through_resolve() {
        let m = Rect::new(1920.0, -200.0, 2560.0, 1440.0);
        let anchor = LauncherAnchor::Free { x: 0.3, y: 0.25 };
        let origin = resolve_origin(&anchor, m, m, WIN_W, MAX_H);
        assert_eq!(
            TravelSpace::new(m, WIN_W, MAX_H).to_fractions(origin),
            (0.3, 0.25)
        );
    }

    #[test]
    fn fractions_clamp_a_drop_outside_the_monitor() {
        let space = TravelSpace::new(Rect::new(0.0, 0.0, 1920.0, 1080.0), WIN_W, MAX_H);
        assert_eq!(space.to_fractions((-500.0, 5000.0)), (0.0, 1.0));
    }

    #[test]
    fn fractions_of_a_degenerate_monitor_are_zero() {
        let space = TravelSpace::new(Rect::new(0.0, 0.0, 0.0, 0.0), WIN_W, MAX_H);
        assert_eq!(space.to_fractions((0.0, 0.0)), (0.0, 0.0));
    }

    // --- #860: a stored position must mean the same thing on another display -

    #[test]
    fn a_centered_drop_stays_centered_on_a_smaller_display() {
        // Issue #860, verbatim: "center on bigger monitor --> switch to
        // smaller screen --> launcher window moved".
        //
        // Centring a 800px window on a 2560px display puts its corner at 880,
        // which as a fraction of the monitor's own extent is
        // `880 / 2560 = 0.34375`. On a 1440px display that fraction resolves
        // to `1440 * 0.34375 = 495` — the window's centre lands at 895 instead
        // of 720, 175px right of where the user put it. The fraction has to be
        // of the *travel* (`monitor - window`), where centring is 0.5 on every
        // display.
        let big = Rect::new(0.0, 0.0, 2560.0, 1440.0);
        let small = Rect::new(0.0, 0.0, 1440.0, 900.0);

        // Dropped dead-centre horizontally, at a height that is deliberately
        // *not* the default 16% — that case `dragged_anchor` already names.
        let dropped = ((2560.0 - WIN_W) / 2.0, 500.0);
        let (fx, fy) = TravelSpace::new(big, WIN_W, MAX_H).to_fractions(dropped);

        let (x, _) = resolve_origin(
            &LauncherAnchor::Free { x: fx, y: fy },
            small,
            small,
            WIN_W,
            MAX_H,
        );
        assert_eq!(
            x,
            (1440.0 - WIN_W) / 2.0,
            "a centred launcher must stay centred when the display shrinks"
        );
    }

    #[test]
    fn a_centered_drop_survives_a_resolution_change_on_the_same_display() {
        let before = Rect::new(0.0, 0.0, 2560.0, 1440.0);
        let after = Rect::new(0.0, 0.0, 1920.0, 1080.0);
        let dropped = ((2560.0 - WIN_W) / 2.0, (1440.0 - MAX_H) / 2.0);
        let fractions = TravelSpace::new(before, WIN_W, MAX_H).to_fractions(dropped);

        assert_eq!(
            resolve_origin(
                &LauncherAnchor::Free {
                    x: fractions.0,
                    y: fractions.1,
                },
                after,
                after,
                WIN_W,
                MAX_H,
            ),
            ((1920.0 - WIN_W) / 2.0, (1080.0 - MAX_H) / 2.0)
        );
    }

    #[test]
    fn travel_space_makes_the_centered_anchor_exactly_half_on_any_display() {
        for monitor in [
            Rect::new(0.0, 0.0, 2560.0, 1440.0),
            Rect::new(1920.0, -200.0, 1440.0, 900.0),
            Rect::new(-1440.0, 0.0, 3840.0, 2160.0),
        ] {
            let space = TravelSpace::new(monitor, WIN_W, MAX_H);
            let centered =
                resolve_origin(&LauncherAnchor::Centered, monitor, monitor, WIN_W, MAX_H);
            assert_eq!(space.to_fractions(centered), (0.5, 0.5));
            assert_eq!(
                resolve_origin(
                    &LauncherAnchor::Free { x: 0.5, y: 0.5 },
                    monitor,
                    monitor,
                    WIN_W,
                    MAX_H,
                ),
                centered
            );
        }
    }

    #[test]
    fn flush_right_stays_flush_right_on_a_smaller_display() {
        for monitor in [
            Rect::new(0.0, 0.0, 2560.0, 1440.0),
            Rect::new(0.0, 0.0, 1440.0, 900.0),
        ] {
            let (x, _) = resolve_origin(
                &LauncherAnchor::Free { x: 1.0, y: 0.0 },
                monitor,
                monitor,
                WIN_W,
                MAX_H,
            );
            assert_eq!(x, monitor.width - WIN_W);
        }
    }

    #[test]
    fn a_display_narrower_than_the_launcher_uses_a_safe_travel_denominator() {
        let monitor = Rect::new(0.0, 0.0, 600.0, 400.0);
        let space = TravelSpace::new(monitor, WIN_W, MAX_H);
        assert_eq!(space.span_x(), 1.0);
        assert_eq!(space.span_y(), 1.0);
        assert_eq!(space.to_fractions((0.0, 0.0)), (0.0, 0.0));
    }

    #[test]
    fn a_free_anchor_on_a_tiny_display_pins_to_the_work_area_corner() {
        let monitor = Rect::new(0.0, 0.0, 600.0, 400.0);
        let work = Rect::new(0.0, 25.0, 600.0, 375.0);
        assert_eq!(
            resolve_origin(
                &LauncherAnchor::Free { x: 0.9, y: 0.9 },
                monitor,
                work,
                WIN_W,
                MAX_H,
            ),
            (0.0, 25.0)
        );
    }

    #[test]
    fn a_non_finite_span_uses_a_safe_travel_denominator() {
        let space = TravelSpace::new(Rect::new(0.0, 0.0, f64::NAN, 1080.0), WIN_W, MAX_H);
        assert_eq!(space.span_x(), 1.0);
        assert!(space.to_origin((0.5, 0.5)).0.is_finite());
    }

    #[test]
    fn a_free_anchor_with_a_non_finite_fraction_does_not_panic() {
        let (monitor, work) = primary();
        let (x, y) = resolve_origin(
            &LauncherAnchor::Free {
                x: f64::NAN,
                y: 0.5,
            },
            monitor,
            work,
            WIN_W,
            MAX_H,
        );
        assert!(x.is_finite() && y.is_finite());
    }

    // --- snap_targets / apply_snap ------------------------------------------

    #[test]
    fn snap_targets_equal_the_default_anchors_resolved_position() {
        let (m, w) = primary();
        let target = snap_targets(m, w, WIN_W, MAX_H);
        let default_origin = resolve_origin(&LauncherAnchor::default(), m, w, WIN_W, MAX_H);
        assert_eq!(
            target, default_origin,
            "the snap target must be the exact same point the reveal path uses for the default anchor"
        );
    }

    #[test]
    fn apply_snap_locks_onto_the_target_within_threshold() {
        let (m, w) = primary();
        let target = snap_targets(m, w, WIN_W, MAX_H);
        let near = (target.0 + 5.0, target.1 - 5.0);
        let (adjusted, state) = apply_snap(near.0, near.1, target, 12.0);
        assert_eq!(adjusted, target);
        assert_eq!(state, SnapState { x: true, y: true });
    }

    #[test]
    fn apply_snap_releases_outside_threshold() {
        let (m, w) = primary();
        let target = snap_targets(m, w, WIN_W, MAX_H);
        let far = (target.0 + 50.0, target.1 + 50.0);
        let (adjusted, state) = apply_snap(far.0, far.1, target, 12.0);
        assert_eq!(adjusted, far);
        assert_eq!(state, SnapState { x: false, y: false });
    }

    #[test]
    fn apply_snap_axes_are_independent() {
        let (m, w) = primary();
        let target = snap_targets(m, w, WIN_W, MAX_H);
        // Close on x, far on y.
        let (adjusted, state) = apply_snap(target.0 + 2.0, target.1 + 200.0, target, 12.0);
        assert_eq!(adjusted.0, target.0, "x snaps");
        assert_eq!(adjusted.1, target.1 + 200.0, "y stays free");
        assert_eq!(state, SnapState { x: true, y: false });
    }

    #[test]
    fn apply_snap_threshold_is_a_strict_boundary() {
        let (m, w) = primary();
        let target = snap_targets(m, w, WIN_W, MAX_H);
        // Exactly at the threshold: not close enough (strict `<`, not `<=`,
        // matching the "must be strictly inside the magnetic radius" intent).
        let (_, state) = apply_snap(target.0 + 12.0, target.1 + 12.0, target, 12.0);
        assert_eq!(state, SnapState { x: false, y: false });
    }
}
