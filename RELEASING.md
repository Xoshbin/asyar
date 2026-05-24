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

The SDK uses [Changesets](https://github.com/changesets/changesets) for versioning and npm publishing.

> **Note:** The SDK no longer uses a `pnpm run release` script or a `v*` tag — that flow was retired during the monorepo migration. Use changesets instead.

### How to record a release

For any SDK change worth publishing, run from the monorepo root:

```bash
pnpm changeset
```

Answer the interactive prompts:
- **Which packages changed** → select `asyar-sdk` (the launcher is ignored by changesets — see `.changeset/config.json`)
- **Bump type** → `patch`, `minor`, or `major` (standard semver)
- **Description** → one or two lines that will appear in the changelog

This writes a markdown file under `.changeset/` (e.g., `.changeset/honest-rabbits-clap.md`). Commit it alongside your code change:

```bash
git add .changeset/*.md asyar-sdk/
git commit -m "feat(sdk): describe the change"
git push
```

### What happens next

1. On push to `main`, `.github/workflows/release-sdk.yml` runs
2. It detects pending `.changeset/*.md` files and opens a **"Release asyar-sdk"** PR that:
   - Bumps the version in `asyar-sdk/package.json`
   - Updates `asyar-sdk/CHANGELOG.md`
   - Removes the consumed `.changeset/*.md` files
3. Review and merge the PR
4. The next workflow run sees the bumped version with no pending changesets and publishes to npm

### Docs-only / no-release SDK changes

If your SDK change shouldn't trigger a release (docs-only edit, internal refactor):

```bash
pnpm changeset --empty
```

This records an empty changeset that satisfies the workflow without bumping the version or publishing.

### Required GitHub secret

The SDK release workflow needs `NPM_TOKEN` configured at **Settings → Secrets and variables → Actions** with publish rights for `asyar-sdk`. Generate an "Automation" token at [npmjs.com/settings/Xoshbin/tokens](https://www.npmjs.com/settings/Xoshbin/tokens).

---

## Quick reference

| To release… | Run |
|---|---|
| The launcher | `pnpm --filter asyar-launcher run release patch` (or `minor` / `major` / `beta` / an explicit `x.y.z`) |
| The SDK | `pnpm changeset` (interactive), commit, push — then merge the auto-generated release PR |
