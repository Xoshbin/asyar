---
name: asyar-contribution
description: Prepare a pull request for Asyar-Project. Use when an AI tool helped produce a change, or when preparing a PR description, running local CI checks, and verifying Asyar's contribution conditions before opening a PR.
---

# Asyar Contribution Workflow

Follow this workflow before opening or updating a pull request in `Asyar-Project`.

## 1. Inspect Scope & Affected Areas

Run `git status` and `git diff --stat main...HEAD` (or against the base branch) to see every modified file and classify the PR:

- **Launcher UI / UX**: `asyar-launcher/src/**` (Svelte components, CSS/tokens, shortcuts, settings, i18n)
- **SDK / Extensions**: `asyar-sdk/**`, `asyar-ext-builder/**`, `extensions/**`, or IPC contracts
- **Rust Backend / Platform**: `asyar-launcher/src-tauri/**`
- **Docs / Tooling / Other**: `docs/**`, `scripts/**`, `.github/**`, `asyar-launcher/src/locales/**`

## 2. Run Verification

Run the local CI suite matching your changes:

- Full check (recommended before PR): `pnpm check:ci`
- Fast domain check while iterating: `pnpm check:ci:changed`

Verify that:

- Zero-hardcoded-strings i18n policy is respected (use `t()` from `src/services/i18n` for any user-facing strings).
- No breaking changes were introduced to published third-party extension contracts without a deprecation/compatibility adapter.
- Hot paths remain fast and unblocked (window reveal, keystroke search, and 120 FPS UI responsiveness).
- All modified files are formatted (`pnpm format` / `cargo fmt`).

## 3. Confirm Manual Smoke Test (Required for Code Changes)

Automated tests do not replace visually verifying the running app.

- Ask the contributor what they manually smoke-tested in `pnpm dev` and what they observed (**Before → After**), unless they already told you.
- Never check the `I manually smoke-tested this in the running app` box unless the contributor actually ran and verified it.
- Screenshots or screen recordings are optional (encouraged for UI changes, never required).

## 4. Draft & Validate the PR Description

Write a concise PR description matching `.github/PULL_REQUEST_TEMPLATE.md` so a reviewer can understand the change in seconds without reading every diff:

1. **What changed**: Plain-English summary from the **user's or extension developer's POV**, with explicit **Before** and **After** behavior.
2. **Affected areas**: Check all matching areas.
3. **Manual smoke test & Validation**: Checked confirmation + what was visually tested in `pnpm dev` + which automated checks passed.
4. **AI usage**: Check **both** `AI tools helped produce this change.` and `I ran the asyar-contribution skill...` (and ensure the contributor reviewed every generated line).
5. **Boundaries**: Tick each boundary you actually verified. If one doesn't hold or you couldn't verify it (e.g. `pnpm check:ci` fails on something unrelated), leave it unchecked and add a short note. Honesty beats a fully ticked list.

CI (`scripts/check-pr.mjs`) only gates on a non-empty `What changed` and a consistent `AI usage` section; the reviewer reads the rest.

Validate the drafted PR body locally before posting:

```bash
node scripts/check-pr.mjs --body-file <path-to-draft.md>
```
