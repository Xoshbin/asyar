# Mandatory Local CI Verification Matrix

Asyar uses a **Two-Loop Verification Model** to balance developer/agent velocity with release-grade correctness:

## The Two-Loop Verification Model

1. **Inner Loop (Iterative Development)**:
   - For UI, Svelte, or TypeScript changes: `pnpm check:ci:frontend` (or `node scripts/check-ci.mjs --frontend`)
   - For Rust or Tauri backend changes: `pnpm check:ci:rust` (or `node scripts/check-ci.mjs --rust`)
   - For automatic change-based scoping: `pnpm check:ci:changed` (or `node scripts/check-ci.mjs --changed`)
   - Inner-loop checks complete in seconds, avoiding the tax of running thousands of irrelevant tests during rapid iteration.

2. **Outer Loop (Task Conclusion / Hand-off / Pre-Push)**:
   - Run the full matrix:
     ```bash
     pnpm check:ci
     ```
   - Mandatory prior to final task hand-off, or whenever touching cross-layer IPC contracts, TypeScript/Rust bindings, or storage migrations.

---

## Verification Scopes & Commands

| Scope           | Command                         | Description                                                                      |
| :-------------- | :------------------------------ | :------------------------------------------------------------------------------- |
| **Full Matrix** | `pnpm check:ci` (or `--all`)    | Runs complete workspace format, design, Vitest, and Rust test suite.             |
| **Frontend**    | `pnpm check:ci:frontend` (`-f`) | Runs Prettier check, Design System compliance, and all frontend Vitest suites.   |
| **Rust**        | `pnpm check:ci:rust` (`-r`)     | Runs `cargo fmt --check`, `cargo clippy`, and all Rust unit/integration tests.   |
| **Changed**     | `pnpm check:ci:changed` (`-c`)  | Inspects `git status` / `git diff` to automatically verify only touched domains. |

### Steps Executed in Full Matrix (`pnpm check:ci`):

1. **Workspace Prettier Check**: `pnpm format:check`
2. **Design System Compliance**: `pnpm check:design`
3. **Full Frontend & Workspace Tests**: `pnpm -r --if-present test:run`
4. **Rust Formatting**: `cargo fmt --check` (in `asyar-launcher/src-tauri`)
5. **Rust Clippy**: `cargo clippy --all-targets -- -D warnings` (in `asyar-launcher/src-tauri`)
6. **Rust Test Suite**: `cargo test` (in `asyar-launcher/src-tauri`)

_(If TypeScript/Rust bindings were touched, also verify: `cargo test export_bindings -- --ignored` and check `git diff --exit-code -- asyar-launcher/src/bindings.ts`)_
