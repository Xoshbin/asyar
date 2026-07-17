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
brew trust --tap xoshbin/asyar   # required once — see note below
brew install --cask asyar
```

This is a self-owned tap, not the official `homebrew-cask` repo — submitting there
later requires clearing Homebrew's notability bar, which isn't worth blocking on yet.

> **Homebrew 6.0+ tap trust:** any tap other than `homebrew/core`/`homebrew/cask` is
> refused by default ("Refusing to load cask ... from untrusted tap") until the user
> runs `brew trust --tap xoshbin/asyar` (or `brew trust --cask xoshbin/asyar/asyar`
> for just the cask). This is enforced by `HOMEBREW_REQUIRE_TAP_TRUST`, which is
> on by default as of brew 6.0 — not something we configure. **Any public-facing
> install instructions (website, README, discussion replies) must include the
> `brew trust` line**, or first-time installers hit a dead end. See
> [docs.brew.sh/Tap-Trust](https://docs.brew.sh/Tap-Trust).

### One-time setup (done — 2026-07-17)

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

The secret is in place, so the `Update Homebrew Cask` step in `release-launcher.yml`
fires on every future `v*` release automatically. If the tap ever needs re-seeding
(e.g. a new repo after a rename), redo steps 1–2; the step self-skips instead of
failing if `HOMEBREW_TAP_TOKEN` is ever missing.

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
  Windows/Linux package managers (winget, Flatpak, AUR, …) are tracked separately —
  winget is covered below; Flatpak/AUR aren't wired up yet.

## Distributing via winget

Every **stable** launcher release also opens/updates a manifest PR against the official
[`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs) repo, so Windows users
can:

```powershell
winget install Xoshbin.Asyar
```

This targets the real community repo, not a personal fork like the Homebrew tap — there's
no equivalent of "just push to your own repo" here. The first submission has to clear
Microsoft's manifest validation + moderator review before this can be automated at all,
and winget-pkgs won't accept a package whose **only** available version is a pre-release
(see "Pre-release gating" below).

> **The MSI installers are not code-signed.** `build-windows` in the workflow only applies
> the Tauri updater signature (`TAURI_SIGNING_PRIVATE_KEY`) — that verifies auto-updates,
> it isn't an Authenticode/EV certificate. Expect winget/Windows to show a SmartScreen
> "unknown publisher" warning on install until the MSI is properly code-signed. This is a
> pre-existing gap, not something introduced by the winget submission — flagging it here
> since winget is the first channel where end users will actually notice it.

### Pre-release gating

Every Asyar release today is a numeric pre-release (`v0.1.1-N`, hyphenated). winget-pkgs
policy requires a package's default manifest to track a stable release — pre-release-only
packages aren't accepted as standalone entries (the convention for beta channels is a
_separate_ identifier, e.g. `Xoshbin.Asyar.Beta`, which isn't set up). So the `Update winget
manifest` step in `release-launcher.yml` checks the version and skips quietly (no failure)
for any hyphenated tag. **The winget channel goes live automatically the first time a real
`patch`/`minor`/`major` release ships** (a clean `vX.Y.Z` tag, no `beta` keyword) — no code
change needed when that happens.

### One-time setup (not done yet)

1. **Wait for the first stable release.** `wingetcreate`/Komac need at least one version
   merged into winget-pkgs to diff against for future updates, and winget-pkgs won't accept
   a pre-release-only submission (see above) — so this whole channel is blocked until the
   first non-hyphenated `vX.Y.Z` tag exists.
2. Fork [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs) under the
   `Xoshbin` account (`vedantmgoyal9/winget-releaser`'s default `fork-user` is the repo
   owner, i.e. `Xoshbin`, so no extra config is needed once the fork exists).
3. **Submit the first manifest manually** — this can't be automated, since the action only
   updates an _existing_ package. `wingetcreate` is Windows-only (it needs native Windows
   APIs to read the MSI, so it can't run on this Mac or in a Linux CI runner); either run it
   on a Windows machine/VM:
   ```powershell
   wingetcreate new `
     --urls "https://github.com/Xoshbin/asyar/releases/download/v<VERSION>/asyar_<VERSION>_x64_en-US.msi|x64" "https://github.com/Xoshbin/asyar/releases/download/v<VERSION>/asyar_<VERSION>_arm64_en-US.msi|arm64" `
     --version <VERSION>
   ```
   (it will prompt for the remaining fields — Publisher `Xoshbin`, PackageIdentifier
   `Xoshbin.Asyar`, License `AGPL-3.0`, Homepage `https://asyar.org`) — or open a manifest
   PR by hand against `manifests/x/Xoshbin/Asyar/<VERSION>/` following an existing package's
   layout as a template. Either way it goes through winget-pkgs' normal validation +
   moderator review like any other new package, so budget for review turnaround time.
4. Once that PR merges, generate a **classic** GitHub PAT (Settings → Developer settings →
   Personal access tokens → **Tokens (classic)**) with the `public_repo` scope. Fine-grained
   PATs aren't supported by `winget-releaser` (Komac can create the manifest/commit with one,
   but can't open the PR).
5. Add it as a secret named `WINGET_TOKEN` on the `Xoshbin/asyar` repo
   (Settings → Secrets and variables → Actions).

Once `WINGET_TOKEN` is set and a stable release exists in winget-pkgs, the `Update winget
manifest` step fires on every future stable release automatically; it keeps skipping quietly
on pre-releases and on any release before step 5 is done.

### Notes

- Unlike the Homebrew step (a `run:` bash block that can `exit 0` mid-script), submission
  goes through the `vedantmgoyal9/winget-releaser@v2` marketplace action, which does its own
  MSI inspection via Komac — not worth reimplementing in bash. The "skip quietly" behavior is
  instead a separate `Check winget eligibility` step whose output gates the submission step's
  `if:`.
- The step lives in this same `publish` job rather than a second workflow triggered on
  `on: release`, even though that's the trigger `winget-releaser`'s own docs show. The
  `Create GitHub Release` step above publishes using the default `GITHUB_TOKEN`, and GitHub
  does not fire a fresh workflow run off events created by that token — a separate
  `on: release`-triggered workflow would simply never start. Running as a step here sidesteps
  that entirely.
- Only the Windows MSI artifacts matter here — macOS/Linux users aren't affected by winget at
  all.
- **Not verified end-to-end.** Unlike the Homebrew Cask (confirmed with a real local
  `brew install --cask` on this machine), there's no Windows box here to actually test-install
  a winget package, and the first real submission needs a stable release + manual review
  that hasn't happened yet. What _was_ checked: the workflow YAML passes `actionlint`, the
  action repo/tag (`vedantmgoyal9/winget-releaser@v2`) and its required inputs were confirmed
  against its current README, and the `Xoshbin`/`Asyar` manifest path
  (`manifests/x/Xoshbin/Asyar/`) doesn't already exist in winget-pkgs (checked via the GitHub
  API). Treat the first real submission as the actual test.

## Distributing via a CLI install script

Closes the original ask in [discussion #315](https://github.com/Xoshbin/asyar/discussions/315)
("can I install Asyar from the CLI?"). macOS and Linux users can run:

```bash
curl -fsSL https://raw.githubusercontent.com/Xoshbin/asyar/main/install.sh | sh
```

This downloads and runs [`install.sh`](install.sh) from the repo root, which detects the
OS/arch, queries the GitHub Releases API for the newest release, downloads the matching
asset, and installs it — no Homebrew, no `brew trust` step, no manual `.dmg`/`.AppImage`
handling. To pin a specific version instead of the newest one:

```bash
ASYAR_VERSION=0.1.1-38 curl -fsSL https://raw.githubusercontent.com/Xoshbin/asyar/main/install.sh | sh
```

### Scope decisions

- **macOS + Linux only, no `install.ps1`.** Windows already has an ad hoc PowerShell snippet
  from discussion #315 and a real package-manager path (winget, once a stable release ships).
  macOS + Linux had no package-manager-free CLI path before this — Homebrew exists but is
  macOS-only and needs the extra `brew trust` step (see above). If a Windows one-liner is
  wanted later, it's a separate `install.ps1`, not part of this script.
- **Linux: AppImage only, no `.deb` detection.** The release also publishes `.deb` assets, but
  adding distro detection (`apt` vs. not), sudo escalation for `dpkg -i`, and a different
  install location would roughly double the script's surface for marginal gain — the
  AppImage is distro-agnostic by design (the same reason discussion #315's original answer
  picked it), needs no root, and already covers both `aarch64`/`amd64`. It's installed to
  `~/.local/bin/asyar` (override with `ASYAR_INSTALL_DIR`), with a PATH check that prints the
  `export PATH=...` line to add if `~/.local/bin` isn't already on it.
- **No update-checking, always (re)installs.** Asyar already has its own auto-updater, so this
  script's job is first-install, not staying current — the same reasoning the Homebrew section
  gives for `auto_updates true`. If an install already exists (`/Applications/asyar.app` on
  macOS, `~/.local/bin/asyar` on Linux) the script prints its detected version and replaces it
  rather than prompting; a `curl | sh` pipe has no interactive terminal to prompt against
  safely, and re-running to force a clean reinstall is itself a reasonable use case.
- **GitHub's `/releases/latest` isn't used.** Every Asyar release so far is a numeric
  pre-release (`v0.1.1-N`, hyphenated tag), and `/releases/latest` explicitly excludes
  pre-releases — it 404s today. The script queries the plain release list with `per_page=1`
  and takes the newest entry instead, with no `jq` dependency (asset URLs are pulled out of
  the JSON with `grep`/`sed`, matched against the confirmed real asset names — macOS:
  `asyar_{version}_aarch64.dmg` / `asyar_{version}_x64.dmg`; Linux: `asyar_{version}_aarch64.AppImage`
  / `asyar_{version}_amd64.AppImage` — note the arch-naming inconsistency between the two:
  macOS uses `x64`, Linux AppImage uses `amd64`, and the Linux `.deb` assets use `arm64`
  rather than `aarch64`).
- Written in POSIX `sh`, not bash — the documented invocation pipes into `sh`, which is
  `dash` on Debian/Ubuntu, not bash. No arrays, no `[[ ]]`, no bashisms. Checked with
  `shellcheck -s sh install.sh` (clean); `shfmt` isn't installed in this repo so there's no
  auto-formatter for it, matching the "no existing shell lint convention" state noted when
  this was scoped.

## When a release fails

Every step is re-runnable without burning a version number. If a CI run fails
(npm publish, a build target, the website notify), fix the cause and re-run the
workflow with the **same tag**: GitHub → **Actions** → the workflow →
**Run workflow** (workflow_dispatch) → enter the existing tag. A `concurrency`
guard prevents two runs of the same tag from colliding, npm publish is
idempotent, and the asyar.org notify upserts by version — so re-running is always
safe.

### Symptom → recovery

| Scenario                                                                           | What's safe                                                                              | Recovery                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK `npm publish` fails (bad token / version exists / network)                     | Tag + bump on the release branch/PR; npm unchanged                                       | Fix the cause → re-run **release-sdk.yml** via _Run workflow_ with the same tag. Publish is idempotent: it skips if the version is already on npm.                                                                                                                                                      |
| One launcher build target fails (flaky notarization / runner down)                 | Other artifacts built; nothing published yet                                             | Re-run **release-launcher.yml** via _Run workflow_ with the same tag — no new version. The concurrency guard prevents races.                                                                                                                                                                            |
| Website notify fails (asyar.org down / bad token)                                  | GitHub Release already created; updater feed stale                                       | The job **fails loudly** (red). Re-run via _Run workflow_; the notify endpoint upserts by version, so it's safe to repeat.                                                                                                                                                                              |
| Homebrew cask push fails (bad token / tap repo down)                               | GitHub Release + website notify already done; tap just stale                             | Re-run via _Run workflow_ with the same tag — the step overwrites `Casks/asyar.rb` unconditionally, so it's safe to repeat. If `HOMEBREW_TAP_TOKEN` isn't set yet, the step no-ops instead of failing.                                                                                                  |
| winget manifest step fails (bad token / Komac error / stale fork)                  | GitHub Release + website notify + Homebrew already done; winget-pkgs untouched or mid-PR | Check the `Xoshbin` winget-pkgs fork for an already-open PR for this version first (avoid duplicates), then re-run via _Run workflow_ with the same tag. Skips quietly (not a failure) if `WINGET_TOKEN` isn't set yet or the tag is a pre-release.                                                     |
| `install.sh` fails for a user (asset match broken, network, GitHub API rate limit) | Not part of the release pipeline — nothing published is affected, no version to re-tag   | Fix `install.sh` directly on `main`; no tag/version bump needed, since the raw URL always serves current `main`. If it's GitHub's unauthenticated API rate limit (60 req/hr per IP), the workaround is downloading the matching asset from the Releases page directly instead of re-running the script. |
| Tag pushed by mistake / wrong version                                              | —                                                                                        | `git push --delete origin <tag>`, delete the GitHub release, then re-release. The duplicate-tag guard otherwise blocks a duplicate version.                                                                                                                                                             |
| Launcher release while npm is down                                                 | N/A                                                                                      | Not a failure mode — the launcher reads the SDK version from local `asyar-sdk/package.json`.                                                                                                                                                                                                            |
| A release script half-finished locally (Ctrl-C / error mid-run)                    | The script cleans up its leftover local branch/tag on the next run                       | Run it again (`--dry-run` first to preview); the duplicate-tag guard blocks an accidental re-release of the same version.                                                                                                                                                                               |

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
