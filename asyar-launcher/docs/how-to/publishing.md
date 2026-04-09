## 13. Publishing — GitHub & the Asyar Store

### The full publish pipeline

```bash
asyar publish
```

The publish command is a **resumable multi-step pipeline**. Each step is idempotent — if a step already completed in a previous run, the command detects this and skips forward.

#### Step 1 — Validate

Runs `asyar validate`. Exits immediately on failure before touching GitHub or the Store.

#### Step 2 — Build

Runs `vite build` automatically. Verifies `dist/index.html` was produced.

#### Step 3 — Authenticate with the Asyar Store

Sign in via **GitHub OAuth device flow**. Your browser opens to `github.com/login/device` with a code shown in the terminal. After authorization, a store token is stored locally and reused in future runs.

#### Step 4 — Resolve the GitHub repository

The command finds your repository in this priority order:

1. `--repo <url>` flag (explicit override).
2. `git remote get-url origin` (if git remote exists in working directory).
3. `~/.asyar/config.json` (stored from a previous publish run).
4. **Auto-creates a new public GitHub repository** named `asyar-<last-segment-of-id>-extension`.

#### Step 5 — Check for existing release

Queries GitHub for a release with tag `v<version>`. If both the release and its zip asset already exist, the command jumps directly to Step 8.

#### Step 6 — Package

Creates a zip from `dist/` and `manifest.json`. Computes a **SHA-256 checksum** for integrity verification.

#### Step 7 — Create GitHub Release

Creates a GitHub Release tagged `v<version>` and uploads the zip as a release asset.

#### Step 8 — Submit to the Asyar Store

Sends to the Store API: repo URL, extension ID, version, release tag, download URL, and checksum.

#### Step 9 — Review

Your extension enters a review queue. When approved, it appears in the Asyar Store for users to discover and install.

---

### Publishing a new version

1. Bump the version in `manifest.json` (must be a higher semver than the current published version):

```json
{ "version": "1.2.0" }
```

2. Run `asyar publish`. The command creates a new GitHub Release with tag `v1.2.0` and submits a new store entry.

---

### Using a specific GitHub repository

```bash
asyar publish --repo https://github.com/yourusername/your-extension-repo
```

---

### What store reviewers check

- Manifest completeness and valid permissions.
- The extension does what its description says.
- No malicious code, unexpected data collection, or unnecessary permissions.
- Extension builds cleanly from the published source.
- No undeclared or excessive permissions.
- Description and name comply with store guidelines.

---

### Publishing to GitHub without the Store

You can distribute extensions directly via GitHub without going through the Store. Users can install from a direct URL:

```
https://github.com/<user>/<repo>/releases/download/v1.0.0/<extension-id>.zip
```

### Installing a local `.asyar` file

Users can also install extensions directly from a local file — no internet connection or store submission required. This is the primary distribution method for theme extensions and useful for beta testing any extension type.

**To install:**
1. Package your extension as a `.asyar` file (a renamed ZIP archive — see [Type 3: Theme Extension](#type-3-theme-extension-theme) for the packaging command; view/result extensions use the same format with `index.html` instead of `theme.json`).
2. Open Asyar → Settings → Extensions.
3. Click **Install from File...** and select the `.asyar` file.

**Supported in `.asyar` packages:** all extension types (`view`, `result`, `theme`).

**Version conflict behaviour:** Installing a higher version upgrades the existing installation. Installing the same or lower version is rejected with an error.

---
