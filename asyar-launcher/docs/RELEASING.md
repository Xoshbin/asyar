# Releasing Asyar

This project uses an automated release script to keep versions in sync between the frontend and the Rust backend.

## How to Release

From the project root, run:
```bash
pnpm run release <keyword|version>
```

### 1. Using Keywords (Recommended)
The release script supports automatic version bumping via the following keywords:
- `patch`: (e.g., `0.1.0` → `0.1.1`)
- `minor`: (e.g., `0.1.0` → `0.2.0`)
- `major`: (e.g., `1.0.0` → `2.0.0`)
- `beta`: **Safe for Windows.** Increments or adds a numeric pre-release suffix (e.g., `0.1.0` → `0.1.0-1` or `0.1.0-1` → `0.1.0-2`).

### 2. Manual Versioning
You can provide an explicit version string (e.g., `pnpm run release 0.3.4`), but it must follow the **Windows MSI Rule**.

#### ⚠️ The Windows MSI Rule
Windows MSI installers (bundled via WiX) have a strict requirement for version numbers. 
- **Any pre-release identifier must be numeric-only.**
- Identifiers like `0.1.0-beta` are **NOT allowed** and will cause the Windows CI build to fail.
- Always use numeric suffixes like `0.1.0-1` instead.

---

## Release Process Automation

When you run the release script, it performs the following steps automatically:

1.  **Version Synchronization**: Checks the current version in `package.json` and updates both `package.json` and `src-tauri/Cargo.toml`.
2.  **Git Operations**: Stages the changes, creates a commit (`chore: bump version to X.Y.Z`), creates a tag (`vX.Y.Z`), and pushes both to GitHub.
3.  **GitHub CI Trigger**:
    - The push of a `v*` tag triggers the `.github/workflows/release.yml` workflow.
    - **Draft Release**: The workflow builds binaries for macOS, Windows, and Linux, and then creates a **Draft** GitHub Release.
    - **Pre-release Detection**: If the tag contains a hyphen (e.g., `v0.1.0-1`), the GitHub Release is automatically marked with the **"Pre-release"** flag.
4.  **Update Notification**: Finally, the CI notifies the `asyar.org` update server of the new available version.

## Manual Steps After CI
After the GitHub Action completes successfully:
1.  Go to the [Releases](https://github.com/Xoshbin/asyar-launcher/releases) page.
2.  Review the Draft Release and its auto-generated notes.
3.  Click **Publish Release** to make the update live for users.
