//! File index subsystem: a self-contained filename search engine.
//!
//! Files are indexed into a compact struct-of-arrays layout (`index.rs`) and
//! queried with bounded per-keystroke work (`query.rs`). This subsystem is
//! deliberately separate from `search_engine::SearchState` — file entries
//! never enter the apps/commands index, and the root-search hot path only
//! ever sees an O(1) fallback row.

pub mod commands;
pub mod deep;
pub mod file_id;
pub mod index;
pub mod learning;
pub mod matcher;
pub mod provider;
pub mod query;
pub mod ranking;
pub mod service;
pub mod snapshot;
pub mod types;
pub mod walker;
pub mod watcher;
