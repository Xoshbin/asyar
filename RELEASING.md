# Releasing Asyar

This monorepo contains two independently-released packages. Each has its own flow:

| Package                          | Trigger             | Destination                                                                   |
| -------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| **Launcher** (`asyar-launcher/`) | Push a `v*` tag     | GitHub Releases + asyar.org updater feed                                      |
| **SDK** (`asyar-sdk/`)           | Push a `sdk-v*` tag | npm: [`asyar-sdk`](https://www.npmjs.com/package/asyar-sdk) + GitHub Releases |

---

> **Preview first.** Add `--dry-run` to any release command to print exactly what
> it would do (version, files, git commands) **without changing anything or
> touching the network**. The working tree must be clean before a real release —
> the script aborts with `✖ Working tree is not clean.` otherwise, so commit your
> work first.

## Releasing the launcher (desktop app)

The launcher uses a release helper script (a thin wrapper over the shared `scripts/release-lib.mjs`) that keeps every version reference in sync and never depends on npm.

### How to release

From the monorepo root:

```bash
pnpm --filter asyar-launcher run release <patch|minor|major|beta>   # add --dry-run to preview
```

Or from inside `asyar-launcher/`:

```bash
cd asyar-launcher
pnpm run release <patch|minor|major|beta>
```

### Keywords

| Keyword | Bump                | Example                                    |
| ------- | ------------------- | ------------------------------------------ |
| `patch` | x.y.Z               | `0.1.0` → `0.1.1`                          |
| `minor` | x.Y.0               | `0.1.0` → `0.2.0`                          |
| `major` | X.0.0               | `1.0.0` → `2.0.0`                          |
| `beta`  | numeric pre-release | `0.1.0` → `0.1.0-1`, `0.1.0-1` → `0.1.0-2` |

> The script always produces Windows-MSI-compatible version strings — pre-release suffixes are always numeric (`0.1.0-1`, never `0.1.0-beta`). No manual care needed.

### What the release script does

1. **Duplicate-tag guard**: aborts immediately if `vX.Y.Z` already exists on the remote, so a version is never released twice
2. **Local SDK version**: reads the SDK version from `asyar-sdk/package.json` on disk — **no npm call** (the workspace always builds the local SDK, so a release can't be blocked by npm being down)
3. **Version sync**: bumps `asyar-launcher/package.json` (its own version + the declared `asyar-sdk` dependency), `src-tauri/Cargo.toml`, `Cargo.lock`, the `scaffoldService.ts` offline fallback, and the root `pnpm-lock.yaml`
4. **Git operations**: commits on a new `release/vX.Y.Z` branch, opens a **PR**, and pushes the `vX.Y.Z` tag (it does _not_ push straight to `main`)
5. **CI trigger**: the `v*` tag triggers `.github/workflows/release-launcher.yml`
6. **Build matrix**: macOS arm64 + x64 (per-arch, not a universal binary), Windows x64/arm64, Linux amd64/arm64 — all 6 required
7. **GitHub Release**: published directly (not a draft) with auto-generated notes
8. **Pre-release detection**: tags with a hyphen (e.g., `v0.1.0-1`) are automatically marked "Pre-release"
9. **Updater notification**: asyar.org `/api/releases` is notified so the auto-update feed picks up the new version

> The Rust `SUPPORTED_SDK_VERSION` is **not** set by the release script — `src-tauri/build.rs` injects it at compile time from the local `asyar-sdk/package.json`, so it can never drift.

### Manual step after CI

The tag triggers the build from the `release/vX.Y.Z` branch, so the installers always carry the correct version even before the PR is merged. After CI is green:

1. **Merge the release PR.** This lands the version bump on `main` so the _next_ release calculates from the right number.

That's it — the GitHub Release and the asyar.org updater feed are published automatically.

---

## Releasing the SDK (npm package)

The SDK uses a release helper script mirroring the launcher's, with one distinguishing detail: SDK tags are prefixed `sdk-v*` (the launcher owns `v*`).

### How to release

From the monorepo root:

```bash
pnpm release:sdk <patch|minor|major|beta>
# equivalent to: pnpm --filter asyar-sdk run release <patch|minor|major|beta>
```

Or from inside `asyar-sdk/`:

```bash
cd asyar-sdk
pnpm run release <patch|minor|major|beta>
```

### Keywords

Same semantics as the launcher's flow:

| Keyword | Bump                | Example                                    |
| ------- | ------------------- | ------------------------------------------ |
| `patch` | x.y.Z               | `2.7.0` → `2.7.1`                          |
| `minor` | x.Y.0               | `2.7.0` → `2.8.0`                          |
| `major` | X.0.0               | `2.7.0` → `3.0.0`                          |
| `beta`  | numeric pre-release | `2.7.0` → `2.7.0-1`, `2.7.0-1` → `2.7.0-2` |

### What the release script does

1. **Duplicate-tag guard**: aborts if `sdk-vX.Y.Z` already exists on the remote
2. **Version bump**: updates `asyar-sdk/package.json`
3. **Lockfile sync**: runs `pnpm install` at the monorepo root
4. **Git operations**: commits on a new `release/sdk-vX.Y.Z` branch, opens a **PR**, and pushes the `sdk-vX.Y.Z` tag
5. **CI trigger**: the `sdk-v*` tag fires `.github/workflows/release-sdk.yml`
6. **Build + publish**: SDK is built (`pnpm run build:all`) and published to npm — the publish step is **idempotent** (it skips if that version is already on npm, so a re-run is always safe)
7. **GitHub Release**: created with auto-generated release notes; tags containing a hyphen (e.g., `sdk-v2.8.0-1`) are marked **Pre-release**

After CI is green, **merge the release PR** to land the version bump on `main`.

### Required GitHub secret

The SDK release workflow needs `NPM_TOKEN` configured at **Settings → Secrets and variables → Actions** with publish rights for `asyar-sdk`. Generate an "Automation" token at [npmjs.com/settings/Xoshbin/tokens](https://www.npmjs.com/settings/Xoshbin/tokens).

---

## Distributing via Homebrew

Every launcher release also pushes an updated Cask to a personal tap,
[`Xoshbin/homebrew-asyar`](https://github.com/Xoshbin/homebrew-asyar), so users can:

```bash
brew tap Xoshbin/asyar
brew install --cask asyar
```

This is a self-owned tap, not the official `homebrew-cask` repo — submitting there
later requires clearing Homebrew's notability bar, which isn't worth blocking on yet.

### One-time setup (not done yet)

1. Create an empty public GitHub repo named exactly `homebrew-asyar` under the
   `Xoshbin` account (the `homebrew-` prefix is what makes `brew tap Xoshbin/asyar`
   resolve to it).
2. Seed it with `Casks/asyar.rb` — grab the current version of that file from the
   most recent `Update Homebrew Cask` CI run, or generate one by hand for the
   current release (see the step's heredoc in `.github/workflows/release-launcher.yml`
   for the exact template).
3. Generate a fine-grained GitHub PAT scoped to **only** the `homebrew-asyar` repo
   with `Contents: Read and write` permission.
4. Add it as a secret named `HOMEBREW_TAP_TOKEN` on the `Xoshbin/asyar` repo
   (Settings → Secrets and variables → Actions).

Once the secret exists, the `Update Homebrew Cask` step in `release-launcher.yml`
starts firing on every future `v*` release — no further action needed. Until then it
detects the missing secret and skips itself without failing the release.

### Notes

- Every launcher release today is a numeric pre-release (`v0.1.1-N`); since this is
  a personal tap, the Cask tracks those too — there's no separate "stable" filter.
  A `livecheck` block for `brew bump-cask-pr`-style automation isn't included
  because Homebrew's `github_latest` strategy only resolves GitHub's `/releases/latest`,
  which excludes prereleases entirely — it would find nothing.
- `auto_updates true` is set because Asyar has its own updater (the asyar.org feed).
  Brew is the _install_ channel; the app's own updater is the _stay current_ channel.
  This also means plain `brew upgrade` skips it — that's intentional, not a bug.
- Only the two macOS `.dmg` artifacts are needed (Homebrew Cask is macOS-only);
  Linux/Windows package managers (winget, Flatpak, AUR, …) are tracked separately.

## When a release fails

Every step is re-runnable without burning a version number. If a CI run fails
(npm publish, a build target, the website notify), fix the cause and re-run the
workflow with the **same tag**: GitHub → **Actions** → the workflow →
**Run workflow** (workflow_dispatch) → enter the existing tag. A `concurrency`
guard prevents two runs of the same tag from colliding, npm publish is
idempotent, and the asyar.org notify upserts by version — so re-running is always
safe.

### Symptom → recovery

| Scenario                                                           | What's safe                                                        | Recovery                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDK `npm publish` fails (bad token / version exists / network)     | Tag + bump on the release branch/PR; npm unchanged                 | Fix the cause → re-run **release-sdk.yml** via _Run workflow_ with the same tag. Publish is idempotent: it skips if the version is already on npm.                                                     |
| One launcher build target fails (flaky notarization / runner down) | Other artifacts built; nothing published yet                       | Re-run **release-launcher.yml** via _Run workflow_ with the same tag — no new version. The concurrency guard prevents races.                                                                           |
| Website notify fails (asyar.org down / bad token)                  | GitHub Release already created; updater feed stale                 | The job **fails loudly** (red). Re-run via _Run workflow_; the notify endpoint upserts by version, so it's safe to repeat.                                                                             |
| Homebrew cask push fails (bad token / tap repo down)               | GitHub Release + website notify already done; tap just stale       | Re-run via _Run workflow_ with the same tag — the step overwrites `Casks/asyar.rb` unconditionally, so it's safe to repeat. If `HOMEBREW_TAP_TOKEN` isn't set yet, the step no-ops instead of failing. |
| Tag pushed by mistake / wrong version                              | —                                                                  | `git push --delete origin <tag>`, delete the GitHub release, then re-release. The duplicate-tag guard otherwise blocks a duplicate version.                                                            |
| Launcher release while npm is down                                 | N/A                                                                | Not a failure mode — the launcher reads the SDK version from local `asyar-sdk/package.json`.                                                                                                           |
| A release script half-finished locally (Ctrl-C / error mid-run)    | The script cleans up its leftover local branch/tag on the next run | Run it again (`--dry-run` first to preview); the duplicate-tag guard blocks an accidental re-release of the same version.                                                                              |

**Notes**

- Launcher publish intentionally requires **all 6** targets — the auto-updater feed must never be half-published. The improvement is one-click recovery, not relaxing that invariant.
- The build runs from the tag (the release branch's bump commit), so released binaries always carry the right version even before the PR merges. Merge the release PR so `main` carries the bump and the next release calculates correctly.

> This table is also kept standalone at [`docs/how-to/release-recovery.md`](docs/how-to/release-recovery.md) for quick reference during an incident.

## Quick reference

| To release…             | Run                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The launcher            | `pnpm --filter asyar-launcher run release patch` (or `minor` / `major` / `beta`; add `--dry-run` to preview) — tag `v*` |
| The SDK                 | `pnpm release:sdk patch` (or `minor` / `major` / `beta`; add `--dry-run` to preview) — tag `sdk-v*`                     |
| Re-run a failed release | GitHub → Actions → the workflow → **Run workflow** → same tag                                                           |
