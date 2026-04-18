//! Menu-item id path encoding.
//!
//! Each native menu-item id carries the full path back to the owning
//! extension so `on_menu_event` can route the click without a side lookup
//! table. Wire format: `"{extensionId}:{topId}:{childId}:...:{leafId}"`.
//!
//! Item IDs MUST NOT contain the path separator; validation enforces this
//! client-side in the SDK proxy as well as here.

use crate::error::AppError;

pub const SEPARATOR: char = ':';

/// Build the native menu-item id from the extension id and the chain of
/// status-bar item ids from the top level down to the leaf.
pub fn encode(extension_id: &str, path: &[&str]) -> Result<String, AppError> {
    if extension_id.is_empty() {
        return Err(AppError::Validation(
            "Tray path encoding requires a non-empty extensionId".into(),
        ));
    }
    if path.is_empty() {
        return Err(AppError::Validation(
            "Tray path encoding requires at least one item id".into(),
        ));
    }
    if extension_id.contains(SEPARATOR) {
        return Err(AppError::Validation(format!(
            "Extension id '{extension_id}' contains the path separator '{SEPARATOR}'"
        )));
    }
    for segment in path {
        if segment.is_empty() {
            return Err(AppError::Validation(
                "Tray path segment must not be empty".into(),
            ));
        }
        if segment.contains(SEPARATOR) {
            return Err(AppError::Validation(format!(
                "Tray path segment '{segment}' contains the path separator '{SEPARATOR}'"
            )));
        }
    }

    let mut buf = String::with_capacity(
        extension_id.len() + path.iter().map(|s| s.len() + 1).sum::<usize>(),
    );
    buf.push_str(extension_id);
    for segment in path {
        buf.push(SEPARATOR);
        buf.push_str(segment);
    }
    Ok(buf)
}

/// Parse a native menu-item id back into its `(extensionId, itemPath)` parts.
pub fn decode(encoded: &str) -> Result<(String, Vec<String>), AppError> {
    let mut parts = encoded.split(SEPARATOR);
    let extension_id = parts
        .next()
        .ok_or_else(|| AppError::Validation("Empty tray menu-item id".into()))?;
    if extension_id.is_empty() {
        return Err(AppError::Validation(format!(
            "Invalid tray menu-item id '{encoded}': missing extension segment"
        )));
    }
    let path: Vec<String> = parts.map(|s| s.to_string()).collect();
    if path.is_empty() {
        return Err(AppError::Validation(format!(
            "Invalid tray menu-item id '{encoded}': missing item path"
        )));
    }
    if path.iter().any(|s| s.is_empty()) {
        return Err(AppError::Validation(format!(
            "Invalid tray menu-item id '{encoded}': empty path segment"
        )));
    }
    Ok((extension_id.to_string(), path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_one_level() {
        assert_eq!(encode("ext", &["t1"]).unwrap(), "ext:t1");
    }

    #[test]
    fn encode_two_levels() {
        assert_eq!(encode("ext", &["t1", "c1"]).unwrap(), "ext:t1:c1");
    }

    #[test]
    fn encode_three_levels() {
        assert_eq!(
            encode("coffee-pot", &["timer", "submenu", "30m"]).unwrap(),
            "coffee-pot:timer:submenu:30m"
        );
    }

    #[test]
    fn encode_four_levels() {
        assert_eq!(
            encode("ext", &["a", "b", "c", "d"]).unwrap(),
            "ext:a:b:c:d"
        );
    }

    #[test]
    fn encode_rejects_empty_path() {
        assert!(encode("ext", &[]).is_err());
    }

    #[test]
    fn encode_rejects_empty_extension_id() {
        assert!(encode("", &["t1"]).is_err());
    }

    #[test]
    fn encode_rejects_colon_in_item_id() {
        let err = encode("ext", &["has:colon"]).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("separator"));
    }

    #[test]
    fn encode_rejects_colon_in_extension_id() {
        let err = encode("ext:bad", &["t1"]).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("separator"));
    }

    #[test]
    fn decode_one_level() {
        let (ext, path) = decode("ext:t1").unwrap();
        assert_eq!(ext, "ext");
        assert_eq!(path, vec!["t1".to_string()]);
    }

    #[test]
    fn decode_four_levels() {
        let (ext, path) = decode("org.asyar.pomodoro:top:mid:low:leaf").unwrap();
        assert_eq!(ext, "org.asyar.pomodoro");
        assert_eq!(path, vec!["top", "mid", "low", "leaf"]);
    }

    #[test]
    fn decode_rejects_missing_item_path() {
        let err = decode("ext-only").unwrap_err();
        assert!(err.to_string().to_lowercase().contains("invalid"));
    }

    #[test]
    fn decode_rejects_empty_extension_segment() {
        assert!(decode(":t1").is_err());
    }

    #[test]
    fn decode_rejects_empty_item_segment() {
        assert!(decode("ext:t1::leaf").is_err());
    }

    #[test]
    fn round_trip_preserves_path() {
        let orig_ext = "ext-x";
        let orig_path = ["coffee-pot", "timer", "30m"];
        let encoded = encode(orig_ext, &orig_path).unwrap();
        let (ext, path) = decode(&encoded).unwrap();
        assert_eq!(ext, orig_ext);
        assert_eq!(
            path,
            orig_path.iter().map(|s| s.to_string()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn round_trip_one_level() {
        let encoded = encode("ext", &["only"]).unwrap();
        let (ext, path) = decode(&encoded).unwrap();
        assert_eq!(ext, "ext");
        assert_eq!(path, vec!["only".to_string()]);
    }

    #[test]
    fn round_trip_four_levels() {
        let encoded = encode("ext", &["a", "b", "c", "d"]).unwrap();
        let (ext, path) = decode(&encoded).unwrap();
        assert_eq!(ext, "ext");
        assert_eq!(path, vec!["a", "b", "c", "d"]);
    }
}
