use objc2::rc::Retained;
use objc2_app_kit::NSPasteboard;
use objc2_foundation::{NSArray, NSString};

/// Read the current pasteboard's type identifiers from `NSPasteboard.general`.
///
/// Returns an empty vector if the pasteboard has no contents or its types
/// cannot be read. The classifier in [`super`] uses these strings to detect
/// `org.nspasteboard.*` flags set by password managers.
pub fn read_pasteboard_types() -> Vec<String> {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let Some(types) = pb.types() else {
            return Vec::new();
        };
        let types: Retained<NSArray<NSString>> = types;
        let mut out = Vec::with_capacity(types.len());
        for t in types {
            let t: Retained<NSString> = t;
            out.push(t.to_string());
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_app_kit::NSPasteboardTypeString;

    #[test]
    #[ignore = "interacts with the system pasteboard; run manually with --ignored"]
    fn read_pasteboard_types_returns_text_type_after_writing_text() {
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            let s = NSString::from_str("hello");
            pb.setString_forType(&s, NSPasteboardTypeString);
        }

        let types = read_pasteboard_types();
        assert!(
            types
                .iter()
                .any(|t| t.contains("string") || t.contains("utf8-plain-text")),
            "expected a text pasteboard type in {types:?}"
        );
    }
}
