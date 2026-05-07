//! Runtime-registered command registry. Dynamic commands look identical
//! to manifest-declared commands at every layer below registration —
//! search ranking, argument-mode promotion, dispatcher routing, and
//! last-value persistence are oblivious to where a command originated.
//!
//! See `docs/superpowers/plans/2026-05-06-dynamic-commands.md` for the
//! cross-layer contract and `docs/reference/dynamic-commands.md` for
//! the user-facing API doc.

pub mod registry;
pub mod validation;

pub use registry::{DynamicCommandRegistry, RegisteredCommand, ReplaceDiff};
pub use validation::{validate_arguments, validate_dynamic_id, MAX_ARGUMENTS_PER_COMMAND};
