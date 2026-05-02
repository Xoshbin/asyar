/// Linux clipboard pasteboard-flag detection is not implemented.
///
/// Neither X11 nor Wayland defines a widely-honored "do-not-capture" flag
/// equivalent to macOS's `org.nspasteboard.*` family or Windows's
/// `CanIncludeInClipboardHistory`. Source-app denylist filtering still
/// applies on Linux.
pub fn read_pasteboard_types() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_pasteboard_types_returns_empty_on_linux() {
        assert!(read_pasteboard_types().is_empty());
    }
}
