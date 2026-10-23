//! Ordering of a presentation-gated launcher resize (compact ↔ expanded).
//!
//! A launcher resize moves two heights that reach the screen through
//! different channels:
//!
//! - the **window height** — the NSWindow frame, top edge pinned. Because
//!   Cocoa anchors window content at the bottom-left, a top-pinned resize
//!   also moves the frame origin, and that geometry travels to WindowServer
//!   separately from the layer tree.
//! - the **visible height** — a CA crop of the static 480pt surface. It is
//!   plain layer state and ships inside whatever CATransaction sets it.
//!
//! WebKit's swap to the new view only becomes observable inside the CA commit
//! that carries it, which is why the commit sentinel resizes from that
//! commit's pre-commit phase. AppKit cannot synchronize a frame change issued
//! from there, though: the layer tree it resized ships with the swap, while
//! the window-server frame lands a refresh later about as often as not. For
//! that refresh the new content is composited at the *old* origin — the
//! 480pt view hangs upward from the compact bottom edge on a grow, and the
//! compact bar drops to the bottom of the old 480pt frame on a shrink (#906).
//!
//! So the swap moves only the crop, and every frame change happens outside a
//! commit, where AppKit keeps it atomic with the layer tree. The window grows
//! before the swap, hidden behind the unchanged crop, and shrinks after it,
//! once the crop already shows the compact view. Throughout, the window
//! covers what is visible, so each step is invisible on its own.

/// The two heights a launcher resize moves. `set_window_height` must only
/// be called outside a CA commit; `set_visible_height` is safe anywhere.
pub trait LauncherSurface {
    fn window_height(&self) -> f64;
    fn visible_height(&self) -> f64;
    fn set_window_height(&mut self, height: f64);
    fn set_visible_height(&mut self, height: f64);
}

/// Shows only the top `visible` points of a `window`-tall frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Crop {
    pub window: f64,
    pub visible: f64,
}

/// The native operations behind a [`CroppedWindow`].
pub trait WindowBackend {
    fn frame_height(&self) -> f64;
    /// Top-pinned frame change; only outside a CA commit.
    fn set_frame_height(&mut self, height: f64);
    /// `None` shows the whole frame.
    fn set_crop(&mut self, crop: Option<Crop>);
}

/// The production [`LauncherSurface`]: a window frame plus a crop.
pub struct CroppedWindow<B> {
    pub backend: B,
    crop: Option<f64>,
}

impl<B: WindowBackend> CroppedWindow<B> {
    pub fn new(backend: B, crop: Option<f64>) -> Self {
        Self { backend, crop }
    }

    pub fn crop(&self) -> Option<f64> {
        self.crop
    }

    fn show(&mut self, window: f64, visible: f64) {
        self.crop = (visible < window).then_some(visible);
        self.backend
            .set_crop(self.crop.map(|visible| Crop { window, visible }));
    }
}

impl<B: WindowBackend> LauncherSurface for CroppedWindow<B> {
    fn window_height(&self) -> f64 {
        self.backend.frame_height()
    }

    fn visible_height(&self) -> f64 {
        self.crop.unwrap_or_else(|| self.window_height())
    }

    fn set_window_height(&mut self, height: f64) {
        // Read before the frame moves: with no crop, the visible height *is*
        // the frame height, and a grow must keep showing the old one.
        let visible = self.visible_height();
        self.backend.set_frame_height(height);
        self.show(height, visible);
    }

    fn set_visible_height(&mut self, height: f64) {
        let window = self.window_height();
        self.show(window, height);
    }
}

/// Runs when the resize is requested, outside any commit: a grow takes the
/// window to its new height now, behind the current crop.
pub fn prepare(surface: &mut impl LauncherSurface, target: f64) {
    if target > surface.window_height() {
        surface.set_window_height(target);
    }
}

/// Runs inside the paint-swap transaction and touches only the crop.
/// Returns true when the window is now taller than what it shows and must
/// [`settle`] on a later turn.
pub fn present(surface: &mut impl LauncherSurface, target: f64) -> bool {
    surface.set_visible_height(target);
    surface.window_height() > target
}

/// Runs on a later turn, outside any commit: fits the window to the crop.
/// Shrinking to the *visible* height (not a captured target) means a settle
/// that outlived a newer, taller presentation is a no-op.
pub fn settle(surface: &mut impl LauncherSurface) {
    let visible = surface.visible_height();
    if surface.window_height() > visible {
        surface.set_window_height(visible);
    }
}

/// Applies both heights outside any commit (hidden window, watchdog), in the
/// order that keeps the window covering the visible region.
pub fn apply_now(surface: &mut impl LauncherSurface, target: f64) {
    prepare(surface, target);
    surface.set_visible_height(target);
    settle(surface);
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMPACT: f64 = 96.0;
    const EXPANDED: f64 = 480.0;

    #[derive(Clone, Copy, Debug, PartialEq)]
    enum Phase {
        Prepare,
        Swap,
        Settle,
    }

    #[derive(Debug, PartialEq)]
    enum Op {
        Window(f64),
        Visible(f64),
    }

    /// Records every height change with the phase it ran in, and checks after
    /// each one that the window still covers what is visible.
    struct FakeSurface {
        window: f64,
        visible: f64,
        phase: Phase,
        ops: Vec<(Phase, Op)>,
    }

    impl FakeSurface {
        fn at(height: f64) -> Self {
            Self {
                window: height,
                visible: height,
                phase: Phase::Prepare,
                ops: Vec::new(),
            }
        }

        fn assert_window_covers_visible(&self) {
            assert!(
                self.window >= self.visible,
                "window {} is shorter than the visible region {}",
                self.window,
                self.visible
            );
        }

        fn window_ops_in(&self, phase: Phase) -> Vec<f64> {
            self.ops
                .iter()
                .filter_map(|(p, op)| match op {
                    Op::Window(h) if *p == phase => Some(*h),
                    _ => None,
                })
                .collect()
        }
    }

    impl LauncherSurface for FakeSurface {
        fn window_height(&self) -> f64 {
            self.window
        }
        fn visible_height(&self) -> f64 {
            self.visible
        }
        fn set_window_height(&mut self, height: f64) {
            self.window = height;
            self.ops.push((self.phase, Op::Window(height)));
            self.assert_window_covers_visible();
        }
        fn set_visible_height(&mut self, height: f64) {
            self.visible = height;
            self.ops.push((self.phase, Op::Visible(height)));
            self.assert_window_covers_visible();
        }
    }

    /// Drives one gated resize through all three phases, the way the commit
    /// sentinel does: prepare at request time, present inside the paint-swap
    /// transaction, settle on a later turn if present asked for it.
    fn run_gated(surface: &mut FakeSurface, target: f64) {
        surface.phase = Phase::Prepare;
        prepare(surface, target);
        surface.phase = Phase::Swap;
        let needs_settle = present(surface, target);
        if needs_settle {
            surface.phase = Phase::Settle;
            settle(surface);
        }
    }

    // #906: AppKit cannot synchronize a window-server frame change issued
    // from inside a CA commit, so a `setFrame:` there reaches the screen a
    // refresh apart from the layer tree it resized — the new content flashes
    // anchored at the old origin. Inside the swap only the CA crop may move.
    #[test]
    fn grow_never_changes_the_window_frame_inside_the_paint_swap() {
        let mut surface = FakeSurface::at(COMPACT);
        run_gated(&mut surface, EXPANDED);
        assert_eq!(surface.window_ops_in(Phase::Swap), Vec::<f64>::new());
        assert_eq!(surface.window_ops_in(Phase::Prepare), vec![EXPANDED]);
        assert_eq!((surface.window, surface.visible), (EXPANDED, EXPANDED));
    }

    #[test]
    fn shrink_never_changes_the_window_frame_inside_the_paint_swap() {
        let mut surface = FakeSurface::at(EXPANDED);
        run_gated(&mut surface, COMPACT);
        assert_eq!(surface.window_ops_in(Phase::Swap), Vec::<f64>::new());
        assert_eq!(surface.window_ops_in(Phase::Settle), vec![COMPACT]);
        assert_eq!((surface.window, surface.visible), (COMPACT, COMPACT));
    }

    #[test]
    fn grow_keeps_the_compact_crop_until_the_swap() {
        let mut surface = FakeSurface::at(COMPACT);
        prepare(&mut surface, EXPANDED);
        assert_eq!((surface.window, surface.visible), (EXPANDED, COMPACT));
    }

    #[test]
    fn rapid_alternation_keeps_every_frame_change_outside_the_swap() {
        let mut surface = FakeSurface::at(COMPACT);
        for _ in 0..6 {
            run_gated(&mut surface, EXPANDED);
            run_gated(&mut surface, COMPACT);
        }
        assert_eq!(surface.window_ops_in(Phase::Swap), Vec::<f64>::new());
        assert_eq!((surface.window, surface.visible), (COMPACT, COMPACT));
    }

    // A grow whose swap never came (Backspace landed first) leaves the window
    // tall behind a compact crop; the reversal must not need a swap to settle.
    #[test]
    fn reversal_before_the_grow_swap_settles_back_to_compact() {
        let mut surface = FakeSurface::at(COMPACT);
        prepare(&mut surface, EXPANDED);
        run_gated(&mut surface, COMPACT);
        assert_eq!(surface.window_ops_in(Phase::Swap), Vec::<f64>::new());
        assert_eq!((surface.window, surface.visible), (COMPACT, COMPACT));
    }

    // A settle left over from an older shrink must not cut the window below
    // a taller region presented since.
    #[test]
    fn stale_settle_never_shrinks_below_the_visible_region() {
        let mut surface = FakeSurface::at(EXPANDED);
        prepare(&mut surface, COMPACT);
        assert!(present(&mut surface, COMPACT));
        run_gated(&mut surface, EXPANDED);
        settle(&mut surface);
        assert_eq!((surface.window, surface.visible), (EXPANDED, EXPANDED));
    }

    #[test]
    fn apply_now_keeps_the_window_covering_the_visible_region_both_ways() {
        let mut surface = FakeSurface::at(EXPANDED);
        apply_now(&mut surface, COMPACT);
        assert_eq!((surface.window, surface.visible), (COMPACT, COMPACT));
        apply_now(&mut surface, EXPANDED);
        assert_eq!((surface.window, surface.visible), (EXPANDED, EXPANDED));
    }

    // ── CroppedWindow: the production surface over a native backend ────────

    #[derive(Debug, PartialEq)]
    enum NativeOp {
        Frame(f64),
        Crop(Option<Crop>),
    }

    /// Stands in for the NSWindow: a frame height plus the mask it shows.
    struct FakeBackend {
        frame: f64,
        crop: Option<Crop>,
        ops: Vec<NativeOp>,
    }

    impl FakeBackend {
        fn at(height: f64) -> Self {
            Self {
                frame: height,
                crop: None,
                ops: Vec::new(),
            }
        }

        /// What the user sees: the whole frame, or the top of it the crop keeps.
        fn shown(&self) -> f64 {
            self.crop.map_or(self.frame, |c| c.visible)
        }
    }

    impl WindowBackend for FakeBackend {
        fn frame_height(&self) -> f64 {
            self.frame
        }
        fn set_frame_height(&mut self, height: f64) {
            self.frame = height;
            self.ops.push(NativeOp::Frame(height));
        }
        fn set_crop(&mut self, crop: Option<Crop>) {
            self.crop = crop;
            self.ops.push(NativeOp::Crop(crop));
        }
    }

    // The window grows at request time, before WebKit has painted the new
    // view; what the user sees must not grow with it.
    #[test]
    fn growing_the_window_keeps_showing_only_what_was_visible() {
        let mut window = CroppedWindow::new(FakeBackend::at(COMPACT), None);
        prepare(&mut window, EXPANDED);
        assert_eq!(window.backend.frame, EXPANDED);
        assert_eq!(window.backend.shown(), COMPACT);
        assert_eq!(window.visible_height(), COMPACT);
    }

    #[test]
    fn the_swap_reveals_a_grown_window_by_dropping_the_crop_alone() {
        let mut window = CroppedWindow::new(FakeBackend::at(COMPACT), None);
        prepare(&mut window, EXPANDED);
        window.backend.ops.clear();
        assert!(!present(&mut window, EXPANDED));
        assert_eq!(window.backend.ops, vec![NativeOp::Crop(None)]);
        assert_eq!(window.backend.shown(), EXPANDED);
    }

    #[test]
    fn the_swap_crops_a_shrink_and_the_settle_fits_the_frame() {
        let mut window = CroppedWindow::new(FakeBackend::at(EXPANDED), None);
        prepare(&mut window, COMPACT);
        assert!(window.backend.ops.is_empty());
        assert!(present(&mut window, COMPACT));
        assert_eq!(
            window.backend.ops,
            vec![NativeOp::Crop(Some(Crop {
                window: EXPANDED,
                visible: COMPACT
            }))]
        );
        assert_eq!(window.backend.shown(), COMPACT);
        settle(&mut window);
        assert_eq!((window.backend.frame, window.backend.crop), (COMPACT, None));
    }

    // The crop outlives a single call: the NSWindow wrapper is rebuilt for
    // every step, so the visible height must round-trip through `crop()`.
    #[test]
    fn the_crop_round_trips_between_steps() {
        let mut window = CroppedWindow::new(FakeBackend::at(COMPACT), None);
        prepare(&mut window, EXPANDED);
        let carried = window.crop();
        let window = CroppedWindow::new(window.backend, carried);
        assert_eq!(window.visible_height(), COMPACT);
    }
}
