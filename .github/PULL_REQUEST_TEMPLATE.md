## What changed

<!-- Describe the fix or feature in plain English from the user's or extension developer's POV. -->

- **Before (issue / current behavior):** <!-- How to reproduce or what happened previously -->
- **After (fix / new behavior):** <!-- What happens now and how to see it -->

## Affected areas

<!-- Check all that apply. -->

- [ ] Launcher UI / UX (visuals, interactions, keyboard shortcuts, settings)
- [ ] SDK / Extensions (`asyar-sdk`, extension runtime, IPC contracts, manifest)
- [ ] Rust Backend / Platform (Tauri commands, search, storage, OS integration)
- [ ] Docs / Tooling / Other (docs, CI, build scripts, locales)

## Manual smoke test & Validation

- [ ] I manually smoke-tested this in the running app (`pnpm dev`) and visually verified the fix/feature works.

<!-- Briefly describe what you tested in the running app and which automated checks ran (e.g. `pnpm check:ci`). Screenshots or recordings are optional but appreciated for UI changes. -->

## AI usage

<!-- Leave both boxes empty if no AI tool touched this change. -->

- [ ] AI tools helped produce this change.
- [ ] I ran the `asyar-contribution` skill (`.agents/skills/asyar-contribution/SKILL.md`), followed it, and reviewed every generated line.

## Boundaries

- [ ] Zero-hardcoded-strings i18n policy respected (if UI strings were added/changed).
- [ ] Third-party extension compatibility preserved (no breaking changes to published extension contracts without deprecation/boundary adapter).
- [ ] `pnpm check:ci` (or the relevant inner-loop checks) passes locally.
