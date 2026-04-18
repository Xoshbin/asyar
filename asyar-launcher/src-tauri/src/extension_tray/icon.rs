//! Pure icon-path parsing + resolution.
//!
//! Two accepted shapes for `iconPath`:
//!   * `asyar-extension://{extensionId}/relative/path/to/image.png` — resolved
//!     against the extension's bundle/install dir via the `ExtensionDirLookup`.
//!   * An absolute filesystem path (`starts_with('/')` on unix, `X:\` on
//!     windows) — returned verbatim.
//!
//! Anything else (HTTP URLs, relative paths, empty strings) is rejected so
//! extensions can't point the tray at arbitrary remote resources.

use crate::error::AppError;
use std::path::{Path, PathBuf};

const EXT_SCHEME: &str = "asyar-extension://";

#[derive(Debug, Clone, PartialEq)]
pub enum IconSpec {
    /// `asyar-extension://{ext_id}/{rel}` — the host must resolve `ext_id`
    /// to its base directory and join `rel` onto it.
    Extension {
        ext_id: String,
        rel_path: String,
    },
    /// Absolute filesystem path supplied by the extension.
    Absolute(PathBuf),
}

/// Look up an extension's base directory on disk. Implementations return
/// the directory under which the extension's assets live (where relative
/// paths from `asyar-extension://` URIs are resolved).
pub trait ExtensionDirLookup {
    fn base_dir(&self, extension_id: &str) -> Option<PathBuf>;
}

pub fn parse_spec(spec: &str) -> Result<IconSpec, AppError> {
    if spec.is_empty() {
        return Err(AppError::Validation("iconPath must not be empty".into()));
    }

    if let Some(rest) = spec.strip_prefix(EXT_SCHEME) {
        let (ext_id, rel_path) = rest
            .split_once('/')
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "asyar-extension:// iconPath '{spec}' is missing the relative file path"
                ))
            })?;
        if ext_id.is_empty() {
            return Err(AppError::Validation(format!(
                "asyar-extension:// iconPath '{spec}' has an empty extension id"
            )));
        }
        if rel_path.is_empty() {
            return Err(AppError::Validation(format!(
                "asyar-extension:// iconPath '{spec}' has an empty file path"
            )));
        }
        return Ok(IconSpec::Extension {
            ext_id: ext_id.to_string(),
            rel_path: rel_path.to_string(),
        });
    }

    // Reject any other URI scheme (http, https, file, data, etc.).
    if let Some(scheme_end) = spec.find("://") {
        let scheme = &spec[..scheme_end];
        return Err(AppError::Validation(format!(
            "Unsupported iconPath scheme '{scheme}://'; use asyar-extension:// or an absolute path"
        )));
    }

    let p = Path::new(spec);
    if !p.is_absolute() {
        return Err(AppError::Validation(format!(
            "iconPath '{spec}' must be an absolute path or an asyar-extension:// URI"
        )));
    }

    Ok(IconSpec::Absolute(p.to_path_buf()))
}

pub fn resolve(
    spec: &str,
    lookup: &dyn ExtensionDirLookup,
) -> Result<PathBuf, AppError> {
    match parse_spec(spec)? {
        IconSpec::Absolute(path) => Ok(path),
        IconSpec::Extension { ext_id, rel_path } => {
            if rel_path.split('/').any(|seg| seg == "..") {
                return Err(AppError::Validation(format!(
                    "iconPath '{spec}' contains a parent-directory traversal"
                )));
            }
            let base = lookup.base_dir(&ext_id).ok_or_else(|| {
                AppError::NotFound(format!(
                    "iconPath references missing extension '{ext_id}'"
                ))
            })?;
            Ok(base.join(rel_path))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeLookup {
        map: HashMap<String, PathBuf>,
    }
    impl ExtensionDirLookup for FakeLookup {
        fn base_dir(&self, extension_id: &str) -> Option<PathBuf> {
            self.map.get(extension_id).cloned()
        }
    }
    fn fake(pairs: &[(&str, &str)]) -> FakeLookup {
        FakeLookup {
            map: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), PathBuf::from(v)))
                .collect(),
        }
    }

    // ── parse_spec ──────────────────────────────────────────────────────────

    #[test]
    fn parse_extension_scheme() {
        let spec = parse_spec("asyar-extension://coffee/icon.png").unwrap();
        assert_eq!(
            spec,
            IconSpec::Extension {
                ext_id: "coffee".into(),
                rel_path: "icon.png".into(),
            }
        );
    }

    #[test]
    fn parse_extension_nested_path() {
        let spec = parse_spec("asyar-extension://ext/assets/x/y.png").unwrap();
        assert_eq!(
            spec,
            IconSpec::Extension {
                ext_id: "ext".into(),
                rel_path: "assets/x/y.png".into(),
            }
        );
    }

    #[test]
    fn parse_absolute_unix_path() {
        #[cfg(unix)]
        {
            let spec = parse_spec("/Users/a/icon.png").unwrap();
            assert_eq!(spec, IconSpec::Absolute(PathBuf::from("/Users/a/icon.png")));
        }
    }

    #[test]
    fn parse_absolute_windows_path() {
        #[cfg(windows)]
        {
            let spec = parse_spec("C:\\icons\\icon.png").unwrap();
            assert_eq!(
                spec,
                IconSpec::Absolute(PathBuf::from("C:\\icons\\icon.png"))
            );
        }
    }

    #[test]
    fn parse_rejects_empty() {
        assert!(parse_spec("").is_err());
    }

    #[test]
    fn parse_rejects_http_url() {
        let err = parse_spec("https://example.com/x.png").unwrap_err();
        assert!(err.to_string().to_lowercase().contains("scheme"));
    }

    #[test]
    fn parse_rejects_file_url() {
        let err = parse_spec("file:///x.png").unwrap_err();
        assert!(err.to_string().to_lowercase().contains("scheme"));
    }

    #[test]
    fn parse_rejects_relative_path() {
        let err = parse_spec("relative/icon.png").unwrap_err();
        assert!(
            err.to_string().to_lowercase().contains("relative")
                || err.to_string().to_lowercase().contains("absolute")
        );
    }

    #[test]
    fn parse_extension_rejects_missing_path() {
        let err = parse_spec("asyar-extension://ext-only").unwrap_err();
        assert!(err.to_string().to_lowercase().contains("path"));
    }

    #[test]
    fn parse_extension_rejects_empty_ext_id() {
        assert!(parse_spec("asyar-extension:///icon.png").is_err());
    }

    // ── resolve ─────────────────────────────────────────────────────────────

    #[test]
    fn resolve_extension_scheme_joins_base_dir() {
        let lookup = fake(&[("my-ext", "/tmp/exts/my-ext")]);
        let path = resolve("asyar-extension://my-ext/icon.png", &lookup).unwrap();
        assert_eq!(path, PathBuf::from("/tmp/exts/my-ext/icon.png"));
    }

    #[test]
    fn resolve_extension_scheme_joins_nested() {
        let lookup = fake(&[("x", "/a/b/x")]);
        let path = resolve("asyar-extension://x/d/e/f.png", &lookup).unwrap();
        assert_eq!(path, PathBuf::from("/a/b/x/d/e/f.png"));
    }

    #[test]
    fn resolve_extension_scheme_unknown_extension_errors() {
        let lookup = fake(&[]);
        let err = resolve("asyar-extension://missing/x.png", &lookup).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("missing"));
    }

    #[test]
    fn resolve_absolute_path_passthrough() {
        #[cfg(unix)]
        {
            let lookup = fake(&[]);
            let path = resolve("/opt/share/icon.png", &lookup).unwrap();
            assert_eq!(path, PathBuf::from("/opt/share/icon.png"));
        }
    }

    #[test]
    fn resolve_rejects_traversal_in_relpath() {
        let lookup = fake(&[("ext", "/tmp/ext")]);
        let err = resolve("asyar-extension://ext/../escape.png", &lookup).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("traversal"));
    }
}
