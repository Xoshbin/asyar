//! Per-category cloud sync (Layer 4a).
//!
//! Replaces the previous monolithic `cloud_snapshots` blob with one
//! upload per registered `ISyncProvider` (the TS-side interface in
//! `src/services/profile/profileService.ts`). The orchestrator's
//! brain is the pure functions in [`orchestrator`] — they take a
//! snapshot of state and return a `Vec` of decisions, no I/O. The
//! Tauri command layer wraps those decisions with HTTP + journal
//! writes.
//!
//! Spec: `docs/superpowers/specs/2026-05-04-per-category-cloud-sync.md`.

pub mod orchestrator;
pub mod types;
