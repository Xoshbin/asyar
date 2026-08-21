# Architecture & Core Invariants

## 1. Rust-First Principle

- **Rust is the Brain, Frontend is the Presenter**:
  - If logic can live in Rust, it must.
  - **Must be in Rust**: Filtering, sorting, ranking, scoring, fuzzy search, query parsing, state transformations, validation, caching, and business logic.
  - **Must be in Svelte / TypeScript**: Rendering, UI layout, animations, DOM event handling, and immediate visual interactions.
  - When encountering misplaced frontend logic, refactor it into Rust.

## 2. No Service Singletons

- Never create `getInstance()`, `static instance`, or hidden singleton states.
- All long-lived services must be registered in and resolved through `ServiceRegistry` (`buildServiceRegistry`).

## 3. Never Hand-Edit Generated Files

- Files with an `AUTO-GENERATED` banner (such as `src/bindings.ts`, `kinds.ts`, `gatedPermissions.ts`, `knownRuntimes.ts`) must never be edited manually.
- Always edit the source file (e.g. `src-tauri/src/permissions.rs`, `error.rs`, `models.rs`) and run the corresponding generator command (`pnpm gen:all`, `cargo test export_bindings -- --ignored`).
