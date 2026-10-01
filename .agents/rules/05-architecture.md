# Architecture & Core Invariants

## 1. Data-Affinity & Zero-IPC Principle (Evolved Rust-First)

- **Logic Lives Where Data Resides**:
  - **Rust Domain (System & Heavy Data)**: System applications, file system indexing, SQLite persistence, OS clipboard, native background watchers, and global fuzzy ranking belong in Rust. Filter, rank, score, and truncate in Rust before crossing the IPC bridge, returning only the top N results to the webview.
  - **Frontend Domain (UI-Resident Data)**: Data that already natively resides in frontend memory (UI-local lists, transient settings views, snippets, walkthrough tasks, in-view items) must be filtered, ranked, and scored directly in TypeScript using zero-IPC fast paths.
  - **Zero-IPC Fast Path**: Never serialize frontend in-memory arrays over the IPC bridge for keystroke filtering. IPC round-trips for UI-local collections introduce unnecessary JSON serialization overhead and latency into active typing.
  - **Presentation & Interaction**: Rendering, UI layout, animations, DOM event handling, and immediate visual interactions belong strictly in Svelte 5 / TypeScript.

## 2. No Service Singletons

- Never create `getInstance()`, `static instance`, or hidden singleton states.
- All long-lived services must be registered in and resolved through `ServiceRegistry` (`buildServiceRegistry`).

## 3. Never Hand-Edit Generated Files

- Files with an `AUTO-GENERATED` banner (such as `src/bindings.ts`, `kinds.ts`, `gatedPermissions.ts`, `knownRuntimes.ts`) must never be edited manually.
- Always edit the source file (e.g. `src-tauri/src/permissions.rs`, `error.rs`, `models.rs`) and run the corresponding generator command (`pnpm gen:all`, `cargo test export_bindings -- --ignored`).

## 4. Built-in Feature Lifecycle & Service/UI Boundary

- **Strict Service/UI Separation**:
  - Every built-in feature must maintain a clean boundary between its underlying platform service (Rust engine, SQLite storage, background watchers, IPC handlers) and its bundled user-facing UI (commands, views, search fallback items, accessories, deeplinks).
  - All 21 optional built-in features declare `"lifecycle": { "disableable": true }` in `manifest.json`.
  - Disabling a built-in feature in **Settings → Extensions** cleanly unregisters its UI contributions without stopping, killing, or clearing the underlying platform service.
  - Permission-authorized Tier 2 extensions must retain uninterrupted access to platform services (e.g. `files:search`, `screen:capture`, `calculator:evaluate`, `notes:read`) regardless of whether the bundled UI is enabled or disabled.
  - Only core platform infrastructure (`system` and `settings`) is non-disableable (`lifecycle.disableable: false`).
