//! Turning a drop into a persistable anchor, and bringing a pre-#860 anchor
//! forward.
//!
//! These operations are pure geometry plus a naming decision. Platform window
//! access stays in [`super::service`].

use super::resolve::{fraction, legacy_monitor_fraction_origin, resolve_origin, Rect, TravelSpace};
use super::types::LauncherAnchor;

const ANCHOR_MATCH_EPSILON_PX: f64 = 1.0;

fn close_px(a: f64, b: f64) -> bool {
    (a - b).abs() < ANCHOR_MATCH_EPSILON_PX
}

/// Names a dropped origin with the most descriptive stable anchor available.
///
/// Comparisons use the work-area-clamped result of [`resolve_origin`], so a
/// snap beside a dock or taskbar is still recognized. A horizontal-center
/// drop at another height maps to the same `TopWeighted` shape the Settings
/// slider writes; everything else remains a travel-space free anchor.
pub fn classify_drop(offsets: (f64, f64), space: TravelSpace, work: Rect) -> LauncherAnchor {
    let at = |anchor: &LauncherAnchor| {
        resolve_origin(
            anchor,
            space.monitor,
            work,
            space.window_width,
            space.reserve_height,
        )
    };

    let default_anchor = LauncherAnchor::default();
    let default_origin = at(&default_anchor);
    if close_px(offsets.0, default_origin.0) && close_px(offsets.1, default_origin.1) {
        return default_anchor;
    }

    let centered_origin = at(&LauncherAnchor::Centered);
    if close_px(offsets.0, centered_origin.0) && close_px(offsets.1, centered_origin.1) {
        return LauncherAnchor::Centered;
    }

    if close_px(offsets.0, centered_origin.0) {
        return LauncherAnchor::TopWeighted {
            bias: fraction(offsets.1 - space.monitor.y, space.monitor.height.max(1.0)),
        };
    }

    let (x, y) = space.to_fractions(offsets);
    LauncherAnchor::Free { x, y }
}

/// COMPAT(remove in 0.2.0): rewrites a pre-#860 monitor-fraction anchor into
/// travel-space fractions against the monitor selected for this reveal.
///
/// Expanding with the original formula and re-normalizing through
/// [`TravelSpace`] preserves the resolved pixel on that monitor. Every other
/// anchor passes through unchanged.
pub fn migrate_anchor(anchor: LauncherAnchor, space: TravelSpace) -> LauncherAnchor {
    match anchor {
        LauncherAnchor::LegacyFree { x, y } => {
            let origin = legacy_monitor_fraction_origin((x, y), space.monitor);
            let (x, y) = space.to_fractions(origin);
            LauncherAnchor::Free { x, y }
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::launcher_placement::resolve::{resolve_origin, Rect};

    const WIN_W: f64 = 800.0;
    const MAX_H: f64 = 480.0;

    fn primary() -> (Rect, Rect) {
        (
            Rect::new(0.0, 0.0, 1920.0, 1080.0),
            Rect::new(0.0, 25.0, 1920.0, 1055.0),
        )
    }

    fn space_of(monitor: Rect) -> TravelSpace {
        TravelSpace::new(monitor, WIN_W, MAX_H)
    }

    #[test]
    fn migrating_a_legacy_anchor_never_moves_the_window_on_the_monitor_it_runs_on() {
        let monitor = Rect::new(0.0, 0.0, 2560.0, 1440.0);
        let work = Rect::new(0.0, 25.0, 2560.0, 1415.0);
        let legacy = LauncherAnchor::LegacyFree {
            x: 0.34375,
            y: 0.25,
        };
        let space = TravelSpace::new(monitor, WIN_W, MAX_H);

        let migrated = migrate_anchor(legacy, space);

        assert!(matches!(migrated, LauncherAnchor::Free { .. }));
        assert_eq!(
            resolve_origin(&migrated, monitor, work, WIN_W, MAX_H),
            resolve_origin(&legacy, monitor, work, WIN_W, MAX_H),
        );
    }

    #[test]
    fn the_migration_is_position_preserving_across_a_table_of_displays() {
        let cases = [
            (
                Rect::new(0.0, 0.0, 2560.0, 1440.0),
                Rect::new(0.0, 25.0, 2560.0, 1415.0),
            ),
            (
                Rect::new(1920.0, -200.0, 1440.0, 900.0),
                Rect::new(1980.0, -200.0, 1380.0, 900.0),
            ),
            (
                Rect::new(0.0, 0.0, 600.0, 400.0),
                Rect::new(0.0, 0.0, 600.0, 400.0),
            ),
        ];

        for (monitor, work) in cases {
            for (x, y) in [(0.0, 0.0), (0.25, 0.1), (0.5, 0.5), (1.0, 1.0)] {
                let legacy = LauncherAnchor::LegacyFree { x, y };
                let space = TravelSpace::new(monitor, WIN_W, MAX_H);
                let migrated = migrate_anchor(legacy, space);
                assert_eq!(
                    resolve_origin(&migrated, monitor, work, WIN_W, MAX_H),
                    resolve_origin(&legacy, monitor, work, WIN_W, MAX_H),
                    "monitor {monitor:?}, fractions ({x}, {y})"
                );
            }
        }
    }

    #[test]
    fn migration_leaves_every_other_anchor_alone() {
        let space = TravelSpace::new(Rect::new(0.0, 0.0, 1920.0, 1080.0), WIN_W, MAX_H);
        for anchor in [
            LauncherAnchor::default(),
            LauncherAnchor::TopWeighted { bias: 0.4 },
            LauncherAnchor::Centered,
            LauncherAnchor::Free { x: 0.3, y: 0.7 },
        ] {
            assert_eq!(migrate_anchor(anchor, space), anchor);
        }
    }

    #[test]
    fn migration_is_idempotent() {
        let space = TravelSpace::new(Rect::new(0.0, 0.0, 2560.0, 1440.0), WIN_W, MAX_H);
        let once = migrate_anchor(LauncherAnchor::LegacyFree { x: 0.3, y: 0.3 }, space);
        assert_eq!(migrate_anchor(once, space), once);
    }

    #[test]
    fn legacy_anchor_compatibility_is_removed_before_0_2_0() {
        let current =
            semver::Version::parse(env!("CARGO_PKG_VERSION")).expect("package version must parse");
        let deadline = semver::Version::parse("0.2.0").unwrap();
        assert!(
            current < deadline,
            "launcher is at {current}: remove LegacyFree and its migration compatibility"
        );
    }

    #[test]
    fn the_legacy_anchor_declares_a_parseable_removal_target() {
        assert!(include_str!("types.rs").contains("COMPAT(remove in 0.2.0)"));
        assert!(include_str!("resolve.rs").contains("COMPAT(remove in 0.2.0)"));
    }

    #[test]
    fn a_drop_on_the_centered_position_persists_as_centered() {
        let (monitor, work) = primary();
        let origin = resolve_origin(&LauncherAnchor::Centered, monitor, work, WIN_W, MAX_H);
        assert_eq!(
            classify_drop(origin, space_of(monitor), work),
            LauncherAnchor::Centered
        );
    }

    #[test]
    fn a_center_snapped_drop_at_an_arbitrary_height_persists_as_a_custom_bias() {
        let (monitor, work) = primary();
        let centered_x = resolve_origin(&LauncherAnchor::Centered, monitor, work, WIN_W, MAX_H).0;
        assert_eq!(
            classify_drop((centered_x, 350.0), space_of(monitor), work),
            LauncherAnchor::TopWeighted {
                bias: 350.0 / 1080.0
            }
        );
    }

    #[test]
    fn a_drop_on_the_default_position_still_persists_as_the_default() {
        let (monitor, work) = primary();
        let origin = resolve_origin(&LauncherAnchor::default(), monitor, work, WIN_W, MAX_H);
        assert_eq!(
            classify_drop(origin, space_of(monitor), work),
            LauncherAnchor::default()
        );
    }

    #[test]
    fn an_unsnapped_drop_persists_as_travel_space_coordinates() {
        let (monitor, work) = primary();
        let centered_x = resolve_origin(&LauncherAnchor::Centered, monitor, work, WIN_W, MAX_H).0;
        let offsets = (centered_x + 40.0, 300.0);
        let expected = space_of(monitor).to_fractions(offsets);
        assert_eq!(
            classify_drop(offsets, space_of(monitor), work),
            LauncherAnchor::Free {
                x: expected.0,
                y: expected.1,
            }
        );
    }

    #[test]
    fn a_named_drop_round_trips_to_the_same_pixel_it_was_dropped_on() {
        let (monitor, work) = primary();
        let centered = resolve_origin(&LauncherAnchor::Centered, monitor, work, WIN_W, MAX_H);
        let default = resolve_origin(&LauncherAnchor::default(), monitor, work, WIN_W, MAX_H);
        for offsets in [centered, default, (centered.0, 350.0)] {
            let anchor = classify_drop(offsets, space_of(monitor), work);
            let resolved = resolve_origin(&anchor, monitor, work, WIN_W, MAX_H);
            assert!(
                (resolved.0 - offsets.0).abs() < ANCHOR_MATCH_EPSILON_PX
                    && (resolved.1 - offsets.1).abs() < ANCHOR_MATCH_EPSILON_PX,
                "{anchor:?} resolved to {resolved:?}, dropped at {offsets:?}"
            );
        }
    }

    #[test]
    fn a_sub_pixel_rounding_error_still_counts_as_the_named_anchor() {
        let (monitor, work) = primary();
        let (x, y) = resolve_origin(&LauncherAnchor::default(), monitor, work, WIN_W, MAX_H);
        assert_eq!(
            classify_drop((x, y.round()), space_of(monitor), work),
            LauncherAnchor::default()
        );
    }

    #[test]
    fn a_real_offset_is_not_mistaken_for_the_named_anchor() {
        let (monitor, work) = primary();
        let (x, y) = resolve_origin(&LauncherAnchor::default(), monitor, work, WIN_W, MAX_H);
        assert!(matches!(
            classify_drop((x + 5.0, y), space_of(monitor), work),
            LauncherAnchor::Free { .. }
        ));
    }

    #[test]
    fn the_epsilon_does_not_shrink_on_a_display_barely_wider_than_the_launcher() {
        let monitor = Rect::new(0.0, 0.0, 900.0, 1080.0);
        let work = Rect::new(0.0, 25.0, 900.0, 1055.0);
        let (x, y) = resolve_origin(&LauncherAnchor::default(), monitor, work, WIN_W, MAX_H);
        assert_eq!(
            classify_drop((x + 0.4, y + 0.4), space_of(monitor), work),
            LauncherAnchor::default()
        );
    }

    #[test]
    fn a_center_snapped_drop_classifies_next_to_a_dock() {
        let monitor = Rect::new(-1440.0, 0.0, 1440.0, 900.0);
        let work = Rect::new(-1040.0, 0.0, 1040.0, 900.0);
        let centered = resolve_origin(&LauncherAnchor::Centered, monitor, work, WIN_W, MAX_H);
        assert_eq!(centered.0, work.x, "the dock must force a clamp");
        assert_eq!(
            classify_drop(centered, space_of(monitor), work),
            LauncherAnchor::Centered
        );
    }

    #[test]
    fn a_drop_on_a_display_with_no_travel_classifies_as_the_default() {
        let monitor = Rect::new(0.0, 0.0, 600.0, 400.0);
        let work = Rect::new(0.0, 25.0, 600.0, 375.0);
        assert_eq!(
            classify_drop((0.0, 25.0), space_of(monitor), work),
            LauncherAnchor::default()
        );
    }
}
