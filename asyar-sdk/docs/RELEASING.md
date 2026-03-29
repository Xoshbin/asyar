# Releasing Asyar-SDK

This project uses an automated release script to increment the version, update dependencies, and trigger a publishing workflow.

## How to Release

From the project root, run:
```bash
pnpm run release <keyword|version>
```

### 1. Using Keywords (Recommended)
The release script supports automatic version bumping via the following keywords:
- `patch`: (e.g., `1.0.0` → `1.0.1`)
- `minor`: (e.g., `1.0.0` → `1.1.0`)
- `major`: (e.g., `1.0.0` → `2.0.0`)
- `beta`: Increments or adds a numeric pre-release identifier (e.g., `1.0.0` → `1.0.0-1`).

### 2. Manual Versioning
You can provide an explicit version string (e.g., `pnpm run release 1.3.4`), but it must follow the **numeric-only suffix** rule established by the Asyar ecosystem to ensure downstream compatibility with the Windows launcher.

---

## Release Process Automation

When you run the release script, it performs the following steps automatically:

1.  **Version Update**: Updates the version in `package.json`.
2.  **Internal Dependency Sync**: If the script is run within the monorepo context, it updates the SDK version fallback in the extension template.
3.  **Git Operations**: Stages the changes, creates a commit, creates a tag, and pushes to GitHub.
4.  **Publishing Workflow**:
    - The push of a `v*` tag triggers the GitHub Action workflow.
    - **NPM**: The SDK is automatically built and published to NPM.
    - **GitHub Release**: A corresponding GitHub Release is created with automated release notes.
    - **Pre-release Flag**: If the version contains a hyphen (e.g., `v1.0.0-1`), the release is automatically marked as a **Pre-release** on GitHub.
