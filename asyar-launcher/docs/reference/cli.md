---
order: 2
---
## 12. Development Workflow — CLI Reference

### Available CLI commands

| Command | Description |
|---|---|
| `asyar validate` | Validate `manifest.json` against all rules |
| `asyar build` | Validate + run `vite build` + verify output |
| `asyar dev` | Validate + build + link + watch for changes |
| `asyar link` | Build + create symlink in Asyar's extensions directory |
| `asyar link --watch` | `link` + continuous file watching and rebuild |
| `asyar publish` | Full publish pipeline (validate → build → GitHub → Store) |

---

### `asyar validate`

Checks your manifest against all validation rules. Prints a pass/fail report. Safe to run any time.

```bash
asyar validate
```

**What it checks:**

| Check | Rule |
|---|---|
| `id` present and format | Required; must match `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/` |
| `name` | Required; 2–50 characters |
| `version` | Required; valid semver |
| `description` | Required; 10–200 characters |
| `author` | Required |
| `commands` | At least one entry |
| Each command `id`, `name`, `resultType` | Required |
| `resultType` values | Must be `"view"` or `"no-view"` |
| `view` when `resultType: "view"` | Required unless manifest has `defaultView` |
| `permissions` values | Each must be a recognized permission string |
| `index.html` at project root | Must exist |
| `vite.config.ts` or `.js` | Must exist |

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
```

1. Validates the manifest.
2. Runs an initial `vite build`.
3. Creates a symlink in the Asyar extensions directory (if needed).
4. Watches `src/` for changes and rebuilds on every save.

Every successful rebuild is live in Asyar the next time you open the extension panel (the iframe loads fresh on each open).

> **If you used "Create Extension"** to scaffold your project, the dev path is already registered and step 3 is a no-op. Just run `pnpm dev` (which calls `vite build --watch`).

---

### `asyar link` — manual registration

Use this when you **manually cloned** an extension from GitHub and its path is not registered with Asyar.

```bash
asyar link
```

1. Runs `vite build`.
2. Creates a symlink from `~/.config/Asyar/extensions/<id>/` pointing to your project root. Falls back to a directory copy on Windows or if symlink creation fails.

With a symlink in place, subsequent `vite build` runs are immediately reflected. You do not need to run `asyar link` again after each rebuild.

```bash
# Watch mode: rebuild + re-link on every change
asyar link --watch
```

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
