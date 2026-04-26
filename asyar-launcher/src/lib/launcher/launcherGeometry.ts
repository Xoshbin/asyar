// Launcher window heights — single source of truth.
//
// Rust mirrors these in `asyar-launcher/src-tauri/src/platform/macos.rs` as
// `LAUNCHER_MAX_HEIGHT` and `LAUNCHER_COMPACT_HEIGHT`. A Rust test
// (`heights_match_typescript_source` in macos.rs) parses this file at
// compile time via `include_str!` and asserts the values match, so drift
// fails CI instead of shipping a silent geometry mismatch.

/** Full launcher height: search header + results region + bottom action bar. */
export const LAUNCHER_HEIGHT_DEFAULT = 480;

/** Compact launch-view height: SearchHeader (56px) + BottomActionBar (40px). */
export const LAUNCHER_HEIGHT_COMPACT = 96;
