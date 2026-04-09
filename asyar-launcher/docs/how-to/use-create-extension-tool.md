## 11. The "Create Extension" Built-in Tool

The fastest and most reliable way to scaffold a new extension is the **Create Extension** feature built into Asyar itself. It is available as a command in the launcher.

### How to open it

Open Asyar → type **"Create Extension"** → press Enter.

### The three scaffolded types

| Type | Template produces | Best for |
|---|---|---|
| **View** | `main.ts` + `DefaultView.svelte` + view manifest | Rich UI panels, forms, browsers, editors |
| **Result** (Search + View) | `main.ts` + `index.ts` (with `search()`) + `DetailView.svelte` | Documentation search, contact lookup, file search |
| **Logic** | `main.ts` only (no Svelte component) | Background actions, clipboard tools, webhooks |

### What the scaffolder does

1. **Prompts you** for: name, ID, description, save location, extension type.
2. **Resolves the latest SDK version** from the npm registry (`npm view asyar-sdk version`). Falls back to `^1.3.3` if offline.
3. **Writes all project files** from templates, replacing `{{EXTENSION_NAME}}`, `{{EXTENSION_ID}}`, `{{EXTENSION_DESC}}`, and `{{SDK_VERSION}}` placeholders.
4. **Runs `pnpm install`** to install all dependencies.
5. **Runs `pnpm run build`** to produce the initial `dist/`.
6. **Calls `register_dev_extension`** — stores your project path in `dev_extensions.json` so Asyar resolves the `asyar-extension://` protocol to your local directory. **No `asyar link` needed**.
7. **Opens VS Code** (or falls back to your default file manager).

After generation, your extension is **immediately active** in Asyar. Open the launcher, type your command name, press Enter.

### Template file reference

Every scaffolded project includes these files:

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (type-specific template) |
| `package.json` | npm/pnpm project with build scripts |
| `vite.config.ts` | Vite build config with SDK alias for dev mode |
| `tsconfig.json` | TypeScript config |
| `index.html` | Vite entry point HTML |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.env`, `*.zip` |
| `src/main.ts` | iframe bootstrap — creates `ExtensionContext`, signals readiness, mounts component |
| `src/index.ts` | Extension class (view and result types) |
| `src/DefaultView.svelte` | View component (view type) |
| `src/DetailView.svelte` | Detail view component (result type) |

---
