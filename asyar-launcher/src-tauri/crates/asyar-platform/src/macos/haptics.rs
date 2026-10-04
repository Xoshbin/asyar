//! Trackpad haptic feedback for magnetic snapping.

use objc2_app_kit::{
    NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
    NSHapticFeedbackPerformer,
};

/// Fires a subtle "alignment" haptic tick on the built-in Force Touch
/// trackpad — the same pattern apps like Sketch and Keynote use for
/// snap-to-guide feedback. Silently does nothing on a Mac without a
/// Force Touch trackpad (`performFeedbackPattern:performanceTime:`
/// handles that itself); no error to propagate.
pub fn perform_alignment_haptic() {
    unsafe {
        let performer = NSHapticFeedbackManager::defaultPerformer();
        performer.performFeedbackPattern_performanceTime(
            NSHapticFeedbackPattern::Alignment,
            NSHapticFeedbackPerformanceTime::Default,
        );
    }
}
