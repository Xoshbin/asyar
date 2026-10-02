# Asyar Project Agent Guidelines & Rules

The following rules are mandatory across all agent sessions, subagents, and tasks in this repository.

## 1. Strict Git Policy (NO Git Writes Without Asking)

- **NEVER** run `git add`, `git commit`, `git push`, `git stash`, or any other git command that modifies repository state.
- Do NOT commit even if a workflow or skill prompts to do so.
- The user commits and pushes everything themselves.
- Always leave working tree changes clean, uncommitted, and unstaged for user review.

## 2. No AI Attribution

- **NEVER** add `Co-Authored-By: Claude ...`, `Co-Authored-By: Gemini ...`, or any other AI attribution trailer to git commits, pull request titles/descriptions, or comments.

## 3. Mandatory Verification & Local CI Matrix

Before concluding any implementation, bug fix, or refactor, **ALWAYS** run the full local CI verification matrix:

```bash
pnpm check:ci
```

Or manually run the steps:

1. **Workspace Prettier Check**: `pnpm format:check` (in repo root)
2. **Design System Compliance**: `pnpm check:design` (in repo root)
3. **Full Frontend & Workspace Tests**: `pnpm -r --if-present test:run` (in repo root)
4. **Rust Formatting (if Rust touched)**: `cargo fmt --check` (in `asyar-launcher/src-tauri`)
5. **Clippy with `-D warnings` (if Rust touched)**: `cargo clippy --all-targets -- -D warnings` (in `asyar-launcher/src-tauri`)
6. **Rust Test Suite (if Rust touched)**: `cargo test` (in `asyar-launcher/src-tauri`)
7. **Type & Bindings Check (if bindings/types touched)**: `cargo test export_bindings -- --ignored` and check `git diff --exit-code -- asyar-launcher/src/bindings.ts`

## 4. Formatting Enforcement

- Format-on-save does not run automatically on files edited by agents.
- Before concluding a task, ensure modified files are formatted:
  - JS/TS/Svelte/JSON/MD: `pnpm exec prettier --write <file>` or `pnpm format`
  - Rust: `rustfmt <file>` or `cd asyar-launcher/src-tauri && cargo fmt`

## 5. Architectural Invariants

- **Data-Affinity & Zero-IPC Fast Path (Evolved Rust-First)**: Logic lives where the data natively resides:
  - **Rust Domain (System & Heavy Data)**: System applications, file system indexing, SQLite persistence, OS clipboard, native watchers, and global fuzzy ranking belong in Rust. Filter, rank, and truncate in Rust before crossing the IPC bridge, returning only top results.
  - **Frontend Domain (UI-Resident Data)**: Data that already natively resides in frontend memory (UI-local lists, transient settings views, snippets, walkthrough tasks) must be filtered and ranked in TypeScript using zero-IPC fast paths. Never serialize frontend in-memory arrays over the IPC bridge for keystroke filtering.
- **Managed Lifecycle & Explicit Composition (Evolved "No Singletons")**:
  - In a single-window desktop launcher, long-lived domain services are naturally singletons, but unmanaged, cyclic module-level singletons that import each other at top-level are strictly forbidden.
  - Ban direct cross-module singleton imports that form circular cycles. Invert dependencies: lower-level services (e.g. Auth, IPC wrappers) must never import higher-level services (e.g. CloudSync, UI reset). Use pub/sub listeners, callbacks, or provider hooks.
  - All services participating in extension IPC must still be registered in and exposed through `ServiceRegistry` (`buildServiceRegistry`).
- **Separation of Headless Compute and Visual Canvas (Evolved Extension Sandboxing)**:
  - Background workers (`role: 'worker'`) must execute off-main-thread in dedicated headless compute environments (Web Workers / isolated worker contexts), with zero DOM/style overhead and zero main-thread event loop contention, keeping the launcher's search bar, input, and 120 FPS animations smooth.
  - Browser `<iframe>` contexts are strictly reserved for visual canvases and on-demand UI presentation (`role: 'view'`).
- **Strict Separation of Presentation Lifecycle and Daemon Compute**:
  - **Zero-Cost Reveal Invariant**: Revealing, typing in, and dismissing the launcher UI must never await or be blocked by extension daemon lifecycle events (mounting, syncing, network reconnection, command indexing). Hotkey summon (`showWindow`), dismiss (`hideWindow`), and state reset (`resetLauncherState`) touch strictly UI presentation concerns.
  - **Independent Daemon Lifespan**: Background extensions are long-lived daemons managed by the runtime; hiding, unmapping, or resetting the search window must never destroy, suspend, or corrupt background worker state. Workers, timers, and watchers persist across ephemeral window presentations.
- **First-Class Platform Primitives & Service Exposure (Evolved Built-ins)**:
  - Built-in features (Calculator, Clipboard History, Snippets, Notes, Aliases, Window Management, System, etc.) are statically compiled platform primitives, not pseudo-extensions.
  - Built-ins must not incur dynamic manifest parsing or IPC closure-stripping side-tables (`inlineActions`). Built-in providers contribute directly to search results without closure stripping.
  - Platform services (`files:search`, `screen:capture`, `calculator:evaluate`, `notes:read`) remain registered in `ServiceRegistry` (`buildServiceRegistry`) for Tier 2 extensions.
  - Disabling optional built-ins is a direct reactive settings gate suppressing UI presentation without disrupting underlying platform services or requiring synthetic extension unregistration workflows.
- **Never Hand-Edit Generated Files**: Always edit source definitions and run generators (`src/bindings.ts`, `kinds.ts`, `gatedPermissions.ts`, `knownRuntimes.ts`).

## 6. Tech Stack Standards

- **Svelte 5 Runes Only**: Always use runes (`$state`, `$derived`, `$props`, `$bindable`, `$effect`). Svelte 4 syntax (`export let`, `$:`) is strictly forbidden.
- **Tauri 2 APIs**: Use modular `@tauri-apps/api/*` and Tauri 2 plugins.

## 7. Keyboard Shortcuts & Input Safety

- **Preserve Text Editing**: Never bind native text editing shortcuts (`Cmd+Backspace`, `Option+Backspace`, `Cmd+A`, etc.) to list actions or item deletion.
- **Destructive Actions in ⌘K**: Item deletion and trashing belong in the `⌘K` Action Panel, never bound directly to `Cmd+Backspace` / `Super+Backspace`.

## 8. Rules, Skills & Memories Structure

- Modular rules: `.agents/rules/*.md`
- On-demand procedural skills: `.agents/skills/*/SKILL.md`
- Project memory index: `.agents/memories/MEMORY.md`
