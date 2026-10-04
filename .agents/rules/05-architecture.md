# Architecture & Core Invariants

## 1. Data-Affinity & Zero-IPC Principle (Evolved Rust-First)

- **Logic Lives Where Data Resides**:
  - **Rust Domain (System & Heavy Data)**: System applications, file system indexing, SQLite persistence, OS clipboard, native background watchers, and global fuzzy ranking belong in Rust. Filter, rank, score, and truncate in Rust before crossing the IPC bridge, returning only the top N results to the webview.
  - **Frontend Domain (UI-Resident Data)**: Data that already natively resides in frontend memory (UI-local lists, transient settings views, snippets, walkthrough tasks, in-view items) must be filtered, ranked, and scored directly in TypeScript using zero-IPC fast paths.
  - **Zero-IPC Fast Path**: Never serialize frontend in-memory arrays over the IPC bridge for keystroke filtering. IPC round-trips for UI-local collections introduce unnecessary JSON serialization overhead and latency into active typing. Explicit exceptions: the published extension API `services.search.rank` remains backed by Rust, and `classifyItems` uses Rust for Run-row tiers so they agree with the indexed results they are interleaved with. These exceptions do not apply to ordinary UI-local list filtering.
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

## 4. First-Class Platform Primitives & Service Exposure

- **First-Class Platform Primitives (No Pseudo-Extensions)**:
  - Core built-in features (Calculator, Clipboard History, Snippets, Notes, Aliases, Window Management, System, etc.) are statically compiled first-class platform primitives, not pseudo-extensions.
  - Built-ins must not incur dynamic manifest parsing or IPC closure-stripping side-tables (`inlineActions`). Built-in providers contribute directly to search or UI without closure-stripping round-trips.
  - Built-in features are defined with static descriptors / declarations; dynamic manifests and runtime directory scanning are strictly reserved for installed third-party (Tier 2) extensions.
- **Strict Service/UI Separation & Tier 2 Exposure**:
  - Every built-in feature maintains a clean boundary between its underlying platform service (Rust engine, SQLite storage, background watchers, IPC handlers) and its user-facing UI (commands, views, search fallback items, accessories, deeplinks).
  - Platform services (e.g. `files:search`, `screen:capture`, `calculator:evaluate`, `notes:read`) must remain registered in `ServiceRegistry` (`buildServiceRegistry`) so permission-authorized Tier 2 extensions can consume them uninterrupted.
  - Disabling an optional built-in feature via Settings uses a direct reactive gate (e.g. `if (!settings.features[id].enabled)` or settings toggle), cleanly suppressing its UI commands, accessories, and search suggestions without unregistering, killing, or clearing the underlying platform service.
  - Only core platform infrastructure (`system` and `settings`) is non-disableable.

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

## 7. Invariants Enforced by Guard Tests — Read Before Touching These Areas

Each invariant below was violated in production at least once because it was enforced only by
convention. Each now has a test that fails if you break it. If one of these tests fails, the test
is right and your change is wrong — fix the change, not the test.

| Invariant                                                                                                                                                                        | Guard                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Host→extension delivery goes through `postToExtension`; never query a `data-role="worker"` iframe outside `extensionIframeSelector.ts`. A worker is a Web Worker, not an iframe. | `services/extension/workerPushDelivery.test.ts`                                |
| Subscribe to bridged events with `appListen`, never the raw `listen` from `@tauri-apps/api/event` — `bridge_emit` feeds only `appListen` subscribers once the poller connects.   | `lib/ipc/bridgeListenerGuard.test.ts`                                          |
| Built-in features never declare `background.main` and are never mounted as workers; they are compiled into the launcher bundle.                                                  | `extensions/discovery.rs` manifest tests + `workerRegistry.svelte.ts`          |
| Every Tauri command path appears exactly once in `commands/handlers.rs`.                                                                                                         | `command_paths_are_registered_once`                                            |
| The TypeScript and Rust rankers must agree on which items match and their tier (scores and intra-tier order may differ).                                                         | `crates/asyar-search/tests/parity-fixture.json`, run from both suites          |
| Extension builds must set `modulePreload: false` — Vite's polyfill touches `document` and kills a Web Worker on line one. Use `defineExtensionConfig` from `asyar-sdk/vite`.     | `asyar-sdk/src/vite.test.ts`, `create-extension/scaffoldService.build.test.ts` |
| The iframe compatibility fallback for failed workers is temporary and must be removed before 0.2.0.                                                                              | `services/extension/workerFallbackDeadline.test.ts`                            |

**The recurring failure mode behind all of these:** a check validated the _input_ while the runtime
consumed the _output_, and nothing compared them. A manifest declared a worker bundle that
packaging had moved; a lint read the author's source while the bundler injected the offending line
afterwards; a selector was correct for iframes after workers stopped being iframes. When adding a
guard, assert against the artifact that actually ships.
