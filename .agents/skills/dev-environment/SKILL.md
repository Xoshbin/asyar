---
name: dev-environment
description: Reference for the Asyar monorepo structure, SDK workspace linking, lockfile discipline, CI workflows, and release flow. Use this skill whenever working on anything related to pnpm workspace setup, the asyar-sdk dependency, lockfile errors, SDK or launcher version bumps, CI configuration, release workflow, or questions about how local dev differs from CI. Also triggers for "how does the workspace work", "how do I update the SDK version", "where do I run pnpm install", or any confusion about the monorepo layout.
---

# Asyar Development Environment

## Repository Structure

Asyar lives in a single monorepo at **`github.com/Xoshbin/asyar`** (cloned locally at `~/develop/Asyar-Project/`):

```
asyar/                       ← monorepo root (this IS the GitHub repo)
├── package.json             ← root scripts (gen:all, release:sdk) + engines
├── pnpm-workspace.yaml      ← workspace members, overrides, supported architectures
├── pnpm-lock.yaml           ← the ONLY lockfile (workspace-wide)
├── setup.mjs                ← one-command dev setup (clones bundled extensions, installs deps, builds the SDK, verifies)
├── scripts/                 ← workspace orchestration: dev.mjs, build.mjs, check.mjs, build-all.mjs
├── docs/                    ← developer documentation (Diátaxis: tutorials/, how-to/, reference/, explanation/, guide/)
├── .github/workflows/       ← CI lives at the root
│   ├── test-and-lint.yml
│   ├── release-launcher.yml
│   ├── release-sdk.yml
│   └── codeql.yml
├── asyar-launcher/          ← the Tauri desktop app (package name is "asyar", not "asyar-launcher")
│   ├── package.json         ← declares "asyar-sdk": "^4.x.x" (real NPM version)
│   ├── src-tauri/Cargo.toml ← Rust side, version-synced with package.json
│   └── scripts/             ← release.js, the two generators, CI-facing *.test.mjs guards
├── asyar-sdk/               ← the SDK (in-tree subdir, NOT a separate repo)
│   ├── cli/                 ← the `asyar` CLI, published with the SDK
│   └── scripts/release.mjs  ← SDK release helper
├── asyar-ext-builder/       ← Bun-compiled sidecar binary for the AI extension builder (Claude Agent SDK)
├── browser-companions/      ← browser extensions for the browser bridge
├── benchmarks/              ← Raycast-vs-Asyar benchmark harness
└── extensions/              ← gitignored; setup.mjs clones the dogfood extensions here
```

Workspace members are `asyar-launcher`, `asyar-sdk`, `extensions/*`, and
`asyar-launcher/src/extensions/*`.

**Key shift from the pre-2026-05-24 multi-repo setup:** `asyar-launcher` and `asyar-sdk` are no longer their own GitHub repos. They're subdirectories of the monorepo. The old `Xoshbin/asyar-sdk` and `Xoshbin/asyar-meta` repos are archived.

## SDK Dependency: workspace-linked everywhere

Both local dev AND CI now use the in-tree SDK. `pnpm-workspace.yaml` contains:

```yaml
overrides:
  asyar-sdk: 'workspace:*'
```

This forces every package that declares `"asyar-sdk": "^4.x.x"` to resolve to the local `asyar-sdk/` source. The launcher's `package.json` still declares a real NPM version (currently `"asyar-sdk": "^4.6.0"`) for clarity, but the override ensures the workspace copy wins. After `pnpm install`, `asyar-launcher/node_modules/asyar-sdk` is a symlink to `../../asyar-sdk`.

**The override lives in `pnpm-workspace.yaml`, not in the root `package.json`.** pnpm 10 moved `overrides` (along with `allowBuilds` and `supportedArchitectures`) out of `package.json`. Editing a `pnpm.overrides` block in `package.json` does nothing — there isn't one.

**No more "Wait for SDK on NPM" step in CI** — the SDK is built locally during `pnpm install` via its `prepare` hook. The old workflow that polled npm for the SDK version was deleted during the migration.

## Lockfile Discipline

**There is exactly one lockfile: `pnpm-lock.yaml` at the monorepo root.** It captures the full workspace install (launcher + SDK + sample extensions). The per-package lockfiles left over from the multi-repo era have been deleted — do not recreate one by running `pnpm install` inside a subdirectory.

### The Rule

Whenever any `package.json` in the workspace changes, regenerate the lockfile from the **monorepo root**:

```bash
cd ~/develop/Asyar-Project
pnpm install
```

Commit the updated `pnpm-lock.yaml` (root) alongside the `package.json` change.

### `ERR_PNPM_OUTDATED_LOCKFILE` in CI

CI runs `pnpm install --frozen-lockfile`. If the root lockfile is stale relative to any package.json in the workspace, the install fails. Fix: `pnpm install` at the monorepo root locally, commit the updated lockfile.

## Release Flows

The launcher and SDK release **independently** via separate tag prefixes. **Always use the release scripts — never tag manually.**

### Launcher release (`v*` tag → GitHub Releases + asyar.org updater)

```bash
# From the monorepo root:
pnpm --filter asyar-launcher run release <patch|minor|major|beta>

# Or from inside the launcher:
cd asyar-launcher
pnpm run release <patch|minor|major|beta>
```

The script reads the SDK version from the local `asyar-sdk/package.json` (no NPM
call), bumps `asyar-launcher/package.json` (version + declared `asyar-sdk` dep),
`src-tauri/Cargo.toml`, `Cargo.lock`, and the `scaffoldService.ts` offline
fallback, syncs the root lockfile, then creates a `release/vX.Y.Z` branch, opens
a PR, and pushes the `vX.Y.Z` tag. The tag triggers `release-launcher.yml`
(build matrix → publish → asyar.org notify). The Rust `SUPPORTED_SDK_VERSION` is
injected at compile time by `src-tauri/build.rs`, not by the release script.
Add `--dry-run` to either release command to preview without pushing. If a
release CI run fails, re-run the workflow via _Run workflow_ (workflow_dispatch)
with the same tag — no new version needed.

### SDK release (`sdk-v*` tag → npm)

```bash
# Convenience alias from the monorepo root:
pnpm release:sdk <patch|minor|major|beta>

# Or from inside the SDK:
cd asyar-sdk
pnpm run release <patch|minor|major|beta>
```

Bumps `asyar-sdk/package.json`, syncs the root lockfile, commits, tags `sdk-vX.Y.Z`, pushes. `release-sdk.yml` builds the SDK and runs `npm publish`. A GitHub Release is created (Pre-release if the tag contains a hyphen).

**Required secret:** `NPM_TOKEN` (Automation type, with publish rights for `asyar-sdk`) configured at GitHub repo Settings → Secrets and variables → Actions.

### Tag namespace summary

| Tag prefix | Belongs to | Workflow               |
| ---------- | ---------- | ---------------------- |
| `v*`       | Launcher   | `release-launcher.yml` |
| `sdk-v*`   | SDK        | `release-sdk.yml`      |

Historical SDK tags from before the migration (`v1.x.x`, `v2.x.x`) were renamed to `sdk-v1.x.x`/`sdk-v2.x.x` so they fit the new convention.

## Quick Reference

| Question                                                                                              | Answer                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Where to run `pnpm install`                                                                           | Always the monorepo root                                                                                                |
| Why does the launcher's `package.json` say `"asyar-sdk": "^4.6.0"` but I see workspace-linked source? | `overrides` in `pnpm-workspace.yaml` forces `workspace:*`                                                               |
| `ERR_PNPM_OUTDATED_LOCKFILE` in CI                                                                    | Run `pnpm install` at the monorepo root, commit the root `pnpm-lock.yaml`                                               |
| How to release the launcher                                                                           | `pnpm --filter asyar-launcher run release patch` (or `minor`/`major`/`beta`)                                            |
| How to release the SDK                                                                                | `pnpm release:sdk patch` (or `minor`/`major`/`beta`)                                                                    |
| Where are the CI workflows                                                                            | `.github/workflows/` at the monorepo root                                                                               |
| Where are the launcher's old workflows                                                                | Removed during migration — `release-launcher.yml` replaced them; the launcher's nested `.github/workflows/` was deleted |
| Old `asyar-sdk` or `asyar-meta` GitHub repos                                                          | Archived; do not push to them. All work happens in `Xoshbin/asyar`.                                                     |
