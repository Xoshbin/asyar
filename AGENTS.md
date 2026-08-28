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

- **Rust-First**: Rust is the brain, frontend is the presenter. Move filtering, ranking, scoring, fuzzy search, parsing, caching, and state logic to Rust.
- **No Singletons**: Never introduce `getInstance()` or static singleton state; use `ServiceRegistry`.
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
