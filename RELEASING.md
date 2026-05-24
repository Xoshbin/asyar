# Releasing Asyar

This monorepo contains two independently-released packages. Each has its own flow:

| Package | Trigger | Destination |
|---|---|---|
| **Launcher** (`asyar-launcher/`) | Push a `v*` tag | GitHub Releases + asyar.org updater feed |
| **SDK** (`asyar-sdk/`) | Push to `main` with a recorded changeset | npm: [`asyar-sdk`](https://www.npmjs.com/package/asyar-sdk) |

---

## Releasing the launcher (desktop app)

The launcher uses a release helper script that keeps `package.json` and `src-tauri/Cargo.toml` versions in sync.

### How to release

From inside `asyar-launcher/`:

```bash
cd asyar-launcher
pnpm run release <keyword|version>
```

Or from the monorepo root:

```bash
pnpm --filter asyar-launcher run release <keyword|version>
```

### 1. Using keywords (recommended)

| Keyword | Bump | Example |
|---|---|---|
| `patch` | x.y.Z | `0.1.0` → `0.1.1` |
| `minor` | x.Y.0 | `0.1.0` → `0.2.0` |
| `major` | X.0.0 | `1.0.0` → `2.0.0` |
| `beta` | numeric pre-release | `0.1.0` → `0.1.0-1`, `0.1.0-1` → `0.1.0-2` |

### 2. Manual versioning

You can pass an explicit version string (e.g., `pnpm run release 0.3.4`), but it must follow the **Windows MSI rule** below.

#### ⚠️ The Windows MSI rule

Windows MSI installers (bundled via WiX) have a strict requirement for version numbers:

- **Any pre-release identifier must be numeric-only.**
- Identifiers like `0.1.0-beta` are **NOT allowed** and will fail the Windows CI build.
- Always use numeric suffixes like `0.1.0-1` instead.

### What the release script does

1. **Version sync**: bumps `asyar-launcher/package.json` and `asyar-launcher/src-tauri/Cargo.toml`
2. **Git operations**: stages, commits (`chore: bump version to X.Y.Z`), tags `vX.Y.Z`, pushes to GitHub
3. **CI trigger**: the `v*` tag triggers `.github/workflows/release-launcher.yml`
4. **Build matrix**: macOS universal, Windows x64/arm64, Linux amd64/arm64
5. **Draft Release**: created with auto-generated notes
6. **Pre-release detection**: tags with a hyphen (e.g., `v0.1.0-1`) are marked as "Pre-release"
7. **Updater notification**: asyar.org `/api/releases` is notified so the auto-update feed picks up the new version

### Manual steps after CI

1. Visit the [Releases page](https://github.com/Xoshbin/asyar/releases)
2. Review the Draft Release and its auto-generated notes
3. Click **Publish Release** to make the update live for users

---

## Releasing the SDK (npm package)

The SDK uses a release helper script mirroring the launcher's, with one distinguishing detail: SDK tags are prefixed `sdk-v*` (the launcher owns `v*`).

### How to release

From inside `asyar-sdk/`:

```bash
cd asyar-sdk
pnpm run release <keyword|version>
```

Or from the monorepo root:

```bash
pnpm release:sdk <keyword|version>
# equivalent to: pnpm --filter asyar-sdk run release <keyword|version>
```

### 1. Using keywords (recommended)

Same keyword semantics as the launcher's flow:

| Keyword | Bump | Example |
|---|---|---|
| `patch` | x.y.Z | `2.7.0` → `2.7.1` |
| `minor` | x.Y.0 | `2.7.0` → `2.8.0` |
| `major` | X.0.0 | `2.7.0` → `3.0.0` |
| `beta` | numeric pre-release | `2.7.0` → `2.7.0-1`, `2.7.0-1` → `2.7.0-2` |

### 2. Manual versioning

Pass an explicit version (e.g., `pnpm run release 2.8.0`). Pre-release suffixes must be numeric-only (`2.8.0-1`, not `2.8.0-beta`) — the same constraint as the launcher, even though the SDK doesn't ship a Windows installer, kept for ecosystem consistency.

### What the release script does

1. **Version bump**: updates `asyar-sdk/package.json`
2. **Lockfile sync**: runs `pnpm install` at the monorepo root
3. **Git operations**: stages, commits (`chore(sdk): release X.Y.Z`), tags as `sdk-vX.Y.Z`, pushes to GitHub
4. **CI trigger**: the `sdk-v*` tag fires `.github/workflows/release-sdk.yml`
5. **Build + publish**: SDK is built (`pnpm run build:all`) and published to npm via `npm publish`
6. **GitHub Release**: created with auto-generated release notes; tags containing a hyphen (e.g., `sdk-v2.8.0-1`) are marked **Pre-release**

### Required GitHub secret

The SDK release workflow needs `NPM_TOKEN` configured at **Settings → Secrets and variables → Actions** with publish rights for `asyar-sdk`. Generate an "Automation" token at [npmjs.com/settings/Xoshbin/tokens](https://www.npmjs.com/settings/Xoshbin/tokens).

---

## Quick reference

| To release… | Run |
|---|---|
| The launcher | `pnpm --filter asyar-launcher run release patch` (or `minor` / `major` / `beta` / an explicit `x.y.z`) — tag `v*` |
| The SDK | `pnpm release:sdk patch` (or `minor` / `major` / `beta` / an explicit `x.y.z`) — tag `sdk-v*` |
