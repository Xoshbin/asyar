---
name: generated-files
description: Never hand-edit or hand-copy generated content. Use when touching permissions.rs, error.rs, AppError/SearchError variants, runtimes/catalog.fallback.json, any `#[derive(specta::Type)]` struct, any file with an AUTO-GENERATED banner (kinds.ts, gatedPermissions.ts, knownRuntimes.ts, bindings.ts, emoji data), or whenever you are about to write a TypeScript list/type that mirrors a Rust source.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# generated-files

**Principle:** every list or type that exists on both the Rust side and the
TypeScript side has exactly **one** hand-written source. The other copies are
produced by a generator. If you type the second copy by hand, it will drift —
and drift here has already shipped real bugs (a permission gate that allowed
everything, a `publish` command that rejected a valid manifest).

## The two rules

1. **Never edit a generated file.** Edit its Rust/JSON source, then run the
   generator.
2. **Never create a new hand-synced mirror.** If you need Rust data in TS,
   write a generator — do not paste the list and add a "keep in sync" comment.

---

## Rule 1 — the registry

Files below are **outputs**. Editing them directly is always wrong; your edit
is erased on the next regen and CI fails on the diff.

```
        SOURCE (hand-written)                 GENERATOR                       OUTPUT (never edit)
  ┌──────────────────────────────┐   ┌───────────────────────────┐   ┌────────────────────────────────┐
  │ src-tauri/src/permissions.rs │──▶│ generate-permission-      │──▶│ src/services/extension/        │
  │   get_required_permission    │   │   catalog.mjs             │  ├▶│   gatedPermissions.ts          │
  └──────────────────────────────┘   │  (writes BOTH copies)     │  │ │ asyar-sdk/cli/lib/             │
                                     └───────────────────────────┘  └▶│   gatedPermissions.ts          │
  ┌──────────────────────────────┐   ┌───────────────────────────┐   ├────────────────────────────────┤
  │ src-tauri/src/error.rs       │──▶│ generate-diagnostic-      │──▶│ src/services/diagnostics/      │
  │ src-tauri/src/search_engine/ │   │   kinds.mjs               │   │   kinds.ts                     │
  │   mod.rs   (error variants)  │   └───────────────────────────┘   ├────────────────────────────────┤
  ├──────────────────────────────┤   ┌───────────────────────────┐   │                                │
  │ src-tauri/src/runtimes/      │──▶│ generate-known-           │──▶│ asyar-sdk/cli/lib/             │
  │   catalog.fallback.json      │   │   runtimes.mjs (in sdk)   │   │   knownRuntimes.ts             │
  ├──────────────────────────────┤   ├───────────────────────────┤   ├────────────────────────────────┤
  │ any #[derive(specta::Type)]  │──▶│ cargo test export_bindings│──▶│ src/bindings.ts   (+ the 3     │
  │ registered in models.rs::    │   │   -- --ignored            │   │   re-export shims under        │
  │   export_bindings            │   │                           │   │   services/search/types/)      │
  ├──────────────────────────────┤   ├───────────────────────────┤   ├────────────────────────────────┤
  │ upstream emoji dataset       │──▶│ extensions/emoji/scripts/ │──▶│ extensions/emoji/src/data/     │
  │                              │   │   generate-data.mjs       │   │   emojis.ts                    │
  └──────────────────────────────┘   └───────────────────────────┘   └────────────────────────────────┘
```

Concrete commands:

| You changed                                 | Run (from this directory)                                   |
| ------------------------------------------- | ----------------------------------------------------------- |
| `permissions.rs::get_required_permission`   | `pnpm gen:permission-catalog` — in `asyar-launcher/`        |
| `AppError` / `SearchError` variants         | `pnpm gen:diagnostic-kinds` — in `asyar-launcher/`          |
| `runtimes/catalog.fallback.json`            | `npm run gen:known-runtimes` — in `asyar-sdk/`              |
| any of the above (blanket)                  | `pnpm gen:all` — in that package                            |
| a `specta::Type` struct, or the export list | `cargo test export_bindings -- --ignored` — in `src-tauri/` |
| emoji dataset                               | `pnpm --filter org.asyar.emoji run gen:data` — anywhere     |

Note the launcher's package name is **`asyar`**, not `asyar-launcher` — so a
`--filter asyar-launcher` will not resolve. `cd` into the package instead.

**You usually don't need to run the first four by hand.** `pretest`,
`pretest:run`, and `prebuild` all chain `gen:all` in both packages, so
`pnpm test` self-heals them. `bindings.ts` is the exception — it needs a full
`cargo` compile, so it is deliberately **not** in any pretest hook. Changing a
specta type means you regenerate it yourself or CI fails.

### How to recognise a generated file before you edit it

Line 1 says so. Check it:

```
// AUTO-GENERATED by scripts/generate-permission-catalog.mjs — do not edit.
// This file has been generated by Specta. Do not edit this file manually.
```

They are also all listed in `.prettierignore` — reformatting them just fights
the generator's own output style, and `diagnostics.rs`'s `kinds_contract` test
byte-matches `kinds.ts`'s exact `"kind"` quoting.

### The safety nets that will catch you

- `.github/workflows/test-and-lint.yml` → **"Verify generated Rust-derived
  files are up to date"**: the test step already ran `gen:all`, so a
  `git diff --exit-code` on the four generated TS files fails the build if the
  committed copy was stale.
- A second step regenerates `bindings.ts` and diffs it the same way.
- `src-tauri/src/diagnostics.rs::kinds_contract` asserts every Rust kind is
  present in `kinds.ts`, with the error message telling you which script to run.
- `asyar-launcher/scripts/permission-coverage.test.mjs` (picked up by vitest via
  the `scripts/**/*.test.mjs` glob) asserts every SDK `.invoke()` call type is
  classified gated-or-public in the Rust gate.

A red CI on any of these means "you edited a source and skipped the generator,"
not "the generator is broken."

---

## Rule 2 — don't hand-write a new mirror

The failure shape to watch for, in your own output:

```ts
// ❌ Kept in sync by hand with src-tauri/src/permissions.rs
const GATED = ['clipboard:read', 'network' /* ... */];
```

That comment is the bug. A comment cannot keep anything in sync. Every instance
of this pattern found in this repo had already drifted by the time it was found:

- `permissionCatalog.test.ts`'s 39-item array was missing `feedback:announce`,
  so its "covers every permission" test had a silent hole.
- `manifest.test.ts` carried a _second_, 7-item permission mirror in a different
  package.
- `VALID_RUNTIMES` was hand-typed against `known_names()`.
- `screen:pick-color` reached the Rust gate and the JS catalog but not the CLI
  validator → `asyar publish` rejected a permission the launcher enforced.

**If you are about to write a TS constant whose values come from a Rust file:
stop and write a generator instead.**

### Recipe for a new generated file

Copy `asyar-launcher/scripts/generate-permission-catalog.mjs` — it is the
reference implementation, including the two-output case.

1. **Parse the real source.** Read the Rust/JSON file and regex the values out,
   anchored to a specific function or block (that generator anchors on
   `fn get_required_permission(...) { ... }` and throws if the anchor is gone —
   so a rename fails loudly instead of emitting an empty list).
2. **Dedupe and sort**, then `JSON.stringify(sorted, null, 2)` for the literal.
3. **Write a banner** naming the generator, the regen command, and the source.
   Say what the list _is_ and what it is _not_ — the existing banners spell out
   that gated ≠ manifest-declarable, which stops the next reader conflating them.
4. **One generator writes every copy.** Two consumers that can't share an import
   (launcher app vs. separately-published SDK CLI) get two `targets` entries in
   one script — never two scripts.
5. **Wire it up:** add `gen:<thing>` to that package's `package.json`, chain it
   into `gen:all` (which `pretest`/`pretest:run`/`prebuild` already run).
6. **Add the output to `.prettierignore`.**
7. **Add the output to the CI `git diff --exit-code` list** in
   `.github/workflows/test-and-lint.yml`.
8. **Prove it, don't assume it:** delete the output and confirm `pnpm test:run`
   recreates it byte-identical; corrupt it by hand and confirm
   `git diff --exit-code` returns non-zero; run the generator twice and confirm
   zero drift (idempotent).

A generator without steps 5–7 is a convenience script, not a fix — the staleness
gap stays open.

---

## Deliberate exceptions — still hand-maintained

Do **not** "fix" these by generating them. They are broader or different-purpose
lists, not mirrors:

| File                                                            | Why it stays hand-written                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asyar-sdk/cli/lib/manifest.ts` `VALID_PERMISSIONS`             | Deliberately broader than the Rust gate — includes declarative-only permissions (`store:read`, `tools:register`, `runs:track`) that `get_required_permission` never sees. No single Rust source exists. |
| `asyar-launcher/src/services/extension/permissionCatalog.ts`    | Human-written display copy (title + description) for the consent dialog. Prose, not data.                                                                                                               |
| `docs/reference/permissions.md`, `docs/reference/sdk/README.md` | Hand-written developer docs that mirror the lists in prose. Known to drift; grep them when adding a permission.                                                                                         |

### Adding a new permission — the full checklist

One new `<namespace>:<action>` string still touches five surfaces. Only the
generated one is automatic:

```
1. src-tauri/src/permissions.rs        ← THE source. Enforcement lives here.
2. run gen:permission-catalog          ← writes both gatedPermissions.ts copies
3. asyar-sdk/cli/lib/manifest.ts       ← VALID_PERMISSIONS, by hand
                                          (then `npm run build:cli` — the linked
                                           `asyar` binary runs dist/, not src/)
4. permissionCatalog.ts                ← title + description, by hand
5. docs/reference/permissions.md       ← the table, by hand
```

Enforcement is **Rust only** — `permissions.rs` is the single gate. Steps 3–5
are catalog, consent copy, and docs; none of them enforce anything. The gate
fails closed on any call type that `get_required_permission` and
`is_public_call` both miss.

---

## Red flags — you are violating this skill

- Editing a file whose first line says `AUTO-GENERATED` or `generated by Specta`.
- Writing `// keep in sync with` above a TS array.
- Running `prettier --write` on a file listed in `.prettierignore`.
- Adding a `#[derive(specta::Type)]` struct and hand-writing the matching TS
  `type` instead of `.register()`-ing it in `export_bindings` and regenerating.
  (This exact miss made `commands.ts` hand-roll a parallel `SystemActionId`
  union while the real type sat unregistered.)
- Changing `permissions.rs` / `error.rs` / `catalog.fallback.json` and calling
  the task done without running a generator or a test.
- Reporting a generated-file CI diff as "unrelated" or "pre-existing."

**If you catch yourself doing any of these: STOP.** Find the source, edit that,
regenerate.
