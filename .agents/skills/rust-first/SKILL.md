---
name: rust-first
description: Use at session start and when implementing any feature, fix, or refactor. Triggers on every session to evaluate whether existing frontend logic should move to Rust. Also triggers on new features, bug fixes, refactoring, code review, or any work touching frontend code.
---

# rust-first

**Principle:** Rust is the brain. The frontend is the presenter. Refactoring frontend logic into Rust is always on the table.

## The Rule

1. **Default to Rust** — if logic can live in Rust, it must.
2. **Frontend is display-only** — it receives data from Rust and renders it. Nothing more.
3. **Refactoring is expected** — when you encounter frontend logic that belongs in Rust, flag it. If the current task touches that area, move it as part of the task. If not, report it to the user as a recommended refactor.
4. **Every session: scan for violations** — at the start of every session, before diving into tasks, briefly evaluate whether code you're about to touch has logic that should be in Rust.

## Session Start Protocol

When starting a new session or picking up work on the launcher:

1. If you have a specific task, check whether the area you'll touch has frontend logic that should be in Rust.
2. If you find violations in the task area, include the refactor in your plan — don't just fix/add on top of misplaced logic.
3. If you find violations outside the task area, mention them to the user as separate refactor candidates.
4. If no specific task yet, ask the user if they'd like a rust-first compliance scan of a particular area.

## Decision Guide

**Must be in Rust:**

- Filtering, sorting, ranking, scoring
- Fuzzy search and matching (use Rust crates, not JS libraries like Fuse.js)
- State management and data transformations
- Validation and business rules
- Caching and memoization of computed results
- Any logic duplicated across frontend components

**Must be in Svelte/TS:**

- Rendering and layout
- Animations and transitions
- DOM/browser-only APIs (clipboard access, focus, scroll, keyboard events)
- Immediate UI feedback requiring sub-frame response (hover, drag)
- Anything Tauri/Rust cannot access (browser APIs, CSS, DOM tree)

## Rationalizations That Do NOT Exempt You

These are common excuses for keeping logic in the frontend. None of them are valid:

| Excuse                                               | Why it's wrong                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| "The system is entirely in TS today"                 | That means it needs refactoring, not preserving. Sunk cost is not architecture.                                                            |
| "Moving to Rust would be a bigger change than asked" | Rust-first IS the task. Building on misplaced logic creates tech debt. Flag scope to the user, but recommend the Rust path.                |
| "It's just a bug fix in a JS library"                | If the JS library shouldn't be there in the first place, the real fix is moving the logic to Rust. A patch on misplaced code is not a fix. |
| "Proactive refactoring is risky"                     | Leaving logic in the wrong layer is the real risk. Refactoring with tests (TDD) is safe.                                                   |
| "The user only asked for X"                          | Recommend the Rust-first approach. Let the user decide scope, but never silently choose the TS path without flagging it.                   |
| "It's simpler in TypeScript"                         | Simplicity in the wrong layer is complexity in the architecture.                                                                           |
| "There's no Rust equivalent yet"                     | Build one. That's the point.                                                                                                               |
| "I'll move it to Rust later"                         | Later never comes. Do it now or flag it explicitly.                                                                                        |
| "IPC round-trip adds latency"                        | Tauri IPC is sub-millisecond for small payloads. Rust computation is faster than JS. The net is usually faster, not slower.                |
| "The data only exists in the frontend"               | Pass it to Rust via the command. Stateless Rust commands that receive data, process it, and return results are perfectly valid rust-first. |

## How to Flag a Rust-First Violation

When you find frontend logic that belongs in Rust but the refactor is out of scope for the current task:

> **Rust-first violation:** `[file:line]` contains `[description of logic]`. This should be a Tauri command in Rust. Recommend refactoring as a separate task.

Always flag. Never silently skip.

## Pattern

```
User action
  → Svelte: emit IPC command (no logic, just dispatch)
  → Rust: compute, filter, transform, return result
  → Svelte: receive result, render it
```

The frontend should be thin enough that replacing it with a different renderer requires no Rust changes.

## Red Flags — You Are Violating This Skill

- Adding Fuse.js or similar JS search libraries instead of using Rust fuzzy matching
- Writing filter/sort/rank logic in `.svelte.ts` files
- Adding `$derived` blocks that transform data instead of just selecting display properties
- Creating TypeScript utility functions for data processing
- Fixing a bug in frontend logic without questioning why that logic is in the frontend
- Starting work on a feature without checking if the area has rust-first violations

**If you catch yourself doing any of these: STOP. Reconsider. Flag to user.**
