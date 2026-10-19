//! The persisted description of *where the launcher appears*.
//!
//! Deliberately a description, not coordinates: the same value has to make
//! sense on a 13" laptop and a 27" display, before and after a resolution
//! change. [`resolve_origin`](super::resolve::resolve_origin) turns it into
//! pixels against whichever monitor the reveal picked.

use serde::{Deserialize, Serialize};

/// Today's vertical placement: top edge at 16% of the monitor's height.
pub const DEFAULT_TOP_BIAS: f64 = 0.16;

/// Which display the launcher opens on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LauncherMonitorChoice {
    /// The display the mouse pointer is currently on. The default, and what
    /// macOS has always done — Windows and Linux only gained it with this
    /// feature.
    #[default]
    Cursor,
    /// Always the primary display, wherever the pointer is.
    Primary,
}

/// Where within the chosen display the launcher sits.
///
/// `Free` is the drag result and stores fractions of the window's available
/// travel inside the monitor, not pixels. The legacy monitor-fraction shape is
/// read separately so existing user data is never silently reinterpreted.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LauncherAnchor {
    /// Horizontally centred; top edge at `bias` of the monitor's height.
    TopWeighted { bias: f64 },
    /// Centred on both axes.
    Centered,
    /// Free position from a drag, as fractions of the window's available
    /// travel inside the monitor.
    #[serde(rename = "freeTravel")]
    Free { x: f64, y: f64 },
    /// COMPAT(remove in 0.2.0): pre-#860 `"free"` anchors stored fractions of
    /// the full monitor extent. Migrated to [`Self::Free`] on first reveal.
    #[serde(rename = "free")]
    LegacyFree { x: f64, y: f64 },
}

impl Default for LauncherAnchor {
    fn default() -> Self {
        Self::TopWeighted {
            bias: DEFAULT_TOP_BIAS,
        }
    }
}

impl LauncherAnchor {
    /// Coerces values that arrived from disk (or a buggy caller) into the
    /// ranges the resolver assumes. Anything non-finite falls back to the
    /// default rather than propagating a NaN into window geometry.
    pub fn sanitized(self) -> Self {
        match self {
            Self::TopWeighted { bias } => Self::TopWeighted {
                bias: sanitize_fraction(bias).unwrap_or(DEFAULT_TOP_BIAS),
            },
            Self::Centered => Self::Centered,
            Self::Free { x, y } => match (sanitize_fraction(x), sanitize_fraction(y)) {
                (Some(x), Some(y)) => Self::Free { x, y },
                _ => Self::default(),
            },
            Self::LegacyFree { x, y } => match (sanitize_fraction(x), sanitize_fraction(y)) {
                (Some(x), Some(y)) => Self::LegacyFree { x, y },
                _ => Self::default(),
            },
        }
    }
}

/// `Some(v)` clamped to 0..=1, or `None` if the value is not a real number.
fn sanitize_fraction(v: f64) -> Option<f64> {
    if v.is_finite() {
        Some(v.clamp(0.0, 1.0))
    } else {
        None
    }
}

/// The whole user-facing placement preference. Default reproduces the
/// pre-#596 behaviour exactly, so an install that never opens the setting
/// sees no change.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LauncherPlacement {
    pub monitor: LauncherMonitorChoice,
    pub anchor: LauncherAnchor,
    /// Whether dragging magnetically snaps to the default position. A
    /// `#[derive(Default)]` would give this `false` (bool's own default) —
    /// wrong, since snapping ships on. Hence the hand-written impl below.
    #[serde(default = "snap_enabled_default")]
    pub snap_enabled: bool,
}

fn snap_enabled_default() -> bool {
    true
}

impl Default for LauncherPlacement {
    fn default() -> Self {
        Self {
            monitor: LauncherMonitorChoice::default(),
            anchor: LauncherAnchor::default(),
            snap_enabled: true,
        }
    }
}

impl LauncherPlacement {
    pub fn sanitized(self) -> Self {
        Self {
            monitor: self.monitor,
            anchor: self.anchor.sanitized(),
            snap_enabled: self.snap_enabled,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_reproduces_pre_596_behaviour() {
        let p = LauncherPlacement::default();
        assert_eq!(p.monitor, LauncherMonitorChoice::Cursor);
        assert_eq!(p.anchor, LauncherAnchor::TopWeighted { bias: 0.16 });
    }

    #[test]
    fn sanitize_clamps_out_of_range_bias() {
        let a = LauncherAnchor::TopWeighted { bias: 4.2 }.sanitized();
        assert_eq!(a, LauncherAnchor::TopWeighted { bias: 1.0 });
    }

    #[test]
    fn sanitize_replaces_nan_bias_with_default() {
        let a = LauncherAnchor::TopWeighted { bias: f64::NAN }.sanitized();
        assert_eq!(
            a,
            LauncherAnchor::TopWeighted {
                bias: DEFAULT_TOP_BIAS
            }
        );
    }

    #[test]
    fn sanitize_clamps_free_fractions() {
        let a = LauncherAnchor::Free { x: -0.5, y: 1.5 }.sanitized();
        assert_eq!(a, LauncherAnchor::Free { x: 0.0, y: 1.0 });
    }

    #[test]
    fn sanitize_replaces_non_finite_free_with_default() {
        let a = LauncherAnchor::Free {
            x: f64::INFINITY,
            y: 0.5,
        }
        .sanitized();
        assert_eq!(a, LauncherAnchor::default());
    }

    #[test]
    fn a_free_anchor_serializes_under_its_own_tag() {
        let json = serde_json::to_value(LauncherAnchor::Free { x: 0.5, y: 0.5 }).unwrap();
        assert_eq!(json["kind"], "freeTravel");
    }

    #[test]
    fn the_legacy_tag_still_deserializes_into_the_legacy_variant() {
        let value = serde_json::json!({ "kind": "free", "x": 0.34375, "y": 0.25 });
        assert_eq!(
            serde_json::from_value::<LauncherAnchor>(value).unwrap(),
            LauncherAnchor::LegacyFree {
                x: 0.34375,
                y: 0.25
            }
        );
    }

    #[test]
    fn sanitize_clamps_a_legacy_anchor_without_promoting_it() {
        let anchor = LauncherAnchor::LegacyFree { x: -0.5, y: 1.5 }.sanitized();
        assert_eq!(anchor, LauncherAnchor::LegacyFree { x: 0.0, y: 1.0 });
    }

    #[test]
    fn sanitize_replaces_a_non_finite_legacy_anchor_with_the_default() {
        let anchor = LauncherAnchor::LegacyFree {
            x: f64::NAN,
            y: 0.5,
        }
        .sanitized();
        assert_eq!(anchor, LauncherAnchor::default());
    }

    #[test]
    fn serializes_with_a_tagged_anchor() {
        let json = serde_json::to_value(LauncherPlacement::default()).unwrap();
        assert_eq!(json["monitor"], "cursor");
        assert_eq!(json["anchor"]["kind"], "topWeighted");
        assert_eq!(json["anchor"]["bias"], 0.16);
    }

    #[test]
    fn round_trips_a_free_anchor() {
        let p = LauncherPlacement {
            monitor: LauncherMonitorChoice::Primary,
            anchor: LauncherAnchor::Free { x: 0.25, y: 0.4 },
            snap_enabled: true,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(serde_json::from_str::<LauncherPlacement>(&json).unwrap(), p);
    }

    #[test]
    fn default_placement_has_snapping_enabled() {
        // A derived `Default` would silently give this `false` (bool's own
        // default) — this test exists specifically to catch that footgun if
        // `LauncherPlacement` is ever switched back to `#[derive(Default)]`.
        assert!(LauncherPlacement::default().snap_enabled);
    }

    #[test]
    fn serializes_snap_enabled() {
        let json = serde_json::to_value(LauncherPlacement::default()).unwrap();
        assert_eq!(json["snapEnabled"], true);
    }
}
