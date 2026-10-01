use std::borrow::Cow;
use std::time::Duration;

/// Represents a preserved clipboard state across different data types.
#[derive(Debug, Clone)]
pub enum ClipboardSnapshot {
    Text(String),
    Image(arboard::ImageData<'static>),
    Empty,
}

impl PartialEq for ClipboardSnapshot {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Text(a), Self::Text(b)) => a == b,
            (Self::Image(a), Self::Image(b)) => {
                a.width == b.width && a.height == b.height && a.bytes == b.bytes
            }
            (Self::Empty, Self::Empty) => true,
            _ => false,
        }
    }
}

/// A RAII guard that snapshots the clipboard on creation and restores it on drop.
///
/// Multi-format aware: captures both text and image payloads without clobbering
/// non-text content during synthetic copy chords (e.g. Ctrl+C selection queries).
pub struct ClipboardGuard {
    pub(crate) snapshot: ClipboardSnapshot,
}

impl Default for ClipboardGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl ClipboardGuard {
    /// Creates a new `ClipboardGuard` by snapshotting the current clipboard contents.
    pub fn new() -> Self {
        Self {
            snapshot: Self::capture_snapshot(),
        }
    }

    /// Access the captured snapshot payload.
    pub fn snapshot(&self) -> &ClipboardSnapshot {
        &self.snapshot
    }

    /// Construct a guard with an explicit snapshot (useful for testing or staged restoration).
    pub fn from_snapshot(snapshot: ClipboardSnapshot) -> Self {
        Self { snapshot }
    }

    /// Attempts to capture the current clipboard contents with default retry settings.
    pub fn capture_snapshot() -> ClipboardSnapshot {
        Self::capture_snapshot_with_retries(5, Duration::from_millis(5))
    }

    /// Attempts to capture the current clipboard contents with specified retries and delay.
    ///
    /// Retries handle transient lock contention (e.g. Windows `OpenClipboard` or X11/Wayland busyness).
    pub fn capture_snapshot_with_retries(
        max_attempts: usize,
        delay: Duration,
    ) -> ClipboardSnapshot {
        for attempt in 0..max_attempts {
            if let Ok(mut cb) = arboard::Clipboard::new() {
                // Priority 1: Check text
                if let Ok(text) = cb.get_text() {
                    return ClipboardSnapshot::Text(text);
                }

                // Priority 2: Check image
                if let Ok(image) = cb.get_image() {
                    let owned = arboard::ImageData {
                        width: image.width,
                        height: image.height,
                        bytes: Cow::Owned(image.bytes.into_owned()),
                    };
                    return ClipboardSnapshot::Image(owned);
                }

                // Clipboard is open and accessible, but contains neither text nor image
                return ClipboardSnapshot::Empty;
            }

            if attempt + 1 < max_attempts {
                std::thread::sleep(delay);
            }
        }

        // Fallback gracefully to Empty if clipboard could not be opened
        ClipboardSnapshot::Empty
    }

    /// Restores a snapshot to the system clipboard with default retry settings.
    pub fn restore_snapshot(snapshot: &ClipboardSnapshot) {
        Self::restore_snapshot_with_retries(snapshot, 5, Duration::from_millis(10));
    }

    /// Restores a snapshot with retry logic to handle temporary clipboard locking.
    ///
    /// Never panics; silently handles failure to guarantee exception-safety during `drop()`.
    pub fn restore_snapshot_with_retries(
        snapshot: &ClipboardSnapshot,
        max_attempts: usize,
        delay: Duration,
    ) {
        for attempt in 0..max_attempts {
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let res = match snapshot {
                    ClipboardSnapshot::Text(text) => cb.set_text(text.clone()),
                    ClipboardSnapshot::Image(image) => cb.set_image(image.clone()),
                    ClipboardSnapshot::Empty => cb.clear(),
                };

                if res.is_ok() {
                    return;
                }
            }

            if attempt + 1 < max_attempts {
                std::thread::sleep(delay);
            }
        }
    }
}

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        Self::restore_snapshot(&self.snapshot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn acquire_test_lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Checks if the operating system clipboard service is available and functional.
    ///
    /// Headless environments (like standard Linux CI containers without X11/Wayland display servers)
    /// cannot connect to a clipboard daemon, so live tests must skip gracefully.
    fn is_clipboard_functional() -> bool {
        let mut cb = match arboard::Clipboard::new() {
            Ok(cb) => cb,
            Err(_) => return false,
        };
        if cb.set_text("__asyar_clipboard_probe__").is_err() {
            return false;
        }
        cb.get_text().is_ok()
    }

    fn create_test_image(
        width: usize,
        height: usize,
        r: u8,
        g: u8,
        b: u8,
        a: u8,
    ) -> arboard::ImageData<'static> {
        let mut bytes = Vec::with_capacity(width * height * 4);
        for _ in 0..(width * height) {
            bytes.extend_from_slice(&[r, g, b, a]);
        }
        arboard::ImageData {
            width,
            height,
            bytes: Cow::Owned(bytes),
        }
    }

    #[test]
    fn test_clipboard_snapshot_partial_eq() {
        let text1 = ClipboardSnapshot::Text("hello".to_string());
        let text2 = ClipboardSnapshot::Text("hello".to_string());
        let text3 = ClipboardSnapshot::Text("world".to_string());
        assert_eq!(text1, text2);
        assert_ne!(text1, text3);

        let img1 = ClipboardSnapshot::Image(create_test_image(2, 2, 255, 0, 0, 255));
        let img2 = ClipboardSnapshot::Image(create_test_image(2, 2, 255, 0, 0, 255));
        let img3 = ClipboardSnapshot::Image(create_test_image(2, 2, 0, 255, 0, 255));
        assert_eq!(img1, img2);
        assert_ne!(img1, img3);
        assert_ne!(text1, img1);

        assert_eq!(ClipboardSnapshot::Empty, ClipboardSnapshot::Empty);
        assert_ne!(ClipboardSnapshot::Empty, text1);
        assert_ne!(ClipboardSnapshot::Empty, img1);
    }

    #[test]
    fn test_clipboard_guard_from_snapshot_accessors() {
        let _lock = acquire_test_lock();

        let explicit_text = ClipboardSnapshot::Text("unit_test".to_string());
        let guard = ClipboardGuard::from_snapshot(explicit_text.clone());
        assert_eq!(guard.snapshot(), &explicit_text);

        let explicit_img = ClipboardSnapshot::Image(create_test_image(1, 1, 10, 20, 30, 255));
        let img_guard = ClipboardGuard::from_snapshot(explicit_img.clone());
        assert_eq!(img_guard.snapshot(), &explicit_img);
    }

    #[test]
    fn test_clipboard_guard_from_snapshot_and_drop() {
        let _lock = acquire_test_lock();

        if !is_clipboard_functional() {
            eprintln!("Skipping live clipboard test: display/clipboard service unavailable in headless environment");
            return;
        }

        // Preserve developer's current clipboard
        let original_snapshot = ClipboardGuard::capture_snapshot();

        // 1. Test Text snapshot restoration on drop
        let test_text = format!(
            "asyar_test_text_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        {
            let guard = ClipboardGuard::from_snapshot(ClipboardSnapshot::Text(test_text.clone()));
            assert_eq!(
                guard.snapshot(),
                &ClipboardSnapshot::Text(test_text.clone())
            );
            // Guard drops here and restores test_text
        }

        // Verify clipboard now contains test_text
        let current = ClipboardGuard::capture_snapshot();
        assert_eq!(current, ClipboardSnapshot::Text(test_text));

        // 2. Test Image snapshot restoration on drop
        let test_image = create_test_image(2, 2, 100, 150, 200, 255);
        {
            let guard = ClipboardGuard::from_snapshot(ClipboardSnapshot::Image(test_image.clone()));
            assert_eq!(
                guard.snapshot(),
                &ClipboardSnapshot::Image(test_image.clone())
            );
            // Guard drops here and restores test_image
        }

        // Verify clipboard now contains an image with the expected dimensions
        let current = ClipboardGuard::capture_snapshot();
        match current {
            ClipboardSnapshot::Image(img) => {
                assert_eq!(img.width, test_image.width);
                assert_eq!(img.height, test_image.height);
                assert_eq!(img.bytes.len(), test_image.bytes.len());
            }
            other => panic!("Expected Image snapshot, got {:?}", other),
        }

        // 3. Test Empty snapshot restoration on drop
        {
            let guard = ClipboardGuard::from_snapshot(ClipboardSnapshot::Empty);
            assert_eq!(guard.snapshot(), &ClipboardSnapshot::Empty);
            // Guard drops here and clears clipboard
        }

        let current = ClipboardGuard::capture_snapshot();
        assert_eq!(current, ClipboardSnapshot::Empty);

        // Restore original developer clipboard
        ClipboardGuard::restore_snapshot(&original_snapshot);
    }

    #[test]
    fn test_clipboard_guard_new_captures_and_restores_text() {
        let _lock = acquire_test_lock();

        if !is_clipboard_functional() {
            eprintln!("Skipping live clipboard test: display/clipboard service unavailable in headless environment");
            return;
        }

        let original_snapshot = ClipboardGuard::capture_snapshot();

        // Set text first
        let test_text = "asyar_snapshot_capture_verification".to_string();
        ClipboardGuard::restore_snapshot(&ClipboardSnapshot::Text(test_text.clone()));

        // Instantiate ClipboardGuard::new(), which should capture the text
        {
            let guard = ClipboardGuard::new();
            assert_eq!(
                guard.snapshot(),
                &ClipboardSnapshot::Text(test_text.clone())
            );

            // Now mutate the clipboard while the guard is alive (simulating copy chord)
            let mutated_text = "mutated_during_selection".to_string();
            ClipboardGuard::restore_snapshot(&ClipboardSnapshot::Text(mutated_text));

            // Guard drops at the end of this block
        }

        // Verify the original snapshot was restored on drop
        let restored = ClipboardGuard::capture_snapshot();
        assert_eq!(restored, ClipboardSnapshot::Text(test_text));

        // Restore original developer clipboard
        ClipboardGuard::restore_snapshot(&original_snapshot);
    }

    #[test]
    fn test_clipboard_guard_new_captures_and_restores_image() {
        let _lock = acquire_test_lock();

        if !is_clipboard_functional() {
            eprintln!("Skipping live clipboard test: display/clipboard service unavailable in headless environment");
            return;
        }

        let original_snapshot = ClipboardGuard::capture_snapshot();

        // Set image first
        let test_image = create_test_image(3, 3, 220, 110, 50, 255);
        ClipboardGuard::restore_snapshot(&ClipboardSnapshot::Image(test_image.clone()));

        // Instantiate ClipboardGuard::new(), which should capture the image
        {
            let guard = ClipboardGuard::new();
            match guard.snapshot() {
                ClipboardSnapshot::Image(img) => {
                    assert_eq!(img.width, test_image.width);
                    assert_eq!(img.height, test_image.height);
                }
                other => panic!("Expected Image snapshot in guard, got {:?}", other),
            }

            // Simulate selection copy chord writing text
            let selection_text = "selection_replaced_image".to_string();
            ClipboardGuard::restore_snapshot(&ClipboardSnapshot::Text(selection_text));

            // Guard drops at the end of this block
        }

        // Verify original image was restored
        let restored = ClipboardGuard::capture_snapshot();
        match restored {
            ClipboardSnapshot::Image(img) => {
                assert_eq!(img.width, test_image.width);
                assert_eq!(img.height, test_image.height);
            }
            other => panic!("Expected Image snapshot restored, got {:?}", other),
        }

        // Restore original developer clipboard
        ClipboardGuard::restore_snapshot(&original_snapshot);
    }

    #[test]
    fn test_clipboard_guard_empty_handling() {
        let _lock = acquire_test_lock();

        if !is_clipboard_functional() {
            eprintln!("Skipping live clipboard test: display/clipboard service unavailable in headless environment");
            return;
        }

        let original_snapshot = ClipboardGuard::capture_snapshot();

        // Clear clipboard
        ClipboardGuard::restore_snapshot(&ClipboardSnapshot::Empty);

        // Verify capture_snapshot returns Empty
        let snapshot = ClipboardGuard::capture_snapshot();
        assert_eq!(snapshot, ClipboardSnapshot::Empty);

        // Create guard from empty clipboard
        {
            let guard = ClipboardGuard::new();
            assert_eq!(guard.snapshot(), &ClipboardSnapshot::Empty);

            // Mutate clipboard to simulate copy chord
            ClipboardGuard::restore_snapshot(&ClipboardSnapshot::Text("temp text".to_string()));

            // Guard drops and should restore Empty
        }

        let restored = ClipboardGuard::capture_snapshot();
        assert_eq!(restored, ClipboardSnapshot::Empty);

        // Restore original developer clipboard
        ClipboardGuard::restore_snapshot(&original_snapshot);
    }

    #[test]
    fn test_clipboard_guard_retry_and_exception_safety() {
        let _lock = acquire_test_lock();

        // Test that 0 attempts doesn't panic and returns Empty
        let empty = ClipboardGuard::capture_snapshot_with_retries(0, Duration::from_millis(0));
        assert_eq!(empty, ClipboardSnapshot::Empty);

        // Test that restoring with 0 attempts doesn't panic
        ClipboardGuard::restore_snapshot_with_retries(
            &ClipboardSnapshot::Empty,
            0,
            Duration::from_millis(0),
        );
    }
}
