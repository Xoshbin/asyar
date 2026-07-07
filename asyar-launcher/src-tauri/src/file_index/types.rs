//! Core types for the file index.
//!
//! The index stores entries in a struct-of-arrays layout (see `index.rs`);
//! these are the shared primitives: the compact per-entry metadata record,
//! the extension classification, the wire shapes returned to the frontend,
//! and the work meter consumed by the perf regression tests.

use serde::{Deserialize, Serialize};

/// Sentinel for `EntryMeta.parent`: the entry is a scan root (no parent
/// entry in the index).
pub const NO_PARENT: u32 = u32::MAX;

/// File classification derived from the extension (dirs use `Folder`).
/// Stored as one byte in `EntryMeta.ext_class`; the kebab-case string form
/// is the wire contract with the view's type-filter dropdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
#[repr(u8)]
pub enum FileType {
    Document = 0,
    Image = 1,
    Code = 2,
    AudioVideo = 3,
    Archive = 4,
    Folder = 5,
    Other = 6,
}

impl FileType {
    pub fn from_extension(ext: &str) -> Self {
        let e = ext.to_ascii_lowercase();
        match e.as_str() {
            "pdf" | "docx" | "doc" | "xlsx" | "xls" | "pptx" | "ppt" | "txt" | "md" | "rtf"
            | "odt" => Self::Document,
            "png" | "jpg" | "jpeg" | "heic" | "webp" | "gif" | "bmp" | "tiff" | "svg" => {
                Self::Image
            }
            "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "kt" | "swift" | "c"
            | "cpp" | "h" | "hpp" | "rb" | "php" | "json" | "yaml" | "yml" | "toml" | "html"
            | "css" | "scss" | "sh" | "zsh" => Self::Code,
            "mp3" | "wav" | "flac" | "m4a" | "mp4" | "mov" | "mkv" | "webm" | "avi" => {
                Self::AudioVideo
            }
            "zip" | "tar" | "gz" | "bz2" | "xz" | "7z" | "rar" => Self::Archive,
            _ => Self::Other,
        }
    }

    /// Inverse of `as u8` for entries loaded from a snapshot. Unknown bytes
    /// decay to `Other` rather than failing the whole load.
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Document,
            1 => Self::Image,
            2 => Self::Code,
            3 => Self::AudioVideo,
            4 => Self::Archive,
            5 => Self::Folder,
            _ => Self::Other,
        }
    }

    /// Parses the wire filter string from the dropdown (`"document"`,
    /// `"audio-video"`, …). `None` for unknown strings so a stale frontend
    /// value degrades to "all" instead of erroring.
    pub fn parse_filter(s: &str) -> Option<Self> {
        match s {
            "document" => Some(Self::Document),
            "image" => Some(Self::Image),
            "code" => Some(Self::Code),
            "audio-video" => Some(Self::AudioVideo),
            "archive" => Some(Self::Archive),
            "folder" => Some(Self::Folder),
            "other" => Some(Self::Other),
            _ => None,
        }
    }
}

/// Entry kind, packed into the low two bits of `EntryMeta.flags`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

const FLAG_HIDDEN: u8 = 1 << 2;
const FLAG_PLACEHOLDER: u8 = 1 << 3;

/// Packs kind + attribute bits into the single `flags` byte.
/// Layout: bits 0–1 kind, bit 2 hidden (dotfile), bit 3 cloud placeholder.
pub fn pack_flags(kind: EntryKind, hidden: bool, placeholder: bool) -> u8 {
    let kind_bits = match kind {
        EntryKind::File => 0,
        EntryKind::Dir => 1,
        EntryKind::Symlink => 2,
    };
    kind_bits
        | if hidden { FLAG_HIDDEN } else { 0 }
        | if placeholder { FLAG_PLACEHOLDER } else { 0 }
}

pub fn flags_kind(flags: u8) -> EntryKind {
    match flags & 0b11 {
        1 => EntryKind::Dir,
        2 => EntryKind::Symlink,
        _ => EntryKind::File,
    }
}

pub fn flags_hidden(flags: u8) -> bool {
    flags & FLAG_HIDDEN != 0
}

pub fn flags_placeholder(flags: u8) -> bool {
    flags & FLAG_PLACEHOLDER != 0
}

/// Compact per-entry metadata record. Names live in the shared arenas
/// (`lc_arena` for lowercased match bytes, `disp_arena` for original case);
/// this struct only carries offsets. Paths are never stored — they are
/// materialized for final hits by walking the `parent` chain.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EntryMeta {
    pub lc_off: u32,
    pub disp_off: u32,
    pub lc_len: u16,
    /// Display-name byte length. Differs from `lc_len` only for non-ASCII
    /// case folds where lowercasing changes the UTF-8 byte count.
    pub name_len: u16,
    /// Index of the parent entry, or `NO_PARENT` for scan roots.
    pub parent: u32,
    /// Unix mtime in seconds, truncated to u32 (fine until 2106).
    pub mtime: u32,
    pub flags: u8,
    /// `FileType` ordinal (`FileType::from_u8` to decode).
    pub ext_class: u8,
}

impl EntryMeta {
    pub fn kind(&self) -> EntryKind {
        flags_kind(self.flags)
    }

    pub fn is_dir(&self) -> bool {
        matches!(self.kind(), EntryKind::Dir)
    }

    pub fn file_type(&self) -> FileType {
        FileType::from_u8(self.ext_class)
    }
}

/// Where a hit came from: the local index or an on-demand deep-search
/// provider (mdfind / Everything / plocate).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum HitSource {
    Local,
    Deep,
}

/// Wire shape for one search hit.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    /// 16-char lowercase hex of the stable u64 file id.
    pub file_id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: FileType,
    pub is_dir: bool,
    /// Unix mtime seconds. Widened to i64 on the wire.
    pub modified_at: i64,
    pub score: f32,
    pub pinned: bool,
    pub source: HitSource,
}

/// Per-query work accounting. Surfaced on the wire for the status card's
/// debug view and asserted on by the perf regression tests — the budget is
/// enforced as operation counts, not wall-clock, so CI stays deterministic.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkMeter {
    pub bytes_scanned: u64,
    pub candidates_collected: u32,
    pub candidates_scored: u32,
    pub fuzzy_checks: u32,
    /// True when the query was answered by narrowing the previous query's
    /// candidate set instead of a fresh arena scan.
    pub narrowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResponse {
    pub hits: Vec<FileHit>,
    /// Candidate collection hit the cap — results are best-effort from the
    /// static-rank-ordered prefix of the arena.
    pub truncated: bool,
    /// The whole arena was scanned (i.e. `!truncated`, plus tail).
    pub scanned_all: bool,
    pub index_generation: u64,
    pub work: WorkMeter,
}

/// Index lifecycle state, kebab-case on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum IndexStateKind {
    Disabled,
    Building,
    Ready,
    Rescanning,
    CapReached,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub state: IndexStateKind,
    pub entry_count: u64,
    pub last_scan_ms: u64,
    pub snapshot_loaded: bool,
    pub cap_reached: bool,
}

/// User-configurable index settings, pushed from TS via
/// `file_index_set_config` (mirror of the applications scan-paths bridge).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexConfig {
    pub enabled: bool,
    /// Absolute paths to index. Empty ⇒ `$HOME`.
    pub include_roots: Vec<String>,
    /// Extra exclude patterns layered on top of the built-in defaults.
    pub exclude_patterns: Vec<String>,
    pub index_hidden: bool,
}

impl Default for FileIndexConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            include_roots: Vec::new(),
            exclude_patterns: Vec::new(),
            index_hidden: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_type_from_extension_recognises_document() {
        assert_eq!(FileType::from_extension("pdf"), FileType::Document);
        assert_eq!(FileType::from_extension("DOCX"), FileType::Document);
        assert_eq!(FileType::from_extension("md"), FileType::Document);
    }

    #[test]
    fn file_type_from_extension_recognises_code() {
        assert_eq!(FileType::from_extension("rs"), FileType::Code);
        assert_eq!(FileType::from_extension("ts"), FileType::Code);
        assert_eq!(FileType::from_extension("py"), FileType::Code);
    }

    #[test]
    fn file_type_from_extension_recognises_media_and_archive() {
        assert_eq!(FileType::from_extension("png"), FileType::Image);
        assert_eq!(FileType::from_extension("mp4"), FileType::AudioVideo);
        assert_eq!(FileType::from_extension("zip"), FileType::Archive);
    }

    #[test]
    fn file_type_from_extension_unknown_is_other() {
        assert_eq!(FileType::from_extension("xyz"), FileType::Other);
        assert_eq!(FileType::from_extension(""), FileType::Other);
    }

    #[test]
    fn file_type_u8_round_trip() {
        for ft in [
            FileType::Document,
            FileType::Image,
            FileType::Code,
            FileType::AudioVideo,
            FileType::Archive,
            FileType::Folder,
            FileType::Other,
        ] {
            assert_eq!(FileType::from_u8(ft as u8), ft);
        }
        // Unknown bytes decay to Other, never panic.
        assert_eq!(FileType::from_u8(200), FileType::Other);
    }

    #[test]
    fn file_type_parse_filter_wire_strings() {
        assert_eq!(FileType::parse_filter("document"), Some(FileType::Document));
        assert_eq!(
            FileType::parse_filter("audio-video"),
            Some(FileType::AudioVideo)
        );
        assert_eq!(FileType::parse_filter("folder"), Some(FileType::Folder));
        assert_eq!(FileType::parse_filter("everything?"), None);
        assert_eq!(FileType::parse_filter(""), None);
    }

    #[test]
    fn flags_pack_and_unpack_all_combinations() {
        for kind in [EntryKind::File, EntryKind::Dir, EntryKind::Symlink] {
            for hidden in [false, true] {
                for placeholder in [false, true] {
                    let f = pack_flags(kind, hidden, placeholder);
                    assert_eq!(flags_kind(f), kind);
                    assert_eq!(flags_hidden(f), hidden);
                    assert_eq!(flags_placeholder(f), placeholder);
                }
            }
        }
    }

    #[test]
    fn entry_meta_helpers_reflect_flags() {
        let e = EntryMeta {
            lc_off: 0,
            disp_off: 0,
            lc_len: 4,
            name_len: 4,
            parent: NO_PARENT,
            mtime: 0,
            flags: pack_flags(EntryKind::Dir, false, false),
            ext_class: FileType::Folder as u8,
        };
        assert!(e.is_dir());
        assert_eq!(e.file_type(), FileType::Folder);
    }

    #[test]
    fn file_hit_serialises_as_camel_case_with_type_rename() {
        let hit = FileHit {
            file_id: "00ab00ab00ab00ab".into(),
            name: "a.pdf".into(),
            path: "/tmp/a.pdf".into(),
            file_type: FileType::Document,
            is_dir: false,
            modified_at: 1_234_567_890,
            score: 0.5,
            pinned: false,
            source: HitSource::Local,
        };
        let json = serde_json::to_string(&hit).unwrap();
        assert!(
            json.contains("\"fileId\":\"00ab00ab00ab00ab\""),
            "got {json}"
        );
        assert!(json.contains("\"modifiedAt\":1234567890"), "got {json}");
        assert!(json.contains("\"isDir\":false"), "got {json}");
        assert!(json.contains("\"type\":\"document\""), "got {json}");
        assert!(json.contains("\"source\":\"local\""), "got {json}");
    }

    #[test]
    fn index_status_serialises_kebab_state() {
        let s = IndexStatus {
            state: IndexStateKind::CapReached,
            entry_count: 42,
            last_scan_ms: 100,
            snapshot_loaded: true,
            cap_reached: true,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"state\":\"cap-reached\""), "got {json}");
        assert!(json.contains("\"entryCount\":42"), "got {json}");
    }

    #[test]
    fn file_index_config_deserialises_camel_case_and_defaults() {
        let cfg: FileIndexConfig = serde_json::from_str(
            r#"{"enabled":false,"includeRoots":["/x"],"excludePatterns":["node_modules"],"indexHidden":true}"#,
        )
        .unwrap();
        assert!(!cfg.enabled);
        assert_eq!(cfg.include_roots, vec!["/x".to_string()]);
        assert_eq!(cfg.exclude_patterns, vec!["node_modules".to_string()]);
        assert!(cfg.index_hidden);

        let d = FileIndexConfig::default();
        assert!(d.enabled);
        assert!(d.include_roots.is_empty());
        assert!(!d.index_hidden);
    }
}
