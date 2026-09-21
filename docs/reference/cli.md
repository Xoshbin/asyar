---
order: 2
---

## 12. Development Workflow — CLI Reference

### Available CLI commands

| Command                     | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| `asyar validate`            | Validate `manifest.json` against all rules                 |
| `asyar build`               | Validate + run `vite build` + verify output                |
| `asyar dev`                 | Validate + build + link + watch for changes                |
| `asyar dev --dev`           | Same as `dev`, but links to the dev flavor of Asyar        |
| `asyar link`                | Build + create symlink + register in `dev_extensions.json` |
| `asyar link --watch`        | `link` + continuous file watching and rebuild              |
| `asyar link --dev`          | `link` targeting the dev flavor of Asyar                   |
| `asyar unlink`              | Remove symlink and unregister from `dev_extensions.json`   |
| `asyar unlink --dev`        | `unlink` targeting the dev flavor of Asyar                 |
| `asyar attach [path]`       | Register extension directory in `dev_extensions.json`      |
| `asyar attach --all [path]` | Scan directory for extensions and attach each one          |
| `asyar detach [id-or-path]` | Unregister a dev extension from `dev_extensions.json`      |
| `asyar detach --all`        | Remove all dev extension registrations                     |
| `asyar doctor`              | Check environment health and diagnose common setup issues  |
| `asyar publish`             | Full publish pipeline (validate → build → GitHub → Store)  |

---

### `asyar validate`

Checks your manifest against all validation rules. Prints a pass/fail report. Safe to run any time.

```bash
asyar validate
```

**What it checks:**

| Check                                 | Rule                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `id` present and format               | Required; must match `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`                  |
| `name`                                | Required; 2–50 characters                                                     |
| `version`                             | Required; valid semver                                                        |
| `description`                         | Required; 10–200 characters                                                   |
| `author`                              | Required                                                                      |
| `type`                                | Optional; one of `"extension"` (default) or `"theme"`                         |
| `commands`                            | At least one entry, OR `searchable: true`, OR a `background.main` entry       |
| Each command `id`, `name`, `mode`     | Required                                                                      |
| `mode` values                         | Must be `"view"` or `"background"`                                            |
| `component` when `mode: "view"`       | Required (Svelte component name exported by `view.ts`)                        |
| `component` when `mode: "background"` | Forbidden                                                                     |
| `background.main`                     | Required when any command has `mode: "background"` or when `searchable: true` |
| `permissions` values                  | Each must be a recognized permission string                                   |
| `view.html` at project root           | Must exist for any extension with `mode: "view"` commands                     |
| `vite.config.ts` or `.js`             | Must exist                                                                    |

---

### `asyar build`

Validates the manifest, runs `vite build`, and verifies `dist/index.html` was produced.

```bash
asyar build

# Skip validation (e.g. in CI where validate already ran)
asyar build --skip-validate
```

**Bundle size note:** Every dependency — including Svelte, any component library, utility packages — is bundled into `dist/`. There is no shared runtime. Do not mark Svelte as external in Vite config; it must be included in the bundle.

---

### `asyar dev` — active development mode (recommended)

```bash
asyar dev

# Target the dev flavor (org.asyar.dev) instead of production
asyar dev --dev
```

1. Validates the manifest.
2. Runs an initial `vite build`.
3. Creates a symlink in the Asyar extensions directory (if needed) and registers the source directory in `dev_extensions.json`.
4. Watches `src/` for changes and rebuilds on every save.

Every successful rebuild is live in Asyar the next time you open the extension panel (the iframe loads fresh on each open).

> **Flavors:** If you are running the **dev build** of Asyar (identifier `org.asyar.dev`), pass `--dev` so the extension is linked into the correct app data directory. Without the flag, the symlink and registration are created for the production build.

> **If you used "Create Extension"** to scaffold your project, the dev path is already registered and step 3 is a no-op. Just run `pnpm dev` (which calls `vite build --watch`).

---

### `asyar link` — manual registration

Use this when you **manually cloned** an extension from GitHub and its path is not registered with Asyar.

```bash
asyar link
```

1. Runs `vite build` (skipped for themes).
2. Creates a symlink from `$APPDATA/extensions/<id>/` pointing to your project root (or copies files on Windows if symlinks are unavailable).
3. Atomically registers the extension's absolute source path in `$APPDATA/dev_extensions.json`. This ensures Asyar's custom scheme handler (`asyar-extension://`) permits serving extension assets without `403 Access Denied` errors on production release builds.

With a symlink in place, subsequent `vite build` runs are immediately reflected. You do not need to run `asyar link` again after each rebuild.

```bash
# Watch mode: rebuild on every change
asyar link --watch

# Target the dev flavor (org.asyar.dev) instead of production
asyar link --dev

# Combine both flags
asyar link --dev --watch
```

> **Flavors:** Asyar ships two builds — production (`org.asyar.app`) and dev (`org.asyar.dev`). By default `asyar link` targets production. Pass `--dev` when testing against a locally built dev instance of Asyar.

---

### `asyar unlink` — remove local registration

Use this to remove the symlink from the extensions directory and remove the extension's entry from `dev_extensions.json`.

```bash
asyar unlink

# Target the dev flavor (org.asyar.dev) instead of production
asyar unlink --dev
```

---

### `asyar attach` — register development extensions

Registers an extension directory for development loading directly into `$APPDATA/dev_extensions.json`. Unlike `asyar link`, `attach` allows mapping arbitrary project folders directly into the launcher's dev registry without requiring symlinks in `$APPDATA/extensions/`.

```bash
# Attach the current working directory
asyar attach

# Attach a specific extension directory
asyar attach ./path/to/my-extension

# Batch attach: scan a folder for all subdirectories containing manifest.json
asyar attach ./extensions --all

# Attach without triggering an initial Vite build
asyar attach --no-build
```

Options:

- `--all`: Scans the target directory for all subdirectories containing a `manifest.json` and attaches each one in batch.
- `--no-build`: Skips running `vite build` prior to registering.

---

### `asyar detach` — unregister development extensions

Removes an extension from `$APPDATA/dev_extensions.json`. You can identify the extension by its ID, its filesystem path, or by running the command inside the extension directory.

```bash
# Detach extension in the current directory (reads manifest.id)
asyar detach

# Detach by extension ID
asyar detach org.asyar.coffee

# Detach by path
asyar detach ./extensions/asyar-coffee-extension

# Detach all registered dev extensions
asyar detach --all
```

Options:

- `--all`: Clears all registered development extensions from `dev_extensions.json`.

---

### `asyar doctor` — diagnostic environment check

Analyzes your local environment, tooling, and repository configuration to diagnose common issues.

```bash
asyar doctor
```

**Diagnostic checks performed:**

1. **Platform & Tooling:** OS architecture, Node version, and `pnpm` availability.
2. **SDK Freshness:** When running inside or alongside the SDK source, verifies whether `dist/` is newer than `src/` and `cli/` files.
3. **Workspace Linking:** Inspects `node_modules/asyar-sdk` to ensure it is workspace-linked rather than a frozen npm package copy.
4. **Extensions Directory:** Validates that `$APPDATA/extensions/` exists and reports the count of installed extensions.
5. **Store Connectivity:** Pings the Asyar Store API to confirm reachability.
6. **Monorepo Detection:** Confirms root workspace location and configuration.

Exits with code `0` if all checks pass or show non-critical warnings; exits with code `1` if actionable failures are detected.

---

### `asyar publish` — release to GitHub & Store

Automates the complete publishing pipeline: validation, building, GitHub release creation, and submission to the Asyar Store.

```bash
asyar publish

# Test packaging and validation without making remote changes
asyar publish --dry-run

# Clear stored credentials and re-authenticate via GitHub OAuth
asyar publish --reset-auth

# Explicitly specify repository URL
asyar publish --repo https://github.com/my-user/my-extension.git
```

**Pipeline steps:**

1. **Manifest Validation & Linting:** Validates required fields, command definitions, and icon assets.
2. **Production Build:** Executes `vite build` (skipped for pure themes) and validates that `dist/` is newer than source files.
3. **Store Authentication:** Authenticates against Asyar Store using GitHub OAuth.
4. **Version Collision Guard:** Confirms that the target version is not already live in the store.
5. **GitHub Release:** Packages the bundle, computes SHA-256 checksums, creates a git tag, and uploads the `.zip` asset.
6. **Store Catalog Submission:** Submits metadata and release URLs to the Asyar Store API.

---

### Development loop (daily workflow)

```bash
# Terminal — start Vite in watch mode
pnpm dev   # or: vite build --watch

# Asyar — test your changes
# Close the extension panel → re-open it → changes are live
```

There is no hot-module-replacement inside the iframe — you need to re-open the panel to load the new `dist/`. For most UI iteration this is instant (Vite rebuilds in < 1s for small projects).

---
