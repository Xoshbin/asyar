# Architecture & Core Invariants

## 1. Data-Affinity & Zero-IPC Principle (Evolved Rust-First)

- **Logic Lives Where Data Resides**:
  - **Rust Domain (System & Heavy Data)**: System applications, file system indexing, SQLite persistence, OS clipboard, native background watchers, and global fuzzy ranking belong in Rust. Filter, rank, score, and truncate in Rust before crossing the IPC bridge, returning only the top N results to the webview.
  - **Frontend Domain (UI-Resident Data)**: Data that already natively resides in frontend memory (UI-local lists, transient settings views, snippets, walkthrough tasks, in-view items) must be filtered, ranked, and scored directly in TypeScript using zero-IPC fast paths.
  - **Zero-IPC Fast Path**: Never serialize frontend in-memory arrays over the IPC bridge for keystroke filtering. IPC round-trips for UI-local collections introduce unnecessary JSON serialization overhead and latency into active typing.
  - **Presentation & Interaction**: Rendering, UI layout, animations, DOM event handling, and immediate visual interactions belong strictly in Svelte 5 / TypeScript.

## 2. Managed Lifecycle & Dependency Inversion (Evolved "No Singletons")

- **Ban on Cyclic Module Singletons**:
  - Never import companion service singletons directly across module boundaries in a way that introduces circular dependency cycles.
  - Invert dependencies: lower-level services (such as `authService` or low-level IPC wrappers) must NEVER import higher-level feature services (such as `cloudSyncService` or UI coordinators).
  - Use dependency inversion: expose event listeners (`onAuthChange`), provider setters (`setSelectedItemProvider`), or hook registries (`registerLauncherResetHook`) instead of cyclic module imports.
- **ServiceRegistry as the Extension Boundary**:
  - All host services accessible to Tier 2 extensions must be explicitly registered and projected through `ServiceRegistry` (`buildServiceRegistry`).

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

## 5. Separation of Headless Compute and Visual Canvas (Evolved Sandboxing)

- **Decoupled Compute from DOM Presentation**:
  - **Headless Worker (`role: 'worker'`)**: Must execute in off-main-thread compute environments (e.g. Web Workers or isolated worker host contexts). Headless background execution (schedules, interval pollers, push subscriptions, WebSocket/fetch connections, tools, RPC handlers) must never reside in main-window DOM iframes where JavaScript execution contends with the launcher's search bar, input latency, and 120 FPS animations.
  - **Visual Canvas (`role: 'view'`)**: Strictly reserved for UI presentation. Sandboxed `<iframe>` elements at `asyar-extension://` are mounted on-demand only when a foreground visual view is active and dismissed when the user navigates away.
  - **Multi-Engine Horizon**: Web Workers off the main thread today $\rightarrow$ pluggable isolated native runtimes (e.g. QuickJS or Wasm components with direct Rust IPC bindings) for high-throughput extensions tomorrow, completely eliminating browser engine overhead for background compute.

## 6. Strict Separation of Presentation Lifecycle and Daemon Compute

- **Zero-Cost Reveal Invariant**:
  - Revealing, typing in, and dismissing the launcher UI must never await or be blocked by extension daemon lifecycle events (mounting, syncing, network reconnection, command indexing).
  - Hotkey summon (`showWindow`), dismiss (`hideWindow`), and state reset (`resetLauncherState`) touch strictly UI presentation concerns (query reset, navigation stack shrink, focus).
  - Extension command indexing and worker restoration must remain non-blocking, deferred to idle periods (`runWhenIdle`), ensuring the launcher window is immediately interactive on cold boot.
- **Independent Daemon Lifespan**:
  - Background extensions are long-lived daemons managed by the runtime.
  - Hiding, unmapping, or resetting the search window must never destroy, suspend, or corrupt background worker state.
  - Workers, long-running background timers, WebSocket connections, and native background watchers must continue executing reliably even when the launcher window remains hidden for hours.
