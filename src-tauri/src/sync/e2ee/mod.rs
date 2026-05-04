//! End-to-end encrypted cloud sync — encryption seam between the
//! orchestrator's pure decision pipeline and the wire boundary.
//!
//! [`mode`]: per-sync-run E2EE state loaded once at the start of
//!   `sync_run` (off, or on with a master_seed cached from the OS keychain).
//! [`transform`]: pure functions that fold encryption into the existing
//!   `Vec<UploadDecision>` (push side) and `ItemPullPage` (pull side).
//!
//! Spec: `docs/superpowers/specs/2026-05-04-e2ee-cloud-sync.md`.

pub mod mode;
pub mod transform;
